// Veyla Cards — realtime game server.
//
// This file owns transport and room lifecycle only: sockets, reconnects, turn
// timeouts, bot pacing. Every rule lives in an engine under ./engines, so
// adding a game requires no changes here.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const { getEngine, listGames, DEFAULT_GAME_ID } = require('./engines');
const { createRoom, getRoom, destroyRoom, startRoomGC, rooms } = require('./core/rooms');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.json': 'application/json',
};

// ---------- HTTP ----------

const server = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];

  if (urlPath === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', rooms: rooms.size, uptime: process.uptime() }));
    return;
  }

  // Lets a client render the game picker without hardcoding the catalogue.
  if (urlPath === '/games') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ games: listGames() }));
    return;
  }

  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------- dev mode ----------
// Trump-biased deals and peeking at opponents' hands: a local-play toy, off
// unless explicitly enabled so no deployed server ever exposes it.
const DEV_MODE_ENABLED = process.env.ENABLE_DEV_MODE === '1';
const DEV_NAMES = new Set(['adi', 'advay']);

// U+200B-U+200F, U+202A-U+202E, U+FEFF. Separate non-global regex for .test()
// because a shared /g regex's lastIndex would desync across calls.
const INVISIBLE_PROBE = /[​-‏‪-‮﻿]/;
const INVISIBLE_STRIP = /[​-‏‪-‮﻿]/g;

function normalizeName(name) {
  return String(name || '').replace(INVISIBLE_STRIP, '').trim();
}

// ---------- messaging ----------

function send(ws, type, payload = {}) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type, ...payload }));
}

function ctxOf(room) {
  return { players: room.players };
}

function stateFor(room, player) {
  const engine = getEngine(room.gameId);
  const idx = room.players.indexOf(player);

  const core = {
    code: room.code,
    gameId: room.gameId,
    gameName: engine ? engine.meta.name : room.gameId,
    status: room.status,
    youIdx: idx,
    youId: player.id,
    hostId: room.hostId,
    players: room.players.map(p => ({
      name: p.name, id: p.id, connected: p.connected,
      isBot: p.isBot || false, difficulty: p.difficulty,
    })),
    minPlayers: engine ? engine.meta.minPlayers : 2,
    maxPlayers: engine ? engine.meta.maxPlayers : 8,
  };

  // In the lobby there is no engine state yet. Engines supply an idle view with
  // the same keys as the in-game one so clients never see a field vanish.
  const view = room.status === 'playing' && room.game
    ? engine.viewFor(room.game, ctxOf(room), idx)
    : (engine && engine.lobbyView ? engine.lobbyView() : { phase: 'lobby' });

  return { ...core, ...view };
}

function broadcastState(room) {
  room.lastActivity = Date.now();
  for (const p of room.players) if (!p.isBot) send(p.ws, 'state', { state: stateFor(room, p) });
  scheduleBot(room);
  scheduleTurnTimeout(room);
}

// ---------- timers ----------
// A game must never freeze because someone closed their phone. Present players
// get a courteous window; vanished ones get a short grace to reconnect.

const TURN_TIMEOUT_CONNECTED_MS = Number(process.env.TURN_TIMEOUT_CONNECTED_MS) || 90 * 1000;
const TURN_TIMEOUT_DISCONNECTED_MS = Number(process.env.TURN_TIMEOUT_DISCONNECTED_MS) || 12 * 1000;
const HOST_TIMEOUT_CONNECTED_MS = Number(process.env.ROUNDEND_TIMEOUT_CONNECTED_MS) || 120 * 1000;
const HOST_TIMEOUT_DISCONNECTED_MS = Number(process.env.ROUNDEND_TIMEOUT_DISCONNECTED_MS) || 15 * 1000;

