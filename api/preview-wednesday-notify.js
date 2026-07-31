// Shows exactly what the Wednesday automation (api/cron-wednesday-notify.js)
// would send right now, without actually sending anything or logging
// anything. Any logged-in team member can call this — it's purely
// informational, computed with the same logic the real cron job uses.

const { createClient } = require('@supabase/supabase-js');

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
    // anything — this is read-only, but still not meant to be public.
    const { data: callerData, error: callerErr } = await admin.auth.getUser(callerToken);
    if (callerErr || !callerData?.user) {
      res.status(401).json({ error: 'Invalid or expired session — please log in again' });
      return;
    }

    const [{ data: appDataRow }, { data: settingsRow }] = await Promise.all([
      admin.from('app_storage').select('value').eq('key', 'app-data').maybeSingle(),
      admin.from('app_storage').select('value').eq('key', 'settings').maybeSingle(),
    ]);

    const appData = appDataRow ? JSON.parse(appDataRow.value) : { clients: [] };
    const settings = settingsRow ? JSON.parse(settingsRow.value) : {};
    const clients = appData.clients || [];

    const pending = clients.filter(c => c.draftStatus === 'pending');
    const to = [settings.danielEmail, settings.ericEmail].filter(Boolean).join(',');
    const appUrl = process.env.APP_URL || '';

    if (!pending.length) {
      res.status(200).json({ wouldSend: false, reason: 'No pending drafts right now — the automation would skip sending this week.' });
      return;
    }
    if (!to) {
      res.status(200).json({ wouldSend: false, reason: 'No approver emails set in Settings — the automation would skip sending until that\'s filled in.' });
      return;
    }

    const subject = `${pending.length} client update${pending.length !== 1 ? 's' : ''} ready for approval`;
    const bodyLines = pending
      .sort((a, b) => b.danger - a.danger)
      .map(c => `- ${c.name} (danger ${c.danger}/5, importance ${c.importance}/10)`)
      .join('\n');
    const body = `This week's client update drafts are ready for review, sorted by danger score:\n\n${bodyLines}\n\n${appUrl ? `Review and approve here: ${appUrl}` : 'Log in to review and approve.'}`;

    res.status(200).json({ wouldSend: true, to, subject, body, pendingCount: pending.length });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
