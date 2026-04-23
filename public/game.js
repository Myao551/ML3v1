// 游戏状态
const gameState = {
  socket: null,
  roomId: null,
  playerId: null,
  sessionId: null,
  playerName: '',
  seat: 0,
  hand: [],
  selectedCards: [],
  selectedBottomCards: [],
  selectedHandCards: [],
  currentState: 'waiting',
  players: [],
  currentPlayer: 0,
  isDealer: false,
  trumpSuit: null,
  isNoTrump: false,
  bottomCards: [],
  exchangePanelShown: false,
  isExchanging: false,
  playHistory: [],
  currentRound: [],
  leadSuit: null,
  joiningRoom: false,
  playHistoryVisible: false,
  systemMessagesVisible: true,
  scoringCards: []
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
  toggleHistoryBtn: document.getElementById('toggle-history-btn'),
  toggleSystemBtn: document.getElementById('toggle-system-btn'),
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
  scoringCardsPanel: document.getElementById('scoring-cards-panel'),
  settlementDisplay: document.getElementById('settlement-display'),
  baseScoreInput: document.getElementById('base-score-input'),
  levelScoreInput: document.getElementById('level-score-input'),
  tableBottomDeck: document.getElementById('table-bottom-deck'),
  chatInput: document.getElementById('chat-input'),
  sendBtn: document.getElementById('send-btn'),
  chatMessages: document.getElementById('chat-messages'),
  resultModal: document.getElementById('result-modal'),
  resultTitle: document.getElementById('result-title'),
  resultContent: document.getElementById('result-content'),
  nextGameBtn: document.getElementById('next-game-btn'),
  playHistory: document.getElementById('play-history'),
  playHistoryList: document.getElementById('play-history-list'),
  earlyFinishPanel: document.getElementById('early-finish-panel'),
  earlyFinishText: document.getElementById('early-finish-text'),
  earlyFinishBtn: document.getElementById('early-finish-btn')
};

function getSessionId() {
  let sessionId = localStorage.getItem('sanda1-session-id');
  if (!sessionId) {
    sessionId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem('sanda1-session-id', sessionId);
  }
  gameState.sessionId = sessionId;
  return sessionId;
}

function setJoinBusy(isBusy) {
  gameState.joiningRoom = isBusy;
  elements.createRoomBtn.disabled = isBusy;
  elements.confirmJoinBtn.disabled = isBusy;
  elements.joinRoomBtn.disabled = isBusy;
}

function getSettlementSettingsFromInputs() {
  return {
    baseScore: Number(elements.baseScoreInput.value) || 0,
    levelScore: Number(elements.levelScoreInput.value) || 0
  };
}

