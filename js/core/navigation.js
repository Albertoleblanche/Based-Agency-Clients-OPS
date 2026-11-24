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
  if(addClientBtn) addClientBtn.style.display = canApprove() ? 'inline-flex' : 'none';
  const editClientDetailBtn = document.getElementById('editClientDetailBtn');
  if(editClientDetailBtn) editClientDetailBtn.style.display = canApprove() ? 'inline-flex' : 'none';
  const teamQueueNavItem = document.getElementById('teamQueueNavItem');
  if(teamQueueNavItem){
    // Review is for approvers (and anyone who sees everyone's drafts). A member's own drafts,
    // in review, approved and sent, are in their Queue instead (queue.js).
    teamQueueNavItem.style.display = typeof queueHasReview === 'function' && queueHasReview() ? 'none' : 'flex';
  }
  const approveQueueNavItem = document.getElementById('approveQueueNavItem');
  if(approveQueueNavItem){
    // An admin/approver has no one else to wait on approving their own
    // work — that's a redundant gate when the person clicking Approve and
    // the person who logged the work are the same person. They log work
    // and act on their own drafts directly from their own section inside
    // Team Queue instead (see queueCardHtml()'s canSkipApproval branch),
    // so the separate personal queue has nothing left for them to do here.
    // This Week is for everyone: members see their clients, approvers see the whole team's.
    approveQueueNavItem.style.display = 'flex';
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
  if(claudeFloatBtn) claudeFloatBtn.style.display = 'none';
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
  // Tab names can depend on the role (a member's All Clients is "Clients")
  if(typeof applyNavLabels === 'function' && typeof settings !== 'undefined') applyNavLabels();
}

function populateReportMemberFilter(){
  const sel = document.getElementById('reportMemberFilter');
  if(!sel) return;
  const current = sel.value || 'all';
  sel.innerHTML = `<option value="all">All team members</option>` + [...teamProfiles].sort((a,b)=>a.name.localeCompare(b.name)).map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  if([...sel.options].some(o=>o.value===current)) sel.value = current;
}

const VIEW_TITLES = {
  clients: ['All Clients', ''],
  health: ['Health', ''],
  improvements: ['Past Improvements', 'Everything the team has logged for clients'],
  approve: ['This Week', ''],
  queue: ['Queue', ''],
  teamqueue: ['Review', ''],
  notes: ['Notes', "Private to you — improvements you're planning or want to get to. Nobody else on the team can see these."],
  tasks: ['Tasks', 'Assign tasks to anyone on the team — only you and the other person can see it'],
  plan: ['Plan', 'Your next six weeks — private to you'],
  'task-archive': ['Finished Tasks', 'Everything that’s been done'],
  reminders: ['Reminders', "Client questions waiting on a response, visible to the whole team"],
  whatsapp: ['WhatsApp', 'Beta · Client chats'],
  calendar: ['Calendar', "The whole team's calendar in one place — meetings, deadlines, and reminders"],
  time: ['Time', 'Your timesheet, reports and payroll'],
  team: ['Team', "Everyone on the team, and what they do here"],
  trash: ['Recently Deleted', 'Work, notes and time go for good after 30 days; clients stay until you delete them'],
  settings: ['Settings', 'Workspace, client fields, AI, integrations and notifications'],
  profile: ['My Profile', 'How the team sees you'],
};

// A tab's name: what an admin renamed it to, or its usual name. Members see All Clients as just
// "Clients" (it lists the clients they work on), and the overview route is the Dashboard.
function viewTitle(name){
  const custom = typeof settings !== 'undefined' && settings.navLabels && settings.navLabels[name];
  if(custom) return custom;
  if(name === 'overview') return 'Dashboard';
  if(name === 'clients' && typeof canApprove === 'function' && typeof currentUser !== 'undefined' && currentUser && !canApprove()) return 'Clients';
  return (VIEW_TITLES[name] || [name])[0];
}

