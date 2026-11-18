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

// ---- Reminders: questions waiting on clients (canvas RemindersNew) ------------------------
// Due, Waiting on the client, Answered this week: no boxes, how long each question has waited,
// and one clear action (Nudge) only where a follow-up is due.
let remTab = 'open', remClient = 'all', remWho = 'all';
function setRem(k, v){ if(k === 'tab') remTab = v; if(k === 'client') remClient = v; if(k === 'who') remWho = v; renderReminders(); }
function remDay(v){ return new Date(v + 'T12:00:00'); }
function remWhen(r){
  const today = toDateStr(new Date());
  if(!r.followUpDate) return ['No follow-up date', false];
  if(r.followUpDate === today) return ['Follow up today', true];
  if(r.followUpDate === toDateStr(addDays(new Date(), -1))) return ['Follow up yesterday', true];
  if(r.followUpDate < today) return [`Follow up ${fmtShortDate(remDay(r.followUpDate))}`, true];
  const k = daysBetween(dayStart(new Date()), remDay(r.followUpDate));
  return [`Follow up ${k === 1 ? 'tomorrow' : k < 7 ? DAY_NAMES[remDay(r.followUpDate).getDay()].slice(0, 3) : fmtShortDate(remDay(r.followUpDate))}`, false];
}
function remWaited(from, to){ const n = Math.max(0, daysBetween(remDay(from), to ? dayStart(new Date(to)) : dayStart(new Date()))); return `${n} day${n === 1 ? '' : 's'}`; }
function remRowHtml(r, primary){
  const c = clients.find(x => x.id === r.clientId), who = (teamProfiles.find(p => p.id === r.askedBy) || {}).name || 'Someone';
  const asked = r.askedDate ? fmtShortDate(remDay(r.askedDate)) : '';
  const open = r.status === 'waiting', due = open && reminderDisplayStatus(r) === 'due';
  let right, cb, act = '<span class="rmi-sp"></span>';
  if(open){
    const [when, late] = remWhen(r);
    right = `<span class="rmi-when${late ? ' is-late' : ''}">${when}</span><span class="rmi-d">${r.askedDate ? 'waiting ' + remWaited(r.askedDate) : ''}</span>`;
    cb = `<button class="cb rem" role="checkbox" aria-checked="false" aria-label="Mark answered" title="Mark answered" onclick="event.stopPropagation();checkOff(this, () => markReminderStatus('${r.id}','answered'))"></button>`;
    if(due) act = `<button class="btn${primary ? ' btn-p' : ''}" onclick="event.stopPropagation();nudgeReminder('${r.id}')">${icon('paper-plane-tilt')}Nudge</button>`;
  } else {
    const at = r.resolvedAt ? fmtShortDate(new Date(r.resolvedAt)) : '';
    right = `<span class="rmi-when">${r.status === 'answered' ? 'Answered' : 'Closed'} ${at}</span><span class="rmi-d">${r.askedDate && r.resolvedAt ? 'in ' + remWaited(r.askedDate, r.resolvedAt) : ''}</span>`;
    cb = `<span class="cb rem${r.status === 'answered' ? ' done' : ' closed'}" role="img" aria-label="${r.status === 'answered' ? 'Answered' : 'Closed'}">${r.status === 'answered' ? icon('check', { weight: 'bold' }) : icon('x', { weight: 'bold' })}</span>`;
  }
  return `<div class="rmi-r${open ? '' : ' is-done'}" role="button" tabindex="0" onclick="openReminderDetailModal('${r.id}')" onkeydown="if(event.key==='Enter'&&event.target===this)openReminderDetailModal('${r.id}')">${cb}${c ? monoHtml(c, 'sm') : ''}
<div class="tx"><b>${escapeHtml(r.question)}</b><span class="s">${escapeHtml(c ? c.name : '')} · ${escapeHtml(firstName(who))} asked ${escapeHtml(asked)}</span></div>
<div class="rmi-w">${right}</div>${act}</div>`;
}
function renderReminders(){
  const root = document.getElementById('remindersRoot');
  if(typeof updateRemindersNavBadge === 'function') updateRemindersNavBadge();
  if(!root || typeof clientReminders === 'undefined') return;
  let rs = clientReminders.slice();
  if(remClient !== 'all') rs = rs.filter(r => r.clientId === remClient);
  if(remWho !== 'all') rs = rs.filter(r => r.askedBy === remWho);
  const byFu = (a, b) => (a.followUpDate || '9999').localeCompare(b.followUpDate || '9999') || (a.askedDate || '').localeCompare(b.askedDate || '');
  const byDone = (a, b) => new Date(b.resolvedAt || 0) - new Date(a.resolvedAt || 0);
  const open = rs.filter(r => r.status === 'waiting'), answered = rs.filter(r => r.status === 'answered').sort(byDone), closed = rs.filter(r => r.status === 'closed').sort(byDone);
  const due = open.filter(r => reminderDisplayStatus(r) === 'due').sort(byFu), waiting = open.filter(r => reminderDisplayStatus(r) !== 'due').sort(byFu);
  const weekAgo = addDays(rNow(), -7), recent = answered.filter(r => r.resolvedAt && new Date(r.resolvedAt) >= weekAgo);
  const sec = (t, list, cls) => list.length ? `<div class="rmi-sec${cls ? ' ' + cls : ''}"><b>${t}</b><span>${list.length}</span></div>${list.map((r, i) => remRowHtml(r, cls === 'is-due' && i === 0)).join('')}` : '';
  let main;
  if(remTab === 'open') main = sec('Due', due, 'is-due') + sec('Waiting on the client', waiting) + sec('Answered this week', recent);
  else main = sec(remTab === 'answered' ? 'Answered' : 'Closed', remTab === 'answered' ? answered : closed);
  if(!main) main = remTab === 'open'
    ? `<div class="empty rmi-empty"><b>Nothing is waiting on clients</b>When you ask a client something, add it here so the team knows you’re waiting on an answer.</div>`
    : `<div class="empty rmi-empty"><b>Nothing ${remTab === 'answered' ? 'answered' : 'closed'} yet</b></div>`;
  const usedClients = [...new Set(clientReminders.map(r => r.clientId))].map(id => clients.find(c => c.id === id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  const askers = [...new Set(clientReminders.map(r => r.askedBy))].map(id => teamProfiles.find(p => p.id === id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  const curC = usedClients.find(c => c.id === remClient), curW = askers.find(p => p.id === remWho);
  const all = clientReminders.filter(r => (remClient === 'all' || r.clientId === remClient) && (remWho === 'all' || r.askedBy === remWho));
  const n = k => all.filter(r => r.status === k).length;
  root.innerHTML = `<div class="rmi">
<div class="rmi-hd"><div><h2>${due.length ? `${due.length} follow-up${due.length === 1 ? ' is' : 's are'} due` : 'No follow-ups are due'}</h2><p>Questions your team asked clients, and when to chase them.</p></div>
<div class="rmi-f"><div class="seg" role="tablist" aria-label="Show">${[['open', 'Waiting', n('waiting')], ['answered', 'Answered', n('answered')], ['closed', 'Closed', n('closed')]].map(([k, t, c]) => `<button class="${remTab === k ? 'on' : ''}" role="tab" aria-selected="${remTab === k}" onclick="setRem('tab','${k}')">${t} <span class="c">${c}</span></button>`).join('')}</div>
<label class="pop pop-sel"><span class="pl">Client: ${escapeHtml(curC ? curC.name : 'All')}</span>${icon('caret-down')}<select aria-label="Client" onchange="setRem('client',this.value)"><option value="all">All</option>${usedClients.map(c => `<option value="${c.id}"${c === curC ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select></label>
<label class="pop pop-sel"><span class="pl">${escapeHtml(curW ? curW.name : 'Everyone')}</span>${icon('caret-down')}<select aria-label="Asked by" onchange="setRem('who',this.value)"><option value="all">Everyone</option>${askers.map(p => `<option value="${p.id}"${p === curW ? ' selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}</select></label></div></div>
${main}</div>`;
  if(currentViewName === 'reminders') setToolbar(null, 'Client follow-ups');
}
// Nudge: open a short follow-up email to the client and move the next follow-up three days out.
async function nudgeReminder(id){
  const r = clientReminders.find(x => x.id === id); if(!r) return;
  const c = clients.find(x => x.id === r.clientId);
  const asked = r.askedDate ? remDay(r.askedDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) : '';
  const body = `Hi,\n\nJust following up on my question${asked ? ` from ${asked}` : ''}:\n\n${r.question}\n\nThanks,\n${firstName(myName() || '')}`;
  if(c && c.email){
    const a = document.createElement('a');
    a.href = `mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent('Following up: ' + r.question)}&body=${encodeURIComponent(body)}`;
    a.click();
  } else {
    try{ await navigator.clipboard.writeText(body); }catch(e){}
  }
  const next = toDateStr(addDays(new Date(), 3));
  const { error } = await supabaseClient.from('client_reminders').update({ follow_up_date: next }).eq('id', id);
  if(error){ showToast('error', 'Follow-up date not moved', error.message); return; }
  await loadClientReminders();
  renderReminders();
  const day = remDay(next).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  showToast('success', c && c.email ? 'Nudge ready in your mail app' : 'Nudge copied', `${c && c.email ? '' : `No email on file for ${c ? c.name : 'this client'}, so the message is on your clipboard. `}Next follow-up ${day}.`);
  if(c) logClientActivity(r.clientId, 'reminder_nudged', `${myName() || 'Someone'} nudged ${c.name} about "${r.question.length > 80 ? r.question.slice(0, 80) + '…' : r.question}".`);
}

// Notes moved to notes-canvas.js (the gallery and the note sheet).
