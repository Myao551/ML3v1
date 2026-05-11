// @ts-check

/**
 * @param {string} roomId
 */
function createRoom(roomId) {
  return {
    id: roomId,
    players: [],
    state: 'waiting',
    deck: [],
    bottomCards: [],
    currentBidder: 0,
    currentBid: 100,
    dealer: null,
    trumpSuit: null,
    isNoTrump: false,
    currentPlayer: 0,
    currentRound: [],
    roundResolving: false,
    roundWinner: null,
    scores: { team: 0 },
    scoringCards: [],
    dealerScore: 0,
    settlementSettings: { baseScore: 1, levelScore: 1 },
    roundScores: [],
    bidHistory: [],
    passedBidders: new Set(),
    hasValidBid: false,
    earlyFinishVotes: new Set(),
    earlyFinishOffered: false,
    gameNumber: 1,
    lastWinner: null,
    nextBidder: 0
  };
}

/**
 * @param {unknown} settings
 * @returns {{ baseScore: number; levelScore: number }}
 */
function normalizeSettlementSettings(settings) {
  const input = /** @type {{ baseScore?: unknown; levelScore?: unknown } | null | undefined} */ (settings);
  const baseScore = Number(input?.baseScore);
  const levelScore = Number(input?.levelScore);
  return {
    baseScore: Number.isFinite(baseScore) && baseScore >= 0 ? Math.floor(baseScore) : 1,
    levelScore: Number.isFinite(levelScore) && levelScore >= 0 ? Math.floor(levelScore) : 1
  };
}

module.exports = {
  createRoom,
  normalizeSettlementSettings
};
