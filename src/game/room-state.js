// @ts-check

/**
 * @param {any} room
 * @returns {any}
 */
function getRoomState(room) {
  return {
    id: room.id,
    state: room.state,
    players: room.players.map((/** @type {any} */ player) => ({
      id: player.id,
      name: player.name,
      seat: player.seat,
      isReady: player.isReady,
      isDealer: player.isDealer,
      settlementScore: player.settlementScore || 0,
      disconnected: !!player.disconnected,
      cardCount: player.hand.length
    })),
    settlementSettings: room.settlementSettings,
    scores: room.scores,
    scoringCards: room.scoringCards,
    currentBid: room.currentBid,
    currentBidder: room.currentBidder,
    bidHistory: room.bidHistory,
    hasValidBid: room.hasValidBid,
    dealerScore: room.dealerScore,
    dealer: room.dealer,
    trumpSuit: room.trumpSuit,
    isNoTrump: room.isNoTrump,
    currentPlayer: room.currentPlayer,
    currentRoundLength: room.currentRound.length,
    gameNumber: room.gameNumber
  };
}

/**
 * @param {any} room
 */
function resetRoomForNextGame(room) {
  room.state = 'waiting';
  room.gameNumber += 1;
  room.players.forEach((/** @type {any} */ player) => {
    player.isDealer = false;
    player.isReady = false;
    player.hand = [];
  });
  room.scores.team = 0;
  room.scoringCards = [];
  room.bidHistory = [];
  room.currentBid = 100;
  room.dealerScore = 0;
  room.dealer = null;
  room.trumpSuit = null;
  room.isNoTrump = false;
  room.currentBidder = room.players.length ? (room.nextBidder || 0) % room.players.length : 0;
  room.currentPlayer = room.currentBidder;
  room.currentRound = [];
  room.roundResolving = false;
  room.roundScores = [];
  room.bottomCards = [];
  room.deck = [];
  room.roundWinner = null;
  room.lastWinner = null;
  room.passedBidders = new Set();
  room.hasValidBid = false;
  room.earlyFinishVotes = new Set();
  room.earlyFinishOffered = false;
}

module.exports = {
  getRoomState,
  resetRoomForNextGame
};
