// Sends messages to Slack — the daily team summary (existing, webhook-
// based), per-client improvement updates posted to that client's own
// mapped channel (bot-token-based), per-person DMs mirroring the app's
// own in-app notifications (task assigned, reminders, etc.), and now
// also the reverse direction: a /task slash command run FROM Slack that
// creates a task IN the app. The first three only ever run after a human
// has reviewed the exact text and clicked confirm (or fire automatically
// alongside an in-app notification, same as the push-notification path).
// The slash command is a direct action someone typed in Slack. Since Nov 23
// Radar can also read the channels it's invited to (Slack's Events API) and
// turn a request to a teammate into a task by itself (lib/slack-tasks.js);
// that's switched off in Settings → Connections → Slack.
//
// bodyParser is disabled for this whole file (not just the slash-command
// path) because Slack's request signature has to be computed over the
// exact raw bytes of the request body — if Vercel's default parser had
// already consumed and reshaped it into an object first, that raw form
// would be gone before this code ever ran. Since that means this file
// now owns all of its own body parsing, the three existing JSON actions
// are handled by manually JSON.parsing the raw body — same effective
// behavior as before, just done by hand instead of automatically.
//
// Renamed from send-slack-summary.js now that it does more than
// summaries — same reasoning as google-calendar.js becoming
// integrations.js earlier in this project.
//
// POST body (JSON):             { action: 'summary', text }
// POST body (JSON):             { action: 'client-message', clientId, text }
// POST body (JSON):             { action: 'dm', targetUserId, notificationType, text }
// POST body (form, from Slack): command=/task&text=...&user_id=...  (see handleTaskSlashCommand)
// POST body (JSON, from Slack): Events API — url_verification, and event_callback for messages and
//   reactions in the channels Radar is in: tasks by themselves (lib/slack-tasks.js, Nov 23).

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { sendSlackDM } = require('../lib/slack-notify');
const { sendPushToUser, pushUrlFor } = require('../lib/push-notify');
const { parseTaskCommandText, handleSlackEvent } = require('../lib/slack-tasks');
// Keeps the function running after Slack has its answer (it wants one within 3 seconds; reading a
// message with the AI can take longer). Without it, the work is done before answering.
let waitUntil = null;
try { ({ waitUntil } = require('@vercel/functions')); } catch (e) {}

module.exports.config = { api: { bodyParser: false } };

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString('utf8');
}

// Slack's own verification algorithm (documented at api.slack.com/authentication/verifying-requests-from-slack).
// Rejects anything older than 5 minutes to block replayed requests, and
// uses a constant-time comparison so the check itself can't leak timing
// information about how close a forged signature got to matching.
function verifySlackSignature(rawBody, headers) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) return { ok: false, reason: 'Server is not configured with SLACK_SIGNING_SECRET' };

  const timestamp = headers['x-slack-request-timestamp'];
  const slackSignature = headers['x-slack-signature'];
  if (!timestamp || !slackSignature) return { ok: false, reason: 'Missing Slack signature headers' };

  const fiveMinutes = 60 * 5;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > fiveMinutes) {
    return { ok: false, reason: 'Request timestamp too old' };
  }

  const baseString = `v0:${timestamp}:${rawBody}`;
  const mySignature = 'v0=' + crypto.createHmac('sha256', signingSecret).update(baseString).digest('hex');

  const a = Buffer.from(mySignature);
  const b = Buffer.from(slackSignature);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'Signature mismatch' };
  }
  return { ok: true };
}

