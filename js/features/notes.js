// Notes: planned improvements, kanban board, logging a note as work.

/* ---------- Notes: plan future improvements, connected to the real logging system ---------- */

function noteStatusMeta(status){
  const map = {
    idea: {cls:'pill-status', label:'Idea'},
    planned: {cls:'pill-mid', label:'Planned'},
    'in-progress': {cls:'pill-brand', label:'In progress'},
    done: {cls:'pill-good', label:'Done'},
  };
  return map[status] || map.idea;
}

// Read-only preview — what clicking a note now opens, instead of jumping
// straight into editing. Editing is now a deliberate, separate action from
// the Edit button here (or the kanban card's own menu), not the default
// result of clicking a note.
function openNotePreview(noteId){
  const n = notes.find(x=>x.id===noteId);
  if(!n) return;
  const stage = NOTE_STAGES.find(s=>s.key===n.status) || NOTE_STAGES[0];
  const client = clients.find(c=>c.id===n.clientId);
  const updatedLabel = new Date(n.updatedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  openAppModal(`
    <div class="modal-head"><span class="panel-title">${escapeHtml(n.title || 'Untitled note')}</span><span class="toast-close" onclick="closeAppModal()">✕</span></div>
    <div class="modal-body">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
        <span class="pill" style="background:${stage.color}18;color:${stage.color};">${escapeHtml(stage.label)}</span>
        ${client ? `<span class="row-link" onclick="closeAppModal();openClientDetail('${client.id}')">${escapeHtml(client.name)}</span>` : ''}
        <span style="font-size:11px;color:var(--muted-lt);margin-left:auto;">Updated ${updatedLabel}</span>
      </div>
      <div style="white-space:pre-wrap;font-size:13.5px;line-height:1.6;color:var(--ink);">${escapeHtml(n.text)}</div>
      ${n.link ? `<a href="${safeUrl(normalizeUrl(n.link))}" target="_blank" rel="noopener" class="note-link" style="margin-top:14px;display:inline-block;">🔗 ${escapeHtml(truncateLinkDisplay(n.link, 60))}</a>` : ''}
    </div>
    <div class="modal-actions">
      <button class="btn btn-brand" onclick="closeAppModal();openNoteModal('${n.id}')">Edit</button>
      <button class="btn btn-outline" onclick="closeAppModal()">Close</button>
    </div>`, 460);
}

function openNoteModal(noteId, presetClientId, presetStatus){
  const editing = noteId ? notes.find(n=>n.id===noteId) : null;
  const ac = activeClients();
  if(!ac.length && !editing){ showToast('error','Add a client first','Notes need a client to attach to — add one in Clients.'); return; }
  let optionSource = [...ac];
  if(editing && !optionSource.some(c=>c.id===editing.clientId)){
    const trashedClient = clients.find(c=>c.id===editing.clientId);
    if(trashedClient) optionSource.push(trashedClient);
  }
  const clientOptions = optionSource.sort((a,b)=>a.name.localeCompare(b.name)).map(c=>`<option value="${c.id}" ${(editing && editing.clientId===c.id) || (!editing && presetClientId===c.id) ? 'selected':''}>${escapeHtml(c.name)}${c.deletedAt?' (in Trash)':''}</option>`).join('');
  const effectiveStatus = editing ? editing.status : (presetStatus || 'idea');
  openAppModal(`
    <div class="modal-head"><span class="panel-title">${editing ? 'Edit note' : 'Add note'}</span><span class="toast-close" onclick="closeAppModal()">✕</span></div>
    <div class="modal-body">
      <div class="settings-field"><label>Title</label><input id="noteTitleInput" type="text" style="width:100%;" placeholder="Short title for this note" value="${editing && editing.title ? escapeHtml(editing.title) : ''}"></div>
      <div class="settings-field"><label>Note</label><textarea spellcheck="true" id="noteTextInput" style="width:100%;min-height:64px;font-family:var(--font);font-size:13px;padding:10px;border-radius:8px;border:1px solid var(--border);resize:vertical;">${editing ? escapeHtml(editing.text) : ''}</textarea></div>
      <div class="form-grid">
        <div class="settings-field"><label>Client</label><select id="noteClientSelect" style="width:100%;">${clientOptions}</select></div>
        <div class="settings-field"><label>Status</label>
          <select id="noteStatusSelect" style="width:100%;">
            <option value="idea" ${effectiveStatus==='idea'?'selected':''}>Idea</option>
            <option value="planned" ${effectiveStatus==='planned'?'selected':''}>Planned</option>
            <option value="in-progress" ${effectiveStatus==='in-progress'?'selected':''}>In progress</option>
            <option value="done" ${effectiveStatus==='done'?'selected':''}>Done</option>
          </select>
        </div>
      </div>
      ${!editing ? `
      <div class="form-grid">
        <div class="settings-field"><label>Link (optional)</label><input id="noteLinkInput" type="url" placeholder="https://…" value="${editing && editing.link ? escapeHtml(editing.link) : ''}"></div>
        <div class="settings-field" style="position:relative;"><label>Follow-up date (optional)</label>${datePickerFieldHtml('noteFollowUpInput', { minDate: toDateStr(new Date()) })}</div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--ink);cursor:pointer;margin-top:2px;"><input type="checkbox" id="noteAddToCalendarInput"> Add to calendar (needs a follow-up date)</label>
      ` : `
      <div class="settings-field"><label>Link (optional)</label><input id="noteLinkInput" type="url" placeholder="https://…" value="${editing && editing.link ? escapeHtml(editing.link) : ''}"></div>
      `}
    </div>
    <div class="modal-actions">
      <button class="btn btn-brand" onclick="saveNote(${editing ? `'${editing.id}'` : 'null'})">${editing?'Save changes':'Add note'}</button>
      <button class="btn btn-outline" onclick="closeAppModal()">Cancel</button>
    </div>`, 460);
}

