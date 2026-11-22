// Theme, sidebar and mobile nav, signed-in identity and roles
// (myProfile, isAdmin, canApprove…), profile loading, button loading states.

/* ---------- Theme ---------- */
// Appearance is 'auto' (follows the computer), 'light', 'dark', or 'night': dark from night to
// morning, light through the day. 'night' is 7 PM to 7 AM; other hours are kept as
// 'night:20:00-06:30'. myProfile.theme follows you to other devices; localStorage is this device's
// guess for the first paint, before you're signed in.
const NIGHT_HOURS = ['19:00', '07:00'];
function themePrefNow(){
  try{ return (myProfile && myProfile.theme != null) ? myProfile.theme : (localStorage.getItem('bda_theme') || 'auto'); }catch(e){ return 'auto'; }
}
function nightHours(pref){
  const m = /^night(?::(\d{2}:\d{2})-(\d{2}:\d{2}))?$/.exec(pref || '');
  return m ? [m[1] || NIGHT_HOURS[0], m[2] || NIGHT_HOURS[1]] : null;
}
function nightPref(from, to){ return from === NIGHT_HOURS[0] && to === NIGHT_HOURS[1] ? 'night' : `night:${from}-${to}`; }
const hhmmToMin = v => { const [h, m] = String(v).split(':').map(Number); return h * 60 + (m || 0); };
function isNightNow(pref, now){
  const r = nightHours(pref); if(!r) return false;
  now = now || new Date();
  const t = now.getHours() * 60 + now.getMinutes(), a = hhmmToMin(r[0]), b = hhmmToMin(r[1]);
  return a === b ? false : a > b ? (t >= a || t < b) : (t >= a && t < b);
}
function resolvedTheme(pref){
  if(pref === 'dark' || pref === 'light') return pref;
  if(nightHours(pref)) return isNightNow(pref) ? 'dark' : 'light';
  return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
// Puts the right appearance on now and, for Night, sets a timer for the next change (in the
// evening it eases to dark while you work, in the morning back to light).
function applyTheme(fade){
  const pref = themePrefNow(), want = resolvedTheme(pref);
  if(document.body.dataset.theme !== want){
    if(fade){ document.body.classList.add('theme-switching'); clearTimeout(applyTheme._f); applyTheme._f = setTimeout(() => document.body.classList.remove('theme-switching'), 260); }
    document.body.dataset.theme = want;
  }
  if(typeof syncDarkModeToggleUI === 'function') syncDarkModeToggleUI();
  if(typeof onThemeApplied === 'function') onThemeApplied(want);
  clearTimeout(applyTheme._t);
  const r = nightHours(pref);
  if(r){
    const now = new Date(), t = now.getHours() * 60 + now.getMinutes();
    const mins = Math.min(...r.map(x => ((hhmmToMin(x) - t + 1440) % 1440) || 1440));
    applyTheme._t = setTimeout(() => applyTheme(true), mins * 60000 - now.getSeconds() * 1000 - now.getMilliseconds() + 400);
  }
}
// A computer that slept through the change catches up when you come back to it.
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible' && nightHours(themePrefNow())) applyTheme(true); });
async function initTheme(){
  try{
    applyTheme(false);
    // Keep this device's first-paint guess in step with the real choice; an unset one keeps
    // following the system.
    const pref = themePrefNow();
    if(pref && pref !== 'auto') localStorage.setItem('bda_theme', pref); else localStorage.removeItem('bda_theme');
    watchSystemTheme();
  }catch(e){ document.body.dataset.theme = 'light'; }
}

// While Appearance is Auto, follow the system live — e.g. when macOS switches to dark at sunset
// with its own Appearance set to "Auto".
function watchSystemTheme(){
  if(watchSystemTheme._on || !window.matchMedia) return;
  watchSystemTheme._on = true;
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const follow = () => { if(themePrefNow() === 'auto') applyTheme(true); };
  if(mq.addEventListener) mq.addEventListener('change', follow);
  else if(mq.addListener) mq.addListener(follow);
}
// Saves an appearance choice: this device at once, your account for your other devices.
async function saveThemePref(pref){
  const v = pref === 'auto' ? null : pref;
  if(myProfile) myProfile.theme = v;
  try{ v ? localStorage.setItem('bda_theme', v) : localStorage.removeItem('bda_theme'); }catch(e){}
  applyTheme(true);
  if(!currentUser) return;
  const { error } = await supabaseClient.from('team_profiles').update({ theme: v }).eq('id', currentUser.id);
  if(error){ console.error('theme save', error); showToast('info', 'Saved on this computer', 'Your other devices keep the appearance they had.'); }
}

/* ---------- New look ---------- */
// The widget look (rounded cards, big thin numbers, Geist) is everyone's look. team_profiles.ui_style
// keeps one person's choice from Settings → Appearance: null or 'widgets' is the new look, 'off' the
// classic one. This device remembers it for the first paint, like the theme.
function uiStyleOffered(){ return !!myProfile; }
function uiStyleOn(){ return uiStyleOffered() && myProfile.ui_style !== 'off'; }
function loadUiFont(){
  if(document.getElementById('uiwFont')) return;
  const l = document.createElement('link');
  l.id = 'uiwFont'; l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600&family=Geist+Mono:wght@400;500;600&display=swap';
  document.head.appendChild(l);
}
function applyUiStyle(){
  const on = uiStyleOn();
  document.documentElement.classList.toggle('ui-w', on);
  if(on) loadUiFont();
  try{ on ? localStorage.setItem('bda_ui_style', 'widgets') : localStorage.removeItem('bda_ui_style'); }catch(e){}
}
async function saveUiStyle(on){
  if(!uiStyleOffered() || !currentUser) return;
  const v = on ? 'widgets' : 'off';
  myProfile.ui_style = v;
  applyUiStyle();
  if(typeof renderDashboard === 'function') renderDashboard();   // the Dashboard has its own layout in each look
  const { error } = await supabaseClient.from('team_profiles').update({ ui_style: v }).eq('id', currentUser.id);
  if(error){ console.error('ui_style save', error); showToast('info', 'Saved on this computer', 'Your other devices keep the look they had.'); }
}

function toggleSidebar(){
  document.body.classList.add('side-anim');   // slide it, only when toggled (not on load)
  const collapsed = document.body.classList.toggle('sidebar-collapsed');
  try{ localStorage.setItem('bda_sidebar_collapsed', collapsed ? '1' : '0'); }catch(e){}
  const btn = document.querySelector('.sidebar-collapse-btn');
  if(btn) btn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
}

function initSidebarState(){
  let collapsed = false;
  try{ collapsed = localStorage.getItem('bda_sidebar_collapsed') === '1'; }catch(e){}
  if(collapsed){
    document.body.classList.add('sidebar-collapsed');
    const btn = document.querySelector('.sidebar-collapse-btn');
    if(btn) btn.title = 'Expand sidebar';
  }
}

function toggleMobileNav(){
  document.body.classList.contains('mobile-nav-open') ? closeMobileNav() : openMobileNav();
}

function openMobileNav(){
  document.body.classList.add('mobile-nav-open');
  document.body.style.overflow = 'hidden';
  const toggleBtn = document.querySelector('.mobile-nav-toggle');
  if(toggleBtn) toggleBtn.setAttribute('aria-expanded', 'true');
  document.addEventListener('keydown', closeMobileNavOnEscape);
}

function closeMobileNav(){
  document.body.classList.remove('mobile-nav-open');
  document.body.style.overflow = '';
  const toggleBtn = document.querySelector('.mobile-nav-toggle');
  if(toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
  document.removeEventListener('keydown', closeMobileNavOnEscape);
}

function closeMobileNavOnEscape(e){
  if(e.key==='Escape') closeMobileNav();
}

/* ---------- Real identity — comes from Supabase Auth + team_profiles, not self-reported ---------- */
let currentUser = null;   // Supabase auth user object
let myProfile = null;     // { id, name, email, role }
let teamProfiles = [];    // everyone's profiles, for the Team admin panel
let currentDetailClientId = null;  // which client's detail page is open, if any

function myName(){ return myProfile ? myProfile.name : ''; }
function canApprove(){ return !!myProfile && (myProfile.role === 'admin' || myProfile.role === 'approver'); }
function hasPermission(key){ return canApprove() || !!(myProfile && (myProfile.extra_permissions||[]).includes(key)); }
function isAdmin(){ return !!myProfile && myProfile.role === 'admin'; }
// Deliberately NOT built on hasPermission()/canApprove() — those treat
// "approver or admin" as the same automatic base tier, but this one is
// admin-only by default, with a specific per-person override (see the
// "Lower a client's danger score" toggle on the team card) rather than a
// role-wide grant. An approver doesn't get this just for being an
// approver, unlike everything hasPermission() covers.
function canLowerDangerScore(){ return isAdmin() || !!(myProfile && (myProfile.extra_permissions||[]).includes('lower_danger_score')); }

let lastProfileError = null;
async function loadMyProfile(){
  if(!currentUser) return;
  const { data, error } = await supabaseClient.from('team_profiles').select('*').eq('id', currentUser.id).maybeSingle();
  if(error){ console.error('loadMyProfile error:', error); lastProfileError = error; }
  else { lastProfileError = null; }
  myProfile = data;
}

async function loadTeamProfiles(){
  const { data } = await supabaseClient.from('team_profiles').select('*').order('name');
  teamProfiles = data || [];
}

let dangerHistory = [];
async function loadDangerHistory(){
  const { data, error } = await supabaseClient.from('client_danger_history').select('*');
  if(error){ console.error('loadDangerHistory error', error); dangerHistory = []; return; }
  dangerHistory = (data||[]).map(h => ({ clientId: h.client_id, danger: h.danger, recordedAt: new Date(h.recorded_at) }));
}

// One-time backfill for clients that predate this feature — gives every
// existing active client a starting history point at their current value,
// dated today. Admin-only: narrows (doesn't fully eliminate, but greatly
// reduces) the odds of two people simultaneously triggering a duplicate
// bulk-insert in the brief window right after this ships and before
// anyone has actually seeded it yet.
async function seedDangerHistoryIfEmpty(){
  if(dangerHistory.length > 0 || !isAdmin()) return;
  const ac = activeClients();
  if(!ac.length) return;
  const rows = ac.map(c => ({ client_id: c.id, danger: c.danger }));
  const { error } = await supabaseClient.from('client_danger_history').insert(rows);
  if(error){ console.error('seedDangerHistoryIfEmpty error', error); return; }
  await loadDangerHistory();
}

// The account menu floats above your name, wider than the sidebar: it lives on the page itself
// (the sidebar would clip it), placed from the button each time it opens.
function toggleSidebarProfileMenu(){
  const trigger = document.querySelector('.sidebar-profile-trigger');
  const menu = document.getElementById('sidebarProfileMenu');
  const isOpen = menu.style.display === 'block';
  if(isOpen){ closeSidebarProfileMenu(); return; }
  if(menu.parentElement !== document.body) document.body.appendChild(menu);
  const foot = trigger.closest('.side-foot') || trigger, r = foot.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.round(r.left)) + 'px';
  menu.style.bottom = Math.round(window.innerHeight - r.top + 6) + 'px';
  menu.dataset.from = 'below';   // it opens upward from your name, and closes back down into it
  menu.style.display = 'block';
  trigger.classList.add('open');
}
function closeSidebarProfileMenu(){
  const menu = document.getElementById('sidebarProfileMenu');
  if(menu && menu.style.display !== 'none') typeof hidePop === 'function' ? hidePop(menu) : (menu.style.display = 'none');
  document.querySelector('.sidebar-profile-trigger')?.classList.remove('open');
}
function switchToMobileVersion(){
  try{ localStorage.removeItem('bda_force_desktop'); }catch(e){}
  window.location.href = '/mobile.html';
}

async function toggleDarkMode(){
  // the switch in your menu: a plain Light or Dark (Auto and Night to Morning are in Settings)
  await saveThemePref(document.body.dataset.theme === 'dark' ? 'light' : 'dark');
}

// Syncs the toggle switch's own visual .on state to match whatever the
// body's actual data-theme is — needed because the early FOUC-prevention
// script (which runs before this UI even exists in the DOM) only sets the
// body attribute itself, not this separate button element.
function syncDarkModeToggleUI(){
  const toggle = document.getElementById('darkModeToggle');
  if(toggle) toggle.classList.toggle('on', document.body.dataset.theme === 'dark');
}

document.addEventListener('click', function(e){
  if(!e.target.closest('.side-foot') && !e.target.closest('#sidebarProfileMenu')) closeSidebarProfileMenu();
});
document.addEventListener('keydown', function(e){
  if(e.key === 'Escape' && document.getElementById('sidebarProfileMenu')?.style.display === 'block') closeSidebarProfileMenu();
});
window.addEventListener('resize', () => closeSidebarProfileMenu());

function roleDisplayLabel(role){
  return role==='admin' ? 'Admin' : role==='approver' ? 'Approver' : 'Team member';
}

function renderWhoAmI(){
  document.querySelectorAll('.who-am-i').forEach(el=>{
    if(!myProfile){ el.innerHTML = ''; return; }
    el.innerHTML = `Logging as <b>${escapeHtml(myProfile.name)}</b> <span class="role-chip">${escapeHtml(roleDisplayLabel(myProfile.role))}</span>`;
  });
  const nameEl = document.getElementById('sidebarProfileName');
  const roleEl = document.getElementById('sidebarProfileRole');
  const avatarEl = document.getElementById('sidebarProfileAvatar');
  const placeholderEl = document.getElementById('topbarAvatarPlaceholder');
  if(avatarEl){
    if(myProfile && myProfile.avatar_url){
      avatarEl.src = myProfile.avatar_url; avatarEl.style.display = 'block';
      if(placeholderEl) placeholderEl.style.display = 'none';
    } else {
      avatarEl.style.display = 'none';
      if(placeholderEl){
        placeholderEl.style.display = 'flex';
        placeholderEl.textContent = myProfile && myProfile.name ? initialsOf(myProfile.name) : '?';
        placeholderEl.className = 'av a' + (myProfile && myProfile.name ? avatarColorIndex(myProfile.name) : 1);
      }
    }
  }
  if(nameEl && roleEl){
    if(myProfile){
      nameEl.textContent = myProfile.name;
      // what you do (Account Manager, PPC Specialist), not your access level; the access level
      // only shows if no job title has been set
      roleEl.textContent = (myProfile.title || '').trim() || roleDisplayLabel(myProfile.role);
    } else {
      nameEl.textContent = '—'; roleEl.textContent = '';
    }
  }
}

async function handleLogout(){
  closeFloatingUi();
  await supabaseClient.auth.signOut();
  // onAuthStateChange fires SIGNED_OUT → showLoginScreen() runs.
}

// Signing out: what floats over the app (the account menu, open menus and pickers, a sheet, the
// bell's panel, an (i) tip) closes, and the ones made on the fly go, so nothing is left over the
// sign-in screen or comes back after the next sign-in. While signed out, the body's "signed-out"
// class hides everything but the sign-in screen and toasts (mac.css).
const STATIC_EL = new WeakSet();
document.addEventListener('DOMContentLoaded', () => document.querySelectorAll('*').forEach(el => STATIC_EL.add(el)));
function closeFloatingUi(){
  try{
    if(typeof closeSidebarProfileMenu === 'function') closeSidebarProfileMenu();
    if(typeof closeAppModal === 'function') closeAppModal();
    if(typeof itipHide === 'function') itipHide();
    if(typeof closeTeamActionsMenu === 'function') closeTeamActionsMenu();
    const np = document.getElementById('notifPanel'); if(np) np.style.display = 'none';
    const ts = document.getElementById('toastStack'); if(ts) ts.innerHTML = ''; // messages from before don't carry over
    [...document.body.children].forEach(el => {
      if(['SCRIPT', 'STYLE', 'LINK', 'TEMPLATE'].includes(el.tagName) || el.id === 'loginOverlay' || el.id === 'appRoot' || el.id === 'toastStack' || el.id === 'itipPop') return;
      if(!STATIC_EL.has(el)) el.remove();
    });
  }catch(e){ console.warn('closeFloatingUi', e); }
}

/* ---------- Button loading state ---------- */
function setBtnLoading(btn, label){
  if(!btn || btn.tagName!=='BUTTON') return;
  btn.dataset.originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>${escapeHtml(label) || 'Working…'}`;
}
function restoreBtn(btn){
  if(!btn || btn.tagName!=='BUTTON') return;
  if(btn.dataset.originalHtml !== undefined){ btn.innerHTML = btn.dataset.originalHtml; delete btn.dataset.originalHtml; }
  btn.disabled = false;
}
function clickedBtn(){
  const el = document.activeElement;
  return (el && el.tagName==='BUTTON') ? el : null;
}
