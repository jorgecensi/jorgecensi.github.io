const CACHE_VERSION = '2608060755';
const CACHE_NAME = `personal-trainer-${CACHE_VERSION}`;
const OFFLINE_URL = '/personal-trainer/';
// Google Fonts serves the stylesheet from one host and the woff2 files from another,
// and the woff2 URLs are UA-dependent — so only the stylesheet is worth precaching by
// URL. The font files themselves are picked up by the cross-origin branch in fetch on
// the first online run, after which the app renders its own type offline. Until then it
// falls back to the system stack declared in --font-display/--font-body.
const FONT_CSS_URL = 'https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&family=Familjen+Grotesk:wght@400;500;600;700&display=swap';
const FONT_HOSTS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];
const PRECACHE_URLS = [
    '/personal-trainer/',
    '/personal-trainer/manifest.json',
    FONT_CSS_URL,
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
    '/img/pt/streak.png',
    '/img/pt/achievements.png',
    '/img/pt/records.png',
    '/img/pt/weekly-goal.png',
    '/img/pt/twists.png',
    '/img/pt/streak-chain.png',
    '/img/pt/warmup.png',
    '/img/pt/cooldown.png',
    '/img/pt/feedback-easy.png',
    '/img/pt/feedback-right.png',
    '/img/pt/feedback-hard.png',
    '/img/pt/celebration.png',
    '/img/pt/barnaby-victory.png',
    '/img/pt/barnaby-easy.png',
    '/img/pt/barnaby-right.png',
    '/img/pt/barnaby-hard.png',
    '/personal-trainer/body-muscles.umd.min.js'
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

    // Google Fonts — the one cross-origin exception. Cache-first, because the
    // stylesheet and the woff2 files are immutable once fetched, and a font that
    // arrives late is a visible reflow. Responses from fonts.gstatic.com are opaque
    // (no CORS), which is fine: they're only ever replayed to the same <link>.
    if (FONT_HOSTS.some((host) => event.request.url.startsWith(host))) {
        event.respondWith(
            caches.match(event.request).then((cachedResponse) =>
                cachedResponse ||
                fetch(event.request).then((networkResponse) => {
                    const clone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                    return networkResponse;
                })
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
