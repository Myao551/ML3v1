const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createDeck, getCardValue } = require('../src/game/cards');
const { analyzePlay, doesPlayBeat, validatePlay, resolveCards, getAutoPlay } = require('../src/game/play-rules');
const { createRoom } = require('../src/game/rooms');
const { getRoomState } = require('../src/game/room-state');
const card = (suit, rank, id = `${suit}-${rank}-0`) => ({ suit, rank, id });
const pair = (suit, rank) => [card(suit, rank), card(suit, rank, `${suit}-${rank}-1`)];
function roomWith(hand, lead = [], trumpSuit = 'spades') {
  const room = createRoom('r');
  room.players = [{ hand }];
  room.trumpSuit = trumpSuit;
  room.isNoTrump = trumpSuit === null;
  room.currentRound = lead.length ? [{ cards: lead }] : [];
  return room;
}

// Execute the real server orchestration with deterministic transport and timers.
// Timer callbacks and socket actions still use the project's actual handlers.
function harness() {
  let time = 1000;
  const timers = new Map();
  let timerId = 0;
  const sockets = new Map();
  const broadcasts = [];
  let connection;
  const io = { on(event, handler) { if (event === 'connection') connection = handler; }, to(target) { return { emit(event, payload) { broadcasts.push({ target, event, payload: JSON.parse(JSON.stringify(payload ?? null)) }); } }; } };
  const express = () => ({ disable() {}, use() {} });
  express.json = express.static = () => () => {};
  const serverPath = path.join(__dirname, '..', 'server.js');
  const req = createRequire(serverPath);
  class ClockDate extends Date { static now() { return time; } }
  const context = vm.createContext({ console: { log() {} }, process: { env: {} }, __dirname: path.dirname(serverPath),
    Date: ClockDate,
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay, at: time + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    require(name) {
      if (name === 'express') return express;
      if (name === 'http') return { createServer() { return { listen() {} }; } };
      if (name === 'socket.io') return () => io;
      // Load handlers in the same VM so their timers are deterministic too.
      if (name.startsWith('./src/')) return load(path.join(path.dirname(serverPath), name + '.js'));
      return req(name);
    }
  });
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const localRequire = name => name.startsWith('.') ? load(path.resolve(path.dirname(filename), name) + '.js') : req(name);
    const fn = vm.runInContext(`(function(require,module,exports){${fs.readFileSync(filename, 'utf8')}\n})`, context);
    fn(localRequire, module, module.exports);
    return module.exports;
  }
  vm.runInContext(fs.readFileSync(serverPath, 'utf8'), context);
  const rooms = vm.runInContext('rooms', context);
  function connect(id, userId = id) {
    const handlers = {};
    const socket = { id, handlers, nsp: { sockets }, events: [], roomId: null,
      data: { user: { id: userId, displayName: /^s\d$/.test(userId) ? `P${userId.slice(1)}` : id } },
      on(event, handler) { handlers[event] = handler; }, join() {}, leave() {},
      emit(event, data) { this.events.push({ event, data }); },
      disconnect() { handlers.disconnect(); },
      send(event, ...args) { return handlers[event](...args); }
    };
    sockets.set(id, socket); connection(socket); return socket;
  }
  function fourPlayers() {
    const players = Array.from({ length: 4 }, (_, i) => connect(`p${i}`, `s${i}`));
    let roomId;
    players[0].send('create-room', { name: 'P0', sessionId: 's0' }, response => { roomId = response.roomId; });
    players.slice(1).forEach((socket, i) => socket.send('join-room', roomId, { name: `P${i + 1}`, sessionId: `s${i + 1}` }, () => {}));
    players.forEach(socket => socket.send('player-ready', true));
    return { players, room: rooms.get(roomId) };
  }
  function fire(id) { const timer = timers.get(id); assert.ok(timer, `timer ${id} exists`); timers.delete(id); time = Math.max(time, timer.at); timer.fn(); }
  return { context, rooms, timers, connect, fourPlayers, fire, broadcasts, run(code) { return vm.runInContext(code, context); } };
}

test('quick seat prefers fuller waiting rooms and resumes the authenticated seat', () => {
  const h = harness();
  const first = h.connect('first'); const second = h.connect('second');
  first.send('create-room', {}, () => {}); second.send('create-room', {}, () => {});
  h.connect('guest').send('join-room', second.roomId, {}, () => {});
  const joining = h.connect('joining');
  joining.send('quick-join', response => { assert.equal(response.success, true); assert.equal(response.roomId, second.roomId); });
  assert.equal(h.rooms.get(second.roomId).players.length, 3);
  const replacement = h.connect('replacement', 'joining');
  replacement.send('quick-join', response => { assert.equal(response.rejoined, true); assert.equal(response.roomId, second.roomId); });
  assert.equal(h.rooms.get(second.roomId).players.length, 3);
  assert.equal(joining.roomId, null);
});

