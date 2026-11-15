// Google Sheet / CSV roster sync, roster export, notify approvers,
// Wednesday email and insights previews.

/* ---------- Google Sheet CSV sync ---------- */

// Minimal but quote-aware CSV parser — handles commas and newlines inside "quoted" cells.
// delimiter defaults to comma so every existing caller (client CSV
// import, the keywords CSV import) is completely unaffected — only
// callers that explicitly pass a different delimiter (like RankScale's
// semicolon-delimited competitors export) get different behavior.
function parseCsv(text, delimiter=','){
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for(let i=0; i<text.length; i++){
    const ch = text[i], next = text[i+1];
    if(inQuotes){
      if(ch === '"' && next === '"'){ field += '"'; i++; }
      else if(ch === '"'){ inQuotes = false; }
      else { field += ch; }
    } else {
      if(ch === '"'){ inQuotes = true; }
      else if(ch === delimiter){ row.push(field); field=''; }
      else if(ch === '\n'){ row.push(field); rows.push(row); row=[]; field=''; }
      else if(ch === '\r'){ /* skip */ }
      else { field += ch; }
    }
  }
  if(field.length || row.length){ row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => cell.trim() !== ''));
}

const CSV_FIELD_SYNONYMS = {
  name: ['name','client','client name'],
  email: ['email','client email','contact email'],
  service: ['service','services'],
  status: ['status'],
  importance: ['importance','importance score'],
  danger: ['danger','danger score','risk'],
  sow: ['sow','scope','scope notes','sow / scope notes'],
};

function mapCsvHeaders(headerRow){
  const map = {};
  headerRow.forEach((h, idx) => {
    const clean = h.trim().toLowerCase();
    for(const field in CSV_FIELD_SYNONYMS){
      if(CSV_FIELD_SYNONYMS[field].includes(clean) && map[field]===undefined) map[field] = idx;
    }
  });
  return map;
}

function clampScore(v, max){
  max = max || 5;
  const n = parseInt(v);
  if(isNaN(n)) return 1;
  return Math.max(1, Math.min(max, n));
}

async function applyCsvRows(rows){
  if(rows.length < 2){ showToast('error','No data found','Need a header row plus at least one client row.'); return; }
  const map = mapCsvHeaders(rows[0]);
  if(map.name === undefined){ showToast('error','No "Name" column found','Add a Name column so rows can be matched to clients.'); return; }

  await loadAll();
  let added = 0, updated = 0, skippedDangerLowers = 0;
  const upsertRows = [];
  for(let i=1; i<rows.length; i++){
    const r = rows[i];
    const name = (r[map.name]||'').trim();
    if(!name) continue;
    const fields = {
      name,
      email: map.email!==undefined ? (r[map.email]||'').trim() : undefined,
      service: map.service!==undefined ? (r[map.service]||'').trim() : undefined,
      status: map.status!==undefined ? (r[map.status]||'').trim() : undefined,
      importance: map.importance!==undefined ? clampScore(r[map.importance], 10) : undefined,
      danger: map.danger!==undefined ? clampScore(r[map.danger], 5) : undefined,
      sow: map.sow!==undefined ? (r[map.sow]||'').trim() : undefined,
    };
    Object.keys(fields).forEach(k => fields[k]===undefined && delete fields[k]);

    const existing = clients.find(c => c.name.trim().toLowerCase() === name.toLowerCase());
    if(existing){
      // Same rule as the regular edit form — a bulk import shouldn't be
      // a back door around it. Skips just the danger field for this row
      // rather than the whole row, so an import someone's actually
      // allowed to run doesn't get derailed by one client's number
      // needing an admin's say-so.
      const previousDanger = existing.danger;
      if(fields.danger !== undefined && fields.danger < previousDanger && !canLowerDangerScore()){
        delete fields.danger;
        skippedDangerLowers++;
      }
      Object.assign(existing, fields);
      upsertRows.push({ id: existing.id, ...clientFieldsToDb(fields) });
      if(fields.danger !== undefined && fields.danger !== previousDanger) logDangerHistory(existing.id, fields.danger, previousDanger);
      updated++;
    } else {
      const newClient = {
        id:'c'+Date.now()+Math.floor(Math.random()*1000),
        name, email:'', service:'Google Ads (PPC)', status:'Active', importance:5, danger:1, sow:'',
        improvements:[], draft:'', draftStatus:'none',
        ...fields
      };
      clients.push(newClient);
      upsertRows.push({ id:newClient.id, ...clientFieldsToDb(newClient) });
      added++;
    }
  }
  // One batched upsert for the whole sheet, not a save-per-row loop — a
  // partial upsert like this only SETs the columns actually present in
  // each row, so it can't blank out fields the sheet doesn't map.
  const { error: upsertErr } = upsertRows.length ? await supabaseClient.from('clients').upsert(upsertRows) : { error:null };
  const skippedNote = skippedDangerLowers ? ` (${skippedDangerLowers} danger-score decrease${skippedDangerLowers!==1?'s':''} skipped — you don't have permission to lower it)` : '';
  log.unshift({t:nowTime(), tag:'you', userId:currentUser?.id, text:`Synced from Google Sheet — ${added} added, ${updated} updated.${skippedNote}`});
  const ok = !upsertErr && await persistLog();
  renderAll();
  const statusEl = document.getElementById('sheetSyncStatus');
  if(statusEl) statusEl.textContent = `Last synced ${nowTime()} — ${added} added, ${updated} updated.${skippedNote}`;
  ok ? showToast('success','Sheet synced', `${added} client${added!==1?'s':''} added, ${updated} updated.${skippedNote}`) : showToast('error','Sync partially failed','Data was read but saving failed — try again.');
}

