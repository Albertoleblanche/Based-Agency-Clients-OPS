// Dashboard (canvas "Dashboard", Nov 19): the first screen, in place of Today.
// Approvers get six outlined cards: Health, Tasks and Calendar, then Reminders, WhatsApp and Notes.
// Team members get the bento: Today's focus as the big first box (the one thing to do now, what's
// next, and how much of the day is done), then Tasks over Health, Calendar, and Reminders, WhatsApp
// and Notes. The dashboard fills the window, side to side and top to bottom, with no scrolling:
// each card lists what fits its space and links to the rest ("2 more in WhatsApp"). On a wide
// screen every card sits in one row, and under them a table lists the clients that need
// attention, the most at risk first (Nov 20).

const DB_WIDE = 1800, DB_NARROW = 900;
// How much each card can list. On a laptop or a wide screen it lists up to this much, then drops
// rows from the end until the card fits (dbFit). On a narrow window the page scrolls instead, so
// each card keeps to a few.
const DB_CAP = { health: 12, tasks: 12, rem: 10, wa: 10, notes: 8, next: 10, table: 30, cal: 14 };
const DB_FEW = { health: 4, tasks: 4, rem: 3, wa: 3, notes: 3, next: 3, cal: 6 };

function dbRoot(){ return document.getElementById('dashRoot'); }
function dbMode(){ const r = dbRoot(), w = r ? r.clientWidth : 0; return !w ? 'normal' : w >= DB_WIDE ? 'wide' : w <= DB_NARROW ? 'narrow' : 'normal'; }
function dbIsWide(){ return dbMode() === 'wide'; }
// Each card wears its tab's own sidebar icon, so a card and its tab read as the same thing.
function dbNavIcon(view){ const s = document.querySelector(`#appSidebar .nav-item[data-view="${view}"] svg`); return s ? s.outerHTML : icon('circle'); }
function dbTitle(view){ return typeof viewTitle === 'function' ? viewTitle(view) : ((VIEW_TITLES[view] || [view])[0]); }
// A card. total: how many things it has (its "N more" link counts what isn't listed); min: the
// fewest rows it keeps; soft: rows it keeps before giving up an optional part (data-opt).
function dbCard(cls, view, title, count, body, o){
  o = o || {};
  const head = `${dbNavIcon(view)}<b>${escapeHtml(title)}</b>${count !== '' && count != null ? `<span class="n">${count}</span>` : ''}`;
  const more = o.total != null ? `<a class="db-more" href="#${view}" data-view="${view}" onclick="switchView('${view}');return false;" hidden></a>` : '';
  const data = o.total != null ? ` data-total="${o.total}" data-min="${o.min ?? 1}"${o.soft ? ` data-soft="${o.soft}"` : ''}` : '';
  const h = o.link === false ? `<header class="db-h">${head}</header>`
    : `<header class="db-h"><a class="db-hl" href="#${view}" onclick="switchView('${view}');return false;" aria-label="Open ${escapeHtml(dbTitle(view))}">${head}${icon('chevron-right')}</a></header>`;
  return `<section class="db-card ${cls}" aria-label="${escapeHtml(title)}"${data}>${h}${body}${more}</section>`;
}
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
// The clients that need attention, the most at risk first: at risk before to watch, then the most
// red signals, then the most signals, then the most important client.
function dbHealthModel(){
  const hs = (typeof healthScopeClients === 'function' ? healthScopeClients() : attentionEligibleClients()).map(c => ({ c, h: clientHealth(c) }));
  const n = l => hs.filter(x => x.h.level === l).length;
  const reds = x => x.h.signals.filter(s => s.l === 'r').length;
  const list = hs.filter(x => x.h.level === 'r' || x.h.level === 'y').sort((a, b) => focusFirst(a.c, b.c) || (a.h.level === 'r' ? 0 : 1) - (b.h.level === 'r' ? 0 : 1)
    || reds(b) - reds(a) || b.h.signals.length - a.h.signals.length || (b.c.importance || 0) - (a.c.importance || 0) || (b.c.danger || 0) - (a.c.danger || 0));
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
  const rows = m.list.slice(0, n).map(x => `<li class="db-r db-hc db-go" data-item onclick="dbOpenHealth('${x.c.id}')"><span class="db-dot ${x.h.level}" aria-label="${x.h.level === 'r' ? 'At risk' : 'To watch'}"></span><span class="db-tx"><b>${escapeHtml(x.c.name)}${focusMark(x.c)}</b><span class="s">${escapeHtml(tableSignal(x.h, x.c) || '')}</span></span></li>`).join('');
  const body = dbHealthTop(m, canApprove() ? ' clients' : ' of your clients') + (m.list.length
    ? `<p class="db-sub">Needs care</p><ul class="db-l">${rows}</ul>` : dbNone('Every client is healthy.'));
  return dbCard('db-health', 'health', 'Health', '', body, { total: m.list.length });
}
// The member's small Health box: the score, the bar, and who needs care on one line.
function dbHealthSmall(){
  const m = dbHealthModel();
  const body = !m.tot ? dbNone('No clients to watch yet.') : dbHealthTop(m, '') + (m.list.length
    ? `<p class="bn-hw">Needs care: ${escapeHtml(m.list.map(x => x.c.name).join(', '))}</p>` : `<p class="bn-hw">Every client is healthy.</p>`);
  return dbCard('db-health bn-hsm', 'health', 'Health', '', body);
}
// Wide screens: the clients that need attention as a table under the cards, the most at risk first.
function dbClientsTable(n){
  const m = dbHealthModel(), list = m.list.slice(0, n);
  const head = `<tr><th>Client</th><th>Why</th><th>Owner</th><th>This week’s update</th><th class="num">Hours this month</th><th>Last update</th></tr>`;
  const rows = list.map(x => {
    const c = x.c, w = clientWeek(c), hp = x.h.hp || {}, last = lastSentAt(c), owner = clientOwner(c);
    const week = w.sent ? `Sent ${relDayLower(new Date(w.last))}` : w.dueText;
    const hrs = hp.budget ? `<span class="${hp.used > hp.budget ? 't-red' : ''}">${Math.round(hp.used)} / ${hp.budget} h</span>` : (hp.used ? `${Math.round(hp.used)} h` : '<span class="db-mute">—</span>');
    return `<tr class="db-go" data-item onclick="dbOpenHealth('${c.id}')"><td><span class="db-cl"><span class="db-dot ${x.h.level}" aria-label="${x.h.level === 'r' ? 'At risk' : 'To watch'}"></span><b>${escapeHtml(c.name)}${focusMark(c)}</b></span></td>
<td class="db-why">${escapeHtml(tableSignal(x.h, c) || '')}</td><td>${owner ? escapeHtml(firstName(owner)) : '<span class="db-mute">No owner</span>'}</td>
<td><span class="${w.late && !w.sent ? 't-red' : ''}">${escapeHtml(week)}</span></td><td class="num">${hrs}</td><td>${last ? escapeHtml(relDay(new Date(last))) : '<span class="db-mute">No update yet</span>'}</td></tr>`;
  }).join('');
  const sub = [m.r ? `${m.r} at risk` : '', m.y ? `${m.y} to watch` : '', 'the most at risk first'].filter(Boolean).join(' · ');
  const body = m.list.length ? `<p class="db-sum">${sub}</p><div class="db-tw"><table class="db-tbl"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`
    : dbNone(m.tot ? 'Every client is healthy.' : 'No clients to watch yet.');
  return dbCard('db-clients', 'health', 'Clients that need attention', m.list.length || '', body, { total: m.list.length });
}

