// Guided product tour.

/* ---------- Take a tour ---------- */

// Skips switchView()'s await fullRefresh() entirely — that's seven
// sequential database queries plus a full render sweep, meant for actual
// navigation where data might be stale. During a tour, the app was
// already fully loaded and every view already rendered once at boot,
// moments before the tour started — re-fetching everything on every
// single step click is what was causing the ~2s delay per step. This
// keeps the fast, synchronous DOM-visibility half of switchView(), and
// nothing that touches the network.
function tourSwitchView(name){
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active', n.dataset.view===name));
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-'+name)?.classList.add('active');
  const meta = VIEW_TITLES[name];
  if(meta){
    const titleEl = document.getElementById('topbarTitle');
    const subEl = document.getElementById('topbarSub');
    if(titleEl) titleEl.textContent = (settings.navLabels && settings.navLabels[name]) || meta[0];
    if(subEl) subEl.textContent = meta[1];
  }
  // Fast, in-memory, no-network renders — kept as a safety net in case
  // someone starts the tour without having visited that tab themselves
  // yet this session, in which case its content might still be empty.
  if(name==='calendar') renderCalendar();
  if(name==='reminders') renderReminders();
  if(name==='task-archive'){ populateTaskArchiveFilters(); renderTaskArchive(); }
  if(name==='trash') renderTrash();
}
// Base, unfiltered list — every step this app could show, in order.
// requires:'approve' or requires:'admin' means "only include this step
// if the person taking the tour can actually do/see this" — the actual,
// filtered list a given person sees is built fresh in startTour(), from
// their real access right now, not a fixed script everyone gets.
//
// Copy is written to describe what someone can DO ("you can approve
// drafts", "this one's just for you") rather than ever naming a role —
// that's deliberate, not an oversight, per how this needs to read.
const tourSteps = [
  { title:"Welcome to Based Agency 👋", body:"A quick, two-minute walk through everything — Skip anytime, or come back to this later from the sidebar.", icon:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' },
  { view:'overview', target:'[data-view="overview"]', title:"Your Overview", body:"Greets you by name and surfaces what actually needs attention today — client health, pending approvals, and how much of this week's work is already logged.", icon:'<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>' },
  { view:'clients', target:'[data-view="clients"]', title:"Client Roster", body:"Every client lives here — search, filter, sort. Log an improvement the moment you make one, from any client's row. \"Past Improvements\" up top is the full team's history, searchable by date.", icon:'<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>' },
  { view:'notes', target:'[data-view="notes"]', title:"Notes — just for you", body:"Jot down something you want to get to for a client. This one's genuinely private — nobody else on the team can see it, not even a peek. When you actually do the work, turn it into a real logged improvement in one click.", icon:'<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' },
  { view:'tasks', target:'[data-view="tasks"]', title:"Tasks", body:"Assign something to anyone on the team — only you and them ever see it. Once it's done, \"View Archive\" holds a searchable record of everything you've personally wrapped up.", icon:'<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>' },
  { view:'reminders', target:'[data-view="reminders"]', title:"Reminders", body:"For client questions waiting on a reply — visible to the whole team, so nothing sits forgotten just because one person's out.", icon:'<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>' },
  { view:'calendar', target:'[data-view="calendar"]', title:"Calendar", body:"One shared calendar for meetings, deadlines, and follow-ups. Add a task or reminder to it straight from where you created it.", icon:'<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' },
  { view:'time', timeTab:'timesheet', target:'[data-view="time"]', title:"Track time, live", body:"Start a timer for any client and service — a little pill follows you to every other tab so you can stop it from anywhere, not just here.", icon:'<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' },
  { view:'team', target:'[data-view="team"]', title:"Team", body:"Everyone on the team, their roles, and what they do — always visible, even if you can't edit it yourself.", icon:'<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>' },
  { view:'trash', target:'[data-view="trash"]', title:"Trash", body:"A misclick is never permanent. Deleted notes and time entries land here first — restore anytime, or clear them for good.", icon:'<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>' },
  { view:'settings', target:'[data-view="settings"]', title:"Settings & Integrations", body:"What's actually connected right now, no guessing — plus your own notification preferences, so you only hear about what you actually want to.", icon:'<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>' },
  { view:'profile', target:'.sidebar-profile-trigger', title:"Your Profile", body:"Your name, phone, and photo — visible to the rest of the team the same way it always has been. Update your email here too, if it ever changes.", icon:'<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' },

  { view:'teamqueue', target:'#teamQueueNavItem', title:"Team Queue", body:"You also get the wider view — every draft across the whole team in one place, not just your own, so nothing slips through.", icon:'<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>', show:()=>hasPermission('view_team_queue') },

  { view:'team', teamTab:'add', target:'[data-view="team"]', title:"Bringing someone new on", body:"A couple of things here that not everyone sees — adding new people, setting job titles, and reviewing anyone's requested email change.", icon:'<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>', show:()=>isAdmin() },
  { view:'time', timeTab:'payroll', target:'#payrollTab', title:"Payroll", body:"This tab's just for you — nobody else on the team even sees it exists.", icon:'<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>', show:()=>isAdmin() },

  { title:"That's everything 🎉", body:"You're set. Come back to this tour anytime from the sidebar if you want a refresher.", isFinal:true, icon:'<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>' },
];
let tourIndex = 0;
let activeTourSteps = [];

async function startTour(){
  activeTourSteps = tourSteps.filter(s=> !s.show || s.show());
  tourIndex = 0;
  document.getElementById('tourCard').style.display = 'block';
  if(!document.getElementById('tourClickBlocker')){
    const blocker = document.createElement('div');
    blocker.className = 'tour-click-blocker';
    blocker.id = 'tourClickBlocker';
    document.body.appendChild(blocker);
  }
  await renderTourStep();
}

function clearTourSpotlight(){
  document.querySelectorAll('.tour-spotlight').forEach(el=>el.classList.remove('tour-spotlight'));
}

// Positions the card next to whatever's spotlighted — measures the
// card's own actual rendered size (already set with this step's real
// content by the time this runs) rather than a guessed size, so it's
// accurate regardless of how long any given step's text is. Defaults to
// the target's right side; falls back to below it if there's no room,
// and clamps to the viewport either way so it can never run off-screen.
// No target at all (welcome/closing) centers on screen instead.
function positionTourCard(targetEl){
  const card = document.getElementById('tourCard');
  if(!targetEl){
    card.classList.add('tour-card-centered');
    card.style.left = ''; card.style.top = '';
    return;
  }
  card.classList.remove('tour-card-centered');
  const rect = targetEl.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const gap = 18, edge = 16;
  const vw = window.innerWidth, vh = window.innerHeight;

  let left = rect.right + gap;
  let top = rect.top + rect.height/2 - cardRect.height/2;

  if(left + cardRect.width > vw - edge){
    left = rect.left;
    top = rect.bottom + gap;
  }

  left = Math.max(edge, Math.min(left, vw - cardRect.width - edge));
  top = Math.max(edge, Math.min(top, vh - cardRect.height - edge));

  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
}

async function renderTourStep(){
  const step = activeTourSteps[tourIndex];
  clearTourSpotlight();
  if(step.view) tourSwitchView(step.view);
  if(step.timeTab) switchTimeTab(step.timeTab);
  if(step.settingsTab) switchSettingsTab(step.settingsTab);
  if(step.teamTab) switchTeamTab(step.teamTab);

  const card = document.getElementById('tourCard');
  card.classList.toggle('tour-card-final', !!step.isFinal);

  const iconEl = document.getElementById('tourIcon');
  iconEl.innerHTML = step.isFinal
    ? `<span class="tour-final-icon">${step.icon}</span>`
    : `<span class="tour-icon">${step.icon}</span>`;

  const titleEl = document.getElementById('tourTitle');
  const bodyEl = document.getElementById('tourBody');
  titleEl.textContent = step.title;
  bodyEl.textContent = step.body;
  // Restart the fade-in animation on every step change — removing and
  // re-adding the class forces the browser to treat it as a fresh
  // animation rather than a no-op on an already-applied class.
  [titleEl, bodyEl].forEach(el=>{ el.classList.remove('tour-body-fade'); void el.offsetWidth; el.classList.add('tour-body-fade'); });

  document.getElementById('tourStepCount').textContent = `${tourIndex+1} of ${activeTourSteps.length}`;
  document.getElementById('tourPrevBtn').classList.toggle('hidden-btn', tourIndex===0);
  document.getElementById('tourNextBtn').textContent = step.isFinal ? "Let's go!" : 'Next';

  let targetEl = null;
  if(step.target){
    targetEl = document.querySelector(step.target);
    if(targetEl){ targetEl.classList.add('tour-spotlight'); targetEl.scrollIntoView({block:'nearest', behavior:'smooth'}); }
  }
  positionTourCard(targetEl);
}

async function tourNext(){
  if(tourIndex >= activeTourSteps.length-1){ endTour(); return; }
  tourIndex++;
  await renderTourStep();
}

async function tourPrev(){
  if(tourIndex<=0) return;
  tourIndex--;
  await renderTourStep();
}

function endTour(){
  document.getElementById('tourCard').style.display = 'none';
  document.getElementById('tourCard').classList.remove('tour-card-final', 'tour-card-centered');
  clearTourSpotlight();
  document.getElementById('tourClickBlocker')?.remove();
}
