// Clients list: table, filters, sorting, pagination, bulk selection,
// row action menus, move to trash.

let clientFilters = { search:'', service:'all', status:'all', importance:'all', danger:'all', logged:'all' };
let clientSort = { field:'name', dir:'asc' };
let clientsPage = 1;
const CLIENTS_PAGE_SIZE = 10;
let selectedClientIds = new Set();
let clientBulkModeOn = false;

function toggleClientBulkMode(){
  clientBulkModeOn = !clientBulkModeOn;
  document.body.classList.toggle('clients-bulk-mode-on', clientBulkModeOn);
  const btn = document.getElementById('clientsBulkModeBtn');
  if(btn) btn.classList.toggle('active', clientBulkModeOn);
  if(!clientBulkModeOn) clearClientSelection();
}

function onClientRowCheck(checkboxEl){
  if(checkboxEl.checked) selectedClientIds.add(checkboxEl.value);
  else selectedClientIds.delete(checkboxEl.value);
  updateClientsBulkBar();
  updateSelectAllCheckboxState();
}

function toggleAllClientSelection(checked){
  document.querySelectorAll('.client-row-checkbox').forEach(cb=>{
    cb.checked = checked;
    if(checked) selectedClientIds.add(cb.value); else selectedClientIds.delete(cb.value);
  });
  updateClientsBulkBar();
}

function updateSelectAllCheckboxState(){
  const boxes = [...document.querySelectorAll('.client-row-checkbox')];
  const selectAll = document.getElementById('clientsSelectAll');
  if(selectAll) selectAll.checked = boxes.length>0 && boxes.every(cb=>cb.checked);
}

function clearClientSelection(){
  selectedClientIds.clear();
  document.querySelectorAll('.client-row-checkbox').forEach(cb=>cb.checked=false);
  const selectAll = document.getElementById('clientsSelectAll');
  if(selectAll) selectAll.checked = false;
  updateClientsBulkBar();
}

function updateClientsBulkBar(){
  const bar = document.getElementById('clientsBulkBar');
  const countEl = document.getElementById('clientsBulkCount');
  if(!bar) return;
  const n = selectedClientIds.size;
  bar.style.display = n ? 'flex' : 'none';
  if(countEl) countEl.textContent = `${n} client${n!==1?'s':''} selected`;
}

async function bulkDeleteClients(){
  if(!hasAccess('delete_clients')){ showToast('error','Not allowed','Only admins and approvers can delete clients.'); return; }
  const ids = [...selectedClientIds];
  if(!ids.length) return;
  if(!(await confirmDialog(`Move ${ids.length} client${ids.length!==1?'s':''} to Trash? Their improvements, drafts, time entries, and notes stay intact and this can be undone from Trash.`, {confirmLabel:'Move to Trash'}))) return;
  await loadAll();
  const names = [];
  const toDelete = [];
  ids.forEach(id=>{
    const c = clients.find(x=>x.id===id);
    if(c && !c.deletedAt){ toDelete.push({ c, deletedAt: new Date().toISOString() }); names.push(c.name); }
  });
  const results = await Promise.all(toDelete.map(({c, deletedAt}) => updateClientRow(c.id, { deletedAt })));
  toDelete.forEach(({c, deletedAt}, i)=>{ if(results[i]) c.deletedAt = deletedAt; });
  log.unshift({t:nowTime(), tag:'you', userId:currentUser?.id, text:`Moved ${names.length} client${names.length!==1?'s':''} to Trash.`});
  const ok = await persistLog();
  clearClientSelection();
  renderAll();
  ok ? showToast('success','Moved to Trash', `${names.length} client${names.length!==1?'s':''} can be restored from Trash.`) : showToast('error','Delete failed','Could not save — try again.');
}

