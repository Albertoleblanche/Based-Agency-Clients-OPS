// Runs automatically once a day via Vercel Cron (see vercel.json) — syncs
// Google Calendar for every connected user, so nobody has to remember to
// click "Sync now" themselves. Once a day is the most frequent schedule
// the Hobby plan allows (see cron-wednesday-notify.js for the same
// constraint); the "Sync now" button on the Calendar tab and Profile page
// covers anyone who wants it sooner than that.
//
// Also checks for client-reminder follow-ups that have come due and
// notifies their owner. This is a genuinely separate responsibility from
// Google Calendar sync, bundled into this same file specifically to avoid
// adding a 12th serverless function on the Hobby plan's function-count
// limit — a daily check is the right cadence for this anyway, since
// follow-up dates are day-granular, not time-sensitive like a meeting
// reminder would be.

const { createClient } = require('@supabase/supabase-js');
const { syncGoogleCalendarForUser } = require('../lib/google-calendar-sync');

async function notifyDueReminders(admin) {
  const today = new Date().toISOString().slice(0, 10);
  // Only reminders that are still 'waiting', due today or earlier, and
  // haven't already been notified — reminder_notified_at prevents renotifying
  // the same person every single day a question stays unanswered past its
  // follow-up date, which the "Then on Aug 10: 🔔 Follow-up needed" example
  // implies is a one-time nudge, not a daily nag.
  const { data: due, error } = await admin
    .from('client_reminders')
    .select('id, client_id, question, asked_by, follow_up_date')
    .eq('status', 'waiting')
    .lte('follow_up_date', today)
    .is('reminder_notified_at', null);
  if (error || !due || !due.length) return { notified: 0 };

  const { data: appDataRow } = await admin.from('app_storage').select('value').eq('key', 'app-data').maybeSingle();
  const clients = appDataRow ? (JSON.parse(appDataRow.value).clients || []) : [];

  for (const r of due) {
    const client = clients.find(c => c.id === r.client_id);
    const clientName = client ? client.name : 'a client';
    await admin.from('notifications').insert({
      user_id: r.asked_by, type: 'reminder_follow_up_due', title: 'Follow-up needed',
      body: `You haven't received a response from ${clientName} regarding: "${r.question}"`,
      target_view: 'reminders',
    });
    await admin.from('client_reminders').update({ reminder_notified_at: today }).eq('id', r.id);
  }
  return { notified: due.length };
}

async function notifyEscalatedReminders(admin) {
  const today = new Date();
  const sevenDaysAgo = new Date(today.getTime() - 7*24*60*60*1000).toISOString().slice(0, 10);
  const todayStr = today.toISOString().slice(0, 10);

  // Still waiting, and its follow-up date was at least 7 days ago —
  // genuinely stale, not just "due today." escalated_at ensures this
  // fires once per reminder, not every day it remains unanswered.
  const { data: stale, error } = await admin
    .from('client_reminders')
    .select('id, client_id, question, asked_by, follow_up_date')
    .eq('status', 'waiting')
    .lte('follow_up_date', sevenDaysAgo)
    .is('escalated_at', null);
  if (error || !stale || !stale.length) return { escalated: 0 };

  const { data: admins } = await admin.from('team_profiles').select('id, role').in('role', ['admin', 'approver']);
  if (!admins || !admins.length) return { escalated: 0 };

  const { data: appDataRow } = await admin.from('app_storage').select('value').eq('key', 'app-data').maybeSingle();
  const clients = appDataRow ? (JSON.parse(appDataRow.value).clients || []) : [];

  for (const r of stale) {
    const client = clients.find(c => c.id === r.client_id);
    const clientName = client ? client.name : 'a client';
    const recipients = admins.filter(a => a.id !== r.asked_by);
    for (const recipient of recipients) {
      await admin.from('notifications').insert({
        user_id: recipient.id, type: 'reminder_escalated', title: 'Follow-up gone quiet',
        body: `${clientName} hasn't responded in over a week regarding: "${r.question}"`,
        target_view: 'client-detail', target_id: r.client_id,
      });
    }
    await admin.from('client_reminders').update({ escalated_at: todayStr }).eq('id', r.id);
  }
  return { escalated: stale.length };
}

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' });
    return;
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const result = { calendarSync: null, reminders: null, escalations: null };

  try {
    result.reminders = await notifyDueReminders(admin);
  } catch (e) {
    result.reminders = { error: String(e) };
  }

  try {
    result.escalations = await notifyEscalatedReminders(admin);
  } catch (e) {
    result.escalations = { error: String(e) };
  }

  if (!clientId || !clientSecret) {
    // Not an error worth failing loudly over — just means nobody's
    // connected Google Calendar yet, or the deployment hasn't been
    // configured for it. Same "not configured" treatment the manual
    // endpoints already give this case. The reminder check above still
    // ran regardless, since it doesn't depend on Google being set up.
    result.calendarSync = { skipped: true, reason: 'Google Calendar is not configured for this deployment.' };
    res.status(200).json(result);
    return;
  }

  try {
    const { data: connections, error: connErr } = await admin.from('google_calendar_connections').select('user_id');
    if (connErr) {
      result.calendarSync = { error: connErr.message };
      res.status(200).json(result);
      return;
    }
    if (!connections || !connections.length) {
      result.calendarSync = { skipped: true, reason: 'No connected accounts to sync.' };
      res.status(200).json(result);
      return;
    }

    const results = [];
    for (const conn of connections) {
      const syncResult = await syncGoogleCalendarForUser(admin, conn.user_id, clientId, clientSecret);
      results.push({ userId: conn.user_id, ...syncResult });
    }

    const succeeded = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    result.calendarSync = {
      success: true,
      accountsSynced: succeeded.length,
      accountsFailed: failed.length,
      totalEventsSynced: succeeded.reduce((sum, r) => sum + (r.synced || 0), 0),
      failures: failed.map(f => ({ userId: f.userId, error: f.error })),
    };
    res.status(200).json(result);
  } catch (e) {
    result.calendarSync = { error: String(e) };
    res.status(200).json(result);
  }
};
