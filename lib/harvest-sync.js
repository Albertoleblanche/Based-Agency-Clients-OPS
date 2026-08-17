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
    const body = await res.json();
    if (!res.ok) throw new Error(body?.message || `Harvest returned ${res.status}`);
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

module.exports = {
  validateHarvestCredentials,
  fetchHarvestProjectsAndTasks,
  syncTimeEntryToHarvest,
  deleteTimeEntryFromHarvest,
};
