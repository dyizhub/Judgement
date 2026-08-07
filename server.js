// Judgement — realtime card game server
// Node + ws. Serves ./public statically and hosts game rooms over WebSocket.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { botBid, botPlay, botName } = require('./bots');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];

  // Health check for the cloud host / uptime monitors.
  if (urlPath === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', rooms: rooms.size, uptime: process.uptime() }));
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

// ---------- Game rules ----------

const SUITS = ['H', 'C', 'S', 'D'];
const SUIT_NAMES = { H: 'Hearts', C: 'Clubs', S: 'Spades', D: 'Diamonds' };
// Rounds 1-4: ♥ ♣ ♠ ♦ · Rounds 5-6: no trump · Rounds 7-10: ♦ ♠ ♣ ♥
const TRUMP_BY_ROUND = ['H', 'C', 'S', 'D', null, null, 'D', 'S', 'C', 'H'];
const TOTAL_ROUNDS = 10;
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 5;

function makeDeck() {
  const deck = [];
  for (const s of SUITS) for (let r = 2; r <= 14; r++) deck.push({ suit: s, rank: r });
  return deck;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Draws `count` cards without replacement from `deck`, weighting cards of
// `trumpSuit` `weight`x more likely to be picked than any other card.
// Returns { hand, remaining } — remaining is what's left in the deck for the
// next player to be dealt from.
function weightedDrawTrumpBiased(deck, count, trumpSuit, weight) {
  const pool = deck.slice();
  const hand = [];
  for (let k = 0; k < count && pool.length; k++) {
    const weights = pool.map(c => (c.suit === trumpSuit ? weight : 1));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = crypto.randomInt(total);
    let idx = 0;
    for (; idx < weights.length; idx++) {
      r -= weights[idx];
      if (r < 0) break;
    }
    hand.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return { hand, remaining: pool };
}

function cardEq(a, b) { return a.suit === b.suit && a.rank === b.rank; }

function trickWinner(trick, trumpSuit) {
  // trick: [{playerIdx, card}], first entry led
  const ledSuit = trick[0].card.suit;
  let best = trick[0];
  for (const entry of trick.slice(1)) {
    const c = entry.card, b = best.card;
    const cTrump = c.suit === trumpSuit, bTrump = b.suit === trumpSuit;
    if (cTrump && !bTrump) best = entry;
    else if (cTrump === bTrump && c.suit === b.suit && c.rank > b.rank) best = entry;
    else if (!cTrump && !bTrump && b.suit !== ledSuit && c.suit === ledSuit) best = entry;
  }
  return best.playerIdx;
}

// ---------- Rooms ----------

const rooms = new Map(); // code -> room

function newRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[crypto.randomInt(chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function createRoom() {
  const room = {
    code: newRoomCode(),
    players: [], // {id, name, ws, connected}
    hostId: null,
    phase: 'lobby', // lobby | bidding | playing | roundEnd | gameEnd
    round: 0,       // 1-based
    dealerIdx: 0,
    hands: [],      // per player: [{suit, rank}]
    bids: [],       // per player: number|null
    tricksWon: [],  // per player this round
    scores: [],     // cumulative
    scoreHistory: [], // per round: [{bid, won, delta}]
    trick: [],      // [{playerIdx, card}]
    lastTrick: null,
    turnIdx: null,
    trickLeaderIdx: null,
    playedCards: [],
    passBackUsed: [],
    botTimer: null,
    turnTimer: null,
    turnDeadline: null,
    lastActivity: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

function destroyRoom(room) {
  if (room.botTimer) { clearTimeout(room.botTimer); room.botTimer = null; }
  if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null; }
  rooms.delete(room.code);
}

function send(ws, type, payload = {}) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type, ...payload }));
}

function broadcastState(room) {
  room.lastActivity = Date.now();
  // Timers first: scheduleTurnTimeout sets room.turnDeadline, which the state
  // below carries so clients can show a countdown. Sending first would ship
  // the previous turn's deadline.
  scheduleBot(room);
  scheduleTurnTimeout(room);
  for (const p of room.players) if (!p.isBot) sendState(room, p);
}

function sendState(room, player) {
  const idx = room.players.indexOf(player);
  send(player.ws, 'state', {
    state: {
      code: room.code,
      phase: room.phase,
      youIdx: idx,
      youId: player.id,
      hostId: room.hostId,
      players: room.players.map(p => ({
        name: p.name, id: p.id, connected: p.connected,
        isBot: p.isBot || false, difficulty: p.difficulty,
      })),
      round: room.round,
      totalRounds: TOTAL_ROUNDS,
      trump: room.round ? TRUMP_BY_ROUND[room.round - 1] : null,
      dealerIdx: room.dealerIdx,
      hand: room.hands[idx] || [],
      handCounts: room.hands.map(h => h.length),
      bids: room.bids,
      tricksWon: room.tricksWon,
      scores: room.scores,
      scoreHistory: room.scoreHistory,
      trick: room.trick,
      lastTrick: room.lastTrick,
      turnIdx: room.turnIdx,
      forbiddenBid: room.phase === 'bidding' && room.turnIdx !== null
        ? forbiddenLastBid(room, room.turnIdx) : null,
      // Time left before the server plays for whoever is on turn. Sent as a
      // duration rather than a timestamp so a client whose clock is off still
      // counts down correctly.
      autoMoveInMs: room.turnDeadline ? Math.max(0, room.turnDeadline - Date.now()) : null,
      // Whether the player on turn may hand the bid back to the seat before
      // them, and who that is — so the button can name them.
      passBack: passBackInfo(room),
      // Dev mode: every player's hand, sent only to the dev player themself.
      // A non-dev client gets no field at all here — nothing to detect,
      // let alone reveal, even by inspecting network traffic.
      opponentHands: player.isDev && room.hands.length ? room.hands : null,
    },
  });
}

function startRound(room) {
  const n = room.players.length;
  room.round++;
  room.phase = 'bidding';
  room.dealerIdx = (room.round - 1) % n;
  room.bids = Array(n).fill(null);
  room.tricksWon = Array(n).fill(0);
  room.passBackUsed = Array(n).fill(false);
  room.trick = [];
  room.lastTrick = null;
  room.playedCards = [];

  let deck = shuffle(makeDeck());
  const trump = TRUMP_BY_ROUND[room.round - 1];
  room.hands = [];
  for (let i = 0; i < n; i++) {
    let hand;
    if (trump && room.players[i].isDev) {
      const weight = 2 + crypto.randomInt(2); // 2x or 3x
      const drawn = weightedDrawTrumpBiased(deck, room.round, trump, weight);
      hand = drawn.hand;
      deck = drawn.remaining;
    } else {
      hand = deck.splice(0, room.round);
    }
    hand.sort((a, b) => a.suit === b.suit ? b.rank - a.rank : SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit));
    room.hands.push(hand);
  }
  room.turnIdx = (room.dealerIdx + 1) % n;
  room.trickLeaderIdx = room.turnIdx;
  broadcastState(room);
}

// "Screw the dealer": the last player left to bid in a round may not bid the
// exact number that would make every bid this round sum to the tricks
// available — someone must be forced to miss. Returns the forbidden bid, or
// null if this isn't the last bidder.
function forbiddenLastBid(room, idx) {
  const others = room.bids.filter((b, i) => i !== idx);
  if (others.some(b => b === null)) return null; // not the last bidder yet
  const sumOthers = others.reduce((a, b) => a + b, 0);
  const forbidden = room.round - sumOthers;
  return forbidden >= 0 && forbidden <= room.round ? forbidden : null;
}

function applyBid(room, idx, bid) {
  if (room.phase !== 'bidding' || idx !== room.turnIdx) return null;
  if (!Number.isInteger(bid) || bid < 0 || bid > room.round) return null;
  const forbidden = forbiddenLastBid(room, idx);
  if (forbidden !== null && bid === forbidden)
    return `Total bids can't add up to ${room.round} — choose a different number.`;
  room.bids[idx] = bid;
  const n = room.players.length;
  if (room.bids.every(b => b !== null)) {
    room.phase = 'playing';
    room.turnIdx = (room.dealerIdx + 1) % n;
    room.trickLeaderIdx = room.turnIdx;
  } else {
    room.turnIdx = (idx + 1) % n;
  }
  broadcastState(room);
  return null;
}

// ---------- handing the bid back ----------
// Bidding goes round in order, so the seat immediately before you is the one
// who just bid. If they called something they regret, the player on turn can
// hand the turn back so they can re-bid.

function previousBidderIdx(room, idx) {
  const n = room.players.length;
  const firstBidder = (room.dealerIdx + 1) % n;
  if (idx === firstBidder) return null; // nobody has bid before you this round
  return (idx - 1 + n) % n;
}

// Why the player on turn may or may not send the bid back. Returned in state so
// the client can show (or explain) the button without duplicating the rules.
function passBackInfo(room) {
  if (room.phase !== 'bidding' || room.turnIdx === null) return null;
  const idx = room.turnIdx;
  const prev = previousBidderIdx(room, idx);
  if (prev === null || room.bids[prev] === null) return null;

  const target = room.players[prev];
  const used = !!(room.passBackUsed && room.passBackUsed[idx]);
  // Sending it back to someone who has dropped would just stall the table
  // until their own timeout fires.
  const unreachable = !target.isBot && !target.connected;

  return {
    toIdx: prev,
    toName: target.name,
    available: !used && !unreachable,
    reason: used ? 'already-used' : unreachable ? 'disconnected' : null,
  };
}

function applyPassBack(room, idx) {
  if (room.phase !== 'bidding' || idx !== room.turnIdx) return null;
  const info = passBackInfo(room);
  if (!info) return 'There is no earlier bid to send back.';
  if (info.reason === 'already-used') return 'You have already sent the bid back this round.';
  if (info.reason === 'disconnected') return `${info.toName} is disconnected.`;

  // One per seat per round, otherwise two players could bounce the turn
  // between them indefinitely.
  room.passBackUsed[idx] = true;
  room.bids[info.toIdx] = null;
  room.turnIdx = info.toIdx;
  broadcastState(room);
  return null;
}

function applyPlay(room, idx, card) {
  if (room.phase !== 'playing' || idx !== room.turnIdx) return null;
  const hand = room.hands[idx];
  if (!card || !hand.find(c => cardEq(c, card))) return null;
  if (room.trick.length > 0) {
    const ledSuit = room.trick[0].card.suit;
    if (card.suit !== ledSuit && hand.some(c => c.suit === ledSuit))
      return `Must follow ${SUIT_NAMES[ledSuit].toLowerCase()}.`;
  }
  room.hands[idx] = hand.filter(c => !cardEq(c, card));
  room.trick.push({ playerIdx: idx, card });
  room.playedCards.push(card);
  const n = room.players.length;

  if (room.trick.length === n) {
    const trump = TRUMP_BY_ROUND[room.round - 1];
    const winner = trickWinner(room.trick, trump);
    room.tricksWon[winner]++;
    room.lastTrick = { trick: room.trick, winnerIdx: winner };
    room.trick = [];
    if (room.hands.every(h => h.length === 0)) {
      broadcastState(room); // let clients show final trick
      finishRound(room);
    } else {
      room.turnIdx = winner;
      room.trickLeaderIdx = winner;
      broadcastState(room);
    }
  } else {
    room.turnIdx = (idx + 1) % n;
    broadcastState(room);
  }
  return null;
}

// Legal plays for a seat given the current trick (follow-suit rule).
function legalPlaysFor(room, idx) {
  const hand = room.hands[idx];
  if (!room.trick.length) return hand;
  const led = room.trick[0].card.suit;
  const follow = hand.filter(c => c.suit === led);
  return follow.length ? follow : hand;
}

// Make a minimal legal move for a human seat that has run out of time (AFK or
// vanished). Bidding: lowest legal bid (dodging the forbidden value). Playing:
// lowest-rank legal card. Keeps the table moving instead of freezing forever.
function autoAct(room, idx) {
  if (room.phase === 'bidding') {
    const forbidden = forbiddenLastBid(room, idx);
    const bid = forbidden === 0 ? Math.min(1, room.round) : 0;
    applyBid(room, idx, bid);
  } else if (room.phase === 'playing') {
    const legal = legalPlaysFor(room, idx).slice().sort((a, b) => a.rank - b.rank);
    if (legal.length) applyPlay(room, idx, legal[0]);
  }
}

// Auto-resolve a stalled game so it can never freeze the table for everyone
// else. Off-LAN, a player who loses signal or closes the app would otherwise
// hang forever — on their turn, or (as host) at the round-end scoreboard where
// advancing is a manual click. A vanished (disconnected) player gets a short
// reconnect grace; a present but idle one gets a longer courtesy window.
// No default is ever shorter than this: the old 12s gave someone who dropped
// for a moment no realistic chance to get back before their turn was played
// for them.
const MIN_TIMEOUT_MS = 30 * 1000;

// An explicitly-set env var is taken literally so tests can run in
// milliseconds; only the built-in defaults get the 30s floor.
function timeoutMs(envName, defaultMs) {
  const raw = Number(process.env[envName]);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return Math.max(MIN_TIMEOUT_MS, defaultMs);
}

const TURN_TIMEOUT_CONNECTED_MS = timeoutMs('TURN_TIMEOUT_CONNECTED_MS', 90 * 1000);
const TURN_TIMEOUT_DISCONNECTED_MS = timeoutMs('TURN_TIMEOUT_DISCONNECTED_MS', 30 * 1000);
// Round-end grace is longer for a present host so the table can read scores.
const ROUNDEND_TIMEOUT_CONNECTED_MS = timeoutMs('ROUNDEND_TIMEOUT_CONNECTED_MS', 120 * 1000);
const ROUNDEND_TIMEOUT_DISCONNECTED_MS = timeoutMs('ROUNDEND_TIMEOUT_DISCONNECTED_MS', 30 * 1000);

function scheduleTurnTimeout(room) {
  if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null; }
  // Deadline the clients count down against; null whenever nothing is pending.
  room.turnDeadline = null;
  if (process.env.NO_TURN_TIMEOUT) return; // disable for deterministic tests

  // Round-end: host normally advances manually so everyone can read the
  // scoreboard, but a vanished/idle host must not freeze the game.
  if (room.phase === 'roundEnd') {
    const host = room.players.find(p => p.id === room.hostId);
    const delay = host && host.connected
      ? ROUNDEND_TIMEOUT_CONNECTED_MS : ROUNDEND_TIMEOUT_DISCONNECTED_MS;
    room.turnDeadline = Date.now() + delay;
    room.turnTimer = setTimeout(() => {
      room.turnTimer = null;
      if (room.phase === 'roundEnd') startRound(room);
    }, delay);
    return;
  }

  if (room.phase !== 'bidding' && room.phase !== 'playing') return;
  if (room.turnIdx === null) return;
  const p = room.players[room.turnIdx];
  if (!p || p.isBot) return; // bots are handled by scheduleBot
  const delay = p.connected ? TURN_TIMEOUT_CONNECTED_MS : TURN_TIMEOUT_DISCONNECTED_MS;
  const turnAtSchedule = room.turnIdx;
  room.turnDeadline = Date.now() + delay;
  room.turnTimer = setTimeout(() => {
    room.turnTimer = null;
    if (room.turnIdx !== turnAtSchedule) return; // already moved on
    try { autoAct(room, room.turnIdx); }
    catch (e) { console.error('autoAct error:', e); }
  }, delay);
}

