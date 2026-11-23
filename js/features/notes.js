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
        <span style="font-size:12px;color:var(--muted-lt);margin-left:auto;">Updated ${updatedLabel}</span>
      </div>
      <div style="white-space:pre-wrap;font-size:14.5px;line-height:1.6;color:var(--ink);">${escapeHtml(n.text)}</div>
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
      <div class="settings-field"><label>Note</label><textarea spellcheck="true" id="noteTextInput" style="width:100%;min-height:64px;font-family:var(--font);font-size:14px;padding:10px;border-radius:8px;border:1px solid var(--border);resize:vertical;">${editing ? escapeHtml(editing.text) : ''}</textarea></div>
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
      <label style="display:flex;align-items:center;gap:8px;font-size:13.5px;color:var(--ink);cursor:pointer;margin-top:2px;"><input type="checkbox" id="noteAddToCalendarInput"> Add to calendar (needs a follow-up date)</label>
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
  notes = (data||[]).map(n => ({ id:n.id, clientId:n.client_id, title:n.title, text:n.text, status:n.status, link:n.link, followUpDate:n.follow_up_date, color:n.color||null, createdAt:n.created_at, updatedAt:n.updated_at }));
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
  { key:'idea',        label:'Idea',        color:'#7C93B0', icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" /> <path d="M9 18h6" /> <path d="M10 22h4" /></svg>' },
  { key:'planned',      label:'Planned',     color:'#C99A55', icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v3" /> <path d="M16 2v3" /> <rect x="3" y="3" width="18" height="18" rx="2" /> <path d="M3 9h18" /> <path d="M8 13h.01" /> <path d="M12 13h.01" /> <path d="M16 13h.01" /> <path d="M8 17h.01" /> <path d="M12 17h.01" /> <path d="M16 17h.01" /></svg>' },
  { key:'in-progress',  label:'In Progress', color:'#C17A6E', icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 9.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997A1 1 0 0 1 9 14.996z" /> <circle cx="12" cy="12" r="10" /></svg>' },
  { key:'done',         label:'Done',        color:'#117F3A', icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /> <path d="m16 9-5.5 5.5L8 12" /></svg>' },
];

// Notes works like Mail and Apple Notes: the list on the left, the note
// you picked on the right. Status, client and editing live in the note
// itself; the list stays a calm scan of titles.
let selectedNoteId = null;

function selectNote(id){
  selectedNoteId = id;
  renderNotes();
}

function renderNotes(){
  const board = document.getElementById('notesBoard');
  if(!board) return;
  if(!notesDataLoaded){ board.innerHTML = loadingStateHtml('Loading notes…'); return; }
  updateNotesBadge();
  const clientFilter = document.getElementById('notesClientFilter')?.value || 'all';
  const visible = notes.filter(n=> clientFilter==='all' || n.clientId===clientFilter)
    .sort((a,b)=> new Date(b.updatedAt||b.createdAt) - new Date(a.updatedAt||a.createdAt));

  if(!visible.length){
    board.innerHTML = `<div class="cd-grp notes-empty">${emptyStateHtml(NOTE_STAGES[0].icon.replace(/width="14" height="14"/,'width="20" height="20"'),
      clientFilter==='all' ? 'No notes yet' : 'No notes for this client',
      'Notes are private to you — ideas and plans you want to get to.',
      '<button class="btn btn-brand" onclick="openNoteModal()">New Note</button>')}</div>`;
    return;
  }
  if(!visible.some(n=>n.id===selectedNoteId)) selectedNoteId = visible[0].id;

  const fmt = d => new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric'});
  const list = visible.map(n=>{
    const c = clients.find(x=>x.id===n.clientId);
    const meta = noteStatusMeta(n.status);
    const sel = n.id===selectedNoteId;
    return `<div class="note-row${sel ? ' sel' : ''}" role="option" aria-selected="${sel}" tabindex="0" onclick="selectNote('${n.id}')" onkeydown="if(event.key==='Enter')selectNote('${n.id}')">
      <div class="note-row-top"><b>${escapeHtml(n.title || 'Untitled note')}</b><time>${fmt(n.updatedAt||n.createdAt)}</time></div>
      <span class="note-row-client">${c ? escapeHtml(c.name) : 'No client'}</span>
      <span class="note-row-pv"><span class="pill ${meta.cls}">${escapeHtml(meta.label)}</span> ${escapeHtml((n.text||'').slice(0,140))}</span>
    </div>`;
  }).join('');

  const n = visible.find(x=>x.id===selectedNoteId);
  const c = clients.find(x=>x.id===n.clientId);
  const statusOptions = NOTE_STAGES.map(st=>`<option value="${st.key}"${st.key===n.status?' selected':''}>${escapeHtml(st.label)}</option>`).join('');
  const pane = `
    <div class="note-bar">
      ${c ? `<span class="row-link" onclick="openClientDetail('${c.id}')">${escapeHtml(c.name)}</span>` : ''}
      <label class="note-status"><span class="sr-only">Status</span><select onchange="changeNoteStatus('${n.id}', this.value)">${statusOptions}</select></label>
      <span class="note-private"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /> <path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>Only you can see this note</span>
    </div>
    <h2 class="note-title">${escapeHtml(n.title || 'Untitled note')}</h2>
    <div class="note-text">${escapeHtml(n.text || '')}</div>
    ${n.link ? `<a href="${safeUrl(normalizeUrl(n.link))}" target="_blank" rel="noopener" class="note-link">${escapeHtml(truncateLinkDisplay(n.link, 60))}</a>` : ''}
    <div class="note-actions">
      ${n.status!=='done' ? `<button class="btn btn-brand" onclick="logNoteNow('${n.id}')">Log It as an Improvement</button>` : ''}
      <button class="btn btn-outline" onclick="openNoteModal('${n.id}')">Edit</button>
      <button class="btn btn-outline note-delete" onclick="deleteNote('${n.id}')">Delete</button>
    </div>
    <p class="note-meta">Created ${fmt(n.createdAt)}${n.updatedAt && n.updatedAt!==n.createdAt ? ` · edited ${fmt(n.updatedAt)}` : ''}</p>`;
  board.innerHTML = `<div class="notes-list" role="listbox" aria-label="Notes">${list}</div><section class="notes-pane" aria-label="Selected note">${pane}</section>`;
}

// Notes in the sidebar counts the Granola meetings read since you last opened Notes (Nov 23)
function updateNotesBadge(){
  const badge = document.getElementById('navNotesBadge');
  if(!badge) return;
  const n = typeof granolaNewN !== 'undefined' ? granolaNewN : 0;
  badge.textContent = n;
  badge.style.display = n ? '' : 'none';   // the stylesheet lays out the count circle
  badge.title = n ? `${n} new meeting${n === 1 ? '' : 's'} from Granola` : '';
}
