// Assistant (Claude/ChatGPT): conversations, projects, floating panel.

/* ---------- Assistant (Claude) — floating button + its own tab, one shared conversation ---------- */

let claudeConversation = []; // [{role:'user'|'assistant', content:'...'}] — messages in the currently open conversation
let claudeSending = false;
let claudeHistoryLoaded = false;
let claudeConversationId = null; // the currently open conversation's id, or null before the first message of a new one is sent
let claudeConversationsList = []; // [{id, title, updated_at, pinned}] — sidebar cache, most-recently-updated first
let claudeProjectsList = []; // [{id, name, description, updated_at}]
let claudeCurrentProjectId = null; // set while viewing a specific project's detail screen; null on the projects list screen
let claudeProjectsSearchQuery = '';
let claudePendingProjectId = null; // set by "New chat in this project"; consumed once by ensureClaudeConversation() to tag the new row
let claudeBulkMode = false;
let claudeBulkSelected = new Set();
// How many past messages get displayed vs. actually sent as context to the
// AI on each new message — kept separate on purpose. Displaying more is
// free (just reading rows already fetched); SENDING more costs real
// tokens on every single future message for the rest of the
// conversation's life, so that stays bounded regardless of how long the
// conversation grows over weeks of use.
const CLAUDE_HISTORY_DISPLAY_LIMIT = 60;
const CLAUDE_CONTEXT_WINDOW = 20;

// Loads this person's list of past conversations AND projects once per
// session (not once per open — switching between the floating button and
// the full tab shouldn't re-fetch) and opens the most recently active
// conversation, matching how Claude.ai itself resumes where you left off.
// See schema-clients-migration-addendum-10.sql and addendum-12.sql for
// the underlying schema.
async function loadClaudeHistory(){
  if(claudeHistoryLoaded || !currentUser) return;
  claudeHistoryLoaded = true; // set eagerly so a near-simultaneous second call (tab and float opened together) can't double-fetch
  await Promise.all([loadClaudeConversationsList(), loadClaudeProjectsList()]);
  renderClaudeSidebarProjects();
  if(claudeConversationsList.length){
    await openClaudeConversation(claudeConversationsList[0].id);
  } else {
    renderClaudeConversationsSidebar();
  }
}

async function loadClaudeConversationsList(){
  if(!currentUser) return;
  const { data, error } = await supabaseClient
    .from('claude_conversations').select('id, title, updated_at, pinned, project_id')
    .eq('user_id', currentUser.id).order('pinned', { ascending:false }).order('updated_at', { ascending:false });
  if(error){ console.error('loadClaudeConversationsList error', error); return; }
  claudeConversationsList = data || [];
}

async function openClaudeConversation(id){
  const { data, error } = await supabaseClient
    .from('claude_chat_messages').select('role, content')
    .eq('conversation_id', id).order('created_at', { ascending:true }).limit(CLAUDE_HISTORY_DISPLAY_LIMIT);
  if(error){ console.error('openClaudeConversation error', error); return; }
  claudeConversationId = id;
  claudeConversation = (data||[]).map(m=>({ role:m.role, content:m.content }));
  resetClaudeTabInput();
  showClaudeMainArea('chat');
  renderClaudeConversationsSidebar();
  renderClaudeMessages();
}

// Doesn't create a row in claude_conversations yet — matching Claude.ai's
// own behavior, an empty "New chat" you never actually send anything in
// shouldn't clutter the sidebar. The real row gets created by
// ensureClaudeConversation() the moment the first message actually sends.
function startNewClaudeConversation(){
  claudeConversationId = null;
  claudeConversation = [];
  claudePendingProjectId = null; // an unrelated "New chat" click shouldn't inherit a leftover project tag from a previous "New chat in this project" action
  claudeQuickActionsPicked = []; // forces layoutClaudeSurface to pick a fresh set of suggestions for this new empty session
  resetClaudeTabInput();
  showClaudeMainArea('chat');
  renderClaudeConversationsSidebar();
  renderClaudeMessages();
}

// A half-typed draft from the conversation you're leaving shouldn't
// silently carry over into whichever one you switch to.
function resetClaudeTabInput(){
  const inputEl = document.getElementById('claudeTabInput');
  if(inputEl){ inputEl.value = ''; inputEl.style.height = 'auto'; }
}

// Swaps the tab's main content area between the normal chat surface
// (messages/empty-hero/input-dock) and the Projects screen — they share
// the same space rather than living side by side, since only one is ever
// relevant at a time.
function showClaudeMainArea(mode){
  const messagesEl = document.getElementById('claudeTabMessages');
  const heroEl = document.getElementById('claudeTabEmptyHero');
  const dockEl = document.getElementById('claudeTabInputDock');
  const projectsEl = document.getElementById('claudeProjectsView');
  if(!messagesEl || !heroEl || !dockEl || !projectsEl) return;
  if(mode === 'projects'){
    messagesEl.style.display = 'none';
    heroEl.style.display = 'none';
    dockEl.style.display = 'none';
    projectsEl.style.display = 'flex';
  } else {
    projectsEl.style.display = 'none';
    layoutClaudeSurface('claudeTab'); // restores whichever of messages/hero + dock actually applies
  }
}

async function loadClaudeProjectsList(){
  if(!currentUser) return;
  const { data, error } = await supabaseClient
    .from('claude_projects').select('id, name, description, updated_at')
    .eq('user_id', currentUser.id).order('name', { ascending:true });
  if(error){ console.error('loadClaudeProjectsList error', error); return; }
  claudeProjectsList = data || [];
}

function renderClaudeSidebarProjects(){
  const el = document.getElementById('claudeSidebarProjectsList');
  if(!el) return;
  el.innerHTML = claudeProjectsList.length
    ? claudeProjectsList.map(p=>`
        <div class="claude-sidebar-row${p.id===claudeCurrentProjectId?' active':''}">
          <button type="button" class="claude-sidebar-item" onclick="openClaudeProjectDetail('${p.id}')" title="${escapeHtml(p.name)}">
            <svg width="12" height="12" viewBox="0 0 256 256" class="claude-sidebar-pin-icon" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round">${CLAUDE_SIDEBAR_ICONS.folder}</svg>
            <span class="claude-sidebar-item-label">${escapeHtml(p.name)}</span>
          </button>
        </div>
      `).join('')
    : `<p style="font-size:12.5px;color:var(--muted-lt);padding:8px 10px;margin:0;">No projects yet.</p>`;
}

function openClaudeProjectsView(){
  claudeCurrentProjectId = null;
  showClaudeMainArea('projects');
  renderClaudeSidebarProjects();
  renderClaudeProjectsMain();
}

function openClaudeProjectDetail(id){
  claudeCurrentProjectId = id;
  showClaudeMainArea('projects');
  renderClaudeSidebarProjects();
  renderClaudeProjectsMain();
}

function renderClaudeProjectsMain(){
  const el = document.getElementById('claudeProjectsView');
  if(!el) return;
  if(claudeCurrentProjectId) renderClaudeProjectDetailView(el);
  else renderClaudeProjectsListView(el);
}

// Header (search + New project) and grid are rendered separately —
// filterClaudeProjects() only ever touches the grid afterward, so typing
// in the search box never rebuilds (and un-focuses) the input itself.
// Rescues the one real chat input element before any innerHTML rewrite
// that might currently contain it as a descendant — used before
// re-rendering either Projects screen, since the input can be embedded
// inside a project's detail view (see renderClaudeProjectDetailView) and
// blindly replacing that container's innerHTML would otherwise destroy
// the actual singleton textarea, not just move it.
function rescueClaudeInputRow(){
  const inputRow = document.getElementById('claudeTabInputRow');
  const dock = document.getElementById('claudeTabInputDock');
  if(inputRow && dock && inputRow.parentElement !== dock) dock.appendChild(inputRow);
}

function renderClaudeProjectsListView(el){
  rescueClaudeInputRow();
  el.innerHTML = `
    <div class="claude-projects-header">
      <div class="claude-search-wrap">
        <svg class="claude-search-icon" width="14" height="14" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M229.66,218.34l-50.07-50.06a88.11,88.11,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.32ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z"/></svg>
        <input type="text" id="claudeProjectsSearchInput" placeholder="Search projects…" value="${escapeHtml(claudeProjectsSearchQuery)}" oninput="filterClaudeProjects(this.value)">
      </div>
      <button class="btn btn-brand" style="flex:none;" onclick="openNewClaudeProjectModal()">+ New project</button>
    </div>
    <div class="claude-projects-grid" id="claudeProjectsGrid"></div>`;
  renderClaudeProjectsGrid();
}