test('quick seat rejects empty/full/active rooms but allows recovery of an active seat', () => {
  const h = harness(); const guest = h.connect('guest');
  guest.send('quick-join', response => assert.equal(response.success, false));
  const { players, room } = h.fourPlayers();
  guest.send('quick-join', response => assert.equal(response.success, false));
  const replacement = h.connect('replacement', 's0');
  replacement.send('quick-join', response => assert.equal(response.success, true));
  replacement.send('leave-room', { roomId: room.id }, () => {});
  replacement.send('quick-join', response => assert.equal(response.success, false));
  room.state = 'waiting';
  guest.send('quick-join', response => assert.equal(response.success, false));
  assert.equal(room.players.length, 4);
  assert.equal(players[0].roomId, null);
});

test('hints return only legal current-player card IDs and never mutate or broadcast a play', () => {
  const h = harness(); const { players, room } = h.fourPlayers();
  players[0].send('suggest-play', response => assert.equal(response.success, false));
  players[0].send('place-bid', 75);
  players[0].send('finish-exchange', room.players[0].hand.slice(0, 8).map(c => c.id));
  players[0].send('choose-trump', null, true);
  h.connect('outsider').send('suggest-play', response => assert.equal(response.success, false));
  players[1].send('suggest-play', response => assert.equal(response.success, false));
  const before = JSON.stringify(room.players.map(p => p.hand)); const emitted = h.broadcasts.length;
  let hint;
  players[0].send('suggest-play', response => { hint = response; });
  assert.equal(hint.success, true);
  assert.equal(validatePlay(room, resolveCards(room.players[0].hand, hint.cardIds), 0).valid, true);
  assert.equal(JSON.stringify(room.players.map(p => p.hand)), before);
  assert.equal(h.broadcasts.length, emitted);
  assert.equal(room.currentRound.length, 0);
  players[0].send('play-cards', hint.cardIds);
  players[1].send('suggest-play', response => {
    assert.equal(response.success, true);
    assert.equal(validatePlay(room, resolveCards(room.players[1].hand, response.cardIds), 1).valid, true);
  });
  room.roundResolving = true;
  players[1].send('suggest-play', response => assert.equal(response.success, false));
});

test('authoritative faces replace forged play and bottom payloads', () => {
  const original = card('hearts', '3');
  assert.deepEqual(resolveCards([original], [{ id: original.id, suit: 'joker', rank: 'big' }]), [original]);
  assert.equal(resolveCards([original], [original.id, original.id]), null);
  const h = harness(); const { players, room } = h.fourPlayers();
  players[0].send('place-bid', 75);
  const expected = room.players[0].hand.slice(0, 8).map(c => ({ ...c }));
  players[0].send('finish-exchange', expected.map(c => ({ ...c, rank: 'big', suit: 'joker' })));
  assert.equal(JSON.stringify(room.bottomCards), JSON.stringify(expected));
});

test('lead rejects throws; single, pair and tractor remain legal', () => {
  const hand = [...pair('spades', '5'), ...pair('spades', '6'), card('spades', 'A')];
  const room = roomWith(hand);
  assert.equal(validatePlay(room, [hand[0], hand[4]], 0).valid, false);
  for (const cards of [[hand[0]], hand.slice(0, 2), hand.slice(0, 4)]) assert.equal(validatePlay(room, cards, 0).valid, true);
});

test('no-trump 2/7/jokers form consecutive pair ranks and equal side trumps tie', () => {
  const cards = [...pair('hearts', '2'), ...pair('clubs', '7'), ...pair('joker', 'small'), ...pair('joker', 'big')];
  assert.equal(analyzePlay(cards, null, true).type, 'tractor');
  assert.equal(analyzePlay(cards, null, true).tractorLength, 4);
  assert.equal(getCardValue(card('hearts', '2'), null, true), getCardValue(card('clubs', '2'), null, true));
  const lead = [card('clubs', '7')];
  assert.equal(doesPlayBeat({ cards: [card('spades', '7')] }, { cards: lead }, analyzePlay(lead, null, true), null, true), false);
});

test('follow tractor must exhaust available pairs and retain longest required run', () => {
  const lead = [...pair('hearts', '3'), ...pair('hearts', '4')];
  const hand = [...pair('hearts', '8'), ...pair('hearts', 'J'), card('hearts', 'K'), card('hearts', 'A')];
  assert.equal(validatePlay(roomWith(hand, lead), [hand[0], hand[1], hand[4], hand[5]], 0).valid, false);
  const longLead = [...pair('spades', '3'), ...pair('spades', '4'), ...pair('spades', '5')];
  const trumps = [...pair('spades', 'A'), ...pair('hearts', '2'), ...pair('clubs', '2'), ...pair('spades', '2'), ...pair('spades', '8')];
  const room = roomWith(trumps, longLead);
  assert.equal(validatePlay(room, [...pair('spades', 'A'), ...pair('hearts', '2'), ...pair('spades', '8')], 0).valid, false);
  assert.equal(validatePlay(room, getAutoPlay(room, 0), 0).valid, true);
});

test('short suits can mix discards; void players can discard unmatched trumps without winning', () => {
  const lead = pair('hearts', 'A');
  const hand = [card('hearts', '3'), card('clubs', '4')];
  assert.equal(validatePlay(roomWith(hand, lead), hand, 0).valid, true);
  const trumps = [...pair('spades', '5'), card('spades', '6')];
  const played = [trumps[0], trumps[2]];
  assert.equal(validatePlay(roomWith(trumps, lead), played, 0).valid, true);
  assert.equal(doesPlayBeat({ cards: played }, { cards: lead }, analyzePlay(lead, 'spades', false), 'spades', false), false);
});

