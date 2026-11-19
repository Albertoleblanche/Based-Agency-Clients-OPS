// The window around every screen, as on the canvas: toolbar title and subtitle, the
// screen's own toolbar buttons, the New menu (⌘N), and the window shortcuts
// (⌘[ / ⌘] back and forward).

// Short client names for tight spots (the toolbar timer, chips): "Cedar & Stone Builders" → "Cedar & Stone".
function shortClientName(name){
  return String(name || '').replace(/\s+(Builders|Co\.?|Company|LLC|Inc\.?|Homes|Remodeling|Construction)$/i, '').trim();
}

// Title + subtitle in the toolbar. Screens with a live subtitle (counts, dates) call this
// from their own render; switchView() sets the static ones from VIEW_TITLES.
function setToolbar(title, sub){
  const t = document.getElementById('topbarTitle'), s = document.getElementById('topbarSub');
  if(t && title != null) t.textContent = title;
  if(s && sub != null) s.textContent = sub;
}

// The screen's own toolbar buttons, between the title and the timer (canvas: Group & Send on
// This Week, Log Improvement on a client page, the Time tabs on Time).
const VIEW_TOOLBAR_ACTIONS = {
  approve: () => (typeof weekSegHtml === 'function' ? weekSegHtml() : '') + `<button class="btn" onclick="openGroupAndSendModal()">${icon('layers')}Group &amp; Send</button>`,
  clientdetail: () => typeof waCanWork === 'function' && !waCanWork(clients.find(x => x.id === currentDetailClientId)) ? '' : `<button class="btn" onclick="openQueueLogImprovementModal(currentDetailClientId)">${icon('plus')}Log Improvement</button>`,
  time: () => (typeof timeToolbarTabsHtml === 'function' ? timeToolbarTabsHtml() : '') + `<button class="btn" onclick="openTimerModal()">${icon('timer')}Start Timer</button>`,
};
function setToolbarActions(view){
  const el = document.getElementById('tbActions');
  if(!el) return;
  const fn = VIEW_TOOLBAR_ACTIONS[view];
  el.innerHTML = fn ? fn() : '';
}

// ---- New menu (⌘N): one place to create anything ------------------------------------
function newMenuItems(){
  const items = [
    ['Log Improvement', 'square-pen', "openQueueLogImprovementModal()", '⌘N'],
    ['Task', 'list-checks', "openNewTaskModal()"],
    ['Sprint', 'route', "openNewSprintModal()"],
    ['Reminder', 'bell-ring', "openNewReminderModal()"],
    ['Note', 'sticky-note', "openNoteModal()"],
    ['Event', 'calendar-plus', "openNewEventModal()"],
    ['Start Timer', 'timer', "openTimerModal()"],
    ['Time Worked', 'clock', "openManualEntryModal()"],
  ];
  if(typeof canApprove === 'function' && canApprove()) items.push(['Client', 'building-2', "openAddClientForm()"]);
  return items;
}
function toggleNewMenu(){
  const m = document.getElementById('newMenu');
  if(!m) return;
  if(m.style.display === 'block'){ closeNewMenu(); return; }
  m.innerHTML = '<div class="mh">New</div>' + newMenuItems().map(([label, ic, fn, kbd, note]) =>
    `<button class="mi" role="menuitem" onclick="closeNewMenu(); ${fn}">${icon(ic)}<span>${label}</span>${kbd ? `<span class="kbd">${kbd}</span>` : ''}${note ? `<span class="mi-note">${note}</span>` : ''}</button>`).join('');
  m.style.display = 'block';
}
function closeNewMenu(){ const m = document.getElementById('newMenu'); if(m && m.style.display === 'block') typeof hidePop === 'function' ? hidePop(m) : (m.style.display = 'none'); }
document.addEventListener('click', e => { if(!e.target.closest('.new-wrap')) closeNewMenu(); });

document.addEventListener('keydown', e => {
  if(typeof currentUser === 'undefined' || !currentUser) return;
  const mod = (typeof isModifierShortcut === 'function') ? isModifierShortcut(e) : (e.metaKey || e.ctrlKey);
  if(e.key === 'Escape'){ closeNewMenu(); return; }
  if(!mod || e.altKey) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable;
  const k = e.key.toLowerCase();
  if(k === 'n' && !e.shiftKey){ e.preventDefault(); closeAppModal(); openQueueLogImprovementModal(); }
  else if(e.key === '[' && !typing){ e.preventDefault(); history.back(); }
  else if(e.key === ']' && !typing){ e.preventDefault(); history.forward(); }
});

// Jump to a client on a screen (defined fully by each screen; safe defaults here).
function openWeekClient(id){ window._weekSel = id; switchView('approve'); if(typeof renderThisWeek === 'function') renderThisWeek(); }
function openHealthClient(id){ window._healthSel = id; switchView('health'); if(typeof renderHealth === 'function') renderHealth(); }
// Opens a draft in Review on the tab it's on. A draft that isn't in Review yet (still being
// written, or someone else's that hasn't been sent for review) opens on This Week instead.
function openReviewDraft(clientId, author){
  const c = clients.find(x => x.id === clientId), d = (c && c.drafts || []).find(x => x.author === author);
  const listed = typeof reviewItems === 'function' && Object.values(reviewItems()).some(l => l.some(x => x.c.id === clientId && x.d.author === author));
  if(!listed || (typeof hasPermission === 'function' && !hasPermission('view_team_queue'))){ openWeekClient(clientId); return; }
  if(typeof reviewTab !== 'undefined' && d) reviewTab = d.draftSentAt ? 'sent' : d.draftStatus === 'approved' ? 'approved' : 'waiting';
  window._reviewSel = { clientId, author }; window._reviewEditing = null;
  switchView('teamqueue');
}

