// 游戏状态
function createInitialGameState() { return {
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
  hintRequest: null,
  leavingRoom: false,
  playHistoryVisible: false,
  chatVisible: !window.matchMedia?.('(max-width: 768px), (max-width: 1100px) and (max-height: 600px)')?.matches,
  scoringCards: [],
  countdownTimer: null,
  countdownKey: null
}; }
const gameState = createInitialGameState();
let accountUser = null;

const COUNTDOWN_SECONDS = {
  bidding: 20,
  choosingTrump: 20,
  playing: 30
};

// DOM元素
const elements = {
  homeScreen: document.getElementById('home-screen'),
  gameScreen: document.getElementById('game-screen'),
  createRoomBtn: document.getElementById('create-room-btn'),
  quickJoinBtn: document.getElementById('quick-join-btn'),
  hintBtn: document.getElementById('hint-btn'),
  joinRoomBtn: document.getElementById('join-room-btn'),
  joinRoomPanel: document.getElementById('join-room-panel'),
  roomIdInput: document.getElementById('room-id'),
  confirmJoinBtn: document.getElementById('confirm-join-btn'),
  rulesModal: document.getElementById('rules-modal'),
  showRulesBtn: document.getElementById('show-rules'),
  closeRulesBtn: document.querySelector('#rules-modal .close-btn'),
  roomIdDisplay: document.getElementById('room-id-display'),
  copyLinkBtn: document.getElementById('copy-link-btn'),
  leaveRoomBtn: document.getElementById('leave-room-btn'),
  resultLeaveBtn: document.getElementById('result-leave-btn'),
  leaveRoomModal: document.getElementById('leave-room-modal'),
  leaveRoomMessage: document.getElementById('leave-room-message'),
  cancelLeaveBtn: document.getElementById('cancel-leave-btn'),
  confirmLeaveBtn: document.getElementById('confirm-leave-btn'),
  toggleHistoryBtn: document.getElementById('toggle-history-btn'),
  toggleChatBtn: document.getElementById('toggle-chat-btn'),
  gameStatus: document.getElementById('game-status'),
  trumpDisplay: document.getElementById('trump-display'),
  countdownDisplay: document.getElementById('countdown-display'),
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
  chatBox: document.getElementById('chat-box'),
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
  const sessionId = accountUser?.id || null;
  gameState.sessionId = sessionId;
  return sessionId;
}


