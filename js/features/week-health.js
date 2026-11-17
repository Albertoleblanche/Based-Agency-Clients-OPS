// The two things Based Radar watches for the team (see the "How it works" plan):
//   1. The weekly deadline — one send time a week, with three checkpoints before it.
//      Each client's update is Sent, On track, Behind (missed a checkpoint) or Late (missed the send).
//   2. Client health — Watch and At risk, worked out every time data changes from what the
//      app already knows: updates sent, hours against budget, work logged, overdue tasks and
//      the owner's own risk flag. Thresholds live in Settings → Updates.

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DEFAULT_UPDATE_SCHEDULE = {
  send: { day: 4, time: '09:00' },      // Thursday 9:00 AM — updates go out
  log: { day: 1, time: '18:00' },       // Monday 6:00 PM — work logged by
  review: { day: 2, time: '12:00' },    // Tuesday 12:00 PM — ready for review by
  approve: { day: 3, time: '18:00' },   // Wednesday 6:00 PM — approved by
};
const DEFAULT_UPDATE_AUTOMATION = { autoDraft: true, remindBehind: true, scheduledSend: true, mondaySummary: true };
const DEFAULT_HEALTH_SIGNALS = {
  noUpdateDays: [8, 14], lateOfLast4: [2, 3], hoursPacePct: [110, 150], underUsedPct: 50,
  nothingLoggedDays: [7, 14], overdueTasks: [2, 4], ownerFlag: [3, 4], importantBump: true, quietDays: 7,
};
function updateSchedule(){ return Object.assign({}, DEFAULT_UPDATE_SCHEDULE, (typeof settings !== 'undefined' && settings.updatesSchedule) || {}); }
function updateAutomation(){ return Object.assign({}, DEFAULT_UPDATE_AUTOMATION, (typeof settings !== 'undefined' && settings.updatesAutomation) || {}); }
function healthThresholds(){ return Object.assign({}, DEFAULT_HEALTH_SIGNALS, (typeof settings !== 'undefined' && settings.healthSignals) || {}); }

