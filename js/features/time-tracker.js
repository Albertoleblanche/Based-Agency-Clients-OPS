// Time Tracker: live timer, manual entries, timesheet day/week views,
// Harvest sync of entries.

/* ---------- Time Tracker ---------- */
let timeEntries = [];
let timeEntriesDataLoaded = false;

// Defense in depth: RLS already restricts which rows the database returns
// for non-admins, but this makes the UI itself incapable of listing another
// user's time entries too — no render path relies solely on trusting the
// fetch layer to have already scoped things correctly.
function visibleTimeEntries(){
  if(isAdmin()) return timeEntries;
  if(!currentUser) return [];
  return timeEntries.filter(e=>e.userId===currentUser.id);
}

// Always just your own — used for the Timesheet, which is a personal
// day-to-day tracking view, not a team-oversight one. Reports is where
// admins see everyone's time (via visibleTimeEntries above); Timesheet is
// where everyone, admin or not, tracks and reviews their own hours.
function myOwnTimeEntries(){
  if(!currentUser) return [];
  return timeEntries.filter(e=>e.userId===currentUser.id);
}
let timerState = { running:false, startedAt:null, clientId:'', service:'', description:'', resumeEntryId:null };
let timerIntervalId = null;
let timesheetMode = 'day';
let timesheetAnchor = new Date();

async function loadTimeEntries(){
  const { data, error } = await selectAll(() => supabaseClient.from('time_entries').select('*').is('deleted_at', null).order('entry_date', { ascending:false }).order('id'));
  if(error){ console.error('loadTimeEntries error', error); timeEntries = []; timeEntriesDataLoaded = true; return; }
  timeEntries = (data||[]).map(e=>({ id:e.id, userId:e.user_id, clientId:e.client_id, date:e.entry_date, minutes:e.minutes, description:e.description||'', service:e.service||'', createdAt:e.created_at, logged:!!e.logged, harvestStatus:e.harvest_sync_status||'', harvestId:e.harvest_entry_id||null, harvestError:e.harvest_sync_error||'', harvestProjectId:e.harvest_project_id||null, harvestTaskId:e.harvest_task_id||null, source:e.source||'', harvestUserId:e.harvest_user_id||null, harvestLocked:!!e.harvest_locked, improvementId:e.improvement_id||null }));
  timeEntriesDataLoaded = true;
  if(typeof renderDashboard === 'function') renderDashboard();
  hvResendStuck();
}

// Turns one time entry's description into a real improvement log — a
// deliberate, per-entry choice, not automatic. Marks the entry as logged so
// this can't be double-applied and the UI can show it's already done.
async function logTimeEntryAsImprovement(entryId){
  const entry = timeEntries.find(e=>e.id===entryId);
  if(!entry) return;
  if(!entry.description || !entry.description.trim()){ showToast('error','Nothing to log','This entry has no description to turn into a log.'); return; }
  if(entry.logged){ showToast('info','Already logged','This entry is already in Past Improvements.'); return; }

  await loadAll();
  const c = clients.find(x=>x.id===entry.clientId);
  if(!c){ showToast('error','Client not found','This client may have been removed.'); return; }
  if(!(await okToLogDuplicate(entry.clientId, entry.description.trim()))) return;   // logged already? (data.js)
  const imp = await insertImprovementRow(entry.clientId, { author: myName()||'Team member', text: entry.description.trim(), includeInEmail: false, source: 'time' });
  if(!imp){ showToast('error','Save failed','Could not save — try again.'); return; }
  const invalidated = invalidateStaleDraft(c, myName()||'Team member');
  if(invalidated) await saveDraftFor(entry.clientId, myName()||'Team member', { draftStatus:'none', draft:'' });
  renderImprovementsHistory();
  renderClientsTable();
  renderQueue();
  renderKpis();

  // linked to the work it became, so deleting either one deletes both (addendum-deleted-work.sql)
  let { error } = await supabaseClient.from('time_entries').update({ logged: true, improvement_id: imp.id }).eq('id', entryId);
  if(error && workColumnMissing(error, 'improvement_id')) ({ error } = await supabaseClient.from('time_entries').update({ logged: true }).eq('id', entryId));
  await loadTimeEntries();
  renderTimesheet(); renderReports();
  error
    ? showToast('info','Logged, with a hiccup','Added to Past Improvements, but the entry\'s "logged" marker failed to save — you may see the button again.')
    : showToast('success','Logged', 'Added to Past Improvements — decide later if it goes in the client email.');
}

async function loadMyTrashedTimeEntries(){
  if(!currentUser) return [];
  const { data, error } = await supabaseClient.from('time_entries').select('*').eq('user_id', currentUser.id).not('deleted_at', 'is', null).order('deleted_at', { ascending:false });
  if(error){ console.error('loadMyTrashedTimeEntries error', error); return []; }
  return (data||[]).map(e=>({ id:e.id, userId:e.user_id, clientId:e.client_id, date:e.entry_date, minutes:e.minutes, description:e.description||'', service:e.service||'', deletedAt:e.deleted_at, improvementId:e.improvement_id||null }));
}

// Back on the timesheet, and made again in Harvest (deleting it took it out of there). Time logged
// with a piece of work comes back with that work.
async function restoreTimeEntry(id){
  const e = (typeof trashData !== 'undefined' ? trashData.time : []).find(x => x.id === id);
  // time logged for several improvements: they all come back with it
  const batch = e ? deletedWork.filter(w => w.timeEntryId === e.id) : [];
  if(batch.length > 1){
    const r = await restoreWork(batch.map(w => w.id));
    renderAll(); await renderTrash();
    return r.ok ? showToast('success', 'Restored', `The time and its ${batch.length} improvements are back${typeof hvTimeOn === 'function' && hvTimeOn() ? ', and in Harvest again' : ''}.`) : showToast('error', 'Couldn’t restore it', 'Try again in a moment.');
  }
  if(e && e.improvementId && deletedWork.some(w => w.id === e.improvementId)) return trRestoreWork(e.improvementId);
  const ok = await restoreTimeRows([id]);
  await loadTimeEntries();
  renderTimesheet(); renderReports();
  await renderTrash();
  ok ? showToast('success','Entry restored', `Back on the timesheet${typeof hvTimeOn === 'function' && hvTimeOn() ? ' and in Harvest' : ''}.`) : showToast('error','Restore failed','Try again in a moment.');
}
async function restoreTimeRows(ids){
  if(!ids.length) return true;
  const { data, error } = await supabaseClient.from('time_entries').update({ deleted_at: null, harvest_entry_id: null, harvest_sync_status: 'pending', harvest_sync_error: null }).in('id', ids).select('id');
  if(error){ console.error('restoreTimeRows', error); return false; }
  (data || []).forEach(r => syncEntryToHarvestBackground(r.id));
  return true;
}

async function permanentlyDeleteTimeEntry(id){
  if(!(await confirmDialog('Permanently delete this time entry? This cannot be undone.', {confirmLabel:'Delete permanently', destructive:true}))) return;
  const { error } = await supabaseClient.from('time_entries').delete().eq('id', id);
  await renderTrash();
  error ? showToast('error','Delete failed', error.message) : showToast('success','Permanently deleted','Gone for good.');
}

function populateTimeClientSelects(){
  setupClientSearchSelect('timerClientSearch', 'timerClient', 'timerClientDropdown');
  setupClientSearchSelect('manualClientSearch', 'manualClient', 'manualClientDropdown');
  setupClientSearchSelect('timerModalClientSearch', 'timerModalClient', 'timerModalClientDropdown');

  const dateInput = document.getElementById('manualDate');
  if(dateInput && !dateInput.value) setDatePickerValue('manualDate', toDateStr(new Date()));

  // Service dropdowns — same option list as the Clients table's Service field.
  const serviceOpts = (settings.serviceOptions||[]).map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  ['timerService','manualService','timerModalService'].forEach(id=>{
    const sel = document.getElementById(id);
    if(!sel) return;
    const current = sel.value;
    sel.innerHTML = serviceOpts || `<option value="">No services set up</option>`;
    if([...sel.options].some(o=>o.value===current)) sel.value = current;
  });

  wireServiceAutoSuggest('timerClient', 'timerService');
  wireServiceAutoSuggest('manualClient', 'manualService');
  wireServiceAutoSuggest('timerModalClient', 'timerModalService');
}

