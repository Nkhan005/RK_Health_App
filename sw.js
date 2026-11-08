// Service worker: network-first for the app shell (so updates show immediately),
// falling back to cache when offline. API calls to Google are never cached.
const CACHE = 'rk-health-v2';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './icon.svg',
  './css/tokens.css', './css/base.css', './css/components.css', './css/views.css', './css/print.css',
  './js/app.js', './js/actions.js', './js/api.js', './js/auth.js', './js/config.js', './js/domain.js',
  './js/seed.js', './js/store.js', './js/sync.js', './js/ui.js', './js/ai-fallback.js',
  './js/views/overview.js', './js/views/appointments.js', './js/views/medications.js',
  './js/views/summaries.js', './js/views/report.js', './js/views/settings.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('./index.html'))),
  );
});
