const CACHE_VERSION = '2610090803';
const CACHE_NAME = `music-theory-${CACHE_VERSION}`;
const OFFLINE_URL = '/music-theory/';
// Instrument samples (Salamander piano on another origin, the rest under
// /music-theory/samples/) are large and never change at a given URL, so they
// get their own cache: filled as each instrument is first used, and not wiped
// by version bumps (the activate cleanup only deletes caches prefixed
// `music-theory-`).
const SAMPLES_CACHE = 'mt-samples-v1';
const SAMPLES_PREFIXES = [
  'https://tonejs.github.io/audio/salamander/',
  `${self.location.origin}/music-theory/samples/`,
];
const PRECACHE_URLS = [
  '/music-theory/',
  '/music-theory/manifest.json',
  '/music-theory/lib/Tone.js',
  '/img/music-theory-icon-192.png',
  '/img/music-theory-icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch((err) => console.warn(`Precache failed for ${url}`, err))
        )
      )
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith('music-theory-') && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match(OFFLINE_URL)
      )
    );
    return;
  }

  if (SAMPLES_PREFIXES.some((p) => event.request.url.startsWith(p))) {
    event.respondWith(
      caches.open(SAMPLES_CACHE).then((cache) =>
        cache.match(event.request).then((cached) => {
          if (cached) return cached;
          return fetch(event.request).then((response) => {
            if (response && response.status === 200) cache.put(event.request, response.clone());
            return response;
          });
        })
      )
    );
    return;
  }

  if (event.request.url.startsWith(self.location.origin)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        });
      })
    );
  }
});
