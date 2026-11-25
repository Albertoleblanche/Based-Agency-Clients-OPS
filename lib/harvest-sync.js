// Shared Harvest API v2 interaction logic. Kept in lib/ (not api/) since
// this is imported by the single consolidated /api/harvest.js route, not
// a route itself — this project is close to Vercel's Hobby-plan
// serverless function count limit, so new capability goes into shared
// modules wherever possible rather than new files under api/.

const { selectAll } = require('./select-all');
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

// The core per-entry sync. An entry logged by project and task (step 3) goes to that project and
// task; an older one falls back to the client→project and service→task mappings. It goes to
// Harvest as the person who logged it (matched by email in Settings → Harvest), which needs an
// administrator's token; someone with no Harvest account isn't sent at all, so their hours never
// land on the token owner's timesheet. Every call site (real time, Sync Now, the nightly
// catch-up) shares this, so they can't drift apart.
async function syncTimeEntryToHarvest(admin, connection, entry) {
  let projectId = entry.harvest_project_id ? Number(entry.harvest_project_id) : null;
  let taskId = entry.harvest_task_id ? Number(entry.harvest_task_id) : null;
  if (!projectId || !taskId) {
    const { data: clientMapping } = await admin
      .from('harvest_client_mappings').select('harvest_project_id').eq('client_id', entry.client_id).maybeSingle();
    if (!clientMapping) {
      return { status: 'unmapped', error: 'Pick a Harvest project and task for this entry.' };
    }
    if (!entry.service) {
      return { status: 'unmapped', error: 'Pick a Harvest project and task for this entry.' };
    }
    const { data: serviceMapping } = await admin
      .from('harvest_service_mappings').select('harvest_task_id').eq('service', entry.service).maybeSingle();
    if (!serviceMapping) {
      return { status: 'unmapped', error: `Pick a Harvest project and task for this entry.` };
    }
    projectId = Number(clientMapping.harvest_project_id);
    taskId = Number(serviceMapping.harvest_task_id);
  }

  // whose time it is (until addendum-harvest-sync.sql is run there's no list, and it goes as before)
  let harvestUserId = null;
  if (entry.user_id) {
    const { data: people, error: peopleErr } = await admin.from('harvest_users').select('harvest_id, team_profile_id');
    if (!peopleErr && people && people.length) {
      const me = people.find(p => p.team_profile_id === entry.user_id);
      if (!me) return { status: 'unmapped', error: 'Not in Harvest yet: Radar matches people by email, in Settings → Harvest.' };
      harvestUserId = Number(me.harvest_id);
    }
  }

  const payload = {
    project_id: projectId,
    task_id: taskId,
    spent_date: entry.entry_date,
    hours: Math.round((entry.minutes / 60) * 100) / 100,
    notes: entry.description || undefined,
  };
  // the person is set when the entry is made; Harvest doesn't move an entry to someone else
  if (harvestUserId && !entry.harvest_entry_id) payload.user_id = harvestUserId;

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

  // step 2: Radar's client list follows Harvest's (only when Harvest's clients were read)
  let clients = null;
  if (counts.clients != null) {
    try {
      clients = await syncHarvestClients(admin);
      (clients.problems || []).forEach(p => problems.push(p));
    } catch (e) { problems.push(`clients: ${e.message}`); }
  }
  // step 4: monthly hours follow Harvest's monthly hour budgets
  let budgets = null;
  if (counts.projects != null && clients && !clients.skipped) {
    try { budgets = await syncHarvestBudgets(admin); } catch (e) { problems.push(`budgets: ${e.message}`); }
  }
  // what each client buys follows its Harvest projects
  let services = null;
  if (counts.projects != null && clients && !clients.skipped) {
    try { services = await syncHarvestServices(admin); } catch (e) { problems.push(`projects: ${e.message}`); }
  }

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
  return { full, counts, matched, clients: clients && { ...clients, problems: undefined }, budgets, services, problems, syncedAt: patch.setup_synced_at };
}

