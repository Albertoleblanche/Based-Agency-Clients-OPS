// Role-based visibility, the ⌘K command palette, switchView() and
// settings tabs.

function applyRoleVisibility(){
  const notifyBtn = document.getElementById('notifyBtn');
  if(notifyBtn){
    notifyBtn.style.display = 'inline-flex';
    notifyBtn.textContent = 'Send for Approval';
  }
  // A regular member only ever sees their own improvements in this list
  // now (see getAllImprovementsFlat()), so a "filter by team member"
  // dropdown listing everyone else would be actively misleading — picking
  // a colleague's name would just show an empty list, reading as a bug
  // rather than the intended restriction.
  const memberFilterField = document.getElementById('improvementsMemberFilterField');
  if(memberFilterField) memberFilterField.style.display = canApprove() ? 'block' : 'none';
  const addClientBtn = document.getElementById('addClientBtn');
  const navAiVisibility = document.getElementById('navAiVisibility');
  if(navAiVisibility) navAiVisibility.style.display = hasPermission('view_ai_visibility') ? 'flex' : 'none';
  if(addClientBtn) addClientBtn.style.display = canApprove() ? 'inline-flex' : 'none';
  const editClientDetailBtn = document.getElementById('editClientDetailBtn');
  if(editClientDetailBtn) editClientDetailBtn.style.display = canApprove() ? 'inline-flex' : 'none';
  const teamQueueNavItem = document.getElementById('teamQueueNavItem');
  if(teamQueueNavItem){
    teamQueueNavItem.style.display = hasPermission('view_team_queue') ? 'flex' : 'none';
    // If a non-approver somehow ends up on Team Queue (e.g. lost approver
    // status mid-session), fall back to their own personal queue.
    if(!hasPermission('view_team_queue') && document.getElementById('view-teamqueue')?.classList.contains('active')){ switchView('approve'); }
  }
  const approveQueueNavItem = document.getElementById('approveQueueNavItem');
  if(approveQueueNavItem){
    // An admin/approver has no one else to wait on approving their own
    // work — that's a redundant gate when the person clicking Approve and
    // the person who logged the work are the same person. They log work
    // and act on their own drafts directly from their own section inside
    // Team Queue instead (see queueCardHtml()'s canSkipApproval branch),
    // so the separate personal queue has nothing left for them to do here.
    approveQueueNavItem.style.display = canApprove() ? 'none' : 'flex';
    if(canApprove() && document.getElementById('view-approve')?.classList.contains('active')){ switchView('teamqueue'); }
  }
  const claudeNavItem = document.getElementById('claudeNavItem');
  const claudeFloatBtn = document.getElementById('claudeFloatBtn');
  // A real per-person toggle now (see each team card's "AI Assistant
  // access" switch), not a blanket admin/approver check — an admin can
  // grant this to a specific member or revoke it from a specific
  // admin/approver.
  const aiChatAllowed = !!myProfile?.ai_chat_enabled;
  // The floating button specifically has its own separate personal
  // preference (stored per-device, not an admin setting) — someone can
  // have full Assistant access via the tab while still hiding the
  // floating button just for themselves, e.g. if they find it visually
  // intrusive. Doesn't affect anyone else's session.
  const floatBtnAllowed = aiChatAllowed && loadClaudeFloatButtonPref();
  if(claudeNavItem) claudeNavItem.style.display = aiChatAllowed ? 'flex' : 'none';
  if(claudeFloatBtn) claudeFloatBtn.style.display = floatBtnAllowed ? 'flex' : 'none';
  if(!floatBtnAllowed){
    document.getElementById('claudeFloatPanel')?.classList.remove('open');
  }
  if(!aiChatAllowed){
    if(document.getElementById('view-claude')?.classList.contains('active')) switchView('overview');
  }
  const clientsBulkModeBtn = document.getElementById('clientsBulkModeBtn');
  if(clientsBulkModeBtn){
    clientsBulkModeBtn.style.display = canApprove() ? 'inline-flex' : 'none';
    // Bulk delete is admin/approver-only — if someone loses that status
    // mid-session while bulk mode happens to be on, back them out of it
    // rather than leave selection UI up they can no longer act on.
    if(!canApprove() && clientBulkModeOn) toggleClientBulkMode();
  }
  const teammatesTab = document.getElementById('teammatesReportTab');
  if(teammatesTab){
    teammatesTab.style.display = isAdmin() ? 'flex' : 'none';
    // If a non-admin somehow had this selected (e.g. lost admin mid-session), fall back to Clients.
    if(!isAdmin() && typeof reportTab!=='undefined' && reportTab==='teammates'){ switchReportTab('clients'); }
  }
  const memberFilterWrap = document.getElementById('reportMemberFilterWrap');
  if(memberFilterWrap){
    // Only meaningful for admins — everyone else only ever sees their own
    // time anyway, so a "filter by teammate" control would just be a
    // single-option dropdown that does nothing.
    memberFilterWrap.style.display = isAdmin() ? 'flex' : 'none';
    if(isAdmin()) populateReportMemberFilter();
  }
  const trashClientsTab = document.getElementById('trashClientsTab');
  if(trashClientsTab){
    trashClientsTab.style.display = hasPermission('delete_clients') ? 'flex' : 'none';
    if(!hasPermission('delete_clients') && trashClientsTab.classList.contains('active')){ switchTrashTab('notes'); }
  }
  const payrollTab = document.getElementById('payrollTab');
  if(payrollTab){
    payrollTab.style.display = isAdmin() ? 'flex' : 'none';
    if(!isAdmin() && document.getElementById('ttab-payroll')?.classList.contains('active')){ switchTimeTab('timesheet'); }
  }
  const settingsGeneralTab = document.getElementById('settingsGeneralTab');
  if(settingsGeneralTab){
    settingsGeneralTab.style.display = canApprove() ? 'flex' : 'none';
    if(!canApprove() && document.getElementById('stab-general')?.classList.contains('active')){ switchSettingsTab('integrations'); }
  }
  const settingsFieldsTab = document.getElementById('settingsFieldsTab');
  if(settingsFieldsTab){
    settingsFieldsTab.style.display = canApprove() ? 'flex' : 'none';
    if(!canApprove() && document.getElementById('stab-fields')?.classList.contains('active')){ switchSettingsTab('integrations'); }
  }
  const settingsNotifTab = document.getElementById('settingsNotifTab');
  if(settingsNotifTab){
    settingsNotifTab.style.display = 'flex';
  }
}

