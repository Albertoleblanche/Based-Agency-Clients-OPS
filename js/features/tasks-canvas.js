// Tasks, as on the canvas boards TasksNew and TasksOpen: the columns with more room and
// lighter cards, a name instead of an avatar, overdue and waiting-on-you said in words.
// Nov 26 (canvas "Tasks: the board first, suggestions behind one button"): the board comes first.
// Suggestions (from meetings, clients' emails and Claude's tips) wait behind one Suggestions button
// and open in the panel on the right, with Check Now inside; no Done column ("N done this week ›"
// under the title opens Finished tasks, and Mark Done's note has Undo). Clicking a task opens it on the right, the same panel as This Week,
// Health and Focus Reports. Loaded after sheets2-canvas.js.
// Nov 27: a Finished button at the end of the header, always there (the link under the title only shows
// when something in view is done, and wasn't found).
// Nov 27 (canvas "Tasks: the top suggestion of each kind, in a stripe at the bottom"): the top one of each
// kind (Missing, meeting, email, Tip, Idea) in a stripe pinned to the bottom (tssHtml), and Suggestions
// holds every kind.

let tasksScope = 'everyone', tasksClient = 'all', tasksLayout = (() => { try{ return localStorage.getItem('bda_tasks_layout') || 'columns'; }catch(e){ return 'columns'; } })();
const TASK_COLS = [['todo', 'To Do'], ['in_progress', 'In Progress'], ['in_review', 'Review']];
function setTasksScope(v){ tasksScope = v; renderTasks(); }
function setTasksClient(v){ tasksClient = v; renderTasks(); }
function setTasksLayout(v){ tasksLayout = v; try{ localStorage.setItem('bda_tasks_layout', v); }catch(e){} renderTasks(); }
function selectTask(id){ window._taskSel = window._taskSel === id ? null : id; if(window._taskSel) window._tkSgOpen = false; if(window._taskSel && typeof notifSeenFor === 'function') notifSeenFor(id); renderTasks(); if(window._taskSel) loadTaskComments(id); }
function closeTaskPanel(){ window._taskSel = null; renderTasks(); }

