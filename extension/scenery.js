// Time-of-day hero art. KEEP IN SYNC with app/js/scenery.js (npm test checks they are identical).

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;
const HOUR = 3600000;

// Sunrise and sunset from the standard solar equations (the same approach SunCalc uses).
export function sunTimes(date, lat, lon) {
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const d = date.valueOf() / DAY_MS - 0.5 + J1970 - J2000;
  const n = Math.round(d - 0.0009 - lw / (2 * Math.PI));
  const ds = 0.0009 + lw / (2 * Math.PI) + n;
  const M = RAD * (357.5291 + 0.98560028 * ds);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(L) * Math.sin(OBLIQUITY));
  const noon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const cosW = (Math.sin(RAD * -0.833) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosW < -1 || cosW > 1) return null; // polar day or polar night
  const w = Math.acos(cosW);
  const set = J2000 + 0.0009 + (w + lw) / (2 * Math.PI) + n + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const rise = noon - (set - noon);
  const toDate = (j) => new Date((j + 0.5 - J1970) * DAY_MS);
  return { sunrise: toDate(rise), sunset: toDate(set) };
}

export function dayPhase(now = new Date(), sun = null) {
  if (sun) {
    const t = now.valueOf();
    const rise = sun.sunrise.valueOf();
    const set = sun.sunset.valueOf();
    if (t < rise - 0.5 * HOUR || t > set + 0.75 * HOUR) return 'night';
    if (t < rise + HOUR) return 'dawn';
    if (t > set) return 'dusk';
    if (t > set - HOUR) return 'golden';
    return 'day';
  }
  const h = now.getHours() + now.getMinutes() / 60;
  if (h < 5.5 || h >= 20.5) return 'night';
  if (h < 8) return 'dawn';
  if (h < 17) return 'day';
  if (h < 18.5) return 'golden';
  return 'dusk';
}

const NORTH_SEASONS = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];
const FLIP = { winter: 'summer', summer: 'winter', spring: 'autumn', autumn: 'spring' };

export const seasonOf = (lat, date = new Date()) => {
  const s = NORTH_SEASONS[date.getMonth()];
  return lat < 0 ? FLIP[s] : s;
};

export function greeting(phase, now = new Date()) {
  switch (phase) {
    case 'dawn': return 'Good morning. It’s quiet out.';
    case 'day': return now.getHours() < 12 ? 'Good morning. It’s bright out.' : 'Good afternoon. Daylight’s waiting.';
    case 'golden': return 'Golden hour is close.';
    case 'dusk': return 'The sky is putting on a show.';
    default: return 'It’s dark out. Short walks still count.';
  }
}

const fmtTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDuration = (ms) => {
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
};

export function daylightLine(now, sun) {
  if (!sun) return '';
  if (now < sun.sunrise) return `Sunrise at ${fmtTime(sun.sunrise)}`;
  if (now < sun.sunset) return `${fmtDuration(sun.sunset - now)} of daylight left · sunset ${fmtTime(sun.sunset)}`;
  return `Sunset was at ${fmtTime(sun.sunset)}. Stick to lit paths.`;
}

// ---------- art ----------

