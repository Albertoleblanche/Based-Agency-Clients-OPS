// This Week (canvas "This Week: the week at a glance", approved): the board for the week, not a
// to-do list (that's Today). Every client sits on the day its win is due, with the step it's on and
// who has it; who has the rest, with Remind, and how many got their win sit above. Clicking a client
// opens its update in the panel on the right, where its one button is. Members see their own
// clients; approvers see the whole team's.

let weekFilter = 'all';
function setWeekFilter(f){ weekFilter = f; renderThisWeek(); }

function weekVisibleClients(){
  const me = myName();
  return attentionEligibleClients().filter(c => canApprove() || clientOwner(c) === me || (c.improvements || []).some(i => i.author === me));
}
function selectWeekClient(id){ window._weekSel = id; renderThisWeek(); }
function closeWeekPanel(){ window._weekSel = null; window._weekDraftEdit = null; renderThisWeek(); }

// Who the update waits on, the row's words and its one button. bucket: 'now' | 'wait'.
function weekTodo(w){
  const me = myName(), approver = canApprove(), c = w.c, d = w.draft;
  const holder = w.holder && w.holder !== 'approvers' ? w.holder : null, who = firstName(holder || w.owner || '');
  const remind = [`remindHolder('${c.id}')`, 'Remind ' + who];
  if(w.done >= 3 && winViaWhatsapp(c)){
    // WhatsApp: whoever wrote it sends it (or whoever copied it first). Copying claims it.
    const st = winSendState(d), sender = st.k === 'copied' ? st.by : d.author;
    if(sender === me) return st.k === 'copied'
      ? { b: 'now', k: 'send', what: 'Copied: paste it in the group', act: [`markWinSent('${c.id}',${jsArg(d.author)})`, 'Mark as Sent'], copied: true }
      : { b: 'now', k: 'send', what: 'Send the approved win', act: [`copyWinForWhatsapp('${c.id}',${jsArg(d.author)})`, 'Copy for WhatsApp'] };
    return { b: 'wait', k: st.k === 'copied' ? 'w-copied' : 'w-send', holder: sender, what: st.k === 'copied' ? `${firstName(sender)} copied it, not in the group yet` : `${firstName(sender)} sends the approved win`, act: null };
  }
  if(w.done >= 3) return approver ? { b: 'now', k: 'send', what: 'Send the approved win', act: [`sendApprovedDraft('${c.id}',${jsArg(d.author)})`, 'Send'] }
    : { b: 'wait', k: 'w-approver', what: 'Approved, an approver sends it', act: null };
  if(w.done === 2) return approver ? { b: 'now', k: 'review', what: d.author === me ? 'Review your draft' : `Review ${firstName(d.author)}’s draft`, act: [`openReviewDraft('${c.id}',${jsArg(d.author)})`, 'Review'] }
    : { b: 'wait', k: 'w-review', what: 'Waiting on review', act: null };
  if(d){
    if(d.author === me && draftHasNoWork(c, d)){
      const mineLogged = w.logged.some(i => i.author === me && i.includeInEmail !== false);
      return mineLogged ? { b: 'now', k: 'write', empty: true, what: 'Its work was deleted: rewrite it', act: [`generateDraft('${c.id}',${jsArg(me)})`, 'Rewrite Draft'] }
        : { b: 'now', k: 'log', empty: true, what: 'Its work was deleted: log this week’s work', act: [`openQueueLogImprovementModal('${c.id}')`, 'Log Improvement'] };
    }
    if(d.author === me) return { b: 'now', k: 'forreview', what: 'Send your draft for review', act: [`sendDraftForReview('${c.id}',${jsArg(d.author)})`, 'Send for Review'] };
    if(approver && w.late) return { b: 'now', k: 'latedraft', what: `Send ${firstName(d.author)}’s draft for review`, act: [`openReviewDraft('${c.id}',${jsArg(d.author)})`, 'Open Draft'] };
    return { b: 'wait', k: 'w-draft', what: `${firstName(d.author)} hasn’t sent the draft for review`, act: remind };
  }
  const mine = !holder || holder === me;
  if(w.logged.length) return mine ? { b: 'now', k: 'write', what: 'Write this week’s draft', act: [`generateDraft('${c.id}',${jsArg(me)})`, 'Write Draft'] }
    : { b: 'wait', k: 'w-write', what: `${who} hasn’t written the draft`, act: remind };
  return mine ? { b: 'now', k: 'log', what: 'Log this week’s work', act: [`openQueueLogImprovementModal('${c.id}')`, 'Log Improvement'] }
    : { b: 'wait', k: 'w-log', what: `${who} hasn’t logged this week’s work`, act: remind };
}