// If it's a bot's turn, schedule its move. Called from broadcastState so every
// state transition is covered. Delay paces the game and matches the client's
// 1.5s trick-pause so bot plays don't feel instant.
function scheduleBot(room) {
  if (room.botTimer) { clearTimeout(room.botTimer); room.botTimer = null; }
  if (room.phase !== 'bidding' && room.phase !== 'playing') return;
  if (room.turnIdx === null) return;
  const bot = room.players[room.turnIdx];
  if (!bot || !bot.isBot) return;

  // Longer delay right after a completed trick so clients finish their pause.
  const justEndedTrick = room.trick.length === 0 && room.lastTrick;
  const delay = process.env.BOT_FAST
    ? 5
    : (justEndedTrick ? 1700 : 800) + crypto.randomInt(500);

  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    const idx = room.players.indexOf(bot);
    if (idx === -1 || room.turnIdx !== idx) return;
    const view = {
      hand: room.hands[idx],
      trick: room.trick,
      trump: TRUMP_BY_ROUND[room.round - 1],
      round: room.round,
      bids: room.bids,
      tricksWon: room.tricksWon,
      myIdx: idx,
      playersCount: room.players.length,
      playedCards: room.playedCards,
      forbiddenBid: room.phase === 'bidding' ? forbiddenLastBid(room, idx) : null,
    };
    try {
      if (room.phase === 'bidding') {
        let bid = botBid(view, bot.difficulty);
        if (view.forbiddenBid !== null && bid === view.forbiddenBid) {
          // Safety net in case a tier's adjustment logic missed it — pick any legal alternative.
          bid = bid < room.round ? bid + 1 : bid - 1;
        }
        applyBid(room, idx, bid);
      } else {
        const hand = room.hands[idx];
        let legal = hand;
        if (room.trick.length > 0) {
          const led = room.trick[0].card.suit;
          const follow = hand.filter(c => c.suit === led);
          if (follow.length) legal = follow;
        }
        view.legal = legal;
        let card = botPlay(view, bot.difficulty);
        if (!card || !legal.find(c => cardEq(c, card))) card = legal[0]; // safety net
        applyPlay(room, idx, card);
      }
    } catch (e) {
      console.error('Bot error:', e);
      // Fail-safe so the game never stalls on a bot bug
      if (room.phase === 'bidding') {
        const safeBid = view.forbiddenBid === 0 ? 1 : 0;
        applyBid(room, idx, safeBid);
      } else {
        applyPlay(room, idx, room.hands[idx][0]);
      }
    }
  }, delay);
}

