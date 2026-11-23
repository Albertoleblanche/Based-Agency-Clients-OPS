// The Dashboard in the new look (beta; css/widget-look.css), as on the canvas board "Every tab in the
// widget style" → Dashboard. Only drawn while <html> has .ui-w (session.js); everyone else keeps
// dashboard.js's cards. Same data as dashboard.js: todayModel() for Today's focus, dbHealthModel()
// for Health and Needs care, dbMyTasks(), the calendar, reminders and WhatsApp lists.
//   Hello line · Today's focus (6) · Health (3) · WhatsApp over Reminders (3)
//   Needs care (5) · Tasks over Hours (4) · Calendar (3)
// Loaded after dashboard.js.

function uwOn(){ return document.documentElement.classList.contains('ui-w'); }
const uwEsc = s => escapeHtml(String(s == null ? '' : s));
function uwPill(label, go){ return `<button class="uw-pill" type="button" onclick="${go}">${uwEsc(label)}${icon('chevron-right')}</button>`; }
function uwHead(view, ic, title, right, count){
  return `<div class="uw-wh"><span class="uw-ic">${ic}</span><span class="uw-wt">${uwEsc(title)}</span>${count ? `<span class="uw-cnt">${count}</span>` : ''}${right || ''}</div>`;
}
function uwNone(text){ return `<p class="uw-none">${icon('circle-check')}${uwEsc(text)}</p>`; }

// ---- Today's focus: the one thing to do now (a client update shows how far it got), and Next ----
// The four steps of a client update: work logged, a draft, review, sent.
function uwSteps(w){
  const written = !!w.draft;
  let done;
  if(w.sent) done = 4;
  else if(w.done >= 3) done = 3;                    // approved, ready to send
  else if(w.done === 2 || written) done = 2;        // in review, or a draft waiting to go for review
  else if(w.forEmail && w.forEmail.length) done = 1;    // work for the email logged, no draft yet
  else done = 0;
  const names = ['Logged', 'Draft', 'Review', 'Sent'];
  return `<div class="uw-stp" aria-label="${uwEsc(done >= 4 ? 'Sent' : names[done] + ' is next')}">${names.map((n, i) =>
    `<div class="uw-sg${i < done ? ' done' : i === done ? ' cur' : ''}"><i></i><span>${n.toUpperCase()}</span></div>`).join('')}</div>`;
}
function uwFocusModel(){
  const m = todayModel(), L = m.lead;
  const queue = L && L.item ? m.items.slice(1) : m.items.slice();
  const open = (L ? 1 : 0) + queue.length;
  const overdue = (L && L.item && L.item.late ? 1 : 0) + queue.filter(x => x.late).length;
  return { m, L, queue, open, overdue };
}
const UW_KIND = { task: 'Task', wa: 'WhatsApp', follow: 'Follow-up', note: 'Note', review: 'Review', health: 'Health', update: 'Client update' };
function uwFocusCard(f){
  const L = f.L;
  let now;
  if(L){
    const x = L.item, upd = L.c && !x;
    const kind = upd ? 'Client update' : x ? (UW_KIND[x.src] || 'Now') : 'Review';
    const title = upd ? L.c.name : L.title;
    const sub = L.subHtml || uwEsc(L.sub || '');
    const steps = upd && typeof clientWeek === 'function' ? uwSteps(clientWeek(L.c)) : '';
    now = `<div class="uw-fn"><div class="uw-mono">NOW · ${uwEsc(kind.toUpperCase())}</div><h3>${uwEsc(title)}</h3><p>${sub}</p></div>${steps}
<div class="uw-fa"><button class="uw-wb" type="button" onclick="${L.go}">${uwEsc(L.label || 'Open')}${icon('arrow-right')}</button></div>`;
  } else {
    now = `<div class="uw-fn"><div class="uw-mono">NOW</div><h3>You’re clear for today.</h3><p>Nothing else is due today.</p></div>`;
  }
  const nx = f.queue[0];
  const next = nx ? `<a class="uw-nx" href="#" onclick="${nx.go};return false;"><span class="uw-mono">NEXT</span><b>${uwEsc(nx.title)}</b>${nx.when ? `<em class="${nx.late ? 'uw-risk' : ''}">${uwEsc(nx.when)}</em>` : ''}</a>` : '';
  const more = f.queue.length > 1 ? uwPill(`${f.queue.length - 1} more`, 'wkEnterWeek()') : uwPill('This week', 'wkEnterWeek()');
  return `<section class="uw-w uw-s6 uw-fx" aria-label="Today’s focus">${uwHead('', icon('sun'), 'Today’s focus', `<span class="uw-sp">${more}</span>`)}${now}${next}</section>`;
}