function renderClaudeProjectsGrid(){
  const gridEl = document.getElementById('claudeProjectsGrid');
  if(!gridEl) return;
  const q = claudeProjectsSearchQuery.trim().toLowerCase();
  const filtered = q ? claudeProjectsList.filter(p=>p.name.toLowerCase().includes(q)) : claudeProjectsList;
  gridEl.innerHTML = filtered.length
    ? filtered.map(p=>`
        <div class="claude-project-card" onclick="openClaudeProjectDetail('${p.id}')">
          <div class="claude-project-card-name">${escapeHtml(p.name)}</div>
          <div class="claude-project-card-desc">${p.description ? escapeHtml(p.description) : '<span style="color:var(--muted-lt);">No description</span>'}</div>
        </div>`).join('')
    : `<p style="font-size:13.5px;color:var(--muted-lt);grid-column:1/-1;">${q ? 'No projects match your search.' : 'No projects yet — create one to get started.'}</p>`;
}

function filterClaudeProjects(value){
  claudeProjectsSearchQuery = value;
  renderClaudeProjectsGrid();
}

// Viewing a project's detail always represents "start something new in
// this project" — the real chat input gets embedded directly here (moved
// in, not duplicated) instead of requiring an extra "+ New chat" click
// first. Sending from here works exactly like sendClaudeMessage() always
// has; it just switches the view to the normal chat surface the moment a
// message actually goes out (see sendClaudeMessage's projects-view check).
function renderClaudeProjectDetailView(el){
  const project = claudeProjectsList.find(p=>p.id===claudeCurrentProjectId);
  if(!project){ claudeCurrentProjectId = null; renderClaudeProjectsListView(el); return; }
  rescueClaudeInputRow();
  claudeConversationId = null;
  claudeConversation = [];
  claudePendingProjectId = project.id;
  el.innerHTML = `
    <div class="claude-project-detail-head">
      <div></div>
      <div style="display:flex;align-items:center;gap:8px;">
        <button class="btn btn-outline" onclick="openEditClaudeProjectModal('${project.id}')">Edit</button>
        <button class="btn btn-outline" style="color:var(--red);" onclick="deleteClaudeProject('${project.id}')">Delete</button>
      </div>
    </div>
    <div class="claude-project-detail-body">
      <div class="claude-project-detail-title">${escapeHtml(project.name)}</div>
      <p class="claude-project-detail-desc">${project.description ? escapeHtml(project.description) : 'No description.'}</p>
      <div class="claude-project-chat-input-slot" id="claudeProjectInputSlot"></div>
      <div class="claude-sidebar-heading" style="margin-top:22px;">Recent</div>
      <div id="claudeProjectConversationsList"></div>
    </div>`;
  resetClaudeTabInput();
  const inputRow = document.getElementById('claudeTabInputRow');
  const slot = document.getElementById('claudeProjectInputSlot');
  if(inputRow && slot) slot.appendChild(inputRow);
  loadClaudeProjectConversations(project.id);
}

async function loadClaudeProjectConversations(projectId){
  const { data, error } = await supabaseClient
    .from('claude_conversations').select('id, title, updated_at')
    .eq('project_id', projectId).order('updated_at', { ascending:false });
  const listEl = document.getElementById('claudeProjectConversationsList');
  if(!listEl) return;
  if(error){ console.error('loadClaudeProjectConversations error', error); listEl.innerHTML = ''; return; }
  listEl.innerHTML = (data && data.length)
    ? data.map((c,i)=>`
        <button type="button" class="claude-project-conv-row${i===data.length-1?' claude-project-conv-row-last':''}" onclick="openClaudeConversation('${c.id}')" title="${escapeHtml(c.title)}">
          <svg width="14" height="14" viewBox="0 0 256 256" class="claude-project-conv-icon" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M88,104a8,8,0,0,1,8-8h64a8,8,0,0,1,0,16H96A8,8,0,0,1,88,104Zm8,40h64a8,8,0,0,0,0-16H96a8,8,0,0,0,0,16ZM232,56V184a16,16,0,0,1-16,16H155.57l-13.68,23.94a16,16,0,0,1-27.78,0L100.43,200H40a16,16,0,0,1-16-16V56A16,16,0,0,1,40,40H216A16,16,0,0,1,232,56Zm-16,0H40V184h65.07a8,8,0,0,1,7,4l16,28,16-28a8,8,0,0,1,7-4H216Z"/></svg>
          <span class="claude-project-conv-title">${escapeHtml(c.title)}</span>
          <span class="claude-project-conv-date">${new Date(c.updated_at).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</span>
        </button>`).join('')
    : `<p style="font-size:13px;color:var(--muted-lt);">No conversations in this project yet.</p>`;
}

function openNewClaudeProjectModal(){
  openAppModal(`
    <div class="modal-head"><span class="panel-title">New project</span><span class="toast-close" onclick="closeAppModal()">✕</span></div>
    <div class="modal-body">
      <div class="settings-field"><label>Name</label><input id="claudeProjectNameInput" style="width:100%;" placeholder="e.g. Q3 Client Campaigns"></div>
      <div class="settings-field"><label>Description <span style="font-weight:400;color:var(--muted-lt);">(optional)</span></label><textarea id="claudeProjectDescInput" style="width:100%;min-height:80px;font-family:var(--font);font-size:14px;padding:10px;border-radius:8px;border:1px solid var(--border);resize:vertical;" placeholder="What's this project about?"></textarea></div>
    </div>
    <div class="modal-actions"><button class="btn btn-outline" onclick="closeAppModal()">Cancel</button><button class="btn btn-brand" onclick="submitNewClaudeProject()">Create</button></div>`, 460);
  setTimeout(()=>{ document.getElementById('claudeProjectNameInput')?.focus(); }, 50);
}

async function submitNewClaudeProject(){
  const name = document.getElementById('claudeProjectNameInput').value.trim();
  const description = document.getElementById('claudeProjectDescInput').value.trim();
  if(!name){ showToast('error','Missing name','Give the project a name first.'); return; }
  const btn = clickedBtn();
  setBtnLoading(btn, 'Creating…');
  const { error } = await supabaseClient.from('claude_projects').insert({ user_id: currentUser.id, name, description: description || null });
  restoreBtn(btn);
  if(error){ showToast('error','Could not create','Try again.'); return; }
  closeAppModal();
  await loadClaudeProjectsList();
  renderClaudeSidebarProjects();
  if(document.getElementById('claudeProjectsView')?.style.display !== 'none') renderClaudeProjectsMain();
}

function openEditClaudeProjectModal(id){
  const project = claudeProjectsList.find(p=>p.id===id);
  if(!project) return;
  openAppModal(`
    <div class="modal-head"><span class="panel-title">Edit project</span><span class="toast-close" onclick="closeAppModal()">✕</span></div>
    <div class="modal-body">
      <div class="settings-field"><label>Name</label><input id="claudeProjectNameInput" style="width:100%;" value="${escapeHtml(project.name||'')}"></div>
      <div class="settings-field"><label>Description</label><textarea id="claudeProjectDescInput" style="width:100%;min-height:80px;font-family:var(--font);font-size:14px;padding:10px;border-radius:8px;border:1px solid var(--border);resize:vertical;">${escapeHtml(project.description||'')}</textarea></div>
    </div>
    <div class="modal-actions"><button class="btn btn-outline" onclick="closeAppModal()">Cancel</button><button class="btn btn-brand" onclick="submitEditClaudeProject('${id}')">Save</button></div>`, 460);
  setTimeout(()=>{ document.getElementById('claudeProjectNameInput')?.focus(); }, 50);
}

async function submitEditClaudeProject(id){
  const name = document.getElementById('claudeProjectNameInput').value.trim();
  const description = document.getElementById('claudeProjectDescInput').value.trim();
  if(!name){ showToast('error','Missing name','Give the project a name first.'); return; }
  const btn = clickedBtn();
  setBtnLoading(btn, 'Saving…');
  const { error } = await supabaseClient.from('claude_projects').update({ name, description: description || null, updated_at: new Date().toISOString() }).eq('id', id);
  restoreBtn(btn);
  if(error){ showToast('error','Could not save','Try again.'); return; }
  closeAppModal();
  await loadClaudeProjectsList();
  renderClaudeSidebarProjects();
  renderClaudeProjectsMain();
}

async function deleteClaudeProject(id){
  if(!(await confirmDialog('Delete this project? Its conversations stay — they just get unlinked from it.', {confirmLabel:'Delete', destructive:true}))) return;
  const { error } = await supabaseClient.from('claude_projects').delete().eq('id', id);
  if(error){ showToast('error','Could not delete','Try again.'); return; }
  claudeCurrentProjectId = null;
  await loadClaudeProjectsList();
  renderClaudeSidebarProjects();
  openClaudeProjectsView();
}