function renderClientsPagination(totalItems){
  const el = document.getElementById('clientsPagination');
  if(!el) return;
  const totalPages = Math.max(1, Math.ceil(totalItems / CLIENTS_PAGE_SIZE));
  if(clientsPage > totalPages) clientsPage = totalPages;
  if(clientsPage < 1) clientsPage = 1;
  const start = totalItems===0 ? 0 : (clientsPage-1)*CLIENTS_PAGE_SIZE + 1;
  const end = Math.min(clientsPage*CLIENTS_PAGE_SIZE, totalItems);
  const countLabel = `Showing ${totalItems ? `${start}-${end}` : '0'} of ${totalItems} client${totalItems!==1?'s':''}`;

  if(totalPages<=1){
    el.innerHTML = `<span class="table-pagination-count">${countLabel}</span>`;
    return;
  }

  const pages = [];
  for(let p=1;p<=totalPages;p++){
    if(p===1 || p===totalPages || Math.abs(p-clientsPage)<=1) pages.push(p);
    else if(pages[pages.length-1]!=='…') pages.push('…');
  }

  el.innerHTML = `
    <span class="table-pagination-count">${countLabel}</span>
    <div class="table-pagination-pages">
      <button class="pagination-btn" ${clientsPage===1?'disabled':''} onclick="goToClientsPage(${clientsPage-1})" aria-label="Previous page">‹</button>
      ${pages.map(p=> p==='…' ? `<span class="pagination-ellipsis">…</span>` : `<button class="pagination-btn ${p===clientsPage?'active':''}" onclick="goToClientsPage(${p})">${p}</button>`).join('')}
      <button class="pagination-btn" ${clientsPage===totalPages?'disabled':''} onclick="goToClientsPage(${clientsPage+1})" aria-label="Next page">›</button>
    </div>`;
}

function goToClientsPage(p){
  clientsPage = p;
  renderClientsTable();
}


function onClientSearchInput(){
  clientFilters.search = document.getElementById('clientSearch').value.trim().toLowerCase();
  clientsPage = 1;
  renderClientsTable();
}

