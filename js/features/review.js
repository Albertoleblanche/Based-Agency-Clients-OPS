// Review: drafts waiting for approval, laid out like Mail — the list on the left (oldest
// first, with how long each has waited), the email on the right with the client's health
// beside it, and Approve & Send (⌘↩) on top. Exactly the canvas "Review" board.

let reviewTab = 'waiting';
function setReviewTab(t){ reviewTab = t; window._reviewSel = null; window._reviewEditing = null; renderTeamQueue(); } // a new tab starts at its first draft

function reviewItems(){
  const cyc = updateCycle(), me = myName(), out = { waiting: [], approved: [], sent: [] };
  const all = hasPermission('view_team_queue'); // approvers, admins, and anyone given "Sees everyone's drafts"
  attentionEligibleClients().forEach(c => (c.drafts || []).forEach(d => {
    if(!all && d.author !== me) return;
    if(d.draftSentAt){ if(new Date(d.draftSentAt) >= cyc.weekStart) out.sent.push({ c, d, at: d.draftSentAt }); }
    else if(d.draftStatus === 'approved') out.approved.push({ c, d, at: d.draftPendingSince });
    else if(d.draftStatus === 'pending' && d.draft && (d.author === me || d.readyToNotify) && !draftHasNoWork(c, d)) out.waiting.push({ c, d, at: d.draftPendingSince });
  }));
  out.waiting.sort((a, b) => focusFirst(a.c, b.c) || new Date(a.at || 0) - new Date(b.at || 0));
  out.approved.sort((a, b) => focusFirst(a.c, b.c) || new Date(a.at || 0) - new Date(b.at || 0));
  out.sent.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
  return out;
}

// The list's rows. A client whose update has parts from more than one person shows once, with all
// its parts (Nov 22): in Waiting while any part waits for a yes, in Approved once they're all approved,
// and in Sent as the one email they went out in. Approvers only; anyone else sees their own drafts.
// WhatsApp-only clients keep a row per part (each part is its own message in the group).
function reviewRows(items, tab){
  const list = items[tab], out = [], seen = new Set();
  if(!hasPermission('view_team_queue') || typeof clientParts !== 'function') return tab === 'sent' ? list.concat(reviewSkipRows()).sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0)) : list.slice();
  if(tab === 'sent'){
    list.forEach(x => {
      if(!partsByEmail(x.c)) return out.push(x);
      const t = new Date(x.d.draftSentAt).getTime(), same = list.filter(y => y.c.id === x.c.id && Math.abs(new Date(y.d.draftSentAt).getTime() - t) < 120000);
      const k = same.map(y => y.d.author).sort().join('|') + x.c.id;
      if(seen.has(k)) return; seen.add(k);
      out.push(same.length > 1 ? { c: x.c, d: same[0].d, group: true, parts: same.map(y => ({ d: y.d, author: y.d.author, state: 'sent' })), at: x.at } : x);
    });
    return out.concat(reviewSkipRows()).sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));   // and the weeks skipped (Nov 27)
  }
  list.forEach(x => {
    if(seen.has(x.c.id)) return;
    if(!hasParts(x.c)) return out.push(x);
    if(tab === 'approved' && items.waiting.some(y => y.c.id === x.c.id)) return;   // it's in Waiting
    seen.add(x.c.id);
    const ats = list.filter(y => y.c.id === x.c.id).map(y => y.at).filter(Boolean).sort((a, b) => new Date(a) - new Date(b));
    out.push({ c: x.c, d: x.d, group: true, parts: clientParts(x.c), at: ats[0] || x.at });
  });
  return out;
}
const reviewRowKey = x => x.c.id + '|' + (x.group ? '*' : x.d.author);
// Is this row the one in _reviewSel? A client's row matches any of its parts.
function reviewRowIs(x, sel){ return !!sel && x.c.id === sel.clientId && (x.group || sel.author === '*' || x.d.author === sel.author); }

function draftBodyHtml(text){
  const em = t => escapeHtml(t).replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>');   // **bold** reads as bold
  const blocks = String(text || '').replace(/\r/g, '').split(/\n{2,}/);
  return blocks.map(b => {
    const lines = b.split('\n').filter(l => l.trim());
    if(lines.length && lines.every(l => /^\s*([-•*]|\d+\.)\s+/.test(l))) return '<ul>' + lines.map(l => `<li>${em(l.replace(/^\s*([-•*]|\d+\.)\s+/, ''))}</li>`).join('') + '</ul>';
    return `<p>${lines.map(l => em(l)).join('<br>')}</p>`;
  }).join('');
}

// Drafts you've opened (Mail's unread dot): per draft, so a rewritten draft shows as new again.
function reviewSeenKey(x){ return x.c.id + '|' + x.d.author + '|' + (x.d.draftPendingSince || ''); }
function reviewSeen(){ try{ return JSON.parse(localStorage.getItem('bda_review_seen') || '{}'); }catch(e){ return {}; } }
function markReviewSeen(x){
  const s = reviewSeen(), k = reviewSeenKey(x);
  if(s[k]) return;
  s[k] = 1;
  const keys = Object.keys(s); if(keys.length > 300) keys.slice(0, keys.length - 300).forEach(k2 => delete s[k2]);
  try{ localStorage.setItem('bda_review_seen', JSON.stringify(s)); }catch(e){}
}

