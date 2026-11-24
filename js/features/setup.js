// Set Up Radar (Nov 24): everything that's yours to connect, one step at a time, without going to
// Settings. It opens by itself the first time someone signs in (team_profiles.setup_done_at is empty,
// addendum-setup.sql), and anytime from the menu under your name or Settings → Connections.
// Steps: notifications on this computer, Slack as you, Google Calendar, Gmail, the Gmail label, ChatGPT
// and Claude, and (members) who gets your daily summary. Each says what it does, connects in place, and
// can be skipped. Google and Slack send you back to #setup/<step>, where it carries on.

const SETUP_STEPS = [
  { k: 'welcome', name: 'Welcome' },
  { k: 'notify', name: 'Notifications' },
  { k: 'slack', name: 'Slack' },
  { k: 'calendar', name: 'Google Calendar' },
  { k: 'gmail', name: 'Gmail' },
  { k: 'label', name: 'Gmail label' },
  { k: 'ai', name: 'ChatGPT and Claude' },
  { k: 'summary', name: 'Daily summary', only: () => typeof canApprove === 'function' && !canApprove() },
  { k: 'done', name: 'All set' },
];
let suAt = 'welcome', suPush = null, suGcal = null, suLoading = false;
let suSkipped = (() => { try{ return new Set(JSON.parse(sessionStorage.getItem('setup-skipped') || '[]')); }catch(e){ return new Set(); } })();
function suSaveSkipped(){ try{ sessionStorage.setItem('setup-skipped', JSON.stringify([...suSkipped])); }catch(e){} }
function setupSteps(){ return SETUP_STEPS.filter(s => !s.only || s.only()); }
const suFirst = () => { const n = (myProfile && myProfile.name) || ''; return typeof firstName === 'function' ? firstName(n) : n.split(' ')[0]; };

// ---- opening and closing ---------------------------------------------------------------------------
// The first time someone signs in: unless they said later (this session), or Google or Slack is
// sending them somewhere else right now.
function setupMaybeOpen(){
  if(!myProfile || !('setup_done_at' in myProfile) || myProfile.setup_done_at) return;
  try{ if(sessionStorage.getItem('setup-later')) return; }catch(e){}
  if(/=/.test(location.hash) || /^#setup/.test(location.hash)) return;
  setupOpen('welcome');
}
function setupOpen(step){
  const steps = setupSteps();
  suAt = steps.some(s => s.k === step) ? step : (suAt && steps.some(s => s.k === suAt) && document.getElementById('setupRoot') ? suAt : 'welcome');
  let root = document.getElementById('setupRoot');
  const fresh = !root;
  if(fresh){
    root = document.createElement('div');
    root.id = 'setupRoot'; root.className = 'su';
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'suTitle');
    root.innerHTML = `<div class="su-card"><aside class="su-rail" aria-label="Steps"></aside><section class="su-main"><div class="su-pane" id="suPane"></div><footer class="su-foot" id="suFoot"></footer></section></div>`;
    document.body.appendChild(root);
    document.addEventListener('keydown', suKeydown, true);   // Escape and Tab wherever focus is, while it's open
  }
  suHash();
  setupRender(0);
  if(fresh) setTimeout(() => suFocusMain(), 60);
  setupRefresh();
}
function suHash(){ const h = suAt === 'welcome' ? '#setup' : `#setup/${suAt}`; if(location.hash !== h) history.replaceState(null, '', h); }
function setupClose(){
  const root = document.getElementById('setupRoot'); if(!root) return;
  root.id = ''; root.classList.add('is-out');
  document.removeEventListener('keydown', suKeydown, true);
  const done = () => root.remove();
  if(matchMedia('(prefers-reduced-motion: reduce)').matches) done(); else setTimeout(done, 200);
  if(/^#setup/.test(location.hash)) history.replaceState(null, '', typeof routeHashFor === 'function' && typeof currentViewName !== 'undefined' ? routeHashFor(currentViewName) : '#');
}
// Finish later: it doesn't open by itself again this session (it does next time, until it's done)
function setupLater(){
  try{ sessionStorage.setItem('setup-later', '1'); }catch(e){}
  setupClose();
  if(myProfile && !myProfile.setup_done_at) showToast('info', 'Set up the rest anytime', 'It’s in the menu under your name: Set Up Radar.');
}
async function setupFinish(tour){
  const at = new Date().toISOString();
  if(myProfile && 'setup_done_at' in myProfile && !myProfile.setup_done_at){
    const { error } = await supabaseClient.from('team_profiles').update({ setup_done_at: at }).eq('id', currentUser.id);
    if(!error) myProfile.setup_done_at = at;
  }
  try{ sessionStorage.removeItem('setup-skipped'); sessionStorage.removeItem('setup-later'); }catch(e){}
  suSkipped = new Set();
  setupClose();
  if(tour && typeof startTour === 'function') setTimeout(() => startTour(), 260);
  else showToast('success', 'You’re set up', 'Change any of it in Settings → Connections.');
}
function suKeydown(e){
  if(!document.getElementById('setupRoot') || document.getElementById('appModalOverlay')) return;   // a sheet on top handles its own keys
  if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); setupLater(); return; }
  if(e.key === 'Tab'){   // keep the keyboard inside the setup
    const root = document.getElementById('setupRoot'); if(!root) return;
    const f = [...root.querySelectorAll('button:not([disabled]), a[href], input, [tabindex]:not([tabindex="-1"])')].filter(el => el.offsetParent !== null);
    if(!f.length) return;
    if(e.shiftKey && document.activeElement === f[0]){ e.preventDefault(); f[f.length - 1].focus(); }
    else if(!e.shiftKey && document.activeElement === f[f.length - 1]){ e.preventDefault(); f[0].focus(); }
  }
}
function suFocusMain(){ const b = document.querySelector('#suFoot .btn-p') || document.querySelector('#suFoot .btn'); if(b) b.focus({ preventScroll: true }); }

