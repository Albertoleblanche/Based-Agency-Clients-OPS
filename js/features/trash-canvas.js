// Recently Deleted, as on the canvas: one page with a section per kind (clients, your notes,
// your time entries), Restore beside each item and a bin to delete it for good.
// Select (Nov 20) ticks several at once, then Restore them or Delete them for Good together.
// One at a time uses the functions in clients.js, notes.js and time-tracker.js.

let trashTab = 'all', trashData = { notes: [], time: [] };
let trSel = null;   // while selecting: the ticked items as "type:id", otherwise null
function switchTrashTab(name){ trashTab = name; drawTrash(); }

async function renderTrash(){
  const root = document.getElementById('trashRoot');
  if(!root) return;
  const [notesList, timeList] = await Promise.all([loadMyTrashedNotes(), loadMyTrashedTimeEntries()]);
  trashData = { notes: notesList || [], time: timeList || [] };
  selectedTrashIds = { clients: new Set(), notes: new Set(), time: new Set() };
  drawTrash();
}

// ---- several at once ------------------------------------------------------------------------
function trSelStart(){ trSel = new Set(); drawTrash(); }
function trSelEnd(){ trSel = null; drawTrash(); }
function trToggle(k){
  if(!trSel) return;
  trSel.has(k) ? trSel.delete(k) : trSel.add(k);
  drawTrash();
  document.querySelector(`#trashRoot .tr-pick[data-k="${CSS.escape(k)}"]`)?.focus({ preventScroll: true });
}
function trRowKey(e, k){ if(trSel && (e.key === ' ' || e.key === 'Enter')){ e.preventDefault(); trToggle(k); } }
// Select All ticks everything showing (the tab decides what shows); Clear unticks it all
function trSetAll(on){
  if(!trSel) return;
  if(on) document.querySelectorAll('#trashRoot .tr-pick').forEach(r => trSel.add(r.dataset.k)); else trSel.clear();
  drawTrash();
}
function trPicked(){
  const by = { clients: [], notes: [], time: [] };
  (trSel ? [...trSel] : []).forEach(k => { const i = k.indexOf(':'); by[k.slice(0, i)]?.push(k.slice(i + 1)); });
  return by;
}
// "2 clients, 3 notes and 1 time entry"
function trWords(by){
  const p = [[by.clients.length, 'client', 'clients'], [by.notes.length, 'note', 'notes'], [by.time.length, 'time entry', 'time entries']]
    .filter(([n]) => n).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
  return p.length > 1 ? p.slice(0, -1).join(', ') + ' and ' + p[p.length - 1] : (p[0] || '');
}
function trBulkBarHtml(){
  if(!trSel) return '';
  const n = trSel.size;
  return `<div class="cl-bulk tr-bulk" role="toolbar" aria-label="Several at once"><span class="cl-bk-n">${n ? `<b>${n}</b> selected` : 'Tick what to restore or delete'}</span>
${n ? `<button class="lnk-b" onclick="trSetAll(false)">Clear</button>` : ''}<button class="lnk-b" onclick="trSetAll(true)">Select All${trashTab === 'all' ? '' : ' Showing'}</button>
<span class="cl-sp"></span><button class="btn" onclick="trSelEnd()">Cancel</button>
<button class="btn" ${n ? '' : 'disabled'} onclick="trBulkRestore()">Restore${n ? ' ' + n : ''}</button>
<button class="btn danger" ${n ? '' : 'disabled'} onclick="trBulkDelete()">${icon('trash')}Delete${n ? ' ' + n : ''} for Good</button></div>`;
}
async function trBulkRestore(){
  const by = trPicked(), words = trWords(by);
  if(!words) return;
  if(by.clients.length && !hasPermission('delete_clients')){ showToast('error', 'Not allowed', 'You don’t have permission to manage deleted clients.'); return; }
  const fails = [];
  if(by.clients.length){
    const res = await Promise.all(by.clients.map(id => {
      const c = clients.find(x => x.id === id); if(!c) return true;
      // one added from Harvest and left out comes back to finish its setup, as restoreClient() does
      const cfv = c.customFieldValues && c.customFieldValues.harvestSetup === 'skipped' ? Object.assign({}, c.customFieldValues, { harvestSetup: 'needed' }) : null;
      return updateClientRow(id, cfv ? { deletedAt: null, customFieldValues: cfv } : { deletedAt: null }).then(ok => { if(ok){ delete c.deletedAt; if(cfv) c.customFieldValues = cfv; } return ok; });
    }));
    if(res.some(ok => !ok)) fails.push('clients');
  }
  if(by.notes.length){
    const { error } = await supabaseClient.from('notes').update({ deleted_at: null }).in('id', by.notes).eq('user_id', currentUser.id);
    if(error) fails.push('notes');
    await loadMyNotes();
    if(typeof populateNotesClientFilter === 'function') populateNotesClientFilter();
    if(typeof renderNotes === 'function') renderNotes();
  }
  if(by.time.length){
    const { error } = await supabaseClient.from('time_entries').update({ deleted_at: null }).in('id', by.time);
    if(error) fails.push('time entries');
    await loadTimeEntries();
    if(typeof renderTimesheet === 'function') renderTimesheet();
    if(typeof renderReports === 'function') renderReports();
  }
  trSel = null;
  if(by.clients.length) renderAll();
  await renderTrash();
  fails.length ? showToast('error', 'Some didn’t restore', `The ${fails.join(' and ')} couldn’t be restored. Try again.`)
    : showToast('success', 'Restored', `${trWords(by)} ${by.clients.length + by.notes.length + by.time.length === 1 ? 'is' : 'are'} back.`);
}
async function trBulkDelete(){
  const by = trPicked(), words = trWords(by);
  if(!words) return;
  if(by.clients.length && !hasPermission('delete_clients')){ showToast('error', 'Not allowed', 'You don’t have permission to delete clients for good.'); return; }
  const also = by.clients.length ? ` The client${by.clients.length === 1 ? '’s' : 's’'} improvements and notes go with ${by.clients.length === 1 ? 'it' : 'them'}.` : '';
  if(!(await confirmDialog(`Delete ${words} for good? This can’t be undone.${also}`, { confirmLabel: 'Delete for Good', destructive: true }))) return;
  const fails = [];
  if(by.clients.length){
    // improvements go with the client (ON DELETE CASCADE); notes are removed here, as permanentlyDeleteClient() does
    const { error } = await supabaseClient.from('clients').delete().in('id', by.clients);
    if(error) fails.push('clients');
    else {
      await supabaseClient.from('notes').delete().in('client_id', by.clients);
      clients = clients.filter(c => !by.clients.includes(c.id));
      clientImprovements = clientImprovements.filter(i => !by.clients.includes(i.clientId));
      notes = notes.filter(n => !by.clients.includes(n.clientId));
    }
  }
  if(by.notes.length){
    const { error } = await supabaseClient.from('notes').delete().in('id', by.notes).eq('user_id', currentUser.id);
    if(error) fails.push('notes');
    else {
      await supabaseClient.from('calendar_events').delete().in('related_note_id', by.notes);   // their follow-ups on the calendar
      if(typeof loadCalendarEvents === 'function'){ await loadCalendarEvents(); if(typeof renderCalendar === 'function') renderCalendar(); }
    }
  }
  if(by.time.length){
    const { error } = await supabaseClient.from('time_entries').delete().in('id', by.time);
    if(error) fails.push('time entries');
  }
  trSel = null;
  if(by.clients.length) renderAll();
  await renderTrash();
  fails.length ? showToast('error', 'Some weren’t deleted', `The ${fails.join(' and ')} couldn’t be deleted. Try again.`)
    : showToast('success', 'Deleted for good', `${trWords(by)} ${by.clients.length + by.notes.length + by.time.length === 1 ? 'is' : 'are'} gone.`);
}
document.addEventListener('keydown', e => {
  if(e.key !== 'Escape' || !trSel || !document.getElementById('view-trash')?.classList.contains('active')) return;
  if(document.querySelector('#appModalOverlay[style*="flex"]') || document.getElementById('confirmDialogOkBtn')) return;
  trSelEnd();
});
function trashDay(d){ return d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''; }
function trashRow(ic, title, sub, restore, del, k){
  if(trSel){   // selecting: the whole row ticks
    const on = trSel.has(k);
    return `<div class="row tr-pick${on ? ' on' : ''}" data-k="${k}" role="checkbox" aria-checked="${on}" tabindex="0" onclick="trToggle('${k}')" onkeydown="trRowKey(event, '${k}')">
<span class="ck${on ? ' on' : ''}" aria-hidden="true">${on ? icon('check', { weight: 'bold' }) : ''}</span><span class="ic">${icon(ic)}</span><div class="tx"><span class="t">${escapeHtml(title)}</span><span class="s">${sub}</span></div></div>`;
  }
  return `<div class="row"><span class="ic">${icon(ic)}</span><div class="tx"><span class="t">${escapeHtml(title)}</span><span class="s">${sub}</span></div>
<div class="r"><button class="btn sm" onclick="${restore}">Restore</button><button class="ib" aria-label="Delete for good" title="Delete for good" onclick="${del}">${icon('trash')}</button></div></div>`;
}
function drawTrash(){
  const root = document.getElementById('trashRoot');
  if(!root) return;
  const canClients = hasPermission('delete_clients');
  const cl = canClients ? clients.filter(c => c.deletedAt).sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt)) : [];
  const nt = trashData.notes, tm = trashData.time;
  const counts = { clients: cl.length, notes: nt.length, time: tm.length };
  const total = cl.length + nt.length + tm.length;
  const tabs = [['all', 'All', total], ...(canClients ? [['clients', 'Clients', cl.length]] : []), ['notes', 'Notes', nt.length], ['time', 'Time Entries', tm.length]];
  if(!tabs.some(([k]) => k === trashTab)) trashTab = 'all';
  if(trSel && !total) trSel = null;
  const pick = total && !trSel ? `<span class="cl-sp"></span><button class="btn tr-sel-btn" onclick="trSelStart()">${icon('list-checks')}Select</button>` : '';
  const seg = `<div class="tr-top"><div class="seg" role="tablist" aria-label="Type">${tabs.map(([k, t, n]) => `<button class="${trashTab === k ? 'on' : ''}" role="tab" aria-selected="${trashTab === k}" onclick="switchTrashTab('${k}')">${t}${n ? ` <span class="c">${n}</span>` : ''}</button>`).join('')}</div>${pick}</div>`;
  const head = (type, title, extra) => {
    return `<div class="h2"><h2>${title}<span class="c">${counts[type]}</span></h2>${extra || ''}</div>`;
  };
  const show = t => trashTab === 'all' || trashTab === t;
  let html = '';
  if(canClients && show('clients') && (cl.length || trashTab === 'clients')){
    html += head('clients', 'Clients') + `<div class="grp">${cl.map(c => {
      const imps = (c.improvements || []).length, te = timeEntries.filter(e => e.clientId === c.id).length;
      const extra = [imps ? `${imps} improvement${imps === 1 ? '' : 's'}` : '', te ? `${te} time entr${te === 1 ? 'y' : 'ies'}` : ''].filter(Boolean).join(' and ');
      return trashRow('buildings', c.name, `Deleted ${trashDay(c.deletedAt)}${extra ? ` · with its ${extra}` : ''}`, `restoreClient('${c.id}')`, `permanentlyDeleteClient('${c.id}')`, 'clients:' + c.id);
    }).join('') || '<div class="row"><span class="t-2" style="font-size:14px">No deleted clients.</span></div>'}</div>`;
  }
  if(show('notes') && (nt.length || trashTab === 'notes')){
    html += head('notes', 'Notes', `<span class="t-2" style="font-size:13px;display:inline-flex;align-items:center;gap:4px"><span class="ic sm">${icon('lock-simple')}</span>Only you can see your deleted notes</span>`) + `<div class="grp">${nt.map(n => {
      const c = clients.find(x => x.id === n.clientId);
      return trashRow('notepad', n.title || 'Untitled note', `${escapeHtml(c ? c.name : 'No client')} · deleted ${trashDay(n.deletedAt)}`, `restoreNote('${n.id}')`, `permanentlyDeleteNote('${n.id}')`, 'notes:' + n.id);
    }).join('') || '<div class="row"><span class="t-2" style="font-size:14px">No deleted notes.</span></div>'}</div>`;
  }
  if(show('time') && (tm.length || trashTab === 'time')){
    html += head('time', 'Time entries') + `<div class="grp">${tm.map(e => {
      const c = clients.find(x => x.id === e.clientId);
      return trashRow('timer', `${e.description || e.service || 'Time'} · ${hmm(e.minutes)}`, `${escapeHtml(c ? c.name : 'Client removed')} · deleted ${trashDay(e.deletedAt)}`, `restoreTimeEntry('${e.id}')`, `permanentlyDeleteTimeEntry('${e.id}')`, 'time:' + e.id);
    }).join('') || '<div class="row"><span class="t-2" style="font-size:14px">No deleted time entries.</span></div>'}</div>`;
  }
  if(!html) html = emptyState({ icon: 'trash', title: 'Nothing deleted', text: 'Clients, notes and time entries you delete wait here, so you can bring them back.' });
  root.classList.toggle('tr-selecting', !!trSel);
  root.innerHTML = `${seg}<div class="tr-list">${html}</div>${trBulkBarHtml()}`;
  // switching tabs while selecting keeps only what still shows, so nothing hidden is restored or deleted
  if(trSel){
    const shown = new Set([...root.querySelectorAll('.tr-pick')].map(r => r.dataset.k));
    const before = trSel.size; [...trSel].forEach(k => { if(!shown.has(k)) trSel.delete(k); });
    if(trSel.size !== before) root.querySelector('.tr-bulk').outerHTML = trBulkBarHtml();
  }
}
