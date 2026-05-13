// @ts-check

const { getCardValue } = require('./cards');

/** @typedef {import('./cards').Card} Card */
/** @typedef {{ key: string; cards: Card[]; value: number; rankIndex: number }} PairGroup */

/**
 * @typedef {{
 *   valid: boolean;
 *   type?: string;
 *   suit?: string;
 *   length?: number;
 *   pairCount?: number;
 *   tractorLength?: number;
 *   maxValue?: number;
 *   minValue?: number;
 *   compareValue?: number;
 * }} PlayAnalysis
 */

/**
 * @param {Card} card
 * @param {string | null} trumpSuit
 * @param {boolean} isNoTrump
 * @returns {boolean}
 */
function isTrumpCard(card, trumpSuit, isNoTrump) {
  if (card.suit === 'joker') return true;
  if (card.rank === '2' || card.rank === '7') return true;
  return !isNoTrump && card.suit === trumpSuit;
}

/**
 * @param {Card} card
 * @param {string | null} trumpSuit
 * @param {boolean} isNoTrump
 * @returns {string}
 */
function getEffectiveSuit(card, trumpSuit, isNoTrump) {
  return isTrumpCard(card, trumpSuit, isNoTrump) ? 'trump' : card.suit;
}

/**
 * @param {Card[]} cards
 * @param {string} suit
 * @param {string | null} trumpSuit
 * @param {boolean} isNoTrump
 * @returns {number}
 */
function countEffectiveSuit(cards, suit, trumpSuit, isNoTrump) {
  return cards.filter(card => getEffectiveSuit(card, trumpSuit, isNoTrump) === suit).length;
}

/**
 * @param {Card[]} cards
 * @param {string | null} trumpSuit
 * @param {boolean} isNoTrump
 * @returns {string}
 */
function getFollowSuitKey(cards, trumpSuit, isNoTrump) {
  return getEffectiveSuit(cards[0], trumpSuit, isNoTrump);
}

/**
 * @param {Card} card
 * @param {string} suitKey
 * @param {string | null} trumpSuit
 * @param {boolean} isNoTrump
 * @returns {boolean}
 */
function matchesFollowSuit(card, suitKey, trumpSuit, isNoTrump) {
  return getEffectiveSuit(card, trumpSuit, isNoTrump) === suitKey;
}

/**
 * @param {Card[]} cards
 * @param {string} suitKey
 * @param {string | null} trumpSuit
 * @param {boolean} isNoTrump
 * @returns {Card[]}
 */
function getFollowSuitCards(cards, suitKey, trumpSuit, isNoTrump) {
  return cards.filter(card => matchesFollowSuit(card, suitKey, trumpSuit, isNoTrump));
}

/**
 * @param {Card[]} cards
 * @param {string} suitKey
 * @param {string | null} trumpSuit
 * @param {boolean} isNoTrump
 * @returns {number}
 */
function countFollowSuit(cards, suitKey, trumpSuit, isNoTrump) {
  return getFollowSuitCards(cards, suitKey, trumpSuit, isNoTrump).length;
}

/**
 * @param {Card} card
 * @param {string | null} trumpSuit
 * @param {boolean} isNoTrump
 * @returns {number}
 */
function getRankIndex(card, trumpSuit, isNoTrump) {
  const normalOrder = ['3', '4', '5', '6', '8', '9', '10', 'J', 'Q', 'K', 'A'];

  if (getEffectiveSuit(card, trumpSuit, isNoTrump) === 'trump') {
    if (card.rank === 'big') return 16;
    if (card.rank === 'small') return 15;
    if (card.rank === '7') return !isNoTrump && card.suit === trumpSuit ? 14 : 13;
    if (card.rank === '2') return !isNoTrump && card.suit === trumpSuit ? 12 : 11;
    return normalOrder.indexOf(card.rank);
  }

  if (card.rank === 'big') return 100;
  if (card.rank === 'small') return 99;
  return normalOrder.indexOf(card.rank);
}

/**
 * @param {Card} card
 * @returns {string}
 */
function getFaceKey(card) {
  return `${card.suit}-${card.rank}`;
}