function updateSettlementDisplay(settings) {
  const baseScore = Number(settings?.baseScore) || 0;
  const levelScore = Number(settings?.levelScore) || 0;
  elements.settlementDisplay.textContent = `\u5927\u5c0f\uff1a${baseScore}+${levelScore}`;
}

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
  elements.toggleHistoryBtn.addEventListener('click', togglePlayHistory);
  elements.toggleSystemBtn.addEventListener('click', toggleSystemMessages);
  elements.toggleSystemBtn.classList.add('active');
  elements.sendBtn.addEventListener('click', sendChatMessage);
  elements.earlyFinishBtn.addEventListener('click', voteEndGame);
  elements.chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChatMessage();
  });
  elements.nextGameBtn.addEventListener('click', () => {
    elements.resultModal.classList.add('hidden');
    elements.readyBtn.classList.remove('hidden');
    elements.readyBtn.textContent = '准备';
    elements.readyBtn.disabled = false;
    elements.settlementDisplay.classList.remove('hidden');
    gameState.scoringCards = [];
    renderScoringCards([]);
    clearSeatPlayPiles();
    elements.tableBottomDeck.classList.add('hidden');
    // 重置底牌面板状态
    gameState.exchangePanelShown = false;
    // 恢复出牌按钮的事件绑定
    const newPlayBtn = elements.playBtn.cloneNode(true);
    elements.playBtn.parentNode.replaceChild(newPlayBtn, elements.playBtn);
    elements.playBtn = newPlayBtn;
    elements.playBtn.addEventListener('click', playCards);
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
  if (gameState.socket?.connected) return;
  if (gameState.socket) {
    gameState.socket.removeAllListeners();
    gameState.socket.disconnect();
  }

  gameState.socket = io();

  gameState.socket.on('connect', () => {
    console.log('Connected to server');
    if (gameState.roomId && gameState.sessionId) {
      gameState.socket.emit('rejoin-room', {
        roomId: gameState.roomId,
        sessionId: gameState.sessionId
      }, (response) => {
        if (response?.success) {
          gameState.playerId = response.playerId;
        }
      });
    }
  });

  gameState.socket.on('room-update', (room) => {
    updateRoomDisplay(room);
  });

  gameState.socket.on('deal-cards', (cards) => {
    gameState.hand = cards;
    renderHand();
    addChatMessage('系统', '游戏开始，你已收到手牌');
  });

  // 主牌确定后，手牌重新排序
  gameState.socket.on('hand-sorted', (cards) => {
    gameState.hand = cards;
    renderHand();
  });

  gameState.socket.on('game-started', (data) => {
    elements.gameStatus.textContent = '叫分阶段';
    elements.bidHistory.classList.remove('hidden');
    elements.scorePanel.classList.remove('hidden');
    elements.targetScore.textContent = data.currentBid;
    gameState.currentBidder = data.currentBidder;
    gameState.scoringCards = [];
    renderScoringCards([]);
    clearSeatPlayPiles();
    showTableBottomDeck();
    // 重置准备按钮状态
    elements.readyBtn.classList.add('hidden');
    elements.readyBtn.textContent = '准备';
    elements.readyBtn.disabled = false;
    // 更新叫分按钮 - 100分可选
    updateBidButtons(105); // 传入105让100分按钮可用
    // 显示叫分面板给当前叫分者
    updateCurrentBidder(data.currentBidder);
  });

  gameState.socket.on('bid-update', (data) => {
    updateBidDisplay(data);
  });

  gameState.socket.on('show-bottom-cards', (cards) => {
    gameState.bottomCards = cards;
    showBottomCards(cards);
  });
  gameState.socket.on('bottom-to-dealer', (data) => {
    animateBottomDeckToDealer(data.dealer);
  });

  gameState.socket.on('trump-chosen', (data) => {
    gameState.trumpSuit = data.trumpSuit;
    gameState.isNoTrump = data.isNoTrump;
    updateTrumpDisplay(data.trumpSuit, data.isNoTrump);
    renderHand();
    addChatMessage('系统', `${gameState.players[data.dealer].name} 选择了 ${data.isNoTrump ? '无主' : getSuitName(data.trumpSuit)}`);
  });

  // 底牌交换：底牌加入手牌，选择8张作为新底牌
  gameState.socket.on('exchange-cards', (payload) => {
    showExchangePanel(payload);
  });

  // 等待庄家叫主
  gameState.socket.on('waiting-trump', (data) => {
    showTableBottomDeck();
    if (data.dealer !== gameState.seat) {
      addChatMessage('系统', '等待庄家选择主牌...');
    }
  });

  // 庄家叫主请求
  gameState.socket.on('choose-trump-request', () => {
    elements.trumpPanel.classList.remove('hidden');
    addChatMessage('系统', '请选择主牌！');
  });

  gameState.socket.on('game-start', (data) => {
    elements.gameStatus.textContent = '游戏中';
    gameState.currentPlayer = data.currentPlayer;
    gameState.isExchanging = false;
    elements.earlyFinishPanel.classList.add('hidden');
    elements.tableBottomDeck.classList.add('hidden');
    updateCurrentPlayer(data.currentPlayer);

    // 恢复出牌按钮的事件绑定
    const newPlayBtn = elements.playBtn.cloneNode(true);
    elements.playBtn.parentNode.replaceChild(newPlayBtn, elements.playBtn);
    elements.playBtn = newPlayBtn;
    elements.playBtn.dataset.action = 'play';
    elements.playBtn.textContent = '出牌';
    elements.playBtn.classList.add('hidden');
    elements.playBtn.addEventListener('click', playCards);
  });

  gameState.socket.on('cards-played', (data) => {
    showPlayedCards(data.player, data.cards);
    if (data.player === gameState.seat) {
      const playedIds = new Set(data.cards.map(card => card.id));
      gameState.hand = gameState.hand.filter(card => !playedIds.has(card.id));
      renderHand();
    }
    updatePlayerCardCount(data.player, data.cards.length);
    if (gameState.currentRound.length < 4) {
      gameState.currentPlayer = data.nextPlayer;
      updateCurrentPlayer(data.nextPlayer);
    }
  });

  gameState.socket.on('invalid-play', (message) => {
    alert(message);
  });

  gameState.socket.on('invalid-bid', (message) => {
    alert(message);
    updateCurrentBidder(gameState.currentBidder);
  });

  gameState.socket.on('round-end', (data) => {
    gameState.currentRound = [];
    gameState.leadSuit = null;
    renderScoringCards(data.scoringCards || []);
    showRoundResult(data);
  });

  gameState.socket.on('next-turn', (data) => {
    gameState.currentPlayer = data.currentPlayer;
    updateCurrentPlayer(data.currentPlayer);
  });

  gameState.socket.on('koudi', (data) => {
    addChatMessage('系统', `${gameState.players[data.player].name} 抠底！倍数: ${data.multiplier}x, 得分: ${data.score}`);
  });

  gameState.socket.on('game-end', (data) => {
    showGameResult(data);
  });

  gameState.socket.on('early-finish-available', (data) => {
    showEarlyFinishPanel(data);
  });

  gameState.socket.on('early-finish-vote-update', (data) => {
    updateEarlyFinishVotes(data);
  });

  gameState.socket.on('all-pass-loser', (data) => {
    showAllPassLoser(data);
  });

  gameState.socket.on('chat-message', (data) => {
    addChatMessage(data.player, data.message);
  });

  gameState.socket.on('player-left', (data) => {
    addChatMessage('系统', '有玩家离开了房间');
  });

  gameState.socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    setJoinBusy(false);
    alert('连接服务器失败，请刷新页面重试');
  });
}

// 创建房间
function createRoom() {
  if (gameState.joiningRoom) return;

  const name = elements.playerNameInput.value.trim();
  if (!name) {
    alert('请输入昵称');
    return;
  }

  gameState.playerName = name;
  gameState.sessionId = getSessionId();
  setJoinBusy(true);
  connectSocket();

  gameState.socket.emit('create-room', {
    name,
    sessionId: gameState.sessionId,
    settlementSettings: getSettlementSettingsFromInputs()
  }, (response) => {
    if (response.success) {
      gameState.roomId = response.roomId;
      gameState.playerId = response.playerId;
      gameState.sessionId = response.sessionId || gameState.sessionId;
      enterGame();
    } else {
      alert(response.error);
      setJoinBusy(false);
    }
  });
}

function joinRoom() {
  if (gameState.joiningRoom) return;

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
  gameState.sessionId = getSessionId();
  setJoinBusy(true);
  connectSocket();

  gameState.socket.emit('join-room', roomId, { name, sessionId: gameState.sessionId }, (response) => {
    if (response.success) {
      gameState.roomId = response.roomId;
      gameState.playerId = response.playerId;
      gameState.sessionId = response.sessionId || gameState.sessionId;
      enterGame();
    } else {
      alert(response.error);
      setJoinBusy(false);
    }
  });
}

function enterGame() {
  elements.homeScreen.classList.remove('active');
  elements.gameScreen.classList.add('active');
  setJoinBusy(false);
  elements.roomIdDisplay.textContent = `房间：${gameState.roomId}`;
  elements.myName.textContent = gameState.playerName;

  const url = new URL(window.location);
  url.searchParams.set('room', gameState.roomId);
  window.history.pushState({}, '', url);
}

