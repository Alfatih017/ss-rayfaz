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
 * - TTL is 30 minutes from creation; extendable on activity.
 * - Lock() / logout() immediately clears all entries.
 * - Only one concurrent unlock per user session is allowed.
 */

const crypto = require('crypto');
const db = require('./db');
const wallet = require('./wallet');

const TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Map<sessionId, { userId, keys: Map<walletId, Buffer>, createdAt, expiresAt }>
 */
const sessions = new Map();

function _purge() {
  const now = Date.now();
  for (const [sid, entry] of sessions) {
    if (entry.expiresAt <= now) sessions.delete(sid);
  }
}

function isUnlocked(sessionId) {
  const entry = sessions.get(sessionId);
  if (!entry) return false;
  if (entry.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return false;
  }
  return true;
}

function getKey(sessionId, walletId) {
  const entry = sessions.get(sessionId);
  if (!entry || entry.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  return entry.keys.get(walletId) || null;
}

function getAllKeys(sessionId) {
  const entry = sessions.get(sessionId);
  if (!entry || entry.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
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
      // skip wallets that fail to decrypt
    }
  }

  // Log the unlock action
  db.prepare('INSERT INTO secret_access_log (user_id, wallet_id, action) VALUES (?, NULL, ?)').run(userId, 'session_unlock');

  const now = Date.now();
  sessions.set(sessionId, {
    userId,
    keys,
    createdAt: now,
    expiresAt: now + TTL_MS,
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

function extend(sessionId) {
  const entry = sessions.get(sessionId);
  if (!entry || entry.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return false;
  }
  entry.expiresAt = Date.now() + TTL_MS;
  return true;
}

function lockAllForUser(userId) {
  for (const [sid, entry] of sessions) {
    if (entry.userId === userId) sessions.delete(sid);
  }
}

// Purge expired entries every 5 minutes
setInterval(_purge, 5 * 60 * 1000).unref();

module.exports = { isUnlocked, getKey, getAllKeys, unlock, lock, extend, lockAllForUser, TTL_MS };
