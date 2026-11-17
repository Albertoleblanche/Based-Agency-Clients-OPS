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
  focusreports: ['Focus Reports', 'A weekly brief on what needs the team'],
  clients: ['All Clients', ''],
  health: ['Health', ''],
  improvements: ['Past Improvements', "The team's full history of client work, searchable by date"],
  approve: ['This Week', ''],
  teamqueue: ['Review', ''],
  notes: ['Notes', "Private to you — improvements you're planning or want to get to. Nobody else on the team can see these."],
  tasks: ['Tasks', 'Assign tasks to anyone on the team — only you and the other person can see it'],
  'task-archive': ['Task Archive', "A record of everything the team has finished — search or filter to find anything"],
  reminders: ['Reminders', "Client questions waiting on a response, visible to the whole team"],
  calendar: ['Calendar', "The whole team's calendar in one place — meetings, deadlines, and reminders"],
  time: ['Time', 'Your timesheet, reports and payroll'],
  team: ['Team', "Everyone on the team, and what they do here"],
  trash: ['Recently Deleted', 'Restore anything here, or delete it for good'],
  settings: ['Settings', 'Workspace, client fields, AI, integrations and notifications'],
  claude: ['Assistant', "Ask about a client, get a recommendation, or have it check a website"],
  profile: ['My Profile', 'Your info, visible to the rest of the team the same way it always has been'],
};

