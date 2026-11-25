// My Profile: avatar, basic info, email-change requests.

/* ---------- Profile — avatar, phone, and the email-change-request flow ---------- */

function renderProfilePage(){
  if(!myProfile) return;
  const nameInput = document.getElementById('profileNameInput');
  const phoneInput = document.getElementById('profilePhoneInput');
  if(nameInput && document.activeElement !== nameInput) nameInput.value = myProfile.name || '';
  if(phoneInput && document.activeElement !== phoneInput) phoneInput.value = myProfile.phone || '';
  const dsInput = document.getElementById('dailySummarySlackIdInput');
  if(dsInput && document.activeElement !== dsInput) dsInput.value = myProfile.daily_summary_slack_id || '';

  const avatarImg = document.getElementById('profileAvatarPreview');
  const avatarPlaceholder = document.getElementById('profileAvatarPlaceholder');
  if(myProfile.avatar_url){
    avatarImg.src = myProfile.avatar_url; avatarImg.style.display = 'block';
    avatarPlaceholder.style.display = 'none';
  } else {
    avatarImg.style.display = 'none';
    avatarPlaceholder.style.display = 'flex';
    avatarPlaceholder.textContent = (myProfile.name||'?').trim().charAt(0).toUpperCase();
  }

  renderProfileEmailPanel();
}

async function uploadAvatar(file){
  if(!file) return;
  if(!file.type.startsWith('image/')){ showToast('error','Not an image','Please choose an image file.'); return; }
  if(file.size > 2*1024*1024){ showToast('error','Too large','Photos need to be under 2MB.'); return; }
  const ext = file.name.split('.').pop();
  const path = `${currentUser.id}/avatar.${ext}`;
  const { error: uploadErr } = await supabaseClient.storage.from('avatars').upload(path, file, { upsert:true });
  if(uploadErr){ showToast('error','Upload failed', uploadErr.message); return; }
  const { data: urlData } = supabaseClient.storage.from('avatars').getPublicUrl(path);
  // Cache-bust so the new photo shows immediately instead of a stale cached one.
  const avatarUrl = `${urlData.publicUrl}?t=${Date.now()}`;
  const { error: profileErr } = await supabaseClient.from('team_profiles').update({ avatar_url: avatarUrl }).eq('id', currentUser.id);
  if(profileErr){ showToast('error','Save failed', profileErr.message); return; }
  myProfile.avatar_url = avatarUrl;
  await loadTeamProfiles();
  renderProfilePage();
  renderWhoAmI();
  renderTeam();
  showToast('success','Photo updated','Your new profile picture is live.');
}

async function saveProfileBasicInfo(){
  const name = document.getElementById('profileNameInput').value.trim();
  let phone = document.getElementById('profilePhoneInput').value.trim();
  if(!name){ showToast('error','Name required','Your name can\'t be empty.'); return; }
  // the phone is your WhatsApp number (Who's on the team matches it): kept with its country code
  if(phone && phone !== (myProfile.phone || '')){
    const d = phone.replace(/\D/g, '');
    const num = phone.startsWith('+') ? (/^\d{8,15}$/.test(d) ? d : null) : d.length === 10 ? '1' + d : null;
    if(!num){ showToast('error', 'Check the number', 'Start with + and the country code, like +55 41 98875-3180 or +1 305 555 0101.'); document.getElementById('profilePhoneInput').focus(); return; }
    phone = typeof waFmtNum === 'function' ? waFmtNum(num) : '+' + num;
    document.getElementById('profilePhoneInput').value = phone;
  }
  const { error } = await supabaseClient.from('team_profiles').update({ name, phone }).eq('id', currentUser.id);
  if(error){ showToast('error','Save failed', error.message); return; }
  myProfile.name = name; myProfile.phone = phone;
  await loadTeamProfiles();
  renderWhoAmI();
  renderTeam();
  showToast('success','Saved','Your profile is updated.');
}

async function saveDailySummarySlackId(value){
  const { error } = await supabaseClient.from('team_profiles').update({ daily_summary_slack_id: value || null }).eq('id', currentUser.id);
  if(error){ showToast('error','Could not save', error.message); return; }
  myProfile.daily_summary_slack_id = value || null;
  await loadTeamProfiles();
  if(typeof dsSlackSubRefresh === 'function') await dsSlackSubRefresh(true);
  const sm = (typeof slackMe !== 'undefined' && slackMe) || {};
  const other = value && value !== myProfile.slack_user_id;
  showToast('success', value ? 'Saved' : 'Cleared', !value ? 'Your daily summary will use your regular Slack DM ID.'
    : !other ? 'Your daily summary will go to your own Slack.'
    : sm.connected ? 'Your daily summary will go there, from your Slack, as you.'
    : 'Your daily summary will go there. Radar sends it until you connect your Slack.');
}

function renderProfileEmailPanel(){
  const el = document.getElementById('profileEmailPanelBody');
  if(!el) return;
  if(isAdmin()){
    el.innerHTML = `
      <p style="font-size:13px;color:var(--muted);margin:0 0 14px;line-height:1.5;">As an admin, you can change your own login email directly. Supabase will send a confirmation link to the new address before the change actually takes effect.</p>
      <div class="form-grid">
        <div><label>Current email</label><input value="${escapeHtml(currentUser.email)}" readonly style="color:var(--muted-lt);"></div>
        <div><label>New email</label><input id="directEmailInput" placeholder="new@based-agency.com"></div>
      </div>
      <button class="btn btn-brand" style="margin-top:6px;" onclick="saveDirectEmailChange()">Update email</button>`;
  } else {
    el.innerHTML = `
      <p style="font-size:13px;color:var(--muted);margin:0 0 14px;line-height:1.5;">Changing your login email needs admin approval — submit a request below and an admin will confirm or deny it.</p>
      <div class="form-grid">
        <div><label>Current email</label><input value="${escapeHtml(currentUser.email)}" readonly style="color:var(--muted-lt);"></div>
        <div><label>Requested new email</label><input id="requestEmailInput" placeholder="new@based-agency.com"></div>
      </div>
      <button class="btn btn-brand" style="margin-top:6px;" onclick="submitEmailChangeRequest()">Submit request</button>
      <div id="myEmailRequestsList" style="margin-top:16px;"></div>`;
    renderMyEmailRequests();
  }
}

