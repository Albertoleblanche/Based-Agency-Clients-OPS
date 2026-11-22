// Calendar, as on the canvas: a Mac week view (Day / Week / Month in the toolbar), today in a
// circle, the time now as a red line with the time in the margin, and the weekly send on the calendar.

calendarViewMode = localStorage.getItem('bda_cal_mode') || 'week';
const CAL_START = 7, CAL_END = 21, CAL_H = 64;
VIEW_TOOLBAR_ACTIONS.calendar = () => `<div class="seg" role="tablist" aria-label="View" style="margin-right:6px">${['day', 'week', 'month'].map(m => `<button class="${calendarViewMode === m ? 'on' : ''}" role="tab" aria-selected="${calendarViewMode === m}" onclick="setCalMode('${m}')">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}</div>
<div class="tb-grp"><button class="ib" aria-label="Previous" onclick="calShift(-1)">${icon('caret-left')}</button><button class="btn" style="background:transparent;height:28px;padding:0 8px" onclick="resetCalendarToToday()">Today</button><button class="ib" aria-label="Next" onclick="calShift(1)">${icon('caret-right')}</button></div>`;
function setCalMode(m){ calendarViewMode = m; try{ localStorage.setItem('bda_cal_mode', m); }catch(e){} setToolbarActions('calendar'); renderCalendar(); }
function calShift(dir){
  if(calendarViewMode === 'week') calendarAnchorDate.setDate(calendarAnchorDate.getDate() + dir * 7);
  else if(calendarViewMode === 'day') calendarAnchorDate.setDate(calendarAnchorDate.getDate() + dir);
  else calendarAnchorDate.setMonth(calendarAnchorDate.getMonth() + dir);
  renderCalendar();
}
function isoWeek(d){ const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - y0) / 86400000 + 1) / 7); }
function calColor(e){
  if(e.kind === 'due') return 'red';
  if(e.kind === 'sent') return 'green';
  if(e.isTaskMarker || e._task || e.eventType === 'task') return 'teal';   // tasks
  if(e.eventType === 'deadline') return 'red';
  if(e.eventType === 'meeting') return e.clientId ? 'blue' : 'purple';
  if(e.eventType === 'reminder') return 'yellow';                         // reminders
  return 'gray';
}
// Updates due, updates sent, tasks and all-day events sit in the row under the day names;
// the hours are for meetings and anything else with a time.
function calTopRow(e){ return !!(e.allDay || e.isTaskMarker || e.kind === 'due' || e.kind === 'sent'); }
function calTopRank(e){ return e.kind === 'due' ? 0 : e.isTaskMarker ? 2 : e.kind === 'sent' ? 3 : 1; }
// Everything shown on the calendar: events, tasks due, the days client updates are due and the days they went out.
// A task on the calendar follows the task: done there is done here (checked and crossed out).
function calTaskOf(e){ return e.relatedTaskId && typeof tasks !== 'undefined' ? tasks.find(t => String(t.id) === String(e.relatedTaskId)) || null : null; }
function calItems(from, to){
  const out = [];
  calendarEvents.filter(e => new Date(e.startAt) < to && new Date(e.endAt || e.startAt) >= from).forEach(e => {
    const t = calTaskOf(e);
    if(t && t.cancelledAt) return;                       // a cancelled task's entry isn't on the calendar
    out.push(Object.assign({}, e, t ? { _task: t, _done: t.status === 'done' } : {}));
  });
  const onCal = new Set(calendarEvents.filter(e => e.relatedTaskId).map(e => String(e.relatedTaskId)));
  getTaskCalendarMarkers().filter(t => !onCal.has(String(t.taskId))).forEach(t => { const d = new Date(t.startAt); if(d >= from && d < to) out.push(Object.assign(t, { _done: t.taskStatus === 'done' })); });
  // Client updates due, on the day each is due (anything overdue shows today).
  const today = dayStart(rNow()), dueByDay = {};
  // due updates: the clients This Week shows (not paused, and getting a weekly update)
  attentionEligibleClients().forEach(c => { const { due } = clientDue(c); const d = due < today ? today : due; if(d >= dayStart(from) && d < to){ const k = toDateStr(d); (dueByDay[k] = dueByDay[k] || []).push(c.name); } });
  Object.entries(dueByDay).forEach(([k, names]) => {
    const at = atTime(new Date(k + 'T12:00:00'), '00:00');
    out.push({ id: 'due-' + k, kind: 'due', title: `${names.length} update${names.length === 1 ? '' : 's'} due`, sub: names.join(', '), startAt: at.toISOString(), endAt: at.toISOString() });
  });
  const sentByDay = {};
  activeClients().forEach(c => sentTimes(c).forEach(t => { if(t >= from && t < to){ const k = toDateStr(t); (sentByDay[k] = sentByDay[k] || []).push([t, c.name]); } }));
  Object.entries(sentByDay).forEach(([k, ts]) => { ts.sort((a, b) => a[0] - b[0]); out.push({ id: 'sent-' + k, kind: 'sent', title: `${ts.length} update${ts.length === 1 ? '' : 's'} sent`, sub: ts.map(x => x[1]).join(', '), startAt: ts[0][0].toISOString(), endAt: ts[0][0].toISOString() }); });
  return out;
}
function calOpen(id, el){
  if(String(id).startsWith('task-')) return openTaskDetailModal(String(id).slice(5));
  if(/^(due|send|sent)-/.test(String(id))) return switchView('approve');
  openEventDetailModal(id, el || null);
}
function calGoDay(k){ calendarAnchorDate = new Date(k + 'T12:00:00'); setCalMode('day'); }
function calShortTime(d){ return fmtTime(d).replace(':00', ''); }
// Where it happens, in a word or two: "Zoom", "Google Meet", an address, or the first line of the notes.
function calPlace(e){
  const loc = String(e.location || '').trim();
  if(loc){
    if(/zoom\.us/i.test(loc)) return 'Zoom';
    if(/meet\.google/i.test(loc)) return 'Google Meet';
    if(/teams\.microsoft/i.test(loc)) return 'Teams';
    if(/^https?:\/\//i.test(loc)) return 'Online';
    return loc;
  }
  return e.sub || String(e.description || '').split('\n')[0];
}
// Events that overlap share the column: each cluster splits its width evenly, every event takes the first free lane.
function calLanes(timed){
  const minH = 22 / CAL_H * 3600000;
  timed.forEach(e => { e._s = new Date(e.startAt); e._e = new Date(Math.max(+new Date(e.endAt || +e._s + 1800000), +e._s + minH)); });
  timed.sort((a, b) => a._s - b._s || (b._e - b._s) - (a._e - a._s));
  let cluster = [], end = 0; const lanes = [];
  const flush = () => { const n = Math.max(...cluster.map(e => e._lane + 1)); cluster.forEach(e => e._n = n); cluster = []; lanes.length = 0; end = 0; };
  timed.forEach(e => {
    if(cluster.length && e._s >= end) flush();
    let i = lanes.findIndex(x => x <= e._s); if(i < 0){ i = lanes.length; lanes.push(0); }
    lanes[i] = e._e; e._lane = i; cluster.push(e); end = Math.max(end, +e._e);
  });
  if(cluster.length) flush();
  return timed;
}
function calTimedHtml(items, colW){
  return calLanes(items.filter(e => !calTopRow(e))).map(e => {
    const s = e._s, en = new Date(e.endAt || +s + 1800000);
    const top = Math.max(0, (s.getHours() + s.getMinutes() / 60 - CAL_START) * CAL_H), h = Math.max((en - s) / 3600000 * CAL_H - 2, 20);
    const w = 100 / e._n, place = calPlace(e), when = `${fmtTime(s)} – ${fmtTime(en)}`;
    // The name comes first: when it needs the room, the time line under it goes.
    const perLine = Math.max(6, Math.floor(((colW || 160) / e._n - 18) / 7)), need = Math.ceil(e.title.length / perLine);
    const room = Math.max(1, Math.floor((h - 8) / 16)), withSub = Math.max(1, Math.floor((h - 8 - 15) / 16));
    const sub = h >= 36 && (need <= withSub || room === withSub) ? `<span>${escapeHtml(calShortTime(s))}${place ? ' · ' + escapeHtml(place) : ''}</span>` : '';
    const lines = sub ? withSub : room;
    return `<button class="ev ${calColor(e)}${h < 36 ? ' short' : ''}${e._done ? ' done' : ''}" data-id="${e.id}" style="top:${top.toFixed(0)}px;height:${h.toFixed(0)}px;left:calc(${(e._lane * w).toFixed(3)}% + ${e._lane ? 1 : 3}px);width:calc(${w.toFixed(3)}% - ${e._lane ? 3 : 5}px);--l:${lines}" onclick="calOpen('${e.id}',this)" ondblclick="event.stopPropagation()" title="${escapeHtml(e.title)} · ${escapeHtml(when)}${e._done ? ' · done' : ''}"><b>${e._done ? icon('check', { weight: 'bold' }) : ''}${escapeHtml(e.title)}</b>${sub}</button>`;
  }).join('');
}
function calTopChip(e){
  const c = calColor(e), tip = escapeHtml((e.sub ? `${e.title}: ${e.sub}` : e.title) + (e._done ? ' · done' : ''));
  const lead = e.isTaskMarker || e._task ? `<span class="ad-ck" aria-hidden="true">${e._done ? icon('check', { weight: 'bold' }) : ''}</span>` : e.kind === 'sent' ? icon('check') : '';
  return `<button class="ad ${e.isTaskMarker ? 'is-task ' : ''}${c}${e.kind ? ' ' + e.kind : ''}${e._task ? ' has-task' : ''}${e._done ? ' done' : ''}" data-id="${e.id}" onclick="calOpen('${e.id}',this)" ondblclick="event.stopPropagation()" title="${tip}">${lead}<span class="t">${escapeHtml(e.title)}</span></button>`;
}
function calMonthChip(e){
  const c = calColor(e), timed = !calTopRow(e) || e.kind === 'sent';
  const tip = escapeHtml(e.sub ? `${e.title}: ${e.sub}` : e.title);
  return `<button class="mc ${e.isTaskMarker ? 'is-task ' : ''}${c}${e.kind ? ' ' + e.kind : ''}${e._done ? ' done' : ''}" data-id="${e.id}" onclick="calOpen('${e.id}',this)" ondblclick="event.stopPropagation()" title="${tip}${e._done ? ' · done' : ''}">${e._done ? `<span class="dot ck" aria-hidden="true">${icon('check', { weight: 'bold' })}</span>` : '<span class="dot" aria-hidden="true"></span>'}<span class="t">${escapeHtml(e.title)}</span>${timed && !e.kind ? `<i>${calShortTime(new Date(e.startAt))}</i>` : ''}</button>`;
}
function calSortDay(list){ return list.sort((a, b) => (a._done ? 1 : 0) - (b._done ? 1 : 0) || (calTopRow(a) ? calTopRank(a) : 1.5) - (calTopRow(b) ? calTopRank(b) : 1.5) || new Date(a.startAt) - new Date(b.startAt)); }
function renderCalendar(){
  const root = document.getElementById('calendarRoot');
  if(typeof updateCalendarNavBadge === 'function') updateCalendarNavBadge();
  if(typeof closeEventPreview === 'function') closeEventPreview(true);
  if(!root) return;
  if(typeof calendarDataLoaded !== 'undefined' && !calendarDataLoaded){ root.classList.remove('is-month'); root.innerHTML = skeletonHtml('calendar', 'Loading the calendar…'); return; }
  // the new look (beta) opens on the month the first time, with Coming up beside the grid
  const uw = typeof uiStyleOn === 'function' && uiStyleOn();
  try{ if(uw && !localStorage.getItem('bda_uw_cal')){ localStorage.setItem('bda_uw_cal', '1'); calendarViewMode = 'month'; localStorage.setItem('bda_cal_mode', 'month'); if(currentViewName === 'calendar') setToolbarActions('calendar'); } }catch(e){}
  calUpcomingRender(uw && calendarViewMode !== 'week');   // the week needs the full width
  const a = new Date(calendarAnchorDate), today = toDateStr(new Date()), now = new Date();
  root.classList.toggle('is-month', calendarViewMode === 'month');
  if(calendarViewMode === 'month'){
    const first = new Date(a.getFullYear(), a.getMonth(), 1), start = addDays(first, -((first.getDay() + 6) % 7)), end = addDays(start, 42);
    const items = calItems(start, end);
    // As many chips as fit the row; the rest is "N more", which opens that day.
    const rowH = root.clientHeight ? (root.clientHeight - 32) / 6 : 118, fit = Math.max(1, Math.floor((rowH - 34) / 21));
    const cells = Array.from({ length: 42 }, (_, i) => {
      const d = addDays(start, i), k = toDateStr(d), its = calSortDay(items.filter(e => toDateStr(new Date(e.startAt)) === k));
      const show = its.length > fit ? its.slice(0, fit - 1) : its, rest = its.length - show.length;
      const num = d.getDate() === 1 ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : d.getDate();
      return `<div class="mcell${d.getMonth() !== a.getMonth() ? ' out' : ''}${k === today ? ' today' : ''}${[0, 6].includes(d.getDay()) ? ' wknd' : ''}" ondblclick="openNewEventModal('${k}')"><button class="mday" onclick="calGoDay('${k}')" aria-label="${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}"><b>${num}</b></button>${show.map(calMonthChip).join('')}${rest ? `<button class="more" onclick="calGoDay('${k}')">${rest} more</button>` : ''}</div>`;
    }).join('');
    root.scrollTop = 0; delete root.dataset.ready;
    root.innerHTML = `<div class="mgrid">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="mhd">${d}</div>`).join('')}${cells}</div>`;
    calEmptyCard(!items.length, 'this month');
    if(currentViewName === 'calendar') setToolbar(a.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), '');
    return;
  }
  const isDay = calendarViewMode === 'day';
  const days = isDay ? [dayStart(a)] : Array.from({ length: 7 }, (_, i) => addDays(dayStart(addDays(a, -((a.getDay() + 6) % 7))), i));
  const from = days[0], to = addDays(days[days.length - 1], 1), items = calItems(from, to);
  const cols = `grid-template-columns:56px repeat(${days.length},minmax(0,1fr))`, colW = Math.max(100, ((root.clientWidth || 1160) - 56) / days.length);
  const head = '<div class="cal-hd cal-hd-g" aria-hidden="true"></div>' + days.map(d => { const k = toDateStr(d);
    return `<div class="cal-hd${k === today ? ' today' : ''}${[0, 6].includes(d.getDay()) ? ' wknd' : ''}"${isDay ? '' : ` role="button" tabindex="-1" onclick="calGoDay('${k}')" title="Open ${d.toLocaleDateString('en-US', { weekday: 'long' })}"`}>${d.toLocaleDateString('en-US', { weekday: 'short' })} <b>${d.getDate()}</b></div>`; }).join('');
  const top = days.map(d => { const k = toDateStr(d); return calSortDay(items.filter(e => calTopRow(e) && toDateStr(new Date(e.startAt)) === k)); });
  const MAXTOP = isDay ? 99 : 3;
  const allRow = top.some(x => x.length) ? '<div class="cal-all-l">all-day</div>' + top.map((list, i) => { const k = toDateStr(days[i]), show = list.length > MAXTOP ? list.slice(0, MAXTOP - 1) : list;
    return `<div class="cal-all${[0, 6].includes(days[i].getDay()) ? ' wknd' : ''}">${show.map(calTopChip).join('')}${list.length > show.length ? `<button class="ad more" onclick="calGoDay('${k}')">${list.length - show.length} more</button>` : ''}</div>`; }).join('') : '';
  const hasToday = days.some(d => toDateStr(d) === today), nowTop = (now.getHours() + now.getMinutes() / 60 - CAL_START) * CAL_H;
  const nowIn = hasToday && nowTop > 0 && nowTop < (CAL_END - CAL_START) * CAL_H;
  const gut = '<div class="cal-gut" style="height:' + (CAL_END - CAL_START) * CAL_H + 'px">' + Array.from({ length: CAL_END - CAL_START - 1 }, (_, i) => { const h = CAL_START + i + 1, y = (h - CAL_START) * CAL_H;
    return nowIn && Math.abs(y - nowTop) < 18 ? '' : `<span style="top:${y}px">${(h - 1) % 12 + 1} ${h < 12 ? 'AM' : 'PM'}</span>`; }).join('')
    + (nowIn ? `<span class="now-t" style="top:${nowTop.toFixed(0)}px">${fmtTime(now)}</span>` : '') + '</div>';
  const body = days.map(d => { const k = toDateStr(d), its = items.filter(e => toDateStr(new Date(e.startAt)) === k);
    const nowLine = k === today && nowIn ? `<div class="now" style="top:${nowTop.toFixed(0)}px" aria-label="Now"></div>` : '';
    return `<div class="cal-day${[0, 6].includes(d.getDay()) ? ' wknd' : ''}" style="height:${(CAL_END - CAL_START) * CAL_H}px" ondblclick="openNewEventModal('${k}')">${calTimedHtml(its, colW)}${nowLine}</div>`; }).join('');
  const keepScroll = root.dataset.ready ? root.scrollTop : null;
  root.innerHTML = `<div class="cal${isDay ? ' is-day' : ''}" style="${cols}">${head}${allRow}${gut}${body}</div>`;
  calEmptyCard(!items.length, isDay ? (toDateStr(from) === today ? 'today' : 'that day') : 'this week');
  // all-day items stay pinned under the day names, like Calendar on the Mac
  const hd = root.querySelector('.cal-hd');
  root.querySelectorAll('.cal-all, .cal-all-l').forEach(el => el.style.top = hd.offsetHeight + 'px');
  calScrollToMorning(root, keepScroll);
  if(currentViewName === 'calendar') setToolbar(from.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), isDay ? from.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : `Week ${isoWeek(from)}`);
}

