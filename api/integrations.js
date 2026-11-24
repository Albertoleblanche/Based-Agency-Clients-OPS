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
//        | 'sync-entry' | 'delete-entry' | 'sync-now' | 'sync-setup' | 'link-client' | 'link-clients' | 'link-harvest'
//        | 'work-time' }
//   work-time: { mode: 'trash' | 'restore' | 'forever', improvementIds } — the time logged with
//   deleted (or restored) work moves with it, and Harvest is kept in step (see the handler).
//   (the old client→project and service→task mapping lists are gone, step 5: time is logged by
//   project and task; old entries without one still go through the mappings already saved)
//   sync-setup: reads Harvest's clients, projects, tasks, assignments and people into Radar.
//   Anyone signed in may ask (the app does when it opens); it runs at most every 10 minutes
//   unless an admin or approver forces it (Sync Now, a full read). It also keeps Radar's client
//   list in step with Harvest's (step 2): see syncHarvestClients in lib/harvest-sync.js.
//   link-client (admins and approvers): { clientId, targetId } — a client added from Harvest is
//   one Radar already has; the link and anything logged on it move to that client.
//   link-clients (admins and approvers): { links: [{ clientId, targetId }] } — the same for several
//   at once (Match Harvest Clients); one result each.
//   link-harvest (admins and approvers): { harvestId, targetId } — from where time is logged: Harvest
//   knows this Radar client under another name; its link moves here (moveHarvestLink).
// GET  /api/integrations?provider=slack-me → is your own Slack connected (to nudge teammates as you)
// POST /api/integrations  body: { provider: 'slack-me', action: 'start' (→ Slack's sign-in link) | 'disconnect'
//        | 'send', toProfileId, text } — lib/slack-me.js. Slack comes back to /slack/oauth (?route=slack-me-callback).
// POST /api/integrations  body: { provider: 'push', action: 'send',
//        targetUserId, title, body, url }
// GET  /api/integrations?provider=granola → Granola status (anyone on the team)
// POST /api/integrations  body: { provider: 'granola', action: 'check' } (anyone on the team: Check Granola in
//   Tasks, at most once a minute) | { action: 'connect' (key) | 'disconnect' | 'read-now' | 'read-again' (note) } (admins) | { action: 'remove-meeting' | 'restore-meeting' | 'meeting-tasks' | 'meeting-recap' (note, again) } (people in the meeting, admins, approvers) — tasks from Granola meetings, lib/granola-tasks.js. The webhook Granola calls is
//   /hooks/granola, in api/send-slack-message.js (it needs the raw body).
//
// Two more things live here, reached by rewrites in vercel.json, before the sign-in check:
//   /mcp → ?route=mcp: Radar's MCP server for ChatGPT and Claude (lib/mcp-server.js). They sign in
//     with Supabase's OAuth server and send that token; the server checks it itself.
//   /.well-known/oauth-protected-resource(/mcp) → ?route=oauth-resource: tells them where to sign in.
//
// Note: the daily cron catch-up for Harvest lives in
// cron-google-calendar-sync.js now, not here — this file only handles
// requests from a real signed-in user's browser.

const { createClient } = require('@supabase/supabase-js');
const { syncGoogleCalendarForUser } = require('../lib/google-calendar-sync');
const {
  syncHarvestSetup,
  syncHarvestTime,
  linkHarvestClient,
  moveHarvestLink,
  validateHarvestCredentials,
  harvestFetch,
  syncTimeEntryToHarvest,
  deleteTimeEntryFromHarvest,
} = require('../lib/harvest-sync');
const { sendPushToUser, pushUrlFor } = require('../lib/push-notify');
const { connectGranola, disconnectGranola, granolaStatus, granolaCatchUp, granolaReadNow, granolaReadAgain, removeGranolaMeeting, restoreGranolaMeeting, pullMeetingTasks, draftMeetingRecap } = require('../lib/granola-tasks');
const { handleMcp, protectedResourceMetadata } = require('../lib/mcp-server');
const { slackMeAuthUrl, slackMeCallback, slackMeStatus, slackMeDisconnect, slackMeSend } = require('../lib/slack-me');
const { calendarTick } = require('../lib/meeting-alerts');

