// Admin-only actions on a team member's account, consolidated into one
// function — Vercel's Hobby plan caps a deployment at 12 serverless
// functions, and this project had grown past that with many small,
// single-purpose files. These five shared the exact same shape (verify the
// caller is really an admin via the service role, then act on someone
// else's account), so they're combined here behind a single `action` field
// in the request body, rather than five files each repeating the same
// auth-check code.
//
// Frontend calls this the same way as before, just with an added `action`
// field and everything else as it already was:
//   POST /api/admin-user-actions
//   body: { action: 'reset-password' | 'approve-email-change' |
//           'create-member' | 'delete-user' | 'toggle-access', ...fields }

const { createClient } = require('@supabase/supabase-js');
const { sendPushToUser } = require('../lib/push-notify');

function generateTempPassword() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%&*';
  const all = letters + digits + symbols;
  const pick = (set) => set[Math.floor(Math.random() * set.length)];
  let pw = pick(letters) + pick(digits) + pick(symbols);
  for (let i = 0; i < 9; i++) pw += pick(all);
  return pw.split('').sort(() => Math.random() - 0.5).join('');
}

// Validates a key against the real provider before it's ever saved — same
// "test before storing" reasoning as validateHarvestCredentials() in
// lib/harvest-sync.js. Uses the actually-configured model (falling back to
// the same default the rest of the app uses) so the test reflects real
// usage, not just "is this well-formed" — a key with access to some
// models but not the one this deployment is set to use should fail here,
// not on the first real message someone sends.
async function validateAnthropicKey(apiKey, model) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: model || 'claude-sonnet-5', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
  });
  if (res.ok) return { ok: true };
  const data = await res.json().catch(() => null);
  return { ok: false, error: data?.error?.message || `Anthropic rejected the request (${res.status})` };
}

