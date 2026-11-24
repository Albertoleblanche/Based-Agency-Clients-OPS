// WhatsApp: what clients are waiting on, found by the connector in client WhatsApp groups.
// Everyone sees their own; admins and approvers see everyone's. The setup in Settings → WhatsApp
// is one for the whole team and only admins change it (wa_can_setup()).
// In test mode (wa_settings.pilot_user_ids) only the testers see any of it, whatever their role,
// and they set it up; the database says which applies to whoever is signed in (wa_access()).
// The data is written by whatsapp-connector/ (read-only); this screen reads the items and lets
// people mark them done, reassign them, make a task of them, or say they weren't tasks (which
// teaches the agent). Same tables and columns as schema-whatsapp-tasks.sql.

let waTasks = [];
let waRuns = [];
let waGroups = [];
let waSettings = null;
let waLoaded = false;
let waReady = null;            // null: not loaded · false: the tables aren't there yet · true
let waWho = null;              // 'mine' | 'all' | an owner key (leads only); null = the default
let waTab = null;              // 'needs' | 'open' | 'done'; null = the default (Needs attention for leads, Waiting for members)
let waClientSel = null;        // leads: one client's name, or null for all
let waRealtimeStarted = false;
let waAccessLevel = null;      // 'manage' | 'own' | 'none' from the database; null = it doesn't say (older setup)
let waSetupOk = null;          // may change the setup (wa_can_setup()); null = the database doesn't say yet
let waContact = null;          // leads: when the team last wrote in each group it reads (wa_last_contact); null = the database doesn't say
let waCheckAt = null;          // when Check Now was pressed in this tab (ISO)
let waCheckTimer = null;
const waChat = {};             // item id -> its messages ([] when there are none) · 'loading' · 'none' (the database can't say)
const waChatTop = {};          // item id -> where its chat is scrolled to, while it stays open
let waClientLast = null;       // leads: group jid -> when the client last wrote there (last 14 days); null = not known

const WA_OWNERS = [['albert', 'Albert'], ['stan', 'Stan'], ['eric', 'Eric'], ['charlie', 'Charlie'], ['dan', 'Dan'], ['joey', 'Joey']];
const WA_KIND = { request: 'Request', question: 'Question', promise: 'We promised', issue: 'Problem' };
const WA_KIND_IC = { request: 'list-checks', question: 'circle-help', promise: 'handshake', issue: 'flag' };
const WA_STALE_MS = 120000;    // the connector writes a heartbeat about every 30 s
const WA_QUIET_DAYS = 7;       // no message or update from us in this many days: a quiet client

// Who sees what (wa_access(), read with the rest in waLoadNow). Before the test-mode update the
// database doesn't say, so the role decides.
function waCanManage(){ return waAccessLevel ? waAccessLevel === 'manage' : canApprove(); }
// Linking the number, the groups, the times, who handles what, going live: admins (testers while
// testing). Before addendum-whatsapp-admins.sql the database doesn't say, and leads still can.
function waCanSetup(){ return waSetupOk === null ? waCanManage() : waSetupOk; }
const WA_ADMINS_NOTE = 'An admin does this in Settings → WhatsApp.';
function waHidden(){ return waAccessLevel ? waAccessLevel === 'none' : (waReady === false && !canApprove()); }
function waTesters(){ return (waSettings && Array.isArray(waSettings.pilot_user_ids)) ? waSettings.pilot_user_ids : []; }
function updateWaNav(){
  const nav = document.querySelector('.nav-item[data-view="whatsapp"]');
  if(nav) nav.style.display = waHidden() ? 'none' : '';
  if(waHidden() && typeof currentViewName !== 'undefined' && currentViewName === 'whatsapp' && typeof switchView === 'function') switchView('overview');
}
function waMissing(error){ return /relation|schema cache|PGRST205|42P01|does not exist/i.test(`${error?.code || ''} ${error?.message || ''}`); }
function waMissingCol(error){ return /column|PGRST204|42703|schema cache/i.test(`${error?.code || ''} ${error?.message || ''}`); }
// One load at a time: the screen, fullRefresh() and Check Now can all ask at once, and they share it.
let waLoading = null, waLoadError = null;
function loadWaTasks(){
  if(!waLoading) waLoading = waLoadNow().finally(() => { waLoading = null; });
  return waLoading;
}
// Everything in one round trip. Row security returns nothing from the lead-only tables to
// anyone else, so asking for them up front costs nothing.
async function waLoadNow(){
  const safe = q => Promise.resolve(q).catch(e => ({ error: { message: e?.message || String(e) } }));
  const [acc, tk, r, s, g, lc, cl, su, ...ins] = await Promise.all([
    safe(supabaseClient.rpc('wa_access')),
    safe(supabaseClient.from('wa_tasks').select('*').order('first_seen', { ascending: true })),
    safe(supabaseClient.from('wa_runs').select('*').order('started_at', { ascending: false }).limit(20)),
    safe(supabaseClient.from('wa_settings').select('*').eq('id', 1).maybeSingle()),
    safe(supabaseClient.from('wa_groups').select('*').order('name', { ascending: true })),
    safe(supabaseClient.rpc('wa_last_contact')),
    safe(supabaseClient.from('wa_messages').select('group_jid,ts').eq('from_team', false).gte('ts', new Date(Date.now() - 14 * 86400000).toISOString()).order('ts', { ascending: false }).limit(3000)),
    safe(supabaseClient.rpc('wa_can_setup')),
    ...(typeof waInsightQueries === 'function' ? waInsightQueries().map(safe) : []),
  ]);
  waAccessLevel = !acc.error && ['manage', 'own', 'none'].includes(acc.data) ? acc.data : null;
  waSetupOk = !su.error && typeof su.data === 'boolean' ? su.data : null;
  waLoadError = null;
  if(waAccessLevel === 'none'){ waTasks = []; waLoaded = true; waReady = true; updateWaNav(); updateWaNavBadge(); return false; }
  if(tk.error){
    const missing = waMissing(tk.error);
    if(!missing){ console.error('loadWaTasks error', tk.error); waLoadError = tk.error.message || 'Couldn’t reach the database'; }
    if(missing || !waLoaded) waTasks = [];
    waLoaded = true; waReady = missing ? false : waReady; updateWaNav(); updateWaNavBadge(); return false;
  }
  waTasks = tk.data || []; waReady = true;
  updateWaNav();
  if(typeof waInsightsApply === 'function') waInsightsApply(ins, waCanManage());
  if(waCanManage()){
    waRuns = r.data || []; waSettings = s.data || null; waGroups = g.data || []; waContact = lc.error ? null : (lc.data || []);
    if(!cl.error){ waClientLast = new Map(); (cl.data || []).forEach(m => { if(!waClientLast.has(m.group_jid)) waClientLast.set(m.group_jid, m.ts); }); }
  }
  waLoaded = true;
  updateWaNavBadge();
  waStartRealtime();
  return true;
}
// New items arrive while you work: the badge (and the screen, if it's open) update as they come,
// not only when you open WhatsApp.
function waStartRealtime(){
  if(waRealtimeStarted || typeof supabaseClient.channel !== 'function' || !waReady || waHidden()) return;
  waRealtimeStarted = true;
  supabaseClient.channel('wa-tasks').on('postgres_changes', { event: '*', schema: 'public', table: 'wa_tasks' }, async () => {
    await loadWaTasks();
    if(currentViewName === 'whatsapp'){ renderWhatsapp(); waRefreshChat(); }
  }).subscribe();
}

// ---- small helpers ---------------------------------------------------------------------------
// A done item the client wrote on afterwards: the newest closed item in its group (not "not a task"),
// with no open item there, and a client message after it was closed. Leads only (they can read the
// messages); the agent reopens it by itself when the message asks for more (connector).
function waClosedAt(t){ return t.status === 'open' ? null : (t.answered_at || t.updated_at || null); }
function waWroteAgain(t){
  if(!waClientLast || t.status === 'open' || t.status === 'dismissed') return null;
  const last = waClientLast.get(t.group_jid), at = waClosedAt(t);
  if(!last || !at || new Date(last) <= new Date(at)) return null;
  if(waTasks.some(x => x.group_jid === t.group_jid && x.status === 'open')) return null;
  const newest = waTasks.filter(x => x.group_jid === t.group_jid && x.status !== 'open' && x.status !== 'dismissed')
    .sort((a, b) => new Date(waClosedAt(b)) - new Date(waClosedAt(a)))[0];
  if(newest && newest.id !== t.id) return null;
  return new Date(last) >= new Date(Date.now() - 14 * 86400000) ? last : null;
}
function waOwnerName(t){
  const p = t.owner_user_id && (teamProfiles || []).find(x => x.id === t.owner_user_id);
  if(p) return firstName(p.name);
  return (WA_OWNERS.find(o => o[0] === t.owner_key) || [, 'Unassigned'])[1];
}
function waCanEdit(t){ return waCanManage() || t.owner_user_id === currentUser?.id; }
function waOpenForMe(){ return waTasks.filter(t => t.status === 'open' && t.owner_user_id === currentUser?.id); }
function updateWaNavBadge(){
  const b = document.getElementById('navWhatsappBadge');
  if(!b) return;
  // What's waiting, until it's answered or done: everyone's for admins and approvers, your own otherwise.
  const n = waHidden() ? 0 : waCanManage() ? waTasks.filter(t => t.status === 'open').length : waOpenForMe().length;
  b.textContent = n; b.style.display = n ? '' : 'none';   // the stylesheet lays out the count circle
}
function waDays(t){ return Math.max(0, daysBetween(dayStart(new Date(t.first_seen)), dayStart(rNow()))); }
// Business days since it came in, today included: Monday's message on Tuesday is 1 (answer it today),
// Friday's on Monday is 1 too. Clients get a first reply within 1 business day, so 2 is late.
function waBizDays(t){
  let d = dayStart(new Date(t.first_seen)), n = 0;
  const end = dayStart(rNow());
  while(d < end){ d = addDays(d, 1); const w = d.getDay(); if(w !== 0 && w !== 6) n++; }
  return n;
}
function waLate(t){ return t.status === 'open' && waBizDays(t) >= 2; }
function waDueToday(t){ return t.status === 'open' && waDays(t) > 0 && waBizDays(t) === 1; }
function waAgeWord(t){ const d = waDays(t); return d === 0 ? 'New today' : d === 1 ? '1 day' : `${d} days`; }
// The row's word: new today, answer today, or how long it has waited.
function waWaitWord(t){ return waDays(t) === 0 ? 'New today' : waDueToday(t) ? 'Answer today' : waAgeWord(t); }
// Group names without the agency's own suffix: "Brightway Electric | Marketing" → "Brightway Electric".
function waCleanName(n){
  let s = String(n || '').trim();
  // "CaliFirst Remodel - Based Agency Marketing - daniel" → "CaliFirst Remodel": from "Based Agency" on is ours
  s = s.replace(/(?:\s*[|\-–—:&+×]\s*|\s+x\s+)based\s+agency\b.*$/i, '').trim();
  for(let i = 0; i < 3; i++){
    const t = s.replace(/\s*[|\-–—:]\s*(based\s+agency(\s+marketing)?|marketing)\s*$/i, '').trim();
    if(t === s) break; s = t;
  }
  return s || String(n || '');
}
function waGroup(t){ return waGroups.find(x => x.jid === t.group_jid) || null; }
function waGroupName(t){ const g = waGroup(t); return g ? g.name : ''; }
function waNorm(s){ return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim(); }
// The Radar client an item is about: the group's link if it has one, else the same (or a longer) name.
function waClient(t){
  const all = typeof liveClients === 'function' ? liveClients() : [];
  const g = waGroup(t);
  if(g && g.client_id){ const c = all.find(x => String(x.id) === String(g.client_id)); if(c) return c; }
  const n = waNorm(t.client); if(!n) return null;
  return all.find(c => waNorm(c.name) === n)
    || all.find(c => { const cn = waNorm(c.name); return Math.min(cn.length, n.length) > 4 && (cn.startsWith(n + ' ') || n.startsWith(cn + ' ')); })
    || null;
}
function waClientLabel(t){ const c = waClient(t); return c ? c.name : waCleanName(t.client || (waGroup(t) || {}).name || 'Unknown client'); }
function waMono(t, cls){ const c = waClient(t); return monoHtml(c || { id: 'wa:' + t.client, name: t.client }, cls); }
// When, in words: "11:00 AM", "yesterday at 3:00 PM", "tomorrow at 9:00 AM", "Nov 14 at 9:00 AM"
function waAt(iso){
  const d = new Date(iso), k = daysBetween(dayStart(rNow()), dayStart(d));
  return k === 0 ? fmtTime(d) : k === -1 ? `yesterday at ${fmtTime(d)}` : k === 1 ? `tomorrow at ${fmtTime(d)}` : `${fmtShortDate(d)} at ${fmtTime(d)}`;
}
// "today", "yesterday" or "Nov 10" (only the words go lower case, never a month)
function waWhenLower(iso){ const w = claudeWhen(iso); return /^(Today|Yesterday)/.test(w) ? w[0].toLowerCase() + w.slice(1) : w; }
function waWhen(iso){ const d = new Date(iso); return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}, ${fmtTime(d)}`; }
function waHm(hhmm){ const [h, m] = String(hhmm).split(':').map(Number); return `${(h % 12) || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; }
function waWeekStart(){ const d = dayStart(rNow()); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; }
function waTz(){ return (waSettings && waSettings.timezone) || 'America/New_York'; }
function waCity(z){ return String(z).split('/').pop().replace(/_/g, ' '); }
function waTimes(){ return (waSettings && waSettings.digest_times && waSettings.digest_times.length ? waSettings.digest_times : ['09:00', '15:00']).slice(); }
function waTzParts(date, tz){
  const o = {};
  new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).forEach(p => { o[p.type] = p.value; });
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute };
}
// The moment it's hh:mm on that day in that time zone.
function waZoned(y, m, d, hhmm, tz){
  const [h, mi] = hhmm.split(':').map(Number), want = Date.UTC(y, m - 1, d, h, mi);
  let t = want;
  for(let i = 0; i < 2; i++){ const p = waTzParts(new Date(t), tz); t += want - Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi); }
  return new Date(t);
}
function waNextCheck(){
  if(!waSettings) return null;
  const tz = waTz(), now = rNow(), p = waTzParts(now, tz), times = waTimes().sort();
  for(let k = 0; k < 5; k++){
    const day = new Date(Date.UTC(p.y, p.m - 1, p.d + k, 12));
    if(day.getUTCDay() === 0 || day.getUTCDay() === 6) continue;   // weekdays only, as the connector
    for(const t of times){ const at = waZoned(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), t, tz); if(at > now) return at; }
  }
  return null;
}
function waLastRun(){ return waRuns.find(r => r.kind === 'digest') || null; }
function waRunning(){ return !!(waSettings && waSettings.heartbeat_at && Date.now() - new Date(waSettings.heartbeat_at).getTime() <= WA_STALE_MS); }
function waRunText(r){
  if(!r) return 'No check yet.';
  const bits = [`read ${r.messages_seen || 0} new message${r.messages_seen === 1 ? '' : 's'}`];
  bits.push(r.tasks_new ? `found ${r.tasks_new} new` : 'nothing new');
  if(r.tasks_closed) bits.push(`closed ${r.tasks_closed} the team answered`);
  const k = daysBetween(dayStart(rNow()), dayStart(new Date(r.started_at)));
  const when = k === 0 ? `Today at ${fmtTime(new Date(r.started_at))}` : k === -1 ? `Yesterday at ${fmtTime(new Date(r.started_at))}` : `${fmtShortDate(new Date(r.started_at))} at ${fmtTime(new Date(r.started_at))}`;
  return `${when}: ${bits.join(', ')}.`;
}
function waNextText(){ const n = waNextCheck(); return n ? `Next ${daysBetween(dayStart(rNow()), dayStart(n)) === 0 ? 'at ' : ''}${waAt(n.toISOString())}.` : ''; }