// Loads only the current user's own notes — RLS on the notes table means this
// query physically cannot return anyone else's rows, even if we wanted it to.
async function loadMyNotes(){
  if(!currentUser){ notes = []; notesDataLoaded = true; return; }
  const { data, error } = await supabaseClient
    .from('notes')
    .select('*')
    .eq('user_id', currentUser.id)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });
  if(error){ console.error('loadMyNotes error', error); notes = []; notesDataLoaded = true; return; }
  notes = (data||[]).map(n => ({ id:n.id, clientId:n.client_id, title:n.title, text:n.text, status:n.status, link:n.link, followUpDate:n.follow_up_date, createdAt:n.created_at, updatedAt:n.updated_at }));
  notesDataLoaded = true;
}

async function loadMyTrashedNotes(){
  if(!currentUser) return [];
  const { data, error } = await supabaseClient
    .from('notes')
    .select('*')
    .eq('user_id', currentUser.id)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false });
  if(error){ console.error('loadMyTrashedNotes error', error); return []; }
  return (data||[]).map(n => ({ id:n.id, clientId:n.client_id, title:n.title, text:n.text, status:n.status, deletedAt:n.deleted_at }));
}

async function restoreNote(id){
  const { error } = await supabaseClient.from('notes').update({ deleted_at: null }).eq('id', id).eq('user_id', currentUser.id);
  await loadMyNotes();
  populateNotesClientFilter();
  renderNotes();
  await renderTrash();
  error ? showToast('error','Restore failed', error.message) : showToast('success','Note restored','Back in your notes list.');
}

async function permanentlyDeleteNote(id){
  if(!(await confirmDialog('Permanently delete this note? This cannot be undone.', {confirmLabel:'Delete permanently', destructive:true}))) return;
  const { error } = await supabaseClient.from('notes').delete().eq('id', id).eq('user_id', currentUser.id);
  if(!error) await supabaseClient.from('calendar_events').delete().eq('related_note_id', id);
  await loadCalendarEvents();
  renderCalendar();
  await renderTrash();
  error ? showToast('error','Delete failed', error.message) : showToast('success','Permanently deleted','Gone for good.');
}