function finishRound(room) {
  const n = room.players.length;
  const roundResult = [];
  for (let i = 0; i < n; i++) {
    const bid = room.bids[i], won = room.tricksWon[i];
    const delta = bid === won ? bid * 10 + 10 : -10 * Math.abs(bid - won);
    room.scores[i] += delta;
    roundResult.push({ bid, won, delta });
  }
  room.scoreHistory.push(roundResult);
  room.phase = room.round >= TOTAL_ROUNDS ? 'gameEnd' : 'roundEnd';
  room.turnIdx = null;
  broadcastState(room);
}

function handleMessage(ws, msg) {
  const { type } = msg;

  if (type === 'create') {
    const room = createRoom();
    joinRoom(room, ws, msg.name);
    room.hostId = room.players[0].id;
    broadcastState(room);
    return;
  }

  if (type === 'join') {
    const room = rooms.get((msg.code || '').toUpperCase());
    if (!room) return send(ws, 'error', { message: 'Room not found.' });
    // Rejoin by id if game running
    const existing = room.players.find(p => p.id === msg.playerId);
    if (existing) {
      existing.ws = ws;
      existing.connected = true;
      ws._room = room; ws._player = existing;
      broadcastState(room);
      return;
    }
    if (room.phase !== 'lobby') return send(ws, 'error', { message: 'Game already in progress.' });
    if (room.players.length >= MAX_PLAYERS) return send(ws, 'error', { message: 'Room is full (5 max).' });
    joinRoom(room, ws, msg.name);
    broadcastState(room);
    return;
  }

  const room = ws._room, player = ws._player;
  if (!room || !player) return;
  const idx = room.players.indexOf(player);

  if (type === 'start') {
    if (player.id !== room.hostId || room.phase !== 'lobby') return;
    if (room.players.length < MIN_PLAYERS)
      return send(ws, 'error', { message: `Need at least ${MIN_PLAYERS} players.` });
    room.scores = Array(room.players.length).fill(0);
    room.scoreHistory = [];
    room.round = 0;
    startRound(room);
    return;
  }

  if (type === 'bid') {
    if (idx !== room.turnIdx) return;
    const err = applyBid(room, idx, Number(msg.bid));
    if (err) send(ws, 'error', { message: err });
    return;
  }

  if (type === 'play') {
    if (idx !== room.turnIdx) return;
    const err = applyPlay(room, idx, msg.card);
    if (err) send(ws, 'error', { message: err });
    return;
  }

  if (type === 'passBack') {
    if (idx !== room.turnIdx) return;
    const err = applyPassBack(room, idx);
    if (err) send(ws, 'error', { message: err });
    return;
  }

  if (type === 'addBot') {
    if (player.id !== room.hostId || room.phase !== 'lobby') return;
    if (room.players.length >= MAX_PLAYERS)
      return send(ws, 'error', { message: 'Room is full (5 max).' });
    const difficulty = [1, 2, 3, 4].includes(msg.difficulty) ? msg.difficulty : 2;
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
    if (player.id !== room.hostId || room.phase !== 'lobby') return;
    room.players = room.players.filter(p => !(p.isBot && p.id === msg.playerId));
    broadcastState(room);
    return;
  }

  if (type === 'nextRound') {
    if (player.id !== room.hostId || room.phase !== 'roundEnd') return;
    startRound(room);
    return;
  }

  if (type === 'playAgain') {
    if (player.id !== room.hostId || room.phase !== 'gameEnd') return;
    room.phase = 'lobby';
    room.round = 0;
    room.hands = []; room.bids = []; room.tricksWon = [];
    room.scores = []; room.scoreHistory = [];
    room.trick = []; room.lastTrick = null; room.turnIdx = null;
    broadcastState(room);
    return;
  }
}