function populateReportMemberFilter(){
  const sel = document.getElementById('reportMemberFilter');
  if(!sel) return;
  const current = sel.value || 'all';
  sel.innerHTML = `<option value="all">All team members</option>` + [...teamProfiles].sort((a,b)=>a.name.localeCompare(b.name)).map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  if([...sel.options].some(o=>o.value===current)) sel.value = current;
}

const VIEW_TITLES = {
  focusreports: ['Past Reports', "Every weekly focus report the team has generated, browsable anytime"],
  clients: ['Clients', "Log improvements here whenever you make one — any of the six of you, any time"],
  improvements: ['Past Improvements', "The team's full history of client work, searchable by date"],
  approve: ['Approval Queue', 'The clients who need you most, sorted by risk'],
  teamqueue: ['Team Queue', "Every draft on the team, sorted so the riskiest ones surface first"],
  notes: ['Notes', "Private to you — improvements you're planning or want to get to. Nobody else on the team can see these."],
  tasks: ['Tasks', 'Assign tasks to anyone on the team — only you and the other person can see it'],
  'task-archive': ['Task Archive', "A record of everything the team has finished — search or filter to find anything"],
  reminders: ['Reminders', "Client questions waiting on a response, visible to the whole team"],
  calendar: ['Calendar', "The whole team's calendar in one place — meetings, deadlines, and reminders"],
  time: ['Time Tracker', "Log hours per client, review the timesheet, and see where the team's time goes"],
  team: ['Team', "Everyone on the team, and what they do here"],
  trash: ['Trash', 'Deleted notes and time entries — restore anytime, or delete for good. Deleted clients are visible to admins and approvers only.'],
  settings: ['Settings & Integrations', "What's actually connected right now — no guessing"],
  claude: ['Assistant', "Ask about a client, get a recommendation, or have it check a website"],
  profile: ['My Profile', 'Your info, visible to the rest of the team the same way it always has been'],
  aivisibility: ['AI Visibility', 'Client-facing reports on how AI assistants describe and recommend them'],
};

