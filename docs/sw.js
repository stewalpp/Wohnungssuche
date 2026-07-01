/* Service Worker für "Möbelverkauf" — App-Shell vorab cachen, beim Online-Sein
   immer die frischeste Version laden (network-first). Die Verkaufsdaten liegen
   in Firestore und werden vom SDK selbst verwaltet — hier nichts zu cachen. */
'use strict';

const CACHE = 'moebelverkauf-v4';

const PRECACHE = [
  './',
  'index.html',
  'css/style.css',
  'manifest.json',
  'js/config.js',
  'js/core.js',
  'js/catalog.js',
  'js/stats.js',
  'js/store.js',
  'js/views/items.js',
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

// Network-first für die App-Shell (HTML/JS/CSS): online immer die frischeste
// Version, damit ein Update nie "einen Ladevorgang hinterher" ist; offline der
// gecachte Stand.
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

function staleWhileRevalidate(event) {
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
      return refresh.catch(() => new Response('Offline', {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      }));
    })
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (request.mode === 'navigate') {
      event.respondWith(networkFirst(event, 'index.html'));
    } else {
      event.respondWith(networkFirst(event, null));
    }
    return;
  }

  // Firebase SDK vom CDN: stale-while-revalidate.
  if (request.url.indexOf(FIREBASE_CDN_PREFIX) === 0) {
    event.respondWith(staleWhileRevalidate(event));
    return;
  }

  // Alles andere (Firestore-Listen-Kanäle, Auth-Endpunkte …): nicht abfangen.
});
