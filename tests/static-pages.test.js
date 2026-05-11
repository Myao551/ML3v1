const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

function extractBetween(startId, endId) {
  const start = html.indexOf(`<div id="${startId}"`);
  assert.notEqual(start, -1, `${startId} should exist`);

  const end = html.indexOf(`<div id="${endId}"`, start + 1);
  assert.notEqual(end, -1, `${endId} should exist after ${startId}`);
  return html.slice(start, end);
}

test('login, register, and room entry are separate screens', () => {
  const loginScreen = extractBetween('login-screen', 'register-screen');
  const registerScreen = extractBetween('register-screen', 'home-screen');
  const homeScreen = extractBetween('home-screen', 'rules-modal');

  assert.match(loginScreen, /id="login-submit-btn"/);
  assert.match(registerScreen, /id="register-submit-btn"/);
  assert.match(homeScreen, /id="create-room-btn"/);
  assert.match(homeScreen, /id="join-room-btn"/);
  assert.doesNotMatch(homeScreen, /id="auth-panel"/);
  assert.doesNotMatch(homeScreen, /id="login-submit-btn"/);
  assert.doesNotMatch(homeScreen, /id="register-submit-btn"/);
  assert.match(html, /<script type="module" src="game\.js"><\/script>/);
});
