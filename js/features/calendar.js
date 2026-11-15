// Team calendar: month/week views, events, RSVPs, recurring events.

/* ---------- Calendar — shared team calendar, with room for Google Calendar
   sync alongside manually-created events. ---------- */

let calendarEvents = [];
let calendarDataLoaded = false;
let calendarAnchorDate = new Date();

const CALENDAR_TYPE_META = {
  meeting:  { label:'Meeting',  color:'#3A63C9', icon:'🗓️' },
  deadline: { label:'Deadline', color:'#CF2424', icon:'⏱️' },
  reminder: { label:'Reminder', color:'#A65B05', icon:'🔔' },
  other:    { label:'Other',    color:'#696F78', icon:'●' },
};

// Standard options, matching Google Calendar's own — value is a string of
// minutes-before ('' = no reminder), kept as strings throughout since HTML
// select values are always strings and every place this gets read
// (the form, save logic, display) compares against that same string form.
const REMINDER_OPTIONS = [
  ['', 'No reminder'],
  ['0', 'At time of event'],
  ['5', '5 minutes before'],
  ['10', '10 minutes before'],
  ['15', '15 minutes before'],
  ['30', '30 minutes before'],
  ['60', '1 hour before'],
  ['1440', '1 day before'],
];

function reminderLabel(minutes){
  if(minutes===null || minutes===undefined) return null;
  const found = REMINDER_OPTIONS.find(([val])=>val===String(minutes));
  if(found) return found[1];
  // Google-synced events can carry values our fixed dropdown doesn't
  // include (e.g. 45 minutes) — fall back to a generic label rather than
  // silently showing nothing for a reminder that genuinely exists.
  return minutes < 60 ? `${minutes} minutes before` : minutes < 1440 ? `${Math.round(minutes/60)} hour${Math.round(minutes/60)!==1?'s':''} before` : `${Math.round(minutes/1440)} day${Math.round(minutes/1440)!==1?'s':''} before`;
}

async function loadCalendarEvents(){
  const { data, error } = await supabaseClient.from('calendar_events').select('*').order('start_at', { ascending:true });
  if(error){ console.error('loadCalendarEvents error', error); calendarEvents = []; calendarDataLoaded = true; return; }
  calendarEvents = (data||[]).map(e=>({
    id:e.id, title:e.title, description:e.description||'', startAt:e.start_at, endAt:e.end_at,
    allDay:e.all_day, clientId:e.client_id, createdBy:e.created_by, eventType:e.event_type,
    googleEventId:e.google_event_id, googleOwner:e.google_calendar_owner,
    location:e.location||'', attendeeIds:e.attendee_ids||[],
    rsvps:e.rsvps||{}, recurrenceGroupId:e.recurrence_group_id, recurrenceLabel:e.recurrence_label,
    relatedTaskId:e.related_task_id, reminderMinutes:e.reminder_minutes
  }));
  calendarDataLoaded = true;
  updateCalendarNavBadge();
}

function updateCalendarNavBadge(){
  const badge = document.getElementById('navCalendarBadge');
  if(!badge) return;
  const weekStart = getWeekStart(new Date());
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate()+7);
  const count = calendarEvents.filter(e=>{
    const start = new Date(e.startAt);
    return start >= weekStart && start < weekEnd;
  }).length;
  badge.textContent = count > 99 ? '99+' : count;
  badge.style.display = count ? 'inline-flex' : 'none';
}

let calendarViewMode = 'month'; // 'month' | 'week'
let calendarTypeTab = 'all'; // 'all' | 'meeting' | 'deadline' | 'reminder' | 'other' | 'conflicted'

function switchCalendarViewMode(mode){
  calendarViewMode = mode;
  document.querySelectorAll('#view-calendar .view-toggle-option').forEach(t=>t.classList.toggle('active', t.dataset.cview===mode));
  renderCalendar();
}

function shiftCalendarPeriod(dir){
  if(calendarViewMode==='week') calendarAnchorDate.setDate(calendarAnchorDate.getDate() + dir*7);
  else calendarAnchorDate.setMonth(calendarAnchorDate.getMonth()+dir);
  renderCalendar();
}

function resetCalendarToToday(){
  calendarAnchorDate = new Date();
  renderCalendar();
}

function jumpToCalendarDate(dateStr){
  if(!dateStr) return;
  calendarAnchorDate = new Date(dateStr+'T00:00:00');
  renderCalendar();
}

function renderCalendarMonthLabel(){
  const el = document.getElementById('calendarMonthLabel');
  if(!el) return;
  if(calendarViewMode==='week'){
    const start = getWeekStart(calendarAnchorDate);
    const end = new Date(start); end.setDate(end.getDate()+6);
    el.textContent = start.getMonth()===end.getMonth()
      ? `${start.toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${end.toLocaleDateString('en-US',{day:'numeric', year:'numeric'})}`
      : `${start.toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${end.toLocaleDateString('en-US',{month:'short',day:'numeric', year:'numeric'})}`;
  } else {
    el.textContent = calendarAnchorDate.toLocaleDateString('en-US',{month:'long', year:'numeric'});
  }
}

function renderCalendarTodaySummary(){
  const el = document.getElementById('calendarTodaySummary');
  if(!el) return;
  const todayStr = toDateStr(new Date());
  const todayEvents = calendarEvents.filter(e=> toDateStr(new Date(e.startAt))===todayStr);
  const dateLabel = new Date().toLocaleDateString('en-US',{weekday:'long', month:'long', day:'numeric'});
  if(!todayEvents.length){ el.textContent = `${dateLabel} — nothing on the calendar today.`; return; }
  const meetings = todayEvents.filter(e=>e.eventType==='meeting').length;
  const others = todayEvents.length - meetings;
  const parts = [];
  if(meetings) parts.push(`${meetings} meeting${meetings!==1?'s':''}`);
  if(others) parts.push(`${others} other event${others!==1?'s':''}`);
  el.textContent = `${dateLabel} — you have ${parts.join(' and ')} today.`;
}