// How to (re)start the connector: it runs on a server now, or on the office PC before the move.
const WA_START = 'Restart it where it runs: on the server press Restart, or on the office PC double-click “2 - Start”.';
const WA_START_FIRST = 'Start it on its server (see the connector README), or on the office PC double-click “2 - Start”, and leave it running.';

// Where the connection stands, for leads.
//   key: 'missing' | 'stopped' | 'qr' | 'signedout' | 'reconnecting' | 'connected'
function waConnState(){
  const s = waSettings;
  if(waReady === false || !s) return { key: 'missing', dot: 'hollow', text: 'Not set up yet', long: 'An admin runs schema-whatsapp-tasks.sql in Supabase → SQL Editor, then starts Radar WhatsApp.' };
  if(!waRunning()) return s.heartbeat_at
    ? { key: 'stopped', dot: 'red', text: 'Radar WhatsApp isn’t running', long: `Last seen ${waWhen(s.heartbeat_at)}. ${WA_START}` }
    : { key: 'stopped', dot: 'red', text: 'Radar WhatsApp isn’t started yet', long: WA_START_FIRST };
  if(s.qr && s.qr_at && Date.now() - new Date(s.qr_at).getTime() < WA_STALE_MS) return { key: 'qr', dot: 'gray', text: 'Not linked yet', long: 'Scan the code with WhatsApp on the phone that’s in the client groups.' };
  const conn = waRuns.find(r => r.kind === 'status' || r.kind === 'error');
  if(conn && conn.connection === 'logged_out') return { key: 'signedout', dot: 'red', text: 'WhatsApp signed out', long: 'The phone unlinked it. Re-link to get a new code to scan.' };
  if(conn && conn.connection === 'open'){
    const last = waLastRun();
    return { key: 'connected', dot: 'green', text: 'Connected', long: last ? `last checked ${waAt(last.started_at)}` : 'no check yet' };
  }
  return { key: 'reconnecting', dot: 'yellow', text: 'Reconnecting…', long: 'Radar WhatsApp is running but WhatsApp isn’t linked yet, or it’s reconnecting.' };
}

// ---- Check Now -----------------------------------------------------------------------------
function waChecking(){
  if(waSettings && waSettings.check_requested_at) return true;      // the connector hasn't picked it up yet
  if(!waCheckAt) return false;
  const since = new Date(waCheckAt).getTime() - 60000;
  if(waRuns.some(r => r.kind === 'digest' && new Date(r.started_at).getTime() >= since)) return false;
  return Date.now() - new Date(waCheckAt).getTime() < 15 * 60000;
}
function waCheckBtn(){
  if(waChecking()) return `<button class="btn wa-chk-b" disabled>${icon('loader', { cls: 'spin' })}Checking…</button>`;
  return `<button class="btn wa-chk-b" onclick="waCheckNow()"${waConnState().key === 'connected' ? '' : ' disabled title="WhatsApp isn’t connected"'}>${icon('arrows-clockwise')}Check Now</button>`;
}
// Ask the connector for a check (or clear a request it never picked up). wa_request_check lets
// approvers do it without being able to change the setup; older databases take the plain update.
async function waAskCheck(clear){
  const r = await supabaseClient.rpc('wa_request_check', { p_clear: !!clear });
  if(!r.error && (typeof r.data === 'string' || r.data === null)) return { at: clear ? null : (r.data || new Date().toISOString()), error: null };
  if(r.error && !/wa_request_check|PGRST202|does not exist|Could not find/i.test(`${r.error.code || ''} ${r.error.message || ''}`)) return { at: null, error: r.error };
  const at = clear ? null : new Date().toISOString();
  const { error } = await supabaseClient.from('wa_settings').update({ check_requested_at: at }).eq('id', 1);
  return { at, error };
}
async function waCheckNow(){
  if(waConnState().key !== 'connected'){ showToast('error', 'WhatsApp isn’t connected', waConnState().long); return; }
  const { at, error } = await waAskCheck(false);
  if(error){
    showToast('error', 'Couldn’t ask for a check', waMissingCol(error) ? 'Check Now needs a one-time database update: run addendum-whatsapp-check-now.sql in Supabase → SQL Editor.' : error.message);
    return;
  }
  if(waSettings) waSettings.check_requested_at = at;
  waCheckAt = at;
  waRedraw();
  showToast('info', 'Checking the groups', 'It usually takes a minute or two. The list updates by itself.');
  if(waCheckTimer) clearInterval(waCheckTimer);
  const before = waLastRun()?.id;
  waCheckTimer = setInterval(async () => {
    await loadWaTasks();
    const asked = waSettings && waSettings.check_requested_at;
    if(asked && Date.now() - new Date(asked).getTime() > 90000){
      // still waiting to be picked up: the connector is an older version, or isn't running
      clearInterval(waCheckTimer); waCheckTimer = null; waCheckAt = null;
      await waAskCheck(true);
      if(waSettings) waSettings.check_requested_at = null;
      showToast('error', 'Radar WhatsApp didn’t start the check', waRunning() ? 'It needs the latest version. Redeploy it, then try again.' : 'Radar WhatsApp isn’t running.');
      waRedraw(); return;
    }
    if(!waChecking()){
      clearInterval(waCheckTimer); waCheckTimer = null;
      const r = waLastRun();
      if(r && r.id !== before) showToast('success', 'Checked', r.tasks_new ? `Found ${r.tasks_new} new.` : 'Nothing new.');
      waCheckAt = null;
      waRefreshChat();
    }
    waRedraw();
  }, 5000);
}
function waRedraw(){
  if(typeof currentViewName === 'undefined') return;
  if(currentViewName === 'whatsapp') renderWhatsapp();
  if(waSettingsOpen()){ const box = document.getElementById('waConnBox'); if(box) box.innerHTML = waConnHtml(); }
}

// ---- the screen (Nov 24 redesign: by client) ------------------------------------------------------
// The client comes first: each client is a section, its name outside the card (service, whose client,
// how they sound, how many wait and the oldest wait), its requests in a card below, folding away.
// Urgent first, for anyone; for admins and approvers their own requests next; then the longest waits.
function setWa(k, v){ if(k === 'tab') waTab = v; if(k === 'who') waWho = v; if(k === 'client') waClientSel = v || null; window._waSel = null; renderWhatsapp(); }
function selectWa(id){ window._waSel = window._waSel === id ? null : id; delete waChatTop[id]; renderWhatsapp(); if(window._waSel) waLoadChat(id); }
function closeWaPanel(){ window._waSel = null; renderWhatsapp(); }
function renderWhatsappTasks(){ renderWhatsapp(); }   // the old name, still called by realtime
// Never a blank screen: before the first load a spinner, and if drawing fails, what happened and Try Again.
function renderWhatsapp(){
  const root = document.getElementById('whatsappRoot');
  if(!root || !currentUser) return;
  if(currentViewName === 'whatsapp') setToolbar(null, 'Beta · Client chats');
  if(!waLoaded){ root.innerHTML = `<div class="spw"><div class="sp-page"><div class="wa">${skeletonHtml('whatsapp', 'Loading WhatsApp…')}</div></div></div>`; return; }
  try{ waDraw(root); }
  catch(e){
    console.error('WhatsApp screen', e);
    root.innerHTML = `<div class="spw"><div class="sp-page"><div class="wa">${emptyState({ icon: 'refresh-cw', title: 'WhatsApp couldn’t be shown', text: String(e && e.message || e), action: 'Try Again', onAction: 'openWhatsappView()' })}</div></div></div>`;
  }
}

// Why an open item needs someone now, in a few words, or null.
const WA_RANK = { urgent: 0, reply: 1, late: 2, due: 3, high: 4 };
function waWhy(t, waits){
  if(t.status !== 'open') return null;
  if(t.urgent_at) return { k: 'urgent', text: 'Urgent', red: true };
  const w = waits && waits.get(t.id);
  if(w) return { k: 'reply', text: `The client has waited ${waMinWords(w.mins)} for a reply`, red: true };
  const today = toDateStr(rNow());
  if(t.due_date && t.due_date < today) return { k: 'late', text: `Was due ${fmtShortDate(new Date(t.due_date + 'T12:00:00'))}`, red: true };
  if(waLate(t)) return { k: 'late', text: t.kind === 'promise' ? `Promised ${waAgeWord(t)} ago` : `Waiting ${waAgeWord(t)}` };
  if(t.due_date === today) return { k: 'due', text: 'Due today' };
  if(waDueToday(t)) return { k: 'due', text: 'Answer today' };
  if(t.priority === 'high') return { k: 'high', text: 'High priority' };
  return null;
}
// The connector's "waiting on a reply" (leads), put on the oldest open item in that group.
function waWaitMap(open){
  const m = new Map();
  if(typeof waWaitingNow !== 'function' || typeof WA_NUDGE_MIN === 'undefined') return m;
  waWaitingNow().filter(w => w.mins >= WA_NUDGE_MIN).forEach(w => {
    const t = open.filter(x => x.group_jid === w.group_jid).sort((a, b) => new Date(a.first_seen) - new Date(b.first_seen))[0];
    if(t && !m.has(t.id)) m.set(t.id, w);
  });
  return m;
}
// Folded client sections, kept on this device.
let waFoldedSet = null;
function waFolded(){ if(!waFoldedSet){ try { waFoldedSet = new Set(JSON.parse(localStorage.getItem('wa-folded') || '[]')); } catch(e){ waFoldedSet = new Set(); } } return waFoldedSet; }
function waSaveFolded(){ try { localStorage.setItem('wa-folded', JSON.stringify([...waFolded()])); } catch(e){} }
// No redraw: the section folds in place, so it animates.
function waFold(btn){
  const sec = btn.closest('.wx-cs'); if(!sec) return;
  const closed = !sec.classList.contains('is-closed');
  sec.classList.toggle('is-closed', closed); btn.setAttribute('aria-expanded', String(!closed));
  closed ? waFolded().add(sec.dataset.k) : waFolded().delete(sec.dataset.k);
  waSaveFolded(); waFoldAllWord();
}
function waFoldAll(){
  const secs = [...document.querySelectorAll('#whatsappRoot .wx-cs')];
  const shut = !(secs.length && secs.every(x => x.classList.contains('is-closed')));
  secs.forEach(x => { x.classList.toggle('is-closed', shut); x.querySelector('.wx-cs-t')?.setAttribute('aria-expanded', String(!shut)); shut ? waFolded().add(x.dataset.k) : waFolded().delete(x.dataset.k); });
  waSaveFolded(); waFoldAllWord();
}
function waFoldAllWord(){
  const b = document.getElementById('waFoldAll'); if(!b) return;
  const secs = [...document.querySelectorAll('#whatsappRoot .wx-cs')];
  b.textContent = secs.length && secs.every(x => x.classList.contains('is-closed')) ? 'Expand All' : 'Collapse All';
}
function waYoursWords(n, of){ return n === of ? (n === 1 ? 'it’s yours' : 'all yours') : `${n} ${n === 1 ? 'is' : 'are'} yours`; }

