// Activity log rendering, the countdown gauge, login/logout screens and
// app startup (auth state, live-update safety nets). Loaded last.

function nowTime(){ return new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}); }

function logEntryLabel(l){
  if(l.tag==='auto') return 'auto';
  if(currentUser && l.userId && l.userId===currentUser.id) return 'you';
  if(l.userId){
    const p = teamProfiles.find(x=>x.id===l.userId);
    if(p) return p.name.split(' ')[0];
  }
  // Entries logged before this fix (or with an unresolvable user) have no
  // reliable actor to attribute — say so honestly instead of defaulting to
  // "you", which is what caused this in the first place.
  return 'team';
}

// Rows from the activity table carry a real timestamp: today's show just
// the time (as before), older ones get the date too. Legacy entries (the
// old blob, backfilled rows) and not-yet-reloaded local ones use their
// stored time label.
function logEntryTime(l){
  if(l.t) return l.t;
  if(!l.createdAt) return '';
  const d = new Date(l.createdAt);
  const time = d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString('en-US',{month:'short',day:'numeric'})}, ${time}`;
}
function renderLog(){
  const rows = log.length ? log.map(l=>`<div class="log-row"><span class="log-time">${escapeHtml(logEntryTime(l))}</span><span><span class="tag ${l.tag==='auto'?'auto':'you'}">${escapeHtml(logEntryLabel(l))}</span>${sanitizeInlineHtml(l.text)}</span></div>`).join('') : `<div class="empty">No activity yet.</div>`;
  const logListEl = document.getElementById('logList');
  if(logListEl) logListEl.innerHTML = rows;
  const logOverviewEl = document.getElementById('logListOverview');
  if(logOverviewEl) logOverviewEl.innerHTML = rows;
  const logCountEl = document.getElementById('logCountOverview');
  if(logCountEl) logCountEl.textContent = log.length ? `${log.length} event${log.length!==1?'s':''}` : '';
}

function pad2(n){ return String(n).padStart(2,'0'); }

// A refresh nobody should notice: reload the data and redraw without entrance animations.
function silentRefresh(){
  document.body.classList.add('silent-refresh');
  return fullRefresh().finally(()=> setTimeout(()=> document.body.classList.remove('silent-refresh'), 200));
}

function renderGauge(){
  if(document.hidden) return; // nothing to see in a background tab
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now); monday.setDate(now.getDate() - ((day+6)%7)); monday.setHours(17,0,0,0);
  const wed = new Date(monday); wed.setDate(monday.getDate()+2); wed.setHours(9,0,0,0);
  let start = monday, end = wed;
  if(now > end){ start = new Date(end); end = new Date(end); end.setDate(end.getDate()+7); }
  const total = end-start; const elapsed = Math.min(Math.max(now-start,0), total);
  const pct = total>0 ? elapsed/total*100 : 0;

  const msLeft = Math.max(0, end-now);
  const days = Math.floor(msLeft/86400000);
  const hrs = Math.floor((msLeft%86400000)/3600000);
  const mins = Math.floor((msLeft%3600000)/60000);
  const secs = Math.floor((msLeft%60000)/1000);
  const isCrit = msLeft < 6*3600000; // under 6 hours left
  const caption = isCrit ? 'Auto-notification firing soon' : 'Until admins & approvers are notified';

  document.querySelectorAll('.gauge-fill').forEach(e=> e.style.width = pct+'%');
  document.querySelectorAll('.gauge-ring').forEach(e=>{
    const c = 2*Math.PI*8;
    e.style.strokeDasharray = c;
    e.style.strokeDashoffset = c*(1-pct/100);
  });
  document.querySelectorAll('.gauge-d').forEach(e=> e.textContent = pad2(days));
  document.querySelectorAll('.gauge-h').forEach(e=> e.textContent = pad2(hrs));
  document.querySelectorAll('.gauge-m').forEach(e=> e.textContent = pad2(mins));
  document.querySelectorAll('.gauge-s').forEach(e=> e.textContent = pad2(secs));
  document.querySelectorAll('.gauge-caption').forEach(e=> { e.textContent = caption; e.classList.toggle('crit', isCrit); });
  document.querySelectorAll('.gauge-row').forEach(e=> e.classList.toggle('crit', isCrit));
}

// The sign-in screen itself (panes, reset link, new password, opening) is js/ui/signin.js.
async function handleLogin(){
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const btn = document.getElementById('loginBtn');
  if(btn.disabled) return;
  if(!siLooksLikeEmail(email)){ siErr('loginError', email ? 'That doesn’t look like an email address.' : 'Enter your work email.', ['loginEmail']); document.getElementById('loginEmail').focus(); return; }
  if(!password){ siErr('loginError', 'Enter your password.', ['loginPassword']); document.getElementById('loginPassword').focus(); return; }
  siErr('loginError', '');
  siBusy(btn, 'Signing In…', ['loginEmail', 'loginPassword']);
  let error = null;
  try{ ({ error } = await supabaseClient.auth.signInWithPassword({ email, password })); }catch(e){ error = e; }
  if(error){ siIdle(btn); siErr('loginError', siAuthMessage(error, 'signin'), ['loginPassword']); document.getElementById('loginPassword').select(); return; }
  // On success, onAuthStateChange fires SIGNED_IN → showApp() takes over.
}

function showLoginScreen(){
  if(typeof closeFloatingUi === 'function') closeFloatingUi();
  document.body.classList.add('signed-out');
  const overlay = document.getElementById('loginOverlay');
  overlay.style.display = ''; overlay.classList.remove('is-app');
  document.getElementById('appRoot').style.display = 'none';
  document.getElementById('appRoot').classList.remove('si-app-in');
  teardownRealtimeSubscriptions();
  currentUser = null; myProfile = null;
  siIdle(document.getElementById('loginBtn'));
  document.getElementById('loginPassword').value = '';
  siHidePasswords();
  siSet('form'); siFocus('form');
  // Defensive reset — makes sure nothing from a previous session (e.g. an
  // admin's team-wide time entries) can render even briefly for whoever
  // logs in next on this same tab, before their own fresh data loads in.
  clients = []; notes = []; timeEntries = []; teamProfiles = []; log = [];
  // The Assistant's own state was missing from this reset entirely — its
  // conversations are personal, but claudeHistoryLoaded staying true
  // across a logout meant loadClaudeHistory() would permanently skip
  // re-fetching for whoever logged in next on the same tab, silently
  // leaving the PREVIOUS person's already-loaded conversations and
  // projects on screen instead of ever loading the new person's own.
  claudeConversation = []; claudeConversationId = null; claudeConversationsList = [];
  claudeHistoryLoaded = false; claudeSending = false;
  claudeProjectsList = []; claudeCurrentProjectId = null; claudeProjectsSearchQuery = ''; claudePendingProjectId = null;
  claudeQuickActionsPicked = [];
}

async function showApp(session, o){
  try{
    currentUser = session.user;
    // The sign-in screen becomes the opening: the panel fades, a thin line runs, and the greeting
    // comes in once the profile has loaded. The screen stays up the whole time, so there's never a
    // gap where nothing covers the window, and appRoot stays hidden until it's fully drawn.
    siOpening(o);
    await loadMyProfile();
    if(!myProfile){
      // Auth account exists but no team_profiles row — shouldn't normally happen
      // since create-member.js creates both together, but handle it gracefully.
      const detail = lastProfileError ? ` (${lastProfileError.message || JSON.stringify(lastProfileError)})` : '';
      await supabaseClient.auth.signOut();
      showLoginScreen();
      siErr('loginError', `This account isn’t set up on the team yet${detail}. Ask an admin to add you from Team.`);
      return;
    }
    siGreet(myProfile.name);
    await initTheme();
    await loadAll();
    siStep(1);
    // Everything below only fills its own list, so it loads in parallel
    // instead of one request after another (the seed step needs the
    // danger history first, so those two stay chained).
    // The opening ticks off "Your day" and "Messages" as their parts arrive.
    const day = Promise.all([loadMyNotes(), loadMyTasks(), loadCalendarEvents(), typeof loadPlan === 'function' ? loadPlan() : null]).then(() => siStep(2));
    const msgs = Promise.all([loadNotifications(), typeof loadWaTasks === 'function' ? loadWaTasks() : null]).then(() => siStep(3));
    await Promise.all([
      loadTeamProfiles(), loadTimeEntries(), day, msgs,
      loadDangerHistory().then(seedDangerHistoryIfEmpty),
      // The weekly model reads these: without them the first screen counts every client
      // as never updated until the next refresh.
      typeof loadUpdateHistory === 'function' ? loadUpdateHistory() : null,
      typeof loadHealthHandled === 'function' ? loadHealthHandled() : null,
      typeof loadClientReminders === 'function' ? loadClientReminders() : null,
      typeof loadTaskDueTimes === 'function' ? loadTaskDueTimes() : null,
      // Harvest's clients and projects: what each client buys, and the lists Log Time uses
      typeof hvTimeLoad === 'function' ? hvTimeLoad() : null,
    ]);
    document.getElementById('appRoot').style.display = 'flex';
    document.body.classList.remove('signed-out');
    renderAll();
    siEnterApp();
    updateTasksNavBadge();
    applyAppIcon();
    applyAppBranding();
    applyNavLabels();
    initTimerFromStorage();
    initClaudeBtnDrag();
    // Pre-loads the Assistant's history and lays out its empty/active
    // state right away, in the background — otherwise the tab only ever
    // initialized on first click, so clicking into it showed a visible
    // flash of the wrong layout while loadClaudeHistory() was still
    // fetching. Only bothers for people who actually have access, since
    // there's nothing to preload otherwise.
    if(myProfile?.ai_chat_enabled){ loadClaudeHistory().then(renderClaudeMessages); }
    await checkForNewNotificationToasts();
    setupRealtimeSubscriptions();
    // Read what changed in Harvest's clients, projects and tasks (the server skips it if it read in the last 10 minutes).
    if(typeof harvestSyncInBackground === 'function') harvestSyncInBackground();
    // Open the screen the address points at (a refresh, bookmark, shared
    // link or push notification). The Google Calendar return is handled
    // separately in init() below.
    if(location.hash && !/gcal=/.test(location.hash)) openScreenFromAddress(location.hash);
  }catch(e){
    console.error('showApp failed', e);
    document.body.classList.add('signed-out');
    document.getElementById('appRoot').style.display = 'none';
    document.getElementById('loginOverlay').style.display = '';
    document.getElementById('loginOverlay').classList.remove('is-app');
    siIdle(document.getElementById('loginBtn'));
    siSet('form');
    siErr('loginError', 'Your workspace didn’t finish loading. Sign in again to retry.');
  }
}

(async function init(){
  initSidebarState();
  const { data: { session } } = await supabaseClient.auth.getSession();
  // A reset link that expired or was already used: say so, and offer a new one.
  const linkError = siTakeLinkError();
  if(linkError && /error/.test(location.hash)) history.replaceState(null, '', location.pathname);
  if(session && siRecovering()){ siShowNewPassword(session); }   // from a reset link: set a new password first
  else if(session){ siSetRecovering(false); await showApp(session); }
  else {
    siSetRecovering(false);
    showLoginScreen();
    if(linkError){ siShow('forgot'); siErr('siResetErr', 'That link has expired or was already used. Enter your email for a new one.'); }
  }

  // Google redirects back to #profile?gcal=connected|denied|error after the
  // OAuth flow — pick that up, land on Profile, and clean the URL so a
  // refresh doesn't re-show the same toast.
  const hash = window.location.hash;
  if(hash.startsWith('#profile') && hash.includes('gcal=')){
    const outcome = new URLSearchParams(hash.split('?')[1]).get('gcal');
    if(session){
      await switchView('profile');
      if(outcome==='connected') showToast('success','Google Calendar connected','Click "Sync now" to pull in your meetings.');
      else if(outcome==='denied') showToast('info','Not connected','You can connect Google Calendar anytime from this page.');
      else if(outcome==='error') showToast('error','Connection failed','Something went wrong connecting Google Calendar — try again.');
    }
    history.replaceState(null, '', window.location.pathname + (session ? '#profile' : ''));
  }

  // Back/Forward, or an address typed/pasted into the bar → open that screen.
  window.addEventListener('hashchange', () => openScreenFromAddress(location.hash));

  // Tapping a push notification while the app is already open: the service
  // worker focuses this tab and asks it to open the notification's screen.
  if('serviceWorker' in navigator){
    navigator.serviceWorker.addEventListener('message', (e) => {
      if(e.data?.type !== 'open-url' || typeof e.data.url !== 'string') return;
      try{
        const u = new URL(e.data.url, location.origin);
        if(u.origin === location.origin && u.hash && u.hash !== location.hash) location.hash = u.hash;
      }catch(err){}
    });
  }

  // Supabase fires onAuthStateChange once immediately upon subscribing,
  // reporting whatever the current session state already is — which we just
  // handled above via getSession(). Without skipping that first callback,
  // showApp() (or showLoginScreen()) runs a second time back-to-back on
  // every single page load. Any real, later event (an actual future login
  // or logout) still gets handled normally.
  let ignoreNextAuthEvent = true;
  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if(ignoreNextAuthEvent){ ignoreNextAuthEvent = false; return; }
    // Supabase reports SIGNED_IN again every time the tab comes back into view (it re-checks
    // the saved session). The app is already open for that person, so there's nothing to do:
    // running showApp() again reloaded everything, redrew every screen and replayed the
    // screen's entrance, which was the "glitch" when switching back to the window.
    // A reset link signs the person in for one thing: choosing a new password.
    if(event === 'PASSWORD_RECOVERY' && session){ siShowNewPassword(session); return; }
    if(event === 'SIGNED_IN' && session){ if(siRecovering() || (currentUser && currentUser.id === session.user?.id)) return; await showApp(session); }
    if(event === 'SIGNED_OUT'){ showLoginScreen(); }
  });

  // Toolbar material: transparent while the page is at the top, glass with a
  // hairline once content scrolls under it (macOS scroll-edge behaviour).
  const mainEl = document.querySelector('.main'), topbarEl = document.getElementById('appTopbar');
  if(mainEl && topbarEl){
    mainEl.addEventListener('scroll', () => topbarEl.classList.toggle('scrolled', mainEl.scrollTop > 4), { passive:true });
  }

  setInterval(renderGauge, 1000);

  // Realtime subscriptions are the primary update mechanism now — this is
  // just a safety net in case a connection silently drops and doesn't
  // reconnect on its own, which does happen occasionally with websockets.
  // Infrequent on purpose: if realtime is working, this rarely finds
  // anything new to show. Silent: nothing on screen should move.
  setInterval(()=>{ if(currentUser && !isLoggingActive() && !document.hidden) silentRefresh(); }, 180000);

  // Browsers throttle background tabs, including websocket activity — catch
  // up on anything potentially missed when the tab comes back after a real
  // absence. Switching between windows for a few seconds redraws nothing.
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', ()=>{
    if(document.visibilityState === 'hidden'){ hiddenAt = Date.now(); return; }
    if(!currentUser || isLoggingActive()) return;
    if(!realtimeChannel || realtimeChannel.state !== 'joined' && realtimeChannel.state !== 'joining') setupRealtimeSubscriptions();
    if(hiddenAt && Date.now() - hiddenAt < 60000) return;
    silentRefresh();
  });

  const toastStackEl = document.getElementById('toastStack');
  if(toastStackEl){
    toastStackEl.addEventListener('mouseover', (e)=>{
      if(toastStackExpanded || !e.target.closest('.toast')) return;
      toastStackExpanded = true;
      toastStackEl.querySelectorAll('.toast').forEach(el=> el._pauseTimer?.());
      restackToasts();
    });
    toastStackEl.addEventListener('mouseout', (e)=>{
      if(!toastStackExpanded) return;
      // relatedTarget is where the mouse is going — if it's still
      // somewhere inside the stack (moving between sibling toasts),
      // this isn't a real "leave" yet, just a move within the group.
      if(e.relatedTarget && toastStackEl.contains(e.relatedTarget)) return;
      toastStackExpanded = false;
      toastStackEl.querySelectorAll('.toast').forEach(el=> el._resumeTimer?.());
      restackToasts();
    });
  }

  // Native date inputs only open their picker when clicking the small
  // calendar icon in most browsers — this makes the whole field
  // clickable instead, so people don't have to aim for that one icon.
  document.addEventListener('click', (e)=>{
    const target = e.target.closest('input[type="date"]');
    if(target && !target.disabled && typeof target.showPicker === 'function'){
      try{ target.showPicker(); }catch(err){ /* e.g. already open, or a browser restriction — fine either way */ }
    }
  });
})();

// Push notifications — register the service worker. Feature-detected since
// not every browser/context supports this; failures are logged, not surfaced.
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('/sw.js')
    .then(reg => console.log('Service worker registered:', reg.scope))
    .catch(err => console.warn('Service worker registration failed:', err));
}
