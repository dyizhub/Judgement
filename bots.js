// Bot AI for Judgement. Four tiers: 1 Easy, 2 Medium, 3 Hard, 4 Expert.
// A bot receives a view of the game from its own seat:
// { hand, legal, trick, trump, round, bids, tricksWon, myIdx, playersCount, playedCards }
// playedCards: every card played so far this round (including current trick).

const crypto = require('crypto');

function rand(n) { return crypto.randomInt(n); }
function pick(arr) { return arr[rand(arr.length)]; }

// Would `card`, played by the next player, beat the current best entry?
function beats(card, bestCard, ledSuit, trump) {
  const cT = card.suit === trump, bT = bestCard.suit === trump;
  if (cT && !bT) return true;
  if (!cT && bT) return false;
  if (cT && bT) return card.rank > bestCard.rank;
  if (card.suit !== ledSuit) return false;
  return bestCard.suit === ledSuit ? card.rank > bestCard.rank : true;
}

function currentBest(trick, trump) {
  const ledSuit = trick[0].card.suit;
  let best = trick[0].card;
  for (const e of trick.slice(1)) if (beats(e.card, best, ledSuit, trump)) best = e.card;
  return best;
}

// Expected-tricks estimate for a hand.
function estimate(hand, trump) {
  let e = 0;
  for (const c of hand) {
    if (trump && c.suit === trump) {
      e += c.rank >= 11 ? 1 : c.rank >= 7 ? 0.6 : 0.35;
    } else {
      if (c.rank === 14) e += trump ? 0.85 : 1;
      else if (c.rank === 13) e += trump ? 0.5 : 0.7;
      else if (c.rank === 12) e += trump ? 0.25 : 0.4;
      else if (c.rank === 11) e += trump ? 0.1 : 0.2;
    }
  }
  return e;
}

// Highest rank of `suit` not in my hand and not yet played this round.
// (Other players' current holdings are a subset of these.)
function highestRemaining(suit, hand, playedCards) {
  const gone = new Set();
  for (const c of hand) if (c.suit === suit) gone.add(c.rank);
  for (const c of playedCards) if (c.suit === suit) gone.add(c.rank);
  for (let r = 14; r >= 2; r--) if (!gone.has(r)) return r;
  return 0;
}

function byRankAsc(a, b) { return a.rank - b.rank; }

// ---------- Bidding ----------

function botBid(view, tier) {
  const { hand, trump, round, bids } = view;
  if (tier === 1) {
    let bid = rand(round + 1);
    if (view.forbiddenBid !== null && view.forbiddenBid !== undefined && bid === view.forbiddenBid) {
      bid = bid >= round ? bid - 1 : bid + 1;
    }
    return bid;
  }

  const e = estimate(hand, trump);
  let bid;
  if (tier === 2) {
    bid = Math.round(e);
  } else if (tier === 3) {
    // Slightly conservative: round .5 down (missing costs less the closer
    // the bid is, so undershooting by a hair is cheaper than overshooting).
    bid = Math.floor(e + 0.4);
  } else {
    // Expert: read the table. If everyone else has bid, compare total to tricks available.
    const others = bids.filter((b, i) => i !== view.myIdx && b !== null);
    const frac = e - Math.floor(e);
    let threshold = 0.5;
    if (others.length === view.playersCount - 1) {
      const total = others.reduce((a, b) => a + b, 0);
      // Under-bid table → spare tricks will fall to me: round up more readily.
      // Over-bid table → tricks are contested: round down.
      threshold = total >= round ? 0.75 : 0.35;
    }
    bid = Math.floor(e) + (frac >= threshold ? 1 : 0);
  }
  bid = Math.max(0, Math.min(round, bid));

  // "Screw the dealer": as the last bidder, avoid the one value that would
  // make all bids sum to the tricks available — nudge toward the estimate's
  // second-best neighbor instead of a random direction.
  if (view.forbiddenBid !== null && view.forbiddenBid !== undefined && bid === view.forbiddenBid) {
    if (bid >= round) bid -= 1;
    else if (bid <= 0) bid += 1;
    else bid = (e - bid > 0) ? bid + 1 : bid - 1; // step toward the estimate
  }
  return bid;
}

// ---------- Card play ----------

function botPlay(view, tier) {
  const { legal } = view;
  if (tier === 1) return pick(legal);

  const { trick, trump, bids, tricksWon, myIdx, playersCount, hand, playedCards } = view;
  const need = bids[myIdx] !== null && tricksWon[myIdx] < bids[myIdx];
  const sorted = legal.slice().sort(byRankAsc);

  if (tier === 2) {
    return need ? sorted[sorted.length - 1] : sorted[0];
  }

  const isLast = trick.length === playersCount - 1;

  // "Sure winner" check for expert: highest remaining of its suit, and no trump threat.
  function isSureWinner(card) {
    if (tier < 4) return false;
    if (card.rank <= highestRemaining(card.suit, hand, playedCards)) return false;
    if (trump && card.suit !== trump) return false; // someone may ruff
    return true;
  }

  if (trick.length === 0) {
    // Leading
    if (need) {
      if (tier === 4) {
        const sure = sorted.filter(isSureWinner);
        if (sure.length) return sure[0]; // cheapest guaranteed trick
      }
      // Lead strength: prefer highest trump, else highest card
      const trumps = sorted.filter(c => c.suit === trump);
      if (trumps.length && tier === 4) return trumps[trumps.length - 1];
      return sorted[sorted.length - 1];
    }
    // Avoiding: lead lowest
    return sorted[0];
  }

  const ledSuit = trick[0].card.suit;
  const best = currentBest(trick, trump);
  const winners = sorted.filter(c => beats(c, best, ledSuit, trump));
  const losers = sorted.filter(c => !beats(c, best, ledSuit, trump));

  if (need) {
    if (winners.length === 0) return sorted[0]; // can't win — save nothing, dump lowest
    if (isLast) return winners[0];              // cheapest card that takes it
    if (tier === 4) {
      const sure = winners.filter(isSureWinner);
      if (sure.length) return sure[0];
      return winners[winners.length - 1];       // strongest attempt
    }
    return winners[winners.length - 1];
  }

  // Avoiding tricks: dump the biggest card that still loses.
  if (losers.length) {
    if (tier === 4) {
      // Prefer shedding dangerous high offsuit cards over mid cards.
      return losers[losers.length - 1];
    }
    return losers[losers.length - 1];
  }
  // Every legal card wins (forced). Take it as cheaply as possible.
  return winners[0];
}

const BOT_NAMES = {
  1: ['Rookie Rex', 'Dodo', 'Biscuit', 'Waffles'],
  2: ['Steady Sam', 'Marble', 'Copper', 'Juniper'],
  3: ['Sharp Silas', 'Raven', 'Vesper', 'Flint'],
  4: ['The Judge', 'Minerva', 'Kasparov', 'Oracle'],
};
const TIER_NAMES = { 1: 'Easy', 2: 'Medium', 3: 'Hard', 4: 'Expert' };

function botName(tier, taken) {
  const pool = BOT_NAMES[tier].filter(n => !taken.includes(n));
  return pool.length ? pick(pool) : BOT_NAMES[tier][0] + ' ' + (taken.length + 1);
}

module.exports = { botBid, botPlay, botName, TIER_NAMES };
