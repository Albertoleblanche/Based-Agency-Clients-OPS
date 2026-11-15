// AI Visibility reporting engine: report builder, metrics import,
// RankScale CSV import, AI-drafted sections, PDF export.

// ---- Page 2: Quick Metrics — pure arithmetic, no AI involved, fully reliable ----
function computeAiVisibilityQuickMetrics(d){
  const beforePct = d.before_total_prompts ? Math.round((d.before_recommended_count / d.before_total_prompts) * 100) : null;
  const afterPct = d.after_total_prompts ? Math.round((d.after_recommended_count / d.after_total_prompts) * 100) : null;
  const promptGain = (d.after_recommended_count!=null && d.before_recommended_count!=null) ? d.after_recommended_count - d.before_recommended_count : null;
  const positionGain = (d.before_avg_position!=null && d.after_avg_position!=null) ? Math.round((d.before_avg_position - d.after_avg_position)*10)/10 : null;
  let summary = '';
  if(beforePct!=null && afterPct!=null && promptGain!=null && positionGain!=null){
    const promptDirection = promptGain > 0 ? 'rose' : promptGain < 0 ? 'fell' : 'held steady';
    const positionDirection = positionGain > 0 ? 'improved' : positionGain < 0 ? 'worsened' : 'held steady';
    summary = `Recommendation frequency ${promptDirection} from ${d.before_recommended_count}/${d.before_total_prompts} prompts (${beforePct}%) to ${d.after_recommended_count}/${d.after_total_prompts} (${afterPct}%)${promptGain!==0?`, a ${promptGain>0?'gain':'drop'} of ${Math.abs(promptGain)} prompt${Math.abs(promptGain)!==1?'s':''}`:''}. Average ranking position ${positionDirection} from ${d.before_avg_position} to ${d.after_avg_position}${positionGain!==0?`, a ${Math.abs(positionGain)}-position ${positionGain>0?'gain':'drop'} (lower is better)`:''}.`;
  }
  return { beforePct, afterPct, promptGain, positionGain, summary };
}

// ---- AI-assisted narrative sections — drafted from the structured data
// already entered, always human-reviewed before saving. Reuses the same
// generic /api/generate-draft endpoint the client-update drafts already
// use (arbitrary prompt in, text out) rather than a new backend function. ----
function buildAiVisibilityContext(d){
  const qm = computeAiVisibilityQuickMetrics(d);
  return `Client: ${d.client_name_snapshot || 'n/a'}
Target keyword: ${d.target_keyword || 'n/a'}
Quick metrics: ${qm.summary || 'not yet entered'}
Overview (platform visibility changes): ${d.overview_summary || 'not yet entered'}
Competitors: ${(d.competitors||[]).map(c=>`${c.name} (visibility ${c.visibilityPct}%, sentiment ${c.sentimentPct}%)`).join('; ') || 'none entered'}
What AIs value in this category: ${d.what_ai_values || 'not yet entered'}
Concerns raised by AI platforms: ${(d.concerns||[]).map(c=>`${c.platform}: "${c.quote}"`).join('; ') || 'none entered'}`;
}

function buildAiVisibilityPrompt(fieldName){
  const context = buildAiVisibilityContext(aiVisibilityDraft);
  const prompts = {
    executive_summary: `Write a concise (3-5 sentence) executive summary for a client-facing AI Visibility Report, based on this data:\n${context}\n\nTone: confident, factual, agency-to-client. No fluff, no bullet points, no heading — just the paragraph.`,
    competitive_intelligence_summary: `Write a short (3-5 sentence) narrative analyzing this client's competitive position among AI-recommended competitors, based on:\n${context}\n\nBe specific about where they rank and what's driving that. No heading.`,
  };
  return prompts[fieldName] || null;
}

async function generateAiVisibilitySection(fieldName){
  const prompt = buildAiVisibilityPrompt(fieldName);
  if(!prompt) return;
  const btn = clickedBtn();
  setBtnLoading(btn, 'Generating…');
  try{
    const response = await fetch('/api/generate-draft', {
      method:'POST', headers: await apiAuthHeaders(),
      body: JSON.stringify({ prompt, model: settings.openaiModel })
    });
    const data = await response.json();
    if(!response.ok) throw new Error(data.error || 'Generation failed');
    aiVisibilityDraft[fieldName] = (data.text || '').trim();
    const textarea = document.getElementById('av_'+fieldName);
    if(textarea) textarea.value = aiVisibilityDraft[fieldName];
    showToast('success','Generated','Review and edit before saving — this is a first draft, not a final answer.');
  }catch(e){
    showToast('error','Generation failed', e.message || 'Try again.');
  }finally{
    restoreBtn(btn);
  }
}


const AI_VISIBILITY_PLATFORMS = ['ChatGPT','Claude','Gemini','AI Overview','AI Mode','Copilot','Grok','Perplexity','Deepseek','Meta'];
let aiVisibilityReports = []; // list cache
let aiVisibilityCurrentReportId = null; // null = list mode; 'new' or a real id = detail mode
let aiVisibilityDraft = null; // the in-progress report object while in detail mode

function renderAiVisibilityMain(){
  const el = document.getElementById('aiVisibilityMain');
  if(!el) return;
  if(aiVisibilityCurrentReportId === null) renderAiVisibilityList(el);
  else renderAiVisibilityDetail(el);
}


async function loadInhouseMetricsConnectionStatus(){
  const statusEl = document.getElementById('inhouseConnectionStatus');
  if(!statusEl) return;
  try{
    const { data: { session } } = await supabaseClient.auth.getSession();
    const response = await fetch('/api/admin-user-actions', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ action:'get-inhouse-metrics-connection' }),
    });
    const data = await response.json();
    if(!response.ok) throw new Error(data.error || 'Could not check status');
    if(data.connected){
      statusEl.innerHTML = `<span style="color:var(--green);">✓ Connected</span> — ${escapeHtml(data.projectUrl||'')}`;
      const urlInput = document.getElementById('inhouseProjectUrlInput');
      if(urlInput && data.projectUrl) urlInput.placeholder = data.projectUrl;
    } else {
      statusEl.innerHTML = `<span style="color:var(--muted-lt);">Not connected yet</span>`;
    }
  }catch(e){
    statusEl.innerHTML = `<span style="color:var(--red);">Could not check status — ${escapeHtml(e.message||'try again')}</span>`;
  }
}

async function saveInhouseMetricsConnection(){
  const projectUrl = document.getElementById('inhouseProjectUrlInput')?.value.trim();
  const anonKey = document.getElementById('inhouseAnonKeyInput')?.value.trim();
  if(!projectUrl || !anonKey){ showToast('error','Missing info','Enter both the project URL and the anon key.'); return; }
  const btn = clickedBtn();
  setBtnLoading(btn, 'Saving…');
  try{
    const { data: { session } } = await supabaseClient.auth.getSession();
    const response = await fetch('/api/admin-user-actions', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ action:'save-inhouse-metrics-connection', projectUrl, anonKey }),
    });
    const data = await response.json();
    if(!response.ok) throw new Error(data.error || 'Save failed');
    showToast('success','Saved','In-house tool connection saved.');
    loadInhouseMetricsConnectionStatus();
  }catch(e){
    showToast('error','Save failed', e.message || 'Try again.');
  }finally{
    restoreBtn(btn);
  }
}

// ---- Pulling Quick Metrics + the Overview matrix directly from the
// in-house tool, from within the report editor. The report's own Client
// field (see onReportClientChanged()) pulls directly from this same
// in-house client list now, so no separate name-matching step is needed —
// only the scan picker(s) remain manual. ----
let inhouseMetricsClients = [];

// Once a match is known, both scan pickers (Quick Metrics' before/after,
// Page 5's single scan) can load their scan lists immediately — no need
// to wait for the admin to interact with a client dropdown that no
// longer exists.
async function onInhouseClientMatched(){
  const d = aiVisibilityDraft;
  if(!d.inhouse_client_id) return;
  await onInhouseClientSelected(d.inhouse_client_id);
}

// Targeted update of the report's own Client field once the in-house
// client list finishes loading. Deliberately NOT a full
// renderAiVisibilityMain() here: this runs after an async fetch, and a
// full re-render at that point could disrupt focus or scroll position if
// the admin is already interacting with something else on the page.
function refreshInhouseClientLinkDropdowns(){
  const d = aiVisibilityDraft;
  const clientSelectEl = document.getElementById('avClientId');
  if(!clientSelectEl) return;
  clientSelectEl.innerHTML = `<option value="">${inhouseMetricsClients.length ? 'Select a client…' : 'Loading…'}</option>` +
    inhouseMetricsClients.map(c=>`<option value="${c.id}" ${String(c.id)===d.inhouse_client_id?'selected':''}>${escapeHtml(c.name)}</option>`).join('');
}

async function loadInhouseMetricsClientsForPicker(){
  try{
    const { data: { session } } = await supabaseClient.auth.getSession();
    const response = await fetch('/api/admin-user-actions', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ action:'list-inhouse-clients' }),
    });
    const data = await response.json();
    if(!response.ok) throw new Error(data.error || 'Could not load clients');
    inhouseMetricsClients = data.clients || [];
    refreshInhouseClientLinkDropdowns();
  }catch(e){
    showToast('error','Could not load clients', e.message||'Save the connection first.');
  }
}

