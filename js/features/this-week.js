// This Week (canvas "This Week — a long week", approved): the work grouped by what you do
// (Review drafts, Send approved updates, Write drafts, Log this week's work…), late first, a few
// rows each with the rest one click away, and one button per group that works through all of it.
// What other people owe is one row per person on the right, with the week's progress and what went
// out. Clicking a client opens its update in the panel on the right. Members see their own
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

// The groups, in the order they're shown. Each has its rows' words and, where one exists, a
// button that works through the whole group.
const WEEK_GROUPS = [
  { k: 'review', title: () => 'Review wins', ic: 'tray', tone: 'blue', batch: n => [`startReviewQueue()`, 'Start Review', 'tray'] },
  { k: 'send', title: mine => mine ? 'Send your approved wins' : 'Send approved wins', ic: 'paper-plane-tilt', tone: 'green', batch: (n, items) => {
      const w0 = items.find(w => winViaWhatsapp(w.c) && !w.todo.copied), all = items.every(w => winViaWhatsapp(w.c));
      if(w0) return [`copyWinForWhatsapp('${w0.c.id}',${jsArg(w0.draft.author)},false,this)`, 'Copy for WhatsApp', 'copy'];
      if(all){ const w1 = items[0]; return [`markWinSent('${w1.c.id}',${jsArg(w1.draft.author)})`, 'Mark as Sent', 'check']; }
      return [`openApprovedInReview()`, 'Send in Review', ''];
    } },
  { k: 'forreview', title: () => 'Send your wins for review', ic: 'paper-plane-tilt', tone: 'blue', batch: n => [`sendAllForReview()`, n > 1 ? `Send All ${n} for Review` : 'Send for Review', ''] },
  { k: 'latedraft', title: () => 'Late wins not sent for review', ic: 'warning', tone: 'red', batch: null },
  { k: 'write', title: mine => mine ? 'Write your wins' : 'Write wins', ic: 'sparkle', tone: 'purple', batch: n => [`openGroupAndSendModal()`, n > 1 ? (n === 2 ? 'Write Both' : `Write All ${n}`) : 'Write Draft', 'sparkle'] },
  { k: 'log', title: () => 'Log this week’s work', ic: 'square-pen', tone: 'yellow', batch: n => [`openQueueLogImprovementModal()`, 'Log Work', 'square-pen'] },
];
function setWeekFind(v){
  window._weekFind = v; renderThisWeek();
  const el = document.getElementById('weekFind'); if(el){ el.focus(); el.setSelectionRange(v.length, v.length); }
}
function toggleWeekGroup(k){ window._weekOpen = Object.assign({}, window._weekOpen, { [k]: !(window._weekOpen || {})[k] }); renderThisWeek(); }
function startReviewQueue(){ if(typeof reviewTab !== 'undefined') reviewTab = 'waiting'; window._reviewSel = null; switchView('teamqueue'); }
function openApprovedInReview(){ if(typeof reviewTab !== 'undefined') reviewTab = 'approved'; window._reviewSel = null; switchView('teamqueue'); }
// Every draft of yours that's written but not sent for review, sent in one go (one note to approvers).
async function sendAllForReview(){
  const me = myName(), list = weekVisibleClients().map(c => weekView(clientWeek(c))).filter(w => !w.sent && weekTodo(w).k === 'forreview' && !draftHasNoWork(w.c, w.draft));
  if(!list.length) return;
  let ok = 0;
  for(const w of list) if(await saveDraftFor(w.c.id, w.draft.author, { readyToNotify: true })) ok++;
  if(!ok){ showToast('error', 'Couldn’t send for review', 'Try again in a moment.'); return; }
  const names = list.map(w => shortClientName(w.c.name));
  const approvers = teamProfiles.filter(p => (p.role === 'admin' || p.role === 'approver') && p.id !== currentUser?.id);
  for(const a of approvers) await sendNotification(a.id, 'draft_ready', `${ok} draft${ok === 1 ? '' : 's'} ready for review`, `${me}: ${joinNames(names)}.`, 'teamqueue', list[0].c.id);
  showToast('success', `Sent ${ok} draft${ok === 1 ? '' : 's'} for review`, joinNames(names));
  renderAll();
}
// "2 days late", "3 weeks late"; how long a draft has waited, in words.
function lateWords(w){
  if(!w.last && w.late) return 'No update yet';
  const d = -w.daysLeft;
  return d <= 0 ? w.dueText : d === 1 ? '1 day late' : d < 14 ? `${d} days late` : d < 60 ? `${Math.floor(d / 7)} weeks late` : 'Months late';
}
function waitWords(since){
  if(!since) return '';
  const m = Math.max(0, Math.round((rNow() - new Date(since)) / 60000));
  return m < 60 ? `waiting ${Math.max(1, m)} min` : m < 1440 ? `waiting ${Math.round(m / 60)} hour${Math.round(m / 60) === 1 ? '' : 's'}` : `waiting ${Math.round(m / 1440)} day${Math.round(m / 1440) === 1 ? '' : 's'}`;
}
// The second part of a row: who it's with and where it stands.
function weekRowWho(w){
  const d = w.draft, k = w.todo.k, me = myName();
  if(k === 'review') return `${d.author === me ? 'You' : firstName(d.author)} · ${waitWords(d.draftPendingSince)}`;
  if(k === 'send' && winViaWhatsapp(w.c)){
    if(w.todo.copied) return `Copied ${fmtTime(new Date(d.waCopiedAt))} · not in the group yet`;
    const by = d.approvedBy ? ` · by ${d.approvedBy === me ? 'you' : firstName(d.approvedBy)}${d.approvedAt ? ' ' + weekAgo(d.approvedAt) : ''}` : '';
    return `Approved${by}`;
  }
  if(k === 'send') return `${d.author === me ? 'Your' : firstName(d.author) + '’s'} win, approved`;
  if(k === 'forreview') return `Your draft · ${todayPlural(w.logged.length, 'improvement')}`;
  if(k === 'latedraft') return `${firstName(d.author)} hasn’t sent it for review`;
  if(w.todo.empty) return 'Draft’s work was deleted';
  if(k === 'write') return `${todayPlural(w.logged.length, 'improvement')} logged`;
  if(k === 'log'){ const t = (w.c.improvements || []).map(i => new Date(i.date)).filter(x => x <= rNow()).sort((a, b) => b - a)[0]; return t ? `nothing since ${fmtShortDate(t)}` : 'nothing logged yet'; }
  return w.todo.what;
}

