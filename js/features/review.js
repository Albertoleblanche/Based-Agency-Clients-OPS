// Review: drafts waiting for approval, laid out like Mail — the list on the left (oldest
// first, with how long each has waited), the email on the right with the client's health
// beside it, and Approve & Send (⌘↩) on top. Exactly the canvas "Review" board.

let reviewTab = 'waiting';
function setReviewTab(t){ reviewTab = t; window._reviewSel = null; window._reviewEditing = null; renderTeamQueue(); } // a new tab starts at its first draft

function reviewItems(){
  const cyc = updateCycle(), me = myName(), out = { waiting: [], approved: [], sent: [] };
  attentionEligibleClients().forEach(c => (c.drafts || []).forEach(d => {
    if(d.draftSentAt){ if(new Date(d.draftSentAt) >= cyc.weekStart) out.sent.push({ c, d, at: d.draftSentAt }); }
    else if(d.draftStatus === 'approved') out.approved.push({ c, d, at: d.draftPendingSince });
    else if(d.draftStatus === 'pending' && d.draft && (d.readyToNotify || d.author === me)) out.waiting.push({ c, d, at: d.draftPendingSince });
  }));
  out.waiting.sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
  out.approved.sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
  out.sent.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
  return out;
}

function draftBodyHtml(text){
  const blocks = String(text || '').replace(/\r/g, '').split(/\n{2,}/);
  return blocks.map(b => {
    const lines = b.split('\n').filter(l => l.trim());
    if(lines.length && lines.every(l => /^\s*([-•*]|\d+\.)\s+/.test(l))) return '<ul>' + lines.map(l => `<li>${escapeHtml(l.replace(/^\s*([-•*]|\d+\.)\s+/, ''))}</li>`).join('') + '</ul>';
    return `<p>${lines.map(l => escapeHtml(l)).join('<br>')}</p>`;
  }).join('');
}

function renderTeamQueue(){
  const root = document.getElementById('reviewRoot');
  if(!root || typeof clients === 'undefined') return;
  const cyc = updateCycle(), items = reviewItems(), list = items[reviewTab];
  const key = x => x.c.id + '|' + x.d.author;
  const dueN = items.waiting.filter(x => needsUpdate(clientWeek(x.c))).length;
  const want = window._reviewSel ? window._reviewSel.clientId + '|' + window._reviewSel.author : null;
  let sel = list.find(x => key(x) === want);
  if(!sel && want){ for(const t of ['waiting', 'approved', 'sent']){ const f = items[t].find(x => key(x) === want); if(f){ reviewTab = t; return renderTeamQueue(); } } }
  sel = sel || list[0];
  if(sel) window._reviewSel = { clientId: sel.c.id, author: sel.d.author };
  const tabs = [['waiting', 'Waiting'], ['approved', 'Approved'], ['sent', 'Sent']].map(([k, t]) =>
    `<button class="${reviewTab === k ? 'on' : ''}" role="tab" aria-selected="${reviewTab === k}" onclick="setReviewTab('${k}')">${t} <span class="c">${items[k].length}</span></button>`).join('');
  const rows = list.map(x => {
    const h = clientHealth(x.c), on = x === sel;
    const mark = reviewTab === 'waiting' ? '<span class="ud" aria-label="Not opened yet"></span>' : '';
    const when = reviewTab === 'waiting' ? fmtWait(x.at || rNow()) : relDay(x.at || rNow());
    const w = clientWeek(x.c);
    const state = reviewTab === 'sent' ? dueTag(w) : (reviewTab === 'approved' ? tagHtml('purple', 'Approved', 'check') : '') + nextDueTag(w);
    return `<a class="msg${on ? ' sel' : ''}" href="#teamqueue" onclick="selectReview('${x.c.id}',${jsArg(x.d.author)});return false;"${on ? ' aria-current="true"' : ''}>${mark}
<div class="top">${monoHtml(x.c, 'sm')}<b>${escapeHtml(x.c.name)}</b><time>${when}</time></div>
<div class="tags">${avHtml(x.d.author)}${state}${h.level !== 'g' ? healthTag(h.level) : ''}</div>
<span class="pv">${escapeHtml(String(x.d.draft || '').replace(/\s+/g, ' ').slice(0, 120))}</span></a>`;
  }).join('') || `<div class="empty"><b>${reviewTab === 'waiting' ? 'Nothing waiting' : 'Nothing here'}</b>${reviewTab === 'waiting' ? 'Drafts appear here when they’re sent for review.' : ''}</div>`;
  root.innerHTML = `<section class="list" aria-label="Drafts">
<div class="list-h"><div class="seg" role="tablist" aria-label="Drafts">${tabs}</div><button class="ib" aria-label="Filter" title="Filter" style="margin-left:auto" onclick="switchView('approve')">${icon('funnel-simple')}</button></div>
${reviewTab === 'waiting' && dueN ? `<div class="rv-due">${icon('clock')}<span><b>${dueN}</b> due today or overdue · oldest first</span></div>` : ''}
<div style="padding:0 0 6px">${rows}</div></section>
<section class="detail" aria-label="Selected draft">${sel ? reviewDetailHtml(sel, cyc) : ''}</section>`;
  if(currentViewName === 'teamqueue') setToolbar(null, `${items.waiting.length} draft${items.waiting.length === 1 ? '' : 's'} waiting${dueN ? ` · ${dueN} due today or overdue` : ''}`);
  const badge = document.getElementById('navTeamPendingBadge');
  if(badge){ badge.textContent = items.waiting.length; badge.style.display = items.waiting.length ? '' : 'none'; }
}
function selectReview(clientId, author){ window._reviewSel = { clientId, author }; renderTeamQueue(); }