// Sets a client field (search text + hidden id) programmatically — used when
// restoring a persisted timer or resuming from a past entry, as opposed to
// the user picking one by typing.
function setClientFieldValue(hiddenId, searchId, clientId){
  const hiddenInput = document.getElementById(hiddenId);
  const searchInput = document.getElementById(searchId);
  if(hiddenInput) hiddenInput.value = clientId || '';
  if(searchInput){
    const c = clients.find(x=>x.id===clientId);
    searchInput.value = c ? c.name : '';
  }
}

// A typeahead combobox backed by a hidden input holding the real client id —
// everything else in the app (toggleTimer, resumeEntryTimer, etc.) just reads
// .value off the hidden input's id, unchanged, whether it's a <select> or this.
function setupClientSearchSelect(searchId, hiddenId, dropdownId){
  const searchInput = document.getElementById(searchId);
  const hiddenInput = document.getElementById(hiddenId);
  const dropdown = document.getElementById(dropdownId);
  if(!searchInput || !hiddenInput || !dropdown || searchInput.dataset.wired) return;
  searchInput.dataset.wired = '1';

  function showMatches(term){
    const lower = (term||'').toLowerCase();
    const ac = workClients();   // not the paused ones: no time is logged for them
    const matches = [...ac]
      .filter(c=>c.name.toLowerCase().includes(lower))
      .sort((a,b)=>a.name.localeCompare(b.name))
      .slice(0,50);
    if(!ac.length){ dropdown.innerHTML = `<div class="client-search-empty">No clients yet — add one in Clients first.</div>`; dropdown.style.display='block'; return; }
    if(!matches.length){ dropdown.innerHTML = `<div class="client-search-empty">No matching clients</div>`; dropdown.style.display='block'; return; }
    dropdown.innerHTML = matches.map(c=>`<div class="client-search-item" data-id="${c.id}">${escapeHtml(c.name)}</div>`).join('');
    dropdown.style.display = 'block';
  }

  searchInput.addEventListener('focus', ()=> showMatches(searchInput.value));
  searchInput.addEventListener('input', ()=>{ hiddenInput.value=''; showMatches(searchInput.value); });
  dropdown.addEventListener('mousedown', (e)=>{
    const item = e.target.closest('.client-search-item');
    if(!item) return;
    e.preventDefault();
    setClientFieldValue(hiddenId, searchId, item.dataset.id);
    dropdown.style.display = 'none';
    hiddenInput.dispatchEvent(new Event('change'));
  });
  document.addEventListener('click', (e)=>{
    if(e.target!==searchInput && !dropdown.contains(e.target)) dropdown.style.display = 'none';
  });
}

// When a client is picked, auto-select that client's own service — still
// freely changeable afterward, in case time was logged against a different
// service than the client's default.
function wireServiceAutoSuggest(clientSelId, serviceSelId){
  const clientSel = document.getElementById(clientSelId);
  const serviceSel = document.getElementById(serviceSelId);
  if(!clientSel || !serviceSel || clientSel.dataset.serviceLinked) return;
  clientSel.dataset.serviceLinked = '1';
  clientSel.addEventListener('change', ()=>{
    const c = clients.find(x=>x.id===clientSel.value);
    if(c && c.service && [...serviceSel.options].some(o=>o.value===c.service)){
      serviceSel.value = c.service;
    }
  });
}

function switchTimeTab(name){
  document.querySelectorAll('#timeMainTabs .icon-tab').forEach(t=>t.classList.toggle('active', t.dataset.ttab===name));
  document.querySelectorAll('#view-time > .settings-subview').forEach(v=>v.classList.remove('active'));
  document.getElementById('ttab-'+name).classList.add('active');
  if(name==='timesheet') renderTimesheet();
  if(name==='reports') renderReports();
  if(name==='dailysummary') loadDailySummary();
  if(name==='payroll') renderPayroll();
}

/* --- Live timer --- */
function updateTimerDisplay(){
  const el = document.getElementById('timerDisplay');
  const dot = document.getElementById('timerStatusDot');
  if(!timerState.running){
    if(el){ el.textContent = '00:00:00'; el.classList.remove('running'); }
    if(dot) dot.classList.remove('running');
    updateFloatingTimerPill('00:00:00');
    return;
  }
  const elapsedSec = Math.floor((Date.now() - timerState.startedAt)/1000);
  const h = String(Math.floor(elapsedSec/3600)).padStart(2,'0');
  const m = String(Math.floor((elapsedSec%3600)/60)).padStart(2,'0');
  const s = String(elapsedSec%60).padStart(2,'0');
  const timeStr = `${h}:${m}:${s}`;
  if(el){ el.textContent = timeStr; el.classList.add('running'); }
  if(dot) dot.classList.add('running');
  updateFloatingTimerPill(timeStr);
}

// Keeps a persistent pill visible on every tab while a timer is running, so
// leaving the Time Tracker page doesn't mean losing track of it.
function updateFloatingTimerPill(timeStr){
  if(typeof tickTimesheetClock === 'function') tickTimesheetClock();
  // The running timer lives in the toolbar, as on the canvas (red dot · time · client).
  // The running timer is a small counter in the sidebar's bottom corner, on every page (canvas:
  // "goes with me to every page"). The old toolbar pill and floating pill stay hidden.
  const tb = document.getElementById('tbTimer'); if(tb) tb.style.display = 'none';
  const pill = document.getElementById('floatingTimerPill'); if(pill) pill.style.display = 'none';
  renderSideTimer(timeStr);
}

// Sidebar counter: running (time, task, pause, stop), paused (resume), or idle (start a timer).
let _sideTimerKey = '';
function renderSideTimer(timeStr){
  const el = document.getElementById('sideTimer');
  if(!el) return;
  const paused = typeof timerPaused !== 'undefined' && timerPaused;
  const state = timerState.running ? 'run' : paused ? 'pause' : 'idle';
  const label = timerState.running ? (timerState.description || clients.find(x => x.id === timerState.clientId)?.name || 'Tracking time')
    : paused ? (paused.description || clients.find(x => x.id === paused.clientId)?.name || 'Paused') : '';
  // Nov 26: no idle Start timer here (Today's Plan took its place; start one from New, Time or ⌘K).
  // A running or paused timer always shows.
  if(state === 'idle'){ el.hidden = true; _sideTimerKey = ''; return; }
  const key = state + '|' + label;
  // Called without a time (after Pause, Resume…): work it out now rather than flash 0:00:00.
  const t = (timeStr || (timerState.running && typeof clockText === 'function' ? clockText() : '0:00:00')).replace(/^0(\d):/, '$1:');
  el.hidden = false;
  el.className = 'stm is-' + state;
  if(key === _sideTimerKey){ const b = el.querySelector('.stm-tx b'); if(b && state === 'run') b.textContent = t; return; }
  _sideTimerKey = key;
  if(state === 'run'){
    el.setAttribute('aria-label', 'Running timer');
    el.innerHTML = `<button class="stm-main" onclick="switchViewIfNotOnTimer()" title="Open Time"><i class="stm-dot"></i><span class="stm-tx"><b>${t}</b><span>${escapeHtml(label)}</span></span></button>
<button class="stm-b" aria-label="Pause" title="Pause" onclick="pauseTimer()">${icon('pause')}</button><button class="stm-b stm-stop" aria-label="Stop" title="Stop" onclick="stopTimerNow()">${icon('stop')}</button>`;
  } else if(state === 'pause'){
    el.setAttribute('aria-label', 'Paused timer');
    el.innerHTML = `<button class="stm-main" onclick="switchViewIfNotOnTimer()" title="Open Time"><i class="stm-dot paused"></i><span class="stm-tx"><b>Paused</b><span>${escapeHtml(label)}</span></span></button>
<button class="stm-b" aria-label="Resume" title="Resume" onclick="resumePausedTimer()">${icon('play')}</button><button class="stm-b" aria-label="Done" title="Done" onclick="finishPausedTimer()">${icon('check')}</button>`;
  } else {
    el.setAttribute('aria-label', 'Timer');
    el.innerHTML = `<button class="stm-main" onclick="openTimerModal()" title="Start a timer"><span class="stm-ic">${icon('play')}</span><span class="stm-tx"><b class="stm-idle">Start timer</b></span></button>`;
  }
}

function switchViewIfNotOnTimer(){
  switchView('time');
  switchTimeTab('timesheet');
}

function saveTimerState(){ try{ localStorage.setItem('bda_timer_state', JSON.stringify(timerState)); }catch(e){} }

