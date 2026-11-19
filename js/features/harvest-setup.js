// Settings → Harvest: what Radar reads from Harvest (step 1 of the Harvest plan).
// Harvest owns the setup: clients, their projects, each project's tasks (billable or not), who is
// assigned where, and the team. Radar reads it, never changes it: whatever changed when someone
// opens Radar (at most every 10 minutes, the server decides), everything each night, and Sync Now.
// This pane shows the connection, what was read, the team matched by email, and each client's
// projects and tasks. The old client/service mappings stay until time is logged by project and task.

let hvData = null;           // { clients, projects, tasks, taskAssignments, userAssignments, users } from the harvest_* tables; null = not loaded
let hvLoading = false;
let hvOpen = {};             // Harvest client id -> its projects shown
let hvShowAll = false;       // Clients in Harvest: show them all
let hvSyncing = false;
const HV_SHOWN = 8;

// When the app opens (the lists as they are were read before the first screen): ask the server to
// read what changed in Harvest. Quiet: it skips itself when Harvest isn't connected, the database
// isn't set up, or it read less than 10 minutes ago.
function harvestSyncInBackground(){
  if(!myProfile || typeof harvestApiCall !== 'function') return;
  harvestApiCall('sync-setup').catch(() => {}).then(() => { if(typeof hvLoadLinks === 'function') hvLoadLinks(); if(typeof hvTimeLoad === 'function') hvTimeLoad(); });
}

async function hvLoad(){
  if(hvLoading) return;
  hvLoading = true;
  const q = t => supabaseClient.from(t).select('*');
  try{
    const all = (t, ...cols) => selectAll(() => cols.reduce((x, k) => x.order(k), q(t)));
    const [c, p, t, ta, ua, u] = await Promise.all([q('harvest_clients'), all('harvest_projects', 'harvest_id'), q('harvest_tasks'),
      all('harvest_task_assignments', 'project_harvest_id', 'task_harvest_id'), all('harvest_user_assignments', 'project_harvest_id', 'user_harvest_id'), q('harvest_users')]);
    hvData = c.error ? { missing: true } : { clients: c.data || [], projects: p.data || [], tasks: t.data || [], taskAssignments: ta.data || [], userAssignments: ua.data || [], users: u.data || [] };
  }catch(e){ hvData = { missing: true }; }
  hvLoading = false;
  if(currentViewName === 'settings' && settingsTab === 'harvest') renderSettingsView();
}
async function hvRefreshAll(){
  try{ integ.harvest = await harvestApiCall(null); }catch(e){}
  await hvLoad();
}
function openHarvestSettings(){ switchSettingsTab('harvest'); }

async function hvSyncNow(){
  if(hvSyncing) return;
  hvSyncing = true; renderSettingsView();
  try{
    const r = await harvestApiCall('sync-setup', { force: true });
    if(r && r.skipped === 'needs-sql') showToast('error', 'Not set up yet', 'Run addendum-harvest-sync.sql in Supabase first.');
    else if(r && r.problems && r.problems.length) showToast('error', 'Read with problems', r.problems[0]);
    else showToast('success', 'Read from Harvest', r && r.counts ? `${r.counts.clients || 0} clients, ${r.counts.projects || 0} projects, ${r.counts.tasks || 0} tasks` : '');
  }catch(e){ showToast('error', 'Couldn’t read Harvest', e.message); }
  hvSyncing = false;
  await hvRefreshAll();
}

function hvToggleClient(id){ hvOpen[id] = !hvOpen[id]; renderSettingsView(); }
function hvToggleAll(){ hvShowAll = !hvShowAll; renderSettingsView(); }

