// Shows exactly what the Wednesday digest email would send right now. Free, read-only, any
// signed-in team member can call it — it only reads data already sitting in the database.
// (The weekly focus report's 'proactive' preview was removed with the report on Nov 19, 2026.)

const { createClient } = require('@supabase/supabase-js');


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

    await previewEmail(admin, res);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
