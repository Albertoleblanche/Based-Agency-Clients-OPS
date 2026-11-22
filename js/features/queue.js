// Queue: your own logged work, client by client, laid out like Review. The list is every client
// you've logged something for since its last update (or whose draft of yours isn't sent yet);
// the right side is that work, where you switch each item between the email and internal, edit
// or delete it, log more, and write, edit or send the draft. Only work marked for the email goes
// in a draft, so Write Draft is there only once something is.

// The tab's icon: Lucide's inbox (the "inbox" name already draws Review's eye).
if(typeof ICON_PATHS !== 'undefined' && !ICON_PATHS.queue) ICON_PATHS.queue = '<path d="M22 12h-6l-2 3h-4l-2-3H2" /> <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />';

// For a member, Review only ever held their own drafts, so it lives here instead: the Queue gets
// a Sent tab, approved WhatsApp wins are copied and marked sent here, and anything that opened a
// draft in Review opens it in the Queue. Approvers (and anyone who sees everyone's drafts) keep both.
function queueHasReview(){ return typeof currentUser !== 'undefined' && !!currentUser && typeof hasPermission === 'function' && !hasPermission('view_team_queue'); }
function queueTabs(){ return queueHasReview() ? ['todo', 'review', 'sent'] : ['todo', 'review']; }

let queueTab = 'todo';
function setQueueTab(t){ queueTab = t; window._queueSel = null; quResetEdits(); renderMyQueue(); }
function quResetEdits(){ window._quEditImp = null; window._quDraftEdit = null; }

// One client in your queue: what you logged, what of it goes in the email, your draft and its step.
// A client's lines in your Queue. Usually one: the work you've logged since its last update, with
// your draft. Once that draft is sent for review (or approved) it's locked, in the In review tab
// with exactly the work it was written from; anything you log for the client after that is a
// second line, the Next update, in To do, where you can edit it and add to it. It becomes the
// update after this one is sent (or joins this one again if it comes back to you).
function quEntries(c, me){
  const w = clientWeek(c), d = getDraftFor(c, me);
  const mine = w.logged.filter(i => i.author === me).sort((a, b) => new Date(b.date) - new Date(a.date));
  const emailOf = list => list.filter(i => i.includeInEmail !== false);
  // a draft written only from work since deleted isn't shown: write a new one from what's logged now
  const live = !!d.draft && !d.draftSentAt && (d.draftStatus === 'pending' || d.draftStatus === 'approved') && !draftHasNoWork(c, d);
  const locked = live && (d.draftStatus === 'approved' || d.readyToNotify);
  if(locked){
    const ids = d.draftImprovementIds || [], since = d.draftPendingSince ? new Date(d.draftPendingSince) : null;
    const inIt = i => ids.length ? ids.includes(i.id) : !since || new Date(i.date) <= since;
    const sent = mine.filter(inIt), after = mine.filter(i => !inIt(i)), out = [];
    out.push({ c, w, d, mine: sent, email: emailOf(sent), st: d.draftStatus === 'approved' ? 'approved' : 'review', tab: 'review' });
    if(after.length) out.push({ c, w, d: null, held: d, mine: after, email: emailOf(after), st: 'next', tab: 'todo' });
    return out;
  }
  // nothing of yours logged for this update: nothing to send, so it isn't in your queue (a draft
  // whose work was all deleted waits out of sight, and comes back with the work if it's restored)
  if(!mine.length) return [];
  const email = emailOf(mine);
  const st = live ? (draftHasNoWork(c, d) ? 'empty' : 'written') : email.length ? 'write' : 'internal';
  return [{ c, w, d: live ? d : null, mine, email, st, tab: 'todo' }];
}
function quEntry(c, me){ return quEntries(c, me)[0] || null; }
function queueItems(){
  const me = myName(), out = { todo: [], review: [], sent: [] };
  if(typeof clients === 'undefined' || !me) return out;
  attentionEligibleClients().forEach(c => quEntries(c, me).forEach(x => out[x.tab].push(x)));
  // Sent this week (members, where Review's Sent tab used to be): newest first
  if(queueHasReview()){
    const from = updateCycle().weekStart;
    attentionEligibleClients().forEach(c => { const d = getDraftFor(c, me);
      if(d.draftSentAt && new Date(d.draftSentAt) >= from) out.sent.push({ c, w: clientWeek(c), d, mine: [], email: [], st: 'sent', tab: 'sent' }); });
    out.sent.sort((a, b) => new Date(b.d.draftSentAt) - new Date(a.d.draftSentAt));
  }
  // Next updates wait behind everything you can act on now
  const rank = { empty: 0, written: 1, write: 2, internal: 3, next: 4, review: 5, approved: 6 };
  const order = (a, b) => (a.st === 'next') - (b.st === 'next') || a.w.daysLeft - b.w.daysLeft || rank[a.st] - rank[b.st] || (b.c.importance || 0) - (a.c.importance || 0) || a.c.name.localeCompare(b.c.name);
  out.todo.sort(order); out.review.sort(order);
  return out;
}
// What's on you: a draft to write, send or rewrite, and an approved WhatsApp win of yours to send.
function quWaToSend(x){
  if(x.st !== 'approved' || typeof winViaWhatsapp !== 'function' || !winViaWhatsapp(x.c)) return false;
  const st = winSendState(x.d); return st.k !== 'copied' || st.by === myName();
}
function queueBadgeCount(items){ items = items || queueItems(); return items.todo.filter(x => x.st !== 'internal' && x.st !== 'next').length + items.review.filter(quWaToSend).length; }
// Each step: its words in the rail, and the short tag on its row in the list.
const QU_STATE = {
  write: ['Ready to write', 'is-go', 'Write'], written: ['Draft written', '', 'Draft'], empty: ['Work deleted', 'is-red', 'Rewrite'],
  internal: ['Only internal', 'is-out', 'Internal'], review: ['In review', '', 'In review'], approved: ['Approved', '', 'Approved'],
  next: ['Next update', 'is-out', 'Next'],
  send: ['Approved, yours to send', 'is-go', 'Send'], sent: ['Sent', 'is-out', 'Sent'],
};
// An approved WhatsApp win you still have to send reads as Send.
function quStateOf(x){ return quWaToSend(x) ? 'send' : x.st; }
// "4d overdue", "Due today", "Sent · next Fri": short enough for a row.
function quDueShort(w){
  if(w.sent) return `Sent · next ${w.due ? DAY_NAMES[w.due.getDay()].slice(0, 3) : 'week'}`;
  return w.late ? overdueShort(w) : w.dueText;
}

