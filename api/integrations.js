// Google Calendar + Harvest, consolidated into one function — continuing
// the same Hobby-plan function-count discipline as admin-user-actions.js.
// These two used to be separate files (google-calendar.js and harvest.js);
// merging them was necessary, not just tidy — adding harvest.js as an
// 12th file broke the Hobby plan's function-count limit at deploy time.
// oauth-start.js and oauth-callback.js stay separate, since those are
// triggered by a full browser redirect, not a regular fetch() call with a
// JSON body — they don't fit this action-routing shape cleanly.
//
// GET  /api/integrations?provider=google   → Google Calendar status check
// GET  /api/integrations?provider=harvest  → Harvest status check
// POST /api/integrations  body: { provider: 'google', action: 'sync' | 'disconnect' }
// POST /api/integrations  body: { provider: 'harvest', action: 'connect' | 'disconnect'
//        | 'get-projects' | 'save-client-mapping' | 'save-service-mapping'
//        | 'sync-entry' | 'delete-entry' | 'sync-now' | 'sync-setup' }
//   sync-setup: reads Harvest's clients, projects, tasks, assignments and people into Radar.
//   Anyone signed in may ask (the app does when it opens); it runs at most every 10 minutes
//   unless an admin or approver forces it (Sync Now, a full read).
// POST /api/integrations  body: { provider: 'push', action: 'send',
//        targetUserId, title, body, url }
//
// Note: the daily cron catch-up for Harvest lives in
// cron-google-calendar-sync.js now, not here — this file only handles
// requests from a real signed-in user's browser.

const { createClient } = require('@supabase/supabase-js');
const { syncGoogleCalendarForUser } = require('../lib/google-calendar-sync');
const {
  syncHarvestSetup,
  validateHarvestCredentials,
  fetchHarvestProjectsAndTasks,
  syncTimeEntryToHarvest,
  deleteTimeEntryFromHarvest,
} = require('../lib/harvest-sync');
const { sendPushToUser } = require('../lib/push-notify');