// ---- Health: the score, a bar per client, the three counts ----
function uwHealthCard(m){
  const go = "switchView('health')";
  if(!m.tot) return `<section class="uw-w uw-s3 uw-hc">${uwHead('health', dbNavIcon('health'), 'Health', `<span class="uw-sp">${uwPill('Details', go)}</span>`)}${uwNone('No clients to watch yet.')}</section>`;
  const pct = Math.round(m.g / m.tot * 100);
  const cells = [].concat(Array(m.g).fill('g'), Array(m.y).fill('y'), Array(m.r).fill('r'));
  const dash = `<canvas aria-hidden="true"></canvas>`;   // drawn by uwDashFit, in whole screen pixels
  return `<section class="uw-w uw-s3 uw-hc" aria-label="Health">${uwHead('health', dbNavIcon('health'), 'Health', `<span class="uw-sp">${uwPill('Details', go)}</span>`)}
<div class="uw-hb"><div class="uw-big">${pct}<small>%</small></div><div class="uw-bigsub">healthy, ${m.g} of ${m.tot}${typeof canApprove === 'function' && !canApprove() ? ' of your clients' : ' clients'}</div></div>
<div class="uw-dash${cells.length > 28 ? ' is-many' : ''}" data-c="${cells.join('')}" role="img" aria-label="At risk ${m.r}, To watch ${m.y}, Healthy ${m.g}">${dash}</div>
<div class="uw-lg"><div><b>${m.r}</b><span><i class="r"></i>At risk</span></div><div><b>${m.y}</b><span><i class="am"></i>To watch</span></div><div><b>${m.g}</b><span><i class="g"></i>Healthy</span></div></div></section>`;
}