const CLAUDE_SIDEBAR_ICONS = {
  pin: '<line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>',
  rename: '<path d="M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM92.69,208H48V163.31l88-88L180.69,120ZM192,108.68,147.31,64l24-24L216,84.68Z"/>',
  trash: '<path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z"/>',
  folder: '<path d="M216,72H130.67L102.93,51.2a16.12,16.12,0,0,0-9.6-3.2H40A16,16,0,0,0,24,64V200a16,16,0,0,0,16,16H216.89A15.13,15.13,0,0,0,232,200.89V88A16,16,0,0,0,216,72Zm0,128H40V64H93.33L123.2,86.4A8,8,0,0,0,128,88h88Z"/>',
  chevronRight: '<path d="M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z"/>',
  dot: '<path d="M232,128A104,104,0,1,1,128,24,104.13,104.13,0,0,1,232,128Z"/>',
  pinFill: '<path d="M235.33,104l-53.47,53.65c4.56,12.67,6.45,33.89-13.19,60A15.93,15.93,0,0,1,157,224c-.38,0-.75,0-1.13,0a16,16,0,0,1-11.32-4.69L96.29,171,53.66,213.66a8,8,0,0,1-11.32-11.32L85,159.71l-48.3-48.3A16,16,0,0,1,38,87.63c25.42-20.51,49.75-16.48,60.4-13.14L152,20.7a16,16,0,0,1,22.63,0l60.69,60.68A16,16,0,0,1,235.33,104Z"/>',
};

function renderClaudeConversationsSidebar(){
  const el = document.getElementById('claudeSidebarList');
  if(!el) return;
  syncClaudeFloatButtonToggle();
  renderClaudeBulkBar();
  // Any menu currently open got moved to document.body by
  // toggleClaudeSidebarMenu() below — it's about to be replaced by a
  // fresh one with the same id anyway, so the orphaned copy needs
  // cleaning up explicitly or it'd sit invisible in the DOM forever.
  document.querySelectorAll('body > .claude-sidebar-menu').forEach(m=>m.remove());
  el.innerHTML = claudeConversationsList.length
    ? claudeConversationsList.map(c=>`
        <div class="claude-sidebar-row${c.id===claudeConversationId?' active':''}">
          ${claudeBulkMode ? `
          <label class="claude-sidebar-checkbox-wrap">
            <input type="checkbox" ${claudeBulkSelected.has(c.id)?'checked':''} onchange="toggleClaudeBulkSelect('${c.id}')">
          </label>` : ''}
          <button type="button" class="claude-sidebar-item" onclick="${claudeBulkMode ? `toggleClaudeBulkSelect('${c.id}')` : `openClaudeConversation('${c.id}')`}" title="${escapeHtml(c.title)}">
            ${c.pinned
              ? `<svg width="11" height="11" viewBox="0 0 256 256" class="claude-sidebar-pin-icon" fill="currentColor">${CLAUDE_SIDEBAR_ICONS.pinFill}</svg>`
              : `<svg width="7" height="7" viewBox="0 0 256 256" class="claude-sidebar-pin-icon" fill="currentColor">${CLAUDE_SIDEBAR_ICONS.dot}</svg>`}
            <span class="claude-sidebar-item-label">${escapeHtml(c.title)}</span>
          </button>
          ${claudeBulkMode ? '' : `
          <button type="button" class="claude-sidebar-menu-btn" id="claudeSidebarMenuBtn-${c.id}" onclick="toggleClaudeSidebarMenu(event,'${c.id}')" title="More">
            <svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M112,60a16,16,0,1,1,16,16A16,16,0,0,1,112,60Zm16,52a16,16,0,1,0,16,16A16,16,0,0,0,128,112Zm0,68a16,16,0,1,0,16,16A16,16,0,0,0,128,180Z"/></svg>
          </button>
          <div class="claude-sidebar-menu" id="claudeSidebarMenu-${c.id}" style="display:none;">
            <button type="button" onclick="renameClaudeConversation('${c.id}')"><svg width="13" height="13" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round">${CLAUDE_SIDEBAR_ICONS.rename}</svg> Rename</button>
            <button type="button" onclick="togglePinClaudeConversation('${c.id}', ${!c.pinned})"><svg width="13" height="13" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round">${CLAUDE_SIDEBAR_ICONS.pin}</svg> ${c.pinned?'Unpin':'Pin'}</button>
            ${c.project_id ? `
            <div style="position:relative;">
              <button type="button" onclick="toggleClaudeSidebarProjectSubmenu(event,'${c.id}')" style="justify-content:space-between;">
                <span style="display:flex;align-items:center;gap:8px;"><svg width="13" height="13" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round">${CLAUDE_SIDEBAR_ICONS.folder}</svg> Change project</span>
                <svg width="12" height="12" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round">${CLAUDE_SIDEBAR_ICONS.chevronRight}</svg>
              </button>
              <div class="claude-provider-menu" id="claudeSidebarProjectSubmenu-${c.id}" style="display:none;left:calc(100% + 6px);top:-6px;bottom:auto;width:180px;"></div>
            </div>
            <button type="button" style="color:var(--muted);" onclick="removeClaudeConversationFromProjectMenu('${c.id}')"><svg width="13" height="13" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round">${CLAUDE_SIDEBAR_ICONS.folder}</svg> Remove from project</button>
            ` : `
            <div style="position:relative;">
              <button type="button" onclick="toggleClaudeSidebarProjectSubmenu(event,'${c.id}')" style="justify-content:space-between;">
                <span style="display:flex;align-items:center;gap:8px;"><svg width="13" height="13" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round">${CLAUDE_SIDEBAR_ICONS.folder}</svg> Add to project</span>
                <svg width="12" height="12" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round">${CLAUDE_SIDEBAR_ICONS.chevronRight}</svg>
              </button>
              <div class="claude-provider-menu" id="claudeSidebarProjectSubmenu-${c.id}" style="display:none;left:calc(100% + 6px);top:-6px;bottom:auto;width:180px;"></div>
            </div>
            `}
            <button type="button" style="color:var(--red);" onclick="deleteClaudeConversationFromMenu('${c.id}')"><svg width="13" height="13" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round">${CLAUDE_SIDEBAR_ICONS.trash}</svg> Delete</button>
          </div>`}
        </div>
      `).join('')
    : `<p style="font-size:12.5px;color:var(--muted-lt);padding:8px 10px;margin:0;">No conversations yet.</p>`;
}

// Bulk actions on Assistant conversations — select multiple, then pin,
// unpin, move to a project, or delete them together, instead of needing
// the 3-dot menu once per conversation.
function toggleClaudeBulkMode(){
  claudeBulkMode = !claudeBulkMode;
  claudeBulkSelected.clear();
  const link = document.getElementById('claudeBulkSelectLink');
  if(link) link.textContent = claudeBulkMode ? 'Cancel' : 'Select';
  renderClaudeConversationsSidebar();
}

function toggleClaudeBulkSelect(id){
  if(claudeBulkSelected.has(id)) claudeBulkSelected.delete(id);
  else claudeBulkSelected.add(id);
  renderClaudeConversationsSidebar();
}

function renderClaudeBulkBar(){
  const link = document.getElementById('claudeBulkSelectLink');
  if(link) link.textContent = claudeBulkMode ? 'Cancel' : 'Select';
  const bar = document.getElementById('claudeBulkBar');
  if(!bar) return;
  if(!claudeBulkMode){ bar.style.display = 'none'; return; }
  bar.style.display = 'block';
  const n = claudeBulkSelected.size;
  bar.innerHTML = `
    <div class="claude-bulk-bar-head">
      <span class="claude-bulk-bar-count">${n} selected</span>
      <span class="claude-bulk-select-link" onclick="toggleClaudeBulkMode()">Done</span>
    </div>
    <div class="claude-bulk-bar-actions">
      <button type="button" class="claude-popup-menu-btn" ${n?'':'disabled'} onclick="bulkPinClaudeConversations(true)"><svg width="13" height="13" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round">${CLAUDE_SIDEBAR_ICONS.pin}</svg> Pin selected</button>
      <button type="button" class="claude-popup-menu-btn" ${n?'':'disabled'} onclick="bulkPinClaudeConversations(false)"><svg width="13" height="13" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round">${CLAUDE_SIDEBAR_ICONS.pin}</svg> Unpin selected</button>
      <button type="button" class="claude-popup-menu-btn" ${n?'':'disabled'} onclick="openClaudeBulkAddToProjectModal()"><svg width="13" height="13" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round">${CLAUDE_SIDEBAR_ICONS.folder}</svg> Add to project</button>
      <button type="button" class="claude-popup-menu-btn" style="color:var(--red);" ${n?'':'disabled'} onclick="bulkDeleteClaudeConversations()"><svg width="13" height="13" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round">${CLAUDE_SIDEBAR_ICONS.trash}</svg> Delete selected</button>
    </div>`;
}

