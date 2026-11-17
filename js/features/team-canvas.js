// Team, as on the canvas: the people on the left, the selected person on the right with their
// title, role, extra access and details. Admins also get Job Titles and Email Requests.
// The actions themselves (change role, reset password, revoke, remove…) are the ones in team.js.

let teamTab = 'members', teamSelId = null, emailRequests = [];

VIEW_TOOLBAR_ACTIONS.team = () => isAdmin() ? `<button class="btn" onclick="openAddMemberSheet()">${icon('user-plus')}Add Member</button>` : '';
function switchTeamTab(name){ teamTab = name; renderTeam(); }
function selectTeamMember(id){ teamSelId = id; renderTeam(); }

async function renderPendingEmailRequests(){
  if(!isAdmin()){ emailRequests = []; return; }
  const { data, error } = await supabaseClient.from('email_change_requests').select('*').eq('status', 'pending').order('created_at', { ascending: true });
  if(error) return;
  emailRequests = data || [];
  updateEmailRequestBadges(emailRequests.length);
  if(currentViewName === 'team') drawTeam();
}
function renderTeam(){
  if(isAdmin() && !renderTeam._asked){ renderTeam._asked = true; renderPendingEmailRequests(); loadPayrollRates().then(() => { if(currentViewName === 'team') drawTeam(); }); }
  drawTeam();
}

function teamWeekMinutes(id){
  const wk0 = getWeekStart(rNow());
  return timeEntries.filter(e => e.userId === id && new Date(e.date + 'T12:00:00') >= wk0).reduce((s, e) => s + e.minutes, 0);
}
function teamOwns(m){ return activeClients().filter(c => clientOwner(c) === m.name).length; }
function teamOpenFollowUps(m){ return (typeof clientReminders !== 'undefined' ? clientReminders : []).filter(r => r.askedBy === m.id && r.status === 'waiting').length; }

function drawTeam(){
  const root = document.getElementById('teamRoot');
  if(!root) return;
  if(!isAdmin() && teamTab !== 'members') teamTab = 'members';
  const people = teamProfiles.slice().sort((a, b) => (a.id === currentUser?.id ? -1 : b.id === currentUser?.id ? 1 : a.name.localeCompare(b.name)));
  if(currentViewName === 'team') setToolbar('Team', `${people.length} ${people.length === 1 ? 'person' : 'people'}`);
  if(!people.some(p => p.id === teamSelId)) teamSelId = (people.find(p => p.id !== currentUser?.id) || people[0])?.id || null;
  const admin = isAdmin();
  const tabs = admin ? `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:14px"><div class="seg" role="tablist" aria-label="Team sections">${[['members', 'Members', people.length], ['titles', 'Job Titles', (settings.teamTitleOptions || []).length], ['emails', 'Email Requests', emailRequests.length]].map(([k, t, n]) => `<button class="${teamTab === k ? 'on' : ''}" role="tab" aria-selected="${teamTab === k}" onclick="switchTeamTab('${k}')">${t}${n ? ` <span class="c">${n}</span>` : ''}</button>`).join('')}</div></div>` : '';

  let body = '';
  if(teamTab === 'members'){
    const rows = people.map(m => {
      const self = m.id === currentUser?.id, on = m.id === teamSelId, owns = teamOwns(m);
      return `<div class="row${on ? ' sel' : ''}" role="button" tabindex="0" ${on ? 'aria-current="true" style="background:var(--select)"' : ''} onclick="selectTeamMember('${m.id}')" onkeydown="if(event.key==='Enter')selectTeamMember('${m.id}')"${m.access_revoked ? ' data-off="1"' : ''}>${avHtml(m.name, 'style="width:32px;height:32px;font-size:12px"')}
<div class="tx"><span class="t">${escapeHtml(m.name)}${self ? ' (you)' : ''}</span><span class="s">${escapeHtml(m.title || ({ member: 'Member', approver: 'Approver', admin: 'Admin' }[m.role] || ''))}${m.access_revoked ? ' · access revoked' : ''}</span></div>
<div class="r"><span style="width:84px">${{ member: 'Member', approver: 'Approver', admin: 'Admin' }[m.role] || escapeHtml(roleDisplayLabel(m.role))}</span><span style="width:70px">${owns ? `${owns} client${owns === 1 ? '' : 's'}` : '—'}</span>${admin ? `<span class="dur" style="width:64px;text-align:right">${hmLong(teamWeekMinutes(m.id))}</span>` : ''}</div></div>`;
    }).join('');
    const waiting = admin && emailRequests.length ? `<div class="h2"><h2>Waiting for you<span class="c">${emailRequests.length}</span></h2></div><div class="grp">${emailRequests.map(emailReqRow).join('')}</div>` : '';
    body = `<div class="mhead" style="padding:0 14px 6px 58px"><span>Name</span><span style="width:84px;flex:0 0 auto">Role</span><span style="width:70px;flex:0 0 auto">Owns</span>${admin ? '<span style="width:64px;flex:0 0 auto;text-align:right">This week</span>' : ''}</div>
<div class="grp">${rows || '<div class="empty">No one on the team yet.</div>'}</div>${waiting}
${admin ? '' : '<p class="t-2" style="font-size:12px;margin:12px 4px 0">Only admins can add people or change roles.</p>'}`;
  } else if(teamTab === 'titles'){
    const opts = (settings.teamTitleOptions || []).map(o => `<span class="opt">${escapeHtml(o)}<button class="ib" style="width:16px;height:16px" aria-label="Remove ${escapeHtml(o)}" onclick="removeTitle(${jsArg(o)})">${icon('x', { weight: 'bold' })}</button></span>`).join('');
    body = `<p class="t-2" style="font-size:12px;margin:0 4px 10px">Shown under each person’s name. Titles don’t change what anyone can do; roles do.</p>
<div class="form-grp"><div class="fr" style="flex-wrap:wrap;padding:12px 14px">${opts ? `<div class="opts">${opts}</div>` : '<span class="t-2" style="font-size:13px">No job titles yet.</span>'}</div>
<div class="fr"><input class="tf" id="titleOptionInput" style="flex:1" placeholder="Add a job title" aria-label="Add a job title" onkeydown="if(event.key==='Enter')addTitle()"><button class="btn" onclick="addTitle()">Add</button></div></div>`;
  } else {
    body = emailRequests.length ? `<div class="grp">${emailRequests.map(emailReqRow).join('')}</div>` : '<div class="empty">No email changes waiting.</div>';
  }
  const sel = people.find(p => p.id === teamSelId);
  root.innerHTML = `<div class="tbl-wrap"><div class="content" style="overflow:visible">${tabs}${body}</div></div>${teamTab === 'members' && sel ? teamInspHtml(sel) : ''}`;
}