// "2 days late", "3 weeks late"; how long a draft has waited, in words.
function lateWords(w){
  if(!w.last && w.late) return 'No update yet';
  const d = -w.daysLeft;
  return d <= 0 ? w.dueText : d === 1 ? '1 day late' : d < 14 ? `${d} days late` : d < 60 ? `${Math.floor(d / 7)} weeks late` : 'Months late';
}

// "20 min ago" · "3 hours ago" · "yesterday"
function weekAgo(at){
  const m = Math.max(0, Math.round((rNow() - new Date(at)) / 60000));
  return m < 60 ? `${Math.max(1, m)} min ago` : m < 1440 ? `${Math.round(m / 60)} hour${Math.round(m / 60) === 1 ? '' : 's'} ago` : relDayLower(new Date(at));
}
// ---- This Week, the board ------------------------------------------------------------------------
// How the week is going, at a glance: every client on the day its win is due (its win day, or when
// its weekly update falls due), with the step it's on and who has it. Today says what to do next and
// Review is where drafts get approved; this page is for seeing the whole week and who to chase.
const WB_STEPS = [['none', 'Nothing logged', 'gray'], ['logged', 'Work logged', 'yellow'], ['draft', 'Draft written', 'blue'],
  ['review', 'In review', 'purple'], ['approved', 'Approved', 'teal'], ['sent', 'Sent', 'green']];
