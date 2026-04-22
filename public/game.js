// 游戏状态
const gameState = {
  socket: null,
  roomId: null,
  playerId: null,
  playerName: '',
  seat: 0,
  hand: [],
  selectedCards: [],
  currentState: 'waiting',
  players: [],
  currentPlayer: 0,
  isDealer: false,
  trumpSuit: null,
  isNoTrump: false,
  bottomCards: []
};

// DOM元素
const elements = {
  homeScreen: document.getElementById('home-screen'),
  gameScreen: document.getElementById('game-screen'),
  playerNameInput: document.getElementById('player-name'),
  createRoomBtn: document.getElementById('create-room-btn'),
  joinRoomBtn: document.getElementById('join-room-btn'),
  joinRoomPanel: document.getElementById('join-room-panel'),
  roomIdInput: document.getElementById('room-id'),
  confirmJoinBtn: document.getElementById('confirm-join-btn'),
  rulesModal: document.getElementById('rules-modal'),
  showRulesBtn: document.getElementById('show-rules'),
  closeRulesBtn: document.querySelector('#rules-modal .close-btn'),
  roomIdDisplay: document.getElementById('room-id-display'),
  copyLinkBtn: document.getElementById('copy-link-btn'),
  gameStatus: document.getElementById('game-status'),
  trumpDisplay: document.getElementById('trump-display'),
  readyBtn: document.getElementById('ready-btn'),
  playBtn: document.getElementById('play-btn'),
  myHand: document.getElementById('my-hand'),
  myName: document.getElementById('my-name'),
  myCardCount: document.getElementById('my-card-count'),
  myStatus: document.getElementById('my-status'),
  bidPanel: document.getElementById('bid-panel'),
  bidButtons: document.querySelectorAll('.bid-btn'),
  passBtn: document.getElementById('pass-btn'),
  trumpPanel: document.getElementById('trump-panel'),
  suitButtons: document.querySelectorAll('.suit-btn'),
  bottomCardsPanel: document.getElementById('bottom-cards-panel'),
  bottomCardsDisplay: document.getElementById('bottom-cards'),
  confirmExchangeBtn: document.getElementById('confirm-exchange-btn'),
  bidHistory: document.getElementById('bid-history'),
  bidList: document.getElementById('bid-list'),
  playedCardsArea: document.getElementById('played-cards'),
  scorePanel: document.getElementById('score-panel'),
  teamScore: document.getElementById('team-score'),
  targetScore: document.getElementById('target-score'),
  chatInput: document.getElementById('chat-input'),
  sendBtn: document.getElementById('send-btn'),
  chatMessages: document.getElementById('chat-messages'),
  resultModal: document.getElementById('result-modal'),
  resultTitle: document.getElementById('result-title'),
  resultContent: document.getElementById('result-content'),
  nextGameBtn: document.getElementById('next-game-btn')
};

// 初始化
function init() {
  // 检查URL参数
  const urlParams = new URLSearchParams(window.location.search);
  const roomIdFromUrl = urlParams.get('room');

  if (roomIdFromUrl) {
    elements.roomIdInput.value = roomIdFromUrl;
    elements.joinRoomPanel.classList.remove('hidden');
  }

  // 事件监听
  elements.createRoomBtn.addEventListener('click', createRoom);
  elements.joinRoomBtn.addEventListener('click', () => {
    elements.joinRoomPanel.classList.toggle('hidden');
  });
  elements.confirmJoinBtn.addEventListener('click', joinRoom);
  elements.showRulesBtn.addEventListener('click', (e) => {
    e.preventDefault();
    elements.rulesModal.classList.remove('hidden');
  });
  elements.closeRulesBtn.addEventListener('click', () => {
    elements.rulesModal.classList.add('hidden');
  });
  elements.readyBtn.addEventListener('click', toggleReady);
  elements.playBtn.addEventListener('click', playCards);
  elements.passBtn.addEventListener('click', () => placeBid('pass'));
  elements.copyLinkBtn.addEventListener('click', copyInviteLink);
  elements.sendBtn.addEventListener('click', sendChatMessage);
  elements.chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChatMessage();
  });
  elements.nextGameBtn.addEventListener('click', () => {
    elements.resultModal.classList.add('hidden');
    elements.readyBtn.classList.remove('hidden');
    elements.readyBtn.textContent = '准备';
    elements.readyBtn.disabled = false;
  });

  // 叫分按钮
  elements.bidButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const bid = parseInt(btn.dataset.bid);
      placeBid(bid);
    });
  });

  // 主牌选择按钮
  elements.suitButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const suit = btn.dataset.suit;
      chooseTrump(suit === 'notrump' ? null : suit, suit === 'notrump');
    });
  });

  // 关闭模态框
  window.addEventListener('click', (e) => {
    if (e.target === elements.rulesModal) {
      elements.rulesModal.classList.add('hidden');
    }
  });
}