// ---- Step 2: Radar's client list follows Harvest's ---------------------------------------------
// Each Harvest client links to one Radar client (harvest_clients.radar_client_id). An unlinked one
// is matched by name, ignoring case, punctuation and endings like "LLC" or "Inc."; an active one
// with no match is added to Radar marked "Needs setup" (custom_field_values.harvestSetup =
// 'needed'), and approvers are asked to finish its info. Until they do, Radar leaves it out of
// Time deleted in Harvest takes the work logged with it (time_entries.improvement_id) to Recently
// Deleted, as deleting either one in Radar does, and its writer hears (Nov 21). Work in an update
// that's in review or approved stays: what went for approval is what goes out. Restoring the work in
// Radar brings the time back and makes it again in Harvest. Before addendum-deleted-work.sql there's
// no link, and nothing happens. Returns how many moved.
async function removeWorkOfGoneTime(admin, goneIds, at) {
  let moved = 0;
  try {
    const links = [];
    for (let i = 0; i < goneIds.length; i += 200) {
      const { data, error } = await admin.from('time_entries').select('id, improvement_id').in('id', goneIds.slice(i, i + 200)).not('improvement_id', 'is', null);
      if (error) return 0;
      links.push(...(data || []));
    }
    const ids = [...new Set(links.map(r => String(r.improvement_id)))];
    if (!ids.length) return 0;
    const { data: drafts } = await admin.from('client_drafts').select('draft, draft_status, ready_to_notify, draft_sent_at, draft_improvement_ids');
    const locked = new Set((drafts || []).filter(d => d.draft && !d.draft_sent_at && (d.draft_status === 'approved' || (d.draft_status === 'pending' && d.ready_to_notify)))
      .flatMap(d => (d.draft_improvement_ids || []).map(String)));
    const move = ids.filter(id => !locked.has(id));
    if (!move.length) return 0;
    const { data: work, error } = await admin.from('client_improvements').update({ deleted_at: at.toISOString(), deleted_by: null }).in('id', move).is('deleted_at', null).select('id, client_id, author, text');
    if (error || !work || !work.length) return 0;
    moved = work.length;
    const [{ data: people }, { data: cls }] = await Promise.all([
      admin.from('team_profiles').select('id, name, access_revoked'),
      admin.from('clients').select('id, name').in('id', [...new Set(work.map(w => w.client_id))]),
    ]);
    const nameOf = id => ((cls || []).find(c => String(c.id) === String(id)) || {}).name || 'A client';
    const rows = work.map(w => { const p = (people || []).find(x => x.name === w.author && !x.access_revoked); if (!p) return null;
      const t = String(w.text || ''); return { user_id: p.id, type: 'work_deleted', title: `${nameOf(w.client_id)}: its time was deleted in Harvest`,
        body: `So “${t.length > 80 ? t.slice(0, 80) + '…' : t}” went to Recently Deleted too. Restore it there if that was a mistake.`, target_view: 'trash', read: false }; }).filter(Boolean);
    if (rows.length) await admin.from('notifications').insert(rows);
  } catch (e) { /* the time is already handled; the work can wait for the next read */ }
  return moved;
}

// This Week, Health and the reminders. Links are never remade: a client someone removed from
// Radar (Trash, "Not a Radar client") stays removed.
// After that: a rename in Harvest carries over while Radar still uses the old name; a client
// archived in Harvest is mentioned to approvers once (one still waiting for setup just leaves),
// and one made active again comes back for setup.

const NAME_ENDINGS = new Set(['llc', 'inc', 'incorporated', 'co', 'corp', 'corporation', 'company', 'ltd', 'limited', 'pllc', 'lp', 'llp']);
function clientKey(name) {
  const w = String(name || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  while (w.length > 1 && NAME_ENDINGS.has(w[w.length - 1])) w.pop();
  if (w.length > 1 && w[0] === 'the') w.shift();
  return w.join(' ');
}
// Names a typo apart ("PE Developement" / "PE Development"): the same words in the same order, each
// equal or a letter or two off (one for words of 5 to 8 letters, two for longer ones). Shorter words
// must match exactly, so "Roof Pros" and "Roof Pro" stay two clients.
function editsWithin(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);   // swapped letters
    }
  }
  return d[a.length][b.length] <= max;
}
function sameButTypo(a, b) {
  const x = clientKey(a).split(' ').filter(Boolean), y = clientKey(b).split(' ').filter(Boolean);
  if (!x.length || x.length !== y.length || x.join(' ') === y.join(' ')) return false;
  return x.every((w, i) => { const v = y[i], n = Math.min(w.length, v.length); return w === v || (n >= 5 && editsWithin(w, v, n >= 9 ? 2 : 1)); });
}
function inHarvestSetup(row) {
  const v = row && (row.custom_field_values || row.customFieldValues);
  return !!(v && v.harvestSetup === 'needed');
}