// The Health bar (Nov 23), drawn on a canvas in whole screen pixels: lines 4px wide with clear gaps
// (6px or more), as many as fit the card and never more than 30, so it reads the same on a laptop as on
// a wide screen. With more clients than lines, each line is a share of them: the colours keep the
// proportions, and a group with even one client keeps at least one line. The counts are underneath.
// Every line is the same width at 100%, 125% and 150%; gaps differ by a pixel at most. Drawn again
// when the card resizes or the theme changes.
let uwDashRO = null, uwDashMO = null;
function uwDashFit(root){
  (root || document).querySelectorAll('.uw-dash').forEach(el => {
    if(typeof ResizeObserver === 'function'){
      uwDashRO = uwDashRO || new ResizeObserver(es => es.forEach(x => {
        const d = x.devicePixelContentBoxSize && x.devicePixelContentBoxSize[0];
        uwDashDraw(x.target.closest('.uw-dash'), d ? d.inlineSize : 0, d ? d.blockSize : 0);
      }));
      const cv = el.querySelector('canvas');
      try { uwDashRO.observe(cv, { box: 'device-pixel-content-box' }); } catch(e){ uwDashRO.observe(cv); }
    }
    uwDashDraw(el);
  });
  const mac = document.querySelector('.mac');
  if(mac && !uwDashMO && typeof MutationObserver === 'function'){
    uwDashMO = new MutationObserver(() => document.querySelectorAll('.uw-dash').forEach(d => uwDashDraw(d)));
    uwDashMO.observe(mac, { attributes: true, attributeFilter: ['data-theme'] });
  }
}
// ['g','g','y','r',…] squeezed into `lines` colours, in order, by share (largest remainder), every
// colour present keeping at least one line.
function uwDashShares(cells, lines){
  const n = cells.length; if(lines >= n) return cells.slice();
  const keys = ['g', 'y', 'r'], cnt = {}; keys.forEach(k => cnt[k] = cells.filter(c => c === k).length);
  const present = keys.filter(k => cnt[k]);
  const got = {}; present.forEach(k => got[k] = Math.max(1, Math.floor(cnt[k] * lines / n)));
  let left = lines - present.reduce((t, k) => t + got[k], 0);
  const rem = present.map(k => [k, cnt[k] * lines / n - Math.floor(cnt[k] * lines / n)]).sort((a, b) => b[1] - a[1]);
  for(let i = 0; left > 0 && rem.length; i++, left--) got[rem[i % rem.length][0]]++;
  while(left < 0){ const big = present.slice().sort((a, b) => got[b] - got[a])[0]; if(got[big] <= 1) break; got[big]--; left++; }
  return [].concat(...present.map(k => Array(got[k]).fill(k)));
}
function uwDashDraw(el, wDev, hDev){
  const cv = el && el.querySelector('canvas'), cells = el ? String(el.dataset.c || '').split('') : [];
  if(!cv || !cells.length) return;
  const dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect(), n = cells.length;
  // the observer's exact screen-pixel size when it agrees with the layout (it can lag a zoom change)
  const ew = Math.round(r.width * dpr), eh = Math.round(r.height * dpr);
  const W = wDev && Math.abs(wDev - ew) <= 1 ? wDev : ew, H = hDev && Math.abs(hDev - eh) <= 1 ? hDev : eh;
  if(!W || !H) return;
  if(cv.width !== W) cv.width = W;
  if(cv.height !== H) cv.height = H;
  const k = Math.max(2, Math.round(4 * dpr)), gMin = Math.max(2, Math.round(6 * dpr));
  const lines = Math.max(1, Math.min(n, 30, Math.floor((W + gMin) / (k + gMin))));
  const cols = uwDashShares(cells, lines);
  const room = W - lines * k, g = lines > 1 ? Math.floor(room / (lines - 1)) : 0, extra = lines > 1 ? room - g * (lines - 1) : 0;
  const cs = getComputedStyle(el), col = { g: cs.getPropertyValue('--uw-good'), y: cs.getPropertyValue('--uw-watch'), r: cs.getPropertyValue('--uw-risk') };
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  let x = lines > 1 ? 0 : Math.floor((W - k) / 2);
  cols.forEach((c, i) => {
    ctx.fillStyle = (col[c] || '').trim() || '#888';
    ctx.beginPath();
    if(ctx.roundRect) ctx.roundRect(x, 0, k, H, k / 2); else ctx.rect(x, 0, k, H);
    ctx.fill();
    // the leftover pixels go one to a gap, spread along the bar
    x += k + g + (Math.floor((i + 1) * extra / (lines - 1)) - Math.floor(i * extra / (lines - 1)));
  });
  el.dataset.k = k; el.dataset.lines = cols.join('');   // what was drawn (tests read it)
}

