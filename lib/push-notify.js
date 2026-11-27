// Shared by every server-side file that inserts a notification outside
// the frontend's sendNotification() chokepoint — cron jobs and admin
// actions run with no browser involved at all, so they can't call that
// frontend function or its automatic push trigger. This is the same
// underlying send/cleanup logic as api/integrations.js's push branch,
// factored out here so three separate files don't each duplicate it.

const webpush = require('web-push');

let vapidConfigured = false;
function ensureVapidConfigured(){
  if (vapidConfigured) return;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'https://based-agency-radar.vercel.app/',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
  }
  vapidConfigured = true;
}

// admin = the caller's already-created Supabase service-role client —
// this module never creates its own, so callers control their own
// connection lifecycle. Silently does nothing if VAPID isn't configured
// or the user has no subscribed devices, same as the frontend's version —
// this is always a supplementary alert alongside the real in-app
// notification the caller already inserted, never the only place
// something is recorded.
// Link for a notification's target screen — matches the app's own screen
// addresses (#tasks, #client/<id>…), so tapping a push opens that screen.
function pushUrlFor(targetView, targetId){
  if(targetView === 'client-detail' && targetId) return '/#client/' + encodeURIComponent(targetId);
  if(targetView && /^[a-z-]+$/.test(targetView)) return '/#' + targetView;
  return '/';
}
// Only same-site paths ("/…", never "//other-site" or a full URL).
function safePushUrl(url){
  return (typeof url === 'string' && /^\/(?!\/)/.test(url) && url.length < 300) ? url : '/';
}

async function sendPushToUser(admin, userId, title, body, url){
  ensureVapidConfigured();
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return { sent: 0, failed: 0 };

  const { data: subs } = await admin.from('push_subscriptions').select('*').eq('user_id', userId);
  if (!subs || !subs.length) return { sent: 0, failed: 0 };

  const payload = JSON.stringify({ title, body: body || '', url: safePushUrl(url) });
  let sent = 0, failed = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
      sent++;
    } catch (err) {
      failed++;
      // Same cleanup rule as api/integrations.js — 404/410 means this
      // specific subscription is permanently dead, not a transient
      // failure, so there's nothing to gain by keeping it around.
      if (err.statusCode === 404 || err.statusCode === 410) {
        await admin.from('push_subscriptions').delete().eq('id', sub.id);
      }
    }
  }
  return { sent, failed };
}

module.exports = { sendPushToUser, pushUrlFor, safePushUrl };