const WB_STEP = Object.fromEntries(WB_STEPS.map((x, i) => [x[0], { word: x[1], tone: x[2], i }]));
function wbEntry(c, monday, today){
  const w0 = clientWeek(c), me = myName();
  const sentNow = !!w0.last && new Date(w0.last) >= monday;
  // Sent last week but inside its 7 days: this week's update is the next one.
  const w = sentNow ? w0 : w0.sent ? Object.assign({}, w0, w0.next || {}, { sent: false, state: 'due' }) : w0;
  const step = sentNow ? 'sent' : w.done >= 3 ? 'approved' : w.done === 2 ? 'review' : w.draft ? 'draft' : w.logged.length ? 'logged' : 'none';
  const at = dayStart(new Date(sentNow ? w0.last : w.due));
  const lateDays = sentNow ? 0 : Math.round((today - at) / 864e5);
  // Who has it: the owner until there's a draft, then its writer; approvers while it's in review
  // (and to send an approved email); a WhatsApp win goes back to whoever sends it.
  const approver = canApprove(), wa = step === 'approved' && winViaWhatsapp(c);
  let whoFull = sentNow ? '' : step === 'review' || (step === 'approved' && !wa) ? (approver ? me : 'approvers')
    : wa ? (winSendState(w.draft).k === 'copied' ? winSendState(w.draft).by : w.draft.author)
    : step === 'draft' ? w.draft.author : (w.holder && w.holder !== 'approvers' ? w.holder : w.owner) || '';
  if(whoFull && whoFull !== 'approvers' && whoFull !== me && (typeof teamProfiles !== 'undefined' && teamProfiles.length) && !profileByName(whoFull)) whoFull = '';
  return { c, w, step, empty: step === 'draft' && draftHasNoWork(c, w.draft), at, lateDays: Math.max(0, lateDays), late: lateDays > 0, col: sentNow || at >= monday ? at.getDay() : 'late',
    whoFull, who: !whoFull ? 'No owner' : whoFull === me ? 'You' : whoFull === 'approvers' ? 'An approver' : firstName(whoFull), mine: w0.owner === me || w.holder === me || whoFull === me };
}
// For a team member, a client's line says what happens next: their step in words when it's theirs
// ("Write the draft"), or who has it ("With an approver").
function wbMemberWords(e, me){
  if(e.whoFull === me) return e.empty ? 'Rewrite the draft'
    : { none: 'Log this week’s work', logged: 'Write the draft', draft: 'Send it for review', review: 'Review it', approved: 'Copy it for WhatsApp' }[e.step];
  if(e.whoFull === 'approvers') return e.step === 'approved' ? 'Approved, an approver sends it' : 'In review with an approver';
  return e.whoFull ? `With ${firstName(e.whoFull)}` : 'No owner yet';
}
// "1 day late", "3 weeks late", "Months late"; "No update yet" for a client that never had one.
function wbLateWords(e){
  if(!e.w.last) return 'No update yet';
  const d = e.lateDays;
  return d === 1 ? '1 day late' : d < 14 ? `${d} days late` : d < 60 ? `${Math.floor(d / 7)} weeks late` : 'Months late';
}
function renderThisWeek(){
  const root = document.getElementById('weekRoot');
  if(!root || typeof clients === 'undefined') return;
  const me = myName(), everyone = seesEveryone(), now = rNow(), today = dayStart(now);
  const monday = dayStart(addDays(now, -((now.getDay() + 6) % 7)));
  const all = weekVisibleClients().map(c => wbEntry(c, monday, today));
  if(weekFilter !== 'mine' || !everyone) weekFilter = 'all';
  const base = weekFilter === 'mine' ? all.filter(e => e.mine) : all;
  const selE = window._weekSel ? all.find(e => e.c.id === window._weekSel) : null;

  // ---- the week in one line: how many got their win, and where the rest are ----
  const sentN = base.filter(e => e.step === 'sent').length, lateN = base.filter(e => e.late).length, tot = Math.max(1, base.length);
  const counts = WB_STEPS.slice().reverse().map(([k, t, tone]) => [k, t, tone, base.filter(e => e.step === k).length]).filter(x => x[3]);
  const summary = `<div class="wb-sum"><div class="wb-big"><b>${sentN} of ${base.length}</b><span>${everyone && weekFilter !== 'mine' ? 'clients' : 'of your clients'} got their win this week</span>${lateN ? `<em>${lateN} late</em>` : ''}</div>
<div class="wb-bar" role="img" aria-label="${counts.map(x => `${x[1]}: ${x[3]}`).join(', ')}">${counts.map(([k, , tone, n]) => `<i class="${tone}" style="width:${(n / tot * 100).toFixed(2)}%"></i>`).join('')}</div>
<div class="wb-key">${counts.map(([k, t, tone, n]) => `<span><i class="wb-dot ${tone}"></i>${t} <b>${n}</b></span>`).join('')}</div></div>`;

  // ---- who has the rest: one entry per person, with a reminder ----
  const byWho = {};
  base.filter(e => e.step !== 'sent').forEach(e => { (byWho[e.whoFull] = byWho[e.whoFull] || []).push(e); });
  const people = Object.entries(byWho).sort((a, b) => (b[0] === me) - (a[0] === me) || b[1].length - a[1].length).map(([full, es]) => {
    const late = es.filter(e => e.late).length, name = !full ? 'No owner yet' : full === me ? 'You' : full === 'approvers' ? 'Approvers' : full;
    const steps = WB_STEPS.filter(([k]) => es.some(e => e.step === k)).map(([k, t]) => `${es.filter(e => e.step === k).length} ${t.toLowerCase()}`).join(', ');
    const remind = !full ? (canApprove() ? `<a class="x-lnk" href="#" onclick="switchView('clients');return false;">Set an Owner</a>` : '')
      : full !== me && full !== 'approvers' && profileByName(full) ? `<a class="x-lnk" href="#" onclick="remindHolders([${es.map(e => `'${e.c.id}'`).join(',')}]);return false;">Remind</a>` : '';
    return `<div class="wb-p"><div class="wb-ph"><b>${escapeHtml(name)}</b><span>${es.length}${late ? ` · <em>${late} late</em>` : ''}</span>${remind}</div><span class="wb-ps">${escapeHtml(steps)}</span></div>`;
  }).join('');

  // ---- the days ----
  const days = [1, 2, 3, 4, 5].concat(base.some(e => e.col === 6) ? [6] : [], base.some(e => e.col === 0) ? [0] : []);
  const cols = (base.some(e => e.col === 'late') ? ['late'] : []).concat(days);
  const entry = e => {
    const st = WB_STEP[e.step];
    if(e.step === 'sent') return `<div class="wb-e is-sent${selE && selE.c.id === e.c.id ? ' is-sel' : ''}" role="button" tabindex="0" title="Sent ${escapeHtml(fmtShortDate(new Date(e.w.last)))}" onclick="selectWeekClient('${e.c.id}')" onkeydown="if(event.key==='Enter')selectWeekClient('${e.c.id}')"><span class="wb-ck">${icon('check', { weight: 'bold' })}</span><b>${escapeHtml(shortClientName(e.c.name))}</b></div>`;
    return `<div class="wb-e${e.step === 'sent' ? ' is-sent' : ''}${selE && selE.c.id === e.c.id ? ' is-sel' : ''}" role="button" tabindex="0" onclick="selectWeekClient('${e.c.id}')" onkeydown="if(event.key==='Enter')selectWeekClient('${e.c.id}')">
<b>${escapeHtml(shortClientName(e.c.name))}</b><span class="wb-s${!everyone && e.whoFull === me ? ' is-yours' : ''}"><i class="wb-dot ${st.tone}"></i>${everyone ? `${e.empty ? 'Draft’s work was deleted' : st.word}${e.who ? ` · ${escapeHtml(e.who)}` : ''}` : escapeHtml(wbMemberWords(e, me))}</span>${e.late ? `<span class="wb-l">${wbLateWords(e)}</span>` : ''}</div>`;
  };
  // late first; for a member, then what's theirs to do; sent last
  const theirs = e => !everyone && e.step !== 'sent' && e.whoFull === me ? 0 : 1;
  const order = (a, b) => (b.late - a.late) || (theirs(a) - theirs(b)) || (WB_STEP[a.step].i - WB_STEP[b.step].i) || a.c.name.localeCompare(b.c.name);
  const colHtml = k => {
    const es = base.filter(e => e.col === k).sort(order);
    const date = k === 'late' ? null : addDays(monday, (k + 6) % 7), isToday = date && +date === +today;
    const sent = es.filter(e => e.step === 'sent').length, late = es.filter(e => e.late).length;
    const head = k === 'late' ? `<b>Overdue</b><span>from before this week</span>`
      : `<b>${isToday ? 'Today' : DAY_NAMES[k].slice(0, 3)}</b><span>${fmtShortDate(date)}${es.length ? ` · ${late ? `<em>${late} late</em>` : `${sent} of ${es.length} sent`}` : ''}</span>`;
    return `<section class="wb-c${isToday ? ' is-today' : ''}${date && date < today ? ' is-past' : ''}${k === 'late' ? ' is-late' : ''}${date && date < today && es.length && sent === es.length ? ' is-done' : ''}" aria-label="${k === 'late' ? 'Overdue' : DAY_NAMES[k]}">
<header class="wb-ch">${head}</header>${es.length ? `<div class="wb-es">${es.map(entry).join('')}</div>` : '<p class="wb-none">No wins due</p>'}</section>`;
  };
  const seg = everyone ? `<div class="seg" role="tablist" aria-label="Show">${[['all', 'Everyone', all.length], ['mine', 'Mine', all.filter(e => e.mine).length]]
    .map(([k, t, n]) => `<button class="${weekFilter === k ? 'on' : ''}" role="tab" aria-selected="${weekFilter === k}" onclick="setWeekFilter('${k}')">${t} <span class="c">${n}</span></button>`).join('')}</div>` : '';
  const empty = !base.length ? (!activeClients().length
      ? emptyNoClients('This Week shows each client’s win on its day: the step it’s on, who has it, and what went out.')
      : emptyState({ icon: 'calendar-blank', title: 'None of your clients have an update this week', text: 'Your clients show here on the day their win is due.', action: everyone ? 'Show Everyone' : '', onAction: "setWeekFilter('all')" })) : '';
  root.innerHTML = `<div class="spw"><div class="sp-page"><div class="wb">
<div class="wb-top">${summary}${seg}</div>
${everyone && people ? `<div class="wb-sec"><b>Who has the rest</b></div><div class="wb-people">${people}</div>` : ''}
${empty || `<div class="wb-cols n${cols.length}" style="--n:${cols.length}">${cols.map(colHtml).join('')}</div>`}
</div></div>${selE ? weekPanelHtml(selE.w) : ''}</div>`;
  // Which week this is, in the toolbar: "Nov 16 – 20" (or "Nov 30 – Dec 4").
  const fri = addDays(monday, 4), range = `${fmtShortDate(monday)} – ${monday.getMonth() === fri.getMonth() ? fri.getDate() : fmtShortDate(fri)}`;
  if(currentViewName === 'approve') setToolbar('This Week', `${range} · ${everyone ? 'every client gets a win, on their day' : `your ${base.length} client${base.length === 1 ? '' : 's'}, each with a win on their day`}`);
}
// Keep the old name working: everything that redraws "the queue" redraws This Week now.
function renderQueue(){ renderThisWeek(); }