function setJoinBusy(isBusy) {
  gameState.joiningRoom = isBusy;
  elements.createRoomBtn.disabled = isBusy;
  elements.quickJoinBtn.disabled = isBusy;
  elements.joinRoomBtn.disabled = isBusy;
  elements.confirmJoinBtn.disabled = isBusy;
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

function startCountdown(label, deadline) {
  clearCountdown();
  if (!deadline) return;
  const render = () => {
    const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    elements.countdownDisplay.classList.remove('hidden');
    elements.countdownDisplay.textContent = remaining ? `${label} ${remaining}s` : '自动处理中…';
    elements.countdownDisplay.classList.toggle('urgent', remaining <= 5);
  };
  render();
  gameState.countdownTimer = setInterval(render, 250);
}

function notify(message) {
  const toast = document.getElementById('game-notice');
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(gameState.noticeTimer);
  gameState.noticeTimer = setTimeout(() => toast.classList.add('hidden'), 4000);
}

function updateActionButton() {
  const count = gameState.selectedCards.length;
  document.getElementById('selection-count').textContent = gameState.isExchanging ? `已选 ${count} / 8 张底牌` : `已选 ${count} 张`;
  const canPlay = gameState.currentState === 'playing' && gameState.currentPlayer === gameState.seat && !gameState.roundResolving;
  elements.hintBtn.classList.toggle('hidden', !canPlay);
  elements.hintBtn.disabled = !gameState.socket?.connected || !canPlay || !!gameState.hintRequest;
  elements.playBtn.classList.toggle('hidden', !gameState.isExchanging && !canPlay);
  elements.playBtn.disabled = !gameState.socket?.connected || (gameState.isExchanging ? count !== 8 : !canPlay || count === 0);
}

function clearCountdown() {
  if (gameState.countdownTimer) {
    clearInterval(gameState.countdownTimer);
    gameState.countdownTimer = null;
  }
  gameState.countdownKey = null;
  if (elements.countdownDisplay) {
    elements.countdownDisplay.classList.add('hidden');
    elements.countdownDisplay.classList.remove('urgent');
  }
}

// 初始化
function init() {
  // 检查URL参数
  const urlParams = new URLSearchParams(window.location.search);
  const roomIdFromUrl = urlParams.get('room');

  if (roomIdFromUrl) {
    elements.roomIdInput.value = roomIdFromUrl;
    elements.joinRoomPanel.classList.remove('hidden');
    elements.joinRoomBtn.setAttribute('aria-expanded', 'true');
  }

  // 事件监听
  elements.createRoomBtn.addEventListener('click', createRoom);
  elements.quickJoinBtn.addEventListener('click', quickJoinRoom);
  elements.hintBtn.addEventListener('click', suggestPlay);
  elements.joinRoomBtn.addEventListener('click', () => {
    elements.joinRoomPanel.classList.toggle('hidden');
    const expanded = !elements.joinRoomPanel.classList.contains('hidden');
    elements.joinRoomBtn.setAttribute('aria-expanded', String(expanded));
    if (expanded) elements.roomIdInput.focus();
  });
  elements.confirmJoinBtn.addEventListener('click', joinRoom);
  elements.showRulesBtn.addEventListener('click', (e) => {
    e.preventDefault();
    elements.rulesModal.classList.remove('hidden');
    elements.closeRulesBtn.focus();
  });
  elements.closeRulesBtn.addEventListener('click', () => {
    elements.rulesModal.classList.add('hidden');
    elements.showRulesBtn.focus();
  });
  elements.readyBtn.addEventListener('click', toggleReady);
  elements.playBtn.addEventListener('click', handlePlayBtnClick);
  elements.passBtn.addEventListener('click', () => placeBid('pass'));
  elements.copyLinkBtn.addEventListener('click', copyInviteLink);
  elements.leaveRoomBtn.addEventListener('click', requestLeaveRoom);
  elements.resultLeaveBtn.addEventListener('click', requestLeaveRoom);
  elements.cancelLeaveBtn.addEventListener('click', cancelLeaveRoom);
  elements.confirmLeaveBtn.addEventListener('click', leaveRoom);
  elements.leaveRoomModal.addEventListener('click', event => {
    if (event.target === elements.leaveRoomModal) cancelLeaveRoom();
  });
  elements.leaveRoomModal.addEventListener('keydown', event => {
    if (event.key === 'Escape') cancelLeaveRoom();
    if (event.key === 'Tab') {
      event.preventDefault();
      if (!gameState.leavingRoom) {
        (document.activeElement === elements.cancelLeaveBtn ? elements.confirmLeaveBtn : elements.cancelLeaveBtn).focus();
      }
    }
  });
  elements.toggleHistoryBtn.addEventListener('click', togglePlayHistory);
  elements.toggleChatBtn.addEventListener('click', toggleChatBox);
  applyChatVisibility();
  window.matchMedia?.('(max-width: 768px), (max-width: 1100px) and (max-height: 600px)').addEventListener('change', event => {
    if (event.matches) { gameState.chatVisible = false; applyChatVisibility(); }
  });
  elements.sendBtn.addEventListener('click', sendChatMessage);
  elements.earlyFinishBtn.addEventListener('click', voteEndGame);
  document.getElementById('clear-selection-btn').addEventListener('click', () => { gameState.selectedCards = []; renderHand(); });
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
    configurePlayButton('play');
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
      elements.showRulesBtn.focus();
    }
  });
  elements.rulesModal.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      elements.rulesModal.classList.add('hidden');
      elements.showRulesBtn.focus();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      elements.closeRulesBtn.focus();
    }
  });

  window.accountLobby = new window.AccountLobby({
    onAuthenticated(user) {
      accountUser = user;
      gameState.playerName = user.displayName;
      gameState.sessionId = user.id;
      const invitedRoom = new URLSearchParams(window.location.search).get('room');
      if (invitedRoom) { elements.roomIdInput.value = invitedRoom; joinRoom(); }
    },
    onJoin(roomId) { elements.roomIdInput.value = roomId; joinRoom(); },
    onAuthLost() { accountUser = null; returnToLobby(); }
  });
  window.accountLobby.start();
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
        } else {
          returnToLobby();
          notify('房间已结束，请重新创建或加入');
        }
      });
    }
  });

  gameState.socket.on('room-update', (room) => {
    if (room.id !== gameState.roomId) return;
    updateRoomDisplay(room);
    syncUiForRoomState(room);
  });

  gameState.socket.on('deal-cards', (cards) => {
    gameState.hand = cards;
    gameState.selectedCards = gameState.selectedCards.filter(c => cards.some(item => item.id === c.id));
    renderHand();
    addChatMessage('系统', '游戏开始，你已收到手牌');
  });

  // 主牌确定后，手牌重新排序
  gameState.socket.on('hand-sorted', (cards) => {
    gameState.hand = cards;
    gameState.selectedCards = gameState.selectedCards.filter(c => cards.some(item => item.id === c.id));
    renderHand();
  });

  gameState.socket.on('game-started', (data) => {
    elements.gameStatus.textContent = '叫分阶段';
    elements.bidHistory.classList.remove('hidden');
    elements.scorePanel.classList.remove('hidden');
    elements.targetScore.textContent = data.currentBid;
    elements.teamScore.textContent = data.teamScore || 0;
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
    elements.tableBottomDeck.classList.add('hidden');
    updateCurrentPlayer(data.currentPlayer);

    // 恢复出牌按钮的事件绑定
    configurePlayButton('play');
    updateActionButton();
  });

  gameState.socket.on('cards-played', (data) => {
    showPlayedCards(data.player, data.cards);
    if (data.player === gameState.seat) {
      const playedIds = new Set(data.cards.map(card => card.id));
      gameState.hand = gameState.hand.filter(card => !playedIds.has(card.id));
      gameState.selectedCards = gameState.selectedCards.filter(card => !playedIds.has(card.id));
      renderHand();
    }
    updatePlayerCardCount(data.player, data.cardCount);
    gameState.roundResolving = data.nextPlayer === null;
    if (gameState.currentRound.length < 4) {
      gameState.currentPlayer = data.nextPlayer;
      updateCurrentPlayer(data.nextPlayer);
    }
    updateActionButton();
  });

  gameState.socket.on('invalid-play', (message) => {
    notify(message);
  });

  gameState.socket.on('invalid-bid', (message) => {
    notify(message);
    updateCurrentBidder(gameState.currentBidder);
  });

  gameState.socket.on('round-end', (data) => {
    clearCountdown();
    gameState.roundResolving = false;
    elements.playedCardsArea.innerHTML = '';
    clearSeatPlayPiles();
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
    clearCountdown();
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

  gameState.socket.on('turn-clock', (data) => {
    const labels = { bidding: '叫分', exchanging: '埋牌', 'choosing-trump': '选主', playing: '出牌' };
    startCountdown(labels[data.state] || '操作', data.deadline);
  });
  gameState.socket.on('automated-action', (data) => {
    addChatMessage('系统', `${gameState.players[data.player]?.name || '玩家'} 已自动操作`);
  });
  gameState.socket.on('disconnect', () => {
    elements.gameStatus.textContent = '连接中断，正在重连…';
    gameState.hintRequest = null;
    updateActionButton();
    elements.playBtn.disabled = true;
    clearCountdown();
  });
  gameState.socket.on('session-replaced', () => {
    returnToLobby({ clearLastRoom: false });
    notify('此座位已在其他窗口登录，请重新加入');
  });
  gameState.socket.on('auth-expired', () => window.accountLobby?.expire());

  gameState.socket.on('connect_error' , (error) => {
    if (error.message === 'AUTH_REQUIRED') { window.accountLobby?.expire(); return; }
    console.error('Connection error:', error);
    setJoinBusy(false);
    notify('连接服务器失败，请刷新页面重试');
  });
}

// 创建房间
function createRoom() {
  if (gameState.joiningRoom) return;
  const name = accountUser?.displayName;
  if (!name) {
    notify('请先登录');
    return;
  }

  gameState.playerName = name;
  gameState.sessionId = getSessionId();
  setJoinBusy(true);
  connectSocket();

  const socket = gameState.socket;
  socket.timeout(10000).emit('create-room', {
    name,
    sessionId: gameState.sessionId,
    settlementSettings: getSettlementSettingsFromInputs()
  }, (error, response) => {
    if (socket !== gameState.socket || !accountUser) return;
    if (error) { setJoinBusy(false); notify('创建房间超时，请重试或刷新大厅'); window.accountLobby?.loadRooms(); return; }
    if (response.success) {
      gameState.roomId = response.roomId;
      gameState.playerId = response.playerId;
      gameState.sessionId = response.sessionId || gameState.sessionId;
      enterGame();
    } else {
      notify(response.error);
      setJoinBusy(false);
    }
  });
}

function joinRoom() {
  if (gameState.joiningRoom) return;
  const name = accountUser?.displayName;
  const roomId = elements.roomIdInput.value.trim();

  if (!name) {
    notify('请先登录');
    return;
  }
  if (!roomId) {
    notify('请输入房间号');
    return;
  }

  gameState.playerName = name;
  gameState.sessionId = getSessionId();
  setJoinBusy(true);
  connectSocket();

  const socket = gameState.socket;
  socket.timeout(10000).emit('join-room', roomId, { name, sessionId: gameState.sessionId }, (error, response) => {
    if (socket !== gameState.socket || !accountUser) return;
    if (error) { setJoinBusy(false); notify('加入房间超时，请重试'); return; }
    if (response.success) {
      gameState.roomId = response.roomId;
      gameState.playerId = response.playerId;
      gameState.sessionId = response.sessionId || gameState.sessionId;
      enterGame();
    } else {
      notify(response.error);
      setJoinBusy(false);
    }
  });
}

function quickJoinRoom() {
  if (gameState.joiningRoom || !accountUser) return;
  gameState.playerName = accountUser.displayName;
  getSessionId();
  setJoinBusy(true);
  connectSocket();
  const socket = gameState.socket;
  socket.timeout(10000).emit('quick-join', (error, response) => {
    if (socket !== gameState.socket || !accountUser) return;
    setJoinBusy(false);
    if (error || !response?.success) {
      notify(error ? '入座超时，请重试' : response?.error || '入座失败，请重试');
      window.accountLobby?.loadRooms();
      return;
    }
    gameState.roomId = response.roomId;
    gameState.playerId = response.playerId;
    gameState.sessionId = response.sessionId;
    enterGame();
  });
}

function enterGame() {
  window.accountLobby?.stop();
  [elements.homeScreen, elements.gameScreen].forEach(screen => {
    screen.classList.remove('active');
  });
  elements.gameScreen.classList.add('active');
  setJoinBusy(false);
  elements.roomIdDisplay.textContent = `房间：${gameState.roomId}`;
  elements.myName.textContent = gameState.playerName;
  localStorage.setItem('sanda1-player-name', gameState.playerName);
  localStorage.setItem('sanda1-last-room', gameState.roomId);

  const url = new URL(window.location);
  url.searchParams.set('room', gameState.roomId);
  window.history.pushState({}, '', url);
}

function requestLeaveRoom() {
  if (!gameState.roomId || gameState.leavingRoom) return;
  elements.leaveRoomMessage.textContent = gameState.currentState === 'waiting'
    ? '退出后将返回大厅并释放座位。若本局已开始，将由系统托管至本局结束。'
    : '本局尚未结束，退出后将由系统托管至本局结束并结算，随后释放座位。本局结束前不能重新加入此房间。';
  elements.leaveRoomModal.classList.remove('hidden');
  elements.cancelLeaveBtn.focus();
}

function cancelLeaveRoom() {
  if (gameState.leavingRoom) return;
  elements.leaveRoomModal.classList.add('hidden');
  (elements.resultModal.classList.contains('hidden') ? elements.leaveRoomBtn : elements.resultLeaveBtn).focus();
}

function setLeaveBusy(busy) {
  gameState.leavingRoom = busy;
  elements.confirmLeaveBtn.disabled = busy;
  elements.cancelLeaveBtn.disabled = busy;
  elements.confirmLeaveBtn.querySelector('span').textContent = busy ? '正在退出…' : '退出房间';
}

function leaveRoom() {
  if (!gameState.roomId || gameState.leavingRoom) return;
  const socket = gameState.socket;
  const roomId = gameState.roomId;
  if (!socket?.connected) {
    notify('连接中断，请等待重连后再退出房间');
    return;
  }
  setLeaveBusy(true);
  socket.timeout(5000).emit('leave-room', { roomId }, (error, response) => {
    if (gameState.socket !== socket || gameState.roomId !== roomId) return;
    setLeaveBusy(false);
    if (error || !response?.success) {
      notify(error ? '未收到退出确认，请重试' : response?.error || '退出失败，请重试');
      elements.confirmLeaveBtn.focus();
      return;
    }
    returnToLobby();
    notify('已退出房间');
  });
}

function returnToLobby({ clearLastRoom = true } = {}) {
  clearCountdown();
  clearTimeout(gameState.noticeTimer);
  clearTimeout(gameState.bottomAnimationTimer);
  const { socket, sessionId, playerName, roomId } = gameState;
  Object.assign(gameState, createInitialGameState(), { sessionId, playerName, currentBidder: 0, roundResolving: false });
  socket?.removeAllListeners();
  socket?.disconnect();
  if (clearLastRoom && localStorage.getItem('sanda1-last-room') === roomId) {
    localStorage.removeItem('sanda1-last-room');
  }
  const url = new URL(window.location);
  url.searchParams.delete('room');
  window.history.replaceState({}, '', url);
  setJoinBusy(false);
  setLeaveBusy(false);
  elements.gameScreen.classList.remove('active');
  elements.homeScreen.classList.add('active');
  elements.gameScreen.dataset.state = 'waiting';
  elements.roomIdInput.value = '';
  elements.chatInput.value = '';
  elements.joinRoomBtn.setAttribute('aria-expanded', 'false');
  elements.toggleHistoryBtn.setAttribute('aria-expanded', 'false');
  elements.toggleHistoryBtn.classList.remove('active');
  applyChatVisibility();
  for (const panel of [elements.joinRoomPanel, elements.resultModal, elements.leaveRoomModal,
    elements.bidPanel, elements.trumpPanel, elements.bottomCardsPanel, elements.bidHistory,
    elements.scorePanel, elements.trumpDisplay, elements.tableBottomDeck, elements.earlyFinishPanel,
    elements.playHistory]) panel.classList.add('hidden');
  for (const panel of [elements.myHand, elements.bottomCardsDisplay, elements.playedCardsArea,
    elements.bidList, elements.playHistoryList, elements.chatMessages, elements.resultContent]) panel.innerHTML = '';
  for (let seat = 0; seat < 4; seat += 1) clearSeatDisplay(seat);
  document.querySelectorAll('.player-seat').forEach(seat => seat.classList.remove('active'));
  elements.readyBtn.textContent = '准备';
  elements.readyBtn.disabled = false;
  elements.readyBtn.classList.remove('hidden');
  elements.teamScore.textContent = '0';
  elements.targetScore.textContent = '100';
  renderScoringCards([]);
  configurePlayButton('play');
  updateActionButton();
  window.accountLobby?.showLobby();
}

function updateRoomDisplay(room) {
  gameState.players = room.players;
  gameState.currentState = room.state;
  elements.gameScreen.dataset.state = room.state;
  document.getElementById('waiting-count').textContent = room.players.length === 4
    ? '好友已到齐，准备开始吧'
    : `${room.players.length} / 4 人已入座`;
  if (room.settlementSettings) {
    elements.baseScoreInput.value = room.settlementSettings.baseScore;
    elements.levelScoreInput.value = room.settlementSettings.levelScore;
    updateSettlementDisplay(room.settlementSettings);
  }
  elements.settlementDisplay.classList.remove('hidden');
  if (room.scores && typeof room.scores.team === 'number') {
    elements.teamScore.textContent = room.scores.team;
  }
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

function syncUiForRoomState(room) {
  gameState.currentBidder = room.currentBidder;
  gameState.currentPlayer = room.currentPlayer;
  gameState.trumpSuit = room.trumpSuit;
  gameState.isNoTrump = room.isNoTrump;
  elements.bidList.innerHTML = '';
  for (const bid of room.bidHistory || []) {
    const li = document.createElement('li'); li.textContent = `${bid.player}: ${bid.bid === 'pass' ? '不叫' : bid.bid}`; elements.bidList.appendChild(li);
  }

  elements.targetScore.textContent = room.dealerScore || room.currentBid || 100;
  elements.bidPanel.classList.add('hidden');
  elements.trumpPanel.classList.add('hidden');
  elements.earlyFinishPanel.classList.add('hidden');
  gameState.roundResolving = !!room.roundResolving;
  gameState.isExchanging = room.state === 'exchanging' && room.dealer === gameState.seat;
  gameState.currentRound = [];
  elements.playedCardsArea.innerHTML = '';
  clearSeatPlayPiles();
  for (const play of room.currentRound || []) showPlayedCards(play.player, play.cards, false);
  configurePlayButton(gameState.isExchanging ? 'exchange' : 'play');
  updateActionButton();

  if (room.state === 'waiting') {
    gameState.hand = [];
    gameState.selectedCards = [];
    gameState.exchangePanelShown = false;
    gameState.isExchanging = false;
    renderHand();
    const me = room.players.find(p => p.id === gameState.playerId);
    elements.readyBtn.textContent = me?.isReady ? '取消准备' : '准备';
    clearCountdown();
    elements.readyBtn.classList.remove('hidden');
    elements.playBtn.classList.add('hidden');
    elements.bidHistory.classList.add('hidden');
    elements.scorePanel.classList.add('hidden');
    elements.trumpDisplay.classList.add('hidden');
    elements.bottomCardsPanel.classList.add('hidden');
    elements.tableBottomDeck.classList.add('hidden');
    document.querySelectorAll('.player-seat').forEach(seat => seat.classList.remove('active'));
    return;
  }

  elements.readyBtn.classList.add('hidden');

  if (room.state === 'bidding') {
    elements.bidHistory.classList.remove('hidden');
    elements.scorePanel.classList.remove('hidden');
    updateBidDisplay({
      currentBid: room.currentBid || 100,
      currentBidder: room.currentBidder,
      bidHistory: room.bidHistory || [],
      state: room.state,
      dealer: room.dealer,
      hasValidBid: !!room.hasValidBid
    });
    return;
  }

  if (room.state === 'exchanging') {
    clearCountdown();
    elements.bidHistory.classList.remove('hidden');
    elements.scorePanel.classList.remove('hidden');
    elements.tableBottomDeck.classList.remove('hidden');
    return;
  }

  if (room.state === 'choosing-trump') {
    elements.bidHistory.classList.remove('hidden');
    elements.scorePanel.classList.remove('hidden');
    if (room.dealer === gameState.seat) {
      elements.trumpPanel.classList.remove('hidden');
    }
    return;
  }

  if (room.state === 'playing') {
    elements.bidHistory.classList.add('hidden');
    elements.scorePanel.classList.remove('hidden');
    elements.tableBottomDeck.classList.add('hidden');
    if (room.trumpSuit || room.isNoTrump) {
      updateTrumpDisplay(room.trumpSuit, room.isNoTrump);
    }
    configurePlayButton('play');
    updateCurrentPlayer(room.currentPlayer, { silent: true });
    startCountdown('出牌', room.deadline);
    if (room.earlyFinishOffered) {
      showEarlyFinishPanel({ targetScore: room.dealerScore, votes: room.earlyFinishVoters.length, total: room.players.length });
      updateEarlyFinishVotes({ voters: room.earlyFinishVoters, votes: room.earlyFinishVoters.length, total: room.players.length });
    }
    updateActionButton();
  }
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
    seatEl.querySelector('.player-cards').textContent = player.cardCount ?? 0;
    updatePlayerScoreBadge(seatEl, player.settlementScore || 0);

    seatEl.classList.toggle('disconnected', !!player.disconnected);
    if (player.disconnected) {
      seatEl.querySelector('.player-status').textContent = player.leftRoom ? '已退出 · 托管' : '离线 · 托管';
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
    updatePlayerScoreBadge(seatEl, 0);
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

function updatePlayerScoreBadge(seatEl, score) {
  let scoreEl = seatEl.querySelector('.player-score-badge');
  if (!scoreEl) {
    scoreEl = document.createElement('div');
    scoreEl.className = 'player-score-badge';
    const cardsEl = seatEl.querySelector('.player-cards');
    if (cardsEl) {
      seatEl.insertBefore(scoreEl, cardsEl);
    } else {
      seatEl.appendChild(scoreEl);
    }
  }

  scoreEl.textContent = formatSignedScore(score);
  scoreEl.classList.toggle('positive', score > 0);
  scoreEl.classList.toggle('negative', score < 0);
}

function formatSignedScore(score) {
  const value = Number(score) || 0;
  return value > 0 ? `+${value}` : `${value}`;
}

function toggleReady() {
  const isReady = elements.readyBtn.textContent === '准备';
  gameState.socket.emit('player-ready', isReady);
  elements.readyBtn.disabled = true;
  setTimeout(() => {
    elements.readyBtn.disabled = false;
  }, 1000);
}

function renderHand() {
  const scrollLeft = elements.myHand.scrollLeft;
  elements.myHand.innerHTML = '';
  elements.myCardCount.textContent = gameState.hand.length;

  const selectedIds = new Set(gameState.selectedCards.map(card => card.id));
  gameState.hand.forEach((card, index) => {
    const cardEl = createCardElement(card, index);
    cardEl.classList.toggle('selected', selectedIds.has(card.id));
    cardEl.setAttribute('aria-pressed', String(selectedIds.has(card.id)));
    elements.myHand.appendChild(cardEl);
  });
  elements.myHand.scrollLeft = scrollLeft;
  updateActionButton();
}

// 创建牌元素
function getSuitSymbol(suit) {
  return { hearts: '\u2665', diamonds: '\u2666', clubs: '\u2663', spades: '\u2660' }[suit] || '';
}

function getCardColorClass(card) {
  return card.suit === 'hearts' || card.suit === 'diamonds' || card.rank === 'big' ? 'red' : 'black';
}

function createCardElement(card, index) {
  const cardEl = document.createElement('button');
  cardEl.type = 'button';
  cardEl.setAttribute('aria-pressed', 'false');
  cardEl.setAttribute('aria-label', card.suit === 'joker'
    ? (card.rank === 'big' ? '大王' : '小王')
    : `${getSuitName(card.suit)} ${card.rank}`);
  cardEl.className = `card ${card.suit} ${getCardColorClass(card)}`;
  cardEl.dataset.cardId = card.id;
  cardEl.dataset.index = index;

  if (card.suit === 'joker') {
    const isBigJoker = card.rank === 'big';
    cardEl.classList.add('joker', isBigJoker ? 'big-joker' : 'small-joker');
    cardEl.innerHTML = `
      <span class="joker-crown">${isBigJoker ? '\u2605' : '\u25c6'}</span>
      <span class="joker-letter">${isBigJoker ? '\u5927\u738b' : '\u5c0f\u738b'}</span>
      <span class="joker-name">${isBigJoker ? '\u5927\u738b' : '\u5c0f\u738b'}</span>
    `;
  } else {
    const suitSymbol = getSuitSymbol(card.suit);
    cardEl.innerHTML = `
      <span class="corner top"><b>${escapeHtml(card.rank)}</b><span>${suitSymbol}</span></span>
      <span class="rank">${escapeHtml(card.rank)}</span>
      <span class="suit">${suitSymbol}</span>
      <span class="corner bottom"><b>${escapeHtml(card.rank)}</b><span>${suitSymbol}</span></span>
    `;
  }

  if (card.isTrump || isClientTrumpCard(card)) {
    cardEl.classList.add('trump');
  }

  cardEl.addEventListener('click', () => toggleCardSelection(card, cardEl));

  return cardEl;
}

function toggleCardSelection(card, cardEl) {
  const cardId = card.id || cardEl.dataset.cardId;
  const index = gameState.selectedCards.findIndex(c => c.id === cardId);

  if (index === -1) {
    gameState.selectedCards.push(card);
    cardEl.classList.add('selected');
  } else {
    gameState.selectedCards.splice(index, 1);
    cardEl.classList.remove('selected');
  }

  cardEl.setAttribute('aria-pressed', String(cardEl.classList.contains('selected')));
  updateActionButton();
}

function hintStateKey() {
  return JSON.stringify([gameState.roomId, gameState.currentState, gameState.currentPlayer,
    gameState.roundResolving, gameState.hand.map(card => card.id), gameState.currentRound,
    gameState.selectedCards.map(card => card.id)]);
}

function suggestPlay() {
  const socket = gameState.socket;
  if (!socket?.connected || gameState.hintRequest || gameState.currentState !== 'playing' ||
      gameState.currentPlayer !== gameState.seat || gameState.roundResolving) return;
  const request = { key: hintStateKey() };
  gameState.hintRequest = request;
  updateActionButton();
  socket.timeout(5000).emit('suggest-play', (error, response) => {
    if (gameState.socket !== socket || gameState.hintRequest !== request) return;
    gameState.hintRequest = null;
    updateActionButton();
    // Ignore delayed replies after a turn, hand, room or manual selection changed.
    if (request.key !== hintStateKey()) return;
    if (error || !response?.success) { notify(error ? '提示超时，请重试' : response?.error || '提示暂不可用'); return; }
    const ids = new Set(response.cardIds);
    if (!ids.size || ![...ids].every(id => gameState.hand.some(card => card.id === id))) return;
    gameState.selectedCards = gameState.hand.filter(card => ids.has(card.id));
    renderHand();
  });
}

function playCards() {
  syncSelectedCardsFromDom();
  if (gameState.selectedCards.length === 0) return;

  // 验证出牌规则
  const validation = validatePlay(gameState.selectedCards);
  if (!validation.valid) {
    notify(validation.message);
    return;
  }

  if (gameState.currentState !== 'playing' || gameState.currentPlayer !== gameState.seat) return;
  gameState.socket.emit('play-cards', gameState.selectedCards.map(card => card.id));

}

// 验证出牌规则
function isClientTrumpCard(card) {
  return card.suit === 'joker' || card.rank === '2' || card.rank === '7' || (!gameState.isNoTrump && card.suit === gameState.trumpSuit);
}

function validatePlay(cards) {
  if (gameState.currentRound.length && cards.length !== gameState.currentRound[0].cards.length) {
    return { valid: false, message: `本轮必须出 ${gameState.currentRound[0].cards.length} 张牌` };
  }
  // Authoritative rules are applied on the server; do not duplicate them here.
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
  elements.trumpDisplay.dataset.suit = isNoTrump ? 'notrump' : suit;
  if (isNoTrump) {
    elements.trumpDisplay.textContent = '无主';
  } else {
    const suitInfo = {
      spades: { symbol: '\u2660', name: '\u9ed1\u6843', color: '#111827' },
      hearts: { symbol: '\u2665', name: '\u7ea2\u6843', color: '#dc2626' },
      clubs: { symbol: '\u2663', name: '\u6885\u82b1', color: '#166534' },
      diamonds: { symbol: '\u2666', name: '\u65b9\u7247', color: '#d97706' }
    };
    const info = suitInfo[suit];
    if (!info) return;
    elements.trumpDisplay.innerHTML = `<span class="trump-symbol">${info.symbol}</span><span>\u4e3b\u724c\uff1a${info.name}</span>`;
  }
}

function showBottomCards(cards) {
  elements.bottomCardsDisplay.innerHTML = '';
  cards.forEach(card => {
    const cardEl = createCardElement(card);
    cardEl.classList.add('bottom-preview-card');
    cardEl.disabled = true;
    elements.bottomCardsDisplay.appendChild(cardEl);
  });
  elements.bottomCardsPanel.querySelector('h3').textContent = '\u5e95\u724c\uff08\u67e5\u770b\uff09';
  elements.bottomCardsPanel.classList.remove('hidden');
}

function sortClientHand(cards) {
  const rankOrder = { big: 100, small: 99, '2': 97, '7': 98, A: 14, K: 13, Q: 12, J: 11, '10': 10, '9': 9, '8': 8, '6': 6, '5': 5, '4': 4, '3': 3 };
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
  clearCountdown();

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

  configurePlayButton('exchange');
  updateActionButton();
}

function resetExchangePanel() {
  gameState.exchangePanelShown = false;
  gameState.isExchanging = false;
}

function finishExchange(newBottomCards) {
}

function handlePlayBtnClick() {
  const action = elements.playBtn.dataset.action || 'play';
  if (action === 'exchange') {
    confirmExchangeSelection();
    return;
  }
  playCards();
}

function configurePlayButton(action) {
  elements.playBtn.dataset.action = action;
  elements.playBtn.textContent = action === 'exchange' ? '\u786e\u5b9a\u5e95\u724c' : '\u51fa\u724c';
}

function confirmExchangeSelection() {
  const selectedCards = document.querySelectorAll('.card.selected');
  if (selectedCards.length !== 8) {
    notify(`\u8bf7\u9009\u62e9 8 \u5f20\u724c\u4f5c\u4e3a\u5e95\u724c\uff0c\u5f53\u524d\u9009\u62e9\u4e86 ${selectedCards.length} \u5f20\u3002`);
    return;
  }

  const selectedCardsData = [...selectedCards]
    .map(el => gameState.hand.find(card => card.id === el.dataset.cardId))
    .filter(Boolean);

  gameState.socket.emit('finish-exchange', selectedCardsData.map(card => card.id));

}

function showPlayedCards(playerIndex, cards, recordHistory = true) {
  const playerName = gameState.players[playerIndex]?.name || '玩家';

  // 显示在桌面中央
  const playContainer = document.createElement('div');
  playContainer.className = 'play-container';
  playContainer.innerHTML = `<span class="player-label">${escapeHtml(playerName)}</span>`;

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
  if (recordHistory) addPlayHistory(playerName, cards);

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
      <span class="rank">${escapeHtml(card.rank)}</span>
      <span class="suit">${suitSymbol}</span>
    `;
  }

  return cardEl;
}

function updateCurrentPlayer(playerIndex, options = {}) {
  document.querySelectorAll('.player-seat').forEach(seat => {
    seat.classList.remove('active');
  });

  const seatEl = getSeatElement(playerIndex);

  if (seatEl) {
    seatEl.classList.add('active');
  }

  updateActionButton();
  if (!options.silent && playerIndex === gameState.seat) {
    addChatMessage('\u7cfb\u7edf', '\u8f6e\u5230\u4f60\u4e86\uff01');
  }
}

function updatePlayerCardCount(playerIndex, count) {
  const seatEl = getSeatElement(playerIndex);

  if (seatEl) {
    seatEl.querySelector('.player-cards').textContent = count;
  }
}

function togglePlayHistory() {
  gameState.playHistoryVisible = !gameState.playHistoryVisible;
  elements.playHistory.classList.toggle('hidden', !gameState.playHistoryVisible);
  elements.toggleHistoryBtn.classList.toggle('active', gameState.playHistoryVisible);
  elements.toggleHistoryBtn.setAttribute('aria-expanded', String(gameState.playHistoryVisible));
}

function toggleChatBox() {
  gameState.chatVisible = !gameState.chatVisible;
  applyChatVisibility();
}

function applyChatVisibility() {
  elements.chatBox.classList.toggle('hidden', !gameState.chatVisible);
  elements.toggleChatBtn.classList.toggle('active', gameState.chatVisible);
  elements.toggleChatBtn.setAttribute('aria-expanded', String(gameState.chatVisible));
}

function clearSeatPlayPiles() {
  document.querySelectorAll('.seat-play-pile').forEach(pile => {
    pile.innerHTML = '';
  });
}

function syncSelectedCardsFromDom() {
  const selectedIds = new Set([...elements.myHand.querySelectorAll('.card.selected')].map(el => el.dataset.cardId));
  gameState.selectedCards = gameState.hand.filter(card => selectedIds.has(card.id));
}

function renderSeatPlayPile(playerIndex, cards) {
  const seatEl = getSeatElement(playerIndex);
  if (!seatEl) return;
  const pile = seatEl.querySelector('.seat-play-pile');
  const group = document.createElement('div');
  group.className = 'seat-play-group';
  cards.forEach(card => {
    const mini = createMiniCardElement(card);
    group.appendChild(mini);
  });
  pile.appendChild(group);
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
  clearTimeout(gameState.bottomAnimationTimer);
  gameState.bottomAnimationTimer = setTimeout(() => {
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
  clearCountdown();
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
    elements.copyLinkBtn.querySelector('span').textContent = '已复制';
    setTimeout(() => {
      elements.copyLinkBtn.querySelector('span').textContent = '邀请好友';
    }, 2000);
  }).catch(() => notify(`复制失败，房间号：${gameState.roomId}`));
}

function sendChatMessage() {
  const message = elements.chatInput.value.trim();
  if (!message) return;
  gameState.socket.emit('chat-message', message);
  elements.chatInput.value = '';
}

function addChatMessage(player, message) {
  const msgEl = document.createElement('div');
  msgEl.className = 'message';
  msgEl.innerHTML = `<span class="player-name">${escapeHtml(player)}:</span> ${escapeHtml(message)}`;
  elements.chatMessages.appendChild(msgEl);
  while (elements.chatMessages.children.length > 150) elements.chatMessages.firstChild.remove();
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
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
