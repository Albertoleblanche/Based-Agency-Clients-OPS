// Plan, as on the canvas boards PlanNew, PlanSprintOpen and PlanNewSprint: your next six weeks.
// A sprint is a few days of focused work, usually for one client: dates, a goal, the hours you'll
// spend, steps and reminders. Sprints are private to you (plan_sprints). Their steps are ordinary
// tasks (tasks.sprint_id), so they also show in Tasks, Today and your calendar; nothing to keep in
// sync. Under the timeline, everything else with a date is pulled in so you can look ahead: your
// tasks, note follow-ups, client reminders you asked, calendar events and sprint reminders.
// Off days are US holidays. Needs addendum-colors-and-plan.sql; until then the look-ahead still
// works and New Sprint says what to run. Loaded after tasks-canvas.js.

let planSprints = [];
let planReady = null;          // null: not loaded yet · false: the table isn't there yet · true
let planWeeklyHours = 20;      // hours a week you keep for planned work (you set it)
let planRange = (() => { try{ return localStorage.getItem('bda_plan_range') === '13' ? 13 : 6; }catch(e){ return 6; } })();
let planClient = 'all';

function planRowFromDb(r){
  return { id: r.id, title: r.title || 'Untitled sprint', clientId: r.client_id || null, start: r.start_date, end: r.end_date,
    hours: Number(r.hours) || 0, goal: r.goal || '', color: r.color || null, doneAt: r.done_at || null,
    reminders: Array.isArray(r.reminders) ? r.reminders : [], noteId: r.note_id || null, createdAt: r.created_at };
}
async function loadPlan(){
  if(!currentUser){ planSprints = []; return; }
  const { data, error } = await supabaseClient.from('plan_sprints').select('*').eq('user_id', currentUser.id).order('start_date', { ascending: true });
  if(error){ planReady = false; planSprints = []; return; }
  planReady = true;
  planSprints = (data || []).map(planRowFromDb);
  planCalTidy();
  const s = await supabaseClient.from('plan_settings').select('*').eq('user_id', currentUser.id).maybeSingle();
  if(!s.error && s.data && Number(s.data.weekly_hours) > 0) planWeeklyHours = Number(s.data.weekly_hours);
  checkPlanReminders();
  // Tasks folds each sprint into one row, so its count and list follow the sprints (Nov 25)
  if(typeof updateTasksNavBadge === 'function') updateTasksNavBadge();
  if(typeof currentViewName !== 'undefined' && currentViewName === 'tasks' && typeof renderTasks === 'function') renderTasks();
}
function planSprint(id){ return planSprints.find(s => s.id === id); }

