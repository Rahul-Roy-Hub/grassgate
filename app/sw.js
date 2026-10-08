// Offline support. The app shell and versioned CDN libraries are cached here.
// Model weights are cached by transformers.js / WebLLM themselves (Cache Storage),
// so after one download the photo check works with no signal.

const VERSION = 'gg-v2';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'icon.svg',
  'js/main.js',
  'js/quests.js',
  'js/vision.js',
  'js/llm.js',
  'js/unlock.js',
  'js/geo.js',
  'js/store.js',
  'js/journal.js',
  'js/compass.js',
  'js/scenery.js',
  'js/fx.js',
  'vendor/vercel-analytics.mjs',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('gg-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.status === 200) (await caches.open(VERSION)).put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(request);
  const fresh = fetch(request)
    .then((res) => { if (res.status === 200) cache.put(request, res.clone()); return res; })
    .catch(() => hit);
  return hit || fresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (url.pathname.startsWith('/_vercel/')) return; // analytics must hit the network
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request));
  } else if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(cacheFirst(request)); // URLs are version-pinned, safe to keep
  }
  // Everything else (Overpass, model hubs) goes straight to the network.
});