const HARVEST_NOTE = 'harvest_client';
function mutedFor(p, ch) { const m = p.muted_notification_types || []; return m.includes(HARVEST_NOTE) || m.includes(ch + ':' + HARVEST_NOTE); }
// In the app, by push and on Slack, to every admin and approver.
async function tellApprovers(admin, profiles, title, body, targetId) {
  const { sendPushToUser, pushUrlFor } = require('./push-notify');
  const { sendSlackDM } = require('./slack-notify');
  const to = (profiles || []).filter(p => (p.role === 'admin' || p.role === 'approver') && !p.access_revoked);
  for (const p of to) {
    if (mutedFor(p, 'app') && mutedFor(p, 'push') && mutedFor(p, 'slack')) continue;
    if (!mutedFor(p, 'app')) await admin.from('notifications').insert({ user_id: p.id, type: HARVEST_NOTE, title, body, target_view: 'clients', target_id: targetId || null });
    if (!mutedFor(p, 'push')) { try { await sendPushToUser(admin, p.id, title, body, pushUrlFor('clients', targetId)); } catch (e) {} }
    try { await sendSlackDM(admin, p.id, HARVEST_NOTE, `*${title}*\n${body}`); } catch (e) {}
  }
  return to.length;
}

async function syncHarvestClients(admin) {
  const nowIso = new Date().toISOString(), today = nowIso.slice(0, 10);
  const [hcRes, pRes, cRes, profRes] = await Promise.all([
    admin.from('harvest_clients').select('*'),
    admin.from('harvest_projects').select('harvest_id, client_harvest_id, name, is_active, budget, budget_by, budget_is_monthly, starts_on'),
    admin.from('clients').select('id, name, status, deleted_at, custom_field_values'),
    admin.from('team_profiles').select('id, role, access_revoked, muted_notification_types'),
  ]);
  if (hcRes.error) throw new Error(`harvest_clients: ${hcRes.error.message}`);
  if (cRes.error) throw new Error(`clients: ${cRes.error.message}`);
  const hcs = hcRes.data || [];
  const out = { added: 0, linked: 0, renamed: 0, archived: 0, back: 0, problems: [] };
  if (!hcs.length) return out;
  if (!('name_at_link' in hcs[0])) return { ...out, skipped: 'needs-sql' };

  const radar = cRes.data || [], projects = pRes.data || [];
  const byId = new Map(radar.map(c => [String(c.id), c]));
  const taken = new Set(hcs.map(h => h.radar_client_id).filter(Boolean).map(String));
  const link = async (hc, patch) => {
    const { error } = await admin.from('harvest_clients').update(patch).eq('harvest_id', hc.harvest_id);
    if (error) { out.problems.push(`linking ${hc.name}: ${error.message}`); return false; }
    Object.assign(hc, patch); return true;
  };
  const setClient = async (id, patch, what) => {
    const { error } = await admin.from('clients').update(patch).eq('id', id);
    if (error) out.problems.push(`${what}: ${error.message}`);
    return !error;
  };

  // 1. unlinked: link to the Radar client with the same name, or add the active ones
  const toAdd = [], typoLinked = [];
  for (const hc of hcs.filter(h => !h.radar_client_id)) {
    const own = byId.get('hv' + hc.harvest_id); // added earlier, link not saved
    const k = clientKey(hc.name);
    const same = k ? radar.filter(c => !taken.has(String(c.id)) && clientKey(c.name) === k) : [];
    let match = own && !taken.has(String(own.id)) ? own : (same.find(c => !c.deleted_at) || same[0]);
    let typo = false;
    if (!match && k) {   // the same name but for a typo, and only one such client
      const near = radar.filter(c => !c.deleted_at && !taken.has(String(c.id)) && !inHarvestSetup(c) && sameButTypo(c.name, hc.name));
      if (near.length === 1) { match = near[0]; typo = true; }
    }
    if (match) {
      if (await link(hc, { radar_client_id: String(match.id), name_at_link: hc.name })) { taken.add(String(match.id)); out.linked++; if (typo) typoLinked.push({ id: match.id, name: match.name, harvestName: hc.name }); }
    } else if (hc.is_active) toAdd.push(hc);
  }

  const added = [];
  if (toAdd.length) {
    const projOf = hc => projects.filter(p => p.client_harvest_id === hc.harvest_id && p.is_active);
    const rows = toAdd.map(hc => {
      const ps = projOf(hc);
      // a monthly hour budget on the project (Harvest: budget_by "project" is hours)
      const hours = ps.filter(p => p.budget_by === 'project' && p.budget_is_monthly && Number(p.budget) > 0).reduce((a, p) => a + Number(p.budget), 0);
      const starts = ps.map(p => p.starts_on).filter(Boolean).sort();
      return { id: 'hv' + hc.harvest_id, name: hc.name, email: '', website: '', service: harvestServiceWords(ps.map(p => p.name)), status: 'Active', importance: 5, danger: 1,
        monthly_hour_budget: Math.round(hours * 10) / 10, sow: '', start_date: starts[0] || today,
        custom_field_values: { harvestSetup: 'needed', harvestAdded: today }, draft: '', draft_status: 'none' };
    });
    // a fixed id per Harvest client, so two reads at once can't add it twice
    const { data: made, error } = await admin.from('clients').upsert(rows, { onConflict: 'id', ignoreDuplicates: true }).select('id');
    if (error) out.problems.push(`adding clients: ${error.message}`);
    const madeIds = new Set((made || []).map(r => String(r.id)));
    for (const hc of toAdd) {
      const id = 'hv' + hc.harvest_id;
      if (!madeIds.has(id)) continue;
      if (!(await link(hc, { radar_client_id: id, name_at_link: hc.name }))) continue;
      taken.add(id); added.push({ id, name: hc.name }); out.added++;
    }
  }

  // 1b. a copy Radar added earlier that's a client it has under a name a typo away ("PE Development"
  // added beside "PE Developement"), nobody having set the copy up: the link moves to that client, with
  // anything logged on the copy, and the copy goes (as Same as Another Client does by hand)
  for (const hc of hcs) {
    const rc = hc.radar_client_id && byId.get(String(hc.radar_client_id));
    if (!rc || rc.deleted_at || !inHarvestSetup(rc)) continue;
    const near = radar.filter(c => String(c.id) !== String(rc.id) && !c.deleted_at && !taken.has(String(c.id)) && !inHarvestSetup(c) && sameButTypo(c.name, hc.name));
    if (near.length !== 1) continue;
    const r = await linkHarvestClient(admin, String(rc.id), String(near[0].id));
    if (r.error) { out.problems.push(`linking ${hc.name}: ${r.error}`); continue; }
    taken.add(String(near[0].id)); rc.deleted_at = nowIso;
    Object.assign(hc, { radar_client_id: String(near[0].id), name_at_link: hc.name, archived_noted_at: null });
    typoLinked.push({ id: near[0].id, name: near[0].name, harvestName: hc.name }); out.linked++;
  }

  // 2. linked: renames, archives, and clients made active again
  const archived = [], back = [];
  for (const hc of hcs) {
    if (!hc.radar_client_id || added.some(a => a.id === hc.radar_client_id)) continue;
    const rc = byId.get(String(hc.radar_client_id));
    if (!rc) continue; // deleted from Radar for good
    if (hc.name_at_link !== hc.name) {
      if (hc.name_at_link && rc.name === hc.name_at_link && !rc.deleted_at && (await setClient(rc.id, { name: hc.name }, `renaming ${rc.name}`))) out.renamed++;
      await link(hc, { name_at_link: hc.name });
    }
    if (!hc.is_active && !hc.archived_noted_at) {
      if (!rc.deleted_at && inHarvestSetup(rc)) await setClient(rc.id, { deleted_at: nowIso }, `removing ${rc.name}`); // never set up: it just leaves
      else if (!rc.deleted_at && rc.status !== 'Paused') archived.push({ id: rc.id, name: hc.name });
      await link(hc, { archived_noted_at: nowIso });
    } else if (hc.is_active && hc.archived_noted_at) {
      if (rc.deleted_at && inHarvestSetup(rc) && (await setClient(rc.id, { deleted_at: null }, `bringing back ${rc.name}`))) back.push({ id: rc.id, name: hc.name });
      await link(hc, { archived_noted_at: null });
    }
  }
  out.archived = archived.length; out.back = back.length;

  // 3. tell approvers: one note for a big batch, else one per client
  const profiles = profRes.data || [];
  const ask = 'Please finish its info in All Clients: owner and weekly win.';
  try {
    const fresh = added.concat(back);
    if (fresh.length >= 4) {
      await tellApprovers(admin, profiles, `${fresh.length} clients were added from Harvest`, 'Please finish their info in All Clients: owner and weekly win.', null);
    } else {
      for (const a of added) await tellApprovers(admin, profiles, `${a.name} was added from Harvest`, ask, a.id);
      for (const a of back) await tellApprovers(admin, profiles, `${a.name} is active in Harvest again`, `It’s back in Radar. ${ask}`, a.id);
    }
    for (const a of archived) await tellApprovers(admin, profiles, `${a.name} was archived in Harvest`, 'If the work has stopped, pause it in Radar.', a.id);
    for (const a of typoLinked) await tellApprovers(admin, profiles, `${a.name} is linked to Harvest`, `Harvest spells it “${a.harvestName}”. Its projects are in Radar now, so time logged here goes to Harvest.`, a.id);
  } catch (e) { out.problems.push(`telling approvers: ${e.message}`); }
  return out;
}

