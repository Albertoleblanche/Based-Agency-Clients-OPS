// Sends messages to Slack — the daily team summary (existing, webhook-
// based), per-client improvement updates posted to that client's own
// mapped channel (bot-token-based), and now per-person DMs mirroring the
// app's own in-app notifications (task assigned, reminders, etc.). The
// first two only ever run after a human has reviewed the exact text and
// clicked confirm — same philosophy as api/send-email.js. The dm action
// is triggered automatically alongside an in-app notification, same as
// the existing push-notification path.
//
// Renamed from send-slack-summary.js now that it does more than
// summaries — same reasoning as google-calendar.js becoming
// integrations.js earlier in this project.
//
// POST body: { action: 'summary', text }
// POST body: { action: 'client-message', clientId, text }
// POST body: { action: 'dm', targetUserId, notificationType, text }

const { createClient } = require('@supabase/supabase-js');
const { sendSlackDM } = require('../lib/slack-notify');

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
  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' });
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

    const { action, text } = req.body || {};
    if (!text) { res.status(400).json({ error: 'Missing text' }); return; }

    // ---- Existing daily-summary flow, unchanged from before the rename ----
    if (!action || action === 'summary') {
      const webhookUrl = process.env.SLACK_WEBHOOK_URL;
      if (!webhookUrl) {
        res.status(500).json({ error: 'Server is not configured with SLACK_WEBHOOK_URL' });
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
      return;
    }

    // ---- New: post a client's improvement update to their own mapped channel ----
    if (action === 'client-message') {
      const { clientId } = req.body;
      if (!clientId) { res.status(400).json({ error: 'Missing clientId' }); return; }

      const botToken = process.env.SLACK_BOT_TOKEN;
      if (!botToken) {
        res.status(500).json({ error: 'Server is not configured with SLACK_BOT_TOKEN' });
        return;
      }

      const { data: mapping } = await admin
        .from('slack_client_channels').select('slack_channel_id').eq('client_id', clientId).maybeSingle();
      if (!mapping) {
        res.status(400).json({ error: 'No Slack channel is mapped for this client yet.' });
        return;
      }

      const slackResponse = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${botToken}` },
        body: JSON.stringify({ channel: mapping.slack_channel_id, text }),
      });
      const slackData = await slackResponse.json();
      // Slack's Web API returns HTTP 200 even on failure — the real
      // success/failure signal is the "ok" field in the body, not the
      // status code. A bot not yet invited to the channel, for example,
      // still comes back as a 200 with ok:false and an error string.
      if (!slackResponse.ok || !slackData.ok) {
        res.status(500).json({ error: `Slack rejected the request: ${slackData.error || 'unknown error'}` });
        return;
      }
      res.status(200).json({ success: true });
      return;
    }

    // ---- New: DM a specific team member, mirroring an in-app notification ----
    if (action === 'dm') {
      const { targetUserId, notificationType } = req.body;
      if (!targetUserId || !notificationType) { res.status(400).json({ error: 'Missing targetUserId or notificationType' }); return; }
      const result = await sendSlackDM(admin, targetUserId, notificationType, text);
      res.status(200).json(result);
      return;
    }

    res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