// ---- the two small cards: WhatsApp over Reminders (Notes when WhatsApp is off) ----
function uwWhatsappSmall(){
  const me = currentUser?.id, lead = typeof waCanManage === 'function' && waCanManage();
  const ws = waTasks.filter(t => t.status === 'open' && (lead || t.owner_user_id === me));
  const mine = ws.filter(t => t.owner_user_id === me).length;
  const long = ws.filter(t => t.first_seen && dbDayOffset(toDateStr(new Date(t.first_seen))) <= -3).length;
  const tag = !ws.length ? `<span class="uw-delta uw-sp">${icon('circle-check')}All clear</span>`
    : long ? `<span class="uw-delta bad uw-sp"><i></i>${long} waiting long</span>` : mine ? `<span class="uw-delta uw-sp" style="--c:var(--label)"><i></i>${mine} yours</span>` : '';
  return `<a class="uw-w uw-sm" href="#whatsapp" onclick="switchView('whatsapp');return false;" aria-label="WhatsApp">${uwHead('whatsapp', dbNavIcon('whatsapp'), dbTitle('whatsapp'), tag)}
<div class="uw-smb"><div class="uw-big md">${ws.length}</div><div class="uw-bigsub">open request${ws.length === 1 ? '' : 's'} from client groups</div></div></a>`;
}
function uwRemindersSmall(){
  const me = currentUser?.id, today = toDateStr(rNow()), tom = toDateStr(addDays(rNow(), 1));
  const rs = (typeof clientReminders !== 'undefined' ? clientReminders : []).filter(r => r.status === 'waiting' && (canApprove() || r.askedBy === me))
    .sort((a, b) => focusIdFirst(a.clientId, b.clientId) || (a.followUpDate || '9999').localeCompare(b.followUpDate || '9999'));
  const over = rs.filter(r => r.followUpDate && r.followUpDate < today).length;
  const soon = rs.filter(r => r.followUpDate === today || r.followUpDate === tom).length;
  const cells = rs.slice(0, 12).map(r => `<i class="${r.followUpDate && r.followUpDate < today ? 'od' : r.followUpDate === today || r.followUpDate === tom ? 'nx' : ''}"></i>`).join('');
  const sub = ['waiting on clients', over ? `<span class="uw-risk">${over} overdue</span>` : '', soon ? `${soon} today or tomorrow` : ''].filter(Boolean).join(', ');
  return `<a class="uw-w uw-sm" href="#reminders" onclick="switchView('reminders');return false;" aria-label="Reminders">${uwHead('reminders', dbNavIcon('reminders'), dbTitle('reminders'), cells ? `<span class="uw-rd uw-sp">${cells}</span>` : '')}
<div class="uw-smb"><div class="uw-big md">${rs.length}</div><div class="uw-bigsub">${sub}</div></div></a>`;
}
function uwNotesSmall(){
  const ns = (typeof notes !== 'undefined' ? notes : []).filter(x => !x.deletedAt).sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
  const n = ns[0], when = n && (n.updatedAt || n.createdAt);
  const body = n ? `<div class="uw-smb uw-nt"><b>${uwEsc(n.title || 'Untitled')}</b><span>${uwEsc(String(n.text || '').split('\n').map(l => l.trim()).find(l => l && !/^- \[/.test(l)) || '')}</span></div>` : uwNone('No notes yet.');
  return `<a class="uw-w uw-sm" href="#notes" onclick="${n ? `openNoteSheet('${n.id}')` : "switchView('notes')"};return false;" aria-label="Notes">${uwHead('notes', dbNavIcon('notes'), dbTitle('notes'), when ? `<span class="uw-mono uw-sp">${uwEsc(dbDayWord(toDateStr(new Date(when))).toUpperCase())}</span>` : '')}${body}</a>`;
}

