// @ts-check

/**
 * @param {any} room
 * @param {string} result
 * @param {number} finalScore
 * @returns {{
 *   baseScore: number;
 *   levelScore: number;
 *   bidSteps: number;
 *   baseUnit: number;
 *   multiplier: number;
 *   unit: number;
 *   special: string | null;
 *   deltas: number[];
 *   totals: number[];
 * }}
 */
function calculateSettlement(room, result, finalScore) {
  const baseScore = Number(room.settlementSettings?.baseScore) || 0;
  const levelScore = Number(room.settlementSettings?.levelScore) || 0;
  const bidSteps = Math.max(0, (100 - room.dealerScore) / 5);
  const baseUnit = baseScore + bidSteps * levelScore;
  let multiplier = 1;
  /** @type {string | null} */
  let special = null;

  if (result !== 'dealer-lost' && finalScore === 0) {
    multiplier = 3;
    special = 'qingguang';
  } else if (result !== 'dealer-lost' && finalScore < 30) {
    multiplier = 2;
    special = 'bianguang';
  }

  const unit = baseUnit * multiplier;
  const deltas = room.players.map((/** @type {any} */ player, /** @type {number} */ index) => {
    if (index === room.dealer) {
      return result === 'dealer-lost' ? -unit * 3 : unit * 3;
    }
    return result === 'dealer-lost' ? unit : -unit;
  });

  room.players.forEach((/** @type {any} */ player, /** @type {number} */ index) => {
    player.settlementScore = (player.settlementScore || 0) + deltas[index];
  });

  return {
    baseScore,
    levelScore,
    bidSteps,
    baseUnit,
    multiplier,
    unit,
    special,
    deltas,
    totals: room.players.map((/** @type {any} */ player) => player.settlementScore || 0)
  };
}

module.exports = {
  calculateSettlement
};
