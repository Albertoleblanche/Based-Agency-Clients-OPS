// The Dashboard in the new look (beta; css/widget-look.css), as on the canvas board "Every tab in the
// widget style" → Dashboard. Only drawn while <html> has .ui-w (session.js); everyone else keeps
// dashboard.js's cards. Same data as dashboard.js: todayModel() for Today's focus, dbHealthModel()
// for Health and Needs care, dbMyTasks(), the calendar, reminders and WhatsApp lists.
//   Hello line · Today's focus (6) · Health (3) · WhatsApp over Reminders (3)
//   Needs care (5) · Tasks (4) · Calendar (3)
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
  else if(w.logged && w.logged.length) done = 1;    // work logged, no draft yet
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
  const cells = [].concat(Array(m.g).fill('g'), Array(m.y).fill('am'), Array(m.r).fill('r'));
  const dash = cells.map(c => `<i class="${c}"></i>`).join('');
  return `<section class="uw-w uw-s3 uw-hc" aria-label="Health">${uwHead('health', dbNavIcon('health'), 'Health', `<span class="uw-sp">${uwPill('Details', go)}</span>`)}
<div class="uw-hb"><div class="uw-big">${pct}<small>%</small></div><div class="uw-bigsub">healthy, ${m.g} of ${m.tot} clients</div></div>
<div class="uw-dash${cells.length > 28 ? ' is-many' : ''}" role="img" aria-label="At risk ${m.r}, To watch ${m.y}, Healthy ${m.g}">${dash}</div>
<div class="uw-lg"><div><b>${m.r}</b><span><i class="r"></i>At risk</span></div><div><b>${m.y}</b><span><i class="am"></i>To watch</span></div><div><b>${m.g}</b><span><i class="g"></i>Healthy</span></div></div></section>`;
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
    .sort((a, b) => (a.followUpDate || '9999').localeCompare(b.followUpDate || '9999'));
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
    return `${gl}<a class="uw-cr" href="#" onclick="dbOpenHealth('${c.id}');return false;"><span class="uw-st ${x.h.level === 'r' ? 'r' : 'am'}"></span><span class="uw-cm"><b>${uwEsc(c.name)}</b><span>${uwEsc(tableSignal(x.h, c) || '')}</span></span>${badge}${icon('chevron-right')}</a>`;
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
    return `<a class="uw-ce${past ? ' is-past' : ''}" href="#" onclick="openEventDetailModal('${e.id}');return false;"><span class="uw-t">${e.allDay ? 'ALL DAY' : uwEsc(fmtTime(new Date(e.startAt)).toUpperCase())}</span><span class="uw-e"><b>${uwEsc(e.title || 'Untitled')}</b>${sub ? `<span>${uwEsc(sub)}</span>` : ''}</span></a>`;
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
${uwCareCard(m, 3)}${uwTasksCard(4)}${uwCalendarCard(5)}</div></div>`;
  } catch(e){
    console.error('Dashboard (new look)', e);
    html = `<div class="uwd">${emptyState({ icon: 'refresh-cw', title: 'The dashboard couldn’t be shown', text: String(e && e.message || e), action: 'Try Again', onAction: 'renderDashboard()' })}</div>`;
  }
  root.innerHTML = html;
  if(currentViewName === 'overview' && typeof renderGreeting === 'function') renderGreeting();
}
