const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// 游戏房间存储
const rooms = new Map();

// 扑克牌定义
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['3', '4', '5', '6', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const TRUMP_RANKS = ['2', '7'];
const JOKERS = [{ suit: 'joker', rank: 'big', name: '大王' }, { suit: 'joker', rank: 'small', name: '小王' }];

// 创建两副牌（108张，不去掉3和4）
function createDeck() {
  const deck = [];
  // 两副普通牌
  for (let d = 0; d < 2; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ suit, rank, id: `${suit}-${rank}-${d}`, deck: d });
      }
      // 加入2和7作为常主
      for (const rank of TRUMP_RANKS) {
        deck.push({ suit, rank, id: `${suit}-${rank}-${d}`, deck: d, isTrump: true });
      }
    }
    // 加入大小王
    deck.push({ ...JOKERS[0], id: `big-joker-${d}`, deck: d, isTrump: true });
    deck.push({ ...JOKERS[1], id: `small-joker-${d}`, deck: d, isTrump: true });
  }
  return deck;
}

// 洗牌
function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// 计算牌的分值
function getCardScore(card) {
  if (card.rank === '5') return 5;
  if (card.rank === '10' || card.rank === 'K') return 10;
  return 0;
}

// 获取手牌显示排序值（越大越靠前）
// 顺序：大王 > 小王 > 主7 > 副7 > 主2 > 副2 > 主A > 主K > ... > 主3 > 其他花色
function getCardDisplayValue(card, trumpSuit, isNoTrump) {
  // 大王
  if (card.rank === 'big') return 1000;
  // 小王
  if (card.rank === 'small') return 999;
  // 主7
  if (card.rank === '7' && !isNoTrump && card.suit === trumpSuit) return 998;
  // 副7
  if (card.rank === '7') return 997;
  // 主2
  if (card.rank === '2' && !isNoTrump && card.suit === trumpSuit) return 996;
  // 副2
  if (card.rank === '2') return 995;

  // 主牌花色（非2、非7）
  if (!isNoTrump && card.suit === trumpSuit) {
    const rankValue = { 'A': 14, 'K': 13, 'Q': 12, 'J': 11, '10': 10, '9': 9, '8': 8, '6': 6, '5': 5, '4': 4, '3': 3 };
    return 500 + (rankValue[card.rank] || 0);
  }

  // 其他副牌
  const rankValue = { 'A': 14, 'K': 13, 'Q': 12, 'J': 11, '10': 10, '9': 9, '8': 8, '6': 6, '5': 5, '4': 4, '3': 3 };
  const suitOrder = { 'spades': 4, 'hearts': 3, 'diamonds': 2, 'clubs': 1 };
  return suitOrder[card.suit] * 20 + (rankValue[card.rank] || 0);
}

// 手牌显示排序 - 主牌优先，副牌红黑相间
function sortCardsForDisplay(a, b, trumpSuit, isNoTrump) {
  // 首先按显示值排序（主牌在前）
  const aValue = getCardDisplayValue(a, trumpSuit, isNoTrump);
  const bValue = getCardDisplayValue(b, trumpSuit, isNoTrump);

  // 如果都在副牌区域（<500），按红黑相间排序
  if (aValue < 500 && bValue < 500) {
    const suitOrder = { 'spades': 4, 'hearts': 3, 'clubs': 2, 'diamonds': 1 }; // 黑桃(黑)、红桃(红)、梅花(黑)、方片(红)
    if (a.suit !== b.suit) {
      return suitOrder[b.suit] - suitOrder[a.suit];
    }
    // 同花色按大小
    const rankOrder = { 'A': 14, 'K': 13, 'Q': 12, 'J': 11, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3 };
    return (rankOrder[b.rank] || 0) - (rankOrder[a.rank] || 0);
  }

  return bValue - aValue;
}

