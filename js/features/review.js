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
    else if(d.draftStatus === 'pending' && d.draft && (d.author === me || (d.readyToNotify && !draftHasNoWork(c, d)))) out.waiting.push({ c, d, at: d.draftPendingSince });
  }));
  out.waiting.sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
  out.approved.sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
  out.sent.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
  return out;
}

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
  const items = reviewItems(), list = items[reviewTab];
  const key = x => x.c.id + '|' + x.d.author;
  const dueW = items.waiting.map(x => clientWeek(x.c)).filter(needsUpdate);
  const dueN = dueW.length, lateN = dueW.filter(w => w.late).length;
  const want = window._reviewSel ? window._reviewSel.clientId + '|' + window._reviewSel.author : null;
  let sel = list.find(x => key(x) === want);
  if(!sel && want){ for(const t of ['waiting', 'approved', 'sent']){ const f = items[t].find(x => key(x) === want); if(f){ reviewTab = t; return renderTeamQueue(); } } }
  sel = sel || list[0];
  if(sel){ window._reviewSel = { clientId: sel.c.id, author: sel.d.author }; if(reviewTab === 'waiting') markReviewSeen(sel); }
  const seen = reviewSeen();
  const tabs = [['waiting', 'Waiting'], ['approved', 'Approved'], ['sent', 'Sent']].map(([k, t]) =>
    `<button class="${reviewTab === k ? 'on' : ''}" role="tab" aria-selected="${reviewTab === k}" onclick="setReviewTab('${k}')">${t} <span class="c">${items[k].length}</span></button>`).join('');
  const rows = list.map(x => {
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
<div class="tx"><b>${escapeHtml(x.c.name)}</b><span class="s wn-rs">${chGlyph(x.c)}<span>${line}</span></span></div>
<div class="rvn-rr">${reviewTab === 'approved' ? '' : when ? `<time>${escapeHtml(when)}</time>` : ''}${flag}</div></a>`;
  }).join('') || `<div class="rvn-empty"><b>${reviewTab === 'waiting' ? 'Nothing waiting' : reviewTab === 'approved' ? 'Nothing approved and unsent' : 'Nothing sent this week'}</b>${reviewTab === 'waiting' ? 'Drafts show up here when they’re sent for review.' : ''}</div>`;
  const sortNote = reviewTab === 'waiting' && !canApprove() ? 'Yours · oldest first' : reviewTab === 'waiting' ? `Oldest first${dueN ? ` · ${lateN ? `${lateN} late` + (dueN > lateN ? `, ${dueN - lateN} due today` : '') : `${dueN} due today`}` : ''}`
    : reviewTab === 'approved' ? (list.some(x => winViaWhatsapp(x.c)) ? 'Not sent yet · whoever copies a win sends it' : 'Approved, not sent yet') : 'Sent this week · newest first';
  const prevRead = root.querySelector('.rvn-mail')?.scrollTop || 0, prevKey = root.dataset.sel || '';
  root.innerHTML = `<div class="rvn">
<section class="rvn-list" aria-label="Drafts">
<div class="rvn-lh"><div class="seg" role="tablist" aria-label="Drafts">${tabs}</div></div>
<p class="rvn-sort">${sortNote}</p>
<div class="rvn-rows">${rows}</div>
${list.length > 1 ? `<p class="rvn-keys"><span><kbd>J</kbd><kbd>K</kbd> next and previous</span>${canApprove() && reviewTab === 'waiting' ? '<span><kbd>⌘</kbd><kbd>↩</kbd> approve &amp; send</span>' : ''}</p>` : ''}
</section>
${(() => {
  // the new look (beta): the letter and "Before you send" are two cards, as on the canvas
  const uw = typeof uiStyleOn === 'function' && uiStyleOn(), parts = sel ? reviewReadHtml(sel, list, uw) : null;
  if(uw && parts) return `<section class="rvn-read" aria-label="Selected draft">${parts.main}</section><section class="rvn-railc">${parts.rail}</section>`;
  return `<section class="rvn-read" aria-label="Selected draft">${sel ? parts : `<div class="rvn-none">${reviewEmptyHtml(items)}</div>`}</section>`;
})()}
</div>`;
  root.dataset.sel = sel ? key(sel) : '';
  if(sel && prevKey === key(sel)){ const m = root.querySelector('.rvn-mail'); if(m) m.scrollTop = prevRead; }
  if(currentViewName === 'teamqueue') setToolbar(null, canApprove()
    ? `${items.waiting.length} win${items.waiting.length === 1 ? '' : 's'} waiting${dueN ? ` · ${lateN ? lateN + ' late' : dueN + ' due today'}` : ''}`
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
  return canApprove() ? items.waiting.length : reviewToSend(items).length;
}
// A member's subtitle: "1 to send on WhatsApp · 2 waiting for an approver"
function reviewMemberSub(items){
  const me = myName(), send = reviewToSend(items).length, waiting = items.waiting.filter(x => x.d.author === me && x.d.readyToNotify).length;
  return [send ? `${send} to send on WhatsApp` : '', waiting ? `${waiting} waiting for an approver` : ''].filter(Boolean).join(' · ') || 'Your updates, once they’re sent for review';
}
// "Maya copied it 2:22 PM" · "Bruno sends it, not copied yet" · "Email · you send it"
function reviewSendWords(c, d){
  const me = myName();
  if(!winViaWhatsapp(c)) return `Email · ${canApprove() ? 'you send it' : 'an approver sends it'}`;
  const st = winSendState(d);
  if(st.k === 'copied') return `${st.by === me ? 'You' : firstName(st.by)} copied it ${st.at ? fmtTime(new Date(st.at)) : ''}`.trim();
  return d.author === me ? 'You send it, not copied yet' : `${firstName(d.author)} sends it, not copied yet`;
}
function selectReview(clientId, author){
  if(window._reviewEditing && window._reviewEditing !== clientId + '|' + author) window._reviewEditing = null;
  window._reviewSel = { clientId, author }; renderTeamQueue();
}
// The arrows above the email, and J / K.
function reviewStep(dir){
  const list = reviewItems()[reviewTab], cur = window._reviewSel;
  const i = list.findIndex(x => cur && x.c.id === cur.clientId && x.d.author === cur.author);
  const next = list[Math.min(list.length - 1, Math.max(0, (i < 0 ? 0 : i) + dir))];
  if(next && (!cur || next.c.id !== cur.clientId || next.d.author !== cur.author)){
    selectReview(next.c.id, next.d.author);
    document.querySelector('#reviewRoot .rvn-r.is-sel')?.scrollIntoView({ block: 'nearest' });
  }
}

// A draft against the work it was written from:
//   inc     what it was written from, still logged
//   gone    how many of those have since been deleted (the email may still mention them)
//   added   this person's work for the email that isn't in it (logged after it was written, or held
//           back); it goes in a rewrite, or into the next update if this one is sent as is
//   internal  work this update covers that stays out of client emails
// One update per client (Nov 21): added and internal work count everyone's, not only the writer's
// (but not work already in someone else's live draft). edited: work in it changed after it was
// written (edited_at, addendum-flow-gaps.sql).
function draftDelta(c, d){
  const imps = c.improvements || [], ids = d.draftImprovementIds || [], w = clientWeek(c);
  const byId = new Map(imps.map(i => [i.id, i]));
  const inc = ids.length ? ids.map(id => byId.get(id)).filter(Boolean) : w.logged.filter(i => i.author === d.author && i.includeInEmail !== false);
  const gone = ids.length - (ids.length ? inc.length : 0), inSet = new Set(inc.map(i => i.id));
  const elsewhere = new Set((c.drafts || []).filter(x => x !== d && x.draft && !x.draftSentAt && x.draftStatus !== 'none').flatMap(x => x.draftImprovementIds || []));
  const free = i => !inSet.has(i.id) && !elsewhere.has(i.id);
  const added = ids.length && !d.draftSentAt ? w.logged.filter(i => i.includeInEmail !== false && free(i)) : [];
  const internal = d.draftSentAt ? [] : w.logged.filter(i => i.includeInEmail === false && free(i));
  const written = d.draftPendingSince ? new Date(d.draftPendingSince) : null;
  const edited = d.draftSentAt || !written ? [] : inc.filter(i => i.editedAt && new Date(i.editedAt) > written);
  const byDate = (a, b) => new Date(a.date) - new Date(b.date);
  return { inc: inc.sort(byDate), gone, allGone: ids.length > 0 && !inc.length, added: added.sort(byDate), internal: internal.sort(byDate), edited: edited.sort(byDate) };
}
// Who may rewrite or edit a draft from Review: approvers while it waits; the writer until they
// send it for review.
function canReworkDraft(c, d){
  if(d.draftSentAt || d.draftStatus === 'approved') return false;
  if(canApprove()) return true;
  return d.author === myName() && !d.readyToNotify;
}

function reviewReadHtml(x, list, split){
  const c = x.c, d = x.d, h = clientHealth(c), w = clientWeek(c), seq = weekHistory(c), ots = onTimeSummary(seq);
  const k = c.id + '|' + d.author, editing = window._reviewEditing === k;
  const i = list.indexOf(x), approver = canApprove(), mine = d.author === myName();
  const tab = d.draftSentAt ? 'sent' : d.draftStatus === 'approved' ? 'approved' : 'waiting';
  const A = `'${c.id}',${jsArg(d.author)}`;
  const dl = draftDelta(c, d), rework = canReworkDraft(c, d);
  // Top: move through the list; Edit and Rewrite while it's waiting; the rest under "…".
  const nav = `<div class="rvn-nav"><button class="ib" aria-label="Previous draft" title="Previous (K)" onclick="reviewStep(-1)"${i <= 0 ? ' disabled' : ''}>${icon('chevron-up')}</button><button class="ib" aria-label="Next draft" title="Next (J)" onclick="reviewStep(1)"${i >= list.length - 1 ? ' disabled' : ''}>${icon('chevron-down')}</button><span>${i + 1} of ${list.length}</span></div>`;
  const more = `<button class="ib" aria-label="More" title="More" onclick="reviewMore(event,${A})">${icon('dots-three')}</button>`;
  const top = editing
    ? `${nav}<span class="rvn-editing">${icon('pencil-simple')}Editing ${mine ? 'your' : escapeHtml(firstName(d.author)) + '’s'} draft</span><span class="rvn-sp"></span><button class="btn" onclick="cancelReviewEdit()">Cancel</button><button class="btn btn-p" onclick="toggleReviewEdit(${A})">Save Changes</button>`
    : `${nav}<span class="rvn-sp"></span>${rework ? `<button class="btn rvn-q" onclick="toggleReviewEdit(${A})">${icon('pencil-simple')}Edit</button><button class="btn rvn-q" onclick="generateDraft(${A})">${icon('sparkle')}Rewrite</button>` : ''}${more}`;
  // The client, as the email's header.
  const to = clientContact(c), ch = winChannel(c), wa = ch === 'whatsapp';
  const drafted = tab === 'approved' && d.approvedBy ? ` · approved by ${d.approvedBy === myName() ? 'you' : escapeHtml(firstName(d.approvedBy))}${d.approvedAt ? ' at ' + escapeHtml(fmtTime(new Date(d.approvedAt))) : ''}`
    : d.draftPendingSince ? ` · ${fmtWait(d.draftPendingSince)} ago` : '';
  const toWords = wa ? `To the ${escapeHtml((winGroupFor(c) || {}).name || c.name)} group on WhatsApp` : `${to || c.email ? `To ${escapeHtml(to || c.email)}` : 'By email'}${ch === 'both' ? ' and their WhatsApp group' : ''}`;
  const head = `<div class="rvn-hd">${monoHtml(c, 'lg')}<div class="tx"><b>${escapeHtml(c.name)}</b><span class="s">${toWords}</span><span class="s">Drafted by ${mine ? 'you' : escapeHtml(d.author)}${drafted}</span></div></div>`;
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
// The win's rows in the rail: its tier, how the client gets it, the group, and who sends it.
function reviewWinRowsHtml(c, d, tab){
  const approver = canApprove(), me = myName(), ch = winChannel(c), A = `'${c.id}',${jsArg(d.author)}`, t = winTier(d);
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
  const me = myName(), approver = canApprove(), mine = d.author === me, first = firstName(d.author), wa = icon('message-circle');
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
  const waiting = !d.draftSentAt && d.draftStatus !== 'approved';
  const m = document.createElement('div');
  m.className = 'menu'; m.id = 'rvnMenu'; m.setAttribute('role', 'menu');
  Object.assign(m.style, { position: 'fixed', zIndex: '1200' });
  const r = e.currentTarget.getBoundingClientRect();
  m.style.top = (r.bottom + 4) + 'px'; m.style.right = (window.innerWidth - r.right) + 'px';
  const A = `'${clientId}',${jsArg(author)}`;
  m.innerHTML = `${waiting && canApprove() ? `<button class="mi" role="menuitem" onclick="approveDraft(${A})">${icon('check-circle')}Approve, Send Later</button><div class="msep"></div>` : ''}
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
    if(!canApprove() || reviewTab !== 'waiting' || window._reviewEditing) return;
    e.preventDefault(); approveAndSendOwnDraft(window._reviewSel.clientId, window._reviewSel.author); return;
  }
  if(e.key === 'Escape' && window._reviewEditing){ e.preventDefault(); cancelReviewEdit(); return; }
  if(typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if(e.key === 'j' || e.key === 'J'){ e.preventDefault(); reviewStep(1); }
  else if(e.key === 'k' || e.key === 'K'){ e.preventDefault(); reviewStep(-1); }
});

// Nothing selected because there's nothing in this tab: say what comes here, and where it starts.
function reviewEmptyHtml(items){
  if(!activeClients().length) return emptyNoClients('Updates written for clients come here to be read and approved before they go out.');
  if(reviewTab === 'waiting' && !canApprove()) return emptyState({ icon: 'inbox', tone: 'ok', title: 'Nothing waiting',
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