// "20 min ago" · "3 hours ago" · "yesterday"
function weekAgo(at){
  const m = Math.max(0, Math.round((rNow() - new Date(at)) / 60000));
  return m < 60 ? `${Math.max(1, m)} min ago` : m < 1440 ? `${Math.round(m / 60)} hour${Math.round(m / 60) === 1 ? '' : 's'} ago` : relDayLower(new Date(at));
}
function renderThisWeek(){
  const root = document.getElementById('weekRoot');
  if(!root || typeof clients === 'undefined') return;
  const me = myName(), everyone = seesEveryone();
  const all = weekVisibleClients().map(c => weekView(clientWeek(c)));
  const mine = all.filter(w => w.owner === me || w.holder === me);
  if(weekFilter === 'mine' && !everyone) weekFilter = 'all';
  const base = weekFilter === 'mine' || !everyone ? mine : all;
  const find = String(window._weekFind || '').trim().toLowerCase();
  const pass = w => (!find || w.c.name.toLowerCase().includes(find)) && (weekFilter !== 'late' || w.late);
  const open = base.filter(w => !w.sent).map(w => Object.assign(w, { todo: weekTodo(w) }))
    .sort((a, b) => (b.late - a.late) || a.daysLeft - b.daysLeft || (b.c.importance || 0) - (a.c.importance || 0));
  const nowAll = open.filter(w => w.todo.b === 'now'), waitAll = open.filter(w => w.todo.b === 'wait');
  const now = nowAll.filter(pass), wait = waitAll.filter(pass);
  const sent = base.filter(w => w.sent && (!find || w.c.name.toLowerCase().includes(find))).sort((a, b) => new Date(b.last || 0) - new Date(a.last || 0));
  const sel = window._weekSel ? all.find(w => w.c.id === window._weekSel) : null;
  const lateN = open.filter(w => w.late).length;

  // ---- Do now, grouped by what you do --------------------------------------------------------
  const row = w => `<div class="twl-r wn-r${sel && sel.c.id === w.c.id ? ' is-sel' : ''}" role="button" tabindex="0" onclick="selectWeekClient('${w.c.id}')" onkeydown="if(event.key==='Enter')selectWeekClient('${w.c.id}')">${monoHtml(w.c, 'sm')}<b>${escapeHtml(w.c.name)}</b><span class="twl-who">${escapeHtml(weekRowWho(w))}</span><span class="wn-rt">${w.draft && w.done >= 2 ? tierTag(winTier(w.draft)) : ''}</span>${chGlyph(w.c)}<span class="twl-due${w.late ? ' is-late' : ''}">${escapeHtml(w.late ? lateWords(w) : w.dueText)}</span></div>`;
  let primaryUsed = false;
  const groups = WEEK_GROUPS.map(g => {
    const items = now.filter(w => w.todo.k === g.k);
    if(!items.length) return '';
    const late = items.filter(w => w.late).length, rest = items.length - late;
    const dues = [...new Set(items.filter(w => !w.late).map(w => w.dueText))];
    const how = g.k !== 'send' ? '' : items.some(w => winViaWhatsapp(w.c) && !w.todo.copied) ? 'copy it, paste it in the group'
      : items.some(w => w.todo.copied) ? 'paste it in the group, then mark it sent'
      : everyone && waitAll.some(w => w.todo.k === 'w-send' || w.todo.k === 'w-copied') ? 'WhatsApp wins go back to whoever wrote them' : '';
    const sub = [late ? `<span class="t-red">${late} late</span>` : '', rest ? `${rest} ${escapeHtml(dues[0].replace(/^Due /, 'due '))}${dues.length > 1 ? ' or later' : ''}` : '', how].filter(Boolean).join(' · ');
    const openAll = !!(window._weekOpen || {})[g.k], showN = items.length <= 3 || openAll ? items.length : Math.max(2, Math.min(3, late));
    const b = g.batch ? g.batch(items.length, items) : null, prim = b && !primaryUsed; if(prim) primaryUsed = true;
    const more = items.length > showN ? `<a class="twl-more" href="#" data-grow="wk-${g.k}" onclick="toggleWeekGroup('${g.k}');return false;">${items.length - showN} more${icon('caret-down', { weight: 'bold' })}</a>`
      : openAll && items.length > 3 ? `<a class="twl-more" href="#" data-grow="wk-${g.k}" onclick="toggleWeekGroup('${g.k}');return false;">Show less${icon('chevron-up', { weight: 'bold' })}</a>` : '';
    return `<section class="twl-g" aria-label="${escapeHtml(g.title(!everyone))}" data-grow-key="wk-${g.k}">
<div class="twl-gh"><span class="twl-ic ${g.tone}">${icon(g.ic)}</span><div class="twl-gt"><b>${escapeHtml(g.title(!everyone))} <span class="n">${items.length}</span></b><span>${sub}</span></div>${b ? `<button class="btn${prim ? ' btn-p' : ''}" onclick="${b[0]}">${b[2] ? icon(b[2]) : ''}${escapeHtml(b[1])}</button>` : ''}</div>
${items.slice(0, showN).map(row).join('')}${more}</section>`;
  }).join('');
  const clear = !open.length && !sent.length && !find ? (!activeClients().length
      ? emptyNoClients('This Week lists the update each client is due, who’s writing it and what went out.')
      : emptyState({ icon: 'calendar-blank', title: 'None of your clients have an update this week', text: 'Updates for the clients you own show here when they’re due.',
          action: everyone ? 'Show All Clients' : '', onAction: "setWeekFilter('all')" }))
    : !nowAll.length ? `<div class="tw-clear">${icon('check-circle')}<b>Nothing waiting on you</b><span>${waitAll.length ? 'The rest is with your team, on the right.' : 'Every update is out until the next ones are due.'}</span></div>`
    : !now.length ? `<div class="twl-none">${weekFilter === 'late' ? 'Nothing late waiting on you.' : 'No client matches.'}</div>` : '';

  // ---- the right side: progress, who owes what, what went out ---------------------------------
  const sum = weekSummary(base.map(w => w.c)), tot = Math.max(1, sum.total);
  const pct = n => (n / tot * 100).toFixed(1) + '%';
  const byPerson = {};
  wait.forEach(w => {
    const key = w.todo.holder || (w.todo.k === 'w-approver' || w.holder === 'approvers' ? 'Approvers' : (w.holder || w.owner || 'Someone'));
    (byPerson[key] = byPerson[key] || []).push(w);
  });
  const KIND = { 'w-log': ['with nothing logged', 'with nothing logged'], 'w-write': ['with work logged, no draft yet', 'with work logged, no draft yet'], 'w-draft': ['draft not sent for review', 'drafts not sent for review'],
    'w-review': ['waiting on review', 'waiting on review'], 'w-approver': ['approved, waiting to be sent', 'approved, waiting to be sent'],
    'w-send': ['approved win to send', 'approved wins to send'], 'w-copied': ['copied, not in the group yet', 'copied, not in the group yet'] };
  const people = Object.entries(byPerson).sort((a, b) => b[1].length - a[1].length).map(([name, ws]) => {
    const counts = {}; ws.forEach(w => { counts[w.todo.k] = (counts[w.todo.k] || 0) + 1; });
    const what = Object.entries(counts).map(([k, n]) => `${n} ${(KIND[k] || ['', ''])[n === 1 ? 0 : 1]}`).join(', ');
    const late = ws.filter(w => w.late).length;
    const canRemind = name !== 'Approvers' && name !== me && profileByName(name);
    return `<div class="twl-p"><div class="twl-ph"><b>${escapeHtml(name === 'Approvers' ? 'An approver' : name)}</b><span class="n">${ws.length}</span>${canRemind ? `<button class="btn" onclick="remindHolders(${escapeHtml(JSON.stringify(ws.map(w => w.c.id)))})">Remind ${escapeHtml(firstName(name))}</button>` : ''}</div>
<span class="twl-pw">${escapeHtml(what)}${late ? ` · <span class="t-red">${late} late</span>` : ''}</span>
<span class="twl-pc">${ws.slice(0, 4).map(w => `<a href="#" onclick="selectWeekClient('${w.c.id}');return false;">${escapeHtml(shortClientName(w.c.name))}</a>`).join(', ')}${ws.length > 4 ? ` and ${ws.length - 4} more` : ''}</span></div>`;
  }).join('');
  const names = sent.map(w => shortClientName(w.c.name)), doneOpen = !!window._weekShowDone;
  const done = sent.length ? (doneOpen
      ? `<div class="twl-dl">${sent.map(w => `<div class="twl-dr" role="button" tabindex="0" onclick="selectWeekClient('${w.c.id}')">${monoHtml(w.c, 'sm')}<span>${escapeHtml(w.c.name)}</span><span class="twl-dw">${escapeHtml(relDay(w.last))}</span></div>`).join('')}</div>`
      : `<div class="twl-done">${icon('check-circle')}<span class="tw-stack">${sent.slice(0, 8).map(w => monoHtml(w.c, 'sm')).join('')}</span></div><p class="twl-dn">${escapeHtml(names.length > 3 ? names.slice(0, 3).join(', ') + ` and ${names.length - 3} more` : joinNames(names))}</p>`)
    : '<p class="twl-dn">Nothing sent yet this week.</p>';
  // the week's wins: how many clients got theirs, the tiers, and each win day
  const st = winsWeekStats(base.map(w => clientWeek(w.c)));
  const sideRow = (w, right) => `<div class="wn-sr" role="button" tabindex="0" onclick="selectWeekClient('${w.c.id}')" onkeydown="if(event.key==='Enter')selectWeekClient('${w.c.id}')">${monoHtml(w.c, 'sm')}<b>${escapeHtml(w.c.name)}</b>${tierTag(winTier(w.draft))}<span>${escapeHtml(right)}</span></div>`;
  const APPROVER_K = ['w-review', 'w-approver'];
  const withApprover = everyone ? [] : wait.filter(w => APPROVER_K.includes(w.todo.k) || (w.todo.holder && profileByName(w.todo.holder) && ['admin', 'approver'].includes(profileByName(w.todo.holder).role)));
  const others = everyone ? people : Object.entries(byPerson).filter(([, ws]) => ws.some(w => !withApprover.includes(w))).length ? people : '';
  const approverWords = w => w.todo.k === 'w-review' ? 'In review' : w.todo.k === 'w-approver' ? 'Approved' : w.todo.k === 'w-copied' ? `${firstName(w.todo.holder)} is sending it` : 'Approved';
  const memberSide = everyone ? '' : `${withApprover.length ? `<div class="twl-ss"><b>With an approver</b><span class="n">${withApprover.length}</span></div>
${withApprover.map(w => sideRow(w, approverWords(w))).join('')}<p class="wn-dn">An approver checks these. Email wins go out when they’re approved; WhatsApp wins come back to you to send.</p>` : ''}
${others ? `<div class="twl-ss"><b>Waiting on someone</b></div>${others}` : ''}
<div class="twl-ss"><b>Done this week</b><span class="n">${sent.length}</span></div>
${sent.length ? sent.map(w => sideRow(clientWeek(w.c), fmtDay(new Date(w.last)))).join('') : '<p class="twl-dn">Nothing sent yet this week.</p>'}`;
  const approverSide = !everyone ? '' : `<div class="twl-ss"><b>Waiting on someone</b><span class="n">${wait.length}</span></div>
${people || '<p class="twl-dn">Nothing is waiting on anyone else.</p>'}
<div class="twl-ss"><b>Done this week</b><span class="n">${sent.length}</span>${sent.length ? `<a class="x-lnk" href="#" data-grow="wk-done" onclick="window._weekShowDone=${doneOpen ? 'false' : 'true'};renderThisWeek();return false;">${doneOpen ? 'Hide' : 'Show'}</a>` : ''}</div>
<div data-grow-key="wk-done">${done}</div>`;
  const seg = [['all', 'All', base.length], ['late', 'Late', lateN]].concat(everyone ? [['mine', 'Mine', mine.length]] : [])
    .map(([k, t, n]) => `<button class="${weekFilter === k ? 'on' : ''}" role="tab" aria-selected="${weekFilter === k}" onclick="setWeekFilter('${k}')">${t} <span class="c">${n}</span></button>`).join('');
  root.innerHTML = `<div class="spw"><div class="sp-page"><div class="twl">
<div class="twl-main">
<div class="twl-top"><div class="seg" role="tablist" aria-label="Show">${seg}</div><label class="twl-find">${icon('magnifying-glass')}<input id="weekFind" type="search" placeholder="Find a client" aria-label="Find a client" value="${escapeHtml(window._weekFind || '')}" oninput="setWeekFind(this.value)"></label></div>
${now.length ? `<div class="twl-h"><b>Do now</b><span class="n">${now.length}</span><span class="s">${everyone ? 'Grouped by what you do, late first' : 'Your clients, late first'}</span></div>` : ''}
${groups}${clear}
</div>
<aside class="twl-side" aria-label="This week’s wins">
<div class="twl-big"><b>${st.got}</b><span>of ${everyone ? st.total : `your ${st.total} clients`} got their win this week</span></div>
${winsTierBarHtml(st)}
${winsDaysHtml(st, !everyone)}
${everyone ? approverSide : memberSide}
</aside>
</div></div>${sel ? weekPanelHtml(sel) : ''}</div>`;
  if(currentViewName === 'approve') setToolbar('This Week', everyone ? 'Every client gets a win, on their day' : `Your ${base.length} client${base.length === 1 ? '' : 's'} · each gets a win on their day`);
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
  if(dl.gone) return `<p class="sp-dnote is-red">${icon('warning')}<span>${dl.allGone ? 'Everything this draft was written from was deleted.' : `${dl.gone} improvement${dl.gone === 1 ? '' : 's'} in the draft ${dl.gone === 1 ? 'was' : 'were'} deleted; the email may still mention ${dl.gone === 1 ? 'it' : 'them'}.`}${may ? ` <a class="x-lnk" href="#" onclick="generateDraft(${A});return false;">Rewrite</a>` : ''}</span></p>`;
  if(dl.added.length) return `<p class="sp-dnote">${icon('circle-plus')}<span>${dl.added.length === 1 ? '1 improvement was' : `${dl.added.length} improvements were`} logged after this draft.${may ? ` <a class="x-lnk" href="#" onclick="generateDraft(${A});return false;">Rewrite to include ${dl.added.length === 1 ? 'it' : 'them'}</a>` : d.draftStatus === 'approved' ? ` ${dl.added.length === 1 ? 'It goes' : 'They go'} in the next update.` : ' An approver can rewrite to include them.'}</span></p>`;
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
    eyebrow = w.late ? `<span class="sp-eb red">${icon('warning', { weight: 'bold' })}${escapeHtml(overdueShort(w))}</span>` : `<span class="sp-eb">${icon('clock', { weight: 'bold' })}${escapeHtml(w.dueText)}</span>`;
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