// ---- days: weekdays, US holidays (the ones businesses close for) -------------------------------
// the list is shared with the Calendar and the phone (js/core/helpers.js usHolidays)
function planHoliday(ds){ return usHolidayOn(ds); }
function isPlanWeekend(d){ const w = d.getDay(); return w === 0 || w === 6; }
function isPlanWorkday(d){ return !isPlanWeekend(d) && !planHoliday(toDateStr(d)); }
function planWorkdays(start, end){
  const out = []; let d = new Date(start + 'T12:00:00'); const e = new Date(end + 'T12:00:00');
  for(let i = 0; d <= e && i < 400; i++, d = addDays(d, 1)) if(isPlanWorkday(d)) out.push(toDateStr(d));
  return out;
}
function planMonday(d){ const x = dayStart(d); return addDays(x, -((x.getDay() + 6) % 7)); }
function planDayLabel(ds){
  const d = new Date(ds + 'T12:00:00'), k = daysBetween(dayStart(rNow()), d);
  if(k === 0) return 'Today'; if(k === 1) return 'Tomorrow'; if(k === -1) return 'Yesterday';
  if(k > 1 && k < 7) return DAY_NAMES[d.getDay()].slice(0, 3);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// ---- what a sprint is doing ------------------------------------------------------------------
function planSteps(s){ return tasks.filter(t => t.sprintId === s.id && !t.cancelledAt).sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999')); }
function planTracked(s){
  const to = s.end < toDateStr(rNow()) ? s.end : toDateStr(rNow());
  return (typeof timeEntries !== 'undefined' ? timeEntries : []).filter(e => s.clientId && e.clientId === s.clientId && e.userId === currentUser?.id && e.date >= s.start && e.date <= to)
    .reduce((n, e) => n + (e.minutes || 0), 0) / 60;
}
function planState(s){
  const today = toDateStr(rNow()), days = planWorkdays(s.start, s.end), steps = planSteps(s), done = steps.filter(t => t.status === 'done').length;
  const elapsed = days.filter(d => d <= today).length;
  const kind = s.doneAt ? 'done' : today < s.start ? 'upcoming' : today > s.end ? 'ended' : 'running';
  const behind = kind === 'running' && steps.length && elapsed / Math.max(days.length, 1) - done / steps.length > .3;
  return { kind, days, elapsed, steps, done, behind, next: steps.find(t => t.status !== 'done') };
}
// Hours a sprint puts on a client this month, from today on, against what's left of its budget.
function planBudgetWarning(s){
  const c = s.clientId && clients.find(x => x.id === s.clientId);
  if(!c || !c.monthlyHourBudget || s.doneAt) return '';
  const now = rNow(), today = toDateStr(now), monthEnd = toDateStr(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const all = planWorkdays(s.start, s.end), left = all.filter(d => d >= today && d <= monthEnd);
  if(!all.length || !left.length) return '';
  const tracked = planTracked(s), remaining = Math.max(s.hours - tracked, 0) * left.length / all.filter(d => d >= today).length;
  const used = monthHours(c, now), month = now.toLocaleDateString('en-US', { month: 'long' });
  if(used + remaining <= c.monthlyHourBudget + .5) return '';
  const r = Math.round(remaining);
  return used > c.monthlyHourBudget
    ? `${escapeHtml(c.name)} is already over its ${c.monthlyHourBudget} h for ${month} (${Math.round(used)} h). The ${r} h left in this sprint this month go over too.`
    : `${escapeHtml(c.name)} has ${Math.round(c.monthlyHourBudget - used)} h left for ${month}. The ${r} h left in this sprint this month would go over.`;
}

// ---- the look-ahead: everything with a date, from every part of the app -----------------------
// Coming up, in three lists: your tasks; follow-ups (waiting on a client, a note to revisit, a
// follow-up on the calendar); and the rest of your calendar. Sprint reminders live in the side.
const PLAN_GROUPS = [['task', 'Tasks', 'No tasks due.'], ['follow', 'Follow-ups', 'Nothing to follow up on.'], ['event', 'Calendar', 'Nothing on your calendar.']];
const PLAN_SHOW = 5;
function planIsFollowEvent(e){ return e.eventType === 'reminder' && /^(follow[ -]?up|client follow-up)/i.test(e.title || ''); }
function planAheadItems(toDs){
  const me = currentUser?.id, today = toDateStr(rNow()), out = [];
  const cName = id => (clients.find(c => c.id === id) || {}).name || '';
  tasks.filter(t => t.assigneeId === me && t.status !== 'done' && !t.cancelledAt && t.dueDate && t.dueDate <= toDs).forEach(t => {
    const sp = t.sprintId && planSprint(t.sprintId);
    out.push({ kind: 'task', group: 'task', id: t.id, date: t.dueDate, time: typeof taskDueTimes !== 'undefined' ? taskDueTimes[t.id] || '' : '', title: t.title,
      sub: sp ? `Sprint · ${sp.title}` : (cName(t.clientId) || 'No client'), color: t.color || (sp && sp.color) || null, late: t.dueDate < today, inSprint: !!sp });
  });
  (typeof notes !== 'undefined' ? notes : []).filter(n => n.followUpDate && n.status !== 'done' && n.followUpDate <= toDs).forEach(n =>
    out.push({ kind: 'note', group: 'follow', id: n.id, date: n.followUpDate, title: n.title || 'Untitled note', sub: `Note${cName(n.clientId) ? ' · ' + cName(n.clientId) : ''}`, color: n.color, late: n.followUpDate < today }));
  (typeof clientReminders !== 'undefined' ? clientReminders : []).filter(r => r.status === 'waiting' && r.askedBy === me && r.followUpDate && r.followUpDate <= toDs).forEach(r =>
    out.push({ kind: 'reminder', group: 'follow', id: r.id, date: r.followUpDate, title: r.question, sub: `Waiting on ${r.waitingOn && typeof remOnWho === 'function' ? remOnWho(r) : cName(r.clientId) || 'the client'}`, late: r.followUpDate < today }));
  (typeof calendarEvents !== 'undefined' ? calendarEvents : []).filter(e => !e.relatedTaskId && !e.relatedNoteId && !e.relatedReminderId && (e.createdBy === me || (e.attendeeIds || []).includes(me)))
    .forEach(e => { const st = new Date(e.startAt), ds = toDateStr(st); if(ds < today || ds > toDs) return;
      const fu = planIsFollowEvent(e), type = e.eventType && e.eventType !== 'other' && typeof CALENDAR_TYPE_META !== 'undefined' && CALENDAR_TYPE_META[e.eventType] ? CALENDAR_TYPE_META[e.eventType].label : 'Event';
      out.push({ kind: 'event', group: fu ? 'follow' : 'event', id: e.id, date: ds, time: e.allDay ? '' : String(st.getHours()).padStart(2, '0') + ':' + String(st.getMinutes()).padStart(2, '0'), title: e.title,
        sub: fu ? 'On your calendar' : `${type}${cName(e.clientId) ? ' · ' + cName(e.clientId) : ''}` }); });
  planSprints.filter(s => !s.doneAt).forEach(s => (s.reminders || []).forEach((r, i) => {
    if(r.sent) return; const at = new Date(r.at), ds = toDateStr(at); if(ds < today || ds > toDs) return;
    out.push({ kind: 'alert', group: 'alert', id: s.id, idx: i, date: ds, time: String(at.getHours()).padStart(2, '0') + ':' + String(at.getMinutes()).padStart(2, '0'), title: r.label, sub: `${s.title} · reminder`, color: s.color });
  }));
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.time || '99').localeCompare(b.time || '99'));
}
function planItemOpen(kind, id){
  if(kind === 'task') openTaskDetailModal(id);
  else if(kind === 'note') openNoteSheet(id);
  else if(kind === 'reminder') switchView('reminders');
  else if(kind === 'event') (typeof openEventDetailModal === 'function' ? openEventDetailModal(id) : switchView('calendar'));
  else if(kind === 'alert') selectPlanSprint(id);
}
function planItemHtml(it){
  const ic = { task: '', note: 'sticky-note', reminder: 'bell-ring', event: 'calendar-blank', alert: 'bell-ring' }[it.kind];
  const lead = it.kind === 'task'
    ? `<button class="pl-cb" role="checkbox" aria-checked="false" aria-label="Mark done" title="Mark done" onclick="event.stopPropagation();moveTaskToStatus('${it.id}','done')"></button>`
    : `<span class="pl-ic">${icon(ic)}</span>`;
  const when = (it.late ? (it.date === toDateStr(addDays(rNow(), -1)) ? 'Yesterday' : 'Was ' + planDayLabel(it.date)) : planDayLabel(it.date)) + (it.time ? ', ' + fmtTime(atTime(new Date(it.date + 'T12:00:00'), it.time)) : '');
  const plan = it.kind === 'task' && !it.inSprint ? `<button class="btn btn-sm pl-plan" title="Plan a sprint around this task" onclick="event.stopPropagation();openNewSprintModal({ taskId: '${it.id}' })">Plan Sprint</button>` : '';
  return `<div class="pl-r${it.color ? ' c-' + it.color : ''}" role="button" tabindex="0" onclick="planItemOpen('${it.kind}','${it.id}')" onkeydown="if(event.key==='Enter'&&event.target===this)planItemOpen('${it.kind}','${it.id}')">${lead}
<div class="tx"><b>${escapeHtml(it.title)}</b><span class="s">${it.color ? `<i class="cc-dot c-${it.color}" aria-hidden="true"></i>` : ''}${escapeHtml(it.sub)}</span></div>${plan}<span class="pl-when${it.late ? ' t-red' : ''}">${escapeHtml(when)}</span></div>`;
}

// ---- the screen ------------------------------------------------------------------------------
function setPlanRange(n){ planRange = n; try{ localStorage.setItem('bda_plan_range', String(n)); }catch(e){} renderPlan(); }
function setPlanClient(v){ planClient = v; renderPlan(); }
function togglePlanGroup(g){ window._planOpen = { ...(window._planOpen || {}), [g]: !(window._planOpen || {})[g] }; renderPlan(); }
function selectPlanSprint(id){ window._planSel = window._planSel === id ? null : id; renderPlan(); }
function closePlanPanel(){ window._planSel = null; window._planAddStep = null; window._planAddRem = null; renderPlan(); }
function openPlanSprint(id){ closeAppModal?.(); window._planSel = id; if(currentViewName === 'plan') renderPlan(); else switchView('plan'); }
async function setPlanWeeklyHours(v){
  const n = Math.max(1, Math.min(60, Number(v) || 20)); planWeeklyHours = n; renderPlan();
  const { error } = await supabaseClient.from('plan_settings').upsert({ user_id: currentUser.id, weekly_hours: n }, { onConflict: 'user_id' });
  if(error) showToast('error', 'Not saved', 'Your weekly hours couldn’t be saved. Try again in a moment.');
}

function renderPlan(){
  const root = document.getElementById('planRoot');
  if(!root || !currentUser) return;
  const now = rNow(), today = toDateStr(now), weeks = planRange, mon = planMonday(now);
  const cols = weeks * 5, rangeEnd = toDateStr(addDays(mon, weeks * 7 - 1));
  const dayAt = k => addDays(mon, Math.floor(k / 5) * 7 + (k % 5));
  const colOf = (ds, edge) => {   // weekday column for a date; weekends snap forward (start) or back (end)
    let d = new Date(ds + 'T12:00:00');
    if(isPlanWeekend(d)) d = edge === 'end' ? addDays(d, d.getDay() === 6 ? -1 : -2) : addDays(d, d.getDay() === 6 ? 2 : 1);
    const w = Math.floor(daysBetween(mon, d) / 7); return w * 5 + (d.getDay() + 6) % 7;
  };
  const sprints = planSprints.filter(s => planClient === 'all' || s.clientId === planClient);
  const shown = sprints.filter(s => s.end >= toDateStr(mon) && s.start <= rangeEnd && (!s.doneAt || s.end >= today));
  // lanes: a sprint takes the first lane free of overlap
  const lanes = [];
  shown.slice().sort((a, b) => a.start.localeCompare(b.start)).forEach(s => {
    const a = Math.max(0, colOf(s.start < toDateStr(mon) ? toDateStr(mon) : s.start, 'start')), b = Math.min(cols - 1, colOf(s.end > rangeEnd ? rangeEnd : s.end, 'end'));
    if(b < a) return;
    let li = lanes.findIndex(l => l.every(x => x.b < a || x.a > b)); if(li < 0){ lanes.push([]); li = lanes.length - 1; }
    lanes[li].push({ s, a, b });
  });
  // hours per week: a sprint's hours spread over its workdays
  const planned = Array(weeks).fill(0), cap = Array(weeks).fill(0);
  for(let w = 0; w < weeks; w++){ const wd = [0, 1, 2, 3, 4].filter(k => isPlanWorkday(addDays(mon, w * 7 + k))).length; cap[w] = planWeeklyHours * wd / 5; }
  planSprints.filter(s => !s.doneAt).forEach(s => { const days = planWorkdays(s.start, s.end); if(!days.length) return;
    days.forEach(ds => { const w = Math.floor(daysBetween(mon, new Date(ds + 'T12:00:00')) / 7); if(w >= 0 && w < weeks) planned[w] += s.hours / days.length; }); });
  const wkHtml = Array.from({ length: weeks }, (_, w) => {
    const p = Math.round(planned[w]), c = Math.round(cap[w]), over = planned[w] > cap[w] + .5;
    return `<div class="pl-wk${w === 0 ? ' is-now' : ''}"><b>${fmtShortDate(addDays(mon, w * 7))}</b>${weeks <= 6 ? `<span class="${over ? 't-red' : ''}">${p} of ${c} h</span><i><em class="${over ? 'is-over' : ''}" style="width:${Math.min(100, c ? Math.round(planned[w] / c * 100) : 0)}%"></em></i>` : ''}</div>`;
  }).join('');
  // the look-ahead, and how busy each day is
  const items = planAheadItems(rangeEnd);
  const perDay = {}; items.forEach(it => { if(it.kind !== 'alert' && it.date >= toDateStr(mon)) perDay[it.date] = (perDay[it.date] || 0) + 1; });
  const days = Array.from({ length: cols }, (_, k) => { const d = dayAt(k), ds = toDateStr(d), n = perDay[ds] || 0;
    return `<span class="${ds === today ? 'is-today' : ''}${ds < today ? ' is-past' : ''}" title="${escapeHtml(d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }))}${n ? ` · ${n} due` : ''}">${weeks <= 6 ? 'MTWTF'[k % 5] : ''}${n ? `<i class="pl-dd">${'<em></em>'.repeat(Math.min(3, Math.ceil(n / 2)))}</i>` : ''}</span>`; }).join('');
  // off days (holidays), merged when they sit side by side
  const off = []; for(let k = 0; k < cols; k++){ const ds = toDateStr(dayAt(k)), h = planHoliday(ds); if(!h) continue;
    const last = off[off.length - 1]; if(last && last.b === k - 1){ last.b = k; last.names.push(h); } else off.push({ a: k, b: k, names: [h] }); }
  const offHtml = off.map(o => `<div class="pl-off" style="grid-column:${o.a + 1}/${o.b + 2};grid-row:1/${lanes.length + 2}" title="${escapeHtml([...new Set(o.names)].join(', '))}"><span>Off</span></div>`).join('');
  const nowCol = colOf(today, 'start'), frac = isPlanWeekend(now) ? 0 : Math.min(1, Math.max(0, (now.getHours() + now.getMinutes() / 60 - 9) / 9));
  const nowLeft = (nowCol + frac) / cols * 100;
  const sel = window._planSel && planSprint(window._planSel);
  if(window._planSel && !sel) window._planSel = null;
  const bars = lanes.map((l, li) => l.map(({ s, a, b }) => {
    const st = planState(s);
    return `<button class="pl-b${s.color ? ' c-' + s.color : ''}${sel && sel.id === s.id ? ' is-sel' : ''}${s.doneAt ? ' is-done' : ''}" style="grid-column:${a + 1}/${b + 2};grid-row:${li + 1}" onclick="selectPlanSprint('${s.id}')" title="${escapeHtml(s.title)}">
<b>${escapeHtml(s.title)}</b><span>${s.hours ? `${Math.round(s.hours)} h · ` : ''}${st.steps.length ? `${st.done} of ${st.steps.length} steps` : 'No steps yet'}</span></button>`;
  }).join('')).join('');
  const ghost = `<button class="pl-ghost" style="grid-row:${lanes.length + 1}" onclick="openNewSprintModal()">${icon('plus')}${planReady === false ? 'Plan needs a one-time database update' : lanes.length ? 'Plan a sprint' : 'Plan your first sprint'}</button>`;
  // the look-ahead, in three lists side by side (stacked when narrow), soonest first
  const opened = window._planOpen || {};
  const colsHtml = PLAN_GROUPS.map(([g, name, none]) => {
    const all = items.filter(it => it.group === g), open = opened[g] && all.length > PLAN_SHOW, list = open ? all : all.slice(0, PLAN_SHOW);
    const more = all.length > PLAN_SHOW ? `<button class="pl-more" data-grow="pl-g-${g}" data-turn="180" aria-expanded="${!!open}" onclick="togglePlanGroup('${g}')">${open ? 'Show less' : `${all.length - PLAN_SHOW} more`}${icon('caret-down', { weight: 'bold' })}</button>` : '';
    return `<section class="pl-col" aria-label="${name}"><div class="pl-sec pl-gh"><b>${name}</b>${all.length ? `<span class="n">${all.length}</span>` : ''}</div>
<div class="pl-gl" data-grow-key="pl-g-${g}">${list.map(planItemHtml).join('') || `<p class="pl-empty">${none}</p>`}</div>${more}</section>`;
  }).join('');
  const ahead = `<div class="pl-ah"><div class="pl-ah-h"><h3>Coming up</h3><span class="pl-ah-r">Next ${weeks === 6 ? '6 weeks' : '3 months'}</span></div><div class="pl-cols">${colsHtml}</div></div>`;
  // the side: sprint reminders coming up, and what's worth planning
  const rems = items.filter(it => it.kind === 'alert').slice(0, 3);
  const remHtml = rems.length ? rems.map(it => `<div class="pl-rm${it.color ? ' c-' + it.color : ''}" role="button" tabindex="0" onclick="selectPlanSprint('${it.id}')"><span class="pl-ic">${icon('bell-ring')}</span><div class="tx"><b>${escapeHtml(it.title)}</b><span class="s">${escapeHtml(it.sub.replace(/ · reminder$/, ''))}</span></div><span class="pl-rw">${escapeHtml(planDayLabel(it.date))}<em>${it.time ? fmtTime(atTime(new Date(it.date + 'T12:00:00'), it.time)) : ''}</em></span></div>`).join('')
    : `<p class="pl-empty">Sprint reminders show here. Add them when you plan a sprint.</p>`;
  const ideas = (typeof notes !== 'undefined' ? notes : []).filter(n => n.status === 'idea' && n.clientId && !planSprints.some(s => s.noteId === n.id))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 2)
    .map(n => ({ ic: 'sticky-note', t: n.title || 'Untitled note', s: `${(clients.find(c => c.id === n.clientId) || {}).name || ''} · from your notes`, run: `openNewSprintModal({ clientId: '${n.clientId}', noteId: '${n.id}' })` }));
  const me = myName();
  // (not a paused client: no new work while they're paused)
  const room = activeClients().filter(c => c.status !== 'Paused' && c.monthlyHourBudget && clientOwner(c) === me && !planSprints.some(s => !s.doneAt && s.clientId === c.id && s.end >= today))
    .map(c => ({ c, left: c.monthlyHourBudget - monthHours(c, now) })).filter(x => x.left >= 8).sort((a, b) => b.left - a.left).slice(0, 3 - Math.min(ideas.length, 1))
    .map(({ c, left }) => ({ ic: 'clock', t: c.name, s: `${Math.round(left)} h of budget left this month`, run: `openNewSprintModal({ clientId: '${c.id}' })` }));
  // Claude's ideas on your clients first, as small cards (claude-plan.js claudePlanIdeasHtml, Nov 26), then
  // your notes' ideas and clients with room, as rows
  const cIdeas = typeof claudePlanIdeasHtml === 'function' ? claudePlanIdeasHtml() : '';
  const worth = [...ideas, ...room].slice(0, 3);
  const worthHtml = cIdeas || worth.length ? cIdeas + worth.map(x => `<div class="pl-id"><span class="pl-xi">${icon(x.ic)}</span><div class="tx"><b>${escapeHtml(x.t)}</b><span class="s">${escapeHtml(x.s)}</span></div><button class="btn btn-sm" onclick="${x.run}">Plan</button></div>`).join('')
    : `<p class="pl-empty">Claude’s ideas, ideas in your notes and clients with budget left show here.</p>`;
  const hoursOpts = [5, 10, 15, 20, 25, 30, 35, 40];
  if(!hoursOpts.includes(planWeeklyHours)) hoursOpts.push(planWeeklyHours), hoursOpts.sort((a, b) => a - b);
  const side = `<aside class="pl-side">
<div class="pl-sec"><b>Sprint reminders</b>${rems.length ? `<span class="n">${rems.length}</span>` : ''}</div>${remHtml}
<div class="pl-sec"><b>Worth planning</b></div>${worthHtml}
<div class="pl-sec"><b>Your hours</b></div>
<div class="pl-hrs"><span>Planned work</span><label class="pop pop-sel"><span class="pl">${planWeeklyHours} h a week</span>${icon('caret-down')}<select aria-label="Hours a week for planned work" onchange="setPlanWeeklyHours(this.value)">${hoursOpts.map(h => `<option value="${h}"${h === planWeeklyHours ? ' selected' : ''}>${h} h a week</option>`).join('')}</select></label></div>
<p class="pl-lock">${icon('lock-simple')}Only you see your plan. Steps you give to someone else show in their Tasks.</p>
</aside>`;
  // header
  const live = planSprints.filter(s => !s.doneAt && s.end >= today);
  const totalP = Math.round(planned.reduce((a, b) => a + b, 0)), totalC = Math.round(cap.reduce((a, b) => a + b, 0));
  const nextRem = items.find(it => it.kind === 'alert');
  const sub = [`${live.length} sprint${live.length === 1 ? '' : 's'}`, `${totalP} of ${totalC} h planned`].join(' · ')
    + (nextRem ? ` · next reminder <b>${escapeHtml(planDayLabel(nextRem.date))}${nextRem.time ? ', ' + fmtTime(atTime(new Date(nextRem.date + 'T12:00:00'), nextRem.time)) : ''}</b>` : '');
  const used = [...new Set(planSprints.map(s => s.clientId).filter(Boolean))].map(id => clients.find(c => c.id === id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  if(planClient !== 'all' && !used.some(c => c.id === planClient)) planClient = 'all';
  const curC = used.find(c => c.id === planClient);
  const setup = planReady === false ? `<div class="pl-setup"><span><b>Turn on sprints:</b> an admin runs <code>addendum-colors-and-plan.sql</code> in Supabase, and they switch on by themselves. Everything coming up below already works.</span>${canApprove() ? `<a class="x-lnk" href="${escapeHtml(SUPABASE_URL.replace(/^https:\/\/([^.]+)\..*$/, 'https://supabase.com/dashboard/project/$1/sql/new'))}" target="_blank" rel="noopener">Open the SQL Editor</a>` : ''}</div>` : '';
  const head = `<div class="pl-hd"><div><h2>Your next ${weeks === 6 ? '6 weeks' : '3 months'}</h2><p>${sub}</p></div>
<div class="pl-f"><div class="seg" role="tablist" aria-label="Range"><button class="${weeks === 6 ? 'on' : ''}" role="tab" aria-selected="${weeks === 6}" onclick="setPlanRange(6)">6 Weeks</button><button class="${weeks === 13 ? 'on' : ''}" role="tab" aria-selected="${weeks === 13}" onclick="setPlanRange(13)">3 Months</button></div>
${used.length ? `<label class="pop pop-sel"><span class="pl">Client: ${escapeHtml(curC ? curC.name : 'All')}</span>${icon('caret-down')}<select aria-label="Client" onchange="setPlanClient(this.value)"><option value="all">All</option>${used.map(c => `<option value="${c.id}"${c === curC ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select></label>` : ''}</div></div>`;
  // the new look: the timeline is a card with its own head, like the canvas
  const uwHead = typeof uiStyleOn === 'function' && uiStyleOn() ? `<div class="pl-tlh"><span class="pl-tli">${icon('plan')}</span><b>Next ${weeks === 6 ? 'six weeks' : '3 months'}</b><span class="pl-tlc"><i></i>${planWeeklyHours} h a week for planned work</span></div>` : '';
  const timeline = `<section class="pl-tl${weeks > 6 ? ' is-long' : ''}" aria-label="The next ${weeks} weeks" style="--cols:${cols}">${uwHead}
<div class="pl-wks" style="grid-template-columns:repeat(${weeks},minmax(0,1fr))">${wkHtml}</div>
<div class="pl-days" aria-hidden="true">${days}</div>
<div class="pl-lanes" style="--wk:${weeks}">${offHtml}<span class="pl-now" aria-hidden="true" style="left:${nowLeft.toFixed(2)}%"></span>${bars}${ghost}</div>
</section>`;
  const prev = root.querySelector('.sp-page')?.scrollTop || 0, prevSp = root.querySelector('.sp:not(.sp-leaving)')?.scrollTop || 0;
  const keep = { step: document.getElementById('plpStepIn')?.value || '' };
  root.innerHTML = `<div class="spw"><div class="sp-page"><div class="pln">${head}${setup}<div class="pl-body"><div class="pl-main">${timeline}${ahead}</div>${side}</div></div></div>${sel ? planPanelHtml(sel) : ''}</div>`;
  const sp = root.querySelector('.sp-page'); if(sp) sp.scrollTop = prev;
  const pn = root.querySelector('.sp:not(.sp-leaving)'); if(pn){ pn.scrollTop = prevSp; pn._st = prevSp; }
  const si = document.getElementById('plpStepIn'); if(si && keep.step) si.value = keep.step;
  if(currentViewName === 'plan') setToolbar(null, `${live.length} sprint${live.length === 1 ? '' : 's'} · next ${weeks === 6 ? '6 weeks' : '3 months'}`);
}

// ---- a sprint open (right panel) -------------------------------------------------------------
function planPanelHtml(s){
  const c = s.clientId && clients.find(x => x.id === s.clientId), st = planState(s), today = toDateStr(rNow());
  const tracked = planTracked(s), hrs = Math.round(s.hours);
  const dates = `${fmtShortDate(new Date(s.start + 'T12:00:00'))} – ${fmtShortDate(new Date(s.end + 'T12:00:00'))}`;
  const nextTxt = st.next ? ` Next up: ${st.next.title}${st.next.dueDate ? ` by ${planDayLabel(st.next.dueDate).replace(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/, d => DAY_NAMES.find(x => x.startsWith(d)))}` : ''}.` : '';
  let eyebrow, title, sub, main = '';
  const trackTxt = c ? `${Math.round(tracked)} of ${hrs} h tracked.` : `${hrs} h planned.`;
  if(st.kind === 'done'){ eyebrow = `<span class="sp-eb ok">${icon('check', { weight: 'bold' })}Done</span>`; title = `${st.done} of ${st.steps.length} steps done`; sub = `Finished ${escapeHtml(relDayLower(new Date(s.doneAt)))}. ${trackTxt}`; }
  else if(st.kind === 'upcoming'){ const k = daysBetween(dayStart(rNow()), new Date(s.start + 'T12:00:00'));
    eyebrow = `<span class="sp-eb">${icon('clock', { weight: 'bold' })}Starts ${k === 1 ? 'tomorrow' : k < 7 ? DAY_NAMES[new Date(s.start + 'T12:00:00').getDay()] : 'in ' + k + ' days'}</span>`;
    title = st.steps.length ? `${st.steps.length} step${st.steps.length === 1 ? '' : 's'} planned` : 'No steps yet'; sub = `${hrs} h over ${st.days.length} workdays.`; }
  else if(st.kind === 'ended'){ eyebrow = `<span class="sp-eb warn"><i class="eb-dot"></i>Ended ${escapeHtml(relDayLower(new Date(s.end + 'T12:00:00')))}</span>`;
    title = `${st.done} of ${st.steps.length} steps done`; sub = `${trackTxt} Mark it done, or move the end date.`;
    main = `<button class="btn btn-p" onclick="setPlanSprintDone('${s.id}', true)">${icon('check')}Mark Done</button>`; }
  else { eyebrow = `<span class="sp-eb plp-blue">${icon('clock', { weight: 'bold' })}Day ${st.elapsed} of ${st.days.length}</span>`;
    title = st.steps.length ? `${st.behind ? 'Behind' : 'On track'}: ${st.done} of ${st.steps.length} steps done` : 'Add the steps for this sprint';
    sub = `${trackTxt}${nextTxt}`;
    if(c) main = `<button class="btn btn-p" onclick="openTimerModal('${c.id}')">${icon('timer')}Start Timer</button>`; }
  const acts = s.doneAt ? `<button class="btn" onclick="setPlanSprintDone('${s.id}', false)">Reopen</button>` : `<button class="btn" onclick="planShowAddStep()">${icon('plus')}Add Step</button>${main}`;
  const warn = planBudgetWarning(s);
  const steps = st.steps.map(t => { const done = t.status === 'done', mine = t.assigneeId === currentUser?.id;
    const cb = done ? `<span class="plp-cb on">${icon('check', { weight: 'bold' })}</span>` : mine ? `<button class="plp-cb" role="checkbox" aria-checked="false" aria-label="Mark done" onclick="event.stopPropagation();moveTaskToStatus('${t.id}','done')"></button>` : `<span class="plp-cb is-off" title="${escapeHtml(tkWho(t.assigneeId))}’s"></span>`;
    return `<div class="plp-s${done ? ' on' : ''}" role="button" tabindex="0" onclick="openTaskDetailModal('${t.id}')" onkeydown="if(event.key==='Enter'&&event.target===this)openTaskDetailModal('${t.id}')">${cb}<span class="t">${escapeHtml(t.title)}</span>${!mine ? `<em>${escapeHtml(tkWho(t.assigneeId))}</em>` : ''}<time${!done && t.dueDate && t.dueDate < today ? ' class="t-red"' : ''}>${t.dueDate ? escapeHtml(planDayLabel(t.dueDate)) : ''}</time></div>`; }).join('');
  const addStep = window._planAddStep === s.id ? `<div class="plp-add"><span class="plp-cb"></span><input id="plpStepIn" class="tf" placeholder="What’s the step? Return to add" aria-label="New step" onkeydown="if(event.key==='Enter'){event.preventDefault();planAddStep('${s.id}')}else if(event.key==='Escape'){event.stopPropagation();window._planAddStep=null;renderPlan()}"><button class="btn btn-sm" onclick="planAddStep('${s.id}')">Add</button></div>` : '';
  const rems = (s.reminders || []).map((r, i) => ({ r, i })).sort((a, b) => new Date(a.r.at) - new Date(b.r.at));
  const remHtml = rems.map(({ r, i }) => { const at = new Date(r.at);
    return `<div class="plp-r${r.sent ? ' is-past' : ''}"><span class="pl-ic">${icon('bell-ring')}</span><b>${escapeHtml(r.label || 'Reminder')}</b><span>${at.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}, ${fmtTime(at)}${r.sent ? ' · sent' : ''}</span>${r.sent ? '' : `<button class="ib" aria-label="Remove reminder" title="Remove" onclick="planRemoveReminder('${s.id}', ${i})">${icon('x')}</button>`}</div>`; }).join('');
  const addRem = window._planAddRem === s.id ? `<div class="plp-ra">${sheetDateField('plpRemDate', s.start > today ? s.start : today, { from: 0, to: 60, min: today, label: 'Reminder date' })}${sheetPop('plpRemTime', 'Time', taskTimeOptions().slice(1), '09:00')}<input id="plpRemLabel" class="tf" placeholder="Check in" aria-label="What to remind you"><button class="btn btn-sm btn-p" onclick="planAddReminder('${s.id}')">Add</button></div>` : '';
  const more = `<button class="mi" onclick="openNewSprintModal({ edit: '${s.id}' })">${icon('pencil-simple')}Edit Sprint</button>${s.doneAt ? '' : `<button class="mi" onclick="setPlanSprintDone('${s.id}', true)">${icon('check-circle')}Mark Done</button>`}<div class="msep"></div><button class="mi danger" onclick="deletePlanSprint('${s.id}')">${icon('trash')}Delete Sprint…</button>`;
  return `<aside class="sp plp${s.color ? ' c-' + s.color : ''}" aria-label="${escapeHtml(s.title)}">
<div class="sp-bar"><button class="ib" aria-label="Close" title="Close (Esc)" onclick="closePlanPanel()">${icon('x')}</button><span class="plp-br"><button class="ib" aria-label="More" title="More" onclick="planMore(event)">${icon('dots-three')}</button><template id="plpMoreItems">${more}</template><a class="x-lnk" href="#" onclick="openNewSprintModal({ edit: '${s.id}' });return false;">Edit</a></span></div>
<div class="plp-h"><span class="plp-sw"></span><div class="tx"><b>${escapeHtml(s.title)}</b><span>${[c ? c.name : 'No client', dates, `${st.days.length} workday${st.days.length === 1 ? '' : 's'}`].map(escapeHtml).join(' · ')}</span></div></div>
<div class="sp-status">${eyebrow}<b>${escapeHtml(title)}</b><span class="sub">${escapeHtml(sub)}</span><div class="sp-acts">${acts}</div></div>
${warn ? `<p class="plp-warn"><span>${warn} <a class="fix-lnk" href="#" onclick="openNewSprintModal({ edit: '${s.id}' });return false;">Move or shorten the sprint</a></span></p>` : ''}
${s.goal ? `<div class="sp-sec"><b>Goal</b></div><p class="plp-goal">${escapeHtml(s.goal)}</p>` : ''}
<div class="sp-sec"><b>Steps</b>${st.steps.length ? `<span>${st.done} of ${st.steps.length}</span>` : ''}${st.steps.length ? `<a class="x-lnk" href="#" onclick="planOpenInTasks('${s.id}');return false;">Open in Tasks</a>` : ''}</div>
${steps || (addStep ? '' : `<p class="sp-empty">No steps yet. Each step is a task for you, with a date inside the sprint.</p>`)}${addStep}
${!addStep && !s.doneAt ? `<button class="plp-new" onclick="planShowAddStep()">${icon('plus')}Add a step</button>` : ''}
<div class="sp-sec"><b>Reminders</b>${s.doneAt ? '' : `<a class="x-lnk" href="#" onclick="window._planAddRem=window._planAddRem==='${s.id}'?null:'${s.id}';renderPlan();return false;">${window._planAddRem === s.id ? 'Cancel' : 'Add'}</a>`}</div>
${remHtml || (addRem ? '' : '<p class="sp-empty">No reminders.</p>')}${addRem}
</aside>`;
}
function planMore(e){
  e.stopPropagation();
  const had = document.getElementById('plpMenu'); had?.remove(); if(had) return;
  const tpl = document.getElementById('plpMoreItems'); if(!tpl) return;
  const m = document.createElement('div');
  m.className = 'menu'; m.id = 'plpMenu'; m.style.position = 'fixed';
  const r = e.currentTarget.getBoundingClientRect();
  m.style.top = (r.bottom + 4) + 'px'; m.style.right = (window.innerWidth - r.right) + 'px';
  m.innerHTML = tpl.innerHTML;
  document.body.appendChild(m);
  setTimeout(() => document.addEventListener('click', () => m.remove(), { once: true }), 0);
}
function planShowAddStep(){ window._planAddStep = window._planSel; renderPlan(); setTimeout(() => document.getElementById('plpStepIn')?.focus(), 30); }
function planOpenInTasks(id){ const s = planSprint(id); if(s && s.clientId && typeof setTasksClient === 'function') tasksClient = s.clientId; switchView('tasks'); }

// The next workday in the sprint without a step due, so new steps fill the sprint in order.
function planNextStepDate(s){
  const days = planWorkdays(s.start, s.end), today = toDateStr(rNow()), taken = new Set(planSteps(s).map(t => t.dueDate));
  return days.find(d => d >= today && !taken.has(d)) || days.filter(d => d >= today).pop() || s.end;
}
function planStepRow(s, title, due){
  const row = { title, description: '', priority: null, assigner_id: currentUser.id, assignee_id: currentUser.id, client_id: s.clientId, due_date: due, status: 'todo', sprint_id: s.id };
  if(s.color) row.color = s.color;
  return row;
}
async function planAddStep(id){
  const s = planSprint(id), inp = document.getElementById('plpStepIn'), title = (inp?.value || '').trim();
  if(!s || !title){ inp?.focus(); return; }
  const { error } = await insertTaskRow(planStepRow(s, title, planNextStepDate(s)));
  if(error){ showToast('error', 'Step not added', error.message); return; }
  if(inp) inp.value = '';
  await loadMyTasks(); renderPlan(); renderTasks?.();
  setTimeout(() => document.getElementById('plpStepIn')?.focus(), 30);
}
async function savePlanReminders(s){
  const { error } = await supabaseClient.from('plan_sprints').update({ reminders: s.reminders, updated_at: new Date().toISOString() }).eq('id', s.id).eq('user_id', currentUser.id);
  if(error) showToast('error', 'Not saved', error.message);
  return !error;
}
async function planAddReminder(id){
  const s = planSprint(id); if(!s) return;
  const d = document.getElementById('plpRemDate')?.value, tm = document.getElementById('plpRemTime')?.value || '09:00';
  const label = (document.getElementById('plpRemLabel')?.value || '').trim() || 'Check in';
  if(!d){ showToast('error', 'Pick a date', 'Choose when to remind you.'); return; }
  const at = atTime(new Date(d + 'T12:00:00'), tm);
  if(at < rNow()){ showToast('error', 'That time has passed', 'Pick a later time.'); return; }
  s.reminders = [...(s.reminders || []), { kind: 'custom', at: at.toISOString(), label, sent: false }];
  window._planAddRem = null; renderPlan();
  await savePlanReminders(s);
}
async function planRemoveReminder(id, i){
  const s = planSprint(id); if(!s) return;
  s.reminders = (s.reminders || []).filter((_, k) => k !== i); renderPlan();
  await savePlanReminders(s);
}
async function setPlanSprintDone(id, done){
  const s = planSprint(id); if(!s) return;
  const doneAt = done ? new Date().toISOString() : null;
  const { error } = await supabaseClient.from('plan_sprints').update({ done_at: doneAt }).eq('id', id).eq('user_id', currentUser.id);
  if(error){ showToast('error', 'Not saved', error.message); return; }
  s.doneAt = doneAt; renderPlan();
  if(done) showToast('success', 'Sprint done', `${s.title} is marked done.`);
}
// The sprint's own all-day event ("Add to my calendar"): it isn't linked by id, so it's found by what it
// was made with: yours, all day, "Sprint: <title>", on the sprint's dates. Deleting the sprint deletes it,
// and changing the sprint's name or dates moves it (Nov 27: a deleted sprint stayed on the calendar).
const planEvDay = v => v ? toDateStr(new Date(v)) : '';   // events are on their local day (helpers.js allDayAt)
function planIsSprintEvent(e){ return !!e && e.allDay && e.createdBy === currentUser.id && /^Sprint: /.test(e.title || ''); }
function planSprintEvents(s){
  if(typeof calendarEvents === 'undefined' || !s) return [];
  return calendarEvents.filter(e => planIsSprintEvent(e) && e.title === `Sprint: ${s.title}` && planEvDay(e.startAt) === s.start && planEvDay(e.endAt) === s.end);
}
async function planDropSprintEvents(ids){
  if(!ids.length) return;
  const { error } = await supabaseClient.from('calendar_events').delete().in('id', ids);
  if(error) return showToast('error', 'Still on the calendar', `The sprint’s calendar event wasn’t removed: ${error.message}`);
  calendarEvents = calendarEvents.filter(e => !ids.includes(e.id));
  if(typeof currentViewName !== 'undefined' && currentViewName === 'calendar' && typeof renderCalendar === 'function') renderCalendar();
}
// Sprints deleted before Nov 27 left theirs behind: a "Sprint: …" event of yours that no sprint of yours
// has (by name or by dates) goes, once both are loaded.
let planCalTidied = false;
async function planCalTidy(){
  if(planCalTidied || !planReady || typeof calendarDataLoaded === 'undefined' || !calendarDataLoaded || !currentUser) return;
  planCalTidied = true;
  const names = new Set(planSprints.map(x => `Sprint: ${x.title}`)), spans = new Set(planSprints.map(x => `${x.start}|${x.end}`));
  const gone = calendarEvents.filter(e => planIsSprintEvent(e) && e.eventType === 'reminder' && !names.has(e.title) && !spans.has(`${planEvDay(e.startAt)}|${planEvDay(e.endAt)}`)).map(e => e.id);
  await planDropSprintEvents(gone);
}
async function deletePlanSprint(id){
  const s = planSprint(id); if(!s) return;
  const open = planSteps(s).filter(t => t.status !== 'done').length;
  if(!(await confirmDialog(`Delete “${s.title}”?${open ? ` Its ${open} open step${open === 1 ? '' : 's'} stay in Tasks.` : ''} This can’t be undone.`, { confirmLabel: 'Delete Sprint', cancelLabel: 'Cancel', destructive: true }))) return;
  const { error } = await supabaseClient.from('plan_sprints').delete().eq('id', id).eq('user_id', currentUser.id);
  if(error){ showToast('error', 'Not deleted', error.message); return; }
  planSprints = planSprints.filter(x => x.id !== id); window._planSel = null;
  tasks.forEach(t => { if(t.sprintId === id) t.sprintId = null; });
  await planDropSprintEvents(planSprintEvents(s).map(e => e.id));
  renderPlan(); showToast('success', 'Sprint deleted', open ? 'Its steps are still in Tasks.' : '');
}

// Reminders go out as notifications (in the app, push and Slack, as you've set them) when they're
// due and the app is open on any of your devices; with "Add to my calendar" the sprint is on your
// calendar too.
let _planRemBusy = false;
async function checkPlanReminders(){
  if(_planRemBusy || !currentUser || !planReady) return;
  _planRemBusy = true;
  try{
    const now = rNow();
    for(const s of planSprints){
      if(s.doneAt) continue;
      const due = (s.reminders || []).map((r, i) => ({ r, i })).filter(({ r }) => !r.sent && new Date(r.at) <= now);
      if(!due.length) continue;
      due.forEach(({ r }) => { r.sent = true; });
      if(!(await savePlanReminders(s))) continue;
      const st = planState(s);
      for(const { r } of due){
        const body = st.kind === 'running' && st.steps.length ? `${st.done} of ${st.steps.length} steps done.${st.next ? ' Next: ' + st.next.title + '.' : ''}` : `${fmtShortDate(new Date(s.start + 'T12:00:00'))} – ${fmtShortDate(new Date(s.end + 'T12:00:00'))}`;
        await sendNotification(currentUser.id, 'plan_reminder', `${r.label}: ${s.title}`, body, 'plan', s.id, true);
        showToast('info', `${r.label}: ${s.title}`, body);
      }
    }
  } finally { _planRemBusy = false; }
  if(currentViewName === 'plan') renderPlan();
}
setInterval(() => { if(typeof currentUser !== 'undefined' && currentUser) checkPlanReminders(); }, 60000);

// ---- New Sprint / Edit Sprint ----------------------------------------------------------------
let planSheet = null;   // { edit, steps[], hours, noteId, taskId }
function planDefaultStart(){ let d = dayStart(rNow()); if(rNow().getHours() >= 15) d = addDays(d, 1); while(!isPlanWorkday(d)) d = addDays(d, 1); return toDateStr(d); }
function planAddWorkdays(ds, n){ let d = new Date(ds + 'T12:00:00'), k = 0; while(k < n){ d = addDays(d, 1); if(isPlanWorkday(d)) k++; } return toDateStr(d); }
function planPresetReminders(start, end){
  const days = planWorkdays(start, end), half = days[Math.floor((days.length - 1) / 2)] || start;
  const beforeEnd = days.length > 1 ? days[days.length - 2] : start;
  return [['start', 'When it starts', start, '09:00'], ['half', 'Halfway check-in', half, '09:00'], ['end', 'The day before it ends', beforeEnd, '16:00']]
    .map(([kind, label, d, t]) => ({ kind, label, at: atTime(new Date(d + 'T12:00:00'), t).toISOString() }));
}
function openNewSprintModal(o){
  o = o || {};
  if(planReady === false){
    openAppModal(`<h3>Plan needs a database update</h3><p class="pls-p">Sprints are saved in a new private table. An admin runs <code>addendum-colors-and-plan.sql</code> once in Supabase → SQL Editor, and Plan turns on by itself. Until then, everything coming up still shows in Plan.</p><div class="sheet-a"><button class="btn btn-p" onclick="closeAppModal()">OK</button></div>`, 460);
    return;
  }
  const s = o.edit ? planSprint(o.edit) : null;
  const note = o.noteId && (typeof notes !== 'undefined' ? notes : []).find(n => n.id === o.noteId);
  // planned around a task: that task becomes the sprint's last step, and the sprint ends when it's due
  // (within two weeks; a task due later gets a two-week sprint)
  const task = !s && o.taskId ? tasks.find(t => t.id === o.taskId) : null;
  const start = s ? s.start : planDefaultStart();
  let end = s ? s.end : planAddWorkdays(start, 9);
  if(task){
    const cap = planAddWorkdays(start, 9);
    let due = task.dueDate && task.dueDate > start ? (task.dueDate < cap ? task.dueDate : cap) : planAddWorkdays(start, 4);
    while(due > start && !isPlanWorkday(new Date(due + 'T12:00:00'))) due = toDateStr(addDays(new Date(due + 'T12:00:00'), -1));
    end = due;
  }
  // from a meeting's notes (Nov 25): Claude drafts it (psFillFromMeeting)
  const meet = !s && o.meetingId && typeof granolaMeetings !== 'undefined' ? (granolaMeetings || []).find(x => x.id === o.meetingId) : null;
  const pre = !s && o.preset ? o.preset : null;   // Claude's proposal (Today's Plan, Nov 25): its title, goal and steps
  planSheet = { edit: s ? s.id : null, steps: s ? [] : pre && Array.isArray(pre.steps) && pre.steps.length ? pre.steps.slice(0, 10) : [''], hours: s ? Math.round(s.hours) : 10, noteId: o.noteId || null, taskId: task ? task.id : null, meetingId: meet ? meet.id : null, cnNote: !s && o.cnNote ? o.cnNote : null };   // a Claude idea made a sprint leaves every screen (claude-plan.js cnSettle)
  const clientId = s ? (s.clientId || '') : (o.clientId || (note && note.clientId) || (task && task.clientId) || '');
  const remOn = s ? new Set((s.reminders || []).filter(r => r.kind && r.kind !== 'custom').map(r => r.kind)) : new Set(['start', 'half', 'end']);
  const noteMenu = meet ? `<span style="margin-right:auto"><button type="button" class="btn cl-claude-btn" id="psFillBtn" onclick="psFillFromMeeting()">${CLAUDE_SPARK}Draft Again</button></span>`
    : task ? `<span style="margin-right:auto"><button type="button" class="btn" id="psFillBtn" onclick="psFillFromTask()">${icon('sparkle')}Suggest Steps</button></span>`
    : !s ? `<span style="position:relative;margin-right:auto"><button type="button" class="btn" id="psFillBtn" onclick="psToggleNoteMenu()">${icon('sparkle')}Fill from a note</button><div class="menu" id="psNoteMenu" hidden style="bottom:34px;left:0;width:300px;max-height:260px;overflow:auto"></div></span>` : '';
  openAppModal(`<h3>${s ? 'Edit Sprint' : 'New Sprint'}</h3>
<div class="f pls">
<label for="psTitle">Title</label><input id="psTitle" class="tf" spellcheck="true" placeholder="e.g. Brightway website refresh" value="${escapeHtml(s ? s.title : note ? note.title || '' : task ? task.title : meet ? meet.title || '' : pre ? pre.title || '' : '')}">
<label for="psClient">Client</label><div>${sheetPop('psClient', 'Client', [['', 'No client'], ...workClients(clientId).slice().sort((a, b) => a.name.localeCompare(b.name)).map(c => [c.id, c.name])], clientId, 'psSync()')}</div>
<label>Dates</label><div class="pls-row">${sheetDateField('psStart', start, { from: 0, to: 60, label: 'Starts', after: 'psSync' })}<span class="pls-to">to</span>${sheetDateField('psEnd', end, { from: 0, to: 45, label: 'Ends', after: 'psSync' })}<span class="pls-h" id="psDays"></span></div>
<label>Hours</label><div class="pls-row"><span class="pls-num"><button type="button" aria-label="Fewer hours" onclick="psHours(-1)">−</button><b id="psHours">${planSheet.hours} h</b><button type="button" aria-label="More hours" onclick="psHours(1)">+</button></span><span class="pls-h" id="psBudget"></span></div>
<label class="top" for="psGoal">Goal</label><textarea id="psGoal" class="tf pls-goal" spellcheck="true" placeholder="What’s done when this sprint is done?">${escapeHtml(s ? s.goal : pre ? pre.goal || '' : '')}</textarea>
${s ? '' : `<label class="top">Steps</label><div class="pls-steps" id="psSteps"></div>`}
${meet ? `<span></span><div class="pls-addons" id="psAddons" hidden></div>` : ''}
<label class="top">Remind me</label><div class="pls-rms" id="psRems">${[['start', 'When it starts'], ['half', 'Halfway check-in'], ['end', 'The day before it ends']].map(([k, l]) => `<div class="pls-rm">${sheetCk(remOn.has(k), l, 'psRemToggle(this)').replace('<button', `<button data-k="${k}"`)}<b>${l}</b><span id="psRem-${k}"></span></div>`).join('')}</div>
<label>Color</label><div>${colorSwatchesHtml('psColor', s ? s.color : null)}</div>
${s ? '' : `<span></span><div style="display:flex;align-items:center;gap:10px;font-size:14px">${sheetSw('psCal', true, 'Add to my calendar')}Add to my calendar</div>`}
</div>
<div class="sheet-a">${noteMenu}<button class="btn" onclick="closeAppModal()">Cancel</button><button class="btn btn-p" onclick="savePlanSprint()">${s ? 'Save' : 'Create Sprint'}</button></div>`, 600);
  if(!s) psRenderSteps();
  psSync();
  setTimeout(() => document.getElementById('psTitle')?.focus(), 30);
  if(note && !s) psFillFromNote(note.id);
  if(task) psFillFromTask();
  if(meet) psFillFromMeeting();
}
// Claude drafts the sprint from the meeting's notes: title, goal, how long, the hours and the steps,
// inside what the client pays for; what's outside it shows under the steps, as add-ons to offer.
async function psFillFromMeeting(){
  const ps = planSheet; if(!ps || !ps.meetingId) return;
  const btn = document.getElementById('psFillBtn'), g = id => document.getElementById(id);
  if(btn){ btn.disabled = true; btn.innerHTML = `${CLAUDE_SPARK}Drafting…`; }
  const steps = g('psSteps'); if(steps) steps.classList.add('is-drafting');
  const r = await claudeApi({ action: 'sprint-from-meeting', note: ps.meetingId });
  if(planSheet !== ps || !g('psTitle')) return;
  if(btn){ btn.disabled = false; btn.innerHTML = `${CLAUDE_SPARK}Draft Again`; }
  if(steps) steps.classList.remove('is-drafting');
  if(r.error){ showToast('error', 'Claude couldn’t draft it', r.error); return; }
  g('psTitle').value = r.title || g('psTitle').value;
  g('psGoal').value = r.goal || g('psGoal').value;
  if(r.clientId && g('psClient')){ g('psClient').value = r.clientId; syncPopSel(g('psClient')); }
  const start = g('psStart').value || planDefaultStart();
  const sel = g('psEnd');
  if(sel && r.workdays){
    const end = planAddWorkdays(start, Math.max(1, r.workdays - 1));
    if(![...sel.options].some(x => x.value === end)) sel.add(new Option(sheetDateLabelLong(end), end), sel.querySelector('option[value="__other"]'));
    sel.value = end; syncPopSel(sel);
  }
  if(r.hours){ ps.hours = r.hours; const h = g('psHours'); if(h) h.textContent = ps.hours + ' h'; }
  if(Array.isArray(r.steps) && r.steps.length){ ps.steps = r.steps.slice(); psRenderSteps(); }
  const ad = g('psAddons');
  if(ad){
    ad.hidden = !(r.addOns && r.addOns.length);
    ad.innerHTML = r.addOns && r.addOns.length ? `${addonTagHtml('')}<ul>${r.addOns.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul><p>Left out of the sprint: they aren’t part of what ${escapeHtml(r.client || 'the client')} pays for.</p>` : '';
  }
  psSync();
}
function psRenderSteps(focus){
  const el = document.getElementById('psSteps'); if(!el || !planSheet) return;
  const task = planSheet.taskId && tasks.find(t => t.id === planSheet.taskId);
  el.innerHTML = planSheet.steps.map((t, i) => `<div class="pls-st"><span class="pl-cb"></span><input class="tf" value="${escapeHtml(t)}" placeholder="${i ? 'Another step' : 'First step, e.g. pull analytics and the top pages'}" aria-label="Step ${i + 1}" oninput="planSheet.steps[${i}]=this.value" onkeydown="psStepKey(event, ${i})">${planSheet.steps.length > 1 ? `<button type="button" class="ib" aria-label="Remove step" onclick="planSheet.steps.splice(${i},1);psRenderSteps()">${icon('x')}</button>` : ''}</div>`).join('')
    + `<button type="button" class="pls-st pls-add" onclick="planSheet.steps.push('');psRenderSteps(${planSheet.steps.length})">${icon('plus')}<span>Add a step</span></button>`
    + (task ? `<div class="pls-st pls-own"><span class="pl-cb"></span><span class="pls-ot">${escapeHtml(task.title)}</span><em class="${task.dueDate && task.dueDate < toDateStr(rNow()) ? 't-red' : ''}">${task.dueDate ? 'Due ' + escapeHtml(task.dueDate === toDateStr(addDays(rNow(), -1)) ? 'yesterday' : planDayLabel(task.dueDate)) : 'This task'}</em></div>` : '')
    + `<p class="pls-note">${task ? 'Each new step becomes a task for you, dated across the sprint. The task itself joins the sprint as it is, due date and all.' : 'Each step becomes a task for you, dated across the sprint.'}</p>`;
  if(focus != null) el.querySelectorAll('input')[focus]?.focus();
}
function psStepKey(e, i){
  if(e.key === 'Enter' && !e.isComposing){ e.preventDefault(); planSheet.steps.splice(i + 1, 0, ''); psRenderSteps(i + 1); }
  else if(e.key === 'Backspace' && !e.target.value && planSheet.steps.length > 1){ e.preventDefault(); planSheet.steps.splice(i, 1); psRenderSteps(Math.max(0, i - 1)); }
}
function psHours(d){ if(!planSheet) return; planSheet.hours = Math.max(0, Math.min(200, planSheet.hours + d)); document.getElementById('psHours').textContent = planSheet.hours + ' h'; psSync(); }
function psRemToggle(b){ const on = !b.classList.contains('on'); b.classList.toggle('on', on); b.setAttribute('aria-checked', on); b.innerHTML = on ? icon('check', { weight: 'bold' }) : ''; }
function psSync(){
  const g = id => document.getElementById(id);
  const start = g('psStart')?.value, end = g('psEnd')?.value; if(!start || !end) return;
  const days = end >= start ? planWorkdays(start, end) : [];
  if(g('psDays')) g('psDays').textContent = end < start ? 'Ends before it starts' : `${days.length} workday${days.length === 1 ? '' : 's'}`;
  g('psDays')?.classList.toggle('t-red', end < start);
  const c = clients.find(x => x.id === g('psClient')?.value), b = g('psBudget');
  if(b){
    if(c && c.monthlyHourBudget){
      const m = new Date(start + 'T12:00:00'), now = rNow(), same = m.getMonth() === now.getMonth() && m.getFullYear() === now.getFullYear();
      const left = c.monthlyHourBudget - (same ? monthHours(c, now) : 0);
      b.textContent = `${c.name} has ${Math.max(0, Math.round(left))} h left in ${m.toLocaleDateString('en-US', { month: 'long' })}`;
      b.classList.toggle('t-red', planSheet && planSheet.hours > left);
    } else b.textContent = '';
  }
  planPresetReminders(start, end >= start ? end : start).forEach(r => { const el = g('psRem-' + r.kind); if(el){ const d = new Date(r.at); el.textContent = `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}, ${fmtTime(d)}`; } });
}
function psToggleNoteMenu(){
  const m = document.getElementById('psNoteMenu'); if(!m) return;
  if(!m.hidden){ m.hidden = true; return; }
  const mine = (typeof notes !== 'undefined' ? notes : []).filter(n => (n.text || n.title)).sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)).slice(0, 10);
  m.innerHTML = '<div class="mh">Pick a note</div>' + (mine.length ? mine.map(n => { const c = clients.find(x => x.id === n.clientId); return `<button type="button" class="mi" style="height:auto;padding:6px 9px;flex-direction:column;align-items:flex-start;gap:1px" onclick="psFillFromNote('${n.id}')"><span style="font-weight:500">${escapeHtml(n.title || 'Untitled note')}</span><span class="t-2" style="font-size:12.5px">${escapeHtml(c ? c.name : (n.text || '').slice(0, 48))}</span></button>`; }).join('') : '<div class="mi" style="color:var(--label-2)">No notes yet</div>');
  m.hidden = false;
}
async function psFillFromNote(noteId){
  const n = (typeof notes !== 'undefined' ? notes : []).find(x => x.id === noteId);
  const m = document.getElementById('psNoteMenu'); if(m) m.hidden = true;
  if(!n || !planSheet) return;
  planSheet.noteId = n.id;
  const btn = document.getElementById('psFillBtn');
  if(btn){ btn.disabled = true; btn.innerHTML = `${icon('sparkle')}Filling…`; }
  let out = null;
  try{
    const prompt = `Turn this note into a short sprint of focused work for a marketing agency. Reply with JSON only, no other text: {"title": "...", "goal": "...", "steps": ["...", "..."]}.
- title: the sprint's name, under 50 characters
- goal: what's done when the sprint is done, one sentence under 160 characters
- steps: 3 to 7 steps in order, each starting with a verb, under 60 characters

Note title: ${n.title || ''}
Note:
${String(n.text || '').slice(0, 4000)}`;
    const r = await fetch('/api/generate-draft', { method: 'POST', headers: await apiAuthHeaders(), body: JSON.stringify({ prompt, model: settings.openaiModel }) });
    const data = await r.json();
    const mm = String(data.text || '').match(/\{[\s\S]*\}/);
    if(mm) out = JSON.parse(mm[0]);
  }catch(e){ console.error('Fill from a note failed', e); }
  if(!document.getElementById('psTitle') || !planSheet) return;
  const g = id => document.getElementById(id);
  g('psTitle').value = (out && out.title) || n.title || g('psTitle').value;
  if(!g('psGoal').value.trim()) g('psGoal').value = (out && out.goal) || '';
  if(n.clientId && g('psClient')){ g('psClient').value = n.clientId; syncPopSel(g('psClient')); }
  const steps = out && Array.isArray(out.steps) ? out.steps.filter(x => typeof x === 'string' && x.trim()).slice(0, 10)
    : noteBlocks(n.text || '').filter(b => b.k === 'c' && !b.on).map(b => b.t).slice(0, 10);
  if(steps.length && !planSheet.steps.some(x => x.trim())){ planSheet.steps = steps; psRenderSteps(); }
  if(btn){ btn.disabled = false; btn.innerHTML = `${icon('sparkle')}Fill from a note`; }
  psSync();
  if(!out) showToast('info', 'Filled from the note', 'The AI didn’t answer, so the note’s own title and checklist were used.');
}
// A task's sprint: the AI suggests the steps that lead up to it (the task itself is the last step).
// Without the AI, the task's own unchecked checklist is used.
async function psFillFromTask(){
  const ps = planSheet, t = ps && ps.taskId && tasks.find(x => x.id === ps.taskId); if(!t) return;
  const btn = document.getElementById('psFillBtn');
  if(btn){ btn.disabled = true; btn.innerHTML = `${icon('sparkle')}Suggesting…`; }
  const { notes: tNotes, ck } = typeof tkSplitDesc === 'function' ? tkSplitDesc(t.description) : { notes: t.description || '', ck: [] };
  const c = clients.find(x => x.id === t.clientId);
  let out = null;
  try{
    const prompt = `Plan a short sprint of focused work for a marketing agency that ends with finishing this task. Reply with JSON only, no other text: {"goal": "...", "steps": ["...", "..."]}.
- goal: what's done when the sprint is done, one sentence under 160 characters
- steps: 3 to 6 steps in order that lead up to the task, each starting with a verb, under 60 characters. Don't include the task itself; it's the last step.

Task: ${t.title}
${c ? `Client: ${c.name}\n` : ''}${tNotes ? `Details:\n${String(tNotes).slice(0, 3000)}\n` : ''}${ck.length ? `Checklist:\n${ck.map(x => `- [${x.on ? 'x' : ' '}] ${x.t}`).join('\n')}` : ''}`;
    const r = await fetch('/api/generate-draft', { method: 'POST', headers: await apiAuthHeaders(), body: JSON.stringify({ prompt, model: settings.openaiModel }) });
    const data = await r.json();
    const mm = String(data.text || '').match(/\{[\s\S]*\}/);
    if(mm) out = JSON.parse(mm[0]);
  }catch(e){ console.error('Suggest steps failed', e); }
  if(planSheet !== ps || !document.getElementById('psTitle')) return;
  const g = id => document.getElementById(id);
  if(out && out.goal && !g('psGoal').value.trim()) g('psGoal').value = String(out.goal).slice(0, 2000);
  const steps = out && Array.isArray(out.steps) ? out.steps.filter(x => typeof x === 'string' && x.trim() && x.trim().toLowerCase() !== t.title.trim().toLowerCase()).slice(0, 10)
    : ck.filter(x => !x.on).map(x => x.t).slice(0, 10);
  if(steps.length && !ps.steps.some(x => x.trim())){ ps.steps = steps; psRenderSteps(); }
  if(btn){ btn.disabled = false; btn.innerHTML = `${icon('sparkle')}Suggest Steps`; }
  if(!out && !steps.length) showToast('info', 'No steps suggested', 'The AI didn’t answer. Add the steps yourself, or try again.');
}
async function savePlanSprint(){
  const g = id => document.getElementById(id), ps = planSheet; if(!ps) return;
  const title = (g('psTitle').value || '').trim(), start = g('psStart').value, end = g('psEnd').value;
  if(!title){ showToast('error', 'Title required', 'Give the sprint a name.'); g('psTitle').focus(); return; }
  if(!start || !end || end < start){ showToast('error', 'Check the dates', 'The sprint has to end on or after the day it starts.'); return; }
  if(!planWorkdays(start, end).length){ showToast('error', 'No workdays', 'Those dates are all weekend or holidays.'); return; }
  const clientId = g('psClient').value || null, goal = (g('psGoal').value || '').trim(), color = pickedItemColor('psColor');
  const kinds = [...document.querySelectorAll('#psRems .ck.on')].map(b => b.dataset.k);
  const old = ps.edit ? planSprint(ps.edit) : null;
  const presets = planPresetReminders(start, end).filter(r => kinds.includes(r.kind)).map(r => {
    const was = old && (old.reminders || []).find(x => x.kind === r.kind);
    return was && was.sent && was.at === r.at ? was : { ...r, sent: new Date(r.at) <= rNow() };
  });
  const custom = old ? (old.reminders || []).filter(r => !r.kind || r.kind === 'custom') : [];
  const row = { title, client_id: clientId, start_date: start, end_date: end, hours: ps.hours, goal: goal || null, color, reminders: [...presets, ...custom], updated_at: new Date().toISOString() };
  const btn = clickedBtn(); setBtnLoading(btn, ps.edit ? 'Saving…' : 'Creating…');
  let id = ps.edit;
  if(ps.edit){
    const { error } = await supabaseClient.from('plan_sprints').update(row).eq('id', ps.edit).eq('user_id', currentUser.id);
    if(error){ restoreBtn(btn); showToast('error', 'Not saved', error.message); return; }
    // its calendar event follows a new name or new dates
    const evs = old ? planSprintEvents(old) : [];
    if(evs.length && (old.title !== title || old.start !== start || old.end !== end || (old.goal || '') !== goal || (old.clientId || null) !== clientId)){
      await supabaseClient.from('calendar_events').update({ title: `Sprint: ${title}`, description: goal || null, start_at: `${start}T00:00:00`, end_at: `${end}T23:59:59`, client_id: clientId }).in('id', evs.map(e => e.id));
      if(typeof loadCalendarEvents === 'function') await loadCalendarEvents();
    }
  } else {
    const { data, error } = await supabaseClient.from('plan_sprints').insert({ ...row, user_id: currentUser.id, note_id: ps.noteId || null }).select().single();
    if(error || !data){ restoreBtn(btn); showToast('error', 'Sprint not created', error?.message || 'Try again in a moment.'); return; }
    id = data.id;
    const sp = planRowFromDb(data), steps = ps.steps.map(x => x.trim()).filter(Boolean), days = planWorkdays(start, end);
    if(ps.cnNote && typeof cnSettle === 'function') cnSettle(ps.cnNote.clientId, ps.cnNote.noteId);
    if(ps.taskId){
      const { error: e1 } = await supabaseClient.from('tasks').update({ sprint_id: id }).eq('id', ps.taskId);
      if(e1) showToast('error', 'The task wasn’t added to the sprint', e1.message);
    }
    // around a task, the new steps finish the day before the task's own last day
    const span = ps.taskId && days.length > 1 ? days.slice(0, -1) : days;
    for(let i = 0; i < steps.length; i++){
      const due = span[Math.max(0, Math.round((i + 1) * span.length / steps.length) - 1)] || end;
      const { error: e2 } = await insertTaskRow(planStepRow(sp, steps[i], due));
      if(e2){ showToast('error', 'A step wasn’t added', e2.message); break; }
    }
    if(sheetIsOn('psCal')){
      await supabaseClient.from('calendar_events').insert({ title: `Sprint: ${title}`, description: goal || null, start_at: `${start}T00:00:00`, end_at: `${end}T23:59:59`, all_day: true,
        client_id: clientId, created_by: currentUser.id, event_type: 'reminder', attendee_ids: [currentUser.id] });
      if(typeof loadCalendarEvents === 'function') await loadCalendarEvents();
    }
  }
  restoreBtn(btn);
  // a changed color carries over to the steps that still have the old one
  if(old && (old.color || null) !== (color || null)){
    const ids = planSteps(old).filter(t => (t.color || null) === (old.color || null) && t.assignerId === currentUser.id).map(t => t.id);
    if(ids.length) await supabaseClient.from('tasks').update({ color }).in('id', ids);
  }
  // and so does a changed client, so Tasks' Client filter finds the sprint under its client (Nov 25)
  if(old && (old.clientId || null) !== (clientId || null)){
    const ids = planSteps(old).filter(t => (t.clientId || null) === (old.clientId || null) && t.assignerId === currentUser.id).map(t => t.id);
    if(ids.length) await supabaseClient.from('tasks').update({ client_id: clientId }).in('id', ids);
  }
  closeAppModal(); planSheet = null;
  await Promise.all([loadPlan(), loadMyTasks()]);
  window._planSel = id;
  if(currentViewName !== 'plan') switchView('plan'); else renderPlan();
  renderTasks?.();
  showToast('success', ps.edit ? 'Sprint saved' : 'Sprint planned', ps.edit ? '' : 'Its steps are in your Tasks.');
}

// Escape closes the sprint panel.
document.addEventListener('keydown', e => {
  if(e.key !== 'Escape' || document.getElementById('appModalOverlay') || document.querySelector('.sheet-overlay, .modal-overlay')) return;
  if(typeof currentViewName !== 'undefined' && currentViewName === 'plan' && window._planSel) closePlanPanel();
});