// Sidebar counts as on the canvas: All Clients (roster size), Health (needs attention),
// Review (drafts waiting, bold), Tasks and Reminders (yours). Zero hides the count.
function updateShellBadges(){
  const set = (id, n) => { const el = document.getElementById(id); if(!el) return; el.textContent = n; el.style.display = Number(n) ? '' : 'none'; };
  if(typeof attentionEligibleClients === 'function'){
    const list = attentionEligibleClients();
    set('navClientsBadge', liveClients().length);
    set('navHealthBadge', (typeof healthScopeClients === 'function' ? healthScopeClients() : list).filter(c => clientHealth(c).level !== 'g').length);
  }
  ['navTeamPendingBadge', 'navTasksBadge', 'navRemindersBadge', 'navTeamBadge'].forEach(id => {
    const el = document.getElementById(id); if(el) el.style.display = Number(el.textContent) ? '' : 'none';
  });
}
ICON_PATHS['arrow-down'] = '<path d="M12 5v14" /> <path d="m19 12-7 7-7-7" />';
ICON_PATHS['exclamation-mark'] = '<line x1="12" y1="5" x2="12" y2="13.5"/><line x1="12" y1="18.5" x2="12" y2="18.51"/>';
VIEW_TOOLBAR_ACTIONS.reminders = () => `<button class="btn" onclick="openNewReminderModal()">${icon('plus')}New Reminder</button>`;
VIEW_TOOLBAR_ACTIONS.tasks = () => `<button class="btn" onclick="openNewTaskModal()">${icon('plus')}New Task</button>`;
VIEW_TOOLBAR_ACTIONS.plan = () => `<button class="btn" onclick="openNewSprintModal()">${icon('plus')}New Sprint</button>`;
VIEW_TOOLBAR_ACTIONS.notes = () => `<button class="btn" onclick="openNoteModal()">${icon('sticky-note')}New Note</button>`;

// Brand marks (Google, Slack) come from Phosphor on the canvas, drawn on a 256 grid.
const BRAND_ICONS = {
  'google-logo': '<path d="M224,128a96,96,0,1,1-21.95-61.09,8,8,0,1,1-12.33,10.18A80,80,0,1,0,207.6,136H128a8,8,0,0,1,0-16h88A8,8,0,0,1,224,128Z"/>',
  'slack-logo': '<path d="M221.13,128A32,32,0,0,0,184,76.31V56a32,32,0,0,0-56-21.13A32,32,0,0,0,76.31,72H56a32,32,0,0,0-21.13,56A32,32,0,0,0,72,179.69V200a32,32,0,0,0,56,21.13A32,32,0,0,0,179.69,184H200a32,32,0,0,0,21.13-56ZM72,152a16,16,0,1,1-16-16H72Zm48,48a16,16,0,0,1-32,0V152a16,16,0,0,1,16-16h16Zm0-80H56a16,16,0,0,1,0-32h48a16,16,0,0,1,16,16Zm0-48H104a16,16,0,1,1,16-16Zm16-16a16,16,0,0,1,32,0v48a16,16,0,0,1-16,16H136Zm16,160a16,16,0,0,1-16-16V184h16a16,16,0,0,1,0,32Zm48-48H152a16,16,0,0,1-16-16V136h64a16,16,0,0,1,0,32Zm0-48H184V104a16,16,0,1,1,16,16Z"/>',
};
icon = (function(base){
  return function(name, o){
    if(!BRAND_ICONS[name]) return base(name, o);
    o = o || {};
    const size = o.size ? ` width="${o.size}" height="${o.size}"` : '';
    return `<svg${o.cls ? ` class="${o.cls}"` : ''}${size} viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round" ${o.label ? `role="img" aria-label="${o.label}"` : 'aria-hidden="true"'}>${BRAND_ICONS[name]}</svg>`;
  };
})(icon);

// Lucide icons used by the rebuild that the generated set doesn't carry.
ICON_PATHS['pin'] = '<path d="M12 17v5" /> <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />';

// The panel on the right closes when you click outside it, the same as its ×. Clicking another row
// switches to that item instead (the page redraws, so the old panel is gone by the time the click
// lands), and clicks in menus, sheets, popovers, form fields or while selecting text leave it open.
(function(){
  let panel = null, from = null;
  document.addEventListener('mousedown', e => {
    const p = document.querySelector('.view.active .spw > aside.sp');
    panel = p && !p.contains(e.target) ? p : null; from = e.target;
  }, true);
  document.addEventListener('click', e => {
    const p = panel; panel = null;
    if(!p || !p.isConnected || e.button !== 0) return;
    const t = e.target;
    if(!t || !t.isConnected || p.contains(t) || t !== from && !(from && from.isConnected && from.contains(t))) return;
    if(t.closest('input, select, textarea, label, [contenteditable="true"], .menu, [role="menu"], [role="dialog"], [role="alertdialog"], .wn-pop-card, .modal-overlay, #appModalOverlay, .sheet-overlay, .cmdk-overlay, .toast, #toasts')) return;
    if(String(window.getSelection ? window.getSelection() : '').trim()) return;
    p.querySelector('.sp-bar [aria-label="Close"]')?.click();
  });
})();
