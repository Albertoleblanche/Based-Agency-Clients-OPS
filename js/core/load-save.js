// loadAll(), the team activity log (table + legacy fallback), settings
// persistence, authenticated /api headers, and the send-email confirmation flow.

const DEFAULT_SERVICE_OPTIONS = ['Google Ads (PPC)','Meta Ads','SEO / Local Search','AI Domination Framework','Full Framework'];
const DEFAULT_STATUS_OPTIONS = ['Active','Onboarding','At Risk','Paused'];
const DEFAULT_TEAM_TITLE_OPTIONS = ['Web Developer','SEO Specialist','PPC Specialist','Account Manager','Designer','Client Coordinator'];
// Fallback defaults only — the actual configured values live in
// settings.claudeModel/settings.openaiModel (admin-editable in Settings ->
// AI & Email), not hardcoded in api/*.js, so a model deprecation/upgrade
// (this has already happened once — see lib/ai-client.js's history) is a
// Settings change, not a redeploy.
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5-5';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

let _loadAllSeq = 0;
async function loadAll(){
  const mySeq = ++_loadAllSeq;
  const [activityRows, s, clientsRes, impRes, draftsRes] = await Promise.all([
    fetchActivityLog(),
    safeGet('settings'),
    supabaseClient.from('clients').select('*'),
    supabaseClient.from('client_improvements').select('*').order('date', { ascending:true }),
    supabaseClient.from('client_drafts').select('*'),
  ]);
  // A newer loadAll() call has started since this one began — its data (or
  // data from whichever call turns out to resolve last) is what should win,
  // not this now-superseded fetch. Applying this one anyway risks silently
  // reverting a change that already saved correctly, purely because of
  // which network request happened to finish first.
  if(mySeq !== _loadAllSeq) return;
  // Entries still being saved stay on top so a reload mid-save can't hide them.
  const stillSaving = log.filter(e => !e.id);
  if(activityRows){
    log = [...stillSaving, ...activityRows];
  } else {
    // Fallback until addendum-team-activity-log.sql has been run.
    const appData = await safeGet('app-data');
    if(mySeq !== _loadAllSeq) return;
    if(appData){
      try{ log = (JSON.parse(appData).log || []); }catch(e){ log = []; }
    } else {
      // One-time migration from the old two-key layout (clients-roster and activity-log),
      // which doubled write volume on every action and was the actual cause of the
      // "rate limit exceeded" error. New saves go through the combined key below.
      const l = await safeGet('activity-log');
      log = l ? JSON.parse(l) : [];
      if(log.length) await persistAppData();
    }
  }
  // clients/client_improvements/client_drafts: real tables now (see
  // schema-clients-migration.sql and addendum-25.sql), not part of the
  // app-data JSON blob — hydrate each client's .improvements and .drafts
  // from their flat tables so existing read sites (c.improvements,
  // activeClients(), etc.) keep working unchanged. Only the write paths
  // changed.
  if(clientsRes.error) console.error('loadAll: clients fetch failed', clientsRes.error);
  if(impRes.error) console.error('loadAll: client_improvements fetch failed', impRes.error);
  if(draftsRes.error) console.error('loadAll: client_drafts fetch failed', draftsRes.error);
  clients = (clientsRes.data || []).map(clientRowFromDb);
  clientImprovements = (impRes.data || []).map(improvementRowFromDb);
  clientDrafts = (draftsRes.data || []).map(draftRowFromDb);
  clients.forEach(c => {
    c.improvements = clientImprovements.filter(i => i.clientId === c.id);
    c.drafts = clientDrafts.filter(d => d.clientId === c.id);
  });
  clientsDataLoaded = true;
  settings = s ? JSON.parse(s) : {};
  settings.sheetCsvUrl = settings.sheetCsvUrl || '';
  settings.serviceOptions = (settings.serviceOptions && settings.serviceOptions.length) ? settings.serviceOptions : DEFAULT_SERVICE_OPTIONS.slice();
  settings.statusOptions = (settings.statusOptions && settings.statusOptions.length) ? settings.statusOptions : DEFAULT_STATUS_OPTIONS.slice();
  settings.teamTitleOptions = (settings.teamTitleOptions && settings.teamTitleOptions.length) ? settings.teamTitleOptions : DEFAULT_TEAM_TITLE_OPTIONS.slice();
  settings.customFields = settings.customFields || [];
  settings.overtimeThresholdHours = settings.overtimeThresholdHours ?? 40;
  settings.overtimeMultiplier = settings.overtimeMultiplier ?? 1.5;
  settings.claudeModel = settings.claudeModel || DEFAULT_CLAUDE_MODEL;
  settings.openaiModel = settings.openaiModel || DEFAULT_OPENAI_MODEL;
  settings.assistantName = settings.assistantName || 'Assistant';
  applyAssistantName();
  const sheetInput = document.getElementById('sheetCsvUrl');
  if(sheetInput && document.activeElement !== sheetInput) sheetInput.value = settings.sheetCsvUrl || '';
  // Personal to the viewer, not part of the shared settings blob — comes
  // from their own profile row, not app_storage.
  const instrInput = document.getElementById('emailInstructions');
  if(instrInput && document.activeElement !== instrInput) instrInput.value = (myProfile && myProfile.email_instructions) || '';
  updateEmailInstructionsStatus();
  const syncTimeEl = document.getElementById('sidebarSyncTime');
  if(syncTimeEl) syncTimeEl.textContent = new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
}