const CMDK_PAGE_ICONS = {
  focusreports: '<svg width="15" height="15" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M168,152a8,8,0,0,1-8,8H96a8,8,0,0,1,0-16h64A8,8,0,0,1,168,152Zm-8-40H96a8,8,0,0,0,0,16h64a8,8,0,0,0,0-16Zm56-64V216a16,16,0,0,1-16,16H56a16,16,0,0,1-16-16V48A16,16,0,0,1,56,32H92.26a47.92,47.92,0,0,1,71.48,0H200A16,16,0,0,1,216,48ZM96,64h64a32,32,0,0,0-64,0ZM200,48H173.25A47.93,47.93,0,0,1,176,64v8a8,8,0,0,1-8,8H88a8,8,0,0,1-8-8V64a47.93,47.93,0,0,1,2.75-16H56V216H200Z"/></svg>',
  teamqueue: '<svg width="15" height="15" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32Zm0,16V152h-28.7A15.86,15.86,0,0,0,168,156.69L148.69,176H107.31L88,156.69A15.86,15.86,0,0,0,76.69,152H48V48Zm0,160H48V168H76.69L96,187.31A15.86,15.86,0,0,0,107.31,192h41.38A15.86,15.86,0,0,0,160,187.31L179.31,168H208v40Z"/></svg>',
  claude: '<svg width="15" height="15" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M197.58,129.06,146,110l-19-51.62a15.92,15.92,0,0,0-29.88,0L78,110l-51.62,19a15.92,15.92,0,0,0,0,29.88L78,178l19,51.62a15.92,15.92,0,0,0,29.88,0L146,178l51.62-19a15.92,15.92,0,0,0,0-29.88ZM137,164.22a8,8,0,0,0-4.74,4.74L112,223.85,91.78,169A8,8,0,0,0,87,164.22L32.15,144,87,123.78A8,8,0,0,0,91.78,119L112,64.15,132.22,119a8,8,0,0,0,4.74,4.74L191.85,144ZM144,40a8,8,0,0,1,8-8h16V16a8,8,0,0,1,16,0V32h16a8,8,0,0,1,0,16H184V64a8,8,0,0,1-16,0V48H152A8,8,0,0,1,144,40ZM248,88a8,8,0,0,1-8,8h-8v8a8,8,0,0,1-16,0V96h-8a8,8,0,0,1,0-16h8V72a8,8,0,0,1,16,0v8h8A8,8,0,0,1,248,88Z"/></svg>',
  overview: '<svg width="15" height="15" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M104,40H56A16,16,0,0,0,40,56v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V56A16,16,0,0,0,104,40Zm0,64H56V56h48v48Zm96-64H152a16,16,0,0,0-16,16v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V56A16,16,0,0,0,200,40Zm0,64H152V56h48v48Zm-96,32H56a16,16,0,0,0-16,16v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V152A16,16,0,0,0,104,136Zm0,64H56V152h48v48Zm96-64H152a16,16,0,0,0-16,16v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V152A16,16,0,0,0,200,136Zm0,64H152V152h48v48Z"/></svg>',
  clients: '<svg width="15" height="15" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M240,208H224V96a16,16,0,0,0-16-16H144V32a16,16,0,0,0-24.88-13.32L39.12,72A16,16,0,0,0,32,85.34V208H16a8,8,0,0,0,0,16H240a8,8,0,0,0,0-16ZM208,96V208H144V96ZM48,85.34,128,32V208H48ZM112,112v16a8,8,0,0,1-16,0V112a8,8,0,1,1,16,0Zm-32,0v16a8,8,0,0,1-16,0V112a8,8,0,1,1,16,0Zm0,56v16a8,8,0,0,1-16,0V168a8,8,0,0,1,16,0Zm32,0v16a8,8,0,0,1-16,0V168a8,8,0,0,1,16,0Z"/></svg>',
  improvements: '<svg width="15" height="15" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M213.66,82.34l-56-56A8,8,0,0,0,152,24H56A16,16,0,0,0,40,40V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V88A8,8,0,0,0,213.66,82.34ZM160,51.31,188.69,80H160ZM200,216H56V40h88V88a8,8,0,0,0,8,8h48V216Z"/></svg>',
  approve: '<svg width="15" height="15" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M173.66,98.34a8,8,0,0,1,0,11.32l-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35A8,8,0,0,1,173.66,98.34ZM232,128A104,104,0,1,1,128,24,104.11,104.11,0,0,1,232,128Zm-16,0a88,88,0,1,0-88,88A88.1,88.1,0,0,0,216,128Z"/></svg>',
  notes: '<svg width="15" height="15" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M229.66,58.34l-32-32a8,8,0,0,0-11.32,0l-96,96A8,8,0,0,0,88,128v32a8,8,0,0,0,8,8h32a8,8,0,0,0,5.66-2.34l96-96A8,8,0,0,0,229.66,58.34ZM124.69,152H104V131.31l64-64L188.69,88ZM200,76.69,179.31,56,192,43.31,212.69,64ZM224,128v80a16,16,0,0,1-16,16H48a16,16,0,0,1-16-16V48A16,16,0,0,1,48,32h80a8,8,0,0,1,0,16H48V208H208V128a8,8,0,0,1,16,0Z"/></svg>',
  tasks: '<svg width="15" height="15" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M224,128a8,8,0,0,1-8,8H128a8,8,0,0,1,0-16h88A8,8,0,0,1,224,128ZM128,72h88a8,8,0,0,0,0-16H128a8,8,0,0,0,0,16Zm88,112H128a8,8,0,0,0,0,16h88a8,8,0,0,0,0-16ZM82.34,42.34,56,68.69,45.66,58.34A8,8,0,0,0,34.34,69.66l16,16a8,8,0,0,0,11.32,0l32-32A8,8,0,0,0,82.34,42.34Zm0,64L56,132.69,45.66,122.34a8,8,0,0,0-11.32,11.32l16,16a8,8,0,0,0,11.32,0l32-32a8,8,0,0,0-11.32-11.32Zm0,64L56,196.69,45.66,186.34a8,8,0,0,0-11.32,11.32l16,16a8,8,0,0,0,11.32,0l32-32a8,8,0,0,0-11.32-11.32Z"/></svg>',
  reminders: '<svg width="15" height="15" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M221.8,175.94C216.25,166.38,208,139.33,208,104a80,80,0,1,0-160,0c0,35.34-8.26,62.38-13.81,71.94A16,16,0,0,0,48,200H88.81a40,40,0,0,0,78.38,0H208a16,16,0,0,0,13.8-24.06ZM128,216a24,24,0,0,1-22.62-16h45.24A24,24,0,0,1,128,216ZM48,184c7.7-13.24,16-43.92,16-80a64,64,0,1,1,128,0c0,36.05,8.28,66.73,16,80Z"/></svg>',
  calendar: '<svg width="15" height="15" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M208,32H184V24a8,8,0,0,0-16,0v8H88V24a8,8,0,0,0-16,0v8H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM72,48v8a8,8,0,0,0,16,0V48h80v8a8,8,0,0,0,16,0V48h24V80H48V48ZM208,208H48V96H208V208Z"/></svg>',
  time: '<svg width="15" height="15" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M128,40a96,96,0,1,0,96,96A96.11,96.11,0,0,0,128,40Zm0,176a80,80,0,1,1,80-80A80.09,80.09,0,0,1,128,216ZM173.66,90.34a8,8,0,0,1,0,11.32l-40,40a8,8,0,0,1-11.32-11.32l40-40A8,8,0,0,1,173.66,90.34ZM96,16a8,8,0,0,1,8-8h48a8,8,0,0,1,0,16H104A8,8,0,0,1,96,16Z"/></svg>',
  team: '<svg width="15" height="15" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M244.8,150.4a8,8,0,0,1-11.2-1.6A51.6,51.6,0,0,0,192,128a8,8,0,0,1-7.37-4.89,8,8,0,0,1,0-6.22A8,8,0,0,1,192,112a24,24,0,1,0-23.24-30,8,8,0,1,1-15.5-4A40,40,0,1,1,219,117.51a67.94,67.94,0,0,1,27.43,21.68A8,8,0,0,1,244.8,150.4ZM190.92,212a8,8,0,1,1-13.84,8,57,57,0,0,0-98.16,0,8,8,0,1,1-13.84-8,72.06,72.06,0,0,1,33.74-29.92,48,48,0,1,1,58.36,0A72.06,72.06,0,0,1,190.92,212ZM128,176a32,32,0,1,0-32-32A32,32,0,0,0,128,176ZM72,120a8,8,0,0,0-8-8A24,24,0,1,1,87.24,82a8,8,0,1,0,15.5-4A40,40,0,1,0,37,117.51,67.94,67.94,0,0,0,9.6,139.19a8,8,0,1,0,12.8,9.61A51.6,51.6,0,0,1,64,128,8,8,0,0,0,72,120Z"/></svg>',
  trash: '<svg width="15" height="15" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z"/></svg>',
  settings: '<svg width="15" height="15" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M128,80a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Zm109.94-52.79a8,8,0,0,0-3.89-5.4l-29.83-17-.12-33.62a8,8,0,0,0-2.83-6.08,111.91,111.91,0,0,0-36.72-20.67,8,8,0,0,0-6.46.59L128,41.85,97.88,25a8,8,0,0,0-6.47-.6A112.1,112.1,0,0,0,54.73,45.15a8,8,0,0,0-2.83,6.07l-.15,33.65-29.83,17a8,8,0,0,0-3.89,5.4,106.47,106.47,0,0,0,0,41.56,8,8,0,0,0,3.89,5.4l29.83,17,.12,33.62a8,8,0,0,0,2.83,6.08,111.91,111.91,0,0,0,36.72,20.67,8,8,0,0,0,6.46-.59L128,214.15,158.12,231a7.91,7.91,0,0,0,3.9,1,8.09,8.09,0,0,0,2.57-.42,112.1,112.1,0,0,0,36.68-20.73,8,8,0,0,0,2.83-6.07l.15-33.65,29.83-17a8,8,0,0,0,3.89-5.4A106.47,106.47,0,0,0,237.94,107.21Zm-15,34.91-28.57,16.25a8,8,0,0,0-3,3c-.58,1-1.19,2.06-1.81,3.06a7.94,7.94,0,0,0-1.22,4.21l-.15,32.25a95.89,95.89,0,0,1-25.37,14.3L134,199.13a8,8,0,0,0-3.91-1h-.19c-1.21,0-2.43,0-3.64,0a8.08,8.08,0,0,0-4.1,1l-28.84,16.1A96,96,0,0,1,67.88,201l-.11-32.2a8,8,0,0,0-1.22-4.22c-.62-1-1.23-2-1.8-3.06a8.09,8.09,0,0,0-3-3.06l-28.6-16.29a90.49,90.49,0,0,1,0-28.26L61.67,97.63a8,8,0,0,0,3-3c.58-1,1.19-2.06,1.81-3.06a7.94,7.94,0,0,0,1.22-4.21l.15-32.25a95.89,95.89,0,0,1,25.37-14.3L122,56.87a8,8,0,0,0,4.1,1c1.21,0,2.43,0,3.64,0a8.08,8.08,0,0,0,4.1-1l28.84-16.1A96,96,0,0,1,188.12,55l.11,32.2a8,8,0,0,0,1.22,4.22c.62,1,1.23,2,1.8,3.06a8.09,8.09,0,0,0,3,3.06l28.6,16.29A90.49,90.49,0,0,1,222.9,142.12Z"/></svg>',
  profile: '<svg width="15" height="15" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M230.92,212c-15.23-26.33-38.7-45.21-66.09-54.16a72,72,0,1,0-73.66,0C63.78,166.78,40.31,185.66,25.08,212a8,8,0,1,0,13.85,8c18.84-32.56,52.14-52,89.07-52s70.23,19.44,89.07,52a8,8,0,1,0,13.85-8ZM72,96a56,56,0,1,1,56,56A56.06,56.06,0,0,1,72,96Z"/></svg>',
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
      ${typeof shortcutLabelForView === 'function' && shortcutLabelForView(item.key) ? `<span class="cmdk-shortcut">${escapeHtml(shortcutLabelForView(item.key))}</span>` : ''}
    </div>`;
  }
  return `<div class="cmdk-item ${index===cmdkActiveIndex?'active':''}" data-idx="${index}" onclick="activateCommandPaletteItem(${index})">
    <svg width="15" height="15" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M240,208H224V96a16,16,0,0,0-16-16H144V32a16,16,0,0,0-24.88-13.32L39.12,72A16,16,0,0,0,32,85.34V208H16a8,8,0,0,0,0,16H240a8,8,0,0,0,0-16ZM208,96V208H144V96ZM48,85.34,128,32V208H48ZM112,112v16a8,8,0,0,1-16,0V112a8,8,0,1,1,16,0Zm-32,0v16a8,8,0,0,1-16,0V112a8,8,0,1,1,16,0Zm0,56v16a8,8,0,0,1-16,0V168a8,8,0,0,1,16,0Zm32,0v16a8,8,0,0,1-16,0V168a8,8,0,0,1,16,0Z"/></svg>
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
  document.querySelectorAll('.nav-item').forEach(n=>{ const on = n.dataset.view===name; n.classList.toggle('active', on); n.classList.toggle('on', on); if(on) n.setAttribute('aria-current','page'); else n.removeAttribute('aria-current'); });
  if(typeof setToolbarActions === 'function') setToolbarActions(name);
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
    if(canApprove()){ loadHarvestPanel(); loadSlackChannelsPanel(); }
  }
}
