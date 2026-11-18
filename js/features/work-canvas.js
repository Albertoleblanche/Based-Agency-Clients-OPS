// Tasks and Reminders, as on their canvas boards.

// ---- Tasks: columns (or a list), Everyone / Mine, by client -------------------------------
let tasksScope = 'everyone', tasksClient = 'all', tasksLayout = (localStorage.getItem('bda_tasks_layout') || 'columns');
const TASK_COLS = [['todo', 'To Do'], ['in_progress', 'In Progress'], ['in_review', 'Review'], ['done', 'Done']];
function setTasksScope(v){ tasksScope = v; renderTasks(); }
function setTasksClient(v){ tasksClient = v; renderTasks(); }
function setTasksLayout(v){ tasksLayout = v; try{ localStorage.setItem('bda_tasks_layout', v); }catch(e){} renderTasks(); }
function taskDueHtml(t){
  if(t.status === 'in_review' && t.assignerId === currentUser?.id) return 'Waiting on you';
  if(!t.dueDate) return '';
  const today = toDateStr(new Date()), d = new Date(t.dueDate + 'T12:00:00');
  const hhmm = typeof taskDueTimes !== 'undefined' ? taskDueTimes[t.id] : '', tm = hhmm ? ', ' + fmtTime(atTime(d, hhmm)) : '';
  if(t.status !== 'done' && t.dueDate < today) return `<span class="t-red">${t.dueDate === toDateStr(addDays(new Date(), -1)) ? 'Yesterday' : fmtShortDate(d)}${tm}</span>`;
  return (t.dueDate === today ? 'Today' : t.dueDate === toDateStr(addDays(new Date(), 1)) ? 'Tomorrow' : fmtShortDate(d)) + tm;
}
function taskCardHtml(t){
  const c = clients.find(x => x.id === t.clientId), who = teamProfiles.find(p => p.id === t.assigneeId);
  const done = t.status === 'done', mine = t.assigneeId === currentUser?.id;
  const cb = done ? `<span class="cb done" role="checkbox" aria-checked="true" aria-label="Done">${icon('check', { weight: 'bold' })}</span>`
    : `<button class="cb" role="checkbox" aria-checked="false" aria-label="Mark done"${mine ? ` onclick="event.stopPropagation();moveTaskToStatus('${t.id}','done')"` : ' disabled'}></button>`;
  const due = taskDueHtml(t);
  return `<div class="task${done ? ' done' : ''}" onclick="openTaskDetailModal('${t.id}')">${cb}<div class="tx"><span class="t">${escapeHtml(t.title)}</span>
<span class="s">${c ? `<span style="display:inline-flex;align-items:center;gap:4px">${icon('buildings')}${escapeHtml(c.name)}</span>` : ''}${due ? `<span>${due}</span>` : ''}</span></div>
<div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">${who ? avHtml(who.name) : ''}${t.priority === 'high' && !done ? icon('flag', { cls: 'flag', fill: true, label: 'High priority' }) : ''}</div></div>`;
}
function renderTasks(){
  const root = document.getElementById('tasksRoot');
  if(!root || !currentUser) return;
  const me = currentUser.id, today = toDateStr(new Date());
  let vis = tasks.filter(t => !t.cancelledAt && (t.assignerId === me || t.assigneeId === me) && !(t.status === 'done' && ((t.assignerId === me && t.hiddenByAssigner) || (t.assigneeId === me && t.hiddenByAssignee))));
  const mineN = vis.filter(t => t.assigneeId === me && t.status !== 'done').length;
  if(tasksScope === 'mine') vis = vis.filter(t => t.assigneeId === me);
  if(tasksClient !== 'all') vis = vis.filter(t => t.clientId === tasksClient);
  const open = vis.filter(t => t.status !== 'done'), overdue = open.filter(t => t.dueDate && t.dueDate < today);
  const order = (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || new Date(b.createdAt) - new Date(a.createdAt);
  const usedClients = [...new Set(tasks.map(t => t.clientId).filter(Boolean))].map(id => clients.find(c => c.id === id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  const filt = `<div class="tbl-bar" style="padding:0 0 16px">
<div class="seg" role="tablist"><button class="${tasksScope === 'everyone' ? 'on' : ''}" onclick="setTasksScope('everyone')">Everyone</button><button class="${tasksScope === 'mine' ? 'on' : ''}" onclick="setTasksScope('mine')">Mine <span class="c">${mineN}</span></button></div>
<label class="pop-wrap">Client: <select class="pop" onchange="setTasksClient(this.value)"><option value="all">All</option>${usedClients.map(c => `<option value="${c.id}"${tasksClient === c.id ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select></label>
<span style="flex:1"></span>
<button class="ib" title="Finished tasks (archive)" aria-label="Archive" onclick="switchView('task-archive')">${icon('archive')}</button>
<div class="seg" role="tablist" aria-label="View"><button class="${tasksLayout === 'list' ? 'on' : ''}" onclick="setTasksLayout('list')">${icon('list-bullets')}List</button><button class="${tasksLayout === 'columns' ? 'on' : ''}" onclick="setTasksLayout('columns')">${icon('squares-four')}Columns</button></div></div>`;
  let body;
  if(tasksLayout === 'list'){
    body = TASK_COLS.map(([k, label]) => { const ts = vis.filter(t => t.status === k).sort(order); return ts.length ? `<div class="h2"><h2>${label}<span class="c">${ts.length}</span></h2><a href="#" onclick="openNewTaskModal(undefined,'${k}');return false;">New Task</a></div><div class="task-list">${ts.map(taskCardHtml).join('')}</div>` : ''; }).join('') || '<div class="empty"><b>No tasks</b>Create one from New → Task.</div>';
  } else {
    body = `<div class="board">${TASK_COLS.map(([k, label]) => { const ts = vis.filter(t => t.status === k).sort(order);
      return `<section class="bcol" aria-label="${label}"><div class="bcol-h"><b>${label}</b><span>${ts.length}</span><button class="ib" aria-label="Add a task to ${label}" onclick="openNewTaskModal(undefined,'${k}')">${icon('plus')}</button></div>
${ts.map(taskCardHtml).join('')}<a class="add" href="#" onclick="openNewTaskModal(undefined,'${k}');return false;">${icon('plus')}New task</a></section>`; }).join('')}</div>`;
  }
  root.innerHTML = filt + body;
  if(currentViewName === 'tasks') setToolbar(null, `${open.length} open${overdue.length ? ` · ${overdue.length} overdue` : ''}`);
  if(typeof updateTasksNavBadge === 'function') updateTasksNavBadge();
}

// ---- Reminders: questions waiting on clients ----------------------------------------------
let remTab = 'open', remClient = 'all', remWho = 'all';
function setRem(k, v){ if(k === 'tab') remTab = v; if(k === 'client') remClient = v; if(k === 'who') remWho = v; renderReminders(); }
function renderReminders(){
  const root = document.getElementById('remindersRoot');
  if(typeof updateRemindersNavBadge === 'function') updateRemindersNavBadge();
  if(!root || typeof clientReminders === 'undefined') return;
  let rs = clientReminders.slice();
  if(remClient !== 'all') rs = rs.filter(r => r.clientId === remClient);
  if(remWho !== 'all') rs = rs.filter(r => r.askedBy === remWho);
  const open = rs.filter(r => r.status === 'waiting'), answered = rs.filter(r => r.status === 'answered'), closed = rs.filter(r => r.status === 'closed');
  const due = open.filter(r => reminderDisplayStatus(r) === 'due'), waiting = open.filter(r => reminderDisplayStatus(r) !== 'due');
  const weekAgo = addDays(rNow(), -7), recentAnswered = answered.filter(r => r.resolvedAt && new Date(r.resolvedAt) >= weekAgo);
  const who = id => teamProfiles.find(p => p.id === id)?.name || 'someone';
  const row = (r, doneMark) => {
    const c = clients.find(x => x.id === r.clientId), d = reminderDisplayStatus(r);
    const when = r.status !== 'waiting' ? '' : (r.followUpDate ? (d === 'due' ? `<span class="t-red">${r.followUpDate === toDateStr(new Date()) ? 'Today' : r.followUpDate === toDateStr(addDays(new Date(), -1)) ? 'Yesterday' : fmtShortDate(new Date(r.followUpDate + 'T12:00:00'))}</span>` : new Date(r.followUpDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })) : '');
    const cb = doneMark ? `<span class="cb rem done" role="checkbox" aria-checked="true">${icon('check', { weight: 'bold' })}</span>` : `<button class="cb rem" role="checkbox" aria-checked="false" aria-label="Mark answered" onclick="event.stopPropagation();checkOff(this, () => markReminderStatus('${r.id}','answered'))"></button>`;
    const meta = r.status === 'waiting' ? `asked by ${who(r.askedBy)} on ${fmtShortDate(new Date(r.askedDate + 'T12:00:00'))}` : `${r.status === 'answered' ? 'answered' : 'closed'} ${r.resolvedAt ? fmtShortDate(new Date(r.resolvedAt)) : ''}`;
    return `<div class="row sm" onclick="openReminderDetailModal('${r.id}')">${cb}<div class="tx"><span class="t" style="font-weight:400${doneMark ? ';color:var(--label-2)' : ''}">${escapeHtml(r.question)}</span><span class="s">${escapeHtml(c ? c.name : '')} · ${escapeHtml(meta)}</span></div><div class="r">${when}</div></div>`;
  };
  const sec = (t, list, done) => list.length ? `<div class="h2"><h2>${t}<span class="c">${list.length}</span></h2></div><div class="grp">${list.map(r => row(r, done)).join('')}</div>` : '';
  let main;
  if(remTab === 'open') main = sec('Due', due) + sec('Waiting on the client', waiting) + sec('Answered this week', recentAnswered, true);
  else main = sec(remTab === 'answered' ? 'Answered' : 'Closed', remTab === 'answered' ? answered : closed, true);
  if(!main) main = `<div class="empty"><b>Nothing waiting on clients</b>When you ask a client something, add it here so the team knows you’re waiting on an answer.</div>`;
  const stale = open.filter(r => daysBetween(new Date(r.askedDate + 'T12:00:00'), rNow()) >= 7).sort((a, b) => a.askedDate.localeCompare(b.askedDate));
  const owners = {}; open.forEach(r => { owners[r.askedBy] = (owners[r.askedBy] || 0) + 1; });
  const usedClients = [...new Set(clientReminders.map(r => r.clientId))].map(id => clients.find(c => c.id === id)).filter(Boolean);
  const askers = [...new Set(clientReminders.map(r => r.askedBy))].map(id => teamProfiles.find(p => p.id === id)).filter(Boolean);
  root.innerHTML = `<h1 class="lt">${due.length ? `${due.length} follow-up${due.length === 1 ? ' is' : 's are'} due` : 'No follow-ups are due'}</h1>
<p class="lt-sub">Questions your team asked clients, and when to chase them</p>
<div class="tbl-bar" style="padding:16px 0 0">
<div class="seg" role="tablist">${[['open', 'Open', open.length], ['answered', 'Answered', answered.length], ['closed', 'Closed', closed.length]].map(([k, t, n]) => `<button class="${remTab === k ? 'on' : ''}" onclick="setRem('tab','${k}')">${t} <span class="c">${n}</span></button>`).join('')}</div>
<span style="flex:1"></span>
<label class="pop-wrap">Client: <select class="pop" onchange="setRem('client',this.value)"><option value="all">All</option>${usedClients.map(c => `<option value="${c.id}"${remClient === c.id ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select></label>
<label class="pop-wrap"><select class="pop" onchange="setRem('who',this.value)"><option value="all">Everyone</option>${askers.map(p => `<option value="${p.id}"${remWho === p.id ? ' selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}</select></label></div>
<div class="cols"><div class="col-main">${main}</div>
<aside class="col-side" style="padding-top:28px">
<section class="panel"><h3>Unanswered a week or more</h3>${stale.length ? stale.slice(0, 5).map(r => { const c = clients.find(x => x.id === r.clientId); return `<div class="row sm" style="padding:6px 0" onclick="openReminderDetailModal('${r.id}')">${c ? monoHtml(c) : ''}<div class="tx"><span class="t">${escapeHtml(c ? c.name : '')}</span><span class="s">${daysBetween(new Date(r.askedDate + 'T12:00:00'), rNow())} days · asked by ${escapeHtml(firstName(who(r.askedBy)))}</span></div></div>`; }).join('') : '<p class="t-2" style="font-size:13px;margin:0">Nothing older than a week.</p>'}</section>
<section class="panel"><h3>By owner</h3>${Object.keys(owners).length ? Object.entries(owners).sort((a, b) => b[1] - a[1]).map(([id, n]) => `<div class="kv" style="border:0;padding:6px 0"><span style="display:inline-flex;align-items:center;gap:8px;color:var(--label)">${avHtml(who(id))}${escapeHtml(who(id))}</span><b style="font-weight:500">${n} open</b></div>`).join('') : '<p class="t-2" style="font-size:13px;margin:0">Nothing open.</p>'}</section>
</aside></div>`;
  if(currentViewName === 'reminders') setToolbar(null, 'Client follow-ups');
}

// Notes moved to notes-canvas.js (the gallery and the note sheet).
