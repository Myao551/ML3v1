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
const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
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

// 手牌显示排序
function sortCardsForDisplay(a, b, trumpSuit, isNoTrump) {
  const aValue = getCardDisplayValue(a, trumpSuit, isNoTrump);
  const bValue = getCardDisplayValue(b, trumpSuit, isNoTrump);
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
    dealerScore: 0,
    roundScores: [],
    bidHistory: [],
    gameNumber: 1,
    lastWinner: null
  };
}

// Socket.io连接处理
io.on('connection', (socket) => {
  console.log('New connection:', socket.id);

  // 创建房间
  socket.on('create-room', (playerName, callback) => {
    const roomId = uuidv4().slice(0, 8);
    const room = createRoom(roomId);

    const player = {
      id: socket.id,
      name: playerName,
      seat: 0,
      hand: [],
      isReady: false,
      isDealer: false
    };

    room.players.push(player);
    rooms.set(roomId, room);
    socket.join(roomId);
    socket.roomId = roomId;
    socket.playerId = socket.id;

    callback({ success: true, roomId, playerId: socket.id });
    io.to(roomId).emit('room-update', getRoomState(room));
  });

  // 加入房间
  socket.on('join-room', (roomId, playerName, callback) => {
    const room = rooms.get(roomId);

    if (!room) {
      callback({ success: false, error: '房间不存在' });
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
      name: playerName,
      seat: room.players.length,
      hand: [],
      isReady: false,
      isDealer: false
    };

    room.players.push(player);
    socket.join(roomId);
    socket.roomId = roomId;
    socket.playerId = socket.id;

    callback({ success: true, roomId, playerId: socket.id });
    io.to(roomId).emit('room-update', getRoomState(room));
  });

  // 玩家准备
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

    if (bid === 'pass') {
      room.bidHistory.push({ player: currentPlayer.name, bid: 'pass' });
      room.currentBidder = (room.currentBidder + 1) % 4;

      // 检查是否只剩一个人没pass
      const activeBidders = room.players.filter((p, i) =>
        !room.bidHistory.some(h => h.player === p.name && h.bid === 'pass')
      );

      if (activeBidders.length === 1) {
        // 确定庄家
        const winner = room.players[room.currentBidder];
        winner.isDealer = true;
        room.dealer = room.currentBidder;
        room.dealerScore = room.currentBid;
        room.state = 'exchanging';

        // 底牌加入庄家手牌，让庄家选8张作为新底牌
        io.to(winner.id).emit('exchange-cards', room.bottomCards);
      }
    } else {
      room.currentBid = bid;
      room.bidHistory.push({ player: currentPlayer.name, bid });
      room.currentBidder = (room.currentBidder + 1) % 4;

      // 叫到75直接成为庄家
      if (bid === 75) {
        currentPlayer.isDealer = true;
        room.dealer = room.currentBidder - 1;
        if (room.dealer < 0) room.dealer = 3;
        room.dealerScore = 75;
        room.state = 'exchanging';
        // 底牌加入庄家手牌，让庄家选8张作为新底牌
        io.to(currentPlayer.id).emit('exchange-cards', room.bottomCards);
      }
    }

    io.to(room.id).emit('bid-update', {
      currentBid: room.currentBid,
      currentBidder: room.currentBidder,
      bidHistory: room.bidHistory,
      state: room.state,
      dealer: room.dealer
    });
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
    room.bottomCards = newBottomCards;

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
    if (!validatePlay(room, cards, room.currentPlayer)) {
      socket.emit('invalid-play', '无效的出牌');
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
        room.players.splice(idx, 1);
        if (room.players.length === 0) {
          rooms.delete(socket.roomId);
        } else {
          io.to(room.id).emit('player-left', { playerId: socket.id });
          io.to(room.id).emit('room-update', getRoomState(room));
        }
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
      cardCount: p.hand.length
    })),
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
function startGame(room) {
  room.state = 'bidding';
  room.deck = shuffle(createDeck());

  // 发牌：每人25张，8张底牌 (共108张)
  room.bottomCards = room.deck.slice(0, 8);
  let cardIndex = 8;

  for (let i = 0; i < 4; i++) {
    room.players[i].hand = room.deck.slice(cardIndex, cardIndex + 25);
    cardIndex += 25;

    // 初始排序（无主时）：常主(2、7、王)优先
    room.players[i].hand.sort((a, b) => {
      const rankOrder = { 'big': 100, 'small': 99, '2': 98, '7': 97, 'A': 14, 'K': 13, 'Q': 12, 'J': 11, '10': 10, '9': 9, '8': 8, '6': 6, '5': 5, '4': 4, '3': 3 };
      const suitOrder = { 'spades': 4, 'hearts': 3, 'diamonds': 2, 'clubs': 1 };

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

      // 其他牌：按花色，再按大小
      if (a.suit !== b.suit) return suitOrder[b.suit] - suitOrder[a.suit];
      return (rankOrder[b.rank] || 0) - (rankOrder[a.rank] || 0);
    });

    // 发送手牌给玩家
    io.to(room.players[i].id).emit('deal-cards', room.players[i].hand);
  }

  // 确定第一个叫分者
  if (room.lastWinner !== null) {
    room.currentBidder = room.lastWinner;
  }

  io.to(room.id).emit('game-started', {
    currentBidder: room.currentBidder,
    currentBid: room.currentBid,
    bottomCardCount: 8
  });
}

