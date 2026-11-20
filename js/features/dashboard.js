// Dashboard (canvas "Dashboard", Nov 19): the first screen, in place of Today.
// Approvers get six outlined cards: Health, Tasks and Calendar, then Reminders, WhatsApp and Notes.
// Team members get the bento: Today's focus as the big first box (the one thing to do now, what's
// next, and how much of the day is done), then Tasks over Health, Calendar, and Reminders, WhatsApp
// and Notes. Each card shows what fits and links to the rest ("2 more in WhatsApp"). On a wide
// screen (2560 px) every card sits in one row at one height.

const DB_WIDE = 1800;
// How much each card lists, by who's looking and how wide the screen is.
const DB_N = {
  approver: { normal: { health: 4, tasks: 4, rem: 3, wa: 3, notes: 3 }, wide: { health: 5, tasks: 5, rem: 5, wa: 4, notes: 4 } },
  member: { normal: { tasks: 4, rem: 2, wa: 3, notes: 2, next: 3 }, wide: { tasks: 4, rem: 2, wa: 2, notes: 4, next: 5 } },
};
const DB_CAL_ROWS = 6;   // meetings listed on the Calendar card; the rest of the week is "N more"

function dbRoot(){ return document.getElementById('dashRoot'); }
function dbIsWide(){ const r = dbRoot(); return !!r && r.clientWidth >= DB_WIDE; }
// Each card wears its tab's own sidebar icon, so a card and its tab read as the same thing.
function dbNavIcon(view){ const s = document.querySelector(`#appSidebar .nav-item[data-view="${view}"] svg`); return s ? s.outerHTML : icon('circle'); }
function dbTitle(view){ return typeof viewTitle === 'function' ? viewTitle(view) : ((VIEW_TITLES[view] || [view])[0]); }
function dbCard(cls, view, title, count, body, link){
  const go = link === false ? '' : `<a class="x-lnk" href="#${view}" onclick="switchView('${view}');return false;">Open ${escapeHtml(dbTitle(view))}</a>`;
  return `<section class="db-card ${cls}" aria-label="${escapeHtml(title)}"><header class="db-h">${dbNavIcon(view)}<b>${escapeHtml(title)}</b>${count !== '' && count != null ? `<span class="n">${count}</span>` : ''}${go}</header>${body}</section>`;
}
function dbMore(n, view){ return n > 0 ? `<a class="db-more" href="#${view}" onclick="switchView('${view}');return false;">${n} more in ${escapeHtml(dbTitle(view))}</a>` : ''; }
function dbNone(text){ return `<p class="db-none">${icon('circle-check')}${escapeHtml(text)}</p>`; }
function dbPlural(n, one, many){ return `${n} ${n === 1 ? one : (many || one + 's')}`; }
// A day in words, either side of today: "Yesterday", "Today", "Tomorrow", "Thursday", "Nov 12".
function dbDayOffset(ds){ return Math.round((new Date(ds + 'T12:00:00') - new Date(toDateStr(rNow()) + 'T12:00:00')) / 864e5); }
function dbDayWord(ds){
  const k = dbDayOffset(ds), d = new Date(ds + 'T12:00:00');
  return k === 0 ? 'Today' : k === -1 ? 'Yesterday' : k === 1 ? 'Tomorrow' : Math.abs(k) < 7 ? DAY_NAMES[d.getDay()] : fmtShortDate(d);
}
// "Follow up yesterday", "Follow up today", "Follow up on Thursday", "Follow up Nov 20"
function dbFollowWord(ds){
  const k = dbDayOffset(ds), w = dbDayWord(ds);
  return 'Follow up ' + (k >= -1 && k <= 1 ? w.toLowerCase() : k > 1 && k < 7 ? 'on ' + w : w);
}
function dbSteps(text){ const all = (String(text || '').match(/^- \[[ xX]\]/gm) || []).length, done = (String(text || '').match(/^- \[[xX]\]/gm) || []).length; return { all, done }; }

