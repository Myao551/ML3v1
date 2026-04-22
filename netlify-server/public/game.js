// 配置 - 需要替换为你的 Pusher 配置
const PUSHER_KEY = 'YOUR_PUSHER_KEY';
const PUSHER_CLUSTER = 'YOUR_PUSHER_CLUSTER';
const API_ENDPOINT = '/.netlify/functions/room';

// 游戏状态
const gameState = {
  pusher: null,
  channel: null,
  privateChannel: null,
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
  isNoTrump: false
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
  bidPanel: document.getElementById('bid-panel'),
  bidButtons: document.querySelectorAll('.bid-btn'),
  passBtn: document.getElementById('pass-btn'),
  trumpPanel: document.getElementById('trump-panel'),
  suitButtons: document.querySelectorAll('.suit-btn'),
  bidHistory: document.getElementById('bid-history'),
  bidList: document.getElementById('bid-list'),
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

function init() {
  // 生成唯一玩家ID
  gameState.playerId = 'player_' + Math.random().toString(36).substr(2, 9);

  // 检查URL参数
  const urlParams = new URLSearchParams(window.location.search);
  const roomIdFromUrl = urlParams.get('room');
  if (roomIdFromUrl) {
    elements.roomIdInput.value = roomIdFromUrl;
    elements.joinRoomPanel.classList.remove('hidden');
  }

  // 事件监听
  elements.createRoomBtn.addEventListener('click', createRoom);
  elements.joinRoomBtn.addEventListener('click', () => elements.joinRoomPanel.classList.toggle('hidden'));
  elements.confirmJoinBtn.addEventListener('click', joinRoom);
  elements.showRulesBtn.addEventListener('click', (e) => { e.preventDefault(); elements.rulesModal.classList.remove('hidden'); });
  elements.closeRulesBtn.addEventListener('click', () => elements.rulesModal.classList.add('hidden'));
  elements.readyBtn.addEventListener('click', toggleReady);
  elements.playBtn.addEventListener('click', playCards);
  elements.passBtn.addEventListener('click', () => placeBid('pass'));
  elements.copyLinkBtn.addEventListener('click', copyInviteLink);
  elements.sendBtn.addEventListener('click', sendChatMessage);
  elements.chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendChatMessage(); });
  elements.nextGameBtn.addEventListener('click', () => {
    elements.resultModal.classList.add('hidden');
    elements.readyBtn.classList.remove('hidden');
    elements.readyBtn.textContent = '准备';
  });

  elements.bidButtons.forEach(btn => {
    btn.addEventListener('click', () => placeBid(parseInt(btn.dataset.bid)));
  });

  elements.suitButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const suit = btn.dataset.suit;
      chooseTrump(suit === 'notrump' ? null : suit, suit === 'notrump');
    });
  });
}

async function createRoom() {
  const name = elements.playerNameInput.value.trim();
  if (!name) { alert('请输入昵称'); return; }

  gameState.playerName = name;
  gameState.roomId = Math.random().toString(36).substr(2, 8).toUpperCase();

  initPusher();

  try {
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create-room',
        roomId: gameState.roomId,
        playerId: gameState.playerId,
        playerName: name
      })
    });

    const data = await response.json();
    if (data.success) {
      subscribeToRoom();
      enterGame();
    }
  } catch (error) {
    alert('创建房间失败: ' + error.message);
  }
}

async function joinRoom() {
  const name = elements.playerNameInput.value.trim();
  const roomId = elements.roomIdInput.value.trim().toUpperCase();

  if (!name) { alert('请输入昵称'); return; }
  if (!roomId) { alert('请输入房间号'); return; }

  gameState.playerName = name;
  gameState.roomId = roomId;

  initPusher();

  try {
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'join-room',
        roomId: roomId,
        playerId: gameState.playerId,
        playerName: name
      })
    });

    const data = await response.json();
    if (data.success) {
      subscribeToRoom();
      enterGame();
    } else {
      alert(data.error || '加入房间失败');
    }
  } catch (error) {
    alert('加入房间失败: ' + error.message);
  }
}

function initPusher() {
  gameState.pusher = new Pusher(PUSHER_KEY, {
    cluster: PUSHER_CLUSTER,
    authEndpoint: '/.netlify/functions/pusher-auth'
  });
}

