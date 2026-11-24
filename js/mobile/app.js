// The iPhone app: Today, Tasks, the + menu, Review and More, as on the canvas iPhone boards.
// Uses the same data code as the desktop (js/core/data.js, week-health.js, drafting.js,
// sheets-canvas.js for logging) so a client's week reads the same on both.

let tasks = [], clientReminders = [], timeEntries = [], notifications = [], calendarEvents = [];
let mNotifIds = null;   // the unread notifications already seen (for the chime)
let timerState = { running: false, startedAt: null, clientId: '', service: '', description: '', resumeEntryId: null };
let newTaskPresetStatus = 'todo';
let mTab = 'today', mTaskScope = 'everyone', mTaskClient = 'all', mReviewTab = 'waiting', mReviewClient = 'all', mStack = [], mTimerTick = null;
const $m = id => document.getElementById(id);
const mPlural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
const mEsc = s => escapeHtml(s == null ? '' : String(s));

// ---- small helpers the desktop keeps in files the phone doesn't load ----------------------------
function shortClientName(name){ return String(name || '').replace(/\s+(Builders|Co\.?|Company|LLC|Inc\.?|Homes|Remodeling|Construction)$/i, '').trim(); }
function parseDurationInput(str){
  str = (str || '').trim().toLowerCase().replace(',', '.'); if(!str) return null;
  const colon = str.match(/^(\d{1,3}):(\d{2})$/); if(colon) return +colon[1] * 60 + +colon[2];
  const hm = str.match(/^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+(?:\.\d+)?)\s*m)?$/);
  if(hm && (hm[1] !== undefined || hm[2] !== undefined)) return Math.round(parseFloat(hm[1] || 0) * 60 + parseFloat(hm[2] || 0));
  const plain = parseFloat(str); return isNaN(plain) ? null : Math.round(plain * 60);
}

// ---- building blocks (the canvas iPhone markup) -----------------------------------------------
function mIr(lead, t, s, right, onclick, opts){
  opts = opts || {};
  // A row that holds its own control (a checkbox, a call button) can't be a <button>, so it's a div acting as one.
  const tag = onclick && !opts.div ? 'button' : 'div';
  const sub = s ? (opts.tags ? `<span class="tags">${s}</span>` : `<span class="${opts.s2 ? 's2' : 's'}">${s}</span>`) : '';
  const chev = onclick && !opts.noChev ? icon('caret-right', { cls: 'chev', weight: 'bold' }) : '';
  const role = onclick && opts.div ? ` role="button" tabindex="0" onkeydown="if(event.target===this&&(event.key==='Enter'||event.key===' ')){event.preventDefault();this.click()}"` : '';
  return `<${tag} class="ir${onclick && opts.div ? ' tap' : ''}${opts.cls ? ' ' + opts.cls : ''}"${onclick ? ` onclick="${onclick}"` : ''}${role}${opts.attrs || ''}>${lead || ''}<div class="tx"><span class="t${opts.n ? ' n' : ''}">${t}</span>${sub}</div><div class="r">${right || ''}${chev}</div></${tag}>`;
}
function mDot(color, text, cls){ return `<span class="st${cls ? ' ' + cls : ''}"><span class="dot ${color}"></span>${text || ''}</span>`; }
function mIsh(title, more, cls){ return `<div class="ish"><h2${cls ? ` class="${cls}"` : ''}>${title}</h2>${more ? `<button onclick="${more}">See All</button>` : ''}</div>`; }
function mSeg(items, onPick, cur){ return `<div class="iseg" role="tablist">${items.map(([k, t, n]) => `<button class="${cur === k ? 'on' : ''}" role="tab" aria-selected="${cur === k}" onclick="${onPick}('${k}')">${t}${n != null ? ` <span class="c">${n}</span>` : ''}</button>`).join('')}</div>`; }
function mEmpty(title, sub){ return `<div class="iempty"><b>${title}</b>${sub || ''}</div>`; }
function mCb(t){
  const done = t.status === 'done', mine = t.assigneeId === currentUser?.id || t.assignerId === currentUser?.id;
  return done ? `<span class="cb done" role="checkbox" aria-checked="true" aria-label="Done">${icon('check', { weight: 'bold' })}</span>`
    : `<button class="cb" role="checkbox" aria-checked="false" aria-label="Mark ${mEsc(t.title)} done"${mine ? ` onclick="event.stopPropagation();checkOff(this, () => mCompleteTask('${t.id}'))"` : ' disabled'}></button>`;
}

// ---- toast ---------------------------------------------------------------------------------
function showToast(type, title, detail, opts){
  const el = $m('mToast'); if(!el) return;
  el.className = 'itoast ' + type;
  const act = opts && opts.action && typeof opts.onAction === 'function';
  el.innerHTML = `${icon(type === 'error' ? 'x' : type === 'success' ? 'check-circle' : 'info')}<div><b>${mEsc(title)}</b>${detail ? `<span>${mEsc(detail)}</span>` : ''}</div>${act ? `<button class="itoast-act">${mEsc(opts.action)}</button>` : ''}`;
  if(act) el.querySelector('.itoast-act').onclick = () => { el.classList.remove('in'); opts.onAction(); };   // e.g. Undo
  requestAnimationFrame(() => el.classList.add('in'));
  clearTimeout(showToast._t); showToast._t = setTimeout(() => el.classList.remove('in'), act ? 5500 : 3200);
}
// An iOS alert, not the browser's confirm() (which titles itself with the site's address).
let mAlertResolve = null;
function confirmDialog(message, opts){
  opts = opts || {};
  let el = $m('mAlert');
  if(!el){ el = document.createElement('div'); el.id = 'mAlert'; el.className = 'ialert'; document.body.appendChild(el); }
  el.innerHTML = `<div class="ialert-box" role="alertdialog" aria-modal="true" aria-labelledby="mAlertT"><div class="ialert-tx"><b id="mAlertT">${mEsc(opts.title || message)}</b>${opts.title ? `<span>${mEsc(message)}</span>` : ''}</div>
<div class="ialert-btns"><button onclick="mAlertDone(false)">${mEsc(opts.cancelLabel || 'Cancel')}</button><button id="mAlertOk" class="${opts.danger ? 'danger' : 'ok'}" onclick="mAlertDone(true)">${mEsc(opts.confirmLabel || 'OK')}</button></div></div>`;
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  if(mAlertResolve) mAlertResolve(false);
  return new Promise(res => { mAlertResolve = res; });
}
function mAlertDone(ok){
  const el = $m('mAlert'); if(el){ el.classList.remove('in'); setTimeout(() => { if(!el.classList.contains('in')) el.innerHTML = ''; }, 220); }
  const r = mAlertResolve; mAlertResolve = null; if(r) r(!!ok);
}

// ---- sign in and loading -------------------------------------------------------------------
// The calm sign-in (Nov 20): the logo in a few still rings, grouped fields, one orange button. Forgot
// password, the sent link and a new password (after a reset link) swap in place; signing in, the
// greeting and a thin line show while the workspace loads, then the app fades in. Shared pieces
// (messages, the eye, the reset-link flag) are js/ui/signin.js; the look is css/signin.css + mobile.css.
const M_SI_TEXT = { boot: ['Based Radar', ''], form: ['Based Radar', 'Sign in with your work email'], forgot: ['Reset your password', 'Based Radar'],
  sent: ['Check your email', 'Based Radar'], newpw: ['Set a new password', 'Based Radar'], opening: [null, 'Opening your workspace'] };
