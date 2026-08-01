// Card primitives shared by every game engine.

const crypto = require('crypto');

const SUITS = ['H', 'C', 'S', 'D'];
const SUIT_NAMES = { H: 'Hearts', C: 'Clubs', S: 'Spades', D: 'Diamonds' };

// Ranks 2..14 (11=J, 12=Q, 13=K, 14=A).
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

function cardEq(a, b) {
  return !!a && !!b && a.suit === b.suit && a.rank === b.rank;
}

// Sort into suit groups, high rank first within a suit — the layout players
// expect when they pick up a hand.
function sortHand(hand) {
  return hand.sort((a, b) =>
    a.suit === b.suit ? b.rank - a.rank : SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit),
  );
}

// Draws `count` cards without replacement, weighting one suit `weight`x more
// likely than the others. Only used by dev mode.
function weightedDrawSuitBiased(deck, count, suit, weight) {
  const pool = deck.slice();
  const hand = [];
  for (let k = 0; k < count && pool.length; k++) {
    const weights = pool.map(c => (c.suit === suit ? weight : 1));
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

module.exports = { SUITS, SUIT_NAMES, makeDeck, shuffle, cardEq, sortHand, weightedDrawSuitBiased };
