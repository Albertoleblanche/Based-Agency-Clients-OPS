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
// As on the canvas (TimeNewDay / Week / Month): a Day, Week or Month switch with a calendar to
// step back through earlier work. The running timer lives in the sidebar corner on every page.
let tsView = 'day', tsAnchor = null;   // tsAnchor: a 'YYYY-MM-DD' inside the period shown
let timerPaused = (() => { try{ return JSON.parse(localStorage.getItem('bda_timer_paused') || 'null'); }catch(e){ return null; } })();
function savePaused(){ try{ timerPaused ? localStorage.setItem('bda_timer_paused', JSON.stringify(timerPaused)) : localStorage.removeItem('bda_timer_paused'); }catch(e){} }

function runningMinutes(){ return timerState.running ? (Date.now() - timerState.startedAt) / 60000 : 0; }
function clockText(){
  if(!timerState.running) return '0:00:00';
  const s = Math.max(0, Math.floor((Date.now() - timerState.startedAt) / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function tickTimesheetClock(){
  const r = document.getElementById('tsRunDur'); if(r) r.textContent = hmm(runningMinutes());
  const t = document.getElementById('tsTotal'); if(t && t.dataset.base != null) t.textContent = hmm(+t.dataset.base + runningMinutes());
}
function startTimerInterval(){ if(timerIntervalId) clearInterval(timerIntervalId); timerIntervalId = setInterval(updateTimerDisplay, 1000); updateTimerDisplay(); }

async function pauseTimer(){
  if(!timerState.running) return;
  const snap = { clientId: timerState.clientId, service: timerState.service, description: timerState.description, projectId: timerState.projectId || null, taskId: timerState.taskId || null };
  const id = await stopAndSaveTimer({ pause: true });
  timerPaused = id ? Object.assign(snap, { entryId: id }) : null; savePaused();
  renderTimesheet(); renderSideTimer();
}
async function stopTimerNow(){ await stopAndSaveTimer(); timerPaused = null; savePaused(); renderTimesheet(); renderSideTimer(); }
function resumePausedTimer(){
  if(!timerPaused) return;
  const p = timerPaused; timerPaused = null; savePaused();
  resumeEntryTimer(p.clientId, p.description, p.entryId);
  renderTimesheet(); renderSideTimer();
}
function finishPausedTimer(){ timerPaused = null; savePaused(); renderTimesheet(); renderSideTimer(); }
async function continueEntry(btn){
  if(timerState.running) await stopAndSaveTimer();
  timerPaused = null; savePaused();
  resumeEntryTimerFromBtn(btn);
  renderTimesheet(); renderSideTimer();
}

// ---- periods ------------------------------------------------------------------------------
const tsD = k => new Date(k + 'T12:00:00');
function tsMonday(d){ return dayStart(addDays(d, -((d.getDay() + 6) % 7))); }
function tsPeriod(view, anchor){
  const a = tsD(anchor);
  if(view === 'day') return { from: dayStart(a), to: dayStart(a) };
  if(view === 'week'){ const m = tsMonday(a); return { from: m, to: addDays(m, 6) }; }
  return { from: new Date(a.getFullYear(), a.getMonth(), 1), to: new Date(a.getFullYear(), a.getMonth() + 1, 0) };
}
function setTsView(v){ tsView = v; renderTimesheet(); tsMotion(0); }
function tsGo(dir){
  const a = tsD(tsAnchor || toDateStr(rNow()));
  const n = tsView === 'day' ? addDays(a, dir) : tsView === 'week' ? addDays(a, 7 * dir) : new Date(a.getFullYear(), a.getMonth() + dir, 1);
  const today = dayStart(rNow());
  tsAnchor = toDateStr(n > today ? today : n);
  renderTimesheet(); tsMotion(dir);
}
function tsToday(){ tsAnchor = toDateStr(rNow()); renderTimesheet(); tsMotion(1); }
function tsOpenDay(k){ tsView = 'day'; tsAnchor = k; renderTimesheet(); tsMotion(0); }
// Moving to another day, week or month: the date and what's under it slide in from the side you
// moved toward, so the timesheet reads as one strip of time. Switching Day / Week / Month, or
// opening a day from the week or the month, settles in place instead.
function tsMotion(dir){
  if(typeof motionOK !== 'function' || !motionOK()) return;
  const root = document.getElementById('timeRoot-timesheet');
  if(!root || root.offsetParent === null) return;
  const from = dir ? `translateX(${dir * 18}px)` : 'translateY(6px)';
  [root.querySelector('.tmi-lbl'), root.querySelector('.tmi-tot')].forEach(el => el && el.animate?.(
    [{ opacity: 0, transform: dir ? `translateX(${dir * 10}px)` : 'none' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: EASE_OUT }));
  root.querySelectorAll('.tmi-body').forEach((el, i) => el.animate?.(
    [{ opacity: 0, transform: from }, { opacity: 1, transform: 'none' }], { duration: 280, delay: i * 30, easing: EASE_OUT, fill: 'backwards' }));
}

// When an entry ran, from when it was saved: the timer saves it as it stops, so the end is its
// save time and the start is that minus its length. Entries added by hand or merged later have
// no reliable time of day; they show their length only.
function tsRange(e){
  if(!e.createdAt || !(e.minutes > 0) || e.minutes > 12 * 60) return null;
  const end = new Date(e.createdAt), start = new Date(end - e.minutes * 60000);
  return toDateStr(start) === e.date && toDateStr(end) === e.date ? { start, end } : null;
}
function tsClientMono(c){ return c ? monoHtml(c, 'sm') : '<span class="mono sm" aria-hidden="true">?</span>'; }
// A row reads like Harvest's: the project with the client in brackets, the task, then the notes.
// Time that isn't in Harvest shows the client and its service the same way.
function tsHead(c, projectId, taskId, service){
  const p = projectId && typeof hvProjectName === 'function' ? hvProjectName(projectId) : '', t = taskId && typeof hvTaskName === 'function' ? hvTaskName(taskId) : '';
  const name = c ? c.name : 'Client removed';
  const head = p ? `<b>${escapeHtml(p)}</b> <span class="tmi-cl">(${escapeHtml(name)})</span>` : `<b>${escapeHtml(name)}</b>`;
  const task = p ? t : (t || service || '');
  return { head, task };
}
function tsTextHtml(c, projectId, taskId, service, notes){
  const h = tsHead(c, projectId, taskId, service);
  return `<div class="tx"><span class="tmi-h">${h.head}</span>${h.task ? `<span class="tmi-t">${escapeHtml(h.task)}</span>` : ''}${notes ? `<span class="s">${escapeHtml(notes)}</span>` : ''}</div>`;
}
function tsRowHtml(e, rng){
  const c = clients.find(x => x.id === e.clientId);
  // logged in Harvest (step 4), invoiced there, sent there, or why not (tried again when edited and each night)
  const sync = e.harvestStatus === 'failed' || (e.harvestStatus === 'unmapped' && e.harvestProjectId) ? `<span class="tmi-sync is-fix" title="${escapeHtml((e.harvestError ? e.harvestError + '. ' : '') + 'Open it and pick its project and task to send it.')}">Send to Harvest</span>`
    : e.harvestLocked ? `<span class="tmi-sync" title="Invoiced in Harvest, so it can’t change here">Invoiced</span>`
    : e.source === 'harvest' ? `<span class="tmi-sync" title="Logged in Harvest">From Harvest</span>`
    : e.harvestId ? `<span class="tmi-sync" title="In Harvest">${icon('check', { weight: 'bold' })}Harvest</span>` : '';
  return `<div class="tmi-r" role="button" tabindex="0" onclick="openTimeEntryModal('${e.id}')" onkeydown="if(event.key==='Enter'&&event.target===this)openTimeEntryModal('${e.id}')">
<span class="tmi-rng">${rng ? `${fmtTime(rng.start).replace(/ [AP]M$/, '')} – ${fmtTime(rng.end).replace(/ [AP]M$/, '')}` : ''}</span>
${tsTextHtml(c, e.harvestProjectId, e.harvestTaskId, e.service, e.description)}
${sync}${e.harvestLocked ? '<span class="tmi-cont"></span>' : `<button class="ib tmi-cont" aria-label="Continue this" title="Continue this" data-resume-client="${e.clientId}" data-resume-desc="${encodeURIComponent(e.description || '')}" data-resume-entry="${e.id}" onclick="event.stopPropagation();continueEntry(this)">${icon('play')}</button>`}<span class="tmi-dur">${hmm(e.minutes)}</span></div>`;
}
function tsRunRowHtml(){
  const tc = clients.find(x => x.id === timerState.clientId);
  return `<div class="tmi-r is-run"><span class="tmi-rng">${fmtTime(new Date(timerState.startedAt)).replace(/ [AP]M$/, '')} – now</span>
${tsTextHtml(tc, timerState.projectId, timerState.taskId, timerState.service || tc?.service || '', timerState.description)}
<span class="tmi-live"><i class="tmx-rec"></i>Running</span><span class="tmi-dur" id="tsRunDur">${hmm(runningMinutes())}</span></div>`;
}
function tsPausedRowHtml(){
  const pc = clients.find(x => x.id === timerPaused.clientId);
  return `<div class="tmi-r is-run"><span class="tmi-rng">Paused</span>
${tsTextHtml(pc, timerPaused.projectId, timerPaused.taskId, timerPaused.service || '', timerPaused.description)}
<button class="btn" onclick="resumePausedTimer()">${icon('play')}Resume</button><button class="btn" onclick="finishPausedTimer()">Done</button></div>`;
}
// A day's rows, newest first, with any gap of half an hour or more between timed entries.
function tsDayRows(k, list, withGaps){
  const isToday = k === toDateStr(rNow());
  const items = list.map(e => ({ e, r: tsRange(e) })).sort((a, b) => (b.r ? b.r.end : new Date(b.e.createdAt)) - (a.r ? a.r.end : new Date(a.e.createdAt)));
  // A range that runs into the one after it can't be right (merged time): show it without one.
  for(let i = 1; i < items.length; i++) if(items[i].r && items[i - 1].r && items[i].r.end - items[i - 1].r.start > 2 * 60000) items[i].r = null;
  let out = isToday && timerState.running ? tsRunRowHtml() : (isToday && timerPaused ? tsPausedRowHtml() : '');
  let after = isToday && timerState.running ? new Date(timerState.startedAt) : null;
  items.forEach(({ e, r }) => {
    if(withGaps && r && after && after - r.end >= 30 * 60000){
      const gap = Math.round((after - r.end) / 60000);
      out += `<div class="tmi-r tmi-gap"><span class="tmi-rng">${fmtTime(r.end).replace(/ [AP]M$/, '')} – ${fmtTime(after).replace(/ [AP]M$/, '')}</span><span class="tmi-gi" aria-hidden="true"></span><div class="tx"><b>Not tracked</b></div>
<a class="x-lnk" href="#" onclick="openManualEntryModal('${k}', ${gap});return false;">Fill it in</a><span class="tmi-dur">${hmm(gap)}</span></div>`;
    }
    out += tsRowHtml(e, r);
    after = r ? r.start : null;
  });
  return out;
}

function renderTimesheet(){
  const root = document.getElementById('timeRoot-timesheet');
  if(!root) return;
  if(typeof timeEntriesDataLoaded !== 'undefined' && !timeEntriesDataLoaded){ root.innerHTML = skeletonHtml('time', 'Loading your time…'); return; }
  const now = rNow(), today = toDateStr(now);
  if(!tsAnchor || tsAnchor > today) tsAnchor = today;
  if(timeTab === 'timesheet') timeTitle(now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }));
  const mine = myOwnTimeEntries();
  const { from, to } = tsPeriod(tsView, tsAnchor);
  const fk = toDateStr(from), tk = toDateStr(to);
  const inP = mine.filter(e => e.date >= fk && e.date <= tk);
  const runToday = timerState.running && today >= fk && today <= tk ? runningMinutes() : 0;
  const totalMin = inP.reduce((s, e) => s + e.minutes, 0);
  const isCur = today >= fk && today <= tk;
  const fmtLong = d => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const label = tsView === 'day' ? (tsAnchor === today ? 'Today, ' + fmtLong(tsD(tsAnchor)) : tsAnchor === toDateStr(addDays(now, -1)) ? 'Yesterday, ' + fmtLong(tsD(tsAnchor)) : fmtLong(tsD(tsAnchor)))
    : tsView === 'week' ? (() => { const hasWkend = inP.some(e => tsD(e.date).getDay() % 6 === 0), end = hasWkend ? to : addDays(from, 4);
        return from.getMonth() === end.getMonth() ? `${from.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} – ${end.getDate()}` : `${from.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`; })()
    : from.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const days = [...new Set(inP.map(e => e.date))];
  const totTxt = tsView === 'day' ? `<b id="tsTotal" data-base="${totalMin}">${hmm(totalMin + runToday)}</b> ${tsAnchor === today ? 'today' : 'logged'}`
    : tsView === 'week' ? `<b id="tsTotal" data-base="${totalMin}">${hmm(totalMin + runToday)}</b> of ${weeklyHoursTarget()} h`
    : `<b id="tsTotal" data-base="${totalMin}">${hmm(totalMin + runToday)}</b> ${isCur ? 'so far' : 'logged'} · ${days.length} day${days.length === 1 ? '' : 's'} worked`;
  const seg = `<div class="seg" role="tablist" aria-label="Show">${[['day', 'Day'], ['week', 'Week'], ['month', 'Month']].map(([k, t]) => `<button class="${tsView === k ? 'on' : ''}" role="tab" aria-selected="${tsView === k}" onclick="setTsView('${k}')">${t}</button>`).join('')}</div>`;
  const head = `<div class="tmi-hd"><div class="tmi-nav"><div class="tb-grp"><button class="ib" aria-label="Previous ${tsView}" title="Previous ${tsView}" onclick="tsGo(-1)">${icon('caret-left')}</button><button class="ib" aria-label="Next ${tsView}" title="Next ${tsView}" onclick="tsGo(1)"${isCur ? ' disabled' : ''}>${icon('caret-right')}</button></div><b class="tmi-lbl">${escapeHtml(label)}</b>${isCur ? '' : `<button class="btn tmi-now" onclick="tsToday()">Today</button>`}</div><span class="tmi-tot">${totTxt}</span>${seg}</div>`;

  const byDay = {}; inP.forEach(e => (byDay[e.date] = byDay[e.date] || []).push(e));
  const add = k => `<a class="tmi-add" href="#" onclick="openManualEntryModal('${k}');return false;">${icon('plus')}Add time manually</a>`;
  let main, side;
  const budgets = n => {
    const list = activeClients().filter(c => c.monthlyHourBudget > 0).map(c => ({ c, u: monthHours(c), b: c.monthlyHourBudget })).sort((a, b) => b.u / b.b - a.u / a.b).slice(0, n);
    return list.map(({ c, u, b }) => `<div class="tmx-bud"><span>${escapeHtml(c.name)}</span><b class="${u > b ? 'over' : ''}">${Math.round(u)} / ${b} h</b><i><em class="${u > b ? 'over' : ''}" style="width:${Math.min(u / b, 1) * 100}%"></em></i></div>`).join('')
      || '<p class="tmi-none">No hour budgets set. Add one on a client.</p>';
  };
  const monthSec = `<div class="tmx-sec tmi-s2"><b>Hours this month</b><a class="x-lnk" href="#" onclick="switchTimeTab('reports');return false;">Reports</a></div>${budgets(4)}`;
  if(tsView === 'day'){
    const rows = tsDayRows(tsAnchor, byDay[tsAnchor] || [], true);
    main = `<div class="tmi-sec tmi-sec0"></div>${rows ? rows + add(tsAnchor) : tsEmptyHtml(tsAnchor === today ? 'today' : 'day', tsAnchor)}`;
    const byC = {};
    (byDay[tsAnchor] || []).forEach(e => { byC[e.clientId] = (byC[e.clientId] || 0) + e.minutes; });
    if(tsAnchor === today && timerState.running) byC[timerState.clientId] = (byC[timerState.clientId] || 0) + runningMinutes();
    const by = Object.entries(byC).sort((a, b) => b[1] - a[1]).map(([id, m]) => { const c = clients.find(x => x.id === id); return `<div class="tm1-by">${tsClientMono(c)}<span class="tm1-bn">${escapeHtml(c ? c.name : 'Client removed')}</span><b>${hmm(m)}</b></div>`; }).join('');
    side = `<div class="tmx-sec"><b>${tsAnchor === today ? 'Today' : tsD(tsAnchor).toLocaleDateString('en-US', { weekday: 'long' })} by client</b></div>${by || '<p class="tmi-none">Nothing yet.</p>'}${monthSec}`;
  } else if(tsView === 'week'){
    const ks = Object.keys(byDay); if(isCur && !ks.includes(today)) ks.push(today);
    ks.sort().reverse();
    main = ks.map(k => { const list = byDay[k] || [], m = list.reduce((s, e) => s + e.minutes, 0) + (k === today ? runningMinutes() : 0);
      return `<div class="tmi-sec"><b>${fmtLong(tsD(k))}</b><span>${hmm(m)}</span></div>${tsDayRows(k, list, false) || '<p class="tmi-none">Nothing tracked yet today.</p>'}`; }).join('');
    main = Object.keys(byDay).length || (isCur && timerState.running) ? main + add(isCur ? today : fk) : tsEmptyHtml(isCur ? 'week' : 'pastweek', isCur ? today : fk);
    const week = Array.from({ length: 7 }, (_, i) => { const d = addDays(from, i), k = toDateStr(d); return { d, k, m: (byDay[k] || []).reduce((s, e) => s + e.minutes, 0) + (k === today ? runningMinutes() : 0) }; })
      .filter((x, i) => i < 5 || x.m > 0);
    const bars = week.map(x => `<button class="tmi-wb${x.k === today ? ' on' : ''}" onclick="tsOpenDay('${x.k}')" aria-label="${fmtLong(x.d)}, ${hmLong(x.m)}"><span class="tmi-wv">${x.m ? hmm(x.m) : ''}</span><i style="height:${Math.max(Math.min(x.m / 60 / 8, 1), .02) * 100}%"></i><span>${x.d.toLocaleDateString('en-US', { weekday: 'short' })}</span></button>`).join('');
    side = `<div class="tmx-sec"><b>${isCur ? 'This week' : 'That week'}</b><span>${hmm(totalMin + runToday)} of ${weeklyHoursTarget()} h</span></div><div class="tmi-week">${bars}</div>${monthSec}`;
  } else {
    const g0 = tsMonday(from), weeks = Math.ceil((daysBetween(g0, to) + 1) / 7);
    let cells = '';
    for(let w = 0; w < weeks; w++){
      let tot = 0;
      for(let d = 0; d < 7; d++){
        const day = addDays(g0, w * 7 + d), k = toDateStr(day), inm = day.getMonth() === from.getMonth();
        const m = inm ? (byDay[k] || []).reduce((s, e) => s + e.minutes, 0) + (k === today ? runningMinutes() : 0) : 0;
        tot += m;
        const cls = (d >= 5 ? ' is-wk' : '') + (inm ? '' : ' is-out') + (k === today ? ' is-today' : '') + (inm && k > today ? ' is-fut' : '');
        const val = m ? `<b>${hmm(m)}</b><i><em style="width:${Math.min(m / 480, 1) * 100}%"></em></i>` : '';
        cells += inm && k <= today ? `<button class="tmi-mc${cls}" onclick="tsOpenDay('${k}')" aria-label="${fmtLong(day)}${m ? ', ' + hmLong(m) : ''}"><span class="tmi-dn">${day.getDate()}</span>${val}</button>` : `<div class="tmi-mc${cls}"><span class="tmi-dn">${day.getDate()}</span>${val}</div>`;
      }
      cells += `<div class="tmi-mc tmi-mt">${tot ? hmm(tot) : ''}</div>`;
    }
    main = `<div class="tmi-mh">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => `<span class="${i >= 5 ? 'is-wk' : ''}">${d}</span>`).join('')}<span>Week</span></div><div class="tmi-mg">${cells}</div><p class="tmi-mnote">Click a day to see its entries.</p>`;
    // Each client's whole-team hours that month against its budget, fullest first.
    const upto = isCur ? rNow() : new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59);
    const rowsC = activeClients().map(c => ({ c, u: monthHours(c, upto), b: c.monthlyHourBudget || 0 })).filter(x => x.u > 0 || (isCur && x.b > 0))
      .sort((a, b) => (b.b ? b.u / b.b : 0) - (a.b ? a.u / a.b : 0) || b.u - a.u).slice(0, 8);
    side = `<div class="tmx-sec"><b>By client ${isCur ? 'this month' : 'that month'}</b><span>vs budget</span></div>${rowsC.map(({ c, u, b }) =>
      `<div class="tmx-bud"><span>${escapeHtml(c.name)}</span><b class="${b && u > b ? 'over' : ''}">${b ? `${Math.round(u)} / ${b} h` : `${Math.round(u)} h`}</b>${b ? `<i><em class="${u > b ? 'over' : ''}" style="width:${Math.min(u / b, 1) * 100}%"></em></i>` : ''}</div>`).join('') || '<p class="tmi-none">No time this month.</p>'}`;
  }
  root.innerHTML = `<div class="tmi"><div class="tmi-cols"><section aria-label="Time">${head}<div class="tmi-body">${main}</div></section><aside><div class="tmi-body">${side}</div></aside></div></div>`;
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
<div style="display:flex;flex-wrap:wrap;gap:4px 28px;align-items:baseline;margin:2px 0 14px"><div><b style="font-size:22px;font-weight:600;letter-spacing:-.02em" class="dur">${hrs(total)}</b> <span class="t-2" style="font-size:13px">${rangeWord}</span></div>${busiest ? `<div class="t-2" style="font-size:13px">Busiest ${busyWord}: ${busyLabel} · ${hrs(busiest.minutes)}</div>` : ''}</div>
<div class="chart" style="gap:6px">${bars}</div><div class="chart-x" style="gap:6px">${xs}</div>`;

  // By client / service / teammate. With Harvest, what clients buy is their projects, so the
  // middle tab groups hours by Harvest project (the same package across clients adds up).
  const hvP = typeof harvestOwnsServices === 'function' && harvestOwnsServices();
  const sw = hvP ? { tab: 'Projects', one: 'project', many: 'projects', col: 'Project', none: 'No project' } : { tab: 'Services', one: 'service', many: 'services', col: 'Service', none: 'No service set' };
  const tabs = [['clients', 'Clients'], ['services', sw.tab], ['teammates', 'Teammates']].filter(([k]) => k !== 'teammates' || isAdmin());
  if(!tabs.some(([k]) => k === reportTab)) reportTab = 'clients';
  document.getElementById('reportGroupH').innerHTML = `<h2>By ${{ clients: 'client', services: sw.one, teammates: 'teammate' }[reportTab]}</h2><div class="seg" role="tablist" aria-label="Group by">${tabs.map(([k, t]) => `<button class="${reportTab === k ? 'on' : ''}" role="tab" aria-selected="${reportTab === k}" onclick="switchReportTab('${k}')">${t}</button>`).join('')}</div>`;
  const grouped = {};
  relevant.forEach(e => {
    const c = clients.find(x => x.id === e.clientId);
    const key = reportTab === 'clients' ? e.clientId : reportTab === 'services' ? ((e.harvestProjectId && hvProjectName(e.harvestProjectId)) || e.service || (c && !(hvP && serviceFromHarvest(c)) ? c.service : '') || sw.none) : (e.userId || (e.harvestUserId ? 'hv:' + e.harvestUserId : null));
    grouped[key] = (grouped[key] || 0) + e.minutes;
  });
  const rows = Object.entries(grouped).sort((a, b) => b[1] - a[1]);
  const grp = document.getElementById('reportTableGrp');
  if(!rows.length){ grp.innerHTML = emptyState({ compact: true, icon: 'timer', title: `No time logged ${rangeWord}`, text: `Hours show here by client, ${sw.one} or teammate once time is tracked.`, action: 'Open Timesheet', onAction: "switchTimeTab('timesheet')", link: range !== 'all' ? 'Show All Time' : '', onLink: "setReportRangeAll()" }); return; }
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
    head = `<th>${reportTab === 'services' ? sw.col : 'Teammate'}</th><th class="num">Hours</th><th>Share</th><th class="num"></th>`;
    body = shown.map(([k, m]) => {
      const p = reportTab === 'teammates' ? teamProfiles.find(x => x.id === k) : null;
      const hvName = reportTab === 'teammates' && !p && String(k).startsWith('hv:') && typeof hvPersonName === 'function' ? hvPersonName(String(k).slice(3)) : '';
      const name = reportTab === 'teammates' ? `<span style="display:inline-flex;align-items:center;gap:8px">${avHtml(p?.name || hvName || '?')}${escapeHtml(p?.name || hvName || 'Former teammate')}${hvName ? ' <span class="t-3">· Harvest only</span>' : ''}</span>` : escapeHtml(k);
      return `<tr><td>${name}</td><td class="num">${hrs(m)}</td><td style="width:34%"><div class="bar"><i style="width:${m / total * 100}%"></i></div></td><td class="num t-2">${Math.round(m / total * 100)}%</td></tr>`;
    }).join('');
  }
  const cols = reportTab === 'clients' ? (withBudget ? 6 : 5) : 4;
  const restRow = reportShowAll && rows.length > 9 ? `<tr><td colspan="${reportTab === 'clients' ? 2 : 1}"><button class="link-row t-2" data-grow="report-rows" onclick="reportShowAll=false;renderReports()">Show fewer</button></td></tr>` : rest.length ? `<tr><td colspan="${reportTab === 'clients' ? 2 : 1}"><button class="link-row t-2" data-grow="report-rows" onclick="reportShowAll=true;renderReports()">${rest.length} more ${reportTab === 'clients' ? (rest.length === 1 ? 'client' : 'clients') : reportTab === 'services' ? (rest.length === 1 ? sw.one : sw.many) : (rest.length === 1 ? 'teammate' : 'teammates')}</button></td><td class="num t-2">${hrs(restMin)}</td><td colspan="${cols - (reportTab === 'clients' ? 3 : 2)}"></td></tr>` : '';
  grp.setAttribute('data-grow-key', 'report-rows'); grp.setAttribute('data-grow-rows', 'tbody > tr');
  grp.innerHTML = `<table class="mtx" aria-label="Hours ${rangeWord}"><thead><tr>${head}</tr></thead><tbody>${body}${restRow}</tbody>
<tfoot><tr>${reportTab === 'clients' ? '<td></td>' : ''}<td>Total</td><td class="num">${hrs(total)}</td><td colspan="${cols - (reportTab === 'clients' ? 3 : 2)}"></td></tr></tfoot></table>`;
}

// ================================================================ Daily Summary
dailySummaryDate = (() => { const d = dayStart(rNow()); do { d.setDate(d.getDate() - 1); } while([0, 6].includes(d.getDay())); return d; })();
function shiftDailySummaryDate(dir){
  const d = new Date(dailySummaryDate); d.setDate(d.getDate() + dir);
  if(d > rNow()) return;
  dailySummaryDate = d; loadDailySummary(dir);
}
function dsHeaderHtml(sub){
  const isToday = toDateStr(dailySummaryDate) === toDateStr(rNow());
  return `<div class="ds-hd"><div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
<div class="tb-grp"><button class="ib" aria-label="Previous day" onclick="shiftDailySummaryDate(-1)">${icon('caret-left')}</button><button class="ib" aria-label="Next day" ${isToday ? 'disabled' : ''} onclick="shiftDailySummaryDate(1)">${icon('caret-right')}</button></div>
<h1 class="lt ds-day" style="font-size:22px">${dailySummaryDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</h1><span style="flex:1"></span>
<button class="btn" onclick="openSlackSummaryConfirm()">${icon('slack-logo')}Send to Slack…</button></div>
<p class="lt-sub">${sub}</p></div>`;
}
// Days already opened show again straight away (and quietly refresh); a day that's still loading
// keeps the last one on screen, dimmed under the new date, instead of blanking to "Loading…".
const dsCache = {};
let dsWant = '';
async function loadDailySummary(dir){
  const root = document.getElementById('timeRoot-dailysummary');
  if(!root) return;
  if(timeTab === 'dailysummary') timeTitle('Daily Summary');
  const key = toDateStr(dailySummaryDate), cached = dsCache[key], body = root.querySelector('.ds-body');
  dsWant = key;
  if(cached){ lastDailySummaryData = cached; renderDailySummaryList(cached, dir); }
  else if(body && root.querySelector('.ds-hd')){
    lastDailySummaryData = null; // Send to Slack waits for this day
    root.querySelector('.ds-hd').outerHTML = dsHeaderHtml('Loading…');
    body.classList.add('is-loading');
    dsMotion(dir, 'date');
  } else root.innerHTML = dsHeaderHtml('Loading…') + '<div class="ds-body"></div>';
  const fail = msg => { if(dsWant !== key || cached) return; root.innerHTML = dsHeaderHtml(msg); };
  try{
    const { data: { session } } = await supabaseClient.auth.getSession();
    const response = await fetch(`/api/get-daily-summary?date=${key}`, { headers: { 'Authorization': `Bearer ${session.access_token}` } });
    const data = await response.json();
    if(!response.ok) return fail(escapeHtml(data.error || 'Could not load the summary.'));
    dsCache[key] = data;
    if(dsWant !== key) return; // they've moved on to another day
    if(cached && JSON.stringify(cached) === JSON.stringify(data)) return;
    lastDailySummaryData = data;
    // after a dimmed wait the date has already moved; only the day itself comes in
    renderDailySummaryList(data, cached ? undefined : dir, body && !cached ? 'body' : undefined);
  }catch(e){
    fail('Could not load the summary. Check your connection.');
  }
}
// The new day slides in from the side you moved toward (only the date while it's still loading).
function dsMotion(dir, part){
  if(!dir || typeof motionOK !== 'function' || !motionOK()) return;
  const root = document.getElementById('timeRoot-dailysummary');
  if(!root || root.offsetParent === null) return;
  if(part !== 'body') [root.querySelector('.ds-day'), root.querySelector('.ds-hd .lt-sub')].forEach(el => el && el.animate?.(
    [{ opacity: 0, transform: `translateX(${dir * 10}px)` }, { opacity: 1, transform: 'none' }], { duration: 220, easing: EASE_OUT }));
  if(part === 'date') return;
  root.querySelectorAll('.ds-body > .cols > *').forEach((el, i) => el.animate?.(
    [{ opacity: 0, transform: `translateX(${dir * 18}px)` }, { opacity: 1, transform: 'none' }], { duration: 280, delay: i * 30, easing: EASE_OUT, fill: 'backwards' }));
}
let dsUntouchedOpen = false;
function toggleDsUntouched(){ dsUntouchedOpen = !dsUntouchedOpen; if(lastDailySummaryData) renderDailySummaryList(lastDailySummaryData); }
function renderDailySummaryList(data, dir, part){
  const root = document.getElementById('timeRoot-dailysummary');
  if(!root) return;
  const dStr = data.date || toDateStr(dailySummaryDate), dayName = new Date(dStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });
  const people = (data.summary || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const impsBy = name => clients.reduce((s, c) => s + (c.improvements || []).filter(i => i.author === name && String(i.date || '').slice(0, 10) === dStr).length, 0);
  const total = people.reduce((s, p) => s + p.totalMinutes, 0), totalImps = people.reduce((s, p) => s + impsBy(p.name), 0);
  if(!people.length){
    const isToday = dStr === toDateStr(rNow());
    root.innerHTML = dsHeaderHtml(canApprove() ? `Nobody logged time on ${dayName}.` : `You didn't log any time on ${dayName}.`) + `<div class="ds-body">${emptyState({ icon: 'clipboard-text',
      title: isToday ? 'Nothing logged yet today' : `Nothing logged on ${dayName}`,
      text: canApprove() ? 'The summary fills in as the team tracks time and logs improvements: who worked on which client, and what got done.' : 'Your summary fills in as you track time and log improvements.',
      action: isToday ? 'Track Time' : 'Go to the Day Before', actionIcon: isToday ? 'timer' : '', onAction: isToday ? 'openTimerModal()' : 'shiftDailySummaryDate(-1)' })}</div>`;
    if(part !== 'body') dsMotion(dir, 'date');
    return;
  }
  const cards = people.map(person => {
    const prof = teamProfiles.find(p => p.id === person.userId);
    const slack = prof && (prof.daily_summary_slack_id || prof.slack_user_id);
    const ents = person.entries.slice().sort((a, b) => b.minutes - a.minutes), more = ents.length - 3;
    const st = slack ? `<span class="st"><span class="dot green"></span>Sends to ${escapeHtml(firstName(person.name))} in Slack</span>`
      : `<button class="btn btn-q sm" onclick="event.stopPropagation();switchView('team')">Add ${escapeHtml(firstName(person.name))}’s Slack ID</button>`;
    const n = impsBy(person.name);
    return `<div class="grp og"><div class="og-h" role="button" tabindex="0" onclick="openDailySummaryDetail('${person.userId}')">${avHtml(person.name, 'style="width:28px;height:28px;font-size:12px"')}