// ---- Tasks ----
function dbMyTasks(){
  return (typeof tasks !== 'undefined' ? tasks : []).filter(t => t.assigneeId === currentUser?.id && t.status !== 'done' && t.status !== 'in_review' && !t.cancelledAt)
    .sort((a, b) => focusIdFirst(a.clientId, b.clientId) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || (a.dueTime || '~').localeCompare(b.dueTime || '~') || ((b.priority === 'high') - (a.priority === 'high')));
}
// Ticking a circle strikes the row through, folds it away, then marks it done. (A task's circle opens
// Mark Done first, as on Tasks, so it doesn't fold until that's confirmed and the card draws again.)
function dbTick(btn, run){
  const row = btn.closest('.db-tk'); btn.setAttribute('aria-checked', 'true');
  if(row){ row.classList.add('is-done'); setTimeout(() => row.classList.add('is-gone'), 320); }
  setTimeout(run, row ? 560 : 0);
}
function dbTaskRow(t){
  const today = toDateStr(rNow()), c = t.clientId && clients.find(x => x.id === t.clientId), late = t.dueDate && t.dueDate < today;
  const st = dbSteps(t.description), when = t.dueDate ? (t.dueTime && t.dueDate === today ? fmtTime(new Date(t.dueDate + 'T' + t.dueTime)) : dbDayWord(t.dueDate)) : '';
  const sub = [c ? escapeHtml(c.name) : '', when ? `<span class="${late ? 't-red' : ''}">${escapeHtml(when)}</span>` : '', st.all ? `${st.done} of ${st.all} steps` : ''].filter(Boolean).join(' · ');
  return `<li class="db-tk" data-item><div class="db-tki"><div class="db-r db-go" onclick="openTaskDetailModal('${t.id}')">
<button class="db-cb" type="button" role="checkbox" aria-checked="false" aria-label="Mark done: ${escapeHtml(t.title)}" onclick="event.stopPropagation();moveTaskToStatus('${t.id}','done')">${icon('check', { weight: 'bold' })}</button>
<span class="db-tx"><b>${escapeHtml(t.title)}</b><span class="s">${sub || 'No due date'}</span></span>${t.priority === 'high' ? `<span class="db-flag" title="High priority">${icon('flag')}</span>` : ''}</div></div></li>`;
}
function dbTasksCard(n){
  const ts = dbMyTasks(), today = toDateStr(rNow());
  const over = ts.filter(t => t.dueDate && t.dueDate < today).length, due = ts.filter(t => t.dueDate === today).length;
  const summ = [over ? `<span class="t-red">${over} overdue</span>` : '', due ? `${due} due today` : ''].filter(Boolean).join(' · ');
  // work you gave someone, back with you to check (given up first when the card runs out of room)
  const back = (typeof tasks !== 'undefined' ? tasks : []).filter(t => t.assignerId === currentUser?.id && t.assigneeId !== currentUser?.id && t.status === 'in_review' && !t.cancelledAt);
  const check = back.length ? `<div data-opt><p class="db-sub">Ready for you to check</p><ul class="db-l">${back.slice(0, 1).map(t => {
    const who = (teamProfiles || []).find(p => p.id === t.assigneeId);
    return `<li class="db-r db-go" onclick="openTaskDetailModal('${t.id}')"><span class="db-ic">${icon('clipboard-check')}</span><span class="db-tx"><b>${escapeHtml(t.title)}</b><span class="s">${who ? escapeHtml(firstName(who.name)) + ' marked it ready' : 'Marked ready'}${back.length > 1 ? ` · ${back.length - 1} more` : ''}</span></span></li>`;
  }).join('')}</ul></div>` : '';
  const body = (summ ? `<p class="db-sum">${summ}</p>` : '') + (ts.length ? `<ul class="db-l">${ts.slice(0, n).map(dbTaskRow).join('')}</ul>` : dbNone('No open tasks.')) + check;
  return dbCard('db-tasks', 'tasks', 'Tasks', ts.length || '', body, { total: ts.length, soft: 3 });
}