function initTimerFromStorage(){
  try{
    const raw = localStorage.getItem('bda_timer_state');
    if(raw) timerState = JSON.parse(raw);
  }catch(e){}
  if(timerState.running && timerState.startedAt && (Date.now() - timerState.startedAt > 12*3600*1000)){
    timerState = { running:false, startedAt:null, clientId:'', service:'', description:'', resumeEntryId:null };
    saveTimerState();
  }
  if(timerState.running){
    timerIntervalId = setInterval(updateTimerDisplay, 1000);
    updateTimerDisplay();
    const btn = document.getElementById('timerToggleBtn');
    if(btn){ btn.textContent = 'Stop & save'; btn.classList.add('stop'); }
    setClientFieldValue('timerClient', 'timerClientSearch', timerState.clientId);
    const serviceSel = document.getElementById('timerService');
    if(serviceSel) serviceSel.value = timerState.service || '';
    const descInput = document.getElementById('timerDesc');
    if(descInput) descInput.value = timerState.description;
  }
  updateFloatingTimerPill();
}

function toggleTimer(){
  if(!timerState.running){
    const clientId = document.getElementById('timerClient').value;
    if(!clientId){ showToast('error','Pick a client',"Select which client you're working on."); return; }
    const service = document.getElementById('timerService')?.value || '';
    timerState = { running:true, startedAt:Date.now(), clientId, service, description: document.getElementById('timerDesc').value.trim(), resumeEntryId:null };
    saveTimerState();
    timerIntervalId = setInterval(updateTimerDisplay, 1000);
    updateTimerDisplay();
    const btn = document.getElementById('timerToggleBtn');
    btn.textContent = 'Stop & save';
    btn.classList.add('stop');
  } else {
    stopAndSaveTimer();
  }
}

// Shared by both the timer and manual entry — if this user already has a
// time entry today for the same client and service, the new time gets
// added to it instead of creating a duplicate row. Re-fetches fresh from
// the database rather than trusting the local cache, since two entries
// could plausibly be created in quick succession (e.g. a timer running
// while also logging a manual entry) and a stale read would silently
// lose one of them.
async function mergeOrInsertTimeEntry({ clientId, service, dateStr, minutes, description, projectId, taskId, improvementId }){
  // a paused client isn't working with us right now: no time is logged for it (client-status.js)
  if(typeof isClientPaused === 'function' && isClientPaused(clientId)) return { error: { message: `${(clients.find(x => x.id === clientId) || {}).name || 'This client'} is paused, so time isn’t logged for it.` }, merged: false, entryId: null, paused: true };
  // Time logged with a piece of work is its own entry, linked to it (time_entries.improvement_id), so
  // deleting either one deletes both; it's never merged into other time. Before
  // addendum-deleted-work.sql there's nothing to link it with, and it merges as before.
  if(improvementId){
    const { data, error } = await supabaseClient.from('time_entries').insert({
      user_id: currentUser.id, client_id: clientId, entry_date: dateStr, minutes, description, service, logged: true, improvement_id: improvementId,
      ...(projectId ? { harvest_project_id: projectId, harvest_task_id: taskId || null } : {})
    }).select('id').single();
    if(!error || !workColumnMissing(error, 'improvement_id')) return { error, merged: false, entryId: data?.id || null, linked: !error };
  }
  // logged by project and task (step 3 of the Harvest plan): one entry per client, project, task and day
  let q = supabaseClient.from('time_entries').select('id, minutes, description')
    .eq('user_id', currentUser.id).eq('client_id', clientId).eq('entry_date', dateStr).is('deleted_at', null);
  q = projectId ? q.eq('harvest_project_id', projectId) : q.eq('service', service||'');
  if(projectId) q = taskId ? q.eq('harvest_task_id', taskId) : q.is('harvest_task_id', null);
  const { data: rows } = await q.limit(1);
  const existing = rows && rows[0];

  if(existing){
    const newTotal = existing.minutes + minutes;
    // Append rather than overwrite, so merging two entries never silently
    // loses either description.
    const newDesc = [existing.description, description].filter(Boolean).join(' · ');
    const { error } = await supabaseClient.from('time_entries')
      .update({ minutes: newTotal, description: newDesc, harvest_sync_status: 'pending' }).eq('id', existing.id);
    return { error, merged: !error, entryId: existing.id };
  }

  const { data, error } = await supabaseClient.from('time_entries').insert({
    user_id: currentUser.id, client_id: clientId, entry_date: dateStr, minutes, description, service,
    ...(projectId ? { harvest_project_id: projectId, harvest_task_id: taskId || null } : {})
  }).select('id').single();
  return { error, merged: false, entryId: data?.id || null };
}

// Fire-and-forget — deliberately not awaited by any caller below, so a
// slow or unreachable Harvest API never delays the actual time-logging
// action a person is waiting on. Errors are stored on the row itself
// (harvest_sync_status/harvest_sync_error) rather than surfaced as a
// toast here, since a background sync failing isn't something that
// needs to interrupt someone mid-task — it's visible on the Timesheet
// row and gets retried by the daily catch-up regardless.
// Nov 23: it now listens for the answer. Radar didn't answer (offline, a hiccup): one more try a few
// seconds later; still nothing, and the row says "Send to Harvest" (it used to sit at "pending" unseen
// until the nightly retry). Harvest's own answer is saved on the row by the server either way.
function syncEntryToHarvestBackground(entryId, tries){
  if(!entryId) return Promise.resolve(null);
  tries = tries || 0;
  return supabaseClient.auth.getSession().then(({ data: { session } }) => {
    if(!session) throw new Error('Not signed in.');
    return fetch('/api/integrations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'harvest', action: 'sync-entry', timeEntryId: entryId }),
    });
  }).then(async r => {
    let body = {}; try{ body = await r.json(); }catch(e){}
    if(!r.ok && r.status >= 500) throw new Error(body.error || `Radar answered ${r.status}`);
    hvEntrySent(entryId, r.ok ? body : { status: 'failed', error: body.error || 'Couldn’t send it.' });
    return body;
  }).catch(e => {
    if(tries < 1) return new Promise(res => setTimeout(res, 4000)).then(() => syncEntryToHarvestBackground(entryId, tries + 1));
    hvEntrySent(entryId, { status: 'failed', error: e.message || 'Couldn’t reach Radar.' });
    return null;
  });
}
// What the send came to, on the row now (the next load reads it from the database anyway).
function hvEntrySent(entryId, r){
  const e = (typeof timeEntries !== 'undefined' ? timeEntries : []).find(x => x.id === entryId); if(!e || !r) return;
  if(r.status) e.harvestStatus = r.status;
  if(r.harvestEntryId) e.harvestId = r.harvestEntryId;
  e.harvestError = r.error || '';
  if(r.status !== 'synced' && typeof renderTimesheet === 'function' && currentViewName === 'time') renderTimesheet();
}
// Your time that was never sent (a send that didn't finish): sent again once, a little after Radar
// opens. Only entries with a project and task; only your own; the last month.
let hvResent = false;
function hvResendStuck(){
  if(hvResent || typeof currentUser === 'undefined' || !currentUser) return;
  hvResent = true;
  const from = toDateStr(new Date(Date.now() - 31 * 864e5)), old = Date.now() - 3 * 60000;
  const stuck = timeEntries.filter(e => e.userId === currentUser.id && e.harvestStatus === 'pending' && !e.harvestId && e.harvestProjectId && e.harvestTaskId
    && e.date >= from && new Date(e.createdAt || 0).getTime() < old).slice(0, 8);
  if(!stuck.length) return;
  setTimeout(async () => { for(const e of stuck) await syncEntryToHarvestBackground(e.id); }, 3000);
}

