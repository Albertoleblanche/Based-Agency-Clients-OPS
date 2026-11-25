// Queue: your work for client emails, client by client, laid out like Review. The list is every
// client with work for its email since its last update (or whose draft of yours isn't sent yet);
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
function quResetEdits(){ window._quEditImp = null; window._quDraftEdit = null; window._quKeep = null; }

// One client in your queue: what you logged, what of it goes in the email, your part and its step.
// Each person writes their own part of a client's update from their own work (Nov 22); the parts go
// to the client as one email (update-parts.js). Once your part is sent for review (or approved) it's
// locked, in the In review tab with exactly the work it was written from; anything you log for the
// client after that is a second line, the Next update, in To do, where it can be edited and added to.
// It becomes the update after this one is sent (or joins this one again if it comes back to you).
// The Queue is for what goes in client emails (Nov 22): a client is here only when there's work of
// yours for the email (or a part, a review or a send). Internal-only work stays in the client's log.
function quEntriesBase(c, me){
  const w = clientWeek(c), d = getDraftFor(c, me);
  const all = w.logged.filter(i => i.author === me).sort((a, b) => new Date(b.date) - new Date(a.date));
  const emailOf = list => list.filter(i => i.includeInEmail !== false);
  const isLocked = x => !!x && !!x.draft && !x.draftSentAt && (x.draftStatus === 'approved' || (x.draftStatus === 'pending' && x.readyToNotify));
  const inDraft = x => { const ids = x.draftImprovementIds || [], since = x.draftPendingSince ? new Date(x.draftPendingSince) : null;
    return i => ids.length ? ids.includes(i.id) : !since || new Date(i.date) <= since; };
  // a part written only from work since deleted isn't shown: write a new one from what's logged now
  const live = !!d.draft && !d.draftSentAt && (d.draftStatus === 'pending' || d.draftStatus === 'approved') && !draftHasNoWork(c, d);
  if(live && isLocked(d)){
    const inIt = inDraft(d), sent = all.filter(inIt), after = all.filter(i => !inIt(i)), out = [];
    out.push({ c, w, d, mine: sent, email: emailOf(sent), st: d.draftStatus === 'approved' ? 'approved' : 'review', tab: 'review' });
    if(emailOf(after).length) out.push({ c, w, d: null, held: d, mine: after, email: emailOf(after), st: 'next', tab: 'todo' });
    return out;
  }
  const email = emailOf(all);
  if(!live && !email.length){
    // nothing for the email: internal work isn't sent, so the client isn't here. One you just switched
    // to internal stays while it's open (to switch it back), and goes when you move on.
    return window._quKeep === c.id && all.length ? [{ c, w, d: null, mine: all, email, st: 'internal', tab: 'todo' }] : [];
  }
  const st = live ? (draftHasNoWork(c, d) ? 'empty' : 'written') : 'write';
  return [{ c, w, d: live ? d : null, mine: all, email, st, tab: 'todo' }];
}
// ...plus your work that never went out (w.missed, week-health.js): on your To do line for the
// client, or a line of its own, to add to the next update or leave out.
function quEntries(c, me){
  const out = quEntriesBase(c, me), w = out[0] ? out[0].w : clientWeek(c);
  const missed = (w.missed || []).filter(i => i.author === me).sort((a, b) => new Date(b.date) - new Date(a.date));
  if(!missed.length) return out;
  const todo = out.find(x => x.tab === 'todo');
  if(todo) todo.missed = missed;
  else out.push({ c, w, d: null, mine: [], team: [], email: [], missed, st: 'missed', tab: 'todo' });
  return out;
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
  const rank = { empty: 0, written: 1, write: 2, missed: 3, internal: 4, next: 5, review: 6, approved: 7 };
  const order = (a, b) => quLater(a) - quLater(b) || focusFirst(a.c, b.c) || a.w.daysLeft - b.w.daysLeft || rank[a.st] - rank[b.st] || (b.c.importance || 0) - (a.c.importance || 0) || a.c.name.localeCompare(b.c.name);
  out.todo.sort(order); out.review.sort(order);
  return out;
}
// What's on you: a draft to write, send or rewrite, and an approved WhatsApp win of yours to send.
function quWaToSend(x){
  if(x.st !== 'approved' || typeof winViaWhatsapp !== 'function' || !winViaWhatsapp(x.c)) return false;
  const st = winSendState(x.d); return st.k !== 'copied' || st.by === myName();
}
function quLater(x){ return x.st === 'next'; }
function queueBadgeCount(items){ items = items || queueItems(); return items.todo.filter(x => !['internal', 'next'].includes(x.st)).length + items.review.filter(quWaToSend).length; }
// Each step: its words in the rail, and the short tag on its row in the list.
const QU_STATE = {
  write: ['Ready to write', 'is-go', 'Write'], written: ['Draft written', '', 'Draft'], empty: ['Work deleted', 'is-red', 'Rewrite'],
  internal: ['Only internal', 'is-out', 'Internal'], review: ['In review', '', 'In review'], approved: ['Approved', '', 'Approved'],
  next: ['Next update', 'is-out', 'Next'], missed: ['Never went out', 'is-red', 'Missed'],
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
    `<button class="${queueTab === k ? 'on' : ''}" role="tab" aria-selected="${queueTab === k}" onclick="setQueueTab('${k}')">${t} <span class="c">${k === 'todo' ? items.todo.filter(x => !quLater(x)).length : items[k].length}</span></button>`).join('');
  // Next updates and work in someone else's update wait under "Later", out of the To do count
  const firstLater = queueTab === 'todo' ? list.findIndex(quLater) : -1;
  const rows = list.map((x, ix) => {
    const on = x === sel, [, cls, word0] = QU_STATE[quStateOf(x)];
    const word = word0;
    const sentAt = x.st === 'sent' ? new Date(x.d.draftSentAt) : null;
    const due = sentAt ? `Sent ${relDayLower(sentAt)}` : x.st === 'missed' ? `${todayPlural(x.missed.length, 'item')} never went out` : x.st === 'next' ? 'After the one in review' : quDueShort(x.w);
    const kind = sentAt || x.w.sent || x.st === 'next' ? '' : x.w.late ? 'is-late' : x.w.daysLeft === 0 ? 'is-soon' : '';
    const k = x.mine.length;
    const n = sentAt ? fmtTime(sentAt) : x.st === 'missed' ? 'nothing new' : k ? todayPlural(k, 'logged', 'logged') : 'Draft only';
    return `${ix === firstLater && ix > 0 ? '<p class="rvn-sort qu-sgh">Later</p>' : ''}<a class="rvn-r qu-r${on ? ' is-sel' : ''}" href="#queue" onclick="selectQueueClient('${x.c.id}');return false;"${on ? ' aria-current="true"' : ''}>
<div class="tx"><b>${escapeHtml(x.c.name)}${focusMark(x.c)}</b><span class="s"><span class="rvn-due ${kind}">${escapeHtml(due)}</span> · ${n}</span></div>
<div class="rvn-rr"><span class="qu-tag ${cls}">${word}</span></div></a>`;
  }).join('') || `<div class="rvn-empty"><b>${{ todo: 'Nothing to do', review: 'Nothing in review', sent: 'Nothing sent this week' }[queueTab]}</b>${{ todo: 'Clients show up here once you log work for their email.', review: 'Drafts you send for review wait here until they go out.', sent: 'Your updates show here once they’re sent.' }[queueTab]}</div>`;
  // Worth logging for: clients you tracked time for, or yours that are due, with nothing logged
  // (logSuggestions in week-health.js). Under To do, after the clients already here.
  const sugg = queueTab === 'todo' && typeof logSuggestions === 'function' ? logSuggestions(4) : [];
  const suggHtml = sugg.length ? `<p class="rvn-sort qu-sgh">Worth logging for</p>${sugg.map(x => `<a class="rvn-r qu-r qu-sgr" href="#queue" onclick="openQueueLogImprovementModal('${x.c.id}');return false;" title="Log work for ${escapeHtml(x.c.name)}">
