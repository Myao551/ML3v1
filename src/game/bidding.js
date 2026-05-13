// @ts-check

/** @typedef {import('./cards').Card} Card */

/**
 * @param {any} room
 * @returns {number[]}
 */
function getActiveBidders(room) {
  return room.players
    .map((/** @type {any} */ _, /** @type {number} */ index) => index)
    .filter((/** @type {number} */ index) => !room.passedBidders.has(index));
}

/**
 * @param {any} room
 * @returns {number}
 */
function getNextBidder(room) {
  const activeBidders = getActiveBidders(room);
  if (activeBidders.length === 0) return room.currentBidder;

  for (let step = 1; step <= room.players.length; step += 1) {
    const next = (room.currentBidder + step) % room.players.length;
    if (!room.passedBidders.has(next)) return next;
  }

  return activeBidders[0];
}

/**
 * @param {any} room
 * @param {unknown} bid
 * @returns {boolean}
 */
function isValidBid(room, bid) {
  if (!Number.isInteger(bid) || Number(bid) > 100 || Number(bid) < 75 || Number(bid) % 5 !== 0) return false;
  return room.hasValidBid ? Number(bid) < room.currentBid : true;
}

/**
 * @param {Card[]} cards
 * @returns {Card[]}
 */
function getConstantTrumpCards(cards) {
  return cards.filter(card => card.suit === 'joker' || card.rank === '2' || card.rank === '7');
}

/**
 * @param {Card} card
 * @returns {number}
 */
function getConstantTrumpCompareValue(card) {
  /** @type {Record<string, number>} */
  const suitOrder = { diamonds: 0, clubs: 1, hearts: 2, spades: 3 };
  if (card.rank === 'big') return 1000;
  if (card.rank === 'small') return 999;
  if (card.rank === '7') return 700 + (suitOrder[card.suit] || 0);
  if (card.rank === '2') return 200 + (suitOrder[card.suit] || 0);
  return 0;
}

/**
 * @typedef {{
 *   index: number;
 *   player: any;
 *   count: number;
 *   values: number[];
 * }} AllPassStanding
 */

/**
 * @param {AllPassStanding} a
 * @param {AllPassStanding} b
 * @returns {number}
 */
function compareAllPassLoser(a, b) {
  if (a.count !== b.count) return b.count - a.count;

  const maxLength = Math.max(a.values.length, b.values.length);
  for (let index = 0; index < maxLength; index += 1) {
    const aValue = a.values[index] || 0;
    const bValue = b.values[index] || 0;
    if (aValue !== bValue) return bValue - aValue;
  }

  return a.index - b.index;
}

/**
 * @param {any} room
 * @returns {AllPassStanding[]}
 */
function getAllPassStandings(room) {
  return room.players.map((/** @type {any} */ player, /** @type {number} */ index) => {
    const trumps = getConstantTrumpCards(player.hand);
    return {
      index,
      player,
      count: trumps.length,
      values: trumps.map(getConstantTrumpCompareValue).sort((a, b) => b - a)
    };
  }).sort(compareAllPassLoser);
}

module.exports = {
  getActiveBidders,
  getAllPassStandings,
  getNextBidder,
  isValidBid
};