function renderMyQueue(){
  const items = queueItems();
  const badge = document.getElementById('navQueueBadge');
  if(badge){ const n = queueBadgeCount(items); badge.textContent = n; badge.style.display = n ? '' : 'none'; }
  const root = document.getElementById('queueRoot');
  if(!root) return;
  const tabsOn = queueTabs();
  if(!tabsOn.includes(queueTab)) queueTab = 'todo';
  let list = items[queueTab];
  const want = window._queueSel;
  let sel = list.find(x => x.c.id === want);
  if(!sel && want){ const other = tabsOn.find(t => t !== queueTab && items[t].some(x => x.c.id === want)); if(other){ queueTab = other; list = items[other]; sel = list.find(x => x.c.id === want); } }
  sel = sel || list[0] || null;
  if(!sel) quResetEdits();
  else if(window._queueSel !== sel.c.id){ quResetEdits(); window._queueSel = sel.c.id; }
  const TAB_WORDS = { todo: 'To do', review: 'In review', sent: 'Sent' };
  const tabs = tabsOn.map(k => [k, TAB_WORDS[k]]).map(([k, t]) =>
    `<button class="${queueTab === k ? 'on' : ''}" role="tab" aria-selected="${queueTab === k}" onclick="setQueueTab('${k}')">${t} <span class="c">${items[k].length}</span></button>`).join('');
  const rows = list.map(x => {
    const on = x === sel, [, cls, word] = QU_STATE[quStateOf(x)];
    const sentAt = x.st === 'sent' ? new Date(x.d.draftSentAt) : null;
    const due = sentAt ? `Sent ${relDayLower(sentAt)}` : x.st === 'next' ? 'After the one in review' : quDueShort(x.w);
    const kind = sentAt || x.w.sent || x.st === 'next' ? '' : x.w.late ? 'is-late' : x.w.daysLeft === 0 ? 'is-soon' : '';
    const n = sentAt ? fmtTime(sentAt) : x.mine.length ? todayPlural(x.mine.length, 'logged', 'logged') : 'Draft only';
    return `<a class="rvn-r qu-r${on ? ' is-sel' : ''}" href="#queue" onclick="selectQueueClient('${x.c.id}');return false;"${on ? ' aria-current="true"' : ''}>
<div class="tx"><b>${escapeHtml(x.c.name)}</b><span class="s"><span class="rvn-due ${kind}">${escapeHtml(due)}</span> · ${n}</span></div>
<div class="rvn-rr"><span class="qu-tag ${cls}">${word}</span></div></a>`;
  }).join('') || `<div class="rvn-empty"><b>${{ todo: 'Nothing to do', review: 'Nothing in review', sent: 'Nothing sent this week' }[queueTab]}</b>${{ todo: 'Clients show up here once you log work for them.', review: 'Drafts you send for review wait here until they go out.', sent: 'Your updates show here once they’re sent.' }[queueTab]}</div>`;
  // Worth logging for: clients you tracked time for, or yours that are due, with nothing logged
  // (logSuggestions in week-health.js). Under To do, after the clients already here.
  const sugg = queueTab === 'todo' && typeof logSuggestions === 'function' ? logSuggestions(4) : [];
  const suggHtml = sugg.length ? `<p class="rvn-sort qu-sgh">Worth logging for</p>${sugg.map(x => `<a class="rvn-r qu-r qu-sgr" href="#queue" onclick="openQueueLogImprovementModal('${x.c.id}');return false;" title="Log work for ${escapeHtml(x.c.name)}">
<div class="tx"><b>${escapeHtml(x.c.name)}</b><span class="s${/overdue/.test(x.why) ? ' is-late' : ''}">${escapeHtml(x.why)}</span></div><span class="qu-sgp" aria-hidden="true">${icon('plus')}</span></a>`).join('')}` : '';
  window._quSugg = sugg;
  const lateN = list.filter(x => x.w.late).length, toSend = list.filter(quWaToSend).length;
  const sortNote = queueTab === 'todo' ? `Due first${lateN ? ` · ${lateN} late` : ''}` : queueTab === 'sent' ? 'Sent this week · newest first'
    : toSend ? `${toSend} yours to send on WhatsApp` : 'Waiting on an approver';
  const prevScroll = root.querySelector('.rvn-mail')?.scrollTop || 0, prevKey = root.dataset.sel || '';
  const keep = quKeepComposer(root);
  const uw = typeof uiStyleOn === 'function' && uiStyleOn(), parts = sel ? queueReadHtml(sel, list, uw) : null;
  const read = uw && parts ? `<section class="rvn-read" aria-label="Selected client">${parts.main}</section><section class="rvn-railc">${parts.rail}</section>`
    : `<section class="rvn-read" aria-label="Selected client">${sel ? parts : `<div class="rvn-none">${queueEmptyHtml(items)}</div>`}</section>`;
  root.innerHTML = `<div class="rvn qu">
<section class="rvn-list" aria-label="Your clients">
<div class="rvn-lh"><div class="seg" role="tablist" aria-label="Queue">${tabs}</div></div>
<p class="rvn-sort">${sortNote}</p>
<div class="rvn-rows">${rows}${suggHtml}</div>
${list.length > 1 ? '<p class="rvn-keys"><span><kbd>J</kbd><kbd>K</kbd> next and previous</span></p>' : ''}
</section>
${read}
</div>`;
  root.dataset.sel = sel ? sel.c.id : '';
  if(sel && prevKey === sel.c.id){ const m = root.querySelector('.rvn-mail'); if(m) m.scrollTop = prevScroll; }
  quRestoreComposer(root, keep);
  if(currentViewName === 'queue'){
    const todo = items.todo.filter(x => x.st !== 'next').length, rev = items.review.length;   // next updates aren't to do yet
    setToolbar(null, todo || rev ? [todo ? `${todo} to do` : '', rev ? `${rev} in review` : ''].filter(Boolean).join(' · ') : 'Your logged work, client by client');
  }
}
// What you were typing in Log More (and where the cursor was) survives a redraw.
function quKeepComposer(root){
  const ta = root.querySelector('#quNew');
  if(!ta) return null;
  window._quForm = { id: root.dataset.sel, date: root.querySelector('#quDate')?.value || '', time: root.querySelector('#quTime')?.value || '' };
  return { id: root.dataset.sel, v: ta.value, focus: document.activeElement === ta, s: ta.selectionStart };
}
function quRestoreComposer(root, k){
  if(root.querySelector('#quTime')?.value) quTimeChanged(root.dataset.sel);
  const ta = root.querySelector('#quNew');
  if(!ta || !k || k.id !== root.dataset.sel || !k.v) return;
  ta.value = k.v; quGrow(ta);
  if(k.focus){ ta.focus(); try{ ta.setSelectionRange(k.s, k.s); }catch(e){} }
}
function quGrow(ta){ ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; }

