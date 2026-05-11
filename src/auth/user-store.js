// @ts-check

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { v4: uuidv4 } = require('uuid');

/** @typedef {import('../types').AuthResult} AuthResult */
/** @typedef {import('../types').AuthSession} AuthSession */
/** @typedef {import('../types').AuthUser} AuthUser */
/** @typedef {import('../types').SessionRecord} SessionRecord */
/** @typedef {import('../types').StoredUser} StoredUser */
/** @typedef {import('../types').UserStoreOptions} UserStoreOptions */
/** @typedef {import('../types').ValidationResult} ValidationResult */

const PASSWORD_KEY_LENGTH = 64;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * @param {unknown} username
 * @param {unknown} password
 * @returns {ValidationResult}
 */
function validateCredentials(username, password) {
  const normalizedUsername = String(username || '').trim();
  const normalizedPassword = String(password || '');

  if (normalizedUsername.length < 2 || normalizedUsername.length > 20) {
    return { valid: false, message: '用户名长度需要在 2 到 20 个字符之间' };
  }

  if (/[\u0000-\u001f\u007f]/u.test(normalizedUsername)) {
    return { valid: false, message: '用户名不能包含控制字符' };
  }

  if (normalizedPassword.length < 8 || normalizedPassword.length > 128) {
    return { valid: false, message: '密码长度需要在 8 到 128 个字符之间' };
  }

  return { valid: true };
}

/**
 * @param {string} password
 * @param {string} [salt]
 * @returns {string}
 */
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, PASSWORD_KEY_LENGTH).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

/**
 * @param {string} password
 * @param {unknown} storedHash
 * @returns {boolean}
 */
function verifyPassword(password, storedHash) {
  const [algorithm, salt, expectedHash] = String(storedHash || '').split(':');
  if (algorithm !== 'scrypt' || !salt || !expectedHash) return false;

  const actualHash = crypto.scryptSync(password, salt, PASSWORD_KEY_LENGTH);
  const expected = Buffer.from(expectedHash, 'hex');
  if (actualHash.length !== expected.length) return false;

  return crypto.timingSafeEqual(actualHash, expected);
}

/**
 * @param {StoredUser | undefined | null} user
 * @returns {AuthUser | null}
 */
function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    createdAt: user.createdAt
  };
}

class UserStore {
  /**
   * @param {UserStoreOptions} [options]
   */
  constructor({ filePath = path.join(__dirname, '..', '..', 'data', 'users.json'), now = () => Date.now() } = {}) {
    this.filePath = filePath;
    this.now = now;
    /** @type {Map<string, SessionRecord>} */
    this.sessions = new Map();
    /** @type {StoredUser[]} */
    this.users = this.loadUsers();
  }

  /**
   * @returns {StoredUser[]}
   */
  loadUsers() {
    if (!fs.existsSync(this.filePath)) {
      return [];
    }

    const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    return Array.isArray(data.users) ? data.users : [];
  }

  /**
   * @param {StoredUser[]} users
   */
  saveUsers(users) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify({ users }, null, 2));
  }

  /**
   * @param {unknown} username
   * @param {unknown} password
   * @returns {AuthResult}
   */
  register(username, password) {
    const validation = validateCredentials(username, password);
    if (!validation.valid) {
      return { success: false, code: 'INVALID_CREDENTIALS', error: validation.message || '注册信息无效' };
    }

    const normalizedUsername = String(username).trim();
    const userKey = normalizedUsername.toLowerCase();
    const duplicate = this.users.some(user => user.username.toLowerCase() === userKey);
    if (duplicate) {
      return { success: false, code: 'USERNAME_TAKEN', error: '用户名已存在' };
    }

    const user = {
      id: uuidv4(),
      username: normalizedUsername,
      passwordHash: hashPassword(String(password)),
      createdAt: new Date(this.now()).toISOString()
    };

    const nextUsers = [...this.users, user];
    this.users = nextUsers;
    this.saveUsers(nextUsers);

    const safeUser = sanitizeUser(user);
    if (!safeUser) {
      return { success: false, code: 'USER_CREATE_FAILED', error: '无法创建用户' };
    }

    return { success: true, user: safeUser };
  }

  /**
   * @param {unknown} username
   * @param {unknown} password
   * @returns {AuthResult}
   */
  authenticate(username, password) {
    const normalizedUsername = String(username || '').trim().toLowerCase();
    const user = this.users.find(item => item.username.toLowerCase() === normalizedUsername);
    if (!user || !verifyPassword(String(password || ''), user.passwordHash)) {
      return { success: false, code: 'INVALID_LOGIN', error: '用户名或密码错误' };
    }

    const safeUser = sanitizeUser(user);
    if (!safeUser) {
      return { success: false, code: 'INVALID_LOGIN', error: '用户名或密码错误' };
    }

    return { success: true, user: safeUser };
  }

  /**
   * @param {string} userId
   * @returns {AuthSession | null}
   */
  createSession(userId) {
    const user = this.users.find(item => item.id === userId);
    const safeUser = sanitizeUser(user);
    if (!user || !safeUser) {
      return null;
    }

    const token = crypto.randomBytes(32).toString('hex');
    const session = {
      userId,
      expiresAt: this.now() + SESSION_TTL_MS
    };
    this.sessions = new Map([...this.sessions, [token, session]]);

    return { token, expiresAt: session.expiresAt, user: safeUser };
  }

  /**
   * @param {string | null | undefined} token
   * @returns {AuthUser | null}
   */
  getSessionUser(token) {
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session) return null;

    if (session.expiresAt <= this.now()) {
      this.deleteSession(token);
      return null;
    }

    return sanitizeUser(this.users.find(user => user.id === session.userId));
  }

  /**
   * @param {string} token
   */
  deleteSession(token) {
    this.sessions = new Map([...this.sessions].filter(([key]) => key !== token));
  }
}

module.exports = {
  UserStore,
  hashPassword,
  sanitizeUser,
  validateCredentials,
  verifyPassword,
  SESSION_TTL_MS
};