// ---- where each thing stands -----------------------------------------------------------------------
async function suPushState(){
  if(!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') return 'unsupported';
  if(Notification.permission === 'denied') return 'blocked';
  try{
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((_, no) => setTimeout(() => no(new Error('slow')), 4000))]);
    const sub = await reg.pushManager.getSubscription(); if(!sub) return 'off';
    const { data } = await supabaseClient.from('push_subscriptions').select('id').eq('endpoint', sub.endpoint).maybeSingle();
    return data ? 'on' : 'off';
  }catch(e){ return 'off'; }
}
async function setupRefresh(){
  suLoading = true;
  const jobs = [
    suPushState().then(x => { suPush = x; }),
    typeof remSlackMeStatus === 'function' ? remSlackMeStatus(true).catch(() => {}) : null,
    typeof fetchGoogleCalendarStatus === 'function' ? fetchGoogleCalendarStatus().then(g => { suGcal = g || { connected: false, googleConfigured: false }; }).catch(() => { suGcal = { connected: false }; }) : null,
    typeof gmailStatusLoad === 'function' ? gmailStatusLoad().catch(() => {}) : null,
    typeof loadAiApps === 'function' ? loadAiApps().catch(() => {}) : null,
  ].filter(Boolean);
  // each piece shows as soon as it's known
  jobs.forEach(j => j.then(() => { if(document.getElementById('setupRoot')) setupRender(null); }));
  await Promise.all(jobs);
  suLoading = false;
  if(document.getElementById('setupRoot')) setupRender(null);
}
// 'done' (connected), 'off' (yours to do), 'na' (not set up for the team yet), null (checking)
function suStatus(k){
  const sm = typeof slackMe !== 'undefined' && slackMe && !slackMe.checking ? slackMe : null;
  const gm = typeof gmailState !== 'undefined' ? gmailState : null;
  const ai = typeof aiAppsState !== 'undefined' ? aiAppsState : null;
  if(k === 'notify') return suPush == null ? null : suPush === 'on' ? 'done' : suPush === 'unsupported' ? 'na' : 'off';
  if(k === 'slack') return !sm ? null : sm.connected ? 'done' : (sm.configured === false || sm.needsSetup) ? 'na' : 'off';
  if(k === 'calendar') return !suGcal ? null : suGcal.connected ? 'done' : suGcal.googleConfigured === false ? 'na' : 'off';
  if(k === 'gmail') return !gm ? null : gm.connected ? 'done' : (gm.needsSetup || gm.configured === false) ? 'na' : 'off';
  if(k === 'label'){ if(!gm) return null; const l = gm.label || {}; return l.on ? 'done' : l.needsSetup ? 'na' : 'off'; }
  if(k === 'ai') return !ai || ai.ready == null ? null : (ai.grants || []).length ? 'done' : ai.ready ? 'off' : 'na';
  if(k === 'summary') return myProfile && myProfile.daily_summary_slack_id && myProfile.daily_summary_slack_id !== myProfile.slack_user_id ? 'done' : 'off';
  return null;
}

