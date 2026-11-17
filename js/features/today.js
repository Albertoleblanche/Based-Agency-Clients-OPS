// Today: the first screen. One sentence that says what needs you, then
// three short lists, most urgent first — drafts waiting, clients at risk,
// work due today — with the week's progress, today's agenda and your time
// on the side. Redrawn whenever renderKpis() runs, so it stays as live as
// the sidebar badges.

function todayInitials(name){
  const words = String(name || '').replace(/&/g, ' ').trim().split(/\s+/).filter(Boolean);
  return ((words[0] || '?').charAt(0) + (words[1] ? words[1].charAt(0) : '')).toUpperCase();
}

function todayMono(name){
  return `<span class="t-mono" aria-hidden="true">${escapeHtml(todayInitials(name))}</span>`;
}

function todayDot(color, label, extraClass){
  return `<span class="t-st${extraClass ? ' ' + extraClass : ''}"><span class="t-dot" style="background:${color}"></span>${escapeHtml(label)}</span>`;
}

const TODAY_CHEVRON = '<svg class="t-go" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M184.49,136.49l-80,80a12,12,0,0,1-17-17L159,128,87.51,56.49a12,12,0,1,1,17-17l80,80A12,12,0,0,1,184.49,136.49Z"/></svg>';

function todayPlural(n, one, many){ return `${n} ${n === 1 ? one : (many || one + 's')}`; }

// Drafts that are waiting on the person looking at the screen. Approvers
// see what the team has sent for review (the same rule Team Queue uses)
// plus their own drafts; everyone else sees their own drafts that are
// written and ready to send for review.
function todayWaitingDrafts(){
  const me = myName();
  const approver = canApprove();
  const out = [];
  attentionEligibleClients().forEach(c => {
    (c.drafts || []).forEach(d => {
      if(d.draftStatus !== 'pending') return;
      const mine = d.author === me;
      if(approver ? (mine || d.readyToNotify === true) : mine){
        const count = (d.draftImprovementIds || []).length || c.improvements.filter(i => i.author === d.author).length;
        out.push({ c, d, count });
      }
    });
  });
  out.sort((a, b) => (b.c.danger - a.c.danger) || (new Date(a.d.draftPendingSince || 0) - new Date(b.d.draftPendingSince || 0)));
  return out;
}

function todayLastSent(c){
  const sent = (c.drafts || []).map(d => d.draftSentAt).filter(Boolean).sort().pop();
  return sent ? new Date(sent) : null;
}

function todayWeekProgress(){
  const weekStart = getWeekStart(new Date());
  const counts = { sent: 0, approved: 0, review: 0, none: 0 };
  const list = attentionEligibleClients();
  list.forEach(c => {
    const drafts = c.drafts || [];
    if(drafts.some(d => d.draftSentAt && new Date(d.draftSentAt) >= weekStart)) counts.sent++;
    else if(drafts.some(d => d.draftStatus === 'approved' && !d.draftSentAt)) counts.approved++;
    else if(drafts.some(d => d.draftStatus === 'pending')) counts.review++;
    else counts.none++;
  });
  return { counts, total: list.length };
}

