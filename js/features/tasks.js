// Tasks: assign/track work between teammates, kanban, task archive.

/* ---------- Tasks — private between assigner and assignee only ---------- */

let tasks = [];
let tasksDataLoaded = false;
// RLS already restricts this to rows where I'm the assigner or assignee —
// nobody else on the team can ever see a task they're not part of, admins
// included.
async function loadMyTasks(){
  if(!currentUser){ tasks = []; tasksDataLoaded = true; return; }
  const { data, error } = await supabaseClient.from('tasks').select('*').order('created_at', { ascending:false });
  if(error){ console.error('loadMyTasks error', error); tasks = []; tasksDataLoaded = true; return; }
  tasks = (data||[]).map(t=>({
    id:t.id, title:t.title, description:t.description||'', priority:t.priority, status:t.status,
    assignerId:t.assigner_id, assigneeId:t.assignee_id, clientId:t.client_id, dueDate:t.due_date, link:t.link,
    createdAt:t.created_at, completedAt:t.completed_at, cancelledAt:t.cancelled_at,
    hiddenByAssigner:t.hidden_by_assigner, hiddenByAssignee:t.hidden_by_assignee,
    assigneeNotified:t.assignee_notified, assignerNotified:t.assigner_notified,
    attachments:t.attachments||[], completionNotes:t.completion_notes||'', completionLink:t.completion_link||'',
    color:t.color||null, sprintId:t.sprint_id||null
  }));
  tasksDataLoaded = true;
  if(typeof renderDashboard === 'function') renderDashboard();
}

const TASK_PRIORITY_META = {
  high:   { label:'High',   color:'#CF2424',   order:0 },
  medium: { label:'Medium', color:'#A65B05', order:1 },
  low:    { label:'Low',    color:'#7C93B0', order:2 },
};

