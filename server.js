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
  getCardValue,
  shuffle
} = require('./src/game/cards');
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

function getRoomState(room) {
  return {
    id: room.id,
    state: room.state,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      seat: p.seat,
      isReady: p.isReady,
      isDealer: p.isDealer,
      settlementScore: p.settlementScore || 0,
      disconnected: !!p.disconnected,
      cardCount: p.hand.length
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

function getActiveBidders(room) {
  return room.players
    .map((_, index) => index)
    .filter(index => !room.passedBidders.has(index));
}

function getNextBidder(room) {
  const activeBidders = getActiveBidders(room);
  if (activeBidders.length === 0) return room.currentBidder;

  for (let step = 1; step <= room.players.length; step++) {
    const next = (room.currentBidder + step) % room.players.length;
    if (!room.passedBidders.has(next)) return next;
  }

  return activeBidders[0];
}

function isValidBid(room, bid) {
  if (!Number.isInteger(bid) || bid > 100 || bid < 75 || bid % 5 !== 0) return false;
  return room.hasValidBid ? bid < room.currentBid : true;
}

function getConstantTrumpCards(cards) {
  return cards.filter(card => card.suit === 'joker' || card.rank === '2' || card.rank === '7');
}

function getConstantTrumpCompareValue(card) {
  const suitOrder = { diamonds: 0, clubs: 1, hearts: 2, spades: 3 };
  if (card.rank === 'big') return 1000;
  if (card.rank === 'small') return 999;
  if (card.rank === '7') return 700 + (suitOrder[card.suit] || 0);
  if (card.rank === '2') return 200 + (suitOrder[card.suit] || 0);
  return 0;
}

function compareAllPassLoser(a, b) {
  if (a.count !== b.count) return b.count - a.count;

  const maxLength = Math.max(a.values.length, b.values.length);
  for (let i = 0; i < maxLength; i++) {
    const aValue = a.values[i] || 0;
    const bValue = b.values[i] || 0;
    if (aValue !== bValue) return bValue - aValue;
  }

  return a.index - b.index;
}

function handleAllPass(room) {
  const standings = room.players.map((player, index) => {
    const trumps = getConstantTrumpCards(player.hand);
    return {
      index,
      player,
      count: trumps.length,
      values: trumps.map(getConstantTrumpCompareValue).sort((a, b) => b - a)
    };
  }).sort(compareAllPassLoser);

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
    room.players[i].hand.sort((a, b) => {
      const rankOrder = { 'big': 100, 'small': 99, '2': 98, '7': 97, 'A': 14, 'K': 13, 'Q': 12, 'J': 11, '10': 10, '9': 9, '8': 8, '6': 6, '5': 5, '4': 4, '3': 3 };
      // 绾㈤粦鐩搁棿锛氶粦妗?榛?銆佺孩妗?绾?銆佹鑺?榛?銆佹柟鐗?绾? -> 浣嗘寜榛戠孩椤哄簭鎺掑垪
      const suitOrder = { 'spades': 4, 'hearts': 3, 'clubs': 2, 'diamonds': 1 };

      // 澶х帇銆佸皬鐜嬫渶鍓?
      if (a.rank === 'big') return -1;
      if (b.rank === 'big') return 1;
      if (a.rank === 'small') return -1;
      if (b.rank === 'small') return 1;

      // 鐒跺悗鏄?鍜?锛堝父涓伙級
      const aIsConstantTrump = a.rank === '7' || a.rank === '2';
      const bIsConstantTrump = b.rank === '7' || b.rank === '2';
      if (aIsConstantTrump && !bIsConstantTrump) return -1;
      if (!aIsConstantTrump && bIsConstantTrump) return 1;
      if (aIsConstantTrump && bIsConstantTrump) {
        if (a.rank !== b.rank) return (rankOrder[b.rank] || 0) - (rankOrder[a.rank] || 0);
        return suitOrder[b.suit] - suitOrder[a.suit];
      }

      // 鍓墝锛氱孩榛戠浉闂存帓鍒楋紙榛戞銆佺孩妗冦€佹鑺便€佹柟鐗囷級锛屽悓鑺辫壊鍐呮寜澶у皬
      if (a.suit !== b.suit) return suitOrder[b.suit] - suitOrder[a.suit];
      return (rankOrder[b.rank] || 0) - (rankOrder[a.rank] || 0);
    });

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

// 楠岃瘉鍑虹墝鍚堟硶鎬?
// 鍒ゆ柇鏄惁涓哄綋鍓嶄富鐗岋紙鍖呮嫭甯镐富鍜屼富鑺辫壊锛?
function isTrumpCard(card, trumpSuit, isNoTrump) {
  if (card.suit === 'joker') return true;
  if (card.rank === '2' || card.rank === '7') return true;
  if (!isNoTrump && card.suit === trumpSuit) return true;
  return false;
}

function getEffectiveSuit(card, trumpSuit, isNoTrump) {
  return isTrumpCard(card, trumpSuit, isNoTrump) ? 'trump' : card.suit;
}

function countEffectiveSuit(cards, suit, trumpSuit, isNoTrump) {
  return cards.filter(c => getEffectiveSuit(c, trumpSuit, isNoTrump) === suit).length;
}

function getFollowSuitKey(cards, trumpSuit, isNoTrump) {
  const leadSuit = getEffectiveSuit(cards[0], trumpSuit, isNoTrump);
  return leadSuit;
}

function matchesFollowSuit(card, suitKey, trumpSuit, isNoTrump) {
  return getEffectiveSuit(card, trumpSuit, isNoTrump) === suitKey;
}

function getFollowSuitCards(cards, suitKey, trumpSuit, isNoTrump) {
  return cards.filter(card => matchesFollowSuit(card, suitKey, trumpSuit, isNoTrump));
}

function countFollowSuit(cards, suitKey, trumpSuit, isNoTrump) {
  return getFollowSuitCards(cards, suitKey, trumpSuit, isNoTrump).length;
}

function getRankIndex(card, trumpSuit, isNoTrump) {
  const normalOrder = ['3', '4', '5', '6', '8', '9', '10', 'J', 'Q', 'K', 'A'];

  if (getEffectiveSuit(card, trumpSuit, isNoTrump) === 'trump') {
    if (card.rank === 'big') return 16;
    if (card.rank === 'small') return 15;
    if (card.rank === '7') return (!isNoTrump && card.suit === trumpSuit) ? 14 : 13;
    if (card.rank === '2') return (!isNoTrump && card.suit === trumpSuit) ? 12 : 11;
    return normalOrder.indexOf(card.rank);
  }

  if (card.rank === 'big') return 100;
  if (card.rank === 'small') return 99;
  return normalOrder.indexOf(card.rank);
}

function getFaceKey(card) {
  return `${card.suit}-${card.rank}`;
}

function getPairGroups(cards, trumpSuit, isNoTrump) {
  const groups = new Map();
  for (const card of cards) {
    const key = getFaceKey(card);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(card);
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

function findLongestTractor(pairGroups) {
  let best = [];
  let current = [];

  for (const group of pairGroups) {
    const previous = current[current.length - 1];
    if (!previous || group.rankIndex === previous.rankIndex + 1) {
      current.push(group);
    } else {
      current = [group];
    }
    if (current.length > best.length) best = current.slice();
  }

  return best.length >= 2 ? best : [];
}

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

function handHasPair(cards, suit, trumpSuit, isNoTrump) {
  return getPairGroups(cards.filter(card => getEffectiveSuit(card, trumpSuit, isNoTrump) === suit), trumpSuit, isNoTrump).length > 0;
}

function handHasTractor(cards, suit, trumpSuit, isNoTrump, minLength = 2) {
  const suitedCards = cards.filter(card => getEffectiveSuit(card, trumpSuit, isNoTrump) === suit);
  return findLongestTractor(getPairGroups(suitedCards, trumpSuit, isNoTrump)).length >= minLength;
}

function followSuitHasPair(cards, suitKey, trumpSuit, isNoTrump) {
  return getPairGroups(getFollowSuitCards(cards, suitKey, trumpSuit, isNoTrump), trumpSuit, isNoTrump).length > 0;
}

function followSuitHasTractor(cards, suitKey, trumpSuit, isNoTrump, minLength = 2) {
  return findLongestTractor(getPairGroups(getFollowSuitCards(cards, suitKey, trumpSuit, isNoTrump), trumpSuit, isNoTrump)).length >= minLength;
}

function playSatisfiesStructure(playAnalysis, leadAnalysis) {
  if (leadAnalysis.type === 'tractor') return playAnalysis.type === 'tractor' && playAnalysis.tractorLength >= leadAnalysis.tractorLength;
  if (leadAnalysis.type === 'pair') return playAnalysis.pairCount >= 1;
  if (leadAnalysis.tractorLength >= 2) return playAnalysis.tractorLength >= leadAnalysis.tractorLength;
  if (leadAnalysis.pairCount > 0) return playAnalysis.pairCount >= leadAnalysis.pairCount;
  return true;
}

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

  if (leadAnalysis.type === 'single') return current.compareValue > winning.compareValue;
  if (leadAnalysis.type === 'pair') return current.type === 'pair' && winning.type === 'pair' && current.compareValue > winning.compareValue;
  if (leadAnalysis.type === 'tractor') {
    return current.type === 'tractor' && winning.type === 'tractor' &&
      current.tractorLength === leadAnalysis.tractorLength &&
      winning.tractorLength === leadAnalysis.tractorLength &&
      current.compareValue > winning.compareValue;
  }

  return current.minValue > winning.minValue;
}

function getBottomMultiplier(analysis) {
  if (analysis.type === 'pair') return 2;
  if (analysis.type === 'tractor') return analysis.tractorLength * 2;
  if (analysis.type === 'throw') return analysis.length;
  return 1;
}

function calculateSettlement(room, result, finalScore) {
  const baseScore = Number(room.settlementSettings?.baseScore) || 0;
  const levelScore = Number(room.settlementSettings?.levelScore) || 0;
  const bidSteps = Math.max(0, (100 - room.dealerScore) / 5);
  const baseUnit = baseScore + bidSteps * levelScore;
  let multiplier = 1;
  let special = null;

  if (result !== 'dealer-lost' && finalScore === 0) {
    multiplier = 3;
    special = 'qingguang';
  } else if (result !== 'dealer-lost' && finalScore < 30) {
    multiplier = 2;
    special = 'bianguang';
  }

  const unit = baseUnit * multiplier;
  const deltas = room.players.map((player, index) => {
    if (index === room.dealer) {
      return result === 'dealer-lost' ? -unit * 3 : unit * 3;
    }
    return result === 'dealer-lost' ? unit : -unit;
  });

  room.players.forEach((player, index) => {
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
    totals: room.players.map(player => player.settlementScore || 0)
  };
}

function validatePlay(room, cards, playerIndex) {
  const player = room.players[playerIndex];

  if (!Array.isArray(cards) || cards.length === 0) {
    return { valid: false, message: '请选择要出的牌' };
  }

  const selectedIds = new Set();
  for (const card of cards) {
    if (!card || selectedIds.has(card.id) || !player.hand.some(c => c.id === card.id)) {
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
  const requiredFollowCount = Math.min(leadAnalysis.length, leadSuitInHand);
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

    if (leadAnalysis.type === 'tractor' || leadAnalysis.tractorLength >= 2) {
      if (obligationSuitInHand >= leadAnalysis.tractorLength * 2 &&
          hasObligationTractor) {
        return structureAnalysis.valid && structureAnalysis.type === 'tractor' && structureAnalysis.tractorLength === leadAnalysis.tractorLength
          ? { valid: true }
          : { valid: false, message: '必须用同花色拖拉机跟牌' };
      }
      if (obligationSuitInHand >= 2 &&
          hasObligationPair) {
        return structureAnalysis.valid && structureAnalysis.pairCount > 0
          ? { valid: true }
          : { valid: false, message: '必须用同花色对子跟牌' };
      }
    }

    if ((leadAnalysis.type === 'pair' || leadAnalysis.pairCount > 0) &&
        obligationSuitInHand >= 2 &&
        hasObligationPair) {
      return structureAnalysis.valid && structureAnalysis.pairCount > 0
        ? { valid: true }
        : { valid: false, message: '必须跟对子' };
    }
  }

  return { valid: true };
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

function resetRoomForNextGame(room) {
  room.state = 'waiting';
  room.gameNumber++;
  room.players.forEach(p => {
    p.isDealer = false;
    p.isReady = false;
    p.hand = [];
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
