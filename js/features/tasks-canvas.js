// Tasks, as on the canvas boards TasksNew and TasksOpen: the columns with more room and
// lighter cards, a name instead of an avatar, overdue and waiting-on-you said in words, and a
// quiet Done column. Clicking a task opens it on the right, the same panel as This Week,
// Health and Focus Reports. Loaded after sheets2-canvas.js.

let tasksScope = 'everyone', tasksClient = 'all', tasksLayout = (() => { try{ return localStorage.getItem('bda_tasks_layout') || 'columns'; }catch(e){ return 'columns'; } })();
const TASK_COLS = [['todo', 'To Do'], ['in_progress', 'In Progress'], ['in_review', 'Review']];
function setTasksScope(v){ tasksScope = v; renderTasks(); }
function setTasksClient(v){ tasksClient = v; renderTasks(); }
function setTasksLayout(v){ tasksLayout = v; try{ localStorage.setItem('bda_tasks_layout', v); }catch(e){} renderTasks(); }
function selectTask(id){ window._taskSel = window._taskSel === id ? null : id; renderTasks(); if(window._taskSel) loadTaskComments(id); }
function closeTaskPanel(){ window._taskSel = null; renderTasks(); }

// Anywhere else in the app a task still opens as a sheet; on Tasks it opens in the panel.
window.openTaskDetailModal = (sheet => function(id){
  if(typeof currentViewName !== 'undefined' && currentViewName === 'tasks' && document.getElementById('tasksRoot')){
    closeAppModal(); window._taskSel = id; renderTasks(); loadTaskComments(id); return;
  }
  sheet(id);
})(window.openTaskDetailModal);

const tkWho = id => id === currentUser?.id ? 'You' : firstName((teamProfiles.find(p => p.id === id) || {}).name || 'Someone');
function tkLogo(c){ return c ? monoHtml(c, 'sm') : ''; }
// When it's due, in words: "Due yesterday", "Today, 2:00 PM", "Fri, Nov 20", "Waiting on your review".
function tkDue(t){
  if(t.status === 'in_review' && t.assignerId === currentUser?.id) return ['Waiting on your review', 'is-you'];
  if(!t.dueDate) return ['', ''];
  const today = toDateStr(new Date()), d = new Date(t.dueDate + 'T12:00:00');
  const hhmm = typeof taskDueTimes !== 'undefined' ? taskDueTimes[t.id] : '', tm = hhmm ? ', ' + fmtTime(atTime(d, hhmm)) : '';
  if(t.dueDate < today){
    const n = daysBetween(dayStart(d), dayStart(new Date()));
    return [n === 1 ? 'Due yesterday' : n < 7 ? `Due ${DAY_NAMES[d.getDay()]}` : `Due ${fmtShortDate(d)}`, 'is-late'];
  }
  if(t.dueDate === today) return ['Today' + tm, 'is-soon'];
  if(t.dueDate === toDateStr(addDays(new Date(), 1))) return ['Tomorrow' + tm, ''];
  return [d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + tm, ''];
}
function tkCb(t, cls){
  const mine = t.assigneeId === currentUser?.id, done = t.status === 'done';
  if(done) return `<span class="tk-cb on${cls ? ' ' + cls : ''}" role="img" aria-label="Done">${icon('check', { weight: 'bold' })}</span>`;
  return mine ? `<button class="tk-cb${cls ? ' ' + cls : ''}" role="checkbox" aria-checked="false" aria-label="Mark done" title="Mark done" onclick="event.stopPropagation();moveTaskToStatus('${t.id}','done')"></button>`
    : `<span class="tk-cb is-off${cls ? ' ' + cls : ''}" title="Only ${escapeHtml(tkWho(t.assigneeId))} can mark this done"></span>`;
}
function tkCardHtml(t){
  const c = clients.find(x => x.id === t.clientId), [due, kind] = tkDue(t);
  const flag = t.priority === 'high' ? `<span class="tk-flag" title="High priority">${icon('flag', { fill: true })}</span>` : '';
  return `<article class="tk-c${t.color ? ' has-c c-' + t.color : ''}${window._taskSel === t.id ? ' is-sel' : ''}" role="button" tabindex="0" aria-label="${escapeHtml(t.title)}" onclick="selectTask('${t.id}')" onkeydown="if((event.key==='Enter'||event.key===' ')&&event.target===this){event.preventDefault();selectTask('${t.id}')}">
<div class="tk-ct">${tkCb(t)}<b>${escapeHtml(t.title)}</b>${flag}</div>
${c ? `<div class="tk-cm">${tkLogo(c)}<span class="tk-cl">${escapeHtml(c.name)}</span></div>` : ''}
<div class="tk-cf"><span class="tk-due ${kind}">${escapeHtml(due)}</span><span class="tk-who">${escapeHtml(tkWho(t.assigneeId))}</span></div></article>`;
}
function tkListRowHtml(t){
  const c = clients.find(x => x.id === t.clientId), [due, kind] = tkDue(t), done = t.status === 'done';
  return `<div class="tk-lr${done ? ' is-done' : ''}${window._taskSel === t.id ? ' is-sel' : ''}" role="button" tabindex="0" onclick="selectTask('${t.id}')" onkeydown="if(event.key==='Enter'&&event.target===this)selectTask('${t.id}')">${tkCb(t)}
<div class="tx"><b>${t.color && !done ? `<i class="cc-dot c-${t.color}" aria-hidden="true"></i>` : ''}${escapeHtml(t.title)}${t.priority === 'high' && !done ? `<span class="tk-flag" title="High priority">${icon('flag', { fill: true })}</span>` : ''}</b><span class="s">${c ? escapeHtml(c.name) + ' · ' : ''}${escapeHtml(tkWho(t.assigneeId))}</span></div>
<span class="tk-due ${kind}">${escapeHtml(done && t.completedAt ? 'Done ' + fmtShortDate(new Date(t.completedAt)) : due)}</span></div>`;
}

