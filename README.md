# Judgement

Online multiplayer Judgement (trick-taking card game). Node + WebSocket server, vanilla JS client.

## Run

```
npm install
npm start
```

Open http://localhost:3000 — create a room, share the 4-letter code, friends join from their devices. To play over the internet, host it (Railway/Render/Fly) or tunnel (e.g. `npx localtunnel --port 3000`).

## Rules (as implemented)

- 3–5 players.
- 10 rounds: round N deals N cards each (1 → 10).
- Trump rotation: rounds 1–4 → ♥ ♣ ♠ ♦, rounds 5–6 → no trump, rounds 7–10 → ♦ ♠ ♣ ♥.
- Each round: players bid how many tricks they'll take (0 to N), then play. Must follow led suit if able; highest trump wins, else highest card of led suit.
- Scoring: exact bid → `bid × 10 + 10` points (bid 0 made = 10). Missed bid → `-10 × |bid − won|` (off by 1 = −10, off by 2 = −20, etc).
- Dealer rotates each round; bidding and first lead start left of dealer; trick winner leads next.
- "Screw the dealer": the last player to bid in a round may not bid the exact number that would make all bids sum to the tricks available — that value's button is disabled for humans, and bots avoid it.

## Bots

The host can add bots in the lobby (any mix, up to 5 seats total; bots count toward the 3-player minimum, so 1 human + 2 bots works). Four difficulty tiers:

1. **Easy** — random bids and plays
2. **Medium** — honor-count bidding; plays high when chasing tricks, low when avoiding
3. **Hard** — position-aware: wins with the cheapest sufficient card when acting last, safely dumps dangerous cards when avoiding
4. **Expert** — adds card memory (sure-winner detection), trump management, and reads the table's bids before bidding

Bot AI lives in `bots.js`. Set `BOT_FAST=1` to make bots act instantly (testing).

## Structure

- `server.js` — game logic + rooms + static file server (only dep: `ws`)
- `public/index.html`, `public/style.css`, `public/client.js` — client

Players who drop mid-game can rejoin with the same browser (session in localStorage).

Works on mobile browsers (Safari/Chrome): responsive layout kicks in ≤640px — opponent plaques become a compact top row, the hand auto-compresses to fit, and overlays/scoreboard adapt to the screen.
