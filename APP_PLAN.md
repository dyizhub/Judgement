# Judgement — Mobile App Plan

Target: cross-platform mobile app (iOS + Android via React Native + Expo), cloud-hosted server, App Store + Play Store distribution. Web client stays alive as a free bonus.

## Architecture

```
judgement/
├── server/            # existing Node + ws server, deployed to cloud
│   ├── server.js      # unchanged game logic (rules, rooms, dealer-screw)
│   ├── bots.js        # unchanged bot AI
│   └── public/        # existing web client — keeps working, free web version
├── app/               # NEW: Expo app (TypeScript)
│   ├── app/           # expo-router screens: index (home), lobby, game
│   ├── components/    # Card, Seat, TrickArea, BidSheet, ScoreSheet, Hand
│   ├── lib/
│   │   ├── ws.ts      # socket client: connect/reconnect/session (AsyncStorage)
│   │   └── protocol.ts# typed message + state definitions
│   └── theme.ts       # felt/gold palette ported from style.css vars
└── shared/            # (optional) constants both sides import: trump order, scoring
```

**Key principle: the server stays authoritative.** The app never computes game rules — it renders `state` snapshots and sends `{bid}` / `{play}` intents, identical to the web client. Same protocol, so web + app players can share a table.

## Line of action

### Phase 0 — Server to cloud (small, do first)
- Pre-deploy hardening — **DONE & tested (2026-07-21):**
  - [x] Room TTL/GC: rooms idle > 2h dropped by a 5-min sweep (`ROOM_TTL_MS`, `.unref()`d interval).
  - [x] `/health` endpoint → `{status, rooms, uptime}` JSON.
  - [x] Turn timer: auto-acts a legal move for a stalled human (90s present / 12s disconnected) AND auto-advances a stalled round-end scoreboard (120s present host / 15s disconnected). Durations env-overridable. Verified: silent human completes a full game via 68 auto-acts; hard mid-game disconnect survives; normal prompt play unaffected.
- **Deploy config written & validated (2026-07-22):** host = **Fly.io**. `Dockerfile` (node:24-alpine, `npm ci --omit=dev`, validated against lockfile), `.dockerignore` (excludes the Expo app, logs, backups), `fly.toml` (internal_port 3000, force_https so `wss://` works, `/health` check, auto-stop/auto-start machines, 256mb shared VM), `.gitignore`.
- [x] **Dev mode stripped from production**: gated behind `ENABLE_DEV_MODE=1`, which is never set on Fly. Verified both ways — without the flag the server does not emit `opponentHands` at all; with it, local play still works.
- **Still to do (needs your account — install/auth/deploy are yours to run):**
  - `flyctl` install + `fly auth login` + `fly launch`/`fly deploy` (not installed on this machine; no Docker needed, Fly builds remotely).
  - Pick a real Fly region in `fly.toml` (`primary_region`, currently `bom`) and a globally-unique app name.
  - After deploy: web client needs no change (it derives the socket URL from the page host); update `app/src/lib/config.ts` `DEFAULT_SERVER` to `wss://<app>.fly.dev` for native builds.

### Phase 1 — Expo scaffold + protocol layer — **DONE (2026-07-22)**
- [x] Expo SDK 57 app scaffolded at `judgement/app/` (expo-router, TS, RN 0.86, React 19, reanimated 4.5 bundled). Demo scaffold stripped.
- [x] `src/lib/protocol.ts` — every server message + full GameState typed, transcribed exactly from server.js sendState(). Plus shared helpers (legalPlays, turnOrderOf, cardEq, suit/rank labels).
- [x] `src/lib/connection.tsx` — GameProvider context: WebSocket, auto-reconnect (2s), auto-rejoin via AsyncStorage session, AppState resume-reconnect. `useGame()` hook exposes state/send/create/join/leave.
- [x] `src/lib/session.ts` (AsyncStorage), `src/lib/theme.ts` (Private Salon palette ported), `src/lib/config.ts` (SERVER_URL, currently LAN, swap for cloud later).
- Verified: `tsc --noEmit` clean + full `expo export` iOS bundle (3.6MB) builds with zero errors (Metro resolves everything incl. `@/` alias).

