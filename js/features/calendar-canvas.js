// Calendar, as on the canvas: a Mac week view (Day / Week / Month in the toolbar), today in a
// circle, the time now as a red line, and the weekly send on the calendar.

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
// Everything shown on the calendar: events, tasks due, the weekly send and the days updates went out.
function calItems(from, to){
  const out = calendarEvents.filter(e => new Date(e.startAt) < to && new Date(e.endAt || e.startAt) >= from).map(e => Object.assign({}, e));
  getTaskCalendarMarkers().filter(t => t.taskStatus !== 'done').forEach(t => { const d = new Date(t.startAt); if(d >= from && d < to) out.push(t); });
  // The weekly deadline (approve by) in red, and the send itself in green.
  const seen = new Set();
  for(let d = addDays(from, -7); d < addDays(to, 7); d = addDays(d, 1)){
    const cyc = updateCycle(d), key = cyc.send.toISOString();
    if(seen.has(key)) continue; seen.add(key);
    const due = cyc.checkpoints.approve;
    if(due >= from && due < to) out.push({ id: 'due-' + key, kind: 'due', title: 'Weekly updates due', startAt: due.toISOString(), endAt: new Date(+due + 30 * 60000).toISOString() });
    if(cyc.send >= from && cyc.send < to && cyc.send > rNow()){
      const n = activeClients().length;
      out.push({ id: 'send-' + key, kind: 'sent', title: 'Send approved updates', sub: `${n} client${n === 1 ? '' : 's'}`, startAt: key, endAt: new Date(+cyc.send + 60 * 60000).toISOString() });
    }
  }
  const sentByDay = {};
  activeClients().forEach(c => sentTimes(c).forEach(t => { if(t >= from && t < to){ const k = toDateStr(t); (sentByDay[k] = sentByDay[k] || []).push(t); } }));
  Object.entries(sentByDay).forEach(([k, ts]) => { const first = ts.sort((a, b) => a - b)[0]; out.push({ id: 'sent-' + k, kind: 'sent', title: 'Updates sent', sub: `${ts.length} client${ts.length === 1 ? '' : 's'}`, startAt: first.toISOString(), endAt: new Date(+first + 45 * 60000).toISOString() }); });
  return out;
}
function calOpen(id){
  if(String(id).startsWith('task-')) return openTaskDetailModal(String(id).slice(5));
  if(/^(due|send|sent)-/.test(String(id))) return switchView('approve');
  openEventDetailModal(id);
}
function calTimedHtml(items, day){
  const timed = items.filter(e => !e.allDay && !e.isTaskMarker).sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
  // side-by-side columns for overlapping events
  const lanes = []; timed.forEach(e => { const s = new Date(e.startAt); let i = lanes.findIndex(end => end <= s); if(i < 0){ i = lanes.length; lanes.push(0); } lanes[i] = new Date(e.endAt || +s + 1800000); e._lane = i; });
  return timed.map(e => {
    const s = new Date(e.startAt), en = new Date(e.endAt || +s + 1800000);
    const top = Math.max(0, (s.getHours() + s.getMinutes() / 60 - CAL_START) * CAL_H), h = Math.max((en - s) / 3600000 * CAL_H - 3, 22);
    const over = timed.filter(o => o !== e && new Date(o.startAt) < en && new Date(o.endAt || o.startAt) > s);
    const n = over.length ? Math.max(...over.map(o => o._lane), e._lane) + 1 : 1, w = 100 / n;
    const sub = e.sub || (e.description || '').split('\n')[0];
    return `<button class="ev ${calColor(e)}" style="top:${top.toFixed(0)}px;height:${h.toFixed(0)}px;left:calc(${(e._lane * w).toFixed(2)}% + 4px);width:calc(${w.toFixed(2)}% - 8px)" onclick="calOpen('${e.id}')" title="${escapeHtml(e.title)}"><b>${escapeHtml(e.title)}</b>${sub && h > 34 ? `<span>${escapeHtml(sub)}</span>` : ''}</button>`;
  }).join('');
}
function renderCalendar(){
  const root = document.getElementById('calendarRoot');
  if(typeof updateCalendarNavBadge === 'function') updateCalendarNavBadge();
  if(!root) return;
  const a = new Date(calendarAnchorDate), today = toDateStr(new Date()), now = new Date();
  if(calendarViewMode === 'month'){
    const first = new Date(a.getFullYear(), a.getMonth(), 1), start = addDays(first, -((first.getDay() + 6) % 7)), end = addDays(start, 42);
    const items = calItems(start, end);
    const cells = Array.from({ length: 42 }, (_, i) => { const d = addDays(start, i), k = toDateStr(d), its = items.filter(e => toDateStr(new Date(e.startAt)) === k).sort((x, y) => new Date(x.startAt) - new Date(y.startAt));
      return `<div class="mcell${d.getMonth() !== a.getMonth() ? ' out' : ''}${k === today ? ' today' : ''}" ondblclick="openNewEventModal('${k}')"><span class="mday"><b>${d.getDate()}</b></span>${its.slice(0, 4).map(e => `<button class="mchip ${calColor(e)}" onclick="calOpen('${e.id}')"><span class="dot ${calColor(e) === 'gray' ? '' : calColor(e)}"></span>${e.allDay || e.isTaskMarker ? '' : `<i>${fmtTime(new Date(e.startAt)).replace(':00', '')}</i>`}${escapeHtml(e.title)}</button>`).join('')}${its.length > 4 ? `<span class="more">${its.length - 4} more</span>` : ''}</div>`; }).join('');
    root.scrollTop = 0; delete root.dataset.ready;
    root.innerHTML = `<div class="mgrid">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="mhd">${d}</div>`).join('')}${cells}</div>`;
    if(currentViewName === 'calendar') setToolbar(a.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), '');
    return;
  }
  const days = calendarViewMode === 'day' ? [dayStart(a)] : Array.from({ length: 7 }, (_, i) => addDays(dayStart(addDays(a, -((a.getDay() + 6) % 7))), i));
  const from = days[0], to = addDays(days[days.length - 1], 1), items = calItems(from, to);
  const cols = `grid-template-columns:56px repeat(${days.length},minmax(0,1fr))`;
  const head = '<div class="cal-hd" aria-hidden="true"></div>' + days.map(d => `<div class="cal-hd${toDateStr(d) === today ? ' today' : ''}${[0, 6].includes(d.getDay()) ? ' wknd' : ''}">${d.toLocaleDateString('en-US', { weekday: 'short' })} <b>${d.getDate()}</b></div>`).join('');
  const allDay = days.map(d => { const k = toDateStr(d); return items.filter(e => (e.allDay || e.isTaskMarker) && toDateStr(new Date(e.startAt)) === k); });
  const allRow = allDay.some(x => x.length) ? '<div class="cal-all-l">all-day</div>' + allDay.map(list => `<div class="cal-all">${list.map(e => `<button class="mchip ${calColor(e)}" onclick="calOpen('${e.id}')">${escapeHtml(e.title)}</button>`).join('')}</div>`).join('') : '';
  const gut = '<div class="cal-gut" style="height:' + (CAL_END - CAL_START) * CAL_H + 'px">' + Array.from({ length: CAL_END - CAL_START - 1 }, (_, i) => { const h = CAL_START + i + 1; return `<span style="top:${(h - CAL_START) * CAL_H}px">${(h - 1) % 12 + 1} ${h < 12 ? 'AM' : 'PM'}</span>`; }).join('') + '</div>';
  const body = days.map(d => { const k = toDateStr(d), its = items.filter(e => toDateStr(new Date(e.startAt)) === k);
    const nowLine = k === today ? `<div class="now" style="top:${((now.getHours() + now.getMinutes() / 60 - CAL_START) * CAL_H).toFixed(0)}px" aria-label="Now"></div>` : '';
    return `<div class="cal-day${[0, 6].includes(d.getDay()) ? ' wknd' : ''}" style="height:${(CAL_END - CAL_START) * CAL_H}px" ondblclick="openNewEventModal('${k}')">${nowLine}${calTimedHtml(its, d)}</div>`; }).join('');
  const keepScroll = root.dataset.ready ? root.scrollTop : null;
  root.innerHTML = `<div class="cal" style="${cols}">${head}${allRow}${gut}${body}</div>`;
  // all-day tasks stay pinned under the day names, like Calendar on the Mac
  const hd = root.querySelector('.cal-hd');
  root.querySelectorAll('.cal-all, .cal-all-l').forEach(el => el.style.top = hd.offsetHeight + 'px');
  calScrollToMorning(root, keepScroll);
  if(currentViewName === 'calendar') setToolbar(from.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), calendarViewMode === 'day' ? from.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : `Week ${isoWeek(from)}`);
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
const GOOGLE_LOGO = '<svg viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round" aria-hidden="true"><path d="M224,128a96,96,0,1,1-21.95-61.09,8,8,0,1,1-12.33,10.18A80,80,0,1,0,207.6,136H128a8,8,0,0,1,0-16h88A8,8,0,0,1,224,128Z"/></svg>';
async function renderCalendarGoogleSyncWidget(){
  const el = document.getElementById('calGoogleSyncStatus');
  if(!el) return;
  const data = await fetchGoogleCalendarStatus();
  if(!data || !data.googleConfigured || !data.connected){ el.style.display = 'none'; el.innerHTML = ''; return; }
  const last = data.lastSyncedAt ? new Date(data.lastSyncedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'not yet';
  el.style.display = '';
  el.innerHTML = `<button class="st cal-sync" onclick="syncGoogleCalendarFromTab()" title="Last synced ${last} · click to sync now">${GOOGLE_LOGO}Synced with Google Calendar</button>`;
}
