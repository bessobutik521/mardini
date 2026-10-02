const CACHE = 'mardini-shell-v3';
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['/offline.html', '/icon.svg']))); self.skipWaiting(); });
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => { if (event.request.mode === 'navigate') event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html'))); });