// 连接服务器
function connectSocket() {
  gameState.socket = io();

  gameState.socket.on('connect', () => {
    console.log('Connected to server');
  });

  gameState.socket.on('room-update', (room) => {
    updateRoomDisplay(room);
  });

  gameState.socket.on('deal-cards', (cards) => {
    gameState.hand = cards;
    renderHand();
    addChatMessage('系统', '游戏开始，你已收到手牌');
  });

  gameState.socket.on('game-started', (data) => {
    elements.gameStatus.textContent = '叫分阶段';
    elements.bidHistory.classList.remove('hidden');
    elements.scorePanel.classList.remove('hidden');
    elements.targetScore.textContent = data.currentBid;
    updateBidButtons(data.currentBid);
  });

  gameState.socket.on('bid-update', (data) => {
    updateBidDisplay(data);
  });

  gameState.socket.on('show-bottom-cards', (cards) => {
    gameState.bottomCards = cards;
    showBottomCards(cards);
  });

  gameState.socket.on('trump-chosen', (data) => {
    gameState.trumpSuit = data.trumpSuit;
    gameState.isNoTrump = data.isNoTrump;
    updateTrumpDisplay(data.trumpSuit, data.isNoTrump);
    addChatMessage('系统', `${gameState.players[data.dealer].name} 选择了 ${data.isNoTrump ? '无主' : getSuitName(data.trumpSuit)}`);
  });

  gameState.socket.on('exchange-cards', (cards) => {
    showExchangePanel(cards);
  });

  gameState.socket.on('game-start', (data) => {
    elements.gameStatus.textContent = '游戏中';
    gameState.currentPlayer = data.currentPlayer;
    updateCurrentPlayer(data.currentPlayer);
  });

  gameState.socket.on('cards-played', (data) => {
    showPlayedCards(data.player, data.cards);
    updatePlayerCardCount(data.player, data.cards.length);
    gameState.currentPlayer = data.nextPlayer;
    updateCurrentPlayer(data.nextPlayer);
  });

  gameState.socket.on('invalid-play', (message) => {
    alert(message);
  });

  gameState.socket.on('round-end', (data) => {
    showRoundResult(data);
  });

  gameState.socket.on('koudi', (data) => {
    addChatMessage('系统', `${gameState.players[data.player].name} 抠底！倍数: ${data.multiplier}x, 得分: ${data.score}`);
  });

  gameState.socket.on('game-end', (data) => {
    showGameResult(data);
  });

  gameState.socket.on('chat-message', (data) => {
    addChatMessage(data.player, data.message);
  });

  gameState.socket.on('player-left', (data) => {
    addChatMessage('系统', '有玩家离开了房间');
  });

  gameState.socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    alert('连接服务器失败，请刷新页面重试');
  });
}

// 创建房间
function createRoom() {
  const name = elements.playerNameInput.value.trim();
  if (!name) {
    alert('请输入昵称');
    return;
  }

  gameState.playerName = name;
  connectSocket();

  gameState.socket.emit('create-room', name, (response) => {
    if (response.success) {
      gameState.roomId = response.roomId;
      gameState.playerId = response.playerId;
      enterGame();
    } else {
      alert(response.error);
    }
  });
}

// 加入房间
function joinRoom() {
  const name = elements.playerNameInput.value.trim();
  const roomId = elements.roomIdInput.value.trim();

  if (!name) {
    alert('请输入昵称');
    return;
  }
  if (!roomId) {
    alert('请输入房间号');
    return;
  }

  gameState.playerName = name;
  connectSocket();

  gameState.socket.emit('join-room', roomId, name, (response) => {
    if (response.success) {
      gameState.roomId = response.roomId;
      gameState.playerId = response.playerId;
      enterGame();
    } else {
      alert(response.error);
    }
  });
}

// 进入游戏界面
function enterGame() {
  elements.homeScreen.classList.remove('active');
  elements.gameScreen.classList.add('active');
  elements.roomIdDisplay.textContent = `房间: ${gameState.roomId}`;
  elements.myName.textContent = gameState.playerName;

  // 更新URL
  const url = new URL(window.location);
  url.searchParams.set('room', gameState.roomId);
  window.history.pushState({}, '', url);
}

