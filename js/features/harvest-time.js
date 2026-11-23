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
      selectAll(() => q('harvest_projects', 'harvest_id, client_harvest_id, name, is_active, budget, budget_by, budget_is_monthly').order('harvest_id')),
      q('harvest_tasks', 'harvest_id, name, is_active'),
      // one row per task on each project: well past 1000 with a hundred projects, so read in pages
      selectAll(() => q('harvest_task_assignments', 'project_harvest_id, task_harvest_id, billable, is_active').order('project_harvest_id').order('task_harvest_id')),
      selectAll(() => q('harvest_user_assignments', 'project_harvest_id, user_harvest_id, is_active').order('project_harvest_id').order('user_harvest_id')),
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
  all = all || hvProjectAssigned(projectId);
  return hvTime.taskAssign.filter(a => Number(a.project_harvest_id) === Number(projectId))
    .map(a => { const t = hvTime.tasks.get(Number(a.task_harvest_id)); return t && t.is_active !== false ? { id: Number(t.harvest_id), name: t.name, billable: a.billable !== false } : null; })
    .filter(t => t && (all || t.id === Number(keepId) || typeof waTaskAllowed !== 'function' || waTaskAllowed(t.name)))
    .sort((a, b) => (hvOwnTask(b) - hvOwnTask(a)) || (b.billable - a.billable) || a.name.localeCompare(b.name));
}
// A client outside your areas that's yours anyway (you were given a task for it, or you've worked on
// it lately): every one of its projects' tasks is open to you (otherwise a Paid Ads project would
// show a Web member no tasks at all).
function hvProjectAssigned(projectId){
  if(typeof waYours !== 'function' || typeof waInMyAreas !== 'function') return false;
  const p = hvTime.projects.find(x => Number(x.harvest_id) === Number(projectId)); if(!p) return false;
  const hc = hvTime.clients.find(x => Number(x.harvest_id) === Number(p.client_harvest_id));
  const c = hc && clients.find(x => String(x.id) === String(hc.radar_client_id || ''));
  return !!c && waMyAreas().length > 0 && !waInMyAreas(c) && !waOwnsClient(c) && waWorkedOnRecently(c);
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
// ---- Harvest knows this client under another name (Nov 23) ----------------------------------------
// Radar links clients to Harvest by name, so "PE Developement" here and "PE Development" there weren't
// linked, and the time stayed in Radar. Where time is logged, Radar now says which Harvest client it
// probably is, and an approver links them right there.
const HV_NAME_SKIP = new Set(['llc', 'inc', 'co', 'corp', 'ltd', 'the', 'and']);
function hvNameWords(s){ return String(s || '').toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(w => w && !HV_NAME_SKIP.has(w)); }
function hvEdits(a, b, max){
  if(Math.abs(a.length - b.length) > max) return false;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for(let j = 1; j <= b.length; j++) d[0][j] = j;
  for(let i = 1; i <= a.length; i++) for(let j = 1; j <= b.length; j++){
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if(i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length] <= max;
}
// A word the same but for a typo: a letter off in words of 5 to 8 letters, two in longer ones.
function hvWordAlike(a, b){ if(a === b) return true; const n = Math.min(a.length, b.length); return n >= 5 && hvEdits(a, b, n >= 9 ? 2 : 1); }
// 2: the same name but for typos and endings ("PE Developement" / "PE Development LLC");
// 1: one is the other with more words after ("Online Liquidation" / "Online Liquidation Auction"),
// or one starts with the other's initials ("ABD Team" / "American Building Development"); 0: not alike.
function hvNamesAlike(a, b){
  const x = hvNameWords(a), y = hvNameWords(b);
  if(!x.length || !y.length) return 0;
  if(x.length === y.length && x.every((w, i) => hvWordAlike(w, y[i]))) return 2;
  const initials = (p, q) => q.length >= 3 && /^[a-z]+$/.test(p[0]) && p[0] === q.map(w => w[0]).join('');
  if(initials(x, y) || initials(y, x)) return 1;
  if(x.length === y.length) return 0;
  const [sh, lo] = x.length < y.length ? [x, y] : [y, x];
  return sh.join(' ').length >= 6 && sh.every((w, i) => hvWordAlike(w, lo[i])) ? 1 : 0;
}
// The Harvest client this Radar client probably is, when it isn't linked: { hc, rc, k }, where rc is the
// Radar client that Harvest client is linked to now (a copy Radar added, or one linked by mistake),
// or null. A Harvest client linked to a client with a name like its own is that client's, not this one's.
function hvHarvestNameFor(clientId){
  if(!hvTimeOn() || !clientId || hvClientProjects(clientId).linked) return null;
  const c = clients.find(x => String(x.id) === String(clientId)); if(!c) return null;
  let best = null;
  (hvTime.clients || []).forEach(hc => {
    if(hc.is_active === false) return;
    const k = hvNamesAlike(hc.name, c.name); if(!k) return;
    const rc = hc.radar_client_id ? clients.find(x => String(x.id) === String(hc.radar_client_id)) || null : null;
    const live = rc && !rc.deletedAt ? rc : null;
    if(live && !clientInSetup(live) && hvNamesAlike(hc.name, live.name)) return;
    if(!best || k > best.k) best = { hc, rc: live, k };
  });
  return best;
}
function hvLinkConfirmWords(fix, c){
  const h = `Harvest’s “${fix.hc.name}”`;
  if(fix.rc && clientInSetup(fix.rc)) return `${c.name} gets ${h}: its projects, and the time already logged there. The copy Radar added for it goes.`;
  if(fix.rc) return `${h} moves from ${fix.rc.name} to ${c.name}, with the time logged on its projects. ${fix.rc.name} stays in Radar, not linked to Harvest.`;
  return `${c.name} gets ${h}: its projects, and the time already logged there.`;
}
async function hvLinkHarvest(harvestId, targetId){
  const { data: { session } } = await supabaseClient.auth.getSession();
  const r = await fetch('/api/integrations', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'harvest', action: 'link-harvest', harvestId, targetId }) });
  let body = {}; try{ body = await r.json(); }catch(e){}
  if(!r.ok || body.error) throw new Error(body.error || 'Couldn’t link it.');
  return body;
}
// Asks, links, and reloads what depends on it. Returns true when linked.
async function hvLinkClientToHarvest(clientId){
  const c = clients.find(x => String(x.id) === String(clientId)), fix = hvHarvestNameFor(clientId);
  if(!c || !fix || !canApprove()) return false;
  if(!(await confirmDialog(hvLinkConfirmWords(fix, c), { title: `Link ${c.name} to Harvest?`, confirmLabel: 'Link' }))) return false;
  try{ await hvLinkHarvest(fix.hc.harvest_id, c.id); }catch(e){ showToast('error', 'Couldn’t link it', e.message); return false; }
  if(typeof loadAll === 'function' && typeof mLoadAll !== 'function') await loadAll();
  else if(typeof mLoadAll === 'function') await mLoadAll();
  await hvTimeLoad();
  if(typeof loadTimeEntries === 'function') await loadTimeEntries();
  showToast('success', `${c.name} is linked to Harvest`, 'Time logged for it goes to Harvest now. Time logged before this: open it and pick its project and task.');
  return true;
}
// Someone who can't link asks those who can: a note to every admin and approver, opening the client.
// Once per client per day from this device.
function hvAskedKey(clientId){ return `radar-hv-asked:${clientId}:${toDateStr(new Date())}`; }
function hvAsked(clientId){ try{ return !!localStorage.getItem(hvAskedKey(clientId)); }catch(e){ return false; } }
async function hvAskApprovers(clientId, btn){
  const c = clients.find(x => String(x.id) === String(clientId)), fix = hvHarvestNameFor(clientId);
  if(!c || hvAsked(clientId)) return false;
  const who = (typeof teamProfiles !== 'undefined' ? teamProfiles : []).filter(p => !p.access_revoked && (p.role === 'admin' || p.role === 'approver') && p.id !== (myProfile && myProfile.id));
  if(!who.length){ showToast('info', 'No approver to ask', 'Radar has no admin or approver yet.'); return false; }
  const title = `${myName() || 'Someone'} asks to link ${c.name} to Harvest`;
  const body = fix && fix.rc && !clientInSetup(fix.rc) ? `Harvest’s “${fix.hc.name}” is linked to ${fix.rc.name}. Open ${c.name}, then Details → Harvest → Change.`
    : fix ? `Harvest calls it “${fix.hc.name}”. Open ${c.name}, then Details → Harvest → Link.` : `Time for it stays in Radar. Open ${c.name}, then Details → Harvest → Link.`;
  if(btn) setBtnLoading(btn, 'Asking…');
  try{
    if(typeof sendNotification === 'function') for(const p of who) await sendNotification(p.id, 'harvest_client', title, body, 'clients', c.id);
    else { const { error } = await supabaseClient.from('notifications').insert(who.map(p => ({ user_id: p.id, type: 'harvest_client', title, body, target_view: 'clients', target_id: c.id, read: false }))); if(error) throw error; }
  }catch(e){ if(btn) restoreBtn(btn); showToast('error', 'Couldn’t ask', e.message || 'Try again in a moment.'); return false; }
  try{ localStorage.setItem(hvAskedKey(clientId), '1'); }catch(e){}
  showToast('success', `Asked ${who.map(p => p.name.split(' ')[0]).join(' and ')}`, 'They’ll link it; your time goes to Harvest after that.');
  if(btn){ btn.disabled = true; btn.textContent = 'Asked'; }
  return true;
}

