const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { Server } = require('socket.io');
const client = require('socket.io-client').io;
const { newDb } = require('pg-mem');
const { openAccountStore } = require('../src/auth/store');
const { createAuthService, COOKIE } = require('../src/auth/service');
const { installAccountRoutes } = require('../src/http/account-routes');

const input = { username: 'Alice_01', displayName: 'Alice', password: 'Example-password-123' };

for (const driver of ['sqlite', 'postgres']) {
  test(`${driver}: validation, uniqueness, salted hashes, sessions and logout`, async t => {
    const options = driver === 'postgres' ? { pool: new (newDb().adapters.createPg().Pool)() } : { sqlitePath: ':memory:' };
    const store = await openAccountStore(options); t.after(() => store.close());
    const auth = await createAuthService(store);
    const user = await auth.register(input);
    assert.equal(user.username, 'alice_01'); assert.equal(user.passwordHash, undefined);
    const saved = await store.findUser(user.username);
    assert.ok(saved.password_hash.startsWith('scrypt:'));
    assert.ok(!saved.password_hash.includes(input.password));
    assert.deepEqual(await auth.login({ username: 'ALICE_01', password: input.password }), user);
    await assert.rejects(auth.register(input), error => error.status === 409);
    await assert.rejects(auth.register({ ...input, username: 'different' }), error => error.status === 409);
    await assert.rejects(auth.register({ ...input, username: '../bad' }), error => error.status === 400);
    await assert.rejects(auth.register({ ...input, password: 'short' }), error => error.status === 400);
    await assert.rejects(auth.login({ username: 'unknown', password: input.password }), error => error.status === 401);
    await assert.rejects(auth.login({ username: input.username, password: 'wrong' }), error => error.status === 401);
    const second = await auth.register({ ...input, username: 'bob_01', displayName: 'Bob' });
    assert.notEqual((await store.findUser(second.username)).password_hash, saved.password_hash);
    const session = await auth.issueSession(user.id);
    const cookie = `${COOKIE}=${session.token}`;
    assert.deepEqual((await auth.authenticate(cookie)).user, user);
    assert.equal(await auth.authenticate(`${COOKIE}=malformed`), null);
    await auth.logout(cookie);
    assert.equal(await auth.authenticate(cookie), null);
    await store.createSession('expired', user.id, Date.now() - 1000);
    assert.equal(await store.getSession('expired'), undefined);
  });
}

test('accounts and session cookies survive closing and reopening the local database', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sanda1-account-test-'));
  const sqlitePath = path.join(directory, 'accounts.sqlite');
  let store = await openAccountStore({ sqlitePath });
  t.after(async () => {
    await store.close();
    const target = fs.realpathSync(directory);
    assert.ok(target.toLowerCase().startsWith((fs.realpathSync(os.tmpdir()) + path.sep + 'sanda1-account-test-').toLowerCase()));
    fs.rmSync(target, { recursive: true, force: true });
  });
  let auth = await createAuthService(store);
  const user = await auth.register(input);
  const session = await auth.issueSession(user.id);
  await store.close();
  store = await openAccountStore({ sqlitePath });
  auth = await createAuthService(store);
  assert.deepEqual(await auth.login(input), user);
  assert.equal((await auth.authenticate(`${COOKIE}=${session.token}`)).user.id, user.id);
});

test('production refuses ephemeral account storage', async () => {
  await assert.rejects(openAccountStore({ production: true }), /DATABASE_URL/);
});