const SKY = {
  dawn: ['#f2b8a0', '#fbe6cf'],
  day: ['#86c1e6', '#e2f2f8'],
  golden: ['#f29c50', '#fbe2ad'],
  dusk: ['#4f4577', '#e6876a'],
  night: ['#0b1626', '#233457'],
};
const LAND = {
  dawn: ['#c7a58c', '#93876a', '#5f7448'],
  day: ['#a8cba0', '#78ab6f', '#4c8a4b'],
  golden: ['#cf9f68', '#998f55', '#5b7840'],
  dusk: ['#5e5272', '#45465f', '#2b3a35'],
  night: ['#1c283b', '#152035', '#0d1820'],
};
const LEAVES = {
  spring: ['#8fcf7a', '#f0b3c3', '#6dbb5e'],
  summer: ['#4c974c', '#3a8544', '#67b058'],
  autumn: ['#e2782c', '#c4432a', '#e9b23a'],
  winter: ['#3d6a52', '#577d68', '#dfe8ea'],
};
const SHADE = { dawn: 0.1, day: 0, golden: 0.08, dusk: 0.4, night: 0.65 };
const SUN = {
  dawn: { x: 84, y: 76, r: 14, c: '#fff1c9' },
  day: { x: 318, y: 34, r: 15, c: '#fff7d6' },
  golden: { x: 300, y: 70, r: 17, c: '#ffe1a1' },
  dusk: { x: 330, y: 92, r: 18, c: '#ffb38a' },
};
const TREES = [
  { x: 46, y: 124, s: 1.1, pine: false, c: 0 },
  { x: 72, y: 128, s: 0.8, pine: true, c: 1 },
  { x: 98, y: 127, s: 0.9, pine: false, c: 2 },
  { x: 290, y: 119, s: 1.2, pine: false, c: 1 },
  { x: 321, y: 124, s: 0.9, pine: true, c: 0 },
  { x: 350, y: 121, s: 1.05, pine: false, c: 2 },
];
const STARS = [[40, 22], [92, 40], [140, 18], [188, 34], [236, 14], [262, 46], [372, 26], [120, 58], [210, 60]];

function mix(a, b, t) {
  const p = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

function tree({ x, y, s, pine, c }, colors, trunk) {
  if (pine) {
    return `<path d="M${x} ${y - 34 * s}L${x + 12 * s} ${y}H${x - 12 * s}Z" fill="${colors[c]}"/>`
      + `<rect x="${x - 1.5 * s}" y="${y}" width="${3 * s}" height="${6 * s}" fill="${trunk}"/>`;
  }
  return `<rect x="${x - 1.8 * s}" y="${y - 12 * s}" width="${3.6 * s}" height="${16 * s}" fill="${trunk}"/>`
    + `<circle cx="${x}" cy="${y - 21 * s}" r="${13 * s}" fill="${colors[c]}"/>`;
}

export function sceneSVG(phase = 'day', season = 'summer') {
  const [skyTop, skyBottom] = SKY[phase];
  const [far, mid, near] = LAND[phase];
  const night = '#0b1220';
  const leaves = LEAVES[season].map((c) => mix(c, night, SHADE[phase]));
  const trunk = mix('#6b4a32', night, SHADE[phase]);
  const trail = mix('#efe2c4', night, SHADE[phase] * 0.8);

  let sky = '';
  if (phase === 'night') {
    sky += STARS.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.2" fill="#fff" opacity="0.8"/>`).join('');
    sky += `<circle cx="316" cy="36" r="12" fill="#f3efe0"/><circle cx="322" cy="31" r="11" fill="${skyTop}"/>`;
  } else {
    const s = SUN[phase];
    sky += `<circle cx="${s.x}" cy="${s.y}" r="${s.r * 2.3}" fill="${s.c}" opacity="0.25"/><circle cx="${s.x}" cy="${s.y}" r="${s.r}" fill="${s.c}"/>`;
  }
  if (phase === 'day' || phase === 'dawn') {
    sky += '<g fill="#fff" opacity="0.85"><ellipse cx="150" cy="40" rx="26" ry="8"/><ellipse cx="166" cy="34" rx="16" ry="8"/>'
      + '<ellipse cx="236" cy="62" rx="20" ry="6"/><ellipse cx="248" cy="57" rx="11" ry="6"/></g>';
  }

  return `<svg viewBox="0 0 400 160" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
<defs><linearGradient id="gg-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${skyTop}"/><stop offset="1" stop-color="${skyBottom}"/></linearGradient></defs>
<rect width="400" height="160" fill="url(#gg-sky)"/>${sky}
<path d="M0 92C60 70 120 78 180 88S300 64 400 84V160H0Z" fill="${far}"/>
<path d="M0 116C70 96 150 104 210 114S330 96 400 108V160H0Z" fill="${mid}"/>
${TREES.map((t) => tree(t, leaves, trunk)).join('')}
<path d="M0 140C90 126 200 132 260 138S360 128 400 134V160H0Z" fill="${near}"/>
<path d="M196 162C230 150 168 142 196 131S214 118 204 112" stroke="${trail}" stroke-width="4" stroke-linecap="round" stroke-dasharray="0.5 9" fill="none"/>
</svg>`;
}
