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
  const { data, error } = await supabaseClient.from('time_entries').select('*').is('deleted_at', null).order('entry_date', { ascending:false });
  if(error){ console.error('loadTimeEntries error', error); timeEntries = []; timeEntriesDataLoaded = true; return; }
  timeEntries = (data||[]).map(e=>({ id:e.id, userId:e.user_id, clientId:e.client_id, date:e.entry_date, minutes:e.minutes, description:e.description||'', service:e.service||'', createdAt:e.created_at, logged:!!e.logged, harvestStatus:e.harvest_sync_status||'', harvestId:e.harvest_entry_id||null }));
  timeEntriesDataLoaded = true;
  if(typeof renderToday === 'function') renderToday();
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
  const imp = await insertImprovementRow(entry.clientId, { author: myName()||'Team member', text: entry.description.trim(), includeInEmail: false, source: 'time' });
  if(!imp){ showToast('error','Save failed','Could not save — try again.'); return; }
  const invalidated = invalidateStaleDraft(c, myName()||'Team member');
  if(invalidated) await saveDraftFor(entry.clientId, myName()||'Team member', { draftStatus:'none', draft:'' });
  renderImprovementsHistory();
  renderClientsTable();
  renderQueue();
  renderKpis();

  const { error } = await supabaseClient.from('time_entries').update({ logged: true }).eq('id', entryId);
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
  return (data||[]).map(e=>({ id:e.id, userId:e.user_id, clientId:e.client_id, date:e.entry_date, minutes:e.minutes, description:e.description||'', service:e.service||'', deletedAt:e.deleted_at }));
}

async function restoreTimeEntry(id){
  const { error } = await supabaseClient.from('time_entries').update({ deleted_at: null }).eq('id', id);
  await loadTimeEntries();
  renderTimesheet(); renderReports();
  await renderTrash();
  error ? showToast('error','Restore failed', error.message) : showToast('success','Entry restored','Back on the timesheet.');
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
    const ac = activeClients();
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
  const tb = document.getElementById('tbTimer');
  if(tb){
    // On Time itself the timer is the big card, so the toolbar leaves it out (as on the canvas).
    tb.style.display = timerState.running && (typeof currentViewName === 'undefined' || currentViewName !== 'time') && (typeof toolbarTimerPref !== 'function' || toolbarTimerPref()) ? 'inline-flex' : 'none';
    if(timerState.running){
      const tc = clients.find(x=>x.id===timerState.clientId);
      document.getElementById('tbTimerTime').textContent = (timeStr || '0:00:00').replace(/^0(\d):/, '$1:');
      document.getElementById('tbTimerClient').textContent = tc ? shortClientName(tc.name) : '';
    }
  }
  const pill = document.getElementById('floatingTimerPill');
  if(!pill) return;
  if(!timerState.running){ pill.style.display = 'none'; return; }
  pill.style.display = 'flex';
  const c = clients.find(x=>x.id===timerState.clientId);
  document.getElementById('ftpClient').textContent = c ? c.name : 'Tracking time…';
  document.getElementById('ftpDesc').textContent = timerState.description || '';
  document.getElementById('ftpTime').textContent = timeStr || '00:00:00';
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
async function mergeOrInsertTimeEntry({ clientId, service, dateStr, minutes, description }){
  const { data: existing } = await supabaseClient
    .from('time_entries').select('id, minutes, description')
    .eq('user_id', currentUser.id).eq('client_id', clientId).eq('service', service||'')
    .eq('entry_date', dateStr).is('deleted_at', null).maybeSingle();

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
    user_id: currentUser.id, client_id: clientId, entry_date: dateStr, minutes, description, service
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
function syncEntryToHarvestBackground(entryId){
  if(!entryId) return;
  supabaseClient.auth.getSession().then(({ data: { session } })=>{
    fetch('/api/integrations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'harvest', action: 'sync-entry', timeEntryId: entryId }),
    }).catch(()=>{}); // network failure here is fine — falls to the daily catch-up
  });
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
        user_id: currentUser.id, client_id: clientId, entry_date: toDateStr(new Date()), minutes, description, service
      }).select('id').single();
      error = insertErr;
      if(newRow){ savedId = newRow.id; syncEntryToHarvestBackground(newRow.id); }
    }
  } else {
    const mergeResult = await mergeOrInsertTimeEntry({
      clientId, service, dateStr: toDateStr(new Date()), minutes, description
    });
    error = mergeResult.error; mergedIntoExisting = mergeResult.merged; savedId = mergeResult.entryId || null;
    if(!error) syncEntryToHarvestBackground(mergeResult.entryId);
  }

  await loadTimeEntries();
  renderTimesheet(); renderReports();
  if(error){ showToast('error','Save failed', error.message); return null; }
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
  const service = document.getElementById('timerModalService')?.value || '';
  const description = document.getElementById('timerModalDesc').value.trim();
  timerState = { running:true, startedAt:Date.now(), clientId, service, description, resumeEntryId:null };
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

