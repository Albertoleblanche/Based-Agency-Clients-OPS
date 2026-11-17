// This Week: every client's weekly update, as on the canvas board. Each client gets one a week,
// sent by an approver the day it's ready. List + detail: Overdue first, then Due today, Due soon
// (next 2 days, a heads-up) and Sent.
// Members see their own clients; approvers see the whole team's.

let weekFilter = 'all';
function setWeekFilter(f){ weekFilter = f; renderThisWeek(); }

function weekVisibleClients(){
  const me = myName();
  return attentionEligibleClients().filter(c => canApprove() || clientOwner(c) === me || (c.improvements || []).some(i => i.author === me));
}
function weekRowHtml(w, sel){
  const h = clientHealth(w.c);
  const ud = h.level === 'g' ? '' : `<span class="ud" style="background:var(--${h.level === 'r' ? 'red' : 'yellow-fill'})" aria-label="${healthWord(h.level)}"></span>`;
  const who = w.sent ? w.owner : (w.holder || w.owner);
  return `<a class="wk${sel ? ' sel' : ''}" href="#approve" data-id="${w.c.id}" onclick="selectWeekClient('${w.c.id}');return false;"${sel ? ' aria-current="true"' : ''}>${ud}${monoHtml(w.c)}
<div class="tx"><b>${escapeHtml(w.c.name)}</b><span class="tags">${w.upcoming ? nextDueTag(w) : dueTag(w)}${w.sent && !w.upcoming ? '' : stageTag(w)}</span></div><div class="r">${stepsHtml(w)}${who ? avHtml(who) : ''}</div></a>`;
}
function selectWeekClient(id){ window._weekSel = id; renderThisWeek(); }

function renderThisWeek(){
  const root = document.getElementById('weekRoot');
  if(!root || typeof clients === 'undefined') return;
  const cyc = updateCycle(), me = myName();
  const all = weekVisibleClients().map(c => weekView(clientWeek(c)));
  const mine = all.filter(w => w.owner === me || w.holder === me);
  const shown = weekFilter === 'behind' ? all.filter(needsUpdate) : weekFilter === 'mine' ? mine : all;
  const soon = w => w.upcoming;
  const groups = [['Overdue', shown.filter(w => w.state === 'late').sort(dueOrder)],
    ['Due today', shown.filter(w => w.state === 'due').sort(dueOrder)],
    ['Due soon', shown.filter(soon).sort((a, b) => a.daysLeft - b.daysLeft || (b.c.importance || 0) - (a.c.importance || 0))],
    ['Sent this week', shown.filter(w => w.sent).sort((a, b) => new Date(b.last || 0) - new Date(a.last || 0))]];
  const flat = groups.flatMap(g => g[1]);
  let sel = flat.find(w => w.c.id === window._weekSel) || flat[0];
  if(sel) window._weekSel = sel.c.id;
  const seg = [['all', 'All', all.length], ['behind', 'Due', all.filter(needsUpdate).length], ['mine', 'Mine', mine.length]]
    .map(([k, t, n]) => `<button class="${weekFilter === k ? 'on' : ''}" role="tab" aria-selected="${weekFilter === k}" onclick="setWeekFilter('${k}')">${t} <span class="c">${n}</span></button>`).join('');
  const list = groups.filter(g => g[1].length).map(([g, ws]) => `<div class="lgh">${g}<span class="c">${ws.length}</span></div>` + ws.map(w => weekRowHtml(w, w === sel)).join('')).join('')
    || `<div class="empty"><b>Nothing here</b>${weekFilter === 'mine' ? 'None of your clients have an update this week.' : 'No clients yet.'}</div>`;
  root.innerHTML = `<section class="list" aria-label="Clients this week" style="flex-basis:380px">
<div class="list-h"><div class="seg" role="tablist" aria-label="Show">${seg}</div><button class="ib" aria-label="Sort" title="Sorted by what needs doing first" style="margin-left:auto">${icon('sort-ascending')}</button></div>
<div style="padding-bottom:12px">${list}</div></section>
<section class="detail" aria-label="Selected client this week" style="padding-top:22px">${sel ? weekDetailHtml(sel, cyc) : ''}</section>`;
  const sum = weekSummary(weekVisibleClients());
  if(currentViewName === 'approve') setToolbar(null, `${sum.sent} of ${sum.total} sent in the last 7 days${sum.late ? ` · ${sum.late} overdue` : ''}`);
}
// Keep the old name working: everything that redraws "the queue" redraws This Week now.
function renderQueue(){ renderThisWeek(); }

