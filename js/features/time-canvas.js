// Time, as on the canvas: Timesheet, Reports, Daily Summary and Payroll, switched from the toolbar.
// The data functions in time-tracker.js, reports.js, daily-summary.js and payroll.js are reused;
// this file only draws the screens.

let timeTab = 'timesheet';
const TIME_TABS = [['timesheet', 'Timesheet'], ['reports', 'Reports'], ['dailysummary', 'Daily Summary'], ['payroll', 'Payroll']];

function timeToolbarTabsHtml(){
  const tabs = TIME_TABS.filter(([k]) => k !== 'payroll' || isAdmin());
  return `<div class="seg" role="tablist" aria-label="Time views">${tabs.map(([k, t]) => `<button class="${timeTab === k ? 'on' : ''}" role="tab" aria-selected="${timeTab === k}" onclick="switchTimeTab('${k}')">${t}</button>`).join('')}</div>`;
}
function switchTimeTab(name){
  if(name === 'payroll' && !isAdmin()) name = 'timesheet';
  timeTab = name;
  document.querySelectorAll('#view-time > .tview').forEach(v => { v.hidden = v.id !== 'timeRoot-' + name; });
  if(currentViewName === 'time') setToolbarActions('time');
  renderTimeView();
}
function renderTimeView(){
  if(timeTab === 'payroll' && !isAdmin()) timeTab = 'timesheet';
  document.querySelectorAll('#view-time > .tview').forEach(v => { v.hidden = v.id !== 'timeRoot-' + timeTab; });
  if(timeTab === 'timesheet') renderTimesheet();
  else if(timeTab === 'reports') renderReports();
  else if(timeTab === 'dailysummary') loadDailySummary();
  else if(timeTab === 'payroll') renderPayroll();
}
function timeTitle(sub){ if(currentViewName === 'time') setToolbar('Time', sub); }

// A native <select> under a pop button, so the button reads like the canvas ("Client ⌄").
function syncPopSel(sel){ const l = sel.parentElement.querySelector('.pl') || sel.parentElement.querySelector('span'); if(l) l.textContent = sel.options[sel.selectedIndex]?.text || ''; }