// 更新房间显示
function updateRoomDisplay(room) {
  gameState.players = room.players;
  gameState.currentState = room.state;

  // 找到自己的座位
  const me = room.players.find(p => p.id === gameState.playerId);
  if (me) {
    gameState.seat = me.seat;
    gameState.isDealer = me.isDealer;
  }

  // 更新各座位显示
  room.players.forEach(player => {
    const relativeSeat = (player.seat - gameState.seat + 4) % 4;
    updateSeatDisplay(relativeSeat, player);
  });

  // 清空空座位
  for (let i = 0; i < 4; i++) {
    if (!room.players.find(p => (p.seat - gameState.seat + 4) % 4 === i)) {
      clearSeatDisplay(i);
    }
  }

  // 更新游戏状态
  switch (room.state) {
    case 'waiting':
      elements.gameStatus.textContent = `等待玩家 (${room.players.length}/4)`;
      break;
    case 'bidding':
      elements.gameStatus.textContent = '叫分阶段';
      break;
    case 'choosing-trump':
      elements.gameStatus.textContent = '选择主牌';
      break;
    case 'exchanging':
      elements.gameStatus.textContent = '换牌中';
      break;
    case 'playing':
      elements.gameStatus.textContent = '游戏中';
      break;
  }
}

// 更新座位显示
function updateSeatDisplay(relativeSeat, player) {
  const seatElements = ['.player-seat.bottom', '.player-seat.top', '.player-seat.left', '.player-seat.right'];
  const seatEl = document.querySelector(seatElements[relativeSeat]);

  if (seatEl) {
    seatEl.querySelector('.player-name').textContent = player.name;
    seatEl.querySelector('.player-avatar').textContent = player.name[0].toUpperCase();
    seatEl.querySelector('.player-cards').textContent = player.cardCount || 21;

    if (player.isReady) {
      seatEl.querySelector('.player-status').textContent = '✓ 已准备';
    } else if (player.isDealer) {
      seatEl.querySelector('.player-status').textContent = '庄家';
      seatEl.classList.add('dealer');
    } else {
      seatEl.querySelector('.player-status').textContent = '';
    }

    seatEl.dataset.playerId = player.id;
  }
}

// 清空座位显示
function clearSeatDisplay(relativeSeat) {
  const seatElements = ['.player-seat.bottom', '.player-seat.top', '.player-seat.left', '.player-seat.right'];
  const seatEl = document.querySelector(seatElements[relativeSeat]);

  if (seatEl) {
    seatEl.querySelector('.player-name').textContent = '等待中...';
    seatEl.querySelector('.player-avatar').textContent = '?';
    seatEl.querySelector('.player-cards').textContent = '0';
    seatEl.querySelector('.player-status').textContent = '';
    seatEl.classList.remove('dealer');
    delete seatEl.dataset.playerId;
  }
}

// 准备/取消准备
function toggleReady() {
  const isReady = elements.readyBtn.textContent === '准备';
  gameState.socket.emit('player-ready', isReady);
  elements.readyBtn.textContent = isReady ? '取消准备' : '准备';
  elements.readyBtn.disabled = true;
  setTimeout(() => {
    elements.readyBtn.disabled = false;
  }, 1000);
}

// 渲染手牌
function renderHand() {
  elements.myHand.innerHTML = '';
  elements.myCardCount.textContent = gameState.hand.length;

  gameState.hand.forEach((card, index) => {
    const cardEl = createCardElement(card, index);
    elements.myHand.appendChild(cardEl);
  });
}

// 创建牌元素
function createCardElement(card, index) {
  const cardEl = document.createElement('div');
  cardEl.className = `card ${card.suit}`;
  cardEl.dataset.cardId = card.id;
  cardEl.dataset.index = index;

  if (card.suit === 'joker') {
    cardEl.classList.add('joker');
    cardEl.innerHTML = `
      <span class="rank">${card.name}</span>
    `;
  } else {
    const suitSymbols = {
      'hearts': '♥',
      'diamonds': '♦',
      'clubs': '♣',
      'spades': '♠'
    };

    cardEl.innerHTML = `
      <span class="rank">${card.rank}</span>
      <span class="suit">${suitSymbols[card.suit]}</span>
    `;
  }

  if (card.isTrump) {
    cardEl.classList.add('trump');
  }

  cardEl.addEventListener('click', () => toggleCardSelection(card, cardEl));

  return cardEl;
}

// 切换牌选择
function toggleCardSelection(card, cardEl) {
  const index = gameState.selectedCards.findIndex(c => c.id === card.id);

  if (index === -1) {
    gameState.selectedCards.push(card);
    cardEl.classList.add('selected');
  } else {
    gameState.selectedCards.splice(index, 1);
    cardEl.classList.remove('selected');
  }

  // 显示/隐藏出牌按钮
  if (gameState.selectedCards.length > 0) {
    elements.playBtn.classList.remove('hidden');
  } else {
    elements.playBtn.classList.add('hidden');
  }
}