<div class="tx"><b>${escapeHtml(person.name)}</b><span>${hmLong(person.totalMinutes)} logged · ${n} improvement${n === 1 ? '' : 's'} · ${ents.length} entr${ents.length === 1 ? 'y' : 'ies'}</span></div><div class="r">${st}</div></div>
${ents.slice(0, 3).map(e => `<div class="og-i" style="padding-left:52px"><div class="tx"><span>${escapeHtml(e.description || e.service || 'No description')}</span><span class="s">${escapeHtml(e.client)}</span></div><div class="r"><span class="dur">${hmm(e.minutes)}</span></div></div>`).join('')}
${more > 0 ? `<div class="og-i" style="padding-left:52px"><button class="link-row t-2" style="font-size:13px" onclick="openDailySummaryDetail('${person.userId}')">${more} more ${more === 1 ? 'entry' : 'entries'}</button></div>` : ''}</div>`;
  }).join('');
  const worked = new Set(people.flatMap(p => p.entries.map(e => e.client)));
  const act = activeClients();
  const untouched = act.filter(c => !worked.has(c.name));
  const long = people.filter(p => p.totalMinutes > 9 * 60).map(p => p.name);
  // Clients nobody touched that day, longest without time first, so the ones slipping stand out
  // instead of a wall of names. Clients with no time ever go last.
  const lastBy = {};
  visibleTimeEntries().forEach(e => { if(e.date < dStr && !(lastBy[e.clientId] >= e.date)) lastBy[e.clientId] = e.date; });
  const dsD = tsD(dStr);
  const quiet = untouched.map(c => ({ c, n: lastBy[c.id] ? daysBetween(tsD(lastBy[c.id]), dsD) : null }))
    .sort((a, b) => (a.n == null) - (b.n == null) || (b.n || 0) - (a.n || 0) || a.c.name.localeCompare(b.c.name));
  const ago = n => n == null ? 'Never logged' : n < 14 ? `${n} day${n === 1 ? '' : 's'}` : n < 60 ? `${Math.round(n / 7)} weeks` : `${Math.round(n / 30.4)} months`;
  const SHOW = 6, openNt = dsUntouchedOpen && quiet.length > SHOW;
  const ntRows = (openNt ? quiet : quiet.slice(0, SHOW)).map(({ c, n }) => `<button class="ds-nt-r" onclick="openClientDetail('${c.id}')"><span>${escapeHtml(c.name)}</span><b>${ago(n)}</b></button>`).join('');
  const ntMore = quiet.length > SHOW ? `<button class="ds-nt-more" data-grow="ds-nt" data-turn="180" aria-expanded="${openNt}" onclick="toggleDsUntouched()">${openNt ? 'Show less' : `Show all ${quiet.length}`}${icon('caret-down', { weight: 'bold' })}</button>` : '';
  const ntSec = untouched.length
    ? `<div class="ds-nt-cap">Longest without time first</div><div class="ds-nt" data-grow-key="ds-nt">${ntRows}</div>${ntMore}`
    : '<p class="ds-nt-none">Every client got time.</p>';
  root.innerHTML = dsHeaderHtml(`${hmLong(total)} logged by ${people.length} ${people.length === 1 ? 'person' : 'people'} · ${totalImps} improvement${totalImps === 1 ? '' : 's'} · each person gets their own summary`) +
`<div class="ds-body"><div class="cols" style="margin-top:18px"><div class="col-main">${cards}</div>
<aside class="col-side">
<section class="panel"><h3>Team total<span>${dayName}</span></h3>
<div class="kv"><span>Hours logged</span><b style="font-weight:500" class="dur">${hmLong(total)}</b></div>
<div class="kv"><span>Improvements</span><b style="font-weight:500">${totalImps}</b></div>
<div class="kv"><span>Clients worked on</span><b style="font-weight:500">${act.filter(c => worked.has(c.name)).length} of ${act.length}</b></div>
<div class="kv"><span>Over 9 hours</span><b style="font-weight:500">${long.length ? long.map(escapeHtml).join(', ') : 'Nobody'}</b></div></section>
<section class="panel ds-ntp"><h3>Not touched ${dayName}<span>${untouched.length ? `${untouched.length} of ${act.length}` : ''}</span></h3>${ntSec}</section>
</aside></div></div>`;
  dsMotion(dir, part);
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
<div class="modal-body"><p class="t-2" style="font-size:14px;margin:0 0 12px">Periods are 14 days. Pick the first day of any real pay period and the rest line up with it.</p>
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
    : emptyState({ compact: true, icon: 'currency-circle-dollar', title: 'Nobody has an hourly rate yet', text: 'Pay for the period is worked out from the timesheet once someone has a rate. Add one under Hourly rates, on the right.', action: (teamProfiles || []).some(p => !p.access_revoked) ? 'Add a Rate' : '', onAction: `editPayrollRate('${((teamProfiles || []).find(p => !p.access_revoked) || {}).id}')` });

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
  }).join('') : '<div class="row sm"><span class="t-2" style="font-size:14px">No periods marked as paid yet.</span></div>';

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
<div class="h2"><h2>Pay period summary</h2><span class="t-2" style="font-size:13px">Hours come from the timesheet</span></div>
<div class="grp">${table}</div>
<p class="t-2" style="font-size:13px;margin:10px 2px 0">Only people with an hourly rate appear here.${notes.length ? ' ' + notes.join(' ') : ''}</p>
<div class="h2"><h2>Paid periods</h2></div>
<div class="grp">${hist}</div></div>
<aside class="col-side" style="padding-top:28px">
<section class="panel"><h3>Overtime rule</h3>
<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:14px">After <input class="tf" id="overtimeThresholdInput" style="width:52px;text-align:center" value="${settings.overtimeThresholdHours ?? 40}" aria-label="Hours per week" onchange="saveOvertimeRules()"> hours a week, pay <input class="tf" id="overtimeMultiplierInput" style="width:52px;text-align:center" value="${settings.overtimeMultiplier ?? 1.5}" aria-label="Overtime multiplier" onchange="saveOvertimeRules()">× the normal rate.</div>
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

// The timesheet with nothing in it: start the timer (today), or add time you already spent.
function tsEmptyHtml(kind, k){
  const now = kind === 'today' || kind === 'week';
  return emptyState({ icon: 'timer', tone: now ? 'blue' : '',
    title: kind === 'today' ? 'Nothing tracked yet today' : kind === 'week' ? 'Nothing tracked yet this week' : kind === 'pastweek' ? 'No time that week' : 'No time on this day',
    text: now ? 'Start the timer when you begin work for a client, or add time you already spent. It counts toward each client’s hours and the team’s reports.' : 'Add time you spent that day, for a client.',
    action: now ? 'Start Timer' : 'Add Time', actionIcon: now ? 'play' : 'plus', onAction: now ? 'openTimerModal()' : `openManualEntryModal('${k}')`,
    link: now ? 'Add Time Manually' : '', onLink: `openManualEntryModal('${k}')`, cls: 'tmi-es' });
}
function setReportRangeAll(){ const sel = document.getElementById('reportRange'); if(sel){ sel.value = 'all'; if(typeof syncPopSel === 'function') syncPopSel(sel); } reportsPage = 1; renderReports(); }