async function syncFromSheetUrl(){
  const url = document.getElementById('sheetCsvUrl').value.trim();
  if(!url){ showToast('error','No link set','Paste a published CSV link first.'); return; }
  const statusEl = document.getElementById('sheetSyncStatus');
  if(statusEl) statusEl.textContent = 'Syncing…';
  try{
    const res = await fetch(url);
    if(!res.ok) throw new Error('Fetch failed: ' + res.status);
    const text = await res.text();
    const rows = parseCsv(text);
    await applyCsvRows(rows);
  }catch(e){
    if(statusEl) statusEl.textContent = '';
    showToast('error','Could not fetch the sheet', 'Check the link is a published CSV link (not a normal edit link), or use the paste option below instead.');
  }
}

async function saveAndSyncSheet(){
  settings.sheetCsvUrl = document.getElementById('sheetCsvUrl').value.trim();
  const ok = await persistSettings();
  if(!ok){ showToast('error','Save failed','Could not save the link — try again.'); return; }
  await syncFromSheetUrl();
}

async function importPastedCsv(){
  const text = document.getElementById('csvPasteArea').value;
  if(!text.trim()){ showToast('error','Nothing pasted','Paste CSV or copied sheet cells first.'); return; }
  const rows = parseCsv(text);
  await applyCsvRows(rows);
}