// Listing models is a genuinely free OpenAI call — confirms the key
// actually authenticates without spending anything on a real completion.
// A custom baseUrl (a third-party OpenAI-compatible endpoint) is instead
// validated with a minimal real chat completion, since not every provider
// implements a models-list endpoint the same way OpenAI does, but
// virtually all of them implement /chat/completions if they claim
// compatibility at all — and that's the actual endpoint that matters.
async function validateOpenAIKey(apiKey, baseUrl, model) {
  const cleanUrl = (baseUrl || '').replace(/\/+$/, '');
  const isOfficial = !cleanUrl || cleanUrl === 'https://api.openai.com/v1';

  if (isOfficial) {
    const res = await fetch('https://api.openai.com/v1/models', { headers: { 'Authorization': `Bearer ${apiKey}` } });
    if (res.ok) return { ok: true };
    const data = await res.json().catch(() => null);
    return { ok: false, error: data?.error?.message || `OpenAI rejected the request (${res.status})` };
  }

  try {
    const res = await fetch(`${cleanUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: model || 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
    });
    if (res.ok) return { ok: true };
    const data = await res.json().catch(() => null);
    return { ok: false, error: data?.error?.message || `The endpoint rejected the request (${res.status})` };
  } catch (e) {
    return { ok: false, error: `Could not reach that endpoint — check the URL. (${e.message})` };
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { action } = req.body || {};
  if (!action) {
    res.status(400).json({ error: 'Missing action' });
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
    const { data: callerData, error: callerErr } = await admin.auth.getUser(callerToken);
    if (callerErr || !callerData?.user) {
      res.status(401).json({ error: 'Invalid or expired session — please log in again' });
      return;
    }
    const { data: callerProfile, error: profileErr } = await admin
      .from('team_profiles').select('role, extra_permissions').eq('id', callerData.user.id).maybeSingle();
    if (profileErr || !callerProfile) {
      res.status(403).json({ error: 'Only admins can perform this action' });
      return;
    }
    // Every action in this file was admin-only until AI Visibility's
    // report-building flow needed to call four of them (pulling Quick
    // Metrics/Overview/keyword data from the in-house tool) for anyone
    // granted the new view_ai_visibility permission, not just admins —
    // see EXTRA_PERMISSIONS_META in index.html. Everything else here
    // (team management, AI provider connections, the in-house tool's own
    // connection credentials) stays admin-only, since granting
    // view_ai_visibility is about using reports, not managing the
    // underlying integration or the team itself.
    const AI_VISIBILITY_DATA_ACTIONS = ['list-inhouse-clients', 'list-inhouse-scans', 'fetch-inhouse-metrics', 'fetch-inhouse-keywords'];
    const isCallerAdmin = callerProfile.role === 'admin';
    const hasAiVisibilityPermission = Array.isArray(callerProfile.extra_permissions) && callerProfile.extra_permissions.includes('view_ai_visibility');
    const allowed = isCallerAdmin || (AI_VISIBILITY_DATA_ACTIONS.includes(action) && hasAiVisibilityPermission);
    if (!allowed) {
      res.status(403).json({ error: 'Only admins can perform this action' });
      return;
    }
    const callerId = callerData.user.id;

    if (action === 'reset-password') {
      const { targetUserId } = req.body || {};
      if (!targetUserId) { res.status(400).json({ error: 'Missing targetUserId' }); return; }
      const tempPassword = generateTempPassword();
      const { error: updateErr } = await admin.auth.admin.updateUserById(targetUserId, { password: tempPassword });
      if (updateErr) { res.status(500).json({ error: updateErr.message }); return; }
      res.status(200).json({ success: true, tempPassword });
      return;
    }

    if (action === 'toggle-access') {
      const { targetUserId, revoke } = req.body || {};
      if (!targetUserId || typeof revoke !== 'boolean') { res.status(400).json({ error: 'Missing targetUserId or revoke' }); return; }
      if (targetUserId === callerId) { res.status(400).json({ error: "You can't revoke your own access" }); return; }
      // Supabase bans are expressed as a duration, not a boolean — "876000h"
      // (100 years) is the conventional way to represent an indefinite ban.
      const { error: updateErr } = await admin.auth.admin.updateUserById(targetUserId, { ban_duration: revoke ? '876000h' : 'none' });
      if (updateErr) { res.status(500).json({ error: updateErr.message }); return; }
      // Mirror the real ban state onto team_profiles, which the frontend's
      // regular client can actually read — auth.users itself is
      // service-role only, so without this the UI would have no way to
      // show the status.
      await admin.from('team_profiles').update({ access_revoked: revoke }).eq('id', targetUserId);
      res.status(200).json({ success: true, revoked: revoke });
      return;
    }

    if (action === 'delete-user') {
      const { targetUserId } = req.body || {};
      if (!targetUserId) { res.status(400).json({ error: 'Missing targetUserId' }); return; }
      if (targetUserId === callerId) { res.status(400).json({ error: "You can't delete your own account" }); return; }
      const { error: deleteErr } = await admin.auth.admin.deleteUser(targetUserId);
      if (deleteErr) { res.status(500).json({ error: deleteErr.message }); return; }
      res.status(200).json({ success: true });
      return;
    }

    if (action === 'create-member') {
      const { name, email, role, title } = req.body || {};
      if (!name || !email || !role) { res.status(400).json({ error: 'Missing name, email, or role' }); return; }
      if (!['admin', 'approver', 'member'].includes(role)) { res.status(400).json({ error: 'Role must be admin, approver, or member' }); return; }
      // Generate a temporary password — shown once so the admin can relay it directly.
      const tempPassword = Math.random().toString(36).slice(-8) + 'Aa1!';
      const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
        email, password: tempPassword, email_confirm: true, // skip email verification, since there may be no SMTP configured
      });
      if (createErr) { res.status(400).json({ error: createErr.message }); return; }
      const { error: insertErr } = await admin.from('team_profiles').insert({
        id: newUser.user.id, email, name, role, title: title || null,
        // Matches the current default expectation — admins/approvers start
        // with Assistant access, members start without it. Either can be
        // flipped per-person afterward from their team card.
        ai_chat_enabled: role === 'admin' || role === 'approver',
      });
      if (insertErr) { res.status(400).json({ error: insertErr.message }); return; }
      res.status(200).json({ success: true, email, tempPassword });
      return;
    }

    if (action === 'approve-email-change') {
      const { requestId, approve } = req.body || {};
      if (!requestId || typeof approve !== 'boolean') { res.status(400).json({ error: 'Missing requestId or approve' }); return; }
      const { data: reqRow, error: reqErr } = await admin.from('email_change_requests').select('*').eq('id', requestId).maybeSingle();
      if (reqErr || !reqRow) { res.status(404).json({ error: 'Request not found' }); return; }
      if (reqRow.status !== 'pending') { res.status(400).json({ error: 'This request has already been resolved' }); return; }
      if (approve) {
        const { error: updateAuthErr } = await admin.auth.admin.updateUserById(reqRow.user_id, { email: reqRow.requested_email });
        if (updateAuthErr) { res.status(500).json({ error: `Could not update login email: ${updateAuthErr.message}` }); return; }
        await admin.from('team_profiles').update({ email: reqRow.requested_email }).eq('id', reqRow.user_id);
      }
      await admin.from('email_change_requests').update({
        status: approve ? 'approved' : 'denied', resolved_at: new Date().toISOString(), resolved_by: callerId,
      }).eq('id', requestId);
      await admin.from('notifications').insert({
        user_id: reqRow.user_id,
        type: approve ? 'email_change_approved' : 'email_change_denied',
        title: approve ? 'Email change approved' : 'Email change request denied',
        body: approve
          ? `Your email is now ${reqRow.requested_email}. Use it to log in next time.`
          : `Your request to change your email to ${reqRow.requested_email} was denied.`,
        target_view: 'profile',
      });
      try{
        await sendPushToUser(admin, reqRow.user_id,
          approve ? 'Email change approved' : 'Email change request denied',
          approve ? `Your email is now ${reqRow.requested_email}.` : `Your request to change your email was denied.`
        );
      }catch(e){}
      res.status(200).json({ success: true });
      return;
    }

    if (action === 'get-ai-connections') {
      // Never returns api_key — only whether something's connected and
      // when, plus whether a Vercel environment variable is ALSO/instead
      // configured (the old way), so the admin sees the complete picture
      // regardless of which method set it up.
      const { data: rows } = await admin.from('ai_provider_connections').select('provider, connected_at, base_url');
      const byProvider = {};
      (rows || []).forEach(r => { byProvider[r.provider] = r; });
      res.status(200).json({
        claude: { connected: !!byProvider.claude, connectedAt: byProvider.claude?.connected_at || null, envConfigured: !!process.env.ANTHROPIC_API_KEY },
        openai: { connected: !!byProvider.openai, connectedAt: byProvider.openai?.connected_at || null, envConfigured: !!process.env.OPENAI_API_KEY, baseUrl: byProvider.openai?.base_url || null },
      });
      return;
    }

    if (action === 'connect-ai-provider') {
      const { provider, apiKey, baseUrl } = req.body || {};
      if (!['claude', 'openai'].includes(provider)) { res.status(400).json({ error: 'provider must be "claude" or "openai"' }); return; }
      if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) { res.status(400).json({ error: 'Missing apiKey' }); return; }
      const trimmedKey = apiKey.trim();
      const trimmedBaseUrl = (provider === 'openai' && typeof baseUrl === 'string') ? baseUrl.trim() || null : null;
      if (trimmedBaseUrl && !/^https?:\/\//i.test(trimmedBaseUrl)) { res.status(400).json({ error: 'Base URL must start with http:// or https://' }); return; }

      // Tested against the real provider before it's ever saved — same
      // reasoning as validateHarvestCredentials() elsewhere in this app.
      let validation;
      const { data: settingsRow } = await admin.from('app_storage').select('value').eq('key', 'settings').maybeSingle();
      const settings = settingsRow ? JSON.parse(settingsRow.value) : {};
      if (provider === 'claude') {
        validation = await validateAnthropicKey(trimmedKey, settings.claudeModel);
      } else {
        validation = await validateOpenAIKey(trimmedKey, trimmedBaseUrl, settings.openaiModel);
      }
      if (!validation.ok) { res.status(400).json({ error: `Couldn't connect: ${validation.error}` }); return; }

      const { error: upsertErr } = await admin.from('ai_provider_connections').upsert({
        provider, api_key: trimmedKey, base_url: trimmedBaseUrl, connected_at: new Date().toISOString(), connected_by: callerId,
      });
      if (upsertErr) { res.status(500).json({ error: upsertErr.message }); return; }
      res.status(200).json({ success: true });
      return;
    }

    if (action === 'disconnect-ai-provider') {
      const { provider } = req.body || {};
      if (!['claude', 'openai'].includes(provider)) { res.status(400).json({ error: 'provider must be "claude" or "openai"' }); return; }
      const { error: deleteErr } = await admin.from('ai_provider_connections').delete().eq('provider', provider);
      if (deleteErr) { res.status(500).json({ error: deleteErr.message }); return; }
      res.status(200).json({ success: true });
      return;
    }

    // ---- In-house metrics tool connection — a real, direct Supabase
    // integration against Based Agency's own tool, with a known,
    // confirmed schema. Reuses ai_provider_connections again
    // (provider='inhouse_metrics'): api_key holds the anon key, base_url
    // holds the Supabase project URL.
    if (action === 'save-inhouse-metrics-connection') {
      const { projectUrl, anonKey } = req.body || {};
      if (!projectUrl || typeof projectUrl !== 'string' || !projectUrl.trim()) { res.status(400).json({ error: 'Missing projectUrl' }); return; }
      if (!anonKey || typeof anonKey !== 'string' || !anonKey.trim()) { res.status(400).json({ error: 'Missing anonKey' }); return; }
      const { error: upsertErr } = await admin.from('ai_provider_connections').upsert({
        provider: 'inhouse_metrics', api_key: anonKey.trim(), base_url: projectUrl.trim().replace(/\/+$/, ''), connected_at: new Date().toISOString(), connected_by: callerId,
      });
      if (upsertErr) { res.status(500).json({ error: upsertErr.message }); return; }
      res.status(200).json({ success: true });
      return;
    }

    if (action === 'get-inhouse-metrics-connection') {
      const { data: row } = await admin.from('ai_provider_connections').select('connected_at, base_url').eq('provider', 'inhouse_metrics').maybeSingle();
      res.status(200).json({ connected: !!row, connectedAt: row?.connected_at || null, projectUrl: row?.base_url || null });
      return;
    }

    // Shared helper for the three actions below — every one of them needs
    // the same connection lookup and REST call pattern against the
    // in-house tool's own Supabase project.
    async function inhouseFetch(path) {
      const { data: connRow } = await admin.from('ai_provider_connections').select('api_key, base_url').eq('provider', 'inhouse_metrics').maybeSingle();
      if (!connRow || !connRow.api_key || !connRow.base_url) {
        throw new Error('Save the in-house tool connection first.');
      }
      const r = await fetch(`${connRow.base_url}/rest/v1/${path}`, {
        headers: { apikey: connRow.api_key, Authorization: `Bearer ${connRow.api_key}` },
      });
      if (!r.ok) throw new Error(`In-house tool request failed (${r.status}): ${await r.text()}`);
      return r.json();
    }

    if (action === 'list-inhouse-clients') {
      try {
        const clients = await inhouseFetch('clients?select=id,name&order=name.asc');
        res.status(200).json({ clients });
      } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
      return;
    }

    if (action === 'list-inhouse-scans') {
      const { clientId } = req.body || {};
      if (!clientId) { res.status(400).json({ error: 'Missing clientId' }); return; }
      try {
        // scans.client_id isn't reliably populated for older rows —
        // confirmed directly from real exported data, where many historical
        // scans had a null client_id despite clearly belonging to a
        // specific client. Deriving the relevant scan ids via runs ->
        // prompts.client_id instead is robust regardless of whether
        // scans.client_id was ever set correctly.
        const prompts = await inhouseFetch(`prompts?client_id=eq.${encodeURIComponent(clientId)}&select=id`);
        const promptIds = prompts.map(p => p.id);
        if (!promptIds.length) { res.status(200).json({ scans: [] }); return; }
        const runs = await inhouseFetch(`runs?prompt_id=in.(${promptIds.join(',')})&select=scan_id`);
        const scanIds = [...new Set(runs.map(r => r.scan_id).filter(Boolean))];
        if (!scanIds.length) { res.status(200).json({ scans: [] }); return; }
        const scans = await inhouseFetch(`scans?id=in.(${scanIds.join(',')})&select=id,started_at,mode&order=started_at.desc&limit=50`);
        res.status(200).json({ scans });
      } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
      return;
    }

    // The core computation — pulls Quick Metrics (average client position,
    // before/after) and the full prompt x platform matrix (with color
    // categories matching the in-house tool's own legend) directly from
    // real relational data, rather than reading it off a screenshot.
    //
    // Color logic, confirmed against real data rather than assumed:
    // - status in ('parse_failed','no_aio_shown','suspect') on EITHER
    //   side of the comparison => 'rerun' (these are exactly the "capture
    //   didn't look trustworthy" states, per the tool's own legend text)
    // - status 'ok' both sides, client mentioned neither before nor after
    //   => 'nochange'
    // - not mentioned before, mentioned after => 'gained'
    // - mentioned before, not mentioned after => 'regression'
    // - mentioned both before and after => 'sustained' (regardless of the
    //   exact position number changing — matches the tool's own coloring,
    //   confirmed against the sample screenshot)
    if (action === 'fetch-inhouse-metrics') {
      const { clientId, beforeScanId, afterScanId } = req.body || {};
      if (!clientId || !beforeScanId || !afterScanId) { res.status(400).json({ error: 'Missing clientId, beforeScanId, or afterScanId' }); return; }
      try {
        const prompts = await inhouseFetch(`prompts?client_id=eq.${encodeURIComponent(clientId)}&active=eq.true&select=id,text`);
        if (!prompts.length) { res.status(200).json({ error: 'No active prompts found for this client in the in-house tool.' }); return; }
        const promptIds = prompts.map(p => p.id);

        const promptPlatforms = await inhouseFetch(`prompt_platforms?prompt_id=in.(${promptIds.join(',')})&select=prompt_id,platform_id`);
        const platformIds = [...new Set(promptPlatforms.map(pp => pp.platform_id))];
        const platforms = platformIds.length ? await inhouseFetch(`platforms?id=in.(${platformIds.join(',')})&select=id,name`) : [];
        const platformNameById = Object.fromEntries(platforms.map(p => [p.id, p.name]));

        // Not filtered by client_id on runs itself — some historical scan
        // rows have a null client_id (confirmed from real data), so the
        // scan_id alone (a scan is already client-scoped) is the more
        // reliable filter.
        const fetchRunsForScan = (scanId) => inhouseFetch(`runs?scan_id=eq.${encodeURIComponent(scanId)}&select=id,prompt_id,platform_id,status,mentions(entity_type,position)`);
        const [beforeRuns, afterRuns] = await Promise.all([fetchRunsForScan(beforeScanId), fetchRunsForScan(afterScanId)]);

        const runKey = (promptId, platformId) => `${promptId}:${platformId}`;
        const beforeByKey = Object.fromEntries(beforeRuns.map(r => [runKey(r.prompt_id, r.platform_id), r]));
        const afterByKey = Object.fromEntries(afterRuns.map(r => [runKey(r.prompt_id, r.platform_id), r]));
        const RERUN_STATUSES = ['parse_failed', 'no_aio_shown', 'suspect'];
        const clientPosition = (run) => {
          if (!run) return null;
          const m = (run.mentions || []).find(m => m.entity_type === 'client');
          return m ? m.position : null;
        };

        const matrixRows = [];
        const beforePositions = [], afterPositions = [];
        let beforeMentioned = 0, beforeEligible = 0, afterMentioned = 0, afterEligible = 0;

        prompts.forEach(prompt => {
          const cells = {};
          promptPlatforms.filter(pp => pp.prompt_id === prompt.id).forEach(pp => {
            const platformName = platformNameById[pp.platform_id];
            if (!platformName) return;
            const key = runKey(prompt.id, pp.platform_id);
            const beforeRun = beforeByKey[key];
            const afterRun = afterByKey[key];
            const beforeOk = beforeRun && !RERUN_STATUSES.includes(beforeRun.status);
            const afterOk = afterRun && !RERUN_STATUSES.includes(afterRun.status);

            if (!beforeOk || !afterOk) {
              cells[platformName] = { value: '—', color: 'rerun' };
              return;
            }
            const beforePos = clientPosition(beforeRun);
            const afterPos = clientPosition(afterRun);
            beforeEligible++; afterEligible++;
            if (beforePos != null) { beforePositions.push(beforePos); beforeMentioned++; }
            if (afterPos != null) { afterPositions.push(afterPos); afterMentioned++; }

            let color, value;
            if (beforePos == null && afterPos == null) { color = 'nochange'; value = '—'; }
            else if (beforePos == null) { color = 'gained'; value = String(afterPos); }
            else if (afterPos == null) { color = 'regression'; value = '—'; }
            else { color = 'sustained'; value = String(afterPos); }
            cells[platformName] = { value, color };
          });
          matrixRows.push({ prompt: prompt.text, cells });
        });

        const avg = (arr) => arr.length ? Math.round((arr.reduce((a,b)=>a+b,0)/arr.length)*10)/10 : null;

        res.status(200).json({
          beforeAvgPosition: avg(beforePositions),
          afterAvgPosition: avg(afterPositions),
          beforeRecommendedCount: beforeMentioned,
          beforeTotalPrompts: beforeEligible,
          afterRecommendedCount: afterMentioned,
          afterTotalPrompts: afterEligible,
          matrixRows,
        });
      } catch (e) {
        res.status(500).json({ error: String(e.message || e) });
      }
      return;
    }

    // Positive/Neutral/Negative Associations, pulled from a single scan's
    // client-entity mentions (excerpt + sentiment) — a point-in-time
    // snapshot of what AI actually said, not a before/after comparison,
    // so this only needs one scan rather than two. Returns raw platform
    // names as stored in the in-house tool (e.g. "DeepSeek") rather than
    // normalizing here — the frontend already has AI_VISIBILITY_PLATFORMS
    // and does case-insensitive matching against it for the CSV/vision
    // paths, so the same logic handles this consistently in one place.
    if (action === 'fetch-inhouse-keywords') {
      const { clientId, scanId } = req.body || {};
      if (!clientId || !scanId) { res.status(400).json({ error: 'Missing clientId or scanId' }); return; }
      try {
        const prompts = await inhouseFetch(`prompts?client_id=eq.${encodeURIComponent(clientId)}&select=id`);
        const promptIds = prompts.map(p => p.id);
        if (!promptIds.length) { res.status(200).json({ error: 'No prompts found for this client.' }); return; }
        const runs = await inhouseFetch(`runs?scan_id=eq.${encodeURIComponent(scanId)}&prompt_id=in.(${promptIds.join(',')})&select=platform_id,mentions(entity_type,sentiment,excerpt)`);
        const platformIds = [...new Set(runs.map(r => r.platform_id))];
        const platforms = platformIds.length ? await inhouseFetch(`platforms?id=in.(${platformIds.join(',')})&select=id,name`) : [];
        const platformNameById = Object.fromEntries(platforms.map(p => [p.id, p.name]));

        const keywords = { positive: {}, neutral: {}, negative: {} };
        let count = 0;
        runs.forEach(run => {
          const platformName = platformNameById[run.platform_id];
          if (!platformName) return;
          (run.mentions || []).forEach(m => {
            if (m.entity_type !== 'client') return;
            if (!['positive','neutral','negative'].includes(m.sentiment)) return;
            if (!m.excerpt || !m.excerpt.trim()) return;
            if (!keywords[m.sentiment][platformName]) keywords[m.sentiment][platformName] = [];
            keywords[m.sentiment][platformName].push(m.excerpt.trim());
            count++;
          });
        });
        res.status(200).json({ keywords, count });
      } catch (e) {
        res.status(500).json({ error: String(e.message || e) });
      }
      return;
    }

    res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
