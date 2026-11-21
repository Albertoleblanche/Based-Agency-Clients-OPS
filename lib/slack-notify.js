// Shared by every server-side file that needs to DM someone on Slack —
// api/send-slack-message.js's dm action (frontend-triggered) and
// cron-google-calendar-sync.js's reminder functions (no browser involved
// at all, so they can't go through the frontend's sendNotification()
// chokepoint or call an API route on themselves). Same underlying
// send/skip logic factored out here so those callers don't duplicate it.

// admin = the caller's already-created Supabase service-role client —
// this module never creates its own, same convention as push-notify.js.
// Silently does nothing if SLACK_BOT_TOKEN isn't configured, this person
// has no Slack ID on file, or they've muted this notification type — a
// Slack DM is always a supplementary alert alongside whatever in-app
// notification the caller already inserted, never the only place
// something is recorded. Mute check reuses the exact same
// muted_notification_types list that already gates in-app/push
// notifications, rather than a second, separate Slack-specific list —
// one mute means muted everywhere.
async function sendSlackDM(admin, userId, type, text, overrideSlackId){
  if (!process.env.SLACK_BOT_TOKEN) return { sent: false, reason: 'not_configured' };

  const { data: profile } = await admin.from('team_profiles').select('slack_user_id, muted_notification_types').eq('id', userId).maybeSingle();
  const targetSlackId = overrideSlackId || profile?.slack_user_id;
  if (!targetSlackId) return { sent: false, reason: 'no_slack_id' };
  if (profile && ((profile.muted_notification_types || []).includes(type) || (profile.muted_notification_types || []).includes('slack:' + type))) return { sent: false, reason: 'muted' };

  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}` },
      body: JSON.stringify({ channel: targetSlackId, text }),
    });
    const data = await res.json();
    // Same rule as the client-message flow in send-slack-message.js —
    // Slack's Web API returns HTTP 200 even on failure, so ok:false in
    // the body (not the status code) is the real signal.
    if (!res.ok || !data.ok) return { sent: false, reason: data.error || 'slack_error' };
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: String(e) };
  }
}

module.exports = { sendSlackDM };
