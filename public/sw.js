/**
 * Service Worker for Cabinet Dentaire PWA
 */
const CACHE_NAME = 'cabinet-dentaire-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/api.js',
  '/js/app.js',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((k) => {
          if (k !== CACHE_NAME) return caches.delete(k);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Let API requests go directly to network
  if (event.request.url.includes('/api/') || event.request.url.startsWith('ws')) {
    return;
  }

  // Network first, fallback to cache for static UI files
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        return caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, networkResponse.clone());
          return networkResponse;
        });
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});