test('three passes then 100 makes the sole bidder dealer immediately', () => {
  const h = harness(); const { players, room } = h.fourPlayers();
  players.slice(0, 3).forEach(s => s.send('place-bid', 'pass'));
  players[3].send('place-bid', 100);
  assert.equal(room.dealer, 3); assert.equal(room.state, 'exchanging'); assert.equal(room.players[3].hand.length, 33);
});

test('ready events during a game cannot redeal; invalid trump is rejected', () => {
  const h = harness(); const { players, room } = h.fourPlayers();
  const original = JSON.stringify(room.players.map(p => p.hand));
  players.forEach(s => s.send('player-ready', true));
  assert.equal(JSON.stringify(room.players.map(p => p.hand)), original);
  players[0].send('place-bid', 75);
  players[0].send('finish-exchange', room.players[0].hand.slice(0, 8).map(c => c.id));
  players[0].send('choose-trump', 'invalid', false);
  assert.equal(room.state, 'choosing-trump');
});

test('room snapshot restores current trick and early-finish voting', () => {
  const room = createRoom('r'); room.currentRound = [{ player: 0, cards: [card('hearts', '5')] }];
  room.earlyFinishOffered = true; room.earlyFinishVotes.add(2);
  const snapshot = getRoomState(room);
  assert.deepEqual(snapshot.currentRound, room.currentRound);
  assert.deepEqual(snapshot.earlyFinishVoters, [2]);
});

test('repeat create cannot leak rooms; replacing a socket detaches the old connection', () => {
  const h = harness(); const { players, room } = h.fourPlayers();
  players[0].send('create-room', { name: 'other' }, response => assert.equal(response.success, false));
  assert.equal(h.rooms.size, 1);
  const replacement = h.connect('replacement', 's0');
  replacement.send('rejoin-room', { roomId: room.id, sessionId: 's0' }, response => assert.equal(response.success, true));
  assert.equal(players[0].roomId, null);
  assert.equal(room.players[0].id, 'replacement');
  assert.equal(room.players[0].disconnected, false);
});

test('scheduled round settlement cannot run after early finish reset', () => {
  const h = harness(); const { players, room } = h.fourPlayers();
  players[0].send('place-bid', 75);
  players[0].send('finish-exchange', room.players[0].hand.slice(0, 8).map(c => c.id));
  players[0].send('choose-trump', null, true);
  for (let i = 0; i < 4; i++) players[room.currentPlayer].send('play-cards', getAutoPlay(room, room.currentPlayer).map(c => c.id));
  const oldCallback = h.timers.get(room.roundTimer).fn;
  room.scores.team = room.dealerScore;
  players.forEach(s => s.send('vote-end-game'));
  assert.equal(room.state, 'waiting');
  assert.doesNotThrow(oldCallback);
  assert.equal(room.state, 'waiting');
});

test('waiting leave releases a seat, preserves the next bidder and permits another room', () => {
  const h = harness(); const { players, room } = h.fourPlayers();
  room.nextBidder = 2;
  h.run(`resetRoomForNextGame(rooms.get('${room.id}'))`);
  players[1].send('leave-room', { roomId: room.id }, response => assert.equal(response.success, true));
  assert.equal(players[1].roomId, null);
  assert.equal(room.players.map(p => p.seat).join(','), '0,1,2');
  assert.equal(room.players[room.nextBidder].sessionId, 's2');
  assert.equal(room.currentBidder, 1);
  players[1].send('create-room', { name: 'P1', sessionId: 's1' }, response => assert.equal(response.success, true));
  const newRoomId = players[1].roomId;
  players[1].send('leave-room', { roomId: room.id }, response => assert.equal(response.success, false));
  assert.equal(players[1].roomId, newRoomId);
  const replacement = h.connect('replacement', 'new');
  replacement.send('join-room', room.id, { name: 'New', sessionId: 'new' }, response => assert.equal(response.success, true));
  assert.equal(room.players.length, 4);
});

test('leaving the final waiting seat deletes the room and all timers; leave is idempotent', () => {
  const h = harness(); const { players, room } = h.fourPlayers();
  h.run(`resetRoomForNextGame(rooms.get('${room.id}'))`);
  players.forEach(socket => socket.send('leave-room', { roomId: room.id }, response => assert.equal(response.success, true)));
  assert.equal(h.rooms.size, 0);
  assert.equal(h.timers.size, 0);
  players[0].send('leave-room', { roomId: room.id }, response => assert.equal(response.success, true));
});

