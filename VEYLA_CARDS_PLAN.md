# Veyla Cards — Platform Plan

Turning the single-game Judgement app into **Veyla Cards**: a collection of
classic card games, online multiplayer, with player accounts and stats.

Veyla is the intended company name — the bundle ID and branding are chosen so
other Veyla products can sit beside this one.

## Decisions locked (2026-07-27)

| Decision | Choice |
|---|---|
| App name | Veyla Cards |
| Bundle ID | `com.veyla.cards` (permanent — set before first publish) |
| Judgement submission | **Held.** Rebrand first, then submit once. |
| Poker | **Excluded.** Keeps the app 4+ and avoids gambling review scrutiny. |
| Accounts | Yes — profiles, stats, friends. Requires a database + auth. |
| Game count | ~8 at launch |

### Why Poker is out
Apple treats poker as gambling-adjacent even with play money: the whole app
would jump to 17+, several regions restrict distribution, and review gets
stricter. Excluding it keeps Veyla Cards rated 4+ and available everywhere —
worth more than one game.

*(Related: real-money Rummy is regulated in India. We are play-money only, which
is fine, but never add stakes without legal advice.)*

## Game lineup

Chosen so 8 games need **3 engine families**, not 8 engines. Each family shares
turn flow, legality checks, and most UI.

### Family A — Trick-taking (Judgement's engine generalised)
| Game | Notes | Effort |
|---|---|---|
| **Judgement** | Already built and shipped | done |
| **Callbreak** | Huge in India/Nepal. Spades-like, 5 rounds, trump always ♠ | small |
| **Spades** | Partnership bidding, sandbagging rules | small |
| **Hearts** | Avoidance scoring, passing phase, shooting the moon | medium |

### Family B — Draw & meld
| Game | Notes | Effort |
|---|---|---|
| **Indian Rummy** | 13 cards, sequences + sets, jokers, drop rule | large |
| **Gin Rummy** | 2-player, knocking, deadwood | medium |

### Family C — Shedding
| Game | Notes | Effort |
|---|---|---|
| **Crazy Eights** | Public domain (do **not** clone UNO — trademarked) | small |
| **Bhabhi** | Popular Indian shedding game, simple rules | small |

Optional later: **Solitaire** — single-player, no server needed, and the only
game playable while the server cold-starts or with no friends online.

## Architecture

### Today
`server.js` is Judgement-specific: room management, connection handling, bot
scheduling, and Judgement's rules are all interleaved in one file.

### Target
```
veyla-cards/
├── server/
│   ├── core/            # game-agnostic
│   │   ├── rooms.js         # create/join/rejoin, room GC
│   │   ├── connections.js   # ws lifecycle, reconnect, auth handshake
│   │   ├── turns.js         # turn timers, auto-act on stall
│   │   ├── bots.js          # generic bot scheduler (delegates to engine)
│   │   └── deck.js          # deck, shuffle, dealing helpers
│   ├── engines/
│   │   ├── index.js         # registry: id -> engine
│   │   ├── judgement/       # migrated from today's server.js
│   │   ├── callbreak/
│   │   ├── spades/
│   │   ├── hearts/
│   │   ├── rummy/
│   │   ├── ginrummy/
│   │   ├── crazyeights/
│   │   └── bhabhi/
│   └── server.js        # http + ws wiring only
├── app/                 # Expo client
│   ├── src/games/       # per-game screens, mirroring engines/
│   ├── src/components/  # shared Card, Hand, Seat, Scoreboard, Trick
│   └── src/lib/         # protocol, connection, auth, theme
└── public/              # web client
```

### The engine interface
Every game implements the same contract. The core never knows a game's rules.

```js
{
  meta: { id, name, minPlayers, maxPlayers, family, blurb },

  // Fresh state for a table of `players`.
  createState(players, options),

  // Apply an intent. Returns { state, error }. Pure — no I/O, no sockets.
  applyAction(state, playerIdx, action),

  // Redact state for one seat (never leak other players' hands).
  viewFor(state, playerIdx),

  // What this seat may legally do right now — drives UI affordances and
  // the stall-timeout auto-action.
  legalActions(state, playerIdx),

  // Bot move for a difficulty tier.
  botAction(state, playerIdx, difficulty),

  isFinished(state),
  results(state),   // final standings, for stats
}
```