const CMDK_PAGE_ICONS = {
  overview: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>',
  clients: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  improvements: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  approve: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  notes: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  tasks: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  reminders: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
  calendar: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  time: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  team: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>',
  trash: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>',
  settings: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4"/></svg>',
  profile: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
};

let cmdkActiveIndex = 0;
let cmdkCurrentResults = [];

function openCommandPalette(){
  const overlay = document.getElementById('cmdkOverlay');
  const input = document.getElementById('cmdkInput');
  if(!overlay || !input) return;
  overlay.style.display = 'flex';
  input.value = '';
  cmdkActiveIndex = 0;
  renderCommandPaletteResults();
  setTimeout(()=>input.focus(), 10);
}

function closeCommandPalette(){
  const overlay = document.getElementById('cmdkOverlay');
  if(overlay) overlay.style.display = 'none';
}

function getCommandPaletteIndex(query){
  const q = query.trim().toLowerCase();
  const pages = Object.keys(VIEW_TITLES).map(key=>({ type:'page', key, title:VIEW_TITLES[key][0], icon:CMDK_PAGE_ICONS[key]||CMDK_PAGE_ICONS.settings }));
  pages.unshift({ type:'page', key:'overview', title:'Overview', icon:CMDK_PAGE_ICONS.overview });

  if(!q) return { pages: pages.slice(0,6), clients: [] };

  const matchedPages = pages.filter(p=>p.title.toLowerCase().includes(q));
  const matchedClients = (typeof clients!=='undefined' ? activeClients() : [])
    .filter(c=> c.name.toLowerCase().includes(q) || (c.service||'').toLowerCase().includes(q))
    .slice(0, 8)
    .map(c=>({ type:'client', id:c.id, title:c.name, sub:c.service }));

  return { pages: matchedPages, clients: matchedClients };
}

function renderCommandPaletteResults(){
  const input = document.getElementById('cmdkInput');
  const el = document.getElementById('cmdkResults');
  if(!input || !el) return;
  const { pages, clients: clientResults } = getCommandPaletteIndex(input.value);
  cmdkCurrentResults = [...pages, ...clientResults];
  cmdkActiveIndex = 0;

  if(!cmdkCurrentResults.length){ el.innerHTML = `<div class="cmdk-empty">No matches for "${escapeHtml(input.value)}"</div>`; return; }

  let html = '';
  if(pages.length){
    html += `<div class="cmdk-section-label">Go to</div>`;
    html += pages.map((p,i)=> cmdkItemHtml(p, i)).join('');
  }
  if(clientResults.length){
    html += `<div class="cmdk-section-label">Clients</div>`;
    html += clientResults.map((c,i)=> cmdkItemHtml(c, pages.length+i)).join('');
  }
  el.innerHTML = html;
}

function cmdkItemHtml(item, index){
  if(item.type==='page'){
    return `<div class="cmdk-item ${index===cmdkActiveIndex?'active':''}" data-idx="${index}" onclick="activateCommandPaletteItem(${index})">
      ${item.icon}<span class="cmdk-item-title">${escapeHtml(item.title)}</span>
    </div>`;
  }
  return `<div class="cmdk-item ${index===cmdkActiveIndex?'active':''}" data-idx="${index}" onclick="activateCommandPaletteItem(${index})">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
    <span class="cmdk-item-title">${escapeHtml(item.title)}</span>
    ${item.sub ? `<span class="cmdk-item-sub">${escapeHtml(item.sub)}</span>` : ''}
  </div>`;
}