// "Same as another client": a client Radar added from Harvest turns out to be one Radar already
// has under another name. The Harvest link moves to that client, along with anything logged on the
// added one in the meantime, and the added one goes to Trash.
async function linkHarvestClient(admin, clientId, targetId) {
  const [{ data: hc }, { data: other }, { data: src }, { data: dst }] = await Promise.all([
    admin.from('harvest_clients').select('*').eq('radar_client_id', clientId).maybeSingle(),
    admin.from('harvest_clients').select('harvest_id, name').eq('radar_client_id', targetId).maybeSingle(),
    admin.from('clients').select('id, name, custom_field_values').eq('id', clientId).maybeSingle(),
    admin.from('clients').select('id, name, deleted_at').eq('id', targetId).maybeSingle(),
  ]);
  const fail = (status, error) => ({ status, error });
  if (!hc || !src) return fail(404, 'This client isn’t linked to Harvest.');
  if (!inHarvestSetup(src)) return fail(409, `${src.name} is already set up in Radar.`);
  if (!dst || dst.deleted_at) return fail(404, 'That client isn’t in Radar.');
  if (other) return fail(409, `${dst.name} is already linked to ${other.name} in Harvest.`);
  const moved = [];
  for (const t of ['time_entries', 'tasks', 'notes', 'client_improvements', 'client_reminders']) {
    const { error } = await admin.from(t).update({ client_id: targetId }).eq('client_id', clientId);
    if (!error) moved.push(t);
  }
  await admin.from('harvest_client_mappings').delete().eq('client_id', clientId);
  const { error: lErr } = await admin.from('harvest_clients').update({ radar_client_id: targetId, name_at_link: hc.name, archived_noted_at: null }).eq('harvest_id', hc.harvest_id);
  if (lErr) return fail(500, lErr.message);
  const cfv = Object.assign({}, src.custom_field_values || {}, { harvestSetup: 'merged', harvestMergedInto: targetId });
  await admin.from('clients').update({ deleted_at: new Date().toISOString(), custom_field_values: cfv }).eq('id', clientId);
  return { status: 200, success: true, targetName: dst.name, harvestName: hc.name, moved };
}