// As on the canvas board "Review — improved": the list (who wrote it, when it's due, how long it
// has waited), the email at an email's width with the client on top, what to check before
// sending on the right, and one button under the email where you finish reading.
function renderTeamQueue(){
  const root = document.getElementById('reviewRoot');
  if(!root || typeof clients === 'undefined') return;
  const items = reviewItems(), rowsOf = t => reviewRows(items, t), list = rowsOf(reviewTab);
  const key = reviewRowKey;
  const dueW = [...new Set(items.waiting.map(x => x.c))].map(c => clientWeek(c)).filter(needsUpdate);
  const dueN = dueW.length, lateN = dueW.filter(w => w.late).length;
  const want = window._reviewSel || null;
  let sel = list.find(x => reviewRowIs(x, want));
  if(!sel && want){ for(const t of ['waiting', 'approved', 'sent']){ if(t !== reviewTab && rowsOf(t).some(x => reviewRowIs(x, want))){ reviewTab = t; return renderTeamQueue(); } } }
  sel = sel || list[0];
  if(sel){ window._reviewSel = { clientId: sel.c.id, author: sel.group ? '*' : sel.d.author }; if(reviewTab === 'waiting' && !sel.skip) (sel.group ? sel.parts : [sel]).forEach(p => markReviewSeen({ c: sel.c, d: p.d })); }
  const seen = reviewSeen();
  const tabs = [['waiting', 'Waiting'], ['approved', 'Approved'], ['sent', 'Sent']].map(([k, t]) =>
    `<button class="${reviewTab === k ? 'on' : ''}" role="tab" aria-selected="${reviewTab === k}" onclick="setReviewTab('${k}')">${t} <span class="c">${rowsOf(k).length}</span></button>`).join('');
  const rows = list.map(x => {
    if(x.skip) return reviewSkipRowHtml(x, x === sel);
    if(x.group) return reviewGroupRowHtml(x, x === sel, seen);
    const on = x === sel, w = clientWeek(x.c), h = clientHealth(x.c);
    const unread = reviewTab === 'waiting' && !seen[reviewSeenKey(x)] ? '<span class="rvn-dot" aria-label="Not opened yet"></span>' : '';
    const [due, kind] = reviewTab === 'sent' ? ['Sent ' + relDay(x.at || rNow()).replace(/^Today$/, 'today'), '']
      : [w.dueText, w.late ? 'is-late' : w.daysLeft === 0 ? 'is-soon' : ''];
    const when = reviewTab === 'sent' ? (x.at ? fmtTime(new Date(x.at)) : '') : x.at ? fmtWait(x.at) : '';
    const dl = reviewTab === 'sent' ? null : draftDelta(x.c, x.d), tier = winTier(x.d);
    const flag = dl && dl.gone ? `<span class="rvn-note is-red">${dl.allGone ? 'Work deleted' : `${dl.gone} deleted`}</span>`
      : dl && dl.edited.length ? `<span class="rvn-note">${dl.edited.length} edited</span>`
      : dl && dl.added.length ? `<span class="rvn-note">${dl.added.length} new since draft</span>`
      : tier ? tierTag(tier) : h.level !== 'g' ? `<span class="rvn-hl ${h.level}"><i></i>${escapeHtml(healthWord(h.level))}</span>` : '';
    // Approved: who sends it (WhatsApp wins go back to whoever wrote them; copying one claims it)
    const line = reviewTab === 'approved' ? escapeHtml(reviewSendWords(x.c, x.d))
      : `${x.d.author === myName() ? '' : escapeHtml(firstName(x.d.author)) + ' · '}<span class="rvn-due ${kind}">${escapeHtml(due)}</span>`;
    return `<a class="rvn-r${on ? ' is-sel' : ''}" href="#teamqueue" onclick="selectReview('${x.c.id}',${jsArg(x.d.author)});return false;"${on ? ' aria-current="true"' : ''}>${unread}${monoHtml(x.c, 'sm')}
<div class="tx"><b>${escapeHtml(x.c.name)}${focusMark(x.c)}</b><span class="s wn-rs">${chGlyph(x.c)}<span>${line}</span></span></div>
<div class="rvn-rr">${reviewTab === 'approved' ? '' : when ? `<time>${escapeHtml(when)}</time>` : ''}${flag}</div></a>`;
  }).join('') || `<div class="rvn-empty"><b>${reviewTab === 'waiting' ? 'Nothing waiting' : reviewTab === 'approved' ? 'Nothing approved and unsent' : 'Nothing sent this week'}</b>${reviewTab === 'waiting' ? 'Drafts show up here when they’re sent for review.' : ''}</div>`;
  const sortNote = reviewTab === 'waiting' && !canApproveUpdates() ? 'Yours · oldest first' : reviewTab === 'waiting' ? `Oldest first${dueN ? ` · ${lateN ? `${lateN} late` + (dueN > lateN ? `, ${dueN - lateN} due today` : '') : `${dueN} due today`}` : ''}`
    : reviewTab === 'approved' ? (list.some(x => winViaWhatsapp(x.c)) ? 'Not sent yet · whoever copies a win sends it' : 'Approved, not sent yet') : 'Sent this week · newest first';
  const prevRead = root.querySelector('.rvn-mail')?.scrollTop || 0, prevKey = root.dataset.sel || '';
  root.innerHTML = `<div class="rvn">
<section class="rvn-list" aria-label="Drafts">
<div class="rvn-lh"><div class="seg" role="tablist" aria-label="Drafts">${tabs}</div></div>
<p class="rvn-sort">${sortNote}</p>
<div class="rvn-rows">${rows}</div>
${list.length > 1 ? `<p class="rvn-keys"><span><kbd>J</kbd><kbd>K</kbd> next and previous</span>${canApproveUpdates() && reviewTab === 'waiting' ? '<span><kbd>⌘</kbd><kbd>↩</kbd> approve &amp; send</span>' : ''}</p>` : ''}
</section>
${(() => {
  // the new look: the letter and "Before you send" are two cards, as on the canvas
  const uw = typeof uiStyleOn === 'function' && uiStyleOn(), parts = sel ? (sel.skip ? reviewSkipHtml(sel, list, uw) : sel.group ? reviewPartsHtml(sel, list, uw) : reviewReadHtml(sel, list, uw)) : null;
  if(uw && parts) return `<section class="rvn-read" aria-label="Selected draft">${parts.main}</section>${parts.rail ? `<section class="rvn-railc">${parts.rail}</section>` : ''}`;
  return `<section class="rvn-read" aria-label="Selected draft">${sel ? parts : `<div class="rvn-none">${reviewEmptyHtml(items)}</div>`}</section>`;
})()}
</div>`;
  root.dataset.sel = sel ? key(sel) : '';
  if(sel && prevKey === key(sel)){ const m = root.querySelector('.rvn-mail'); if(m) m.scrollTop = prevRead; }
  const waitN = rowsOf('waiting').length;
  if(currentViewName === 'teamqueue') setToolbar(null, canApproveUpdates()
    ? `${waitN} win${waitN === 1 ? '' : 's'} waiting${dueN ? ` · ${lateN ? lateN + ' late' : dueN + ' due today'}` : ''}`
    : reviewMemberSub(items));
  const badge = document.getElementById('navTeamPendingBadge');
  if(badge){ const n = reviewBadgeCount(items); badge.textContent = n; badge.style.display = n ? '' : 'none'; }
}
// The sidebar count is what's on you. An approver: drafts waiting for a yes. Anyone else: their
// approved WhatsApp updates still to send, the one thing in Review a member acts on.
function reviewToSend(items){
  const me = myName();
  return (items || reviewItems()).approved.filter(x => x.d.author === me && winViaWhatsapp(x.c) && (st => st.k !== 'copied' || st.by === me)(winSendState(x.d)));
}
function reviewBadgeCount(items){
  items = items || reviewItems();
  return canApproveUpdates() ? reviewRows(items, 'waiting').length : reviewToSend(items).length;
}
// A member's subtitle: "1 to send on WhatsApp · 2 waiting for an approver"
function reviewMemberSub(items){
  const me = myName(), send = reviewToSend(items).length, waiting = items.waiting.filter(x => x.d.author === me && x.d.readyToNotify).length;
  return [send ? `${send} to send on WhatsApp` : '', waiting ? `${waiting} waiting for an approver` : ''].filter(Boolean).join(' · ') || 'Your updates, once they’re sent for review';
}
// "Maya copied it 2:22 PM" · "Bruno sends it, not copied yet" · "Email · you send it"
function reviewSendWords(c, d){
  const me = myName();
  if(!winViaWhatsapp(c)) return `Email · ${canApproveUpdates() ? 'you send it' : 'an approver sends it'}`;
  const st = winSendState(d);
  if(st.k === 'copied') return `${st.by === me ? 'You' : firstName(st.by)} copied it ${st.at ? fmtTime(new Date(st.at)) : ''}`.trim();
  return d.author === me ? 'You send it, not copied yet' : `${firstName(d.author)} sends it, not copied yet`;
}
function selectReview(clientId, author){
  if(window._reviewEditing && window._reviewEditing !== clientId + '|' + author && !(author === '*' && window._reviewEditing.startsWith(clientId + '|'))) window._reviewEditing = null;
  window._reviewSel = { clientId, author }; renderTeamQueue();
}
// The arrows above the email, and J / K.
function reviewStep(dir){
  const list = reviewRows(reviewItems(), reviewTab), cur = window._reviewSel;
  const i = list.findIndex(x => reviewRowIs(x, cur));
  const next = list[Math.min(list.length - 1, Math.max(0, (i < 0 ? 0 : i) + dir))];
  if(next && !reviewRowIs(next, cur)){
    selectReview(next.c.id, next.group ? '*' : next.d.author);
    document.querySelector('#reviewRoot .rvn-r.is-sel')?.scrollIntoView({ block: 'nearest' });
  }
}

// A draft against the work it was written from:
//   inc     what it was written from, still logged
//   gone    how many of those have since been deleted (the email may still mention them)
//   added   this person's work for the email that isn't in it (logged after it was written, or held
//           back); it goes in a rewrite, or into the next update if this one is sent as is
//   internal  work this update covers that stays out of client emails
// Each person's part is written from their own work, so added and internal are the writer's own
// (anyone else's is in their own part). edited: work in it changed after it was written (edited_at,
// addendum-flow-gaps.sql).
function draftDelta(c, d){
  const imps = c.improvements || [], ids = d.draftImprovementIds || [], w = clientWeek(c);
  const byId = new Map(imps.map(i => [i.id, i]));
  const inc = ids.length ? ids.map(id => byId.get(id)).filter(Boolean) : w.logged.filter(i => i.author === d.author && i.includeInEmail !== false);
  const gone = ids.length - (ids.length ? inc.length : 0), inSet = new Set(inc.map(i => i.id));
  const added = ids.length && !d.draftSentAt ? w.logged.filter(i => i.author === d.author && i.includeInEmail !== false && !inSet.has(i.id)) : [];
  const internal = d.draftSentAt ? [] : w.logged.filter(i => i.author === d.author && i.includeInEmail === false && !inSet.has(i.id));
  const written = d.draftPendingSince ? new Date(d.draftPendingSince) : null;
  const edited = d.draftSentAt || !written ? [] : inc.filter(i => i.editedAt && new Date(i.editedAt) > written);
  const byDate = (a, b) => new Date(a.date) - new Date(b.date);
  return { inc: inc.sort(byDate), gone, allGone: ids.length > 0 && !inc.length, added: added.sort(byDate), internal: internal.sort(byDate), edited: edited.sort(byDate) };
}
// Who may rewrite or edit a draft from Review: approvers while it waits; the writer until they
// send it for review.
function canReworkDraft(c, d){
  if(d.draftSentAt || d.draftStatus === 'approved') return false;
  if(canApproveUpdates()) return true;
  return d.author === myName() && !d.readyToNotify;
}

