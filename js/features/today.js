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

function renderToday(){
  const root = document.getElementById('todayRoot');
  if(!root || typeof clients === 'undefined') return;
  const list = attentionEligibleClients();
  const sum = weekSummary(list);
  const mine = sum.ws.filter(w => myClientsFilter(w.c));
  const behind = mine.filter(needsUpdate).sort(dueOrder);
  const lateN = behind.filter(w => w.late).length;
  const health = list.filter(myClientsFilter).map(c => ({ c, h: clientHealth(c) })).filter(x => x.h.level !== 'g')
    .sort((a, b) => (a.h.level === 'r' ? 0 : 1) - (b.h.level === 'r' ? 0 : 1) || (b.h.since || 0) - (a.h.since || 0));
  const atRisk = health.filter(x => x.h.level === 'r').length;
  const waiting = todayWaitingDrafts();
  let h1;
  if(sum.sent === sum.total && sum.total) h1 = `All ${sum.total} updates are sent`;
  else if(lateN) h1 = `${todayPlural(lateN, 'update')} ${lateN === 1 ? 'is' : 'are'} overdue`;
  else if(behind.length) h1 = `${todayPlural(behind.length, 'update')} ${behind.length === 1 ? 'is' : 'are'} due today`;
  else if(waiting.length) h1 = `${todayPlural(waiting.length, 'update')} ${waiting.length === 1 ? 'is' : 'are'} waiting for you`;
  else h1 = 'You’re all caught up';
  const dueToday = behind.length - lateN;
  const subBits = [`<b>${sum.sent} of ${sum.total}</b> sent in the last 7 days`];
  if(lateN && dueToday) subBits.push(`<b>${dueToday}</b> more due today`);
  if(atRisk) subBits.push(`<b>${atRisk}</b> ${atRisk === 1 ? 'client' : 'clients'} at risk`);
  if(waiting.length) subBits.push(`<b>${waiting.length}</b> ${waiting.length === 1 ? 'draft' : 'drafts'} waiting for your review`);

  const behindRows = behind.map(w => {
    const sub = (w.done === 0 ? `${w.note} · ${w.owner || '—'}` : w.note);
    const who = w.holder && w.holder !== 'approvers' ? w.holder : w.owner;
    return `<a class="row" href="#approve" onclick="openWeekClient('${w.c.id}');return false;">${monoHtml(w.c)}<div class="tx"><span class="t">${escapeHtml(w.c.name)}</span><span class="s"><span class="${w.late ? 't-red' : ''}">${escapeHtml(w.dueText)}</span> · ${escapeHtml(sub)}</span></div>
<div class="r">${stepsHtml(w)}${who ? avHtml(who) : ''}<button class="btn act sm" onclick="event.stopPropagation();event.preventDefault();remindHolder('${w.c.id}')">Remind ${escapeHtml(firstName(who) || '')}</button>${CHEV()}</div></a>`;
  }).join('');
  const healthRows = health.slice(0, 6).map(({ c, h }) => `<a class="row" href="#health" onclick="openHealthClient('${c.id}');return false;">${monoHtml(c)}<div class="tx"><span class="t">${escapeHtml(c.name)}</span><span class="s">${escapeHtml(shortSignal(h))}</span></div>
<div class="r">${hstateHtml(h.level)}<span style="width:52px;text-align:right">${relDay(h.since || rNow())}</span>${CHEV()}</div></a>`).join('');
  const waitRows = waiting.slice(0, 6).map(({ c, d, count }) => `<a class="row" href="#teamqueue" onclick="openReviewDraft('${c.id}','${jsArg(d.author)}');return false;">${monoHtml(c)}<div class="tx"><span class="t">${escapeHtml(c.name)}</span><span class="s">${escapeHtml(d.author)} · ${todayPlural(count, 'improvement')}</span></div>
<div class="r"><span class="st"><span class="dot blue"></span>Draft ready</span><span style="width:76px;text-align:right">Waiting ${fmtWait(d.draftPendingSince || rNow())}</span>${CHEV()}</div></a>`).join('');

  const todayStr = toDateStr(new Date());
  const due = (typeof tasks !== 'undefined' ? tasks : []).filter(t => t.assigneeId === currentUser?.id && t.status !== 'done' && !t.cancelledAt && t.dueDate && t.dueDate <= todayStr)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const dueRows = due.map(t => {
    const c = clients.find(x => x.id === t.clientId);
    const when = t.dueDate < todayStr ? `<span class="t-red">Due ${t.dueDate === toDateStr(addDays(new Date(), -1)) ? 'yesterday' : fmtShortDate(new Date(t.dueDate + 'T12:00:00'))}</span>` : (t.dueTime ? fmtTime(new Date(t.dueDate + 'T' + t.dueTime)) : 'Today');
    return `<div class="row sm"><button class="cb" role="checkbox" aria-checked="false" aria-label="Mark ${escapeHtml(t.title)} done" onclick="moveTaskToStatus('${t.id}','done')"></button>
<div class="tx" onclick="openTaskDetailModal('${t.id}')"><span class="t" style="font-weight:400">${escapeHtml(t.title)}</span><span class="s">${c ? escapeHtml(c.name) + ' · ' : ''}${when}</span></div></div>`;
  }).join('');
  const now = rNow();
  const evs = (typeof calendarEvents !== 'undefined' ? calendarEvents : []).filter(e => !e.allDay && e.startAt && toDateStr(new Date(e.startAt)) === todayStr)
    .sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
  const nextEv = evs.find(e => new Date(e.endAt || e.startAt) > now);
  const evRows = evs.map(e => {
    const past = new Date(e.endAt || e.startAt) <= now, next = e === nextEv, start = new Date(e.startAt);
    const sub = next && start > now ? `Starts in ${fmtDuration(start - now).replace(' hours', ' h').replace(' hour', ' h').replace(' minutes', ' min').replace(' minute', ' min')}` : (e.description || '').split('\n')[0];
    const link = (e.description || '').match(/https?:\/\/(meet\.google\.com|[a-z0-9.-]*zoom\.us|teams\.microsoft\.com)\/\S+/i);
    const join = next && link ? `<div class="r"><a class="btn sm" href="${safeUrl(link[0])}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Join</a></div>` : '';
    return `<div class="row sm"${past ? ' style="opacity:.45"' : ''} onclick="openEventDetailModal('${e.id}')"><span class="t-2" style="width:58px;flex:0 0 auto;font-size:12px">${fmtTime(start)}</span>
<div class="tx"><span class="t" style="font-weight:${next ? 500 : 400}">${escapeHtml(e.title)}</span><span class="s">${escapeHtml(sub)}</span></div>${join}</div>`;
  }).join('');

  const section = (title, n, link, label, rows, empty) => `<div class="h2"><h2>${title}<span class="c">${n}</span></h2>${link ? `<a href="#${link}" onclick="switchView('${link}');return false;">${label}</a>` : ''}</div>
<div class="grp">${rows || `<div class="row sm"><span class="s t-2" style="font-size:12px">${empty}</span></div>`}</div>`;
  root.innerHTML = `<h1 class="lt">${escapeHtml(h1)}</h1>
<p class="lt-sub">${subBits.join(' · ')}</p>
<div class="cols">
<div class="col-main">
${section(lateN ? 'Overdue and due today' : 'Due today', behind.length, 'approve', 'Open This Week', behindRows, `Nothing is due. ${nextDueText(sum.ws.filter(w => myClientsFilter(w.c)))}`)}
${section('Health changes', health.length, 'health', 'Open Health', healthRows, 'Every client looks healthy.')}
${section(canApprove() ? 'Waiting for your review' : 'Your drafts', waiting.length, canApprove() ? 'teamqueue' : 'approve', canApprove() ? 'Open Review' : 'Open This Week', waitRows, 'Nothing is waiting for you.')}
</div>
<aside class="col-side">
<div class="h2"><h2>Due today<span class="c">${due.length}</span></h2><a href="#tasks" onclick="switchView('tasks');return false;">All Tasks</a></div>
<div class="grp flat">${dueRows || '<div class="row sm"><span class="s t-2" style="font-size:12px">Nothing due today.</span></div>'}</div>
<div class="h2"><h2>Calendar<span class="c">Today</span></h2><a href="#calendar" onclick="switchView('calendar');return false;">Open Calendar</a></div>
<div class="grp flat">${evRows || '<div class="row sm"><span class="s t-2" style="font-size:12px">No meetings today.</span></div>'}</div>
</aside>
</div>`;
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
function todayMono(name){ return `<span class="mono" aria-hidden="true">${escapeHtml(clientMono({ name }))}</span>`; }
