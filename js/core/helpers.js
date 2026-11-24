// Shared helpers used everywhere: safe-output escaping (escapeHtml, jsArg,
// safeUrl, sanitizeInlineHtml), URL/link helpers, empty/loading states,
// date helpers (toDateStr, getWeekStart), formatMinutes.

// Without this, a link typed as "example.com" (no protocol) gets used
// as-is in href="", and the browser treats it as relative to the current
// page instead of an external address — producing exactly the
// "myapp.vercel.app/example.com" bug this fixes.
// A title or description containing a quote or angle bracket, interpolated
// directly into an HTML string, can break out of an attribute or tag and
// corrupt everything the browser parses after it on that card — which is
// exactly the kind of bug that would make some cards (and anything visually
// "after" them in the DOM) look broken while others look fine, depending on
// what text happens to be in them.
// A richer empty state than the plain gray .empty text — an icon, a real
// title, a supporting line, and an optional action, reserved for the
// handful of places people actually land on with nothing in them yet
// (first-run states), not the 50-odd smaller "no results for this filter"
// spots where the plain version is the right amount of ceremony.
function emptyStateHtml(iconSvg, title, sub, actionHtml){
  return `<div class="empty-rich">
    <div class="empty-rich-icon">${iconSvg}</div>
    <div class="empty-rich-title">${escapeHtml(title)}</div>
    ${sub ? `<div class="empty-rich-sub">${sub}</div>` : ''}
    ${actionHtml || ''}
  </div>`;
}

// Used only for the brief first-load window before a view's data has
// actually arrived — distinct from the real empty state, so someone who
// clicks into Tasks/Notes/Calendar right after signing in sees "loading"
// rather than what looks like a genuinely empty board.
// A screen's loading state: soft placeholders (js/ui/skeleton.js) that fade in after a moment;
// a screen with its own shape passes it to skeletonHtml() itself.
function loadingStateHtml(label){
  if(typeof skeletonHtml === 'function') return skeletonHtml('rows', label || 'Loading…');
  return `<div class="empty-rich"><span class="spinner" style="width:16px;height:16px;border-width:2.5px;"></span><div class="empty-rich-sub" style="margin-top:10px;">${escapeHtml(label)||'Loading…'}</div></div>`;
}