function waDraw(root){
  if(waHidden()){ root.innerHTML = ''; return; }
  if(waLoadError && !waTasks.length && !waSettings){
    root.innerHTML = `<div class="spw"><div class="sp-page"><div class="wa">${emptyState({ icon: 'refresh-cw', title: 'WhatsApp didn’t load', text: `${waLoadError}. Try again once you’re back online.`, action: 'Try Again', onAction: 'openWhatsappView()' })}</div></div></div>`;
    return;
  }
  const lead = waCanManage();
  const who = lead ? (waWho || 'all') : 'mine';
  const conn = lead ? waConnState() : null;
  const never = lead && !waTasks.length && !waRuns.some(r => r.kind === 'digest');
  // Not linked yet (or not set up): the steps to start, instead of an empty list.
  if(lead && (waReady === false || (never && conn.key !== 'connected'))){
    root.innerHTML = `<div class="spw"><div class="sp-page"><div class="wa">${waSetupHtml()}</div></div></div>`;
    return;
  }
  let tab = waTab || (lead ? 'needs' : 'open');
  if(!lead && tab === 'needs') tab = 'open';
  const me = currentUser.id;
  const pickWho = t => who === 'all' ? true : who === 'mine' ? t.owner_user_id === me : t.owner_key === who;
  const allOpen = waTasks.filter(t => t.status === 'open' && pickWho(t));
  const wk = waWeekStart().getTime();
  const allDone = waTasks.filter(t => t.status !== 'open' && pickWho(t) && new Date(t.answered_at || t.updated_at || t.first_seen).getTime() >= wk);
  // one client at a time, for leads
  const clientNames = [...new Set([...allOpen, ...allDone].map(waClientLabel))].sort((a, b) => a.localeCompare(b));
  if(waClientSel && !clientNames.includes(waClientSel)) waClientSel = null;
  const pickCl = t => !lead || !waClientSel || waClientLabel(t) === waClientSel;
  const open = allOpen.filter(pickCl), done = allDone.filter(pickCl);
  const waits = lead ? waWaitMap(open) : new Map();
  const whyOf = new Map(open.map(t => [t.id, waWhy(t, waits)]));
  const needs = open.filter(t => whyOf.get(t.id));
  const useMine = lead && who === 'all';
  const isMine = t => t.owner_user_id === me;
  const tier = t => t.urgent_at ? 0 : useMine && isMine(t) ? 1 : 2;
  const rank = t => { const w = whyOf.get(t.id); return w ? WA_RANK[w.k] : 9; };
  const age = t => new Date(t.first_seen).getTime();
  const reading = window._waSel === 'read' && lead;
  const sel = !reading && window._waSel && waTasks.find(t => t.id === window._waSel);
  if(window._waSel && !sel && !reading) window._waSel = null;

  // the client sections
  const sections = (items, past) => {
    const by = new Map();
    items.forEach(t => { const k = waClientLabel(t); if(!by.has(k)) by.set(k, []); by.get(k).push(t); });
    const secs = [...by.entries()].map(([k, ts]) => {
      if(past) ts.sort((a, b) => new Date(waClosedAt(b) || 0) - new Date(waClosedAt(a) || 0));
      else ts.sort((a, b) => tier(a) - tier(b) || rank(a) - rank(b) || age(a) - age(b));
      return { k, ts, top: past ? 0 : Math.min(...ts.map(tier)), rank: past ? 0 : Math.min(...ts.map(rank)),
        at: past ? -Math.max(...ts.map(t => new Date(waClosedAt(t) || 0).getTime())) : Math.min(...ts.map(age)) };
    });
    secs.sort((a, b) => a.top - b.top || a.rank - b.rank || a.at - b.at);
    return secs.map(x => waSecHtml(x.k, x.ts, { past, lead, who, sel, whyOf, useMine, isMine, live: past ? [] : open.filter(t => waClientLabel(t) === x.k) })).join('');
  };
  const again = tab !== 'done' ? waTasks.filter(t => pickWho(t) && pickCl(t) && waWroteAgain(t)) : [];
  const againHtml = again.length ? `<section class="wx-cs wx-again" data-k="_again" aria-label="The client wrote again"><header class="wx-cs-h"><div class="wx-cs-l"><span class="wx-cs-t is-static">The client wrote again</span><div class="wx-cs-sub"><span>Marked done, then the client wrote in the group. Open it to read what they said.</span></div></div><div class="wx-cs-r"><span>${again.length}</span></div></header><div class="wx-cs-body"><div class="wx-cs-in"><div class="wx-cs-card">${again.map(t => waRowHtml(t, sel, { who, lead, useMine, isMine })).join('')}</div></div></div></section>` : '';
  const rows = tab === 'needs' ? needs : tab === 'open' ? open : done;

  // the heading: how many clients wait, then how many requests and the checks
  const whoName = who === 'mine' ? 'you' : who === 'all' ? 'the team' : (WA_OWNERS.find(o => o[0] === who) || [, who])[1];
  const nClients = new Set(open.map(waClientLabel)).size;
  const h2 = open.length ? `${nClients} client${nClients === 1 ? '' : 's'} waiting on ${whoName}` : `Nothing waiting on ${whoName}`;
  const subBits = [];
  if(open.length){
    const mineN = useMine ? open.filter(isMine).length : 0;
    subBits.push(`<b>${open.length} request${open.length === 1 ? '' : 's'}${mineN ? ` · ${waYoursWords(mineN, open.length)}` : ''}</b>`);
  }
  const againN = again.length;
  if(againN) subBits.push(`<span class="t-blue">${againN === 1 ? 'A client' : againN + ' clients'} wrote again after done</span>`);
  if(lead){
    if(conn.key === 'connected'){
      const last = waLastRun(), next = waNextCheck();
      subBits.push(`<span class="wx-st"><i class="dot green" aria-hidden="true"></i>Connected${last ? ` · checked at ${escapeHtml(waAt(last.started_at))}` : ''}${next ? ` · next ${daysBetween(dayStart(rNow()), dayStart(next)) === 0 ? 'at ' : ''}${escapeHtml(waAt(next.toISOString()))}` : ''}</span>`);
      subBits.push(`<button class="lnk-b" onclick="waShowRead()">What it read</button>`);
    } else {
      const fix = waCanSetup() ? `<a href="#" onclick="openSettingsTab('whatsapp');return false;">${conn.key === 'qr' ? 'Show the Code' : conn.key === 'signedout' ? 'Re-link' : 'Open WhatsApp Settings'}</a>` : '<span>An admin fixes it in Settings → WhatsApp.</span>';
      subBits.push(`<span class="wx-st"><i class="dot ${conn.dot}" aria-hidden="true"></i>${escapeHtml(conn.text)}</span>`, fix);
    }
  } else {
    const first = open.slice().sort((a, b) => tier(a) - tier(b) || rank(a) - rank(b) || age(a) - age(b))[0];
    subBits.push(first && first.urgent_at ? 'Start with the urgent one.' : 'From your clients’ WhatsApp groups.');
    if(waNextCheck()) subBits.push(escapeHtml(waNextText().replace(/\.$/, '')));
  }

  const whoOpts = [['all', 'Everyone'], ['mine', 'Mine'], ...WA_OWNERS];
  const curWho = whoOpts.find(o => o[0] === who) || whoOpts[0];
  const seg = tabs => `<div class="seg" role="tablist" aria-label="Show">${tabs.map(([k, t, c]) => `<button class="${tab === k ? 'on' : ''}" role="tab" aria-selected="${tab === k}" onclick="setWa('tab','${k}')">${t} <span class="c">${c}</span></button>`).join('')}</div>`;
  const hdRight = lead
    ? `<label class="pop pop-sel"><span class="pl">${escapeHtml(curWho[1])}</span>${icon('caret-down')}<select aria-label="Whose items" onchange="setWa('who',this.value)">${whoOpts.map(([v, n]) => `<option value="${v}"${v === who ? ' selected' : ''}>${escapeHtml(n)}</option>`).join('')}</select></label>
${clientNames.length > 1 ? `<label class="pop pop-sel"><span class="pl">${escapeHtml(waClientSel || 'All clients')}</span>${icon('caret-down')}<select aria-label="Which clients" onchange="setWa('client',this.value)"><option value="">All clients</option>${clientNames.map(n => `<option value="${escapeHtml(n)}"${n === waClientSel ? ' selected' : ''}>${escapeHtml(n)}</option>`).join('')}</select></label>` : ''}
${waCheckBtn()}`
    : seg([['open', 'Waiting', open.length], ['done', 'Done this week', done.length]]);
  const foldBtn = `<button class="lnk-b wx-all" id="waFoldAll" onclick="waFoldAll()">Collapse All</button>`;

  let main;
  if(lead){
    const bar = `<div class="wx-bar">${seg([['needs', 'Needs attention', needs.length], ['open', 'All waiting', open.length], ['done', 'Done this week', done.length]])}${rows.length ? foldBtn : ''}</div>`;
    let list;
    if(rows.length) list = `<div class="wx-groups">${tab !== 'done' ? againHtml : ''}${sections(rows, tab === 'done')}</div>`;
    else if(tab === 'needs' && open.length) list = `${againHtml ? `<div class="wx-groups">${againHtml}</div>` : ''}${emptyState({ icon: 'check-circle', tone: 'ok', title: 'Nothing needs attention', text: `${open.length} waiting, none urgent, late or due today.`, link: `See all ${open.length} waiting`, onLink: "setWa('tab','open')" })}`;
    else list = `${againHtml ? `<div class="wx-groups">${againHtml}</div>` : ''}${waEmptyHtml(who, open, done)}`;
    main = `${bar}${list}`;
  } else if(tab === 'open'){
    const sorted = open.slice().sort((a, b) => tier(a) - tier(b) || rank(a) - rank(b) || age(a) - age(b));
    const next = sorted[0], rest = sorted.slice(1);
    main = next
      ? `${waNextHtml(next, whyOf.get(next.id))}${rest.length || againHtml ? `<div class="wx-bar"><h3 class="wx-lh">Also waiting on you</h3>${foldBtn}</div><div class="wx-groups">${againHtml}${sections(rest, false)}</div>` : ''}`
      : `${againHtml ? `<div class="wx-groups">${againHtml}</div>` : ''}${waEmptyHtml(who, open, done)}`;
  } else {
    main = done.length ? `<div class="wx-bar"><span></span>${foldBtn}</div><div class="wx-groups">${sections(done, true)}</div>` : waEmptyHtml(who, open, done);
  }

  const side = lead ? waSideHtml(who, conn, allOpen) : waMeSideHtml(allOpen, allDone);
  const prev = root.querySelector('.sp-page')?.scrollTop || 0;
  root.innerHTML = `<div class="spw"><div class="sp-page"><div class="wx${lead ? '' : ' wx-solo'}${sel || reading ? ' has-panel' : ''}">
<header class="wx-hd"><div><h2 class="wx-h">${escapeHtml(h2)}</h2><p class="wx-sub">${subBits.join('<i class="wx-sep">·</i>')}</p></div><div class="wx-hd-a">${hdRight}</div></header>
<div class="wx-body"><div class="wx-main">${main}</div>${side}</div>
</div></div>${sel ? waPanelHtml(sel) : reading ? waReadPanelHtml() : ''}</div>`;
  const sp = root.querySelector('.sp-page'); if(sp) sp.scrollTop = prev;
  waFoldAllWord();
  waChatScroll();
}
// One client: its name and facts outside the card, its requests inside.
function waSecHtml(k, ts, o){
  const c = waClient(ts[0]);
  const svc = c && c.service ? String(c.service) : '';
  const own = o.lead && c && c.customFieldValues && c.customFieldValues.owner ? firstName(String(c.customFieldValues.owner)) : '';
  const m = c && typeof waMoodFor === 'function' ? waMoodFor(c) : null;
  const mood = m && m.level !== 'neutral' ? `<span class="wx-mood ${m.level === 'happy' ? 'g' : m.level === 'angry' ? 'r' : 'y'}">${escapeHtml(WA_MOOD[m.level])}</span>` : '';
  const meta = [svc, own ? `${own}’s client` : ''].filter(Boolean).map(escapeHtml).join(' · ');
  const live = o.live && o.live.length ? o.live : ts.filter(t => t.status === 'open');   // the client's whole list, whichever tab
  const n = o.past ? ts.length : live.length;
  const mineN = o.useMine ? live.filter(o.isMine).length : 0;
  const count = o.past ? `${n} done` : `${n} waiting${mineN ? ` · ${waYoursWords(mineN, n)}` : ''}`;
  const oldest = o.past ? null : live.filter(waLate).sort((a, b) => new Date(a.first_seen) - new Date(b.first_seen))[0];
  const urgent = !o.past && live.some(t => t.urgent_at);
  const closed = waFolded().has(k);
  const link = c ? `<a href="#" onclick="openClientInspectorFor('${escapeHtml(String(c.id))}');return false;">Open Client${icon('caret-right')}</a>` : '<span class="t-3">Not in Radar</span>';
  return `<section class="wx-cs${closed ? ' is-closed' : ''}" data-k="${escapeHtml(k)}" aria-label="${escapeHtml(k)}">
<header class="wx-cs-h"><div class="wx-cs-l"><button class="wx-cs-t" aria-expanded="${!closed}" onclick="waFold(this)">${icon('caret-right', { cls: 'wx-chev' })}<span>${escapeHtml(k)}</span></button>${meta || mood ? `<div class="wx-cs-sub">${meta ? `<span>${meta}</span>` : ''}${meta && mood ? '<i>·</i>' : ''}${mood}</div>` : ''}</div>
<div class="wx-cs-r">${urgent ? '<em class="wa-urg">Urgent</em>' : ''}<span class="wx-cs-n">${escapeHtml(count)}</span>${oldest ? `<span class="t-red">oldest ${escapeHtml(waAgeWord(oldest))}</span>` : ''}<i class="wx-vr" aria-hidden="true"></i>${link}</div></header>
<div class="wx-cs-body"><div class="wx-cs-in"><div class="wx-cs-card">${ts.map(t => waRowHtml(t, o.sel, { ...o, why: o.whyOf && o.whyOf.get(t.id) })).join('')}</div></div></div></section>`;
}
function waRowHtml(t, sel, o){
  o = o || {};
  const closed = t.status !== 'open', can = waCanEdit(t);
  const cb = !closed
    ? (can ? `<button class="cb rem" role="checkbox" aria-checked="false" aria-label="Mark done" title="Mark done" onclick="event.stopPropagation();checkOff(this, () => waMarkDone('${t.id}'))"></button>` : '<span class="cb rem is-off"></span>')
    : `<span class="cb rem${t.status === 'dismissed' ? ' closed' : ' done'}" role="img" aria-label="${t.status === 'dismissed' ? 'Not a task' : 'Done'}">${icon(t.status === 'dismissed' ? 'x' : 'check', { weight: 'bold' })}</span>`;
  const why = !closed && o.why ? `<span class="wx-why${o.why.red ? ' is-red' : ''}">${escapeHtml(o.why.text)}</span>` : '';
  const quote = t.source_excerpt ? `<span class="wa-x">“${escapeHtml(t.source_excerpt)}”</span>` : '';
  const showWho = o.lead && o.who !== 'mine';
  let sub, right;
  if(closed){
    const again = waWroteAgain(t);
    const when = again || waClosedAt(t);
    const day = when ? new Date(when).toLocaleDateString('en-US', { weekday: 'short' }) : '';
    sub = `<span class="s"><em class="wa-k k-${t.kind}">${escapeHtml(WA_KIND[t.kind] || 'Request')}</em>${[showWho ? waOwnerName(t) : '', day].filter(Boolean).map(x => `<i class="wa-dot">·</i><span>${escapeHtml(x)}</span>`).join('')}</span>`;
    const addUpd = !again && !t.improvement_id && can && t.status !== 'dismissed' && typeof waUpdateFits === 'function' && waUpdateFits(t);
    const word = again ? 'Client wrote again' : t.status === 'dismissed' ? 'Not a task' : t.improvement_id ? 'In the weekly update' : t.status === 'answered' ? 'Answered in the group' : 'Done';
    right = addUpd
      ? `<span class="rmi-when">Done</span><button class="lnk-b wx-add" onclick="event.stopPropagation();waAddToUpdate('${t.id}')">Add to Update</button>`
      : `<span class="rmi-when${again ? ' is-new' : t.improvement_id ? ' is-ok' : ''}">${word}</span>${again ? `<span class="rmi-d">${escapeHtml(waAt(again))}</span>` : ''}`;
  } else {
    sub = `<span class="s"><em class="wa-k k-${t.kind}">${escapeHtml(WA_KIND[t.kind] || 'Request')}</em>${quote ? `<i class="wa-dot">·</i>${quote}` : ''}</span>`;
    const mine = o.useMine && o.isMine && o.isMine(t);
    right = `${showWho ? `<b class="wx-who${mine ? ' is-me' : ''}">${escapeHtml(mine ? 'You' : waOwnerName(t))}</b>` : ''}<span class="rmi-when${waLate(t) ? ' is-late' : waDays(t) === 0 ? ' is-new' : ''}">${escapeHtml(waWaitWord(t))}</span>`;
  }
  return `<div class="wa-r wx-row${closed ? ' is-done' : ''}${sel && sel.id === t.id ? ' is-sel' : ''}" role="button" tabindex="0" onclick="selectWa('${t.id}')" onkeydown="if(event.key==='Enter'&&event.target===this)selectWa('${t.id}')">${cb}
<div class="tx">${why}<b>${escapeHtml(t.title)}</b>${sub}</div><div class="wx-row-r">${right}</div></div>`;
}
// A team member's next thing to do, large, with its buttons; the rest sits under it by client.
function waNextHtml(t, why){
  const c = waClient(t), name = waClientLabel(t), svc = c && c.service ? String(c.service) : '';
  return `<section class="wx-card wx-next" aria-label="Next up">
<div class="wx-eb">Next up</div>
<div class="wx-next-cl">${c ? `<a href="#" onclick="openClientInspectorFor('${escapeHtml(String(c.id))}');return false;">${escapeHtml(name)}${icon('caret-right')}</a>` : `<b>${escapeHtml(name)}</b>`}${svc ? `<span>${escapeHtml(svc)}</span>` : ''}</div>
${why ? `<span class="wx-why${why.red ? ' is-red' : ''}">${escapeHtml(why.text)}</span>` : ''}
<h3>${escapeHtml(t.title)}</h3>
<span class="wx-next-k">${escapeHtml(WA_KIND[t.kind] || 'Request')}${why && (why.k === 'late' || why.k === 'due') ? '' : ` · ${escapeHtml(waWaitWord(t))}`}</span>
${t.source_excerpt ? `<div class="wx-said"><span class="who">In the group · ${escapeHtml(waWhen(t.first_seen))}</span><p>${escapeHtml(t.source_excerpt)}</p></div>` : ''}
<div class="wx-pa"><button class="btn btn-p" onclick="waMarkDone('${t.id}')">${icon('check')}Mark Done</button><button class="btn" onclick="selectWa('${t.id}')">Open the Chat</button></div>
${typeof waUpdateSwitchHtml === 'function' ? waUpdateSwitchHtml(t) : ''}
</section>`;
}
function waEmptyHtml(who, open, done){
  const tab = waTab || (waCanManage() ? 'needs' : 'open');
  if(tab === 'done') return emptyState({ icon: 'check-circle', title: 'Nothing done this week yet',
    text: 'Items you mark done, or that the team answers in the group, show here until Sunday.',
    link: open.length ? `See the ${open.length} waiting` : '', onLink: "setWa('tab','open')" });
  if(!waCanManage()) return emptyState({ icon: 'message-circle', tone: 'ok', title: 'Nothing waiting on you',
    text: 'When a client asks you for something in a WhatsApp group, it shows here and in Slack after the next check.' });
  const others = waTasks.filter(t => t.status === 'open').length;
  if(who !== 'all' && others) return emptyState({ icon: 'check-circle', tone: 'ok', title: `Nothing waiting on ${who === 'mine' ? 'you' : (WA_OWNERS.find(o => o[0] === who) || [, who])[1]}`,
    text: `${others} ${others === 1 ? 'is' : 'are'} waiting on the rest of the team.`, action: 'Show Everyone', onAction: "setWa('who','all')" });
  const doneWk = waTasks.filter(t => t.status !== 'open' && new Date(t.answered_at || t.updated_at || t.first_seen).getTime() >= waWeekStart().getTime()).length;
  return emptyState({ icon: 'check-circle', tone: 'ok', title: 'All caught up',
    text: 'When a client asks for something in a group, it shows here after the next check, with who should handle it.',
    link: doneWk ? `See the ${doneWk} done this week` : '', onLink: "setWa('tab','done')" });
}
// Admins and approvers: clients to watch, details to confirm, the team, and test mode.
function waSideHtml(who, conn, open){
  const card = h => h ? `<section class="wx-card wx-sec">${h}</section>` : '';
  const testers = waTesters(), onlyMe = testers.length === 1 && testers[0] === currentUser.id;
  const setLink = waCanSetup() ? ` <a href="#" onclick="openSettingsTab('whatsapp');return false;">WhatsApp settings</a>` : '';
  const lock = testers.length
    ? `<p class="wa-lock">${icon('lock-simple')}<span>Test mode: ${onlyMe ? 'only you see this and get' : `only the ${testers.length} testers see this and get`} its Slack messages.${setLink}</span></p>`
    : waCanSetup() ? `<p class="wa-lock">${icon('settings')}<span>${setLink.trim()}</span></p>`
    : `<p class="wa-lock">${icon('settings')}<span>Admins manage the WhatsApp setup for the whole team.</span></p>`;
  return `<aside class="wx-side">
${card(typeof waWatchHtml === 'function' ? waWatchHtml() : '')}
${card(typeof waDetailsCardHtml === 'function' ? waDetailsCardHtml() : '')}
${card(waTeamHtml(who, open))}
${lock}</aside>`;
}
// Who has what: open, waiting over a day, and how fast they answer. A name shows just theirs.
function waTeamHtml(who, open){
  const st = typeof waReplyStats === 'function' ? waReplyStats(7) : null;
  const rows = WA_OWNERS.map(([k, n]) => {
    const mine = open.filter(t => t.owner_key === k), p = st && st.people.find(x => x.who === n);
    return { k, n, open: mine.length, late: mine.filter(waLate).length, reply: p ? waMinWords(p.median) : '' };
  });
  if(!open.length && !(st && st.n)) return '';
  const shown = rows.filter(r => r.open || r.reply), rest = rows.filter(r => !r.open && !r.reply);
  return `<div class="wx-sec-h"><b>Team</b><span class="r">last 7 days${st && st.n ? ` · typical first reply ${escapeHtml(waMinWords(st.median))}` : ''}</span></div>
<div class="wx-t h" aria-hidden="true"><span></span><span>Open</span><span>Over a day</span><span>First reply</span></div>
${shown.map(r => `<button class="wx-t wa-pp${who === r.k ? ' on' : ''}" onclick="setWa('who','${who === r.k ? 'all' : r.k}')" aria-pressed="${who === r.k}"><span>${r.n}</span><span>${r.open || '–'}</span><span class="${r.late ? 't-red' : ''}">${r.late || '–'}</span><span>${escapeHtml(r.reply || '–')}</span></button>`).join('')}
${rest.length ? `<p class="wx-t-q">Nothing open: ${escapeHtml(rest.map(r => r.n).join(', ').replace(/, ([^,]*)$/, ' and $1'))}</p>` : ''}`;
}
// A team member's side: their week, and how their clients sound in the groups.
function waMeSideHtml(open, done){
  const inUpd = done.filter(t => t.improvement_id).length;
  const late = open.filter(waLate).sort((a, b) => new Date(a.first_seen) - new Date(b.first_seen));
  const stat = (k, v, s) => `<div class="wx-stat"><span>${k}</span><b>${v}</b>${s ? `<small>${s}</small>` : ''}</div>`;
  const week = `<div class="wx-sec-h"><b>Your week</b></div>
${stat('Done', done.length, done.length ? `${inUpd} of them ${inUpd === 1 ? 'is' : 'are'} in your clients’ weekly updates.` : 'Mark items done here as you finish them.')}
${stat('Waiting over a day', late.length, late.length ? `${escapeHtml(waClientLabel(late[0]))} has waited longest.` : 'Nothing has waited long.')}`;
  const seen = new Map();
  [...open, ...done].forEach(t => { const c = waClient(t); if(c && !seen.has(String(c.id))) seen.set(String(c.id), c); });
  const moods = typeof waMoodFor === 'function' ? [...seen.values()].map(c => ({ c, m: waMoodFor(c) })).filter(x => x.m) : [];
  const lvl = { angry: 0, frustrated: 1, happy: 2, neutral: 3 };
  moods.sort((a, b) => lvl[a.m.level] - lvl[b.m.level]);
  const moodHtml = moods.length ? `<div class="wx-sec-h"><b>Your clients on WhatsApp</b></div><p class="wx-sec-p">How they come across in their groups this week.</p>
${moods.map(({ c, m }) => `<div class="wx-mood-r"><b>${escapeHtml(c.name)}</b><span class="wx-mood ${m.level === 'happy' ? 'g' : m.level === 'angry' ? 'r' : m.level === 'frustrated' ? 'y' : ''}">${escapeHtml(WA_MOOD[m.level])}</span>${m.excerpt ? `<p>“${escapeHtml(m.excerpt)}”</p>` : m.reason ? `<p>${escapeHtml(m.reason)}</p>` : ''}</div>`).join('')}` : '';
  return `<aside class="wx-side">
<section class="wx-card wx-sec">${week}</section>
${moodHtml ? `<section class="wx-card wx-sec">${moodHtml}</section>` : ''}
<p class="wx-how">Radar reads your clients’ groups a few times a day and lists what they ask you for. Urgent messages reach you right away. It never writes in the groups.</p>
</aside>`;
}
// ---- Quiet clients -----------------------------------------------------------------------------
// Clients whose group Radar reads where nobody from the team has written, and no update or win went
// out, in WA_QUIET_DAYS days. Only groups it has read for that long count, so a new group isn't
// called quiet just because Radar hasn't seen its history.
function waContactFor(c){
  if(!Array.isArray(waContact) || !c) return null;
  const linked = waContact.find(r => String(r.client_id || '') === String(c.id));
  if(linked) return linked;
  const n = typeof winNorm === 'function' ? winNorm(c.name) : '';
  return n ? waContact.find(r => !r.client_id && winNorm(waCleanName(r.name)) === n) || null : null;
}
function waQuietClients(){
  if(!Array.isArray(waContact) || typeof activeClients !== 'function') return [];
  const today = dayStart(rNow()), out = [];
  activeClients().forEach(c => {
    const r = waContactFor(c);
    if(!r || !r.reading_since || daysBetween(dayStart(new Date(r.reading_since)), today) < WA_QUIET_DAYS) return;
    const sent = typeof lastSentAt === 'function' ? lastSentAt(c) : null;
    const last = Math.max(r.last_team_at ? new Date(r.last_team_at).getTime() : 0, sent ? new Date(sent).getTime() : 0);
    const days = last ? daysBetween(dayStart(new Date(last)), today) : null;
    if(days !== null && days < WA_QUIET_DAYS) return;
    out.push({ c, days, owner: (c.customFieldValues && c.customFieldValues.owner) || '' });
  });
  return out.sort((a, b) => (b.days ?? 1e6) - (a.days ?? 1e6) || a.c.name.localeCompare(b.c.name));
}
// Before WhatsApp is linked: three steps, each with its one thing to do.
function waSetupHtml(){
  const conn = waConnState(), missing = waReady === false || !waSettings;
  const running = !missing && waRunning(), linked = conn.key === 'connected';
  const steps = [];
  if(missing) steps.push({ t: 'Add WhatsApp to the database', d: 'An admin runs schema-whatsapp-tasks.sql in Supabase → SQL Editor. It’s safe to run more than once.', done: false, act: '' });
  steps.push({ t: 'Start Radar WhatsApp', d: running ? 'Done. It checked in a few seconds ago.' : waSettings && waSettings.heartbeat_at ? `It stopped ${waAt(waSettings.heartbeat_at)}. ${WA_START}` : WA_START_FIRST, done: running, act: '' });
  const setup = waCanSetup();
  steps.push({ t: 'Link WhatsApp', d: `Scan a code with the phone that’s in the client groups. It only reads; it never sends.${setup ? '' : ` ${WA_ADMINS_NOTE}`}`, done: linked,
    act: setup && running && !linked ? `<button class="btn" onclick="openSettingsTab('whatsapp')">Show the Code</button>` : '' });
  steps.push({ t: 'Choose the groups it reads', d: `Groups with “Marketing” in the name start on. ${setup ? 'You can turn any group on or off.' : WA_ADMINS_NOTE}`, done: linked && waGroups.some(g => g.active),
    act: setup && linked ? `<button class="btn" onclick="openSettingsTab('whatsapp')">Choose Groups</button>` : '' });
  const next = steps.findIndex(s => !s.done), n = steps.filter(s => s.done).length;
  const rows = steps.map((s, i) => `<div class="wa-step${s.done ? ' is-done' : ''}${i === next ? ' is-next' : ''}">
<span class="wa-sn">${s.done ? icon('check', { weight: 'bold' }) : i + 1}</span>
<span class="tx"><b>${escapeHtml(s.t)}</b><span class="s">${escapeHtml(s.d)}</span></span>${i === next ? s.act : ''}</div>`).join('');
  return `<div class="rmi-hd"><div><h2>Link WhatsApp to start</h2><p>Radar reads your client groups at the times you choose and lists what clients are waiting on, here and in Slack.</p></div></div>
<div class="wa-body"><div class="wa-main"><div class="rmi-sec"><b>${steps.length === 4 ? 'Four' : 'Three'} steps</b><span>${n} of ${steps.length} done</span></div><div class="wa-steps">${rows}</div></div>
<aside class="wa-side"><div class="rmi-sec"><b>Checks</b></div><div class="wa-chk"><div class="wa-st"><span class="dot ${linked ? 'green' : 'gray'}"></span><b>${linked ? 'Connected' : 'Not linked'}</b><span>${linked ? '' : 'nothing is read yet'}</span></div>
<p>Once WhatsApp is linked it checks on weekdays at ${waTimes().map(waHm).join(' and ')}${waSettings ? ` (${escapeHtml(waCity(waTz()))} time)` : ''}, and sends ${waTesters().length ? 'you' : 'each person'} the list in Slack.</p></div>
<p class="wa-lock">${icon('lock-simple')}<span>Personal chats are never read, and it never sends anything to WhatsApp.</span></p></aside></div>`;
}