function updateRoomDisplay(room) {
  gameState.players = room.players;
  gameState.currentState = room.state;
  if (room.settlementSettings) {
    elements.baseScoreInput.value = room.settlementSettings.baseScore;
    elements.levelScoreInput.value = room.settlementSettings.levelScore;
    updateSettlementDisplay(room.settlementSettings);
  }
  elements.settlementDisplay.classList.remove('hidden');
  renderScoringCards(room.scoringCards || gameState.scoringCards || []);

  const me = room.players.find(p => p.id === gameState.playerId);
  if (me) {
    gameState.seat = me.seat;
    gameState.isDealer = me.isDealer;
  }

  room.players.forEach(player => {
    updateSeatDisplay(player.seat, player);
  });

  for (let i = 0; i < 4; i++) {
    if (!room.players.find(p => p.seat === i)) {
      clearSeatDisplay(i);
    }
  }

  const statusText = {
    waiting: `等待玩家 (${room.players.length}/4)`,
    bidding: '叫分阶段',
    'choosing-trump': '选择主牌',
    exchanging: '换底中',
    playing: '游戏中'
  };
  elements.gameStatus.textContent = statusText[room.state] || '游戏中';
}

function getSeatElement(seatIndex) {
  const relativeSeat = (seatIndex - gameState.seat + 4) % 4;
  const seatSelectors = ['.player-seat.bottom', '.player-seat.right', '.player-seat.top', '.player-seat.left'];
  return document.querySelector(seatSelectors[relativeSeat]);
}

function updateSeatDisplay(seatIndex, player) {
  const seatEl = getSeatElement(seatIndex);

  if (seatEl) {
    seatEl.querySelector('.player-name').textContent = player.name;
    seatEl.querySelector('.player-avatar').textContent = (player.name[0] || '?').toUpperCase();
    seatEl.querySelector('.player-cards').textContent = player.cardCount || 25;

    seatEl.classList.toggle('disconnected', !!player.disconnected);
    if (player.disconnected) {
      seatEl.querySelector('.player-status').textContent = '重连中';
    } else if (player.isReady) {
      seatEl.querySelector('.player-status').textContent = '已准备';
    } else if (player.isDealer) {
      seatEl.querySelector('.player-status').textContent = '庄家';
      seatEl.classList.add('dealer');
    } else {
      seatEl.querySelector('.player-status').textContent = '';
      seatEl.classList.remove('dealer');
    }

    seatEl.classList.toggle('dealer', !!player.isDealer);
    updateDealerBadge(seatEl, !!player.isDealer);
    seatEl.dataset.playerId = player.id;
  }
}

function clearSeatDisplay(seatIndex) {
  const seatEl = getSeatElement(seatIndex);

  if (seatEl) {
    seatEl.querySelector('.player-name').textContent = '等待中';
    seatEl.querySelector('.player-avatar').textContent = '?';
    seatEl.querySelector('.player-cards').textContent = '0';
    seatEl.querySelector('.seat-play-pile').innerHTML = '';
    seatEl.querySelector('.player-status').textContent = '';
    seatEl.classList.remove('dealer');
    updateDealerBadge(seatEl, false);
    seatEl.classList.remove('disconnected');
    delete seatEl.dataset.playerId;
  }
}

function updateDealerBadge(seatEl, isDealer) {
  let badge = seatEl.querySelector('.dealer-badge');
  if (isDealer && !badge) {
    badge = document.createElement('div');
    badge.className = 'dealer-badge';
    badge.textContent = '\u5e84';
    seatEl.appendChild(badge);
  } else if (!isDealer && badge) {
    badge.remove();
  }
}

function toggleReady() {
  const isReady = elements.readyBtn.textContent === '准备';
  gameState.socket.emit('player-ready', isReady);
  elements.readyBtn.textContent = isReady ? '取消准备' : '准备';
  elements.readyBtn.disabled = true;
  setTimeout(() => {
    elements.readyBtn.disabled = false;
  }, 1000);
}

function renderHand() {
  elements.myHand.innerHTML = '';
  elements.myCardCount.textContent = gameState.hand.length;

  gameState.hand.forEach((card, index) => {
    const cardEl = createCardElement(card, index);
    elements.myHand.appendChild(cardEl);
  });
}

// 创建牌元素
function getSuitSymbol(suit) {
  return { hearts: '\u2665', diamonds: '\u2666', clubs: '\u2663', spades: '\u2660' }[suit] || '';
}

function getCardColorClass(card) {
  return card.suit === 'hearts' || card.suit === 'diamonds' || card.rank === 'big' ? 'red' : 'black';
}

function createCardElement(card, index) {
  const cardEl = document.createElement('div');
  cardEl.className = `card ${card.suit} ${getCardColorClass(card)}`;
  cardEl.dataset.cardId = card.id;
  cardEl.dataset.index = index;

  if (card.suit === 'joker') {
    const isBigJoker = card.rank === 'big';
    cardEl.classList.add('joker', isBigJoker ? 'big-joker' : 'small-joker');
    cardEl.innerHTML = `
      <span class="joker-crown">${isBigJoker ? '\u2605' : '\u25c6'}</span>
      <span class="joker-letter">JOKER</span>
      <span class="joker-name">${isBigJoker ? '\u5927\u738b' : '\u5c0f\u738b'}</span>
    `;
  } else {
    const suitSymbol = getSuitSymbol(card.suit);
    cardEl.innerHTML = `
      <span class="corner top">${card.rank}${suitSymbol}</span>
      <span class="rank">${card.rank}</span>
      <span class="suit">${suitSymbol}</span>
      <span class="corner bottom">${card.rank}${suitSymbol}</span>
    `;
  }

  if (card.isTrump || isClientTrumpCard(card)) {
    cardEl.classList.add('trump');
  }

  cardEl.addEventListener('click', () => toggleCardSelection(card, cardEl));

  return cardEl;
}

