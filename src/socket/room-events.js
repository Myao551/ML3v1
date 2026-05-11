// @ts-check

const { v4: uuidv4 } = require('uuid');
const {
  getAuthUserFromSocket,
  getPlayerSessionId
} = require('../http/auth-routes');
const {
  createRoom,
  normalizeSettlementSettings
} = require('../game/rooms');

/** @typedef {import('socket.io').Server} SocketServer */
/** @typedef {import('socket.io').Socket} Socket */
/** @typedef {Socket & { authUser?: import('../types').AuthUser | null; roomId?: string; playerId?: string; sessionId?: string }} GameSocket */

/**
 * @typedef {{
 *   io: SocketServer;
 *   socket: GameSocket;
 *   rooms: Map<string, any>;
 *   userStore: {
 *     register(username: unknown, password: unknown): import('../types').AuthResult;
 *     authenticate(username: unknown, password: unknown): import('../types').AuthResult;
 *     createSession(userId: string): import('../types').AuthSession | null;
 *     getSessionUser(token: string | null | undefined): import('../types').AuthUser | null;
 *     deleteSession(token: string): void;
 *   };
 *   getRoomState(room: any): any;
 *   startGame(room: any): void;
 * }} RoomLifecycleDeps
 */

/**
 * @param {GameSocket} socket
 * @param {any} room
 * @param {any} player
 */
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

/**
 * @param {GameSocket} socket
 * @param {any} room
 * @param {any} player
 * @param {(room: any) => any} getRoomState
 */
function sendPrivateState(socket, room, player, getRoomState) {
  const playerIndex = room.players.findIndex((/** @type {any} */ candidate) => candidate.sessionId === player.sessionId);
  socket.emit('room-update', getRoomState(room));

  if (player.hand.length > 0) {
    socket.emit('hand-sorted', player.hand);
  }

  if (room.state === 'bidding') {
    socket.emit('bid-update', {
      currentBid: room.currentBid,
      currentBidder: room.currentBidder,
      bidHistory: room.bidHistory,
      state: room.state,
      dealer: room.dealer,
      hasValidBid: room.hasValidBid
    });
    return;
  }

  if (room.state === 'exchanging') {
    if (playerIndex === room.dealer) {
      socket.emit('exchange-cards', {
        bottomCards: room.bottomCards,
        hand: player.hand
      });
    }
    return;
  }

  if (room.state === 'choosing-trump') {
    if (playerIndex === room.dealer) {
      socket.emit('choose-trump-request');
    }
    socket.emit('waiting-trump', { dealer: room.dealer });
    return;
  }

  if (room.state === 'playing') {
    socket.emit('game-start', {
      currentPlayer: room.currentPlayer,
      trumpSuit: room.trumpSuit,
      isNoTrump: room.isNoTrump
    });
  }
}

/**
 * @param {RoomLifecycleDeps} deps
 */
