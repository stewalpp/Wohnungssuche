/* Service worker for "Wohnungssuche" — precache app shell, stale-while-revalidate.
   The listings feed (data/listings.json) is always fetched from the network so
   new apartments show up without a stale cache getting in the way. */
'use strict';

const CACHE = 'wohnungssuche-v9';

const PRECACHE = [
  './',
  'index.html',
  'css/style.css',
  'manifest.json',
  'js/config.js',
  'js/core.js',
  'js/feed.js',
  'js/store.js',
  'js/filters.js',
  'js/score.js',
  'js/views/dashboard.js',
  'js/views/listings.js',
  'js/views/favorites.js',
  'js/views/settings.js',
  'js/app.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png'
];

const FIREBASE_CDN_PREFIX = 'https://www.gstatic.com/firebasejs/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Network-first for the app shell (HTML/JS/CSS): always use the freshest version
// when online so a code update never lands "one load behind"; fall back to the
// cached copy (and finally the offline page) when the network is unavailable.
function networkFirst(event, fallbackUrl) {
  const request = event.request;
  return caches.open(CACHE).then((cache) =>
    fetch(request)
      .then((response) => {
        if (response && (response.ok || response.type === 'opaque')) {
          cache.put(request, response.clone());
        }
        return response;
      })
      .catch(() =>
        cache.match(request)
          .then((cached) => cached || (fallbackUrl ? cache.match(fallbackUrl) : undefined))
          .then((response) => response || new Response('Offline', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          }))
      )
  );
}

function staleWhileRevalidate(event, fallbackUrl) {
  const request = event.request;
  return caches.open(CACHE).then((cache) =>
    cache.match(request).then((cached) => {
      const refresh = fetch(request).then((response) => {
        if (response && (response.ok || response.type === 'opaque')) {
          cache.put(request, response.clone());
        }
        return response;
      });
      if (cached) {
        event.waitUntil(refresh.catch(() => undefined));
        return cached;
      }
      return refresh.catch(() => {
        if (fallbackUrl) return cache.match(fallbackUrl);
        return undefined;
      }).then((response) => {
        if (response) return response;
        return new Response('Offline', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      });
    })
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // The listings feed must never be served stale — let the network handle it.
  if (url.origin === self.location.origin && url.pathname.indexOf('data/listings.json') !== -1) {
    return;
  }

  if (url.origin === self.location.origin) {
    if (request.mode === 'navigate') {
      event.respondWith(networkFirst(event, 'index.html'));
    } else {
      event.respondWith(networkFirst(event, null));
    }
    return;
  }

  if (request.url.indexOf(FIREBASE_CDN_PREFIX) === 0) {
    event.respondWith(staleWhileRevalidate(event, null));
    return;
  }

  // Everything else (Firestore listen channels, auth endpoints, …): don't intercept.
});