async function bulkPinClaudeConversations(pin){
  const ids = [...claudeBulkSelected];
  if(!ids.length) return;
  const { error } = await supabaseClient.from('claude_conversations').update({ pinned: pin }).in('id', ids);
  if(error){ showToast('error','Could not update','Try again.'); return; }
  showToast('success', pin?'Pinned':'Unpinned', `${ids.length} conversation${ids.length!==1?'s':''} ${pin?'pinned':'unpinned'}.`);
  claudeBulkSelected.clear();
  claudeBulkMode = false;
  await loadClaudeConversationsList();
  renderClaudeConversationsSidebar();
}

async function bulkDeleteClaudeConversations(){
  const ids = [...claudeBulkSelected];
  if(!ids.length) return;
  if(!(await confirmDialog(`Delete ${ids.length} conversation${ids.length!==1?'s':''}? This deletes them for good, including their message history.`, {confirmLabel:'Delete', destructive:true}))) return;
  const { error } = await supabaseClient.from('claude_conversations').delete().in('id', ids);
  if(error){ showToast('error','Could not delete','Try again.'); return; }
  if(ids.includes(claudeConversationId)){
    claudeConversationId = null;
    claudeConversation = [];
    resetClaudeTabInput();
    renderClaudeMessages();
  }
  showToast('success','Deleted', `${ids.length} conversation${ids.length!==1?'s':''} deleted.`);
  claudeBulkSelected.clear();
  claudeBulkMode = false;
  await loadClaudeConversationsList();
  renderClaudeConversationsSidebar();
}

// A modal rather than a hover-out submenu (unlike the single-item 3-dot
// menu's "Add to project") — the sidebar's own scroll clipping would
// need the same document.body portal trick to pop a submenu out of it,
// and a bulk action affecting several conversations at once is worth a
// deliberate, clearly-labeled picker anyway rather than a quick inline menu.
function openClaudeBulkAddToProjectModal(){
  const n = claudeBulkSelected.size;
  if(!n) return;
  if(!claudeProjectsList.length){ showToast('info','No projects yet','Create one from the Projects tab first.'); return; }
  openAppModal(`
    <div class="modal-head"><span class="panel-title">Add ${n} chat${n!==1?'s':''} to a project</span><span class="toast-close" onclick="closeAppModal()">✕</span></div>
    <div class="modal-body">
      <div style="display:flex;flex-direction:column;gap:2px;max-height:280px;overflow-y:auto;">
        ${claudeProjectsList.map(p=>`<button type="button" class="claude-popup-menu-btn" onclick="bulkAssignClaudeConversationsToProject('${p.id}',${jsArg(p.name||'')})">${escapeHtml(p.name)}</button>`).join('')}
      </div>
    </div>
    <div class="modal-actions"><button class="btn btn-outline" onclick="closeAppModal()">Cancel</button></div>`, 420);
}

async function bulkAssignClaudeConversationsToProject(projectId, projectName){
  const ids = [...claudeBulkSelected];
  if(!ids.length) return;
  const { error } = await supabaseClient.from('claude_conversations').update({ project_id: projectId }).in('id', ids);
  if(error){ showToast('error','Could not update','Try again.'); return; }
  closeAppModal();
  showToast('success','Added to project', `${ids.length} conversation${ids.length!==1?'s':''} added to "${projectName}".`);
  claudeBulkSelected.clear();
  claudeBulkMode = false;
  await loadClaudeConversationsList();
  renderClaudeConversationsSidebar();
}

// Moved to document.body when opened, same reasoning as the calendar
// dropdown elsewhere in this file — .claude-sidebar/.claude-sidebar-list
// both scroll (overflow-y:auto), which would silently clip this menu
// against their bounds if it stayed positioned relative to its row.
// Escaping to body with real computed viewport coordinates sidesteps
// that entirely instead of depending on any ancestor's overflow setting.
function toggleClaudeSidebarMenu(event, id){
  event.stopPropagation();
  document.querySelectorAll('.claude-sidebar-menu').forEach(m=>{ if(m.id !== 'claudeSidebarMenu-'+id) m.style.display = 'none'; });
  const menu = document.getElementById('claudeSidebarMenu-'+id);
  const btn = document.getElementById('claudeSidebarMenuBtn-'+id);
  if(!menu || !btn) return;
  const opening = menu.style.display !== 'block';
  menu.style.display = opening ? 'block' : 'none';
  if(opening){
    if(menu.parentElement !== document.body) document.body.appendChild(menu);
    positionClaudeSidebarMenu(btn, menu);
  }
}

function positionClaudeSidebarMenu(btnEl, menuEl){
  const btnRect = btnEl.getBoundingClientRect();
  const menuRect = menuEl.getBoundingClientRect();
  const gap = 4, edge = 12;
  const vw = window.innerWidth, vh = window.innerHeight;

  let left = btnRect.right - menuRect.width; // right-aligned to the 3-dot button
  let top = btnRect.bottom + gap;
  if(top + menuRect.height > vh - edge) top = btnRect.top - menuRect.height - gap; // flip above if no room below

  left = Math.max(edge, Math.min(left, vw - menuRect.width - edge));
  top = Math.max(edge, Math.min(top, vh - menuRect.height - edge));

  menuEl.style.left = `${left}px`;
  menuEl.style.top = `${top}px`;
}

document.addEventListener('click', (e)=>{
  document.querySelectorAll('.claude-sidebar-menu').forEach(m=>{
    if(m.style.display !== 'block') return;
    const btn = document.getElementById('claudeSidebarMenuBtn-'+m.id.replace('claudeSidebarMenu-',''));
    if(!m.contains(e.target) && e.target !== btn && !btn?.contains(e.target)) m.style.display = 'none';
  });
});

function renameClaudeConversation(id){
  document.getElementById('claudeSidebarMenu-'+id) && (document.getElementById('claudeSidebarMenu-'+id).style.display = 'none');
  const current = claudeConversationsList.find(c=>c.id===id);
  openAppModal(`
    <div class="modal-head"><span class="panel-title">Rename conversation</span><span class="toast-close" onclick="closeAppModal()">✕</span></div>
    <div class="modal-body">
      <div class="settings-field"><label>Title</label><input id="claudeRenameInput" style="width:100%;" value="${escapeHtml(current?.title||'')}" onkeydown="if(event.key==='Enter')submitClaudeRename('${id}')"></div>
    </div>
    <div class="modal-actions"><button class="btn btn-outline" onclick="closeAppModal()">Cancel</button><button class="btn btn-brand" onclick="submitClaudeRename('${id}')">Save</button></div>`, 420);
  setTimeout(()=>{ const el = document.getElementById('claudeRenameInput'); if(el){ el.focus(); el.select(); } }, 50);
}

async function submitClaudeRename(id){
  const input = document.getElementById('claudeRenameInput');
  const trimmed = input ? input.value.trim() : '';
  if(!trimmed){ showToast('error','Missing title','Give it a title first.'); return; }
  const { error } = await supabaseClient.from('claude_conversations').update({ title: trimmed }).eq('id', id);
  if(error){ showToast('error','Could not rename','Try again.'); return; }
  closeAppModal();
  await loadClaudeConversationsList();
  renderClaudeConversationsSidebar();
}

async function togglePinClaudeConversation(id, pin){
  document.getElementById('claudeSidebarMenu-'+id) && (document.getElementById('claudeSidebarMenu-'+id).style.display = 'none');
  const { error } = await supabaseClient.from('claude_conversations').update({ pinned: pin }).eq('id', id);
  if(error){ showToast('error','Could not update','Try again.'); return; }
  await loadClaudeConversationsList();
  renderClaudeConversationsSidebar();
}

// Deletes any conversation directly from the sidebar's 3-dot menu, not
// just the currently open one — clearClaudeChat() (the toolbar "Delete
// chat" button) only ever handles the open conversation, this handles
// any of them without needing to open it first.
async function deleteClaudeConversationFromMenu(id){
  const menu = document.getElementById('claudeSidebarMenu-'+id);
  if(menu) menu.style.display = 'none';
  if(!(await confirmDialog('Delete this conversation? This deletes it for good, including its message history.', {confirmLabel:'Delete', destructive:true}))) return;
  const { error } = await supabaseClient.from('claude_conversations').delete().eq('id', id);
  if(error){ showToast('error','Could not delete','Try again.'); return; }
  if(claudeConversationId === id){
    claudeConversationId = null;
    claudeConversation = [];
    resetClaudeTabInput();
    renderClaudeMessages();
  }
  await loadClaudeConversationsList();
  renderClaudeConversationsSidebar();
}