async function onInhouseClientSelected(clientId){
  const beforeSelect = document.getElementById('inhouseBeforeScanSelect');
  const afterSelect = document.getElementById('inhouseAfterScanSelect');
  if(!clientId){
    if(beforeSelect) beforeSelect.innerHTML = '<option value="">Pick a client first</option>';
    if(afterSelect) afterSelect.innerHTML = '<option value="">Pick a client first</option>';
    return;
  }
  if(beforeSelect) beforeSelect.innerHTML = '<option>Loading…</option>';
  if(afterSelect) afterSelect.innerHTML = '<option>Loading…</option>';
  try{
    const { data: { session } } = await supabaseClient.auth.getSession();
    const response = await fetch('/api/admin-user-actions', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ action:'list-inhouse-scans', clientId }),
    });
    const data = await response.json();
    if(!response.ok) throw new Error(data.error || 'Could not load scans');
    const scans = data.scans || [];
    const optionsHtml = '<option value="">Select a scan…</option>' + scans.map(s=>`<option value="${s.id}">${new Date(s.started_at).toLocaleString()} (${escapeHtml(s.mode||'')})</option>`).join('');
    if(beforeSelect) beforeSelect.innerHTML = optionsHtml;
    if(afterSelect) afterSelect.innerHTML = optionsHtml;
  }catch(e){
    showToast('error','Could not load scans', e.message||'Try again.');
  }
}

// Net Gainers/Losers, computed directly from the matrix data already
// pulled from the in-house tool — no AI call needed at all, since the
// color category (gained/sustained/nochange/regression/rerun) is already
// determined server-side in fetch-inhouse-metrics. Purely counting cells
// per platform, matching the exact phrasing style the vision-based
// extraction used to produce, but fully deterministic and instant.
function computeOverviewGainersLosersFromMatrix(matrixRows){
  const stats = {};
  (matrixRows||[]).forEach(row=>{
    Object.keys(row.cells||{}).forEach(platform=>{
      const cell = row.cells[platform];
      if(!stats[platform]) stats[platform] = { gained:0, lost:0 };
      if(cell.color === 'gained') stats[platform].gained++;
      if(cell.color === 'regression') stats[platform].lost++;
    });
  });
  const gainers = [], losers = [];
  Object.keys(stats).forEach(platform=>{
    const s = stats[platform];
    if(s.gained > 0 && s.lost === 0) gainers.push(`${platform} picked up ${s.gained} new mention${s.gained!==1?'s':''} it didn't have before`);
    else if(s.gained > 0 && s.lost > 0) gainers.push(`${platform} gained ${s.gained} mention${s.gained!==1?'s':''} but lost ${s.lost}`);
    else if(s.gained === 0 && s.lost > 0) losers.push(`${platform} lost visibility on ${s.lost} prompt${s.lost!==1?'s':''}`);
  });
  const lines = ['Net gainers:'];
  lines.push(...(gainers.length ? gainers.map(g=>`- ${g}`) : ['- None']));
  lines.push('Net losers / concerning:');
  lines.push(...(losers.length ? losers.map(l=>`- ${l}`) : ['- None']));
  return lines.join('\n');
}

// Quick Metrics needs BOTH scans picked before there's anything
// meaningful to pull (a before/after comparison needs both sides) —
// unlike Page 5's single-scan pull, which can fire the moment its one
// dropdown has a value.
function onInhouseMetricsScanSelectionChanged(){
  const before = document.getElementById('inhouseBeforeScanSelect')?.value;
  const after = document.getElementById('inhouseAfterScanSelect')?.value;
  if(before && after) pullInhouseMetrics();
}

async function pullInhouseMetrics(){
  const clientId = aiVisibilityDraft.inhouse_client_id;
  const beforeSelect = document.getElementById('inhouseBeforeScanSelect');
  const afterSelect = document.getElementById('inhouseAfterScanSelect');
  const beforeScanId = beforeSelect?.value;
  const afterScanId = afterSelect?.value;
  if(!clientId){ showToast('error','No linked client','Pick a client for this report first.'); return; }
  if(!beforeScanId || !afterScanId) return; // auto-triggered on scan selection — silently wait for both rather than nagging before either is picked
  // Disabling the dropdowns directly, rather than clickedBtn()/setBtnLoading —
  // there's no button here anymore now that this fires automatically off
  // the <select> changing, so this is the only visible feedback that a
  // pull is actually happening.
  if(beforeSelect) beforeSelect.disabled = true;
  if(afterSelect) afterSelect.disabled = true;
  try{
    const { data: { session } } = await supabaseClient.auth.getSession();
    const response = await fetch('/api/admin-user-actions', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ action:'fetch-inhouse-metrics', clientId, beforeScanId, afterScanId }),
    });
    const data = await response.json();
    if(!response.ok) throw new Error(data.error || 'Pull failed');
    if(data.error){ showToast('error','Nothing pulled', data.error); return; }
    const d = aiVisibilityDraft;
    d.before_avg_position = data.beforeAvgPosition;
    d.after_avg_position = data.afterAvgPosition;
    d.before_recommended_count = data.beforeRecommendedCount;
    d.before_total_prompts = data.beforeTotalPrompts;
    d.after_recommended_count = data.afterRecommendedCount;
    d.after_total_prompts = data.afterTotalPrompts;
    d.overview_matrix_data = data.matrixRows || [];
    d.overview_summary = computeOverviewGainersLosersFromMatrix(data.matrixRows || []);
    renderAiVisibilityMain();
    showToast('success','Pulled', `Quick Metrics, the Overview matrix, and Net Gainers/Losers (${(data.matrixRows||[]).length} prompts) populated from the in-house tool. Review before saving.`);
  }catch(e){
    showToast('error','Pull failed', e.message || 'Try again.');
  }finally{
    if(beforeSelect) beforeSelect.disabled = false;
    if(afterSelect) afterSelect.disabled = false;
  }
}


async function renderAiVisibilityList(el){
  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:flex-end;margin-bottom:16px;">
      <button class="btn btn-brand" onclick="openNewAiVisibilityReport()">+ New report</button>
    </div>
    <div class="panel">
      <div class="table-scroll-wrap">
        <table>
          <thead><tr><th>Client</th><th>Target keyword</th><th>Date</th><th style="text-align:right;">Actions</th></tr></thead>
          <tbody id="aiVisibilityTbody"><tr><td colspan="5">${loadingStateHtml('Loading reports…')}</td></tr></tbody>
        </table>
      </div>
    </div>`;
  const { data: rows, error } = await supabaseClient
    .from('ai_visibility_reports').select('id, client_name_snapshot, target_keyword, report_date')
    .order('report_date', { ascending:false });
  const tbody = document.getElementById('aiVisibilityTbody');
  if(!tbody) return;
  if(error){ tbody.innerHTML = `<tr><td colspan="5"><p class="empty">Couldn't load reports — try again.</p></td></tr>`; return; }
  aiVisibilityReports = rows || [];
  if(!aiVisibilityReports.length){
    tbody.innerHTML = `<tr><td colspan="5">${emptyStateHtml(
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"/></svg>',
      'No reports yet', 'Create your first AI Visibility Report to get started.',
      '<button class="btn btn-brand" onclick="openNewAiVisibilityReport()">+ New report</button>'
    )}</td></tr>`;
    return;
  }
  tbody.innerHTML = aiVisibilityReports.map(r=>`
    <tr style="cursor:pointer;" onclick="openAiVisibilityReport('${r.id}')">
      <td>${escapeHtml(r.client_name_snapshot||'—')}</td>
      <td>${escapeHtml(r.target_keyword||'—')}</td>
      <td>${new Date(r.report_date+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</td>
      <td style="text-align:right;white-space:nowrap;">
        <span class="row-link" onclick="event.stopPropagation();openAiVisibilityPreview('${r.id}')">View</span>
        <span class="row-link" onclick="event.stopPropagation();downloadAiVisibilityReportById('${r.id}')">Download</span>
        <span class="row-link" style="color:var(--red);" onclick="event.stopPropagation();deleteAiVisibilityReport('${r.id}')">Delete</span>
      </td>
    </tr>
  `).join('');
}

function emptyAiVisibilityDraft(){
  return {
    id: null, client_id: null, client_name_snapshot: '', target_keyword: '', report_date: toDateStr(new Date()),
    before_recommended_count: null, before_total_prompts: null, before_avg_position: null,
    after_recommended_count: null, after_total_prompts: null, after_avg_position: null,
    competitors: [], keywords: { positive:{}, neutral:{}, negative:{} }, concerns: [],
    links: { pressRelease:'', prPlacementReport:'', screenshotsFolder:'' },
    executive_summary:'', competitive_intelligence_summary:'',
    overview_summary: '', overview_matrix_data: [],
    what_ai_values: '',
    inhouse_client_id: null, // set directly when the Client field is picked; see onReportClientChanged()
  };
}

function openNewAiVisibilityReport(){
  aiVisibilityDraft = emptyAiVisibilityDraft();
  aiVisibilityCurrentReportId = 'new';
  renderAiVisibilityMain();
}

async function openAiVisibilityReport(id){
  const { data, error } = await supabaseClient.from('ai_visibility_reports').select('*').eq('id', id).maybeSingle();
  if(error || !data){ showToast('error','Could not load','Try again.'); return; }
  aiVisibilityDraft = {
    id: data.id, client_id: data.client_id, client_name_snapshot: data.client_name_snapshot||'',
    target_keyword: data.target_keyword||'', report_date: data.report_date,
    before_recommended_count: data.before_recommended_count, before_total_prompts: data.before_total_prompts, before_avg_position: data.before_avg_position,
    after_recommended_count: data.after_recommended_count, after_total_prompts: data.after_total_prompts, after_avg_position: data.after_avg_position,
    competitors: data.competitors || [],
    keywords: data.keywords && Object.keys(data.keywords).length ? data.keywords : { positive:{}, neutral:{}, negative:{} },
    concerns: data.concerns || [], links: data.links || { pressRelease:'', prPlacementReport:'', screenshotsFolder:'' },
    executive_summary: data.executive_summary||'',
    competitive_intelligence_summary: data.competitive_intelligence_summary||'',
    overview_summary: data.overview_summary||'', overview_matrix_data: data.overview_matrix_data||[],
    what_ai_values: data.what_ai_values||'',
    inhouse_client_id: data.inhouse_client_id||null,
  };
  aiVisibilityCurrentReportId = id;
  renderAiVisibilityMain();
}