async function httpHarness(t, production = false) {
  const store = await openAccountStore({ sqlitePath: ':memory:' });
  const auth = await createAuthService(store);
  const app = express(); app.use(express.json());
  const server = http.createServer(app); const io = new Server(server); const rooms = new Map();
  installAccountRoutes({ app, io, auth, rooms, production, publicOrigin: production ? 'https://game.example' : undefined });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => io.close(resolve)); await store.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function request(route, { body, cookie, headers = {} } = {}) {
    const response = await fetch(origin + route, { method: body ? 'POST' : 'GET', headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie'), headers: response.headers };
  }
  return { request, origin, rooms, io };
}

test('HTTP auth uses private cookies, rejects cross-origin writes, and revokes live sockets on logout', async t => {
  const h = await httpHarness(t);
  assert.equal((await h.request('/api/rooms')).status, 401);
  assert.equal((await h.request('/api/auth/register', { body: input, headers: { Origin: 'https://attacker.example' } })).status, 403);
  const registered = await h.request('/api/auth/register', { body: input });
  assert.equal(registered.status, 201);
  assert.match(registered.cookie, /HttpOnly/); assert.match(registered.cookie, /SameSite=Lax/);
  assert.equal(registered.headers.get('cache-control'), 'no-store');
  const cookie = registered.cookie.split(';')[0];
  assert.equal((await h.request('/api/auth/me', { cookie })).body.user.username, 'alice_01');
  const socket = client(h.origin, { transports: ['websocket'], extraHeaders: { Cookie: cookie }, reconnection: false });
  t.after(() => socket.disconnect());
  await new Promise((resolve, reject) => { socket.on('connect', resolve); socket.on('connect_error', reject); });
  const lost = new Promise(resolve => socket.on('auth-expired', resolve));
  assert.equal((await h.request('/api/auth/logout', { body: {}, cookie })).status, 200);
  await lost;
  assert.equal((await h.request('/api/auth/me', { cookie })).body.user, null);
  const unauthorized = client(h.origin, { transports: ['websocket'], reconnection: false });
  t.after(() => unauthorized.disconnect());
  const failure = await new Promise(resolve => unauthorized.on('connect_error', resolve));
  assert.equal(failure.message, 'AUTH_REQUIRED');
});

test('logging in rotates the current cookie and notifies its existing game connections', { timeout: 10000 }, async t => {
  const h = await httpHarness(t);
  const registered = await h.request('/api/auth/register', { body: input });
  const cookie = registered.cookie.split(';')[0];
  const socket = client(h.origin, { transports: ['websocket'], extraHeaders: { Cookie: cookie }, reconnection: false });
  t.after(() => socket.disconnect());
  await new Promise((resolve, reject) => { socket.on('connect', resolve); socket.on('connect_error', reject); });
  const lost = new Promise(resolve => socket.once('auth-expired', resolve));
  const login = await h.request('/api/auth/login', { body: input, cookie });
  assert.equal(login.status, 200);
  await lost;
  assert.equal((await h.request('/api/auth/me', { cookie })).body.user, null);
  assert.equal((await h.request('/api/auth/me', { cookie: login.cookie.split(';')[0] })).body.user.id, registered.body.user.id);
});

test('lobby searches and paginates public room summaries without hands or account identifiers', async t => {
  const h = await httpHarness(t);
  const registered = await h.request('/api/auth/register', { body: input });
  const cookie = registered.cookie.split(';')[0];
  for (let i = 0; i < 24; i++) h.rooms.set(`room-${i}`, {
    id: `room-${i}`, state: i === 1 ? 'playing' : 'waiting', settlementSettings: { baseScore: 1, levelScore: 2 },
    players: [{ name: i === 0 ? 'Alice' : `Host ${i}`, sessionId: i === 0 ? registered.body.user.id : `private-${i}`, hand: ['secret'] }]
  });
  let result = await h.request('/api/rooms', { cookie });
  assert.equal(result.body.total, 24); assert.equal(result.body.rooms.length, 20);
  assert.equal(result.body.rooms[0].rejoinable, true);
  assert.equal(JSON.stringify(result.body).includes('private-'), false);
  assert.equal(JSON.stringify(result.body).includes('secret'), false);
  result = await h.request('/api/rooms?q=ALICE', { cookie });
  assert.equal(result.body.total, 1);
  result = await h.request('/api/rooms?q=room-1&available=true', { cookie });
  assert.equal(result.body.rooms.some(room => room.id === 'room-1'), false);
  result = await h.request('/api/rooms?page=2', { cookie }); assert.equal(result.body.rooms.length, 4);
  result = await h.request('/api/rooms?q=missing', { cookie }); assert.equal(result.body.total, 0);
});

test('production cookies are Secure and repeated login attempts are rate limited', async t => {
  const h = await httpHarness(t, true);
  const result = await h.request('/api/auth/register', { body: input, headers: { Origin: 'https://game.example' } });
  assert.match(result.cookie, /Secure/);
  for (let attempt = 0; attempt < 19; attempt++) await h.request('/api/auth/login', { body: { username: '!', password: 'wrong' } });
  assert.equal((await h.request('/api/auth/login', { body: input })).status, 429);
});
