// Approval and Team queues: filters, AI draft generation, approve /
// skip / send drafts, notify approvers.

// A new improvement means whatever was drafted or approved before no
// longer reflects everything that's happened for this client — an old
// "Approved" status would otherwise silently claim work that was never
// actually reviewed. Called every time something gets pushed onto
// c.improvements, from any of the four places that can happen.
// author is required now — draft state is scoped per (client, author) pair
// (see addendum-25.sql), so invalidating "the" draft for a client doesn't
// make sense anymore; only the specific author whose new/removed work
// triggered this should have their own draft reset. Mutates in memory only
// and returns the affected draft object (or null if there was nothing to
// invalidate) — callers are responsible for persisting via saveDraftFor()
// if non-null, same as they already handle their own other saves.
function invalidateStaleDraft(c, author){
  const d = (c.drafts||[]).find(x => x.author === author);
  if(!d || d.draftStatus === 'none') return null;
  d.draftStatus = 'none';
  d.draft = '';
  return d;
}

// Lets anyone log an improvement directly from the queue, without
// navigating to Clients first — same underlying save logic as
// logImprovement() below, just with its own client-search field since
// there's no pre-selected client context here.
function openQueueLogImprovementModal(presetClientId){
  openAppModal(`
    <div class="modal-head"><span class="panel-title">Log an improvement</span><span class="toast-close" onclick="closeAppModal()">✕</span></div>
    <div class="modal-body">
      <div class="form-grid">
        <div class="client-search-wrap" style="grid-column:1/-1;"><label>Client</label>
          <input type="text" class="client-search-input" id="queueLogClientSearch" placeholder="Search client…" autocomplete="off">
          <input type="hidden" id="queueLogClient">
          <div class="client-search-dropdown" id="queueLogClientDropdown"></div>
        </div>
        <div style="grid-column:1/-1;"><label>What did you improve?</label><textarea spellcheck="true" id="queueLogText" placeholder="What did you work on?" rows="3" style="resize:vertical;min-height:64px;font-family:inherit;"></textarea></div>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeAppModal()">Cancel</button>
      <button class="btn btn-brand" onclick="saveQueueLogImprovement()">Log it</button>
    </div>`, 460);
  setupClientSearchSelect('queueLogClientSearch', 'queueLogClient', 'queueLogClientDropdown');
  if(presetClientId){
    setClientFieldValue('queueLogClient', 'queueLogClientSearch', presetClientId);
  }
}

async function saveQueueLogImprovement(){
  const clientId = document.getElementById('queueLogClient').value;
  const text = document.getElementById('queueLogText').value.trim();
  if(!clientId){ showToast('error','Pick a client','Select which client this is for.'); return; }
  if(isClientPaused(clientId)){ showPausedClientWarning(clientId); return; }
  if(!text){ showToast('error','Nothing to log','Write what you improved before saving.'); return; }
  const author = myName() || 'Team member';
  const btn = clickedBtn();
  setBtnLoading(btn, 'Saving…');
  await loadAll();
  const c = clients.find(x=>x.id===clientId);
  if(!c){ showToast('error','Client not found','This client may have been removed by someone else.'); restoreBtn(btn); return; }
  const imp = await insertImprovementRow(clientId, {author, text, includeInEmail: true, source: 'manual'});
  const invalidated = invalidateStaleDraft(c, author);
  if(invalidated) await saveDraftFor(clientId, author, { draftStatus:'none', draft:'' });
  const ok = !!imp;
  renderClientsTable(); renderKpis(); renderQueue(); renderTeamQueue();
  restoreBtn(btn);
  if(ok){
    closeAppModal();
    logClientActivity(clientId, 'improvement_logged', `${author} logged an improvement: "${text.length>80?text.slice(0,80)+'…':text}"`);
    refreshClientDetailActivityIfOpen(clientId);
  }
  ok ? showToast('success','Improvement logged', `Saved for ${c.name}.`) : showToast('error','Save failed','Could not save this entry — try again.');
}

async function logImprovement(id){
  const text = document.getElementById('imp-'+id).value.trim();
  const author = myName() || 'Team member';
  if(!text){ showToast('error','Nothing to log','Write what you improved before saving.'); return; }
  const btn = clickedBtn();
  setBtnLoading(btn, 'Saving…');
  await loadAll();
  const c = clients.find(x=>x.id===id);
  if(!c){ showToast('error','Client not found','This client may have been removed by someone else — refreshing.'); renderClientsTable(); return; }
  const imp = await insertImprovementRow(id, {author, text, includeInEmail: true, source: 'manual'});
  const invalidated = invalidateStaleDraft(c, author);
  if(invalidated) await saveDraftFor(id, author, { draftStatus:'none', draft:'' });
  const ok = !!imp;
  renderClientsTable();
  renderKpis();
  renderQueue();
  if(ok){ logClientActivity(id, 'improvement_logged', `${author} logged an improvement: "${text.length>80?text.slice(0,80)+'…':text}"`); refreshClientDetailActivityIfOpen(id); }
  ok ? showToast('success','Improvement logged', `Saved for ${c.name}.`) : showToast('error','Save failed','Could not save this entry — try again.');
}

function setQueueFilter(f){
  queueFilter = f;
  document.querySelectorAll('#queueFilterBar .icon-tab').forEach(p=>p.classList.toggle('active', p.dataset.f===f));
  renderQueue();
}

function setTeamQueueFilter(f){
  teamQueueFilter = f;
  document.querySelectorAll('#teamQueueFilterBar .icon-tab').forEach(p=>p.classList.toggle('active', p.dataset.f===f));
  renderTeamQueue();
}

function setTeamQueueClientFilter(clientId){
  teamQueueClientFilter = clientId;
  renderTeamQueue();
  updateTeamQueueFiltersActiveBadge();
}

function setTeamQueueMemberFilter(memberName){
  teamQueueMemberFilter = memberName;
  renderTeamQueue();
  updateTeamQueueFiltersActiveBadge();
}

function setTeamQueueDangerFilter(value){
  teamQueueDangerFilter = value;
  renderTeamQueue();
  updateTeamQueueFiltersActiveBadge();
}

function setTeamQueueImportanceFilter(value){
  teamQueueImportanceFilter = value;
  renderTeamQueue();
  updateTeamQueueFiltersActiveBadge();
}

// Same anchored-panel pattern as the notification bell's .notif-panel —
// toggled open/closed here, closed by the shared outside-click listener
// registered once below rather than each popup needing its own.
function toggleTeamQueueFiltersPanel(){
  const panel = document.getElementById('teamQueueFiltersPanel');
  const btn = document.getElementById('teamQueueFiltersBtn');
  if(!panel) return;
  const opening = panel.style.display !== 'block';
  panel.style.display = opening ? 'block' : 'none';
  if(btn) btn.classList.toggle('active', opening);
}

document.addEventListener('click', (e)=>{
  const wrap = document.querySelector('.team-queue-filters-wrap');
  const panel = document.getElementById('teamQueueFiltersPanel');
  const btn = document.getElementById('teamQueueFiltersBtn');
  if(panel && panel.style.display==='block' && wrap && !wrap.contains(e.target)){
    panel.style.display='none';
    if(btn) btn.classList.remove('active');
  }
});

// Generic searchable dropdown shared by Team Queue's Client and Team
// Member filters — a fully custom list rather than a native <select>,
// since a native dropdown's open option list is rendered by the OS and
// can't be restyled to match the rest of this panel. prefix is 'tqClient'
// or 'tqMember', matching the element id scheme used throughout.
function toggleTeamQueueCustomSelect(prefix){
  const list = document.getElementById(prefix+'FilterList');
  const wrap = list ? list.closest('.tq-select-wrap') : null;
  if(!list) return;
  const opening = list.style.display !== 'block';
  document.querySelectorAll('.tq-select-list').forEach(l=>{
    if(l.id !== prefix+'FilterList'){ l.style.display='none'; l.closest('.tq-select-wrap')?.classList.remove('open'); }
  });
  list.style.display = opening ? 'block' : 'none';
  if(wrap) wrap.classList.toggle('open', opening);
  if(opening){
    const search = list.querySelector('.tq-select-search');
    if(search) search.value = '';
    renderTeamQueueCustomOptions(prefix, '');
    if(search) search.focus();
  }
}

// Static option lists for filters whose choices don't come from live data
// (unlike Client/Team Member, which are built from activeClients()/
// teamProfiles fresh each time their dropdown opens).
const TQ_STATIC_OPTIONS = {
  tqDanger: [
    {id:'0', name:'Any danger score'}, {id:'5', name:'5 (Critical)'}, {id:'4', name:'4+ (At risk)'},
    {id:'3', name:'3+ (Moderate)'}, {id:'2', name:'2+ (Low)'}, {id:'1', name:'1+ (Any logged)'},
  ],
  tqImportance: [
    {id:'0', name:'Any importance'}, {id:'9', name:'9+ (Top priority)'}, {id:'7', name:'7+ (High)'},
    {id:'5', name:'5+ (Medium)'}, {id:'3', name:'3+ (Low)'},
  ],
  tqTime: [
    {id:'thisweek', name:'This week'}, {id:'all', name:'All time'}, {id:'today', name:'Today'},
    {id:'7days', name:'Last 7 days'}, {id:'30days', name:'Last 30 days'}, {id:'custom', name:'Custom range…'},
  ],
};

