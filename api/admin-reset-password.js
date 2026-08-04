// Admin-only. Sets a new random temporary password for another team
// member's account — for when someone's locked out and self-service reset
// isn't practical. Requires the service role, since a regular user can only
// ever change their own password, not someone else's.

const { createClient } = require('@supabase/supabase-js');

function generateTempPassword() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%&*';
  const all = letters + digits + symbols;
  const pick = (set) => set[Math.floor(Math.random() * set.length)];
  // Guarantee at least one of each category up front, so this satisfies a
  // stricter password policy (e.g. "must include a symbol") even though
  // the remaining characters are drawn from the full mixed set — a purely
  // random draw from `all` could otherwise land on all-letters by chance
  // and fail validation on a project with that requirement configured.
  let pw = pick(letters) + pick(digits) + pick(symbols);
  for (let i = 0; i < 9; i++) pw += pick(all);
  // Shuffle so the guaranteed characters aren't predictably in the first
  // three positions.
  return pw.split('').sort(() => Math.random() - 0.5).join('');
}

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
    const { data: callerProfile, error: profileErr } = await admin
      .from('team_profiles').select('role').eq('id', callerData.user.id).maybeSingle();
    if (profileErr || !callerProfile || callerProfile.role !== 'admin') {
      res.status(403).json({ error: 'Only admins can reset another team member\'s password' });
      return;
    }

    const tempPassword = generateTempPassword();
    const { error: updateErr } = await admin.auth.admin.updateUserById(targetUserId, { password: tempPassword });
    if (updateErr) {
      res.status(500).json({ error: updateErr.message });
      return;
    }

    res.status(200).json({ success: true, tempPassword });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
