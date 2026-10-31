const CACHE_VERSION = '2610252257';
const CACHE_NAME = `cyber-quest-${CACHE_VERSION}`;
const OFFLINE_URL = '/cyber-quest/';
const PRECACHE_URLS = [
    '/cyber-quest/',
    '/cyber-quest/manifest.json',
    '/img/cyber-quest-icon-192.png',
    '/img/cyber-quest-icon-512.png',
    '/img/favicon.ico'
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
        caches.keys().then((cacheNames) =>
            Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME && cacheName.startsWith('cyber-quest-')) {
                        return caches.delete(cacheName);
                    }
                    return Promise.resolve();
                })
            )
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then((networkResponse) => {
                    const clone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                    return networkResponse;
                })
                .catch(() =>
                    caches.match(event.request).then((cached) => cached || caches.match(OFFLINE_URL))
                )
        );
        return;
    }

    if (event.request.url.startsWith(self.location.origin)) {
        event.respondWith(
            caches.match(event.request).then((cachedResponse) => {
                const networkFetch = fetch(event.request)
                    .then((networkResponse) => {
                        if (networkResponse.ok) {
                            const clone = networkResponse.clone();
                            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                        }
                        return networkResponse;
                    })
                    .catch(() => cachedResponse);
                return cachedResponse || networkFetch;
            })
        );
    }
});
