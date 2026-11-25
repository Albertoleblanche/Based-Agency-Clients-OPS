// Paused clients and "Still a client?" (Nov 25)
// A Paused client isn't working with us right now. All Clients keeps it out of the main table and lists
// it under See Paused Clients; This Week, Health and the reminders already leave it out. Nothing is
// deleted: its work and history stay, and Make Active brings it back.
// Radar asks the people who edit clients "Still a client?" about one that has gone quiet (no time,
// improvements, tasks or sent updates in 60 days, and nothing open) or that Harvest archived while work
// was still open (lib/harvest-sync.js pauses it by itself when nothing was). Pause moves it to the
// paused clients; Keep Active stops the question for 60 days.
// In custom_field_values: pausedAt and pausedBy (a name, 'harvest' or 'sheet') while Paused,
// statusAsk { why: 'harvest', at, work } from the Harvest sync, and statusKeptAt / statusKeptBy.

const STILL_DAYS = 60;
let clientsPausedOpen = false;
function setClientsPaused(on){
  clientsPausedOpen = !!on; clBulk = null; inspectedClientId = null;
  renderClientsTable();
  const sp = document.querySelector('#clientsRoot .sp-page'); if(sp) sp.scrollTop = 0;
  document.querySelector(on ? '#clientsRoot .cl-back' : '#clientsRoot .cl-pz')?.focus({ preventScroll: true });
}
function isPausedClient(c){ return !!(c && c.status === 'Paused'); }

// The custom values to save with a new status: when it was paused and by whom, kept while it stays
// paused; a question about it ends when its status changes; one made active again isn't asked about
// for 60 days.
function clientStatusCfv(c, status, by){
  const v = Object.assign({}, (c && c.customFieldValues) || {}), was = c ? c.status : '';
  if(status === 'Paused'){
    if(was !== 'Paused' || !v.pausedAt){ v.pausedAt = new Date().toISOString(); v.pausedBy = by || ''; }
  } else { delete v.pausedAt; delete v.pausedBy; }
  if(status !== was || status === 'Paused') delete v.statusAsk;
  if(was === 'Paused' && status && status !== 'Paused'){ v.statusKeptAt = new Date().toISOString(); v.statusKeptBy = by || ''; }
  return v;
}

// The last day anything happened for each client (time, improvements, tasks, sent updates), and the
// clients with something still open (a task, a follow-up, a sprint, a draft). One pass over each list.
function clientWorkIndex(){
  const last = new Map(), open = new Set(), now = rNow().getTime();
  const bump = (id, d) => { const x = d instanceof Date ? d.getTime() : Date.parse(d); if(!id || !x || isNaN(x)) return; const y = Math.min(x, now); if(!(last.get(id) >= y)) last.set(id, y); };
  (typeof clients !== 'undefined' ? clients : []).forEach(c => {
    (c.improvements || []).forEach(i => { if(!i.deletedAt) bump(c.id, i.date); });
    (c.drafts || []).forEach(d => { if(d.draftStatus === 'pending' || d.draftStatus === 'approved') open.add(c.id); });
    if(typeof lastSentAt === 'function'){ const s = lastSentAt(c); if(s) bump(c.id, s); }
  });
  (typeof timeEntries !== 'undefined' ? timeEntries : []).forEach(e => { if(e.clientId && e.date) bump(e.clientId, e.date + 'T12:00:00'); });
  (typeof tasks !== 'undefined' ? tasks : []).forEach(t => {
    if(!t.clientId) return;
    bump(t.clientId, t.completedAt || t.createdAt);
    if(t.status !== 'done' && !t.cancelledAt) open.add(t.clientId);
  });
  (typeof clientReminders !== 'undefined' ? clientReminders : []).forEach(r => { if(r.clientId && r.status === 'waiting') open.add(r.clientId); });
  const today = toDateStr(rNow());
  (typeof planSprints !== 'undefined' ? planSprints : []).forEach(s => { if(s.clientId && !s.doneAt && s.end >= today) open.add(s.clientId); });
  return { last, open };
}
function clientLastWork(c, idx){
  const t = (idx || clientWorkIndex()).last.get(c.id);
  return t ? new Date(t) : null;
}
function clientDataReady(){
  return (typeof clientsDataLoaded === 'undefined' || clientsDataLoaded)
    && (typeof timeEntriesDataLoaded === 'undefined' || timeEntriesDataLoaded)
    && (typeof tasksDataLoaded === 'undefined' || tasksDataLoaded);
}
// { why: 'harvest', at, work } or { why: 'quiet', last }, or null. Only for the people who edit clients.
function clientStatusAsk(c, idx){
  if(!c || c.deletedAt || isPausedClient(c) || clientInSetup(c) || typeof canEditClients !== 'function' || !canEditClients()) return null;
  const v = c.customFieldValues || {};
  if(v.statusAsk && v.statusAsk.why === 'harvest'){
    const at = v.statusAsk.at ? new Date(v.statusAsk.at) : null;
    return { why: 'harvest', at: at && !isNaN(at) ? at : null, work: [].concat(v.statusAsk.work || []).filter(Boolean) };
  }
  if(c.status === 'Onboarding' || !getsUpdates(c) || !clientDataReady()) return null;
  const since = addDays(rNow(), -STILL_DAYS);
  const kept = v.statusKeptAt ? new Date(v.statusKeptAt) : null;
  if(kept && !isNaN(kept) && kept > since) return null;
  const start = clientStartedAt(c);
  if(!start || start > since) return null;   // a new client, still settling in
  idx = idx || clientWorkIndex();
  if(idx.open.has(c.id)) return null;
  const last = clientLastWork(c, idx);
  if(last && last > since) return null;
  return { why: 'quiet', last };
}
function askClients(){
  if(typeof canEditClients !== 'function' || !canEditClients()) return [];
  const idx = clientWorkIndex();
  return activeClients().filter(c => clientStatusAsk(c, idx));
}