function renderTeamQueueCustomOptions(prefix, term){
  const container = document.getElementById(prefix+'FilterOptions');
  if(!container) return;

  if(prefix === 'tqClient' || prefix === 'tqMember'){
    const lower = (term||'').toLowerCase();
    const isClient = prefix === 'tqClient';
    const allLabel = isClient ? 'All clients' : 'All team members';
    const allItems = isClient
      ? [...activeClients()].map(c=>({id:c.id, name:c.name})).sort((a,b)=>a.name.localeCompare(b.name))
      : [...teamProfiles].map(p=>({id:p.name, name:p.name})).sort((a,b)=>a.name.localeCompare(b.name));
    const filtered = term ? allItems.filter(i=>i.name.toLowerCase().includes(lower)) : allItems;
    const currentValue = isClient ? teamQueueClientFilter : teamQueueMemberFilter;
    let html = `<div class="tq-select-item${currentValue==='all'?' active':''}" onclick="selectTeamQueueCustomOption('${prefix}','all',${jsArg(allLabel)})">${escapeHtml(allLabel)}</div>`;
    html += filtered.map(i=>`<div class="tq-select-item${currentValue===i.id?' active':''}" onclick="selectTeamQueueCustomOption('${prefix}',${jsArg(i.id)},${jsArg(i.name)})">${escapeHtml(i.name)}</div>`).join('');
    if(!filtered.length) html += `<div class="tq-select-empty">No matches</div>`;
    container.innerHTML = html;
    return;
  }

  // Static lists (Time, Danger, Importance) — each list's own default
  // item ("This week", "Any danger score", "Any importance") already
  // serves the role an "All" wrapper option would, so none is added here.
  const options = TQ_STATIC_OPTIONS[prefix] || [];
  const currentValue = prefix==='tqDanger' ? teamQueueDangerFilter : prefix==='tqImportance' ? teamQueueImportanceFilter : teamDateFilterMode;
  container.innerHTML = options.map(o=>`<div class="tq-select-item${currentValue===o.id?' active':''}" onclick="selectTeamQueueCustomOption('${prefix}','${o.id}',${jsArg(o.name)})">${escapeHtml(o.name)}</div>`).join('');
}

function selectTeamQueueCustomOption(prefix, id, label){
  if(prefix === 'tqClient') setTeamQueueClientFilter(id);
  else if(prefix === 'tqMember') setTeamQueueMemberFilter(id);
  else if(prefix === 'tqDanger') setTeamQueueDangerFilter(id);
  else if(prefix === 'tqImportance') setTeamQueueImportanceFilter(id);
  else if(prefix === 'tqTime') selectTeamQueueTimeOption(id);

  const labelEl = document.getElementById(prefix+'FilterLabel');
  if(labelEl) labelEl.textContent = label;

  // Time's "Custom range…" needs its date inputs to stay open for the
  // user to actually pick dates and click Apply — closing this dropdown
  // immediately would hide the very controls they need next.
  if(prefix==='tqTime' && id==='custom') return;

  const list = document.getElementById(prefix+'FilterList');
  if(list){ list.style.display = 'none'; list.closest('.tq-select-wrap')?.classList.remove('open'); }
}

// Mirrors onDateFilterChange('team')'s own logic — kept separate since
// that function reads its mode from a native <select>'s .value, which the
// custom Time dropdown here doesn't have.
function selectTeamQueueTimeOption(mode){
  const rangeEl = document.getElementById('teamCustomDateRange');
  if(rangeEl) rangeEl.style.display = mode==='custom' ? 'inline-flex' : 'none';
  teamDateFilterMode = mode;
  if(mode==='custom') return; // wait for Apply click
  const {from, to} = computeDateRange(mode);
  teamDateFilterFrom = from; teamDateFilterTo = to;
  renderTeamQueue();
  updateTeamQueueFiltersActiveBadge();
}

// Shows a count on the Filters button itself whenever Time, Client,
// Danger, or Importance is set to anything other than its default — a
// quick visual cue that something inside the (currently closed) popup is
// actively narrowing the list, since none of those controls are visible
// at a glance once the panel is collapsed.
function updateTeamQueueFiltersActiveBadge(){
  const badge = document.getElementById('teamQueueFiltersActiveBadge');
  if(!badge) return;
  let activeCount = 0;
  if(teamDateFilterMode !== 'thisweek') activeCount++;
  if(teamQueueClientFilter !== 'all') activeCount++;
  if(teamQueueMemberFilter !== 'all') activeCount++;
  if(Number(teamQueueDangerFilter) > 0) activeCount++;
  if(Number(teamQueueImportanceFilter) > 0) activeCount++;
  badge.style.display = activeCount > 0 ? 'inline-flex' : 'none';
  badge.textContent = activeCount;
}

function activeDateFilterLabel(){
  if(dateFilterMode==='thisweek') return 'this week';
  if(dateFilterMode==='all') return '(all time)';
  if(dateFilterMode==='today') return 'today';
  if(dateFilterMode==='7days') return 'in the last 7 days';
  if(dateFilterMode==='30days') return 'in the last 30 days';
  return 'in this range';
}

function computeDateRange(mode){
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0,0,0,0);
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23,59,59,999);
  if(mode==='thisweek') return {from:getWeekStart(now), to:endOfToday};
  if(mode==='today') return {from:startOfToday, to:endOfToday};
  if(mode==='7days'){ const from = new Date(startOfToday); from.setDate(from.getDate()-6); return {from, to:endOfToday}; }
  if(mode==='30days'){ const from = new Date(startOfToday); from.setDate(from.getDate()-29); return {from, to:endOfToday}; }
  return {from:null, to:null};
}

const DATE_FILTER_IDS = {
  '':     { select:'dateFilterSelect',     range:'customDateRange',     from:'dateFrom',     to:'dateTo' },
  team:   { range:'teamCustomDateRange', from:'teamDateFrom', to:'teamDateTo' },
};

// Only ever called for the personal Queue page now — Team Queue's Time
// filter is the custom tqTime dropdown (see selectTeamQueueTimeOption()),
// since it needed a fully custom-styled option list rather than a native
// <select>'s unstylable one.
function onDateFilterChange(prefix){
  prefix = prefix || '';
  const ids = DATE_FILTER_IDS[prefix];
  const mode = document.getElementById(ids.select).value;
  document.getElementById(ids.range).style.display = mode==='custom' ? 'inline-flex' : 'none';
  dateFilterMode = mode;
  if(mode==='custom') return; // wait for Apply click
  const {from, to} = computeDateRange(mode);
  dateFilterFrom = from; dateFilterTo = to;
  renderQueue();
}

function applyCustomDateRange(prefix){
  prefix = prefix || '';
  const ids = DATE_FILTER_IDS[prefix];
  const fromVal = document.getElementById(ids.from).value;
  const toVal = document.getElementById(ids.to).value;
  if(!fromVal && !toVal){ showToast('error','Pick at least one date','Set a start date, end date, or both.'); return; }
  const from = fromVal ? new Date(fromVal + 'T00:00:00') : null;
  const to = toVal ? new Date(toVal + 'T23:59:59') : null;
  if(prefix==='team'){
    teamDateFilterFrom = from; teamDateFilterTo = to;
    renderTeamQueue();
    updateTeamQueueFiltersActiveBadge();
    const labelEl = document.getElementById('tqTimeFilterLabel');
    if(labelEl){
      const fmt = d => d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
      labelEl.textContent = from && to ? `${fmt(from)} – ${fmt(to)}` : from ? `From ${fmt(from)}` : `Until ${fmt(to)}`;
    }
    const list = document.getElementById('tqTimeFilterList');
    if(list){ list.style.display = 'none'; list.closest('.tq-select-wrap')?.classList.remove('open'); }
  } else {
    dateFilterFrom = from; dateFilterTo = to;
    renderQueue();
  }
}

function improvementInDateRange(imp, isTeam){
  const mode = isTeam ? teamDateFilterMode : dateFilterMode;
  const from = isTeam ? teamDateFilterFrom : dateFilterFrom;
  const to = isTeam ? teamDateFilterTo : dateFilterTo;
  if(mode==='all') return true;
  if(!imp.date) return false; // logged before dates were tracked — excluded from specific ranges, still shown under "All time"
  const d = new Date(imp.date);
  // "This week" always recomputes fresh rather than trusting the stored
  // from/to — a browser tab left open across a week boundary would
  // otherwise keep comparing against whatever week the page happened to
  // load during, silently drifting stale the longer the session runs.
  if(mode==='thisweek') return d >= getWeekStart(new Date());
  if(from && d < from) return false;
  if(to && d > to) return false;
  return true;
}

// Whether one author's work for a client earns a card. Unsent work
// ("include in email") always does. So does a live draft — pending, or
// approved and not yet archived — as long as that author logged something
// in range: approving a draft marks the improvements it used as "not in
// email" so they aren't offered again next week, and without this rule the
// card vanished the moment it was approved — still counted on the filter
// chips, but with nothing to open, send or archive. A sent draft is
// archived by clearing its text (see archiveSentDraft()), which is what
// takes it off the board. `mine` = this author's improvements, already
// narrowed to the active date range by the caller.
function queueCardEligible(d, mine){
  if(mine.some(i => i.includeInEmail !== false)) return true;
  const liveDraft = (d.draftStatus === 'pending' || d.draftStatus === 'approved') && !!d.draft;
  return liveDraft && mine.length > 0;
}

// The single source of truth for the personal Approval Queue: which
// clients show under a filter chip. renderQueue() draws exactly these rows
// and the chip badges count exactly these rows, so a badge can never
// promise cards the list doesn't show. Sorted by danger, then importance.
function personalQueueClients(filterKey){
  const me = myName();
  // Once sent, a client is archived out of every other tab entirely — see
  // the matching comment in renderTeamQueue()'s statusMatches. Reads MY OWN
  // draft for each client (getDraftFor) — this page has always been
  // personal, and draft state is per-author (see addendum-25.sql).
  const isSentDraft = (c) => { const d = getDraftFor(c, me); return d.draftStatus==='approved' && !!d.draftSentAt; };
  let list = [...activeClients()].sort((a,b)=> b.danger-a.danger || b.importance-a.importance);
  if(filterKey==='sent') list = list.filter(isSentDraft);
  else {
    list = list.filter(c=>!isSentDraft(c));
    if(filterKey==='pending') list = list.filter(c=>getDraftFor(c, me).draftStatus==='pending');
    else if(filterKey==='approved') list = list.filter(c=>getDraftFor(c, me).draftStatus==='approved');
    else if(filterKey==='none') list = list.filter(c=>getDraftFor(c, me).draftStatus==='none');
    else if(filterKey==='atrisk') list = list.filter(c=>c.danger>=4);
    else if(filterKey==='stale') list = list.filter(c=>getDraftFor(c, me).draftStatus==='approved' && hasLoggedThisWeek(c));
  }
  // Always personal — only clients the current user themselves logged
  // something for (within the current date filter). The team-wide view
  // lives on its own Team Queue page.
  return list.filter(c => queueCardEligible(
    getDraftFor(c, me),
    c.improvements.filter(i => i.author===me && improvementInDateRange(i, false))
  ));
}

// Each chip's badge is the number of cards that chip shows — same rows
// renderQueue() draws, from personalQueueClients().
function queueFilterCount(filterKey){
  return personalQueueClients(filterKey).length;
}

