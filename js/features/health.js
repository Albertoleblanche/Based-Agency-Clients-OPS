// Health (canvas "Health — new design", approved). All Clients answers who our clients are;
// Health answers three other questions:
//   1. Are we getting better or worse?  counts against last week, and a 12-week trend
//   2. Is someone fixing each problem?   every client that needs care, by where the fix stands
//   3. What keeps going wrong?           what moved this week, and what makes clients slip
// Clicking a client opens the details on the right, like This Week. Past weeks re-run the same
// rules as of that day (withAsOf), so the trend needs nothing stored.

function selectHealthClient(id){ window._healthSel = id; renderHealth(); }
function closeHealthPanel(){ window._healthSel = null; renderHealth(); }

// Levels for every client as of a day; one pass per day, cached for the render.
let _healthPast = { key: '', at: {} };
function healthLevelsAt(day){
  const k = toDateStr(day);
  if(_healthPast.at[k]) return _healthPast.at[k];
  const end = new Date(day); end.setHours(23, 59, 0, 0);
  const out = {};
  withAsOf(end, () => healthScopeClients().forEach(c => {
    if(c.startDate && new Date(c.startDate + 'T00:00:00') > end) return;
    const h = clientHealth(c);
    out[c.id] = { level: h.level, raw: h.rawLevel, keys: h.signals.map(s => s.key), short: h.short };
  }));
  return (_healthPast.at[k] = out);
}
function healthCount(levels){ const n = { r: 0, y: 0, g: 0 }; Object.values(levels).forEach(x => n[x.level]++); return n; }
// "went over budget" — what a client's top signal says, as the end of a sentence.
function healthWorseWords(s){
  if(!s) return 'needs care';
  return { hours: s.title.startsWith('Over') ? 'went over budget' : 'is on pace to go over budget', noupdate: 'has updates slipping', late: 'has updates slipping',
    quiet: 'has had nothing logged', under: 'is under-using its hours', tasks: 'has overdue tasks', flag: 'was flagged by its owner' }[s.key] || s.title.toLowerCase();
}
const HEALTH_CAUSES = [['updates', 'envelope-simple', 'Updates late or missed', ['noupdate', 'late']], ['quiet', 'square-pen', 'Nothing logged', ['quiet']],
  ['hours', 'currency-circle-dollar', 'Over budget', ['hours']], ['under', 'clock', 'Hours under-used', ['under']],
  ['tasks', 'list-checks', 'Tasks overdue', ['tasks']], ['flag', 'flag', 'Flagged by the owner', ['flag']]];