<div class="tx"><b>${escapeHtml(x.c.name)}${focusMark(x.c)}</b><span class="s${/overdue/.test(x.why) ? ' is-late' : ''}">${escapeHtml(x.why)}</span></div><span class="qu-sgp" aria-hidden="true">${icon('plus')}</span></a>`).join('')}` : '';
  window._quSugg = sugg;
  const lateN = list.filter(x => x.w.late).length, toSend = list.filter(quWaToSend).length;
  const sortNote = firstLater === 0 ? 'Later: in another update' : queueTab === 'todo' ? `Due first${lateN ? ` · ${lateN} late` : ''}` : queueTab === 'sent' ? 'Sent this week · newest first'
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
    const todo = items.todo.filter(x => !quLater(x)).length, rev = items.review.length;   // next updates and work in someone else's aren't to do yet
    setToolbar(null, todo || rev ? [todo ? `${todo} to do` : '', rev ? `${rev} in review` : ''].filter(Boolean).join(' · ') : 'Work for client emails, client by client');
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
// Several lines (Nov 25): each its own improvement, with one time for all of them (data.js, workSplitItems)
function quItems(){ const t = document.getElementById('quNew')?.value || ''; const items = workSplitItems(t); return window._quAsOne || items.length < 2 ? null : items; }
function quNewSync(){
  const el = document.getElementById('quMany'), btn = document.querySelector('#quLogBtn span'), items = quItems(), all = workSplitItems(document.getElementById('quNew')?.value || '');
  if(!all.length || all.length < 2) window._quAsOne = false;
  if(btn) btn.textContent = items ? `Log ${items.length}` : 'Log';
  if(!el) return;
  el.hidden = all.length < 2;
  el.innerHTML = items ? `<b>${items.length} improvements</b>, one per line. Time spent is for all of them, as one entry. <button class="lnk-b" onclick="window._quAsOne=true;quNewSync()">Log as One</button>`
    : all.length > 1 ? `Logged as one improvement. <button class="lnk-b" onclick="window._quAsOne=false;quNewSync()">Split Into ${all.length}</button>` : '';
}