// ---- Coming up (the new look): today and the next days, what's on each, in a card beside the grid ----
function calUpcomingRender(on){
  const view = document.getElementById('view-calendar');
  let el = document.getElementById('calUpcoming');
  if(!on){ if(el) el.remove(); return; }
  if(!view) return;
  if(!el){ el = document.createElement('aside'); el.id = 'calUpcoming'; el.className = 'cal-up'; el.setAttribute('aria-label', 'Coming up'); view.appendChild(el); }
  const t0 = dayStart(rNow()), days = 8, items = calItems(t0, addDays(t0, days));
  const when = e => {
    if(e.kind === 'due') return 'Due';
    if(e.kind === 'sent') return 'Sent';
    if(e.isTaskMarker || e._task) return 'Task';
    if(e.allDay) return 'All day';
    return fmtTime(new Date(e.startAt));
  };
  const sub = e => {
    if(e.kind === 'due' || e.kind === 'sent') return e.sub || '';
    const c = e.clientId && typeof clients !== 'undefined' ? clients.find(x => String(x.id) === String(e.clientId)) : null;
    if(!e.allDay && !calTopRow(e) && e.endAt) return `Until ${fmtTime(new Date(e.endAt))}${c ? ' · ' + c.name : ''}`;
    return c ? c.name : calPlace(e) || '';
  };
  let shown = 0;
  const groups = Array.from({ length: days }, (_, i) => {
    const d = addDays(t0, i), k = toDateStr(d), list = calSortDay(items.filter(e => toDateStr(new Date(e.startAt)) === k));
    if(!list.length && i > 0) return '';
    const name = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'long' });
    const rows = list.slice(0, Math.max(0, 12 - shown)); shown += rows.length;
    if(i > 0 && !rows.length) return '';
    return `<div class="cu-d"><span>${name}</span><span>${list.length ? `${list.length} ${list.length === 1 ? 'thing' : 'things'}` : 'Nothing yet'}</span></div>`
      + rows.map(e => `<button class="cu-r${e._done ? ' done' : ''} ${calColor(e)}" onclick="calOpen('${e.id}',this)"><span class="cu-t">${escapeHtml(when(e))}</span><span class="cu-x"><b>${escapeHtml(e.title)}</b>${sub(e) ? `<span>${escapeHtml(sub(e))}</span>` : ''}</span></button>`).join('');
  }).join('');
  el.innerHTML = `<div class="cu-h"><span class="cu-ic">${icon('calendar-blank')}</span><b>Coming up</b><span class="cu-n">Next ${days - 1} days</span></div><div class="cu-l">${groups}</div>`;
}

