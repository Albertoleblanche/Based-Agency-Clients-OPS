// Focus Reports, as on the canvas: past weekly briefs on the left, the selected one on the right.
// Reports are made by the weekly job (lib/proactive-insights.js) and stored in weekly_focus_reports.

let focusSelId = null, focusRange = '3m';
const FOCUS_RANGES = [['3m', 'Last 3 months', 92], ['6m', 'Last 6 months', 183], ['1y', 'Last year', 366], ['all', 'All reports', 0]];

async function renderFocusReportsPage(){
  const root = document.getElementById('focusRoot');
  if(!root) return;
  if(!root.dataset.ready) root.innerHTML = `<section class="list" aria-label="Past focus reports"><div class="list-h">${focusRangePop()}</div><div class="empty">Loading…</div></section><section class="detail"></section>`;
  const days = FOCUS_RANGES.find(r => r[0] === focusRange)[2];
  let q = supabaseClient.from('weekly_focus_reports').select('id, generated_at, data').order('generated_at', { ascending: false });
  if(days) q = q.gte('generated_at', addDays(rNow(), -days).toISOString());
  const { data, error } = await q;
  if(!document.getElementById('focusRoot')) return;
  if(error){ root.innerHTML = `<section class="list"><div class="list-h">${focusRangePop()}</div><div class="empty">Couldn't load past reports. Try again.</div></section><section class="detail"></section>`; return; }
  focusReportsCache = (data || []).slice().sort((a, b) => new Date(b.generated_at) - new Date(a.generated_at));
  if(!focusReportsCache.some(r => r.id === focusSelId)) focusSelId = focusReportsCache[0]?.id || null;
  root.dataset.ready = '1';
  drawFocusReports();
}
function focusRangePop(){
  const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][settings.proactiveInsightsDayOfWeek ?? 3];
  return `<label class="pop pop-sel"><span>${FOCUS_RANGES.find(r => r[0] === focusRange)[1]}</span>${icon('caret-up-down', { weight: 'bold' })}<select aria-label="Show reports from" onchange="focusRange=this.value;renderFocusReportsPage()">${FOCUS_RANGES.map(([k, t]) => `<option value="${k}" ${k === focusRange ? 'selected' : ''}>${t}</option>`).join('')}</select></label><span class="t-2" style="font-size:12px;margin-left:auto">Every ${day}</span>`;
}
function selectFocusReport(id){ focusSelId = id; drawFocusReports(); }
function focusCounts(d){
  const a = (d.attentionClients || []).length, p = (d.pendingDrafts || []).length;
  const parts = [];
  if(a) parts.push(`${a} need${a === 1 ? 's' : ''} attention`);
  if(p) parts.push(`${p} pending draft${p === 1 ? '' : 's'}`);
  return parts.length ? parts.join(' · ') : 'Nothing needed attention';
}
// How many clients got last week's update on time, as of a report's date.
function onTimeBefore(when){
  const cyc = updateCycle(addDays(new Date(when), -7)), due = cyc.send, from = addDays(due, -7);
  const act = activeClients();
  const ok = act.filter(c => sentTimes(c).some(t => t > from && t <= due)).length;
  return { ok, of: act.length };
}
function focusOpenDraft(id){
  const c = clients.find(x => x.id === id), d = (c?.drafts || []).find(x => x.draftStatus === 'pending');
  d ? openReviewDraft(id, d.author) : switchView('teamqueue');
}
function focusRow(c, why, right, onclick){
  return `<a class="row" href="#" onclick="${onclick};return false;">${c ? monoHtml(c) : '<span class="mono" aria-hidden="true">?</span>'}<div class="tx"><span class="t">${escapeHtml(c?.name || 'Client removed')}</span><span class="s">${why}</span></div><div class="r">${right}${icon('caret-right', { cls: 'go', weight: 'bold' })}</div></a>`;
}

function drawFocusReports(){
  const root = document.getElementById('focusRoot');
  if(!root) return;
  const items = focusReportsCache.map((r, i) => {
    const g = new Date(r.generated_at), on = r.id === focusSelId;
    return `<a class="msg${on ? ' sel' : ''}" href="#focusreports" onclick="selectFocusReport('${r.id}');return false;"${on ? ' aria-current="true"' : ''}><div class="top"><b>Week of ${g.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</b><time>${i === 0 ? 'Latest' : g.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</time></div><span class="pv">${focusCounts(r.data || {})}</span></a>`;
  }).join('');
  const list = `<section class="list" aria-label="Past focus reports"><div class="list-h">${focusRangePop()}</div><div style="padding:6px 0">${items || '<div class="empty">No reports in this range yet.</div>'}</div></section>`;
  const r = focusReportsCache.find(x => x.id === focusSelId);
  root.innerHTML = list + `<section class="detail" aria-label="Focus report">${r ? focusDocHtml(r) : '<div class="empty">The first report arrives after the next weekly run.</div>'}</section>`;
}