function mRings(){
  const step = 96 * .62, rings = 6;
  let h = ''; for(let k = 1; k <= rings; k++) h += `<span class="rd-ring" style="--d:${Math.round(2 * step * k)}px;--o:${Math.max(.18, 1 - .13 * (k - 1)).toFixed(2)}"></span>`;
  return `<div class="rd" aria-hidden="true" style="--R:${Math.round(rings * step)}px">${h}</div>`;
}
function mLoginShell(){
  if($m('msiRoot')) return;
  $m('mApp').className = 'phone app is-signin';
  $m('mApp').innerHTML = `<div class="stage"><div class="iscroll"><div class="msi" id="msiRoot" data-st="boot">
<div class="si-mark">${mRings()}<span class="si-logo brand-mark" aria-hidden="true">BA</span></div>
<h1 class="si-h" id="msiHead">Based Radar</h1><p class="si-sub" id="msiSub" aria-live="polite"></p>
<div class="msi-body" id="msiBody"></div>
<p class="msi-note is-out" id="msiNote">New to the team? An admin adds you from Team.</p>
</div></div></div>`;
}
function mEyeBtn(){ return `<button class="si-eye" type="button" aria-label="Show password" aria-pressed="false" onclick="siToggleEye(this)">${icon('eye')}</button>`; }
function mLogin(st, o){
  o = o || {};
  mLoginShell();
  const root = $m('msiRoot'), body = $m('msiBody'), email = mEsc(o.email != null ? o.email : ($m('mlEmail')?.value || $m('mlResetEmail')?.value || '').trim());
  root.dataset.st = st;
  const [h, sub] = M_SI_TEXT[st] || M_SI_TEXT.form;
  siText($m('msiHead'), o.heading || h || $m('msiHead').textContent);
  siText($m('msiSub'), o.sub != null ? o.sub : sub);
  $m('msiNote').classList.toggle('is-out', st !== 'form');
  const err = o.err ? `<p class="msi-err" role="alert">${mEsc(o.err)}</p>` : '';
  const html = {
    form: `<form class="msi-f" onsubmit="mSignIn();return false;" novalidate aria-label="Sign in">
<div class="ig msi-ig"><div class="ir"><label class="ilab" for="mlEmail">Email</label><input id="mlEmail" class="itf${o.bad === 'email' ? ' bad' : ''}" type="email" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="you@based-agency.com" value="${email}"></div>
<div class="ir"><label class="ilab" for="mlPass">Password</label><input id="mlPass" class="itf${o.bad === 'pass' ? ' bad' : ''}" type="password" autocomplete="current-password" placeholder="Required">${mEyeBtn()}</div></div>
${err}<button class="ibtn p msi-go" id="mlBtn" type="submit">Sign In</button></form>
<button class="msi-link" type="button" onclick="mLogin('forgot')">Forgot password?</button>`,
    forgot: `<form class="msi-f" onsubmit="mSendLink();return false;" novalidate aria-label="Reset your password">
<p class="msi-p">Enter your work email and we’ll send a link to set a new password.</p>
<div class="ig msi-ig"><div class="ir"><label class="ilab" for="mlResetEmail">Email</label><input id="mlResetEmail" class="itf" type="email" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="you@based-agency.com" value="${email}"></div></div>
${err}<button class="ibtn p msi-go" id="mlResetBtn" type="submit">Send Link</button></form>
<button class="msi-link" type="button" onclick="mLogin('form')">Back to Sign In</button>`,
    sent: `<div class="msi-f msi-sent"><span class="si-ok">${icon('mail-check')}</span>
<p class="msi-p">A link to set a new password is on its way to <b>${email}</b>. It works for an hour.</p>
<button class="ibtn msi-go msi-sec" type="button" onclick="mLogin('form')">Back to Sign In</button></div>`,
    newpw: `<form class="msi-f" onsubmit="mSaveNewPassword();return false;" novalidate aria-label="Set a new password">
<p class="msi-p">Choose a new password for <b>${mEsc(o.account || '')}</b>. Use at least 8 characters.</p>
<div class="ig msi-ig"><div class="ir"><label class="ilab" for="mlNewPw">New</label><input id="mlNewPw" class="itf" type="password" autocomplete="new-password" placeholder="At least 8 characters">${mEyeBtn()}</div>
<div class="ir"><label class="ilab" for="mlNewPw2">Confirm</label><input id="mlNewPw2" class="itf" type="password" autocomplete="new-password" placeholder="Again"></div></div>
${err}<button class="ibtn p msi-go" id="mlNewBtn" type="submit">Save Password</button></form>
<button class="msi-link" type="button" onclick="mLeaveRecovery()">Back to Sign In</button>`,
    opening: `<div class="si-open"><span class="si-bar" aria-hidden="true"><i></i></span></div>`,
    boot: '',
  }[st];
  if(body.dataset.st !== st || o.err || st === 'form'){
    body.dataset.st = st; body.innerHTML = html || '';
    if(body.firstElementChild && st !== 'boot') body.firstElementChild.classList.add('si-swap');
  }
}
function mLoginBusy(id, label){ const b = $m(id); if(!b) return; b.disabled = true; b.innerHTML = `<span class="si-spin" aria-hidden="true"></span>${mEsc(label)}`; }
// kept for older call sites: the form with a message
function mRenderLogin(err){ mLogin('form', { err }); }
async function mSignIn(){
  const email = $m('mlEmail').value.trim(), password = $m('mlPass').value;
  const bad = teamEmailProblem(email);
  if(bad){ mLogin('form', { email, err: bad, bad: 'email' }); return; }
  if(!password){ mLogin('form', { email, err: 'Enter your password.', bad: 'pass' }); return; }
  mLoginBusy('mlBtn', 'Signing In…');
  let error = null;
  try{ ({ error } = await supabaseClient.auth.signInWithPassword({ email, password })); }catch(e){ error = e; }
  if(error){ mLogin('form', { email, err: siAuthMessage(error, 'signin'), bad: 'pass' }); return; }
  mBoot();
}
async function mSendLink(){
  const email = $m('mlResetEmail').value.trim();
  const bad = teamEmailProblem(email);
  if(bad){ mLogin('forgot', { email, err: bad }); return; }
  mLoginBusy('mlResetBtn', 'Sending…');
  let error = null;
  try{ ({ error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/' })); }catch(e){ error = e; }
  if(error){ mLogin('forgot', { email, err: siAuthMessage(error, 'reset') }); return; }
  mLogin('sent', { email });
}
async function mSaveNewPassword(){
  const pw = $m('mlNewPw').value, pw2 = $m('mlNewPw2').value, account = currentUser?.email || '';
  if(pw.length < 8){ mLogin('newpw', { account, err: 'Use at least 8 characters.' }); return; }
  if(pw !== pw2){ mLogin('newpw', { account, err: 'The two passwords don’t match.' }); return; }
  mLoginBusy('mlNewBtn', 'Saving…');
  let error = null;
  try{ ({ error } = await supabaseClient.auth.updateUser({ password: pw })); }catch(e){ error = e; }
  if(error){ mLogin('newpw', { account, err: siAuthMessage(error, 'new') }); return; }
  siSetRecovering(false);
  mBoot({ sub: 'Password saved · Opening your workspace' });
}
async function mLeaveRecovery(){ siSetRecovering(false); try{ await supabaseClient.auth.signOut(); }catch(e){} mLogin('form', { email: '' }); }
// kept for older call sites
function mForgot(){ mLogin('forgot'); }
async function mSignOut(){ try{ localStorage.removeItem('bda_first_name'); }catch(e){} await supabaseClient.auth.signOut(); location.reload(); }

async function mLoadAll(){
  const uid = currentUser.id;
  const q = t => supabaseClient.from(t);
  const [s, cr, ir, dr, tr, rr, nr, er, nf, pr, ev, wg] = await Promise.all([
    safeGet('settings'), q('clients').select('*'), selectAll(() => q('client_improvements').select('*').order('date', { ascending: true }).order('id')), q('client_drafts').select('*'),
    q('tasks').select('*').order('created_at', { ascending: false }), q('client_reminders').select('*').order('follow_up_date', { ascending: true }),
    q('notes').select('*').eq('user_id', uid).is('deleted_at', null).order('updated_at', { ascending: false }),
    selectAll(() => q('time_entries').select('*').is('deleted_at', null).order('entry_date', { ascending: false }).order('id')),
    q('notifications').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(50),
    q('team_profiles').select('*'), q('calendar_events').select('*').order('start_at', { ascending: true }),
    typeof winsGroupsFetch === 'function' ? winsGroupsFetch() : null,
  ]);
  try{ settings = s ? (typeof s === 'string' ? JSON.parse(s) : s) : {}; }catch(e){ settings = {}; }
  settings.serviceOptions = (settings.serviceOptions && settings.serviceOptions.length) ? settings.serviceOptions : ['Google Ads (PPC)', 'Meta Ads', 'SEO / Local Search', 'AI Domination Framework', 'Full Framework'];
  clients = (cr.data || []).map(clientRowFromDb);
  setLoadedWork(ir.data);
  clientDrafts = (dr.data || []).map(draftRowFromDb);
  if(typeof winsAfterLoad === 'function') winsAfterLoad(dr.data, wg);
  clients.forEach(c => { c.improvements = clientImprovements.filter(i => i.clientId === c.id); c.drafts = clientDrafts.filter(d => d.clientId === c.id); });
  tasks = (tr.data || []).map(t => ({ id: t.id, title: t.title, description: t.description || '', priority: t.priority, status: t.status, assignerId: t.assigner_id, assigneeId: t.assignee_id,
    clientId: t.client_id, dueDate: t.due_date, link: t.link, attachments: t.attachments || [], createdAt: t.created_at, completedAt: t.completed_at, cancelledAt: t.cancelled_at,
    hiddenByAssigner: t.hidden_by_assigner, hiddenByAssignee: t.hidden_by_assignee }));
  clientReminders = (rr.data || []).map(r => ({ id: r.id, clientId: r.client_id, question: r.question, askedBy: r.asked_by, askedDate: r.asked_date, followUpDate: r.follow_up_date, status: r.status, waitingOn: r.waiting_on || null }));
  notes = (nr.data || []).map(n => ({ id: n.id, clientId: n.client_id, title: n.title, text: n.text, status: n.status, link: n.link, followUpDate: n.follow_up_date, updatedAt: n.updated_at }));
  try{ await loadTaskSuggestions(); }catch(e){ taskSuggestions = []; }   // tasks from meetings (Granola)
  if(typeof granolaAutoStart === 'function') granolaAutoStart();      // and they come in by themselves
  timeEntries = (er.data || []).map(e => ({ id: e.id, userId: e.user_id, clientId: e.client_id, date: e.entry_date, minutes: e.minutes, description: e.description || '', service: e.service || '', logged: !!e.logged,
    createdAt: e.created_at, harvestProjectId: e.harvest_project_id || null, harvestTaskId: e.harvest_task_id || null, source: e.source || '', harvestLocked: !!e.harvest_locked, improvementId: e.improvement_id || null }));
  // something new since the last look: the chime (Nov 23)
  const unread = (nf.data || []).filter(n => !n.read).map(n => n.id);
  if(mNotifIds && unread.some(id => !mNotifIds.has(id)) && typeof radarChime === 'function') radarChime();
  mNotifIds = new Set(unread);
  notifications = nf.data || [];
  teamProfiles = pr.data || [];
  myProfile = teamProfiles.find(p => p.id === uid) || myProfile;
  calendarEvents = (ev.data || []).map(e => ({ id: e.id, title: e.title, startAt: e.start_at, endAt: e.end_at, allDay: e.all_day, clientId: e.client_id, location: e.location, eventType: e.event_type, attendeeIds: e.attendee_ids || [], createdBy: e.created_by }));
  await Promise.all([loadUpdateHistory(), loadHealthHandled(), loadTaskDueTimes(), typeof hvTimeLoad === 'function' ? hvTimeLoad() : null]);
}

async function mBoot(o){
  o = o || {};
  mLoginShell();   // the logo straight away, while the saved session is read
  const { data: { session } } = await supabaseClient.auth.getSession();
  const linkError = siTakeLinkError();
  if(linkError && /error/.test(location.hash)) history.replaceState(null, '', location.pathname);
  if(!session){
    siSetRecovering(false);
    linkError ? mLogin('forgot', { err: 'That link has expired or was already used. Enter your email for a new one.' }) : mLogin('form');
    return;
  }
  currentUser = session.user;
  if(siRecovering()){ mLogin('newpw', { account: session.user.email || '' }); return; }   // from a reset link: a new password first
  // the opening: a greeting (the name as soon as it's known) and a thin line while everything loads
  const t0 = Date.now();
  let first = ''; try{ first = localStorage.getItem('bda_first_name') || ''; }catch(e){}
  mLogin('opening', { heading: siHello() + (first ? ', ' + first : ''), sub: o.sub });
  supabaseClient.from('team_profiles').select('name').eq('id', currentUser.id).limit(1).then(({ data }) => {
    const n = data && data[0] && String(data[0].name || '').split(' ')[0];
    if(n && $m('msiRoot')?.dataset.st === 'opening') siText($m('msiHead'), siHello() + ', ' + n);
  }, () => {});
  try{ await mLoadAll(); }catch(e){ console.error(e); }
  if(!myProfile){ mLogin('form', { err: 'This account isn’t on the team yet. Ask an admin to add you.' }); return; }
  try{ localStorage.setItem('bda_first_name', String(myProfile.name || '').split(' ')[0]); }catch(e){}
  if($m('msiRoot')) siText($m('msiHead'), siHello() + ', ' + String(myProfile.name || '').split(' ')[0]);
  // let the greeting land, then fade the sign-in out and the app in
  const wait = 520 - (Date.now() - t0); if(wait > 0) await new Promise(r => setTimeout(r, wait));
  if($m('msiRoot')){ $m('msiRoot').classList.add('is-out'); await new Promise(r => setTimeout(r, 200)); }
  mApplyTheme();
  try{ const raw = localStorage.getItem('bda_timer_state'); if(raw) timerState = JSON.parse(raw); }catch(e){}
  document.title = settings.appName || 'Based Radar';
  mRenderShell();
  const stg = $m('mStage'); if(stg){ stg.classList.add('m-in'); stg.addEventListener('animationend', () => stg.classList.remove('m-in'), { once: true }); }
  mSwitchTab(mTabFromHash() || 'today');
  if(location.hash) mOpenFromHash(location.hash);
  window.addEventListener('hashchange', () => mOpenFromHash(location.hash));
  document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible') mRefresh(); });
  // while it's open: a quick look for new notifications each minute, so they show (and chime) (Nov 23)
  setInterval(async () => {
    if(document.visibilityState !== 'visible' || !currentUser) return;
    const { data } = await supabaseClient.from('notifications').select('id').eq('user_id', currentUser.id).eq('read', false).order('created_at', { ascending: false }).limit(30);
    if(data && mNotifIds && data.some(n => !mNotifIds.has(n.id))) mRefresh();
  }, 60000);
  if(navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', e => { if(e.data && e.data.type === 'open-url') mOpenFromHash(new URL(e.data.url, location.origin).hash); });
}
async function mRefresh(){ try{ await mLoadAll(); }catch(e){ return; } mRenderTab(); mRenderBadges(); mStack.forEach(s => s.refresh && s.refresh()); }
function mApplyTheme(){ applyTheme(false); }
// the status bar follows the appearance, also when Night to Morning changes it on its own
function onThemeApplied(t){ document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#000000' : '#F2F2F7'); }

// ---- the shell: tabs, + menu, pushed screens, sheets ----------------------------------------
const M_TABS = [['today', 'Today', 'house'], ['tasks', 'Tasks', 'check-square'], ['plus'], ['review', 'Review', 'tray'], ['more', 'More', 'dots-three-circle']];
function mRenderShell(){
  $m('mApp').className = 'phone app';
  $m('mApp').innerHTML = `<div class="stage" id="mStage"><div class="iscroll" id="mMain"></div>
<div class="iscrim menu-scrim" id="mMenuScrim" hidden onclick="mToggleAdd(false)"></div>
<div class="imenu" id="mAddMenu" role="menu" aria-label="Add">
<button role="menuitem" onclick="mToggleAdd(false);mOpenLog()">Log Improvement${icon('pencil-simple-line')}</button>
<button role="menuitem" onclick="mToggleAdd(false);mOpenTaskSheet()">New Task${icon('check-square')}</button>
<button role="menuitem" onclick="mToggleAdd(false);mOpenReminderSheet()">New Reminder${icon('bell-ring')}</button>
<button role="menuitem" onclick="mToggleAdd(false);mOpenNoteSheet()">New Note${icon('notepad')}</button>
<button role="menuitem" onclick="mToggleAdd(false);mOpenEventSheet()">New Event${icon('calendar-plus')}</button>
<div class="gap"></div><button role="menuitem" id="mAddTimer" onclick="mToggleAdd(false);timerState.running ? mStopTimer() : mOpenTimerSheet()">Start Timer${icon('timer')}</button>
<button role="menuitem" onclick="mToggleAdd(false);mOpenTimeSheet()">Add Time Worked${icon('clock')}</button></div>
<nav class="tabbar" id="mTabbar" aria-label="Tabs"></nav>
<div id="mPushes"></div></div>
<div class="iscrim" id="mSheetScrim" hidden onclick="mCloseSheet()"></div>
<div class="isheet" id="mSheet" role="dialog" hidden></div>`;
  mRenderTabbar();
  mWirePull();
}
// Pull down at the top of a tab to reload, as in Mail.
function mWirePull(){
  const sc = $m('mMain'); if(!sc || sc.dataset.pull) return; sc.dataset.pull = '1';
  const ind = document.createElement('div'); ind.className = 'ipull'; ind.setAttribute('aria-hidden', 'true'); sc.parentNode.insertBefore(ind, sc.nextSibling);
  let y0 = null, dy = 0, busy = false;
  sc.addEventListener('touchstart', e => { if(sc.scrollTop <= 0 && !busy){ y0 = e.touches[0].clientY; dy = 0; } }, { passive: true });
  sc.addEventListener('touchmove', e => {
    if(y0 == null) return; dy = e.touches[0].clientY - y0;
    if(dy <= 0 || sc.scrollTop > 0){ ind.style.height = '0'; return; }
    const h = Math.min(70, dy * .5); ind.style.height = h + 'px'; ind.textContent = h >= 60 ? 'Release to update' : 'Pull to update';
  }, { passive: true });
  sc.addEventListener('touchend', async () => {
    if(y0 == null) return; y0 = null;
    if(dy * .5 >= 60 && !busy){ busy = true; ind.textContent = 'Updating…'; ind.style.height = '40px'; await mRefresh(); busy = false; }
    ind.style.height = '0';
  });
}
function mRenderTabbar(){
  const nav = $m('mTabbar'); if(!nav) return;
  const badge = { review: mReviewItems(true).waiting.length };
  nav.innerHTML = M_TABS.map(([k, t, ic]) => k === 'plus'
    ? `<button aria-label="Add" aria-expanded="false" id="mPlusBtn" onclick="mToggleAdd()"><span class="plus" id="mPlus">${icon('plus', { weight: 'bold' })}</span></button>`
    : `<button class="${mTab === k ? 'on' : ''}" onclick="mSwitchTab('${k}')"${mTab === k ? ' aria-current="page"' : ''}>${icon(ic)}${t}${badge[k] ? `<span class="bdg">${badge[k]}</span>` : ''}</button>`).join('');
}
function mRenderBadges(){ mRenderTabbar(); }
function mTabFromHash(){ const h = location.hash.replace('#', ''); return ['today', 'tasks', 'review', 'more'].includes(h) ? h : null; }
function mSwitchTab(t){
  if(mStack.length) mPopAll();
  const changed = mTab !== t;
  mTab = t;
  mRenderTabbar();
  mRenderTab();
  $m('mMain').scrollTop = 0;
  if(changed) enterIn($m('mMain'), 'translateY(4px)');
  if(location.hash !== '#' + t) history.replaceState(null, '', '#' + t);
}
function mRenderTab(){
  const main = $m('mMain'); if(!main) return;
  const keep = main.scrollTop;
  main.innerHTML = ({ today: mTodayHtml, tasks: mTasksHtml, review: mReviewHtml, more: mMoreHtml }[mTab] || mTodayHtml)();
  main.scrollTop = keep;
  mTickTimer();
}
function mToggleAdd(open){
  const menu = $m('mAddMenu'), scrim = $m('mMenuScrim'), plus = $m('mPlus');
  const on = open == null ? !menu.classList.contains('in') : open;
  menu.classList.toggle('in', on); scrim.hidden = !on; requestAnimationFrame(() => scrim.classList.toggle('in', on));
  plus?.classList.toggle('open', on); $m('mPlusBtn')?.setAttribute('aria-expanded', on);
  const tb = $m('mAddTimer'); if(tb) tb.innerHTML = (timerState.running ? 'Stop Timer' : 'Start Timer') + icon('timer');
}

// Pushed screens slide in from the right with a back button, like a navigation stack.
function mPush(title, bodyFn, opts){
  opts = opts || {};
  const host = $m('mPushes');
  const el = document.createElement('section');
  el.className = 'ipush';
  const back = mStack.length ? mStack[mStack.length - 1].title : ({ today: 'Today', tasks: 'Tasks', review: 'Review', more: 'More' }[mTab]);
  const liftBar = () => { el.querySelector(':scope > .ibar')?.remove(); const bar = el.querySelector('.ipbody .ibar'); el.querySelector('.iscroll').classList.toggle('has-bar', !!bar); if(bar) el.appendChild(bar); };
  const entry = { el, title, refresh: () => { const sc = el.querySelector('.iscroll'); const k = sc ? sc.scrollTop : 0; el.querySelector('.ipbody').innerHTML = bodyFn(); liftBar(); if(sc) sc.scrollTop = k; } };
  el.innerHTML = `<div class="iscroll"><div class="inav"><button class="back" onclick="mPop()">${icon('caret-left', { weight: 'bold' })}${mEsc(back)}</button>${opts.navTitle ? `<span class="ttl">${mEsc(title)}</span>` : ''}<div class="r">${opts.right || ''}</div></div><div class="ipbody">${bodyFn()}</div></div>`;
  liftBar();
  host.appendChild(el);
  if(mStack.length) mStack[mStack.length - 1].el.classList.add('under');
  mStack.push(entry);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  mEdgeSwipe(el);
  return entry;
}
function mPop(){
  const e = mStack.pop(); if(!e) return;
  e.el.classList.remove('in');
  if(mStack.length) mStack[mStack.length - 1].el.classList.remove('under');
  setTimeout(() => e.el.remove(), 400);
  if(!mStack.length) mRenderTab(); else mStack[mStack.length - 1].refresh();
}
function mPopAll(){ while(mStack.length){ const e = mStack.pop(); e.el.remove(); } }
function mTop(){ return mStack[mStack.length - 1]; }
// Swipe from the left edge to go back.
function mEdgeSwipe(el){
  let x0 = null, y0 = 0, dx = 0;
  el.addEventListener('touchstart', e => { const t = e.touches[0]; if(t.clientX < 24){ x0 = t.clientX; y0 = t.clientY; dx = 0; el.style.transition = 'none'; } }, { passive: true });
  el.addEventListener('touchmove', e => { if(x0 == null) return; const t = e.touches[0]; dx = Math.max(0, t.clientX - x0); if(Math.abs(t.clientY - y0) > 40 && dx < 20){ x0 = null; el.style.transform = ''; el.style.transition = ''; return; } el.style.transform = `translateX(${dx}px)`; }, { passive: true });
  el.addEventListener('touchend', () => { if(x0 == null) return; el.style.transition = ''; el.style.transform = ''; if(dx > innerWidth * .33) mPop(); x0 = null; });
}

// Sheets rise from the bottom; the screen behind shrinks back.
let mSheetDirty = false;
let mSheetGen = 0;   // a sheet opened again before the last close finished keeps its content
function mOpenSheet(title, bodyHtml, opts){
  opts = opts || {};
  mSheetGen++;
  const sh = $m('mSheet'), scrim = $m('mSheetScrim');
  sh.innerHTML = `<div class="grab" aria-hidden="true"></div>
<div class="inav"><button class="l" onclick="mCloseSheet()">${opts.cancel || 'Cancel'}</button><span class="ttl2">${mEsc(title)}</span><div class="r">${opts.done ? `<button id="mSheetDone" onclick="${opts.done}"><b>${opts.doneLabel || 'Done'}</b></button>` : ''}</div></div>
<div class="sheet-scroll">${bodyHtml}</div>`;
  sh.setAttribute('aria-label', title);
  sh.hidden = false; scrim.hidden = false; mSheetDirty = false;
  $m('mApp').classList.add('sheeted');
  requestAnimationFrame(() => requestAnimationFrame(() => { sh.classList.add('in'); scrim.classList.add('in'); }));
  sh.oninput = () => { mSheetDirty = true; };
}
function mCloseSheet(force){
  const sh = $m('mSheet'), scrim = $m('mSheetScrim');
  if(!sh || sh.hidden) return;
  sh.classList.remove('in'); scrim.classList.remove('in');
  $m('mApp').classList.remove('sheeted');
  const gen = mSheetGen;
  setTimeout(() => { if(gen !== mSheetGen) return; sh.hidden = true; scrim.hidden = true; sh.innerHTML = ''; }, 380);
}
// A list to pick from, as its own sheet (clients, services, dates, people).
let mPickCb = null;
function mPick(title, options, cur, cb){
  mPickCb = cb;
  const prev = $m('mSheet').hidden ? null : { html: $m('mSheet').innerHTML, label: $m('mSheet').getAttribute('aria-label') };
  mPick._prev = prev;
  const rows = options.map(([v, t, s]) => `<button class="ir" onclick="mPicked(${jsArg(v)})"><div class="tx"><span class="t n">${mEsc(t)}</span>${s ? `<span class="s">${mEsc(s)}</span>` : ''}</div><div class="r">${String(v) === String(cur) ? `<span class="pk">${icon('check', { weight: 'bold' })}</span>` : ''}</div></button>`).join('');
  const sh = $m('mSheet');
  mSheetGen++;
  sh.innerHTML = `<div class="grab" aria-hidden="true"></div><div class="inav"><button class="l" onclick="mPicked(null, true)">Back</button><span class="ttl2">${mEsc(title)}</span></div>
${options.length > 8 ? `<div class="isearch">${icon('magnifying-glass')}<input placeholder="Search" oninput="mPickFilter(this.value)" aria-label="Search"></div>` : ''}
<div class="sheet-scroll"><div class="ig flat ilist-pick" style="margin-top:12px" id="mPickList">${rows}</div></div>`;
  if(prev) return;
  sh.hidden = false; $m('mSheetScrim').hidden = false; $m('mApp').classList.add('sheeted');
  requestAnimationFrame(() => requestAnimationFrame(() => { sh.classList.add('in'); $m('mSheetScrim').classList.add('in'); }));
}
// An action sheet: a few choices about one thing, with Cancel apart, rising from the bottom.
let mActCbs = [];
function mActions(title, items){
  mActCbs = items.map(x => x.fn);
  let el = $m('mAct');
  if(!el){ el = document.createElement('div'); el.id = 'mAct'; el.className = 'iact'; document.body.appendChild(el); }
  el.innerHTML = `<div class="iact-scrim" onclick="mActDone(-1)"></div><div class="iact-panel" role="dialog" aria-label="${mEsc(title)}">
<div class="iact-group">${title ? `<div class="iact-title">${mEsc(title)}</div>` : ''}${items.map((x, k) => `<button class="${x.danger ? 'danger' : ''}" onclick="mActDone(${k})">${mEsc(x.label)}</button>`).join('')}</div>
<button class="iact-cancel" onclick="mActDone(-1)">Cancel</button></div>`;
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
}
function mActDone(k){
  const el = $m('mAct'); if(!el) return;
  el.classList.remove('in');
  const fn = mActCbs[k]; mActCbs = [];
  setTimeout(() => { if(!el.classList.contains('in')) el.innerHTML = ''; }, 320);
  if(fn) fn();
}
function mPickFilter(q){ q = q.toLowerCase(); document.querySelectorAll('#mPickList .ir').forEach(r => { r.hidden = !r.textContent.toLowerCase().includes(q); }); }
function mPicked(v, cancel){
  const prev = mPick._prev, cb = mPickCb; mPickCb = null;
  if(prev){ $m('mSheet').innerHTML = prev.html; mRestoreSheetState(); if(!cancel && cb) cb(v); }
  else { mCloseSheet(); if(!cancel && cb) setTimeout(() => cb(v), 50); }
}
// Inputs keep their values when the sheet's HTML comes back after a picker.
const mSheetState = {};
function mKeep(id, v){ mSheetState[id] = v; }
function mRestoreSheetState(){ Object.entries(mSheetState).forEach(([id, v]) => { const el = $m(id); if(el && 'value' in el) el.value = v; }); }
function mSheetVal(id){ const el = $m(id); return el ? el.value : ''; }

// ---- Today -----------------------------------------------------------------------------------
function mWaitingDrafts(){
  const me = myName(), approver = canApprove(), out = [];
  attentionEligibleClients().forEach(c => (c.drafts || []).forEach(d => {
    if(d.draftStatus !== 'pending' || !d.draft) return;
    if(approver ? (d.author === me || (d.readyToNotify && !draftHasNoWork(c, d))) : d.author === me) out.push({ c, d });
  }));
  return out.sort((a, b) => new Date(b.d.draftPendingSince || 0) - new Date(a.d.draftPendingSince || 0));
}
function mMine(c){ return canApprove() || clientOwner(c) === myName(); }
function mTodayHtml(){
  const list = attentionEligibleClients(), sum = weekSummary(list);
  const behind = sum.ws.filter(w => mMine(w.c) && needsUpdate(w)).sort(dueOrder);
  const lateN = behind.filter(w => w.late).length;
  const health = list.filter(mMine).map(c => ({ c, h: clientHealth(c) })).filter(x => x.h.level !== 'g').sort((a, b) => (a.h.level === 'r' ? 0 : 1) - (b.h.level === 'r' ? 0 : 1));
  const waiting = mWaitingDrafts();
  const me = myProfile || {}, unread = notifications.filter(n => !n.read).length;
  const sub = sum.total ? `${sum.sent} of ${sum.total} sent this week${lateN ? ` · ${lateN} overdue` : ''}` : 'No clients yet';
  const behindRows = behind.slice(0, 3).map(w => mIr(monoHtml(w.c), mEsc(w.c.name) + focusMark(w.c), dueTag(w) + stageTag(w), w.holder && w.holder !== 'approvers' ? avHtml(w.holder) : stepsHtml(w), mBehindTap(w), { tags: true })).join('');
  const healthRows = health.slice(0, 2).map(({ c, h }) => mIr(monoHtml(c), mEsc(c.name) + focusMark(c), signalChips(h, 1), healthTag(h.level), `mOpenClient('${c.id}')`, { tags: true })).join('');
  const waitRows = waiting.slice(0, 2).map(({ c, d }) => mIr(monoHtml(c), mEsc(c.name) + focusMark(c), nextDueTag(clientWeek(c)) + tagHtml('blue', fmtWait(d.draftPendingSince || rNow()), 'clock'), avHtml(d.author), `mOpenDraft('${c.id}',${jsArg(d.author)})`, { tags: true })).join('');
  const todayStr = toDateStr(new Date());
  const due = tasks.filter(t => t.assigneeId === currentUser.id && t.status !== 'done' && !t.cancelledAt && t.dueDate && t.dueDate <= todayStr).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return `<div class="ihead"><button onclick="mOpenProfile()" aria-label="My profile">${avHtml(me.name || '?')}</button><div class="r"><button aria-label="Search" onclick="mOpenSearch()">${icon('magnifying-glass')}</button><button aria-label="Notifications${unread ? ', ' + unread + ' new' : ''}" onclick="mOpenNotifications()">${icon('bell')}${unread ? `<span class="bd is-${notifTopSeverity(notifications)}"></span>` : ''}</button></div></div>
<h1 class="big">Today</h1><p class="big-sub">${mEsc(sub)}</p>
${mGlanceHtml(behind, waiting, health)}
${mTimerCardHtml()}
${behind.length ? mIsh(lateN ? `${behind.length} due or overdue` : `${behind.length} due today`, "mOpenWeek()") + `<div class="ig">${behindRows}</div>` : ''}
${health.length ? mIsh('Health', "mOpenClients('health')") + `<div class="ig">${healthRows}</div>` : ''}
${waiting.length ? mIsh(`${waiting.length} waiting for ${canApprove() ? 'review' : 'you'}`, "mSwitchTab('review')") + `<div class="ig">${waitRows}</div>` : ''}
${due.length ? mIsh('Due today', "mSwitchTab('tasks')") + `<div class="ig">${due.slice(0, 5).map(mTaskRow).join('')}</div>` : ''}
${!behind.length && !health.length && !waiting.length && !due.length ? `<div style="margin-top:22px">${mEmpty('You’re all caught up', mNextDue(sum.ws.filter(w => mMine(w.c))))}</div>` : ''}`;
}
// Three numbers to read at a glance; each opens the list behind it.
function mGlanceHtml(behind, waiting, health){
  const lateN = behind.filter(w => w.late).length, dueN = behind.length - lateN, riskN = health.filter(x => x.h.level === 'r').length;
  const tile = (n, label, ic, cls, tap) => `<button class="ikpi${n ? ' ' + cls : ''}" onclick="${tap}"><span class="k-ic">${icon(ic, { weight: 'bold' })}</span><b>${n}</b><span>${label}</span></button>`;
  return `<div class="ikpis">${tile(lateN, 'Overdue', 'clock', 'red', 'mOpenWeek()')}${tile(dueN, 'Due today', 'clock', 'yellow', 'mOpenWeek()')}${canApprove() ? tile(waiting.length, 'To review', 'tray', 'blue', "mSwitchTab('review')") : tile(riskN, 'At risk', 'heart-pulse', 'red', "mOpenClients('health')")}</div>`;
}
// "Next up: Oakridge Flooring, due tomorrow."
function mNextDue(ws){ const n = ws.filter(w => w.sent).sort((a, b) => a.daysLeft - b.daysLeft)[0]; return n ? `Next up: ${mEsc(n.c.name)}, ${n.dueText.toLowerCase()}.` : ''; }
// Every client's update this week: overdue, due today, due soon, sent.
function mOpenWeek(){
  mPush('This Week', () => {
    const ws = attentionEligibleClients().filter(mMine).map(c => weekView(clientWeek(c)));
    const groups = [['Overdue', ws.filter(w => w.state === 'late').sort(dueOrder), 't-red'], ['Due today', ws.filter(w => w.state === 'due').sort(dueOrder)],
      ['Due soon', ws.filter(w => w.upcoming).sort((a, b) => a.daysLeft - b.daysLeft)], ['Sent this week', ws.filter(w => w.sent).sort((a, b) => new Date(b.last) - new Date(a.last))]];
    const sent = ws.filter(w => w.sent || w.upcoming).length;
    return `<h1 class="big">This Week</h1><p class="big-sub">${sent} of ${ws.length} sent in the last 7 days</p>
${groups.filter(g => g[1].length).map(([t, list, cls]) => mIsh(t, null, cls) + `<div class="ig">${list.map(w => mIr(monoHtml(w.c), mEsc(w.c.name) + focusMark(w.c), (w.late ? `<span class="t-red">${mEsc(overdueShort(w))}</span> · ` : '') + mEsc(w.note || ''), stepsHtml(w), w.sent && !w.upcoming ? `mOpenClient('${w.c.id}')` : mBehindTap(w))).join('')}</div>`).join('')}`;
  });
}
// A due client opens its draft when one is waiting, otherwise the client.
function mBehindTap(w){
  const d = (w.c.drafts || []).find(x => x.draftStatus === 'pending' && x.draft && (canApprove() || x.author === myName()) && !draftHasNoWork(w.c, x));
  return d ? `mOpenDraft('${w.c.id}',${jsArg(d.author)})` : `mOpenClient('${w.c.id}')`;
}
// Health in a phone-sized phrase: "Over budget, updates late".
function mSignal(h){
  if(!h.signals.length) return '';
  if(h.signals.length === 1) return shortSignal(h, 1);
  const order = ['hours', 'late', 'noupdate', 'quiet', 'under', 'tasks', 'flag'];
  const bits = [...new Set(h.signals.slice().sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)).map(s => ({
    hours: h.hp && h.hp.used > h.hp.budget ? 'over budget' : 'going over budget', late: 'updates late', noupdate: 'updates late',
    quiet: s.text.replace(/\.$/, '').toLowerCase(), under: 'hours under-used', tasks: s.title.toLowerCase(), flag: s.title.toLowerCase() }[s.key])))].slice(0, 2).join(', ');
  return bits.charAt(0).toUpperCase() + bits.slice(1);
}
function mTimerCardHtml(){
  if(!timerState.running) return '';
  const c = clients.find(x => x.id === timerState.clientId);
  return `<div class="itimer"><span class="dot red"></span><div class="tx"><b>${mEsc(timerState.description || 'Timer running')}</b><span>${mEsc(c ? c.name : '')}</span></div><span class="clk" id="mClk">${mClock()}</span><button class="istop" onclick="mStopTimer()">Stop</button></div>`;
}
function mClock(){ const s = Math.floor((Date.now() - timerState.startedAt) / 1000); return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
function mTickTimer(){
  clearInterval(mTimerTick);
  if(timerState.running) mTimerTick = setInterval(() => document.querySelectorAll('#mClk, .mClk').forEach(el => { el.textContent = mClock(); }), 1000);
}

// ---- Tasks -----------------------------------------------------------------------------------
function mSetTaskScope(s){ mTaskScope = s; mRenderTab(); }
function mTaskDue(t){
  if(!t.dueDate) return '';
  const today = toDateStr(new Date()), d = new Date(t.dueDate + 'T12:00:00'), hh = taskDueTimes[t.id];
  const tm = hh ? fmtTime(atTime(d, hh)) : '';
  if(t.status !== 'done' && t.dueDate < today) return `<span class="t-red">${t.dueDate === toDateStr(addDays(new Date(), -1)) ? 'Yesterday' : fmtShortDate(d)}</span>`;
  if(t.dueDate === today) return tm || 'Today';
  const k = daysBetween(dayStart(new Date()), d);
  return k === 1 ? 'Tomorrow' : k < 7 ? fmtDay(d) : fmtShortDate(d);
}
function mTaskRow(t){
  const c = clients.find(x => x.id === t.clientId), who = teamProfiles.find(p => p.id === t.assigneeId);
  const sub = [c ? mEsc(shortClientName(c.name)) : '', mTaskDue(t)].filter(Boolean).join(' · ');
  const right = (t.priority === 'high' && t.status !== 'done' ? `<span style="display:inline-flex;width:16px;height:16px;color:var(--label-2)">${icon('flag', { label: 'High priority' })}</span>` : '') + (who ? avHtml(who.name) : '');
  return mIr(mCb(t), mEsc(t.title), sub, right, `mOpenTask('${t.id}')`, { n: true, noChev: true, div: true, cls: t.status === 'done' ? 'done' : '' });
}
function mVisibleTasks(){
  const me = currentUser.id;
  return tasks.filter(t => !t.cancelledAt && (t.assignerId === me || t.assigneeId === me) && !(t.status === 'done' && ((t.assignerId === me && t.hiddenByAssigner) || (t.assigneeId === me && t.hiddenByAssignee))));
}
function mTasksHtml(){
  const me = currentUser.id, today = toDateStr(new Date());
  let vis = tasks.filter(t => !t.cancelledAt && t.status !== 'done');
  const mineN = vis.filter(t => t.assigneeId === me).length;
  if(mTaskScope === 'mine') vis = vis.filter(t => t.assigneeId === me);
  if(mTaskScope === 'byme') vis = vis.filter(t => t.assignerId === me && t.assigneeId !== me);
  if(mTaskClient !== 'all') vis = vis.filter(t => t.clientId === mTaskClient);
  const order = (a, b) => focusIdFirst(a.clientId, b.clientId) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || ((taskDueTimes[a.id] || '99') < (taskDueTimes[b.id] || '99') ? -1 : 1);
  const weekEnd = toDateStr(addDays(new Date(), 6));
  const groups = [['Overdue', vis.filter(t => t.dueDate && t.dueDate < today), 't-red'], ['Today', vis.filter(t => t.dueDate === today)], ['This week', vis.filter(t => t.dueDate && t.dueDate > today && t.dueDate <= weekEnd)],
    ['Later', vis.filter(t => t.dueDate && t.dueDate > weekEnd)], ['No date', vis.filter(t => !t.dueDate)]];
  const overdue = groups[0][1].length;
  const c = mTaskClient !== 'all' ? clients.find(x => x.id === mTaskClient) : null;
  const sg = mSuggestHtml();
  const body = sg + groups.filter(g => g[1].length).map(([g, ts, cls]) => `<div class="ish"><h2${cls ? ` class="${cls}"` : ''}>${g}</h2></div><div class="ig">${ts.sort(order).map(mTaskRow).join('')}</div>`).join('')
    || `<div style="margin-top:22px">${mEmpty(mTaskScope === 'mine' ? 'Nothing on your list' : 'No open tasks', 'Tap + to add one.')}</div>`;
  granolaWatch(() => { if(mTab === 'tasks') mRenderTab(); });
  const gr = granolaOn ? `<button aria-label="Check Granola for new tasks" title="Check Granola" class="mgr${mGranolaBusy ? ' is-busy' : ''}" onclick="mGranolaCheck()"${mGranolaBusy ? ' disabled' : ''}>${appLogo('granola', 'sm')}</button>` : '';
  return `<div class="inav"><div class="r">${gr}<button aria-label="Filter by client" onclick="mPickTaskClient()" style="${c ? 'color:var(--label)' : ''}">${icon('funnel-simple')}</button></div></div>
<h1 class="big">Tasks</h1><p class="big-sub">${vis.length} open${overdue ? ` · ${overdue} overdue` : ''}${c ? ` · ${mEsc(c.name)}` : ''}</p>
${mSeg([['everyone', 'Everyone'], ['mine', 'Mine', mineN], ['byme', 'Assigned by me']], 'mSetTaskScope', mTaskScope)}
${body}
${mVisibleTasks().some(t => t.status === 'done') ? `<p class="ifoot" style="margin-top:16px"><button onclick="mOpenDoneTasks()" style="color:var(--label-2)">Show finished tasks</button></p>` : ''}`;
}
// Check Granola: the notepad in the Tasks bar reads new meetings now (shared with the desktop).
let mGranolaBusy = false;
async function mGranolaCheck(){
  if(mGranolaBusy) return;
  mGranolaBusy = true; mRenderTab();
  let r; try{ r = await checkGranolaNow(); } finally { mGranolaBusy = false; }
  showToast(r.type, r.title, r.text);
  mRenderTab();
}
// Tasks suggested from meetings (Nov 23, Granola): Add makes it your task; tapping it opens New Task
// filled in (adding it from there); × dismisses it, with Undo. Shared logic in sheets-canvas.js.
let mSgAll = false;
// Tapping a suggestion shows what it's about first (Nov 23); Add, Edit or Dismiss from there.
function mSgPreview(id){
  const s = (taskSuggestions || []).find(x => x.id === id); if(!s) return;
  const body = () => `<div class="sgp msgp"><h3 class="sgp-h">${mEsc(s.title)}</h3>${suggestionPreviewHtml(s)}
<div class="msgp-a"><button class="ibtn msgp-add" onclick="mCloseSheet(true);mSgAdd('${s.id}')">Add to My Tasks</button>
<div class="msgp-2"><button class="ibtn s" onclick="mCloseSheet(true);setTimeout(() => mSgEdit('${s.id}'), 320)">Edit</button><button class="ibtn s msgp-x" onclick="mCloseSheet(true);mSgDismiss('${s.id}')">Dismiss</button></div></div></div>`;
  mOpenSheet('Suggested Task', body(), { cancel: 'Close' });
  if(granolaMeetings === null && s.sourceId) loadGranolaMeetings().then(() => { const sh = $m('mSheet'); const sc = sh && sh.querySelector('.sheet-scroll'); if(sc && !sh.hidden) sc.innerHTML = body(); });
}
function mSuggestHtml(){
  if(typeof taskSuggestions === 'undefined' || !taskSuggestions || mTaskScope === 'byme') return '';
  const list = suggestionsOpen(taskSuggestions).filter(s => mTaskClient === 'all' || s.clientId === mTaskClient);
  if(!list.length) return '';
  const row = s => `<div class="ir msug" data-sg="${s.id}"><button class="tx" onclick="mSgPreview('${s.id}')"><span class="t n">${mEsc(s.title)}</span><span class="s">${mEsc(suggestionSub(s).join(' · '))}</span></button>`
    + `<button class="msg-add" onclick="mSgAdd('${s.id}')">Add</button><button class="msg-x" aria-label="Dismiss ${mEsc(s.title)}" onclick="mSgDismiss('${s.id}')">${icon('x', { weight: 'bold' })}</button></div>`;
  return `<div class="ish"><h2 class="ish-lg">${appLogo('granola', 'xs')}From Your Granola Meetings</h2>${list.length > 4 ? `<button onclick="mSgAll=!mSgAll;mRenderTab()">${mSgAll ? 'Fewer' : 'See All'}</button>` : ''}</div>
<div class="ig msg-list">${(mSgAll ? list : list.slice(0, 4)).map(row).join('')}</div><p class="ifoot">Found in your Granola notes. Add the ones that are yours to do.</p>`;
}
function mSgOut(id, then){
  const row = document.querySelector(`.msug[data-sg="${id}"]`);
  if(!row || matchMedia('(prefers-reduced-motion: reduce)').matches){ then(); return; }
  row.style.height = row.offsetHeight + 'px'; row.offsetHeight; row.classList.add('is-out'); row.style.height = '0px';
  setTimeout(then, 230);
}
async function mSgAdd(id){
  document.querySelectorAll(`.msug[data-sg="${id}"] button`).forEach(b => { b.disabled = true; });
  const r = await addSuggestedTask(id);
  if(r.error){ document.querySelectorAll(`.msug[data-sg="${id}"] button`).forEach(b => { b.disabled = false; }); showToast('error', 'Not added', r.error.message || ''); return; }
  mSgOut(id, () => mRefresh());
  showToast('success', 'Added to your tasks', r.task.title);
}
function mSgEdit(id){
  const s = (taskSuggestions || []).find(x => x.id === id); if(!s) return;
  const p = suggestionPreset(s);
  mOpenTaskSheet({ title: p.title, description: p.description, clientId: p.clientId, due: p.due, priority: p.priority, link: p.link, afterSave: p.afterCreate });
}
async function mSgDismiss(id){
  const s = (taskSuggestions || []).find(x => x.id === id); if(!s) return;
  if(!(await decideSuggestion(id, 'dismissed'))){ showToast('error', 'Not dismissed', 'Try again in a moment.'); return; }
  mSgOut(id, () => mRenderTab());
  showToast('info', 'Dismissed', s.title, { action: 'Undo', onAction: async () => {
    if(await decideSuggestion(id, 'pending')){ taskSuggestions = [s, ...(taskSuggestions || []).filter(x => x.id !== id)].sort((a, b) => new Date(b.sourceAt || 0) - new Date(a.sourceAt || 0)); mRenderTab(); }
  } });
}
function mPickTaskClient(){
  const used = [...new Set(tasks.map(t => t.clientId).filter(Boolean))].map(id => clients.find(c => c.id === id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  mPick('Client', [['all', 'All clients'], ...used.map(c => [c.id, c.name])], mTaskClient, v => { mTaskClient = v; mRenderTab(); });
}
function mOpenDoneTasks(){
  mPush('Finished', () => {
    const done = mVisibleTasks().filter(t => t.status === 'done').sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0)).slice(0, 60);
    return `<h1 class="big">Finished</h1><div class="ig" style="margin-top:16px">${done.map(mTaskRow).join('') || '<div class="ir"><span class="t n">Nothing finished yet</span></div>'}</div>`;
  });
}
async function mCompleteTask(id){
  const t = tasks.find(x => x.id === id); if(!t) return;
  t.status = 'done'; t.completedAt = new Date().toISOString(); mRenderTab(); mTop()?.refresh();
  const { error } = await supabaseClient.from('tasks').update({ status: 'done', completed_at: t.completedAt }).eq('id', id);
  if(error){ showToast('error', 'Couldn’t mark it done', error.message); await mRefresh(); return; }
  if(t.assignerId && t.assignerId !== currentUser.id) mNotify(t.assignerId, 'task_completed', 'A task you assigned is done', `${myName()}: "${t.title}"`, 'tasks');
  // the same as on the computer: a client's task goes into its history, and its WhatsApp item is done too
  if(t.clientId && typeof insertImprovementRow === 'function') await insertImprovementRow(t.clientId, { author: myName() || 'Team member', text: t.description ? `${t.title} — ${t.description}` : t.title, includeInEmail: false, source: 'task' });
  const wa = typeof syncWaItemsForTask === 'function' ? await syncWaItemsForTask(id, 'done') : 0;
  showToast('success', 'Done', wa ? `${t.title} · its WhatsApp item too` : t.title);
}
function mOpenTask(id){
  const t0 = tasks.find(x => x.id === id); if(!t0) return;
  mPush(t0.title, () => {
    const t = tasks.find(x => x.id === id) || t0;
    const c = clients.find(x => x.id === t.clientId), from = teamProfiles.find(p => p.id === t.assignerId), to = teamProfiles.find(p => p.id === t.assigneeId);
    const stage = { todo: 'To Do', in_progress: 'In Progress', in_review: 'Review', done: 'Done' }[t.status] || 'To Do';
    const mine = t.assigneeId === currentUser.id;
    return `<div class="idetail"><div style="margin-top:4px">${mDot(t.status === 'done' ? 'green' : t.status === 'in_review' ? 'purple' : t.status === 'in_progress' ? 'blue' : 'hollow', stage)}</div>
<h1 style="font-size:24px;font-weight:700;letter-spacing:-.02em;margin:8px 0 0">${mEsc(t.title)}</h1></div>
${t.description ? `<div class="inote">${mEsc(t.description)}</div>` : ''}
<div class="ig" style="margin-top:20px">
${mIr('', 'From', '', from ? mEsc(from.name) : '—', null, { n: true })}
${mIr('', 'Assigned to', '', to ? mEsc(to.name) : '—', null, { n: true })}
${t.dueDate ? mIr('', 'Due', '', mTaskDue(t), null, { n: true }) : ''}
${c ? mIr('', 'Client', '', mEsc(c.name), `mOpenClient('${c.id}')`, { n: true }) : ''}
${t.link ? mIr('', 'Link', '', mEsc(truncateLinkDisplay(t.link, 26)), `window.open(${jsArg(normalizeUrl(t.link))},'_blank')`, { n: true }) : ''}
</div>
${mTaskFilesHtml(t)}
${taskCanAskDate(t) ? `<p class="ifoot">Only ${mEsc(firstName(from.name))} can change the date.</p>` : ''}
${t.status !== 'done' && mine ? `<div style="margin:24px 16px 0;display:flex;flex-direction:column;gap:10px">
${t.status !== 'in_progress' ? `<button class="ibtn s" onclick="mMoveTask('${t.id}','in_progress')">Start Working on It</button>` : ''}
${taskCanAskDate(t) ? `<button class="ibtn s" onclick="mAskTaskDate('${t.id}')">Ask ${mEsc(firstName(from.name))} to Move the Date</button>` : ''}
<button class="ibtn p" onclick="mCompleteTask('${t.id}');mPop()">${icon('check', { weight: 'bold' })}Mark Done</button></div>` : ''}`;
  });
}
// Files on a task (Nov 23): each with a preview tile; a picture opens full screen (swipe to the
// task's other pictures), any other file opens in a new tab. Whoever gave or has the task, and
// approvers, can add more here; removing is on the desktop.
const mFileUrls = {};   // path -> { url, at }: signed links last an hour, reused for 50 minutes
function mIsPic(name){ return /\.(png|jpe?g|gif|webp|avif)$/i.test(name || ''); }
function mTaskFilesHtml(t){
  const files = t.attachments || [], can = t.assigneeId === currentUser.id || t.assignerId === currentUser.id || canApprove();
  if(!files.length && !can) return '';
  setTimeout(mFillTaskFiles, 0);
  const row = a => `<a class="ir mtf-row${mIsPic(a.name) ? ' is-pic' : ''}" href="#" target="_blank" rel="noopener" data-path="${mEsc(a.path)}" data-name="${mEsc(a.name)}" onclick="return mOpenTaskFile(event, this)"><span class="mth">${icon(mIsPic(a.name) ? 'image' : 'file-text')}</span><span class="t n">${mEsc(a.name)}</span><span class="r">${a.size ? mFileSize(a.size) : ''}${icon('caret-right', { cls: 'chev', weight: 'bold' })}</span></a>`;
  return `${mIsh('Files')}<div class="ig mtf-list">${files.map(row).join('')}${can ? `<label class="ir tap mtf-add"><span class="gl">${icon('paperclip')}</span><span class="t n">Add Files</span><input type="file" multiple hidden onchange="mAddTaskFiles('${t.id}', this.files);this.value=''"></label>` : ''}</div>`;
}
async function mFileUrl(path){
  const hit = mFileUrls[path];
  if(hit && Date.now() - hit.at < 50 * 60000) return hit.url;
  try{ const { data } = await supabaseClient.storage.from('attachments').createSignedUrl(path, 3600); if(data && data.signedUrl){ mFileUrls[path] = { url: data.signedUrl, at: Date.now() }; return data.signedUrl; } }catch(e){}
  return null;
}
async function mFillTaskFiles(){
  for(const a of [...document.querySelectorAll('.mtf-row[data-path]:not([data-ready])')]){
    const url = await mFileUrl(a.dataset.path);
    if(!url || !a.isConnected) continue;
    a.href = url; a.dataset.ready = '1';
    const th = a.querySelector('.mth');
    if(th && mIsPic(a.dataset.name)){ const im = new Image(); im.alt = ''; im.decoding = 'async'; im.onload = () => im.classList.add('on'); im.onerror = () => im.remove(); im.src = url; th.replaceChildren(im); }
  }
}
function mOpenTaskFile(e, a){
  const pic = mIsPic(a.dataset.name);
  if(a.dataset.ready && !pic) return true;   // the real link opens it, so Safari doesn't block it
  e.preventDefault();
  if(!a.dataset.ready){ showToast('info', 'Still getting the file', 'Try again in a second.'); mFillTaskFiles(); return false; }
  const set = [...(a.closest('.mtf-list') || document).querySelectorAll('.mtf-row.is-pic[data-ready]')].map(x => ({ url: x.href, name: x.dataset.name }));
  mOpenPic(a.href, a.dataset.name, set);
  return false;
}
async function mAddTaskFiles(id, list){
  const files = [].slice.call(list || []); if(!files.length) return;
  showToast('info', `Attaching ${files.length === 1 ? files[0].name : files.length + ' files'}…`, '');
  const r = await uploadTaskFiles(id, files);
  const { data } = await supabaseClient.from('tasks').select('attachments').eq('id', id).maybeSingle();
  const t = tasks.find(x => x.id === id); if(t && data) t.attachments = data.attachments || [];
  mTop()?.refresh();
  if(r.failed.length) showToast('error', r.added.length ? 'Some files weren’t attached' : 'Not attached', taskFilesError(r.failed));
  else showToast('success', r.added.length === 1 ? 'File attached' : `${r.added.length} files attached`, r.added.length === 1 ? r.added[0].name : '');
}
// Full-screen picture, like Photos: Done closes it, swipe left or right for the task's other
// pictures, tap a picture bigger than the screen to see it full size (then scroll around it),
// and the share button opens it in Safari to save or zoom.
let mPicState = null;
function mOpenPic(url, name, set){
  mClosePic(true);
  const list = (set && set.length ? set : [{ url, name }]); let at = list.findIndex(x => x.url === url); if(at < 0){ list.unshift({ url, name }); at = 0; }
  const el = document.createElement('div');
  el.className = 'mqv'; el.id = 'mPicView'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Picture');
  el.innerHTML = `<div class="mqv-bar"><button type="button" class="mqv-done" onclick="mClosePic()">Done</button><span class="mqv-n"><b></b><span></span></span><a class="mqv-open" target="_blank" rel="noopener" aria-label="Open in Safari">${icon('export')}</a></div>
<div class="mqv-stage"><img class="mqv-img" alt=""></div>`;
  const img = el.querySelector('.mqv-img'), stage = el.querySelector('.mqv-stage');
  img.addEventListener('load', () => { stage.classList.remove('is-loading'); img.classList.add('is-loaded'); requestAnimationFrame(() => img.classList.toggle('can-zoom', img.naturalWidth > img.clientWidth * 1.15 || img.naturalHeight > img.clientHeight * 1.15)); });
  img.addEventListener('error', () => { stage.classList.remove('is-loading'); showToast('error', 'Couldn’t show the picture', 'Use the share button to open it.'); });
  img.addEventListener('click', e => {
    if(!img.classList.contains('can-zoom') && !el.classList.contains('is-full')) return;
    const r = img.getBoundingClientRect(), rx = (e.clientX - r.left) / r.width, ry = (e.clientY - r.top) / r.height;
    el.classList.toggle('is-full');
    if(el.classList.contains('is-full')){ stage.scrollLeft = rx * img.offsetWidth - stage.clientWidth / 2; stage.scrollTop = ry * img.offsetHeight - stage.clientHeight / 2; }
  });
  let sx = 0, sy = 0, st = 0;
  stage.addEventListener('touchstart', e => { if(e.touches.length === 1){ sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now(); } }, { passive: true });
  stage.addEventListener('touchend', e => {
    if(el.classList.contains('is-full') || !mPicState || mPicState.list.length < 2) return;
    const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy, v = Math.abs(dx) / Math.max(1, Date.now() - st);
    if(Math.abs(dx) > Math.abs(dy) * 1.4 && (Math.abs(dx) > 60 || v > 0.4)) mPicStep(dx < 0 ? 1 : -1);
  }, { passive: true });
  document.body.appendChild(el);
  mPicState = { el, list, at };
  mPicShow();
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-in')));
}
function mPicShow(){
  if(!mPicState) return;
  const { el, list, at } = mPicState, it = list[at], img = el.querySelector('.mqv-img');
  el.classList.remove('is-full');
  el.querySelector('.mqv-n b').textContent = it.name || '';
  el.querySelector('.mqv-n span').textContent = list.length > 1 ? `${at + 1} of ${list.length}` : '';
  el.querySelector('.mqv-open').href = it.url;
  img.classList.remove('is-loaded', 'can-zoom'); el.querySelector('.mqv-stage').classList.add('is-loading');
  img.alt = it.name || ''; img.src = it.url;
}
function mPicStep(d){ if(!mPicState) return; mPicState.at = (mPicState.at + d + mPicState.list.length) % mPicState.list.length; mPicShow(); }
function mClosePic(now){
  mPicState = null;
  document.querySelectorAll('#mPicView').forEach(el => {
    if(now === true || matchMedia('(prefers-reduced-motion: reduce)').matches){ el.remove(); return; }
    el.id = ''; el.classList.remove('is-in'); setTimeout(() => el.remove(), 200);
  });
}
// Ask the person who assigned it to move the date (only they can change it): a short message,
// already drafted, sent as a comment on the task and a notification (Nov 22).
function mAskTaskDate(id){
  const t = tasks.find(x => x.id === id); if(!taskCanAskDate(t)) return;
  const name = firstName(taskAssignerFor(t).name);
  mOpenSheet(`Ask ${name}`, `<div class="ig flat" style="margin-top:20px"><div class="ir" style="align-items:flex-start"><textarea class="iarea" id="mAskText" spellcheck="true" aria-label="Message">${mEsc(taskDateAskText(t))}</textarea></div></div>
<p class="ifoot">${mEsc(name)} gets it in their notifications. Add the date you need.</p>`, { done: `mSendTaskAsk('${id}')`, doneLabel: 'Send' });
  setTimeout(() => { const el = $m('mAskText'); if(el){ el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 420);
}
async function mSendTaskAsk(id){
  const t = tasks.find(x => x.id === id); if(!t) return;
  const ok = await sendTaskDateAsk(t, $m('mAskText')?.value);
  if(!ok){ showToast('info', 'Write a message first', ''); return; }
  mCloseSheet(true); showToast('success', `Asked ${firstName(taskAssignerFor(t).name)}`, 'They’ll see it in their notifications.');
}
async function mMoveTask(id, status){
  const { error } = await supabaseClient.from('tasks').update({ status }).eq('id', id);
  if(error){ showToast('error', 'Couldn’t move it', error.message); return; }
  const t = tasks.find(x => x.id === id); if(t) t.status = status;
  mTop()?.refresh(); showToast('success', 'Moved', status === 'in_progress' ? 'It’s in progress.' : '');
}

// ---- Review ----------------------------------------------------------------------------------
function mReviewItems(allClients){
  const cyc = updateCycle(), me = myName(), approver = canApprove(), out = { waiting: [], approved: [], sent: [] };
  attentionEligibleClients().filter(c => allClients || mReviewClient === 'all' || c.id === mReviewClient).forEach(c => (c.drafts || []).forEach(d => {
    if(!approver && d.author !== me) return;
    if(d.draftSentAt){ if(new Date(d.draftSentAt) >= cyc.weekStart) out.sent.push({ c, d, at: d.draftSentAt }); }
    else if(d.draftStatus === 'approved') out.approved.push({ c, d, at: d.draftPendingSince });
    else if(d.draftStatus === 'pending' && d.draft && (d.author === me || d.readyToNotify) && !draftHasNoWork(c, d)) out.waiting.push({ c, d, at: d.draftPendingSince });
  }));
  out.waiting.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
  out.sent.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
  return out;
}
function mPickReviewClient(){
  const it = mReviewItems(true), ids = [...new Set([...it.waiting, ...it.approved, ...it.sent].map(x => x.c.id))];
  mPick('Client', [['all', 'All clients'], ...ids.map(id => clients.find(c => c.id === id)).sort((a, b) => a.name.localeCompare(b.name)).map(c => [c.id, c.name])], mReviewClient, v => { mReviewClient = v; mRenderTab(); });
}
function mSetReviewTab(t){ mReviewTab = t; mRenderTab(); }
function mReviewWhen(x){ const d = new Date(x.at || rNow()), k = daysBetween(d, new Date()); return k === 0 ? (mReviewTab === 'waiting' ? fmtWait(d) : fmtTime(d)) : k === 1 ? 'Yesterday' : fmtShortDate(d); }
function mDraftRow(x){
  const { c, d } = x;
  const stale = d.draftStatus === 'approved' && (c.improvements || []).some(i => i.includeInEmail !== false && new Date(i.date) > new Date(d.draftPendingSince || 0) && i.author === d.author);
  const row = `<button class="ir" onclick="mOpenDraft('${c.id}',${jsArg(d.author)})" style="align-items:flex-start;padding:12px 16px">${monoHtml(c)}<div class="tx">
<div style="display:flex;gap:8px;align-items:baseline"><span class="t" style="flex:1">${mEsc(c.name)}</span><span style="font-size:14px;color:var(--label-2)">${mReviewWhen(x)}</span></div>
<span class="s">Weekly update · ${mEsc(d.author)}</span><span class="s2">${stale ? 'New work was logged after you approved this draft.' : mEsc(String(d.draft || '').replace(/\s+/g, ' ').slice(0, 140))}</span>${stale ? `<span style="margin-top:4px">${mDot('yellow', 'Needs re-review')}</span>` : ''}</div></button>`;
  if(mReviewTab !== 'waiting' || !canApprove()) return row;
  return `<div class="swipe" data-c="${c.id}" data-a="${mEsc(d.author)}">${row}<div class="acts"><button style="background:#636366" onclick="mSkipDraft('${c.id}',${jsArg(d.author)})">Skip</button><button style="background:var(--accent-fill)" onclick="mApproveDraft('${c.id}',${jsArg(d.author)})">Approve</button></div></div>`;
}
function mReviewHtml(){
  const it = mReviewItems(), list = it[mReviewTab];
  const fc = mReviewClient !== 'all' ? clients.find(x => x.id === mReviewClient) : null;
  const sub = (canApprove() ? `${mPlural(it.waiting.length, 'draft')} waiting${it.approved.length ? ` · ${it.approved.length} approved, not sent` : ''}` : 'Your drafts this week') + (fc ? ` · ${fc.name}` : '');
  setTimeout(mWireSwipes, 0);
  return `<div class="inav"><div class="r"><button aria-label="Filter by client" onclick="mPickReviewClient()"${fc ? ' style="color:var(--label)"' : ''}>${icon('funnel-simple')}</button></div></div>
<h1 class="big">Review</h1><p class="big-sub">${sub}</p>
${mSeg([['waiting', 'Waiting', it.waiting.length], ['approved', 'Approved', it.approved.length], ['sent', 'Sent', it.sent.length]], 'mSetReviewTab', mReviewTab)}
${list.length ? `<div class="ig" style="margin-top:16px">${list.map(mDraftRow).join('')}</div>` : `<div style="margin-top:16px">${mEmpty(mReviewTab === 'waiting' ? 'Nothing waiting' : 'Nothing here yet', mReviewTab === 'waiting' ? 'Drafts appear here when they’re sent for review.' : '')}</div>`}
${mReviewTab === 'waiting' && list.length && canApprove() ? '<p class="ifoot">Swipe left on a draft to approve or skip it.</p>' : ''}`;
}
function mWireSwipes(){
  document.querySelectorAll('#mMain .swipe').forEach(sw => {
    if(sw.dataset.wired) return; sw.dataset.wired = '1';
    const row = sw.querySelector('.ir'); let x0 = null, y0 = 0, dx = 0, open = false, horiz = null;
    sw.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; horiz = null; sw.classList.add('dragging'); }, { passive: true });
    sw.addEventListener('touchmove', e => {
      if(x0 == null) return;
      const ddx = e.touches[0].clientX - x0, ddy = e.touches[0].clientY - y0;
      if(horiz == null && (Math.abs(ddx) > 8 || Math.abs(ddy) > 8)) horiz = Math.abs(ddx) > Math.abs(ddy);
      if(!horiz) return;
      dx = Math.min(0, Math.max(-200, (open ? -168 : 0) + ddx));
      row.style.transform = `translateX(${dx}px)`;
    }, { passive: true });
    sw.addEventListener('touchend', () => {
      sw.classList.remove('dragging');
      if(horiz){ open = dx < -84; row.style.transform = open ? 'translateX(-168px)' : ''; if(open) row.addEventListener('click', ev => { ev.stopPropagation(); ev.preventDefault(); open = false; row.style.transform = ''; }, { once: true, capture: true }); }
      x0 = null;
    });
  });
}
function mDraftFor(clientId, author){ const c = clients.find(x => x.id === clientId); return c ? { c, d: (c.drafts || []).find(d => d.author === author) } : {}; }
function mOpenDraft(clientId, author){
  const { c } = mDraftFor(clientId, author); if(!c) return;
  let editing = false;
  const entry = mPush(c.name, () => {
    const { d } = mDraftFor(clientId, author); if(!d) return mEmpty('This draft is gone', '');
    const n = (d.draftImprovementIds || []).length || (c.improvements || []).filter(i => i.author === d.author && new Date(i.date) > clientWeek(c).since).length;
    const status = d.draftSentAt ? ['green', `Sent ${relDay(d.draftSentAt).toLowerCase()}`] : d.draftStatus === 'approved' ? ['purple', 'Approved'] : d.readyToNotify ? ['blue', `Draft ready · written from ${mPlural(n, 'improvement')}`] : ['hollow', 'Not sent for review yet'];
    const contact = (c.email || '').split(',')[0].trim();
    let bar = '';
    const wa = typeof winViaWhatsapp === 'function' && winViaWhatsapp(c), me = myName();
    if(!d.draftSentAt && wa){
      const st = winSendState(d), sender = st.k === 'copied' ? st.by : d.author;
      if(d.draftStatus === 'approved' && sender === me) bar = st.k === 'copied'
        ? `<button class="ibtn s" style="flex:0 0 116px" onclick="mWinCopy('${c.id}',${jsArg(d.author)})">Copy Again</button><button class="ibtn p" onclick="mWinSent('${c.id}',${jsArg(d.author)})">${icon('check')}Mark as Sent</button>`
        : `<button class="ibtn p" onclick="mWinCopy('${c.id}',${jsArg(d.author)})">${icon('copy')}Copy for WhatsApp</button>`;
      else if(d.draftStatus === 'approved') bar = '';
      else if(canApprove()) bar = `<button class="ibtn p" onclick="mApproveDraft('${c.id}',${jsArg(d.author)}, true)">${icon('check')}Approve</button>`;
      else if(d.author === me && !d.readyToNotify && !draftHasNoWork(c, d)) bar = `<button class="ibtn p" onclick="mSendForReview('${c.id}',${jsArg(d.author)})">${icon('paper-plane-tilt')}Send for Review</button>`;
    }
    else if(!d.draftSentAt){
      if(canApprove() && d.draftStatus === 'approved') bar = `<button class="ibtn p" onclick="mSendDraft('${c.id}',${jsArg(d.author)})">${icon('paper-plane-tilt')}Send Now</button>`;
      else if(canApprove()) bar = `<button class="ibtn s" style="flex:0 0 116px" onclick="mApproveDraft('${c.id}',${jsArg(d.author)}, true)">Approve</button><button class="ibtn p" onclick="mApproveAndSend('${c.id}',${jsArg(d.author)})">${icon('paper-plane-tilt')}Approve &amp; Send</button>`;
      else if(d.author === myName() && !d.readyToNotify && !draftHasNoWork(c, d)) bar = `<button class="ibtn p" onclick="mSendForReview('${c.id}',${jsArg(d.author)})">${icon('paper-plane-tilt')}Send for Review</button>`;
    }
    return `<div class="idraft">
<div style="display:flex;gap:12px;align-items:center">${monoHtml(c, 'lg')}<div style="min-width:0"><div style="font-size:17px;font-weight:600">${mEsc(c.name)}</div><div style="font-size:14px;color:var(--label-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${wa ? 'To their WhatsApp group' : `To ${mEsc(contact || 'no email on file')}`} · by ${mEsc(d.author)}</div></div></div>
<div style="margin-top:12px">${mDot(status[0], status[1])}</div>${!d.draftSentAt && typeof hasParts === 'function' && hasParts(c) ? `<p class="idraft-parts">${mEsc(mPartsWords(c, d.author))}</p>` : ''}
<h2>Your weekly update — ${mEsc(updateRangeLabel(c))}</h2>
${editing ? `<textarea id="mDraftEdit" spellcheck="true">${mEsc(d.draft || '')}</textarea>` : `<div class="body">${mDraftBody(d.draft)}</div>`}
</div>${bar && !editing ? `<div class="ibar">${bar}</div>` : ''}`;
  }, { right: '' });
  const setRight = () => {
    const { d } = mDraftFor(clientId, author);
    const can = d && !d.draftSentAt && (canApprove() || (d.author === myName() && !d.readyToNotify));
    entry.el.querySelector('.inav .r').innerHTML = can ? `<button onclick="mToggleDraftEdit()">${editing ? '<b>Done</b>' : 'Edit'}</button>` : '';
  };
  window.mToggleDraftEdit = async () => {
    if(editing){
      const v = $m('mDraftEdit')?.value;
      if(v != null){ const ok = await saveDraftFor(clientId, author, { draft: v }); ok ? showToast('success', 'Saved', '') : showToast('error', 'Couldn’t save', 'Try again.'); }
    }
    editing = !editing; entry.refresh(); setRight();
    if(editing) setTimeout(() => $m('mDraftEdit')?.focus(), 50);
  };
  setRight();
  entry.el.querySelector('.ipbody').addEventListener('input', () => {});
}
// "Goes out with Charlie’s part (in review), as one email."
function mPartsWords(c, author){
  const others = clientParts(c).filter(p => p.author !== author), me = myName();
  const st = { writing: 'still being written', review: 'in review', approved: 'approved' };
  const join = a => a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  return `Goes out with ${join(others.map(p => `${p.author === me ? 'your' : firstName(p.author) + '’s'} part (${st[p.state]})`))}, as one email.`;
}
// The draft as the client will read it: each line a paragraph, runs of "- " lines a list.
function mDraftBody(text){
  const out = []; let list = null;
  String(text || '').replace(/\r/g, '').split('\n').forEach(line => {
    const l = line.trim(), b = l.match(/^([-•*]|\d+\.)\s+(.*)$/);
    if(b){ (list = list || []).push(`<li>${mEsc(b[2])}</li>`); return; }
    if(list){ out.push(`<ul>${list.join('')}</ul>`); list = null; }
    if(l) out.push(`<p>${mEsc(l)}</p>`);
  });
  if(list) out.push(`<ul>${list.join('')}</ul>`);
  return out.join('');
}
async function mApproveDraft(clientId, author, stay, quiet){
  if(!canApprove()) return;
  const { c, d } = mDraftFor(clientId, author); if(!d) return;
  const edited = $m('mDraftEdit')?.value;
  const ids = d.draftImprovementIds || [];
  const ok = await saveDraftFor(clientId, author, { draftStatus: 'approved', ...(edited != null ? { draft: edited } : {}),
    ...(typeof winsDbReady === 'function' && winsDbReady() ? { approvedBy: myName() || '', approvedAt: new Date().toISOString(), waCopiedBy: '', waCopiedAt: null } : {}) });
  if(!ok){ showToast('error', 'Couldn’t approve', 'Try again in a moment.'); return; }
  if(ids.length) await supabaseClient.from('client_improvements').update({ include_in_email: false }).in('id', ids);
  mLog(clientId, 'draft_approved', `${myName()} approved ${author}'s draft.`, `Approved ${escapeHtml(author)}'s draft for <b>${escapeHtml(c.name)}</b>.`);
  const p = teamProfiles.find(x => x.name === author);
  const wa = typeof winViaWhatsapp === 'function' && winViaWhatsapp(c);
  if(p && p.id !== currentUser.id) mNotify(p.id, wa ? 'win_approved' : 'draft_approved', wa ? `${c.name}: your win is approved` : 'Your submission was approved',
    wa ? 'Copy it for WhatsApp and paste it in the group.' : `${myName()} approved your update for ${c.name}.`, 'approve');
  await mRefresh();
  if(!quiet) showToast('success', 'Approved', 'Send it from Review when you’re ready.');
  if(!stay && mStack.length) mPop();
}
async function mSkipDraft(clientId, author){
  if(!canApprove() || !(await confirmDialog(`Nothing is sent, and its improvements won’t go in a later draft.`, { title: `Skip ${author}’s update?`, confirmLabel: 'Skip', danger: true }))) return;
  const { c, d } = mDraftFor(clientId, author); if(!d) return;
  const ids = d.draftImprovementIds || [];
  const ok = await saveDraftFor(clientId, author, { draftStatus: 'none', draft: '', draftImprovementIds: [], draftSentAt: null, draftSentBy: '' });
  if(!ok){ showToast('error', 'Couldn’t skip it', 'Try again.'); return; }
  if(ids.length) await supabaseClient.from('client_improvements').update({ include_in_email: false }).in('id', ids);
  mLog(clientId, 'draft_skipped', `${myName()} skipped ${author}'s update.`, `Skipped ${escapeHtml(author)}'s draft for <b>${escapeHtml(c.name)}</b> — no email sent.`);
  await mRefresh(); showToast('info', 'Skipped', `${c.name}: nothing was sent.`);
}
async function mSendForReview(clientId, author){
  const { c, d } = mDraftFor(clientId, author);
  if(draftHasNoWork(c, d)){ showToast('error', 'Nothing left in this draft', 'Everything it was written from was deleted. Rewrite it on the desktop, or log the work first.'); return; }
  const v = $m('mDraftEdit')?.value;
  const ok = await saveDraftFor(clientId, author, { readyToNotify: true, ...(v != null ? { draft: v } : {}) });
  if(!ok){ showToast('error', 'Couldn’t send it for review', 'Try again.'); return; }
  for(const a of teamProfiles.filter(p => (p.role === 'admin' || p.role === 'approver') && p.id !== currentUser.id && !p.access_revoked)) mNotify(a.id, 'draft_ready', `${c.name}: draft ready for review`, `${author}'s weekly update is ready.`, 'teamqueue', c.id);
  await mRefresh(); showToast('success', 'Sent for review', `${c.name} is in Review.`);
}
// WhatsApp wins: copy it (which claims it, so nobody sends it twice), then Mark as Sent.
async function mWinCopy(clientId, author){ await copyWinForWhatsapp(clientId, author); await mRefresh(); }
async function mWinSent(clientId, author){ await markWinSent(clientId, author); await mRefresh(); }
async function mApproveAndSend(clientId, author){ await mApproveDraft(clientId, author, true, true); await mSendDraft(clientId, author); }
// The email goes out from the app, with the agency's signature, the same as on the desktop.
// A client's update in parts (update-parts.js): every approved part goes, as one email.
async function mSendDraft(clientId, author){
  const { c, d } = mDraftFor(clientId, author); if(!d) return;
  if(typeof winViaWhatsapp === 'function' && winViaWhatsapp(c)) return mWinCopy(clientId, author);
  if(!c.email){ showToast('info', `Add ${c.name}’s email first`, 'Add it in Edit Client on your computer, then send it.'); return; }
  const me = myName(), ap = approvedParts(c), ds = ap.length ? ap.map(p => p.d) : [d], authors = ds.map(x => x.author);
  const join = a => a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  const left = clientParts(c).filter(p => p.state === 'review' && !authors.includes(p.author)).map(p => firstName(p.author));
  const more = (authors.length > 1 ? ` ${partNames(authors, me).replace(/^./, x => x.toUpperCase())} go as one email.` : '') + (left.length ? ` ${join(left)}’s part${left.length === 1 ? ' is' : 's are'} still waiting for review and ${left.length === 1 ? 'goes' : 'go'} next time.` : '');
  if(!(await confirmDialog(`It goes to ${c.email}, with your signature.${more}`, { title: `Send ${c.name}’s update now?`, confirmLabel: 'Send' }))) return;
  const subject = `Your weekly update from ${settings.appName || 'Based Agency'}`;
  try{
    const r = await fetch('/api/send-email', { method: 'POST', headers: await apiAuthHeaders(), body: JSON.stringify({ to: c.email, subject, body: combineParts(ds), includeSignature: true }) });
    const data = await r.json().catch(() => ({}));
    if(!r.ok){ showToast('error', 'Send failed', data.error || 'The email didn’t go out.'); return; }
  }catch(e){ showToast('error', 'Send failed', 'Check your connection and try again.'); return; }
  const at = new Date().toISOString();
  for(const a of authors) await saveDraftFor(clientId, a, { draftSentAt: at, draftSentBy: me, sentVia: 'email' });
  await recordUpdateSent(clientId, at);
  for(const a of authors){
    await tellContributorsSent(c, getDraftFor(c, a), 'email');
    const p = a !== me ? teamProfiles.find(x => x.name === a) : null, rest = authors.filter(x => x !== a);
    if(p) mNotify(p.id, 'draft_sent', `${c.name}: your update was sent`, `${me || 'An approver'} sent it to ${c.email}${rest.length ? `, with ${partNames(rest, a)}, in one email` : ''}.`, 'teamqueue', c.id);
  }
  mLog(clientId, 'email_sent', `${me} sent the weekly update to ${c.email}${authors.length > 1 ? `, from ${join(authors)} in one email` : ''}.`, `Sent ${escapeHtml(join(authors))}'s update to <b>${escapeHtml(c.name)}</b>.`);
  await mRefresh(); showToast('success', 'Sent', `${c.name}’s update is on its way.`);
  if(mStack.length) mPop();
}
async function apiAuthHeaders(){ const { data: { session } } = await supabaseClient.auth.getSession(); return { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) }; }
// The team's activity feed and the client's own history, written the same way the desktop writes them.
function mLog(clientId, type, description, teamText){
  if(teamText) supabaseClient.from('team_activity_log').insert({ user_id: currentUser.id, tag: 'you', text: teamText }).then(() => {}, () => {});
  if(clientId) supabaseClient.from('activity_log').insert({ client_id: clientId, user_id: currentUser.id, action_type: type, description }).then(() => {}, () => {});
}
function mNotifUrl(view, id){ return view === 'client-detail' && id ? '/#client/' + encodeURIComponent(id) : view && /^[a-z-]+$/.test(view) ? '/#' + view : '/'; }
async function mNotify(userId, type, title, body, view, targetId){
  const p = teamProfiles.find(x => x.id === userId), m = (p && p.muted_notification_types) || [];
  if(m.includes(type)) return;
  if(!m.includes('app:' + type)) await supabaseClient.from('notifications').insert({ user_id: userId, type, title, body, target_view: view, ...(targetId ? { target_id: targetId } : {}) });
  const h = await apiAuthHeaders();
  if(!m.includes('push:' + type)) fetch('/api/integrations', { method: 'POST', headers: h, body: JSON.stringify({ provider: 'push', action: 'send', targetUserId: userId, title, body, url: mNotifUrl(view, targetId) }) }).catch(() => {});
  if(!m.includes('slack:' + type)) fetch('/api/send-slack-message', { method: 'POST', headers: h, body: JSON.stringify({ action: 'dm', targetUserId: userId, notificationType: type, text: `*${title}*\n${body || ''}` }) }).catch(() => {});
}

// ---- More ------------------------------------------------------------------------------------
function mMoreHtml(){
  const me = myProfile || {};
  const due = clientReminders.filter(r => r.status === 'waiting' && r.followUpDate && r.followUpDate <= toDateStr(new Date())).length;
  const g = (ic, t, right, fn) => mIr(`<span class="gl">${icon(ic)}</span>`, t, '', right || '', fn, { n: true });
  return `<h1 class="big" style="margin-top:8px">More</h1>
<div class="ig" style="margin-top:16px"><button class="ir prof" onclick="mOpenProfile()">${me.avatar_url ? `<img src="${safeUrl(me.avatar_url)}" alt="" style="width:56px;height:56px;border-radius:50%;object-fit:cover">` : avHtml(me.name || '?')}<div class="tx"><b>${mEsc(me.name || '')}</b><span>${mEsc(roleDisplayLabel(me.role))} · ${mEsc(settings.appName || 'Based Radar')}</span></div>${icon('caret-right', { cls: 'chev', weight: 'bold' })}</button></div>
<div class="ig" style="margin-top:20px">${g('buildings', 'Clients', String(activeClients().length), "mOpenClients()")}${g('calendar-blank', 'Calendar', '', 'mOpenCalendar()')}${g('bell-ring', 'Reminders', due ? String(due) : '', 'mOpenReminders()')}${g('notepad', 'Notes', typeof granolaNewN !== 'undefined' && granolaNewN ? `<span class="m-new">${granolaNewN} new</span>` : '', 'mOpenNotes()')}${g('timer', 'Time', timerState.running ? `<span class="mClk">${mClock()}</span>` : '', 'mOpenTime()')}</div>
<div class="ig" style="margin-top:20px">${g('users-three', 'Team', '', 'mOpenTeam()')}${g('trash', 'Recently Deleted', '', 'mOpenDeleted()')}${g('gear-six', 'Settings', '', 'mOpenSettings()')}</div>
<div class="ig" style="margin-top:20px">${g('desktop', 'Open the Desktop Version', '', "mOpenDesktop()")}</div>`;
}
function mOpenDesktop(){ try{ localStorage.setItem('bda_force_desktop', '1'); }catch(e){} location.href = '/?desktop=1' + (location.hash || ''); }

function mOpenClients(mode){
  let q = '';
  mPush('Clients', () => {
    const list = activeClients().map(c => ({ c, h: clientHealth(c) })).sort((a, b) => focusFirst(a.c, b.c) || (mode === 'health' ? ({ r: 0, y: 1, g: 2 }[a.h.level] - { r: 0, y: 1, g: 2 }[b.h.level]) || a.c.name.localeCompare(b.c.name) : a.c.name.localeCompare(b.c.name)));
    const vis = list.filter(x => !q || x.c.name.toLowerCase().includes(q));
    // added from Harvest, waiting for an approver to finish their info (on a computer)
    const su = mode === 'health' || !canApprove() ? [] : setupClients().filter(c => !q || c.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
    return `<h1 class="big">${mode === 'health' ? 'Health' : 'Clients'}</h1><p class="big-sub">${list.filter(x => x.h.level === 'r').length} at risk · ${list.filter(x => x.h.level === 'y').length} to watch</p>
<div class="isearch">${icon('magnifying-glass')}<input placeholder="Search" value="${mEsc(q)}" oninput="mClientsQ(this.value)" aria-label="Search clients"></div>
${su.length ? `${mIsh('Needs setup')}<div class="ig">${su.map(c => mIr(monoHtml(c), mEsc(c.name) + focusMark(c), 'Added from Harvest', '', `mOpenClient('${c.id}')`)).join('')}</div>${mIsh('Clients')}` : ''}
<div class="ig"${su.length ? '' : ' style="margin-top:14px"'}>${vis.map(({ c, h }) => (h.level === 'g' ? mIr(monoHtml(c), mEsc(c.name) + focusMark(c), mEsc(c.service || ''), '', `mOpenClient('${c.id}')`) : mIr(monoHtml(c), mEsc(c.name) + focusMark(c), signalChips(h, 1), healthTag(h.level), `mOpenClient('${c.id}')`, { tags: true }))).join('') || '<div class="ir"><span class="t n">No clients match</span></div>'}</div>`;
  });
  window.mClientsQ = v => { q = v.toLowerCase(); const top = mTop(); const inp = top.el.querySelector('.isearch input'); const pos = inp.selectionStart; top.refresh(); const i2 = top.el.querySelector('.isearch input'); i2.focus(); i2.setSelectionRange(pos, pos); };
}
function mOpenClient(id){
  const c0 = clients.find(x => x.id === id); if(!c0) return;
  mPush(c0.name, () => {
    const c = clients.find(x => x.id === id) || c0;
    if(clientInSetup(c)) return `<div class="idetail" style="display:flex;gap:12px;align-items:center;margin-top:4px">${monoHtml(c, 'lg')}<div style="min-width:0"><h1 style="font-size:24px;font-weight:700;letter-spacing:-.02em;margin:0">${mEsc(c.name)}</h1><div class="ikv">Added from Harvest</div></div></div>
${mIsh('Needs setup')}<div class="ig"><div class="ir"><span class="t n" style="white-space:normal;line-height:1.4">An approver finishes its info in All Clients on a computer: who owns it and how it gets its weekly win. Then it shows here like the rest.</span></div></div>
<div style="margin:12px 16px 0"><button class="ibtn s" onclick="mOpenDesktop()">Open the Computer Version</button></div>`;
    const w = weekView(clientWeek(c)), h = clientHealth(c);
    const imps = (c.improvements || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 8);
    const steps = STEP_NAMES.map((n, k) => mIr(`<span class="gl" style="color:${w.sent || k < w.done ? 'var(--green)' : w.behind === k ? (w.late ? 'var(--red)' : 'var(--yellow)') : 'var(--label-3)'}">${icon(w.sent || k < w.done ? 'check-circle' : w.behind === k ? 'warning' : 'circle')}</span>`, n, '', k === 3 ? (w.sent ? mEsc(relDay(w.last)) : `<span class="${w.late ? 't-red' : ''}">${mEsc(w.dueText)}</span>`) : '', null, { n: true })).join('');
    return `<div class="idetail" style="display:flex;gap:12px;align-items:center;margin-top:4px">${monoHtml(c, 'lg')}<div style="min-width:0"><h1 style="font-size:24px;font-weight:700;letter-spacing:-.02em;margin:0">${mEsc(c.name)}</h1><div class="ikv">${mEsc([c.service, w.owner].filter(Boolean).join(' · '))}</div>${mFocusHtml(c)}</div></div>
${h.level !== 'g' ? `<div class="tags iwrap" style="margin:14px 16px 0">${healthTag(h.level)}${signalChips(h, 4)}</div>` : ''}
${mIsh('This week’s update')}${w.off ? `<div class="ig">${mIr('', 'No weekly update', '', '', null, { n: true })}</div><p class="ifoot">It isn’t on This Week, Today or Health. Work and hours are still logged here.</p>` : `<div class="ig">${steps}</div>`}
${waCanWork(c) ? `<div style="margin:12px 16px 0"><button class="ibtn s" onclick="mOpenLog('${c.id}')">${icon('plus')}Log Improvement</button></div>` : `<p class="ifoot" style="margin-top:12px">${mEsc(waOutsideWords(c))}</p>`}
${mIsh('Logged')}<div class="ig">${imps.map(i => mIr('', mEsc(i.text), `${mEsc(i.author)} · ${fmtShortDate(new Date(i.date))}${i.includeInEmail === false ? ' · internal' : ''}`, '', null, { n: true })).join('') || '<div class="ir"><span class="t n" style="color:var(--label-2)">Nothing logged yet</span></div>'}</div>${mClientMeetingsHtml(c)}`;
  });
}
// The client's meetings (Nov 23): when the team last met them, and the meetings you can see
function mClientMeetingsHtml(c){
  if(!clientMeetingsOn(c)) return '';
  if(granolaMeetings === null) loadGranolaMeetings().then(() => mTop()?.refresh());
  const rows = granolaMeetings ? clientMeetingRows(c, 6) : [];
  return `<div class="ish"><h2 class="ish-lg">${appLogo('granola', 'xs')}Meetings</h2></div><div class="ig">${rows.map(r => mIr('', mEsc(r.title), mEsc(r.sub), '', `openMeetingNotes(${mEsc(JSON.stringify(r.id))})`)).join('')
    || `<div class="ir"><span class="t n" style="color:var(--label-2)">${granolaMeetings === null ? 'Loading…' : clientLastMet(c) ? 'No meetings with them that you were in' : 'No meetings read for them yet'}</span></div>`}</div>${clientLastMet(c) ? `<p class="ifoot">${mEsc(lastMetWords(c))}.</p>` : ''}`;
}
// Focus (Nov 23): an approver switches it here too; everyone sees it (js/core/data.js)
function mFocusHtml(c){
  const on = isFocus(c);
  if(!canApprove()) return on ? `<span class="fo-tg on is-ro">${icon('target')}Focus client</span>` : '';
  return `<button class="fo-tg${on ? ' on' : ''}" aria-pressed="${on}" onclick="mSetFocus('${c.id}', ${!on})">${icon('target')}${on ? 'Focus client' : 'Add to Focus'}</button>`;
}
async function mSetFocus(id, on){
  const c = clients.find(x => x.id === id);
  const r = await saveClientFocus([id], on);
  if(r.failed){ showToast('error', 'Focus not saved', 'Try again.'); return; }
  await mRefresh();
  showToast('success', on ? `${c ? c.name : 'The client'} is a Focus client` : `${c ? c.name : 'The client'} is off Focus`, on ? 'It comes first in every list.' : '');
}
function mOpenCalendar(){
  mPush('Calendar', () => {
    const t0 = dayStart(new Date()), days = [];
    for(let k = 0; k < 14; k++){
      const d = addDays(t0, k), ds = toDateStr(d);
      const evs = calendarEvents.filter(e => toDateStr(new Date(e.startAt)) === ds && (!e.attendeeIds.length || e.attendeeIds.includes(currentUser.id) || e.createdBy === currentUser.id));
      const ts = mVisibleTasks().filter(t => t.status !== 'done' && t.dueDate === ds && t.assigneeId === currentUser.id);
      const dueHere = attentionEligibleClients().filter(c => { const due = clientDue(c).due; return toDateStr(due < t0 ? t0 : due) === ds; });
      const send = dueHere.length ? [mIr(`<span class="gl" style="color:var(--red)">${icon('paper-plane-tilt')}</span>`, `${dueHere.length} update${dueHere.length === 1 ? '' : 's'} due`, mEsc(dueHere.slice(0, 3).map(c => c.name).join(', ') + (dueHere.length > 3 ? '…' : '')), '', k === 0 ? 'mOpenWeek()' : null, { n: true })] : [];
      const rows = [...send, ...evs.map(e => mIr(`<span class="gl">${icon('calendar-blank')}</span>`, mEsc(e.title), mEsc(clients.find(c => c.id === e.clientId)?.name || e.location || ''), e.allDay ? 'All day' : fmtTime(new Date(e.startAt)), null, { n: true })), ...ts.map(mTaskRow)];
      if(rows.length) days.push(`${mIsh(k === 0 ? 'Today' : k === 1 ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }))}<div class="ig">${rows.join('')}</div>`);
    }
    return `<h1 class="big">Calendar</h1><p class="big-sub">The next two weeks</p>${days.join('') || `<div style="margin-top:16px">${mEmpty('Nothing scheduled', '')}</div>`}`;
  }, { right: `<button aria-label="New event" onclick="mOpenEventSheet()">${icon('plus')}</button>` });
}
// Waiting on a teammate (Nov 23): their first name, else the client's name
function mRemMate(r){ return r && r.waitingOn ? (teamProfiles.find(p => p.id === r.waitingOn) || { id: r.waitingOn, name: 'A teammate', gone: true }) : null; }
function mRemOn(r){ const m = mRemMate(r); if(m) return m.gone ? 'a teammate' : firstName(m.name); const c = clients.find(x => x.id === r.clientId); return c ? c.name : 'the client'; }
function mOpenReminders(){
  mPush('Reminders', () => {
    const disp = r => (r.status === 'waiting' && r.followUpDate && r.followUpDate <= toDateStr(new Date())) ? 'due' : r.status;
    const open = clientReminders.filter(r => r.status === 'waiting').sort((a, b) => focusIdFirst(a.clientId, b.clientId) || (a.followUpDate || '').localeCompare(b.followUpDate || ''));
    const row = r => { const c = clients.find(x => x.id === r.clientId), due = disp(r) === 'due', m = mRemMate(r); return mIr(`<button class="cb rem" role="checkbox" aria-checked="false" aria-label="Mark answered" onclick="event.stopPropagation();checkOff(this, () => mAnswerReminder('${r.id}'))"></button>`, mEsc(r.question), `${m ? `<span class="rmi-mate">${icon('user')}${mEsc(mRemOn(r))}</span>${c ? ' · ' + mEsc(c.name) : ''}` : mEsc(c ? c.name : '')}${r.followUpDate ? ' · ' + (due ? '<span class="t-red">Follow up ' + (r.followUpDate === toDateStr(new Date()) ? 'today' : fmtShortDate(new Date(r.followUpDate + 'T12:00:00'))) + '</span>' : 'Follow up ' + fmtShortDate(new Date(r.followUpDate + 'T12:00:00'))) : ''}`, '', `mReminderActions('${r.id}')`, { n: true, div: true }); };
    return `<h1 class="big">Reminders</h1><p class="big-sub">${open.filter(r => disp(r) === 'due').length} to follow up · ${open.length} waiting${open.some(r => r.waitingOn) ? '' : ' on clients'}</p>
<div class="ig" style="margin-top:16px">${open.map(row).join('') || '<div class="ir"><span class="t n" style="color:var(--label-2)">Nothing waiting</span></div>'}</div>`;
  }, { right: `<button aria-label="New reminder" onclick="mOpenReminderSheet()">${icon('plus')}</button>` });
}
async function mAnswerReminder(id){
  const { error } = await supabaseClient.from('client_reminders').update({ status: 'answered', resolved_at: new Date().toISOString() }).eq('id', id);
  if(error){ showToast('error', 'Couldn’t mark it answered', error.message); await mRefresh(); return; }
  await mRefresh(); showToast('success', 'Marked answered', '');
}
function mReminderActions(id){
  const r = clientReminders.find(x => x.id === id); if(!r) return;
  const c = clients.find(x => x.id === r.clientId);
  mActions(r.question, [
    ...(r.status === 'waiting' ? [{ label: 'Draft a Nudge', fn: () => mOpenNudge(id) }] : []),
    { label: 'Mark Answered', fn: async () => { await supabaseClient.from('client_reminders').update({ status: 'answered', resolved_at: new Date().toISOString() }).eq('id', id); await mRefresh(); showToast('success', 'Marked answered', c ? c.name : ''); } },
    { label: 'Make a Task', fn: () => mOpenTaskSheet({ title: r.waitingOn ? `Follow up with ${mRemOn(r)}` : c ? `Follow up with ${c.name}` : 'Follow up', clientId: r.clientId, description: r.question }) },
    { label: 'Delete Reminder', danger: true, fn: async () => { await supabaseClient.from('client_reminders').delete().eq('id', id); await mRefresh(); showToast('success', 'Reminder deleted', ''); } },
  ]);
}
// Nudge (Nov 23): the AI writes the follow-up to the client (js/core/followup-prompt.js), as on the
// desktop. Open in Mail or Copy counts as nudged and moves the next follow-up three days out, never
// onto a weekend. Radar never sends it to the client by itself.
let mNudge_ = null;   // { id, ch, state, subject, body, plain, n }
function mWorkday(d){ const k = d.getDay(); return k === 6 ? addDays(d, 2) : k === 0 ? addDays(d, 1) : d; }
function mOpenNudge(id){
  const r = clientReminders.find(x => x.id === id); if(!r) return;
  const c = clients.find(x => x.id === r.clientId);
  mNudge_ = { id, ch: r.waitingOn ? 'slack' : c && typeof winChannel === 'function' && winChannel(c) === 'whatsapp' ? 'whatsapp' : 'email', state: 'writing', subject: '', body: '', n: 0 };
  if(r.waitingOn) mSlackMeStatus();
  const entry = mPush('Nudge', () => mNudgeBody(), { navTitle: true });
  mNudge_.entry = entry;
  mWriteNudge();
}
async function mWriteNudge(ch){
  const n = mNudge_; if(!n) return;
  const r = clientReminders.find(x => x.id === n.id); if(!r) return;
  const c = clients.find(x => x.id === r.clientId);
  if(ch) n.ch = ch;
  n.state = 'writing'; n.plain = false; const k = ++n.n;
  n.entry && n.entry.refresh();
  const asked = r.askedDate ? new Date(r.askedDate + 'T12:00:00') : null;
  const o = n.ch === 'slack' ? { teammate: mRemOn(r) === 'a teammate' ? 'there' : mRemOn(r), client: c ? c.name : '', ask: r.question, askedOn: asked ? asked.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : '',
    waitedDays: asked ? Math.max(0, daysBetween(dayStart(asked), dayStart(new Date()))) : null, sender: firstName(myName() || ''), whatsapp: true }
  : { client: c ? c.name : 'the client', contact: clientContact(c), ask: r.question,
    askedOn: asked ? asked.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : '',
    waitedDays: asked ? Math.max(0, daysBetween(dayStart(asked), dayStart(new Date()))) : null,
    sender: firstName(myName() || ''), agency: (typeof settings !== 'undefined' && settings.appName) || 'Based Agency', whatsapp: n.ch === 'whatsapp' };
  let out = null;
  try{
    const res = await fetch('/api/generate-draft', { method: 'POST', headers: await apiAuthHeaders(), body: JSON.stringify({ prompt: followUpPrompt(o), model: typeof settings !== 'undefined' ? settings.openaiModel : undefined }) });
    const data = await res.json().catch(() => ({}));
    if(res.ok) out = followUpParse(data.text, o.whatsapp);
  }catch(e){}
  if(mNudge_ !== n || n.n !== k) return;
  if(!out){ out = followUpPlain(o); n.plain = true; }
  Object.assign(n, { state: 'ready', subject: out.subject || '', body: out.body || '' });
  n.entry && n.entry.refresh();
  if(n.plain) showToast('info', 'Here’s a simple one', 'The AI didn’t answer, so this is a plain nudge to edit.');
}
function mNudgeBody(){
  const n = mNudge_; if(!n) return '';
  const r = clientReminders.find(x => x.id === n.id), c = r && clients.find(x => x.id === r.clientId);
  if(!r) return mEmpty('This reminder is gone', '');
  if(n.ch === 'slack') return mSlackNudgeBody(n, r, c);
  const email = n.ch === 'email', to = c && c.email ? String(c.email).split(',')[0].trim() : '';
  const who = clientContact(c) || (c ? c.name : 'the client');
  const seg = `<div class="seg inudge-ch" role="tablist" aria-label="Send by">${[['email', 'Email'], ['whatsapp', 'WhatsApp']].map(([k, t]) => `<button class="${n.ch === k ? 'on' : ''}" role="tab" aria-selected="${n.ch === k}" ${n.state === 'writing' ? 'disabled' : ''} onclick="${n.ch === k ? '' : `mWriteNudge('${k}')`}">${t}</button>`).join('')}</div>`;
  const head = `<div class="idraft inudge"><div style="font-size:17px;font-weight:600">${mEsc(c ? c.name : '')}</div><div class="inudge-q">${mEsc(r.question)}</div>${seg}`;
  if(n.state === 'writing') return `${head}<div class="inudge-w" aria-live="polite">${icon('sparkle')}Writing ${email ? 'an email' : 'a WhatsApp message'} to ${mEsc(who)}…</div><i class="inudge-sk"></i><i class="inudge-sk"></i><i class="inudge-sk"></i></div>`;
  const next = mWorkday(addDays(new Date(), 3)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const primary = email && to
    ? `<button class="ibtn s" style="flex:0 0 108px" onclick="mCopyNudge()">${icon('copy')}Copy</button><button class="ibtn p" onclick="mMailNudge()">${icon('envelope-simple')}Open in Mail</button>`
    : `<button class="ibtn s" style="flex:0 0 108px" onclick="mWriteNudge()">${icon('arrows-clockwise')}Again</button><button class="ibtn p" onclick="mCopyNudge()">${icon('copy')}${email ? 'Copy' : 'Copy for WhatsApp'}</button>`;
  return `${head}
<div class="ig flat inudge-f">${email ? `<div class="ir"><input class="itf" id="mNudgeSubj" aria-label="Subject" placeholder="Subject" value="${mEsc(n.subject)}" oninput="mNudge_ && (mNudge_.subject = this.value)"></div>` : ''}
<div class="ir" style="align-items:flex-start"><textarea class="iarea" id="mNudgeBody" aria-label="Message" spellcheck="true" oninput="mNudge_ && (mNudge_.body = this.value)">${mEsc(n.body)}</textarea></div></div>
<p class="inudge-n">${email ? (to ? `To ${mEsc(to)}.` : `No email on file for ${mEsc(c ? c.name : 'this client')}, so copy it into your mail.`) : 'Paste it in their group.'} The next follow-up moves to ${next}.${email && to ? ` <button class="inudge-again" onclick="mWriteNudge()">Write again</button>` : ''}</p>
</div><div class="ibar">${primary}</div>`;
}
// A teammate (Nov 23): a Slack message, sent from your own Slack (lib/slack-me.js), or copied
let mSlackMe = null;
async function mSlackMeStatus(){
  if(mSlackMe) return mSlackMe;
  try{ const res = await fetch('/api/integrations?provider=slack-me', { headers: await apiAuthHeaders() }); mSlackMe = res.ok ? await res.json() : { connected: false }; }catch(e){ mSlackMe = { connected: false }; }
  mNudge_ && mNudge_.entry && mNudge_.entry.refresh();
  return mSlackMe;
}
function mSlackNudgeBody(n, r, c){
  const m = mRemMate(r), first = mRemOn(r), sm = mSlackMe || {}, canSend = sm.connected && m && !m.gone && m.slack_user_id;
  const head = `<div class="idraft inudge"><div style="font-size:17px;font-weight:600">${mEsc(m && !m.gone ? m.name : 'A teammate')}</div><div class="inudge-q">${mEsc(r.question)}${c ? ' · ' + mEsc(c.name) : ''}</div>`;
  if(n.state === 'writing') return `${head}<div class="inudge-w" aria-live="polite">${icon('sparkle')}Writing a Slack message to ${mEsc(first)}…</div><i class="inudge-sk"></i><i class="inudge-sk"></i><i class="inudge-sk"></i></div>`;
  const next = mWorkday(addDays(new Date(), 1)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const note = canSend ? `Goes from your Slack, as you.` : sm.connected ? `${mEsc(first)} has no Slack account linked in Radar, so copy it.` : `Connect your Slack on the desktop (Settings → Connections) to send it as you, or copy it.`;
  return `${head}
<div class="ig flat inudge-f"><div class="ir" style="align-items:flex-start"><textarea class="iarea" id="mNudgeBody" aria-label="Message" spellcheck="true" oninput="mNudge_ && (mNudge_.body = this.value)">${mEsc(n.body)}</textarea></div></div>
<p class="inudge-n">${note} The next follow-up moves to ${next}. <button class="inudge-again" onclick="mWriteNudge()">Write again</button></p>
</div><div class="ibar">${canSend ? `<button class="ibtn s" style="flex:0 0 108px" onclick="mCopyNudge()">${icon('copy')}Copy</button><button class="ibtn p" onclick="mSlackSend()">${icon('paper-plane-tilt')}Send on Slack</button>` : `<button class="ibtn p" onclick="mCopyNudge()">${icon('copy')}Copy</button>`}</div>`;
}
async function mSlackSend(){
  const n = mNudge_; if(!n) return;
  const r = clientReminders.find(x => x.id === n.id); if(!r) return;
  const text = String(n.body || '').trim(); if(!text){ showToast('error', 'Nothing to send', 'Write the message first.'); return; }
  let out = {};
  try{ const res = await fetch('/api/integrations', { method: 'POST', headers: await apiAuthHeaders(), body: JSON.stringify({ provider: 'slack-me', action: 'send', toProfileId: r.waitingOn, text }) }); out = await res.json().catch(() => ({})); }catch(e){ out = { error: 'Couldn’t reach Radar. Try again.' }; }
  if(!out.ok){ if(out.notConnected) mSlackMe = { connected: false }; n.entry && n.entry.refresh(); showToast('error', 'Not sent', out.error || 'Try again in a moment.'); return; }
  await mNudged('slack');
}
async function mMailNudge(){
  const n = mNudge_; if(!n) return;
  const r = clientReminders.find(x => x.id === n.id), c = r && clients.find(x => x.id === r.clientId);
  const to = c && c.email ? String(c.email).split(',')[0].trim() : '';
  if(!to) return mCopyNudge();
  const a = document.createElement('a');
  a.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(n.subject || '')}&body=${encodeURIComponent(n.body || '')}`;
  a.click();
  await mNudged('mail');
}
async function mCopyNudge(){
  const n = mNudge_; if(!n) return;
  try{ await navigator.clipboard.writeText(n.body || ''); }catch(e){ showToast('error', 'Couldn’t copy', 'Select the text and copy it yourself.'); return; }
  await mNudged(n.ch === 'whatsapp' ? 'whatsapp' : 'copy');
}
async function mNudged(how){
  const n = mNudge_; if(!n) return;
  const r = clientReminders.find(x => x.id === n.id), c = r && clients.find(x => x.id === r.clientId);
  const next = mWorkday(addDays(new Date(), r && r.waitingOn ? 1 : 3));   // a teammate: the next working day
  mNudge_ = null; mPop();
  const { error } = await supabaseClient.from('client_reminders').update({ follow_up_date: toDateStr(next) }).eq('id', n.id);
  if(error){ showToast('error', 'Follow-up date not moved', error.message); return; }
  await mRefresh();
  showToast('success', how === 'slack' ? `Sent to ${mRemOn(r)} on Slack` : how === 'mail' ? 'Nudge ready in Mail' : how === 'whatsapp' ? 'Nudge copied for WhatsApp' : 'Nudge copied', `Next follow-up ${next.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}.`);
  if(c && r && !r.waitingOn && typeof logClientActivity === 'function') logClientActivity(r.clientId, 'reminder_nudged', `${myName() || 'Someone'} nudged ${c.name} about "${r.question.length > 80 ? r.question.slice(0, 80) + '…' : r.question}".`);
}
function mMeetingsHtml(){
  if(typeof granolaMeetings === 'undefined') return '';
  meetingsRefresh(() => mTop()?.refresh());
  if(granolaMeetings === null) return '';
  if(!granolaMeetings.length) return '';
  const list = granolaMeetings.slice(0, mMtAll ? 60 : 6);
  return `<div class="ish"><h2 class="ish-lg">${appLogo('granola', 'xs')}Granola Meetings</h2>${granolaMeetings.length > 6 ? `<button onclick="mMtAll=!mMtAll;mTop()?.refresh()">${mMtAll ? 'Fewer' : 'See All'}</button>` : ''}</div>
<div class="ig">${list.map(m => mIr('', mEsc(m.title), mEsc(meetingSubWords(m).join(' · ')), '', `openMeetingNotes(${mEsc(JSON.stringify(m.id))})`)).join('')}</div><p class="ifoot">${meetingCanAssign() ? 'Admins and approvers see every meeting; everyone else, the meetings they were in.' : 'The meetings you were in.'}</p>`;
}
let mMtAll = false;
function mOpenNotes(){
  if(typeof granolaMarkSeen === 'function') granolaMarkSeen();   // the new meetings are seen
  // two sections: Granola Meetings, then Personal (Nov 23)
  mPush('Notes', () => `<h1 class="big">Notes</h1>${mMeetingsHtml()}<div class="ish"><h2 class="ish-lg">${icon('lock-simple')}Personal</h2></div>
<div class="ig">${notes.map(n => { const c = clients.find(x => x.id === n.clientId); return mIr('', mEsc(n.title || 'Untitled note'), mEsc([c ? c.name : '', String(n.text || '').replace(/\s+/g, ' ').slice(0, 60)].filter(Boolean).join(' · ')), '', `mOpenNoteSheet('${n.id}')`, { n: true }); }).join('') || '<div class="ir"><span class="t n" style="color:var(--label-2)">No notes yet</span></div>'}</div><p class="ifoot">Only you can see these.</p>`,
  { right: `<button aria-label="New note" onclick="mOpenNoteSheet()">${icon('plus')}</button>` });
}
function mOpenTime(){
  mPush('Time', () => {
    const mine = timeEntries.filter(e => e.userId === currentUser.id), today = toDateStr(new Date());
    const mon = toDateStr(addDays(dayStart(new Date()), -((new Date().getDay() + 6) % 7)));
    const wk = mine.filter(e => e.date >= mon).reduce((s, e) => s + e.minutes, 0), td = mine.filter(e => e.date === today);
    const c = clients.find(x => x.id === timerState.clientId);
    const hm = m => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
    return `<h1 class="big">Time</h1><p class="big-sub">${hm(wk)} this week</p>
<div class="ibig-timer">${timerState.running ? `<div class="clk mClk">${mClock()}</div><div class="who">${mEsc(c ? c.name : '')}${timerState.description ? ' · ' + mEsc(timerState.description) : ''}</div><button class="ibtn s" style="color:var(--red)" onclick="mStopTimer()">Stop and Save</button>` : `<div class="clk" style="color:var(--label-3)">0:00:00</div><button class="ibtn p" onclick="mOpenTimerSheet()">${icon('play')}Start Timer</button>`}<button class="ibtn s" style="margin-top:10px" onclick="mOpenTimeSheet()">${icon('plus')}Add Time Worked</button></div>
${mIsh('Today')}<div class="ig">${td.map(e => { const cc = clients.find(x => x.id === e.clientId); return mIr('', mEsc(cc ? cc.name : 'Client'), mEsc(e.description || e.service || ''), hm(e.minutes), null, { n: true }); }).join('') || '<div class="ir"><span class="t n" style="color:var(--label-2)">Nothing logged today</span></div>'}</div>`;
  });
}
function mOpenTeam(){
  mPush('Team', () => `<h1 class="big">Team</h1><p class="big-sub">${teamProfiles.filter(p => !p.access_revoked).length} people</p>
<div class="ig" style="margin-top:16px">${teamProfiles.filter(p => !p.access_revoked).sort((a, b) => a.name.localeCompare(b.name)).map(p => mIr(avHtml(p.name), mEsc(p.name), mEsc(p.title || roleDisplayLabel(p.role)), p.phone ? `<a href="tel:${mEsc(p.phone)}" aria-label="Call ${mEsc(p.name)}" onclick="event.stopPropagation()" style="display:inline-flex;width:22px;height:22px">${icon('phone')}</a>` : '', p.email ? `location.href='mailto:${mEsc(p.email)}'` : null, { div: true, cls: 'person' })).join('')}</div>`);
}
function mOpenDeleted(){
  mPush('Recently Deleted', () => `<h1 class="big">Recently Deleted</h1><p class="big-sub">Loading…</p>`);
  Promise.all([supabaseClient.from('notes').select('*').eq('user_id', currentUser.id).not('deleted_at', 'is', null), supabaseClient.from('time_entries').select('*').eq('user_id', currentUser.id).not('deleted_at', 'is', null)]).then(([n, e]) => {
    const top = mTop(); if(!top || top.title !== 'Recently Deleted') return;
    // deleted work (yours, or work you deleted) comes back with the time logged with it, so that time isn't listed on its own
    const wk = typeof myDeletedWork === 'function' ? myDeletedWork() : [], wIds = new Set(wk.map(w => w.id));
    const tOf = id => (e.data || []).filter(x => x.improvement_id === id).reduce((m, x) => m + (x.minutes || 0), 0);
    const rows = [...wk.map(w => { const m = tOf(w.id); return mIr(`<span class="gl">${icon('square-pen')}</span>`, mEsc(w.text || 'Work'), `${mEsc(clients.find(c => c.id === w.clientId)?.name || 'Work')}${m ? ` · ${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} of time` : ''}`, `<button onclick="mRestoreWork('${w.id}')" style="color:var(--label);font-size:15px">Restore</button>`, null, { n: true }); }),
      ...(n.data || []).map(x => mIr(`<span class="gl">${icon('notepad')}</span>`, mEsc(x.title || 'Untitled note'), 'Note', `<button onclick="mRestore('notes','${x.id}')" style="color:var(--label);font-size:15px">Restore</button>`, null, { n: true })),
      ...(e.data || []).filter(x => !x.improvement_id || !wIds.has(x.improvement_id)).map(x => mIr(`<span class="gl">${icon('timer')}</span>`, mEsc(clients.find(c => c.id === x.client_id)?.name || 'Time'), `${Math.floor(x.minutes / 60)}:${String(x.minutes % 60).padStart(2, '0')} · ${fmtShortDate(new Date(x.entry_date + 'T12:00:00'))}`, `<button onclick="mRestore('time_entries','${x.id}')" style="color:var(--label);font-size:15px">Restore</button>`, null, { n: true }))];
    top.el.querySelector('.ipbody').innerHTML = `<h1 class="big">Recently Deleted</h1><p class="big-sub">Work, notes and time you deleted</p><div class="ig" style="margin-top:16px">${rows.join('') || '<div class="ir"><span class="t n" style="color:var(--label-2)">Nothing here</span></div>'}</div>`;
  });
}
// Time comes back on the timesheet and is made again in Harvest (deleting it took it out of there)
async function mRestore(table, id){
  const back = table === 'time_entries' ? { deleted_at: null, harvest_entry_id: null, harvest_sync_status: 'pending', harvest_sync_error: null } : { deleted_at: null };
  const { error } = await supabaseClient.from(table).update(back).eq('id', id);
  if(error){ showToast('error', 'Couldn’t restore it', error.message); return; }
  if(table === 'time_entries') mSyncToHarvest(id);
  await mRefresh(); mPop(); mOpenDeleted(); showToast('success', 'Restored', '');
}
async function mRestoreWork(id){
  const r = await restoreWork([id]);
  if(!r.ok){ showToast('error', 'Couldn’t restore it', 'Try again in a moment.'); return; }
  await mRefresh(); mPop(); mOpenDeleted(); showToast('success', 'Restored', 'The work, with its time.');
}
function mOpenSettings(){
  mPush('Settings', () => {
    const full = (myProfile && myProfile.theme) || 'auto', pref = nightHours(full) ? 'night' : full;
    const opt = (k, t) => `<button class="ir" onclick="mSetTheme('${k}')"><div class="tx"><span class="t n">${t}</span></div><div class="r">${pref === k ? `<span class="pk">${icon('check', { weight: 'bold' })}</span>` : ''}</div></button>`;
    return `<h1 class="big">Settings</h1>
${mIsh('Appearance')}<div class="ig">${opt('auto', 'Automatic')}${opt('light', 'Light')}${opt('dark', 'Dark')}${opt('night', 'Night to Morning')}</div>
<p class="ifoot">${pref === 'night' ? `Dark from ${fmtTime(atTime(new Date(), nightHours(full)[0]))} to ${fmtTime(atTime(new Date(), nightHours(full)[1]))}. Change the hours in Settings on the desktop.` : 'Automatic follows your iPhone.'}</p>
${mIsh('Notifications')}<div class="ig">${mIr('', 'Sound in Radar', '', `<span class="ios-sw${radarSoundOn() ? ' on' : ''}" role="switch" aria-checked="${radarSoundOn()}"></span>`, 'setRadarSound(!radarSoundOn());mTop()?.refresh()', { n: true, noChev: true })}${mIr('', 'Push notifications', '', `<span class="ios-sw${'Notification' in window && Notification.permission === 'granted' ? ' on' : ''}" role="switch" aria-checked="${'Notification' in window && Notification.permission === 'granted'}"></span>`, 'mEnablePush()', { n: true, noChev: true })}</div>
<p class="ifoot">Choose which notifications you get in Settings on the desktop.</p>
<div class="ig" style="margin-top:28px">${mIr('', '<span style="color:var(--red)">Sign Out</span>', '', '', 'mSignOut()', { n: true, noChev: true })}</div>`;
  });
}
async function mSetTheme(k){
  if(k === 'night' && nightHours((myProfile && myProfile.theme) || '')) k = myProfile.theme;   // keeps the hours set on the desktop
  const p = saveThemePref(k); mTop()?.refresh(); await p;
}
const M_VAPID = 'BMKfTiTGaN-T9TYO-m6a1oAbIypXcS_FsPZ0ie1uIopU9wJQfOmrX7JvT_yReo8OkReAqlT-1PA8kL1m6sqII6s';
async function mEnablePush(){
  if(!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)){ showToast('info', 'Add the app to your Home Screen first', 'In Safari, tap Share, then Add to Home Screen. Open it from there and turn this on.'); return; }
  if(Notification.permission === 'granted'){ showToast('info', 'Notifications are on', 'Turn them off in your iPhone’s Settings.'); return; }
  const perm = await Notification.requestPermission();
  if(perm !== 'granted'){ showToast('info', 'Notifications are off', 'Turn them on in your iPhone’s Settings.'); mTop()?.refresh(); return; }
  try{
    const reg = await navigator.serviceWorker.ready;
    const b64 = M_VAPID.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - M_VAPID.length % 4) % 4);
    const sub = (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(atob(b64), ch => ch.charCodeAt(0)) })).toJSON();
    const { error } = await supabaseClient.from('push_subscriptions').upsert({ user_id: currentUser.id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, user_agent: navigator.userAgent }, { onConflict: 'user_id,endpoint' });
    error ? showToast('error', 'Couldn’t turn on notifications', error.message) : showToast('success', 'Notifications are on', 'You’ll get them on this iPhone.');
  }catch(e){ showToast('error', 'Couldn’t turn on notifications', 'Open the app from your Home Screen and try again.'); }
  mTop()?.refresh();
}
function mOpenProfile(){
  mPush('Profile', () => {
    const me = myProfile || {};
    return `<div style="display:flex;flex-direction:column;align-items:center;margin-top:8px">${me.avatar_url ? `<img src="${safeUrl(me.avatar_url)}" alt="" style="width:84px;height:84px;border-radius:50%;object-fit:cover">` : avHtml(me.name || '?', 'style="width:84px;height:84px;font-size:30px"')}
<h1 style="font-size:24px;font-weight:700;margin:12px 0 2px">${mEsc(me.name || '')}</h1><div class="ikv">${mEsc(me.title || roleDisplayLabel(me.role))}</div></div>
<div class="ig" style="margin-top:22px">${mIr('', 'Email', '', mEsc(me.email || currentUser.email || ''), null, { n: true })}${me.phone ? mIr('', 'Phone', '', mEsc(me.phone), null, { n: true }) : ''}${mIr('', 'Role', '', roleDisplayLabel(me.role), null, { n: true })}</div>
<p class="ifoot">Change your name, photo or email in My Profile on the desktop.</p>`;
  });
}
function mOpenNotifications(){
  mPush('Notifications', () => `<h1 class="big">Notifications</h1>
<div class="ig" style="margin-top:16px">${notifications.map(n => mIr(`<span class="gl">${icon(typeof NOTIF_ICON !== 'undefined' && NOTIF_ICON[n.type] || 'bell')}</span>`, (n.read ? '' : '<span class="dot blue" style="display:inline-block;margin-right:6px;vertical-align:2px"></span>') + mEsc(n.title), mEsc(n.body || ''), `<span style="font-size:13px">${mWhen(n.created_at)}</span>`, `mNotifTap('${n.id}')`, { s2: true, noChev: true })).join('') || '<div class="ir"><span class="t n" style="color:var(--label-2)">You’re all caught up</span></div>'}</div>`,
  { right: notifications.some(n => !n.read) ? '<button onclick="mReadAll()">Read All</button>' : '' });
}
function mWhen(iso){ const d = new Date(iso), m = Math.round((Date.now() - d) / 60000); if(m < 60) return m < 1 ? 'now' : `${m}m`; const k = daysBetween(d, new Date()); return k === 0 ? fmtTime(d) : k === 1 ? 'Yesterday' : fmtShortDate(d); }
async function mReadAll(){ const ids = notifications.filter(n => !n.read).map(n => n.id); if(!ids.length) return; await supabaseClient.from('notifications').update({ read: true }).in('id', ids); notifications.forEach(n => n.read = true); mTop()?.refresh(); mRenderTab(); }
async function mNotifTap(id){
  const n = notifications.find(x => x.id === id); if(!n) return;
  if(!n.read){ n.read = true; supabaseClient.from('notifications').update({ read: true }).eq('id', id); }
  mPopAll();
  const v = n.target_view;
  if(v === 'client-detail' && n.target_id) mOpenClient(n.target_id);
  else if(v === 'teamqueue' || (v === 'approve' && n.type !== 'update_behind' && n.type !== 'draft_written')) mSwitchTab('review');
  else if(v === 'approve'){ mSwitchTab('today'); n.target_id ? mOpenClient(n.target_id) : mOpenWeek(); }
  else if(v === 'tasks') mSwitchTab('tasks');
  else if(v === 'reminders'){ mSwitchTab('more'); mOpenReminders(); }
  else if(v === 'calendar'){ mSwitchTab('more'); mOpenCalendar(); }
  else if(v === 'health'){ mSwitchTab('today'); mOpenClients('health'); }
  else mSwitchTab('today');
}
function mOpenFromHash(hash){
  const h = String(hash || '').replace(/^#\/?/, '');
  if(['today', 'tasks', 'review', 'more'].includes(h)){ if(mTab !== h || mStack.length) mSwitchTab(h); return; }
  const m = h.match(/^client\/(.+)$/);
  if(m){ mSwitchTab('today'); mOpenClient(decodeURIComponent(m[1])); return; }
  if(h === 'teamqueue') mSwitchTab('review');
  else if(h === 'approve'){ mSwitchTab('today'); mOpenWeek(); }
  else if(h === 'reminders'){ mSwitchTab('more'); mOpenReminders(); }
  else if(h === 'calendar'){ mSwitchTab('more'); mOpenCalendar(); }
  else if(h === 'health'){ mSwitchTab('today'); mOpenClients('health'); }
  else if(h === 'time' || h === 'timesheet'){ mSwitchTab('more'); mOpenTime(); }
  else if(h === 'focusreports'){ mSwitchTab('today'); }
  else if(h === 'notes'){ mSwitchTab('more'); mOpenNotes(); }
  else if(h === 'clients'){ mSwitchTab('more'); mOpenClients(); }
  else if(h === 'team'){ mSwitchTab('more'); mOpenTeam(); }
  else if(h === 'settings'){ mSwitchTab('more'); mOpenSettings(); }
  else if(h === 'home' || h === 'overview' || h === 'thisweek') mSwitchTab('today');
}
function mOpenSearch(){
  let q = '';
  mPush('Search', () => {
    const cl = q ? liveClients().filter(c => c.name.toLowerCase().includes(q)).slice(0, 8) : [];
    const ts = q ? mVisibleTasks().filter(t => t.status !== 'done' && t.title.toLowerCase().includes(q)).slice(0, 6) : [];
    const ns = q ? notes.filter(n => (n.title || '').toLowerCase().includes(q) || (n.text || '').toLowerCase().includes(q)).slice(0, 4) : [];
    return `<div class="isearch" style="margin-top:4px">${icon('magnifying-glass')}<input id="mSearchQ" placeholder="Clients, tasks and notes" value="${mEsc(q)}" oninput="mSearchQ(this.value)" autocapitalize="none" aria-label="Search"></div>
${cl.length ? mIsh('Clients') + `<div class="ig">${cl.map(c => mIr(monoHtml(c), mEsc(c.name) + focusMark(c), mEsc(c.service || ''), '', `mOpenClient('${c.id}')`)).join('')}</div>` : ''}
${ts.length ? mIsh('Tasks') + `<div class="ig">${ts.map(mTaskRow).join('')}</div>` : ''}
${ns.length ? mIsh('Notes') + `<div class="ig">${ns.map(n => mIr('', mEsc(n.title || 'Untitled note'), '', '', `mOpenNoteSheet('${n.id}')`, { n: true })).join('')}</div>` : ''}
${q && !cl.length && !ts.length && !ns.length ? `<div style="margin-top:20px">${mEmpty('No results', `Nothing matches “${mEsc(q)}”.`)}</div>` : ''}`;
  });
  window.mSearchQ = v => { q = v.toLowerCase(); const top = mTop(); top.refresh(); const i = $m('mSearchQ'); i.focus(); i.setSelectionRange(v.length, v.length); };
  setTimeout(() => $m('mSearchQ')?.focus(), 400);
}

// ---- sheets: log, task, reminder, note, event, timer ------------------------------------------
function mRowPick(label, valueText, onclick, set){ return `<button class="ir" onclick="${onclick}"><span class="ilab">${label}</span><span class="ival${set ? ' set' : ''}">${valueText}</span>${icon('caret-right', { cls: 'chev', weight: 'bold' })}</button>`; }
function mSw(id, on, label){ return `<button class="ios-sw${on ? ' on' : ''}" id="${id}" role="switch" aria-checked="${!!on}" aria-label="${mEsc(label)}" onclick="this.classList.toggle('on');this.setAttribute('aria-checked',this.classList.contains('on'))"></button>`; }
function mIsOn(id){ return !!$m(id)?.classList.contains('on'); }
function mClientName(id){ return clients.find(c => c.id === id)?.name || ''; }
// suggest: worth logging for first, with why (logSuggestions, week-health.js); the rest A to Z
function mPickClient(cur, cb, none, suggest){
  const all = waWorkable(liveClients(), cur).slice().sort((a, b) => a.name.localeCompare(b.name));
  const sug = suggest && typeof logSuggestions === 'function' ? logSuggestions(4).filter(x => all.includes(x.c)) : [];
  const first = new Set(sug.map(x => x.c.id));
  mPick('Client', [...(none ? [['', none]] : []), ...sug.map(x => [x.c.id, x.c.name, x.why]), ...all.filter(c => !first.has(c.id)).map(c => [c.id, c.name, c.service || ''])], cur, cb);
}
function mDayPick(title, cur, from, to, none, cb){ const opts = sheetDayOptions(from, to); if(from < 0) opts.reverse(); mPick(title, [...(none ? [['', none]] : []), ...opts], cur, cb); }

let mLog_ = {};
function mOpenLog(presetClientId){
  if(!waPresetOk(presetClientId)) return;
  let cid = presetClientId || (timerState.running ? timerState.clientId : '') || '';
  if(cid && !waCanWork(clients.find(x => x.id === cid))) cid = '';
  const c = clients.find(x => x.id === cid);
  mLog_ = { clientId: cid, service: c && c.service || (settings.serviceOptions || [])[0] || '', date: toDateStr(new Date()), useTimer: false };
  mHvClient(mLog_);
  mOpenSheet('Log Improvement', mLogBody(), { done: 'mSaveLog()', doneLabel: 'Log' });
}
function mLogBody(){
  const L = mLog_, lc = clients.find(x => x.id === L.clientId);
  // a client in Harvest buys its projects, so there's no service to pick (harvest-time.js)
  const svcRow = (lc ? serviceFromHarvest(lc) : harvestOwnsServices()) ? '' : mRowPick('Service', mEsc(L.service || 'None'), 'mLogPick(\'service\')', !!L.service);
  const dateLabel = L.date === toDateStr(new Date()) ? 'Today' : sheetDayLabel(new Date(L.date + 'T12:00:00'));
  return `<div class="ig flat" style="margin-top:12px">${mRowPick('Client', mEsc(mClientName(L.clientId) || 'Choose'), 'mLogPick(\'client\')', !!L.clientId)}</div>
<div class="ig flat" style="margin-top:20px"><div class="ir" style="align-items:flex-start"><textarea class="iarea" id="mLogText" placeholder="What did you do?" spellcheck="true" oninput="mKeep('mLogText',this.value)"></textarea></div></div>
<p class="ifoot">What you did, in a sentence the client would understand.</p>
<div class="ig flat" style="margin-top:20px">
${svcRow}
${mRowPick('Date', dateLabel, 'mLogPick(\'date\')', true)}
<div class="ir"><label class="ilab" for="mLogTime">Time spent</label><input class="tm" id="mLogTime" inputmode="decimal" placeholder="0:30" oninput="mKeep('mLogTime',this.value);mLog_.useTimer=false" onchange="mLogTimeSet()">${timerState.running ? `<button class="link" onclick="mLogUseTimer()">Use timer</button>` : ''}</div>
${hvTimeOn() && L.hasTime ? mHvRows(L, 'mLogPick') : ''}</div>${hvTimeOn() && L.hasTime && mHvBill(L) ? `<p class="ifoot">Time spent is ${mHvBill(L).toLowerCase()}.</p>` : ''}
<div class="ig flat" style="margin-top:20px"><div class="ir"><span class="ilab">Include in the client email</span>${mSw('mLogInclude', mLogIncOn(), 'Include in the client email')}</div></div>
<p class="ifoot">${lc && !getsUpdates(lc) ? `${mEsc(lc.name)} gets no weekly update, so its work stays internal.` : 'Turn off for internal work the client doesn’t need to hear about.'}</p>`;
}
// "Include in the client email" starts on, or off for a client with no weekly update (Nov 22). Once
// you flip it, it stays as you set it while you change the other rows.
function mLogIncDefault(){ const c = clients.find(x => x.id === mLog_.clientId); return !c || getsUpdates(c); }
function mLogIncOn(){ return mLog_.inc != null ? mLog_.inc : mLogIncDefault(); }
function mLogPick(what){
  const keepInc = mIsOn('mLogInclude');
  // flipped by hand: keep it; else follow the client (picking another client may change the default)
  mLog_.inc = keepInc !== mLogIncDefault() ? keepInc : null;
  const back = () => { const t = mSheetVal('mLogText'), tm = mSheetVal('mLogTime'); $m('mSheet').querySelector('.sheet-scroll').innerHTML = mLogBody(); $m('mLogText').value = t; $m('mLogTime').value = tm; };
  mKeep('mLogText', mSheetVal('mLogText')); mKeep('mLogTime', mSheetVal('mLogTime'));
  if(what === 'link'){ hvLinkClientToHarvest(mLog_.clientId).then(ok => { if(ok){ mHvClient(mLog_); back(); } }); return; }
  if(what === 'client') mPickClient(mLog_.clientId, v => { mLog_.clientId = v; const c = clients.find(x => x.id === v); if(c && c.service) mLog_.service = c.service; mHvClient(mLog_); back(); }, null, true);
  if(what === 'service') mPick('Service', [...new Set([mLog_.service, ...(settings.serviceOptions || [])].filter(Boolean))].map(s => [s, s]), mLog_.service, v => { mLog_.service = v; back(); });
  if(what === 'date') mDayPick('Date', mLog_.date, -13, 0, null, v => { mLog_.date = v; back(); });
  if(what === 'project' || what === 'task') mHvPick(mLog_, what, back);
}
// Time spent goes to Harvest by project and task: those rows show once there's time.
function mLogTimeSet(){
  const has = !!mSheetVal('mLogTime').trim();
  if(!hvTimeOn() || has === !!mLog_.hasTime) return;
  mLog_.hasTime = has;
  const keepInc = mIsOn('mLogInclude'), t = mSheetVal('mLogText'), tm = mSheetVal('mLogTime');
  mLog_.inc = keepInc !== mLogIncDefault() ? keepInc : null;
  $m('mSheet').querySelector('.sheet-scroll').innerHTML = mLogBody(); $m('mLogText').value = t; $m('mLogTime').value = tm;
}
function mLogUseTimer(){
  const m = Math.max(1, Math.round((Date.now() - timerState.startedAt) / 60000));
  $m('mLogTime').value = `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
  mLog_.useTimer = true;
  if(timerState.projectId && timerState.clientId === mLog_.clientId){ mLog_.projectId = timerState.projectId; mLog_.taskId = timerState.taskId; }
  mLogTimeSet();
  if(timerState.clientId && mLog_.clientId !== timerState.clientId){ mLog_.clientId = timerState.clientId; const t = mSheetVal('mLogText'), tm = mSheetVal('mLogTime'); $m('mSheet').querySelector('.sheet-scroll').innerHTML = mLogBody(); $m('mLogText').value = t || timerState.description || ''; $m('mLogTime').value = tm; mLog_.useTimer = true; }
  else if(!mSheetVal('mLogText').trim() && timerState.description) $m('mLogText').value = timerState.description;
}
async function mSaveLog(){
  const L = mLog_, text = mSheetVal('mLogText').trim(), raw = mSheetVal('mLogTime').trim();
  if(!L.clientId){ showToast('error', 'Choose a client', 'Tap Client to pick one.'); return; }
  if(!text){ showToast('error', 'Nothing to log', 'Write what you did first.'); $m('mLogText').focus(); return; }
  const minutes = raw ? parseSpent(raw) : 0;
  if(raw && !minutes){ showToast('error', 'Check the time', 'Try 0:30, 45m or 1h 30m.'); return; }
  const pick = minutes && hvTimeOn() ? mHvValue(L) : { ok: true, projectId: null, taskId: null };
  if(!pick.ok){ showToast('error', 'Almost there', pick.msg); return; }
  if(!(await okToLogDuplicate(L.clientId, text))) return;   // logged already? (data.js)
  const include = mIsOn('mLogInclude'), author = myName() || 'Team member';
  const btn = $m('mSheetDone'); if(btn) btn.disabled = true;
  const when = L.date === toDateStr(new Date()) ? new Date() : new Date(L.date + 'T12:00:00');
  const c = clients.find(x => x.id === L.clientId);
  const service = c && serviceFromHarvest(c) ? (pick.projectId ? pick.service : improvementServiceFor(c)) : L.service;
  const imp = await insertImprovementFull(L.clientId, { author, text, includeInEmail: include, source: 'manual', date: when.toISOString(), service });
  if(!imp){ if(btn) btn.disabled = false; showToast('error', 'Couldn’t save it', 'Try again in a moment.'); return; }
  // new work never wipes a draft (as on desktop): it shows as new since the draft, or goes in the next update
  if(minutes){
    if(L.useTimer && timerState.running && timerState.clientId === L.clientId){ timerState.service = pick.projectId ? pick.service : service; timerState.projectId = pick.projectId; timerState.taskId = pick.taskId; timerState.description = text; await mStopTimer(true, true, imp.id); }
    else await mAddTime({ clientId: L.clientId, service: pick.projectId ? pick.service : service, dateStr: L.date, minutes, description: text, logged: true, projectId: pick.projectId, taskId: pick.taskId, improvementId: imp.id });
  }
  mLog(L.clientId, 'improvement_logged', `${author} logged an improvement: "${text.slice(0, 80)}"`, `Logged an improvement for <b>${escapeHtml(c ? c.name : '')}</b>.`);
  mCloseSheet(true);
  await mRefresh();
  showToast('success', 'Improvement logged', `${c ? c.name : ''}${minutes ? ` · ${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')} on your timesheet` : ''}`);
}
// One entry per client, project, task and day (or client, service and day before Harvest), like
// the desktop timesheet. It goes to Harvest straight away, as the desktop does.
async function mAddTime({ clientId, service, dateStr, minutes, description, logged, projectId, taskId, improvementId }){
  // logged with a piece of work: its own entry, linked to it, as on the desktop (deleting either deletes both)
  if(improvementId){
    const { data, error } = await supabaseClient.from('time_entries').insert({ user_id: currentUser.id, client_id: clientId, entry_date: dateStr, minutes, description, service: service || '', logged: true,
      improvement_id: improvementId, ...(projectId ? { harvest_project_id: projectId, harvest_task_id: taskId || null } : {}) }).select('id').single();
    if(!error || !workColumnMissing(error, 'improvement_id')){ if(data && data.id) mSyncToHarvest(data.id); return data ? data.id : null; }
  }
  let q = supabaseClient.from('time_entries').select('id, minutes, description').eq('user_id', currentUser.id).eq('client_id', clientId).eq('entry_date', dateStr).is('deleted_at', null);
  q = projectId ? (taskId ? q.eq('harvest_project_id', projectId).eq('harvest_task_id', taskId) : q.eq('harvest_project_id', projectId).is('harvest_task_id', null)) : q.eq('service', service || '');
  const { data: rows } = await q.limit(1), ex = rows && rows[0];
  let id = null;
  if(ex){ const { error } = await supabaseClient.from('time_entries').update({ minutes: ex.minutes + minutes, description: [ex.description, description].filter(Boolean).join(' · '), harvest_sync_status: 'pending' }).eq('id', ex.id); id = error ? null : ex.id; }
  else {
    const { data } = await supabaseClient.from('time_entries').insert({ user_id: currentUser.id, client_id: clientId, entry_date: dateStr, minutes, description, service: service || '', ...(logged ? { logged: true } : {}),
      ...(projectId ? { harvest_project_id: projectId, harvest_task_id: taskId || null } : {}) }).select('id').single();
    id = data?.id || null;
  }
  if(id) mSyncToHarvest(id);
  return id;
}
function mSyncToHarvest(id){
  supabaseClient.auth.getSession().then(({ data: { session } }) => session && fetch('/api/integrations', { method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'harvest', action: 'sync-entry', timeEntryId: id }) }).catch(() => {}));
}
// ---- Project and Task, as in Harvest (js/features/harvest-time.js); Service until Harvest is set up
function mHvClient(st){ const d = hvDefaultPick(st.clientId); st.projectId = d.projectId; st.taskId = d.taskId; }
function mHvRows(st, pickFn){
  if(!hvTimeOn()) return mRowPick('Service', mEsc(st.service || 'None'), `${pickFn}('service')`, !!st.service);
  if(!st.clientId) return '';
  const none = hvNoPickWords(st.clientId);
  if(none){
    const fix = hvHarvestNameFor(st.clientId);
    return `<div class="ir"><span class="ilab">Project</span><span class="t n" style="white-space:normal;text-align:right;color:var(--label-2);font-size:15px">${mEsc(none)}</span></div>`
      + (!fix ? '' : canApprove() ? `<button class="ir mhv-link" onclick="${pickFn}('link')"><span class="t">${fix.rc && !clientInSetup(fix.rc) ? 'Link Here Instead…' : 'Link to Harvest…'}</span></button>`
        : hvAsked(st.clientId) ? '' : `<button class="ir mhv-link" onclick="hvAskApprovers(${mEsc(JSON.stringify(String(st.clientId)))}, null).then(ok => { if(ok) this.remove(); })"><span class="t">Ask an Approver</span></button>`);
  }
  const { mine } = hvClientProjects(st.clientId);
  const proj = mine.length === 1 ? `<div class="ir"><span class="ilab">Project</span><span class="t n" style="text-align:right">${mEsc(mine[0].name)}</span></div>`
    : mRowPick('Project', mEsc(hvProjectName(st.projectId) || 'Choose'), `${pickFn}('project')`, !!st.projectId);
  const t = st.projectId ? hvProjectTasks(st.projectId, st.taskId).find(x => x.id === Number(st.taskId)) : null;
  const task = st.projectId ? mRowPick('Task', t ? mEsc(t.name) : 'Choose', `${pickFn}('task')`, !!t) : '';
  return proj + task;
}
// "Billable" or "Non-billable" for the note under the rows (Harvest decides it by task)
function mHvBill(st){
  const t = hvTimeOn() && st.projectId ? hvProjectTasks(st.projectId, st.taskId).find(x => x.id === Number(st.taskId)) : null;
  return t ? (t.billable ? 'Billable' : 'Non-billable') : '';
}
function mHvPick(st, what, back){
  if(what === 'project') mPick('Project', hvClientProjects(st.clientId).mine.map(p => [String(p.harvest_id), p.name]), String(st.projectId || ''), v => { st.projectId = Number(v); st.taskId = (hvProjectTasks(st.projectId)[0] || {}).id || null; back(); });
  if(what === 'task') mPick('Task', hvProjectTasks(st.projectId, st.taskId).map(t => [String(t.id), t.name, t.billable ? 'Billable' : 'Non-billable']), String(st.taskId || ''), v => { st.taskId = Number(v); back(); });
}
function mHvValue(st){
  if(!hvTimeOn()) return { ok: true, service: st.service, projectId: null, taskId: null };
  if(!st.clientId || hvNoPickWords(st.clientId)) return { ok: true, service: '', projectId: null, taskId: null };
  if(!st.projectId) return { ok: false, msg: 'Tap Project to pick one.' };
  if(!st.taskId && hvProjectTasks(st.projectId, st.taskId).length) return { ok: false, msg: 'Tap Task to pick one.' };
  return { ok: true, service: hvProjectName(st.projectId), projectId: st.projectId, taskId: st.taskId || null };
}
function mOpenTimerSheet(){
  const cid = mTab === 'more' && mTop()?.title === 'Time' ? '' : '';
  mLog_ = { clientId: cid, service: (settings.serviceOptions || [])[0] || '' };
  const body = () => `<div class="ig flat" style="margin-top:12px">${mRowPick('Client', mEsc(mClientName(mLog_.clientId) || 'Choose'), "mTimerPick('client')", !!mLog_.clientId)}${mHvRows(mLog_, 'mTimerPick')}</div>${mHvBill(mLog_) ? `<p class="ifoot">${mHvBill(mLog_)}.</p>` : ''}
<div class="ig flat" style="margin-top:20px"><div class="ir"><input class="itf" id="mTimerDesc" placeholder="What are you working on?" oninput="mKeep('mTimerDesc',this.value)"></div></div>`;
  window.mTimerBody = body;
  mOpenSheet('Start Timer', body(), { done: 'mStartTimer()', doneLabel: 'Start' });
}
function mTimerPick(what){
  mKeep('mTimerDesc', mSheetVal('mTimerDesc'));
  const back = () => { const v = mSheetVal('mTimerDesc'); $m('mSheet').querySelector('.sheet-scroll').innerHTML = window.mTimerBody(); $m('mTimerDesc').value = v; };
  if(what === 'link'){ hvLinkClientToHarvest(mLog_.clientId).then(ok => { if(ok){ mHvClient(mLog_); back(); } }); return; }
  if(what === 'client') mPickClient(mLog_.clientId, v => { mLog_.clientId = v; const c = clients.find(x => x.id === v); if(c && c.service) mLog_.service = c.service; mHvClient(mLog_); back(); }, null, true);
  else if(what === 'project' || what === 'task') mHvPick(mLog_, what, back);
  else mPick('Service', settings.serviceOptions.map(s => [s, s]), mLog_.service, v => { mLog_.service = v; back(); });
}
function mStartTimer(){
  if(!mLog_.clientId){ showToast('error', 'Choose a client', 'Tap Client to pick one.'); return; }
  const pick = mHvValue(mLog_);
  if(!pick.ok){ showToast('error', 'Almost there', pick.msg); return; }
  timerState = { running: true, startedAt: Date.now(), clientId: mLog_.clientId, service: pick.service || '', description: mSheetVal('mTimerDesc').trim(), resumeEntryId: null, projectId: pick.projectId, taskId: pick.taskId };
  try{ localStorage.setItem('bda_timer_state', JSON.stringify(timerState)); }catch(e){}
  mCloseSheet(true); mRenderTab(); mTop()?.refresh(); mTickTimer();
  showToast('success', 'Timer started', mClientName(timerState.clientId));
}
// Time worked without the timer: client, service, day, how long, what.
let mTime_ = {};
function mOpenTimeSheet(presetClientId, preset){
  if(!waPresetOk(presetClientId)) return;
  preset = preset || {};
  const c = clients.find(x => x.id === presetClientId);
  mTime_ = { clientId: presetClientId || '', service: (c && c.service) || (settings.serviceOptions || [])[0] || '', date: preset.date || toDateStr(new Date()), work: false };
  mHvClient(mTime_);
  mKeep('mTimeDur', preset.minutes ? `${Math.floor(preset.minutes / 60)}:${String(preset.minutes % 60).padStart(2, '0')}` : ''); mKeep('mTimeDesc', preset.desc || '');
  window.mTimeBody = () => `<div class="ig flat" style="margin-top:12px">${mRowPick('Client', mEsc(mClientName(mTime_.clientId) || 'Choose'), "mTimePick('client')", !!mTime_.clientId)}${mHvRows(mTime_, 'mTimePick')}${mRowPick('Date', mTime_.date === toDateStr(new Date()) ? 'Today' : sheetDayLabel(new Date(mTime_.date + 'T12:00:00')), "mTimePick('date')", true)}
<div class="ir"><label class="ilab" for="mTimeDur">Time worked</label><input class="tm" id="mTimeDur" inputmode="decimal" placeholder="1:30" oninput="mKeep('mTimeDur',this.value)"></div></div>
<p class="ifoot">${mHvBill(mTime_) ? mHvBill(mTime_) + '. ' : ''}1:30, 45m or 1.5 all work.</p>
<div class="ig flat" style="margin-top:20px"><div class="ir" style="align-items:flex-start"><textarea class="iarea" id="mTimeDesc" placeholder="What did you work on?" style="min-height:72px" oninput="mKeep('mTimeDesc',this.value)"></textarea></div></div>
<div class="ig flat" style="margin-top:20px"><div class="ir"><span class="ilab">Log It as Work</span><button class="ios-sw${mTime_.work ? ' on' : ''}" id="mTimeWork" role="switch" aria-checked="${!!mTime_.work}" aria-label="Log it as work" onclick="mTime_.work=!mTime_.work;this.classList.toggle('on',mTime_.work);this.setAttribute('aria-checked',mTime_.work)"></button></div></div>
<p class="ifoot">What you worked on becomes an improvement in Queue, ready for the client update.</p>`;
  mOpenSheet('Add Time', window.mTimeBody(), { done: 'mSaveTime()', doneLabel: 'Add' });
  if(preset.minutes || preset.desc) mRestoreSheetState();   // a meeting's time, filled in (Nov 23)
}
function mTimePick(what){
  mKeep('mTimeDur', mSheetVal('mTimeDur')); mKeep('mTimeDesc', mSheetVal('mTimeDesc'));
  const back = () => { $m('mSheet').querySelector('.sheet-scroll').innerHTML = window.mTimeBody(); mRestoreSheetState(); };
  if(what === 'link'){ hvLinkClientToHarvest(mTime_.clientId).then(ok => { if(ok){ mHvClient(mTime_); back(); } }); return; }
  if(what === 'client') mPickClient(mTime_.clientId, v => { mTime_.clientId = v; const c = clients.find(x => x.id === v); if(c && c.service) mTime_.service = c.service; mHvClient(mTime_); back(); });
  if(what === 'project' || what === 'task') mHvPick(mTime_, what, back);
  if(what === 'service') mPick('Service', [...new Set([mTime_.service, ...(settings.serviceOptions || [])].filter(Boolean))].map(x => [x, x]), mTime_.service, v => { mTime_.service = v; back(); });
  if(what === 'date') mDayPick('Date', mTime_.date, -30, 0, null, v => { mTime_.date = v; back(); });
}
async function mSaveTime(){
  const T = mTime_, raw = mSheetVal('mTimeDur').trim(), minutes = parseSpent(raw), desc = mSheetVal('mTimeDesc').trim();
  if(!T.clientId){ showToast('error', 'Choose a client', 'Tap Client to pick one.'); return; }
  if(!minutes){ showToast('error', 'How long did you work?', 'Try 1:30, 45m or 1.5.'); $m('mTimeDur')?.focus(); return; }
  const pick = mHvValue(T);
  if(!pick.ok){ showToast('error', 'Almost there', pick.msg); return; }
  if(minutes > 16 * 60 && !(await confirmDialog(`That’s ${Math.floor(minutes / 60)} hours in one entry.`, { title: 'Log it anyway?', confirmLabel: 'Log It' }))) return;
  if(T.work && !desc){ showToast('error', 'Say what you worked on', 'That’s what shows in Queue.'); $m('mTimeDesc')?.focus(); return; }
  if(T.work && !(await okToLogDuplicate(T.clientId, desc))) return;   // logged already? (data.js)
  const btn = $m('mSheetDone'); if(btn) btn.disabled = true;
  // as work (Nov 23): the improvement first, then the time as its own entry, linked to it
  let imp = null;
  if(T.work){
    const c = clients.find(x => x.id === T.clientId), when = T.date === toDateStr(new Date()) ? new Date() : new Date(T.date + 'T12:00:00');
    imp = await insertImprovementFull(T.clientId, { author: myName() || 'Team member', text: desc, includeInEmail: true, source: 'time', date: when.toISOString(),
      service: c && serviceFromHarvest(c) ? (pick.projectId ? pick.service : improvementServiceFor(c)) : pick.service });
    if(!imp){ if(btn) btn.disabled = false; showToast('error', 'Couldn’t log it as work', 'Try again in a moment.'); return; }
  }
  const id = await mAddTime({ clientId: T.clientId, service: pick.service, dateStr: T.date, minutes, description: desc, projectId: pick.projectId, taskId: pick.taskId, logged: !!imp, improvementId: imp ? imp.id : null });
  if(!id){ if(btn) btn.disabled = false; showToast('error', 'Couldn’t add the time', 'Try again in a moment.'); return; }
  if(imp) mLog(T.clientId, 'improvement_logged', `${myName() || 'Team member'} logged an improvement: "${desc.slice(0, 80)}"`, `Logged an improvement for <b>${escapeHtml(mClientName(T.clientId))}</b>.`);
  mCloseSheet(true); await mRefresh();
  showToast('success', imp ? 'Time added and logged as work' : 'Time added', `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')} for ${mClientName(T.clientId)}${imp ? '; it’s in Queue' : ''}`);
}
async function mStopTimer(quiet, logged, improvementId){
  if(!timerState.running) return;
  const t = timerState, minutes = Math.max(1, Math.round((Date.now() - t.startedAt) / 60000));
  timerState = { running: false, startedAt: null, clientId: '', service: '', description: '', resumeEntryId: null };
  try{ localStorage.setItem('bda_timer_state', JSON.stringify(timerState)); }catch(e){}
  clearInterval(mTimerTick);
  const id = await mAddTime({ clientId: t.clientId, service: t.service, dateStr: toDateStr(new Date()), minutes, description: t.description, logged, projectId: t.projectId || null, taskId: t.taskId || null, improvementId: improvementId || null });
  if(!quiet){ await mRefresh(); showToast(id ? 'success' : 'error', id ? 'Time saved' : 'Couldn’t save the time', id ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')} for ${mClientName(t.clientId)}` : 'Add it on the desktop Timesheet.'); }
}

let mTask_ = {};
function mOpenTaskSheet(preset){
  preset = preset || {};
  mTask_ = { clientId: preset.clientId || '', assigneeId: preset.assigneeId || currentUser.id, due: preset.due || '', time: '', priority: preset.priority || 'medium', afterSave: preset.afterSave || null };
  mKeep('mTaskTitle', preset.title || ''); mKeep('mTaskNotes', preset.description || ''); mKeep('mTaskLink', preset.link || '');
  window._mTaskFiles = [];
  const body = () => {
    const T = mTask_, who = teamProfiles.find(p => p.id === T.assigneeId);
    return `<div class="ig flat" style="margin-top:12px"><div class="ir"><input class="itf" id="mTaskTitle" placeholder="Title" oninput="mKeep('mTaskTitle',this.value)"></div><div class="ir" style="align-items:flex-start"><textarea class="iarea" id="mTaskNotes" placeholder="Notes" style="min-height:64px" oninput="mKeep('mTaskNotes',this.value)"></textarea></div><div class="ir"><input class="itf" id="mTaskLink" type="url" inputmode="url" autocapitalize="none" autocorrect="off" placeholder="Link" oninput="mKeep('mTaskLink',this.value)"></div></div>
<div class="ig flat" style="margin-top:20px">${(window._mTaskFiles || []).map((f, i) => { const big = f.size > TASK_FILE_MAX; return `<div class="ir mtf"><span class="gl">${icon(/\.(png|jpe?g|gif|webp|heic|svg)$/i.test(f.name) ? 'image' : 'file-text')}</span><span class="t n">${mEsc(f.name)}</span><span class="r${big ? ' big' : ''}">${big ? 'Over 10 MB' : mFileSize(f.size)}</span><button type="button" class="mtf-rm" aria-label="Remove ${mEsc(f.name)}" onclick="mTaskFileDrop(${i})">Remove</button></div>`; }).join('')}<label class="ir tap mtf-add"><span class="gl">${icon('paperclip')}</span><span class="t n">Add Files</span><input type="file" multiple hidden onchange="mTaskFilesPicked(this.files);this.value=''"></label></div>
<div class="ig flat" style="margin-top:20px">
${mRowPick('Client', mEsc(mClientName(T.clientId) || 'None'), "mTaskPick('client')", !!T.clientId)}
${mRowPick('Assignee', mEsc(who ? (who.id === currentUser.id ? 'Me' : who.name) : 'Choose'), "mTaskPick('who')", true)}
${mRowPick('Due', T.due ? sheetDayLabel(new Date(T.due + 'T12:00:00')) : 'None', "mTaskPick('due')", !!T.due)}
${T.due ? mRowPick('Time', T.time ? fmtTime(atTime(new Date(), T.time)) : 'Any time', "mTaskPick('time')", !!T.time) : ''}
${mRowPick('Priority', { none: 'None', low: 'Low', medium: 'Medium', high: 'High' }[T.priority], "mTaskPick('pri')", true)}</div>`;
  };
  window.mTaskBody = body;
  mOpenSheet('New Task', body(), { done: 'mSaveTask()', doneLabel: 'Add' });
  mRestoreSheetState();
}
function mFileSize(n){ n = n || 0; return n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }
function mTaskFilesRedraw(){ mKeep('mTaskTitle', mSheetVal('mTaskTitle')); mKeep('mTaskNotes', mSheetVal('mTaskNotes')); mKeep('mTaskLink', mSheetVal('mTaskLink')); $m('mSheet').querySelector('.sheet-scroll').innerHTML = window.mTaskBody(); mRestoreSheetState(); }
function mTaskFilesPicked(list){ window._mTaskFiles = (window._mTaskFiles || []).concat([].slice.call(list || [])); mTaskFilesRedraw(); }
function mTaskFileDrop(i){ window._mTaskFiles.splice(i, 1); mTaskFilesRedraw(); }
function mTaskPick(what){
  mKeep('mTaskTitle', mSheetVal('mTaskTitle')); mKeep('mTaskNotes', mSheetVal('mTaskNotes')); mKeep('mTaskLink', mSheetVal('mTaskLink'));
  const back = () => { $m('mSheet').querySelector('.sheet-scroll').innerHTML = window.mTaskBody(); mRestoreSheetState(); };
  const T = mTask_;
  if(what === 'client') mPickClient(T.clientId, v => { T.clientId = v; back(); }, 'None');
  if(what === 'who') mPick('Assignee', teamProfiles.filter(p => !p.access_revoked).sort((a, b) => a.name.localeCompare(b.name)).map(p => [p.id, p.id === currentUser.id ? 'Me' : p.name]), T.assigneeId, v => { T.assigneeId = v; back(); });
  if(what === 'due') mDayPick('Due', T.due, 0, 30, 'None', v => { T.due = v; if(!v) T.time = ''; back(); });
  if(what === 'time') mPick('Time', taskTimeOptions(), T.time, v => { T.time = v; back(); });
  if(what === 'pri') mPick('Priority', [['none', 'None'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], T.priority, v => { T.priority = v; back(); });
}
async function mSaveTask(){
  const T = mTask_, title = mSheetVal('mTaskTitle').trim(), notesTxt = mSheetVal('mTaskNotes').trim();
  if(!title){ showToast('error', 'Add a title', ''); $m('mTaskTitle').focus(); return; }
  const linkTxt = mSheetVal('mTaskLink').trim();
  const url = linkTxt ? (/^https?:\/\//i.test(linkTxt) ? linkTxt : 'https://' + linkTxt) : (notesTxt.match(/https?:\/\/[^\s<>"]+/i) || [])[0];
  const { data, error } = await insertTaskRow({ title, description: notesTxt, priority: T.priority === 'none' ? null : T.priority, assigner_id: currentUser.id, assignee_id: T.assigneeId, client_id: T.clientId || null, due_date: T.due || null, link: url || null, status: 'todo' });
  if(error || !data){ showToast('error', 'Couldn’t add the task', error?.message || ''); return; }
  if(T.time) await setTaskDueTime(data.id, T.time);
  const files = window._mTaskFiles || [];
  const up = files.length ? await uploadTaskFiles(data.id, files) : { failed: [] };
  if(T.assigneeId !== currentUser.id){ const p = teamProfiles.find(x => x.id === T.assigneeId); mNotify(T.assigneeId, 'task_assigned', 'New task assigned to you', `${myName()}: "${title}"`, 'tasks'); }
  if(T.afterSave){ try{ await T.afterSave(data); }catch(e){} }   // e.g. a meeting's suggestion it came from
  mCloseSheet(true); await mRefresh();
  if(up.failed.length) showToast('error', 'Task added, files not attached', taskFilesError(up.failed));
  else showToast('success', T.assigneeId === currentUser.id ? 'Task added' : 'Task assigned', title);
}

let mRem_ = {};
function mOpenReminderSheet(){
  mRem_ = { clientId: '', mate: '', date: toDateStr(mWorkday(addDays(new Date(), 3))) };   // never a weekend
  mKeep('mRemQ', '');
  // Waiting on: a client, or a teammate (Nov 23; then the client is optional)
  window.mRemBody = () => { const m = mRem_.mate && teamProfiles.find(p => p.id === mRem_.mate);
    return `<div class="ig flat" style="margin-top:12px">${mRowPick('Waiting on', mEsc(m ? m.name : 'A client'), "mRemPick('who')", true)}${mRowPick(m ? 'Client (optional)' : 'Client', mEsc(mClientName(mRem_.clientId) || (m ? 'None' : 'Choose')), "mRemPick('client')", !!mRem_.clientId)}</div>
<div class="ig flat" style="margin-top:20px"><div class="ir" style="align-items:flex-start"><textarea class="iarea" id="mRemQ" placeholder="${m ? 'What are you waiting on from them?' : 'What are you waiting to hear back on?'}" oninput="mKeep('mRemQ',this.value)"></textarea></div></div>
<div class="ig flat" style="margin-top:20px">${mRowPick('Follow up', sheetDayLabel(new Date(mRem_.date + 'T12:00:00')), "mRemPick('date')", true)}<div class="ir"><span class="ilab">Add to my calendar</span>${mSw('mRemCal', true, 'Add to my calendar')}</div></div>`; };
  mOpenSheet('New Reminder', window.mRemBody(), { done: 'mSaveReminder()', doneLabel: 'Add' });
}
function mRemPick(what){
  mKeep('mRemQ', mSheetVal('mRemQ'));
  const back = () => { $m('mSheet').querySelector('.sheet-scroll').innerHTML = window.mRemBody(); mRestoreSheetState(); };
  if(what === 'client') mPickClient(mRem_.clientId, v => { mRem_.clientId = v; back(); }, mRem_.mate ? 'None' : null);
  else if(what === 'who') mPick('Waiting on', [['', 'A client'], ...teamProfiles.filter(p => p.id !== currentUser.id && !p.access_revoked).sort((a, b) => a.name.localeCompare(b.name)).map(p => [p.id, p.name, 'Teammate'])], mRem_.mate, v => { if(v != null){ mRem_.mate = v; if(v && mRem_.date === toDateStr(mWorkday(addDays(new Date(), 3)))) mRem_.date = toDateStr(mWorkday(addDays(new Date(), 1))); } back(); });
  else mDayPick('Follow up', mRem_.date, 0, 30, null, v => { mRem_.date = v; back(); });
}
async function mSaveReminder(){
  const q = mSheetVal('mRemQ').trim();
  if(!mRem_.clientId && !mRem_.mate){ showToast('error', 'Choose a client', ''); return; }
  if(!q){ showToast('error', 'Write the question first', ''); return; }
  const cal = mIsOn('mRemCal');
  const row = { client_id: mRem_.clientId || null, question: q, asked_by: currentUser.id, follow_up_date: mRem_.date, status: 'waiting' };
  if(mRem_.mate) row.waiting_on = mRem_.mate;
  const { data, error } = await supabaseClient.from('client_reminders').insert(row).select().single();
  if(error){ showToast('error', 'Couldn’t add it', mRem_.mate && /waiting_on|client_id|null value|schema cache/i.test(error.message || '') ? 'Reminders for a teammate need a one-time database update (addendum-teammate-reminders.sql).' : error.message); return; }
  const mt = mRem_.mate && teamProfiles.find(p => p.id === mRem_.mate);
  if(cal && data){ const c = clients.find(x => x.id === mRem_.clientId); await supabaseClient.from('calendar_events').insert({ title: mt ? `Follow up: ${firstName(mt.name)}${c ? ' (' + c.name + ')' : ''}` : c ? `Follow up: ${c.name}` : 'Client follow-up', description: q, start_at: `${mRem_.date}T00:00:00`, end_at: `${mRem_.date}T23:59:59`, all_day: true, client_id: mRem_.clientId || null, created_by: currentUser.id, event_type: 'reminder', related_reminder_id: data.id }); }
  mCloseSheet(true); await mRefresh(); showToast('success', 'Reminder added', `Follow up ${sheetDayLabel(new Date(mRem_.date + 'T12:00:00'))}.`);
}

let mNote_ = {};
function mOpenNoteSheet(id){
  const n = id ? notes.find(x => x.id === id) : null;
  mNote_ = { id: n ? n.id : null, clientId: n ? n.clientId : '', status: n ? n.status : 'idea' };
  mKeep('mNoteTitle', n ? n.title || '' : ''); mKeep('mNoteText', n ? n.text || '' : '');
  window.mNoteBody = () => `<div class="ig flat" style="margin-top:12px"><div class="ir"><input class="itf" id="mNoteTitle" placeholder="Title" oninput="mKeep('mNoteTitle',this.value)"></div><div class="ir" style="align-items:flex-start"><textarea class="iarea" id="mNoteText" placeholder="An idea, a plan, something to try" style="min-height:140px" oninput="mKeep('mNoteText',this.value)"></textarea></div></div>
<div class="ig flat" style="margin-top:20px">${mRowPick('Client', mEsc(mClientName(mNote_.clientId) || 'Choose'), "mNotePick('client')", !!mNote_.clientId)}${mRowPick('Status', { idea: 'Idea', planned: 'Planned', 'in-progress': 'In progress', done: 'Done' }[mNote_.status] || 'Idea', "mNotePick('status')", true)}</div>
${mNote_.id ? `<div class="ig flat" style="margin-top:28px">${mIr('', '<span style="color:var(--red)">Delete Note</span>', '', '', `mDeleteNote('${mNote_.id}')`, { n: true, noChev: true })}</div>` : ''}`;
  mOpenSheet(n ? 'Note' : 'New Note', window.mNoteBody(), { done: 'mSaveNote()', doneLabel: n ? 'Save' : 'Add' });
  mRestoreSheetState();
}
function mNotePick(what){
  mKeep('mNoteTitle', mSheetVal('mNoteTitle')); mKeep('mNoteText', mSheetVal('mNoteText'));
  const back = () => { $m('mSheet').querySelector('.sheet-scroll').innerHTML = window.mNoteBody(); mRestoreSheetState(); };
  if(what === 'client') mPickClient(mNote_.clientId, v => { mNote_.clientId = v; back(); });
  else mPick('Status', [['idea', 'Idea'], ['planned', 'Planned'], ['in-progress', 'In progress'], ['done', 'Done']], mNote_.status, v => { mNote_.status = v; back(); });
}
async function mSaveNote(){
  const title = mSheetVal('mNoteTitle').trim(), text = mSheetVal('mNoteText').trim();
  if(!mNote_.clientId){ showToast('error', 'Choose a client', 'Notes belong to a client.'); return; }
  if(!title && !text){ showToast('error', 'Write something first', ''); return; }
  const row = { title, text, client_id: mNote_.clientId, status: mNote_.status, updated_at: new Date().toISOString() };
  const { error } = mNote_.id ? await supabaseClient.from('notes').update(row).eq('id', mNote_.id).eq('user_id', currentUser.id) : await supabaseClient.from('notes').insert({ ...row, user_id: currentUser.id });
  if(error){ showToast('error', 'Couldn’t save the note', error.message); return; }
  mCloseSheet(true); await mRefresh(); showToast('success', mNote_.id ? 'Saved' : 'Note added', title);
}
async function mDeleteNote(id){
  if(!(await confirmDialog('You can restore it from Recently Deleted.', { title: 'Delete this note?', confirmLabel: 'Delete', danger: true }))) return;
  await supabaseClient.from('notes').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('user_id', currentUser.id);
  mCloseSheet(true); await mRefresh(); showToast('success', 'Moved to Recently Deleted', '');
}

let mEv_ = {};
function mOpenEventSheet(){
  const n = new Date(), m = Math.min(Math.ceil((n.getHours() * 60 + n.getMinutes() + 1) / 30) * 30, 22 * 60 + 30);
  const f = x => String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0');
  mEv_ = { date: toDateStr(n), start: f(m), end: f(Math.min(m + 60, 23 * 60 + 45)), allDay: false, clientId: '', type: 'meeting' };
  mKeep('mEvTitle', ''); mKeep('mEvLoc', '');
  window.mEvBody = () => `<div class="ig flat" style="margin-top:12px"><div class="ir"><input class="itf" id="mEvTitle" placeholder="Title" oninput="mKeep('mEvTitle',this.value)"></div><div class="ir"><input class="itf" id="mEvLoc" placeholder="Location or video call" oninput="mKeep('mEvLoc',this.value)"></div></div>
<div class="ig flat" style="margin-top:20px"><div class="ir"><span class="ilab">All-day</span><button class="ios-sw${mEv_.allDay ? ' on' : ''}" role="switch" aria-checked="${mEv_.allDay}" aria-label="All-day" onclick="mEv_.allDay=!mEv_.allDay;mEvRedraw()"></button></div>
${mRowPick('Date', sheetDayLabel(new Date(mEv_.date + 'T12:00:00')), "mEvPick('date')", true)}
${mEv_.allDay ? '' : mRowPick('Starts', fmtTime(atTime(new Date(), mEv_.start)), "mEvPick('start')", true) + mRowPick('Ends', fmtTime(atTime(new Date(), mEv_.end)), "mEvPick('end')", true)}</div>
<div class="ig flat" style="margin-top:20px">${mRowPick('Type', CALENDAR_TYPES[mEv_.type], "mEvPick('type')", true)}${mRowPick('Client', mEsc(mClientName(mEv_.clientId) || 'None'), "mEvPick('client')", !!mEv_.clientId)}</div>`;
  mOpenSheet('New Event', window.mEvBody(), { done: 'mSaveEvent()', doneLabel: 'Add' });
}
const CALENDAR_TYPES = { meeting: 'Meeting', deadline: 'Deadline', reminder: 'Reminder', other: 'Other' };
function mEvRedraw(){ mKeep('mEvTitle', mSheetVal('mEvTitle')); mKeep('mEvLoc', mSheetVal('mEvLoc')); $m('mSheet').querySelector('.sheet-scroll').innerHTML = window.mEvBody(); mRestoreSheetState(); }
function mEvPick(what){
  mKeep('mEvTitle', mSheetVal('mEvTitle')); mKeep('mEvLoc', mSheetVal('mEvLoc'));
  const back = () => mEvRedraw(), E = mEv_;
  if(what === 'date') mDayPick('Date', E.date, 0, 30, null, v => { E.date = v; back(); });
  if(what === 'start') mPick('Starts', sheetTimeOpts(E.start), E.start, v => { const toM = x => +x.slice(0, 2) * 60 + +x.slice(3); const len = Math.max(15, toM(E.end) - toM(E.start)); E.start = v; const e = Math.min(toM(v) + len, 23 * 60 + 45); E.end = String(Math.floor(e / 60)).padStart(2, '0') + ':' + String(e % 60).padStart(2, '0'); back(); });
  if(what === 'end') mPick('Ends', sheetTimeOpts(E.end), E.end, v => { E.end = v; back(); });
  if(what === 'type') mPick('Type', Object.entries(CALENDAR_TYPES), E.type, v => { E.type = v; back(); });
  if(what === 'client') mPickClient(E.clientId, v => { E.clientId = v; back(); }, 'None');
}
async function mSaveEvent(){
  const E = mEv_, title = mSheetVal('mEvTitle').trim();
  if(!title){ showToast('error', 'Add a title', ''); return; }
  const [y, mo, d] = E.date.split('-').map(Number);
  const at = hh => { const [h, m] = hh.split(':').map(Number); return new Date(y, mo - 1, d, h, m).toISOString(); };
  const start = E.allDay ? new Date(y, mo - 1, d, 0, 0).toISOString() : at(E.start), end = E.allDay ? new Date(y, mo - 1, d, 23, 59, 59).toISOString() : at(E.end);
  if(new Date(end) <= new Date(start)){ showToast('error', 'It ends before it starts', 'Check the times.'); return; }
  const { error } = await supabaseClient.from('calendar_events').insert({ title, location: mSheetVal('mEvLoc').trim() || null, start_at: start, end_at: end, all_day: E.allDay, client_id: E.clientId || null, created_by: currentUser.id, event_type: E.type, attendee_ids: [currentUser.id] });
  if(error){ showToast('error', 'Couldn’t add the event', error.message); return; }
  mCloseSheet(true); await mRefresh(); showToast('success', 'Event added', title);
}

// ---- start -----------------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  try{ document.body.dataset.theme = resolvedTheme(localStorage.getItem('bda_theme') || 'auto'); }catch(e){}
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if(myProfile) mApplyTheme(); });
  mBoot();
});
