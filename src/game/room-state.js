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
      leftRoom: !!player.leftRoom,
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
    currentRound: room.currentRound,
    roundResolving: room.roundResolving,
    deadline: room.deadline || null,
    earlyFinishOffered: room.earlyFinishOffered,
    earlyFinishVoters: [...room.earlyFinishVotes],
    gameNumber: room.gameNumber
  };
}

/**
 * @param {any} room
 */
function resetRoomForNextGame(room) {
  clearTimeout(room.turnTimer);
  clearTimeout(room.roundTimer);
  room.turnTimer = null;
  room.roundTimer = null;
  room.deadline = null;
  room.turnKey = null;
  room.state = 'waiting';
  room.gameNumber += 1;
  removeWaitingPlayers(room, (player) => !!player.leftRoom);
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

/**
 * Remove seats only between games, preserving the next bidder by identity.
 * @param {any} room
 * @param {(player: any) => boolean} shouldRemove
 */
function removeWaitingPlayers(room, shouldRemove) {
  const previous = room.players;
  const start = (room.nextBidder || 0) % (previous.length || 1);
  room.players = previous.filter((/** @type {any} */ player) => {
    if (!shouldRemove(player)) return true;
    clearTimeout(player.disconnectTimer);
    player.disconnectTimer = null;
    return false;
  });
  let nextPlayer;
  for (let offset = 0; offset < previous.length; offset += 1) {
    const candidate = previous[(start + offset) % previous.length];
    if (room.players.includes(candidate)) { nextPlayer = candidate; break; }
  }
  room.players.forEach((/** @type {any} */ player, /** @type {number} */ seat) => { player.seat = seat; });
  room.nextBidder = Math.max(0, room.players.indexOf(nextPlayer));
  room.currentBidder = room.nextBidder;
  room.currentPlayer = room.nextBidder;
}

module.exports = {
  getRoomState,
  removeWaitingPlayers,
  resetRoomForNextGame
};