function updateQueueFilterCounts(){
  ['all','pending','approved','none','atrisk','stale','sent'].forEach(key=>{
    const el = document.getElementById('qf-count-'+key);
    if(el) el.textContent = queueFilterCount(key);
  });
}

// Keeps both date-filter dropdowns showing what's actually applied,
// regardless of which page was used to set it — called from both render
// functions so navigating to a page you haven't visited yet this session
// never shows a stale value while the cards underneath are already correct.
function syncDateFilterDropdowns(){
  Object.entries(DATE_FILTER_IDS).forEach(([prefix, ids])=>{
    const mode = prefix==='team' ? teamDateFilterMode : dateFilterMode;
    const sel = document.getElementById(ids.select);
    if(sel && sel.value !== mode) sel.value = mode;
  });
}

function renderQueue(){
  const el = document.getElementById('queueList');
  const ac = activeClients();
  syncDateFilterDropdowns();
  updateQueueFilterCounts();
  updateNotifyBtnState();
  if(!slackChannelsLoaded) loadSlackClientChannels().then(renderQueue);
  if(!ac.length){ el.innerHTML = `<div class="panel">${emptyStateHtml(
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 21a8 8 0 0 0-16 0" /> <circle cx="10" cy="8" r="5" /> <path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3" /></svg>',
    'No clients yet',
    'Add a client to start tracking their drafts and improvements.',
    '<button class="btn btn-brand" onclick="switchView(\'clients\')">Go to Clients</button>'
  )}</div>`; return; }
  const me = myName();
  const rows = personalQueueClients(queueFilter);

  if(!rows.length){
    const filtered = queueFilter !== 'all';
    const title = filtered ? 'Nothing in this tab' : "You haven't logged anything yet";
    const sub = dateFilterMode!=='all' ? "Nothing from you in this range — try All time, or check Team Queue to see everyone's."
      : filtered ? 'None of your clients are at this stage right now.' : 'Log an improvement for a client to see it show up here.';
    el.innerHTML = `<div class="panel">${emptyStateHtml(
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21 21-4.34-4.34" /> <circle cx="11" cy="11" r="8" /></svg>',
      title, sub
    )}</div>`;
    return;
  }

  // Scoped to the viewer's own name — this page is already filtered to
  // clients they logged something for, but the card itself (count, list)
  // should reflect only their own contribution too, not a combined total
  // that happens to include a colleague's work on the same client.
  const keptDraft = captureQueuePaneDraft(el);
  el.innerHTML = queueSplitActive()
    ? queueSplitHtml('approve', rows.map(c => ({ c, author: me })))
    : `<div class="queue-grid">` + rows.map(c=>queueCardHtml(c, me)).join('') + `</div>`;
  restoreQueuePaneDraft(el, keptDraft);
}

// The single source of truth for Team Queue: which of one member's clients
// show under a filter chip, with the panel filters (client, danger,
// importance) and the date filter applied. renderTeamQueue() draws exactly
// these and the chip badges count exactly these.
function teamQueueMemberClients(member, filterKey){
  // Per-(client, author) checks — draft state is scoped to one team
  // member's own contribution (see addendum-25.sql). Once sent, a draft is
  // archived out of every tab except the dedicated Sent tab.
  const isSentDraft = (c, author) => { const d = getDraftFor(c, author); return d.draftStatus==='approved' && !!d.draftSentAt; };
  const statusMatches = (c, author) => {
    const d = getDraftFor(c, author);
    if(filterKey==='sent') return isSentDraft(c, author);
    if(isSentDraft(c, author)) return false;
    if(filterKey==='pending') return d.draftStatus==='pending';
    if(filterKey==='approved') return d.draftStatus==='approved';
    if(filterKey==='none') return d.draftStatus==='none';
    if(filterKey==='stale') return d.draftStatus==='approved' && hasLoggedThisWeek(c, author);
    return true;
  };
  // Pending drafts stay hidden until the owning member clicks Ready to
  // Notify; clients still at 'none' are that member's private working
  // state. Exception: an admin/approver's own clients always show — they
  // have no personal Approval Queue tab (see applyRoleVisibility()), so
  // Team Queue is where they take their own work from logged to sent.
  const readyForReview = (c, author) => {
    if(author===myName() && canApprove()) return true;
    const d = getDraftFor(c, author);
    if(d.draftStatus==='approved') return true;
    if(d.draftStatus!=='pending') return false;
    return d.readyToNotify===true;
  };
  return activeClients()
    .filter(c => teamQueueClientFilter==='all' || c.id===teamQueueClientFilter)
    .filter(c => c.danger >= (Number(teamQueueDangerFilter)||0))
    .filter(c => c.importance >= (Number(teamQueueImportanceFilter)||0))
    .filter(c => queueCardEligible(getDraftFor(c, member.name), c.improvements.filter(i => i.author===member.name && improvementInDateRange(i, true))))
    .filter(c => statusMatches(c, member.name) && readyForReview(c, member.name))
    .sort((a,b)=> b.danger-a.danger || b.importance-a.importance);
}

// Same client can legitimately count under several members (if more than
// one person logged work for it), so the count is the total across every
// member's own section — exactly the number of cards on the page.
function teamQueueFilterCount(filterKey){
  return teamProfiles.reduce((total, member) => {
    if(teamQueueMemberFilter !== 'all' && member.name !== teamQueueMemberFilter) return total;
    return total + teamQueueMemberClients(member, filterKey).length;
  }, 0);
}

function updateTeamQueueFilterCounts(){
  ['all','pending','approved','none','stale','sent'].forEach(key=>{
    const el = document.getElementById('tqf-count-'+key);
    if(el) el.textContent = teamQueueFilterCount(key);
  });
}

function renderTeamQueue(){
  const el = document.getElementById('teamQueueList');
  if(!el) return;
  const ac = activeClients();
  syncDateFilterDropdowns();
  updateTeamQueueFilterCounts();
  updateTeamQueueFiltersActiveBadge();
  const actionsRow = document.getElementById('adminOnlyQueueActionsRow');
  if(actionsRow) actionsRow.style.display = canApprove() ? 'flex' : 'none';
  if(!slackChannelsLoaded) loadSlackClientChannels().then(renderTeamQueue);
  if(!ac.length){ el.innerHTML = `<div class="panel">${emptyStateHtml(
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 21a8 8 0 0 0-16 0" /> <circle cx="10" cy="8" r="5" /> <path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3" /></svg>',
    'No clients yet',
    'Add a client to start tracking their drafts and improvements.',
    '<button class="btn btn-brand" onclick="switchView(\'clients\')">Go to Clients</button>'
  )}</div>`; return; }

  // One list, riskiest client first, each row naming whose draft it is —
  // the page's promise ("riskiest first") applies across the whole team,
  // not inside each person's section.
  const pairs = [];
  teamProfiles.forEach(member => {
    if(teamQueueMemberFilter !== 'all' && member.name !== teamQueueMemberFilter) return;
    teamQueueMemberClients(member, teamQueueFilter).forEach(c => pairs.push({ c, member }));
  });
  pairs.sort((a,b)=> (b.c.danger - a.c.danger) || (b.c.importance - a.c.importance) || a.c.name.localeCompare(b.c.name) || a.member.name.localeCompare(b.member.name));

  if(!pairs.length){
    const title = teamDateFilterMode!=='all' ? 'No improvements in this range' : 'No clients match this filter';
    const sub = teamDateFilterMode!=='all' ? 'Try a wider date range, or switch back to All time.' : 'Try a different filter, or clear it to see everyone.';
    el.innerHTML = `<div class="panel">${emptyStateHtml(
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21 21-4.34-4.34" /> <circle cx="11" cy="11" r="8" /></svg>',
      title, sub
    )}</div>`;
    return;
  }

  const keptDraft = captureQueuePaneDraft(el);
  el.innerHTML = queueSplitActive()
    ? queueSplitHtml('teamqueue', pairs.map(p => ({ c: p.c, author: p.member.name })))
    : `<div class="queue-grid">${pairs.map(p => queueCardHtml(p.c, p.member.name, true)).join('')}</div>`;
  restoreQueuePaneDraft(el, keptDraft);
}


// Scoped specifically to one member's pending drafts — same recipient
// escalation logic as the main Notify button (based on the viewer's own
// role, never revealing who the recipient actually is), but the email
// content only covers this one person's ready work, not everyone's.
let _notifyMemberSelectedClientIds = [];

// Shared by markMemberDraftsReady() — the exact same "which of this
// member's drafts are we actually acting on" question, computed once so
// every consumer stays in sync with the picker's selection rather than
// risking two slightly different filters drifting apart. The
// !d.draftSentAt check is defensive: draftStatus==='pending' should
// already structurally guarantee this (a fresh generation always clears
// draftSentAt — see confirmGenerateDraftSelection()), but an already-sent
// draft showing up here by mistake is exactly the scenario this whole
// redesign is meant to prevent, so it's checked explicitly rather than
// assumed.
function getSelectedPendingDraftsForMember(member){
  const selectedIds = new Set(_notifyMemberSelectedClientIds);
  return activeClients().filter(c=>{
    const d = getDraftFor(c, member.name);
    return selectedIds.has(c.id) && d.draftStatus==='pending' && !d.draftSentAt && c.improvements.some(i=>i.author===member.name);
  });
}

