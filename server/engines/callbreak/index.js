// Callbreak — 4 players, 13 cards each, spades always trump, 5 deals.
//
// Differences from Judgement worth knowing when reading this file:
//   * Trump is always ♠, never rotates, and there are no no-trump rounds.
//   * Every deal is 13 cards; the round number only counts deals (1..5).
//   * Bids start at 1 — you may not call zero — and there is no
//     "screw the dealer" restriction, so bids can total anything.
//   * Play is far more constrained: you must beat the trick if you can
//     (see legalPlays). This is the rule that makes Callbreak feel different.
//   * Scoring is decimal: make your bid and you score it, plus 0.1 for each
//     extra trick; miss it and you lose your bid outright.
//
// Scores are held in tenths internally so repeated addition can't accumulate
// floating-point error, and divided only when building a view.

const { makeDeck, shuffle, cardEq, sortHand, SUIT_NAMES } = require('../../core/deck');
const { botBid, botPlay, botName } = require('./bots');

const TRUMP = 'S';
const TOTAL_ROUNDS = 5;
const CARDS_PER_HAND = 13;
const PLAYERS = 4;
const MIN_BID = 1;

const meta = {
  id: 'callbreak',
  name: 'Callbreak',
  family: 'trick-taking',
  minPlayers: PLAYERS,
  maxPlayers: PLAYERS,
  blurb: 'Spades are always trump. Call your tricks and take at least that many.',
};

// ---------- rules ----------

function trickWinner(trick) {
  const ledSuit = trick[0].card.suit;
  let best = trick[0];
  for (const entry of trick.slice(1)) {
    const c = entry.card, b = best.card;
    const cTrump = c.suit === TRUMP, bTrump = b.suit === TRUMP;
    if (cTrump && !bTrump) best = entry;
    else if (cTrump === bTrump && c.suit === b.suit && c.rank > b.rank) best = entry;
    else if (!cTrump && !bTrump && b.suit !== ledSuit && c.suit === ledSuit) best = entry;
  }
  return best.playerIdx;
}

// Callbreak's defining constraint. In order:
//   1. Leading? Anything goes.
//   2. Holding the led suit? You must play it, and must beat the highest card
//      of that suit already played if you are able to.
//   3. Void in the led suit? You must trump, and must over-trump if a spade is
//      already down and you hold a higher one.
//   4. Cannot over-trump (or hold no spades)? Discard anything.
//
// Note: step 4 is the common house reading — a player who cannot over-trump is
// not forced to waste a spade. Some tables instead require playing a spade
// regardless; say the word and it's a two-line change.
function legalPlays(hand, trick) {
  if (!trick.length) return hand;

  const led = trick[0].card.suit;
  const follow = hand.filter(c => c.suit === led);

  if (follow.length) {
    const ledCards = trick.filter(e => e.card.suit === led).map(e => e.card.rank);
    const highestLed = Math.max(...ledCards);
    const higher = follow.filter(c => c.rank > highestLed);
    return higher.length ? higher : follow;
  }

  const spades = hand.filter(c => c.suit === TRUMP);
  if (!spades.length) return hand;

  const spadesDown = trick.filter(e => e.card.suit === TRUMP).map(e => e.card.rank);
  if (!spadesDown.length) return spades; // first to trump: any spade

  const highestSpade = Math.max(...spadesDown);
  const higherSpades = spades.filter(c => c.rank > highestSpade);
  if (higherSpades.length) return higherSpades;

  const nonSpades = hand.filter(c => c.suit !== TRUMP);
  return nonSpades.length ? nonSpades : spades; // cannot over-trump: discard
}

// Tenths of a point, so scores stay integers until display.
function roundDelta(bid, won) {
  if (won >= bid) return bid * 10 + (won - bid);
  return -bid * 10;
}

// ---------- lifecycle ----------

