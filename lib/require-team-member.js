// Shared sign-in check for API routes that act on the team's behalf
// (sending email, spending AI credits). Same verification the other
// routes already do inline — token → Supabase user → team_profiles row —
// plus a revoked-access check, in one place so a new route can't quietly
// skip it.
//
// Kept in lib/ (not api/) so it doesn't count as another Vercel function.
//
// Usage:
//   const auth = await requireTeamMember(req, res);
//   if (!auth) return;            // response already sent (401/403/500)
//   auth.admin / auth.user / auth.profile

const { createClient } = require('@supabase/supabase-js');

async function requireTeamMember(req, res) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    res.status(401).json({ error: 'Not signed in' });
    return null;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' });
    return null;
  }
  const admin = createClient(supabaseUrl, serviceKey);

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) {
    res.status(401).json({ error: 'Invalid or expired session — please log in again' });
    return null;
  }

  const { data: profile, error: profileErr } = await admin
    .from('team_profiles').select('id, role, name, access_revoked').eq('id', userData.user.id).maybeSingle();
  if (profileErr || !profile) {
    res.status(403).json({ error: 'Could not verify your account' });
    return null;
  }
  if (profile.access_revoked) {
    res.status(403).json({ error: 'Your access has been revoked' });
    return null;
  }

  return { admin, user: userData.user, profile };
}

module.exports = { requireTeamMember };