function subscribeToRoom() {
  // 订阅房间频道
  gameState.channel = gameState.pusher.subscribe(`room-${gameState.roomId}`);

  // 订阅私人频道
  gameState.privateChannel = gameState.pusher.subscribe(`private-${gameState.playerId}`);

  // 绑定事件
  gameState.channel.bind('room-update', (data) => updateRoomDisplay(data));
  gameState.channel.bind('game-started', (data) => onGameStarted(data));
  gameState.channel.bind('bid-update', (data) => onBidUpdate(data));
  gameState.channel.bind('trump-chosen', (data) => onTrumpChosen(data));
  gameState.channel.bind('game-start', (data) => onGameStart(data));
  gameState.channel.bind('cards-played', (data) => onCardsPlayed(data));
  gameState.channel.bind('round-end', (data) => onRoundEnd(data));
  gameState.channel.bind('game-end', (data) => onGameEnd(data));
  gameState.channel.bind('chat-message', (data) => addChatMessage(data.player, data.message));

  gameState.privateChannel.bind('deal-cards', (cards) => {
    gameState.hand = cards;
    renderHand();
    addChatMessage('系统', '游戏开始，你已收到手牌');
  });

  // 主牌确定后，手牌重新排序
  gameState.privateChannel.bind('hand-sorted', (cards) => {
    gameState.hand = cards;
    renderHand();
  });

  gameState.channel.bind('game-started', (data) => {
    gameState.currentBidder = data.currentBidder;
    updateCurrentBidder(data.currentBidder);
  });

  gameState.privateChannel.bind('show-bottom-cards', (cards) => {
    addChatMessage('系统', `你看到了底牌: ${cards.length}张`);
  });

  gameState.privateChannel.bind('exchange-cards', () => {
    addChatMessage('系统', '请选择8张牌作为底牌');
  });
}

function enterGame() {
  elements.homeScreen.classList.remove('active');
  elements.gameScreen.classList.add('active');
  elements.roomIdDisplay.textContent = `房间: ${gameState.roomId}`;
  elements.myName.textContent = gameState.playerName;

  const url = new URL(window.location);
  url.searchParams.set('room', gameState.roomId);
  window.history.pushState({}, '', url);
}

function updateRoomDisplay(room) {
  gameState.players = room.players;
  gameState.currentState = room.state;

  const me = room.players.find(p => p.id === gameState.playerId);
  if (me) {
    gameState.seat = me.seat;
    gameState.isDealer = me.isDealer;
  }

  room.players.forEach(player => {
    const relativeSeat = (player.seat - gameState.seat + 4) % 4;
    updateSeatDisplay(relativeSeat, player);
  });

  for (let i = 0; i < 4; i++) {
    if (!room.players.find(p => (p.seat - gameState.seat + 4) % 4 === i)) {
      clearSeatDisplay(i);
    }
  }

  elements.gameStatus.textContent = room.state === 'waiting'
    ? `等待玩家 (${room.players.length}/4)`
    : getStateText(room.state);
}

function getStateText(state) {
  const states = {
    'bidding': '叫分阶段',
    'choosing-trump': '选择主牌',
    'exchanging': '换牌中',
    'playing': '游戏中'
  };
  return states[state] || state;
}

function updateSeatDisplay(relativeSeat, player) {
  const seatSelectors = ['.player-seat.bottom', '.player-seat.top', '.player-seat.left', '.player-seat.right'];
  const seatEl = document.querySelector(seatSelectors[relativeSeat]);
  if (!seatEl) return;

  seatEl.querySelector('.player-name').textContent = player.name;
  seatEl.querySelector('.player-avatar').textContent = player.name[0].toUpperCase();
  seatEl.querySelector('.player-cards').textContent = player.cardCount || 21;
  seatEl.querySelector('.player-status').textContent = player.isReady ? '✓ 已准备' : player.isDealer ? '庄家' : '';
}

function clearSeatDisplay(relativeSeat) {
  const seatSelectors = ['.player-seat.bottom', '.player-seat.top', '.player-seat.left', '.player-seat.right'];
  const seatEl = document.querySelector(seatSelectors[relativeSeat]);
  if (!seatEl) return;

  seatEl.querySelector('.player-name').textContent = '等待中...';
  seatEl.querySelector('.player-avatar').textContent = '?';
  seatEl.querySelector('.player-cards').textContent = '0';
  seatEl.querySelector('.player-status').textContent = '';
}

