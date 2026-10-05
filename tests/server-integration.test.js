const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { io } = require('socket.io-client');

async function start(sqlitePath) {
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), windowsHide: true,
    env: { ...process.env, NODE_ENV: 'development', PORT: '0', SQLITE_PATH: sqlitePath, DATABASE_URL: '', PUBLIC_ORIGIN: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const origin = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Server startup timed out')); }, 10000);
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited: ${code}`)); });
    child.stdout.on('data', chunk => {
      const match = /Server running on port (\d+)/.exec(String(chunk));
      if (match) { clearTimeout(timeout); resolve(`http://127.0.0.1:${match[1]}`); }
    });
  });
  return { origin, async stop() { if (child.exitCode !== null) return; const exit = once(child, 'exit'); child.kill(); await exit; } };
}

function event(socket, name, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(name, handler); reject(new Error(`Socket event timed out: ${name}`)); }, 5000);
    const handler = value => { if (predicate(value)) { clearTimeout(timer); socket.off(name, handler); resolve(value); } };
    socket.on(name, handler);
  });
}
const ack = (socket, name, ...args) => new Promise((resolve, reject) => {
  socket.timeout(5000).emit(name, ...args, (error, response) => error ? reject(error) : resolve(response));
});

test('real server persists accounts across restart and authorizes four-player rooms and reconnects', { timeout: 30000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sanda1-server-test-'));
  let server; const sockets = [];
  t.after(async () => {
    sockets.forEach(socket => socket.disconnect());
    await server?.stop();
    const target = fs.realpathSync(directory);
    assert.ok(target.toLowerCase().startsWith((fs.realpathSync(os.tmpdir()) + path.sep + 'sanda1-server-test-').toLowerCase()));
    fs.rmSync(target, { recursive: true, force: true });
  });
  server = await start(path.join(directory, 'accounts.sqlite'));
  async function request(route, body, cookie) {
    const response = await fetch(server.origin + route, { method: body ? 'POST' : 'GET',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.ok(response.ok, `HTTP ${response.status} on ${route}`);
    return { data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const users = [];
  for (let i = 0; i < 4; i++) users.push(await request('/api/auth/register', { username: `player_${i}`, displayName: `Player ${i}`, password: 'integration-password' }));
  const oldUserId = users[0].data.user.id;
  await server.stop(); server = await start(path.join(directory, 'accounts.sqlite'));
  assert.equal((await request('/api/auth/me', undefined, users[0].cookie)).data.user.id, oldUserId);
  assert.equal((await request('/api/auth/login', { username: 'PLAYER_0', password: 'integration-password' })).data.user.id, oldUserId);
  // Login rotates only the presented cookie; this independent login leaves the original device session usable.
  for (const user of users) {
    const socket = io(server.origin, { transports: ['websocket'], extraHeaders: { Cookie: user.cookie }, autoConnect: false });
    sockets.push(socket);
    const connected = event(socket, 'connect'); socket.connect(); await connected;
  }
  const room = await ack(sockets[0], 'create-room', { name: 'FORGED', sessionId: 'forged' });
  assert.equal(room.success, true);
  const denied = await ack(sockets[1], 'rejoin-room', { roomId: room.roomId, sessionId: oldUserId });
  assert.equal(denied.success, false);
  assert.equal((await ack(sockets[1], 'quick-join')).roomId, room.roomId);
  for (let i = 2; i < 4; i++) assert.equal((await ack(sockets[i], 'join-room', room.roomId, { name: 'FORGED', sessionId: oldUserId })).success, true);
  const listing = (await request('/api/rooms', undefined, users[0].cookie)).data;
  assert.equal(listing.rooms[0].host, 'Player 0'); assert.equal(listing.rooms[0].playerCount, 4);
  const dealt = event(sockets[3], 'deal-cards');
  sockets.forEach(socket => socket.emit('player-ready', true));
  const hand = await dealt; assert.equal(hand.length, 25);
  const oldSocketId = sockets[3].id;
  const connected = event(sockets[3], 'connect'); sockets[3].io.engine.close(); await connected;
  const restoredHand = event(sockets[3], 'hand-sorted');
  const restored = await ack(sockets[3], 'quick-join');
  assert.equal(restored.success, true); assert.notEqual(restored.playerId, oldSocketId);
  assert.deepEqual(await restoredHand, hand);
  assert.equal((await ack(sockets[3], 'join-room', room.roomId, {})).success, true);
  assert.equal((await ack(sockets[3], 'leave-room', { roomId: room.roomId })).success, true);
  const newRoom = await ack(sockets[3], 'create-room', {}); assert.equal(newRoom.success, true);
  for (let i = 0; i < 3; i++) await ack(sockets[i], 'leave-room', { roomId: room.roomId });
  await ack(sockets[3], 'leave-room', { roomId: newRoom.roomId });
  assert.equal((await request('/api/rooms', undefined, users[0].cookie)).data.total, 0);
});
