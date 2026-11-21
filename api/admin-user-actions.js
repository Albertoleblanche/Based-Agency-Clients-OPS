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
const { CLAUDE_MODEL, OPENAI_MODEL } = require('../lib/ai-client');
const { sendPushToUser, pushUrlFor } = require('../lib/push-notify');

// Only Based Agency addresses get an account or become someone's sign-in email (Nov 20).
// The app says so before it asks; this is the check that holds. addendum-email-domain.sql adds the same
// rule in the database, for anything that reaches Supabase another way.
const TEAM_EMAIL_DOMAIN = 'based-agency.com';
function isTeamEmail(v) { const e = String(v || '').trim().toLowerCase(); return /^[^\s@]+@[^\s@]+$/.test(e) && e.endsWith('@' + TEAM_EMAIL_DOMAIN); }

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
    body: JSON.stringify({ model: model || CLAUDE_MODEL, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
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
      body: JSON.stringify({ model: model || OPENAI_MODEL, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
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
    if (callerProfile.role !== 'admin') {
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
      if (deleteErr) {
        // Supabase's words when a table still points at the person with no rule for their delete
        const blocked = /database error deleting user/i.test(deleteErr.message || '');
        res.status(blocked ? 409 : 500).json({ error: blocked
          ? 'Other records still point to this person, so Supabase stopped. Run addendum-user-delete.sql once in Supabase → SQL Editor, then delete again. Their time and improvements stay, without their name.'
          : deleteErr.message });
        return;
      }
      // the profile goes with them (a project without that link keeps it otherwise), and Harvest
      // stops matching their time to a person who's gone
      await admin.from('team_profiles').delete().eq('id', targetUserId);
      await admin.from('harvest_users').update({ team_profile_id: null }).eq('team_profile_id', targetUserId);
      res.status(200).json({ success: true });
      return;
    }

    if (action === 'create-member') {
      const { name, email, role, title } = req.body || {};
      if (!name || !email || !role) { res.status(400).json({ error: 'Missing name, email, or role' }); return; }
      if (!['admin', 'approver', 'member'].includes(role)) { res.status(400).json({ error: 'Role must be admin, approver, or member' }); return; }
      if (!isTeamEmail(email)) { res.status(400).json({ error: `Use their @${TEAM_EMAIL_DOMAIN} email.` }); return; }
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
      if (approve && !isTeamEmail(reqRow.requested_email)) { res.status(400).json({ error: `Only @${TEAM_EMAIL_DOMAIN} emails can sign in. Deny this request instead.` }); return; }
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
          approve ? `Your email is now ${reqRow.requested_email}.` : `Your request to change your email was denied.`,
          pushUrlFor('profile')
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

    res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