test('active leave preserves seats, uses autoplay and never sends private cards to a new room', () => {
  const h = harness(); const { players, room } = h.fourPlayers();
  players[0].send('place-bid', 75);
  const handBefore = JSON.stringify(room.players[0].hand);
  players[0].send('leave-room', { roomId: room.id }, response => assert.equal(response.success, true));
  assert.equal(room.players.length, 4);
  assert.equal(JSON.stringify(room.players[0].hand), handBefore);
  assert.equal(getRoomState(room).players[0].leftRoom, true);
  assert.equal(h.timers.get(room.turnTimer).delay, 2000);
  assert.notEqual(room.players[0].id, players[0].id);
  players[0].send('finish-exchange', room.players[0].hand.slice(0, 8));
  assert.equal(room.state, 'exchanging');
  players[0].send('create-room', { name: 'P0', sessionId: 's0' }, response => assert.equal(response.success, true));
  const start = h.broadcasts.length;
  h.fire(room.turnTimer);
  assert.equal(room.state, 'choosing-trump');
  h.fire(room.turnTimer);
  assert.equal(room.state, 'playing');
  assert.equal(h.broadcasts.slice(start).some(event => event.target === players[0].id), false);
  let steps = 0;
  while (room.state === 'playing' && steps++ < 150) h.fire(room.roundResolving ? room.roundTimer : room.turnTimer);
  assert.equal(room.state, 'waiting');
  assert.equal(room.players.length, 3);
  assert.equal(room.players.map(p => p.sessionId).join(','), 's1,s2,s3');
  const ending = h.broadcasts.filter(event => event.event === 'game-end').at(-1).payload;
  assert.equal(ending.settlement.deltas.length, 4);
  assert.equal(h.rooms.size, 2);
});

test('explicit leavers cannot resume mid-game and all-pass cleanup advances to a remaining bidder', () => {
  const h = harness(); const { players, room } = h.fourPlayers();
  players[0].send('leave-room', { roomId: room.id }, () => {});
  const replacement = h.connect('replacement', 's0');
  replacement.send('rejoin-room', { roomId: room.id, sessionId: 's0' }, response => assert.equal(response.success, false));
  replacement.send('join-room', room.id, { name: 'P0', sessionId: 's0' }, response => assert.equal(response.success, false));
  h.fire(room.turnTimer);
  players.slice(1).forEach(socket => socket.send('place-bid', 'pass'));
  assert.equal(room.state, 'waiting');
  assert.equal(room.players.length, 3);
  assert.equal(room.players[room.nextBidder].sessionId, 's1');
  replacement.send('join-room', room.id, { name: 'P0', sessionId: 's0' }, response => assert.equal(response.success, true));
  assert.equal(room.players.length, 4);
});

test('all active players leaving deletes the room including pending round settlement', () => {
  const h = harness(); const { players, room } = h.fourPlayers();
  players[0].send('place-bid', 75);
  players[0].send('finish-exchange', room.players[0].hand.slice(0, 8).map(card => card.id));
  h.fire(room.turnTimer);
  for (let i = 0; i < 4; i++) players[room.currentPlayer].send('play-cards', getAutoPlay(room, room.currentPlayer));
  assert.ok(room.roundTimer);
  const staleTurn = h.timers.get(room.roundTimer).fn;
  players.forEach(socket => socket.send('leave-room', { roomId: room.id }, () => {}));
  assert.equal(h.rooms.size, 0);
  assert.equal(h.timers.size, 0);
  assert.doesNotThrow(staleTurn);
});

test('leaving after peers disconnect retains their reconnect window but cleans up empty rooms', () => {
  const h = harness(); const { players, room } = h.fourPlayers();
  players.slice(1).forEach(socket => socket.disconnect());
  players[0].send('leave-room', { roomId: room.id }, () => {});
  assert.ok(h.timers.has(room.cleanupTimer));
  const replacement = h.connect('replacement', 's1');
  replacement.send('rejoin-room', { roomId: room.id, sessionId: 's1' }, response => assert.equal(response.success, true));
  assert.equal(room.cleanupTimer, null);
  replacement.disconnect();
  h.fire(room.cleanupTimer);
  assert.equal(h.rooms.size, 0);
  assert.equal(h.timers.size, 0);
});

test('dealer win retains first bid, dealer loss rotates it', () => {
  const h = harness(); const { room } = h.fourPlayers();
  room.dealer = 2; room.dealerScore = 100; room.scores.team = 20;
  h.run(`endGame(rooms.get('${room.id}'))`);
  assert.equal(room.nextBidder, 2);
  room.dealer = 2; room.dealerScore = 100; room.scores.team = 100;
  h.run(`endGame(rooms.get('${room.id}'))`);
  assert.equal(room.nextBidder, 3);
});

test('timeout bids pass; disconnected exchange, trump and all 25 rounds complete automatically', () => {
  const h = harness(); const { players, room } = h.fourPlayers();
  h.fire(room.turnTimer); assert.equal(room.passedBidders.has(0), true);
  players[1].send('place-bid', 75);
  assert.equal(room.turnTimer, null);
  players[1].disconnect();
  h.fire(room.turnTimer); assert.equal(room.state, 'choosing-trump');
  h.fire(room.turnTimer); assert.equal(room.state, 'playing');
  let steps = 0;
  while (room.state === 'playing' && steps++ < 150) h.fire(room.roundResolving ? room.roundTimer : room.turnTimer);
  assert.equal(room.state, 'waiting');
  const ending = h.broadcasts.filter(e => e.event === 'game-end').at(-1).payload;
  assert.equal(ending.settlement.deltas.reduce((sum, value) => sum + value, 0), 0);
  assert.equal(h.broadcasts.filter(e => e.event === 'cards-played').length, 100);
});

