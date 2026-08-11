// Google Calendar status/sync/disconnect, consolidated into one function —
// continuing the same Hobby-plan function-count reduction as
// admin-user-actions.js. oauth-start.js and oauth-callback.js stay
// separate, since those are triggered by a full browser redirect (Google
// itself sends the browser to oauth-callback with query params), not a
// regular fetch() call with a JSON body — they don't fit this same
// action-routing shape cleanly.
//
// GET  /api/google-calendar          → status check (unchanged from before)
// POST /api/google-calendar          → body: { action: 'sync' | 'disconnect' }

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  const callerToken = (req.headers.authorization || '').replace('Bearer ', '');
  if (!callerToken) {
    res.status(401).json({ error: 'Not signed in' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' });
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

    // ---- GET: status check ----
    if (req.method === 'GET') {
      const { data, error } = await admin
        .from('google_calendar_connections')
        .select('google_email, connected_at, last_synced_at')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) { res.status(500).json({ error: error.message }); return; }

      res.status(200).json({
        connected: !!data,
        email: data?.google_email || null,
        connectedAt: data?.connected_at || null,
        lastSyncedAt: data?.last_synced_at || null,
        googleConfigured: !!process.env.GOOGLE_CLIENT_ID,
      });
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const { action } = req.body || {};

    // ---- POST action: disconnect ----
    if (action === 'disconnect') {
      // Removes the stored refresh token and deletes events that were
      // synced from that connection — otherwise disconnecting would leave
      // stale Google-sourced events sitting in the shared calendar forever.
      await admin.from('calendar_events').delete().eq('google_calendar_owner', userId);
      const { error } = await admin.from('google_calendar_connections').delete().eq('user_id', userId);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.status(200).json({ success: true });
      return;
    }

    // ---- POST action: sync ----
    if (action === 'sync') {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        res.status(500).json({ error: 'Server is missing required Google environment variables.' });
        return;
      }

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

      // Pulls events from 30 days back through 90 days out, tagged with
      // google_event_id so re-syncing updates existing rows instead of
      // duplicating them.
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
      let firstError = null;
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
        else if (!firstError) firstError = upsertErr.message;
      }

      await admin.from('google_calendar_connections').update({ last_synced_at: new Date().toISOString() }).eq('user_id', userId);

      res.status(200).json({ success: true, synced, total: items.length, firstError });
      return;
    }

    res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
