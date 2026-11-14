// Reminders: client questions awaiting a response, kanban board.

/* ---------- Reminders: tracks client questions awaiting a response, team-visible ---------- */

let clientReminders = [];

async function loadClientReminders(){
  const { data, error } = await supabaseClient.from('client_reminders').select('*').order('follow_up_date',{ascending:true});
  if(error){ console.error('loadClientReminders error', error); clientReminders = []; return; }
  clientReminders = (data||[]).map(r=>({
    id:r.id, clientId:r.client_id, question:r.question, askedBy:r.asked_by,
    askedDate:r.asked_date, followUpDate:r.follow_up_date, status:r.status, resolvedAt:r.resolved_at
  }));
  updateRemindersNavBadge();
}

// Only three statuses are ever actually stored — 'waiting', 'answered',
// 'closed'. "Follow-up Due" is a derived display state, not a fourth
// stored value: whenever a reminder is still 'waiting' and its follow-up
// date has arrived (or passed), it displays as due. This keeps it always
// correct against today's real date with nothing that has to actively
// flip a stored value at the right moment.
function reminderDisplayStatus(r){
  if(r.status==='waiting' && r.followUpDate && r.followUpDate <= toDateStr(new Date())) return 'due';
  return r.status;
}

const REMINDER_STATUS_META = {
  waiting:  { label:'Waiting on Client', icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>', color:'#A65B05' },
  due:      { label:'Follow-up Due',     icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>', color:'#3A63C9' },
  answered: { label:'Answered',          icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>', color:'#117F3A' },
  closed:   { label:'Closed',            icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><line x1="10" y1="12" x2="14" y2="12"/></svg>', color:'#696F78' },
};

// Kanban column order — includes 'due' as its own visual column even
// though it's derived rather than stored, since the whole point of the
// board is seeing what needs action grouped separately from what's simply
// still waiting.
const REMINDER_STAGES = ['waiting','due','answered','closed'].map(key=>({ key, ...REMINDER_STATUS_META[key] }));

function updateRemindersNavBadge(){
  const badge = document.getElementById('navRemindersBadge');
  if(!badge) return;
  const dueCount = clientReminders.filter(r=>r.askedBy===currentUser?.id && reminderDisplayStatus(r)==='due').length;
  badge.textContent = dueCount;
  badge.style.display = dueCount ? 'flex' : 'none';
}

function renderReminders(){
  const board = document.getElementById('remindersBoard');
  if(!board) return;

  const visible = clientReminders.filter(r=>r.askedBy===currentUser?.id);

  board.innerHTML = REMINDER_STAGES.map(stage=>{
    const stageReminders = visible.filter(r=>reminderDisplayStatus(r)===stage.key)
      .sort((a,b)=> (a.followUpDate||'').localeCompare(b.followUpDate||''));
    return `<div class="kanban-column">
      <div class="kanban-column-head" style="background:${stage.color}22;border:1px solid ${stage.color}66;">
        <span class="kanban-column-icon" style="color:${stage.color};">${stage.icon}</span>
        <span class="kanban-column-title">${escapeHtml(stage.label)}</span>
        <span class="kanban-column-count">${stageReminders.length}</span>
        ${stage.key==='waiting' ? `<button class="kanban-add-btn" onclick="openNewReminderModal()" title="New reminder">+</button>` : ''}
      </div>
      <div class="kanban-cards">
        ${stageReminders.length ? stageReminders.map(r=>reminderCardHtml(r)).join('') : `<div class="empty" style="padding:18px 8px;font-size:11.5px;">Nothing here yet.</div>`}
      </div>
    </div>`;
  }).join('');
}

function reminderCardMenuHtml(r){
  const display = reminderDisplayStatus(r);
  const moveOptions = [];
  if(display!=='answered') moveOptions.push(['answered','Mark answered']);
  if(display!=='closed') moveOptions.push(['closed','Close']);
  if(display==='answered' || display==='closed') moveOptions.push(['waiting','Reopen']);
  const moveHtml = moveOptions.map(([status,label])=>
    `<div class="kanban-card-menu-item" onclick="event.stopPropagation();closeKanbanMenus();markReminderStatus('${r.id}','${status}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>${escapeHtml(label)}</div>`
  ).join('');
  return moveHtml
    + `<div class="kanban-card-menu-divider"></div>`
    + `<div class="kanban-card-menu-item" onclick="event.stopPropagation();closeKanbanMenus();openNoteModal(null, '${r.clientId}', 'idea')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Start a note</div>`
    + (display==='due' ? `<div class="kanban-card-menu-item" onclick="event.stopPropagation();closeKanbanMenus();createTaskFromReminder('${r.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>+ Task: chase this down</div>` : '')
    + `<div class="kanban-card-menu-item danger" onclick="event.stopPropagation();closeKanbanMenus();deleteReminder('${r.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>Delete</div>`;
}

// Turns a stale reminder into an assigned task — pre-fills the client and
// a description carrying the actual question, so whoever it lands on
// doesn't need to go dig up context from the reminder itself. Deliberately
// doesn't preset a due date: the reminder's own follow-up date has already
// passed by the time this is reachable, so carrying that date over would
// mean creating a task that's overdue the moment it's assigned — better to
// leave that to whoever's actually assigning it.
function createTaskFromReminder(reminderId){
  const r = clientReminders.find(x=>x.id===reminderId);
  if(!r) return;
  const c = clients.find(x=>x.id===r.clientId);
  openNewTaskModal(undefined, 'todo', {
    title: c ? `Follow up with ${c.name}` : 'Follow up with client',
    description: r.question,
    clientId: r.clientId,
  });
}

function reminderCardHtml(r){
  const c = clients.find(x=>x.id===r.clientId);
  const owner = teamProfiles.find(p=>p.id===r.askedBy);
  const display = reminderDisplayStatus(r);
  const isResolved = display==='answered' || display==='closed';
  const followUpLabel = reminderFollowUpLabel(r.followUpDate);

  return `<div class="kanban-card" onclick="openReminderDetailModal('${r.id}')">
    <div class="kanban-card-top">
      ${isResolved
        ? `<span class="kanban-card-due" style="color:var(--green);font-weight:700;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            ${display==='answered' ? 'Answered' : 'Closed'}
          </span>`
        : `<span class="kanban-card-due" style="${display==='due'?'color:var(--brand-dark);':''}">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            Follow up ${followUpLabel}
          </span>`}
      <div class="kanban-card-menu-wrap">
        <span class="kanban-card-menu-btn" onclick="event.stopPropagation();toggleKanbanCardMenu('reminder-${r.id}')">⋯</span>
        <div class="kanban-card-menu" id="kanbanMenu-reminder-${r.id}" style="display:none;">${reminderCardMenuHtml(r)}</div>
      </div>
    </div>
    <div class="kanban-card-desc" style="white-space:normal;-webkit-line-clamp:1;display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden;color:var(--muted-lt);cursor:pointer;" onclick="event.stopPropagation();openClientDetail('${r.clientId}')">${c ? escapeHtml(c.name) : 'Unknown client'}</div>
    <div class="kanban-card-title" style="font-size:13px;">${escapeHtml(r.question)}</div>
    <div class="kanban-card-assigned-label">Asked by</div>
    <div class="kanban-card-avatars">${owner ? personAvatarHtml(owner.id) : ''}</div>
  </div>`;
}

function reminderFollowUpLabel(dateStr){
  if(!dateStr) return '—';
  const todayStr = toDateStr(new Date());
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate()+1);
  if(dateStr===todayStr) return 'Today';
  if(dateStr===toDateStr(tomorrow)) return 'Tomorrow';
  return new Date(dateStr+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});
}

function openNewReminderModal(presetClientId){
  const defaultFollowUp = new Date(); defaultFollowUp.setDate(defaultFollowUp.getDate()+3);
  openAppModal(`
    <div class="modal-head"><span class="panel-title">New reminder</span><span class="toast-close" onclick="closeAppModal()">✕</span></div>
    <div class="modal-body">
      <div class="form-grid">
        <div class="client-search-wrap" style="grid-column:1/-1;"><label>Client</label>
          <input type="text" class="client-search-input" id="reminderClientSearch" placeholder="Search client…" autocomplete="off">
          <input type="hidden" id="reminderClient">
          <div class="client-search-dropdown" id="reminderClientDropdown"></div>
        </div>
        <div style="grid-column:1/-1;"><label>Question / request</label><textarea spellcheck="true" id="reminderQuestion" placeholder="e.g. Can you send us the latest project photos?" rows="3" style="resize:vertical;min-height:64px;font-family:inherit;"></textarea></div>
        <div style="position:relative;"><label>Follow-up date</label>${datePickerFieldHtml('reminderFollowUpDate', { value: toDateStr(defaultFollowUp), minDate: toDateStr(new Date()) })}</div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--ink);cursor:pointer;margin-top:2px;"><input type="checkbox" id="reminderAddToCalendarInput" checked> Add to calendar</label>
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeAppModal()">Cancel</button>
      <button class="btn btn-brand" onclick="saveNewReminder()">Save</button>
    </div>`, 460);
  setupClientSearchSelect('reminderClientSearch', 'reminderClient', 'reminderClientDropdown');
  if(presetClientId) setClientFieldValue('reminderClient', 'reminderClientSearch', presetClientId);
}

async function saveNewReminder(){
  const clientId = document.getElementById('reminderClient').value;
  const question = document.getElementById('reminderQuestion').value.trim();
  const followUpDate = document.getElementById('reminderFollowUpDate').value;
  const addToCalendar = document.getElementById('reminderAddToCalendarInput')?.checked;
  if(!clientId){ showToast('error','Pick a client','Select which client this is about.'); return; }
  if(!question){ showToast('error','Nothing to track','Write the question or request first.'); return; }
  if(!followUpDate){ showToast('error','Follow-up date required','Pick a date to be reminded.'); return; }
  if(followUpDate < toDateStr(new Date())){ showToast('error','Date is in the past','Pick today or a future date.'); return; }
  const btn = clickedBtn();
  setBtnLoading(btn, 'Saving…');
  const { data, error } = await supabaseClient.from('client_reminders').insert({
    client_id: clientId, question, asked_by: currentUser.id, follow_up_date: followUpDate, status: 'waiting'
  }).select().single();
  restoreBtn(btn);
  if(error){ showToast('error','Save failed', error.message); return; }
  await loadClientReminders();
  renderReminders();
  closeAppModal();
  showToast('success','Reminder created', `You'll be notified on ${reminderFollowUpLabel(followUpDate)}.`);
  const c = clients.find(x=>x.id===clientId);
  if(c) logClientActivity(clientId, 'reminder_created', `${myName()||'Someone'} logged a question for ${c.name}: "${question.length>80?question.slice(0,80)+'…':question}" — following up ${reminderFollowUpLabel(followUpDate)}.`);
  if(addToCalendar && data) await addReminderToCalendar(data.id);
}

// Click-through detail view for a reminder card — mirrors
// openTaskDetailModal()'s pattern of a read/edit modal reachable by
// clicking the card itself, not just the 3-dot menu.
function openReminderDetailModal(id){
  const r = clientReminders.find(x=>x.id===id);
  if(!r) return;
  const c = clients.find(x=>x.id===r.clientId);
  const owner = teamProfiles.find(p=>p.id===r.askedBy);
  const display = reminderDisplayStatus(r);
  const meta = REMINDER_STATUS_META[display];
  const isResolved = display==='answered' || display==='closed';

  openAppModal(`
    <div class="modal-head"><span class="panel-title">Client follow-up</span><span class="toast-close" onclick="closeAppModal()">✕</span></div>
    <div class="modal-body">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        <span class="rating-pill" style="background:${meta.color}18;color:${meta.color};">${meta.icon} ${escapeHtml(meta.label)}</span>
        ${c ? `<span class="row-link" onclick="closeAppModal();openClientDetail('${c.id}');">${escapeHtml(c.name)}</span>` : ''}
      </div>
      <div class="settings-field"><label>Question / request</label><textarea spellcheck="true" id="reminderEditQuestion" rows="3" style="width:100%;resize:vertical;min-height:64px;font-family:inherit;font-size:13px;padding:10px;border-radius:8px;border:1px solid var(--border);">${escapeHtml(r.question)}</textarea></div>
      <div class="form-grid">
        <div><label>Asked by</label><div style="font-size:13px;padding:9px 0;">${owner ? escapeHtml(owner.name) : '—'} · ${new Date(r.askedDate+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}</div></div>
        <div style="position:relative;"><label>Follow-up date</label>${datePickerFieldHtml('reminderEditFollowUp', { value: r.followUpDate||'', minDate: toDateStr(new Date()), disabled: isResolved })}</div>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-brand" onclick="saveReminderEdit('${r.id}')">Save changes</button>
      ${!isResolved ? `<button class="btn btn-outline" onclick="markReminderStatus('${r.id}','answered');closeAppModal();">Mark answered</button>` : `<button class="btn btn-outline" onclick="markReminderStatus('${r.id}','waiting');closeAppModal();">Reopen</button>`}
      <button class="btn btn-outline" style="color:var(--red);" onclick="closeAppModal();deleteReminder('${r.id}')">Delete</button>
    </div>`, 480);
}

async function saveReminderEdit(id){
  const question = document.getElementById('reminderEditQuestion').value.trim();
  const followUpEl = document.getElementById('reminderEditFollowUp');
  const followUpDate = followUpEl ? followUpEl.value : undefined;
  if(!question){ showToast('error','Nothing to save','The question can\'t be empty.'); return; }
  const original = clientReminders.find(r=>r.id===id);
  if(followUpDate && followUpDate !== original?.followUpDate && followUpDate < toDateStr(new Date())){
    showToast('error','Date is in the past','Pick today or a future date.'); return;
  }
  const updates = { question };
  if(followUpDate) updates.follow_up_date = followUpDate;
  const { error } = await supabaseClient.from('client_reminders').update(updates).eq('id', id);
  if(error){ showToast('error','Save failed', error.message); return; }
  await loadClientReminders();
  renderReminders();
  closeAppModal();
  showToast('success','Updated','Changes saved.');
}

async function markReminderStatus(id, status){
  const r = clientReminders.find(x=>x.id===id);
  if(!r) return;
  const { error } = await supabaseClient.from('client_reminders').update({
    status, resolved_at: status==='answered' || status==='closed' ? new Date().toISOString() : null
  }).eq('id', id);
  if(error){ showToast('error','Could not update', error.message); return; }
  await loadClientReminders();
  renderReminders();
  showToast('success', status==='answered' ? 'Marked answered' : status==='closed' ? 'Closed' : 'Reopened', '');
  const c = clients.find(x=>x.id===r.clientId);
  const statusLabel = status==='answered' ? 'Answered' : status==='closed' ? 'Closed' : 'Reopened';
  if(c) logClientActivity(r.clientId, 'reminder_resolved', `${myName()||'Someone'} marked "${r.question.length>80?r.question.slice(0,80)+'…':r.question}" as ${statusLabel} for ${c.name}.`);
}

async function deleteReminder(id){
  if(!(await confirmDialog('Delete this reminder? This can\'t be undone.', {confirmLabel:'Delete', destructive:true}))) return;
  const { error } = await supabaseClient.from('client_reminders').delete().eq('id', id);
  if(error){ showToast('error','Delete failed', error.message); return; }
  await supabaseClient.from('calendar_events').delete().eq('related_reminder_id', id);
  await loadClientReminders();
  await loadCalendarEvents();
  renderReminders();
  renderCalendar();
  showToast('success','Reminder deleted','Removed.');
}