// 获取牌的大小（用于比较）
function getCardValue(card, trumpSuit, isNoTrump) {
  const suitOrder = { 'spades': 3, 'hearts': 2, 'diamonds': 1, 'clubs': 0 };

  // 大王
  if (card.rank === 'big') return 1000;
  // 小王
  if (card.rank === 'small') return 999;
  // 主7
  if (card.rank === '7' && card.suit === trumpSuit && !isNoTrump) return 998;
  // 副7
  if (card.rank === '7') return 200 + suitOrder[card.suit];
  // 主2
  if (card.rank === '2' && card.suit === trumpSuit && !isNoTrump) return 197;
  // 副2
  if (card.rank === '2') return 100 + suitOrder[card.suit];

  // 主牌其他
  if (card.suit === trumpSuit && !isNoTrump) {
    const rankValue = { 'A': 14, 'K': 13, 'Q': 12, 'J': 11, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3 };
    return 50 + rankValue[card.rank];
  }

  // 副牌
  const rankValue = { 'A': 14, 'K': 13, 'Q': 12, 'J': 11, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3 };
  return rankValue[card.rank];
}

// 创建新房间
function createRoom(roomId) {
  return {
    id: roomId,
    players: [],
    state: 'waiting', // waiting, bidding, playing, ended
    deck: [],
    bottomCards: [],
    currentBidder: 0,
    currentBid: 100,
    dealer: null,
    trumpSuit: null,
    isNoTrump: false,
    currentPlayer: 0,
    currentRound: [],
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

function normalizePlayerPayload(payload) {
  if (typeof payload === 'string') {
    return { name: payload.trim(), sessionId: null };
  }

  return {
    name: String(payload?.name || '').trim(),
    sessionId: payload?.sessionId || null
  };
}

function normalizeSettlementSettings(settings) {
  const baseScore = Number(settings?.baseScore);
  const levelScore = Number(settings?.levelScore);
  return {
    baseScore: Number.isFinite(baseScore) && baseScore >= 0 ? Math.floor(baseScore) : 1,
    levelScore: Number.isFinite(levelScore) && levelScore >= 0 ? Math.floor(levelScore) : 1
  };
}

function attachSocketToPlayer(socket, room, player) {
  if (player.disconnectTimer) {
    clearTimeout(player.disconnectTimer);
    player.disconnectTimer = null;
  }

  player.id = socket.id;
  player.disconnected = false;
  socket.join(room.id);
  socket.roomId = room.id;
  socket.playerId = socket.id;
  socket.sessionId = player.sessionId;
}

// Socket.io连接处理
io.on('connection', (socket) => {
  console.log('New connection:', socket.id);

  // 创建房间
  socket.on('create-room', (playerPayload, callback) => {
    const { name: playerName, sessionId } = normalizePlayerPayload(playerPayload);
    if (!playerName) {
      callback({ success: false, error: '请输入昵称' });
      return;
    }

    const roomId = uuidv4().slice(0, 8);
    const room = createRoom(roomId);
    room.settlementSettings = normalizeSettlementSettings(playerPayload?.settlementSettings);

    const player = {
      id: socket.id,
      sessionId: sessionId || uuidv4(),
      name: playerName,
      seat: 0,
      hand: [],
      isReady: false,
      isDealer: false,
      settlementScore: 0,
      disconnected: false,
      disconnectTimer: null
    };

    room.players.push(player);
    rooms.set(roomId, room);
    attachSocketToPlayer(socket, room, player);

    callback({ success: true, roomId, playerId: socket.id, sessionId: player.sessionId });
    io.to(roomId).emit('room-update', getRoomState(room));
  });

  // 加入房间
  socket.on('join-room', (roomId, playerPayload, callback) => {
    const { name: playerName, sessionId } = normalizePlayerPayload(playerPayload);
    const room = rooms.get(roomId);

    if (!room) {
      callback({ success: false, error: '房间不存在' });
      return;
    }

    if (!playerName) {
      callback({ success: false, error: '请输入昵称' });
      return;
    }

    if (sessionId) {
      const existingPlayer = room.players.find(p => p.sessionId === sessionId);
      if (existingPlayer) {
        existingPlayer.name = playerName;
        attachSocketToPlayer(socket, room, existingPlayer);
        callback({ success: true, roomId, playerId: socket.id, sessionId: existingPlayer.sessionId, rejoined: true });
        io.to(room.id).emit('room-update', getRoomState(room));
        return;
      }
    }

    const duplicateName = room.players.some(p => p.name.trim().toLowerCase() === playerName.toLowerCase());
    if (duplicateName) {
      callback({ success: false, error: '该昵称已在房间中，请直接回到原页面或更换昵称' });
      return;
    }

    if (room.players.length >= 4) {
      callback({ success: false, error: '房间已满' });
      return;
    }

    if (room.state !== 'waiting') {
      callback({ success: false, error: '游戏已开始' });
      return;
    }

    const player = {
      id: socket.id,
      sessionId: sessionId || uuidv4(),
      name: playerName,
      seat: room.players.length,
      hand: [],
      isReady: false,
      isDealer: false,
      settlementScore: 0,
      disconnected: false,
      disconnectTimer: null
    };

    room.players.push(player);
    attachSocketToPlayer(socket, room, player);

    callback({ success: true, roomId, playerId: socket.id, sessionId: player.sessionId });
    io.to(roomId).emit('room-update', getRoomState(room));
  });

  // 玩家准备
  socket.on('rejoin-room', (data, callback = () => {}) => {
    const roomId = data?.roomId;
    const sessionId = data?.sessionId;
    const room = rooms.get(roomId);

    if (!room || !sessionId) {
      callback({ success: false });
      return;
    }

    const player = room.players.find(p => p.sessionId === sessionId);
    if (!player) {
      callback({ success: false });
      return;
    }

    attachSocketToPlayer(socket, room, player);
    callback({ success: true, roomId, playerId: socket.id, sessionId });
    io.to(room.id).emit('room-update', getRoomState(room));
  });

  socket.on('player-ready', (isReady) => {
    const room = rooms.get(socket.roomId);
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.isReady = isReady;
      io.to(room.id).emit('room-update', getRoomState(room));

      // 检查是否所有玩家都准备好
      if (room.players.length === 4 && room.players.every(p => p.isReady)) {
        startGame(room);
      }
    }
  });

  // 叫分
  socket.on('place-bid', (bid) => {
    const room = rooms.get(socket.roomId);
    if (!room || room.state !== 'bidding') return;

    const currentPlayer = room.players[room.currentBidder];
    if (currentPlayer.id !== socket.id) return;

    if (room.passedBidders.has(room.currentBidder)) {
      room.currentBidder = getNextBidder(room);
      emitBidUpdate(room);
      return;
    }

    if (bid === 'pass') {
      if (room.passedBidders.has(room.currentBidder)) return;
      room.passedBidders.add(room.currentBidder);
      room.bidHistory.push({ player: currentPlayer.name, bid: 'pass' });
      room.currentBidder = getNextBidder(room);

      // 检查是否只剩一个人没pass
      const activeBidders = getActiveBidders(room);

      if (activeBidders.length === 0) {
        handleAllPass(room);
        return;
      }

      if (activeBidders.length === 1 && room.hasValidBid) {
        // 确定庄家
        setDealer(room, activeBidders[0], room.currentBid);
        return;

        // 底牌加入庄家手牌，让庄家选8张作为新底牌
      }
    } else {
      if (!isValidBid(room, bid)) {
        socket.emit('invalid-bid', '无效的叫分');
        return;
      }

      room.currentBid = bid;
      room.hasValidBid = true;
      room.bidHistory.push({ player: currentPlayer.name, bid });
      room.currentBidder = getNextBidder(room);

      // 叫到75直接成为庄家
      if (bid === 75) {
        setDealer(room, room.players.findIndex(p => p.id === currentPlayer.id), 75);
        return;
        // 底牌加入庄家手牌，让庄家选8张作为新底牌
      }
    }

    emitBidUpdate(room);
  });

  socket.on('vote-end-game', () => {
    const room = rooms.get(socket.roomId);
    if (!room || room.state !== 'playing' || room.scores.team < room.dealerScore) return;

    const voterIndex = room.players.findIndex(p => p.id === socket.id);
    if (voterIndex === -1) return;

    room.earlyFinishVotes.add(voterIndex);
    io.to(room.id).emit('early-finish-vote-update', {
      votes: room.earlyFinishVotes.size,
      total: room.players.length,
      voters: [...room.earlyFinishVotes]
    });

    if (room.earlyFinishVotes.size === room.players.length) {
      endGame(room, 'early');
    }
  });

  // 选择主牌
  socket.on('choose-trump', (suit, isNoTrump) => {
    const room = rooms.get(socket.roomId);
    if (!room || room.state !== 'choosing-trump') return;

    const dealer = room.players[room.dealer];
    if (dealer.id !== socket.id) return;

    room.trumpSuit = suit;
    room.isNoTrump = isNoTrump;
    room.state = 'playing';
    room.currentPlayer = room.dealer;

    // 重新排序所有玩家的手牌（主牌优先，同花色，牌大小）
    for (const player of room.players) {
      player.hand.sort((a, b) => sortCardsForDisplay(a, b, suit, isNoTrump));
      // 发送排序后的手牌给玩家
      io.to(player.id).emit('hand-sorted', player.hand);
    }

    // 通知所有玩家主牌和游戏开始
    io.to(room.id).emit('trump-chosen', {
      trumpSuit: suit,
      isNoTrump: isNoTrump,
      dealer: room.dealer
    });

    // 开始游戏
    io.to(room.id).emit('game-start', {
      currentPlayer: room.currentPlayer,
      trumpSuit: room.trumpSuit,
      isNoTrump: room.isNoTrump
    });
  });

  // 完成底牌选择
  socket.on('finish-exchange', (newBottomCards) => {
    const room = rooms.get(socket.roomId);
    if (!room || room.state !== 'exchanging') return;

    const dealer = room.players[room.dealer];
    if (dealer.id !== socket.id) return;

    // 设置新底牌
    if (!Array.isArray(newBottomCards) || newBottomCards.length !== 8) {
      socket.emit('invalid-play', '请选择8张底牌');
      return;
    }

    const selectedIds = new Set();
    for (const card of newBottomCards) {
      if (!card || selectedIds.has(card.id) || !dealer.hand.some(c => c.id === card.id)) {
        socket.emit('invalid-play', '底牌选择无效');
        return;
      }
      selectedIds.add(card.id);
    }

    room.bottomCards = newBottomCards;
    dealer.hand = dealer.hand.filter(card => !selectedIds.has(card.id));
    dealer.hand.sort((a, b) => sortCardsForDisplay(a, b, room.trumpSuit, room.isNoTrump));
    io.to(dealer.id).emit('hand-sorted', dealer.hand);

    // 进入叫主阶段
    room.state = 'choosing-trump';

    // 通知庄家叫主
    io.to(dealer.id).emit('choose-trump-request');
    io.to(room.id).emit('waiting-trump', { dealer: room.dealer });
  });

  // 出牌
  socket.on('play-cards', (cards) => {
    const room = rooms.get(socket.roomId);
    if (!room || room.state !== 'playing') return;

    if (room.players[room.currentPlayer].id !== socket.id) return;

    // 验证牌型合法性
    const validation = validatePlay(room, cards, room.currentPlayer);
    if (!validation.valid) {
      socket.emit('invalid-play', validation.message);
      return;
    }

    // 从玩家手牌中移除
    const player = room.players[room.currentPlayer];
    for (const card of cards) {
      const idx = player.hand.findIndex(c => c.id === card.id);
      if (idx !== -1) player.hand.splice(idx, 1);
    }

    // 记录出牌
    const play = {
      player: room.currentPlayer,
      cards: cards,
      isDealer: player.isDealer
    };
    room.currentRound.push(play);

    // 通知所有玩家
    io.to(room.id).emit('cards-played', {
      player: room.currentPlayer,
      cards: cards,
      nextPlayer: (room.currentPlayer + 1) % 4
    });

    room.currentPlayer = (room.currentPlayer + 1) % 4;

    // 一轮结束
    if (room.currentRound.length === 4) {
      setTimeout(() => finishRound(room), 1000);
    }
  });

  // 聊天消息
  socket.on('chat-message', (message) => {
    const room = rooms.get(socket.roomId);
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      io.to(room.id).emit('chat-message', {
        player: player.name,
        message: message
      });
    }
  });

  // 断开连接
  socket.on('disconnect', () => {
    const room = rooms.get(socket.roomId);
    if (room) {
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        const player = room.players[idx];
        player.disconnected = true;
        io.to(room.id).emit('room-update', getRoomState(room));

        player.disconnectTimer = setTimeout(() => {
          const currentRoom = rooms.get(room.id);
          if (!currentRoom) return;

          const currentIdx = currentRoom.players.findIndex(p => p.sessionId === player.sessionId && p.disconnected);
          if (currentIdx === -1) return;

          currentRoom.players.splice(currentIdx, 1);
          currentRoom.players.forEach((p, seat) => { p.seat = seat; });

          if (currentRoom.players.length === 0) {
            rooms.delete(room.id);
          } else {
            io.to(currentRoom.id).emit('player-left', { playerId: socket.id });
            io.to(currentRoom.id).emit('room-update', getRoomState(currentRoom));
          }
        }, 60000);
      }
    }
  });
});

