// @ts-check
const crypto = require('node:crypto');
const COOKIE = 'sanda1_session';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
/** @param {string} password @param {string} salt @param {number} length */
function derive(password, salt, length) {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, length, SCRYPT_OPTIONS,
    (error, key) => error ? reject(error) : resolve(key)));
}

class AuthError extends Error {
  /** @param {number} status @param {string} message */
  constructor(status, message) { super(message); this.status = status; }
}

/** @param {string} password */
async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64);
  return `scrypt:${salt}:${key.toString('hex')}`;
}

/** @param {string} password @param {string} stored */
async function verifyPassword(password, stored) {
  const [algorithm, salt, hex] = stored.split(':');
  if (algorithm !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(hex)) return false;
  const expected = Buffer.from(hex, 'hex');
  const actual = await derive(password, salt, expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

/** @param {string} token */
function tokenHash(token) { return crypto.createHash('sha256').update(token).digest('hex'); }

/** @param {string | undefined} header */
function readSessionToken(header) {
  const value = (header || '').split(';').map(item => item.trim()).find(item => item.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

/** @param {any} row */
function publicUser(row) { return { id: row.id, username: row.username, displayName: row.display_name }; }

/** @param {Awaited<ReturnType<import('./store').openAccountStore>>} store */
async function createAuthService(store) {
  // Equal-cost password checks for unknown accounts reduce username timing leaks.
  const dummyHash = await hashPassword(crypto.randomBytes(24).toString('hex'));
  return {
    /** @param {any} input */
    async register(input) {
      const username = typeof input?.username === 'string' ? input.username.trim().toLowerCase() : '';
      const displayName = typeof input?.displayName === 'string' ? input.displayName.trim() : '';
      const password = input?.password;
      if (!/^[a-z0-9_]{3,24}$/.test(username)) throw new AuthError(400, '账号需为 3–24 位字母、数字或下划线');
      if (!displayName || displayName.length > 12 || /[\x00-\x1f\x7f]/.test(displayName)) throw new AuthError(400, '昵称需为 1–12 个字符');
      if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw new AuthError(400, '密码长度需为 8–128 位');
      const passwordHash = await hashPassword(password);
      try {
        return publicUser(await store.createUser({ id: crypto.randomUUID(), username, displayName, passwordHash }));
      } catch (error) {
        const problem = /** @type {{code?: string; errcode?: number}} */ (error);
        if (problem.code === '23505' || problem.errcode === 2067 || problem.errcode === 1555) throw new AuthError(409, '账号或昵称已被使用');
        throw error;
      }
    },
    /** @param {any} input */
    async login(input) {
      const username = typeof input?.username === 'string' ? input.username.trim().toLowerCase() : '';
      const password = input?.password;
      if (!/^[a-z0-9_]{3,24}$/.test(username) || typeof password !== 'string' || password.length > 128) throw new AuthError(401, '账号或密码错误');
      const user = await store.findUser(username);
      const matches = await verifyPassword(password, user?.password_hash || dummyHash);
      if (!user || !matches) throw new AuthError(401, '账号或密码错误');
      return publicUser(user);
    },
    /** @param {string} userId */
    async issueSession(userId) {
      const token = crypto.randomBytes(32).toString('base64url');
      const expiresAt = Date.now() + SESSION_MS;
      await store.createSession(tokenHash(token), userId, expiresAt);
      return { token, expiresAt };
    },
    /** @param {string | undefined} cookie */
    async authenticate(cookie) {
      const token = readSessionToken(cookie);
      if (!token) return null;
      const row = await store.getSession(tokenHash(token));
      return row ? { user: publicUser(row), expiresAt: Number(row.expires_at), sessionKey: tokenHash(token) } : null;
    },
    /** @param {string | undefined} cookie */
    async logout(cookie) {
      const token = readSessionToken(cookie);
      if (token) await store.deleteSession(tokenHash(token));
      return token ? tokenHash(token) : null;
    }
  };
}

module.exports = { createAuthService, AuthError, COOKIE, SESSION_MS };