async function stopAndSaveTimer(opts){
  opts = opts || {};
  if(timerIntervalId){ clearInterval(timerIntervalId); timerIntervalId = null; }
  const elapsedMs = Date.now() - timerState.startedAt;
  const minutes = Math.max(1, Math.round(elapsedMs/60000));
  const clientId = timerState.clientId;
  const service = timerState.service || '';
  const description = timerState.description;
  const resumeEntryId = timerState.resumeEntryId;
  const projectId = timerState.projectId || null, taskId = timerState.taskId || null;
  timerState = { running:false, startedAt:null, clientId:'', service:'', description:'', resumeEntryId:null };
  saveTimerState();
  const btn = document.getElementById('timerToggleBtn');
  if(btn){ btn.textContent = 'Start timer'; btn.classList.remove('stop'); }
  updateTimerDisplay();
  const descInput = document.getElementById('timerDesc');
  if(descInput) descInput.value = '';

  const c = clients.find(x=>x.id===clientId);
  let error, mergedIntoExisting = false, savedId = resumeEntryId || null;

  if(resumeEntryId){
    // Re-fetch the current minutes fresh (not from local cache) so we don't
    // clobber a value someone else may have changed in the meantime.
    const { data: existing, error: fetchErr } = await supabaseClient
      .from('time_entries').select('minutes').eq('id', resumeEntryId).maybeSingle();
    if(existing){
      const newTotal = existing.minutes + minutes;
      ({ error } = await supabaseClient.from('time_entries').update({ minutes: newTotal, harvest_sync_status: 'pending' }).eq('id', resumeEntryId));
      mergedIntoExisting = !error;
      if(!error) syncEntryToHarvestBackground(resumeEntryId);
    } else {
      // Original entry is gone (deleted elsewhere) — fall back to a new entry
      // rather than silently losing the tracked time.
      const { data: newRow, error: insertErr } = await supabaseClient.from('time_entries').insert({
        user_id: currentUser.id, client_id: clientId, entry_date: toDateStr(new Date()), minutes, description, service,
        ...(projectId ? { harvest_project_id: projectId, harvest_task_id: taskId } : {})
      }).select('id').single();
      error = insertErr;
      if(newRow){ savedId = newRow.id; syncEntryToHarvestBackground(newRow.id); }
    }
  } else {
    // stopped to log a piece of work (Log Improvement's timer): the time is that work's own entry
    const mergeResult = await mergeOrInsertTimeEntry({
      clientId, service, dateStr: toDateStr(new Date()), minutes, description, projectId, taskId, improvementId: opts.improvementId || null
    });
    error = mergeResult.error; mergedIntoExisting = mergeResult.merged; savedId = mergeResult.entryId || null;
    if(!error) syncEntryToHarvestBackground(mergeResult.entryId);
  }

  await loadTimeEntries();
  renderTimesheet(); renderReports();
  if(error){ showToast('error','Save failed', error.message); return null; }
  if(opts.quiet) return savedId;
  if(opts.pause) showToast('success','Timer paused', `${formatMinutes(minutes)} saved for ${c?c.name:'client'}.`);
  else mergedIntoExisting
    ? showToast('success','Time added', `${formatMinutes(minutes)} added to the existing entry for ${c?c.name:'client'}.`)
    : showToast('success','Time logged', `${formatMinutes(minutes)} logged for ${c?c.name:'client'}.`);
  return savedId;
}

/* --- Manual entry --- */
// Accepts "1h 30m", "1h", "90m", "1.5", "1,5" — whatever someone naturally
// types — rather than forcing two separate Hours/Minutes fields that need
// their own click-and-tab for a single number.
function parseDurationInput(str){
  str = (str||'').trim().toLowerCase().replace(',', '.');
  if(!str) return null;
  const colon = str.match(/^(\d{1,3}):(\d{2})$/);
  if(colon) return parseInt(colon[1], 10)*60 + parseInt(colon[2], 10);
  const hm = str.match(/^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+(?:\.\d+)?)\s*m)?$/);
  if(hm && (hm[1]!==undefined || hm[2]!==undefined)){
    const h = parseFloat(hm[1]||0), m = parseFloat(hm[2]||0);
    return Math.round(h*60 + m);
  }
  const plain = parseFloat(str);
  return isNaN(plain) ? null : Math.round(plain*60);
}

function minutesToDurationInputStr(minutes){
  const h = Math.floor(minutes/60), m = minutes%60;
  if(h && m) return `${h}h ${m}m`;
  if(h) return `${h}h`;
  return `${m}m`;
}

function openTimerModal(presetClientId){
  if(timerState.running){
    showToast('error','Timer already running', 'Stop the current timer before starting a new one.');
    return;
  }
  openAppModal(`
    <div class="modal-head"><span class="panel-title">Start a timer</span><span class="toast-close" onclick="closeAppModal()">✕</span></div>
    <div class="modal-body">
      <div class="form-grid">
        <div class="client-search-wrap" style="grid-column:1/-1;"><label>Client</label>
          <input type="text" class="client-search-input" id="timerModalClientSearch" placeholder="Search client…" autocomplete="off">
          <input type="hidden" id="timerModalClient">
          <div class="client-search-dropdown" id="timerModalClientDropdown"></div>
        </div>
        <div><label>Service</label><select id="timerModalService"></select></div>
        <div style="grid-column:1/-1;"><label>What are you working on?</label><input id="timerModalDesc" placeholder="e.g. Updating Meta ad creative"></div>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeAppModal()">Cancel</button>
      <button class="btn btn-brand" onclick="startTimerFromModal()">Start timer</button>
    </div>`, 460);
  populateTimeClientSelects();
  if(presetClientId){
    setClientFieldValue('timerModalClient', 'timerModalClientSearch', presetClientId);
    document.getElementById('timerModalClient').dispatchEvent(new Event('change'));
  }
}

function startTimerFromModal(){
  const clientId = document.getElementById('timerModalClient').value;
  if(!clientId){ showToast('error','Pick a client',"Select which client you're working on."); return; }
  const pick = typeof hvPickValue === 'function' ? hvPickValue('timerModal', clientId) : { ok: true, service: document.getElementById('timerModalService')?.value || '' };
  if(!pick.ok){ showToast('error', 'Almost there', pick.msg); return; }
  const service = pick.service || '';
  const description = document.getElementById('timerModalDesc').value.trim();
  timerState = { running:true, startedAt:Date.now(), clientId, service, description, resumeEntryId:null, projectId: pick.projectId || null, taskId: pick.taskId || null };
  saveTimerState();
  if(timerIntervalId) clearInterval(timerIntervalId);
  timerIntervalId = setInterval(updateTimerDisplay, 1000);
  updateTimerDisplay();

  // Same sync initTimerFromStorage() does on page load — keeps the Timer
  // tab's own fields consistent with reality, regardless of whether the
  // timer was actually started from there or from this popup.
  const btn = document.getElementById('timerToggleBtn');
  if(btn){ btn.textContent = 'Stop & save'; btn.classList.add('stop'); }
  setClientFieldValue('timerClient', 'timerClientSearch', clientId);
  const serviceSel = document.getElementById('timerService');
  if(serviceSel) serviceSel.value = service;
  const descInput = document.getElementById('timerDesc');
  if(descInput) descInput.value = description;

  closeAppModal();
  const c = clients.find(x=>x.id===clientId);
  showToast('success','Timer started', `Tracking time for ${c ? c.name : 'this client'}.`);
}

function openManualEntryModal(){
  openAppModal(`
    <div class="modal-head"><span class="panel-title">Add time manually</span><span class="toast-close" onclick="closeAppModal()">✕</span></div>
    <div class="modal-body">
      <div class="form-grid">
        <div class="client-search-wrap" style="grid-column:1/-1;"><label>Client</label>
          <input type="text" class="client-search-input" id="manualClientSearch" placeholder="Search client…" autocomplete="off">
          <input type="hidden" id="manualClient">
          <div class="client-search-dropdown" id="manualClientDropdown"></div>
        </div>
        <div><label>Service</label><select id="manualService"></select></div>
        <div style="position:relative;"><label>Date</label>${datePickerFieldHtml('manualDate', {})}</div>
        <div style="grid-column:1/-1;"><label>Duration</label><input id="manualDuration" placeholder="e.g. 1h 30m, or 1.5"></div>
        <div style="grid-column:1/-1;"><label>Description</label><textarea spellcheck="true" id="manualDesc" placeholder="What did you work on?" rows="3" style="resize:vertical;min-height:64px;font-family:inherit;"></textarea></div>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeAppModal()">Cancel</button>
      <button class="btn btn-brand" onclick="addManualEntry()">Add entry</button>
    </div>`, 460);
  populateTimeClientSelects();
  const dateInput = document.getElementById('manualDate');
  if(dateInput) setDatePickerValue('manualDate', toDateStr(new Date()));
}

