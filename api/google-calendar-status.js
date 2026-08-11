// Read-only status check — "is my Google Calendar connected." The
// google_calendar_connections table itself is admin-only at the RLS level
// (it holds refresh tokens), so a regular user can't query it directly;
// this endpoint answers the one question they're actually allowed to ask
// about it — their own connection status — without ever returning the token.

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

    const { data, error } = await admin
      .from('google_calendar_connections')
      .select('google_email, connected_at, last_synced_at')
      .eq('user_id', userData.user.id)
      .maybeSingle();
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json({
      connected: !!data,
      email: data?.google_email || null,
      connectedAt: data?.connected_at || null,
      lastSyncedAt: data?.last_synced_at || null,
      googleConfigured: !!process.env.GOOGLE_CLIENT_ID,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
