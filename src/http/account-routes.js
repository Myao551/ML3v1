// @ts-check
const { rateLimit } = require('express-rate-limit');
const { AuthError, COOKIE, SESSION_MS } = require('../auth/service');

/** @param {string | undefined} origin @param {string} expected */
function isAllowedOrigin(origin, expected) { return !origin || origin === expected; }

/**
 * @param {{ app: import('express').Express; io: import('socket.io').Server;
 * auth: Awaited<ReturnType<import('../auth/service').createAuthService>>;
 * rooms: Map<string, any>; production: boolean; publicOrigin?: string }} deps
 */
function installAccountRoutes({ app, io, auth, rooms, production, publicOrigin }) {
  if (production) app.set('trust proxy', 1);
  const cookieOptions = { httpOnly: true, secure: production, sameSite: /** @type {const} */ ('lax'), path: '/', maxAge: SESSION_MS };
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: '尝试次数过多，请稍后再试' } });
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const expected = publicOrigin || `${req.protocol}://${req.get('host')}`;
    if (req.method !== 'GET' && (!isAllowedOrigin(req.get('origin'), expected) || !req.is('application/json'))) {
      res.status(403).json({ error: '请求来源或格式无效' }); return;
    }
    next();
  });
  /** @param {(req: import('express').Request, res: import('express').Response) => Promise<void>} handler */
  const route = (handler) => /** @type {import('express').RequestHandler} */ (async (req, res) => {
    try { await handler(req, res); }
    catch (error) {
      if (error instanceof AuthError) res.status(error.status).json({ error: error.message });
      else { console.error('Account request failed'); res.status(503).json({ error: '账号服务暂不可用，请稍后重试' }); }
    }
  });
  for (const action of /** @type {const} */ (['register', 'login'])) {
    app.post(`/api/auth/${action}`, limiter, route(async (req, res) => {
      const user = await auth[action](req.body);
      const session = await auth.issueSession(user.id);
      const previousKey = await auth.logout(req.headers.cookie);
      if (previousKey) {
        io.to(`auth:${previousKey}`).emit('auth-expired');
        io.in(`auth:${previousKey}`).disconnectSockets(true);
      }
      res.cookie(COOKIE, session.token, cookieOptions);
      res.status(action === 'register' ? 201 : 200).json({ user });
    }));
  }
  app.get('/api/auth/me', route(async (req, res) => {
    const session = await auth.authenticate(req.headers.cookie);
    res.json({ user: session?.user || null });
  }));
  app.post('/api/auth/logout', route(async (req, res) => {
    const key = await auth.logout(req.headers.cookie);
    if (key) {
      io.to(`auth:${key}`).emit('auth-expired');
      io.in(`auth:${key}`).disconnectSockets(true);
    }
    res.clearCookie(COOKIE, { ...cookieOptions, maxAge: undefined });
    res.json({ success: true });
  }));
  app.get('/api/rooms', route(async (req, res) => {
    const session = await auth.authenticate(req.headers.cookie);
    if (!session) { res.status(401).json({ error: '请先登录' }); return; }
    const query = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase().slice(0, 64) : '';
    const availableOnly = req.query.available === 'true';
    const summaries = [...rooms.values()].map(room => {
      const ownSeat = room.players.find((/** @type {any} */ player) => player.sessionId === session.user.id);
      const rejoinable = !!ownSeat && !ownSeat.leftRoom;
      return { id: room.id, host: room.players[0]?.name || '', playerCount: room.players.length, capacity: 4,
        state: room.state, baseScore: room.settlementSettings.baseScore, levelScore: room.settlementSettings.levelScore,
        rejoinable, joinable: rejoinable || (!ownSeat && room.state === 'waiting' && room.players.length < 4) };
    }).filter(room => (!query || room.id.includes(query) || room.host.toLowerCase().includes(query)) && (!availableOnly || room.joinable));
    summaries.sort((a, b) => Number(b.rejoinable) - Number(a.rejoinable) || Number(b.joinable) - Number(a.joinable) || a.id.localeCompare(b.id));
    const page = Math.max(1, Math.min(100000, Number.parseInt(String(req.query.page), 10) || 1));
    res.json({ rooms: summaries.slice((page - 1) * 20, page * 20), total: summaries.length, page, pageSize: 20 });
  }));

  io.use(async (socket, next) => {
    try {
      const expected = publicOrigin || `http://${socket.handshake.headers.host}`;
      if (!isAllowedOrigin(socket.handshake.headers.origin, expected)) { next(new Error('AUTH_REQUIRED')); return; }
      const session = await auth.authenticate(socket.handshake.headers.cookie);
      if (!session) { next(new Error('AUTH_REQUIRED')); return; }
      socket.data.user = session.user;
      socket.data.expiresAt = session.expiresAt;
      socket.join(`auth:${session.sessionKey}`);
      const timer = setTimeout(() => { socket.emit('auth-expired'); socket.disconnect(true); }, session.expiresAt - Date.now());
      timer.unref();
      socket.on('disconnect', () => clearTimeout(timer));
      socket.use((_packet, done) => {
        if (Date.now() >= session.expiresAt) { done(new Error('AUTH_REQUIRED')); socket.disconnect(true); }
        else done();
      });
      next();
    } catch { next(new Error('AUTH_UNAVAILABLE')); }
  });
}

module.exports = { installAccountRoutes };