async function addManualEntry(){
  const clientId = document.getElementById('manualClient').value;
  const service = document.getElementById('manualService')?.value || '';
  const dateVal = document.getElementById('manualDate').value;
  const totalMinutes = parseDurationInput(document.getElementById('manualDuration').value);
  const description = document.getElementById('manualDesc').value.trim();
  if(!clientId){ showToast('error','Pick a client','Select which client this time is for.'); return; }
  if(isClientPaused(clientId)){ showPausedClientWarning(clientId); return; }
  if(!dateVal){ showToast('error','Pick a date','Choose the date this time was worked.'); return; }
  if(!totalMinutes || totalMinutes<=0){ showToast('error','Enter a duration','Try something like "1h 30m" or "1.5".'); return; }
  if(totalMinutes > 960 && !(await confirmDialog(`That's ${formatMinutes(totalMinutes)} for a single entry — did you mean minutes instead of hours?`, {confirmLabel:'Log it anyway', cancelLabel:'Let me fix it'}))) return;
  const btn = clickedBtn();
  setBtnLoading(btn, 'Saving…');
  const { error, merged, entryId } = await mergeOrInsertTimeEntry({
    clientId, service, dateStr: dateVal, minutes: totalMinutes, description
  });
  restoreBtn(btn);
  const c = clients.find(x=>x.id===clientId);
  if(error){ showToast('error','Save failed', error.message); return; }
  closeAppModal();
  merged
    ? showToast('success','Time added', `${formatMinutes(totalMinutes)} added to today's existing entry for ${c?c.name:'client'}.`)
    : showToast('success','Time added', `${formatMinutes(totalMinutes)} added for ${c?c.name:'client'}.`);
  syncEntryToHarvestBackground(entryId);
  await loadTimeEntries();
  renderTimesheet(); renderReports();
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
            ${canLog ? `<div class="kanban-card-menu-item" onclick="event.stopPropagation();closeKanbanMenus();logTimeEntryAsImprovement('${e.id}')"><svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M173.66,98.34a8,8,0,0,1,0,11.32l-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35A8,8,0,0,1,173.66,98.34ZM232,128A104,104,0,1,1,128,24,104.11,104.11,0,0,1,232,128Zm-16,0a88,88,0,1,0-88,88A88.1,88.1,0,0,0,216,128Z"/></svg>Log as improvement</div>` : ''}
            ${canEdit ? `<div class="kanban-card-menu-item danger" onclick="event.stopPropagation();closeKanbanMenus();deleteTimeEntry('${e.id}')"><svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z"/></svg>Delete</div>` : ''}
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
  timerState = { running:true, startedAt:Date.now(), clientId, service:'', description: description||'', resumeEntryId: entryId||null };
  saveTimerState();
  if(timerIntervalId) clearInterval(timerIntervalId);
  timerIntervalId = setInterval(updateTimerDisplay, 1000);
  updateTimerDisplay();
  showToast('info','Resuming', 'Time will be added to this existing entry when you stop.');
}

function openTimeEntryModal(id){
  const e = timeEntries.find(x=>x.id===id);
  if(!e) return;
  const clientOptions = [...clients].sort((a,b)=>a.name.localeCompare(b.name)).map(c=>`<option value="${c.id}" ${e.clientId===c.id?'selected':''}>${escapeHtml(c.name)}</option>`).join('');
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
  const service = document.getElementById('editEntryService')?.value || '';
  const dateVal = document.getElementById('editEntryDate').value;
  const totalMinutes = parseDurationInput(document.getElementById('editEntryDuration').value);
  const description = document.getElementById('editEntryDesc').value.trim();
  if(!totalMinutes || totalMinutes<=0){ showToast('error','Enter a duration','Try something like "1h 30m" or "1.5".'); return; }
  if(totalMinutes > 960 && !(await confirmDialog(`That's ${formatMinutes(totalMinutes)} for a single entry — did you mean minutes instead of hours?`, {confirmLabel:'Save it anyway', cancelLabel:'Let me fix it'}))) return;
  const btn = clickedBtn();
  setBtnLoading(btn, 'Saving…');
  const { error } = await supabaseClient.from('time_entries').update({
    client_id: clientId, entry_date: dateVal, minutes: totalMinutes, description, service, harvest_sync_status: 'pending'
  }).eq('id', id);
  restoreBtn(btn);
  closeAppModal();
  await loadTimeEntries();
  renderTimesheet(); renderReports();
  if(error){ showToast('error','Save failed', error.message); return; }
  showToast('success','Entry updated','Changes saved.');
  syncEntryToHarvestBackground(id);
}

async function deleteTimeEntry(id){
  if(!(await confirmDialog('Move this time entry to Trash? You can restore it later from Settings.', {confirmLabel:'Move to Trash'}))) return;
  const { data: entry } = await supabaseClient.from('time_entries').select('harvest_entry_id').eq('id', id).maybeSingle();
  const { error } = await supabaseClient.from('time_entries').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  await loadTimeEntries();
  renderTimesheet(); renderReports();
  if(error){ showToast('error','Delete failed', error.message); return; }
  showToast('success','Entry moved to Trash','Restore it anytime from Trash.');
  if(entry?.harvest_entry_id){
    const { data: { session } } = await supabaseClient.auth.getSession();
    fetch('/api/integrations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'harvest', action: 'delete-entry', harvestEntryId: entry.harvest_entry_id }),
    }).catch(()=>{});
  }
}