function createState(ctx) {
  const gs = {
    phase: 'bidding',
    round: 0,
    totalRounds: TOTAL_ROUNDS,
    dealerIdx: 0,
    hands: [],
    bids: [],
    tricksWon: [],
    scores: Array(ctx.players.length).fill(0), // tenths
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
  gs.trick = [];
  gs.lastTrick = null;
  gs.playedCards = [];

  const deck = shuffle(makeDeck());
  gs.hands = [];
  for (let i = 0; i < n; i++) gs.hands.push(sortHand(deck.splice(0, CARDS_PER_HAND)));

  gs.turnIdx = (gs.dealerIdx + 1) % n;
  gs.trickLeaderIdx = gs.turnIdx;
}

function finishRound(gs, ctx) {
  const roundResult = [];
  for (let i = 0; i < ctx.players.length; i++) {
    const bid = gs.bids[i], won = gs.tricksWon[i];
    const delta = roundDelta(bid, won);
    gs.scores[i] += delta;
    roundResult.push({ bid, won, delta: delta / 10 });
  }
  gs.scoreHistory.push(roundResult);
  gs.phase = gs.round >= TOTAL_ROUNDS ? 'gameEnd' : 'roundEnd';
  gs.turnIdx = null;
}

// ---------- actions ----------

function applyBid(gs, ctx, idx, bid) {
  if (gs.phase !== 'bidding' || idx !== gs.turnIdx) return null;
  if (!Number.isInteger(bid) || bid < MIN_BID || bid > CARDS_PER_HAND) return null;

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

  const legal = legalPlays(hand, gs.trick);
  if (!legal.find(c => cardEq(c, card))) return illegalReason(hand, gs.trick);

  gs.hands[idx] = hand.filter(c => !cardEq(c, card));
  gs.trick.push({ playerIdx: idx, card });
  gs.playedCards.push(card);

  if (gs.trick.length === ctx.players.length) {
    const winner = trickWinner(gs.trick);
    gs.tricksWon[winner]++;
    gs.lastTrick = { trick: gs.trick, winnerIdx: winner };
    gs.trick = [];
    if (gs.hands.every(h => h.length === 0)) finishRound(gs, ctx);
    else {
      gs.turnIdx = winner;
      gs.trickLeaderIdx = winner;
    }
  } else {
    gs.turnIdx = (idx + 1) % ctx.players.length;
  }
  return null;
}

// Callbreak rejects more moves than players expect, so say which rule bit.
function illegalReason(hand, trick) {
  const led = trick[0].card.suit;
  const follow = hand.filter(c => c.suit === led);
  const suitName = SUIT_NAMES[led].toLowerCase();
  if (follow.length) {
    const highestLed = Math.max(...trick.filter(e => e.card.suit === led).map(e => e.card.rank));
    return follow.some(c => c.rank > highestLed)
      ? `Must play a higher ${suitName.slice(0, -1)} if you can.`
      : `Must follow ${suitName}.`;
  }
  const spadesDown = trick.filter(e => e.card.suit === TRUMP).map(e => e.card.rank);
  if (!spadesDown.length) return 'Out of that suit — you must trump with a spade.';
  return 'Must play a higher spade if you can.';
}

function applyAction(gs, ctx, idx, action) {
  switch (action && action.type) {
    case 'bid': return applyBid(gs, ctx, idx, Number(action.bid));
    case 'play': return applyPlay(gs, ctx, idx, action.card);
    case 'nextRound':
      if (gs.phase !== 'roundEnd') return null;
      startRound(gs, ctx);
      return null;
    default: return null;
  }
}

// ---------- turn ownership ----------

function currentActor(gs) {
  if (gs.phase !== 'bidding' && gs.phase !== 'playing') return null;
  return gs.turnIdx;
}

function pendingHostAction(gs) {
  return gs.phase === 'roundEnd' ? { type: 'nextRound' } : null;
}

function autoAction(gs, idx) {
  if (gs.phase === 'bidding') return { type: 'bid', bid: MIN_BID };
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
    bids: gs.bids,
    tricksWon: gs.tricksWon,
    myIdx: idx,
    playersCount: ctx.players.length,
    playedCards: gs.playedCards,
    cardsPerHand: CARDS_PER_HAND,
  };

  if (gs.phase === 'bidding') {
    let bid = botBid(view, difficulty);
    bid = Math.max(MIN_BID, Math.min(CARDS_PER_HAND, bid));
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

function justResolvedTrick(gs) {
  return gs.trick.length === 0 && !!gs.lastTrick;
}

// ---------- views ----------

function bidOptions() {
  return Array.from({ length: CARDS_PER_HAND - MIN_BID + 1 }, (_, i) => MIN_BID + i);
}

function viewFor(gs, ctx, idx) {
  const myHand = gs.hands[idx] || [];
  return {
    phase: gs.phase,
    round: gs.round,
    totalRounds: gs.totalRounds,
    trump: TRUMP,
    dealerIdx: gs.dealerIdx,
    hand: myHand,
    handCounts: gs.hands.map(h => h.length),
    bids: gs.bids,
    tricksWon: gs.tricksWon,
    scores: gs.scores.map(s => s / 10),
    scoreHistory: gs.scoreHistory,
    trick: gs.trick,
    lastTrick: gs.lastTrick,
    turnIdx: gs.turnIdx,
    forbiddenBid: null, // Callbreak has no screw-the-dealer rule
    // Callbreak's bid range is fixed (1..13), unlike Judgement's 0..round, so
    // clients must read this rather than deriving it from the round number.
    bidOptions: bidOptions(),
    // Play is restricted enough that the client should not guess at it.
    legalCards: gs.phase === 'playing' && gs.turnIdx === idx ? legalPlays(myHand, gs.trick) : null,
    opponentHands: null,
  };
}

function lobbyView() {
  return {
    phase: 'lobby',
    round: 0,
    totalRounds: TOTAL_ROUNDS,
    trump: TRUMP,
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
    bidOptions: bidOptions(),
    legalCards: null,
    opponentHands: null,
  };
}

function isFinished(gs) {
  return gs.phase === 'gameEnd';
}

function results(gs, ctx) {
  return ctx.players
    .map((p, i) => ({ playerId: p.id, name: p.name, isBot: !!p.isBot, score: gs.scores[i] / 10 }))
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
  _internals: { trickWinner, legalPlays, roundDelta, TRUMP, CARDS_PER_HAND, TOTAL_ROUNDS, MIN_BID },
};
