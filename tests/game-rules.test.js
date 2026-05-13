const assert = require('node:assert/strict');
const test = require('node:test');

const { sortCardsForInitialDeal } = require('../src/game/cards');
const { validatePlay } = require('../src/game/play-rules');

function card(suit, rank, id = `${suit}-${rank}`) {
  return { suit, rank, id };
}

test('initial deal sorting keeps constant trumps before normal cards', () => {
  const hand = [
    card('hearts', 'A'),
    card('clubs', '7'),
    card('spades', '2'),
    card('joker', 'small'),
    card('joker', 'big'),
    card('hearts', 'K')
  ];

  const sorted = [...hand].sort(sortCardsForInitialDeal).map(item => item.rank);

  assert.deepEqual(sorted, ['big', 'small', '2', '7', 'A', 'K']);
});

test('validatePlay returns localized messages for invalid play requests', () => {
  const room = {
    players: [{ hand: [card('spades', 'A', 'a1')] }],
    currentRound: [],
    trumpSuit: null,
    isNoTrump: true
  };

  assert.equal(validatePlay(room, [], 0).message, '请选择要出的牌');
  assert.equal(validatePlay(room, [card('hearts', 'K', 'missing')], 0).message, '所选牌无效或不在手牌中');
});

test('validatePlay returns localized follow-suit messages', () => {
  const lead = card('hearts', 'A', 'lead-a');
  const room = {
    players: [{ hand: [card('hearts', 'K', 'heart-k'), card('spades', 'K', 'spade-k')] }],
    currentRound: [{ cards: [lead] }],
    trumpSuit: null,
    isNoTrump: true
  };

  assert.equal(validatePlay(room, [card('spades', 'K', 'spade-k')], 0).message, '有同花色时必须跟牌');
});