// ---- Calendar: today with a line at now, then the days after ----
const DB_EV_TONE = { meeting: 'blue', client_meeting: 'green', deadline: 'red', reminder: 'yellow', other: 'purple' };
function dbCalendarCard(cap){
  const now = rNow(), todayStr = toDateStr(now), end = toDateStr(addDays(now, 6));
  const evs = (typeof calendarEvents !== 'undefined' ? calendarEvents : []).filter(e => e.startAt && !e.deletedAt)
    .map(e => ({ e, ds: toDateStr(new Date(e.startAt)) })).filter(x => x.ds >= todayStr && x.ds <= end)
    .sort((a, b) => (a.ds.localeCompare(b.ds)) || ((!!b.e.allDay) - (!!a.e.allDay)) || (new Date(a.e.startAt) - new Date(b.e.startAt)));
  const row = (e, past) => {
    const c = e.clientId && clients.find(x => x.id === e.clientId), first = (e.description || '').split('\n')[0];
    const sub = c ? c.name : first || (e.endAt && !e.allDay ? 'Until ' + fmtTime(new Date(e.endAt)) : '');
    const tone = typeof calColor === 'function' ? calColor(e) : (DB_EV_TONE[e.eventType] || (c ? 'green' : 'blue'));   // the calendar's colours
    const join = typeof meetingJoinable === 'function' && meetingJoinable(e) ? joinMeetingBtn(e, 'sm btn-p db-join') : '';
    return `<li class="db-ev db-go${past ? ' is-past' : ''}"${past ? '' : ' data-item'} onclick="openEventDetailModal('${e.id}')"><time>${e.allDay ? 'All day' : fmtTime(new Date(e.startAt))}</time><i class="db-evb ${tone}"></i><span class="db-tx"><b>${escapeHtml(e.title || 'Untitled')}</b><span class="s">${escapeHtml(sub)}</span></span>${join}</li>`;
  };
  const nowLi = `<li class="db-now" aria-label="Now, ${fmtTime(now)}"><time>${fmtTime(now)}</time><i></i></li>`;
  // Today: the last two that already happened, a line at now, and what's left
  const tod = evs.filter(x => x.ds === todayStr).map(x => x.e);
  const isPast = e => !e.allDay && new Date(e.endAt || e.startAt) <= now;
  const past = tod.filter(isPast), left = tod.filter(e => !isPast(e));
  const todayRows = past.slice(-2).map(e => row(e, true));
  let placed = false;
  left.slice(0, cap).forEach(e => { if(!placed && !e.allDay && new Date(e.startAt) > now){ todayRows.push(nowLi); placed = true; } todayRows.push(row(e, false)); });
  if(!placed && tod.length) todayRows.push(nowLi);
  let html = `<div class="db-dayblk"><p class="db-day"><b>Today</b><span>${left.length ? `${left.length} left` : tod.length ? 'Nothing else today' : 'No meetings'}</span></p><ul class="db-l db-agenda">${todayRows.join('')}</ul></div>`;
  // the days after, in order (the card drops them from the end until it fits)
  const later = evs.filter(x => x.ds > todayStr);
  let room = cap - Math.min(left.length, cap);
  [...new Set(later.map(x => x.ds))].forEach(ds => {
    if(room <= 0) return;
    const es = later.filter(x => x.ds === ds).map(x => x.e), take = es.slice(0, room); room -= take.length;
    html += `<div class="db-dayblk" data-blk><p class="db-day"><b>${escapeHtml(dbDayWord(ds))}</b><span>${dbPlural(es.length, 'event')}</span></p><ul class="db-l db-agenda">${take.map(e => row(e, false)).join('')}</ul></div>`;
  });
  return dbCard('db-cal', 'calendar', 'Calendar', '', html, { total: left.length + later.length, min: 0 });
}

