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
      return `<div class="row${on ? ' sel' : ''}" role="button" tabindex="0" ${on ? 'aria-current="true" style="background:var(--select)"' : ''} onclick="selectTeamMember('${m.id}')" onkeydown="if(event.key==='Enter')selectTeamMember('${m.id}')"${m.access_revoked ? ' data-off="1"' : ''}>${avHtml(m.name, 'style="width:32px;height:32px;font-size:13px"')}
<div class="tx"><span class="t">${escapeHtml(m.name)}${self ? ' (you)' : ''}</span><span class="s">${escapeHtml(m.title || ({ member: 'Member', approver: 'Approver', admin: 'Admin' }[m.role] || ''))}${m.access_revoked ? ' · access revoked' : ''}</span></div>
<div class="r"><span style="width:84px">${{ member: 'Member', approver: 'Approver', admin: 'Admin' }[m.role] || escapeHtml(roleDisplayLabel(m.role))}</span><span style="width:70px">${owns ? `${owns} client${owns === 1 ? '' : 's'}` : '—'}</span>${admin ? `<span class="dur" style="width:64px;text-align:right">${hmLong(teamWeekMinutes(m.id))}</span>` : ''}</div></div>`;
    }).join('');
    const waiting = admin && emailRequests.length ? `<div class="h2"><h2>Waiting for you<span class="c">${emailRequests.length}</span></h2></div><div class="grp">${emailRequests.map(emailReqRow).join('')}</div>` : '';
    body = `<div class="mhead" style="padding:0 14px 6px 58px"><span>Name</span><span style="width:84px;flex:0 0 auto">Role</span><span style="width:70px;flex:0 0 auto">Owns</span>${admin ? '<span style="width:64px;flex:0 0 auto;text-align:right">This week</span>' : ''}</div>
<div class="grp">${rows || '<div class="empty">No one on the team yet.</div>'}</div>${waiting}
${admin && people.filter(m => !m.access_revoked).length <= 1 ? emptyState({ compact: true, icon: 'users-three', tone: 'blue', title: 'It’s just you so far',
  text: 'Add your teammates to give them clients to own, tasks to do and updates to write. They get an email to sign in.', action: 'Add Member', actionIcon: 'user-plus', onAction: 'openAddMemberSheet()', cls: 'tm-es' }) : ''}
${admin ? '' : '<p class="t-2" style="font-size:13px;margin:12px 4px 0">Only admins can add people or change roles.</p>'}`;
  } else if(teamTab === 'titles'){
    const opts = (settings.teamTitleOptions || []).map(o => `<span class="opt">${escapeHtml(o)}<button class="ib" style="width:16px;height:16px" aria-label="Remove ${escapeHtml(o)}" onclick="removeTitle(${jsArg(o)})">${icon('x', { weight: 'bold' })}</button></span>`).join('');
    body = `<p class="t-2" style="font-size:13px;margin:0 4px 10px">Shown under each person’s name. Titles don’t change what anyone can do; roles do.</p>
<div class="form-grp"><div class="fr" style="flex-wrap:wrap;padding:12px 14px">${opts ? `<div class="opts">${opts}</div>` : '<span class="t-2" style="font-size:14px">No job titles yet.</span>'}</div>
<div class="fr"><input class="tf" id="titleOptionInput" style="flex:1" placeholder="Add a job title" aria-label="Add a job title" onkeydown="if(event.key==='Enter')addTitle()"><button class="btn" onclick="addTitle()">Add</button></div></div>`;
  } else {
    body = emailRequests.length ? `<div class="grp">${emailRequests.map(emailReqRow).join('')}</div>` : '<div class="empty">No email changes waiting.</div>';
  }
  const sel = people.find(p => p.id === teamSelId);
  if(teamTab === 'members' && typeof uiStyleOn === 'function' && uiStyleOn()){ root.innerHTML = teamUwHtml(people, sel, admin); return; }
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
  const { admin, self, full, titleCtl, roles, canRole, extras, slack, rate, owns, fu, acts, danger } = teamParts(m);
  return `<aside class="insp" aria-label="${escapeHtml(m.name)}">
<div style="display:flex;align-items:center;gap:12px">${avHtml(m.name, 'style="width:48px;height:48px;font-size:17px"')}
<div style="min-width:0"><div style="font-size:18px;font-weight:600;letter-spacing:-.01em">${escapeHtml(m.name)}</div><div class="t-2" style="font-size:13px;overflow:hidden;text-overflow:ellipsis">${escapeHtml(m.email || '')}</div></div></div>
${acts ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:16px">${acts}</div>` : ''}
<div class="set-h" style="margin:22px 0 6px">Job title</div>${titleCtl}
${full ? `<div class="set-h" style="margin:22px 0 2px">Permissions</div><div ${canRole ? 'role="radiogroup" aria-label="Permissions"' : ''}>${roles}</div>` : `<div class="set-h" style="margin:22px 0 6px">Role</div><span style="font-size:14px">${escapeHtml(TEAM_ROLE_WORD[m.role] || roleDisplayLabel(m.role))}</span>`}
${self && admin ? '<p class="t-2" style="font-size:13px;margin:2px 0 0">You can’t change your own role.</p>' : ''}
${extras ? `<div class="set-h" style="margin:18px 0 4px">Also allowed</div>${extras}` : ''}
<div class="set-h" style="margin:18px 0 4px">Details</div>
${full ? `<div class="kv" style="align-items:center"><span>Slack</span>${slack}</div>` : ''}
${admin ? `<div class="kv"><span>Hourly rate</span><b style="font-weight:500">${rate ? money(rate) : 'None'}</b></div>` : ''}
<div class="kv"><span>Owns</span><b style="font-weight:500">${owns} client${owns === 1 ? '' : 's'}</b></div>
${full ? `<div class="kv"><span>Open follow-ups</span><b style="font-weight:500">${fu}</b></div>` : ''}
${m.phone ? `<div class="kv"><span>Phone</span><b style="font-weight:500">${escapeHtml(m.phone)}</b></div>` : ''}
${danger}
</aside>`;
}
// What you see of a person (Nov 22): admins see everything; on your own profile you see your role,
// hours, follow-ups and Slack. Anyone else's profile, for someone who isn't an admin, is a directory
// card: name, role, title, email, phone and the clients they own. Their permissions, Slack link,
// follow-ups, hours and the health of their clients stay private to admins.
function teamParts(m){
  const admin = isAdmin(), self = m.id === currentUser?.id, extra = m.extra_permissions || [], full = admin || self;
  const titleCtl = admin
    ? `<label class="pop pop-sel"><span>${escapeHtml(m.title || 'No title')}</span>${icon('caret-up-down', { weight: 'bold' })}<select aria-label="Job title" onchange="changeTeamTitle('${m.id}', this.value)"><option value="">No title</option>${(settings.teamTitleOptions || []).map(o => `<option ${m.title === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}</select></label>`
    : `<span style="font-size:14px">${escapeHtml(m.title || 'No title')}</span>`;
  const canRole = admin && !self;
  const roles = ROLE_INFO.map(([k, t, d]) => `<div style="display:flex;gap:10px;align-items:flex-start;padding:8px 0"${canRole ? ` role="radio" tabindex="0" aria-checked="${m.role === k}" onclick="${m.role === k ? '' : `changeTeamRole('${m.id}','${k}')`}" onkeydown="if(event.key==='Enter'||event.key===' ')this.click()"` : ''}><span class="rd${m.role === k ? ' on' : ''}" aria-hidden="true"></span><div><div style="font-size:14px;font-weight:500">${t}</div><div class="t-2" style="font-size:13px;line-height:1.4">${d}</div></div></div>`).join('');
  // extra access beyond the role, one switch each
  const sw = (label, on, js) => `<div class="kv" style="align-items:center"><span style="color:var(--label)">${label}</span><button class="sw${on ? ' on' : ''}" role="switch" aria-checked="${on}" aria-label="${escapeHtml(label)}" onclick="${js}"></button></div>`;
  let extras = '';
  if(admin){
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
  return { admin, self, full, titleCtl, roles: full ? roles : '', canRole, extras, slack: full ? slack : '', rate, owns, fu: full ? fu : null, acts, danger };
}

// ---- the new look: People in a card on the left, the person in a big Profile card ----
const TEAM_ROLE_WORD = { member: 'Member', approver: 'Approver', admin: 'Admin' };
function teamUwHtml(people, sel, admin){
  const rows = people.map(m => {
    const on = sel && m.id === sel.id, owns = teamOwns(m), self = m.id === currentUser?.id;
    return `<button class="tm-r${on ? ' on' : ''}${m.access_revoked ? ' off' : ''}" ${on ? 'aria-current="true"' : ''} onclick="selectTeamMember('${m.id}')"><span class="tm-n"><b>${escapeHtml(m.name)}${self ? ' (you)' : ''}</b><span>${escapeHtml(m.title || TEAM_ROLE_WORD[m.role] || roleDisplayLabel(m.role))}${m.access_revoked ? ' · access revoked' : ''}</span></span><span class="tm-o">${owns ? `${owns} client${owns === 1 ? '' : 's'}` : '—'}</span></button>`;
  }).join('');
  const nT = (settings.teamTitleOptions || []).length;
  const links = admin ? `<span class="tm-links"><button class="uw-pill" onclick="switchTeamTab('titles')">Job titles${nT ? ` <span class="tm-pc">${nT}</span>` : ''}${icon('chevron-right')}</button></span>` : '';
  const people_ = `<section class="tm-card"><div class="tm-h"><span class="tm-ic">${icon('users-three')}</span><b>People</b><span class="tm-c">${people.length}</span>${links}</div>
<div class="tm-l">${rows || '<p class="tm-none">No one on the team yet.</p>'}</div>
${admin ? `<button class="tm-add" onclick="openAddMemberSheet()">${icon('plus')}Add someone</button>` : '<p class="tm-none">Only admins can add people or change roles.</p>'}</section>`;
  const waiting = admin && emailRequests.length ? `<section class="tm-card"><div class="tm-h"><b>Waiting for you</b><span class="tm-c">${emailRequests.length}</span></div><div class="grp tm-flat">${emailRequests.map(emailReqRow).join('')}</div></section>` : '';
  return `<div class="tm-uw"><div class="tm-side">${people_}${waiting}</div>${sel ? teamProfileHtml(sel) : ''}</div>`;
}
function teamProfileHtml(m){
  const { admin, self, full, titleCtl, roles, canRole, extras, slack, rate, owns, fu, acts, danger } = teamParts(m);
  const role = TEAM_ROLE_WORD[m.role] || roleDisplayLabel(m.role), info = full ? (ROLE_INFO.find(r => r[0] === m.role) || [])[2] || '' : '';
  // hours this week, day by day (admins see everyone's; everyone sees their own)
  let hours = '';
  if(admin || self){
    const wk0 = getWeekStart(rNow()), today = toDateStr(rNow());
    const days = Array.from({ length: 7 }, (_, i) => { const d = addDays(wk0, i), k = toDateStr(d); return { d, k, m: timeEntries.filter(e => e.userId === m.id && e.date === k).reduce((s, e) => s + e.minutes, 0) }; })
      .filter((x, i) => i < 5 || x.m > 0);
    const tot = days.reduce((s, x) => s + x.m, 0), h = Math.floor(tot / 60), mm = tot % 60;
    hours = `<div class="tm-hrs"><div class="tm-big">${h}<small>h${mm ? ` ${String(mm).padStart(2, '0')}m` : ''}</small></div><span class="uw-mono">THIS WEEK</span></div>`;
    const bars = days.map(x => `<div class="tm-b${x.k === today ? ' now' : ''}${x.k > today ? ' fut' : ''}" title="${x.d.toLocaleDateString('en-US', { weekday: 'long' })}: ${hmLong(x.m)}"><i style="height:${Math.max(Math.min(x.m / 480, 1), .04) * 100}%"></i><span>${x.d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()}</span></div>`).join('');
    hours += `<div class="tm-wk" role="img" aria-label="Hours by day this week">${bars}</div>`;
  }
  const mine = activeClients().filter(c => clientOwner(c) === m.name).sort((a, b) => a.name.localeCompare(b.name));
  // the health of someone else's clients is for admins (and you, on your own profile)
  const lv = c => { const l = clientHealth(c).level; return l === 'r' ? 'r' : l === 'y' ? 'am' : 'g'; };
  const chips = mine.length ? `<div class="tm-sec"><span class="uw-mono">CLIENTS</span><span class="uw-mono">${mine.length}</span></div><div class="tm-chips">${mine.map(c => `<button class="tm-chip" onclick="openClientDetail('${c.id}')">${full ? `<i class="${lv(c)}"></i>` : ''}${escapeHtml(c.name)}</button>`).join('')}</div>` : '';
  return `<section class="tm-card tm-pf" aria-label="${escapeHtml(m.name)}">
<div class="tm-h"><span class="tm-ic">${icon('user')}</span><b>Profile</b>${acts ? `<span class="tm-acts">${acts}</span>` : ''}</div>
<div class="tm-top"><div class="tm-who"><h2>${escapeHtml(m.name)}${self ? ' <span>(you)</span>' : ''}</h2><p>${escapeHtml(role)}${m.title ? ' · ' + escapeHtml(m.title) : ''}${info ? ' · ' + escapeHtml(info.replace(/\.$/, '').replace(/^./, x => x.toLowerCase())) : ''}</p><p class="tm-mail">${escapeHtml(m.email || '')}</p></div>${hours ? `<div class="tm-hcol">${hours}</div>` : ''}</div>
${chips}
<div class="tm-cols${full ? '' : ' is-dir'}">
${full ? `<div><div class="tm-sec"><span class="uw-mono">PERMISSIONS</span></div><div ${canRole ? 'role="radiogroup" aria-label="Permissions"' : ''}>${roles}</div>
${self && admin ? '<p class="tm-none">You can’t change your own role.</p>' : ''}
${extras ? `<div class="tm-sec"><span class="uw-mono">ALSO ALLOWED</span></div>${extras}` : ''}</div>` : ''}
<div><div class="tm-sec"><span class="uw-mono">DETAILS</span></div>
<div class="kv" style="align-items:center"><span>Job title</span>${titleCtl}</div>
${full ? `<div class="kv" style="align-items:center"><span>Slack</span>${slack}</div>` : ''}
${admin ? `<div class="kv"><span>Hourly rate</span><b style="font-weight:500">${rate ? money(rate) : 'None'}</b></div>` : ''}
<div class="kv"><span>Owns</span><b style="font-weight:500">${owns} client${owns === 1 ? '' : 's'}</b></div>
${full ? `<div class="kv"><span>Open follow-ups</span><b style="font-weight:500">${fu}</b></div>` : ''}
${m.phone ? `<div class="kv"><span>Phone</span><b style="font-weight:500">${escapeHtml(m.phone)}</b></div>` : ''}
${danger}</div>
</div></section>`;
}
// The old pop-up for a person now just selects them here.
function openTeamMemberDetail(id){ teamSelId = id; teamTab = 'members'; if(currentViewName !== 'team') switchView('team'); else drawTeam(); }

function openAddMemberSheet(){
  openAppModal(`<h3>Add Member</h3>
<div class="f">
<label for="tmName">Name</label><input class="tf" id="tmName" placeholder="Priya Shah">
<label for="tmEmail">Email</label><input class="tf" id="tmEmail" type="email" placeholder="priya@based-agency.com">
<label for="tmTitle">Job title</label><select id="tmTitle"><option value="">No title</option>${(settings.teamTitleOptions || []).map(o => `<option>${escapeHtml(o)}</option>`).join('')}</select>
<label for="tmRole">Role</label><select id="tmRole">${ROLE_INFO.map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select>
<span></span><p class="t-2" style="font-size:13px;margin:0">They get a sign-in right away. You’ll see a one-time password to send them.</p>
</div>
<div class="sheet-a"><button class="btn" onclick="closeAppModal()">Cancel</button><button class="btn btn-p" onclick="submitAddMember()">Create Account</button></div>`, 480);
}
async function submitAddMember(){
  await addTeamMember();
  if(!document.getElementById('tmName')?.value && !document.getElementById('tmEmail')?.value) closeAppModal();
}