// ---- Health ----
function dbHealthModel(){
  const hs = (typeof healthScopeClients === 'function' ? healthScopeClients() : attentionEligibleClients()).map(c => ({ c, h: clientHealth(c) }));
  const n = l => hs.filter(x => x.h.level === l).length;
  const list = hs.filter(x => x.h.level === 'r' || x.h.level === 'y').sort((a, b) => (a.h.level === 'r' ? 0 : 1) - (b.h.level === 'r' ? 0 : 1));
  return { r: n('r'), y: n('y'), g: n('g'), tot: hs.length, list };
}
function dbHealthTop(m, of){
  const pct = m.tot ? Math.round(m.g / m.tot * 100) : 0, w = k => `${(k / m.tot * 100).toFixed(2)}%`;
  const bar = [['red', m.r], ['yellow', m.y], ['green', m.g]].filter(x => x[1]).map(([c, k]) => `<i class="${c}" style="width:${w(k)}"></i>`).join('');
  const key = [['red', 'At risk', m.r], ['yellow', 'To watch', m.y], ['green', 'Healthy', m.g]].filter(x => x[2]).map(([c, t, k]) => `<span><i class="wb-dot ${c}"></i>${t} <b>${k}</b></span>`).join('');
  return `<div class="db-score"><b>${pct}%</b><span>healthy</span><em>${m.g} of ${m.tot}${of}</em></div>
<div class="wb-bar db-bar" role="img" aria-label="At risk ${m.r}, To watch ${m.y}, Healthy ${m.g}">${bar}</div><div class="wb-key db-key">${key}</div>`;
}
function dbOpenHealth(id){ window._healthSel = id; switchView('health'); }
function dbHealthCard(n){
  const m = dbHealthModel();
  if(!m.tot) return dbCard('db-health', 'health', 'Health', '', dbNone('No clients to watch yet.'));
  const rows = m.list.slice(0, n).map(x => `<li class="db-r db-hc db-go" onclick="dbOpenHealth('${x.c.id}')"><span class="db-dot ${x.h.level}" aria-label="${x.h.level === 'r' ? 'At risk' : 'To watch'}"></span><span class="db-tx"><b>${escapeHtml(x.c.name)}</b><span class="s">${escapeHtml(tableSignal(x.h, x.c) || '')}</span></span></li>`).join('');
  const body = dbHealthTop(m, canApprove() ? ' clients' : ' of your clients') + (m.list.length
    ? `<p class="db-sub">Needs care</p><ul class="db-l">${rows}</ul>${dbMore(m.list.length - n, 'health')}`
    : dbNone('Every client is healthy.'));
  return dbCard('db-health', 'health', 'Health', '', body);
}
// The member's small Health box: the score, the bar, and who needs care on one line.
function dbHealthSmall(){
  const m = dbHealthModel();
  const body = !m.tot ? dbNone('No clients to watch yet.') : dbHealthTop(m, '') + (m.list.length
    ? `<p class="bn-hw">Needs care: ${escapeHtml(m.list.map(x => x.c.name).join(', '))}</p>` : `<p class="bn-hw">Every client is healthy.</p>`);
  return dbCard('db-health bn-hsm', 'health', 'Health', '', body);
}