// The sidebar 3-dot menu's project submenu — "Add to project" if the
// conversation isn't in one yet, "Change project" if it already is
// (Remove from project sits as its own direct action next to it, no
// submenu needed for that one).
function toggleClaudeSidebarProjectSubmenu(event, id){
  event.stopPropagation();
  const submenu = document.getElementById('claudeSidebarProjectSubmenu-'+id);
  if(!submenu) return;
  const opening = submenu.style.display !== 'block';
  submenu.style.display = opening ? 'block' : 'none';
  if(opening) renderClaudeSidebarProjectSubmenu(id);
}

function renderClaudeSidebarProjectSubmenu(id){
  const el = document.getElementById('claudeSidebarProjectSubmenu-'+id);
  if(!el) return;
  if(!claudeProjectsList.length){
    el.innerHTML = `<p style="font-size:12px;color:var(--muted-lt);padding:8px 10px;margin:0;">No projects yet.</p>`;
    return;
  }
  const conv = claudeConversationsList.find(c=>c.id===id);
  const currentProjectId = conv?.project_id || null;
  el.innerHTML = claudeProjectsList.map(p=>`
    <button type="button" class="claude-popup-menu-btn" onclick="assignClaudeConversationToProjectFromSidebar('${id}','${p.id}')">${p.id===currentProjectId?'✓ ':''}${escapeHtml(p.name)}</button>
  `).join('');
}

async function assignClaudeConversationToProjectFromSidebar(convId, projectId){
  const menu = document.getElementById('claudeSidebarMenu-'+convId);
  if(menu) menu.style.display = 'none';
  const { error } = await supabaseClient.from('claude_conversations').update({ project_id: projectId }).eq('id', convId);
  if(error){ showToast('error','Could not update','Try again.'); return; }
  await loadClaudeConversationsList();
  renderClaudeConversationsSidebar();
  const projectName = claudeProjectsList.find(p=>p.id===projectId)?.name || 'the project';
  showToast('success','Added to project', `This chat is now part of "${projectName}".`);
}

async function removeClaudeConversationFromProjectMenu(id){
  const menu = document.getElementById('claudeSidebarMenu-'+id);
  if(menu) menu.style.display = 'none';
  const { error } = await supabaseClient.from('claude_conversations').update({ project_id: null }).eq('id', id);
  if(error){ showToast('error','Could not update','Try again.'); return; }
  await loadClaudeConversationsList();
  renderClaudeConversationsSidebar();
  showToast('success','Removed from project','This chat is no longer part of a project.');
}

// Called once the AI-generated title comes back from claude-chat.js,
// replacing the placeholder truncated-text title ensureClaudeConversation()
// had to use immediately (a real row was needed right away to persist
// messages against, before any AI reply — let alone a title — existed).
async function updateClaudeConversationTitle(id, title){
  const { error } = await supabaseClient.from('claude_conversations').update({ title }).eq('id', id);
  if(error){ console.error('updateClaudeConversationTitle error', error); return; }
  await loadClaudeConversationsList();
  renderClaudeConversationsSidebar();
}

// Creates the real claude_conversations row on the first message of a new
// chat — everything after that just reuses claudeConversationId. Title
// starts as a short truncation of that first message (a real row needs
// SOME title immediately); sendClaudeMessage() swaps in the AI-generated
// one once the reply actually comes back. Tags the row with
// claudePendingProjectId if "New chat in this project" set one — consumed
// (reset to null) here regardless of outcome, so it can never leak into
// some later unrelated conversation.
async function ensureClaudeConversation(firstMessageText){
  if(claudeConversationId) return claudeConversationId;
  const title = (firstMessageText || 'New chat').trim().slice(0, 60) || 'New chat';
  const projectId = claudePendingProjectId;
  claudePendingProjectId = null;
  const { data, error } = await supabaseClient
    .from('claude_conversations').insert({ user_id: currentUser.id, title, project_id: projectId }).select('id').single();
  if(error){ console.error('ensureClaudeConversation error', error); return null; }
  claudeConversationId = data.id;
  await loadClaudeConversationsList();
  renderClaudeConversationsSidebar();
  return claudeConversationId;
}

// Fire-and-forget, same reasoning as logDangerHistory()/logClientActivity()
// elsewhere — this is the persistence layer for a conversation that's
// already fully functional in memory; a save hiccup shouldn't block or
// visibly interrupt the chat itself. Also bumps the conversation's
// updated_at so the sidebar's most-recent-first ordering stays accurate.
function persistClaudeMessage(role, content){
  if(!claudeConversationId) return; // ensureClaudeConversation() should always run first — see sendClaudeMessage
  supabaseClient.from('claude_chat_messages').insert({ user_id: currentUser.id, conversation_id: claudeConversationId, role, content }).then(({error})=>{
    if(error) console.error('persistClaudeMessage error', error);
  });
  supabaseClient.from('claude_conversations').update({ updated_at: new Date().toISOString() }).eq('id', claudeConversationId).then(({error})=>{
    if(error) console.error('persistClaudeMessage updated_at error', error);
    else { loadClaudeConversationsList().then(renderClaudeConversationsSidebar); }
  });
}

function buildClaudeContext(){
  const rows = activeClients().filter(c=>c.status!=='Paused').map(c=>{
    const lastImp = [...(c.improvements||[])].sort((a,b)=>new Date(b.date)-new Date(a.date))[0];
    const lastImpStr = lastImp ? `last logged ${new Date(lastImp.date).toLocaleDateString('en-US',{month:'short',day:'numeric'})}` : 'nothing logged yet';
    // A client can have several independent drafts now (one per author,
    // see addendum-25.sql) — summarized as "author: status" pairs rather
    // than one single status, so the assistant can see who's contributed
    // and where each of their drafts stands.
    const draftsSummary = (c.drafts||[]).filter(d=>d.draftStatus!=='none').map(d=>`${d.author}: ${d.draftStatus}`).join(', ') || 'none';
    return `- ${c.name}${c.website ? ` (${c.website})` : ''}: risk ${riskLabel(c.danger).text}, ${lastImpStr}, drafts: ${draftsSummary}`;
  });
  return rows.join('\n');
}

// Moves the real input+send-button pair (there's only ever one per
// surface — no duplicated elements to keep in sync) between two homes:
// centered in the empty-state hero (Gemini-style: big greeting, big pill
// input) when there's no conversation yet, or docked at the bottom once
// messages exist. Same "move the real DOM node, don't duplicate it"
// technique already used for the calendar dropdown elsewhere in this file.
function layoutClaudeSurface(prefix){
  const messagesEl = document.getElementById(prefix+'Messages');
  const heroEl = document.getElementById(prefix+'EmptyHero');
  const dockEl = document.getElementById(prefix+'InputDock');
  const slotEl = document.getElementById(prefix+'InputSlot');
  const rowEl = document.getElementById(prefix+'InputRow');
  const greetingEl = document.getElementById(prefix+'Greeting');
  if(!messagesEl || !heroEl || !dockEl || !slotEl || !rowEl) return;

  // Tab-only control (only exists in that surface's markup), synced here
  // since this already runs on every render — cheap to repeat.
  syncClaudeProviderBtnLabel();

  const isEmpty = claudeConversation.length===0 && !claudeSending;
  if(isEmpty){
    const firstName = (myProfile?.name||'').trim().split(/\s+/)[0];
    if(greetingEl) greetingEl.textContent = firstName ? `It's your turn, ${firstName}!` : `What can I help with?`;
    messagesEl.style.display = 'none';
    dockEl.style.display = 'none';
    heroEl.style.display = 'flex';
    // Lazy-picked once per empty session, not on every render while
    // already sitting empty — claudeQuickActionsPicked only gets cleared
    // (forcing a fresh pick here) when a genuinely new blank chat starts,
    // so these don't jarringly reshuffle mid-session for unrelated
    // reasons like docking/undocking.
    if(!claudeQuickActionsPicked.length) pickClaudeQuickActions();
    renderClaudeQuickActions();
    rowEl.classList.add('pill-mode');
    // Only meaningful for the tab (see #claudeTabInputRow.claude-input-active
    // in CSS) — harmless no-op on the float's row, which has no matching rule.
    rowEl.classList.remove('claude-input-active');
    if(rowEl.parentElement !== slotEl) slotEl.appendChild(rowEl);
  } else {
    heroEl.style.display = 'none';
    messagesEl.style.display = 'flex';
    dockEl.style.display = 'block';
    rowEl.classList.remove('pill-mode');
    // Once a conversation is actually underway, the tab's input drops the
    // glow and switches to a flatter, calmer dark look — the glow is a
    // "start typing" invitation on the empty screen, not something that
    // needs to keep drawing the eye once you're mid-conversation.
    rowEl.classList.add('claude-input-active');
    if(rowEl.parentElement !== dockEl) dockEl.insertBefore(rowEl, dockEl.firstChild);
  }
}

