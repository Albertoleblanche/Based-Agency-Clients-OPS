// Granola (Nov 23): tasks from meetings, on the desktop.
//  • Tasks: "From your Granola meetings" sits above the board or list while you have suggestions waiting.
//    Add makes it your task as it is; Edit… opens New Task filled in (saving adds it); × dismisses,
//    with Undo. The shared parts (loading, adding, deciding) are in sheets-canvas.js.
//  • Settings → Connections → Granola: an admin pastes the workspace API key; everyone sees whether
//    it's connected, when Radar last read meetings, and how many tasks it has suggested.
// The server side is lib/granola-tasks.js.

let tkSgAll = false;

// The section, or nothing. It refreshes itself when a minute old (and when a notification comes in).
function tkSuggestHtml(){
  if(typeof taskSuggestions === 'undefined') return '';
  if(taskSuggestions === null || Date.now() - taskSuggestionsAt > 60000) tkSgRefresh();
  if(tasksScope === 'byme') return '';
  const list = suggestionsOpen(taskSuggestions).filter(s => tasksClient === 'all' || s.clientId === tasksClient);
  if(!list.length) return '';
  const shown = tkSgAll ? list : list.slice(0, 4);
  const row = s => {
    const sub = suggestionSub(s), meet = s.sourceUrl ? `<a href="${safeUrl(s.sourceUrl)}" target="_blank" rel="noopener" title="Open the notes in Granola">${escapeHtml(sub[0])}</a>` : escapeHtml(sub[0]);
    return `<div class="tk-sg-r" data-sg="${s.id}"><div class="tx" role="button" tabindex="0" aria-label="Preview “${escapeHtml(s.title)}”" onclick="if(!event.target.closest('a'))tkSgPreview('${s.id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();tkSgPreview('${s.id}')}"><b>${escapeHtml(s.title)}</b><span class="s">${meet}${sub.slice(1).map(x => ' · ' + escapeHtml(x)).join('')}</span>${s.quote ? `<span class="q">“${escapeHtml(s.quote)}”</span>` : ''}</div>`
      + `<div class="tk-sg-a"><button class="btn sm" onclick="tkSgAdd('${s.id}')">Add</button><button class="btn sm" onclick="tkSgEdit('${s.id}')">Edit…</button>`
      + `<button class="ib" aria-label="Dismiss “${escapeHtml(s.title)}”" title="Dismiss" onclick="tkSgDismiss('${s.id}')">${icon('x')}</button></div></div>`;
  };
  // by client (Nov 23): a client with more than 3 gets Add All
  const groups = [];
  list.forEach(s => { const k = s.clientId || ''; let g = groups.find(x => x.k === k); if(!g) groups.push(g = { k, items: [] }); g.items.push(s); });
  const many = groups.length > 1;
  let left = tkSgAll ? Infinity : 4;
  const body = groups.map(g => {
    const rows = g.items.slice(0, Math.max(0, left)); left -= rows.length;
    if(!rows.length) return '';
    const c = g.k && clients.find(x => x.id === g.k), name = c ? c.name : 'No client';
    const all = g.items.length > 3 ? `<button class="btn sm tk-sg-all" data-sgall="${g.k}" onclick="tkSgAddAll('${g.k}')">Add All ${g.items.length}</button>` : '';
    const head = many || all ? `<div class="tk-sg-g"><span>${escapeHtml(name)}</span><span class="n">${g.items.length}</span>${all}</div>` : '';
    return head + rows.map(row).join('');
  }).join('');
  return `<section class="tk-sg" aria-label="Suggested from your Granola meetings"><div class="tk-sg-h">${appLogo('granola', 'xs')}<b>From your Granola meetings</b><span class="n">${list.length}</span><span class="w">Found in your Granola notes. Add the ones that are yours to do.</span></div>
${body}${list.length > 4 ? `<button class="x-lnk tk-sg-more" onclick="tkSgAll=!tkSgAll;renderTasks()">${tkSgAll ? 'Show fewer' : `Show all ${list.length}`}</button>` : ''}</section>`;
}
// Add All (Nov 23): every suggestion waiting for one client becomes your task, as it is.
async function tkSgAddAll(clientKey){
  const list = suggestionsOpen(taskSuggestions || []).filter(s => (s.clientId || '') === clientKey);
  if(!list.length) return;
  const btn = document.querySelector(`.tk-sg-all[data-sgall="${clientKey}"]`);
  if(btn){ btn.disabled = true; btn.textContent = 'Adding…'; }
  list.forEach(s => tkSgBusy(s.id, true));
  let added = 0, failed = 0, had = 0;
  for(const s of list){ const r = await addSuggestedTask(s.id); if(r.error) failed++; else if(r.already) had++; else added++; }
  const c = clientKey && clients.find(x => x.id === clientKey);
  const hadWords = had ? ` ${had === 1 ? 'One was' : `${had} were`} already in your tasks.` : '';
  if(added) showToast(failed ? 'info' : 'success', `Added ${added} task${added === 1 ? '' : 's'}`, `${c ? c.name + ': ' : ''}${failed ? `${failed} didn’t go in; try those again.` : 'They’re in your tasks.'}${hadWords}`);
  else if(had && !failed) showToast('info', 'Already in your tasks', `${c ? c.name + ': ' : ''}nothing new to add.`);
  else showToast('error', 'Not added', 'Try again in a moment.');
  await loadMyTasks(); renderTasks(); if(typeof updateTasksNavBadge === 'function') updateTasksNavBadge();
}
async function tkSgRefresh(){
  if(tkSgRefresh.busy) return;
  tkSgRefresh.busy = true;
  const before = (taskSuggestions || []).map(s => s.id).join();
  try{ await loadTaskSuggestions(); }catch(e){} finally{ tkSgRefresh.busy = false; }
  if((taskSuggestions || []).map(s => s.id).join() !== before && typeof currentViewName !== 'undefined' && currentViewName === 'tasks') renderTasks();
}
// The preview (Nov 23): what the task is about before deciding; Add, Edit… or Dismiss from there.
function tkSgPreview(id){
  const s = (taskSuggestions || []).find(x => x.id === id); if(!s) return;
  openAppModal(`<h3 class="sgp-h">${escapeHtml(s.title)}</h3><div class="sgp" id="sgpBody">${suggestionPreviewHtml(s)}</div>
<div class="sheet-a sgp-a"><button class="btn sgp-x" onclick="closeAppModal();tkSgDismiss('${s.id}')">Dismiss</button><span class="sgp-gap"></span><button class="btn" onclick="closeAppModal();tkSgEdit('${s.id}')">Edit…</button><button class="btn btn-p" id="sgpAdd" onclick="closeAppModal();tkSgAdd('${s.id}')">Add to My Tasks</button></div>`, 560);
  setTimeout(() => document.getElementById('sgpAdd')?.focus({ preventScroll: true }), 30);   // after the sheet's own first focus
  // the meeting's notes, for the excerpt, if they aren't here yet
  if(granolaMeetings === null && s.sourceId) loadGranolaMeetings().then(() => { const b = document.getElementById('sgpBody'); if(b) b.innerHTML = suggestionPreviewHtml(s); });
}
// A decided row folds away, then the list redraws without it.
function tkSgOut(id, then){
  const row = document.querySelector(`.tk-sg-r[data-sg="${id}"]`);
  const last = document.querySelectorAll('.tk-sg-r').length === 1, el = last ? document.querySelector('.tk-sg') : row;
  if(!el || matchMedia('(prefers-reduced-motion: reduce)').matches){ then(); return; }
  el.style.height = el.offsetHeight + 'px'; el.offsetHeight;   // from its height now
  el.classList.add('is-out'); el.style.height = '0px';
  setTimeout(then, 230);
}
function tkSgBusy(id, on){ document.querySelectorAll(`.tk-sg-r[data-sg="${id}"] button`).forEach(b => { b.disabled = on; }); }
async function tkSgAdd(id){
  tkSgBusy(id, true);
  const r = await addSuggestedTask(id);
  if(r.error){ tkSgBusy(id, false); showToast('error', 'Not added', r.error.message || 'Try again in a moment.'); return; }
  showToast(r.already ? 'info' : 'success', r.already ? 'Already in your tasks' : 'Added to your tasks', r.task.title);
  tkSgOut(id, async () => { await loadMyTasks(); renderTasks(); if(typeof updateTasksNavBadge === 'function') updateTasksNavBadge(); });
}
function tkSgEdit(id){
  const s = (taskSuggestions || []).find(x => x.id === id); if(!s) return;
  const preset = suggestionPreset(s), done = preset.afterCreate;
  preset.afterCreate = async task => { await done(task); if(currentViewName === 'tasks') renderTasks(); };
  openNewTaskModal(currentUser.id, 'todo', preset);
}
async function tkSgDismiss(id){
  const s = (taskSuggestions || []).find(x => x.id === id); if(!s) return;
  tkSgBusy(id, true);
  if(!(await decideSuggestion(id, 'dismissed'))){ tkSgBusy(id, false); showToast('error', 'Not dismissed', 'Try again in a moment.'); return; }
  taskSuggestions = taskSuggestions || [];
  tkSgOut(id, () => renderTasks());
  showToast('info', 'Dismissed', s.title, { action: 'Undo', onAction: async () => {
    if(await decideSuggestion(id, 'pending')){ taskSuggestions = [s, ...(taskSuggestions || []).filter(x => x.id !== id)].sort((a, b) => new Date(b.sourceAt || 0) - new Date(a.sourceAt || 0)); renderTasks(); }
  } });
}

