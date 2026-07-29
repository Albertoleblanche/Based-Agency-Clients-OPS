// Vercel serverless function — creates a real login for a new team member.
// Uses the Supabase SERVICE ROLE key, which can create users and bypass RLS —
// that's why this only runs server-side, never in the browser. Before doing
// anything, it verifies the person calling this is actually an admin.

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { name, email, role } = req.body || {};
  if (!name || !email || !role) {
    res.status(400).json({ error: 'Missing name, email, or role' });
    return;
  }
  if (!['admin', 'approver', 'member'].includes(role)) {
    res.status(400).json({ error: 'Role must be admin, approver, or member' });
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
    res.status(500).json({ error: 'Server is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' });
    return;
  }

  const admin = createClient(supabaseUrl, serviceKey);

  try {
    // Confirm the caller is a real, logged-in admin before doing anything.
    const { data: callerData, error: callerErr } = await admin.auth.getUser(callerToken);
    if (callerErr || !callerData?.user) {
      res.status(401).json({ error: 'Invalid or expired session — please log in again' });
      return;
    }
    const { data: callerProfile } = await admin
      .from('team_profiles')
      .select('role')
      .eq('id', callerData.user.id)
      .maybeSingle();
    if (!callerProfile || callerProfile.role !== 'admin') {
      res.status(403).json({ error: 'Only admins can add team members' });
      return;
    }

    // Generate a temporary password — shown once so the admin can relay it directly.
    const tempPassword = Math.random().toString(36).slice(-8) + 'Aa1!';

    const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true, // skip email verification, since there may be no SMTP configured
    });
    if (createErr) {
      res.status(400).json({ error: createErr.message });
      return;
    }

    const { error: insertErr } = await admin
      .from('team_profiles')
      .insert({ id: newUser.user.id, email, name, role });
    if (insertErr) {
      res.status(400).json({ error: insertErr.message });
      return;
    }

    res.status(200).json({ success: true, email, tempPassword });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
