const Pusher = require('pusher');

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true
});

// 内存存储（生产环境建议使用 Redis）
const rooms = new Map();

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  const { action, roomId, playerId, playerName, data } = JSON.parse(event.body);

  try {
    switch (action) {
      case 'create-room':
        return await createRoom(roomId, playerId, playerName, headers);
      case 'join-room':
        return await joinRoom(roomId, playerId, playerName, headers);
      case 'player-ready':
        return await playerReady(roomId, playerId, data.isReady, headers);
      case 'start-game':
        return await startGame(roomId, headers);
      case 'place-bid':
        return await placeBid(roomId, playerId, data.bid, headers);
      case 'choose-trump':
        return await chooseTrump(roomId, playerId, data.suit, data.isNoTrump, headers);
      case 'exchange-cards':
        return await exchangeCards(roomId, playerId, data.discardedCards, headers);
      case 'play-cards':
        return await playCards(roomId, playerId, data.cards, headers);
      case 'chat-message':
        return await chatMessage(roomId, playerId, playerName, data.message, headers);
      default:
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };
    }
  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};

async function createRoom(roomId, playerId, playerName, headers) {
  const room = {
    id: roomId,
    players: [{
      id: playerId,
      name: playerName,
      seat: 0,
      isReady: false,
      isDealer: false,
      hand: []
    }],
    state: 'waiting',
    currentBidder: 0,
    currentBid: 100,
    dealer: null,
    trumpSuit: null,
    isNoTrump: false,
    currentPlayer: 0,
    currentRound: [],
    scores: { team: 0 },
    bidHistory: [],
    gameNumber: 1
  };

  rooms.set(roomId, room);

  await pusher.trigger(`room-${roomId}`, 'room-update', getRoomState(room));

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true, room: getRoomState(room) })
  };
}

async function joinRoom(roomId, playerId, playerName, headers) {
  const room = rooms.get(roomId);

  if (!room) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Room not found' }) };
  }

  if (room.players.length >= 4) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Room is full' }) };
  }

  room.players.push({
    id: playerId,
    name: playerName,
    seat: room.players.length,
    isReady: false,
    isDealer: false,
    hand: []
  });

  await pusher.trigger(`room-${roomId}`, 'room-update', getRoomState(room));

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true, room: getRoomState(room) })
  };
}

async function playerReady(roomId, playerId, isReady, headers) {
  const room = rooms.get(roomId);
  if (!room) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Room not found' }) };

  const player = room.players.find(p => p.id === playerId);
  if (player) {
    player.isReady = isReady;
  }

  await pusher.trigger(`room-${roomId}`, 'room-update', getRoomState(room));

  return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
}

async function startGame(roomId, headers) {
  const room = rooms.get(roomId);
  if (!room) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Room not found' }) };

  room.state = 'bidding';
  const deck = createAndShuffleDeck();

  // 发牌：每人25张，8张底牌 (共108张)
  room.players.forEach((player, i) => {
    player.hand = deck.slice(i * 25, (i + 1) * 25);
    // 初始排序（无主时）：常主(2、7、王)优先
    player.hand.sort((a, b) => {
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
  });
  room.bottomCards = deck.slice(100, 108);

  await pusher.trigger(`room-${roomId}`, 'game-started', {
    currentBidder: room.currentBidder,
    currentBid: room.currentBid,
    bottomCardCount: 8
  });

  // 给每个玩家发送手牌
  for (const player of room.players) {
    await pusher.trigger(`private-${player.id}`, 'deal-cards', player.hand);
  }

  return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
}

async function placeBid(roomId, playerId, bid, headers) {
  const room = rooms.get(roomId);
  if (!room) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Room not found' }) };

  const currentPlayer = room.players[room.currentBidder];
  if (currentPlayer.id !== playerId) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Not your turn' }) };
  }

  const player = room.players.find(p => p.id === playerId);

  if (bid === 'pass') {
    room.bidHistory.push({ player: player.name, bid: 'pass' });
    room.currentBidder = (room.currentBidder + 1) % 4;
  } else {
    room.currentBid = bid;
    room.bidHistory.push({ player: player.name, bid });
    room.currentBidder = (room.currentBidder + 1) % 4;

    if (bid === 75) {
      player.isDealer = true;
      room.dealer = room.currentBidder - 1;
      if (room.dealer < 0) room.dealer = 3;
      room.dealerScore = 75;
      room.state = 'choosing-trump';

      await pusher.trigger(`private-${playerId}`, 'show-bottom-cards', room.bottomCards);
    }
  }

  await pusher.trigger(`room-${roomId}`, 'bid-update', {
    currentBid: room.currentBid,
    currentBidder: room.currentBidder,
    bidHistory: room.bidHistory,
    state: room.state,
    dealer: room.dealer
  });

  return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
}

async function chooseTrump(roomId, playerId, suit, isNoTrump, headers) {
  const room = rooms.get(roomId);
  if (!room) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Room not found' }) };

  const dealer = room.players[room.dealer];
  if (dealer.id !== playerId) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Not dealer' }) };
  }

  room.trumpSuit = suit;
  room.isNoTrump = isNoTrump;
  room.state = 'exchanging';

  // 重新排序所有玩家的手牌（主牌优先，同花色，牌大小）
  for (const player of room.players) {
    player.hand.sort((a, b) => sortCardsForDisplay(a, b, suit, isNoTrump));
    await pusher.trigger(`private-${player.id}`, 'hand-sorted', player.hand);
  }

  await pusher.trigger(`room-${roomId}`, 'trump-chosen', {
    trumpSuit: suit,
    isNoTrump: isNoTrump,
    dealer: room.dealer
  });

  await pusher.trigger(`private-${playerId}`, 'exchange-cards', room.bottomCards);

  return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
}