**Why this shape:** `applyAction` being pure means engines are unit-testable
without a server or sockets — the thing that made Judgement's rules verifiable.
`viewFor` centralises hand-hiding, so a new game can't accidentally leak cards
(the bug class that dev-mode's `opponentHands` deliberately exploits).
`legalActions` lets the existing stall-timeout logic work for every game for
free, instead of each engine reinventing it.

### Client
- `src/games/<id>/` exports `{ Table, ActionBar }`, chosen from a registry by
  the room's `gameId`.
- Home becomes a **game picker**; lobby gains a game selector.
- Shared primitives (Card, Hand, Seat, Scoreboard, TrickArea) already exist from
  Judgement and carry over unchanged.

## Accounts & persistence

Currently: no accounts, no database, no PII. Adding profiles/stats/friends is
the single biggest change in this plan — it introduces a database, auth, and
real legal obligations.

**Recommended: Supabase** (free tier) — Postgres + auth in one, supports Sign in
with Apple, and doesn't require running our own auth server. The realtime game
socket stays on Render; Supabase is only for identity and persistence.

### Data model (first cut)
```
profiles      id (uuid, = auth user), display_name, avatar_id, created_at
game_results  id, game_id, room_code, finished_at, duration_s
result_seats  game_result_id, profile_id (nullable for guests), seat_idx,
              score, placement, was_bot
friendships   requester_id, addressee_id, status, created_at
stats         (materialised view) profile_id, game_id, played, won,
              avg_placement, best_score
```

Guests stay first-class: you can still join with just a name and no account.
Their results are recorded with `profile_id = null` so a table with one guest
still produces stats for the signed-in players.

### Auth flow
1. App gets a Supabase session (Sign in with Apple, or stays a guest).
2. Client sends the JWT on socket connect.
3. Game server verifies it against Supabase's public key, attaches `profileId`
   to the player.
4. On game end, server writes results.

### Apple requirements this triggers
- **Sign in with Apple is mandatory** if any third-party login (Google etc.) is
  offered. Simplest compliant path: Apple only, plus guest.
- **In-app account deletion is mandatory** — not just "email us". Needs a real
  delete flow that removes the profile and anonymises past results.
- **Privacy policy must be rewritten** — it currently says "no accounts, no
  persistent profiles", which stops being true.
- **App Privacy questionnaire changes** — you'd now collect an identifier and
  (via Apple) possibly an email.

## Migration path

Ordered so the abstraction is proven against a known-good game before any new
game depends on it.

**Phase 1 — Rebrand + restructure (no new games)**
1. Rename repo/dir to `veyla-cards`; bundle ID → `com.veyla.cards`.
2. New app name, icon, splash. Judgement's spade icon becomes the Veyla mark or
   is replaced with a suit-cluster.
3. Extract `server/core/*` from today's `server.js`; move Judgement's rules into
   `engines/judgement/` behind the interface.
4. Regression-test Judgement to parity — the existing bot/scoring/dealer-screw
   tests must pass unchanged against the refactored server.
5. Client: add the game registry and picker with Judgement as the only entry.

*Milestone: Veyla Cards ships with one game, identical behaviour, correct
branding and bundle ID. Shippable.*

**Phase 2 — Accounts**
6. Supabase project, schema, RLS policies.
7. Sign in with Apple + guest mode; account deletion flow.
8. Server-side JWT verification; write `game_results` on finish.
9. Profile + stats screens.
10. Rewrite privacy policy; update App Privacy answers.

**Phase 3 — Trick-taking family (fast wins)**
11. Callbreak, then Spades, then Hearts. Each mostly reuses Judgement's UI.

**Phase 4 — Shedding family**
12. Crazy Eights, Bhabhi.

**Phase 5 — Meld family (hardest)**
13. Gin Rummy (2-player, simpler) before Indian Rummy (13-card, jokers, drop).

**Phase 6 — Polish & launch**
14. Per-game tutorials/rules screens, sounds, richer animations.
15. Store listing, screenshots per game, launch.

## Scope reality

Shipping all 8 games + accounts before *any* release means a long stretch with
nothing live and no feedback. Two options:

- **Ship Phase 1 first** (recommended) — Veyla Cards live within about a week
  with Judgement, then games arrive as free updates. Each update is an App Store
  feature opportunity, and real players shape what gets built next.
- **Hold until full lineup** — a bigger launch, but realistically a couple of
  months of building blind.

Either way the architecture is identical; this only changes *when* you publish.

## Risks
- **Rummy is the long pole.** Meld validation, jokers, and the drop rule are
  genuinely intricate. Budget for it and build Gin Rummy first as a warm-up.
- **Accounts add permanent obligations** (deletion, privacy, support burden). If
  stats aren't core to the pitch, staying stateless is dramatically cheaper.
- **Render free tier sleeps.** With 8 games and more players, the cold start
  becomes a worse first impression. A paid instance or keep-warm ping is likely
  needed by launch.
- **Bots for 8 games.** Each engine needs its own bot logic; a bad bot is worse
  than no bot. Consider launching some games as multiplayer-only.

## Open questions
1. Ship Phase 1 immediately, or hold for the full lineup?
2. Is the current felt-and-gold theme the Veyla brand, or should the identity be
   redesigned now that it's a company?
3. Monetisation later? (Affects whether accounts need billing/receipts.)
