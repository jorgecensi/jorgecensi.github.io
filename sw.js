const CACHE_NAME = "site-pwa-v2";
const PRECACHE_URLS = [
  "/",
  "/apps.html",
  "/binary.html",
  "/pt-BR/binary.html",
  "/binary.js",
  "/binary-manifest.json",
  "/binary-pt-BR-manifest.json",
  "/crossfit-timer.html",
  "/flappy.html",
  "/flappyBird.js",
  "/manifest.json",
  "/flappy-manifest.json",
  "/css/main.css",
  "/img/favicon.ico",
  "/img/timer-icon-192.png",
  "/img/timer-icon-512.png",
  "/img/timer-icon.png",
  "/img/bg.png",
  "/img/bird.png",
  "/img/fg.png",
  "/img/pipeNorth.png",
  "/img/pipeSouth.png",
  "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css",
  "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js",
  "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"
];

async function cachePrecacheAssets() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.allSettled(
    PRECACHE_URLS.map(async (url) => {
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (response.ok || response.type === "opaque") {
          await cache.put(url, response.clone());
        }
      } catch (error) {
        // Ignore individual cache failures so the service worker still installs.
      }
    })
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(cachePrecacheAssets());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
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
      const cached = await caches.match(event.request);
      if (cached) {
        return cached;
      }

      try {
        const response = await fetch(event.request);
        if (response.ok && event.request.url.startsWith(self.location.origin)) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(event.request, response.clone());
        }
        return response;
      } catch (error) {
        if (event.request.mode === "navigate") {
          const fallback = await caches.match("/binary.html");
          if (fallback) {
            return fallback;
          }
        }
        throw error;
      }
    })()
  );
});