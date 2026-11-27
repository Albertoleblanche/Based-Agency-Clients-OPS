// Take a tour: one short card per screen, next to it in the sidebar. Opened from the menu
// under your name. Steps for screens someone can't see are left out.

const tourSteps = [
  { title: 'Welcome to Based Radar', body: 'A one-minute look at where everything lives. Skip anytime; the tour stays in the menu under your name.', icon: 'compass' },
  { view: 'overview', title: 'Dashboard', body: 'Your day at a glance: what needs you now, your tasks, client health, the calendar, follow-ups, WhatsApp and notes.' },
  { view: 'approve', title: 'This Week', body: 'Every client gets one update a week, sent by an approver the day it’s ready. Overdue ones come first, then the ones due today.' },
  { view: 'queue', title: 'Queue', body: 'Your logged work, client by client. Switch items between the email and internal, log more with its date and time, write the draft and follow it until it’s sent.' },
  { view: 'teamqueue', title: 'Review', body: 'Drafts waiting for an approver. Read them, edit, and send.' },
  { view: 'clients', title: 'All Clients', body: 'Every client with its service, owner, health and importance. Open one to see its whole history.' },
  { view: 'health', title: 'Health', body: 'Clients at risk or worth watching, the signals behind it, and the next step.' },
  { view: 'tasks', title: 'Tasks', body: 'Work you hand out or get. Only the two people on a task can see it.' },
  { view: 'reminders', title: 'Reminders', body: 'Questions waiting on a client. The whole team sees them, so nothing is forgotten when someone is out.' },
  { view: 'notes', title: 'Notes', body: 'Your own ideas for a client. Nobody else can see them.' },
  { view: 'calendar', title: 'Calendar', body: 'Meetings, deadlines and the weekly send in one place, synced with Google Calendar.' },
  { view: 'time', title: 'Time', body: 'Start a timer for a client and it stays in the toolbar wherever you go. Reports and the daily summary are here too.' },
  { view: 'team', title: 'Team', body: 'Everyone on the team, their role and the clients they look after.' },
  { view: 'trash', title: 'Recently Deleted', body: 'Deleted notes and time wait here first, so a misclick is never permanent.' },
  { view: 'settings', title: 'Settings', body: 'The weekly schedule, client fields, AI, integrations and the notifications you get.' },
  { title: 'That’s the tour', body: 'Press ⌘K anytime to find a client or jump to a screen.', icon: 'check', isFinal: true },
];
let tourIndex = 0;
let activeTourSteps = [];

function tourNavItem(view){ return document.querySelector(`#appSidebar .nav-item[data-view="${view}"]`) || document.querySelector(`.nav-item[data-view="${view}"]`); }
function tourVisible(el){ return !!el && getComputedStyle(el).display !== 'none' && el.offsetParent !== null; }

async function startTour(){
  activeTourSteps = tourSteps.filter(s => !s.view || tourVisible(tourNavItem(s.view)))
    .map(s => s.view && typeof viewTitle === 'function' ? Object.assign({}, s, { title: viewTitle(s.view) }) : s);
  tourIndex = 0;
  const card = document.getElementById('tourCard');
  card.style.display = 'block';
  const x = document.getElementById('tourCloseBtn'); if(x && !x.innerHTML) x.innerHTML = icon('x');
  if(!document.getElementById('tourClickBlocker')){
    const blocker = document.createElement('div');
    blocker.className = 'tour-click-blocker';
    blocker.id = 'tourClickBlocker';
    document.body.appendChild(blocker);
  }
  document.addEventListener('keydown', tourKeydown, true);
  renderTourStep();
}
function tourKeydown(e){
  if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); endTour(); }
  else if(e.key === 'ArrowRight' || e.key === 'Enter'){ e.preventDefault(); tourNext(); }
  else if(e.key === 'ArrowLeft'){ e.preventDefault(); tourPrev(); }
}
function clearTourSpotlight(){ document.querySelectorAll('.tour-spotlight').forEach(el => el.classList.remove('tour-spotlight')); }

// Beside the sidebar item it's about; centred for the first and last cards.
function positionTourCard(target){
  const card = document.getElementById('tourCard');
  if(!target){ card.classList.add('tour-card-centered'); card.style.left = ''; card.style.top = ''; return; }
  card.classList.remove('tour-card-centered');
  const r = target.getBoundingClientRect(), c = card.getBoundingClientRect(), edge = 16;
  let left = r.right + 14, top = r.top + r.height / 2 - 28;
  if(left + c.width > innerWidth - edge){ left = r.left; top = r.bottom + 12; }
  card.style.left = Math.max(edge, Math.min(left, innerWidth - c.width - edge)) + 'px';
  card.style.top = Math.max(edge, Math.min(top, innerHeight - c.height - edge)) + 'px';
}

function renderTourStep(){
  const step = activeTourSteps[tourIndex];
  clearTourSpotlight();
  if(step.view) switchView(step.view);
  const card = document.getElementById('tourCard');
  card.classList.toggle('tour-card-final', !!step.isFinal);
  const appName = (typeof settings !== 'undefined' && settings.appName) || 'Based Agency';
  const target = step.view ? tourNavItem(step.view) : null;
  document.getElementById('tourIcon').innerHTML = step.icon ? icon(step.icon) : (target?.querySelector('svg')?.outerHTML || '');
  document.getElementById('tourTitle').textContent = tourIndex === 0 ? `Welcome to ${appName}` : step.title;
  document.getElementById('tourBody').textContent = step.body;
  document.getElementById('tourStepCount').textContent = `${tourIndex + 1} of ${activeTourSteps.length}`;
  document.getElementById('tourPrevBtn').hidden = tourIndex === 0;
  document.getElementById('tourSkipBtn').hidden = !!step.isFinal;
  document.getElementById('tourNextBtn').textContent = step.isFinal ? 'Done' : tourIndex === 0 ? 'Start' : 'Next';
  if(target){ target.classList.add('tour-spotlight'); target.scrollIntoView({ block: 'nearest' }); }
  positionTourCard(target);
  setTimeout(() => document.getElementById('tourNextBtn')?.focus(), 20);
}
function tourNext(){ if(tourIndex >= activeTourSteps.length - 1){ endTour(); return; } tourIndex++; renderTourStep(); }
function tourPrev(){ if(tourIndex <= 0) return; tourIndex--; renderTourStep(); }
function endTour(now){
  const card = document.getElementById('tourCard');
  if(now !== true && card.style.display !== 'none' && typeof animateThen === 'function' && motionOK()){
    if(card.dataset.leaving) return;
    card.dataset.leaving = '1';
    const t = getComputedStyle(card).transform, base = t && t !== 'none' ? t + ' ' : '';
    animateThen(card, [{ opacity: 1, transform: base || 'none' }, { opacity: 0, transform: base + 'scale(.97)' }], 160, 'ease-in', () => { endTour(true); delete card.dataset.leaving; card.getAnimations?.().forEach(a => a.cancel()); });
    return;
  }
  card.style.display = 'none';
  card.classList.remove('tour-card-final', 'tour-card-centered');
  clearTourSpotlight();
  document.getElementById('tourClickBlocker')?.remove();
  document.removeEventListener('keydown', tourKeydown, true);
}
