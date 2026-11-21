'use strict';
/* mLT. chat service worker — deliberately boring.
 *
 * The app changes often, so pages and code are NETWORK-FIRST: a stale
 * cached app.js is the one big risk, and we never serve one when the
 * network can answer. The cache only keeps (a) the logo/icons
 * (cache-first, they basically never change) and (b) the last good
 * copy of a page, used only when the network is unreachable.
 * /api and /media are NEVER cached — live data stays live.
 *
 * Bump VERSION on any deploy that must retire old workers/caches.
 */
const VERSION = 'v1';
const STATIC_CACHE = `mlt-static-${VERSION}`;
const PAGE_CACHE = `mlt-pages-${VERSION}`;
const KEEP_CACHES = [STATIC_CACHE, PAGE_CACHE];
const STATIC_FILES = ['/logo.webp', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP_CACHES.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // CDN styles etc: straight to network

  // Live data is never cached.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) return;

  // Logo + icons: cache-first, they basically never change.
  if (STATIC_FILES.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => {
        const copy = res.clone();
        caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
        return res;
      }))
    );
    return;
  }

  // Pages, scripts and styles: network-first. The fresh copy wins;
  // the cache is only an offline fallback.
  if (request.mode === 'navigate' || ['document', 'script', 'style'].includes(request.destination)) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(PAGE_CACHE).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((hit) => hit ||
          new Response('You are offline — mLT. chat will be right back.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' },
          })))
    );
    return;
  }

  // Everything else (uploads, images, …): straight to the network.
});
