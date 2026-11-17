// Trash: restore or permanently delete clients, notes and time entries.

function trashRowHtml(id, type, title, subtitle, deletedAt, restoreFn, deleteFn){
  const when = deletedAt ? new Date(deletedAt).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '';
  return `<div class="integ-row">
    <input type="checkbox" class="trash-row-checkbox" data-type="${type}" value="${id}" onchange="onTrashRowCheck(this)" style="margin-right:12px;flex:none;">
    <div style="flex:1;min-width:0;"><div class="integ-name">${escapeHtml(title)}</div>${subtitle ? `<div class="integ-desc">${escapeHtml(subtitle)}</div>` : ''}${when ? `<div class="integ-desc" style="color:var(--muted-lt);">Deleted ${when}</div>` : ''}</div>
    <div style="display:flex;gap:14px;flex:none;">
      <span class="row-link" onclick="${restoreFn}">Restore</span>
      <span class="row-link danger-link" onclick="${deleteFn}">Delete permanently</span>
    </div>
  </div>`;
}

async function renderTrash(){
  const clientsEl = document.getElementById('trashClientsList');
  const notesEl = document.getElementById('trashNotesList');
  const timeEl = document.getElementById('trashTimeList');
  if(!clientsEl && !notesEl && !timeEl) return;

  if(clientsEl){
    const trashedClients = clients.filter(c=>c.deletedAt).sort((a,b)=> new Date(b.deletedAt)-new Date(a.deletedAt));
    clientsEl.innerHTML = trashedClients.length ? trashBulkBarHtml('clients') + trashedClients.map(c=>
      trashRowHtml(c.id, 'clients', c.name, c.service, c.deletedAt, `restoreClient('${c.id}')`, `permanentlyDeleteClient('${c.id}')`)
    ).join('') : `<div class="empty" style="padding:14px 0;">Nothing here — deleted items show up in this list.</div>`;
  }

  if(notesEl){
    notesEl.innerHTML = `<div class="empty" style="padding:14px 0;"><span class="spinner"></span>Loading…</div>`;
    const trashedNotes = await loadMyTrashedNotes();
    notesEl.innerHTML = trashedNotes.length ? trashBulkBarHtml('notes') + trashedNotes.map(n=>{
      const c = clients.find(x=>x.id===n.clientId);
      return trashRowHtml(n.id, 'notes', n.title || 'Untitled note', c ? c.name : 'Unknown client', n.deletedAt, `restoreNote('${n.id}')`, `permanentlyDeleteNote('${n.id}')`);
    }).join('') : `<div class="empty" style="padding:14px 0;">Nothing here — deleted items show up in this list.</div>`;
  }

  if(timeEl){
    timeEl.innerHTML = `<div class="empty" style="padding:14px 0;"><span class="spinner"></span>Loading…</div>`;
    const trashedTime = await loadMyTrashedTimeEntries();
    timeEl.innerHTML = trashedTime.length ? trashBulkBarHtml('time') + trashedTime.map(e=>{
      const c = clients.find(x=>x.id===e.clientId);
      return trashRowHtml(e.id, 'time', `${c?c.name:'Unknown client'} — ${formatMinutes(e.minutes)}`, e.description || e.service || '', e.deletedAt, `restoreTimeEntry('${e.id}')`, `permanentlyDeleteTimeEntry('${e.id}')`);
    }).join('') : `<div class="empty" style="padding:14px 0;">Nothing here — deleted items show up in this list.</div>`;
  }
  selectedTrashIds = { clients:new Set(), notes:new Set(), time:new Set() };
}

const TRASH_TYPE_LABEL = { clients:'client', notes:'note', time:'time entry' };
let selectedTrashIds = { clients:new Set(), notes:new Set(), time:new Set() };

function trashBulkBarHtml(type){
  return `<div class="integ-row" style="padding-top:0;padding-bottom:10px;">
    <label style="display:flex;align-items:center;gap:10px;font-size:13px;color:var(--muted);font-weight:600;cursor:pointer;">
      <input type="checkbox" id="trashSelectAll-${type}" onchange="toggleAllTrashSelection('${type}', this.checked)">
      Select all
    </label>
  </div>
  <div class="bulk-actions-bar" id="trashBulkBar-${type}" style="display:none;">
    <span id="trashBulkCount-${type}"></span>
    <span class="row-link" onclick="clearTrashSelection('${type}')">Clear selection</span>
    <div style="flex:1;"></div>
    <button class="btn btn-outline" onclick="bulkRestoreTrash('${type}')">Restore selected</button>
    <button class="btn btn-outline" style="color:var(--red);border-color:var(--red-bg);" onclick="bulkDeleteTrashPermanently('${type}')">Delete selected permanently</button>
  </div>`;
}

