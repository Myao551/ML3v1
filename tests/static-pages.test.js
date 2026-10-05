const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

function getHomeScreen() {
  const start = html.indexOf('<div id="home-screen"');
  assert.notEqual(start, -1, 'home-screen should exist');

  const end = html.indexOf('<div id="rules-modal"', start + 1);
  assert.notEqual(end, -1, 'rules-modal should exist after home-screen');
  return html.slice(start, end);
}

test('login, registration and the searchable lobby are separate screens', () => {
  const homeScreen = getHomeScreen();

  assert.match(html, /id="login-screen"/);
  assert.match(html, /id="register-screen"/);
  assert.doesNotMatch(homeScreen, /id="login-form"|id="register-form"/);
  assert.match(homeScreen, /id="create-room-btn"/);
  assert.match(homeScreen, /id="join-room-btn"/);
  assert.match(homeScreen, /id="room-list"/);
  assert.match(homeScreen, /id="room-search"/);
  assert.match(homeScreen, /id="available-rooms"/);
  assert.match(html, /autocomplete="current-password"/);
  assert.match(html, /autocomplete="new-password"/);
  assert.match(html, /<script type="module" src="game\.js"><\/script>/);
});

test('room and result screens offer exit with an accessible confirmation dialog', () => {
  assert.match(html, /id="leave-room-btn"[^>]*aria-label="退出房间"/);
  assert.match(html, /id="result-leave-btn"/);
  assert.match(html, /id="leave-room-modal"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(html, /id="cancel-leave-btn"/);
  assert.match(html, /id="confirm-leave-btn"/);
  assert.ok(fs.existsSync(path.join(__dirname, '../public/assets/icons/log-out.svg')));
});
