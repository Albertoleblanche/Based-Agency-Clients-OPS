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
//   2. The weekly-update automations from Settings -> Updates (automatic
//      drafts, reminders for overdue updates and the Monday summary) — see
//      lib/update-automations.js. None of them ever emails a client:
//      approvers send every update themselves.
//
// All of them run every invocation (after their own day-check
// passes), independently, in their own try/catch — one failing (say, the
// email send) shouldn't block the other.
//
// clients/client_improvements are real tables now (see
// schema-clients-migration.sql), not part of the app_storage JSON blob —
// only the activity log (`log`) still lives there.
//
// The weekly focus report (proactive insights) was removed on Nov 19, 2026 along with its tab;
// its table, weekly_focus_reports, is left as it was.

const { createClient } = require('@supabase/supabase-js');
const { sendPushToUser, pushUrlFor } = require('../lib/push-notify');
const { clientRowFromDb, improvementRowFromDb } = require('../lib/client-rows');
const { runUpdateAutomations } = require('../lib/update-automations');
const { purgeRecentlyDeleted } = require('../lib/trash-purge');

const EMAIL_DIGEST_DAY_OF_WEEK = 3; // Wednesday, hardcoded — not admin-configurable

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
  const started = Date.now();

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
      admin.from('client_improvements').select('*'),   // deleted work (addendum-deleted-work.sql) is left out below
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

    const clients = (clientsData || []).filter(r => !(r.custom_field_values && r.custom_field_values.harvestSetup === 'needed')).map(clientRowFromDb);
    const improvementsByClient = {};
    (impData || []).filter(r => !r.deleted_at).forEach(r => {
      (improvementsByClient[r.client_id] = improvementsByClient[r.client_id] || []).push(improvementRowFromDb(r));
    });
    clients.forEach(c => { c.improvements = improvementsByClient[c.id] || []; });

    // UTC day-of-week — this cron's schedule (vercel.json) fires at a
    // fixed UTC hour, so comparing against UTC here keeps "which day is
    // it" consistent with when the function actually runs, rather than
    // drifting by timezone.
    const todayDow = new Date().getUTCDay();
    const result = { weeklyUpdates: null, emailDigest: null };

    // The weekly-update automations (Settings -> Updates): reminders for overdue updates,
    // the Monday summary and automatic drafts. See lib/update-automations.js.
    try {
      result.weeklyUpdates = await runUpdateAutomations(admin, settings, { started });
    } catch (e) {
      result.weeklyUpdates = { error: String(e) };
    }

    // Recently Deleted keeps work, notes and time for 30 days (lib/trash-purge.js)
    try {
      result.recentlyDeleted = await purgeRecentlyDeleted(admin);
    } catch (e) {
      result.recentlyDeleted = { error: String(e) };
    }

    if (todayDow === EMAIL_DIGEST_DAY_OF_WEEK) {
      try {
        result.emailDigest = await runEmailDigest(admin, clients, log, settings, process.env.RESEND_API_KEY);
      } catch (e) {
        result.emailDigest = { error: String(e) };
      }
    } else {
      result.emailDigest = { skipped: true, reason: 'Not Wednesday — this part of the automation only runs on Wednesdays.' };
    }

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