// ---- small formatters ----------------------------------------------------------------------
function hmm(min){ min = Math.max(0, Math.round(min || 0)); return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`; }
function hmLong(min){ min = Math.max(0, Math.round(min || 0)); const h = Math.floor(min / 60), m = min % 60; return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`; }
function hrs(min){ const h = (min || 0) / 60; return `${+(h >= 10 ? h.toFixed(0) : h.toFixed(1))}h`; }
function money(n){ return '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function dayLabel(dStr){
  const d = new Date(dStr + 'T12:00:00'), t = dayStart(rNow()), diff = Math.round((dayStart(d) - t) / 86400000);
  if(diff === 0) return 'Today';
  if(diff === -1) return 'Yesterday';
  if(diff > -7) return d.toLocaleDateString('en-US', { weekday: 'long' });
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
function weeklyHoursTarget(){ return parseFloat(settings.overtimeThresholdHours) || 40; }

// ================================================================ Timesheet
let tsDays = 14;
let timerPaused = (() => { try{ return JSON.parse(localStorage.getItem('bda_timer_paused') || 'null'); }catch(e){ return null; } })();
function savePaused(){ try{ timerPaused ? localStorage.setItem('bda_timer_paused', JSON.stringify(timerPaused)) : localStorage.removeItem('bda_timer_paused'); }catch(e){} }

function runningMinutes(){ return timerState.running ? (Date.now() - timerState.startedAt) / 60000 : 0; }
function clockText(){
  if(!timerState.running) return '0:00:00';
  const s = Math.max(0, Math.floor((Date.now() - timerState.startedAt) / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function tickTimesheetClock(){
  const c = document.getElementById('tsClock'); if(c) c.textContent = clockText();
  const r = document.getElementById('tsRunDur'); if(r) r.textContent = hmm(runningMinutes());
}
function startTimerInterval(){ if(timerIntervalId) clearInterval(timerIntervalId); timerIntervalId = setInterval(updateTimerDisplay, 1000); updateTimerDisplay(); }

async function startTimerFromRow(){
  const clientId = document.getElementById('tsClient')?.value;
  const description = (document.getElementById('tsDesc')?.value || '').trim();
  if(!clientId){ showToast('error', 'Pick a client', "Choose the client you're working on."); document.getElementById('tsClient')?.focus(); return; }
  if(typeof isClientPaused === 'function' && isClientPaused(clientId)){ showPausedClientWarning(clientId); return; }
  if(timerState.running) await stopAndSaveTimer();
  const c = clients.find(x => x.id === clientId);
  timerState = { running: true, startedAt: Date.now(), clientId, service: c?.service || '', description, resumeEntryId: null };
  saveTimerState(); startTimerInterval();
  timerPaused = null; savePaused();
  renderTimesheet();
}
async function pauseTimer(){
  if(!timerState.running) return;
  const snap = { clientId: timerState.clientId, service: timerState.service, description: timerState.description };
  const id = await stopAndSaveTimer({ pause: true });
  timerPaused = id ? Object.assign(snap, { entryId: id }) : null; savePaused();
  renderTimesheet();
}
async function stopTimerNow(){ await stopAndSaveTimer(); timerPaused = null; savePaused(); renderTimesheet(); }
function resumePausedTimer(){
  if(!timerPaused) return;
  const p = timerPaused; timerPaused = null; savePaused();
  resumeEntryTimer(p.clientId, p.description, p.entryId);
  renderTimesheet();
}
function finishPausedTimer(){ timerPaused = null; savePaused(); renderTimesheet(); }
async function continueEntry(btn){
  if(timerState.running) await stopAndSaveTimer();
  timerPaused = null; savePaused();
  resumeEntryTimerFromBtn(btn);
  renderTimesheet();
}

function tsRowHtml(e){
  const c = clients.find(x => x.id === e.clientId);
  const sub = [c ? c.name : 'Client removed', e.service].filter(Boolean).map(escapeHtml).join(' · ');
  const sync = e.harvestStatus === 'error' ? `<span class="st t-red" title="Will retry when you edit the entry">${icon('warning')}Harvest sync failed</span>`
    : e.harvestId ? `<span class="st" title="Synced to Harvest"><span class="ic sm" style="color:var(--label-3)">${icon('check', { weight: 'bold' })}</span>Harvest</span>` : '';
  return `<div class="row sm ts-row" role="button" tabindex="0" onclick="openTimeEntryModal('${e.id}')" onkeydown="if(event.key==='Enter')openTimeEntryModal('${e.id}')">
<div class="tx"><span class="t" style="font-weight:400">${escapeHtml(e.description || 'No description')}</span><span class="s">${sub}</span></div>
<div class="r">${sync}<button class="ib act" aria-label="Continue this" title="Continue this" data-resume-client="${e.clientId}" data-resume-desc="${encodeURIComponent(e.description || '')}" data-resume-entry="${e.id}" onclick="event.stopPropagation();continueEntry(this)">${icon('play')}</button><span class="dur" style="width:56px;text-align:right">${hmm(e.minutes)}</span></div></div>`;
}

function renderTimesheet(){
  const root = document.getElementById('timeRoot-timesheet');
  if(!root) return;
  if(timeTab === 'timesheet') timeTitle(rNow().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }));
  const now = rNow(), today = toDateStr(now), running = timerState.running;
  const mine = myOwnTimeEntries();
  const tc = running ? clients.find(x => x.id === timerState.clientId) : null;
  const svc = running ? (timerState.service || tc?.service || '') : '';

  let card = '';
  if(running){
    card = `<section class="timer" aria-label="Running timer">
<span class="dot red" style="width:10px;height:10px;box-shadow:0 0 0 4px var(--red-soft)"></span>
<div class="tx"><b>${escapeHtml(timerState.description || 'No description')}</b><span>${[tc?.name, svc].filter(Boolean).map(escapeHtml).join(' · ')} · started ${fmtTime(new Date(timerState.startedAt))}</span></div>
<span class="clock" id="tsClock">${clockText()}</span>
<button class="btn" onclick="pauseTimer()">${icon('pause', { fill: true })}Pause</button>
<button class="btn" style="color:var(--red)" onclick="stopTimerNow()">${icon('stop', { fill: true })}Stop</button>
</section>`;
  } else if(timerPaused){
    const pc = clients.find(x => x.id === timerPaused.clientId), pe = timeEntries.find(x => x.id === timerPaused.entryId);
    card = `<section class="timer" aria-label="Paused timer">
<span class="dot" style="width:10px;height:10px;background:var(--label-3)"></span>
<div class="tx"><b>${escapeHtml(timerPaused.description || 'No description')}</b><span>${escapeHtml(pc?.name || '')} · paused</span></div>
<span class="clock" style="color:var(--label-2)">${pe ? hmm(pe.minutes) + ':00' : '0:00:00'}</span>
<button class="btn" onclick="resumePausedTimer()">${icon('play', { fill: true })}Resume</button>
<button class="btn" onclick="finishPausedTimer()">Done</button>
</section>`;
  }
  const opts = activeClients().slice().sort((a, b) => a.name.localeCompare(b.name)).map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  const prevClient = document.getElementById('tsClient')?.value || '', prevDesc = document.getElementById('tsDesc')?.value || '';
  const newRow = `<div class="grp ts-new"${card ? ' style="margin-top:12px"' : ''}>
<label class="pop pop-sel"><span id="tsClientLabel">Client</span>${icon('caret-up-down', { weight: 'bold' })}<select id="tsClient" aria-label="Client" onchange="syncPopSel(this)"><option value="">Client</option>${opts}</select></label>
<input class="tf" id="tsDesc" placeholder="What are you working on?" aria-label="What are you working on?" onkeydown="if(event.key==='Enter')startTimerFromRow()">
<button class="btn" onclick="startTimerFromRow()">${icon('play', { fill: true })}Start</button></div>`;

  // days, newest first: today always, then any day in the window with time on it
  const since = toDateStr(addDays(dayStart(now), -(tsDays - 1)));
  const byDay = {};
  mine.forEach(e => { if(e.date >= since && e.date <= today) (byDay[e.date] = byDay[e.date] || []).push(e); });
  const days = Object.keys(byDay); if(!days.includes(today)) days.push(today);
  days.sort().reverse();
  const groups = days.map((d, i) => {
    const list = (byDay[d] || []).slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const isToday = d === today, total = list.reduce((s, e) => s + e.minutes, 0) + (isToday ? runningMinutes() : 0);
    const runRow = isToday && running ? `<div class="row sm"><div class="tx"><span class="t" style="font-weight:400">${escapeHtml(timerState.description || 'No description')}</span><span class="s">${[tc?.name, svc].filter(Boolean).map(escapeHtml).join(' · ')}</span></div><div class="r"><span class="st" style="color:var(--red)"><span class="dot red"></span>Running</span><span class="dur" id="tsRunDur" style="width:56px;text-align:right">${hmm(runningMinutes())}</span></div></div>` : '';
    const rows = runRow + list.map(tsRowHtml).join('');
    return `<div class="h2"><h2>${dayLabel(d)}<span class="c">${hmLong(total)}</span></h2>${i === 0 ? `<a href="#" onclick="event.preventDefault();openManualEntryModal()">Add time manually</a>` : ''}</div>
<div class="grp">${rows || `<div class="row sm"><span class="t-2" style="font-size:13px">Nothing logged yet today.</span></div>`}</div>`;
  }).join('');
  const older = mine.some(e => e.date < since);
  const more = older ? `<div style="margin-top:14px"><button class="btn btn-q" onclick="tsDays+=14;renderTimesheet()">Show Earlier</button></div>` : '';

  // this week, Mon–Fri (and the weekend when there is time on it)
  const wk0 = addDays(dayStart(now), -((now.getDay() + 6) % 7));
  const week = Array.from({ length: 7 }, (_, i) => { const d = addDays(wk0, i), k = toDateStr(d); return { d, k, min: mine.filter(e => e.date === k).reduce((s, e) => s + e.minutes, 0) + (k === today ? runningMinutes() : 0) }; })
    .filter((x, i) => i < 5 || x.min > 0);
  const weekTotal = week.reduce((s, x) => s + x.min, 0);
  const bars = week.map(x => `<div style="display:flex;flex-direction:column;align-items:center;gap:6px;flex:1">
<div style="height:96px;width:100%;display:flex;align-items:flex-end;justify-content:center"><i title="${hmLong(x.min)}" style="display:block;width:26px;border-radius:5px;height:${Math.max(Math.min(x.min / 60 / 8, 1) * 96, 3).toFixed(0)}px;background:${x.k === today ? 'var(--accent-fill)' : 'var(--label-2)'};opacity:${x.min ? 1 : .35}"></i></div>
<span style="font-size:11px;color:var(--label-2)">${x.d.toLocaleDateString('en-US', { weekday: 'short' })}</span></div>`).join('');

  const budgets = activeClients().filter(c => c.monthlyHourBudget > 0).map(c => ({ c, used: monthHours(c), b: c.monthlyHourBudget }))
    .map(x => Object.assign(x, { pct: x.used / x.b })).sort((a, b) => b.pct - a.pct).slice(0, 7);
  const brows = budgets.map(({ c, used, b, pct }) => {
    const col = pct > 1 ? 'var(--red)' : (pct >= .9 ? 'var(--yellow)' : 'var(--label-2)');
    return `<div style="display:flex;flex-direction:column;gap:5px;padding:7px 0">
<div style="display:flex;justify-content:space-between;font-size:12px"><span>${escapeHtml(c.name)}</span><span><b class="${pct > 1 ? 't-red' : ''}" style="font-weight:600">${Math.round(used)}</b><span class="t-2"> / ${b} h</span></span></div>
<div class="bar"><i style="width:${Math.min(pct, 1) * 100}%;background:${col}"></i></div></div>`;
  }).join('') || '<p class="t-2" style="font-size:12px;margin:0">No hour budgets set. Add one on a client.</p>';

  const keepFocus = document.activeElement && document.activeElement.id;
  root.innerHTML = `<div class="cols"><div class="col-main">${card}${newRow}${groups}${more}</div>
<aside class="col-side">
<section class="panel"><h3>This week<span>${hmLong(weekTotal)} of ${weeklyHoursTarget()}h</span></h3><div style="display:flex;gap:6px;margin-top:4px">${bars}</div></section>
<section class="panel"><h3>Hour budgets<span>${now.toLocaleDateString('en-US', { month: 'long' })}</span></h3>${brows}</section>
</aside></div>`;
  const sel = document.getElementById('tsClient'); if(sel && prevClient){ sel.value = prevClient; syncPopSel(sel); }
  const inp = document.getElementById('tsDesc'); if(inp) inp.value = prevDesc;
  if(keepFocus === 'tsDesc' || keepFocus === 'tsClient') document.getElementById(keepFocus)?.focus();
}

// ================================================================ Reports
let reportShowAll = false;
const reportExcluded = new Set();
function reportRangeOptions(){
  const now = rNow(), fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const wk = getWeekStart(now), m0 = new Date(now.getFullYear(), now.getMonth(), 1);
  const span = (a) => toDateStr(a) === toDateStr(now) ? fmt(now) : `${fmt(a)} – ${now.getMonth() === a.getMonth() ? now.getDate() : fmt(now)}`;
  return [['week', `This week · ${span(wk)}`], ['month', `This month · ${span(m0)}`], ['all', 'All time'], ['custom', 'Custom range…']];
}
function populateReportMemberFilter(){
  const sel = document.getElementById('reportMemberFilter');
  if(!sel) return;
  const cur = sel.value || 'all';
  sel.innerHTML = `<option value="all">Everyone</option>` + [...teamProfiles].sort((a, b) => a.name.localeCompare(b.name)).map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  if([...sel.options].some(o => o.value === cur)) sel.value = cur;
}
function switchReportTab(name){ reportTab = name; reportsPage = 1; reportShowAll = false; renderReports(); }
function setReportChartGranularity(g){ reportChartGranularity = g; renderReports(); }
function toggleReportRow(id){ reportExcluded.has(id) ? reportExcluded.delete(id) : reportExcluded.add(id); renderReports(); }
function toggleReportAll(){ const ids = [...document.querySelectorAll('#reportTableGrp [data-rid]')].map(x => x.dataset.rid); const allOn = ids.every(id => !reportExcluded.has(id)); ids.forEach(id => allOn ? reportExcluded.add(id) : reportExcluded.delete(id)); renderReports(); }
// Export what is ticked (everything, unless rows were unticked).
getReportExportRows = (function(base){
  return function(){
    if(reportTab !== 'clients' || !reportExcluded.size) return base();
    const names = new Set(clients.filter(c => reportExcluded.has(c.id)).map(c => c.name));
    return base().filter(r => !names.has(r.label));
  };
})(getReportExportRows);
function ckHtml(on, label, onclick){ return `<button class="ck${on ? ' on' : ''}" role="checkbox" aria-checked="${on}" aria-label="${escapeHtml(label)}" onclick="${onclick}">${on ? icon('check', { weight: 'bold' }) : ''}</button>`; }

function renderReports(){
  const root = document.getElementById('timeRoot-reports');
  if(!root) return;
  if(timeTab === 'reports') timeTitle('Reports');
  const rangeSel = document.getElementById('reportRange');
  if(rangeSel){ const v = rangeSel.value || 'month'; rangeSel.innerHTML = reportRangeOptions().map(([k, t]) => `<option value="${k}">${t}</option>`).join(''); rangeSel.value = v; }
  const range = rangeSel?.value || 'month';
  const cr = document.getElementById('reportCustomRange'); if(cr) cr.style.display = range === 'custom' ? 'inline-flex' : 'none';
  const mw = document.getElementById('reportMemberFilterWrap'); if(mw) mw.style.display = isAdmin() ? '' : 'none';
  const relevant = getReportRangeEntries();
  const { start, end } = getReportDateBounds();
  const now = rNow();

  // Hours over time — across the range picked above
  const g = reportChartGranularity;
  let from = start;
  if(range === 'all'){ const first = relevant.reduce((m, e) => e.date < m ? e.date : m, toDateStr(now)); from = new Date(first + 'T00:00:00'); }
  const to = end && end < now ? end : now;
  const buckets = fillBucketsWithEntries(buildBucketsInRange(from, to, g, g === 'day' ? 31 : g === 'week' ? 26 : 24), relevant, g);
  const maxMin = Math.max(1, ...buckets.map(b => b.minutes));
  const curKey = bucketKeyFor(now, g);
  const total = relevant.reduce((s, e) => s + e.minutes, 0);
  const bars = buckets.map(b => `<div title="${escapeHtml(b.label)} · ${hmLong(b.minutes)}"><i class="${b.key === curKey ? 'cur' : ''}" style="height:${Math.max(b.minutes / maxMin * 100, 1.5).toFixed(1)}%;max-width:34px;${b.minutes ? '' : 'opacity:.35'}"></i></div>`).join('');
  const xs = buckets.map((b, i) => `<span>${b.key === curKey ? (g === 'day' ? 'Today' : b.label) : (g !== 'day' || i % 7 === 0 ? b.label : '')}</span>`).join('');
  const busiest = buckets.reduce((m, b) => b.minutes > (m?.minutes || 0) ? b : m, null);
  const busyWord = { day: 'day', week: 'week', month: 'month' }[g];
  const busyLabel = busiest ? (g === 'day' ? busiest.sortDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : g === 'week' ? 'week of ' + busiest.label : busiest.sortDate.toLocaleDateString('en-US', { month: 'long' })) : '';
  const rangeWord = { week: 'this week', month: 'this month', all: 'all time', custom: 'in this range' }[range];
  const gseg = `<div class="seg" role="tablist" aria-label="Granularity">${['day', 'week', 'month'].map(k => `<button class="${g === k ? 'on' : ''}" role="tab" aria-selected="${g === k}" onclick="setReportChartGranularity('${k}')">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>`;
  document.getElementById('reportChartPanel').innerHTML = `<h3>Hours over time<span>${gseg}</span></h3>
<div style="display:flex;flex-wrap:wrap;gap:4px 28px;align-items:baseline;margin:2px 0 14px"><div><b style="font-size:22px;font-weight:600;letter-spacing:-.02em" class="dur">${hrs(total)}</b> <span class="t-2" style="font-size:12px">${rangeWord}</span></div>${busiest ? `<div class="t-2" style="font-size:12px">Busiest ${busyWord}: ${busyLabel} · ${hrs(busiest.minutes)}</div>` : ''}</div>
<div class="chart" style="gap:6px">${bars}</div><div class="chart-x" style="gap:6px">${xs}</div>`;

  // By client / service / teammate
  const tabs = [['clients', 'Clients'], ['services', 'Services'], ['teammates', 'Teammates']].filter(([k]) => k !== 'teammates' || isAdmin());
  if(!tabs.some(([k]) => k === reportTab)) reportTab = 'clients';
  document.getElementById('reportGroupH').innerHTML = `<h2>By ${{ clients: 'client', services: 'service', teammates: 'teammate' }[reportTab]}</h2><div class="seg" role="tablist" aria-label="Group by">${tabs.map(([k, t]) => `<button class="${reportTab === k ? 'on' : ''}" role="tab" aria-selected="${reportTab === k}" onclick="switchReportTab('${k}')">${t}</button>`).join('')}</div>`;
  const grouped = {};
  relevant.forEach(e => {
    const c = clients.find(x => x.id === e.clientId);
    const key = reportTab === 'clients' ? e.clientId : reportTab === 'services' ? (e.service || c?.service || 'No service set') : e.userId;
    grouped[key] = (grouped[key] || 0) + e.minutes;
  });
  const rows = Object.entries(grouped).sort((a, b) => b[1] - a[1]);
  const grp = document.getElementById('reportTableGrp');
  if(!rows.length){ grp.innerHTML = `<div class="empty">No time logged ${rangeWord}.</div>`; return; }
  const shown = reportShowAll ? rows : rows.slice(0, 9), rest = rows.slice(shown.length);
  const restMin = rest.reduce((s, [, m]) => s + m, 0);
  const withBudget = reportTab === 'clients' && range === 'month';
  let head, body;
  if(reportTab === 'clients'){
    const allOn = rows.every(([id]) => !reportExcluded.has(id));
    head = `<th style="width:28px">${ckHtml(allOn, 'Select all', 'toggleReportAll()')}</th><th>Client</th><th class="num">Hours</th>${withBudget ? '<th class="num">Budget</th><th>Used</th><th class="num"></th>' : '<th>Share</th><th class="num"></th>'}`;
    body = shown.map(([id, m]) => {
      const c = clients.find(x => x.id === id), on = !reportExcluded.has(id);
      const b = c?.monthlyHourBudget || 0, pct = withBudget ? (b ? m / 60 / b : null) : m / total;
      const col = withBudget && pct > 1 ? 'var(--red)' : (withBudget && pct >= .9 ? 'var(--yellow)' : 'var(--label-2)');
      return `<tr data-rid="${id}"><td style="width:28px">${ckHtml(on, 'Include ' + (c?.name || 'client'), `toggleReportRow('${id}')`)}</td>
<td><button class="cell-c link-row" onclick="openClientReportDetail('${id}')">${c ? monoHtml(c) : ''}${escapeHtml(c?.name || 'Client removed')}</button></td>
<td class="num"><span class="${withBudget && pct > 1 ? 't-red' : ''}">${hrs(m)}</span></td>
${withBudget ? `<td class="num t-2">${b ? b + 'h' : '—'}</td>` : ''}
<td style="width:30%">${pct == null ? '' : `<div class="bar"><i style="width:${Math.min(pct, 1) * 100}%;background:${col}"></i></div>`}</td><td class="num t-2">${pct == null ? '' : Math.round(pct * 100) + '%'}</td></tr>`;
    }).join('');
  } else {
    head = `<th>${reportTab === 'services' ? 'Service' : 'Teammate'}</th><th class="num">Hours</th><th>Share</th><th class="num"></th>`;
    body = shown.map(([k, m]) => {
      const p = reportTab === 'teammates' ? teamProfiles.find(x => x.id === k) : null;
      const name = reportTab === 'teammates' ? `<span style="display:inline-flex;align-items:center;gap:8px">${avHtml(p?.name || '?')}${escapeHtml(p?.name || 'Former teammate')}</span>` : escapeHtml(k);
      return `<tr><td>${name}</td><td class="num">${hrs(m)}</td><td style="width:34%"><div class="bar"><i style="width:${m / total * 100}%"></i></div></td><td class="num t-2">${Math.round(m / total * 100)}%</td></tr>`;
    }).join('');
  }
  const cols = reportTab === 'clients' ? (withBudget ? 6 : 5) : 4;
  const restRow = rest.length ? `<tr><td colspan="${reportTab === 'clients' ? 2 : 1}"><button class="link-row t-2" onclick="reportShowAll=true;renderReports()">${rest.length} more ${reportTab === 'clients' ? (rest.length === 1 ? 'client' : 'clients') : reportTab === 'services' ? (rest.length === 1 ? 'service' : 'services') : (rest.length === 1 ? 'teammate' : 'teammates')}</button></td><td class="num t-2">${hrs(restMin)}</td><td colspan="${cols - (reportTab === 'clients' ? 3 : 2)}"></td></tr>` : '';
  grp.innerHTML = `<table class="mtx" aria-label="Hours ${rangeWord}"><thead><tr>${head}</tr></thead><tbody>${body}${restRow}</tbody>
<tfoot><tr>${reportTab === 'clients' ? '<td></td>' : ''}<td>Total</td><td class="num">${hrs(total)}</td><td colspan="${cols - (reportTab === 'clients' ? 3 : 2)}"></td></tr></tfoot></table>`;
}

// ================================================================ Daily Summary
dailySummaryDate = (() => { const d = dayStart(rNow()); do { d.setDate(d.getDate() - 1); } while([0, 6].includes(d.getDay())); return d; })();
function shiftDailySummaryDate(dir){
  const d = new Date(dailySummaryDate); d.setDate(d.getDate() + dir);
  if(d > rNow()) return;
  dailySummaryDate = d; loadDailySummary();
}
function dsHeaderHtml(sub){
  const isToday = toDateStr(dailySummaryDate) === toDateStr(rNow());
  return `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
<div class="tb-grp"><button class="ib" aria-label="Previous day" onclick="shiftDailySummaryDate(-1)">${icon('caret-left')}</button><button class="ib" aria-label="Next day" ${isToday ? 'disabled' : ''} onclick="shiftDailySummaryDate(1)">${icon('caret-right')}</button></div>
<h1 class="lt" style="font-size:22px">${dailySummaryDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</h1><span style="flex:1"></span>
<button class="btn" onclick="openSlackSummaryConfirm()">${icon('slack-logo')}Send to Slack…</button></div>
<p class="lt-sub">${sub}</p>`;
}
async function loadDailySummary(){
  const root = document.getElementById('timeRoot-dailysummary');
  if(!root) return;
  if(timeTab === 'dailysummary') timeTitle('Daily Summary');
  root.innerHTML = dsHeaderHtml('Loading…');
  try{
    const { data: { session } } = await supabaseClient.auth.getSession();
    const response = await fetch(`/api/get-daily-summary?date=${toDateStr(dailySummaryDate)}`, { headers: { 'Authorization': `Bearer ${session.access_token}` } });
    const data = await response.json();
    if(!response.ok){ root.innerHTML = dsHeaderHtml(escapeHtml(data.error || 'Could not load the summary.')); return; }
    lastDailySummaryData = data;
    renderDailySummaryList(data);
  }catch(e){
    root.innerHTML = dsHeaderHtml('Could not load the summary. Check your connection.');
  }
}
function renderDailySummaryList(data){
  const root = document.getElementById('timeRoot-dailysummary');
  if(!root) return;
  const dStr = data.date || toDateStr(dailySummaryDate), dayName = new Date(dStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });
  const people = (data.summary || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const impsBy = name => clients.reduce((s, c) => s + (c.improvements || []).filter(i => i.author === name && String(i.date || '').slice(0, 10) === dStr).length, 0);
  const total = people.reduce((s, p) => s + p.totalMinutes, 0), totalImps = people.reduce((s, p) => s + impsBy(p.name), 0);
  if(!people.length){
    root.innerHTML = dsHeaderHtml(canApprove() ? `Nobody logged time on ${dayName}.` : `You didn't log any time on ${dayName}.`);
    return;
  }
  const cards = people.map(person => {
    const prof = teamProfiles.find(p => p.id === person.userId);
    const slack = prof && (prof.daily_summary_slack_id || prof.slack_user_id);
    const ents = person.entries.slice().sort((a, b) => b.minutes - a.minutes), more = ents.length - 3;
    const st = slack ? `<span class="st"><span class="dot green"></span>Sends to ${escapeHtml(firstName(person.name))} in Slack</span>`
      : `<span class="st t-red"><span class="ic sm" style="color:var(--red)">${icon('warning', { fill: false })}</span>No Slack ID on file</span><button class="btn btn-q sm" onclick="event.stopPropagation();switchView('team')">Add in Team</button>`;
    const n = impsBy(person.name);
    return `<div class="grp og"><div class="og-h" role="button" tabindex="0" onclick="openDailySummaryDetail('${person.userId}')">${avHtml(person.name, 'style="width:28px;height:28px;font-size:11px"')}
<div class="tx"><b>${escapeHtml(person.name)}</b><span>${hmLong(person.totalMinutes)} logged · ${n} improvement${n === 1 ? '' : 's'} · ${ents.length} entr${ents.length === 1 ? 'y' : 'ies'}</span></div><div class="r">${st}</div></div>
${ents.slice(0, 3).map(e => `<div class="og-i" style="padding-left:52px"><div class="tx"><span>${escapeHtml(e.description || e.service || 'No description')}</span><span class="s">${escapeHtml(e.client)}</span></div><div class="r"><span class="dur">${hmm(e.minutes)}</span></div></div>`).join('')}
${more > 0 ? `<div class="og-i" style="padding-left:52px"><button class="link-row t-2" style="font-size:12px" onclick="openDailySummaryDetail('${person.userId}')">${more} more ${more === 1 ? 'entry' : 'entries'}</button></div>` : ''}</div>`;
  }).join('');
  const worked = new Set(people.flatMap(p => p.entries.map(e => e.client)));
  const act = activeClients();
  const untouched = act.filter(c => !worked.has(c.name)).map(c => c.name);
  const long = people.filter(p => p.totalMinutes > 9 * 60).map(p => p.name);
  root.innerHTML = dsHeaderHtml(`${hmLong(total)} logged by ${people.length} ${people.length === 1 ? 'person' : 'people'} · ${totalImps} improvement${totalImps === 1 ? '' : 's'} · each person gets their own summary`) +
`<div class="cols" style="margin-top:18px"><div class="col-main">${cards}</div>
<aside class="col-side">
<section class="panel"><h3>Team total<span>${dayName}</span></h3>
<div class="kv"><span>Hours logged</span><b style="font-weight:500" class="dur">${hmLong(total)}</b></div>
<div class="kv"><span>Improvements</span><b style="font-weight:500">${totalImps}</b></div>
<div class="kv"><span>Clients worked on</span><b style="font-weight:500">${act.filter(c => worked.has(c.name)).length} of ${act.length}</b></div>
<div class="kv"><span>Over 9 hours</span><b style="font-weight:500">${long.length ? long.map(escapeHtml).join(', ') : 'Nobody'}</b></div></section>
<section class="panel"><h3>Not touched ${dayName}</h3>
<p style="font-size:13px;margin:0;line-height:1.5">${untouched.length ? untouched.map(escapeHtml).join(' · ') : '<span class="t-2">Every client got time.</span>'}</p></section>
</aside></div>`;
}

// ================================================================ Payroll
(function(){ try{ const a = localStorage.getItem('bda_payroll_anchor'); if(a) payrollPeriodStart = new Date(a + 'T00:00:00'); }catch(e){} })();
function payrollCurrentStart(){
  // the 14-day period being paid now — the last one that has ended — keeping the anchor's rhythm
  const t = addDays(dayStart(rNow()), -14), a = dayStart(payrollPeriodStart);
  const k = Math.floor((t - a) / (14 * 86400000));
  return addDays(a, k * 14);
}
function setPayrollPeriodStart(val){
  if(!val) return;
  payrollPeriodStart = new Date(val + 'T00:00:00');
  try{ localStorage.setItem('bda_payroll_anchor', val); }catch(e){}
  renderPayrollView();
}
function choosePayrollPeriod(v){
  if(v === 'anchor') return openPayrollAnchorSheet();
  payrollPeriodStart = new Date(v + 'T00:00:00'); renderPayrollView();
}
function openPayrollAnchorSheet(){
  openAppModal(`<div class="modal-head"><span class="panel-title">Pay periods</span><span class="toast-close" onclick="closeAppModal()">✕</span></div>
<div class="modal-body"><p class="t-2" style="font-size:13px;margin:0 0 12px">Periods are 14 days. Pick the first day of any real pay period and the rest line up with it.</p>
<div class="f"><label for="payAnchor">First day</label><input type="date" class="tf" id="payAnchor" value="${toDateStr(payrollCurrentStart())}"></div></div>
<div class="modal-actions"><button class="btn" onclick="closeAppModal()">Cancel</button><button class="btn btn-p" onclick="setPayrollPeriodStart(document.getElementById('payAnchor').value);closeAppModal()">Use This Date</button></div>`, 420);
  renderPayrollView();
}
async function renderPayroll(){
  if(!isAdmin()) return;
  await loadPayrollRates();
  payrollHistory = await loadPayrollHistory();
  renderPayrollView();
}
let payrollHistory = [];
async function loadPayrollHistory(){
  const { data, error } = await supabaseClient.from('payroll_periods').select('*').order('period_start', { ascending: false }).limit(26);
  return error ? null : (data || []);
}
function renderPayrollSummary(){ renderPayrollView(); }
async function renderPayrollHistory(){ payrollHistory = await loadPayrollHistory(); renderPayrollView(); }
let payrollEditing = null;
function editPayrollRate(id){ payrollEditing = id; renderPayrollView(); const el = document.getElementById('payrollRateInput-' + id); if(el){ el.focus(); el.select(); } }
async function commitPayrollRate(id){ payrollEditing = null; await savePayrollRate(id); renderPayrollView(); }

function renderPayrollView(){
  const root = document.getElementById('timeRoot-payroll');
  if(!root || !isAdmin()) return;
  if(timeTab === 'payroll') timeTitle('Payroll');
  const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const cur = payrollCurrentStart(), sel = dayStart(payrollPeriodStart);
  const periods = Array.from({ length: 8 }, (_, i) => addDays(cur, -14 * i));
  if(!periods.some(p => +p === +sel)) periods.unshift(sel);
  const end = getPayrollPeriodEnd();
  const pOpts = periods.map(p => { const e = addDays(p, 13); return `<option value="${toDateStr(p)}" ${+p === +sel ? 'selected' : ''}>${fmt(p)} – ${p.getMonth() === e.getMonth() ? e.getDate() : fmt(e)}${+p === +cur ? ' · this period' : ''}</option>`; }).join('') + '<option value="anchor">Change Pay Periods…</option>';

  const rows = getPayrollSummary(), rated = rows.filter(r => r.rate > 0);
  const trs = rated.map(r => `<tr><td><span style="display:inline-flex;align-items:center;gap:6px">${avHtml(r.name)}${escapeHtml(r.name)}</span></td><td class="num">${r.regularHours.toFixed(1)}</td><td class="num${r.otHours ? '' : ' t-2'}">${r.otHours.toFixed(1)}</td><td class="num t-2">${money(r.rate)}</td><td class="num" style="font-weight:500">${money(r.pay)}</td></tr>`).join('');
  const sum = k => rated.reduce((s, r) => s + r[k], 0);
  const table = rated.length ? `<table class="mtx" aria-label="Pay period summary"><thead><tr><th>Person</th><th class="num">Regular hours</th><th class="num">Overtime</th><th class="num">Rate</th><th class="num">Total</th></tr></thead>
<tbody>${trs}</tbody><tfoot><tr><td>${rated.length} ${rated.length === 1 ? 'person' : 'people'}</td><td class="num">${sum('regularHours').toFixed(1)}</td><td class="num">${sum('otHours').toFixed(1)}</td><td></td><td class="num">${money(sum('pay'))}</td></tr></tfoot></table>`
    : `<div class="empty">Nobody has an hourly rate yet. Add one on the right.</div>`;

  // why there is overtime, in plain words
  const thr = parseFloat(settings.overtimeThresholdHours) || 0, w2 = addDays(sel, 7);
  const notes = [];
  rated.filter(r => r.otHours > 0).forEach(r => {
    [sel, w2].forEach(ws => {
      const we = addDays(ws, 7);
      const min = timeEntries.filter(e => e.userId === r.userId && new Date(e.date + 'T00:00:00') >= ws && new Date(e.date + 'T00:00:00') < we).reduce((s, e) => s + e.minutes, 0);
      if(thr && min / 60 > thr) notes.push(`${escapeHtml(firstName(r.name))} worked ${+(min / 60).toFixed(1)} hours in the week of ${fmt(ws)}, so ${+(min / 60 - thr).toFixed(1)} of them are overtime.`);
    });
  });
  const unrated = rows.filter(r => !r.rate && r.minutes > 0).map(r => firstName(r.name));
  if(unrated.length) notes.push(`${escapeHtml(unrated.join(' and '))} logged time but ${unrated.length === 1 ? 'has' : 'have'} no hourly rate.`);

  const hist = payrollHistory == null ? '<div class="empty">Could not load paid periods.</div>' : payrollHistory.length ? payrollHistory.map(row => {
    const by = teamProfiles.find(p => p.id === row.marked_paid_by), s = new Date(row.period_start + 'T00:00:00'), e = new Date(row.period_end + 'T00:00:00');
    const on = row.created_at ? new Date(row.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    return `<div class="row sm"><div class="tx"><span class="t" style="font-weight:400">${fmt(s)} – ${s.getMonth() === e.getMonth() ? e.getDate() : fmt(e)}</span><span class="s">Marked paid by ${escapeHtml(by ? firstName(by.name) : 'a former teammate')}${on ? ' on ' + on : ''}</span></div><div class="r"><span class="dur" style="color:var(--label)">${money(parseFloat(row.total_amount))}</span></div></div>`;
  }).join('') : '<div class="row sm"><span class="t-2" style="font-size:13px">No periods marked as paid yet.</span></div>';

  const rates = [...teamProfiles].sort((a, b) => (payrollRates[a.id] ? 0 : 1) - (payrollRates[b.id] ? 0 : 1) || a.name.localeCompare(b.name)).map(p => {
    const r = payrollRates[p.id] || 0;
    const val = payrollEditing === p.id
      ? `<span style="display:inline-flex;align-items:center;gap:4px">$<input class="tf" id="payrollRateInput-${p.id}" type="number" min="0" step="0.5" value="${r || ''}" style="width:80px;text-align:right" aria-label="Hourly rate for ${escapeHtml(p.name)}" onkeydown="if(event.key==='Enter')commitPayrollRate('${p.id}');if(event.key==='Escape'){payrollEditing=null;renderPayrollView()}" onblur="commitPayrollRate('${p.id}')"></span>`
      : `<button class="link-row" style="${r ? 'font-weight:500' : 'color:var(--label-2)'}" onclick="editPayrollRate('${p.id}')" title="Change rate">${r ? money(r) : 'No hourly rate'}</button>`;
    return `<div class="kv"><span style="color:var(--label);display:inline-flex;align-items:center;gap:6px">${avHtml(p.name)}${escapeHtml(p.name)}</span>${val}</div>`;
  }).join('');

  root.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center"><select class="pop" aria-label="Pay period" onchange="choosePayrollPeriod(this.value)">${pOpts}</select><span style="flex:1"></span>
<button class="btn" onclick="exportPayrollCsv()">${icon('export')}Export CSV</button><button class="btn" onclick="markPayrollPeriodPaid()">${icon('check-circle')}Mark Period as Paid…</button></div>
<div class="cols" style="margin-top:6px"><div class="col-main">
<div class="h2"><h2>Pay period summary</h2><span class="t-2" style="font-size:12px">Hours come from the timesheet</span></div>
<div class="grp">${table}</div>
<p class="t-2" style="font-size:12px;margin:10px 2px 0">Only people with an hourly rate appear here.${notes.length ? ' ' + notes.join(' ') : ''}</p>
<div class="h2"><h2>Paid periods</h2></div>
<div class="grp">${hist}</div></div>
<aside class="col-side" style="padding-top:28px">
<section class="panel"><h3>Overtime rule</h3>
<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:13px">After <input class="tf" id="overtimeThresholdInput" style="width:52px;text-align:center" value="${settings.overtimeThresholdHours ?? 40}" aria-label="Hours per week" onchange="saveOvertimeRules()"> hours a week, pay <input class="tf" id="overtimeMultiplierInput" style="width:52px;text-align:center" value="${settings.overtimeMultiplier ?? 1.5}" aria-label="Overtime multiplier" onchange="saveOvertimeRules()">× the normal rate.</div>
</section>
<section class="panel"><h3>Hourly rates</h3>${rates}</section>
</aside></div>`;
}
async function markPayrollPeriodPaid(){
  const rows = getPayrollSummary(), total = rows.reduce((s, r) => s + r.pay, 0), end = getPayrollPeriodEnd();
  const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const unrated = rows.filter(r => r.minutes > 0 && !r.rate).map(r => r.name);
  const msg = `Mark ${fmt(payrollPeriodStart)} – ${fmt(end)} as paid, ${money(total)} in total? This only records it here; no money is sent.` + (unrated.length ? ` ${unrated.join(', ')} logged time with no hourly rate, so it isn't in the total.` : '');
  if(!(await confirmDialog(msg, { confirmLabel: 'Mark as Paid' }))) return;
  const { error } = await supabaseClient.from('payroll_periods').insert({ period_start: toDateStr(payrollPeriodStart), period_end: toDateStr(end), total_amount: total, marked_paid_by: currentUser.id });
  if(error){ showToast('error', 'Could not save', error.message); return; }
  await renderPayrollHistory();
  showToast('success', 'Marked as paid', `${fmt(payrollPeriodStart)} – ${fmt(end)}`);
}
