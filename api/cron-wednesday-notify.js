// Runs DAILY via Vercel Cron (see vercel.json) — not weekly. Two genuinely
// separate responsibilities live here, same "bundle it into an existing
// file" discipline as cron-google-calendar-sync.js — there's no spare
// function slot for a second cron job, and Vercel Cron schedules are fixed
// at deploy time in vercel.json, so there's no way for a database setting
// to change WHEN this function actually gets invoked. Instead, this runs
// every day and each responsibility decides for itself whether today is
// its day to actually do anything:
//
//   1. The pending-drafts email digest — hardcoded to Wednesdays only,
//      unchanged from before. (This file is still named
//      cron-wednesday-notify.js because of this, even though it's no
//      longer a weekly invocation.)
//   2. Proactive insights from the Assistant — now genuinely admin
//      day-configurable via settings.proactiveInsightsDayOfWeek (0=Sunday
//      ... 6=Saturday, default 3=Wednesday), checked below. See
//      lib/proactive-insights.js for the actual logic (website
//      spot-checks, cross-client pattern detection, and the real computed
//      metrics that make up the weekly focus report). That file is shared
//      with api/preview-wednesday-notify.js's 'proactive' action, an
//      admin-only on-demand preview — kept in one place so the preview
//      can never silently drift from what this real run actually does.
//
// Both responsibilities run every invocation (after their own day-check
// passes), independently, in their own try/catch — one failing (say, the
// email send) shouldn't block the other.
//
// clients/client_improvements are real tables now (see
// schema-clients-migration.sql), not part of the app_storage JSON blob —
// only the activity log (`log`) still lives there. Client mutations
// (lastProactiveCheckAt) are written with a targeted per-row UPDATE the
// moment they happen inside runProactiveInsights, not batched into one
// end-of-run blob rewrite the way the old app-data.clients array was.

const { createClient } = require('@supabase/supabase-js');
const { sendPushToUser, pushUrlFor } = require('../lib/push-notify');
const { clientRowFromDb, improvementRowFromDb, runProactiveInsights } = require('../lib/proactive-insights');

const EMAIL_DIGEST_DAY_OF_WEEK = 3; // Wednesday, hardcoded — not admin-configurable, unlike proactive insights