const KANBAN_STAGES = [
  { key:'todo',        label:'To Do',      color:'#7C93B0', icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /></svg>' },
  { key:'in_progress',  label:'On Process', color:'#C99A55', icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 9.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997A1 1 0 0 1 9 14.996z" /> <circle cx="12" cy="12" r="10" /></svg>' },
  { key:'in_review',    label:'On Review',  color:'#C17A6E', icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /> <circle cx="12" cy="12" r="3" /></svg>' },
  { key:'done',         label:'Completed',  color:'#117F3A', icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /> <path d="m16 9-5.5 5.5L8 12" /></svg>' },
];

let newTaskPresetStatus = 'todo';
let taskDirectionTab = 'all';

function switchTaskDirectionTab(dir){
  taskDirectionTab = dir;
  document.querySelectorAll('#taskDirectionTabs .icon-tab').forEach(t=>t.classList.toggle('active', t.dataset.tdir===dir));
  renderTasks();
}

function updateTasksNavBadge(){
  const badge = document.getElementById('navTasksBadge');
  if(!badge || !currentUser) return;
  // a sprint's steps are in Plan, not Tasks (Nov 27), so they aren't counted here
  const mine = tasks.filter(t=> t.status!=='done' && !t.cancelledAt && t.assigneeId===currentUser.id && !(typeof tkInPlan === 'function' && tkInPlan(t)));
  const open = typeof sprintFold === 'function' ? sprintFold(mine).list.length : mine.length;
  badge.textContent = open;
  badge.style.display = open ? '' : 'none';   // the stylesheet lays out the count circle
}

function renderTasks(){
  const board = document.getElementById('kanbanBoard');
  if(!board || !currentUser) return;
  if(!tasksDataLoaded){ board.innerHTML = loadingStateHtml('Loading tasks…'); return; }

  const visible = tasks.filter(t=>{
    if(t.cancelledAt) return false;
    const amAssigner = t.assignerId===currentUser.id;
    const amAssignee = t.assigneeId===currentUser.id;
    // This board is personal to whoever's looking at it — always, even
    // for admin/approver, whose tasks array can otherwise legitimately
    // contain everyone's tasks (needed for the Task Archive's separate
    // "Whole Team" view). Without this, an admin/approver would see the
    // whole team's tasks bleed into their own personal kanban board.
    if(!amAssigner && !amAssignee) return false;
    // Per-user hide only applies once a task reaches Completed — clearing
    // it from your board there doesn't affect the other person's view.
    if(t.status==='done'){
      if(amAssigner && t.hiddenByAssigner) return false;
      if(amAssignee && t.hiddenByAssignee) return false;
    }
    if(taskDirectionTab==='tome' && !amAssignee) return false;
    if(taskDirectionTab==='byme' && !amAssigner) return false;
    return true;
  });

  board.innerHTML = KANBAN_STAGES.map(stage=>{
    const stageTasks = visible.filter(t=>t.status===stage.key).sort((a,b)=>{
      const pDiff = (TASK_PRIORITY_META[a.priority]?.order ?? 9) - (TASK_PRIORITY_META[b.priority]?.order ?? 9);
      if(pDiff!==0) return pDiff;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
    return `<div class="kanban-column">
      <div class="kanban-column-head" style="background:${stage.color}22;border:1px solid ${stage.color}66;">
        <span class="kanban-column-icon" style="color:${stage.color};">${stage.icon}</span>
        <span class="kanban-column-title">${escapeHtml(stage.label)}</span>
        <span class="kanban-column-count">${stageTasks.length}</span>
        <button class="kanban-add-btn" onclick="openNewTaskModal(undefined,'${stage.key}')" title="New task in ${escapeHtml(stage.label)}">+</button>
      </div>
      <div class="kanban-cards">
        ${stageTasks.length ? stageTasks.map(t=>kanbanCardHtml(t)).join('') : `<div class="empty" style="padding:18px 8px;font-size:12.5px;">Nothing here yet.</div>`}
      </div>
    </div>`;
  }).join('');
}

function kanbanCardMenuHtml(t){
  const amAssigner = t.assignerId===currentUser.id;
  const amAssignee = t.assigneeId===currentUser.id;
  // Available regardless of status or role — logging time against a task
  // isn't limited to whoever assigned or was assigned it.
  const logTimeItem = `<div class="kanban-card-menu-item" onclick="event.stopPropagation();closeKanbanMenus();openManualEntryFromTask('${t.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /> <path d="M12 6v6l4 2" /></svg>Log time</div>`;

  // Once a task is Completed, it's locked — the only things left to do are
  // file it away or remove it, not move it around or edit it further.
  if(t.status==='done'){
    return `${logTimeItem}<div class="kanban-card-menu-item" onclick="event.stopPropagation();closeKanbanMenus();hideTaskFromMyList('${t.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="5" x="2" y="3" rx="1" /> <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /> <path d="M10 12h4" /></svg>Archive</div>
      ${hasPermission('delete_tasks') ? `<div class="kanban-card-menu-item danger" onclick="event.stopPropagation();closeKanbanMenus();deleteTaskPermanently('${t.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 11v6" /> <path d="M14 11v6" /> <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /> <path d="M3 6h18" /> <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>Delete</div>` : ''}`;
  }

  const moveOptions = KANBAN_STAGES.filter(s=>s.key!==t.status).map(s=>{
    if(s.key==='done' && !amAssignee) return ''; // only the assignee confirms completion
    return `<div class="kanban-card-menu-item" onclick="event.stopPropagation();moveTaskToStatus('${t.id}','${s.key}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14" /> <path d="m12 5 7 7-7 7" /></svg>Move to ${escapeHtml(s.label)}</div>`;
  }).join('');
  let extra = '';
  if(amAssigner){
    extra += `<div class="kanban-card-menu-divider"></div>`;
    extra += `<div class="kanban-card-menu-item" onclick="event.stopPropagation();closeKanbanMenus();openEditTaskModal('${t.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /> <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" /></svg>Edit</div>`;
    extra += `<div class="kanban-card-menu-item danger" onclick="event.stopPropagation();closeKanbanMenus();cancelTask('${t.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /> <path d="m15 9-6 6" /> <path d="m9 9 6 6" /></svg>Cancel task</div>`;
  }
  return logTimeItem + moveOptions + extra;
}

function toggleKanbanCardMenu(taskId){
  const wasOpen = document.getElementById('kanbanMenu-'+taskId)?.style.display === 'block';
  closeKanbanMenus();
  if(!wasOpen){
    const menu = document.getElementById('kanbanMenu-'+taskId);
    if(menu) menu.style.display = 'block';
  }
}

function closeKanbanMenus(){
  document.querySelectorAll('.kanban-card-menu').forEach(m=>{
    m.style.display='none';
    // a right-click opens the menu at the pointer (desktop-app.js); put it
    // back next to its ⋯ button for the next normal open
    if(m.classList.contains('ctx-at-pointer')){
      m.classList.remove('ctx-at-pointer');
      ['position','left','top','right','bottom','transformOrigin','animation'].forEach(k=>{ m.style[k]=''; });
    }
  });
}

document.addEventListener('click', (e)=>{
  if(!e.target.closest('.kanban-card-menu-wrap')) closeKanbanMenus();
});

function kanbanCardHtml(t){
  const amAssigner = t.assignerId===currentUser.id;
  const assigner = teamProfiles.find(p=>p.id===t.assignerId);
  const assignee = teamProfiles.find(p=>p.id===t.assigneeId);
  const pMeta = TASK_PRIORITY_META[t.priority] || TASK_PRIORITY_META.medium;
  const c = t.clientId ? clients.find(x=>x.id===t.clientId) : null;
  const dueStr = t.dueDate ? new Date(t.dueDate+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '';
  const overdue = t.status!=='done' && t.dueDate && new Date(t.dueDate+'T00:00:00') < new Date(new Date().toDateString());

  return `<div class="kanban-card" onclick="openTaskDetailModal('${t.id}')">
    <div class="kanban-card-top">
      ${t.status==='done' ? `
      <span class="kanban-card-due" style="color:var(--green);font-weight:700;">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /> <path d="m16 9-5.5 5.5L8 12" /></svg>
        Completed${t.completedAt ? ` ${new Date(t.completedAt).toLocaleDateString('en-US',{month:'short',day:'numeric'})}` : ''}
      </span>` : `
      <span class="kanban-card-due" style="${overdue?'color:var(--red);':''}">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /> <path d="M12 6v6l4 2" /></svg>
        ${overdue ? 'Overdue' : dueStr ? `Due ${dueStr}` : 'No due date'}
      </span>`}
      <div class="kanban-card-menu-wrap">
        <span class="kanban-card-menu-btn" onclick="event.stopPropagation();toggleKanbanCardMenu('${t.id}')">⋯</span>
        <div class="kanban-card-menu" id="kanbanMenu-${t.id}" style="display:none;">${kanbanCardMenuHtml(t)}</div>
      </div>
    </div>
    <div class="kanban-card-title">${escapeHtml(t.title)}</div>
    ${t.description ? `<div class="kanban-card-desc">${escapeHtml(t.description)}</div>` : ''}
    ${c ? `<div class="kanban-card-client">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12h.01" /> <path d="M16 6V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /> <path d="M22 13a18.15 18.15 0 0 1-20 0" /> <rect width="20" height="14" x="2" y="6" rx="2" /></svg>
      ${escapeHtml(c.name)}
    </div>` : ''}
    <div class="kanban-card-assigned-label">Assigned for</div>
    <div class="kanban-card-avatars">
      ${personAvatarHtml(t.assignerId)}${t.assigneeId!==t.assignerId ? personAvatarHtml(t.assigneeId) : ''}
    </div>
    <div class="kanban-card-footer">
      <span class="kanban-priority-flag" style="background:${pMeta.color}18;color:${pMeta.color};">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528" /></svg>
        ${escapeHtml(pMeta.label)}
      </span>
      <button type="button" class="kanban-card-logtime-btn" onclick="event.stopPropagation();openManualEntryFromTask('${t.id}')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /> <path d="M12 6v6l4 2" /></svg>
        Log time
      </button>
    </div>
  </div>`;
}

function openTaskDetailModal(taskId){
  const t = tasks.find(x=>x.id===taskId);
  if(!t) return;
  const amAssigner = t.assignerId===currentUser.id;
  const assigner = teamProfiles.find(p=>p.id===t.assignerId);
  const assignee = teamProfiles.find(p=>p.id===t.assigneeId);
  const pMeta = TASK_PRIORITY_META[t.priority] || TASK_PRIORITY_META.medium;
  const c = t.clientId ? clients.find(x=>x.id===t.clientId) : null;
  const dueStr = t.dueDate ? new Date(t.dueDate+'T00:00:00').toLocaleDateString('en-US',{weekday:'long', month:'long', day:'numeric'}) : '';
  const overdue = t.status!=='done' && t.dueDate && new Date(t.dueDate+'T00:00:00') < new Date(new Date().toDateString());
  const amAssignee = t.assigneeId===currentUser.id;
  const directionLabel = amAssigner
    ? `Assigned to ${assignee ? assignee.name : 'someone no longer on the team'}`
    : `From ${assigner ? assigner.name : 'someone no longer on the team'}`;
  const stageMeta = KANBAN_STAGES.find(s=>s.key===t.status) || KANBAN_STAGES[0];
  const linkedEvent = calendarEvents.find(e=>e.relatedTaskId===t.id);

  let moveOptionsHtml = KANBAN_STAGES.filter(s=>s.key!==t.status).map(s=>{
    if(s.key==='done' && !amAssignee) return '';
    return `<option value="${s.key}">Move to ${escapeHtml(s.label)}</option>`;
  }).join('');

  openAppModal(`
    <div class="modal-head">
      <div>
        <span class="pill" style="background:${pMeta.color}18;color:${pMeta.color};font-weight:700;margin-right:8px;">${escapeHtml(pMeta.label)} priority</span>
        <span class="pill" style="background:${stageMeta.color}18;color:${stageMeta.color};font-weight:700;">${overdue ? 'Overdue' : escapeHtml(stageMeta.label)}</span>
      </div>
      <span class="toast-close" onclick="closeAppModal()">✕</span>
    </div>
    <div class="modal-body">
      <div class="q-name" style="margin-bottom:10px;">${escapeHtml(t.title)}</div>
      ${t.description ? `<div style="font-size:14px;color:var(--ink);line-height:1.6;white-space:pre-wrap;overflow-wrap:break-word;word-break:break-word;margin-bottom:14px;">${escapeHtml(t.description)}</div>` : `<div style="font-size:13.5px;color:var(--muted-lt);margin-bottom:14px;">No description added.</div>`}
      <div class="form-grid" style="margin-bottom:6px;">
        <div><label style="font-family:var(--font);font-size:10.5px;color:var(--muted-lt);display:block;margin-bottom:4px;">Direction</label><div style="font-size:14px;">${directionLabel}</div></div>
        ${dueStr ? `<div><label style="font-family:var(--font);font-size:10.5px;color:var(--muted-lt);display:block;margin-bottom:4px;">Due</label><div style="font-size:14px;${overdue?'color:var(--red);font-weight:700;':''}">${dueStr}</div></div>` : ''}
        ${c ? `<div><label style="font-family:var(--font);font-size:10.5px;color:var(--muted-lt);display:block;margin-bottom:4px;">Related client</label><div style="font-size:14px;"><span class="row-link" onclick="closeAppModal(); openClientDetail('${c.id}');">${escapeHtml(c.name)}</span></div></div>` : ''}
        ${t.status==='done' && t.completedAt ? `<div><label style="font-family:var(--font);font-size:10.5px;color:var(--muted-lt);display:block;margin-bottom:4px;">Completed</label><div style="font-size:14px;">${new Date(t.completedAt).toLocaleDateString('en-US',{month:'long',day:'numeric'})}</div></div>` : ''}
      </div>
      ${t.link ? `<a href="${safeUrl(normalizeUrl(t.link))}" target="_blank" rel="noopener" class="note-link" style="display:block;margin-top:8px;">🔗 ${truncateLinkDisplay(t.link, 50)}</a>` : ''}
      ${t.status==='done' && (t.completionNotes || t.completionLink) ? `
        <div style="margin-top:14px;padding:12px;border-radius:8px;background:var(--surface-2);">
          <div style="font-family:var(--font);font-size:10.5px;color:var(--muted-lt);letter-spacing:.04em;margin-bottom:6px;">FROM ${escapeHtml(teamProfiles.find(p=>p.id===t.assigneeId)?.name || 'the assignee')} ON COMPLETION</div>
          ${t.completionNotes ? `<div style="font-size:14px;color:var(--ink);line-height:1.5;white-space:pre-wrap;">${escapeHtml(t.completionNotes)}</div>` : ''}
          ${t.completionLink ? `<a href="${safeUrl(normalizeUrl(t.completionLink))}" target="_blank" rel="noopener" class="note-link" style="display:block;margin-top:${t.completionNotes?'8px':'0'};">🔗 ${truncateLinkDisplay(t.completionLink, 50)}</a>` : ''}
        </div>` : ''}
      ${t.dueDate ? (linkedEvent
        ? `<div style="margin-top:14px;font-size:13.5px;color:var(--green);font-weight:600;">✓ On the calendar — <span class="row-link" onclick="closeAppModal();switchView('calendar');jumpToCalendarDate('${t.dueDate}');">view it</span></div>`
        : `<button class="btn btn-outline" style="margin-top:14px;" onclick="addTaskToCalendar('${t.id}')">+ Add to calendar</button>`) : ''}
    </div>
    <div class="modal-actions" style="justify-content:space-between;align-items:center;">
      <div>
        ${moveOptionsHtml && t.status!=='done' ? `<select onchange="if(this.value) moveTaskToStatus('${t.id}', this.value);" style="font-family:var(--font);font-size:13.5px;padding:9px 30px 9px 12px;border-radius:var(--radius-sm);border:1px solid var(--border);background-color:var(--surface-2);color:var(--ink);cursor:pointer;">
          <option value="">Move to…</option>
          ${moveOptionsHtml}
        </select>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:16px;">
        ${t.status==='done' ? `
          <span class="row-link" onclick="hideTaskFromMyList('${t.id}')">Archive</span>
          ${hasPermission('delete_tasks') ? `<span class="event-delete-link" onclick="deleteTaskPermanently('${t.id}')">Delete</span>` : ''}
        ` : `
          ${amAssigner ? `<span class="event-delete-link" onclick="cancelTask('${t.id}')">Cancel task</span>` : ''}
          ${amAssigner ? `<button class="btn btn-brand" onclick="openEditTaskModal('${t.id}')">Edit</button>` : ''}
        `}
      </div>
    </div>`, 500);
}


function populateTaskAssigneeSelect(selectedId){
  const options = [...teamProfiles].sort((a,b)=>a.name.localeCompare(b.name))
    .map(p=>`<option value="${p.id}" ${p.id===selectedId?'selected':''}>${escapeHtml(p.name)}${p.id===currentUser.id?' (you)':''}</option>`).join('');
  return options;
}

function populateTaskClientSelect(selectedId){
  const options = `<option value="">No related client</option>` + workClients(selectedId).sort((a,b)=>a.name.localeCompare(b.name))
    .map(c=>`<option value="${c.id}" ${c.id===selectedId?'selected':''}>${escapeHtml(c.name)}</option>`).join('');
  return options;
}

// Blocks pasting a link straight into the task description — there's a
// dedicated Link field right below it for that. Only intercepts the paste
// when the clipboard content actually looks like a URL; ordinary prose
// (even text that happens to include a period) pastes through normally.
function handleTaskDescPaste(event){
  const pasted = (event.clipboardData || window.clipboardData)?.getData('text') || '';
  if(containsUrl(pasted)){
    event.preventDefault();
    showToast('error','Links go in the Link field', 'Paste it in the "Link" field below instead — the description is for plain text.');
  }
}

function taskFormHtml(editing, presetAssigneeId, presetContext){
  const presetTitle = !editing && presetContext?.title ? presetContext.title.replace(/"/g,'&quot;') : '';
  const presetDesc = !editing && presetContext?.description ? presetContext.description : '';
  return `
    <div class="modal-head"><span class="panel-title">${editing ? 'Edit task' : 'New task'}</span><span class="toast-close" onclick="closeAppModal()">✕</span></div>
    <div class="modal-body">
      <div class="settings-field"><label>Title</label><input id="taskTitleInput" spellcheck="true" placeholder="e.g. Update the roofing page copy" value="${editing ? escapeHtml(editing.title) : presetTitle}" style="width:100%;"></div>
      <div class="settings-field"><label>Description (optional)</label><textarea spellcheck="true" id="taskDescInput" onpaste="handleTaskDescPaste(event)" style="width:100%;min-height:80px;font-family:var(--font);font-size:14px;padding:10px;border-radius:8px;border:1px solid var(--border);overflow-wrap:break-word;word-break:break-word;">${editing ? escapeHtml(editing.description) : escapeHtml(presetDesc)}</textarea></div>
      <div class="form-grid">
        <div><label>Assign to</label><select id="taskAssigneeSelect">${populateTaskAssigneeSelect(editing ? editing.assigneeId : (presetAssigneeId || currentUser.id))}</select></div>
        <div><label>Priority</label>
          <select id="taskPrioritySelect">
            <option value="low" ${editing && editing.priority==='low'?'selected':''}>Low</option>
            <option value="medium" ${(!editing || editing.priority==='medium')?'selected':''}>Medium</option>
            <option value="high" ${editing && editing.priority==='high'?'selected':''}>High</option>
          </select>
        </div>
        <div style="position:relative;"><label>Due date (optional)</label>${datePickerFieldHtml('taskDueInput', { value: editing && editing.dueDate ? editing.dueDate : '', minDate: toDateStr(new Date()) })}</div>
        <div><label>Related client (optional)</label><select id="taskClientSelect">${populateTaskClientSelect(editing ? editing.clientId : (presetContext?.clientId || null))}</select></div>
      </div>
      <div class="settings-field"><label>Link (optional)</label><input id="taskLinkInput" type="url" placeholder="https://…" value="${editing && editing.link ? escapeHtml(editing.link) : ''}" style="width:100%;"></div>
      ${!editing ? `<label style="display:flex;align-items:center;gap:8px;font-size:13.5px;color:var(--ink);cursor:pointer;margin-top:2px;"><input type="checkbox" id="taskAddToCalendarInput"> Add to calendar (needs a due date)</label>` : ''}
    </div>
    <div class="modal-actions">
      <button class="btn btn-brand" onclick="${editing ? `saveEditTask('${editing.id}')` : 'saveNewTask()'}">${editing ? 'Save changes' : 'Assign task'}</button>
      <button class="btn btn-outline" onclick="closeAppModal()">Cancel</button>
    </div>`;
}

function openNewTaskModal(presetAssigneeId, presetStatus, presetContext){
  if(!teamProfiles.length){ showToast('error','No team members','Add team members in Team before assigning tasks.'); return; }
  newTaskPresetStatus = presetStatus || 'todo';
  openAppModal(taskFormHtml(null, presetAssigneeId, presetContext), 480);
}

function openEditTaskModal(taskId){
  const t = tasks.find(x=>x.id===taskId);
  if(!t) return;
  if(t.assignerId!==currentUser.id){ showToast('error','Not allowed','Only the person who assigned this task can edit it.'); return; }
  openAppModal(taskFormHtml(t), 480);
}

async function saveNewTask(){
  const title = document.getElementById('taskTitleInput').value.trim();
  if(!title){ showToast('error','Title required','Give the task a title first.'); return; }
  const assigneeId = document.getElementById('taskAssigneeSelect').value;
  const priority = document.getElementById('taskPrioritySelect').value;
  const description = document.getElementById('taskDescInput').value.trim();
  if(containsUrl(description)){ showToast('error','No links in the description', 'Move the link to the "Link" field below and try again.'); return; }
  const dueDate = document.getElementById('taskDueInput').value || null;
  if(dueDate && dueDate < toDateStr(new Date())){ showToast('error','Date is in the past','Pick today or a future date.'); return; }
  const clientId = document.getElementById('taskClientSelect').value || null;
  if(clientId && isClientPaused(clientId)){ showPausedClientWarning(clientId); return; }
  const link = normalizeUrl(document.getElementById('taskLinkInput').value) || null;
  const addToCalendarInput = document.getElementById('taskAddToCalendarInput');
  const addToCalendar = addToCalendarInput ? addToCalendarInput.checked : false;
  if(addToCalendar && !dueDate){ showToast('error','Due date required','Set a due date first, or uncheck "Add to calendar".'); return; }
  if(addToCalendar && dueDate < toDateStr(new Date())){ showToast('error','That date has already passed','Pick a future due date.'); return; }

  const { data, error } = await supabaseClient.from('tasks').insert({
    title, description, priority, assigner_id: currentUser.id, assignee_id: assigneeId,
    client_id: clientId, due_date: dueDate, link, status: newTaskPresetStatus
  }).select().single();
  newTaskPresetStatus = 'todo';
  const assignee = teamProfiles.find(p=>p.id===assigneeId);
  if(!error && data){
    closeAppModal();
    showToast('success','Task assigned', assigneeId===currentUser.id ? 'Added to your tasks.' : `${assignee ? assignee.name : 'They'} will be notified.`);
    await loadMyTasks();
    renderTasks();
    updateTasksNavBadge();
    if(addToCalendar) await addTaskToCalendar(data.id);
    if(assigneeId !== currentUser.id){
      sendNotification(assigneeId, 'task_assigned', 'New task assigned to you', `${myName()||'Someone'}: "${title}"`, 'tasks', data.id);
    }
  } else {
    closeAppModal();
    showToast('error','Save failed', error?.message || 'Unknown error');
  }
}

async function saveEditTask(taskId){
  const t = tasks.find(x=>x.id===taskId);
  if(!t || t.assignerId!==currentUser.id) return;
  const title = document.getElementById('taskTitleInput').value.trim();
  if(!title){ showToast('error','Title required','Give the task a title first.'); return; }
  const assigneeId = document.getElementById('taskAssigneeSelect').value;
  const priority = document.getElementById('taskPrioritySelect').value;
  const description = document.getElementById('taskDescInput').value.trim();
  if(containsUrl(description)){ showToast('error','No links in the description', 'Move the link to the "Link" field below and try again.'); return; }
  const dueDate = document.getElementById('taskDueInput').value || null;
  if(dueDate && dueDate !== t.dueDate && dueDate < toDateStr(new Date())){ showToast('error','Date is in the past','Pick today or a future date.'); return; }
  const clientId = document.getElementById('taskClientSelect').value || null;
  const link = normalizeUrl(document.getElementById('taskLinkInput').value) || null;

  // Reassigning to someone new means they haven't been notified yet.
  const reassigned = assigneeId !== t.assigneeId;
  const { error } = await supabaseClient.from('tasks').update({
    title, description, priority, assignee_id: assigneeId, client_id: clientId, due_date: dueDate, link,
    assignee_notified: reassigned ? false : t.assigneeNotified
  }).eq('id', taskId);
  closeAppModal();
  await loadMyTasks();
  renderTasks();
  error ? showToast('error','Save failed', error.message) : showToast('success','Task updated','Changes saved.');
  if(!error && !reassigned && assigneeId !== currentUser.id){
    sendNotification(assigneeId, 'task_edited', 'Task updated', `${myName()||'Someone'} updated "${title}".`, 'tasks', taskId);
  }
}

let taskArchiveScope = 'mine';

function switchTaskArchiveScope(scope){
  if(scope==='team' && !canApprove()) scope = 'mine'; // defense in depth — the tab itself is already hidden for non-approvers
  taskArchiveScope = scope;
  document.querySelectorAll('#taskArchiveScopeTabs .icon-tab').forEach(t=>t.classList.toggle('active', t.dataset.scope===scope));
  const memberWrap = document.getElementById('taskArchiveMemberFilterWrap');
  if(memberWrap) memberWrap.style.display = scope==='team' ? 'flex' : 'none';
  renderTaskArchive();
}

function clearTaskArchiveFilters(){
  document.getElementById('taskArchiveSearch').value = '';
  document.getElementById('taskArchiveClientFilter').value = 'all';
  const memberEl = document.getElementById('taskArchiveMemberFilter');
  if(memberEl) memberEl.value = 'all';
  document.getElementById('taskArchiveFromDate').value = '';
  document.getElementById('taskArchiveToDate').value = '';
  renderTaskArchive();
}

// Populates the client/member filter dropdowns and reveals the "Whole
// Team" scope tab for admin/approver — called once each time the page is
// navigated to, since teamProfiles/clients could have changed since the
// last visit.
function populateTaskArchiveFilters(){
  const teamTab = document.getElementById('taskArchiveTeamScopeTab');
  if(teamTab) teamTab.style.display = canApprove() ? 'flex' : 'none';
  if(!canApprove() && taskArchiveScope==='team') switchTaskArchiveScope('mine');

  const clientSel = document.getElementById('taskArchiveClientFilter');
  if(clientSel){
    const current = clientSel.value;
    const clientsWithDoneTasks = new Set(tasks.filter(t=>t.status==='done' && t.clientId).map(t=>t.clientId));
    const opts = [...clients].filter(c=>clientsWithDoneTasks.has(c.id)).sort((a,b)=>a.name.localeCompare(b.name))
      .map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    clientSel.innerHTML = `<option value="all">All clients</option>${opts}`;
    clientSel.value = current || 'all';
  }
  const memberSel = document.getElementById('taskArchiveMemberFilter');
  if(memberSel){
    const current = memberSel.value;
    const opts = [...teamProfiles].sort((a,b)=>a.name.localeCompare(b.name))
      .map(p=>`<option value="${p.id}">${escapeHtml(p.name)}${p.id===currentUser.id?' (you)':''}</option>`).join('');
    memberSel.innerHTML = `<option value="all">Everyone</option>${opts}`;
    memberSel.value = current || 'all';
  }
}

function renderTaskArchive(){
  const tbody = document.getElementById('taskArchiveTableBody');
  if(!tbody) return;

  const search = (document.getElementById('taskArchiveSearch')?.value || '').toLowerCase().trim();
  const clientFilter = document.getElementById('taskArchiveClientFilter')?.value || 'all';
  const memberFilter = document.getElementById('taskArchiveMemberFilter')?.value || 'all';
  const fromDate = document.getElementById('taskArchiveFromDate')?.value || '';
  const toDate = document.getElementById('taskArchiveToDate')?.value || '';

  let rows = tasks.filter(t=>t.status==='done');

  // "mine" isn't just a UI nicety here — for a regular member this is a
  // no-op anyway, since RLS never sent anyone else's tasks to their
  // browser in the first place. For an admin/approver who's chosen "My
  // Tasks" specifically, this narrows their own already-broader dataset
  // back down to just their own involvement.
  if(taskArchiveScope==='mine'){
    rows = rows.filter(t=>t.assigneeId===currentUser.id || t.assignerId===currentUser.id);
  } else if(memberFilter!=='all'){
    rows = rows.filter(t=>t.assigneeId===memberFilter || t.assignerId===memberFilter);
  }

  if(clientFilter!=='all') rows = rows.filter(t=>t.clientId===clientFilter);
  if(search) rows = rows.filter(t=>t.title.toLowerCase().includes(search));
  if(fromDate) rows = rows.filter(t=>t.completedAt && t.completedAt.slice(0,10) >= fromDate);
  if(toDate) rows = rows.filter(t=>t.completedAt && t.completedAt.slice(0,10) <= toDate);

  rows.sort((a,b)=> new Date(b.completedAt||0) - new Date(a.completedAt||0));

  if(!rows.length){
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty" style="padding:30px 0;">No completed tasks match these filters.</div></td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(t=>{
    const c = clients.find(x=>x.id===t.clientId);
    const assignee = teamProfiles.find(p=>p.id===t.assigneeId);
    const assigner = teamProfiles.find(p=>p.id===t.assignerId);
    const completedStr = t.completedAt ? new Date(t.completedAt).toLocaleDateString('en-US',{month:'short', day:'numeric', year:'numeric'}) : '—';
    return `<tr>
      <td>
        <div class="table-name-link" onclick="openTaskDetailModal('${t.id}')">${escapeHtml(t.title)}${(t.completionNotes || t.completionLink) ? ' 📝' : ''}</div>
      </td>
      <td>${c ? escapeHtml(c.name) : '<span style="color:var(--muted-lt);">—</span>'}</td>
      <td>${assignee ? escapeHtml(assignee.name) + (assignee.id===currentUser.id ? ' (you)' : '') : '—'}</td>
      <td>${assigner ? escapeHtml(assigner.name) + (assigner.id===currentUser.id ? ' (you)' : '') : '—'}</td>
      <td style="color:var(--muted-lt);">${completedStr}</td>
    </tr>`;
  }).join('');
}

async function moveTaskToStatus(taskId, newStatus){
  const t = tasks.find(x=>x.id===taskId);
  if(!t) return;
  const amAssigner = t.assignerId===currentUser.id;
  const amAssignee = t.assigneeId===currentUser.id;
  if(!amAssigner && !amAssignee) return;
  if(newStatus==='done' && !amAssignee){ showToast('error','Not allowed','Only the person assigned to this task can move it to Completed.'); return; }
  if(newStatus===t.status){ closeKanbanMenus(); return; }

  if(newStatus==='done'){
    closeKanbanMenus();
    completeTaskModalHtml(taskId);
    return;
  }

  const wasDone = t.status === 'done';
  const { error } = await supabaseClient.from('tasks').update({ status: newStatus }).eq('id', taskId);
  const waOpened = !error && wasDone ? await syncWaItemsForTask(taskId, 'open') : 0;
  await loadMyTasks();
  renderTasks();
  updateTasksNavBadge();
  closeAppModal();
  closeKanbanMenus();
  if(wasDone && typeof renderCalendar === 'function') renderCalendar();
  if(typeof currentViewName !== 'undefined' && currentViewName === 'overview' && typeof renderDashboard === 'function') renderDashboard();
  const stageLabel = KANBAN_STAGES.find(s=>s.key===newStatus)?.label || newStatus;
  if(error){ showToast('error','Save failed', error.message); return; }
  showToast('success','Task moved', `Moved to ${stageLabel}.${waOpened ? ' Its WhatsApp item is open again.' : ''}`);
}

function completeTaskModalHtml(taskId){
  const t = tasks.find(x=>x.id===taskId);
  if(!t) return '';
  openAppModal(`
    <div class="modal-head">
      <span class="panel-title">Mark task complete</span>
      <span class="toast-close" onclick="closeAppModal()">✕</span>
    </div>
    <div class="modal-body">
      <div class="q-name" style="margin-bottom:14px;">${escapeHtml(t.title)}</div>
      <div class="settings-field" style="margin-bottom:14px;">
        <label>Notes <span style="color:var(--muted-lt);font-weight:400;">(optional)</span></label>
        <textarea spellcheck="true" id="taskCompletionNotes" placeholder="Anything the assigner should know — what you found, decisions made, what's left, etc." style="width:100%;min-height:80px;font-family:var(--font);font-size:14px;padding:10px;border-radius:8px;border:1px solid var(--border);resize:vertical;">${escapeHtml(t.completionNotes||'')}</textarea>
      </div>
      <div class="settings-field">
        <label>Link <span style="color:var(--muted-lt);font-weight:400;">(optional)</span></label>
        <input type="text" id="taskCompletionLink" value="${escapeHtml(t.completionLink||'')}" placeholder="e.g. a doc, a page you built, a file" style="width:100%;">
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeAppModal()">Cancel</button>
      <button class="btn btn-brand" id="taskCompletionConfirmBtn" onclick="confirmTaskCompletion('${taskId}')">Mark Complete</button>
    </div>`, 460);
}

async function confirmTaskCompletion(taskId){
  const notes = document.getElementById('taskCompletionNotes').value.trim();
  const link = normalizeUrl(document.getElementById('taskCompletionLink').value) || null;
  const today = toDateStr(new Date()), doneDate = document.getElementById('taskDoneDate')?.value || today;
  if(doneDate > today){ showToast('error', 'Pick another day', 'A task can’t be finished in the future.'); return; }
  // the time it took, for Time on that day
  let time = null;
  const raw = (document.getElementById('taskDoneTime')?.value || '').trim();
  if(raw){
    const minutes = parseDurationInput(raw), clientId = document.getElementById('tdClient')?.value || '';
    if(!minutes || minutes <= 0){ showToast('error', 'Check the time', 'Try something like 45m, 1:30 or 1.5.'); return; }
    if(!clientId){ showToast('error', 'Pick a client', 'Choose who this time was for.'); return; }
    if(isClientPaused(clientId)){ showPausedClientWarning(clientId); return; }
    const pick = typeof hvPickValue === 'function' ? hvPickValue('td', clientId) : { ok: true, service: '' };
    if(!pick.ok){ showToast('error', 'Almost there', pick.msg); return; }
    if(minutes > 960 && !(await confirmDialog(`That's ${formatMinutes(minutes)} for one task. Did you mean minutes instead of hours?`, { confirmLabel: 'Log It Anyway', cancelLabel: 'Let Me Fix It' }))) return;
    time = { clientId, minutes, pick };
    // already logged for this client since the task was made? (Nov 24: not twice in Harvest)
    const t0 = tasks.find(x => x.id === taskId), had = t0 && t0.clientId === clientId ? taskTimeSince(t0, pick) : [];
    if(had.length){
      const v = await choiceDialog({ title: 'Is this time already logged?', row: true,
        body: `${taskTimeWords(t0, had)}\n\nIf that was this task, mark it done without the time, so it isn’t in Harvest twice.`,
        choices: [{ label: `Log ${formatMinutes(minutes)} Again`, value: 'log' }, { label: 'Mark Done Without Time', value: 'skip', primary: true }] });
      if(v === null) return;
      if(v === 'skip') time = null;
    }
  }
  const btn = document.getElementById('taskCompletionConfirmBtn');
  setBtnLoading(btn, 'Saving…');
  await finishTask(taskId, notes, link, { doneDate, time });
  restoreBtn(btn);
}

// ---- No double time (Nov 24) ----------------------------------------------------------------------
// Time you already logged for a task's client since the task was made (by hand, from Queue, a timer):
// Mark Done says so and asks before logging more, so the same work doesn't reach Harvest twice.
function taskTimeSince(t, pick){
  if(!t || !t.clientId || typeof timeEntries === 'undefined' || !currentUser) return [];
  const since = t.createdAt ? toDateStr(new Date(t.createdAt)) : toDateStr(new Date());
  return timeEntries.filter(e => e.userId === currentUser.id && e.clientId === t.clientId && e.date >= since && taskTimeSameWork(e, pick));
}
// The same work in Harvest (Nov 24): the same project and task (Harvest sets Billable by the task),
// not just the same client. Without a pick yet, anything for the client counts.
function taskTimeSameWork(e, pick){
  if(!pick || (!pick.projectId && !pick.service)) return true;
  if(pick.projectId){
    if(e.harvestProjectId) return Number(e.harvestProjectId) === Number(pick.projectId) && (!pick.taskId || !e.harvestTaskId || Number(e.harvestTaskId) === Number(pick.taskId));
    return !!e.service && e.service === pick.service;
  }
  return !e.service || e.service === pick.service;
}
// "Website · Design, Billable"
function taskTimeKind(e){
  const w = typeof hvEntryWords === 'function' ? hvEntryWords(e) : (e.service || '');
  let bill = '';
  if(e.harvestProjectId && e.harvestTaskId && typeof hvProjectTasks === 'function'){
    const tk = hvProjectTasks(e.harvestProjectId, e.harvestTaskId, true).find(x => Number(x.id) === Number(e.harvestTaskId));
    if(tk) bill = tk.billable ? 'Billable' : 'Non-billable';
  }
  return [w, bill].filter(Boolean).join(', ');
}
// What you already logged, plainly:
// "On Tue you logged 1h for Together Design & Build Dallas (Website · Design, Billable): “Redo the yelp…”"
function taskTimeWords(t, had){
  const c = clients.find(x => x.id === t.clientId), name = c ? c.name : 'this client', total = had.reduce((n, e) => n + (e.minutes || 0), 0);
  const byDay = had.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))), last = byDay[0];
  const day = e => fmtDay(new Date(e.date + 'T12:00:00')), kind = last ? taskTimeKind(last) : '';
  const said = last && last.description ? `: “${last.description.length > 60 ? last.description.slice(0, 60) + '…' : last.description}”` : '';
  if(had.length === 1) return `On ${day(last)} you logged ${formatMinutes(total)} for ${name}${kind ? ` (${kind})` : ''}${said}.`;
  return `Since this task was made you logged ${formatMinutes(total)} for ${name}${kind ? ` (${kind})` : ''}, the latest on ${day(last)}${said}.`;
}
// Logging time by hand for a client you have a task open for: is it that task's time? Then the task is
// marked done with it, once. Returns { go } to log the time as usual, { taskId } when a task took it, or null.
async function timeForOpenTask(clientId, description){
  if(!currentUser || typeof tasks === 'undefined') return { go: true };
  const open = tasks.filter(t => t.assigneeId === currentUser.id && t.clientId === clientId && !t.cancelledAt && t.status !== 'done' && !t.hiddenByAssignee);
  if(!open.length) return { go: true };
  const c = clients.find(x => x.id === clientId), cut = s => s.length > 44 ? s.slice(0, 44) + '…' : s;
  // the one it most looks like first, then the one due soonest
  const near = typeof mtSame === 'function' && description ? open.filter(t => mtSame(description, t.title)) : [];
  const order = [...near, ...open.filter(t => !near.includes(t)).sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')))].slice(0, 3);
  const v = open.length === 1 ? await choiceDialog({
    title: 'Is this time for your open task?', row: true,
    body: `“${cut(open[0].title)}” is open for ${c ? c.name : 'this client'}.\n\nIf this time is for it, it’s marked done with this time, so finishing it later doesn’t log the time again.`,
    choices: [{ label: 'No, Just Log It', value: '_time', primary: !near.length }, { label: 'Yes, Mark It Done', value: open[0].id, primary: near.length > 0 }],
  }) : await choiceDialog({
    title: 'Is this time for one of your open tasks?',
    body: `You have ${open.length} tasks open for ${c ? c.name : 'this client'}. If this time is for one, it’s marked done with this time, so finishing it later doesn’t log the time again.`,
    choices: [...order.map((t, i) => ({ label: `Mark “${cut(t.title)}” Done`, value: t.id, primary: i === 0 && near.length > 0 })), { label: 'None, Just Log It', value: '_time', primary: !near.length }],
  });
  if(v === null) return null;
  return v === '_time' ? { go: true } : { taskId: v };
}

// Finishing a task, from the Mark Done sheet or from somewhere else (a WhatsApp item marked done).
// A client's task goes into that client's history (not the email), the WhatsApp item it came from
// is done too, and the person who assigned it hears about it.
async function finishTask(taskId, notes, link, opts){
  opts = opts || {};
  const t = tasks.find(x=>x.id===taskId);
  if(!t) return false;
  const wasAlreadyDone = t.status==='done';
  const prevStatus = t.status;   // for Undo (Nov 26: with no Done column on Tasks, it's how a mis-tick comes back)
  // finished on another day: that day, at the end of the working day
  const today = toDateStr(new Date()), doneDate = opts.doneDate && opts.doneDate < today ? opts.doneDate : today;
  const doneAt = doneDate === today ? new Date() : atTime(new Date(doneDate + 'T12:00:00'), '17:00');
  const updatePayload = { status:'done', completed_at:doneAt.toISOString(), completion_notes:notes||null, completion_link:link||null };
  if(!wasAlreadyDone) updatePayload.assigner_notified = false;
  const { error } = await supabaseClient.from('tasks').update(updatePayload).eq('id', taskId);
  if(error){ showToast('error','Save failed', error.message); return false; }

  // Only tasks tied to a client have anywhere to log to — plenty of tasks
  // are internal and have no client attached, which is fine, they just
  // don't create an improvement entry. Only logs once, the first time it
  // reaches Completed — moving it back out and in again doesn't double-log.
  let doneImp = null;   // the work this logged, for the time below to go with
  if(!wasAlreadyDone && t.clientId){
    await loadAll();
    const c = clients.find(x=>x.id===t.clientId);
    if(c){
      doneImp = await insertImprovementRow(t.clientId, {
        author: myName()||'Team member',
        text: t.description ? `${t.title} — ${t.description}` : t.title,
        includeInEmail: false,
        source: 'task',
        date: doneDate === today ? null : doneAt.toISOString()
      });
      const invalidated = invalidateStaleDraft(c, myName()||'Team member');
      if(invalidated) await saveDraftFor(t.clientId, myName()||'Team member', { draftStatus:'none', draft:'' });
      renderImprovementsHistory();
      renderClientsTable();
      renderQueue();
      renderKpis();
    }
  }
  const waClosed = opts.fromWhatsapp ? 0 : await syncWaItemsForTask(taskId, 'done');
  // the time it took, into Time on the day it was finished
  let timeNote = '';
  if(opts.time){
    const { clientId, minutes, pick } = opts.time;
    const r = await mergeOrInsertTimeEntry({ clientId, service: pick.service || '', dateStr: doneDate, minutes, description: t.title, projectId: pick.projectId || null, taskId: pick.taskId || null,
      improvementId: doneImp && doneImp.clientId === clientId ? doneImp.id : null });
    if(r.error) showToast('error', 'The time wasn’t saved', `${r.error.message} Add it in Time.`);
    else {
      timeNote = ` ${formatMinutes(minutes)} logged in Time${doneDate === today ? '' : ' on ' + fmtShortDate(new Date(doneDate + 'T12:00:00'))}.`;
      syncEntryToHarvestBackground(r.entryId);
      await loadTimeEntries();
      if(typeof renderTimesheet === 'function') renderTimesheet();
      if(typeof renderReports === 'function') renderReports();
    }
  }

  if(!opts.quiet){ closeAppModal(); closeKanbanMenus(); }
  await loadMyTasks();
  renderTasks();
  updateTasksNavBadge();
  if(typeof renderCalendar === 'function') renderCalendar();            // done there too
  if(typeof currentViewName !== 'undefined' && currentViewName === 'overview' && typeof renderDashboard === 'function') renderDashboard();
  if(!opts.quiet) showToast('success','Marked complete', `${t.assignerId===currentUser.id ? 'Nice work!' : `${teamProfiles.find(p=>p.id===t.assignerId)?.name||'They'} will be notified.`}${t.clientId ? ' Logged to Past Improvements.' : ''}${timeNote}${waClosed ? ' The WhatsApp item is done too.' : ''}`,
    !wasAlreadyDone && prevStatus && prevStatus !== 'done' ? { action: 'Undo', onAction: () => moveTaskToStatus(taskId, prevStatus) } : undefined);

  if(t.assignerId !== currentUser.id){
    // Enrich the notification with a preview of what was just added —
    // this same body text is what shows in the in-app bell AND the Slack
    // DM (sendNotification() already fans out to both), so the assigner
    // sees this context immediately without needing to open the task.
    // Notes truncated here specifically to keep the notification/Slack
    // message readable — the full text is always visible on the task
    // itself for anyone who clicks through.
    let notifBody = `${myName()||'Someone'} marked "${t.title}" as done.`;
    if(notes) notifBody += ` Note: "${notes.length>100 ? notes.slice(0,100)+'…' : notes}"`;
    if(link) notifBody += ` Link: ${link}`;
    sendNotification(t.assignerId, 'task_completed', 'Task completed', notifBody, 'tasks', t.id);
  }
  return true;
}

async function cancelTask(taskId){
  const t = tasks.find(x=>x.id===taskId);
  if(!t || t.assignerId!==currentUser.id) return;
  if(!(await confirmDialog(`Cancel "${t.title}"? This removes it for both of you.`, {confirmLabel:'Cancel task', cancelLabel:'Never mind', destructive:true}))) return;
  const { error } = await supabaseClient.from('tasks').update({ cancelled_at: new Date().toISOString() }).eq('id', taskId);
  if(!error){
    await syncWaItemsForTask(taskId, 'unlink');
    // cancelled for both of you, so off the calendar too
    await supabaseClient.from('calendar_events').delete().eq('related_task_id', taskId);
    if(typeof loadCalendarEvents === 'function') await loadCalendarEvents();
    if(typeof renderCalendar === 'function') renderCalendar();
  }
  await loadMyTasks();
  renderTasks();
  updateTasksNavBadge();
  closeAppModal();
  error ? showToast('error','Save failed', error.message) : showToast('success','Task cancelled','Removed for both of you.');
  if(!error && t.assigneeId !== currentUser.id){
    sendNotification(t.assigneeId, 'task_cancelled', 'Task cancelled', `${myName()||'Someone'} cancelled "${t.title}".`, 'tasks', t.id);
  }
}

async function hideTaskFromMyList(taskId){
  const t = tasks.find(x=>x.id===taskId);
  if(!t) return;
  const amAssigner = t.assignerId===currentUser.id;
  const field = amAssigner ? 'hidden_by_assigner' : 'hidden_by_assignee';
  const { error } = await supabaseClient.from('tasks').update({ [field]: true }).eq('id', taskId);
  await loadMyTasks();
  renderTasks();
  closeAppModal();
  error ? showToast('error','Save failed', error.message) : showToast('success','Archived','Cleared from your board — this doesn\'t affect the other person\'s view.');
}

// Permanent deletion is only ever offered once a task is Completed — for
// anything still active, Cancel is the right tool (it removes it for both
// people, same as this, but says so honestly rather than pretending
// something in progress was ever "done").
async function deleteTaskPermanently(taskId){
  if(!hasPermission('delete_tasks')){ showToast('error','Not allowed','You don\'t have permission to permanently delete tasks.'); return; }
  const t = tasks.find(x=>x.id===taskId);
  if(!t) return;
  if(!(await confirmDialog(`Permanently delete "${t.title}"? This can't be undone.`, {confirmLabel:'Delete permanently', destructive:true}))) return;
  const { error } = await supabaseClient.from('tasks').delete().eq('id', taskId);
  if(!error){ await supabaseClient.from('calendar_events').delete().eq('related_task_id', taskId); await syncWaItemsForTask(taskId, 'unlink'); }
  await loadMyTasks();
  await loadCalendarEvents();
  renderTasks();
  renderCalendar();
  closeAppModal();
  if(error){ showToast('error','Delete failed', error.message); return; }
  // A missing RLS policy lets a delete "succeed" with zero rows actually
  // removed and no error raised — confirm it's actually gone rather than
  // trusting a lack of error.
  if(tasks.some(x=>x.id===taskId)){
    showToast('error','Delete failed','The task is still there — you may not have permission to delete it.');
    return;
  }
  showToast('success','Deleted','Task permanently removed.');
}
