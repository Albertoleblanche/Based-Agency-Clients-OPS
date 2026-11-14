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
  if(!canApprove()){ showToast('error','Not allowed','Only admins and approvers can delete clients.'); return; }
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

const SORT_ICON_UP = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>';
const SORT_ICON_DOWN = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>';

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
    tbody.innerHTML = `<tr><td colspan="8">${emptyStateHtml(
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
      'No clients yet',
      canApprove() ? 'This is where your whole roster lives — add your first client to start tracking their work.' : 'This is where your whole roster lives — ask an admin or approver to add the first client.',
      canApprove() ? '<button class="btn btn-brand" onclick="openAddClientForm()">+ Add client</button>' : ''
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
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty">Nothing matches these filters — try adjusting or clearing them.</div></td></tr>`;
    renderWhoAmI();
    renderClientsPagination(0);
    return;
  }

  renderClientsPagination(filtered.length);
  const pageStart = (clientsPage-1)*CLIENTS_PAGE_SIZE;
  const pageItems = filtered.slice(pageStart, pageStart+CLIENTS_PAGE_SIZE);

  tbody.innerHTML = pageItems.map(c=>`
    <tr>
      <td class="client-bulk-checkbox-cell" style="border-left:3px solid ${c.danger>=4 ? 'var(--brand)' : 'transparent'};width:36px;display:none;">
        <input type="checkbox" class="client-row-checkbox" value="${c.id}" ${selectedClientIds.has(c.id)?'checked':''} onchange="onClientRowCheck(this)">
      </td>
      <td><div class="client-cell"><div class="avatar-circle" style="background:${avatarColorForName(c.name)};color:#fff;border:none;box-shadow:none;">${escapeHtml(c.name.trim().charAt(0).toUpperCase())}</div><div><div class="cell-name table-name-link" onclick="openClientDetail('${c.id}')">${escapeHtml(c.name)}</div>${c.email?`<div class="cell-email">${escapeHtml(c.email)}</div>`:''}</div></div></td>
      <td><span class="cell-service">${escapeHtml(c.service)}</span></td>
      <td><span class="pill ${statusPillClass(c.status)}">${escapeHtml(c.status)}</span></td>
      <td>${ratingPillCompact(c.importance,'ink',10)}</td>
      <td>${dangerPillCompact(c.danger)}</td>
      <td>${loggedPill(c)}</td>
      <td class="actions-cell">
        <button class="icon-menu-btn" onclick="toggleActionsMenu(event, '${c.id}')" title="Actions">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>
        </button>
      </td>
    </tr>
    <tr class="drawer-row" id="drawer-${c.id}" style="display:none;">
      <td colspan="8">
        ${c.improvements.length ? miniImprovementsHtml(c) : ''}
        <div class="log-inline" style="margin-top:8px;">
          <textarea spellcheck="true" placeholder="What did you improve for this client this week?" id="imp-${c.id}"></textarea>
          <button class="btn btn-brand" onclick="logImprovement('${c.id}')">Log it</button>
          <button class="btn btn-outline" onclick="toggleDrawer('${c.id}')">Cancel</button>
        </div>
        <div class="who-am-i" style="font-size:11px;color:var(--muted-lt);margin-top:6px;"></div>
      </td>
    </tr>
  `).join('');
  updateSelectAllCheckboxState();
  updateClientsBulkBar();
  renderWhoAmI();
}

function toggleDrawer(id){
  const row = document.getElementById('drawer-'+id);
  row.style.display = row.style.display==='none' ? 'table-row' : 'none';
}

// Used to pause the periodic auto-refresh — a full table re-render while someone
// is typing would wipe out their open drawer and unsaved text.
function isLoggingActive(){
  const active = document.activeElement;
  return !!(active && active.tagName==='TEXTAREA' && active.id && active.id.startsWith('imp-'));
}

let currentActionsMenuClientId = null;

function toggleActionsMenu(event, id){
  event.stopPropagation();
  const menu = document.getElementById('clientActionsMenu');
  const wasOpenForThisRow = menu.classList.contains('open') && currentActionsMenuClientId === id;
  closeActionsMenus();
  if(wasOpenForThisRow) return;

  currentActionsMenuClientId = id;
  const editItem = document.getElementById('clientActionsMenuEdit');
  if(editItem) editItem.style.display = canApprove() ? '' : 'none';
  const deleteItem = document.getElementById('clientActionsMenuDelete');
  if(deleteItem) deleteItem.style.display = canApprove() ? '' : 'none';

  // Position relative to the viewport (not any ancestor), so it's
  // completely unaffected by the table's own scroll/overflow clipping —
  // this is what actually fixes the last-row-gets-cut-off issue, not a
  // z-index or overflow tweak on the table itself.
  const rect = event.currentTarget.getBoundingClientRect();
  menu.style.top = (rect.bottom + 4) + 'px';
  menu.style.left = 'auto';
  menu.style.right = (window.innerWidth - rect.right) + 'px';
  // Flip above the button instead, if there isn't enough room below.
  const menuHeightEstimate = 210;
  if(rect.bottom + menuHeightEstimate > window.innerHeight){
    menu.style.top = (rect.top - menuHeightEstimate - 4) + 'px';
  }
  menu.classList.add('open');
}
function closeActionsMenus(){
  document.getElementById('clientActionsMenu')?.classList.remove('open');
  currentActionsMenuClientId = null;
}
document.addEventListener('click', function(e){
  if(!e.target.closest('#clientActionsMenu')) closeActionsMenus();
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
  if(!canApprove()){ showToast('error','Not allowed','Only admins and approvers can delete clients.'); return; }
  const c = clients.find(x=>x.id===id);
  if(!c) return;
  if(!(await confirmDialog(`Move ${c.name} to Trash? Their improvements, drafts, time entries, and notes stay intact and this can be undone from Trash.`, {confirmLabel:'Move to Trash'}))) return;
  await loadAll();
  const stillThere = clients.find(x=>x.id===id);
  if(!stillThere){ showToast('info','Already gone', `${c.name} was already removed.`); renderAll(); return; }
  const deletedAt = new Date().toISOString();
  const ok = await updateClientRow(id, { deletedAt });
  if(ok) stillThere.deletedAt = deletedAt;
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
  const ok = await updateClientRow(id, { deletedAt: null });
  if(ok) delete c.deletedAt;
  renderAll();
  renderTrash();
  ok ? showToast('success','Client restored', `${c.name} is back on the roster.`) : showToast('error','Restore failed','Could not save — try again.');
}
