// Kicks off Google Calendar OAuth. The person clicks "Connect Google
// Calendar" in Settings, which navigates the browser here (not a fetch —
// this has to be a real navigation since it ends in a redirect to Google).
// Requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to be set in Vercel,
// from a Google Cloud project with the Calendar API enabled and an OAuth
// consent screen configured. See README for the full setup steps.

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  const accessToken = req.query.access_token;
  if (!accessToken) {
    res.status(400).send('Missing access_token');
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!supabaseUrl || !serviceKey) {
    res.status(500).send('Server is not configured with SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return;
  }
  if (!clientId) {
    res.status(500).send('Server is not configured with GOOGLE_CLIENT_ID — see README for Google Calendar setup steps.');
    return;
  }

  const admin = createClient(supabaseUrl, serviceKey);

  try {
    const { data: userData, error: userErr } = await admin.auth.getUser(accessToken);
    if (userErr || !userData?.user) {
      res.status(401).send('Invalid or expired session — please log in again and retry.');
      return;
    }

    const appUrl = process.env.APP_URL || `https://${req.headers.host}`;
    const redirectUri = `${appUrl}/api/google-oauth-callback`;
    const state = Buffer.from(JSON.stringify({ userId: userData.user.id, ts: Date.now() })).toString('base64url');

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/calendar.readonly',
      access_type: 'offline',
      prompt: 'consent', // forces Google to issue a refresh token every time
      state,
    });

    res.writeHead(302, { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
    res.end();
  } catch (e) {
    res.status(500).send(`Error starting Google OAuth: ${String(e)}`);
  }
};