function queueEmptyHtml(items){
  if(!activeClients().length) return emptyNoClients('Work you log for clients collects here, client by client, until it goes out in an update.');
  if(queueTab === 'sent') return emptyState({ icon: 'queue', tone: 'ok', title: 'Nothing sent this week',
    text: 'Your updates show here once they’re sent, with the letter as the client got it.',
    link: items.review.length ? `${items.review.length} in review` : '', onLink: "setQueueTab('review')" });
  if(queueTab === 'review') return emptyState({ icon: 'queue', tone: 'ok', title: 'Nothing in review',
    text: 'When you send a draft for review it waits here until an approver sends it.',
    link: items.todo.length ? `${items.todo.length} to do` : '', onLink: "setQueueTab('todo')" });
  const top = (window._quSugg || [])[0];
  return emptyState({ icon: 'queue', tone: 'ok', title: 'Nothing logged since the last updates',
    text: top ? `Log what you did for a client and it shows up here. ${top.c.name} is first: ${top.why.toLowerCase()}.` : 'Log what you did for a client and it shows up here, ready to become this week’s update.',
    action: top ? `Log for ${shortClientName(top.c.name)}` : 'Log Improvement', onAction: top ? `openQueueLogImprovementModal('${top.c.id}')` : 'openQueueLogImprovementModal()',
    link: items.review.length ? `${items.review.length} in review` : '', onLink: "setQueueTab('review')" });
}

