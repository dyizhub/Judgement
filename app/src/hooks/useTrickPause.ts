import { useEffect, useRef, useState } from 'react';

import type { GameState, TrickEntry } from '@/lib/protocol';

const PAUSE_MS = 1600;

interface TrickView {
  trick: TrickEntry[];
  winnerIdx: number | null; // set while showing a completed trick
  winnerName: string | null;
}

// When a trick completes, the server immediately clears `trick` and sets
// `lastTrick`. Showing that instantly would make the winning card vanish before
// anyone sees it — so hold the completed trick on the table for a beat with a
// winner banner, then fall through to the live state. Mirrors the web client.
export function useTrickPause(state: GameState | null): TrickView {
  const [held, setHeld] = useState<TrickView | null>(null);
  const lastKeyRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!state) return;
    const lt = state.lastTrick;
    const key = lt ? JSON.stringify(lt) : null;

    // A newly-completed trick: hold it briefly.
    if (key && key !== lastKeyRef.current && state.trick.length === 0) {
      lastKeyRef.current = key;
      setHeld({
        trick: lt!.trick,
        winnerIdx: lt!.winnerIdx,
        winnerName: state.players[lt!.winnerIdx]?.name ?? null,
      });
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setHeld(null);
      }, PAUSE_MS);
    } else if (key !== lastKeyRef.current) {
      lastKeyRef.current = key;
    }

    // A new card landing means the next trick is already underway — drop the hold.
    if (state.trick.length > 0 && held) {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      setHeld(null);
    }
  }, [state, held]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  if (held) return held;
  return { trick: state?.trick ?? [], winnerIdx: null, winnerName: null };
}
