// Offline support: the app shell is cached on install; map images are cached as you browse.
const CACHE_VERSION = '2610310343';
const SHELL = `conquerors-shell-${CACHE_VERSION}`;
const MAP_TILES = 'conquerors-map-tiles';
const MAX_MAP_TILES = 1500;

const ASSETS = [
  './', 'manifest.json', 'css/app.css',
  'js/app.js', 'js/geo.js', 'js/engine.js', 'js/demo.js', 'js/store.js', 'js/strava.js', 'js/map.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('conquerors-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;

  if (url.hostname.endsWith('basemaps.cartocdn.com')) {
    event.respondWith(cacheMapTile(event.request));
    return;
  }
  if (url.origin !== location.origin) return; // Strava API and everything else: straight to the network.

  // App shell: network first so updates show up, cache when offline.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(SHELL).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true })),
  );
});

async function cacheMapTile(request) {
  const cache = await caches.open(MAP_TILES);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    const keys = await cache.keys();
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_MAP_TILES))) await cache.delete(key);
  }
  return response;
}
