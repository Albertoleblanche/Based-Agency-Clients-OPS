// ⌘K, as on the Spotlight board: type a client and get the client, what you can do for it
// (its draft, time, a task), its open tasks, matching notes and screens. Arrow keys move,
// Return opens, Escape closes (handled in navigation.js).

function spotNorm(s){ return String(s || '').toLowerCase(); }
function spotDraftAction(c){
  const w = clientWeek(c), me = myName();
  if(w.sent) return null;
  if(w.draft) return { icon: 'envelope-open', title: `Open this week’s draft for ${c.name}`, run: () => canApprove() ? openReviewDraft(c.id, w.draft.author) : (window._weekSel = c.id, switchView('approve')) };
  if(w.logged.length){
    const author = w.logged.find(i => i.author === me) ? me : (canApprove() ? (w.owner || w.logged[0].author) : me);
    return { icon: 'note-pencil', title: `Start this week’s draft for ${c.name}`, run: () => generateDraft(c.id, author) };
  }
  return { icon: 'note-pencil', title: `Log an improvement for ${c.name}`, run: () => openQueueLogImprovementModal(c.id) };
}
function getCommandPaletteIndex(query){
  const q = spotNorm(query).trim();
  const navLabel = k => (settings.navLabels && settings.navLabels[k]) || (VIEW_TITLES[k] || [k])[0];
  const screens = [...document.querySelectorAll('.nav-item[data-view]')].filter(n => getComputedStyle(n).display !== 'none')
    .map(n => n.dataset.view).filter((v, i, a) => a.indexOf(v) === i && (VIEW_TITLES[v] || v === 'overview'))
    .map(k => { const n = document.querySelector(`.nav-item[data-view="${k}"]`); return { group: 'Go to', svg: n?.querySelector('svg')?.outerHTML || '', title: n?.querySelector('.nav-label')?.textContent.trim() || navLabel(k), kbd: typeof shortcutLabelForView === 'function' ? shortcutLabelForView(k) : '', run: () => switchView(k) }; });
  if(!q){
    return [
      { group: 'Create', icon: 'note-pencil', title: 'Log Improvement', kbd: (typeof MOD_LABEL !== 'undefined' ? MOD_LABEL : '⌘') + 'N', run: () => openQueueLogImprovementModal() },
      { group: 'Create', icon: 'list-checks', title: 'New Task', run: () => openNewTaskModal() },
      { group: 'Create', icon: 'route', title: 'New Sprint', run: () => openNewSprintModal() },
      { group: 'Create', icon: 'timer', title: timerState.running ? 'Stop the Timer' : 'Start a Timer', run: () => timerState.running ? stopAndSaveTimer() : openTimerModal() },
      ...screens.slice(0, 9)
    ];
  }
  const out = [];
  const cl = activeClients().filter(c => spotNorm(c.name).includes(q) || spotNorm(c.service).includes(q))
    .sort((a, b) => (spotNorm(b.name).startsWith(q) - spotNorm(a.name).startsWith(q)) || a.name.localeCompare(b.name)).slice(0, 5);
  cl.forEach(c => { const o = clientOwner(c); out.push({ group: 'Clients', icon: 'buildings', title: c.name, sub: [c.service, o].filter(Boolean).join(' · '), run: () => openClientDetail(c.id) }); });
  const top = cl[0];
  if(top){
    const d = spotDraftAction(top); if(d) out.push({ group: 'Actions', ...d });
    out.push({ group: 'Actions', icon: 'timer', title: `Start a timer for ${top.name}`, run: () => openTimerModal(top.id) });
    out.push({ group: 'Actions', icon: 'clock', title: `Add time worked for ${top.name}`, run: () => { openManualEntryModal(); setTimeout(() => { const s = document.getElementById('manualClient'); if(s){ s.value = top.id; syncPopSel?.(s); timeClientChanged?.('manualClient', 'manualService'); } }, 30); } });
    out.push({ group: 'Actions', icon: 'plus', title: `New task for ${top.name}`, run: () => openNewTaskModal(undefined, 'todo', { clientId: top.id }) });
  }
  const today = toDateStr(new Date()), me = currentUser?.id;
  (typeof tasks !== 'undefined' ? tasks : []).filter(t => !t.cancelledAt && t.status !== 'done' && (t.assigneeId === me || t.assignerId === me) && (spotNorm(t.title).includes(q) || (top && t.clientId === top.id)))
    .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999')).slice(0, 4)
    .forEach(t => out.push({ group: 'Tasks', icon: 'list-checks', title: t.title, sub: t.dueDate && t.dueDate < today ? '' : (TASK_STAGE_LABEL[t.status] || ''), red: t.dueDate && t.dueDate < today ? 'Overdue' : '', run: () => openTaskDetailModal(t.id) }));
  (typeof notes !== 'undefined' ? notes : []).filter(n => spotNorm(n.title).includes(q) || spotNorm(n.text).includes(q)).slice(0, 3)
    .forEach(n => { const c = clients.find(x => x.id === n.clientId); out.push({ group: 'Notes', icon: 'notepad', title: n.title || 'Untitled note', sub: c ? c.name : '', run: () => { switchView('notes'); if(typeof selectNote === 'function') selectNote(n.id); } }); });
  if(!top && ['add time', 'time worked', 'manual', 'hours'].some(w => w.includes(q) || q.includes(w))) out.push({ group: 'Create', icon: 'clock', title: 'Add Time Worked', run: () => openManualEntryModal() });
  screens.filter(s => spotNorm(s.title).includes(q)).forEach(s => out.push(s));
  return out;
}
function renderCommandPaletteResults(){
  const input = document.getElementById('cmdkInput'), el = document.getElementById('cmdkResults');
  if(!input || !el) return;
  cmdkCurrentResults = getCommandPaletteIndex(input.value);
  cmdkActiveIndex = 0;
  const ic = document.querySelector('#cmdkOverlay .spot-ic'); if(ic && !ic.innerHTML) ic.innerHTML = icon('magnifying-glass');
  const jump = document.querySelector('#cmdkOverlay .spot-jump'); if(jump) jump.textContent = `${typeof MOD_LABEL !== 'undefined' ? MOD_LABEL : '⌘'}1 – ${typeof MOD_LABEL !== 'undefined' ? MOD_LABEL : '⌘'}9 jump to a section`;
  if(!cmdkCurrentResults.length){ el.innerHTML = `<div class="spot-empty">Nothing matches “${escapeHtml(input.value.trim())}”.</div>`; return; }
  let html = '', last = '';
  cmdkCurrentResults.forEach((r, i) => {
    if(r.group !== last){ html += `<h4>${escapeHtml(r.group)}</h4>`; last = r.group; }
    html += cmdkItemHtml(r, i);
  });
  el.innerHTML = html;
}
function cmdkItemHtml(r, i){
  const on = i === cmdkActiveIndex;
  const ic = r.icon ? icon(r.icon) : (r.svg || icon('caret-right'));
  return `<a class="spot-r${on ? ' on' : ''}" href="#" role="option" aria-selected="${on}" data-idx="${i}" onmousemove="if(cmdkActiveIndex!==${i}){cmdkActiveIndex=${i};cmdkRefreshActiveHighlight();}" onclick="activateCommandPaletteItem(${i});return false;">${ic}<span class="spot-t">${escapeHtml(r.title)}</span>${r.sub ? `<span class="s">${escapeHtml(r.sub)}</span>` : ''}${r.red ? `<span class="s t-red">${escapeHtml(r.red)}</span>` : ''}${r.kbd ? `<span class="kbd">${escapeHtml(r.kbd)}</span>` : (on ? '<span class="kbd">↩</span>' : '')}</a>`;
}
function cmdkRefreshActiveHighlight(){
  document.querySelectorAll('#cmdkResults .spot-r').forEach(el => {
    const on = Number(el.dataset.idx) === cmdkActiveIndex;
    el.classList.toggle('on', on); el.setAttribute('aria-selected', on);
    const r = cmdkCurrentResults[Number(el.dataset.idx)];
    if(r && !r.kbd){ const k = el.querySelector('.kbd'); if(on && !k) el.insertAdjacentHTML('beforeend', '<span class="kbd">↩</span>'); if(!on && k) k.remove(); }
  });
  document.querySelector(`#cmdkResults .spot-r[data-idx="${cmdkActiveIndex}"]`)?.scrollIntoView({ block: 'nearest' });
}
function activateCommandPaletteItem(i){
  const r = cmdkCurrentResults[i];
  if(!r) return;
  closeCommandPalette();
  r.run();
}