function renderHealth(){
  const root = document.getElementById('healthRoot');
  if(!root || typeof clients === 'undefined') return;
  _healthPast = { key: '', at: {} };
  const now = rNow(), T = healthThresholds(), me = myName();
  const all = healthScopeClients().map(c => ({ c, h: clientHealth(c) }));
  const cur = healthCount(Object.fromEntries(all.map(x => [x.c.id, { level: x.h.level }])));
  const weekAgo = healthLevelsAt(addDays(now, -7)), prev = healthCount(weekAgo);

  // ---- 12 weeks of "needing care": the end of each past week, then today ----
  const monday = dayStart(addDays(now, -((now.getDay() + 6) % 7)));
  const weeks = [];
  for(let k = 11; k >= 1; k--){ const end = addDays(monday, -7 * (k - 1) - 1); weeks.push({ label: fmtShortDate(addDays(end, -6)), n: healthCount(healthLevelsAt(end)) }); }
  weeks.push({ label: 'This week', n: cur, now: true });
  const maxN = Math.max(6, ...weeks.map(w => w.n.r + w.n.y));
  const W = 432, H = 118, base = 96, slot = W / weeks.length, bw = 20, per = (base - 8) / maxN;
  const seg = (x, y, h, round) => { const r = Math.min(4, h); return round ? `M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + bw - r}Q${x + bw} ${y} ${x + bw} ${y + r}V${y + h}z` : `M${x} ${y}h${bw}v${h}h${-bw}z`; };
  const cols = weeks.map((w, i) => {
    const x = +(i * slot + (slot - bw) / 2).toFixed(1), hr = w.n.r * per, hy = w.n.y * per;
    let g = `<g class="hl-col${w.now ? ' is-now' : ''}"><title>${escapeHtml(w.label)}: ${w.n.r} at risk, ${w.n.y} to watch</title>`;
    if(hr) g += `<path class="r" d="${seg(x, +(base - hr).toFixed(1), +hr.toFixed(1), !hy)}"/>`;
    if(hy) g += `<path class="y" d="${seg(x, +(base - hr - (hr ? 2 : 0) - hy).toFixed(1), +hy.toFixed(1), true)}"/>`;
    g += `<rect class="hit" x="${(i * slot).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${base}"/></g>`;
    if(i === 0 || i === 5 || w.now) g += `<text x="${(w.now ? i * slot + slot - 2 : i === 0 ? i * slot + 2 : x + bw / 2).toFixed(1)}" y="${H - 4}" text-anchor="${w.now ? 'end' : i === 0 ? 'start' : 'middle'}"${w.now ? ' class="now"' : ''}>${escapeHtml(w.label)}</text>`;
    return g;
  }).join('');
  const chart = `<svg class="hl-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Clients at risk and to watch, last 12 weeks">${cols}<line class="base" x1="0" x2="${W}" y1="${base + .5}" y2="${base + .5}"/></svg>`;

  // ---- what moved since last week ----
  const order = { g: 0, y: 1, r: 2 }, word = { g: 'Healthy', y: 'Watch', r: 'At risk' }, tone = { g: 'green', y: 'yellow', r: 'red' };
  const moves = all.filter(x => weekAgo[x.c.id] && weekAgo[x.c.id].level !== x.h.level)
    .map(x => ({ x, from: weekAgo[x.c.id].level, to: x.h.level, worse: order[x.h.level] > order[weekAgo[x.c.id].level] }))
    .sort((a, b) => b.worse - a.worse || order[b.to] - order[a.to]);
  const worse = moves.find(m => m.worse), better = moves.find(m => !m.worse);
  const story = [worse ? `${worse.x.c.name} ${healthWorseWords(worse.x.h.short)}.` : '', better ? `${better.x.c.name} is ${better.to === 'g' ? 'healthy again' : 'doing better'}.` : ''].filter(Boolean).join(' ')
    || (cur.r + cur.y ? 'No changes since last week.' : all.length ? 'Every client looks healthy.' : 'No clients yet.');
  const delta = (a, b, bad) => a === b ? 'Same as last week' : `${Math.abs(a - b)} ${a > b ? 'more' : 'fewer'} than last week`;
  const score = [['r', 'At risk', cur.r, prev.r], ['y', 'To watch', cur.y, prev.y], ['g', 'Healthy', cur.g, prev.g]]
    .map(([k, l, n, p]) => `<div class="hl-st"><span class="hl-lab"><i class="hl-dot ${k}"></i>${l}</span><b>${n}</b><span class="hl-d${k === 'r' && n > p ? ' up' : ''}">${delta(n, p)}</span></div>`).join('');

  // ---- the three lanes ----
  const need = all.filter(x => x.h.level !== 'g'), recovering = all.filter(x => x.h.quiet && x.h.rawLevel !== 'g');
  const byUrg = (a, b) => order[b.h.level] - order[a.h.level] || (b.c.importance || 0) - (a.c.importance || 0);
  const underway = need.filter(x => nextStepTask(x.c)).sort(byUrg), noPlan = need.filter(x => !nextStepTask(x.c)).sort(byUrg);
  const sel = window._healthSel ? all.find(x => x.c.id === window._healthSel) : null;
  let primaryUsed = false;
  const card = (x, line, btn) => {
    const lvl = x.h.quiet ? x.h.rawLevel : x.h.level;
    return `<div class="hl-c${sel && sel.c.id === x.c.id ? ' is-sel' : ''}" role="button" tabindex="0" onclick="selectHealthClient('${x.c.id}')" onkeydown="if(event.key==='Enter')selectHealthClient('${x.c.id}')">
<div class="hl-ch">${monoHtml(x.c, 'sm')}<b>${escapeHtml(x.c.name)}</b>${tagHtml(lvl === 'r' ? 'red' : 'yellow', lvl === 'r' ? 'At risk' : 'Watch')}</div>
<p class="hl-k">${line}</p>${btn ? `<div class="hl-ca">${btn}</div>` : ''}</div>`;
  };
  const noPlanCards = noPlan.map(x => {
    const s = x.h.short, owner = clientOwner(x.c);
    let btn;
    if(s && s.key === 'quiet' && owner && owner !== me) btn = `<button class="btn sm" onclick="event.stopPropagation();remindHolder('${x.c.id}')">Remind ${escapeHtml(firstName(owner))}</button>`;
    else { btn = `<button class="btn sm${primaryUsed ? '' : ' btn-p'}" onclick="event.stopPropagation();planNextStep('${x.c.id}')">${icon('plus')}Plan Next Step</button>`; primaryUsed = true; }
    return card(x, escapeHtml(s ? s.title : 'Needs care'), btn);
  });
  const underwayCards = underway.map(x => {
    const t = nextStepTask(x.c), due = t.dueDate ? ' · ' + weekDay(new Date(t.dueDate + 'T12:00:00')) : '';
    return card(x, `<span class="hl-nx">Next</span>${escapeHtml(t.title)}${escapeHtml(due)}`, '');
  });
  const recCards = recovering.map(x => {
    const hd = healthHandled[x.c.id], until = hd ? addDays(new Date(hd.at), T.quietDays) : null;
    return card(x, `Handled${hd ? ' by ' + escapeHtml(firstName(hd.by)) : ''} · healthy again ${until ? escapeHtml(weekDay(until) === 'Today' ? 'today' : fmtShortDate(until)) : 'soon'} if it holds`, '');
  });
  const lane = (dot, title, sub, cards) => `<section class="hl-lane"><div class="hl-lh"><span class="hl-dot ${dot}"></span><b>${title}</b><span class="n">${cards.length}</span></div><p class="hl-ls">${sub}</p>${cards.join('') || '<p class="hl-none">Nothing here.</p>'}</section>`;
  const lanes = need.length || recovering.length ? `<div class="hl-lanes">${lane('r', 'No plan yet', 'Needs a next step', noPlanCards)}${lane('b', 'Plan underway', 'Someone is on it', underwayCards)}${lane('g', 'Recovering', 'Handled, settling', recCards)}</div>`
    : !activeClients().length ? emptyNoClients('Health watches each client’s updates, hours and follow-ups, and flags the ones slipping.')
    : `<div class="hl-clear">${icon('check-circle')}<b>Every client looks healthy</b><span>Nothing needs care right now.</span></div>`;

  // ---- moved this week, and what makes clients slip (the last 13 weeks, about 90 days) ----
  const moveRows = moves.slice(0, 4).map(m => `<div class="hl-mv" role="button" tabindex="0" onclick="selectHealthClient('${m.x.c.id}')">${monoHtml(m.x.c, 'sm')}<div class="tx"><b>${escapeHtml(m.x.c.name)}</b><span>${escapeHtml(m.worse ? (m.x.h.short ? m.x.h.short.title : 'Needs care') : m.to === 'g' ? 'Back to healthy' : 'Doing better')}</span></div>
<span class="hl-fl">${tagHtml(tone[m.from], word[m.from])}${icon('arrow-right')}${tagHtml(tone[m.to], word[m.to])}</span></div>`).join('') || '<p class="hl-none">No client changed this week.</p>';
  const counts = {};
  for(let k = 0; k < 13; k++){ const lv = healthLevelsAt(addDays(now, -7 * k)); Object.values(lv).forEach(v => HEALTH_CAUSES.forEach(([id, , , keys]) => { if(v.keys.some(x => keys.includes(x))) counts[id] = (counts[id] || 0) + 1; })); }
  const causes = HEALTH_CAUSES.map(([id, ic, label]) => ({ ic, label, n: counts[id] || 0 })).filter(x => x.n).sort((a, b) => b.n - a.n).slice(0, 5);
  const mx = Math.max(1, ...causes.map(x => x.n));
  const causeRows = causes.map(x => `<div class="hl-cz"><span class="hl-czl">${icon(x.ic)}${escapeHtml(x.label)}</span><span class="hl-czb"><i style="width:${(x.n / mx * 100).toFixed(0)}%"></i></span><b>${x.n}</b></div>`).join('') || '<p class="hl-none">Nothing has slipped in the last 90 days.</p>';

  root.innerHTML = `<div class="spw"><div class="sp-page"><div class="hl">
<header class="hl-top"><div class="hl-score">${score}<p class="hl-sum">${escapeHtml(story)}</p></div>
<div class="hl-trend"><div class="hl-th"><b>Needing care, last 12 weeks</b><span class="hl-key"><i class="r"></i>At risk<i class="y"></i>To watch</span></div>${chart}</div></header>
<div class="hl-sec"><b>Getting them back on track</b><span>Click a client to see why and what’s been done</span><a class="x-lnk" href="#settings" onclick="openSettingsTab('updates');return false;">Health rules</a></div>
${lanes}
<div class="hl-bot"><section><div class="hl-sec sm"><b>Moved this week</b></div>${moveRows}</section>
<section><div class="hl-sec sm"><b>What makes clients slip</b><span>Last 90 days</span></div>${causeRows}${causes.length && causes[0].label.startsWith('Updates') ? '<p class="hl-note">Most slips start with a late update.</p>' : ''}</section></div>
</div></div>${sel ? healthPanelHtml(sel.c, sel.h) : ''}</div>`;
  if(currentViewName === 'health') setToolbar('Health', seesEveryone() ? 'How clients are doing, and who is fixing what' : 'How your clients are doing');
}

