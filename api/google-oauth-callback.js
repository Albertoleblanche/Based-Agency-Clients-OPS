// Google redirects here after the person approves (or denies) calendar
// access. Exchanges the authorization code for a refresh token and stores
// it, then redirects back into the app.

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  const { code, state, error: googleError } = req.query;
  const appUrl = (process.env.APP_URL || `https://${req.headers.host}`).replace(/\/+$/, '');

  // Gmail (Nov 24, lib/gmail-tasks.js) comes back through the same address, with a signed state
  if (String(state || '').includes('.')) {
    const { gmailCallback } = require('../lib/gmail-tasks');
    let to = `${appUrl}/#settings?gmail=error`;
    try { to = await gmailCallback(createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY), req.query || {}, appUrl); } catch (e) {}
    res.writeHead(302, { Location: to }); res.end();
    return;
  }

  if (googleError) {
    res.writeHead(302, { Location: `${appUrl}/#profile?gcal=denied` });
    res.end();
    return;
  }
  if (!code || !state) {
    res.status(400).send('Missing code or state from Google');
    return;
  }

  let userId;
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
    userId = decoded.userId;
  } catch (e) {
    res.status(400).send('Invalid state parameter');
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!supabaseUrl || !serviceKey || !clientId || !clientSecret) {
    res.status(500).send('Server is missing required Google/Supabase environment variables.');
    return;
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const redirectUri = `${appUrl}/api/google-oauth-callback`;

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.refresh_token) {
      // No refresh_token usually means they'd already granted access before
      // without prompt=consent forcing a fresh one — surfaced as an error
      // since sync can never work without it.
      res.writeHead(302, { Location: `${appUrl}/#profile?gcal=error` });
      res.end();
      return;
    }

    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userInfo = await userInfoResponse.json();

    const { error: upsertErr } = await admin.from('google_calendar_connections').upsert({
      user_id: userId,
      refresh_token: tokenData.refresh_token,
      google_email: userInfo.email || null,
      connected_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

    if (upsertErr) {
      res.writeHead(302, { Location: `${appUrl}/#profile?gcal=error` });
      res.end();
      return;
    }

    await require('../lib/conn-alerts').connOk(admin, 'gcal', { userId, force: true }).catch(() => {});   // connected again (Nov 26)
    res.writeHead(302, { Location: `${appUrl}/#profile?gcal=connected` });
    res.end();
  } catch (e) {
    res.writeHead(302, { Location: `${appUrl}/#profile?gcal=error` });
    res.end();
  }
};
