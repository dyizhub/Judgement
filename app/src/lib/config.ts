// Server endpoint.
//
// Native builds talk to the deployed server. Web builds derive from whatever
// host served the page, so a LAN dev session keeps working without hardcoding
// a DHCP address that drifts.
//
// Override either with EXPO_PUBLIC_SERVER_URL.

const DEFAULT_SERVER = 'wss://judgement-jbhn.onrender.com';

function deriveFromPage(): string | null {
  if (typeof window === 'undefined' || !window.location?.hostname) return null;
  const { protocol, hostname, host } = window.location;

  // Served over TLS (i.e. the deployed site): the game socket is same-origin.
  if (protocol === 'https:') return `wss://${host}`;

  // Local dev: Metro serves the page on :8081 while the game server is on :3000.
  const isLocal =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    /^192\.168\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
  if (isLocal) return `ws://${hostname}:3000`;

  return null; // unknown http host — fall back to the deployed server
}

export const SERVER_URL =
  process.env.EXPO_PUBLIC_SERVER_URL && process.env.EXPO_PUBLIC_SERVER_URL.length > 0
    ? process.env.EXPO_PUBLIC_SERVER_URL
    : deriveFromPage() ?? DEFAULT_SERVER;