function reviewReadHtml(x, list, split){
  const c = x.c, d = x.d, h = clientHealth(c), w = clientWeek(c), seq = weekHistory(c), ots = onTimeSummary(seq);
  const k = c.id + '|' + d.author, editing = window._reviewEditing === k;
  const i = list.indexOf(x), approver = canApproveUpdates(), mine = d.author === myName();
  const tab = d.draftSentAt ? 'sent' : d.draftStatus === 'approved' ? 'approved' : 'waiting';
  const A = `'${c.id}',${jsArg(d.author)}`;
  const dl = draftDelta(c, d), rework = canReworkDraft(c, d);
  // Top: move through the list; Edit and Rewrite while it's waiting; the rest under "…".
  const nav = `<div class="rvn-nav"><button class="ib" aria-label="Previous draft" title="Previous (K)" onclick="reviewStep(-1)"${i <= 0 ? ' disabled' : ''}>${icon('chevron-up')}</button><button class="ib" aria-label="Next draft" title="Next (J)" onclick="reviewStep(1)"${i >= list.length - 1 ? ' disabled' : ''}>${icon('chevron-down')}</button><span>${i + 1} of ${list.length}</span></div>`;
  const more = `<button class="ib" aria-label="More" title="More" onclick="reviewMore(event,${A})">${icon('dots-three')}</button>`;
  const top = editing
    ? `${nav}<span class="rvn-editing">${icon('pencil-simple')}Editing ${mine ? 'your' : escapeHtml(firstName(d.author)) + '’s'} draft</span><span class="rvn-sp"></span><button class="btn" onclick="cancelReviewEdit()">Cancel</button><button class="btn btn-p" onclick="toggleReviewEdit(${A})">Save Changes</button>`
    : `${nav}<span class="rvn-sp"></span>${approver && !mine && tab !== 'sent' && typeof nudgeSheet === 'function' ? `<button class="btn rvn-q" onclick="askWriter(${A})" title="Ask ${escapeHtml(firstName(d.author))} about it, on Slack as you">${icon('message-circle')}Ask ${escapeHtml(firstName(d.author))}…</button>` : ''}${rework ? `<button class="btn rvn-q" onclick="toggleReviewEdit(${A})">${icon('pencil-simple')}Edit</button><button class="btn rvn-q" onclick="generateDraft(${A})">${icon('sparkle')}Rewrite</button>` : ''}${more}`;
  // The client, as the email's header.
  const to = clientContact(c), ch = winChannel(c), wa = ch === 'whatsapp';
  const drafted = tab === 'approved' && d.approvedBy ? ` · approved by ${d.approvedBy === myName() ? 'you' : escapeHtml(firstName(d.approvedBy))}${d.approvedAt ? ' at ' + escapeHtml(fmtTime(new Date(d.approvedAt))) : ''}`
    : d.draftPendingSince ? ` · ${fmtWait(d.draftPendingSince)} ago` : '';
  const toWords = wa ? `To the ${escapeHtml((winGroupFor(c) || {}).name || c.name)} group on WhatsApp` : `${to || c.email ? `To ${escapeHtml(to || c.email)}` : 'By email'}${ch === 'both' ? ' and their WhatsApp group' : ''}`;
  const head = `<div class="rvn-hd">${monoHtml(c, 'lg')}<div class="tx"><b>${escapeHtml(c.name)}${focusMark(c)}</b><span class="s">${toWords}</span><span class="s">Drafted by ${mine ? 'you' : escapeHtml(d.author)}${drafted}</span></div></div>`;
  // WhatsApp or email, it reads as the same letter
  const body = editing ? `<textarea spellcheck="true" class="rvn-edit" id="draft-${c.id}" aria-label="Draft">${escapeHtml(d.draft || '')}</textarea>`
    : `<div class="rvn-body">${draftBodyHtml(d.draft)}</div>`;
  // Before you send.
  const row = (it, kind) => `<div class="rvn-i${kind ? ' is-' + kind : ''}" title="${escapeHtml(it.text + ' · ' + (it.service || c.service || '') + ' · ' + fmtShortDate(new Date(it.date)))}">${icon(kind === 'out' ? 'minus-circle' : kind === 'new' ? 'circle-plus' : 'check-circle')}<span class="rvn-it">${escapeHtml(it.text)}</span><time>${escapeHtml(fmtShortDate(new Date(it.date)))}</time></div>`;
  const htag = `<span class="rvn-hl ${h.level}"><i></i>${escapeHtml(healthWord(h.level))}</span>`;
  const dueTxt = w.due ? w.due.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) : '';
  const rewriteBtn = rework ? `<button class="btn rvn-sm" onclick="generateDraft(${A})">${icon('sparkle')}Rewrite to Include</button>` : '';
  const goneNote = dl.gone ? `<div class="rvn-warn"><div><b>${dl.allGone ? 'The work this email was written from was deleted' : `${dl.gone} improvement${dl.gone === 1 ? '' : 's'} in this email ${dl.gone === 1 ? 'was' : 'were'} deleted`}</b><span>${rework ? (dl.allGone ? 'Rewrite it from what’s logged now.' : 'Rewrite it from what’s logged now, or edit it by hand.') : 'An approver can rewrite it from what’s logged now.'}</span>${rework ? `<button class="btn rvn-sm" onclick="generateDraft(${A})">${icon('sparkle')}Rewrite</button>` : ''}</div></div>` : '';
  const rail = `<aside class="rvn-rail" aria-label="${tab === 'sent' ? 'About this update' : 'Before you send'}">
${goneNote}${!dl.gone && dl.edited.length ? `<div class="rvn-warn"><div><b>${dl.edited.length === 1 ? 'An improvement in this email was' : `${dl.edited.length} improvements in this email were`} edited after it was written</b><span>${escapeHtml(dl.edited.map(i => `“${i.text.length > 70 ? i.text.slice(0, 70) + '…' : i.text}”`).join(', '))}. ${rework ? 'Rewrite it so it matches, or edit it by hand.' : 'Check the email still says the same.'}</span></div></div>` : ''}<div class="rvn-rs"><b>${tab === 'sent' ? 'About this update' : 'Before you send'}</b></div>
${reviewWinRowsHtml(c, d, tab)}
<div class="rvn-kv"><span>Health</span><span>${htag}</span></div>
${tab !== 'sent' && dueTxt ? `<div class="rvn-kv"><span>Due</span><span${w.late ? ' class="t-red"' : ''}>${escapeHtml(w.late ? w.dueText : dueTxt)}</span></div>` : ''}
<div class="rvn-kv"><span>Last 8 weeks</span><span class="rvn-hist">${histDotsHtml(seq)}${ots.total ? `<em>${ots.onTime} of ${ots.total} on time</em>` : ''}</span></div>
${dl.inc.length ? `<div class="rvn-rs rvn-s2"><b>In this update</b><span>${dl.inc.length}</span></div>${dl.inc.map(it => row(it, '')).join('')}` : ''}
${dl.added.length ? `<div class="rvn-rs rvn-s2"><b>Not in this draft yet</b><span>${dl.added.length}</span></div>${dl.added.map(it => row(it, 'new')).join('')}<p class="rvn-rnote">Logged after the draft was written${rework ? '. Rewrite to include them, or send as is and they go in the next update.' : tab === 'approved' ? '. They go in the next update.' : '. An approver can rewrite to include them; otherwise they go in the next update.'}</p>${rewriteBtn}` : ''}
${dl.internal.length ? `<div class="rvn-rs rvn-s2"><b>Left out</b><span>${dl.internal.length}</span></div>${dl.internal.map(it => row(it, 'out')).join('')}<p class="rvn-rnote">Internal work stays out of client emails.</p>` : ''}
</aside>`;
  // The decision, under the email.
  const env = `${icon('envelope-simple')}`;
  let foot;
  const empty = tab === 'waiting' && (dl.allGone || draftHasNoWork(c, d));
  const waFoot = wa && !editing && !empty ? reviewWaFootHtml(c, d, tab, A) : null;
  if(waFoot != null) foot = waFoot;
  else if((dl.allGone && tab !== 'sent') || empty){
    // nothing left in it: rewrite it from what's logged now (or discard it); it can't go to review or out
    const writer = mine && tab === 'waiting' && !approver;
    foot = `<span class="rvn-ft-note">${rework ? 'Rewrite it from what’s logged now to send it.' : approver ? 'Nothing to send yet: discard it, or log work and rewrite it.' : 'Log this week’s work, then rewrite it to send it.'}</span><span class="rvn-sp"></span>${approver ? `<button class="btn" onclick="skipDraft(${A})">Discard Draft</button>` : ''}${rework ? `<button class="btn" onclick="generateDraft(${A})">${icon('sparkle')}Rewrite</button>` : ''}<button class="btn btn-p rvn-main" disabled>${icon('paper-plane-tilt')}${tab === 'approved' ? 'Send Now' : writer ? 'Send for Review' : wa ? 'Approve' : 'Approve &amp; Send'}</button>`;
  }
  else if(!c.email && tab !== 'sent' && !wa) foot = `<span class="rvn-ft-note"><span>${approver ? `<a class="fix-lnk" href="#" onclick="openClientEmailField('${c.id}');return false;">Add the client’s email</a> to send it.` : 'An admin or approver adds the client’s email, then it can go out.'}</span></span><span class="rvn-sp"></span>`;
  else if(editing) foot = `<span class="rvn-ft-note">Save first, then send</span><span class="rvn-sp"></span><button class="btn btn-p rvn-main" disabled>${icon('paper-plane-tilt')}Approve &amp; Send</button>`;
  else if(tab === 'sent'){
    const by = d.draftSentBy ? (d.draftSentBy === myName() ? 'you' : d.draftSentBy) : '';
    foot = `<span class="rvn-ft-note">${icon('check-circle')}Sent ${escapeHtml(relDay(d.draftSentAt).replace(/^Today$/, 'today'))} at ${escapeHtml(fmtTime(new Date(d.draftSentAt)))} to ${escapeHtml(c.email || '')}${by ? ` by ${escapeHtml(by)}` : ''}</span><span class="rvn-sp"></span>${ch === 'both' ? `<button class="btn" onclick="copyWinText(${A})">${icon('copy')}Copy for WhatsApp</button>` : ''}`;
  }
  else if(approver) foot = `<span class="rvn-ft-note">${env}Goes to ${escapeHtml(c.email)}</span><span class="rvn-sp"></span>${tab === 'approved'
    ? `<button class="btn btn-p rvn-main" onclick="sendApprovedDraft(${A})">${icon('paper-plane-tilt')}Send Now</button>`
    : `<button class="btn btn-p rvn-main" onclick="approveAndSendOwnDraft(${A})" title="Approve and send now (⌘↩)">${icon('paper-plane-tilt')}Approve &amp; Send</button>`}`;
  else if(mine && !d.readyToNotify && tab === 'waiting') foot = `<span class="rvn-ft-note">${env}Goes to ${escapeHtml(c.email)} once it’s approved</span><span class="rvn-sp"></span><button class="btn btn-p rvn-main" onclick="sendDraftForReview(${A})">${icon('paper-plane-tilt')}Send for Review</button>`;
  else foot = `<span class="rvn-ft-note">${icon('clock')}${tab === 'approved' ? 'Approved. An approver sends it, and you’ll get a notification.' : 'Waiting for an approver. You’ll get a notification when it’s sent.'}</span><span class="rvn-sp"></span>`;
  const doc = `<div class="rvn-doc">${head}
<h2 class="rvn-subj">Your weekly update${tab === 'sent' ? '' : ' — ' + escapeHtml(updateRangeLabel(c))}</h2>
${body}</div>`;
  if(split) return { main: `<div class="rvn-top">${top}</div>
<div class="rvn-mail"><div class="rvn-cols is-one">${doc}</div></div>
<div class="rvn-ft">${foot}</div>`, rail };
  return `<div class="rvn-top">${top}</div>
<div class="rvn-mail"><div class="rvn-cols">${doc}${rail}</div></div>
<div class="rvn-ft">${foot}</div>`;
}
// ---- A client's update in parts (Nov 22) -----------------------------------------------------------
// Where each part stands, in the words the approver reads.
const PART_STATE_WORDS = { writing: 'Writing, not sent for review', review: 'Waiting for you', approved: 'Approved', sent: 'Sent' };
// The parts that go in this email: approved ones, ones sent for review, and an approver's own part
// (they don't send their own for review). Someone else's part still being written doesn't.
function partInMail(p){ return p.state === 'approved' || p.state === 'review' || p.state === 'sent' || (p.state === 'writing' && p.author === myName() && canApproveUpdates()); }
// People with work logged for this update's email and no part yet: their work waits for next time.
function partsMissing(c, parts){
  const by = {}; clientWeek(c).forEmail.forEach(i => { if(!parts.some(p => p.author === i.author)) by[i.author] = (by[i.author] || 0) + 1; });
  return Object.entries(by).map(([author, n]) => ({ author, n }));
}
function reviewGroupRowHtml(x, on, seen){
  const c = x.c, w = clientWeek(c), h = clientHealth(c), sent = reviewTab === 'sent';
  const unread = reviewTab === 'waiting' && x.parts.some(p => !seen[reviewSeenKey({ c, d: p.d })]) ? '<span class="rvn-dot" aria-label="Not opened yet"></span>' : '';
  const names = joinNames(x.parts.map(p => p.author === myName() ? 'You' : firstName(p.author)));
  const [due, kind] = sent ? ['Sent ' + relDay(x.at || rNow()).replace(/^Today$/, 'today'), ''] : [w.dueText, w.late ? 'is-late' : w.daysLeft === 0 ? 'is-soon' : ''];
  const when = sent ? (x.at ? fmtTime(new Date(x.at)) : '') : x.at ? fmtWait(x.at) : '';
  const ok = x.parts.filter(p => p.state === 'approved').length, inMail = x.parts.filter(partInMail).length;
  const bad = sent ? 0 : x.parts.reduce((n, p) => n + (p.state === 'sent' ? 0 : draftDelta(c, p.d).gone), 0);
  const flag = sent ? `<span class="rvn-note is-quiet">${x.parts.length} parts</span>`
    : bad ? `<span class="rvn-note is-red">${bad} deleted</span>`
    : `<span class="rvn-note">${ok === x.parts.length ? (ok === 2 ? 'Both approved' : 'All approved') : `${ok} of ${x.parts.length} approved`}</span>`;
  return `<a class="rvn-r${on ? ' is-sel' : ''}" href="#teamqueue" onclick="selectReview('${c.id}','*');return false;"${on ? ' aria-current="true"' : ''}>${unread}${monoHtml(c, 'sm')}
<div class="tx"><b>${escapeHtml(c.name)}${focusMark(c)}</b><span class="s wn-rs">${chGlyph(c)}<span>${escapeHtml(names)} · <span class="rvn-due ${kind}">${escapeHtml(due)}</span></span></span></div>
<div class="rvn-rr">${when ? `<time>${escapeHtml(when)}</time>` : ''}${flag}</div></a>`;
}
// The email the client gets, with each person's part marked in the margin: who wrote it, where it
// stands, and Approve / Edit / Rewrite for that part alone. Parts still being written, and work with
// no part yet, show where they'd go. One Approve & Send at the bottom sends the parts as one email.
function reviewPartsHtml(x, list, split){
  const c = x.c, me = myName(), approver = canApproveUpdates(), i = list.indexOf(x), tab = reviewTab;
  const h = clientHealth(c), w = clientWeek(c), seq = weekHistory(c), ots = onTimeSummary(seq);
  const parts = x.parts, inMail = parts.filter(partInMail), later = tab === 'sent' ? [] : parts.filter(p => !partInMail(p));
  const missing = tab === 'sent' ? [] : partsMissing(c, parts);
  const editKey = window._reviewEditing || '', editing = editKey.startsWith(c.id + '|') ? editKey.slice(c.id.length + 1) : '';
  const C = `'${c.id}'`, who = a => a === me ? 'You' : a;
  // Top: move through the list, and "…"
  const nav = `<div class="rvn-nav"><button class="ib" aria-label="Previous" title="Previous (K)" onclick="reviewStep(-1)"${i <= 0 ? ' disabled' : ''}>${icon('chevron-up')}</button><button class="ib" aria-label="Next" title="Next (J)" onclick="reviewStep(1)"${i >= list.length - 1 ? ' disabled' : ''}>${icon('chevron-down')}</button><span>${i + 1} of ${list.length}</span></div>`;
  const top = editing
    ? `${nav}<span class="rvn-editing">${icon('pencil-simple')}Editing ${editing === me ? 'your' : escapeHtml(firstName(editing)) + '’s'} part</span><span class="rvn-sp"></span><button class="btn" onclick="cancelReviewEdit()">Cancel</button><button class="btn btn-p" onclick="toggleReviewEdit(${C},${jsArg(editing)})">Save Changes</button>`
    : `${nav}<span class="rvn-sp"></span><button class="ib" aria-label="More" title="More" onclick="reviewPartsMore(event,${C})">${icon('dots-three')}</button>`;
  // The client, as the email's header
  const to = clientContact(c), ch = winChannel(c);
  const oldest = parts.map(p => p.d.draftPendingSince).filter(Boolean).sort()[0];
  const head = `<div class="rvn-hd">${monoHtml(c, 'lg')}<div class="tx"><b>${escapeHtml(c.name)}${focusMark(c)}</b><span class="s">${to || c.email ? `To ${escapeHtml(to || c.email)}` : 'By email'}${ch === 'both' ? ' and their WhatsApp group' : ''}</span><span class="s">${escapeHtml(capFirst(partNames(parts.map(p => p.author), me)))}, as one email${tab !== 'sent' && oldest ? ` · ${escapeHtml(fmtWait(oldest))} ago` : ''}</span></div></div>`;
  // The letter, part by part
  const { sections, closer } = partSections(inMail.map(p => p.d));
  const partBlock = p => {
    const sec = sections.find(s2 => s2.d === p.d), dl = p.state === 'sent' ? null : draftDelta(c, p.d), A = `${C},${jsArg(p.author)}`;
    const rework = p.state !== 'sent' && canReworkDraft(c, p.d), tier = winTier(p.d);
    const st = `<span class="rvp-st is-${p.state}">${p.state === 'approved' || p.state === 'sent' ? icon('check') : ''}${escapeHtml(p.author === me && p.state === 'writing' ? 'Your part' : PART_STATE_WORDS[p.state])}</span>`;
    const tierHtml = tab !== 'sent' && approver && winsDbReady() ? `<button class="pop wn-pop rvp-tier" onclick="winTierMenu(event,${A})" aria-label="Tier">${tier ? tierTag(tier) : '<span class="t-3">Tier</span>'}${icon('caret-down', { weight: 'bold' })}</button>` : tier ? tierTag(tier) : '';
    const note = dl && dl.gone ? `<span class="rvp-n is-red">${dl.allGone ? 'Its work was deleted' : `${dl.gone} deleted`}</span>` : dl && dl.edited.length ? `<span class="rvp-n">${dl.edited.length} edited since</span>` : dl && dl.added.length ? `<span class="rvp-n">${dl.added.length} new since</span>` : '';
    const acts = editing ? '' : [
      approver && p.author !== me && p.state !== 'sent' && typeof nudgeSheet === 'function' ? `<button class="btn rvp-b rvn-q" onclick="askWriter(${A})" title="Ask ${escapeHtml(firstName(p.author))} about it, on Slack as you">${icon('message-circle')}Ask ${escapeHtml(firstName(p.author))}…</button>` : '',
      approver && p.state !== 'approved' && p.state !== 'sent' ? `<button class="btn rvp-b" onclick="approvePart(${A})">${icon('check')}Approve</button>` : '',
      rework ? `<button class="btn rvp-b rvn-q" onclick="toggleReviewEdit(${A})">${icon('pencil-simple')}Edit</button><button class="btn rvp-b rvn-q" onclick="generateDraft(${A})">${icon('sparkle')}Rewrite</button>` : '',
    ].join('');
    const body = editing === p.author ? `<textarea spellcheck="true" class="rvn-edit rvp-edit" id="draft-${c.id}" aria-label="${escapeHtml(p.author)}’s part">${escapeHtml(p.d.draft || '')}</textarea><p class="rvp-hint">Its greeting and sign-off are left out when it goes with the other parts: the email keeps one of each.</p>`
      : `<div class="rvn-body rvp-body">${draftBodyHtml(sec ? sec.text : p.d.draft)}</div>`;
    return `<section class="rvp${editing && editing !== p.author ? ' is-dim' : ''}" aria-label="${escapeHtml(who(p.author))}’s part"><div class="rvp-h"><b>${escapeHtml(who(p.author))}</b>${st}${tierHtml}${note}<span class="rvn-sp"></span>${acts}</div>${body}</section>`;
  };
  const laterBlock = (author, words) => `<section class="rvp is-later" aria-label="${escapeHtml(author)}’s part"><div class="rvp-h"><b>${escapeHtml(author)}</b><span class="rvp-st is-writing">${escapeHtml(words)}</span><span class="rvn-sp"></span>${approver ? `<button class="btn rvp-b rvn-q" onclick="remindPart(${C},${jsArg(author)})">${icon('bell')}Remind</button>` : ''}</div></section>`;
  const letter = `<div class="rvp-mail">${inMail.map(partBlock).join('')}
${later.map(p => laterBlock(p.author, 'Writing their part, not sent for review')).join('')}${missing.map(m => laterBlock(m.author, `${todayPlural(m.n, 'item')} logged, no part yet`)).join('')}
${closer && !editing ? `<div class="rvn-body rvp-close">${draftBodyHtml(closer)}</div>` : ''}</div>`;
  // The rail: what to check before sending
  const row = it => `<div class="rvn-i" title="${escapeHtml(it.text + ' · ' + fmtShortDate(new Date(it.date)))}">${icon('check-circle')}<span class="rvn-it">${escapeHtml(it.text)}</span><time>${escapeHtml(fmtShortDate(new Date(it.date)))}</time></div>`;
  const warns = tab === 'sent' ? '' : inMail.map(p => { const dl = draftDelta(c, p.d);
    if(dl.gone) return `<div class="rvn-warn"><div><b>${escapeHtml(who(p.author))}${p.author === me ? 'r part' : '’s part'}: ${dl.allGone ? 'its work was deleted' : `${dl.gone} improvement${dl.gone === 1 ? ' was' : 's were'} deleted`}</b><span>Rewrite it from what’s logged now, or edit it by hand.</span></div></div>`;
    if(dl.edited.length) return `<div class="rvn-warn"><div><b>${escapeHtml(who(p.author))}${p.author === me ? 'r part' : '’s part'}: ${dl.edited.length === 1 ? 'an improvement was' : `${dl.edited.length} improvements were`} edited after it was written</b><span>${escapeHtml(dl.edited.map(it => `“${workCut(it.text, 70)}”`).join(', '))}. Rewrite it so it matches, or edit it by hand.</span></div></div>`;
    return ''; }).join('');
  const dueTxt = w.due ? w.due.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) : '';
  const items = tab === 'sent' ? [] : inMail.map(p => ({ p, inc: draftDelta(c, p.d).inc })).filter(g => g.inc.length);
  const chWords = { whatsapp: 'WhatsApp', email: 'Email', both: 'Both' }[ch], chIc = ch === 'both' ? 'layers' : 'envelope-simple';
  const rail = `<aside class="rvn-rail" aria-label="${tab === 'sent' ? 'About this update' : 'Before you send'}">
${warns}<div class="rvn-rs"><b>${tab === 'sent' ? 'About this update' : 'Before you send'}</b></div>
<div class="rvn-kv"><span>Sends by</span><span>${approver && tab !== 'sent' ? `<button class="pop wn-pop" onclick="winChannelMenu(event,'${c.id}')" aria-label="Sends by">${icon(chIc)}${chWords}${icon('caret-down', { weight: 'bold' })}</button>` : chWords}</span></div>
<div class="rvn-kv"><span>Health</span><span><span class="rvn-hl ${h.level}"><i></i>${escapeHtml(healthWord(h.level))}</span></span></div>
${tab !== 'sent' && dueTxt ? `<div class="rvn-kv"><span>Due</span><span${w.late ? ' class="t-red"' : ''}>${escapeHtml(w.late ? w.dueText : dueTxt)}</span></div>` : ''}
<div class="rvn-kv"><span>Last 8 weeks</span><span class="rvn-hist">${histDotsHtml(seq)}${ots.total ? `<em>${ots.onTime} of ${ots.total} on time</em>` : ''}</span></div>
<div class="rvn-rs rvn-s2"><b>Parts</b><span>${parts.length + missing.length}</span></div>
${parts.map(p => `<div class="rvn-kv"><span>${escapeHtml(who(p.author))}</span><span class="rvp-st is-${p.state}">${p.state === 'approved' || p.state === 'sent' ? icon('check') : ''}${escapeHtml(p.author === me && p.state === 'writing' ? 'Your part' : p.state === 'writing' ? 'Writing' : PART_STATE_WORDS[p.state])}</span></div>`).join('')}
${missing.map(m => `<div class="rvn-kv"><span>${escapeHtml(m.author)}</span><span class="t-3">No part yet</span></div>`).join('')}
${items.map(g => `<div class="rvn-rs rvn-s2"><b>${escapeHtml(who(g.p.author) === 'You' ? 'Your work' : firstName(g.p.author) + '’s work')}</b><span>${g.inc.length}</span></div>${g.inc.map(row).join('')}`).join('')}
${later.length || missing.length ? `<p class="rvn-rnote">${escapeHtml(joinNames([...later.map(p => firstName(p.author)), ...missing.map(m => firstName(m.author))]))}${later.length + missing.length === 1 ? '’s' : '’s'} work isn’t in this email. Send now and it goes in the next one, or remind them and wait.</p>` : ''}
</aside>`;
  // The decision, under the email
  const env = icon('envelope-simple'), toApprove = inMail.filter(p => p.state !== 'approved' && p.state !== 'sent');
  const blocked = inMail.some(p => p.state !== 'sent' && draftDelta(c, p.d).allGone);
  let foot;
  if(tab === 'sent'){
    const d0 = parts[0].d, by = d0.draftSentBy ? (d0.draftSentBy === me ? 'you' : d0.draftSentBy) : '';
    foot = `<span class="rvn-ft-note">${icon('check-circle')}Sent ${escapeHtml(relDay(d0.draftSentAt).replace(/^Today$/, 'today'))} at ${escapeHtml(fmtTime(new Date(d0.draftSentAt)))} to ${escapeHtml(c.email || '')}${by ? ` by ${escapeHtml(by)}` : ''}, ${escapeHtml(partNames(parts.map(p => p.author), me))} in one email</span><span class="rvn-sp"></span>`;
  }
  else if(!c.email) foot = `<span class="rvn-ft-note"><span>${approver ? `<a class="fix-lnk" href="#" onclick="openClientEmailField('${c.id}');return false;">Add the client’s email</a> to send it.` : 'An admin or approver adds the client’s email, then it can go out.'}</span></span><span class="rvn-sp"></span>`;
  else if(editing) foot = `<span class="rvn-ft-note">Save first, then send</span><span class="rvn-sp"></span><button class="btn btn-p rvn-main" disabled>${icon('paper-plane-tilt')}Approve &amp; Send</button>`;
  else if(!inMail.length) foot = `<span class="rvn-ft-note">${icon('clock')}Nothing to send yet: ${escapeHtml(joinNames(later.map(p => firstName(p.author))))} ${later.length === 1 ? 'hasn’t' : 'haven’t'} sent ${later.length === 1 ? 'their part' : 'their parts'} for review.</span><span class="rvn-sp"></span><button class="btn btn-p rvn-main" disabled>${icon('paper-plane-tilt')}Approve &amp; Send</button>`;
  else if(!approver) foot = `<span class="rvn-ft-note">${icon('clock')}Waiting for an approver. The parts go to ${escapeHtml(c.email)} as one email.</span><span class="rvn-sp"></span>`;
  else if(blocked) foot = `<span class="rvn-ft-note">A part’s work was all deleted: rewrite it or discard it, then send.</span><span class="rvn-sp"></span><button class="btn btn-p rvn-main" disabled>${icon('paper-plane-tilt')}Approve &amp; Send</button>`;
  else foot = `<span class="rvn-ft-note">${env}Sends ${escapeHtml(partNames(inMail.map(p => p.author), me))} to ${escapeHtml(c.email)} as one email</span><span class="rvn-sp"></span>`
    + (toApprove.length ? `<button class="btn btn-p rvn-main" onclick="approveAndSendParts(${C})" title="Approve ${toApprove.length === 1 ? 'it' : 'them'} and send now (⌘↩)">${icon('paper-plane-tilt')}Approve &amp; Send</button>`
      : `<button class="btn btn-p rvn-main" onclick="sendClientParts(${C})" title="Send now (⌘↩)">${icon('paper-plane-tilt')}Send Now</button>`);
  const doc = `<div class="rvn-doc">${head}
<h2 class="rvn-subj">Your weekly update${tab === 'sent' ? '' : ' — ' + escapeHtml(updateRangeLabel(c))}</h2>
${letter}</div>`;
  if(split) return { main: `<div class="rvn-top">${top}</div>
<div class="rvn-mail"><div class="rvn-cols is-one">${doc}</div></div>
<div class="rvn-ft">${foot}</div>`, rail };
  return `<div class="rvn-top">${top}</div>
<div class="rvn-mail"><div class="rvn-cols">${doc}${rail}</div></div>
<div class="rvn-ft">${foot}</div>`;
}
// "…" on a client's parts: approve them all to send later, open the client, copy the email.
function reviewPartsMore(e, clientId){
  e.stopPropagation();
  const had = document.getElementById('rvnMenu'); had?.remove();
  if(had) return;
  const c = clients.find(x => x.id === clientId); if(!c) return;
  const waiting = clientParts(c).some(p => p.state === 'review' || (p.state === 'writing' && p.author === myName()));
  const m = document.createElement('div');
  m.className = 'menu'; m.id = 'rvnMenu'; m.setAttribute('role', 'menu');
  Object.assign(m.style, { position: 'fixed', zIndex: '1200' });
  const r = e.currentTarget.getBoundingClientRect();
  m.style.top = (r.bottom + 4) + 'px'; m.style.right = (window.innerWidth - r.right) + 'px';
  const ap = canApproveUpdates() && reviewTab !== 'sent', anyApproved = clientParts(c).some(p => p.state === 'approved');
  m.innerHTML = `${waiting && ap ? `<button class="mi" role="menuitem" onclick="approveAllParts('${clientId}')">${icon('check-circle')}Approve All, Send Later</button>` : ''}${anyApproved && ap ? `<button class="mi" role="menuitem" onclick="reviewBackToWaiting('${clientId}')">${icon('undo-2')}Back to Waiting</button>` : ''}${ap ? `<button class="mi" role="menuitem" onclick="skipWeekSheet('${clientId}')">${icon('minus-circle')}Skip This Week…</button><div class="msep"></div>` : ''}
<button class="mi" role="menuitem" onclick="openClientDetail('${clientId}')">${icon('buildings')}Open Client Page</button>
<button class="mi" role="menuitem" onclick="reviewCopyParts('${clientId}')">${icon('clipboard-text')}Copy Text</button>`;
  document.body.appendChild(m);
  setTimeout(() => document.addEventListener('click', () => m.remove(), { once: true }), 0);
}
function reviewCopyParts(clientId){
  const c = clients.find(x => x.id === clientId); if(!c) return;
  const row = reviewRows(reviewItems(), reviewTab).find(x => x.group && x.c.id === clientId);
  const ds = (row ? row.parts.filter(partInMail) : clientParts(c)).map(p => p.d);
  navigator.clipboard?.writeText(`Your weekly update — ${updateRangeLabel(c)}\n\n${combineParts(ds)}`).then(() => showToast('success', 'Copied', 'The email is on your clipboard.'), () => {});
}
// Remind someone to send their part (or write one) for this client.
// Remind a teammate whose part isn't in yet: from your Slack, as you, and in their bell (Nov 24)
async function remindPart(clientId, author){
  const c = clients.find(x => x.id === clientId), p = profileByName(author);
  if(!c || !p){ showToast('info', 'Nobody to remind', `${author} isn’t on the team any more.`); return; }
  const d = getDraftFor(c, author), has = d && d.draft && !d.draftSentAt && d.draftStatus === 'pending', name = shortClientName(c.name);
  if(typeof nudgeSheet !== 'function'){
    await sendNotification(p.id, 'update_behind', `${c.name}: your part of this week’s update`, has ? 'Send your part for review, so it goes out with the others.' : 'Write your part from the work you logged, so it goes out with the others.', 'queue', c.id);
    showToast('success', `Reminded ${firstName(author)}`, 'In the app, and on Slack if they use it.'); return;
  }
  nudgeSheet({ title: `Remind ${firstName(author)}`, sub: `${c.name} · their part of this week’s update`, to: [p],
    text: has ? `your part of ${name}’s update is written but not sent for review yet. Can you send it, so it goes out with the others?`
      : `could you write your part of ${name}’s update from the work you logged? The rest can go out with it.`,
    link: { view: 'queue', id: c.id, label: 'Open your update in Radar' },
    notif: { type: 'update_behind', title: `${c.name}: your part of this week’s update` },
    key: `part:${c.id}:${author}`, sentWord: 'Reminded' });
}
// Ask a writer about their part before approving it, as you (Nov 24): on Slack and in their bell
function askWriter(clientId, author){
  const c = clients.find(x => x.id === clientId), p = profileByName(author);
  if(!c || !p){ showToast('info', 'Nobody to ask', `${author} isn’t on the team any more.`); return; }
  const name = shortClientName(c.name);
  nudgeSheet({ title: `Ask ${firstName(author)}`, sub: `${c.name} · their part of this week’s update`, to: [p],
    text: `I’m looking at your part of ${name}’s update in Review. `,
    link: { view: 'queue', id: c.id, label: 'Open your update in Radar' },
    notif: { type: 'review_question', title: `${firstName(myName() || 'An approver')} has a question about ${name}’s update` },
    key: `ask:${c.id}:${author}`, sendLabel: 'Send' });
}

