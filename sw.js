/**
 * Offline shell for the RTU audit tracker.
 *
 * Network-first, cache-fallback. A technician on a roof with no signal still gets the
 * app, and a technician with signal always gets the newest build — the usual PWA trap is
 * cache-first, which strands people on a stale version after every deploy.
 *
 * Nothing from the API is ever cached. Audit rows, photos and session tokens must not be
 * readable out of the Cache Storage of a shared or lost device, so requests to any other
 * origin are passed straight through and never touched.
 */
// Rewritten by build:web from APP_VER in index.html, so a deploy always lands in a fresh
// cache. Kept literal rather than a placeholder because GitHub Pages serves this file
// straight from the repo root, without a build step.
const VERSION = 'v1.1.77';
const CACHE = 'rtu-shell-' + VERSION;

const SHELL = [
  './',
  './index.html',
  './native-bridge.js',
  './piexif.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Individually, so one missing file cannot fail the whole install.
    await Promise.all(SHELL.map(async (url) => {
      try {
        await cache.add(new Request(url, { cache: 'reload' }));
      } catch (_) {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith('rtu-shell-') && k !== CACHE).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Cross-origin means the photo API: leave it alone entirely.
  if (url.origin !== self.location.origin) return;

  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok && fresh.type === 'basic') {
      cache.put(req, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (_) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    // Deep links and cache-busting query strings still land on the app shell.
    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html', { ignoreSearch: true });
      if (shell) return shell;
    }
    return new Response('Offline and not cached.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}
