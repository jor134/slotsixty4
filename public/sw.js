const SHELL = 'slot64-shell-v18';
const RUNTIME = 'slot64-core-v2';
const FILES = ['./', './index.html', './layout.js', './vr.js', './manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k !== SHELL && k !== RUNTIME).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // Never touch the API. Session checks must hit the network to be accurate,
  // and ROM bodies are tens of megabytes — they belong in IndexedDB, not here.
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) return;

  // Emulator core + data: left alone entirely. Script/wasm requests to the CDN
  // come back as opaque cross-origin responses; caching and replaying those
  // breaks the loader's own status checks. EmulatorJS caches cores and ROMs in
  // its own IndexedDB store (EJS_cacheConfig), so offline still works.
  if (url.hostname === 'cdn.emulatorjs.org') return;

  // App shell: network-first so updates land, cache as fallback.
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const copy = res.clone();
          caches.open(SHELL).then(c => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
    );
  }
});