// The desktop sheets' Link (the rows redraw with the client's projects)
async function hvLinkFromPick(prefix, clientId){
  if(!(await hvLinkClientToHarvest(clientId))) return;
  const wrap = document.getElementById(prefix + 'Pick');
  if(wrap){ const d = hvDefaultPick(clientId); wrap.innerHTML = hvPickRowsHtml(prefix, clientId, d.projectId, d.taskId); }
}

// ---- A client's Harvest link, from its Details (approvers): Link… or Change… ---------------------
// Every active Harvest client to pick from, the likely ones first; one linked to another client says
// which, and picking it moves the link here (with the time on its projects).
function hvLinkedHarvestOf(clientId){ return hvTimeOn() ? (hvTime.clients || []).find(x => String(x.radar_client_id || '') === String(clientId)) || null : null; }
function hvLinkSheet(clientId){
  const c = clients.find(x => String(x.id) === String(clientId)); if(!c || !canApprove() || !hvTimeOn()) return;
  const cur = hvLinkedHarvestOf(clientId);
  const nameOf = id => { const x = clients.find(y => String(y.id) === String(id)); return x && !x.deletedAt ? x : null; };
  const list = (hvTime.clients || []).filter(hc => hc.is_active !== false || (cur && hc.harvest_id === cur.harvest_id))
    .map(hc => ({ hc, k: hvNamesAlike(hc.name, c.name), rc: hc.radar_client_id ? nameOf(hc.radar_client_id) : null }))
    .sort((a, b) => (b.k - a.k) || a.hc.name.localeCompare(b.hc.name));
  // linked to another client: "· linked" when that client has its name, "· linked to …" when it doesn't
  const opt = x => { const elsewhere = x.rc && String(x.rc.id) !== String(c.id) && !clientInSetup(x.rc) ? (hvNamesAlike(x.hc.name, x.rc.name) ? ' · linked' : ` · linked to ${x.rc.name}`) : '';
    return [String(x.hc.harvest_id), x.hc.name + elsewhere]; };
  openAppModal(`<h3 class="ap-h">${typeof appLogo === 'function' ? appLogo('harvest', 'sm') : ''}${escapeHtml(c.name)} in Harvest</h3>
<p class="t-2 hvl-sub">${cur ? `Linked to Harvest’s “${escapeHtml(cur.name)}”. Pick another if that’s the wrong one: time for ${escapeHtml(c.name)} goes to its projects.` : `Not linked, so time for ${escapeHtml(c.name)} stays in Radar. Pick it in Harvest.`}</p>
<div class="f"><label for="hvlSel">Harvest client</label><div>${sheetPop('hvlSel', 'Harvest client', list.map(opt), cur ? String(cur.harvest_id) : '', "document.getElementById('hvlGo').disabled=!this.value||this.value===this.dataset.cur", { placeholder: 'Choose a Harvest client' })}</div></div>
<div class="sheet-a"><button class="btn" onclick="closeAppModal()">Cancel</button><button class="btn btn-p" id="hvlGo" disabled onclick="hvLinkSheetSave(${jsArg(clientId)})">${cur ? 'Change' : 'Link'}</button></div>`, 460);
  const sel = document.getElementById('hvlSel'); if(sel) sel.dataset.cur = cur ? String(cur.harvest_id) : '';
}
async function hvLinkSheetSave(clientId){
  const c = clients.find(x => String(x.id) === String(clientId)), id = Number(document.getElementById('hvlSel')?.value);
  const hc = (hvTime.clients || []).find(x => Number(x.harvest_id) === id); if(!c || !hc) return;
  const rc = hc.radar_client_id ? clients.find(x => String(x.id) === String(hc.radar_client_id) && !x.deletedAt) || null : null;
  const cur = hvLinkedHarvestOf(clientId);
  const words = (rc && String(rc.id) !== String(c.id) ? hvLinkConfirmWords({ hc, rc }, c) : `${c.name} gets Harvest’s “${hc.name}”: its projects, and the time already logged there.`)
    + (cur ? ` ${c.name} stops being Harvest’s “${cur.name}”; link that one to its client from there.` : '');
  if(!(await confirmDialog(words, { title: `Link ${c.name} to “${hc.name}”?`, confirmLabel: cur ? 'Change' : 'Link' }))) return;
  const btn = document.getElementById('hvlGo'); setBtnLoading(btn, 'Linking…');
  try{ await hvLinkHarvest(hc.harvest_id, c.id); }catch(e){ restoreBtn(btn); showToast('error', 'Couldn’t link it', e.message); return; }
  closeAppModal();
  if(typeof loadAll === 'function') await loadAll();
  await hvTimeLoad();
  if(typeof hvLoadLinks === 'function') await hvLoadLinks();
  if(typeof loadTimeEntries === 'function') await loadTimeEntries();
  showToast('success', `${c.name} is linked to “${hc.name}”`, 'Time logged for it goes there now. Time logged before: open it and pick its project and task.');
  if(typeof renderAll === 'function') renderAll();
}
// The Details line: which Harvest client, and Link… / Change… for approvers ('' when Harvest is off).
function hvDetailsHtml(c){
  if(!hvTimeOn() || !c) return '';
  const cur = hvLinkedHarvestOf(c.id), fix = !cur && hvHarvestNameFor(c.id);
  const words = cur ? `“${escapeHtml(cur.name)}”` : fix ? `Not linked <span class="t-3">· Harvest has “${escapeHtml(fix.hc.name)}”</span>` : '<span class="t-3">Not linked</span>';
  const act = canApprove() ? ` <a class="x-lnk hvl-act" href="#" onclick="hvLinkSheet(${jsArg(c.id)});return false;">${cur ? 'Change…' : 'Link…'}</a>`
    : !cur && fix && !hvAsked(c.id) ? ` <a class="x-lnk hvl-act" href="#" onclick="hvAskApprovers(${jsArg(c.id)}, this);return false;">Ask an Approver</a>` : '';
  return `<div class="cl-kv"><span>Harvest</span><span class="hvl-v">${typeof appLogo === 'function' ? appLogo('harvest', 'xs') : ''}<span>${words}${act}</span></span></div>`;
}