// Link a Harvest client to a Radar client from where time is logged: Harvest's name for it isn't
// Radar's, so time for it stayed in Radar. Linked to a copy Radar added and nobody set up: that's Same
// as Another Client (above). Linked to another client by mistake ("PE Development" to American Building
// Development): the link moves, with the time logged on this Harvest client's projects; nothing else
// moves, since it can't be told apart. Not linked at all: it's linked.
async function moveHarvestLink(admin, harvestId, targetId) {
  const fail = (status, error) => ({ status, error });
  const [{ data: hc }, { data: other }, { data: dst }] = await Promise.all([
    admin.from('harvest_clients').select('*').eq('harvest_id', harvestId).maybeSingle(),
    admin.from('harvest_clients').select('harvest_id, name').eq('radar_client_id', String(targetId)).maybeSingle(),
    admin.from('clients').select('id, name, deleted_at').eq('id', String(targetId)).maybeSingle(),
  ]);
  if (!hc) return fail(404, 'That client isn’t in Harvest.');
  if (!dst || dst.deleted_at) return fail(404, 'That client isn’t in Radar.');
  if (String(hc.radar_client_id || '') === String(targetId)) return { status: 200, success: true, targetName: dst.name, harvestName: hc.name, moved: 0 };
  if (other) return fail(409, `${dst.name} is already linked to ${other.name} in Harvest.`);
  const fromId = hc.radar_client_id ? String(hc.radar_client_id) : null;
  if (fromId) {
    const { data: src } = await admin.from('clients').select('id, custom_field_values').eq('id', fromId).maybeSingle();
    if (src && inHarvestSetup(src)) return linkHarvestClient(admin, fromId, String(targetId));
  }
  const { error } = await admin.from('harvest_clients').update({ radar_client_id: String(targetId), name_at_link: hc.name, archived_noted_at: null }).eq('harvest_id', hc.harvest_id);
  if (error) return fail(500, error.message);
  let moved = 0;
  if (fromId) {
    const { data: ps } = await admin.from('harvest_projects').select('harvest_id').eq('client_harvest_id', hc.harvest_id);
    const ids = (ps || []).map(p => p.harvest_id);
    if (ids.length) {
      const { data: m } = await admin.from('time_entries').update({ client_id: String(targetId) }).eq('client_id', fromId).in('harvest_project_id', ids).select('id');
      moved = (m || []).length;
    }
  }
  return { status: 200, success: true, targetName: dst.name, harvestName: hc.name, fromId, moved };
}