async function saveDirectEmailChange(){
  const newEmail = document.getElementById('directEmailInput').value.trim();
  const bad = teamEmailProblem(newEmail, 'new');
  if(bad){ showToast('error','Use a Based Agency email', bad); return; }
  const { error } = await supabaseClient.auth.updateUser({ email: newEmail });
  if(error){ showToast('error','Update failed', error.message); return; }
  showToast('success','Confirmation sent', `Check ${newEmail} for a link to confirm the change.`);
  return true;
}

async function submitEmailChangeRequest(){
  const requested = document.getElementById('requestEmailInput').value.trim();
  const bad = teamEmailProblem(requested, 'new');
  if(bad){ showToast('error','Use a Based Agency email', bad); return; }
  const { error } = await supabaseClient.from('email_change_requests').insert({
    user_id: currentUser.id, current_email: currentUser.email, requested_email: requested
  });
  if(error){ showToast('error','Request failed', error.message); return; }
  // Notify every admin — whichever of them checks first can act on it.
  const admins = teamProfiles.filter(p=>p.role==='admin');
  for(const a of admins){
    await sendNotification(a.id, 'email_change_requested', 'Email change request', `${myProfile.name} wants to change their email to ${requested}.`, 'profile');
  }
  document.getElementById('requestEmailInput').value = '';
  renderMyEmailRequests();
  showToast('success','Request submitted','An admin will review it soon.');
  return true;
}

async function renderMyEmailRequests(){
  const el = document.getElementById('myEmailRequestsList');
  if(!el) return;
  const { data, error } = await supabaseClient.from('email_change_requests').select('*').eq('user_id', currentUser.id).order('created_at',{ascending:false}).limit(5);
  if(error || !data || !data.length){ el.innerHTML = ''; return; }
  // as rows in the Sign-in card (Nov 25): the address you asked for, when, and where it stands
  const statusMeta = { pending: { dot: 'gray', label: 'Waiting for an admin' }, approved: { dot: 'green', label: 'Approved' }, denied: { dot: 'red', label: 'Not approved' } };
  el.innerHTML = data.map(r => {
    const s = statusMeta[r.status] || statusMeta.pending;
    return `<div class="fr"><div class="l"><b>${escapeHtml(r.requested_email)}</b><span>Asked ${new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span></div><span class="st"><span class="dot ${s.dot}"></span>${escapeHtml(s.label)}</span></div>`;
  }).join('');
}

function updateEmailRequestBadges(count){
  const navBadge = document.getElementById('navTeamBadge');
  const subtabBadge = document.getElementById('emailRequestsSubtabBadge');
  [navBadge, subtabBadge].forEach(b=>{
    if(!b) return;
    b.textContent = count;
    b.style.display = count ? (b === navBadge ? '' : 'flex') : 'none';   // the sidebar's circle is laid out by the stylesheet
  });
}

async function renderPendingEmailRequests(){
  const el = document.getElementById('pendingEmailRequestsList');
  if(!el) return;
  el.innerHTML = `${loadingStateHtml('Loading…')}`;
  const { data, error } = await supabaseClient.from('email_change_requests').select('*').eq('status','pending').order('created_at',{ascending:true});
  if(error){ el.innerHTML = `<div class="empty">Could not load requests.</div>`; return; } // badges left untouched — a network error here doesn't mean the real count changed
  updateEmailRequestBadges(data ? data.length : 0);
  if(!data || !data.length){ el.innerHTML = `<div class="empty">No pending requests.</div>`; return; }
  el.innerHTML = data.map(r=>{
    const p = teamProfiles.find(x=>x.id===r.user_id);
    return `<div class="integ-row">
      <div><div class="integ-name">${p?escapeHtml(p.name):'Someone no longer on the team'}</div><div class="integ-desc">${r.current_email} → ${escapeHtml(r.requested_email)}</div></div>
      <div style="display:flex;gap:10px;">
        <span class="row-link" onclick="resolveEmailChangeRequest('${r.id}', true)">Approve</span>
        <span class="row-link danger-link" onclick="resolveEmailChangeRequest('${r.id}', false)">Deny</span>
      </div>
    </div>`;
  }).join('');
}

async function resolveEmailChangeRequest(requestId, approve){
  if(!(await confirmDialog(approve ? 'Approve this email change? It takes effect immediately.' : 'Deny this request?', {confirmLabel: approve ? 'Approve' : 'Deny', destructive: !approve}))) return;
  try{
    const { data: { session } } = await supabaseClient.auth.getSession();
    const response = await fetch('/api/admin-user-actions', {
      method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${session.access_token}`},
      body: JSON.stringify({ action:'approve-email-change', requestId, approve })
    });
    const data = await response.json();
    if(!response.ok){ showToast('error','Failed', data.error || 'Could not process this request.'); return; }
    renderPendingEmailRequests();
    showToast('success', approve?'Approved':'Denied', approve?'The email change is live.':'The request was denied.');
  }catch(e){
    showToast('error','Failed','Network error — try again.');
  }
}