// Only Based Agency addresses sign in, get an account or become someone's sign-in email (Nov 20).
// The server checks the same (api/admin-user-actions.js, addendum-email-domain.sql).
const TEAM_EMAIL_DOMAIN = 'based-agency.com';
function isTeamEmail(v){ const e = String(v || '').trim().toLowerCase(); return /^[^\s@]+@[^\s@]+$/.test(e) && e.endsWith('@' + TEAM_EMAIL_DOMAIN); }
// What to say about an address that isn't one: empty, not an email, or another domain.
function teamEmailProblem(v, whose){
  const e = String(v || '').trim();
  if(!e) return whose === 'their' ? 'Enter their work email.' : 'Enter your work email.';
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return 'That doesn’t look like an email address.';
  if(!isTeamEmail(e)) return whose === 'their' ? `Use their @${TEAM_EMAIL_DOMAIN} email.` : whose === 'new' ? `Use an @${TEAM_EMAIL_DOMAIN} email.` : `Use your @${TEAM_EMAIL_DOMAIN} email.`;
  return '';
}
function escapeHtml(str){
  if(str===null || str===undefined) return '';
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

// ---- Safe-output helpers. Rule of thumb for anything typed by a person
// (client names, notes, task titles, file names…) going into HTML:
//   text or attribute   → ${escapeHtml(value)}
//   href / src          → ${safeUrl(value)}
//   inline handler arg  → onclick="fn(${jsArg(value)})"   (no quotes around it)
//   light formatting    → ${sanitizeInlineHtml(value)}     (keeps <b>/<i>/<br>)

// A complete, quoted JS string literal that is also safe inside an HTML
// attribute. HTML-escaping alone isn't enough inside onclick="…": the
// browser decodes &#39; back into a quote before the code runs, and a
// trailing backslash could escape the closing quote.
function jsArg(value){
  return escapeHtml(JSON.stringify(String(value ?? '')));
}

// For href/src attributes. Allows web, mail, phone, relative, blob: and
// data:image URLs; anything else (javascript:, data:text/html, …) becomes
// "#" so a stored link can never run code when clicked.
function safeUrl(url){
  const u = String(url ?? '').trim();
  if(!u) return '';
  const scheme = u.replace(/[\u0000-\u001F\s]+/g,'').match(/^([a-z][a-z0-9+.-]*):/i);
  if(scheme && !/^(https?|mailto|tel|blob)$/i.test(scheme[1]) && !/^data:image\/(png|jpe?g|gif|webp|avif);/i.test(u)) return '#';
  return escapeHtml(u);
}

// For stored text that is allowed light formatting (activity log entries,
// notifications): keeps bold/italic/line breaks, strips everything else —
// scripts, event handlers, links, images.
function sanitizeInlineHtml(html){
  const s = String(html ?? '');
  if(window.DOMPurify) return DOMPurify.sanitize(s, { ALLOWED_TAGS:['b','strong','i','em','br'], ALLOWED_ATTR:[] });
  return escapeHtml(s);
}

function normalizeUrl(url){
  if(!url) return '';
  url = url.trim();
  if(!url) return '';
  if(!/^https?:\/\//i.test(url)) url = 'https://' + url;
  return url;
}

// Used to keep links out of free-text fields that have their own dedicated
// Link field right below them (e.g. task description) — pasting a raw URL
// into prose broke that field's display wherever it got rendered elsewhere
// (kanban cards, the task detail modal), since a single long unbroken
// token doesn't wrap or ellipsis-truncate the way real sentences do.
// Matches explicit http(s)/www links unconditionally, and bare
// domain-looking text only when it ends in a recognizable TLD, to avoid
// false positives on ordinary text like "e.g." or a version number.
function containsUrl(text){
  if(!text) return false;
  return /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|net|org|io|co|dev|app|xyz|info|biz|gov|edu|me|ai|so)(\/\S*)?\b/i.test(text);
}

// Display text for a link — strips the protocol prefix (nobody needs to
// see "https://" to recognize a link) and truncates with an ellipsis when
// actually cut off, so it's clear the display text isn't the whole URL.
// This is purely cosmetic display text; normalizeUrl() above is what
// actually gets used as the href, so truncation here never breaks the
// link itself.
function truncateLinkDisplay(url, maxLen){
  maxLen = maxLen || 45;
  const stripped = (url||'').replace(/^https?:\/\//,'');
  return stripped.length > maxLen ? stripped.slice(0, maxLen) + '…' : stripped;
}

function toDateStr(d){
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

function formatMinutes(mins){
  const h = Math.floor(mins/60), m = mins%60;
  if(h && m) return `${h}h ${m}m`;
  if(h) return `${h}h`;
  return `${m}m`;
}

function getWeekStart(d){
  const date = new Date(d);
  const day = date.getDay();
  const diff = (day+6)%7;
  date.setDate(date.getDate()-diff);
  date.setHours(0,0,0,0);
  return date;
}

// How urgent an unread notification is, for the dot on the bell (and each unread row): red when
// something is late or at risk, yellow when it's waiting on you, blue for news.
const NOTIF_RED = ['update_behind', 'reminder_escalated', 'client_danger_maxed'];
const NOTIF_YELLOW = ['draft_ready', 'win_approved', 'draft_written', 'task_assigned', 'reminder_follow_up_due', 'harvest_client', 'email_change_requested', 'event_invited', 'event_rsvp',
  'task_due', 'task_overdue', 'task_wrap_up', 'whatsapp_waiting', 'review_nudge', 'whatsapp_nudge', 'whatsapp_handoff', 'review_question', 'health_ask'];
function notifSeverity(n){
  const t = String((n && n.type) || '');
  return NOTIF_RED.includes(t) || t.includes('denied') ? 'red' : NOTIF_YELLOW.includes(t) ? 'yellow' : 'blue';
}
function notifTopSeverity(list){
  const s = (list || []).filter(n => !n.read).map(notifSeverity);
  return s.includes('red') ? 'red' : s.includes('yellow') ? 'yellow' : s.length ? 'blue' : '';
}

// ---- App logos (Nov 23): each connection shows its own mark (Settings, Tasks, client Details; iPhone too)
// Logos that fill their square (Claude, Granola, Harvest) sit edge to edge; marks on white (ChatGPT,
// Google, Slack) sit inset on a white tile, as on a home screen. Two apps in one row overlap.
const APP_LOGOS = { claude: ['Claude', 'fill'], chatgpt: ['ChatGPT', 'mark'], granola: ['Granola', 'fill'],
  google: ['Google', 'mark'], slack: ['Slack', 'mark'], harvest: ['Harvest', 'fill'], whatsapp: ['WhatsApp', 'mark'] };
function appLogo(app, size){
  const a = APP_LOGOS[app]; if(!a) return '';
  return `<span class="app-logo is-${a[1]} lg-${app}${size ? ' ' + size : ''}" aria-hidden="true"><img src="/icons/apps/${app}.png" alt="" width="96" height="96" decoding="async" draggable="false"></span>`;
}
function appLogoPair(a, b, size){ return `<span class="app-pair${size ? ' ' + size : ''}" aria-hidden="true">${appLogo(a)}${appLogo(b)}</span>`; }
// An app without a logo of its own here (a connected app Radar doesn't know) gets its symbol on a plain tile the same size.
function appGlyph(name, size){ return `<span class="app-logo is-glyph${size ? ' ' + size : ''}" aria-hidden="true">${icon(name)}</span>`; }

// ---- The notification sound (Nov 23) -------------------------------------------------------------
// A soft two-note chime when something new comes in, made here (no sound file). On by default, per
// device (Settings → Notifications → Sound). Browsers only let a page play sound after you've
// clicked or typed in it, so the first chime waits for that. While the window is in the background
// the phone or computer's own push alert sounds instead, so this one stays quiet then.
let radarAudio = null;
function radarSoundOn(){ try{ return localStorage.getItem('radar-sound') !== '0'; }catch(e){ return true; } }
function setRadarSound(on){ try{ localStorage.setItem('radar-sound', on ? '1' : '0'); }catch(e){} if(on) radarChime(true); }
function radarAudioCtx(){
  if(radarAudio) return radarAudio;
  const AC = window.AudioContext || window.webkitAudioContext; if(!AC) return null;
  try{ radarAudio = new AC(); }catch(e){ radarAudio = null; }
  return radarAudio;
}
['pointerdown', 'keydown', 'touchstart'].forEach(ev => window.addEventListener(ev, () => { const c = radarAudioCtx(); if(c && c.state === 'suspended') c.resume().catch(() => {}); }, { passive: true }));
function radarChime(force){
  if(!force && !radarSoundOn()) return false;
  const pushOn = typeof Notification !== 'undefined' && Notification.permission === 'granted';
  if(!force && document.visibilityState !== 'visible' && pushOn) return false;
  const c = radarAudioCtx(); if(!c || c.state !== 'running') return false;
  const t0 = c.currentTime + 0.01;
  [[880, 0, 0.11], [1318.5, 0.09, 0.22]].forEach(([f, at, len]) => {
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0 + at);
    g.gain.exponentialRampToValueAtTime(0.09, t0 + at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
    o.connect(g); g.connect(c.destination);
    o.start(t0 + at); o.stop(t0 + at + len + 0.02);
  });
  window._radarChimes = (window._radarChimes || 0) + 1;
  return true;
}

// ---- Joining a meeting (Nov 23) ---------------------------------------------------------------
// The link to join: Google Meet from Google Calendar (calendar_events.meeting_url), else a Zoom, Meet,
// Teams, Webex or Whereby link in the place or the notes, else a place that is a link.
const MEET_LINK_RE = /https?:\/\/[^\s<>"')\]]*(?:zoom\.us|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com|whereby\.com|gotomeeting\.com|meet\.jit\.si)[^\s<>"')\]]*/i;
function meetingLink(e){
  if(!e) return null;
  const loc = String(e.location || '').trim();
  let u = e.meetingUrl || (loc.match(MEET_LINK_RE) || [])[0] || (String(e.description || '').match(MEET_LINK_RE) || [])[0] || (/^https?:\/\/\S+$/i.test(loc) ? loc : '');
  if(!u) return null;
  u = u.replace(/[.,;]+$/, '');
  if(!/^https:\/\//i.test(u)) return null;
  const name = /zoom\.us/i.test(u) ? 'Zoom' : /meet\.google/i.test(u) ? 'Google Meet' : /teams\.(microsoft|live)/i.test(u) ? 'Teams' : /webex/i.test(u) ? 'Webex' : /whereby/i.test(u) ? 'Whereby' : 'the meeting';
  return { url: u, name };
}
// Joinable now: from 15 minutes before it starts until it ends (not all-day ones)
function meetingJoinable(e, now){
  if(!e || e.allDay || !meetingLink(e)) return false;
  const t = (now || new Date()).getTime(), s = new Date(e.startAt).getTime(), en = new Date(e.endAt || e.startAt).getTime() || s + 3600000;
  return t >= s - 15 * 60000 && t <= Math.max(en, s + 5 * 60000);
}
// The Join button: a link to the meeting, in a new tab. "Join Google Meet", or just "Join" when small.
function joinMeetingBtn(e, cls){
  const m = meetingLink(e); if(!m) return '';
  const small = /\bsm\b/.test(cls || ''), label = small || m.name === 'the meeting' ? 'Join' : 'Join ' + m.name;
  return `<a class="btn ${cls || ''} join-b" href="${escapeHtml(m.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${typeof icon === 'function' ? icon('video') : ''}${escapeHtml(label)}</a>`;
}
