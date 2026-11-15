// Client detail page, send-to-Slack, editing improvements, and the
// per-client activity history.

// Sends a client's approved improvement draft directly to their own
// mapped Slack channel — bridged to their WhatsApp group on Slack's own
// side, so this is a real alternative delivery path to email, not a copy
// of it. Same review-before-sending pattern as the daily summary above.
function openSendToSlackConfirm(clientId, author){
  const c = clients.find(x=>x.id===clientId);
  const mapping = slackClientChannels[clientId];
  if(!c || !mapping){ showToast('error','No Slack channel mapped','Map this client to a channel in Settings first.'); return; }
  const d = getDraftFor(c, author);
  if(!d.draft){ showToast('error','Nothing to send',`${author} has no draft yet for this client.`); return; }
  openAppModal(`
    <div class="modal-head"><span class="panel-title">Send ${escapeHtml(author)}'s update to ${escapeHtml(c.name)}'s Slack channel?</span><span class="toast-close" onclick="closeAppModal()">✕</span></div>
    <div class="modal-body">
      <p style="font-size:11.5px;color:var(--muted-lt);margin:0 0 12px;">Posts to ${escapeHtml(mapping.channelName || mapping.channelId)} — review before sending, this posts immediately once confirmed.</p>
      <textarea spellcheck="true" id="slackClientMessageText" style="width:100%;min-height:220px;font-family:var(--font);font-size:12px;padding:10px;border-radius:8px;border:1px solid var(--border);white-space:pre-wrap;">${escapeHtml(d.draft)}</textarea>
    </div>
    <div class="modal-actions">
      <button class="btn btn-brand" id="sendSlackClientBtn" onclick="confirmSendToSlack('${clientId}')">Send to Slack</button>
      <button class="btn btn-outline" onclick="closeAppModal()">Cancel</button>
    </div>`, 560);
}

async function confirmSendToSlack(clientId){
  const text = document.getElementById('slackClientMessageText').value;
  const btn = document.getElementById('sendSlackClientBtn');
  setBtnLoading(btn, 'Sending…');
  try{
    const { data: { session } } = await supabaseClient.auth.getSession();
    const response = await fetch('/api/send-slack-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ action: 'client-message', clientId, text }),
    });
    const data = await response.json();
    restoreBtn(btn);
    if(!response.ok){ showToast('error','Send failed', data.error || 'Could not send to Slack.'); return; }
    closeAppModal();
    showToast('success','Sent to Slack','The update was posted to their channel.');
  }catch(e){
    restoreBtn(btn);
    showToast('error','Send failed','Network error — try again.');
  }
}

function refreshClientDetailActivityIfOpen(clientId){
  if(currentDetailClientId === clientId && document.getElementById('cdActivityHistory')){
    loadClientActivityHistory(clientId);
  }
}

async function openClientDetail(clientId){
  currentDetailClientId = clientId;
  // switchView() marks the view active synchronously, before its own
  // internal fullRefresh() chain (7 sequential network requests) even
  // starts — starting it without awaiting yet lets that synchronous part
  // run first, so the skeleton below paints into a view that's already
  // visible, instead of sitting queued behind the whole slow chain with
  // nothing shown in the meantime.
  const switchPromise = switchView('clientdetail');
  renderClientDetailSkeleton();
  await switchPromise;
  renderClientDetail();
  loadClientActivityHistory(clientId);
}

function openEditClientFormFromDetail(){
  if(currentDetailClientId) openEditClientForm(currentDetailClientId);
}

function openNoteModalFromDetail(){
  if(currentDetailClientId) openNoteModal(null, currentDetailClientId);
}