// 出牌
function playCards() {
  if (gameState.selectedCards.length === 0) return;

  gameState.socket.emit('play-cards', gameState.selectedCards);
  gameState.selectedCards = [];
  elements.playBtn.classList.add('hidden');

  // 移除选中状态
  document.querySelectorAll('.card.selected').forEach(el => {
    el.classList.remove('selected');
  });
}

// 叫分
function placeBid(bid) {
  gameState.socket.emit('place-bid', bid);
  elements.bidPanel.classList.add('hidden');
}

// 更新叫分按钮
function updateBidButtons(currentBid) {
  elements.bidButtons.forEach(btn => {
    const bid = parseInt(btn.dataset.bid);
    btn.disabled = bid >= currentBid;
  });
}

// 更新叫分显示
function updateBidDisplay(data) {
  elements.targetScore.textContent = data.currentBid;
  updateBidButtons(data.currentBid);

  // 更新叫分记录
  elements.bidList.innerHTML = '';
  data.bidHistory.forEach(bid => {
    const li = document.createElement('li');
    li.textContent = `${bid.player}: ${bid.bid === 'pass' ? '不叫' : bid.bid}`;
    elements.bidList.appendChild(li);
  });

  // 检查是否轮到自己
  const currentPlayer = gameState.players[data.currentBidder];
  if (currentPlayer && currentPlayer.id === gameState.playerId) {
    elements.bidPanel.classList.remove('hidden');
  } else {
    elements.bidPanel.classList.add('hidden');
  }

  // 如果是选择主牌阶段
  if (data.state === 'choosing-trump') {
    elements.bidPanel.classList.add('hidden');
    if (data.dealer === gameState.seat) {
      elements.trumpPanel.classList.remove('hidden');
    }
  }
}

// 选择主牌
function chooseTrump(suit, isNoTrump) {
  gameState.socket.emit('choose-trump', suit, isNoTrump);
  elements.trumpPanel.classList.add('hidden');
}

// 更新主牌显示
function updateTrumpDisplay(suit, isNoTrump) {
  if (isNoTrump) {
    elements.trumpDisplay.textContent = '无主';
  } else {
    const suitNames = {
      'spades': '♠ 黑桃',
      'hearts': '♥ 红桃',
      'clubs': '♣ 梅花',
      'diamonds': '♦ 方片'
    };
    elements.trumpDisplay.textContent = suitNames[suit];
  }
}

// 显示底牌
function showBottomCards(cards) {
  elements.bottomCardsDisplay.innerHTML = '';
  cards.forEach(card => {
    const cardEl = createCardElement(card);
    cardEl.style.width = '45px';
    cardEl.style.height = '63px';
    elements.bottomCardsDisplay.appendChild(cardEl);
  });
  elements.bottomCardsPanel.classList.remove('hidden');
}

// 显示换牌面板
function showExchangePanel(bottomCards) {
  elements.bottomCardsPanel.classList.remove('hidden');

  // 将底牌加入手牌
  gameState.hand = gameState.hand.concat(bottomCards);
  renderHand();

  // 等待玩家选择要弃掉的牌
  elements.confirmExchangeBtn.onclick = () => {
    const discardedCount = gameState.selectedCards.length;
    if (discardedCount !== 8) {
      alert(`请选择8张牌作为底牌（已选择${discardedCount}张）`);
      return;
    }

    gameState.socket.emit('finish-exchange', gameState.selectedCards);
    elements.bottomCardsPanel.classList.add('hidden');

    // 从手牌中移除
    gameState.hand = gameState.hand.filter(c =>
      !gameState.selectedCards.some(sc => sc.id === c.id)
    );
    gameState.selectedCards = [];
    renderHand();
  };
}

// 显示出的牌
function showPlayedCards(playerIndex, cards) {
  const playContainer = document.createElement('div');
  playContainer.className = 'play-container';
  playContainer.innerHTML = `<span class="player-label">${gameState.players[playerIndex]?.name || '玩家'}</span>`;

  const cardsContainer = document.createElement('div');
  cardsContainer.className = 'played-cards-container';

  cards.forEach(card => {
    const cardEl = createPlayedCardElement(card);
    cardsContainer.appendChild(cardEl);
  });

  playContainer.appendChild(cardsContainer);
  elements.playedCardsArea.appendChild(playContainer);

  // 3秒后清除
  setTimeout(() => {
    playContainer.remove();
  }, 3000);
}

