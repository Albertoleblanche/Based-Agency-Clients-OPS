// All Clients, as on the canvas board "All Clients — improved": two groups (Needs attention,
// then On track), every cell in words with the reason underneath only when something is wrong,
// owners as full names, hours against the budget. Clicking a client opens the same right-hand
// panel as This Week, Health and Tasks; double-click (or Enter) opens the full client page.

let clientsSeg = 'all', clientsOwnerFilter = 'all';
function setClientsSeg(k){ clientsSeg = k; renderClientsTable(); }
function setClientsOwner(v){ clientsOwnerFilter = v; renderClientsTable(); }
function setClientsService(v){ clientFilters.service = v; renderClientsTable(); }
function setClientsFind(v){
  clientFilters.search = String(v || '').toLowerCase(); renderClientsTable();
  const el = document.getElementById('clientsFind'); if(el){ el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
}
// The panel opens and closes with the table (the shared panel motion slides it in and out).
function selectClientRow(id){ inspectedClientId = id; renderClientsTable(); }
function closeClientInspector(){ inspectedClientId = null; renderClientsTable(); }

// Where this week's update stands, in a word or two.
function clientStageWord(w){
  if(w.done >= 3) return 'Approved';
  if(w.done === 2) return 'In review';
  if(w.draft) return 'Draft written';
  if(w.logged.length) return `${w.logged.length} logged, no draft`;
  return 'Nothing logged';
}
function clientWeekCell(w){
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
  const ac = activeClients();
  const rows = ac.map(c => ({ c, h: clientHealth(c), w: weekView(clientWeek(c)), owner: clientOwner(c) }));
  const needs = rows.filter(r => r.h.level !== 'g'), notSent = rows.filter(r => !r.w.sent);
  let shown = clientsSeg === 'attention' ? needs : clientsSeg === 'behind' ? notSent : rows;
  shown = shown.filter(r => (clientFilters.service === 'all' || r.c.service === clientFilters.service) && (clientsOwnerFilter === 'all' || r.owner === clientsOwnerFilter)
    && (!clientFilters.search || r.c.name.toLowerCase().includes(clientFilters.search) || (r.c.email || '').toLowerCase().includes(clientFilters.search)));
  const rank = { r: 0, y: 1, g: 2 };
  const dir = clientSort.dir === 'desc' ? -1 : 1;
  shown.sort(clientSort.field === 'name' && clientSort.explicit ? (a, b) => dir * a.c.name.localeCompare(b.c.name)
    : (a, b) => rank[a.h.level] - rank[b.h.level] || b.h.signals.filter(s => s.l === 'r').length - a.h.signals.filter(s => s.l === 'r').length || (b.c.importance || 0) - (a.c.importance || 0) || a.c.name.localeCompare(b.c.name));
  const services = [...new Set(ac.map(c => c.service).filter(Boolean))].sort();
  const owners = [...new Set(rows.map(r => r.owner).filter(Boolean))].sort();
  if(inspectedClientId && !ac.some(c => c.id === inspectedClientId)) inspectedClientId = null;
  const row = ({ c, h, w, owner }) => {
    const sel = c.id === inspectedClientId, reason = h.level === 'g' ? '' : tableSignal(h, c);
    const [wk, wkCls, wkSub] = clientWeekCell(w), hp = h.hp, over = hp.budget && hp.used > hp.budget;
    const hrs = hp.budget ? `<span><b>${Math.round(hp.used)}</b> / ${hp.budget} h</span><span class="cl-bar"><i style="width:${Math.min(100, Math.round(hp.used / hp.budget * 100))}%"></i></span>` : `<span><b>${Math.round(hp.used)}</b> h</span>`;
    return `<div class="cl-r client-row${sel ? ' is-sel' : ''}" data-id="${c.id}" role="row" tabindex="0" aria-selected="${sel}" onclick="clientRowClick(event,'${c.id}')" ondblclick="openClientDetail('${c.id}')">
<span class="cl-c" role="cell">${monoHtml(c, 'sm')}<span class="cl-tx"><b>${escapeHtml(c.name)}</b><span class="cl-s">${escapeHtml(c.service || '—')}</span></span></span>
<span class="cl-o" role="cell">${owner ? escapeHtml(owner) : '<span class="t-3">—</span>'}</span>
<span class="cl-hc" role="cell"><span class="cl-h ${h.level}"><i></i>${healthWord(h.level)}</span>${reason ? `<span class="cl-s">${escapeHtml(reason)}</span>` : ''}</span>
<span class="cl-w" role="cell"><span class="cl-wk ${wkCls}">${escapeHtml(wk)}</span><span class="cl-s">${escapeHtml(wkSub)}</span></span>
<span class="cl-l" role="cell">${histDotsHtml(h.seq)}</span>
<span class="cl-hrs${over ? ' over' : ''}" role="cell">${hrs}</span></div>`;
  };
  const sNeeds = shown.filter(r => r.h.level !== 'g'), sOk = shown.filter(r => r.h.level === 'g');
  const group = (title, list) => list.length ? `<div class="cl-g" role="presentation"><b>${title}</b><span>${list.length}</span></div>${list.map(row).join('')}` : '';
  const body = shown.length ? group('Needs attention', sNeeds) + group('On track', sOk)
    : `<div class="cl-empty">${ac.length ? 'No clients match.' : 'No clients yet. Add one from New → Client.'}</div>`;
  const seg = [['all', 'All', rows.length], ['attention', 'Needs attention', needs.length], ['behind', 'Not sent yet', notSent.length]]
    .map(([k, t, n]) => `<button class="${clientsSeg === k ? 'on' : ''}" role="tab" aria-selected="${clientsSeg === k}" onclick="setClientsSeg('${k}')">${t} <span class="c">${n}</span></button>`).join('');
  const sortIc = icon('caret-down', { weight: 'bold' });
  const sel = inspectedClientId ? rows.find(r => r.c.id === inspectedClientId) : null;
  const prev = root.querySelector('.sp-page')?.scrollTop || 0;
  root.innerHTML = `<div class="spw"><div class="sp-page"><div class="cl">
<div class="cl-bar0"><div class="seg" role="tablist" aria-label="Show">${seg}</div><span class="cl-sp"></span>
<label class="cl-find">${icon('magnifying-glass')}<input id="clientsFind" type="search" placeholder="Filter clients" aria-label="Filter clients" value="${escapeHtml(clientFilters.search || '')}" oninput="setClientsFind(this.value)"></label>
<label class="pop-wrap">Owner: <select class="pop" onchange="setClientsOwner(this.value)"><option value="all">All</option>${owners.map(o => `<option${clientsOwnerFilter === o ? ' selected' : ''}>${escapeHtml(o)}</option>`).join('')}</select></label>
<label class="pop-wrap">Service: <select class="pop" onchange="setClientsService(this.value)"><option value="all">All</option>${services.map(s => `<option${clientFilters.service === s ? ' selected' : ''}>${escapeHtml(s)}</option>`).join('')}</select></label></div>
<div class="cl-table" role="table" aria-label="Clients">
<div class="cl-head" role="row"><button role="columnheader" class="${clientSort.field === 'name' && clientSort.explicit ? 'is-sort' : ''}" onclick="clientSort={field:'name',dir:clientSort.field==='name'&&clientSort.explicit&&clientSort.dir==='asc'?'desc':'asc',explicit:true};renderClientsTable()">Client${clientSort.field === 'name' && clientSort.explicit ? sortIc : ''}</button><span role="columnheader">Owner</span><button role="columnheader" class="${clientSort.explicit ? '' : 'is-sort'}" onclick="clientSort={field:'health'};renderClientsTable()">Health${clientSort.explicit ? '' : sortIc}</button><span role="columnheader">This week</span><span role="columnheader">Last 8 weeks</span><span role="columnheader" class="r">Hours this month</span></div>
<div id="clientsTbody" role="rowgroup">${body}</div></div>
</div></div>${sel ? clientPanelHtml(sel) : ''}</div>`;
  const sp = root.querySelector('.sp-page'); if(sp) sp.scrollTop = prev;
  if(currentViewName === 'clients'){
    const used = rows.reduce((a, r) => a + r.h.hp.used, 0), budget = rows.reduce((a, r) => a + (r.h.hp.budget || 0), 0);
    setToolbar(null, `${ac.length} client${ac.length === 1 ? '' : 's'} · ${needs.length} need attention${budget ? ` · ${Math.round(used)} of ${Math.round(budget)} h this month` : ''}`);
  }
  const old = document.getElementById('clientInspector'); if(old){ old.hidden = true; old.innerHTML = ''; }
}

// The everyday actions for a client, in a toolbar at the foot of its panel (here and This Week).
function clientQuickActionsHtml(c){
  const A = `'${c.id}'`;
  return `<div class="sp-foot" role="toolbar" aria-label="Quick actions">${[['Log Improvement', `openQueueLogImprovementModal(${A})`, 'square-pen'], ['Track Time', `openTimerModal(${A})`, 'timer'],
    ['Note', `openNoteModal(null,${A})`, 'notebook-pen'], ['Reminder', `openNewReminderModal(${A})`, 'bell']]
    .map(([t, fn, ic]) => `<button class="cl-act" onclick="${fn}">${icon(ic)}<span>${t}</span></button>`).join('')}${c.email ? `<a class="cl-act" href="mailto:${escapeHtml(c.email)}">${icon('envelope-simple')}<span>Email</span></a>` : ''}</div>`;
}
// The client panel: the one thing to do, then three numbers (this week, hours, on time), why it
// needs attention and the details you'd look up (owner settable). The everyday actions sit at the foot.
function clientPanelHtml({ c, h, w, owner }){
  const next = nextStepTask(c), lvl = h.quiet ? h.rawLevel : h.level, approver = canApprove();
  const start = c.startDate ? new Date(c.startDate + 'T12:00:00') : null;
  const meta = [owner, c.service, start ? 'since ' + start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : ''].filter(Boolean).map(escapeHtml).join(' · ');
  const A = `'${c.id}'`;
  let eyebrow, title, sub, acts = '';
  if(lvl !== 'g'){
    const sinceTxt = h.since ? (relDay(h.since).toLowerCase() === 'today' ? 'today' : relDay(h.since)) : 'today';
    eyebrow = h.quiet ? `<span class="sp-eb">${icon('check', { weight: 'bold' })}Handled, settling</span>` : `<span class="sp-eb ${lvl === 'r' ? 'red' : 'warn'}">${icon('warning', { weight: 'bold' })}${lvl === 'r' ? 'At risk' : 'Watch'} since ${escapeHtml(sinceTxt)}</span>`;
    if(next){ title = `Next step: ${next.title}`; sub = `${escapeHtml((teamProfiles.find(p => p.id === next.assigneeId) || {}).name || '')}${next.dueDate ? ' · due ' + fmtShortDate(new Date(next.dueDate + 'T12:00:00')) : ''}`;
      acts = `<button class="btn" onclick="markHealthHandled(${A})">Mark Handled</button><button class="btn btn-p" onclick="openTaskDetailModal('${next.id}')">Open Task</button>`; }
    else if(h.quiet){ title = 'Handled, waiting for the numbers to settle'; sub = ''; }
    else { title = 'No next step yet'; sub = 'Plan a fix or a check-in with a date, and it becomes a task for the owner.';
      acts = `<button class="btn" onclick="markHealthHandled(${A})">Mark Handled</button><button class="btn btn-p" onclick="planNextStep(${A})">${icon('plus')}Plan Next Step</button>`; }
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
  const weekB = w.sent ? 'Sent' : lateNow ? lateWords(w) : w.dueText;
  const weekS = w.sent ? relDay(w.last) : w.done >= 3 ? 'Approved, not sent yet' : w.done === 2 ? (approver ? 'Draft waiting for you' : 'Draft waiting for review')
    : w.draft ? 'Draft not sent for review' : w.logged.length ? `${todayPlural(w.logged.length, 'improvement')}, no draft` : 'Nothing logged yet';
  const hoursB = hp.budget ? `<span${hp.used > hp.budget ? ' class="t-red"' : ''}>${Math.round(hp.used)}</span> / ${hp.budget} h` : `${Math.round(hp.used)} h`;
  const hoursS = hp.budget ? `<span class="s${hp.projected > hp.budget ? ' t-red' : ''}">On pace for ${Math.round(hp.projected)} h</span>` : '<span class="s">No monthly budget</span>';
  const nums = `<div class="cl-m">
<button class="cl-mc" onclick="openWeekClient(${A})" title="Open in This Week"><span class="k">This week</span><b${lateNow ? ' class="t-red"' : ''}>${escapeHtml(weekB)}</b><span class="s">${escapeHtml(weekS)}</span></button>
<div class="cl-mc"><span class="k">Hours</span><b>${hoursB}</b>${hoursS}</div>
<div class="cl-mc"><span class="k">On time</span><b>${ots.total ? `${ots.onTime} of ${ots.total}` : '—'}</b><span class="s">${ots.total ? histDotsHtml(h.seq) : 'No updates yet'}</span></div>
</div>`;
  const why = h.signals.map(s => `<div class="hp-w"><span class="sig ${s.l}">${icon(s.icon)}</span><div class="tx"><b>${escapeHtml(s.title)}</b><span>${escapeHtml(s.text)}</span></div><span class="hp-since">${escapeHtml(relDay(s.since))}</span></div>`).join('');
  // details
  const [how, why2] = ownerReason(c);
  const people = (typeof teamProfiles !== 'undefined' ? teamProfiles : []).filter(p => p.name && !p.access_revoked).map(p => p.name).sort();
  const ownerCell = approver
    ? `<label class="cl-own"><select onchange="setClientOwner(${A}, this.value)" aria-label="Owner"><option value=""${how !== 'set' ? ' selected' : ''}>Automatic${how !== 'set' && owner ? ` (${escapeHtml(owner)})` : ''}</option>${people.map(n => `<option${how === 'set' && owner === n ? ' selected' : ''}>${escapeHtml(n)}</option>`).join('')}</select><span>${escapeHtml(owner || 'Nobody yet')}</span>${icon('caret-down', { weight: 'bold' })}</label>`
    : escapeHtml(owner || 'Nobody yet');
  const contact = [c.contactName || c.contact_name, c.email].filter(Boolean).map(escapeHtml).join(' · ');
  const site = c.website ? `<a class="cl-link" href="${safeUrl(c.website.startsWith('http') ? c.website : 'https://' + c.website)}" target="_blank" rel="noopener">${escapeHtml(c.website.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>` : '';
  const kv = (k, v) => v ? `<div class="cl-kv"><span>${k}</span><span>${v}</span></div>` : '';
  const details = kv('Owner', ownerCell) + (why2 ? `<p class="cl-own-note">${escapeHtml(why2)}${approver ? ' Choose someone to make it fixed.' : ''}</p>` : '')
    + kv('Contact', contact) + kv('Website', site) + kv('Monthly hours', hp.budget ? `${hp.budget} h` : '');
  return `<aside class="sp cl-p has-foot" aria-label="${escapeHtml(c.name)}">
<div class="sp-bar"><button class="ib" aria-label="Close" title="Close (Esc)" onclick="closeClientInspector()">${icon('x')}</button><span class="cl-pbar-r">${approver || c.website ? `<button class="ib" aria-label="More" title="More" onclick="clientPanelMore(event, ${A})">${icon('dots-three')}</button>` : ''}<a class="x-lnk" href="#" onclick="openClientDetail(${A});return false;">Open client page</a></span></div>
<div class="sp-main">
<div class="sp-head">${monoHtml(c, 'lg')}<div class="tx"><b>${escapeHtml(c.name)}</b><span>${meta}</span></div></div>
<div class="sp-status">${eyebrow}<b>${escapeHtml(title)}</b>${sub ? `<span class="sub">${sub}</span>` : ''}${acts ? `<div class="sp-acts">${acts}</div>` : ''}</div>
${nums}
${h.signals.length ? `<div class="sp-sec"><b>Why it needs attention</b><span>${todayPlural(h.signals.length, 'signal')}</span></div>${why}` : ''}
<div class="sp-sec"><b>Details</b>${approver ? `<a class="x-lnk" href="#" onclick="openEditClientForm(${A});return false;">Edit</a>` : ''}</div><div class="cl-kvs">${details}</div>
</div>
${clientQuickActionsHtml(c)}
</aside>`;
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
  m.innerHTML = `${c.website ? `<a class="mi" role="menuitem" href="${safeUrl(c.website.startsWith('http') ? c.website : 'https://' + c.website)}" target="_blank" rel="noopener">${icon('globe')}Open Website</a>` : ''}
${canApprove() ? `<button class="mi" role="menuitem" onclick="openEditClientForm('${c.id}')">${icon('pencil-simple')}Edit Client…</button><div class="msep"></div><button class="mi danger" role="menuitem" onclick="deleteClient('${c.id}')">${icon('trash')}Delete Client…</button>` : ''}`;
  document.body.appendChild(m);
  setTimeout(() => document.addEventListener('click', () => m.remove(), { once: true }), 0);
}
// Kept for callers from before the panel moved into the table.
function renderClientInspector(){ const el = document.getElementById('clientInspector'); if(el){ el.hidden = true; el.innerHTML = ''; } }