/**
 * @param {Card[]} cards
 * @param {string | null} trumpSuit
 * @param {boolean} isNoTrump
 * @returns {PairGroup[]}
 */
function getPairGroups(cards, trumpSuit, isNoTrump) {
  /** @type {Map<string, Card[]>} */
  const groups = new Map();
  for (const card of cards) {
    const key = getFaceKey(card);
    groups.set(key, [...(groups.get(key) || []), card]);
  }

  return [...groups.values()]
    .filter(group => group.length >= 2)
    .map(group => ({
      key: getFaceKey(group[0]),
      cards: group.slice(0, 2),
      value: getCardValue(group[0], trumpSuit, isNoTrump),
      rankIndex: getRankIndex(group[0], trumpSuit, isNoTrump)
    }))
    .sort((a, b) => a.rankIndex - b.rankIndex);
}

/**
 * @param {PairGroup[]} pairGroups
 * @returns {PairGroup[]}
 */
function findLongestTractor(pairGroups) {
  /** @type {PairGroup[]} */
  let best = [];
  /** @type {PairGroup[]} */
  let current = [];

  for (const group of pairGroups) {
    const previous = current[current.length - 1];
    current = !previous || group.rankIndex === previous.rankIndex + 1 ? [...current, group] : [group];
    if (current.length > best.length) best = [...current];
  }

  return best.length >= 2 ? best : [];
}

/**
 * @param {Card[]} cards
 * @param {string | null} trumpSuit
 * @param {boolean} isNoTrump
 * @returns {PlayAnalysis}
 */
function analyzePlay(cards, trumpSuit, isNoTrump) {
  if (!Array.isArray(cards) || cards.length === 0) return { valid: false };

  const suit = getEffectiveSuit(cards[0], trumpSuit, isNoTrump);
  if (!cards.every(card => getEffectiveSuit(card, trumpSuit, isNoTrump) === suit)) {
    return { valid: false };
  }

  const pairGroups = getPairGroups(cards, trumpSuit, isNoTrump);
  const tractorGroups = findLongestTractor(pairGroups);
  const values = cards.map(card => getCardValue(card, trumpSuit, isNoTrump));
  const maxValue = Math.max(...values);
  const minValue = Math.min(...values);

  let type = 'throw';
  if (cards.length === 1) type = 'single';
  else if (cards.length === 2 && pairGroups.length === 1) type = 'pair';
  else if (cards.length >= 4 && cards.length % 2 === 0 && pairGroups.length * 2 === cards.length && tractorGroups.length === pairGroups.length) type = 'tractor';

  return {
    valid: true,
    type,
    suit,
    length: cards.length,
    pairCount: pairGroups.length,
    tractorLength: tractorGroups.length,
    maxValue,
    minValue,
    compareValue: type === 'tractor' ? Math.max(...tractorGroups.map(group => group.value)) : maxValue
  };
}

/**
 * @param {Card[]} cards
 * @param {string} suit
 * @param {string | null} trumpSuit
 * @param {boolean} isNoTrump
 * @returns {boolean}
 */
function handHasPair(cards, suit, trumpSuit, isNoTrump) {
  return getPairGroups(cards.filter(card => getEffectiveSuit(card, trumpSuit, isNoTrump) === suit), trumpSuit, isNoTrump).length > 0;
}

/**
 * @param {Card[]} cards
 * @param {string} suit
 * @param {string | null} trumpSuit
 * @param {boolean} isNoTrump
 * @param {number} [minLength]
 * @returns {boolean}
 */
function handHasTractor(cards, suit, trumpSuit, isNoTrump, minLength = 2) {
  const suitedCards = cards.filter(card => getEffectiveSuit(card, trumpSuit, isNoTrump) === suit);
  return findLongestTractor(getPairGroups(suitedCards, trumpSuit, isNoTrump)).length >= minLength;
}

/**
 * @param {Card[]} cards
 * @param {string} suitKey
 * @param {string | null} trumpSuit
 * @param {boolean} isNoTrump
 * @returns {boolean}
 */
function followSuitHasPair(cards, suitKey, trumpSuit, isNoTrump) {
  return getPairGroups(getFollowSuitCards(cards, suitKey, trumpSuit, isNoTrump), trumpSuit, isNoTrump).length > 0;
}