// ---- Tasks ----
function dbMyTasks(){
  return (typeof tasks !== 'undefined' ? tasks : []).filter(t => t.assigneeId === currentUser?.id && t.status !== 'done' && t.status !== 'in_review' && !t.cancelledAt)
    .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || (a.dueTime || '~').localeCompare(b.dueTime || '~') || ((b.priority === 'high') - (a.priority === 'high')));
}
// Ticking a circle strikes the row through, folds it away, then marks it done. (A task's circle opens
// Mark Done first, as on Tasks, so it doesn't fold until that's confirmed and the card draws again.)
function dbTick(btn, run){
  const row = btn.closest('.db-tk'); btn.setAttribute('aria-checked', 'true');
  if(row){ row.classList.add('is-done'); setTimeout(() => row.classList.add('is-gone'), 380); }
  setTimeout(run, row ? 700 : 0);
}
function dbTaskRow(t){
  const today = toDateStr(rNow()), c = t.clientId && clients.find(x => x.id === t.clientId), late = t.dueDate && t.dueDate < today;
  const st = dbSteps(t.description), when = t.dueDate ? (t.dueTime && t.dueDate === today ? fmtTime(new Date(t.dueDate + 'T' + t.dueTime)) : dbDayWord(t.dueDate)) : '';
  const sub = [c ? escapeHtml(c.name) : '', when ? `<span class="${late ? 't-red' : ''}">${escapeHtml(when)}</span>` : '', st.all ? `${st.done} of ${st.all} steps` : ''].filter(Boolean).join(' · ');
  return `<li class="db-tk"><div class="db-tki"><div class="db-r db-go" onclick="openTaskDetailModal('${t.id}')">
<button class="db-cb" type="button" role="checkbox" aria-checked="false" aria-label="Mark done: ${escapeHtml(t.title)}" onclick="event.stopPropagation();moveTaskToStatus('${t.id}','done')">${icon('check', { weight: 'bold' })}</button>
<span class="db-tx"><b>${escapeHtml(t.title)}</b><span class="s">${sub || 'No due date'}</span></span>${t.priority === 'high' ? `<span class="db-flag" title="High priority">${icon('flag')}</span>` : ''}</div></div></li>`;
}
function dbTasksCard(n){
  const ts = dbMyTasks(), today = toDateStr(rNow());
  const over = ts.filter(t => t.dueDate && t.dueDate < today).length, due = ts.filter(t => t.dueDate === today).length;
  const summ = [over ? `<span class="t-red">${over} overdue</span>` : '', due ? `${due} due today` : ''].filter(Boolean).join(' · ');
  // work you gave someone, back with you to check
  const back = (typeof tasks !== 'undefined' ? tasks : []).filter(t => t.assignerId === currentUser?.id && t.assigneeId !== currentUser?.id && t.status === 'in_review' && !t.cancelledAt);
  const check = back.length ? `<p class="db-sub">Ready for you to check</p><ul class="db-l">${back.slice(0, 1).map(t => {
    const who = (teamProfiles || []).find(p => p.id === t.assigneeId);
    return `<li class="db-r db-go" onclick="openTaskDetailModal('${t.id}')"><span class="db-ic">${icon('clipboard-check')}</span><span class="db-tx"><b>${escapeHtml(t.title)}</b><span class="s">${who ? escapeHtml(firstName(who.name)) + ' marked it ready' : 'Marked ready'}${back.length > 1 ? ` · ${back.length - 1} more` : ''}</span></span></li>`;
  }).join('')}</ul>` : '';
  const body = (summ ? `<p class="db-sum">${summ}</p>` : '') + (ts.length ? `<ul class="db-l">${ts.slice(0, n).map(dbTaskRow).join('')}</ul>` : dbNone('No open tasks.')) + check + dbMore(ts.length - n, 'tasks');
  return dbCard('db-tasks', 'tasks', 'Tasks', ts.length || '', body);
}