// ---- Step 4: time logged in Harvest, read into Radar ---------------------------------------------
// Harvest's time entries from the first of last month on become Radar time entries: the same entry
// in both. One Radar already has (sent from here) is matched by its Harvest id and takes Harvest's
// hours, date, notes, project and task, unless a change made in Radar is still on its way there.
// One logged in Harvest is added with source 'harvest', under the Radar person matched by email
// (or none, with the Harvest person kept, for someone without a Radar account). A running timer
// waits until it stops. Invoiced or approved entries are marked locked: Radar shows them read only.
// A full read (nightly, Sync Now) also removes what was deleted in Harvest, but only with an
// administrator's token, which sees everyone's time. The rest of Radar (hours, budgets, Health,
// reports) counts them as it counts any entry.
// And the budget: a client's monthly hours follow Harvest when its projects have a monthly hour budget.

async function syncHarvestBudgets(admin) {
  const [{ data: hcs }, { data: projects }, { data: rcs }] = await Promise.all([
    admin.from('harvest_clients').select('harvest_id, radar_client_id'),
    admin.from('harvest_projects').select('client_harvest_id, is_active, budget, budget_by, budget_is_monthly'),
    admin.from('clients').select('id, monthly_hour_budget'),
  ]);
  let changed = 0;
  for (const hc of (hcs || []).filter(h => h.radar_client_id)) {
    const rc = (rcs || []).find(c => String(c.id) === String(hc.radar_client_id));
    if (!rc) continue;
    const hours = (projects || []).filter(p => Number(p.client_harvest_id) === Number(hc.harvest_id) && p.is_active && p.budget_by === 'project' && p.budget_is_monthly && Number(p.budget) > 0)
      .reduce((a, p) => a + Number(p.budget), 0);
    const want = Math.round(hours * 10) / 10;
    if (want > 0 && Number(rc.monthly_hour_budget || 0) !== want) {
      const { error } = await admin.from('clients').update({ monthly_hour_budget: want }).eq('id', rc.id);
      if (!error) changed++;
    }
  }
  return changed;
}

