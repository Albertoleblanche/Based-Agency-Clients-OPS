// Shared Google Calendar sync logic, used by both the manual "Sync now"
// button (api/google-calendar.js) and the daily cron job
// (api/cron-google-calendar-sync.js). Deliberately placed outside /api —
// Vercel only turns files directly inside /api into serverless functions,
// so this file doesn't count against the Hobby plan's 12-function limit,
// and both callers share one real implementation instead of two copies
// that could quietly drift apart from each other over time.
//
// Returns a plain result object rather than writing to an HTTP response,
// since the manual endpoint handles one user and the cron job loops over
// many — each caller decides what to do with the result.

async function syncGoogleCalendarForUser(admin, userId, clientId, clientSecret) {
  const { data: conn, error: connErr } = await admin
    .from('google_calendar_connections').select('refresh_token').eq('user_id', userId).maybeSingle();
  if (connErr || !conn) {
    return { success: false, error: 'Google Calendar is not connected for this account.' };
  }

  const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: conn.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  });
  const refreshData = await refreshResponse.json();
  if (!refreshResponse.ok || !refreshData.access_token) {
    return { success: false, error: 'Could not refresh Google access — the connection may need to be reconnected.' };
  }

  // Pulls events from 30 days back through 90 days out, tagged with
  // google_event_id so re-syncing updates existing rows instead of
  // duplicating them. Every page (Nov 23: it used to stop at the first 250),
  // so the calendar is complete and what Google no longer has can go.
  const timeMin = new Date(Date.now() - 30*24*60*60*1000).toISOString();
  const timeMax = new Date(Date.now() + 90*24*60*60*1000).toISOString();
  const items = [];
  let pageToken = null, complete = false;
  for (let page = 0; page < 8; page++) {
    const eventsUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?${new URLSearchParams({
      timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250', ...(pageToken ? { pageToken } : {}),
    })}`;
    const eventsResponse = await fetch(eventsUrl, { headers: { Authorization: `Bearer ${refreshData.access_token}` } });
    const eventsData = await eventsResponse.json();
    if (!eventsResponse.ok) {
      if (!items.length) return { success: false, error: eventsData.error?.message || 'Could not fetch events from Google' };
      break;
    }
    items.push(...(eventsData.items || []));
    pageToken = eventsData.nextPageToken || null;
    if (!pageToken) { complete = true; break; }
  }

  let synced = 0;
  let firstError = null;
  const seen = new Set();
  for (const ev of items) {
    if (ev.status === 'cancelled') continue;
    const startAt = ev.start?.dateTime || (ev.start?.date ? `${ev.start.date}T00:00:00Z` : null);
    // an all-day event's end date is the day after it (Google's end is exclusive)
    const endAt = ev.end?.dateTime || (ev.end?.date ? `${dayBefore(ev.end.date)}T23:59:59Z` : null);
    if (!startAt || !endAt) continue;
    seen.add(ev.id);

    // Google returns explicit per-event reminder overrides when the event
    // doesn't just use the calendar's default reminder settings — take the
    // shortest one when there's more than one, since that's the most
    // imminent (and most relevant to show) of the set.
    const overrides = ev.reminders?.overrides || [];
    const reminderMinutes = overrides.length ? Math.min(...overrides.map(o => o.minutes)) : null;

    const row = {
      title: ev.summary || '(no title)',
      description: ev.description || null,
      location: ev.location || null,
      start_at: startAt,
      end_at: endAt,
      all_day: !ev.start?.dateTime,
      created_by: userId,
      event_type: 'meeting',
      google_event_id: ev.id,
      google_calendar_owner: userId,
      reminder_minutes: reminderMinutes,
    };
    // the link to join (Nov 23): Meet, or a Zoom/Teams/… link in the place or the notes
    if (meetColumn !== false) row.meeting_url = meetingUrlOf(ev);
    let { error: upsertErr } = await admin.from('calendar_events').upsert(row, { onConflict: 'google_event_id' });
    if (upsertErr && 'meeting_url' in row && /meeting_url/.test(upsertErr.message || '')) {
      meetColumn = false; delete row.meeting_url;   // addendum-calendar-meetings.sql not run yet
      ({ error: upsertErr } = await admin.from('calendar_events').upsert(row, { onConflict: 'google_event_id' }));
    }
    if (!upsertErr) synced++;
    else if (!firstError) firstError = upsertErr.message;
  }

  // Gone from Google (deleted, or moved out of the window's dates): gone here too. Only when every
  // page came back, so a failed page never takes events away.
  let removed = 0;
  if (complete) {
    const { data: mine } = await admin.from('calendar_events').select('id, google_event_id')
      .eq('google_calendar_owner', userId).not('google_event_id', 'is', null).gte('start_at', timeMin).lte('start_at', timeMax);
    const gone = (mine || []).filter(r => !seen.has(r.google_event_id)).map(r => r.id);
    for (let i = 0; i < gone.length; i += 100) {
      const { error } = await admin.from('calendar_events').delete().in('id', gone.slice(i, i + 100));
      if (!error) removed += Math.min(100, gone.length - i);
    }
  }

  await admin.from('google_calendar_connections').update({ last_synced_at: new Date().toISOString() }).eq('user_id', userId);

  return { success: true, synced, removed, total: items.length, firstError };
}

let meetColumn = null;   // false once calendar_events.meeting_url turns out not to exist
const MEET_RE = /https?:\/\/[^\s<>"')\]]*(?:zoom\.us|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com|whereby\.com|gotomeeting\.com|meet\.jit\.si)[^\s<>"')\]]*/i;
function meetingUrlOf(ev) {
  if (ev.hangoutLink) return ev.hangoutLink;
  const ep = ((ev.conferenceData && ev.conferenceData.entryPoints) || []).find(p => p.entryPointType === 'video' && p.uri);
  if (ep) return ep.uri;
  const m = String(ev.location || '').match(MEET_RE) || String(ev.description || '').match(MEET_RE);
  return m ? m[0].replace(/[.,;]+$/, '') : null;
}
function dayBefore(ymd) {
  const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

module.exports = { syncGoogleCalendarForUser, meetingUrlOf, MEET_RE };