function getAutoSelectCards(card) {
  if (gameState.isExchanging) return [card];

  const effectiveSuit = getClientEffectiveSuit(card);
  const suitedCards = gameState.hand.filter(handCard => getClientEffectiveSuit(handCard) === effectiveSuit);
  const groups = new Map();
  suitedCards.forEach(handCard => {
    const key = `${handCard.suit}-${handCard.rank}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(handCard);
  });

  const pairGroups = [...groups.entries()]
    .filter(([, groupCards]) => groupCards.length >= 2)
    .map(([key, groupCards]) => ({
      key,
      rankIndex: getClientRankIndex(groupCards[0]),
      cards: groupCards.slice(0, 2)
    }))
    .sort((a, b) => a.rankIndex - b.rankIndex);

  const clickedKey = `${card.suit}-${card.rank}`;
  const clickedPair = pairGroups.find(group => group.key === clickedKey);
  if (!clickedPair) return [card];

  const clickedIndex = pairGroups.indexOf(clickedPair);
  let start = clickedIndex;
  let end = clickedIndex;

  while (start > 0 && pairGroups[start].rankIndex === pairGroups[start - 1].rankIndex + 1) {
    start--;
  }
  while (end < pairGroups.length - 1 && pairGroups[end + 1].rankIndex === pairGroups[end].rankIndex + 1) {
    end++;
  }

  const chain = pairGroups.slice(start, end + 1);
  return (chain.length >= 2 ? chain : [clickedPair]).flatMap(group => group.cards);
}

function toggleCardSelection(card, cardEl) {
  const cardId = card.id || cardEl.dataset.cardId;
  const index = gameState.selectedCards.findIndex(c => c.id === cardId);

  if (index === -1) {
    getAutoSelectCards(card).forEach(autoCard => {
      if (!gameState.selectedCards.some(selected => selected.id === autoCard.id)) {
        gameState.selectedCards.push(autoCard);
      }
      const autoCardEl = elements.myHand.querySelector(`[data-card-id="${autoCard.id}"]`);
      if (autoCardEl) autoCardEl.classList.add('selected');
    });
  } else {
    gameState.selectedCards.splice(index, 1);
    cardEl.classList.remove('selected');
  }

  if (gameState.isExchanging || elements.playBtn.dataset.action === 'exchange') {
    elements.playBtn.classList.remove('hidden');
  } else if (gameState.selectedCards.length > 0) {
    elements.playBtn.classList.remove('hidden');
  } else {
    elements.playBtn.classList.add('hidden');
  }
}

function playCards() {
  if (gameState.selectedCards.length === 0) return;

  // 验证出牌规则
  const validation = validatePlay(gameState.selectedCards);
  if (!validation.valid) {
    alert(validation.message);
    return;
  }

  gameState.socket.emit('play-cards', gameState.selectedCards);
  gameState.selectedCards = [];
  elements.playBtn.classList.add('hidden');

  // 移除选中状态
  document.querySelectorAll('.card.selected').forEach(el => {
    el.classList.remove('selected');
  });
}

// 验证出牌规则
function getClientCardValue(card) {
  const suitOrder = { spades: 3, hearts: 2, diamonds: 1, clubs: 0 };
  const rankValue = { A: 14, K: 13, Q: 12, J: 11, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3 };

  if (card.rank === 'big') return 1000;
  if (card.rank === 'small') return 999;
  if (card.rank === '7' && card.suit === gameState.trumpSuit && !gameState.isNoTrump) return 998;
  if (card.rank === '7') return 200 + (suitOrder[card.suit] || 0);
  if (card.rank === '2' && card.suit === gameState.trumpSuit && !gameState.isNoTrump) return 197;
  if (card.rank === '2') return 100 + (suitOrder[card.suit] || 0);
  if (card.suit === gameState.trumpSuit && !gameState.isNoTrump) return 50 + (rankValue[card.rank] || 0);
  return rankValue[card.rank] || 0;
}

function isClientTrumpCard(card) {
  if (card.suit === 'joker') return true;
  if (card.rank === '2' || card.rank === '7') return true;
  if (!gameState.isNoTrump && card.suit === gameState.trumpSuit) return true;
  return false;
}

function getClientEffectiveSuit(card) {
  return isClientTrumpCard(card) ? 'trump' : card.suit;
}

function getClientRankIndex(card) {
  const suitOrder = { diamonds: 0, clubs: 1, hearts: 2, spades: 3 };
  const normalOrder = ['3', '4', '5', '6', '8', '9', '10', 'J', 'Q', 'K', 'A'];

  if (card.rank === 'big') return 100;
  if (card.rank === 'small') return 99;
  if (getClientEffectiveSuit(card) === 'trump') {
    if (card.rank === '7') return (!gameState.isNoTrump && card.suit === gameState.trumpSuit) ? 98 : 94 + (suitOrder[card.suit] || 0);
    if (card.rank === '2') return (!gameState.isNoTrump && card.suit === gameState.trumpSuit) ? 93 : 89 + (suitOrder[card.suit] || 0);
  }

  return normalOrder.indexOf(card.rank);
}

function getClientPairGroups(cards) {
  const groups = new Map();
  cards.forEach(card => {
    const key = `${card.suit}-${card.rank}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(card);
  });

  return [...groups.values()]
    .filter(group => group.length >= 2)
    .map(group => ({
      rankIndex: getClientRankIndex(group[0]),
      value: getClientCardValue(group[0])
    }))
    .sort((a, b) => a.rankIndex - b.rankIndex);
}

function getClientLongestTractor(pairGroups) {
  let best = [];
  let current = [];
  pairGroups.forEach(group => {
    const previous = current[current.length - 1];
    if (!previous || group.rankIndex === previous.rankIndex + 1) {
      current.push(group);
    } else {
      current = [group];
    }
    if (current.length > best.length) best = current.slice();
  });
  return best.length >= 2 ? best : [];
}

function analyzeClientPlay(cards) {
  if (!Array.isArray(cards) || cards.length === 0) return { valid: false };
  const suit = getClientEffectiveSuit(cards[0]);
  if (!cards.every(card => getClientEffectiveSuit(card) === suit)) return { valid: false };

  const pairGroups = getClientPairGroups(cards);
  const tractorGroups = getClientLongestTractor(pairGroups);
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
    tractorLength: tractorGroups.length
  };
}

function clientCountEffectiveSuit(cards, suit) {
  return cards.filter(card => getClientEffectiveSuit(card) === suit).length;
}

function clientHasPair(cards, suit) {
  return getClientPairGroups(cards.filter(card => getClientEffectiveSuit(card) === suit)).length > 0;
}

function clientHasTractor(cards, suit, minLength) {
  const suitedCards = cards.filter(card => getClientEffectiveSuit(card) === suit);
  return getClientLongestTractor(getClientPairGroups(suitedCards)).length >= minLength;
}