const CMDK_PAGE_ICONS = {
  queue: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2" /> <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></svg>',
  teamqueue: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2" /> <path d="M17 3h2a2 2 0 0 1 2 2v2" /> <path d="M21 17v2a2 2 0 0 1-2 2h-2" /> <path d="M7 21H5a2 2 0 0 1-2-2v-2" /> <circle cx="12" cy="12" r="1" /> <path d="M18.944 12.33a1 1 0 0 0 0-.66 7.5 7.5 0 0 0-13.888 0 1 1 0 0 0 0 .66 7.5 7.5 0 0 0 13.888 0" /></svg>',
  claude: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" /> <path d="M20 2v4" /> <path d="M22 4h-4" /> <circle cx="4" cy="20" r="2" /></svg>',
  overview: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="7" x="3" y="3" rx="1" /> <rect width="7" height="7" x="14" y="3" rx="1" /> <rect width="7" height="7" x="14" y="14" rx="1" /> <rect width="7" height="7" x="3" y="14" rx="1" /></svg>',
  clients: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12h.01" /> <path d="M16 6V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /> <path d="M22 13a18.15 18.15 0 0 1-20 0" /> <rect width="20" height="14" x="2" y="6" rx="2" /></svg>',
  improvements: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /> <path d="M14 2v5a1 1 0 0 0 1 1h5" /></svg>',
  approve: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" /> <path d="M16 2v4" /> <path d="M3 10h18" /> <path d="M8 2v4" /> <path d="M17 14h-6" /> <path d="M13 18H7" /> <path d="M7 14h.01" /> <path d="M17 18h.01" /></svg>',
  notes: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /> <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" /></svg>',
  tasks: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 5h8" /> <path d="M13 12h8" /> <path d="M13 19h8" /> <path d="m3 17 2 2 4-4" /> <rect x="3" y="4" width="6" height="6" rx="1" /></svg>',
  reminders: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.268 21a2 2 0 0 0 3.464 0" /> <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" /></svg>',
  whatsapp: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" /></svg>',
  calendar: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v3" /> <path d="M16 2v3" /> <rect x="3" y="3" width="18" height="18" rx="2" /> <path d="M3 9h18" /> <path d="M8 13h.01" /> <path d="M12 13h.01" /> <path d="M16 13h.01" /> <path d="M8 17h.01" /> <path d="M12 17h.01" /> <path d="M16 17h.01" /></svg>',
  time: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="10" x2="14" y1="2" y2="2" /> <line x1="12" x2="15" y1="14" y2="11" /> <circle cx="12" cy="14" r="8" /></svg>',
  team: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 21a8 8 0 0 0-16 0" /> <circle cx="10" cy="8" r="5" /> <path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3" /></svg>',
  trash: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 11v6" /> <path d="M14 11v6" /> <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /> <path d="M3 6h18" /> <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>',
  settings: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" /> <circle cx="12" cy="12" r="3" /></svg>',
  profile: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /> <circle cx="12" cy="7" r="4" /></svg>',
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
  if(!overlay || overlay.style.display === 'none') return;
  // Quick, since it's opened and closed from the keyboard all day.
  overlay.querySelector('.spot')?.animate?.([{ opacity: 1, transform: 'translateX(-50%)' }, { opacity: 0, transform: 'translateX(-50%) scale(.98)' }], { duration: 110, easing: 'ease-in', fill: 'forwards' });
  typeof animateThen === 'function' ? animateThen(overlay, [{ opacity: 1 }, { opacity: 0 }], 120, 'ease-in', () => { overlay.style.display = 'none'; overlay.getAnimations?.().forEach(a => a.cancel()); overlay.querySelector('.spot')?.getAnimations?.().forEach(a => a.cancel()); }) : (overlay.style.display = 'none');
}

