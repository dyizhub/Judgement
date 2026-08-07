// Judgement (Kachufool) — trick-taking, bid the exact number of tricks.
//
// Rules are Advay's house variant: rounds ascend 1..10 cards, trump rotates
// ♥ ♣ ♠ ♦ then two no-trump rounds then ♦ ♠ ♣ ♥, exact bid scores bid*10+10,
// a miss costs 10 per trick off, and the last bidder may not make the bids
// total the round's trick count ("screw the dealer").
//
// This module is socket-free and holds no globals: hand it a state object and
// a context and it can be driven entirely from a test.

const crypto = require('crypto');
const { makeDeck, shuffle, cardEq, sortHand, weightedDrawSuitBiased } = require('../../core/deck');
const { SUIT_NAMES } = require('../../core/deck');
const { botBid, botPlay, botName } = require('./bots');

const TRUMP_BY_ROUND = ['H', 'C', 'S', 'D', null, null, 'D', 'S', 'C', 'H'];
const TOTAL_ROUNDS = 10;

const meta = {
  id: 'judgement',
  name: 'Judgement',
  family: 'trick-taking',
  minPlayers: 3,
  maxPlayers: 5,
  blurb: 'Bid exactly how many tricks you will win — hit it or lose points.',
};

// ---------- helpers ----------

function trumpFor(round) {
  return round >= 1 && round <= TOTAL_ROUNDS ? TRUMP_BY_ROUND[round - 1] : null;
}

