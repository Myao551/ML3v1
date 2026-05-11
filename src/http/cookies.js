// @ts-check

/** @typedef {import('express').Request} Request */
/** @typedef {import('express').Response} Response */
/** @typedef {import('socket.io').Socket} Socket */

const SESSION_COOKIE = 'sanda1_session';

/**
 * @param {string | undefined} cookieHeader
 * @returns {Record<string, string>}
 */
function parseCookies(cookieHeader = '') {
  return cookieHeader
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separatorIndex = part.indexOf('=');
      if (separatorIndex === -1) return cookies;
      const key = part.slice(0, separatorIndex);
      const value = part.slice(separatorIndex + 1);
      try {
        return { ...cookies, [key]: decodeURIComponent(value) };
      } catch (error) {
        return cookies;
      }
    }, /** @type {Record<string, string>} */ ({}));
}

/**
 * @param {Request} req
 * @returns {string | null}
 */
function getSessionTokenFromRequest(req) {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE] || null;
}

/**
 * @param {Socket} socket
 * @returns {string | null}
 */
function getSessionTokenFromSocket(socket) {
  return parseCookies(socket.handshake.headers.cookie)[SESSION_COOKIE] || null;
}

/**
 * @param {Response} res
 * @param {string} token
 * @param {number} sessionTtlMs
 */
function setSessionCookie(res, token, sessionTtlMs) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(sessionTtlMs / 1000)}${secure}`
  );
}

/**
 * @param {Response} res
 */
function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
  );
}

module.exports = {
  SESSION_COOKIE,
  clearSessionCookie,
  getSessionTokenFromRequest,
  getSessionTokenFromSocket,
  parseCookies,
  setSessionCookie
};