// ---- What it read: the messages the agent has to go on, group by group -----------------------
// So you can check it against WhatsApp: if a group shows messages but no items, the agent read
// them and found nothing owed; if it shows none, nothing reached the connector.
let waRead = null;             // null · 'loading' · { groups: Map(jid -> {n, last, who}), first, error }
async function waShowRead(){
  window._waSel = 'read'; waRead = 'loading'; renderWhatsapp();
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const [m, f] = await Promise.all([
    supabaseClient.from('wa_messages').select('group_jid,sender,from_team,ts').gte('ts', since).order('ts', { ascending: false }).limit(5000),
    supabaseClient.from('wa_messages').select('created_at,ts').order('created_at', { ascending: true }).limit(1),
  ]);
  const groups = new Map();
  (m.data || []).forEach(x => {
    const g = groups.get(x.group_jid) || { n: 0, last: null, who: '', client: 0 };
    g.n++; if(!x.from_team) g.client++;
    if(!g.last || x.ts > g.last){ g.last = x.ts; g.who = x.sender || (x.from_team ? 'the team' : 'the client'); }
    groups.set(x.group_jid, g);
  });
  waRead = { groups, first: f.data && f.data[0] ? (f.data[0].created_at || f.data[0].ts) : null, error: m.error ? m.error.message : null, capped: (m.data || []).length >= 5000 };
  if(window._waSel === 'read') renderWhatsapp();
}
function waReadPanelHtml(){
  const reading = waGroups.filter(g => g.active);
  const head = `<div class="sp-bar"><button class="ib" aria-label="Close" title="Close (Esc)" onclick="closeWaPanel()">${icon('x')}</button></div>
<div class="tkp-h"><h3>What it read</h3></div>
<p class="wap-rd-p">The messages from the last 7 days in the ${reading.length} group${reading.length === 1 ? '' : 's'} it reads. At each check the agent goes through the new ones and lists what a client is still waiting on.</p>`;
  if(waRead === 'loading' || !waRead) return `<aside class="sp wap" aria-label="What it read">${head}${skeletonHtml('chat', 'Loading the messages…')}</aside>`;
  if(waRead.error) return `<aside class="sp wap" aria-label="What it read">${head}${emptyState({ compact: true, icon: 'refresh-cw', title: 'Couldn’t load the messages', text: waRead.error, action: 'Try Again', onAction: 'waShowRead()' })}</aside>`;
  const open = waTasks.filter(t => t.status === 'open');
  const rows = reading.map(g => ({ g, s: waRead.groups.get(g.jid) || { n: 0 }, items: open.filter(t => t.group_jid === g.jid).length }))
    .sort((a, b) => (b.s.last || '').localeCompare(a.s.last || '') || waCleanName(a.g.name).localeCompare(waCleanName(b.g.name)));
  const withMsgs = rows.filter(r => r.s.n).length, total = rows.reduce((n, r) => n + r.s.n, 0);
  const since = waRead.first ? `Messages are stored from ${waAt(waRead.first)}, when it started reading. Older ones are only here if WhatsApp sent them when it was linked.` : 'Nothing is stored yet.';
  const row = r => `<div class="wap-rd-r${r.s.n ? '' : ' is-none'}"><div class="tx"><b title="${escapeHtml(r.g.name)}">${escapeHtml(waCleanName(r.g.name))}</b><span>${r.s.n ? `${r.s.n} message${r.s.n === 1 ? '' : 's'} · last from ${escapeHtml(r.s.who)}, ${escapeHtml(waAt(r.s.last))}` : 'No messages in the last 7 days'}</span></div><em>${r.items ? `${r.items} open` : ''}</em></div>`;
  return `<aside class="sp wap" aria-label="What it read">${head}
<div class="sp-status"><span class="sp-eb">${icon('message-circle', { weight: 'bold' })}Last 7 days</span><b>${total}${waRead.capped ? '+' : ''} message${total === 1 ? '' : 's'} in ${withMsgs} of ${reading.length} groups</b><span class="sub">${escapeHtml(since)}</span></div>
<div class="sp-sec"><b>By group</b><span>newest first</span></div>
<div class="wap-rd">${rows.map(row).join('') || '<p class="t-2" style="font-size:13px">No groups are being read. Turn some on in Settings.</p>'}</div>
<p class="wa-learn">${icon('sparkle')}<span>To test it, ask for something in one of these groups from another phone, then press Check Now. It should show up here within a couple of minutes.</span></p>
</aside>`;
}