async function toggleReady() {
  const isReady = elements.readyBtn.textContent === '准备';

  try {
    await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'player-ready',
        roomId: gameState.roomId,
        playerId: gameState.playerId,
        data: { isReady }
      })
    });

    elements.readyBtn.textContent = isReady ? '取消准备' : '准备';

    // 如果4人都准备好了，开始游戏
    if (isReady && gameState.players.length === 4 && gameState.players.every(p => p.isReady || p.id === gameState.playerId)) {
      await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start-game',
          roomId: gameState.roomId
        })
      });
    }
  } catch (error) {
    console.error('Ready error:', error);
  }
}

function onGameStarted(data) {
  elements.gameStatus.textContent = '叫分阶段';
  elements.bidHistory.classList.remove('hidden');
  elements.scorePanel.classList.remove('hidden');
  elements.targetScore.textContent = data.currentBid;
  gameState.currentBidder = data.currentBidder;
  updateBidButtons(data.currentBid);
  updateCurrentBidder(data.currentBidder);
}

function renderHand() {
  elements.myHand.innerHTML = '';
  elements.myCardCount.textContent = gameState.hand.length;

  gameState.hand.forEach((card, index) => {
    const cardEl = createCardElement(card, index);
    elements.myHand.appendChild(cardEl);
  });
}

function createCardElement(card, index) {
  const cardEl = document.createElement('div');
  cardEl.className = `card ${card.suit}`;
  cardEl.dataset.cardId = card.id;

  if (card.suit === 'joker') {
    cardEl.classList.add('joker');
    cardEl.innerHTML = `<span class="rank">${card.name}</span>`;
  } else {
    const suitSymbols = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
    cardEl.innerHTML = `
      <span class="rank">${card.rank}</span>
      <span class="suit">${suitSymbols[card.suit]}</span>
    `;
  }

  if (card.isTrump) cardEl.classList.add('trump');
  cardEl.addEventListener('click', () => toggleCardSelection(card, cardEl));
  return cardEl;
}

function toggleCardSelection(card, cardEl) {
  const idx = gameState.selectedCards.findIndex(c => c.id === card.id);
  if (idx === -1) {
    gameState.selectedCards.push(card);
    cardEl.classList.add('selected');
  } else {
    gameState.selectedCards.splice(idx, 1);
    cardEl.classList.remove('selected');
  }
  elements.playBtn.classList.toggle('hidden', gameState.selectedCards.length === 0);
}

async function playCards() {
  if (gameState.selectedCards.length === 0) return;

  try {
    await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'play-cards',
        roomId: gameState.roomId,
        playerId: gameState.playerId,
        data: { cards: gameState.selectedCards }
      })
    });

    gameState.selectedCards = [];
    elements.playBtn.classList.add('hidden');
    document.querySelectorAll('.card.selected').forEach(el => el.classList.remove('selected'));
  } catch (error) {
    alert('出牌失败: ' + error.message);
  }
}

async function placeBid(bid) {
  try {
    await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'place-bid',
        roomId: gameState.roomId,
        playerId: gameState.playerId,
        data: { bid }
      })
    });
    elements.bidPanel.classList.add('hidden');
  } catch (error) {
    console.error('Bid error:', error);
  }
}

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
  const relativeSeat = (bidderIndex - gameState.seat + 4) % 4;
  const seatSelectors = ['.player-seat.bottom', '.player-seat.top', '.player-seat.left', '.player-seat.right'];
  const seatEl = document.querySelector(seatSelectors[relativeSeat]);
  if (seatEl) seatEl.classList.add('active');
}

function onBidUpdate(data) {
  elements.targetScore.textContent = data.currentBid;
  updateBidButtons(data.currentBid);
  gameState.currentBidder = data.currentBidder;

  elements.bidList.innerHTML = '';
  data.bidHistory.forEach(bid => {
    const li = document.createElement('li');
    li.textContent = `${bid.player}: ${bid.bid === 'pass' ? '不叫' : bid.bid}`;
    elements.bidList.appendChild(li);
  });

  updateCurrentBidder(data.currentBidder);

  if (data.state === 'choosing-trump' && data.dealer === gameState.seat) {
    elements.bidPanel.classList.add('hidden');
    elements.trumpPanel.classList.remove('hidden');
  }
}