function closeAiVisibilityDetail(){
  aiVisibilityCurrentReportId = null;
  aiVisibilityDraft = null;
  renderAiVisibilityMain();
}

// A quick, read-only look at a report's key numbers and summary — without
// leaving the list or loading the full editor (which also puts the report
// into an editable draft state, not appropriate for just wanting a look).
async function openAiVisibilityPreview(id){
  const { data, error } = await supabaseClient.from('ai_visibility_reports').select('*').eq('id', id).maybeSingle();
  if(error || !data){ showToast('error','Could not load','Try again.'); return; }
  const dateLabel = data.report_date ? new Date(data.report_date+'T00:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}) : '—';
  const metricRow = (label, before, after) => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);">
      <span style="font-size:12.5px;color:var(--muted);">${escapeHtml(label)}</span>
      <span style="font-size:12.5px;color:var(--ink);font-weight:600;">${before==null?'—':before} <span style="color:var(--muted-lt);font-weight:400;">→</span> ${after==null?'—':after}</span>
    </div>`;
  openAppModal(`
    <div class="modal-head">
      <div>
        <div class="q-name">${escapeHtml(data.client_name_snapshot||'—')}</div>
        <div class="q-service-caption">${escapeHtml(data.target_keyword||'—')} · ${escapeHtml(dateLabel)}</div>
      </div>
      <span class="toast-close" onclick="closeAppModal()">✕</span>
    </div>
    <div class="modal-body">
      <div style="margin-bottom:16px;">
        ${metricRow('Recommended (of prompts checked)', data.before_recommended_count!=null && data.before_total_prompts!=null ? `${data.before_recommended_count}/${data.before_total_prompts}` : null, data.after_recommended_count!=null && data.after_total_prompts!=null ? `${data.after_recommended_count}/${data.after_total_prompts}` : null)}
        ${metricRow('Average position', data.before_avg_position, data.after_avg_position)}
      </div>
      ${data.executive_summary ? `<div style="margin-bottom:14px;"><div style="font-size:11px;font-weight:700;color:var(--muted-lt);text-transform:uppercase;letter-spacing:.03em;margin-bottom:6px;">Executive Summary</div><div style="font-size:13px;color:var(--ink);line-height:1.6;white-space:pre-wrap;">${escapeHtml(data.executive_summary)}</div></div>` : ''}
      ${data.what_ai_values ? `<div><div style="font-size:11px;font-weight:700;color:var(--muted-lt);text-transform:uppercase;letter-spacing:.03em;margin-bottom:6px;">What AI Values</div><div style="font-size:13px;color:var(--ink);line-height:1.6;white-space:pre-wrap;">${escapeHtml(data.what_ai_values)}</div></div>` : ''}
      ${!data.executive_summary && !data.what_ai_values ? `<p style="font-size:12.5px;color:var(--muted-lt);">No summary written for this report yet — open it to add one.</p>` : ''}
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeAppModal();openAiVisibilityReport('${id}')">Open full report</button>
      <button class="btn btn-brand" onclick="downloadAiVisibilityReportById('${id}')">Download PDF</button>
    </div>`, 560);
}

// Downloads a report's PDF straight from the list, without navigating
// into (and thereby also entering edit mode on) the full report first.
// Reuses downloadAiVisibilityReportPdf()'s existing generation logic by
// briefly populating aiVisibilityDraft with this report's data — safe to
// do since that variable sits at null while the list itself is showing
// (see closeAiVisibilityDetail()) — then restoring it back afterward.
async function downloadAiVisibilityReportById(id){
  const { data, error } = await supabaseClient.from('ai_visibility_reports').select('*').eq('id', id).maybeSingle();
  if(error || !data){ showToast('error','Could not load','Try again.'); return; }
  const previousDraft = aiVisibilityDraft;
  aiVisibilityDraft = {
    id: data.id, client_id: data.client_id, client_name_snapshot: data.client_name_snapshot||'',
    target_keyword: data.target_keyword||'', report_date: data.report_date,
    before_recommended_count: data.before_recommended_count, before_total_prompts: data.before_total_prompts, before_avg_position: data.before_avg_position,
    after_recommended_count: data.after_recommended_count, after_total_prompts: data.after_total_prompts, after_avg_position: data.after_avg_position,
    competitors: data.competitors || [],
    keywords: data.keywords && Object.keys(data.keywords).length ? data.keywords : { positive:{}, neutral:{}, negative:{} },
    concerns: data.concerns || [], links: data.links || { pressRelease:'', prPlacementReport:'', screenshotsFolder:'' },
    executive_summary: data.executive_summary||'',
    competitive_intelligence_summary: data.competitive_intelligence_summary||'',
    overview_summary: data.overview_summary||'', overview_matrix_data: data.overview_matrix_data||[],
    what_ai_values: data.what_ai_values||'',
    inhouse_client_id: data.inhouse_client_id||null,
  };
  downloadAiVisibilityReportPdf();
  aiVisibilityDraft = previousDraft;
}

async function deleteAiVisibilityReport(id){
  if(!(await confirmDialog('Delete this report? This cannot be undone.', {confirmLabel:'Delete', destructive:true}))) return;
  const { error } = await supabaseClient.from('ai_visibility_reports').delete().eq('id', id);
  if(error){ showToast('error','Could not delete','Try again.'); return; }
  showToast('success','Deleted','Report deleted.');
  renderAiVisibilityMain();
}

async function saveAiVisibilityReport(){
  const d = aiVisibilityDraft;
  if(!d) return;
  if(!d.client_name_snapshot.trim()){ showToast('error','Missing client','Pick or enter a client name first.'); return; }
  const btn = clickedBtn();
  setBtnLoading(btn, 'Saving…');
  const payload = {
    client_id: d.client_id, client_name_snapshot: d.client_name_snapshot.trim(), target_keyword: d.target_keyword.trim(), report_date: d.report_date,
    before_recommended_count: d.before_recommended_count, before_total_prompts: d.before_total_prompts, before_avg_position: d.before_avg_position,
    after_recommended_count: d.after_recommended_count, after_total_prompts: d.after_total_prompts, after_avg_position: d.after_avg_position,
    competitors: d.competitors, keywords: d.keywords, concerns: d.concerns, links: d.links,
    executive_summary: d.executive_summary,
    competitive_intelligence_summary: d.competitive_intelligence_summary,
    overview_summary: d.overview_summary, overview_matrix_data: d.overview_matrix_data,
    what_ai_values: d.what_ai_values,
    inhouse_client_id: d.inhouse_client_id,
    updated_at: new Date().toISOString(),
  };
  const result = d.id
    ? await supabaseClient.from('ai_visibility_reports').update(payload).eq('id', d.id).select('id').maybeSingle()
    : await supabaseClient.from('ai_visibility_reports').insert({ ...payload, created_by: currentUser.id }).select('id').maybeSingle();
  restoreBtn(btn);
  if(result.error){ showToast('error','Save failed', result.error.message || 'Try again.'); return; }
  const wasNew = !d.id;
  d.id = result.data.id;
  aiVisibilityCurrentReportId = d.id;
  showToast('success','Saved','Report saved.');
  // A brand-new report just got its real id for the first time — anyone
  // about to upload an Overview screenshot needs that id for the Storage
  // path, so refresh the screen now that it exists.
  if(wasNew) renderAiVisibilityMain();
}

// "What AIs Value" is filled in by actually researching the extracted
// competitors online — real web search via the same claude-chat.js
// endpoint's competitive-research mode — not by reading it off a
// screenshot, which doesn't reliably contain this section at all.
async function researchAiVisibilityWhatAiValues(){
  const d = aiVisibilityDraft;
  if(!d.competitors.length){ showToast('error','No competitors yet','Extract or add competitors first — this researches the businesses in that table.'); return; }
  const competitorNames = d.competitors.map(c=>c.name).filter(Boolean);
  if(!competitorNames.length){ showToast('error','No competitor names','The competitor table needs names before this can research them.'); return; }
  const prompt = `I'm researching why AI platforms (ChatGPT, Gemini, etc.) recommend certain local businesses over others for the search "${aiVisibilityDraft.target_keyword || 'this service'}".\n\nHere are the top-recommended competitors, based on AI visibility research:\n${competitorNames.map((n,i)=>`${i+1}. ${n}`).join('\n')}\n\nLook up these businesses online (their websites, reviews, what's written about them) and identify the COMMON FACTORS that seem to drive AI platforms to recommend businesses like these in this category — e.g. things like location, years in business, review volume/quality, pricing, warranty terms, service scope, or other attributes actually present across these specific businesses.\n\nWrite your findings as a short bulleted list (plain text, use "- " for bullets) of the factors themselves — no explanation per bullet, just the factor names, matching this style:\n- Location\n- Family owned businesses\n- Establishment / Age\n- Reviews (Quality and Quantity)\n- Price\n\nBase this on what you actually find about these specific businesses, not generic assumptions about the industry.`;
  const btn = clickedBtn();
  setBtnLoading(btn, 'Researching…');
  try{
    const { data: { session } } = await supabaseClient.auth.getSession();
    const response = await fetch('/api/claude-chat', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ mode:'competitive-research', prompt, provider: settings.aiProvider==='openai' ? 'openai' : 'claude' }),
    });
    const data = await response.json();
    if(!response.ok) throw new Error(data.error || 'Research failed');
    d.what_ai_values = (data.reply || '').trim();
    const textarea = document.getElementById('av_what_ai_values');
    if(textarea) textarea.value = d.what_ai_values;
    showToast('success','Researched','Review before saving — this is a first draft based on real web search, not a final answer.');
  }catch(e){
    showToast('error','Research failed', e.message || 'Try again.');
  }finally{
    restoreBtn(btn);
  }
}

// ---- RankScale CSV/Sheet import for Page 5 — a much cleaner data source
// than screenshots (structured columns, no vision ambiguity, no hidden
// "Show more" rows). Reuses parseCsv() from the client CSV-sync feature
// rather than adding a parsing library. Column names below match the
// exact RankScale export header row confirmed directly, not guessed. ----
const RANKSCALE_ENGINE_MAP = {
  'Bing Copilot': 'Copilot',
  'ChatGPT': 'ChatGPT',
  'DeepSeek V3': 'Deepseek',
  'Google AI Mode': 'AI Mode',
  'Google AI Overview': 'AI Overview',
  'Google Gemini': 'Gemini',
  'Perplexity': 'Perplexity',
};

function findRankscaleColumnIndex(headerRow, columnName){
  return headerRow.findIndex(h => h.trim().toLowerCase() === columnName.trim().toLowerCase());
}

// The exact delimiter RankScale uses within a multi-phrase cell isn't
// confirmed (no sample data row was available, only headers) — this tries
// semicolon first since it's the most common choice for multi-value CSV
// cells (commas inside a cell are usually reserved for CSV structure,
// not content), falling back to comma-splitting if no semicolon is found.
// Worth checking the imported result looks right the first time this runs.
function splitRankscaleKeywordCell(value){
  if(!value || !value.trim()) return [];
  const trimmed = value.trim();
  if(trimmed.includes(';')) return trimmed.split(';').map(s=>s.trim()).filter(Boolean);
  return trimmed.split(',').map(s=>s.trim()).filter(Boolean);
}

async function importRankscaleCsvForKeywords(fileInput){
  const d = aiVisibilityDraft;
  const file = fileInput.files[0];
  if(!file) return;
  const text = await file.text();
  if(!text.trim()){ showToast('error','Empty file','That CSV file looks empty.'); fileInput.value=''; return; }
  const rows = parseCsv(text);
  if(rows.length < 2){ showToast('error','No data found','Need a header row plus at least one data row.'); fileInput.value=''; return; }
  const headerRow = rows[0];
  const brandNameIdx = findRankscaleColumnIndex(headerRow, 'Brand Name');
  const isOwnBrandIdx = findRankscaleColumnIndex(headerRow, 'Is Own Brand');
  if(brandNameIdx === -1){ showToast('error','Unrecognized format','Could not find a "Brand Name" column — is this the right export?'); fileInput.value=''; return; }

  // Prefer the row RankScale itself flags as the agency's own brand —
  // this is why the whole "filter out competitors" problem has a clean
  // answer here, unlike the screenshot approach where every brand's data
  // looks the same visually. Falls back to matching the client's name if
  // that flag column isn't present or isn't set on any row.
  let targetRow = null;
  if(isOwnBrandIdx !== -1){
    targetRow = rows.slice(1).find(r => /^(true|yes|1)$/i.test((r[isOwnBrandIdx]||'').trim()));
  }
  if(!targetRow && d.client_name_snapshot){
    const clientNameLower = d.client_name_snapshot.trim().toLowerCase();
    targetRow = rows.slice(1).find(r => (r[brandNameIdx]||'').trim().toLowerCase() === clientNameLower);
  }
  if(!targetRow){
    showToast('error',"Could not find the client's row", `Looked for "Is Own Brand" = true, then for a Brand Name matching "${d.client_name_snapshot}" — neither matched. Check the client name or the CSV.`);
    fileInput.value='';
    return;
  }

  let mergedCount = 0;
  Object.keys(RANKSCALE_ENGINE_MAP).forEach(rankscaleEngine=>{
    const appPlatform = RANKSCALE_ENGINE_MAP[rankscaleEngine];
    ['positive','neutral','negative'].forEach(sentiment=>{
      const sentimentLabel = sentiment.charAt(0).toUpperCase()+sentiment.slice(1);
      const wgIdx = findRankscaleColumnIndex(headerRow, `WG ${rankscaleEngine} - ${sentimentLabel} Keywords`);
      const tdIdx = findRankscaleColumnIndex(headerRow, `TD ${rankscaleEngine} - ${sentimentLabel} Keywords`);
      const phrases = [];
      if(wgIdx !== -1) phrases.push(...splitRankscaleKeywordCell(targetRow[wgIdx]));
      if(tdIdx !== -1) phrases.push(...splitRankscaleKeywordCell(targetRow[tdIdx]));
      if(!phrases.length) return;
      if(!d.keywords[sentiment]) d.keywords[sentiment] = {};
      const existingLines = (d.keywords[sentiment][appPlatform] || '').split('\n').map(s=>s.trim()).filter(Boolean);
      const newLines = phrases.filter(p => !existingLines.includes(p));
      if(newLines.length){
        d.keywords[sentiment][appPlatform] = existingLines.concat(newLines).join('\n');
        mergedCount += newLines.length;
      }
    });
  });

  if(!mergedCount){
    showToast('error','Nothing new added',"Found the client's row, but no new phrases — check the CSV has data in the keyword columns, or everything is already entered.");
    fileInput.value='';
    return;
  }
  renderAiVisibilityMain();
  showToast('success','Imported', `Added ${mergedCount} phrase${mergedCount!==1?'s':''} from the CSV. Review before saving.`);
}

// ---- RankScale CSV import for Competitive Intelligence — a different
// export from the keywords one above: semicolon-delimited (RankScale
// includes a "sep=;" hint line for Excel, stripped before parsing), and
// includes the client's OWN row alongside competitors (Is Own Brand
// column) rather than filtering it out — matching how the original
// sample report displayed the client ranked among its competitors in one
// table, unlike Page 5 which is specifically about the client alone. ----
async function importRankscaleCsvForCompetitors(fileInput){
  const d = aiVisibilityDraft;
  const file = fileInput.files[0];
  if(!file) return;
  let text = await file.text();
  text = text.replace(/^\uFEFF?sep=.\r?\n/, ''); // strip the Excel delimiter-hint line, not real data
  if(!text.trim()){ showToast('error','Empty file','That CSV file looks empty.'); fileInput.value=''; return; }
  const rows = parseCsv(text, ';');
  if(rows.length < 2){ showToast('error','No data found','Need a header row plus at least one data row.'); fileInput.value=''; return; }
  const headerRow = rows[0];
  const nameIdx = findRankscaleColumnIndex(headerRow, 'Brand');
  if(nameIdx === -1){ showToast('error','Unrecognized format','Could not find a "Brand" column — is this the right export?'); fileInput.value=''; return; }
  const positionIdx = findRankscaleColumnIndex(headerRow, 'Position (Average Rank)');
  const top3Idx = findRankscaleColumnIndex(headerRow, 'Top 3 Rate (%)');
  const sentimentIdx = findRankscaleColumnIndex(headerRow, 'Sentiment (%)');
  const mentionsIdx = findRankscaleColumnIndex(headerRow, 'Mentions');
  const citationsIdx = findRankscaleColumnIndex(headerRow, 'Citations');
  const visibilityIdx = findRankscaleColumnIndex(headerRow, 'Visibility Score (%)');

  const competitors = rows.slice(1).map((r,i) => ({
    rank: i+1, // RankScale's export is already rank-ordered; no explicit rank column to read
    name: (r[nameIdx]||'').trim(),
    position: positionIdx!==-1 && r[positionIdx] ? `#${r[positionIdx].trim()}` : '',
    top3Pct: top3Idx!==-1 && r[top3Idx] ? `${r[top3Idx].trim()}%` : '',
    sentimentPct: sentimentIdx!==-1 && r[sentimentIdx] ? `${r[sentimentIdx].trim()}%` : '',
    mentions: mentionsIdx!==-1 ? r[mentionsIdx].trim() : '',
    citations: citationsIdx!==-1 ? r[citationsIdx].trim() : '',
    visibilityPct: visibilityIdx!==-1 && r[visibilityIdx] ? `${r[visibilityIdx].trim()}%` : '',
  })).filter(c => c.name);

  if(!competitors.length){ showToast('error','No rows found','The CSV had no usable competitor rows.'); fileInput.value=''; return; }
  if(d.competitors.length){
    const confirmed = await confirmDialog(`This will replace the ${d.competitors.length} competitor${d.competitors.length!==1?'s':''} already in the table with the ${competitors.length} from this CSV. Continue?`, { confirmLabel:'Replace' });
    if(!confirmed){ fileInput.value=''; return; }
  }
  d.competitors = competitors;
  renderAiVisibilityMain();
  showToast('success','Imported', `Added ${competitors.length} competitor${competitors.length!==1?'s':''} from the CSV.`);
}