### Phase 2 — Screens — **STARTED (2026-07-22)**
- [x] HomeScreen (name, create/join), LobbyScreen (players, host/bot badges, segmented tier picker, add/remove bot, start gating), functional GameScreen (all phases: bid buttons w/ forbidden-bid disable, tap-to-play w/ follow-suit dimming, trick area, round/game-end scoreboard w/ host next/play-again). Plain-styled — playable, not yet polished.
- [x] Card component (pure RN, trump gold framing).
- Verified end-to-end in web mode (Expo Go can't run SDK 57 yet): create → lobby → bots → bid (dealer-screw restriction live) → play → correct scaled scoring → next round w/ trump+dealer rotation.

### Phase 4 — Polish — **IN PROGRESS (2026-07-22)**
- [x] Felt background: react-native-svg radial gradient + vignette, ported from web `body`. Applied behind all screens.
- [x] **Fixed:** react-navigation's DefaultTheme was painting an opaque light-gray (rgb 242,242,242) over the felt — wrapped Stack in ThemeProvider with transparent background/card.
- [x] **Fixed:** LAN IP drift broke the app's hardcoded server URL. Web mode now derives the server from `window.location.hostname`, so it always connects to whatever host served the page. Native keeps EXPO_PUBLIC_SERVER_URL / DEFAULT_SERVER fallback.
- [x] Animations (reanimated 4.5): active-seat breathing glow, card deal-in fan, trick card entrance, winner highlight, "your turn" pulse, bid bar entrance.
- [x] **Trick pause + winner banner** — was a real gameplay gap: completed tricks vanished instantly. Now holds 1.6s with an "X wins the trick" banner (`useTrickPause`), matching web.
- [x] Haptics (turn start, card/bid tap, trick win — heavier when you win) + keep-awake during play.
- [x] Layout bugs found via user's on-device screenshots + fixed (2026-07-22):
  - Trick cards pinned to top of felt — wrapped flex lines default `alignContent: flex-start`; set to `center`.
  - Winner banner overlapped the cards (consequence of the above).
  - Scoreboard was nested inside the trick area, dimming the cards behind it and sitting off-centre — moved to a screen-level overlay (verified: panel centre 406 == viewport centre).
  - Hand left-aligned instead of centred — `flexGrow: 1` + `justifyContent: center` on the ScrollView content (verified: span centre 188 ≈ viewport centre 187.5).
  - Table oval collapsed to 2px — percentage `top`/`bottom` insets don't resolve in RN absolute layout; switched to percentage width/height.
- [x] Engraved table oval on the felt (fills the dead centre space during bidding).
- TODO next: richer card faces (corner pips), scoreboard ledger styling, lobby/home polish parity.

### Phase 2 — Screens, static render
- Home (name, create/join), Lobby (players, bot controls, tier badges), Game (table, seats, trick area, hand, top bar).
- Render straight from snapshots — no animations yet.
- Test harness = bot games (1 human + 2 bots), same as every web verification so far.
- Milestone: full 10-round game playable, ugly but correct.

### Phase 3 — Interactions + rules UX
- Bid sheet (bottom sheet, forbidden bid disabled), card tap-to-play, follow-suit legality dimming (filter-equivalent: opacity on a non-overlapping layout, or darkened overlay per card), trick pause + winner banner, auto-open/auto-close scoreboard, toasts.
- Milestone: feature parity with web client.

### Phase 4 — Polish (what justifies the rewrite)
- react-native-reanimated: card play ceremony, deal animation, seat pulse.
- expo-haptics: on your turn, on trick win.
- Portrait lock, safe areas, keep-awake during game (expo-keep-awake).
- Theme port: felt gradients (expo-linear-gradient), gold system, Palatino-equivalent serif (system serif or bundled font — bundling is allowed in RN, unlike the web CSP constraint).

### Phase 5 — Store shipping
- Accounts: Apple Developer $99/yr, Google Play $25 once.
- EAS Build + Submit (same pipeline as Vela).
- Assets: icon, splash, screenshots (store requires per-device sizes).
- Android internal testing track + TestFlight first; then review.
- Review risk: low — free multiplayer card game, no gambling/money. Needs a privacy policy URL (trivial: no accounts, no data collected beyond display name).

## What carries over vs. gets rebuilt

| Carries over (as-is) | Rebuilt (RN) |
|---|---|
| server.js — all rules | Every screen/component |
| bots.js — all AI | Card visuals (Views/Text or SVG) |
| ws protocol + state shape | Animations (CSS → reanimated) |
| Rejoin/session model | localStorage → AsyncStorage |
| Web client (stays as web version) | Seat layout (ellipse math ports directly) |

## Open questions (decide during Phase 0)
1. **Dev mode on a public server**: invisible-char + name grants x-ray. On a public cloud server anyone who discovers it (or is named Adi!) can cheat, and a hidden cheat in a store app is a bad look if found. Recommend: gate behind an env-var secret suffix, or strip from production.
2. Room codes are 4 chars — fine for friends; public server may want 5 to reduce collisions/guessing.
3. Turn timer length / policy (e.g., 45s then auto-play lowest legal card? or host-kick button only?).

## Suggested working method
Fable plans + reviews each phase; sonnet subagents execute well-scoped chunks (screens, components) against the typed protocol contract — same split that worked for the web client. Phases 0–1 are foundation and worth doing carefully; 2–3 parallelize well across agents.
