'use strict';
const session = require('express-session');
const Database = require('better-sqlite3');

class SQLiteSessionStore extends session.Store {
  constructor(filename) {
    super();
    this.db = new Database(filename);
    this.db.exec('CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expires_at INTEGER NOT NULL)');
    this.getStmt = this.db.prepare('SELECT sess FROM sessions WHERE sid=? AND expires_at>?');
    this.setStmt = this.db.prepare('INSERT INTO sessions(sid,sess,expires_at) VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess,expires_at=excluded.expires_at');
    this.deleteStmt = this.db.prepare('DELETE FROM sessions WHERE sid=?');
  }
  get(sid, callback) { try { const row = this.getStmt.get(sid, Date.now()); callback(null, row ? JSON.parse(row.sess) : null); } catch (error) { callback(error); } }
  set(sid, value, callback = () => {}) { try { this.setStmt.run(sid, JSON.stringify(value), value.cookie?.expires ? new Date(value.cookie.expires).getTime() : Date.now() + 86400000); callback(); } catch (error) { callback(error); } }
  destroy(sid, callback = () => {}) { try { this.deleteStmt.run(sid); callback(); } catch (error) { callback(error); } }
}

module.exports = SQLiteSessionStore;