// 获取房间状态（隐藏敏感信息）
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
    dealer: room.dealer,
    trumpSuit: room.trumpSuit,
    isNoTrump: room.isNoTrump,
    currentPlayer: room.currentPlayer,
    gameNumber: room.gameNumber
  };
}

// 开始游戏
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
  room.players.forEach(p => { p.isDealer = false; });
  room.currentBid = 100;
  room.dealer = null;
  room.trumpSuit = null;
  room.isNoTrump = false;
  room.currentRound = [];
  room.roundScores = [];
  room.scores.team = 0;
  room.scoringCards = [];
  room.dealerScore = 0;
  room.bidHistory = [];
  room.passedBidders = new Set();
  room.hasValidBid = false;
  room.earlyFinishVotes = new Set();
  room.earlyFinishOffered = false;

  // 发牌：每人25张，8张底牌 (共108张)
  room.bottomCards = room.deck.slice(0, 8);
  let cardIndex = 8;

  for (let i = 0; i < 4; i++) {
    room.players[i].hand = room.deck.slice(cardIndex, cardIndex + 25);
    cardIndex += 25;

    // 初始排序（无主时）：常主(2、7、王)优先，副牌红黑相间
    room.players[i].hand.sort((a, b) => {
      const rankOrder = { 'big': 100, 'small': 99, '2': 98, '7': 97, 'A': 14, 'K': 13, 'Q': 12, 'J': 11, '10': 10, '9': 9, '8': 8, '6': 6, '5': 5, '4': 4, '3': 3 };
      // 红黑相间：黑桃(黑)、红桃(红)、梅花(黑)、方片(红) -> 但按黑红顺序排列
      const suitOrder = { 'spades': 4, 'hearts': 3, 'clubs': 2, 'diamonds': 1 };

      // 大王、小王最前
      if (a.rank === 'big') return -1;
      if (b.rank === 'big') return 1;
      if (a.rank === 'small') return -1;
      if (b.rank === 'small') return 1;

      // 然后是7和2（常主）
      const aIsConstantTrump = a.rank === '7' || a.rank === '2';
      const bIsConstantTrump = b.rank === '7' || b.rank === '2';
      if (aIsConstantTrump && !bIsConstantTrump) return -1;
      if (!aIsConstantTrump && bIsConstantTrump) return 1;
      if (aIsConstantTrump && bIsConstantTrump) {
        if (a.rank !== b.rank) return (rankOrder[b.rank] || 0) - (rankOrder[a.rank] || 0);
        return suitOrder[b.suit] - suitOrder[a.suit];
      }

      // 副牌：红黑相间排列（黑桃、红桃、梅花、方片），同花色内按大小
      if (a.suit !== b.suit) return suitOrder[b.suit] - suitOrder[a.suit];
      return (rankOrder[b.rank] || 0) - (rankOrder[a.rank] || 0);
    });

    // 发送手牌给玩家
    io.to(room.players[i].id).emit('deal-cards', room.players[i].hand);
  }

  // 确定第一个叫分者
  room.currentBidder = (room.nextBidder || 0) % room.players.length;

  io.to(room.id).emit('game-started', {
    currentBidder: room.currentBidder,
    currentBid: room.currentBid,
    hasValidBid: room.hasValidBid,
    teamScore: room.scores.team,
    bottomCardCount: 8
  });
}

