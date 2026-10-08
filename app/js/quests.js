// Turns real OpenStreetMap features near you into quests.
// The vision labels are fixed per quest type (reliable); only the flavour text is left to the LLM.

import { distanceM, bearingDeg, compass, formatDistance } from './geo.js';

const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const MIN_DISTANCE_M = 120; // make people actually walk somewhere
const PER_TYPE_LIMIT = 40;

export const QUEST_TYPES = [
  {
    id: 'tree', label: 'Tree', emoji: '🌳', thing: 'a tree',
    queries: ['node["natural"="tree"]'],
    match: (t) => t.natural === 'tree',
    labels: ['a tree', 'tree leaves', 'tree bark'],
    title: 'Say hi to a tree',
    text: 'A mapped tree is {dist} {dir} of you. Find it and photograph its leaves or bark.',
    tolerance: 40,
  },
  {
    id: 'water', label: 'Water', emoji: '💧', thing: 'water',
    queries: ['nwr["natural"="water"]', 'way["waterway"~"^(river|stream|canal)$"]', 'node["amenity"="fountain"]'],
    match: (t) => t.natural === 'water' || /^(river|stream|canal)$/.test(t.waterway || '') || t.amenity === 'fountain',
    labels: ['water', 'a river', 'a pond', 'a lake', 'a fountain'],
    title: 'Go find some water',
    text: '{name} is {dist} {dir}. Walk there and photograph the water.',
    tolerance: 150,
  },
  {
    id: 'park', label: 'Park', emoji: '🌱', thing: 'grass or plants',
    queries: ['nwr["leisure"="park"]', 'nwr["leisure"="garden"]'],
    match: (t) => t.leisure === 'park' || t.leisure === 'garden',
    labels: ['grass', 'a lawn', 'a park', 'green plants'],
    title: 'Touch actual grass',
    text: '{name} is {dist} {dir}. Get there, touch the grass, photograph it.',
    tolerance: 150,
  },
  {
    id: 'wood', label: 'Woods', emoji: '🌲', thing: 'trees',
    queries: ['nwr["natural"="wood"]', 'nwr["landuse"="forest"]'],
    match: (t) => t.natural === 'wood' || t.landuse === 'forest',
    labels: ['a forest', 'woods', 'many trees'],
    title: 'Into the woods',
    text: '{name} is {dist} {dir}. Walk in until you are surrounded by trees.',
    tolerance: 200,
  },
  {
    id: 'bench', label: 'Bench', emoji: '🪑', thing: 'a bench',
    queries: ['node["amenity"="bench"]'],
    match: (t) => t.amenity === 'bench',
    labels: ['a bench', 'a park bench'],
    title: 'Find the bench, sit for a minute',
    text: 'There is a bench {dist} {dir}. Sit on it for one quiet minute, then photograph it.',
    tolerance: 40,
  },
  {
    id: 'playground', label: 'Playground', emoji: '🛝', thing: 'playground equipment',
    queries: ['nwr["leisure"="playground"]'],
    match: (t) => t.leisure === 'playground',
    labels: ['a playground', 'a swing', 'a slide', 'a climbing frame'],
    title: 'Recess is back',
    text: '{name} is {dist} {dir}. Photograph a swing or a slide.',
    tolerance: 80,
  },
  {
    id: 'viewpoint', label: 'Viewpoint', emoji: '🏞️', thing: 'the view',
    queries: ['node["tourism"="viewpoint"]'],
    match: (t) => t.tourism === 'viewpoint',
    labels: ['a scenic view', 'a landscape', 'the horizon'],
    title: 'Earn the view',
    text: '{name} is {dist} {dir}. Get there and photograph what you see.',
    tolerance: 100,
  },
  {
    id: 'art', label: 'Public art', emoji: '🗿', thing: 'the artwork',
    queries: ['node["tourism"="artwork"]'],
    match: (t) => t.tourism === 'artwork',
    labels: ['a sculpture', 'a statue', 'a mural', 'street art'],
    title: 'Go see some art',
    text: '{name} is {dist} {dir}. Find it and take its picture.',
    tolerance: 50,
  },
];