async function saveNote(noteId){
  const title = document.getElementById('noteTitleInput').value.trim();
  const clientId = document.getElementById('noteClientSelect').value;
  const status = document.getElementById('noteStatusSelect').value;
  const text = document.getElementById('noteTextInput').value.trim();
  const link = normalizeUrl(document.getElementById('noteLinkInput').value) || null;
  const followUpInput = document.getElementById('noteFollowUpInput');
  const followUpDate = followUpInput ? (followUpInput.value || null) : null;
  const addToCalendarInput = document.getElementById('noteAddToCalendarInput');
  const addToCalendar = addToCalendarInput ? addToCalendarInput.checked : false;
  if(!title){ showToast('error','Add a title','Give this note a short title first.'); return; }
  if(!clientId){ showToast('error','Pick a client','Select which client this note is about.'); return; }
  const originalNote = noteId ? notes.find(n=>n.id===noteId) : null;
  if(followUpDate && followUpDate !== originalNote?.followUpDate && followUpDate < toDateStr(new Date())){
    showToast('error','Date is in the past','Pick today or a future date.'); return;
  }
  if(!text){ showToast('error','Nothing written','Add some note text first.'); return; }
  if(addToCalendar && !followUpDate){ showToast('error','Follow-up date required','Set a date first, or uncheck "Add to calendar".'); return; }
  if(addToCalendar && followUpDate < toDateStr(new Date())){ showToast('error','That date has already passed','Pick a future follow-up date.'); return; }
  const btn = clickedBtn();
  setBtnLoading(btn, 'Saving…');
  let error, newId;
  if(noteId){
    ({ error } = await supabaseClient.from('notes').update({ title, client_id: clientId, status, text, link }).eq('id', noteId).eq('user_id', currentUser.id));
  } else {
    const { data, error: insErr } = await supabaseClient.from('notes').insert({ user_id: currentUser.id, title, client_id: clientId, status, text, link, follow_up_date: followUpDate }).select().single();
    error = insErr;
    newId = data?.id;
  }
  restoreBtn(btn);
  await loadMyNotes();
  populateNotesClientFilter();
  renderNotes();
  if(!error && newId){
    logClientActivity(clientId, 'note_added', `${myName()||'Someone'} added a private note (content not shared here).`);
    refreshClientDetailActivityIfOpen(clientId);
    closeAppModal();
    showToast('success','Note added', `Saved.`);
    if(addToCalendar) await addNoteToCalendar(newId);
  } else {
    closeAppModal();
    error ? showToast('error','Save failed', error.message) : showToast('success','Note updated','Changes saved.');
  }
}

async function deleteNote(id){
  if(!(await confirmDialog('Move this note to Trash? You can restore it later from Settings.', {confirmLabel:'Move to Trash'}))) return;
  const { error } = await supabaseClient.from('notes').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('user_id', currentUser.id);
  await loadMyNotes();
  renderNotes();
  if(error){ showToast('error','Delete failed', error.message); return; }
  const stillActive = notes.some(n=>n.id===id);
  if(stillActive){ showToast('error','Delete failed','The note is still active — you may not have permission to delete it.'); return; }
  showToast('success','Note moved to Trash','Restore it anytime from Trash.');
}

async function changeNoteStatus(id, newStatus){
  const { error } = await supabaseClient.from('notes').update({ status: newStatus }).eq('id', id).eq('user_id', currentUser.id);
  await loadMyNotes();
  renderNotes();
  if(error) showToast('error','Save failed', error.message);
}

// The actual system connection: converts a planned note straight into a real
// logged improvement on that client — the same thing logImprovement() does —
// instead of leaving Notes as a disconnected side list. The improvement itself
// is shared (same as always); only the note that prompted it stays private.
async function logNoteNow(id){
  const btn = clickedBtn();
  setBtnLoading(btn, 'Logging…');
  const n = notes.find(x=>x.id===id);
  if(!n){ restoreBtn(btn); showToast('error','Not found','This note may have already been removed.'); return; }
  await loadAll();
  const c = clients.find(x=>x.id===n.clientId);
  if(!c){ restoreBtn(btn); showToast('error','Client not found','This client may have been removed.'); return; }
  c.improvements.push({ author: myName()||'Team member', text: n.text, date: new Date().toISOString(), includeInEmail: true, source: 'note' });
  const invalidated = invalidateStaleDraft(c, myName()||'Team member');
  if(invalidated) await saveDraftFor(c.id, myName()||'Team member', { draftStatus:'none', draft:'' });
  log.unshift({t:nowTime(), tag:'you', userId:currentUser?.id, text:`Logged a planned improvement for <b>${escapeHtml(c.name)}</b> from Notes.`});
  const ok = await persistAppData();
  const { error } = await supabaseClient.from('notes').update({ status: 'done' }).eq('id', id).eq('user_id', currentUser.id);
  await loadMyNotes();
  renderNotes(); renderClientsTable(); renderKpis(); renderQueue(); renderLog();
  (ok && !error) ? showToast('success','Logged!', `Added to ${c.name}'s improvement log this week.`) : showToast('error','Save failed','Could not save — try again.');
}

function populateNotesClientFilter(){
  const sel = document.getElementById('notesClientFilter');
  if(!sel) return;
  const current = sel.value || 'all';
  sel.innerHTML = `<option value="all">All clients</option>` + activeClients().sort((a,b)=>a.name.localeCompare(b.name)).map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  if([...sel.options].some(o=>o.value===current)) sel.value = current;
}

