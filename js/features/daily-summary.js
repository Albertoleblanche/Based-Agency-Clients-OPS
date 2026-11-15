// Daily Summary (admins/approvers) and posting it to Slack.

/* ---------- Daily Summary — admins and approvers only. Fetched via a
   dedicated endpoint (api/get-daily-summary.js) rather than client-side
   data, since regular time_entries visibility doesn't extend to approvers
   anywhere else in the app — this is a deliberately narrow exception. ---------- */

let dailySummaryDate = new Date();
let lastDailySummaryData = null; // cached for the Slack confirm modal

function renderDailySummaryDateLabel(){
  const el = document.getElementById('dailySummaryDateLabel');
  if(el) el.textContent = dailySummaryDate.toLocaleDateString('en-US',{weekday:'short', month:'short', day:'numeric'});
}

function shiftDailySummaryDate(dir){
  dailySummaryDate.setDate(dailySummaryDate.getDate()+dir);
  renderDailySummaryDateLabel();
  loadDailySummary();
}

function resetDailySummaryToToday(){
  dailySummaryDate = new Date();
  renderDailySummaryDateLabel();
  loadDailySummary();
}

async function loadDailySummary(){
  const el = document.getElementById('dailySummaryList');
  if(!el) return;
  el.innerHTML = `<div class="panel"><div class="empty"><span class="spinner"></span>Loading…</div></div>`;
  renderDailySummaryDateLabel();
  try{
    const { data: { session } } = await supabaseClient.auth.getSession();
    const dateStr = toDateStr(dailySummaryDate);
    const response = await fetch(`/api/get-daily-summary?date=${dateStr}`, {
      headers: { 'Authorization': `Bearer ${session.access_token}` },
    });
    const data = await response.json();
    if(!response.ok){ el.innerHTML = `<div class="panel"><div class="empty">${data.error || 'Could not load the summary.'}</div></div>`; return; }
    lastDailySummaryData = data;
    renderDailySummaryList(data);
  }catch(e){
    el.innerHTML = `<div class="panel"><div class="empty">Could not load the summary — check your connection.</div></div>`;
  }
}

function renderDailySummaryList(data){
  const el = document.getElementById('dailySummaryList');
  if(!el) return;
  if(!data.summary.length){
    const msg = canApprove() ? 'Nobody logged time this day.' : "You haven't logged any time this day.";
    el.innerHTML = `<div class="panel"><div class="empty">${escapeHtml(msg)}</div></div>`;
    return;
  }
  el.innerHTML = `<div class="dsummary-grid">` + data.summary.map(person=>{
    const profile = teamProfiles.find(p=>p.id===person.userId);
    const roleLabel = profile ? (profile.title || roleDisplayLabel(profile.role)) : '';
    const clientNames = person.entries.map(e=>e.client);
    const previewNames = clientNames.slice(0,3).join(', ');
    const extra = clientNames.length>3 ? ` +${clientNames.length-3} more` : '';
    return `<div class="dsummary-card" onclick="openDailySummaryDetail('${person.userId}')">
      <div class="dsummary-head">
        ${profile ? teamCardAvatarHtml(profile) : `<div class="team-card-avatar-fallback" style="background:${avatarColorForName(person.name)};">${escapeHtml((person.name||'?').trim().charAt(0).toUpperCase())}</div>`}
        <div>
          <div class="dsummary-name">${escapeHtml(person.name)}</div>
          ${roleLabel ? `<div class="dsummary-role">${escapeHtml(roleLabel)}</div>` : ''}
        </div>
        <div class="dsummary-total">${formatMinutes(person.totalMinutes)}</div>
      </div>
      <div class="dsummary-preview">${person.entries.length} client${person.entries.length!==1?'s':''} — ${escapeHtml(previewNames)}${extra}</div>
    </div>`;
  }).join('') + `</div>`;
}