function renderToday(){
  const root = document.getElementById('todayRoot');
  if(!root) return;
  const now = new Date();
  const todayStr = toDateStr(now);
  const approver = canApprove();

  // --- waiting drafts
  const waiting = todayWaitingDrafts();
  const waitingRows = waiting.slice(0, 5).map(({ c, d, count }) => {
    const by = d.author === myName() ? 'Your draft' : `Weekly update by ${escapeHtml(d.author)}`;
    const since = d.draftPendingSince ? timeAgo(d.draftPendingSince) : '';
    const go = approver ? `switchView('teamqueue')` : `goToClientInQueue('${c.id}','pending')`;
    return `<div class="t-row" role="button" tabindex="0" onclick="${go}">${todayMono(c.name)}
      <div class="t-tx"><span class="t-t">${escapeHtml(c.name)}</span><span class="t-s">${by} · ${todayPlural(count, 'improvement')}</span></div>
      <div class="t-r">${todayDot('var(--blue)', 'Draft ready')}${since ? `<span>${escapeHtml(since)}</span>` : ''}${TODAY_CHEVRON}</div></div>`;
  }).join('');

  // --- clients at risk
  const risky = attentionEligibleClients().filter(c => (c.danger || 0) >= 4)
    .sort((a, b) => (b.danger - a.danger) || (b.importance - a.importance));
  const riskRows = risky.slice(0, 5).map(c => {
    const last = todayLastSent(c);
    const days = last ? Math.floor((now - last) / 86400000) : null;
    const why = last ? (days === 0 ? 'Update sent today' : `No update in ${todayPlural(days, 'day')}`) : 'No update sent yet';
    return `<div class="t-row" role="button" tabindex="0" onclick="openClientDetail('${c.id}')">${todayMono(c.name)}
      <div class="t-tx"><span class="t-t">${escapeHtml(c.name)}</span><span class="t-s">${escapeHtml(why)} · importance ${c.importance} of 10</span></div>
      <div class="t-r">${todayDot('var(--red)', 'Risk ' + c.danger, 't-red')}${TODAY_CHEVRON}</div></div>`;
  }).join('');

  // --- due today (and overdue)
  const due = tasks.filter(t => t.assigneeId === currentUser?.id && t.status !== 'done' && !t.cancelledAt && t.dueDate && t.dueDate <= todayStr)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const dueRows = due.slice(0, 6).map(t => {
    const client = clients.find(c => c.id === t.clientId);
    const overdue = t.dueDate < todayStr;
    const when = overdue ? `<span class="t-red">${escapeHtml(new Date(t.dueDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }))}</span>` : 'Today';
    return `<div class="t-row t-sm" role="button" tabindex="0" onclick="openTaskDetailModal('${t.id}')"><span class="t-cb" aria-hidden="true"></span>
      <div class="t-tx"><span class="t-t t-n">${escapeHtml(t.title)}</span><span class="t-s">${client ? escapeHtml(client.name) : 'No client'}</span></div>
      <div class="t-r">${t.priority === 'high' ? todayDot('var(--brand)', 'High') : ''}<span>${when}</span></div></div>`;
  }).join('');

  // --- side: week progress
  const { counts, total } = todayWeekProgress();
  const pct = n => total ? (n / total * 100).toFixed(1) : 0;
  const weekStart = getWeekStart(new Date());
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6);
  const fmtDay = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  // --- side: today's agenda
  const agenda = calendarEvents.filter(e => {
    if(toDateStr(new Date(e.startAt)) !== todayStr) return false;
    return (e.attendeeIds || []).includes(currentUser?.id) || e.createdBy === currentUser?.id;
  }).sort((a, b) => new Date(a.startAt) - new Date(b.startAt)).slice(0, 5);
  const agendaHtml = agenda.length ? agenda.map(e => {
    const t = e.allDay ? 'All day' : new Date(e.startAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return `<div class="t-ag" role="button" tabindex="0" onclick="openEventDetailModal('${e.id}')"><time>${escapeHtml(t)}</time><div class="t-tx"><span class="t-t">${escapeHtml(e.title)}</span>${e.location ? `<span class="t-s">${escapeHtml(e.location)}</span>` : ''}</div></div>`;
  }).join('') : `<p class="t-quiet">Nothing on your calendar today.</p>`;

  // --- side: your time this week
  const mine = timeEntries.filter(e => e.userId === currentUser?.id && e.date && e.date >= toDateStr(weekStart));
  const totalMin = mine.reduce((s, e) => s + (e.minutes || 0), 0);
  const byClient = {};
  mine.forEach(e => { byClient[e.clientId || ''] = (byClient[e.clientId || ''] || 0) + (e.minutes || 0); });
  const sorted = Object.entries(byClient).sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 3);
  const rest = sorted.slice(3).reduce((s, [, m]) => s + m, 0);
  if(rest) top.push(['__rest', rest]);
  const maxMin = Math.max(1, ...top.map(([, m]) => m));
  const timeHtml = totalMin ? top.map(([id, m]) => {
    const label = id === '__rest' ? 'Everything else' : (clients.find(c => c.id === id)?.name || 'No client');
    return `<div class="t-bar-row"><div class="t-bar-l"><span>${escapeHtml(label)}</span><span class="t-num">${formatMinutes(m)}</span></div><div class="t-bar"><i style="width:${(m / maxMin * 100).toFixed(0)}%"></i></div></div>`;
  }).join('') : `<p class="t-quiet">No time logged this week yet.</p>`;

  // --- headline
  let headline;
  if(waiting.length) headline = approver ? `${todayPlural(waiting.length, 'update')} ${waiting.length === 1 ? 'is' : 'are'} waiting for you` : `${todayPlural(waiting.length, 'draft')} ${waiting.length === 1 ? 'is' : 'are'} ready to send for review`;
  else if(risky.length) headline = `${todayPlural(risky.length, 'client')} need${risky.length === 1 ? 's' : ''} attention`;
  else headline = 'You’re all caught up';
  const subBits = [];
  if(risky.length) subBits.push(`<b>${todayPlural(risky.length, 'client')}</b> at risk`);
  subBits.push(`<b>${todayPlural(due.length, 'task')}</b> due`);
  subBits.push(`${counts.sent} of ${total} clients updated this week`);

  const section = (title, n, link, linkLabel, rows, empty) => `
    <div class="t-h2"><h2>${title}${n ? `<span class="t-c">${n}</span>` : ''}</h2>${link ? `<a role="button" tabindex="0" onclick="${link}">${linkLabel}</a>` : ''}</div>
    ${rows ? `<div class="t-grp">${rows}</div>` : `<div class="t-grp"><p class="t-quiet t-pad">${empty}</p></div>`}`;

  root.innerHTML = `
    <h1 class="t-lt">${escapeHtml(headline)}</h1>
    <p class="t-sub">${subBits.join(' · ')}</p>
    <div class="t-cols">
      <div class="t-main">
        ${section(approver ? 'Waiting for your review' : 'Ready to send for review', waiting.length, approver ? `switchView('teamqueue')` : `switchView('approve')`, approver ? 'Open Team Queue' : 'Open Review', waitingRows, 'Nothing is waiting on you.')}
        ${section('Clients at risk', risky.length, `switchView('clients')`, 'All clients', riskRows, 'No client is at risk 4 or 5 right now.')}
        ${section('Due today', due.length, `switchView('tasks')`, 'All tasks', dueRows, 'Nothing due today.')}
      </div>
      <aside class="t-side">
        <section class="t-panel"><h3>This week’s updates<span>${fmtDay(weekStart)} – ${fmtDay(weekEnd)}</span></h3>
          <div class="t-big">${counts.sent} <span>of ${total} clients sent</span></div>
          <div class="t-track" role="img" aria-label="${counts.sent} sent, ${counts.approved} approved, ${counts.review} in review, ${counts.none} not started">
            <i style="width:${pct(counts.sent)}%;background:var(--green)"></i><i style="width:${pct(counts.approved)}%;background:var(--purple)"></i><i style="width:${pct(counts.review)}%;background:var(--blue)"></i></div>
          <div class="t-legend">${todayDot('var(--green)', counts.sent + ' sent')}${todayDot('var(--purple)', counts.approved + ' approved')}${todayDot('var(--blue)', counts.review + ' in review')}<span class="t-st"><span class="t-dot t-hollow"></span>${counts.none} not started</span></div>
        </section>
        <section class="t-panel"><h3>Today<span>${escapeHtml(now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }))}</span></h3>${agendaHtml}</section>
        <section class="t-panel"><h3>Your time this week<span>${totalMin ? formatMinutes(totalMin) : '0h'}</span></h3>${timeHtml}</section>
      </aside>
    </div>`;
}
