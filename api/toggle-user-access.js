// Admin-only. Bans or restores a team member's ability to log in, without
// touching their team_profiles row or any data tied to their account. This
// is deliberately the safer, reversible counterpart to delete-user.js —
// most of the time "someone left" or "lock this account for now" calls for
// cutting off access, not permanently destroying every task, note, and time
// entry that references them.

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const callerToken = (req.headers.authorization || '').replace('Bearer ', '');
  if (!callerToken) {
    res.status(401).json({ error: 'Not signed in' });
    return;
  }

  const { targetUserId, revoke } = req.body || {};
  if (!targetUserId || typeof revoke !== 'boolean') {
    res.status(400).json({ error: 'Missing targetUserId or revoke' });
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
    if (targetUserId === callerData.user.id) {
      res.status(400).json({ error: "You can't revoke your own access" });
      return;
    }
    const { data: callerProfile, error: profileErr } = await admin
      .from('team_profiles').select('role').eq('id', callerData.user.id).maybeSingle();
    if (profileErr || !callerProfile || callerProfile.role !== 'admin') {
      res.status(403).json({ error: 'Only admins can change another team member\'s access' });
      return;
    }

    // Supabase bans are expressed as a duration, not a boolean — "876000h"
    // (100 years) is the conventional way to represent an indefinite ban.
    const { error: updateErr } = await admin.auth.admin.updateUserById(targetUserId, {
      ban_duration: revoke ? '876000h' : 'none',
    });
    if (updateErr) {
      res.status(500).json({ error: updateErr.message });
      return;
    }

    // Mirror the real ban state onto team_profiles, which the frontend's
    // regular client can actually read — auth.users itself is service-role
    // only, so without this the UI would have no way to show the status.
    await admin.from('team_profiles').update({ access_revoked: revoke }).eq('id', targetUserId);

    res.status(200).json({ success: true, revoked: revoke });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