// ---- Needs care: the clients that need attention, the most at risk first ----
function uwCareCard(m, n){
  const list = m.list.slice(0, n), rest = m.list.slice(n);
  let lastLvl = '';
  const rows = list.map(x => {
    const c = x.c, hp = x.h.hp || {};
    const gl = x.h.level !== lastLvl ? `<div class="uw-gl">${x.h.level === 'r' ? 'AT RISK' : 'TO WATCH'}</div>` : ''; lastLvl = x.h.level;
    const badge = hp.budget ? `<span class="uw-mv${hp.used > hp.budget ? ' bad' : ''}">${Math.round(hp.used)}/${hp.budget} H</span>` : '';
    return `${gl}<a class="uw-cr" href="#" onclick="dbOpenHealth('${c.id}');return false;"><span class="uw-st ${x.h.level === 'r' ? 'r' : 'am'}"></span><span class="uw-cm"><b>${uwEsc(c.name)}${focusMark(c)}</b><span>${uwEsc(tableSignal(x.h, c) || '')}</span></span>${badge}${icon('chevron-right')}</a>`;
  }).join('');
  const rr = rest.filter(x => x.h.level === 'r').length, ry = rest.length - rr;
  const foot = rest.length ? `<a class="uw-foot" href="#health" onclick="switchView('health');return false;">${[rr ? `${rr} more at risk` : '', ry ? `${ry} to watch` : ''].filter(Boolean).join(', ')}${icon('chevron-right')}</a>` : '';
  const body = m.list.length ? `<div class="uw-lst">${rows}</div>${foot}` : uwNone(m.tot ? 'Every client is healthy.' : 'No clients to watch yet.');
  return `<section class="uw-w uw-s5" aria-label="Needs care">${uwHead('health', icon('heart'), 'Needs care', `<span class="uw-sp">${uwPill(dbTitle('clients'), "switchView('clients')")}</span>`, m.list.length || '')}${body}</section>`;
}

// ---- Tasks: yours, the soonest first ----
function uwTasksCard(n){
  const ts = dbMyTasks(), today = toDateStr(rNow());
  const rows = ts.slice(0, n).map(t => {
    const c = t.clientId && clients.find(x => x.id === t.clientId), late = t.dueDate && t.dueDate < today;
    const when = t.dueDate ? dbDayWord(t.dueDate) : '';
    const sub = [c ? uwEsc(c.name) : '', when ? `<span class="${late ? 'uw-risk' : ''}">${uwEsc(when)}</span>` : ''].filter(Boolean).join(' · ') || 'No due date';
    return `<div class="uw-tr" role="button" tabindex="0" onclick="openTaskDetailModal('${t.id}')" onkeydown="if(event.key==='Enter'&&event.target===this)openTaskDetailModal('${t.id}')"><button class="uw-cb" type="button" role="checkbox" aria-checked="false" aria-label="Mark done: ${uwEsc(t.title)}" onclick="event.stopPropagation();moveTaskToStatus('${t.id}','done')"></button><span class="uw-tm"><b>${uwEsc(t.title)}</b><span>${sub}</span></span>${t.priority === 'high' ? `<span class="uw-flag" title="High priority">${icon('flag')}</span>` : ''}</div>`;
  }).join('');
  const body = ts.length ? `<div class="uw-tl">${rows}</div>${ts.length > n ? `<a class="uw-foot" href="#tasks" onclick="switchView('tasks');return false;">${ts.length - n} more${icon('chevron-right')}</a>` : ''}` : uwNone('No open tasks.');
  return `<section class="uw-w uw-s4" aria-label="Tasks">${uwHead('tasks', dbNavIcon('tasks'), dbTitle('tasks'), `<span class="uw-sp">${uwPill('All tasks', "switchView('tasks')")}</span>`, ts.length || '')}${body}</section>`;
}

