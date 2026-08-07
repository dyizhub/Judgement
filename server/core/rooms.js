// Room registry — game-agnostic. A room owns its players and delegates all
// rules to whichever engine its gameId names.

const crypto = require('crypto');

const rooms = new Map(); // code -> room

// Ambiguous glyphs (0/O, 1/I) left out so codes survive being read aloud.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;

function newRoomCode() {
  let code;
  do {
    code = Array.from({ length: CODE_LENGTH }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function createRoom(gameId) {
  const room = {
    code: newRoomCode(),
    gameId,
    players: [], // { id, name, ws, connected, isBot, difficulty, isDev }
    hostId: null,
    status: 'lobby', // lobby | playing
    game: null, // engine state once started
    botTimer: null,
    turnTimer: null,
    turnDeadline: null, // when the server will act for the current player
    lastActivity: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

function getRoom(code) {
  return rooms.get(String(code || '').toUpperCase()) || null;
}

function destroyRoom(room) {
  if (room.botTimer) { clearTimeout(room.botTimer); room.botTimer = null; }
  if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null; }
  rooms.delete(room.code);
}

// Drop rooms nobody came back to, so a long-lived process doesn't leak them.
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;

function startRoomGC(intervalMs = 5 * 60 * 1000) {
  const t = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (now - room.lastActivity > ROOM_TTL_MS) destroyRoom(room);
    }
  }, intervalMs);
  t.unref();
  return t;
}

module.exports = { rooms, createRoom, getRoom, destroyRoom, startRoomGC, ROOM_TTL_MS };
