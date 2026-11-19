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
  waiting:  { label:'Waiting on Client', icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /> <path d="M12 6v6l4 2" /></svg>', color:'#A65B05' },
  due:      { label:'Follow-up Due',     icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.268 21a2 2 0 0 0 3.464 0" /> <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" /></svg>', color:'#3A63C9' },
  answered: { label:'Answered',          icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /> <path d="m16 9-5.5 5.5L8 12" /></svg>', color:'#117F3A' },
  closed:   { label:'Closed',            icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="5" x="2" y="3" rx="1" /> <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /> <path d="M10 12h4" /></svg>', color:'#696F78' },
};


function updateRemindersNavBadge(){
  const badge = document.getElementById('navRemindersBadge');
  if(!badge) return;
  const dueCount = clientReminders.filter(r=>r.askedBy===currentUser?.id && reminderDisplayStatus(r)==='due').length;
  badge.textContent = dueCount;
  badge.style.display = dueCount ? 'flex' : 'none';
}

// Grouped lists, most urgent first — like Apple's Reminders: due
// follow-ups, then questions still waiting on the client, then the ones
// answered or closed. The circle marks a question answered in one click.
const REMINDER_SECTIONS = [['due','Due'],['waiting','Waiting on the client'],['answered','Answered'],['closed','Closed']];

function renderReminders(){
  const board = document.getElementById('remindersBoard');
  if(!board) return;

  const visible = clientReminders.filter(r=>r.askedBy===currentUser?.id);
  if(!visible.length){
    board.innerHTML = `<div class="cd-grp">${emptyStateHtml(REMINDER_STATUS_META.waiting.icon.replace(/width="14" height="14"/,'width="20" height="20"'),
      'No follow-ups yet', 'When you ask a client something, add it here so the team knows you’re waiting on an answer.',
      '<button class="btn btn-brand" onclick="openNewReminderModal()">New Reminder</button>')}</div>`;
    return;
  }
  board.innerHTML = REMINDER_SECTIONS.map(([key, title])=>{
    const rows = visible.filter(r=>reminderDisplayStatus(r)===key)
      .sort((a,b)=> key==='answered' || key==='closed'
        ? (b.resolvedAt||'').localeCompare(a.resolvedAt||'')
        : (a.followUpDate||'').localeCompare(b.followUpDate||''));
    if(!rows.length && key!=='waiting') return '';
    return `<div class="cd-h2"><h2>${escapeHtml(title)}<span class="t-c">${rows.length}</span></h2>${key==='waiting' ? `<span class="row-link" onclick="openNewReminderModal()">New Reminder</span>` : ''}</div>
      <div class="cd-grp">${rows.length ? rows.map(reminderRowHtml).join('') : `<p class="rem-empty">Nothing waiting on a client right now.</p>`}</div>`;
  }).join('');
}

function reminderRowHtml(r){
  const c = clients.find(x=>x.id===r.clientId);
  const display = reminderDisplayStatus(r);
  const resolved = display==='answered' || display==='closed';
  const asked = r.askedDate ? new Date(r.askedDate+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '';
  const when = resolved ? (display==='answered' ? 'Answered' : 'Closed') : `Follow up ${reminderFollowUpLabel(r.followUpDate)}`;
  const circle = resolved
    ? `<span class="rem-cb done" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg></span>`
    : `<button type="button" class="rem-cb" title="Mark answered" aria-label="Mark answered" onclick="event.stopPropagation();markReminderStatus('${r.id}','answered')"></button>`;
  return `<div class="rem-row${resolved ? ' done' : ''}" role="button" tabindex="0" onclick="openReminderDetailModal('${r.id}')">
    ${circle}
    <div class="rem-tx"><span class="rem-t">${escapeHtml(r.question)}</span><span class="rem-s">${c ? escapeHtml(c.name) : 'Unknown client'}${asked ? ` · asked ${escapeHtml(asked)}` : ''}</span></div>
    <div class="rem-r"><span class="${display==='due' ? 'rem-due' : ''}">${escapeHtml(when)}</span>
      <div class="kanban-card-menu-wrap" onclick="event.stopPropagation()">
        <span class="kanban-card-menu-btn" onclick="toggleKanbanCardMenu('reminder-${r.id}')">⋯</span>
        <div class="kanban-card-menu" id="kanbanMenu-reminder-${r.id}" style="display:none;">${reminderCardMenuHtml(r)}</div>
      </div></div></div>`;
}

function reminderCardMenuHtml(r){
  const display = reminderDisplayStatus(r);
  const moveOptions = [];
  if(display!=='answered') moveOptions.push(['answered','Mark answered']);
  if(display!=='closed') moveOptions.push(['closed','Close']);
  if(display==='answered' || display==='closed') moveOptions.push(['waiting','Reopen']);
  const moveHtml = moveOptions.map(([status,label])=>
    `<div class="kanban-card-menu-item" onclick="event.stopPropagation();closeKanbanMenus();markReminderStatus('${r.id}','${status}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14" /> <path d="m12 5 7 7-7 7" /></svg>${escapeHtml(label)}</div>`
  ).join('');
  return moveHtml
    + `<div class="kanban-card-menu-divider"></div>`
    + `<div class="kanban-card-menu-item" onclick="event.stopPropagation();closeKanbanMenus();openNoteModal(null, '${r.clientId}', 'idea')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /> <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" /></svg>Start a note</div>`
    + (display==='due' ? `<div class="kanban-card-menu-item" onclick="event.stopPropagation();closeKanbanMenus();createTaskFromReminder('${r.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 5h8" /> <path d="M13 12h8" /> <path d="M13 19h8" /> <path d="m3 17 2 2 4-4" /> <rect x="3" y="4" width="6" height="6" rx="1" /></svg>+ Task: chase this down</div>` : '')
    + `<div class="kanban-card-menu-item danger" onclick="event.stopPropagation();closeKanbanMenus();deleteReminder('${r.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 11v6" /> <path d="M14 11v6" /> <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /> <path d="M3 6h18" /> <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>Delete</div>`;
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
      <label style="display:flex;align-items:center;gap:8px;font-size:13.5px;color:var(--ink);cursor:pointer;margin-top:2px;"><input type="checkbox" id="reminderAddToCalendarInput" checked> Add to calendar</label>
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
      <div class="settings-field"><label>Question / request</label><textarea spellcheck="true" id="reminderEditQuestion" rows="3" style="width:100%;resize:vertical;min-height:64px;font-family:inherit;font-size:14px;padding:10px;border-radius:8px;border:1px solid var(--border);">${escapeHtml(r.question)}</textarea></div>
      <div class="form-grid">
        <div><label>Asked by</label><div style="font-size:14px;padding:9px 0;">${owner ? escapeHtml(owner.name) : '—'} · ${new Date(r.askedDate+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}</div></div>
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