// The win's rows in the rail: its tier, how the client gets it, the group, and who sends it.
function reviewWinRowsHtml(c, d, tab){
  const approver = canApproveUpdates(), me = myName(), ch = winChannel(c), A = `'${c.id}',${jsArg(d.author)}`, t = winTier(d);
  const rows = [];
  if(winsDbReady()) rows.push(`<div class="rvn-kv"><span>Win</span><span>${approver && tab !== 'sent'
    ? `<button class="pop wn-pop" onclick="winTierMenu(event,${A})" aria-label="Tier">${t ? tierTag(t, true) : '<span class="t-3">Pick a tier</span>'}${icon('caret-down', { weight: 'bold' })}</button>` : t ? tierTag(t, true) : '<span class="t-3">No tier</span>'}</span></div>`);
  const chWords = { whatsapp: 'WhatsApp', email: 'Email', both: 'Both' }[ch], chIc = ch === 'email' ? 'envelope-simple' : ch === 'both' ? 'layers' : 'message-circle';
  rows.push(`<div class="rvn-kv"><span>Sends by</span><span>${approver && tab !== 'sent'
    ? `<button class="pop wn-pop" onclick="winChannelMenu(event,'${c.id}')" aria-label="Sends by">${icon(chIc)}${chWords}${icon('caret-down', { weight: 'bold' })}</button>` : `${chWords}`}</span></div>`);
  if(ch !== 'email'){
    const g = winGroupFor(c);
    rows.push(`<div class="rvn-kv"><span>Group</span><span class="wn-g">${g ? escapeHtml(g.name) : `<span class="t-3">Not linked yet</span>${approver ? ` <a class="x-lnk" href="#" onclick="openClientInspectorFor('${c.id}');return false;">Link It</a>` : ''}`}</span></div>`);
  }
  if(ch === 'whatsapp' && tab !== 'sent'){
    const st = winSendState(d), who = n => n === me ? 'You' : n;
    const v = tab === 'waiting' ? `${who(d.author)}, once approved` : st.k === 'copied' ? `${who(st.by)} · copied ${st.at ? fmtTime(new Date(st.at)) : ''}` : `${who(d.author)} · not copied yet`;
    rows.push(`<div class="rvn-kv"><span>Sends it</span><span>${escapeHtml(v)}</span></div>`);
  }
  return rows.join('');
}
// Under a WhatsApp win: approving hands it back to whoever wrote it; once approved, copying it
// claims it, and anyone else is warned before sending it too.
function reviewWaFootHtml(c, d, tab, A){
  const me = myName(), approver = canApproveUpdates(), mine = d.author === me, first = firstName(d.author), wa = icon('message-circle');
  const auto = winsDbReady() && winGroupFor(c), group = winGroupFor(c) ? escapeHtml(winCleanGroupName(winGroupFor(c).name)) : 'the group';
  const note = (ic, html, cls) => `<span class="rvn-ft-note${cls ? ' ' + cls : ''}">${ic}<span>${html}</span></span><span class="rvn-sp"></span>`;
  if(tab === 'sent'){
    const by = d.draftSentBy ? (d.draftSentBy === me ? 'you' : escapeHtml(d.draftSentBy)) : '';
    return note(icon('check-circle'), `Sent in ${group} ${escapeHtml(relDayLower(new Date(d.draftSentAt)))} at ${escapeHtml(fmtTime(new Date(d.draftSentAt)))}${by ? ' by ' + by : ''}${d.waSeenAt ? ' · Radar saw it in the group' : ''}`);
  }
  if(tab === 'waiting'){
    if(approver && !mine) return note(wa, `Once you approve it, ${escapeHtml(first)} sends it in the group. Radar never posts there.`)
      + `<button class="btn btn-p rvn-main" onclick="approveWin(${A})" title="Approve (⌘↩)">${icon('check')}Approve</button>`;
    if(approver) return note(wa, `Goes in ${group} on WhatsApp. You paste it; Radar never posts there.`)
      + `<button class="btn btn-p rvn-main" onclick="approveAndCopyWin(${A})" title="Approve, and copy it formatted for WhatsApp (⌘↩)">${icon('copy')}Approve &amp; Copy</button>`;
    if(mine && !d.readyToNotify) return note(wa, 'Goes in their WhatsApp group once it’s approved. You send it.')
      + `<button class="btn btn-p rvn-main" onclick="sendDraftForReview(${A})">${icon('paper-plane-tilt')}Send for Review</button>`;
    return note(icon('clock'), 'Waiting for an approver. You’ll get a notification when it’s approved, then you send it.');
  }
  // approved, not sent
  const st = winSendState(d);
  if(st.k === 'copied' && st.by === me) return note(icon('copy'), `<b>Copied at ${escapeHtml(fmtTime(new Date(st.at)))}.</b> ${auto ? 'Radar marks it sent when it shows up in the group.' : 'Paste it in the group, then mark it sent.'}`, 'wn-claim')
    + `<button class="btn" onclick="copyWinForWhatsapp(${A})">${icon('copy')}Copy Again</button><button class="btn btn-p rvn-main" onclick="markWinSent(${A})">${icon('check')}Mark as Sent</button>`;
  if(st.k === 'copied') return note(icon('copy'), `<b>${escapeHtml(firstName(st.by))} copied it at ${escapeHtml(fmtTime(new Date(st.at)))}.</b> ${auto ? 'Radar marks it sent when it shows up in the group.' : 'They mark it sent once it’s in the group.'}`, 'wn-claim')
    + (approver ? `<button class="btn" onclick="markWinSent(${A})">Mark as Sent</button><button class="btn wn-mine" onclick="copyWinForWhatsapp(${A},false,this)">Send It Myself…</button>` : '');
  if(mine) return note(wa, `Approved. Copy it, paste it in ${group}${auto ? ', and Radar marks it sent when it sees it there' : ', then mark it sent'}.`)
    + `<button class="btn btn-p rvn-main" onclick="copyWinForWhatsapp(${A})">${icon('copy')}Copy for WhatsApp</button>`;
  return note(wa, `${escapeHtml(first)} sends it. Approved${d.approvedAt ? ' at ' + escapeHtml(fmtTime(new Date(d.approvedAt))) : ''}, not copied yet.`)
    + (approver ? `<button class="btn" onclick="copyWinForWhatsapp(${A},false,this)">${icon('copy')}Send It Myself</button>` : '');
}
// "…": approve now and send later, open the client, copy the text.
function reviewMore(e, clientId, author){
  e.stopPropagation();
  const had = document.getElementById('rvnMenu'); had?.remove();
  if(had) return;
  const c = clients.find(x => x.id === clientId), d = c && (c.drafts || []).find(x => x.author === author);
  if(!c || !d) return;
  const waiting = !d.draftSentAt && d.draftStatus !== 'approved', approved = !d.draftSentAt && d.draftStatus === 'approved', ap = canApproveUpdates();
  const m = document.createElement('div');
  m.className = 'menu'; m.id = 'rvnMenu'; m.setAttribute('role', 'menu');
  Object.assign(m.style, { position: 'fixed', zIndex: '1200' });
  const r = e.currentTarget.getBoundingClientRect();
  m.style.top = (r.bottom + 4) + 'px'; m.style.right = (window.innerWidth - r.right) + 'px';
  const A = `'${clientId}',${jsArg(author)}`;
  // Nov 27: Back to Waiting for an approved one, and Skip This Week… for either (approvers)
  m.innerHTML = `${waiting && ap ? `<button class="mi" role="menuitem" onclick="approveDraft(${A})">${icon('check-circle')}Approve, Send Later</button>` : ''}${approved && ap ? `<button class="mi" role="menuitem" onclick="reviewBackToWaiting('${clientId}')">${icon('undo-2')}Back to Waiting</button>` : ''}${(waiting || approved) && ap ? `<button class="mi" role="menuitem" onclick="skipWeekSheet('${clientId}')">${icon('minus-circle')}Skip This Week…</button><div class="msep"></div>` : ''}
<button class="mi" role="menuitem" onclick="openClientDetail('${clientId}')">${icon('buildings')}Open Client Page</button>
${winViaWhatsapp(c) && !waiting ? '' : `<button class="mi" role="menuitem" onclick="reviewCopy(${A})">${icon('clipboard-text')}Copy Text</button>`}`;
  document.body.appendChild(m);
  setTimeout(() => document.addEventListener('click', () => m.remove(), { once: true }), 0);
}
function reviewCopy(clientId, author){
  const c = clients.find(x => x.id === clientId), d = c && (c.drafts || []).find(x => x.author === author);
  if(!d) return;
  navigator.clipboard?.writeText(`Your weekly update — ${updateRangeLabel(c)}\n\n${d.draft || ''}`).then(() => showToast('success', 'Copied', 'The email is on your clipboard.'), () => {});
}
function cancelReviewEdit(){ window._reviewEditing = null; renderTeamQueue(); }
function toggleReviewEdit(clientId, author){
  const k = clientId + '|' + author;
  if(window._reviewEditing === k){
    const ta = document.getElementById('draft-' + clientId);
    if(ta) saveDraftFor(clientId, author, { draft: ta.value }).then(() => { window._reviewEditing = null; renderTeamQueue(); });
    else { window._reviewEditing = null; renderTeamQueue(); }
  } else { window._reviewEditing = k; renderTeamQueue(); setTimeout(() => { const ta = document.getElementById('draft-' + clientId); if(ta){ ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }, 30); }
}
// ⌘↩ approves and sends the draft you're reading.
// J / K move through the list (not while typing); Escape leaves editing.
document.addEventListener('keydown', e => {
  if(currentViewName !== 'teamqueue' || !window._reviewSel) return;
  if(document.querySelector('#appModalOverlay[style*="flex"], .cmdk-overlay[style*="block"]')) return;
  const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]');
  if(e.key === 'Enter' && (e.metaKey || e.ctrlKey)){
    if(!canApproveUpdates() || reviewTab !== 'waiting' || window._reviewEditing) return;
    e.preventDefault();
    if(window._reviewSel.author === '*') approveAndSendParts(window._reviewSel.clientId);
    else approveAndSendOwnDraft(window._reviewSel.clientId, window._reviewSel.author);
    return;
  }
  if(e.key === 'Escape' && window._reviewEditing){ e.preventDefault(); cancelReviewEdit(); return; }
  if(typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if(e.key === 'j' || e.key === 'J'){ e.preventDefault(); reviewStep(1); }
  else if(e.key === 'k' || e.key === 'K'){ e.preventDefault(); reviewStep(-1); }
});

// Nothing selected because there's nothing in this tab: say what comes here, and where it starts.
function reviewEmptyHtml(items){
  if(!activeClients().length) return emptyNoClients('Updates written for clients come here to be read and approved before they go out.');
  if(reviewTab === 'waiting' && !canApproveUpdates()) return emptyState({ icon: 'inbox', tone: 'ok', title: 'Nothing waiting',
    text: 'Your client updates show here once they’re written. Send one for review and an approver gets a notification; you get one when it’s approved or sent.',
    action: 'Open This Week', onAction: "switchView('approve')",
    link: items.approved.length ? `${items.approved.length} approved, not sent` : '', onLink: "setReviewTab('approved')" });
  if(reviewTab === 'waiting') return emptyState({ icon: 'inbox', tone: 'ok', title: 'Nothing to review',
    text: 'When a teammate sends a client update for review, it opens here so you can read it, edit it and approve it.',
    action: 'Open This Week', onAction: "switchView('approve')",
    link: items.approved.length ? `${items.approved.length} approved, not sent` : '', onLink: "setReviewTab('approved')" });
  if(reviewTab === 'approved') return emptyState({ icon: 'inbox', title: 'Nothing approved and unsent',
    text: 'Approved updates wait here until they go out.', link: items.waiting.length ? `Review the ${items.waiting.length} waiting` : '', onLink: "setReviewTab('waiting')" });
  return emptyState({ icon: 'send', title: 'Nothing sent this week', text: 'Updates sent to clients this week show here, newest first.',
    link: items.waiting.length ? `Review the ${items.waiting.length} waiting` : '', onLink: "setReviewTab('waiting')" });
}

// ---- Skip This Week… and Back to Waiting (Nov 27) ------------------------------------------------
// An admin or approver skips a client's update for the week from the "…" menu, waiting or approved:
// nothing is sent, every open part is cleared, and the work either waits for next week's update or is
// left out for good. Whoever's part or work it was, and whoever approved it, hear why. The week counts as
// skipped, not missed, and shows in Sent as skipped. Undo puts it all back. (update-parts.js skipUpdateWeek)
function skipWeekSheet(clientId){
  document.getElementById('rvnMenu')?.remove();
  const c = clients.find(x => x.id === clientId); if(!c || !canApproveUpdates()) return;
  const parts = weekOpenParts(c); if(!parts.length) return showToast('info', 'Nothing to skip', 'This week’s update has no part open.');
  const me = myName(), others = [...new Set(parts.map(d => d.author).filter(a => a !== me))];
  const what = parts.length > 1 ? partNames(parts.map(d => d.author), me) : parts[0].draftStatus === 'approved' ? 'the approved update' : parts[0].author === me ? 'your draft' : `${firstName(parts[0].author)}’s draft`;
  const tell = skipWeekPeople(c, parts, [...new Set(parts.flatMap(d => d.draftImprovementIds || []))]);
  openAppModal(`<h3 class="skw-h">Skip ${escapeHtml(c.name)}’s update this week?</h3>
<p class="skw-sub">Nothing goes to the client. ${escapeHtml(what.charAt(0).toUpperCase() + what.slice(1))} won’t be sent, and the week counts as skipped, not missed.</p>
<div class="skw-os" role="radiogroup" aria-label="The work in it">
<label class="skw-o"><input type="radio" name="skwKeep" value="1" checked><span class="skw-r" aria-hidden="true"></span><span class="tx"><b>Keep the work for next week’s update</b><span>It goes in the next draft, with whatever’s logged by then.</span></span></label>
<label class="skw-o"><input type="radio" name="skwKeep" value="0"><span class="skw-r" aria-hidden="true"></span><span class="tx"><b>Leave the work out for good</b><span>It stays logged, but never goes in an update.</span></span></label>
</div>
${tell.length ? `<label class="skw-why"><span>Tell ${escapeHtml(joinNames(tell.map(p => firstName(p.name))))} why <i>(optional)</i></span><textarea id="skwReason" class="tf" rows="2" maxlength="300" placeholder="They’re on vacation this week, say"></textarea></label>` : ''}
<div class="sheet-a"><button class="btn" onclick="closeAppModal()">Cancel</button><button class="btn btn-p" id="skwGo" onclick="skipWeekGo(${jsArg(c.id)})">Skip This Week</button></div>`, 520);
  setTimeout(() => document.querySelector('#appModalOverlay input[name="skwKeep"]')?.focus({ preventScroll: true }), 30);
}
async function skipWeekGo(clientId){
  const c = clients.find(x => x.id === clientId); if(!c) return;
  const keep = (document.querySelector('#appModalOverlay input[name="skwKeep"]:checked') || {}).value !== '0';
  const reason = (document.getElementById('skwReason')?.value || '').trim();
  const go = document.getElementById('skwGo'); if(go){ go.disabled = true; go.textContent = 'Skipping…'; }
  const r = await skipUpdateWeek(c, { keep, reason });
  if(r.error){ if(go){ go.disabled = false; go.textContent = 'Skip This Week'; } showToast('error', 'Not skipped', r.error); return; }
  closeAppModal();
  const me = myName() || 'Someone', names = joinNames(r.entry.authors.map(a => a === me ? 'your' : `${a}’s`));
  log.unshift({ t: nowTime(), tag: 'you', userId: currentUser?.id, text: `Skipped this week’s update for <b>${escapeHtml(c.name)}</b> — no email sent${keep ? '; the work goes in next week’s' : '; the work was left out'}.` });
  persistLog();
  logClientActivity(c.id, 'draft_skipped', `${me} skipped this week’s update (${names} ${r.entry.authors.length === 1 ? 'part' : 'parts'})${reason ? `: “${reason}”` : ''}. ${keep ? 'The work goes in next week’s.' : 'The work was left out.'}`);
  refreshClientDetailActivityIfOpen(c.id);
  const words = skipWeekWords(c, r);
  skipWeekPeople(c, r.parts, r.ids).forEach(p => sendNotification(p.id, 'draft_skipped', words.title, words.body, 'teamqueue', c.id));
  window._reviewSel = null;   // on to the next one, not to Sent
  renderQueue(); renderTeamQueue(); renderLog(); renderKpis();
  if(typeof renderThisWeek === 'function') renderThisWeek();
  showToast('info', 'Skipped', `${c.name}: nothing was sent. ${keep ? 'The work goes in next week’s update.' : 'The work was left out.'}`, { action: 'Undo', onAction: async () => {
    const ok = await r.undo();
    if(!ok){ showToast('error', 'Couldn’t undo', 'Try again in a moment.'); return; }
    logClientActivity(c.id, 'draft_skipped', `${me} took back skipping this week’s update.`);
    skipWeekPeople(c, r.parts, r.ids).forEach(p => sendNotification(p.id, 'draft_skipped', `${c.name}: the update wasn’t skipped after all`, `${me} undid skipping it. It’s back in Review.`, 'teamqueue', c.id));
    window._reviewSel = { clientId: c.id, author: r.parts.length > 1 && hasParts(c) ? '*' : r.parts[0].author };
    renderQueue(); renderTeamQueue(); renderKpis(); if(typeof renderThisWeek === 'function') renderThisWeek();
  } });
}
async function reviewBackToWaiting(clientId){
  document.getElementById('rvnMenu')?.remove();
  const c = clients.find(x => x.id === clientId); if(!c || !canApproveUpdates()) return;
  const r = await unapproveWeek(c);
  if(r.error) return showToast('error', 'Not moved', r.error);
  logClientActivity(c.id, 'draft_unapproved', `${myName() || 'Someone'} moved ${r.parts.length === 1 ? `${r.parts[0].author}’s update` : 'the update'} back to Waiting.`);
  refreshClientDetailActivityIfOpen(c.id);
  reviewTab = 'waiting'; window._reviewSel = { clientId: c.id, author: r.parts.length > 1 || hasParts(c) ? '*' : r.parts[0].author };
  renderQueue(); renderTeamQueue(); renderKpis(); if(typeof renderThisWeek === 'function') renderThisWeek();
  showToast('info', 'Back in Waiting', `${c.name}: approve it again when it’s ready, or skip it.`);
}
// Sent: the weeks skipped since the week began, as rows of their own
function reviewSkipRows(){
  const cyc = updateCycle(), me = myName(), all = hasPermission('view_team_queue');
  return attentionEligibleClients().flatMap(c => skipsOf(c).filter(x => x.t >= cyc.weekStart && (all || (x.authors || []).includes(me)))
    .map(x => ({ c, d: { author: 'skip:' + x.at, draftSentAt: x.at }, skip: x, at: x.at })));
}
function reviewSkipRowHtml(x, on){
  const s = x.skip, who = s.by === myName() ? 'You' : firstName(s.by || 'Someone');
  return `<a class="rvn-r is-skip${on ? ' is-sel' : ''}" href="#teamqueue" onclick="selectReview('${x.c.id}',${jsArg(x.d.author)});return false;"${on ? ' aria-current="true"' : ''}>${monoHtml(x.c, 'sm')}
<div class="tx"><b>${escapeHtml(x.c.name)}${focusMark(x.c)}</b><span class="s wn-rs"><span>${escapeHtml(who)} skipped it · ${escapeHtml(relDay(s.t).replace(/^Today$/, 'today'))}</span></span></div>
<div class="rvn-rr"><time>${escapeHtml(fmtTime(s.t))}</time><span class="rvn-note is-quiet">Skipped</span></div></a>`;
}
function reviewSkipHtml(x, list, split){
  const c = x.c, s = x.skip, w = clientWeek(c), i = list.indexOf(x), me = myName();
  const nav = `<div class="rvn-nav"><button class="ib" aria-label="Previous" title="Previous (K)" onclick="reviewStep(-1)"${i <= 0 ? ' disabled' : ''}>${icon('chevron-up')}</button><button class="ib" aria-label="Next" title="Next (J)" onclick="reviewStep(1)"${i >= list.length - 1 ? ' disabled' : ''}>${icon('chevron-down')}</button><span>${i + 1} of ${list.length}</span></div>`;
  const parts = (s.authors || []).map(a => a === me ? 'your' : `${firstName(a)}’s`);
  const doc = `<div class="rvn-doc">
<div class="rvn-hd">${monoHtml(c, 'lg')}<div class="tx"><b>${escapeHtml(c.name)}${focusMark(c)}</b><span class="s">Skipped by ${s.by === me ? 'you' : escapeHtml(s.by || 'someone')} ${escapeHtml(relDayLower(s.t))} at ${escapeHtml(fmtTime(s.t))}</span></div></div>
<div class="rvn-skip"><span class="rvn-skip-ic" aria-hidden="true">${icon('minus-circle')}</span><h2 class="rvn-subj">This week’s update was skipped</h2>
<p>Nothing was sent to ${escapeHtml(c.name)}${parts.length ? `, and ${escapeHtml(joinNames(parts))} ${parts.length === 1 ? 'part was' : 'parts were'} cleared` : ''}.</p>
<p>${s.keep === false ? 'The work in it was left out: it stays logged, but won’t go in an update.' : 'The work in it goes in next week’s update.'}</p>
${s.reason ? `<blockquote class="rvn-skip-why">${escapeHtml(s.reason)}</blockquote>` : ''}</div></div>`;
  const foot = `<span class="rvn-ft-note">${icon('clock')}Next update ${escapeHtml(w.dueText.replace(/^Due /, 'due ').replace(/^Due/, 'due'))}</span><span class="rvn-sp"></span><button class="btn" onclick="openClientDetail('${c.id}')">${icon('buildings')}Open Client Page</button>`;
  const top = `<div class="rvn-top">${nav}<span class="rvn-sp"></span></div>`;
  if(split) return { main: `${top}<div class="rvn-mail"><div class="rvn-cols is-one">${doc}</div></div><div class="rvn-ft">${foot}</div>`, rail: '' };
  return `${top}<div class="rvn-mail"><div class="rvn-cols">${doc}</div></div><div class="rvn-ft">${foot}</div>`;
}