// Opens the same manual-entry form, pre-filled from a task — its client
// (if it has one) and its title as a starting description, both still
// freely editable. Reuses setClientFieldValue() rather than setting the
// hidden input directly, and fires a real change event afterward so
// wireServiceAutoSuggest()'s listener (wired by populateTimeClientSelects()
// inside openManualEntryModal(), just called above) still auto-fills the
// Service field exactly as it would for a manually-picked client.
function openManualEntryFromTask(taskId){
  const t = tasks.find(x=>x.id===taskId);
  if(!t) return;
  openManualEntryModal();
  if(t.clientId){
    setClientFieldValue('manualClient', 'manualClientSearch', t.clientId);
    document.getElementById('manualClient')?.dispatchEvent(new Event('change'));
  }
  const descInput = document.getElementById('manualDesc');
  if(descInput) descInput.value = t.title || '';
}

async function addManualEntry(force){
  const clientId = document.getElementById('manualClient').value;
  const pick = typeof hvPickValue === 'function' && clientId ? hvPickValue('manual', clientId) : { ok: true, service: document.getElementById('manualService')?.value || '' };
  const service = pick.service || '';
  const dateVal = document.getElementById('manualDate').value;
  const totalMinutes = parseDurationInput(document.getElementById('manualDuration').value);
  const description = document.getElementById('manualDesc').value.trim();
  const asWork = typeof sheetIsOn === 'function' && sheetIsOn('manualWork');   // also log it as work, for Queue (Nov 23)
  if(!clientId){ showToast('error','Pick a client','Select which client this time is for.'); return; }
  if(isClientPaused(clientId)){ showPausedClientWarning(clientId); return; }
  if(!pick.ok){ showToast('error', 'Almost there', pick.msg); return; }
  if(!dateVal){ showToast('error','Pick a date','Choose the date this time was worked.'); return; }
  if(!totalMinutes || totalMinutes<=0){ showToast('error','Enter a duration','Try something like "1h 30m" or "1.5".'); return; }
  if(asWork && !description){ showToast('error', 'Say what you worked on', 'The notes are what shows in Queue.'); document.getElementById('manualDesc')?.focus(); return; }
  if(totalMinutes > 960 && !(await confirmDialog(`That's ${formatMinutes(totalMinutes)} for a single entry — did you mean minutes instead of hours?`, {confirmLabel:'Log it anyway', cancelLabel:'Let me fix it'}))) return;
  // the same time already logged (here or in Harvest): say so, with the one logged to edit (Nov 25)
  if(force !== true){
    // "Checking…" only when it takes a moment (Harvest still answering)
    const btn0 = clickedBtn(), slow = setTimeout(() => setBtnLoading(btn0, 'Checking…'), 300);
    const dup = await timeDuplicateOf({ clientId, dateStr: dateVal, minutes: totalMinutes, projectId: pick.projectId, taskId: pick.taskId, service, description });
    clearTimeout(slow); restoreBtn(btn0);
    if(dup){ manualDupShow(dup, clientId, asWork); return; }
  }
  // as work, several lines are several improvements under this one time (Nov 25); logged already? (data.js)
  const lines = asWork ? await workDupsAsk(clientId, workSplitItems(description)) : [];
  if(asWork && !lines) return;
  if(asWork && !lines.length){ showToast('info', 'Nothing logged', 'Those were all logged already.'); return; }
  const btn = clickedBtn();
  // a task open for this client: its time? Then it's marked done with this time, once (Nov 24)
  const forTask = typeof timeForOpenTask === 'function' ? await timeForOpenTask(clientId, description) : { go: true };
  if(!forTask) return;
  if(forTask.taskId){
    const today = toDateStr(new Date());
    closeAppModal();
    await finishTask(forTask.taskId, description || '', null, { doneDate: dateVal <= today ? dateVal : today, time: { clientId, minutes: totalMinutes, pick } });
    return;
  }
  setBtnLoading(btn, 'Saving…');
  // as work: the improvements first, then the time as its own entry, linked to them (as Queue's Log does)
  let imp = null, imps = [];
  if(asWork){
    imps = await manualWorkLines(clientId, lines, dateVal, pick, service);
    imp = imps[0] || null;
    if(!imp){ restoreBtn(btn); showToast('error', 'Save failed', 'Couldn’t log it as work. Try again in a moment.'); return; }
  }
  const { error, merged, entryId } = await mergeOrInsertTimeEntry({
    clientId, service, dateStr: dateVal, minutes: totalMinutes, description, projectId: pick.projectId, taskId: pick.taskId, improvementId: imp ? imp.id : null
  });
  restoreBtn(btn);
  const c = clients.find(x=>x.id===clientId);
  if(error){ showToast('error','Save failed', error.message); if(imp && typeof quRefreshAll === 'function') quRefreshAll(clientId); return; }
  if(imp && entryId) await supabaseClient.from('time_entries').update({ logged: true }).eq('id', entryId);
  if(imps.length > 1 && entryId) await workLinkBatch(imps, entryId);
  closeAppModal();
  if(imp){
    manualWorkActivity(clientId, imps);
    if(typeof quRefreshAll === 'function') quRefreshAll(clientId);
    showToast('success', 'Time added and logged as work', `${formatMinutes(totalMinutes)} for ${c ? c.name : 'the client'}${imps.length > 1 ? `, as ${imps.length} improvements` : ''}; it’s in Queue.`);
  } else merged
    ? showToast('success','Time added', `${formatMinutes(totalMinutes)} added to today's existing entry for ${c?c.name:'client'}.`)
    : showToast('success','Time added', `${formatMinutes(totalMinutes)} added for ${c?c.name:'client'}.`);
  syncEntryToHarvestBackground(entryId);
  await loadTimeEntries();
  renderTimesheet(); renderReports();
}

// Add Time found the same time already logged: the sheet says so above its buttons, which become
// Cancel, Add It Anyway and Edit That One. Logging it as work, the main one is Use That Time: the work
// gets the time already there, and nothing new goes to Harvest. A timer still running for the client:
// Add It Anyway, or Keep the Timer. Changing what makes it the same time puts the buttons back.
let manualDup = null;
function manualDupShow(dup, clientId, asWork){
  const card = document.querySelector('#appModalOverlay .sheet-a')?.parentElement; if(!card) return;
  const foot = card.querySelector('.sheet-a');
  card.querySelector('.tdup')?.remove();
  if(!foot.dataset.was) foot.dataset.was = foot.innerHTML;
  manualDup = dup;
  const why = timeDupWhy(dup), q = dup.description ? (dup.description.length > 140 ? dup.description.slice(0, 140) + '…' : dup.description) : '';
  const note = document.createElement('div');
  note.className = 'tdup'; note.setAttribute('role', 'status');
  note.innerHTML = `<span class="tdup-ic" aria-hidden="true">${icon(dup.timer ? 'timer' : 'clock')}</span><div><b>${escapeHtml(timeDupTitle(dup))}</b><span>${escapeHtml(timeDupWords(dup, clientId))}</span>${q ? `<q>${escapeHtml(q)}</q>` : ''}${why ? `<span class="tdup-why">${escapeHtml(why)}</span>` : ''}</div>`;
  foot.before(note);
  const useTime = asWork && !dup.timer && !dup.logged;
  foot.innerHTML = dup.timer
    ? `<button class="btn" onclick="addManualEntry(true)">Add It Anyway</button><button class="btn btn-p" onclick="closeAppModal()">Keep the Timer</button>`
    : `<button class="btn" onclick="closeAppModal()">Cancel</button><button class="btn" onclick="addManualEntry(true)">Add It Anyway</button>${useTime
      ? `<button class="btn btn-p" onclick="manualDupUseTime()">Use That Time</button>`
      : `<button class="btn btn-p" onclick="manualDupEdit('${dup.id}')">${dup.locked ? 'See That One' : 'Edit That One'}</button>`}`;
  // only what makes it the same time (client, day, length, project, task, and whether it's work): not
  // the notes, and not a field merely losing focus
  const key = () => ['manualClient', 'manualDate', 'manualDuration', 'manualProject', 'manualTask'].map(id => (document.getElementById(id) || {}).value || '').join('|') + (typeof sheetIsOn === 'function' && sheetIsOn('manualWork') ? '|w' : '');
  const was = key();
  const back = () => { if(key() === was) return; note.remove(); manualDup = null; if(foot.dataset.was){ foot.innerHTML = foot.dataset.was; delete foot.dataset.was; } card.removeEventListener('input', back, true); card.removeEventListener('change', back, true); card.removeEventListener('click', backSoon, true); };
  const backSoon = () => setTimeout(back, 0);   // switches flip on click
  card.addEventListener('input', back, true); card.addEventListener('change', back, true); card.addEventListener('click', backSoon, true);
  foot.querySelector('.btn-p')?.focus();
}
async function manualDupEdit(id){
  closeAppModal();
  if(!timeEntries.some(e => e.id === id)) await loadTimeEntries();
  if(timeEntries.some(e => e.id === id)) setTimeout(() => openTimeEntryModal(id), 200);
  else showToast('info', 'Couldn’t open it', 'It’s on your Timesheet for that day.');
}
// Logging it as work, with the time already logged: the work, then that entry linked to it (as Log as
// Work on a Timesheet entry does). No new time, so nothing new in Harvest.
async function manualDupUseTime(){
  const dup = manualDup; if(!dup || !dup.id) return;
  const clientId = document.getElementById('manualClient').value, dateVal = document.getElementById('manualDate').value;
  const description = document.getElementById('manualDesc').value.trim();
  const pick = typeof hvPickValue === 'function' && clientId ? hvPickValue('manual', clientId) : { ok: true, service: document.getElementById('manualService')?.value || '' };
  if(!description){ showToast('error', 'Say what you worked on', 'The notes are what shows in Queue.'); document.getElementById('manualDesc')?.focus(); return; }
  const lines = await workDupsAsk(clientId, workSplitItems(description));   // several lines: several improvements (Nov 25)
  if(!lines) return;
  if(!lines.length){ showToast('info', 'Nothing logged', 'Those were all logged already.'); return; }
  const btn = clickedBtn(); setBtnLoading(btn, 'Saving…');
  const c0 = clients.find(x => x.id === clientId);
  const imps = await manualWorkLines(clientId, lines, dateVal, pick, pick.service || '');
  const imp = imps[0];
  if(!imp){ restoreBtn(btn); showToast('error', 'Save failed', 'Couldn’t log it as work. Try again in a moment.'); return; }
  const linked = await workTimeLink(dup.id, imp.id);
  if(linked && imps.length > 1) await workLinkBatch(imps, dup.id);
  restoreBtn(btn); closeAppModal(); manualDup = null;
  manualWorkActivity(clientId, imps);
  if(typeof quRefreshAll === 'function') quRefreshAll(clientId);
  await loadTimeEntries(); renderTimesheet(); renderReports();
  !linked
    ? showToast('info', 'Logged as work', 'It’s in Queue, but its time didn’t link. Open the entry on your Timesheet to try again.')
    : showToast('success', 'Logged as work, with that time', `${formatMinutes(dup.minutes)} already logged for ${c0 ? c0.name : 'the client'} is its time. Nothing new went to Harvest.`);
}

