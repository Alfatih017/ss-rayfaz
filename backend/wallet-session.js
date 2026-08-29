'use strict';

/**
 * In-memory session unlock store.
 *
 * Holds decrypted wallet secret keys for the current admin session so that
 * automated sweep operations can sign transactions without re-prompting the
 * password on every transfer.
 *
 * SECURITY CONTRACT:
 * - Decrypted keys NEVER touch disk, logs, or responses.
 * - SESSION_SCOPED: unlock lasts for the current login session only.
 * - Lock(), logout, password change, or process restart clears all entries.
 * - Only one concurrent unlock per user session is allowed.
 */

const db = require('./db');
const wallet = require('./wallet');

const SESSION_SCOPED = true;

/**
 * Map<sessionId, { userId, keys: Map<walletId, Buffer>, createdAt }>
 */
const sessions = new Map();

function isUnlocked(sessionId) {
  return sessions.has(sessionId);
}

function getKey(sessionId, walletId) {
  const entry = sessions.get(sessionId);
  if (!entry) return null;
  return entry.keys.get(walletId) || null;
}

function getAllKeys(sessionId) {
  const entry = sessions.get(sessionId);
  if (!entry) return null;
  return entry.keys;
}

/**
 * Unlock: decrypt all wallet secret keys into memory.
 * Returns the list of wallet IDs that were decrypted.
 */
function unlock(sessionId, userId, password) {
  // Verify admin password
  const user = db.prepare('SELECT password_hash, is_admin FROM users WHERE id = ?').get(userId);
  if (!user?.is_admin || !password) return false;
  const bcrypt = require('bcryptjs');
  if (!bcrypt.compareSync(password, user.password_hash)) return false;

  // Load all wallets
  const rows = db.prepare('SELECT id, secret_key_enc, iv, auth_tag FROM wallets ORDER BY id').all();
  const keys = new Map();
  for (const row of rows) {
    try {
      const secret = wallet.decryptSecret(row.secret_key_enc, row.iv, row.auth_tag);
      keys.set(row.id, secret);
    } catch {
      for (const secret of keys.values()) secret.fill(0);
      return false;
    }
  }

  // Log the unlock action
  db.prepare('INSERT INTO secret_access_log (user_id, wallet_id, action) VALUES (?, NULL, ?)').run(userId, 'session_unlock');

  sessions.set(sessionId, {
    userId,
    keys,
    createdAt: Date.now(),
  });
  return true;
}

function lock(sessionId) {
  const entry = sessions.get(sessionId);
  if (entry) {
    // Log the lock action
    db.prepare('INSERT INTO secret_access_log (user_id, wallet_id, action) VALUES (?, NULL, ?)').run(entry.userId, 'session_lock');
  }
  sessions.delete(sessionId);
}

function lockAllForUser(userId) {
  for (const [sid, entry] of sessions) {
    if (entry.userId === userId) sessions.delete(sid);
  }
}

function addKey(sessionId, walletId, secret) {
  const entry = sessions.get(sessionId);
  if (!entry) return false;
  entry.keys.set(walletId, Buffer.from(secret));
  return true;
}

module.exports = { isUnlocked, getKey, getAllKeys, unlock, lock, lockAllForUser, addKey, SESSION_SCOPED };
