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
function loadingStateHtml(label){
  return `<div class="empty-rich"><span class="spinner" style="width:16px;height:16px;border-width:2.5px;"></span><div class="empty-rich-sub" style="margin-top:10px;">${escapeHtml(label)||'Loading…'}</div></div>`;
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
const NOTIF_YELLOW = ['draft_ready', 'draft_written', 'task_assigned', 'reminder_follow_up_due', 'harvest_client', 'email_change_requested', 'event_invited', 'event_rsvp'];
function notifSeverity(n){
  const t = String((n && n.type) || '');
  return NOTIF_RED.includes(t) || t.includes('denied') ? 'red' : NOTIF_YELLOW.includes(t) ? 'yellow' : 'blue';
}
function notifTopSeverity(list){
  const s = (list || []).filter(n => !n.read).map(notifSeverity);
  return s.includes('red') ? 'red' : s.includes('yellow') ? 'yellow' : s.length ? 'blue' : '';
}
