const CACHE = 'pocket-astro-0190-sdk-tools';
const allowed = url => url.origin === self.location.origin && (url.pathname === '/' || url.pathname.startsWith('/_astro/') || url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/sprites/'));
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE), response = await fetch('/');
    if (!response.ok) throw new Error('Pocket shell is unavailable.');
    await cache.put('/', response.clone());
    const html = await response.text();
    const urls = [...new Set([...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map(match => new URL(match[1], self.location.origin)).filter(allowed).map(url => url.href))];
    await cache.addAll(urls);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith('pocket-astro-') && name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || !allowed(url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(event.request);
      // A full or unavailable cache must not cost the page a file it already downloaded.
      if (response.ok) await cache.put(event.request, response.clone()).catch(() => {});
      return response;
    } catch (error) {
      const saved = await cache.match(event.request) || (event.request.mode === 'navigate' ? await cache.match('/') : null);
      if (saved) return saved;
      throw error;
    }
  })());
});