// Full per-entry breakdown for one person, on click — the card itself only
// ever shows a compact preview.
function openDailySummaryDetail(userId){
  if(!lastDailySummaryData) return;
  const person = lastDailySummaryData.summary.find(p=>p.userId===userId);
  if(!person) return;
  const dateLabel = new Date(lastDailySummaryData.date+'T00:00:00').toLocaleDateString('en-US',{weekday:'long', month:'long', day:'numeric'});
  openAppModal(`
    <div class="modal-head"><span class="panel-title">${escapeHtml(person.name)} — ${escapeHtml(dateLabel)}</span><span class="toast-close" onclick="closeAppModal()">✕</span></div>
    <div class="modal-body">
      <div style="font-family:var(--font);font-size:20px;font-weight:700;color:var(--ink);margin-bottom:14px;">${formatMinutes(person.totalMinutes)} <span style="font-size:11px;font-weight:500;color:var(--muted-lt);">total</span></div>
      ${person.entries.map(e=>`
        <div class="ts-entry-card" style="margin-bottom:8px;">
          <div class="ts-entry-info">
            <div class="ts-entry-title">${escapeHtml(e.client)}${e.service ? ` <span class="ts-entry-service">(${escapeHtml(e.service)})</span>` : ''}</div>
            ${e.description ? `<div class="ts-entry-desc">${escapeHtml(e.description)}</div>` : ''}
          </div>
          <div class="ts-entry-right"><div class="ts-entry-duration">${formatMinutes(e.minutes)}</div></div>
        </div>`).join('')}
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeAppModal()">Close</button>
    </div>`, 480);
}

function openSlackSummaryConfirm(){
  if(!lastDailySummaryData){ showToast('error','Nothing loaded yet','Wait for the summary to finish loading first.'); return; }
  const dateLabel = new Date(lastDailySummaryData.date+'T00:00:00').toLocaleDateString('en-US',{weekday:'long', month:'long', day:'numeric'});
  const rows = lastDailySummaryData.summary.map(person=>{
    const profile = teamProfiles.find(p=>p.id===person.userId);
    const hasSlackId = !!(profile && (profile.daily_summary_slack_id || profile.slack_user_id));
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);">
      <span>${escapeHtml(person.name)} <span style="color:var(--muted-lt);">— ${formatMinutes(person.totalMinutes)}</span></span>
      ${hasSlackId ? '<span style="color:var(--green);font-size:12px;">Will be sent</span>' : '<span style="color:var(--muted-lt);font-size:12px;">No Slack ID on file</span>'}
    </div>`;
  }).join('');
  openAppModal(`
    <div class="modal-head"><span class="panel-title">Send personal summaries to Slack?</span><span class="toast-close" onclick="closeAppModal()">✕</span></div>
    <div class="modal-body">
      <p style="font-size:11.5px;color:var(--muted-lt);margin:0 0 12px;">Each person gets their own DM with just their own hours for ${escapeHtml(dateLabel)} — nobody sees anyone else's.</p>
      ${rows}
    </div>
    <div class="modal-actions">
      <button class="btn btn-brand" id="sendSlackBtn" onclick="confirmSendSlackSummary()">Send</button>
      <button class="btn btn-outline" onclick="closeAppModal()">Cancel</button>
    </div>`, 480);
}

async function confirmSendSlackSummary(){
  const btn = document.getElementById('sendSlackBtn');
  setBtnLoading(btn, 'Sending…');
  try{
    const { data: { session } } = await supabaseClient.auth.getSession();
    const response = await fetch('/api/send-slack-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ action: 'personal-summaries', date: lastDailySummaryData.date, summary: lastDailySummaryData.summary }),
    });
    const data = await response.json();
    restoreBtn(btn);
    if(!response.ok){ showToast('error','Send failed', data.error || 'Could not send to Slack.'); return; }
    closeAppModal();
    const sent = (data.results||[]).filter(r=>r.sent).length;
    const skipped = (data.results||[]).filter(r=>!r.sent && r.reason==='no_slack_id').length;
    const failed = (data.results||[]).filter(r=>!r.sent && r.reason!=='no_slack_id').length;
    let detail = `${sent} sent`;
    if(skipped) detail += `, ${skipped} skipped (no Slack ID)`;
    if(failed) detail += `, ${failed} failed`;
    showToast(failed ? 'error' : 'success', failed ? 'Some summaries failed' : 'Sent to Slack', detail);
  }catch(e){
    restoreBtn(btn);
    showToast('error','Send failed','Network error — try again.');
  }
}