/**
 * @param {Card[]} cards
 * @param {string} suitKey
 * @param {string | null} trumpSuit
 * @param {boolean} isNoTrump
 * @param {number} [minLength]
 * @returns {boolean}
 */
function followSuitHasTractor(cards, suitKey, trumpSuit, isNoTrump, minLength = 2) {
  return findLongestTractor(getPairGroups(getFollowSuitCards(cards, suitKey, trumpSuit, isNoTrump), trumpSuit, isNoTrump)).length >= minLength;
}

/**
 * @param {PlayAnalysis} playAnalysis
 * @param {PlayAnalysis} leadAnalysis
 * @returns {boolean}
 */
function playSatisfiesStructure(playAnalysis, leadAnalysis) {
  if (leadAnalysis.type === 'tractor') return playAnalysis.type === 'tractor' && (playAnalysis.tractorLength || 0) >= (leadAnalysis.tractorLength || 0);
  if (leadAnalysis.type === 'pair') return (playAnalysis.pairCount || 0) >= 1;
  if ((leadAnalysis.tractorLength || 0) >= 2) return (playAnalysis.tractorLength || 0) >= (leadAnalysis.tractorLength || 0);
  if ((leadAnalysis.pairCount || 0) > 0) return (playAnalysis.pairCount || 0) >= (leadAnalysis.pairCount || 0);
  return true;
}

/**
 * @param {{ cards: Card[] }} currentPlay
 * @param {{ cards: Card[] }} winningPlay
 * @param {PlayAnalysis} leadAnalysis
 * @param {string | null} trumpSuit
 * @param {boolean} isNoTrump
 * @returns {boolean}
 */
function doesPlayBeat(currentPlay, winningPlay, leadAnalysis, trumpSuit, isNoTrump) {
  const current = analyzePlay(currentPlay.cards, trumpSuit, isNoTrump);
  const winning = analyzePlay(winningPlay.cards, trumpSuit, isNoTrump);
  if (!current.valid || current.length !== leadAnalysis.length) return false;
  if (!playSatisfiesStructure(current, leadAnalysis)) return false;

  const currentCanCompete = current.suit === leadAnalysis.suit || current.suit === 'trump';
  if (!currentCanCompete) return false;

  if (current.suit === 'trump' && winning.suit !== 'trump') return true;
  if (current.suit !== 'trump' && winning.suit === 'trump') return false;
  if (current.suit !== winning.suit) return false;

  if (leadAnalysis.type === 'single') return (current.compareValue || 0) > (winning.compareValue || 0);
  if (leadAnalysis.type === 'pair') return current.type === 'pair' && winning.type === 'pair' && (current.compareValue || 0) > (winning.compareValue || 0);
  if (leadAnalysis.type === 'tractor') {
    return current.type === 'tractor' &&
      winning.type === 'tractor' &&
      current.tractorLength === leadAnalysis.tractorLength &&
      winning.tractorLength === leadAnalysis.tractorLength &&
      (current.compareValue || 0) > (winning.compareValue || 0);
  }

  return (current.minValue || 0) > (winning.minValue || 0);
}

/**
 * @param {PlayAnalysis} analysis
 * @returns {number}
 */
function getBottomMultiplier(analysis) {
  if (analysis.type === 'pair') return 2;
  if (analysis.type === 'tractor') return (analysis.tractorLength || 0) * 2;
  if (analysis.type === 'throw') return analysis.length || 1;
  return 1;
}

/**
 * @param {any} room
 * @param {Card[]} cards
 * @param {number} playerIndex
 * @returns {{ valid: boolean; message?: string }}
 */
