// Today: what needs you now, in order — updates due or overdue, clients whose health
// changed, drafts waiting for you — with your tasks due today and today's calendar on the side.
// Exactly the canvas "Today" board. Redrawn whenever data changes.

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

async function remindHolder(clientId){
  const c = clients.find(x => x.id === clientId); if(!c) return;
  const w = clientWeek(c), who = w.holder === 'approvers' ? null : profileByName(w.holder || w.owner);
  if(!who){ showToast('info', 'Nobody to remind', 'This update is waiting on approvers.'); return; }
  const next = w.behind != null ? ['log the week’s work', 'send the draft for review', 'approve it', 'send it'][w.behind] : 'get it ready';
  await sendNotification(who.id, 'update_behind', `${c.name}: this week’s update is ${w.late ? 'overdue' : 'due'}`,
    `${w.dueText}. Next: ${next}.`, 'approve', c.id);
  showToast('success', `Reminded ${firstName(who.name)}`, 'In the app, and on Slack if they use it.');
}

// Weeks of on-time history for every client, oldest first: o on time · l late · m missed · '' none.
// The same rule as weekHistory, over any number of complete Monday weeks.
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

function renderToday(){
  const root = document.getElementById('todayRoot');
  if(!root || typeof clients === 'undefined') return;
  const me = myName(), approver = canApprove();
  const list = attentionEligibleClients();
  const sum = weekSummary(list);
  const mine = sum.ws.filter(w => myClientsFilter(w.c));
  const behind = mine.filter(needsUpdate).sort(dueOrder);
  const late = behind.filter(w => w.late);
  const health = list.map(c => ({ c, h: clientHealth(c) }));
  const myRisk = health.filter(x => x.h.level === 'r' && myClientsFilter(x.c));
  const waiting = todayWaitingDrafts();

  // ---- the strip: the week's sending progress leads, three counts follow ----
  const sentPct = sum.total ? Math.round(sum.sent / sum.total * 100) : 0;
  const upcoming = sum.ws.filter(w => w.sent).sort((x, y) => x.due - y.due);
  const nextDay = upcoming[0] ? upcoming.filter(w => toDateStr(w.due) === toDateStr(upcoming[0].due)) : [];
  const nextLine = nextDay.length ? `Next due: ${nextDay.length} ${upcoming[0].daysLeft === 1 ? 'tomorrow' : 'on ' + (upcoming[0].daysLeft < 7 ? DAY_NAMES[upcoming[0].due.getDay()] : fmtShortDate(upcoming[0].due))}` : 'Nothing else due this week';
  const kp = (label, ic, n, sub, go, red) => `<button class="td-kp" onclick="${go}"><span class="td-kl">${icon(ic, { weight: 'bold' })}${label}</span><span class="td-kv"><b class="${n && red ? 't-red' : ''}">${n}</b></span><span class="td-ks">${escapeHtml(sub)}</span></button>`;
  const oldest = waiting[0] ? fmtWait(waiting[0].d.draftPendingSince || rNow()) : '';
  const strip = `<div class="td-strip">
<button class="td-kp td-lead" onclick="weekFilter='all';switchView('approve')"><span class="td-kl">Updates sent this week</span>
<span class="td-kv"><b>${sum.sent}</b><small>of ${sum.total}</small><i class="td-bar"><i style="width:${sentPct}%"></i></i><span class="td-pct">${sentPct}%</span></span><span class="td-ks">${escapeHtml(nextLine)}</span></button>
${kp('Overdue', 'warning', late.length, late.length ? todayNames(late.map(w => w.c)) : 'Nothing overdue', "weekFilter='behind';switchView('approve')", true)}
${kp(approver ? 'To review' : 'Your drafts', 'tray', waiting.length, waiting.length ? 'Oldest waiting ' + oldest : 'Nothing waiting', approver ? "switchView('teamqueue')" : "switchView('approve')")}
${kp('At risk', 'heart-pulse', myRisk.length, myRisk.length ? todayNames(myRisk.map(x => x.c)) : 'Every client looks healthy', "switchView('health')", true)}
</div>`;

  // ---- Needs you: one main action, then the few other things waiting on you ----
  const used = new Set();
  let lead = '';
  if(approver && waiting.length){
    waiting.forEach(x => used.add(x.c.id));
    const dues = [...new Set(waiting.map(x => { const w = clientWeek(x.c); return w.sent ? w.due.getDay() : -1; }))];
    const dueBit = dues.length === 1 && dues[0] >= 0 ? ` · all due ${DAY_NAMES[dues[0]]}` : '';
    lead = `<div class="td-lead-row"><span class="td-lead-ic">${icon('tray')}</span><div class="td-lead-tx"><b>Review ${todayPlural(waiting.length, 'draft')}</b><span>Oldest waiting ${oldest}${dueBit}</span></div>
<button class="btn btn-p td-lg" onclick="openReviewDraft('${waiting[0].c.id}',${jsArg(waiting[0].d.author)})">${icon('tray')}Start Review</button></div>`;
  } else if(!approver && waiting.some(x => !x.d.readyToNotify)){
    const mineW = waiting.filter(x => !x.d.readyToNotify); mineW.forEach(x => used.add(x.c.id));
    lead = `<div class="td-lead-row"><span class="td-lead-ic">${icon('send')}</span><div class="td-lead-tx"><b>Send ${todayPlural(mineW.length, 'draft')} for review</b><span>${escapeHtml(todayNames(mineW.map(x => x.c)))}</span></div>
<button class="btn btn-p td-lg" onclick="openWeekClient('${mineW[0].c.id}')">${icon('send')}Open Draft</button></div>`;
  } else if(behind.length){
    const w = behind[0]; used.add(w.c.id); const [go, label] = todayRowAction(w);
    lead = `<div class="td-lead-row">${monoHtml(w.c, 'lg')}<div class="td-lead-tx"><b>Get ${escapeHtml(shortClientName(w.c.name))}’s update out</b><span>${w.late ? `<span class="t-red">${escapeHtml(overdueShort(w))}</span> · ` : 'Due today · '}${escapeHtml(w.note || '')}</span></div>
<button class="btn btn-p td-lg" onclick="${go}">${label}</button></div>`;
  }
  const rows = [];
  behind.filter(w => !used.has(w.c.id)).forEach(w => {
    used.add(w.c.id); const [go, label] = todayRowAction(w);
    rows.push(`<div class="td-row" onclick="openWeekClient('${w.c.id}')">${monoHtml(w.c)}<div class="tx"><b>${escapeHtml(w.c.name)}</b><span>${w.late ? tagHtml('red', overdueShort(w)) : tagHtml('yellow', 'Due today')}${escapeHtml(w.note || '')}</span></div><button class="btn sm" onclick="event.stopPropagation();${go}">${label}</button></div>`);
  });
  myRisk.filter(x => !nextStepTask(x.c) && !used.has(x.c.id)).forEach(({ c }) => {
    used.add(c.id);
    rows.push(`<div class="td-row" onclick="openHealthClient('${c.id}')">${monoHtml(c)}<div class="tx"><b>${escapeHtml(c.name)}</b><span>${tagHtml('red', 'At risk')}No next step planned</span></div><button class="btn sm" onclick="event.stopPropagation();planNextStep('${c.id}')">Plan Next Step</button></div>`);
  });
  const MAX = 4, myCount = list.filter(myClientsFilter).length, rest = Math.max(0, myCount - used.size);
  const moreRow = rows.length > MAX ? `<a class="td-more" href="#approve" onclick="weekFilter='behind';switchView('approve');return false;">Show all ${rows.length}${CHEV()}</a>` : '';
  const foot = used.size ? `<div class="td-foot">${icon('check-circle')}Nothing else needs you: the other ${todayPlural(rest, 'client')} ${rest === 1 ? 'is' : 'are'} on track.</div>`
    : `<div class="td-clear">${icon('check-circle')}<b>You’re all caught up</b><span>${escapeHtml(nextDueText(mine) || 'Nothing is waiting on you right now.')}</span></div>`;
  const needs = `<section class="td-needs"><div class="td-h"><div><h2>Needs you</h2><span>${(lead ? 1 : 0) + rows.length ? todayPlural((lead ? 1 : 0) + rows.length, 'thing') : 'All clear'}</span></div></div>
${lead}${rows.length ? `<div class="td-also">${lead ? 'Also waiting on you' : ''}</div>${rows.slice(0, MAX).join('')}${moreRow}` : ''}${foot}</section>`;

  // ---- Your day: tasks due, then today's calendar with a line at the current time ----
  const todayStr = toDateStr(new Date());
  const due = (typeof tasks !== 'undefined' ? tasks : []).filter(t => t.assigneeId === currentUser?.id && t.status !== 'done' && !t.cancelledAt && t.dueDate && t.dueDate <= todayStr)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const dueRows = due.slice(0, 5).map(t => {
    const c = clients.find(x => x.id === t.clientId);
    const when = t.dueDate < todayStr ? `<span class="t-red">Due ${t.dueDate === toDateStr(addDays(new Date(), -1)) ? 'yesterday' : fmtShortDate(new Date(t.dueDate + 'T12:00:00'))}</span>` : (t.dueTime ? fmtTime(new Date(t.dueDate + 'T' + t.dueTime)) : 'Today');
    return `<div class="td-task"><button class="cb" role="checkbox" aria-checked="false" aria-label="Mark ${escapeHtml(t.title)} done" onclick="moveTaskToStatus('${t.id}','done')"></button>
<div class="tx" onclick="openTaskDetailModal('${t.id}')"><b>${escapeHtml(t.title)}</b><span>${c ? escapeHtml(c.name) + ' · ' : ''}${when}</span></div></div>`;
  }).join('');
  const now = rNow();
  const evs = (typeof calendarEvents !== 'undefined' ? calendarEvents : []).filter(e => !e.allDay && e.startAt && toDateStr(new Date(e.startAt)) === todayStr)
    .sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
  let nowShown = false;
  const nowLine = `<div class="td-now"><span>${fmtTime(now)}</span><i></i></div>`;
  const evRows = evs.map(e => {
    const start = new Date(e.startAt), past = new Date(e.endAt || e.startAt) <= now;
    let pre = '';
    if(!nowShown && start > now){ nowShown = true; pre = nowLine; }
    const link = (e.description || '').match(/https?:\/\/(meet\.google\.com|[a-z0-9.-]*zoom\.us|teams\.microsoft\.com)\/\S+/i);
    const join = !past && link && start - now < 15 * 60000 ? `<a class="btn sm" href="${safeUrl(link[0])}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Join</a>` : '';
    return `${pre}<div class="td-ev${past ? ' past' : ''}" onclick="openEventDetailModal('${e.id}')"><span class="tm">${fmtTime(start)}</span><div class="tx"><b>${escapeHtml(e.title)}</b><span>${escapeHtml((e.description || '').split('\n')[0])}</span></div>${join}</div>`;
  }).join('') + (evs.length && !nowShown ? nowLine : '');
  const day = `<aside class="td-day"><div class="td-h"><div><h2>Your day</h2><span>${todayPlural(due.length, 'task')} · ${todayPlural(evs.length, 'event')}</span></div><a class="td-link" href="#tasks" onclick="switchView('tasks');return false;">All Tasks</a></div>
${dueRows || '<div class="td-empty">Nothing due today.</div>'}
<div class="td-h sub"><div><h2>Calendar</h2></div><a class="td-link" href="#calendar" onclick="switchView('calendar');return false;">Open Calendar</a></div>
${evRows || '<div class="td-empty">No meetings today.</div>'}</aside>`;

  // ---- The agency at a glance ----
  const codes = list.map(c => todayWeekCodes(c, 14));
  const tally = (from, to) => { let o = 0, l = 0, m = 0; codes.forEach(cs => cs.slice(from, to).forEach(x => { if(x === 'o') o++; else if(x === 'l') l++; else if(x === 'm') m++; })); return { o, l, m, n: o + l + m }; };
  const cur = tally(7, 14), prev = tally(0, 7);
  const pct = cur.n ? Math.round(cur.o / cur.n * 100) : null, prevPct = prev.n >= 7 ? Math.round(prev.o / prev.n * 100) : null;
  const delta = pct != null && prevPct != null ? pct - prevPct : null;
  const weeks = [...Array(7)].map((_, i) => { let o = 0, l = 0, m = 0; codes.forEach(cs => { const x = cs[7 + i]; if(x === 'o') o++; else if(x === 'l') l++; else if(x === 'm') m++; }); return { o, l, m }; });
  const maxN = Math.max(1, ...weeks.map(w => w.o + w.l + w.m));
  const bars = weeks.map((w, i) => { const t = w.o + w.l + w.m, mon = addDays(dayStart(addDays(now, -((now.getDay() + 6) % 7))), -7 * (7 - i));
    return `<i class="td-col" title="Week of ${fmtShortDate(mon)}: ${w.o} on time${w.l ? ', ' + w.l + ' late' : ''}${w.m ? ', ' + w.m + ' missed' : ''}" style="height:${Math.max(4, t / maxN * 100)}%">${w.m ? `<i class="miss" style="flex:${w.m}"></i>` : ''}${w.l ? `<i class="late" style="flex:${w.l}"></i>` : ''}${w.o ? `<i class="ok" style="flex:${w.o}"></i>` : ''}</i>`; }).join('');
  const ontime = `<section class="td-ag"><div class="td-h"><div><h2>Updates on time</h2><span>Last 7 weeks</span></div></div>
${pct == null ? '<div class="td-empty">Not enough history yet.</div>' : `<div class="td-big"><b>${pct}%</b>${delta != null && delta !== 0 ? `<span class="${delta > 0 ? 't-green' : 't-red'}">${icon(delta > 0 ? 'arrow-up' : 'arrow-down', { weight: 'bold' })}${Math.abs(delta)} pts</span>` : ''}</div>
<div class="td-cols">${bars}</div><div class="td-lg"><span><i class="late"></i>Late <b>${cur.l}</b></span><span><i class="miss"></i>Missed <b>${cur.m}</b></span></div>`}</section>`;
  const hc = { g: 0, y: 0, r: 0 }; health.forEach(x => hc[x.h.level]++);
  const risky = health.filter(x => x.h.level === 'r').slice(0, 2);
  const healthPanel = `<section class="td-ag"><div class="td-h"><div><h2>Client health</h2><span>${todayPlural(list.length, 'client')}</span></div><a class="td-link" href="#health" onclick="switchView('health');return false;">Open</a></div>
<div class="td-hc"><span><i class="good"></i><b>${hc.g}</b>Healthy</span><span><i class="late"></i><b>${hc.y}</b>Watch</span><span><i class="miss"></i><b>${hc.r}</b>At risk</span></div>
<div class="td-seg">${hc.g ? `<i class="good" style="flex:${hc.g}"></i>` : ''}${hc.y ? `<i class="late" style="flex:${hc.y}"></i>` : ''}${hc.r ? `<i class="miss" style="flex:${hc.r}"></i>` : ''}</div>
${risky.map(({ c }) => `<a class="td-mrow" href="#health" onclick="openHealthClient('${c.id}');return false;">${monoHtml(c, 'sm')}<span class="fn">${escapeHtml(c.name)}</span>${tagHtml('red', 'At risk')}</a>`).join('')}
${hc.y ? `<a class="td-mrow" href="#health" onclick="switchView('health');return false;"><span class="ph"></span><span class="fn t-2">${hc.y} to watch</span>${CHEV()}</a>` : ''}</section>`;
  const paces = list.map(c => ({ c, hp: hoursPace(c) })).filter(x => x.hp.budget);
  const usedH = paces.reduce((t, x) => t + x.hp.used, 0), budH = paces.reduce((t, x) => t + x.hp.budget, 0), projH = paces.reduce((t, x) => t + x.hp.projected, 0);
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(), dayN = now.getDate();
  const top = paces.slice().sort((a, b) => (b.hp.used > b.hp.budget) - (a.hp.used > a.hp.budget) || b.hp.used - a.hp.used).slice(0, 2);
  const hoursPanel = `<section class="td-ag"><div class="td-h"><div><h2>Hours this month</h2><span>Day ${dayN} of ${dim}</span></div><a class="td-link" href="#time" onclick="switchView('time');return false;">Open</a></div>
${budH ? `<div class="td-big"><b>${Math.round(usedH)}</b><small>of ${Math.round(budH)} h</small></div>
<div class="td-pace"><i style="width:${Math.min(100, usedH / budH * 100)}%"></i><em style="left:${dayN / dim * 100}%"></em></div>
<div class="td-pace-l"><span>${Math.round(usedH / budH * 100)}% used</span>${projH <= budH * 1.02 ? `<span class="t-green">${icon('check', { weight: 'bold' })}On pace</span>` : `<span class="t-red">${icon('warning', { weight: 'bold' })}Over pace</span>`}</div>
${top.map(({ c, hp }) => `<a class="td-mrow" href="#clientdetail" onclick="openClientDetail('${c.id}');return false;">${monoHtml(c, 'sm')}<span class="fn">${escapeHtml(c.name)}</span><span class="hv"><b class="${hp.used > hp.budget ? 't-red' : ''}">${Math.round(hp.used)}</b> / ${hp.budget} h</span></a>`).join('')}` : '<div class="td-empty">No hour budgets set.</div>'}</section>`;
  let teamPanel = '';
  if(approver){
    const m0 = new Date(now.getFullYear(), now.getMonth(), 1);
    const people = (typeof teamProfiles !== 'undefined' ? teamProfiles : []).map(p => {
      const mins = (typeof timeEntries !== 'undefined' ? timeEntries : []).filter(e => e.userId === p.id && new Date(e.date + 'T12:00:00') >= m0).reduce((t, e) => t + (e.minutes || 0), 0);
      let o = 0, n = 0; list.forEach((c, i) => { if(clientOwner(c) !== p.name) return; codes[i].slice(7).forEach(x => { if(x) { n++; if(x === 'o') o++; } }); });
      return { p, h: mins / 60, on: n ? Math.round(o / n * 100) : null };
    }).filter(x => x.h > 0 || x.on != null).sort((a, b) => b.h - a.h).slice(0, 5);
    teamPanel = `<section class="td-ag"><div class="td-h"><div><h2>Team</h2><span>Hours · on time</span></div><a class="td-link" href="#team" onclick="switchView('team');return false;">Open</a></div>
${people.map(x => `<div class="td-trow">${avHtml(x.p.name)}<span class="fn">${escapeHtml(x.p.name)}</span><span class="hv"><b>${Math.round(x.h)}</b> h</span><span class="hv w">${x.on == null ? '—' : x.on + '%'}</span></div>`).join('') || '<div class="td-empty">No time logged this month.</div>'}</section>`;
  }

  root.innerHTML = `<div class="td">${strip}
<div class="td-mid">${needs}${day}</div>
<div class="td-sec"><h2>The agency</h2><span>How everyone’s doing this month</span></div>
<div class="td-agency${approver ? '' : ' three'}">${ontime}${healthPanel}${hoursPanel}${teamPanel}</div></div>`;
  if(currentViewName === 'overview') setToolbar('Today', new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }));
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