// 验证出牌合法性
// 判断是否为当前主牌（包括常主和主花色）
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
    return { valid: false, message: '请选择要出的牌。' };
  }

  const selectedIds = new Set();
  for (const card of cards) {
    if (!card || selectedIds.has(card.id) || !player.hand.some(c => c.id === card.id)) {
      return { valid: false, message: '所选牌无效或不在当前手牌中。' };
    }
    selectedIds.add(card.id);
  }

  if (room.currentRound.length === 0) {
    return analyzePlay(cards, room.trumpSuit, room.isNoTrump).valid
      ? { valid: true }
      : { valid: false, message: '首家出牌必须是同一有效花色的合法牌型。' };
  }

  const firstPlay = room.currentRound[0];
  const leadAnalysis = analyzePlay(firstPlay.cards, room.trumpSuit, room.isNoTrump);
  if (!leadAnalysis.valid || cards.length !== leadAnalysis.length) {
    return { valid: false, message: `本轮必须出 ${firstPlay.cards.length} 张牌。` };
  }

  const leadFollowSuit = getFollowSuitKey(firstPlay.cards, room.trumpSuit, room.isNoTrump);
  const leadSuitInHand = countFollowSuit(player.hand, leadFollowSuit, room.trumpSuit, room.isNoTrump);
  const requiredFollowCount = Math.min(leadAnalysis.length, leadSuitInHand);
  const playedLeadSuitCount = countFollowSuit(cards, leadFollowSuit, room.trumpSuit, room.isNoTrump);
  if (playedLeadSuitCount < requiredFollowCount) {
    return { valid: false, message: '有首家花色时必须优先跟足。' };
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
        return structureAnalysis.valid && structureAnalysis.type === 'tractor' && structureAnalysis.tractorLength >= leadAnalysis.tractorLength
          ? { valid: true }
          : { valid: false, message: '你有对应拖拉机时必须跟拖拉机。' };
      }
      if (obligationSuitInHand >= 2 &&
          hasObligationPair) {
        return structureAnalysis.valid && structureAnalysis.pairCount > 0
          ? { valid: true }
          : { valid: false, message: '你没有拖拉机但有对子时，必须优先跟对子。' };
      }
    }

    if ((leadAnalysis.type === 'pair' || leadAnalysis.pairCount > 0) &&
        obligationSuitInHand >= 2 &&
        hasObligationPair) {
      return structureAnalysis.valid && structureAnalysis.pairCount > 0
        ? { valid: true }
        : { valid: false, message: '你有对子时必须跟对子。' };
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

  // 闲家得分
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

  // 检查是否是最后一轮（抠底）
  const isLastRound = room.players.every(p => p.hand.length === 0);
  const winnerAnalysis = analyzePlay(room.currentRound[winner].cards, room.trumpSuit, room.isNoTrump);

  if (isLastRound && !winnerIsDealer && winnerAnalysis.suit === 'trump') {
    // 抠底
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

  if (isLastRound) {
    endGame(room);
  } else {
    room.currentPlayer = winnerPlayer;
    io.to(room.id).emit('next-turn', { currentPlayer: winnerPlayer });
  }
}

// 结束游戏
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
  room.currentRound = [];
  room.roundScores = [];
  room.passedBidders = new Set();
  room.hasValidBid = false;
  room.earlyFinishVotes = new Set();
  room.earlyFinishOffered = false;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