// ---- time helpers ------------------------------------------------------------------------
function rNow(){ return new Date(); }
function dayStart(d){ const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d, n){ const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function atTime(day, hhmm){ const [h, m] = String(hhmm || '00:00').split(':').map(Number); const x = new Date(day); x.setHours(h || 0, m || 0, 0, 0); return x; }
function fmtTime(d){ return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }

function fmtShortDate(d){ return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function fmtDay(d){ return d.toLocaleDateString('en-US', { weekday: 'short' }); }
function daysBetween(a, b){ return Math.floor((dayStart(b) - dayStart(a)) / 86400000); }
// "Today" · "Yesterday" · "Monday" (this week) · "Nov 12"
function relDay(d){
  const n = daysBetween(d, rNow());
  if(n <= 0) return 'Today';
  if(n < 7) return DAY_NAMES[new Date(d).getDay()];
  return fmtShortDate(new Date(d));
}
// "1 day 19 hours" · "3 hours 45 minutes" · "12 minutes"
function fmtDuration(ms){
  const mins = Math.max(0, Math.round(ms / 60000)), d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  const p = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  if(d) return h ? `${p(d, 'day')} ${p(h, 'hour')}` : p(d, 'day');
  if(h) return m ? `${p(h, 'hour')} ${p(m, 'minute')}` : p(h, 'hour');
  return p(m, 'minute');
}
function fmtWait(since){
  const mins = Math.max(0, Math.round((rNow() - new Date(since)) / 60000));
  if(mins < 60) return `${mins}m`;
  if(mins < 1440) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / 1440)}d`;
}

// ---- the weekly cycle ----------------------------------------------------------------------
// The cycle is the Monday–Sunday week that holds this week's send. Checkpoints are the days
// before the send in that same week. Work logged up to the "work logged" checkpoint goes in.
function updateCycle(now){
  now = now || rNow();
  const sch = updateSchedule();
  const monday = dayStart(addDays(now, -((now.getDay() + 6) % 7)));
  const at = (cp) => atTime(addDays(monday, (cp.day + 6) % 7), cp.time);
  const send = at(sch.send), log = at(sch.log), review = at(sch.review), approve = at(sch.approve);
  const prevSend = addDays(send, -7), periodEnd = log, periodStart = addDays(log, -7);
  return { now, monday, send, prevSend, checkpoints: { log, review, approve, send }, periodStart, periodEnd,
    label: `${fmtShortDate(addDays(periodStart, 1))} – ${addDays(periodEnd, 0).getDate()}`,
    sendLabel: `${fmtDay(send)} ${fmtTime(send)}`, sendDayName: DAY_NAMES[send.getDay()] };
}

// The person who looks after a client: the one who logged most of its work in the last 60 days
// (falls back to the latest draft's author). Shown as "Owner" and used for reminders.
function clientOwner(c){
  if(!c) return '';
  if(c.customFieldValues && c.customFieldValues.owner) return c.customFieldValues.owner;
  const since = addDays(rNow(), -60), tally = {};
  (c.improvements || []).forEach(i => { if(i.author && new Date(i.date) >= since) tally[i.author] = (tally[i.author] || 0) + 1; });
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  if(top) return top[0];
  const d = (c.drafts || []).slice().sort((a, b) => new Date(b.draftPendingSince || 0) - new Date(a.draftPendingSince || 0))[0];
  return d ? d.author : '';
}
function firstName(name){ return String(name || '').split(' ')[0]; }
function profileByName(name){ return (typeof teamProfiles !== 'undefined' ? teamProfiles : []).find(p => p.name === name); }
function initialsOf(name){ const w = String(name || '?').trim().split(/\s+/); return (w.length > 1 ? w[0][0] + w[1][0] : w[0].slice(0, 2)).toUpperCase(); }
function avatarColorIndex(name){ const ps = (typeof teamProfiles !== 'undefined' ? teamProfiles : []); const i = ps.findIndex(p => p.name === name); return ((i < 0 ? String(name).length : i) % 4) + 1; }
function avHtml(name, extra){ return `<span class="av a${avatarColorIndex(name)}"${extra ? ' ' + extra : ''} title="${escapeHtml(name)}" aria-label="${escapeHtml(name)}">${escapeHtml(initialsOf(name))}</span>`; }
function clientMono(c){ return String(c?.name || '?').replace(/[^A-Za-z0-9& ]/g, '').split(/\s+/).filter(w => w && w !== '&').map(w => w[0]).join('').slice(0, 2).toUpperCase(); }
function monoHtml(c, cls){ return `<span class="mono${cls ? ' ' + cls : ''}" aria-hidden="true">${escapeHtml(clientMono(c))}</span>`; }

// ---- sent history (for "Last 8 weeks" and the late/missed signal) --------------------------
// Kept in app_storage 'update-history' as { clientId: [ISO sent times] }; written whenever an
// update is sent (sendDraftEmail → recordUpdateSent) and by the scheduled send.
let updateHistory = {};
async function loadUpdateHistory(){
  const raw = await safeGet('update-history');
  try{ updateHistory = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {}; }catch(e){ updateHistory = {}; }
}
async function recordUpdateSent(clientId, at){
  await loadUpdateHistory();
  const list = updateHistory[clientId] || (updateHistory[clientId] = []);
  const t = at ? new Date(at) : rNow();
  // One send can stamp several drafts (Group & Send, a combined email): count it once.
  if(list.some(x => Math.abs(new Date(x) - t) < 10 * 60000)) return;
  list.push(t.toISOString());
  updateHistory[clientId] = list.slice(-40);
  await safeSet('update-history', JSON.stringify(updateHistory));
}
function sentTimes(c){
  const fromHist = (updateHistory[c.id] || []).map(t => new Date(t));
  (c.drafts || []).forEach(d => { if(d.draftSentAt){ const t = new Date(d.draftSentAt); if(!fromHist.some(x => Math.abs(x - t) < 60000)) fromHist.push(t); } });
  return fromHist.sort((a, b) => a - b);
}
function lastSentAt(c){ const s = sentTimes(c); return s.length ? s[s.length - 1] : null; }
// Last 8 weekly updates, oldest first: 'o' on time · 'l' late · 'm' missed · 'p' this week, not sent yet · 'n' before history began.
function weekHistory(c){
  // Each send counts once, for the oldest week it can belong to: on time if it went out in the
  // week before that send day, late if it went out within 4 days after it, otherwise missed.
  const cyc = updateCycle(), sends = sentTimes(c), first = sends[0], used = new Set(), out = [];
  const take = (from, to) => { const i = sends.findIndex((t, k) => !used.has(k) && t > from && t <= to); if(i < 0) return false; used.add(i); return true; };
  for(let k = 7; k >= 0; k--){
    const due = addDays(cyc.send, -7 * k), from = addDays(due, -7);
    if(take(from, due)){ out.push('o'); continue; }
    if(k === 0){ out.push(rNow() > due ? (take(due, addDays(due, 4)) ? 'l' : 'm') : 'p'); continue; }
    if(take(due, addDays(due, 4))){ out.push('l'); continue; }
    out.push(!first || first > due ? 'n' : 'm');
  }
  return out;
}
function onTimeSummary(seq){
  const done = seq.slice(0, 7).filter(x => x !== 'n');
  return { onTime: done.filter(x => x === 'o').length, total: done.length };
}
function histDotsHtml(seq){
  const late = seq.filter(x => x === 'l' || x === 'm').length;
  const cls = { o: '', l: 'l', m: 'm', p: 'p', n: 'p' };
  return `<span class="hist" role="img" aria-label="Last 8 weekly updates: ${late} late or missed">${seq.map(x => cls[x] ? `<i class="${cls[x]}"></i>` : '<i></i>').join('')}</span>`;
}
function weekStripHtml(c){
  const cyc = updateCycle(), seq = weekHistory(c), words = { o: 'On time', l: 'Late', m: 'Missed', p: 'Due ' + fmtDay(cyc.send), n: '—' };
  const cls = { o: '', l: 'l', m: 'm', p: 'p', n: 'p' };
  return `<div class="wkstrip" role="list" aria-label="Weekly updates, last 8 weeks">${seq.map((x, i) => {
    const d = addDays(cyc.send, -7 * (7 - i));
    return `<div class="${cls[x]}" role="listitem"><i></i><b>${fmtShortDate(d)}</b><span>${x === 'p' && i < 7 ? '—' : words[x]}</span></div>`;
  }).join('')}</div>`;
}

// ---- this week's update for one client ------------------------------------------------------
const STEP_NAMES = ['Logged', 'Ready for review', 'Approved', 'Sent'];
function clientWeek(c){
  const cyc = updateCycle(), now = cyc.now, cp = cyc.checkpoints;
  const drafts = c.drafts || [];
  const owner = clientOwner(c);
  const logged = (c.improvements || []).filter(i => new Date(i.date) > cyc.periodStart);
  const sentThisCycle = drafts.filter(d => d.draftSentAt && new Date(d.draftSentAt) > cyc.prevSend).sort((a, b) => new Date(b.draftSentAt) - new Date(a.draftSentAt))[0];
  const approved = drafts.find(d => d.draftStatus === 'approved');
  const inReview = drafts.find(d => d.draftStatus === 'pending' && d.readyToNotify);
  const written = drafts.find(d => d.draftStatus === 'pending');
  const w = { c, owner, holder: owner, logged, done: 0, behind: null, sent: false, late: false, state: 'track', draft: null };
  if(sentThisCycle){ Object.assign(w, { done: 4, sent: true, state: 'sent', draft: sentThisCycle, note: `Sent ${relDay(sentThisCycle.draftSentAt).toLowerCase()}, ${fmtTime(new Date(sentThisCycle.draftSentAt))}` }); return w; }
  if(approved){ Object.assign(w, { done: 3, draft: approved, note: `Approved · sends ${fmtDay(cp.send)} ${fmtTime(cp.send)}` }); }
  else if(inReview){ Object.assign(w, { done: 2, draft: inReview, holder: 'approvers', note: `In Review since ${fmtTime(new Date(inReview.draftPendingSince || now))}` }); }
  else if(written){ Object.assign(w, { done: 1, draft: written, holder: written.author, note: `Draft waiting on ${firstName(written.author)} since ${fmtTime(cp.review < now ? cp.review : new Date(written.draftPendingSince || now))}` }); }
  else if(logged.length){ Object.assign(w, { done: 1, note: `${logged.length} improvement${logged.length === 1 ? '' : 's'} logged · no draft yet` }); }
  else {
    const last = (c.improvements || []).map(i => new Date(i.date)).sort((a, b) => b - a)[0];
    Object.assign(w, { done: 0, note: last ? `Nothing logged since ${fmtShortDate(last)}` : 'Nothing logged yet' });
  }
  // Behind: the step that's due next has passed its checkpoint.
  const due = [cp.log, cp.review, cp.approve, cp.send];
  if(w.done < 4 && now > due[w.done]){ w.behind = w.done; w.state = 'behind'; }
  if(now > cp.send){ w.late = true; w.state = 'late'; }
  return w;
}
function stepsHtml(w){
  if(w.sent) return '<span class="steps sent" role="img" aria-label="Sent"><i></i><i></i><i></i><i></i></span>';
  let out = '';
  for(let k = 0; k < 4; k++) out += k < w.done ? '<i class="d"></i>' : (w.behind === k ? '<i class="b"></i>' : '<i></i>');
  const label = w.behind != null ? `Behind: ${STEP_NAMES[w.behind].toLowerCase()} is late` : (w.done ? `${STEP_NAMES[w.done - 1]}, on track` : 'Not started, on track');
  return `<span class="steps" role="img" aria-label="${label}">${out}</span>`;
}
function weekSummary(list){
  const ws = list.map(clientWeek);
  return { ws, sent: ws.filter(w => w.sent).length, behind: ws.filter(w => w.state === 'behind' || w.state === 'late').length,
    track: ws.filter(w => !w.sent && w.state === 'track').length, total: ws.length };
}

// ---- client health --------------------------------------------------------------------------
function monthHours(c, now){
  now = now || rNow();
  const m0 = new Date(now.getFullYear(), now.getMonth(), 1);
  const list = (typeof timeEntries !== 'undefined' ? timeEntries : []).filter(e => e.clientId === c.id && new Date(e.date + 'T12:00:00') >= m0 && new Date(e.date + 'T12:00:00') <= now);
  return list.reduce((s, e) => s + (e.minutes || 0), 0) / 60;
}
function hoursPace(c){
  const now = rNow(), dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(), day = now.getDate();
  const used = monthHours(c, now), budget = c.monthlyHourBudget || 0;
  return { used, budget, day, dim, projected: day ? used / day * dim : 0, expected: budget * day / dim };
}
let healthHandled = {};
async function loadHealthHandled(){
  const raw = await safeGet('health-handled');
  try{ healthHandled = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {}; }catch(e){ healthHandled = {}; }
}
function clientHealth(c){
  const T = healthThresholds(), now = rNow(), sig = [];
  const lvl = (v, [w, r]) => (v >= r ? 'r' : (v >= w ? 'y' : null));
  const last = lastSentAt(c);
  const noUpd = last ? daysBetween(last, now) : null;
  const w = clientWeek(c);
  if(noUpd != null){
    const l = lvl(noUpd, T.noUpdateDays);
    if(l) sig.push({ l, key: 'noupdate', icon: 'mail', title: 'Updates keep slipping', since: addDays(last, T.noUpdateDays[0]),
      text: `No update in ${noUpd} days.` });
  }
  const seq = weekHistory(c), last4 = seq.slice(3, 7).filter(x => x !== 'n'), lateN = last4.filter(x => x === 'l' || x === 'm').length;
  const ll = lvl(lateN, T.lateOfLast4);
  if(ll){
    const ex = sig.find(s => s.key === 'noupdate');
    const txt = `${lateN} of the last 4 were late or missed${w.behind != null ? '; this week’s is behind' : ''}.`;
    if(ex){ ex.text += ' ' + txt; if(ll === 'r') ex.l = 'r'; }
    else {
      const lastBad = [6, 5, 4, 3].find(i => seq[i] === 'l' || seq[i] === 'm');
      sig.push({ l: ll, key: 'late', icon: 'mail', title: 'Updates keep slipping', since: lastBad != null ? addDays(updateCycle().send, -7 * (7 - lastBad)) : now, text: txt.charAt(0).toUpperCase() + txt.slice(1) });
    }
  }
  const hp = hoursPace(c);
  if(hp.budget){
    const pct = hp.projected / hp.budget * 100, l = pct >= T.hoursPacePct[1] ? 'r' : (pct >= T.hoursPacePct[0] ? 'y' : null);
    if(l) sig.push({ l, key: 'hours', icon: 'currency-circle-dollar', title: hp.used > hp.budget ? 'Over budget, and speeding up' : 'On pace to go over budget', since: now,
      text: `${Math.round(hp.used)} of ${hp.budget} hours used by ${fmtShortDate(now)} — on pace for ${Math.round(hp.projected)} by ${fmtShortDate(new Date(now.getFullYear(), now.getMonth(), hp.dim))}.` });
    else if(hp.day >= 15 && hp.used < hp.expected * T.underUsedPct / 100) sig.push({ l: 'y', key: 'under', icon: 'clock', title: 'Hours under-used', since: new Date(now.getFullYear(), now.getMonth(), 16),
      text: `${Math.round(hp.used)} of ${hp.budget} hours used with the month half gone.` });
  }
  const lastLog = (c.improvements || []).map(i => new Date(i.date)).sort((a, b) => b - a)[0];
  if(lastLog){
    const n = daysBetween(lastLog, now), l = lvl(n, T.nothingLoggedDays);
    if(l) sig.push({ l, key: 'quiet', icon: 'notepad', title: 'Nothing logged', since: addDays(lastLog, T.nothingLoggedDays[0]), text: `Nothing logged in ${n} days.` });
  }
  const overdue = (typeof tasks !== 'undefined' ? tasks : []).filter(t => t.clientId === c.id && t.status !== 'done' && !t.cancelledAt && t.dueDate && dayStart(new Date(t.dueDate + 'T12:00:00')) < dayStart(now));
  const lo = lvl(overdue.length, T.overdueTasks);
  if(lo) sig.push({ l: lo, key: 'tasks', icon: 'list-checks', title: `${overdue.length} tasks overdue`, since: now, text: overdue.map(t => t.title).slice(0, 2).join(' · ') });
  const lf = (typeof settings !== 'undefined' && settings.ownerRiskFlag === false) ? null : lvl(c.danger || 0, T.ownerFlag);
  if(lf) sig.push({ l: lf, key: 'flag', icon: 'flag', title: `Flagged by ${firstName(clientOwner(c)) || 'the owner'}`, since: now, text: `Risk set to ${c.danger} of 5.` });
  const prio = ['hours', 'noupdate', 'late', 'quiet', 'under', 'tasks', 'flag'];
  sig.sort((a, b) => (a.l === 'r' ? 0 : 1) - (b.l === 'r' ? 0 : 1) || prio.indexOf(a.key) - prio.indexOf(b.key));
  let level = sig.some(s => s.l === 'r') ? 'r' : (sig.length ? 'y' : 'g');
  if(level === 'y' && T.importantBump && (c.importance || 0) >= 8) level = 'r';
  const h = healthHandled[c.id];
  const quiet = h && addDays(new Date(h.at), T.quietDays) > now && (h.level === level || (h.level === 'r' && level === 'y'));
  const since = sig.length ? sig.map(s => s.since).sort((a, b) => b - a)[0] : null;
  const short = sig.length ? (sig.find(s => s.l === 'r') || sig[0]) : null;
  return { level: quiet ? 'g' : level, rawLevel: level, quiet, signals: sig, since, short, hp, seq };
}
function healthWord(l){ return { r: 'At risk', y: 'Watch', g: 'Healthy' }[l]; }
function hstateHtml(l, text){
  const dot = l === 'g' ? '' : `<span class="dot ${l === 'r' ? 'red' : 'yellow'}"></span>`;
  return `<span class="hstate ${l}">${dot}${escapeHtml(text || healthWord(l))}</span>`;
}
function shortSignal(h, max){
  if(!h.signals.length) return '';
  const order = ['hours', 'late', 'noupdate', 'quiet', 'under', 'tasks', 'flag'];
  const lateM = h.signals.map(s => s.text.match(/(\d) of the last 4 were late or missed/)).find(Boolean);
  const bits = h.signals.slice().sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)).map(s => ({
    hours: `Hours on pace for ${Math.round(h.hp.projected)} of ${h.hp.budget}`,
    under: `${Math.round(h.hp.used)} of ${h.hp.budget} hours used with the month half gone`,
    quiet: s.text.replace(/\.$/, ''),
    noupdate: lateM ? `${lateM[1]} of the last 4 updates late` : s.text.split('.')[0],
    late: `${lateM ? lateM[1] : ''} of the last 4 updates late`.trim(),
    tasks: s.title, flag: s.title }[s.key]));
  return [...new Set(bits)].slice(0, max || 2).join(' · ');
}
function nextStepTask(c){
  return (typeof tasks !== 'undefined' ? tasks : []).find(t => t.clientId === c.id && t.status !== 'done' && !t.cancelledAt && (!t.dueDate || new Date(t.dueDate + 'T23:59:00') >= dayStart(rNow())) && /next step/i.test(t.description || ''));
}
async function markHealthHandled(clientId, note){
  await loadHealthHandled();
  const c = clients.find(x => x.id === clientId);
  healthHandled[clientId] = { at: rNow().toISOString(), by: myProfile?.name || '', note: note || '', level: c ? clientHealth(c).rawLevel : 'y' };
  await safeSet('health-handled', JSON.stringify(healthHandled));
  showToast('success', 'Marked as handled', `Quiet for ${healthThresholds().quietDays} days, unless it gets worse.`);
  renderAll();
}
function planNextStep(clientId){
  const c = clients.find(x => x.id === clientId);
  openNewTaskModal(null, 'todo', { clientId, title: '', description: 'Next step for ' + (c ? c.name : 'this client') });
}

// Pace chart: hours used so far (solid), pace to month end (dashed), budget line.
function paceChartHtml(c, w, h){
  const hp = hoursPace(c), now = rNow(), dim = hp.dim, budget = hp.budget || 1;
  const byDay = {}; (typeof timeEntries !== 'undefined' ? timeEntries : []).forEach(e => { if(e.clientId !== c.id) return; const d = new Date(e.date + 'T12:00:00'); if(d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() && d <= now) byDay[d.getDate()] = (byDay[d.getDate()] || 0) + e.minutes / 60; });
  const pts = [[1, 0]]; let cum = 0;
  for(let d = 1; d <= hp.day; d++){ if(byDay[d]){ cum += byDay[d]; pts.push([d, cum]); } }
  if(pts[pts.length - 1][0] !== hp.day) pts.push([hp.day, cum]);
  const max = Math.max(budget * 2, hp.projected * 1.1, 10);
  const X = d => 34 + (d - 1) / (dim - 1) * (w - 90), Y = v => 18 + (1 - v / max) * (h - 46);
  const over = hp.projected > budget * 1.1, col = over ? 'var(--red)' : 'var(--label-2)';
  const end = new Date(now.getFullYear(), now.getMonth(), dim);
  return `<div class="pace"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Hours this month: ${Math.round(hp.used)} used of ${hp.budget}, on pace for ${Math.round(hp.projected)}">
<line x1="${X(1)}" x2="${X(dim)}" y1="${Y(budget)}" y2="${Y(budget)}" style="stroke:var(--label-3);stroke-width:1;stroke-dasharray:3 3"/>
<text x="${X(dim) + 6}" y="${Y(budget) + 4}">${hp.budget} h budget</text>
<line x1="${X(hp.day)}" x2="${X(hp.day)}" y1="12" y2="${Y(0)}" style="stroke:var(--sep-strong);stroke-width:1"/>
<polyline points="${X(hp.day)},${Y(hp.used)} ${X(dim)},${Y(hp.projected)}" style="fill:none;stroke:${col};stroke-width:2;stroke-dasharray:4 4;opacity:.75"/>
<polyline points="${pts.map(([d, v]) => `${X(d).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')}" style="fill:none;stroke:var(--label);stroke-width:2;stroke-linejoin:round;stroke-linecap:round"/>
<circle cx="${X(hp.day)}" cy="${Y(hp.used)}" r="4" style="fill:${over ? 'var(--red)' : 'var(--label)'}"/>
<circle cx="${X(dim)}" cy="${Y(hp.projected)}" r="3" style="fill:none;stroke:${col};stroke-width:1.5"/>
<text x="${X(dim) + 6}" y="${Y(hp.projected) + 4}" style="fill:${col};font-weight:600">${Math.round(hp.projected)} h</text>
<text x="${X(hp.day) - 6}" y="${Y(hp.used) - 10}" text-anchor="end" style="fill:var(--label);font-weight:600">${Math.round(hp.used)} h today</text>
<line x1="${X(1)}" x2="${X(dim)}" y1="${Y(0)}" y2="${Y(0)}" style="stroke:var(--sep);stroke-width:1"/>
<text x="${X(1)}" y="${h - 8}">${fmtShortDate(new Date(now.getFullYear(), now.getMonth(), 1))}</text><text x="${X(hp.day)}" y="${h - 8}" text-anchor="middle">${fmtShortDate(now)}</text><text x="${X(dim)}" y="${h - 8}" text-anchor="end">${fmtShortDate(end)}</text>
</svg></div>`;
}
function signalRowsHtml(h, limit){
  const sigs = limit ? h.signals.slice(0, limit) : h.signals;
  return sigs.map(s => `<div class="row"><span class="sig ${s.l}">${icon(s.icon)}</span><div class="tx"><span class="t">${escapeHtml(s.title)}</span><span class="s" style="white-space:normal">${escapeHtml(s.text)}</span></div>
<div class="r"><span class="since">Since ${relDay(s.since).toLowerCase() === 'today' ? 'today' : relDay(s.since)}</span></div></div>`).join('');
}
function isApproverName(name){ const p = profileByName(name); return !!p && (p.role === 'admin' || p.role === 'approver'); }

// Compact wording for table cells and lists: "Over budget · 2 of 4 updates late".
function tableSignal(h, c){
  if(!h.signals.length) return '';
  const lateM = h.signals.map(s => s.text.match(/(\d) of the last 4 were late or missed/)).find(Boolean);
  const bits = h.signals.map(s => ({
    hours: h.hp.used > h.hp.budget ? 'Over budget' : `On pace for ${Math.round(h.hp.projected)} of ${h.hp.budget} h`,
    under: `${Math.round(h.hp.used)} of ${h.hp.budget} hours used, month half gone`,
    noupdate: lateM ? `${lateM[1]} of 4 updates late` : s.text.split('.')[0],
    late: lateM ? `${lateM[1]} of 4 updates late` : 'Updates late',
    quiet: s.text.replace(/\.$/, ''), tasks: s.title, flag: s.title }[s.key]));
  const out = [...new Set(bits)].slice(0, 2);
  if(out.length < 2 && h.level === 'r' && !h.signals.some(s => s.l === 'r') && c && (c.importance || 0) >= 8) out.push('importance ' + c.importance);
  return out.join(' · ');
}
// "Today" · weekday for this week · "Nov 12" before that.
function weekDay(d){
  const dd = new Date(d), monday = dayStart(addDays(rNow(), -((rNow().getDay() + 6) % 7)));
  if(daysBetween(dd, rNow()) <= 0) return 'Today';
  return dd >= monday ? dd.toLocaleDateString('en-US', { weekday: 'short' }) : fmtShortDate(dd);
}