function queueReadHtml(x, list, split){
  const c = x.c, w = x.w, d = x.d, me = myName(), A = `'${c.id}',${jsArg(me)}`, i = list.indexOf(x);
  const h = clientHealth(c), editingDraft = d && window._quDraftEdit === c.id;
  // Sent for review (or approved): it's out of your hands, so nothing here changes it any more, the
  // draft or the work in it, and Log More is gone. An approver can still edit it in Review.
  const locked = x.st === 'review' || x.st === 'approved';
  const rework = d && !locked ? canReworkDraft(c, d) : false;
  const dl = d ? draftDelta(c, d) : null, inDraft = new Set(dl ? dl.inc.map(it => it.id) : []);
  // Top: move through the list; the draft's Edit and Rewrite while you can still change it.
  const nav = `<div class="rvn-nav"><button class="ib" aria-label="Previous client" title="Previous (K)" onclick="queueStep(-1)"${i <= 0 ? ' disabled' : ''}>${icon('chevron-up')}</button><button class="ib" aria-label="Next client" title="Next (J)" onclick="queueStep(1)"${i >= list.length - 1 ? ' disabled' : ''}>${icon('chevron-down')}</button><span>${i + 1} of ${list.length}</span></div>`;
  const top = editingDraft
    ? `${nav}<span class="rvn-editing">${icon('pencil-simple')}Editing your draft</span><span class="rvn-sp"></span><button class="btn" onclick="quCancelDraftEdit()">Cancel</button><button class="btn btn-p" onclick="quSaveDraftEdit('${c.id}')">Save Changes</button>`
    : `${nav}<span class="rvn-sp"></span>${d && rework ? `<button class="btn rvn-q" onclick="quStartDraftEdit('${c.id}')">${icon('pencil-simple')}Edit</button><button class="btn rvn-q" onclick="generateDraft(${A})">${icon('sparkle')}Rewrite</button>` : ''}<button class="btn rvn-q" onclick="openClientDetail('${c.id}')">${icon('external-link')}Open Client</button>`;
  // The client, and where its update stands.
  const sentAt = x.st === 'sent' ? new Date(d.draftSentAt) : null;
  const due = sentAt ? `Sent ${relDayLower(sentAt)} at ${fmtTime(sentAt)}` : x.st === 'next' ? `Next update · after the one ${x.held && x.held.draftStatus === 'approved' ? 'approved' : 'in review'} is sent`
    : w.sent ? `Last update sent ${relDayLower(w.last)} · next ${w.dueText.replace(/^Due /, 'due ')}` : w.dueText;
  const head = `<div class="rvn-hd">${monoHtml(c, 'lg')}<div class="tx"><b>${escapeHtml(c.name)}</b><span class="s"><span class="${!sentAt && !w.sent && w.late && x.st !== 'next' ? 't-red' : ''}">${escapeHtml(due)}</span></span><span class="s">${escapeHtml([c.service, w.owner ? (w.owner === me ? 'Yours' : 'Owner ' + firstName(w.owner)) : ''].filter(Boolean).join(' · '))}</span></div></div>`;
  // Your work: each item with its email switch, Edit and Delete; Log More under it, with the date
  // (today unless you pick another) and the time spent, kept while you move around the page.
  const today = toDateStr(new Date()), kf = window._quForm && window._quForm.id === c.id ? window._quForm : null;
  const form = { date: kf && kf.date && kf.date <= today ? kf.date : today, time: kf ? kf.time || '' : '' };
  const out = x.mine.length - x.email.length;
  const meta = it => {
    const bits = [fmtShortDate(new Date(it.date))], mins = typeof workMinutes === 'function' ? workMinutes([it.id]) : 0;
    if(mins) bits.push(hmm(mins));   // the time logged with it (deleting the work deletes that too)
    if(locked) bits.push(inDraft.has(it.id) ? 'In this update' : it.includeInEmail === false ? 'Internal' : 'Next update');
    else if(it.includeInEmail === false) bits.push('Internal');
    else if(d && !d.draftSentAt) bits.push(inDraft.has(it.id) ? 'In your draft' : 'Not in your draft yet');
    if(it.source && it.source !== 'manual') bits.push({ note: 'From a note', time: 'From your timesheet', whatsapp: 'From WhatsApp' }[it.source] || '');
    return bits.filter(Boolean).join(' · ');
  };
  const itemRow = it => {
    const on = it.includeInEmail !== false, I = `'${c.id}','${it.id}'`;
    if(locked) return `<div class="qu-i is-lock"><div class="qu-t"><span class="qu-tx">${escapeHtml(it.text)}</span><span class="qu-m">${escapeHtml(meta(it))}</span></div></div>`;
    if(window._quEditImp === it.id) return `<div class="qu-i is-edit"><textarea spellcheck="true" class="qu-edt" id="quEdit" aria-label="Edit what you did" onkeydown="quEditKey(event,${I})">${escapeHtml(it.text)}</textarea><div class="qu-ea"><button class="btn" onclick="quCancelEdit()">Cancel</button><button class="btn btn-p" onclick="quSaveEdit(${I})">Save</button></div></div>`;
    return `<div class="qu-i${on ? '' : ' is-out'}"><div class="qu-t"><span class="qu-tx">${escapeHtml(it.text)}</span><span class="qu-m">${escapeHtml(meta(it))}</span></div>
<label class="qu-em"><span>Email</span><button class="sw${on ? ' on' : ''}" role="switch" aria-checked="${on}" aria-label="Include in the email: ${escapeHtml(it.text.slice(0, 60))}" onclick="quToggleEmail(${I})"></button></label>
<button class="ib act" title="Edit" aria-label="Edit" onclick="quStartEdit('${it.id}')">${icon('pencil-simple')}</button><button class="ib act" title="Delete" aria-label="Delete" onclick="quDeleteImp(${I})">${icon('trash')}</button></div>`;
  };
  const quComposer = `<div class="qu-new"><textarea spellcheck="true" id="quNew" rows="1" placeholder="Log more for ${escapeHtml(shortClientName(c.name))}…" aria-label="Log more work for ${escapeHtml(c.name)}" oninput="quGrow(this)" onkeydown="quNewKey(event,'${c.id}')"></textarea>
<div class="qu-nf"><label class="qu-fl" for="quDate">Date</label>${sheetDateField('quDate', form.date, { past: true, from: -13, to: 0, max: toDateStr(new Date()) })}
<label class="qu-fl" for="quTime">Time spent</label><input id="quTime" class="tf qu-time" placeholder="0:30" autocomplete="off" aria-label="Time spent" value="${escapeHtml(form.time)}" aria-required="true" oninput="this.classList.remove('is-need');quTimeChanged('${c.id}')" onkeydown="quNewKey(event,'${c.id}')">
<span class="rvn-sp"></span><button class="btn" onclick="quLog('${c.id}')">${icon('plus')}Log</button></div>
<input type="hidden" id="quClient" value="${c.id}"><div class="f qu-pf" id="quPick"></div></div>
<p class="qu-hint">The time spent is required and goes on your timesheet${typeof hvTimeOn === 'function' && hvTimeOn() ? ' and in Harvest' : ''}. New work goes in the email; switch Email off to keep it internal. <kbd>↩</kbd> logs it.</p>`;
  const work = `<section class="qu-sec" aria-label="Your work"><div class="qu-sh"><b>Your work</b><span class="c">${x.mine.length}</span>${x.mine.length ? `<span class="qu-shs">${x.email.length} for the email${out ? ` · ${out} internal` : ''}</span>` : ''}</div>
${x.st === 'next' ? `<p class="qu-nextn">Logged after you sent ${escapeHtml(shortClientName(c.name))}’s update for review, so it goes in the next one. <a class="fix-lnk" href="#" onclick="openQueueClient('${c.id}','review');return false;">See the one ${x.held && x.held.draftStatus === 'approved' ? 'approved' : 'in review'}</a></p>` : ''}
${x.mine.map(itemRow).join('') || '<p class="qu-none">Nothing of yours logged since the last update.</p>'}
${locked ? quLockedNote(c, x.st) : quComposer}</section>`;
  // Your draft, once there is one: as the client will read it.
  let draft = '';
  if(d){
    const stWords = { written: 'Written, not sent for review yet', empty: 'Nothing left in it', review: `In review since ${whenShort(d.draftPendingSince || rNow())}`, approved: 'Approved', sent: `Sent ${relDayLower(sentAt || rNow())}` }[x.st] || '';
    const note = sentAt ? '' : dl.gone ? `<p class="qu-dn is-red">${dl.allGone ? 'Everything this draft was written from was deleted.' : `${todayPlural(dl.gone, 'item')} in it ${dl.gone === 1 ? 'was' : 'were'} deleted.`}${rework ? ` <a class="fix-lnk" href="#" onclick="generateDraft(${A});return false;">Rewrite it from what’s logged now</a>` : ''}</p>`
      : dl.added.length ? `<p class="qu-dn">${dl.added.length === 1 ? '1 item was' : `${dl.added.length} items were`} logged after it.${rework ? ` <a class="fix-lnk" href="#" onclick="generateDraft(${A});return false;">Rewrite to include ${dl.added.length === 1 ? 'it' : 'them'}</a>` : ' They go in the next update.'}</p>` : '';
    const body = editingDraft ? `<textarea spellcheck="true" class="rvn-edit" id="qu-draft-${c.id}" aria-label="Draft">${escapeHtml(d.draft || '')}</textarea>` : `<div class="rvn-body">${draftBodyHtml(d.draft)}</div>`;
    draft = `<section class="qu-sec" aria-label="Your draft"><div class="qu-sh"><b>${sentAt ? 'Your update' : 'Your draft'}</b><span class="qu-shs">${escapeHtml(stWords)}</span></div>${note}
<h3 class="qu-subj">Your weekly update${sentAt ? '' : ' — ' + escapeHtml(updateRangeLabel(c))}</h3>${sentAt && !d.draft ? '<p class="qu-none">The letter isn’t kept once it’s archived.</p>' : body}</section>`;
  }
  // The rail: where this update stands, and anyone else's work for it.
  const others = w.logged.filter(it => it.author !== me);
  const byOther = {}; others.forEach(it => { byOther[it.author] = (byOther[it.author] || 0) + 1; });
  const ch = typeof winChannel === 'function' ? winChannel(c) : 'email';
  const rail = `<aside class="rvn-rail" aria-label="This update">
<div class="rvn-rs"><b>This update</b></div>
${x.st === 'next' ? `<div class="rvn-kv"><span>Due</span><span>A week after the one in review is sent</span></div>`
  : `<div class="rvn-kv"><span>${w.sent ? 'Next due' : 'Due'}</span><span${!w.sent && w.late ? ' class="t-red"' : ''}>${escapeHtml(w.late && !w.sent ? w.dueText : w.due ? w.due.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) : '—')}</span></div>`}
<div class="rvn-kv"><span>Your step</span><span>${escapeHtml(QU_STATE[quStateOf(x)][0])}</span></div>
<div class="rvn-kv"><span>Last update</span><span>${w.last ? escapeHtml(fmtShortDate(w.last)) : 'None yet'}</span></div>
${sentAt ? '' : (n => `<div class="rvn-kv"><span>Your time</span><span>${n ? escapeHtml(hmLong(n)) : 'None'} since ${escapeHtml(fmtShortDate(w.since))}</span></div>`)(quMyMinutes(c, w))}
<div class="rvn-kv"><span>Sends by</span><span>${{ whatsapp: 'WhatsApp', both: 'Email and WhatsApp' }[ch] || 'Email'}</span></div>
<div class="rvn-kv"><span>Health</span><span><span class="rvn-hl ${h.level}"><i></i>${escapeHtml(healthWord(h.level))}</span></span></div>
${others.length ? `<div class="rvn-rs rvn-s2"><b>Others’ work</b><span>${others.length}</span></div>${Object.entries(byOther).map(([n, k]) => `<div class="rvn-kv"><span>${escapeHtml(n)}</span><span>${todayPlural(k, 'item')}</span></div>`).join('')}<p class="rvn-rnote">Each person writes their own draft from their own work.</p>` : ''}
<p class="rvn-rnote">Only work with Email on goes in the draft. Internal work stays in the log and in Past Improvements.</p>
</aside>`;
  // The main step, under it all.
  const env = icon('envelope-simple');
  let foot;
  if(editingDraft) foot = `<span class="rvn-ft-note">Save first, then send</span><span class="rvn-sp"></span><button class="btn btn-p rvn-main" disabled>${icon('paper-plane-tilt')}Send for Review</button>`;
  else if(x.st === 'write') foot = `<span class="rvn-ft-note">${icon('sparkle')}Written from the ${todayPlural(x.email.length, 'item')} with Email on</span><span class="rvn-sp"></span><button class="btn btn-p rvn-main" onclick="generateDraft(${A})">${icon('sparkle')}Write Draft</button>`;
  else if(x.st === 'next') foot = `<span class="rvn-ft-note">${icon('clock')}You can write it once the update ${x.held && x.held.draftStatus === 'approved' ? 'that’s approved' : 'in review'} is sent.</span><span class="rvn-sp"></span><button class="btn btn-p rvn-main" disabled title="Once the update in review is sent">${icon('sparkle')}Write Draft</button>`;
  else if(x.st === 'internal') foot = `<span class="rvn-ft-note">Nothing is marked for the email yet. Switch Email on for an item, or log more.</span><span class="rvn-sp"></span><button class="btn btn-p rvn-main" disabled title="Switch Email on for something first">${icon('sparkle')}Write Draft</button>`;
  else if(x.st === 'empty') foot = x.email.length
    ? `<span class="rvn-ft-note">Rewrite it from what’s logged now to send it.</span><span class="rvn-sp"></span><button class="btn btn-p rvn-main" onclick="generateDraft(${A})">${icon('sparkle')}Rewrite Draft</button>`
    : `<span class="rvn-ft-note">Log this week’s work, then rewrite it to send it.</span><span class="rvn-sp"></span>`;
  else if(x.st === 'written') foot = `<span class="rvn-ft-note">${env}An approver reads it before it goes out</span><span class="rvn-sp"></span><button class="btn btn-p rvn-main" onclick="sendDraftForReview(${A})">${icon('paper-plane-tilt')}Send for Review</button>`;
  else if(x.st === 'review') foot = !queueHasReview()
    ? `<span class="rvn-ft-note">${icon('clock')}In Review, where it’s approved and sent</span><span class="rvn-sp"></span><button class="btn btn-p rvn-main" onclick="openReviewDraft(${A})">Open in Review</button>`
    : ch === 'whatsapp' && typeof reviewWaFootHtml === 'function' ? reviewWaFootHtml(c, d, 'waiting', A)
    : `<span class="rvn-ft-note">${icon('clock')}Waiting for an approver. You’ll get a notification when it’s sent.</span><span class="rvn-sp"></span>`;
  else if(x.st === 'sent') foot = ch === 'whatsapp' && typeof reviewWaFootHtml === 'function' ? reviewWaFootHtml(c, d, 'sent', A)
    : `<span class="rvn-ft-note">${icon('check-circle')}Sent ${escapeHtml(relDayLower(sentAt))} at ${escapeHtml(fmtTime(sentAt))}${c.email ? ' to ' + escapeHtml(c.email) : ''}${d.draftSentBy ? ' by ' + (d.draftSentBy === me ? 'you' : escapeHtml(d.draftSentBy)) : ''}</span><span class="rvn-sp"></span>${ch === 'both' ? `<button class="btn" onclick="copyWinText(${A})">${icon('copy')}Copy for WhatsApp</button>` : ''}`;
  else foot = ch === 'whatsapp' && typeof reviewWaFootHtml === 'function' ? reviewWaFootHtml(c, d, 'approved', A)
    : `<span class="rvn-ft-note">${icon('check-circle')}Approved. An approver sends it, and you’ll get a notification.</span><span class="rvn-sp"></span>`;
  const doc = `<div class="rvn-doc">${head}${sentAt ? '' : work}${draft}</div>`;
  if(split) return { main: `<div class="rvn-top">${top}</div>
<div class="rvn-mail"><div class="rvn-cols is-one">${doc}</div></div>
<div class="rvn-ft">${foot}</div>`, rail };
  return `<div class="rvn-top">${top}</div>
<div class="rvn-mail"><div class="rvn-cols">${doc}${rail}</div></div>
<div class="rvn-ft">${foot}</div>`;
}

