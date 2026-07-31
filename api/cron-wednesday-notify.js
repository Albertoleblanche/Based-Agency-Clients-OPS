// Runs automatically every Wednesday via Vercel Cron (see vercel.json) — this
// is the fully hands-off version of clicking "Notify Daniel & Eric." It reads
// the current client data directly from Supabase (using the service role key,
// since there's no logged-in user in a cron job), and sends the same
// pending-drafts summary email the manual button sends — but only if there's
// actually something pending, so it doesn't spam an empty email every week.

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  // Vercel automatically sends this header on real cron invocations — this
  // check is what stops anyone else from hitting this URL and triggering it
  // on demand. CRON_SECRET is auto-provisioned by Vercel, nothing to set up.
  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' });
    return;
  }
  if (!resendKey) {
    res.status(500).json({ error: 'Missing RESEND_API_KEY' });
    return;
  }

  const admin = createClient(supabaseUrl, serviceKey);

  try {
    const [{ data: appDataRow, error: appDataErr }, { data: settingsRow, error: settingsErr }] = await Promise.all([
      admin.from('app_storage').select('value').eq('key', 'app-data').maybeSingle(),
      admin.from('app_storage').select('value').eq('key', 'settings').maybeSingle(),
    ]);
    if (appDataErr || settingsErr) {
      res.status(500).json({ error: (appDataErr || settingsErr).message });
      return;
    }

    const appData = appDataRow ? JSON.parse(appDataRow.value) : { clients: [], log: [] };
    const settings = settingsRow ? JSON.parse(settingsRow.value) : {};
    const clients = appData.clients || [];
    const log = appData.log || [];

    const pending = clients.filter(c => c.draftStatus === 'pending');
    if (!pending.length) {
      res.status(200).json({ skipped: true, reason: 'No pending drafts this week — nothing sent.' });
      return;
    }

    const to = [settings.danielEmail, settings.ericEmail].filter(Boolean).join(',');
    if (!to) {
      res.status(200).json({ skipped: true, reason: 'No approver emails configured in Settings — nothing sent.' });
      return;
    }

    const appUrl = process.env.APP_URL || '';
    const subject = `${pending.length} client update${pending.length !== 1 ? 's' : ''} ready for approval`;
    const bodyLines = pending
      .sort((a, b) => b.danger - a.danger)
      .map(c => `- ${c.name} (danger ${c.danger}/5, importance ${c.importance}/10)`)
      .join('\n');
    const body = `This week's client update drafts are ready for review, sorted by danger score:\n\n${bodyLines}\n\n${appUrl ? `Review and approve here: ${appUrl}` : 'Log in to review and approve.'}`;

    const from = process.env.EMAIL_FROM || 'Based Agency <onboarding@resend.dev>';
    const recipients = to.split(',').map(s => s.trim()).filter(Boolean);

    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendKey}` },
      body: JSON.stringify({ from, to: recipients, subject, text: body }),
    });
    const emailData = await emailResponse.json();
    if (!emailResponse.ok) {
      res.status(500).json({ error: emailData.message || 'Resend rejected the request' });
      return;
    }

    // Record it in the shared Activity Log so the team sees this happened
    // automatically, same as any manual action would show up.
    log.unshift({
      t: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) + ' UTC',
      tag: 'auto',
      text: `Auto-notified Daniel &amp; Eric — ${pending.length} draft${pending.length !== 1 ? 's' : ''} pending (Wednesday automation).`,
    });
    if (log.length > 60) log.length = 60;
    await admin.from('app_storage').upsert(
      { key: 'app-data', value: JSON.stringify({ ...appData, log }) },
      { onConflict: 'key' }
    );

    res.status(200).json({ success: true, notified: pending.length, emailId: emailData.id });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