function toggleAllTrashSelection(type, checked){
  document.querySelectorAll(`.trash-row-checkbox[data-type="${type}"]`).forEach(cb=>{
    cb.checked = checked;
    if(checked) selectedTrashIds[type].add(cb.value); else selectedTrashIds[type].delete(cb.value);
  });
  updateTrashBulkBar(type);
}

function onTrashRowCheck(checkboxEl){
  const type = checkboxEl.dataset.type;
  if(checkboxEl.checked) selectedTrashIds[type].add(checkboxEl.value);
  else selectedTrashIds[type].delete(checkboxEl.value);
  updateTrashBulkBar(type);
  const boxes = [...document.querySelectorAll(`.trash-row-checkbox[data-type="${type}"]`)];
  const selectAll = document.getElementById('trashSelectAll-'+type);
  if(selectAll) selectAll.checked = boxes.length>0 && boxes.every(cb=>cb.checked);
}

function clearTrashSelection(type){
  selectedTrashIds[type].clear();
  document.querySelectorAll(`.trash-row-checkbox[data-type="${type}"]`).forEach(cb=>cb.checked=false);
  const selectAll = document.getElementById('trashSelectAll-'+type);
  if(selectAll) selectAll.checked = false;
  updateTrashBulkBar(type);
}

function updateTrashBulkBar(type){
  const bar = document.getElementById('trashBulkBar-'+type);
  const countEl = document.getElementById('trashBulkCount-'+type);
  if(!bar) return;
  const n = selectedTrashIds[type].size;
  bar.style.display = n ? 'flex' : 'none';
  const label = TRASH_TYPE_LABEL[type];
  if(countEl) countEl.textContent = `${n} ${label}${n!==1?'s':''} selected`;
}

async function bulkRestoreTrash(type){
  const ids = [...selectedTrashIds[type]];
  if(!ids.length) return;
  const label = TRASH_TYPE_LABEL[type];

  if(type==='clients'){
    if(!hasPermission('delete_clients')){ showToast('error','Not allowed','You don\'t have permission to manage deleted clients.'); return; }
    await loadAll();
    const { error } = await supabaseClient.from('clients').update({ deleted_at: null }).in('id', ids);
    const ok = !error;
    let restored = 0;
    if(ok) ids.forEach(id=>{
      const c = clients.find(x=>x.id===id);
      if(c && c.deletedAt){ delete c.deletedAt; restored++; }
    });
    renderAll(); await renderTrash();
    ok ? showToast('success','Restored', `${restored} client${restored!==1?'s':''} back on the roster.`) : showToast('error','Restore failed','Could not save — try again.');
    return;
  }

  const table = type==='notes' ? 'notes' : 'time_entries';
  const { error } = await supabaseClient.from(table).update({ deleted_at: null }).in('id', ids);
  if(type==='notes'){ await loadMyNotes(); populateNotesClientFilter(); renderNotes(); }
  else { await loadTimeEntries(); renderTimesheet(); renderReports(); }
  await renderTrash();
  error ? showToast('error','Restore failed', error.message) : showToast('success','Restored', `${ids.length} ${label}${ids.length!==1?'s':''} restored.`);
}

async function bulkDeleteTrashPermanently(type){
  const ids = [...selectedTrashIds[type]];
  if(!ids.length) return;
  const label = TRASH_TYPE_LABEL[type];
  if(!(await confirmDialog(`Permanently delete ${ids.length} ${label}${ids.length!==1?'s':''}? This can't be undone.`, {confirmLabel:'Delete permanently', destructive:true}))) return;

  if(type==='clients'){
    if(!hasPermission('delete_clients')){ showToast('error','Not allowed','You don\'t have permission to manage deleted clients.'); return; }
    await loadAll();
    // client_improvements cascade-deletes automatically; notes doesn't have
    // a real FK (see schema-clients-migration.sql), so cleaned up by hand
    // here too, same reasoning as permanentlyDeleteClient() above.
    const { error: delErr } = await supabaseClient.from('clients').delete().in('id', ids);
    const ok = !delErr;
    if(ok){
      await supabaseClient.from('notes').delete().in('client_id', ids);
      clients = clients.filter(c=> !ids.includes(c.id));
      clientImprovements = clientImprovements.filter(i=> !ids.includes(i.clientId));
      notes = notes.filter(n=> !ids.includes(n.clientId));
    }
    renderAll(); await renderTrash();
    ok ? showToast('success','Permanently deleted', `${ids.length} client${ids.length!==1?'s':''} gone for good.`) : showToast('error','Delete failed','Could not save — try again.');
    return;
  }

  const table = type==='notes' ? 'notes' : 'time_entries';
  const { error } = await supabaseClient.from(table).delete().in('id', ids);
  if(type==='time') { await loadTimeEntries(); renderTimesheet(); renderReports(); }
  await renderTrash();
  error ? showToast('error','Delete failed', error.message) : showToast('success','Permanently deleted', `${ids.length} ${label}${ids.length!==1?'s':''} gone for good.`);
}