// ---- Reminders: questions waiting on clients ----
function dbRemindersCard(n){
  const me = currentUser?.id, today = toDateStr(rNow());
  const rs = (typeof clientReminders !== 'undefined' ? clientReminders : []).filter(r => r.status === 'waiting' && (canApprove() || r.askedBy === me))
    .sort((a, b) => focusIdFirst(a.clientId, b.clientId) || (a.followUpDate || '9999').localeCompare(b.followUpDate || '9999'));
  const over = rs.filter(r => r.followUpDate && r.followUpDate < today).length, due = rs.filter(r => r.followUpDate === today).length;
  const summ = [rs.some(r => r.waitingOn) ? 'Waiting on answers' : 'Waiting on clients', over ? `<span class="t-red">${over} overdue</span>` : '', due ? `${due} to follow up today` : ''].filter(Boolean).join(' · ');
  const rows = rs.slice(0, n).map(r => {
    const c = clients.find(x => x.id === r.clientId), by = r.askedBy !== me && (teamProfiles || []).find(p => p.id === r.askedBy);
    const fw = r.followUpDate ? `<span class="${r.followUpDate < today ? 't-red' : ''}">${escapeHtml(dbFollowWord(r.followUpDate))}</span>` : (r.askedDate ? `Asked ${escapeHtml(dbDayWord(r.askedDate))}` : '');
    const sub = [r.waitingOn && typeof remOnWho === 'function' ? `Waiting on ${escapeHtml(remOnWho(r))}` : '', c ? escapeHtml(c.name) : '', by ? `Asked by ${escapeHtml(firstName(by.name))}` : '', fw].filter(Boolean).join(' · ');
    return `<li class="db-r db-go" data-item onclick="openReminderDetailModal('${r.id}')"><span class="db-tx"><b class="db-q">${escapeHtml(r.question || '')}</b><span class="s">${sub}</span></span></li>`;
  }).join('');
  const body = `<p class="db-sum">${summ}</p>` + (rs.length ? `<ul class="db-l">${rows}</ul>` : dbNone('Nothing waiting on a client.'));
  return dbCard('db-rem', 'reminders', 'Reminders', rs.length || '', body, { total: rs.length });
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
    return `<li class="db-r db-wa db-go" data-item onclick="waOpenItem(${jsArg(t.id)})"><span class="db-tx"><span class="db-wt"><b>${escapeHtml(typeof waClientLabel === 'function' ? waClientLabel(t) : (t.client || ''))}</b><time>${escapeHtml(dbDayWord(ds))}</time></span><span class="db-wq">${escapeHtml(t.title || '')}</span><span class="s db-wo">${who}${wait >= 3 ? ` · <span class="t-red">Waiting ${wait} days</span>` : ''}</span></span></li>`;
  }).join('');
  const summ = lead && mine ? `From client groups · ${mine} yours` : 'From client groups';
  const body = `<p class="db-sum">${summ}</p>` + (ws.length ? `<ul class="db-l">${rows}</ul>` : dbNone('No open requests.'));
  return dbCard('db-wa', 'whatsapp', 'WhatsApp', ws.length || '', body, { total: ws.length });
}