function focusDocHtml(r){
  const d = r.data || {}, g = new Date(r.generated_at);
  const attn = d.attentionClients || [], overdue = d.overdueFollowUps || [], stale = d.staleClients || [], drafts = d.pendingDrafts || [], ai = d.aiFindings || [];
  const ot = onTimeBefore(g);
  const fc = id => clients.find(x => x.id === id);
  const owner = c => { const o = c ? clientOwner(c) : ''; return o ? ' · ' + escapeHtml(o) : ''; };
  const sec = (title, rows) => rows.length ? `<h3>${title}</h3><div class="grp">${rows.join('')}</div>` : '';
  const attnRows = attn.map(x => {
    const c = fc(x.id) || { id: x.id, name: x.name };
    const why = [x.daysSinceImprovement == null ? 'Nothing logged yet' : `No update in ${x.daysSinceImprovement} days`, `risk ${x.danger} of 5`].join(' · ') + owner(fc(x.id));
    const st = x.danger >= 5 ? '<span class="hstate r"><span class="dot red"></span>At risk</span>' : '<span class="hstate y"><span class="dot yellow"></span>Watch</span>';
    return focusRow(c, why, st, `openHealthClient('${x.id}')`);
  });
  const odRows = overdue.map(f => {
    const c = fc(f.clientId) || { id: f.clientId, name: f.clientName };
    // said as of the report's own date
    const due = new Date(f.followUpDate + 'T12:00:00'), late = daysBetween(due, g);
    const when = late <= 0 ? 'Due today' : late === 1 ? 'Due yesterday' : `${late} days overdue`;
    return focusRow(c, escapeHtml(f.question || 'Follow-up'), `<span class="t-red">${when}</span>`, `switchView('reminders')`);
  });
  const quietRows = stale.map(x => {
    const c = fc(x.id) || { id: x.id, name: x.name };
    const since = x.daysSinceImprovement == null ? 'Never' : 'Since ' + addDays(g, -x.daysSinceImprovement).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return focusRow(c, (x.daysSinceImprovement == null ? 'Nothing logged yet' : `Nothing logged in ${x.daysSinceImprovement} days`) + owner(fc(x.id)), `<span>${since}</span>`, `openClientDetail('${x.id}')`);
  });
  const draftRows = drafts.map(x => {
    const c = fc(x.id) || { id: x.id, name: x.name }, cur = (fc(x.id)?.drafts || []).find(dd => dd.draftStatus === 'pending');
    return focusRow(c, cur?.author ? `Drafted by ${escapeHtml(cur.author)}` : 'Draft waiting for review', '<span class="st"><span class="dot blue"></span>Draft ready</span>', `focusOpenDraft('${x.id}')`);
  });
  const aiHtml = ai.length ? `<h3>From the Assistant</h3>${ai.map(f => `<div class="callout" style="margin-bottom:8px"><span class="ic">${icon('sparkle')}</span><div>${f.title ? `<b style="font-weight:600">${escapeHtml(f.title)}.</b> ` : ''}${escapeHtml(f.body || '')}</div></div>`).join('')}` : '';
  const nothing = !attn.length && !overdue.length && !stale.length && !drafts.length && !ai.length ? '<p class="t-2" style="font-size:13px;margin-top:22px">Nothing needed the team this week.</p>' : '';
  const n = d.clientCount || activeClients().length;
  return `<div class="doc">
<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:18px">
<span class="t-2" style="font-size:12px">Sent to the team ${g.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })} at ${fmtTime(g)}</span><span style="margin-left:auto"></span>
<button class="btn" onclick="downloadFocusReport('${r.id}')">${icon('download-simple')}Download</button><button class="btn" onclick="emailFocusReportToTeam('${r.id}')">${icon('envelope-simple')}Email Team</button></div>
<h1 class="lt">${r.id === focusReportsCache[0]?.id ? 'This week’s focus' : 'Focus for the week'}</h1>
<p class="lt-sub">Week of ${g.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} · ${n} clients</p>
<div class="grp glance" style="margin-top:18px">
<div><b class="${attn.length ? 't-red' : ''}">${attn.length}</b><span>Need attention</span></div><div><b>${overdue.length}</b><span>Overdue follow-up${overdue.length === 1 ? '' : 's'}</span></div><div><b>${ot.ok} of ${ot.of}</b><span>On time last week</span></div><div><b>${drafts.length}</b><span>Pending draft${drafts.length === 1 ? '' : 's'}</span></div></div>
${sec('Need attention', attnRows)}${sec('Overdue follow-up' + (overdue.length === 1 ? '' : 's'), odRows)}${sec('Gone quiet', quietRows)}${sec('Pending drafts', draftRows)}${aiHtml}${nothing}
${(d.errors || []).length ? `<p class="t-2" style="font-size:12px;margin-top:18px">${d.errors.length} check${d.errors.length === 1 ? '' : 's'} could not run when this report was made.</p>` : ''}
</div>`;
}

// Notifications and the Today banner open the report here rather than in a pop-up.
function openWeeklyFocusReportModal(reportId){
  if(reportId) focusSelId = reportId;
  switchView('focusreports');
}