// ---- one item, in the panel --------------------------------------------------------------------
// The messages around the request, then everything after it up to the newest, so a follow-up shows.
// Fetched every time the item opens and after each check; what was there stays on screen meanwhile.
// The database function gives the request's part to anyone who can see the item; leads also read
// the group directly for the rest (the function only had the first few after it before
// addendum-whatsapp-followups.sql).
async function waLoadChat(id){
  const t = waTasks.find(x => x.id === id);
  if(!t || waChat[id] === 'loading' || waChat['_busy_' + id]) return;
  const had = waChat[id];
  if(!Array.isArray(had)) waChat[id] = 'loading';
  waChat['_busy_' + id] = true;
  let out = Array.isArray(had) ? had : 'none';
  try{
    const { data, error } = await supabaseClient.rpc('wa_task_messages', { p_task: id });
    if(!error && Array.isArray(data)) out = data.slice();
    if(waCanManage() && t.group_jid){
      const list = Array.isArray(out) ? out : [];
      const after = list.length ? list[list.length - 1].sent_at : new Date(new Date(t.first_seen).getTime() - 86400000).toISOString();
      const r = await supabaseClient.from('wa_messages').select('wa_msg_id,sender,from_team,text,ts').eq('group_jid', t.group_jid)
        .gt('ts', after).order('ts', { ascending: false }).limit(40);
      if(!r.error && r.data && r.data.length){
        const seen = new Set(list.map(m => m.wa_msg_id)), src = t.source_msg_ids || [];
        const more = r.data.slice().reverse().filter(m => !seen.has(m.wa_msg_id))
          .map(m => ({ wa_msg_id: m.wa_msg_id, sender: m.sender, from_team: m.from_team, body: m.text, sent_at: m.ts, is_source: src.includes(m.wa_msg_id) }));
        out = list.concat(r.data.length >= 40 && list.length ? [{ gap: true }] : [], more);
      }
    }
  }catch(e){}
  delete waChat['_busy_' + id];
  waChat[id] = out;
  if(window._waSel === id && currentViewName === 'whatsapp'){
    const box = document.getElementById('waChatBox');
    if(box) box.outerHTML = waChatHtml(waTasks.find(x => x.id === id));
    waChatScroll();
  }
}
// The chat scrolls inside a box of its own. It opens on the line where the item was marked done when
// the client wrote again, otherwise on the outlined request (or the newest message); read again
// (after a check), it stays where you'd scrolled to.
function waChatScroll(){
  const chat = document.querySelector('#waChatBox .wap-chat'), id = window._waSel;
  if(!chat || !id) return;
  if(waChatTop[id] != null){ chat.scrollTop = waChatTop[id]; return; }
  const at = chat.querySelector('.wap-sep') || chat.querySelector('.wap-m.hit') || chat.lastElementChild;
  chat.scrollTop = at ? Math.max(0, at.offsetTop - 12) : 0;
  if(Array.isArray(waChat[id])) waChatTop[id] = chat.scrollTop;   // placed once the real chat is in
}
// After a check (or anything new from the connector): read the open item's chat again.
function waRefreshChat(){
  Object.keys(waChat).forEach(k => { if(!k.startsWith('_busy_') && waChat[k] !== 'loading' && k !== window._waSel) delete waChat[k]; });
  const id = window._waSel;
  if(id && id !== 'read' && currentViewName === 'whatsapp') waLoadChat(id);
}
function waChatHtml(t){
  const m = waChat[t.id];
  if(Array.isArray(m) && m.length){
    const day = d => { const k = daysBetween(dayStart(new Date(d)), dayStart(rNow())); return k === 0 ? fmtTime(new Date(d)) : `${new Date(d).toLocaleDateString('en-US', { weekday: k < 7 ? 'short' : undefined, month: k < 7 ? undefined : 'short', day: k < 7 ? undefined : 'numeric' })} ${fmtTime(new Date(d))}`; };
    return `<div id="waChatBox"><div class="sp-sec"><b>In the group</b><span>${m.some(x => x.is_source) ? 'the request is outlined' : ''}</span></div>
<div class="wap-chat" tabindex="0" aria-label="Messages in the group" onscroll="waChatTop['${t.id}'] = this.scrollTop">${(() => {
      const at = waClosedAt(t), word = t.status === 'answered' ? 'Answered in the group' : t.status === 'dismissed' ? 'Marked not a task' : 'Marked done';
      let sep = !at;
      return m.map(x => {
        if(x.gap) return '<div class="wap-gap">Earlier messages</div>';
        const line = !sep && new Date(x.sent_at) > new Date(at) ? (sep = true, `<div class="wap-sep"><span>${escapeHtml(word)} ${escapeHtml(day(at))}</span></div>`) : '';
        return `${line}<div class="wap-m${x.from_team ? ' us' : ''}${x.is_source ? ' hit' : ''}"><span class="who">${escapeHtml(x.sender || (x.from_team ? 'Based Agency' : 'Client'))}<time>${escapeHtml(day(x.sent_at))}</time></span><p>${escapeHtml(x.body || '')}</p></div>`;
      }).join('');
    })()}</div></div>`;
  }
  if(m === 'loading' && !t.source_excerpt) return `<div id="waChatBox"><div class="sp-sec"><b>In the group</b><span>loading…</span></div></div>`;
  return `<div id="waChatBox">${t.source_excerpt ? `<div class="sp-sec"><b>What the client said</b>${m === 'loading' ? '<span>loading the chat…</span>' : ''}</div><blockquote class="wa-q">${escapeHtml(t.source_excerpt)}</blockquote>` : ''}</div>`;
}
function waPanelHtml(t){
  const closed = t.status !== 'open', can = waCanEdit(t), lead = waCanManage();
  const kind = WA_KIND[t.kind] || 'Request';
  const c = waClient(t), g = waGroup(t);
  const linkedTask = t.task_id && typeof tasks !== 'undefined' ? tasks.find(x => String(x.id) === String(t.task_id)) : null;
  const taskBtn = t.task_id ? `<button class="btn" onclick="waOpenTask('${t.id}')">${icon('list-checks')}Open Task</button>` : `<button class="btn" onclick="waMakeTask('${t.id}')">${icon('plus')}Make a Task</button>`;
  // Read top down: whose it is, what they want, the facts in one line, the agent's summary, what to do.
  const cname = c ? c.name : waCleanName(t.client || (g || {}).name || 'Unknown client');
  const who = c ? `<a href="#" class="wap-cl" onclick="openClientDetail('${c.id}');return false;">${escapeHtml(c.name)}</a>`
    : `<span class="wap-cl">${escapeHtml(cname)}</span><em>not in Radar</em>`;
  const facts = [`<span>${escapeHtml(kind)}</span>`];
  let acts;
  if(!closed){
    if(t.urgent_at) facts.push(`<em class="wa-urg">Urgent</em>`);
    else if(t.priority === 'high') facts.push('<em class="wa-hi">High priority</em>');
    const d = waDays(t), word = d === 0 ? 'New today' : waDueToday(t) ? `Answer today · waiting ${waAgeWord(t)}` : `Waiting ${waAgeWord(t)}`;
    facts.push(`<b class="${waLate(t) ? 'is-red' : d === 0 ? 'is-new' : ''}">${escapeHtml(word)}</b>`);
    acts = can ? `${taskBtn}<button class="btn" onclick="waDismiss('${t.id}')">Not a Task</button><button class="btn btn-p" onclick="waMarkDone('${t.id}')">${icon('check')}Mark Done</button>` : '';
  } else {
    const word = t.status === 'dismissed' ? 'Not a task' : t.status === 'answered' && t.answered_at ? `Answered in the group ${waWhenLower(t.answered_at)}`
      : `${t.status === 'answered' ? 'Answered in the group' : 'Done'}${t.updated_at ? ' ' + waWhenLower(t.updated_at) : ''}`;
    facts.push(`<b class="${t.status === 'dismissed' ? '' : 'is-ok'}">${escapeHtml(word)}</b>`);
    const again = waWroteAgain(t);
    if(again) facts.push(`<b class="is-new">The client wrote again ${escapeHtml(waAt(again))}</b>`);
    if(t.improvement_id) facts.push('<b class="is-ok">In the weekly update</b>');
    const addUpd = can && typeof waUpdateFits === 'function' && waUpdateFits(t) ? `<button class="btn" onclick="waAddToUpdate('${t.id}')">${icon('plus')}Add to Update</button>` : '';
    acts = can ? `${t.task_id ? taskBtn : ''}${addUpd}<button class="btn${again ? ' btn-p' : ''}" onclick="waReopen('${t.id}')">Reopen</button>` : '';
  }
  const sum = t.detail || `First seen ${waWhen(t.first_seen)}.`;
  const owner = can && !closed
    ? `<label class="pop pop-sel"><span class="pl">${escapeHtml(waOwnerName(t))}</span>${icon('caret-down')}<select aria-label="Assigned to" onchange="waReassign('${t.id}', this.value)">${t.owner_key ? '' : '<option value="" selected>Unassigned</option>'}${WA_OWNERS.map(([k, n]) => `<option value="${k}"${t.owner_key === k ? ' selected' : ''}>${n}</option>`).join('')}</select></label>`
    : escapeHtml(waOwnerName(t));
  const prio = can && !closed
    ? `<label class="pop pop-sel"><span class="pl">${t.priority === 'high' ? 'High' : t.priority === 'low' ? 'Low' : 'Normal'}</span>${icon('caret-down')}<select aria-label="Priority" onchange="waSetPriority('${t.id}', this.value)">${[['high', 'High'], ['normal', 'Normal'], ['low', 'Low']].map(([v, n]) => `<option value="${v}"${(t.priority || 'normal') === v ? ' selected' : ''}>${n}</option>`).join('')}</select></label>`
    : (t.priority === 'high' ? 'High' : t.priority === 'low' ? 'Low' : 'Normal');
  const today = toDateStr(rNow());
  const due = can && !closed
    ? `<span class="wap-due${t.due_date && t.due_date < today ? ' tkp-late' : ''}">${sheetDateField('waDue', t.due_date || '', { none: 'Add a date', from: 0, to: 20, after: 'waDueChanged', label: 'Due date' })}</span>`
    : t.due_date ? `<span${!closed && t.due_date < today ? ' class="tkp-late"' : ''}>${escapeHtml(fmtShortDate(new Date(t.due_date + 'T12:00:00')))}</span>` : '<span class="t-3">No date</span>';
  const gname = g ? waCleanName(g.name) : '';
  const meta = `<div class="sp-sec"><b>Details</b></div><div class="tkp-meta wap-meta">
<span class="tkp-k">Assigned to</span><span class="tkp-v">${owner}${lead && t.ai_owner_key && t.owner_key && t.ai_owner_key !== t.owner_key ? `<em>the agent picked ${escapeHtml((WA_OWNERS.find(o => o[0] === t.ai_owner_key) || [, t.ai_owner_key])[1])}</em>` : ''}</span>
<span class="tkp-k">Priority</span><span class="tkp-v">${prio}</span>
<span class="tkp-k">Due</span><span class="tkp-v">${due}</span>
${g && waNorm(gname) !== waNorm(cname) ? `<span class="tkp-k">Group</span><span class="tkp-v"><span title="${escapeHtml(g.name)}">${escapeHtml(gname)}</span></span>` : ''}
${t.task_id ? `<span class="tkp-k">Task</span><span class="tkp-v"><a href="#" onclick="waOpenTask('${t.id}');return false;">${escapeHtml(linkedTask ? linkedTask.title : 'Open the task')}</a>${linkedTask && linkedTask.status === 'done' ? '<em>done</em>' : ''}</span>` : ''}
</div>`;
  return `<aside class="sp wap" aria-label="${escapeHtml(t.title)}">
<div class="sp-bar"><button class="ib" aria-label="Close" title="Close (Esc)" onclick="closeWaPanel()">${icon('x')}</button></div>
<div class="wap-top"><div class="wap-who">${who}</div><h3>${escapeHtml(t.title)}</h3><div class="wap-facts">${facts.join('<i>·</i>')}</div></div>
<p class="wap-sum">${escapeHtml(sum)}</p>
${acts ? `<div class="sp-acts">${acts}</div>` : ''}
${can && !closed && typeof waUpdateSwitchHtml === 'function' ? waUpdateSwitchHtml(t) : ''}
${waChatHtml(t)}
${meta}
${can && !closed ? `<p class="wa-learn">${icon('sparkle')}<span>Changing who has it, or Not a Task, teaches the agent for its next check.</span></p>` : ''}
</aside>`;
}