function attendeeAvatarsHtml(attendeeIds, max){
  if(!attendeeIds || !attendeeIds.length) return '';
  const shown = attendeeIds.slice(0, max||4);
  const extra = attendeeIds.length - shown.length;
  const avatarsHtml = shown.map(id=>{
    const p = teamProfiles.find(x=>x.id===id);
    if(!p) return '';
    return p.avatar_url
      ? `<img class="attendee-avatar" src="${safeUrl(p.avatar_url)}" title="${escapeHtml(p.name)}">`
      : `<div class="attendee-avatar-fallback" title="${escapeHtml(p.name)}">${escapeHtml((p.name||'?').trim().charAt(0).toUpperCase())}</div>`;
  }).join('');
  return `<div class="attendee-avatars">${avatarsHtml}${extra>0?`<span class="attendee-more-chip">+${extra}</span>`:''}</div>`;
}

function renderCalendar(){
  const container = document.getElementById('calendarViewContainer');
  if(!container) return;
  if(!calendarDataLoaded){ container.innerHTML = loadingStateHtml('Loading calendar…'); return; }
  renderCalendarMonthLabel();
  renderCalendarTodaySummary();
  renderCalendarTypeTabs();
  renderCalendarCardsRow();
  if(calendarViewMode==='week') renderCalendarWeekView(container);
  else renderCalendarMonthView(container);
}

function getCalendarPeriodRange(){
  if(calendarViewMode==='week'){
    const start = getWeekStart(calendarAnchorDate);
    const end = new Date(start); end.setDate(end.getDate()+7);
    return { start, end };
  }
  const year = calendarAnchorDate.getFullYear(), month = calendarAnchorDate.getMonth();
  return { start: new Date(year, month, 1), end: new Date(year, month+1, 1) };
}

