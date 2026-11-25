// Tasks, as on the canvas boards TasksNew and TasksOpen: the columns with more room and
// lighter cards, a name instead of an avatar, overdue and waiting-on-you said in words, and a
// quiet Done column. Clicking a task opens it on the right, the same panel as This Week,
// Health and Focus Reports. Loaded after sheets2-canvas.js.

let tasksScope = 'everyone', tasksClient = 'all', tasksLayout = (() => { try{ return localStorage.getItem('bda_tasks_layout') || 'columns'; }catch(e){ return 'columns'; } })();
const TASK_COLS = [['todo', 'To Do'], ['in_progress', 'In Progress'], ['in_review', 'Review']];
function setTasksScope(v){ tasksScope = v; renderTasks(); }
function setTasksClient(v){ tasksClient = v; renderTasks(); }
function setTasksLayout(v){ tasksLayout = v; try{ localStorage.setItem('bda_tasks_layout', v); }catch(e){} renderTasks(); }
function selectTask(id){ window._taskSel = window._taskSel === id ? null : id; if(window._taskSel && typeof notifSeenFor === 'function') notifSeenFor(id); renderTasks(); if(window._taskSel) loadTaskComments(id); }
function closeTaskPanel(){ window._taskSel = null; renderTasks(); }

// Anywhere else in the app a task still opens as a sheet; on Tasks it opens in the panel.
window.openTaskDetailModal = (sheet => function(id){
  if(typeof currentViewName !== 'undefined' && currentViewName === 'tasks' && document.getElementById('tasksRoot')){
    closeAppModal(); window._taskSel = id; renderTasks(); loadTaskComments(id); return;
  }
  sheet(id);
})(window.openTaskDetailModal);