function activateCommandPaletteItem(index){
  const item = cmdkCurrentResults[index];
  if(!item) return;
  closeCommandPalette();
  if(item.type==='page') switchView(item.key);
  else if(item.type==='client') openClientDetail(item.id);
}

document.addEventListener('keydown', (e)=>{
  const isMac = navigator.platform.toUpperCase().includes('MAC');
  const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
  if(cmdOrCtrl && e.key.toLowerCase()==='k'){
    e.preventDefault();
    const overlay = document.getElementById('cmdkOverlay');
    if(overlay && overlay.style.display==='flex') closeCommandPalette(); else openCommandPalette();
    return;
  }
  const overlay = document.getElementById('cmdkOverlay');
  if(!overlay || overlay.style.display!=='flex') return;
  if(e.key==='Escape'){ closeCommandPalette(); return; }
  if(e.key==='ArrowDown'){ e.preventDefault(); cmdkActiveIndex = Math.min(cmdkActiveIndex+1, cmdkCurrentResults.length-1); cmdkRefreshActiveHighlight(); return; }
  if(e.key==='ArrowUp'){ e.preventDefault(); cmdkActiveIndex = Math.max(cmdkActiveIndex-1, 0); cmdkRefreshActiveHighlight(); return; }
  if(e.key==='Enter'){ e.preventDefault(); activateCommandPaletteItem(cmdkActiveIndex); return; }
});

function cmdkRefreshActiveHighlight(){
  document.querySelectorAll('#cmdkResults .cmdk-item').forEach(el=>{
    el.classList.toggle('active', Number(el.dataset.idx)===cmdkActiveIndex);
  });
  const activeEl = document.querySelector(`#cmdkResults .cmdk-item[data-idx="${cmdkActiveIndex}"]`);
  if(activeEl) activeEl.scrollIntoView({ block:'nearest' });
}

// ---- Screen addresses ------------------------------------------------------
// Every screen has its own web address — #clients, #tasks, #client/<id>… —
// so a refresh keeps you where you were, Back/Forward move between screens,
// and a screen can be bookmarked or linked to (push notifications use this).
// It's still one page: only the part after # changes, nothing reloads.
let currentViewName = 'overview';
let _routingFromAddress = false; // true while a screen opens *because of* the address bar

