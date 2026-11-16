// Weekly focus report: guided steps, past reports page, PDF/email.

// A multi-step wizard instead of one long scrolling list — one section at
// a time (icon dots to jump around, Back/Next to step through), shared by
// openWeeklyFocusReportModal() (the real, already-generated report) and
// previewProactiveInsights() (a fresh dry-run result with the exact same
// shape) so the preview can never visually drift from what the real
// report actually looks like.
const WEEKLY_REPORT_ICONS = {
  overview:  '<path d="M42.76,50A8,8,0,0,0,40,56V224a8,8,0,0,0,16,0V179.77c26.79-21.16,49.87-9.75,76.45,3.41,16.4,8.11,34.06,16.85,53,16.85,13.93,0,28.54-4.75,43.82-18a8,8,0,0,0,2.76-6V56A8,8,0,0,0,218.76,50c-28,24.23-51.72,12.49-79.21-1.12C111.07,34.76,78.78,18.79,42.76,50ZM216,172.25c-26.79,21.16-49.87,9.74-76.45-3.41-25-12.35-52.81-26.13-83.55-8.4V59.79c26.79-21.16,49.87-9.75,76.45,3.4,25,12.35,52.82,26.13,83.55,8.4Z"/>',
  attention: '<path d="M236.8,188.09,149.35,36.22h0a24.76,24.76,0,0,0-42.7,0L19.2,188.09a23.51,23.51,0,0,0,0,23.72A24.35,24.35,0,0,0,40.55,224h174.9a24.35,24.35,0,0,0,21.33-12.19A23.51,23.51,0,0,0,236.8,188.09ZM222.93,203.8a8.5,8.5,0,0,1-7.48,4.2H40.55a8.5,8.5,0,0,1-7.48-4.2,7.59,7.59,0,0,1,0-7.72L120.52,44.21a8.75,8.75,0,0,1,15,0l87.45,151.87A7.59,7.59,0,0,1,222.93,203.8ZM120,144V104a8,8,0,0,1,16,0v40a8,8,0,0,1-16,0Zm20,36a12,12,0,1,1-12-12A12,12,0,0,1,140,180Z"/>',
  overdue:   '<path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm64-88a8,8,0,0,1-8,8H128a8,8,0,0,1-8-8V72a8,8,0,0,1,16,0v48h48A8,8,0,0,1,192,128Z"/>',
  quiet:     '<path d="M233.54,142.23a8,8,0,0,0-8-2,88.08,88.08,0,0,1-109.8-109.8,8,8,0,0,0-10-10,104.84,104.84,0,0,0-52.91,37A104,104,0,0,0,136,224a103.09,103.09,0,0,0,62.52-20.88,104.84,104.84,0,0,0,37-52.91A8,8,0,0,0,233.54,142.23ZM188.9,190.34A88,88,0,0,1,65.66,67.11a89,89,0,0,1,31.4-26A106,106,0,0,0,96,56,104.11,104.11,0,0,0,200,160a106,106,0,0,0,14.92-1.06A89,89,0,0,1,188.9,190.34Z"/>',
  drafts:    '<path d="M213.66,82.34l-56-56A8,8,0,0,0,152,24H56A16,16,0,0,0,40,40V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V88A8,8,0,0,0,213.66,82.34ZM160,51.31,188.69,80H160ZM200,216H56V40h88V88a8,8,0,0,0,8,8h48V216Zm-32-80a8,8,0,0,1-8,8H96a8,8,0,0,1,0-16h64A8,8,0,0,1,168,136Zm0,32a8,8,0,0,1-8,8H96a8,8,0,0,1,0-16h64A8,8,0,0,1,168,168Z"/>',
  assistant: '<path d="M197.58,129.06,146,110l-19-51.62a15.92,15.92,0,0,0-29.88,0L78,110l-51.62,19a15.92,15.92,0,0,0,0,29.88L78,178l19,51.62a15.92,15.92,0,0,0,29.88,0L146,178l51.62-19a15.92,15.92,0,0,0,0-29.88ZM137,164.22a8,8,0,0,0-4.74,4.74L112,223.85,91.78,169A8,8,0,0,0,87,164.22L32.15,144,87,123.78A8,8,0,0,0,91.78,119L112,64.15,132.22,119a8,8,0,0,0,4.74,4.74L191.85,144ZM144,40a8,8,0,0,1,8-8h16V16a8,8,0,0,1,16,0V32h16a8,8,0,0,1,0,16H184V64a8,8,0,0,1-16,0V48H152A8,8,0,0,1,144,40ZM248,88a8,8,0,0,1-8,8h-8v8a8,8,0,0,1-16,0V96h-8a8,8,0,0,1,0-16h8V72a8,8,0,0,1,16,0v8h8A8,8,0,0,1,248,88Z"/>',
};

