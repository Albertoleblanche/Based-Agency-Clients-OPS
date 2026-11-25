// Set Up Radar (Nov 24): everything that's yours to connect, one step at a time, without going to
// Settings. It opens by itself the first time someone signs in (team_profiles.setup_done_at is empty,
// addendum-setup.sql), and anytime from the menu under your name, Settings → Connections, or the
// "Finish setting up" reminder in the sidebar.
// Steps, most important first: Slack as you (it also links your Slack, so Radar's own messages reach
// you), notifications on this computer, Radar on your phone, Google Calendar, Gmail, (members) who gets
// your daily summary, then the optional ones: the Gmail label, ChatGPT and Claude. Each says what it
// does, connects in place, and can be skipped. Google and Slack send you back to #setup/<step>.
// Finish Later: it closes, the sidebar says how much is left, and it opens by itself again at most
// once a day, where you left off, until you finish.
// People already on Radar before it existed (team_profiles.joined_before_setup): no full-screen Welcome.
// If everything that matters is already connected, it's marked done quietly; otherwise they get the
// sidebar card ("Connect your apps", New) and one note, and it opens at the first thing left, headed
// "Connect the rest of your apps". Anyone can remind the team from the Team page (Set Up Radar card).

const SETUP_STEPS = [
  { k: 'welcome', name: 'Welcome' },
  { k: 'slack', name: 'Slack' },
  { k: 'notify', name: 'Notifications' },
  { k: 'phone', name: 'Radar on your phone' },
  { k: 'calendar', name: 'Google Calendar' },
  { k: 'gmail', name: 'Gmail' },
  { k: 'summary', name: 'Daily summary', only: () => suPreview || (typeof canApprove === 'function' && !canApprove()) },
  { k: 'label', name: 'Gmail label', optional: true },
  { k: 'ai', name: 'ChatGPT and Claude', optional: true },
  { k: 'done', name: 'All set' },
];
const SETUP_SNOOZE_MS = 20 * 3600000;   // after Finish Later, it opens by itself again at most once a day
let suAt = 'welcome', suPush = null, suPhone = null, suGcal = null, suLoaded = false;
// Preview (#setup?preview, Settings → Connections → Preview): what someone new sees. Nothing is
// connected yet; the buttons pretend to connect, and nothing is saved or sent.
let suPreview = false, suPv = {}, suPvSkipped = new Set(), suPvKey = null, suPvExisting = false;
const suKey = n => `setup-${n}-${(currentUser && currentUser.id) || ''}`;
function suGet(n){ try{ return localStorage.getItem(suKey(n)); }catch(e){ return null; } }
function suSet(n, v){ try{ v == null ? localStorage.removeItem(suKey(n)) : localStorage.setItem(suKey(n), v); }catch(e){} }
function suSkipped(){ try{ return new Set(JSON.parse(suGet('skipped') || '[]')); }catch(e){ return new Set(); } }
function setupSteps(){ return SETUP_STEPS.filter(s => !s.only || s.only()); }
const suFirst = () => { const n = (myProfile && myProfile.name) || ''; return typeof firstName === 'function' ? firstName(n) : n.split(' ')[0]; };
const suPending = () => !!(myProfile && 'setup_done_at' in myProfile && !myProfile.setup_done_at);
// on Radar before Set Up Radar existed (addendum-setup.sql marks everyone there that day)
const suWasHere = () => !!(myProfile && myProfile.joined_before_setup);
const suExisting = () => suPreview ? suPvExisting : suWasHere();   // in the preview: the version being previewed
// the first step that matters and isn't done yet (else All set)
function suFirstMissing(){ const s = suLeft()[0]; return s ? s.k : 'done'; }

