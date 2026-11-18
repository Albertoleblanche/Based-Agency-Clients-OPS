// This Week (canvas option B, approved): a to-do list in plain words. "Do now" is what only you
// can move forward, "Waiting on someone" is everything that isn't yours yet, then what went out.
// Clicking a row opens that client's update in a panel on the right; the row's own button acts
// without opening anything. Members see their own clients; approvers see the whole team's.

let weekFilter = 'all';
function setWeekFilter(f){ weekFilter = f; renderThisWeek(); }

function weekVisibleClients(){
  const me = myName();
  return attentionEligibleClients().filter(c => canApprove() || clientOwner(c) === me || (c.improvements || []).some(i => i.author === me));
}
function selectWeekClient(id){ window._weekSel = id; renderThisWeek(); }
function closeWeekPanel(){ window._weekSel = null; renderThisWeek(); }

// Who the update waits on, the row's words and its one button. bucket: 'now' | 'wait'.
function weekTodo(w){
  const me = myName(), approver = canApprove(), c = w.c, d = w.draft;
  const holder = w.holder && w.holder !== 'approvers' ? w.holder : null, who = firstName(holder || w.owner || '');
  const remind = [`remindHolder('${c.id}')`, 'Remind ' + who];
  if(w.done >= 3) return approver ? { b: 'now', what: 'Send the approved update', act: [`sendApprovedDraft('${c.id}',${jsArg(d.author)})`, 'Send'] }
    : { b: 'wait', what: 'Approved, an approver sends it', act: null };
  if(w.done === 2) return approver ? { b: 'now', what: d.author === me ? 'Review your draft' : `Review ${firstName(d.author)}’s draft`, act: [`openReviewDraft('${c.id}',${jsArg(d.author)})`, 'Review'] }
    : { b: 'wait', what: 'Waiting on review', act: null };
  if(d){
    if(d.author === me) return { b: 'now', what: 'Send your draft for review', act: [`sendDraftForReview('${c.id}',${jsArg(d.author)})`, 'Send for Review'] };
    if(approver && w.late) return { b: 'now', what: `Send ${firstName(d.author)}’s draft for review`, act: [`openReviewDraft('${c.id}',${jsArg(d.author)})`, 'Open Draft'] };
    return { b: 'wait', what: `${firstName(d.author)} hasn’t sent the draft for review`, act: remind };
  }
  const mine = !holder || holder === me;
  if(w.logged.length) return mine ? { b: 'now', what: 'Write this week’s draft', act: [`generateDraft('${c.id}',${jsArg(me)})`, 'Write Draft'] }
    : { b: 'wait', what: `${who} hasn’t written the draft`, act: remind };
  return mine ? { b: 'now', what: 'Log this week’s work', act: [`openQueueLogImprovementModal('${c.id}')`, 'Log Improvement'] }
    : { b: 'wait', what: `${who} hasn’t logged this week’s work`, act: remind };
}