// ---- words ---------------------------------------------------------------------------------------
function joinWords(list){ return list.length <= 1 ? (list[0] || '') : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1]; }
function clientAskTitle(a){
  if(a.why === 'harvest') return 'Archived in Harvest';
  if(!a.last) return 'No work logged yet';
  return `No work in ${daysBetween(a.last, rNow())} days`;
}
function clientAskWhy(a){
  if(a.why === 'harvest') return `Harvest archived it${a.at ? ' ' + fmtShortDate(a.at) : ''}${a.work.length ? `, but it still has ${joinWords(a.work)}` : ''}.`;
  return a.last ? `Nothing logged since ${fmtShortDate(a.last)}, and nothing open.` : `Nothing logged in Radar, and nothing open.`;
}
function pausedByWords(c){
  const by = (c.customFieldValues || {}).pausedBy || '';
  return by === 'sheet' ? 'From the client sheet' : by === 'harvest' ? 'Archived in Harvest' : by ? `By ${firstName(by)}` : '';
}
function pausedAtDate(c){
  const at = (c.customFieldValues || {}).pausedAt ? new Date(c.customFieldValues.pausedAt) : null;
  return at && !isNaN(at) ? at : null;
}
function pausedSinceWords(c){ const at = pausedAtDate(c); return at ? `Paused since ${fmtShortDate(at)}` : 'Paused'; }