// ---- Calendar: today with a line at now, then the days after, up to six meetings ----
const DB_EV_TONE = { meeting: 'blue', client_meeting: 'green', deadline: 'red', reminder: 'yellow', other: 'purple' };
function dbCalendarCard(){
  const now = rNow(), todayStr = toDateStr(now), end = toDateStr(addDays(now, 6));
  const evs = (typeof calendarEvents !== 'undefined' ? calendarEvents : []).filter(e => e.startAt && !e.deletedAt)
    .map(e => ({ e, ds: toDateStr(new Date(e.startAt)) })).filter(x => x.ds >= todayStr && x.ds <= end)
    .sort((a, b) => (a.ds.localeCompare(b.ds)) || ((!!b.e.allDay) - (!!a.e.allDay)) || (new Date(a.e.startAt) - new Date(b.e.startAt)));
  const row = (e, past) => {
    const c = e.clientId && clients.find(x => x.id === e.clientId), first = (e.description || '').split('\n')[0];
    const sub = c ? c.name : first || (e.endAt && !e.allDay ? 'Until ' + fmtTime(new Date(e.endAt)) : '');
    const tone = DB_EV_TONE[e.eventType] || (c ? 'green' : 'blue');
    return `<li class="db-ev db-go${past ? ' is-past' : ''}" onclick="openEventDetailModal('${e.id}')"><time>${e.allDay ? 'All day' : fmtTime(new Date(e.startAt))}</time><i class="db-evb ${tone}"></i><span class="db-tx"><b>${escapeHtml(e.title || 'Untitled')}</b><span class="s">${escapeHtml(sub)}</span></span></li>`;
  };
  const nowLi = `<li class="db-now" aria-label="Now, ${fmtTime(now)}"><time>${fmtTime(now)}</time><i></i></li>`;
  // Today: what's left, after the last two that already happened
  const tod = evs.filter(x => x.ds === todayStr).map(x => x.e);
  const isPast = e => !e.allDay && new Date(e.endAt || e.startAt) <= now;
  const past = tod.filter(isPast), left = tod.filter(e => !isPast(e));
  const todayList = past.slice(-2).concat(left), todayRows = [];
  let rows = 0, placed = false, hidden = 0;
  todayList.forEach(e => {
    if(rows >= DB_CAL_ROWS){ if(!isPast(e)) hidden++; return; }
    if(!placed && !e.allDay && !isPast(e) && new Date(e.startAt) > now){ todayRows.push(nowLi); placed = true; }
    todayRows.push(row(e, isPast(e))); rows++;
  });
  if(!placed && rows < DB_CAL_ROWS) todayRows.push(nowLi);
  let html = `<p class="db-day"><b>Today</b><span>${left.length ? `${left.length} left` : tod.length ? 'Nothing else today' : 'No meetings'}</span></p><ul class="db-l db-agenda">${todayRows.join('')}</ul>`;
  // the days after, in order, while there's room
  const later = evs.filter(x => x.ds > todayStr);
  const days = [...new Set(later.map(x => x.ds))];
  const seen = new Set();
  for(const ds of days){
    if(rows >= DB_CAL_ROWS) break;
    seen.add(ds);
    const es = later.filter(x => x.ds === ds).map(x => x.e), take = es.slice(0, DB_CAL_ROWS - rows);
    html += `<p class="db-day"><b>${escapeHtml(dbDayWord(ds))}</b><span>${dbPlural(es.length, 'event')}</span></p><ul class="db-l db-agenda">${take.map(e => row(e, false)).join('')}</ul>`;
    rows += take.length; hidden += es.length - take.length;
  }
  // what's left of the week that the card doesn't list
  const more = hidden + later.filter(x => !seen.has(x.ds)).length;
  return dbCard('db-cal', 'calendar', 'Calendar', '', html + dbMore(more, 'calendar'));
}

// ---- Reminders: questions waiting on clients ----
function dbRemindersCard(n){
  const me = currentUser?.id, today = toDateStr(rNow());
  const rs = (typeof clientReminders !== 'undefined' ? clientReminders : []).filter(r => r.status === 'waiting' && (canApprove() || r.askedBy === me))
    .sort((a, b) => (a.followUpDate || '9999').localeCompare(b.followUpDate || '9999'));
  const over = rs.filter(r => r.followUpDate && r.followUpDate < today).length, due = rs.filter(r => r.followUpDate === today).length;
  const summ = ['Waiting on clients', over ? `<span class="t-red">${over} overdue</span>` : '', due ? `${due} to follow up today` : ''].filter(Boolean).join(' · ');
  const rows = rs.slice(0, n).map(r => {
    const c = clients.find(x => x.id === r.clientId), by = r.askedBy !== me && (teamProfiles || []).find(p => p.id === r.askedBy);
    const fw = r.followUpDate ? `<span class="${r.followUpDate < today ? 't-red' : ''}">${escapeHtml(dbFollowWord(r.followUpDate))}</span>` : (r.askedDate ? `Asked ${escapeHtml(dbDayWord(r.askedDate))}` : '');
    const sub = [c ? escapeHtml(c.name) : '', by ? `Asked by ${escapeHtml(firstName(by.name))}` : '', fw].filter(Boolean).join(' · ');
    return `<li class="db-r db-go" onclick="openReminderDetailModal('${r.id}')"><span class="db-tx"><b class="db-q">${escapeHtml(r.question || '')}</b><span class="s">${sub}</span></span></li>`;
  }).join('');
  const body = `<p class="db-sum">${summ}</p>` + (rs.length ? `<ul class="db-l">${rows}</ul>` : dbNone('Nothing waiting on a client.')) + dbMore(rs.length - n, 'reminders');
  return dbCard('db-rem', 'reminders', 'Reminders', rs.length || '', body);
}