function emailReqRow(r){
  const p = teamProfiles.find(x => x.id === r.user_id), name = p ? p.name : 'A former teammate';
  return `<div class="row">${avHtml(name)}<div class="tx"><span class="t">${escapeHtml(name)} wants to change ${p ? 'their' : 'an'} email</span><span class="s">${escapeHtml(r.current_email || '')} → ${escapeHtml(r.requested_email || '')}</span></div><div class="r"><button class="btn sm" onclick="resolveEmailChangeRequest('${r.id}', false)">Decline</button><button class="btn sm" onclick="resolveEmailChangeRequest('${r.id}', true)">Approve</button></div></div>`;
}
async function addTitle(){ await addFieldOption('title'); drawTeam(); }
async function removeTitle(v){ await removeFieldOption('title', v); drawTeam(); }

const ROLE_INFO = [['member', 'Member', 'Logs improvements and time. Can’t approve drafts.'], ['approver', 'Approver', 'Everything a member can do, plus approve, skip and send drafts.'], ['admin', 'Admin', 'Full access, including the team, roles, payroll and settings.']];
function teamInspHtml(m){
  const admin = isAdmin(), self = m.id === currentUser?.id, extra = m.extra_permissions || [];
  const titleCtl = admin
    ? `<label class="pop pop-sel"><span>${escapeHtml(m.title || 'No title')}</span>${icon('caret-up-down', { weight: 'bold' })}<select aria-label="Job title" onchange="changeTeamTitle('${m.id}', this.value)"><option value="">No title</option>${(settings.teamTitleOptions || []).map(o => `<option ${m.title === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}</select></label>`
    : `<span style="font-size:13px">${escapeHtml(m.title || 'No title')}</span>`;
  const canRole = admin && !self;
  const roles = ROLE_INFO.map(([k, t, d]) => `<div style="display:flex;gap:10px;align-items:flex-start;padding:8px 0"${canRole ? ` role="radio" tabindex="0" aria-checked="${m.role === k}" onclick="${m.role === k ? '' : `changeTeamRole('${m.id}','${k}')`}" onkeydown="if(event.key==='Enter'||event.key===' ')this.click()"` : ''}><span class="rd${m.role === k ? ' on' : ''}" aria-hidden="true"></span><div><div style="font-size:13px;font-weight:500">${t}</div><div class="t-2" style="font-size:12px;line-height:1.4">${d}</div></div></div>`).join('');
  // extra access beyond the role, one switch each
  const sw = (label, on, js) => `<div class="kv" style="align-items:center"><span style="color:var(--label)">${label}</span><button class="sw${on ? ' on' : ''}" role="switch" aria-checked="${on}" aria-label="${escapeHtml(label)}" onclick="${js}"></button></div>`;
  let extras = '';
  if(admin){
    extras += sw('Uses the Assistant', !!m.ai_chat_enabled, `toggleMemberAiChatEnabled('${m.id}', ${!!m.ai_chat_enabled})`);
    if(m.role !== 'admin') extras += sw('Can lower a client’s risk', extra.includes('lower_danger_score'), `changeTeamPermission('${m.id}','lower_danger_score',${!extra.includes('lower_danger_score')})`);
    if(m.role === 'member') EXTRA_PERMISSIONS_META.filter(p => p.key !== 'lower_danger_score').forEach(p => {
      const label = { view_team_queue: 'Sees everyone’s drafts', delete_tasks: 'Can delete tasks for good', delete_clients: 'Can restore and delete clients' }[p.key] || p.label;
      extras += sw(label, extra.includes(p.key), `changeTeamPermission('${m.id}','${p.key}',${!extra.includes(p.key)})`);
    });
  }
  const rate = admin && typeof payrollRates !== 'undefined' ? payrollRates[m.id] : null;
  const owns = teamOwns(m), fu = teamOpenFollowUps(m);
  const slack = admin
    ? `<input class="tf" style="width:150px;height:24px;text-align:right" value="${escapeHtml(m.slack_user_id || '')}" placeholder="Member ID" aria-label="Slack member ID" title="From their Slack profile: ⋯ → Copy member ID" onchange="changeTeamSlackId('${m.id}', this.value.trim())">`
    : `<b style="font-weight:500">${m.slack_user_id ? 'Linked' : '—'}</b>`;
  const acts = [
    !self && !m.access_revoked ? `<button class="btn" onclick="openNewTaskModal('${m.id}')">${icon('list-checks')}Assign Task</button>` : '',
    m.email ? `<a class="btn" href="mailto:${escapeHtml(m.email)}" style="text-decoration:none">${icon('envelope-simple')}Email</a>` : '',
  ].filter(Boolean).join('');
  const danger = admin && !self ? `<div style="display:flex;flex-direction:column;align-items:flex-start;gap:6px;margin-top:20px">
<button class="btn btn-q" style="padding:0" onclick="adminResetPassword('${m.id}', ${jsArg(m.name)})">Reset Password…</button>
<button class="btn btn-q" style="padding:0" onclick="toggleUserAccess('${m.id}', ${jsArg(m.name)}, ${!m.access_revoked})">${m.access_revoked ? 'Restore Access…' : 'Revoke Access…'}</button>
<button class="btn danger" onclick="confirmDeleteUser('${m.id}', ${jsArg(m.name)})">Remove from Team…</button></div>` : '';
  return `<aside class="insp" aria-label="${escapeHtml(m.name)}">
<div style="display:flex;align-items:center;gap:12px">${avHtml(m.name, 'style="width:48px;height:48px;font-size:16px"')}
<div style="min-width:0"><div style="font-size:17px;font-weight:600;letter-spacing:-.01em">${escapeHtml(m.name)}</div><div class="t-2" style="font-size:12px;overflow:hidden;text-overflow:ellipsis">${escapeHtml(m.email || '')}</div></div></div>
${acts ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:16px">${acts}</div>` : ''}
<div class="set-h" style="margin:22px 0 6px">Job title</div>${titleCtl}
<div class="set-h" style="margin:22px 0 2px">Permissions</div><div ${canRole ? 'role="radiogroup" aria-label="Permissions"' : ''}>${roles}</div>
${self && admin ? '<p class="t-2" style="font-size:12px;margin:2px 0 0">You can’t change your own role.</p>' : ''}
${extras ? `<div class="set-h" style="margin:18px 0 4px">Also allowed</div>${extras}` : ''}
<div class="set-h" style="margin:18px 0 4px">Details</div>
<div class="kv" style="align-items:center"><span>Slack</span>${slack}</div>
${admin ? `<div class="kv"><span>Hourly rate</span><b style="font-weight:500">${rate ? money(rate) : 'None'}</b></div>` : ''}
<div class="kv"><span>Owns</span><b style="font-weight:500">${owns} client${owns === 1 ? '' : 's'}</b></div>
<div class="kv"><span>Open follow-ups</span><b style="font-weight:500">${fu}</b></div>
${m.phone ? `<div class="kv"><span>Phone</span><b style="font-weight:500">${escapeHtml(m.phone)}</b></div>` : ''}
${danger}
</aside>`;
}
// The old pop-up for a person now just selects them here.
function openTeamMemberDetail(id){ teamSelId = id; teamTab = 'members'; if(currentViewName !== 'team') switchView('team'); else drawTeam(); }

function openAddMemberSheet(){
  openAppModal(`<h3>Add Member</h3>
<div class="f">
<label for="tmName">Name</label><input class="tf" id="tmName" placeholder="Priya Shah">
<label for="tmEmail">Email</label><input class="tf" id="tmEmail" type="email" placeholder="priya@basedagency.com">
<label for="tmTitle">Job title</label><select id="tmTitle"><option value="">No title</option>${(settings.teamTitleOptions || []).map(o => `<option>${escapeHtml(o)}</option>`).join('')}</select>
<label for="tmRole">Role</label><select id="tmRole">${ROLE_INFO.map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select>
<span></span><p class="t-2" style="font-size:12px;margin:0">They get a sign-in right away. You’ll see a one-time password to send them.</p>
</div>
<div class="sheet-a"><button class="btn" onclick="closeAppModal()">Cancel</button><button class="btn btn-p" onclick="submitAddMember()">Create Account</button></div>`, 480);
}
async function submitAddMember(){
  await addTeamMember();
  if(!document.getElementById('tmName')?.value && !document.getElementById('tmEmail')?.value) closeAppModal();
}