async function exchangeCards(roomId, playerId, discardedCards, headers) {
  const room = rooms.get(roomId);
  if (!room) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Room not found' }) };

  room.bottomCards = discardedCards;
  room.state = 'playing';
  room.currentPlayer = room.dealer;

  await pusher.trigger(`room-${roomId}`, 'game-start', {
    currentPlayer: room.currentPlayer,
    trumpSuit: room.trumpSuit,
    isNoTrump: room.isNoTrump
  });

  return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
}

async function playCards(roomId, playerId, cards, headers) {
  const room = rooms.get(roomId);
  if (!room) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Room not found' }) };

  const playerIndex = room.players.findIndex(p => p.id === playerId);
  if (playerIndex !== room.currentPlayer) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Not your turn' }) };
  }

  const player = room.players[playerIndex];

  // 从手牌中移除
  for (const card of cards) {
    const idx = player.hand.findIndex(c => c.id === card.id);
    if (idx !== -1) player.hand.splice(idx, 1);
  }

  room.currentRound.push({
    player: playerIndex,
    cards: cards,
    isDealer: player.isDealer
  });

  await pusher.trigger(`room-${roomId}`, 'cards-played', {
    player: playerIndex,
    cards: cards,
    nextPlayer: (room.currentPlayer + 1) % 4
  });

  room.currentPlayer = (room.currentPlayer + 1) % 4;

  // 一轮结束
  if (room.currentRound.length === 4) {
    setTimeout(async () => {
      await finishRound(room);
    }, 1000);
  }

  return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
}

async function chatMessage(roomId, playerId, playerName, message, headers) {
  await pusher.trigger(`room-${roomId}`, 'chat-message', {
    player: playerName,
    message: message
  });

  return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
}

// 结束一轮
async function finishRound(room) {
  // 简化版：第一个出牌的人赢
  const winner = room.currentRound[0].player;
  const roundScore = room.currentRound.reduce((sum, play) => {
    return sum + play.cards.reduce((s, c) => s + getCardScore(c), 0);
  }, 0);

  if (!room.players[winner].isDealer) {
    room.scores.team += roundScore;
  }

  await pusher.trigger(`room-${room.id}`, 'round-end', {
    winner: winner,
    score: roundScore,
    totalScore: room.scores.team,
    plays: room.currentRound,
    isLastRound: room.players.every(p => p.hand.length === 0)
  });

  room.currentRound = [];
  room.currentPlayer = winner;

  // 检查游戏结束
  if (room.players.every(p => p.hand.length === 0)) {
    const result = room.scores.team >= room.dealerScore ? 'dealer-lost' :
                   room.scores.team === 0 ? 'qingguang' : 'dealer-won';

    await pusher.trigger(`room-${room.id}`, 'game-end', {
      result: result,
      teamScore: room.scores.team,
      targetScore: room.dealerScore,
      dealer: room.dealer
    });
  }
}

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

// 创建和洗牌
function createAndShuffleDeck() {
  const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
  const ranks = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const trumps = ['2', '7'];

  const deck = [];

  for (let d = 0; d < 2; d++) {
    for (const suit of suits) {
      for (const rank of ranks) {
        deck.push({ suit, rank, id: `${suit}-${rank}-${d}`, isTrump: false });
      }
      for (const rank of trumps) {
        deck.push({ suit, rank, id: `${suit}-${rank}-${d}-t`, isTrump: true });
      }
    }
    deck.push({ suit: 'joker', rank: 'big', name: '大王', id: `big-joker-${d}`, isTrump: true });
    deck.push({ suit: 'joker', rank: 'small', name: '小王', id: `small-joker-${d}`, isTrump: true });
  }

  // 洗牌
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}

// 获取手牌显示排序值（越大越靠前）
// 顺序：大王 > 小王 > 主7 > 副7 > 主2 > 副2 > 主A > 主K > ... > 主3 > 其他花色
function getCardDisplayValue(card, trumpSuit, isNoTrump) {
  if (card.rank === 'big') return 1000;
  if (card.rank === 'small') return 999;
  if (card.rank === '7' && !isNoTrump && card.suit === trumpSuit) return 998;
  if (card.rank === '7') return 997;
  if (card.rank === '2' && !isNoTrump && card.suit === trumpSuit) return 996;
  if (card.rank === '2') return 995;

  if (!isNoTrump && card.suit === trumpSuit) {
    const rankValue = { 'A': 14, 'K': 13, 'Q': 12, 'J': 11, '10': 10, '9': 9, '8': 8, '6': 6, '5': 5, '4': 4, '3': 3 };
    return 500 + (rankValue[card.rank] || 0);
  }

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

function getCardScore(card) {
  if (card.rank === '5') return 5;
  if (card.rank === '10' || card.rank === 'K') return 10;
  return 0;
}
