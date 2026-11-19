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
  if(e.isTaskMarker) return 'gray';
  if(e.eventType === 'deadline') return 'red';
  if(e.eventType === 'meeting') return e.clientId ? 'blue' : 'purple';
  return 'gray';
}
// Updates due, updates sent, tasks and all-day events sit in the row under the day names;
// the hours are for meetings and anything else with a time.
function calTopRow(e){ return !!(e.allDay || e.isTaskMarker || e.kind === 'due' || e.kind === 'sent'); }
function calTopRank(e){ return e.kind === 'due' ? 0 : e.isTaskMarker ? 2 : e.kind === 'sent' ? 3 : 1; }
// Everything shown on the calendar: events, tasks due, the days client updates are due and the days they went out.
function calItems(from, to){
  const out = calendarEvents.filter(e => new Date(e.startAt) < to && new Date(e.endAt || e.startAt) >= from).map(e => Object.assign({}, e));
  getTaskCalendarMarkers().filter(t => t.taskStatus !== 'done').forEach(t => { const d = new Date(t.startAt); if(d >= from && d < to) out.push(t); });
  // Client updates due, on the day each is due (anything overdue shows today).
  const today = dayStart(rNow()), dueByDay = {};
  activeClients().forEach(c => { const { due } = clientDue(c); const d = due < today ? today : due; if(d >= dayStart(from) && d < to){ const k = toDateStr(d); (dueByDay[k] = dueByDay[k] || []).push(c.name); } });
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
    return `<button class="ev ${calColor(e)}${h < 36 ? ' short' : ''}" data-id="${e.id}" style="top:${top.toFixed(0)}px;height:${h.toFixed(0)}px;left:calc(${(e._lane * w).toFixed(3)}% + ${e._lane ? 1 : 3}px);width:calc(${w.toFixed(3)}% - ${e._lane ? 3 : 5}px);--l:${lines}" onclick="calOpen('${e.id}',this)" ondblclick="event.stopPropagation()" title="${escapeHtml(e.title)} · ${escapeHtml(when)}"><b>${escapeHtml(e.title)}</b>${sub}</button>`;
  }).join('');
}
function calTopChip(e){
  const c = calColor(e), tip = escapeHtml(e.sub ? `${e.title}: ${e.sub}` : e.title);
  const lead = e.isTaskMarker ? '<span class="ad-ck" aria-hidden="true"></span>' : e.kind === 'sent' ? icon('check') : '';
  return `<button class="ad ${e.isTaskMarker ? 'is-task' : c}${e.kind ? ' ' + e.kind : ''}" data-id="${e.id}" onclick="calOpen('${e.id}',this)" ondblclick="event.stopPropagation()" title="${tip}">${lead}<span class="t">${escapeHtml(e.title)}</span></button>`;
}
function calMonthChip(e){
  const c = calColor(e), timed = !calTopRow(e) || e.kind === 'sent';
  const tip = escapeHtml(e.sub ? `${e.title}: ${e.sub}` : e.title);
  return `<button class="mc ${e.isTaskMarker ? 'is-task' : c}${e.kind ? ' ' + e.kind : ''}" data-id="${e.id}" onclick="calOpen('${e.id}',this)" ondblclick="event.stopPropagation()" title="${tip}"><span class="dot" aria-hidden="true"></span><span class="t">${escapeHtml(e.title)}</span>${timed && !e.kind ? `<i>${calShortTime(new Date(e.startAt))}</i>` : ''}</button>`;
}
function calSortDay(list){ return list.sort((a, b) => (calTopRow(a) ? calTopRank(a) : 1.5) - (calTopRow(b) ? calTopRank(b) : 1.5) || new Date(a.startAt) - new Date(b.startAt)); }
function renderCalendar(){
  const root = document.getElementById('calendarRoot');
  if(typeof updateCalendarNavBadge === 'function') updateCalendarNavBadge();
  if(typeof closeEventPreview === 'function') closeEventPreview(true);
  if(!root) return;
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
