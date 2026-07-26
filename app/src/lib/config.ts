// Server endpoint.
//
// Web mode: derive from the host that served the page, so whatever LAN IP the
// app is loaded from, the game socket connects to that same host:3000. This
// makes the app immune to the dev machine's DHCP address drifting.
//
// Native mode (no window.location): use EXPO_PUBLIC_SERVER_URL if set, else the
// DEFAULT_SERVER below. Phase 0's cloud deploy swaps DEFAULT_SERVER for the
// hosted wss:// domain and this whole problem goes away.

const DEFAULT_SERVER = 'ws://192.168.68.55:3000';

function deriveFromPage(): string | null {
  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.hostname}:3000`;
  }
  return null;
}

export const SERVER_URL =
  process.env.EXPO_PUBLIC_SERVER_URL && process.env.EXPO_PUBLIC_SERVER_URL.length > 0
    ? process.env.EXPO_PUBLIC_SERVER_URL
    : deriveFromPage() ?? DEFAULT_SERVER;
