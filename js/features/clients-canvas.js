// All Clients, as on the canvas: the roster as a table with health, last update, the last
// 8 weeks and this week's steps at a glance. Click a client and its panel slides over from
// the window's right edge; double-click (or Enter) opens the full client page.

let clientsSeg = 'all', clientsOwnerFilter = 'all';
function setClientsSeg(k){ clientsSeg = k; renderClientsTable(); }
function setClientsOwner(v){ clientsOwnerFilter = v; renderClientsTable(); }
function setClientsService(v){ clientFilters.service = v; renderClientsTable(); }

function renderClientsTable(){
  const root = document.getElementById('clientsRoot');
  if(!root || typeof clients === 'undefined') return;
  const ac = activeClients();
  const rows = ac.map(c => ({ c, h: clientHealth(c), w: weekView(clientWeek(c)), owner: clientOwner(c) }));
  const needs = rows.filter(r => r.h.level !== 'g'), behind = rows.filter(r => needsUpdate(r.w));
  let shown = clientsSeg === 'attention' ? needs : clientsSeg === 'behind' ? behind : rows;
  shown = shown.filter(r => (clientFilters.service === 'all' || r.c.service === clientFilters.service) && (clientsOwnerFilter === 'all' || r.owner === clientsOwnerFilter)
    && (!clientFilters.search || r.c.name.toLowerCase().includes(clientFilters.search) || (r.c.email || '').toLowerCase().includes(clientFilters.search)));
  const rank = { r: 0, y: 1, g: 2 };
  const dir = clientSort.dir === 'desc' ? -1 : 1;
  shown.sort(clientSort.field === 'name' && clientSort.explicit ? (a, b) => dir * a.c.name.localeCompare(b.c.name)
    : (a, b) => rank[a.h.level] - rank[b.h.level] || b.h.signals.filter(s => s.l === 'r').length - a.h.signals.filter(s => s.l === 'r').length || (b.c.importance || 0) - (a.c.importance || 0));
  const services = [...new Set(ac.map(c => c.service).filter(Boolean))].sort();
  const owners = [...new Set(rows.map(r => r.owner).filter(Boolean))].sort();
  const T = healthThresholds();
  const trs = shown.map(({ c, h, w, owner }) => {
    const last = lastSentAt(c), days = last ? daysBetween(last, rNow()) : null, stale = days != null && days >= T.noUpdateDays[0];
    const lastTxt = last ? `<span class="${stale ? 't-red' : ''}">${weekDay(last)}</span>${stale ? ` <span class="t-2">· ${days} days</span>` : ''}` : '<span class="t-2">None yet</span>';
    const hp = h.hp, hrs = hp.budget ? `<span class="${hp.used > hp.budget ? 't-red' : ''}">${Math.round(hp.used)}</span><span class="t-2"> / ${hp.budget} h</span>` : `<span class="t-2">${Math.round(hp.used)} h</span>`;
    const healthCell = h.level === 'g' ? '<span class="t-2">Healthy</span>'
      : `<span class="tags">${healthTag(h.level)}${signalChips(h, 1)}</span>`;
    const sel = c.id === inspectedClientId;
    return `<tr class="client-row${sel ? ' sel' : ''}" data-id="${c.id}" tabindex="0" aria-selected="${sel}" onclick="clientRowClick(event,'${c.id}')" ondblclick="openClientDetail('${c.id}')">
<td><span class="cell-c">${monoHtml(c)}<span style="font-weight:500">${escapeHtml(c.name)}</span></span></td><td>${owner ? `<span class="cell-c">${avHtml(owner)}<span>${escapeHtml(firstName(owner))}</span></span>` : '<span class="t-2">—</span>'}</td><td>${healthCell}</td>
<td>${lastTxt}</td><td>${histDotsHtml(h.seq)}</td><td class="num">${hrs}</td><td><span class="tags" style="flex-wrap:nowrap">${stepsHtml(w)}${needsUpdate(w) ? dueTag(w) : ''}</span></td></tr>`;
  }).join('');
  const seg = [['all', 'All', rows.length], ['attention', 'Needs attention', needs.length], ['behind', 'Update due', behind.length]]
    .map(([k, t, n]) => `<button class="${clientsSeg === k ? 'on' : ''}" role="tab" aria-selected="${clientsSeg === k}" onclick="setClientsSeg('${k}')">${t} <span class="c">${n}</span></button>`).join('');
  const sortIc = `<span class="sort">${icon('caret-down', { weight: 'bold' })}</span>`;
  root.innerHTML = `<div class="tbl-bar">
<div class="seg" role="tablist" aria-label="Show">${seg}</div><span style="flex:1"></span>
<label class="pop-wrap">Service: <select class="pop" onchange="setClientsService(this.value)"><option value="all">All</option>${services.map(s => `<option${clientFilters.service === s ? ' selected' : ''}>${escapeHtml(s)}</option>`).join('')}</select></label>
<label class="pop-wrap">Owner: <select class="pop" onchange="setClientsOwner(this.value)"><option value="all">All</option>${owners.map(o => `<option${clientsOwnerFilter === o ? ' selected' : ''}>${escapeHtml(o)}</option>`).join('')}</select></label>
</div>
<table class="tbl" id="clientsTable" aria-label="Clients"><thead><tr><th onclick="clientSort={field:'name',dir:clientSort.dir==='asc'?'desc':'asc',explicit:true};renderClientsTable()">Client</th><th>Owner</th><th onclick="clientSort={field:'health'};renderClientsTable()">Health${clientSort.explicit ? '' : sortIc}</th><th>Last update</th><th>Last 8 weeks</th><th class="num">Hours this month</th><th>This week</th></tr></thead>
<tbody id="clientsTbody">${trs || `<tr><td colspan="7" class="t-2" style="padding:24px">${ac.length ? 'No clients match.' : 'No clients yet. Add one from New → Client.'}</td></tr>`}</tbody></table>`;
  if(currentViewName === 'clients') setToolbar(null, `${ac.length} client${ac.length === 1 ? '' : 's'} · ${needs.length} need attention`);
  renderClientInspector();
}

