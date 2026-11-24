// Meetings, kept current and announced (Nov 23).
//
// calendarTick runs from /api/integrations?route=calendar-tick: three times a day by Vercel Cron (the
// Hobby plan allows each cron job once a day, so there are three of them), and every five minutes if
// Supabase's pg_cron is set up to call it (addendum-calendar-meetings.sql). Each run:
//   1. syncs Google Calendar for everyone connected whose last sync is older than 9 minutes, so a new
//      or moved meeting lands in Radar within minutes, and a deleted one goes;
//   2. tells people a meeting is about to start (its own Google alert time, else 10 minutes before):
//      in Radar's bell, by push to their phone, and on Slack, with the link to join. Once per meeting
//      per person: the bell notification itself is the record (type meeting_soon, target_id = the
//      event), so Radar open in a browser (js/features/calendar.js) and this never both announce it.
// Muting "A meeting is about to start" in Settings → Notifications is honored, per channel.

const { syncGoogleCalendarForUser } = require('./google-calendar-sync');
const { sendPushToUser, pushUrlFor } = require('./push-notify');
const { sendSlackDM } = require('./slack-notify');

const TYPE = 'meeting_soon';
const MEET_NAME = u => /zoom\.us/i.test(u) ? 'Zoom' : /meet\.google/i.test(u) ? 'Google Meet' : /teams\.(microsoft|live)/i.test(u) ? 'Teams' : /webex/i.test(u) ? 'Webex' : /whereby/i.test(u) ? 'Whereby' : 'the meeting';

function leadMinutes(ev) {
  const m = Number(ev.reminder_minutes);
  return Number.isFinite(m) && m > 0 ? Math.min(Math.max(m, 1), 30) : 10;
}
function recipientsOf(ev) {
  if (ev.google_event_id && ev.google_calendar_owner) return [ev.google_calendar_owner];
  const ids = new Set([...(Array.isArray(ev.attendee_ids) ? ev.attendee_ids : []), ...(ev.created_by ? [ev.created_by] : [])]);
  // someone who said they're not going isn't told
  const rs = ev.rsvps || {};
  return [...ids].filter(id => !(rs[id] && rs[id].status === 'declined'));
}
function linkOf(ev) {
  if (ev.meeting_url) return ev.meeting_url;
  const re = /https?:\/\/[^\s<>"')\]]*(?:zoom\.us|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com|whereby\.com|gotomeeting\.com|meet\.jit\.si)[^\s<>"')\]]*/i;
  const m = String(ev.location || '').match(re) || String(ev.description || '').match(re);
  return m ? m[0].replace(/[.,;]+$/, '') : (/^https?:\/\//i.test(String(ev.location || '').trim()) ? String(ev.location).trim() : null);
}

async function meetingAlerts(admin, opts) {
  const now = (opts && opts.now) || new Date();
  const { data: evs, error } = await admin.from('calendar_events').select('*').eq('all_day', false)
    .gte('start_at', new Date(now.getTime() - 2 * 60 * 1000).toISOString()).lte('start_at', new Date(now.getTime() + 31 * 60 * 1000).toISOString());
  if (error) return { error: error.message };
  let sent = 0;
  const profiles = {};
  for (const ev of evs || []) {
    const start = new Date(ev.start_at), mins = (start - now) / 60000;
    if (mins > leadMinutes(ev) || mins < -2) continue;   // not yet, or already well under way
    for (const uid of recipientsOf(ev)) {
      const { data: had } = await admin.from('notifications').select('id').eq('user_id', uid).eq('type', TYPE).eq('target_id', String(ev.id)).limit(1);
      if (had && had.length) continue;
      if (!(uid in profiles)) { const { data: p } = await admin.from('team_profiles').select('muted_notification_types, access_revoked').eq('id', uid).maybeSingle(); profiles[uid] = p || null; }
      const p = profiles[uid];
      if (!p || p.access_revoked) continue;
      const m = p.muted_notification_types || [];
      if (m.includes(TYPE)) continue;
      const link = linkOf(ev), left = Math.max(0, Math.round(mins));
      const title = left <= 0 ? `Starting now: ${ev.title}` : `In ${left} minute${left === 1 ? '' : 's'}: ${ev.title}`;
      const body = link ? `Join on ${MEET_NAME(link)}` : (ev.location ? String(ev.location).slice(0, 120) : 'On your calendar');
      // the bell notification is also the record that this person was told (even when muted in the app)
      await admin.from('notifications').insert({ user_id: uid, type: TYPE, title, body, target_view: 'calendar', target_id: String(ev.id), read: m.includes('app:' + TYPE) });
      if (!m.includes('push:' + TYPE)) { try { await sendPushToUser(admin, uid, title, body, pushUrlFor('calendar')); } catch (e) {} }
      if (!m.includes('slack:' + TYPE)) { try { await sendSlackDM(admin, uid, TYPE, `*${title}*${link ? `\n<${link}|Join on ${MEET_NAME(link)}>` : ''}`, null, { anyDay: true }); } catch (e) {} }
      sent++;
    }
  }
  return { checked: (evs || []).length, sent };
}

// Everyone connected whose last sync is older than `staleMin` minutes, as time allows.
async function syncStaleCalendars(admin, opts) {
  const clientId = process.env.GOOGLE_CLIENT_ID, clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return { skipped: 'Google Calendar isn’t set up' };
  const stale = new Date(Date.now() - ((opts && opts.staleMin) || 9) * 60 * 1000).toISOString();
  const { data: conns, error } = await admin.from('google_calendar_connections').select('user_id, last_synced_at');
  if (error) return { error: error.message };
  const due = (conns || []).filter(c => !c.last_synced_at || c.last_synced_at < stale);
  const until = Date.now() + ((opts && opts.budgetMs) || 30000);
  let synced = 0, failed = 0, skipped = 0;
  for (const c of due) {
    if (Date.now() > until) { skipped++; continue; }
    try { const r = await syncGoogleCalendarForUser(admin, c.user_id, clientId, clientSecret); if (r.success) synced++; else failed++; } catch (e) { failed++; }
  }
  return { connected: (conns || []).length, synced, failed, skipped };
}

// One run. Anyone may call it (pg_cron calls it with no key), so it runs at most every 4 minutes,
// whoever asks; Vercel Cron (CRON_SECRET) always runs.
async function calendarTick(admin, opts) {
  const now = new Date(), force = !!(opts && opts.force);
  const { data: row } = await admin.from('app_storage').select('value').eq('key', 'calendar-tick').maybeSingle();
  let last = null; try { last = row && row.value ? JSON.parse(row.value).at : null; } catch (e) {}
  if (!force && last && now - new Date(last) < 4 * 60 * 1000) return { skipped: 'recent', last };
  await admin.from('app_storage').upsert({ key: 'calendar-tick', value: JSON.stringify({ at: now.toISOString() }), updated_at: now.toISOString() }, { onConflict: 'key' });
  const sync = await syncStaleCalendars(admin, { budgetMs: 35000 }).catch(e => ({ error: String(e) }));
  const alerts = await meetingAlerts(admin, { now: new Date() }).catch(e => ({ error: String(e) }));
  return { sync, alerts };
}

module.exports = { calendarTick, meetingAlerts, syncStaleCalendars, leadMinutes, recipientsOf };
