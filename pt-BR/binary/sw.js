const CACHE_VERSION = '2603220405';
const CACHE_NAME = `binary-puzzle-ptbr-${CACHE_VERSION}`;
const OFFLINE_URL = "/pt-BR/binary/";
const PRECACHE_URLS = [
  "/pt-BR/binary/",
  "/binary/binary.js",
  "/binary/manifest-pt-BR.json",
  "/css/main.css",
  "/img/favicon.ico",
  "/img/binary-icon-192.png",
  "/img/binary-icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName.startsWith("binary-puzzle-ptbr-")) {
            return caches.delete(cacheName);
          }
          return Promise.resolve();
        })
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  event.respondWith(
    (async () => {
      const cachedResponse = await caches.match(event.request);
      if (cachedResponse) {
        return cachedResponse;
      }

      try {
        return await fetch(event.request);
      } catch (error) {
        if (event.request.mode === "navigate") {
          const offlinePage = await caches.match(OFFLINE_URL);
          if (offlinePage) {
            return offlinePage;
          }
        }
        throw error;
      }
    })()
  );
});