function scheduleTurnTimeout(room) {
  if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null; }
  if (process.env.NO_TURN_TIMEOUT) return;
  if (room.status !== 'playing' || !room.game) return;
  const engine = getEngine(room.gameId);

  // Waiting on the host to advance (e.g. the scoreboard between rounds).
  const hostAction = engine.pendingHostAction(room.game);
  if (hostAction) {
    const host = room.players.find(p => p.id === room.hostId);
    const delay = host && host.connected ? HOST_TIMEOUT_CONNECTED_MS : HOST_TIMEOUT_DISCONNECTED_MS;
    room.turnTimer = setTimeout(() => {
      room.turnTimer = null;
      if (!room.game || !engine.pendingHostAction(room.game)) return;
      const hostIdx = room.players.findIndex(p => p.id === room.hostId);
      applyAndBroadcast(room, hostIdx < 0 ? 0 : hostIdx, hostAction);
    }, delay);
    return;
  }

  const idx = engine.currentActor(room.game);
  if (idx === null || idx === undefined) return;
  const p = room.players[idx];
  if (!p || p.isBot) return; // bots are driven by scheduleBot

  const delay = p.connected ? TURN_TIMEOUT_CONNECTED_MS : TURN_TIMEOUT_DISCONNECTED_MS;
  room.turnTimer = setTimeout(() => {
    room.turnTimer = null;
    if (!room.game || engine.currentActor(room.game) !== idx) return;
    const action = engine.autoAction(room.game, idx);
    if (action) applyAndBroadcast(room, idx, action);
  }, delay);
}

function scheduleBot(room) {
  if (room.botTimer) { clearTimeout(room.botTimer); room.botTimer = null; }
  if (room.status !== 'playing' || !room.game) return;
  const engine = getEngine(room.gameId);

  const idx = engine.currentActor(room.game);
  if (idx === null || idx === undefined) return;
  const bot = room.players[idx];
  if (!bot || !bot.isBot) return;

  // Pause longer just after a trick resolves so clients can show the winner.
  const settling = engine.justResolvedTrick ? engine.justResolvedTrick(room.game) : false;
  const delay = process.env.BOT_FAST ? 5 : (settling ? 1700 : 800) + crypto.randomInt(500);

  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    if (!room.game || engine.currentActor(room.game) !== idx) return;
    let action = null;
    try {
      action = engine.botAction(room.game, ctxOf(room), idx, bot.difficulty);
    } catch (e) {
      console.error('Bot error:', e);
    }
    // Never let a bot bug stall the table.
    if (!action) action = engine.autoAction(room.game, idx);
    if (action) applyAndBroadcast(room, idx, action);
  }, delay);
}

function applyAndBroadcast(room, idx, action, ws) {
  const engine = getEngine(room.gameId);
  let err = null;
  try {
    err = engine.applyAction(room.game, ctxOf(room), idx, action);
  } catch (e) {
    console.error('Engine error:', e);
    return;
  }
  if (err && ws) send(ws, 'error', { message: err });
  broadcastState(room);
}

// ---------- players ----------

function makePlayer(name, ws) {
  const raw = String(name || '');
  const clean = normalizeName(raw);
  return {
    id: crypto.randomUUID(),
    name: clean.slice(0, 16) || 'Player',
    ws,
    connected: true,
    // Dev mode is a secret handshake: the invisible marker must actually be
    // present, so typing the name plainly grants nothing.
    isDev: DEV_MODE_ENABLED && INVISIBLE_PROBE.test(raw) && DEV_NAMES.has(clean.toLowerCase()),
  };
}

function joinRoom(room, ws, name) {
  const player = makePlayer(name, ws);
  room.players.push(player);
  ws._room = room;
  ws._player = player;
  return player;
}

// ---------- message routing ----------

