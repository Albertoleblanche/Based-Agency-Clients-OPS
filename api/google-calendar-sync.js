// Pulls events from the caller's connected Google Calendar (last 30 days
// through next 90 days) and upserts them into calendar_events, tagged with
// google_event_id so re-syncing updates existing rows instead of
// duplicating them. Only the person who connected their own calendar can
// trigger a sync for themselves.

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const callerToken = (req.headers.authorization || '').replace('Bearer ', '');
  if (!callerToken) {
    res.status(401).json({ error: 'Not signed in' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!supabaseUrl || !serviceKey || !clientId || !clientSecret) {
    res.status(500).json({ error: 'Server is missing required Google/Supabase environment variables.' });
    return;
  }

  const admin = createClient(supabaseUrl, serviceKey);

  try {
    const { data: userData, error: userErr } = await admin.auth.getUser(callerToken);
    if (userErr || !userData?.user) {
      res.status(401).json({ error: 'Invalid or expired session — please log in again' });
      return;
    }
    const userId = userData.user.id;

    const { data: conn, error: connErr } = await admin
      .from('google_calendar_connections').select('refresh_token').eq('user_id', userId).maybeSingle();
    if (connErr || !conn) {
      res.status(400).json({ error: 'Google Calendar is not connected for this account.' });
      return;
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
      res.status(400).json({ error: 'Could not refresh Google access — the connection may need to be reconnected.' });
      return;
    }

    const timeMin = new Date(Date.now() - 30*24*60*60*1000).toISOString();
    const timeMax = new Date(Date.now() + 90*24*60*60*1000).toISOString();
    const eventsUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?${new URLSearchParams({
      timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
    })}`;
    const eventsResponse = await fetch(eventsUrl, { headers: { Authorization: `Bearer ${refreshData.access_token}` } });
    const eventsData = await eventsResponse.json();
    if (!eventsResponse.ok) {
      res.status(500).json({ error: eventsData.error?.message || 'Could not fetch events from Google' });
      return;
    }

    const items = eventsData.items || [];
    let synced = 0;
    for (const ev of items) {
      if (ev.status === 'cancelled') continue;
      const startAt = ev.start?.dateTime || (ev.start?.date ? `${ev.start.date}T00:00:00Z` : null);
      const endAt = ev.end?.dateTime || (ev.end?.date ? `${ev.end.date}T23:59:59Z` : null);
      if (!startAt || !endAt) continue;

      const { error: upsertErr } = await admin.from('calendar_events').upsert({
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
      }, { onConflict: 'google_event_id' });
      if (!upsertErr) synced++;
    }

    await admin.from('google_calendar_connections').update({ last_synced_at: new Date().toISOString() }).eq('user_id', userId);

    res.status(200).json({ success: true, synced, total: items.length });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