// The command's text is read by parseTaskCommandText (lib/slack-tasks.js): the person, the title,
// due:, and the links, which go on the task.
async function handleTaskSlashCommand(req, res, rawBody, admin) {
  const verification = verifySlackSignature(rawBody, req.headers);
  if (!verification.ok) {
    res.status(401).json({ error: verification.reason });
    return;
  }

  const params = new URLSearchParams(rawBody);
  const command = params.get('command');
  const text = (params.get('text') || '').trim();
  const runnerSlackId = params.get('user_id');

  if (command !== '/task') {
    res.status(200).json({ response_type: 'ephemeral', text: `Unrecognized command: ${command}` });
    return;
  }

  const { assigneeSlackId, dueDate, title, link, description } = parseTaskCommandText(text);
  if (!assigneeSlackId) {
    res.status(200).json({
      response_type: 'ephemeral',
      text: "I didn't find a real mention in there — type `@` and pick someone from the popup list Slack shows you, rather than typing their name as plain text. Example: `/task @ (then select someone) the task title`.",
    });
    return;
  }
  if (!title) {
    res.status(200).json({
      response_type: 'ephemeral',
      text: 'Got the mention, but no task title — add some text after it, like `/task @colleague finish the client deck`.',
    });
    return;
  }

  const { data: profiles } = await admin
    .from('team_profiles').select('id, name, slack_user_id')
    .in('slack_user_id', [assigneeSlackId, runnerSlackId]);

  const assigneeProfile = (profiles || []).find(p => p.slack_user_id === assigneeSlackId);
  const runnerProfile = (profiles || []).find(p => p.slack_user_id === runnerSlackId);

  if (!runnerProfile) {
    res.status(200).json({ response_type: 'ephemeral', text: "Your Slack account isn't linked to the app yet — ask an admin to add your Slack member ID in Team settings." });
    return;
  }
  if (!assigneeProfile) {
    res.status(200).json({ response_type: 'ephemeral', text: "That person's Slack account isn't linked to the app yet — ask an admin to add their Slack member ID in Team settings." });
    return;
  }

  const row = { title, description: description || null, priority: 'medium', status: 'todo',
    assigner_id: runnerProfile.id, assignee_id: assigneeProfile.id, due_date: dueDate, link: link || null };
  let { data: task, error } = await admin.from('tasks').insert(row).select().single();
  if (error && /link/.test(error.message || '')) { const { link: _l, ...rest } = row; ({ data: task, error } = await admin.from('tasks').insert(rest).select().single()); }

  if (error || !task) {
    res.status(200).json({ response_type: 'ephemeral', text: `Couldn't create the task: ${error?.message || 'unknown error'}` });
    return;
  }

  // Bypasses the frontend's sendNotification() entirely (no browser or
  // session involved in a Slack-originated request), so its three
  // effects — in-app row, push, Slack DM — are replicated by hand here,
  // same as the cron reminder functions already do.
  if (assigneeProfile.id !== runnerProfile.id) {
    await admin.from('notifications').insert({
      user_id: assigneeProfile.id, type: 'task_assigned', title: 'New task assigned to you',
      body: `${runnerProfile.name || 'Someone'}: "${title}"`, target_view: 'tasks',
    });
    try { await sendPushToUser(admin, assigneeProfile.id, 'New task assigned to you', `${runnerProfile.name || 'Someone'}: "${title}"`, pushUrlFor('tasks')); } catch (e) {}
    try { await sendSlackDM(admin, assigneeProfile.id, 'task_assigned', `*New task assigned to you*\n${runnerProfile.name || 'Someone'}: "${title}"`); } catch (e) {}
  }

  res.status(200).json({
    response_type: 'ephemeral',
    text: `Task "${title}" assigned to ${assigneeProfile.name || 'them'}${dueDate ? ` (due ${dueDate})` : ''}${link ? `, with the link ${link}` : ''}.`,
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' });
    return;
  }
  const admin = createClient(supabaseUrl, serviceKey);
  const rawBody = await readRawBody(req);
  const contentType = req.headers['content-type'] || '';

  // ---- Slack's own slash-command request — signature-verified, not session-based ----
  if (contentType.includes('application/x-www-form-urlencoded')) {
    try {
      await handleTaskSlashCommand(req, res, rawBody, admin);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
    return;
  }

  // ---- Slack's Events API: the URL check, then messages and reactions (tasks by themselves) ----
  if (req.headers['x-slack-signature']) {
    const verification = verifySlackSignature(rawBody, req.headers);
    if (!verification.ok) { res.status(401).json({ error: verification.reason }); return; }
    let payload = {};
    try { payload = JSON.parse(rawBody || '{}'); } catch (e) { res.status(400).json({ error: 'Malformed JSON body' }); return; }
    if (payload.type === 'url_verification') { res.status(200).json({ challenge: payload.challenge }); return; }
    // Slack sends an event again when it didn't hear back in time; the first one is already being read.
    if (req.headers['x-slack-retry-num']) { res.status(200).json({ ok: true, retry: true }); return; }
    if (payload.type !== 'event_callback') { res.status(200).json({ ok: true }); return; }
    const work = handleSlackEvent(admin, payload, { appUrl: process.env.APP_URL || `https://${req.headers.host}` }).catch(e => ({ error: String(e) }));
    if (waitUntil) { waitUntil(work); res.status(200).json({ ok: true }); return; }
    const result = await work;
    res.status(200).json({ ok: true, result });
    return;
  }

  // ---- Everything below is the app's own frontend calling in, JSON-based ----
  const callerToken = (req.headers.authorization || '').replace('Bearer ', '');
  if (!callerToken) {
    res.status(401).json({ error: 'Not signed in' });
    return;
  }

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

    let body;
    try { body = rawBody ? JSON.parse(rawBody) : {}; }
    catch (e) { res.status(400).json({ error: 'Malformed JSON body' }); return; }

    const { action, text } = body;
    if (!text && action !== 'personal-summaries') { res.status(400).json({ error: 'Missing text' }); return; }

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
        const errBody = await slackResponse.text();
        res.status(500).json({ error: `Slack rejected the request: ${errBody}` });
        return;
      }
      res.status(200).json({ success: true });
      return;
    }

    // ---- Post a client's improvement update to their own mapped channel ----
    if (action === 'client-message') {
      const { clientId } = body;
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

    // ---- DM a specific team member, mirroring an in-app notification ----
    if (action === 'dm') {
      const { targetUserId, notificationType } = body;
      if (!targetUserId || !notificationType) { res.status(400).json({ error: 'Missing targetUserId or notificationType' }); return; }
      const result = await sendSlackDM(admin, targetUserId, notificationType, text);
      res.status(200).json(result);
      return;
    }

    // ---- Send each person their own personal daily summary, replacing the old shared-channel post ----
    if (action === 'personal-summaries') {
      let { date, summary } = body;
      if (!date || !Array.isArray(summary)) { res.status(400).json({ error: 'Missing date or summary' }); return; }

      // Anyone can use this — but a regular member's request is only ever
      // trusted for their own data, regardless of what the submitted array
      // actually contains. This endpoint takes the summary as given by the
      // client rather than re-querying it server-side, so without this a
      // non-admin/approver caller could otherwise claim to be sending on
      // behalf of someone else's userId with fabricated content. In
      // practice a regular member's own data already only ever contains
      // their own entry (get-daily-summary.js already scopes it that way),
      // so this rarely changes anything for them — it just makes that the
      // enforced rule, not an assumption.
      if (!['admin', 'approver'].includes(callerProfile.role)) {
        summary = summary.filter(person => person.userId === callerData.user.id);
      }

      const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      const results = [];

      for (const person of summary) {
        if (!person.userId || !person.entries || !person.entries.length) continue;

        const { data: profile } = await admin
          .from('team_profiles').select('daily_summary_slack_id, slack_user_id').eq('id', person.userId).maybeSingle();
        const overrideId = profile?.daily_summary_slack_id || null;

        const entryLines = person.entries.map(e =>
          `• ${e.client}${e.service ? ` (${e.service})` : ''} — ${formatMinutesServer(e.minutes)}${e.description ? `: ${e.description}` : ''}`
        ).join('\n');
        const personalText = `*Your Daily Summary — ${dateLabel}*\n\n${entryLines}\n\n*Total:* ${formatMinutesServer(person.totalMinutes)}`;

        const result = await sendSlackDM(admin, person.userId, 'daily_summary', personalText, overrideId, { anyDay: true });   // someone pressed Send
        results.push({ userId: person.userId, name: person.name, ...result });
      }

      res.status(200).json({ results });
      return;
    }

    res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};

function formatMinutesServer(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}