// ---- Hours: yours this week, day by day, in the Reports chart's style (Nov 22) ----
// The total big with its trailing part dimmed, last week beside it, and Monday to Friday as wide
// rounded bars (a weekend day shows once it has time). Today is striped with the lime pill; the
// pill follows the pointer and the arrow keys. Bars are out of an 8-hour day, so a short day looks short.
function uwHoursModel(){
  const me = currentUser?.id, now = rNow(), today = toDateStr(now), wk0 = getWeekStart(now);
  const mine = (typeof timeEntries !== 'undefined' ? timeEntries : []).filter(e => e.userId === me);
  const sum = (from, to) => mine.filter(e => e.date >= from && e.date <= to).reduce((n, e) => n + (e.minutes || 0), 0);
  const days = Array.from({ length: 7 }, (_, i) => { const d = addDays(wk0, i), ds = toDateStr(d); return { d, ds, m: sum(ds, ds) }; })
    .filter((x, i) => i < 5 || x.m > 0 || x.ds === today);
  const total = days.reduce((n, x) => n + x.m, 0);
  const last = sum(toDateStr(addDays(wk0, -7)), toDateStr(addDays(wk0, -1)));
  return { days, total, last, today };
}
function uwHoursCard(compact){
  const { days, total, last, today } = uwHoursModel();
  const max = Math.max(480, ...days.map(x => x.m));
  const ti = days.findIndex(x => x.ds === today), lastWith = days.map(x => x.m > 0).lastIndexOf(true);
  const def = ti >= 0 && days[ti].m ? ti : lastWith >= 0 ? lastWith : Math.max(ti, 0);
  const bars = days.map(x => ({ m: x.m, h: x.m / max * 100, now: x.ds === today,
    x: x.ds === today ? 'Today' : x.d.toLocaleDateString('en-US', { weekday: 'short' }),
    long: x.ds === today ? 'Today' : x.d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) }));
  const [a, rest] = rcSplit(total);
  const lw = last ? `last week ${hrs(last)}` : '';
  const go = "switchView('time');switchTimeTab('reports')";
  // compact (a short window): the total sits beside the title, as the other cards' counts do
  const head = uwHead('time', dbNavIcon('time'), 'Hours', `<span class="uw-sp">${uwPill('Reports', go)}</span>`, compact ? `${a}<span class="d">${rest} this week</span>` : '');
  return `<section class="uw-w uw-hrs${compact ? ' is-compact' : ''}" aria-label="Hours">${head}
${compact ? '' : `<div class="uw-hsum"><div class="rc-big" aria-label="${hrs(total)} this week">${a}<span>${rest}</span></div><span class="rc-k">this week${lw ? ` · ${uwEsc(lw)}` : ''}</span></div>`}
${rcPlotHtml('uwh', bars, def, { cls: 'rc-sm', aria: 'Your hours by day this week. Use the left and right arrow keys to read each day.' })}</section>`;
}

// ---- Calendar: today, then the next days that have something ----
function uwCalendarCard(cap){
  const now = rNow(), todayStr = toDateStr(now), end = toDateStr(addDays(now, 6));
  const evs = (typeof calendarEvents !== 'undefined' ? calendarEvents : []).filter(e => e.startAt && !e.deletedAt)
    .map(e => ({ e, ds: toDateStr(new Date(e.startAt)) })).filter(x => x.ds >= todayStr && x.ds <= end)
    .sort((a, b) => a.ds.localeCompare(b.ds) || ((!!b.e.allDay) - (!!a.e.allDay)) || (new Date(a.e.startAt) - new Date(b.e.startAt)));
  const row = e => {
    const c = e.clientId && clients.find(x => x.id === e.clientId);
    const sub = c ? c.name : (e.endAt && !e.allDay ? 'Until ' + fmtTime(new Date(e.endAt)) : (e.description || '').split('\n')[0]);
    const past = !e.allDay && new Date(e.endAt || e.startAt) <= now;
    // the calendar's colours: client meetings blue, internal purple, deadlines red, tasks teal, reminders amber
    const tone = typeof calColor === 'function' ? calColor(e) : 'gray';
    return `<a class="uw-ce ${tone}${past ? ' is-past' : ''}" href="#" onclick="openEventDetailModal('${e.id}');return false;"><span class="uw-t">${e.allDay ? 'ALL DAY' : uwEsc(fmtTime(new Date(e.startAt)).toUpperCase())}</span><span class="uw-e"><b>${uwEsc(e.title || 'Untitled')}</b>${sub ? `<span>${uwEsc(sub)}</span>` : ''}</span></a>`;
  };
  const tod = evs.filter(x => x.ds === todayStr).map(x => x.e);
  let room = cap, html = `<div class="uw-dl"><span class="uw-mono">TODAY</span>${tod.length ? `<span class="uw-mono">${tod.length} EVENT${tod.length === 1 ? '' : 'S'}</span>` : '<span class="uw-cnone">No meetings</span>'}</div>`;
  tod.slice(0, room).forEach(e => { html += row(e); room--; });
  [...new Set(evs.filter(x => x.ds > todayStr).map(x => x.ds))].forEach(ds => {
    if(room <= 0) return;
    const es = evs.filter(x => x.ds === ds).map(x => x.e);
    html += `<div class="uw-dl"><span class="uw-mono">${uwEsc(dbDayWord(ds).toUpperCase())}</span><span class="uw-mono">${es.length} EVENT${es.length === 1 ? '' : 'S'}</span></div>`;
    es.slice(0, room).forEach(e => { html += row(e); room--; });
  });
  return `<section class="uw-w uw-s3" aria-label="Calendar">${uwHead('calendar', dbNavIcon('calendar'), dbTitle('calendar'), `<span class="uw-sp">${uwPill('Full calendar', "switchView('calendar')")}</span>`)}${html}</section>`;
}

