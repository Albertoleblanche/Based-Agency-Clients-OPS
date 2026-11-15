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
// refocusing an already-open tab over opening a new one — and asks that tab
// to open the notification's screen (pushes carry a screen address such as
// /#tasks or /#client/<id>; the app listens for the 'open-url' message).
// With no tab open, it opens a new one straight at that address.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = event.notification.data?.url || '/';
  const targetUrl = /^\/(?!\/)/.test(raw) ? raw : '/'; // same-site paths only

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          client.postMessage({ type: 'open-url', url: targetUrl });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
