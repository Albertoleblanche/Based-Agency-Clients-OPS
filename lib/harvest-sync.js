// Shared Harvest API v2 interaction logic. Kept in lib/ (not api/) since
// this is imported by the single consolidated /api/harvest.js route, not
// a route itself — this project is close to Vercel's Hobby-plan
// serverless function count limit, so new capability goes into shared
// modules wherever possible rather than new files under api/.

const HARVEST_BASE = 'https://api.harvestapp.com/v2';
const USER_AGENT = 'BasedAgencyRadar Time Sync (support@basedagency.example)';

function harvestHeaders(connection) {
  return {
    'Authorization': `Bearer ${connection.personal_access_token}`,
    'Harvest-Account-Id': connection.account_id,
    'Content-Type': 'application/json',
    'User-Agent': USER_AGENT,
  };
}

async function harvestFetch(connection, path, options = {}) {
  const res = await fetch(`${HARVEST_BASE}${path}`, {
    ...options,
    headers: { ...harvestHeaders(connection), ...(options.headers || {}) },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { /* non-JSON error body */ }
  if (!res.ok) {
    const message = (body && (body.message || body.error)) || text || `Harvest returned ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return body;
}

// Validates credentials by hitting a cheap, harmless endpoint — used at
// connect-time so a typo'd token/account ID is caught immediately with a
// clear error, rather than silently saved and only discovered the first
// time someone's timesheet fails to sync hours later.
async function validateHarvestCredentials(connection) {
  await harvestFetch(connection, '/users/me');
}

// Handles Harvest's pagination (v2 caps at 100/page) transparently —
// callers get the full list, not just page 1.
async function fetchAllPages(connection, path) {
  let results = [];
  let nextUrl = `${HARVEST_BASE}${path}${path.includes('?') ? '&' : '?'}per_page=100`;
  while (nextUrl) {
    const res = await fetch(nextUrl, { headers: harvestHeaders(connection) });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (e) { /* non-JSON error body */ }
    if (!res.ok) { const err = new Error((body && (body.message || body.error)) || `Harvest returned ${res.status}`); err.status = res.status; throw err; }
    const key = Object.keys(body).find(k => Array.isArray(body[k]));
    results = results.concat(body[key] || []);
    nextUrl = body.links?.next || null;
  }
  return results;
}

async function fetchHarvestProjectsAndTasks(connection) {
  const [projects, tasks] = await Promise.all([
    fetchAllPages(connection, '/projects?is_active=true'),
    fetchAllPages(connection, '/tasks?is_active=true'),
  ]);
  return {
    projects: projects.map(p => ({ id: p.id, name: p.name, clientName: p.client?.name || null })),
    tasks: tasks.map(t => ({ id: t.id, name: t.name })),
  };
}

// The core per-entry sync. Looks up the client→project and service→task
// mappings itself rather than requiring the caller to pass them in, so
// every call site (real-time, manual bulk, cron) shares identical
// mapping/validation logic and can't drift out of sync with each other.
async function syncTimeEntryToHarvest(admin, connection, entry) {
  const { data: clientMapping } = await admin
    .from('harvest_client_mappings').select('harvest_project_id').eq('client_id', entry.client_id).maybeSingle();
  if (!clientMapping) {
    return { status: 'unmapped', error: 'No Harvest project mapped for this client yet.' };
  }

  let harvestTaskId = null;
  if (entry.service) {
    const { data: serviceMapping } = await admin
      .from('harvest_service_mappings').select('harvest_task_id').eq('service', entry.service).maybeSingle();
    if (!serviceMapping) {
      return { status: 'unmapped', error: `No Harvest task mapped for service "${entry.service}" yet.` };
    }
    harvestTaskId = serviceMapping.harvest_task_id;
  } else {
    return { status: 'unmapped', error: 'This entry has no service set, so it has no task to map to in Harvest.' };
  }

  const payload = {
    project_id: Number(clientMapping.harvest_project_id),
    task_id: Number(harvestTaskId),
    spent_date: entry.entry_date,
    hours: Math.round((entry.minutes / 60) * 100) / 100,
    notes: entry.description || undefined,
  };

  try {
    let harvestEntry;
    if (entry.harvest_entry_id) {
      // Already synced once — update in place rather than create a
      // duplicate, so editing an entry here corrects the same Harvest
      // row instead of leaving a stale one behind.
      harvestEntry = await harvestFetch(connection, `/time_entries/${entry.harvest_entry_id}`, {
        method: 'PATCH', body: JSON.stringify(payload),
      });
    } else {
      harvestEntry = await harvestFetch(connection, '/time_entries', {
        method: 'POST', body: JSON.stringify(payload),
      });
    }
    return { status: 'synced', harvestEntryId: harvestEntry.id };
  } catch (e) {
    return { status: 'failed', error: e.message };
  }
}

// Called when a time entry is soft-deleted here — a deleted entry
// shouldn't remain billable in Harvest just because the sync already ran
// once before the delete happened.
async function deleteTimeEntryFromHarvest(connection, harvestEntryId) {
  if (!harvestEntryId) return;
  try {
    await harvestFetch(connection, `/time_entries/${harvestEntryId}`, { method: 'DELETE' });
  } catch (e) {
    // Already gone, or some other transient issue — deleting a deleted
    // entry isn't worth failing the local delete over.
  }
}

// ---- Harvest's setup, read into Radar (clients, projects, tasks, assignments, people) ----------
// Read only: nothing here writes to Harvest. A quick read takes only what changed since the last
// one (Harvest's updated_since); a full read takes everything and drops what Harvest no longer
// has. Rows are keyed by Harvest's ids. Hourly rates and costs are never kept.
const SETUP_RESOURCES = [
  { key: 'clients', path: '/clients', table: 'harvest_clients',
    row: c => ({ harvest_id: c.id, name: c.name, is_active: c.is_active !== false, harvest_updated_at: c.updated_at || null }) },
  { key: 'projects', path: '/projects', table: 'harvest_projects',
    row: p => ({ harvest_id: p.id, client_harvest_id: p.client ? p.client.id : null, name: p.name, code: p.code || null,
      is_active: p.is_active !== false, is_billable: p.is_billable ?? null, budget: p.budget ?? null, budget_by: p.budget_by || null,
      budget_is_monthly: p.budget_is_monthly ?? null, starts_on: p.starts_on || null, ends_on: p.ends_on || null, harvest_updated_at: p.updated_at || null }) },
  { key: 'tasks', path: '/tasks', table: 'harvest_tasks',
    row: t => ({ harvest_id: t.id, name: t.name, is_active: t.is_active !== false, billable_by_default: t.billable_by_default ?? null, harvest_updated_at: t.updated_at || null }) },
  { key: 'taskAssignments', path: '/task_assignments', table: 'harvest_task_assignments',
    row: a => ({ harvest_id: a.id, project_harvest_id: a.project && a.project.id, task_harvest_id: a.task && a.task.id, billable: a.billable ?? null,
      is_active: a.is_active !== false, harvest_updated_at: a.updated_at || null }) },
  { key: 'userAssignments', path: '/user_assignments', table: 'harvest_user_assignments',
    row: a => ({ harvest_id: a.id, project_harvest_id: a.project && a.project.id, user_harvest_id: a.user && a.user.id, is_active: a.is_active !== false,
      is_project_manager: a.is_project_manager ?? null, harvest_updated_at: a.updated_at || null }) },
  { key: 'users', path: '/users', table: 'harvest_users',
    row: u => ({ harvest_id: u.id, first_name: u.first_name || null, last_name: u.last_name || null, email: u.email || null,
      is_active: u.is_active !== false, access_roles: Array.isArray(u.access_roles) ? u.access_roles : null, harvest_updated_at: u.updated_at || null }) },
];

async function upsertChunks(admin, table, rows){
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from(table).upsert(rows.slice(i, i + 500), { onConflict: 'harvest_id' });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

// Harvest people → Radar people, by email (case-insensitive). Run after every read, so someone
// added to Radar later is matched without waiting for Harvest to change.
async function matchHarvestUsers(admin){
  const [{ data: hus }, { data: profiles }] = await Promise.all([
    admin.from('harvest_users').select('harvest_id, email, team_profile_id'),
    admin.from('team_profiles').select('id, email'),
  ]);
  const byEmail = new Map((profiles || []).filter(p => p.email).map(p => [String(p.email).trim().toLowerCase(), p.id]));
  let matched = 0;
  for (const u of (hus || [])) {
    const want = u.email ? (byEmail.get(String(u.email).trim().toLowerCase()) || null) : null;
    if (want) matched++;
    if ((u.team_profile_id || null) !== want) {
      await admin.from('harvest_users').update({ team_profile_id: want }).eq('harvest_id', u.harvest_id);
    }
  }
  return matched;
}

// options.full: read everything and drop rows Harvest no longer has. Otherwise only what changed
// since the last read (a minute of overlap, so nothing falls between two reads).
async function syncHarvestSetup(admin, connection, options = {}) {
  const startedAt = new Date();
  const full = !!options.full || !connection.setup_synced_at;
  const since = full ? null : new Date(new Date(connection.setup_synced_at).getTime() - 60000).toISOString();
  const counts = {}, problems = [];

  // who the token belongs to: logging time for other people needs a Harvest administrator
  let me = null;
  try { me = await harvestFetch(connection, '/users/me'); } catch (e) { problems.push(`users/me: ${e.message}`); }

  for (const r of SETUP_RESOURCES) {
    try {
      const list = await fetchAllPages(connection, since ? `${r.path}?updated_since=${encodeURIComponent(since)}` : r.path);
      const rows = list.map(r.row).filter(x => x.harvest_id != null).map(x => ({ ...x, synced_at: startedAt.toISOString() }));
      await upsertChunks(admin, r.table, rows);
      if (full) {
        // anything not seen in a full read is gone from Harvest
        const { error } = await admin.from(r.table).delete().lt('synced_at', startedAt.toISOString());
        if (error) problems.push(`${r.table}: ${error.message}`);
      }
      counts[r.key] = rows.length;
    } catch (e) {
      problems.push(`${r.key}: ${e.status === 403 ? 'this token isn\'t allowed to read it' : e.message}`);
    }
  }
  let matched = null;
  try { matched = await matchHarvestUsers(admin); } catch (e) { problems.push(`team matching: ${e.message}`); }

  const patch = {
    setup_synced_at: startedAt.toISOString(),
    setup_sync_error: problems.length ? problems.join(' · ').slice(0, 1000) : null,
  };
  if (full) patch.setup_full_at = startedAt.toISOString();
  if (me) {
    patch.token_user_name = [me.first_name, me.last_name].filter(Boolean).join(' ') || null;
    patch.token_user_roles = Array.isArray(me.access_roles) ? me.access_roles : null;
  }
  const { error } = await admin.from('harvest_connection').update(patch).eq('id', 1);
  if (error) problems.push(`harvest_connection: ${error.message}`);
  return { full, counts, matched, problems, syncedAt: patch.setup_synced_at };
}

module.exports = {
  syncHarvestSetup,
  validateHarvestCredentials,
  fetchHarvestProjectsAndTasks,
  syncTimeEntryToHarvest,
  deleteTimeEntryFromHarvest,
};
