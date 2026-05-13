const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { UserStore } = require('./auth-store');
const {
  getAuthUserFromSocket,
  registerAuthRoutes
} = require('./src/http/auth-routes');
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
  validatePlay
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

const userStore = new UserStore();

app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname, 'public')));
registerAuthRoutes(app, userStore);

// 娓告垙鎴块棿瀛樺偍
const rooms = new Map();

// Socket.io杩炴帴澶勭悊
io.on('connection', (socket) => {
  console.log('New connection:', socket.id);
  socket.authUser = getAuthUserFromSocket(userStore, socket);

  // 鍒涘缓鎴块棿
  registerRoomLifecycleEvents({
    io,
    socket,
    rooms,
    userStore,
    getRoomState,
    startGame
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
    finishRound
  });

});

// 寮€濮嬫父鎴?
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

  // 鍙戠墝锛氭瘡浜?5寮狅紝8寮犲簳鐗?(鍏?08寮?
  room.bottomCards = room.deck.slice(0, 8);
  let cardIndex = 8;

  for (let i = 0; i < 4; i++) {
    room.players[i].hand = room.deck.slice(cardIndex, cardIndex + 25);
    cardIndex += 25;

    // 鍒濆鎺掑簭锛堟棤涓绘椂锛夛細甯镐富(2銆?銆佺帇)浼樺厛锛屽壇鐗岀孩榛戠浉闂?
    room.players[i].hand.sort(sortCardsForInitialDeal);
      // 绾㈤粦鐩搁棿锛氶粦妗?榛?銆佺孩妗?绾?銆佹鑺?榛?銆佹柟鐗?绾? -> 浣嗘寜榛戠孩椤哄簭鎺掑垪

      // 澶х帇銆佸皬鐜嬫渶鍓?

      // 鐒跺悗鏄?鍜?锛堝父涓伙級

      // 鍓墝锛氱孩榛戠浉闂存帓鍒楋紙榛戞銆佺孩妗冦€佹鑺便€佹柟鐗囷級锛屽悓鑺辫壊鍐呮寜澶у皬

    // 鍙戦€佹墜鐗岀粰鐜╁
    io.to(room.players[i].id).emit('deal-cards', room.players[i].hand);
  }

  // 纭畾绗竴涓彨鍒嗚€?
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
}

function finishRound(room) {
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

  // 闂插寰楀垎
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

  // 妫€鏌ユ槸鍚︽槸鏈€鍚庝竴杞紙鎶犲簳锛?
  const isLastRound = room.players.every(p => p.hand.length === 0);
  const winnerAnalysis = analyzePlay(room.currentRound[winner].cards, room.trumpSuit, room.isNoTrump);

  if (isLastRound && !winnerIsDealer && winnerAnalysis.suit === 'trump') {
    // 鎶犲簳
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
  }
}

// 缁撴潫娓告垙
function endGame(room, reason = 'normal') {
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
  room.nextBidder = room.dealer === null ? 0 : (room.dealer + 1) % room.players.length;

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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
