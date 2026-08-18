// Service worker — Step 1 of the DIY push notification build.
//
// This file runs separately from any open browser tab, which is the
// entire point: it's what lets a push notification show up even if
// nobody currently has the app open. Nothing here can send a push yet —
// that needs VAPID keys, a stored subscription per device, and
// server-side sending logic, all separate steps. This step only
// establishes the piece that's able to *receive and display* one, so it
// can be registered and verified working before anything depends on it.

self.addEventListener('install', (event) => {
  // Activate this version immediately rather than waiting for every
  // existing open tab to close first — fine for this app since a
  // notification-display worker has no meaningful "old version" state
  // that needs to finish out gracefully.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Fires when a push message actually arrives from the browser's push
// service. The payload shape (title/body/url) is something we control —
// it's whatever the server sends when it triggers a push later.
self.addEventListener('push', (event) => {
  let data = { title: 'Based Agency', body: 'You have a new notification.', url: '/' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (e) {
    // Not JSON, or no payload at all — fall back to the generic defaults
    // above rather than let a malformed push silently show nothing.
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/favicon.png',
      badge: '/favicon.png',
      data: { url: data.url || '/' },
    })
  );
});

// Fires when someone clicks the OS notification itself. Prefers
// refocusing an already-open tab over opening a new one — if someone
// already has the app open in a background tab, clicking the
// notification should bring that forward, not spawn a duplicate.
//
// Known limitation for now: this always focuses/opens the app's root,
// not a specific view — this app is a single-page app without per-view
// URLs to deep-link into yet (the same limitation noted earlier for the
// Harvest Button's permalink). Clicking brings the app to the front;
// getting to the exact relevant screen is still a manual step after that.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