function validatePlay(room, cards, playerIndex) {
  const player = room.players[playerIndex];

  if (!Array.isArray(cards) || cards.length === 0) {
    return { valid: false, message: '请选择要出的牌' };
  }

  const selectedIds = new Set();
  for (const card of cards) {
    if (!card || selectedIds.has(card.id) || !player.hand.some((/** @type {Card} */ candidate) => candidate.id === card.id)) {
      return { valid: false, message: '所选牌无效或不在手牌中' };
    }
    selectedIds.add(card.id);
  }

  if (room.currentRound.length === 0) {
    return analyzePlay(cards, room.trumpSuit, room.isNoTrump).valid
      ? { valid: true }
      : { valid: false, message: '出牌组合无效' };
  }

  const firstPlay = room.currentRound[0];
  const leadAnalysis = analyzePlay(firstPlay.cards, room.trumpSuit, room.isNoTrump);
  if (!leadAnalysis.valid || cards.length !== leadAnalysis.length) {
    return { valid: false, message: `本轮需要出 ${firstPlay.cards.length} 张牌` };
  }

  const leadFollowSuit = getFollowSuitKey(firstPlay.cards, room.trumpSuit, room.isNoTrump);
  const leadSuitInHand = countFollowSuit(player.hand, leadFollowSuit, room.trumpSuit, room.isNoTrump);
  const requiredFollowCount = Math.min(leadAnalysis.length || 0, leadSuitInHand);
  const playedLeadSuitCount = countFollowSuit(cards, leadFollowSuit, room.trumpSuit, room.isNoTrump);
  if (playedLeadSuitCount < requiredFollowCount) {
    return { valid: false, message: '有同花色时必须跟牌' };
  }

  const playedLeadSuitCards = getFollowSuitCards(cards, leadFollowSuit, room.trumpSuit, room.isNoTrump);
  const followedLeadSuit = playedLeadSuitCount > 0;
  const allPlayedTrump = cards.every(card => getEffectiveSuit(card, room.trumpSuit, room.isNoTrump) === 'trump');
  const isTrumpKill = !followedLeadSuit && allPlayedTrump && leadAnalysis.suit !== 'trump';

  if (followedLeadSuit || isTrumpKill) {
    const obligationSuit = followedLeadSuit ? leadFollowSuit : 'trump';
    const structureCards = followedLeadSuit ? playedLeadSuitCards : cards;
    const structureAnalysis = analyzePlay(structureCards, room.trumpSuit, room.isNoTrump);
    const obligationSuitInHand = followedLeadSuit
      ? countFollowSuit(player.hand, obligationSuit, room.trumpSuit, room.isNoTrump)
      : countEffectiveSuit(player.hand, obligationSuit, room.trumpSuit, room.isNoTrump);
    const hasObligationTractor = followedLeadSuit
      ? followSuitHasTractor(player.hand, obligationSuit, room.trumpSuit, room.isNoTrump, leadAnalysis.tractorLength)
      : handHasTractor(player.hand, obligationSuit, room.trumpSuit, room.isNoTrump, leadAnalysis.tractorLength);
    const hasObligationPair = followedLeadSuit
      ? followSuitHasPair(player.hand, obligationSuit, room.trumpSuit, room.isNoTrump)
      : handHasPair(player.hand, obligationSuit, room.trumpSuit, room.isNoTrump);

    if (leadAnalysis.type === 'tractor' || (leadAnalysis.tractorLength || 0) >= 2) {
      if (obligationSuitInHand >= (leadAnalysis.tractorLength || 0) * 2 && hasObligationTractor) {
        return structureAnalysis.valid && structureAnalysis.type === 'tractor' && structureAnalysis.tractorLength === leadAnalysis.tractorLength
          ? { valid: true }
          : { valid: false, message: '必须用同花色拖拉机跟牌' };
      }
      if (obligationSuitInHand >= 2 && hasObligationPair) {
        return structureAnalysis.valid && (structureAnalysis.pairCount || 0) > 0
          ? { valid: true }
          : { valid: false, message: '必须用同花色对子跟牌' };
      }
    }

    if ((leadAnalysis.type === 'pair' || (leadAnalysis.pairCount || 0) > 0) &&
        obligationSuitInHand >= 2 &&
        hasObligationPair) {
      return structureAnalysis.valid && (structureAnalysis.pairCount || 0) > 0
        ? { valid: true }
        : { valid: false, message: '必须跟对子' };
    }
  }

  return { valid: true };
}

module.exports = {
  analyzePlay,
  doesPlayBeat,
  getBottomMultiplier,
  getEffectiveSuit,
  isTrumpCard,
  validatePlay
};