// ---- WhatsApp: open requests from client groups ----
function dbWaOn(){ return typeof waTasks !== 'undefined' && !(typeof waHidden === 'function' && waHidden()); }
function dbWhatsappCard(n){
  const me = currentUser?.id, lead = typeof waCanManage === 'function' && waCanManage(), today = toDateStr(rNow());
  const ws = waTasks.filter(t => t.status === 'open' && (lead || t.owner_user_id === me)).sort((a, b) => new Date(a.first_seen) - new Date(b.first_seen));
  const mine = ws.filter(t => t.owner_user_id === me).length;
  const rows = ws.slice(0, n).map(t => {
    const ds = t.first_seen ? toDateStr(new Date(t.first_seen)) : today, wait = Math.max(0, -dbDayOffset(ds));
    const who = t.owner_user_id === me ? '<b class="db-you">Yours</b>' : escapeHtml(typeof waOwnerName === 'function' ? waOwnerName(t) : '');
    return `<li class="db-r db-wa db-go" onclick="waOpenItem(${jsArg(t.id)})"><span class="db-tx"><span class="db-wt"><b>${escapeHtml(typeof waClientLabel === 'function' ? waClientLabel(t) : (t.client || ''))}</b><time>${escapeHtml(dbDayWord(ds))}</time></span><span class="db-wq">${escapeHtml(t.title || '')}</span><span class="s db-wo">${who}${wait >= 3 ? ` · <span class="t-red">Waiting ${wait} days</span>` : ''}</span></span></li>`;
  }).join('');
  const summ = lead && mine ? `From client groups · ${mine} yours` : 'From client groups';
  const body = `<p class="db-sum">${summ}</p>` + (ws.length ? `<ul class="db-l">${rows}</ul>` : dbNone('No open requests.')) + dbMore(ws.length - n, 'whatsapp');
  return dbCard('db-wa', 'whatsapp', 'WhatsApp', ws.length || '', body);
}