function renderClientInspector(){
  const el = document.getElementById('clientInspector');
  if(!el) return;
  const c = inspectedClientId ? activeClients().find(x => x.id === inspectedClientId) : null;
  if(!c){ el.hidden = true; el.innerHTML = ''; return; }
  const h = clientHealth(c), w = weekView(clientWeek(c)), owner = clientOwner(c), next = nextStepTask(c), last = lastSentAt(c);
  const since = c.startDate ? ` · client since ${new Date(c.startDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}` : '';
  const primary = h.level !== 'g' && !next ? `<button class="btn btn-p" onclick="planNextStep('${c.id}')">${icon('plus')}Plan Next Step</button><button class="btn" onclick="openClientDetail('${c.id}')">Open</button>`
    : `<button class="btn btn-p" onclick="openClientDetail('${c.id}')">Open</button>`;
  const holder = w.holder && w.holder !== 'approvers' ? w.holder : owner;
  const weekBtns = w.sent ? '' : `<div style="display:flex;gap:8px;margin-top:10px">${w.draft ? `<button class="btn" onclick="openReviewDraft('${c.id}',${jsArg(w.draft.author)})">Open Draft</button>` : `<button class="btn" onclick="openWeekClient('${c.id}')">Open in This Week</button>`}${holder && holder !== myName() ? `<button class="btn" onclick="remindHolder('${c.id}')">Remind ${escapeHtml(firstName(holder))}</button>` : ''}</div>`;
  const act = (label, fn, ic, cls) => `<button class="mi${cls ? ' ' + cls : ''}" onclick="${fn}">${icon(ic)}<span>${label}</span></button>`;
  el.hidden = false;
  el.innerHTML = `<button class="ib" aria-label="Close panel" title="Close (Esc)" style="position:absolute;top:14px;right:14px" onclick="closeClientInspector()">${icon('x', { weight: 'bold' })}</button>
<div style="display:flex;flex-direction:column;align-items:flex-start;gap:10px">
<span class="mono ${clientColor(c)}" style="width:48px;height:48px;border-radius:12px;font-size:17px" aria-hidden="true">${escapeHtml(clientMono(c))}</span>
<div><div style="font-size:18px;font-weight:600;letter-spacing:-.01em">${escapeHtml(c.name)}</div><div class="t-2" style="font-size:13px;margin-top:2px">${escapeHtml([c.service, owner].filter(Boolean).join(' · '))}${since}</div></div>
<div style="display:flex;gap:8px;flex-wrap:wrap">${primary}</div></div>
<div style="margin-top:20px;display:flex;align-items:center;justify-content:space-between"><span class="set-h" style="margin:0">Health</span>${hstateHtml(h.level, h.level === 'g' ? 'Healthy' : `${healthWord(h.level)} since ${relDay(h.since || rNow()).toLowerCase() === 'today' ? 'today' : relDay(h.since || rNow())}`)}</div>
${h.signals.length ? `<div class="grp" style="margin-top:8px">${signalRowsHtml(h, 2)}</div>` : ''}
<div class="set-h" style="margin:22px 0 10px">This week’s update</div>
<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:13px">${stepsHtml(w)}<span class="t-2">${w.sent ? '' : `<span class="${w.late ? 't-red' : ''}">${escapeHtml(w.dueText)}</span> · `}${escapeHtml(w.note || '')}</span></div>
${weekBtns}
<div class="set-h" style="margin:22px 0 8px">Hours this month</div>
${h.hp.budget ? paceChartHtml(c, 392, 130) : `<p class="t-2" style="font-size:13px;margin:0">${Math.round(h.hp.used)} hours logged · no monthly budget set.</p>`}
<div class="set-h" style="margin:22px 0 8px">Last 8 weekly updates</div>
<div style="display:flex;align-items:center;justify-content:space-between;font-size:13px">${histDotsHtml(h.seq)}<span class="t-2">${last ? `Last sent ${fmtShortDate(last)} · ${daysBetween(last, rNow()) === 0 ? 'today' : daysBetween(last, rNow()) + ' days ago'}` : 'No update sent yet'}</span></div>
<div class="set-h" style="margin:26px 0 6px">Actions</div>
<div class="insp-acts">
${act('Log Improvement', `openQueueLogImprovementModal('${c.id}')`, 'square-pen')}
${act('Track Time', `openTimerModal('${c.id}')`, 'timer')}
${act('New Note', `openNoteModal(null,'${c.id}')`, 'notebook-pen')}
${act('New Reminder', `openNewReminderModal('${c.id}')`, 'bell')}
${c.email ? `<a class="mi" href="mailto:${escapeHtml(c.email)}">${icon('mail')}<span>Email ${escapeHtml(c.email)}</span></a>` : ''}
${c.website ? `<a class="mi" href="${safeUrl(c.website.startsWith('http') ? c.website : 'https://' + c.website)}" target="_blank" rel="noopener">${icon('globe')}<span>Open Website</span></a>` : ''}
${canApprove() ? act('Edit Client', `openEditClientForm('${c.id}')`, 'pencil-simple') : ''}
${canApprove() ? act('Delete Client…', `deleteClient('${c.id}')`, 'trash', 'danger') : ''}
</div>`;
}
