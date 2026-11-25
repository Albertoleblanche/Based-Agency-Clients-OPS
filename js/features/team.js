// Team page: members, roles, titles, permissions, access, resets.

function populateAddMemberTitleSelect(){
  const sel = document.getElementById('tmTitle');
  if(!sel) return;
  const current = sel.value;
  sel.innerHTML = `<option value="">No title</option>` + (settings.teamTitleOptions||[]).map(o=>`<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
  if([...sel.options].some(o=>o.value===current)) sel.value = current;
}

async function addTeamMember(){
  if(!isAdmin()){ showToast('error','Not allowed','Only admins can add team members.'); return; }
  const name = document.getElementById('tmName').value.trim();
  const email = document.getElementById('tmEmail').value.trim();
  const role = document.getElementById('tmRole').value;
  const title = document.getElementById('tmTitle').value;
  if(!name || !email){ showToast('error','Missing info','Enter both a name and email.'); return; }
  const bad = teamEmailProblem(email, 'their');
  if(bad){ showToast('error','Use a Based Agency email', bad); document.getElementById('tmEmail')?.focus(); return; }

  const btn = clickedBtn();
  setBtnLoading(btn, 'Creating…');
  try{
    const { data: { session } } = await supabaseClient.auth.getSession();
    const response = await fetch('/api/admin-user-actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ action:'create-member', name, email, role, title }),
    });
    const data = await response.json();
    restoreBtn(btn);
    if(!response.ok){ showToast('error','Could not create account', data.error || 'Unknown error'); return; }

    document.getElementById('tmName').value = '';
    document.getElementById('tmEmail').value = '';
    await loadTeamProfiles();
    renderTeam();
    log.unshift({t:nowTime(), tag:'you', userId:currentUser?.id, text:`Added <b>${escapeHtml(name)}</b> (${escapeHtml(role)}) to the team.`});
    await persistLog();
    showToastWithCopy('success','Account created', `Send this temporary password to ${name} — they should change it after logging in.`, `Email: ${email}\nTemporary password: ${data.tempPassword}`);
  }catch(e){
    restoreBtn(btn);
    showToast('error','Could not create account', String(e));
  }
}

function switchTeamTab(name){
  document.querySelectorAll('#teamTabsBar .icon-tab').forEach(t=>t.classList.toggle('active', t.dataset.ttab===name));
  document.querySelectorAll('#view-team .settings-subview').forEach(v=>v.classList.remove('active'));
  document.getElementById('teamtab-'+name).classList.add('active');
}

function renderTeam(){
  const el = document.getElementById('teamList');
  const noteEl = document.getElementById('teamPanelNote');
  const addPanel = document.getElementById('addMemberPanel');
  const titlesPanel = document.getElementById('teamTitlesPanel');
  const tabsBar = document.getElementById('teamTabsBar');
  if(tabsBar) tabsBar.style.display = isAdmin() ? 'flex' : 'none';
  if(!isAdmin() && document.getElementById('teamtab-roster') && !document.getElementById('teamtab-roster').classList.contains('active')){ switchTeamTab('roster'); }
  if(addPanel) addPanel.style.display = isAdmin() ? 'block' : 'none';
  if(titlesPanel) titlesPanel.style.display = isAdmin() ? 'block' : 'none';
  if(isAdmin()){ populateAddMemberTitleSelect(); renderOptionsManager('title'); renderPendingEmailRequests(); }
  if(noteEl) noteEl.textContent = isAdmin()
    ? 'Open View to change someone\'s role or title, except your own role.'
    : 'Only admins can add members or change roles.';
  if(!el) return;
  if(!teamProfiles.length){ el.innerHTML = `<div class="empty" style="padding:14px 0;">No team members yet.</div>`; return; }
  // A list, like Apple's Users & Groups: one row per person with their
  // title, role and what you can do with them; View opens the details.
  el.innerHTML = `<div class="team-list">` + teamProfiles.map(m=>{
    const isSelf = currentUser && m.id === currentUser.id;
    const isRevoked = !!m.access_revoked;
    const roleAtCompany = m.title || roleDisplayLabel(m.role);
    return `<div class="team-row ${isRevoked?'revoked':''}">
      ${teamCardAvatarHtml(m)}
      <div class="team-row-tx"><b>${escapeHtml(m.name)}${isSelf?' (you)':''}</b><span>${escapeHtml(roleAtCompany)}${isRevoked ? ' · Access revoked' : ''}</span></div>
      <span class="team-row-role">${escapeHtml(roleDisplayLabel(m.role))}</span>
      <div class="team-row-actions">
        ${(!isSelf && !isRevoked) ? `<button class="btn btn-outline" onclick="openNewTaskModal('${m.id}')">Assign Task</button>` : ''}
        ${m.email ? `<a class="btn btn-outline" href="mailto:${escapeHtml(m.email)}" style="text-decoration:none;">Email</a>` : ''}
        <button class="btn btn-outline" onclick="openTeamMemberDetail('${m.id}')">View</button>
        ${isAdmin() ? `<button class="icon-menu-btn team-card-menu-btn" onclick='toggleTeamActionsMenu(event, ${escapeHtml(JSON.stringify({id:m.id,name:m.name,access_revoked:isRevoked}))})' title="Actions">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1" /> <circle cx="12" cy="5" r="1" /> <circle cx="12" cy="19" r="1" /></svg>
      </button>` : ''}
      </div>
    </div>`;
  }).join('') + `</div>`;
}

// Large avatar variant for the team grid cards — the shared 30px inline
// version (personAvatarHtml) reads too small as the focal point of a card.
function teamCardAvatarHtml(m){
  return m.avatar_url
    ? `<img class="team-card-avatar" src="${safeUrl(m.avatar_url)}">`
    : `<div class="team-card-avatar-fallback" style="background:${avatarColorForName(m.name)};">${escapeHtml((m.name||'?').trim().charAt(0).toUpperCase())}</div>`;
}

// Named list rather than hardcoded checkboxes — adding a future
// permission (the user's own "we can expand later") is one line here,
// not new HTML in the modal below.
const EXTRA_PERMISSIONS_META = [
  { key:'view_team_queue', label: "See Team Queue (everyone's drafts)" },
  { key:'delete_tasks', label: 'Permanently delete tasks' },
  { key:'delete_clients', label: 'Manage & permanently delete clients from Trash' },
  { key:'lower_danger_score', label: "Clear a client's Risk flag" },
];

function openTeamMemberDetail(id){
  const m = teamProfiles.find(x=>x.id===id);
  if(!m) return;
  const isSelf = currentUser && m.id === currentUser.id;
  const isRevoked = !!m.access_revoked;
  const roleControl = (isAdmin() && !isSelf)
    ? `<select onchange="changeTeamRole('${m.id}', this.value)" style="font-family:var(--font);font-size:13px;padding:6px 9px;border-radius:6px;border:1px solid var(--border);background:var(--card);color:var(--ink);width:100%;">
        <option value="member" ${m.role==='member'?'selected':''}>Member</option>
        <option value="approver" ${m.role==='approver'?'selected':''}>Approver</option>
        <option value="admin" ${m.role==='admin'?'selected':''}>Admin</option>
      </select>`
    : `<span class="role-chip">${escapeHtml(roleDisplayLabel(m.role))}${isSelf ? ' · you' : ''}</span>`;
  const titleControl = isAdmin()
    ? `<select onchange="changeTeamTitle('${m.id}', this.value)" style="font-family:var(--font);font-size:13px;padding:6px 9px;border-radius:6px;border:1px solid var(--border);background:var(--card);color:var(--ink);width:100%;">
        <option value="">No title</option>
        ${(settings.teamTitleOptions||[]).map(o=>`<option value="${escapeHtml(o)}" ${m.title===o?'selected':''}>${escapeHtml(o)}</option>`).join('')}
      </select>`
    : (m.title ? `<span class="role-chip">${escapeHtml(m.title)}</span>` : `<span style="color:var(--muted-lt);font-size:13px;">No title set</span>`);
  const slackIdControl = isAdmin()
    ? `<input type="text" value="${escapeHtml(m.slack_user_id||'')}" placeholder="e.g. U0123ABCDEF" onblur="changeTeamSlackId('${m.id}', this.value.trim())" style="font-family:var(--font);font-size:13px;padding:6px 9px;border-radius:6px;border:1px solid var(--border);background:var(--card);color:var(--ink);width:100%;">`
    : '';

  // A real section header, not a plain field <label> (11px, muted) — the
  // toggle rows underneath read at 12.5px in --ink, which is visually
  // louder than that default label style, making it look like the section
  // heading was smaller than its own contents. This matches the section
  // header treatment already used elsewhere (Additional Info, weekly
  // report steps).
  const sectionHeadingStyle = 'font-family:var(--font);font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:var(--ink);display:block;margin-bottom:2px;';
  const toggleRow = (label, isOn, onclickJs, showDivider) => `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;${showDivider?'border-bottom:1px solid var(--border);':''}">
      <span style="font-size:13.5px;color:var(--ink);">${escapeHtml(label)}</span>
      <button class="theme-toggle-switch ${isOn?'on':''}" onclick="${onclickJs}"></button>
    </div>`;

  // AI Assistant access now shows for every role, not just members —
  // unlike the three extra_permissions below (which only ever matter for
  // members, since admins/approvers already have those by role), an
  // admin needs to be able to revoke Assistant access from a specific
  // admin/approver too, not just grant it to a member.
  // lower_danger_score: approvers and admins clear flags by role (Nov 25), so it's for members only.
  const lowerDangerRow = m.role === 'member'
    ? toggleRow(EXTRA_PERMISSIONS_META.find(p=>p.key==='lower_danger_score').label, (m.extra_permissions||[]).includes('lower_danger_score'), `changeTeamPermission('${m.id}','lower_danger_score',${!(m.extra_permissions||[]).includes('lower_danger_score')})`, true)
    : '';
  const memberOnlyPermissionRows = m.role==='member'
    ? EXTRA_PERMISSIONS_META.filter(p=>p.key!=='lower_danger_score').map((p,i)=> toggleRow(p.label, (m.extra_permissions||[]).includes(p.key), `changeTeamPermission('${m.id}','${p.key}',${!(m.extra_permissions||[]).includes(p.key)})`, true))
    : [];
  const allToggleRows = [ toggleRow('AI Assistant access', !!m.ai_chat_enabled, `toggleMemberAiChatEnabled('${m.id}', ${!!m.ai_chat_enabled})`, true), ...(lowerDangerRow ? [lowerDangerRow] : []), ...memberOnlyPermissionRows ];
  // Strip the trailing divider off the last row in the list so the
  // section doesn't end on a stray line right before its own caption.
  const permissionsHtml = allToggleRows.map((row,i)=> i===allToggleRows.length-1 ? row.replace('border-bottom:1px solid var(--border);','') : row).join('');
  const permissionsControl = isAdmin() ? `
    <div style="grid-column:1/-1;padding-top:14px;margin-top:2px;border-top:1px solid var(--border);">
      <span style="${sectionHeadingStyle}">Extra Permissions</span>
      <div style="margin-top:8px;">${permissionsHtml}</div>
      <p style="font-size:11px;color:var(--muted-lt);margin:8px 0 0;">${m.role==='member' ? 'Grants specific extra access without changing their role.' : 'Everything else here is already covered automatically by role — these are the specific things worth adjusting per person instead.'}</p>
    </div>` : '';
  openAppModal(`
    <div class="modal-head"><span class="panel-title">${escapeHtml(m.name)}</span><span class="toast-close" onclick="closeAppModal()">✕</span></div>
    <div class="modal-body" style="display:flex;flex-direction:column;align-items:center;gap:16px;">
      ${teamCardAvatarHtml(m)}
      ${isRevoked ? `<span class="pill pill-bad">Access revoked</span>` : ''}
      <div class="form-grid" style="width:100%;row-gap:16px;">
        <div><label>Email</label><div style="font-size:14px;color:var(--ink);">${escapeHtml(m.email) || '—'}</div></div>
        <div><label>Phone</label><div style="font-size:14px;color:var(--ink);">${m.phone || '—'}</div></div>
        <div><label>Title</label>${titleControl}</div>
        <div><label>Role</label>${roleControl}</div>
        ${isAdmin() ? `<div style="grid-column:1/-1;padding-top:14px;border-top:1px solid var(--border);"><label>Slack member ID</label>${slackIdControl}<p style="font-size:11px;color:var(--muted-lt);margin:6px 0 0;">From their Slack profile → "..." → Copy member ID. Lets this app DM them notifications, and lets Slack's /task command recognize them.</p></div>` : ''}
        ${permissionsControl}
      </div>
    </div>
    <div class="modal-actions">
      ${(!isSelf && !isRevoked) ? `<button class="btn btn-outline" onclick="closeAppModal(); openNewTaskModal('${m.id}')">Assign task</button>` : ''}
      ${m.email ? `<a class="btn btn-outline" href="mailto:${escapeHtml(m.email)}" style="text-decoration:none;">Email</a>` : ''}
      <button class="btn btn-brand" onclick="closeAppModal()">Done</button>
    </div>`, 420);
}

async function changeTeamTitle(userId, newTitle){
  if(!isAdmin()){ showToast('error','Not allowed','Only admins can change titles.'); return; }
  const { error } = await supabaseClient.from('team_profiles').update({ title: newTitle || null }).eq('id', userId);
  if(error){ showToast('error','Could not update title', error.message); await loadTeamProfiles(); renderTeam(); return; }
  await loadTeamProfiles();
  renderTeam();
  showToast('success','Title updated', 'Change is live immediately.');
  if(userId !== currentUser?.id && newTitle){
    sendNotification(userId, 'profile_changed', 'Your title changed', `${myName()||'An admin'} set your title to "${newTitle}".`, 'profile');
  }
}

async function changeTeamRole(userId, newRole){
  if(!isAdmin()){ showToast('error','Not allowed','Only admins can change roles.'); return; }
  const { error } = await supabaseClient.from('team_profiles').update({ role: newRole }).eq('id', userId);
  if(error){ showToast('error','Could not update role', error.message); await loadTeamProfiles(); renderTeam(); return; }
  await loadTeamProfiles();
  renderTeam();
  log.unshift({t:nowTime(), tag:'you', userId:currentUser?.id, text:`Changed a team member's role to <b>${newRole}</b>.`});
  await persistLog(); renderLog();
  showToast('success','Role updated', 'Change is live immediately for that person.');
  if(userId !== currentUser?.id){
    sendNotification(userId, 'profile_changed', 'Your role changed', `${myName()||'An admin'} changed your role to ${roleDisplayLabel(newRole)}.`, 'profile');
  }
}

async function changeTeamSlackId(userId, newSlackId){
  if(!isAdmin()){ showToast('error','Not allowed','Only admins can set this.'); return; }
  const { error } = await supabaseClient.from('team_profiles').update({ slack_user_id: newSlackId || null }).eq('id', userId);
  if(error){ showToast('error','Could not save', error.message); await loadTeamProfiles(); return; }
  await loadTeamProfiles();
  showToast('success', newSlackId ? 'Slack ID saved' : 'Slack ID cleared', newSlackId ? 'They\'ll get Slack DMs for anything they don\'t have muted.' : 'They won\'t receive Slack DMs from this app anymore.');
}

async function toggleMemberAiChatEnabled(userId, currentlyEnabled){
  if(!isAdmin()){ showToast('error','Not allowed','Only admins can change this.'); return; }
  const newValue = !currentlyEnabled;
  const { error } = await supabaseClient.from('team_profiles').update({ ai_chat_enabled: newValue }).eq('id', userId);
  if(error){ showToast('error','Could not update', error.message); return; }
  await loadTeamProfiles();
  renderTeam();
  const m = teamProfiles.find(x=>x.id===userId);
  // If an admin toggles their OWN access (e.g. testing what a member
  // sees), reflect it immediately in their own session too — myProfile is
  // a separate fetch from teamProfiles, so it wouldn't otherwise update
  // until their next reload.
  if(userId === currentUser?.id){ myProfile.ai_chat_enabled = newValue; applyRoleVisibility(); }
  showToast('success', newValue ? 'Enabled' : 'Disabled', `AI Assistant access ${newValue?'enabled for':'disabled for'} ${m?.name||'this person'}.`);
  if(userId !== currentUser?.id){
    sendNotification(userId, 'profile_changed', newValue ? 'Assistant access enabled' : 'Assistant access disabled', `${myName()||'An admin'} ${newValue?'turned on':'turned off'} your AI Assistant access.`, 'profile');
  }
  if(document.getElementById('appModalOverlay')) openTeamMemberDetail(userId);
}

async function changeTeamPermission(userId, key, granted){
  if(!isAdmin()){ showToast('error','Not allowed','Only admins can change this.'); return; }
  const m = teamProfiles.find(p=>p.id===userId);
  if(!m) return;
  const current = m.extra_permissions || [];
  const updated = granted ? [...new Set([...current, key])] : current.filter(k=>k!==key);
  const { error } = await supabaseClient.from('team_profiles').update({ extra_permissions: updated }).eq('id', userId);
  if(error){ showToast('error','Could not save', error.message); await loadTeamProfiles(); return; }
  m.extra_permissions = updated;
  await loadTeamProfiles();
  const label = EXTRA_PERMISSIONS_META.find(p=>p.key===key)?.label || key;
  showToast('success', granted ? 'Permission granted' : 'Permission removed', `${label} — ${granted ? 'now allowed' : 'no longer allowed'} for ${m.name}.`);
  if(document.getElementById('appModalOverlay')) openTeamMemberDetail(userId);
}

async function adminResetPassword(userId, name){
  if(!isAdmin()) return;
  if(!(await confirmDialog(`Set a new temporary password for ${name}? Their current password stops working immediately, and you'll need to send them this new one directly.`, {confirmLabel:'Set password'}))) return;
  try{
    const { data: { session } } = await supabaseClient.auth.getSession();
    const response = await fetch('/api/admin-user-actions', {
      method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${session.access_token}`},
      body: JSON.stringify({ action:'reset-password', targetUserId: userId })
    });
    const data = await response.json();
    if(!response.ok){ showToast('error','Reset failed', data.error || 'Could not reset the password.'); return; }
    openAppModal(`
      <div class="modal-head"><span class="panel-title">Password reset for ${escapeHtml(name)}</span><span class="toast-close" onclick="closeAppModal()">✕</span></div>
      <div class="modal-body">
        <p style="font-size:13.5px;color:var(--muted);margin:0 0 14px;line-height:1.5;">Send this to ${escapeHtml(name)} directly — it won't be shown again. They should change it after logging in.</p>
        <div class="settings-field"><label>Temporary password</label><input value="${data.tempPassword}" readonly style="font-family:var(--font);font-weight:600;"></div>
      </div>
      <div class="modal-actions"><button class="btn btn-outline" onclick="closeAppModal()">Close</button></div>`, 440);
  }catch(e){
    showToast('error','Reset failed','Network error — try again.');
  }
}

async function toggleUserAccess(userId, name, revoke){
  if(!isAdmin()) return;
  const msg = revoke
    ? `Revoke ${name}'s access? They'll be immediately signed out and unable to log back in. This doesn't delete anything — their tasks, notes, and history all stay intact, and you can restore access anytime.`
    : `Restore ${name}'s access? They'll be able to log in again immediately.`;
  if(!confirm(msg)) return;
  try{
    const { data: { session } } = await supabaseClient.auth.getSession();
    const response = await fetch('/api/admin-user-actions', {
      method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${session.access_token}`},
      body: JSON.stringify({ action:'toggle-access', targetUserId: userId, revoke })
    });
    const data = await response.json();
    if(!response.ok){ showToast('error', revoke?'Revoke failed':'Restore failed', data.error || 'Could not update access.'); return; }
    await loadTeamProfiles();
    renderTeam();
    showToast('success', revoke?'Access revoked':'Access restored', `${name} ${revoke?'can no longer log in.':'can log in again.'}`);
    if(!revoke && userId !== currentUser?.id){
      sendNotification(userId, 'profile_changed', 'Your access was restored', `${myName()||'An admin'} restored your access — you can log in again.`, 'profile');
    }
  }catch(e){
    showToast('error','Request failed','Network error — try again.');
  }
}

async function confirmDeleteUser(userId, name){
  if(!isAdmin()) return;
  openAppModal(`
    <div class="modal-head"><span class="panel-title" style="color:var(--red);">Permanently delete ${escapeHtml(name)}?</span><span class="toast-close" onclick="closeAppModal()">✕</span></div>
    <div class="modal-body">
      <p style="font-size:13.5px;color:var(--ink);line-height:1.6;margin:0 0 10px;">This can't be undone. It permanently deletes:</p>
      <ul style="font-size:13.5px;color:var(--ink);line-height:1.7;margin:0 0 14px;padding-left:20px;">
        <li>${escapeHtml(name)}'s account and profile</li>
        <li>Every task where they're the assignee <b>or the assigner</b> — including tasks they assigned to other people</li>
        <li>Their notes, calendar events, and time entries</li>
      </ul>
      <p style="font-size:13.5px;color:var(--muted);line-height:1.5;margin:0 0 14px;">Most of the time, <b>Revoke access</b> is what you actually want — it locks them out immediately without deleting anything, and can be undone. Use delete only for genuinely permanent cleanup.</p>
      <div class="settings-field"><label>Type "${escapeHtml(name)}" to confirm</label><input id="deleteUserConfirmInput" placeholder="${escapeHtml(name)}" oninput="document.getElementById('deleteUserConfirmBtn').disabled = this.value.trim() !== ${jsArg(name)}"></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeAppModal()">Cancel</button>
      <button class="btn btn-brand" style="background:var(--red);" id="deleteUserConfirmBtn" disabled onclick="deleteUserPermanently('${userId}',${jsArg(name)})">Delete permanently</button>
    </div>`, 480);
}

async function deleteUserPermanently(userId, name){
  const btn = document.getElementById('deleteUserConfirmBtn');
  setBtnLoading(btn, 'Deleting…');
  try{
    const { data: { session } } = await supabaseClient.auth.getSession();
    const response = await fetch('/api/admin-user-actions', {
      method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${session.access_token}`},
      body: JSON.stringify({ action:'delete-user', targetUserId: userId })
    });
    const data = await response.json();
    if(!response.ok){ restoreBtn(btn); showToast('error','Delete failed', data.error || 'Could not delete this account.'); return; }
    closeAppModal();
    await loadTeamProfiles();
    await loadAll();
    renderTeam(); renderClientsTable(); renderTasks();
    showToast('success','Deleted', `${name}'s account and everything tied to it is gone.`);
  }catch(e){
    restoreBtn(btn);
    showToast('error','Delete failed','Network error — try again.');
  }
}