// ---- opening and closing ---------------------------------------------------------------------------
// After sign-in: someone who hasn't finished gets the reminder in the sidebar, and the setup itself
// (where they left off) unless they put it off in the last day, or Google or Slack is sending them
// somewhere else right now.
function setupMaybeOpen(){
  setupNudge();
  if(!suPending()) return;
  const existing = suExisting();
  // once it's known where everything stands: all of it connected → done, quietly; someone already on
  // Radar → one note that it's new (and the card in the sidebar)
  setupLoad().then(() => {
    if(!suPending() || document.getElementById('setupRoot')) return;
    if(!suLeft().length){ suQuietDone(); return; }
    if(existing) suNews();
  });
  if(existing) return;
  const snoozed = Number(suGet('snooze') || 0);
  if(snoozed && Date.now() - snoozed < SETUP_SNOOZE_MS) return;
  if(/=/.test(location.hash) || /^#setup/.test(location.hash)) return;
  setupOpen();
}
// step: a step's key; nothing: where you left off (or Welcome). opts.preview: what someone new sees
function setupOpen(step, opts){
  const preview = !!(opts && opts.preview), pvOld = !!(opts && opts.existing);
  if(preview && (!suPreview || pvOld !== suPvExisting)){
    suPvExisting = pvOld; suPvSkipped = new Set(); suPvKey = null;
    suPv = pvOld ? { slack: true, notify: true, calendar: true } : {};   // someone already here has some of it
  }
  suPreview = preview;
  if(!preview) suSet('seen', '1');
  const steps = setupSteps(), has = k => steps.some(s => s.k === k);
  const resume = preview ? null : suGet('at');
  // where you left off; someone already on Radar starts at the first thing left
  const start = suExisting() && suLoaded ? suFirstMissing() : 'welcome';
  suAt = has(step) ? step : has(resume) ? resume : has(start) ? start : 'welcome';
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
function suHash(){
  const h = (suAt === 'welcome' ? '#setup' : `#setup/${suAt}`) + (suPreview ? (suPvExisting ? '?preview=existing' : '?preview') : '');
  if(location.hash !== h) history.replaceState(null, '', h);
  if(!suPreview){ suSet('at', suAt === 'done' ? null : suAt); setupNudge(); }   // the card says what's next
}
function setupClose(){
  const root = document.getElementById('setupRoot'); if(!root) return;
  root.id = ''; root.classList.add('is-out');
  document.removeEventListener('keydown', suKeydown, true);
  const done = () => root.remove();
  if(matchMedia('(prefers-reduced-motion: reduce)').matches) done(); else setTimeout(done, 200);
  if(/^#setup/.test(location.hash)) history.replaceState(null, '', typeof routeHashFor === 'function' && typeof currentViewName !== 'undefined' ? routeHashFor(currentViewName) : '#');
  setupNudge();
}
// Finish Later: the sidebar keeps the place, and it opens by itself again tomorrow at the earliest
function setupLater(){
  if(suPreview){ setupClose(); suPreview = false; showToast('info', 'Preview closed', 'Nothing was connected or saved.'); return; }
  suSet('snooze', String(Date.now()));
  setupClose();
  if(suPending()) showToast('info', 'Finish setting up anytime', 'It’s in the sidebar, where you left off.');
}
async function setupFinish(tour){
  if(suPreview){
    setupClose(); suPreview = false;
    if(tour && typeof startTour === 'function') setTimeout(() => startTour(), 260);
    else showToast('info', 'That was the preview', 'Nothing was connected or saved. Someone new sees this the first time they sign in.');
    return;
  }
  if(suPending()) await suMarkDone();
  setupClose(); setupNudge();
  if(tour && typeof startTour === 'function') setTimeout(() => startTour(), 260);
  else showToast('success', 'You’re set up', 'Change any of it in Settings → Connections.');
}
// team_profiles.setup_done_at, here and in the team list (the Team page shows who's finished)
async function suMarkDone(){
  const at = new Date().toISOString();
  const { error } = await supabaseClient.from('team_profiles').update({ setup_done_at: at }).eq('id', currentUser.id);
  if(error) return false;
  myProfile.setup_done_at = at;
  const me = (typeof teamProfiles !== 'undefined' ? teamProfiles : []).find(p => p.id === currentUser.id); if(me) me.setup_done_at = at;
  ['at', 'skipped', 'snooze', 'news', 'seen'].forEach(n => suSet(n, null));
  if(typeof currentViewName !== 'undefined' && currentViewName === 'team' && typeof drawTeam === 'function') drawTeam();
  return true;
}
// Everything that matters is already connected: done, without a word
async function suQuietDone(){ if(await suMarkDone()) setupNudge(); }
// Someone already on Radar, the first time: one note that it's new, opening at the first thing left
function suNews(){
  if(suGet('news')) return;
  suSet('news', String(Date.now()));
  const n = suLeft().length;
  showToast('info', 'New: connect your apps in one place', `${n} thing${n === 1 ? '' : 's'} left to connect, about ${n < 2 ? 'a minute' : n + ' minutes'}. It’s in the sidebar too.`,
    { action: 'Set Up', duration: 15000, onAction: () => setupOpen(suFirstMissing()) });
}
function suKeydown(e){
  if(!document.getElementById('setupRoot') || document.getElementById('appModalOverlay')) return;   // a sheet on top handles its own keys
  if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); setupLater(); return; }
  if(e.key === 'Tab'){   // keep the keyboard inside the setup
    const root = document.getElementById('setupRoot');
    const f = [...root.querySelectorAll('button:not([disabled]), a[href], input, [tabindex]:not([tabindex="-1"])')].filter(el => el.offsetParent !== null);
    if(!f.length) return;
    if(e.shiftKey && document.activeElement === f[0]){ e.preventDefault(); f[f.length - 1].focus(); }
    else if(!e.shiftKey && document.activeElement === f[f.length - 1]){ e.preventDefault(); f[0].focus(); }
  }
}
function suFocusMain(){ const b = document.querySelector('#suFoot .btn-p') || document.querySelector('#suFoot .btn'); if(b) b.focus({ preventScroll: true }); }

// ---- "Finish setting up" in the sidebar, until it's done ------------------------------------------------
function suLeft(){ return setupSteps().filter(s => s.k !== 'welcome' && s.k !== 'done' && !s.optional).filter(s => { const x = suStatus(s.k); return x !== 'done' && x !== 'na'; }); }
// The card in the sidebar: Set Up Radar, a segment for each step (filling in as each one connects),
// and what's next, which is where it opens. It's drawn once; after that only what changed is touched,
// so a segment fills in place, and the first time it appears they fill in one after another.
function suNudgeNext(){
  const steps = setupSteps(), at = steps.find(x => x.k === suGet('at'));
  if(at && at.k !== 'welcome' && at.k !== 'done' && suStatus(at.k) !== 'done') return at;   // where you left off
  const skipped = suSkipped(), left = suLeft();
  return left.find(x => !skipped.has(x.k)) || left[0] || null;
}
function suNudgeGo(){ const n = suLoaded ? suNudgeNext() : null; setupOpen(suLoaded ? (n ? n.k : 'done') : undefined); }
function setupNudge(){
  let el = document.getElementById('setupNudge');
  if(!suPending()){ if(el) el.hidden = true; return; }
  if(!el){
    const timer = document.getElementById('sideTimer'); if(!timer) return;
    el = document.createElement('div'); el.id = 'setupNudge'; el.className = 'su-nudge';
    el.innerHTML = `<button class="su-nudge-b" onclick="suNudgeGo()"><span class="su-nh"><b>Set Up Radar</b><i class="su-new" hidden>New</i><span class="su-nc"></span></span><span class="su-segs" aria-hidden="true"></span><span class="su-nx"><span class="su-nt"></span>${icon('chevron-right')}</span></button><button class="ib su-nudge-x" aria-label="Hide Set Up Radar" title="Hide" onclick="setupNudgeHide()">${icon('x')}</button>`;
    timer.parentNode.insertBefore(el, timer);
  }
  // the steps that count: the main ones, less any not set up for the team yet
  const main = setupSteps().filter(s => s.k !== 'welcome' && s.k !== 'done' && !s.optional && (!suLoaded || suStatus(s.k) !== 'na'));
  const done = k => suLoaded && suStatus(k) === 'done', doneN = main.filter(s => done(s.k)).length, left = main.length - doneN;
  const next = suLoaded ? suNudgeNext() : null, isNew = suWasHere() && !suGet('seen');
  const line = !suLoaded ? 'Connect your apps' : !left ? 'All connected. Finish up' : next ? `Next: ${next.name}` : `${left} left`;
  // a progress bar in steps: as many filled as are connected, from the left; the one after, marked
  const segs = el.querySelector('.su-segs'), n = String(main.length);
  if(segs.dataset.n !== n){
    segs.innerHTML = main.map((s, i) => `<span class="su-seg" style="--i:${i}"><i></i></span>`).join('');
    segs.dataset.n = n;
    segs.classList.add('is-fill'); segs.offsetWidth;   // drawn empty first, so they fill in, one after another
    clearTimeout(segs._t); segs._t = setTimeout(() => segs.classList.remove('is-fill'), 900);
  }
  segs.querySelectorAll('.su-seg').forEach((g, i) => { g.classList.toggle('is-done', i < doneN); g.classList.toggle('is-next', suLoaded && i === doneN); });
  const nc = el.querySelector('.su-nc'), nt = el.querySelector('.su-nt'), nw = el.querySelector('.su-new');
  const count = suLoaded ? `${doneN} of ${main.length}` : '';
  if(nc.textContent !== count) nc.textContent = count;
  if(nt.textContent !== line) nt.textContent = line;
  nw.hidden = !isNew;
  el.classList.toggle('is-new', isNew); el.classList.toggle('is-all', suLoaded && !left);
  el.querySelector('.su-nudge-b').setAttribute('aria-label', `Set Up Radar${isNew ? ', new' : ''}${suLoaded ? `: ${doneN} of ${main.length} connected` : ''}. ${line}`);
  el.hidden = false;
}
async function setupNudgeHide(){
  if(!(await confirmDialog('Hide Set Up Radar from the sidebar? You can still set up anything from the menu under your name: Set Up Radar.', { confirmLabel: 'Hide' }))) return;
  await setupFinish(false);
}

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
// Radar on a phone: a phone of yours has notifications on
async function suPhoneState(){
  try{
    const { data } = await supabaseClient.from('push_subscriptions').select('user_agent').eq('user_id', currentUser.id);
    return (data || []).some(r => /iPhone|iPad|Android|Mobile/i.test(r.user_agent || '')) ? 'on' : 'off';
  }catch(e){ return 'off'; }
}
let suLoadP = null;
function setupLoad(){
  if(suLoadP) return suLoadP;
  const jobs = [
    suPushState().then(x => { suPush = x; }),
    suPhoneState().then(x => { suPhone = x; }),
    typeof remSlackMeStatus === 'function' ? remSlackMeStatus(true).catch(() => {}) : null,
    typeof fetchGoogleCalendarStatus === 'function' ? fetchGoogleCalendarStatus().then(g => { suGcal = g || { connected: false, googleConfigured: false }; }).catch(() => { suGcal = { connected: false }; }) : null,
    typeof gmailStatusLoad === 'function' ? gmailStatusLoad().catch(() => {}) : null,
    typeof loadAiApps === 'function' ? loadAiApps().catch(() => {}) : null,
  ].filter(Boolean);
  jobs.forEach(j => j.then(() => { if(document.getElementById('setupRoot')) setupRender(null); }));
  suLoadP = Promise.all(jobs).then(() => { suLoaded = true; suLoadP = null; setupNudge(); if(document.getElementById('setupRoot')) setupRender(null); });
  return suLoadP;
}
function setupRefresh(){ return setupLoad(); }
// 'done' (connected), 'off' (yours to do), 'na' (not set up for the team yet), null (checking)
function suStatus(k){
  if(suPreview) return k === 'welcome' || k === 'done' ? null : suPv[k] ? 'done' : 'off';
  const sm = typeof slackMe !== 'undefined' && slackMe && !slackMe.checking ? slackMe : null;
  const gm = typeof gmailState !== 'undefined' ? gmailState : null;
  const ai = typeof aiAppsState !== 'undefined' ? aiAppsState : null;
  if(k === 'notify') return suPush == null ? null : suPush === 'on' ? 'done' : suPush === 'unsupported' ? 'na' : 'off';
  if(k === 'phone') return suPhone == null ? null : suPhone === 'on' ? 'done' : 'off';
  if(k === 'slack') return !sm ? null : sm.connected ? 'done' : (sm.configured === false || sm.needsSetup) ? 'na' : 'off';
  if(k === 'calendar') return !suGcal ? null : suGcal.connected ? 'done' : suGcal.googleConfigured === false ? 'na' : 'off';
  if(k === 'gmail') return !gm ? null : gm.connected ? 'done' : (gm.needsSetup || gm.configured === false) ? 'na' : 'off';
  if(k === 'label'){ if(!gm) return null; const l = gm.label || {}; return l.on ? 'done' : l.needsSetup ? 'na' : 'off'; }
  if(k === 'ai') return !ai || ai.ready == null ? null : (ai.grants || []).length ? 'done' : ai.ready ? 'off' : 'na';
  if(k === 'summary') return myProfile && myProfile.daily_summary_slack_id && myProfile.daily_summary_slack_id !== myProfile.slack_user_id ? 'done' : 'off';
  return null;
}
// Skipping Slack, with no Slack linked: Radar's own messages can't reach you either
const suNoSlackId = () => suPreview ? !suPv.slack : !(myProfile && myProfile.slack_user_id);

// ---- drawing ----------------------------------------------------------------------------------------
function setupRender(dir){
  const root = document.getElementById('setupRoot'); if(!root) return;
  const steps = setupSteps(), i = Math.max(0, steps.findIndex(s => s.k === suAt)), step = steps[i];
  const counted = steps.filter(s => s.k !== 'welcome' && s.k !== 'done');
  suRail(root, steps, counted);
  const pane = document.getElementById('suPane'), foot = document.getElementById('suFoot');
  const html = suStepHtml(step, i, counted);
  // the same step, as its status comes in: only the parts that changed fade in; nothing moves
  if(dir === null && pane.dataset.k === step.k){ suPatch(pane, html.body); suPatch(foot, html.foot); return; }
  pane.dataset.k = step.k;
  pane.innerHTML = html.body; foot.innerHTML = html.foot;
  pane.scrollTop = 0;
  if(dir && !suStill()){
    pane.animate([{ opacity: 0, transform: `translateX(${dir * 16}px)` }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.23,1,.32,1)' });
    foot.animate([{ opacity: .4 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
  }
}
const suStill = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// The list of steps is drawn once; after that only its marks and the highlight change, and the
// highlight slides to the step you're on.
// Radar's logo: the app icon set in Settings → General, else BA (as in the sidebar)
function suBrandMark(){
  const src = typeof settings !== 'undefined' && settings && settings.appIcon;
  return src ? `<img src="${escapeHtml(src)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block">` : 'BA';
}
function suRail(root, steps, counted){
  const rail = root.querySelector('.su-rail'), keys = steps.map(s => s.k).join(',') + (suPreview ? (suPvExisting ? ':pvx' : ':pv') : '');
  if(rail.dataset.keys !== keys){
    const item = s => `<li><button class="su-st" data-k="${s.k}" onclick="setupGo('${s.k}')"><span class="su-n" aria-hidden="true"></span><span class="su-sn">${escapeHtml(s.name)}</span><span class="sr-only su-sr"></span></button></li>`;
    const opt = steps.filter(s => s.optional), main = steps.filter(s => !s.optional && s.k !== 'done');
    rail.innerHTML = `<div class="su-brand"><span class="brand-mark" aria-hidden="true">${suBrandMark()}</span><b>Set Up Radar</b>${suPreview ? '<span class="su-pv">Preview</span>' : ''}</div>
<div class="su-list"><span class="su-ink" aria-hidden="true"></span><ol class="su-steps">${main.map(item).join('')}${opt.length ? `<li class="su-grp" aria-hidden="true">Optional</li>${opt.map(item).join('')}` : ''}${item(steps[steps.length - 1])}</ol></div>
${suPreview ? `<p class="su-pvnote">A preview of what ${suPvExisting ? 'someone already on Radar' : 'someone new'} sees. Nothing is connected or saved.<button class="su-pvsw" onclick="setupOpen('welcome', { preview: true, existing: ${!suPvExisting} })">See it as ${suPvExisting ? 'someone new' : 'someone already here'}</button></p>` : ''}<button class="su-later" onclick="setupLater()">${suPreview ? 'Close Preview' : 'Finish Later'}</button>`;
    rail.dataset.keys = keys; rail.dataset.at = '';
  }
  const skipped = suPreview ? suPvSkipped : suSkipped();
  rail.querySelectorAll('.su-st').forEach(b => {
    const k = b.dataset.k, s = steps.find(x => x.k === k), st = suStatus(k), on = k === suAt, sk = (skipped.has(k) || st === 'na') && st !== 'done';
    const mark = k === 'welcome' || k === 'done' ? icon(k === 'done' ? 'check' : 'compass') : st === 'done' ? icon('check') : sk ? icon('minus') : String(counted.indexOf(s) + 1);
    const n = b.querySelector('.su-n'); if(n.innerHTML !== mark) n.innerHTML = mark;
    b.classList.toggle('is-on', on); b.classList.toggle('is-done', st === 'done'); b.classList.toggle('is-skip', sk);
    if(on) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    b.querySelector('.su-sr').textContent = st === 'done' && k !== 'done' ? ', done' : '';
  });
  // the highlight: under the step you're on, sliding there from the last one
  const on = rail.querySelector('.su-st.is-on'), ink = rail.querySelector('.su-ink');
  if(on && ink){
    const y = on.offsetTop, h = on.offsetHeight, first = !rail.dataset.at;
    if(first || suStill()) ink.style.transition = 'none';
    ink.style.transform = `translateY(${y}px)`; ink.style.height = h + 'px';
    if(first || suStill()){ ink.offsetHeight; ink.style.transition = ''; }
    rail.dataset.at = suAt;
  }
}
// Replaces only the children that changed, and fades those in
function suPatch(el, html){
  const tpl = document.createElement('div'); tpl.innerHTML = html;
  const next = [...tpl.childNodes], cur = [...el.childNodes];
  const same = (a, b) => a.nodeType === b.nodeType && (a.nodeType === 1 ? a.outerHTML === b.outerHTML : a.textContent === b.textContent);
  const had = document.activeElement && el.contains(document.activeElement) ? document.activeElement : null;
  for(let n = 0; n < Math.max(next.length, cur.length); n++){
    const a = cur[n], b = next[n];
    if(!b){ a.remove(); continue; }
    if(!a){ el.appendChild(b); suFadeIn(b); continue; }
    if(same(a, b)) continue;
    el.replaceChild(b, a); suFadeIn(b);
  }
  // focus stays on the same button (by its label) if it was replaced
  if(had && !had.isConnected){ const t = had.textContent; const again = [...el.querySelectorAll('button')].find(x => x.textContent === t); if(again) again.focus({ preventScroll: true }); }
}
function suFadeIn(node){ if(node.nodeType !== 1 || suStill() || !node.animate) return; node.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.23,1,.32,1)' }); }
function suAppUrl(){ return location.origin.replace(/\/+$/, '') + '/'; }
// One step: { body, foot }
function suStepHtml(step, i, counted){
  const st = suStatus(step.k), k = step.k, n = counted.indexOf(step) + 1;
  const head = (logo, title, why) => `${n ? `<p class="su-of">Step ${n} of ${counted.length}${step.optional ? ' · Optional' : ''}</p>` : ''}<div class="su-h">${logo}<h2 id="suTitle">${title}</h2></div>${why ? `<p class="su-why">${why}</p>` : ''}`;
  const got = list => `<ul class="su-get">${list.map(t => `<li>${icon('check')}<span>${t}</span></li>`).join('')}</ul>`;
  const state = (tone, text) => `<p class="su-state is-${tone}"><span class="dot ${tone === 'ok' ? 'green' : 'hollow'}"></span><span>${text}</span></p>`;
  const checking = st == null ? state('wait', 'Checking…') : '';
  const back = i > 0 ? `<button class="btn" onclick="setupBack()">Back</button>` : '';
  const foot = (primary, skip) => `${back}<span class="su-gap"></span>${skip && st !== 'done' ? `<button class="btn btn-q su-skip" onclick="setupSkip()">Skip</button>` : ''}${primary}`;
  const next = label => `<button class="btn btn-p" onclick="setupNext()">${label || 'Continue'}</button>`;
  let body = '', f = '';
  if(k === 'welcome' && suExisting()){
    // someone already on Radar: what's connected, what's left, and on to the first thing left
    const main = counted.filter(s => !s.optional), left = main.filter(s => { const x = suStatus(s.k); return x !== 'done' && x !== 'na'; });
    const known = main.every(s => suStatus(s.k) != null);
    const li = s => { const x = suStatus(s.k), d = x === 'done';
      return `<li class="${d ? 'is-done' : x === 'na' ? 'is-na' : ''}">${d ? icon('check') : '<i class="su-o" aria-hidden="true"></i>'}<span class="su-hv"><b>${escapeHtml(s.name)}</b>${x === 'na' ? '<span>Not set up for the team yet</span>' : ''}${d ? '<span class="sr-only">, connected</span>' : ''}</span></li>`; };
    body = `<div class="su-hello su-again"><div class="su-logos" aria-hidden="true">${[appLogo('slack'), suGlyph('bell'), suGlyph('smartphone'), appLogo('gcalendar'), appLogo('gmail')].join('')}</div>
<h2 id="suTitle">Connect the rest of your apps</h2>
<p class="su-why">New in Radar: everything that’s yours to connect, in one place. Some of it you’ve already done.</p>
<ul class="su-sum su-have">${main.map(li).join('')}</ul>
<p class="su-note">${!known ? 'Checking what’s connected…' : left.length ? `${left.length} left, about ${left.length < 2 ? 'a minute' : left.length + ' minutes'}. Skip anything you like.` : 'All of it’s connected.'}</p></div>`;
    f = foot(next(), false);
  } else if(k === 'welcome'){
    const logos = [appLogo('slack'), suGlyph('bell'), suGlyph('smartphone'), appLogo('gcalendar'), appLogo('gmail')];
    body = `<div class="su-hello"><div class="su-logos" aria-hidden="true">${logos.join('')}</div>
<h2 id="suTitle">Welcome to Radar${suFirst() ? ', ' + escapeHtml(suFirst()) : ''}</h2>
<p class="su-why">Connect the apps you work in, so Radar brings your meetings, your clients’ emails and your team’s nudges to one place, and reaches you where you are.</p>
<p class="su-note">About five minutes. Skip anything you like; it’s all in Settings → Connections later.</p></div>`;
    f = foot(next('Get Started'), false);
  } else if(k === 'slack'){
    const noId = suNoSlackId();
    body = head(appLogo('slack', 'xl'), 'Slack, as you', 'Radar reaches you in Slack, and messages you send teammates from Radar go from your own Slack, as you, not from the Radar bot.') + got(['Radar’s messages to you: tasks, drafts to review, reminders', 'Nudges and reminders to teammates, with a link to the item', 'Radar only sends what you send; it doesn’t read your Slack']) +
      (checking || (st === 'done' ? state('ok', 'Connected.')
        : st === 'na' ? state('off', isAdmin() ? 'Slack sign-in isn’t set up for the team yet. It takes a few minutes in Slack’s app settings.' : 'An admin sets up Slack sign-in for the team first. You can connect later in Settings → Connections.')
        : noId ? state('off', 'Your Slack isn’t linked to Radar yet. Until you connect it, Radar’s own messages can’t reach you in Slack.') : ''));
    f = foot(st === 'off' ? `<button class="btn btn-p" onclick="suSlack()">Connect Slack…</button>` : st === 'na' && isAdmin() ? `<button class="btn" onclick="slackMeSetupSheet()">Set Up for the Team…</button>${next()}` : next(), true);
  } else if(k === 'notify'){
    body = head(suGlyph('bell'), 'Notifications on this computer', 'So you hear about what needs you, even when Radar isn’t open.') + got(['A task given to you, or one past its date', 'A client waiting on you, and drafts to review', 'Nudges from teammates']) +
      (checking || (st === 'done' ? state('ok', 'On for this computer.')
        : suPush === 'blocked' ? state('off', 'This browser is blocking notifications from Radar. Allow them from the icon at the left of the address bar, then come back here.')
        : st === 'na' ? state('off', 'This browser can’t show notifications. You’ll still see everything in the bell in Radar.') : ''));
    f = foot(st === 'off' && suPush !== 'blocked' ? `<button class="btn btn-p" onclick="suPushOn()">${icon('bell')}Turn On</button>` : next(), true);
  } else if(k === 'phone'){
    const url = suAppUrl(), host = url.replace(/^https?:\/\//, '').replace(/\/$/, ''), canSlack = !suNoSlackId();
    body = head(suGlyph('smartphone'), 'Radar on your phone', 'Today, tasks, reviews and time, made for your phone, with notifications when something needs you.') +
      `<div class="su-phone"><div class="su-url"><span>On your phone, open</span><b>${escapeHtml(host)}</b><div class="su-url-a"><button class="btn sm" id="suCopyLink" onclick="suCopyLink()">${icon('copy')}Copy Link</button>${canSlack ? `<button class="btn sm" id="suSendLink" onclick="suSendLink()">${appLogo('slack', 'xs')}Send to My Slack</button>` : ''}</div></div>
<ol class="gl-steps su-psteps"><li><b>iPhone</b><span>Open it in Safari, tap Share, then Add to Home Screen. Open Radar from your Home Screen.</span></li>
<li><b>Android</b><span>Open it in Chrome, tap ⋮, then Install app (or Add to Home screen).</span></li>
<li><b>Turn on notifications</b><span>In Radar on your phone: More → Settings → Push notifications.</span></li></ol></div>` +
      (checking || (st === 'done' ? state('ok', 'Notifications are on for your phone.') : ''));
    f = foot(next(st === 'done' ? 'Continue' : 'I’ve Done It'), true);
  } else if(k === 'calendar'){
    body = head(appLogo('gcalendar', 'xl'), 'Google Calendar', 'Your meetings show in Radar’s calendar, beside the team’s deadlines and weekly sends, and stay current on their own.') + got(['Your meetings on Today and in Calendar', 'Meetings with clients next to their work', 'Read only: Radar doesn’t change your calendar']) +
      (checking || (st === 'done' ? state('ok', 'Connected.') : st === 'na' ? state('off', 'Google sign-in isn’t set up for the team yet. An admin adds it once.') : ''));
    f = foot(st === 'off' ? `<button class="btn btn-p" onclick="suCalendar()">Connect Google Calendar…</button>` : next(), true);
  } else if(k === 'gmail'){
    const g = suPreview ? { email: (myProfile && myProfile.email) || '' } : ((typeof gmailState !== 'undefined' && gmailState) || {});
    body = head(appLogo('gmail', 'xl'), 'Gmail', 'Radar reads new emails from your clients and suggests what they ask for as tasks, with a link back to the email.') + got(['Only your clients’ emails are opened; nothing else is read', 'Read only: Radar can’t send, delete or change anything', 'Suggestions wait in Tasks for you to add or dismiss']) +
      (checking || (st === 'done' ? state('ok', `Connected${g.email ? ' as ' + escapeHtml(g.email) : ''}.`) : st === 'na' ? state('off', g.needsSetup ? (isAdmin() ? 'Run addendum-gmail.sql in Supabase first.' : 'An admin finishes setting this up first.') : 'Google sign-in isn’t set up for the team yet.') : ''));
    f = foot(st === 'off' ? `<button class="btn btn-p" onclick="suGmail()">Connect Gmail…</button>` : next(), true);
  } else if(k === 'summary'){
    const rank = p => p.role === 'admin' ? 2 : p.role === 'approver' ? 1 : 0;
    const people = (teamProfiles || []).filter(p => p.id !== currentUser.id && !p.access_revoked && p.slack_user_id).sort((a, b) => rank(b) - rank(a) || String(a.name).localeCompare(String(b.name)));
    const cur = suPreview ? suPv.summaryId : myProfile && myProfile.daily_summary_slack_id;
    const role = p => p.role === 'admin' ? 'Admin' : p.role === 'approver' ? 'Approver' : '';
    body = head(suGlyph('clipboard-text'), 'Your daily summary', 'At the end of the day, send what you worked on, client by client, from Timesheet’s Today card. Who should get it?') +
      (people.length ? `<div class="ds-pk su-pk" role="radiogroup" aria-label="Who gets your daily summary">${people.map(p => `<button role="radio" aria-checked="${cur === p.slack_user_id}" onclick="suSummaryPick('${p.id}')"><span class="ck"></span><span>${escapeHtml(p.name)}</span><span class="r">${role(p)}</span></button>`).join('')}</div>`
        : state('off', 'Nobody on the team has Slack linked in Radar yet. You can choose later, on Timesheet.'));
    f = foot(next(), true);
  } else if(k === 'label'){
    const key = suPreview ? suPvKey : typeof gmailLabelKeyNow !== 'undefined' ? gmailLabelKeyNow : null;
    body = head(suGlyph('tag'), 'Gmail label “Radar”', 'For any other email you want in Radar: label it “Radar” and it becomes a task within 5 minutes. A small script in your Google account sends only the emails you label.') +
      (key ? `<div class="su-script">${gmailLabelStepsHtml(key)}</div>`
        : checking || (st === 'done' ? state('ok', 'Your script is set up. Label an email “Radar” to try it.') : st === 'na' ? state('off', isAdmin() ? 'Run addendum-gmail-label.sql in Supabase first.' : 'An admin finishes setting this up first.')
        : got(['You choose exactly which emails go in', 'Works for anyone’s email, not just clients’', 'Set up once, in about two minutes'])));
    f = foot(key ? next('I’ve Set It Up') : st === 'off' ? `<button class="btn btn-p" id="suLabelGo" onclick="suLabel()">Get My Script</button>` : next(), true);
  } else if(k === 'ai'){
    body = head(appLogoPair('chatgpt', 'claude', 'xl'), 'ChatGPT and Claude', 'Ask ChatGPT or Claude about your clients, tasks and hours, and have it add tasks, plan sprints, add follow-ups or log time, as you.') +
      `<div class="su-ai" id="aiAppsBox">${typeof aiAppsInner === 'function' ? aiAppsInner() : ''}</div>`;
    f = foot(next(), true);
  } else {
    const main = counted.filter(s => !s.optional), opt = counted.filter(s => s.optional);
    const row = s => { const x = suStatus(s.k);
      const why = x === 'done' ? '' : x === 'na' ? 'Not set up for the team yet' : s.k === 'slack' && suNoSlackId() ? 'Skipped. Radar can’t message you in Slack until you connect it'
        : s.k === 'phone' ? 'No notifications on your phone yet. The steps stay here, in Set Up Radar' : s.k === 'summary' ? 'Not chosen yet. You can choose on Timesheet' : 'Skipped. It’s in Settings → Connections';
      return `<li class="${x === 'done' ? 'is-done' : ''}">${x === 'done' ? icon('check') : icon('minus')}<span><b>${escapeHtml(s.name)}</b>${why ? `<span>${why}</span>` : ''}</span></li>`; };
    const doneN = main.filter(s => suStatus(s.k) === 'done').length, can = main.filter(s => suStatus(s.k) !== 'na').length;
    body = `<div class="su-hello su-end"><div class="su-badge" aria-hidden="true">${icon('check')}</div><h2 id="suTitle">${doneN >= can ? 'You’re all set' : 'You’re ready to go'}</h2>
<p class="su-why">${doneN} of ${main.length} connected.${doneN < can ? ' Anything you skipped is waiting in Settings → Connections.' : ''}</p><ul class="su-sum">${main.map(row).join('')}${opt.length ? `<li class="su-sum-h">Optional</li>${opt.map(row).join('')}` : ''}</ul></div>`;
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
// Continue: on to the next step that isn't connected yet (they're ticked in the list, and on All set)
function setupNext(){
  const steps = setupSteps(), i = steps.findIndex(s => s.k === suAt);
  if(suAt === 'label'){ if(typeof gmailLabelKeyNow !== 'undefined') gmailLabelKeyNow = null; suPvKey = null; }
  let j = i + 1;
  while(j < steps.length - 1 && suStatus(steps[j].k) === 'done') j++;
  if(j < steps.length) setupGo(steps[j].k, 1);
}
function setupBack(){ const steps = setupSteps(), i = steps.findIndex(s => s.k === suAt); if(i > 0) setupGo(steps[i - 1].k, -1); }
function setupSkip(){
  if(suPreview){ suPvSkipped.add(suAt); setupNext(); return; }
  const s = suSkipped(); s.add(suAt); suSet('skipped', JSON.stringify([...s])); setupNudge(); setupNext();
}
// Preview: the button shows it connecting, then the step is connected, and a note says what really happens
const SU_PV_SAYS = { slack: 'In the real setup, Slack asks you to allow Radar, then brings you back here, connected.',
  calendar: 'In the real setup, Google asks you to allow Radar to see your calendar, then brings you back here, connected.',
  gmail: 'In the real setup, Google asks you to allow Radar to read your clients’ emails, then brings you back here, connected.',
  notify: 'In the real setup, your browser asks you to allow notifications from Radar.' };
function suPvFake(k){
  const btn = document.querySelector('#suFoot .btn-p'); if(btn) setBtnLoading(btn, 'Connecting…');
  setTimeout(() => { suPv[k] = true; setupRender(null); if(SU_PV_SAYS[k]) showToast('info', 'Preview', SU_PV_SAYS[k]); }, 650);
}

// ---- each step's action ------------------------------------------------------------------------------
async function suPushOn(){
  if(suPreview){ suPvFake('notify'); return; }
  if(typeof enablePushNotifications !== 'function') return;
  await enablePushNotifications();
  suPush = await suPushState(); setupRender(null); setupNudge();
  if(suPush === 'on') setTimeout(() => { if(suAt === 'notify') setupNext(); }, 700);
}
// Slack, Google and Gmail sign in on their own pages, then send you back here (#setup/<step>)
function suSlack(){ if(suPreview) return suPvFake('slack'); if(typeof slackMeConnect === 'function') slackMeConnect(); }
function suCalendar(){ if(suPreview) return suPvFake('calendar'); try{ sessionStorage.setItem('gcal-back', '#setup/calendar'); }catch(e){} if(typeof connectGoogleCalendar === 'function') connectGoogleCalendar(); }
function suGmail(){ if(suPreview) return suPvFake('gmail'); if(typeof gmailConnect === 'function') gmailConnect(); }
async function suLabel(){
  if(suPreview){ suPvKey = 'rgl_PREVIEW_' + 'x'.repeat(24); suPv.label = true; setupRender(null); return; }
  const btn = document.getElementById('suLabelGo'); if(btn) setBtnLoading(btn, 'Making it…');
  const r = await gmailCall({ action: 'label-key' });
  if(!r.key){ if(btn) restoreBtn(btn); showToast('error', 'Couldn’t make your script', r.error || 'Try again.'); return; }
  gmailLabelKeyNow = r.key;
  gmailState = Object.assign({}, gmailState, { label: { on: true, createdAt: new Date().toISOString(), sent: 0 } });
  setupRender(null);
}
async function suSummaryPick(id){
  const p = (teamProfiles || []).find(x => x.id === id); if(!p || !p.slack_user_id) return;
  if(suPreview){ suPv.summaryId = p.slack_user_id; suPv.summary = true; setupRender(null); return; }
  const was = myProfile.daily_summary_slack_id;
  myProfile.daily_summary_slack_id = p.slack_user_id; setupRender(null); setupNudge();
  const { error } = await supabaseClient.from('team_profiles').update({ daily_summary_slack_id: p.slack_user_id }).eq('id', currentUser.id);
  if(error){ myProfile.daily_summary_slack_id = was; setupRender(null); setupNudge(); showToast('error', 'Couldn’t save who gets it', error.message); }
}
// Radar's address, for your phone
function suCopyLink(){
  const b = document.getElementById('suCopyLink');
  const done = () => { if(b){ b.innerHTML = `${icon('check')}Copied`; setTimeout(() => { if(b.isConnected) b.innerHTML = `${icon('copy')}Copy Link`; }, 1600); } };
  if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(suAppUrl()).then(done, () => showToast('info', 'Couldn’t copy', suAppUrl()));
  else showToast('info', 'Radar’s address', suAppUrl());
}
async function suSendLink(){
  if(suPreview){ showToast('info', 'Preview', 'In the real setup, Radar sends you this link in Slack, to open on your phone.'); return; }
  const b = document.getElementById('suSendLink'); if(b) setBtnLoading(b, 'Sending…');
  let r = {};
  try{
    const { data: { session } } = await supabaseClient.auth.getSession();
    const res = await fetch('/api/send-slack-message', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ action: 'phone-link' }) });
    r = await res.json().catch(() => ({}));
  }catch(e){ r = { error: 'Couldn’t reach Radar.' }; }
  if(b) restoreBtn(b);
  if(r.sent) showToast('success', 'Sent to your Slack', 'Open it on your phone and tap the link.');
  else showToast('error', 'Not sent', r.reason === 'no_slack_id' ? 'Your Slack isn’t linked to Radar yet. Connect Slack first.' : r.reason === 'muted' ? 'You’ve turned off this kind of Slack message in Settings → Notifications.' : (r.error || 'Try Copy Link instead.'));
}
