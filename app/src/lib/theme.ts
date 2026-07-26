// "Private Salon" palette — ported from the web client's style.css :root vars so
// the app and web version read as the same product.

export const colors = {
  felt950: '#030f0a',
  felt900: '#051d14',
  felt800: '#082a1d',
  felt700: '#0d3a28',
  felt600: '#124732',

  goldDeep: '#8a6d2f',
  gold: '#c9a44f',
  goldBright: '#e9cf95',
  goldHairline: 'rgba(201, 164, 79, 0.35)',
  goldHairlineSoft: 'rgba(201, 164, 79, 0.18)',

  cream: '#f1ead9',
  creamDim: '#b7ac92',
  paper: '#faf7ee',
  paperShade: '#ece5d2',
  ink: '#201d18',
  suitRed: '#b52237',
  suitRedBright: '#e0596d',

  panelTop: 'rgba(13, 42, 30, 0.92)',
  panelBot: 'rgba(5, 22, 15, 0.96)',

  danger: '#e98a8a',
} as const;

export const radius = {
  lg: 14,
  md: 9,
  sm: 5,
} as const;

export const fonts = {
  // System serif — Palatino-family on iOS, serif fallback on Android.
  serif: 'Palatino',
} as const;

// Tier badge colors, matching the web .badge-tier-N styles.
export const tierColors: Record<number, { fg: string; border: string; bg: string }> = {
  1: { fg: '#9fcf9a', border: 'rgba(122, 187, 110, 0.45)', bg: 'rgba(90, 140, 80, 0.14)' },
  2: { fg: '#9fc0e2', border: 'rgba(110, 155, 200, 0.45)', bg: 'rgba(70, 110, 150, 0.14)' },
  3: { fg: '#e2b585', border: 'rgba(200, 140, 80, 0.45)', bg: 'rgba(150, 95, 45, 0.14)' },
  4: { fg: '#eda3a3', border: 'rgba(201, 164, 79, 0.6)', bg: 'rgba(181, 34, 55, 0.18)' },
};
