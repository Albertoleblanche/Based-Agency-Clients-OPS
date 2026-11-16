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
  { title:"Welcome to Based Agency 👋", body:"A quick, two-minute walk through everything — Skip anytime, or come back to this later from the sidebar.", icon:'<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M178,40c-20.65,0-38.73,8.88-50,23.89C116.73,48.88,98.65,40,78,40a62.07,62.07,0,0,0-62,62c0,70,103.79,126.66,108.21,129a8,8,0,0,0,7.58,0C136.21,228.66,240,172,240,102A62.07,62.07,0,0,0,178,40ZM128,214.8C109.74,204.16,32,155.69,32,102A46.06,46.06,0,0,1,78,56c19.45,0,35.78,10.36,42.6,27a8,8,0,0,0,14.8,0c6.82-16.67,23.15-27,42.6-27a46.06,46.06,0,0,1,46,46C224,155.61,146.24,204.15,128,214.8Z"/></svg>' },
  { view:'overview', target:'[data-view="overview"]', title:"Your Overview", body:"Greets you by name and surfaces what actually needs attention today — client health, pending approvals, and how much of this week's work is already logged.", icon:'<svg width="17" height="17" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M104,40H56A16,16,0,0,0,40,56v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V56A16,16,0,0,0,104,40Zm0,64H56V56h48v48Zm96-64H152a16,16,0,0,0-16,16v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V56A16,16,0,0,0,200,40Zm0,64H152V56h48v48Zm-96,32H56a16,16,0,0,0-16,16v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V152A16,16,0,0,0,104,136Zm0,64H56V152h48v48Zm96-64H152a16,16,0,0,0-16,16v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V152A16,16,0,0,0,200,136Zm0,64H152V152h48v48Z"/></svg>' },
  { view:'clients', target:'[data-view="clients"]', title:"Client Roster", body:"Every client lives here — search, filter, sort. Log an improvement the moment you make one, from any client's row. \"Past Improvements\" up top is the full team's history, searchable by date.", icon:'<svg width="17" height="17" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M117.25,157.92a60,60,0,1,0-66.5,0A95.83,95.83,0,0,0,3.53,195.63a8,8,0,1,0,13.4,8.74,80,80,0,0,1,134.14,0,8,8,0,0,0,13.4-8.74A95.83,95.83,0,0,0,117.25,157.92ZM40,108a44,44,0,1,1,44,44A44.05,44.05,0,0,1,40,108Zm210.14,98.7a8,8,0,0,1-11.07-2.33A79.83,79.83,0,0,0,172,168a8,8,0,0,1,0-16,44,44,0,1,0-16.34-84.87,8,8,0,1,1-5.94-14.85,60,60,0,0,1,55.53,105.64,95.83,95.83,0,0,1,47.22,37.71A8,8,0,0,1,250.14,206.7Z"/></svg>' },
  { view:'notes', target:'[data-view="notes"]', title:"Notes — just for you", body:"Jot down something you want to get to for a client. This one's genuinely private — nobody else on the team can see it, not even a peek. When you actually do the work, turn it into a real logged improvement in one click.", icon:'<svg width="17" height="17" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M229.66,58.34l-32-32a8,8,0,0,0-11.32,0l-96,96A8,8,0,0,0,88,128v32a8,8,0,0,0,8,8h32a8,8,0,0,0,5.66-2.34l96-96A8,8,0,0,0,229.66,58.34ZM124.69,152H104V131.31l64-64L188.69,88ZM200,76.69,179.31,56,192,43.31,212.69,64ZM224,128v80a16,16,0,0,1-16,16H48a16,16,0,0,1-16-16V48A16,16,0,0,1,48,32h80a8,8,0,0,1,0,16H48V208H208V128a8,8,0,0,1,16,0Z"/></svg>' },
  { view:'tasks', target:'[data-view="tasks"]', title:"Tasks", body:"Assign something to anyone on the team — only you and them ever see it. Once it's done, \"View Archive\" holds a searchable record of everything you've personally wrapped up.", icon:'<svg width="17" height="17" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M224,48V208a16,16,0,0,1-16,16H136a8,8,0,0,1,0-16h72V48H48v96a8,8,0,0,1-16,0V48A16,16,0,0,1,48,32H208A16,16,0,0,1,224,48ZM125.66,154.34a8,8,0,0,0-11.32,0L64,204.69,45.66,186.34a8,8,0,0,0-11.32,11.32l24,24a8,8,0,0,0,11.32,0l56-56A8,8,0,0,0,125.66,154.34Z"/></svg>' },
  { view:'reminders', target:'[data-view="reminders"]', title:"Reminders", body:"For client questions waiting on a reply — visible to the whole team, so nothing sits forgotten just because one person's out.", icon:'<svg width="17" height="17" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M221.8,175.94C216.25,166.38,208,139.33,208,104a80,80,0,1,0-160,0c0,35.34-8.26,62.38-13.81,71.94A16,16,0,0,0,48,200H88.81a40,40,0,0,0,78.38,0H208a16,16,0,0,0,13.8-24.06ZM128,216a24,24,0,0,1-22.62-16h45.24A24,24,0,0,1,128,216ZM48,184c7.7-13.24,16-43.92,16-80a64,64,0,1,1,128,0c0,36.05,8.28,66.73,16,80Z"/></svg>' },
  { view:'calendar', target:'[data-view="calendar"]', title:"Calendar", body:"One shared calendar for meetings, deadlines, and follow-ups. Add a task or reminder to it straight from where you created it.", icon:'<svg width="17" height="17" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M208,32H184V24a8,8,0,0,0-16,0v8H88V24a8,8,0,0,0-16,0v8H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM72,48v8a8,8,0,0,0,16,0V48h80v8a8,8,0,0,0,16,0V48h24V80H48V48ZM208,208H48V96H208V208Z"/></svg>' },
  { view:'time', timeTab:'timesheet', target:'[data-view="time"]', title:"Track time, live", body:"Start a timer for any client and service — a little pill follows you to every other tab so you can stop it from anywhere, not just here.", icon:'<svg width="17" height="17" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm64-88a8,8,0,0,1-8,8H128a8,8,0,0,1-8-8V72a8,8,0,0,1,16,0v48h48A8,8,0,0,1,192,128Z"/></svg>' },
  { view:'team', target:'[data-view="team"]', title:"Team", body:"Everyone on the team, their roles, and what they do — always visible, even if you can't edit it yourself.", icon:'<svg width="17" height="17" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M117.25,157.92a60,60,0,1,0-66.5,0A95.83,95.83,0,0,0,3.53,195.63a8,8,0,1,0,13.4,8.74,80,80,0,0,1,134.14,0,8,8,0,0,0,13.4-8.74A95.83,95.83,0,0,0,117.25,157.92ZM40,108a44,44,0,1,1,44,44A44.05,44.05,0,0,1,40,108Zm210.14,98.7a8,8,0,0,1-11.07-2.33A79.83,79.83,0,0,0,172,168a8,8,0,0,1,0-16,44,44,0,1,0-16.34-84.87,8,8,0,1,1-5.94-14.85,60,60,0,0,1,55.53,105.64,95.83,95.83,0,0,1,47.22,37.71A8,8,0,0,1,250.14,206.7Z"/></svg>' },
  { view:'trash', target:'[data-view="trash"]', title:"Trash", body:"A misclick is never permanent. Deleted notes and time entries land here first — restore anytime, or clear them for good.", icon:'<svg width="17" height="17" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z"/></svg>' },
  { view:'settings', target:'[data-view="settings"]', title:"Settings & Integrations", body:"What's actually connected right now, no guessing — plus your own notification preferences, so you only hear about what you actually want to.", icon:'<svg width="17" height="17" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M128,80a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Zm109.94-52.79a8,8,0,0,0-3.89-5.4l-29.83-17-.12-33.62a8,8,0,0,0-2.83-6.08,111.91,111.91,0,0,0-36.72-20.67,8,8,0,0,0-6.46.59L128,41.85,97.88,25a8,8,0,0,0-6.47-.6A112.1,112.1,0,0,0,54.73,45.15a8,8,0,0,0-2.83,6.07l-.15,33.65-29.83,17a8,8,0,0,0-3.89,5.4,106.47,106.47,0,0,0,0,41.56,8,8,0,0,0,3.89,5.4l29.83,17,.12,33.62a8,8,0,0,0,2.83,6.08,111.91,111.91,0,0,0,36.72,20.67,8,8,0,0,0,6.46-.59L128,214.15,158.12,231a7.91,7.91,0,0,0,3.9,1,8.09,8.09,0,0,0,2.57-.42,112.1,112.1,0,0,0,36.68-20.73,8,8,0,0,0,2.83-6.07l.15-33.65,29.83-17a8,8,0,0,0,3.89-5.4A106.47,106.47,0,0,0,237.94,107.21Zm-15,34.91-28.57,16.25a8,8,0,0,0-3,3c-.58,1-1.19,2.06-1.81,3.06a7.94,7.94,0,0,0-1.22,4.21l-.15,32.25a95.89,95.89,0,0,1-25.37,14.3L134,199.13a8,8,0,0,0-3.91-1h-.19c-1.21,0-2.43,0-3.64,0a8.08,8.08,0,0,0-4.1,1l-28.84,16.1A96,96,0,0,1,67.88,201l-.11-32.2a8,8,0,0,0-1.22-4.22c-.62-1-1.23-2-1.8-3.06a8.09,8.09,0,0,0-3-3.06l-28.6-16.29a90.49,90.49,0,0,1,0-28.26L61.67,97.63a8,8,0,0,0,3-3c.58-1,1.19-2.06,1.81-3.06a7.94,7.94,0,0,0,1.22-4.21l.15-32.25a95.89,95.89,0,0,1,25.37-14.3L122,56.87a8,8,0,0,0,4.1,1c1.21,0,2.43,0,3.64,0a8.08,8.08,0,0,0,4.1-1l28.84-16.1A96,96,0,0,1,188.12,55l.11,32.2a8,8,0,0,0,1.22,4.22c.62,1,1.23,2,1.8,3.06a8.09,8.09,0,0,0,3,3.06l28.6,16.29A90.49,90.49,0,0,1,222.9,142.12Z"/></svg>' },
  { view:'profile', target:'.sidebar-profile-trigger', title:"Your Profile", body:"Your name, phone, and photo — visible to the rest of the team the same way it always has been. Update your email here too, if it ever changes.", icon:'<svg width="17" height="17" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M230.92,212c-15.23-26.33-38.7-45.21-66.09-54.16a72,72,0,1,0-73.66,0C63.78,166.78,40.31,185.66,25.08,212a8,8,0,1,0,13.85,8c18.84-32.56,52.14-52,89.07-52s70.23,19.44,89.07,52a8,8,0,1,0,13.85-8ZM72,96a56,56,0,1,1,56,56A56.06,56.06,0,0,1,72,96Z"/></svg>' },

  { view:'teamqueue', target:'#teamQueueNavItem', title:"Team Queue", body:"You also get the wider view — every draft across the whole team in one place, not just your own, so nothing slips through.", icon:'<svg width="17" height="17" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M117.25,157.92a60,60,0,1,0-66.5,0A95.83,95.83,0,0,0,3.53,195.63a8,8,0,1,0,13.4,8.74,80,80,0,0,1,134.14,0,8,8,0,0,0,13.4-8.74A95.83,95.83,0,0,0,117.25,157.92ZM40,108a44,44,0,1,1,44,44A44.05,44.05,0,0,1,40,108Zm210.14,98.7a8,8,0,0,1-11.07-2.33A79.83,79.83,0,0,0,172,168a8,8,0,0,1,0-16,44,44,0,1,0-16.34-84.87,8,8,0,1,1-5.94-14.85,60,60,0,0,1,55.53,105.64,95.83,95.83,0,0,1,47.22,37.71A8,8,0,0,1,250.14,206.7Z"/></svg>', show:()=>hasPermission('view_team_queue') },

  { view:'team', teamTab:'add', target:'[data-view="team"]', title:"Bringing someone new on", body:"A couple of things here that not everyone sees — adding new people, setting job titles, and reviewing anyone's requested email change.", icon:'<svg width="17" height="17" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M224,128a8,8,0,0,1-8,8H136v80a8,8,0,0,1-16,0V136H40a8,8,0,0,1,0-16h80V40a8,8,0,0,1,16,0v80h80A8,8,0,0,1,224,128Z"/></svg>', show:()=>isAdmin() },
  { view:'time', timeTab:'payroll', target:'#payrollTab', title:"Payroll", body:"This tab's just for you — nobody else on the team even sees it exists.", icon:'<svg width="17" height="17" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M152,120H136V56h8a32,32,0,0,1,32,32,8,8,0,0,0,16,0,48.05,48.05,0,0,0-48-48h-8V24a8,8,0,0,0-16,0V40h-8a48,48,0,0,0,0,96h8v64H104a32,32,0,0,1-32-32,8,8,0,0,0-16,0,48.05,48.05,0,0,0,48,48h16v16a8,8,0,0,0,16,0V216h16a48,48,0,0,0,0-96Zm-40,0a32,32,0,0,1,0-64h8v64Zm40,80H136V136h16a32,32,0,0,1,0,64Z"/></svg>', show:()=>isAdmin() },

  { title:"That's everything 🎉", body:"You're set. Come back to this tour anytime from the sidebar if you want a refresher.", isFinal:true, icon:'<svg width="26" height="26" viewBox="0 0 256 256" fill="currentColor"><path d="M232.49,80.49l-128,128a12,12,0,0,1-17,0l-56-56a12,12,0,1,1,17-17L96,183,215.51,63.51a12,12,0,0,1,17,17Z"/></svg>' },
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
