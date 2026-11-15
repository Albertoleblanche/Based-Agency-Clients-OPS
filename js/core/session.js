// Theme, sidebar and mobile nav, signed-in identity and roles
// (myProfile, isAdmin, canApprove…), profile loading, button loading states.

/* ---------- Theme ---------- */
async function initTheme(){
  try{
    // myProfile.theme is the real, per-account source of truth — only
    // fall back to the localStorage guess if this account has never set
    // a preference at all (myProfile.theme is null/undefined).
    const pref = myProfile && myProfile.theme != null ? myProfile.theme : localStorage.getItem('bda_theme');
    if(pref === 'dark') document.body.dataset.theme = 'dark';
    else delete document.body.dataset.theme;
    // Keep localStorage in sync so this device's early FOUC-prevention
    // script (which runs before login, with no access to Supabase) has
    // an accurate guess to paint with on the next load.
    localStorage.setItem('bda_theme', pref === 'dark' ? 'dark' : 'light');
  }catch(e){ delete document.body.dataset.theme; }
}

function toggleSidebar(){
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

function toggleSidebarProfileMenu(){
  const trigger = document.querySelector('.sidebar-profile-trigger');
  const menu = document.getElementById('sidebarProfileMenu');
  const isOpen = menu.style.display === 'block';
  if(isOpen){ closeSidebarProfileMenu(); return; }
  menu.style.display = 'block';
  trigger.classList.add('open');
}
function closeSidebarProfileMenu(){
  const menu = document.getElementById('sidebarProfileMenu');
  if(menu) menu.style.display = 'none';
  document.querySelector('.sidebar-profile-trigger')?.classList.remove('open');
}
function switchToMobileVersion(){
  try{ localStorage.removeItem('bda_force_desktop'); }catch(e){}
  window.location.href = '/mobile.html';
}

async function toggleDarkMode(){
  // Page-wide color fade only for the moment of switching (see .theme-switching CSS).
  document.body.classList.add('theme-switching');
  clearTimeout(toggleDarkMode._t);
  toggleDarkMode._t = setTimeout(()=> document.body.classList.remove('theme-switching'), 260);
  const isDark = document.body.dataset.theme === 'dark';
  const newTheme = isDark ? 'light' : 'dark';
  if(isDark){ delete document.body.dataset.theme; }
  else { document.body.dataset.theme = 'dark'; }
  try{ localStorage.setItem('bda_theme', newTheme); }catch(e){}
  syncDarkModeToggleUI();
  if(currentUser){
    if(myProfile) myProfile.theme = newTheme;
    const { error } = await supabaseClient.from('team_profiles').update({ theme: newTheme }).eq('id', currentUser.id);
    if(error){
      console.error('toggleDarkMode save error:', error);
      showToast('error','Preference not saved','This won\'t follow you to other devices — ask your admin to check the theme column exists on team_profiles.');
    }
  }
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
  if(!e.target.closest('.sidebar-foot')) closeSidebarProfileMenu();
});

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
        placeholderEl.textContent = myProfile && myProfile.name ? myProfile.name.trim().charAt(0).toUpperCase() : '?';
        placeholderEl.style.background = myProfile && myProfile.name ? avatarColorForName(myProfile.name) : '';
        placeholderEl.style.color = '#fff';
      }
    }
  }
  if(nameEl && roleEl){
    if(myProfile){
      nameEl.textContent = myProfile.name;
      roleEl.textContent = myProfile.title || roleDisplayLabel(myProfile.role);
    } else {
      nameEl.textContent = '—'; roleEl.textContent = '';
    }
  }
}

async function handleLogout(){
  await supabaseClient.auth.signOut();
  // onAuthStateChange fires SIGNED_OUT → showLoginScreen() runs.
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