module.exports = async function handler(req, res) {
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
    const { data: userData, error: userErr } = await admin.auth.getUser(callerToken);
    if (userErr || !userData?.user) {
      res.status(401).json({ error: 'Invalid or expired session — please log in again' });
      return;
    }
    const userId = userData.user.id;
    const provider = req.method === 'GET' ? req.query.provider : (req.body || {}).provider;

    if (provider !== 'google' && provider !== 'harvest' && provider !== 'push') {
      res.status(400).json({ error: 'Missing or unknown provider — expected "google", "harvest", or "push".' });
      return;
    }

    // ================= GOOGLE CALENDAR =================
    if (provider === 'google') {
      if (req.method === 'GET') {
        const { data, error } = await admin
          .from('google_calendar_connections')
          .select('google_email, connected_at, last_synced_at')
          .eq('user_id', userId)
          .maybeSingle();
        if (error) { res.status(500).json({ error: error.message }); return; }

        res.status(200).json({
          connected: !!data,
          email: data?.google_email || null,
          connectedAt: data?.connected_at || null,
          lastSyncedAt: data?.last_synced_at || null,
          googleConfigured: !!process.env.GOOGLE_CLIENT_ID,
        });
        return;
      }

      if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
      const { action } = req.body || {};

      if (action === 'disconnect') {
        // Removes the stored refresh token and deletes events that were
        // synced from that connection — otherwise disconnecting would leave
        // stale Google-sourced events sitting in the shared calendar forever.
        await admin.from('calendar_events').delete().eq('google_calendar_owner', userId);
        const { error } = await admin.from('google_calendar_connections').delete().eq('user_id', userId);
        if (error) { res.status(500).json({ error: error.message }); return; }
        res.status(200).json({ success: true });
        return;
      }

      if (action === 'sync') {
        const clientId = process.env.GOOGLE_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
          res.status(500).json({ error: 'Server is missing required Google environment variables.' });
          return;
        }
        const result = await syncGoogleCalendarForUser(admin, userId, clientId, clientSecret);
        if (!result.success) { res.status(400).json({ error: result.error }); return; }
        res.status(200).json(result);
        return;
      }

      res.status(400).json({ error: `Unknown action: ${action}` });
      return;
    }

    // ================= HARVEST =================
    if (provider === 'harvest') {
    const { data: profile } = await admin.from('team_profiles').select('role').eq('id', userId).maybeSingle();
    const isAdmin = profile?.role === 'admin';

    if (req.method === 'GET') {
      // select('*') so this still answers before addendum-harvest-sync.sql adds its columns;
      // the token itself never leaves the server
      const { data: connection } = await admin.from('harvest_connection').select('*').eq('id', 1).maybeSingle();
      const { count: clientMappingCount } = await admin.from('harvest_client_mappings').select('*', { count: 'exact', head: true });
      const { count: serviceMappingCount } = await admin.from('harvest_service_mappings').select('*', { count: 'exact', head: true });
      const countOf = async (table, active) => {
        let q = admin.from(table).select('*', { count: 'exact', head: true });
        if (active) q = q.eq('is_active', true);
        const { count, error } = await q;
        return error ? null : (count || 0);
      };
      const [clients, projects, tasks, people] = await Promise.all([
        countOf('harvest_clients', true), countOf('harvest_projects', true), countOf('harvest_tasks', true), countOf('harvest_users', true),
      ]);
      res.status(200).json({
        connected: !!connection,
        accountId: connection?.account_id || null,
        connectedAt: connection?.connected_at || null,
        lastSyncedAt: connection?.last_synced_at || null,
        clientMappingCount: clientMappingCount || 0,
        serviceMappingCount: serviceMappingCount || 0,
        setup: {
          ready: clients !== null,                       // false until addendum-harvest-sync.sql is run
          syncedAt: connection?.setup_synced_at || null,
          fullAt: connection?.setup_full_at || null,
          error: connection?.setup_sync_error || null,
          tokenUser: connection?.token_user_name || null,
          tokenRoles: connection?.token_user_roles || null,
          counts: { clients, projects, tasks, people },
        },
      });
      return;
    }

    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const { action } = req.body || {};

    const isApprover = isAdmin || profile?.role === 'approver';
    if (action === 'get-projects' && !isApprover) {
      res.status(403).json({ error: 'Only admins and approvers can view Harvest mappings.' });
      return;
    }
    const adminActions = ['connect', 'disconnect', 'save-client-mapping', 'save-service-mapping', 'sync-now'];
    if (adminActions.includes(action) && !isAdmin) {
      res.status(403).json({ error: 'Only admins can manage the Harvest connection.' });
      return;
    }

    if (action === 'connect') {
      const { pat, accountId } = req.body;
      if (!pat || !accountId) { res.status(400).json({ error: 'Personal access token and account ID are both required.' }); return; }
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
      await admin.from('time_entries').update({ harvest_sync_status: 'not_configured' }).in('harvest_sync_status', ['pending', 'failed']);
      res.status(200).json({ success: true });
      return;
    }

    const { data: connection } = await admin.from('harvest_connection').select('*').eq('id', 1).maybeSingle();

    if (action === 'sync-setup') {
      if (!profile) { res.status(403).json({ error: 'Only team members can sync Harvest.' }); return; }
      if (!connection) { res.status(200).json({ skipped: 'not-connected' }); return; }
      const force = !!(req.body || {}).force && isApprover;
      if (!('setup_synced_at' in connection)) { res.status(200).json({ skipped: 'needs-sql' }); return; }
      const last = connection.setup_synced_at ? new Date(connection.setup_synced_at).getTime() : 0;
      if (!force && Date.now() - last < 10 * 60000) { res.status(200).json({ skipped: 'recent', syncedAt: connection.setup_synced_at }); return; }
      const result = await syncHarvestSetup(admin, connection, { full: force });
      res.status(200).json(result);
      return;
    }

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
      let synced = 0, failed = 0, unmapped = 0;
      const { data: pending } = await admin.from('time_entries').select('*')
        .in('harvest_sync_status', ['pending', 'failed']).is('deleted_at', null).limit(200);
      for (const entry of (pending || [])) {
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
      res.status(200).json({ attempted: (pending || []).length, synced, failed, unmapped });
      return;
    }

    res.status(400).json({ error: `Unknown action: ${action}` });
    return;
    }

    // ================= PUSH NOTIFICATIONS =================
    if (provider === 'push') {
      if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
      const { action, targetUserId, title, body: notifBody, url: pushUrl } = req.body || {};
      if (action !== 'send') { res.status(400).json({ error: `Unknown action: ${action}` }); return; }
      if (!targetUserId || !title) { res.status(400).json({ error: 'targetUserId and title are required.' }); return; }
      if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
        res.status(500).json({ error: 'Server is not configured with VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY' });
        return;
      }
      const result = await sendPushToUser(admin, targetUserId, title, notifBody, pushUrl);
      res.status(200).json(result);
      return;
    }

    res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
