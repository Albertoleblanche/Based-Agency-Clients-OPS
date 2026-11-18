// Today: your day, not a list of clients (canvas "Today — new design").
// The date and how much of today is done, your meetings on a strip, the one thing to do next,
// the rest as a list, who you're waiting on, and what you finished. Schedule and your week on
// the side. Company-wide numbers live on Health and Focus Reports, not here.

const CHEV = () => icon('caret-right', { cls: 'go', weight: 'bold' });
function todayPlural(n, one, many){ return `${n} ${n === 1 ? one : (many || one + 's')}`; }

// Drafts waiting on the person looking at the screen. Approvers: what the team sent for
// review plus their own drafts. Everyone else: their own drafts that are written.
function todayWaitingDrafts(){
  const me = myName(), approver = canApprove(), out = [];
  attentionEligibleClients().forEach(c => (c.drafts || []).forEach(d => {
    if(d.draftStatus !== 'pending') return;
    const mine = d.author === me;
    if(approver ? (mine || d.readyToNotify === true) : mine){
      const count = (d.draftImprovementIds || []).length || c.improvements.filter(i => i.author === d.author).length;
      out.push({ c, d, count });
    }
  }));
  out.sort((a, b) => new Date(a.d.draftPendingSince || 0) - new Date(b.d.draftPendingSince || 0));
  return out;
}
function myClientsFilter(c){ return canApprove() || clientOwner(c) === myName(); }

async function remindHolder(clientId, quiet){
  const c = clients.find(x => x.id === clientId); if(!c) return;
  const w = clientWeek(c), who = w.holder === 'approvers' ? null : profileByName(w.holder || w.owner);
  if(!who){ if(!quiet) showToast('info', 'Nobody to remind', 'This update is waiting on approvers.'); return null; }
  const next = w.behind != null ? ['log the week’s work', 'send the draft for review', 'approve it', 'send it'][w.behind] : 'get it ready';
  await sendNotification(who.id, 'update_behind', `${c.name}: this week’s update is ${w.late ? 'overdue' : 'due'}`,
    `${w.dueText}. Next: ${next}.`, 'approve', c.id);
  if(!quiet) showToast('success', `Reminded ${firstName(who.name)}`, 'In the app, and on Slack if they use it.');
  return who;
}
async function remindHolders(ids){
  const people = new Set();
  for(const id of ids){ const who = await remindHolder(id, true); if(who) people.add(firstName(who.name)); }
  if(people.size) showToast('success', `Reminded ${joinNames([...people])}`, 'In the app, and on Slack if they use it.');
}
function joinNames(a){ return a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }

// Weeks of on-time history for every client, oldest first: o on time · l late · m missed · '' none.
function todayWeekCodes(c, weeks){
  const now = rNow(), sends = sentTimes(c), first = sends[0], out = [];
  const monday = dayStart(addDays(now, -((now.getDay() + 6) % 7)));
  for(let k = weeks; k >= 1; k--){
    const from = addDays(monday, -7 * k), to = addDays(from, 7);
    const i = sends.findIndex(t => t >= from && t < to);
    if(i >= 0) out.push(i > 0 && daysBetween(sends[i - 1], sends[i]) > UPDATE_EVERY_DAYS ? 'l' : 'o');
    else out.push(!first || first >= to ? '' : 'm');
  }
  return out;
}
// The step a row's button takes, from where the update is and who it's waiting on.
function todayRowAction(w){
  const me = myName(), d = w.draft, c = w.c;
  const holder = w.holder && w.holder !== 'approvers' ? w.holder : null;
  if(w.done >= 3) return canApprove() ? [`sendApprovedDraft('${c.id}',${jsArg(d.author)})`, 'Send Now'] : [`openWeekClient('${c.id}')`, 'Open'];
  if(w.done === 2) return canApprove() ? [`openReviewDraft('${c.id}',${jsArg(d.author)})`, 'Open'] : [`openWeekClient('${c.id}')`, 'Open'];
  if(holder && holder !== me) return [`remindHolder('${c.id}')`, 'Remind ' + firstName(holder)];
  if(d) return [`sendDraftForReview('${c.id}',${jsArg(d.author)})`, 'Send for Review'];
  if(w.logged.length) return [`generateDraft('${c.id}',${jsArg(me)})`, 'Write Draft'];
  return [`openQueueLogImprovementModal('${c.id}')`, 'Log Improvement'];
}
function todayNames(list){
  const names = list.map(c => shortClientName(c.name));
  return names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
}
// "Write a draft for Brightway" — the update row in plain words, from what it's waiting on.
function todayUpdateTitle(w){
  const n = shortClientName(w.c.name);
  if(w.done >= 3) return `Send ${n}’s approved update`;
  if(w.done === 2) return `Review ${n}’s draft`;
  if(w.draft) return `Send ${n}’s draft for review`;
  if(w.logged.length) return `Write ${n}’s update`;
  return `Log this week’s work for ${n}`;
}
function hmText(min){ min = Math.round(min); const h = Math.floor(min / 60), m = min % 60; return h ? `${h} h${m ? ' ' + m + ' m' : ''}` : `${m} m`; }