// First step now: pick which of this member's pending drafts to actually
// notify about, rather than always including all of them. The choice
// carries forward into confirmNotifyMemberSelection() below. Wording is
// conditional on whether this is the current user looking at their own
// work (member.name === myName()) or an approver looking at a colleague's
// — "notify about Albert's drafts" reads fine from an approver's side,
// but Albert seeing that same phrasing about himself reads like the app
// doesn't know who he is, when what's actually happening for him is
// simply sending his own work in for approval.
function notifyForMember(memberId){
  const member = teamProfiles.find(p=>p.id===memberId);
  if(!member) return;
  const isSelf = member.name === myName();
  const allPendingNotSent = activeClients().filter(c=>{
    const d = getDraftFor(c, member.name);
    return d.draftStatus==='pending' && !d.draftSentAt && c.improvements.some(i=>i.author===member.name);
  });
  if(!allPendingNotSent.length){ showToast('info','Nothing pending', isSelf ? "You don't have any drafts ready right now." : `${member.name} has no drafts ready right now.`); return; }
  // Excludes drafts already flagged (readyToNotify===true) — "Sent for
  // approval" isn't a different draftStatus from "Draft ready", it's the
  // same 'pending' status with this flag set, so the earlier filter alone
  // doesn't catch it. Without this, the picker offered to re-notify about
  // work an approver had already been told about, with nothing new to say.
  const pending = allPendingNotSent.filter(c=>getDraftFor(c, member.name).readyToNotify!==true);
  if(!pending.length){ showToast('info','Already sent', isSelf ? "Everything you've got pending has already been sent for approval." : `Everything pending for ${member.name} has already been flagged for review.`); return; }

  openAppModal(`
    <div class="modal-head"><span class="panel-title">Choose which ${isSelf ? 'drafts' : `of ${escapeHtml(member.name)}'s drafts`} to ${isSelf ? 'send for approval' : 'notify about'}</span><span class="toast-close" onclick="closeAppModal()">✕</span></div>
    <div class="modal-body">
      <p style="font-size:13px;color:var(--muted);margin:0 0 12px;">${pending.length} draft${pending.length!==1?'s':''} ready — uncheck any you'd rather hold back for now.</p>
      <div style="display:flex;flex-direction:column;gap:2px;max-height:340px;overflow-y:auto;">
        ${pending.map(c=>`
          <label style="display:flex;align-items:flex-start;gap:10px;padding:8px 4px;border-bottom:1px solid var(--border);cursor:pointer;">
            <input type="checkbox" class="notify-select-checkbox" value="${c.id}" checked style="margin-top:3px;flex:none;">
            <span style="flex:1;font-size:14px;color:var(--ink);">${escapeHtml(c.name)}<br><span style="font-size:12px;color:var(--muted-lt);">danger ${c.danger}/5, importance ${c.importance}/10</span></span>
          </label>
        `).join('')}
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeAppModal()">Cancel</button>
      <button class="btn btn-brand" onclick="confirmNotifyMemberSelection('${memberId}')">${isSelf ? 'Send for Approval' : 'Notify'}</button>
    </div>`, 480);
}

// Goes straight to sending now — with "Send Email" already removed
// earlier, this step only ever had one real action left ("Send Internally"
// / "Send for Approval" vs Cancel), making the extra confirmation modal
// redundant for both contexts. notifyForMemberInternally() already closes
// the modal itself once sending completes, so the picker just stays open
// (with its own Cancel button) until then.
function confirmNotifyMemberSelection(memberId){
  const checkedIds = [...document.querySelectorAll('.notify-select-checkbox:checked')].map(el=>el.value);
  if(!checkedIds.length){ showToast('error','Nothing selected','Check at least one client to notify about.'); return; }
  _notifyMemberSelectedClientIds = checkedIds;
  notifyForMemberInternally(memberId);
}

// Marks this member's SELECTED pending drafts as ready — the actual
// signal that makes them visible in Team Queue (see renderTeamQueue()'s
// readyToNotify filter) — shared by both the email and internal notify
// paths below, since either one represents genuine intent to notify. Not
// called on Cancel, since nothing was actually sent in that case.
function markMemberDraftsReady(member){
  const pending = getSelectedPendingDraftsForMember(member);
  pending.forEach(c => { getDraftFor(c, member.name).readyToNotify = true; });
  Promise.all(pending.map(c=>saveDraftFor(c.id, member.name, { readyToNotify:true }))).then(()=>renderTeamQueue());
  return pending;
}

// The new in-app alternative to email — notifies every admin/approver
// directly (excluding whoever's clicking this, same reasoning as the old
// automatic draft-ready notification: telling someone about their own
// action is pointless), rather than the single person email escalates to.
async function notifyForMemberInternally(memberId){
  const member = teamProfiles.find(p=>p.id===memberId);
  if(!member) return;
  const isSelf = member.name === myName();
  const pending = markMemberDraftsReady(member);
  const approvers = teamProfiles.filter(p => (p.role==='admin' || p.role==='approver') && p.id !== currentUser?.id);
  if(!approvers.length){ showToast('info','Nobody to notify', 'No other admins or approvers on the team yet.'); return; }
  for(const approver of approvers){
    await sendNotification(approver.id, 'draft_ready', `${member.name}'s drafts ready for approval`,
      `${pending.length} client update draft${pending.length!==1?'s':''} from ${member.name} ${pending.length!==1?'are':'is'} ready for review.`, 'teamqueue');
  }
  log.unshift({t:nowTime(), tag:'you', userId:currentUser?.id, text:`Notified the team internally about ${member.name}'s drafts — ${pending.length} pending.`});
  persistLog().then(renderLog);
  closeAppModal();
  showToast('success', isSelf ? 'Sent for approval' : 'Team notified', isSelf
    ? `${pending.length} draft${pending.length!==1?'s':''} sent for approval.`
    : `${approvers.length} admin${approvers.length!==1?'s':''}/approver${approvers.length!==1?'s':''} notified in-app.`);
}