function getCommandPaletteIndex(query){
  const q = query.trim().toLowerCase();
  const pages = Object.keys(VIEW_TITLES).map(key=>({ type:'page', key, title:VIEW_TITLES[key][0], icon:CMDK_PAGE_ICONS[key]||CMDK_PAGE_ICONS.settings }));
  pages.unshift({ type:'page', key:'overview', title:viewTitle('overview'), icon:CMDK_PAGE_ICONS.overview });

  if(!q) return { pages: pages.slice(0,6), clients: [] };

  const matchedPages = pages.filter(p=>p.title.toLowerCase().includes(q));
  const matchedClients = (typeof clients!=='undefined' ? liveClients() : [])
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
      ${typeof shortcutLabelForView === 'function' && shortcutLabelForView(item.key) ? `<span class="cmdk-shortcut">${escapeHtml(shortcutLabelForView(item.key))}</span>` : ''}
    </div>`;
  }
  return `<div class="cmdk-item ${index===cmdkActiveIndex?'active':''}" data-idx="${index}" onclick="activateCommandPaletteItem(${index})">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12h.01" /> <path d="M16 6V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /> <path d="M22 13a18.15 18.15 0 0 1-20 0" /> <rect width="20" height="14" x="2" y="6" rx="2" /></svg>
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
  if(targetView && /^[a-z-]+$/.test(targetView)) return '/#' + targetView;
  return '/';
}
function parseRouteHash(hash){
  const raw = String(hash || '').replace(/^#\/?/, '').split('?')[0];
  if(!raw) return null;
  const client = raw.match(/^client\/(.+)$/);
  if(client){ try{ return { view:'clientdetail', clientId: decodeURIComponent(client[1]) }; }catch(e){ return null; } }
  // a link to one item (Nov 24, from Slack messages sent as you): #tasks/<id>, #whatsapp/<id>, …
  const item = raw.match(/^(tasks|whatsapp|reminders|teamqueue|queue|health)\/(.+)$/);
  if(item){
    let id; try{ id = decodeURIComponent(item[2]); }catch(e){ return null; }
    const v = item[1] === 'teamqueue' && typeof queueHasReview === 'function' && queueHasReview() ? 'queue' : item[1];
    return { view: v, itemId: id };
  }
  if(raw === 'teamqueue' && typeof queueHasReview === 'function' && queueHasReview()) return { view: 'queue' };
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
  return true;
}
// Keeps the address in step when a screen opens from inside the app.
function syncAddressToView(name){
  currentViewName = name;
  updateDocumentTitle(name);
  if(typeof updateFloatingTimerPill === 'function' && typeof timerState !== 'undefined' && timerState.running) updateFloatingTimerPill();
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
  } else if(VIEW_TITLES[name] || name === 'overview'){
    screen = viewTitle(name);
  }
  document.title = screen ? `${screen} — ${appName}` : `${appName} — ${settings.appDescription || 'Client Update Workflow'}`;
}
// Opens whatever screen the address points at. Unknown or off-limits
// addresses fall back to Overview, and the address is corrected to match.
async function openScreenFromAddress(hash){
  if(!currentUser) return;
  const route = parseRouteHash(hash) || { view:'overview' };
  const already = route.view === currentViewName && (route.view !== 'clientdetail' || route.clientId === currentDetailClientId);
  if(already && !route.itemId) return;
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
  if(location.hash && location.hash !== corrected && !/gcal=|slackme=/.test(location.hash)) history.replaceState(null, '', corrected);
  await opened;
  if(route.itemId && route.view === currentViewName) openLinkedItem(route.view, route.itemId);
}
// The item a link names, open in its screen (the same as opening it from the bell)
async function openLinkedItem(view, id){
  try{
    if(view === 'tasks' && typeof notifOpenTask === 'function') return notifOpenTask(id);
    if(view === 'whatsapp' && typeof waOpenItem === 'function') return waOpenItem(id);
    if(view === 'reminders'){ if(typeof clientReminders !== 'undefined' && !clientReminders.length && typeof loadClientReminders === 'function') await loadClientReminders(); window._remSel = id; if(typeof renderReminders === 'function') renderReminders(); return; }
    if(view === 'queue' && typeof openQueueClient === 'function') return openQueueClient(id);
    if(view === 'health'){ window._healthSel = id; if(typeof renderHealth === 'function') renderHealth(); return; }
    if(view === 'teamqueue' && typeof reviewItems === 'function' && typeof openReviewDraft === 'function'){
      const all = Object.values(reviewItems()).flat().filter(x => x.c.id === id);
      const x = (!canApprove() && all.find(y => y.d.author === myName())) || all[0];
      if(x) openReviewDraft(x.c.id, x.d.author);
    }
  }catch(e){ console.warn('openLinkedItem', e); }
}
// A link to one item, for messages (Slack): https://…/#tasks/<id>
function itemLink(view, id){ return `${location.origin}/#${view}${id ? '/' + encodeURIComponent(id) : ''}`; }