// Harvest is the source of truth for what each client buys: a linked client's service is its
// active Harvest projects by name ("MDF - Tier 3 · Website Hosting and Maintenance"), or empty
// when it has none. Every screen, draft and summary that shows the service shows these. Clients
// that aren't in Harvest keep the service picked in Radar.
function harvestServiceWords(names) {
  return [...new Set(names.map(n => String(n || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)).join(' · ');
}
async function syncHarvestServices(admin) {
  const [{ data: hcs }, { data: projects }, { data: rcs }] = await Promise.all([
    admin.from('harvest_clients').select('harvest_id, radar_client_id'),
    admin.from('harvest_projects').select('client_harvest_id, name, is_active'),
    admin.from('clients').select('id, service'),
  ]);
  const want = new Map(); // Radar client id -> project names
  for (const hc of (hcs || []).filter(h => h.radar_client_id)) {
    const key = String(hc.radar_client_id);
    const names = (projects || []).filter(p => Number(p.client_harvest_id) === Number(hc.harvest_id) && p.is_active).map(p => p.name);
    want.set(key, (want.get(key) || []).concat(names));
  }
  let changed = 0;
  for (const [id, names] of want) {
    const rc = (rcs || []).find(c => String(c.id) === id);
    if (!rc) continue;
    const words = harvestServiceWords(names);
    if ((rc.service || '') === words) continue;
    const { error } = await admin.from('clients').update({ service: words }).eq('id', rc.id);
    if (!error) changed++;
  }
  return changed;
}

function harvestTimeFrom(now) {
  const d = now || new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
}

async function syncHarvestTime(admin, connection, options = {}) {
  if (!('time_synced_at' in connection)) return { skipped: 'needs-sql' };
  const startedAt = new Date(), from = harvestTimeFrom(startedAt);
  const full = !!options.full || !connection.time_synced_at;
  const since = full ? null : new Date(new Date(connection.time_synced_at).getTime() - 60000).toISOString();
  const list = await fetchAllPages(connection, `/time_entries?from=${from}${since ? `&updated_since=${encodeURIComponent(since)}` : ''}`);

  const out = { full, read: list.length, added: 0, updated: 0, removed: 0, skipped: 0, problems: [] };
  const { ids } = await applyHarvestEntries(admin, list, out);

  // a full read: what's gone from Harvest leaves Radar too (an administrator's token sees everyone's)
  if (full && seesEveryone(connection)) {
    const seen = new Set(ids);
    const { data: rows, error } = await selectAll(() => admin.from('time_entries').select('id, harvest_entry_id')
      .gte('entry_date', from).is('deleted_at', null).eq('harvest_sync_status', 'synced').not('harvest_entry_id', 'is', null).order('id'));
    if (error) out.problems.push(`checking removed time: ${error.message}`);
    await removeGoneTime(admin, (rows || []).filter(r => !seen.has(String(r.harvest_entry_id))).map(r => r.id), startedAt, out);
  }

  const patch = { time_synced_at: startedAt.toISOString() };
  if (full) patch.time_full_at = startedAt.toISOString();
  await admin.from('harvest_connection').update(patch).eq('id', 1);
  return out;
}

function seesEveryone(connection) {
  return Array.isArray(connection.token_user_roles) && connection.token_user_roles.includes('administrator');
}

// Harvest's time entries into Radar: new ones added, changed ones updated. Running timers aren't time
// yet and are left out. Shared by the read above and the one-day read Add Time does (Nov 25).
async function applyHarvestEntries(admin, list, out) {
  const [{ data: hcs }, { data: hus }] = await Promise.all([
    admin.from('harvest_clients').select('harvest_id, radar_client_id'),
    admin.from('harvest_users').select('harvest_id, team_profile_id'),
  ]);
  const clientOf = new Map((hcs || []).filter(h => h.radar_client_id).map(h => [Number(h.harvest_id), String(h.radar_client_id)]));
  const personOf = new Map((hus || []).map(u => [Number(u.harvest_id), u.team_profile_id || null]));
  // Radar's rows for these Harvest entries
  const ids = list.map(e => String(e.id)), mine = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await admin.from('time_entries').select('id, harvest_entry_id, source, harvest_sync_status, deleted_at, entry_date, minutes, description, harvest_project_id, harvest_task_id, client_id, harvest_locked')
      .in('harvest_entry_id', ids.slice(i, i + 200));
    if (error) throw new Error(`time_entries: ${error.message}`);
    (data || []).forEach(r => mine.set(String(r.harvest_entry_id), r));
  }

  const inserts = [], updates = [];
  for (const he of list) {
    if (he.is_running) { out.skipped++; continue; }
    const clientId = he.client && clientOf.get(Number(he.client.id));
    const row = {
      entry_date: he.spent_date, minutes: Math.max(0, Math.round(Number(he.hours || 0) * 60)), description: he.notes || '',
      harvest_project_id: he.project ? he.project.id : null, harvest_task_id: he.task ? he.task.id : null,
      harvest_locked: !!(he.is_locked || he.invoice || he.is_closed), harvest_updated_at: he.updated_at || null,
    };
    const have = mine.get(String(he.id));
    if (have) {
      if (have.deleted_at) continue;                                                           // removed in Radar
      if (['pending', 'failed'].includes(have.harvest_sync_status)) continue;                  // Radar's change is on its way
      if (clientId && String(have.client_id) !== clientId) row.client_id = clientId;
      const differs = Object.keys(row).some(k => k !== 'harvest_updated_at' && String(row[k] ?? '') !== String(have[k] ?? ''));
      if (differs) { if (he.project) row.service = he.project.name; updates.push([have.id, row]); }
      continue;
    }
    if (!clientId) { out.skipped++; continue; }                                                // a client not in Radar
    inserts.push({ ...row, client_id: clientId, service: he.project ? he.project.name : '', user_id: personOf.get(Number(he.user && he.user.id)) || null,
      harvest_user_id: he.user ? he.user.id : null, harvest_entry_id: he.id, source: 'harvest', harvest_sync_status: 'synced' });
  }
  for (let i = 0; i < inserts.length; i += 500) {
    const { error } = await admin.from('time_entries').insert(inserts.slice(i, i + 500));
    if (error) out.problems.push(`adding Harvest time: ${error.message}`); else out.added += Math.min(500, inserts.length - i);
  }
  for (let i = 0; i < updates.length; i += 20) {
    const res = await Promise.all(updates.slice(i, i + 20).map(([id, row]) => admin.from('time_entries').update(row).eq('id', id)));
    res.forEach(r => { if (r.error) out.problems.push(`updating Harvest time: ${r.error.message}`); else out.updated++; });
  }
  return { ids, clientOf };
}

// Time deleted in Harvest leaves Radar too, with any work it was logged as.
async function removeGoneTime(admin, gone, at, out) {
  for (let i = 0; i < gone.length; i += 200) {
    const { error } = await admin.from('time_entries').update({ deleted_at: at.toISOString() }).in('id', gone.slice(i, i + 200));
    if (error) out.problems.push(`removing time: ${error.message}`); else out.removed += Math.min(200, gone.length - i);
  }
  if (gone.length) out.workRemoved = await removeWorkOfGoneTime(admin, gone, at);
}

// One person's time on one day, read from Harvest right now (Nov 25). Add Time asks for it when it
// opens, so time logged in Harvest a minute ago counts when it checks for the same time twice; the
// regular read only runs when someone opens Radar (every 10 minutes at most) and at night.
// Also says which Harvest timers are running for that person, by Radar client.
async function readHarvestDay(admin, connection, { profileId, date }) {
  if (!('time_synced_at' in connection)) return { skipped: 'needs-sql' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return { skipped: 'no-date' };
  const { data: hu } = await admin.from('harvest_users').select('harvest_id').eq('team_profile_id', profileId).limit(1);
  const hid = hu && hu[0] && hu[0].harvest_id ? Number(hu[0].harvest_id) : null;
  if (!hid) return { skipped: 'not-in-harvest' };
  const startedAt = new Date();
  const list = (await fetchAllPages(connection, `/time_entries?user_id=${hid}&from=${date}&to=${date}`))
    .filter(e => !e.user || Number(e.user.id) === hid);                                        // only theirs, whatever the token sees
  const out = { date, read: list.length, added: 0, updated: 0, removed: 0, skipped: 0, problems: [] };
  const { ids, clientOf } = await applyHarvestEntries(admin, list, out);
  out.running = list.filter(e => e.is_running && e.client && clientOf.get(Number(e.client.id))).map(e => ({
    client_id: clientOf.get(Number(e.client.id)), minutes: Math.max(0, Math.round(Number(e.hours || 0) * 60)), notes: e.notes || '',
    harvest_project_id: e.project ? e.project.id : null, harvest_task_id: e.task ? e.task.id : null }));
  // deleted in Harvest since the last read: only when this token sees everyone's time can "not in the
  // list" mean "deleted"
  if (seesEveryone(connection)) {
    const seen = new Set(ids);
    const { data: rows, error } = await admin.from('time_entries').select('id, harvest_entry_id')
      .eq('user_id', profileId).eq('entry_date', date).is('deleted_at', null).eq('harvest_sync_status', 'synced').not('harvest_entry_id', 'is', null);
    if (error) out.problems.push(`checking removed time: ${error.message}`);
    await removeGoneTime(admin, (rows || []).filter(r => !seen.has(String(r.harvest_entry_id))).map(r => r.id), startedAt, out);
  }
  return out;
}

module.exports = {
  removeWorkOfGoneTime,
  syncHarvestSetup,
  syncHarvestTime,
  readHarvestDay,
  syncHarvestBudgets,
  syncHarvestServices,
  harvestServiceWords,
  harvestTimeFrom,
  syncHarvestClients,
  linkHarvestClient,
  inHarvestSetup,
  clientKey,
  validateHarvestCredentials,
  harvestFetch,
  syncTimeEntryToHarvest,
  moveHarvestLink,
  sameButTypo,
  deleteTimeEntryFromHarvest,
};
