// Recently Deleted, as on the canvas: one page with a section per kind (clients, your notes,
// your time entries), Restore beside each item and a bin to delete it for good.
// Restoring and deleting use the functions in clients.js, notes.js, time-tracker.js and trash.js.

let trashTab = 'all', trashData = { notes: [], time: [] };
function switchTrashTab(name){ trashTab = name; drawTrash(); }

async function renderTrash(){
  const root = document.getElementById('trashRoot');
  if(!root) return;
  const [notesList, timeList] = await Promise.all([loadMyTrashedNotes(), loadMyTrashedTimeEntries()]);
  trashData = { notes: notesList || [], time: timeList || [] };
  selectedTrashIds = { clients: new Set(), notes: new Set(), time: new Set() };
  drawTrash();
}
function trashDay(d){ return d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''; }
function trashRow(ic, title, sub, restore, del){
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
  const seg = `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center"><div class="seg" role="tablist" aria-label="Type">${tabs.map(([k, t, n]) => `<button class="${trashTab === k ? 'on' : ''}" role="tab" aria-selected="${trashTab === k}" onclick="switchTrashTab('${k}')">${t}${n ? ` <span class="c">${n}</span>` : ''}</button>`).join('')}</div></div>`;
  const head = (type, title, extra) => {
    return `<div class="h2"><h2>${title}<span class="c">${counts[type]}</span></h2>${extra || ''}</div>`;
  };
  const show = t => trashTab === 'all' || trashTab === t;
  let html = '';
  if(canClients && show('clients') && (cl.length || trashTab === 'clients')){
    html += head('clients', 'Clients') + `<div class="grp">${cl.map(c => {
      const imps = (c.improvements || []).length, te = timeEntries.filter(e => e.clientId === c.id).length;
      const extra = [imps ? `${imps} improvement${imps === 1 ? '' : 's'}` : '', te ? `${te} time entr${te === 1 ? 'y' : 'ies'}` : ''].filter(Boolean).join(' and ');
      return trashRow('buildings', c.name, `Deleted ${trashDay(c.deletedAt)}${extra ? ` · with its ${extra}` : ''}`, `restoreClient('${c.id}')`, `permanentlyDeleteClient('${c.id}')`);
    }).join('') || '<div class="row"><span class="t-2" style="font-size:14px">No deleted clients.</span></div>'}</div>`;
  }
  if(show('notes') && (nt.length || trashTab === 'notes')){
    html += head('notes', 'Notes', `<span class="t-2" style="font-size:13px;display:inline-flex;align-items:center;gap:4px"><span class="ic sm">${icon('lock-simple')}</span>Only you can see your deleted notes</span>`) + `<div class="grp">${nt.map(n => {
      const c = clients.find(x => x.id === n.clientId);
      return trashRow('notepad', n.title || 'Untitled note', `${escapeHtml(c ? c.name : 'No client')} · deleted ${trashDay(n.deletedAt)}`, `restoreNote('${n.id}')`, `permanentlyDeleteNote('${n.id}')`);
    }).join('') || '<div class="row"><span class="t-2" style="font-size:14px">No deleted notes.</span></div>'}</div>`;
  }
  if(show('time') && (tm.length || trashTab === 'time')){
    html += head('time', 'Time entries') + `<div class="grp">${tm.map(e => {
      const c = clients.find(x => x.id === e.clientId);
      return trashRow('timer', `${e.description || e.service || 'Time'} · ${hmm(e.minutes)}`, `${escapeHtml(c ? c.name : 'Client removed')} · deleted ${trashDay(e.deletedAt)}`, `restoreTimeEntry('${e.id}')`, `permanentlyDeleteTimeEntry('${e.id}')`);
    }).join('') || '<div class="row"><span class="t-2" style="font-size:14px">No deleted time entries.</span></div>'}</div>`;
  }
  if(!html) html = `<div class="empty"><b>Nothing deleted</b>Clients, notes and time entries you delete wait here, so you can bring them back.</div>`;
  root.innerHTML = `${seg}<div style="max-width:860px">${html}</div>`;
}