const NOTE_STAGES = [
  { key:'idea',        label:'Idea',        color:'#7C93B0', icon:'<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M176,232a8,8,0,0,1-8,8H88a8,8,0,0,1,0-16h80A8,8,0,0,1,176,232Zm40-128a87.55,87.55,0,0,1-33.64,69.21A16.24,16.24,0,0,0,176,186v6a16,16,0,0,1-16,16H96a16,16,0,0,1-16-16v-6a16,16,0,0,0-6.23-12.66A87.59,87.59,0,0,1,40,104.49C39.74,56.83,78.26,17.14,125.88,16A88,88,0,0,1,216,104Zm-16,0a72,72,0,0,0-73.74-72c-39,.92-70.47,33.39-70.26,72.39a71.65,71.65,0,0,0,27.64,56.3A32,32,0,0,1,96,186v6h64v-6a32.15,32.15,0,0,1,12.47-25.35A71.65,71.65,0,0,0,200,104Zm-16.11-9.34a57.6,57.6,0,0,0-46.56-46.55,8,8,0,0,0-2.66,15.78c16.57,2.79,30.63,16.85,33.44,33.45A8,8,0,0,0,176,104a9,9,0,0,0,1.35-.11A8,8,0,0,0,183.89,94.66Z"/></svg>' },
  { key:'planned',      label:'Planned',     color:'#C99A55', icon:'<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M208,32H184V24a8,8,0,0,0-16,0v8H88V24a8,8,0,0,0-16,0v8H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM72,48v8a8,8,0,0,0,16,0V48h80v8a8,8,0,0,0,16,0V48h24V80H48V48ZM208,208H48V96H208V208Z"/></svg>' },
  { key:'in-progress',  label:'In Progress', color:'#C17A6E', icon:'<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm48.24-94.78-64-40A8,8,0,0,0,100,88v80a8,8,0,0,0,12.24,6.78l64-40a8,8,0,0,0,0-13.56ZM116,153.57V102.43L156.91,128Z"/></svg>' },
  { key:'done',         label:'Done',        color:'#117F3A', icon:'<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M173.66,98.34a8,8,0,0,1,0,11.32l-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35A8,8,0,0,1,173.66,98.34ZM232,128A104,104,0,1,1,128,24,104.11,104.11,0,0,1,232,128Zm-16,0a88,88,0,1,0-88,88A88.1,88.1,0,0,0,216,128Z"/></svg>' },
];

function renderNotes(){
  const board = document.getElementById('notesBoard');
  if(!board) return;
  if(!notesDataLoaded){ board.innerHTML = loadingStateHtml('Loading notes…'); return; }
  updateNotesBadge();
  const clientFilter = document.getElementById('notesClientFilter')?.value || 'all';

  const visible = notes.filter(n=> clientFilter==='all' || n.clientId===clientFilter);

  board.innerHTML = NOTE_STAGES.map(stage=>{
    const stageNotes = visible.filter(n=>n.status===stage.key)
      .sort((a,b)=> new Date(b.updatedAt||b.createdAt) - new Date(a.updatedAt||a.createdAt));
    return `<div class="kanban-column">
      <div class="kanban-column-head" style="background:${stage.color}22;border:1px solid ${stage.color}66;">
        <span class="kanban-column-icon" style="color:${stage.color};">${stage.icon}</span>
        <span class="kanban-column-title">${escapeHtml(stage.label)}</span>
        <span class="kanban-column-count">${stageNotes.length}</span>
        <button class="kanban-add-btn" onclick="openNoteModal(undefined,undefined,'${stage.key}')" title="New note in ${escapeHtml(stage.label)}">+</button>
      </div>
      <div class="kanban-cards">
        ${stageNotes.length ? stageNotes.map(n=>noteCardHtml(n)).join('') : `<div class="empty" style="padding:18px 8px;font-size:11.5px;">Nothing here yet.</div>`}
      </div>
    </div>`;
  }).join('');
}

