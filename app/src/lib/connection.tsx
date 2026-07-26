// GameConnection: owns the WebSocket, the latest server GameState, and the
// reconnect/rejoin lifecycle. Screens read `state` and call `send()`. This ports
// the web client's connection logic (connect → auto-rejoin → reconnect loop)
// to React Native, where WebSocket is a global and AppState signals resume.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, AppStateStatus } from 'react-native';

import { SERVER_URL } from './config';
import type { ClientMessage, GameState, ServerMessage } from './protocol';
import { clearSession, getSession, saveSession, Session } from './session';

interface GameContextValue {
  state: GameState | null;
  connected: boolean;
  error: string | null;
  send: (msg: ClientMessage) => void;
  clearError: () => void;
  create: (name: string) => void;
  join: (code: string, name: string) => void;
  leave: () => void;
}

const GameContext = createContext<GameContextValue | null>(null);

const RECONNECT_MS = 2000;

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GameState | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const explicitCloseRef = useRef(false);
  const sessionRef = useRef<Session | null>(null); // last known {playerId, code, name}
  const pendingNameRef = useRef<string>(''); // name for a create/join awaiting open
  const stateRef = useRef<GameState | null>(null);

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const connect = useCallback(() => {
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
    }
    explicitCloseRef.current = false;
    const ws = new WebSocket(SERVER_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      const s = sessionRef.current;
      if (s?.code && s.playerId) {
        send({ type: 'join', code: s.code, name: s.name || pendingNameRef.current, playerId: s.playerId });
      }
    };

    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (msg.type === 'error') {
        // A failed auto-rejoin (stale room) should drop the saved session so we
        // don't keep trying to rejoin a room that no longer exists.
        if (msg.message === 'Room not found.' && !stateRef.current) {
          sessionRef.current = null;
          void clearSession();
        }
        setError(msg.message);
        return;
      }
      if (msg.type === 'state') {
        const gs = msg.state;
        stateRef.current = gs;
        setState(gs);
        if (gs.youId && gs.code) {
          const s: Session = { playerId: gs.youId, code: gs.code, name: pendingNameRef.current || sessionRef.current?.name || '' };
          sessionRef.current = s;
          void saveSession(s);
        }
      }
    };

    ws.onclose = () => {
      setConnected(false);
      if (explicitCloseRef.current) return;
      // Only surface reconnecting once we actually had a game going.
      if (sessionRef.current && stateRef.current) {
        setError('Connection lost — reconnecting…');
      }
      reconnectRef.current = setTimeout(connect, RECONNECT_MS);
    };

    ws.onerror = () => {
      // onclose will follow and drive the reconnect.
    };
  }, [send]);

  // Connect on mount; tear down on unmount.
  useEffect(() => {
    void (async () => {
      sessionRef.current = await getSession();
      if (sessionRef.current?.name) pendingNameRef.current = sessionRef.current.name;
      connect();
    })();
    return () => {
      explicitCloseRef.current = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  // Reconnect when the app returns to the foreground with a dead socket.
  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (next === 'active') {
        const ws = wsRef.current;
        if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
          connect();
        }
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [connect]);

  const create = useCallback((name: string) => {
    pendingNameRef.current = name;
    setError(null);
    send({ type: 'create', name });
  }, [send]);

  const join = useCallback((code: string, name: string) => {
    pendingNameRef.current = name;
    setError(null);
    send({ type: 'join', code: code.toUpperCase(), name });
  }, [send]);

  const leave = useCallback(() => {
    sessionRef.current = null;
    stateRef.current = null;
    void clearSession();
    setState(null);
    setError(null);
    // Bounce the socket so the server drops us from the room.
    explicitCloseRef.current = true;
    wsRef.current?.close();
    connect();
  }, [connect]);

  const clearError = useCallback(() => setError(null), []);

  const value = useMemo<GameContextValue>(
    () => ({ state, connected, error, send, clearError, create, join, leave }),
    [state, connected, error, send, clearError, create, join, leave],
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used within a GameProvider');
  return ctx;
}
