// Overview dashboard: KPIs, needs-attention list, active queue, my tasks /
// notes, daily summary card, mini calendar, greeting.

async function goToQueueFilter(filter){
  queueFilter = filter;
  await switchView('approve');
  setQueueFilter(filter);
}

// The Pending Approval / Weekly Completion KPI cards show a team-wide count
// for admins but a personal one for everyone else — this routes each to
// wherever that number actually lives, instead of always landing on the
// personal queue regardless of which count was just shown.
async function goToPendingKpi(){
  if(isAdmin()){
    await switchView('teamqueue');
    setTeamQueueFilter('pending');
  } else {
    await goToQueueFilter('pending');
  }
}
async function goToApprovedKpi(){
  if(isAdmin()){
    await switchView('teamqueue');
    setTeamQueueFilter('approved');
  } else {
    await goToQueueFilter('approved');
  }
}

async function goToClientInQueue(id, filter){
  queueFilter = filter || 'all';
  await switchView('approve');
  setQueueFilter(queueFilter);
  const el = document.getElementById('q-'+id);
  if(el){
    el.scrollIntoView({behavior:'smooth', block:'center'});
    el.classList.add('highlight-flash');
    setTimeout(()=>el.classList.remove('highlight-flash'), 1500);
  }
  openQueueCardModal(id);
}

let attentionTierFilter = null;

function setAttentionTierFilter(tier){
  attentionTierFilter = tier;
  const clearBtn = document.getElementById('attentionFilterClear');
  if(clearBtn) clearBtn.style.display = tier ? 'inline' : 'none';
  renderAttentionList();
  renderTotalClientsDonut();
}

function renderAttentionList(){
  const el = document.getElementById('attentionList');
  if(!el) return;
  const hasOverdueReminder = c => clientReminders.some(r=>r.clientId===c.id && r.askedBy===currentUser?.id && reminderDisplayStatus(r)==='due');
  // A client can now have several independent drafts (one per author, see
  // addendum-25.sql) — "pending" here means at least one of them is, since
  // this dashboard widget is about whether ANYTHING needs attention for
  // this client, not any one specific person's draft.
  const hasPendingDraft = c => (c.drafts||[]).some(d => d.draftStatus==='pending');
  let items = attentionEligibleClients().filter(c => c.danger>=4 || hasPendingDraft(c) || hasOverdueReminder(c));
  if(attentionTierFilter) items = attentionEligibleClients().filter(c => riskLabel(c.danger).text === attentionTierFilter);
  items.sort((a,b)=> b.danger-a.danger || (hasPendingDraft(b))-(hasPendingDraft(a)));
  if(!items.length){
    const title = attentionTierFilter ? `No clients in "${attentionTierFilter}"` : 'Nothing urgent right now';
    const sub = attentionTierFilter ? 'Try a different segment, or clear the filter to see everyone.' : 'At-risk clients, drafts waiting on approval, and overdue follow-ups will show up here.';
    el.innerHTML = emptyStateHtml(
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5" /></svg>',
    title, sub
  ); return; }

  const cap = attentionTierFilter ? 10 : 6;
  el.innerHTML = items.slice(0,cap).map(c=>{
    const overdue = hasOverdueReminder(c);
    const pending = hasPendingDraft(c);
    const reason = pending ? 'Draft awaiting approval'
      : c.danger>=4 ? riskLabel(c.danger).text
      : overdue ? 'Follow-up overdue'
      : riskLabel(c.danger).text;
    const onclickAction = pending ? `goToClientInQueue('${c.id}','pending')`
      : c.danger>=4 ? `goToClientInQueue('${c.id}','atrisk')`
      : overdue ? `openClientDetail('${c.id}')`
      : `goToClientInQueue('${c.id}','atrisk')`;
    return `<div class="ov-row" onclick="${onclickAction}">
      <span class="ov-row-dot" style="background:${riskLabel(c.danger).color};"></span>
      <div class="ov-row-main">
        <div class="ov-row-name">${escapeHtml(c.name)}</div>
        <div class="ov-row-sub">${escapeHtml(reason)}</div>
      </div>
      <span class="ov-row-meta">${c.importance}/10</span>
    </div>`;
  }).join('');
}

