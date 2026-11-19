// Step 3 of the Harvest plan: time is logged the way Harvest does it, Client → Project → Task.
// The lists are Harvest's setup, read into Radar (step 1): the client's active projects you're
// assigned to in Harvest, and each project's active tasks. Harvest decides billable per task, so
// a task says Billable or Non-billable and the entry can't change it. Entries keep the project
// and task and go to Harvest as the person who logged them (lib/harvest-sync.js).
// Until Harvest is set up (the tables and addendum-harvest-time.sql), the sheets ask for a
// service as before. Shared by the desktop and the iPhone app.

let hvTime = null; // { ready, me, clients, projects, tasks, taskAssign, userAssign }; null = not loaded

async function hvTimeLoad(){
  if(typeof supabaseClient === 'undefined' || !currentUser) return;
  const q = (t, cols) => supabaseClient.from(t).select(cols);
  try{
    const [c, p, t, ta, ua, u, probe] = await Promise.all([
      q('harvest_clients', 'harvest_id, name, is_active, radar_client_id'),
      q('harvest_projects', 'harvest_id, client_harvest_id, name, is_active, budget, budget_by, budget_is_monthly'),
      q('harvest_tasks', 'harvest_id, name, is_active'),
      q('harvest_task_assignments', 'project_harvest_id, task_harvest_id, billable, is_active'),
      q('harvest_user_assignments', 'project_harvest_id, user_harvest_id, is_active'),
      q('harvest_users', 'harvest_id, first_name, last_name, team_profile_id, is_active'),
      supabaseClient.from('time_entries').select('harvest_project_id').limit(1),
    ]);
    if(c.error || p.error || t.error || ta.error || ua.error || u.error){ hvTime = { ready: false }; return; }
    const me = (u.data || []).find(x => x.team_profile_id === currentUser.id);
    hvTime = {
      ready: !probe.error && (p.data || []).length > 0,
      me: me ? Number(me.harvest_id) : null,
      clients: c.data || [], projects: (p.data || []).filter(x => x.is_active),
      tasks: new Map((t.data || []).map(x => [Number(x.harvest_id), x])),
      taskAssign: (ta.data || []).filter(x => x.is_active), userAssign: (ua.data || []).filter(x => x.is_active),
      people: u.data || [],
    };
  }catch(e){ hvTime = { ready: false }; }
}
function hvTimeOn(){ return !!(hvTime && hvTime.ready); }

// Harvest is the source of truth for what each client buys. The server writes a linked client's
// active Harvest projects into its service ("MDF - Tier 3 · Website Hosting and Maintenance"),
// so every screen shows them; Radar only asks for a service for clients that aren't in Harvest.
function hvHarvestClientOf(clientId){
  return hvTime && Array.isArray(hvTime.clients) && clientId != null ? hvTime.clients.find(x => String(x.radar_client_id || '') === String(clientId)) || null : null;
}
function serviceFromHarvest(c){ return !!(c && hvHarvestClientOf(c.id)); }
function harvestOwnsServices(){ return !!(hvTime && Array.isArray(hvTime.clients) && hvTime.clients.some(x => x.radar_client_id)); }
// The service's parts: its projects, or the one service picked in Radar.
function serviceParts(c){ return String((c && c.service) || '').split(' · ').map(s => s.trim()).filter(Boolean); }
function serviceHas(c, v){ return serviceParts(c).includes(v); }
// For a client's improvement: the project when it has just one, else nothing (it says which when time is logged).
function improvementServiceFor(c){ const p = serviceParts(c); return serviceFromHarvest(c) ? (p.length === 1 ? p[0] : '') : (c && c.service) || ''; }