test('disconnect shortens turn to 2 seconds, reconnect keeps deadline without extending it', () => {
  const h = harness(); const { players, room } = h.fourPlayers();
  players[0].disconnect();
  assert.equal(h.timers.get(room.turnTimer).delay, 2000);
  const deadline = room.deadline;
  const replacement = h.connect('new', 's0');
  replacement.send('rejoin-room', { roomId: room.id, sessionId: 's0' }, () => {});
  assert.equal(room.deadline, deadline);
});

test('connected dealer has no burial deadline, including after rescheduling', () => {
  const h = harness(); const { players, room } = h.fourPlayers();
  const oldBidTimer = h.timers.get(room.turnTimer).fn;
  players[0].send('place-bid', 75);
  const handBefore = JSON.stringify(room.players[0].hand);
  assert.equal(room.state, 'exchanging');
  assert.equal(room.deadline, null);
  assert.equal(room.turnTimer, null);
  assert.equal(h.timers.size, 0);
  oldBidTimer();
  h.run(`scheduleTurn(rooms.get('${room.id}'))`);
  assert.equal(room.turnTimer, null);
  assert.equal(JSON.stringify(room.players[0].hand), handBefore);
  assert.equal(h.broadcasts.filter(event => event.event === 'turn-clock').at(-1).payload.deadline, null);
  players[0].send('finish-exchange', room.players[0].hand.slice(0, 8).map(card => card.id));
  assert.equal(room.state, 'choosing-trump');
  assert.equal(h.timers.get(room.turnTimer).delay, 20000);
});

test('dealer reconnect cancels automatic burial and stale callbacks cannot bury cards', () => {
  const h = harness(); const { players, room } = h.fourPlayers();
  players[0].send('place-bid', 75);
  players[0].disconnect();
  const timerId = room.turnTimer;
  assert.equal(h.timers.get(timerId).delay, 2000);
  const automaticBurial = h.timers.get(timerId).fn;
  const replacement = h.connect('restored-dealer', 's0');
  replacement.send('rejoin-room', { roomId: room.id, sessionId: 's0' }, response => assert.equal(response.success, true));
  assert.equal(room.deadline, null);
  assert.equal(room.turnTimer, null);
  assert.equal(h.timers.has(timerId), false);
  automaticBurial();
  assert.equal(room.state, 'exchanging');
  assert.equal(room.players[0].hand.length, 33);
  replacement.send('finish-exchange', room.players[0].hand.slice(0, 8).map(card => card.id));
  assert.equal(room.state, 'choosing-trump');
});

for (const phase of ['waiting', 'bidding', 'exchanging', 'choosing-trump', 'playing', 'round-resolving']) {
  test(`reconnect restores all four seats in ${phase} without redealing or leaking private cards`, () => {
    const h = harness(); const { players, room } = h.fourPlayers();
    if (phase === 'waiting') h.run(`resetRoomForNextGame(rooms.get('${room.id}'))`);
    if (!['waiting', 'bidding'].includes(phase)) players[0].send('place-bid', 75);
    if (['choosing-trump', 'playing', 'round-resolving'].includes(phase)) players[0].send('finish-exchange', room.players[0].hand.slice(0, 8).map(card => card.id));
    if (['playing', 'round-resolving'].includes(phase)) h.fire(room.turnTimer);
    if (phase === 'playing') {
      players[0].send('play-cards', getAutoPlay(room, 0));
      room.earlyFinishOffered = true; room.earlyFinishVotes.add(2);
    }
    if (phase === 'round-resolving') {
      for (let i = 0; i < 4; i++) players[room.currentPlayer].send('play-cards', getAutoPlay(room, room.currentPlayer));
    }
    const expectedHands = JSON.stringify(room.players.map(player => player.hand));
    for (let index = 0; index < 4; index += 1) {
      players[index].disconnect();
      const removalTimer = room.players[index].disconnectTimer;
      const deadline = room.deadline;
      const fresh = h.connect(`restored-${index}`, `s${index}`);
      fresh.send('rejoin-room', { roomId: room.id, sessionId: `s${index}` }, response => {
        assert.equal(response.success, true);
        assert.equal(response.playerId, fresh.id);
      });
      assert.equal(room.players.length, 4);
      assert.equal(room.players[index].seat, index);
      assert.equal(room.players[index].disconnected, false);
      assert.equal(h.timers.has(removalTimer), false);
      assert.equal(room.deadline, phase === 'exchanging' ? null : deadline);
      assert.equal(JSON.stringify(room.players.map(player => player.hand)), expectedHands);
      const snapshot = fresh.events.find(event => event.event === 'room-update').data;
      assert.equal(snapshot.state, room.state);
      assert.equal(JSON.stringify(snapshot.currentRound), JSON.stringify(room.currentRound));
      assert.equal(snapshot.players.some(player => 'hand' in player || 'sessionId' in player), false);
      const hand = fresh.events.find(event => event.event === 'hand-sorted');
      if (phase !== 'waiting') assert.equal(JSON.stringify(hand.data), JSON.stringify(room.players[index].hand));
      const hasEvent = name => fresh.events.some(event => event.event === name);
      assert.equal(hasEvent('exchange-cards'), phase === 'exchanging' && index === 0);
      assert.equal(hasEvent('choose-trump-request'), phase === 'choosing-trump' && index === 0);
      if (phase === 'bidding') assert.ok(hasEvent('bid-update'));
      if (phase === 'playing') assert.equal(snapshot.earlyFinishVoters.join(','), '2');
      if (phase === 'round-resolving') assert.equal(snapshot.roundResolving, true);
    }
  });
}