function csvEscape(val){
  const s = String(val ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
}

function exportRosterCsv(){
  const ac = activeClients();
  if(!ac.length){ showToast('info','Nothing to export','The roster is empty.'); return; }
  const headers = ['Name','Email','Service','Status','Importance','Danger','SOW'];
  const lines = [headers.join(',')];
  ac.forEach(c => {
    lines.push([c.name,c.email,c.service,c.status,c.importance,c.danger,c.sow].map(csvEscape).join(','));
  });
  const csvText = lines.join('\n');
  const blob = new Blob([csvText], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'based-agency-clients.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToastWithCopy('success','Roster exported', 'Downloaded as a CSV. If the download didn\'t work, copy the raw data below.', csvText);
}

// Members notify the approver(s), approvers notify the admin(s), and an
// admin — being the top of the chain — has nobody left to notify.
// Role-based against team_profiles, not tied to specific named people —
// so this stays correct as admins/approvers come and go, rather than
// requiring someone to remember to update a settings field. If more than
// one person holds the target role, all of their emails go in "to"
// (send-email.js already handles a comma-separated recipient list).
function getNotifyRecipient(){
  const role = myProfile?.role;
  if(role === 'admin') return null;
  const targetRole = role === 'approver' ? 'admin' : 'approver';
  const withEmail = teamProfiles.filter(p => p.role === targetRole && p.email);
  return { email: withEmail.map(p=>p.email).join(','), hasEmail: withEmail.length>0, configLabel: targetRole==='admin' ? 'an admin' : 'an approver' };
}

// True only if at least one pending draft hasn't been marked ready yet —
// Scoped to the current user's own pending drafts — this button lives on
// the personal Queue page, so "notify" here has always meant "notify
// about MY work," same as the per-member button means one specific
// person's work in Team Queue. A previous version of this pulled
// EVERYONE's pending drafts team-wide instead, which was the actual bug
// behind both the miscounted "3 drafts" (when the viewer only had 1 of
// their own) and having to pick through colleagues' work that wasn't
// theirs to decide on.
function hasNewDraftsToNotify(){
  const me = myName();
  return activeClients().some(c => {
    const d = getDraftFor(c, me);
    return d.draftStatus==='pending' && d.readyToNotify!==true && c.improvements.some(i=>i.author===me);
  });
}

function updateNotifyBtnState(){
  const notifyBtn = document.getElementById('notifyBtn');
  if(!notifyBtn) return;
  const hasNew = hasNewDraftsToNotify();
  notifyBtn.disabled = !hasNew;
  notifyBtn.title = hasNew ? '' : 'Nothing new to notify — everything pending for you has already been flagged for review.';
}

// Delegates straight to notifyForMember() with the current user's own
// team profile — this button and the per-member one in Team Queue are
// otherwise doing exactly the same thing (pick which of one person's own
// not-yet-sent pending drafts to flag, then choose how to notify), so
// there's no separate picker/scoping logic to maintain here anymore.
function notifyApprovers(){
  const myTeamProfile = teamProfiles.find(p=>p.id===currentUser?.id);
  if(!myTeamProfile){ showToast('error','Profile not found','Could not find your team profile.'); return; }
  notifyForMember(myTeamProfile.id);
}

// Shows exactly what the Wednesday automation would send right now — same
// server-side logic as the actual cron job — without sending or logging
// anything. Read-only, so no confirmation needed to view it.
async function previewWednesdayEmail(){
  const btn = clickedBtn();
  setBtnLoading(btn, 'Checking…');
  try{
    const { data: { session } } = await supabaseClient.auth.getSession();
    const response = await fetch('/api/preview-wednesday-notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
    });
    const data = await response.json();
    restoreBtn(btn);
    if(!response.ok){ showToast('error','Could not load preview', data.error || 'Unknown error'); return; }

    if(!data.wouldSend){
      openAppModal(`
        <div class="modal-head"><span class="panel-title">Wednesday email preview</span><span class="toast-close" onclick="closeAppModal()">✕</span></div>
        <div class="modal-body"><p style="font-size:13px;color:var(--muted);line-height:1.5;">${escapeHtml(data.reason)}</p></div>
        <div class="modal-actions"><button class="btn btn-outline" onclick="closeAppModal()">Close</button></div>`, 460);
      return;
    }

    openAppModal(`
      <div class="modal-head"><span class="panel-title">This is what Wednesday's automation will send</span><span class="toast-close" onclick="closeAppModal()">✕</span></div>
      <div class="modal-body">
        <p style="font-size:11.5px;color:var(--muted-lt);margin:0 0 12px;">Preview only — nothing has been sent. This is exactly what the automated job will send when it runs.</p>
        <div class="settings-field"><label>To</label><input value="${escapeHtml(data.to)}" readonly></div>
        <div class="settings-field"><label>Subject</label><input value="${escapeHtml(data.subject)}" readonly></div>
        <div class="settings-field"><label>Body</label><textarea readonly style="min-height:150px;width:100%;font-family:var(--font);font-size:13px;padding:10px;border-radius:6px;border:1px solid var(--border);">${escapeHtml(data.body)}</textarea></div>
      </div>
      <div class="modal-actions"><button class="btn btn-outline" onclick="closeAppModal()">Close</button></div>`, 500);
  }catch(e){
    restoreBtn(btn);
    showToast('error','Could not load preview', String(e));
  }
}

// Unlike previewWednesdayEmail() above, this one is NOT free to run — it
// has to actually perform the real website checks and pattern-detection
// call to show what they'd currently find, so it costs real AI API money
// every single click. Confirmed explicitly before running for that
// reason; the email preview above needs no such confirmation since it's
// just reading data already sitting in the database.
async function previewProactiveInsights(){
  if(!(await confirmDialog('This actually runs the real website checks and pattern detection — it costs real API calls, the same as a real run. Continue?', {confirmLabel:'Run preview'}))) return;
  const btn = clickedBtn();
  setBtnLoading(btn, 'Checking…');
  try{
    const { data: { session } } = await supabaseClient.auth.getSession();
    const response = await fetch('/api/preview-wednesday-notify?action=proactive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ action: 'proactive' }),
    });
    const data = await response.json();
    restoreBtn(btn);
    if(!response.ok){ showToast('error','Preview failed', data.error || 'Unknown error'); return; }

    if(!data.ran){
      openAppModal(`
        <div class="modal-head"><span class="panel-title">Weekly focus report preview</span><span class="toast-close" onclick="closeAppModal()">✕</span></div>
        <div class="modal-body"><p style="font-size:13px;color:var(--muted);line-height:1.5;">${escapeHtml(data.reason)}</p></div>
        <div class="modal-actions"><button class="btn btn-outline" onclick="closeAppModal()">Close</button></div>`, 460);
      return;
    }

    const checkedNames = (data.websiteChecksCandidates||[]).map(c=>c.name).join(', ') || 'none (no client has a website on file yet)';

    openWeeklyFocusReportShell();
    weeklyFocusReportStepsState = buildWeeklyFocusReportSteps(data, `Preview only — nobody was notified, nothing was saved. Checked: ${checkedNames}.`);
    weeklyFocusReportStepIndex = 0;
    renderWeeklyFocusReportStep();
  }catch(e){
    restoreBtn(btn);
    showToast('error','Could not load preview', String(e));
  }
}
