// @ts-check
const path = require('node:path');
const fs = require('node:fs');

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS auth_users (
    id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
    created_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    expires_at BIGINT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expires_at)'
];

/**
 * @param {{ databaseUrl?: string; sqlitePath?: string; production?: boolean; pool?: import('pg').Pool }} options
 */
async function openAccountStore(options = {}) {
  if (options.production && !options.databaseUrl && !options.pool) {
    throw new Error('DATABASE_URL is required in production. Ephemeral local storage cannot preserve accounts on Render.');
  }
  /** @type {(sql: string, values?: any[]) => Promise<any[]>} */
  let query;
  /** @type {() => Promise<void>} */
  let close;
  if (options.databaseUrl || options.pool) {
    const { Pool } = require('pg');
    const pool = options.pool || new Pool({ connectionString: options.databaseUrl, max: 5, connectionTimeoutMillis: 10000 });
    pool.on('error', () => console.error('Account database connection error'));
    query = async (sql, values = []) => (await pool.query(sql, values)).rows;
    close = () => pool.end();
  } else {
    const { DatabaseSync } = require('node:sqlite');
    const filename = options.sqlitePath || path.join(process.cwd(), 'data', 'accounts.sqlite');
    if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(filename);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (filename !== ':memory:' && process.platform !== 'win32') fs.chmodSync(filename, 0o600);
    query = async (sql, values = []) => {
      const bindings = Object.fromEntries(values.map((value, index) => [`$${index + 1}`, value]));
      return db.prepare(sql).all(bindings);
    };
    close = async () => { db.close(); };
  }
  try {
    for (const sql of SCHEMA) await query(sql);
    await query('DELETE FROM auth_sessions WHERE expires_at <= $1', [Date.now()]);
  } catch (error) { await close(); throw error; }
  return {
    close,
    /** @param {string} username */
    async findUser(username) { return (await query('SELECT * FROM auth_users WHERE username = $1', [username]))[0]; },
    /** @param {{id: string; username: string; displayName: string; passwordHash: string}} user */
    async createUser(user) {
      const rows = await query(`INSERT INTO auth_users (id, username, display_name, password_hash, created_at)
        VALUES ($1, $2, $3, $4, $5) RETURNING *`, [user.id, user.username, user.displayName, user.passwordHash, Date.now()]);
      return rows[0];
    },
    /** @param {string} hash @param {string} userId @param {number} expires */
    async createSession(hash, userId, expires) {
      await query('DELETE FROM auth_sessions WHERE expires_at <= $1', [Date.now()]);
      await query('INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [hash, userId, expires]);
    },
    /** @param {string} hash */
    async getSession(hash) {
      return (await query(`SELECT u.id, u.username, u.display_name, s.expires_at
        FROM auth_sessions s JOIN auth_users u ON s.user_id = u.id
        WHERE s.token_hash = $1 AND s.expires_at > $2`, [hash, Date.now()]))[0];
    },
    /** @param {string} hash */
    async deleteSession(hash) { await query('DELETE FROM auth_sessions WHERE token_hash = $1', [hash]); }
  };
}

module.exports = { openAccountStore };