// ---- All Clients: the paused clients' table and the "Still clients?" rows --------------------------
function clRowAttrs(c, extra){
  const sel = c.id === inspectedClientId, bulk = !!clBulk, picked = !!(clBulk && clBulk.has(c.id));
  return `class="cl-r client-row ${extra}${sel ? ' is-sel' : ''}${picked ? ' is-picked' : ''}" data-id="${c.id}" role="row" tabindex="0" aria-selected="${bulk ? picked : sel}" onclick="${bulk ? `clBulkToggle('${c.id}')` : `clientRowClick(event,'${c.id}')`}" ${bulk ? `onkeydown="clBulkKey(event,'${c.id}')"` : `ondblclick="openClientDetail('${c.id}')"`}`;
}
function pausedRowHtml(c, idx, uw){
  const owner = clientOwner(c), at = pausedAtDate(c), by = pausedByWords(c), last = clientLastWork(c, idx);
  const A = jsArg(c.id);
  const act = canEditClients() && !clBulk ? `<button class="btn sm cl-mk" onclick="makeClientActive(${A})" aria-label="Make ${escapeHtml(c.name)} active">${icon('play')}Make Active</button>` : '';
  return `<div ${clRowAttrs(c, 'cl-pzr')}>
<span class="cl-c" role="cell">${clBulkCk(c)}<span class="cl-tx"><b>${escapeHtml(c.name)}</b>${uw ? '' : `<span class="cl-s">${escapeHtml(c.service || '—')}</span>`}</span></span>
${uw ? `<span class="cl-sv" role="cell">${escapeHtml(c.service || '—')}</span>` : ''}
<span class="cl-o" role="cell">${owner ? escapeHtml(uw ? firstName(owner) : owner) : '<span class="t-3">—</span>'}</span>
<span class="cl-w" role="cell"><span class="cl-wk">${at ? fmtShortDate(at) : '<span class="t-3">Before Nov 25</span>'}</span>${by ? `<span class="cl-s">${escapeHtml(by)}</span>` : ''}</span>
<span class="cl-w" role="cell"><span class="cl-wk">${last ? fmtShortDate(last) : '<span class="t-3">Nothing logged</span>'}</span>${last ? `<span class="cl-s">${escapeHtml(agoWords(last))}</span>` : ''}</span>
${uw ? '' : '<span class="cl-l" role="cell"></span>'}<span class="cl-pza" role="cell">${act}</span></div>`;
}
function agoWords(d){
  const n = daysBetween(d, rNow());
  if(n <= 0) return 'Today';
  if(n === 1) return 'Yesterday';
  if(n < 14) return `${n} days ago`;
  if(n < 60) return `${Math.round(n / 7)} weeks ago`;
  const m = Math.round(n / 30.4);
  return m < 12 ? `${m} months ago` : `Over a year ago`;
}
function askRowHtml(c, idx, uw){
  const a = clientStatusAsk(c, idx), owner = clientOwner(c), A = jsArg(c.id);
  const acts = clBulk ? '' : `<button class="btn sm" onclick="stillClientKeep(${A})">Keep Active</button><button class="btn sm" onclick="stillClientPause(${A})">${icon('pause')}Pause</button>`;
  return `<div ${clRowAttrs(c, 'cl-askr')}>
<span class="cl-c" role="cell">${clBulkCk(c)}<span class="cl-tx"><b>${escapeHtml(c.name)}${typeof focusMark === 'function' ? focusMark(c) : ''}</b>${uw ? '' : `<span class="cl-s">${escapeHtml(c.service || '—')}</span>`}</span></span>
${uw ? `<span class="cl-sv" role="cell">${escapeHtml(c.service || '—')}</span>` : ''}
<span class="cl-o" role="cell">${owner ? escapeHtml(uw ? firstName(owner) : owner) : '<span class="t-3">—</span>'}</span>
<span class="cl-w cl-q" role="cell"><span class="cl-wk is-ask">${escapeHtml(clientAskTitle(a))}</span><span class="cl-s">${escapeHtml(clientAskWhy(a))}</span></span>
<span class="cl-qa" role="cell">${acts}</span></div>`;
}
const CL_ASK_TIP = 'Radar asks when a client has gone quiet (no time, improvements, tasks or updates in 60 days, and nothing open) or when Harvest archived it while work was still open.\n\nPause moves it to the paused clients: it leaves This Week, Health and the reminders, and nothing is deleted. Keep Active stops the question for 60 days.';
const CL_PZ_TIP = 'Clients that aren’t working with us right now. They’re off This Week, Health and the reminders, and nothing about them is deleted: their work and history stay. Make Active brings one back.';
// The table in paused mode: the same filters, the paused clients only.
function pausedTableBody(list, uw){
  const idx = clientWorkIndex();
  if(!list.length) return `<div class="cl-empty">${clientFilters.search || clientsOwnerFilter !== 'all' || clientFilters.service !== 'all'
    ? `No paused clients match.<a class="x-lnk" href="#" onclick="clearClientsCanvasFilters();return false;">Clear Filters</a>`
    : `No paused clients.<a class="x-lnk" href="#" onclick="setClientsPaused(false);return false;">Back to Active Clients</a>`}</div>`;
  // the new look has the title and its (i) above the table; the classic one, a group heading
  return `${uw ? '' : `<div class="cl-g" role="presentation"><b>Paused</b><span>${list.length}</span>${infoTip(CL_PZ_TIP, 'What does Paused mean?')}</div>`}${list.map(c => pausedRowHtml(c, idx, uw)).join('')}`;
}
function pausedHeadHtml(uw){
  return uw ? `<div class="cl-head" role="row"><span role="columnheader">Client</span><span role="columnheader">Service</span><span role="columnheader">Owner</span><span role="columnheader">Paused</span><span role="columnheader">Last work</span><span role="columnheader"></span></div>`
    : `<div class="cl-head" role="row"><span role="columnheader">Client</span><span role="columnheader">Owner</span><span role="columnheader">Paused</span><span role="columnheader">Last work</span><span role="columnheader"></span><span role="columnheader"></span></div>`;
}

