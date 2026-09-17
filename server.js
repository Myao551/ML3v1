const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const {
  createDeck,
  getCardScore,
  shuffle,
  sortCardsForInitialDeal,
  sortCardsForDisplay
} = require('./src/game/cards');
const {
  getActiveBidders,
  getAllPassStandings,
  getNextBidder,
  isValidBid
} = require('./src/game/bidding');
const {
  analyzePlay,
  doesPlayBeat,
  getBottomMultiplier,
  validatePlay,
  getAutoPlay
} = require('./src/game/play-rules');
const {
  getRoomState,
  resetRoomForNextGame
} = require('./src/game/room-state');
const { calculateSettlement } = require('./src/game/settlement');
const { registerGameplayEvents } = require('./src/socket/gameplay-events');
const { registerRoomLifecycleEvents } = require('./src/socket/room-events');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

io.on('connection', (socket) => {
  console.log('New connection:', socket.id);

  registerRoomLifecycleEvents({
    io,
    socket,
    rooms,
    getRoomState,
    startGame,
    scheduleTurn
  });

  registerGameplayEvents({
    io,
    socket,
    rooms,
    getRoomState,
    emitBidUpdate,
    getActiveBidders,
    getNextBidder,
    handleAllPass,
    setDealer,
    endGame,
    isValidBid,
    validatePlay,
    finishRound,
    scheduleTurn
  });

});

function emitBidUpdate(room) {
  io.to(room.id).emit('bid-update', {
    currentBid: room.currentBid,
    currentBidder: room.currentBidder,
    bidHistory: room.bidHistory,
    state: room.state,
    dealer: room.dealer,
    hasValidBid: room.hasValidBid
  });
}

function handleAllPass(room) {
  const standings = getAllPassStandings(room);
  const loser = standings[0];
  clearTimeout(room.turnTimer);
  clearTimeout(room.roundTimer);
  room.deadline = null;
  room.state = 'ended';

  io.to(room.id).emit('all-pass-loser', {
    loser: loser.index,
    loserName: loser.player.name,
    trumpCount: loser.count,
    trumpValues: loser.values
  });

  resetRoomForNextGame(room);
  io.to(room.id).emit('room-update', getRoomState(room));
}

function setDealer(room, dealerIndex, dealerScore) {
  room.players.forEach(p => { p.isDealer = false; });

  const dealer = room.players[dealerIndex];
  dealer.isDealer = true;
  room.dealer = dealerIndex;
  room.dealerScore = dealerScore;
  room.state = 'exchanging';
  dealer.hand = dealer.hand.concat(room.bottomCards);
  dealer.hand.sort((a, b) => sortCardsForDisplay(a, b, room.trumpSuit, room.isNoTrump));

  io.to(room.id).emit('room-update', getRoomState(room));
  io.to(room.id).emit('bottom-to-dealer', { dealer: dealerIndex });
  io.to(dealer.id).emit('hand-sorted', dealer.hand);
  io.to(dealer.id).emit('exchange-cards', {
    bottomCards: room.bottomCards,
    hand: dealer.hand
  });
  scheduleTurn(room);
}

function startGame(room) {
  room.state = 'bidding';
  room.deck = shuffle(createDeck());
  room.players.forEach(p => {
    p.isDealer = false;
    p.isReady = false;
  });
  room.currentBid = 100;
  room.dealer = null;
  room.trumpSuit = null;
  room.isNoTrump = false;
  room.currentRound = [];
  room.roundResolving = false;
  room.roundScores = [];
  room.scores.team = 0;
  room.scoringCards = [];
  room.dealerScore = 0;
  room.bidHistory = [];
  room.passedBidders = new Set();
  room.hasValidBid = false;
  room.earlyFinishVotes = new Set();
  room.earlyFinishOffered = false;

  room.bottomCards = room.deck.slice(0, 8);
  let cardIndex = 8;

  for (let i = 0; i < 4; i++) {
    room.players[i].hand = room.deck.slice(cardIndex, cardIndex + 25);
    cardIndex += 25;

    room.players[i].hand.sort(sortCardsForInitialDeal);




    io.to(room.players[i].id).emit('deal-cards', room.players[i].hand);
  }

  room.currentBidder = (room.nextBidder || 0) % room.players.length;
  room.currentPlayer = room.currentBidder;

  io.to(room.id).emit('room-update', getRoomState(room));

  io.to(room.id).emit('game-started', {
    currentBidder: room.currentBidder,
    currentBid: room.currentBid,
    hasValidBid: room.hasValidBid,
    teamScore: room.scores.team,
    bottomCardCount: 8
  });
  scheduleTurn(room);
}