// Add Time's notes as work: one improvement per line (one line is one, as before)
async function manualWorkLines(clientId, lines, dateVal, pick, service){
  const c0 = clients.find(x => x.id === clientId), today = toDateStr(new Date());
  const when = (dateVal === today ? new Date() : new Date(dateVal + 'T12:00:00')).toISOString();
  const svc = c0 && typeof serviceFromHarvest === 'function' && serviceFromHarvest(c0) ? (pick.projectId ? (pick.service || service) : improvementServiceFor(c0)) : service;
  const out = [];
  for(const text of lines){ const i = await insertImprovementFull(clientId, { author: myName() || 'Team member', text, includeInEmail: true, source: 'time', date: when, service: svc }); if(i) out.push(i); }
  return out;
}
function manualWorkActivity(clientId, imps){
  if(typeof logClientActivity !== 'function' || !imps.length) return;
  const who = myName() || 'Team member', cut = t => t.length > 80 ? t.slice(0, 80) + '…' : t;
  logClientActivity(clientId, 'improvement_logged', imps.length === 1 ? `${who} logged an improvement: "${cut(imps[0].text)}"`
    : `${who} logged ${imps.length} improvements: ${imps.slice(0, 3).map(i => `"${cut(i.text).slice(0, 50)}"`).join(', ')}${imps.length > 3 ? ` and ${imps.length - 3} more` : ''}`);
}

/* --- Timesheet --- */
function setTimesheetMode(mode){
  timesheetMode = mode;
  document.querySelectorAll('#timesheetModeBar .view-toggle-option').forEach(p=>p.classList.toggle('active', p.dataset.mode===mode));
  renderTimesheet();
}

function shiftTimesheet(dir){
  const d = new Date(timesheetAnchor);
  d.setDate(d.getDate() + dir*(timesheetMode==='week' ? 7 : 1));
  timesheetAnchor = d;
  renderTimesheet();
}

function jumpToToday(){ timesheetAnchor = new Date(); renderTimesheet(); }

function renderTimesheet(){
  const bodyEl = document.getElementById('timesheetBody');
  const labelEl = document.getElementById('timesheetRangeLabel');
  const dateInput = document.getElementById('timesheetDateInput');
  const returnBtn = document.getElementById('timesheetReturnToday');
  if(!bodyEl) return;
  const isToday = toDateStr(timesheetAnchor) === toDateStr(new Date());
  const todayPrefix = isToday ? `<span class="today-flag">Today</span> ` : '';
  let onCurrentPeriod = isToday;
  if(timesheetMode==='day'){
    labelEl.innerHTML = todayPrefix + new Date(timesheetAnchor).toLocaleDateString('en-US',{weekday:'long', month:'short', day:'numeric'});
    renderTimesheetDay(bodyEl);
  } else {
    const ws=getWeekStart(timesheetAnchor); const we=new Date(ws); we.setDate(we.getDate()+6);
    const wsIsCurrentWeek = toDateStr(ws) === toDateStr(getWeekStart(new Date()));
    onCurrentPeriod = wsIsCurrentWeek;
    const weekPrefix = wsIsCurrentWeek ? `<span class="today-flag">This week</span> ` : '';
    labelEl.innerHTML = `${weekPrefix}${ws.toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${we.toLocaleDateString('en-US',{month:'short',day:'numeric'})}`;
    renderTimesheetWeek(bodyEl);
  }
  if(dateInput) dateInput.value = toDateStr(timesheetAnchor);
  if(returnBtn) returnBtn.style.display = onCurrentPeriod ? 'none' : 'inline-flex';
}

function onTimesheetDatePicked(value){
  if(!value) return;
  timesheetAnchor = new Date(value+'T00:00:00');
  renderTimesheet();
}

// Shared by both Timesheet views (Day and Week) — one source of truth so
// they can't drift apart. Importance keeps its label muted but bolds the
// actual value, and health reuses the exact same pill dangerPillCompact()
// already renders in the Clients and Reports tables — same visual language
// for the same concept everywhere it appears.
// serviceOverride: the Day view passes the specific entry's service (what
// was actually worked on that day) since it's showing one exact entry. The
// Week view omits this — a week can span several entries with different
// services, so there's no single "service worked on" to show — and falls
// back to the client's signed service instead.
function timesheetClientMetaHtml(c, serviceOverride){
  if(!c) return '';
  const serviceToShow = serviceOverride || c.service;
  const serviceChip = serviceToShow ? `<span class="ts-meta-chip ts-meta-chip-service">${serviceToShow}</span>` : '';
  const importanceChip = `<span class="ts-meta-chip ts-meta-chip-importance"><span>Importance</span> ${c.importance}/10</span>`;
  return `<div class="ts-entry-client-meta">${serviceChip}${importanceChip}${dangerPillCompact(c.danger)}</div>`;
}