const CALENDAR_TYPE_TABS = [
  { key:'all', label:'All Scheduled', icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>' },
  { key:'meeting', label:'Meetings', icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>' },
  { key:'deadline', label:'Deadlines', icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' },
  { key:'reminder', label:'Reminders', icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>' },
  { key:'other', label:'Other', icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>' },
  { key:'conflicted', label:'Conflicted', icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' },
];

function switchCalendarTypeTab(tab){
  calendarTypeTab = tab;
  renderCalendar();
}

function renderCalendarTypeTabs(){
  const el = document.getElementById('calTypeTabs');
  if(!el) return;
  const { start, end } = getCalendarPeriodRange();
  const periodEvents = calendarEvents.filter(e=>{
    const s = new Date(e.startAt);
    return s >= start && s < end;
  });
  el.innerHTML = CALENDAR_TYPE_TABS.map(t=>{
    const count = t.key==='all' ? periodEvents.length : periodEvents.filter(e=>eventMatchesTypeTab(e, t.key)).length;
    return `<div class="icon-tab ${calendarTypeTab===t.key?'active':''}" onclick="switchCalendarTypeTab('${t.key}')">
      ${t.icon}<span>${escapeHtml(t.label)}</span><span class="icon-tab-count">${count}</span>
    </div>`;
  }).join('');
}

function renderCalendarCardsRow(){
  const el = document.getElementById('calCardsRow');
  if(!el) return;
  const { start, end } = getCalendarPeriodRange();
  const matching = calendarEvents
    .filter(e=>{
      const s = new Date(e.startAt);
      return s >= start && s < end && eventMatchesTypeTab(e, calendarTypeTab);
    })
    .sort((a,b)=> new Date(a.startAt)-new Date(b.startAt))
    .slice(0, 20);

  if(!matching.length){ el.innerHTML = `<div class="empty" style="padding:14px 4px;">No events here.</div>`; return; }

  const todayStr = toDateStr(new Date());
  el.innerHTML = matching.map(e=>{
    const meta = CALENDAR_TYPE_META[e.eventType] || CALENDAR_TYPE_META.other;
    const isToday = toDateStr(new Date(e.startAt))===todayStr;
    const effectiveAttendees = e.attendeeIds && e.attendeeIds.length ? e.attendeeIds : [e.createdBy];
    const hasConflict = !e.allDay && findEventConflicts(e.startAt, e.endAt, effectiveAttendees, e.id).length > 0;
    const timeStr = e.allDay
      ? new Date(e.startAt).toLocaleDateString('en-US',{month:'short',day:'numeric'})
      : `${new Date(e.startAt).toLocaleDateString('en-US',{month:'short',day:'numeric'})} · ${new Date(e.startAt).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})} – ${new Date(e.endAt).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}`;
    const statusHtml = hasConflict
      ? `<span style="color:var(--red);">⚠ Conflicted</span>`
      : isToday
        ? `<span style="color:var(--green);">● Today</span>`
        : `<span style="color:var(--muted-lt);">${escapeHtml(meta.label)}</span>`;

    return `<div class="cal-event-card" style="border-left:3px solid ${meta.color};" onclick="openEventDetailModal('${e.id}')">
      <div class="cal-event-card-title">${e.googleEventId?'📅 ':''}${escapeHtml(e.title)}</div>
      <div class="cal-event-card-time">${timeStr}</div>
      ${attendeeAvatarsHtml(e.attendeeIds, 3)}
      <div class="cal-event-card-status">${statusHtml}</div>
    </div>`;
  }).join('');
}

// Shared by both views (and the card row) — "conflicted" isn't a real
// event_type, it's computed by checking each event against every other
// event sharing an attendee, so it needs its own branch rather than a
// simple field match.
function eventMatchesTypeTab(e, tab){
  if(tab==='all') return true;
  if(tab==='conflicted'){
    if(e.allDay) return false;
    const effectiveAttendees = e.attendeeIds && e.attendeeIds.length ? e.attendeeIds : [e.createdBy];
    return findEventConflicts(e.startAt, e.endAt, effectiveAttendees, e.id).length > 0;
  }
  return e.eventType===tab;
}

// Tasks with a due date show up on the calendar as lightweight markers —
// this doesn't create real calendar_events rows, it's just merged into the
// rendering. Cancelled tasks never show; done tasks with no due date have
// nothing to plot anyway.
function getTaskCalendarMarkers(){
  return tasks.filter(t=> t.dueDate && !t.cancelledAt).map(t=>({
    id:'task-'+t.id, taskId:t.id, title:t.title,
    startAt:`${t.dueDate}T00:00:00`, endAt:`${t.dueDate}T23:59:59`,
    allDay:true, eventType:'task', isTaskMarker:true, taskStatus:t.status
  }));
}

function renderCalendarMonthView(container){
  const year = calendarAnchorDate.getFullYear(), month = calendarAnchorDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = getWeekStart(firstOfMonth); // Monday-aligned
  const todayStr = toDateStr(new Date());

  const eventsByDay = {};
  [...calendarEvents.filter(e=>eventMatchesTypeTab(e, calendarTypeTab)), ...getTaskCalendarMarkers()].forEach(e=>{
    const d = toDateStr(new Date(e.startAt));
    if(!eventsByDay[d]) eventsByDay[d] = [];
    eventsByDay[d].push(e);
  });

  let daysHtml = '';
  for(let i=0;i<42;i++){
    const cellDate = new Date(gridStart);
    cellDate.setDate(cellDate.getDate()+i);
    const cellStr = toDateStr(cellDate);
    const isOtherMonth = cellDate.getMonth()!==month;
    const isToday = cellStr===todayStr;
    const dayEvents = (eventsByDay[cellStr]||[]).sort((a,b)=> new Date(a.startAt)-new Date(b.startAt));
    const shown = dayEvents.slice(0,3);
    const extra = dayEvents.length - shown.length;

    daysHtml += `<div class="calendar-day ${isOtherMonth?'other-month':''} ${isToday?'today':''}" onclick="openNewEventModal('${cellStr}')">
      <div class="calendar-day-num">${cellDate.getDate()}</div>
      ${shown.map(e=>{
        if(e.isTaskMarker){
          const pMeta = TASK_PRIORITY_META[tasks.find(t=>t.id===e.taskId)?.priority] || TASK_PRIORITY_META.medium;
          const done = e.taskStatus==='done';
          return `<div class="calendar-event-pill" style="background:${pMeta.color}18;color:${pMeta.color};${done?'text-decoration:line-through;opacity:.7;':''}" onclick="event.stopPropagation();openTaskDetailModal('${e.taskId}')" title="${escapeHtml(e.title)}">${done?'☑':'☐'} ${escapeHtml(e.title)}</div>`;
        }
        const meta = CALENDAR_TYPE_META[e.eventType] || CALENDAR_TYPE_META.other;
        const timeStr = e.allDay ? '' : new Date(e.startAt).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})+' ';
        return `<div class="calendar-event-pill" style="background:${meta.color}18;color:${meta.color};" onclick="event.stopPropagation();openEventDetailModal('${e.id}')" title="${escapeHtml(e.title)}">${e.googleEventId?'📅 ':''}${timeStr}${escapeHtml(e.title)}</div>`;
      }).join('')}
      ${extra>0 ? `<div class="calendar-more-pill">+${extra} more</div>` : ''}
    </div>`;
  }

  container.innerHTML = `
    <div class="table-scroll-wrap">
    <div class="calendar-month-inner">
    <div class="calendar-grid-head">
      <div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div><div>Sun</div>
    </div>
    <div class="calendar-grid">${daysHtml}</div>
    </div>
    </div>`;
}

const WEEK_VIEW_START_HOUR = 7;
const WEEK_VIEW_END_HOUR = 21;
const WEEK_VIEW_HOUR_HEIGHT = 52;

function renderCalendarWeekView(container){
  const weekStart = getWeekStart(calendarAnchorDate);
  const todayStr = toDateStr(new Date());
  const totalHours = WEEK_VIEW_END_HOUR - WEEK_VIEW_START_HOUR;
  const gridHeight = totalHours * WEEK_VIEW_HOUR_HEIGHT;

  const days = Array.from({length:7}, (_,i)=>{ const d = new Date(weekStart); d.setDate(d.getDate()+i); return d; });

  const headHtml = `<div></div>` + days.map(d=>{
    const isToday = toDateStr(d)===todayStr;
    return `<div class="week-day-label ${isToday?'today':''}">${d.toLocaleDateString('en-US',{weekday:'short'})} ${d.getDate()}</div>`;
  }).join('');

  const hourLines = Array.from({length: totalHours}, (_,i)=>`<div class="week-hour-line" style="top:${i*WEEK_VIEW_HOUR_HEIGHT}px;"></div>`).join('');

  const hourLabelsHtml = `<div class="week-hour-col" style="height:${gridHeight}px;">` +
    Array.from({length: totalHours}, (_,i)=>{
      const hour = WEEK_VIEW_START_HOUR + i;
      const label = hour<12?`${hour} AM`:hour===12?'12 PM':`${hour-12} PM`;
      return `<div class="week-hour-label" style="top:${i*WEEK_VIEW_HOUR_HEIGHT}px;">${escapeHtml(label)}</div>`;
    }).join('') + hourLines + `</div>`;

  const allDayByDay = {};
  [...calendarEvents.filter(e=>eventMatchesTypeTab(e, calendarTypeTab) && e.allDay), ...getTaskCalendarMarkers()].forEach(e=>{
    const d = toDateStr(new Date(e.startAt));
    if(!allDayByDay[d]) allDayByDay[d] = [];
    allDayByDay[d].push(e);
  });
  const allDayPillHtml = (e)=>{
    if(e.isTaskMarker){
      const pMeta = TASK_PRIORITY_META[tasks.find(t=>t.id===e.taskId)?.priority] || TASK_PRIORITY_META.medium;
      const done = e.taskStatus==='done';
      return `<div class="calendar-event-pill" style="background:${pMeta.color}18;color:${pMeta.color};${done?'text-decoration:line-through;opacity:.7;':''}" onclick="event.stopPropagation();openTaskDetailModal('${e.taskId}')" title="${escapeHtml(e.title)}">${done?'☑':'☐'} ${escapeHtml(e.title)}</div>`;
    }
    const meta = CALENDAR_TYPE_META[e.eventType] || CALENDAR_TYPE_META.other;
    return `<div class="calendar-event-pill" style="background:${meta.color}18;color:${meta.color};" onclick="event.stopPropagation();openEventDetailModal('${e.id}')" title="${escapeHtml(e.title)}">${e.googleEventId?'📅 ':''}${escapeHtml(e.title)}</div>`;
  };
  const allDayRowHtml = `<div class="week-allday-label">All-day</div>` + days.map(d=>{
    const items = allDayByDay[toDateStr(d)] || [];
    return `<div class="week-allday-cell">${items.map(allDayPillHtml).join('')}</div>`;
  }).join('');

  const dayColsHtml = days.map(d=>{
    const dStr = toDateStr(d);
    const dayEvents = calendarEvents.filter(e=>{
      if(!eventMatchesTypeTab(e, calendarTypeTab)) return false;
      if(e.allDay) return false;
      return toDateStr(new Date(e.startAt))===dStr;
    });

    const eventsHtml = dayEvents.map(e=>{
      const meta = CALENDAR_TYPE_META[e.eventType] || CALENDAR_TYPE_META.other;
      const start = new Date(e.startAt), end = new Date(e.endAt);
      const startHourFloat = start.getHours() + start.getMinutes()/60;
      const endHourFloat = end.getHours() + end.getMinutes()/60;
      const clampedStart = Math.max(startHourFloat, WEEK_VIEW_START_HOUR);
      const clampedEnd = Math.min(endHourFloat, WEEK_VIEW_END_HOUR);
      if(clampedEnd <= clampedStart) return '';
      const top = (clampedStart - WEEK_VIEW_START_HOUR) * WEEK_VIEW_HOUR_HEIGHT;
      const height = Math.max((clampedEnd - clampedStart) * WEEK_VIEW_HOUR_HEIGHT, 22);
      const effectiveAttendees = e.attendeeIds && e.attendeeIds.length ? e.attendeeIds : [e.createdBy];
      const hasConflict = findEventConflicts(e.startAt, e.endAt, effectiveAttendees, e.id).length > 0;
      const timeStr = `${start.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})} – ${end.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}`;
      return `<div class="week-event-block ${hasConflict?'conflict':''}" style="top:${top}px;height:${height}px;background:${meta.color}22;color:${meta.color};" onclick="event.stopPropagation();openEventDetailModal('${e.id}')" title="${escapeHtml(e.title)}${hasConflict?' — conflicts with another event':''}">
        <div class="week-event-title">${e.googleEventId?'📅 ':''}${hasConflict?'⚠ ':''}${escapeHtml(e.title)}</div>
        <div class="week-event-time">${timeStr}</div>
        ${attendeeAvatarsHtml(e.attendeeIds, 3)}
      </div>`;
    }).join('');

    return `<div class="week-hour-col" style="height:${gridHeight}px;cursor:pointer;" onclick="openNewEventModal('${dStr}')">${hourLines}${eventsHtml}</div>`;
  }).join('');

  container.innerHTML = `
    <div class="table-scroll-wrap">
    <div class="week-grid-wrap">
      <div class="week-grid-head">${headHtml}</div>
      <div class="week-allday-row">${allDayRowHtml}</div>
      ${hourLabelsHtml}
      ${dayColsHtml}
    </div>
    </div>`;
}

function populateCalendarClientSelect(selectedId){
  return `<option value="">No related client</option>` + activeClients().sort((a,b)=>a.name.localeCompare(b.name))
    .map(c=>`<option value="${c.id}" ${c.id===selectedId?'selected':''}>${escapeHtml(c.name)}</option>`).join('');
}

function eventFormHtml(editing, presetDateStr){
  const startDate = editing ? toDateStr(new Date(editing.startAt)) : (presetDateStr || toDateStr(new Date()));
  const startTime = editing && !editing.allDay ? new Date(editing.startAt).toTimeString().slice(0,5) : '09:00';
  const endTime = editing && !editing.allDay ? new Date(editing.endAt).toTimeString().slice(0,5) : '10:00';
  const selectedAttendees = editing ? (editing.attendeeIds||[]) : [currentUser.id];
  return `
    <div class="modal-head"><span class="panel-title">${editing ? 'Edit event' : 'New event'}</span><span class="toast-close" onclick="closeAppModal()">✕</span></div>
    <div class="modal-body">
      <div class="settings-field"><label>Title</label><input id="eventTitleInput" style="width:100%;" placeholder="e.g. Kickoff call with Flame Auto Repair" value="${editing ? escapeHtml(editing.title) : ''}"></div>
      <div class="settings-field"><label>Description (optional)</label><textarea spellcheck="true" id="eventDescInput" style="width:100%;min-height:70px;font-family:var(--font);font-size:13px;padding:10px;border-radius:8px;border:1px solid var(--border);">${editing ? escapeHtml(editing.description) : ''}</textarea></div>
      <div class="form-grid">
        <div style="position:relative;"><label>Date</label>${datePickerFieldHtml('eventDateInput', { value: startDate, minDate: toDateStr(new Date()) })}</div>
        <div><label>Type</label>
          <select id="eventTypeSelect">
            ${Object.entries(CALENDAR_TYPE_META).map(([val,m])=>`<option value="${escapeHtml(val)}" ${editing && editing.eventType===val ? 'selected' : (!editing && val==='meeting' ? 'selected' : '')}>${escapeHtml(m.label)}</option>`).join('')}
          </select>
        </div>
        <div style="position:relative;"><label>Start time</label>${timePickerFieldHtml('eventStartInput', { value: startTime })}</div>
        <div style="position:relative;"><label>End time</label>${timePickerFieldHtml('eventEndInput', { value: endTime })}</div>
      </div>
      <div class="settings-field"><label><input type="checkbox" id="eventAllDayInput" ${editing && editing.allDay ? 'checked' : ''} onchange="toggleEventAllDay()" style="width:auto;margin-right:6px;">All-day event</label></div>
      <div class="form-grid">
        <div class="settings-field"><label>Location (optional)</label><input id="eventLocationInput" placeholder="Zoom link, address, or wherever it's happening" value="${editing && editing.location ? escapeHtml(editing.location) : ''}"></div>
        <div><label>Reminder</label>
          <select id="eventReminderSelect">
            ${REMINDER_OPTIONS.map(([val,label])=>`<option value="${escapeHtml(val)}" ${String(editing ? (editing.reminderMinutes ?? '') : '')===val ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
          </select>
        </div>
      </div>
      ${!editing ? `
      <div class="form-grid">
        <div class="settings-field"><label>Related client (optional)</label><select id="eventClientSelect" style="width:100%;">${populateCalendarClientSelect(editing ? editing.clientId : null)}</select></div>
        <div><label>Repeats</label>
          <select id="eventRepeatSelect" onchange="toggleRepeatUntilField()">
            <option value="none">Doesn't repeat</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
      </div>
      <div id="eventRepeatUntilWrap" style="display:none;position:relative;"><label>Repeats until</label>${datePickerFieldHtml('eventRepeatUntilInput', { value: (()=>{ const d=new Date(); d.setFullYear(d.getFullYear()+1); return toDateStr(d); })(), minDate: toDateStr(new Date()) })}</div>
      ` : `
      <div class="settings-field"><label>Related client (optional)</label><select id="eventClientSelect" style="width:100%;">${populateCalendarClientSelect(editing ? editing.clientId : null)}</select></div>
      ${editing.recurrenceGroupId ? `<p style="font-size:11.5px;color:var(--muted-lt);margin:0;">🔁 ${editing.recurrenceLabel||'Recurring'} — part of a series. Editing here only changes this one occurrence.</p>` : ''}
      `}
      <div class="settings-field">
        <label>Attendees</label>
        <div style="display:flex;flex-wrap:wrap;gap:10px;padding:10px;border:1px solid var(--border);border-radius:8px;max-height:120px;overflow-y:auto;">
          ${[...teamProfiles].sort((a,b)=>a.name.localeCompare(b.name)).map(p=>`
            <label style="display:flex;align-items:center;gap:6px;font-size:12.5px;cursor:pointer;">
              <input type="checkbox" class="event-attendee-checkbox" value="${p.id}" ${selectedAttendees.includes(p.id)?'checked':''} style="width:auto;">
              ${escapeHtml(p.name)}${p.id===currentUser.id?' (you)':''}
            </label>`).join('')}
        </div>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-brand" onclick="${editing ? `saveEditEvent('${editing.id}')` : 'saveNewEvent()'}">${editing ? 'Save changes' : 'Add event'}</button>
      ${editing && !editing.googleEventId ? `<button class="btn btn-outline" style="color:var(--red);" onclick="${editing.recurrenceGroupId ? `openDeleteRecurringChoice('${editing.id}')` : `deleteCalendarEvent('${editing.id}')`}">Delete</button>` : ''}
      <button class="btn btn-outline" onclick="closeAppModal()">Cancel</button>
    </div>`;
}

function toggleRepeatUntilField(){
  const val = document.getElementById('eventRepeatSelect')?.value;
  const wrap = document.getElementById('eventRepeatUntilWrap');
  if(wrap) wrap.style.display = (val && val!=='none') ? 'block' : 'none';
}

function toggleEventAllDay(){
  const isAllDay = document.getElementById('eventAllDayInput').checked;
  setPickerDisabled('eventStartInput', isAllDay);
  setPickerDisabled('eventEndInput', isAllDay);
}

function openNewEventModal(presetDateStr){
  openAppModal(eventFormHtml(null, presetDateStr), 480);
  setTimeout(toggleEventAllDay, 0);
}

const RSVP_STATUS_META = {
  confirmed: { label:'Confirmed', color:'#117F3A', icon:'✓' },
  declined: { label:'Declined', color:'#CF2424', icon:'✕' },
  change_requested: { label:'Change requested', color:'#A65B05', icon:'⚠' },
  pending: { label:'Pending', color:'#696F78', icon:'…' },
};

function personAvatarHtml(userId){
  const p = teamProfiles.find(x=>x.id===userId);
  if(!p) return '';
  return p.avatar_url
    ? `<img class="event-person-avatar" src="${safeUrl(p.avatar_url)}">`
    : `<div class="event-person-avatar-fallback">${escapeHtml((p.name||'?').trim().charAt(0).toUpperCase())}</div>`;
}

function openEventDetailModal(eventId){
  const e = calendarEvents.find(x=>x.id===eventId);
  if(!e) return;
  const c = e.clientId ? clients.find(x=>x.id===e.clientId) : null;
  const meta = CALENDAR_TYPE_META[e.eventType] || CALENDAR_TYPE_META.other;
  const dateTimeStr = e.allDay
    ? new Date(e.startAt).toLocaleDateString('en-US',{weekday:'long', month:'long', day:'numeric'})
    : `${new Date(e.startAt).toLocaleDateString('en-US',{weekday:'long', month:'long', day:'numeric'})} · ${new Date(e.startAt).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})} – ${new Date(e.endAt).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}`;

  const isCreator = e.createdBy === currentUser.id;
  const isAttendee = (e.attendeeIds||[]).includes(currentUser.id);
  const myRsvpStatus = (e.rsvps && e.rsvps[currentUser.id]) ? e.rsvps[currentUser.id].status : 'pending';
  const organizer = teamProfiles.find(p=>p.id===e.createdBy);

  // One unified list, organizer first (never needs to RSVP to their own
  // event — that was the bug), everyone else shown with their actual RSVP
  // status. This replaces what used to be three separate, partly redundant
  // displays (an avatar stack, a plain name list, and a separate RSVP list
  // repeating the same names).
  const otherAttendeeIds = (e.attendeeIds||[]).filter(id=>id!==e.createdBy);
  const peopleRowsHtml = [
    organizer ? `<div class="event-person-row">
      ${personAvatarHtml(organizer.id)}
      <span class="event-person-name">${escapeHtml(organizer.name)}</span>
      <span class="event-person-badge" style="background:var(--brand-bg);color:var(--brand-dark);">Organizer</span>
    </div>` : '',
    ...otherAttendeeIds.map(id=>{
      const p = teamProfiles.find(x=>x.id===id);
      if(!p) return '';
      const r = (e.rsvps && e.rsvps[id]) || { status:'pending' };
      const rMeta = RSVP_STATUS_META[r.status] || RSVP_STATUS_META.pending;
      const noteHtml = r.status==='change_requested' && r.message ? `<div class="event-change-note">"${escapeHtml(r.message)}"</div>` : '';
      return `<div class="event-person-row">
        ${personAvatarHtml(id)}
        <span class="event-person-name">${escapeHtml(p.name)}</span>
        <span class="event-person-badge" style="background:${rMeta.color}18;color:${rMeta.color};">${rMeta.icon} ${escapeHtml(rMeta.label)}</span>
      </div>${noteHtml}`;
    })
  ].join('');

  let rsvpActionsHtml = '';
  if(!isCreator && isAttendee && !e.googleEventId){
    rsvpActionsHtml = `<button class="btn ${myRsvpStatus==='confirmed'?'btn-brand':'btn-outline'}" onclick="respondToEvent('${e.id}','confirmed')">Confirm</button>
      <button class="btn ${myRsvpStatus==='declined'?'btn-brand':'btn-outline'}" onclick="respondToEvent('${e.id}','declined')">Decline</button>
      <button class="btn btn-outline" onclick="openRequestChangeModal('${e.id}')">Request change</button>`;
  }

  openAppModal(`
    <div class="event-modal-head" style="background:${meta.color}0d;">
      <span class="pill" style="background:${meta.color};color:#fff;font-weight:700;">${meta.icon} ${escapeHtml(meta.label)}</span>
      <button class="event-modal-close" onclick="closeAppModal()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="event-modal-body">
      <div class="event-modal-title">${escapeHtml(e.title)}</div>
      ${e.recurrenceGroupId ? `<div class="event-modal-recur">🔁 ${e.recurrenceLabel} event</div>` : ''}

      <div class="event-meta-row">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <span>${dateTimeStr}</span>
      </div>
      ${e.location ? `<div class="event-meta-row">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
        <span>${escapeHtml(e.location)}</span>
      </div>` : ''}
      ${c ? `<div class="event-meta-row">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
        <span class="row-link" onclick="closeAppModal();openClientDetail('${c.id}');">${escapeHtml(c.name)}</span>
      </div>` : ''}
      ${reminderLabel(e.reminderMinutes) ? `<div class="event-meta-row">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        <span>Reminder: ${reminderLabel(e.reminderMinutes)}</span>
      </div>` : ''}

      ${e.description ? `<div class="event-desc">${escapeHtml(e.description)}</div>` : ''}

      ${peopleRowsHtml ? `<div class="event-section-label">Who's coming</div>${peopleRowsHtml}` : ''}

      ${e.googleEventId ? `<div class="event-google-note">📅 Synced from Google Calendar — edit it in Google, changes appear here on next sync.</div>` : ''}
    </div>
    <div class="event-modal-actions">
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${isCreator && !e.googleEventId ? `<button class="btn btn-brand" onclick="openEditEventForm('${e.id}')">Edit</button>` : ''}
        ${rsvpActionsHtml}
        <button class="btn btn-outline" onclick="closeAppModal()">Close</button>
      </div>
      ${isCreator && !e.googleEventId ? `<span class="event-delete-link" onclick="${e.recurrenceGroupId ? `openDeleteRecurringChoice('${e.id}')` : `deleteCalendarEvent('${e.id}')`}">Delete event</span>` : ''}
    </div>`, 480);
}

async function respondToEvent(eventId, status){
  const e = calendarEvents.find(x=>x.id===eventId);
  if(!e) return;
  const updatedRsvps = { ...e.rsvps, [currentUser.id]: { status, respondedAt: new Date().toISOString() } };
  const { error } = await supabaseClient.from('calendar_events').update({ rsvps: updatedRsvps }).eq('id', eventId);
  if(error){ showToast('error','Failed', error.message); return; }
  await loadCalendarEvents();
  renderCalendar();
  closeAppModal();
  showToast('success', status==='confirmed' ? 'Confirmed' : 'Declined', 'The organizer will see your response.');
  if(e.createdBy !== currentUser.id){
    await sendNotification(e.createdBy, 'event_rsvp', `RSVP: ${status==='confirmed'?'Confirmed':'Declined'}`, `${myName()||'Someone'} ${status==='confirmed'?'confirmed':'declined'} "${e.title}".`, 'calendar');
  }
}

function openRequestChangeModal(eventId){
  openAppModal(`
    <div class="modal-head"><span class="panel-title">Request a change</span><span class="toast-close" onclick="closeAppModal()">✕</span></div>
    <div class="modal-body">
      <div class="settings-field"><label>What would you like changed?</label><textarea spellcheck="true" id="changeRequestInput" style="width:100%;min-height:90px;font-family:var(--font);font-size:13px;padding:10px;border-radius:8px;border:1px solid var(--border);" placeholder="e.g. Can we move this to 3pm instead?"></textarea></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-brand" onclick="submitChangeRequest('${eventId}')">Send request</button>
      <button class="btn btn-outline" onclick="closeAppModal()">Cancel</button>
    </div>`, 440);
}

async function submitChangeRequest(eventId){
  const message = document.getElementById('changeRequestInput').value.trim();
  if(!message){ showToast('error','Say what you need','Add a quick note about the change.'); return; }
  const e = calendarEvents.find(x=>x.id===eventId);
  if(!e) return;
  const updatedRsvps = { ...e.rsvps, [currentUser.id]: { status:'change_requested', message, respondedAt: new Date().toISOString() } };
  const { error } = await supabaseClient.from('calendar_events').update({ rsvps: updatedRsvps }).eq('id', eventId);
  if(error){ showToast('error','Failed', error.message); return; }
  await loadCalendarEvents();
  renderCalendar();
  closeAppModal();
  showToast('success','Request sent','The organizer will see your note.');
  if(e.createdBy !== currentUser.id){
    await sendNotification(e.createdBy, 'event_rsvp', 'Change requested', `${myName()||'Someone'} requested a change to "${e.title}": "${message}"`, 'calendar');
  }
}

function openEditEventForm(eventId){
  const e = calendarEvents.find(x=>x.id===eventId);
  if(!e) return;
  openAppModal(eventFormHtml(e), 480);
  setTimeout(toggleEventAllDay, 0);
}

// Creates a real calendar_events row tied to the task, as an all-day event
// on its due date — a genuinely separate record from the lightweight
// due-date markers the calendar already shows for every task automatically.
// This is the explicit, opt-in version: attendees, a real time, a location,
// whatever the person wants to add, by editing the resulting event normally.
async function addReminderToCalendar(reminderId){
  const r = clientReminders.find(x=>x.id===reminderId);
  if(!r || !r.followUpDate) return;
  const c = clients.find(x=>x.id===r.clientId);
  const { error } = await supabaseClient.from('calendar_events').insert({
    title: c ? `Follow up: ${c.name}` : 'Client follow-up', description: r.question || null,
    start_at: `${r.followUpDate}T00:00:00`, end_at: `${r.followUpDate}T23:59:59`, all_day: true,
    client_id: r.clientId, created_by: currentUser.id, event_type: 'reminder', related_reminder_id: r.id
  });
  await loadCalendarEvents();
  if(error){ showToast('error','Could not add to calendar', error.message); return; }
  showToast('success','Added to calendar', `On ${new Date(r.followUpDate+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}.`);
}

async function addNoteToCalendar(noteId){
  const n = notes.find(x=>x.id===noteId);
  if(!n || !n.followUpDate) return;
  const { error } = await supabaseClient.from('calendar_events').insert({
    title: n.title || 'Note follow-up', description: n.text || null,
    start_at: `${n.followUpDate}T00:00:00`, end_at: `${n.followUpDate}T23:59:59`, all_day: true,
    client_id: n.clientId, created_by: currentUser.id, event_type: 'reminder', related_note_id: n.id
  });
  await loadCalendarEvents();
  if(error){ showToast('error','Could not add to calendar', error.message); return; }
  showToast('success','Added to calendar', `On ${new Date(n.followUpDate+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}.`);
}

async function addTaskToCalendar(taskId){
  const t = tasks.find(x=>x.id===taskId);
  if(!t || !t.dueDate) return;
  const { error } = await supabaseClient.from('calendar_events').insert({
    title: t.title, description: t.description || null,
    start_at: `${t.dueDate}T00:00:00`, end_at: `${t.dueDate}T23:59:59`, all_day: true,
    client_id: t.clientId, created_by: currentUser.id, event_type: 'deadline',
    related_task_id: t.id, attendee_ids: [...new Set([t.assignerId, t.assigneeId])]
  });
  await loadCalendarEvents();
  if(error){ showToast('error','Could not add', error.message); return; }
  openTaskDetailModal(taskId);
  showToast('success','Added to calendar', `On ${new Date(t.dueDate+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}.`);
}

function buildEventTimestamps(){
  const dateVal = document.getElementById('eventDateInput').value;
  const isAllDay = document.getElementById('eventAllDayInput').checked;
  if(!dateVal) return null;
  const [year, month, day] = dateVal.split('-').map(Number);

  if(isAllDay){
    // new Date(y, m, d, ...) builds from LOCAL components, then
    // toISOString() correctly converts to UTC for storage — this is the
    // part the old naive-string version skipped, which is exactly what
    // caused the timezone shift.
    const start = new Date(year, month-1, day, 0, 0, 0);
    const end = new Date(year, month-1, day, 23, 59, 59);
    return { startAt: start.toISOString(), endAt: end.toISOString(), allDay:true };
  }

  const startTime = document.getElementById('eventStartInput').value || '09:00';
  const endTime = document.getElementById('eventEndInput').value || '10:00';
  const [startH, startM] = startTime.split(':').map(Number);
  const [endH, endM] = endTime.split(':').map(Number);
  const start = new Date(year, month-1, day, startH, startM, 0);
  const end = new Date(year, month-1, day, endH, endM, 0);
  return { startAt: start.toISOString(), endAt: end.toISOString(), allDay:false };
}

// All-day events don't conflict-check against anything — they're not tied
// to a specific time slot, so "overlap" doesn't mean the same thing for them.
function findEventConflicts(startAtStr, endAtStr, attendeeIds, excludeEventId){
  if(!attendeeIds.length) return [];
  const newStart = new Date(startAtStr), newEnd = new Date(endAtStr);
  return calendarEvents.filter(e=>{
    if(e.id===excludeEventId || e.allDay) return false;
    const eStart = new Date(e.startAt), eEnd = new Date(e.endAt);
    if(!(newStart < eEnd && newEnd > eStart)) return false;
    const eAttendees = e.attendeeIds && e.attendeeIds.length ? e.attendeeIds : [e.createdBy];
    return eAttendees.some(id=>attendeeIds.includes(id));
  });
}

function getSelectedAttendeeIds(){
  return [...document.querySelectorAll('.event-attendee-checkbox:checked')].map(cb=>cb.value);
}

// Notifies a set of attendees about an event change — excludes the
// current user (creating or editing your own event shouldn't notify
// yourself), used for new invites, "this event changed," and cancellations.
function notifyEventAttendees(attendeeIds, title, type, body){
  const titleByType = { event_invited: "You're invited", event_updated: 'Event updated', event_cancelled: 'Event cancelled' };
  attendeeIds.filter(id => id !== currentUser?.id).forEach(id => {
    sendNotification(id, type, titleByType[type] || 'Event updated', body, 'calendar');
  });
}

async function saveNewEvent(){
  const title = document.getElementById('eventTitleInput').value.trim();
  if(!title){ showToast('error','Title required','Give the event a title first.'); return; }
  const ts = buildEventTimestamps();
  if(!ts){ showToast('error','Pick a date','A date is required.'); return; }
  const now = new Date();
  const isPast = ts.allDay
    ? new Date(ts.startAt) < new Date(now.getFullYear(), now.getMonth(), now.getDate())
    : new Date(ts.startAt) < now;
  if(isPast){ showToast('error','That date has already passed', 'Pick a date and time in the future.'); return; }
  const description = document.getElementById('eventDescInput').value.trim();
  const eventType = document.getElementById('eventTypeSelect').value;
  const clientId = document.getElementById('eventClientSelect').value || null;
  const location = document.getElementById('eventLocationInput').value.trim() || null;
  const reminderVal = document.getElementById('eventReminderSelect')?.value;
  const reminderMinutes = reminderVal === '' || reminderVal === undefined ? null : parseInt(reminderVal, 10);
  const attendeeIds = getSelectedAttendeeIds();
  const repeatMode = document.getElementById('eventRepeatSelect')?.value || 'none';

  if(!ts.allDay){
    const conflicts = findEventConflicts(ts.startAt, ts.endAt, attendeeIds, null);
    if(conflicts.length){
      const names = conflicts.map(c=>`"${c.title}" (${new Date(c.startAt).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})})`).join(', ');
      if(!(await confirmDialog(`This overlaps with ${names} for at least one attendee.`, {confirmLabel:'Save anyway'}))) return;
    }
  }

  const baseRow = { title, description, all_day: ts.allDay, client_id: clientId, created_by: currentUser.id, event_type: eventType, location, attendee_ids: attendeeIds, reminder_minutes: reminderMinutes };

  if(repeatMode==='none'){
    const { error } = await supabaseClient.from('calendar_events').insert({ ...baseRow, start_at: ts.startAt, end_at: ts.endAt });
    closeAppModal();
    await loadCalendarEvents();
    renderCalendar();
    error ? showToast('error','Save failed', error.message) : showToast('success','Event added','On the calendar now.');
    if(!error) notifyEventAttendees(attendeeIds, title, 'event_invited', `${myName()||'Someone'} invited you to "${title}".`);
    return;
  }

  // Recurring — generate one row per occurrence sharing a group id, rather
  // than a single rule expanded at render time. Capped at 366 occurrences
  // (a year of daily) as a sane upper bound against a mistyped far-future date.
  const untilStr = document.getElementById('eventRepeatUntilInput')?.value;
  if(!untilStr){ showToast('error','Pick an end date','Set how far the repeat should go.'); return; }
  const repeatLabel = { daily:'Daily', weekly:'Weekly', monthly:'Monthly' }[repeatMode] || 'Recurring';
  const groupId = crypto.randomUUID();
  const start0 = new Date(ts.startAt), end0 = new Date(ts.endAt);
  const durationMs = end0 - start0;
  const until = new Date(`${untilStr}T23:59:59`);

  const rows = [];
  let cursorStart = new Date(start0);
  let guard = 0;
  while(cursorStart <= until && guard < 366){
    const cursorEnd = new Date(cursorStart.getTime() + durationMs);
    rows.push({ ...baseRow, start_at: cursorStart.toISOString(), end_at: cursorEnd.toISOString(), recurrence_group_id: groupId, recurrence_label: repeatLabel });
    if(repeatMode==='daily') cursorStart.setDate(cursorStart.getDate()+1);
    else if(repeatMode==='weekly') cursorStart.setDate(cursorStart.getDate()+7);
    else cursorStart.setMonth(cursorStart.getMonth()+1);
    guard++;
  }

  const { error } = await supabaseClient.from('calendar_events').insert(rows);
  closeAppModal();
  await loadCalendarEvents();
  renderCalendar();
  error ? showToast('error','Save failed', error.message) : showToast('success','Recurring event added', `${rows.length} occurrences added, ${repeatLabel.toLowerCase()} through ${new Date(untilStr+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}.`);
  if(!error) notifyEventAttendees(attendeeIds, title, 'event_invited', `${myName()||'Someone'} invited you to "${title}" (${repeatLabel.toLowerCase()}).`);
}

async function saveEditEvent(eventId){
  const e = calendarEvents.find(x=>x.id===eventId);
  if(!e) return;
  const title = document.getElementById('eventTitleInput').value.trim();
  if(!title){ showToast('error','Title required','Give the event a title first.'); return; }
  const ts = buildEventTimestamps();
  if(!ts){ showToast('error','Pick a date','A date is required.'); return; }
  const dateChanged = document.getElementById('eventDateInput').value !== toDateStr(new Date(e.startAt));
  if(dateChanged){
    const now = new Date();
    const isPast = ts.allDay
      ? new Date(ts.startAt) < new Date(now.getFullYear(), now.getMonth(), now.getDate())
      : new Date(ts.startAt) < now;
    if(isPast){ showToast('error','That date has already passed', 'Pick a date and time in the future.'); return; }
  }
  const description = document.getElementById('eventDescInput').value.trim();
  const eventType = document.getElementById('eventTypeSelect').value;
  const clientId = document.getElementById('eventClientSelect').value || null;
  const location = document.getElementById('eventLocationInput').value.trim() || null;
  const reminderVal = document.getElementById('eventReminderSelect')?.value;
  const reminderMinutes = reminderVal === '' || reminderVal === undefined ? null : parseInt(reminderVal, 10);
  const attendeeIds = getSelectedAttendeeIds();
  const previousAttendeeIds = e.attendeeIds || [];

  if(!ts.allDay){
    const conflicts = findEventConflicts(ts.startAt, ts.endAt, attendeeIds, eventId);
    if(conflicts.length){
      const names = conflicts.map(c=>`"${c.title}" (${new Date(c.startAt).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})})`).join(', ');
      if(!(await confirmDialog(`This overlaps with ${names} for at least one attendee.`, {confirmLabel:'Save anyway'}))) return;
    }
  }

  const { error } = await supabaseClient.from('calendar_events').update({
    title, description, start_at: ts.startAt, end_at: ts.endAt, all_day: ts.allDay,
    client_id: clientId, event_type: eventType, location, attendee_ids: attendeeIds, reminder_minutes: reminderMinutes
  }).eq('id', eventId);
  closeAppModal();
  await loadCalendarEvents();
  renderCalendar();
  error ? showToast('error','Save failed', error.message) : showToast('success','Event updated','Changes saved.');
  if(!error){
    const newlyAdded = attendeeIds.filter(id => !previousAttendeeIds.includes(id));
    const stillThere = attendeeIds.filter(id => previousAttendeeIds.includes(id));
    const removed = previousAttendeeIds.filter(id => !attendeeIds.includes(id));
    notifyEventAttendees(newlyAdded, title, 'event_invited', `${myName()||'Someone'} invited you to "${title}".`);
    notifyEventAttendees(stillThere, title, 'event_updated', `${myName()||'Someone'} updated "${title}".`);
    notifyEventAttendees(removed, title, 'event_cancelled', `${myName()||'Someone'} removed you from "${title}".`);
  }
}

async function deleteCalendarEvent(eventId){
  if(!(await confirmDialog('Delete this event?', {confirmLabel:'Delete', destructive:true}))) return;
  const e = calendarEvents.find(x=>x.id===eventId);
  const { error } = await supabaseClient.from('calendar_events').delete().eq('id', eventId);
  closeAppModal();
  await loadCalendarEvents();
  renderCalendar();
  error ? showToast('error','Delete failed', error.message) : showToast('success','Event deleted','Removed from the calendar.');
  if(!error && e){
    notifyEventAttendees(e.attendeeIds||[], e.title, 'event_cancelled', `${myName()||'Someone'} cancelled "${e.title}".`);
  }
}

function openDeleteRecurringChoice(eventId){
  const e = calendarEvents.find(x=>x.id===eventId);
  if(!e) return;
  openAppModal(`
    <div class="modal-head"><span class="panel-title">Delete recurring event</span><span class="toast-close" onclick="closeAppModal()">✕</span></div>
    <div class="modal-body">
      <p style="font-size:13px;color:var(--muted);line-height:1.5;">"${escapeHtml(e.title)}" is part of a ${(e.recurrenceLabel||'recurring').toLowerCase()} series. What do you want to delete?</p>
    </div>
    <div class="modal-actions">
      <button class="btn btn-brand" onclick="deleteCalendarEvent('${eventId}')">Just this event</button>
      <button class="btn btn-outline" style="color:var(--red);" onclick="deleteRecurringSeries('${e.recurrenceGroupId}')">Entire series</button>
      <button class="btn btn-outline" onclick="closeAppModal()">Cancel</button>
    </div>`, 440);
}

async function deleteRecurringSeries(groupId){
  if(!(await confirmDialog('Delete every occurrence in this series? This can\'t be undone.', {confirmLabel:'Delete series', destructive:true}))) return;
  const { error } = await supabaseClient.from('calendar_events').delete().eq('recurrence_group_id', groupId);
  closeAppModal();
  await loadCalendarEvents();
  renderCalendar();
  error ? showToast('error','Delete failed', error.message) : showToast('success','Series deleted','All occurrences removed.');
}
