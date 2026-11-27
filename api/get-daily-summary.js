// Powers the Daily Summary tab in Time Tracker. Deliberately its own
// narrow access path rather than a change to time_entries' RLS policy.
// Admins and approvers get visibility into everyone's day for THIS feature
// specifically, without reopening team-wide time visibility everywhere else
// in the app (Reports and Overview stay exactly as restrictive as before).
// Regular members can use this same endpoint too, but the underlying query
// is scoped to only their own entries — enforced here at the query level,
// not just filtered out of the response after the fact.

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const callerToken = (req.headers.authorization || '').replace('Bearer ', '');
  if (!callerToken) {
    res.status(401).json({ error: 'Not signed in' });
    return;
  }

  const date = req.method === 'GET' ? req.query.date : req.body?.date;
  if (!date) {
    res.status(400).json({ error: 'Missing date' });
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
    if (profileErr || !callerProfile) {
      res.status(403).json({ error: 'Could not verify your account' });
      return;
    }
    const isTeamView = ['admin', 'approver'].includes(callerProfile.role);

    let entriesQuery = admin.from('time_entries').select('*').eq('entry_date', date).is('deleted_at', null);
    if (!isTeamView) entriesQuery = entriesQuery.eq('user_id', callerData.user.id);

    // clients moved to a real table in schema-clients-migration.sql — this
    // file was missed during that migration's ~150-call-site refactor and
    // kept reading from the old app_storage JSON blob, which no longer
    // has any client data in it at all. That's why client_id never
    // resolved to a real name here. Not filtering out trashed clients —
    // a time entry logged against a client that's since been moved to
    // Trash should still show its real name, not "Unknown client".
    const [{ data: entries, error: entriesErr }, { data: profiles, error: profilesErr }, { data: clientsData, error: clientsErr }, { data: harvestPeople }] = await Promise.all([
      entriesQuery,
      admin.from('team_profiles').select('id, name'),
      admin.from('clients').select('id, name'),
      admin.from('harvest_users').select('harvest_id, first_name, last_name'), // time from someone in Harvest only (step 4)
    ]);
    if (entriesErr || profilesErr || clientsErr) {
      res.status(500).json({ error: (entriesErr || profilesErr || clientsErr).message });
      return;
    }

    const clients = clientsData || [];
    const nameOf = (id) => profiles?.find(p => p.id === id)?.name || 'Someone no longer on the team';
    const clientNameOf = (id) => clients.find(c => c.id === id)?.name || 'Unknown client';

    const harvestNameOf = (id) => { const u = (harvestPeople || []).find(x => String(x.harvest_id) === String(id)); return u ? [u.first_name, u.last_name].filter(Boolean).join(' ') : 'Someone in Harvest'; };
    const byUser = {};
    (entries || []).forEach(e => {
      const key = e.user_id || `hv:${e.harvest_user_id || ''}`;
      if (!byUser[key]) byUser[key] = { userId: e.user_id || key, name: e.user_id ? nameOf(e.user_id) : harvestNameOf(e.harvest_user_id), totalMinutes: 0, entries: [] };
      byUser[key].totalMinutes += e.minutes;
      byUser[key].entries.push({
        client: clientNameOf(e.client_id),
        service: e.service || '',
        description: e.description || '',
        minutes: e.minutes,
      });
    });

    const summary = Object.values(byUser).sort((a, b) => b.totalMinutes - a.totalMinutes);
    res.status(200).json({ date, summary });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