function weekDetailHtml(w, cyc){
  const c = w.c, h = clientHealth(c), me = myName();
  const d = w.draft;
  const author = d ? d.author : (w.logged.find(i => i.author === me) ? me : (w.logged[0]?.author || w.owner || me));
  const holder = w.holder && w.holder !== 'approvers' ? w.holder : w.owner;
  // What needs doing, and the one main button for it.
  let callout = '', primary = '', secondary = '';
  const remind = holder && holder !== me ? `<button class="btn" onclick="remindHolder('${c.id}')">Remind ${escapeHtml(firstName(holder))}</button>` : '';
  if(w.sent){ primary = ''; }
  else if(w.done === 0){ primary = `<button class="btn btn-p" onclick="openQueueLogImprovementModal('${c.id}')">${icon('plus')}Log Improvement</button>`; secondary = remind; }
  else if(!d){ primary = `<button class="btn btn-p" onclick="generateDraft('${c.id}',${jsArg(author)})">${icon('sparkle')}Write Draft</button>`; secondary = remind; }
  else if(d.draftStatus === 'pending' && !d.readyToNotify){
    if(d.author === me) primary = canApprove() ? `<button class="btn btn-p" onclick="openReviewDraft('${c.id}',${jsArg(d.author)})">${icon('envelope-open')}Open Draft</button>` : `<button class="btn btn-p" onclick="sendDraftForReview('${c.id}',${jsArg(d.author)})">${icon('paper-plane-tilt')}Send for Review</button>`;
    else { primary = `<button class="btn btn-p" onclick="openReviewDraft('${c.id}',${jsArg(d.author)})">${icon('envelope-open')}Open Draft</button>`; secondary = holder && holder !== me ? `<button class="btn" onclick="remindHolder('${c.id}')">Remind ${escapeHtml(firstName(holder))}</button>` : ''; }
  }
  else if(d.draftStatus === 'pending') primary = canApprove() ? `<button class="btn btn-p" onclick="openReviewDraft('${c.id}',${jsArg(d.author)})">${icon('envelope-open')}Open in Review</button>` : '';
  else if(d.draftStatus === 'approved') primary = canApprove() ? `<button class="btn btn-p" onclick="sendApprovedDraft('${c.id}',${jsArg(d.author)})">${icon('paper-plane-tilt')}Send Now</button>` : '';
  const lastTxt = w.last ? 'Last sent ' + fmtShortDate(w.last) : 'No update sent yet';
  if(w.upcoming){
    callout = `<div class="next" style="margin-top:18px"><span class="sig">${icon('clock-countdown')}</span><div class="tx"><b>Next update ${escapeHtml(w.dueText.replace(/^Due /, 'due '))}</b><span>${escapeHtml(lastTxt)}</span></div>${secondary}${primary}</div>`;
  } else if(!w.sent){
    const why = w.done === 0 ? 'Nothing logged yet'
      : !d ? 'Work logged, no draft yet'
      : d.draftStatus === 'pending' && !d.readyToNotify ? `Draft written, ${escapeHtml(firstName(d.author))} hasn’t sent it for review`
      : d.draftStatus === 'pending' ? 'Waiting in Review' : 'Approved, ready to send';
    const head = w.late ? `Overdue by ${-w.daysLeft} day${w.daysLeft === -1 ? '' : 's'}` : 'Due today';
    callout = `<div class="next" style="margin-top:18px"><span class="sig ${w.late ? 'r' : 'y'}">${icon('clock-countdown')}</span>
<div class="tx"><b>${escapeHtml(head)}</b><span>${why} · ${escapeHtml(lastTxt)}</span></div>${secondary}${primary}</div>`;
  } else if(primary || secondary){
    callout = `<div class="next" style="margin-top:18px"><span class="sig">${icon('check')}</span><div class="tx"><b>Sent ${escapeHtml(relDayLower(w.last))}</b><span>Next one ${escapeHtml(w.dueText.replace(/^Due /, 'due '))}</span></div>${secondary}${primary}</div>`;
  }
  const stepTxt = [
    w.sent ? 'Logged' : w.done > 0 ? `${w.logged.length} improvement${w.logged.length === 1 ? '' : 's'} since the last update` : 'Nothing yet',
    w.sent || w.done > 1 ? 'Sent for review' : d && d.draftStatus === 'pending' ? 'Waiting on ' + firstName(d.author) : 'Draft not written',
    w.sent || w.done > 2 ? 'Approved' : 'By an approver',
    w.sent ? `Sent ${relDayLower(w.last)}` : `${w.dueText}, by an approver`];
  const stepper = STEP_NAMES.map((n, k) => {
    const cls = w.sent ? 's d' : k < w.done ? 'd' : (w.behind === k ? 'b' + (w.late ? ' r' : '') : '');
    const mark = (w.sent || k < w.done) ? icon('check', { weight: 'bold' }) : (w.behind === k ? icon('exclamation-mark', { weight: 'bold' }) : '');
    return `<div class="stp ${cls}"><span class="m">${mark}</span><b>${n}</b><span>${escapeHtml(stepTxt[k])}</span></div>`;
  }).join('');
  const imps = w.logged.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
  const impRows = imps.map(i => `<div class="row sm"><div class="tx"><span class="t" style="font-weight:400">${escapeHtml(i.text)}</span><span class="s">${escapeHtml(i.service || c.service || '')} · ${fmtShortDate(new Date(i.date))}</span></div>
<div class="r">${i.includeInEmail === false ? `<span class="st">${icon('lock-simple')}Internal, not in the email</span>` : ''}${typeof impFilesBtn === 'function' ? impFilesBtn({ ...i, clientId: c.id }) : ''}${avHtml(i.author)}</div></div>`).join('');
  const seq = weekHistory(c), ots = onTimeSummary(seq);
  const preview = d && d.draft ? `<div class="h2"><h2>The draft</h2><span class="t-2" style="font-size:13px">${d.author ? 'By ' + escapeHtml(d.author) : ''}${d.draftPendingSince ? ' · ' + relDay(d.draftPendingSince).toLowerCase() + ' ' + fmtTime(new Date(d.draftPendingSince)) : ''}</span></div>
<div class="preview"><b>Your weekly update — ${escapeHtml(updateRangeLabel(c))}</b><br>${escapeHtml(d.draft.replace(/\s+/g, ' ').slice(0, 260))}${d.draft.length > 260 ? '…' : ''}</div>` : '';
  return `<div style="max-width:760px">
<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">${monoHtml(c, 'lg')}
<div style="min-width:0;margin-right:auto"><div style="font-size:18px;font-weight:600;letter-spacing:-.01em">${escapeHtml(c.name)}</div>
<div class="t-2" style="font-size:13px;margin-top:2px">${w.owner ? escapeHtml(w.owner) + ' owns it · ' : ''}${escapeHtml(c.service || '')} · importance ${c.importance || 0} of 10</div></div>
${h.level !== 'g' ? `<a href="#health" onclick="openHealthClient('${c.id}');return false;" style="text-decoration:none">${hstateHtml(h.level)}</a>` : ''}</div>
${callout}
<div class="stepper" style="margin-top:22px">${stepper}</div>
${preview}
<div class="h2"><h2>Logged for this update<span class="c">${imps.length}</span></h2><a href="#" onclick="openQueueLogImprovementModal('${c.id}');return false;">Log Improvement</a></div>
<div class="grp">${impRows || '<div class="row sm"><span class="s t-2" style="font-size:13px">Nothing logged since the last update.</span></div>'}</div>
<div class="h2"><h2>Last 8 updates</h2><span class="t-2" style="font-size:13px">${ots.total ? `On time ${ots.onTime} of the last ${ots.total}` : 'History starts with the first update sent'}</span></div>
${weekStripHtml(c)}
</div>`;
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
