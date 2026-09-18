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
  function connect(id) {
    const handlers = {};
    const socket = { id, handlers, nsp: { sockets }, events: [], roomId: null,
      on(event, handler) { handlers[event] = handler; }, join() {}, leave() {},
      emit(event, data) { this.events.push({ event, data }); },
      disconnect() { handlers.disconnect(); },
      send(event, ...args) { return handlers[event](...args); }
    };
    sockets.set(id, socket); connection(socket); return socket;
  }
  function fourPlayers() {
    const players = Array.from({ length: 4 }, (_, i) => connect(`p${i}`));
    let roomId;
    players[0].send('create-room', { name: 'P0', sessionId: 's0' }, response => { roomId = response.roomId; });
    players.slice(1).forEach((socket, i) => socket.send('join-room', roomId, { name: `P${i + 1}`, sessionId: `s${i + 1}` }, () => {}));
    players.forEach(socket => socket.send('player-ready', true));
    return { players, room: rooms.get(roomId) };
  }
  function fire(id) { const timer = timers.get(id); assert.ok(timer, `timer ${id} exists`); timers.delete(id); time = Math.max(time, timer.at); timer.fn(); }
  return { context, rooms, timers, connect, fourPlayers, fire, broadcasts, run(code) { return vm.runInContext(code, context); } };
}

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
  const replacement = h.connect('replacement');
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

test('dealer win retains first bid, dealer loss rotates it', () => {
  const h = harness(); const { room } = h.fourPlayers();
  room.dealer = 2; room.dealerScore = 100; room.scores.team = 20;
  h.run(`endGame(rooms.get('${room.id}'))`);
  assert.equal(room.nextBidder, 2);
  room.dealer = 2; room.dealerScore = 100; room.scores.team = 100;
  h.run(`endGame(rooms.get('${room.id}'))`);
  assert.equal(room.nextBidder, 3);
});

test('timeout bids pass; exchange, trump and all 25 rounds complete automatically', () => {
  const h = harness(); const { players, room } = h.fourPlayers();
  h.fire(room.turnTimer); assert.equal(room.passedBidders.has(0), true);
  players[1].send('place-bid', 75);
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
  const replacement = h.connect('new');
  replacement.send('rejoin-room', { roomId: room.id, sessionId: 's0' }, () => {});
  assert.equal(room.deadline, deadline);
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

function frontendHarness() {
  class Element {
    constructor() { this.children=[]; this.dataset={}; this.style={}; this._html=''; this.textContent=''; this.classList={ add(){},remove(){},toggle(){} }; }
    set innerHTML(value) { this._html=value; this.children=[]; }
    get innerHTML() { return this._html || String(this.textContent).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'); }
    appendChild(node) { this.children.push(node); return node; }
    insertBefore(node) { this.children.unshift(node); }
    querySelector() { return new Element(); }
    querySelectorAll() { return []; }
    addEventListener() {}
    setAttribute(name, value) { this[name] = String(value); }
    remove() {}
  }
  const nodes=new Map(); const get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
  const handlers={}; const timers=[];
  const socket={connected:true,on(name,fn){handlers[name]=fn;},emit(){}};
  const ctx=vm.createContext({console:{log(){}},document:{getElementById:get,querySelector:()=>new Element(),querySelectorAll:()=>[],createElement:()=>new Element(),addEventListener(){}},
    io:()=>socket,setTimeout(fn){timers.push(fn);return timers.length;},clearTimeout(){},setInterval(){},clearInterval(){},localStorage:{getItem(){return null;},setItem(){}},Date});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/game.js'),'utf8'),ctx);
  vm.runInContext("connectSocket(); gameState.players = [{name:'玩家',isDealer:false}]; gameState.seat = 0;",ctx);
  return {nodes,get,handlers,timers,run(code){return vm.runInContext(code,ctx);}};
}

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