// The client's Harvest projects: { all, mine } (mine = the ones you're assigned to).
function hvClientProjects(clientId){
  if(!hvTimeOn() || !clientId) return { all: [], mine: [], linked: false };
  const hc = hvTime.clients.find(x => String(x.radar_client_id || '') === String(clientId));
  if(!hc) return { all: [], mine: [], linked: false };
  const all = hvTime.projects.filter(p => Number(p.client_harvest_id) === Number(hc.harvest_id)).sort((a, b) => a.name.localeCompare(b.name));
  const mine = hvTime.me == null ? [] : all.filter(p => hvTime.userAssign.some(a => Number(a.project_harvest_id) === Number(p.harvest_id) && Number(a.user_harvest_id) === hvTime.me));
  return { all, mine, linked: true };
}
// A project's tasks, billable first: [{ id, name, billable }]
// Only the tasks in your areas of work (work-areas.js), plus keepId (the one an entry already has);
// all = every task.
function hvProjectTasks(projectId, keepId, all){
  if(!hvTimeOn() || !projectId) return [];
  return hvTime.taskAssign.filter(a => Number(a.project_harvest_id) === Number(projectId))
    .map(a => { const t = hvTime.tasks.get(Number(a.task_harvest_id)); return t && t.is_active !== false ? { id: Number(t.harvest_id), name: t.name, billable: a.billable !== false } : null; })
    .filter(t => t && (all || t.id === Number(keepId) || typeof waTaskAllowed !== 'function' || waTaskAllowed(t.name)))
    .sort((a, b) => (hvOwnTask(b) - hvOwnTask(a)) || (b.billable - a.billable) || a.name.localeCompare(b.name));
}
// a task in your own areas comes first (Web Design before Reporting for someone who does Web)
function hvOwnTask(t){
  if(typeof waMyAreas !== 'function') return 0;
  const mine = waMyAreas(), a = waTaskArea(t.name);
  return mine.length && a && mine.includes(a) ? 1 : 0;
}
// Step 4: a client's monthly hours from Harvest (its projects' monthly hour budgets), or 0.
// The server keeps the client's budget in step; this tells the screens it comes from Harvest.
function hvClientBudget(clientId){
  if(!hvTime || !hvTime.projects || !clientId) return 0;
  const hc = (hvTime.clients || []).find(x => String(x.radar_client_id || '') === String(clientId));
  if(!hc) return 0;
  const h = hvTime.projects.filter(p => Number(p.client_harvest_id) === Number(hc.harvest_id) && p.budget_by === 'project' && p.budget_is_monthly && Number(p.budget) > 0)
    .reduce((a, p) => a + Number(p.budget), 0);
  return Math.round(h * 10) / 10;
}
// The name of a Harvest person with no Radar account (their time still counts).
function hvPersonName(harvestUserId){
  const u = hvTime && (hvTime.people || []).find(x => Number(x.harvest_id) === Number(harvestUserId));
  return u ? [u.first_name, u.last_name].filter(Boolean).join(' ') : '';
}
function hvProjectName(id){ const p = hvTimeOn() && hvTime.projects.find(x => Number(x.harvest_id) === Number(id)); return p ? p.name : ''; }
function hvTaskName(id){ const t = hvTimeOn() && hvTime.tasks.get(Number(id)); return t ? t.name : ''; }
// "MDF - Tier 3 · Campaign optimization" for a row, or the old service
function hvEntryWords(e){
  const p = e.harvestProjectId ? hvProjectName(e.harvestProjectId) : '', t = e.harvestTaskId ? hvTaskName(e.harvestTaskId) : '';
  return p || t ? [p, t].filter(Boolean).join(' · ') : (e.service || '');
}