// Dev mode (trump-biased deals + peeking at opponents' hands) is a local-play
// toy. It stays OFF unless explicitly enabled, so the deployed/public server —
// and any store build pointed at it — never has it.
const DEV_MODE_ENABLED = process.env.ENABLE_DEV_MODE === '1';
const DEV_NAMES = new Set(['adi', 'advay']);

// Strip zero-width/format chars (common from mobile keyboards/copy-paste)
// before matching so the check is robust to invisible characters.
// U+200B-U+200F: zero-width space/joiners + LTR/RTL marks
// U+202A-U+202E: directional embedding/override controls
// U+FEFF: zero-width no-break space (BOM)
// Separate non-global regex for .test() — a shared /g regex's .test() mutates
// lastIndex across calls and would cause false negatives on later joins.
const INVISIBLE_CHARS_PROBE = /[​-‏‪-‮﻿]/;
const INVISIBLE_CHARS_STRIP = /[​-‏‪-‮﻿]/g;

function normalizeName(name) {
  return String(name || '').replace(INVISIBLE_CHARS_STRIP, '').trim();
}

function joinRoom(room, ws, name) {
  const raw = String(name || '');
  // Dev mode is a secret handshake: the invisible marker char must actually
  // be present in what was typed/pasted — plainly typing "adi" gets nothing.
  const hasSecretMarker = INVISIBLE_CHARS_PROBE.test(raw);
  const cleanName = normalizeName(raw);
  const player = {
    id: crypto.randomUUID(),
    name: cleanName.slice(0, 16) || 'Player',
    ws,
    connected: true,
    isDev: DEV_MODE_ENABLED && hasSecretMarker && DEV_NAMES.has(cleanName.toLowerCase()),
  };
  room.players.push(player);
  ws._room = room;
  ws._player = player;
}

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
    if (room.phase === 'lobby') {
      room.players = room.players.filter(p => p !== player);
      const humans = room.players.filter(p => !p.isBot);
      if (humans.length === 0) { destroyRoom(room); return; }
      if (room.hostId === player.id) room.hostId = humans[0].id;
    } else {
      player.connected = false;
      if (room.players.every(p => p.isBot || !p.connected)) { destroyRoom(room); return; }
    }
    broadcastState(room);
  });
});

// Garbage-collect abandoned rooms: anything idle past the TTL is dropped so a
// long-lived cloud process doesn't leak memory on games no one came back to.
const ROOM_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (now - room.lastActivity > ROOM_TTL_MS) destroyRoom(room);
  }
}, 5 * 60 * 1000).unref();

server.listen(PORT, () => console.log(`Judgement server running at http://localhost:${PORT}`));
