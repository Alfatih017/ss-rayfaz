'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, file), 'utf8');
const db = read('db.js');
const server = read('server.js');
const wallet = read('wallet.js');
const sessionStore = read('session-store.js');
const frontend = read('../frontend/app.js');
const transfer = read('solana-transfer.service.js');
const walletSession = read('wallet-session.js');
assert.doesNotMatch(db, /akulupa|Seeded default admin/);
assert.match(db, /ADMIN_USERNAME/);
assert.match(db, /ADMIN_PASSWORD/);
assert.doesNotMatch(server, /dev-secret-change-me/);
assert.match(server, /SESSION_SECRET is required/);
assert.match(server, /req\.session\.regenerate/);
assert.match(server, /too many attempts/);
assert.match(server, /forbidden origin/);
assert.match(server, /Cache-Control', 'no-store/);
assert.doesNotMatch(wallet, /dev-fallback-key/);
assert.match(wallet, /WALLET_ENCRYPTION_KEY is required/);
for (const route of [
  /app\.get\('\/api\/wallets', requireAdmin/,
  /app\.post\('\/api\/wallets\/generate', requireAdmin/,
  /app\.post\('\/api\/wallets\/:id\/reveal', requireAdmin/,
  /app\.put\('\/api\/wallets\/:id', requireAdmin/,
  /app\.delete\('\/api\/wallets\/:id', requireAdmin/,
]) assert.match(server, route);
assert.match(server, /app\.get\('\/health'/);
assert.match(sessionStore, /class SQLiteSessionStore extends session\.Store/);
assert.doesNotMatch(server, /connect-sqlite3/);
assert.match(server, /verifyAdminPassword/);
assert.match(server, /api\/settings\/wallet\/reveal/);
assert.match(wallet, /deriveSolanaKeypair/);
assert.match(wallet, /\[44, 501, 0, 0\]/);
assert.match(db, /mnemonic_enc/);
assert.doesNotMatch(frontend, /api\.get\('\/api\/wallets\/' \+ w\.id \+ '\/reveal'/);
assert.match(frontend, /Save Seed Wallet/);
assert.match(frontend, /Wallet Utama/);
assert.match(frontend, /Confirm & Send/);
assert.match(server, /wallets\/transfer\/preview/);
assert.match(server, /wallets\/transfer\/confirm/);
assert.match(transfer, /simulateTransaction/);
assert.match(transfer, /preview expired or already used/);
assert.match(db, /sol_transfer_log/);
// --- Rotation & session unlock contract ---
assert.match(db, /wallet_rotation_state/);
assert.match(db, /secret_access_log/);
assert.match(db, /rotation_enabled/);
assert.match(server, /wallet-session/);
assert.match(server, /api\/wallets\/session-unlock/);
assert.match(server, /api\/wallets\/session-lock/);
assert.match(server, /api\/wallets\/session-status/);
assert.match(server, /lockAllForUser/);
assert.match(walletSession, /TTL_MS/);
assert.match(walletSession, /NEVER touch disk/);
assert.match(walletSession, /isUnlocked/);
assert.match(walletSession, /lockAllForUser/);
assert.doesNotMatch(walletSession, /console\.(log|error|warn)/);
assert.match(server, /reveal_private_key/);
assert.match(server, /reveal_seed_phrase/);
assert.match(server, /api\/wallets\/rotation\/next/);
assert.match(server, /api\/wallets\/rotation\/state/);
assert.match(server, /rotation_enabled/);
assert.match(server, /wallet_rotation_state/);
assert.match(frontend, /loadRotationAddress/);
assert.match(frontend, /rotation\/next/);
assert.match(frontend, /session-unlock/);
assert.match(frontend, /session-lock/);
assert.match(frontend, /sessionUnlocked/);
console.log('security contract: ok');