test('waiting disconnect expires after 60 seconds but an active seat survives that timeout', () => {
  const h = harness(); const { players, room } = h.fourPlayers();
  players[1].disconnect();
  h.fire(room.players[1].disconnectTimer);
  assert.equal(room.players.length, 4);
  assert.ok(h.timers.has(room.players[1].disconnectTimer));
  h.run(`resetRoomForNextGame(rooms.get('${room.id}'))`);
  h.fire(room.players[1].disconnectTimer);
  assert.equal(room.players.length, 3);
  assert.equal(room.players.some(player => player.sessionId === 's1'), false);
  const replacement = h.connect('expired', 's1');
  replacement.send('rejoin-room', { roomId: room.id, sessionId: 's1' }, response => assert.equal(response.success, false));
});

test('refresh join restores a full active room by session and rejects unknown sessions', () => {
  const h = harness(); const { players, room } = h.fourPlayers();
  players[2].disconnect();
  const fresh = h.connect('refresh', 's2');
  fresh.send('join-room', room.id, { name: 'P2', sessionId: 's2' }, response => {
    assert.equal(response.success, true); assert.equal(response.rejoined, true);
  });
  assert.equal(room.players.length, 4);
  assert.equal(room.players[2].id, fresh.id);
  const stranger = h.connect('stranger');
  stranger.send('rejoin-room', { roomId: room.id, sessionId: 'unknown' }, response => assert.equal(response.success, false));
  stranger.send('rejoin-room', { roomId: 'missing', sessionId: 's2' }, response => assert.equal(response.success, false));
  assert.equal(stranger.events.some(event => event.event === 'hand-sorted'), false);
});

test('seeded legal fallback property: valid unique cards and preserved hand across 1000 cases', () => {
  let seed = 7343; const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  const deck = createDeck();
  for (let i = 0; i < 1000; i++) {
    const cards = [...deck]; for (let j = cards.length - 1; j > 0; j--) { const k = Math.floor(random() * (j + 1)); [cards[j], cards[k]] = [cards[k], cards[j]]; }
    const hand = cards.slice(0, 25);
    const lead = i % 3 === 0 ? [card('hearts', 'A', 'lead')] : i % 3 === 1 ? pair('hearts', 'A') : [...pair('hearts', '3'), ...pair('hearts', '4'), ...pair('hearts', '5')];
    const room = roomWith(hand, lead, i % 5 === 0 ? null : 'spades');
    const before = JSON.stringify(hand); const result = getAutoPlay(room, 0);
    assert.equal(validatePlay(room, result, 0).valid, true, `seeded case ${i}`);
    assert.equal(new Set(result.map(c => c.id)).size, result.length);
    assert.equal(JSON.stringify(hand), before);
  }
});