// Your last few client · project · task, newest first, still valid in Harvest.
function hvRecentPicks(limit){
  if(!hvTimeOn() || typeof timeEntries === 'undefined' || !currentUser) return [];
  const seen = new Set(), out = [];
  const mine = timeEntries.filter(e => e.userId === currentUser.id && e.harvestProjectId && e.harvestTaskId)
    .sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)));
  for(const e of mine){
    const k = `${e.clientId}|${e.harvestProjectId}|${e.harvestTaskId}`;
    if(seen.has(k)) continue; seen.add(k);
    const c = clients.find(x => x.id === e.clientId && !x.deletedAt);
    if(!c || (typeof waCanWork === 'function' && !waCanWork(c)) || !hvClientProjects(c.id).mine.some(p => Number(p.harvest_id) === Number(e.harvestProjectId))) continue;
    if(!hvProjectTasks(e.harvestProjectId).some(t => t.id === Number(e.harvestTaskId))) continue;
    out.push({ clientId: c.id, projectId: Number(e.harvestProjectId), taskId: Number(e.harvestTaskId) });
    if(out.length >= (limit || 3)) break;
  }
  return out;
}
function hvPickWords(r){
  const c = clients.find(x => x.id === r.clientId), many = hvClientProjects(r.clientId).mine.length > 1;
  return [c ? c.name : '', many ? hvProjectName(r.projectId) : '', hvTaskName(r.taskId)].filter(Boolean).join(' · ');
}
// What to start with for a client: your last project and task there, else its only project and
// its first billable task.
function hvDefaultPick(clientId, projectId){
  const { mine } = hvClientProjects(clientId);
  if(!mine.length) return { projectId: null, taskId: null };
  if(!projectId && typeof timeEntries !== 'undefined' && currentUser){
    const last = timeEntries.filter(e => e.userId === currentUser.id && e.clientId === clientId && e.harvestProjectId)
      .sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)))[0];
    if(last && mine.some(p => Number(p.harvest_id) === Number(last.harvestProjectId))){
      const ts = hvProjectTasks(last.harvestProjectId);
      return { projectId: Number(last.harvestProjectId), taskId: ts.some(t => t.id === Number(last.harvestTaskId)) ? Number(last.harvestTaskId) : (ts[0] || {}).id || null };
    }
  }
  const pid = projectId && mine.some(p => Number(p.harvest_id) === Number(projectId)) ? Number(projectId) : (mine.length === 1 ? Number(mine[0].harvest_id) : null);
  const ts = pid ? hvProjectTasks(pid) : [];
  return { projectId: pid, taskId: ts.length ? ts[0].id : null };
}
// Why a client has nothing to pick, in words (null when it has projects for you).
function hvNoPickWords(clientId){
  const { all, mine, linked } = hvClientProjects(clientId);
  if(mine.length) return null;
  if(!linked || !all.length) return 'Not in Harvest, so this time stays in Radar.';
  if(hvTime.me == null) return 'You aren’t in Harvest yet, so this time stays in Radar.';
  return 'You aren’t on its projects in Harvest, so this time stays in Radar. An admin can add you there.';
}