// Shared by Approval Queue and Team Queue — same card, same meaning,
// wherever a client shows up.
// scopeAuthor restricts everything below to one person's own logged work
// — used when this card is shown inside a specific member's Team Queue
// section (or the viewer's own personal Queue), so someone doesn't see a
// combined count/list that includes colleagues' contributions mixed into
// theirs. Left undefined shows everyone's, unchanged from before.
function queueCardHtml(c, scopeAuthor, showAuthor, selected, view){
  const status = statusMeta(c, scopeAuthor);
  const d = getDraftFor(c, scopeAuthor);
  return `<div class="q-card${selected ? ' sel' : ''}" id="q-${c.id}"${view ? ` role="option" aria-selected="${selected ? 'true' : 'false'}" onclick="queueRowClick(event,'${view}','${c.id}',${jsArg(scopeAuthor||'')})"` : ''}>
    <div class="q-card-top">
      <div class="avatar-circle" style="background:${avatarColorForName(c.name)};color:#fff;border:2px solid var(--card);box-shadow:none;">${escapeHtml(c.name.trim().charAt(0).toUpperCase())}</div>
      <div style="flex:1;min-width:0;">
        <div class="q-name">${escapeHtml(c.name)}</div>
        <div class="q-service-caption" style="margin-top:2px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">${showAuthor && scopeAuthor ? `<span class="q-author">${escapeHtml(scopeAuthor)}</span> · ` : ''}${escapeHtml(c.service)} · <span class="rating-pill" style="background:${status.bg};color:${status.color};text-transform:capitalize;font-size:10.5px;padding:2px 8px;">${escapeHtml(status.label)}</span></div>
      </div>
      <div class="kanban-card-menu-wrap">
        <span class="kanban-card-menu-btn" onclick="toggleKanbanCardMenu('q-${c.id}')">⋯</span>
        <div class="kanban-card-menu" id="kanbanMenu-q-${c.id}" style="display:none;">
          <div class="kanban-card-menu-item" onclick="closeKanbanMenus();openQueueLogImprovementModal('${c.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 5h8" /> <path d="M13 12h8" /> <path d="M13 19h8" /> <path d="m3 17 2 2 4-4" /> <rect x="3" y="4" width="6" height="6" rx="1" /></svg>Log / edit improvements</div>
          <div class="kanban-card-menu-item" onclick="closeKanbanMenus();openNoteModal(null, '${c.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /> <path d="M14 2v5a1 1 0 0 0 1 1h5" /> <path d="M10 9H8" /> <path d="M16 13H8" /> <path d="M16 17H8" /></svg>Add note</div>
          <div class="kanban-card-menu-item" onclick="closeKanbanMenus();openTimerModal('${c.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /> <path d="M12 6v6l4 2" /></svg>Track time</div>
        </div>
      </div>
    </div>
    <div class="q-pill-row">
      ${dangerPillCompact(c.danger)}
      <span class="rating-pill rating-pill-ink">Importance ${c.importance}/10</span>
      ${clientReminders.some(r=>r.clientId===c.id && reminderDisplayStatus(r)==='due') ? `<span class="rating-pill" style="background:#3A63C918;color:#3A63C9;" title="A client question is overdue for a follow-up"><svg width="10" height="10" style="margin-right:3px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.268 21a2 2 0 0 0 3.464 0" /> <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" /></svg>Follow-up due</span>` : ''}
    </div>
    ${queueActivityBadgeHtml(c, scopeAuthor)}
    <div class="q-card-actions">
      ${(() => {
        // An admin/approver's own pending draft skips the approve step
        // entirely — same reasoning as no longer having a separate
        // personal Approval Queue tab (see applyRoleVisibility()). One
        // "Send" click does both approve and send together
        // (approveAndSendOwnDraft), rather than making them click Approve
        // and then Send on their own work as if someone else needed to
        // sign off on it first.
        const canSkipApproval = d.draftStatus==='pending' && scopeAuthor===myName() && canApprove();
        // Once a draft has actually been sent, "Send"/"Slack" stop being
        // the relevant actions — the one useful new action at that point
        // is archiving it off the board (see archiveSentDraft()), so that
        // replaces them here rather than sitting alongside them.
        if(d.draftStatus==='approved' && d.draftSentAt){
          if(!canApprove()) return `
      <button class="btn btn-brand" onclick="openQueueCardModal('${c.id}',${jsArg(scopeAuthor||'')})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /> <circle cx="12" cy="12" r="3" /></svg>Details</button>
      `;
          return `
      <button class="btn btn-outline" onclick="archiveSentDraft('${c.id}',${jsArg(scopeAuthor||'')})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="5" x="2" y="3" rx="1" /> <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /> <path d="M10 12h4" /></svg>Archive</button>
      <button class="btn btn-outline" onclick="openQueueCardModal('${c.id}',${jsArg(scopeAuthor||'')})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /> <circle cx="12" cy="12" r="3" /></svg>Details</button>
      `;
        }
        if(d.draftStatus==='approved' || canSkipApproval){
          if(!canApprove()) return `
      <button class="btn btn-brand" onclick="openQueueCardModal('${c.id}',${jsArg(scopeAuthor||'')})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /> <circle cx="12" cy="12" r="3" /></svg>Details</button>
      `;
          return `
      <button class="btn btn-brand" onclick="${canSkipApproval ? `approveAndSendOwnDraft('${c.id}',${jsArg(scopeAuthor||'')})` : `sendApprovedDraft('${c.id}',${jsArg(scopeAuthor||'')})`}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" /> <path d="m21.854 2.147-10.94 10.939" /></svg>Send</button>
      ${slackClientChannels[c.id] ? `<button class="btn btn-outline" onclick="openSendToSlackConfirm('${c.id}',${jsArg(scopeAuthor||'')})" title="Post this update to ${escapeHtml(slackClientChannels[c.id].channelName||'their Slack channel')}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20v2" /> <path d="M12 2v2" /> <path d="M17 20v2" /> <path d="M17 2v2" /> <path d="M2 12h2" /> <path d="M2 17h2" /> <path d="M2 7h2" /> <path d="M20 12h2" /> <path d="M20 17h2" /> <path d="M20 7h2" /> <path d="M7 20v2" /> <path d="M7 2v2" /> <rect x="4" y="4" width="16" height="16" rx="2" /> <rect x="8" y="8" width="8" height="8" rx="1" /></svg>Slack</button>` : ''}
      <button class="btn btn-outline" onclick="openQueueCardModal('${c.id}',${jsArg(scopeAuthor||'')})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /> <circle cx="12" cy="12" r="3" /></svg>Details</button>
      `;
        }
        return `
      <button class="btn btn-brand" onclick="openQueueCardModal('${c.id}',${jsArg(scopeAuthor||'')})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /> <circle cx="12" cy="12" r="3" /></svg>Details</button>
      <button class="btn btn-outline" onclick="openQueueLogImprovementModal('${c.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14" /> <path d="M12 5v14" /></svg>Log now</button>
      `;
      })()}
    </div>
  </div>`;
}

// Three distinct states, not two — a client quiet this week but with real
// history is a completely different situation from one that's never had
// anything logged at all, and collapsing them into one "no dot" look would
// throw that difference away.
function queueActivityBadgeHtml(c, scopeAuthor){
  const d = getDraftFor(c, scopeAuthor);
  // Once this exact approved draft has actually been sent, that's more
  // relevant to show here than "logged this week" — same grey, dot-less
  // treatment as "No improvements logged yet" below (the base
  // .q-bulk-preview class, no .has-logs/.has-history modifier), since
  // there's nothing left pending action for this cycle. This is also the
  // one place the sent date actually appears now — the pill above just
  // says "Sent" (short, matching the brevity of every other status
  // label), so the date and the "sent" message aren't both stated
  // separately in two different spots saying the same thing. Falls back
  // to a generic message if draftImprovementIds is empty/missing — older
  // sent drafts from before that field existed shouldn't show a
  // misleading "0 improvements were sent". No more manual author
  // filtering needed here — the draft itself is already scoped to
  // scopeAuthor via getDraftFor().
  if(d.draftStatus==='approved' && d.draftSentAt){
    const sentCount = (d.draftImprovementIds||[]).length;
    const sentDate = new Date(d.draftSentAt).toLocaleDateString('en-US',{month:'short',day:'numeric'});
    const countPhrase = sentCount>0 ? `${sentCount} improvement${sentCount!==1?'s':''} ${sentCount!==1?'were':'was'} sent` : 'Draft was sent';
    return `<div class="q-bulk-preview">${countPhrase} on ${sentDate}</div>`;
  }

  const weekStart = getWeekStart(new Date());
  let emailRelevant = c.improvements.filter(i=>i.includeInEmail!==false);
  if(scopeAuthor) emailRelevant = emailRelevant.filter(i=>i.author===scopeAuthor);
  const thisWeekCount = emailRelevant.filter(i=>i.date && new Date(i.date) >= weekStart).length;

  if(thisWeekCount){
    return `<div class="q-bulk-preview has-logs"><span class="pulse-dot"></span>${thisWeekCount} improvement${thisWeekCount!==1?'s':''} logged this week</div>`;
  }

  // Work already used in an approved draft is marked "not in email" — it
  // still counts as logged here, or an approved card would claim nothing
  // was ever logged.
  const dated = c.improvements.filter(i=>i.date && (!scopeAuthor || i.author===scopeAuthor));
  if(!dated.length){
    return `<div class="q-bulk-preview">No improvements logged yet</div>`;
  }

  const mostRecent = dated.reduce((latest, i)=> new Date(i.date) > new Date(latest.date) ? i : latest);
  return `<div class="q-bulk-preview has-history"><span class="history-dot"></span>Last logged ${timeAgo(mostRecent.date)}</div>`;
}

function loggedPill(c){
  if(hasLoggedThisWeek(c)){
    const count = c.improvements.filter(i=>i.date && new Date(i.date) >= getWeekStart(new Date())).length;
    return `<span class="pill pill-good">${count} this week</span>`;
  }
  const dated = c.improvements.filter(i=>i.date);
  if(!dated.length) return `<span class="pill pill-status">No logs</span>`;
  const mostRecent = dated.reduce((latest, i)=> new Date(i.date) > new Date(latest.date) ? i : latest);
  return `<span class="pill pill-history">${timeAgo(mostRecent.date)}</span>`;
}

// The draft's full detail: who wrote it, what it was written from, the
// draft itself and every action on it. Shown in the side pane of Review
// and Team Queue on wide windows, and in a sheet everywhere else.
function queueDetailHtml(c, author){
  const d = getDraftFor(c, author);
  // Scoped to this author's own logged work — this modal represents one
  // specific person's draft for this client, not a combined view of
  // everyone who's ever logged something here.
  const shownImprovements = c.improvements.filter(i=>improvementInDateRange(i, false) && i.author===author);
  const status = statusMeta(c, author);
  return `
    <div class="modal-head">
      <div>
        <div class="q-name">${escapeHtml(c.name)} <span style="font-weight:400;color:var(--muted-lt);font-size:14px;">— ${escapeHtml(author)}</span></div>
        <div class="q-service-caption">${escapeHtml(c.service)} · ${riskCaptionHtml(c.danger)}</div>
        <div class="q-ratings" style="margin-top:12px;">
          ${dotRating('Importance', c.importance, 'ink', 10)}
          ${dotRating('Danger', c.danger, 'ink')}
        </div>
      </div>
      <span class="toast-close" onclick="closeAppModal()">✕</span>
    </div>
    <div class="modal-body">
      <span class="q-status-label" style="color:${status.color};">${escapeHtml(status.label)}</span>
      <div class="q-bulk">
        ${shownImprovements.length ? `<div class="q-bulk-title">Logged ${activeDateFilterLabel()} (${shownImprovements.length}) — ${shownImprovements.filter(i=>i.includeInEmail!==false).length} included in email</div><div class="q-bulk-list"><ul>${shownImprovements.map(i=>`<li style="${i.includeInEmail===false?'opacity:.55;':''}">${i.includeInEmail===false ? '<span style="color:var(--muted-lt);font-size:10.5px;">[not in email]</span> ' : ''}${escapeHtml(i.text)} — <span style="color:var(--muted-lt);">${escapeHtml(i.author)}</span></li>`).join('')}</ul></div>` : `<i>No improvements logged by ${escapeHtml(author)} ${activeDateFilterLabel()} — nothing to send.</i>`}
      </div>
      ${d.draft ? `<textarea spellcheck="true" class="draft" id="draft-${c.id}" ${d.draftStatus==='approved' && !canApprove() ? 'disabled' : ''}>${escapeHtml(d.draft)}</textarea>` : ''}
      ${d.draft && !c.email ? `<span class="warn-text">No client email on file — add one in Clients</span>` : ''}
    </div>
    <div class="modal-actions">
      ${d.draftStatus==='approved' && d.draftSentAt ? `
      <span style="font-size:14px;color:var(--muted-lt);">✓ Sent on ${new Date(d.draftSentAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})} — nothing left to do here. New work logged by ${escapeHtml(author)} for ${escapeHtml(c.name)} will start a fresh draft cycle on its own.</span>
      ` : `
      ${c.improvements.some(i=>i.author===author) && !(d.draftStatus==='approved' && !canApprove()) && canGenerateOrRegenerateDraft(c, author) ? `<button class="btn btn-dark" id="gen-${c.id}" onclick="generateDraft('${c.id}',${jsArg(author)})" title="${d.draft?'Regenerate':'Generate'} with AI"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" /> <path d="M20 2v4" /> <path d="M22 4h-4" /> <circle cx="4" cy="20" r="2" /></svg>${d.draft?'Regenerate':'Generate'}</button>` : ''}
      ${d.draft && canApprove() ? (author===myName() ? `<button class="btn btn-brand" onclick="approveAndSendOwnDraft('${c.id}',${jsArg(author)})" ${d.draftStatus==='approved'?'disabled':''}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" /> <path d="m21.854 2.147-10.94 10.939" /></svg>Send</button>
      <button class="btn btn-outline" onclick="skipDraft('${c.id}',${jsArg(author)})" title="Excludes these improvements from future drafts too — they won't reappear next week">Skip &amp; exclude</button>` : `<button class="btn btn-brand" onclick="approveDraft('${c.id}',${jsArg(author)})" ${d.draftStatus==='approved'?'disabled':''}>Approve</button>
      <button class="btn btn-outline" onclick="skipDraft('${c.id}',${jsArg(author)})" title="Excludes these improvements from future drafts too — they won't reappear next week">Skip &amp; exclude</button>`) : ''}
      ${d.draft && !canApprove() && d.draftStatus!=='approved' ? `<span class="warn-text" style="color:var(--muted-lt);">Only admins and approvers can approve or skip drafts.</span>` : ''}
      ${d.draftStatus==='approved' && !canApprove() ? `<span style="font-size:14px;color:var(--muted-lt);">✓ ${escapeHtml(author)}'s update was approved.</span>` : ''}
      `}
    </div>`;
}

// Review and Team Queue work like Mail on wide windows: the list on the
// left, the selected draft on the right. Every action is the same code
// the sheet uses — after approving, sending or skipping, the list redraws
// and the same draft stays selected with its new state.
const queueSelection = { approve: null, teamqueue: null };
const QUEUE_SPLIT_QUERY = window.matchMedia('(min-width: 1100px)');
function queueSplitActive(){ return QUEUE_SPLIT_QUERY.matches; }
if(QUEUE_SPLIT_QUERY.addEventListener) QUEUE_SPLIT_QUERY.addEventListener('change', ()=>{ renderQueue(); renderTeamQueue(); });

function selectQueueItem(view, id, author){
  queueSelection[view] = { id, author };
  view === 'approve' ? renderQueue() : renderTeamQueue();
}

function queueRowClick(event, view, id, author){
  if(!queueSplitActive()) return;
  if(event.target.closest('button, a, input, textarea, select, .kanban-card-menu-wrap')) return;
  selectQueueItem(view, id, author);
}

// Background redraws (live updates, other actions) must never wipe a
// draft someone is in the middle of editing in the pane. Unsaved text,
// focus and cursor survive a redraw — unless the saved draft itself
// changed underneath (e.g. it was just rewritten by AI), in which case
// the new text wins.
function captureQueuePaneDraft(el){
  const ta = el && el.querySelector('.q-pane textarea.draft');
  if(!ta) return null;
  const focused = document.activeElement === ta;
  if(!focused && ta.value === ta.defaultValue) return null;
  return { id: ta.id, value: ta.value, base: ta.defaultValue, focused, start: ta.selectionStart, end: ta.selectionEnd };
}
function restoreQueuePaneDraft(el, kept){
  if(!kept) return;
  const ta = el.querySelector('.q-pane textarea.draft');
  if(!ta || ta.id !== kept.id || ta.defaultValue !== kept.base) return;
  ta.value = kept.value;
  if(kept.focused){ ta.focus(); try{ ta.setSelectionRange(kept.start, kept.end); }catch(e){} }
}

function queueSplitHtml(view, items){
  let sel = queueSelection[view];
  if(!sel || !items.some(it => it.c.id === sel.id && it.author === sel.author)){
    sel = queueSelection[view] = { id: items[0].c.id, author: items[0].author };
  }
  const selected = items.find(it => it.c.id === sel.id && it.author === sel.author);
  const rows = items.map(it => queueCardHtml(it.c, it.author, view === 'teamqueue', it === selected, view)).join('');
  return `<div class="q-split"><div class="queue-grid q-list" role="listbox" aria-label="Drafts">${rows}</div>
    <section class="q-pane" aria-label="Selected draft" data-client-id="${selected.c.id}" data-author="${escapeHtml(selected.author)}">${queueDetailHtml(selected.c, selected.author)}</section></div>`;
}

function openQueueCardModal(id, author){
  const c = clients.find(x=>x.id===id);
  if(!c) return;
  if(queueSplitActive() && (currentViewName === 'approve' || currentViewName === 'teamqueue')){
    selectQueueItem(currentViewName, id, author);
    const pane = document.querySelector(`#view-${currentViewName} .q-pane`);
    if(pane) pane.scrollTop = 0;
    return;
  }
  openAppModal(queueDetailHtml(c, author), 560);
  const card = document.querySelector('#appModalOverlay .modal-card');
  if(card){ card.dataset.clientId = id; card.dataset.author = author; }
  const list = document.querySelector('#appModalOverlay .q-bulk-list');
  if(list && list.scrollHeight > list.clientHeight) list.classList.add('scrollable');
}


// After writing or rewriting a draft: show it in Review, where it can be read, edited and sent on
// (the old card sheet only if Review can't show it).
function openDraftAfterWriting(id, author){
  if(typeof openReviewDraft === 'function' && typeof reviewItems === 'function'){
    closeAppModal();
    if(hasPermission('view_team_queue') && Object.values(reviewItems()).some(l => l.some(x => x.c.id === id && x.d.author === author))){ openReviewDraft(id, author); return; }
    // No Review: open the client on This Week with the draft showing in full.
    if(typeof openWeekClient === 'function'){ window._weekDraftFull = id; openWeekClient(id); return; }
  }
  openQueueCardModal(id, author);
}
// Every improvement a draft was written from has been deleted: nothing left to send.
function draftWorkAllDeleted(c, d){
  const ids = d.draftImprovementIds || [];
  return ids.length > 0 && !ids.some(id => (c.improvements || []).some(i => i.id === id));
}
function blockIfWorkDeleted(c, d){
  if(!draftWorkAllDeleted(c, d) && !draftHasNoWork(c, d)) return false;
  showToast('error', 'Nothing left in this draft', `Everything ${d.author}'s draft for ${c.name} was written from has been deleted. Rewrite or discard it first.`);
  return true;
}

async function generateDraft(id, author){
  await loadAll();
  const c = clients.find(x=>x.id===id);
  if(!c) return;
  const d = getDraftFor(c, author);
  if(!canGenerateOrRegenerateDraft(c, author)){
    showToast('error','Not allowed', (d.draftStatus==='pending' && d.readyToNotify===true && !canApprove())
      ? "This draft's already been marked ready for approval — an admin or approver needs to act on it before it can be regenerated."
      : d.draft
        ? 'Only admins, approvers, or the person this draft belongs to can regenerate it.'
        : 'Only that team member (or an admin/approver) can generate their first draft.');
    return;
  }
  const modalCard = document.querySelector('#appModalOverlay .modal-card');
  const modalOpenForThis = modalCard && modalCard.dataset.clientId === id && modalCard.dataset.author === author;
  // Personal by default — each team member's draft only ever draws from
  // their own logged work, so a client with multiple contributors gets
  // one independent draft per person rather than one shared draft that
  // silently mixes everyone's improvements together. Admins/approvers get
  // the full picture instead: every eligible improvement for this client,
  // from any author, in case they need to fold someone else's work into
  // the draft they're overseeing — but only this specific author's own
  // items are pre-checked, so nothing gets included from someone else by
  // accident.
  const allEligible = c.improvements.filter(i => i.includeInEmail !== false)
    .sort((a,b) => new Date(a.date||0) - new Date(b.date||0)); // oldest first — easy to miss otherwise
  const eligibleImprovements = canApprove() ? allEligible : allEligible.filter(i => i.author === author);
  if(!eligibleImprovements.length){
    showToast('error','Nothing to include', c.improvements.some(i=>i.author===author)
      ? `${author} has logged items for ${c.name}, but none are marked "Include in email" yet — review them in Past Improvements.`
      : `No improvements logged yet by ${author} for ${c.name}.`);
    return;
  }
  // A picker rather than auto-including everything eligible — lets
  // someone hold specific logged work back for a later draft instead of
  // it being all-or-nothing.
  openAppModal(`
    <div class="modal-head"><span class="panel-title">Select improvements to include</span><span class="toast-close" onclick="${modalOpenForThis ? `openQueueCardModal('${id}',${jsArg(author)})` : 'closeAppModal()'}">✕</span></div>
    <div class="modal-body">
      <p style="font-size:13px;color:var(--muted);margin:0 0 12px;">Everything checked below will go into ${escapeHtml(author)}'s draft for ${escapeHtml(c.name)}. Uncheck anything you'd rather hold back for a later one.</p>
      <div style="display:flex;flex-direction:column;gap:2px;max-height:340px;overflow-y:auto;">
        ${eligibleImprovements.map(i=>`
          <label style="display:flex;align-items:flex-start;gap:10px;padding:8px 4px;border-bottom:1px solid var(--border);cursor:pointer;">
            <input type="checkbox" class="draft-select-checkbox" value="${i.id}" ${i.author===author?'checked':''} style="margin-top:3px;flex:none;">
            <span style="flex:1;font-size:14px;color:var(--ink);">${escapeHtml(i.text)}<br><span style="font-size:12px;color:var(--muted-lt);">${escapeHtml(i.author||'')} — ${i.date ? new Date(i.date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : 'no date'}</span></span>
          </label>
        `).join('')}
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="${modalOpenForThis ? `openQueueCardModal('${id}',${jsArg(author)})` : 'closeAppModal()'}">Cancel</button>
      <button class="btn btn-brand" onclick="confirmGenerateDraftSelection('${id}',${jsArg(author)})">Generate draft</button>
    </div>`, 520);
}

async function confirmGenerateDraftSelection(id, author){
  const c = clients.find(x=>x.id===id);
  if(!c) return;
  const d = getDraftFor(c, author);
  const checkedIds = [...document.querySelectorAll('.draft-select-checkbox:checked')].map(el=>el.value);
  if(!checkedIds.length){ showToast('error','Nothing selected','Check at least one improvement to include.'); return; }
  const includedImprovements = c.improvements.filter(i => checkedIds.includes(i.id));
  const btn = clickedBtn();
  setBtnLoading(btn, 'Generating…');
  const prompt = buildUpdatePrompt(c, includedImprovements);
  try{
    const response = await fetch("/api/generate-draft", {
      method:"POST", headers: await apiAuthHeaders(),
      body: JSON.stringify({ prompt, model: settings.openaiModel })
    });
    const data = await response.json();
    const text = (data.text || '').trim();
    const stayedApproved = d.draftStatus === 'approved';
    const fields = { draft: text || 'Could not generate a draft — try again.' };
    // Regenerating an already-approved draft doesn't require re-approval —
    // what was actually approved is the underlying included improvements,
    // which haven't changed, not this specific AI wording of them. A
    // fresh (never-approved) draft still becomes pending as before.
    if(!stayedApproved){
      fields.draftStatus = 'pending'; fields.draftPendingSince = new Date().toISOString();
      // A genuinely new cycle means different underlying content — the
      // "already sent" record from whatever was sent before no longer
      // applies to this draft. Deliberately NOT cleared in the
      // stayedApproved branch above — regenerating an already-approved
      // draft is still the same underlying work, so sendApprovedDraft()
      // should keep warning about it.
      fields.draftSentAt = null; fields.draftSentBy = '';
    } else {
      fields.draftStatus = d.draftStatus;
    }
    // A fresh/regenerated draft was never "marked ready to notify" for
    // this specific content — Team Queue shouldn't surface it to
    // approvers as awaiting review until the owning member explicitly
    // clicks Ready to Notify again.
    // An approver rewriting a draft that's in Review keeps it there: they're the one reviewing it.
    fields.readyToNotify = !!(d.readyToNotify && canApprove() && !stayedApproved);
    // Exactly what's in this draft cycle, from the picker's selection —
    // not re-derived from a date range. Read back by approveDraft() to
    // know precisely which rows to flip include_in_email off for.
    fields.draftImprovementIds = checkedIds;
    log.unshift({t:nowTime(), tag:'auto', text:`AI ${stayedApproved?'re-worded':'drafted'} ${escapeHtml(author)}'s update for <b>${escapeHtml(c.name)}</b> from ${includedImprovements.length} included improvement${includedImprovements.length!==1?'s':''}${stayedApproved?' — stayed approved, the included improvements didn\'t change':''}.`});
    const saved = await saveDraftFor(id, author, fields);
    if(!saved){
      // A silent "Draft generated" success toast here would be actively
      // misleading in exactly the way that's easy to mistake for "it's
      // not saving" — see saveDraftFor()'s own RLS-affected-0-rows check.
      renderQueue(); renderTeamQueue(); renderLog(); renderKpis();
      openQueueCardModal(id, author);
      showToast('error','Draft generated, but not saved', 'The AI wrote it, but saving to the database failed — check that all schema migrations have been run, then try again.');
      return;
    }
    await persistLog();
    renderQueue(); renderTeamQueue(); renderLog(); renderKpis();
    logClientActivity(id, 'draft_generated', `AI ${stayedApproved?'re-worded':'generated'} ${author}'s draft from ${includedImprovements.length} included improvement${includedImprovements.length!==1?'s':''} (of ${c.improvements.filter(i=>i.author===author).length} logged by them)${stayedApproved?' — approval carried over':''}.`);
    refreshClientDetailActivityIfOpen(id);
    openDraftAfterWriting(id, author);
    showToast('success','Draft generated', stayedApproved ? `${author}'s draft for ${c.name} was re-worded — still approved, no need to re-approve.` : `AI wrote ${author}'s update for ${c.name}.`);
    // No automatic notification here at all — the only way admins/
    // approvers get notified is the explicit "Ready to Notify" button,
    // which is also what makes a pending draft actually visible in Team
    // Queue (see renderTeamQueue()'s readyToNotify filter below).
  }catch(e){
    console.error('generateDraft failed', e);
    // Same reasoning as the success path above — a failed generation still
    // starts a fresh pending cycle that hasn't been marked ready for
    // review by anyone yet. Missing this reset was a real gap: a client
    // that had previously been marked Ready to Notify (then regenerated,
    // then hit this failure branch) would keep showing up in Team Queue —
    // and in its badge count — for a draft nobody had actually flagged.
    const saved = await saveDraftFor(id, author, {
      draft: 'AI generation failed — you can write the draft manually here.',
      draftStatus: 'pending', draftPendingSince: new Date().toISOString(),
      readyToNotify: false, draftImprovementIds: checkedIds,
    });
    renderQueue(); renderTeamQueue(); renderLog(); renderKpis();
    openDraftAfterWriting(id, author);
    showToast('error', saved ? 'AI generation failed' : 'AI generation failed, and the fallback state failed to save too', saved ? 'Write the draft manually below, or try again.' : 'Try refreshing before writing a draft manually — this client\'s saved state may be stale.');
  }
}

// The Send button on an already-approved card — same confirmation flow
// approveDraft() itself uses when it opens the email right after approving,
// for the case where that got dismissed earlier without actually sending.
async function sendApprovedDraft(id, author){
  const c = clients.find(x=>x.id===id);
  if(!c) return;
  const d = getDraftFor(c, author);
  if(blockIfWorkDeleted(c, d)) return;
  // WhatsApp clients: Radar never posts there. Copy it for the group instead.
  if(typeof winViaWhatsapp === 'function' && winViaWhatsapp(c)) return copyWinForWhatsapp(id, author);
  if(!c.email){ askForClientEmail(c); return; }
  // Already sent this exact draft once — require an explicit
  // confirmation naming who sent it and when, rather than silently
  // allowing (or silently blocking) a second send. A genuinely new draft
  // cycle clears this automatically (see confirmGenerateDraftSelection());
  // reaching here with draftSentAt still set means this is the same
  // underlying content being sent again.
  if(d.draftSentAt){
    const who = d.draftSentBy && d.draftSentBy === myName() ? 'You' : (d.draftSentBy || 'Someone');
    const sentDate = new Date(d.draftSentAt).toLocaleDateString('en-US',{month:'long', day:'numeric', year:'numeric'});
    const confirmed = await confirmDialog(
      `${who} sent ${author}'s update to ${c.name} (${c.email}) on ${sentDate}. Are you sure you want to send it again?`,
      { confirmLabel:'Send again' }
    );
    if(!confirmed) return;
  }
  showSendEmailConfirm(c.email, `Your weekly update from ${settings.appName || 'Based Agency'}`, d.draft || '', () => recordDraftSent(id, author), true);
}

// Called only once the email actually, successfully sends (via
// showSendEmailConfirm's onSent callback) — never on a failed or
// cancelled attempt, so draftSentAt always reflects a real delivery.
async function recordDraftSent(id, author){
  const c = clients.find(x=>x.id===id);
  if(!c) return;
  const at = new Date().toISOString();
  await saveDraftFor(id, author, { draftSentAt: at, draftSentBy: myName() || 'Someone', sentVia: 'email' });
  // Kept apart from the draft row, which the next week's draft overwrites: the on-time
  // history in This Week and Health reads from here.
  if(typeof recordUpdateSent === 'function') await recordUpdateSent(id, at);
}

// Archives a sent draft off the board. Clears the sent draft's text —
// that's what queueCardEligible() reads as "no live draft any more" — and
// marks any of this author's still-unsent improvements for this client as
// excluded from email (the same toggle used on Past Improvements), so the
// card disappears from every tab including Sent and the Sent count drops to
// match. The draft keeps its Approved/Sent status and sent date, so Weekly
// Completion still counts it.
async function archiveSentDraft(clientId, author){
  const c = clients.find(x=>x.id===clientId);
  if(!c) return;
  const toArchive = c.improvements.filter(i=>i.author===author && i.includeInEmail!==false);
  const btn = clickedBtn();
  setBtnLoading(btn, 'Archiving…');
  let ok = true;
  if(toArchive.length){
    const ids = toArchive.map(i=>i.id);
    // .select() after .update() to confirm every targeted row was actually
    // affected — same RLS-block detection pattern used elsewhere on this
    // table (see toggleImprovementIncludeInEmail()), since a silently
    // blocked update reports success while changing nothing.
    const { data, error } = await supabaseClient.from('client_improvements').update({ include_in_email: false }).in('id', ids).select();
    ok = !error && !!(data && data.length === ids.length);
    if(error) console.error('archiveSentDraft failed', clientId, author, error);
    else if(!ok) console.error('archiveSentDraft: update affected fewer rows than expected (likely blocked by RLS)', clientId, author);
    if(ok) toArchive.forEach(i => { i.includeInEmail = false; });
  }
  if(ok) ok = await saveDraftFor(clientId, author, { draft: '' });
  restoreBtn(btn);
  renderTeamQueue();
  renderQueue();
  renderKpis();
  if(ok) showToast('success','Archived', `${author}'s sent update for ${c.name} is now archived.`);
  else showToast('error','Archive failed','Could not archive — try again.');
}

let _groupSendClientId = null;
let _groupSendAuthors = [];

// "Group & Send" combines approved, unsent drafts from DIFFERENT team
// members for the SAME client into one email, instead of an approver
// sending each person's update to that client separately. Only surfaces
// clients where this actually applies — one approved draft doesn't need
// grouping, the regular per-card Send button already covers that case.
function openCombineDraftsModal(){
  const eligibleClients = activeClients().filter(c => {
    const approvedNotSent = (c.drafts||[]).filter(d => d.draftStatus==='approved' && !d.draftSentAt);
    return approvedNotSent.length >= 2;
  }).sort((a,b)=>a.name.localeCompare(b.name));
  if(!eligibleClients.length){ showToast('info','Nothing to combine', 'No client has approved, unsent drafts from more than one person.'); return; }
  openAppModal(`<h3>Combine Drafts</h3>
<p style="margin:-8px 0 14px;font-size:14px;color:var(--label-2);line-height:1.5">These clients have approved drafts from more than one person. Pick one to send as a single email.</p>
<div class="grp" style="box-shadow:0 0 0 .5px var(--sep-strong);max-height:360px;overflow:auto">
${eligibleClients.map(c=>{
  const count = (c.drafts||[]).filter(d => d.draftStatus==='approved' && !d.draftSentAt).length;
  return `<a class="row" href="#" onclick="openGroupSendDraftPicker('${c.id}');return false;">${monoHtml(c)}<div class="tx"><span class="t">${escapeHtml(c.name)}</span><span class="s">${count} approved drafts</span></div><div class="r">${icon('caret-right', { weight: 'bold' })}</div></a>`;
}).join('')}
</div>
<div class="sheet-a"><button class="btn" onclick="openGroupAndSendModal()">Back</button><button class="btn" onclick="closeAppModal()">Cancel</button></div>`, 520);
}

function openGroupSendDraftPicker(clientId){
  const c = clients.find(x=>x.id===clientId);
  if(!c) return;
  // Re-checked fresh rather than trusting the count from the previous
  // screen — another approver could have sent one of these in the
  // meantime, or the underlying draft could have changed.
  const approvedNotSent = (c.drafts||[]).filter(d => d.draftStatus==='approved' && !d.draftSentAt);
  if(approvedNotSent.length < 2){ showToast('info','Nothing to combine', `${c.name} no longer has approved drafts from more than one person.`); closeAppModal(); return; }

  openAppModal(`<h3>Combine Drafts for ${escapeHtml(c.name)}</h3>
<p style="margin:-8px 0 14px;font-size:14px;color:var(--label-2);line-height:1.5">Uncheck any you’d rather send on their own. It takes two to combine.</p>
<div class="grp" style="box-shadow:0 0 0 .5px var(--sep-strong);max-height:320px;overflow:auto">
${approvedNotSent.map(d=>`<label class="row" style="cursor:default"><input type="checkbox" class="group-send-draft-checkbox ck-native" value="${escapeHtml(d.author)}" checked>${avHtml(d.author)}<div class="tx"><span class="t">${escapeHtml(d.author)}</span><span class="s">${escapeHtml((d.draft||'').replace(/\s+/g,' ').slice(0,90))}${(d.draft||'').length>90?'…':''}</span></div></label>`).join('')}
</div>
<div class="sheet-a"><button class="btn" onclick="openCombineDraftsModal()">Back</button><button class="btn btn-p" onclick="confirmGroupSendSelection('${clientId}')">Continue</button></div>`, 520);
}

// Combines the selected authors' approved draft text into one starting
// body — a reasonable draft the approver can still edit in the send modal
// before it actually goes out, not an attempt at seamlessly merging
// separate greetings/sign-offs into one message on its own.
function confirmGroupSendSelection(clientId){
  const checkedAuthors = [...document.querySelectorAll('.group-send-draft-checkbox:checked')].map(el=>el.value);
  if(checkedAuthors.length < 2){ showToast('error','Pick at least two', "Select at least two team members' drafts to combine — one alone doesn't need grouping."); return; }
  const c = clients.find(x=>x.id===clientId);
  if(!c) return;
  if(!c.email){ askForClientEmail(c); return; }

  _groupSendClientId = clientId;
  _groupSendAuthors = checkedAuthors;
  const combinedBody = checkedAuthors.map(author => getDraftFor(c, author).draft || '').filter(Boolean).join('\n\n---\n\n');
  showSendEmailConfirm(c.email, `Your weekly update from ${settings.appName || 'Based Agency'}`, combinedBody, () => recordGroupSendComplete(), true);
}

// Marks every included draft sent, in parallel — mirrors recordDraftSent()
// but for the whole selected group at once, since a combined send needs
// every one of them stamped, not just the one client/author pair
// recordDraftSent() alone would handle.
async function recordGroupSendComplete(){
  const clientId = _groupSendClientId;
  const authors = _groupSendAuthors;
  if(!clientId || !authors.length) return;
  await Promise.all(authors.map(author => recordDraftSent(clientId, author)));
  renderTeamQueue();
  showToast('success','Sent', `Combined update sent, covering ${authors.length} team members' work.`);
}

function canGenerateOrRegenerateDraft(c, author){
  const d = getDraftFor(c, author);
  // Locked for the original contributor once they've told an approver
  // it's ready — regenerating out from under someone who's actively
  // reviewing it would silently change what they're looking at.
  // Approvers/admins keep full control regardless, since they're the
  // ones with authority over what happens next.
  if(d.draftStatus==='pending' && d.readyToNotify===true && !canApprove()) return false;
  // Each person can always work on their own draft (subject to the lock
  // above) — draft state is now genuinely per-author, so "is this my own
  // draft" replaces the old "did I contribute to the shared draft"
  // question entirely. Anyone else's draft is admin/approver territory,
  // matching their oversight role across the whole team.
  if(author === myName()) return true;
  return canApprove();
}

// Whoever's actual logged work is included in this specific draft — reads
// the exact selection from generateDraft()'s picker (d.draftImprovementIds),
// not a re-derived date heuristic, so this matches "whose work is actually
// part of it" precisely. Takes the draft object directly now rather than
// just the client, since a client can have several independent drafts (one
// per author) with different improvements included in each. Excludes the
// current user, since notifying yourself about your own client's status
// wouldn't make sense.
function getIncludedAuthorProfiles(c, d){
  const includedIds = new Set(d.draftImprovementIds || []);
  const includedAuthors = [...new Set(
    c.improvements.filter(i => includedIds.has(i.id)).map(i=>i.author)
  )].filter(author => author && author !== myName());
  return includedAuthors.map(name => teamProfiles.find(p=>p.name===name)).filter(Boolean);
}

// The draft box being edited: the open sheet's, else the one in the pane
// of the screen you're on. (Review and Team Queue both keep a pane, so the
// same draft can be on the page twice — the hidden copy must never win.)
function queueDraftTextarea(id){
  const sel = 'textarea#draft-' + CSS.escape(id);
  const inSheet = document.querySelector('#appModalOverlay ' + sel);
  if(inSheet && inSheet.offsetParent) return inSheet;
  return document.querySelector('.view.active ' + sel) || document.getElementById('draft-' + id);
}

async function approveDraft(id, author){
  if(!canApprove()){ showToast('error','Not allowed','Only admins and approvers can approve drafts.'); return false; }
  const ta = queueDraftTextarea(id);
  { const c0 = clients.find(x=>x.id===id); if(c0 && blockIfWorkDeleted(c0, getDraftFor(c0, author))) return false; }
  setBtnLoading(clickedBtn(), 'Approving…');

  await loadAll();
  const c = clients.find(x=>x.id===id);
  if(!c) return;
  const d = getDraftFor(c, author);
  const modalCard = document.querySelector('#appModalOverlay .modal-card');
  const modalOpenForThis = modalCard && modalCard.dataset.clientId === id && modalCard.dataset.author === author;
  const fields = { draftStatus: 'approved' };
  if(ta) fields.draft = ta.value;
  // who approved it and when (This Week: "Approved by Albert 20 min ago"); nobody has copied it yet
  if(typeof winsDbReady === 'function' && winsDbReady()) Object.assign(fields, { approvedBy: myName() || '', approvedAt: new Date().toISOString(), waCopiedBy: '', waCopiedAt: null });
  // Captured before draftImprovementIds gets cleared below —
  // getIncludedAuthorProfiles() needs it.
  const includedAuthorProfiles = getIncludedAuthorProfiles(c, d);
  const includedIds = d.draftImprovementIds || [];
  log.unshift({t:nowTime(), tag:'you', userId:currentUser?.id, text:`Approved ${escapeHtml(author)}'s draft for <b>${escapeHtml(c.name)}</b>.`});
  // Once approved, the specific improvements that were part of THIS
  // draft are considered communicated — flipping include_in_email off
  // for exactly those is what naturally keeps them from being offered
  // again in a future draft, without needing any date-based heuristic.
  if(includedIds.length){
    c.improvements.forEach(i => { if(includedIds.includes(i.id)) i.includeInEmail = false; });
  }
  fields.draftImprovementIds = [];
  const ok = await saveDraftFor(id, author, fields);
  if(ok && includedIds.length){
    await supabaseClient.from('client_improvements').update({ include_in_email: false }).in('id', includedIds);
  }
  if(ok) await persistLog();
  renderQueue(); renderTeamQueue(); renderLog(); renderKpis();
  if(modalOpenForThis) openQueueCardModal(id, author);
  if(!ok){ showToast('error','Save failed','Approval may not have synced — refresh and check.'); return false; }
  logClientActivity(id, 'draft_approved', `${myName()||'Someone'} approved ${author}'s draft.`);
  refreshClientDetailActivityIfOpen(id);

  // Notify whoever's actual logged work was included in what just got
  // approved.
  for(const authorProfile of includedAuthorProfiles){
    // A WhatsApp win's writer hears from approveWin() instead: it's theirs to send now.
    if(authorProfile.name === author && typeof winViaWhatsapp === 'function' && winViaWhatsapp(c)) continue;
    await sendNotification(authorProfile.id, 'draft_approved', 'Your submission was approved', `${myName()||'An approver'} approved ${author}'s draft for ${c.name}, which included your logged work.`, 'approve');
  }

  showToast('success','Draft approved', `${author}'s update for ${c.name} was approved.`);
}

// Admins/approvers don't need to approve their own work — that's a
// redundant gate when the person who'd be reviewing it is the same person
// who wrote it (see applyRoleVisibility()'s removal of their personal
// Approval Queue tab). This is what their own pending drafts show as a
// single "Send" action in Team Queue instead of the usual two separate
// Approve-then-Send steps — reuses both existing functions rather than
// duplicating their logic, so approving still behaves identically
// underneath (including the notification loop, which is a no-op here
// anyway since every improvement in your own draft is authored by you,
// and that loop already excludes yourself).
async function approveAndSendOwnDraft(id, author){
  // Someone else's WhatsApp win goes back to them to send once it's approved.
  const c0 = clients.find(x=>x.id===id);
  if(c0 && typeof winViaWhatsapp === 'function' && winViaWhatsapp(c0) && author !== myName()) return approveWin(id, author);
  if((await approveDraft(id, author)) === false) return;
  await sendApprovedDraft(id, author);
}

async function skipDraft(id, author){
  if(!canApprove()){ showToast('error','Not allowed','Only admins and approvers can skip drafts.'); return; }
  setBtnLoading(clickedBtn(), 'Skipping…');
  await loadAll();
  const c = clients.find(x=>x.id===id);
  if(!c) return;
  const d = getDraftFor(c, author);
  const modalCard = document.querySelector('#appModalOverlay .modal-card');
  const modalOpenForThis = modalCard && modalCard.dataset.clientId === id && modalCard.dataset.author === author;
  // Captured before draftImprovementIds gets cleared below — used by the
  // notification loop at the end of this function.
  const includedAuthorProfiles = getIncludedAuthorProfiles(c, d);
  const includedIds = d.draftImprovementIds || [];
  const nothingLeft = draftWorkAllDeleted(c, d); // discarding a draft whose work was all deleted
  // Same treatment as approveDraft(): flipping include_in_email off for
  // exactly the improvements that were part of THIS draft is what keeps
  // them from silently reappearing in a future draft. Previously this was
  // left untouched on the theory that "nothing was sent, so it should stay
  // eligible" — but that meant skipping only discarded the draft text
  // itself, while the underlying logged work stayed eligible and got
  // pulled right back into whatever draft was generated next, which read
  // as the skip having done nothing at all a week later.
  if(includedIds.length){
    c.improvements.forEach(i => { if(includedIds.includes(i.id)) i.includeInEmail = false; });
  }
  log.unshift({t:nowTime(), tag:'you', userId:currentUser?.id, text:`Skipped ${escapeHtml(author)}'s draft for <b>${escapeHtml(c.name)}</b> — no email sent.`});
  // A full reset back to square one — any prior "already sent" record
  // belongs to this now-abandoned cycle, not whatever draft eventually
  // gets generated next for this author/client pair.
  const ok = await saveDraftFor(id, author, { draftStatus:'none', draft:'', draftImprovementIds: [], draftSentAt: null, draftSentBy: '' });
  if(ok && includedIds.length){
    await supabaseClient.from('client_improvements').update({ include_in_email: false }).in('id', includedIds);
  }
  if(ok) await persistLog();
  renderQueue(); renderTeamQueue(); renderLog(); renderKpis();
  if(ok){ logClientActivity(id, 'draft_skipped', `${myName()||'Someone'} skipped ${author}'s update.`); refreshClientDetailActivityIfOpen(id); }
  if(modalOpenForThis) openQueueCardModal(id, author);
  ok ? (nothingLeft ? showToast('info','Draft discarded', `${author}'s draft for ${c.name} was discarded.`) : showToast('info','Skipped', `${author}'s update for ${c.name} won't be sent — those improvements are now excluded from future drafts too.`)) : showToast('error','Save failed','Could not save — try again.');
  if(ok){
    for(const authorProfile of includedAuthorProfiles){
      sendNotification(authorProfile.id, 'draft_skipped', 'Draft skipped', `${myName()||'An approver'} skipped ${author}'s draft for ${c.name}, which included your logged work — no email was sent.`, 'approve');
    }
  }
}