function weeklyReportEmptyState(text){
  return `<p style="font-size:13px;color:var(--muted-lt);text-align:center;padding:24px 0;">${escapeHtml(text)}</p>`;
}

// coverNote: a short line specific to how this wizard was opened (a real
// report's generated date, or the preview's "nothing was saved" caveat) —
// shown at the top of the overview step, the one piece that legitimately
// differs between the two callers.
function buildWeeklyFocusReportSteps(r, coverNote){
  const attentionHtml = (r.attentionClients||[]).map(c=>`
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer;" onclick="dockWeeklyFocusReportModal();openClientDetail('${c.id}')">
      <span style="font-size:13.5px;color:var(--ink);">${escapeHtml(c.name)}</span>
      <span style="display:flex;align-items:center;gap:8px;flex:none;">
        <span class="pill ${c.danger>=5?'pill-bad':'pill-mid'}">Danger ${c.danger}/5</span>
        <span style="font-size:11.5px;color:var(--muted-lt);white-space:nowrap;">${c.daysSinceImprovement==null?'never logged':c.daysSinceImprovement+'d since update'}</span>
      </span>
    </div>`).join('');

  const overdueHtml = (r.overdueFollowUps||[]).map(f=>`
    <div style="padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer;" onclick="dockWeeklyFocusReportModal();openClientDetail('${f.clientId}')">
      <div style="font-size:13.5px;color:var(--ink);">${escapeHtml(f.clientName)}</div>
      <div style="font-size:11.5px;color:var(--muted-lt);">"${escapeHtml(f.question||'')}" — was due ${new Date(f.followUpDate+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}</div>
    </div>`).join('');

  const staleHtml = (r.staleClients||[]).map(c=>`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer;" onclick="dockWeeklyFocusReportModal();openClientDetail('${c.id}')">
      <span style="font-size:13.5px;color:var(--ink);">${escapeHtml(c.name)}</span>
      <span style="font-size:11.5px;color:var(--muted-lt);">${c.daysSinceImprovement==null?'never logged':c.daysSinceImprovement+' days quiet'}</span>
    </div>`).join('');

  const draftsHtml = (r.pendingDrafts||[]).map(c=>`
    <div style="padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer;" onclick="dockWeeklyFocusReportModal();openClientDetail('${c.id}')">
      <span style="font-size:13.5px;color:var(--ink);">${escapeHtml(c.name)}</span>
    </div>`).join('');

  const aiHtml = (r.aiFindings||[]).map(f=>`
    <div style="padding:12px 0;border-bottom:1px solid var(--border);">
      <div style="font-size:13.5px;font-weight:600;color:var(--ink);margin-bottom:4px;">${escapeHtml(f.title)}</div>
      <div style="font-size:12.5px;color:var(--muted);line-height:1.5;">${escapeHtml(f.body)}</div>
    </div>`).join('');

  const statTile = (count, label, stepIdx) => `
    <div onclick="goToWeeklyFocusReportStep(${stepIdx})" style="flex:1;min-width:110px;background:var(--surface-2);border-radius:var(--radius-lg);padding:16px 10px;cursor:pointer;text-align:center;">
      <div style="font-size:24px;font-weight:700;color:var(--ink);">${count}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:3px;">${escapeHtml(label)}</div>
    </div>`;

  const attn = r.attentionClients||[], overdue = r.overdueFollowUps||[], stale = r.staleClients||[], drafts = r.pendingDrafts||[], ai = r.aiFindings||[];

  return [
    { icon: WEEKLY_REPORT_ICONS.overview, title: 'This week at a glance', subtitle: null, body: `
        ${coverNote ? `<p style="font-size:11.5px;color:var(--muted-lt);text-align:center;margin:0 0 16px;">${coverNote}</p>` : ''}
        <div style="display:flex;flex-wrap:wrap;gap:10px;">
          ${statTile(attn.length, 'Need attention', 1)}
          ${statTile(overdue.length, 'Overdue', 2)}
          ${statTile(stale.length, 'Gone quiet', 3)}
          ${statTile(drafts.length, 'Pending drafts', 4)}
          ${statTile(ai.length, 'From the Assistant', 5)}
        </div>
        ${(r.errors||[]).length ? `<p style="font-size:11px;color:var(--red);margin-top:16px;text-align:center;">${r.errors.length} check${r.errors.length!==1?'s':''} failed while generating this report.</p>` : ''}
      ` },
    { icon: WEEKLY_REPORT_ICONS.attention, title: 'Needs attention', subtitle: `${attn.length} client${attn.length!==1?'s':''}`, body: attentionHtml || weeklyReportEmptyState('No high-danger clients right now.') },
    { icon: WEEKLY_REPORT_ICONS.overdue, title: 'Overdue follow-ups', subtitle: `${overdue.length}`, body: overdueHtml || weeklyReportEmptyState('Nothing overdue.') },
    { icon: WEEKLY_REPORT_ICONS.quiet, title: 'Gone quiet', subtitle: '14+ days, no logged work', body: staleHtml || weeklyReportEmptyState('Everyone active has logged something recently.') },
    { icon: WEEKLY_REPORT_ICONS.drafts, title: 'Pending drafts', subtitle: `${drafts.length}`, body: draftsHtml || weeklyReportEmptyState('Nothing pending.') },
    { icon: WEEKLY_REPORT_ICONS.assistant, title: 'From the Assistant', subtitle: null, body: aiHtml || weeklyReportEmptyState('Nothing flagged this week.') },
  ];
}

