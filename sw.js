/* Workout Log · service worker
   - Keeps a copy of the app's own files so it opens fast and works on a bad connection.
     Saving to Google Sheets still needs the internet; Google's own files are never cached.
   - Updates show up straight away: the page itself is always fetched fresh when online, and
     the scripts are versioned (index.html loads them as file.js?v=<hash>, written by
     tools/stamp.py), so a new version means new URLs.
   - Shows the "Rest over" notification and brings the app back when it's tapped. */
const CACHE = 'workout-log-v1';
const PAGE_TIMEOUT = 4000;           // on a slow connection, fall back to the saved page after 4 s

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', event => {
  const req = event.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;     // Google, YouTube…: untouched
  if (req.mode === 'navigate') return event.respondWith(pageFirst(req));
  if (url.searchParams.has('v')) return event.respondWith(versioned(req, url));
  if (/\.json$/.test(url.pathname)) return event.respondWith(networkFirst(req));   // pt-config, manifest
  event.respondWith(staleWhileRevalidate(req));                                   // icons, privacy page
});

async function put(req, res) {
  if (res && res.ok && res.type === 'basic') { const c = await caches.open(CACHE); await c.put(req, res.clone()); }
  return res;
}
// The page: network first (so new versions arrive), the saved copy if offline or very slow.
async function pageFirst(req) {
  const c = await caches.open(CACHE), key = new Request(new URL(req.url).pathname);   // one copy, whatever the ?query
  const net = fetch(req).then(async res => { if (res.ok) await c.put(key, res.clone()); return res; });
  const saved = await c.match(key);
  if (!saved) return net;
  return Promise.race([net.catch(() => saved), new Promise(r => setTimeout(() => r(saved), PAGE_TIMEOUT))]);
}
// Versioned scripts never change, so the saved copy is used; older versions of the file are removed.
async function versioned(req, url) {
  const c = await caches.open(CACHE), hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    await c.put(req, res.clone());
    for (const k of await c.keys()) { const u = new URL(k.url); if (u.pathname === url.pathname && u.search !== url.search) await c.delete(k); }
  }
  return res;
}
async function networkFirst(req) {
  try { return await put(req, await fetch(req)); }
  catch (e) { const hit = await caches.match(req); if (hit) return hit; throw e; }
}
async function staleWhileRevalidate(req) {
  const hit = await caches.match(req), net = fetch(req).then(res => put(req, res)).catch(() => hit);
  return hit || net;
}

// Tapping the notification brings the app back to the front.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = all.find(c => c.url.startsWith(self.registration.scope));
    if (open) return open.focus();
    return self.clients.openWindow(self.registration.scope);
  })());
});