// Quests that need no map or GPS, for when you're offline or nothing is mapped.
const ANYWHERE = [
  { id: 'sky', label: 'Sky', emoji: '☁️', thing: 'the sky', labels: ['the sky', 'clouds'], title: 'Look up', text: 'Step outside and photograph the sky. No ceilings allowed.' },
  { id: 'leaf', label: 'Leaf', emoji: '🍃', thing: 'a leaf', labels: ['a green leaf', 'leaves', 'a plant'], title: 'Find a leaf', text: 'Go outside and photograph a leaf up close.' },
  { id: 'flower', label: 'Flower', emoji: '🌼', thing: 'a flower', labels: ['a flower', 'flowers'], title: 'Find a flower', text: 'Go outside and find something blooming.' },
  { id: 'grass', label: 'Grass', emoji: '🌿', thing: 'grass', labels: ['grass', 'a lawn'], title: 'Literally touch grass', text: 'Find a patch of grass, touch it, photograph it.' },
];

// Every quest type is a collectible stamp.
export const STAMPS = [...QUEST_TYPES, ...ANYWHERE].map(({ id, label, emoji }) => ({ id, label, emoji }));

const shuffle = (arr) => arr.map((v) => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(([, v]) => v);

const fill = (template, vars) => template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

export function anywhereQuests(count = 3) {
  return shuffle(ANYWHERE).slice(0, count).map((q) => ({ ...q, type: q.id, lat: null, lon: null }));
}

function buildQuery(pos, radius) {
  const around = `(around:${radius},${pos.lat.toFixed(5)},${pos.lon.toFixed(5)})`;
  const sets = QUEST_TYPES.map((type, i) =>
    `(${type.queries.map((q) => `${q}${around};`).join('')})->.s${i};.s${i} out center ${PER_TYPE_LIMIT};`,
  );
  return `[out:json][timeout:20];${sets.join('')}`;
}

async function queryOverpass(url, data) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data }), signal: ctrl.signal });
    if (!res.ok) throw new Error(`${new URL(url).host} returned ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFeatures(pos, radius) {
  // Round to ~1 km so a cached map is reused around home, and works offline next time.
  const cacheKey = `gg:osm:${pos.lat.toFixed(2)},${pos.lon.toFixed(2)},${radius}`;
  const data = buildQuery(pos, radius);
  const errors = [];
  // Public Overpass servers are volunteer-run and sometimes overloaded or blocking, so try each in turn.
  for (const url of OVERPASS_URLS) {
    try {
      const json = await queryOverpass(url, data);
      const features = json.elements
        .map((el) => ({ lat: el.lat ?? el.center?.lat, lon: el.lon ?? el.center?.lon, tags: el.tags || {} }))
        .filter((f) => f.lat != null && f.lon != null);
      try { localStorage.setItem(cacheKey, JSON.stringify(features)); } catch { /* storage full or blocked */ }
      return features;
    } catch (err) {
      errors.push(err);
    }
  }
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(cacheKey)); } catch { /* ignore */ }
  if (cached) return cached;
  throw new Error('Could not load the map around you.', { cause: new AggregateError(errors) });
}

export async function buildQuests(pos, radius, count = 3) {
  const features = await fetchFeatures(pos, radius);
  const byType = new Map();
  for (const f of features) {
    const type = QUEST_TYPES.find((t) => t.match(f.tags));
    if (!type) continue;
    const dist = distanceM(pos, f);
    if (dist < MIN_DISTANCE_M || dist > radius) continue;
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push({ ...f, dist });
  }

  const quests = [];
  for (const [type, candidates] of shuffle([...byType])) {
    if (quests.length >= count) break;
    // Pick randomly among the closest few so it isn't always the same tree.
    const nearest = candidates.sort((a, b) => a.dist - b.dist).slice(0, 5);
    const f = nearest[Math.floor(Math.random() * nearest.length)];
    const dir = compass(bearingDeg(pos, f));
    const name = f.tags.name || `A ${type.label.toLowerCase()}`;
    quests.push({
      type: type.id, label: type.label, emoji: type.emoji, thing: type.thing,
      labels: type.labels, tolerance: type.tolerance,
      lat: f.lat, lon: f.lon, dist: f.dist, dir, placeName: f.tags.name || null,
      title: type.title,
      text: fill(type.text, { name, dist: formatDistance(f.dist), dir }),
    });
  }
  return quests.length >= count ? quests : [...quests, ...anywhereQuests(count - quests.length)];
}