function renderTimesheetDay(bodyEl){
  if(!timeEntriesDataLoaded){ bodyEl.innerHTML = loadingStateHtml('Loading timesheet…'); return; }
  const weekStart = getWeekStart(timesheetAnchor);
  const selectedStr = toDateStr(timesheetAnchor);

  // Week strip: 7 mini day-totals + week total, current selection highlighted
  let weekTotal = 0;
  const stripDays = [];
  for(let i=0;i<7;i++){
    const d = new Date(weekStart); d.setDate(d.getDate()+i);
    const dStr = toDateStr(d);
    const dayMins = myOwnTimeEntries().filter(e=> e.date===dStr).reduce((s,e)=>s+e.minutes,0);
    weekTotal += dayMins;
    stripDays.push({d, dStr, dayMins});
  }
  const stripHtml = `<div class="week-strip">
    ${stripDays.map(({d,dStr,dayMins})=>`
      <div class="week-strip-day ${dStr===selectedStr?'selected':''}" onclick="jumpToDate('${dStr}')">
        <div class="wsd-label">${d.toLocaleDateString('en-US',{weekday:'short'})}<br>${d.getDate()} ${d.toLocaleDateString('en-US',{month:'short'})}</div>
        <div class="wsd-total">${dayMins?formatMinutes(dayMins):'0:00'}</div>
      </div>`).join('')}
    <div class="week-strip-total"><div class="wst-label">Week total</div><div class="wst-val">${formatMinutes(weekTotal)}</div></div>
  </div>`;

  const dayEntries = myOwnTimeEntries().filter(e=> e.date===selectedStr).sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt));

  const cardsHtml = dayEntries.length ? dayEntries.map(e=>{
    const c = clients.find(x=>x.id===e.clientId);
    const canEdit = currentUser && (e.userId===currentUser.id || isAdmin());
    const canLog = e.description && !e.logged;
    const hasMenuItems = canLog || canEdit;
    return `<div class="ts-entry-card">
      <div class="ts-entry-info">
        <div class="ts-entry-title">${c ? escapeHtml(c.name) : 'Unknown client'} ${(c && c.service) ? `<span class="ts-entry-service">(${escapeHtml(c.service)})</span>` : ''}</div>
        ${timesheetClientMetaHtml(c, e.service)}
        ${e.description ? `<div class="ts-entry-desc">${escapeHtml(e.description)}</div>` : ''}
      </div>
      <div class="ts-entry-right">
        <div class="ts-entry-duration">${formatMinutes(e.minutes)}</div>
        ${e.logged ? `<span class="pill pill-good" title="Already in Past Improvements">✓ Logged</span>` : ''}
        <button class="btn btn-outline" data-resume-client="${e.clientId}" data-resume-desc="${encodeURIComponent(e.description||'')}" data-resume-entry="${e.id}" onclick="resumeEntryTimerFromBtn(this)">▶ Start</button>
        ${canEdit ? `<button class="btn btn-outline" onclick="openTimeEntryModal('${e.id}')">Edit</button>` : ''}
        ${hasMenuItems ? `<div class="kanban-card-menu-wrap">
          <span class="kanban-card-menu-btn" onclick="event.stopPropagation();toggleKanbanCardMenu('ts-${e.id}')">⋯</span>
          <div class="kanban-card-menu" id="kanbanMenu-ts-${e.id}" style="display:none;">
            ${canLog ? `<div class="kanban-card-menu-item" onclick="event.stopPropagation();closeKanbanMenus();logTimeEntryAsImprovement('${e.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /> <path d="m16 9-5.5 5.5L8 12" /></svg>Log as improvement</div>` : ''}
            ${canEdit ? `<div class="kanban-card-menu-item danger" onclick="event.stopPropagation();closeKanbanMenus();deleteTimeEntry('${e.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 11v6" /> <path d="M14 11v6" /> <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /> <path d="M3 6h18" /> <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>Delete</div>` : ''}
          </div>
        </div>` : ''}
      </div>
    </div>`;
  }).join('') : `<div class="panel"><div class="empty">Nothing logged this day.</div></div>`;

  bodyEl.innerHTML = stripHtml + cardsHtml;
}

function renderTimesheetWeek(bodyEl){
  if(!timeEntriesDataLoaded){ bodyEl.innerHTML = loadingStateHtml('Loading timesheet…'); return; }
  const weekStart = getWeekStart(timesheetAnchor);
  const todayStr = toDateStr(new Date());
  const days = [];
  for(let i=0;i<7;i++){ const d=new Date(weekStart); d.setDate(d.getDate()+i); days.push(d); }
  const dayStrs = days.map(toDateStr);

  const relevant = myOwnTimeEntries().filter(e=> dayStrs.includes(e.date));
  if(!relevant.length){ bodyEl.innerHTML = `<div class="panel"><div class="empty">No time logged this week.</div></div>`; return; }

  // Group by client — each client with any entries this week becomes one row
  const clientIds = [...new Set(relevant.map(e=>e.clientId))];
  const rows = clientIds.map(cid=>{
    const c = clients.find(x=>x.id===cid);
    const cells = dayStrs.map(dStr=>{
      const mins = relevant.filter(e=>e.clientId===cid && e.date===dStr).reduce((s,e)=>s+e.minutes,0);
      return `<td class="tsg-cell ${dStr===todayStr?'today':''}" onclick="jumpToDateClient('${dStr}','${cid}')">${mins?formatMinutes(mins):''}</td>`;
    }).join('');
    const rowTotal = relevant.filter(e=>e.clientId===cid).reduce((s,e)=>s+e.minutes,0);
    return `<tr>
      <td class="tsg-row-label"><div class="tsg-client">${c?escapeHtml(c.name):'Unknown client'}</div>${timesheetClientMetaHtml(c)}</td>
      ${cells}
      <td class="tsg-total-cell">${formatMinutes(rowTotal)}</td>
    </tr>`;
  }).join('');

  const dailyTotals = dayStrs.map(dStr => relevant.filter(e=>e.date===dStr).reduce((s,e)=>s+e.minutes,0));
  const weekTotal = dailyTotals.reduce((s,m)=>s+m,0);

  bodyEl.innerHTML = `<div class="panel"><div class="panel-body" style="padding:0;overflow-x:auto;">
    <table class="timesheet-grid">
      <thead><tr>
        <th class="tsg-row-label"></th>
        ${days.map((d,i)=>`<th class="tsg-day-head ${dayStrs[i]===todayStr?'today':''}">${d.toLocaleDateString('en-US',{weekday:'short'})}<br>${d.getDate()} ${d.toLocaleDateString('en-US',{month:'short'})}</th>`).join('')}
        <th class="tsg-row-label">Total</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td class="tsg-row-label"><b>Daily total</b></td>
        ${dailyTotals.map((m,i)=>`<td class="tsg-total-cell ${dayStrs[i]===todayStr?'today':''}">${m?formatMinutes(m):'—'}</td>`).join('')}
        <td class="tsg-total-cell"><b>${formatMinutes(weekTotal)}</b></td>
      </tr></tfoot>
    </table>
  </div></div>`;
}

function jumpToDate(dStr){
  timesheetAnchor = new Date(dStr+'T00:00:00');
  timesheetMode = 'day';
  document.querySelectorAll('#timesheetModeBar .view-toggle-option').forEach(p=>p.classList.toggle('active', p.dataset.mode==='day'));
  renderTimesheet();
}

function jumpToDateClient(dStr, clientId){
  jumpToDate(dStr);
}

function resumeEntryTimerFromBtn(btn){
  const clientId = btn.dataset.resumeClient;
  const description = decodeURIComponent(btn.dataset.resumeDesc || '');
  const entryId = btn.dataset.resumeEntry || null;
  resumeEntryTimer(clientId, description, entryId);
}

function resumeEntryTimer(clientId, description, entryId){
  // Recover from a stuck "running" state (e.g. left over from a bug or a
  // browser tab that never got the stop event) — anything over 12 hours old
  // is clearly not a real in-progress session.
  if(timerState.running && timerState.startedAt && (Date.now() - timerState.startedAt > 12*3600*1000)){
    timerState = { running:false, startedAt:null, clientId:'', service:'', description:'', resumeEntryId:null };
    saveTimerState();
  }
  if(timerState.running){ showToast('error','Timer already running','Stop the current timer before starting another.'); return; }
  const c = clients.find(x=>x.id===clientId);
  if(!c){
    showToast('error','Could not resume', "This client couldn't be found — try starting the timer manually.");
    return;
  }
  const was = entryId ? timeEntries.find(e => e.id === entryId) : null;
  timerState = { running:true, startedAt:Date.now(), clientId, service: was ? was.service || '' : '', description: description||'', resumeEntryId: entryId||null,
    projectId: was ? was.harvestProjectId || null : null, taskId: was ? was.harvestTaskId || null : null };
  saveTimerState();
  if(timerIntervalId) clearInterval(timerIntervalId);
  timerIntervalId = setInterval(updateTimerDisplay, 1000);
  updateTimerDisplay();
  showToast('info','Resuming', 'Time will be added to this existing entry when you stop.');
}

