// Callbreak bot AI. Four tiers: 1 Easy, 2 Medium, 3 Hard, 4 Expert.
//
// Callbreak rewards different instincts from Judgement. Missing a bid loses it
// outright, while an extra trick is worth only 0.1 — so bots bid conservatively
// and, once they have made their call, stop fighting for tricks rather than
// racing to win more.
//
// The engine has already narrowed the hand to legal cards before calling
// botPlay, so these functions only choose among moves that are allowed.

const crypto = require('crypto');

const TRUMP = 'S';

function rand(n) { return crypto.randomInt(n); }
function pick(arr) { return arr[rand(arr.length)]; }
function byRankAsc(a, b) { return a.rank - b.rank; }

function currentBest(trick) {
  const ledSuit = trick[0].card.suit;
  let best = trick[0].card;
  for (const e of trick.slice(1)) {
    const c = e.card;
    const cT = c.suit === TRUMP, bT = best.suit === TRUMP;
    if (cT && !bT) best = c;
    else if (cT === bT && c.suit === best.suit && c.rank > best.rank) best = c;
    else if (!cT && !bT && best.suit !== ledSuit && c.suit === ledSuit) best = c;
  }
  return best;
}

function beats(card, best, ledSuit) {
  const cT = card.suit === TRUMP, bT = best.suit === TRUMP;
  if (cT && !bT) return true;
  if (!cT && bT) return false;
  if (cT && bT) return card.rank > best.rank;
  if (card.suit !== ledSuit) return false;
  return best.suit === ledSuit ? card.rank > best.rank : true;
}

// Highest rank of `suit` neither in my hand nor already played — i.e. the best
// card an opponent could still be holding.
function highestOutstanding(suit, hand, playedCards) {
  const gone = new Set();
  for (const c of hand) if (c.suit === suit) gone.add(c.rank);
  for (const c of playedCards) if (c.suit === suit) gone.add(c.rank);
  for (let r = 14; r >= 2; r--) if (!gone.has(r)) return r;
  return 0;
}

// Expected tricks. Spades are counted by length as well as rank: with 13 cards
// each and spades permanently trump, a long trump suit wins late tricks with
// low cards, which a rank-only count misses badly.
function estimateTricks(hand) {
  const spades = hand.filter(c => c.suit === TRUMP);
  let e = 0;

  for (const c of spades) {
    if (c.rank === 14) e += 1;
    else if (c.rank === 13) e += 0.85;
    else if (c.rank === 12) e += 0.65;
    else if (c.rank >= 10) e += 0.45;
    else e += 0.15;
  }
  // Length bonus: spades past the fifth tend to run.
  if (spades.length > 4) e += (spades.length - 4) * 0.4;

  for (const suit of ['H', 'D', 'C']) {
    const cards = hand.filter(c => c.suit === suit);
    for (const c of cards) {
      if (c.rank === 14) e += 0.9;
      else if (c.rank === 13) e += cards.length > 1 ? 0.6 : 0.3;
      else if (c.rank === 12) e += cards.length > 2 ? 0.35 : 0.15;
    }
    // Short side suits let you start trumping early.
    if (cards.length === 0) e += 0.5;
    else if (cards.length === 1) e += 0.25;
  }

  return e;
}

// ---------- bidding ----------

function botBid(view, tier) {
  const { hand } = view;
  if (tier === 1) return 1 + rand(4); // 1..4, no read of the hand at all

  const e = estimateTricks(hand);
  if (tier === 2) return Math.max(1, Math.round(e));
  // Missing a bid forfeits all of it, so shade downward — but only a little.
  // Your score *is* your bid, so timid bidding caps the upside: measured over
  // 300 games, shading harder made the top tier score worse than tier 3.
  if (tier === 3) return Math.max(1, Math.floor(e));
  return Math.max(1, Math.round(e - 0.25));
}

// ---------- play ----------

function botPlay(view, tier) {
  const { legal, trick, bids, tricksWon, myIdx, playersCount, hand, playedCards } = view;
  if (tier === 1) return pick(legal);

  const sorted = legal.slice().sort(byRankAsc);
  const bid = bids[myIdx];
  const need = bid !== null && tricksWon[myIdx] < bid;

  if (tier === 2) return need ? sorted[sorted.length - 1] : sorted[0];

  const isLast = trick.length === playersCount - 1;

  // Would this card almost certainly take the trick if led?
  function isSureWinner(card) {
    if (tier < 4) return false;
    if (card.rank <= highestOutstanding(card.suit, hand, playedCards)) return false;
    return card.suit === TRUMP; // off-suit winners can always be ruffed
  }

  if (!trick.length) {
    if (need) {
      if (tier === 4) {
        const sure = sorted.filter(isSureWinner);
        if (sure.length) return sure[0]; // cash the cheapest certain trick
      }
      const topSpades = sorted.filter(c => c.suit === TRUMP);
      if (topSpades.length && tier === 4) return topSpades[topSpades.length - 1];
      return sorted[sorted.length - 1];
    }
    // Bid already made: lead low and keep the winners for nothing.
    return sorted[0];
  }

  const ledSuit = trick[0].card.suit;
  const best = currentBest(trick);
  const winners = sorted.filter(c => beats(c, best, ledSuit));
  const losers = sorted.filter(c => !beats(c, best, ledSuit));

  if (need) {
    if (!winners.length) return sorted[0];       // can't take it — spend the cheapest
    if (isLast) return winners[0];               // last to act: win as cheaply as possible
    if (tier === 4) {
      // Players still to act can beat a marginal winner, so only play cheap
      // when the card can't be beaten; otherwise commit a strong one.
      const sure = winners.filter(isSureWinner);
      if (sure.length) return sure[0];
    }
    return winners[winners.length - 1];
  }

  // Bid is already met. Extra tricks are worth 0.1, so shed rather than fight —
  // but Callbreak often leaves no losing card to play.
  if (losers.length) return losers[losers.length - 1];
  return winners[0];
}

const BOT_NAMES = {
  1: ['Rookie Rex', 'Dodo', 'Biscuit', 'Waffles'],
  2: ['Steady Sam', 'Marble', 'Copper', 'Juniper'],
  3: ['Sharp Silas', 'Raven', 'Vesper', 'Flint'],
  4: ['The Judge', 'Minerva', 'Kasparov', 'Oracle'],
};

function botName(tier, taken) {
  const pool = BOT_NAMES[tier].filter(n => !taken.includes(n));
  return pool.length ? pick(pool) : BOT_NAMES[tier][0] + ' ' + (taken.length + 1);
}

module.exports = { botBid, botPlay, botName, estimateTricks };