// The panel: where this client's update is and its one main action, then the draft. Everything
// else folds into rows (Improvements, Progress, Last 8 weeks) whose summaries say enough to leave
// them shut; the everyday actions sit in a toolbar at the foot.
// Under the draft: work logged after it was written, or work in it that was deleted, with a way
// to rewrite it where that's allowed.
function weekDraftNote(w){
  const d = w.draft;
  if(w.sent || !d || typeof draftDelta !== 'function') return '';
  const dl = draftDelta(w.c, d), A = `'${w.c.id}',${jsArg(d.author)}`, may = canReworkDraft(w.c, d);
  if(dl.gone) return `<p class="sp-dnote">${icon('sparkle')}<span>${dl.allGone ? 'The work this draft was written from was deleted.' : `${dl.gone} improvement${dl.gone === 1 ? '' : 's'} in the draft ${dl.gone === 1 ? 'was' : 'were'} deleted.`}${may ? ` <a class="fix-lnk" href="#" onclick="generateDraft(${A});return false;">Rewrite it from what’s logged now</a>` : ' An approver can rewrite it from what’s logged now.'}</span></p>`;
  if(dl.added.length) return `<p class="sp-dnote">${icon('circle-plus')}<span>${dl.added.length === 1 ? '1 improvement was' : `${dl.added.length} improvements were`} logged after this draft.${may ? ` <a class="fix-lnk" href="#" onclick="generateDraft(${A});return false;">Rewrite to include ${dl.added.length === 1 ? 'it' : 'them'}</a>` : d.draftStatus === 'approved' ? ` ${dl.added.length === 1 ? 'It goes' : 'They go'} in the next update.` : ' An approver can rewrite to include them.'}</span></p>`;
  return '';
}
// Folded rows: closed until you open one, and they stay as you left them from client to client.
let WEEK_FOLDS = (() => { try { return JSON.parse(localStorage.getItem('wk-folds') || '{}') || {}; } catch(e){ return {}; } })();
function toggleWeekFold(k){
  WEEK_FOLDS[k] = !WEEK_FOLDS[k];
  try { localStorage.setItem('wk-folds', JSON.stringify(WEEK_FOLDS)); } catch(e){}
  renderThisWeek();
}
function weekFoldHtml(k, title, summary, body){
  const open = !!WEEK_FOLDS[k];
  return `<div class="sp-fold${open ? ' is-open' : ''}"><button class="sp-fold-h" aria-expanded="${open}" data-grow="wk-f-${k}" onclick="toggleWeekFold('${k}')">${icon('caret-right', { weight: 'bold' })}<b>${title}</b><span class="sm">${summary}</span></button><div class="sp-fold-b" data-grow-key="wk-f-${k}">${open ? body : ''}</div></div>`;
}
// Editing your own draft in the panel (for anyone without Review).
function startWeekDraftEdit(clientId, author){
  window._weekDraftEdit = clientId + '|' + author; renderThisWeek();
  setTimeout(() => { const ta = document.getElementById('draft-' + clientId); if(ta){ ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }, 30);
}
function cancelWeekDraftEdit(){ window._weekDraftEdit = null; renderThisWeek(); }
async function saveWeekDraftEdit(clientId, author){
  const ta = document.getElementById('draft-' + clientId); if(!ta) return;
  const ok = await saveDraftFor(clientId, author, { draft: ta.value });
  if(!ok){ showToast('error', 'Couldn’t save the draft', 'Try again in a moment.'); return; }
  window._weekDraftEdit = null; window._weekDraftFull = clientId;
  renderThisWeek(); showToast('success', 'Draft saved', '');
}
function weekPanelHtml(w){
  const c = w.c, me = myName(), d = w.draft, approver = canApprove();
  const t = w.sent ? null : (w.todo || weekTodo(w));
  const holder = w.holder && w.holder !== 'approvers' ? w.holder : w.owner;
  let eyebrow, title, sub, acts = '';
  const lastTxt = w.last ? `The last update went out ${fmtShortDate(w.last)}.` : 'No update sent yet.';
  if(w.sent){
    eyebrow = `<span class="sp-eb ok">${icon('check', { weight: 'bold' })}Sent ${escapeHtml(relDayLower(w.last))}</span>`;
    title = 'This week’s update is out'; sub = `Next one ${escapeHtml(w.dueText.replace(/^Due /, 'due '))}.`;
  } else {
    eyebrow = w.late ? `<span class="sp-eb red"><i class="eb-dot"></i>${escapeHtml(overdueShort(w))}</span>` : `<span class="sp-eb">${icon('clock', { weight: 'bold' })}${escapeHtml(w.dueText)}</span>`;
    if(w.done >= 3 && winViaWhatsapp(c)){
      // WhatsApp: who sends it, and whether it's been copied
      const st = winSendState(d), sender = st.k === 'copied' ? st.by : d.author;
      title = sender === me ? (st.k === 'copied' ? 'Copied: paste it in the group' : 'Approved: copy it and paste it in the group')
        : st.k === 'copied' ? `${firstName(sender)} copied it, not in the group yet` : `Approved. ${firstName(sender)} sends it in the group`;
      sub = st.k === 'copied' ? `Copied at ${fmtTime(new Date(st.at))}. ${winsDbReady() && winGroupFor(c) ? 'Radar marks it sent when it shows up in the group.' : 'Mark it sent once it’s in the group.'}` : lastTxt;
    }
    else if(w.done >= 3){ title = 'Approved and ready to send'; sub = lastTxt; }
    else if(w.done === 2){ title = `${d.author === me ? 'Your' : firstName(d.author) + '’s'} draft is waiting for ${approver ? 'you' : 'review'}`; sub = `Sent for review ${escapeHtml(relDayLower(d.draftPendingSince || rNow()))}${d.draftPendingSince ? ' at ' + fmtTime(new Date(d.draftPendingSince)) : ''}`; }
    else if(d && draftHasNoWork(c, d)){ title = `Nothing left in ${d.author === me ? 'your' : firstName(d.author) + '’s'} draft`; sub = 'Everything it was written from was deleted. Rewrite it from what’s logged now, or log the work first.'; }
    else if(d){ title = `${d.author === me ? 'Your' : firstName(d.author) + '’s'} draft is written, not sent for review yet`; sub = lastTxt; }
    else if(w.logged.length){ title = `${todayPlural(w.logged.length, 'improvement')} logged, no draft yet`; sub = lastTxt; }
    else { title = 'Nothing logged yet'; sub = `${holder ? escapeHtml(firstName(holder)) + ' owns this client. ' : ''}${lastTxt}`; }
    // Edit: in Review for whoever has Review (Edit and Rewrite live there); otherwise right here, for
    // the writer, until they send it for review.
    const own = d && d.author === me && w.done === 1, review = typeof hasPermission === 'function' && hasPermission('view_team_queue');
    const A = d ? `'${c.id}',${jsArg(d.author)}` : '';
    const editing = d && window._weekDraftEdit === c.id + '|' + d.author;
    const edit = !d || editing ? ''
      : review && w.done >= 1 && (approver || own) ? `<button class="btn" onclick="openReviewDraft(${A})">${icon('pencil-simple')}Edit</button>`
      : own ? `<button class="btn" onclick="startWeekDraftEdit(${A})">${icon('pencil-simple')}Edit</button><button class="btn" onclick="generateDraft(${A})">${icon('sparkle')}Rewrite</button>` : '';
    // in Review, the panel's main action approves and sends in one go (Edit opens it in Review first)
    const waOther = winViaWhatsapp(c) && d && d.author !== me;
    const main = w.done === 2 && approver ? `<button class="btn btn-p" onclick="approveAndSendOwnDraft('${c.id}',${jsArg(d.author)})">${winViaWhatsapp(c) ? (waOther ? `${icon('check')}Approve` : `${icon('copy')}Approve &amp; Copy`) : `${icon('paper-plane-tilt')}Approve &amp; Send`}</button>`
      : t && t.act ? `<button class="btn btn-p" onclick="${t.act[0]}">${escapeHtml(t.act[1])}</button>` : '';
    acts = !editing && (edit || main) ? `<div class="sp-acts">${edit}${main}</div>` : '';
  }
  // Progress: the four steps
  const stepSub = [
    w.sent || w.done > 0 ? todayPlural(w.sent ? (w.logged.length || 0) : w.logged.length, 'item') : 'Nothing yet',
    w.sent || w.done > 1 ? (d && d.draftPendingSince ? whenShort(d.draftPendingSince) : 'Done') : d ? 'Not yet' : 'No draft',
    w.sent || w.done > 2 ? 'Done' : w.done === 2 ? (approver ? 'Waiting on you' : 'Waiting on review') : '',
    w.sent ? relDay(w.last) : w.late ? lateWords(w) : w.dueText];
  const cur = w.sent ? 4 : w.done;
  const steps = STEP_NAMES.map((n, k) => {
    const cls = k < cur ? 'd' : k === cur ? 'w' : '';
    return `<div class="sp-st ${cls}"><span class="dot">${k < cur ? icon('check', { weight: 'bold' }) : ''}</span><b>${k === 1 ? 'Sent for review' : n}</b><span${k === 3 && w.late && !w.sent ? ' class="t-red"' : ''}>${escapeHtml(stepSub[k])}</span></div>`;
  }).join('');
  const nowWords = [w.logged.length ? 'log this week’s work' : 'nothing logged yet', d ? 'draft not sent for review' : 'no draft yet',
    approver ? 'waiting on you' : 'waiting on review', 'ready to send'][Math.min(cur, 3)];
  const progSum = w.sent ? `All done ·&nbsp;sent ${escapeHtml(relDayLower(w.last))}` : `Step ${cur + 1} of 4 ·&nbsp;<span class="sp-blue">${escapeHtml(nowWords)}</span>`;
  // Improvements: what's in the draft, what came after it, everything else logged for this update
  const dl = d && !w.sent && typeof draftDelta === 'function' ? draftDelta(c, d) : null;
  const inDraft = new Set(dl ? dl.inc.map(i => i.id) : []), isNew = new Set(dl ? dl.added.map(i => i.id) : []);
  const imps = w.logged.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
  const impRows = imps.map(i => {
    const k = inDraft.has(i.id) ? 'in' : isNew.has(i.id) ? 'new' : '';
    const ic = k === 'in' ? 'check-circle' : k === 'new' ? 'circle-plus' : 'circle';
    const who = i.author && i.author !== (d && d.author) ? firstName(i.author) + ' · ' : '';
    return `<div class="sp-i${k ? ' is-' + k : ''}">${icon(ic)}<span title="${escapeHtml(i.text)}">${escapeHtml(i.text)}</span><time>${escapeHtml(who)}${i.includeInEmail === false ? 'internal · ' : ''}${fmtShortDate(new Date(i.date))}</time></div>`;
  }).join('');
  const impSum = dl ? `${dl.inc.length} in the draft${dl.added.length ? ` ·&nbsp;<span class="sp-blue">${dl.added.length} new</span>` : ''}${dl.gone ? ` ·&nbsp;<span class="t-red">${dl.gone} deleted</span>` : ''}`
    : imps.length ? todayPlural(imps.length, 'logged', 'logged') : 'Nothing logged yet';
  // The draft reads in full right here, so it works whoever wrote it and wherever it is in review.
  const full = window._weekDraftFull === c.id, flat = d && d.draft ? d.draft.replace(/\s+/g, ' ').trim() : '';
  const long = flat.length > 220 || (d && /\n\s*\n/.test(d.draft || ''));
  const editingDraft = d && d.draft && !w.sent && window._weekDraftEdit === c.id + '|' + d.author;
  const draftCount = dl ? `<span>${todayPlural(dl.inc.length, 'improvement')}</span>` : '';
  const draft = editingDraft ? `<div class="sp-sec"><b>The draft</b></div>
<textarea class="sp-draft-edit" id="draft-${c.id}" spellcheck="true" aria-label="Draft">${escapeHtml(d.draft)}</textarea>
<div class="sp-draft-acts"><button class="btn" onclick="cancelWeekDraftEdit()">Cancel</button><button class="btn btn-p" onclick="saveWeekDraftEdit('${c.id}',${jsArg(d.author)})">Save Changes</button></div>`
    : d && d.draft ? `<div class="sp-sec"><b>The draft</b>${draftCount}${long ? `<a class="x-lnk" href="#" data-grow="wk-draft" onclick="window._weekDraftFull=${full ? 'null' : `'${c.id}'`};renderThisWeek();return false;">${full ? 'Show less' : 'Read in full'}</a>` : ''}</div>
<div class="sp-draft${full ? ' is-full' : ''}" data-grow-key="wk-draft"><b>Your weekly update — ${escapeHtml(updateRangeLabel(c))}</b>${full ? `<div class="sp-draft-body">${draftBodyHtml(d.draft)}</div>` : `<p>${escapeHtml(flat.slice(0, 320))}</p>`}</div>${weekDraftNote(w)}` : '';
  const seq = weekHistory(c), ots = onTimeSummary(seq);
  const wkSum = ots.total ? `${histDotsHtml(seq)}${ots.onTime} of ${ots.total} on time` : 'Starts with the first update';
  return `<aside class="sp sp-wk has-foot" aria-label="${escapeHtml(c.name)}, this week’s update">
<div class="sp-bar"><button class="ib" aria-label="Close" title="Close (Esc)" onclick="closeWeekPanel()">${icon('x')}</button><a class="x-lnk" href="#" onclick="openClientDetail('${c.id}');return false;">Open client page</a></div>
<div class="sp-main">
<div class="sp-head">${monoHtml(c, 'lg')}<div class="tx"><b>${escapeHtml(c.name)}</b><span>${[w.owner, c.service].filter(Boolean).map(escapeHtml).join(' · ')}</span></div></div>
<div class="sp-status">${eyebrow}<b>${escapeHtml(title)}</b><span class="sub">${sub}</span>${acts}</div>
${draft}
<div class="sp-folds">
${weekFoldHtml('imps', 'Improvements', impSum, impRows || '<p class="sp-empty">Nothing logged since the last update.</p>')}
${weekFoldHtml('prog', 'Progress', progSum, `<div class="sp-steps">${steps}</div>`)}
${weekFoldHtml('wks', 'Last 8 weeks', wkSum, weekStripHtml(c))}
</div>
${waOutsideNoteHtml(c)}
</div>
${clientQuickActionsHtml(c)}
</aside>`;
}

async function sendDraftForReview(id, author){
  const c = clients.find(x => x.id === id); if(!c) return;
  if(draftHasNoWork(c, getDraftFor(c, author))){ showToast('error', 'Nothing left in this draft', 'Everything it was written from was deleted. Rewrite it from what’s logged now, or log the work first.'); renderAll(); return; }
  const ok = await saveDraftFor(id, author, { readyToNotify: true });
  if(!ok){ showToast('error', 'Couldn’t send for review', 'Try again in a moment.'); return; }
  const approvers = teamProfiles.filter(p => (p.role === 'admin' || p.role === 'approver') && p.id !== currentUser?.id);
  for(const a of approvers) await sendNotification(a.id, 'draft_ready', `${c.name}: draft ready for review`, `${author}'s weekly update is ready.`, 'teamqueue', c.id);
  showToast('success', 'Sent for review', `${c.name} is in Review.`);
  renderAll();
}

// Escape closes whichever right-hand panel is open (This Week, Health, Focus Reports, Tasks).
document.addEventListener('keydown', e => {
  if(e.key !== 'Escape' || document.getElementById('appModalOverlay') || document.querySelector('.sheet-overlay, .modal-overlay')) return;
  const v = typeof currentViewName !== 'undefined' ? currentViewName : '';
  if(v === 'approve' && window._weekDraftEdit){ cancelWeekDraftEdit(); }
  else if(v === 'approve' && window._weekSel){ closeWeekPanel(); }
  else if(v === 'health' && window._healthSel && typeof closeHealthPanel === 'function'){ closeHealthPanel(); }
  else if(v === 'focusreports' && window._focusSel && typeof closeFocusPanel === 'function'){ closeFocusPanel(); }
  else if(v === 'tasks' && window._taskSel && typeof closeTaskPanel === 'function'){ closeTaskPanel(); }
});
