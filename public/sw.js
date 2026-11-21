'use strict';
/* Sveiki Chat service worker — deliberately boring.
 *
 * Pages and code are NETWORK-ONLY: this worker never answers a
 * navigation, script or style request from a cache. An earlier
 * version kept a "last good copy" of each page as an offline
 * fallback, and that backfired — the owner kept being shown a
 * stale cached page labelled as an offline copy even while he was
 * online, which just confused him. Live-or-error is clearer: if
 * the network can't answer, the browser shows its own network
 * error and nothing pretends otherwise.
 *
 * The ONLY thing cached is the logo + icons (cache-first, they
 * basically never change) — that's what the home-screen install
 * needs. /api and /media are NEVER intercepted — live data stays
 * live.
 *
 * Bump VERSION on any deploy that must retire old workers/caches.
 * v2 retires the v1 caches, including the old page cache.
 * v3 is the Sveiki Chat rename (was mLT. chat) — same behavior,
 * new version so phones retire the old caches and pick up the
 * renamed shell cleanly.
 */
const VERSION = 'v3';
const STATIC_CACHE = `mlt-static-${VERSION}`;
const KEEP_CACHES = [STATIC_CACHE];
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

  // Everything else — pages, scripts, styles, uploads, images —
  // is NOT intercepted: the browser fetches it from the network,
  // and if the network fails the request fails with the browser's
  // own error. No cached copies, no synthesized offline page.
});