const tkWho = id => id === currentUser?.id ? 'You' : firstName((teamProfiles.find(p => p.id === id) || {}).name || 'Someone');
// When it's due, in words: "Due yesterday", "6 days late", "Today, 2:00 PM", "Fri, Nov 20",
// "Waiting on your review". Past days are counted, never named: "Due Wednesday" read as the
// coming Wednesday when it meant the last one.
function tkDue(t){
  if(t.status === 'in_review' && t.assignerId === currentUser?.id) return ['Waiting on your review', 'is-you'];
  if(!t.dueDate) return ['', ''];
  const today = toDateStr(new Date()), d = new Date(t.dueDate + 'T12:00:00');
  const hhmm = typeof taskDueTimes !== 'undefined' ? taskDueTimes[t.id] : '', tm = hhmm ? ', ' + fmtTime(atTime(d, hhmm)) : '';
  if(t.dueDate < today){
    const n = daysBetween(dayStart(d), dayStart(new Date()));
    return [n === 1 ? 'Due yesterday' : `${n} days late`, 'is-late'];
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
// A task you gave someone that's past due: Remind, right on its row (Nov 24)
function tkRemindBtn(t){
  const today = toDateStr(new Date());
  if(t.status === 'done' || t.cancelledAt || t.assignerId !== currentUser?.id || t.assigneeId === currentUser?.id || !t.dueDate || t.dueDate >= today || typeof nudgeSheet !== 'function') return '';
  const who = tkWho(t.assigneeId);
  return `<button class="ib tk-remind" aria-label="Remind ${escapeHtml(who)}" title="Remind ${escapeHtml(who)} on Slack" onclick="event.stopPropagation();remindTaskAssignee('${t.id}')">${icon('paper-plane-tilt')}</button>`;
}
// ---- sprints in Tasks (Nov 25): one row per sprint, its next step (sprintFold in data.js) ----
let tkFoldNow = null;                 // this render's sprints, by the step that stands for them
const tkSprintOpen = new Set();       // sprints showing all their steps
// Showing and hiding the steps opens them in place (Nov 25): no new render, so the list doesn't jump
// and the height eases open and shut (the CSS: .tk-steps-w). The set keeps it through later renders.
function tkSprintMoreWords(n){ return `${n} more step${n === 1 ? '' : 's'}`; }
function tkSprintToggle(e, sid){
  e.stopPropagation();
  const open = !tkSprintOpen.has(sid);
  open ? tkSprintOpen.add(sid) : tkSprintOpen.delete(sid);
  document.querySelectorAll(`[data-sprint="${sid}"]`).forEach(el => {
    el.classList.toggle('sp-open', open);
    el.querySelectorAll('.tk-more').forEach(b => { b.setAttribute('aria-expanded', open); b.textContent = open ? 'Hide steps' : tkSprintMoreWords(+b.dataset.n || 0); });
  });
}
function tkSprintPlan(e, sid){ e.stopPropagation(); if(typeof openPlanSprint === 'function') openPlanSprint(sid); else switchView('plan'); }
function tkSprintLabel(g){
  return `<span class="tk-sp">${icon('plan')}<span class="tk-sp-n">Sprint · ${escapeHtml(g.sprint.title)}</span><span class="tk-sp-c">${g.done} of ${g.total} done</span></span>`;
}
function tkSprintLate(g){ return g.late > 1 ? `<span class="tk-sp-late">${g.late} late</span>` : ''; }
function tkSprintBtn(g){
  const open = tkSprintOpen.has(g.sprint.id), n = g.rest.length;
  return n ? `<button class="tk-more" data-n="${n}" aria-expanded="${open}" onclick="tkSprintToggle(event,'${g.sprint.id}')">${open ? 'Hide steps' : tkSprintMoreWords(n)}</button>` : '';
}
function tkSprintMore(g){ return tkSprintLate(g) + tkSprintBtn(g); }
// the steps are always there, folded to no height until shown
function tkSprintAttrs(g){ return ` data-sprint="${g.sprint.id}"`; }
function tkSprintSteps(g){
  if(!g.rest.length) return '';
  return `<div class="tk-steps-w"><div class="tk-steps-c"><div class="tk-steps">${g.rest.map(t => { const [due, kind] = tkDue(t);
    return `<div class="tk-st${window._taskSel === t.id ? ' is-sel' : ''}" role="button" tabindex="0" onclick="event.stopPropagation();selectTask('${t.id}')" onkeydown="if((event.key==='Enter'||event.key===' ')&&event.target===this){event.preventDefault();event.stopPropagation();selectTask('${t.id}')}">${tkCb(t)}<span class="tx">${escapeHtml(t.title)}</span><span class="tk-due ${kind}">${escapeHtml(due)}</span></div>`; }).join('')}
<button class="x-lnk tk-st-plan" onclick="tkSprintPlan(event,'${g.sprint.id}')">Open Sprint</button></div></div></div>`;
}
function tkCardHtml(t){
  const g = tkFoldNow && tkFoldNow.lead.get(t.id);
  const c = clients.find(x => x.id === t.clientId), [due, kind] = tkDue(t);
  const flag = t.priority === 'high' ? `<span class="tk-flag" title="High priority">${icon('flag')}</span>` : '';
  return `<article class="tk-c${t.color ? ' has-c c-' + t.color : ''}${g && tkSprintOpen.has(g.sprint.id) ? ' sp-open' : ''}${window._taskSel === t.id ? ' is-sel' : ''}"${g ? tkSprintAttrs(g) : ''} role="button" tabindex="0" aria-label="${escapeHtml(t.title)}" onclick="selectTask('${t.id}')" onkeydown="if((event.key==='Enter'||event.key===' ')&&event.target===this){event.preventDefault();selectTask('${t.id}')}">
${g ? tkSprintLabel(g) : ''}<div class="tk-ct">${tkCb(t)}<b>${escapeHtml(t.title)}</b>${flag}</div>
${c ? `<div class="tk-cm"><span class="tk-cl">${escapeHtml(c.name)}${focusMark(c)}</span></div>` : ''}
<div class="tk-cf"><span class="tk-due ${kind}">${escapeHtml(due)}</span><span class="tk-who">${g ? tkSprintMore(g) : escapeHtml(tkWho(t.assigneeId))}</span>${tkRemindBtn(t)}</div>${g ? tkSprintSteps(g) : ''}</article>`;
}
function tkListRowHtml(t){
  const g = t.status !== 'done' && tkFoldNow && tkFoldNow.lead.get(t.id);
  const c = clients.find(x => x.id === t.clientId), [due, kind] = tkDue(t), done = t.status === 'done';
  return `<div class="tk-lr${done ? ' is-done' : ''}${g ? ' is-sprint' : ''}${g && tkSprintOpen.has(g.sprint.id) ? ' sp-open' : ''}${window._taskSel === t.id ? ' is-sel' : ''}"${g ? tkSprintAttrs(g) : ''} role="button" tabindex="0" onclick="selectTask('${t.id}')" onkeydown="if(event.key==='Enter'&&event.target===this)selectTask('${t.id}')">${tkCb(t)}
<div class="tx">${g ? tkSprintLabel(g) : ''}<b>${t.color && !done ? `<i class="cc-dot c-${t.color}" aria-hidden="true"></i>` : ''}${escapeHtml(t.title)}${t.priority === 'high' && !done ? `<span class="tk-flag" title="High priority">${icon('flag')}</span>` : ''}</b><span class="s">${g
    ? [c ? escapeHtml(c.name) + focusMark(c) : '', tkSprintLate(g), tkSprintBtn(g)].filter(Boolean).join(' · ')
    : (c ? escapeHtml(c.name) + focusMark(c) + ' · ' : '') + escapeHtml(tkWho(t.assigneeId))}</span></div>
${tkRemindBtn(t)}<span class="tk-due ${kind}">${escapeHtml(done && t.completedAt ? 'Done ' + fmtShortDate(new Date(t.completedAt)) : due)}</span>${g ? tkSprintSteps(g) : ''}</div>`;
}

function renderTasks(){
  const root = document.getElementById('tasksRoot');
  if(!root || !currentUser) return;
  if(typeof tasksDataLoaded !== 'undefined' && !tasksDataLoaded){ root.innerHTML = `<div class="spw"><div class="sp-page"><div class="tk">${skeletonHtml('tasks', 'Loading tasks…')}</div></div></div>`; return; }
  const me = currentUser.id, today = toDateStr(new Date());
  let vis = tasks.filter(t => !t.cancelledAt && (t.assignerId === me || t.assigneeId === me) && !(t.status === 'done' && ((t.assignerId === me && t.hiddenByAssigner) || (t.assigneeId === me && t.hiddenByAssignee))));
  // Approvers and admins switch between Everyone (every task they're part of) and Mine. A team
  // member sees the tasks assigned to them, and the ones they handed to someone else on their own.
  const everyone = seesEveryone();
  const mineN = sprintFold(vis.filter(t => t.assigneeId === me && t.status !== 'done')).list.length;   // a sprint counts once
  const byMe = vis.filter(t => t.assignerId === me && t.assigneeId !== me), byMeN = byMe.filter(t => t.status !== 'done').length;
  if(!everyone && (tasksScope === 'everyone' || (tasksScope === 'byme' && !byMe.length))) tasksScope = 'mine';
  if(tasksScope === 'mine') vis = vis.filter(t => t.assigneeId === me);
  else if(tasksScope === 'byme') vis = byMe;
  if(tasksClient !== 'all') vis = vis.filter(t => t.clientId === tasksClient);
  const open = vis.filter(t => t.status !== 'done');
  // a sprint's steps fold into one row: its next step (Nov 25). Overdue counts rows too: a sprint
  // with late steps is one late row (it says how many are late).
  const fold = tkFoldNow = sprintFold(open), items = fold.list, overdue = items.filter(t => t.dueDate && t.dueDate < today);
  const review = open.filter(t => t.status === 'in_review' && t.assignerId === me);
  const order = (a, b) => focusIdFirst(a.clientId, b.clientId) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || (a.priority === 'high' ? -1 : 0) - (b.priority === 'high' ? -1 : 0) || new Date(b.createdAt) - new Date(a.createdAt);
  const monday = dayStart(addDays(new Date(), -((new Date().getDay() + 6) % 7)));
  const done = vis.filter(t => t.status === 'done').sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0));
  const doneWeek = done.filter(t => t.completedAt && new Date(t.completedAt) >= monday);
  const usedClients = [...new Set(tasks.map(t => t.clientId).filter(Boolean))].map(id => clients.find(c => c.id === id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  const curC = usedClients.find(c => c.id === tasksClient);
  const sub = [overdue.length ? `<b>${overdue.length} ${overdue.length === 1 ? 'is' : 'are'} overdue.</b>` : '', review.length ? `${review.length} ${review.length === 1 ? 'is' : 'are'} waiting on your review.` : ''].filter(Boolean).join(' ') || (open.length ? 'Nothing is overdue.' : 'Nothing open right now.');
  const head = `<div class="tk-hd"><div><h2>${sprintFoldHeadline(fold, open.length)}</h2><p>${sub}</p></div>
<div class="tk-f">${typeof tkGranolaBtn === 'function' ? tkGranolaBtn() : ''}${typeof tkGmailBtn === 'function' ? tkGmailBtn() : ''}${(everyone ? [['everyone', 'Everyone', ''], ['mine', 'Mine', mineN]] : byMe.length ? [['mine', 'Mine', mineN], ['byme', 'Assigned by Me', byMeN]] : [])
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
    body = TASK_COLS.map(([k, label]) => { const ts = items.filter(t => t.status === k).sort(order);
      return ts.length ? `<div class="tk-ls"><b>${label}</b><span>${ts.length}</span><button class="ib" aria-label="Add a task to ${label}" title="New task" onclick="openNewTaskModal(undefined,'${k}')">${icon('plus')}</button></div>${ts.map(tkListRowHtml).join('')}` : ''; }).join('')
      + (done.length ? `<div class="tk-ls"><b>Done</b><span>${doneWeek.length ? `${doneWeek.length} this week` : ''}</span></div>${(doneWeek.length ? doneWeek : done.slice(0, 3)).map(tkListRowHtml).join('')}<a class="x-lnk tk-arch" href="#" onclick="switchView('task-archive');return false;">Finished tasks</a>` : '');
    body = `<div class="tk-list">${body}</div>`;
  } else {
    body = `<div class="tk-board">${TASK_COLS.map(([k, label]) => { const ts = items.filter(t => t.status === k).sort(order);
      return `<section class="tk-col" aria-label="${label}"><div class="tk-ch"><b>${label}</b><span>${ts.length}</span><button class="ib" aria-label="Add a task to ${label}" title="New task" onclick="openNewTaskModal(undefined,'${k}')">${icon('plus')}</button></div>${ts.map(tkCardHtml).join('') || `<p class="tk-none">Nothing here.</p>`}</section>`; }).join('')}${doneCol}</div>`;
  }
  const sel = window._taskSel && tasks.find(t => t.id === window._taskSel);
  if(window._taskSel && !sel) window._taskSel = null;
  const prev = root.querySelector('.sp-page')?.scrollTop || 0, prevSp = root.querySelector('.sp:not(.sp-leaving)')?.scrollTop || 0, cmt = document.getElementById('tkpCmt')?.value || '';
  const sg = typeof tkSuggestHtml === 'function' ? tkSuggestHtml() : '';   // tasks from meetings (granola.js)
  root.innerHTML = `<div class="spw"><div class="sp-page"><div class="tk">${head}${sg}${body}</div></div>${sel ? taskPanelHtml(sel) : ''}</div>`;
  if(typeof icons8Corner === 'function') icons8Corner(root.querySelector('.sp-page'));   // Icons8's Gmail icon, credited in the corner (Nov 24)
  const sp = root.querySelector('.sp-page'); if(sp) sp.scrollTop = prev;
  const pn = root.querySelector('.sp:not(.sp-leaving)'); if(pn){ pn.scrollTop = prevSp; pn._st = prevSp; }
  const ci = document.getElementById('tkpCmt'); if(ci && cmt) ci.value = cmt;
  tkFillFiles(root);
  if(currentViewName === 'tasks') setToolbar(null, `${items.length} open${overdue.length ? ` · ${overdue.length} overdue` : ''}`);
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
// Remind whoever has a task you assigned (Nov 24): from your Slack, as you, and in their bell; the
// message fits where it stands (past due, due today, coming up).
function remindTaskAssignee(id){
  const t = tasks.find(x => x.id === id); if(!t) return;
  const who = teamProfiles.find(p => p.id === t.assigneeId); if(!who) return;
  const c = t.clientId ? clients.find(x => x.id === t.clientId) : null, today = toDateStr(new Date());
  const what = `“${t.title}”${c ? ` for ${shortClientName(c.name)}` : ''}`;
  const day = t.dueDate ? fmtDay(new Date(t.dueDate + 'T12:00:00')) : '';
  const text = t.dueDate && t.dueDate < today ? `how’s ${what} going? It was due ${day}. Is anything blocking it, or does it need a new date?`
    : t.dueDate === today ? `just checking on ${what}, it’s due today. Will it make it?`
    : `how’s ${what} coming along?${day ? ` It’s due ${day}.` : ''}`;
  const done = () => { addTaskActivity(id, { at: new Date().toISOString(), text: `<b>You</b> reminded ${escapeHtml(firstName(who.name))}` }); renderTasks(); };
  if(typeof nudgeSheet !== 'function'){
    const [due] = tkDue(t);
    sendNotification(t.assigneeId, 'task_reminder', `Reminder: ${t.title}`, `${myName() || 'Someone'} is checking in on this${due ? ` (${due.toLowerCase()})` : ''}.`, 'tasks', t.id);
    showToast('success', `Reminded ${firstName(who.name)}`, 'They’ll see it in their notifications.'); done(); return;
  }
  nudgeSheet({ title: `Remind ${firstName(who.name)}`, sub: t.title, to: [who], text,
    link: { view: 'tasks', id: t.id, label: 'Open the task in Radar' },
    notif: { type: 'task_reminder', title: `${firstName(myName() || 'A teammate')} asks about “${t.title}”` },
    key: 'task:' + t.id, sentWord: 'Reminded', onSent: done });
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
// "Ask Eric" under a date you can't change: drafts the comment in the box below, ready to finish
// with the date you need and post (the post notifies them). With no comment box, a short sheet.
function askTaskDateMove(id){
  const t = tasks.find(x => x.id === id); if(!taskCanAskDate(t)) return;
  const box = document.getElementById('tkpCmt'), text = taskDateAskText(t);
  if(box){
    box.value = text; box.focus(); box.setSelectionRange(text.length, text.length);
    box.closest('form')?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    return;
  }
  const name = escapeHtml(firstName(taskAssignerFor(t).name));
  openAppModal(`<h3>Ask ${name}</h3><p class="t-2" style="margin:0 0 12px">${name} gets it in their notifications.</p>
<textarea id="tkAskText" class="tf" rows="3" spellcheck="true" aria-label="Message">${escapeHtml(text)}</textarea>
<div class="sheet-a"><button class="btn" onclick="closeAppModal()">Cancel</button><button class="btn btn-p" id="tkAskSend" onclick="sendTaskDateAskSheet('${id}')">Send</button></div>`, 440);
  setTimeout(() => { const el = document.getElementById('tkAskText'); if(el){ el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 40);
}
async function sendTaskDateAskSheet(id){
  const t = tasks.find(x => x.id === id), btn = document.getElementById('tkAskSend'); if(!t) return;
  if(btn){ btn.disabled = true; btn.textContent = 'Sending…'; }
  const ok = await sendTaskDateAsk(t, document.getElementById('tkAskText')?.value);
  if(!ok){ if(btn){ btn.disabled = false; btn.textContent = 'Send'; } showToast('info', 'Write a message first', ''); return; }
  closeAppModal(); renderTasks();
  showToast('success', `Asked ${firstName(taskAssignerFor(t).name)}`, 'They’ll see it in their notifications.');
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
    const rWhen = amAssigner && !amAssignee && assignee && typeof nudgeWhenWords === 'function' ? nudgeWhenWords('task:' + t.id, 'Reminded') : '';
    const remind = amAssigner && !amAssignee && assignee ? `<button class="btn${late ? ' btn-p' : ''}" onclick="remindTaskAssignee('${t.id}')">${icon('paper-plane-tilt')}${rWhen ? 'Remind Again…' : `Remind ${escapeHtml(firstName(assignee.name))}…`}</button>${rWhen ? `<span class="nd-when">${escapeHtml(rWhen)}</span>` : ''}` : '';
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
  if(amAssignee && !done && typeof timerState !== 'undefined' && !timerState.running) more.push(`<button class="mi" onclick="openTimerModal(${jsArg(t.clientId || '')},${jsArg(t.title)})">${icon('play')}Start Timer</button>`);
  if(t.dueDate && !linked && !done) more.push(`<button class="mi" onclick="addTaskToCalendar('${t.id}')">${icon('calendar-plus')}Add to Calendar</button>`);
  if(amAssignee && !done && !sp && typeof openNewSprintModal === 'function') more.push(`<button class="mi" onclick="openNewSprintModal({ taskId: '${t.id}' })">${icon('route')}Plan a Sprint…</button>`);
  if(amAssigner && !done) more.push(`${more.length ? '<div class="msep"></div>' : ''}<button class="mi danger" onclick="cancelTask('${t.id}')">${icon('x')}Cancel Task…</button>`);
  if(done && hasPermission('delete_tasks')) more.push(`<div class="msep"></div><button class="mi danger" onclick="deleteTaskPermanently('${t.id}')">${icon('trash')}Delete…</button>`);
  const dropOk = amAssigner || amAssignee || canApprove();
  return `<aside class="sp tkp" aria-label="${escapeHtml(t.title)}"${dropOk ? ` ondragenter="tkFilesDrag(event,true)" ondragover="tkFilesDrag(event,true)" ondragleave="tkFilesDrag(event,false)" ondrop="tkFilesDrop(event,'${t.id}')"` : ''}>
<div class="sp-bar"><button class="ib" aria-label="Close" onclick="closeTaskPanel()">${icon('x')}</button><span class="tkp-bar">${amAssigner && !done ? `<a class="x-lnk" href="#" onclick="openEditTaskModal('${t.id}');return false;">Edit</a>` : ''}${more.length ? `<button class="ib" aria-label="More" title="More" onclick="tkMore(event, '${t.id}')">${icon('dots-three')}</button><template id="tkMoreItems">${more.join('')}</template>` : ''}</span></div>
<div class="tkp-h">${tkCb(t, 'lg')}<h3>${escapeHtml(t.title)}${t.priority === 'high' && !done ? `<span class="tk-flag" title="High priority">${icon('flag')}</span>` : ''}</h3></div>
<div class="tkp-meta">
${c ? `<span class="tkp-k">Client</span><span class="tkp-v"><a href="#" onclick="openClientDetail('${c.id}');return false;">${escapeHtml(c.name)}</a></span>` : ''}
<span class="tkp-k">Assigned to</span><span class="tkp-v">${assigned}</span>
<span class="tkp-k">Due</span><span class="tkp-v${late ? ' tkp-late' : ''}">${escapeHtml(dueTxt)}${late && t.dueDate < toDateStr(addDays(new Date(), -1)) ? `<em>${escapeHtml(tkDue({ ...t, status: 'todo' })[0])}</em>` : ''}${linked ? `<em>on your calendar</em>` : ''}</span>
${taskCanAskDate(t) ? `<span class="tkp-k" aria-hidden="true"></span><span class="tkp-ask">Only ${escapeHtml(firstName(assigner.name))} can change the date.<a class="x-lnk" href="#" onclick="askTaskDateMove('${t.id}');return false;">Ask ${escapeHtml(firstName(assigner.name))}</a></span>` : ''}
<span class="tkp-k">Status</span><span class="tkp-v">${status}</span>
${amAssigner ? `<span class="tkp-k">Color</span><span class="tkp-v">${colorSwatchesHtml('tkpColor', t.color, 'setTaskColor', { small: true })}</span>` : t.color ? `<span class="tkp-k">Color</span><span class="tkp-v"><i class="cc-dot c-${t.color}" aria-hidden="true"></i>${itemColorName(t.color)}</span>` : ''}
${sp ? `<span class="tkp-k">Sprint</span><span class="tkp-v"><a href="#" onclick="openPlanSprint('${sp.id}');return false;"><i class="cc-dot${sp.color ? ' c-' + sp.color : ''}" aria-hidden="true"></i>${escapeHtml(sp.title)}</a></span>${tkpSprintLine(sp)}` : ''}
${t.link ? `<span class="tkp-k">Link</span><span class="tkp-v"><a href="${safeUrl(normalizeUrl(t.link))}" target="_blank" rel="noopener">${escapeHtml(truncateLinkDisplay(t.link, 40))}</a></span>` : ''}
${(() => { const wa = typeof waTasks !== 'undefined' ? waTasks.find(x => x.task_id != null && String(x.task_id) === String(t.id)) : null;
  return wa ? `<span class="tkp-k">WhatsApp</span><span class="tkp-v"><a href="#" onclick="waOpenItem(${jsArg(wa.id)});return false;">${escapeHtml(waGroupName(wa) ? waCleanName(waGroupName(wa)) + ' group' : waClientLabel(wa))}</a>${wa.status === 'done' ? '<em>done</em>' : ''}</span>` : ''; })()}
</div>
${acts}
${notes ? `<div class="sp-sec"><b>Notes</b></div><p class="tkp-notes">${escapeHtml(notes)}</p>` : ''}
${tkFilesHtml(t, amAssigner || amAssignee || canApprove())}
${ck.length ? `<div class="sp-sec"><b>Checklist</b><span>${ckDone} of ${ck.length}</span></div>${ckHtml}` : ''}
${done && t.completionLink ? `<div class="sp-sec"><b>When it was finished</b></div><p class="tkp-notes"><a href="${safeUrl(normalizeUrl(t.completionLink))}" target="_blank" rel="noopener">${escapeHtml(truncateLinkDisplay(t.completionLink, 46))}</a></p>` : ''}
<div class="sp-sec"><b>Activity</b></div>${evHtml}
${taskCommentsReady ? `<form class="tkp-cmt" onsubmit="event.preventDefault();postTaskComment('${t.id}')"><input id="tkpCmt" class="tf" placeholder="Write a comment…" aria-label="Write a comment" autocomplete="off" maxlength="4000"><button class="btn" type="submit">Post</button></form>` : ''}
</aside>`;
}
// Under the sprint's name in a step's panel (Nov 25): how far along it is, and Open Sprint (Plan, with
// the sprint picked).
function tkpSprintLine(sp){
  const all = tasks.filter(x => x.sprintId === sp.id && !x.cancelledAt), done = all.filter(x => x.status === 'done').length;
  return `<span class="tkp-k" aria-hidden="true"></span><span class="tkp-sp"><span>${done} of ${all.length} step${all.length === 1 ? '' : 's'} done${sp.doneAt ? ' · sprint done' : ''}</span><button class="x-lnk" onclick="openPlanSprint('${sp.id}')">Open Sprint</button></span>`;
}
// ---- Files on a task (Nov 23): listed in its panel; click opens one (an image in the viewer), ----
// Add Files… or dropping files on the panel attaches more, × takes one off.
const tkFileUrls = {};   // path -> { url, at }: signed links last an hour, reused for 50 minutes
function tkFilesHtml(t, can){
  const files = t.attachments || [];
  if(!files.length && !can) return '';
  const kb = n => !n ? '' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  const row = a => { const img = tkIsImg(a.name); return `<a class="tkp-file${img ? ' is-img' : ''}" href="#" data-path="${escapeHtml(a.path)}" data-name="${escapeHtml(a.name)}" target="_blank" rel="noopener" title="${img ? 'Preview' : 'Open'} ${escapeHtml(a.name)}" onclick="return tkOpenFile(event, this)"><span class="tkp-th">${icon(img ? 'image' : 'file-text')}</span><span class="nm">${escapeHtml(a.name)}</span><span class="sz">${kb(a.size)}</span>${can ? `<button class="ib" aria-label="Remove ${escapeHtml(a.name)}" title="Remove" onclick="event.preventDefault();event.stopPropagation();tkRemoveFile('${t.id}',${jsArg(a.path)},${jsArg(a.name)})">${icon('x')}</button>` : ''}</a>`; };
  return `<div class="sp-sec tkp-fh"><b>Files</b>${files.length ? `<span>${files.length}</span>` : ''}${can ? `<label class="x-lnk tkp-fadd">Add Files…<input type="file" multiple hidden onchange="tkAddFiles('${t.id}', this.files);this.value=''"></label>` : ''}</div>
${files.length ? `<div class="tkp-files">${files.map(row).join('')}</div>` : `<p class="tkp-fnone">No files yet. Add some, or drop them on this panel.</p>`}`;
}
async function tkFillFiles(root){
  const links = [...(root || document).querySelectorAll('.tkp-file[data-path]')];
  for(const a of links){
    const p = a.dataset.path, hit = tkFileUrls[p];
    let url = hit && Date.now() - hit.at < 50 * 60000 ? hit.url : null;
    if(!url){ const { data } = await supabaseClient.storage.from('attachments').createSignedUrl(p, 3600); url = data && data.signedUrl; if(url) tkFileUrls[p] = { url, at: Date.now() }; }
    if(url && a.isConnected){
      a.href = url; a.dataset.ready = '1';
      const th = a.querySelector('.tkp-th');
      if(th && tkIsImg(a.dataset.name) && !th.querySelector('img')){ const im = new Image(); im.alt = ''; im.decoding = 'async'; im.onload = () => im.classList.add('on'); im.onerror = () => im.remove(); im.src = url; th.replaceChildren(im); }
    }
  }
}
// Pictures the browser can show; HEIC and other files open in a new tab instead.
function tkIsImg(name){ return /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(name || ''); }
// A picture opens in the viewer, with the task's other pictures a step away; a file opens in a new tab.
function tkOpenFile(e, a){
  const img = tkIsImg(a.dataset.name);
  if(a.dataset.ready && !img) return true;
  e.preventDefault();
  const open = url => {
    if(!img) return window.open(url, '_blank', 'noopener');
    const set = [...(a.closest('.tkp-files') || document).querySelectorAll('.tkp-file.is-img[data-ready]')].map(x => ({ url: x === a ? url : x.href, name: x.dataset.name }));
    openImageLightbox(url, a.dataset.name, set);
  };
  if(a.dataset.ready){ open(a.href); return false; }
  supabaseClient.storage.from('attachments').createSignedUrl(a.dataset.path, 3600).then(({ data }) => {
    if(!data || !data.signedUrl) return showToast('error', 'Couldn’t open the file', 'Try again in a moment.');
    open(data.signedUrl);
  });
  return false;
}
async function tkAddFiles(taskId, list){
  const files = [].slice.call(list || []); if(!files.length) return;
  showToast('info', `Attaching ${files.length === 1 ? files[0].name : files.length + ' files'}…`, '');
  const r = await uploadTaskFiles(taskId, files);
  await loadMyTasks(); renderTasks();
  if(r.failed.length) showToast('error', r.added.length ? 'Some files weren’t attached' : 'Not attached', taskFilesError(r.failed));
  else showToast('success', r.added.length === 1 ? 'File attached' : `${r.added.length} files attached`, r.added.length === 1 ? r.added[0].name : '');
}
async function tkRemoveFile(taskId, path, name){
  if(!(await confirmDialog(`Remove “${name}” from this task?`, { confirmLabel: 'Remove', destructive: true }))) return;
  const ok = await removeTaskFiles(taskId, [path]);
  await loadMyTasks(); renderTasks();
  ok ? showToast('success', 'Removed', name) : showToast('error', 'Not removed', 'Try again in a moment.');
}
function tkFilesDrag(e, on){ if(!e.dataTransfer || ![].includes.call(e.dataTransfer.types || [], 'Files')) return; e.preventDefault(); if(on) e.currentTarget.classList.add('is-drop'); else if(!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('is-drop'); }
function tkFilesDrop(e, taskId){ if(!e.dataTransfer || !e.dataTransfer.files.length) return; e.preventDefault(); e.currentTarget.classList.remove('is-drop'); tkAddFiles(taskId, e.dataTransfer.files); }
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
