/* Workout Log · service worker
   Only here so the app can be installed and show "Rest over" notifications.
   It deliberately does NOT cache anything: every visit loads the latest version
   of the site, so updates show up immediately. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

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
