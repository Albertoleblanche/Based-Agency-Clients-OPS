// Health (canvas "Health B, refined: week by week, the Apple way", approved Nov 20). Every client is
// a row with its last 12 weeks, grouped by its story: slipped this week, needing care for weeks,
// being fixed, healthy. A week is a capsule on a baseline: a quiet dot when healthy, a short bar on
// watch, a tall one at risk, so trouble visibly rises and still reads without color. Hover any week
// and every row goes back to that week. Clicking a client opens the details on the right. Past weeks
// re-run the same rules as of that day (withAsOf), so the history needs nothing stored.

function selectHealthClient(id){ window._healthSel = id; renderHealth(); }
function closeHealthPanel(){ window._healthSel = null; renderHealth(); }
function setHealthOwner(o){ window._hlOwner = o || null; window._healthSel = null; renderHealth(); }

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

// The 12 weeks: the end of each of the last 11 weeks (Sunday), then now.
function healthWeeks(){
  const now = rNow(), monday = dayStart(addDays(now, -((now.getDay() + 6) % 7))), out = [];
  for(let k = 11; k >= 1; k--) out.push({ start: addDays(monday, -7 * k), end: addDays(monday, -7 * (k - 1) - 1) });
  out.push({ start: monday, end: now, now: true });
  return out;
}
// One letter a week, oldest first: g healthy · y watch · r at risk · h handled and settling · '' not a client yet.
function healthTrail(c, h, weeks){
  return weeks.map(w => {
    if(w.now) return h.quiet ? 'h' : h.level;
    const v = healthLevelsAt(w.end)[c.id];
    if(!v) return '';
    return v.level === 'g' && v.raw !== 'g' ? 'h' : v.level;
  });
}
const HL_WORD = { g: 'Healthy', y: 'Watch', r: 'At risk', h: 'Handled', '': 'Not a client yet' };
function healthWeekLabel(w){ return w.now ? 'This week' : 'Week of ' + fmtShortDate(w.start); }
function healthTrailHtml(hist, cls){
  const n = k => hist.filter(x => x === k).length;
  const aria = `Last 12 weeks: ${[['r', 'at risk'], ['y', 'watch'], ['g', 'healthy']].filter(([k]) => n(k)).map(([k, t]) => `${n(k)} ${t}`).join(', ') || 'no history'}`;
  return `<div class="tl${cls ? ' ' + cls : ''}" role="img" aria-label="${aria}">${hist.map((k, i) => `<span class="tl-s${i === hist.length - 1 ? ' now' : ''}" data-w="${i}">${k ? `<i class="${k}"></i>` : ''}</span>`).join('')}</div>`;
}
// Month names under the 12 weeks, at the first week that starts in each month, and This week at the end.
function healthAxisHtml(weeks){
  return `<div class="cz-ax" aria-hidden="true">${weeks.map((w, i) => {
    const t = w.now ? 'This week' : (i >= 1 && i <= 9 && w.start.getMonth() !== weeks[i - 1].start.getMonth()) ? w.start.toLocaleDateString('en-US', { month: 'short' }) : '';
    return `<span>${t ? `<em>${t}</em>` : ''}</span>`;
  }).join('')}</div>`;
}
// "Healthy for 5 weeks; at risk in September" — the story of a healthy client, from its 12 weeks.
function healthyWhy(hist){
  const known = hist.filter(Boolean);
  let n = 0; for(let i = hist.length - 1; i >= 0 && (hist[i] === 'g'); i--) n++;
  const lastBad = hist.map((k, i) => [k, i]).filter(([k]) => k === 'r' || k === 'y' || k === 'h').pop();
  if(!lastBad) return known.length >= hist.length ? 'Healthy all 12 weeks' : `Healthy since it started, ${known.length} week${known.length === 1 ? '' : 's'} ago`;
  const w = healthWeeks()[lastBad[1]], worst = hist.slice(0, lastBad[1] + 1).slice(-6).includes('r') ? 'at risk' : 'on watch';
  return `Healthy for ${n} week${n === 1 ? '' : 's'}; ${worst} in ${w.start.toLocaleDateString('en-US', { month: 'long' })}`;
}