// Sent for review or approved: why nothing in the panel can change, and where new work goes.
function quLockedNote(c, st){
  return `<p class="qu-lockn">${icon('lock')}<span>${st === 'approved' ? 'Approved' : 'Sent for review'}, so this update can’t change now${st === 'review' ? ' (an approver can still edit it in Review)' : ''}. Work you log for ${escapeHtml(shortClientName(c.name))} from here on goes in the next one. <a class="fix-lnk" href="#" onclick="openQueueLogImprovementModal('${c.id}');return false;">Log work for the next one</a></span></p>`;
}
// Your time on a client since its last update, from the timesheet.
function quMyMinutes(c, w){
  const from = toDateStr(w.since), me = typeof currentUser !== 'undefined' && currentUser ? currentUser.id : null;
  return (typeof timeEntries !== 'undefined' ? timeEntries : []).filter(e => e.clientId === c.id && e.userId === me && !e.deletedAt && e.date >= from).reduce((n, e) => n + (e.minutes || 0), 0);
}
function selectQueueClient(id){ if(window._queueSel !== id) quResetEdits(); window._queueSel = id; renderMyQueue(); }
function queueStep(dir){
  const list = queueItems()[queueTab];
  const i = list.findIndex(x => x.c.id === window._queueSel);
  const next = list[Math.min(list.length - 1, Math.max(0, (i < 0 ? 0 : i) + dir))];
  if(next && next.c.id !== window._queueSel){
    selectQueueClient(next.c.id);
    document.querySelector('#queueRoot .rvn-r.is-sel')?.scrollIntoView({ block: 'nearest' });
  }
}
// Open a client in the queue (from elsewhere in the app).
// tab: which of the client's lines to open, when it has one in each (In review and its Next update)
function openQueueClient(id, tab){
  window._queueSel = id; quResetEdits();
  if(tab && queueTabs().includes(tab) && queueItems()[tab].some(x => x.c.id === id)) queueTab = tab;
  if(currentViewName !== 'queue') switchView('queue'); else renderMyQueue();
}

