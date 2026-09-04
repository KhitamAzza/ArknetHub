// ArkNet Hub — Service Worker
// Bump CACHE_VERSION on every deploy so old shells get replaced.
const CACHE_VERSION = 'arknet-hub-v1';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;

// App shell: everything needed for the UI to boot and render offline.
// Data (Supabase calls, face-api model files) is NOT pre-cached here —
// those go through the network-first runtime strategy below.
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',

  // CSS
  './style.css',
  './helper.css',
  './admin.css',
  './ketua.css',
  './tatib.css',
  './overseer.css',

  // JS
  './main.js',
  './utils.js',
  './registration.js',
  './paper.js',
  './daftar.js',
  './syarat.js',
  './dana.js',
  './helper.js',
  './admin.js',
  './tatib.js',
  './overseer.js',

  // Icons
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
];

// --- INSTALL: pre-cache the app shell ---
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

// --- ACTIVATE: clean up old cache versions ---
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('arknet-hub-') && key !== SHELL_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// --- FETCH: routing strategy ---
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // never cache POSTs (writes/attendance submits)

  const url = new URL(request.url);

  // Cross-origin (Supabase API, face-api CDN, jsdelivr, etc.) — network first,
  // no cache fallback, so data always stays fresh when online.
  if (url.origin !== self.location.origin) {
    event.respondWith(
      fetch(request).catch(() => new Response(null, { status: 503, statusText: 'Offline' }))
    );
    return;
  }

  // Same-origin shell assets — cache first, falling back to network,
  // and updating the cache in the background when a fresh copy is fetched.
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached); // offline: fall back to whatever's cached

      return cached || networkFetch;
    })
  );
});