// ---- Competitor table mutators (Page 6) ----
function addAiVisibilityCompetitor(){
  aiVisibilityDraft.competitors.push({ rank: aiVisibilityDraft.competitors.length+1, name:'', position:'', top3Pct:'', sentimentPct:'', mentions:'', citations:'', visibilityPct:'' });
  renderAiVisibilityMain();
}
function removeAiVisibilityCompetitor(i){
  aiVisibilityDraft.competitors.splice(i,1);
  renderAiVisibilityMain();
}
function updateAiVisibilityCompetitorField(i, field, value){
  aiVisibilityDraft.competitors[i][field] = value;
}

// ---- Keyword list helpers (Page 5) — stored as {sentiment: {platform: "one phrase (count) per line"}} while editing, parsed into arrays only when needed for the AI context builder ----
function updateAiVisibilityKeywords(sentiment, platform, value){
  if(!aiVisibilityDraft.keywords[sentiment]) aiVisibilityDraft.keywords[sentiment] = {};
  aiVisibilityDraft.keywords[sentiment][platform] = value;
}

// ---- Concerns list mutators (Page "Concerns", low priority per the sample report) ----
function addAiVisibilityConcern(){
  aiVisibilityDraft.concerns.push({ platform:'', quote:'', source:'' });
  renderAiVisibilityMain();
}
function removeAiVisibilityConcern(i){
  aiVisibilityDraft.concerns.splice(i,1);
  renderAiVisibilityMain();
}
function updateAiVisibilityConcernField(i, field, value){
  aiVisibilityDraft.concerns[i][field] = value;
}