// Only the Assistant's own replies get parsed as markdown — the person's
// own typed messages stay plain escaped text (a chat app shouldn't
// reinterpret someone's literal "### thoughts" as a heading just because
// it looks like markdown syntax). Sanitized with DOMPurify regardless of
// marked's own escaping, since the Assistant's reply can itself echo back
// something the person typed — defense in depth against that being
// interpreted as real HTML. Falls back to plain escaped text if the CDN
// libraries didn't load for some reason, rather than silently producing
// nothing.
function renderClaudeMessageContent(role, content){
  if(role === 'assistant' && typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined'){
    try{ return DOMPurify.sanitize(marked.parse(content)); }
    catch(e){ console.error('markdown render error', e); }
  }
  return escapeHtml(content);
}

function renderClaudeMessages(animateLatest){
  const html = claudeConversation.map((m,i)=>
    `<div class="claude-msg claude-msg-${escapeHtml(m.role)}" data-msg-idx="${i}">${renderClaudeMessageContent(m.role, m.content)}</div>`
  ).join('') + (claudeSending ? `<div class="claude-msg-typing"><span></span><span></span><span></span></div>` : '');
  const lastIdx = claudeConversation.length - 1;
  const shouldAnimate = animateLatest && lastIdx >= 0 && claudeConversation[lastIdx].role === 'assistant';
  ['claudeTabMessages','claudeFloatMessages'].forEach(id=>{
    const el = document.getElementById(id);
    if(!el) return;
    el.innerHTML = html;
    el.scrollTop = el.scrollHeight;
    if(shouldAnimate){
      const lastMsgEl = el.querySelector(`.claude-msg[data-msg-idx="${lastIdx}"]`);
      if(lastMsgEl) revealClaudeMessage(lastMsgEl);
    }
  });
  layoutClaudeSurface('claudeTab');
  layoutClaudeSurface('claudeFloat');
}

// Reveals a freshly-arrived assistant reply element by element (paragraphs,
// headings, list items) with a short stagger between each, instead of the
// whole response just popping in as one block. Only ever applied to the
// single newest message right when it arrives (see renderClaudeMessages'
// animateLatest param) — never to history being loaded or a conversation
// being switched to, which should just appear normally, not replay an
// entrance animation every time.
function revealClaudeMessage(msgEl){
  const targets = [];
  msgEl.querySelectorAll(':scope > *').forEach(child=>{
    if(child.tagName === 'UL' || child.tagName === 'OL'){
      child.querySelectorAll(':scope > li').forEach(li => targets.push(li));
    } else {
      targets.push(child);
    }
  });
  if(!targets.length) return; // plain-text content with no block elements — nothing to stagger
  targets.forEach((el,i)=>{
    el.classList.add('claude-reveal-item');
    el.style.transitionDelay = `${i*55}ms`;
  });
  // Two rAFs, not one — the browser needs a full paint with the item still
  // at opacity:0 before the .claude-reveal-in class is added, or the
  // transition can get skipped entirely (the "before" and "after" states
  // both get set in the same frame, so there's nothing to visually
  // transition between).
  requestAnimationFrame(()=>{
    requestAnimationFrame(()=>{
      targets.forEach(el=>el.classList.add('claude-reveal-in'));
    });
  });
}

// Grows the textarea as you type, up to 6 lines' worth of height (the CSS
// max-height on .claude-chat-input), then lets it scroll internally
// beyond that instead of growing further.
// Not wired to a real feature yet — claude-chat.js only accepts text
// today, so this is honest about that rather than silently doing nothing
// when clicked (which would just look broken).
// Per-person, per-device override of which AI answers — stored locally
// (like the floating button's dragged position elsewhere in this file),
// not synced anywhere, since it's a personal preference, not a team-wide
// setting. No "Default"/admin-follows-Settings option — always resolves
// to a real provider, defaulting to ChatGPT the first time.
const CLAUDE_PROVIDER_OPTIONS = [
  { value:'openai', name:'ChatGPT', desc:'Fast and versatile — great for everyday questions and quick drafts.' },
  { value:'claude', name:'Claude', desc:'Strong reasoning — great for nuanced writing and careful analysis.' },
];

function loadClaudeProviderOverride(){
  try { return localStorage.getItem('claude_provider_override') || 'openai'; } catch(e) { return 'openai'; }
}
function saveClaudeProviderOverride(value){
  try { localStorage.setItem('claude_provider_override', value); } catch(e) {}
}

function syncClaudeProviderBtnLabel(){
  const labelEl = document.getElementById('claudeProviderBtnLabel');
  if(!labelEl) return;
  const current = loadClaudeProviderOverride();
  const opt = CLAUDE_PROVIDER_OPTIONS.find(o=>o.value===current) || CLAUDE_PROVIDER_OPTIONS[0];
  labelEl.textContent = opt.name;
}

function renderClaudeProviderMenu(){
  const menu = document.getElementById('claudeProviderMenu');
  if(!menu) return;
  const current = loadClaudeProviderOverride();
  menu.innerHTML = CLAUDE_PROVIDER_OPTIONS.map(o=>`
    <button type="button" class="claude-provider-option${o.value===current?' selected':''}" onclick="selectClaudeProviderOverride('${o.value}')">
      <span class="claude-provider-option-name">${o.value===current?'✓ ':''}${escapeHtml(o.name)}</span>
      <span class="claude-provider-option-desc">${o.desc}</span>
    </button>`).join('');
}

function toggleClaudeProviderMenu(event){
  event?.stopPropagation();
  const menu = document.getElementById('claudeProviderMenu');
  if(!menu) return;
  const opening = menu.style.display !== 'block';
  menu.style.display = opening ? 'block' : 'none';
  if(opening) renderClaudeProviderMenu();
}

function selectClaudeProviderOverride(value){
  saveClaudeProviderOverride(value);
  const menu = document.getElementById('claudeProviderMenu');
  if(menu) menu.style.display = 'none';
  syncClaudeProviderBtnLabel();
}

document.addEventListener('click', (e)=>{
  const menu = document.getElementById('claudeProviderMenu');
  const btn = document.getElementById('claudeProviderBtn');
  if(menu && menu.style.display==='block' && !menu.contains(e.target) && e.target!==btn && !btn?.contains(e.target)){
    menu.style.display = 'none';
  }
});

function handleClaudeImageButtonClick(){
  showToast('info','Coming soon','Image uploads for the Assistant aren\'t available yet.');
}

// The "+" button's pop-up menu — Add image (placeholder, see above) and
// Add to project, which opens a submenu of this person's projects.
// Re-rendered fresh every time it opens, since the "Add to project" row's
// own label depends on whether the currently open conversation already
// belongs to one.
function toggleClaudePlusMenu(event){
  event.stopPropagation();
  const menu = document.getElementById('claudePlusMenu');
  if(!menu) return;
  const opening = menu.style.display !== 'block';
  menu.style.display = opening ? 'block' : 'none';
  if(opening) renderClaudePlusMenu();
}

function renderClaudePlusMenu(){
  const menuEl = document.getElementById('claudePlusMenu');
  if(!menuEl) return;
  const currentConv = claudeConversationsList.find(c=>c.id===claudeConversationId);
  const currentProject = currentConv?.project_id ? claudeProjectsList.find(p=>p.id===currentConv.project_id) : null;
  menuEl.innerHTML = `
    <button type="button" class="claude-popup-menu-btn" onclick="handleClaudeImageButtonClick()">
      <svg width="13" height="13" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40Zm0,16V158.75l-26.07-26.06a16,16,0,0,0-22.63,0l-20,20-44-44a16,16,0,0,0-22.62,0L40,149.37V56ZM40,172l52-52,80,80H40Zm176,28H194.63l-36-36,20-20L216,181.38V200ZM144,100a12,12,0,1,1,12,12A12,12,0,0,1,144,100Z"/></svg>
      Add image
    </button>
    <div style="position:relative;">
      <button type="button" class="claude-popup-menu-btn" onclick="toggleClaudePlusSubmenu(event)" style="justify-content:space-between;">
        <span style="display:flex;align-items:center;gap:8px;min-width:0;">
          <svg width="13" height="13" viewBox="0 0 256 256" style="flex:none;" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M216,72H130.67L102.93,51.2a16.12,16.12,0,0,0-9.6-3.2H40A16,16,0,0,0,24,64V200a16,16,0,0,0,16,16H216.89A15.13,15.13,0,0,0,232,200.89V88A16,16,0,0,0,216,72Zm0,128H40V64H93.33L123.2,86.4A8,8,0,0,0,128,88h88Z"/></svg>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${currentProject ? `In ${escapeHtml(currentProject.name)}` : 'Add to project'}</span>
        </span>
        <svg width="12" height="12" viewBox="0 0 256 256" style="flex:none;" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z"/></svg>
      </button>
      <div class="claude-provider-menu" id="claudePlusSubmenu" style="display:none;"></div>
    </div>`;
}

