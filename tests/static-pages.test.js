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

test('room entry is available without login or registration screens', () => {
  const homeScreen = getHomeScreen();

  assert.doesNotMatch(html, /id="login-screen"/);
  assert.doesNotMatch(html, /id="register-screen"/);
  assert.doesNotMatch(html, /id="login-submit-btn"/);
  assert.doesNotMatch(html, /id="register-submit-btn"/);
  assert.match(homeScreen, /id="create-room-btn"/);
  assert.match(homeScreen, /id="join-room-btn"/);
  assert.match(homeScreen, /id="player-name"/);
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
