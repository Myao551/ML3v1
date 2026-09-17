// @ts-check

const { resolveCards } = require('../game/play-rules');
const { sortCardsForDisplay } = require('../game/cards');

/** @typedef {import('socket.io').Server} SocketServer */
/** @typedef {import('socket.io').Socket} Socket */
/** @typedef {Socket & { roomId?: string }} GameSocket */

/**
 * @typedef {{
 *   io: SocketServer;
 *   socket: GameSocket;
 *   rooms: Map<string, any>;
 *   getRoomState(room: any): any;
 *   emitBidUpdate(room: any): void;
 *   getActiveBidders(room: any): number[];
 *   getNextBidder(room: any): number;
 *   handleAllPass(room: any): void;
 *   setDealer(room: any, dealerIndex: number, dealerScore: number): void;
 *   endGame(room: any, reason?: string): void;
 *   isValidBid(room: any, bid: unknown): boolean;
 *   validatePlay(room: any, cards: any[], playerIndex: number): { valid: boolean; message: string };
 *   finishRound(room: any): void;
 *   scheduleTurn(room: any): void;
 * }} GameplayDeps
 */

/**
 * @param {GameSocket} socket
 * @param {Map<string, any>} rooms
 * @returns {any | null}
 */
function getSocketRoom(socket, rooms) {
  if (!socket.roomId) return null;
  return rooms.get(socket.roomId) || null;
}

/**
 * @param {GameplayDeps} deps
 */
function registerGameplayEvents({
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
  finishRound,
  scheduleTurn
}) {
  socket.on('place-bid', (bid) => {
    const room = getSocketRoom(socket, rooms);
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

      const activeBidders = getActiveBidders(room);
      if (activeBidders.length === 0) {
        handleAllPass(room);
        return;
      }

      if (activeBidders.length === 1 && room.hasValidBid) {
        setDealer(room, activeBidders[0], room.currentBid);
        return;
      }
    } else {
      if (!isValidBid(room, bid)) {
        socket.emit('invalid-bid', '叫分无效');
        return;
      }

      room.currentBid = bid;
      room.hasValidBid = true;
      room.bidHistory.push({ player: currentPlayer.name, bid });
      room.currentBidder = getNextBidder(room);

      if (bid === 75 || getActiveBidders(room).length === 1) {
        setDealer(
          room,
          room.players.findIndex((/** @type {any} */ player) => player.id === currentPlayer.id),
          Number(bid)
        );
        return;
      }
    }

    emitBidUpdate(room);
    scheduleTurn(room);
  });

  socket.on('vote-end-game', () => {
    const room = getSocketRoom(socket, rooms);
    if (!room || room.state !== 'playing' || room.scores.team < room.dealerScore) return;

    const voterIndex = room.players.findIndex((/** @type {any} */ player) => player.id === socket.id);
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

  socket.on('choose-trump', (suit, isNoTrump) => {
    const room = getSocketRoom(socket, rooms);
    if (!room || room.state !== 'choosing-trump') return;

    const dealer = room.players[room.dealer];
    if (dealer.id !== socket.id) return;

    if (typeof isNoTrump !== 'boolean' || (isNoTrump ? suit !== null : !['spades', 'hearts', 'clubs', 'diamonds'].includes(suit))) {
      socket.emit('invalid-play', '请选择有效主花色或无主');
      return;
    }
    room.trumpSuit = suit;
    room.isNoTrump = isNoTrump;
    room.state = 'playing';
    room.currentPlayer = room.dealer;

    for (const player of room.players) {
      player.hand.sort((/** @type {any} */ a, /** @type {any} */ b) => sortCardsForDisplay(a, b, suit, isNoTrump));
      io.to(player.id).emit('hand-sorted', player.hand);
    }

    io.to(room.id).emit('trump-chosen', {
      trumpSuit: suit,
      isNoTrump,
      dealer: room.dealer
    });

    io.to(room.id).emit('game-start', {
      currentPlayer: room.currentPlayer,
      trumpSuit: room.trumpSuit,
      isNoTrump: room.isNoTrump
    });
    io.to(room.id).emit('room-update', getRoomState(room));
    scheduleTurn(room);
  });

  socket.on('finish-exchange', (newBottomCards) => {
    const room = getSocketRoom(socket, rooms);
    if (!room || room.state !== 'exchanging') return;

    const dealer = room.players[room.dealer];
    if (dealer.id !== socket.id) return;

    if (!Array.isArray(newBottomCards) || newBottomCards.length !== 8) {
      socket.emit('invalid-play', '请选择 8 张底牌');
      return;
    }

    const canonical = resolveCards(dealer.hand, newBottomCards);
    if (!canonical) {
      socket.emit('invalid-play', '底牌选择无效');
      return;
    }
    const selectedIds = new Set(canonical.map(card => card.id));
    room.bottomCards = canonical;
    dealer.hand = dealer.hand.filter((/** @type {any} */ card) => !selectedIds.has(card.id));
    dealer.hand.sort((/** @type {any} */ a, /** @type {any} */ b) => sortCardsForDisplay(a, b, room.trumpSuit, room.isNoTrump));
    io.to(dealer.id).emit('hand-sorted', dealer.hand);

    room.state = 'choosing-trump';
    io.to(room.id).emit('room-update', getRoomState(room));
    io.to(dealer.id).emit('choose-trump-request');
    io.to(room.id).emit('waiting-trump', { dealer: room.dealer });
    scheduleTurn(room);
  });

  socket.on('play-cards', (cards) => {
    const room = getSocketRoom(socket, rooms);
    if (!room || room.state !== 'playing') return;

    if (room.roundResolving) {
      socket.emit('invalid-play', '本轮正在结算，请稍候');
      return;
    }

    if (room.players[room.currentPlayer].id !== socket.id) return;

    cards = resolveCards(room.players[room.currentPlayer].hand, cards);
    const validation = validatePlay(room, cards, room.currentPlayer);
    if (!validation.valid) {
      socket.emit('invalid-play', validation.message);
      return;
    }

    const player = room.players[room.currentPlayer];
    for (const card of cards) {
      const idx = player.hand.findIndex((/** @type {any} */ candidate) => candidate.id === card.id);
      if (idx !== -1) player.hand.splice(idx, 1);
    }

    room.currentRound.push({
      player: room.currentPlayer,
      cards,
      isDealer: player.isDealer
    });

    const isRoundComplete = room.currentRound.length === 4;
    io.to(room.id).emit('cards-played', {
      player: room.currentPlayer,
      cards,
      nextPlayer: isRoundComplete ? null : (room.currentPlayer + 1) % 4,
      cardCount: player.hand.length
    });

    if (!isRoundComplete) {
      room.currentPlayer = (room.currentPlayer + 1) % 4;
      scheduleTurn(room);
      return;
    }

    room.roundResolving = true;
    scheduleTurn(room);
    const gameNumber = room.gameNumber;
    room.roundTimer = setTimeout(() => {
      room.roundTimer = null;
      if (room.state === 'playing' && room.gameNumber === gameNumber && room.roundResolving && room.currentRound.length === 4) finishRound(room);
    }, 1000);
  });
}

module.exports = {
  getSocketRoom,
  registerGameplayEvents
};