// ---- Notes: latest first ----
function dbNotesCard(n, compact){
  const ns = (typeof notes !== 'undefined' ? notes : []).filter(x => !x.deletedAt).sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
  const snippet = t => { for(const line of String(t || '').split('\n')){ const l = line.trim(); if(l && !/^- \[/.test(l) && !l.endsWith(':')) return l.replace(/^#+\s*/, ''); } return ''; };
  const rows = ns.slice(0, n).map(x => {
    const c = x.clientId && clients.find(y => y.id === x.clientId), st = dbSteps(x.text), when = x.updatedAt || x.createdAt;
    const sub = (c ? escapeHtml(c.name) : 'Your note') + (compact && st.all ? ` · ${st.done} of ${st.all} done` : '');
    const prog = !compact && st.all ? `<span class="db-prog"><span class="db-pb"><i style="width:${Math.round(st.done / st.all * 100)}%"></i></span>${st.done} of ${st.all} done</span>` : '';
    return `<li class="db-r db-note db-go" data-item onclick="openNoteSheet('${x.id}')"><span class="db-tx"><span class="db-wt"><b>${escapeHtml(x.title || 'Untitled')}</b>${when ? `<time>${escapeHtml(dbDayWord(toDateStr(new Date(when))))}</time>` : ''}</span><span class="s">${sub}</span>${snippet(x.text) ? `<span class="db-sn">${escapeHtml(snippet(x.text))}</span>` : ''}${prog}</span></li>`;
  }).join('');
  const body = '<p class="db-sum">Latest first</p>' + (ns.length ? `<ul class="db-l">${rows}</ul>` : dbNone('No notes yet.'));
  return dbCard('db-notes', 'notes', 'Notes', ns.length || '', body, { total: ns.length });
}

// ---- Today's focus (members): the one thing to do now, what's next, and how much is done ----
const DB_SRC_ICON = { task: 'list-todo', wa: 'messages-square', follow: 'bell-ring', note: 'sticky-note', review: 'clipboard-check', health: 'activity', update: 'send' };
function dbToggleRest(btn){
  window._dbRestOpen = !window._dbRestOpen;
  const nx = btn.closest('.bn-next'), rx = nx?.querySelector('.bn-rx');
  nx?.classList.toggle('is-open', window._dbRestOpen);   // Next and the rest scroll together inside the card
  if(rx) rx.classList.toggle('open', window._dbRestOpen);
  if(!window._dbRestOpen) nx?.querySelector('.bn-nx')?.scrollTo({ top: 0 });
  btn.setAttribute('aria-expanded', window._dbRestOpen); dbRestLabel(btn.closest('.bn-focus'));
}
// "4 more" under Next (beside it when the window is short), or "Show less" while they're open.
function dbRestLabel(card){
  const btn = card && card.querySelector('.bn-tg'); if(!btn) return;
  const n = card.querySelectorAll('.bn-rest > li').length;
  btn.hidden = !n; btn.textContent = window._dbRestOpen ? 'Show less' : `${n} more`;
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
    const nowKey = (x && x.id) || L.title, arrive = window._dbNowKey !== undefined && window._dbNowKey !== nowKey; window._dbNowKey = nowKey;
    nowHtml = `<div class="bn-nowi${arrive ? ' bn-in' : ''}"><span class="bn-ic ${tone}">${icon(ic)}</span><div class="bn-nt"><b>${escapeHtml(L.title)}${x && x.flag ? `<span class="db-flag" title="High priority">${icon('flag')}</span>` : ''}</b><span class="s">${sub}</span>
<div class="bn-acts"><button class="btn btn-p" type="button" onclick="${L.go}">${x && x.src === 'task' ? icon('check') : wa ? icon('copy') : ''}${escapeHtml(L.label || 'Open')}</button>${second}</div></div></div>`;
  } else {
    const arrive = window._dbNowKey !== undefined && window._dbNowKey !== ''; window._dbNowKey = '';
    nowHtml = `<div class="bn-clear${arrive ? ' bn-in' : ''}">${icon('circle-check')}<span><b>You’re clear for today.</b> ${evText ? `${escapeHtml(evText)} is next.` : 'Nothing else is due today.'}</span></div>`;
  }
  const row = x => {
    const tick = x.src === 'task' ? x.tick : `dbTick(this,()=>{${x.tick}})`;
    const lead = x.tick && x.src !== 'wa'
      ? `<button class="db-cb" type="button" role="checkbox" aria-checked="false" aria-label="${escapeHtml(x.tickLabel || 'Done')}: ${escapeHtml(x.title)}" onclick="event.stopPropagation();${tick}">${icon('check', { weight: 'bold' })}</button>`
      : `<span class="db-ic">${icon(DB_SRC_ICON[x.src] || 'circle')}</span>`;
    const when = x.when ? `<span class="${x.late ? 't-red' : ''}">${escapeHtml(x.when)}</span> · ` : '';
    const step = x.tick && x.src !== 'wa' ? '' : `<a class="x-lnk bn-open" href="#" onclick="event.stopPropagation();${x.go};return false;">${escapeHtml(x.step || 'Open')}</a>`;
    return `<li class="db-tk" data-item><div class="db-tki"><div class="db-r db-go" onclick="${x.go}">${lead}<span class="db-tx"><b>${escapeHtml(x.title)}</b><span class="s">${when}${x.sub || ''}</span></span>${x.flag ? `<span class="db-flag" title="High priority">${icon('flag')}</span>` : ''}${step}</div></div></li>`;
  };
  const restOpen = !!window._dbRestOpen;
  const nextHtml = queue.length ? `<div class="bn-next${restOpen ? ' is-open' : ''}"><p class="bn-lbl">Next</p><div class="bn-nx"><ul class="db-l bn-nl">${next.map(row).join('')}</ul>
<div class="bn-rx${restOpen ? ' open' : ''}"><div class="bn-rxi"><ul class="db-l bn-rest">${rest.map(row).join('')}</ul></div></div></div>
<button class="db-more bn-tg" type="button" aria-expanded="${restOpen}" onclick="dbToggleRest(this)" hidden></button></div>` : '';
  // how much of the day is done
  const total = m.done.length + open, segs = Math.min(total, 10), on = total ? Math.round(m.done.length / total * segs) : 0;
  const dots = segs ? `<span class="bn-seg" aria-hidden="true">${Array.from({ length: segs }, (_, i) => `<i${i < on ? ' class="on"' : ''}></i>`).join('')}</span>` : '';
  const last = m.done[0] ? `<span class="bn-last">Last: ${escapeHtml(m.done[0].title)}, ${fmtTime(m.done[0].t)}</span>` : '';
  const foot = total ? `<footer class="bn-done" data-opt>${dots}<span class="bn-dw">${m.done.length} of ${total} done today</span>${last}</footer>` : '';
  const name = firstName((typeof myName === 'function' ? myName() : '') || '');
  return `<section class="db-card bn-focus" aria-label="Today’s focus" data-focus><header class="db-h">${icon('sun')}<b>Today’s focus</b></header>
<div class="bn-hi"><h2>${hello}${name ? ', ' + escapeHtml(name) : ''}</h2><p>${sum}</p></div>
<div class="bn-cols"><div class="bn-now"><p class="bn-lbl">Now</p>${nowHtml}</div>${nextHtml}</div>${foot}</section>`;
}

// ---- fitting: every card shows what fits its space, and says how many more ----
function dbOver(card){
  if(card.scrollHeight > card.clientHeight + 1) return true;
  // Today's focus shrinks its Now/Next area, which then spills over the done line without growing the card
  return [...card.querySelectorAll('.bn-cols, .bn-next:not(.is-open)')].some(b => b.scrollHeight > b.clientHeight + 1);
}
function dbFitCard(card){
  const focus = card.hasAttribute('data-focus');
  // Today's focus with the rest open: fit it as if closed (so a redraw, say when a task or WhatsApp
  // reloads, never spills over the done line), then open it again without replaying the slide
  const nx = focus && window._dbRestOpen ? card.querySelector('.bn-next.is-open') : null, rx = nx && nx.querySelector('.bn-rx');
  if(nx){ rx.style.transition = 'none'; nx.classList.remove('is-open'); rx.classList.remove('open'); }
  // Today's focus keeps one Next row, gives up its done line, tightens, then moves the last row under "more"
  const min = focus ? 0 : +(card.dataset.min ?? 1), soft = focus ? 1 : +(card.dataset.soft || 0);
  const gone = [];   // what came out, newest last, so a row that would fit after all can go back
  const take = n => { gone.push([n, n.parentNode, n.nextSibling]); n.remove(); };
  for(let guard = 0; guard < 80 && dbOver(card); guard++){
    const items = focus ? [...card.querySelectorAll('.bn-nl > [data-item]')] : [...card.querySelectorAll('[data-item]')];
    const opt = card.querySelector('[data-opt]');
    if(opt && items.length <= Math.max(soft, min)){ take(opt); continue; }
    if(focus && items.length <= 1 && !card.classList.contains('bn-tight')){ card.classList.add('bn-tight'); continue; }
    if(items.length > min){
      const last = items[items.length - 1];
      if(focus){ card.querySelector('.bn-rest')?.prepend(last); dbRestLabel(card); continue; }
      const blk = last.closest('[data-blk]'); take(last);
      if(blk && !blk.querySelector('[data-item]')) take(blk);
      dbMoreLabel(card);
      continue;
    }
    // nothing left to give up but day headers with no rows
    const blk = [...card.querySelectorAll('[data-blk]')].pop(); if(blk){ take(blk); continue; }
    // a very short window: the last rows go too (the "more" line still says where they are), so nothing spills
    if(!focus && items.length){ const last = items[items.length - 1], b = last.closest('[data-blk]'); take(last); if(b && !b.querySelector('[data-item]')) take(b); dbMoreLabel(card); continue; }
    break;
  }
  // the "more" line takes room once it shows, so the last cut can be one too many: put back what fits
  while(!focus && gone.length){   // Today's focus would rather keep a Next row than its done line
    const [n, parent, next] = gone[gone.length - 1];
    parent.insertBefore(n, next && next.parentNode === parent ? next : null);
    if(!focus) dbMoreLabel(card);
    if(dbOver(card)){ n.remove(); if(!focus) dbMoreLabel(card); break; }
    gone.pop();
  }
  card.querySelectorAll('[data-blk]').forEach(b => { if(!b.querySelector('[data-item]')) b.remove(); });
  if(nx){
    if(card.querySelector('.bn-rest > li')){ nx.classList.add('is-open'); rx.classList.add('open'); }
    else { window._dbRestOpen = false; card.querySelector('.bn-tg')?.setAttribute('aria-expanded', 'false'); }   // everything fits: nothing to open
    dbRestLabel(card);
    void rx.offsetHeight; requestAnimationFrame(() => { rx.style.transition = ''; });
  }
}
function dbMoreLabel(card){
  const a = card.querySelector('.db-more[data-view]'); if(!a || card.dataset.total == null) return;
  const more = +card.dataset.total - card.querySelectorAll('[data-item]').length;
  a.hidden = more <= 0; a.textContent = more > 0 ? `${more} more in ${dbTitle(a.dataset.view)}` : '';
}
function dbFit(root){
  root.querySelectorAll('.db-card').forEach(dbMoreLabel);
  root.querySelectorAll('.bn-focus').forEach(dbRestLabel);
  if(dbMode() === 'narrow') return;   // a narrow window scrolls; the cards keep to a few rows
  root.querySelectorAll('.db-card').forEach(dbFitCard);
}

// ---- the page ----
function renderDashboard(){
  const root = dbRoot();
  if(!root || typeof clients === 'undefined' || typeof currentUser === 'undefined' || !currentUser) return;
  // Hidden behind another tab, it measures as nothing: it would pick the narrow layout and couldn't
  // fit a card. So it waits, and draws the moment it shows again, before that first frame paints.
  if(!root.clientWidth){ root._dbStale = true; dbWatchSize(root); return; }
  root._dbStale = false;
  const mode = dbMode(), role = canApprove() ? 'approver' : 'member', N = mode === 'narrow' ? DB_FEW : DB_CAP, wa = dbWaOn(), wide = mode === 'wide';
  if((typeof tasksDataLoaded !== 'undefined' && !tasksDataLoaded) || (typeof calendarDataLoaded !== 'undefined' && !calendarDataLoaded)){
    root.innerHTML = skeletonHtml('dashboard', 'Loading your dashboard…'); dbWatchSize(root); return;
  }
  // the new look has its own dashboard (dashboard-widgets.js)
  if(typeof uwOn === 'function' && uwOn()){ uwRenderDashboard(root); dbWatchSize(root); return; }
  let html;
  try{
    const table = wide ? dbClientsTable(DB_CAP.table) : '';
    if(role === 'approver'){
      html = `<div class="db db-${mode}"><div class="db-grid${wa ? '' : ' no-wa'}">${dbHealthCard(N.health)}${dbTasksCard(N.tasks)}${dbCalendarCard(N.cal)}${dbRemindersCard(N.rem)}${wa ? dbWhatsappCard(N.wa) : ''}${dbNotesCard(N.notes)}</div>${table}</div>`;
    } else {
      const rw = dbRemindersCard(N.rem) + (wa ? dbWhatsappCard(N.wa) : '');
      html = `<div class="db db-${mode}"><div class="bn-grid${wa ? '' : ' no-wa'}">${dbFocusCard(N.next)}<div class="bn-mid">${dbTasksCard(N.tasks)}${dbHealthSmall()}</div>${dbCalendarCard(N.cal)}${wide ? `<div class="bn-pair">${rw}</div>` : rw}${dbNotesCard(N.notes, !wide)}</div>${table}</div>`;
    }
  } catch(e){
    console.error('Dashboard', e);
    html = `<div class="db">${emptyState({ icon: 'refresh-cw', title: 'The dashboard couldn’t be shown', text: String(e && e.message || e), action: 'Try Again', onAction: 'renderDashboard()' })}</div>`;
  }
  root.innerHTML = html;
  dbFit(root);
  if(currentViewName === 'overview' && typeof renderGreeting === 'function') renderGreeting();
  dbWatchSize(root);
}
// When the window changes size, the cards fit again (and a wide screen gets its table).
// Shown again after something changed (or the window changed size) while another tab was up: it
// draws at once, inside the observer, so the first frame is already right.
function dbWatchSize(root){
  if(root._dbRo || typeof ResizeObserver === 'undefined') return;
  let w = root.clientWidth, h = root.clientHeight, hidden = !w;
  root._dbRo = new ResizeObserver(() => {
    if(!root.clientWidth){ hidden = true; return; }
    const back = hidden; hidden = false;
    if(!root._dbStale && root.clientWidth === w && root.clientHeight === h) return;
    w = root.clientWidth; h = root.clientHeight;
    clearTimeout(root._dbT);
    if(back || root._dbStale) renderDashboard();
    else root._dbT = setTimeout(() => { if(root.offsetParent) renderDashboard(); }, 120);
  });
  root._dbRo.observe(root);
}
// The week board (This Week) used to open from Today; it opens from the Dashboard's toolbar now.
VIEW_TOOLBAR_ACTIONS.overview = () => `<button class="btn" onclick="wkEnterWeek()">${icon('calendar-days')}This Week</button>`;