// Open on the working day (8 AM at the top). The view is hidden when it first renders,
// so wait until it has a size.
function calScrollToMorning(root, keep){
  if(keep != null) return void (root.scrollTop = keep);
  const go = () => { root.scrollTop = (8 - CAL_START) * CAL_H - 10; root.dataset.ready = '1'; };
  if(root.clientHeight) return go();
  if(!root._ro && window.ResizeObserver){ root._ro = new ResizeObserver(() => { if(root.clientHeight && !root.dataset.ready) go(); }); root._ro.observe(root); }
}
// "Synced with Google Calendar" at the end of the legend, as on the canvas.
async function renderCalendarGoogleSyncWidget(){
  const el = document.getElementById('calGoogleSyncStatus');
  if(!el) return;
  const data = await fetchGoogleCalendarStatus();
  window._gcalStatus = data || null;
  if(!data || !data.googleConfigured || !data.connected){ el.style.display = 'none'; el.innerHTML = ''; return; }
  const last = data.lastSyncedAt ? new Date(data.lastSyncedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'not yet';
  el.style.display = '';
  el.innerHTML = `<button class="st cal-sync" onclick="syncGoogleCalendarFromTab()" title="Last synced ${last} · click to sync now">${icon('google-logo')}Synced with Google Calendar</button>`;
}

// Nothing in the range shown: a small card over the grid with the way to add something.
function calEmptyCard(show, when){
  const view = document.getElementById('view-calendar');
  let el = document.getElementById('calEmpty');
  if(!show){ if(el) el.remove(); return; }
  if(!view) return;
  if(!el){ el = document.createElement('div'); el.id = 'calEmpty'; el.className = 'cal-es'; view.appendChild(el); }
  const g = window._gcalStatus, connect = g && g.googleConfigured && !g.connected;
  el.innerHTML = emptyState({ compact: true, icon: 'calendar-blank', title: `Nothing on your calendar ${when}`,
    text: connect ? 'Add a meeting or deadline, or connect Google Calendar to see your meetings here.' : 'Meetings, deadlines and tasks with a due date show here. Double-click a day to add one.',
    action: 'New Event', actionIcon: 'plus', onAction: 'openNewEventModal()', link: connect ? 'Connect Google Calendar' : '', onLink: 'connectGoogleCalendar()' });
}