let weeklyFocusReportStepsState = [];
let weeklyFocusReportStepIndex = 0;

function renderWeeklyFocusReportStep(){
  const steps = weeklyFocusReportStepsState;
  const i = weeklyFocusReportStepIndex;
  const step = steps[i];
  const bodyEl = document.getElementById('weeklyFocusReportBody');
  if(!bodyEl || !step) return;

  const dotsHtml = steps.map((s,idx)=>`
    <button type="button" onclick="goToWeeklyFocusReportStep(${idx})" title="${escapeHtml(s.title)}" style="width:34px;height:34px;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex:none;background:${idx===i?'var(--brand)':'var(--surface-2)'};color:${idx===i?'#fff':'var(--muted)'};transition:background var(--duration-fast) var(--ease-out);">
      <svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round">${s.icon}</svg>
    </button>`).join('');

  bodyEl.innerHTML = `
    <div style="display:flex;gap:6px;justify-content:center;margin-bottom:20px;">${dotsHtml}</div>
    <div style="text-align:center;margin-bottom:16px;">
      <div style="font-size:15px;font-weight:700;color:var(--ink);">${escapeHtml(step.title)}</div>
      ${step.subtitle ? `<div style="font-size:12px;color:var(--muted-lt);margin-top:2px;">${escapeHtml(step.subtitle)}</div>` : ''}
    </div>
    <div style="min-height:140px;max-height:44vh;overflow-y:auto;">${step.body}</div>
  `;

  const prevBtn = document.getElementById('weeklyFocusReportPrevBtn');
  const nextBtn = document.getElementById('weeklyFocusReportNextBtn');
  if(prevBtn) prevBtn.style.visibility = i===0 ? 'hidden' : 'visible';
  if(nextBtn) nextBtn.textContent = i===steps.length-1 ? 'Done' : 'Next';
}

function goToWeeklyFocusReportStep(idx){
  weeklyFocusReportStepIndex = Math.max(0, Math.min(idx, weeklyFocusReportStepsState.length-1));
  renderWeeklyFocusReportStep();
}

function weeklyFocusReportNext(){
  if(weeklyFocusReportStepIndex >= weeklyFocusReportStepsState.length-1){ closeAppModal(); return; }
  goToWeeklyFocusReportStep(weeklyFocusReportStepIndex+1);
}

function weeklyFocusReportPrev(){
  goToWeeklyFocusReportStep(weeklyFocusReportStepIndex-1);
}

