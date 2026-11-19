// WhatsApp: what clients are waiting on, found by the connector in client WhatsApp groups.
// Everyone sees their own; admins and approvers see everyone's and set it up in Settings.
// In test mode (wa_settings.pilot_user_ids) only the testers see any of it, whatever their role;
// the database says which applies to whoever is signed in (wa_access()).
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
let waTab = 'open';            // 'open' | 'done'
let waRealtimeStarted = false;
let waAccessLevel = null;      // 'manage' | 'own' | 'none' from the database; null = it doesn't say (older setup)
let waContact = null;          // leads: when the team last wrote in each group it reads (wa_last_contact); null = the database doesn't say
let waQuietAll = false;        // Quiet clients: show them all
let waCheckAt = null;          // when Check Now was pressed in this tab (ISO)
let waCheckTimer = null;
const waChat = {};             // item id -> its messages ([] when there are none) · 'loading' · 'none' (the database can't say)

const WA_OWNERS = [['albert', 'Albert'], ['stan', 'Stan'], ['eric', 'Eric'], ['charlie', 'Charlie'], ['dan', 'Dan'], ['joey', 'Joey']];
const WA_KIND = { request: 'Request', question: 'Question', promise: 'We promised', issue: 'Problem' };
const WA_KIND_IC = { request: 'list-checks', question: 'circle-help', promise: 'handshake', issue: 'flag' };
const WA_STALE_MS = 120000;    // the connector writes a heartbeat about every 30 s
const WA_QUIET_DAYS = 7;       // no message or update from us in this many days: a quiet client
const WA_QUIET_SHOWN = 4;

// Who sees what (wa_access(), read with the rest in waLoadNow). Before the test-mode update the
// database doesn't say, so the role decides.
function waCanManage(){ return waAccessLevel ? waAccessLevel === 'manage' : canApprove(); }
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
  const [acc, tk, r, s, g, lc] = await Promise.all([
    safe(supabaseClient.rpc('wa_access')),
    safe(supabaseClient.from('wa_tasks').select('*').order('first_seen', { ascending: true })),
    safe(supabaseClient.from('wa_runs').select('*').order('started_at', { ascending: false }).limit(20)),
    safe(supabaseClient.from('wa_settings').select('*').eq('id', 1).maybeSingle()),
    safe(supabaseClient.from('wa_groups').select('*').order('name', { ascending: true })),
    safe(supabaseClient.rpc('wa_last_contact')),
  ]);
  waAccessLevel = !acc.error && ['manage', 'own', 'none'].includes(acc.data) ? acc.data : null;
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
  if(waCanManage()){ waRuns = r.data || []; waSettings = s.data || null; waGroups = g.data || []; waContact = lc.error ? null : (lc.data || []); }
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
    if(currentViewName === 'whatsapp') renderWhatsapp();
  }).subscribe();
}

// ---- small helpers ---------------------------------------------------------------------------
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
  b.textContent = n; b.style.display = n ? 'flex' : 'none';
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
  for(let k = 0; k < 3; k++){
    const day = new Date(Date.UTC(p.y, p.m - 1, p.d + k, 12));
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

// Where the connection stands, for leads.
//   key: 'missing' | 'stopped' | 'qr' | 'signedout' | 'reconnecting' | 'connected'
function waConnState(){
  const s = waSettings;
  if(waReady === false || !s) return { key: 'missing', dot: 'hollow', text: 'Not set up yet', long: 'An admin runs schema-whatsapp-tasks.sql in Supabase → SQL Editor, then starts Radar WhatsApp on the office PC.' };
  if(!waRunning()) return s.heartbeat_at
    ? { key: 'stopped', dot: 'red', text: 'Office PC isn’t running it', long: `Last seen ${waWhen(s.heartbeat_at)}. On the office PC, open the radar-whatsapp folder and double-click “2 - Start”.` }
    : { key: 'stopped', dot: 'red', text: 'Not started on the office PC yet', long: 'On the office PC, open the radar-whatsapp folder and double-click “2 - Start”.' };
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
async function waCheckNow(){
  if(waConnState().key !== 'connected'){ showToast('error', 'WhatsApp isn’t connected', waConnState().long); return; }
  const at = new Date().toISOString();
  const { error } = await supabaseClient.from('wa_settings').update({ check_requested_at: at }).eq('id', 1);
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
      // still waiting to be picked up: the PC is running an older version, or isn't running
      clearInterval(waCheckTimer); waCheckTimer = null; waCheckAt = null;
      await supabaseClient.from('wa_settings').update({ check_requested_at: null }).eq('id', 1);
      if(waSettings) waSettings.check_requested_at = null;
      showToast('error', 'The office PC didn’t start the check', waRunning() ? 'It needs the update: copy the src folder from connector-update.zip into radar-whatsapp, then start it again.' : 'Radar WhatsApp isn’t running on it.');
      waRedraw(); return;
    }
    if(!waChecking()){
      clearInterval(waCheckTimer); waCheckTimer = null;
      const r = waLastRun();
      if(r && r.id !== before) showToast('success', 'Checked', r.tasks_new ? `Found ${r.tasks_new} new.` : 'Nothing new.');
      waCheckAt = null;
    }
    waRedraw();
  }, 5000);
}
function waRedraw(){
  if(typeof currentViewName === 'undefined') return;
  if(currentViewName === 'whatsapp') renderWhatsapp();
  if(waSettingsOpen()){ const box = document.getElementById('waConnBox'); if(box) box.innerHTML = waConnHtml(); }
}