function renderHealth(){
  const root = document.getElementById('healthRoot');
  if(!root || typeof clients === 'undefined') return;
  _healthPast = { key: '', at: {} };
  const now = rNow(), T = healthThresholds(), me = myName(), everyone = seesEveryone();
  const weeks = healthWeeks(), weekAgo = healthLevelsAt(weeks[10].end);
  const scope = healthScopeClients();
  const owners = everyone ? [...new Set(scope.map(c => clientOwner(c)).filter(Boolean))].sort() : [];
  if(window._hlOwner && !owners.includes(window._hlOwner)) window._hlOwner = null;
  const all = scope.filter(c => !window._hlOwner || clientOwner(c) === window._hlOwner).map(c => {
    const h = clientHealth(c), next = nextStepTask(c), hist = healthTrail(c, h, weeks);
    const need = h.level !== 'g', settling = h.quiet && h.rawLevel !== 'g', was = weekAgo[c.id] ? weekAgo[c.id].level : 'g';
    const group = (need && next) || settling ? 'fix' : need ? (was === 'g' ? 'new' : 'long') : 'ok';
    let streak = 0; for(let i = hist.length - 1; i >= 0 && (hist[i] === 'r' || hist[i] === 'y'); i--) streak++;
    return { c, h, next, hist, group, streak, lv: settling ? 'h' : h.level };
  });
  const order = { r: 0, y: 1, h: 2, g: 3 };
  const by = k => all.filter(x => x.group === k).sort((a, b) => order[a.lv] - order[b.lv] || (b.c.importance || 0) - (a.c.importance || 0) || a.c.name.localeCompare(b.c.name));
  const G = { new: by('new'), long: by('long'), fix: by('fix'), ok: by('ok') };
  const sel = window._healthSel ? all.find(x => x.c.id === window._healthSel) : null;
  const reminded = window._hlReminded || (window._hlReminded = {});
  // the new look: plain buttons on the rows, counts and the healthy names in the group heads
  const uw = typeof uiStyleOn === 'function' && uiStyleOn();

  // ---- a row: who, 12 weeks, how it is now, why, the one action ----
  let primaryUsed = false;
  const row = x => {
    const { c, h, next } = x, owner = clientOwner(c), s = h.short;
    let why = '', act = '';
    if(x.group === 'ok') why = healthyWhy(x.hist);
    else if(h.quiet){ const hd = healthHandled[c.id], until = hd ? addDays(new Date(hd.at), T.quietDays) : null;
      const d = hd ? new Date(hd.at) : null, wd = d ? weekDay(d) : '', when = !d ? '' : wd === 'Today' ? ' today' : /^[A-Z][a-z]{2}$/.test(wd) ? ' on ' + d.toLocaleDateString('en-US', { weekday: 'long' }) : ' on ' + wd;
      why = `Handled${hd ? ' by ' + firstName(hd.by) + when : ''} · healthy again ${until ? fmtShortDate(until) : 'soon'} if it holds`; }
    else if(next){ const who = (teamProfiles.find(p => p.id === next.assigneeId) || {}).name;
      why = `Next: ${next.title}${who ? ' · ' + firstName(who) : ''}${next.dueDate ? ' · ' + weekDay(new Date(next.dueDate + 'T12:00:00')) : ''}`;
      act = `<button class="btn sm" onclick="event.stopPropagation();openTaskDetailModal('${next.id}')">Open Task</button>`; }
    else {
      why = tableSignal(h, c) || (s ? s.title : 'Needs care');
      if(s && s.key === 'quiet' && owner && owner !== me) act = reminded[c.id] ? `<span class="hx-done">${icon('check')}Reminded</span>`
        : `<button class="btn sm" onclick="event.stopPropagation();healthRemind('${c.id}')">Remind ${escapeHtml(firstName(owner))}</button>`;
      else if(s && s.key === 'quiet' && !everyone) act = `<button class="btn sm" onclick="event.stopPropagation();openQueueLogImprovementModal('${c.id}')">Log Improvement</button>`;
      else { act = `<button class="btn sm${primaryUsed || uw ? '' : ' btn-p'}" onclick="event.stopPropagation();planNextStep('${c.id}')">Plan Next Step</button>`; primaryUsed = true; }
    }
    const st = x.lv === 'g' ? '' : `<span class="hx-st ${x.lv}"><i></i>${x.lv === 'h' ? 'Settling' : HL_WORD[x.lv]}</span>`;
    return `<div class="hx-row${sel && sel.c.id === c.id ? ' on' : ''}" role="button" tabindex="0" data-h="${x.hist.map(k => k || '.').join('')}" onclick="selectHealthClient('${c.id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();selectHealthClient('${c.id}')}">
<div class="hx-nm"><b>${escapeHtml(c.name)}</b><span>${escapeHtml(everyone ? owner || 'No owner' : c.service || '')}</span></div>
${healthTrailHtml(x.hist)}<span class="hx-stc">${st}<span class="hx-st then"><i></i></span></span><span class="hx-why">${escapeHtml(why)}</span><span class="hx-act">${act}</span></div>`;
  };
  const info = (title, text) => `<span class="hx-i" tabindex="0" role="button" aria-label="About ${title}">${icon('info')}<span class="hx-tip" role="tooltip">${text}</span></span>`;
  const names = list => { const n = list.map(x => x.c.name), k = n.length > 3 ? 3 : n.length - 1;
    return n.length < 2 ? n.join('') : `${n.slice(0, k).join(', ')} and ${n.length > 3 ? n.length - 3 + ' more' : n[k]}`; };
  const uwCount = k => uw ? `<span class="hx-gn">${G[k].length}</span>` : '';
  const uwTail = k => !uw ? '' : k === 'ok' ? `<span class="hx-gl">${escapeHtml(names(G.ok))}</span>` : '<span class="hx-gw">Last 12 weeks</span>';
  const group = (k, title, text, extra) => G[k].length ? `<section class="hx-g${uw ? ' is-' + k : ''}"><div class="hx-gh"><b>${title}</b>${uwCount(k)}${info(title, text)}${uwTail(k)}${extra || ''}</div>${k === 'ok' ? `<div class="hx-x${window._hlOk ? ' open' : ''}"><div class="hx-xi">${G[k].map(row).join('')}</div></div>` : G[k].map(row).join('')}</section>` : '';
  const needN = G.new.length + G.long.length + G.fix.filter(x => x.lv === 'r' || x.lv === 'y').length;
  const okOnly = !G.new.length && !G.long.length && !G.fix.length;
  if(okOnly && window._hlOk === undefined) window._hlOk = true;

  // ---- the headline: how many need care and how many of them are new; the longest-running one ----
  const longest = G.long.slice().sort((a, b) => b.streak - a.streak)[0];
  const own = window._hlOwner ? firstName(window._hlOwner) + '’s' : '';
  // "your clients" when Show is on My clients (the same clients All Clients shows, myClientsOn)
  const scoped = myClientsOn();
  const who = !scoped && !own ? `${needN} client${needN === 1 ? '' : 's'}` : `${needN} of ${own || 'your'} clients`;
  const headline = !all.length ? '' : needN ? `${who} need${needN === 1 ? 's' : ''} care${G.new.length ? `, ${G.new.length === needN ? (needN === 1 ? 'new' : needN === 2 ? 'both' : 'all') : G.new.length + ' of them'} new this week` : ''}`
    : !scoped && !own ? 'Every client is healthy' : `All of ${own || 'your'} clients are healthy`;
  const show = myClientsSplit().has ? `<label class="pop-wrap">Show: <select class="pop" onchange="setClientsMine(this.value)"><option value="mine"${scoped ? ' selected' : ''}>My clients</option><option value="all"${scoped ? '' : ' selected'}>All clients</option></select></label>` : '';
  const slipped = G.new.length ? `${G.new.length === 1 ? 'One' : G.new.length} slipped this week${G.new.every(x => x.hist.slice(0, 11).filter(Boolean).every(k => k === 'g')) ? ' after a quiet quarter' : ''}.` : '';
  const subline = [slipped,
    longest ? `${longest.c.name} has needed care for ${longest.streak} weeks, with no plan yet.` : '',
    !needN && all.length ? 'Nothing needs care right now.' : ''].filter(Boolean).join(' ');
  const seg = owners.length > 1 ? `<div class="seg" role="tablist" aria-label="Whose clients">${[['', 'Everyone'], ...owners.map(o => [o, firstName(o)])].map(([o, t]) =>
    `<button class="${(window._hlOwner || '') === o ? 'on' : ''}" role="tab" aria-selected="${(window._hlOwner || '') === o}" onclick="setHealthOwner(${o ? jsArg(o) : 'null'})">${escapeHtml(t)}</button>`).join('')}</div>` : '';

  const body = !activeClients().length ? emptyNoClients('Health watches each client’s updates, hours and follow-ups, and flags the ones slipping.')
    : !all.length ? `<p class="hx-none">${window._hlOwner ? escapeHtml(firstName(window._hlOwner)) + ' has no clients.' : 'No clients yet.'}</p>`
    : `<div class="hx-grid">${group('new', 'Slipped this week', 'They were healthy last week')}${group('long', 'Needing care for weeks', 'Two weeks or more, and no plan yet')}
${group('fix', 'Being fixed', 'A plan is underway, or it was handled and is settling')}${group('ok', 'Healthy', 'Nothing needs care right now', `<button class="lnk" onclick="hlToggleOk(this)">${window._hlOk ? 'Hide' : 'Show ' + G.ok.length}</button>`)}</div>`;

  root.innerHTML = `<div class="spw"><div class="sp-page"><div class="hx">
<div class="hx-top"><div><h1 class="hx-h">${escapeHtml(headline)}</h1>${subline ? `<p class="hx-s">${uw && slipped ? `<b>${escapeHtml(slipped)}</b>${escapeHtml(subline.slice(slipped.length))}` : escapeHtml(subline)}</p>` : ''}</div><div class="hx-ctl">${show}${seg}</div></div>
${body}</div></div>${sel ? healthPanelHtml(sel.c, sel.h) : ''}</div>`;
  root._hlWeeks = weeks;
  hlBindScrub(root);
  if(currentViewName === 'health') setToolbar('Health', !scoped ? 'How clients are doing, and who is fixing what' : 'How your clients are doing');
}

