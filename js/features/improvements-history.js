// Past Improvements: every logged improvement across clients, filterable.

/* ---------- Past Improvements — every logged improvement, across every client, filterable ---------- */

let improvementsPage = 1;
const IMPROVEMENTS_PAGE_SIZE = 10;

// Shared prev/next pagination controls — used by both Reports' table and
// Past Improvements' list, rather than each building its own slightly
// different version of the same thing. Renders nothing when everything
// already fits on one page.
function paginationControlsHtml(currentPage, totalItems, pageSize, onPageChangeFnName){
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if(totalPages <= 1) return '';
  return `<div class="pagination-controls">
    <button class="btn btn-outline" ${currentPage<=1?'disabled':''} onclick="${onPageChangeFnName}(${currentPage-1})">‹ Prev</button>
    <span class="pagination-label">Page ${currentPage} of ${totalPages}</span>
    <button class="btn btn-outline" ${currentPage>=totalPages?'disabled':''} onclick="${onPageChangeFnName}(${currentPage+1})">Next ›</button>
  </div>`;
}

// Role-scoped: a regular team member only sees their own logged
// improvements here — Past Improvements is personal for them, same as
// their own Queue. Admins and approvers see everyone's, since reviewing
// across the whole team is the actual point of their role. Applied here
// at the source rather than in renderImprovementsHistory() itself, since
// getFilteredImprovements() (used by "Delete all") needs to match
// exactly the same restricted set, not accidentally operate on
// improvements the current viewer isn't even supposed to see.
function getAllImprovementsFlat(){
  const list = [];
  const restrictToSelf = !canApprove();
  const me = myName();
  activeClients().forEach(c=>{
    (c.improvements||[]).forEach(imp=>{
      if(restrictToSelf && imp.author !== me) return;
      list.push({ id:imp.id, clientId:c.id, clientName:c.name, author:imp.author||'Team member', text:imp.text, date:imp.date, includeInEmail: imp.includeInEmail!==false, source: imp.source||'manual', service: imp.service||'', attachments: imp.attachments||[] });
    });
  });
  return list.sort((a,b)=> new Date(b.date||0) - new Date(a.date||0));
}

function populateImprovementsClientFilter(){
  const sel = document.getElementById('improvementsClientFilter');
  if(!sel) return;
  const current = sel.value || 'all';
  sel.innerHTML = `<option value="all">All clients</option>` + activeClients().sort((a,b)=>a.name.localeCompare(b.name)).map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  if([...sel.options].some(o=>o.value===current)) sel.value = current;
}

function populateImprovementsMemberFilter(){
  const sel = document.getElementById('improvementsMemberFilter');
  if(!sel) return;
  const current = sel.value || 'all';
  sel.innerHTML = `<option value="all">Everyone</option>` + [...teamProfiles].sort((a,b)=>a.name.localeCompare(b.name)).map(p=>`<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`).join('');
  if([...sel.options].some(o=>o.value===current)) sel.value = current;
}

function clearImprovementsFilters(){
  const search = document.getElementById('improvementsSearch'); if(search) search.value = '';
  const clientSel = document.getElementById('improvementsClientFilter'); if(clientSel) clientSel.value = 'all';
  const memberSel = document.getElementById('improvementsMemberFilter'); if(memberSel) memberSel.value = 'all';
  const fromEl = document.getElementById('improvementsFromDate'); if(fromEl) fromEl.value = '';
  const toEl = document.getElementById('improvementsToDate'); if(toEl) toEl.value = '';
  const inclSel = document.getElementById('improvementsInclFilter'); if(inclSel) inclSel.value = 'all';
  improvementsPage = 1;
  renderImprovementsHistory();
}

function toggleImprovementsFiltersPopover(){
  const el = document.getElementById('improvementsFiltersPopover');
  if(!el) return;
  el.style.display = el.style.display==='block' ? 'none' : 'block';
}

document.addEventListener('click', (e)=>{
  const popover = document.getElementById('improvementsFiltersPopover');
  const wrap = popover?.closest('.filters-popover-wrap');
  if(popover && popover.style.display==='block' && wrap && !wrap.contains(e.target)) popover.style.display = 'none';
});

const IMPROVEMENT_SOURCE_LABEL = { time:'From Time Tracker', note:'From Notes', manual:'Logged directly', task:'From Tasks' };