function queueEmptyHtml(items){
  if(!activeClients().length) return emptyNoClients('Work you log for clients collects here, client by client, until it goes out in an update.');
  if(queueTab === 'sent') return emptyState({ icon: 'queue', tone: 'ok', title: 'Nothing sent this week',
    text: 'Your updates show here once they’re sent, with the letter as the client got it.',
    link: items.review.length ? `${items.review.length} in review` : '', onLink: "setQueueTab('review')" });
  if(queueTab === 'review') return emptyState({ icon: 'queue', tone: 'ok', title: 'Nothing in review',
    text: 'When you send a draft for review it waits here until an approver sends it.',
    link: items.todo.length ? `${items.todo.length} to do` : '', onLink: "setQueueTab('todo')" });
  const top = (window._quSugg || [])[0];
  return emptyState({ icon: 'queue', tone: 'ok', title: 'Nothing for client emails yet',
    text: top ? `Log what you did for a client, with Email on, and it shows up here. ${top.c.name} is first: ${top.why.toLowerCase()}.` : 'Log what you did for a client, with Email on, and it shows up here, ready to become its next update. Internal work stays in the client’s log.',
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
  const head = `<div class="rvn-hd">${monoHtml(c, 'lg')}<div class="tx"><b>${escapeHtml(c.name)}${focusMark(c)}</b><span class="s"><span class="${!sentAt && !w.sent && w.late && x.st !== 'next' ? 't-red' : ''}">${escapeHtml(due)}</span></span><span class="s">${escapeHtml([c.service, w.owner ? (w.owner === me ? 'Yours' : 'Owner ' + firstName(w.owner)) : ''].filter(Boolean).join(' · '))}</span></div></div>`;
  // Your work: each item with its email switch, Edit and Delete; Log More under it, with the date
  // (today unless you pick another) and the time spent, kept while you move around the page.
  const today = toDateStr(new Date()), kf = window._quForm && window._quForm.id === c.id ? window._quForm : null;
  const form = { date: kf && kf.date && kf.date <= today ? kf.date : today, time: kf ? kf.time || '' : '' };
  const myEmail = x.mine.filter(i => i.includeInEmail !== false).length, out = x.mine.length - myEmail;
  const meta = it => {
    const bits = [fmtShortDate(new Date(it.date))], mins = typeof workMinutes === 'function' ? workMinutes([it.id]) : 0;
    if(mins) bits.push(hmm(mins));   // the time logged with it (deleting the work deletes that too)
    if(locked) bits.push(inDraft.has(it.id) ? 'In this update' : it.includeInEmail === false ? 'Internal' : 'Next update');
    else if(it.includeInEmail === false) bits.push('Internal');
    else if(d && !d.draftSentAt) bits.push(inDraft.has(it.id) ? (dl.edited.includes(it) ? 'Edited since your draft' : 'In your draft') : 'Not in your draft yet');
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
  const quComposer = `<div class="qu-new"><textarea spellcheck="true" id="quNew" rows="1" placeholder="Log more for ${escapeHtml(shortClientName(c.name))}…" aria-label="Log more work for ${escapeHtml(c.name)}" oninput="quGrow(this);quNewSync()" onkeydown="quNewKey(event,'${c.id}')"></textarea><p class="qu-many" id="quMany" hidden></p>
<div class="qu-nf"><label class="qu-fl" for="quDate">Date</label>${sheetDateField('quDate', form.date, { past: true, from: -13, to: 0, max: toDateStr(new Date()) })}
<label class="qu-fl" for="quTime">Time spent</label><input id="quTime" class="tf qu-time" placeholder="0:30" autocomplete="off" aria-label="Time spent" value="${escapeHtml(form.time)}" aria-required="true" oninput="this.classList.remove('is-need');quTimeChanged('${c.id}')" onkeydown="quNewKey(event,'${c.id}')">
<span class="rvn-sp"></span><button class="btn" id="quLogBtn" onclick="quLog('${c.id}')">${icon('plus')}<span>Log</span></button></div>
<input type="hidden" id="quClient" value="${c.id}"><div class="f qu-pf" id="quPick"></div></div>
<p class="qu-hint">The time spent is required and goes on your timesheet${typeof hvTimeOn === 'function' && hvTimeOn() ? ' and in Harvest' : ''}. New work goes in the email; switch Email off to keep it internal. <kbd>↩</kbd> logs it. Did several things? One per line (<kbd>⇧↩</kbd>), with one time for all of them.</p>`;
  const work = `<section class="qu-sec qu-mine" aria-label="Your work"><div class="qu-sh"><b>Your work</b><span class="c">${x.mine.length}</span>${x.mine.length ? `<span class="qu-shs">${myEmail} for the email${out ? ` · ${out} internal` : ''}</span>` : ''}</div>
${x.st === 'next' ? `<p class="qu-nextn">Logged after you sent ${escapeHtml(shortClientName(c.name))}’s update for review, so it goes in the next one. <a class="fix-lnk" href="#" onclick="openQueueClient('${c.id}','review');return false;">See the one ${x.held && x.held.draftStatus === 'approved' ? 'approved' : 'in review'}</a></p>` : ''}
${x.mine.map(itemRow).join('') || '<p class="qu-none">Nothing of yours logged since the last update.</p>'}
${locked ? quLockedNote(c, x.st) : quComposer}</section>
${(x.missed || []).length ? `<section class="qu-sec qu-missed" aria-label="Never went out"><div class="qu-sh"><b>Never went out</b><span class="c">${x.missed.length}</span><span class="qu-shs">logged for the email, never sent</span></div>
<p class="qu-nextn">Logged more than two weeks before ${escapeHtml(shortClientName(c.name))}’s last update and never in one. Add it to the next update, or leave it out.</p>
${x.missed.map(it => `<div class="qu-i"><div class="qu-t"><span class="qu-tx">${escapeHtml(it.text)}</span><span class="qu-m">${escapeHtml(fmtShortDate(new Date(it.date)))}</span></div><button class="btn sm" onclick="quCarry('${c.id}','${it.id}')">Add to Next Update</button><button class="btn sm" onclick="quLeaveOut('${c.id}','${it.id}')">Leave Out</button></div>`).join('')}</section>` : ''}`;
  // Your draft, once there is one: as the client will read it.
  let draft = '';
  if(d){
    const stWords = { written: 'Written, not sent for review yet', empty: 'Nothing left in it', review: `In review since ${whenShort(d.draftPendingSince || rNow())}`, approved: 'Approved', sent: `Sent ${relDayLower(sentAt || rNow())}` }[x.st] || '';
    const note = sentAt ? '' : dl.gone ? `<p class="qu-dn is-red">${dl.allGone ? 'Everything this draft was written from was deleted.' : `${todayPlural(dl.gone, 'item')} in it ${dl.gone === 1 ? 'was' : 'were'} deleted.`}${rework ? ` <a class="fix-lnk" href="#" onclick="generateDraft(${A});return false;">Rewrite it from what’s logged now</a>` : ''}</p>`
      : dl.edited.length ? `<p class="qu-dn">${dl.edited.length === 1 ? '1 item in it was' : `${dl.edited.length} items in it were`} edited after it was written.${rework ? ` <a class="fix-lnk" href="#" onclick="generateDraft(${A});return false;">Rewrite it to match</a>` : ''}</p>`
      : dl.added.length ? `<p class="qu-dn">${dl.added.length === 1 ? '1 item was' : `${dl.added.length} items were`} logged after it.${rework ? ` <a class="fix-lnk" href="#" onclick="generateDraft(${A});return false;">Rewrite to include ${dl.added.length === 1 ? 'it' : 'them'}</a>` : ' They go in the next update.'}</p>` : '';
    const body = editingDraft ? `<textarea spellcheck="true" class="rvn-edit" id="qu-draft-${c.id}" aria-label="Draft">${escapeHtml(d.draft || '')}</textarea>` : `<div class="rvn-body">${draftBodyHtml(d.draft)}</div>`;
    draft = `<section class="qu-sec" aria-label="Your draft"><div class="qu-sh"><b>${sentAt ? 'Your update' : 'Your draft'}</b><span class="qu-shs">${escapeHtml(stWords)}</span></div>${note}
<h3 class="qu-subj">Your weekly update${sentAt ? '' : ' — ' + escapeHtml(updateRangeLabel(c))}</h3>${sentAt && !d.draft ? '<p class="qu-none">The letter isn’t kept once it’s archived.</p>' : body}</section>`;
  }
  // The rail: where this update stands, and the other parts of it (Nov 22): who else is writing one,
  // and where theirs stands. By email they all go to the client together, as one email.
  const others = w.logged.filter(it => it.author !== me && it.includeInEmail !== false);
  const byOther = {}; others.forEach(it => { byOther[it.author] = (byOther[it.author] || 0) + 1; });
  const oParts = typeof clientParts === 'function' ? clientParts(c).filter(p => p.author !== me) : [];
  const oNames = [...new Set([...oParts.map(p => p.author), ...Object.keys(byOther)])];
  const PART_WORDS = { writing: 'Writing their part', review: 'In review', approved: 'Approved' };
  const oWords = n => { const p = oParts.find(x => x.author === n); return p ? PART_WORDS[p.state] : `${todayPlural(byOther[n], 'item')}, no part yet`; };
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
${oNames.length ? `<div class="rvn-rs rvn-s2"><b>Other parts</b><span>${oNames.length}</span></div>${oNames.map(n => `<div class="rvn-kv"><span>${escapeHtml(n)}</span><span>${escapeHtml(oWords(n))}</span></div>`).join('')}<p class="rvn-rnote">${ch === 'whatsapp' ? 'Each person writes their own part and sends it in the group.' : 'Each person writes their own part. The parts go to the client together, as one email.'}</p>` : ''}
<p class="rvn-rnote">Only work with Email on goes in the draft. Internal work stays in the log and in Past Improvements.</p>
</aside>`;
  // The main step, under it all.
  const env = icon('envelope-simple');
  let foot;
  if(editingDraft) foot = `<span class="rvn-ft-note">Save first, then send</span><span class="rvn-sp"></span><button class="btn btn-p rvn-main" disabled>${icon('paper-plane-tilt')}Send for Review</button>`;
  else if(x.st === 'write') foot = `<span class="rvn-ft-note">${icon('sparkle')}Written from the ${todayPlural(x.email.length, 'item')} with Email on</span><span class="rvn-sp"></span><button class="btn btn-p rvn-main" onclick="generateDraft(${A})">${icon('sparkle')}Write Draft</button>`;
  else if(x.st === 'next') foot = `<span class="rvn-ft-note">${icon('clock')}You can write it once the update ${x.held && x.held.draftStatus === 'approved' ? 'that’s approved' : 'in review'} is sent.</span><span class="rvn-sp"></span><button class="btn btn-p rvn-main" disabled title="Once the update in review is sent">${icon('sparkle')}Write Draft</button>`;
  else if(x.st === 'missed') foot = `<span class="rvn-ft-note">Add the work that never went out to the next update, or leave it out.</span><span class="rvn-sp"></span>`;
  else if(x.st === 'internal') foot = `<span class="rvn-ft-note">${INTERNAL_ONLY_NOTE}.</span><span class="rvn-sp"></span><button class="btn btn-p rvn-main" disabled title="Switch Email on for something first">${icon('sparkle')}Write Draft</button>`;
  else if(x.st === 'empty') foot = x.email.length
    ? `<span class="rvn-ft-note">Rewrite it from what’s logged now to send it.</span><span class="rvn-sp"></span><button class="btn btn-p rvn-main" onclick="generateDraft(${A})">${icon('sparkle')}Rewrite Draft</button>`
    : `<span class="rvn-ft-note">Log this week’s work, then rewrite it to send it.</span><span class="rvn-sp"></span>`;
  else if(x.st === 'written') foot = `<span class="rvn-ft-note">${env}An approver reads it before it goes out</span><span class="rvn-sp"></span><button class="btn btn-p rvn-main" onclick="sendDraftForReview(${A})">${icon('paper-plane-tilt')}Send for Review</button>`;
  else if(x.st === 'review') foot = !queueHasReview()
    ? `<span class="rvn-ft-note">${icon('clock')}In Review, where it’s approved and sent</span><span class="rvn-sp"></span><button class="btn btn-p rvn-main" onclick="openReviewDraft(${A})">Open in Review</button>`
    : ch === 'whatsapp' && typeof reviewWaFootHtml === 'function' ? reviewWaFootHtml(c, d, 'waiting', A)
    : `<span class="rvn-ft-note">${icon('clock')}Waiting for an approver. You’ll get a notification when it’s sent.</span><span class="rvn-sp"></span>${quNudgeBtnHtml(c, d, 'review')}`;
  else if(x.st === 'sent') foot = ch === 'whatsapp' && typeof reviewWaFootHtml === 'function' ? reviewWaFootHtml(c, d, 'sent', A)
    : `<span class="rvn-ft-note">${icon('check-circle')}Sent ${escapeHtml(relDayLower(sentAt))} at ${escapeHtml(fmtTime(sentAt))}${c.email ? ' to ' + escapeHtml(c.email) : ''}${d.draftSentBy ? ' by ' + (d.draftSentBy === me ? 'you' : escapeHtml(d.draftSentBy)) : ''}</span><span class="rvn-sp"></span>${ch === 'both' ? `<button class="btn" onclick="copyWinText(${A})">${icon('copy')}Copy for WhatsApp</button>` : ''}`;
  else foot = ch === 'whatsapp' && typeof reviewWaFootHtml === 'function' ? reviewWaFootHtml(c, d, 'approved', A)
    : `<span class="rvn-ft-note">${icon('check-circle')}Approved. An approver sends it, and you’ll get a notification.</span><span class="rvn-sp"></span>${quNudgeBtnHtml(c, d, 'approved')}`;
  const doc = `<div class="rvn-doc">${head}${sentAt ? '' : work}${draft}</div>`;
  if(split) return { main: `<div class="rvn-top">${top}</div>
<div class="rvn-mail"><div class="rvn-cols is-one">${doc}</div></div>
<div class="rvn-ft">${foot}</div>`, rail };
  return `<div class="rvn-top">${top}</div>
<div class="rvn-mail"><div class="rvn-cols">${doc}${rail}</div></div>
<div class="rvn-ft">${foot}</div>`;
}

// Your work, in someone else's update that's in review: locked, and where new work goes.
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
// Only internal work of yours logged for a client (Nov 22): open it in the Queue with that work
// showing, to switch an item to Email. It stays there until you move on, like one you just switched.
function openQueueInternal(id){
  quResetEdits(); window._quKeep = id; window._queueSel = id; queueTab = 'todo';
  if(currentViewName !== 'queue') switchView('queue'); else renderMyQueue();
}
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
  window._quKeep = clientId;   // stays in view even if nothing's left for the email
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
  const { data, error } = await saveWorkText(impId, { text });   // with when (data.js)
  if(error || !(data && data.length)){ console.error('quSaveEdit failed', impId, error || 'no row changed'); showToast('error', 'Couldn’t save that', 'Try again in a moment.'); return; }
  imp.text = text;
  const ci = (typeof clientImprovements !== 'undefined' ? clientImprovements : []).find(i => i.id === impId); if(ci) ci.text = text;
  window._quEditImp = null;
  const cut = s => s.length > 60 ? s.slice(0, 60) + '…' : s;
  if(typeof logClientActivity === 'function') logClientActivity(clientId, 'improvement_edited', `${myName() || 'Someone'} changed an improvement — "${cut(old)}" → "${cut(text)}"`);
  quRefreshAll(clientId);
  // the draft (not sent for review yet) was written from the old words: say so
  const d = getDraftFor(c, myName()), inIt = d && d.draft && !d.draftSentAt && (d.draftImprovementIds || []).includes(impId);
  showToast('success', 'Saved', inIt ? 'Your draft still has the old wording: it says so until you rewrite it.' : '');
}

// Work that never went out: add it to the next update (carry_over, addendum-flow-gaps.sql), or leave
// it out (out of the email, as internal work).
async function quCarry(clientId, impId){
  const { imp } = quFind(clientId, impId); if(!imp) return;
  const { data, error } = await supabaseClient.from('client_improvements').update({ carry_over: true }).eq('id', impId).select('id');
  if(error && workColumnMissing(error, 'carry_over')){ showToast('error', 'Needs a database update', 'Run addendum-flow-gaps.sql in Supabase, then try again.'); return; }
  if(error || !(data && data.length)){ showToast('error', 'Couldn’t add it', 'Try again in a moment.'); return; }
  imp.carryOver = true; const ci = clientImprovements.find(i => i.id === impId); if(ci) ci.carryOver = true;
  quRefreshAll(clientId); showToast('success', 'Added to the next update', '');
}
async function quLeaveOut(clientId, impId){
  const { imp } = quFind(clientId, impId); if(!imp) return;
  const { data, error } = await supabaseClient.from('client_improvements').update({ include_in_email: false }).eq('id', impId).select('id');
  if(error || !(data && data.length)){ showToast('error', 'Couldn’t save that', 'Try again in a moment.'); return; }
  imp.includeInEmail = false; const ci = clientImprovements.find(i => i.id === impId); if(ci) ci.includeInEmail = false;
  quRefreshAll(clientId); showToast('success', 'Left out', 'It stays in the log, out of the email.');
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
  const items = quItems();
  if(items) return quLogBatch(c, items);   // several lines, one time (Nov 25)
  // the time spent is required: every item logged here goes on the timesheet
  const timeRaw = (g('quTime')?.value || '').trim(), minutes = timeRaw ? parseSpent(timeRaw) : 0;
  if(!timeRaw){ showToast('error', 'Add the time spent', 'How long did it take? Try 0:30, 45m or 1h 30m.'); g('quTime')?.focus(); g('quTime')?.classList.add('is-need'); return; }
  if(!minutes){ showToast('error', 'Check the time', 'Try 0:30, 45m or 1h 30m.'); g('quTime')?.focus(); g('quTime')?.classList.add('is-need'); return; }
  const pick = minutes && g('quPick')?.innerHTML && typeof hvPickValue === 'function' ? hvPickValue('qu', clientId) : { ok: true, projectId: null, taskId: null };
  if(!pick.ok){ showToast('error', 'Almost there', pick.msg); return; }
  if(!(await okToLogDuplicate(clientId, text))) return;   // logged already? (data.js)
  if(minutes > 960 && !(await confirmDialog(`That’s ${hmLong(minutes)} for one improvement. Log it anyway?`, { confirmLabel: 'Log It', cancelLabel: 'Fix It' }))) return;
  const today = toDateStr(new Date()), dateStr = g('quDate')?.value || today;
  const when = dateStr === today ? new Date() : new Date(dateStr + 'T12:00:00');
  const service = typeof serviceFromHarvest === 'function' && serviceFromHarvest(c) ? (pick.projectId ? pick.service : improvementServiceFor(c)) : c.service || '';
  // its time already logged (here or in Harvest)? Use that, add it too, or log without (Nov 25)
  const tc = typeof workTimeCheck === 'function' ? await workTimeCheck({ clientId, dateStr, minutes, projectId: pick.projectId, taskId: pick.taskId, service: pick.projectId ? pick.service : service, text }) : { pick: 'add' };
  if(!tc) return;
  const author = myName() || 'Team member';
  if(ta) ta.disabled = true;
  const imp = typeof insertImprovementFull === 'function'
    ? await insertImprovementFull(clientId, { author, text, includeInEmail: true, source: 'manual', date: when.toISOString(), service })
    : await insertImprovementRow(clientId, { author, text, includeInEmail: true, source: 'manual', date: when.toISOString() });
  if(!imp){ if(ta) ta.disabled = false; showToast('error', 'Couldn’t log that', 'Try again in a moment.'); return; }
  // the time, on your timesheet for that day (and to Harvest for a Harvest client)
  let timeOk = true;
  if(minutes && tc.pick === 'use'){
    timeOk = await workTimeLink(tc.id, imp.id);
    if(typeof loadTimeEntries === 'function') await loadTimeEntries();
    if(typeof renderTimesheet === 'function') renderTimesheet();
  } else if(minutes && tc.pick === 'add'){
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
  const tmin = tc.pick === 'use' ? tc.minutes : tc.pick === 'add' ? minutes : 0;
  if(tmin && !timeOk) showToast('info', 'Logged, without the time', `The work is saved for ${c.name}, but the time didn’t ${tc.pick === 'use' ? 'link' : 'save'}. Add it on the Timesheet.`);
  else if(tc.pick === 'use') showToast('success', 'Logged, with the time already there', `${hmLong(tmin)}${dateStr === today ? '' : ' on ' + fmtShortDate(when)} is its time. Nothing new went to Harvest.`);
  else if(tc.pick === 'none') showToast('success', 'Logged', 'Without time: that time is already other work’s.');
  else if(minutes) showToast('success', 'Logged', `${hmLong(minutes)} on your timesheet${dateStr === today ? '' : ' for ' + fmtShortDate(when)}.`);
  const again = g('quNew'); if(again) again.focus();
}

// Several improvements with one time: the time is asked about and saved once, as one entry for all of
// them (notes: a few lines of what was done); lines already logged are named once.
async function quLogBatch(c, items){
  const g = id => document.getElementById(id), clientId = c.id, ta = g('quNew');
  const timeRaw = (g('quTime')?.value || '').trim(), minutes = timeRaw ? parseSpent(timeRaw) : 0;
  if(!timeRaw){ showToast('error', 'Add the time spent', `How long did these ${items.length} take, all together? Try 0:30, 45m or 1h 30m.`); g('quTime')?.focus(); g('quTime')?.classList.add('is-need'); return; }
  if(!minutes){ showToast('error', 'Check the time', 'Try 0:30, 45m or 1h 30m.'); g('quTime')?.focus(); g('quTime')?.classList.add('is-need'); return; }
  const pick = g('quPick')?.innerHTML && typeof hvPickValue === 'function' ? hvPickValue('qu', clientId) : { ok: true, projectId: null, taskId: null };
  if(!pick.ok){ showToast('error', 'Almost there', pick.msg); return; }
  if(minutes > 960 && !(await confirmDialog(`That’s ${hmLong(minutes)} for these ${items.length} improvements. Log it anyway?`, { confirmLabel: 'Log It', cancelLabel: 'Fix It' }))) return;
  const list = await workDupsAsk(clientId, items);
  if(!list) return;
  if(!list.length){ showToast('info', 'Nothing logged', 'Those were all logged already.'); return; }
  const today = toDateStr(new Date()), dateStr = g('quDate')?.value || today;
  const when = dateStr === today ? new Date() : new Date(dateStr + 'T12:00:00');
  const service = typeof serviceFromHarvest === 'function' && serviceFromHarvest(c) ? (pick.projectId ? pick.service : improvementServiceFor(c)) : c.service || '';
  const notes = workTimeNotes(list);
  const tc = await workTimeCheck({ clientId, dateStr, minutes, projectId: pick.projectId, taskId: pick.taskId, service: pick.projectId ? pick.service : service, text: notes });
  if(!tc) return;
  const author = myName() || 'Team member';
  if(ta) ta.disabled = true;
  const imps = [];
  for(const text of list){ const i = await insertImprovementFull(clientId, { author, text, includeInEmail: true, source: 'manual', date: when.toISOString(), service }); if(i) imps.push(i); }
  if(!imps.length){ if(ta) ta.disabled = false; showToast('error', 'Couldn’t log those', 'Try again in a moment.'); return; }
  let timeOk = true, entryId = null;
  if(tc.pick === 'use'){ timeOk = await workTimeLink(tc.id, imps[0].id); entryId = timeOk ? tc.id : null; }
  else if(tc.pick === 'add'){
    const r = await mergeOrInsertTimeEntry({ clientId, service: pick.projectId ? pick.service : service, dateStr, minutes, description: notes, projectId: pick.projectId, taskId: pick.taskId, improvementId: imps[0].id });
    if(r.error) timeOk = false;
    else { entryId = r.entryId; if(!r.merged && r.entryId) await supabaseClient.from('time_entries').update({ logged: true }).eq('id', r.entryId); syncEntryToHarvestBackground(r.entryId); }
  }
  if(entryId) await workLinkBatch(imps, entryId);
  if(typeof loadTimeEntries === 'function') await loadTimeEntries();
  if(typeof renderTimesheet === 'function') renderTimesheet();
  if(ta){ ta.value = ''; ta.disabled = false; ta.style.height = ''; }
  const tm = g('quTime'); if(tm) tm.value = '';
  window._quForm = { id: clientId, date: dateStr, time: '' }; window._quAsOne = false;
  if(typeof logClientActivity === 'function') logClientActivity(clientId, 'improvement_logged', `${author} logged ${imps.length} improvements: ${imps.slice(0, 3).map(i => `"${i.text.length > 50 ? i.text.slice(0, 50) + '…' : i.text}"`).join(', ')}${imps.length > 3 ? ` and ${imps.length - 3} more` : ''}`);
  quRefreshAll(clientId);
  const tmin = tc.pick === 'use' ? tc.minutes : tc.pick === 'add' ? minutes : 0, lost = list.length - imps.length;
  if(lost) showToast('info', `${imps.length} of ${list.length} logged`, `${lost} didn’t save; log ${lost === 1 ? 'it' : 'them'} again.`);
  else if(tmin && !timeOk) showToast('info', `${imps.length} logged, without the time`, `The work is saved for ${c.name}, but the time didn’t ${tc.pick === 'use' ? 'link' : 'save'}. Add it on the Timesheet.`);
  else if(tc.pick === 'use') showToast('success', `${imps.length} improvements logged`, `With the ${hmLong(tmin)} already there as their time. Nothing new went to Harvest.`);
  else if(tc.pick === 'none') showToast('success', `${imps.length} improvements logged`, 'Without time: that time is already other work’s.');
  else showToast('success', `${imps.length} improvements logged`, `${hmLong(minutes)} on your timesheet${dateStr === today ? '' : ' for ' + fmtShortDate(when)}, one entry for all of them.`);
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


// ---- Remind the approvers (Nov 24) ------------------------------------------------------------------
// An update of yours waiting in Review (or approved, waiting to be sent): a message to the approvers
// from your own Slack, as you, and in their bell (js/features/nudge-sheet.js).
function quNudgeKey(c, d){ return `review:${c.id}:${d ? String(d.draftPendingSince || d.draftApprovedAt || d.author || '') : ''}`; }
function quNudgeApprovers(){
  return teamWithAccess('approve_updates');
}
function quNudgeBtnHtml(c, d, st){
  if(!d || !quNudgeApprovers().length || typeof nudgeSheet !== 'function') return '';
  (window._quNudgeD = window._quNudgeD || {})[c.id] = d;   // the update this is about, for the sheet
  const when = nudgeWhenWords(quNudgeKey(c, d), 'Reminded');
  return `${when ? `<span class="qu-nudged">${escapeHtml(when)}</span>` : ''}<button class="btn" onclick="quNudgeOpen('${c.id}','${st}')">${icon('paper-plane-tilt')}${when ? 'Remind Again…' : 'Remind Approvers…'}</button>`;
}
function quNudgeText(c, d, st){
  const name = shortClientName(c.name);
  if(st === 'approved') return `${name}’s weekly update is approved and waiting to be sent. Could you send it when you get a chance?`;
  const since = d && d.draftPendingSince ? new Date(d.draftPendingSince) : null;
  const days = since ? Math.floor((Date.now() - since) / 864e5) : 0;
  const when = since ? (toDateStr(since) === toDateStr(new Date()) ? fmtTime(since) : fmtDay(since)) : '';
  return `${name}’s weekly update has been waiting in Review${since ? ` since ${when}${days >= 2 ? ` (${days} days)` : ''}` : ''}. Could you take a look when you get a chance?`;
}
function quNudgeOpen(clientId, st){
  const c = clients.find(x => x.id === clientId); if(!c) return;
  const d = (window._quNudgeD || {})[c.id] || c, me = firstName(myName() || 'A teammate');
  nudgeSheet({ title: 'Remind Approvers', sub: `${c.name} · ${st === 'approved' ? 'approved, not sent yet' : 'your update in Review'}`,
    to: quNudgeApprovers(), pick: true, nobody: 'Nobody else on the team can approve updates.',
    text: quNudgeText(c, d, st), link: { view: 'teamqueue', id: c.id, label: 'Open it in Review' },
    notif: { type: 'review_nudge', title: `${me} asks you to check ${shortClientName(c.name)}’s update` },
    key: quNudgeKey(c, d), sentWord: 'Reminded', onSent: () => { if(typeof renderMyQueue === 'function') renderMyQueue(); } });
}