function renderClientOptionsSelects(){
  ['ncService','ncStatus'].forEach(id=>{
    const sel = document.getElementById(id);
    if(!sel || sel.tagName!=='SELECT') return;
    const options = id==='ncService' ? settings.serviceOptions : settings.statusOptions;
    const current = sel.value;
    sel.innerHTML = (options||[]).map(o=>`<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
    if(options && options.includes(current)) sel.value = current;
  });
  const impSel = document.getElementById('ncImportance');
  if(impSel && !impSel.options.length){
    impSel.innerHTML = Array.from({length:10},(_,i)=>i+1).map(n=>`<option ${n===5?'selected':''}>${n}</option>`).join('');
  }
  renderOptionsManager('service');
  renderOptionsManager('status');
  renderCustomFieldsManager();
  renderDangerWeights();
  renderAiProviderChoice();
  populateClientFilterSelects();
  populateImprovementsClientFilter();
  populateImprovementsMemberFilter();
}

function renderKpis(){
  const ac = activeClients();
  const active = ac.filter(c=>c.status==='Active').length;
  // Used for the metrics below that signal "you should work on this" —
  // pending-approval badges and Client Health — so a paused client's
  // draft or danger score doesn't nag anyone into action. Total Clients
  // above still uses the full ac, since paused clients are still real,
  // countable clients on the roster.
  const aec = attentionEligibleClients();
  const me = myName();
  const admin = isAdmin();
  // Pending Approval and Weekly Completion are personal for regular members
  // and approvers — scoped to clients they themselves logged something for —
  // same split already established for Approval Queue and the Hours chart.
  // Total Clients and Client Health stay roster-wide regardless of role,
  // since this app has no "my clients" ownership concept to scope them by.
  const pending = admin
    ? aec.filter(c=>(c.drafts||[]).some(d=>d.draftStatus==='pending')).length
    : aec.filter(c=>getDraftFor(c, me).draftStatus==='pending' && c.improvements.some(i=>i.author===me)).length;
  // Approval Queue is personal now — the sidebar badge needs to match what
  // that page actually shows, not every pending draft on the whole roster.
  // Uses the page's own card rule (queueCardEligible) so the badge never
  // counts a client the page wouldn't show a card for.
  const myPending = aec.filter(c=>getDraftFor(c, me).draftStatus==='pending' && queueCardEligible(getDraftFor(c, me), c.improvements.filter(i=>i.author===me && improvementInDateRange(i, false)))).length;
  (document.getElementById('navPendingBadge')||{}).textContent = myPending;
  // Team Queue shows every APPROVED draft, plus pending drafts the owning
  // member has explicitly marked Ready to Notify — not every pending draft
  // team-wide (a draft just sitting generated-but-unsent is still that
  // member's private working state). This badge has to match that exact
  // rule, or it counts things the page itself won't show — see
  // readyForReview() in renderTeamQueue() for the canonical version of
  // this same check. Counted per-(client, author) pair now, same as Team
  // Queue's own count — the same client can legitimately count once per
  // contributing member, not just once overall.
  // Uses the page's own card rule (queueCardEligible), so an approved
  // draft whose improvements were marked "not in email" by approval still
  // counts — the page shows it too, ready to send. Deliberately ignores
  // the Team Queue page's own date filter dropdown — a persistent nav
  // badge shouldn't change count based on a filter that lives on another
  // page.
  const teamPendingBadge = document.getElementById('navTeamPendingBadge');
  if(teamPendingBadge){
    // Mirrors renderTeamQueue()'s own readyForReview() exactly, including
    // the admin/approver-viewing-their-own-work exception AND excluding
    // already-sent drafts — an approved draft that's since been sent is
    // archived out of every tab except the dedicated Sent one on the page
    // itself. The page achieves that exclusion via a separate statusMatches
    // check combined alongside readyForReview, which this badge doesn't
    // have, so the sent-check has to sit here instead, checked before the
    // admin exception rather than after it — otherwise an admin's own
    // already-sent draft would still slip through via that early return.
    const readyForReview = (c, author) => {
      const d = getDraftFor(c, author);
      if(d.draftStatus==='approved' && d.draftSentAt) return false;
      if(author===myName() && canApprove()) return true;
      if(d.draftStatus==='approved') return true;
      if(d.draftStatus!=='pending') return false;
      return d.readyToNotify===true;
    };
    if(typeof reviewBadgeCount === 'function'){ const n = reviewBadgeCount(); teamPendingBadge.textContent = n; teamPendingBadge.style.display = n ? '' : 'none'; }
    else teamPendingBadge.textContent = teamProfiles.reduce((total, member) => {
      const count = aec.filter(c => queueCardEligible(getDraftFor(c, member.name), c.improvements.filter(i=>i.author===member.name)) && readyForReview(c, member.name)).length;
      return total + count;
    }, 0);
  }

  // --- Total Clients ---
  (document.getElementById('kpiTotal')||{}).textContent = ac.length;
  (document.getElementById('totalChips')||{}).innerHTML = ac.length
    ? `<span style="font-size:12px;color:var(--green);font-weight:600;">${active} active</span>`
    : '';
  renderTotalClientsDonut();

  // --- Client Health: inverse of average danger score, excluding paused clients
  //     (a paused client's risk score shouldn't drag the whole team's health
  //     signal down or up — no one should be acting on it either way) ---
  let healthPct = 0;
  if(aec.length){
    const avgDanger = aec.reduce((s,c)=>s+c.danger,0) / aec.length;
    healthPct = Math.round(100 - (avgDanger/5)*100);
  }
  (document.getElementById('kpiHealth')||{}).textContent = aec.length ? healthPct + '%' : '—';
  const healthTier = healthPct>=70 ? {cls:'pill-good',label:'Healthy',color:'#117F3A'} : healthPct>=40 ? {cls:'pill-mid',label:'Needs attention',color:'#A65B05'} : {cls:'pill-bad',label:'Critical',color:'#CF2424'};
  (document.getElementById('healthChips')||{}).innerHTML = aec.length ? `<span class="pill ${healthTier.cls}">${escapeHtml(healthTier.label)}</span>` : '';
  const healthBarsFillEl = document.getElementById('healthBarsFill');
  if(healthBarsFillEl){
    healthBarsFillEl.style.width = (aec.length ? healthPct : 0) + '%';
    healthBarsFillEl.style.setProperty('--health-fill-color', healthTier.color);
  }

  // --- Open Tasks (always personal — tasks are assigned to a specific person) ---
  const myOpenTasks = tasks.filter(t => t.assigneeId===currentUser?.id && t.status!=='done' && !t.cancelledAt);
  const overdueTasks = myOpenTasks.filter(t => t.dueDate && t.dueDate < toDateStr(new Date())).length;
  const tasksEl = document.getElementById('kpiTasks');
  if(tasksEl) tasksEl.textContent = myOpenTasks.length;
  const tasksChips = document.getElementById('tasksChips');
  if(tasksChips) tasksChips.innerHTML = overdueTasks
    ? `<span class="pill pill-bad">${overdueTasks} overdue</span>`
    : myOpenTasks.length ? `<span class="pill pill-status">None overdue</span>` : `<span class="pill pill-status">All clear</span>`;

  // --- Pending Approval ---
  (document.getElementById('kpiPendingLabel')||{}).textContent = admin ? 'Pending Approval' : 'Drafts Ready';
  (document.getElementById('kpiPending')||{}).textContent = pending;
  (document.getElementById('pendingChips')||{}).innerHTML = pending
    ? `<span class="pill pill-mid">${pending} draft${pending!==1?'s':''} ready</span>`
    : `<span class="pill pill-status">All caught up</span>`;

  // --- Weekly Completion: of clients with a log this calendar week (mine, if not admin), how many are approved ---
  const withRecentLogs = admin
    ? ac.filter(hasLoggedThisWeek)
    : ac.filter(c => c.improvements.some(i => i.author===me && i.date && new Date(i.date) >= getWeekStart(new Date())));
  // Admin view checks if ANY author's draft for the client is approved;
  // personal view checks specifically the viewer's own draft — matching
  // the same admin/personal split withRecentLogs itself already uses.
  const approvedWithLogs = withRecentLogs.filter(c => admin ? (c.drafts||[]).some(d=>d.draftStatus==='approved') : getDraftFor(c, me).draftStatus==='approved').length;
  const completionPct = withRecentLogs.length ? Math.round((approvedWithLogs/withRecentLogs.length)*100) : 0;
  (document.getElementById('kpiCompletionLabel')||{}).textContent = 'Weekly Completion';
  (document.getElementById('kpiCompletion')||{}).textContent = withRecentLogs.length ? completionPct + '%' : '—';
  (document.getElementById('completionChips')||{}).innerHTML = withRecentLogs.length
    ? `<span class="pill pill-status">${approvedWithLogs} of ${withRecentLogs.length} updated</span>`
    : `<span class="pill pill-status">No logs yet</span>`;

  renderOverviewUpcoming();
  renderOverviewMyTasks();
  renderOverviewMyNotes();
  renderOverviewDailySummary();
  renderOverviewMiniCalendar();
  renderOverviewActiveQueue();
  renderGreeting();
  if(typeof renderDashboard === 'function') renderDashboard();
}

function renderOverviewActiveQueue(){
  const el = document.getElementById('overviewActiveQueue');
  if(!el) return;
  const weekStart = getWeekStart(new Date());
  const me = myName();
  const myThisWeek = (c)=> c.improvements.some(i=> i.date && new Date(i.date) >= weekStart && i.author === me);
  const active = activeClients().filter(myThisWeek).sort((a,b)=> b.danger-a.danger || b.importance-a.importance);
  if(!active.length){ el.innerHTML = emptyStateHtml(
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /> <path d="m16 9-5.5 5.5L8 12" /></svg>',
    "You haven't logged anything this week yet",
    'Log an improvement for a client and it\'ll show up here.'
  ); return; }
  el.innerHTML = active.slice(0,7).map(c=>{
    const status = statusMeta(c, me);
    const recentCount = c.improvements.filter(i=>i.date && new Date(i.date) >= weekStart && i.author === me).length;
    return `<div class="ov-row" onclick="goToClientInQueue('${c.id}','all')">
      <span class="ov-row-dot" style="background:${riskLabel(c.danger).color};"></span>
      <div class="ov-row-main">
        <div class="ov-row-name">${escapeHtml(c.name)}</div>
        <div class="ov-row-sub" style="color:${status.color};">${escapeHtml(status.label)}</div>
      </div>
      <span class="ov-row-meta">${recentCount}×</span>
    </div>`;
  }).join('');
}

// Upcoming events + task due dates in one chronological list. Both are
// "things with a date coming at you", so splitting them across two panels
// would just make you check twice.
function renderOverviewUpcoming(){
  const el = document.getElementById('overviewUpcoming');
  if(!el) return;
  const now = new Date();
  const horizon = new Date(now); horizon.setDate(horizon.getDate()+14);

  const items = calendarEvents.filter(e=>{
    const start = new Date(e.startAt);
    if(start < now || start > horizon) return false;
    return (e.attendeeIds||[]).includes(currentUser?.id) || e.createdBy===currentUser?.id;
  }).map(e=>({
    when: new Date(e.startAt), title: e.title,
    color: (CALENDAR_TYPE_META[e.eventType]||CALENDAR_TYPE_META.other).color,
    onclick: `openEventDetailModal('${e.id}')`
  }));

  if(!items.length){
    el.innerHTML = `<div class="empty" style="padding:10px 0;">Nothing on your calendar in the next two weeks.</div>`;
    return;
  }
  items.sort((a,b)=> a.when - b.when);

  const todayStr = toDateStr(now);
  el.innerHTML = items.slice(0,3).map(it=>{
    const isToday = toDateStr(it.when)===todayStr;
    const dayLabel = isToday ? 'Today' : it.when.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
    const timeLabel = it.when.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
    return `<div class="ov-row" onclick="${it.onclick}">
      <span class="ov-row-dot" style="background:${it.color};"></span>
      <div class="ov-row-main">
        <div class="ov-row-name">${escapeHtml(it.title)}</div>
        <div class="ov-row-sub">${dayLabel} · ${timeLabel}</div>
      </div>
      <span class="ov-row-meta">${isToday ? timeLabel : dayLabel}</span>
    </div>`;
  }).join('');
}

function renderOverviewMyTasks(){
  const el = document.getElementById('overviewMyTasks');
  if(!el) return;
  const myTasks = tasks.filter(t => t.assigneeId===currentUser?.id && t.status!=='done' && !t.cancelledAt);
  if(!myTasks.length){
    el.innerHTML = `<div class="empty" style="padding:10px 0;">Nothing on your plate right now.</div>`;
    return;
  }
  const now = new Date();
  const todayStr = toDateStr(now);
  myTasks.sort((a,b)=>{
    const aOverdue = a.dueDate && a.dueDate < todayStr, bOverdue = b.dueDate && b.dueDate < todayStr;
    if(aOverdue !== bOverdue) return aOverdue ? -1 : 1;
    if(a.dueDate && b.dueDate) return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
    if(a.dueDate) return -1;
    if(b.dueDate) return 1;
    return (TASK_PRIORITY_META[a.priority]?.order ?? 9) - (TASK_PRIORITY_META[b.priority]?.order ?? 9);
  });

  el.innerHTML = myTasks.slice(0,3).map(t=>{
    const pMeta = TASK_PRIORITY_META[t.priority] || TASK_PRIORITY_META.low;
    const overdue = t.dueDate && t.dueDate < todayStr;
    const dateLabel = t.dueDate
      ? (overdue ? 'Overdue' : new Date(t.dueDate+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'2-digit'}))
      : 'No due date';
    const preview = (t.description||'').trim();
    return `<div class="ov-note-row" onclick="openTaskDetailModal('${t.id}')">
      <div class="ov-note-title">${escapeHtml(t.title)}</div>
      ${preview ? `<div class="ov-note-desc">${escapeHtml(preview)}</div>` : ''}
      <div class="ov-note-meta-row">
        <span class="ov-note-stage-pill" style="background:${pMeta.color}18;color:${pMeta.color};">${escapeHtml(pMeta.label)}</span>
        <span class="ov-note-date" style="${overdue?'color:var(--red);font-weight:600;':''}">${escapeHtml(dateLabel)}</span>
      </div>
    </div>`;
  }).join('');
}

function renderOverviewMyNotes(){
  const el = document.getElementById('overviewMyNotes');
  if(!el) return;
  const myNotes = notes.filter(n => n.status!=='done').sort((a,b)=> new Date(b.updatedAt) - new Date(a.updatedAt));
  if(!myNotes.length){
    el.innerHTML = `<div class="empty" style="padding:10px 0;">Nothing open here — all caught up.</div>`;
    return;
  }
  el.innerHTML = myNotes.slice(0,3).map(n=>{
    const stage = NOTE_STAGES.find(s=>s.key===n.status) || NOTE_STAGES[0];
    const title = n.title || 'Untitled note';
    const preview = (n.text||'').trim();
    const dateLabel = new Date(n.updatedAt).toLocaleDateString('en-US',{month:'short',day:'2-digit'});
    return `<div class="ov-note-row" onclick="openNotePreview('${n.id}')">
      <div class="ov-note-title">${escapeHtml(title)}</div>
      ${preview ? `<div class="ov-note-desc">${escapeHtml(preview)}</div>` : ''}
      <div class="ov-note-meta-row">
        <span class="ov-note-stage-pill" style="background:${stage.color}18;color:${stage.color};">${escapeHtml(stage.label)}</span>
        <span class="ov-note-date">${escapeHtml(dateLabel)}</span>
      </div>
    </div>`;
  }).join('');
}

async function renderOverviewDailySummary(){
  const el = document.getElementById('overviewDailySummary');
  if(!el) return;
  el.innerHTML = `<div class="empty" style="padding:10px 0;"><span class="spinner"></span>Loading…</div>`;
  try{
    const { data: { session } } = await supabaseClient.auth.getSession();
    const dateStr = toDateStr(new Date());
    const response = await fetch(`/api/get-daily-summary?date=${dateStr}`, {
      headers: { 'Authorization': `Bearer ${session.access_token}` },
    });
    const data = await response.json();
    if(!response.ok || !data.summary){
      el.innerHTML = `<div class="empty" style="padding:10px 0;">Could not load today's summary.</div>`;
      return;
    }
    const myOverdueReminders = clientReminders.filter(r=>r.askedBy===currentUser?.id && reminderDisplayStatus(r)==='due').length;
    const overdueLine = myOverdueReminders ? `<div class="ov-row" style="cursor:pointer;" onclick="switchView('reminders')">
      <span class="ov-row-dot" style="background:#3A63C9;"></span>
      <div class="ov-row-main">
        <div class="ov-row-name">${myOverdueReminders} follow-up${myOverdueReminders!==1?'s':''} due</div>
      </div>
    </div>` : '';
    if(!data.summary.length){
      el.innerHTML = overdueLine || `<div class="empty" style="padding:10px 0;">You haven't logged any time today yet.</div>`;
      return;
    }
    // This card is personal, same as the rest of Overview — but the API
    // itself returns everyone's entries for admins and approvers (that's
    // correct for the Time Tracker page's own Daily Summary tab, which is
    // meant to be team-wide for those roles). So regardless of role, find
    // and show specifically the current user's own entry here, not
    // whichever branch the response happened to take.
    const mine = data.summary.find(p => p.userId === currentUser?.id);
    if(!mine){
      el.innerHTML = overdueLine || `<div class="empty" style="padding:10px 0;">You haven't logged any time today yet.</div>`;
      return;
    }
    el.innerHTML = overdueLine + mine.entries.map(e=>`
      <div class="ov-row" style="cursor:default;">
        <span class="ov-row-dot" style="background:var(--brand-dark);"></span>
        <div class="ov-row-main">
          <div class="ov-row-name">${escapeHtml(e.client)}${e.service?` <span style="font-weight:400;color:var(--muted-lt);">(${escapeHtml(e.service)})</span>`:''}</div>
          ${e.description ? `<div class="ov-row-sub">${escapeHtml(e.description)}</div>` : ''}
        </div>
        <span class="ov-row-meta">${formatMinutes(e.minutes)}</span>
      </div>`).join('');
  }catch(e){
    el.innerHTML = `<div class="empty" style="padding:10px 0;">Could not load today's summary — check your connection.</div>`;
  }
}

let overviewMiniCalDate = new Date();
function navOverviewMiniCal(dir){
  overviewMiniCalDate.setMonth(overviewMiniCalDate.getMonth()+dir);
  renderOverviewMiniCalendar();
}
function goToCalendarDate(dateStr){
  switchView('calendar').then(()=> jumpToCalendarDate(dateStr));
}
function renderOverviewMiniCalendar(){
  const el = document.getElementById('overviewMiniCalendar');
  if(!el) return;
  const labelEl = document.getElementById('ovMiniCalLabel');
  if(labelEl) labelEl.textContent = overviewMiniCalDate.toLocaleDateString('en-US',{month:'long',year:'numeric'});

  // Same personal scope as My Tasks + Upcoming — my events, my task due
  // dates — so the dots here agree with what those two lists already show.
  const markedDays = new Set();
  calendarEvents.forEach(e=>{
    if(!(e.attendeeIds||[]).includes(currentUser?.id) && e.createdBy!==currentUser?.id) return;
    markedDays.add(toDateStr(new Date(e.startAt)));
  });
  tasks.forEach(t=>{
    if(t.assigneeId!==currentUser?.id || t.status==='done' || t.cancelledAt || !t.dueDate) return;
    markedDays.add(t.dueDate);
  });

  const year = overviewMiniCalDate.getFullYear(), month = overviewMiniCalDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = getWeekStart(firstOfMonth);
  const todayStr = toDateStr(new Date());

  let daysHtml = '';
  for(let i=0;i<42;i++){
    const cellDate = new Date(gridStart);
    cellDate.setDate(cellDate.getDate()+i);
    const cellStr = toDateStr(cellDate);
    const isOtherMonth = cellDate.getMonth()!==month;
    const isToday = cellStr===todayStr;
    const hasMark = markedDays.has(cellStr);
    daysHtml += `<div class="ov-mini-cal-day ${isOtherMonth?'other-month':''} ${isToday?'today':''}" onclick="goToCalendarDate('${cellStr}')">${cellDate.getDate()}${hasMark ? '<span class="ov-mini-cal-dot"></span>' : ''}</div>`;
  }

  el.innerHTML = `<div class="ov-mini-cal-grid">
    <div class="ov-mini-cal-dow">M</div><div class="ov-mini-cal-dow">T</div><div class="ov-mini-cal-dow">W</div><div class="ov-mini-cal-dow">T</div><div class="ov-mini-cal-dow">F</div><div class="ov-mini-cal-dow">S</div><div class="ov-mini-cal-dow">S</div>
    ${daysHtml}
  </div>`;
}

function renderGreeting(){
  const isOverviewActive = document.getElementById('view-overview')?.classList.contains('active');
  if(!isOverviewActive) return;
  const titleEl = document.getElementById('topbarTitle');
  const subEl = document.getElementById('topbarSub');
  if(!titleEl) return;
  titleEl.textContent = typeof viewTitle === 'function' ? viewTitle('overview') : 'Dashboard';
  if(subEl) subEl.textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}