// Everything that shows logged work is drawn again after a change here.
function quRefreshAll(clientId, o){
  if(typeof renderClientsTable === 'function') renderClientsTable();
  if(typeof renderKpis === 'function') renderKpis();
  if(o && o.keepQueue){ if(typeof renderThisWeek === 'function') renderThisWeek(); } else renderQueue();
  if(typeof renderTeamQueue === 'function') renderTeamQueue();
  if(typeof renderImprovementsHistory === 'function') renderImprovementsHistory();
  if(clientId && typeof refreshClientDetailActivityIfOpen === 'function') refreshClientDetailActivityIfOpen(clientId);
}
function quFind(clientId, impId){
  const c = clients.find(x => x.id === clientId);
  return { c, imp: c && (c.improvements || []).find(i => i.id === impId) };
}

// Email on or off for one item. Same write as Past Improvements, checked for a row actually changed.
async function quToggleEmail(clientId, impId){
  const { c, imp } = quFind(clientId, impId);
  if(!c || !imp) return;
  const next = imp.includeInEmail === false;
  imp.includeInEmail = next; renderMyQueue();   // the switch moves at once; it moves back if the save fails
  const { data, error } = await supabaseClient.from('client_improvements').update({ include_in_email: next }).eq('id', impId).select();
  const ok = !error && !!(data && data.length);
  if(!ok){
    console.error('quToggleEmail failed', impId, error || 'no row changed');
    imp.includeInEmail = !next; renderMyQueue();
    showToast('error', 'Couldn’t save that', 'Try again in a moment.');
    return;
  }
  const ci = (typeof clientImprovements !== 'undefined' ? clientImprovements : []).find(i => i.id === impId); if(ci) ci.includeInEmail = next;
  quRefreshAll(null, { keepQueue: true });   // the Queue already shows it; drawing it again would cut the slide short
}