function updateEmailInstructionsStatus(){
  const el = document.getElementById('emailInstructionsStatus');
  if(!el) return;
  const text = ((myProfile && myProfile.email_instructions) || '').trim();
  el.textContent = text ? `● Active — ${text.split(/\s+/).length} words, applied to your new drafts` : '○ Not set — using default structure';
  el.style.color = text ? 'var(--green)' : 'var(--muted-lt)';
}
// ---- Team activity log ---------------------------------------------------
// Lives in its own append-only table (team_activity_log — see
// addendum-team-activity-log.sql), one row per entry. It used to be a
// single JSON blob in app_storage that every action rewrote in full, so two
// people acting at the same moment could overwrite each other's entries,
// and each write made every open tab reload all data. Until that migration
// has been run, everything falls back to the old blob automatically.
const ACTIVITY_LOG_LIMIT = 60;
let activityTableAvailable = null; // null = not checked yet; false = migration not run → blob fallback
let _appDataSaveInFlight = null;

function isMissingTableError(error){
  if(!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205' || /does not exist|could not find the table/i.test(error.message||'');
}
function activityRowFromDb(r){
  return { id:r.id, createdAt:r.created_at, t:r.time_label || '', tag:r.tag==='auto' ? 'auto' : 'you', userId:r.user_id || null, text:r.text || '' };
}
// Returns the latest entries from the table, or null if the table isn't
// there yet (caller then falls back to the blob).
async function fetchActivityLog(){
  if(activityTableAvailable === false) return null;
  const { data, error } = await supabaseClient.from('team_activity_log')
    .select('id, created_at, user_id, tag, text, time_label')
    .order('created_at', { ascending:false }).limit(ACTIVITY_LOG_LIMIT);
  if(error){
    if(isMissingTableError(error)){ activityTableAvailable = false; return null; }
    console.error('fetchActivityLog failed', error);
    return null;
  }
  activityTableAvailable = true;
  return data.map(activityRowFromDb);
}

async function persistAppData(){
  // Collect unsaved entries synchronously, before any await, so a reload
  // landing mid-save can't drop them.
  const unsaved = log.filter(e => !e.id && !e._saving);
  if(activityTableAvailable !== false && unsaved.length){
    unsaved.forEach(e => { e._saving = true; });
    const rows = unsaved.slice().reverse().map(e => ({ // oldest first → created_at keeps order
      user_id: currentUser?.id, tag: e.tag === 'auto' ? 'auto' : 'you', text: String(e.text||'').slice(0, 2000),
    }));
    const { data, error } = await supabaseClient.from('team_activity_log').insert(rows).select('id, created_at');
    if(!error && data && data.length === rows.length){
      activityTableAvailable = true;
      unsaved.slice().reverse().forEach((e, i) => { e.id = data[i].id; e.createdAt = data[i].created_at; delete e._saving; });
      if(log.length > ACTIVITY_LOG_LIMIT) log = log.slice(0, ACTIVITY_LOG_LIMIT);
      return true;
    }
    unsaved.forEach(e => { delete e._saving; });
    if(!isMissingTableError(error)){ console.error('activity log insert failed', error); return false; }
    activityTableAvailable = false; // migration not run yet → fall through to the old blob
  }
  if(activityTableAvailable === false){
    if(log.length > ACTIVITY_LOG_LIMIT) log = log.slice(0, ACTIVITY_LOG_LIMIT);
    // Legacy path: coalesce rapid consecutive saves into fewer requests.
    if(_appDataSaveInFlight){ await _appDataSaveInFlight.catch(()=>{}); }
    _appDataSaveInFlight = safeSet('app-data', JSON.stringify({ log: log.map(({_saving, ...e}) => e) }));
    const result = await _appDataSaveInFlight;
    _appDataSaveInFlight = null;
    return result;
  }
  return true;
}
async function persistLog(){ return await persistAppData(); }
// Headers for calls to the app's own /api routes that require a signed-in
// team member (send-email, generate-draft).
async function apiAuthHeaders(){
  const { data: { session } } = await supabaseClient.auth.getSession();
  return { 'Content-Type': 'application/json', ...(session ? { 'Authorization': `Bearer ${session.access_token}` } : {}) };
}
async function persistSettings(){ return await safeSet('settings', JSON.stringify(settings)); }
async function persistTeam(){ return await safeSet('team-members', JSON.stringify(team)); }

// A synthetic click on a hidden <a mailto> is unreliable — some browsers/sandboxes
// block it outright, so it can look "connected" but do nothing. Instead, show a
// modal with a REAL, visible mailto link the person clicks themselves (which browsers
// always honor as a genuine user action) plus a guaranteed copy-to-clipboard fallback.
let _emailSentCallback = null;
let _emailIncludeSignature = false;

function showSendEmailConfirm(to, subject, body, onSent, includeSignature){
  _emailSentCallback = onSent || null;
  // Stored the same way as _emailSentCallback above — confirmSendEmail()
  // runs later, from its own button click, with no direct access to
  // whatever arguments this call was made with.
  _emailIncludeSignature = !!includeSignature;
  openAppModal(`
    <div class="modal-head"><span class="panel-title">Send this email?</span><span class="toast-close" onclick="closeAppModal()">✕</span></div>
    <div class="modal-body">
      <div class="settings-field"><label>To</label><input id="mailModalTo" value="${escapeHtml(to)}" readonly style="width:100%;"></div>
      <div class="settings-field"><label>Subject</label><input id="mailModalSubject" style="width:100%;"></div>
      <div class="settings-field"><label>Body</label><textarea spellcheck="true" id="mailModalBody" style="min-height:150px;width:100%;font-family:var(--font);font-size:13px;padding:10px;border-radius:6px;border:1px solid var(--border);"></textarea></div>
      <p style="font-size:11.5px;color:var(--muted-lt);margin:8px 0 0;line-height:1.5;">Review the text above — clicking Send delivers it immediately from the app, no further confirmation.</p>
    </div>
    <div class="modal-actions">
      <button class="btn btn-brand" id="sendEmailConfirmBtn" onclick="confirmSendEmail()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>Send Email</button>
      <button class="btn btn-outline" id="mailModalCopyBtn" onclick="copyMailModalBody()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy details</button>
      <button class="btn btn-outline" onclick="closeAppModal()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Cancel</button>
    </div>`, 500);
  document.getElementById('mailModalSubject').value = subject;
  document.getElementById('mailModalBody').value = body;
}

async function confirmSendEmail(){
  const to = document.getElementById('mailModalTo').value;
  const subject = document.getElementById('mailModalSubject').value;
  const body = document.getElementById('mailModalBody').value;
  const btn = document.getElementById('sendEmailConfirmBtn');
  setBtnLoading(btn, 'Sending…');
  try{
    const response = await fetch('/api/send-email', {
      method: 'POST',
      headers: await apiAuthHeaders(),
      body: JSON.stringify({ to, subject, body, includeSignature: _emailIncludeSignature }),
    });
    const data = await response.json();
    restoreBtn(btn);
    if(!response.ok){
      showToast('error','Send failed', (data.error || 'Could not send the email') + ' — try "Open in mail app instead."');
      return;
    }
    closeAppModal();
    showToast('success','Email sent', `Delivered to ${to}.`);
    notifyOthersOfEmailSent(to, subject);
    _emailIncludeSignature = false;
    if(_emailSentCallback){ const cb = _emailSentCallback; _emailSentCallback = null; cb(); }
  }catch(e){
    restoreBtn(btn);
    showToast('error','Send failed', 'Network error — try "Open in mail app instead."');
  }
}

// Lets other admins/approvers know a client email went out, since whoever
// clicked Send is the only one who'd otherwise know it happened.
async function notifyOthersOfEmailSent(to, subject){
  const recipients = teamProfiles.filter(p=> (p.role==='admin' || p.role==='approver') && p.id!==currentUser.id);
  for(const p of recipients){
    await sendNotification(p.id, 'email_sent', 'Client email sent', `${myName()||'Someone'} sent "${subject}" to ${to}.`, 'approve');
  }
}