// Anywhere else in the app a task still opens as a sheet; on Tasks it opens in the panel.
window.openTaskDetailModal = (sheet => function(id){
  if(typeof currentViewName !== 'undefined' && currentViewName === 'tasks' && document.getElementById('tasksRoot')){
    closeAppModal(); window._taskSel = id; window._tkSgOpen = false; renderTasks(); loadTaskComments(id); return;
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
// Work with Claude, on a card or row of yours that's open (Nov 27; claude-plan.js)
function tkClaudeBtn(t){ return typeof workWithClaudeHtml === 'function' ? workWithClaudeHtml(t, true) : ''; }
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
<div class="tk-cf"><span class="tk-due ${kind}">${escapeHtml(due)}</span><span class="tk-who">${g ? tkSprintMore(g) : escapeHtml(tkWho(t.assigneeId))}</span>${tkRemindBtn(t)}${tkClaudeBtn(t)}</div>${g ? tkSprintSteps(g) : ''}</article>`;
}
function tkListRowHtml(t){
  const g = t.status !== 'done' && tkFoldNow && tkFoldNow.lead.get(t.id);
  const c = clients.find(x => x.id === t.clientId), [due, kind] = tkDue(t), done = t.status === 'done';
  return `<div class="tk-lr${done ? ' is-done' : ''}${g ? ' is-sprint' : ''}${g && tkSprintOpen.has(g.sprint.id) ? ' sp-open' : ''}${window._taskSel === t.id ? ' is-sel' : ''}"${g ? tkSprintAttrs(g) : ''} role="button" tabindex="0" onclick="selectTask('${t.id}')" onkeydown="if(event.key==='Enter'&&event.target===this)selectTask('${t.id}')">${tkCb(t)}
<div class="tx">${g ? tkSprintLabel(g) : ''}<b>${t.color && !done ? `<i class="cc-dot c-${t.color}" aria-hidden="true"></i>` : ''}${escapeHtml(t.title)}${t.priority === 'high' && !done ? `<span class="tk-flag" title="High priority">${icon('flag')}</span>` : ''}</b><span class="s">${g
    ? [c ? escapeHtml(c.name) + focusMark(c) : '', tkSprintLate(g), tkSprintBtn(g)].filter(Boolean).join(' · ')
    : (c ? escapeHtml(c.name) + focusMark(c) + ' · ' : '') + escapeHtml(tkWho(t.assigneeId))}</span></div>
${tkRemindBtn(t)}${tkClaudeBtn(t)}<span class="tk-due ${kind}">${escapeHtml(done && t.completedAt ? 'Done ' + fmtShortDate(new Date(t.completedAt)) : due)}</span>${g ? tkSprintSteps(g) : ''}</div>`;
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
  const doneLink = done.length ? ` <a class="tk-donel" href="#" onclick="switchView('task-archive');return false;" title="Open Finished tasks">${doneWeek.length ? `${doneWeek.length} done this week` : 'Finished tasks'}${icon('caret-right', { weight: 'bold' })}</a>` : '';
  const sub = ([overdue.length ? `<b>${overdue.length} ${overdue.length === 1 ? 'is' : 'are'} overdue.</b>` : '', review.length ? `${review.length} ${review.length === 1 ? 'is' : 'are'} waiting on your review.` : ''].filter(Boolean).join(' ') || (open.length ? 'Nothing is overdue.' : 'Nothing open right now.')) + doneLink;
  const head = `<div class="tk-hd"><div><h2>${sprintFoldHeadline(fold, open.length)}</h2><p>${sub}</p></div>
<div class="tk-f">${tkSgBtnHtml()}${(everyone ? [['everyone', 'Everyone', ''], ['mine', 'Mine', mineN]] : byMe.length ? [['mine', 'Mine', mineN], ['byme', 'Assigned by Me', byMeN]] : [])
  .map(([k, t, n], i, a) => (i ? '' : '<div class="seg" role="tablist" aria-label="Whose">') + `<button class="${tasksScope === k ? 'on' : ''}" role="tab" aria-selected="${tasksScope === k}" onclick="setTasksScope('${k}')">${t}${n !== '' ? ` <span class="c">${n}</span>` : ''}</button>` + (i === a.length - 1 ? '</div>' : '')).join('')}
<label class="pop pop-sel"><span class="pl">Client: ${escapeHtml(curC ? curC.name : 'All')}</span>${icon('caret-down')}<select aria-label="Client" onchange="setTasksClient(this.value)"><option value="all">All</option>${usedClients.map(c => `<option value="${c.id}"${c === curC ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select></label>
<div class="seg tk-view" role="tablist" aria-label="Layout"><button class="${tasksLayout === 'list' ? 'on' : ''}" role="tab" aria-selected="${tasksLayout === 'list'}" onclick="setTasksLayout('list')">${icon('list-bullets')}List</button><button class="${tasksLayout === 'columns' ? 'on' : ''}" role="tab" aria-selected="${tasksLayout === 'columns'}" onclick="setTasksLayout('columns')">${icon('squares-four')}Columns</button></div>
<button type="button" class="btn tk-fin" onclick="switchView('task-archive')" title="Finished tasks: everything that’s been done${doneWeek.length ? `, ${doneWeek.length} this week` : ''}">${icon('check-circle')}Finished${doneWeek.length ? `<span class="c">${doneWeek.length}</span>` : ''}</button></div></div>`;
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
      return ts.length ? `<div class="tk-ls"><b>${label}</b><span>${ts.length}</span><button class="ib" aria-label="Add a task to ${label}" title="New task" onclick="openNewTaskModal(undefined,'${k}')">${icon('plus')}</button></div>${ts.map(tkListRowHtml).join('')}` : ''; }).join('') || (done.length ? `<p class="tk-none">Nothing open. ${doneLink.trim()}</p>` : '');
    body = `<div class="tk-list">${body}</div>`;
  } else {
    body = `<div class="tk-board">${TASK_COLS.map(([k, label]) => { const ts = items.filter(t => t.status === k).sort(order);
      return `<section class="tk-col" aria-label="${label}"><div class="tk-ch"><b>${label}</b><span>${ts.length}</span><button class="ib" aria-label="Add a task to ${label}" title="New task" onclick="openNewTaskModal(undefined,'${k}')">${icon('plus')}</button></div>${ts.map(tkCardHtml).join('') || `<p class="tk-none">Nothing here.</p>`}</section>`; }).join('')}</div>`;
  }
  const sel = window._taskSel && tasks.find(t => t.id === window._taskSel);
  if(window._taskSel && !sel) window._taskSel = null;
  const prev = root.querySelector('.sp-page')?.scrollTop || 0, prevSp = root.querySelector('.sp:not(.sp-leaving)')?.scrollTop || 0, cmt = document.getElementById('tkpCmt')?.value || '';
  if(sel) window._tkSgOpen = false;
  // the top suggestions sit in the page but are pinned to the window's bottom (.spw holds them), stepping
  // aside while a panel is open
  const tss = tssHtml(!!(sel || window._tkSgOpen));
  root.innerHTML = `<div class="spw"><div class="sp-page"><div class="tk">${head}${body}</div>${tss}</div>${sel ? taskPanelHtml(sel) : window._tkSgOpen ? tkSgPanelHtml() : ''}</div>`;
  tssMount(root);
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
    const claude = typeof workWithClaudeHtml === 'function' ? workWithClaudeHtml(t) : '';   // Work with Claude (Nov 27)
    acts = remind || mark || claude ? `<div class="tkp-acts">${remind}${claude}${mark}</div>` : '';
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
  if(typeof canWorkWithClaude === 'function' && canWorkWithClaude(t)) more.push(`<button class="mi" onclick="workWithClaudeCopy('${t.id}')">${icon('copy')}Copy Message for Claude</button>`);
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

// ---- Suggestions (Nov 26, canvas "Tasks: the board first, suggestions behind one button") ----------------
// One button in the header (the apps it reads, the count, a dot when something came in since you last
// looked) opens the panel where a task opens: tasks from your meetings and your clients' emails, then
// Claude's tips on your clients, the first three of each with Show More. Check Now reads Granola and
// Gmail together, inside the panel. A task opened closes it; Esc closes it.
// Nov 27: it holds every kind now, so the stripe's See All opens one place: Claude's Missing notes (clients
// waiting on you) first, then meetings and emails, tips, and Claude's ideas last.
let tkSgCnAll = false, tkSgMissAll = false, tkSgIdeaAll = false, tkSgOldOpen = false, tkSgChecking = false, tkSgCheckedAt = 0;
function tkSgSeenKey(){ return `bda_tsg_seen_${currentUser ? currentUser.id : ''}`; }
function tkSgSeen(){ try{ return new Set(JSON.parse(localStorage.getItem(tkSgSeenKey()) || '[]')); }catch(e){ return new Set(); } }
// Nov 27, later ("suggestions are piling up quickly"): Tasks keeps to what's worth doing now.
//  • From meetings and emails: the last two weeks (or due from today on). Older ones fold into "Older"
//    at the foot of the panel, not counted, with Dismiss All.
//  • Claude's notes: a client's first of each kind (Claude puts the most important first); the rest stay
//    on Health and the client's page.
const TKSG_FRESH_DAYS = 14;
function tkSgOld(s){
  if(s.dueDate && s.dueDate >= toDateStr(new Date())) return false;
  const at = s.sourceAt || s.createdAt; return !!at && Date.now() - new Date(at) > TKSG_FRESH_DAYS * 864e5;
}
function tkSgData(){
  // what the stripe just added or dismissed is gone here too, while the data catches up (tssGone)
  const all = typeof suggestionsOpen === 'function' ? suggestionsOpen(typeof taskSuggestions !== 'undefined' ? taskSuggestions || [] : []).filter(s => (tasksClient === 'all' || s.clientId === tasksClient) && !tssGone.has('sg:' + s.id)) : [];
  const meet = all.filter(s => !tkSgOld(s)), older = all.filter(tkSgOld);
  const seen = new Set(), firstOfKind = x => { const k = x.c.id + '|' + x.n.kind; if(seen.has(k)) return false; seen.add(k); return true; };
  const notes = typeof claudeNotesOn === 'function' && claudeNotesOn() ? cnSorted((clients || []).filter(c => claudeMine(c) && (tasksClient === 'all' || c.id === tasksClient)).flatMap(c => cnNotesOf(c))).filter(x => !tssGone.has(`cn:${x.c.id}:${x.n.id}`)).filter(firstOfKind) : [];
  const missing = notes.filter(x => x.n.kind === 'missing'), tips = notes.filter(x => x.n.kind === 'tip'), ideas = notes.filter(x => x.n.kind === 'idea' && x.c.status !== 'Paused');   // as Plan: no ideas for paused clients
  return { meet, older, missing, tips, ideas, ids: meet.map(s => 'sg:' + s.id).concat([...missing, ...tips, ...ideas].map(x => `cn:${x.c.id}:${x.n.id}`)) };
}
// A Claude note's one button, the same in the panel and the stripe. Tips (and Missing notes with steps or
// nothing to send) are tasks to add; Missing can be a message Claude wrote, a sprint or a plan with Claude;
// an idea is a sprint, as in Plan. In the stripe, Add goes through tssAdd (the tile turns over, with Undo).
function cnNoteBtn(c, n, stripe){
  const A = jsArg, k = n.steps && n.steps.length > 1 ? n.steps.length : 1, cls = 'btn sm btn-p cn-go-btn';
  const sprint = `openNewSprintModal({ clientId: ${A(c.id)}, preset: { title: ${A(n.title)}, goal: ${A(n.why)}, steps: ${escapeHtml(JSON.stringify(n.steps || []))} }, cnNote: { clientId: ${A(c.id)}, noteId: ${A(n.id)} } })`;
  if(n.kind === 'idea' || (n.kind === 'missing' && n.action === 'sprint')) return `<button type="button" class="${cls}" onclick="${sprint}">Make It a Sprint</button>`;
  if(n.kind === 'missing' && n.action === 'message' && n.message) return `<button type="button" class="${cls}" onclick="cnMessage(${A(c.id)}, ${A(n.id)})">Write to Them</button>`;
  if(n.kind === 'missing' && n.action === 'claude' && typeof planWithClaude === 'function') return `<button type="button" class="${cls}" onclick="planWithClaude(${A(c.id)}, ${A(`${n.title}. ${n.why}`)})">Plan with Claude</button>`;
  return `<button type="button" class="${cls}" onclick="${stripe ? `tssAdd(${A(n.kind)})` : `cnAddTasks(${A(c.id)}, ${A(n.id)}, this)`}">${k > 1 ? `Add ${k} Steps` : 'Add'}</button>`;
}
function tkSgSources(){ return { granola: typeof granolaOn !== 'undefined' && !!granolaOn, gmail: typeof gmailOnHere === 'function' && gmailOnHere(), claude: typeof claudeNotesOn === 'function' && claudeNotesOn() }; }
function tkSgBtnHtml(){
  // keep them fresh: suggestions a minute old, new client emails (the server skips a read in the last
  // ten minutes), Granola's connection, Claude's notes
  if(typeof taskSuggestions !== 'undefined' && (taskSuggestions === null || Date.now() - taskSuggestionsAt > 60000) && typeof tkSgRefresh === 'function') tkSgRefresh();
  if(typeof granolaWatch === 'function') granolaWatch(() => { if(currentViewName === 'tasks') renderTasks(); });
  if(typeof claudeNotesOn === 'function' && claudeNotesOn() && !claudeNotes.at && !claudeNotes.loading) setTimeout(() => loadClaudeNotes(), 0);
  const src = tkSgSources(), d = tkSgData(), n = d.ids.length;
  if(!n && !src.granola && !src.gmail && !src.claude) return '';
  const seen = tkSgSeen(), fresh = !window._tkSgOpen && d.ids.some(id => !seen.has(id));
  const logos = [src.granola && appLogo('granola', 'xs'), src.gmail && appLogo('gmail', 'xs'), src.claude && appLogo('claude', 'xs')].filter(Boolean).join('');
  return `<button type="button" class="btn tsg-b${window._tkSgOpen ? ' on' : ''}" onclick="tkSgToggle()" aria-expanded="${!!window._tkSgOpen}" title="${n ? `${n} suggestion${n === 1 ? '' : 's'}` : 'Nothing to suggest right now'}${fresh ? ', new since you looked' : ''}">${logos ? `<span class="tsg-ls" aria-hidden="true">${logos}</span>` : ''}Suggestions${n ? `<span class="tsg-n">${n}</span>` : ''}${fresh ? '<i class="tsg-dot" aria-label="New"></i>' : ''}</button>`;
}
function tkSgMarkSeen(){ const d = tkSgData(); try{ localStorage.setItem(tkSgSeenKey(), JSON.stringify([...new Set([...tkSgSeen(), ...d.ids])].slice(-400))); }catch(e){} }
function tkSgToggle(){ window._tkSgOpen = !window._tkSgOpen; if(window._tkSgOpen){ window._taskSel = null; tkSgMarkSeen(); } renderTasks(); }
function tkSgClose(){ window._tkSgOpen = false; renderTasks(); }
// when Granola and Gmail were last read, as far as this window knows
function tkSgReadLine(src){
  const at = Math.max(tkSgCheckedAt || 0, ...[typeof granolaState !== 'undefined' && granolaState && granolaState.lastReadAt, typeof gmailState !== 'undefined' && gmailState && gmailState.lastReadAt].filter(Boolean).map(t => new Date(t).getTime()));
  const what = src.granola && src.gmail ? 'Meetings and emails' : src.granola ? 'Meetings' : 'Emails';
  if(tkSgChecking) return `Reading your ${what.toLowerCase()}…`;
  if(!at) return `${what} come in by themselves`;
  const m = Math.round((Date.now() - at) / 60000);
  return `${what} read ${m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 24 * 60 ? `${Math.round(m / 60)} h ago` : fmtShortDate(new Date(at))}`;
}
async function tkSgCheckNow(){
  if(tkSgChecking) return;
  const src = tkSgSources(); if(!src.granola && !src.gmail) return;
  tkSgChecking = true; renderTasks();
  const before = new Set((taskSuggestions || []).map(s => s.id));
  let gr = null, gm = null;
  try{ [gr, gm] = await Promise.all([src.granola ? checkGranolaNow() : null, src.gmail ? gmailReadNow() : null]); }catch(e){}
  tkSgChecking = false; tkSgCheckedAt = Date.now();
  // one of them: what it says itself; both: one note for the two
  const fresh = (taskSuggestions || []).filter(s => !before.has(s.id)).length;
  if(gr && !gm) showToast(gr.type, gr.title, gr.text);
  else if(gm && !gr) gmailReadToast(gm);
  else {
    const errs = [gr && gr.type === 'error' && `Granola: ${gr.text}`, gm && gm.error && `Gmail: ${gm.error}`].filter(Boolean);
    if(errs.length) showToast('error', errs.length === 2 ? 'Neither was read' : 'Not all was read', errs.join(' '));
    else showToast(fresh ? 'success' : 'info', fresh ? `${fresh} new suggestion${fresh === 1 ? '' : 's'}` : 'Nothing new to add', 'Your meetings and your clients’ emails are read.');
  }
  tkSgMarkSeen();
  renderTasks();
}
function tkSgPanelHtml(){
  const src = tkSgSources(), d = tkSgData(), A = jsArg;
  const check = src.granola || src.gmail ? `<div class="tsg-ck"><span>${escapeHtml(tkSgReadLine(src))}</span><button type="button" class="btn sm" id="tkSgCheck" onclick="tkSgCheckNow()"${tkSgChecking ? ' disabled' : ''} title="Look for new action items in your Granola meetings and new requests in your clients’ emails, now">${tkSgChecking ? '<span class="tk-gr-spin" aria-hidden="true"></span>Checking…' : `${icon('refresh-cw')}Check Now`}</button></div>` : '';
  // from meetings and emails: a client with more than three gets Add All
  const groups = [];
  d.meet.forEach(s => { const k = s.clientId || ''; let g = groups.find(x => x.k === k); if(!g) groups.push(g = { k, items: [] }); g.items.push(s); });
  let left = tkSgAll ? Infinity : 3;
  const tile = s => {
    const mail = s.source === 'gmail', c = s.clientId && clients.find(x => x.id === s.clientId), sub = suggestionSub(s);
    const name = escapeHtml(sub[0] || (mail ? 'Email' : 'Meeting')), ic = icon(mail ? 'envelope-simple' : 'calendar-blank');
    const from = s.sourceUrl ? `<a class="cn-ev" href="${safeUrl(s.sourceUrl)}" target="_blank" rel="noopener" title="${mail ? 'Open the email in Gmail' : 'Open the notes in Granola'}">${ic}<span>${name}</span>${CN_GO}</a>` : `<span class="cn-ev is-plain">${ic}<span>${name}</span></span>`;
    const rest = sub.slice(1).filter(x => !c || x !== c.name);
    return `<div class="tsg-t tk-sg-r" data-sg="${s.id}"><p class="tsg-top">${appLogo(mail ? 'gmail' : 'granola', 'xs')}<span class="c">${escapeHtml(c ? c.name : 'No client')}</span>${s.outOfScope ? addonTagHtml(s.scopeNote) : ''}</p>
<button type="button" class="tsg-tt" onclick="tkSgPreview('${s.id}')" title="Read it first">${escapeHtml(s.title)}</button>${s.quote ? `<p class="tsg-w is-q" title="${escapeHtml(s.quote)}">“${escapeHtml(s.quote)}”</p>` : ''}
<p class="tsg-src cn-evs">${from}${rest.length ? `<span class="tsg-when">${rest.map(escapeHtml).join(' · ')}</span>` : ''}</p>
<div class="tsg-a"><button type="button" class="btn sm btn-p" onclick="tkSgAdd('${s.id}')">Add</button><button type="button" class="btn sm" onclick="tkSgEdit('${s.id}')">Edit…</button><button type="button" class="btn sm tsg-dis" onclick="tkSgDismiss('${s.id}')">Dismiss</button>${s.clientId ? `<span class="tsg-sp"></span><button type="button" class="ib" aria-label="Move “${escapeHtml(s.title)}” to Reminders" title="It’s something the client owes you: move it to Reminders" onclick="tkSgToReminder('${s.id}')">${icon('bell-ring')}</button>` : ''}</div></div>`;
  };
  const meet = groups.map(g => {
    const rows = g.items.slice(0, Math.max(0, left)); left -= rows.length;
    if(!rows.length) return '';
    const c = g.k && clients.find(x => x.id === g.k);
    const all = g.items.length > 3 ? `<div class="tsg-all"><span>${escapeHtml(c ? c.name : 'No client')} has ${g.items.length}</span><button type="button" class="btn sm tsg-dis" onclick="tkSgDismissMany('client', ${A(g.k)})" data-hovertip="Dismiss all ${g.items.length} of ${escapeHtml(c ? c.name : 'these')}’s suggestions. Undo brings them back." data-tipdelay="500">Dismiss All</button><button type="button" class="btn sm tk-sg-all" data-sgall="${g.k}" onclick="tkSgAddAll('${g.k}')">Add All ${g.items.length}</button></div>` : '';
    return all + rows.map(tile).join('');
  }).join('');
  const meetMore = d.meet.length > 3 ? `<button type="button" class="tsg-more" onclick="tkSgAll = !tkSgAll; renderTasks()">${tkSgAll ? 'Show Fewer' : `Show ${d.meet.length - 3} More`}</button>` : '';
  const cnTile = ({ c, n }) => `<div class="tsg-t cn-n is-${escapeHtml(n.kind)}" data-cnl="${escapeHtml(c.id + ':' + n.id)}"><p class="tsg-top"><span class="cn-k">${CN_KIND[n.kind] || CN_KIND.tip}</span><span class="c">${escapeHtml(c.name)}</span></p>
<button type="button" class="tsg-tt" onclick="cnOpenClient(${A(c.id)})" title="All of Claude’s notes on ${escapeHtml(c.name)}">${escapeHtml(n.title)}</button><p class="tsg-w" title="${escapeHtml(n.why)}">${escapeHtml(n.why)}</p>
${(n.evidence || []).length ? `<div class="tsg-src cn-evs">${n.evidence.slice(0, 2).map(e => cnEvidenceHtml(c, e)).join('')}</div>` : ''}
<div class="tsg-a">${cnNoteBtn(c, n)}<button type="button" class="btn sm tsg-dis" onclick="cnDismiss(${A(c.id)}, ${A(n.id)}, this)">Dismiss</button></div></div>`;
  // Claude's notes of one kind: the first three, then Show More
  const cnGroup = (list, all, flag, cls, head) => list.length ? `<section class="tsg-g ${cls}" aria-label="${head}"><p class="tsg-gh">${CLAUDE_SPARK}<b>${head}</b><span class="n">${list.length}</span></p>${(all ? list : list.slice(0, 3)).map(cnTile).join('')}${list.length > 3 ? `<button type="button" class="tsg-more" onclick="${flag} = !${flag}; renderTasks()">${all ? 'Show Fewer' : `Show ${list.length - 3} More`}</button>` : ''}</section>` : '';
  const fromMeet = src.granola || d.meet.some(s => s.source !== 'gmail'), fromMail = src.gmail || d.meet.some(s => s.source === 'gmail');
  const meetHead = [fromMeet && appLogo('granola', 'xs'), fromMail && appLogo('gmail', 'xs')].filter(Boolean).join('');
  const what = fromMeet && fromMail ? 'From your meetings and emails' : fromMail ? 'From your clients’ emails' : 'From your meetings';
  // older than two weeks: folded at the foot, not counted, with Dismiss All
  const older = d.older.length ? `<details class="tsg-old"${tkSgOldOpen ? ' open' : ''} ontoggle="tkSgOldOpen = this.open"><summary><span class="tsg-old-t">${icon('caret-right', { weight: 'bold' })}Older than two weeks</span><span class="n">${d.older.length}</span><span class="tsg-sp"></span><button type="button" class="btn sm tsg-dis" onclick="event.preventDefault();event.stopPropagation();tkSgDismissMany('older')" data-hovertip="Dismiss every suggestion here, from meetings and emails over two weeks old. Undo brings them back." data-tipdelay="500">Dismiss All</button></summary>
<p class="tsg-old-w">From meetings and emails over two weeks ago. They aren’t counted or shown in the stripe; add any still worth doing.</p>${d.older.map(tile).join('')}</details>` : '';
  const empty = !d.ids.length ? `<div class="tsg-e"><b>All caught up</b><span>New ones show up here after your meetings, when a client emails, and when Claude reads your clients again.</span></div>` : '';
  return `<aside class="sp tsg" aria-label="Suggestions">
<div class="sp-bar"><button class="ib" aria-label="Close" title="Close (Esc)" onclick="tkSgClose()">${icon('x')}</button></div>
<div class="tsg-h"><h3>Suggestions</h3><p>Everything worth doing, from your meetings, your clients’ emails and Claude, the most important first.</p></div>
${check}${cnGroup(d.missing, tkSgMissAll, 'tkSgMissAll', 'tk-miss', 'Clients waiting on you')}${d.meet.length ? `<section class="tsg-g tk-sg" aria-label="${what}"><p class="tsg-gh">${meetHead ? `<span class="tsg-ls">${meetHead}</span>` : ''}<b>${what}</b><span class="n">${d.meet.length}</span></p>${meet}${meetMore}</section>` : ''}
${cnGroup(d.tips, tkSgCnAll, 'tkSgCnAll', 'tk-cn', 'Tips from Claude')}${cnGroup(d.ideas, tkSgIdeaAll, 'tkSgIdeaAll', 'tk-idea', 'Ideas from Claude')}${empty}${older}</aside>`;
}

// Dismiss All: a client's suggestions from meetings and emails, or the older ones. Undo brings them back.
async function tkSgDismissMany(what, key){
  const d = tkSgData(), list = what === 'older' ? d.older : d.meet.concat(d.older).filter(s => (s.clientId || '') === (key || ''));
  if(!list.length) return;
  const ids = list.map(s => s.id), c = key && clients.find(x => x.id === key);
  const { error } = await supabaseClient.from('task_suggestions').update({ status: 'dismissed', decided_at: new Date().toISOString() }).in('id', ids);
  if(error) return showToast('error', 'Not dismissed', 'Try again in a moment.');
  taskSuggestions = (taskSuggestions || []).filter(s => !ids.includes(s.id));
  renderTasks();
  showToast('info', `Dismissed ${ids.length}`, what === 'older' ? 'The older suggestions are gone from Tasks.' : `${c ? c.name : 'Those'}: gone from Suggestions.`, { action: 'Undo', onAction: async () => {
    const { error: e2 } = await supabaseClient.from('task_suggestions').update({ status: 'pending', decided_at: null }).in('id', ids);
    if(e2) return showToast('error', 'Couldn’t undo', 'Try again in a moment.');
    taskSuggestions = [...list, ...(taskSuggestions || []).filter(s => !ids.includes(s.id))].sort((a, b) => new Date(b.sourceAt || 0) - new Date(a.sourceAt || 0));
    renderTasks();
  } });
}

// ---- Top suggestions (Nov 27, canvas "Tasks: the top suggestion of each kind, in a stripe at the bottom") ----
// A stripe floats at the bottom of Tasks, the board scrolling under it: the one suggestion that matters most
// of each kind, always in this order: Missing (a client waiting on you), a meeting, an email, a Tip, an Idea.
// "Matters most": a meeting or an email that has waited longest (in whole days), then the soonest due, then
// the client's importance; Claude's notes by how the client is doing (at risk first), then importance, then
// Claude's own order. A tile says whose it is, what to do and where it came from, with one button and ✕.
// Add and ✕ turn the tile over ("Added to To Do" · Undo); a few seconds later (longer while you point at the
// stripe) the next of that kind takes the slot, and a kind with none left folds away while the others widen.
// The chevron folds it to one line that still names the top one (remembered per person); See All opens
// Suggestions. It steps aside while a panel is open. Claude's notes are only dismissed for good once the
// tile has settled, so Undo has nothing to take back on the server.
const TSS_KINDS = ['missing', 'meeting', 'email', 'tip', 'idea'];
const TSS_WAIT = 4500;
const tssDone = new Map();   // kind → { key, item, face, title, sub, undo, commit, timer, busy }
const tssGone = new Set();   // keys acted on from the stripe, hidden in Tasks until the data catches up
const tssBusyK = new Set();  // kinds waiting on the server, so a click can't land twice
let tssFoldV = { uid: null, v: false }, tssWas = null;   // tssWas: 'on' | 'aside', for stepping aside and back
function tssFoldKey(){ return `bda_tss_fold_${currentUser ? currentUser.id : ''}`; }
function tssFolded(){
  const uid = currentUser ? currentUser.id : '';
  if(tssFoldV.uid !== uid){ let v = false; try{ v = localStorage.getItem(tssFoldKey()) === '1'; }catch(e){} tssFoldV = { uid, v }; }
  return tssFoldV.v;
}
const tssDays = at => at ? Math.floor((Date.now() - new Date(at)) / 864e5) : 0;
const tssImp = c => (c && +c.importance) || 0;
function tssItems(){
  const d = tkSgData(), lv = new Map(), L = { r: 0, y: 1, h: 2, g: 3 }, cOf = id => id && clients.find(x => x.id === id);
  const level = c => { if(!lv.has(c.id)){ let l = 'g'; try{ if(typeof clientHealth === 'function') l = clientHealth(c).level || 'g'; }catch(e){} lv.set(c.id, l); } return lv.get(c.id); };
  const note = list => { const x = list.slice().sort((a, b) => (L[level(a.c)] ?? 3) - (L[level(b.c)] ?? 3) || tssImp(b.c) - tssImp(a.c) || (typeof focusFirst === 'function' ? focusFirst(a.c, b.c) : 0) || a.i - b.i)[0];
    return x && { key: `cn:${x.c.id}:${x.n.id}`, c: x.c, n: x.n }; };
  const sg = mail => { const s = d.meet.filter(x => (x.source === 'gmail') === mail).sort((a, b) => tssDays(b.sourceAt) - tssDays(a.sourceAt)
    || (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || tssImp(cOf(b.clientId)) - tssImp(cOf(a.clientId)))[0];
    return s && { key: 'sg:' + s.id, s, c: cOf(s.clientId) }; };
  return { items: { missing: note(d.missing), meeting: sg(false), email: sg(true), tip: note(d.tips), idea: note(d.ideas) }, n: d.ids.length };
}
const tssWhen = at => at ? fmtShortDate(new Date(at)) : '';
function tssFrontHtml(kind, it){
  const A = jsArg, c = it.c, mark = it.s ? appLogo(it.s.source === 'gmail' ? 'gmail' : 'granola', 'xs') : `<span class="cn-k">${CN_KIND[it.n.kind] || CN_KIND.tip}</span>`;
  const title = it.s ? it.s.title : it.n.title;
  const meta = it.s ? [it.s.sourceTitle, tssWhen(it.s.sourceAt), it.s.dueDate ? `due ${fmtDay(new Date(it.s.dueDate + 'T12:00:00'))}` : ''].filter(Boolean).join(' · ')
    : (it.n.evidence || []).slice(0, 2).map(e => cnEvShort(e.label || e.kind)).join(' · ') || it.n.why;
  const open = it.s ? `tkSgPreview(${A(it.s.id)})` : `cnOpenClient(${A(c.id)})`, tip = it.s ? 'Read it first' : `All of Claude’s notes on ${c.name}`;
  const btn = it.s ? `<button type="button" class="btn sm btn-p" onclick="tssAdd(${A(kind)})">Add</button>` : cnNoteBtn(c, it.n, true);
  return `<div class="tss-f"><p class="tss-top">${mark}<span class="c">${escapeHtml(c ? c.name : 'No client')}</span></p>
<button type="button" class="tss-tt" onclick="${open}" title="${escapeHtml(tip)}">${escapeHtml(title)}</button><p class="tss-w" title="${escapeHtml(meta)}">${escapeHtml(meta)}</p>
<div class="tss-a">${btn}<span class="tss-sp"></span><button type="button" class="ib tss-x" aria-label="Dismiss “${escapeHtml(title)}”" title="Dismiss" onclick="tssDismiss(${A(kind)})">${icon('x')}</button></div></div>`;
}
function tssBackHtml(kind, e){
  return `<div class="tss-b" role="status"><span class="tss-ok${e.face === 'dismissed' ? ' is-dis' : ''}" aria-hidden="true">${icon(e.face === 'dismissed' ? 'x' : 'check', { weight: 'bold' })}</span><b>${escapeHtml(e.title)}</b>${e.sub ? `<span class="tss-bs" title="${escapeHtml(e.sub)}">${escapeHtml(e.sub)}</span>` : ''}<button type="button" class="tss-undo" onclick="tssUndo(${jsArg(kind)})">Undo</button></div>`;
}
function tssTileHtml(kind, it, cls){
  const e = tssDone.get(kind), item = e ? e.item : it;
  const busy = !e && tssBusyK.has(kind), front = tssFrontHtml(kind, item);
  return `<article class="tss-t is-${kind}${e ? ' is-over' : ''}${busy ? ' is-busy' : ''}${cls ? ' ' + cls : ''}" data-tss="${kind}" aria-label="${escapeHtml(item.s ? item.s.title : item.n.title)}">${busy ? front.replace(/<button type="button"/g, '<button type="button" disabled') : front}${e ? tssBackHtml(kind, e) : ''}</article>`;
}
// the first one, for the folded line: its kind, its client, what it is
function tssOneHtml(kind, it){
  const mark = it.s ? appLogo(it.s.source === 'gmail' ? 'gmail' : 'granola', 'xs') : `<span class="cn-k">${CN_KIND[it.n.kind] || CN_KIND.tip}</span>`;
  return `<span class="tss-one is-${kind}">${mark}<span>${escapeHtml(it.c ? it.c.name + ': ' : '')}${escapeHtml(it.s ? it.s.title : it.n.title)}</span></span>`;
}
// the stripe, or '' when there's nothing to show; `aside` when a panel is open
function tssHtml(aside){
  if(typeof tkSgData !== 'function') return '';
  const { items, n } = tssItems(), kinds = TSS_KINDS.filter(k => tssDone.has(k) || items[k]);
  if(!kinds.length){ tssWas = null; return ''; }
  const was = tssWas; tssWas = aside ? 'aside' : 'on';
  if(aside && was !== 'on') return '';                 // already out of the way
  const src = tkSgSources(), fold = tssFolded();
  const logos = [src.granola && appLogo('granola', 'xs'), src.gmail && appLogo('gmail', 'xs'), src.claude && appLogo('claude', 'xs')].filter(Boolean).join('');
  const first = kinds.find(k => !tssDone.has(k));
  const cls = aside ? ' is-going' : was === 'aside' ? ' is-coming' : '';
  return `<div class="tss-fade${fold ? ' is-fold' : ''}${cls}" aria-hidden="true"></div><section class="tss${fold ? ' is-fold' : ''}${aside ? '' : ' is-on'}${cls}" aria-label="Top suggestions" onpointerleave="tssRearm()">
<div class="tss-h">${logos ? `<span class="tsg-ls" aria-hidden="true">${logos}</span>` : ''}<b>Top suggestions</b><span class="tss-sub">The one that matters most, of each kind</span>${first ? `<button type="button" class="tss-onew" onclick="tssFold(false)" title="Show the top suggestions">${tssOneHtml(first, items[first])}</button>` : ''}<span class="tss-grow"></span>
<button type="button" class="btn sm tss-all" onclick="tkSgToggle()" title="Open Suggestions: every one, of every kind">See All ${n}${icon('caret-right', { weight: 'bold' })}</button><button type="button" class="ib tss-fold" onclick="tssFold()" aria-expanded="${!fold}" aria-label="${fold ? 'Show the top suggestions' : 'Fold the top suggestions'}" title="${fold ? 'Show' : 'Fold'}">${icon('caret-down', { weight: 'bold' })}</button></div>
<div class="tss-body"><div class="tss-bi"><div class="tss-row" style="grid-template-columns:repeat(${kinds.length},minmax(var(--tss-min),1fr))">${kinds.map(k => tssTileHtml(k, items[k])).join('')}</div></div></div></section>`;
}
const tssEl = () => document.querySelector('#tasksRoot .tss.is-on');
const tssTile = kind => document.querySelector(`#tasksRoot .tss.is-on .tss-t[data-tss="${kind}"]`);
const tssCalm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// after a render: room under the board, and the toasts above the stripe
function tssMount(root){
  const el = root.querySelector('.tss'), page = root.querySelector('.sp-page');
  if(page){ page.classList.toggle('has-tss', !!el); page.classList.toggle('tss-folded', !!el && el.classList.contains('is-fold')); }
  if(el && page){
    // lined up with the board, whatever the look's page margins are
    const tk = page.querySelector('.tk'), cs = tk && getComputedStyle(tk);
    if(cs){ el.style.left = cs.paddingLeft; el.style.right = `${parseFloat(cs.paddingRight) + page.offsetWidth - page.clientWidth}px`; }
  }
  if(el && el.classList.contains('is-on')) tssMeasure();
}
function tssMeasure(){
  const el = tssEl(); if(!el) return;
  const fold = el.classList.contains('is-fold'), h = el.querySelector('.tss-h').offsetHeight + 16, full = h + (el.querySelector('.tss-bi')?.scrollHeight || 0);
  document.documentElement.style.setProperty('--tss-h', `${Math.round(fold ? h : full)}px`);
}
function tssFold(v){
  const fold = v === undefined ? !tssFolded() : !!v;
  tssFoldV = { uid: currentUser ? currentUser.id : '', v: fold };
  try{ localStorage.setItem(tssFoldKey(), fold ? '1' : '0'); }catch(e){}
  const el = tssEl(); if(!el) return renderTasks();
  // in place, so it eases shut and open
  el.classList.toggle('is-fold', fold); el.previousElementSibling?.classList.toggle('is-fold', fold);
  const b = el.querySelector('.tss-fold'); if(b){ b.setAttribute('aria-expanded', !fold); b.setAttribute('aria-label', fold ? 'Show the top suggestions' : 'Fold the top suggestions'); b.title = fold ? 'Show' : 'Fold'; }
  document.querySelector('#tasksRoot .sp-page')?.classList.toggle('tss-folded', fold);
  tssMeasure();
}
// the tile turns over: what happened, and Undo
function tssOver(kind, item, o){
  const prev = tssDone.get(kind); if(prev) clearTimeout(prev.timer);
  const e = { key: item.key, item, at: performance.now(), ...o };
  tssDone.set(kind, e); tssGone.add(item.key); tssBusyK.delete(kind);
  const t = tssTile(kind);
  if(t){ t.querySelector('.tss-b')?.remove(); t.insertAdjacentHTML('beforeend', tssBackHtml(kind, e)); t.offsetWidth; t.classList.remove('is-busy'); t.classList.add('is-over'); }
  e.timer = setTimeout(() => tssSettle(kind), TSS_WAIT);
  tssCounts();
}
// the counts on Suggestions and See All, without drawing the page again
function tssCounts(){
  const n = tkSgData().ids.length, b = document.querySelector('#tasksRoot .tsg-b .tsg-n'), a = document.querySelector('#tasksRoot .tss-all');
  if(b) b.textContent = n;
  if(a) a.innerHTML = `See All ${n}${icon('caret-right', { weight: 'bold' })}`;
}
// draws the page once the tile has turned over, so the turn isn't cut short
async function tssAfter(kind){
  const e = tssDone.get(kind), wait = e ? 300 - (performance.now() - e.at) : 0;
  if(wait > 0 && !tssCalm()) await new Promise(r => setTimeout(r, wait));
  renderTasks(); if(typeof updateTasksNavBadge === 'function') updateTasksNavBadge();
}
function tssRearm(){ tssDone.forEach((e, k) => { if(e.held){ e.held = false; clearTimeout(e.timer); e.timer = setTimeout(() => tssSettle(k), 1500); } }); }
function tssSettle(kind){
  const e = tssDone.get(kind); if(!e) return;
  // pointing at the stripe holds it, so Undo stays in reach
  if(e.busy || document.querySelector('#tasksRoot .tss.is-on:hover')){ e.held = true; e.timer = setTimeout(() => tssSettle(kind), 1500); return; }
  tssDone.delete(kind);
  if(e.commit) Promise.resolve().then(e.commit).catch(() => {});
  tssNext(kind);
}
// after a tile settles: the next of its kind fades in, or its column folds away and the rest widen
function tssNext(kind){
  const el = tssEl(), t = tssTile(kind);
  if(!el || !t || currentViewName !== 'tasks'){ if(currentViewName === 'tasks') renderTasks(); return; }
  const { items } = tssItems(), it = items[kind];
  if(it){ t.outerHTML = tssTileHtml(kind, it, tssCalm() ? '' : 'is-in'); return; }
  const left = TSS_KINDS.filter(k => tssDone.has(k) || items[k]);
  if(tssCalm()){ renderTasks(); return; }
  if(!left.length){ el.classList.add('is-going'); el.previousElementSibling?.classList.add('is-going'); setTimeout(renderTasks, 240); return; }
  const row = el.querySelector('.tss-row'), tiles = [...row.children];
  row.style.gridTemplateColumns = tiles.map(x => x === t ? 'minmax(0px,0fr)' : 'minmax(var(--tss-min),1fr)').join(' ');
  t.classList.add('is-leaving');
  setTimeout(renderTasks, 340);
}
async function tssUndo(kind){
  const e = tssDone.get(kind); if(!e || e.busy) return;
  e.busy = true; clearTimeout(e.timer);
  const t = tssTile(kind); if(t) t.querySelector('.tss-undo')?.setAttribute('disabled', '');
  let ok = true;
  try{ if(e.undo) ok = (await e.undo()) !== false; }catch(err){ ok = false; }
  e.busy = false;
  if(!ok){ showToast('error', 'Couldn’t undo', 'Try again in a moment.'); if(t) t.querySelector('.tss-undo')?.removeAttribute('disabled'); e.timer = setTimeout(() => tssSettle(kind), TSS_WAIT); return; }
  tssDone.delete(kind); tssGone.delete(e.key);
  if(t) t.classList.remove('is-over');
  setTimeout(async () => { if(typeof loadMyTasks === 'function') await loadMyTasks(); renderTasks(); if(typeof updateTasksNavBadge === 'function') updateTasksNavBadge(); }, tssCalm() ? 0 : 240);
}
// tasks added from here and taken back: cancelled (nobody else ever saw them)
async function tssCancel(ids){
  if(!ids.length) return true;
  const { error } = await supabaseClient.from('tasks').update({ cancelled_at: new Date().toISOString() }).in('id', ids);
  return !error;
}
function tssBusy(kind, on){ on ? tssBusyK.add(kind) : tssBusyK.delete(kind); const t = tssTile(kind); if(!t) return; t.classList.toggle('is-busy', on); t.querySelectorAll('.tss-f button').forEach(b => { b.disabled = on; }); }
async function tssAdd(kind){
  const it = tssItems().items[kind]; if(!it || tssDone.has(kind) || tssBusyK.has(kind)) return;
  tssBusy(kind, true);
  if(it.s){
    const s = it.s, r = await addSuggestedTask(s.id);
    if(r.error){ tssBusy(kind, false); showToast('error', 'Not added', r.error.message || 'Try again in a moment.'); return; }
    tssOver(kind, it, { face: 'added', title: r.already ? 'Already in your tasks' : 'Added to To Do', sub: r.task.title,
      undo: async () => { if(!r.already && !(await tssCancel([r.task.id]))) return false;
        if(!(await decideSuggestion(s.id, 'pending'))) return false;
        taskSuggestions = [s, ...(taskSuggestions || []).filter(x => x.id !== s.id)].sort((a, b) => new Date(b.sourceAt || 0) - new Date(a.sourceAt || 0)); } });
  } else {
    const { c, n } = it, titles = n.steps && n.steps.length ? n.steps.filter(Boolean) : [n.title], ids = [];
    for(const title of titles){
      const res = await insertTaskRow({ title, description: `${n.title}. ${n.why}`, priority: 'medium', status: 'todo', assigner_id: currentUser.id, assignee_id: currentUser.id, client_id: c.id, due_date: null });
      if(!res.error && res.data){ ids.push(res.data.id); if(typeof mtKnow === 'function') mtKnow(res.data); }
    }
    if(!ids.length){ tssBusy(kind, false); showToast('error', 'Not added', 'Try again in a moment.'); return; }
    // the note leaves for good once the tile settles; Undo before then only takes the tasks back
    tssOver(kind, it, { face: 'added', title: ids.length === 1 ? 'Added to To Do' : `Added ${ids.length} steps to To Do`, sub: titles[0], commit: () => cnSettle(c.id, n.id), undo: () => tssCancel(ids) });
  }
  if(typeof loadMyTasks === 'function') await loadMyTasks();
  tssAfter(kind);
}
// Claude's note, dismissed for good once its tile has settled; if that fails, it comes back
async function tssDismissNote(c, n, key){
  const r = await claudeApi({ action: 'client-note-dismiss', clientId: c.id, noteId: n.id });
  if(r.error){ tssGone.delete(key); showToast('error', 'Not dismissed', r.error); if(currentViewName === 'tasks') renderTasks(); return; }
  const v = claudeNotes.by[c.id]; claudeNotes.by[c.id] = r.insights || { ...(v || {}), notes: ((v && v.notes) || []).filter(x => x.id !== n.id) };
  claudeNotesRedraw();
}
async function tssDismiss(kind){
  const it = tssItems().items[kind]; if(!it || tssDone.has(kind) || tssBusyK.has(kind)) return;
  if(it.s){
    const s = it.s; tssBusy(kind, true);
    if(!(await decideSuggestion(s.id, 'dismissed'))){ tssBusy(kind, false); showToast('error', 'Not dismissed', 'Try again in a moment.'); return; }
    tssOver(kind, it, { face: 'dismissed', title: 'Dismissed', sub: 'It’s gone from Suggestions',
      undo: async () => { if(!(await decideSuggestion(s.id, 'pending'))) return false; taskSuggestions = [s, ...(taskSuggestions || []).filter(x => x.id !== s.id)].sort((a, b) => new Date(b.sourceAt || 0) - new Date(a.sourceAt || 0)); } });
  } else {
    const { c, n } = it;
    tssOver(kind, it, { face: 'dismissed', title: 'Dismissed', sub: 'Claude won’t suggest it again', commit: () => tssDismissNote(c, n, it.key) });
  }
  if(typeof updateTasksNavBadge === 'function') updateTasksNavBadge();
}