function renderTasks(){
  const root = document.getElementById('tasksRoot');
  if(!root || !currentUser) return;
  const me = currentUser.id, today = toDateStr(new Date());
  let vis = tasks.filter(t => !t.cancelledAt && (t.assignerId === me || t.assigneeId === me) && !(t.status === 'done' && ((t.assignerId === me && t.hiddenByAssigner) || (t.assigneeId === me && t.hiddenByAssignee))));
  // Approvers and admins switch between Everyone (every task they're part of) and Mine. A team
  // member sees the tasks assigned to them, and the ones they handed to someone else on their own.
  const everyone = seesEveryone();
  const mineN = vis.filter(t => t.assigneeId === me && t.status !== 'done').length;
  const byMe = vis.filter(t => t.assignerId === me && t.assigneeId !== me), byMeN = byMe.filter(t => t.status !== 'done').length;
  if(!everyone && (tasksScope === 'everyone' || (tasksScope === 'byme' && !byMe.length))) tasksScope = 'mine';
  if(tasksScope === 'mine') vis = vis.filter(t => t.assigneeId === me);
  else if(tasksScope === 'byme') vis = byMe;
  if(tasksClient !== 'all') vis = vis.filter(t => t.clientId === tasksClient);
  const open = vis.filter(t => t.status !== 'done'), overdue = open.filter(t => t.dueDate && t.dueDate < today);
  const review = open.filter(t => t.status === 'in_review' && t.assignerId === me);
  const order = (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || (a.priority === 'high' ? -1 : 0) - (b.priority === 'high' ? -1 : 0) || new Date(b.createdAt) - new Date(a.createdAt);
  const monday = dayStart(addDays(new Date(), -((new Date().getDay() + 6) % 7)));
  const done = vis.filter(t => t.status === 'done').sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0));
  const doneWeek = done.filter(t => t.completedAt && new Date(t.completedAt) >= monday);
  const usedClients = [...new Set(tasks.map(t => t.clientId).filter(Boolean))].map(id => clients.find(c => c.id === id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  const curC = usedClients.find(c => c.id === tasksClient);
  const sub = [overdue.length ? `<b>${overdue.length} ${overdue.length === 1 ? 'is' : 'are'} overdue.</b>` : '', review.length ? `${review.length} ${review.length === 1 ? 'is' : 'are'} waiting on your review.` : ''].filter(Boolean).join(' ') || (open.length ? 'Nothing is overdue.' : 'Nothing open right now.');
  const head = `<div class="tk-hd"><div><h2>${open.length ? `${open.length} open task${open.length === 1 ? '' : 's'}` : 'No open tasks'}</h2><p>${sub}</p></div>
<div class="tk-f">${(everyone ? [['everyone', 'Everyone', ''], ['mine', 'Mine', mineN]] : byMe.length ? [['mine', 'Mine', mineN], ['byme', 'Assigned by Me', byMeN]] : [])
  .map(([k, t, n], i, a) => (i ? '' : '<div class="seg" role="tablist" aria-label="Whose">') + `<button class="${tasksScope === k ? 'on' : ''}" role="tab" aria-selected="${tasksScope === k}" onclick="setTasksScope('${k}')">${t}${n !== '' ? ` <span class="c">${n}</span>` : ''}</button>` + (i === a.length - 1 ? '</div>' : '')).join('')}
<label class="pop pop-sel"><span class="pl">Client: ${escapeHtml(curC ? curC.name : 'All')}</span>${icon('caret-down')}<select aria-label="Client" onchange="setTasksClient(this.value)"><option value="all">All</option>${usedClients.map(c => `<option value="${c.id}"${c === curC ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select></label>
<div class="seg tk-view" role="tablist" aria-label="Layout"><button class="${tasksLayout === 'list' ? 'on' : ''}" role="tab" aria-selected="${tasksLayout === 'list'}" onclick="setTasksLayout('list')">${icon('list-bullets')}List</button><button class="${tasksLayout === 'columns' ? 'on' : ''}" role="tab" aria-selected="${tasksLayout === 'columns'}" onclick="setTasksLayout('columns')">${icon('squares-four')}Columns</button></div></div></div>`;
  const doneRows = (doneWeek.length ? doneWeek : done.slice(0, 3)).slice(0, 6).map(t => { const c = clients.find(x => x.id === t.clientId);
    return `<div class="tk-d" role="button" tabindex="0" onclick="selectTask('${t.id}')" onkeydown="if(event.key==='Enter')selectTask('${t.id}')">${tkCb(t)}<div class="tx"><b>${escapeHtml(t.title)}</b><span class="s">${[c ? c.name : '', tkWho(t.assigneeId), t.completedAt ? fmtShortDate(new Date(t.completedAt)) : ''].filter(Boolean).map(escapeHtml).join(' · ')}</span></div></div>`; }).join('');
  const doneCol = `<section class="tk-col tk-done" aria-label="Done"><div class="tk-ch"><b>Done</b><span>${doneWeek.length ? `${doneWeek.length} this week` : 'None this week'}</span></div>${doneRows}<a class="x-lnk tk-arch" href="#" onclick="switchView('task-archive');return false;">Finished tasks</a></section>`;
  let body;
  // Nothing at all to show here: say what goes here and give the way in, instead of empty columns.
  const anyMine = tasks.some(t => !t.cancelledAt && (t.assignerId === me || t.assigneeId === me));
  const tkEmpty = !open.length && !done.length ? (tasksClient !== 'all'
      ? emptyState({ icon: 'list-checks', title: 'No tasks for this client', text: 'Tasks for a client show here, with who has them and when they’re due.', action: 'New Task', actionIcon: 'plus', onAction: "openNewTaskModal(undefined,'todo',{clientId:'" + tasksClient + "'})", link: 'All Clients', onLink: "setTasksClient('all')" })
    : tasksScope !== 'everyone' && anyMine
      ? emptyState({ icon: 'check-circle', tone: 'ok', title: tasksScope === 'byme' ? 'Nothing you’ve handed out is open' : 'Nothing on you', text: tasksScope === 'byme' ? 'Tasks you give someone else show here until they’re done.' : 'Tasks given to you show here, with when they’re due.', action: 'New Task', actionIcon: 'plus', onAction: 'openNewTaskModal()', link: everyone ? 'Show Everyone' : '', onLink: "setTasksScope('everyone')" })
    : emptyState({ icon: 'list-checks', tone: 'blue', title: 'No tasks yet', text: 'Give yourself or a teammate something to do, for a client or not. Tasks show here by stage, and on Today and your calendar when they’re due.', action: 'New Task', actionIcon: 'plus', onAction: 'openNewTaskModal()' })) : '';
  if(tkEmpty) body = `<div class="tk-list">${tkEmpty}</div>`;
  else if(tasksLayout === 'list'){
    body = TASK_COLS.map(([k, label]) => { const ts = open.filter(t => t.status === k).sort(order);
      return ts.length ? `<div class="tk-ls"><b>${label}</b><span>${ts.length}</span><button class="ib" aria-label="Add a task to ${label}" title="New task" onclick="openNewTaskModal(undefined,'${k}')">${icon('plus')}</button></div>${ts.map(tkListRowHtml).join('')}` : ''; }).join('')
      + (done.length ? `<div class="tk-ls"><b>Done</b><span>${doneWeek.length ? `${doneWeek.length} this week` : ''}</span></div>${(doneWeek.length ? doneWeek : done.slice(0, 3)).map(tkListRowHtml).join('')}<a class="x-lnk tk-arch" href="#" onclick="switchView('task-archive');return false;">Finished tasks</a>` : '');
    body = `<div class="tk-list">${body}</div>`;
  } else {
    body = `<div class="tk-board">${TASK_COLS.map(([k, label]) => { const ts = open.filter(t => t.status === k).sort(order);
      return `<section class="tk-col" aria-label="${label}"><div class="tk-ch"><b>${label}</b><span>${ts.length}</span><button class="ib" aria-label="Add a task to ${label}" title="New task" onclick="openNewTaskModal(undefined,'${k}')">${icon('plus')}</button></div>${ts.map(tkCardHtml).join('') || `<p class="tk-none">Nothing here.</p>`}</section>`; }).join('')}${doneCol}</div>`;
  }
  const sel = window._taskSel && tasks.find(t => t.id === window._taskSel);
  if(window._taskSel && !sel) window._taskSel = null;
  const prev = root.querySelector('.sp-page')?.scrollTop || 0, prevSp = root.querySelector('.sp:not(.sp-leaving)')?.scrollTop || 0, cmt = document.getElementById('tkpCmt')?.value || '';
  root.innerHTML = `<div class="spw"><div class="sp-page"><div class="tk">${head}${body}</div></div>${sel ? taskPanelHtml(sel) : ''}</div>`;
  const sp = root.querySelector('.sp-page'); if(sp) sp.scrollTop = prev;
  const pn = root.querySelector('.sp:not(.sp-leaving)'); if(pn){ pn.scrollTop = prevSp; pn._st = prevSp; }
  const ci = document.getElementById('tkpCmt'); if(ci && cmt) ci.value = cmt;
  if(currentViewName === 'tasks') setToolbar(null, `${open.length} open${overdue.length ? ` · ${overdue.length} overdue` : ''}`);
  if(typeof updateTasksNavBadge === 'function') updateTasksNavBadge();
}

// ---- the panel -------------------------------------------------------------------------------
const TK_CK = /^\s*(?:[-*]\s*)?\[( |x|X)\]\s?(.*)$/;
function tkSplitDesc(desc){
  const notes = [], ck = [];
  String(desc || '').split('\n').forEach((l, i) => { const m = l.match(TK_CK); if(m) ck.push({ i, on: !!m[1].trim(), t: m[2] }); else notes.push(l); });
  return { notes: notes.join('\n').trim(), ck };
}
async function toggleTaskCheck(id, line){
  const t = tasks.find(x => x.id === id); if(!t) return;
  const lines = String(t.description || '').split('\n'), m = (lines[line] || '').match(TK_CK); if(!m) return;
  lines[line] = `- [${m[1].trim() ? ' ' : 'x'}] ${m[2]}`;
  const description = lines.join('\n'), before = t.description;
  t.description = description; renderTasks();
  const { error } = await supabaseClient.from('tasks').update({ description }).eq('id', id);
  if(error){ t.description = before; renderTasks(); showToast('error', 'Not saved', error.message); }
}
async function remindTaskAssignee(id){
  const t = tasks.find(x => x.id === id); if(!t) return;
  const who = teamProfiles.find(p => p.id === t.assigneeId); if(!who) return;
  const [due] = tkDue(t);
  await sendNotification(t.assigneeId, 'task_reminder', `Reminder: ${t.title}`, `${myName() || 'Someone'} is checking in on this${due ? ` (${due.toLowerCase()})` : ''}.`, 'tasks', t.id);
  addTaskActivity(id, { at: new Date().toISOString(), text: `<b>You</b> reminded ${escapeHtml(firstName(who.name))}` });
  showToast('success', `Reminded ${firstName(who.name)}`, 'They’ll see it in their notifications.');
  renderTasks();
}
// The color, changed from the panel (only the person who assigned it can change it).
async function setTaskColor(v){
  const t = tasks.find(x => x.id === window._taskSel); if(!t || t.assignerId !== currentUser?.id) return;
  const before = t.color; t.color = v; renderTasks();
  const { error } = await supabaseClient.from('tasks').update({ color: v }).eq('id', t.id);
  if(error){ t.color = before; renderTasks(); if(isMissingColumnError(error)) warnNoColorColumn('Color not saved'); else showToast('error', 'Color not saved', error.message); }
}
// Things that happened this session that aren't stored anywhere (a reminder sent).
const taskSessionActivity = {};
function addTaskActivity(id, ev){ (taskSessionActivity[id] = taskSessionActivity[id] || []).push(ev); }

// Comments live in task_comments (addendum-task-comments.sql); until that has been run the
// panel shows no comment box.
let taskComments = {}, taskCommentsReady = null;
async function loadTaskComments(id){
  if(taskCommentsReady === false) return;
  const { data, error } = await supabaseClient.from('task_comments').select('id, task_id, user_id, body, created_at').eq('task_id', id).order('created_at', { ascending: true });
  if(error){ if(/task_comments|relation|schema cache|does not exist/i.test(error.message || '') || error.code === '42P01' || error.code === 'PGRST205') taskCommentsReady = false; return; }
  taskCommentsReady = true;
  taskComments[id] = data || [];
  if(window._taskSel === id) renderTasks();
}
async function postTaskComment(id){
  const el = document.getElementById('tkpCmt'), body = (el?.value || '').trim();
  if(!body) return;
  const t = tasks.find(x => x.id === id); if(!t) return;
  el.disabled = true;
  const { data, error } = await supabaseClient.from('task_comments').insert({ task_id: id, user_id: currentUser.id, body }).select().single();
  el.disabled = false;
  if(error){ showToast('error', 'Comment not posted', error.message); return; }
  el.value = '';
  (taskComments[id] = taskComments[id] || []).push(data || { user_id: currentUser.id, body, created_at: new Date().toISOString() });
  const other = t.assignerId === currentUser.id ? t.assigneeId : t.assignerId;
  if(other && other !== currentUser.id) sendNotification(other, 'task_comment', `${myName() || 'Someone'} commented on “${t.title}”`, body.length > 140 ? body.slice(0, 140) + '…' : body, 'tasks', t.id);
  renderTasks();
  setTimeout(() => document.getElementById('tkpCmt')?.focus(), 0);
}

function taskPanelHtml(t){
  const me = currentUser.id, amAssigner = t.assignerId === me, amAssignee = t.assigneeId === me, done = t.status === 'done';
  const c = clients.find(x => x.id === t.clientId), assignee = teamProfiles.find(p => p.id === t.assigneeId), assigner = teamProfiles.find(p => p.id === t.assignerId);
  const today = toDateStr(new Date()), late = !done && t.dueDate && t.dueDate < today;
  const hhmm = typeof taskDueTimes !== 'undefined' ? taskDueTimes[t.id] : '';
  const dueTxt = t.dueDate ? (() => { const d = new Date(t.dueDate + 'T12:00:00'), k = daysBetween(dayStart(new Date()), dayStart(d));
    const day = k === 0 ? 'Today' : k === -1 ? 'Yesterday' : k === 1 ? 'Tomorrow' : DAY_NAMES[d.getDay()].slice(0, 3);
    return `${day}, ${fmtShortDate(d)}${hhmm ? ' at ' + fmtTime(atTime(d, hhmm)) : ''}`; })() : 'No due date';
  const moves = Object.keys(TASK_STAGE_LABEL).filter(k => k === t.status || k !== 'done' || amAssignee);
  const status = done ? `<span class="tkp-st">${icon('check-circle')}Done${t.completedAt ? ' ' + fmtShortDate(new Date(t.completedAt)) : ''}</span>`
    : (amAssigner || amAssignee) ? `<label class="pop pop-sel"><span class="pl">${TASK_STAGE_LABEL[t.status] || 'To Do'}</span>${icon('caret-down')}<select aria-label="Status" onchange="moveTaskToStatus('${t.id}', this.value)">${moves.map(k => `<option value="${k}"${k === t.status ? ' selected' : ''}>${TASK_STAGE_LABEL[k]}</option>`).join('')}</select></label>` : escapeHtml(TASK_STAGE_LABEL[t.status] || '');
  const assigned = amAssigner && !amAssignee ? `${escapeHtml(assignee ? assignee.name : 'Someone no longer on the team')} <em>by you</em>`
    : amAssignee && !amAssigner ? `You <em>from ${escapeHtml(assigner ? assigner.name : 'someone')}</em>` : 'You';
  let acts = '';
  if(!done){
    const remind = amAssigner && !amAssignee && assignee ? `<button class="btn${amAssignee ? '' : ' btn-p'}" onclick="remindTaskAssignee('${t.id}')">${icon('bell-ring')}Remind ${escapeHtml(firstName(assignee.name))}</button>` : '';
    const mark = amAssignee ? `<button class="btn btn-p" onclick="moveTaskToStatus('${t.id}','done')">${icon('check')}Mark Done</button>` : '';
    acts = remind || mark ? `<div class="tkp-acts">${remind}${mark}</div>` : '';
  } else if(amAssignee || amAssigner){
    acts = `<div class="tkp-acts"><button class="btn" onclick="hideTaskFromMyList('${t.id}')">${icon('archive')}Archive</button></div>`;
  }
  const { notes, ck } = tkSplitDesc(t.description);
  const ckDone = ck.filter(x => x.on).length;
  const ckHtml = ck.map(x => `<div class="tkp-ck${x.on ? ' on' : ''}"><button class="tk-cb${x.on ? ' on' : ''}" role="checkbox" aria-checked="${x.on}" aria-label="${escapeHtml(x.t)}"${amAssigner || amAssignee ? ` onclick="toggleTaskCheck('${t.id}', ${x.i})"` : ' disabled'}>${x.on ? icon('check', { weight: 'bold' }) : ''}</button><span>${escapeHtml(x.t)}</span></div>`).join('');
  const linked = (typeof calendarEvents !== 'undefined' ? calendarEvents : []).find(e => e.relatedTaskId === t.id);
  const sp = t.sprintId && typeof planSprints !== 'undefined' ? planSprints.find(x => x.id === t.sprintId) : null;
  // what happened: comments, plus what the task's own dates say
  const ev = [];
  if(t.createdAt) ev.push({ at: t.createdAt, html: amAssigner ? (amAssignee ? '<b>You</b> created this' : `<b>You</b> assigned this to ${escapeHtml(firstName(assignee ? assignee.name : 'someone'))}`) : `<b>${escapeHtml(firstName(assigner ? assigner.name : 'Someone'))}</b> assigned this to you` });
  if(done && t.completedAt) ev.push({ at: t.completedAt, html: `<b>${escapeHtml(tkWho(t.assigneeId))}</b> marked it done${t.completionNotes ? ': ' + escapeHtml(t.completionNotes) : ''}` });
  (taskComments[t.id] || []).forEach(m => ev.push({ at: m.created_at, html: `<b>${escapeHtml(tkWho(m.user_id))}</b>: ${escapeHtml(m.body)}` }));
  (taskSessionActivity[t.id] || []).forEach(x => ev.push({ at: x.at, html: x.text }));
  ev.sort((a, b) => new Date(b.at) - new Date(a.at));
  const when = at => { const d = new Date(at), k = daysBetween(dayStart(d), dayStart(new Date())); return k === 0 ? 'Today' : k === 1 ? 'Yesterday' : fmtShortDate(d); };
  const evHtml = ev.map(e => `<div class="tkp-a"><span class="tkp-ad">${when(e.at)}</span><span>${e.html}</span></div>`).join('');
  const more = [];
  if(t.dueDate && !linked && !done) more.push(`<button class="mi" onclick="addTaskToCalendar('${t.id}')">${icon('calendar-plus')}Add to Calendar</button>`);
  if(amAssignee && !done && !sp && typeof openNewSprintModal === 'function') more.push(`<button class="mi" onclick="openNewSprintModal({ taskId: '${t.id}' })">${icon('route')}Plan a Sprint…</button>`);
  if(amAssigner && !done) more.push(`${more.length ? '<div class="msep"></div>' : ''}<button class="mi danger" onclick="cancelTask('${t.id}')">${icon('x')}Cancel Task…</button>`);
  if(done && hasPermission('delete_tasks')) more.push(`<div class="msep"></div><button class="mi danger" onclick="deleteTaskPermanently('${t.id}')">${icon('trash')}Delete…</button>`);
  return `<aside class="sp tkp" aria-label="${escapeHtml(t.title)}">
<div class="sp-bar"><button class="ib" aria-label="Close" onclick="closeTaskPanel()">${icon('x')}</button><span class="tkp-bar">${amAssigner && !done ? `<a class="x-lnk" href="#" onclick="openEditTaskModal('${t.id}');return false;">Edit</a>` : ''}${more.length ? `<button class="ib" aria-label="More" title="More" onclick="tkMore(event, '${t.id}')">${icon('dots-three')}</button><template id="tkMoreItems">${more.join('')}</template>` : ''}</span></div>
<div class="tkp-h">${tkCb(t, 'lg')}<h3>${escapeHtml(t.title)}${t.priority === 'high' && !done ? `<span class="tk-flag" title="High priority">${icon('flag', { fill: true })}</span>` : ''}</h3></div>
<div class="tkp-meta">
${c ? `<span class="tkp-k">Client</span><span class="tkp-v"><a href="#" onclick="openClientDetail('${c.id}');return false;">${tkLogo(c)}${escapeHtml(c.name)}</a></span>` : ''}
<span class="tkp-k">Assigned to</span><span class="tkp-v">${assigned}</span>
<span class="tkp-k">Due</span><span class="tkp-v${late ? ' tkp-late' : ''}">${escapeHtml(dueTxt)}${linked ? `<em>on your calendar</em>` : ''}</span>
<span class="tkp-k">Status</span><span class="tkp-v">${status}</span>
${amAssigner ? `<span class="tkp-k">Color</span><span class="tkp-v">${colorSwatchesHtml('tkpColor', t.color, 'setTaskColor', { small: true })}</span>` : t.color ? `<span class="tkp-k">Color</span><span class="tkp-v"><i class="cc-dot c-${t.color}" aria-hidden="true"></i>${itemColorName(t.color)}</span>` : ''}
${sp ? `<span class="tkp-k">Sprint</span><span class="tkp-v"><a href="#" onclick="openPlanSprint('${sp.id}');return false;"><i class="cc-dot${sp.color ? ' c-' + sp.color : ''}" aria-hidden="true"></i>${escapeHtml(sp.title)}</a></span>` : ''}
${t.link ? `<span class="tkp-k">Link</span><span class="tkp-v"><a href="${safeUrl(normalizeUrl(t.link))}" target="_blank" rel="noopener">${escapeHtml(truncateLinkDisplay(t.link, 40))}</a></span>` : ''}
</div>
${acts}
${notes ? `<div class="sp-sec"><b>Notes</b></div><p class="tkp-notes">${escapeHtml(notes)}</p>` : ''}
${ck.length ? `<div class="sp-sec"><b>Checklist</b><span>${ckDone} of ${ck.length}</span></div>${ckHtml}` : ''}
${done && t.completionLink ? `<div class="sp-sec"><b>When it was finished</b></div><p class="tkp-notes"><a href="${safeUrl(normalizeUrl(t.completionLink))}" target="_blank" rel="noopener">${escapeHtml(truncateLinkDisplay(t.completionLink, 46))}</a></p>` : ''}
<div class="sp-sec"><b>Activity</b></div>${evHtml}
${taskCommentsReady ? `<form class="tkp-cmt" onsubmit="event.preventDefault();postTaskComment('${t.id}')"><input id="tkpCmt" class="tf" placeholder="Write a comment…" aria-label="Write a comment" autocomplete="off" maxlength="4000"><button class="btn" type="submit">Post</button></form>` : ''}
</aside>`;
}
function tkMore(e, id){
  e.stopPropagation();
  const had = document.getElementById('tkMenu'); had?.remove(); if(had) return;
  const tpl = document.getElementById('tkMoreItems'); if(!tpl) return;
  const m = document.createElement('div');
  m.className = 'menu'; m.id = 'tkMenu'; m.style.position = 'fixed';
  const r = e.currentTarget.getBoundingClientRect();
  m.style.top = (r.bottom + 4) + 'px'; m.style.right = (window.innerWidth - r.right) + 'px';
  m.innerHTML = tpl.innerHTML;
  document.body.appendChild(m);
  setTimeout(() => document.addEventListener('click', () => m.remove(), { once: true }), 0);
}