function renderThisWeek(){
  const root = document.getElementById('weekRoot');
  if(!root || typeof clients === 'undefined') return;
  const me = myName();
  const all = weekVisibleClients().map(c => weekView(clientWeek(c)));
  const mine = all.filter(w => w.owner === me || w.holder === me);
  const shown = weekFilter === 'mine' ? mine : all;
  const open = shown.filter(w => !w.sent).map(w => Object.assign(w, { todo: weekTodo(w) }))
    .sort((a, b) => (b.late - a.late) || a.daysLeft - b.daysLeft || (b.c.importance || 0) - (a.c.importance || 0));
  const now = open.filter(w => w.todo.b === 'now'), wait = open.filter(w => w.todo.b === 'wait');
  const sent = shown.filter(w => w.sent).sort((a, b) => new Date(b.last || 0) - new Date(a.last || 0));
  const sel = window._weekSel ? all.find(w => w.c.id === window._weekSel) : null;

  const row = (w, primary) => {
    const t = w.todo, when = w.late ? `<span class="t-red">${escapeHtml(overdueShort(w))}</span>` : escapeHtml(w.dueText);
    const btn = t.act ? `<button class="btn sm${primary ? ' btn-p' : ''}" onclick="event.stopPropagation();${t.act[0]}">${escapeHtml(t.act[1])}</button>` : '<span class="tw-nobtn"></span>';
    return `<div class="tw-row${sel && sel.c.id === w.c.id ? ' is-sel' : ''}" role="button" tabindex="0" onclick="selectWeekClient('${w.c.id}')" onkeydown="if(event.key==='Enter')selectWeekClient('${w.c.id}')">${monoHtml(w.c)}
<div class="tx"><span class="cl">${escapeHtml(w.c.name)}</span><b>${escapeHtml(t.what)}</b></div><span class="when">${when}</span>${btn}</div>`;
  };
  const sec = (title, sub, rows) => rows ? `<div class="tw-h"><b>${title}</b><span class="n">${rows.length}</span><span class="s">${sub}</span></div>${rows.join('')}` : '';
  const nowRows = now.map((w, i) => row(w, i === 0)), waitRows = wait.map(w => row(w, false));
  const names = sent.map(w => shortClientName(w.c.name));
  const doneOpen = !!window._weekShowDone;
  const done = sent.length ? `<div class="tw-h"><b>Done this week</b><span class="n">${sent.length}</span><span class="s">Sent in the last 7 days</span></div>
${doneOpen ? sent.map(w => `<div class="tw-row" role="button" tabindex="0" onclick="selectWeekClient('${w.c.id}')">${monoHtml(w.c)}<div class="tx"><span class="cl">${escapeHtml(w.c.name)}</span><b class="tw-sent">${escapeHtml(w.note || 'Sent')}</b></div></div>`).join('')
    + `<a class="x-lnk tw-show" href="#" onclick="window._weekShowDone=false;renderThisWeek();return false;">Hide</a>`
    : `<div class="tw-done">${icon('check-circle')}<span class="tw-stack">${sent.slice(0, 9).map(w => monoHtml(w.c, 'sm')).join('')}</span><span class="tw-dn">${escapeHtml(names.length > 3 ? names.slice(0, 3).join(', ') + ` and ${names.length - 3} more` : names.join(', '))}</span><a class="x-lnk" href="#" onclick="window._weekShowDone=true;renderThisWeek();return false;">Show</a></div>`}` : '';
  const empty = !open.length && !sent.length ? `<div class="empty"><b>Nothing here</b>${weekFilter === 'mine' ? 'None of your clients have an update this week.' : 'No clients yet.'}</div>`
    : !open.length ? `<div class="tw-clear">${icon('check-circle')}<b>Every update is out</b><span>Nothing to do until the next ones are due.</span></div>` : '';
  const sum = weekSummary(weekVisibleClients());
  const seg = [['all', 'All', all.length], ['mine', 'Mine', mine.length]].map(([k, t, n]) => `<button class="${weekFilter === k ? 'on' : ''}" role="tab" aria-selected="${weekFilter === k}" onclick="setWeekFilter('${k}')">${t} <span class="c">${n}</span></button>`).join('');
  root.innerHTML = `<div class="spw"><div class="sp-page"><div class="tw">
<div class="tw-top"><div class="seg" role="tablist" aria-label="Show">${seg}</div><span class="sum"><b>${sum.sent} of ${sum.total}</b> sent in the last 7 days${sum.late ? ` · <span class="t-red">${sum.late} late</span>` : ''}</span></div>
${empty}${sec('Do now', 'Things only you can move forward', nowRows.length ? nowRows : null)}${sec('Waiting on someone', 'Nothing for you to do yet', waitRows.length ? waitRows : null)}${done}
</div></div>${sel ? weekPanelHtml(sel) : ''}</div>`;
  if(currentViewName === 'approve') setToolbar('This Week', 'What to do next, client by client');
}
// Keep the old name working: everything that redraws "the queue" redraws This Week now.
function renderQueue(){ renderThisWeek(); }