// ---- Notes: latest first ----
function dbNotesCard(n, compact){
  const ns = (typeof notes !== 'undefined' ? notes : []).filter(x => !x.deletedAt).sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
  const snippet = t => { for(const line of String(t || '').split('\n')){ const l = line.trim(); if(l && !/^- \[/.test(l) && !l.endsWith(':')) return l.replace(/^#+\s*/, ''); } return ''; };
  const rows = ns.slice(0, n).map(x => {
    const c = x.clientId && clients.find(y => y.id === x.clientId), st = dbSteps(x.text), when = x.updatedAt || x.createdAt;
    const sub = (c ? escapeHtml(c.name) : 'Your note') + (compact && st.all ? ` · ${st.done} of ${st.all} done` : '');
    const prog = !compact && st.all ? `<span class="db-prog"><span class="db-pb"><i style="width:${Math.round(st.done / st.all * 100)}%"></i></span>${st.done} of ${st.all} done</span>` : '';
    return `<li class="db-r db-note db-go" onclick="openNoteSheet('${x.id}')"><span class="db-tx"><span class="db-wt"><b>${escapeHtml(x.title || 'Untitled')}</b>${when ? `<time>${escapeHtml(dbDayWord(toDateStr(new Date(when))))}</time>` : ''}</span><span class="s">${sub}</span>${snippet(x.text) ? `<span class="db-sn">${escapeHtml(snippet(x.text))}</span>` : ''}${prog}</span></li>`;
  }).join('');
  const body = '<p class="db-sum">Latest first</p>' + (ns.length ? `<ul class="db-l">${rows}</ul>` : dbNone('No notes yet.')) + dbMore(ns.length - n, 'notes');
  return dbCard('db-notes', 'notes', 'Notes', ns.length || '', body);
}

// ---- Today's focus (members): the one thing to do now, what's next, and how much is done ----
const DB_SRC_ICON = { task: 'list-todo', wa: 'messages-square', follow: 'bell-ring', note: 'sticky-note', review: 'clipboard-check', health: 'activity', update: 'send' };
function dbToggleRest(btn){
  window._dbRestOpen = !window._dbRestOpen;
  const rx = btn.closest('.bn-next')?.querySelector('.bn-rx'); if(rx) rx.classList.toggle('open', window._dbRestOpen);
  btn.setAttribute('aria-expanded', window._dbRestOpen); btn.textContent = btn.dataset[window._dbRestOpen ? 'less' : 'more'];
}
function dbFocusCard(nextN){
  const m = todayModel(), now = rNow(), todayStr = toDateStr(now);
  const queue = m.lead && m.lead.item ? m.items.slice(1) : m.items.slice();
  const next = queue.slice(0, nextN), rest = queue.slice(nextN);
  const open = (m.lead ? 1 : 0) + queue.length;
  const overdue = (m.lead && m.lead.item && m.lead.item.late ? 1 : 0) + queue.filter(x => x.late).length;
  const evNext = (typeof calendarEvents !== 'undefined' ? calendarEvents : []).filter(e => !e.allDay && !e.deletedAt && e.startAt && toDateStr(new Date(e.startAt)) === todayStr && new Date(e.startAt) > now)
    .sort((a, b) => new Date(a.startAt) - new Date(b.startAt))[0];
  const evText = evNext ? `${evNext.title} at ${fmtTime(new Date(evNext.startAt))}` : '';
  const h = now.getHours(), hello = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const sum = [overdue ? `<span class="t-red">${overdue} overdue</span>` : '', open ? `${dbPlural(open, 'thing')} left today` : 'Nothing left today', evText ? escapeHtml(evText) : ''].filter(Boolean).join(' · ');
  // Now: the one main action, with its button
  let nowHtml;
  if(m.lead){
    const L = m.lead, x = L.item;
    const wa = !x && L.c && typeof winViaWhatsapp === 'function' && winViaWhatsapp(L.c) && /WhatsApp|Sent/.test(L.label || '');
    const ic = x ? DB_SRC_ICON[x.src] || 'circle' : wa ? 'messages-square' : L.ic || 'send';
    const tone = wa ? 'green' : x && x.src === 'task' ? '' : 'blue';
    const sub = L.subHtml || escapeHtml(L.sub || '');
    const second = x && x.src === 'task' ? `<button class="btn" type="button" onclick="${x.go}">Open Task</button>` : '';
    nowHtml = `<div class="bn-nowi"><span class="bn-ic ${tone}">${icon(ic)}</span><div class="bn-nt"><b>${escapeHtml(L.title)}${x && x.flag ? `<span class="db-flag" title="High priority">${icon('flag')}</span>` : ''}</b><span class="s">${sub}</span>
<div class="bn-acts"><button class="btn btn-p" type="button" onclick="${L.go}">${x && x.src === 'task' ? icon('check') : wa ? icon('copy') : ''}${escapeHtml(L.label || 'Open')}</button>${second}</div></div></div>`;
  } else {
    nowHtml = `<div class="bn-clear">${icon('circle-check')}<span><b>You’re clear for today.</b> ${evText ? `${escapeHtml(evText)} is next.` : 'Nothing else is due today.'}</span></div>`;
  }
  const row = x => {
    const tick = x.src === 'task' ? x.tick : `dbTick(this,()=>{${x.tick}})`;
    const lead = x.tick && x.src !== 'wa'
      ? `<button class="db-cb" type="button" role="checkbox" aria-checked="false" aria-label="${escapeHtml(x.tickLabel || 'Done')}: ${escapeHtml(x.title)}" onclick="event.stopPropagation();${tick}">${icon('check', { weight: 'bold' })}</button>`
      : `<span class="db-ic">${icon(DB_SRC_ICON[x.src] || 'circle')}</span>`;
    const when = x.when ? `<span class="${x.late ? 't-red' : ''}">${escapeHtml(x.when)}</span> · ` : '';
    const step = x.tick && x.src !== 'wa' ? '' : `<a class="x-lnk bn-open" href="#" onclick="event.stopPropagation();${x.go};return false;">${escapeHtml(x.step || 'Open')}</a>`;
    return `<li class="db-tk"><div class="db-tki"><div class="db-r db-go" onclick="${x.go}">${lead}<span class="db-tx"><b>${escapeHtml(x.title)}</b><span class="s">${when}${x.sub || ''}</span></span>${x.flag ? `<span class="db-flag" title="High priority">${icon('flag')}</span>` : ''}${step}</div></div></li>`;
  };
  const restOpen = !!window._dbRestOpen && rest.length;
  const nextHtml = next.length ? `<div class="bn-next"><p class="bn-lbl">Next</p><ul class="db-l">${next.map(row).join('')}</ul>
${rest.length ? `<div class="bn-rx${restOpen ? ' open' : ''}"><div class="bn-rxi"><ul class="db-l bn-rest">${rest.map(row).join('')}</ul></div></div>
<button class="db-more bn-tg" type="button" aria-expanded="${restOpen}" data-more="${rest.length} more" data-less="Show less" onclick="dbToggleRest(this)">${restOpen ? 'Show less' : `${rest.length} more`}</button>` : ''}</div>` : '';
  // how much of the day is done
  const total = m.done.length + open, segs = Math.min(total, 10), on = total ? Math.round(m.done.length / total * segs) : 0;
  const dots = segs ? `<span class="bn-seg" aria-hidden="true">${Array.from({ length: segs }, (_, i) => `<i${i < on ? ' class="on"' : ''}></i>`).join('')}</span>` : '';
  const last = m.done[0] ? `<span class="bn-last">Last: ${escapeHtml(m.done[0].title)}, ${fmtTime(m.done[0].t)}</span>` : '';
  const foot = total ? `<footer class="bn-done">${dots}<span class="bn-dw">${m.done.length} of ${total} done today</span>${last}</footer>` : '';
  const name = firstName((typeof myName === 'function' ? myName() : '') || '');
  return `<section class="db-card bn-focus" aria-label="Today’s focus"><header class="db-h">${icon('sun')}<b>Today’s focus</b></header>
<div class="bn-hi"><h2>${hello}${name ? ', ' + escapeHtml(name) : ''}</h2><p>${sum}</p></div>
<div class="bn-cols"><div class="bn-now"><p class="bn-lbl">Now</p>${nowHtml}</div>${nextHtml}</div>${foot}</section>`;
}

// ---- the page ----
function renderDashboard(){
  const root = dbRoot();
  if(!root || typeof clients === 'undefined' || typeof currentUser === 'undefined' || !currentUser) return;
  const wide = dbIsWide(), role = canApprove() ? 'approver' : 'member', N = DB_N[role][wide ? 'wide' : 'normal'], wa = dbWaOn();
  root._dbWide = wide;
  if((typeof tasksDataLoaded !== 'undefined' && !tasksDataLoaded) || (typeof calendarDataLoaded !== 'undefined' && !calendarDataLoaded)){
    root.innerHTML = skeletonHtml('dashboard', 'Loading your dashboard…'); dbWatchWidth(root); return;
  }
  let html;
  try{
    if(role === 'approver'){
      html = `<div class="db"><div class="db-grid${wa ? '' : ' no-wa'}">${dbHealthCard(N.health)}${dbTasksCard(N.tasks)}${dbCalendarCard()}${dbRemindersCard(N.rem)}${wa ? dbWhatsappCard(N.wa) : ''}${dbNotesCard(N.notes)}</div></div>`;
    } else {
      const rw = dbRemindersCard(N.rem) + (wa ? dbWhatsappCard(N.wa) : '');
      html = `<div class="db"><div class="bn-grid${wa ? '' : ' no-wa'}">${dbFocusCard(N.next)}<div class="bn-mid">${dbTasksCard(N.tasks)}${dbHealthSmall()}</div>${dbCalendarCard()}${wide ? `<div class="bn-pair">${rw}</div>` : rw}${dbNotesCard(N.notes, !wide)}</div></div>`;
    }
  } catch(e){
    console.error('Dashboard', e);
    html = `<div class="db">${emptyState({ icon: 'refresh-cw', title: 'The dashboard couldn’t be shown', text: String(e && e.message || e), action: 'Try Again', onAction: 'renderDashboard()' })}</div>`;
  }
  root.innerHTML = html;
  if(currentViewName === 'overview' && typeof renderGreeting === 'function') renderGreeting();
  dbWatchWidth(root);
}
// Crossing into (or out of) a wide screen changes how much each card lists, so it draws again.
function dbWatchWidth(root){
  if(root._dbRo || typeof ResizeObserver === 'undefined') return;
  root._dbRo = new ResizeObserver(() => { if(root.clientWidth && (root.clientWidth >= DB_WIDE) !== !!root._dbWide) renderDashboard(); });
  root._dbRo.observe(root);
}
// The week board (This Week) used to open from Today; it opens from the Dashboard's toolbar now.
VIEW_TOOLBAR_ACTIONS.overview = () => `<button class="btn" onclick="wkEnterWeek()">${icon('calendar-days')}This Week</button>`;