function frontendHarness({ compact = false } = {}) {
  class Element {
    constructor() {
      this.children=[]; this.dataset={}; this.style={}; this._html=''; this.textContent=''; this.value='';
      const classes = new Set();
      this.classList={ add(...names){names.forEach(name=>classes.add(name));},remove(...names){names.forEach(name=>classes.delete(name));},
        contains(name){return classes.has(name);},toggle(name,force){if(force ?? !classes.has(name))classes.add(name);else classes.delete(name);} };
    }
    set innerHTML(value) { this._html=value; this.children=[]; }
    get innerHTML() { return this._html || String(this.textContent).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'); }
    appendChild(node) { this.children.push(node); return node; }
    insertBefore(node) { this.children.unshift(node); }
    querySelector() { return new Element(); }
    querySelectorAll() { return []; }
    addEventListener() {}
    focus() { this.focused = true; }
    setAttribute(name, value) { this[name] = String(value); }
    remove() {}
  }
  const nodes=new Map(); const get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
  const handlers={}; const timers=[]; const emissions=[]; const storage=new Map();
  const socket={connected:true,on(name,fn){handlers[name]=fn;},emit(...args){emissions.push(args);},timeout(){return this;},
    removeAllListeners(){Object.keys(handlers).forEach(name=>delete handlers[name]);},disconnect(){this.connected=false;}};
  const location = { href: 'http://localhost/?room=old&theme=bright', toString(){return this.href;} };
  const ctx=vm.createContext({console:{log(){}},document:{getElementById:get,querySelector:()=>new Element(),querySelectorAll:()=>[],createElement:()=>new Element(),addEventListener(){}},
    io:()=>socket,setTimeout(fn){timers.push(fn);return timers.length;},clearTimeout(){},setInterval(){return 1;},clearInterval(){},
    localStorage:{getItem(key){return storage.get(key) ?? null;},setItem(key,value){storage.set(key,value);},removeItem(key){storage.delete(key);}},
    URL,window:{location,matchMedia(){return {matches:compact,addEventListener(){}};},history:{replaceState(_state,_title,url){location.href=String(url);}}},Date});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/game.js'),'utf8'),ctx);
  vm.runInContext("connectSocket(); gameState.players = [{name:'玩家',isDealer:false}]; gameState.seat = 0;",ctx);
  return {nodes,get,handlers,timers,socket,emissions,storage,location,run(code){return vm.runInContext(code,ctx);}};
}

test('compact screens start with chat collapsed and can reopen it', () => {
  const h = frontendHarness({ compact:true });
  h.run('applyChatVisibility()');
  assert.equal(h.get('chat-box').classList.contains('hidden'), true);
  assert.equal(h.get('toggle-chat-btn')['aria-expanded'], 'false');
  h.run('toggleChatBox()');
  assert.equal(h.get('chat-box').classList.contains('hidden'), false);
  assert.equal(h.get('toggle-chat-btn')['aria-expanded'], 'true');
  h.run('returnToLobby()');
  assert.equal(h.get('chat-box').classList.contains('hidden'), true);
});

test('bottom preview uses read-only cards and jokers identify their rank on the exposed edge', () => {
  const h = frontendHarness();
  h.run("showBottomCards([{id:'a',suit:'hearts',rank:'10'},{id:'big',suit:'joker',rank:'big'},{id:'small',suit:'joker',rank:'small'}])");
  const cards = h.get('bottom-cards').children;
  assert.equal(cards.length, 3);
  cards.forEach(card => {
    assert.equal(card.disabled, true);
    assert.equal(card.classList.contains('bottom-preview-card'), true);
  });
  assert.match(cards[1].innerHTML, /class="joker-letter">大王</);
  assert.match(cards[2].innerHTML, /class="joker-letter">小王</);
  assert.equal(h.run('gameState.selectedCards.length'),0);
});

test('client hint selects without playing and ignores stale or manually superseded suggestions', () => {
  for (const change of ['', "gameState.currentPlayer=1", "gameState.roomId='new'", 'gameState.hand=[]',
    'gameState.selectedCards=[gameState.hand[1]]', 'gameState.socket=null']) {
    const h = frontendHarness();
    h.run("gameState.roomId='old'; gameState.currentState='playing'; gameState.hand=[{id:'a',suit:'hearts',rank:'3'},{id:'b',suit:'hearts',rank:'4'}]; renderHand=()=>updateActionButton(); suggestPlay(); suggestPlay();");
    assert.equal(h.emissions.length, 1);
    assert.equal(h.emissions[0][0], 'suggest-play');
    h.run(change);
    h.emissions[0][1](null, { success: true, cardIds: ['a'] });
    assert.equal(h.run("gameState.selectedCards.some(card=>card.id==='a')"), !change);
    assert.equal(h.emissions.length, 1);
  }
  const h = frontendHarness();
  h.run("gameState.currentState='playing'; suggestPlay();");
  h.emissions[0][1](new Error('timeout'));
  assert.equal(h.run('gameState.hintRequest'), null);
  h.socket.connected = false; h.run('suggestPlay();');
  assert.equal(h.emissions.length, 1);
});

test('client confirms leave then resets room state, storage, URL, socket and panels', () => {
  const h = frontendHarness();
  h.storage.set('sanda1-last-room', 'old'); h.storage.set('sanda1-player-name', 'Player');
  h.run("gameState.roomId='old'; gameState.sessionId='session'; gameState.playerName='Player'; gameState.hand=[{id:'card'}]; gameState.playHistory=[{}]; gameState.currentState='playing'; gameState.isExchanging=true; gameState.countdownTimer=1; elements.resultModal.classList.remove('hidden'); requestLeaveRoom();");
  assert.equal(h.emissions.length, 0);
  assert.match(h.get('leave-room-message').textContent, /托管/);
  h.run('cancelLeaveRoom();');
  assert.equal(h.run('gameState.roomId'), 'old');
  h.run('requestLeaveRoom(); leaveRoom(); leaveRoom();');
  assert.equal(h.emissions.length, 1);
  const [event, payload, ack] = h.emissions[0];
  assert.equal(event, 'leave-room'); assert.equal(payload.roomId, 'old');
  assert.equal(h.run('gameState.roomId'), 'old');
  ack(null, { success: true });
  assert.equal(h.run('gameState.roomId'), null);
  assert.equal(h.run('gameState.socket'), null);
  assert.equal(h.socket.connected, false);
  assert.equal(Object.keys(h.handlers).length, 0);
  assert.equal(h.storage.has('sanda1-last-room'), false);
  assert.equal(h.storage.get('sanda1-player-name'), 'Player');
  assert.equal(h.run('gameState.sessionId'), 'session');
  assert.equal(h.run('gameState.hand.length + gameState.playHistory.length'), 0);
  assert.equal(h.run('gameState.countdownTimer'), null);
  assert.equal(h.run('gameState.isExchanging'), false);
  assert.equal(h.location.href, 'http://localhost/?theme=bright');
  assert.equal(h.get('home-screen').classList.contains('active'), true);
  assert.equal(h.get('result-modal').classList.contains('hidden'), true);
  assert.equal(h.get('leave-room-modal').classList.contains('hidden'), true);
});

test('client offline or timed-out leave never reports success and permits retry', () => {
  const h = frontendHarness(); h.run("gameState.roomId='old';");
  h.socket.connected = false; h.run('leaveRoom();');
  assert.equal(h.emissions.length, 0);
  assert.equal(h.run('gameState.roomId'), 'old');
  h.socket.connected = true; h.run('leaveRoom();');
  h.emissions[0][2](new Error('timeout'));
  assert.equal(h.run('gameState.roomId'), 'old');
  assert.equal(h.run('gameState.leavingRoom'), false);
  h.run('leaveRoom();');
  h.emissions[1][2](null, {success:true});
  assert.equal(h.run('gameState.roomId'), null);
});

test('client reconnect sends the saved session and restores identity before the room snapshot', () => {
  const h = frontendHarness();
  h.run("gameState.roomId='old'; gameState.sessionId='session'; gameState.playerId='old-socket'; gameState.countdownTimer=1;");
  h.handlers.disconnect();
  assert.equal(h.get('play-btn').disabled, true);
  assert.equal(h.run('gameState.countdownTimer'), null);
  h.handlers.connect();
  const [event, data, ack] = h.emissions.at(-1);
  assert.equal(event, 'rejoin-room'); assert.equal(data.sessionId, 'session'); assert.equal(data.roomId, 'old');
  ack({success:true, playerId:'restored'});
  assert.equal(h.run('gameState.playerId'), 'restored');
  assert.equal(h.run('gameState.roomId'), 'old');
});

test('failed reconnect clears stale UI; replaced sessions preserve the new window recovery record', () => {
  for (const replaced of [false, true]) {
    const h = frontendHarness();
    h.run("gameState.roomId='old'; gameState.sessionId='session'; gameState.hand=[{id:'old-card'}];");
    h.storage.set('sanda1-last-room', 'old');
    if (replaced) h.handlers['session-replaced']();
    else { h.handlers.connect(); h.emissions.at(-1)[2]({success:false}); }
    assert.equal(h.run('gameState.roomId'), null);
    assert.equal(h.run('gameState.hand.length'), 0);
    assert.equal(h.storage.has('sanda1-last-room'), replaced);
    assert.equal(h.get('home-screen').classList.contains('active'), true);
    assert.equal(h.location.href, 'http://localhost/?theme=bright');
  }
});

test('leaving an old window does not delete a different window room record', () => {
  const h = frontendHarness();
  h.run("gameState.roomId='old';"); h.storage.set('sanda1-last-room', 'another-room');
  h.run('returnToLobby();');
  assert.equal(h.storage.get('sanda1-last-room'), 'another-room');
});

test('client receives absolute hand count once and clears only played selection',()=>{
  const h=frontendHarness();
  h.run("gameState.hand = [{id:'a',suit:'hearts',rank:'A'},{id:'b',suit:'hearts',rank:'K'}]; gameState.selectedCards=[gameState.hand[0]]; getSeatElement = () => ({querySelector:()=>elements.myCardCount,classList:{add(){},remove(){}}}); renderSeatPlayPile=()=>{}; addPlayHistory=()=>{};");
  h.handlers['cards-played']({player:0,cards:[card('hearts','A','a')],cardCount:1,nextPlayer:1});
  assert.equal(h.get('my-card-count').textContent,1);
  assert.equal(h.run('gameState.selectedCards.length'),0);
});

test('client trick rendering schedules no stale cleanup that could erase next trick',()=>{
  const h=frontendHarness();
  h.run('renderSeatPlayPile=()=>{}; addPlayHistory=()=>{};');
  for(let i=0;i<4;i++)h.run(`showPlayedCards(0,[{id:'${i}',suit:'hearts',rank:'3'}]);`);
  assert.equal(h.timers.length,0);
  assert.equal(h.run('gameState.currentRound.length'),4);
});

test('player names are escaped before insertion into chat markup',()=>{
  const h=frontendHarness();
  h.run("addChatMessage('<b>A</b>', '<img>');");
  const markup=h.get('chat-messages').children[0].innerHTML;
  assert.ok(markup.includes('&lt;b&gt;A&lt;/b&gt;'));
  assert.ok(markup.includes('&lt;img&gt;'));
  assert.equal(markup.includes('<b>A</b>'),false);
});

test('client permits a mixed-suit shortage response for authoritative validation after rejoin',()=>{
  const h=frontendHarness();
  h.run("gameState.currentRound=[{cards:[{suit:'hearts',rank:'A'},{suit:'hearts',rank:'A'}]}];");
  assert.equal(h.run("validatePlay([{suit:'hearts',rank:'3'},{suit:'clubs',rank:'4'}]).valid"),true);
});