// ---- the screen ------------------------------------------------------------------------------
function setWa(k, v){ if(k === 'tab') waTab = v; if(k === 'who') waWho = v; window._waSel = null; renderWhatsapp(); }
function selectWa(id){ window._waSel = window._waSel === id ? null : id; renderWhatsapp(); if(window._waSel) waLoadChat(id); }
function closeWaPanel(){ window._waSel = null; renderWhatsapp(); }
function renderWhatsappTasks(){ renderWhatsapp(); }   // the old name, still called by realtime
// Never a blank screen: before the first load a spinner, and if drawing fails, what happened and Try Again.
function renderWhatsapp(){
  const root = document.getElementById('whatsappRoot');
  if(!root || !currentUser) return;
  if(currentViewName === 'whatsapp') setToolbar(null, 'Client chats');
  if(!waLoaded){ root.innerHTML = `<div class="spw"><div class="sp-page"><div class="wa">${loadingStateHtml('Loading WhatsApp…')}</div></div></div>`; return; }
  try{ waDraw(root); }
  catch(e){
    console.error('WhatsApp screen', e);
    root.innerHTML = `<div class="spw"><div class="sp-page"><div class="wa">${emptyState({ icon: 'refresh-cw', title: 'WhatsApp couldn’t be shown', text: String(e && e.message || e), action: 'Try Again', onAction: 'openWhatsappView()' })}</div></div></div>`;
  }
}
function waDraw(root){
  if(waHidden()){ root.innerHTML = ''; return; }
  if(waLoadError && !waTasks.length && !waSettings){
    root.innerHTML = `<div class="spw"><div class="sp-page"><div class="wa">${emptyState({ icon: 'refresh-cw', title: 'WhatsApp didn’t load', text: `${waLoadError}. Try again once you’re back online.`, action: 'Try Again', onAction: 'openWhatsappView()' })}</div></div></div>`;
    return;
  }
  const lead = waCanManage();
  const who = lead ? (waWho || 'all') : 'mine';
  const pick = t => who === 'all' ? true : who === 'mine' ? t.owner_user_id === currentUser.id : t.owner_key === who;
  const open = waTasks.filter(t => t.status === 'open' && pick(t)).sort((a, b) => new Date(a.first_seen) - new Date(b.first_seen));
  const wk = waWeekStart().getTime();
  const done = waTasks.filter(t => t.status !== 'open' && pick(t) && new Date(t.answered_at || t.updated_at || t.first_seen).getTime() >= wk)
    .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
  const reading = window._waSel === 'read' && lead;
  const sel = !reading && window._waSel && waTasks.find(t => t.id === window._waSel);
  if(window._waSel && !sel && !reading) window._waSel = null;

  const conn = lead ? waConnState() : null;
  const never = lead && !waTasks.length && !waRuns.some(r => r.kind === 'digest');
  // Not linked yet (or not set up): the steps to start, instead of an empty list.
  if(lead && (waReady === false || (never && conn.key !== 'connected'))){
    root.innerHTML = `<div class="spw"><div class="sp-page"><div class="wa">${waSetupHtml()}</div></div></div>`;
    return;
  }

  const rows = waTab === 'open' ? open : done;
  const late = open.filter(waLate), fresh = open.filter(t => !waLate(t)), high = open.filter(t => t.priority === 'high');
  const whoName = who === 'mine' ? 'you' : who === 'all' ? 'the team' : (WA_OWNERS.find(o => o[0] === who) || [, who])[1];
  const h2 = waTab === 'done' ? (done.length ? `${done.length} done this week` : 'Nothing done this week yet')
    : open.length ? `${open.length} waiting on ${whoName}` : `Nothing waiting on ${whoName}`;
  const subBits = [];
  if(waTab === 'open' && open.length){
    if(late.length) subBits.push(`<span class="t-red">${late.length} waiting over 1 business day</span>`);
    const due = open.filter(waDueToday).length, today = open.filter(t => waDays(t) === 0).length;
    if(due) subBits.push(`${due} to answer today`);
    if(today) subBits.push(`${today} new today`);
  }
  if(lead && conn.key === 'connected'){
    const last = waLastRun(), next = waNextCheck();
    if(last) subBits.push(`checked at <b>${escapeHtml(waAt(last.started_at))}</b>${next ? `, next ${daysBetween(dayStart(rNow()), dayStart(next)) === 0 ? 'at ' : ''}${escapeHtml(waAt(next.toISOString()))}` : ''}`);
  } else if(!lead) subBits.push('From the client WhatsApp groups');
  if(waTab === 'done') subBits.splice(0, subBits.length, 'Marked done, answered in the group, or not a task, since Monday');

  const whoOpts = [['all', 'Everyone'], ['mine', 'Mine'], ...WA_OWNERS];
  const curWho = whoOpts.find(o => o[0] === who) || whoOpts[0];
  const filters = `<div class="seg" role="tablist" aria-label="Show">${[['open', 'Waiting', open.length], ['done', 'Done this week', done.length]].map(([k, t, c]) => `<button class="${waTab === k ? 'on' : ''}" role="tab" aria-selected="${waTab === k}" onclick="setWa('tab','${k}')">${t} <span class="c">${c}</span></button>`).join('')}</div>
${lead ? `<label class="pop pop-sel"><span class="pl">${escapeHtml(curWho[1])}</span>${icon('caret-down')}<select aria-label="Whose items" onchange="setWa('who',this.value)">${whoOpts.map(([v, n]) => `<option value="${v}"${v === who ? ' selected' : ''}>${escapeHtml(n)}</option>`).join('')}</select></label>` : ''}`;

  // Grouped under the client's name, so two things split from one message read as one client.
  // Waiting: the client who has waited longest first; done: the most recent first.
  const byClient = items => { const m = new Map(); items.forEach(t => { const k = waClientLabel(t); if(!m.has(k)) m.set(k, []); m.get(k).push(t); }); return [...m.entries()]; };
  const groupHtml = ([name, ts]) => `<section class="wa-g" aria-label="${escapeHtml(name)}"><div class="wa-gh"><b>${escapeHtml(name)}</b>${ts.length > 1 ? `<span class="n">${ts.length}</span>` : ''}</div>${ts.map(t => waRowHtml(t, sel, who)).join('')}</section>`;
  let list;
  if(waTab === 'open' && open.length) list = `<p class="wa-sort">By client, longest wait first</p>${byClient(open).map(groupHtml).join('')}`;
  else if(waTab === 'done' && done.length) list = `<p class="wa-sort">By client, most recent first</p>${byClient(done).map(groupHtml).join('')}`;
  else list = waEmptyHtml(who, open, done);

  const side = lead ? waSideHtml(who, conn) : '';
  const prev = root.querySelector('.sp-page')?.scrollTop || 0;
  root.innerHTML = `<div class="spw"><div class="sp-page"><div class="wa${lead ? '' : ' wa-solo'}">
<div class="rmi-hd"><div><h2>${escapeHtml(h2)}</h2><p>${subBits.join(' · ').replace(/^[a-z]/, x => x.toUpperCase())}</p></div><div class="rmi-f">${filters}</div></div>
<div class="wa-body"><div class="wa-main">${list}</div>${side}</div>
</div></div>${sel ? waPanelHtml(sel) : reading ? waReadPanelHtml() : ''}</div>`;
  const sp = root.querySelector('.sp-page'); if(sp) sp.scrollTop = prev;
}
function waRowHtml(t, sel, who){
  const closed = t.status !== 'open', can = waCanEdit(t), lead = waCanManage();
  const cb = !closed
    ? (can ? `<button class="cb rem" role="checkbox" aria-checked="false" aria-label="Mark done" title="Mark done" onclick="event.stopPropagation();checkOff(this, () => waMarkDone('${t.id}'))"></button>` : '<span class="cb rem is-off"></span>')
    : `<span class="cb rem${t.status === 'dismissed' ? ' closed' : ' done'}" role="img" aria-label="${t.status === 'dismissed' ? 'Not a task' : 'Done'}">${icon(t.status === 'dismissed' ? 'x' : 'check', { weight: 'bold' })}</span>`;
  const kind = [t.priority === 'high' && !closed ? '<em class="wa-hi">High priority</em>' : '', `<em class="wa-k k-${t.kind}">${escapeHtml(WA_KIND[t.kind] || 'Request')}</em>`].filter(Boolean).join('<i class="wa-dot">·</i>');
  const quote = t.source_excerpt ? `<span class="wa-x">“${escapeHtml(t.source_excerpt)}”</span>` : '';
  let right;
  if(closed){
    const word = t.status === 'dismissed' ? 'Not a task' : t.status === 'answered' ? 'Answered in the group' : 'Done';
    const when = t.answered_at || t.updated_at;
    right = `<span class="rmi-when">${word}</span><span class="rmi-d">${when ? escapeHtml(new Date(when).toLocaleDateString('en-US', { weekday: 'short' })) : ''}</span>`;
  } else {
    const showWho = lead && who !== 'mine';
    const due = t.due_date ? `Due ${t.due_date === toDateStr(rNow()) ? 'today' : fmtShortDate(new Date(t.due_date + 'T12:00:00'))}` : '';
    right = `<span class="rmi-when${waLate(t) ? ' is-late' : waDays(t) === 0 ? ' is-new' : ''}">${escapeHtml(waWaitWord(t))}</span><span class="rmi-d">${escapeHtml(showWho ? waOwnerName(t) : due)}</span>`;
  }
  return `<div class="rmi-r wa-r${closed ? ' is-done' : ''}${sel && sel.id === t.id ? ' is-sel' : ''}" role="button" tabindex="0" onclick="selectWa('${t.id}')" onkeydown="if(event.key==='Enter'&&event.target===this)selectWa('${t.id}')">${cb}
<div class="tx"><b>${escapeHtml(t.title)}</b><span class="s">${kind}${quote}</span></div><div class="rmi-w">${right}</div></div>`;
}
function waEmptyHtml(who, open, done){
  if(waTab === 'done') return emptyState({ icon: 'check-circle', title: 'Nothing done this week yet',
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
function waSideHtml(who, conn){
  const open = waTasks.filter(t => t.status === 'open');
  const people = WA_OWNERS.map(([k, n]) => {
    const mine = open.filter(t => t.owner_key === k), late = mine.filter(waLate).length;
    return `<button class="wa-pp${who === k ? ' on' : ''}" onclick="setWa('who','${who === k ? 'all' : k}')" aria-pressed="${who === k}"><span>${n}</span><b>${mine.length || '–'}</b><em>${late ? `${late} waiting long` : ''}</em></button>`;
  }).join('');
  const reading = waGroups.filter(g => g.active).length;
  let st, txt, act = '';
  if(conn.key === 'connected'){
    st = `<span class="dot green"></span><b>Connected</b><span>reading ${reading} group${reading === 1 ? '' : 's'}</span>`;
    txt = `${waRunText(waLastRun()).replace(/^Today at /, 'Last at ')} ${waNextText()}`;
    act = `<div class="wa-chk-a">${waCheckBtn()}<button class="lnk-b" onclick="waShowRead()">What it read</button></div>`;
  } else if(conn.key === 'qr' || conn.key === 'reconnecting'){
    st = `<span class="dot ${conn.dot}"></span><b>${escapeHtml(conn.text)}</b>`;
    txt = conn.long;
    act = `<button class="btn" onclick="openSettingsTab('whatsapp')">Show the Code</button>`;
  } else {
    st = `<span class="dot ${conn.dot}"></span><b>${escapeHtml(conn.text)}</b>`;
    txt = conn.long;
    if(conn.key === 'signedout') act = `<button class="btn" onclick="openSettingsTab('whatsapp')">Re-link…</button>`;
  }
  const testers = waTesters(), onlyMe = testers.length === 1 && testers[0] === currentUser.id;
  const lock = testers.length
    ? `<p class="wa-lock">${icon('lock-simple')}<span>Test mode: ${onlyMe ? 'only you see this and get' : `only the ${testers.length} testers see this and get`} its Slack messages. <a href="#" onclick="openSettingsTab('whatsapp');return false;">WhatsApp settings</a></span></p>`
    : `<p class="wa-lock">${icon('settings')}<span><a href="#" onclick="openSettingsTab('whatsapp');return false;">WhatsApp settings</a></span></p>`;
  return `<aside class="wa-side">
${open.length ? `<div class="rmi-sec"><b>Who has what</b></div><div class="wa-ppl">${people}</div>` : ''}
${waQuietHtml()}
<div class="rmi-sec"><b>Checks</b></div>
<div class="wa-chk"><div class="wa-st">${st}</div><p>${escapeHtml(txt)}</p>${act}</div>
${lock}</aside>`;
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
function waQuietHtml(){
  if(!Array.isArray(waContact)) return '';
  const q = waQuietClients();
  if(!q.length) return '';
  const shown = waQuietAll ? q : q.slice(0, WA_QUIET_SHOWN);
  const row = x => `<button class="wa-qc" onclick="openClientInspectorFor('${escapeHtml(String(x.c.id))}')" title="Open ${escapeHtml(x.c.name)}"><b>${escapeHtml(x.c.name)}</b><span>${escapeHtml([x.owner ? firstName(x.owner) : '', x.days === null ? 'nothing yet' : `${x.days} days`].filter(Boolean).join(' · '))}</span></button>`;
  const more = q.length > WA_QUIET_SHOWN
    ? `<button class="lnk-b wa-qc-more" data-grow="wa-quiet" data-turn="180" aria-expanded="${waQuietAll}" onclick="waQuietAll=!waQuietAll;renderWhatsapp()">${waQuietAll ? 'Show less' : `Show all ${q.length}`}${icon('caret-down', { weight: 'bold' })}</button>` : '';
  return `<div class="rmi-sec"><b>Quiet clients</b><span class="n">${q.length}</span></div>
<div class="wa-quiet" data-grow-key="wa-quiet">${shown.map(row).join('')}</div>${more}
<p class="wa-qc-note">No message or update from us in ${WA_QUIET_DAYS} days or more.</p>`;
}
// Before WhatsApp is linked: three steps, each with its one thing to do.
function waSetupHtml(){
  const conn = waConnState(), missing = waReady === false || !waSettings;
  const running = !missing && waRunning(), linked = conn.key === 'connected';
  const steps = [];
  if(missing) steps.push({ t: 'Add WhatsApp to the database', d: 'An admin runs schema-whatsapp-tasks.sql in Supabase → SQL Editor. It’s safe to run more than once.', done: false, act: '' });
  steps.push({ t: 'Start Radar WhatsApp on the office PC', d: running ? 'Done. The PC checked in a few seconds ago.' : waSettings && waSettings.heartbeat_at ? `It stopped ${waAt(waSettings.heartbeat_at)}. Open the radar-whatsapp folder and double-click “2 - Start”.` : 'Open the radar-whatsapp folder on the PC and double-click “2 - Start”. Leave it running.', done: running, act: '' });
  steps.push({ t: 'Link WhatsApp', d: 'Scan a code with the phone that’s in the client groups. It only reads; it never sends.', done: linked,
    act: running && !linked ? `<button class="btn" onclick="openSettingsTab('whatsapp')">Show the Code</button>` : '' });
  steps.push({ t: 'Choose the groups it reads', d: 'Groups with “Marketing” in the name start on. You can turn any group on or off.', done: linked && waGroups.some(g => g.active),
    act: linked ? `<button class="btn" onclick="openSettingsTab('whatsapp')">Choose Groups</button>` : '' });
  const next = steps.findIndex(s => !s.done), n = steps.filter(s => s.done).length;
  const rows = steps.map((s, i) => `<div class="wa-step${s.done ? ' is-done' : ''}${i === next ? ' is-next' : ''}">
<span class="wa-sn">${s.done ? icon('check', { weight: 'bold' }) : i + 1}</span>
<span class="tx"><b>${escapeHtml(s.t)}</b><span class="s">${escapeHtml(s.d)}</span></span>${i === next ? s.act : ''}</div>`).join('');
  return `<div class="rmi-hd"><div><h2>Link WhatsApp to start</h2><p>Radar reads your client groups at the times you choose and lists what clients are waiting on, here and in Slack.</p></div></div>
<div class="wa-body"><div class="wa-main"><div class="rmi-sec"><b>${steps.length === 4 ? 'Four' : 'Three'} steps</b><span>${n} of ${steps.length} done</span></div><div class="wa-steps">${rows}</div></div>
<aside class="wa-side"><div class="rmi-sec"><b>Checks</b></div><div class="wa-chk"><div class="wa-st"><span class="dot ${linked ? 'green' : 'gray'}"></span><b>${linked ? 'Connected' : 'Not linked'}</b><span>${linked ? '' : 'nothing is read yet'}</span></div>
<p>Once WhatsApp is linked it checks at ${waTimes().map(waHm).join(' and ')}${waSettings ? ` (${escapeHtml(waCity(waTz()))} time)` : ''}, and sends ${waTesters().length ? 'you' : 'each person'} the list in Slack.</p></div>
<p class="wa-lock">${icon('lock-simple')}<span>Personal chats are never read, and it never sends anything to WhatsApp.</span></p></aside></div>`;
}

// ---- What it read: the messages the agent has to go on, group by group -----------------------
// So you can check it against WhatsApp: if a group shows messages but no items, the agent read
// them and found nothing owed; if it shows none, nothing reached the office PC.
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
  if(waRead === 'loading' || !waRead) return `<aside class="sp wap" aria-label="What it read">${head}${loadingStateHtml('Loading…')}</aside>`;
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
async function waLoadChat(id){
  if(waChat[id] && waChat[id] !== 'loading') return;
  waChat[id] = 'loading';
  let out = 'none';
  try{
    const { data, error } = await supabaseClient.rpc('wa_task_messages', { p_task: id });
    if(!error && Array.isArray(data)) out = data;
  }catch(e){}
  waChat[id] = out;
  if(window._waSel === id && currentViewName === 'whatsapp'){
    const box = document.getElementById('waChatBox');
    if(box) box.outerHTML = waChatHtml(waTasks.find(t => t.id === id));
  }
}
function waChatHtml(t){
  const m = waChat[t.id];
  if(Array.isArray(m) && m.length){
    const day = d => { const k = daysBetween(dayStart(new Date(d)), dayStart(rNow())); return k === 0 ? fmtTime(new Date(d)) : `${new Date(d).toLocaleDateString('en-US', { weekday: k < 7 ? 'short' : undefined, month: k < 7 ? undefined : 'short', day: k < 7 ? undefined : 'numeric' })} ${fmtTime(new Date(d))}`; };
    return `<div id="waChatBox"><div class="sp-sec"><b>In the group</b><span>${m.some(x => x.is_source) ? 'the request is outlined' : ''}</span></div>
<div class="wap-chat">${m.map(x => `<div class="wap-m${x.from_team ? ' us' : ''}${x.is_source ? ' hit' : ''}"><span class="who">${escapeHtml(x.sender || (x.from_team ? 'Based Agency' : 'Client'))}<time>${escapeHtml(day(x.sent_at))}</time></span><p>${escapeHtml(x.body || '')}</p></div>`).join('')}</div></div>`;
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
    if(t.priority === 'high') facts.push('<em class="wa-hi">High priority</em>');
    const d = waDays(t), word = d === 0 ? 'New today' : waDueToday(t) ? `Answer today · waiting ${waAgeWord(t)}` : `Waiting ${waAgeWord(t)}`;
    facts.push(`<b class="${waLate(t) ? 'is-red' : d === 0 ? 'is-new' : ''}">${escapeHtml(word)}</b>`);
    acts = can ? `${taskBtn}<button class="btn" onclick="waDismiss('${t.id}')">Not a Task</button><button class="btn btn-p" onclick="waMarkDone('${t.id}')">${icon('check')}Mark Done</button>` : '';
  } else {
    const word = t.status === 'dismissed' ? 'Not a task' : t.status === 'answered' && t.answered_at ? `Answered in the group ${claudeWhen(t.answered_at).toLowerCase()}`
      : `${t.status === 'answered' ? 'Answered in the group' : 'Done'}${t.updated_at ? ' ' + claudeWhen(t.updated_at).toLowerCase() : ''}`;
    facts.push(`<b class="${t.status === 'dismissed' ? '' : 'is-ok'}">${escapeHtml(word)}</b>`);
    acts = can ? `${t.task_id ? taskBtn : ''}<button class="btn" onclick="waReopen('${t.id}')">Reopen</button>` : '';
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
${waChatHtml(t)}
${meta}
${can && !closed ? `<p class="wa-learn">${icon('sparkle')}<span>Changing who has it, or Not a Task, teaches the agent for its next check.</span></p>` : ''}
</aside>`;
}

// ---- changes ---------------------------------------------------------------------------------
async function waUpdate(id, patch, okMsg, okSub){
  const t = waTasks.find(x => x.id === id), before = t ? { ...t } : null;
  if(t) Object.assign(t, patch, { updated_at: new Date().toISOString() });
  updateWaNavBadge(); renderWhatsapp();
  const { error } = await supabaseClient.from('wa_tasks').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  if(error){
    if(t && before) Object.assign(t, before);
    updateWaNavBadge(); renderWhatsapp();
    showToast('error', 'Not saved', error.message); return false;
  }
  if(okMsg) showToast('success', okMsg, okSub || '');
  return true;
}
function waMarkDone(id){ return waUpdate(id, { status: 'done' }, 'Marked done'); }
function waReopen(id){ return waUpdate(id, { status: 'open' }, 'Reopened'); }
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
let waGroupQuery = '', waPoll = null, waShowAllOff = false, waRoleEdit = null;

function waQrOk(){
  const s = waSettings;
  return !!(s && s.qr && s.qr_at && Date.now() - new Date(s.qr_at).getTime() < WA_STALE_MS && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s.qr));
}
function waWhoSeesRow(){
  const testers = waTesters(), onlyMe = testers.length === 1 && testers[0] === currentUser?.id;
  return testers.length
    ? `<div class="fr"><div class="l"><b>Who sees it</b><span>Test mode: ${onlyMe ? 'only you see' : `only the ${testers.length} testers see`} WhatsApp in Radar and get its Slack messages. Nobody else is told. To go live, run the last line of addendum-whatsapp-test-mode.sql.</span></div><span class="st">${icon('lock-simple')}${onlyMe ? 'Only you' : testers.length + ' testers'}</span></div>`
    : `<div class="fr"><div class="l"><b>Who sees it</b><span>Everyone sees the items that are theirs. Admins and approvers see them all and get the full list in Slack.</span></div><span class="st"><span class="dot green"></span>Live</span></div>`;
}
function waPcRow(){
  const s = waSettings, run = waRunning();
  const sub = run ? 'Radar WhatsApp is running · seen a few seconds ago'
    : s && s.heartbeat_at ? `Stopped · last seen ${waWhen(s.heartbeat_at)}. Open the radar-whatsapp folder on the PC and double-click “2 - Start”.`
    : 'Not started yet. Open the radar-whatsapp folder on the PC and double-click “2 - Start”.';
  return `<div class="fr"><span class="was-ic gray">${icon('desktop')}</span><div class="l"><b>Office PC</b><span>${escapeHtml(sub)}</span></div><span class="st"><span class="dot ${run ? 'green' : 'red'}"></span>${run ? 'Running' : 'Not running'}</span></div>`;
}
function waConnHtml(){
  const st = waConnState(), s = waSettings;
  if(st.key === 'missing') return `<div class="fr"><span class="was-ic gray">${icon('message-circle')}</span><div class="l"><b>${escapeHtml(st.text)}</b><span>${escapeHtml(st.long)}</span></div></div>`;
  if(st.key === 'qr' && waQrOk()) return `<div class="was-link"><img class="was-qr" src="${s.qr}" alt="Code to scan with WhatsApp" width="150" height="150">
<div class="was-lt"><b>Scan this with WhatsApp</b><ol><li>Open WhatsApp on the phone that’s in the client groups.</li><li>Go to Settings, then Linked devices, then Link a device.</li><li>Point the phone at this code.</li></ol>
<span class="st"><span class="dot gray"></span>Waiting for the scan · the code refreshes by itself</span></div></div>${waPcRow()}${waWhoSeesRow()}`;
  if(st.key === 'stopped') return `${waPcRow()}<div class="fr"><span class="was-ic">${icon('message-circle')}</span><div class="l"><b>WhatsApp</b><span>${s.heartbeat_at ? 'It reconnects by itself once the PC is running again.' : 'You’ll scan a code here once the PC is running.'}</span></div></div>${waWhoSeesRow()}`;
  if(st.key === 'connected'){
    return `<div class="fr"><span class="was-ic">${icon('message-circle')}</span><div class="l"><b>WhatsApp</b><span>Linked · the office PC checked in a few seconds ago</span></div><span class="st"><span class="dot green"></span>Connected</span><button class="btn" onclick="waRelink()">Re-link…</button></div>
<div class="fr"><div class="l"><b>Last check</b><span>${escapeHtml(waChecking() ? 'Checking the groups now. It usually takes a minute or two.' : `${waRunText(waLastRun())} ${waNextText()}`)}</span></div>${waCheckBtn()}</div>${waWhoSeesRow()}`;
  }
  return `<div class="fr"><span class="was-ic${st.key === 'signedout' ? ' red' : ''}">${icon('message-circle')}</span><div class="l"><b>${escapeHtml(st.text)}</b><span>${escapeHtml(st.long)}</span></div><button class="btn" onclick="waRelink()">Re-link…</button></div>${waPcRow()}${waWhoSeesRow()}`;
}
function setWhatsapp(){
  const sec = html => `<div class="wa-sec">${html}</div>`;
  if(waReady === false || !waSettings) return sec(`<div class="set-h">Connection</div><div class="form-grp" id="waConnBox">${waConnHtml()}</div>
${emptyState({ compact: true, icon: 'message-circle', tone: 'blue', title: 'Add WhatsApp to the database first', html: true,
    text: 'Run <code>schema-whatsapp-tasks.sql</code> in Supabase → SQL Editor, then start Radar WhatsApp on the office PC. This page then shows the code to scan.' })}`);
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
<div class="form-grp"><div class="fr"><div class="l"><b>Every day at</b><span>${waTesters().length ? `It reads the groups, then sends ${waTesters().length === 1 && waTesters()[0] === currentUser?.id ? 'you' : 'the testers'} the full list in Slack.` : 'It reads the groups, then sends each person their list in Slack.'}</span></div>
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
  const more = !q && off.length > WA_OFF_SHOWN
    ? `<div class="fr was-more"><button class="lnk-b" data-grow="wa-off" aria-expanded="${waShowAllOff}" data-turn="180" onclick="waToggleOff()">${waShowAllOff ? 'Show less' : `Show ${off.length - WA_OFF_SHOWN} more`}${icon('caret-down', { weight: 'bold' })}</button></div>` : '';
  const rows = (reading.length ? `<div class="was-sub">Reading<span>${reading.length}</span></div>${reading.map(waGroupRow).join('')}` : '')
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
  if(okMsg) showToast('success', okMsg, 'The office PC picks it up within a minute.');
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
  showToast('success', `${list.length} group${list.length === 1 ? '' : 's'} turned ${on ? 'on' : 'off'}`, 'The office PC picks it up within a minute.');
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
  const st = waConnState();
  return ['message-circle', 'WhatsApp', 'Reads client groups and lists what clients are waiting on', `<span class="st"><span class="dot ${st.dot}"></span>${escapeHtml(st.text)}</span>`, `<button class="btn" onclick="switchSettingsTab('whatsapp')">Settings…</button>`];
}
