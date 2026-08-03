// Admin-only. Permanently deletes a team member's auth account. This is
// the severe, irreversible counterpart to toggle-user-access.js — the
// schema's foreign keys cascade-delete on user removal, so this also wipes
// out their team_profiles row, every task where they're the assigner OR
// assignee (meaning tasks they assigned to OTHER people disappear too, not
// just their own), their notes, calendar events they created, and their
// time entries. Revoking access (toggle-user-access.js) is almost always
// the right first move instead — this exists for genuinely permanent
// cleanup, not day-to-day offboarding.

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

  const { targetUserId } = req.body || {};
  if (!targetUserId) {
    res.status(400).json({ error: 'Missing targetUserId' });
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
      res.status(400).json({ error: "You can't delete your own account" });
      return;
    }
    const { data: callerProfile, error: profileErr } = await admin
      .from('team_profiles').select('role').eq('id', callerData.user.id).maybeSingle();
    if (profileErr || !callerProfile || callerProfile.role !== 'admin') {
      res.status(403).json({ error: 'Only admins can delete a team member\'s account' });
      return;
    }

    const { error: deleteErr } = await admin.auth.admin.deleteUser(targetUserId);
    if (deleteErr) {
      res.status(500).json({ error: deleteErr.message });
      return;
    }

    res.status(200).json({ success: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