function finishRound(room) {
  if (room.state !== 'playing' || room.currentRound.length !== 4) return;
  const firstPlay = room.currentRound[0];
  const leadAnalysis = analyzePlay(firstPlay.cards, room.trumpSuit, room.isNoTrump);
  let winner = 0;
  for (let i = 1; i < 4; i++) {
    if (doesPlayBeat(room.currentRound[i], room.currentRound[winner], leadAnalysis, room.trumpSuit, room.isNoTrump)) {
      winner = i;
    }
  }

  let roundScore = 0;
  for (const play of room.currentRound) {
    for (const card of play.cards) {
      roundScore += getCardScore(card);
    }
  }

  const winnerPlayer = room.currentRound[winner].player;
  const winnerIsDealer = room.players[winnerPlayer].isDealer;

  if (!winnerIsDealer) {
    room.scores.team += roundScore;
    const scoreCards = room.currentRound.flatMap(play => play.cards).filter(card => getCardScore(card) > 0);
    room.scoringCards.push(...scoreCards);
  }

  room.roundScores.push({
    winner: winnerPlayer,
    score: roundScore,
    isDealerWin: winnerIsDealer
  });

  const isLastRound = room.players.every(p => p.hand.length === 0);
  const winnerAnalysis = analyzePlay(room.currentRound[winner].cards, room.trumpSuit, room.isNoTrump);

  if (isLastRound && !winnerIsDealer && winnerAnalysis.suit === 'trump') {
    let multiplier = getBottomMultiplier(winnerAnalysis);
    const bottomScore = room.bottomCards.reduce((sum, c) => sum + getCardScore(c), 0) * multiplier;
    room.scores.team += bottomScore;
    const bottomScoreCards = room.bottomCards.filter(card => getCardScore(card) > 0);
    for (let i = 0; i < multiplier; i++) {
      room.scoringCards.push(...bottomScoreCards);
    }

    io.to(room.id).emit('koudi', {
      player: winnerPlayer,
      multiplier: multiplier,
      bottomCards: room.bottomCards,
      score: bottomScore
    });
  }

  if (!isLastRound && room.scores.team >= room.dealerScore && !room.earlyFinishOffered) {
    room.earlyFinishOffered = true;
    room.earlyFinishVotes = new Set();
    io.to(room.id).emit('early-finish-available', {
      teamScore: room.scores.team,
      targetScore: room.dealerScore,
      votes: 0,
      total: room.players.length
    });
  }

  io.to(room.id).emit('round-end', {
    winner: winnerPlayer,
    score: roundScore,
    totalScore: room.scores.team,
    scoringCards: room.scoringCards,
    plays: room.currentRound,
    isLastRound: isLastRound
  });

  room.currentRound = [];
  room.roundResolving = false;

  if (isLastRound) {
    endGame(room);
  } else {
    room.currentPlayer = winnerPlayer;
    io.to(room.id).emit('next-turn', { currentPlayer: winnerPlayer });
    scheduleTurn(room);
  }
}

function endGame(room, reason = 'normal') {
  clearTimeout(room.turnTimer);
  clearTimeout(room.roundTimer);
  room.deadline = null;
  room.state = 'ended';
  const finalScore = room.scores.team;
  const targetScore = room.dealerScore;

  let result;
  if (finalScore >= targetScore) {
    result = 'dealer-lost';
  } else {
    result = 'dealer-won';
  }

  const settlement = calculateSettlement(room, result, finalScore);
  room.nextBidder = room.dealer === null ? 0 : (result === 'dealer-won' ? room.dealer : (room.dealer + 1) % room.players.length);

  io.to(room.id).emit('game-end', {
    result,
    teamScore: finalScore,
    targetScore,
    dealer: room.dealer,
    settlement,
    reason
  });

  resetRoomForNextGame(room);
  io.to(room.id).emit('room-update', getRoomState(room));
}

// One authoritative timer per turn; stale callbacks cannot act on another game.
function scheduleTurn(room) {
  clearTimeout(room.turnTimer);
  room.turnTimer = null;
  const durations = { bidding: 20000, exchanging: 45000, 'choosing-trump': 20000, playing: 30000 };
  if (!durations[room.state] || room.roundResolving) {
    room.deadline = null;
    room.turnKey = null;
    io.to(room.id).emit('turn-clock', { deadline: null, state: room.state });
    return;
  }
  const index = room.state === 'bidding' ? room.currentBidder : room.state === 'playing' ? room.currentPlayer : room.dealer;
  const player = room.players[index];
  const key = [room.gameNumber, room.state, index, room.bidHistory.length, room.roundScores.length, room.currentRound.length].join(':');
  const proposed = Date.now() + (player.disconnected ? 2000 : durations[room.state]);
  room.deadline = room.turnKey === key && room.deadline ? Math.min(room.deadline, proposed) : proposed;
  room.turnKey = key;
  io.to(room.id).emit('turn-clock', { deadline: room.deadline, state: room.state, player: index, automatic: !!player.disconnected });
  room.turnTimer = setTimeout(() => {
    if (rooms.get(room.id) !== room || room.turnKey !== key || room.roundResolving) return;
    const handlers = {};
    const autoSocket = { id: player.id, roomId: room.id, on(event, handler) { handlers[event] = handler; }, emit() {} };
    registerGameplayEvents({ io, socket: autoSocket, rooms, getRoomState, emitBidUpdate,
      getActiveBidders, getNextBidder, handleAllPass, setDealer, endGame, isValidBid, validatePlay, finishRound, scheduleTurn });
    io.to(room.id).emit('automated-action', { player: index, state: room.state });
    if (room.state === 'bidding') handlers['place-bid']('pass');
    else if (room.state === 'exchanging') {
      const cards = [...player.hand].sort((a, b) => getCardScore(a) - getCardScore(b));
      handlers['finish-exchange'](cards.slice(0, 8));
    } else if (room.state === 'choosing-trump') handlers['choose-trump'](null, true);
    else if (room.state === 'playing') handlers['play-cards'](getAutoPlay(room, index));
  }, Math.max(0, room.deadline - Date.now()));
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