// ---- changes ---------------------------------------------------------------------------------
async function waUpdate(id, patch, okMsg, okSub){
  const t = waTasks.find(x => x.id === id), before = t ? { ...t } : null;
  if(t) Object.assign(t, patch, { updated_at: new Date().toISOString() });
  updateWaNavBadge(); renderWhatsapp(); waRedrawToday();
  const { error } = await supabaseClient.from('wa_tasks').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  if(error){
    if(t && before) Object.assign(t, before);
    updateWaNavBadge(); renderWhatsapp(); waRedrawToday();
    showToast('error', 'Not saved', error.message); return false;
  }
  if(okMsg) showToast('success', okMsg, okSub || '');
  return true;
}
function waRedrawToday(){ if(typeof currentViewName !== 'undefined' && currentViewName === 'overview' && typeof renderDashboard === 'function') renderDashboard(); }
// The task made from an item, if it's still there and not cancelled.
function waLinkedTask(t){ return t && t.task_id != null && typeof tasks !== 'undefined' ? tasks.find(x => String(x.id) === String(t.task_id) && !x.cancelledAt) || null : null; }
// Done here is done everywhere: the task made from it is finished too (when it's yours or you
// assigned it; someone else's task stays with them, and they hear nothing new).
async function waMarkDone(id){
  const t = waTasks.find(x => x.id === id), task = waLinkedTask(t), open = !!task && task.status !== 'done';
  const mine = open && (task.assigneeId === currentUser?.id || task.assignerId === currentUser?.id);
  const fits = typeof waUpdateFits === 'function' && waUpdateFits(t) && waAddPref();
  const ok = await waUpdate(id, { status: 'done' });
  if(!ok) return false;
  // and, unless switched off, a line in the client's weekly update (Nov 24)
  const upd = fits ? await waAddToUpdate(id, true) : null;
  const updWords = upd ? `Added to ${upd.name}’s update.` : '';
  if(mine){
    const done = await finishTask(task.id, 'Done in WhatsApp.', null, { fromWhatsapp: true, quiet: true });
    showToast('success', 'Marked done', [done ? 'Its task is done too.' : '', updWords].filter(Boolean).join(' '));
  } else showToast('success', 'Marked done', [open ? `${firstName((teamProfiles.find(p => p.id === task.assigneeId) || {}).name || 'Its owner')} still has the task for it.` : '', updWords].filter(Boolean).join(' '));
  if(upd) renderWhatsapp();
  return true;
}
// Reopened here, the finished task made from it opens again too.
async function waReopen(id){
  const t = waTasks.find(x => x.id === id), task = waLinkedTask(t);
  const ok = await waUpdate(id, { status: 'open' });
  if(!ok) return ok;
  let also = false;
  if(task && task.status === 'done' && (task.assigneeId === currentUser?.id || task.assignerId === currentUser?.id)){
    const { error } = await supabaseClient.from('tasks').update({ status: 'todo', completed_at: null }).eq('id', task.id);
    if(!error){ also = true; if(typeof loadMyTasks === 'function') await loadMyTasks(); if(typeof updateTasksNavBadge === 'function') updateTasksNavBadge(); renderWhatsapp(); waRedrawToday(); }
  }
  showToast('success', 'Reopened', also ? 'Its task is back in To Do.' : '');
  return ok;
}
// From another screen (the Dashboard, a task): the WhatsApp page with this item open.
function waOpenItem(id){
  switchView('whatsapp');
  setTimeout(() => { window._waSel = id; renderWhatsapp(); waLoadChat(id); }, 0);
}
function waSetPriority(id, v){ return waUpdate(id, { priority: v }); }
function waDueChanged(v){ const id = window._waSel; if(id) waUpdate(id, { due_date: v || null }, v ? 'Due date set' : 'Due date removed'); }
async function waDismiss(id){
  if(window._waSel === id) window._waSel = null;
  return waUpdate(id, { status: 'dismissed' }, 'Not a task', 'The agent will learn from this.');
}
async function waReassign(id, key){
  // the person, so it shows under their own items
  const person = (teamProfiles || []).find(p => {
    const first = String(p.name || '').trim().split(/\s+/)[0].toLowerCase();
    return first === key || (key === 'dan' && first === 'daniel');
  });
  const name = (WA_OWNERS.find(o => o[0] === key) || [, key])[1];
  return waUpdate(id, { owner_key: key, owner_user_id: person ? person.id : null }, `Assigned to ${name}`, person ? '' : `No one named ${name} on the team yet, so it’s unassigned in Radar.`);
}
// Make a Task: the New Task sheet, filled in from the item; once it's created the item links to it.
function waMakeTask(id){
  const t = waTasks.find(x => x.id === id); if(!t) return;
  const c = waClient(t), g = waGroup(t), today = toDateStr(rNow());
  const assignee = t.owner_user_id && (teamProfiles || []).some(p => p.id === t.owner_user_id && !p.access_revoked) ? t.owner_user_id : currentUser.id;
  const notes = [t.source_excerpt ? `“${t.source_excerpt}”` : '', t.detail || '', `From ${g ? `the ${waCleanName(g.name)} WhatsApp group` : 'a client WhatsApp group'}.`].filter(Boolean).join('\n\n');
  openNewTaskModal(assignee, 'todo', {
    title: t.title, clientId: c ? c.id : '', description: notes,
    priority: t.priority === 'high' ? 'high' : t.priority === 'low' ? 'low' : 'medium',
    due: t.due_date && t.due_date >= today ? t.due_date : '',
    afterCreate: task => waLinkTask(t.id, task.id),
  });
}
async function waLinkTask(id, taskId){
  const t = waTasks.find(x => x.id === id);
  if(t) t.task_id = taskId;
  const { error } = await supabaseClient.from('wa_tasks').update({ task_id: taskId, updated_at: new Date().toISOString() }).eq('id', id);
  if(error){
    if(t) t.task_id = null;
    showToast('info', 'Task created', waMissingCol(error) ? 'To link it to this WhatsApp item, run addendum-whatsapp-check-now.sql in Supabase once.' : `It isn’t linked to the WhatsApp item: ${error.message}`);
  }
  renderWhatsapp();
}
function waOpenTask(id){
  const t = waTasks.find(x => x.id === id); if(!t || !t.task_id) return;
  switchView('tasks');
  setTimeout(() => { window._taskSel = t.task_id; if(typeof renderTasks === 'function') renderTasks(); if(typeof loadTaskComments === 'function') loadTaskComments(t.task_id); }, 0);
}

