// @ts-check

/** @typedef {{ suit: string; rank: string; id: string; deck?: number; isTrump?: boolean; name?: string }} Card */
/** @typedef {Record<string, number>} ValueMap */

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['3', '4', '5', '6', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const TRUMP_RANKS = ['2', '7'];
const JOKERS = [{ suit: 'joker', rank: 'big', name: '大王' }, { suit: 'joker', rank: 'small', name: '小王' }];

/**
 * @returns {Card[]}
 */
function createDeck() {
  /** @type {Card[]} */
  const deck = [];
  for (let deckIndex = 0; deckIndex < 2; deckIndex += 1) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ suit, rank, id: `${suit}-${rank}-${deckIndex}`, deck: deckIndex });
      }
      for (const rank of TRUMP_RANKS) {
        deck.push({ suit, rank, id: `${suit}-${rank}-${deckIndex}`, deck: deckIndex, isTrump: true });
      }
    }
    deck.push({ ...JOKERS[0], id: `big-joker-${deckIndex}`, deck: deckIndex, isTrump: true });
    deck.push({ ...JOKERS[1], id: `small-joker-${deckIndex}`, deck: deckIndex, isTrump: true });
  }
  return deck;
}

/**
 * @template T
 * @param {T[]} items
 * @returns {T[]}
 */
function shuffle(items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

/**
 * @param {Card} card
 * @returns {number}
 */
function getCardScore(card) {
  if (card.rank === '5') return 5;
  if (card.rank === '10' || card.rank === 'K') return 10;
  return 0;
}

/**
 * @param {Card} card
 * @param {string | null} trumpSuit
 * @param {boolean} isNoTrump
 * @returns {number}
 */
function getCardDisplayValue(card, trumpSuit, isNoTrump) {
  if (card.rank === 'big') return 1000;
  if (card.rank === 'small') return 999;
  if (card.rank === '7' && !isNoTrump && card.suit === trumpSuit) return 998;
  if (card.rank === '7') return 997;
  if (card.rank === '2' && !isNoTrump && card.suit === trumpSuit) return 996;
  if (card.rank === '2') return 995;

  /** @type {ValueMap} */
  const rankValue = { A: 14, K: 13, Q: 12, J: 11, 10: 10, 9: 9, 8: 8, 6: 6, 5: 5, 4: 4, 3: 3 };
  if (!isNoTrump && card.suit === trumpSuit) {
    return 500 + (rankValue[card.rank] || 0);
  }

  /** @type {ValueMap} */
  const suitOrder = { spades: 4, hearts: 3, diamonds: 2, clubs: 1 };
  return (suitOrder[card.suit] || 0) * 20 + (rankValue[card.rank] || 0);
}

/**
 * @param {Card} a
 * @param {Card} b
 * @param {string | null} trumpSuit
 * @param {boolean} isNoTrump
 * @returns {number}
 */
function sortCardsForDisplay(a, b, trumpSuit, isNoTrump) {
  const aValue = getCardDisplayValue(a, trumpSuit, isNoTrump);
  const bValue = getCardDisplayValue(b, trumpSuit, isNoTrump);

  if (aValue < 500 && bValue < 500) {
    /** @type {ValueMap} */
    const suitOrder = { spades: 4, hearts: 3, clubs: 2, diamonds: 1 };
    if (a.suit !== b.suit) {
      return (suitOrder[b.suit] || 0) - (suitOrder[a.suit] || 0);
    }
    /** @type {ValueMap} */
    const rankOrder = { A: 14, K: 13, Q: 12, J: 11, 10: 10, 9: 9, 8: 8, 7: 7, 6: 6, 5: 5, 4: 4, 3: 3 };
    return (rankOrder[b.rank] || 0) - (rankOrder[a.rank] || 0);
  }

  return bValue - aValue;
}

/**
 * @param {Card} a
 * @param {Card} b
 * @returns {number}
 */
function sortCardsForInitialDeal(a, b) {
  /** @type {ValueMap} */
  const rankOrder = { big: 100, small: 99, 2: 98, 7: 97, A: 14, K: 13, Q: 12, J: 11, 10: 10, 9: 9, 8: 8, 6: 6, 5: 5, 4: 4, 3: 3 };
  /** @type {ValueMap} */
  const suitOrder = { spades: 4, hearts: 3, clubs: 2, diamonds: 1 };

  if (a.rank === 'big') return -1;
  if (b.rank === 'big') return 1;
  if (a.rank === 'small') return -1;
  if (b.rank === 'small') return 1;

  const aIsConstantTrump = a.rank === '7' || a.rank === '2';
  const bIsConstantTrump = b.rank === '7' || b.rank === '2';
  if (aIsConstantTrump && !bIsConstantTrump) return -1;
  if (!aIsConstantTrump && bIsConstantTrump) return 1;
  if (aIsConstantTrump && bIsConstantTrump) {
    if (a.rank !== b.rank) return (rankOrder[b.rank] || 0) - (rankOrder[a.rank] || 0);
    return (suitOrder[b.suit] || 0) - (suitOrder[a.suit] || 0);
  }

  if (a.suit !== b.suit) return (suitOrder[b.suit] || 0) - (suitOrder[a.suit] || 0);
  return (rankOrder[b.rank] || 0) - (rankOrder[a.rank] || 0);
}

/**
 * @param {Card} card
 * @param {string | null} trumpSuit
 * @param {boolean} isNoTrump
 * @returns {number}
 */
function getCardValue(card, trumpSuit, isNoTrump) {
  /** @type {ValueMap} */
  const suitOrder = { spades: 3, hearts: 2, diamonds: 1, clubs: 0 };

  if (card.rank === 'big') return 1000;
  if (card.rank === 'small') return 999;
  if (card.rank === '7' && card.suit === trumpSuit && !isNoTrump) return 998;
  if (card.rank === '7') return 200 + (suitOrder[card.suit] || 0);
  if (card.rank === '2' && card.suit === trumpSuit && !isNoTrump) return 197;
  if (card.rank === '2') return 100 + (suitOrder[card.suit] || 0);

  /** @type {ValueMap} */
  const rankValue = { A: 14, K: 13, Q: 12, J: 11, 10: 10, 9: 9, 8: 8, 7: 7, 6: 6, 5: 5, 4: 4, 3: 3 };
  if (card.suit === trumpSuit && !isNoTrump) {
    return 50 + (rankValue[card.rank] || 0);
  }

  return rankValue[card.rank] || 0;
}

module.exports = {
  createDeck,
  getCardScore,
  getCardValue,
  getCardDisplayValue,
  shuffle,
  sortCardsForInitialDeal,
  sortCardsForDisplay
};