function narrativeSectionHtml(fieldName, title, placeholder){
  const d = aiVisibilityDraft;
  return `
    <div class="panel" style="margin-bottom:20px;">
      <div class="panel-head"><span class="panel-title">${escapeHtml(title)}</span><button class="btn btn-outline" onclick="generateAiVisibilitySection('${fieldName}')">✨ Generate with AI</button></div>
      <div class="panel-body">
        <textarea id="av_${escapeHtml(fieldName)}" style="width:100%;min-height:110px;font-family:var(--font);font-size:13px;padding:10px;border-radius:8px;border:1px solid var(--border);resize:vertical;" placeholder="${placeholder}" onchange="aiVisibilityDraft.${fieldName}=this.value">${escapeHtml(d[fieldName]||'')}</textarea>
      </div>
    </div>`;
}

function renderAiVisibilityDetail(el){
  const d = aiVisibilityDraft;
  const qm = computeAiVisibilityQuickMetrics(d);

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <span class="row-link" onclick="closeAiVisibilityDetail()">← All reports</span>
      <div style="display:flex;gap:10px;">
        ${d.id ? `<button class="btn btn-outline" onclick="downloadAiVisibilityReport()">Download .txt</button>` : ''}
        ${d.id ? `<button class="btn btn-outline" onclick="downloadAiVisibilityReportPdf()">Download PDF</button>` : ''}
        <button class="btn btn-brand" onclick="saveAiVisibilityReport()">Save report</button>
      </div>
    </div>

    <div class="panel" style="margin-bottom:20px;">
      <div class="panel-head"><span class="panel-title">Report details</span></div>
      <div class="panel-body">
        <div class="form-grid">
          <div>
            <label>Client</label>
            <select id="avClientId" onchange="onReportClientChanged(this.value)">
              <option value="">${inhouseMetricsClients.length ? 'Select a client…' : 'Loading…'}</option>
              ${inhouseMetricsClients.map(c=>`<option value="${c.id}" ${String(c.id)===d.inhouse_client_id?'selected':''}>${escapeHtml(c.name)}</option>`).join('')}
            </select>
            <p style="font-size:10.5px;color:var(--muted-lt);margin:4px 0 0;">Pulled from the in-house tracking tool, not Based Agency's own client list — this report's data all comes from there.</p>
          </div>
          <div><label>Target keyword</label><input id="avKeyword" value="${escapeHtml(d.target_keyword||'')}" onchange="aiVisibilityDraft.target_keyword=this.value"></div>
          <div style="position:relative;"><label>Report date</label>${datePickerFieldHtml('avReportDate', { value: d.report_date })}</div>
        </div>
        <div class="form-grid" style="margin-top:14px;">
          <div><label>Press release link</label><input id="avLinkPr" value="${escapeHtml(d.links.pressRelease||'')}" onchange="aiVisibilityDraft.links.pressRelease=this.value" placeholder="Google Drive link"></div>
          <div><label>PR placement report link</label><input id="avLinkPlacement" value="${escapeHtml(d.links.prPlacementReport||'')}" onchange="aiVisibilityDraft.links.prPlacementReport=this.value" placeholder="Google Drive link"></div>
          <div><label>Screenshots folder link</label><input id="avLinkScreenshots" value="${escapeHtml(d.links.screenshotsFolder||'')}" onchange="aiVisibilityDraft.links.screenshotsFolder=this.value" placeholder="Google Drive link"></div>
        </div>
      </div>
    </div>

    <div class="panel" style="margin-bottom:20px;">
      <div class="panel-head"><span class="panel-title">Quick Metrics</span><span class="pill pill-good">Automated</span></div>
      <div class="panel-body">
        <div style="margin-bottom:16px;padding:12px;background:var(--surface-2);border-radius:8px;">
          <div style="font-size:12.5px;font-weight:700;color:var(--ink);margin-bottom:10px;">Pull from in-house tool</div>
          <p style="font-size:11px;color:var(--muted-lt);margin:0 0 10px;">Populates Quick Metrics AND the Overview matrix together, directly from real data — no screenshot needed. Pulls automatically once both scans below are selected.</p>
          <div class="form-grid">
            <div><label style="font-size:11px;">Before scan</label><select id="inhouseBeforeScanSelect" onchange="onInhouseMetricsScanSelectionChanged()"><option value="">${d.inhouse_client_id ? 'Pick a scan' : 'Pick a client above first'}</option></select></div>
            <div><label style="font-size:11px;">After scan</label><select id="inhouseAfterScanSelect" onchange="onInhouseMetricsScanSelectionChanged()"><option value="">${d.inhouse_client_id ? 'Pick a scan' : 'Pick a client above first'}</option></select></div>
          </div>
        </div>
        <div class="form-grid">
          <div><label>Before — recommended in (of total prompts)</label><div style="display:flex;gap:6px;align-items:center;"><input type="number" min="0" style="width:80px;" value="${d.before_recommended_count??''}" onchange="aiVisibilityDraft.before_recommended_count=this.value?Number(this.value):null;renderAiVisibilityMain();"><span>/</span><input type="number" min="0" style="width:80px;" value="${d.before_total_prompts??''}" onchange="aiVisibilityDraft.before_total_prompts=this.value?Number(this.value):null;renderAiVisibilityMain();"></div></div>
          <div><label>Before — average ranking position</label><input type="number" min="0" step="0.1" value="${d.before_avg_position??''}" onchange="aiVisibilityDraft.before_avg_position=this.value?Number(this.value):null;renderAiVisibilityMain();"></div>
          <div><label>After — recommended in (of total prompts)</label><div style="display:flex;gap:6px;align-items:center;"><input type="number" min="0" style="width:80px;" value="${d.after_recommended_count??''}" onchange="aiVisibilityDraft.after_recommended_count=this.value?Number(this.value):null;renderAiVisibilityMain();"><span>/</span><input type="number" min="0" style="width:80px;" value="${d.after_total_prompts??''}" onchange="aiVisibilityDraft.after_total_prompts=this.value?Number(this.value):null;renderAiVisibilityMain();"></div></div>
          <div><label>After — average ranking position</label><input type="number" min="0" step="0.1" value="${d.after_avg_position??''}" onchange="aiVisibilityDraft.after_avg_position=this.value?Number(this.value):null;renderAiVisibilityMain();"></div>
        </div>
        ${qm.summary ? `<p style="font-size:13px;color:var(--ink);line-height:1.6;margin:16px 0 0;padding:12px;background:var(--surface-2);border-radius:8px;">${escapeHtml(qm.summary)}</p>` : `<p style="font-size:12px;color:var(--muted-lt);margin:16px 0 0;">Fill in all four before/after fields to generate the summary automatically.</p>`}
      </div>
    </div>

    <div class="panel" style="margin-bottom:20px;">
      <div class="panel-head"><span class="panel-title">Overview</span></div>
      <div class="panel-body">
        <p style="font-size:11.5px;color:var(--muted-lt);margin:0 0 14px;line-height:1.5;">Filled in automatically by "Pull data" above — computed directly from real before/after position data, not read off a screenshot. Still editable by hand if anything needs adjusting.</p>
        <textarea id="av_overview_summary" style="width:100%;min-height:130px;font-family:var(--font);font-size:13px;padding:10px;border-radius:8px;border:1px solid var(--border);resize:vertical;" placeholder="Net gainers:&#10;- ...&#10;&#10;Net losers / concerning:&#10;- ..." onchange="aiVisibilityDraft.overview_summary=this.value">${escapeHtml(d.overview_summary||'')}</textarea>
      </div>
    </div>

    <div class="panel" style="margin-bottom:20px;">
      <div class="panel-head"><span class="panel-title">Positive / Neutral / Negative Associations</span></div>
      <div class="panel-body">
        <label style="font-size:12.5px;font-weight:700;color:var(--ink);display:block;margin-bottom:8px;">Import from a RankScale CSV/Sheet export</label>
        <p style="font-size:11.5px;color:var(--muted-lt);margin:0 0 10px;line-height:1.5;">Upload the exported CSV file — this pulls out only the client's own row (using RankScale's "Is Own Brand" column, or matching the client name), so competitor rows in the same export are ignored automatically.</p>
        <input type="file" accept=".csv,text/csv" onchange="importRankscaleCsvForKeywords(this)">
        <p style="font-size:11.5px;color:var(--muted-lt);margin:16px 0 14px;">One phrase per line per cell below, optionally ending in a count like "(2)" — still editable by hand at any time.</p>
        <div class="table-scroll-wrap">
          <table>
            <thead><tr><th style="width:80px;">Sentiment</th>${AI_VISIBILITY_PLATFORMS.map(p=>`<th style="min-width:150px;">${p}</th>`).join('')}</tr></thead>
            <tbody>
              ${['positive','neutral','negative'].map(sentiment=>`
                <tr>
                  <td style="text-transform:capitalize;font-weight:700;white-space:nowrap;vertical-align:top;">${escapeHtml(sentiment)}</td>
                  ${AI_VISIBILITY_PLATFORMS.map(p=>`
                    <td><textarea style="width:100%;min-height:90px;font-family:var(--font);font-size:12px;padding:6px 8px;border-radius:6px;border:1px solid var(--border);resize:vertical;" onchange="updateAiVisibilityKeywords('${sentiment}','${p}',this.value)">${escapeHtml((d.keywords[sentiment]||{})[p]||'')}</textarea></td>
                  `).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="panel" style="margin-bottom:20px;">
      <div class="panel-head"><span class="panel-title">Competitive Intelligence</span></div>
      <div class="panel-body">
        <label style="font-size:12.5px;font-weight:700;color:var(--ink);display:block;margin-bottom:8px;">Import from a RankScale CSV export</label>
        <p style="font-size:11.5px;color:var(--muted-lt);margin:0 0 10px;line-height:1.5;">Upload the competitors export — includes the client's own row alongside competitors (matching how it displays in the final report), so nothing needs filtering out.</p>
        <input type="file" accept=".csv,text/csv" onchange="importRankscaleCsvForCompetitors(this)">
        <div class="table-scroll-wrap" style="margin-top:16px;">
          <table>
            <thead><tr><th>Rank</th><th>Competitor</th><th>Position</th><th>Top 3%</th><th>Sentiment%</th><th>Mentions</th><th>Citations</th><th>Visibility%</th><th></th></tr></thead>
            <tbody>
              ${d.competitors.map((c,i)=>`
                <tr>
                  <td><input type="number" style="width:50px;" value="${c.rank??''}" onchange="updateAiVisibilityCompetitorField(${i},'rank',this.value)"></td>
                  <td><input type="text" style="width:100%;min-width:140px;" value="${escapeHtml(c.name||'')}" onchange="updateAiVisibilityCompetitorField(${i},'name',this.value)"></td>
                  <td><input type="text" style="width:60px;" value="${escapeHtml((c.position||'').toString())}" onchange="updateAiVisibilityCompetitorField(${i},'position',this.value)" placeholder="#1.0"></td>
                  <td><input type="text" style="width:60px;" value="${escapeHtml((c.top3Pct||'').toString())}" onchange="updateAiVisibilityCompetitorField(${i},'top3Pct',this.value)" placeholder="71.9%"></td>
                  <td><input type="text" style="width:60px;" value="${escapeHtml((c.sentimentPct||'').toString())}" onchange="updateAiVisibilityCompetitorField(${i},'sentimentPct',this.value)" placeholder="91.7%"></td>
                  <td><input type="number" style="width:60px;" value="${c.mentions??''}" onchange="updateAiVisibilityCompetitorField(${i},'mentions',this.value)"></td>
                  <td><input type="number" style="width:60px;" value="${c.citations??''}" onchange="updateAiVisibilityCompetitorField(${i},'citations',this.value)"></td>
                  <td><input type="text" style="width:60px;" value="${escapeHtml((c.visibilityPct||'').toString())}" onchange="updateAiVisibilityCompetitorField(${i},'visibilityPct',this.value)" placeholder="81.8%"></td>
                  <td><span class="row-link" style="color:var(--red);" onclick="removeAiVisibilityCompetitor(${i})">✕</span></td>
                </tr>
              `).join('') || `<tr><td colspan="9" style="color:var(--muted-lt);font-size:12px;">No competitors added yet.</td></tr>`}
            </tbody>
          </table>
        </div>
        <button class="btn btn-outline" style="margin:10px 0 18px;" onclick="addAiVisibilityCompetitor()">+ Add competitor</button>
        <textarea id="av_competitive_intelligence_summary" style="width:100%;min-height:110px;font-family:var(--font);font-size:13px;padding:10px;border-radius:8px;border:1px solid var(--border);resize:vertical;" placeholder="Narrative analysis of competitive position..." onchange="aiVisibilityDraft.competitive_intelligence_summary=this.value">${escapeHtml(d.competitive_intelligence_summary||'')}</textarea>
        <button class="btn btn-outline" style="margin-top:8px;" onclick="generateAiVisibilitySection('competitive_intelligence_summary')">✨ Generate with AI</button>
        <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border);">
          <label style="font-size:12.5px;font-weight:700;color:var(--ink);display:block;margin-bottom:8px;">What AIs Value</label>
          <p style="font-size:11.5px;color:var(--muted-lt);margin:0 0 10px;line-height:1.5;">Not read off the screenshot — this comes from actually researching the competitors above online (their websites, reviews, what's said about them) to identify what's really driving AI recommendations in this category.</p>
          <button class="btn btn-brand" style="margin-bottom:10px;" onclick="researchAiVisibilityWhatAiValues()" ${!d.competitors.length ? 'disabled' : ''}>🔍 Research competitors &amp; fill in</button>
          <textarea id="av_what_ai_values" style="width:100%;min-height:130px;font-family:var(--font);font-size:13px;padding:10px;border-radius:8px;border:1px solid var(--border);resize:vertical;" placeholder="- Location&#10;- Family owned businesses&#10;- Establishment / age&#10;- ..." onchange="aiVisibilityDraft.what_ai_values=this.value">${escapeHtml(d.what_ai_values||'')}</textarea>
          <p style="font-size:11px;color:var(--muted-lt);margin:6px 0 0;">Real web search, not a guess — still editable by hand, and worth reviewing before saving.</p>
        </div>
      </div>
    </div>

    <div class="panel" style="margin-bottom:20px;">
      <div class="panel-head"><span class="panel-title">Special Concerns <span style="font-weight:400;color:var(--muted-lt);font-size:11px;">(optional — usually only for notable callouts)</span></span></div>
      <div class="panel-body">
        ${d.concerns.map((c,i)=>`
          <div style="display:flex;gap:8px;margin-bottom:8px;align-items:flex-start;">
            <input type="text" style="width:140px;flex:none;" placeholder="Platform" value="${escapeHtml(c.platform||'')}" onchange="updateAiVisibilityConcernField(${i},'platform',this.value)">
            <textarea style="flex:1;min-height:44px;font-family:var(--font);font-size:12.5px;padding:8px;border-radius:6px;border:1px solid var(--border);resize:vertical;" placeholder="Quoted concern" onchange="updateAiVisibilityConcernField(${i},'quote',this.value)">${escapeHtml(c.quote||'')}</textarea>
            <span class="row-link" style="color:var(--red);flex:none;margin-top:8px;" onclick="removeAiVisibilityConcern(${i})">✕</span>
          </div>
        `).join('')}
        <button class="btn btn-outline" onclick="addAiVisibilityConcern()">+ Add concern</button>
      </div>
    </div>

    <div class="panel" style="margin-bottom:20px;">
      <div class="panel-head"><span class="panel-title">Executive Summary</span></div>
      <div class="panel-body">
        <p style="font-size:11px;color:var(--muted-lt);margin:0 0 12px;line-height:1.5;">Saved last in this editor on purpose — it summarizes everything above, so it reads better written (or generated) once the rest of the report actually has content. It still appears first in the downloaded report itself.</p>
        <textarea id="av_executive_summary" style="width:100%;min-height:110px;font-family:var(--font);font-size:13px;padding:10px;border-radius:8px;border:1px solid var(--border);resize:vertical;" placeholder="The high-level takeaway a client reads first..." onchange="aiVisibilityDraft.executive_summary=this.value">${escapeHtml(d.executive_summary||'')}</textarea>
        <button class="btn btn-outline" style="margin-top:8px;" onclick="generateAiVisibilitySection('executive_summary')">✨ Generate with AI</button>
      </div>
    </div>

    <div style="display:flex;justify-content:flex-end;gap:10px;margin-bottom:40px;">
      ${d.id ? `<button class="btn btn-outline" onclick="downloadAiVisibilityReport()">Download .txt</button>` : ''}
        ${d.id ? `<button class="btn btn-outline" onclick="downloadAiVisibilityReportPdf()">Download PDF</button>` : ''}
      <button class="btn btn-brand" onclick="saveAiVisibilityReport()">Save report</button>
    </div>`;

  const dateInput = document.getElementById('avReportDate');
  if(dateInput) dateInput.addEventListener('change', function(){ aiVisibilityDraft.report_date = this.value; });

  // Both in-house pull panels are always visible now (no toggle to
  // trigger loading on demand), so this has to happen on every render
  // instead: load the client list if it isn't cached yet, then — whether
  // it was just loaded or already cached — populate the scan dropdowns if
  // a client is already linked. Necessary because this function rebuilds
  // the whole panel's HTML from scratch each time, which resets those
  // dropdowns back to their placeholder state.
  (async () => {
    if(!inhouseMetricsClients.length) await loadInhouseMetricsClientsForPicker();
    if(d.inhouse_client_id) onInhouseClientMatched();
  })();
}

// The report's own Client field now pulls directly from the in-house
// tool rather than Based Agency's own client list — this report's data
// (Quick Metrics, Overview, keywords) all comes from there, so selecting
// the client from that same source removes the name-matching step
// entirely instead of relying on it.
async function onReportClientChanged(inhouseClientId){
  const d = aiVisibilityDraft;
  const selected = inhouseMetricsClients.find(c=>String(c.id)===inhouseClientId);
  d.inhouse_client_id = inhouseClientId || null;
  d.client_name_snapshot = selected ? selected.name : d.client_name_snapshot;
  // Still tries to link back to a matching Based Agency client by name
  // (case-insensitive) — client_id is a real FK on this table, and other
  // tooling may eventually expect it, so this keeps it populated where a
  // match exists rather than always leaving it null now that it's no
  // longer the field being directly selected.
  const matchingAgencyClient = clients.find(c=>(c.name||'').trim().toLowerCase() === (selected?.name||'').trim().toLowerCase());
  d.client_id = matchingAgencyClient ? matchingAgencyClient.id : null;
  if(inhouseClientId) await onInhouseClientMatched();
  renderAiVisibilityMain();
}

// Same manual-drawing jsPDF pattern already established by
// exportReportPdf() elsewhere in this file (no autotable plugin loaded) —
// consistent with the rest of this app rather than introducing a second
// PDF-building approach. Deliberately not trying to replicate the
// original report's heavy red-bordered box style — clean section headers
// in the brand color, generous whitespace, one section per page.
function extractImageFormatFromDataUrl(dataUrl){
  const match = /^data:image\/(\w+);base64,/.exec(dataUrl||'');
  if(!match) return 'PNG';
  const fmt = match[1].toUpperCase();
  return fmt === 'JPG' ? 'JPEG' : fmt;
}

function downloadAiVisibilityReportPdf(){
  const d = aiVisibilityDraft;
  if(!d) return;
  if(!window.jspdf){ showToast('error','PDF library not loaded','Check your connection and try again.'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 14;
  const brand = [232, 98, 44]; // approximates this app's brand orange
  let y = 20;

  const sectionHeader = (title) => {
    if(y > 260){ doc.addPage(); y = 20; }
    doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.setTextColor(brand[0],brand[1],brand[2]);
    doc.text(title, marginX, y); y += 2;
    doc.setDrawColor(brand[0],brand[1],brand[2]); doc.setLineWidth(0.5);
    doc.line(marginX, y, pageWidth-marginX, y);
    y += 7;
  };
  const bodyText = (text, opts={}) => {
    doc.setFont('helvetica', opts.bold?'bold':'normal'); doc.setFontSize(opts.size||10);
    doc.setTextColor(...(opts.color||[50,50,50]));
    const lines = doc.splitTextToSize(text || '', pageWidth - marginX*2 - (opts.indent||0));
    lines.forEach(line=>{
      if(y > 280){ doc.addPage(); y = 20; }
      doc.text(line, marginX + (opts.indent||0), y);
      y += (opts.lineHeight || 5.5);
    });
    y += 3;
  };
  // Manual table drawing — no autotable plugin loaded in this app, so this
  // handles its own column layout, text wrapping within cells (computing
  // each row's height from its tallest cell), and re-drawing the header
  // row when a table spans a page break.
  const drawTable = (headers, colWidths, rows) => {
    const totalWidth = colWidths.reduce((a,b)=>a+b,0);
    const lineHeight = 4;
    const cellPad = 2.5;
    const drawHeaderRow = () => {
      doc.setFillColor(245,245,245);
      doc.rect(marginX, y, totalWidth, 7, 'F');
      doc.setFont('helvetica','bold'); doc.setFontSize(8.5); doc.setTextColor(40,40,40);
      let x = marginX;
      headers.forEach((h,i)=>{ doc.text(h, x+cellPad, y+5); x += colWidths[i]; });
      y += 7;
      doc.setDrawColor(200); doc.setLineWidth(0.3);
      doc.line(marginX, y, marginX+totalWidth, y);
    };
    if(y + 7 > 275){ doc.addPage(); y = 20; }
    drawHeaderRow();
    doc.setFont('helvetica','normal'); doc.setFontSize(8);
    rows.forEach(row=>{
      const cellLines = row.map((cell,i)=>doc.splitTextToSize(String(cell??'—'), colWidths[i]-cellPad*2));
      const maxLines = Math.max(...cellLines.map(l=>l.length), 1);
      const rowHeight = maxLines*lineHeight + 3;
      if(y + rowHeight > 280){ doc.addPage(); y = 20; drawHeaderRow(); doc.setFont('helvetica','normal'); doc.setFontSize(8); }
      let x = marginX;
      doc.setTextColor(60,60,60);
      cellLines.forEach((lines,i)=>{
        lines.forEach((line,li)=>{ doc.text(line, x+cellPad, y+lineHeight*(li+1)); });
        x += colWidths[i];
      });
      y += rowHeight;
      doc.setDrawColor(230); doc.setLineWidth(0.15);
      doc.line(marginX, y, marginX+totalWidth, y);
    });
    y += 6;
  };
  // Color-coded prompt x platform matrix, matching the visibility tool's
  // own legend — dark green/red for gained/regression, light green/pink
  // for sustained/no-change, gray for needs-rerun/not-run. Stays in
  // portrait rather than switching page orientation mid-document; with 10
  // platform columns the cells are narrow but a bare number or "—" still
  // reads fine at that width.
  const AI_VISIBILITY_MATRIX_COLORS = {
    gained: [27,94,32], sustained: [200,230,201], nochange: [248,215,218],
    regression: [183,28,28], rerun: [158,158,158], notrun: [224,224,224],
  };
  const drawColorMatrix = (matrixRows) => {
    if(!matrixRows.length) return;
    const promptColWidth = 50;
    const platformColWidth = (pageWidth - marginX*2 - promptColWidth) / AI_VISIBILITY_PLATFORMS.length;
    const promptLineHeight = 3.3;
    const minRowHeight = 8;
    const drawHeaderRow = () => {
      doc.setFillColor(245,245,245);
      doc.rect(marginX, y, pageWidth-marginX*2, minRowHeight, 'F');
      doc.setFont('helvetica','bold'); doc.setFontSize(6.5); doc.setTextColor(40,40,40);
      doc.text('Prompt', marginX+2, y+5.5);
      let x = marginX+promptColWidth;
      AI_VISIBILITY_PLATFORMS.forEach(p=>{
        const lines = doc.splitTextToSize(p, platformColWidth-2);
        doc.text(lines[0]||'', x+1, y+5.5);
        x += platformColWidth;
      });
      y += minRowHeight;
    };
    if(y + minRowHeight > 260){ doc.addPage(); y = 20; }
    drawHeaderRow();
    matrixRows.forEach(row=>{
      doc.setFont('helvetica','normal'); doc.setFontSize(6);
      // Full prompt text, wrapped across as many lines as it needs — the
      // row itself grows to fit, rather than truncating to one line.
      const promptLines = doc.splitTextToSize(row.prompt||'', promptColWidth-4);
      const rowHeight = Math.max(minRowHeight, promptLines.length*promptLineHeight + 4);
      if(y + rowHeight > 280){ doc.addPage(); y = 20; drawHeaderRow(); doc.setFont('helvetica','normal'); doc.setFontSize(6); }
      doc.setFillColor(250,250,250);
      doc.rect(marginX, y, promptColWidth, rowHeight, 'F');
      doc.setTextColor(40,40,40);
      promptLines.forEach((line,li)=>{ doc.text(line, marginX+2, y+promptLineHeight*(li+1)+1); });
      let x = marginX + promptColWidth;
      AI_VISIBILITY_PLATFORMS.forEach(p=>{
        const cell = row.cells[p] || { value:'—', color:'notrun' };
        const rgb = AI_VISIBILITY_MATRIX_COLORS[cell.color] || AI_VISIBILITY_MATRIX_COLORS.notrun;
        doc.setFillColor(rgb[0], rgb[1], rgb[2]);
        doc.rect(x, y, platformColWidth, rowHeight, 'F');
        const isDark = cell.color==='gained' || cell.color==='regression';
        doc.setTextColor(isDark?255:40, isDark?255:40, isDark?255:40);
        doc.setFontSize(7);
        const val = String(cell.value||'—');
        const textW = doc.getTextWidth(val);
        doc.text(val, x + platformColWidth/2 - textW/2, y + rowHeight/2 + 1.5);
        x += platformColWidth;
      });
      y += rowHeight;
    });
    doc.setDrawColor(255); doc.setLineWidth(0.3);
    y += 6;
  };
  // Parses the plain-text overview_summary (its "Net gainers:"/"Net
  // losers / concerning:" sub-headers) into two arrays, so each can be
  // drawn in its own separate, colored box rather than as one undifferentiated
  // block of text.
  const parseOverviewSummaryForPdf = (summary) => {
    const lines = (summary||'').split('\n');
    let section = null;
    const gainers = [], losers = [];
    lines.forEach(line=>{
      const trimmed = line.trim();
      if(!trimmed) return;
      if(/^net gainers:?$/i.test(trimmed)){ section = 'gainers'; return; }
      if(/^net losers/i.test(trimmed)){ section = 'losers'; return; }
      if(trimmed.startsWith('-')){
        const item = trimmed.replace(/^-\s*/,'').trim();
        if(section === 'gainers') gainers.push(item);
        else if(section === 'losers') losers.push(item);
      }
    });
    return { gainers, losers };
  };
  // One box per section (gainers / losers) — bordered, with a colored left
  // edge and an orange heading, so the two are visually distinct instead
  // of running together as plain text.
  const drawGainersLosersBox = (title, items, accentColor) => {
    const boxWidth = pageWidth - marginX*2;
    const padding = 5;
    const lineHeight = 4.3;
    doc.setFont('helvetica','normal'); doc.setFontSize(8.5);
    const displayItems = items.length ? items : ['None'];
    const itemLines = displayItems.map(item => doc.splitTextToSize(`•  ${item}`, boxWidth - padding*2));
    const totalLines = itemLines.reduce((sum,lines)=>sum+lines.length, 0);
    const boxHeight = 13 + totalLines*lineHeight + 3;
    if(y + boxHeight > 280){ doc.addPage(); y = 20; }
    doc.setDrawColor(225); doc.setLineWidth(0.3);
    doc.roundedRect(marginX, y, boxWidth, boxHeight, 2, 2);
    doc.setFillColor(accentColor[0], accentColor[1], accentColor[2]);
    doc.rect(marginX, y, 2.2, boxHeight, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(10.5); doc.setTextColor(brand[0],brand[1],brand[2]);
    doc.text(title, marginX+padding, y+8);
    let itemY = y+15;
    doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(60,60,60);
    itemLines.forEach(lines=>{ lines.forEach(line=>{ doc.text(line, marginX+padding, itemY); itemY += lineHeight; }); });
    y += boxHeight + 6;
  };

  // ---- Header: Based Agency branding ----
  let brandingDrawn = false;
  if(settings.appIcon){
    try{
      doc.addImage(settings.appIcon, extractImageFormatFromDataUrl(settings.appIcon), marginX, 10, 14, 14);
      doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.setTextColor(20);
      doc.text(settings.appName || 'Based Agency', marginX + 18, 19);
      brandingDrawn = true;
    }catch(e){ /* falls through to text-only branding below */ }
  }
  if(!brandingDrawn){
    doc.setFont('helvetica','bold'); doc.setFontSize(17); doc.setTextColor(brand[0],brand[1],brand[2]);
    doc.text((settings.appName || 'Based Agency').toUpperCase(), marginX, 19);
  }
  doc.setDrawColor(brand[0],brand[1],brand[2]); doc.setLineWidth(0.8);
  doc.line(marginX, 26, pageWidth-marginX, 26);
  y = 40;

  // ---- Title block ----
  doc.setFont('helvetica','bold'); doc.setFontSize(21); doc.setTextColor(20);
  doc.text('AI Visibility Report', marginX, y); y += 10;
  doc.setFont('helvetica','normal'); doc.setFontSize(14); doc.setTextColor(70);
  doc.text(d.client_name_snapshot || 'Untitled client', marginX, y); y += 8;
  doc.setFontSize(10); doc.setTextColor(120);
  doc.text(`Target keyword: ${d.target_keyword || 'n/a'}`, marginX, y); y += 5;
  doc.text(`Report date: ${new Date(d.report_date+'T00:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}`, marginX, y); y += 5;
  if(d.links.pressRelease) { doc.text(`Press release: ${d.links.pressRelease}`, marginX, y); y += 5; }
  if(d.links.prPlacementReport) { doc.text(`PR placement report: ${d.links.prPlacementReport}`, marginX, y); y += 5; }
  if(d.links.screenshotsFolder) { doc.text(`Screenshots folder: ${d.links.screenshotsFolder}`, marginX, y); y += 5; }
  y += 6;

  // ---- Page 1: Executive Summary ----
  sectionHeader('Executive Summary');
  bodyText(d.executive_summary || 'Not yet written.');

  // ---- Page 2: Quick Metrics ----
  doc.addPage(); y = 20;
  sectionHeader('Quick Metrics');
  const qm = computeAiVisibilityQuickMetrics(d);
  const drawMetricsBox = (x, label, recommended, total, pct, avgPos) => {
    doc.setDrawColor(220); doc.setLineWidth(0.3);
    doc.roundedRect(x, y, (pageWidth-marginX*2-6)/2, 28, 2, 2);
    doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(120);
    doc.text(label.toUpperCase(), x+6, y+8);
    doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(40);
    doc.text(`Recommended: ${recommended??'—'}/${total??'—'}${pct!=null?` (${pct}%)`:''}`, x+6, y+16);
    doc.text(`Avg. ranking position: ${avgPos??'—'}`, x+6, y+23);
  };
  const boxWidth = (pageWidth-marginX*2-6)/2;
  drawMetricsBox(marginX, 'Before', d.before_recommended_count, d.before_total_prompts, qm.beforePct, d.before_avg_position);
  drawMetricsBox(marginX+boxWidth+6, 'After', d.after_recommended_count, d.after_total_prompts, qm.afterPct, d.after_avg_position);
  y += 36;
  bodyText(qm.summary || 'Fill in all four before/after fields in the report to generate this summary.');

  // ---- Overview: matrix first, then Net Gainers/Losers below it in
  // their own colored boxes (from the uploaded screenshot) ----
  doc.addPage(); y = 20;
  sectionHeader('Overview');
  if(d.overview_matrix_data && d.overview_matrix_data.length) drawColorMatrix(d.overview_matrix_data);
  if(d.overview_summary && d.overview_summary.trim()){
    const { gainers, losers } = parseOverviewSummaryForPdf(d.overview_summary);
    drawGainersLosersBox('Net Gainers', gainers, AI_VISIBILITY_MATRIX_COLORS.gained);
    drawGainersLosersBox('Net Losers / Concerning', losers, AI_VISIBILITY_MATRIX_COLORS.regression);
  } else {
    bodyText('Not yet written.');
  }

  // ---- Positive/Neutral/Negative Associations ----
  doc.addPage(); y = 20;
  sectionHeader('Positive / Neutral / Negative Associations');
  const keywordRows = [];
  ['positive','neutral','negative'].forEach(sentiment=>{
    AI_VISIBILITY_PLATFORMS.forEach(platform=>{
      const text = (d.keywords[sentiment]||{})[platform];
      const phrases = (text||'').split('\n').map(s=>s.trim()).filter(Boolean);
      if(!phrases.length) return; // skip empty combinations entirely, per request
      keywordRows.push([sentiment.charAt(0).toUpperCase()+sentiment.slice(1), platform, phrases.join(', ')]);
    });
  });
  if(keywordRows.length){
    drawTable(['Sentiment','Platform','Phrases'], [22,26,134], keywordRows);
  } else {
    bodyText('Nothing entered yet.');
  }

  // ---- Competitive Intelligence ----
  doc.addPage(); y = 20;
  sectionHeader('Competitive Intelligence');
  if(d.competitors.length){
    const competitorRows = d.competitors.map(c=>[
      c.rank ?? '—', c.name || 'Unnamed', c.position || '—', c.top3Pct || '—',
      c.sentimentPct || '—', c.mentions ?? '—', c.citations ?? '—', c.visibilityPct || '—',
    ]);
    drawTable(['Rank','Competitor','Position','Top 3%','Sentiment%','Mentions','Citations','Visibility%'], [12,42,18,18,22,18,18,20], competitorRows);
  }
  bodyText(d.competitive_intelligence_summary || 'Not yet written.');
  if(d.what_ai_values){
    y += 2;
    bodyText('What AIs Value:', { bold:true, size:10.5, color:[30,30,30] });
    d.what_ai_values.split('\n').map(s=>s.trim()).filter(Boolean).forEach(line=>{
      bodyText(`• ${line.replace(/^-\s*/,'')}`, { size:9.5, color:[60,60,60], indent:3, lineHeight:5 });
    });
  }

  doc.save(`ai-visibility-${(d.client_name_snapshot||'report').toLowerCase().replace(/[^a-z0-9]+/g,'-')}-${d.report_date}.pdf`);
}

function downloadAiVisibilityReport(){
  const d = aiVisibilityDraft;
  if(!d) return;
  const qm = computeAiVisibilityQuickMetrics(d);
  const lines = [];
  lines.push(`AI VISIBILITY REPORT — ${d.client_name_snapshot}`, '='.repeat(50));
  lines.push(`Target keyword: ${d.target_keyword || 'n/a'}`, `Date: ${new Date(d.report_date+'T00:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}`, '');
  if(d.links.pressRelease) lines.push(`Press release: ${d.links.pressRelease}`);
  if(d.links.prPlacementReport) lines.push(`PR placement report: ${d.links.prPlacementReport}`);
  if(d.links.screenshotsFolder) lines.push(`Screenshots folder: ${d.links.screenshotsFolder}`);
  lines.push('');
  lines.push('EXECUTIVE SUMMARY', '-'.repeat(30), d.executive_summary || '(not written yet)', '');
  lines.push('QUICK METRICS', '-'.repeat(30));
  lines.push(`Before: Recommended in ${d.before_recommended_count??'—'}/${d.before_total_prompts??'—'} prompts (${qm.beforePct??'—'}%), Average Ranking Position: ${d.before_avg_position??'—'}`);
  lines.push(`After: Recommended in ${d.after_recommended_count??'—'}/${d.after_total_prompts??'—'} prompts (${qm.afterPct??'—'}%), Average Ranking Position: ${d.after_avg_position??'—'}`);
  if(qm.summary) lines.push('', qm.summary);
  lines.push('');
  lines.push('OVERVIEW', '-'.repeat(30), d.overview_summary || '(not written yet)', '');
  lines.push('COMPETITIVE INTELLIGENCE', '-'.repeat(30));
  if(d.competitors.length){
    d.competitors.forEach(c=>lines.push(`  #${c.rank} ${c.name} — Position ${c.position}, Visibility ${c.visibilityPct}%, Sentiment ${c.sentimentPct}%, Mentions ${c.mentions}, Citations ${c.citations}`));
    lines.push('');
  }
  lines.push(d.competitive_intelligence_summary || '(not written yet)', '');
  if(d.what_ai_values){ lines.push('What AIs Value:', d.what_ai_values, ''); }
  const text = lines.join('\n');
  const blob = new Blob([text], { type:'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ai-visibility-${(d.client_name_snapshot||'report').toLowerCase().replace(/[^a-z0-9]+/g,'-')}-${d.report_date}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}
