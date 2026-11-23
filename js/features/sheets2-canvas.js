// The rest of the window's sheets in the same language as the canvas ones: confirmations,
// reminders, notes, events, the timer and time entries, task details and the client form.
// Field ids match the older forms, so their save functions keep working unchanged.

// ---- Confirmation (an alert sheet) -----------------------------------------------------------
// "Delete this reminder? This can’t be undone." → title "Delete this reminder?", then the rest.
function confirmDialog(message, options){
  options = options || {};
  const destructive = !!options.destructive;
  const msg = String(message || '');
  const m = msg.match(/^(.+?[?.!])\s+([\s\S]+)$/);
  const title = options.title || (m ? m[1] : msg);
  const body = options.title ? msg : (m ? m[2] : '');
  return new Promise(resolve => {
    const previousFocus = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.zIndex = '1100';
    overlay.innerHTML = `<div class="modal-card alert-sheet" role="alertdialog" aria-labelledby="confirmDialogTitle" style="max-width:400px">
<h3 id="confirmDialogTitle">${escapeHtml(title)}</h3>${body ? `<p>${escapeHtml(body)}</p>` : ''}
<div class="sheet-a"><button class="btn" id="confirmDialogCancelBtn">${escapeHtml(options.cancelLabel || 'Cancel')}</button><button class="btn ${destructive ? 'danger' : 'btn-p'}" id="confirmDialogOkBtn">${escapeHtml(options.confirmLabel || 'OK')}</button></div></div>`;
    function finish(result){
      overlay.style.pointerEvents = 'none';
      overlay.querySelector('.modal-card')?.animate?.([{ transform: 'none', opacity: 1 }, { transform: 'scale(.97)', opacity: 0 }], { duration: 140, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
      typeof animateThen === 'function' ? animateThen(overlay, [{ opacity: 1 }, { opacity: 0 }], 160, 'ease-out', () => overlay.remove()) : overlay.remove();
      document.removeEventListener('keydown', onKeydown, true);
      if(previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
      resolve(result);
    }
    function onKeydown(e){ if(e.key === 'Escape'){ e.stopPropagation(); finish(false); } }
    overlay.onclick = e => { if(e.target === overlay) finish(false); };
    document.addEventListener('keydown', onKeydown, true);
    document.body.appendChild(overlay);
    overlay.querySelector('#confirmDialogOkBtn').onclick = () => finish(true);
    overlay.querySelector('#confirmDialogCancelBtn').onclick = () => finish(false);
    setTimeout(() => overlay.querySelector('#confirmDialogOkBtn')?.focus(), 10);
  });
}

// View sheets start on their main button, like a Mac sheet's default button.
function sheetFocusPrimary(){ setTimeout(() => document.querySelector('#appModalOverlay .btn-p, #appModalOverlay .sheet-a .btn:last-child')?.focus(), 30); }

// ---- Reminders ------------------------------------------------------------------------------
const REMINDER_DOT = { waiting: 'yellow', due: 'red', answered: 'green', closed: 'hollow' };
function openNewReminderModal(presetClientId){
  const fu = toDateStr(typeof remWorkday === 'function' ? remWorkday(addDays(new Date(), 3)) : addDays(new Date(), 3));   // never a weekend
  openAppModal(`<h3>New Reminder</h3>
<div class="f">
<label for="reminderClient">Client</label><div>${sheetPop('reminderClient', 'Client', sheetClientOptions(), presetClientId || '', '', { placeholder: 'Choose a client' })}</div>
<label class="top" for="reminderQuestion">Question</label><textarea id="reminderQuestion" class="tf" spellcheck="true" placeholder="What are you waiting to hear back on? e.g. the latest project photos"></textarea>
<label for="reminderFollowUpDate">Follow up</label><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${sheetDateField('reminderFollowUpDate', fu, { from: 0, to: 30, min: toDateStr(new Date()) })}</div>
<span></span><div class="sw-line">${sheetSwCk('reminderAddToCalendarInput', true, 'Add to my calendar')}Add to my calendar</div>
</div>
<div class="sheet-a"><button class="btn" onclick="closeAppModal()">Cancel</button><button class="btn btn-p" onclick="saveNewReminder()">Create Reminder</button></div>`, 520);
  setTimeout(() => document.getElementById(presetClientId ? 'reminderQuestion' : 'reminderClient')?.focus(), 30);
}
function openReminderDetailModal(id){
  const r = clientReminders.find(x => x.id === id);
  if(!r) return;
  const c = clients.find(x => x.id === r.clientId);
  const owner = teamProfiles.find(p => p.id === r.askedBy);
  const display = reminderDisplayStatus(r);
  const meta = REMINDER_STATUS_META[display] || REMINDER_STATUS_META.waiting;
  const resolved = display === 'answered' || display === 'closed';
  const asked = r.askedDate ? fmtShortDate(new Date(r.askedDate + 'T12:00:00')) : '';
  openAppModal(`<div class="sheet-meta"><span class="st"><span class="dot ${REMINDER_DOT[display] || 'yellow'}"></span>${escapeHtml(meta.label)}</span>${c ? `<a href="#" onclick="closeAppModal();openClientDetail('${c.id}');return false;">${escapeHtml(c.name)}${icon('caret-right', { weight: 'bold' })}</a>` : ''}</div>
<h3>Client Follow-up</h3>
<div class="f">
<label class="top" for="reminderEditQuestion">Question</label><textarea id="reminderEditQuestion" class="tf" spellcheck="true">${escapeHtml(r.question)}</textarea>
<label>Asked by</label><div style="font-size:14px">${owner ? escapeHtml(owner.name) : '—'}${asked ? `<span class="t-2"> · ${asked}</span>` : ''}</div>
<label for="reminderEditFollowUp">Follow up</label><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${sheetDateField('reminderEditFollowUp', r.followUpDate || '', { from: 0, to: 30, min: toDateStr(new Date()), disabled: resolved })}</div>
</div>
<div class="sheet-a"><button class="btn danger" style="margin-right:auto" onclick="closeAppModal();deleteReminder('${r.id}')">Delete</button>${resolved
    ? `<button class="btn" onclick="markReminderStatus('${r.id}','waiting');closeAppModal();">Reopen</button>`
    : `<button class="btn" onclick="markReminderStatus('${r.id}','answered');closeAppModal();">Mark Answered</button>`}<button class="btn btn-p" onclick="saveReminderEdit('${r.id}')">Save</button></div>`, 520);
  sheetFocusPrimary();
}

// ---- Notes: see notes-canvas.js (the note sheet) ------------------------------------------

// ---- Events ---------------------------------------------------------------------------------
const EVENT_TYPE_DOT = { meeting: 'blue', deadline: 'red', reminder: 'yellow', other: 'hollow' };
function eventFormHtml(editing, presetDateStr){
  const e = editing || null;
  const date = e ? toDateStr(new Date(e.startAt)) : (presetDateStr || toDateStr(new Date()));
  const hh = d => { const x = new Date(d); return String(x.getHours()).padStart(2, '0') + ':' + String(x.getMinutes()).padStart(2, '0'); };
  // A new event today starts at the next half hour (9 AM would already be past by lunch).
  let start = '09:00', end = '10:00';
  if(e && !e.allDay){ start = hh(e.startAt); end = hh(e.endAt); }
  else if(!e && date === toDateStr(new Date())){
    const n = new Date(), m = Math.min(Math.ceil((n.getHours() * 60 + n.getMinutes() + 1) / 30) * 30, 22 * 60 + 30);
    const f = x => String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0');
    start = f(m); end = f(Math.min(m + 60, 23 * 60 + 45));
  }
  const allDay = !!(e && e.allDay);
  const who = e ? (e.attendeeIds || []) : [currentUser.id];
  const people = [...teamProfiles].filter(p => !p.access_revoked || who.includes(p.id)).sort((a, b) => a.name.localeCompare(b.name));
  const until = toDateStr(addDays(new Date(), 365));
  const types = Object.entries(CALENDAR_TYPE_META).map(([v, m]) => [v, m.label]);
  return `<h3>${e ? 'Edit Event' : 'New Event'}</h3>
<div class="f">
<label for="eventTitleInput">Title</label><input id="eventTitleInput" class="tf" placeholder="e.g. Kickoff call with Northline Roofing" value="${e ? escapeHtml(e.title) : ''}">
<label for="eventTypeSelect">Type</label><div>${sheetPop('eventTypeSelect', 'Type', types, e ? e.eventType : 'meeting')}</div>
<label for="eventDateInput">Date</label><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${sheetDateField('eventDateInput', date, { from: 0, to: 30, min: toDateStr(new Date()) })}</div>
<label for="eventStartInput">Time</label><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap" id="eventTimeRow">${sheetPop('eventStartInput', 'Starts', sheetTimeOpts(start), start, 'eventStartChanged(this)', { disabled: allDay })}<span class="t-2" style="font-size:13px">to</span>${sheetPop('eventEndInput', 'Ends', sheetTimeOpts(end), end, '', { disabled: allDay })}<span class="sw-line" style="margin-left:6px">${sheetSwCk('eventAllDayInput', allDay, 'All day', 'toggleEventAllDay()')}All day</span></div>
<label for="eventClientSelect">Client</label><div>${sheetPop('eventClientSelect', 'Client', [['', 'No client'], ...sheetClientOptions(e && e.clientId)], e && e.clientId ? e.clientId : '')}</div>
<label for="eventLocationInput">Location</label><input id="eventLocationInput" class="tf" placeholder="Zoom link or address" value="${e && e.location ? escapeHtml(e.location) : ''}">
<label for="eventReminderSelect">Alert</label><div>${sheetPop('eventReminderSelect', 'Alert', REMINDER_OPTIONS, String(e ? (e.reminderMinutes ?? '') : ''))}</div>
${e ? '' : `<label for="eventRepeatSelect">Repeat</label><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${sheetPop('eventRepeatSelect', 'Repeat', [['none', 'Never'], ['daily', 'Every day'], ['weekly', 'Every week'], ['monthly', 'Every month']], 'none', 'toggleRepeatUntilField()')}<span id="eventRepeatUntilWrap" style="display:none;align-items:center;gap:8px"><span class="t-2" style="font-size:13px">until</span>${sheetDateField('eventRepeatUntilInput', until, { from: 7, to: 30, min: toDateStr(new Date()) })}</span></div>`}
<label class="top">Invitees</label><div class="pick-people">${people.map(p => `<label class="pick"><input type="checkbox" class="event-attendee-checkbox ck-native" value="${p.id}"${who.includes(p.id) ? ' checked' : ''}>${avHtml(p.name)}<span>${escapeHtml(p.id === currentUser.id ? 'You' : p.name)}</span></label>`).join('')}</div>
<label class="top" for="eventDescInput">Notes</label><textarea id="eventDescInput" class="tf" spellcheck="true" placeholder="Agenda, links, anything people should know">${e ? escapeHtml(e.description || '') : ''}</textarea>
${e && e.recurrenceGroupId ? `<span></span><p class="t-2" style="margin:0;font-size:13px">Part of a series that repeats ${escapeHtml((e.recurrenceLabel || '').toLowerCase() || 'regularly')}. Changes here apply to this one only.</p>` : ''}
</div>
<div class="sheet-a">${e && !e.googleEventId ? `<button class="btn danger" style="margin-right:auto" onclick="${e.recurrenceGroupId ? `openDeleteRecurringChoice('${e.id}')` : `deleteCalendarEvent('${e.id}')`}">Delete</button>` : ''}<button class="btn" onclick="closeAppModal()">Cancel</button><button class="btn btn-p" onclick="${e ? `saveEditEvent('${e.id}')` : 'saveNewEvent()'}">${e ? 'Save' : 'Add Event'}</button></div>`;
}
function openNewEventModal(presetDateStr){ openAppModal(eventFormHtml(null, presetDateStr), 540); setTimeout(() => document.getElementById('eventTitleInput')?.focus(), 30); }
function openEditEventForm(eventId){ const e = calendarEvents.find(x => x.id === eventId); if(!e) return; openAppModal(eventFormHtml(e), 540); }
function toggleEventAllDay(){
  const all = !!document.getElementById('eventAllDayInput')?.checked;
  ['eventStartInput', 'eventEndInput'].forEach(id => { const s = document.getElementById(id); if(s){ s.disabled = all; s.parentElement.classList.toggle('off', all); } });
}
function toggleRepeatUntilField(){
  const v = document.getElementById('eventRepeatSelect')?.value, w = document.getElementById('eventRepeatUntilWrap');
  if(w) w.style.display = v && v !== 'none' ? 'inline-flex' : 'none';
}
// Moving the start keeps the length the same, like Calendar does.
function eventStartChanged(sel){
  const end = document.getElementById('eventEndInput'); if(!end) return;
  const prev = sel.dataset.prev || [...sel.options].find(o => o.defaultSelected)?.value || sel.value;
  const toMin = v => { const [h, m] = v.split(':').map(Number); return h * 60 + m; };
  const len = Math.max(15, toMin(end.value) - toMin(prev));
  const t = Math.min(toMin(sel.value) + len, 23 * 60 + 45);
  const hhmm = String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
  if([...end.options].some(o => o.value === hhmm)){ end.value = hhmm; syncPopSel(end); }
  sel.dataset.prev = sel.value;
}
function openDeleteRecurringChoice(eventId){
  const e = calendarEvents.find(x => x.id === eventId);
  if(!e) return;
  openAppModal(`<h3>Delete a Repeating Event</h3>
<p class="t-2" style="margin:-6px 0 0;font-size:14px;line-height:1.5">“${escapeHtml(e.title)}” repeats ${escapeHtml((e.recurrenceLabel || 'regularly').toLowerCase())}. Delete just this one, or every one?</p>
<div class="sheet-a"><button class="btn" style="margin-right:auto" onclick="closeAppModal()">Cancel</button><button class="btn danger" onclick="deleteRecurringSeries('${e.recurrenceGroupId}')">Delete All</button><button class="btn btn-p" onclick="deleteCalendarEvent('${eventId}')">Delete This One</button></div>`, 440);
  sheetFocusPrimary();
}
// The event preview: a card beside the event, like Calendar on the Mac. Escape or a click
// outside closes it. Opened from somewhere the event isn't on screen, it shows as a sheet.
function eventPreviewHtml(e, inSheet){
  const c = e.clientId ? clients.find(x => x.id === e.clientId) : null;
  // an entry made from a task follows the task
  const task = e.relatedTaskId && typeof tasks !== 'undefined' ? tasks.find(x => String(x.id) === String(e.relatedTaskId) && !x.cancelledAt) : null;
  const tDone = !!task && task.status === 'done';
  const col = tDone ? 'green' : typeof calColor === 'function' ? calColor(e) : (EVENT_TYPE_DOT[e.eventType] || 'blue');
  const kind = task ? (tDone ? 'Task · Done' : 'Task') : { blue: 'Client meeting', purple: 'Internal meeting', red: 'Deadline' }[col] || (e.eventType === 'reminder' ? 'Reminder' : 'Event');
  const s = new Date(e.startAt), en = new Date(e.endAt || e.startAt);
  const day = s.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const time = e.allDay ? 'All day' : `${fmtTime(s)} – ${fmtTime(en)}`;
  const mine = e.createdBy === currentUser.id, invited = (e.attendeeIds || []).includes(currentUser.id), google = !!e.googleEventId;
  const myRsvp = e.rsvps && e.rsvps[currentUser.id] ? e.rsvps[currentUser.id].status : 'pending';
  const organizer = teamProfiles.find(p => p.id === e.createdBy);
  const RS = { confirmed: ['green', 'Going'], declined: ['red', 'Not going'], change_requested: ['yellow', 'Asked for a change'], pending: ['hollow', 'No answer yet'] };
  const others = (e.attendeeIds || []).filter(id => id !== e.createdBy).map(id => {
    const p = teamProfiles.find(x => x.id === id); if(!p) return '';
    const r = (e.rsvps && e.rsvps[id]) || { status: 'pending' }, [dc, lab] = RS[r.status] || RS.pending;
    return `<div class="evp-p"><span class="n">${escapeHtml(p.id === currentUser.id ? `${p.name} (you)` : p.name)}${r.status === 'change_requested' && r.message ? `<small>“${escapeHtml(r.message)}”</small>` : ''}</span><span class="st"><span class="dot ${dc}"></span>${lab}</span></div>`;
  }).filter(Boolean);
  const people = organizer && (others.length || !mine) ? `<div class="evp-p"><span class="n">${escapeHtml(organizer.name)}</span><span class="st t-2">Organizer</span></div>` + others.join('') : others.join('');
  const row = (ic, html) => `<div class="evp-r">${icon(ic)}<span>${html}</span></div>`;
  const place = typeof calPlace === 'function' ? calPlace({ location: e.location }) : e.location;
  const loc = !e.location ? '' : /^https?:\/\//i.test(e.location)
    ? `<a href="${safeUrl(e.location)}" target="_blank" rel="noopener">${escapeHtml(place && place !== 'Online' ? 'Join ' + place : truncateLinkDisplay(e.location, 40))}</a>`
    : escapeHtml(e.location);
  const alert = reminderLabel(e.reminderMinutes);
  const tStage = task ? (tDone ? `done${task.completedAt ? ' ' + fmtShortDate(new Date(task.completedAt)) : ''}` : ({ todo: 'to do', in_progress: 'in progress', in_review: 'in review' }[task.status] || 'to do')) : '';
  const rows = [task && row('list-todo', `<a href="#" onclick="closeEventPreview();closeAppModal();openTaskDetailModal('${task.id}');return false;">Open the task</a><span class="t-2"> · ${escapeHtml(tStage)}</span>`),
    loc && row(/^https?:\/\//i.test(e.location) ? 'video' : 'map-pin', loc),
    c && row('buildings', `<a href="#" onclick="closeEventPreview();closeAppModal();openClientDetail('${c.id}');return false;">${escapeHtml(c.name)}</a>`),
    alert && row('bell', 'Alert ' + escapeHtml(alert.toLowerCase())),
    e.recurrenceGroupId && row('repeat', 'Repeats ' + escapeHtml((e.recurrenceLabel || 'regularly').toLowerCase())),
    google && row('google-logo', 'From Google Calendar')].filter(Boolean).join('');
  const del = e.recurrenceGroupId ? `openDeleteRecurringChoice('${e.id}')` : `deleteCalendarEvent('${e.id}')`;
  let foot = '';
  if(task){
    // a task on the calendar: open it, or finish it right here (the Mark Done sheet, with its time)
    const canFinish = !tDone && task.assigneeId === currentUser.id;
    foot = `${mine && !google ? `<button class="ib evp-del" aria-label="Remove from the calendar" title="Remove from the calendar" onclick="closeEventPreview();${del}">${icon('trash')}</button>` : ''}<span class="evp-sp"></span><button class="btn" onclick="closeEventPreview();closeAppModal();openTaskDetailModal('${task.id}')">Open Task</button>${canFinish ? `<button class="btn" onclick="closeEventPreview();closeAppModal();moveTaskToStatus('${task.id}','done')">${icon('check')}Mark Done</button>` : ''}`;
  }
  else if(mine && !google) foot = `<button class="ib evp-del" aria-label="Delete event" title="Delete" onclick="closeEventPreview();${del}">${icon('trash')}</button><span class="evp-sp"></span><button class="btn" onclick="closeEventPreview();openEditEventForm('${e.id}')">Edit</button>`;
  else if(invited && !google) foot = `<button class="btn" onclick="closeEventPreview();openRequestChangeModal('${e.id}')">Ask for a Change</button><span class="evp-sp"></span><button class="btn" onclick="closeEventPreview();respondToEvent('${e.id}','declined')"${myRsvp === 'declined' ? ' disabled' : ''}>${myRsvp === 'declined' ? 'Not Going' : 'Decline'}</button><button class="btn" onclick="closeEventPreview();respondToEvent('${e.id}','confirmed')"${myRsvp === 'confirmed' ? ' disabled' : ''}>${myRsvp === 'confirmed' ? 'Going' : 'Accept'}</button>`;
  else if(google) foot = `<span class="t-2 evp-note">Change it in Google Calendar; edits show here at the next sync.</span>`;
  if(inSheet) foot = foot.replace(/closeEventPreview\(\);/g, 'closeAppModal();') + (foot.includes('class="btn"') ? '' : `<span class="evp-sp"></span><button class="btn" onclick="closeAppModal()">Close</button>`);
  return `<div class="evp${inSheet ? ' in-sheet' : ''}">
<div class="evp-k"><span class="dot ${col}"></span>${escapeHtml(kind)}</div>
<h3 class="evp-t${tDone ? ' is-done' : ''}" tabindex="-1">${escapeHtml(e.title)}</h3>
<div class="evp-when">${escapeHtml(day)}<br>${escapeHtml(time)}</div>
${rows ? `<div class="evp-rows">${rows}</div>` : ''}
${e.description ? `<p class="evp-d">${escapeHtml(e.description)}</p>` : ''}
${people ? `<div class="evp-ppl">${people}</div>` : ''}
${foot ? `<div class="evp-f">${foot}</div>` : ''}
</div>`;
}
let _evpFor = null;
function evpOutside(ev){
  const p = document.getElementById('evPop'); if(!p || p.contains(ev.target)) return;
  const hit = ev.target.closest && ev.target.closest('[data-id]');
  if(hit && hit.dataset.id === _evpFor) return; // the same event: its click closes it
  closeEventPreview();
}
function evpKey(ev){
  if(ev.key === 'Escape'){ ev.stopPropagation(); ev.preventDefault(); closeEventPreview(); }
  else if((ev.metaKey || ev.ctrlKey) && /^[a-z]$/i.test(ev.key)) closeEventPreview(true); // a shortcut opens something else
}
function evpScroll(ev){ const p = document.getElementById('evPop'); if(p && !p.contains(ev.target)) closeEventPreview(); }
function closeEventPreview(instant){
  document.querySelectorAll('.ev.sel, .mc.sel, .ad.sel').forEach(x => x.classList.remove('sel'));
  document.removeEventListener('mousedown', evpOutside, true); document.removeEventListener('keydown', evpKey, true);
  document.removeEventListener('scroll', evpScroll, true); window.removeEventListener('resize', closeEventPreview);
  const p = document.getElementById('evPop'); _evpFor = null;
  if(!p) return;
  p.removeAttribute('id');
  if(instant || matchMedia('(prefers-reduced-motion: reduce)').matches) return p.remove();
  p.classList.remove('on'); setTimeout(() => p.remove(), 140);
}
function openEventDetailModal(eventId, anchor){
  const e = calendarEvents.find(x => x.id === eventId);
  if(!e) return;
  const evt = window.event;
  if(anchor === undefined && evt && evt.currentTarget instanceof Element) anchor = evt.currentTarget;
  if(!anchor || !anchor.isConnected || anchor.closest('#appModalOverlay')){
    closeEventPreview(true);
    openAppModal(eventPreviewHtml(e, true), 400);
    setTimeout(() => document.querySelector('#appModalOverlay .evp-t')?.focus({ preventScroll: true }), 40);
    return;
  }
  if(_evpFor === eventId){ closeEventPreview(); return; }
  closeEventPreview(true);
  const p = document.createElement('div');
  p.id = 'evPop'; p.className = 'evp-pop'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', e.title);
  p.innerHTML = eventPreviewHtml(e, false);
  document.body.appendChild(p);
  _evpFor = eventId; anchor.classList.add('sel');
  // Beside the event: to its right, or its left when there's no room. A wide event (Day view)
  // uses the spot that was clicked.
  let r = anchor.getBoundingClientRect();
  if(r.width > 360 && evt && typeof evt.clientX === 'number' && evt.clientX) r = { left: evt.clientX - 12, right: evt.clientX + 12, top: r.top, bottom: r.bottom, height: r.height, width: 24 };
  const W = p.offsetWidth, H = p.offsetHeight, vw = window.innerWidth, vh = window.innerHeight, gap = 8;
  let x = r.right + gap, side = 'r';
  if(x + W > vw - 8){ x = r.left - gap - W; side = 'l'; }
  if(x < 8){ x = Math.min(Math.max(8, r.left), vw - W - 8); side = 'b'; }
  let y = side === 'b' ? r.bottom + gap : r.top - 6;
  if(side === 'b' && y + H > vh - 8) y = r.top - gap - H;
  y = Math.min(Math.max(8, y), vh - H - 8);
  p.style.left = Math.round(x) + 'px'; p.style.top = Math.round(y) + 'px';
  p.style.transformOrigin = side === 'r' ? `left ${Math.round(r.top - y + 12)}px` : side === 'l' ? `right ${Math.round(r.top - y + 12)}px` : 'center top';
  requestAnimationFrame(() => p.classList.add('on'));
  setTimeout(() => {
    document.addEventListener('mousedown', evpOutside, true); document.addEventListener('keydown', evpKey, true);
    document.addEventListener('scroll', evpScroll, true); window.addEventListener('resize', closeEventPreview);
  }, 0);
  p.querySelector('.evp-t').focus({ preventScroll: true });
}
function openRequestChangeModal(eventId){
  openAppModal(`<h3>Ask for a Change</h3>
<div class="f"><label class="top" for="changeRequestInput">Message</label><textarea id="changeRequestInput" class="tf" spellcheck="true" placeholder="e.g. Could we move this to 3 PM?"></textarea></div>
<div class="sheet-a"><button class="btn" onclick="closeAppModal()">Cancel</button><button class="btn btn-p" onclick="submitChangeRequest('${eventId}')">Send</button></div>`, 460);
  setTimeout(() => document.getElementById('changeRequestInput')?.focus(), 30);
}

// ---- Timer and time entries -----------------------------------------------------------------
function timeServiceOpts(c, cur, withNone){
  const opts = (settings.serviceOptions || []).slice();
  [c && c.service, cur].forEach(v => { if(v && !opts.includes(v)) opts.unshift(v); });
  return (withNone ? [['', 'No service']] : []).concat(opts.map(v => [v, v]));
}
function timeClientChanged(clientSelId, serviceSelId){
  const c = clients.find(x => x.id === document.getElementById(clientSelId)?.value);
  const sv = document.getElementById(serviceSelId);
  if(!c || !sv || !c.service) return;
  if(![...sv.options].some(o => o.value === c.service)){ const o = document.createElement('option'); o.value = o.textContent = c.service; sv.prepend(o); }
  sv.value = c.service; syncPopSel(sv);
}
function openTimerModal(presetClientId, presetDesc){
  if(timerState.running){ showToast('error', 'A timer is already running', 'Stop it before starting another.'); return; }
  if(!waPresetOk(presetClientId)) return;
  let cid = (typeof presetClientId === 'string' && presetClientId) || (typeof currentViewName !== 'undefined' && currentViewName === 'clientdetail' ? currentDetailClientId : '') || '';
  if(cid && !waCanWork(clients.find(x => x.id === cid))) cid = '';
  const d = hvDefaultPick(cid);
  openAppModal(`<h3>Start Timer</h3>
<div class="f">
${hvRecentHtml('timerModal', 'timerModalClient')}
<label for="timerModalClient">Client</label><div>${sheetPop('timerModalClient', 'Client', sheetClientOptions('', true), cid, "hvPickChanged('timerModal','client')", { placeholder: 'Choose a client' })}</div>
${hvPickBlockHtml('timerModal', cid, d.projectId, d.taskId)}
<label for="timerModalDesc">Working on</label><input id="timerModalDesc" class="tf" placeholder="e.g. Updating the Meta ad creative"${typeof presetDesc === 'string' && presetDesc ? ` value="${escapeHtml(presetDesc)}"` : ''} onkeydown="if(event.key==='Enter') startTimerFromModal()">
</div>
<div class="sheet-a"><button class="btn" onclick="closeAppModal()">Cancel</button><button class="btn btn-p" onclick="startTimerFromModal()">${icon('play')}Start Timer</button></div>`, 520);
  setTimeout(() => document.getElementById(cid ? 'timerModalDesc' : 'timerModalClient')?.focus(), 30);
}
function openManualEntryModal(presetDate, presetMinutes, presetClientId){
  const today = toDateStr(new Date()), day = presetDate && presetDate <= today ? presetDate : today;
  if(!waPresetOk(presetClientId)) return;
  const cid = (typeof presetClientId === 'string' && presetClientId) || '';
  const d = hvDefaultPick(cid);
  openAppModal(`<h3>Add Time</h3>
<div class="f">
${hvRecentHtml('manual', 'manualClient')}
<label for="manualClient">Client</label><div>${sheetPop('manualClient', 'Client', sheetClientOptions('', true), cid, "hvPickChanged('manual','client')", { placeholder: 'Choose a client' })}</div>
${hvPickBlockHtml('manual', cid, d.projectId, d.taskId)}
<label for="manualDate">Date</label><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${sheetDateField('manualDate', day, { past: true, from: -30, to: 0, max: today })}</div>
<label for="manualDuration">Time</label><input id="manualDuration" class="tf" style="width:110px" placeholder="1:30" autocomplete="off"${presetMinutes ? ` value="${hmm(presetMinutes)}"` : ''}>
<label class="top" for="manualDesc">Notes</label><textarea id="manualDesc" class="tf" spellcheck="true" placeholder="What did you work on?"></textarea>
</div>
<div class="sheet-a"><button class="btn" onclick="closeAppModal()">Cancel</button><button class="btn btn-p" onclick="addManualEntry()">Add Time</button></div>`, 520);
}
function openTimeEntryModal(id){
  const e = timeEntries.find(x => x.id === id);
  if(!e) return;
  // invoiced or approved in Harvest: it can't change, there or here
  if(e.harvestLocked){
    const c = clients.find(x => x.id === e.clientId), kv = (k, v) => v ? `<label>${k}</label><div class="hvp-one">${escapeHtml(v)}</div>` : '';
    openAppModal(`<h3>Time</h3>
<div class="f">${kv('Client', c ? c.name : '')}${kv('Project', (e.harvestProjectId && typeof hvProjectName === 'function' && hvProjectName(e.harvestProjectId)) || e.service)}${kv('Task', e.harvestTaskId && typeof hvTaskName === 'function' ? hvTaskName(e.harvestTaskId) : '')}${kv('Date', fmtShortDate(new Date(e.date + 'T12:00:00')))}${kv('Time', hmm(e.minutes))}${kv('Notes', e.description)}</div>
<p class="t-2" style="margin:14px 0 0;font-size:13px;line-height:1.45">Invoiced in Harvest, so it can’t change here.</p>
<div class="sheet-a"><button class="btn btn-p" onclick="closeAppModal()">Done</button></div>`, 460);
    return;
  }
  const c = clients.find(x => x.id === e.clientId);
  const mine = e.userId ? e.userId === currentUser.id : true;
  openAppModal(`<h3>Edit Time</h3>
<div class="f">
<label for="editEntryClient">Client</label><div>${sheetPop('editEntryClient', 'Client', sheetClientOptions(e.clientId, true), e.clientId, "hvPickChanged('editEntry','client')")}</div>
${hvPickBlockHtml('editEntry', e.clientId, e.harvestProjectId || hvDefaultPick(e.clientId).projectId, e.harvestTaskId || null, e.service || '')}
<label for="editEntryDate">Date</label><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${sheetDateField('editEntryDate', e.date, { past: true, from: -30, to: 0 })}</div>
<label for="editEntryDuration">Time</label><input id="editEntryDuration" class="tf" style="width:110px" value="${hmm(e.minutes)}" autocomplete="off">
<label class="top" for="editEntryDesc">Notes</label><textarea id="editEntryDesc" class="tf" spellcheck="true">${escapeHtml(e.description || '')}</textarea>
</div>
<div class="sheet-a">${mine ? `<button class="btn danger" style="margin-right:auto" onclick="closeAppModal();deleteTimeEntry('${id}')">Delete</button>` : ''}<button class="btn" onclick="closeAppModal()">Cancel</button><button class="btn btn-p" onclick="saveTimeEntryEdit('${id}')">Save</button></div>`, 520);
}

// ---- Task detail and completion --------------------------------------------------------------
const TASK_STAGE_LABEL = { todo: 'To Do', in_progress: 'In Progress', in_review: 'Review', done: 'Done' };
function openTaskDetailModal(taskId){
  const t = tasks.find(x => x.id === taskId);
  if(!t) return;
  const me = currentUser.id, amAssigner = t.assignerId === me, amAssignee = t.assigneeId === me;
  const assigner = teamProfiles.find(p => p.id === t.assignerId), assignee = teamProfiles.find(p => p.id === t.assigneeId);
  const c = t.clientId ? clients.find(x => x.id === t.clientId) : null;
  const done = t.status === 'done';
  const overdue = !done && t.dueDate && t.dueDate < toDateStr(new Date());
  const hhmm = typeof taskDueTimes !== 'undefined' ? taskDueTimes[t.id] : '';
  const due = t.dueDate ? new Date(t.dueDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) + (hhmm ? ' at ' + fmtTime(atTime(new Date(t.dueDate + 'T12:00:00'), hhmm)) : '') : '';
  const linked = calendarEvents.find(e => e.relatedTaskId === t.id);
  const wa = typeof waTasks !== 'undefined' ? waTasks.find(x => x.task_id != null && String(x.task_id) === String(t.id)) : null;
  const moves = Object.keys(TASK_STAGE_LABEL).filter(k => k !== t.status && (k !== 'done' || amAssignee)).map(k => [k, TASK_STAGE_LABEL[k]]);
  const kv = (l, v) => `<label>${l}</label><div style="font-size:14px">${v}</div>`;
  openAppModal(`<div class="sheet-meta"><span class="st"><span class="dot ${done ? 'green' : t.status === 'in_review' ? 'purple' : t.status === 'in_progress' ? 'blue' : 'hollow'}"></span>${TASK_STAGE_LABEL[t.status] || 'To Do'}</span>${overdue ? '<span class="t-red">Overdue</span>' : ''}${t.priority === 'high' && !done ? `<span class="st">${icon('flag', { cls: 'flag' })}High priority</span>` : ''}</div>
<h3>${escapeHtml(t.title)}</h3>
${t.description ? `<p class="ev-desc" style="margin-top:-6px">${escapeHtml(t.description)}</p>` : ''}
<div class="f kv-f">
${kv(amAssigner ? 'Assigned to' : 'From', (amAssigner ? assignee : assigner) ? sheetWho((amAssigner ? assignee : assigner).name) : '<span class="t-2">Someone no longer on the team</span>')}
${due ? kv('Due', `<span${overdue ? ' class="t-red"' : ''}>${escapeHtml(due)}</span>`) : ''}
${c ? kv('Client', `<a href="#" onclick="closeAppModal();openClientDetail('${c.id}');return false;">${escapeHtml(c.name)}</a>`) : ''}
${wa ? kv('WhatsApp', `<a href="#" onclick="closeAppModal();waOpenItem(${jsArg(wa.id)});return false;">${escapeHtml(waGroupName(wa) ? waCleanName(waGroupName(wa)) + ' group' : waClientLabel(wa))}</a>${wa.status === 'done' ? '<span class="t-2"> · done</span>' : ''}`) : ''}
${amAssignee && !done && typeof timerState !== 'undefined' && !timerState.running ? kv('Time', `<button class="btn btn-q" style="padding:0 4px;margin-left:-4px" onclick="closeAppModal();openTimerModal(${jsArg(t.clientId || '')},${jsArg(t.title)})">${icon('play')}Start Timer</button>`) : ''}
${t.link ? kv('Link', `<a href="${safeUrl(normalizeUrl(t.link))}" target="_blank" rel="noopener">${escapeHtml(truncateLinkDisplay(t.link, 46))}</a>`) : ''}
${t.dueDate ? kv('Calendar', linked ? `On the calendar · <a href="#" onclick="closeAppModal();switchView('calendar');return false;">View</a>` : `<button class="btn btn-q" style="padding:0 4px;margin-left:-4px" onclick="addTaskToCalendar('${t.id}')">${icon('calendar-plus')}Add to Calendar</button>`) : ''}
${done && t.completedAt ? kv('Done', escapeHtml(new Date(t.completedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }))) : ''}
</div>
${done && (t.completionNotes || t.completionLink) ? `<div class="callout" style="margin-top:14px;flex-direction:column;gap:2px"><b>${escapeHtml(firstName(assignee?.name || 'They'))} said when finishing</b>${t.completionNotes ? `<p style="margin:4px 0 0;white-space:pre-wrap">${escapeHtml(t.completionNotes)}</p>` : ''}${t.completionLink ? `<p style="margin:4px 0 0"><a href="${safeUrl(normalizeUrl(t.completionLink))}" target="_blank" rel="noopener">${escapeHtml(truncateLinkDisplay(t.completionLink, 46))}</a></p>` : ''}</div>` : ''}
<div class="sheet-a">${done
    ? `${hasPermission('delete_tasks') ? `<button class="btn danger" style="margin-right:auto" onclick="deleteTaskPermanently('${t.id}')">Delete</button>` : '<span style="margin-right:auto"></span>'}<button class="btn" onclick="hideTaskFromMyList('${t.id}')">Archive</button><button class="btn btn-p" onclick="closeAppModal()">Done</button>`
    : `${moves.length ? `<span style="margin-right:auto">${sheetPop('tdMove', 'Move to', moves, '', `if(this.value) moveTaskToStatus('${t.id}', this.value)`, { placeholder: 'Move to…' })}</span>` : '<span style="margin-right:auto"></span>'}${amAssigner ? `<button class="btn danger" onclick="cancelTask('${t.id}')">Cancel Task</button><button class="btn${amAssignee ? '' : ' btn-p'}" onclick="openEditTaskModal('${t.id}')">Edit</button>` : ''}${amAssignee ? `<button class="btn btn-p" onclick="moveTaskToStatus('${t.id}','done')">${icon('check')}Mark Done</button>` : (amAssigner ? '' : `<button class="btn btn-p" onclick="closeAppModal()">Close</button>`)}`}</div>`, 520);
  sheetFocusPrimary();
}
// Mark Done: when it was finished and how long it took. The time goes into Time on that day,
// for the task's client (and Harvest project and task, when Harvest is on).
function completeTaskModalHtml(taskId){
  const t = tasks.find(x => x.id === taskId);
  if(!t) return '';
  const today = toDateStr(new Date()), c = t.clientId ? clients.find(x => x.id === t.clientId) : null;
  const canLog = !c || (typeof waCanWork !== 'function' || waCanWork(c));
  const d = c && typeof hvDefaultPick === 'function' ? hvDefaultPick(c.id) : { projectId: null, taskId: null };
  const who = firstName(teamProfiles.find(p => p.id === t.assignerId)?.name || 'they');
  openAppModal(`<h3>Mark Done</h3>
<p class="t-2" style="margin:-8px 0 14px;font-size:14px">${escapeHtml(t.title)}</p>
<div class="f">
<label for="taskDoneDate">Finished</label><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${sheetDateField('taskDoneDate', today, { past: true, from: -14, to: 0, max: today })}</div>
${canLog ? `<label for="taskDoneTime">Time spent</label><div class="td-dur"><input id="taskDoneTime" class="tf" style="width:96px" placeholder="1:30" autocomplete="off" oninput="taskDoneTimeTyped()"><span class="t-2">Optional. It goes into Time on that day.</span></div>
<div id="tdTime" class="td-time">${c ? `<input type="hidden" id="tdClient" value="${c.id}">` : `<label for="tdClient">Client</label><div>${sheetPop('tdClient', 'Client', sheetClientOptions('', true), '', "hvPickChanged('td','client')", { placeholder: 'Choose a client' })}</div>`}${typeof hvPickBlockHtml === 'function' ? hvPickBlockHtml('td', c ? c.id : '', d.projectId, d.taskId) : ''}</div>` : ''}
<label class="top" for="taskCompletionNotes">Notes</label><textarea id="taskCompletionNotes" class="tf" spellcheck="true" placeholder="Anything ${escapeHtml(who)} should know: what you found, what’s left">${escapeHtml(t.completionNotes || '')}</textarea>
<label for="taskCompletionLink">Link</label><input id="taskCompletionLink" class="tf" value="${escapeHtml(t.completionLink || '')}" placeholder="A doc, a page you built, a file">
</div>
<div class="sheet-a"><button class="btn" onclick="closeAppModal()">Cancel</button><button class="btn btn-p" id="taskCompletionConfirmBtn" onclick="confirmTaskCompletion('${taskId}')">Mark Done</button></div>`, 520);
  setTimeout(() => document.getElementById('taskDoneTime')?.focus(), 30);
}
// The client and Harvest rows only matter once there's time to log.
function taskDoneTimeTyped(){
  const on = !!(document.getElementById('taskDoneTime')?.value || '').trim();
  document.getElementById('tdTime')?.classList.toggle('on', on);
}

// ---- Client form ----------------------------------------------------------------------------
function customFieldInputHtml(field, value){
  const val = value != null ? String(value) : '';
  const id = 'ncCustom_' + field.id;
  const label = `<label${field.type === 'textarea' ? ' class="top"' : ''} for="${id}">${escapeHtml(field.label)}${field.required ? '<span class="t-red"> *</span>' : ''}</label>`;
  if(field.type === 'select') return label + `<div>${sheetPop(id, field.label, [['', 'None'], ...(field.options || []).map(o => [o, o])], val)}</div>`;
  if(field.type === 'textarea') return label + `<textarea id="${id}" class="tf" spellcheck="true">${escapeHtml(val)}</textarea>`;
  const type = { text: 'text', url: 'url', email: 'email', phone: 'tel', number: 'number' }[field.type] || 'text';
  return label + `<input type="${type}" id="${id}" class="tf" value="${escapeHtml(val)}">`;
}
// Everyone on the team, for the Owner picker (plus a removed owner it still has, so it isn't lost).
function clientFormPeople(c){
  const names = (typeof teamProfiles !== 'undefined' ? teamProfiles : []).filter(p => p.name && !p.access_revoked).map(p => p.name);
  const cur = c && c.customFieldValues && c.customFieldValues.owner;
  return [...new Set(names.concat(cur ? [cur] : []))].sort((a, b) => a.localeCompare(b));
}
function clientFormHtml(title, submitLabel, customValues, c){
  const opt = list => (list || []).map(o => [o, o]);
  // a client in Harvest buys its Harvest projects: shown here, changed there (harvest-time.js)
  const hvSvc = c && typeof serviceFromHarvest === 'function' && serviceFromHarvest(c), parts = hvSvc ? serviceParts(c) : [];
  const service = hvSvc
    ? `<label>Projects</label><div class="nc-ro"><span${parts.length ? '' : ' class="t-3"'}>${parts.length ? parts.map(escapeHtml).join(' · ') : 'None in Harvest yet'}</span><span class="t-2">From Harvest. Change them there.</span><input type="hidden" id="ncService" value="${escapeHtml(c.service || '')}"></div>`
    : `<label for="ncService">Service</label><div>${sheetPop('ncService', 'Service', opt(settings.serviceOptions), (settings.serviceOptions || [])[0] || '')}</div>`;
  return `<h3>${escapeHtml(title === 'Add client' ? 'New Client' : title === 'Edit client' ? 'Edit Client' : title)}</h3>
<div class="f">
<label for="ncName">Name</label><div><input id="ncName" class="tf" placeholder="e.g. Premium Homes" oninput="checkDuplicateClientName()"><div id="ncNameWarning" class="t-red" style="display:none;font-size:13px;margin-top:5px"></div></div>
<label class="top" for="ncContact">Main contact</label><div><input id="ncContact" class="tf" placeholder="e.g. Mike Johnson" autocomplete="off"><div class="t-2" style="font-size:13px;margin-top:5px">Wins and updates greet them by first name.</div></div>
<label for="ncWebsite">Website</label><input id="ncWebsite" class="tf" placeholder="https://client.com">
<label class="top" for="ncEmail">Email</label><div><input id="ncEmail" class="tf" placeholder="contact@client.com, billing@client.com"><div class="t-2" style="font-size:13px;margin-top:5px">Separate addresses with commas. Updates go to everyone listed.</div></div>
${service}
<label for="ncStatus">Status</label><div>${sheetPop('ncStatus', 'Status', opt(settings.statusOptions), (settings.statusOptions || [])[0] || '')}</div>
<label for="ncOwner">Owner</label><div style="display:flex;gap:10px;align-items:center"><span style="flex:none">${sheetPop('ncOwner', 'Owner', [['', 'Automatic']].concat(clientFormPeople(c).map(p => [p, p])), (customValues || {}).owner || '')}</span><span class="t-2" style="font-size:13px">Automatic: who logs the most work</span></div>
<label for="ncWeekly">Weekly update</label><div style="display:flex;gap:10px;align-items:center"><span style="flex:none">${sheetPop('ncWeekly', 'Weekly update', [['on', 'Every week'], ['off', 'No weekly update']], (customValues || {}).weeklyUpdate === 'off' ? 'off' : 'on')}</span><span class="t-2" style="font-size:13px">Off for the agency or an internal client</span></div>
<label for="ncImportance">Importance</label><div style="display:flex;gap:10px;align-items:center">${sheetPop('ncImportance', 'Importance', Array.from({ length: 10 }, (_, i) => [String(i + 1), `${i + 1} of 10`]), '5')}<span class="t-2" style="font-size:13px">How much this client matters to the agency</span></div>
<label for="ncDanger">Risk</label><div><div style="display:flex;gap:10px;align-items:center">${sheetPop('ncDanger', 'Risk', [['1', '1 · Low'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5 · High']], '1')}<span class="t-2" style="font-size:13px">Your read on how likely they are to leave</span></div><div id="ncDangerNudge" class="t-2" style="display:none;font-size:13px;margin-top:5px"></div></div>
<label for="ncBudget">Hours a month</label><div style="display:flex;gap:10px;align-items:center"><input type="number" id="ncBudget" class="tf" style="width:90px" min="0" step="0.5" placeholder="20"><span class="t-2" style="font-size:13px">Leave empty if there’s no budget</span></div>
<label for="ncStartDate">Client since</label><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${sheetDateField('ncStartDate', '', { none: 'Not set', past: true, from: -14, to: 0, max: toDateStr(new Date()) })}</div>
<label class="top" for="ncSow">Scope</label><textarea id="ncSow" class="tf" spellcheck="true" placeholder="What the agency does for them, in a line or two"></textarea>
${customFieldsFormHtml(customValues)}
</div>
<div class="sheet-a"><button class="btn" onclick="closeClientForm()">Cancel</button><button class="btn btn-p" id="clientFormSubmitBtn" onclick="saveClientForm()">${submitLabel === 'Save client' ? 'Create Client' : 'Save'}</button></div>`;
}
function sheetSetSelect(id, value){
  const sel = document.getElementById(id); if(!sel) return;
  const v = value == null ? '' : String(value);
  if(v && sel.id === 'ncStartDate'){ sheetOtherDate(id, v); return; }
  if(v && ![...sel.options].some(o => o.value === v)){ const o = document.createElement('option'); o.value = v; o.textContent = v + (id === 'ncService' || id === 'ncStatus' ? ' (no longer listed)' : ''); sel.insertBefore(o, sel.firstChild); }
  sel.value = v; syncPopSel(sel);
}
function openAddClientForm(){
  if(!canApprove()){ showToast('error', 'Not allowed', 'Only admins and approvers can add clients.'); return; }
  // with Harvest connected, clients start there and come in on their own (client-setup.js)
  if(typeof harvestOwnsClients === 'function' && harvestOwnsClients()){ openAddInHarvestSheet(); return; }
  editingClientId = null;
  openAppModal(clientFormHtml('Add client', 'Save client'), 560);
  setTimeout(() => document.getElementById('ncName')?.focus(), 30);
}
function openEditClientForm(id){
  if(!canApprove()){ showToast('error', 'Not allowed', 'Only admins and approvers can edit clients.'); return; }
  const c = clients.find(x => x.id === id);
  if(!c){ showToast('error', 'Client not found', 'Someone may have removed it. Refreshing.'); fullRefresh(); return; }
  editingClientId = id;
  openAppModal(clientFormHtml('Edit client', 'Save changes', c.customFieldValues, c), 560);
  const g = k => document.getElementById(k);
  g('ncName').value = c.name; g('ncEmail').value = c.email || ''; g('ncWebsite').value = c.website || '';
  g('ncContact').value = clientContact(c);
  g('ncBudget').value = c.monthlyHourBudget || ''; g('ncSow').value = c.sow || '';
  // monthly hours that come from Harvest's budget are changed there (step 4)
  const hvB = typeof hvClientBudget === 'function' ? hvClientBudget(id) : 0;
  if(hvB){ g('ncBudget').value = hvB; g('ncBudget').disabled = true; const n = g('ncBudget').nextElementSibling; if(n) n.textContent = 'From Harvest’s monthly budget. Change it there.'; }
  if(g('ncService').tagName === 'SELECT') sheetSetSelect('ncService', c.service);
  sheetSetSelect('ncStatus', c.status);
  sheetSetSelect('ncImportance', c.importance); sheetSetSelect('ncDanger', c.danger);
  if(c.startDate) sheetSetSelect('ncStartDate', c.startDate);
  const suggested = computeSuggestedDanger(c), nudge = g('ncDangerNudge');
  if(nudge && suggested !== null && suggested > c.danger){
    nudge.style.display = 'block';
    nudge.textContent = `Overdue follow-ups, quiet weeks and waiting drafts suggest ${suggested}. Worth a second look.`;
  }
}

// ---- Send Email: the last look before a client email goes out ----------------------------------
function showSendEmailConfirm(to, subject, body, onSent, includeSignature){
  _emailSentCallback = onSent || null;
  _emailIncludeSignature = !!includeSignature;
  openAppModal(`<h3>Send Email</h3>
<div class="f">
<label>To</label><div style="font-size:14px;padding:4px 0">${escapeHtml(to)}<input type="hidden" id="mailModalTo" value="${escapeHtml(to)}"></div>
<label for="mailModalSubject">Subject</label><input id="mailModalSubject" class="tf">
<label class="top" for="mailModalBody">Message</label><textarea id="mailModalBody" class="tf" spellcheck="true" style="height:280px"></textarea>
<span></span><div class="t-2" style="font-size:13px;line-height:1.45">${includeSignature ? 'Goes out from the app with your signature as soon as you click Send.' : 'Goes out from the app as soon as you click Send.'}</div>
</div>
<div class="sheet-a"><button class="link-btn" id="mailModalCopyBtn" style="margin-right:auto" onclick="copyMailModalBody()">Copy Email</button><button class="btn" onclick="closeAppModal()">Cancel</button><button class="btn btn-p" id="sendEmailConfirmBtn" onclick="confirmSendEmail()">${icon('paper-plane-tilt')}Send</button></div>`, 600);
  document.getElementById('mailModalSubject').value = subject;
  document.getElementById('mailModalBody').value = body;
  sheetFocusPrimary();
}
async function confirmSendEmail(){
  const to = document.getElementById('mailModalTo').value;
  const subject = document.getElementById('mailModalSubject').value;
  const body = document.getElementById('mailModalBody').value;
  const btn = document.getElementById('sendEmailConfirmBtn');
  setBtnLoading(btn, 'Sending…');
  try{
    const response = await fetch('/api/send-email', { method: 'POST', headers: await apiAuthHeaders(), body: JSON.stringify({ to, subject, body, includeSignature: _emailIncludeSignature }) });
    const data = await response.json().catch(() => ({}));
    restoreBtn(btn);
    if(!response.ok){ showToast('error', 'The email didn’t go out', (data.error || 'The mail service said no.') + ' Try again, or copy it and send it from your mail app.'); return; }
    closeAppModal();
    showToast('success', 'Email sent', `To ${to}.`);
    notifyOthersOfEmailSent(to, subject);
    _emailIncludeSignature = false;
    if(_emailSentCallback){ const cb = _emailSentCallback; _emailSentCallback = null; cb(); }
  }catch(e){
    restoreBtn(btn);
    showToast('error', 'The email didn’t go out', 'Check your connection and try again, or copy it and send it from your mail app.');
  }
}
async function copyMailModalBody(){
  const btn = document.getElementById('mailModalCopyBtn');
  const full = `Subject: ${document.getElementById('mailModalSubject').value}\n\n${document.getElementById('mailModalBody').value}`;
  try{ await navigator.clipboard.writeText(full); btn.textContent = 'Copied'; }
  catch(e){ const ta = document.getElementById('mailModalBody'); ta.focus(); ta.select(); btn.textContent = 'Press ⌘C to copy'; }
  setTimeout(() => { if(btn.isConnected) btn.textContent = 'Copy Email'; }, 2000);
}