// ---- the desktop sheets: Project and Task rows in a sheet's form grid ---------------------------
// prefix: 'manual' | 'timerModal' | 'editEntry'. The rows sit in #<prefix>Pick (display: contents),
// so they line up with the sheet's other labels. With Harvest off, it's the old Service row.
function hvPickRowsHtml(prefix, clientId, projectId, taskId, service){
  if(!hvTimeOn()){
    const c = clients.find(x => x.id === clientId);
    return `<label for="${prefix}Service">Service</label><div>${sheetPop(prefix + 'Service', 'Service', timeServiceOpts(c, service, prefix === 'editEntry'), service != null ? service : (c && c.service) || (settings.serviceOptions || [])[0] || '')}</div>`;
  }
  if(!clientId) return `<label>Project</label><div class="hvp-none t-3">Pick a client first</div>`;
  const none = hvNoPickWords(clientId);
  if(none) return `<label>Project</label><div class="hvp-none t-2">${escapeHtml(none)}</div>`;
  const { mine } = hvClientProjects(clientId);
  const pid = projectId && mine.some(p => Number(p.harvest_id) === Number(projectId)) ? Number(projectId) : null;
  const project = mine.length === 1
    ? `<div class="hvp-one"><input type="hidden" id="${prefix}Project" value="${mine[0].harvest_id}">${escapeHtml(mine[0].name)}</div>`
    : `<div>${sheetPop(prefix + 'Project', 'Project', mine.map(p => [String(p.harvest_id), p.name]), pid ? String(pid) : '', `hvPickChanged('${prefix}','project')`, { placeholder: 'Choose a project' })}</div>`;
  const usePid = mine.length === 1 ? Number(mine[0].harvest_id) : pid;
  const ts = usePid ? hvProjectTasks(usePid, taskId) : [];
  const tid = taskId && ts.some(t => t.id === Number(taskId)) ? Number(taskId) : null;
  const cur = ts.find(t => t.id === tid);
  const task = !usePid ? `<div class="hvp-none t-3">Pick a project first</div>`
    : !ts.length ? `<div class="hvp-none t-2">${hvProjectTasks(usePid, null, true).length ? 'None of its tasks are in your areas.' : 'This project has no tasks in Harvest yet.'}</div>`
    : `<div class="hvp-task">${sheetPop(prefix + 'Task', 'Task', ts.map(t => [String(t.id), t.name]), tid ? String(tid) : '', `hvPickChanged('${prefix}','task')`, { placeholder: 'Choose a task' })}<span class="hvp-bill" id="${prefix}Bill">${cur ? (cur.billable ? 'Billable' : 'Non-billable') : ''}</span></div>`;
  return `<label${mine.length > 1 ? ` for="${prefix}Project"` : ''}>Project</label>${project}<label${ts.length ? ` for="${prefix}Task"` : ''}>Task</label>${task}`;
}
function hvPickBlockHtml(prefix, clientId, projectId, taskId, service){
  return `<div id="${prefix}Pick" class="hvp">${hvPickRowsHtml(prefix, clientId, projectId, taskId, service)}</div>`;
}
// A row of your recent client · project · task above the form, each one click.
function hvRecentHtml(prefix, clientSelId){
  const rs = hvRecentPicks(3);
  if(!rs.length) return '';
  return `<label class="top">Recent</label><div class="hvp-recent">${rs.map(r => `<button type="button" class="hvp-chip" onclick="hvUseRecent('${prefix}','${clientSelId}','${r.clientId}',${r.projectId},${r.taskId})">${escapeHtml(hvPickWords(r))}</button>`).join('')}</div>`;
}
function hvUseRecent(prefix, clientSelId, clientId, projectId, taskId){
  const sel = document.getElementById(clientSelId);
  if(sel){ sel.value = clientId; if(typeof syncPopSel === 'function') syncPopSel(sel); }
  const wrap = document.getElementById(prefix + 'Pick');
  if(wrap) wrap.innerHTML = hvPickRowsHtml(prefix, clientId, projectId, taskId);
  document.querySelectorAll('.hvp-chip').forEach(b => b.classList.toggle('on', b.getAttribute('onclick').includes(`'${clientId}',${projectId},${taskId})`)));
}
// The client, project or task changed: redraw what depends on it.
function hvPickChanged(prefix, what, clientSelId){
  const wrap = document.getElementById(prefix + 'Pick'); if(!wrap) return;
  const cid = document.getElementById(clientSelId || (prefix === 'timerModal' ? 'timerModalClient' : prefix === 'editEntry' ? 'editEntryClient' : prefix === 'li' ? 'liClient' : prefix + 'Client'))?.value || '';
  if(what === 'task'){
    const tid = Number(document.getElementById(prefix + 'Task')?.value), pid = Number(document.getElementById(prefix + 'Project')?.value);
    const t = hvProjectTasks(pid, tid).find(x => x.id === tid), b = document.getElementById(prefix + 'Bill');
    if(b) b.textContent = t ? (t.billable ? 'Billable' : 'Non-billable') : '';
    return;
  }
  if(what === 'project'){
    const pid = Number(document.getElementById(prefix + 'Project')?.value) || null;
    wrap.innerHTML = hvPickRowsHtml(prefix, cid, pid, (hvDefaultPick(cid, pid)).taskId);
    return;
  }
  if(!hvTimeOn()){ wrap.innerHTML = hvPickRowsHtml(prefix, cid, null, null); return; }
  const d = hvDefaultPick(cid);
  wrap.innerHTML = hvPickRowsHtml(prefix, cid, d.projectId, d.taskId);
}
// What the rows hold: { service } with Harvest off; else { projectId, taskId, service } — the
// service is the project's name, so reports by service read as Harvest's projects. ok: false
// with a message when a task is still to pick.
function hvPickValue(prefix, clientId){
  if(!hvTimeOn()) return { ok: true, service: document.getElementById(prefix + 'Service')?.value || '', projectId: null, taskId: null };
  if(hvNoPickWords(clientId)) return { ok: true, service: '', projectId: null, taskId: null };
  const pid = Number(document.getElementById(prefix + 'Project')?.value) || null, tid = Number(document.getElementById(prefix + 'Task')?.value) || null;
  if(!pid) return { ok: false, msg: 'Pick the Harvest project this time is for.' };
  if(!tid){ return hvProjectTasks(pid).length ? { ok: false, msg: 'Pick the task, as in Harvest.' } : { ok: true, service: hvProjectName(pid), projectId: pid, taskId: null }; }
  return { ok: true, service: hvProjectName(pid), projectId: pid, taskId: tid };
}
