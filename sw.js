const CACHE_NAME = 'flappy-bird-v1';
const urlsToCache = [
  '/flappy.html',
  '/flappyBird.js',
  '/css/main.css',
  '/img/bird.png',
  '/img/bg.png',
  '/img/fg.png',
  '/img/pipeNorth.png',
  '/img/pipeSouth.png',
  '/sounds/fly.mp3',
  '/sounds/score.mp3'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', function(event) {
  event.respondWith(
    caches.match(event.request)
      .then(function(response) {
        if (response) {
          return response;
        }
        return fetch(event.request);
      }
    )
  );
});