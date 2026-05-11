// @ts-check

const {
  clearSessionCookie,
  getSessionTokenFromRequest,
  getSessionTokenFromSocket,
  setSessionCookie
} = require('./cookies');
const { SESSION_TTL_MS } = require('../auth/user-store');

/** @typedef {import('express').Express} Express */
/** @typedef {import('express').Request} Request */
/** @typedef {import('express').Response} Response */
/** @typedef {import('socket.io').Socket} Socket */
/** @typedef {import('../types').AuthUser} AuthUser */

/**
 * @typedef {{
 *   register(username: unknown, password: unknown): import('../types').AuthResult;
 *   authenticate(username: unknown, password: unknown): import('../types').AuthResult;
 *   createSession(userId: string): import('../types').AuthSession | null;
 *   getSessionUser(token: string | null | undefined): AuthUser | null;
 *   deleteSession(token: string): void;
 * }} UserStoreLike
 */

/**
 * @param {UserStoreLike} userStore
 * @param {Response} res
 * @param {AuthUser} user
 */
function createAuthSessionResponse(userStore, res, user) {
  const session = userStore.createSession(user.id);
  if (!session) {
    return res.status(500).json({ success: false, error: '无法创建登录会话' });
  }

  setSessionCookie(res, session.token, SESSION_TTL_MS);
  return res.json({ success: true, user: session.user });
}

/**
 * @returns {(req: Request) => boolean}
 */
function createAuthRateLimiter() {
  /** @type {Map<string, number[]>} */
  const authAttempts = new Map();
  const windowMs = 10 * 60 * 1000;

  return (req) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const recentAttempts = (authAttempts.get(key) || []).filter(timestamp => now - timestamp < windowMs);
    const nextAttempts = [...recentAttempts, now];
    authAttempts.set(key, nextAttempts);
    return nextAttempts.length > 20;
  };
}

/**
 * @param {UserStoreLike} userStore
 * @param {Request} req
 * @returns {AuthUser | null}
 */
function getAuthUserFromRequest(userStore, req) {
  return userStore.getSessionUser(getSessionTokenFromRequest(req));
}

/**
 * @param {UserStoreLike} userStore
 * @param {Socket} socket
 * @returns {AuthUser | null}
 */
function getAuthUserFromSocket(userStore, socket) {
  return userStore.getSessionUser(getSessionTokenFromSocket(socket));
}

/**
 * @param {AuthUser} user
 * @returns {string}
 */
function getPlayerSessionId(user) {
  return `user:${user.id}`;
}

/**
 * @param {Express} app
 * @param {UserStoreLike} userStore
 */
function registerAuthRoutes(app, userStore) {
  const isAuthRateLimited = createAuthRateLimiter();

  app.post('/api/auth/register', (req, res) => {
    if (isAuthRateLimited(req)) {
      return res.status(429).json({ success: false, error: '请求过于频繁，请稍后再试' });
    }

    const result = userStore.register(req.body?.username, req.body?.password);
    if (!result.success) {
      const status = result.code === 'USERNAME_TAKEN' ? 409 : 400;
      return res.status(status).json({ success: false, error: result.error });
    }

    return createAuthSessionResponse(userStore, res, result.user);
  });

  app.post('/api/auth/login', (req, res) => {
    if (isAuthRateLimited(req)) {
      return res.status(429).json({ success: false, error: '请求过于频繁，请稍后再试' });
    }

    const result = userStore.authenticate(req.body?.username, req.body?.password);
    if (!result.success) {
      return res.status(401).json({ success: false, error: result.error });
    }

    return createAuthSessionResponse(userStore, res, result.user);
  });

  app.post('/api/auth/logout', (req, res) => {
    const token = getSessionTokenFromRequest(req);
    if (token) {
      userStore.deleteSession(token);
    }
    clearSessionCookie(res);
    return res.json({ success: true });
  });

  app.get('/api/auth/me', (req, res) => {
    const user = getAuthUserFromRequest(userStore, req);
    return res.json({ success: true, user });
  });
}

module.exports = {
  createAuthRateLimiter,
  getAuthUserFromRequest,
  getAuthUserFromSocket,
  getPlayerSessionId,
  registerAuthRoutes
};