// The page fits the window without scrolling (wide layout). Tasks over Hours give way in steps
// until it does: the Hours card goes compact, then Tasks lists two tasks, then one (its "N more"
// link has the rest). The narrow layout scrolls anyway, so it keeps everything.
function uwFitTasksHours(root){
  const stk = root.querySelector('.uw-stk.uw-s4'); if(!stk) return;
  if(getComputedStyle(stk).gridColumnStart !== 'span 4') return;
  const fits = () => root.scrollHeight <= root.clientHeight + 1;
  for(const [n, compact] of [[3, true], [2, true], [1, true]]){
    if(fits()) return;
    stk.innerHTML = uwTasksCard(n) + uwHoursCard(compact);
  }
}

// ---- the page ----
function uwRenderDashboard(root){
  let html;
  try{
    const f = uwFocusModel(), m = dbHealthModel(), wa = dbWaOn();
    const h = rNow().getHours(), hello = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    const name = firstName((typeof myName === 'function' ? myName() : '') || '');
    const sum = [f.overdue ? `<span class="uw-delta bad"><i></i>${f.overdue} overdue</span>` : '', f.open ? `${dbPlural(f.open, 'thing')} left today` : 'Nothing left today'].filter(Boolean).join('');
    html = `<div class="uwd"><header class="uw-hd"><h1>${hello}${name ? ', ' + uwEsc(name) : ''}</h1><div class="uw-fsub">${sum}</div></header>
<div class="uw-gr">${uwFocusCard(f)}${uwHealthCard(m)}<div class="uw-stk uw-s3">${wa ? uwWhatsappSmall() : uwNotesSmall()}${uwRemindersSmall()}</div>
${uwCareCard(m, 3)}<div class="uw-stk uw-s4">${uwTasksCard(3)}${uwHoursCard()}</div>${uwCalendarCard(5)}</div></div>`;
  } catch(e){
    console.error('Dashboard (new look)', e);
    html = `<div class="uwd">${emptyState({ icon: 'refresh-cw', title: 'The dashboard couldn’t be shown', text: String(e && e.message || e), action: 'Try Again', onAction: 'renderDashboard()' })}</div>`;
  }
  root.innerHTML = html;
  uwFitTasksHours(root);
  uwDashFit(root);
  if(typeof rcMount === 'function' && root.querySelector('.rc-plot[data-rc="uwh"]')) rcMount('uwh');
  if(currentViewName === 'overview' && typeof renderGreeting === 'function') renderGreeting();
}