function updateBidButtons(currentBid) {
  elements.bidButtons.forEach(btn => {
    btn.disabled = parseInt(btn.dataset.bid) >= currentBid;
  });
}

async function chooseTrump(suit, isNoTrump) {
  try {
    await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'choose-trump',
        roomId: gameState.roomId,
        playerId: gameState.playerId,
        data: { suit, isNoTrump }
      })
    });
    elements.trumpPanel.classList.add('hidden');
  } catch (error) {
    console.error('Choose trump error:', error);
  }
}

function onTrumpChosen(data) {
  gameState.trumpSuit = data.trumpSuit;
  gameState.isNoTrump = data.isNoTrump;
  elements.trumpDisplay.textContent = data.isNoTrump ? '无主' : getSuitName(data.trumpSuit);
  addChatMessage('系统', `${gameState.players[data.dealer].name} 选择了 ${data.isNoTrump ? '无主' : getSuitName(data.trumpSuit)}`);
}

function getSuitName(suit) {
  const names = { spades: '♠ 黑桃', hearts: '♥ 红桃', clubs: '♣ 梅花', diamonds: '♦ 方片' };
  return names[suit] || suit;
}

function onGameStart(data) {
  elements.gameStatus.textContent = '游戏中';
  gameState.currentPlayer = data.currentPlayer;
  updateCurrentPlayer(data.currentPlayer);
}

function onCardsPlayed(data) {
  addChatMessage('系统', `${gameState.players[data.player]?.name || '玩家'} 出了 ${data.cards.length} 张牌`);
  gameState.currentPlayer = data.nextPlayer;
  updateCurrentPlayer(data.nextPlayer);
}

function updateCurrentPlayer(playerIndex) {
  document.querySelectorAll('.player-seat').forEach(s => s.classList.remove('active'));
  const relativeSeat = (playerIndex - gameState.seat + 4) % 4;
  const seatSelectors = ['.player-seat.bottom', '.player-seat.top', '.player-seat.left', '.player-seat.right'];
  const seatEl = document.querySelector(seatSelectors[relativeSeat]);
  if (seatEl) seatEl.classList.add('active');
}

function onRoundEnd(data) {
  elements.teamScore.textContent = data.totalScore;
  addChatMessage('系统', `${gameState.players[data.winner]?.name || '玩家'} 赢得本轮，得分: ${data.score}`);
}

function onGameEnd(data) {
  elements.resultModal.classList.remove('hidden');

  let title, content;
  const iAmDealer = gameState.isDealer;

  if (data.result === 'qingguang') {
    title = '清光！';
    content = iAmDealer ? '闲家被清光，你赢了！' : '闲家被清光！';
  } else if (data.result === 'dealer-lost') {
    title = '庄家下庄！';
    content = !iAmDealer ? '闲家获胜！' : '庄家下庄！';
  } else {
    title = '庄家获胜！';
    content = iAmDealer ? '你赢了！' : '庄家获胜！';
  }

  elements.resultTitle.textContent = title;
  elements.resultContent.innerHTML = `
    <p>闲家得分: ${data.teamScore}</p>
    <p>庄分: ${data.targetScore}</p>
    <p>${content}</p>
  `;
}

function copyInviteLink() {
  const url = new URL(window.location);
  url.searchParams.set('room', gameState.roomId);
  navigator.clipboard.writeText(url.toString()).then(() => {
    elements.copyLinkBtn.textContent = '已复制!';
    setTimeout(() => elements.copyLinkBtn.textContent = '复制邀请链接', 2000);
  });
}

async function sendChatMessage() {
  const message = elements.chatInput.value.trim();
  if (!message) return;

  try {
    await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'chat-message',
        roomId: gameState.roomId,
        playerId: gameState.playerId,
        playerName: gameState.playerName,
        data: { message }
      })
    });
    elements.chatInput.value = '';
  } catch (error) {
    console.error('Chat error:', error);
  }
}

function addChatMessage(player, message) {
  const msgEl = document.createElement('div');
  msgEl.className = 'message';
  msgEl.innerHTML = `<span style="color: var(--secondary-color); font-weight: bold;">${player}:</span> ${escapeHtml(message)}`;
  elements.chatMessages.appendChild(msgEl);
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 启动
document.addEventListener('DOMContentLoaded', init);
