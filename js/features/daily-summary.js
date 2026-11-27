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
  el.innerHTML = `<div class="panel">${loadingStateHtml('Loading…')}</div>`;
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
        <div class="dsummary-total">${person.entries.length} entr${person.entries.length === 1 ? 'y' : 'ies'}</div>
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
      ${person.entries.map(e=>`
        <div class="ts-entry-card" style="margin-bottom:8px;">
          <div class="ts-entry-info">
            <div class="ts-entry-title">${escapeHtml(e.client)}${e.service ? ` <span class="ts-entry-service">(${escapeHtml(e.service)})</span>` : ''}</div>
            ${e.description ? `<div class="ts-entry-desc">${escapeHtml(e.description)}</div>` : ''}
          </div>
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
      <span>${escapeHtml(person.name)} <span style="color:var(--muted-lt);">— ${person.entries.length} entr${person.entries.length === 1 ? 'y' : 'ies'}</span></span>
      ${hasSlackId ? '<span style="color:var(--green);font-size:13px;">Will be sent</span>' : '<span style="color:var(--muted-lt);font-size:13px;">No Slack ID on file</span>'}
    </div>`;
  }).join('');
  const elsewhere = lastDailySummaryData.summary.some(person => { const p = teamProfiles.find(x => x.id === person.userId); return p && p.daily_summary_slack_id && p.daily_summary_slack_id !== p.slack_user_id; });
  const onlyMe = lastDailySummaryData.summary.length === 1 && lastDailySummaryData.summary[0].userId === currentUser.id;
  openAppModal(`
    <div class="modal-head"><span class="panel-title">Send personal summaries to Slack?</span><span class="toast-close" onclick="closeAppModal()">✕</span></div>
    <div class="modal-body">
      <p style="font-size:12.5px;color:var(--muted-lt);margin:0 0 12px;">Each person gets their own DM with just their own work for ${escapeHtml(dateLabel)} — nobody sees anyone else's.${elsewhere ? (onlyMe ? ' Yours goes to your other Slack ID from your own Slack, as you.' : ' A summary set to go to a different Slack ID goes from that person’s own Slack, as them.') : ''}</p>
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
    const res = data.results || [];
    const sent = res.filter(r=>r.sent).length;
    const skipped = res.filter(r=>!r.sent && r.reason==='no_slack_id').length;
    const failed = res.filter(r=>!r.sent && r.reason!=='no_slack_id' && r.reason!=='muted').length;
    // A summary going to a Slack ID other than the person's own goes from their own Slack, as them (Nov 24)
    const asThem = res.filter(r=>r.sent && r.via==='them').length;
    const mine = res.length === 1 && res[0].userId === currentUser.id ? res[0] : null;
    if(mine && mine.sent){ dsSentToast(mine, dsRecipient().name); return; }
    let detail = `${sent} sent`;
    if(asThem) detail += ` · ${asThem === sent ? (sent === 1 ? 'from their own Slack' : 'all from their own Slack') : `${asThem} from their own Slack`}`;
    if(skipped) detail += `, ${skipped} skipped (no Slack ID)`;
    if(failed) detail += `, ${failed} failed`;
    showToast(failed ? 'error' : 'success', failed ? 'Some summaries failed' : 'Sent to Slack', detail);
  }catch(e){
    restoreBtn(btn);
    showToast('error','Send failed','Network error — try again.');
  }
}

// ---- A member's own summary, sent from Timesheet's "Today by client" card (Nov 24) ----------------
// It goes to the Slack ID they chose ("Send my summary to a different Slack ID"), from their own
// Slack, as them; Radar's bot sends it if their Slack isn't connected. No other ID chosen yet: they
// pick who gets it first, and Radar remembers.
function dsRecipient(){
  const id = String((myProfile && myProfile.daily_summary_slack_id) || '').trim();
  if(!id || (myProfile && id === myProfile.slack_user_id)) return { id: '', name: '' };
  const p = (teamProfiles || []).find(x => x.slack_user_id === id && !x.access_revoked);
  return { id, name: p ? firstName(p.name) : '' };
}
function dsSentKey(){ return 'ds-sent-' + ((currentUser && currentUser.id) || ''); }
function dsSentAt(day){ try{ return (JSON.parse(localStorage.getItem(dsSentKey()) || '{}'))[day] || null; }catch(e){ return null; } }
function dsMarkSent(day){
  try{ const m = JSON.parse(localStorage.getItem(dsSentKey()) || '{}'); m[day] = Date.now(); Object.keys(m).sort().slice(0, -30).forEach(k => delete m[k]); localStorage.setItem(dsSentKey(), JSON.stringify(m)); }catch(e){}
}
function tsSendHtml(day){
  const to = dsRecipient(), at = dsSentAt(day);
  const label = !to.id ? 'Send My Summary…' : at ? 'Send Again' : `Send to ${to.name || 'Slack'}`;
  return `<div class="tmi-send"><button class="btn tmi-send-b" id="tsSendB" onclick="tsSendSummary('${day}')">${appLogo('slack', 'xs')}<span>${escapeHtml(label)}</span></button><span class="tmi-send-s" id="tsSendS">${tsSendSub(day)}</span></div>`;
}
function tsSendSub(day){
  const to = dsRecipient(), at = dsSentAt(day);
  if(at) return `Sent${to.name ? ' to ' + escapeHtml(to.name) : ''} at ${new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  if(!to.id) return 'What you worked on, client by client, in Slack';
  const sm = (typeof slackMe !== 'undefined' && slackMe) || null;
  if(!sm || sm.checking) return 'What you worked on, client by client';
  if(sm.connected) return 'From your Slack, as you';
  if(sm.configured === false) return 'Radar sends it for you';
  return 'Radar sends it until you <button class="link-row" onclick="slackMeConnect()">connect your Slack</button>';
}
function dsSentToast(r, name){
  const t = name ? `Sent to ${name}` : 'Sent to Slack';
  if(r.via === 'them'){ showToast('success', t, 'From your Slack, as you.'); return; }
  if(r.notAsThem === 'not_connected'){
    if(typeof slackMe !== 'undefined') slackMe = Object.assign({}, slackMe, { connected: false });
    showToast('success', t, 'Radar sent it this time. Connect your Slack so your summary goes as you.', { action: 'Connect Slack…', onAction: () => slackMeConnect() });
    return;
  }
  if(r.notAsThem){ showToast('success', t, `Radar sent it: your Slack couldn’t (${String(r.notAsThem).replace(/^Slack said: |\.$/g, '')}).`); return; }
  showToast('success', t, 'To your Slack, from Radar.');
}
function dsFailWords(r, out){
  const why = r && r.reason;
  if(why === 'no_slack_id') return 'Radar has no Slack ID to send it to. Pick who gets it in your Profile.';
  if(why === 'muted') return 'Your daily summary is turned off for Slack. Turn it back on in Settings → Notifications.';
  if(why === 'not_configured') return 'Radar’s Slack isn’t set up yet. Ask an admin.';
  return (out && out.error) || (why ? `Slack said: ${why}.` : 'Try again in a moment.');
}
async function tsSendSummary(day){
  const to = dsRecipient();
  if(!to.id){ dsPickRecipient(day); return; }
  const btn = document.getElementById('tsSendB'); if(btn) setBtnLoading(btn, 'Sending…');
  const redraw = () => { if(currentViewName === 'time' && timeTab === 'timesheet') renderTimesheet(); };
  try{
    const { data: { session } } = await supabaseClient.auth.getSession();
    const h = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` };
    const r1 = await fetch(`/api/get-daily-summary?date=${day}`, { headers: h });
    const d = await r1.json().catch(() => ({}));
    const mine = r1.ok && (d.summary || []).find(p => p.userId === currentUser.id);
    if(!mine || !(mine.entries || []).length){ redraw(); showToast('info', 'Nothing to send yet', 'Log your time for the day first.'); return; }
    const r2 = await fetch('/api/send-slack-message', { method: 'POST', headers: h, body: JSON.stringify({ action: 'personal-summaries', date: d.date || day, summary: [mine] }) });
    const out = await r2.json().catch(() => ({}));
    const r = (out.results || [])[0];
    if(!r2.ok || !r || !r.sent){ redraw(); showToast('error', 'Not sent', dsFailWords(r, out)); return; }
    dsMarkSent(day); redraw();
    dsSentToast(r, to.name);
  }catch(e){ redraw(); showToast('error', 'Not sent', 'Couldn’t reach Radar. Try again.'); }
}
// Who gets it, the first time: teammates with Slack linked, admins and approvers first
let dsPickDay = null, dsPickId = null;
function dsPickRecipient(day){
  const rank = p => p.role === 'admin' ? 2 : p.role === 'approver' ? 1 : 0;
  const people = (teamProfiles || []).filter(p => p.id !== currentUser.id && !p.access_revoked && p.slack_user_id)
    .sort((a, b) => rank(b) - rank(a) || String(a.name).localeCompare(String(b.name)));
  if(!people.length){ showToast('info', 'Nobody to send it to yet', 'Teammates need their Slack linked in Radar (Team → Slack).'); return; }
  dsPickDay = day; dsPickId = null;
  const role = p => p.role === 'admin' ? 'Admin' : p.role === 'approver' ? 'Approver' : '';
  openAppModal(`<h3>Who gets your daily summary?</h3>
<p class="t-2" style="margin:-8px 0 14px;font-size:14px">What you worked on, client by client. Radar remembers who; change it anytime in your Profile.</p>
<div class="ds-pk" role="radiogroup" aria-label="Who gets it">${people.map(p => `<button role="radio" aria-checked="false" data-id="${p.id}" onclick="dsPickOne('${p.id}')"><span class="ck"></span><span>${escapeHtml(p.name)}</span><span class="r">${role(p)}</span></button>`).join('')}</div>
<div class="sheet-a"><button class="btn" onclick="closeAppModal()">Cancel</button><button class="btn btn-p" id="dsPickGo" onclick="dsPickSend()" disabled>${icon('paper-plane-tilt')}<span>Send</span></button></div>`, 460);
}
function dsPickOne(id){
  dsPickId = id;
  document.querySelectorAll('.ds-pk [role=radio]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.id === id)));
  const p = (teamProfiles || []).find(x => x.id === id), go = document.getElementById('dsPickGo');
  if(go){ go.disabled = false; go.querySelector('span').textContent = `Send to ${firstName(p.name)}`; }
}
async function dsPickSend(){
  const p = (teamProfiles || []).find(x => x.id === dsPickId); if(!p || !p.slack_user_id) return;
  const go = document.getElementById('dsPickGo'); if(go) setBtnLoading(go, 'Sending…');
  const { error } = await supabaseClient.from('team_profiles').update({ daily_summary_slack_id: p.slack_user_id }).eq('id', currentUser.id);
  if(error){ if(go) restoreBtn(go); showToast('error', 'Couldn’t save who gets it', error.message); return; }
  myProfile.daily_summary_slack_id = p.slack_user_id;
  closeAppModal();
  await tsSendSummary(dsPickDay);
}
