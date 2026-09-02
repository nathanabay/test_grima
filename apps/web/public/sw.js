/**
 * Service worker for offline warehouse operation (§51).
 *
 * Strategy, deliberately conservative for a pharmacy:
 *
 *  - App shell: cache-first, so the interface opens without a network.
 *  - GET API calls: network-first with a cache fallback, and every cached
 *    response is served with an `X-From-Cache` header so the UI can tell the
 *    operator the figures are stale rather than presenting them as live.
 *  - Mutations (POST/PATCH/DELETE): NEVER replayed automatically. They are
 *    queued and require an explicit human sync, because silently replaying a
 *    dispense or a stock movement after the fact can oversell stock or
 *    double-count a batch. §51 forbids silently overwriting conflicting
 *    pharmaceutical transactions.
 */

const VERSION = 'pharmacore-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const DATA_CACHE = `${VERSION}-data`;

const SHELL_ASSETS = ['/', '/dashboard', '/scan', '/counts', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // A failed pre-cache must not block activation.
      Promise.allSettled(SHELL_ASSETS.map((a) => cache.add(a))),
    ),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

function isApi(url) {
  return url.pathname.startsWith('/api/');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') {
    // Mutations are the operator's to replay. Fail loudly when offline.
    if (isApi(url)) event.respondWith(handleMutation(request));
    return;
  }

  if (isApi(url)) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
  }
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok && request.url.startsWith(self.location.origin)) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const fallback = await caches.match('/dashboard');
    return fallback ?? new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(DATA_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (!cached) {
      return new Response(
        JSON.stringify({ statusCode: 503, error: 'Offline and no cached copy of this data' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      );
    }
    // Mark it so the interface can say the figures are not live.
    const body = await cached.blob();
    const headers = new Headers(cached.headers);
    headers.set('X-From-Cache', '1');
    headers.set('X-Cached-At', cached.headers.get('date') ?? '');
    return new Response(body, { status: 200, headers });
  }
}

async function handleMutation(request) {
  try {
    return await fetch(request.clone());
  } catch (error) {
    // Queue for a human to review and replay.
    const entry = {
      id: crypto.randomUUID(),
      url: request.url,
      method: request.method,
      headers: [...request.headers].filter(([k]) => k.toLowerCase() !== 'authorization'),
      body: await request.clone().text(),
      queuedAt: new Date().toISOString(),
    };

    const clients = await self.clients.matchAll();
    clients.forEach((c) => c.postMessage({ type: 'QUEUE_MUTATION', entry }));

    return new Response(
      JSON.stringify({
        statusCode: 503,
        error:
          'You are offline. This action has been queued and must be reviewed and sent manually ' +
          'once the connection returns — pharmaceutical transactions are never replayed automatically.',
        queued: true,
        queueId: entry.id,
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