// 创建出的牌元素
function createPlayedCardElement(card) {
  const cardEl = document.createElement('div');
  cardEl.className = `played-card ${card.suit}`;

  if (card.suit === 'joker') {
    cardEl.innerHTML = `<span class="rank">${card.name}</span>`;
  } else {
    const suitSymbols = {
      'hearts': '♥',
      'diamonds': '♦',
      'clubs': '♣',
      'spades': '♠'
    };
    cardEl.innerHTML = `
      <span class="rank">${card.rank}</span>
      <span class="suit">${suitSymbols[card.suit]}</span>
    `;
  }

  return cardEl;
}

// 更新当前玩家
function updateCurrentPlayer(playerIndex) {
  document.querySelectorAll('.player-seat').forEach(seat => {
    seat.classList.remove('active');
  });

  const relativeSeat = (playerIndex - gameState.seat + 4) % 4;
  const seatElements = ['.player-seat.bottom', '.player-seat.top', '.player-seat.left', '.player-seat.right'];
  const seatEl = document.querySelector(seatElements[relativeSeat]);

  if (seatEl) {
    seatEl.classList.add('active');
  }

  // 检查是否轮到自己
  if (playerIndex === gameState.seat) {
    addChatMessage('系统', '轮到你了！');
  }
}

// 更新玩家牌数
function updatePlayerCardCount(playerIndex, count) {
  const relativeSeat = (playerIndex - gameState.seat + 4) % 4;
  const seatElements = ['.player-seat.bottom', '.player-seat.top', '.player-seat.left', '.player-seat.right'];
  const seatEl = document.querySelector(seatElements[relativeSeat]);

  if (seatEl) {
    const currentCount = parseInt(seatEl.querySelector('.player-cards').textContent);
    seatEl.querySelector('.player-cards').textContent = currentCount - count;
  }
}

// 显示一轮结果
function showRoundResult(data) {
  elements.teamScore.textContent = data.totalScore;

  const winnerName = gameState.players[data.winner]?.name || '玩家';
  addChatMessage('系统', `${winnerName} 赢得本轮，得分: ${data.score}`);

  if (data.isLastRound) {
    addChatMessage('系统', '本局结束！');
  }
}

// 显示游戏结果
function showGameResult(data) {
  elements.resultModal.classList.remove('hidden');

  let title, content, className;
  const isDealerWin = data.result === 'dealer-won';
  const iAmDealer = gameState.players[gameState.seat]?.isDealer;

  if (data.result === 'qingguang') {
    title = '清光！';
    content = isDealerWin !== iAmDealer ? '闲家被清光！' : '闲家被清光！';
    className = isDealerWin === iAmDealer ? 'result-win' : 'result-lose';
  } else if (data.result === 'dealer-lost') {
    title = '庄家下庄！';
    content = '闲家得分超过庄分！';
    className = !iAmDealer ? 'result-win' : 'result-lose';
  } else {
    title = '庄家获胜！';
    content = '闲家未能达到庄分！';
    className = iAmDealer ? 'result-win' : 'result-lose';
  }

  elements.resultTitle.textContent = title;
  elements.resultContent.innerHTML = `
    <div class="result-score ${className}">${data.teamScore} / ${data.targetScore}</div>
    <p>${content}</p>
    <p>闲家得分: ${data.teamScore}</p>
    <p>庄分: ${data.targetScore}</p>
  `;
}

// 复制邀请链接
function copyInviteLink() {
  const url = new URL(window.location);
  url.searchParams.set('room', gameState.roomId);

  navigator.clipboard.writeText(url.toString()).then(() => {
    elements.copyLinkBtn.textContent = '已复制!';
    setTimeout(() => {
      elements.copyLinkBtn.textContent = '复制邀请链接';
    }, 2000);
  });
}

// 发送聊天消息
function sendChatMessage() {
  const message = elements.chatInput.value.trim();
  if (!message) return;

  gameState.socket.emit('chat-message', message);
  elements.chatInput.value = '';
}

// 添加聊天消息
function addChatMessage(player, message) {
  const msgEl = document.createElement('div');
  msgEl.className = 'message';
  msgEl.innerHTML = `<span class="player-name">${player}:</span> ${escapeHtml(message)}`;
  elements.chatMessages.appendChild(msgEl);
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

// HTML转义
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 获取花色名称
function getSuitName(suit) {
  const names = {
    'spades': '黑桃',
    'hearts': '红桃',
    'clubs': '梅花',
    'diamonds': '方片'
  };
  return names[suit] || suit;
}

// 启动游戏
document.addEventListener('DOMContentLoaded', init);
