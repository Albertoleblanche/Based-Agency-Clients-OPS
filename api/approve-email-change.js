// Called only after an admin approves a pending email-change request in the
// UI. Actually changing another person's login email requires the service
// role — a regular authenticated user can only ever change their own.

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

  const { requestId, approve } = req.body || {};
  if (!requestId || typeof approve !== 'boolean') {
    res.status(400).json({ error: 'Missing requestId or approve' });
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
      res.status(403).json({ error: 'Only admins can approve or deny email change requests' });
      return;
    }

    const { data: reqRow, error: reqErr } = await admin
      .from('email_change_requests').select('*').eq('id', requestId).maybeSingle();
    if (reqErr || !reqRow) {
      res.status(404).json({ error: 'Request not found' });
      return;
    }
    if (reqRow.status !== 'pending') {
      res.status(400).json({ error: 'This request has already been resolved' });
      return;
    }

    if (approve) {
      const { error: updateAuthErr } = await admin.auth.admin.updateUserById(reqRow.user_id, { email: reqRow.requested_email });
      if (updateAuthErr) {
        res.status(500).json({ error: `Could not update login email: ${updateAuthErr.message}` });
        return;
      }
      await admin.from('team_profiles').update({ email: reqRow.requested_email }).eq('id', reqRow.user_id);
    }

    await admin.from('email_change_requests').update({
      status: approve ? 'approved' : 'denied',
      resolved_at: new Date().toISOString(),
      resolved_by: callerData.user.id,
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

    res.status(200).json({ success: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
