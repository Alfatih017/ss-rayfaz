require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const SQLiteSessionStore = require('./session-store');
const db = require('./db');
const ss = require('./sideshift');
const wallet = require('./wallet');

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET is required and must be at least 32 characters');
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));

const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || 'https://side.marketku.id';
app.use((req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin && req.headers.origin !== PUBLIC_ORIGIN) {
    return res.status(403).json({ error: 'forbidden origin' });
  }
  next();
});

app.use(session({
  store: new SQLiteSessionStore(path.join(__dirname, '..', 'data', 'sessions.db')),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: 'auto',
    maxAge: 1000 * 60 * 60 * 24 * 30
  }
}));

function clientIp(req) {
  return req.ip;
}

const loginAttempts = new Map();
function loginRateLimit(req, res, next) {
  const key = `${req.ip}:${String(req.body?.username || '').toLowerCase()}`;
  const now = Date.now();
  const state = loginAttempts.get(key);
  if (state && state.resetAt > now && state.count >= 5) return res.status(429).json({ error: 'too many attempts' });
  req.loginAttemptKey = key;
  next();
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'unauthenticated' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.userId || !req.session.isAdmin)
    return res.status(403).json({ error: 'forbidden' });
  next();
}
function verifyAdminPassword(userId, password) {
  const user = db.prepare('SELECT password_hash,is_admin FROM users WHERE id=?').get(userId);
  return !!user?.is_admin && typeof password === 'string' && bcrypt.compareSync(password, user.password_hash);
}

app.post('/api/auth/login', loginRateLimit, (req, res, next) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'missing fields' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    const current = loginAttempts.get(req.loginAttemptKey);
    loginAttempts.set(req.loginAttemptKey, current?.resetAt > Date.now() ? { count: current.count + 1, resetAt: current.resetAt } : { count: 1, resetAt: Date.now() + 15 * 60 * 1000 });
    return res.status(401).json({ error: 'invalid credentials' });
  }
  loginAttempts.delete(req.loginAttemptKey);
  req.session.regenerate((error) => {
    if (error) return next(error);
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.isAdmin = !!user.is_admin;
    req.session.save((saveError) => saveError ? next(saveError) : res.json({ ok: true, username: user.username, isAdmin: !!user.is_admin }));
  });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) return res.json({ authenticated: false });
  res.json({
    authenticated: true,
    username: req.session.username,
    isAdmin: !!req.session.isAdmin
  });
});

