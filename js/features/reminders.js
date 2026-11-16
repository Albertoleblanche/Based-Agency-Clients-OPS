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
  waiting:  { label:'Waiting on Client', icon:'<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm64-88a8,8,0,0,1-8,8H128a8,8,0,0,1-8-8V72a8,8,0,0,1,16,0v48h48A8,8,0,0,1,192,128Z"/></svg>', color:'#A65B05' },
  due:      { label:'Follow-up Due',     icon:'<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M221.8,175.94C216.25,166.38,208,139.33,208,104a80,80,0,1,0-160,0c0,35.34-8.26,62.38-13.81,71.94A16,16,0,0,0,48,200H88.81a40,40,0,0,0,78.38,0H208a16,16,0,0,0,13.8-24.06ZM128,216a24,24,0,0,1-22.62-16h45.24A24,24,0,0,1,128,216ZM48,184c7.7-13.24,16-43.92,16-80a64,64,0,1,1,128,0c0,36.05,8.28,66.73,16,80Z"/></svg>', color:'#3A63C9' },
  answered: { label:'Answered',          icon:'<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M173.66,98.34a8,8,0,0,1,0,11.32l-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35A8,8,0,0,1,173.66,98.34ZM232,128A104,104,0,1,1,128,24,104.11,104.11,0,0,1,232,128Zm-16,0a88,88,0,1,0-88,88A88.1,88.1,0,0,0,216,128Z"/></svg>', color:'#117F3A' },
  closed:   { label:'Closed',            icon:'<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M224,48H32A16,16,0,0,0,16,64V88a16,16,0,0,0,16,16v88a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V104a16,16,0,0,0,16-16V64A16,16,0,0,0,224,48ZM208,192H48V104H208ZM224,88H32V64H224V88ZM96,136a8,8,0,0,1,8-8h48a8,8,0,0,1,0,16H104A8,8,0,0,1,96,136Z"/></svg>', color:'#696F78' },
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
    `<div class="kanban-card-menu-item" onclick="event.stopPropagation();closeKanbanMenus();markReminderStatus('${r.id}','${status}')"><svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M221.66,133.66l-72,72a8,8,0,0,1-11.32-11.32L196.69,136H40a8,8,0,0,1,0-16H196.69L138.34,61.66a8,8,0,0,1,11.32-11.32l72,72A8,8,0,0,1,221.66,133.66Z"/></svg>${escapeHtml(label)}</div>`
  ).join('');
  return moveHtml
    + `<div class="kanban-card-menu-divider"></div>`
    + `<div class="kanban-card-menu-item" onclick="event.stopPropagation();closeKanbanMenus();openNoteModal(null, '${r.clientId}', 'idea')"><svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M229.66,58.34l-32-32a8,8,0,0,0-11.32,0l-96,96A8,8,0,0,0,88,128v32a8,8,0,0,0,8,8h32a8,8,0,0,0,5.66-2.34l96-96A8,8,0,0,0,229.66,58.34ZM124.69,152H104V131.31l64-64L188.69,88ZM200,76.69,179.31,56,192,43.31,212.69,64ZM224,128v80a16,16,0,0,1-16,16H48a16,16,0,0,1-16-16V48A16,16,0,0,1,48,32h80a8,8,0,0,1,0,16H48V208H208V128a8,8,0,0,1,16,0Z"/></svg>Start a note</div>`
    + (display==='due' ? `<div class="kanban-card-menu-item" onclick="event.stopPropagation();closeKanbanMenus();createTaskFromReminder('${r.id}')"><svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M224,48V208a16,16,0,0,1-16,16H136a8,8,0,0,1,0-16h72V48H48v96a8,8,0,0,1-16,0V48A16,16,0,0,1,48,32H208A16,16,0,0,1,224,48ZM125.66,154.34a8,8,0,0,0-11.32,0L64,204.69,45.66,186.34a8,8,0,0,0-11.32,11.32l24,24a8,8,0,0,0,11.32,0l56-56A8,8,0,0,0,125.66,154.34Z"/></svg>+ Task: chase this down</div>` : '')
    + `<div class="kanban-card-menu-item danger" onclick="event.stopPropagation();closeKanbanMenus();deleteReminder('${r.id}')"><svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z"/></svg>Delete</div>`;
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
            <svg width="12" height="12" viewBox="0 0 256 256" fill="currentColor"><path d="M176.49,95.51a12,12,0,0,1,0,17l-56,56a12,12,0,0,1-17,0l-24-24a12,12,0,1,1,17-17L112,143l47.51-47.52A12,12,0,0,1,176.49,95.51ZM236,128A108,108,0,1,1,128,20,108.12,108.12,0,0,1,236,128Zm-24,0a84,84,0,1,0-84,84A84.09,84.09,0,0,0,212,128Z"/></svg>
            ${display==='answered' ? 'Answered' : 'Closed'}
          </span>`
        : `<span class="kanban-card-due" style="${display==='due'?'color:var(--brand-dark);':''}">
            <svg width="11" height="11" viewBox="0 0 256 256" fill="currentColor"><path d="M208,28H188V24a12,12,0,0,0-24,0v4H92V24a12,12,0,0,0-24,0v4H48A20,20,0,0,0,28,48V208a20,20,0,0,0,20,20H208a20,20,0,0,0,20-20V48A20,20,0,0,0,208,28ZM68,52a12,12,0,0,0,24,0h72a12,12,0,0,0,24,0h16V76H52V52ZM52,204V100H204V204Z"/></svg>
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
