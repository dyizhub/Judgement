// Wire protocol shared with server.js. The server is authoritative for all game
// rules — the app only renders GameState snapshots and sends intents. Keep these
// types in exact sync with server.js's sendState() and handleMessage().

export type Suit = 'H' | 'C' | 'S' | 'D';

export interface Card {
  suit: Suit;
  rank: number; // 2..14 (11=J, 12=Q, 13=K, 14=A)
}

export type Phase = 'lobby' | 'bidding' | 'playing' | 'roundEnd' | 'gameEnd';

export interface Player {
  name: string;
  id: string;
  connected: boolean;
  isBot: boolean;
  difficulty?: 1 | 2 | 3 | 4;
}

export interface TrickEntry {
  playerIdx: number;
  card: Card;
}

export interface LastTrick {
  trick: TrickEntry[];
  winnerIdx: number;
}

export interface RoundResult {
  bid: number;
  won: number;
  delta: number;
}

// The full per-player state snapshot pushed by the server on every transition.
export interface GameState {
  code: string;
  phase: Phase;
  youIdx: number;
  youId: string;
  hostId: string;
  players: Player[];
  round: number; // 1-based; 0 while in lobby
  totalRounds: number;
  trump: Suit | null;
  dealerIdx: number;
  hand: Card[]; // your own cards, sorted
  handCounts: number[]; // cards left per player index
  bids: (number | null)[];
  tricksWon: number[];
  scores: number[]; // cumulative
  scoreHistory: RoundResult[][]; // one array per completed round
  trick: TrickEntry[]; // current trick, first entry led
  lastTrick: LastTrick | null;
  turnIdx: number | null;
  forbiddenBid: number | null; // "screw the dealer": the bid you may not make
  opponentHands: Card[][] | null; // dev mode only; null for everyone else
}

// ---------- Client → server ----------

export type ClientMessage =
  | { type: 'create'; name: string }
  | { type: 'join'; code: string; name: string; playerId?: string }
  | { type: 'start' }
  | { type: 'bid'; bid: number }
  | { type: 'play'; card: Card }
  | { type: 'nextRound' }
  | { type: 'playAgain' }
  | { type: 'addBot'; difficulty: 1 | 2 | 3 | 4 }
  | { type: 'removeBot'; playerId: string };

// ---------- Server → client ----------

export type ServerMessage =
  | { type: 'state'; state: GameState }
  | { type: 'error'; message: string };

// ---------- Shared display helpers ----------

export const SUIT_SYMBOL: Record<Suit, string> = { H: '♥', D: '♦', C: '♣', S: '♠' };
export const SUIT_IS_RED: Record<Suit, boolean> = { H: true, D: true, C: false, S: false };
const RANK_LABEL: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

export function rankLabel(rank: number): string {
  return RANK_LABEL[rank] ?? String(rank);
}

export const TIER_LABEL: Record<number, string> = { 1: 'Easy', 2: 'Medium', 3: 'Hard', 4: 'Expert' };

// 1-indexed turn order for a seat this round: dealer's left is seat 1.
export function turnOrderOf(idx: number, n: number, dealerIdx: number): number {
  return ((idx - (dealerIdx + 1) + n) % n) + 1;
}

export function cardEq(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

// Legal plays given the current trick (follow-suit rule) — mirrors the server's
// enforcement so the UI can pre-mark illegal cards.
export function legalPlays(hand: Card[], trick: TrickEntry[]): Card[] {
  if (trick.length === 0) return hand;
  const led = trick[0].card.suit;
  const follow = hand.filter((c) => c.suit === led);
  return follow.length ? follow : hand;
}
