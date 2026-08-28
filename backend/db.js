const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'data', 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    coin TEXT NOT NULL,
    network TEXT NOT NULL,
    label TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(coin, network)
  );

  CREATE TABLE IF NOT EXISTS shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    shift_id TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL,
    deposit_coin TEXT NOT NULL,
    deposit_network TEXT NOT NULL,
    settle_coin TEXT NOT NULL,
    settle_network TEXT NOT NULL,
    deposit_address TEXT,
    deposit_memo TEXT,
    settle_address TEXT NOT NULL,
    refund_address TEXT,
    deposit_amount TEXT,
    settle_amount TEXT,
    deposit_min TEXT,
    deposit_max TEXT,
    rate TEXT,
    status TEXT,
    expires_at TEXT,
    raw_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_shifts_user ON shifts(user_id);
  CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts(status);

  CREATE TABLE IF NOT EXISTS wallets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT,
    network TEXT NOT NULL DEFAULT 'solana',
    public_key TEXT UNIQUE NOT NULL,
    secret_key_enc TEXT NOT NULL,
    iv TEXT NOT NULL,
    auth_tag TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_wallets_network ON wallets(network);
`);

const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
if (userCount === 0) {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password || password.length < 12) {
    throw new Error('ADMIN_USERNAME and ADMIN_PASSWORD (minimum 12 characters) are required for first boot');
  }
  const hash = bcrypt.hashSync(password, 12);
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)')
    .run(username, hash);
  console.log('[db] Seeded configured admin user');
}

const tokenCount = db.prepare('SELECT COUNT(*) as c FROM tokens').get().c;
if (tokenCount === 0) {
  const seed = [
    { coin: 'SOL',  network: 'solana',   label: 'SOL (Solana)' },
    { coin: 'USDC', network: 'solana',   label: 'USDC (Solana)' },
    { coin: 'USDT', network: 'solana',   label: 'USDT (Solana)' },
    { coin: 'USDT', network: 'bsc',      label: 'USDT (BEP20)' },
    { coin: 'USDC', network: 'bsc',      label: 'USDC (BEP20)' },
    { coin: 'USDT', network: 'polygon',  label: 'USDT (Polygon)' },
    { coin: 'USDC', network: 'polygon',  label: 'USDC (Polygon)' }
  ];
  const stmt = db.prepare(
    'INSERT INTO tokens (coin, network, label, sort_order) VALUES (?, ?, ?, ?)'
  );
  seed.forEach((t, i) => stmt.run(t.coin, t.network, t.label, i));
  console.log('[db] Seeded default tokens');
}

module.exports = db;
