// MishMash Finances service worker.
// Makes the app work offline. It only caches the app's own files; financial
// data lives in IndexedDB (encrypted) and never passes through here.
const CACHE = 'mishmash-shell-v2';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/index.html'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== 'mishmash-share').map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Share target: hold the shared file until the app is unlocked and reads it.
  if (req.method === 'POST' && url.pathname === '/share-target') {
    event.respondWith(
      (async () => {
        const form = await req.formData();
        const file = form.get('file');
        if (file && typeof file !== 'string') {
          const cache = await caches.open('mishmash-share');
          await cache.put('/shared-file', new Response(file, { headers: { 'x-file-name': encodeURIComponent(file.name) } }));
        }
        return Response.redirect('/?shared=1#transactions-import', 303);
      })(),
    );
    return;
  }

  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Pages: network first so updates arrive, cached copy when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html')),
    );
    return;
  }

  // Hashed build assets: cache first.
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