function openTimeEntryModal(id){
  const e = timeEntries.find(x=>x.id===id);
  if(!e) return;
  const clientOptions = [...clients].filter(c=>c.status!=='Paused' || c.id===e.clientId).sort((a,b)=>a.name.localeCompare(b.name)).map(c=>`<option value="${c.id}" ${e.clientId===c.id?'selected':''}>${escapeHtml(c.name)}</option>`).join('');
  const serviceOptions = `<option value="">No service set</option>` + (settings.serviceOptions||[]).map(s=>`<option value="${escapeHtml(s)}" ${e.service===s?'selected':''}>${escapeHtml(s)}</option>`).join('');
  openAppModal(`
    <div class="modal-head"><span class="panel-title">Edit time entry</span><span class="toast-close" onclick="closeAppModal()">✕</span></div>
    <div class="modal-body">
      <div class="settings-field"><label>Client</label><select id="editEntryClient" style="width:100%;">${clientOptions}</select></div>
      <div class="settings-field"><label>Service</label><select id="editEntryService" style="width:100%;">${serviceOptions}</select></div>
      <div class="settings-field" style="position:relative;"><label>Date</label>${datePickerFieldHtml('editEntryDate', { value: e.date })}</div>
      <div class="settings-field"><label>Duration</label><input id="editEntryDuration" value="${minutesToDurationInputStr(e.minutes)}" placeholder="e.g. 1h 30m, or 1.5" style="width:100%;"></div>
      <div class="settings-field"><label>Description</label><textarea spellcheck="true" id="editEntryDesc" rows="3" style="width:100%;resize:vertical;min-height:64px;">${escapeHtml(e.description||'')}</textarea></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-brand" onclick="saveTimeEntryEdit('${id}')">Save changes</button>
      <button class="btn btn-outline" onclick="closeAppModal()">Cancel</button>
    </div>`, 440);
}

async function saveTimeEntryEdit(id){
  const clientId = document.getElementById('editEntryClient').value;
  const pick = typeof hvPickValue === 'function' ? hvPickValue('editEntry', clientId) : { ok: true, service: document.getElementById('editEntryService')?.value || '' };
  if(!pick.ok){ showToast('error', 'Almost there', pick.msg); return; }
  const service = pick.service || '';
  const dateVal = document.getElementById('editEntryDate').value;
  const totalMinutes = parseDurationInput(document.getElementById('editEntryDuration').value);
  const description = document.getElementById('editEntryDesc').value.trim();
  const asWork = typeof sheetIsOn === 'function' && sheetIsOn('editEntryWork');   // log it as work, the Queue's Email switch (Nov 23)
  const e0 = timeEntries.find(x => x.id === id), st = e0 && typeof entryWorkState === 'function' ? entryWorkState(e0) : { w: null, on: false, lock: null };
  const swShown = !!document.getElementById('editEntryWork');
  const newWork = swShown && asWork && !st.w && !st.linked, emailFlip = swShown && st.w && !st.lock && asWork !== st.on;
  if(!totalMinutes || totalMinutes<=0){ showToast('error','Enter a duration','Try something like "1h 30m" or "1.5".'); return; }
  if(newWork && !description){ showToast('error', 'Say what you worked on', 'The notes are what shows in Queue.'); document.getElementById('editEntryDesc')?.focus(); return; }
  if(totalMinutes > 960 && !(await confirmDialog(`That's ${formatMinutes(totalMinutes)} for a single entry — did you mean minutes instead of hours?`, {confirmLabel:'Save it anyway', cancelLabel:'Let me fix it'}))) return;
  if(newWork && !(await okToLogDuplicate(clientId, description))) return;   // logged already? (data.js)
  const btn = clickedBtn();
  setBtnLoading(btn, 'Saving…');
  const { error } = await supabaseClient.from('time_entries').update({
    client_id: clientId, entry_date: dateVal, minutes: totalMinutes, description, service, harvest_sync_status: 'pending',
    ...(typeof hvTimeOn === 'function' && hvTimeOn() ? { harvest_project_id: pick.projectId || null, harvest_task_id: pick.taskId || null } : {})
  }).eq('id', id);
  // as work: the improvement, and the entry linked to it (as Add Time does)
  let imp = null, flipped = null;
  // already logged: the switch is the Queue's Email switch, and the work's words follow the notes
  if(!error && st.w && !st.lock){
    const ch = {};
    if(emailFlip) ch.include_in_email = asWork;
    if(description && st.w.text === (e0.description || '').trim() && description !== st.w.text) ch.text = description;
    if(Object.keys(ch).length){
      const r = await supabaseClient.from('client_improvements').update(ch).eq('id', st.w.id).select();
      if(!r.error && r.data && r.data.length){
        if('include_in_email' in ch){ st.w.includeInEmail = ch.include_in_email; flipped = ch.include_in_email; }
        if(ch.text) st.w.text = ch.text;
        const c1 = clients.find(x => x.id === st.w.clientId), ci = c1 && (c1.improvements || []).find(i => i.id === st.w.id);
        if(ci && ci !== st.w){ if('include_in_email' in ch) ci.includeInEmail = ch.include_in_email; if(ch.text) ci.text = ch.text; }
        if(typeof quRefreshAll === 'function') quRefreshAll(st.w.clientId);
      } else if('include_in_email' in ch) flipped = 'failed';
    }
  }
  if(!error && newWork){
    const c0 = clients.find(x => x.id === clientId), today = toDateStr(new Date());
    imp = await insertImprovementFull(clientId, { author: myName() || 'Team member', text: description, includeInEmail: true, source: 'time',
      date: (dateVal === today ? new Date() : new Date(dateVal + 'T12:00:00')).toISOString(),
      service: c0 && typeof serviceFromHarvest === 'function' && serviceFromHarvest(c0) ? (pick.projectId ? service : improvementServiceFor(c0)) : service });
    if(imp){
      let r = await supabaseClient.from('time_entries').update({ logged: true, improvement_id: imp.id }).eq('id', id);
      if(r.error && workColumnMissing(r.error, 'improvement_id')) await supabaseClient.from('time_entries').update({ logged: true }).eq('id', id);
      if(typeof logClientActivity === 'function') logClientActivity(clientId, 'improvement_logged', `${myName() || 'Team member'} logged an improvement: "${description.length > 80 ? description.slice(0, 80) + '…' : description}"`);
      if(typeof quRefreshAll === 'function') quRefreshAll(clientId);
    }
  }
  restoreBtn(btn);
  closeAppModal();
  await loadTimeEntries();
  renderTimesheet(); renderReports();
  if(error){ showToast('error','Save failed', error.message); return; }
  if(newWork && !imp) showToast('info', 'Saved, not logged as work', 'The time is saved, but it couldn’t be logged as work. Try again from the entry.');
  else if(flipped === 'failed') showToast('info', 'Saved, Queue not changed', 'The time is saved, but the client update didn’t change. Try again in a moment.');
  else if(flipped === true) showToast('success', 'Saved, and in the client update', 'It’s back in Queue.');
  else if(flipped === false) showToast('success', 'Saved, and left out of the update', 'It stays on the client’s page, out of Queue’s email.');
  else showToast('success', imp ? 'Saved and logged as work' : 'Entry updated', imp ? 'It’s in Queue for the client update.' : 'Changes saved.');
  syncEntryToHarvestBackground(id);
}

async function deleteTimeEntry(id){
  // logged with a piece of work: both go, together (see trashWork in data.js)
  const linked = timeEntries.find(e => e.id === id);
  const work = linked && linked.improvementId ? clientImprovements.find(i => i.id === linked.improvementId) : null;
  if(work){
    // logged for several improvements at once (a batch): the time and all of them go together
    const all = [work, ...workBatchOf(id).filter(i => i.id !== work.id)];
    const locked = all.find(i => workLockedBy(i));
    if(locked){ workLockedToast(locked); return; }   // its work is in an update in review or approved
    const r = await deleteWorkAsk(all.map(i => i.id), { fromTime: true });
    if(r && r.ok){ renderTimesheet(); renderReports(); if(typeof renderAll === 'function') renderAll(); }
    return;
  }
  if(!(await confirmDialog('Move this time entry to Recently Deleted? You can restore it from there.', {confirmLabel:'Move to Trash'}))) return;
  const { data: entry } = await supabaseClient.from('time_entries').select('harvest_entry_id').eq('id', id).maybeSingle();
  const { error } = await supabaseClient.from('time_entries').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  await loadTimeEntries();
  renderTimesheet(); renderReports();
  if(error){ showToast('error','Delete failed', error.message); return; }
  showToast('success','Moved to Recently Deleted','Restore it from Recently Deleted anytime.');
  if(entry?.harvest_entry_id){
    const { data: { session } } = await supabaseClient.auth.getSession();
    fetch('/api/integrations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'harvest', action: 'delete-entry', harvestEntryId: entry.harvest_entry_id }),
    }).catch(()=>{});
  }
}