function openWeeklyFocusReportShell(){
  openAppModal(`
    <div class="modal-head" onclick="undockWeeklyFocusReportIfNeeded()">
      <span class="panel-title">This week's focus report</span>
      <div style="display:flex;align-items:center;gap:14px;">
        <span class="row-link" style="font-size:12px;" onclick="event.stopPropagation();openWeeklyFocusReportHistory()">Past reports</span>
        <span class="toast-close" onclick="event.stopPropagation();closeAppModal()">✕</span>
      </div>
    </div>
    <div class="modal-body" id="weeklyFocusReportBody"><p style="font-size:13px;color:var(--muted);text-align:center;">Loading…</p></div>
    <div class="modal-actions" style="justify-content:space-between;">
      <button class="btn btn-outline" id="weeklyFocusReportPrevBtn" onclick="weeklyFocusReportPrev()">Back</button>
      <button class="btn btn-brand" id="weeklyFocusReportNextBtn" onclick="weeklyFocusReportNext()">Next</button>
    </div>`, 560);
}

// Lists every past report (they've all existed in the database all
// along — nothing to generate here, just to browse). Reuses
// openWeeklyFocusReportModal(reportId), which already supported opening
// any specific report by id; the only missing piece was actually a way
// to see the list and pick one.
async function openWeeklyFocusReportHistory(){
  openAppModal(`
    <div class="modal-head"><span class="panel-title">Past focus reports</span><span class="toast-close" onclick="closeAppModal()">✕</span></div>
    <div class="modal-body">
      <div id="weeklyFocusReportHistoryList" style="display:flex;flex-direction:column;gap:2px;max-height:360px;overflow-y:auto;">
        <div class="empty"><span class="spinner"></span>Loading…</div>
      </div>
    </div>`, 440);
  const { data: rows, error } = await supabaseClient
    .from('weekly_focus_reports').select('id, generated_at').order('generated_at', { ascending:false });
  const listEl = document.getElementById('weeklyFocusReportHistoryList');
  if(!listEl) return; // modal was closed again before this resolved
  if(error){ listEl.innerHTML = `<p class="empty">Couldn't load past reports — try again.</p>`; return; }
  if(!rows || !rows.length){ listEl.innerHTML = `<p class="empty">No reports yet.</p>`; return; }
  listEl.innerHTML = rows.map((r,i)=>`
    <button type="button" class="claude-popup-menu-btn" style="justify-content:space-between;" onclick="openWeeklyFocusReportModal('${r.id}')">
      <span>${new Date(r.generated_at).toLocaleDateString('en-US',{weekday:'long', month:'short', day:'numeric', year:'numeric'})}</span>
      ${i===0 ? `<span style="font-size:10.5px;color:var(--muted-lt);">Latest</span>` : ''}
    </button>
  `).join('');
}

// The dedicated sidebar page version — same underlying query and the
// same openWeeklyFocusReportModal(reportId) viewer as the modal-based
// history list above, just with the extra room a full page has over a
// 440px modal, and reachable directly from the sidebar rather than only
// via the Overview banner or an already-open report.
let focusReportsCache = []; // populated by renderFocusReportsPage(); downloadFocusReport()/emailFocusReportToTeam() read from this instead of re-fetching

function clearFocusReportsDateFilter(){
  const fromEl = document.getElementById('focusReportsFromDate');
  const toEl = document.getElementById('focusReportsToDate');
  if(fromEl) fromEl.value = '';
  if(toEl) toEl.value = '';
  renderFocusReportsPage();
}