// Shown the instant you click into a client — before switchView's own
// fullRefresh() chain (loadAll, notes, time entries, tasks,
// notifications, calendar, reminders — all sequential, all real network
// round-trips) resolves. That chain runs on EVERY navigation, not just
// the first one, which is the actual reason this page could sit blank
// (or worse, still showing the PREVIOUS client's data) for a real,
// noticeable moment on every single click — clients being loaded or not
// was never the relevant signal for that; the elements just weren't
// being touched at all until the whole refresh finished.
function renderClientDetailSkeleton(){
  const metricsEl = document.getElementById('cdMetrics');
  if(!metricsEl) return;
  const titleEl = document.getElementById('topbarTitle');
  const subEl = document.getElementById('topbarSub');
  if(titleEl) titleEl.innerHTML = `<span class="skeleton-block" style="width:160px;height:16px;"></span>`;
  if(subEl) subEl.innerHTML = `<span class="skeleton-block" style="width:220px;height:11px;"></span>`;
  const skeletonCard = () => `<div class="metric-card"><div class="skeleton-block" style="width:70px;height:10px;margin-bottom:10px;"></div><div class="skeleton-block" style="width:50px;height:19px;"></div></div>`;
  metricsEl.innerHTML = Array.from({ length: 4 }).map(skeletonCard).join('');
  ['cdImprovements','cdDraftStatus','cdTimeEntries','cdNotes'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.innerHTML = `<div class="empty"><span class="spinner"></span>Loading…</div>`;
  });
}

