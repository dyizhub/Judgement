// Generates the app's launcher/splash artwork from vector definitions so the
// icon set can be regenerated at any size without binary assets in the repo.
//
//   node scripts/make-icons.js
//
// Suits are drawn as paths rather than text: SVG rasterisers can't be relied on
// to have a font with the suit glyphs.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUT = path.join(__dirname, '..', 'assets', 'images');

const FELT_MID = '#0d3a28';
const FELT_DEEP = '#03120c';
const GOLD = '#c9a44f';
const GOLD_BRIGHT = '#e9cf95';
const CREAM = '#f1ead9';
const CRIMSON = '#b52237';

// Suit paths authored on a 100x100 box, centred on (50,50).
const SPADE =
  'M50 8 C50 8 18 34 18 54 a17 17 0 0 0 28 13 c-1 10-5 17-11 21 h30 c-6-4-10-11-11-21 a17 17 0 0 0 28-13 C82 34 50 8 50 8 Z';
const HEART =
  'M50 88 C50 88 12 60 12 37 A21 21 0 0 1 50 25 A21 21 0 0 1 88 37 C88 60 50 88 50 88 Z';
const DIAMOND = 'M50 8 L86 50 L50 92 L14 50 Z';
const CLUB =
  'M50 12 a17 17 0 0 1 13 28 a17 17 0 1 1-9 27 c-1 8-5 14-10 17 h24 c-5-3-9-9-10-17 a17 17 0 1 1-9-27 A17 17 0 0 1 50 12 Z';

function suit(d, x, y, scale, fill, opacity = 1) {
  return `<g transform="translate(${x} ${y}) scale(${scale}) translate(-50 -50)">
    <path d="${d}" fill="${fill}" opacity="${opacity}"/>
  </g>`;
}

// The launcher icon: felt field, engraved gold frame, spade flanked by the
// other three suits. Square and full-bleed — iOS masks the corners itself and
// rejects icons with transparency.
function iconSvg(size) {
  const s = size;
  const u = s / 1024; // scale factor from the 1024 design grid
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
    <defs>
      <radialGradient id="felt" cx="50%" cy="42%" r="72%">
        <stop offset="0%" stop-color="${FELT_MID}"/>
        <stop offset="60%" stop-color="#071f16"/>
        <stop offset="100%" stop-color="${FELT_DEEP}"/>
      </radialGradient>
      <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${GOLD_BRIGHT}"/>
        <stop offset="100%" stop-color="${GOLD}"/>
      </linearGradient>
    </defs>

    <rect width="${s}" height="${s}" fill="url(#felt)"/>

    <!-- engraved double frame -->
    <rect x="${64 * u}" y="${64 * u}" width="${896 * u}" height="${896 * u}"
          fill="none" stroke="${GOLD}" stroke-opacity="0.55" stroke-width="${6 * u}" rx="${96 * u}"/>
    <rect x="${92 * u}" y="${92 * u}" width="${840 * u}" height="${840 * u}"
          fill="none" stroke="${GOLD}" stroke-opacity="0.25" stroke-width="${3 * u}" rx="${76 * u}"/>

    <!-- hero spade -->
    ${suit(SPADE, 512 * u, 452 * u, 4.6 * u, 'url(#gold)')}

    <!-- supporting suits, heart/diamond in the deck's red -->
    ${suit(HEART, 300 * u, 760 * u, 1.5 * u, CRIMSON, 0.95)}
    ${suit(DIAMOND, 512 * u, 760 * u, 1.5 * u, CRIMSON, 0.95)}
    ${suit(CLUB, 724 * u, 760 * u, 1.5 * u, CREAM, 0.9)}
  </svg>`;
}

// Android's adaptive foreground is masked to a circle and heavily inset — the
// safe zone is only the middle ~66%, so this drops the frame and the suit row.
function adaptiveForegroundSvg(size) {
  const s = size;
  const u = s / 1024;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
    <defs>
      <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${GOLD_BRIGHT}"/>
        <stop offset="100%" stop-color="${GOLD}"/>
      </linearGradient>
    </defs>
    ${suit(SPADE, 512 * u, 512 * u, 3.6 * u, 'url(#gold)')}
  </svg>`;
}

// Splash mark: just the spade, composited by expo-splash-screen over the felt.
function splashSvg(size) {
  const s = size;
  const u = s / 1024;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
    <defs>
      <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${GOLD_BRIGHT}"/>
        <stop offset="100%" stop-color="${GOLD}"/>
      </linearGradient>
    </defs>
    ${suit(SPADE, 512 * u, 512 * u, 5.2 * u, 'url(#gold)')}
  </svg>`;
}

async function writePng(svg, file, { flatten } = {}) {
  let img = sharp(Buffer.from(svg));
  // iOS rejects icons with an alpha channel; flatten those onto the felt.
  if (flatten) img = img.flatten({ background: FELT_DEEP });
  await img.png().toFile(path.join(OUT, file));
  const { width, height, channels } = await sharp(path.join(OUT, file)).metadata();
  console.log(`${file.padEnd(30)} ${width}x${height}  channels=${channels}`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await writePng(iconSvg(1024), 'icon.png', { flatten: true });
  await writePng(adaptiveForegroundSvg(1024), 'android-icon-foreground.png');
  await writePng(splashSvg(1024), 'splash-icon.png');
  await writePng(iconSvg(64), 'favicon.png', { flatten: true });
  // Flat felt plate behind the Android adaptive foreground.
  await sharp({
    create: { width: 1024, height: 1024, channels: 3, background: '#051d14' },
  })
    .png()
    .toFile(path.join(OUT, 'android-icon-background.png'));
  console.log('android-icon-background.png    1024x1024  channels=3');
})();