// 验证出牌合法性
function validatePlay(room, cards, playerIndex) {
  const player = room.players[playerIndex];

  // 检查玩家是否有这些牌
  for (const card of cards) {
    if (!player.hand.some(c => c.id === card.id)) {
      return false;
    }
  }

  // 如果是首家出牌
  if (room.currentRound.length === 0) {
    // 甩牌需要验证最大性（简化处理）
    return true;
  }

  // 跟牌：必须跟相同花色
  const firstPlay = room.currentRound[0];
  const leadSuit = firstPlay.cards[0].suit;
  const hasLeadSuit = player.hand.some(c => c.suit === leadSuit && !c.isTrump);

  if (hasLeadSuit) {
    // 有首牌花色必须跟
    for (const card of cards) {
      if (card.suit !== leadSuit || card.isTrump) {
        return false;
      }
    }
  }

  return true;
}

// 结束一轮
function finishRound(room) {
  const firstPlay = room.currentRound[0];
  const leadSuit = firstPlay.cards[0].suit;
  let winner = 0;
  let maxValue = getCardValue(firstPlay.cards[0], room.trumpSuit, room.isNoTrump);

  // 找出赢家
  for (let i = 1; i < 4; i++) {
    const play = room.currentRound[i];
    const card = play.cards[0];
    const value = getCardValue(card, room.trumpSuit, room.isNoTrump);

    // 如果是主牌
    if (card.suit === room.trumpSuit || card.isTrump) {
      const currentWinnerCard = room.currentRound[winner].cards[0];
      const currentWinnerValue = getCardValue(currentWinnerCard, room.trumpSuit, room.isNoTrump);
      if (value > currentWinnerValue) {
        winner = i;
        maxValue = value;
      }
    } else if (card.suit === leadSuit) {
      // 同花色比大小
      const currentWinnerCard = room.currentRound[winner].cards[0];
      const currentWinnerIsTrump = currentWinnerCard.suit === room.trumpSuit || currentWinnerCard.isTrump;
      if (!currentWinnerIsTrump) {
        const currentWinnerValue = getCardValue(currentWinnerCard, room.trumpSuit, room.isNoTrump);
        if (value > currentWinnerValue) {
          winner = i;
          maxValue = value;
        }
      }
    }
  }

  // 计算得分
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
  }

  room.roundScores.push({
    winner: winnerPlayer,
    score: roundScore,
    isDealerWin: winnerIsDealer
  });

  // 检查是否是最后一轮（抠底）
  const isLastRound = room.players.every(p => p.hand.length === 0);

  if (isLastRound && !winnerIsDealer) {
    // 抠底
    let multiplier = 1;
    const winCard = room.currentRound[winner].cards[0];

    // 检查是否是拖拉机抠底
    if (room.currentRound[winner].cards.length >= 4) {
      multiplier = 4;
    } else if (room.currentRound[winner].cards.length >= 2) {
      multiplier = 2;
    }

    const bottomScore = room.bottomCards.reduce((sum, c) => sum + getCardScore(c), 0) * multiplier;
    room.scores.team += bottomScore;

    io.to(room.id).emit('koudi', {
      player: winnerPlayer,
      multiplier: multiplier,
      bottomCards: room.bottomCards,
      score: bottomScore
    });
  }

  io.to(room.id).emit('round-end', {
    winner: winnerPlayer,
    score: roundScore,
    totalScore: room.scores.team,
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
function endGame(room) {
  room.state = 'ended';
  const finalScore = room.scores.team;
  const targetScore = room.dealerScore;

  let result;
  if (finalScore >= targetScore) {
    result = 'dealer-lost';
  } else if (finalScore === 0) {
    result = 'qingguang';
  } else {
    result = 'dealer-won';
  }

  io.to(room.id).emit('game-end', {
    result: result,
    teamScore: finalScore,
    targetScore: targetScore,
    dealer: room.dealer
  });

  // 准备下一局
  room.gameNumber++;
  room.players.forEach(p => {
    p.isDealer = false;
    p.isReady = false;
    p.hand = [];
  });
  room.scores.team = 0;
  room.bidHistory = [];
  room.currentBid = 100;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