function quStartEdit(impId){
  window._quEditImp = impId; renderMyQueue();
  const ta = document.getElementById('quEdit'); if(ta){ quGrow(ta); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
}
function quCancelEdit(){ window._quEditImp = null; renderMyQueue(); }
function quEditKey(e, clientId, impId){
  if(e.key === 'Escape'){ e.preventDefault(); quCancelEdit(); }
  else if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); quSaveEdit(clientId, impId); }
}
async function quSaveEdit(clientId, impId){
  const ta = document.getElementById('quEdit'), text = ta ? ta.value.trim() : '';
  const { c, imp } = quFind(clientId, impId);
  if(!c || !imp){ quCancelEdit(); return; }
  if(!text){ showToast('error', 'Nothing to save', 'Write what you did, or delete the item instead.'); return; }
  if(text === imp.text){ quCancelEdit(); return; }
  const old = imp.text;
  const { data, error } = await supabaseClient.from('client_improvements').update({ text }).eq('id', impId).select();
  if(error || !(data && data.length)){ console.error('quSaveEdit failed', impId, error || 'no row changed'); showToast('error', 'Couldn’t save that', 'Try again in a moment.'); return; }
  imp.text = text;
  const ci = (typeof clientImprovements !== 'undefined' ? clientImprovements : []).find(i => i.id === impId); if(ci) ci.text = text;
  window._quEditImp = null;
  const cut = s => s.length > 60 ? s.slice(0, 60) + '…' : s;
  if(typeof logClientActivity === 'function') logClientActivity(clientId, 'improvement_edited', `${myName() || 'Someone'} changed an improvement — "${cut(old)}" → "${cut(text)}"`);
  quRefreshAll(clientId);
  // the draft (not sent for review yet) was written from the old words: say so
  const d = getDraftFor(c, myName()), inIt = d && d.draft && !d.draftSentAt && (d.draftImprovementIds || []).includes(impId);
  showToast('success', 'Saved', inIt ? 'Your draft still has the old wording. Rewrite it to include the change.' : '');
}

// Delete: the work and the time logged with it go to Recently Deleted (see trashWork in data.js).
async function quDeleteImp(clientId, impId){
  const { c, imp } = quFind(clientId, impId);
  if(!c || !imp) return;
  const r = await deleteWorkAsk([impId]);
  if(!r || !r.ok) return;
  if(window._quEditImp === impId) window._quEditImp = null;
  quRefreshAll(clientId);
  if(typeof renderTimesheet === 'function') renderTimesheet();
}

