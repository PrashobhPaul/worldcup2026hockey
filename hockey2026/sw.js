/* ============================================================
   Hockey.AI Service Worker — Offline-first PWA
   Cache strategy: assets = cache-first | data = network-first
   ============================================================ */

const CACHE_NAME   = 'hockey-ai-v1';
const DATA_CACHE   = 'hockey-data-v1';
const OFFLINE_URL  = '/';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/matches/',
  '/teams/',
  '/players/',
  '/tournament/',
  '/oracle/',
  '/ai-lab/',
  '/style.css',
  '/app.js',
  '/manifest.json',
];

// ── Install: pre-cache shell ────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_ASSETS))
  );
  self.skipWaiting();
});

// ── Activate: clean old caches ──────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME && k !== DATA_CACHE)
            .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch: routing ──────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Data files: network-first, fallback to cache
  if (url.pathname.startsWith('/data/')) {
    event.respondWith(
      caches.open(DATA_CACHE).then(async cache => {
        try {
          const response = await fetch(request);
          cache.put(request, response.clone());
          return response;
        } catch {
          return cache.match(request) || new Response('{}', { headers: { 'Content-Type': 'application/json' } });
        }
      })
    );
    return;
  }

  // Assets: cache-first, network fallback
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response.ok) {
          caches.open(CACHE_NAME).then(c => c.put(request, response.clone()));
        }
        return response;
      }).catch(() => caches.match(OFFLINE_URL));
    })
  );
});