function renderClientDetail(){
  // Only meaningful — and only safe — when this view is actually the one
  // currently showing. Unlike most other renderAll() functions, which
  // write into view-specific elements that are simply invisible
  // otherwise, this one writes into topbarTitle/topbarSub, which are
  // shared and reused by every single page. Running this unconditionally
  // would stomp over whatever title the page you're actually looking at
  // had legitimately set, every time renderAll() runs in the background.
  if(!document.getElementById('view-clientdetail')?.classList.contains('active')) return;
  const metricsEl = document.getElementById('cdMetrics');
  if(!metricsEl) return;
  const titleEl = document.getElementById('topbarTitle');
  const subEl = document.getElementById('topbarSub');
  if(!clientsDataLoaded){ renderClientDetailSkeleton(); return; }
  const c = clients.find(x=>x.id===currentDetailClientId);
  if(!c){
    if(titleEl) titleEl.textContent = 'Client not found';
    if(subEl) subEl.textContent = 'This client may have been removed.';
    ['cdMetrics','cdImprovements','cdDraftStatus','cdTimeEntries','cdNotes'].forEach(id=>{ const el=document.getElementById(id); if(el) el.innerHTML=''; });
    return;
  }

  if(titleEl) titleEl.textContent = c.name;
  const websiteLinkHtml = c.website ? `<a href="${safeUrl(c.website.startsWith('http')?c.website:'https://'+c.website)}" target="_blank" style="color:inherit;text-decoration:underline;">${escapeHtml(c.website.replace(/^https?:\/\//,''))}</a> · ` : '';
  if(subEl) subEl.innerHTML = `${c.email ? c.email+' · ' : ''}${websiteLinkHtml}${c.service} · ${riskCaptionHtml(c.danger)}`;

  const customFieldsPanel = document.getElementById('cdCustomFieldsPanel');
  const customFieldsEl = document.getElementById('cdCustomFields');
  if(customFieldsPanel && customFieldsEl){
    const fields = settings.customFields || [];
    const hasWebsite = !!c.website;
    // Always shown now — Service is always set on every client, so there's
    // always at least one row here, unlike before when this panel only
    // existed for optional website/custom-field data.
    customFieldsPanel.style.display = 'block';
    const values = c.customFieldValues || {};
    // Flex-based, not the reused .form-grid — that's an auto-fit CSS grid,
    // and SOW's grid-column:1/-1 span was forcing extra empty tracks to
    // stay alive next to Service/Website (auto-fit only collapses a track
    // that's empty in EVERY row, and SOW's spanning row touched all of
    // them), which is exactly the big dead gap in the screenshot. Flex-wrap
    // has no such artifact — compact fields sit side by side and wrap
    // naturally, full-width ones just break to their own line.
    const serviceHtml = `<div class="info-grid-item"><label class="info-grid-label">Service</label><div class="info-grid-value">${c.service ? escapeHtml(c.service) : '<span style="color:var(--muted-lt);">—</span>'}</div></div>`;
    const sowHtml = `<div class="info-grid-item info-grid-full"><label class="info-grid-label">SOW / Scope Notes</label><div class="info-grid-value" style="white-space:pre-wrap;">${c.sow ? escapeHtml(c.sow) : '<span style="color:var(--muted-lt);">—</span>'}</div></div>`;
    // Website gets its own real button (not a plain link like custom
    // URL-type fields below) — shown only when the client actually has
    // one set, since not every client does.
    const websiteHtml = hasWebsite ? `<div class="info-grid-item"><label class="info-grid-label">Website</label><div class="info-grid-value"><a href="${safeUrl(c.website.startsWith('http')?c.website:'https://'+c.website)}" target="_blank" rel="noopener" class="btn btn-outline" style="display:inline-flex;padding:7px 14px;min-height:auto;font-size:12px;text-decoration:none;">View website ↗</a></div></div>` : '';
    const fieldsHtml = fields.map(f=>{
      const val = values[f.id];
      return `<div class="info-grid-item"><label class="info-grid-label">${escapeHtml(f.label)}</label><div class="info-grid-value">${val ? (f.type==='url' ? `<a href="${val.startsWith('http')?val:'https://'+val}" target="_blank" style="color:var(--brand-dark);">${escapeHtml(val)}</a>` : escapeHtml(val)) : '<span style="color:var(--muted-lt);">—</span>'}</div></div>`;
    }).join('');
    customFieldsEl.innerHTML = `<div class="info-grid">${serviceHtml}${websiteHtml}${fieldsHtml}${sowHtml}</div>`;
  }

  const myTimeEntries = visibleTimeEntries().filter(e=>e.clientId===c.id).sort((a,b)=> new Date(b.date)-new Date(a.date) || new Date(b.createdAt)-new Date(a.createdAt));
  const timeLoggedTitleEl = document.getElementById('cdTimeLoggedTitle');
  if(timeLoggedTitleEl) timeLoggedTitleEl.textContent = isAdmin() ? 'Time Logged (Everyone)' : 'Time Logged (Yours)';
  const totalMinutes = myTimeEntries.reduce((s,e)=>s+e.minutes,0);
  const myNotesForClient = notes.filter(n=>n.clientId===c.id).sort((a,b)=> new Date(b.updatedAt||b.createdAt)-new Date(a.updatedAt||a.createdAt));
  const budget = monthBudgetInfo(c);
  const monthsActive = monthsActiveFor(c);

  document.getElementById('cdMetrics').innerHTML = `
    <div class="metric-card">
      <div class="metric-head"><span class="metric-icon metric-icon-blue"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span><span class="metric-label">Status</span></div>
      <div class="metric-value" style="font-size:19px;">${escapeHtml(c.status)}</div>
      <div class="metric-chips"><span class="pill ${statusPillClass(c.status)}">${escapeHtml(c.status)}</span></div>
    </div>
    <div class="metric-card">
      <div class="metric-head"><span class="metric-icon metric-icon-blue"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></span><span class="metric-label">Months Active</span></div>
      <div class="metric-value" style="font-size:19px;">${monthsActive===null ? '—' : monthsActive}</div>
      <div class="metric-caption">${monthsActive===null ? 'Set a start date to track this' : `Since ${new Date(c.startDate+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`}</div>
    </div>
    <div class="metric-card">
      <div class="metric-head"><span class="metric-icon metric-icon-purple"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg></span><span class="metric-label">Importance / Danger</span></div>
      <div class="metric-value" style="font-size:19px;">${c.importance}/10 · ${c.danger}/5</div>
      <div class="metric-chips">${riskCaptionHtml(c.danger)}</div>
    </div>
    <div class="metric-card">
      <div class="metric-head"><span class="metric-icon metric-icon-green"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span><span class="metric-label">Total Time Logged</span></div>
      <div class="metric-value">${formatMinutes(totalMinutes)}</div>
      <div class="metric-caption">${myTimeEntries.length} entr${myTimeEntries.length!==1?'ies':'y'}, all time</div>
    </div>
    <div class="metric-card">
      <div class="metric-head"><span class="metric-icon metric-icon-amber"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></span><span class="metric-label">Improvements</span></div>
      <div class="metric-value">${c.improvements.length}</div>
      <div class="metric-caption">Logged all time</div>
    </div>
    ${budget ? `
    <div class="metric-card">
      <div class="metric-head"><span class="metric-icon" style="background:${budgetTierMeta(budget.tier).pill==='pill-bad'?'var(--red-bg)':budget.tier==='warn'?'var(--amber-bg)':'var(--green-bg)'};color:${budgetTierMeta(budget.tier).color};"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span><span class="metric-label">Monthly Budget</span></div>
      <div class="metric-value" style="font-size:19px;">${(budget.usedMinutes/60).toFixed(1)}h <span style="color:var(--muted-lt);font-weight:400;font-size:14px;">of ${(budget.budgetMinutes/60).toFixed(1)}h</span></div>
      <div class="metric-chips"><span class="pill ${budgetTierMeta(budget.tier).pill}">${escapeHtml(budgetTierMeta(budget.tier).label)} · ${budget.pct}%</span></div>
    </div>` : ''}`;

  document.getElementById('cdImprovements').innerHTML = c.improvements.length
    ? [...c.improvements].reverse().map(imp=>`
      <div class="ts-entry-card" style="margin-bottom:8px;">
        <div class="ts-entry-info">
          <div class="ts-entry-title">${escapeHtml(imp.author)||'Team member'}</div>
          <div class="ts-entry-desc">${escapeHtml(imp.text)}</div>
        </div>
        <div class="ts-entry-right"><div class="ts-entry-duration" style="font-size:10.5px;color:var(--muted-lt);">${imp.date ? new Date(imp.date).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : ''}</div></div>
      </div>`).join('')
    : `<div class="empty">No improvements logged yet.</div>`;

  // A client can now have several independent drafts (one per author, see
  // addendum-25.sql) — shows each one that's actually in progress
  // separately, rather than assuming there's only ever one to display.
  const activeDrafts = (c.drafts||[]).filter(d => d.draftStatus !== 'none');
  document.getElementById('cdDraftStatus').innerHTML = (activeDrafts.length ? activeDrafts.map(d => {
    const status = statusMeta(c, d.author);
    return `<div style="margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--border);">
      <p style="font-size:13px;margin:0 0 6px;"><b>${escapeHtml(d.author)}</b> — Status: <b style="color:${status.color};">${escapeHtml(status.label)}</b></p>
      <div class="ts-entry-desc" style="white-space:pre-wrap;line-height:1.5;">${escapeHtml(d.draft)}</div>
    </div>`;
  }).join('') : `<div class="empty">No draft generated yet.</div>`)
    + `<button class="btn btn-outline" style="margin-top:12px;width:100%;justify-content:center;" onclick="goToClientInQueue('${c.id}','all')">Open in Approval Queue →</button>`;

  document.getElementById('cdTimeEntries').innerHTML = myTimeEntries.length
    ? myTimeEntries.slice(0,25).map(e=>{
      const person = teamProfiles.find(p=>p.id===e.userId);
      return `<div class="ts-entry-card" style="margin-bottom:8px;">
        <div class="ts-entry-info">
          <div class="ts-entry-title">${new Date(e.date+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})} ${e.service ? `<span class="ts-entry-service">(${escapeHtml(e.service)})</span>` : ''}</div>
          ${e.description ? `<div class="ts-entry-desc">${escapeHtml(e.description)}</div>` : ''}
          <div class="ts-entry-desc" style="margin-top:2px;color:var(--muted-lt);">Logged by ${person ? escapeHtml(person.name) : 'someone no longer on the team'}</div>
        </div>
        <div class="ts-entry-right"><div class="ts-entry-duration">${formatMinutes(e.minutes)}</div></div>
      </div>`;
    }).join('')
    : `<div class="empty">No time logged for this client yet.</div>`;

  document.getElementById('cdNotes').innerHTML = myNotesForClient.length
    ? myNotesForClient.map(n=>{
      const noteStatus = noteStatusMeta(n.status);
      return `<div class="note-card" style="margin-bottom:10px;">
        <div class="note-card-top">
          <div class="note-meta">${new Date(n.createdAt).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</div>
          <span class="pill ${noteStatus.cls}">${escapeHtml(noteStatus.label)}</span>
        </div>
        <div style="font-weight:700;font-size:13px;color:var(--ink);margin-bottom:3px;">${escapeHtml(n.title || 'Untitled note')}</div>
        <div class="note-text">${escapeHtml(n.text)}</div>
        ${n.link ? `<a href="${safeUrl(normalizeUrl(n.link))}" target="_blank" rel="noopener" class="note-link" onclick="event.stopPropagation();">🔗 ${truncateLinkDisplay(n.link, 40)}</a>` : ''}
        <div class="note-actions">
          ${n.status!=='done' ? `<button class="btn btn-brand" style="padding:7px 12px;font-size:11.5px;" onclick="logNoteNow('${n.id}')">Log it now</button>` : ''}
          <span class="row-link" onclick="openNoteModal('${n.id}')">Edit</span>
        </div>
      </div>`;
    }).join('')
    : `<div class="empty">No notes for this client yet. Notes are private to you.</div>`;

  const cdRemindersEl = document.getElementById('cdReminders');
  if(cdRemindersEl){
    const activeReminders = clientReminders
      .filter(r=>r.clientId===c.id && (r.status==='waiting'))
      .sort((a,b)=> (a.followUpDate||'').localeCompare(b.followUpDate||''));
    cdRemindersEl.innerHTML = activeReminders.length
      ? activeReminders.map(r=>{
        const display = reminderDisplayStatus(r);
        const meta = REMINDER_STATUS_META[display];
        const owner = teamProfiles.find(p=>p.id===r.askedBy);
        return `<div class="note-card" style="margin-bottom:10px;">
          <div class="note-card-top">
            <div class="note-meta">Asked ${new Date(r.askedDate+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})} by ${owner ? escapeHtml(owner.name) : '—'}</div>
            <span class="rating-pill" style="background:${meta.color}18;color:${meta.color};">${meta.icon} ${escapeHtml(meta.label)}</span>
          </div>
          <div class="note-text">${escapeHtml(r.question)}</div>
          <div class="note-actions">
            <span style="font-size:11px;color:var(--muted-lt);">Follow-up: ${reminderFollowUpLabel(r.followUpDate)}</span>
            <span class="row-link" onclick="markReminderStatus('${r.id}','answered')">Mark answered</span>
          </div>
        </div>`;
      }).join('')
      : `<div class="empty">Nothing pending from ${escapeHtml(c.name)}.</div>`;
  }
}

function startEditImprovement(clientId, idx){
  const c = clients.find(x=>x.id===clientId);
  if(!c || !c.improvements[idx]) return;
  const imp = c.improvements[idx];
  const row = document.getElementById(`imp-row-${clientId}-${idx}`);
  if(!row) return;
  row.innerHTML = `
    <div class="log-inline" style="margin-top:0;width:100%;">
      <textarea spellcheck="true" id="editimp-text-${clientId}-${idx}"></textarea>
      <input id="editimp-author-${clientId}-${idx}" style="width:130px;">
      <button class="btn btn-brand" onclick="saveEditImprovement('${clientId}', ${idx})">Save</button>
      <button class="btn btn-outline" onclick="renderClientsTable()">Cancel</button>
    </div>`;
  document.getElementById(`editimp-text-${clientId}-${idx}`).value = imp.text;
  document.getElementById(`editimp-author-${clientId}-${idx}`).value = imp.author;
}

async function saveEditImprovement(clientId, idx){
  const textEl = document.getElementById(`editimp-text-${clientId}-${idx}`);
  const authorEl = document.getElementById(`editimp-author-${clientId}-${idx}`);
  const text = textEl.value.trim();
  const author = authorEl.value.trim() || 'Team member';
  if(!text){ showToast('error','Nothing to save','Text can\'t be empty — delete the entry instead if you want it gone.'); return; }
  await loadAll();
  const c = clients.find(x=>x.id===clientId);
  if(!c || !c.improvements[idx]){ showToast('error','Entry not found','This may have changed elsewhere — refreshing.'); renderAll(); return; }
  const oldText = c.improvements[idx].text;
  const impId = c.improvements[idx].id;
  const { error } = await supabaseClient.from('client_improvements').update({ text, author }).eq('id', impId);
  const ok = !error;
  if(ok){ c.improvements[idx].text = text; c.improvements[idx].author = author; }
  renderClientsTable(); renderKpis(); renderQueue();
  if(ok){
    const truncate = (s)=> s && s.length>60 ? s.slice(0,60)+'…' : (s||'—');
    const desc = oldText !== text
      ? `${myName()||'Someone'} changed an improvement — "${truncate(oldText)}" → "${truncate(text)}"`
      : `${myName()||'Someone'} edited an improvement's author/details.`;
    logClientActivity(clientId, 'improvement_edited', desc);
    refreshClientDetailActivityIfOpen(clientId);
  }
  ok ? showToast('success','Improvement updated','Changes saved.') : showToast('error','Save failed','Could not save — try again.');
}

async function deleteAllImprovements(clientId){
  await loadAll();
  const c = clients.find(x=>x.id===clientId);
  if(!c || !c.improvements.length){ showToast('info','Nothing to delete','No logged improvements for this client.'); return; }
  const count = c.improvements.length;
  if(!(await confirmDialog(`Delete all ${count} logged improvement${count!==1?'s':''} for ${c.name}? This can't be undone.`, {confirmLabel:'Delete all', destructive:true}))) return;
  // .select() after .delete() to confirm rows were actually affected —
  // same reasoning as deleteImprovementRow() above: an RLS policy that
  // silently blocks some or all of these rows would otherwise report
  // success (no error) while deleting nothing, or fewer than expected.
  const { data: deletedRows, error: delErr } = await supabaseClient.from('client_improvements').delete().eq('client_id', clientId).select();
  const actuallyDeletedCount = deletedRows ? deletedRows.length : 0;
  const okDel = !delErr && actuallyDeletedCount === count;
  if(delErr) console.error('deleteAllImprovements failed', clientId, delErr);
  else if(actuallyDeletedCount !== count) console.error(`deleteAllImprovements: expected to delete ${count} rows, only ${actuallyDeletedCount} were actually deleted (likely blocked by RLS for the rest)`, clientId);
  if(okDel){ c.improvements = []; clientImprovements = clientImprovements.filter(i=>i.clientId!==clientId); }
  // Every author's draft for this client is now stale, not just one
  // person's — they all just lost their source improvements at once.
  const invalidatedAuthors = (c.drafts||[]).filter(d => d.draftStatus !== 'none').map(d => d.author);
  invalidatedAuthors.forEach(author => invalidateStaleDraft(c, author));
  if(okDel) await Promise.all(invalidatedAuthors.map(author => saveDraftFor(clientId, author, { draftStatus:'none', draft:'' })));
  const ok = okDel;
  renderClientsTable(); renderKpis(); renderQueue(); renderTeamQueue(); renderImprovementsHistory();
  if(ok){
    logClientActivity(clientId, 'improvement_deleted', `${myName()||'Someone'} deleted all ${count} logged improvements.`);
    refreshClientDetailActivityIfOpen(clientId);
  }
  ok ? showToast('success','Deleted', `Cleared ${count} logged improvement${count!==1?'s':''} for ${c.name}.`) : showToast('error','Delete failed','Could not save — try again.');
}

async function deleteImprovement(clientId, idx){
  if(!(await confirmDialog('Delete this logged improvement? This can\'t be undone.', {confirmLabel:'Delete', destructive:true}))) return;
  await loadAll();
  const c = clients.find(x=>x.id===clientId);
  if(!c || !c.improvements[idx]){ showToast('info','Already gone','This entry was already removed.'); renderAll(); return; }
  const deletedText = c.improvements[idx].text;
  const impId = c.improvements[idx].id;
  const ok = await deleteImprovementRow(impId);
  if(ok) c.improvements.splice(idx, 1);
  // Missing renderTeamQueue() here was the actual bug behind "deleted
  // improvements keep showing on the Approval Queue" — the underlying
  // data (c.improvements) was already correctly updated above, but the
  // Team Queue's rendered HTML was never refreshed to reflect it, so a
  // stale card just sat there until something else happened to trigger a
  // re-render. Also adding renderImprovementsHistory() for the same
  // reason, in case that page is what's currently on screen.
  renderClientsTable(); renderKpis(); renderQueue(); renderTeamQueue(); renderImprovementsHistory();
  if(ok){
    const truncate = (s)=> s && s.length>80 ? s.slice(0,80)+'…' : (s||'—');
    logClientActivity(clientId, 'improvement_deleted', `${myName()||'Someone'} deleted an improvement — "${truncate(deletedText)}"`);
    refreshClientDetailActivityIfOpen(clientId);
  }
  ok ? showToast('success','Improvement deleted','Removed from the log.') : showToast('error','Delete failed','Could not save — try again.');
}

/* ---------- Per-client audit trail (unbounded, unlike the 60-entry global log) ---------- */

// Fire-and-forget: writes an audit entry, but never blocks or breaks the
// actual action (logging an edit shouldn't be able to stop the edit itself).
async function logClientActivity(clientId, actionType, description){
  if(!clientId || !currentUser) return;
  try{
    const { error } = await supabaseClient.from('activity_log').insert({
      client_id: clientId, user_id: currentUser.id, action_type: actionType, description
    });
    if(error) console.error('logClientActivity error', error);
  }catch(e){ console.error('logClientActivity error', e); }
}

async function loadClientActivityHistory(clientId){
  const el = document.getElementById('cdActivityHistory');
  if(!el) return;
  el.innerHTML = `<div class="empty"><span class="spinner"></span>Loading…</div>`;
  const { data, error } = await supabaseClient
    .from('activity_log').select('*').eq('client_id', clientId).order('created_at', { ascending:false }).limit(200);
  if(error){ el.innerHTML = `<div class="empty">Could not load activity history.</div>`; return; }
  if(!data || !data.length){ el.innerHTML = `<div class="empty">No activity recorded yet.</div>`; return; }
  el.innerHTML = data.map(row=>{
    const person = teamProfiles.find(p=>p.id===row.user_id);
    const isAuto = row.action_type === 'draft_generated';
    const tagLabel = isAuto ? 'AI' : (person ? person.name.split(' ')[0] : 'gone');
    const when = new Date(row.created_at);
    const timeStr = `${when.toLocaleDateString('en-US',{month:'short',day:'numeric'})}, ${when.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}`;
    return `<div class="log-row"><span class="log-time">${timeStr}</span><span><span class="tag ${isAuto?'auto':'you'}">${tagLabel}</span>${escapeHtml(row.description)}</span></div>`;
  }).join('');
}