// Log More: right here, for this client. A draft you already wrote stays; the work shows as
// logged after it, with a way to rewrite it to include it.
function quNewKey(e, clientId){
  if(e.key === 'Enter' && !e.shiftKey && !e.isComposing){ e.preventDefault(); quLog(clientId); }
}
// Time spent goes to Harvest by project and task: those rows show once there's time to log.
function quTimeChanged(clientId){
  const wrap = document.getElementById('quPick'); if(!wrap) return;
  const has = !!(document.getElementById('quTime')?.value || '').trim();
  if(!has || typeof hvTimeOn !== 'function' || !hvTimeOn()){ if(wrap.innerHTML) wrap.innerHTML = ''; return; }
  if(wrap.innerHTML) return;
  const d = hvDefaultPick(clientId);
  wrap.innerHTML = hvPickRowsHtml('qu', clientId, d.projectId, d.taskId);
}
async function quLog(clientId){
  const g = id => document.getElementById(id);
  const ta = g('quNew'), text = ta ? ta.value.trim() : '';
  if(!text){ if(ta) ta.focus(); return; }
  if(typeof isClientPaused === 'function' && isClientPaused(clientId)){ showPausedClientWarning(clientId); return; }
  const c = clients.find(x => x.id === clientId);
  if(!c) return;
  // the time spent is required: every item logged here goes on the timesheet
  const timeRaw = (g('quTime')?.value || '').trim(), minutes = timeRaw ? parseSpent(timeRaw) : 0;
  if(!timeRaw){ showToast('error', 'Add the time spent', 'How long did it take? Try 0:30, 45m or 1h 30m.'); g('quTime')?.focus(); g('quTime')?.classList.add('is-need'); return; }
  if(!minutes){ showToast('error', 'Check the time', 'Try 0:30, 45m or 1h 30m.'); g('quTime')?.focus(); g('quTime')?.classList.add('is-need'); return; }
  const pick = minutes && g('quPick')?.innerHTML && typeof hvPickValue === 'function' ? hvPickValue('qu', clientId) : { ok: true, projectId: null, taskId: null };
  if(!pick.ok){ showToast('error', 'Almost there', pick.msg); return; }
  if(minutes > 960 && !(await confirmDialog(`That’s ${hmLong(minutes)} for one improvement. Log it anyway?`, { confirmLabel: 'Log It', cancelLabel: 'Fix It' }))) return;
  const today = toDateStr(new Date()), dateStr = g('quDate')?.value || today;
  const when = dateStr === today ? new Date() : new Date(dateStr + 'T12:00:00');
  const service = typeof serviceFromHarvest === 'function' && serviceFromHarvest(c) ? (pick.projectId ? pick.service : improvementServiceFor(c)) : c.service || '';
  const author = myName() || 'Team member';
  if(ta) ta.disabled = true;
  const imp = typeof insertImprovementFull === 'function'
    ? await insertImprovementFull(clientId, { author, text, includeInEmail: true, source: 'manual', date: when.toISOString(), service })
    : await insertImprovementRow(clientId, { author, text, includeInEmail: true, source: 'manual', date: when.toISOString() });
  if(!imp){ if(ta) ta.disabled = false; showToast('error', 'Couldn’t log that', 'Try again in a moment.'); return; }
  // the time, on your timesheet for that day (and to Harvest for a Harvest client)
  let timeOk = true;
  if(minutes){
    const r = await mergeOrInsertTimeEntry({ clientId, service: pick.projectId ? pick.service : service, dateStr, minutes, description: text, projectId: pick.projectId, taskId: pick.taskId, improvementId: imp.id });
    if(r.error) timeOk = false;
    else {
      if(!r.merged && r.entryId) await supabaseClient.from('time_entries').update({ logged: true }).eq('id', r.entryId);
      syncEntryToHarvestBackground(r.entryId);
    }
    if(typeof loadTimeEntries === 'function') await loadTimeEntries();
    if(typeof renderTimesheet === 'function') renderTimesheet();
  }
  if(ta){ ta.value = ''; ta.disabled = false; }
  const tm = g('quTime'); if(tm) tm.value = '';
  window._quForm = { id: clientId, date: dateStr, time: '' };
  if(typeof logClientActivity === 'function') logClientActivity(clientId, 'improvement_logged', `${author} logged an improvement: "${text.length > 80 ? text.slice(0, 80) + '…' : text}"`);
  quRefreshAll(clientId);
  if(minutes && !timeOk) showToast('info', 'Logged, without the time', `The work is saved for ${c.name}, but the time didn’t save. Add it on the Timesheet.`);
  else if(minutes) showToast('success', 'Logged', `${hmLong(minutes)} on your timesheet${dateStr === today ? '' : ' for ' + fmtShortDate(when)}.`);
  const again = g('quNew'); if(again) again.focus();
}

// Editing your draft by hand, until you send it for review.
function quStartDraftEdit(clientId){
  window._quDraftEdit = clientId; renderMyQueue();
  const ta = document.getElementById('qu-draft-' + clientId); if(ta){ ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
}
function quCancelDraftEdit(){ window._quDraftEdit = null; renderMyQueue(); }
async function quSaveDraftEdit(clientId){
  const ta = document.getElementById('qu-draft-' + clientId); if(!ta) return;
  const ok = await saveDraftFor(clientId, myName(), { draft: ta.value });
  if(!ok){ showToast('error', 'Couldn’t save the draft', 'Try again in a moment.'); return; }
  window._quDraftEdit = null; quRefreshAll(clientId); showToast('success', 'Draft saved', '');
}

// J / K move through the list (not while typing); Escape leaves editing.
document.addEventListener('keydown', e => {
  if(currentViewName !== 'queue') return;
  if(document.querySelector('#appModalOverlay[style*="flex"], .cmdk-overlay[style*="block"]')) return;
  const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]');
  if(e.key === 'Escape' && window._quDraftEdit && !document.getElementById('quEdit')){ e.preventDefault(); quCancelDraftEdit(); return; }
  if(typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if(e.key === 'j' || e.key === 'J'){ e.preventDefault(); queueStep(1); }
  else if(e.key === 'k' || e.key === 'K'){ e.preventDefault(); queueStep(-1); }
});

// For a member, a draft that would open in Review opens in the Queue (notifications, Today, This Week).
openReviewDraft = (function(orig){
  return function(clientId, author){
    if(queueHasReview() && (!author || author === myName())) return openQueueClient(clientId, 'review');
    return orig(clientId, author);
  };
})(openReviewDraft);