// Why a client has nothing to pick, in words (null when it has projects for you).
function hvNoPickWords(clientId){
  const { all, mine, linked } = hvClientProjects(clientId);
  if(mine.length) return null;
  if(!linked){
    const fix = hvHarvestNameFor(clientId), ask = canApprove() ? '' : hvAsked(clientId) ? ' You asked an approver to link them.' : ' An approver can link them.';
    if(fix && fix.rc && !clientInSetup(fix.rc)) return `Harvest’s “${fix.hc.name}” is linked to ${fix.rc.name}, so this time stays in Radar.${ask}`;
    if(fix) return `Harvest calls this client “${fix.hc.name}”, so this time stays in Radar until they’re linked.${ask}`;
  }
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
  if(none){
    const fix = hvHarvestNameFor(clientId);
    const btn = !fix ? '' : canApprove() ? `<button type="button" class="btn sm hvp-link" onclick="hvLinkFromPick('${prefix}', ${jsArg(clientId)})">${fix.rc && !clientInSetup(fix.rc) ? 'Link Here Instead…' : 'Link Them…'}</button>`
      : hvAsked(clientId) ? '' : `<button type="button" class="btn sm hvp-link" onclick="hvAskApprovers(${jsArg(clientId)}, this)">Ask an Approver</button>`;
    return `<label>Project</label><div class="hvp-none t-2">${escapeHtml(none)}${btn}</div>`;
  }
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
