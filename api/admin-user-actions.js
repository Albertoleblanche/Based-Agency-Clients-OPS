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
      .from('team_profiles').select('role').eq('id', callerData.user.id).maybeSingle();
    if (profileErr || !callerProfile || callerProfile.role !== 'admin') {
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

    res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