// The panel: how bad, the next step, why, hours, the last 8 updates and what changed.
function healthPanelHtml(c, h, closeFn){
  const owner = clientOwner(c), next = nextStepTask(c), lvl = h.quiet ? h.rawLevel : h.level;
  const start = c.startDate ? new Date(c.startDate + 'T12:00:00') : null;
  const meta = [owner, c.service, start ? 'client since ' + start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : ''].filter(Boolean).map(escapeHtml).join(' · ');
  const sinceTxt = h.since ? (relDay(h.since).toLowerCase() === 'today' ? 'today' : relDay(h.since)) : 'today';
  let eyebrow, title, sub, acts;
  if(lvl === 'g'){ eyebrow = `<span class="sp-eb ok">${icon('check', { weight: 'bold' })}Healthy</span>`; title = 'Nothing needs care'; sub = 'No signals right now.'; acts = ''; }
  else {
    eyebrow = h.quiet ? `<span class="sp-eb">${icon('check', { weight: 'bold' })}Handled, settling</span>`
      : `<span class="sp-eb ${lvl === 'r' ? 'red' : 'warn'}"><i class="eb-dot"></i>${lvl === 'r' ? 'At risk' : 'Watch'} since ${escapeHtml(sinceTxt)}</span>`;
    if(next){ title = `Next step: ${next.title}`; sub = `${escapeHtml((teamProfiles.find(p => p.id === next.assigneeId) || {}).name || '')}${next.dueDate ? ' · due ' + fmtShortDate(new Date(next.dueDate + 'T12:00:00')) : ''}`;
      acts = `<div class="sp-acts"><button class="btn" onclick="markHealthHandled('${c.id}')">Mark Handled</button><button class="btn btn-p" onclick="openTaskDetailModal('${next.id}')">Open Task</button></div>`; }
    else if(h.quiet){ const hd = healthHandled[c.id]; title = 'Handled, waiting for the numbers to settle'; sub = hd ? `Marked handled by ${escapeHtml(hd.by)} ${escapeHtml(relDayLower(new Date(hd.at)))}${hd.note ? ': ' + escapeHtml(hd.note) : ''}.` : ''; acts = `<div class="sp-acts"><button class="btn btn-p" onclick="planNextStep('${c.id}')">${icon('plus')}Plan Next Step</button></div>`; }
    else { title = 'No next step yet'; sub = 'Plan a fix or a check-in with a date, and it becomes a task for the owner.';
      acts = `<div class="sp-acts"><button class="btn" onclick="markHealthHandled('${c.id}')">Mark Handled</button><button class="btn btn-p" onclick="planNextStep('${c.id}')">${icon('plus')}Plan Next Step</button></div>`; }
  }
  const why = h.signals.map(s => `<div class="hp-w"><span class="sig ${s.l}">${icon(s.icon)}</span><div class="tx"><b>${escapeHtml(s.title)}</b><span>${escapeHtml(s.text)}</span></div><span class="hp-since">${escapeHtml(relDay(s.since))}</span></div>`).join('');
  const hp = h.hp, scale = Math.max(hp.budget, hp.projected, hp.used, 1);
  const hours = hp.budget ? `<div class="sp-sec"><b>Hours this month</b><span>${escapeHtml(c.service || '')}</span></div>
<div class="hp-hb"><i class="${hp.used > hp.budget ? 'over' : ''}" style="width:${(hp.used / scale * 100).toFixed(1)}%"></i><span class="hp-proj" style="width:${(hp.projected / scale * 100).toFixed(1)}%"></span><span class="hp-bud" style="left:${(hp.budget / scale * 100).toFixed(1)}%"></span></div>
<div class="hp-hl"><span><b>${Math.round(hp.used)} h</b> used</span><span>Budget ${hp.budget} h</span><span class="${hp.projected > hp.budget ? 't-red' : ''}">On pace for ${Math.round(hp.projected)} h</span></div>` : '';
  const ots = onTimeSummary(h.seq);
  const events = healthEvents(c, h).slice(0, 3).map(e => `<div class="hp-ev"><span>${escapeHtml(relDay(e.at))}</span><b>${escapeHtml(e.t)}</b></div>`).join('');
  return `<aside class="sp" aria-label="${escapeHtml(c.name)}, health">
<div class="sp-bar"><button class="ib" aria-label="Close" onclick="${closeFn || 'closeHealthPanel()'}">${icon('x')}</button><a class="x-lnk" href="#" onclick="openClientDetail('${c.id}');return false;">Open client</a></div>
<div class="sp-head">${monoHtml(c, 'lg')}<div class="tx"><b>${escapeHtml(c.name)}</b><span>${meta}</span></div></div>
<div class="sp-status">${eyebrow}<b>${escapeHtml(title)}</b><span class="sub">${sub}</span>${acts}</div>
${h.signals.length ? `<div class="sp-sec"><b>Why</b><span>${todayPlural(h.signals.length, 'signal')}</span></div>${why}` : ''}
${hours}
<div class="sp-sec"><b>Last 8 weekly updates</b><span>${ots.total ? `${ots.onTime} of ${ots.total} on time` : ''}</span></div>${weekStripHtml(c)}
${events ? `<div class="sp-sec"><b>What changed</b></div>${events}` : ''}
</aside>`;
}

// The story so far: signals with the day they started, sends that were late or missed, and handling.
function healthEvents(c, h){
  const ev = [];
  h.signals.forEach(s => ev.push({ at: s.since, t: s.title, s: s.text }));
  const now = rNow(), monday = dayStart(addDays(now, -((now.getDay() + 6) % 7)));
  h.seq.forEach((x, i) => {
    const wk = addDays(monday, -7 * (7 - i));
    if(x === 'm') ev.push({ at: wk, t: 'Weekly update missed', s: `Nothing was sent the week of ${fmtShortDate(wk)}` });
    if(x === 'l') ev.push({ at: wk, t: 'Weekly update sent late', s: 'More than 7 days after the one before' });
  });
  const hd = healthHandled[c.id];
  if(hd) ev.push({ at: new Date(hd.at), t: `Marked handled by ${firstName(hd.by)}`, s: hd.note || 'Quiet unless it gets worse' });
  return ev.filter(e => e.at <= rNow()).sort((a, b) => b.at - a.at);
}
function openSettingsTab(tab){ switchView('settings'); if(typeof switchSettingsTab === 'function') setTimeout(() => { try{ switchSettingsTab(tab); }catch(e){} }, 0); }