function toggleClaudePlusSubmenu(event){
  event.stopPropagation();
  const submenu = document.getElementById('claudePlusSubmenu');
  if(!submenu) return;
  const opening = submenu.style.display !== 'block';
  submenu.style.display = opening ? 'block' : 'none';
  if(opening) renderClaudePlusSubmenu();
}

function renderClaudePlusSubmenu(){
  const el = document.getElementById('claudePlusSubmenu');
  if(!el) return;
  if(!claudeConversationId){
    el.innerHTML = `<p style="font-size:12px;color:var(--muted-lt);padding:8px 10px;margin:0;">Send a message first.</p>`;
    return;
  }
  if(!claudeProjectsList.length){
    el.innerHTML = `<p style="font-size:12px;color:var(--muted-lt);padding:8px 10px;margin:0;">No projects yet — create one from the Projects tab.</p>`;
    return;
  }
  const currentConv = claudeConversationsList.find(c=>c.id===claudeConversationId);
  const currentProjectId = currentConv?.project_id || null;
  el.innerHTML = claudeProjectsList.map(p=>`
      <button type="button" class="claude-popup-menu-btn" onclick="assignClaudeConversationToProject('${p.id}')">${p.id===currentProjectId?'✓ ':''}${escapeHtml(p.name)}</button>
    `).join('') + (currentProjectId
      ? `<button type="button" class="claude-popup-menu-btn" style="color:var(--muted);" onclick="assignClaudeConversationToProject(null)">Remove from project</button>`
      : '');
}

// Retroactively assigns the currently open conversation to a project —
// complements the embedded chat input on a project's detail view (see
// renderClaudeProjectDetailView), which only covers a
// conversation created FROM a project; this is the other direction, for
// something already underway that you decide should belong to one.
async function assignClaudeConversationToProject(projectId){
  document.getElementById('claudePlusMenu').style.display = 'none';
  if(!claudeConversationId) return;
  const { error } = await supabaseClient.from('claude_conversations').update({ project_id: projectId }).eq('id', claudeConversationId);
  if(error){ showToast('error','Could not update','Try again.'); return; }
  await loadClaudeConversationsList();
  renderClaudeConversationsSidebar();
  const projectName = projectId ? (claudeProjectsList.find(p=>p.id===projectId)?.name || 'the project') : null;
  showToast('success', projectId ? 'Added to project' : 'Removed from project', projectId ? `This chat is now part of "${projectName}".` : 'This chat is no longer part of a project.');
}

document.addEventListener('click', (e)=>{
  const menu = document.getElementById('claudePlusMenu');
  const btn = document.getElementById('claudePlusBtn');
  if(menu && menu.style.display==='block' && !menu.contains(e.target) && e.target!==btn && !btn?.contains(e.target)){
    menu.style.display = 'none';
  }
});

function autoGrowClaudeInput(el){
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function handleClaudeInputKey(e, source){
  if(e.key==='Enter' && !e.shiftKey){
    e.preventDefault();
    sendClaudeMessage(source);
  }
}

// Pool of possible quick-action suggestions — pickClaudeQuickActions()
// randomly picks a handful each time a genuinely NEW empty-chat session
// starts, so they vary instead of always showing the identical fixed set.
const CLAUDE_QUICK_ACTION_POOL = [
  { text:'What needs my attention this week?', icon:'<path d="M236.8,188.09,149.35,36.22h0a24.76,24.76,0,0,0-42.7,0L19.2,188.09a23.51,23.51,0,0,0,0,23.72A24.35,24.35,0,0,0,40.55,224h174.9a24.35,24.35,0,0,0,21.33-12.19A23.51,23.51,0,0,0,236.8,188.09ZM222.93,203.8a8.5,8.5,0,0,1-7.48,4.2H40.55a8.5,8.5,0,0,1-7.48-4.2,7.59,7.59,0,0,1,0-7.72L120.52,44.21a8.75,8.75,0,0,1,15,0l87.45,151.87A7.59,7.59,0,0,1,222.93,203.8ZM120,144V104a8,8,0,0,1,16,0v40a8,8,0,0,1-16,0Zm20,36a12,12,0,1,1-12-12A12,12,0,0,1,140,180Z"/>' },
  { text:'Which clients have gone quiet lately?', icon:'<path d="M233.54,142.23a8,8,0,0,0-8-2,88.08,88.08,0,0,1-109.8-109.8,8,8,0,0,0-10-10,104.84,104.84,0,0,0-52.91,37A104,104,0,0,0,136,224a103.09,103.09,0,0,0,62.52-20.88,104.84,104.84,0,0,0,37-52.91A8,8,0,0,0,233.54,142.23ZM188.9,190.34A88,88,0,0,1,65.66,67.11a89,89,0,0,1,31.4-26A106,106,0,0,0,96,56,104.11,104.11,0,0,0,200,160a106,106,0,0,0,14.92-1.06A89,89,0,0,1,188.9,190.34Z"/>' },
  { text:'Help me draft a client update', icon:'<path d="M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM92.69,208H48V163.31l88-88L180.69,120ZM192,108.68,147.31,64l24-24L216,84.68Z"/>' },
  { text:'Check a client\'s website for issues', icon:'<path d="M229.66,218.34l-50.07-50.06a88.11,88.11,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.32ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z"/>' },
  { text:'Which clients are overdue for a follow-up?', icon:'<path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm64-88a8,8,0,0,1-8,8H128a8,8,0,0,1-8-8V72a8,8,0,0,1,16,0v48h48A8,8,0,0,1,192,128Z"/>' },
  { text:'Summarize this week\'s pending drafts', icon:'<path d="M213.66,82.34l-56-56A8,8,0,0,0,152,24H56A16,16,0,0,0,40,40V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V88A8,8,0,0,0,213.66,82.34ZM160,51.31,188.69,80H160ZM200,216H56V40h88V88a8,8,0,0,0,8,8h48V216Zm-32-80a8,8,0,0,1-8,8H96a8,8,0,0,1,0-16h64A8,8,0,0,1,168,136Zm0,32a8,8,0,0,1-8,8H96a8,8,0,0,1,0-16h64A8,8,0,0,1,168,168Z"/>' },
  { text:'Which client has the highest risk right now?', icon:'<path d="M197.58,129.06,146,110l-19-51.62a15.92,15.92,0,0,0-29.88,0L78,110l-51.62,19a15.92,15.92,0,0,0,0,29.88L78,178l19,51.62a15.92,15.92,0,0,0,29.88,0L146,178l51.62-19a15.92,15.92,0,0,0,0-29.88ZM137,164.22a8,8,0,0,0-4.74,4.74L112,223.85,91.78,169A8,8,0,0,0,87,164.22L32.15,144,87,123.78A8,8,0,0,0,91.78,119L112,64.15,132.22,119a8,8,0,0,0,4.74,4.74L191.85,144ZM144,40a8,8,0,0,1,8-8h16V16a8,8,0,0,1,16,0V32h16a8,8,0,0,1,0,16H184V64a8,8,0,0,1-16,0V48H152A8,8,0,0,1,144,40ZM248,88a8,8,0,0,1-8,8h-8v8a8,8,0,0,1-16,0V96h-8a8,8,0,0,1,0-16h8V72a8,8,0,0,1,16,0v8h8A8,8,0,0,1,248,88Z"/>' },
  { text:'Find a pattern worth flagging', icon:'<path d="M232,208a8,8,0,0,1-8,8H32a8,8,0,0,1-8-8V48a8,8,0,0,1,16,0v94.37L90.73,98a8,8,0,0,1,10.07-.38l58.81,44.11L218.73,90a8,8,0,1,1,10.54,12l-64,56a8,8,0,0,1-10.07.38L96.39,114.29,40,163.63V200H224A8,8,0,0,1,232,208Z"/>' },
];
let claudeQuickActionsPicked = []; // cleared to force a fresh pick the next time the empty hero actually shows — see startNewClaudeConversation()

function pickClaudeQuickActions(){
  claudeQuickActionsPicked = [...CLAUDE_QUICK_ACTION_POOL].sort(()=>Math.random()-0.5).slice(0, 4);
}

function renderClaudeQuickActions(){
  const el = document.getElementById('claudeQuickActionsList');
  if(!el) return;
  el.innerHTML = claudeQuickActionsPicked.map(qa=>`
    <button class="claude-quick-action" data-prompt="${escapeHtml(qa.text)}" onclick="sendClaudeQuickAction(this)">
      <svg width="15" height="15" viewBox="0 0 256 256" class="claude-quick-action-icon" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round">${qa.icon}</svg>
      <span>${escapeHtml(qa.text)}</span>
    </button>`).join('');
}

// Quick-action chips on the tab's empty-state screen — reads the button's
// own prompt, fills the (single, real — not duplicated) input element
// with it, and sends immediately, matching how suggested prompts behave
// in other AI chat products.
function sendClaudeQuickAction(btnEl){
  const inputEl = document.getElementById('claudeTabInput');
  if(inputEl) inputEl.value = btnEl.dataset.prompt || '';
  sendClaudeMessage('tab');
}

async function sendClaudeMessage(source){
  if(claudeSending) return;
  const inputEl = document.getElementById(source==='tab' ? 'claudeTabInput' : 'claudeFloatInput');
  const text = inputEl.value.trim();
  if(!text) return;
  inputEl.value = '';
  inputEl.style.height = 'auto';
  const isFirstMessage = !claudeConversationId; // before ensureClaudeConversation sets it
  // If this input was embedded in a project's detail screen, sending
  // switches to the normal chat view first — layoutClaudeSurface()
  // (triggered by renderClaudeMessages() below) would otherwise try to
  // dock this same input element while the Projects screen is still the
  // visible one, making it silently vanish from view instead of showing
  // the reply.
  if(source==='tab'){
    const projectsView = document.getElementById('claudeProjectsView');
    if(projectsView && projectsView.style.display !== 'none') showClaudeMainArea('chat');
  }
  await ensureClaudeConversation(text);
  claudeConversation.push({role:'user', content:text});
  persistClaudeMessage('user', text);
  claudeSending = true;
  renderClaudeMessages();
  document.getElementById('claudeTabSendBtn').disabled = true;
  document.getElementById('claudeFloatSendBtn').disabled = true;

  try{
    const { data: { session } } = await supabaseClient.auth.getSession();
    // Only the last CLAUDE_CONTEXT_WINDOW messages go to the API — the
    // full claudeConversation can be much longer (up to
    // CLAUDE_HISTORY_DISPLAY_LIMIT) once persisted history is loaded, and
    // sending all of it as context on every single future message would
    // make cost grow unboundedly the longer someone's been using the
    // Assistant, not just with this one exchange.
    const response = await fetch('/api/claude-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      // providerOverride is tab-only (the picker doesn't exist in the
      // floating panel's markup) — empty/missing means "use whatever the
      // admin configured," matching claude-chat.js's own fallback.
      // needsTitle asks the backend to also generate a short AI title for
      // this conversation, alongside the reply — only worth doing once,
      // on the very first message of a new chat.
      body: JSON.stringify({ messages: claudeConversation.slice(-CLAUDE_CONTEXT_WINDOW), appContext: buildClaudeContext(), providerOverride: source==='tab' ? loadClaudeProviderOverride() : null, needsTitle: isFirstMessage }),
    });
    const data = await response.json();
    claudeSending = false;
    if(!response.ok){
      const errText = `⚠️ ${data.error || 'Something went wrong.'}`;
      claudeConversation.push({role:'assistant', content: errText});
      persistClaudeMessage('assistant', errText);
      renderClaudeMessages(true);
      return;
    }
    const replyText = data.reply || '(no response)';
    claudeConversation.push({role:'assistant', content: replyText});
    persistClaudeMessage('assistant', replyText);
    // The conversation was created with a placeholder title (a truncation
    // of the raw first message) the moment it was ensured above, since a
    // real row was needed right away to persist messages against — this
    // swaps in the AI-generated one once it's actually back.
    if(isFirstMessage && data.suggestedTitle){
      updateClaudeConversationTitle(claudeConversationId, data.suggestedTitle);
    }
    renderClaudeMessages(true);
    const capText = data.remainingToday!=null ? `${data.remainingToday} messages left today` : '';
    const tabCap = document.getElementById('claudeTabCap'); if(tabCap) tabCap.textContent = capText;
    const floatCap = document.getElementById('claudeFloatCap'); if(floatCap) floatCap.textContent = capText;
  }catch(e){
    claudeSending = false;
    const errText = '⚠️ Network error — try again.';
    claudeConversation.push({role:'assistant', content: errText});
    persistClaudeMessage('assistant', errText);
    renderClaudeMessages(true);
  }finally{
    document.getElementById('claudeTabSendBtn').disabled = false;
    document.getElementById('claudeFloatSendBtn').disabled = false;
  }
}

