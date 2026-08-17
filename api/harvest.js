// Harvest time-tracking sync, consolidated into one function — same
// Hobby-plan function-count discipline as google-calendar.js and
// admin-user-actions.js. Handles the full surface area: connect/
// disconnect, status, project/task lookup for the mapping UI, mapping
// CRUD, real-time per-entry sync (create/update/delete), and the daily
// cron catch-up — routed by {action} in the POST body, or by a
// CRON_SECRET bearer token on GET for the scheduled catch-up.
//
// GET  /api/harvest  (user session)     → status check
// GET  /api/harvest  (CRON_SECRET)      → daily catch-up sync
// POST /api/harvest  body: { action: 'connect' | 'disconnect' | 'get-projects'
//        | 'save-client-mapping' | 'save-service-mapping' | 'sync-entry'
//        | 'delete-entry' | 'sync-now' }

const { createClient } = require('@supabase/supabase-js');
const {
  validateHarvestCredentials,
  fetchHarvestProjectsAndTasks,
  syncTimeEntryToHarvest,
  deleteTimeEntryFromHarvest,
} = require('../lib/harvest-sync');

async function runCatchUpSync(admin, connection) {
  // Only entries genuinely worth retrying — 'unmapped' is deliberately
  // excluded here, since re-attempting those without a mapping having
  // changed would just fail the exact same way again. Mapping-save
  // actions below requeue affected 'unmapped' entries back to 'pending'
  // themselves once a mapping actually exists.
  const { data: pending } = await admin
    .from('time_entries').select('*')
    .in('harvest_sync_status', ['pending', 'failed'])
    .is('deleted_at', null)
    .limit(200); // one cron run's worth; anything beyond this catches up next run
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
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' });
    return;
  }
  const admin = createClient(supabaseUrl, serviceKey);

  // ---- Cron-triggered catch-up (no user session involved) ----
  const authHeader = req.headers['authorization'] || '';
  if (req.method === 'GET' && process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`) {
    const { data: connection } = await admin.from('harvest_connection').select('*').eq('id', 1).maybeSingle();
    if (!connection) { res.status(200).json({ skipped: true, reason: 'Harvest is not connected.' }); return; }
    try {
      const result = await runCatchUpSync(admin, connection);
      res.status(200).json(result);
    } catch (e) {
      res.status(200).json({ error: String(e) });
    }
    return;
  }

  // ---- Everything else requires a real signed-in user ----
  const callerToken = authHeader.replace('Bearer ', '');
  if (!callerToken) { res.status(401).json({ error: 'Not signed in' }); return; }
  const { data: userData, error: userErr } = await admin.auth.getUser(callerToken);
  if (userErr || !userData?.user) { res.status(401).json({ error: 'Invalid or expired session — please log in again' }); return; }
  const userId = userData.user.id;

  const { data: profile } = await admin.from('team_profiles').select('role').eq('id', userId).maybeSingle();
  const isAdmin = profile?.role === 'admin';

  // ---- GET: status check ----
  if (req.method === 'GET') {
    const { data: connection } = await admin.from('harvest_connection').select('account_id, connected_at, last_synced_at').eq('id', 1).maybeSingle();
    const { count: clientMappingCount } = await admin.from('harvest_client_mappings').select('*', { count: 'exact', head: true });
    const { count: serviceMappingCount } = await admin.from('harvest_service_mappings').select('*', { count: 'exact', head: true });
    res.status(200).json({
      connected: !!connection,
      accountId: connection?.account_id || null,
      connectedAt: connection?.connected_at || null,
      lastSyncedAt: connection?.last_synced_at || null,
      clientMappingCount: clientMappingCount || 0,
      serviceMappingCount: serviceMappingCount || 0,
    });
    return;
  }

  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const { action } = req.body || {};

  // ---- Admin-only actions ----
  const adminActions = ['connect', 'disconnect', 'get-projects', 'save-client-mapping', 'save-service-mapping', 'sync-now'];
  if (adminActions.includes(action) && !isAdmin) {
    res.status(403).json({ error: 'Only admins can manage the Harvest connection.' });
    return;
  }

  try {
    if (action === 'connect') {
      const { pat, accountId } = req.body;
      if (!pat || !accountId) { res.status(400).json({ error: 'Personal access token and account ID are both required.' }); return; }
      // Validate before saving — a bad token/ID should fail loudly right
      // here, not silently the first time someone's timesheet tries to sync.
      try {
        await validateHarvestCredentials({ personal_access_token: pat, account_id: accountId });
      } catch (e) {
        res.status(400).json({ error: `Couldn't connect: ${e.message}` });
        return;
      }
      const { error } = await admin.from('harvest_connection').upsert({
        id: 1, personal_access_token: pat, account_id: accountId, connected_at: new Date().toISOString(), connected_by: userId,
      });
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.status(200).json({ success: true });
      return;
    }

    if (action === 'disconnect') {
      await admin.from('harvest_connection').delete().eq('id', 1);
      // Mappings deliberately survive a disconnect — reconnecting later
      // (e.g. after rotating the token) shouldn't mean redoing the whole
      // client/service mapping setup from scratch.
      await admin.from('time_entries').update({ harvest_sync_status: 'not_configured' }).in('harvest_sync_status', ['pending', 'failed']);
      res.status(200).json({ success: true });
      return;
    }

    // Everything below needs an active connection.
    const { data: connection } = await admin.from('harvest_connection').select('*').eq('id', 1).maybeSingle();
    if (!connection && action !== 'sync-entry' && action !== 'delete-entry') {
      res.status(400).json({ error: 'Harvest is not connected yet.' });
      return;
    }

    if (action === 'get-projects') {
      const data = await fetchHarvestProjectsAndTasks(connection);
      res.status(200).json(data);
      return;
    }

    if (action === 'save-client-mapping') {
      const { clientId, harvestProjectId, harvestProjectName } = req.body;
      if (!clientId || !harvestProjectId) { res.status(400).json({ error: 'clientId and harvestProjectId are required.' }); return; }
      const { error } = await admin.from('harvest_client_mappings').upsert({
        client_id: clientId, harvest_project_id: String(harvestProjectId), harvest_project_name: harvestProjectName || null,
        updated_at: new Date().toISOString(), updated_by: userId,
      });
      if (error) { res.status(500).json({ error: error.message }); return; }
      // Requeue anything that was stuck unmapped for this client specifically.
      await admin.from('time_entries').update({ harvest_sync_status: 'pending', harvest_sync_error: null })
        .eq('client_id', clientId).eq('harvest_sync_status', 'unmapped');
      res.status(200).json({ success: true });
      return;
    }

    if (action === 'save-service-mapping') {
      const { service, harvestTaskId, harvestTaskName } = req.body;
      if (!service || !harvestTaskId) { res.status(400).json({ error: 'service and harvestTaskId are required.' }); return; }
      const { error } = await admin.from('harvest_service_mappings').upsert({
        service, harvest_task_id: String(harvestTaskId), harvest_task_name: harvestTaskName || null,
        updated_at: new Date().toISOString(), updated_by: userId,
      });
      if (error) { res.status(500).json({ error: error.message }); return; }
      await admin.from('time_entries').update({ harvest_sync_status: 'pending', harvest_sync_error: null })
        .eq('service', service).eq('harvest_sync_status', 'unmapped');
      res.status(200).json({ success: true });
      return;
    }

    // ---- sync-entry / delete-entry: any signed-in user, own entries only ----
    // (Admin gate above only applies to the connection/mapping-management
    // actions — everyone needs to trigger a sync right after logging their
    // own time, same as everyone can log time in the first place.)
    if (action === 'sync-entry') {
      const { timeEntryId } = req.body;
      const { data: entry } = await admin.from('time_entries').select('*').eq('id', timeEntryId).maybeSingle();
      if (!entry) { res.status(404).json({ error: 'Time entry not found.' }); return; }
      if (entry.user_id !== userId && !isAdmin) { res.status(403).json({ error: 'Not your entry.' }); return; }
      if (!connection) {
        await admin.from('time_entries').update({ harvest_sync_status: 'not_configured' }).eq('id', timeEntryId);
        res.status(200).json({ status: 'not_configured' });
        return;
      }
      const result = await syncTimeEntryToHarvest(admin, connection, entry);
      await admin.from('time_entries').update({
        harvest_sync_status: result.status,
        harvest_entry_id: result.harvestEntryId || entry.harvest_entry_id || null,
        harvest_sync_error: result.error || null,
      }).eq('id', timeEntryId);
      res.status(200).json(result);
      return;
    }

    if (action === 'delete-entry') {
      const { harvestEntryId } = req.body;
      if (connection && harvestEntryId) await deleteTimeEntryFromHarvest(connection, harvestEntryId);
      res.status(200).json({ success: true });
      return;
    }

    if (action === 'sync-now') {
      const result = await runCatchUpSync(admin, connection);
      res.status(200).json(result);
      return;
    }

    res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
