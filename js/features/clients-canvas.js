// All Clients, as on the canvas board "All Clients — improved": two groups (Needs attention,
// then On track), every cell in words with the reason underneath only when something is wrong,
// owners as full names, hours against the budget. Clicking a client opens the same right-hand
// panel as This Week, Health and Tasks; double-click (or Enter) opens the full client page.

let clientsSeg = 'all', clientsOwnerFilter = 'all', clientsMine = true;
function setClientsSeg(k){ clientsSeg = k; renderClientsTable(); }
// Someone with areas of work opens on their clients (work-areas.js); All clients shows the rest.
// Show: My clients / All clients. One switch for All Clients, Health, the Dashboard's health card and
// the Health badge (myClientsOn, week-health.js), so they always count the same clients.
function setClientsMine(v){
  clientsMine = v === 'mine';
  renderClientsTable();
  if(typeof renderHealth === 'function') renderHealth();
  if(typeof renderDashboard === 'function' && currentViewName === 'dashboard') renderDashboard();
  if(typeof updateShellBadges === 'function') updateShellBadges();
}
function setClientsOwner(v){ clientsOwnerFilter = v; renderClientsTable(); }
function setClientsService(v){ clientFilters.service = v; renderClientsTable(); }
function setClientsFind(v){
  clientFilters.search = String(v || '').toLowerCase(); renderClientsTable();
  const el = document.getElementById('clientsFind'); if(el){ el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
}
// The panel opens and closes with the table (the shared panel motion slides it in and out).
function clearClientsCanvasFilters(){ clientsSeg = 'all'; clientsOwnerFilter = 'all'; clientFilters.service = 'all'; clientFilters.search = ''; const f = document.querySelector('#clientsRoot input[type="search"]'); if(f) f.value = ''; renderClientsTable(); }
function selectClientRow(id){ if(clBulk) return; inspectedClientId = id; renderClientsTable(); }

// ---- Bulk edit: pick clients, then set their status, importance, risk or hours a month at once ----
let clBulk = null; // the picked client ids while picking, otherwise null
const CL_TIPS = {
  match: 'Radar adds a client from Harvest when no Radar client has the same name, so the same client can end up twice under two names.\n\nThis lists each one Radar added and lets you pick the Radar client it really is. Radar keeps your client, gives it Harvest’s projects and time, and removes the copy. Pick “New client” when it really is new.',
  hist: 'The last 8 weekly updates, oldest on the left. A dot went out on time, a short yellow bar went out late, a tall red bar was missed, and an empty circle isn’t due yet.',
};
function clBulkMenu(e){
  e.stopPropagation();
  const had = document.getElementById('clMenu'); had?.remove(); if(had) return;
  const m = document.createElement('div');
  m.className = 'menu cl-bmenu'; m.id = 'clMenu'; m.setAttribute('role', 'menu'); Object.assign(m.style, { position: 'fixed', zIndex: '1200' });
  const r = e.currentTarget.getBoundingClientRect();
  m.style.top = (r.bottom + 4) + 'px'; m.style.right = (window.innerWidth - r.right) + 'px';
  const canMatch = typeof openMatchClientsSheet === 'function' && setupClients().length;
  m.innerHTML = `<button class="mi" role="menuitem" onclick="clBulkStart()">${icon('list-checks')}<span><b>Edit Several Clients…</b><small>Tick clients, then set their owner, status, importance, risk, hours or weekly update at once.</small></span></button>`
    + (canMatch ? `<button class="mi" role="menuitem" onclick="openMatchClientsSheet()">${icon('git-merge')}<span><b>Match to Existing Clients…</b><small>Clients added from Harvest that you already have under another name: merge them into yours.</small></span></button>` : '');
  document.body.appendChild(m);
  setTimeout(() => document.addEventListener('click', () => m.remove(), { once: true }), 0);
}
document.addEventListener('keydown', e => { if(e.key === 'Escape' && clBulk && !document.querySelector('#appModalOverlay[style*="flex"]') && document.getElementById('view-clients')?.classList.contains('active')) clBulkEnd(); });
function clBulkStart(){
  if(!canEditClients()) return; clBulk = new Set(); inspectedClientId = null; renderClientsTable();
  if(window._lastInput === 'key' || typeof motionOK !== 'function' || !motionOK()) return;
  const bar = document.querySelector('#clientsRoot .cl-bulk');
  bar?.animate?.([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.23,1,.32,1)' });
  document.querySelectorAll('#clientsTbody .cl-ck').forEach(ck => ck.animate?.([{ opacity: 0, transform: 'scale(.8)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'cubic-bezier(.23,1,.32,1)' }));
}
function clBulkEnd(){ clBulk = null; renderClientsTable(); }
// Bulk Edit with these clients ticked and the sheet open: This Week's "Set Owners" for the clients
// with no owner yet (Nov 22). The list shows every client so each ticked one is in view.
function clBulkEditClients(ids){
  if(!canEditClients() || !ids || !ids.length) return;
  clientsSeg = 'all'; clientsOwnerFilter = 'all'; clientsMine = false; clientFilters.search = '';
  if(currentViewName !== 'clients') switchView('clients');
  clBulk = new Set(ids.filter(id => clients.some(c => c.id === id))); inspectedClientId = null; renderClientsTable();
  openClientsBulkSheet();
  setTimeout(() => document.getElementById('bkOwner')?.focus(), 40);
}
function clBulkToggle(id){
  if(!clBulk) return;
  if(clBulk.has(id)) clBulk.delete(id); else clBulk.add(id);
  renderClientsTable();
  document.querySelector(`#clientsTbody .client-row[data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
}
// Select All ticks every client showing (the filters decide which); Clear unticks them all
function clBulkSetAll(on){
  if(!clBulk) return;
  if(on) [...document.querySelectorAll('#clientsTbody .client-row')].forEach(r => clBulk.add(r.dataset.id)); else clBulk.clear();
  renderClientsTable();
}
// Space or Enter ticks the row you're on while picking
function clBulkKey(e, id){ if(clBulk && (e.key === ' ' || e.key === 'Enter')){ e.preventDefault(); e.stopPropagation(); clBulkToggle(id); } }
function clBulkCk(c){
  const on = !!(clBulk && clBulk.has(c.id));
  return clBulk ? `<span class="ck cl-ck${on ? ' on' : ''}" aria-hidden="true">${on ? icon('check', { weight: 'bold' }) : ''}</span>` : '';
}
// The bar at the foot while picking: how many, Select All or Clear, Cancel and Edit.
function clBulkBarHtml(){
  if(!clBulk) return '';
  const n = clBulk.size;
  return `<div class="cl-bulk" role="toolbar" aria-label="Edit several clients"><span class="cl-bk-n">${n ? `<b>${n}</b> selected` : 'Tick the clients to change'}</span>
${n ? `<button class="lnk-b" onclick="clBulkSetAll(false)">Clear</button>` : ''}<button class="lnk-b" onclick="clBulkSetAll(true)">Select All Showing</button>
<span class="cl-sp"></span><button class="btn" onclick="clBulkEnd()">Cancel</button><button class="btn btn-p" ${n ? '' : 'disabled'} onclick="openClientsBulkSheet()">Edit ${n || ''} Client${n === 1 ? '' : 's'}…</button></div>`;
}
// The sheet: every field starts on "Keep as is", so only what you change changes.
function openClientsBulkSheet(){
  if(!clBulk || !clBulk.size || !canEditClients()) return;
  const picked = clients.filter(c => clBulk.has(c.id)), n = picked.length;
  const names = picked.slice(0, 3).map(c => c.name).join(', ') + (n > 3 ? ` and ${n - 3} more` : '');
  const keep = [['', 'Keep as is']];
  const people = (typeof teamProfiles !== 'undefined' ? teamProfiles : []).filter(p => p.name && !p.access_revoked).map(p => p.name).sort();
  openAppModal(`<h3>Edit ${n} Client${n === 1 ? '' : 's'}</h3>
<p class="t-2 bk-sub">${escapeHtml(names)}. Only what you change here changes; everything else stays as each client has it.</p>
<div class="f bk-f">
<label for="bkOwner">Owner</label><div>${sheetPop('bkOwner', 'Owner', keep.concat([['@auto', 'Automatic']], people.map(p => [p, p])), '')}</div>
<label for="bkStatus">Status</label><div>${sheetPop('bkStatus', 'Status', keep.concat((settings.statusOptions || []).map(s => [s, s])), '')}</div>
<label for="bkImportance">Importance${infoTip('How much this client matters to the agency, from 1 to 10. At 8 or more, a client on Watch counts as At risk, and it comes first when two updates are due the same day.', 'What does Importance do?')}</label><div>${sheetPop('bkImportance', 'Importance', keep.concat(Array.from({ length: 10 }, (_, i) => [String(i + 1), `${i + 1} of 10`])), '')}</div>
<label for="bkDanger">Risk${infoTip('Your read on how likely the client is to leave, from 1 (low) to 5 (high). At 3 Health puts the client on Watch; at 4 or 5, At risk. Radar notes who set it.', 'What does Risk do?')}</label><div>${sheetPop('bkDanger', 'Risk', keep.concat([['1', '1 · Low'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5 · High']]), '', 'bkDangerChanged()')}</div>
<label for="bkDangerWhy" id="bkDangerWhyL" hidden>Why</label><div id="bkDangerWhyW" hidden><input id="bkDangerWhy" class="tf" maxlength="500" placeholder="What makes them risky, in a line" autocomplete="off"><div class="t-2" style="font-size:12.5px;margin-top:4px">Health shows it beside the Risk, with who set it.</div></div>
<label for="bkHours">Hours a month</label><div class="bk-h"><input type="number" id="bkHours" class="tf" min="0" step="0.5" placeholder="Keep as is"><span class="t-2">0 removes it</span></div>
<label for="bkFocus">Focus${infoTip('For clients the owner asked the team to give extra attention. Focus clients come first in every list, Health watches them closer, and the morning reminders and the Monday summary put them on top.', 'What does Focus do?')}</label><div>${sheetPop('bkFocus', 'Focus', keep.concat([['on', 'Add to Focus'], ['off', 'Take off Focus']]), '')}</div>
<label for="bkWeekly">Weekly update${infoTip('No weekly update is for the agency itself or an internal client: nothing is ever due, so it stays off This Week, Today, the Queue and Health. Work and hours are still logged.', 'What does Weekly update do?')}</label><div>${sheetPop('bkWeekly', 'Weekly update', keep.concat([['on', 'Every week'], ['off', 'No weekly update']]), '')}</div>
</div>
<div class="sheet-a"><button class="btn" onclick="closeAppModal()">Cancel</button><button class="btn btn-p" id="bkSave" onclick="saveClientsBulk()">Save to ${n} Client${n === 1 ? '' : 's'}</button></div>`, 520);
}
function bkDangerChanged(){
  const v = Number(document.getElementById('bkDanger')?.value || 0);
  ['bkDangerWhyL', 'bkDangerWhyW'].forEach(id => { const el = document.getElementById(id); if(el) el.hidden = !(v >= 3); });
}
async function saveClientsBulk(){
  if(!clBulk || !canEditClients()) return;
  const v = id => (document.getElementById(id) || {}).value || '';
  const fields = {}, words = [];
  if(v('bkStatus')){ fields.status = v('bkStatus'); words.push(`status to ${fields.status}`); }
  if(v('bkImportance')){ fields.importance = Number(v('bkImportance')); words.push(`importance to ${fields.importance}`); }
  if(v('bkDanger')){ fields.danger = Number(v('bkDanger')); words.push(`risk to ${fields.danger}`); }
  // raising anyone to 3 or more says why (Nov 25)
  const riskWhy = v('bkDangerWhy').trim();
  if(fields.danger >= 3 && !riskWhy && clients.some(c => clBulk.has(c.id) && riskNeedsReason(fields.danger, c.danger))){
    showToast('error', 'Say why', `Risk ${fields.danger} shows on Health with the reason. One line is enough.`); document.getElementById('bkDangerWhy')?.focus(); return; }
  const hrs = v('bkHours').trim();
  if(hrs !== ''){ const h = Math.max(0, Number(hrs) || 0); fields.monthlyHourBudget = h || null; words.push(h ? `hours a month to ${h}` : 'no monthly hours'); }
  // owner and weekly update live in each client's own custom values, so they're merged per client
  const cf = {};
  if(v('bkOwner')){ cf.owner = v('bkOwner') === '@auto' ? null : v('bkOwner'); words.unshift(cf.owner ? `owner to ${cf.owner}` : 'owner to automatic'); }
  if(v('bkWeekly')){ cf.weeklyUpdate = v('bkWeekly') === 'off' ? 'off' : null; words.push(cf.weeklyUpdate ? 'no weekly update' : 'a weekly update'); }
  if(v('bkFocus')){ const on = v('bkFocus') === 'on'; Object.assign(cf, on ? { focus: true, focusAt: new Date().toISOString(), focusBy: myName() || '' } : { focus: null, focusAt: null, focusBy: null }); words.push(on ? 'Focus on' : 'Focus off'); }
  if(!words.length){ showToast('info', 'Nothing to change yet', 'Pick a new value for at least one field.'); return; }
  const btn = document.getElementById('bkSave'); if(btn){ btn.disabled = true; btn.textContent = 'Saving…'; }
  const picked = clients.filter(c => clBulk.has(c.id)), wasPaused = picked.map(c => c.status === 'Paused');
  let kept = 0;
  const results = await Promise.all(picked.map(async c => {
    const mine = Object.assign({}, fields);
    // lowering a Risk takes an admin (or the permission), as in Edit Client and the sheet import
    if(mine.danger !== undefined && mine.danger < (c.danger || 0) && typeof canLowerDangerScore === 'function' && !canLowerDangerScore()){ delete mine.danger; kept++; }
    const riskWas = c.danger;
    if(Object.keys(cf).length){
      const cfv = Object.assign({}, c.customFieldValues || {});
      const wasFocus = !!cfv.focus;   // one already on Focus keeps when, and by whom
      Object.entries(cf).forEach(([k, x]) => { if(x == null) delete cfv[k]; else if(!((k === 'focusAt' || k === 'focusBy') && wasFocus)) cfv[k] = x; });
      mine.customFieldValues = cfv;
    }
    if(mine.status !== undefined && typeof clientStatusCfv === 'function') mine.customFieldValues = clientStatusCfv({ status: c.status, customFieldValues: mine.customFieldValues || c.customFieldValues }, mine.status, myName() || '');
    const ok = await updateClientRow(c.id, mine);
    if(ok && mine.danger !== undefined && mine.danger !== riskWas && typeof logDangerHistory === 'function') logDangerHistory(c.id, mine.danger, riskWas, riskWhy);
    if(ok){ Object.assign(c, mine); if(typeof logClientActivity === 'function') logClientActivity(c.id, 'client_updated', `${myName() || 'Someone'} set ${words.join(', ')}${picked.length > 1 ? ` for ${picked.length} clients at once` : ''}.`); }
    return ok;
  }));
  const done = results.filter(Boolean).length, failed = results.length - done;
  // paused: the rest of the team hears it, in one notification (client-status.js)
  if(fields.status === 'Paused' && typeof notifyClientsPaused === 'function') notifyClientsPaused(picked.filter((c, i) => results[i] && wasPaused[i] === false));
  closeAppModal();
  if(failed){ picked.forEach((c, i) => { if(results[i]) clBulk.delete(c.id); }); showToast('error', `${failed} client${failed === 1 ? '' : 's'} didn’t save`, `${done} updated. The rest are still ticked: try Edit again.`); renderAll(); return; }
  showToast('success', `Updated ${done} client${done === 1 ? '' : 's'}`, `Set ${words.join(', ')}.${kept ? ` Risk stayed on ${kept}: lowering it takes an approver or admin.` : ''}`);
  clBulk = null; renderAll();
}

function closeClientInspector(){ inspectedClientId = null; renderClientsTable(); }
// ---- Focus (Nov 23): approvers switch it on a client; everyone sees the mark (js/core/data.js) ----
function focusSinceWords(c){
  const v = c.customFieldValues || {}, at = v.focusAt ? new Date(v.focusAt) : null;
  return `Since ${at && !isNaN(at) ? fmtShortDate(at) : 'before Nov 23'}${v.focusBy ? `, by ${firstName(v.focusBy)}` : ''}`;
}
function focusToggleHtml(c){
  const on = isFocus(c), tip = escapeHtml(FOCUS_WORDS);
  if(!canEditClients()) return on ? `<span class="fo-tg on is-ro" tabindex="0" data-hovertip="${tip}">${icon('target')}Focus</span>` : '';
  return `<button class="fo-tg${on ? ' on' : ''}" aria-pressed="${on}" aria-label="${on ? 'Focus client: click to take it off Focus' : 'Add to Focus'}" data-hovertip="${tip}" onclick="setClientFocus('${c.id}', ${!on})">${icon('target')}Focus</button>`;
}
// Details → Focus: what it is, on or off, and the switch for admins and approvers.
function focusDetailsHtml(c){
  const on = isFocus(c), A = jsArg(c.id);
  const state = on ? `<b class="fo-on">${icon('target')}On</b><span class="t-3">${escapeHtml(focusSinceWords(c))}</span>` : '<span class="t-3">Off</span>';
  const sw = canEditClients() && typeof swHtml === 'function' ? swHtml(on, 'Focus client', `setClientFocus(${A}, ${!on})`) : '';
  return `<div class="cl-kv fo-kv"><span>Focus</span><span class="fo-kv-v"><span class="fo-st">${state}</span>${sw}</span></div>
<p class="cl-own-note fo-note">The owner asked the team to give it extra attention: it comes first in every list, Health watches it more closely, and it leads the morning reminders and the Monday summary.${canEditClients() ? '' : ' Admins and approvers choose Focus clients.'}</p>`;
}
async function setClientFocus(ids, on){
  if(!canEditClients()){ showToast('error', 'Not allowed', 'Only admins and approvers choose the Focus clients.'); return; }
  ids = [].concat(ids);
  const one = ids.length === 1 ? clients.find(x => x.id === ids[0]) : null;
  const r = await saveClientFocus(ids, on);
  if(r.failed) showToast('error', `${r.failed} client${r.failed === 1 ? '' : 's'} didn’t save`, 'Try again.');
  else if(r.done) showToast('success', one ? (on ? `${one.name} is a Focus client` : `${one.name} is off Focus`) : `${r.done} client${r.done === 1 ? '' : 's'} ${on ? 'added to' : 'taken off'} Focus`,
    on ? 'It comes first in every list, and Health watches it closer.' : 'It goes back to the usual order.');
  renderAll();
}

// Importance, from 1 to 10, as a word in a coloured pill: High (8 and up, where a client on Watch counts
// as At risk) is purple, Medium (4 to 7) blue, Low (1 to 3) grey. Not health's colours, and not orange,
// so it never reads as a warning or a button. The exact number is in the label and in Edit Client.
function clientImportanceCell(c){
  const n = Math.max(0, Math.min(10, Math.round(Number(c.importance) || 0)));
  if(!n) return '<span class="cl-imp" role="cell" aria-label="Importance not set"><span class="t-3">—</span></span>';
  const [word, k] = n >= 8 ? ['High', 'hi'] : n >= 4 ? ['Medium', 'md'] : ['Low', 'lo'];
  return `<span class="cl-imp" role="cell" aria-label="Importance ${n} of 10, ${word.toLowerCase()}"><span class="imp-p ${k}">${word}</span></span>`;
}

// Where this week's update stands, in a word or two.
function clientStageWord(w){
  if(w.off) return 'No weekly update';
  if(w.done >= 3) return 'Approved';
  if(w.done === 2) return 'In review';
  if(w.draft) return 'Draft written';
  if(w.forEmail.length) return `${w.forEmail.length} logged, no draft`;
  if(w.logged.length) return 'Only internal work';
  return 'Nothing logged';
}
function clientWeekCell(w){
  if(w.off) return ['No weekly update', 'is-none', 'Internal'];
  if(w.sent){ const d = relDay(w.last); return [`Sent ${d === 'Today' ? 'today' : d}`, 'is-sent', w.dueText.replace(/^Due /, 'Next due ')]; }
  if(w.late) return [lateWords(w), 'is-late', clientStageWord(w)];
  return [clientStageWord(w), w.done === 0 && !w.logged.length ? 'is-none' : '', w.dueText];
}
// How the owner was picked, for the panel.
function ownerReason(c){
  const set = c.customFieldValues && c.customFieldValues.owner;
  if(set) return ['set', ''];
  const since = addDays(rNow(), -60), tally = {};
  (c.improvements || []).forEach(i => { if(i.author && new Date(i.date) >= since) tally[i.author] = (tally[i.author] || 0) + 1; });
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  if(top) return ['work', `Picked automatically: ${firstName(top[0])} logged the most work here in the last 60 days.`];
  const owner = clientOwner(c);
  return owner ? ['draft', `Picked automatically: ${firstName(owner)} wrote the latest draft.`] : ['none', 'Nobody yet. It’s whoever logs the most work here, unless you choose someone.'];
}
async function setClientOwner(clientId, name){
  const c = clients.find(x => x.id === clientId); if(!c) return;
  const values = Object.assign({}, c.customFieldValues || {});
  if(name) values.owner = name; else delete values.owner;
  const ok = await updateClientRow(clientId, { customFieldValues: values });
  if(!ok){ showToast('error', 'Couldn’t change the owner', 'Try again in a moment.'); renderClientsTable(); return; }
  c.customFieldValues = values;
  showToast('success', name ? `${firstName(name)} owns ${c.name}` : 'Owner set to automatic', name ? '' : `It follows whoever logs the most work.`);
  renderAll();
}

function renderClientsTable(){
  const root = document.getElementById('clientsRoot');
  if(!root || typeof clients === 'undefined') return;
  // My clients: your scope of work and what you've worked on lately (work-areas.js). The switch
  // shows when that's some of the clients, not none or all of them.
  const acAll = activeClients(), { yours, has: hasAreas } = myClientsSplit(), mineOn = hasAreas && clientsMine;
  // Paused clients aren't working with us right now: activeClients() leaves them out, and the people
  // who edit clients see them in their own table, under See Paused Clients (client-status.js); the rest
  // of the team only hears when one is paused. A paused one still waiting for setup is there too.
  const canPz = canEditClients(), mineOf = c => typeof waYours !== 'function' || waYours(c);
  const pausedAll = liveClients().filter(c => isPausedClient(c) && (!mineOn || mineOf(c))).sort((a, b) => a.name.localeCompare(b.name));
  const pz = clientsPausedOpen && canPz;
  const ac = mineOn ? yours : acAll;
  if(pz && clBulk) [...clBulk].forEach(id => { if(!pausedAll.some(c => c.id === id)) clBulk.delete(id); });
  const rowOf = c => ({ c, h: clientHealth(c), w: weekView(clientWeek(c)), owner: clientOwner(c) });
  const rows = pz ? [] : ac.map(rowOf);
  // added from Harvest, waiting for an approver to finish their info (client-setup.js)
  // Needs setup is an approver's job: members don't see those clients here until they're set up
  const su = canEditClients() && !pz ? setupClients() : [], suOwner = c => (c.customFieldValues || {}).owner || '';
  const services = [...new Set((pz ? pausedAll : ac.concat(su)).flatMap(serviceParts))].sort((a, b) => a.localeCompare(b));
  if(clientFilters.service !== 'all' && !services.includes(clientFilters.service)) clientFilters.service = 'all'; // a project that's gone
  const suShown = clientsSeg !== 'all' ? [] : su.filter(c => (clientFilters.service === 'all' || serviceHas(c, clientFilters.service)) && (clientsOwnerFilter === 'all' || suOwner(c) === clientsOwnerFilter)
    && (!clientFilters.search || c.name.toLowerCase().includes(clientFilters.search) || (c.email || '').toLowerCase().includes(clientFilters.search)))
    .sort((a, b) => String((b.customFieldValues || {}).harvestAdded || '').localeCompare(String((a.customFieldValues || {}).harvestAdded || '')) || a.name.localeCompare(b.name));
  // needs attention: what Health counts (a paused client, or one with no weekly update, isn't on
  // Health, so it isn't here either); not sent leaves out the clients that get no update
  const needsCare = r => r.h.level !== 'g' && r.c.status !== 'Paused' && !r.w.off;
  const needs = rows.filter(needsCare), notSent = rows.filter(r => !r.w.sent && !r.w.off);
  const focusRows = rows.filter(r => isFocus(r.c));
  if(!pz && clientsSeg === 'focus' && !focusRows.length && !canEditClients()) clientsSeg = 'all';
  let shown = clientsSeg === 'attention' ? needs : clientsSeg === 'behind' ? notSent : clientsSeg === 'focus' ? focusRows : rows;
  const passes = (c, owner) => (clientFilters.service === 'all' || serviceHas(c, clientFilters.service)) && (clientsOwnerFilter === 'all' || owner === clientsOwnerFilter)
    && (!clientFilters.search || c.name.toLowerCase().includes(clientFilters.search) || (c.email || '').toLowerCase().includes(clientFilters.search));
  shown = shown.filter(r => passes(r.c, r.owner));
  const pausedShown = pz ? pausedAll.filter(c => passes(c, clientOwner(c))).sort((a, b) => a.name.localeCompare(b.name)) : [];
  // Still a client? Gone quiet, or archived in Harvest with work open: first, for the people who decide
  const wIdx = clientWorkIndex();
  const asks = pz ? [] : ac.filter(c => clientStatusAsk(c, wIdx)), askIds = new Set(clientsSeg === 'all' ? asks.map(c => c.id) : []);
  const rank = { r: 0, y: 1, g: 2 };
  const dir = clientSort.dir === 'desc' ? -1 : 1;
  shown.sort(clientSort.field === 'name' && clientSort.explicit ? (a, b) => dir * a.c.name.localeCompare(b.c.name)
    : clientSort.field === 'importance' && clientSort.explicit ? (a, b) => dir * ((a.c.importance || 0) - (b.c.importance || 0)) || a.c.name.localeCompare(b.c.name)
    : (a, b) => focusFirst(a.c, b.c) || rank[a.h.level] - rank[b.h.level] || b.h.signals.filter(s => s.l === 'r').length - a.h.signals.filter(s => s.l === 'r').length || (b.c.importance || 0) - (a.c.importance || 0) || a.c.name.localeCompare(b.c.name));
  const owners = [...new Set((pz ? pausedAll.map(clientOwner) : rows.map(r => r.owner)).concat(su.map(suOwner)).filter(Boolean))].sort();
  if(inspectedClientId && !acAll.some(c => c.id === inspectedClientId) && !setupClients().some(c => c.id === inspectedClientId) && !liveClients().some(c => c.id === inspectedClientId && isPausedClient(c))) inspectedClientId = null;
  // the new look uses the canvas columns: client, service, owner, health, this week, importance
  const uw = typeof uiStyleOn === 'function' && uiStyleOn();
  const row = ({ c, h, w, owner }) => {
    const sel = c.id === inspectedClientId, reason = h.level === 'g' ? '' : tableSignal(h, c);
    const [wk, wkCls, wkSub] = clientWeekCell(w);
    const picked = !!(clBulk && clBulk.has(c.id));
    if(uw) return `<div class="cl-r client-row${sel ? ' is-sel' : ''}${picked ? ' is-picked' : ''}" data-id="${c.id}" role="row" tabindex="0" aria-selected="${clBulk ? picked : sel}" onclick="${clBulk ? `clBulkToggle('${c.id}')` : `clientRowClick(event,'${c.id}')`}" ${clBulk ? `onkeydown="clBulkKey(event,'${c.id}')"` : `ondblclick="openClientDetail('${c.id}')"`}>
<span class="cl-c" role="cell">${clBulkCk(c)}<span class="cl-tx"><b>${escapeHtml(c.name)}${focusMark(c)}</b></span></span>
<span class="cl-sv" role="cell">${escapeHtml(c.service || '—')}</span>
<span class="cl-o" role="cell">${owner ? escapeHtml(firstName(owner)) : '<span class="t-3">—</span>'}</span>
<span class="cl-hc" role="cell">${h.off ? '<span class="t-3" title="Health doesn’t watch a client with no weekly update">—</span>' : `<span class="cl-h ${h.level}"><i></i>${healthWord(h.level)}</span>${reason ? `<span class="cl-s">${escapeHtml(reason)}</span>` : ''}`}</span>
<span class="cl-w" role="cell"><span class="cl-wk ${wkCls}">${escapeHtml(wk)}</span><span class="cl-s">${escapeHtml(wkSub)}</span></span>
${clientImportanceCell(c)}</div>`;
    return `<div class="cl-r client-row${sel ? ' is-sel' : ''}${picked ? ' is-picked' : ''}" data-id="${c.id}" role="row" tabindex="0" aria-selected="${clBulk ? picked : sel}" onclick="${clBulk ? `clBulkToggle('${c.id}')` : `clientRowClick(event,'${c.id}')`}" ${clBulk ? `onkeydown="clBulkKey(event,'${c.id}')"` : `ondblclick="openClientDetail('${c.id}')"`}>
<span class="cl-c" role="cell">${clBulkCk(c)}<span class="cl-tx"><b>${escapeHtml(c.name)}${focusMark(c)}</b><span class="cl-s">${escapeHtml(c.service || '—')}</span></span></span>
<span class="cl-o" role="cell">${owner ? escapeHtml(owner) : '<span class="t-3">—</span>'}</span>
<span class="cl-hc" role="cell">${h.off ? '<span class="t-3" title="Health doesn’t watch a client with no weekly update">—</span>' : `<span class="cl-h ${h.level}"><i></i>${healthWord(h.level)}</span>${reason ? `<span class="cl-s">${escapeHtml(reason)}</span>` : ''}`}</span>
<span class="cl-w" role="cell"><span class="cl-wk ${wkCls}">${escapeHtml(wk)}</span><span class="cl-s">${escapeHtml(wkSub)}</span></span>
<span class="cl-l" role="cell">${histDotsHtml(h.seq)}</span>
${clientImportanceCell(c)}</div>`;
  };
  const askShown = shown.filter(r => askIds.has(r.c.id)), rest = shown.filter(r => !askIds.has(r.c.id));
  const sNeeds = rest.filter(needsCare), sOk = rest.filter(r => !needsCare(r));
  const group = (title, list) => list.length ? `<div class="cl-g" role="presentation"><b>${title}</b><span>${uw ? '· ' : ''}${list.length}</span></div>${list.map(row).join('')}` : '';
  // approvers match them all to Radar's clients in one sheet (client-setup.js)
  const suMatch = canEditClients() && typeof openMatchClientsSheet === 'function' && ac.some(c => !hvLinkOf(c)) ? `<span class="cl-g-act"><button class="x-lnk" onclick="openMatchClientsSheet()">Match to Existing Clients</button>${infoTip(CL_TIPS.match, 'What does Match to Existing Clients do?')}</span>` : '';
  const suGroup = suShown.length ? `<div class="cl-g" role="presentation"><b>Needs setup</b><span>${suShown.length}</span>${suMatch}</div>${suShown.map(clientSetupRowHtml).join('')}` : '';
  const askGroup = askShown.length ? `<div class="cl-g" role="presentation"><b>Still clients?</b><span>${uw ? '· ' : ''}${askShown.length}</span>${infoTip(CL_ASK_TIP, 'Why is Radar asking?')}</div>${askShown.map(r => askRowHtml(r.c, wIdx, uw)).join('')}` : '';
  const body = pz ? pausedTableBody(pausedShown, uw)
    : shown.length || suShown.length ? suGroup + askGroup + group('Needs attention', sNeeds) + group('On track', sOk)
    : clientsSeg === 'focus' && !focusRows.length ? `<div class="cl-empty fo-empty">${icon('target')}<b>No Focus clients yet</b><span>When the owner asks the team to give a client extra attention, switch on Focus in its panel or with Bulk Edit. Focus clients come first in every list, and Health watches them closer.</span></div>`
    : ac.length || su.length ? `<div class="cl-empty">No clients match.<a class="x-lnk" href="#" onclick="clearClientsCanvasFilters();return false;">Clear Filters</a></div>`
    : emptyNoClients('Every client lives here: who owns it, its health, this week’s update and how much it matters.');
  // Focus: the clients the owner asked us to give extra attention (shown once there are any, or to approvers)
  const seg = [['all', 'Active', rows.length + su.length], ...(focusRows.length || canEditClients() ? [['focus', 'Focus', focusRows.length]] : []), ['attention', 'Needs attention', needs.length], ['behind', 'Not sent yet', notSent.length]]
    .map(([k, t, n]) => `<button class="${clientsSeg === k ? 'on' : ''}" role="tab" aria-selected="${clientsSeg === k}" onclick="setClientsSeg('${k}')">${t} <span class="c">${n}</span></button>`).join('');
  const sortIc = icon('caret-down', { weight: 'bold' });
  // the paused clients, in a table of their own (client-status.js): beside the table's title, or in the bar
  const pzBtn = `<button class="btn cl-pz" onclick="setClientsPaused(true)" title="Clients that aren’t working with us right now">${icon('pause')}See Paused Clients<span class="cl-pz-n">${pausedAll.length}</span></button>`;
  // a client outside your areas, opened from search or elsewhere, still opens
  // a paused one opens too (from its notification, or the paused clients' table)
  const selC = inspectedClientId ? acAll.find(c => c.id === inspectedClientId) || liveClients().find(c => c.id === inspectedClientId && isPausedClient(c)) : null;
  const sel = inspectedClientId ? (rows.find(r => r.c.id === inspectedClientId) || (selC ? rowOf(selC) : null)) : null;
  // one opened from search or elsewhere still opens, for a member as "Waiting for an approver"
  const suSel = !sel && inspectedClientId ? setupClients().find(c => c.id === inspectedClientId) : null;
  const prev = root.querySelector('.sp-page')?.scrollTop || 0;
  root.innerHTML = `<div class="spw"><div class="sp-page"><div class="cl">
<div class="cl-bar0">${pz ? `<button class="btn cl-back" onclick="setClientsPaused(false)">${icon('caret-left', { weight: 'bold' })}Active Clients</button>${uw ? '' : '<b class="cl-pz-t">Paused clients</b>'}` : `<div class="seg" role="tablist" aria-label="Show">${seg}</div>`}<span class="cl-sp"></span>
<label class="cl-find">${icon('magnifying-glass')}<input id="clientsFind" type="search" placeholder="Filter clients" aria-label="Filter clients" value="${escapeHtml(clientFilters.search || '')}" oninput="setClientsFind(this.value)"></label>
${hasAreas ? `<label class="pop-wrap">Show: <select class="pop" onchange="setClientsMine(this.value)"><option value="mine"${mineOn ? ' selected' : ''}>My clients</option><option value="all"${mineOn ? '' : ' selected'}>All clients</option></select></label>` : ''}
<label class="pop-wrap">Owner: <select class="pop" onchange="setClientsOwner(this.value)"><option value="all">All</option>${owners.map(o => `<option${clientsOwnerFilter === o ? ' selected' : ''}>${escapeHtml(o)}</option>`).join('')}</select></label>
<label class="pop-wrap">${harvestOwnsServices() ? 'Project' : 'Service'}: <select class="pop" onchange="setClientsService(this.value)"><option value="all">All</option>${services.map(s => `<option${clientFilters.service === s ? ' selected' : ''}>${escapeHtml(s)}</option>`).join('')}</select></label>
${!pz && !uw && canPz && pausedAll.length ? pzBtn : ''}
${canEditClients() && !clBulk ? `<button class="btn cl-bulk-btn" onclick="clBulkMenu(event)" aria-haspopup="menu">Bulk Edit${icon('caret-down', { weight: 'bold' })}</button>` : ''}</div>
<div class="cl-table${uw ? ' is-uw' : ''}" role="table" aria-label="Clients">
${uw ? `<div class="cl-th"><span class="cl-thi">${icon(pz ? 'pause' : 'briefcase')}</span><b>${pz ? (mineOn ? 'My paused clients' : 'Paused clients') : mineOn ? 'My active clients' : 'Active clients'}</b><span class="cl-thn">${pz ? pausedShown.length : shown.length}</span>${pz ? infoTip(CL_PZ_TIP, 'What does Paused mean?') : canPz && pausedAll.length ? pzBtn : ''}</div>
${pz ? pausedHeadHtml(true) : `<div class="cl-head" role="row"><button role="columnheader" class="${clientSort.field === 'name' && clientSort.explicit ? 'is-sort' : ''}" onclick="clientSort={field:'name',dir:clientSort.field==='name'&&clientSort.explicit&&clientSort.dir==='asc'?'desc':'asc',explicit:true};renderClientsTable()">Client${clientSort.field === 'name' && clientSort.explicit ? sortIc : ''}</button><span role="columnheader">Service</span><span role="columnheader">Owner</span><span role="columnheader" class="cl-hh"><button class="${clientSort.explicit ? '' : 'is-sort'}" onclick="clientSort={field:'health'};renderClientsTable()">Health${clientSort.explicit ? '' : sortIc}</button></span><span role="columnheader">This week</span><span role="columnheader" class="cl-hh"><button class="${clientSort.field === 'importance' && clientSort.explicit ? 'is-sort' : ''}" onclick="clientSort={field:'importance',dir:clientSort.field==='importance'&&clientSort.explicit&&clientSort.dir==='desc'?'asc':'desc',explicit:true};renderClientsTable()">Importance${clientSort.field === 'importance' && clientSort.explicit ? sortIc : ''}</button></span></div>`}` : pz ? pausedHeadHtml(false) : `<div class="cl-head" role="row"><button role="columnheader" class="${clientSort.field === 'name' && clientSort.explicit ? 'is-sort' : ''}" onclick="clientSort={field:'name',dir:clientSort.field==='name'&&clientSort.explicit&&clientSort.dir==='asc'?'desc':'asc',explicit:true};renderClientsTable()">Client${clientSort.field === 'name' && clientSort.explicit ? sortIc : ''}</button><span role="columnheader">Owner</span><span role="columnheader" class="cl-hh"><button class="${clientSort.explicit ? '' : 'is-sort'}" onclick="clientSort={field:'health'};renderClientsTable()">Health${clientSort.explicit ? '' : sortIc}</button></span><span role="columnheader">This week</span><span role="columnheader">Last 8 weeks${infoTip(CL_TIPS.hist, 'What do the dots mean?')}</span><span role="columnheader" class="cl-hh"><button class="${clientSort.field === 'importance' && clientSort.explicit ? 'is-sort' : ''}" onclick="clientSort={field:'importance',dir:clientSort.field==='importance'&&clientSort.explicit&&clientSort.dir==='desc'?'asc':'desc',explicit:true};renderClientsTable()">Importance${clientSort.field === 'importance' && clientSort.explicit ? sortIc : ''}</button></span></div>`}
<div id="clientsTbody" role="rowgroup">${body}</div></div>
${clBulkBarHtml()}</div></div>${sel ? clientPanelHtml(sel) : suSel ? clientSetupPanelHtml(suSel) : ''}</div>`;
  const sp = root.querySelector('.sp-page'); if(sp) sp.scrollTop = prev;
  const clEl = root.querySelector('.cl'), tbl = root.querySelector('.cl-table');
  if(sp && clEl && tbl){ const edge = () => clEl.classList.toggle('is-scrolled', tbl.getBoundingClientRect().top < sp.getBoundingClientRect().top - .5); sp.addEventListener('scroll', edge, { passive: true }); edge(); }
  // the line under the title says what this list is; the counts are already in the segments and the table
  if(currentViewName === 'clients') setToolbar(null, pz ? 'Not working with us right now. Nothing about them is deleted.'
    : mineOn ? 'Your clients that are working with us right now' : 'The clients working with us right now');
  const old = document.getElementById('clientInspector'); if(old){ old.hidden = true; old.innerHTML = ''; }
}

// The everyday actions for a client, in a toolbar at the foot of its panel (here and This Week).
function clientQuickActionsHtml(c){
  const A = `'${c.id}'`, work = waCanWork(c); // outside your areas: no logging (work-areas.js)
  return `<div class="sp-foot" role="toolbar" aria-label="Quick actions">${[...(work ? [['Log Improvement', `openQueueLogImprovementModal(${A})`, 'square-pen'], ['Track Time', `openTimerModal(${A})`, 'timer']] : []),
    ['Note', `openNoteModal(null,${A})`, 'notebook-pen'], ['Reminder', `openNewReminderModal(${A})`, 'bell-ring']]
    .map(([t, fn, ic]) => `<button class="cl-act" onclick="${fn}">${icon(ic)}<span>${t}</span></button>`).join('')}${c.email ? `<a class="cl-act" href="mailto:${escapeHtml(c.email)}">${icon('envelope-simple')}<span>Email</span></a>` : ''}</div>`;
}
// The client panel: the one thing to do, then three numbers (this week, hours, on time), why it
// needs attention and the details you'd look up (owner settable). The everyday actions sit at the foot.
function clientPanelHtml({ c, h, w, owner }){
  const next = nextStepTask(c), lvl = h.quiet ? h.rawLevel : h.level, approver = canEditClients();
  const start = c.startDate ? new Date(c.startDate + 'T12:00:00') : null;
  const meta = [owner, c.service].filter(Boolean).map(escapeHtml).join(' · ');
  const why = healthPhrase(h, c);
  const A = `'${c.id}'`;
  let eyebrow, title, sub, acts = '';
  // paused, or Radar asking whether it's still a client (client-status.js): that comes first
  const st = typeof clientStatusPanel === 'function' ? clientStatusPanel(c) : null;
  if(st) ({ eyebrow, title, sub, acts } = st);
  else if(lvl !== 'g'){
    const sinceTxt = h.since ? (relDay(h.since).toLowerCase() === 'today' ? 'today' : relDay(h.since)) : 'today';
    eyebrow = h.quiet ? `<span class="sp-eb">${icon('check', { weight: 'bold' })}Handled, settling</span>` : `<span class="sp-eb ${lvl === 'r' ? 'red' : 'warn'}"><i class="eb-dot"></i>${lvl === 'r' ? 'At risk' : 'Watch'} since ${escapeHtml(sinceTxt)}</span>`;
    if(next){ title = `Next step: ${next.title}`; sub = `${why ? escapeHtml(why) + ' · ' : ''}${escapeHtml((teamProfiles.find(p => p.id === next.assigneeId) || {}).name || '')}${next.dueDate ? ' · due ' + fmtShortDate(new Date(next.dueDate + 'T12:00:00')) : ''}${nextStepSprintName(next) ? ' · ' + escapeHtml(nextStepSprintName(next)) : ''}`;
      acts = `<button class="btn" onclick="markHealthHandled(${A})" title="You’ve dealt with it: the warning goes quiet for ${healthThresholds().quietDays} days, unless it gets worse">Mark Handled</button><button class="btn btn-p" onclick="openTaskDetailModal('${next.id}')">Open Task</button>`; }
    else if(h.quiet){ title = 'Handled, waiting for the numbers to settle'; sub = ''; }
    else { title = why || 'No next step yet'; sub = `Plan a next step and it becomes a task for ${escapeHtml(firstName(owner) || 'the owner')}.`;
      acts = `<button class="btn" onclick="markHealthHandled(${A})" title="You’ve dealt with it: the warning goes quiet for ${healthThresholds().quietDays} days, unless it gets worse">Mark Handled</button><button class="btn btn-p" onclick="planNextStep(${A})">${icon('plus')}Plan Next Step</button>`; }
  } else if(w.off){
    eyebrow = `<span class="sp-eb">${icon('minus-circle', { weight: 'bold' })}Not watched by Health</span>`;
    title = 'No weekly update'; sub = 'Work and hours are still logged here. Pick how it’s sent under Weekly win to turn it back on.';
  } else if(w.sent){
    eyebrow = `<span class="sp-eb ok">${icon('check', { weight: 'bold' })}Healthy</span>`;
    title = 'This week’s update is out'; sub = `Sent ${escapeHtml(relDayLower(w.last))}. Next one ${escapeHtml(w.dueText.replace(/^Due /, 'due '))}.`;
  } else {
    const t = weekTodo(w);
    eyebrow = `<span class="sp-eb ok">${icon('check', { weight: 'bold' })}Healthy · ${escapeHtml(w.dueText.toLowerCase())}</span>`;
    title = t.what; sub = w.note ? escapeHtml(w.note) : '';
    if(t.act) acts = `<button class="btn" onclick="openWeekClient(${A})">Open in This Week</button><button class="btn btn-p" onclick="${t.act[0]}">${escapeHtml(t.act[1])}</button>`;
  }
  // three numbers: this week's update (opens it in This Week), hours this month, on time
  const hp = h.hp, ots = onTimeSummary(h.seq), lateNow = w.late && !w.sent;
  const weekB = w.off ? 'Off' : w.sent ? 'Sent' : lateNow ? lateWords(w) : w.dueText;
  const weekS = w.off ? 'No weekly update' : w.sent ? relDay(w.last) : w.done >= 3 ? 'Approved, not sent yet' : w.done === 2 ? (canApproveUpdates() ? 'Waiting for you' : 'Waiting for review')
    : w.draft ? 'Not sent for review' : w.forEmail.length ? 'Not written yet' : w.logged.length ? 'Only internal work logged' : 'Nothing logged yet';
  const hoursB = hp.budget ? `<span${hp.used > hp.budget ? ' class="t-red"' : ''}>${Math.round(hp.used)}</span> / ${hp.budget} h` : `${Math.round(hp.used)} h`;
  const hoursS = hp.budget ? `<span class="s${hp.projected > hp.budget ? ' t-red' : ''}">On pace for ${Math.round(hp.projected)} h</span>` : '<span class="s">No monthly budget</span>';
  const nums = `<div class="cl-m">
${w.off ? `<div class="cl-mc"><span class="k">This week’s win</span><b>${escapeHtml(weekB)}</b><span class="s">${escapeHtml(weekS)}</span></div>`
  : `<button class="cl-mc" onclick="openWeekClient(${A})" title="Open in This Week"><span class="k">This week’s win</span><b${lateNow ? ' class="t-red"' : ''}>${escapeHtml(weekB)}</b><span class="s">${escapeHtml(weekS)}</span></button>`}
<div class="cl-mc"><span class="k">Hours</span><b>${hoursB}</b>${hoursS}</div>
<div class="cl-mc"><span class="k">Updates on time</span><b>${!w.off && ots.total ? `${ots.onTime} of ${ots.total}` : '—'}</b><span class="s">${w.off ? 'Not counted' : ots.total ? histDotsHtml(h.seq) : 'No updates yet'}</span></div>
</div>`;
  // details
  const [how, why2] = ownerReason(c);
  const people = (typeof teamProfiles !== 'undefined' ? teamProfiles : []).filter(p => p.name && !p.access_revoked).map(p => p.name).sort();
  const ownerCell = approver
    ? `<label class="cl-own"><select onchange="setClientOwner(${A}, this.value)" aria-label="Owner"><option value=""${how !== 'set' ? ' selected' : ''}>Automatic${how !== 'set' && owner ? ` (${escapeHtml(owner)})` : ''}</option>${people.map(n => `<option${how === 'set' && owner === n ? ' selected' : ''}>${escapeHtml(n)}</option>`).join('')}</select><span>${escapeHtml(owner || 'Nobody yet')}</span>${icon('caret-down', { weight: 'bold' })}</label>`
    : escapeHtml(owner || 'Nobody yet');
  const contact = [clientContact(c), c.email, (c.customFieldValues || {}).phone].filter(Boolean).map(escapeHtml).join(' · ');
  const site = c.website ? `<a class="cl-link" href="${safeUrl(c.website.startsWith('http') ? c.website : 'https://' + c.website)}" target="_blank" rel="noopener">${escapeHtml(c.website.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>` : '';
  const kv = (k, v) => v ? `<div class="cl-kv"><span>${k}</span><span>${v}</span></div>` : '';
  const details = kv('Owner', ownerCell) + (why2 ? `<p class="cl-own-note">${escapeHtml(why2)}${approver ? ' Choose someone to make it fixed.' : ''}</p>` : '')
    + kv('Contact', contact) + kv('Website', site) + (typeof hvDetailsHtml === 'function' ? hvDetailsHtml(c) : '') + kv('Monthly hours', hp.budget ? `${hp.budget} h${typeof hvClientBudget === 'function' && hvClientBudget(c.id) ? ' <span class="t-3">· from Harvest</span>' : ''}` : '')
    + kv('Client since', start ? start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '')
    + focusDetailsHtml(c);
  const detSum = [owner || 'No owner yet', hp.budget ? `${hp.budget} h a month` : ''].filter(Boolean).join(' · ');
  return `<aside class="sp cl-p has-foot" aria-label="${escapeHtml(c.name)}">
<div class="sp-bar"><button class="ib" aria-label="Close" title="Close (Esc)" onclick="closeClientInspector()">${icon('x')}</button><span class="cl-pbar-r"><button class="ib" aria-label="More" title="More" onclick="clientPanelMore(event, ${A})">${icon('dots-three')}</button></span></div>
<div class="sp-main">
<div class="sp-head">${monoHtml(c, 'lg')}<div class="tx"><b><a class="sp-nm" href="#" onclick="openClientDetail(${A});return false;" title="Open client page">${escapeHtml(c.name)}${icon('caret-right', { weight: 'bold' })}</a></b><span>${meta}</span></div>${focusToggleHtml(c)}</div>
<div class="sp-status">${eyebrow}<b>${escapeHtml(title)}</b>${sub ? `<span class="sub">${sub}</span>` : ''}${acts ? `<div class="sp-acts">${acts}</div>` : ''}</div>
${nums}
<div class="sp-folds cl-folds">
${clientFoldHtml('win', 'Weekly win', clientWinSummary(c), clientWinHtml(c))}
${clientFoldHtml('det', 'Details', escapeHtml(detSum), `<div class="cl-kvs">${details}</div>`)}
${typeof clientMeetingsOn === 'function' && clientMeetingsOn(c) ? clientFoldHtml('mt', `${appLogo('granola', 'xs')}Meetings`, escapeHtml(lastMetWords(c) || 'No meeting with them yet'), clientMeetingsHtml(c, 5)) : ''}
${typeof clientWaOn === 'function' && clientWaOn(c) ? clientFoldHtml('wa', `${appLogo('whatsapp', 'xs')}WhatsApp`, clientWaSummary(c), clientWaHtml(c)) : ''}
</div>
${waOutsideNoteHtml(c)}
</div>
${clientQuickActionsHtml(c)}
</aside>`;
}
// Folded rows in the client panel: Weekly win starts open, Details closed; they stay as you leave them.
let CL_FOLDS = (() => { try { return Object.assign({ win: true }, JSON.parse(localStorage.getItem('cl-folds') || '{}') || {}); } catch(e){ return { win: true }; } })();
function toggleClientFold(k){
  CL_FOLDS[k] = !CL_FOLDS[k];
  try { localStorage.setItem('cl-folds', JSON.stringify(CL_FOLDS)); } catch(e){}
  renderClientsTable();
}
function clientFoldHtml(k, title, summary, body){
  const open = !!CL_FOLDS[k];
  return `<div class="sp-fold${open ? ' is-open' : ''}"><button class="sp-fold-h" aria-expanded="${open}" data-grow="cl-f-${k}" onclick="toggleClientFold('${k}')">${icon('caret-right', { weight: 'bold' })}<b>${title}</b><span class="sm">${summary}</span></button><div class="sp-fold-b" data-grow-key="cl-f-${k}">${open ? body : ''}</div></div>`;
}
// "WhatsApp · Thursdays" on the Weekly win row
function clientWinSummary(c){
  if(!getsUpdates(c)) return 'No weekly update';
  const ch = winChannel(c), d = winDay(c);
  return `${ch !== 'email' ? `<span class="wn-sic">${icon('message-circle')}</span>` : ''}${escapeHtml(winChannelWords(c))} · ${d ? escapeHtml(WIN_DAY_NAMES[d]) + 's' : 'no set day'}`;
}
// How the client gets its win: email, its WhatsApp group or both, which group, and the day.
function clientWinHtml(c){
  const approver = canEditClients(), off = !getsUpdates(c), ch = off ? 'none' : winChannel(c), g = winGroupFor(c), d = winDay(c), A = `'${c.id}'`;
  const kv = (k, v) => `<div class="cl-kv"><span>${k}</span><span>${v}</span></div>`;
  // None: no weekly update (the agency itself, an internal client), Nov 22
  const seg = approver ? `<span class="seg wn-seg" role="radiogroup" aria-label="Sends by">${[['whatsapp', 'WhatsApp', 'message-circle'], ['email', 'Email', ''], ['both', 'Both', ''], ['none', 'None', '']]
    .map(([k, t, ic]) => `<button class="${ch === k ? 'on' : ''}" role="radio" aria-checked="${ch === k}" onclick="${k === 'none' ? `setWeeklyUpdate(${A},false)` : `setWinChannel(${A},'${k}')`}"${k === 'none' ? ' title="No weekly update: for the agency itself or an internal client"' : ''}>${ic ? icon(ic) : ''}${t}</button>`).join('')}</span>` : escapeHtml(winChannelWords(c));
  if(off) return `<div class="cl-kvs wn-kvs">${kv('Sends by', seg)}</div><p class="wn-note">${icon('minus-circle')}No weekly update. It stays off This Week, Today, the Queue and Health; work and hours are still logged here.</p>`;
  const group = ch === 'email' ? '' : kv('Group', approver
    ? `<button class="pop wn-pop" onclick="winGroupMenu(event,${A})" title="${g ? escapeHtml(g.name) : ''}">${g ? `<span>${escapeHtml(g.name)}</span>` : '<span class="t-3">Pick the group</span>'}${icon('caret-down', { weight: 'bold' })}</button>`
    : g ? escapeHtml(g.name) : '<span class="t-3">Not linked yet</span>');
  const day = kv('Win day', approver ? `<button class="pop wn-pop" onclick="winDayMenu(event,${A})">${d ? WIN_DAY_NAMES[d] : '<span class="t-3">Pick a day</span>'}${icon('caret-down', { weight: 'bold' })}</button>`
    : d ? WIN_DAY_NAMES[d] : 'Every 7 days');
  const noEmail = ch !== 'whatsapp' && !c.email ? `<p class="wn-note"><span>${approver ? `<a class="fix-lnk" href="#" onclick="openClientEmailField(${A});return false;">Add the client’s email</a> so the win can go out by email.` : 'An admin or approver adds the client’s email so the win can go out by email.'}</span></p>` : '';
  const who = clientContact(c);
  const contact = kv('Main contact', approver
    ? `<input class="tf wn-in" value="${escapeHtml(who)}" placeholder="Who the win is for" aria-label="Main contact" onchange="setClientContact(${A}, this.value)" onkeydown="if(event.key==='Enter')this.blur()">`
    : who ? escapeHtml(who) : '<span class="t-3">Not set</span>');
  return `<div class="cl-kvs wn-kvs">${contact}${kv('Sends by', seg)}${group}${day}</div>${noEmail}${ch !== 'email' ? `<p class="wn-note">${icon('lock')}You paste it in the group. Radar never posts there.</p>` : ''}`;
}
// No email yet when sending: open Edit Client on the email field (or say who can add it).
function askForClientEmail(c){
  if(canEditClients()){ openClientEmailField(c.id); showToast('info', `Add ${c.name}’s email`, 'Save it, then send.'); }
  else showToast('info', `${c.name} needs an email`, 'An admin or approver adds it in Edit Client, then it can go out.');
}
// Edit Client, ready to type the email (the fix the Weekly win and Review point to).
function openClientEmailField(clientId){
  openEditClientForm(clientId);
  setTimeout(() => { const el = document.getElementById('ncEmail'); if(el){ el.focus(); el.select(); } }, 220);
}
// The main contact, from the panel: saves as it's typed in (on change).
async function setClientContact(clientId, value){
  const c = clients.find(x => x.id === clientId); if(!c || !canEditClients()) return;
  const v = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if(v === clientContact(c)) return;
  const cfv = Object.assign({}, c.customFieldValues || {});
  if(v) cfv.contact = v; else delete cfv.contact;
  const prev = c.customFieldValues; c.customFieldValues = cfv;
  if(!(await updateClientRow(c.id, { customFieldValues: cfv }))){ c.customFieldValues = prev; winsRerender(); showToast('error', 'Couldn’t save', 'Try again in a moment.'); return; }
  showToast('success', v ? `Wins greet ${v.split(' ')[0]}` : 'Main contact cleared', v ? `Main contact for ${c.name}.` : 'Wins greet the team.');
  if(typeof logClientActivity === 'function') logClientActivity(c.id, 'client_updated', `${myName() || 'Someone'} set the main contact to ${v || 'nobody'}.`);
}
// "…" in the panel: website, edit, delete.
function clientPanelMore(e, clientId){
  e.stopPropagation();
  const had = document.getElementById('clMenu'); had?.remove(); if(had) return;
  const c = clients.find(x => x.id === clientId); if(!c) return;
  const m = document.createElement('div');
  m.className = 'menu'; m.id = 'clMenu'; m.setAttribute('role', 'menu'); Object.assign(m.style, { position: 'fixed', zIndex: '1200' });
  const r = e.currentTarget.getBoundingClientRect();
  m.style.top = (r.bottom + 4) + 'px'; m.style.right = (window.innerWidth - r.right) + 'px';
  m.innerHTML = `<button class="mi" role="menuitem" onclick="openClientDetail('${c.id}')">${icon('buildings')}Open Client Page</button>
${c.website ? `<a class="mi" role="menuitem" href="${safeUrl(c.website.startsWith('http') ? c.website : 'https://' + c.website)}" target="_blank" rel="noopener">${icon('globe')}Open Website</a>` : ''}
${canEditClients() ? `<button class="mi" role="menuitem" onclick="setClientFocus('${c.id}', ${!isFocus(c)})">${icon('target')}${isFocus(c) ? 'Take Off Focus' : 'Add to Focus'}</button><button class="mi" role="menuitem" onclick="openEditClientForm('${c.id}')">${icon('pencil-simple')}Edit Client…</button>${hasAccess('delete_clients') ? `<div class="msep"></div><button class="mi danger" role="menuitem" onclick="deleteClient('${c.id}')">${icon('trash')}Delete Client…</button>` : ''}` : ''}`;
  document.body.appendChild(m);
  setTimeout(() => document.addEventListener('click', () => m.remove(), { once: true }), 0);
}
// Kept for callers from before the panel moved into the table.
function renderClientInspector(){ const el = document.getElementById('clientInspector'); if(el){ el.hidden = true; el.innerHTML = ''; } }