// Positions the panel relative to the button's current location (which
// may have been dragged anywhere) rather than a fixed offset that only
// ever made sense when the button was locked to the bottom-left corner.
// Defaults to opening above the button; falls back to below it if
// there's no room, and is clamped so it can never run off any edge.
function positionClaudePanel(){
  const btn = document.getElementById('claudeFloatBtn');
  const panel = document.getElementById('claudeFloatPanel');
  if(!btn || !panel) return;
  const btnRect = btn.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const gap = 12, edge = 16;
  const vw = window.innerWidth, vh = window.innerHeight;

  let left = btnRect.left;
  let top = btnRect.top - panelRect.height - gap;
  if(top < edge) top = btnRect.bottom + gap;

  left = Math.max(edge, Math.min(left, vw - panelRect.width - edge));
  top = Math.max(edge, Math.min(top, vh - panelRect.height - edge));

  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.style.bottom = 'auto';
  panel.style.right = 'auto';
}

function toggleClaudeFloatPanel(){
  if(claudeBtnJustDragged){ claudeBtnJustDragged = false; return; } // suppress the click that follows a real drag
  const panel = document.getElementById('claudeFloatPanel');
  const opening = !panel.classList.contains('open');
  if(opening){
    positionClaudePanel();
    loadClaudeHistory().then(renderClaudeMessages);
  }
  panel.classList.toggle('open');
}

// Draggable floating button — pointer events unify mouse/touch/pen into
// one API. moved (not just "did pointerdown fire") is what distinguishes
// an actual drag from a simple click, since pointerdown+pointerup with
// no real movement in between should still open the chat normally.
let claudeBtnJustDragged = false;
function initClaudeBtnDrag(){
  const btn = document.getElementById('claudeFloatBtn');
  if(!btn) return;
  let dragging = false, moved = false, startX, startY, startLeft, startTop;

  const saved = localStorage.getItem('claude_btn_pos');
  if(saved){
    try{
      const { left, top } = JSON.parse(saved);
      btn.style.left = `${left}px`;
      btn.style.top = `${top}px`;
      btn.style.right = 'auto';
      btn.style.bottom = 'auto';
    }catch(e){}
  }

  btn.addEventListener('pointerdown', (e)=>{
    dragging = true; moved = false;
    const rect = btn.getBoundingClientRect();
    startX = e.clientX; startY = e.clientY;
    startLeft = rect.left; startTop = rect.top;
    btn.setPointerCapture(e.pointerId);
    btn.classList.add('dragging');
  });

  btn.addEventListener('pointermove', (e)=>{
    if(!dragging) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if(!moved && Math.hypot(dx,dy) > 5) moved = true;
    if(!moved) return;
    const size = 52, edge = 8;
    const left = Math.max(edge, Math.min(startLeft+dx, window.innerWidth-size-edge));
    const top = Math.max(edge, Math.min(startTop+dy, window.innerHeight-size-edge));
    btn.style.left = `${left}px`;
    btn.style.top = `${top}px`;
    btn.style.right = 'auto';
    btn.style.bottom = 'auto';
  });

  const endDrag = (e)=>{
    if(!dragging) return;
    dragging = false;
    btn.classList.remove('dragging');
    if(moved){
      claudeBtnJustDragged = true;
      const rect = btn.getBoundingClientRect();
      localStorage.setItem('claude_btn_pos', JSON.stringify({ left: rect.left, top: rect.top }));
    }
  };
  btn.addEventListener('pointerup', endDrag);
  btn.addEventListener('pointercancel', endDrag);
}

async function clearClaudeChat(){
  // Now scoped to the currently OPEN conversation, not every conversation
  // this person has ever had — with real separate conversations in the
  // sidebar, "clear" reads as "delete this one," matching how deleting a
  // chat works in Claude.ai's own sidebar. The button is always visible,
  // so it can be clicked with nothing open yet — a real early-return here
  // avoids prompting a confirm dialog for a no-op.
  if(!claudeConversationId){ showToast('info','Nothing to clear','Start a conversation first.'); return; }
  if(!(await confirmDialog('Delete this conversation? This deletes it for good, including its message history.', {confirmLabel:'Delete', destructive:true}))) return;
  // conversation_id has ON DELETE CASCADE — deleting the conversation row
  // takes its messages with it, no separate delete needed.
  const { error } = await supabaseClient.from('claude_conversations').delete().eq('id', claudeConversationId);
  if(error){ showToast('error','Could not delete','Something went wrong — try again.'); return; }
  claudeConversationId = null;
  claudeConversation = [];
  await loadClaudeConversationsList();
  renderClaudeConversationsSidebar();
  renderClaudeMessages();
}
