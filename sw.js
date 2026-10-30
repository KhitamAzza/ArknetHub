// ArkNet Hub — Service Worker
// Bump CACHE_VERSION on every deploy so old shells get replaced.
const CACHE_VERSION = 'arknet-hub-v10';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;

// App shell: everything needed for the UI to boot and render offline.
// Paths must match exactly what index.html loads (style/..., script/...).
// Data (Supabase calls, CDN scripts) is NOT pre-cached here —
// those go through the network-first runtime strategy below.
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',

  // CSS
  './style/style.css',
  './style/helper.css',
  './style/admin.css',
  './style/ketua.css',
  './style/tatib.css',
  './style/overseer.css',
  './style/denda.css',
  './style/nilai.css',

  // JS
  './script/utility/main.js',
  './script/utility/utils.js',
  './script/pembina/registration.js',
  './script/pembina/paper.js',
  './script/pembina/daring.js',
  './script/pembina/daftar.js',
  './script/pembina/syarat.js',
  './script/pembina/nilai.js',
  './script/pembina/dana.js',
  './script/pembina/helper.js',
  './script/admin/admin.js',
  './script/admin/denda.js',
  './script/admin/tambahpoin.js',
  './script/admin/overseer.js',
  './script/tatib/tatib.js',
  './script/utility/navigation.js',

  // Icons
  './ArknetHub-192.png',
  './ArknetHub-512.png',
  './icons/icon-192.png',
];

// --- INSTALL: pre-cache the app shell ---
// Each file is cached on its own, so one wrong path/404 can no longer
// make the whole install fail (cache.addAll is all-or-nothing).
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      Promise.allSettled(
        SHELL_ASSETS.map((asset) =>
          cache.add(asset).catch((err) => console.warn('[SW] not cached:', asset, err))
        )
      )
    )
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

  // Cross-origin (Supabase API, CDNs, etc.) — network first,
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