function registerRoomLifecycleEvents({ io, socket, rooms, userStore, getRoomState, startGame }) {
  socket.on('create-room', (playerPayload, callback = () => {}) => {
    const authUser = socket.authUser || getAuthUserFromSocket(userStore, socket);
    if (!authUser) {
      callback({ success: false, error: '请先登录后再创建房间' });
      return;
    }

    const playerName = authUser.username || '';
    const sessionId = getPlayerSessionId(authUser);
    if (!playerName) {
      callback({ success: false, error: '请先登录后再创建房间' });
      return;
    }

    const roomId = uuidv4().slice(0, 8);
    const room = /** @type {any} */ (createRoom(roomId));
    room.settlementSettings = normalizeSettlementSettings(
      /** @type {{ settlementSettings?: unknown } | null | undefined} */ (playerPayload)?.settlementSettings
    );

    const player = {
      id: socket.id,
      sessionId,
      userId: authUser.id,
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

  socket.on('join-room', (roomId, playerPayload, callback = () => {}) => {
    const authUser = socket.authUser || getAuthUserFromSocket(userStore, socket);
    if (!authUser) {
      callback({ success: false, error: '请先登录后再加入房间' });
      return;
    }

    const playerName = authUser.username || '';
    const sessionId = getPlayerSessionId(authUser);
    const room = rooms.get(String(roomId || ''));

    if (!room) {
      callback({ success: false, error: 'Room not found' });
      return;
    }

    if (!playerName) {
      callback({ success: false, error: '请先登录后再加入房间' });
      return;
    }

    const existingPlayer = room.players.find((/** @type {any} */ player) => player.sessionId === sessionId);
    if (existingPlayer) {
      existingPlayer.name = playerName;
      attachSocketToPlayer(socket, room, existingPlayer);
      callback({ success: true, roomId, playerId: socket.id, sessionId: existingPlayer.sessionId, rejoined: true });
      io.to(room.id).emit('room-update', getRoomState(room));
      sendPrivateState(socket, room, existingPlayer, getRoomState);
      return;
    }

    const duplicateName = room.players.some((/** @type {any} */ player) => player.name.trim().toLowerCase() === playerName.toLowerCase());
    if (duplicateName) {
      callback({ success: false, error: '用户名已在房间中' });
      return;
    }

    if (room.players.length >= 4) {
      callback({ success: false, error: '房间已满' });
      return;
    }

    if (room.state !== 'waiting') {
      callback({ success: false, error: '游戏已经开始，无法加入' });
      return;
    }

    const player = {
      id: socket.id,
      sessionId,
      userId: authUser.id,
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
    io.to(room.id).emit('room-update', getRoomState(room));
  });

  socket.on('rejoin-room', (data, callback = () => {}) => {
    const authUser = socket.authUser || getAuthUserFromSocket(userStore, socket);
    const roomId = data?.roomId;
    const sessionId = authUser ? getPlayerSessionId(authUser) : null;
    const room = rooms.get(roomId);

    if (!room || !sessionId) {
      callback({ success: false });
      return;
    }

    const player = room.players.find((/** @type {any} */ candidate) => candidate.sessionId === sessionId);
    if (!player) {
      callback({ success: false });
      return;
    }

    attachSocketToPlayer(socket, room, player);
    callback({ success: true, roomId, playerId: socket.id, sessionId });
    io.to(room.id).emit('room-update', getRoomState(room));
    sendPrivateState(socket, room, player, getRoomState);
  });

  socket.on('player-ready', (isReady) => {
    if (!socket.roomId) return;

    const room = rooms.get(socket.roomId);
    if (!room) return;

    const player = room.players.find((/** @type {any} */ candidate) => candidate.id === socket.id);
    if (!player) return;

    player.isReady = isReady;
    io.to(room.id).emit('room-update', getRoomState(room));

    if (room.players.length === 4 && room.players.every((/** @type {any} */ candidate) => candidate.isReady)) {
      startGame(room);
    }
  });

  socket.on('chat-message', (message) => {
    if (!socket.roomId) return;

    const room = rooms.get(socket.roomId);
    if (!room) return;

    const player = room.players.find((/** @type {any} */ candidate) => candidate.id === socket.id);
    const cleanMessage = String(message || '').trim().slice(0, 300);
    if (player && cleanMessage) {
      io.to(room.id).emit('chat-message', {
        player: player.name,
        message: cleanMessage
      });
    }
  });

  socket.on('disconnect', () => {
    if (!socket.roomId) return;

    const room = rooms.get(socket.roomId);
    if (!room) return;

    const playerIndex = room.players.findIndex((/** @type {any} */ candidate) => candidate.id === socket.id);
    if (playerIndex === -1) return;

    const player = room.players[playerIndex];
    player.disconnected = true;
    io.to(room.id).emit('room-update', getRoomState(room));

    player.disconnectTimer = setTimeout(() => {
      const currentRoom = rooms.get(room.id);
      if (!currentRoom) return;

      const currentIndex = currentRoom.players.findIndex(
        (/** @type {any} */ candidate) => candidate.sessionId === player.sessionId && candidate.disconnected
      );
      if (currentIndex === -1) return;

      if (currentRoom.state !== 'waiting') {
        io.to(currentRoom.id).emit('room-update', getRoomState(currentRoom));
        return;
      }

      currentRoom.players.splice(currentIndex, 1);
      currentRoom.players.forEach((/** @type {any} */ candidate, /** @type {number} */ seat) => { candidate.seat = seat; });

      if (currentRoom.players.length === 0) {
        rooms.delete(room.id);
        return;
      }

      io.to(currentRoom.id).emit('player-left', { playerId: socket.id });
      io.to(currentRoom.id).emit('room-update', getRoomState(currentRoom));
    }, 60000);
  });
}

module.exports = {
  attachSocketToPlayer,
  registerRoomLifecycleEvents,
  sendPrivateState
};