app.post('/api/auth/change-password', requireAuth, (req, res) => {
  const { current, next: nextPw } = req.body || {};
  if (!current || !nextPw || nextPw.length < 12 || nextPw.length > 128)
    return res.status(400).json({ error: 'invalid input' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!bcrypt.compareSync(current, user.password_hash))
    return res.status(401).json({ error: 'current password wrong' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(nextPw, 12), user.id);
  req.session.regenerate((error) => error ? res.status(500).json({ error: 'session reset failed' }) : res.json({ ok: true, loginRequired: true }));
});

app.get('/api/tokens', requireAuth, (req, res) => {
  const rows = db.prepare(
    'SELECT id, coin, network, label, enabled, sort_order FROM tokens WHERE enabled = 1 ORDER BY sort_order, id'
  ).all();
  res.json(rows);
});

app.get('/api/admin/tokens', requireAdmin, (req, res) => {
  const rows = db.prepare(
    'SELECT id, coin, network, label, enabled, sort_order FROM tokens ORDER BY sort_order, id'
  ).all();
  res.json(rows);
});

app.post('/api/admin/tokens', requireAdmin, (req, res) => {
  const { coin, network, label, enabled = 1, sort_order = 0 } = req.body || {};
  if (!coin || !network) return res.status(400).json({ error: 'coin and network required' });
  try {
    const info = db.prepare(
      'INSERT INTO tokens (coin, network, label, enabled, sort_order) VALUES (?, ?, ?, ?, ?)'
    ).run(coin.toUpperCase(), network.toLowerCase(), label || null, enabled ? 1 : 0, sort_order);
    res.json({ id: info.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/admin/tokens/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { coin, network, label, enabled, sort_order } = req.body || {};
  const cur = db.prepare('SELECT * FROM tokens WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: 'not found' });
  db.prepare(`UPDATE tokens SET
      coin = COALESCE(?, coin),
      network = COALESCE(?, network),
      label = COALESCE(?, label),
      enabled = COALESCE(?, enabled),
      sort_order = COALESCE(?, sort_order)
    WHERE id = ?`).run(
      coin ? coin.toUpperCase() : null,
      network ? network.toLowerCase() : null,
      label === undefined ? null : label,
      enabled === undefined ? null : (enabled ? 1 : 0),
      sort_order === undefined ? null : sort_order,
      id
    );
  res.json({ ok: true });
});

app.delete('/api/admin/tokens/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM tokens WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

app.get('/api/permissions', requireAuth, async (req, res) => {
  try {
    const data = await ss.permissions(clientIp(req));
    res.json(data);
  } catch (e) { res.status(e.status || 500).json({ error: e.message, body: e.body }); }
});

app.get('/api/pair', requireAuth, async (req, res) => {
  const { from, to, amount } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to required' });
  try {
    const data = await ss.pair(from, to, amount);
    res.json(data);
  } catch (e) { res.status(e.status || 500).json({ error: e.message, body: e.body }); }
});

const STABLE_COINS = new Set(['USDC', 'USDT', 'DAI', 'BUSD', 'USDP', 'TUSD', 'FDUSD']);
const priceCache = new Map();

async function getUsdPrice(coin, network) {
  const upper = coin.toUpperCase();
  if (STABLE_COINS.has(upper)) return 1.0;
  const key = `${upper}-${network.toLowerCase()}`;
  const cached = priceCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const candidates = [
    `USDC-${network}`, `USDT-${network}`,
    'USDC-solana', 'USDT-bsc', 'USDC-ethereum'
  ];
  for (const target of candidates) {
    try {
      const pair = await ss.pair(`${coin}-${network}`, target);
      const price = Number(pair.rate);
      if (price > 0) {
        priceCache.set(key, { value: price, expiresAt: Date.now() + 30000 });
        return price;
      }
    } catch {}
  }
  return null;
}

app.get('/api/usd-price', requireAuth, async (req, res) => {
  const { coin, network } = req.query;
  if (!coin || !network) return res.status(400).json({ error: 'coin and network required' });
  try {
    const price = await getUsdPrice(coin, network);
    if (price === null) return res.status(404).json({ error: 'price unavailable' });
    res.json({ coin, network, usd: price });
  } catch (e) { res.status(e.status || 500).json({ error: e.message, body: e.body }); }
});

app.post('/api/quote', requireAuth, async (req, res) => {
  const { depositCoin, depositNetwork, settleCoin, settleNetwork, depositAmount, settleAmount } = req.body || {};
  try {
    const data = await ss.quote({
      depositCoin, depositNetwork, settleCoin, settleNetwork,
      depositAmount: depositAmount || null,
      settleAmount: settleAmount || null,
      affiliateId: process.env.AFFILIATE_ID,
      commissionRate: Number(process.env.COMMISSION_RATE || 0.5)
    }, clientIp(req));
    res.json(data);
  } catch (e) { res.status(e.status || 500).json({ error: e.message, body: e.body }); }
});

function persistShift(userId, data) {
  db.prepare(`INSERT OR REPLACE INTO shifts (
    id, user_id, shift_id, type,
    deposit_coin, deposit_network, settle_coin, settle_network,
    deposit_address, deposit_memo, settle_address, refund_address,
    deposit_amount, settle_amount, deposit_min, deposit_max,
    rate, status, expires_at, raw_json,
    created_at, updated_at
  ) VALUES (
    (SELECT id FROM shifts WHERE shift_id = ?),
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
    COALESCE((SELECT created_at FROM shifts WHERE shift_id = ?), datetime('now')),
    datetime('now')
  )`).run(
    data.id,
    userId, data.id, data.type,
    data.depositCoin, data.depositNetwork, data.settleCoin, data.settleNetwork,
    data.depositAddress || null, data.depositMemo || null,
    data.settleAddress, data.refundAddress || null,
    data.depositAmount || null, data.settleAmount || null,
    data.depositMin || null, data.depositMax || null,
    data.rate || null, data.status || null, data.expiresAt || null,
    JSON.stringify(data),
    data.id
  );
}

app.post('/api/shifts/fixed', requireAuth, async (req, res) => {
  const { quoteId, settleAddress, refundAddress, settleMemo, refundMemo } = req.body || {};
  if (!quoteId || !settleAddress) return res.status(400).json({ error: 'quoteId and settleAddress required' });
  try {
    const data = await ss.fixed({
      quoteId, settleAddress, refundAddress, settleMemo, refundMemo,
      affiliateId: process.env.AFFILIATE_ID,
      commissionRate: Number(process.env.COMMISSION_RATE || 0.5)
    }, clientIp(req));
    persistShift(req.session.userId, data);
    res.json(data);
  } catch (e) { res.status(e.status || 500).json({ error: e.message, body: e.body }); }
});

app.post('/api/shifts/variable', requireAuth, async (req, res) => {
  const { depositCoin, depositNetwork, settleCoin, settleNetwork, settleAddress, refundAddress, settleMemo, refundMemo } = req.body || {};
  if (!settleAddress) return res.status(400).json({ error: 'settleAddress required' });
  try {
    const data = await ss.variable({
      depositCoin, depositNetwork, settleCoin, settleNetwork,
      settleAddress, refundAddress, settleMemo, refundMemo,
      affiliateId: process.env.AFFILIATE_ID,
      commissionRate: Number(process.env.COMMISSION_RATE || 0.5)
    }, clientIp(req));
    persistShift(req.session.userId, data);
    res.json(data);
  } catch (e) { res.status(e.status || 500).json({ error: e.message, body: e.body }); }
});

app.get('/api/shifts', requireAuth, (req, res) => {
  const rows = db.prepare(
    `SELECT shift_id, type, deposit_coin, deposit_network, settle_coin, settle_network,
            deposit_amount, settle_amount, status, expires_at, created_at, updated_at
     FROM shifts WHERE user_id = ? ORDER BY created_at DESC LIMIT 200`
  ).all(req.session.userId);
  res.json(rows);
});

app.get('/api/shifts/:id', requireAuth, async (req, res) => {
  const row = db.prepare('SELECT * FROM shifts WHERE shift_id = ? AND user_id = ?')
    .get(req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'not found' });

  try {
    const fresh = await ss.shift(req.params.id);
    persistShift(req.session.userId, fresh);
    res.json(fresh);
  } catch (e) {
    res.json(JSON.parse(row.raw_json));
  }
});

app.post('/api/shifts/:id/set-refund-address', requireAuth, async (req, res) => {
  const row = db.prepare('SELECT * FROM shifts WHERE shift_id = ? AND user_id = ?')
    .get(req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'not found' });
  try {
    const data = await ss.setRefundAddress(req.params.id, req.body);
    persistShift(req.session.userId, data);
    res.json(data);
  } catch (e) { res.status(e.status || 500).json({ error: e.message, body: e.body }); }
});

app.get('/api/wallets', requireAdmin, (req, res) => {
  const rows = db.prepare(
    `SELECT id, label, network, public_key, created_at
     FROM wallets ORDER BY created_at DESC`
  ).all();
  res.json(rows);
});

app.post('/api/wallets/generate', requireAdmin, (req, res) => {
  const { count = 1, label_prefix = 'wallet', network = 'solana' } = req.body || {};
  const n = Math.min(Math.max(Number(count) || 1, 1), 100);
  if (network !== 'solana') return res.status(400).json({ error: 'only solana supported now' });

  const insert = db.prepare(
    `INSERT INTO wallets (label, network, public_key, secret_key_enc, iv, auth_tag)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const created = [];
  const tx = db.transaction(() => {
    for (let i = 0; i < n; i++) {
      const kp = wallet.generateSolanaKeypair();
      const { enc, iv, tag } = wallet.encryptSecret(kp.secretKey);
      const lbl = n === 1 && req.body.label ? req.body.label : `${label_prefix}-${Date.now()}-${i + 1}`;
      const info = insert.run(lbl, network, kp.publicKey, enc, iv, tag);
      created.push({ id: info.lastInsertRowid, label: lbl, network, public_key: kp.publicKey });
    }
  });
  tx();
  res.json({ created });
});

app.post('/api/wallets/:id/reveal', requireAdmin, (req, res) => {
  if (!verifyAdminPassword(req.session.userId, req.body?.password)) return res.status(401).json({ error: 'password verification failed' });
  const row = db.prepare('SELECT * FROM wallets WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'not found' });
  try {
    res.set('Cache-Control', 'no-store');
    const secret = wallet.decryptSecret(row.secret_key_enc, row.iv, row.auth_tag);
    const bs58 = require('bs58').default || require('bs58');
    res.json({
      id: row.id,
      label: row.label,
      network: row.network,
      public_key: row.public_key,
      secret_key_base58: bs58.encode(secret),
      secret_key_array: Array.from(secret)
    });
  } catch (e) {
    res.status(500).json({ error: 'decrypt failed: ' + e.message });
  }
});

app.get('/api/settings/wallet', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT ws.updated_at,w.id,w.label,w.public_key FROM wallet_settings ws JOIN wallets w ON w.id=ws.wallet_id WHERE ws.id=1').get();
  res.json(row ? { configured: true, ...row } : { configured: false });
});

app.post('/api/settings/wallet', requireAdmin, (req, res) => {
  if (!verifyAdminPassword(req.session.userId, req.body?.password)) return res.status(401).json({ error: 'password verification failed' });
  let derived; try { derived = wallet.deriveSolanaKeypair(req.body?.mnemonic); } catch { return res.status(400).json({ error: 'invalid 12 or 24 word mnemonic' }); }
  const secret = wallet.encryptSecret(derived.secretKey); const phrase = wallet.encryptSecret(Buffer.from(derived.mnemonic));
  const save = db.transaction(() => {
    let row = db.prepare('SELECT id FROM wallets WHERE public_key=?').get(derived.publicKey);
    if (!row) row = { id: db.prepare("INSERT INTO wallets(label,network,public_key,secret_key_enc,iv,auth_tag) VALUES('Imported seed wallet','solana',?,?,?,?)").run(derived.publicKey,secret.enc,secret.iv,secret.tag).lastInsertRowid };
    db.prepare('INSERT INTO wallet_settings(id,mnemonic_enc,mnemonic_iv,mnemonic_tag,wallet_id,updated_at) VALUES(1,?,?,?,?,datetime(\'now\')) ON CONFLICT(id) DO UPDATE SET mnemonic_enc=excluded.mnemonic_enc,mnemonic_iv=excluded.mnemonic_iv,mnemonic_tag=excluded.mnemonic_tag,wallet_id=excluded.wallet_id,updated_at=excluded.updated_at').run(phrase.enc,phrase.iv,phrase.tag,row.id);
    return row.id;
  });
  const id = save(); res.json({ ok: true, walletId: id, publicKey: derived.publicKey });
});

app.post('/api/settings/wallet/reveal', requireAdmin, (req, res) => {
  if (!verifyAdminPassword(req.session.userId, req.body?.password)) return res.status(401).json({ error: 'password verification failed' });
  const row = db.prepare('SELECT ws.*,w.label,w.network,w.public_key,w.secret_key_enc,w.iv,w.auth_tag FROM wallet_settings ws JOIN wallets w ON w.id=ws.wallet_id WHERE ws.id=1').get();
  if (!row) return res.status(404).json({ error: 'seed wallet not configured' });
  res.set('Cache-Control', 'no-store');
  const secret = wallet.decryptSecret(row.secret_key_enc,row.iv,row.auth_tag); const mnemonic = wallet.decryptSecret(row.mnemonic_enc,row.mnemonic_iv,row.mnemonic_tag).toString('utf8');
  res.json({ label:row.label,network:row.network,public_key:row.public_key,secret_key_base58:(require('bs58').default||require('bs58')).encode(secret),secret_key_array:Array.from(secret),mnemonic });
});

app.put('/api/wallets/:id', requireAdmin, (req, res) => {
  const { label } = req.body || {};
  db.prepare('UPDATE wallets SET label = ? WHERE id = ?').run(label || null, Number(req.params.id));
  res.json({ ok: true });
});

app.delete('/api/wallets/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM wallets WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

app.get('/health', (req, res) => res.json({ status: 'healthy' }));

app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

const PORT = Number(process.env.PORT || 8889);
app.listen(PORT, '127.0.0.1', () => {
  console.log(`[ss-rayfaz] listening on 127.0.0.1:${PORT}`);
});