function handleMessage(ws, msg) {
  const { type } = msg;

  if (type === 'create') {
    const gameId = getEngine(msg.gameId) ? msg.gameId : DEFAULT_GAME_ID;
    const room = createRoom(gameId);
    joinRoom(room, ws, msg.name);
    room.hostId = room.players[0].id;
    broadcastState(room);
    return;
  }

  if (type === 'join') {
    const room = getRoom(msg.code);
    if (!room) return send(ws, 'error', { message: 'Room not found.' });

    const existing = room.players.find(p => p.id === msg.playerId);
    if (existing) { // rejoin keeps the seat, even mid-game
      existing.ws = ws;
      existing.connected = true;
      ws._room = room; ws._player = existing;
      broadcastState(room);
      return;
    }
    const engine = getEngine(room.gameId);
    if (room.status !== 'lobby') return send(ws, 'error', { message: 'Game already in progress.' });
    if (room.players.length >= engine.meta.maxPlayers)
      return send(ws, 'error', { message: `Room is full (${engine.meta.maxPlayers} max).` });
    joinRoom(room, ws, msg.name);
    broadcastState(room);
    return;
  }

  const room = ws._room, player = ws._player;
  if (!room || !player) return;
  const engine = getEngine(room.gameId);
  const idx = room.players.indexOf(player);
  const isHost = player.id === room.hostId;

  if (type === 'setGame') {
    if (!isHost || room.status !== 'lobby') return;
    if (getEngine(msg.gameId)) room.gameId = msg.gameId;
    broadcastState(room);
    return;
  }

  if (type === 'start') {
    if (!isHost || room.status !== 'lobby') return;
    if (room.players.length < engine.meta.minPlayers)
      return send(ws, 'error', { message: `Need at least ${engine.meta.minPlayers} players.` });
    room.game = engine.createState(ctxOf(room));
    room.status = 'playing';
    broadcastState(room);
    return;
  }

  if (type === 'addBot') {
    if (!isHost || room.status !== 'lobby') return;
    if (room.players.length >= engine.meta.maxPlayers)
      return send(ws, 'error', { message: `Room is full (${engine.meta.maxPlayers} max).` });
    const difficulty = [1, 2, 3, 4].includes(msg.difficulty) ? msg.difficulty : 2;
    const { botName } = require('./engines/judgement/bots');
    room.players.push({
      id: crypto.randomUUID(),
      name: botName(difficulty, room.players.map(p => p.name)),
      ws: null,
      connected: true,
      isBot: true,
      difficulty,
    });
    broadcastState(room);
    return;
  }

  if (type === 'removeBot') {
    if (!isHost || room.status !== 'lobby') return;
    room.players = room.players.filter(p => !(p.isBot && p.id === msg.playerId));
    broadcastState(room);
    return;
  }

  if (type === 'playAgain') {
    if (!isHost || room.status !== 'playing' || !engine.isFinished(room.game)) return;
    room.status = 'lobby';
    room.game = null;
    broadcastState(room);
    return;
  }

  // Everything else is a game action. `bid`/`play`/`nextRound` are accepted at
  // the top level for the existing clients; new games can use {type:'action'}.
  if (room.status !== 'playing' || !room.game) return;
  const action = type === 'action' ? msg.action : msg;
  if (!action || !action.type) return;

  // Host-only actions (advancing a scoreboard) aren't tied to a turn.
  const hostAction = engine.pendingHostAction(room.game);
  if (hostAction && action.type === hostAction.type) {
    if (!isHost) return;
    applyAndBroadcast(room, idx, action, ws);
    return;
  }

  if (engine.currentActor(room.game) !== idx) return;
  applyAndBroadcast(room, idx, action, ws);
}

// ---------- sockets ----------

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    try { handleMessage(ws, msg); } catch (e) { console.error(e); }
  });

  ws.on('close', () => {
    const room = ws._room, player = ws._player;
    if (!room || !player) return;
    if (room.status === 'lobby') {
      room.players = room.players.filter(p => p !== player);
      const humans = room.players.filter(p => !p.isBot);
      if (humans.length === 0) { destroyRoom(room); return; }
      if (room.hostId === player.id) room.hostId = humans[0].id;
    } else {
      player.connected = false;
      // Nobody left to come back for it.
      if (room.players.every(p => p.isBot || !p.connected)) { destroyRoom(room); return; }
    }
    broadcastState(room);
  });
});

startRoomGC();

server.listen(PORT, () => console.log(`Veyla Cards server running at http://localhost:${PORT}`));