async function renderFocusReportsPage(){
  const tbody = document.getElementById('focusReportsTbody');
  if(!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6">${loadingStateHtml('Loading past reports…')}</td></tr>`;
  const fromVal = document.getElementById('focusReportsFromDate')?.value;
  const toVal = document.getElementById('focusReportsToDate')?.value;
  let query = supabaseClient.from('weekly_focus_reports').select('id, generated_at, data').order('generated_at', { ascending:false });
  if(fromVal) query = query.gte('generated_at', fromVal);
  if(toVal) query = query.lte('generated_at', `${toVal}T23:59:59`);
  const { data: rows, error } = await query;
  if(!document.getElementById('focusReportsTbody')) return; // navigated away before this resolved
  if(error){ tbody.innerHTML = `<tr><td colspan="6"><p class="empty">Couldn't load past reports — try again.</p></td></tr>`; return; }
  focusReportsCache = rows || [];
  if(!focusReportsCache.length){
    tbody.innerHTML = `<tr><td colspan="6">${emptyStateHtml(
      '<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M42.76,50A8,8,0,0,0,40,56V224a8,8,0,0,0,16,0V179.77c26.79-21.16,49.87-9.75,76.45,3.41,16.4,8.11,34.06,16.85,53,16.85,13.93,0,28.54-4.75,43.82-18a8,8,0,0,0,2.76-6V56A8,8,0,0,0,218.76,50c-28,24.23-51.72,12.49-79.21-1.12C111.07,34.76,78.78,18.79,42.76,50ZM216,172.25c-26.79,21.16-49.87,9.74-76.45-3.41-25-12.35-52.81-26.13-83.55-8.4V59.79c26.79-21.16,49.87-9.75,76.45,3.4,25,12.35,52.82,26.13,83.55,8.4Z"/></svg>',
      'No reports found',
      (fromVal || toVal) ? 'Nothing in this date range — try widening it.' : 'Weekly focus reports will show up here once the first one generates.',
      ''
    )}</td></tr>`;
    return;
  }
  tbody.innerHTML = focusReportsCache.map((r,i)=>{
    const d = r.data || {};
    const dateLabel = new Date(r.generated_at).toLocaleDateString('en-US',{weekday:'short', month:'short', day:'numeric', year:'numeric'});
    return `<tr>
      <td>${escapeHtml(dateLabel)}${i===0 && !fromVal && !toVal ? ' <span class="pill pill-good">Latest</span>' : ''}</td>
      <td>${(d.attentionClients||[]).length}</td>
      <td>${(d.overdueFollowUps||[]).length}</td>
      <td>${(d.staleClients||[]).length}</td>
      <td>${(d.pendingDrafts||[]).length}</td>
      <td style="text-align:right;white-space:nowrap;">
        <span class="row-link" onclick="openWeeklyFocusReportModal('${r.id}')">View</span>
        <span class="row-link" onclick="downloadFocusReport('${r.id}')">Download</span>
        <span class="row-link" onclick="emailFocusReportToTeam('${r.id}')">Email team</span>
      </td>
    </tr>`;
  }).join('');
}

// Shared by both the download and email-to-team actions below — one
// plain-text rendering of a report's content, independent of the
// interactive wizard modal's HTML/click-through version.
function buildFocusReportPlainText(r){
  const d = r.data || {};
  const dateLabel = new Date(r.generated_at).toLocaleDateString('en-US',{weekday:'long', month:'long', day:'numeric', year:'numeric'});
  const lines = [`WEEKLY FOCUS REPORT — ${dateLabel}`, '='.repeat(50), ''];
  const section = (title, items, formatItem) => {
    lines.push(`${title.toUpperCase()} (${items.length})`, '-'.repeat(30));
    if(!items.length) lines.push('  Nothing to report.');
    else items.forEach(item => lines.push(`  ${formatItem(item)}`));
    lines.push('');
  };
  section('Needs attention', d.attentionClients||[], c => `${c.name} — Danger ${c.danger}/5, ${c.daysSinceImprovement==null?'never logged':c.daysSinceImprovement+' days since last update'}`);
  section('Overdue follow-ups', d.overdueFollowUps||[], f => `${f.clientName} — "${f.question||''}" (was due ${new Date(f.followUpDate+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})})`);
  section('Gone quiet (14+ days, no logged work)', d.staleClients||[], c => `${c.name} — ${c.daysSinceImprovement==null?'never logged':c.daysSinceImprovement+' days quiet'}`);
  section('Pending drafts', d.pendingDrafts||[], c => c.name);
  section('From the Assistant', d.aiFindings||[], f => `${f.title}: ${f.body}`);
  return lines.join('\n');
}

function downloadFocusReport(id){
  const r = focusReportsCache.find(x=>x.id===id);
  if(!r) return;
  const text = buildFocusReportPlainText(r);
  const blob = new Blob([text], { type:'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `focus-report-${toDateStr(new Date(r.generated_at))}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

async function emailFocusReportToTeam(id){
  const r = focusReportsCache.find(x=>x.id===id);
  if(!r) return;
  const recipients = teamProfiles.filter(p=>p.email).map(p=>p.email);
  if(!recipients.length){ showToast('error','No email addresses','No team members have an email on file.'); return; }
  const dateLabel = new Date(r.generated_at).toLocaleDateString('en-US',{weekday:'long', month:'long', day:'numeric', year:'numeric'});
  if(!(await confirmDialog(`Email this report to all ${recipients.length} team member${recipients.length!==1?'s':''}?`, {confirmLabel:'Send'}))) return;
  try{
    const response = await fetch('/api/send-email', {
      method: 'POST',
      headers: await apiAuthHeaders(),
      body: JSON.stringify({ to: recipients.join(','), subject: `Weekly Focus Report — ${dateLabel}`, body: buildFocusReportPlainText(r) }),
    });
    const data = await response.json();
    if(!response.ok) throw new Error(data.error || 'Could not send the email');
    showToast('success','Sent', `Report emailed to ${recipients.length} team member${recipients.length!==1?'s':''}.`);
  }catch(e){
    showToast('error','Send failed', e.message || 'Try again.');
  }
}

// Instead of closing the report when you click through to a client, this
// docks it to a corner (transparent, click-through overlay behind it) so
// the client detail page underneath becomes visible and usable, and the
// report is still right there — no need to regenerate it to see more,
// which matters a lot for the Preview version specifically since that one
// costs real API money to run again. Clicking the docked card's header
// restores it to the full centered view.
function dockWeeklyFocusReportModal(){
  const overlay = document.getElementById('appModalOverlay');
  if(overlay) overlay.classList.add('docked');
}

function undockWeeklyFocusReportIfNeeded(){
  const overlay = document.getElementById('appModalOverlay');
  if(overlay && overlay.classList.contains('docked')) overlay.classList.remove('docked');
}

function showWeeklyFocusReportLoadError(){
  const bodyEl = document.getElementById('weeklyFocusReportBody');
  if(bodyEl) bodyEl.innerHTML = `<p style="font-size:13px;color:var(--muted);text-align:center;">Could not load this report — it may have been generated before this feature existed, or something went wrong.</p>`;
  const prevBtn = document.getElementById('weeklyFocusReportPrevBtn'); if(prevBtn) prevBtn.style.display = 'none';
  const nextBtn = document.getElementById('weeklyFocusReportNextBtn'); if(nextBtn){ nextBtn.textContent = 'Close'; nextBtn.onclick = closeAppModal; }
}

// Persistent access to the latest report, independent of whether its
// notification is still around to click — dismissing/clearing the
// notification (or just navigating away) shouldn't mean re-running the
// Preview (which costs real API money) just to see it again. Shown on the
// Overview page, refreshed every time that page is visited.
async function refreshWeeklyFocusReportBanner(){
  const banner = document.getElementById('weeklyFocusReportBanner');
  if(!banner) return;
  const { data: row, error } = await supabaseClient
    .from('weekly_focus_reports').select('generated_at').order('generated_at', { ascending:false }).limit(1).maybeSingle();
  if(error){ console.error('refreshWeeklyFocusReportBanner error', error); banner.style.display = 'none'; return; }
  if(!row){ banner.style.display = 'none'; return; }
  const dateEl = document.getElementById('weeklyFocusReportBannerDate');
  if(dateEl) dateEl.textContent = new Date(row.generated_at).toLocaleDateString('en-US',{weekday:'long', month:'short', day:'numeric'});
  banner.style.display = 'block';
}

async function openWeeklyFocusReportModal(reportId){
  openWeeklyFocusReportShell();

  let query = supabaseClient.from('weekly_focus_reports').select('generated_at, data');
  query = reportId ? query.eq('id', reportId).maybeSingle() : query.order('generated_at', { ascending:false }).limit(1).maybeSingle();
  const { data: row, error } = await query;

  if(!document.getElementById('weeklyFocusReportBody')) return; // modal was closed again before this finished loading
  if(error || !row){ showWeeklyFocusReportLoadError(); return; }

  const genDate = new Date(row.generated_at).toLocaleDateString('en-US',{weekday:'long', month:'short', day:'numeric'});
  weeklyFocusReportStepsState = buildWeeklyFocusReportSteps(row.data || {}, `Generated ${genDate}`);
  weeklyFocusReportStepIndex = 0;
  renderWeeklyFocusReportStep();
}