// Recomputes the exact same filtered set renderImprovementsHistory() shows,
// so "Delete all" always matches what's actually on screen — deleting the
// full history if no filter is active, or just the narrowed subset if one is.
function getFilteredImprovements(){
  const all = getAllImprovementsFlat();
  const search = (document.getElementById('improvementsSearch')?.value || '').trim().toLowerCase();
  const clientFilter = document.getElementById('improvementsClientFilter')?.value || 'all';
  const inclFilter = document.getElementById('improvementsInclFilter')?.value || 'all';
  const fromVal = document.getElementById('improvementsFromDate')?.value;
  const toVal = document.getElementById('improvementsToDate')?.value;
  const fromDate = fromVal ? new Date(fromVal+'T00:00:00') : null;
  const toDate = toVal ? new Date(toVal+'T23:59:59') : null;
  return all.filter(imp=>{
    if(clientFilter!=='all' && imp.clientId!==clientFilter) return false;
    if(inclFilter==='included' && !imp.includeInEmail) return false;
    if(inclFilter==='excluded' && imp.includeInEmail) return false;
    if(search && !imp.text.toLowerCase().includes(search) && !imp.clientName.toLowerCase().includes(search)) return false;
    if(fromDate || toDate){
      if(!imp.date) return false;
      const d = new Date(imp.date);
      if(fromDate && d < fromDate) return false;
      if(toDate && d > toDate) return false;
    }
    return true;
  });
}

async function deleteAllFilteredImprovements(){
  const filtered = getFilteredImprovements();
  if(!filtered.length){ showToast('info','Nothing to delete','No improvements match the current filters.'); return; }
  // to Recently Deleted, with the time logged with them; drafts and people as in trashWork (data.js)
  const r = await deleteWorkAsk(filtered.map(imp => imp.id));
  if(!r || !r.ok) return;
  const n = r.moved.length;
  log.unshift({t:nowTime(), tag:'you', userId:currentUser?.id, text:`Deleted ${n} logged improvement${n!==1?'s':''}.`});
  await persistLog();
  renderAll();
}