function reviewDetailHtml(x, cyc){
  const c = x.c, d = x.d, h = clientHealth(c), seq = weekHistory(c), ots = onTimeSummary(seq), w = clientWeek(c);
  const imps = (c.improvements || []).filter(i => (d.draftImprovementIds || []).includes(i.id) || (i.author === d.author && new Date(i.date) > w.since && !(d.draftImprovementIds || []).length));
  const editing = window._reviewEditing === c.id + '|' + d.author;
  const status = d.draftSentAt ? ['green', `Sent ${relDayLower(d.draftSentAt)}`] : d.draftStatus === 'approved' ? ['purple', 'Approved'] : ['blue', 'Draft ready for review'];
  const canAct = canApprove() && !d.draftSentAt;
  const actions = canAct ? (d.draftStatus === 'approved'
      ? `<button class="btn btn-p" onclick="sendApprovedDraft('${c.id}',${jsArg(d.author)})">${icon('paper-plane-tilt')}Send Now</button>`
      : `<button class="btn" onclick="toggleReviewEdit('${c.id}',${jsArg(d.author)})">${icon('pencil-simple')}${editing ? 'Done' : 'Edit'}</button>
<button class="btn" onclick="generateDraft('${c.id}',${jsArg(d.author)})">${icon('sparkle')}Rewrite</button>
<button class="btn" onclick="approveDraft('${c.id}',${jsArg(d.author)})" title="Approve now and send it later from Approved">Approve</button>
<button class="btn btn-p" onclick="approveAndSendOwnDraft('${c.id}',${jsArg(d.author)})" title="Approve and send now (⌘↩)">${icon('paper-plane-tilt')}Approve &amp; Send</button>`)
    : (!canApprove() && !d.readyToNotify && d.author === myName() ? `<button class="btn btn-p" onclick="sendDraftForReview('${c.id}',${jsArg(d.author)})">${icon('paper-plane-tilt')}Send for Review</button>` : '');
  const impRows = imps.map(i => `<div class="row sm"><span class="ok-ic">${icon('check-circle')}</span><div class="tx"><span class="t" style="font-weight:400">${escapeHtml(i.text)}</span><span class="s">${escapeHtml(c.service || '')} · ${fmtShortDate(new Date(i.date))}</span></div></div>`).join('');
  const when = d.draftPendingSince ? new Date(d.draftPendingSince) : null;
  return `<div class="doc">
<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:20px"><span class="st"><span class="dot ${status[0]}"></span>${status[1]}</span><span style="margin-left:auto"></span>${actions}</div>
<div class="doc-h">${monoHtml(c)}<div class="meta"><b>${escapeHtml(c.name)}</b><span>To ${escapeHtml(c.email || 'no email on file')}</span><span>Drafted by ${escapeHtml(d.author)}${imps.length ? ` from ${imps.length} improvement${imps.length === 1 ? '' : 's'}` : ''}</span></div>
${when ? `<div class="when">${relDay(when)}<br>${fmtTime(when)}</div>` : ''}</div>
<div class="rv-ctx">${hstateHtml(h.level)}<span style="display:inline-flex;align-items:center;gap:8px">${histDotsHtml(seq)}${ots.total ? `On time ${ots.onTime} of the last ${ots.total}` : ''}</span>
${!d.draftSentAt ? `<span style="margin-left:auto"${w.late ? ' class="t-red"' : ''}>${escapeHtml(w.dueText)}</span>` : ''}</div>
<h2 class="subject">Your weekly update — ${escapeHtml(updateRangeLabel(c))}</h2>
${editing ? `<textarea spellcheck="true" class="draft rv-edit" id="draft-${c.id}">${escapeHtml(d.draft || '')}</textarea>` : `<div class="body">${draftBodyHtml(d.draft)}</div>`}
${!c.email ? '<p class="t-red" style="font-size:12px">No client email on file — add one in All Clients to send.</p>' : ''}
${impRows ? `<div class="src-note">${icon('list-checks')}<span>Written from these improvements</span></div><div class="grp">${impRows}</div>` : ''}
</div>`;
}
function toggleReviewEdit(clientId, author){
  const k = clientId + '|' + author;
  if(window._reviewEditing === k){
    const ta = document.getElementById('draft-' + clientId);
    if(ta) saveDraftFor(clientId, author, { draft: ta.value }).then(() => { window._reviewEditing = null; renderTeamQueue(); });
    else { window._reviewEditing = null; renderTeamQueue(); }
  } else { window._reviewEditing = k; renderTeamQueue(); setTimeout(() => document.getElementById('draft-' + clientId)?.focus(), 30); }
}
// ⌘↩ approves and sends the draft you're reading.
document.addEventListener('keydown', e => {
  if(currentViewName !== 'teamqueue' || e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || !window._reviewSel || !canApprove()) return;
  e.preventDefault(); approveAndSendOwnDraft(window._reviewSel.clientId, window._reviewSel.author);
});