async function runEmailDigest(admin, clients, log, settings, resendKey) {
  if (!resendKey) return { skipped: true, reason: 'Missing RESEND_API_KEY' };

  const pending = clients.filter(c => c.draftStatus === 'pending' && !c.deletedAt);
  if (!pending.length) return { skipped: true, reason: 'No pending drafts this week — nothing sent.' };

  // Role-based against team_profiles, not two named settings fields — see
  // getNotifyRecipient()'s comment in index.html for why (this used to be
  // settings.danielEmail/settings.ericEmail, which broke the moment either
  // named person changed role or left).
  const { data: profiles } = await admin.from('team_profiles').select('id, role, email');
  const approverProfiles = (profiles || []).filter(p => (p.role === 'admin' || p.role === 'approver') && p.email);
  const to = approverProfiles.map(p => p.email).join(',');
  if (!to) return { skipped: true, reason: 'No admin/approver has an email on file — nothing sent.' };

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
  if (!emailResponse.ok) return { error: emailData.message || 'Resend rejected the request' };

  log.unshift({
    t: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) + ' UTC',
    tag: 'auto',
    text: `Auto-notified admins &amp; approvers — ${pending.length} draft${pending.length !== 1 ? 's' : ''} pending (Wednesday automation).`,
  });

  // Reuses the same profiles fetched above rather than querying team_profiles
  // a second time — notifyIds is the same admin/approver set the email itself went to.
  const notifyIds = approverProfiles.map(p => p.id);
  if (notifyIds.length) {
    await admin.from('notifications').insert(notifyIds.map(id => ({
      user_id: id, type: 'email_sent', title: 'Client email sent',
      body: `Wednesday automation sent "${subject}" to ${recipients.join(', ')}.`, target_view: 'approve',
    })));
    for (const id of notifyIds) {
      try { await sendPushToUser(admin, id, 'Client email sent', `Wednesday automation sent "${subject}" to ${recipients.join(', ')}.`, pushUrlFor('approve')); } catch (e) {}
    }
  }

  return { success: true, notified: pending.length, emailId: emailData.id };
}

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
  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' });
    return;
  }

  const admin = createClient(supabaseUrl, serviceKey);

  try {
    const [
      { data: appDataRow, error: appDataErr },
      { data: settingsRow, error: settingsErr },
      { data: clientsData, error: clientsErr },
      { data: impData, error: impErr },
    ] = await Promise.all([
      admin.from('app_storage').select('value').eq('key', 'app-data').maybeSingle(),
      admin.from('app_storage').select('value').eq('key', 'settings').maybeSingle(),
      admin.from('clients').select('*'),
      admin.from('client_improvements').select('id, client_id, author, text, date'),
    ]);
    if (appDataErr || settingsErr || clientsErr || impErr) {
      res.status(500).json({ error: (appDataErr || settingsErr || clientsErr || impErr).message });
      return;
    }

    // `log` is still the only thing left in the app_storage blob — clients
    // moved to a real table (see schema-clients-migration.sql).
    const appData = appDataRow ? JSON.parse(appDataRow.value) : { log: [] };
    const settings = settingsRow ? JSON.parse(settingsRow.value) : {};
    const log = appData.log || [];

    const clients = (clientsData || []).map(clientRowFromDb);
    const improvementsByClient = {};
    (impData || []).forEach(r => {
      (improvementsByClient[r.client_id] = improvementsByClient[r.client_id] || []).push(improvementRowFromDb(r));
    });
    clients.forEach(c => { c.improvements = improvementsByClient[c.id] || []; });

    // UTC day-of-week — this cron's schedule (vercel.json) fires at a
    // fixed UTC hour, so comparing against UTC here keeps "which day is
    // it" consistent with when the function actually runs, rather than
    // drifting by timezone.
    const todayDow = new Date().getUTCDay();
    const result = { emailDigest: null, proactiveInsights: null };

    if (todayDow === EMAIL_DIGEST_DAY_OF_WEEK) {
      try {
        result.emailDigest = await runEmailDigest(admin, clients, log, settings, process.env.RESEND_API_KEY);
      } catch (e) {
        result.emailDigest = { error: String(e) };
      }
    } else {
      result.emailDigest = { skipped: true, reason: 'Not Wednesday — this part of the automation only runs on Wednesdays.' };
    }

    // undefined means Wednesday (3) — this setting is new, so an existing
    // deployment that's never touched it keeps running on the same day it
    // always did rather than silently going quiet or jumping to Sunday.
    const proactiveDayOfWeek = settings.proactiveInsightsDayOfWeek ?? 3;
    if (settings.proactiveInsightsEnabled === false) {
      result.proactiveInsights = { skipped: true, reason: 'Disabled in Settings -> AI & Email.' };
    } else if (todayDow !== proactiveDayOfWeek) {
      result.proactiveInsights = { skipped: true, reason: `Not the configured day (day ${proactiveDayOfWeek}) — nothing to do today.` };
    } else {
      try {
        result.proactiveInsights = await runProactiveInsights(admin, clients, log, settings);
      } catch (e) {
        result.proactiveInsights = { error: String(e) };
      }
    }

    // Only `log` needs writing back here — client changes
    // (lastProactiveCheckAt) already wrote themselves via targeted
    // per-row updates inside runProactiveInsights.
    if (log.length > 60) log.length = 60;
    await admin.from('app_storage').upsert(
      { key: 'app-data', value: JSON.stringify({ ...appData, log }) },
      { onConflict: 'key' }
    );

    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