// The Radar client a Harvest client is: its link (step 2; it may be in Trash), else the same name.
function hvRadarClient(hc){
  if(hc.radar_client_id) return clients.find(x => String(x.id) === String(hc.radar_client_id)) || null;
  const n = winNorm(hc.name);
  return liveClients().find(c => winNorm(c.name) === n) || null;
}
// Where it stands in Radar, for the Clients in Harvest list.
function hvRadarStatus(hc){
  const rc = hvRadarClient(hc), st = (color, text) => `<span class="st"><span class="dot ${color}"></span>${text}</span>`;
  if(!rc) return st('hollow', 'Not in Radar yet');
  const cfv = rc.customFieldValues || {};
  if(rc.deletedAt) return st('hollow', cfv.harvestSetup === 'skipped' ? 'Left out of Radar' : 'In Trash');
  if(clientInSetup(rc)) return st('yellow', 'Needs setup');
  return st('green', `In Radar${winNorm(rc.name) !== winNorm(hc.name) ? ` as ${escapeHtml(rc.name)}` : ''}`);
}
function hvBudget(p){
  if(p.budget == null || !p.budget_by || p.budget_by === 'none') return '';
  // Harvest: project / task / person = hours; project_cost / task_fees = money
  const hours = !['project_cost', 'task_fees'].includes(p.budget_by);
  const n = Number(p.budget);
  const amt = hours ? `${n % 1 ? n.toFixed(1) : n} h` : `$${Math.round(n).toLocaleString('en-US')}`;
  return `${amt}${p.budget_is_monthly ? ' a month' : ''}`;
}
// "October 1": time is read from the first of last month
function hvMonthStart(){ const n = rNow(); return new Date(n.getFullYear(), n.getMonth() - 1, 1).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }); }
// "at 2:05 PM", "yesterday at 3:00 PM", "Nov 14 at 9:00 AM"
function hvWhen(iso){ const d = new Date(iso), k = daysBetween(dayStart(d), dayStart(rNow())); return (k === 0 ? 'at ' : '') + (typeof waAt === 'function' ? waAt(iso) : fmtTime(d)); }
const hvUserName = u => [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email || 'Someone';

function setHarvest(){
  const h = integ.harvest, d = hvData, admin = isAdmin();
  const st = (color, text) => `<span class="st"><span class="dot ${color}"></span>${text}</span>`;
  if(h == null || (d == null && h && h.connected)){
    if(h == null) harvestApiCall(null).then(x => { integ.harvest = x; renderSettingsView(); }).catch(() => { integ.harvest = { connected: false }; renderSettingsView(); });
    if(d == null) hvLoad();
    return `<div class="hv-sec"><div class="set-h">Connection</div><div class="form-grp">${fr('Harvest', 'Checking…', st('', 'Checking…'))}</div></div>`;
  }

  // ---- connection
  if(!h.connected){
    const form = admin ? `<div class="form-grp">
${fr('Personal access token', 'From Harvest ID → Developers. It stays on the server.', '<input class="tf" id="harvestPatInput" type="password" style="width:240px" aria-label="Personal access token">')}
${fr('Account ID', 'Shown next to the token in Harvest', '<input class="tf" id="harvestAccountIdInput" style="width:240px" aria-label="Account ID">')}
<div class="fr"><div class="l"><span id="harvestConnectError" class="t-red"></span></div><button class="btn btn-p" id="harvestConnectBtn" onclick="hvConnect()">Connect Harvest</button></div></div>`
      : `<div class="form-grp">${fr('Harvest', 'An admin connects Harvest with a token from Harvest’s Developers page.', st('hollow', 'Not connected'))}</div>`;
    return `<div class="hv-sec"><div class="set-h">Connection</div>${form}
<p class="t-2 hv-p">Use an administrator’s token: it lets Radar read the whole setup and log time for everyone.</p></div>`;
  }
  const s = h.setup || {};
  const roles = s.tokenRoles || [];
  const isAdminToken = roles.includes('administrator');
  const who = s.tokenUser ? `${escapeHtml(s.tokenUser)}’s token${roles.length ? `, ${escapeHtml(isAdminToken ? 'administrator' : roles.includes('manager') ? 'manager' : 'member')}` : ''}` : 'Token saved';
  let html = `<div class="hv-sec"><div class="set-h">Connection</div><div class="form-grp">
${fr('Harvest', `Account ${escapeHtml(h.accountId || '')} · ${who}`, `${st('green', 'Connected')}${admin ? `<button class="btn" onclick="disconnectHarvest().then(hvRefreshAll)">Disconnect…</button>` : ''}`)}
${s.tokenUser && !isAdminToken ? `<div class="fr hv-warn"><div class="l"><b>Not an administrator’s token</b><span>Radar can read what this person sees, but can’t log time for anyone else. Reconnect with an administrator’s token.</span></div></div>` : ''}
</div></div>`;

  // ---- the database isn't set up for it yet
  if(!s.ready || (d && d.missing)){
    return html + `<div class="hv-sec"><div class="set-h">Read from Harvest</div>${emptyState({ compact: true, icon: 'timer', tone: 'blue', html: true, title: 'Add Harvest’s setup to the database first',
      text: 'Run <code>addendum-harvest-sync.sql</code> in Supabase → SQL Editor. Radar then reads Harvest’s clients, projects and tasks, and this page shows them.' })}</div>`;
  }

  // ---- what was read
  const c = s.counts || {};
  const read = s.syncedAt ? `read ${hvWhen(s.syncedAt)}` : 'not read yet';
  html += `<div class="hv-sec"><div class="set-h">Read from Harvest</div><div class="form-grp">
${fr('Clients, projects and tasks', `${c.clients || 0} clients · ${c.projects || 0} projects · ${c.tasks || 0} tasks · ${read}${s.error ? `<br><span class="t-red">${escapeHtml(s.error)}</span>` : ''}`,
  canApprove() ? `<button class="btn" onclick="hvSyncNow()"${hvSyncing ? ' disabled' : ''}>${hvSyncing ? icon('loader', { cls: 'spin' }) : icon('arrows-clockwise')}${hvSyncing ? 'Reading…' : 'Sync Now'}</button>` : '')}
${s.timeReady ? fr('Time logged in Harvest', `From ${hvMonthStart()} on · ${s.timeSyncedAt ? `read ${hvWhen(s.timeSyncedAt)}` : 'not read yet'}. It shows on the Time screen and counts in hours and budgets.`, '')
  : fr('Time logged in Harvest', 'Run <code>addendum-harvest-time-read.sql</code> in Supabase so Radar reads it.', '')}
</div>
<p class="t-2 hv-p">Radar never changes Harvest’s setup. It reads what changed whenever someone opens Radar, at most every 10 minutes, and everything each night.</p></div>`;

  // ---- clients, with their projects and tasks
  const active = d.clients.filter(x => x.is_active).sort((a, b) => a.name.localeCompare(b.name));
  const archived = d.clients.length - active.length;
  const projOf = id => d.projects.filter(p => p.client_harvest_id === id && p.is_active).sort((a, b) => a.name.localeCompare(b.name));
  const taskName = new Map(d.tasks.map(t => [t.harvest_id, t.name]));
  const tasksOf = pid => d.taskAssignments.filter(a => a.project_harvest_id === pid && a.is_active)
    .map(a => ({ name: taskName.get(a.task_harvest_id) || 'Task', billable: a.billable })).sort((a, b) => (b.billable === true) - (a.billable === true) || a.name.localeCompare(b.name));
  const inRadar = active.filter(hc => { const rc = hvRadarClient(hc); return rc && !rc.deletedAt && !clientInSetup(rc); }).length;
  const waiting = active.filter(hc => { const rc = hvRadarClient(hc); return rc && !rc.deletedAt && clientInSetup(rc); }).length;
  const shown = hvShowAll ? active : active.slice(0, HV_SHOWN);
  const clientRow = hc => {
    const ps = projOf(hc.harvest_id), open = !!hvOpen[hc.harvest_id];
    const sub = ps.length ? ps.map(p => p.name).join(', ') : 'No active projects';
    const body = open ? `<div class="hv-ps">${ps.map(p => {
      const ts = tasksOf(p.harvest_id), b = hvBudget(p);
      return `<div class="hv-p"><div class="hv-ph"><b>${escapeHtml(p.name)}</b><span>${[p.is_billable === false ? 'Non-billable project' : '', b].filter(Boolean).map(escapeHtml).join(' · ')}</span></div>
${ts.length ? ts.map(t => `<div class="hv-t"><span>${escapeHtml(t.name)}</span><em class="${t.billable ? 'is-b' : ''}">${t.billable ? 'Billable' : 'Non-billable'}</em></div>`).join('') : '<div class="hv-t"><span class="t-3">No tasks</span></div>'}</div>`;
    }).join('') || '<p class="t-2 hv-none">Nothing to log time to yet.</p>'}</div>` : '';
    return `<div class="hv-c${open ? ' is-open' : ''}"><button class="fr hv-ch" aria-expanded="${open}" data-grow="hv-c-${hc.harvest_id}" onclick="hvToggleClient(${hc.harvest_id})">${icon('caret-right', { weight: 'bold' })}<div class="l"><b>${escapeHtml(hc.name)}</b><span>${escapeHtml(sub)}</span></div>
${hvRadarStatus(hc)}</button>
<div data-grow-key="hv-c-${hc.harvest_id}">${body}</div></div>`;
  };
  html += `<div class="hv-sec"><div class="set-h">Clients in Harvest <span class="n">${active.length}</span></div>
<div class="form-grp hv-cl" data-grow-key="hv-clients">${shown.map(clientRow).join('') || fr('No clients yet', 'They show here after the first read.', '')}</div>
${active.length > HV_SHOWN ? `<button class="lnk-b hv-more" data-grow="hv-clients" data-turn="180" aria-expanded="${hvShowAll}" onclick="hvToggleAll()">${hvShowAll ? 'Show less' : `Show all ${active.length}`}${icon('caret-down', { weight: 'bold' })}</button>` : ''}
<p class="t-2 hv-p">${s.clientsReady
  ? `${inRadar} of ${active.length} are in Radar.${waiting ? ` ${waiting} added from Harvest ${waiting === 1 ? 'needs' : 'need'} setup: <a class="x-lnk" href="#" onclick="clientsSeg='all';switchView('clients');return false;">finish ${waiting === 1 ? 'it' : 'them'} in All Clients</a>.` : ''} Radar adds every active Harvest client and asks approvers to finish their info.`
  : `${inRadar} of ${active.length} are in Radar under the same name. To add the rest, run <code>addendum-harvest-clients.sql</code> in Supabase → SQL Editor.`}${archived ? ` ${archived} archived in Harvest ${archived === 1 ? 'isn’t' : 'aren’t'} shown.` : ''}</p></div>`;

  // ---- the team, matched by email
  const people = d.users.filter(u => u.is_active).sort((a, b) => hvUserName(a).localeCompare(hvUserName(b)));
  const profiles = (typeof teamProfiles !== 'undefined' ? teamProfiles : []).filter(p => !p.access_revoked);
  const matchedIds = new Set(people.map(u => u.team_profile_id).filter(Boolean));
  const notInHarvest = profiles.filter(p => !matchedIds.has(p.id));
  html += `<div class="hv-sec"><div class="set-h">Team</div><div class="form-grp">
${people.map(u => { const p = profiles.find(x => x.id === u.team_profile_id);
  return fr(escapeHtml(hvUserName(u)), escapeHtml(u.email || ''), p ? `<span class="st"><span class="dot green"></span>${escapeHtml(firstName(p.name))} in Radar</span>` : '<span class="st"><span class="dot hollow"></span>No Radar account</span>'); }).join('')
  || fr('No one yet', s.error && /users/.test(s.error) ? 'This token can’t read Harvest’s people.' : 'People show here after the first read.', '')}
${notInHarvest.map(p => fr(escapeHtml(p.name), escapeHtml(p.email || ''), '<span class="st"><span class="dot yellow"></span>Not in Harvest</span>')).join('')}
</div><p class="t-2 hv-p">Matched by email. Time someone logs in Radar goes to Harvest as them.</p></div>`;

  // ---- time that didn't reach Harvest: open one, pick its project and task, and it goes
  const unsent = hvUnsentEntries();
  if(unsent.length){
    const people = new Map((typeof teamProfiles !== 'undefined' ? teamProfiles : []).map(p => [p.id, p.name]));
    const row = e => { const c = clients.find(x => x.id === e.clientId);
      return `<button class="fr hv-un" onclick="openTimeEntryModal('${e.id}')"><div class="l"><b>${escapeHtml(c ? c.name : 'Client')} · ${hmm(e.minutes)}</b><span>${escapeHtml([fmtShortDate(new Date(e.date + 'T12:00:00')), people.get(e.userId) ? firstName(people.get(e.userId)) : '', e.harvestError || 'No project and task yet'].filter(Boolean).join(' · '))}</span></div>${icon('caret-right', { weight: 'bold' })}</button>`; };
    html += `<div class="hv-sec"><div class="set-h">Not in Harvest <span class="n">${unsent.length}</span></div><div class="form-grp">${unsent.slice(0, 6).map(row).join('')}</div>
<p class="t-2 hv-p">Time logged here that hasn’t reached Harvest${unsent.length > 6 ? `, newest first: ${unsent.length - 6} more on the Time screen` : ''}. Open one and pick its project and task to send it.</p></div>`;
  }
  return html;
}

// Time since the first of last month, for a client in Harvest, that didn't get there (newest first).
function hvUnsentEntries(){
  if(typeof timeEntries === 'undefined' || typeof hvClientProjects !== 'function') return [];
  const n = rNow(), from = toDateStr(new Date(n.getFullYear(), n.getMonth() - 1, 1));
  return timeEntries.filter(e => e.date >= from && !e.harvestId && (e.harvestStatus === 'failed' || e.harvestStatus === 'unmapped') && hvClientProjects(e.clientId).linked)
    .sort((a, b) => b.date.localeCompare(a.date));
}

async function hvConnect(){
  const pat = (document.getElementById('harvestPatInput') || {}).value?.trim(), acc = (document.getElementById('harvestAccountIdInput') || {}).value?.trim();
  const err = document.getElementById('harvestConnectError'), btn = document.getElementById('harvestConnectBtn');
  if(!pat || !acc){ if(err) err.textContent = 'Both are needed.'; return; }
  if(btn){ btn.disabled = true; btn.textContent = 'Connecting…'; }
  try{
    await harvestApiCall('connect', { pat, accountId: acc });
    showToast('success', 'Harvest connected', 'Reading its setup now.');
    await harvestApiCall('sync-setup', { force: true }).catch(() => {});
    await hvRefreshAll();
  }catch(e){
    if(err) err.textContent = e.message;
    if(btn){ btn.disabled = false; btn.textContent = 'Connect Harvest'; }
  }
}