function noteCardMenuHtml(n){
  const moveOptions = NOTE_STAGES.filter(s=>s.key!==n.status).map(s=>
    `<div class="kanban-card-menu-item" onclick="event.stopPropagation();changeNoteStatus('${n.id}','${s.key}')"><svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M221.66,133.66l-72,72a8,8,0,0,1-11.32-11.32L196.69,136H40a8,8,0,0,1,0-16H196.69L138.34,61.66a8,8,0,0,1,11.32-11.32l72,72A8,8,0,0,1,221.66,133.66Z"/></svg>Move to ${escapeHtml(s.label)}</div>`
  ).join('');
  return moveOptions
    + `<div class="kanban-card-menu-divider"></div>`
    + `<div class="kanban-card-menu-item" onclick="event.stopPropagation();closeKanbanMenus();openNoteModal('${n.id}')"><svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M229.66,58.34l-32-32a8,8,0,0,0-11.32,0l-96,96A8,8,0,0,0,88,128v32a8,8,0,0,0,8,8h32a8,8,0,0,0,5.66-2.34l96-96A8,8,0,0,0,229.66,58.34ZM124.69,152H104V131.31l64-64L188.69,88ZM200,76.69,179.31,56,192,43.31,212.69,64ZM224,128v80a16,16,0,0,1-16,16H48a16,16,0,0,1-16-16V48A16,16,0,0,1,48,32h80a8,8,0,0,1,0,16H48V208H208V128a8,8,0,0,1,16,0Z"/></svg>Edit</div>`
    + `<div class="kanban-card-menu-item danger" onclick="event.stopPropagation();closeKanbanMenus();deleteNote('${n.id}')"><svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z"/></svg>Delete</div>`;
}

function noteCardHtml(n){
  const c = clients.find(x=>x.id===n.clientId);
  const dateStr = new Date(n.createdAt).toLocaleDateString('en-US',{month:'short',day:'numeric'});
  const isDone = n.status==='done';

  return `<div class="kanban-card" onclick="openNotePreview('${n.id}')">
    <div class="kanban-card-top">
      ${isDone
        ? `<span class="kanban-card-due" style="color:var(--green);font-weight:700;">
            <svg width="12" height="12" viewBox="0 0 256 256" fill="currentColor"><path d="M176.49,95.51a12,12,0,0,1,0,17l-56,56a12,12,0,0,1-17,0l-24-24a12,12,0,1,1,17-17L112,143l47.51-47.52A12,12,0,0,1,176.49,95.51ZM236,128A108,108,0,1,1,128,20,108.12,108.12,0,0,1,236,128Zm-24,0a84,84,0,1,0-84,84A84.09,84.09,0,0,0,212,128Z"/></svg>
            Done ${dateStr}
          </span>`
        : `<span class="kanban-card-due">
            <svg width="11" height="11" viewBox="0 0 256 256" fill="currentColor"><path d="M208,28H188V24a12,12,0,0,0-24,0v4H92V24a12,12,0,0,0-24,0v4H48A20,20,0,0,0,28,48V208a20,20,0,0,0,20,20H208a20,20,0,0,0,20-20V48A20,20,0,0,0,208,28ZM68,52a12,12,0,0,0,24,0h72a12,12,0,0,0,24,0h16V76H52V52ZM52,204V100H204V204Z"/></svg>
            ${dateStr}
          </span>`}
      <div class="kanban-card-menu-wrap">
        <span class="kanban-card-menu-btn" onclick="event.stopPropagation();toggleKanbanCardMenu('note-${n.id}')">⋯</span>
        <div class="kanban-card-menu" id="kanbanMenu-note-${n.id}" style="display:none;">${noteCardMenuHtml(n)}</div>
      </div>
    </div>
    <div class="kanban-card-title">${escapeHtml(n.title || 'Untitled note')}</div>
    <div class="kanban-card-desc" style="white-space:normal;-webkit-line-clamp:1;display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden;color:var(--muted-lt);cursor:pointer;" onclick="event.stopPropagation(); goToClientInQueue('${n.clientId}','all')">${c ? escapeHtml(c.name) : 'Unknown client'}</div>
    <div class="kanban-card-desc" style="white-space:normal;-webkit-line-clamp:3;display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden;">${escapeHtml(n.text)}</div>
    ${n.link ? `<a href="${safeUrl(normalizeUrl(n.link))}" target="_blank" rel="noopener" class="note-link" onclick="event.stopPropagation();">🔗 ${truncateLinkDisplay(n.link, 40)}</a>` : ''}
    <div class="kanban-card-footer">
      ${!isDone ? `<button class="btn btn-brand" style="padding:6px 12px;font-size:11px;" onclick="event.stopPropagation();logNoteNow('${n.id}')">Log it now</button>` : `<span style="font-size:11px;color:var(--muted-lt);">Logged as an improvement</span>`}
    </div>
  </div>`;
}

function updateNotesBadge(){
  const badge = document.getElementById('navNotesBadge');
  if(!badge) return;
  const open = notes.filter(n=>n.status!=='done').length;
  badge.textContent = open;
  badge.style.display = open ? 'inline-flex' : 'none';
}
