const CACHE_VERSION = '2607181506';
const CACHE_NAME = `personal-trainer-${CACHE_VERSION}`;
const OFFLINE_URL = '/personal-trainer/';
const PRECACHE_URLS = [
    '/personal-trainer/',
    '/personal-trainer/manifest.json',
    '/img/personal-trainer-icon-192.png',
    '/img/personal-trainer-icon-512.png',
    '/img/favicon.ico',
    '/img/pt/app-logo.png',
    '/img/pt/settings.png',
    '/img/pt/core-fitness.png',
    '/img/pt/mat-pilates.png',
    '/img/pt/generate-dark.png',
    '/img/pt/exercise-library.png',
    '/img/pt/history.png',
    '/img/pt/level.png',
    '/img/pt/workout.png',
    '/img/pt/streak.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) =>
            cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: 'reload' })))
        )
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) =>
            Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME && cacheName.startsWith('personal-trainer-')) {
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
                    if (networkResponse.ok) {
                        const clone = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                    }
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
