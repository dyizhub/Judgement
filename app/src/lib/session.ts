// Persisted session for rejoin-after-drop. Mobile OSes kill sockets when the app
// backgrounds; storing {playerId, code, name} lets us silently rejoin the same
// seat on resume — the same model the web client uses via localStorage.

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'judgement_session';

export interface Session {
  playerId: string;
  code: string;
  name: string;
}

export async function getSession(): Promise<Session | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export async function saveSession(s: Session): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // best-effort; a failed save just means no auto-rejoin
  }
}

export async function clearSession(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