module.exports = async function handler(req, res) {
  const route = (req.query || {}).route;
  if (route === 'oauth-resource') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.status(200).json(protectedResourceMetadata(req));
    return;
  }
  if (route === 'mcp') { await handleMcp(req, res); return; }
  // Meetings (Nov 23): Google Calendar synced and "about to start" alerts sent (lib/meeting-alerts.js).
  // Vercel Cron calls it three times a day with CRON_SECRET; Supabase pg_cron every five minutes,
  // with no key, so then it runs at most every four minutes whoever asks.
  if (route === 'calendar-tick') {
    const force = !!process.env.CRON_SECRET && (req.headers.authorization || '') === `Bearer ${process.env.CRON_SECRET}`;
    try { res.status(200).json(await calendarTick(createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY), { force })); }
    catch (e) { res.status(500).json({ error: String(e) }); }
    return;
  }
  // Slack sends someone back here after they let Radar send messages as them (/slack/oauth, Nov 23)
  if (route === 'slack-me-callback') {
    const appUrl = (process.env.APP_URL || `https://${req.headers['x-forwarded-host'] || req.headers.host}`).replace(/\/+$/, '');
    let to = `${appUrl}/#settings?slackme=error`;
    try { to = await slackMeCallback(createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY), req.query || {}, appUrl); } catch (e) {}
    res.writeHead(302, { Location: to }); res.end();
    return;
  }
  // The WhatsApp connector (the office PC) asks for phone pushes for the Radar notifications it just
  // added (Nov 23). It proves itself with the service key it already holds; Radar holds the push keys.
  if (route === 'service-push') {
    const key = String(req.headers['x-radar-service-key'] || ''), want = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
    const same = key.length === want.length && want.length > 20 && require('crypto').timingSafeEqual(Buffer.from(key), Buffer.from(want));
    if (req.method !== 'POST' || !same) { res.status(401).json({ error: 'Not allowed' }); return; }
    const admin = createClient(process.env.SUPABASE_URL, want);
    const pushes = Array.isArray((req.body || {}).pushes) ? req.body.pushes.slice(0, 50) : [];
    let sent = 0;
    for (const p of pushes) {
      if (!p || !p.userId || !p.title) continue;
      try { const r = await sendPushToUser(admin, String(p.userId), String(p.title).slice(0, 120), String(p.body || '').slice(0, 400), pushUrlFor(String(p.view || ''), null)); sent += r.sent || 0; } catch (e) {}
    }
    res.status(200).json({ sent });
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
    const { data: userData, error: userErr } = await admin.auth.getUser(callerToken);
    if (userErr || !userData?.user) {
      res.status(401).json({ error: 'Invalid or expired session — please log in again' });
      return;
    }
    const userId = userData.user.id;
    const provider = req.method === 'GET' ? req.query.provider : (req.body || {}).provider;

    if (provider !== 'google' && provider !== 'harvest' && provider !== 'push' && provider !== 'granola' && provider !== 'slack-me') {
      res.status(400).json({ error: 'Missing or unknown provider — expected "google", "harvest", "push", "granola" or "slack-me".' });
      return;
    }

    // ================= SLACK AS YOU (Nov 23) =================
    // Each person's own Slack, to nudge a teammate as themselves (lib/slack-me.js).
    if (provider === 'slack-me') {
      const { data: me } = await admin.from('team_profiles').select('access_revoked').eq('id', userId).maybeSingle();
      if (!me || me.access_revoked) { res.status(403).json({ error: 'Only team members can do this.' }); return; }
      if (req.method === 'GET') { res.status(200).json(await slackMeStatus(admin, userId)); return; }
      const appUrl = (process.env.APP_URL || `https://${req.headers['x-forwarded-host'] || req.headers.host}`).replace(/\/+$/, '');
      const b = req.body || {};
      const r = b.action === 'start' ? slackMeAuthUrl(userId, appUrl)
        : b.action === 'disconnect' ? await slackMeDisconnect(admin, userId)
        : b.action === 'send' ? await slackMeSend(admin, userId, { toProfileId: b.toProfileId, text: b.text })
        : { error: `Unknown action: ${b.action}`, status: 400 };
      res.status(r.error ? (r.status || 400) : 200).json(r);
      return;
    }

    // ================= GRANOLA =================
    if (provider === 'granola') {
      const { data: me } = await admin.from('team_profiles').select('role, access_revoked, name').eq('id', userId).maybeSingle();
      if (!me || me.access_revoked) { res.status(403).json({ error: 'Only team members can see this.' }); return; }
      const viewer = { id: userId, role: me.role, name: me.name || null, email: userData.user.email };
      const appUrl = (process.env.APP_URL || `https://${req.headers['x-forwarded-host'] || req.headers.host}`).replace(/\/+$/, '');
      if (req.method === 'GET') { res.status(200).json(await granolaStatus(admin, { appUrl, viewer })); return; }
      const { action, key } = req.body || {};
      // Check Granola (Tasks, Notes → Meetings): anyone on the team; at most once a minute for everyone together
      if (action === 'check') { res.status(200).json(await granolaReadNow(admin, { budgetMs: 45000, appUrl })); return; }
      // One meeting (Nov 23): the people who were in it, admins and approvers
      const one = { 'remove-meeting': removeGranolaMeeting, 'restore-meeting': restoreGranolaMeeting, 'meeting-tasks': pullMeetingTasks, 'meeting-recap': draftMeetingRecap }[action];
      if (one) {
        const r = await one(admin, (req.body || {}).note, viewer, { again: !!(req.body || {}).again });
        res.status(r.error ? (r.status || 400) : 200).json(r);
        return;
      }
      if (me.role !== 'admin') { res.status(403).json({ error: 'Only admins can manage the Granola connection.' }); return; }
      if (action === 'connect') {
        const r = await connectGranola(admin, { key, appUrl, userId });
        if (r.error) { res.status(400).json(r); return; }
        const first = await granolaCatchUp(admin, { budgetMs: 35000, sinceDays: 7 });   // the last week, now
        res.status(200).json({ ...r, first });
        return;
      }
      if (action === 'disconnect') { res.status(200).json(await disconnectGranola(admin)); return; }
      if (action === 'read-now') { res.status(200).json(await granolaCatchUp(admin, { budgetMs: 45000, sinceDays: 7, appUrl, forceHook: true })); return; }
      if (action === 'read-again') { res.status(200).json(await granolaReadAgain(admin, (req.body || {}).note)); return; }
      res.status(400).json({ error: `Unknown action: ${action}` });
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
      // the account's web address, for Open Harvest (New Client, step 5)
      let companyUrl = null;
      if (connection && connection.personal_access_token) { try { companyUrl = (await harvestFetch(connection, '/company')).base_uri || null; } catch (e) {} }
      const countOf = async (table, active) => {
        let q = admin.from(table).select('*', { count: 'exact', head: true });
        if (active) q = q.eq('is_active', true);
        const { count, error } = await q;
        return error ? null : (count || 0);
      };
      const [clients, projects, tasks, people] = await Promise.all([
        countOf('harvest_clients', true), countOf('harvest_projects', true), countOf('harvest_tasks', true), countOf('harvest_users', true),
      ]);
      // step 2 needs addendum-harvest-clients.sql
      const { error: linkColErr } = clients === null ? { error: true } : await admin.from('harvest_clients').select('name_at_link').limit(1);
      res.status(200).json({
        connected: !!connection,
        accountId: connection?.account_id || null,
        connectedAt: connection?.connected_at || null,
        lastSyncedAt: connection?.last_synced_at || null,
        companyUrl,
        setup: {
          ready: clients !== null,                       // false until addendum-harvest-sync.sql is run
          clientsReady: !linkColErr,                     // false until addendum-harvest-clients.sql is run
          timeReady: !!connection && 'time_synced_at' in connection, // false until addendum-harvest-time-read.sql is run
          timeSyncedAt: connection?.time_synced_at || null,
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
    const adminActions = ['connect', 'disconnect', 'sync-now'];
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
      // step 4: time logged in Harvest (needs addendum-harvest-time-read.sql)
      try { result.time = await syncHarvestTime(admin, connection, { full: force }); }
      catch (e) { result.time = { error: e.status === 403 ? 'This token isn\'t allowed to read time entries.' : e.message }; }
      res.status(200).json(result);
      return;
    }

    // Match Harvest Clients: link several at once (the app sends up to 15 per request)
    if (action === 'link-clients') {
      if (!isApprover) { res.status(403).json({ error: 'Only admins and approvers link clients.' }); return; }
      const links = Array.isArray((req.body || {}).links) ? req.body.links.slice(0, 30) : [];
      if (!links.length) { res.status(400).json({ error: 'Pick the clients to link.' }); return; }
      const results = [];
      for (const l of links) {
        const clientId = l && l.clientId ? String(l.clientId) : '', targetId = l && l.targetId ? String(l.targetId) : '';
        if (!clientId || !targetId || clientId === targetId) { results.push({ clientId, error: 'Pick the client it’s the same as.' }); continue; }
        try {
          const r = await linkHarvestClient(admin, clientId, targetId);
          results.push(r.error ? { clientId, targetId, error: r.error } : { clientId, targetId, ok: true });
        } catch (e) { results.push({ clientId, targetId, error: e.message }); }
      }
      res.status(200).json({ results });
      return;
    }
    // The time form's Link: Harvest knows this client under another name (lib/harvest-sync.js)
    if (action === 'link-harvest') {
      if (!isApprover) { res.status(403).json({ error: 'Only admins and approvers link clients.' }); return; }
      const { harvestId, targetId } = req.body || {};
      if (!harvestId || !targetId) { res.status(400).json({ error: 'Pick the clients to link.' }); return; }
      const r = await moveHarvestLink(admin, Number(harvestId), String(targetId));
      res.status(r.status || 200).json(r.error ? { error: r.error } : r);
      return;
    }
    if (action === 'link-client') {
      if (!isApprover) { res.status(403).json({ error: 'Only admins and approvers link clients.' }); return; }
      const { clientId, targetId } = req.body || {};
      if (!clientId || !targetId || clientId === targetId) { res.status(400).json({ error: 'Pick the client it’s the same as.' }); return; }
      const r = await linkHarvestClient(admin, String(clientId), String(targetId));
      res.status(r.status).json(r.error ? { error: r.error } : r);
      return;
    }

    // Work and the time logged with it (time_entries.improvement_id) go to Recently Deleted together
    // and come back together (addendum-deleted-work.sql). The browser moves the work first; this moves
    // its time, which may be someone else's (an approver deleting a member's work), so it happens here,
    // past the time_entries policies. Only time whose work is already where it's going is moved, so
    // nothing else can be moved this way. Harvest is kept in step: the entry is deleted there now, and
    // made again on restore. 'forever' deletes the time and then the work (its writer, whoever deleted
    // it, or an approver).
    if (action === 'work-time') {
      if (!profile) { res.status(403).json({ error: 'Only team members can do this.' }); return; }
      const mode = String((req.body || {}).mode || '');
      const ids = [...new Set(((req.body || {}).improvementIds || []).map(String))].slice(0, 500);
      if (!['trash', 'restore', 'forever'].includes(mode)) { res.status(400).json({ error: 'Unknown mode.' }); return; }
      if (!ids.length) { res.status(200).json({ moved: 0 }); return; }
      const { data: imps, error: iErr } = await admin.from('client_improvements').select('*').in('id', ids);
      if (iErr) { res.status(500).json({ error: iErr.message }); return; }
      let workIds = (imps || []).filter(i => (mode === 'restore' ? !i.deleted_at : !!i.deleted_at)).map(i => String(i.id));
      if (mode === 'forever') {
        const { data: me } = await admin.from('team_profiles').select('name').eq('id', userId).maybeSingle();
        workIds = (imps || []).filter(i => i.deleted_at && (isApprover || (me && i.author === me.name) || i.deleted_by === userId)).map(i => String(i.id));
      }
      if (!workIds.length) { res.status(200).json({ moved: 0 }); return; }
      let q = admin.from('time_entries').select('*').in('improvement_id', workIds);
      q = mode === 'trash' ? q.is('deleted_at', null) : q.not('deleted_at', 'is', null);
      const { data: entries, error: tErr } = await q;
      if (tErr) {
        // before addendum-deleted-work.sql there's no link: nothing to move
        if (/improvement_id/.test(tErr.message || '')) { res.status(200).json({ moved: 0 }); return; }
        res.status(500).json({ error: tErr.message }); return;
      }
      const list = entries || [], eIds = list.map(e => e.id);
      if (mode === 'trash') {
        if (eIds.length) await admin.from('time_entries').update({ deleted_at: new Date().toISOString() }).in('id', eIds);
        if (connection) for (const e of list) if (e.harvest_entry_id) await deleteTimeEntryFromHarvest(connection, e.harvest_entry_id);
      } else if (mode === 'restore') {
        if (eIds.length) await admin.from('time_entries').update({ deleted_at: null, harvest_entry_id: null, harvest_sync_error: null,
          harvest_sync_status: connection ? 'pending' : 'not_configured' }).in('id', eIds);
        if (connection) for (const e of list) {
          const result = await syncTimeEntryToHarvest(admin, connection, { ...e, deleted_at: null, harvest_entry_id: null });
          if (result.harvestEntryId) await admin.from('time_entries').delete().eq('harvest_entry_id', result.harvestEntryId).eq('source', 'harvest').neq('id', e.id);
          await admin.from('time_entries').update({ harvest_sync_status: result.status, harvest_entry_id: result.harvestEntryId || null, harvest_sync_error: result.error || null }).eq('id', e.id);
        }
      } else {
        if (eIds.length) await admin.from('time_entries').delete().in('id', eIds);
      }
      res.status(200).json({ moved: eIds.length, entries: eIds });
      return;
    }

    if (!connection && action !== 'sync-entry' && action !== 'delete-entry') {
      res.status(400).json({ error: 'Harvest is not connected yet.' });
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
      // whatever goes wrong, the entry says so (left "pending", it would wait for the nightly retry unseen)
      let result;
      try { result = await syncTimeEntryToHarvest(admin, connection, entry); }
      catch (e) { result = { status: 'failed', error: e.message || 'Couldn’t reach Harvest.' }; }
      // a read from Harvest may have brought this entry in already, before its id was saved here
      if (result.harvestEntryId) await admin.from('time_entries').delete().eq('harvest_entry_id', result.harvestEntryId).eq('source', 'harvest').neq('id', timeEntryId);
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
        if (result.harvestEntryId) await admin.from('time_entries').delete().eq('harvest_entry_id', result.harvestEntryId).eq('source', 'harvest').neq('id', entry.id);
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