// ---- drawing ----------------------------------------------------------------------------------------
function setupRender(dir){
  const root = document.getElementById('setupRoot'); if(!root) return;
  const steps = setupSteps(), i = Math.max(0, steps.findIndex(s => s.k === suAt)), step = steps[i];
  const rail = root.querySelector('.su-rail');
  const counted = steps.filter(s => s.k !== 'welcome' && s.k !== 'done');
  rail.innerHTML = `<div class="su-brand"><span class="brand-mark" aria-hidden="true">BA</span><b>Set Up Radar</b></div>
<ol class="su-steps">${steps.map((s, n) => { const st = suStatus(s.k), on = s.k === suAt;
    const mark = s.k === 'welcome' || s.k === 'done' ? icon(s.k === 'done' ? 'check' : 'compass') : st === 'done' ? icon('check') : (suSkipped.has(s.k) || st === 'na') ? icon('minus') : String(counted.indexOf(s) + 1);
    const cls = (on ? ' is-on' : '') + (st === 'done' ? ' is-done' : '') + ((suSkipped.has(s.k) || st === 'na') && st !== 'done' ? ' is-skip' : '');
    return `<li><button class="su-st${cls}" onclick="setupGo('${s.k}')"${on ? ' aria-current="step"' : ''}><span class="su-n" aria-hidden="true">${mark}</span><span class="su-sn">${escapeHtml(s.name)}</span>${st === 'done' && s.k !== 'done' ? '<span class="sr-only">, done</span>' : ''}</button></li>`; }).join('')}</ol>
<button class="su-later" onclick="setupLater()">Finish Later</button>`;
  const pane = document.getElementById('suPane'), foot = document.getElementById('suFoot');
  const html = suStepHtml(step, i, counted);
  // the same step, redrawn as its status comes in: only what changed, no movement
  if(dir === null && pane.dataset.k === step.k){ if(pane.innerHTML !== html.body) pane.innerHTML = html.body; foot.innerHTML = html.foot; return; }
  pane.dataset.k = step.k;
  pane.innerHTML = html.body; foot.innerHTML = html.foot;
  pane.scrollTop = 0;
  if(dir && !matchMedia('(prefers-reduced-motion: reduce)').matches){
    pane.animate([{ opacity: 0, transform: `translateX(${dir * 14}px)` }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.23,1,.32,1)' });
  }
}
// One step: { body, foot }
function suStepHtml(step, i, counted){
  const st = suStatus(step.k), k = step.k, n = counted.indexOf(step) + 1;
  const head = (logo, title, why) => `${n ? `<p class="su-of">Step ${n} of ${counted.length}</p>` : ''}<div class="su-h">${logo}<h2 id="suTitle">${title}</h2></div>${why ? `<p class="su-why">${why}</p>` : ''}`;
  const got = list => `<ul class="su-get">${list.map(t => `<li>${icon('check')}<span>${t}</span></li>`).join('')}</ul>`;
  const state = (tone, text) => `<p class="su-state is-${tone}"><span class="dot ${tone === 'ok' ? 'green' : 'hollow'}"></span><span>${text}</span></p>`;
  const checking = st == null ? state('wait', 'Checking…') : '';
  const back = i > 0 ? `<button class="btn" onclick="setupBack()">Back</button>` : '';
  const foot = (primary, skip) => `${back}<span class="su-gap"></span>${skip && st !== 'done' ? `<button class="btn btn-q su-skip" onclick="setupSkip()">Skip</button>` : ''}${primary}`;
  const next = label => `<button class="btn btn-p" onclick="setupNext()">${label || 'Continue'}</button>`;
  let body = '', f = '';
  if(k === 'welcome'){
    const logos = [['notify', suGlyph('bell')], ['slack', appLogo('slack')], ['calendar', appLogo('gcalendar')], ['gmail', appLogo('gmail')], ['ai', appLogoPair('chatgpt', 'claude')]];
    body = `<div class="su-hello"><div class="su-logos" aria-hidden="true">${logos.map(([, l]) => l).join('')}</div>
<h2 id="suTitle">Welcome to Radar${suFirst() ? ', ' + escapeHtml(suFirst()) : ''}</h2>
<p class="su-why">Connect the apps you work in, so Radar brings your meetings, your clients’ emails and your team’s nudges to one place, and reaches you where you are.</p>
<p class="su-note">About five minutes. Skip anything you like; it’s all in Settings → Connections later.</p></div>`;
    f = foot(next('Get Started'), false);
  } else if(k === 'notify'){
    body = head(suGlyph('bell'), 'Notifications on this computer', 'So you hear about what needs you, even when Radar isn’t open.') + got(['A task given to you, or one past its date', 'A client waiting on you, and drafts to review', 'Nudges from teammates']) +
      (checking || (st === 'done' ? state('ok', 'On for this computer.')
        : suPush === 'blocked' ? state('off', 'This browser is blocking notifications from Radar. Allow them from the icon at the left of the address bar, then come back here.')
        : st === 'na' ? state('off', 'This browser can’t show notifications. You’ll still see everything in the bell in Radar.') : ''));
    f = foot(st === 'off' && suPush !== 'blocked' ? `<button class="btn btn-p" onclick="suPushOn()">${icon('bell')}Turn On</button>` : next(), true);
  } else if(k === 'slack'){
    body = head(appLogo('slack', 'xl'), 'Slack, as you', 'Messages you send teammates from Radar go from your own Slack, as you, not from the Radar bot.') + got(['Nudges and reminders to teammates, with a link to the item', 'Your daily summary, when it goes to someone', 'Radar only sends what you send; it doesn’t read your Slack']) +
      (checking || (st === 'done' ? state('ok', 'Connected.') : st === 'na' ? state('off', isAdmin() ? 'Slack sign-in isn’t set up for the team yet. It takes a few minutes in Slack’s app settings.' : 'An admin sets up Slack sign-in for the team first. You can connect later in Settings → Connections.') : ''));
    f = foot(st === 'off' ? `<button class="btn btn-p" onclick="suSlack()">Connect Slack…</button>` : st === 'na' && isAdmin() ? `<button class="btn" onclick="slackMeSetupSheet()">Set Up for the Team…</button>${next()}` : next(), true);
  } else if(k === 'calendar'){
    body = head(appLogo('gcalendar', 'xl'), 'Google Calendar', 'Your meetings show in Radar’s calendar, beside the team’s deadlines and weekly sends, and stay current on their own.') + got(['Your meetings on Today and in Calendar', 'Meetings with clients next to their work', 'Read only: Radar doesn’t change your calendar']) +
      (checking || (st === 'done' ? state('ok', 'Connected.') : st === 'na' ? state('off', 'Google sign-in isn’t set up for the team yet. An admin adds it once.') : ''));
    f = foot(st === 'off' ? `<button class="btn btn-p" onclick="suCalendar()">Connect Google Calendar…</button>` : next(), true);
  } else if(k === 'gmail'){
    const g = (typeof gmailState !== 'undefined' && gmailState) || {};
    body = head(appLogo('gmail', 'xl'), 'Gmail', 'Radar reads new emails from your clients and suggests what they ask for as tasks, with a link back to the email.') + got(['Only your clients’ emails are opened; nothing else is read', 'Read only: Radar can’t send, delete or change anything', 'Suggestions wait in Tasks for you to add or dismiss']) +
      (checking || (st === 'done' ? state('ok', `Connected${g.email ? ' as ' + escapeHtml(g.email) : ''}.`) : st === 'na' ? state('off', g.needsSetup ? (isAdmin() ? 'Run addendum-gmail.sql in Supabase first.' : 'An admin finishes setting this up first.') : 'Google sign-in isn’t set up for the team yet.') : ''));
    f = foot(st === 'off' ? `<button class="btn btn-p" onclick="suGmail()">Connect Gmail…</button>` : next(), true);
  } else if(k === 'label'){
    const key = typeof gmailLabelKeyNow !== 'undefined' ? gmailLabelKeyNow : null;
    body = head(suGlyph('tag'), 'Gmail label “Radar”', 'For any other email you want in Radar: label it “Radar” and it becomes a task within 5 minutes. A small script in your Google account sends only the emails you label.') +
      (key ? `<div class="su-script">${gmailLabelStepsHtml(key)}</div>`
        : checking || (st === 'done' ? state('ok', 'Your script is set up. Label an email “Radar” to try it.') : st === 'na' ? state('off', isAdmin() ? 'Run addendum-gmail-label.sql in Supabase first.' : 'An admin finishes setting this up first.')
        : got(['You choose exactly which emails go in', 'Works for anyone’s email, not just clients’', 'Set up once, in about two minutes'])));
    f = foot(key ? next('I’ve Set It Up') : st === 'off' ? `<button class="btn btn-p" id="suLabelGo" onclick="suLabel()">Get My Script</button>` : next(), true);
  } else if(k === 'ai'){
    body = head(appLogoPair('chatgpt', 'claude', 'xl'), 'ChatGPT and Claude', 'Ask ChatGPT or Claude about your clients, tasks and hours, and have it add tasks, add follow-ups or log time, as you.') +
      `<div class="su-ai" id="aiAppsBox">${typeof aiAppsInner === 'function' ? aiAppsInner() : ''}</div>`;
    f = foot(next(st === 'done' ? 'Continue' : 'Continue'), true);
  } else if(k === 'summary'){
    const rank = p => p.role === 'admin' ? 2 : p.role === 'approver' ? 1 : 0;
    const people = (teamProfiles || []).filter(p => p.id !== currentUser.id && !p.access_revoked && p.slack_user_id).sort((a, b) => rank(b) - rank(a) || String(a.name).localeCompare(String(b.name)));
    const cur = myProfile && myProfile.daily_summary_slack_id;
    const role = p => p.role === 'admin' ? 'Admin' : p.role === 'approver' ? 'Approver' : '';
    body = head(suGlyph('clipboard-text'), 'Your daily summary', 'At the end of the day, send what you worked on, client by client, from Timesheet’s Today card. Who should get it?') +
      (people.length ? `<div class="ds-pk su-pk" role="radiogroup" aria-label="Who gets your daily summary">${people.map(p => `<button role="radio" aria-checked="${cur === p.slack_user_id}" onclick="suSummaryPick('${p.id}')"><span class="ck"></span><span>${escapeHtml(p.name)}</span><span class="r">${role(p)}</span></button>`).join('')}</div>`
        : state('off', 'Nobody on the team has Slack linked in Radar yet. You can choose later, on Timesheet.'));
    f = foot(next(), true);
  } else {
    const rows = counted.map(s => { const x = suStatus(s.k);
      return `<li class="${x === 'done' ? 'is-done' : ''}">${x === 'done' ? icon('check') : icon('minus')}<span><b>${escapeHtml(s.name)}</b>${x === 'done' ? '' : `<span>${x === 'na' ? 'Not set up for the team yet' : 'Skipped. It’s in Settings → Connections'}</span>`}</span></li>`; }).join('');
    const doneN = counted.filter(s => suStatus(s.k) === 'done').length;
    body = `<div class="su-hello su-end"><div class="su-badge" aria-hidden="true">${icon('check')}</div><h2 id="suTitle">${doneN === counted.length ? 'You’re all set' : 'You’re ready to go'}</h2>
<p class="su-why">${doneN ? `${doneN} of ${counted.length} connected.` : 'Nothing connected yet.'} Anything you skipped is waiting in Settings → Connections.</p><ul class="su-sum">${rows}</ul></div>`;
    f = `${back}<span class="su-gap"></span><button class="btn" onclick="setupFinish(true)">Take the Tour</button><button class="btn btn-p" onclick="setupFinish(false)">Start Using Radar</button>`;
  }
  return { body, foot: f };
}
function suGlyph(name){ return `<span class="app-logo is-glyph su-glyph" aria-hidden="true">${icon(name)}</span>`; }

// ---- moving between steps --------------------------------------------------------------------------
function setupGo(k, dir){
  const steps = setupSteps(), from = steps.findIndex(s => s.k === suAt), to = steps.findIndex(s => s.k === k);
  if(to < 0) return;
  suAt = k; suHash();
  setupRender(dir != null ? dir : (to >= from ? 1 : -1));
  suFocusMain();
}
function setupNext(){ const steps = setupSteps(), i = steps.findIndex(s => s.k === suAt); if(suAt === 'label' && typeof gmailLabelKeyNow !== 'undefined') gmailLabelKeyNow = null; if(i < steps.length - 1) setupGo(steps[i + 1].k, 1); }
function setupBack(){ const steps = setupSteps(), i = steps.findIndex(s => s.k === suAt); if(i > 0) setupGo(steps[i - 1].k, -1); }
function setupSkip(){ suSkipped.add(suAt); suSaveSkipped(); setupNext(); }

// ---- each step's action ------------------------------------------------------------------------------
async function suPushOn(){
  if(typeof enablePushNotifications !== 'function') return;
  await enablePushNotifications();
  suPush = await suPushState(); setupRender(null);
  if(suPush === 'on') setTimeout(() => { if(suAt === 'notify') setupNext(); }, 700);
}
// Slack, Google and Gmail sign in on their own pages, then send you back here (#setup/<step>)
function suSlack(){ if(typeof slackMeConnect === 'function') slackMeConnect(); }
function suCalendar(){ try{ sessionStorage.setItem('gcal-back', '#setup/calendar'); }catch(e){} if(typeof connectGoogleCalendar === 'function') connectGoogleCalendar(); }
function suGmail(){ if(typeof gmailConnect === 'function') gmailConnect(); }
async function suLabel(){
  const btn = document.getElementById('suLabelGo'); if(btn) setBtnLoading(btn, 'Making it…');
  const r = await gmailCall({ action: 'label-key' });
  if(!r.key){ if(btn) restoreBtn(btn); showToast('error', 'Couldn’t make your script', r.error || 'Try again.'); return; }
  gmailLabelKeyNow = r.key;
  gmailState = Object.assign({}, gmailState, { label: { on: true, createdAt: new Date().toISOString(), sent: 0 } });
  setupRender(null);
}
async function suSummaryPick(id){
  const p = (teamProfiles || []).find(x => x.id === id); if(!p || !p.slack_user_id) return;
  const was = myProfile.daily_summary_slack_id;
  myProfile.daily_summary_slack_id = p.slack_user_id; setupRender(null);
  const { error } = await supabaseClient.from('team_profiles').update({ daily_summary_slack_id: p.slack_user_id }).eq('id', currentUser.id);
  if(error){ myProfile.daily_summary_slack_id = was; setupRender(null); showToast('error', 'Couldn’t save who gets it', error.message); }
}