function validatePlay(cards) {
  if (gameState.currentRound.length === 0) {
    const playAnalysis = analyzeClientPlay(cards);
    return playAnalysis.valid
      ? { valid: true }
      : { valid: false, message: '出牌必须是同一花色；主牌、常主和王算作主牌花色。' };
  }

  const firstPlay = gameState.currentRound[0];
  const leadAnalysis = analyzeClientPlay(firstPlay.cards);
  if (!leadAnalysis.valid || cards.length !== leadAnalysis.length) {
    return { valid: false, message: `本轮必须出 ${firstPlay.cards.length} 张牌。` };
  }

  const leadSuitInHand = clientCountEffectiveSuit(gameState.hand, leadAnalysis.suit);
  const requiredFollowCount = Math.min(leadAnalysis.length, leadSuitInHand);
  const playedLeadSuitCount = clientCountEffectiveSuit(cards, leadAnalysis.suit);
  if (playedLeadSuitCount < requiredFollowCount) {
    return { valid: false, message: '你有首家花色时必须优先跟足。' };
  }

  const playedLeadSuitCards = cards.filter(card => getClientEffectiveSuit(card) === leadAnalysis.suit);
  const followedLeadSuit = playedLeadSuitCount > 0;
  const allPlayedTrump = cards.every(card => getClientEffectiveSuit(card) === 'trump');
  const isTrumpKill = !followedLeadSuit && allPlayedTrump && leadAnalysis.suit !== 'trump';
  if (followedLeadSuit || isTrumpKill) {
    const obligationSuit = followedLeadSuit ? leadAnalysis.suit : 'trump';
    const structureCards = followedLeadSuit ? playedLeadSuitCards : cards;
    const structureAnalysis = analyzeClientPlay(structureCards);
    const obligationSuitInHand = clientCountEffectiveSuit(gameState.hand, obligationSuit);
    if (leadAnalysis.type === 'tractor' || leadAnalysis.tractorLength >= 2) {
      if (obligationSuitInHand >= leadAnalysis.tractorLength * 2 &&
          clientHasTractor(gameState.hand, obligationSuit, leadAnalysis.tractorLength)) {
        return structureAnalysis.valid && structureAnalysis.type === 'tractor' && structureAnalysis.tractorLength >= leadAnalysis.tractorLength
          ? { valid: true }
          : { valid: false, message: '你有对应拖拉机时必须跟拖拉机。' };
      }
      if (obligationSuitInHand >= 2 &&
          clientHasPair(gameState.hand, obligationSuit) && (!structureAnalysis.valid || structureAnalysis.pairCount === 0)) {
        return { valid: false, message: '你没有拖拉机但有对子时必须跟对子。' };
      }
    }

    if ((leadAnalysis.type === 'pair' || leadAnalysis.pairCount > 0) &&
        obligationSuitInHand >= 2 &&
        clientHasPair(gameState.hand, obligationSuit) && (!structureAnalysis.valid || structureAnalysis.pairCount === 0)) {
      return { valid: false, message: '你有对子时必须跟对子。' };
    }
  }

  return { valid: true };
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
function updateCurrentBidder(bidderIndex) {
  const currentPlayer = gameState.players[bidderIndex];
  if (currentPlayer && currentPlayer.id === gameState.playerId) {
    elements.bidPanel.classList.remove('hidden');
    addChatMessage('系统', '轮到你了，请叫分！');
  } else {
    elements.bidPanel.classList.add('hidden');
  }

  // 高亮显示当前叫分者
  document.querySelectorAll('.player-seat').forEach(seat => seat.classList.remove('active'));
  const seatEl = getSeatElement(bidderIndex);
  if (seatEl) seatEl.classList.add('active');
}

function updateBidDisplay(data) {
  elements.targetScore.textContent = data.currentBid;
  updateBidButtons(data.hasValidBid ? data.currentBid : 105);
  gameState.currentBidder = data.currentBidder;

  // 更新叫分记录
  elements.bidList.innerHTML = '';
  data.bidHistory.forEach(bid => {
    const li = document.createElement('li');
    li.textContent = `${bid.player}: ${bid.bid === 'pass' ? '不叫' : bid.bid}`;
    elements.bidList.appendChild(li);
  });

  // 检查是否轮到自己（只有在叫分阶段才显示叫分面板）
  if (data.state === 'bidding') {
    updateCurrentBidder(data.currentBidder);
  } else {
    // 其他阶段隐藏叫分面板
    elements.bidPanel.classList.add('hidden');
  }

  // 如果是选择主牌阶段
  if (data.state === 'choosing-trump') {
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
  elements.trumpDisplay.classList.remove('hidden');
  if (isNoTrump) {
    elements.trumpDisplay.innerHTML = '<span>\ud83c\udccf \u65e0\u4e3b</span>';
    elements.trumpDisplay.style.background = 'linear-gradient(135deg, #64748b, #334155)';
  } else {
    const suitInfo = {
      spades: { symbol: '\u2660', name: '\u9ed1\u6843', color: '#111827' },
      hearts: { symbol: '\u2665', name: '\u7ea2\u6843', color: '#dc2626' },
      clubs: { symbol: '\u2663', name: '\u6885\u82b1', color: '#166534' },
      diamonds: { symbol: '\u2666', name: '\u65b9\u7247', color: '#d97706' }
    };
    const info = suitInfo[suit];
    elements.trumpDisplay.innerHTML = `<span class="trump-symbol">${info.symbol}</span><span>\u4e3b\u724c\uff1a${info.name}</span>`;
    elements.trumpDisplay.style.background = `linear-gradient(135deg, ${info.color}, #0f172a)`;
  }
}

function showBottomCards(cards) {
  elements.bottomCardsDisplay.innerHTML = '';
  cards.forEach(card => {
    const cardEl = createCardElement(card);
    cardEl.style.width = '45px';
    cardEl.style.height = '63px';
    elements.bottomCardsDisplay.appendChild(cardEl);
  });
  elements.bottomCardsPanel.querySelector('h3').textContent = '\u5e95\u724c\uff08\u67e5\u770b\uff09';
  elements.bottomCardsPanel.classList.remove('hidden');
}

function sortClientHand(cards) {
  const rankOrder = { big: 100, small: 99, '2': 98, '7': 97, A: 14, K: 13, Q: 12, J: 11, '10': 10, '9': 9, '8': 8, '6': 6, '5': 5, '4': 4, '3': 3 };
  const suitOrder = { spades: 4, hearts: 3, clubs: 2, diamonds: 1, joker: 5 };

  return [...cards].sort((a, b) => {
    if (a.rank === 'big') return -1;
    if (b.rank === 'big') return 1;
    if (a.rank === 'small') return -1;
    if (b.rank === 'small') return 1;

    const aIsConstantTrump = a.rank === '7' || a.rank === '2';
    const bIsConstantTrump = b.rank === '7' || b.rank === '2';
    if (aIsConstantTrump && !bIsConstantTrump) return -1;
    if (!aIsConstantTrump && bIsConstantTrump) return 1;
    if (aIsConstantTrump && bIsConstantTrump) {
      if (a.rank !== b.rank) return (rankOrder[b.rank] || 0) - (rankOrder[a.rank] || 0);
      return (suitOrder[b.suit] || 0) - (suitOrder[a.suit] || 0);
    }

    if (a.suit !== b.suit) return (suitOrder[b.suit] || 0) - (suitOrder[a.suit] || 0);
    return (rankOrder[b.rank] || 0) - (rankOrder[a.rank] || 0);
  });
}

function showExchangePanel(payload) {
  if (gameState.exchangePanelShown) return;

  const bottomCards = Array.isArray(payload) ? payload : (payload.bottomCards || []);
  const mergedHand = Array.isArray(payload?.hand)
    ? payload.hand
    : [...gameState.hand, ...bottomCards.filter(card => !gameState.hand.some(handCard => handCard.id === card.id))];

  gameState.exchangePanelShown = true;
  gameState.isExchanging = true;
  gameState.bottomCards = [];
  gameState.selectedCards = [];
  gameState.hand = sortClientHand(mergedHand);
  renderHand();

  addChatMessage('\u7cfb\u7edf', '\u5e95\u724c\u5df2\u52a0\u5165\u4f60\u7684\u624b\u724c\uff0c\u8bf7\u9009\u62e9 8 \u5f20\u4f5c\u4e3a\u65b0\u5e95\u724c\u3002');

  elements.playBtn.classList.remove('hidden');
  elements.playBtn.dataset.action = 'exchange';
  elements.playBtn.textContent = '\u786e\u5b9a\u5e95\u724c';

  const newPlayBtn = elements.playBtn.cloneNode(true);
  elements.playBtn.parentNode.replaceChild(newPlayBtn, elements.playBtn);
  elements.playBtn = newPlayBtn;

  elements.playBtn.addEventListener('click', () => {
    const selectedCards = document.querySelectorAll('.card.selected');
    if (selectedCards.length !== 8) {
      alert(`\u8bf7\u9009\u62e9 8 \u5f20\u724c\u4f5c\u4e3a\u5e95\u724c\uff0c\u5f53\u524d\u9009\u62e9\u4e86 ${selectedCards.length} \u5f20\u3002`);
      return;
    }

    const selectedCardsData = [...selectedCards]
      .map(el => gameState.hand.find(card => card.id === el.dataset.cardId))
      .filter(Boolean);

    gameState.bottomCards = selectedCardsData;
    gameState.hand = gameState.hand.filter(card => !selectedCardsData.some(selected => selected.id === card.id));
    gameState.socket.emit('finish-exchange', gameState.bottomCards);

    gameState.isExchanging = false;
    gameState.selectedCards = [];
    elements.playBtn.dataset.action = 'play';
    elements.playBtn.textContent = '\u51fa\u724c';
    elements.playBtn.classList.add('hidden');
    renderHand();
    addChatMessage('\u7cfb\u7edf', '\u5e95\u724c\u5df2\u786e\u5b9a\uff0c\u7b49\u5f85\u5e84\u5bb6\u9009\u4e3b\u3002');
  });
}

function resetExchangePanel() {
  gameState.exchangePanelShown = false;
  gameState.isExchanging = false;
}

function finishExchange(newBottomCards) {
}

function showPlayedCards(playerIndex, cards) {
  const playerName = gameState.players[playerIndex]?.name || '玩家';

  // 显示在桌面中央
  const playContainer = document.createElement('div');
  playContainer.className = 'play-container';
  playContainer.innerHTML = `<span class="player-label">${playerName}</span>`;

  const cardsContainer = document.createElement('div');
  cardsContainer.className = 'played-cards-container';

  cards.forEach(card => {
    const cardEl = createPlayedCardElement(card);
    cardsContainer.appendChild(cardEl);
  });

  playContainer.appendChild(cardsContainer);
  elements.playedCardsArea.appendChild(playContainer);
  renderSeatPlayPile(playerIndex, cards);

  // 添加到出牌记录
  addPlayHistory(playerName, cards);

  // 记录到当前轮次
  gameState.currentRound.push({
    player: playerIndex,
    playerName: playerName,
    cards: cards,
    isDealer: gameState.players[playerIndex]?.isDealer
  });

  // 如果是首家出牌，记录领出花色
  if (gameState.currentRound.length === 1) {
    const firstCard = cards[0];
    // 判断是否是主牌
    if (firstCard.suit === 'joker' || firstCard.rank === '2' || firstCard.rank === '7' ||
        (!gameState.isNoTrump && firstCard.suit === gameState.trumpSuit)) {
      gameState.leadSuit = 'trump'; // 主牌领出
      console.log('首家出主牌（钓主）');
    } else {
      gameState.leadSuit = firstCard.suit;
      console.log('首家领出花色:', firstCard.suit);
    }
  }

  // 4张出完后，清除当前轮次记录
  if (gameState.currentRound.length === 4) {
    setTimeout(() => {
      gameState.currentRound = [];
      gameState.leadSuit = null;
      elements.playedCardsArea.innerHTML = '';
    }, 3000);
  } else {
    // 3秒后清除（如果还没出完4张）
    setTimeout(() => {
      playContainer.remove();
    }, 3000);
  }
}

// 添加出牌记录
function addPlayHistory(playerName, cards) {
  elements.playHistory.classList.toggle('hidden', !gameState.playHistoryVisible);
  elements.playHistoryList.querySelectorAll('.latest').forEach(item => item.classList.remove('latest'));

  const item = document.createElement('div');
  item.className = 'play-history-item latest';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'player-name';
  nameSpan.textContent = playerName;
  item.appendChild(nameSpan);

  const countSpan = document.createElement('span');
  countSpan.className = 'card-count';
  countSpan.textContent = `${cards.length}\u5f20`;
  item.appendChild(countSpan);

  const cardsDiv = document.createElement('div');
  cardsDiv.className = 'cards';

  cards.forEach(card => {
    cardsDiv.appendChild(createMiniCardElement(card));
  });

  item.appendChild(cardsDiv);
  elements.playHistoryList.insertBefore(item, elements.playHistoryList.firstChild);

  while (elements.playHistoryList.children.length > 20) {
    elements.playHistoryList.removeChild(elements.playHistoryList.lastChild);
  }
}

function createMiniCardElement(card) {
  const miniCard = document.createElement('div');
  miniCard.className = `card-mini ${getCardColorClass(card)}`;
  if (card.isTrump || isClientTrumpCard(card)) {
    miniCard.classList.add('trump-mini');
  }
  if (card.suit === 'joker') {
    miniCard.classList.add('joker-mini');
    miniCard.textContent = card.rank === 'big' ? '\u5927\u738b' : '\u5c0f\u738b';
  } else {
    miniCard.textContent = `${card.rank}${getSuitSymbol(card.suit)}`;
  }
  return miniCard;
}

function createPlayedCardElement(card) {
  const cardEl = document.createElement('div');
  cardEl.className = `played-card ${card.suit} ${getCardColorClass(card)}`;
  if (card.isTrump || isClientTrumpCard(card)) {
    cardEl.classList.add('trump');
  }

  if (card.suit === 'joker') {
    const isBigJoker = card.rank === 'big';
    cardEl.classList.add('joker', isBigJoker ? 'big-joker' : 'small-joker');
    cardEl.innerHTML = `
      <span class="joker-crown">${isBigJoker ? '\u2605' : '\u25c6'}</span>
      <span class="joker-name">${isBigJoker ? '\u5927\u738b' : '\u5c0f\u738b'}</span>
    `;
  } else {
    const suitSymbol = getSuitSymbol(card.suit);
    cardEl.innerHTML = `
      <span class="rank">${card.rank}</span>
      <span class="suit">${suitSymbol}</span>
    `;
  }

  return cardEl;
}

function updateCurrentPlayer(playerIndex) {
  document.querySelectorAll('.player-seat').forEach(seat => {
    seat.classList.remove('active');
  });

  const seatEl = getSeatElement(playerIndex);

  if (seatEl) {
    seatEl.classList.add('active');
  }

  if (playerIndex === gameState.seat) {
    addChatMessage('\u7cfb\u7edf', '\u8f6e\u5230\u4f60\u4e86\uff01');
  }
}

function updatePlayerCardCount(playerIndex, count) {
  const seatEl = getSeatElement(playerIndex);

  if (seatEl) {
    const currentCount = parseInt(seatEl.querySelector('.player-cards').textContent);
    seatEl.querySelector('.player-cards').textContent = currentCount - count;
  }
}

function togglePlayHistory() {
  gameState.playHistoryVisible = !gameState.playHistoryVisible;
  elements.playHistory.classList.toggle('hidden', !gameState.playHistoryVisible);
  elements.toggleHistoryBtn.classList.toggle('active', gameState.playHistoryVisible);
}

function toggleSystemMessages() {
  gameState.systemMessagesVisible = !gameState.systemMessagesVisible;
  elements.toggleSystemBtn.classList.toggle('active', gameState.systemMessagesVisible);
  elements.toggleSystemBtn.textContent = gameState.systemMessagesVisible ? '\u7cfb\u7edf\u63d0\u793a' : '\u63d0\u793a\u5173\u95ed';
  elements.chatMessages.classList.toggle('hide-system', !gameState.systemMessagesVisible);
}

function clearSeatPlayPiles() {
  document.querySelectorAll('.seat-play-pile').forEach(pile => {
    pile.innerHTML = '';
  });
}

function renderSeatPlayPile(playerIndex, cards) {
  const seatEl = getSeatElement(playerIndex);
  if (!seatEl) return;
  const pile = seatEl.querySelector('.seat-play-pile');
  pile.innerHTML = '';
  cards.forEach(card => {
    const mini = createMiniCardElement(card);
    pile.appendChild(mini);
  });
}

function renderScoringCards(cards) {
  gameState.scoringCards = cards || [];
  if (!elements.scoringCardsPanel) return;
  elements.scoringCardsPanel.innerHTML = '';
  if (!gameState.scoringCards.length) {
    elements.scoringCardsPanel.textContent = '得分牌：无';
    return;
  }
  const label = document.createElement('span');
  label.className = 'scoring-label';
  label.textContent = '得分牌';
  elements.scoringCardsPanel.appendChild(label);
  const list = document.createElement('div');
  list.className = 'scoring-card-list';
  gameState.scoringCards.forEach(card => list.appendChild(createMiniCardElement(card)));
  elements.scoringCardsPanel.appendChild(list);
}

function showTableBottomDeck() {
  if (!elements.tableBottomDeck) return;
  elements.tableBottomDeck.classList.remove('hidden', 'move-to-bottom', 'move-to-right', 'move-to-top', 'move-to-left');
  elements.tableBottomDeck.innerHTML = '';
  for (let i = 0; i < 8; i++) {
    const back = document.createElement('div');
    back.className = 'bottom-card-back';
    elements.tableBottomDeck.appendChild(back);
  }
}

function animateBottomDeckToDealer(dealerIndex) {
  if (!elements.tableBottomDeck) return;
  const relativeSeat = (dealerIndex - gameState.seat + 4) % 4;
  const directionClasses = ['move-to-bottom', 'move-to-right', 'move-to-top', 'move-to-left'];
  elements.tableBottomDeck.classList.remove('move-to-bottom', 'move-to-right', 'move-to-top', 'move-to-left');
  elements.tableBottomDeck.classList.add(directionClasses[relativeSeat] || 'move-to-top');
  setTimeout(() => {
    elements.tableBottomDeck.classList.add('hidden');
    elements.tableBottomDeck.classList.remove('move-to-bottom', 'move-to-right', 'move-to-top', 'move-to-left');
  }, 700);
}

function showRoundResult(data) {
  elements.teamScore.textContent = data.totalScore;
  const winnerName = gameState.players[data.winner]?.name || '\u73a9\u5bb6';
  addChatMessage('\u7cfb\u7edf', `${winnerName} \u8d62\u5f97\u672c\u8f6e\uff0c\u5f97\u5206\uff1a${data.score}`);
  if (data.isLastRound) {
    addChatMessage('\u7cfb\u7edf', '\u672c\u5c40\u7ed3\u675f\uff01');
  }
}

function showEarlyFinishPanel(data) {
  elements.earlyFinishPanel.classList.remove('hidden');
  elements.earlyFinishBtn.disabled = false;
  elements.earlyFinishBtn.textContent = '\u540c\u610f\u7ed3\u675f';
  elements.earlyFinishText.textContent = `\u95f2\u5bb6\u5df2\u8fbe\u5230 ${data.targetScore} \u5206\uff0c\u53ef\u56db\u4eba\u540c\u610f\u540e\u76f4\u63a5\u7ed3\u675f\u672c\u5c40\u3002\u5df2\u540c\u610f\uff1a${data.votes}/${data.total}`;
}

function updateEarlyFinishVotes(data) {
  elements.earlyFinishPanel.classList.remove('hidden');
  elements.earlyFinishText.textContent = `\u5df2\u540c\u610f\u7ed3\u675f\uff1a${data.votes}/${data.total}`;
  if (data.voters.includes(gameState.seat)) {
    elements.earlyFinishBtn.disabled = true;
    elements.earlyFinishBtn.textContent = '\u5df2\u540c\u610f';
  }
}

function voteEndGame() {
  gameState.socket.emit('vote-end-game');
  elements.earlyFinishBtn.disabled = true;
  elements.earlyFinishBtn.textContent = '\u5df2\u540c\u610f';
}

function showAllPassLoser(data) {
  elements.resultModal.classList.remove('hidden');
  elements.resultTitle.textContent = '\u56db\u4eba\u90fd\u4e0d\u53eb';
  elements.resultContent.innerHTML = `
    <div class="result-score result-lose">${escapeHtml(data.loserName)}</div>
    <p>\u5e38\u4e3b\u6700\u591a\u6216\u6700\u5927\uff0c\u5224\u5b9a\u4e3a\u672c\u5c40\u8f93\u5bb6\u3002</p>
    <p>\u5e38\u4e3b\u6570\uff1a${data.trumpCount}</p>
    <p>\u8bf7\u51c6\u5907\u5f00\u59cb\u4e0b\u4e00\u5c40\u3002</p>
  `;
  elements.readyBtn.classList.remove('hidden');
  elements.readyBtn.textContent = '\u51c6\u5907';
  elements.readyBtn.disabled = false;
  elements.bidPanel.classList.add('hidden');
  elements.earlyFinishPanel.classList.add('hidden');
}

function showGameResult(data) {
  elements.resultModal.classList.remove('hidden');
  elements.earlyFinishPanel.classList.add('hidden');
  let title, content, className;
  const isDealerWin = data.result === 'dealer-won';
  const iAmDealer = gameState.players[gameState.seat]?.isDealer;

  if (data.settlement?.special === 'qingguang') {
    title = '\u6e05\u5149';
    content = '\u95f2\u5bb6\u672c\u5c40\u6ca1\u6709\u5f97\u5206\u3002';
    className = iAmDealer ? 'result-win' : 'result-lose';
  } else if (data.settlement?.special === 'bianguang') {
    title = '\u8fb9\u5149';
    content = '\u95f2\u5bb6\u5f97\u5206\u5c0f\u4e8e 30\uff0c\u5e84\u5bb6\u7ed3\u7b97\u7ffb\u500d\u3002';
    className = iAmDealer ? 'result-win' : 'result-lose';
  } else if (data.result === 'dealer-lost') {
    title = '\u95f2\u5bb6\u80dc\u5229';
    content = '\u95f2\u5bb6\u5f97\u5206\u8fbe\u5230\u5e84\u5bb6\u76ee\u6807\u3002';
    className = !iAmDealer ? 'result-win' : 'result-lose';
  } else {
    title = '\u5e84\u5bb6\u80dc\u5229';
    content = '\u5e84\u5bb6\u5b88\u4f4f\u4e86\u76ee\u6807\u5206\u3002';
    className = iAmDealer ? 'result-win' : 'result-lose';
  }

  elements.resultTitle.textContent = title;
  const settlementRows = data.settlement?.deltas
    ? data.settlement.deltas.map((delta, index) => {
        const name = escapeHtml(gameState.players[index]?.name || `玩家${index + 1}`);
        const total = data.settlement.totals?.[index] ?? 0;
        const sign = delta > 0 ? '+' : '';
        return `<p>${name}: ${sign}${delta}（累计 ${total}）</p>`;
      }).join('')
    : '';

  elements.resultContent.innerHTML = `
    <div class="result-score ${className}">${data.teamScore} / ${data.targetScore}</div>
    <p>${content}</p>
    <p>\u95f2\u5bb6\u5f97\u5206\uff1a${data.teamScore}</p>
    <p>\u5e84\u5bb6\u76ee\u6807\uff1a${data.targetScore}</p>
    ${data.settlement ? `<p>本局结算：${data.settlement.unit} 分/闲家</p>${settlementRows}` : ''}
  `;
}

function copyInviteLink() {
  const url = new URL(window.location);
  url.searchParams.set('room', gameState.roomId);
  navigator.clipboard.writeText(url.toString()).then(() => {
    elements.copyLinkBtn.textContent = '\u5df2\u590d\u5236';
    setTimeout(() => {
      elements.copyLinkBtn.textContent = '\u590d\u5236\u9080\u8bf7';
    }, 2000);
  });
}

function sendChatMessage() {
  const message = elements.chatInput.value.trim();
  if (!message) return;
  gameState.socket.emit('chat-message', message);
  elements.chatInput.value = '';
}

function addChatMessage(player, message) {
  const isSystem = isSystemMessage(player);
  const msgEl = document.createElement('div');
  msgEl.className = isSystem ? 'message system-message' : 'message';
  msgEl.innerHTML = `<span class="player-name">${player}:</span> ${escapeHtml(message)}`;
  elements.chatMessages.appendChild(msgEl);
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function isSystemMessage(player) {
  return player === '\u7cfb\u7edf' || player === 'ç³»ç»Ÿ' || player === 'ç»¯è¤ç²º';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function getSuitName(suit) {
  const names = {
    spades: '\u9ed1\u6843',
    hearts: '\u7ea2\u6843',
    clubs: '\u6885\u82b1',
    diamonds: '\u65b9\u7247'
  };
  return names[suit] || suit;
}

document.addEventListener('DOMContentLoaded', init);
