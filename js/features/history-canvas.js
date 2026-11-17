// Past Improvements and Finished Tasks, in the canvas list style: a filter bar, then the records.
// Filtering and deleting reuse improvements-history.js and tasks.js.

let impShown = 12;
function impFilterChanged(){ impShown = 12; renderImprovementsHistory(); }
function renderImprovementsHistory(){
  const el = document.getElementById('improvementsHistoryList');
  if(!el) return;
  const mw = document.getElementById('improvementsMemberFilterField'); if(mw) mw.style.display = canApprove() ? '' : 'none';
  const all = getAllImprovementsFlat();
  const memberFilter = document.getElementById('improvementsMemberFilter')?.value || 'all';
  const list = getFilteredImprovements().filter(i => memberFilter === 'all' || i.author === memberFilter);
  const v = id => document.getElementById(id)?.value || '';
  const filtered = !!(v('improvementsSearch').trim() || v('improvementsClientFilter') !== 'all' && v('improvementsClientFilter') || memberFilter !== 'all' || v('improvementsInclFilter') !== 'all' && v('improvementsInclFilter') || v('improvementsFromDate') || v('improvementsToDate'));
  const countEl = document.getElementById('improvementsFilterCount');
  if(countEl) countEl.textContent = filtered ? `${list.length} of ${all.length}` : `${all.length} improvement${all.length === 1 ? '' : 's'}`;
  const del = document.getElementById('impDeleteAll'); if(del) del.style.display = filtered && list.length && canApprove() ? '' : 'none';
  if(!all.length){ el.innerHTML = '<div class="empty"><b>Nothing logged yet</b>Improvements the team logs show up here.</div>'; return; }
  if(!list.length){ el.innerHTML = '<div class="empty">Nothing matches. Try a wider date range or clear a filter.</div>'; return; }
  const groups = new Map();
  list.forEach(i => { if(!groups.has(i.clientId)) groups.set(i.clientId, []); groups.get(i.clientId).push(i); });
  const ordered = [...groups.entries()].sort((a, b) => new Date(b[1][0].date || 0) - new Date(a[1][0].date || 0));
  const SRC = typeof IMPROVEMENT_SOURCE_LABEL !== 'undefined' ? IMPROVEMENT_SOURCE_LABEL : {};
  el.innerHTML = ordered.slice(0, impShown).map(([cid, imps]) => {
    const c = clients.find(x => x.id === cid) || { id: cid, name: imps[0].clientName };
    return `<div class="h2"><h2><button class="link-row" onclick="openClientDetail('${cid}')">${monoHtml(c)}${escapeHtml(c.name)}</button><span class="c">${imps.length}</span></h2>${c.service ? `<span class="t-2" style="font-size:12px">${escapeHtml(c.service)}</span>` : ''}</div>
<div class="grp">${imps.map(i => `<div class="row sm"><span style="width:52px;flex:0 0 auto;font-size:12px;color:var(--label-2)">${i.date ? fmtShortDate(new Date(i.date)) : ''}</span>
<div class="tx"><span class="t" style="font-weight:400">${escapeHtml(i.text)}</span><span class="s">${escapeHtml(i.author)}${i.source && i.source !== 'manual' ? ' · ' + escapeHtml(SRC[i.source] || i.source) : ''}</span></div>
<div class="r"><button class="ck${i.includeInEmail ? ' on' : ''}" role="checkbox" aria-checked="${i.includeInEmail}" aria-label="In the client email" onclick="toggleImprovementIncludeInEmail('${i.clientId}','${i.id}',${!i.includeInEmail})">${i.includeInEmail ? icon('check', { weight: 'bold' }) : ''}</button><span style="width:70px">${i.includeInEmail ? 'In the email' : 'Left out'}</span></div></div>`).join('')}</div>`;
  }).join('') + (ordered.length > impShown ? `<div style="margin-top:14px"><button class="btn btn-q" onclick="impShown+=12;renderImprovementsHistory()">Show More Clients</button></div>` : '');
}
function populateImprovementsClientFilter(){
  const sel = document.getElementById('improvementsClientFilter'); if(!sel) return;
  const cur = sel.value || 'all';
  sel.innerHTML = '<option value="all">All</option>' + activeClients().sort((a, b) => a.name.localeCompare(b.name)).map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  if([...sel.options].some(o => o.value === cur)) sel.value = cur;
}

function switchTaskArchiveScope(scope){
  if(scope === 'team' && !canApprove()) scope = 'mine';
  taskArchiveScope = scope;
  document.querySelectorAll('#taskArchiveScopeTabs button').forEach(b => { const on = b.dataset.scope === scope; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  const mw = document.getElementById('taskArchiveMemberFilterWrap'); if(mw) mw.style.display = scope === 'team' ? '' : 'none';
  renderTaskArchive();
}
function renderTaskArchive(){
  const body = document.getElementById('taskArchiveTableBody');
  if(!body) return;
  const tt = document.getElementById('taskArchiveTeamScopeTab'); if(tt) tt.style.display = canApprove() ? '' : 'none';
  const v = id => document.getElementById(id)?.value || '';
  const search = v('taskArchiveSearch').toLowerCase().trim(), client = v('taskArchiveClientFilter') || 'all', member = v('taskArchiveMemberFilter') || 'all', from = v('taskArchiveFromDate'), to = v('taskArchiveToDate');
  let rows = tasks.filter(t => t.status === 'done');
  if(taskArchiveScope === 'mine') rows = rows.filter(t => t.assigneeId === currentUser.id || t.assignerId === currentUser.id);
  else if(member !== 'all') rows = rows.filter(t => t.assigneeId === member || t.assignerId === member);
  if(client !== 'all') rows = rows.filter(t => t.clientId === client);
  if(search) rows = rows.filter(t => t.title.toLowerCase().includes(search));
  if(from) rows = rows.filter(t => t.completedAt && t.completedAt.slice(0, 10) >= from);
  if(to) rows = rows.filter(t => t.completedAt && t.completedAt.slice(0, 10) <= to);
  rows.sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0));
  const cnt = document.getElementById('taskArchiveCount'); if(cnt) cnt.textContent = `${rows.length} finished`;
  if(!rows.length){ body.innerHTML = '<tr><td colspan="5"><div class="empty">No finished tasks match.</div></td></tr>'; return; }
  const person = id => { const p = teamProfiles.find(x => x.id === id); return p ? `<span style="display:inline-flex;align-items:center;gap:6px">${avHtml(p.name)}${escapeHtml(firstName(p.name))}${p.id === currentUser.id ? ' (you)' : ''}</span>` : '<span class="t-2">—</span>'; };
  body.innerHTML = rows.map(t => {
    const c = clients.find(x => x.id === t.clientId);
    return `<tr><td style="white-space:normal"><button class="link-row" onclick="openTaskDetailModal('${t.id}')"><span class="ok-ic" style="width:16px;height:16px">${icon('circle-check')}</span>${escapeHtml(t.title)}${t.completionNotes || t.completionLink ? `<span class="ic sm" title="Has notes">${icon('notepad')}</span>` : ''}</button></td>
<td>${c ? `<span class="cell-c">${monoHtml(c)}${escapeHtml(c.name)}</span>` : '<span class="t-2">—</span>'}</td><td>${person(t.assigneeId)}</td><td>${person(t.assignerId)}</td><td class="t-2">${t.completedAt ? fmtShortDate(new Date(t.completedAt)) : '—'}</td></tr>`;
  }).join('');
}