function renderImprovementsHistory(){
  const el = document.getElementById('improvementsHistoryList');
  const countEl = document.getElementById('improvementsFilterCount');
  if(!el) return;

  const all = getAllImprovementsFlat();
  const search = (document.getElementById('improvementsSearch')?.value || '').trim().toLowerCase();
  const clientFilter = document.getElementById('improvementsClientFilter')?.value || 'all';
  const memberFilter = document.getElementById('improvementsMemberFilter')?.value || 'all';
  const inclFilter = document.getElementById('improvementsInclFilter')?.value || 'all';
  const fromVal = document.getElementById('improvementsFromDate')?.value;
  const toVal = document.getElementById('improvementsToDate')?.value;
  const fromDate = fromVal ? new Date(fromVal+'T00:00:00') : null;
  const toDate = toVal ? new Date(toVal+'T23:59:59') : null;

  const filtered = all.filter(imp=>{
    if(clientFilter!=='all' && imp.clientId!==clientFilter) return false;
    if(memberFilter!=='all' && imp.author!==memberFilter) return false;
    if(inclFilter==='included' && !imp.includeInEmail) return false;
    if(inclFilter==='excluded' && imp.includeInEmail) return false;
    if(search && !imp.text.toLowerCase().includes(search) && !imp.clientName.toLowerCase().includes(search)) return false;
    if(fromDate || toDate){
      if(!imp.date) return false;
      const d = new Date(imp.date);
      if(fromDate && d < fromDate) return false;
      if(toDate && d > toDate) return false;
    }
    return true;
  });

  if(countEl){
    const isFiltered = search || clientFilter!=='all' || memberFilter!=='all' || inclFilter!=='all' || fromVal || toVal;
    countEl.textContent = isFiltered ? `${filtered.length} of ${all.length} shown` : (all.length ? `${all.length} total` : '');
  }
  const badge = document.getElementById('improvementsFiltersBadge');
  if(badge){
    const activeCount = (clientFilter!=='all'?1:0) + (memberFilter!=='all'?1:0) + (inclFilter!=='all'?1:0) + (fromVal||toVal?1:0);
    badge.textContent = activeCount;
    badge.style.display = activeCount ? 'inline-flex' : 'none';
  }

  if(!all.length){ el.innerHTML = `<div class="panel"><div class="empty">No improvements logged yet — once the team starts logging, they'll show up here.</div></div>`; return; }
  if(!filtered.length){ el.innerHTML = `<div class="panel"><div class="empty">Nothing matches these filters — try widening the date range or clearing a filter.</div></div>`; return; }

  // Grouped by client, not a flat list — each group keeps its own
  // improvements together (sorted newest-first, matching getAllImprovementsFlat's
  // own order), then groups themselves are sorted by their most recent
  // improvement so the clients with the freshest activity surface first.
  const groupsMap = new Map();
  filtered.forEach(imp=>{
    if(!groupsMap.has(imp.clientId)) groupsMap.set(imp.clientId, []);
    groupsMap.get(imp.clientId).push(imp);
  });
  const groups = [...groupsMap.entries()]
    .map(([clientId, imps])=>({ clientId, clientName: imps[0].clientName, improvements: imps }))
    .sort((a,b)=> new Date(b.improvements[0].date||0) - new Date(a.improvements[0].date||0));

  // Paginate by client group, not raw improvement count — otherwise a
  // page boundary could cut a client's history in half, showing part of
  // it on one page and the rest on the next.
  const totalPages = Math.max(1, Math.ceil(groups.length / IMPROVEMENTS_PAGE_SIZE));
  if(improvementsPage > totalPages) improvementsPage = totalPages;
  const pageGroups = groups.slice((improvementsPage-1)*IMPROVEMENTS_PAGE_SIZE, improvementsPage*IMPROVEMENTS_PAGE_SIZE);

  el.innerHTML = pageGroups.map(group=>{
    const c = clients.find(x=>x.id===group.clientId);
    return `<div class="panel" style="margin-bottom:14px;">
      <div class="panel-body">
        <div class="team-queue-member-head" style="cursor:pointer;" onclick="openClientDetail('${group.clientId}')">
          <div>
            <div class="team-queue-member-name">${escapeHtml(group.clientName)}${c ? ` <span class="cell-service" style="margin-left:8px;">${escapeHtml(c.service)}</span>` : ''}</div>
          </div>
        </div>
        ${group.improvements.map(imp=>`
          <div class="imp-group-row">
            <div class="ts-entry-info">
              <div class="ts-entry-title">
                <span class="ts-entry-service">${escapeHtml(imp.author)}</span>
                <span style="color:var(--muted-lt);font-size:11px;margin-left:8px;">${imp.date ? new Date(imp.date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : ''}</span>
                ${imp.source!=='manual' ? `<span class="pill pill-status" style="margin-left:6px;">${IMPROVEMENT_SOURCE_LABEL[imp.source]||imp.source}</span>` : ''}
              </div>
              <div class="ts-entry-desc">${escapeHtml(imp.text)}</div>
            </div>
            <div class="ts-entry-right" style="align-items:flex-end;gap:6px;">
              <label class="include-toggle" title="Include in the client email">
                <input type="checkbox" ${imp.includeInEmail?'checked':''} onchange="event.stopPropagation();toggleImprovementIncludeInEmail('${imp.clientId}', '${imp.id}', this.checked)">
                <span class="toggle-track"></span>
                <span>${imp.includeInEmail ? 'Included in email' : 'Not in email'}</span>
              </label>
            </div>
          </div>`).join('')}
      </div>
    </div>`;
  }).join('') + paginationControlsHtml(improvementsPage, groups.length, IMPROVEMENTS_PAGE_SIZE, 'changeImprovementsPage');
}

function changeImprovementsPage(page){
  improvementsPage = page;
  renderImprovementsHistory();
}

async function toggleImprovementIncludeInEmail(clientId, impId, checked){
  await loadAll();
  const c = clients.find(x=>x.id===clientId);
  const imp = c && c.improvements.find(i=>i.id===impId);
  if(!imp) return;
  if(workLockedToast(imp)){ renderImprovementsHistory(); return; }   // in an update in review or approved
  // .select() after .update() to confirm a row was actually affected —
  // same reasoning as the delete functions fixed earlier on this exact
  // table: an RLS policy that silently blocks the update reports success
  // (no error) while changing nothing, which is exactly what made this
  // look like "I uncheck it and it re-checks itself" — the checkbox
  // briefly showed the new state, but the database never actually
  // changed, so the very next loadAll() (run at the top of this same
  // function on the next interaction) fetched back the old value.
  const { data, error } = await supabaseClient.from('client_improvements').update({ include_in_email: checked }).eq('id', impId).select();
  const ok = !error && !!(data && data.length);
  if(error) console.error('toggleImprovementIncludeInEmail failed', impId, error);
  else if(!ok) console.error('toggleImprovementIncludeInEmail: update affected 0 rows (likely blocked by RLS)', impId);
  if(ok) imp.includeInEmail = checked;
  renderImprovementsHistory();
  if(!ok) showToast('error','Save failed','Could not save — try again.');
}