function trickWinner(trick, trumpSuit) {
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

// The bid the last remaining bidder may not make, or null if others still owe
// a bid. Keeps someone forced to miss.
function forbiddenLastBid(gs, idx) {
  const others = gs.bids.filter((b, i) => i !== idx);
  if (others.some(b => b === null)) return null;
  const sumOthers = others.reduce((a, b) => a + b, 0);
  const forbidden = gs.round - sumOthers;
  return forbidden >= 0 && forbidden <= gs.round ? forbidden : null;
}

function legalPlays(hand, trick) {
  if (!trick.length) return hand;
  const led = trick[0].card.suit;
  const follow = hand.filter(c => c.suit === led);
  return follow.length ? follow : hand;
}

// ---------- handing the bid back ----------
// Bidding goes round in order, so the seat immediately before you is the one
// who just bid. If they called something they regret, the player on turn can
// hand the turn back so they can re-bid.

function previousBidderIdx(gs, ctx, idx) {
  const n = ctx.players.length;
  const firstBidder = (gs.dealerIdx + 1) % n;
  if (idx === firstBidder) return null; // nobody has bid before you this round
  return (idx - 1 + n) % n;
}

// Why the player on turn may or may not send the bid back. Published in the
// view so the client can render (or explain) the button without duplicating
// the rules.
function passBackInfo(gs, ctx) {
  if (gs.phase !== 'bidding' || gs.turnIdx === null) return null;
  const idx = gs.turnIdx;
  const prev = previousBidderIdx(gs, ctx, idx);
  if (prev === null || gs.bids[prev] === null) return null;

  const target = ctx.players[prev];
  const used = !!(gs.passBackUsed && gs.passBackUsed[idx]);
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

function applyPassBack(gs, ctx, idx) {
  if (gs.phase !== 'bidding' || idx !== gs.turnIdx) return null;
  const info = passBackInfo(gs, ctx);
  if (!info) return 'There is no earlier bid to send back.';
  if (info.reason === 'already-used') return 'You have already sent the bid back this round.';
  if (info.reason === 'disconnected') return `${info.toName} is disconnected.`;

  // One per seat per round, otherwise two players could bounce the turn
  // between them indefinitely.
  gs.passBackUsed[idx] = true;
  gs.bids[info.toIdx] = null;
  gs.turnIdx = info.toIdx;
  return null;
}

// ---------- lifecycle ----------

function createState(ctx) {
  const n = ctx.players.length;
  const gs = {
    phase: 'bidding',
    round: 0,
    totalRounds: TOTAL_ROUNDS,
    dealerIdx: 0,
    hands: [],
    bids: [],
    tricksWon: [],
    scores: Array(n).fill(0),
    scoreHistory: [],
    trick: [],
    lastTrick: null,
    turnIdx: null,
    trickLeaderIdx: null,
    playedCards: [],
  };
  startRound(gs, ctx);
  return gs;
}

function startRound(gs, ctx) {
  const n = ctx.players.length;
  gs.round++;
  gs.phase = 'bidding';
  gs.dealerIdx = (gs.round - 1) % n;
  gs.bids = Array(n).fill(null);
  gs.tricksWon = Array(n).fill(0);
  gs.passBackUsed = Array(n).fill(false);
  gs.trick = [];
  gs.lastTrick = null;
  gs.playedCards = [];

  let deck = shuffle(makeDeck());
  const trump = trumpFor(gs.round);
  gs.hands = [];
  for (let i = 0; i < n; i++) {
    let hand;
    if (trump && ctx.players[i].isDev) {
      const weight = 2 + crypto.randomInt(2);
      const drawn = weightedDrawSuitBiased(deck, gs.round, trump, weight);
      hand = drawn.hand;
      deck = drawn.remaining;
    } else {
      hand = deck.splice(0, gs.round);
    }
    gs.hands.push(sortHand(hand));
  }
  gs.turnIdx = (gs.dealerIdx + 1) % n;
  gs.trickLeaderIdx = gs.turnIdx;
}

function finishRound(gs, ctx) {
  const n = ctx.players.length;
  const roundResult = [];
  for (let i = 0; i < n; i++) {
    const bid = gs.bids[i], won = gs.tricksWon[i];
    const delta = bid === won ? bid * 10 + 10 : -10 * Math.abs(bid - won);
    gs.scores[i] += delta;
    roundResult.push({ bid, won, delta });
  }
  gs.scoreHistory.push(roundResult);
  gs.phase = gs.round >= TOTAL_ROUNDS ? 'gameEnd' : 'roundEnd';
  gs.turnIdx = null;
}

// ---------- actions ----------

function applyBid(gs, ctx, idx, bid) {
  if (gs.phase !== 'bidding' || idx !== gs.turnIdx) return null;
  if (!Number.isInteger(bid) || bid < 0 || bid > gs.round) return null;
  const forbidden = forbiddenLastBid(gs, idx);
  if (forbidden !== null && bid === forbidden)
    return `Total bids can't add up to ${gs.round} — choose a different number.`;

  gs.bids[idx] = bid;
  const n = ctx.players.length;
  if (gs.bids.every(b => b !== null)) {
    gs.phase = 'playing';
    gs.turnIdx = (gs.dealerIdx + 1) % n;
    gs.trickLeaderIdx = gs.turnIdx;
  } else {
    gs.turnIdx = (idx + 1) % n;
  }
  return null;
}

function applyPlay(gs, ctx, idx, card) {
  if (gs.phase !== 'playing' || idx !== gs.turnIdx) return null;
  const hand = gs.hands[idx];
  if (!card || !hand.find(c => cardEq(c, card))) return null;
  if (gs.trick.length > 0) {
    const ledSuit = gs.trick[0].card.suit;
    if (card.suit !== ledSuit && hand.some(c => c.suit === ledSuit))
      return `Must follow ${SUIT_NAMES[ledSuit].toLowerCase()}.`;
  }

  gs.hands[idx] = hand.filter(c => !cardEq(c, card));
  gs.trick.push({ playerIdx: idx, card });
  gs.playedCards.push(card);
  const n = ctx.players.length;

  if (gs.trick.length === n) {
    const winner = trickWinner(gs.trick, trumpFor(gs.round));
    gs.tricksWon[winner]++;
    gs.lastTrick = { trick: gs.trick, winnerIdx: winner };
    gs.trick = [];
    if (gs.hands.every(h => h.length === 0)) finishRound(gs, ctx);
    else {
      gs.turnIdx = winner;
      gs.trickLeaderIdx = winner;
    }
  } else {
    gs.turnIdx = (idx + 1) % n;
  }
  return null;
}

// Single entry point the core uses. Returns an error string for the acting
// player, or null.
function applyAction(gs, ctx, idx, action) {
  switch (action && action.type) {
    case 'bid': return applyBid(gs, ctx, idx, Number(action.bid));
    case 'play': return applyPlay(gs, ctx, idx, action.card);
    case 'passBack': return applyPassBack(gs, ctx, idx);
    case 'nextRound':
      if (gs.phase !== 'roundEnd') return null;
      startRound(gs, ctx);
      return null;
    default: return null;
  }
}

// ---------- turn ownership ----------

// Whose move the game is waiting on, or null if it's waiting on the host.
function currentActor(gs) {
  if (gs.phase !== 'bidding' && gs.phase !== 'playing') return null;
  return gs.turnIdx;
}

// An action the host must take to move things along (shown as a button, and
// auto-fired if the host vanishes).
function pendingHostAction(gs) {
  return gs.phase === 'roundEnd' ? { type: 'nextRound' } : null;
}

// Minimal legal move for a seat that ran out of time.
function autoAction(gs, idx) {
  if (gs.phase === 'bidding') {
    const forbidden = forbiddenLastBid(gs, idx);
    const bid = forbidden === 0 ? Math.min(1, gs.round) : 0;
    return { type: 'bid', bid };
  }
  if (gs.phase === 'playing') {
    const legal = legalPlays(gs.hands[idx], gs.trick).slice().sort((a, b) => a.rank - b.rank);
    if (legal.length) return { type: 'play', card: legal[0] };
  }
  return null;
}

function botAction(gs, ctx, idx, difficulty) {
  const view = {
    hand: gs.hands[idx],
    trick: gs.trick,
    trump: trumpFor(gs.round),
    round: gs.round,
    bids: gs.bids,
    tricksWon: gs.tricksWon,
    myIdx: idx,
    playersCount: ctx.players.length,
    playedCards: gs.playedCards,
    forbiddenBid: gs.phase === 'bidding' ? forbiddenLastBid(gs, idx) : null,
  };

  if (gs.phase === 'bidding') {
    let bid = botBid(view, difficulty);
    if (view.forbiddenBid !== null && bid === view.forbiddenBid) {
      bid = bid < gs.round ? bid + 1 : bid - 1;
    }
    return { type: 'bid', bid };
  }
  if (gs.phase === 'playing') {
    const legal = legalPlays(gs.hands[idx], gs.trick);
    view.legal = legal;
    let card = botPlay(view, difficulty);
    if (!card || !legal.find(c => cardEq(c, card))) card = legal[0];
    return { type: 'play', card };
  }
  return null;
}

// Whether a completed trick just ended — the core lengthens the bot's delay so
// clients can finish showing the winner.
function justResolvedTrick(gs) {
  return gs.trick.length === 0 && !!gs.lastTrick;
}

// ---------- views ----------

// Fields merged into the client's state object. Never include another seat's
// hand: `opponentHands` is the single deliberate exception, dev mode only.
function viewFor(gs, ctx, idx) {
  const player = ctx.players[idx];
  return {
    phase: gs.phase,
    round: gs.round,
    totalRounds: gs.totalRounds,
    trump: gs.round ? trumpFor(gs.round) : null,
    dealerIdx: gs.dealerIdx,
    hand: gs.hands[idx] || [],
    handCounts: gs.hands.map(h => h.length),
    bids: gs.bids,
    tricksWon: gs.tricksWon,
    scores: gs.scores,
    scoreHistory: gs.scoreHistory,
    trick: gs.trick,
    lastTrick: gs.lastTrick,
    turnIdx: gs.turnIdx,
    forbiddenBid:
      gs.phase === 'bidding' && gs.turnIdx !== null ? forbiddenLastBid(gs, gs.turnIdx) : null,
    passBack: passBackInfo(gs, ctx),
    opponentHands: player && player.isDev && gs.hands.length ? gs.hands : null,
  };
}

// Shape of a seat's state while the table is still in the lobby. Declaring the
// same keys the in-game view uses means clients can read state.scoreHistory (or
// any other field) before a game starts without special-casing lobby.
function lobbyView() {
  return {
    phase: 'lobby',
    round: 0,
    totalRounds: TOTAL_ROUNDS,
    trump: null,
    dealerIdx: 0,
    hand: [],
    handCounts: [],
    bids: [],
    tricksWon: [],
    scores: [],
    scoreHistory: [],
    trick: [],
    lastTrick: null,
    turnIdx: null,
    forbiddenBid: null,
    passBack: null,
    opponentHands: null,
  };
}

function isFinished(gs) {
  return gs.phase === 'gameEnd';
}

function results(gs, ctx) {
  return ctx.players
    .map((p, i) => ({ playerId: p.id, name: p.name, isBot: !!p.isBot, score: gs.scores[i] }))
    .sort((a, b) => b.score - a.score)
    .map((r, rank) => ({ ...r, placement: rank + 1 }));
}

module.exports = {
  meta,
  createState,
  applyAction,
  viewFor,
  lobbyView,
  currentActor,
  pendingHostAction,
  autoAction,
  botAction,
  botName,
  justResolvedTrick,
  isFinished,
  results,
  // exported for tests
  _internals: { trickWinner, forbiddenLastBid, legalPlays, trumpFor, TRUMP_BY_ROUND },
};