// The panel: where this client's update is, its one main action, the steps, the draft, the work.
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
    eyebrow = w.late ? `<span class="sp-eb red">${icon('warning', { weight: 'bold' })}${escapeHtml(overdueShort(w))}</span>` : `<span class="sp-eb">${icon('clock', { weight: 'bold' })}${escapeHtml(w.dueText)}</span>`;
    if(w.done >= 3){ title = 'Approved and ready to send'; sub = lastTxt; }
    else if(w.done === 2){ title = `${d.author === me ? 'Your' : firstName(d.author) + '’s'} draft is waiting for ${approver ? 'your' : 'an approver’s'} review`; sub = `Sent for review ${escapeHtml(relDayLower(d.draftPendingSince || rNow()))}${d.draftPendingSince ? ' at ' + fmtTime(new Date(d.draftPendingSince)) : ''}. ${lastTxt}`; }
    else if(d){ title = `${d.author === me ? 'Your' : firstName(d.author) + '’s'} draft is written, not sent for review yet`; sub = lastTxt; }
    else if(w.logged.length){ title = `${todayPlural(w.logged.length, 'improvement')} logged, no draft yet`; sub = lastTxt; }
    else { title = 'Nothing logged yet'; sub = `${holder ? escapeHtml(firstName(holder)) + ' owns this client. ' : ''}${lastTxt}`; }
    const edit = d && approver && w.done >= 1 ? `<button class="btn" onclick="openReviewDraft('${c.id}',${jsArg(d.author)})">${icon('pencil-simple')}Edit</button>` : '';
    // in Review, the panel's main action approves and sends in one go (Edit opens it in Review first)
    const main = w.done === 2 && approver ? `<button class="btn btn-p" onclick="approveAndSendOwnDraft('${c.id}',${jsArg(d.author)})">${icon('paper-plane-tilt')}Approve &amp; Send</button>`
      : t && t.act ? `<button class="btn btn-p" onclick="${t.act[0]}">${escapeHtml(t.act[1])}</button>` : '';
    acts = edit || main ? `<div class="sp-acts">${edit}${main}</div>` : '';
  }
  // the four steps
  const stepSub = [
    w.sent || w.done > 0 ? todayPlural(w.sent ? (w.logged.length || 0) : w.logged.length, 'item') : 'Nothing yet',
    w.sent || w.done > 1 ? (d && d.draftPendingSince ? whenShort(d.draftPendingSince) : 'Done') : d ? 'Not yet' : 'No draft',
    w.sent || w.done > 2 ? 'Done' : w.done === 2 ? (approver ? 'Waiting on you' : 'Waiting on review') : '',
    w.sent ? relDay(w.last) : w.dueText];
  const cur = w.sent ? 4 : w.done;
  const steps = STEP_NAMES.map((n, k) => {
    const cls = k < cur ? 'd' : k === cur ? 'w' : '';
    return `<div class="sp-st ${cls}"><span class="dot">${k < cur ? icon('check', { weight: 'bold' }) : ''}</span><b>${k === 1 ? 'Sent for review' : n}</b><span>${escapeHtml(stepSub[k])}</span></div>`;
  }).join('');
  const imps = w.logged.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  const showAll = window._weekImpsAll === c.id;
  const impRows = (showAll ? imps : imps.slice(0, 3)).map(i => `<div class="sp-imp"><b>${escapeHtml(i.text)}</b><span>${escapeHtml(i.service || c.service || '')} · ${fmtShortDate(new Date(i.date))}${i.includeInEmail === false ? ' · internal' : ''}</span></div>`).join('');
  const more = imps.length > 3 && !showAll ? `<a class="sp-more" href="#" onclick="window._weekImpsAll='${c.id}';renderThisWeek();return false;">${imps.length - 3} more</a>` : '';
  const draft = d && d.draft ? `<div class="sp-sec"><b>The draft</b><a class="x-lnk" href="#" onclick="openReviewDraft('${c.id}',${jsArg(d.author)});return false;">Read in full</a></div>
<div class="sp-draft"><b>Your weekly update — ${escapeHtml(updateRangeLabel(c))}</b><p>${escapeHtml(d.draft.replace(/\s+/g, ' ').slice(0, 320))}</p></div>` : '';
  const seq = weekHistory(c), ots = onTimeSummary(seq);
  return `<aside class="sp" aria-label="${escapeHtml(c.name)}, this week’s update">
<div class="sp-bar"><button class="ib" aria-label="Close" onclick="closeWeekPanel()">${icon('x')}</button><a class="x-lnk" href="#" onclick="openClientDetail('${c.id}');return false;">Open client</a></div>
<div class="sp-head">${monoHtml(c, 'lg')}<div class="tx"><b>${escapeHtml(c.name)}</b><span>${[w.owner, c.service].filter(Boolean).map(escapeHtml).join(' · ')}</span></div></div>
<div class="sp-status">${eyebrow}<b>${escapeHtml(title)}</b><span class="sub">${sub}</span>${acts}</div>
<div class="sp-steps">${steps}</div>
${draft}
<div class="sp-sec"><b>In this update</b><span>${imps.length}</span><a class="x-lnk" href="#" onclick="openQueueLogImprovementModal('${c.id}');return false;">Log Improvement</a></div>
${impRows || '<p class="sp-empty">Nothing logged since the last update.</p>'}${more}
<div class="sp-sec"><b>Last 8 weeks</b><span>${ots.total ? `${ots.onTime} of ${ots.total} on time` : 'History starts with the first update'}</span></div>
${weekStripHtml(c)}
</aside>`;
}

async function sendDraftForReview(id, author){
  const c = clients.find(x => x.id === id); if(!c) return;
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
  if(v === 'approve' && window._weekSel){ closeWeekPanel(); }
  else if(v === 'health' && window._healthSel && typeof closeHealthPanel === 'function'){ closeHealthPanel(); }
  else if(v === 'focusreports' && window._focusSel && typeof closeFocusPanel === 'function'){ closeFocusPanel(); }
  else if(v === 'tasks' && window._taskSel && typeof closeTaskPanel === 'function'){ closeTaskPanel(); }
});
