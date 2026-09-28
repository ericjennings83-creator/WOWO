// Offline support: the app shell is cached so it opens with no signal.
// Bump VERSION whenever app files change so phones pick up the update.
const VERSION = 'v4';
const CACHE = 'detailing-' + VERSION;
const SHELL = [
  './',
  'index.html',
  'css/styles.css',
  'js/app.js',
  'js/store.js',
  'js/util.js',
  'manifest.webmanifest',
  'icons/icon.svg',
];

self.addEventListener('install', e => {
  // Cache files one by one so a single missing file can't block install.
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(SHELL.map(url => c.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first (so updates show up when online), cache as fallback.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
