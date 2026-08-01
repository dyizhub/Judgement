// Game registry. Adding a game means implementing the engine contract and
// listing it here — the core server needs no changes.
//
// Engine contract (see engines/judgement for the reference implementation):
//   meta                              { id, name, family, minPlayers, maxPlayers, blurb }
//   createState(ctx)                  -> game state for a fresh table
//   applyAction(gs, ctx, idx, action) -> error string | null   (mutates gs)
//   viewFor(gs, ctx, idx)             -> fields merged into that seat's client state
//   currentActor(gs)                  -> seat the game is waiting on, or null
//   pendingHostAction(gs)             -> action the host must take, or null
//   autoAction(gs, idx)               -> minimal legal move for a stalled seat
//   botAction(gs, ctx, idx, tier)     -> a bot's move
//   isFinished(gs) / results(gs, ctx)
//
// ctx is { players } — engines read isBot / difficulty / isDev / id / name and
// never touch sockets, so an engine can be driven entirely from a test.

const judgement = require('./judgement');
const callbreak = require('./callbreak');

const ENGINES = {
  [judgement.meta.id]: judgement,
  [callbreak.meta.id]: callbreak,
};

function getEngine(gameId) {
  return ENGINES[gameId] || null;
}

function listGames() {
  return Object.values(ENGINES).map(e => e.meta);
}

module.exports = { getEngine, listGames, DEFAULT_GAME_ID: judgement.meta.id };
