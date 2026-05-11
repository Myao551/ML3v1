const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { UserStore, validateCredentials } = require('../auth-store');

function createStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanda-auth-'));
  return new UserStore({ filePath: path.join(dir, 'users.json') });
}

test('validateCredentials rejects invalid usernames and weak passwords', () => {
  assert.equal(validateCredentials('', 'password123').valid, false);
  assert.equal(validateCredentials('a', 'password123').valid, false);
  assert.equal(validateCredentials('valid-user', 'short').valid, false);
  assert.equal(validateCredentials('valid-user', 'password123').valid, true);
});

test('register creates a user without storing the plain password', () => {
  const store = createStore();
  const result = store.register('PlayerOne', 'password123');

  assert.equal(result.success, true);
  assert.equal(result.user.username, 'PlayerOne');
  assert.equal(result.user.passwordHash, undefined);

  const saved = JSON.parse(fs.readFileSync(store.filePath, 'utf8'));
  assert.equal(saved.users[0].username, 'PlayerOne');
  assert.notEqual(saved.users[0].passwordHash, 'password123');
  assert.match(saved.users[0].passwordHash, /^scrypt:/);
});

test('register prevents duplicate usernames case-insensitively', () => {
  const store = createStore();
  assert.equal(store.register('PlayerOne', 'password123').success, true);

  const duplicate = store.register('playerone', 'password123');

  assert.equal(duplicate.success, false);
  assert.equal(duplicate.code, 'USERNAME_TAKEN');
});

test('authenticate accepts the correct password and rejects wrong credentials', () => {
  const store = createStore();
  store.register('PlayerOne', 'password123');

  assert.equal(store.authenticate('PlayerOne', 'bad-password').success, false);
  assert.equal(store.authenticate('missing', 'password123').success, false);

  const result = store.authenticate('playerone', 'password123');
  assert.equal(result.success, true);
  assert.equal(result.user.username, 'PlayerOne');
});

test('sessions can be created, resolved, and revoked', () => {
  const store = createStore();
  const registered = store.register('PlayerOne', 'password123');

  const session = store.createSession(registered.user.id);

  assert.equal(typeof session.token, 'string');
  assert.ok(session.token.length >= 32);
  assert.equal(store.getSessionUser(session.token).username, 'PlayerOne');

  store.deleteSession(session.token);
  assert.equal(store.getSessionUser(session.token), null);
});