function renderToday(){
  const root = document.getElementById('todayRoot');
  if(!root || typeof clients === 'undefined') return;
  const me = myName(), approver = canApprove(), now = rNow(), todayStr = toDateStr(now);
  const list = attentionEligibleClients();
  const ws = list.map(clientWeek);
  const behind = ws.filter(w => myClientsFilter(w.c) && needsUpdate(w)).sort(dueOrder);
  const waiting = todayWaitingDrafts();
  const myTasks = (typeof tasks !== 'undefined' ? tasks : []).filter(t => t.assigneeId === currentUser?.id && !t.cancelledAt);

  // ---- Up next: the one main action ----
  const used = new Set();
  let lead = null;
  if(approver && waiting.length){
    waiting.forEach(x => used.add(x.c.id));
    const dues = [...new Set(waiting.map(x => { const w = clientWeek(x.c); return w.sent ? w.due.getDay() : -1; }))];
    const names = waiting.map(x => shortClientName(x.c.name));
    const sub = `${names.length <= 4 ? joinNames(names) : names.slice(0, 3).join(', ') + ` and ${names.length - 3} more`} · oldest waiting ${fmtWait(waiting[0].d.draftPendingSince || now)}${dues.length === 1 && dues[0] >= 0 ? ' · all due ' + DAY_NAMES[dues[0]] : ''}`;
    lead = { ic: 'tray', tone: 'blue', title: `Review ${todayPlural(waiting.length, 'draft')}`, sub, go: `openReviewDraft('${waiting[0].c.id}',${jsArg(waiting[0].d.author)})`, label: 'Start Review' };
  } else if(!approver && waiting.some(x => !x.d.readyToNotify)){
    const mineW = waiting.filter(x => !x.d.readyToNotify); mineW.forEach(x => used.add(x.c.id));
    lead = { ic: 'send', tone: 'blue', title: `Send ${todayPlural(mineW.length, 'draft')} for review`, sub: joinNames(mineW.map(x => shortClientName(x.c.name))), go: `openWeekClient('${mineW[0].c.id}')`, label: 'Open Draft' };
  } else {
    const w = behind.find(x => !x.holder || x.holder === me || x.holder === 'approvers' && approver);
    if(w){ used.add(w.c.id); const [go, label] = todayRowAction(w);
      lead = { c: w.c, title: todayUpdateTitle(w), sub: `${w.late ? overdueShort(w) : 'Due today'} · ${w.note || ''}`, go, label }; }
  }

  // ---- Also today: everything else that waits on you; Waiting on others: what doesn't ----
  const items = [], others = [];
  behind.filter(w => !used.has(w.c.id)).forEach(w => {
    used.add(w.c.id);
    const holder = w.holder && w.holder !== 'approvers' ? w.holder : null;
    if(holder && holder !== me){ others.push(w); return; }
    if(w.holder === 'approvers' && !approver){ others.push(w); return; }
    const [go] = todayRowAction(w);
    items.push({ c: w.c, title: todayUpdateTitle(w), sub: `${escapeHtml(w.c.name)} · ${escapeHtml(w.note || '')}`, pill: w.late ? ['red', overdueShort(w)] : ['', 'Due today'], go });
  });
  list.filter(c => myClientsFilter(c) && !used.has(c.id) && clientHealth(c).level === 'r' && !nextStepTask(c)).forEach(c => {
    used.add(c.id);
    items.push({ c, title: `Plan a next step for ${shortClientName(c.name)}`, sub: `${escapeHtml(c.name)} · ${escapeHtml(tableSignal(clientHealth(c), c) || 'no plan yet')}`, pill: ['red', 'At risk'], go: `planNextStep('${c.id}')` });
  });
  myTasks.filter(t => t.status !== 'done' && t.dueDate && t.dueDate <= todayStr).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || (a.dueTime || '').localeCompare(b.dueTime || '')).forEach(t => {
    const c = clients.find(x => x.id === t.clientId), late = t.dueDate < todayStr;
    const when = late ? (t.dueDate === toDateStr(addDays(now, -1)) ? 'Yesterday' : fmtShortDate(new Date(t.dueDate + 'T12:00:00'))) : (t.dueTime ? fmtTime(new Date(t.dueDate + 'T' + t.dueTime)) : 'Today');
    items.push({ task: t, title: t.title, sub: c ? escapeHtml(c.name) : 'Based Agency', pill: [late ? 'red' : '', when], flag: t.priority === 'high', go: `openTaskDetailModal('${t.id}')` });
  });

  // ---- Done today ----
  const done = [];
  list.forEach(c => (c.drafts || []).forEach(d => { if(d.draftSentAt && toDateStr(new Date(d.draftSentAt)) === todayStr && (d.draftSentBy === me || (!d.draftSentBy && d.author === me))) done.push({ t: new Date(d.draftSentAt), title: `Sent ${shortClientName(c.name)}’s update`, sub: c.name }); }));
  const logged = {};
  list.forEach(c => (c.improvements || []).forEach(i => { if(i.author === me && toDateStr(new Date(i.date)) === todayStr){ const k = c.id; logged[k] = logged[k] || { c, n: 0, t: new Date(i.date) }; logged[k].n++; if(new Date(i.date) > logged[k].t) logged[k].t = new Date(i.date); } }));
  Object.values(logged).forEach(x => done.push({ t: x.t, title: `Logged ${todayPlural(x.n, 'improvement')}`, sub: x.c.name }));
  myTasks.filter(t => t.status === 'done' && t.completedAt && toDateStr(new Date(t.completedAt)) === todayStr).forEach(t => {
    const c = clients.find(x => x.id === t.clientId); done.push({ t: new Date(t.completedAt), title: t.title, sub: c ? c.name : 'Based Agency' });
  });
  done.sort((a, b) => b.t - a.t);

  // ---- header: the date and the done ring ----
  const open = (lead ? 1 : 0) + items.length, total = open + done.length;
  const C = 2 * Math.PI * 22, frac = total ? done.length / total : 0;
  const ring = total ? `<div class="ty-prog"><svg class="ty-ring" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="22" class="bg"/><circle cx="26" cy="26" r="22" class="fg" stroke-dasharray="${(C * frac).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 26 26)"/></svg>
<div><b>${done.length} of ${total} done</b><span>${open ? `${open} left today${lead ? ' · the first one is waiting on you' : ''}` : 'Nothing left for today'}</span></div></div>` : '';

  // ---- today's meetings: the strip, and the schedule on the side ----
  const evs = (typeof calendarEvents !== 'undefined' ? calendarEvents : []).filter(e => !e.allDay && e.startAt && toDateStr(new Date(e.startAt)) === todayStr)
    .sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
  const hourOf = d => d.getHours() + d.getMinutes() / 60;
  let h0 = 8, h1 = 19;
  evs.forEach(e => { const s = hourOf(new Date(e.startAt)), en = hourOf(new Date(e.endAt || e.startAt)); h0 = Math.min(h0, Math.floor(s)); h1 = Math.max(h1, Math.ceil(en)); });
  const span = h1 - h0, X = h => ((h - h0) / span * 100).toFixed(2);
  const nowH = hourOf(now);
  const blocks = evs.map((e, i) => {
    const s = new Date(e.startAt), en = new Date(e.endAt || s.getTime() + 30 * 60000), past = en <= now;
    const left = X(hourOf(s)), w = Math.max(0.6, (hourOf(en) - hourOf(s)) / span * 100), end = +left + w;
    // the label sits after the block and stops before the next one (or the end of the strip)
    const nx = evs[i + 1] ? +X(hourOf(new Date(evs[i + 1].startAt))) : 100, room = nx - end;
    const label = room > 3 ? `<span class="ty-ml${past ? ' past' : ''}" style="left:calc(${end.toFixed(2)}% + 7px);max-width:calc(${room.toFixed(2)}% - 14px)">${escapeHtml(e.title)}</span>` : '';
    return `<span class="ty-m${past ? ' past' : ''}" style="left:${left}%;width:${w.toFixed(2)}%" title="${escapeHtml(e.title)} · ${fmtTime(s)}" onclick="openEventDetailModal('${e.id}')"></span>${label}`;
  }).join('');
  const ticks = [];
  for(let h = h0; h <= h1; h += 2) ticks.push(`<span class="ty-tk" style="left:${X(h)}%">${(h + 11) % 12 + 1}</span>`);
  const strip = `<div class="ty-day"><div class="ty-track">${blocks}${nowH >= h0 && nowH <= h1 ? `<span class="ty-now" style="left:${X(nowH)}%"></span>` : ''}${evs.length ? '' : '<span class="ty-none">No meetings today</span>'}</div><div class="ty-ticks">${ticks.join('')}</div></div>`;
  let nowShown = false;
  const nowLine = `<div class="ty-nowl"><span>${fmtTime(now)}</span><i></i></div>`;
  const nextEv = evs.find(e => new Date(e.startAt) > now);
  const sched = evs.map(e => {
    const s = new Date(e.startAt), past = new Date(e.endAt || e.startAt) <= now;
    let pre = ''; if(!nowShown && s > now){ nowShown = true; pre = nowLine; }
    const link = (e.description || '').match(/https?:\/\/(meet\.google\.com|[a-z0-9.-]*zoom\.us|teams\.microsoft\.com)\/\S+/i);
    const isNext = e === nextEv, mins = Math.round((s - now) / 60000);
    const sub = isNext ? `In ${hmText(mins)}${(e.description || '').split('\n')[0] ? ' · ' + escapeHtml((e.description || '').split('\n')[0]) : ''}` : escapeHtml((e.description || '').split('\n')[0]);
    const join = isNext && link ? `<a class="btn sm" href="${safeUrl(link[0])}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Join</a>` : '';
    return `${pre}<div class="ty-ev${past ? ' past' : ''}${isNext ? ' next' : ''}" onclick="openEventDetailModal('${e.id}')"><span class="tm">${fmtTime(s).replace(/\s?[AP]M$/i, '')}</span><div class="tx"><b>${escapeHtml(e.title)}</b><span>${sub}</span></div>${join}</div>`;
  }).join('') + (evs.length && !nowShown ? nowLine : '');

  // ---- your week ----
  const monday = dayStart(addDays(now, -((now.getDay() + 6) % 7)));
  const sentByMe = list.reduce((n, c) => n + (c.drafts || []).filter(d => d.draftSentAt && new Date(d.draftSentAt) >= monday && (d.draftSentBy === me || (!d.draftSentBy && d.author === me))).length, 0);
  const impsByMe = list.reduce((n, c) => n + (c.improvements || []).filter(i => i.author === me && new Date(i.date) >= monday).length, 0);
  const weekMin = (typeof myOwnTimeEntries === 'function' ? myOwnTimeEntries() : []).filter(e => new Date(e.date + 'T12:00:00') >= monday).reduce((s, e) => s + (e.minutes || 0), 0) + (typeof runningMinutes === 'function' ? runningMinutes() : 0);
  const target = typeof weeklyHoursTarget === 'function' ? weeklyHoursTarget() : 40;
  const owned = ws.filter(w => clientOwner(w.c) === me);
  const onTime = owned.filter(w => w.state !== 'late').length;

  // ---- waiting on others ----
  let waitLine = '';
  if(others.length){
    const names = others.map(w => shortClientName(w.c.name));
    const people = [...new Set(others.map(w => w.holder && w.holder !== 'approvers' ? firstName(w.holder) : null).filter(Boolean))];
    const nothing = others.every(w => w.done === 0);
    const what = others.every(w => w.holder === 'approvers') ? `${joinNames(names)} ${names.length === 1 ? 'is' : 'are'} waiting on review.`
      : `${joinNames(names.length > 3 ? names.slice(0, 3).concat(`${names.length - 3} more`) : names)} ${nothing ? `haven’t had work logged this week` : `${names.length === 1 ? 'is' : 'are'} waiting on ${joinNames(people)}`}.`;
    const act = people.length ? `<a class="x-lnk" href="#" onclick="remindHolders([${others.filter(w => w.holder && w.holder !== 'approvers').map(w => `'${w.c.id}'`).join(',')}]);return false;">Remind ${escapeHtml(joinNames(people))}</a>` : '';
    waitLine = `<div class="ty-wait">${icon('clock')}<span><b>Waiting on others:</b> ${escapeHtml(what)}</span>${act}</div>`;
  }

  // ---- the page ----
  const pill = p => p ? `<span class="ty-p${p[0] === 'red' ? ' red' : ''}">${escapeHtml(p[1])}</span>` : '';
  const itemRow = x => x.task
    ? `<div class="ty-i" onclick="${x.go}"><button class="ty-cb" role="checkbox" aria-checked="false" aria-label="Mark ${escapeHtml(x.title)} done" onclick="event.stopPropagation();moveTaskToStatus('${x.task.id}','done')"></button><div class="tx"><b>${escapeHtml(x.title)}</b><span>${x.sub}</span></div>${x.flag ? `<span class="ty-flag">${icon('flag', { fill: true })}</span>` : ''}${pill(x.pill)}</div>`
    : `<div class="ty-i" onclick="${x.go}">${monoHtml(x.c, 'sm')}<div class="tx"><b>${escapeHtml(x.title)}</b><span>${x.sub}</span></div>${pill(x.pill)}</div>`;
  const doneRow = x => `<div class="ty-i is-done"><span class="ty-cb on">${icon('check', { weight: 'bold' })}</span><div class="tx"><b>${escapeHtml(x.title)}</b><span>${escapeHtml(x.sub)} · ${fmtTime(x.t)}</span></div></div>`;
  const leadHtml = lead ? `<div class="ty-up"><span class="ty-lbl">Up next</span><div class="ty-up-row">${lead.c ? monoHtml(lead.c, 'lg') : `<span class="ty-up-ic">${icon(lead.ic)}</span>`}
<div class="tx"><b>${escapeHtml(lead.title)}</b><span>${escapeHtml(lead.sub)}</span></div><button class="btn btn-p ty-go" onclick="${lead.go}">${lead.ic ? icon(lead.ic) : ''}${escapeHtml(lead.label)}</button></div></div>`
    : `<div class="ty-clear">${icon('check-circle')}<div><b>You’re all caught up</b><span>${escapeHtml(nextDueText(ws.filter(w => myClientsFilter(w.c))) || 'Nothing is waiting on you right now.')}</span></div></div>`;
  const MAX = 6;
  root.innerHTML = `<div class="ty">
<header class="ty-hd"><div class="ty-date"><span class="ty-dow">${now.toLocaleDateString('en-US', { weekday: 'long' })}</span><span class="ty-dm">${now.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}</span></div>${ring}</header>
${strip}
<div class="ty-cols"><section class="ty-main">${leadHtml}
${items.length ? `<div class="ty-sec"><b>Also today</b><span>${items.length}</span></div><div data-grow-key="today-also">${items.slice(0, window._todayAll ? items.length : MAX).map(itemRow).join('')}${items.length > MAX ? `<a class="ty-more" href="#" data-grow="today-also" onclick="window._todayAll=${window._todayAll ? 'false' : 'true'};renderToday();return false;">${window._todayAll ? 'Show less' : `${items.length - MAX} more`}${window._todayAll ? '' : CHEV()}</a>` : ''}</div>` : ''}
${waitLine}
${done.length ? `<div class="ty-sec"><b>Done today</b><span>${done.length}</span></div>${done.slice(0, 4).map(doneRow).join('')}` : ''}
</section>
<aside class="ty-side">
<div class="ty-sec"><b>Schedule</b><a class="x-lnk" href="#calendar" onclick="switchView('calendar');return false;">Calendar</a></div>${sched || '<p class="ty-empty">No meetings today.</p>'}
<div class="ty-sec"><b>Your week</b></div>
<div class="ty-st"><span>Updates you sent</span><b>${sentByMe}</b></div>
<div class="ty-st"><span>Improvements you logged</span><b>${impsByMe}</b></div>
<div class="ty-st"><span>Hours logged</span><b>${hmText(weekMin)} <small>of ${target}</small></b></div><div class="ty-bar"><i style="width:${Math.min(100, weekMin / 60 / target * 100).toFixed(1)}%"></i></div>
${owned.length ? `<div class="ty-st"><span>Your clients on time</span><b>${onTime} of ${owned.length}</b></div>` : ''}
</aside></div></div>`;
  if(currentViewName === 'overview') setToolbar('Today', 'What you need to do today');
}
// "Next up: Oakridge Flooring, due tomorrow."
function nextDueText(ws){
  const n = ws.filter(w => w.sent).sort((a, b) => a.daysLeft - b.daysLeft)[0];
  return n ? `Next up: ${n.c.name}, ${n.dueText.toLowerCase()}.` : '';
}

// Older helpers other screens still call.
function todayInitials(name){ return clientMono({ name }); }
function todayLastSent(c){ return lastSentAt(c); }
function todayMono(name){ const c = (typeof clients !== 'undefined' ? clients : []).find(x => x.name === name) || { name }; return monoHtml(c); }