function healthRemind(id){
  Promise.resolve(remindHolder(id)).then(who => { if(who){ (window._hlReminded || (window._hlReminded = {}))[id] = true; renderHealth(); } });
}
// Show / Hide the healthy clients without redrawing, so the rows can arrive.
function hlToggleOk(btn){
  window._hlOk = !window._hlOk;
  const x = btn.closest('.hx-g')?.querySelector('.hx-x'); if(x) x.classList.toggle('open', window._hlOk);
  btn.textContent = window._hlOk ? 'Hide' : 'Show ' + (x ? x.querySelectorAll('.hx-row').length : '');
}

// Scrubbing: hover a week and every row shows that week; the week you're on gets a date tag.
// It tracks the pointer 1:1 (no redraw, no animation); letting go fades back.
function hlBindScrub(root){
  const weeks = root._hlWeeks || healthWeeks();
  const grid = root.querySelector('.hx-grid');
  if(grid){
    let cur = null, tip = null;
    const set = (i, slot) => {
      if(i === cur && (!slot || (tip && tip.parentNode === slot))) return;
      cur = i;
      grid.classList.toggle('scrub', i != null);
      grid.querySelectorAll('.tl-s.hv').forEach(s => s.classList.remove('hv'));
      if(tip){ tip.remove(); tip = null; }
      if(i == null) return;
      grid.querySelectorAll(`.tl-s[data-w="${i}"]`).forEach(s => s.classList.add('hv'));
      grid.querySelectorAll('.hx-row').forEach(r => {
        const k = (r.dataset.h || '')[i], then = r.querySelector('.hx-st.then'); if(!then) return;
        const kk = k === '.' ? '' : k;
        then.className = 'hx-st then ' + (kk || 'none');
        then.lastChild.nodeType === 3 ? (then.lastChild.textContent = HL_WORD[kk]) : then.appendChild(document.createTextNode(HL_WORD[kk]));
      });
      if(slot){ tip = document.createElement('span'); tip.className = 'tl-tip'; tip.textContent = healthWeekLabel(weeks[i]); slot.appendChild(tip); }
    };
    grid.addEventListener('mouseover', e => {
      const s = e.target.closest('.tl-s');
      if(s && grid.contains(s)) set(+s.dataset.w, s);
      else if(e.target.closest('.hx-nm, .hx-stc, .hx-why, .hx-act, .hx-gh')) set(null);
    });
    grid.addEventListener('mouseleave', () => set(null));
  }
  const tl = root.querySelector('.sp .cz-tl');
  if(tl){
    const ro = root.querySelector('.sp .hx-ro'), hist = tl.dataset.h || '';
    const set = i => {
      tl.classList.toggle('scrub', i != null);
      tl.querySelectorAll('.tl-s.hv').forEach(s => s.classList.remove('hv'));
      if(i != null) tl.querySelector(`.tl-s[data-w="${i}"]`)?.classList.add('hv');
      if(ro){ ro.querySelector('b').textContent = i == null ? 'The last 12 weeks' : healthWeekLabel(weeks[i]); ro.querySelector('span').textContent = i == null ? '' : HL_WORD[hist[i] === '.' ? '' : hist[i]]; }
    };
    tl.addEventListener('mouseover', e => { const s = e.target.closest('.tl-s'); if(s) set(+s.dataset.w); });
    tl.addEventListener('mouseleave', () => set(null));
  }
}

// The panel: how bad, the next step, why, the 12 weeks, hours, the last 8 updates and what changed.
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
  const weeks = healthWeeks(), hist = healthTrail(c, h, weeks);
  const trail = `<div class="sp-sec hx-ro"><b>The last 12 weeks</b><span></span></div>${healthTrailHtml(hist, 'cz-tl').replace('<div class="tl cz-tl"', `<div class="tl cz-tl" data-h="${hist.map(k => k || '.').join('')}"`)}${healthAxisHtml(weeks)}`;
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
${trail}
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