// ---- The bell: notifications as a menu of rows ------------------------------------------------
const NOTIF_ICON = { draft_ready: 'envelope-open', draft_approved: 'check-circle', draft_sent: 'paper-plane-tilt', task_assigned: 'list-checks', task_edited: 'list-checks',
  task_completed: 'check-circle', event_invited: 'calendar-blank', event_updated: 'calendar-blank', event_cancelled: 'calendar-blank', event_rsvp: 'calendar-blank',
  reminder_due: 'bell', weekly_focus_report: 'clipboard-text', health: 'heartbeat', mention: 'note-pencil' };
function notifWhen(iso){
  const d = new Date(iso), mins = Math.round((Date.now() - d) / 60000);
  if(mins < 1) return 'Just now';
  if(mins < 60) return `${mins} min ago`;
  const k = daysBetween(d, new Date());
  if(k === 0) return fmtTime(d);
  if(k === 1) return 'Yesterday';
  return k < 7 ? fmtDay(d) : fmtShortDate(d);
}
function renderNotifPanel(){
  const el = document.getElementById('notifPanelList');
  if(!el) return;
  const head = document.querySelector('#notifPanel .notif-panel-head span');
  if(head) head.style.display = notifications.length ? '' : 'none';
  if(!notifications.length){ el.innerHTML = '<div class="notif-empty">You’re all caught up.</div>'; return; }
  el.innerHTML = notifications.map(n => `<div class="nrow${n.read ? '' : ' unread'}" role="button" tabindex="0" onclick="handleNotifClick('${n.id}')" onkeydown="if(event.key==='Enter') handleNotifClick('${n.id}')">
<span class="nrow-ic">${icon(NOTIF_ICON[n.type] || 'bell')}</span>
<div class="nrow-tx"><b>${sanitizeInlineHtml(n.title)}</b>${n.body ? `<span>${sanitizeInlineHtml(n.body)}</span>` : ''}</div>
<div class="nrow-r"><time>${notifWhen(n.created_at)}</time><span class="nrow-act">${n.read ? '' : '<i class="nrow-dot" aria-label="Unread"></i>'}<button class="ib" aria-label="Delete" onclick="event.stopPropagation();deleteNotification('${n.id}')">${icon('x')}</button></span></div></div>`).join('');
}