async function openWhatsappView(){
  renderWhatsapp();            // what's already loaded (the app loads it at sign-in), or a spinner
  await loadWaTasks();
  renderWhatsapp();
  if(window._waSel) waLoadChat(window._waSel);
  waStartRealtime();
}
// Escape closes the panel.
document.addEventListener('keydown', e => {
  if(e.key !== 'Escape' || document.getElementById('appModalOverlay') || document.querySelector('.sheet-overlay, .modal-overlay')) return;
  if(typeof currentViewName !== 'undefined' && currentViewName === 'whatsapp' && window._waSel) closeWaPanel();
});

// ---- Settings → WhatsApp (admins and approvers) ------------------------------------------------
const WA_ROLE_DEFAULTS = {
  albert: 'Web development: website builds, fixes, landing pages, forms, plugins, site bugs, design changes on the site.',
  stan: 'AI SEO: AI search visibility, ChatGPT/Perplexity/AI Overviews questions, llms.txt, schema for AI.',
  eric: 'Main point of contact for clients plus paid ads: Google Ads, Facebook/Meta Ads, budgets, leads quality, ad copy, billing questions about ads, anything not clearly someone else\'s.',
  charlie: 'Mainly SEO (rankings, GBP/local SEO, content, backlinks, citations) and hosting (domains, DNS, email setup, SSL, site down).',
  dan: 'Owner: contracts, pricing, invoices/payments, complaints, cancellations, strategy, other client-relationship matters.',
  joey: 'Video production and client calls: shoots, edits, scheduling/attending calls and meetings.',
};
const WA_TIMEZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Sao_Paulo', 'UTC'];
const WA_OFF_SHOWN = 4;        // "Not reading" shows this many, then Show N more
const WA_ON_SHOWN = 10;        // "Reading" shows this many, then Show N more (Nov 24: 24 groups made a long page)
let waGroupQuery = '', waPoll = null, waShowAllOff = false, waShowAllOn = false, waRoleEdit = null;

