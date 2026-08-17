// Runs automatically once a day via Vercel Cron (see vercel.json). Bundles
// four genuinely separate daily responsibilities into one function
// specifically to stay under the Hobby plan's function-count limit —
// Google Calendar sync, client-reminder due/escalation checks, and now
// the Harvest catch-up sync too. A daily cadence is the right fit for all
// four: the "Sync now" buttons on Calendar/Profile and the Harvest
// Settings panel cover anyone who wants it sooner than once a day.
//
// Each responsibility runs independently in its own try/catch and writes
// its own key on `result` — none of them can short-circuit another, even
// though the Google Calendar sync has several legitimate early-exit paths
// of its own (not configured, no connections, a query error).

const { createClient } = require('@supabase/supabase-js');
const { syncGoogleCalendarForUser } = require('../lib/google-calendar-sync');
const { syncTimeEntryToHarvest } = require('../lib/harvest-sync');

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

async function syncGoogleCalendarAll(admin) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    // Not an error worth failing loudly over — just means nobody's
    // connected Google Calendar yet, or the deployment hasn't been
    // configured for it.
    return { skipped: true, reason: 'Google Calendar is not configured for this deployment.' };
  }

  const { data: connections, error: connErr } = await admin.from('google_calendar_connections').select('user_id');
  if (connErr) return { error: connErr.message };
  if (!connections || !connections.length) return { skipped: true, reason: 'No connected accounts to sync.' };

  const results = [];
  for (const conn of connections) {
    const syncResult = await syncGoogleCalendarForUser(admin, conn.user_id, clientId, clientSecret);
    results.push({ userId: conn.user_id, ...syncResult });
  }
  const succeeded = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  return {
    success: true,
    accountsSynced: succeeded.length,
    accountsFailed: failed.length,
    totalEventsSynced: succeeded.reduce((sum, r) => sum + (r.synced || 0), 0),
    failures: failed.map(f => ({ userId: f.userId, error: f.error })),
  };
}

async function syncHarvestCatchUp(admin) {
  const { data: connection } = await admin.from('harvest_connection').select('*').eq('id', 1).maybeSingle();
  if (!connection) return { skipped: true, reason: 'Harvest is not connected.' };

  // 'unmapped' deliberately excluded — retrying those without a mapping
  // having changed would just fail the exact same way again. Saving a
  // mapping in the Settings panel requeues affected entries back to
  // 'pending' itself once a mapping actually exists.
  const { data: pending } = await admin.from('time_entries').select('*')
    .in('harvest_sync_status', ['pending', 'failed']).is('deleted_at', null).limit(200);
  if (!pending || !pending.length) return { attempted: 0, synced: 0, failed: 0, unmapped: 0 };

  let synced = 0, failed = 0, unmapped = 0;
  for (const entry of pending) {
    const result = await syncTimeEntryToHarvest(admin, connection, entry);
    await admin.from('time_entries').update({
      harvest_sync_status: result.status,
      harvest_entry_id: result.harvestEntryId || entry.harvest_entry_id || null,
      harvest_sync_error: result.error || null,
    }).eq('id', entry.id);
    if (result.status === 'synced') synced++;
    else if (result.status === 'unmapped') unmapped++;
    else failed++;
  }
  await admin.from('harvest_connection').update({ last_synced_at: new Date().toISOString() }).eq('id', 1);
  return { attempted: pending.length, synced, failed, unmapped };
}

module.exports = async function handler(req, res) {
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
  const result = { calendarSync: null, reminders: null, escalations: null, harvestSync: null };

  try { result.reminders = await notifyDueReminders(admin); }
  catch (e) { result.reminders = { error: String(e) }; }

  try { result.escalations = await notifyEscalatedReminders(admin); }
  catch (e) { result.escalations = { error: String(e) }; }

  try { result.calendarSync = await syncGoogleCalendarAll(admin); }
  catch (e) { result.calendarSync = { error: String(e) }; }

  try { result.harvestSync = await syncHarvestCatchUp(admin); }
  catch (e) { result.harvestSync = { error: String(e) }; }

  res.status(200).json(result);
};