// Leaving a screen closes its right-hand panel, so the screen is back to its list when you return.
// It redraws once the screen is hidden, so nothing animates out of sight or on the way back.
const PANEL_STATE = { approve: ['_weekSel', '_weekDraftEdit'], health: ['_healthSel'], tasks: ['_taskSel'], reminders: ['_remSel'], plan: ['_planSel', '_planAddStep', '_planAddRem'], whatsapp: ['_waSel'] };
function closePanelOnLeave(view){
  if(view === 'clients'){
    if(typeof inspectedClientId === 'undefined' || !inspectedClientId) return;
    inspectedClientId = null; if(typeof renderClientsTable === 'function') renderClientsTable();
    return;
  }
  const keys = PANEL_STATE[view];
  if(!keys || !keys.some(k => window[k])) return;
  keys.forEach(k => { window[k] = null; });
  const redraw = { approve: 'renderThisWeek', health: 'renderHealth', tasks: 'renderTasks', reminders: 'renderReminders', plan: 'renderPlan', whatsapp: 'renderWhatsapp' }[view];
  if(typeof window[redraw] === 'function') window[redraw]();
}

// The screens that can draw straight away from what's already loaded (the switch fades to them).
const VIEW_QUICK_DRAW = { overview: 'renderDashboard', clients: 'renderClientsTable', health: 'renderHealth', tasks: 'renderTasks', reminders: 'renderReminders', notes: 'renderNotes', plan: 'renderPlan', teamqueue: 'renderTeamQueue', queue: 'renderMyQueue', calendar: 'renderCalendar', time: 'renderTimeView', trash: 'renderTrash' };
async function switchView(name){
  if(name === 'claude' || name === 'focusreports') name = 'overview'; // the Assistant and the weekly report were removed; old links land on the Dashboard
  if(name === 'teamqueue' && typeof queueHasReview === 'function' && queueHasReview()) name = 'queue'; // a member's Review is in their Queue
  const leaving = currentViewName;
  // You change screens all day, so the move is a quick cross-fade of the page and its title (the
  // sidebar and toolbar buttons just change, like a Mac app's). The new screen is drawn before the
  // fade, so nothing jumps once it's in. From the keyboard (⌘1–9, back and forward) it's simply there.
  const fade = leaving && leaving !== name && switchView._last !== name && window._lastInput !== 'key' && !(name === 'approve' && window._wkIntro)
    && typeof motionOK === 'function' && motionOK() && document.visibilityState === 'visible';
  let viewEl;
  const swap = () => {
    closeMobileNav();
    // This Week has its own place in the sidebar now (it also opens from the Dashboard's toolbar).
    const navName = name;
    document.querySelectorAll('.nav-item').forEach(n=>{ const on = n.dataset.view===navName; n.classList.toggle('active', on); n.classList.toggle('on', on); if(on) n.setAttribute('aria-current','page'); else n.removeAttribute('aria-current'); });
    if(typeof setToolbarActions === 'function') setToolbarActions(name);
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    viewEl = document.getElementById('view-'+name);
    viewEl.classList.add('active');
    switchView._last = name;
    syncAddressToView(name);
    if(leaving && leaving !== name) closePanelOnLeave(leaving);
    // The floating "open the Assistant" button is redundant (and visually
    // odd sitting on top of the tab's own dark background) while you're
    // already looking at the Assistant tab itself — hidden here rather than
    // in applyRoleVisibility(), since that only re-runs on permission
    // changes, not on every navigation.
    const claudeFloatBtn = document.getElementById('claudeFloatBtn');
    if(claudeFloatBtn) claudeFloatBtn.style.display = 'none';
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
      if(titleEl) titleEl.textContent = viewTitle(name);
      if(subEl) subEl.textContent = meta[1];
    }
    // The Dashboard's title is its greeting: set it now, not after the data load (it said the last tab's name meanwhile)
    if(name === 'overview' && typeof renderGreeting === 'function') renderGreeting();
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
    if(name==='profile'){ renderProfilePage(); }
    if(name==='settings' && typeof renderSettingsView === 'function'){ renderSettingsView(); if(settingsTab === 'integrations') loadIntegrationStatuses(); if(settingsTab === 'ai' && isAdmin()) loadAiProviderConnectionStatus(); if(settingsTab === 'whatsapp' && typeof waStartPoll === 'function') waStartPoll(); }
    // WhatsApp shows what it has straight away and loads its own tables, instead of waiting for
    // everything else below to load first.
    if(name==='whatsapp' && typeof openWhatsappView === 'function') openWhatsappView();
    // Drawn now from what's loaded, so the page and the toolbar's line under the title are right
    // from the first frame; the refresh below only changes what's actually new.
    const draw = VIEW_QUICK_DRAW[name]; if(draw && typeof window[draw] === 'function'){ try{ window[draw](); }catch(e){ console.error(e); } }
  };
  if(fade && document.startViewTransition){
    // Only the page takes part (the sidebar and toolbar stay live, so the highlight and the title
    // change at once); the name that lets it fade is on just for the switch.
    const my = switchView._vt = (switchView._vt || 0) + 1;
    document.documentElement.classList.add('vt-page');
    const vt = document.startViewTransition(swap);
    vt.finished.finally(() => { if(switchView._vt === my) document.documentElement.classList.remove('vt-page'); });
    // the refresh below waits for the fade, so nothing competes with it for frames
    await vt.finished.catch(() => {});
    if(switchView._vt !== my) return;   // another tab was clicked during the fade: that switch refreshes
  } else {
    swap();
    if(fade) viewEl.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'cubic-bezier(.23,1,.32,1)' });
  }
  // Live updates keep the data current, so a switch only reloads everything when the last full
  // load is more than 30 seconds old, and does it quietly (no entrance animations on the redraw).
  if(!fullRefresh._at || Date.now() - fullRefresh._at > 30000){
    document.body.classList.add('silent-refresh');
    try{ await fullRefresh(); } finally { setTimeout(() => document.body.classList.remove('silent-refresh'), 200); }
  }
  if(name==='trash') renderTrash();
  if(name==='payroll') renderPayroll();
  if(name==='task-archive'){ populateTaskArchiveFilters(); renderTaskArchive(); }
  if(name==='calendar'){ renderCalendar(); renderCalendarGoogleSyncWidget(); }
  if(name==='reminders') renderReminders();
  if(name==='claude'){ await loadClaudeHistory(); renderClaudeMessages(); }
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
  if(name==='queue') renderMyQueue();
  if(name==='plan' && typeof renderPlan === 'function') renderPlan();
  if(name==='whatsapp' && currentViewName === 'whatsapp' && typeof renderWhatsapp === 'function') renderWhatsapp();
  if(name==='time') (typeof renderTimeView === 'function' ? renderTimeView() : renderTimesheet());
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
    const approverOnly = document.getElementById('approverOnlyIntegrations');
    if(approverOnly) approverOnly.style.display = canApprove() ? 'block' : 'none';
    if(canApprove()) loadSlackChannelsPanel();
  }
}