function waQrOk(){
  const s = waSettings;
  return !!(s && s.qr && s.qr_at && Date.now() - new Date(s.qr_at).getTime() < WA_STALE_MS && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s.qr));
}
function waWhoSeesRow(){
  const testers = waTesters(), onlyMe = testers.length === 1 && testers[0] === currentUser?.id;
  return testers.length
    ? `<div class="fr"><div class="l"><b>Who sees it</b><span>Test mode: ${onlyMe ? 'only you see' : `only the ${testers.length} testers see`} WhatsApp in Radar and get its Slack messages. Nobody else is told.</span></div><span class="st">${icon('lock-simple')}${onlyMe ? 'Only you' : testers.length + ' testers'}</span><button class="btn btn-p" onclick="waGoLive()">Go Live…</button></div>`
    : `<div class="fr"><div class="l"><b>Who sees it</b><span>Everyone sees the items that are theirs. Admins and approvers see them all and get the full list in Slack. This setup is the same for the whole team, and only admins change it.</span></div><span class="st"><span class="dot green"></span>Live</span></div>`;
}
function waPcRow(){
  const s = waSettings, run = waRunning();
  const sub = run ? 'Radar WhatsApp is running · seen a few seconds ago'
    : s && s.heartbeat_at ? `Stopped · last seen ${waWhen(s.heartbeat_at)}. ${WA_START}`
    : `Not started yet. ${WA_START_FIRST}`;
  return `<div class="fr"><span class="was-ic gray">${icon('server')}</span><div class="l"><b>Connector</b><span>${escapeHtml(sub)}</span></div><span class="st"><span class="dot ${run ? 'green' : 'red'}"></span>${run ? 'Running' : 'Not running'}</span></div>`;
}
function waConnHtml(){
  const st = waConnState(), s = waSettings;
  if(st.key === 'missing') return `<div class="fr"><span class="was-ic gray">${icon('message-circle')}</span><div class="l"><b>${escapeHtml(st.text)}</b><span>${escapeHtml(st.long)}</span></div></div>`;
  if(st.key === 'qr' && waQrOk()) return `<div class="was-link"><img class="was-qr" src="${s.qr}" alt="Code to scan with WhatsApp" width="150" height="150">
<div class="was-lt"><b>Scan this with WhatsApp</b><ol><li>Open WhatsApp on the phone that’s in the client groups.</li><li>Go to Settings, then Linked devices, then Link a device.</li><li>Point the phone at this code.</li></ol>
<span class="st"><span class="dot gray"></span>Waiting for the scan · the code refreshes by itself</span></div></div>${waPcRow()}${waWhoSeesRow()}`;
  if(st.key === 'stopped') return `${waPcRow()}<div class="fr"><span class="was-ic">${icon('message-circle')}</span><div class="l"><b>WhatsApp</b><span>${s.heartbeat_at ? 'It reconnects by itself once Radar WhatsApp is running again.' : 'You’ll scan a code here once Radar WhatsApp is running.'}</span></div></div>${waWhoSeesRow()}`;
  if(st.key === 'connected'){
    return `<div class="fr"><span class="was-ic">${icon('message-circle')}</span><div class="l"><b>WhatsApp</b><span>Linked · checked in a few seconds ago</span></div><span class="st"><span class="dot green"></span>Connected</span><button class="btn" onclick="waRelink()">Re-link…</button></div>
<div class="fr"><div class="l"><b>Last check</b><span>${escapeHtml(waChecking() ? 'Checking the groups now. It usually takes a minute or two.' : `${waRunText(waLastRun())} ${waNextText()}`)}</span></div>${waCheckBtn()}</div>${waWhoSeesRow()}`;
  }
  return `<div class="fr"><span class="was-ic${st.key === 'signedout' ? ' red' : ''}">${icon('message-circle')}</span><div class="l"><b>${escapeHtml(st.text)}</b><span>${escapeHtml(st.long)}</span></div><button class="btn" onclick="waRelink()">Re-link…</button></div>${waPcRow()}${waWhoSeesRow()}`;
}
function setWhatsapp(){
  const sec = html => `<div class="wa-sec">${html}</div>`;
  if(waReady === false || !waSettings) return sec(`<div class="set-h">Connection</div><div class="form-grp" id="waConnBox">${waConnHtml()}</div>
${emptyState({ compact: true, icon: 'message-circle', tone: 'blue', title: 'Add WhatsApp to the database first', html: true,
    text: 'Run <code>schema-whatsapp-tasks.sql</code> in Supabase → SQL Editor, then start Radar WhatsApp. This page then shows the code to scan.' })}`);
  const s = waSettings;
  const tzs = WA_TIMEZONES.includes(s.timezone) ? WA_TIMEZONES : [s.timezone, ...WA_TIMEZONES];
  const times = waTimes();
  const timeOpts = cur => { const o = []; for(let m = 6 * 60; m <= 22 * 60; m += 30){ const hh = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); o.push([hh, waHm(hh)]); } if(!o.some(x => x[0] === cur)) o.push([cur, waHm(cur)]); o.sort((a, b) => a[0].localeCompare(b[0])); return o; };
  const timePops = times.map((t, i) => popSel(`Check time ${i + 1}`, [...timeOpts(t), ...(times.length > 1 ? [['__rm', 'Remove this time']] : [])], t, `waTimeSel(${i}, this.value)`)).join('');
  const localTz = (() => { try{ return Intl.DateTimeFormat().resolvedOptions().timeZone; }catch(e){ return ''; } })();
  let tzSub = 'The same as yours';
  if(localTz && localTz !== s.timezone){
    const p = waTzParts(rNow(), waTz()), at = waZoned(p.y, p.m, p.d, times[0], waTz());
    tzSub = `${waHm(times[0])} in ${waCity(waTz())} is ${fmtTime(at)} for you`;
  }
  return sec(`<div class="set-h">Connection</div><div class="form-grp" id="waConnBox">${waConnHtml()}</div>`)
    + sec(waGroupsHtml())
    + sec(`<div class="set-h">When it checks</div>
<div class="form-grp"><div class="fr"><div class="l"><b>Weekdays at</b><span>${waTesters().length ? `It reads the groups, then sends ${waTesters().length === 1 && waTesters()[0] === currentUser?.id ? 'you' : 'the testers'} the full list in Slack.` : 'It reads the groups, then sends each person their list in Slack.'}</span></div>
<div class="was-times">${timePops}${times.length < 6 ? `<button class="ib" aria-label="Add a time" title="Add a time" onclick="waAddTime()">${icon('plus')}</button>` : ''}</div></div>
${fr('Time zone', escapeHtml(tzSub), popSel('Time zone', tzs.map(z => [z, waCity(z)]), s.timezone, 'waSetZone(this.value)'))}</div>`)
    + sec(`<div class="set-h">Who handles what</div>
<p class="t-2 wa-p">The agent gives each item to whoever these describe. Edit one to change what it sends them.</p>
<div class="form-grp">${WA_OWNERS.map(([k, n]) => waRoleRow(k, n)).join('')}</div>`);
}
function waRoleRow(k, n){
  const note = (waSettings.role_notes || {})[k] || '';
  if(waRoleEdit === k) return `<div class="fr was-r is-edit"><div class="l"><b>${n}</b></div>
<div class="was-ed"><textarea class="tf" id="waRoleTa" rows="3" aria-label="What ${n} handles">${escapeHtml(note || WA_ROLE_DEFAULTS[k])}</textarea>
<div class="was-eda">${note ? `<button class="btn" onclick="waRoleDefault('${k}')">Use the Default</button>` : ''}<button class="btn" onclick="waRoleCancel()">Cancel</button><button class="btn btn-p" onclick="waRoleDone('${k}')">Done</button></div></div></div>`;
  return `<div class="fr was-r"><div class="l"><b>${n}${note ? '<span class="was-tag">Edited</span>' : ''}</b><span>${escapeHtml(note || WA_ROLE_DEFAULTS[k])}</span></div><button class="lnk-b" onclick="waRoleOpen('${k}')">Edit</button></div>`;
}
function waGroupSub(g){
  if(g.active && g.manual && !g.auto_match) return 'On because you turned it on';
  if(!g.active && g.manual && g.auto_match) return 'Off because you turned it off';
  if(!g.active && !g.auto_match) return 'Not a client group';
  return '';
}
function waGroupRow(g){
  const sub = waGroupSub(g), name = waCleanName(g.name);
  return `<div class="fr was-g${g.active ? '' : ' is-off'}"><div class="l"><b title="${escapeHtml(g.name)}">${escapeHtml(name)}</b>${sub ? `<span>${sub}</span>` : ''}</div>${swHtml(g.active, name, `waToggleGroup('${escapeHtml(g.jid)}', ${!g.active})`)}</div>`;
}
function waGroupsHtml(){
  const total = waGroups.length, on = waGroups.filter(g => g.active).length;
  const q = waGroupQuery.trim().toLowerCase();
  const match = g => !q || g.name.toLowerCase().includes(q) || waCleanName(g.name).toLowerCase().includes(q);
  const byName = (a, b) => waCleanName(a.name).localeCompare(waCleanName(b.name));
  const reading = waGroups.filter(g => g.active && match(g)).sort(byName), off = waGroups.filter(g => !g.active && match(g)).sort(byName);
  const all = q ? ['Turn These On', 'Turn These Off'] : ['Turn All On', 'Turn All Off'];
  const head = `<div class="set-h was-h">Groups it reads${total ? `<span class="n">${on} of ${total}</span><span class="was-all"><button class="lnk-b" onclick="waTurnAll(true)">${all[0]}</button><button class="lnk-b" onclick="waTurnAll(false)">${all[1]}</button></span>` : ''}</div>
<p class="t-2 wa-p">Groups with “Marketing” in the name start on. Personal chats are never read.</p>`;
  if(!total) return head + `<div class="form-grp">${emptyState({ compact: true, icon: 'users', title: 'No groups yet',
    text: waConnState().key === 'connected' ? 'WhatsApp is still sending the list. They show here within a minute or two.' : 'They show here a minute after WhatsApp is linked.' })}</div>`;
  const shownOff = q || waShowAllOff ? off : off.slice(0, WA_OFF_SHOWN);
  const shownOn = q || waShowAllOn ? reading : reading.slice(0, WA_ON_SHOWN);
  const moreOn = !q && reading.length > WA_ON_SHOWN
    ? `<div class="fr was-more"><button class="lnk-b" data-grow="wa-on" aria-expanded="${waShowAllOn}" data-turn="180" onclick="waToggleOn()">${waShowAllOn ? 'Show less' : `Show ${reading.length - WA_ON_SHOWN} more`}${icon('caret-down', { weight: 'bold' })}</button></div>` : '';
  const more = !q && off.length > WA_OFF_SHOWN
    ? `<div class="fr was-more"><button class="lnk-b" data-grow="wa-off" aria-expanded="${waShowAllOff}" data-turn="180" onclick="waToggleOff()">${waShowAllOff ? 'Show less' : `Show ${off.length - WA_OFF_SHOWN} more`}${icon('caret-down', { weight: 'bold' })}</button></div>` : '';
  const rows = (reading.length ? `<div class="was-sub">Reading<span>${reading.length}</span></div><div data-grow-key="wa-on">${shownOn.map(waGroupRow).join('')}</div>${moreOn}` : '')
    + (off.length ? `<div class="was-sub">Not reading<span>${off.length}</span></div><div data-grow-key="wa-off">${shownOff.map(waGroupRow).join('')}</div>${more}` : '')
    || `<div class="fr"><div class="l"><span>No group matches “${escapeHtml(waGroupQuery)}”.</span></div></div>`;
  return head + `<div class="form-grp">${total > 6 ? `<div class="fr was-find"><input class="tf wa-gq" type="search" placeholder="Find a group" aria-label="Find a group" value="${escapeHtml(waGroupQuery)}" oninput="waFindGroup(this.value)"></div>` : ''}<div id="waGroupRows">${rows}</div></div>`;
}
function waFindGroup(v){
  waGroupQuery = v || '';
  renderSettingsView();
  const f = document.querySelector('.wa-gq'); if(f){ f.focus(); f.setSelectionRange(f.value.length, f.value.length); }
}
function waToggleOff(){ waShowAllOff = !waShowAllOff; renderSettingsView(); }
function waToggleOn(){ waShowAllOn = !waShowAllOn; renderSettingsView(); }
function waRoleOpen(k){ waRoleEdit = k; renderSettingsView(); setTimeout(() => { const ta = document.getElementById('waRoleTa'); if(ta){ ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }, 0); }
function waRoleCancel(){ waRoleEdit = null; renderSettingsView(); }
async function waRoleDone(k){
  const v = (document.getElementById('waRoleTa')?.value || '').trim();
  waRoleEdit = null;
  await waSaveRole(k, v === WA_ROLE_DEFAULTS[k] ? '' : v);
  renderSettingsView();
}
async function waRoleDefault(k){ waRoleEdit = null; await waSaveRole(k, ''); renderSettingsView(); }
function waSettingsOpen(){ return typeof currentViewName !== 'undefined' && currentViewName === 'settings' && typeof settingsTab !== 'undefined' && settingsTab === 'whatsapp'; }
// While the pane is open: refresh the connection (and its code) every few seconds, without
// redrawing what you might be typing in.
async function waStartPoll(){
  await loadWaTasks();
  if(waSettingsOpen()) renderSettingsView();
  if(waPoll) return;
  waPoll = setInterval(async () => {
    if(!waSettingsOpen() || document.hidden){ if(!waSettingsOpen()){ clearInterval(waPoll); waPoll = null; } return; }
    const had = waGroups.length, key = waConnState().key;
    await loadWaTasks();
    const box = document.getElementById('waConnBox');
    if(box) box.innerHTML = waConnHtml();
    // the groups arrive once the number is linked; the page around the code changes once it's scanned
    if((!had && waGroups.length) || (key !== waConnState().key && !waRoleEdit && document.activeElement?.tagName !== 'INPUT')) renderSettingsView();
  }, 4000);
}
async function waSaveSettings(patch, okMsg){
  const { error } = await supabaseClient.from('wa_settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 1);
  if(error){ showToast('error', 'Not saved', error.message); return false; }
  Object.assign(waSettings, patch);
  if(okMsg) showToast('success', okMsg, 'Radar WhatsApp picks it up within a minute.');
  return true;
}
async function waToggleGroup(jid, on){
  const g = waGroups.find(x => x.jid === jid); if(!g) return;
  const was = { active: g.active, manual: g.manual };
  Object.assign(g, { active: !!on, manual: true });
  renderSettingsView();
  const { error } = await supabaseClient.from('wa_groups').update({ active: !!on, manual: true, updated_at: new Date().toISOString() }).eq('jid', jid);
  if(error){ Object.assign(g, was); renderSettingsView(); showToast('error', 'Not saved', error.message); }
}
// Turn All On / Off: every group, or the ones the find field matches.
async function waTurnAll(on){
  const q = waGroupQuery.trim().toLowerCase();
  const list = waGroups.filter(g => !q || g.name.toLowerCase().includes(q) || waCleanName(g.name).toLowerCase().includes(q)).filter(g => g.active !== !!on);
  if(!list.length){ showToast('info', on ? 'They’re all on already' : 'They’re all off already'); return; }
  if(on && !q && list.some(g => !g.auto_match)){
    const ok = await confirmDialog(`This also turns on ${list.filter(g => !g.auto_match).length} group${list.filter(g => !g.auto_match).length === 1 ? '' : 's'} that don’t look like client groups, so their messages are read too. Personal chats stay unread.`, { title: `Turn on all ${waGroups.length} groups?`, confirmLabel: 'Turn All On' });
    if(!ok) return;
  }
  const was = list.map(g => ({ g, active: g.active, manual: g.manual }));
  list.forEach(g => Object.assign(g, { active: !!on, manual: true }));
  renderSettingsView();
  const { error } = await supabaseClient.from('wa_groups').update({ active: !!on, manual: true, updated_at: new Date().toISOString() }).in('jid', list.map(g => g.jid));
  if(error){ was.forEach(w => Object.assign(w.g, { active: w.active, manual: w.manual })); renderSettingsView(); showToast('error', 'Not saved', error.message); return; }
  showToast('success', `${list.length} group${list.length === 1 ? '' : 's'} turned ${on ? 'on' : 'off'}`, 'Radar WhatsApp picks it up within a minute.');
}
async function waTimeSel(i, v){
  const t = waTimes();
  if(v === '__rm'){ if(t.length <= 1) return; t.splice(i, 1); }
  else if(/^([01]?\d|2[0-3]):[0-5]\d$/.test(v)) t[i] = v;
  else return;
  await waSaveSettings({ digest_times: [...new Set(t)].sort() }, 'Schedule saved'); renderSettingsView();
}
async function waAddTime(){
  const t = waTimes(); if(t.length >= 6) return;
  const next = ['12:00', '17:00', '07:00', '19:00', '11:00', '13:00'].find(x => !t.includes(x)) || '12:00';
  await waSaveSettings({ digest_times: [...t, next].sort() }, 'Schedule saved'); renderSettingsView();
}
async function waSetZone(z){ await waSaveSettings({ timezone: z }, 'Time zone saved'); renderSettingsView(); }
async function waSaveRole(k, v){
  const notes = { ...(waSettings.role_notes || {}) }, val = String(v || '').trim().slice(0, 600);
  if(val) notes[k] = val; else delete notes[k];
  await waSaveSettings({ role_notes: notes }, 'Saved');
}
async function waRelink(){
  const ok = await confirmDialog('This signs out the current number and shows a new code here to scan. Reading stops until a number is linked again.', { title: 'Re-link a WhatsApp number?', confirmLabel: 'Re-link' });
  if(!ok) return;
  if(await waSaveSettings({ relink_requested: true })) showToast('success', 'Re-link requested', 'A new code shows here within a minute.');
}
// Settings → Integrations shows WhatsApp with the others.
function waIntegrationRow(){
  if(!waCanManage() || waHidden()) return null;
  const st = waConnState(), setup = waCanSetup();
  return ['message-circle', 'WhatsApp', setup ? 'Reads client groups and lists what clients are waiting on' : 'Reads client groups for the whole team. Admins manage it.', `<span class="st"><span class="dot ${st.dot}"></span>${escapeHtml(st.text)}</span>`,
    setup ? `<button class="btn" onclick="switchSettingsTab('whatsapp')">Settings…</button>` : '', setup ? "switchSettingsTab('whatsapp')" : "switchView('whatsapp')"];
}
// Test mode → live, from the Who sees it row. Testers who aren't admins lose this page after it,
// so the dialog says so.
async function waGoLive(){
  const admin = typeof isAdmin === 'function' && isAdmin();
  const ok = await confirmDialog(`Everyone on the team then sees the WhatsApp items that are theirs and gets them in Slack. Admins and approvers see them all.${admin ? '' : ' After this only admins can change the WhatsApp settings, so this page will no longer show for you.'}`,
    { title: 'Go live for the whole team?', confirmLabel: 'Go Live' });
  if(!ok) return;
  const { error } = await supabaseClient.rpc('wa_go_live');
  if(error){
    const missing = /wa_go_live|PGRST202|Could not find/i.test(`${error.code || ''} ${error.message || ''}`);
    showToast('error', 'Not live yet', missing ? 'This needs a one-time database update: run addendum-whatsapp-admins.sql in Supabase → SQL Editor.' : error.message);
    return;
  }
  if(waSettings) waSettings.pilot_user_ids = [];
  await loadWaTasks();
  showToast('success', 'WhatsApp is live for the team', 'Everyone gets their items from the next check.');
  if(typeof renderSettingsView === 'function') renderSettingsView();
  updateWaNav();
}