function routeHashFor(name){
  if(name === 'clientdetail' && currentDetailClientId) return '#client/' + encodeURIComponent(currentDetailClientId);
  return '#' + name;
}
// Link for a notification's target (same targets the bell already uses).
function notificationUrl(targetView, targetId){
  if(targetView === 'client-detail' && targetId) return '/#client/' + encodeURIComponent(targetId);
  if(targetView === 'weekly-focus-report') return '/#focusreports';
  if(targetView && /^[a-z-]+$/.test(targetView)) return '/#' + targetView;
  return '/';
}
function parseRouteHash(hash){
  const raw = String(hash || '').replace(/^#\/?/, '').split('?')[0];
  if(!raw) return null;
  const client = raw.match(/^client\/(.+)$/);
  if(client){ try{ return { view:'clientdetail', clientId: decodeURIComponent(client[1]) }; }catch(e){ return null; } }
  return { view: raw };
}
// Only screens this person can actually reach from the sidebar (or from a
// screen they can reach) — a typed or bookmarked address can't open a
// screen their role hides.
const ROUTE_PARENT_VIEW = { improvements:'approve', 'task-archive':'tasks' };
function canOpenViewFromAddress(name){
  if(!/^[a-z-]+$/.test(name) || name === 'clientdetail') return false;
  if(!document.getElementById('view-' + name)) return false;
  const navView = ROUTE_PARENT_VIEW[name] || name;
  const nav = document.querySelector(`.nav-item[data-view="${navView}"]`);
  if(nav && getComputedStyle(nav).display === 'none') return false;
  if(name === 'aivisibility' && !hasPermission('view_ai_visibility')) return false;
  return true;
}
// Keeps the address in step when a screen opens from inside the app.
function syncAddressToView(name){
  currentViewName = name;
  updateDocumentTitle(name);
  if(_routingFromAddress) return;
  const target = routeHashFor(name);
  if(location.hash !== target) history.pushState(null, '', target);
}
function updateDocumentTitle(name){
  const appName = settings.appName || 'Based Agency';
  let screen = null;
  if(name === 'clientdetail'){
    const c = clients.find(x => x.id === currentDetailClientId);
    screen = c ? c.name : 'Client';
  } else if(VIEW_TITLES[name]){
    screen = (settings.navLabels && settings.navLabels[name]) || VIEW_TITLES[name][0];
  }
  document.title = screen ? `${screen} — ${appName}` : `${appName} — ${settings.appDescription || 'Client Update Workflow'}`;
}
// Opens whatever screen the address points at. Unknown or off-limits
// addresses fall back to Overview, and the address is corrected to match.
async function openScreenFromAddress(hash){
  if(!currentUser) return;
  const route = parseRouteHash(hash) || { view:'overview' };
  const already = route.view === currentViewName && (route.view !== 'clientdetail' || route.clientId === currentDetailClientId);
  if(already) return;
  _routingFromAddress = true;
  let opened;
  try{
    if(route.view === 'clientdetail'){
      if(clients.some(c => c.id === route.clientId && !c.deletedAt)){ opened = openClientDetail(route.clientId); }
      else { opened = switchView('clients'); showToast('info','Client not found','That client may have been removed or moved to Trash.'); }
    } else {
      opened = switchView(canOpenViewFromAddress(route.view) ? route.view : 'overview');
    }
  } finally {
    // switchView() records the screen synchronously, before its data load —
    // so the flag only needs to cover that first, synchronous part.
    _routingFromAddress = false;
  }
  const corrected = routeHashFor(currentViewName);
  if(location.hash && location.hash !== corrected && !/gcal=/.test(location.hash)) history.replaceState(null, '', corrected);
  await opened;
}

async function switchView(name){
  closeMobileNav();
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active', n.dataset.view===name));
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-'+name).classList.add('active');
  syncAddressToView(name);
  // The floating "open the Assistant" button is redundant (and visually
  // odd sitting on top of the tab's own dark background) while you're
  // already looking at the Assistant tab itself — hidden here rather than
  // in applyRoleVisibility(), since that only re-runs on permission
  // changes, not on every navigation.
  const claudeFloatBtn = document.getElementById('claudeFloatBtn');
  if(claudeFloatBtn && myProfile?.ai_chat_enabled && loadClaudeFloatButtonPref()){ claudeFloatBtn.style.display = name==='claude' ? 'none' : 'flex'; }
  // Overview and Client Detail aren't in this lookup — their titles are
  // dynamic (greeting text, client name) and get set by renderGreeting()
  // and renderClientDetail() respectively, moments later in this same flow.
  const meta = VIEW_TITLES[name];
  if(meta){
    const titleEl = document.getElementById('topbarTitle');
    const subEl = document.getElementById('topbarSub');
    // Falls back to the hardcoded default when no custom name is set —
    // the subtitle always stays the default, since Sidebar Tab Names only
    // lets admins rename the tab itself, not write a custom description.
    if(titleEl) titleEl.textContent = (settings.navLabels && settings.navLabels[name]) || meta[0];
    if(subEl) subEl.textContent = meta[1];
  }
  // Shown immediately, before the data load starts — the check inside
  // renderTimesheetDay/Week() alone isn't enough, since those only run
  // AFTER fullRefresh() below has already finished, by which point the
  // real data is already there and there's nothing left to show a loading
  // state for.
  if(name==='time' && !timeEntriesDataLoaded){
    const tb = document.getElementById('timesheetBody');
    if(tb) tb.innerHTML = loadingStateHtml('Loading timesheet…');
  }
  // Profile doesn't actually need fullRefresh() at all — myProfile is
  // already loaded from login (fullRefresh()'s chain never touches it;
  // that's a separate loadMyProfile() call), and its own sub-panels
  // (Google Calendar, push, email) each do their own independent fetch.
  // Called here, ahead of 7 unrelated network requests, instead of after
  // them — there was never a reason for this page specifically to wait.
  if(name==='profile'){ renderProfilePage(); loadGoogleCalendarStatus(); loadPushStatus(); }
  // weekly_focus_reports is a completely independent table — none of the
  // 7 requests in fullRefresh() below touch it, so this page gains
  // nothing from waiting behind them either.
  if(name==='focusreports') renderFocusReportsPage();
  // Same reasoning — ai_visibility_reports is its own independent table.
  // Permission-gated redirect happens here rather than earlier, since it
  // needs hasPermission() reading a myProfile that's reliably loaded by
  // this point in the app's lifecycle. Grantable per-member now (see
  // EXTRA_PERMISSIONS_META) rather than hardcoded to admins only —
  // hasPermission() still covers every admin/approver automatically, so
  // nothing changes for them.
  if(name==='aivisibility'){
    if(!hasPermission('view_ai_visibility')){ switchView('overview'); showToast('error','Not allowed','You don\'t have access to AI SEO Reports.'); return; }
    renderAiVisibilityMain();
  }
  await fullRefresh();
  if(name==='trash') renderTrash();
  if(name==='payroll') renderPayroll();
  if(name==='task-archive'){ populateTaskArchiveFilters(); renderTaskArchive(); }
  if(name==='calendar'){ renderCalendar(); renderCalendarGoogleSyncWidget(); }
  if(name==='reminders') renderReminders();
  if(name==='claude'){ await loadClaudeHistory(); renderClaudeMessages(); }
  if(name==='overview') refreshWeeklyFocusReportBanner();
  if(name==='improvements'){
    const fromEl = document.getElementById('improvementsFromDate');
    const toEl = document.getElementById('improvementsToDate');
    if(fromEl && toEl && !fromEl.value && !toEl.value){
      fromEl.value = toDateStr(getWeekStart(new Date()));
      toEl.value = toDateStr(new Date());
    }
    renderImprovementsHistory();
  }
  if(name==='teamqueue') renderTeamQueue();
  if(name==='time') renderTimesheet();
}

function switchSettingsTab(name){
  document.querySelectorAll('#view-settings .icon-tab').forEach(t=>t.classList.toggle('active', t.dataset.stab===name));
  document.querySelectorAll('#view-settings .settings-subview').forEach(v=>v.classList.remove('active'));
  document.getElementById('stab-'+name).classList.add('active');
  if(name==='notifications') renderNotificationPrefs();
  if(name==='ai'){
    const adminOnly = document.getElementById('adminOnlyAiSettings');
    if(adminOnly) adminOnly.style.display = isAdmin() ? 'block' : 'none';
    if(isAdmin()) loadAiProviderConnectionStatus();
  }
  if(name==='integrations'){
    const adminOnly = document.getElementById('adminOnlyIntegrations');
    if(adminOnly) adminOnly.style.display = isAdmin() ? 'block' : 'none';
    if(isAdmin()) loadInhouseMetricsConnectionStatus();
    const approverOnly = document.getElementById('approverOnlyIntegrations');
    if(approverOnly) approverOnly.style.display = canApprove() ? 'block' : 'none';
    if(canApprove()){ loadHarvestPanel(); loadSlackChannelsPanel(); }
  }
}