function populateClientFilterSelects(){
  const svcSel = document.getElementById('filterService');
  const statSel = document.getElementById('filterStatus');
  if(svcSel){
    const current = svcSel.value || clientFilters.service;
    svcSel.innerHTML = `<option value="all">All services</option>` + (settings.serviceOptions||[]).map(o=>`<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
    if([...svcSel.options].some(o=>o.value===current)) svcSel.value = current;
  }
  if(statSel){
    const current = statSel.value || clientFilters.status;
    statSel.innerHTML = `<option value="all">All statuses</option>` + (settings.statusOptions||[]).map(o=>`<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
    if([...statSel.options].some(o=>o.value===current)) statSel.value = current;
  }
  const impSel = document.getElementById('filterImportance'); if(impSel) impSel.value = clientFilters.importance;
  const dangerSel = document.getElementById('filterDanger'); if(dangerSel) dangerSel.value = clientFilters.danger;
  const loggedSel = document.getElementById('filterLogged'); if(loggedSel) loggedSel.value = clientFilters.logged;
}

function onClientFilterChange(){
  clientFilters.service = document.getElementById('filterService').value;
  clientFilters.status = document.getElementById('filterStatus').value;
  clientFilters.importance = document.getElementById('filterImportance').value;
  clientFilters.danger = document.getElementById('filterDanger').value;
  clientFilters.logged = document.getElementById('filterLogged').value;
  updateClientFiltersBadge();
  clientsPage = 1;
  renderClientsTable();
}

function updateClientFiltersBadge(){
  const badge = document.getElementById('clientFiltersBadge');
  if(!badge) return;
  const count = ['service','status','importance','danger','logged'].filter(k=>clientFilters[k] && clientFilters[k]!=='all').length;
  badge.textContent = count;
  badge.style.display = count ? 'inline-flex' : 'none';
}

function toggleClientFiltersPopover(){
  const el = document.getElementById('clientFiltersPopover');
  if(!el) return;
  el.style.display = el.style.display==='block' ? 'none' : 'block';
}

document.addEventListener('click', (e)=>{
  const wrap = document.querySelector('.filters-popover-wrap');
  const popover = document.getElementById('clientFiltersPopover');
  if(popover && popover.style.display==='block' && wrap && !wrap.contains(e.target)) popover.style.display = 'none';
});

const SORT_ICON_UP = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6" /></svg>';
const SORT_ICON_DOWN = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg>';

function updateSortArrows(){
  ['name','importance','danger'].forEach(f=>{
    const el = document.getElementById('sortArrow-'+f);
    if(!el) return;
    el.innerHTML = clientSort.field===f ? (clientSort.dir==='asc' ? SORT_ICON_UP : SORT_ICON_DOWN) : '';
  });
}

function clearClientFilters(){
  const searchInput = document.getElementById('clientSearch');
  if(searchInput) searchInput.value = '';
  clientFilters = { search:'', service:'all', status:'all', importance:'all', danger:'all', logged:'all' };
  populateClientFilterSelects();
  updateClientFiltersBadge();
  clientsPage = 1;
  renderClientsTable();
}

function setClientSort(field){
  if(clientSort.field===field) clientSort.dir = clientSort.dir==='asc' ? 'desc' : 'asc';
  else { clientSort.field = field; clientSort.dir = 'asc'; }
  renderClientsTable();
}

function matchesClientFilters(c){
  if(clientFilters.search && !(c.name.toLowerCase().includes(clientFilters.search) || (c.email||'').toLowerCase().includes(clientFilters.search))) return false;
  if(clientFilters.service!=='all' && c.service!==clientFilters.service) return false;
  if(clientFilters.status!=='all' && c.status!==clientFilters.status) return false;
  if(clientFilters.importance==='high' && c.importance<8) return false;
  if(clientFilters.importance==='mid' && (c.importance<4 || c.importance>7)) return false;
  if(clientFilters.importance==='low' && c.importance>3) return false;
  if(clientFilters.danger==='atrisk' && c.danger<4) return false;
  if(clientFilters.danger==='low' && c.danger>3) return false;
  if(clientFilters.logged!=='all'){
    const hasRecentLog = hasLoggedThisWeek(c);
    if(clientFilters.logged==='has' && !hasRecentLog) return false;
    if(clientFilters.logged==='none' && hasRecentLog) return false;
    if(clientFilters.logged==='alltime' && !c.improvements.length) return false;
  }
  return true;
}

// One skeleton row's worth of placeholder shapes, matching the real
// table's actual columns (avatar+name, service, status, importance,
// danger, logged, actions) so the loading state doesn't visually jump
// once real rows replace it.
function clientsSkeletonRowHtml(){
  return `<tr class="skeleton-row">
    <td class="client-bulk-checkbox-cell" style="width:36px;display:none;"></td>
    <td>
      <div style="display:flex;align-items:center;gap:10px;">
        <div class="skeleton-block" style="width:34px;height:34px;border-radius:50%;flex:none;"></div>
        <div style="flex:1;min-width:0;">
          <div class="skeleton-block" style="width:70%;max-width:140px;height:13px;margin-bottom:6px;"></div>
          <div class="skeleton-block" style="width:45%;max-width:100px;height:10px;"></div>
        </div>
      </div>
    </td>
    <td><div class="skeleton-block" style="width:70px;height:12px;"></div></td>
    <td><div class="skeleton-block" style="width:64px;height:20px;border-radius:999px;"></div></td>
    <td><div class="skeleton-block" style="width:36px;height:12px;"></div></td>
    <td><div class="skeleton-block" style="width:36px;height:12px;"></div></td>
    <td><div class="skeleton-block" style="width:64px;height:20px;border-radius:999px;"></div></td>
    <td></td>
  </tr>`;
}

function renderClientsTable(){
  const tbody = document.getElementById('clientsTbody');
  const countEl = document.getElementById('clientsFilterCount');
  updateSortArrows();
  if(!clientsDataLoaded){
    tbody.innerHTML = Array.from({ length: 6 }).map(clientsSkeletonRowHtml).join('');
    if(countEl) countEl.textContent = '';
    const pag = document.getElementById('clientsPagination'); if(pag) pag.innerHTML = '';
    return;
  }
  const ac = activeClients();
  if(!ac.length){
    tbody.innerHTML = `<tr><td colspan="7">${emptyStateHtml(
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 21a8 8 0 0 0-16 0" /> <circle cx="10" cy="8" r="5" /> <path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3" /></svg>',
      'No clients yet',
      canEditClients() ? 'This is where your whole roster lives — add your first client to start tracking their work.' : 'This is where your whole roster lives — ask an admin or approver to add the first client.',
      canEditClients() ? '<button class="btn btn-brand" onclick="openAddClientForm()">+ Add client</button>' : ''
    )}</td></tr>`;
    if(countEl) countEl.textContent = '';
    const pag = document.getElementById('clientsPagination'); if(pag) pag.innerHTML = '';
    return;
  }
  let filtered = ac.filter(matchesClientFilters);
  filtered.sort((a,b)=>{
    let av = a[clientSort.field], bv = b[clientSort.field];
    if(typeof av==='string'){ av = av.toLowerCase(); bv = (bv||'').toLowerCase(); }
    if(av<bv) return clientSort.dir==='asc' ? -1 : 1;
    if(av>bv) return clientSort.dir==='asc' ? 1 : -1;
    return 0;
  });
  if(countEl){
    const isFiltered = clientFilters.search || clientFilters.service!=='all' || clientFilters.status!=='all' || clientFilters.importance!=='all' || clientFilters.danger!=='all' || clientFilters.logged!=='all';
    countEl.textContent = isFiltered ? `${filtered.length} of ${ac.length} shown` : '';
  }
  if(!filtered.length){
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty">Nothing matches these filters — try adjusting or clearing them.</div></td></tr>`;
    renderWhoAmI();
    renderClientsPagination(0);
    return;
  }

  renderClientsPagination(filtered.length);
  const pageStart = (clientsPage-1)*CLIENTS_PAGE_SIZE;
  const pageItems = filtered.slice(pageStart, pageStart+CLIENTS_PAGE_SIZE);

  tbody.innerHTML = pageItems.map(c=>`
    <tr class="client-row${c.id===inspectedClientId ? ' sel' : ''}" data-id="${c.id}" tabindex="0" aria-selected="${c.id===inspectedClientId}"
        onclick="clientRowClick(event,'${c.id}')" ondblclick="openClientDetail('${c.id}')">
      <td class="client-bulk-checkbox-cell" style="border-left:3px solid ${c.danger>=4 ? 'var(--brand)' : 'transparent'};width:36px;display:none;">
        <input type="checkbox" class="client-row-checkbox" value="${c.id}" ${selectedClientIds.has(c.id)?'checked':''} onchange="onClientRowCheck(this)">
      </td>
      <td><div class="client-cell"><div class="avatar-circle" style="background:${avatarColorForName(c.name)};color:#fff;border:none;box-shadow:none;">${escapeHtml(c.name.trim().charAt(0).toUpperCase())}</div><div><div class="cell-name table-name-link" onclick="openClientDetail('${c.id}')">${escapeHtml(c.name)}</div>${c.email?`<div class="cell-email">${escapeHtml(c.email)}</div>`:''}</div></div></td>
      <td><span class="cell-service">${escapeHtml(c.service)}</span></td>
      <td><span class="pill ${statusPillClass(c.status)}">${escapeHtml(c.status)}</span></td>
      <td>${ratingPillCompact(c.importance,'ink',10)}</td>
      <td>${dangerPillCompact(c.danger)}</td>
      <td>${loggedPill(c)}</td>
    </tr>
  `).join('');
  updateSelectAllCheckboxState();
  updateClientsBulkBar();
  renderWhoAmI();
  renderClientInspector();
}


// Used to pause the periodic auto-refresh — a full table re-render while someone
// is typing would wipe out their open drawer and unsaved text.
function isLoggingActive(){
  const active = document.activeElement;
  return !!(active && active.tagName==='TEXTAREA' && active.id && active.id.startsWith('imp-'));
}

// ---------- client panel ----------
// Clicking a client opens its details in a panel on the right, like
// Finder's or Mail's inspector: health, this month's hours, recent work, a
// quick way to log an improvement, and every action that used to sit
// behind the row's ⋯ menu. Double-click (or Enter) opens the full client
// page; ↑/↓ move through the list; Esc closes the panel.
let inspectedClientId = null;

function clientRowClick(event, id){
  if(event.target.closest('input, button, a, label')) return;
  selectClientRow(id);
}

function selectClientRow(id){
  inspectedClientId = id;
  document.querySelectorAll('#clientsTbody tr.client-row').forEach(tr=>{
    const on = tr.dataset.id === id;
    tr.classList.toggle('sel', on);
    tr.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  renderClientInspector();
}

function closeClientInspector(now){
  // Slides back out to the right edge it came from.
  const el = document.getElementById('clientInspector');
  if(!now && el && !el.hidden && typeof animateThen === 'function' && motionOK()){
    if(el.dataset.leaving) return;
    el.dataset.leaving = '1';
    animateThen(el, [{ transform: 'none' }, { transform: 'translateX(100%)' }], 220, 'cubic-bezier(.32,.72,0,1)', () => { closeClientInspector(true); delete el.dataset.leaving; el.getAnimations?.().forEach(a => a.cancel()); });
    return;
  }
  inspectedClientId = null;
  document.querySelectorAll('#clientsTbody tr.client-row.sel').forEach(tr=>{ tr.classList.remove('sel'); tr.setAttribute('aria-selected','false'); });
  renderClientInspector();
}

function renderClientInspector(){
  const el = document.getElementById('clientInspector');
  const wrap = document.getElementById('clientsSplit');
  if(!el) return;
  const c = inspectedClientId ? liveClients().find(x=>x.id===inspectedClientId) : null;
  if(!c){ el.hidden = true; el.innerHTML = ''; wrap?.classList.remove('has-insp'); return; }

  // Keep anything typed into the log field across redraws.
  const prev = document.getElementById('imp-'+c.id);
  const kept = prev ? prev.value : '';
  const wasFocused = prev && document.activeElement === prev;

  const budget = monthBudgetInfo(c);
  const since = c.startDate ? ` · client since ${new Date(c.startDate+'T00:00:00').toLocaleDateString('en-US',{month:'long',year:'numeric'})}` : '';
  const kv = (label, value) => `<div class="cd-kv"><span>${label}</span><b>${value}</b></div>`;
  const recent = [...c.improvements].filter(i=>i.date).sort((a,b)=> new Date(b.date)-new Date(a.date)).slice(0,4);
  let riskHtml = '';
  if((c.danger||0) >= 4){
    const last = todayLastSent(c);
    const days = last ? Math.floor((Date.now() - last) / 86400000) : null;
    const why = [last ? (days === 0 ? 'Update sent today.' : `No update in ${days} day${days===1?'':'s'}.`) : 'No update sent yet.'];
    if(budget && budget.tier === 'over') why.push('Over this month’s hours.');
    riskHtml = `<div class="cd-risk ci-risk" role="note"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" /></svg><div><b>Risk ${c.danger} of 5.</b> ${escapeHtml(why.join(' '))}</div></div>`;
  }
  const action = (label, fn, extra) => `<button type="button" class="ci-act${extra ? ' ' + extra : ''}" onclick="${fn}">${label}</button>`;

  el.hidden = false;
  wrap?.classList.add('has-insp');
  el.innerHTML = `
    <div class="ci-top">
      <span class="cd-mono" aria-hidden="true">${escapeHtml(todayInitials(c.name))}</span>
      <button type="button" class="ci-close" onclick="closeClientInspector()" aria-label="Close panel" title="Close (Esc)"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18" /> <path d="m6 6 12 12" /></svg></button>
    </div>
    <h2 class="ci-name">${escapeHtml(c.name)}</h2>
    <p class="ci-sub">${escapeHtml(c.service||'')}${escapeHtml(since)}</p>
    <div class="ci-btns">
      <button type="button" class="btn btn-brand" onclick="openClientDetail('${c.id}')">Open Client</button>
      ${canEditClients() ? `<button type="button" class="btn btn-outline" onclick="openEditClientForm('${c.id}')">Edit</button>` : ''}
    </div>
    ${riskHtml}
    <div class="ci-sec">Health</div>
    ${kv('Status', `<span class="pill ${statusPillClass(c.status)}">${escapeHtml(c.status)}</span>`)}
    ${kv('Risk', `<span class="${(c.danger||0)>=4 ? 'cd-red' : ''}">${c.danger} of 5</span>`)}
    ${kv('Importance', `${c.importance} of 10`)}
    ${kv('This week', loggedPill(c))}
    ${budget ? `<div class="cd-kv cd-kv-budget"><span>This month</span><b class="${budget.tier==='over'?'cd-red':''}">${(budget.usedMinutes/60).toFixed(1)}h <i>of ${(budget.budgetMinutes/60).toFixed(1)}h</i></b></div>
      <div class="cd-bar"><i style="width:${Math.min(budget.pct,100)}%;background:${budget.tier==='over'?'var(--red)':budget.tier==='warn'?'var(--amber)':'var(--muted-lt)'}"></i></div>` : ''}
    <div class="ci-sec">Log an improvement</div>
    <textarea spellcheck="true" class="ci-log" id="imp-${c.id}" placeholder="What did you do for this client?" aria-label="What did you do for ${escapeHtml(c.name)}?"></textarea>
    <div class="ci-log-row"><span class="ci-who">Logged as ${escapeHtml(myName() || 'you')}</span><button type="button" class="btn btn-outline" onclick="logImprovement('${c.id}')">Log It</button></div>
    <div class="ci-sec">Recent work</div>
    ${recent.length ? recent.map(i=>`<div class="ci-work"><time>${new Date(i.date).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</time><div><span>${escapeHtml(i.text)}</span><i>${escapeHtml(i.author||'')}</i></div></div>`).join('') : '<p class="ci-quiet">Nothing logged yet.</p>'}
    <div class="ci-sec">Actions</div>
    <div class="ci-acts">
      ${action('Track Time', `openTimerModal('${c.id}')`)}
      ${action('New Note', `openNoteModal(null, '${c.id}')`)}
      ${action('New Reminder', `openNewReminderModal('${c.id}')`)}
      ${c.email ? `<a class="ci-act" href="mailto:${escapeHtml(c.email)}">Email ${escapeHtml(c.email)}</a>` : ''}
      ${c.website ? `<a class="ci-act" href="${safeUrl(c.website.startsWith('http') ? c.website : 'https://'+c.website)}" target="_blank" rel="noopener">Open Website</a>` : ''}
      ${hasAccess('delete_clients') ? action('Delete Client…', `deleteClient('${c.id}')`, 'ci-danger') : ''}
    </div>`;
  if(kept){
    const ta = document.getElementById('imp-'+c.id);
    if(ta){ ta.value = kept; if(wasFocused){ ta.focus(); ta.setSelectionRange(kept.length, kept.length); } }
  }
}

// Keyboard: ↑/↓ move through the clients on this page, Enter opens the
// selected one, Esc closes the panel. Ignored while typing anywhere.
document.addEventListener('keydown', function(e){
  if(!document.getElementById('view-clients')?.classList.contains('active')) return;
  if(e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  if(document.querySelector('#appModalOverlay[style*="flex"], .cmdk-overlay[style*="flex"]')) return;
  const rows = [...document.querySelectorAll('#clientsTbody .client-row')];
  if(!rows.length) return;
  const idx = rows.findIndex(r => r.dataset.id === inspectedClientId);
  if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
    e.preventDefault();
    const next = e.key === 'ArrowDown' ? Math.min(rows.length - 1, idx + 1) : Math.max(0, idx < 0 ? 0 : idx - 1);
    const id = rows[next].dataset.id;
    selectClientRow(id);
    document.querySelector(`#clientsTbody .client-row[data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: false });
  } else if(e.key === 'Enter' && inspectedClientId){
    e.preventDefault(); openClientDetail(inspectedClientId);
  } else if(e.key === 'Escape' && inspectedClientId){
    closeClientInspector();
  }
});

let currentTeamActionsMember = null;

function toggleTeamActionsMenu(event, member){
  event.stopPropagation();
  const menu = document.getElementById('teamActionsMenu');
  const wasOpenForThisRow = menu.classList.contains('open') && currentTeamActionsMember?.id === member.id;
  closeTeamActionsMenu();
  if(wasOpenForThisRow) return;

  currentTeamActionsMember = { id: member.id, name: member.name, revoked: !!member.access_revoked };
  const accessItem = document.getElementById('teamActionsMenuAccessToggle');
  if(accessItem){
    const labelSpan = accessItem.querySelector('.dropdown-item-label');
    if(labelSpan) labelSpan.textContent = currentTeamActionsMember.revoked ? 'Restore access' : 'Revoke access';
    accessItem.classList.toggle('danger', !currentTeamActionsMember.revoked);
  }

  const rect = event.currentTarget.getBoundingClientRect();
  menu.style.top = (rect.bottom + 4) + 'px';
  menu.style.left = 'auto';
  menu.style.right = (window.innerWidth - rect.right) + 'px';
  const menuHeightEstimate = 140;
  if(rect.bottom + menuHeightEstimate > window.innerHeight){
    menu.style.top = (rect.top - menuHeightEstimate - 4) + 'px';
  }
  menu.classList.add('open');
}
function closeTeamActionsMenu(){
  document.getElementById('teamActionsMenu')?.classList.remove('open');
  currentTeamActionsMember = null;
}
document.addEventListener('click', function(e){
  if(!e.target.closest('#teamActionsMenu')) closeTeamActionsMenu();
});

async function deleteClient(id){
  if(!hasAccess('delete_clients')){ showToast('error','Not allowed','Only admins and approvers can delete clients.'); return; }
  const c = clients.find(x=>x.id===id);
  if(!c) return;
  if(!(await confirmDialog(`Move ${c.name} to Trash? Their improvements, drafts, time entries, and notes stay intact and this can be undone from Trash.`, {confirmLabel:'Move to Trash'}))) return;
  await loadAll();
  const stillThere = clients.find(x=>x.id===id);
  if(!stillThere){ showToast('info','Already gone', `${c.name} was already removed.`); renderAll(); return; }
  const deletedAt = new Date().toISOString();
  // one added from Harvest and never set up stays out: Harvest won't add it again
  const cfv = clientInSetup(stillThere) ? Object.assign({}, stillThere.customFieldValues, { harvestSetup: 'skipped' }) : null;
  const ok = await updateClientRow(id, cfv ? { deletedAt, customFieldValues: cfv } : { deletedAt });
  if(ok){ stillThere.deletedAt = deletedAt; if(cfv) stillThere.customFieldValues = cfv; }
  log.unshift({t:nowTime(), tag:'you', userId:currentUser?.id, text:`Moved client <b>${escapeHtml(c.name)}</b> to Trash.`});
  if(ok) await persistLog();
  renderAll();
  if(ok) logClientActivity(id, 'client_deleted', `${myName()||'Someone'} moved this client (${c.name}) to Trash.`);
  ok ? showToast('success','Moved to Trash', `${c.name} can be restored from Trash.`) : showToast('error','Delete failed','Could not save — try again.');
}

// True permanent deletion — only reachable from the Trash panel, on a client
// that's already been soft-deleted. This is the only place data actually
// gets destroyed rather than hidden.
async function permanentlyDeleteClient(id){
  if(!hasPermission('delete_clients')){ showToast('error','Not allowed','You don\'t have permission to permanently delete clients.'); return; }
  const c = clients.find(x=>x.id===id);
  if(!c) return;
  if(!(await confirmDialog(`Permanently delete ${c.name}? This cannot be undone — all improvements, drafts, and history for this client will be gone for good.`, {confirmLabel:'Delete permanently', destructive:true}))) return;
  await loadAll();
  // A real DELETE now — client_improvements rows are removed automatically
  // via ON DELETE CASCADE (schema-clients-migration.sql). This also now
  // actually deletes the client's notes from the notes table itself,
  // rather than only hiding them from the local array — previously
  // permanentlyDeleteClient() left those notes rows orphaned in Supabase
  // (client_id pointing at a client that no longer existed anywhere else).
  const { error: delErr } = await supabaseClient.from('clients').delete().eq('id', id);
  const ok = !delErr;
  if(ok){
    await supabaseClient.from('notes').delete().eq('client_id', id);
    clients = clients.filter(x=>x.id!==id);
    clientImprovements = clientImprovements.filter(i=>i.clientId!==id);
    notes = notes.filter(n=>n.clientId!==id);
  }
  renderAll();
  renderTrash();
  ok ? showToast('success','Permanently deleted', `${c.name} is gone for good.`) : showToast('error','Delete failed','Could not save — try again.');
}

async function restoreClient(id){
  if(!hasPermission('delete_clients')){ showToast('error','Not allowed','You don\'t have permission to manage deleted clients.'); return; }
  await loadAll();
  const c = clients.find(x=>x.id===id);
  if(!c) return;
  // one added from Harvest and left out comes back to finish its setup
  const cfv = c.customFieldValues && c.customFieldValues.harvestSetup === 'skipped' ? Object.assign({}, c.customFieldValues, { harvestSetup: 'needed' }) : null;
  const ok = await updateClientRow(id, cfv ? { deletedAt: null, customFieldValues: cfv } : { deletedAt: null });
  if(ok){ delete c.deletedAt; if(cfv) c.customFieldValues = cfv; }
  renderAll();
  renderTrash();
  ok ? showToast('success','Client restored', `${c.name} is back on the roster.`) : showToast('error','Restore failed','Could not save — try again.');
}
