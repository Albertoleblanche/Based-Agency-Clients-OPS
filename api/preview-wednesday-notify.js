// Two related but very different preview actions live here — still one
// file/one function, matching the project's action-dispatch convention
// (see send-slack-message.js) rather than a second endpoint:
//
//   action=email (default, or GET) — shows exactly what the Wednesday
//     digest email would send right now. Free, read-only, any signed-in
//     team member can call it — it only reads data already sitting in the
//     database.
//
//   action=proactive — admin-only. Unlike the email preview, this ACTUALLY
//     runs the real website-check + pattern-detection logic (via
//     lib/proactive-insights.js, dryRun mode) to show what the Wednesday
//     automation would currently find. That means it costs real AI API
//     money every time someone clicks it — there's no way to preview
//     "what would an AI website check find" without actually asking the AI
//     to check the website. dryRun mode guarantees it never writes
//     lastProactiveCheckAt (so it doesn't consume a client's spot in next
//     week's real rotation) and never sends a notification to anyone.

const { createClient } = require('@supabase/supabase-js');
const { clientRowFromDb, improvementRowFromDb, runProactiveInsights } = require('../lib/proactive-insights');

async function previewEmail(admin, res) {
  const [{ data: clientsData }, { data: settingsRow }, { data: profiles }] = await Promise.all([
    admin.from('clients').select('name, danger, importance, draft_status, deleted_at'),
    admin.from('app_storage').select('value').eq('key', 'settings').maybeSingle(),
    admin.from('team_profiles').select('role, email'),
  ]);

  const settings = settingsRow ? JSON.parse(settingsRow.value) : {};
  const clients = (clientsData || []).map(c => ({
    name: c.name, danger: c.danger, importance: c.importance,
    draftStatus: c.draft_status, deletedAt: c.deleted_at,
  }));

  const pending = clients.filter(c => c.draftStatus === 'pending' && !c.deletedAt);
  // Role-based against team_profiles — see the matching comment in
  // cron-wednesday-notify.js's runEmailDigest() for why this replaced
  // settings.danielEmail/settings.ericEmail.
  const to = (profiles || []).filter(p => (p.role === 'admin' || p.role === 'approver') && p.email).map(p => p.email).join(',');
  const appUrl = process.env.APP_URL || '';

  if (!pending.length) {
    res.status(200).json({ wouldSend: false, reason: 'No pending drafts right now — the automation would skip sending this week.' });
    return;
  }
  if (!to) {
    res.status(200).json({ wouldSend: false, reason: 'No admin/approver has an email on file — the automation would skip sending until one does.' });
    return;
  }

  const subject = `${pending.length} client update${pending.length !== 1 ? 's' : ''} ready for approval`;
  const bodyLines = pending
    .sort((a, b) => b.danger - a.danger)
    .map(c => `- ${c.name} (danger ${c.danger}/5, importance ${c.importance}/10)`)
    .join('\n');
  const body = `This week's client update drafts are ready for review, sorted by danger score:\n\n${bodyLines}\n\n${appUrl ? `Review and approve here: ${appUrl}` : 'Log in to review and approve.'}`;

  res.status(200).json({ wouldSend: true, to, subject, body, pendingCount: pending.length });
}

async function previewProactive(admin, callerProfile, res) {
  if (!['admin', 'approver'].includes(callerProfile.role)) {
    res.status(403).json({ error: 'Only admins and approvers can run a proactive-insights preview — it costs real API calls, same as the actual weekly run.' });
    return;
  }
  if (callerProfile.role !== 'admin') {
    // Approvers can see the toggle's effects (they get the real weekly
    // notifications too), but only admins can actually spend the API
    // budget on a manual preview run — matches the AI Provider settings
    // themselves being admin-only.
    res.status(403).json({ error: 'Only admins can run a preview — it costs real API calls.' });
    return;
  }

  const { data: settingsRow } = await admin.from('app_storage').select('value').eq('key', 'settings').maybeSingle();
  const settings = settingsRow ? JSON.parse(settingsRow.value) : {};

  if (settings.proactiveInsightsEnabled === false) {
    res.status(200).json({ ran: false, reason: 'Proactive insights are turned off in Settings -> AI & Email — enable it there first.' });
    return;
  }

  const [{ data: clientsData, error: clientsErr }, { data: impData, error: impErr }] = await Promise.all([
    admin.from('clients').select('*'),
    admin.from('client_improvements').select('id, client_id, author, text, date'),
  ]);
  if (clientsErr || impErr) {
    res.status(500).json({ error: (clientsErr || impErr).message });
    return;
  }

  const clients = (clientsData || []).map(clientRowFromDb);
  const improvementsByClient = {};
  (impData || []).forEach(r => {
    (improvementsByClient[r.client_id] = improvementsByClient[r.client_id] || []).push(improvementRowFromDb(r));
  });
  clients.forEach(c => { c.improvements = improvementsByClient[c.id] || []; });

  // log is passed but discarded — dryRun means runProactiveInsights never
  // actually writes to it, this is just satisfying the function's shape.
  const throwawayLog = [];
  const result = await runProactiveInsights(admin, clients, throwawayLog, settings, { dryRun: true });
  res.status(200).json({ ran: true, ...result });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
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
    // Confirm the caller is a real logged-in team member before showing them
    // anything — the email preview is read-only, but still not meant to be public.
    const { data: callerData, error: callerErr } = await admin.auth.getUser(callerToken);
    if (callerErr || !callerData?.user) {
      res.status(401).json({ error: 'Invalid or expired session — please log in again' });
      return;
    }

    const action = req.method === 'GET' ? req.query.action : (req.body || {}).action;

    if (action === 'proactive') {
      const { data: callerProfile, error: profileErr } = await admin
        .from('team_profiles').select('role').eq('id', callerData.user.id).maybeSingle();
      if (profileErr || !callerProfile) {
        res.status(403).json({ error: 'Could not verify your account' });
        return;
      }
      await previewProactive(admin, callerProfile, res);
      return;
    }

    await previewEmail(admin, res);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
