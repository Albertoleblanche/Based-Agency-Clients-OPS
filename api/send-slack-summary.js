// Sends the daily team summary to Slack. Same philosophy as api/send-email.js
// — this only ever runs after a human has reviewed the exact text and
// clicked confirm; nothing here fires automatically. Available to anyone
// signed in — the text being sent is only ever whatever get-daily-summary.js
// already scoped them to see (their own day for regular members, the whole
// team's for admins/approvers), so there's nothing extra to gate here.

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

  const { text } = req.body || {};
  if (!text) {
    res.status(400).json({ error: 'Missing text' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' });
    return;
  }
  if (!webhookUrl) {
    res.status(500).json({ error: 'Server is not configured with SLACK_WEBHOOK_URL' });
    return;
  }

  const admin = createClient(supabaseUrl, serviceKey);

  try {
    const { data: callerData, error: callerErr } = await admin.auth.getUser(callerToken);
    if (callerErr || !callerData?.user) {
      res.status(401).json({ error: 'Invalid or expired session — please log in again' });
      return;
    }
    const { data: callerProfile, error: profileErr } = await admin
      .from('team_profiles').select('role').eq('id', callerData.user.id).maybeSingle();
    if (profileErr || !callerProfile) {
      res.status(403).json({ error: 'Could not verify your account' });
      return;
    }

    const slackResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!slackResponse.ok) {
      const body = await slackResponse.text();
      res.status(500).json({ error: `Slack rejected the request: ${body}` });
      return;
    }

    res.status(200).json({ success: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