// Check Granola, in the Tasks header: anyone on the team can ask for new meetings to be read now
// (they also come in by themselves). Shown once Radar knows Granola is connected.
let tkGranolaBusy = false;
function tkGranolaBtn(){
  granolaWatch(() => { if(currentViewName === 'tasks') renderTasks(); });
  if(!granolaOn) return '';
  return `<button class="btn tk-gr" id="tkGranola" onclick="tkGranolaCheck()"${tkGranolaBusy ? ' disabled' : ''} title="Look for new action items in your Granola meetings">${tkGranolaBusy ? '<span class="tk-gr-spin" aria-hidden="true"></span>Checking…' : `${appLogo('granola', 'xs')}Check Granola`}</button>`;
}
async function tkGranolaCheck(){
  if(tkGranolaBusy) return;
  tkGranolaBusy = true; renderTasks();
  let r; try{ r = await checkGranolaNow(); } finally { tkGranolaBusy = false; }
  showToast(r.type, r.title, r.text);
  renderTasks();
}

// ---- Settings → Connections → Granola ----------------------------------------------------------
let granolaState = null;   // what the server says (connected, last read…); null while checking
async function loadGranolaState(){
  try{ granolaState = await granolaApi(null); }catch(e){ granolaState = { connected: false, error: e.message }; }
  if(!granolaState.error) granolaSet(granolaState.connected);   // the Check Granola button in Tasks follows
  const box = document.getElementById('granolaBox'); if(box) box.innerHTML = granolaSheetInner();
  return granolaState;
}
function granolaRowStatus(st){
  const g = granolaState;
  return g == null ? st('', 'Checking…') : g.error ? st('yellow', 'Couldn’t check') : g.needsSql ? st('yellow', 'Needs setup') : g.connected ? st(g.lastError ? 'yellow' : 'green', g.lastError ? 'Problem' : 'Connected') : st('hollow', 'Not connected');
}
const granolaWhen = t => { if(!t) return ''; const d = new Date(t); return `${relDay(d).toLowerCase() === 'today' ? 'today' : relDay(d)} at ${fmtTime(d)}`; };
function granolaSheetInner(){
  const g = granolaState, admin = isAdmin();
  const about = `<p class="t-2 gr-about">When a meeting’s notes are ready in Granola, Radar picks out the action items for people on the team and suggests each one to its person in Tasks, where they add it or dismiss it.</p>`;
  if(g == null) return about + `<p class="t-2 gr-st">Checking…</p>`;
  if(g.error) return about + `<p class="gr-warn">${icon('warning')}Radar couldn’t check Granola just now. <button class="btn sm" onclick="granolaState=null;document.getElementById('granolaBox').innerHTML=granolaSheetInner();loadGranolaState()">Try Again</button></p>`;
  if(g.needsSql) return about + `<p class="gr-warn">${icon('warning')}Run <code>addendum-granola.sql</code> in Supabase’s SQL Editor first, then come back here.</p>`;
  if(!g.connected){
    return about + (admin ? `<label class="gr-lab" for="granolaKey">Workspace API key</label>
<div class="gr-keyrow"><input id="granolaKey" class="tf" type="password" autocomplete="off" spellcheck="false" placeholder="grn_…" onkeydown="if(event.key==='Enter')granolaConnect()"><button class="btn btn-p" id="granolaGo" onclick="granolaConnect()">Connect</button></div>
<p class="t-2 gr-note">In Granola: Settings → Connectors → Workspace API keys → Create new key. Radar reads the notes in Granola’s Team space and in spaces with API access turned on, not anyone’s private notes. The key stays on Radar’s server.</p>`
      : `<p class="t-2 gr-st">Not connected. An admin can connect it here.</p>`);
  }
  const lines = [
    (g.connectedAt ? `Since ${granolaWhen(g.connectedAt)}. ` : '') + (g.webhook ? 'Meetings come in as soon as their notes are ready.' : 'Radar reads new meetings once a day.'),
    g.webhookError ? `Granola couldn’t set up instant delivery (${escapeHtml(g.webhookError)}), so the daily read does it.` : '',
    g.lastReadAt ? `Last looked for meetings ${granolaWhen(g.lastReadAt)}.` : '',
    `${g.suggested30 || 0} task${g.suggested30 === 1 ? '' : 's'} suggested in the last 30 days${g.suggested30 ? `, ${g.added30 || 0} added` : ''}.`,
    g.lastError ? `<span class="gr-err">The last read stopped: ${escapeHtml(g.lastError)}</span>` : '',
  ].filter(Boolean);
  return about + `<div class="form-grp"><div class="fr"><div class="l"><b>${icon('check-circle')}Connected</b><span>${lines.join('<br>')}</span></div></div></div>`
    + (admin ? `<div class="gr-acts"><button class="btn" id="granolaRead" onclick="granolaReadNow()">Read Recent Meetings Now</button><button class="btn" onclick="granolaDisconnect()">Disconnect…</button></div>` : '')
    + granolaMeetingsHtml(g.meetings || [], admin);   // each person's own meetings; the server filters (Nov 23)
}
// The meetings Radar read lately and what came of each, so a missing task can be traced; an admin
// can read one again (what it already suggested isn't suggested twice).
function granolaMeetingWords(m){
  if(m.state === 'waiting') return 'Waiting for Granola to finish the notes';
  if(m.state === 'reading') return 'Reading now…';
  if(m.state === 'same') return 'Another recording of this meeting was read';
  if(m.state === 'removed') return `Removed from Radar${m.removedBy ? ` by ${String(m.removedBy).split(' ')[0]}` : ''}`;
  if(m.items) return `${m.items} task${m.items === 1 ? '' : 's'} suggested${m.away && m.away.length ? `; some were for people not in Radar (${m.away.join(', ')})` : ''}`;
  return m.why ? m.why.charAt(0).toUpperCase() + m.why.slice(1) : 'Nothing for the team';
}
function granolaMeetingsHtml(list, admin){
  if(!list.length) return '';
  const day = t => { const d = new Date(t); return isNaN(d) ? '' : relDay(d); };
  const row = m => `<div class="fr gr-m"><div class="l"><b>${m.url ? `<a href="${safeUrl(m.url)}" target="_blank" rel="noopener">${escapeHtml(m.title)}</a>` : escapeHtml(m.title)}</b><span>${escapeHtml([day(m.meetingAt || m.at), granolaMeetingWords(m)].filter(Boolean).join(' · '))}</span></div>`
    + (m.state === 'removed' ? `<button class="btn sm" onclick="granolaRestore(${jsArg(m.id)}, this)">Restore</button>`
      : admin ? `<button class="btn sm" onclick="granolaReadAgain(${jsArg(m.id)}, this)">Read Again</button>` : '') + `</div>`;
  return `<div class="sl-h gr-mh">Recent meetings</div><div class="form-grp gr-ml">${list.map(row).join('')}</div>`;
}
// A meeting removed from Radar, back (for the people who can see it; the server checks)
async function granolaRestore(id, btn){
  setBtnLoading(btn, 'Restoring…');
  if(await meetingRestore(id)) await loadGranolaState(); else restoreBtn(btn);
}
async function granolaReadAgain(id, btn){
  setBtnLoading(btn, 'Reading…');
  try{
    const r = await granolaApi('read-again', { note: id });
    if(r.error) showToast('error', 'Couldn’t read it', r.error);
    else if(r.waiting) showToast('info', 'Granola is still writing it', 'Radar reads it once the notes are done.');
    else if(r.suggested) showToast('success', `${r.suggested} task${r.suggested === 1 ? '' : 's'} suggested`, `From “${r.title || 'the meeting'}”. Each person sees theirs in Tasks.`);
    else showToast('info', 'Nothing new in it', r.why ? r.why.charAt(0).toUpperCase() + r.why.slice(1) + '.' : 'Its action items were already suggested.');
    await loadGranolaState(); tkSgRefresh();
  }catch(e){ showToast('error', 'Couldn’t read it', e.message); restoreBtn(btn); }
}
function openGranolaSheet(){
  openAppModal(`<h3 class="ap-h">${appLogo('granola', 'sm')}Granola</h3><div id="granolaBox">${granolaSheetInner()}</div><div class="sheet-a"><button class="btn btn-p" onclick="closeAppModal();loadIntegrationStatuses()">Done</button></div>`, 560);
  loadGranolaState();
}
async function granolaConnect(){
  const key = (document.getElementById('granolaKey')?.value || '').trim();
  if(!key){ showToast('error', 'Paste the key first', 'It starts with grn_.'); document.getElementById('granolaKey')?.focus(); return; }
  const btn = document.getElementById('granolaGo'); setBtnLoading(btn, 'Connecting…');
  try{
    const r = await granolaApi('connect', { key });
    showToast('success', 'Granola connected', r.first && r.first.suggested ? `${r.first.suggested} task${r.first.suggested === 1 ? '' : 's'} suggested from the last few days.` : 'New meetings will come in as their notes are ready.');
    await loadGranolaState(); tkSgRefresh();
  }catch(e){ restoreBtn(btn); showToast('error', 'Not connected', e.message); }
}
async function granolaReadNow(){
  const btn = document.getElementById('granolaRead'); setBtnLoading(btn, 'Reading…');
  try{
    const r = await granolaApi('read-now');
    showToast(r.error ? 'error' : 'success', r.error ? 'Granola didn’t answer' : r.read ? `Read ${r.read} meeting${r.read === 1 ? '' : 's'}` : 'No new meetings', r.error || (r.read ? `${r.suggested} task${r.suggested === 1 ? '' : 's'} suggested.` : 'Everything is already read.'));
    await loadGranolaState(); tkSgRefresh();
  }catch(e){ showToast('error', 'Couldn’t read meetings', e.message); }
  restoreBtn(btn);
}
async function granolaDisconnect(){
  if(!(await confirmDialog('Disconnect Granola? New meetings won’t be read. Suggestions already made stay.', { confirmLabel: 'Disconnect', destructive: true }))) return;
  try{ await granolaApi('disconnect'); showToast('success', 'Granola disconnected', ''); await loadGranolaState(); }
  catch(e){ showToast('error', 'Not disconnected', e.message); }
}