// ---- the panel and the client page ---------------------------------------------------------------
// What the panel's status block says for a paused client, or one Radar is asking about.
function clientStatusPanel(c){
  const A = jsArg(c.id), edit = canEditClients();
  if(isPausedClient(c)){
    const by = pausedByWords(c);
    return { eyebrow: `<span class="sp-eb">${icon('pause', { weight: 'bold' })}Paused</span>`, title: pausedSinceWords(c),
      sub: `${by ? escapeHtml(by) + '. ' : ''}It’s off This Week, Health and the reminders. Its work and history stay here.`,
      acts: edit ? `<button class="btn btn-p" onclick="makeClientActive(${A})">${icon('play')}Make Active</button>` : '' };
  }
  const a = clientStatusAsk(c);
  if(!a) return null;
  return { eyebrow: `<span class="sp-eb warn"><i class="eb-dot"></i>Still a client?</span>`, title: clientAskTitle(a),
    sub: `${escapeHtml(clientAskWhy(a))} Pause it if they’ve stopped working with us.`,
    acts: `<button class="btn" onclick="stillClientKeep(${A})">Keep Active</button><button class="btn btn-p" onclick="stillClientPause(${A})">${icon('pause')}Pause</button>` };
}
function clientStatusCalloutHtml(c){
  const s = clientStatusPanel(c);
  if(!s) return '';
  const paused = isPausedClient(c), a = paused ? null : clientStatusAsk(c);
  return `<div class="next st-next${paused ? ' is-pz' : ''}"><span class="sig ${paused ? 'n' : 'y'}">${icon(paused ? 'pause' : 'circle-help')}</span>
<div class="tx"><b>${escapeHtml(paused ? s.title : `Still a client? ${clientAskTitle(a)}`)}</b><span>${s.sub}</span></div>${s.acts}</div>`;
}

// ---- the actions (here and on the phone, js/mobile/app.js) --------------------------------------------
function noteClientActivity(id, text){
  if(!text) return;
  if(typeof logClientActivity === 'function'){ logClientActivity(id, 'client_updated', text); return; }
  if(typeof supabaseClient !== 'undefined' && currentUser) supabaseClient.from('activity_log').insert({ client_id: id, user_id: currentUser.id, action_type: 'client_updated', description: text }).then(() => {}, () => {});
}
function clientStatusRedraw(){
  if(typeof renderAll === 'function') renderAll();
  if(typeof renderClientPage === 'function') renderClientPage();
  if(typeof mTop === 'function'){ const t = mTop(); if(t && t.refresh) t.refresh(); }
}
async function setClientStatusQuick(id, status, o){
  o = o || {};
  if(!canEditClients()){ showToast('error', 'Not allowed', 'Only admins, approvers and people given Add and Edit Clients can change a client’s status.'); return null; }
  const c = clients.find(x => x.id === id); if(!c) return null;
  const before = { status: c.status, customFieldValues: Object.assign({}, c.customFieldValues || {}) };
  const cfv = clientStatusCfv(c, status, myName() || '');
  if(o.keep){ delete cfv.statusAsk; cfv.statusKeptAt = new Date().toISOString(); cfv.statusKeptBy = myName() || ''; }
  const ok = await updateClientRow(id, { status, customFieldValues: cfv });
  if(!ok){ showToast('error', 'Couldn’t save', 'Try again in a moment.'); return null; }
  Object.assign(c, { status, customFieldValues: cfv });
  noteClientActivity(id, o.log);
  clientStatusRedraw();
  return before;
}
async function undoClientStatus(id, before, log){
  const c = clients.find(x => x.id === id); if(!c || !before) return;
  const ok = await updateClientRow(id, before);
  if(!ok){ showToast('error', 'Couldn’t undo', 'Try again in a moment.'); return; }
  Object.assign(c, before);
  noteClientActivity(id, log);
  clientStatusRedraw();
}
async function stillClientPause(id){
  const c = clients.find(x => x.id === id); if(!c) return;
  const me = myName() || 'Someone';
  const before = await setClientStatusQuick(id, 'Paused', { log: `${me} paused ${c.name}: not working with us right now.` });
  if(before) showToast('success', `${c.name} is paused`, 'It’s under See Paused Clients now. Nothing was deleted.', { action: 'Undo', onAction: () => undoClientStatus(id, before, `${me} undid pausing ${c.name}.`) });
}
async function stillClientKeep(id){
  const c = clients.find(x => x.id === id); if(!c) return;
  const me = myName() || 'Someone';
  const before = await setClientStatusQuick(id, c.status, { keep: true, log: `${me} kept ${c.name} active: still a client.` });
  if(before) showToast('success', `${c.name} stays active`, `Radar won’t ask about it again for ${STILL_DAYS} days.`, { action: 'Undo', onAction: () => undoClientStatus(id, before) });
}
async function makeClientActive(id){
  const c = clients.find(x => x.id === id); if(!c) return;
  const me = myName() || 'Someone';
  const before = await setClientStatusQuick(id, 'Active', { log: `${me} made ${c.name} active again.` });
  if(before) showToast('success', `${c.name} is active again`, 'It’s back in This Week, Health and the reminders.', { action: 'Undo', onAction: () => undoClientStatus(id, before, `${me} undid making ${c.name} active.`) });
}
