self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName.startsWith("site-pwa-")) {
            return caches.delete(cacheName);
          }
          return Promise.resolve();
        })
      );
      await self.registration.unregister();
      await self.clients.claim();
    })()
  );
});