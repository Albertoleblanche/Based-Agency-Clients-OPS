// The window around every screen, as on the canvas: toolbar title and subtitle, the
// screen's own toolbar buttons, the New menu (⌘N), and the window shortcuts
// (⌘J Assistant, ⌘[ / ⌘] back and forward).

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
  approve: () => `<button class="btn" onclick="openGroupAndSendModal()">${icon('layers')}Group &amp; Send</button>`,
  clientdetail: () => `<button class="btn" onclick="openQueueLogImprovementModal(currentDetailClientId)">${icon('plus')}Log Improvement</button>`,
  time: () => (typeof timeToolbarTabsHtml === 'function' ? timeToolbarTabsHtml() : ''),
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
    ['Reminder', 'bell', "openNewReminderModal()"],
    ['Note', 'notebook-pen', "openNoteModal()"],
    ['Event', 'calendar-plus', "openNewEventModal()"],
    ['Start Timer', 'timer', "openTimerModal()"],
  ];
  if(typeof canApprove === 'function' && canApprove()) items.push(['Client', 'building-2', "openAddClientForm()"]);
  return items;
}
function toggleNewMenu(){
  const m = document.getElementById('newMenu');
  if(!m) return;
  if(m.style.display === 'block'){ closeNewMenu(); return; }
  m.innerHTML = '<div class="mh">New</div>' + newMenuItems().map(([label, ic, fn, kbd]) =>
    `<button class="mi" role="menuitem" onclick="closeNewMenu(); ${fn}">${icon(ic)}<span>${label}</span>${kbd ? `<span class="kbd">${kbd}</span>` : ''}</button>`).join('');
  m.style.display = 'block';
}
function closeNewMenu(){ const m = document.getElementById('newMenu'); if(m) m.style.display = 'none'; }
document.addEventListener('click', e => { if(!e.target.closest('.new-wrap')) closeNewMenu(); });

document.addEventListener('keydown', e => {
  if(typeof currentUser === 'undefined' || !currentUser) return;
  const mod = (typeof isModifierShortcut === 'function') ? isModifierShortcut(e) : (e.metaKey || e.ctrlKey);
  if(e.key === 'Escape'){ closeNewMenu(); return; }
  if(!mod || e.altKey) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable;
  const k = e.key.toLowerCase();
  if(k === 'n' && !e.shiftKey){ e.preventDefault(); closeAppModal(); openQueueLogImprovementModal(); }
  else if(k === 'j'){ e.preventDefault(); if(document.getElementById('claudeNavItem')?.style.display !== 'none') switchView('claude'); }
  else if(e.key === '[' && !typing){ e.preventDefault(); history.back(); }
  else if(e.key === ']' && !typing){ e.preventDefault(); history.forward(); }
});

// Jump to a client on a screen (defined fully by each screen; safe defaults here).
function openWeekClient(id){ window._weekSel = id; switchView('approve'); if(typeof renderThisWeek === 'function') renderThisWeek(); }
function openHealthClient(id){ window._healthSel = id; switchView('health'); if(typeof renderHealth === 'function') renderHealth(); }
function openReviewDraft(clientId, author){ window._reviewSel = { clientId, author }; switchView('teamqueue'); }

// Sidebar counts as on the canvas: All Clients (roster size), Health (needs attention),
// Review (drafts waiting, bold), Tasks and Reminders (yours). Zero hides the count.
function updateShellBadges(){
  const set = (id, n) => { const el = document.getElementById(id); if(!el) return; el.textContent = n; el.style.display = Number(n) ? '' : 'none'; };
  if(typeof attentionEligibleClients === 'function'){
    const list = attentionEligibleClients();
    set('navClientsBadge', activeClients().length);
    set('navHealthBadge', list.filter(c => clientHealth(c).level !== 'g').length);
  }
  ['navTeamPendingBadge', 'navTasksBadge', 'navRemindersBadge', 'navTeamBadge'].forEach(id => {
    const el = document.getElementById(id); if(el) el.style.display = Number(el.textContent) ? '' : 'none';
  });
}
ICON_PATHS['exclamation-mark'] = '<line x1="12" y1="5" x2="12" y2="13.5"/><line x1="12" y1="18.5" x2="12" y2="18.51"/>';
VIEW_TOOLBAR_ACTIONS.reminders = () => `<button class="btn" onclick="openNewReminderModal()">${icon('plus')}New Reminder</button>`;
VIEW_TOOLBAR_ACTIONS.notes = () => `<button class="btn" onclick="openNoteModal()">${icon('square-pen')}New Note</button>`;
