// WhatsApp: open requests and questions the connector found in client WhatsApp groups.
// Everyone sees their own; admins and approvers see everyone's and set it up in Settings.
// In test mode (wa_settings.pilot_user_ids) only the testers see any of it, whatever their role;
// the database says which applies to whoever is signed in (wa_access()).
// The data is written by whatsapp-connector/ (read-only); this screen reads the items and lets
// people mark them done, reassign them, or say they weren't tasks (which teaches the agent).
// Same tables and columns as schema-whatsapp-tasks.sql.

let waTasks = [];
let waRuns = [];
let waGroups = [];
let waSettings = null;
let waLoaded = false;
let waReady = null;            // null: not loaded · false: the tables aren't there yet · true
let waWho = null;              // 'mine' | 'all' | an owner key (leads only); null = the default
let waTab = 'open';            // 'open' | 'closed'
let waRealtimeStarted = false;
let waAccessLevel = null;      // 'manage' | 'own' | 'none' from the database; null = it doesn't say (older setup)

const WA_OWNERS = [['albert', 'Albert'], ['stan', 'Stan'], ['eric', 'Eric'], ['charlie', 'Charlie'], ['dan', 'Dan'], ['joey', 'Joey']];
const WA_KIND = { request: 'Request', question: 'Question', promise: 'Promise', issue: 'Issue' };
const WA_KIND_IC = { request: 'list-checks', question: 'circle-help', promise: 'clock', issue: 'warning' };
const WA_STALE_MS = 120000;    // the connector writes a heartbeat about every 30 s

// Who sees what. Before the test-mode update the database doesn't say, so the role decides.
async function loadWaAccess(){
  let lvl = null;
  try{ const { data, error } = await supabaseClient.rpc('wa_access'); if(!error && ['manage', 'own', 'none'].includes(data)) lvl = data; }catch(e){}
  waAccessLevel = lvl;
}
function waCanManage(){ return waAccessLevel ? waAccessLevel === 'manage' : canApprove(); }
function waHidden(){ return waAccessLevel ? waAccessLevel === 'none' : (waReady === false && !canApprove()); }
function waTesters(){ return (waSettings && Array.isArray(waSettings.pilot_user_ids)) ? waSettings.pilot_user_ids : []; }
function updateWaNav(){
  const nav = document.querySelector('.nav-item[data-view="whatsapp"]');
  if(nav) nav.style.display = waHidden() ? 'none' : '';
  if(waHidden() && typeof currentViewName !== 'undefined' && currentViewName === 'whatsapp' && typeof switchView === 'function') switchView('overview');
}
function waMissing(error){ return /relation|schema cache|PGRST205|42P01|does not exist/i.test(`${error?.code || ''} ${error?.message || ''}`); }
async function loadWaTasks(){
  await loadWaAccess();
  if(waAccessLevel === 'none'){ waTasks = []; waLoaded = true; waReady = true; updateWaNav(); updateWaNavBadge(); return false; }
  const { data, error } = await supabaseClient.from('wa_tasks').select('*').order('first_seen', { ascending: true });
  if(error){
    if(!waMissing(error)) console.error('loadWaTasks error', error);
    waTasks = []; waLoaded = true; waReady = waMissing(error) ? false : waReady; updateWaNav(); updateWaNavBadge(); return false;
  }
  waTasks = data || []; waReady = true;
  updateWaNav();
  if(waCanManage()){
    const [r, s, g] = await Promise.all([
      supabaseClient.from('wa_runs').select('*').order('started_at', { ascending: false }).limit(20),
      supabaseClient.from('wa_settings').select('*').eq('id', 1).maybeSingle(),
      supabaseClient.from('wa_groups').select('jid,name,active,auto_match,manual').order('name', { ascending: true }),
    ]);
    waRuns = r.data || []; waSettings = s.data || null; waGroups = g.data || [];
  }
  waLoaded = true;
  updateWaNavBadge();
  return true;
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
  const n = waHidden() ? 0 : waOpenForMe().length;   // your own, like Tasks; leads see the rest on the screen
  b.textContent = n; b.style.display = n ? 'flex' : 'none';
}
function waAge(iso, to){
  const d = Math.max(0, daysBetween(dayStart(new Date(iso)), to ? dayStart(new Date(to)) : dayStart(rNow())));
  return d === 0 ? 'Today' : d === 1 ? '1 day' : `${d} days`;
}
function waGroupName(t){ const g = waGroups.find(x => x.jid === t.group_jid); return g ? g.name : ''; }
function waAt(iso){   // "11:00 AM", "yesterday, 5:00 PM", "Nov 14, 9:00 AM"
  const d = new Date(iso), k = daysBetween(dayStart(d), dayStart(rNow()));
  return k === 0 ? fmtTime(d) : k === 1 ? `yesterday, ${fmtTime(d)}` : `${fmtShortDate(d)}, ${fmtTime(d)}`;
}
function waWhen(iso){ const d = new Date(iso); return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}, ${fmtTime(d)}`; }

// Where the connection stands, for leads: a dot and a short line.
function waConnState(){
  const s = waSettings;
  if(waReady === false || !s) return { dot: 'hollow', text: 'Not set up yet', long: 'Run schema-whatsapp-tasks.sql in Supabase → SQL Editor, then start the connector on the office PC.' };
  const beat = s.heartbeat_at ? Date.now() - new Date(s.heartbeat_at).getTime() : Infinity;
  if(beat > WA_STALE_MS) return s.heartbeat_at
    ? { dot: 'red', text: 'Connector isn’t running', long: `Last seen ${waWhen(s.heartbeat_at)}. Start it on the office PC with npm start.` }
    : { dot: 'red', text: 'Connector hasn’t started', long: 'Follow the steps in whatsapp-connector/README.md on the office PC.' };
  if(s.qr && s.qr_at && Date.now() - new Date(s.qr_at).getTime() < WA_STALE_MS) return { dot: 'yellow', text: 'Waiting for the code to be scanned', long: 'Scan the code below with the phone to link it.' };
  const conn = waRuns.find(r => r.kind === 'status' || r.kind === 'error');
  if(conn && conn.connection === 'logged_out') return { dot: 'red', text: 'WhatsApp signed out', long: 'Re-link the number to get a new code.' };
  if(conn && conn.connection === 'open'){
    const last = waRuns.find(r => r.kind === 'digest');
    return { dot: 'green', text: last ? `Connected · last checked ${waAt(last.started_at)}` : 'Connected', long: 'Reading the groups switched on below.' };
  }
  return { dot: 'yellow', text: 'Reconnecting…', long: 'The connector is running but WhatsApp isn’t linked yet, or it’s reconnecting.' };
}

// ---- the screen ------------------------------------------------------------------------------
function setWa(k, v){ if(k === 'tab') waTab = v; if(k === 'who') waWho = v; window._waSel = null; renderWhatsapp(); }
function selectWa(id){ window._waSel = window._waSel === id ? null : id; renderWhatsapp(); }
function closeWaPanel(){ window._waSel = null; renderWhatsapp(); }
function renderWhatsappTasks(){ renderWhatsapp(); }   // the old name, still called by realtime
function renderWhatsapp(){
  const root = document.getElementById('whatsappRoot');
  if(!root || !currentUser) return;
  if(waHidden()){ root.innerHTML = ''; return; }
  const lead = waCanManage();
  const who = lead ? (waWho || 'all') : 'mine';
  const closedSt = ['done', 'answered', 'dismissed'];
  const mineOrAll = waTasks.filter(t => who === 'all' ? true : who === 'mine' ? t.owner_user_id === currentUser.id : t.owner_key === who);
  const open = mineOrAll.filter(t => t.status === 'open'), closed = mineOrAll.filter(t => closedSt.includes(t.status));
  const rows = waTab === 'open' ? open.slice().sort((a, b) => new Date(a.first_seen) - new Date(b.first_seen)) : closed.slice().sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
  const sel = window._waSel && waTasks.find(t => t.id === window._waSel);
  if(window._waSel && !sel) window._waSel = null;

  // grouped by client; the client waiting longest comes first
  const byClient = new Map();
  rows.forEach(t => { const k = t.client || 'Unknown client'; if(!byClient.has(k)) byClient.set(k, []); byClient.get(k).push(t); });
  const groups = [...byClient.entries()];
  if(waTab === 'open') groups.sort((a, b) => new Date(a[1][0].first_seen) - new Date(b[1][0].first_seen));
  const today = toDateStr(rNow());
  const rowHtml = t => {
    const done = t.status !== 'open', can = waCanEdit(t);
    const cb = !done
      ? (can ? `<button class="cb rem" role="checkbox" aria-checked="false" aria-label="Mark done" title="Mark done" onclick="event.stopPropagation();checkOff(this, () => waMarkDone('${t.id}'))"></button>` : '<span class="cb rem is-off"></span>')
      : `<span class="cb rem${t.status === 'dismissed' ? ' closed' : ' done'}" role="img" aria-label="${t.status === 'dismissed' ? 'Not a task' : 'Done'}">${icon(t.status === 'dismissed' ? 'x' : 'check', { weight: 'bold' })}</span>`;
    const age = waAge(t.first_seen), late = !done && daysBetween(dayStart(new Date(t.first_seen)), dayStart(rNow())) >= 2;
    const sub = [WA_KIND[t.kind] || 'Request', t.source_excerpt ? `“${t.source_excerpt}”` : ''].filter(Boolean).join(' · ');
    const right = done
      ? `<span class="rmi-when">${t.status === 'dismissed' ? 'Not a task' : t.status === 'answered' ? 'Answered in the group' : 'Done'}</span><span class="rmi-d">${t.updated_at ? fmtShortDate(new Date(t.updated_at)) : ''}</span>`
      : `<span class="rmi-when${late ? ' is-late' : ''}">${age === 'Today' ? 'New today' : 'Waiting ' + age}</span><span class="rmi-d">${lead && who !== 'mine' ? escapeHtml(waOwnerName(t)) : t.due_date ? 'Due ' + escapeHtml(t.due_date === today ? 'today' : fmtShortDate(new Date(t.due_date + 'T12:00:00'))) : ''}</span>`;
    return `<div class="rmi-r wa-r${done ? ' is-done' : ''}${sel && sel.id === t.id ? ' is-sel' : ''}" role="button" tabindex="0" onclick="selectWa('${t.id}')" onkeydown="if(event.key==='Enter'&&event.target===this)selectWa('${t.id}')">${cb}
<div class="tx"><b>${t.priority === 'high' && !done ? `<span class="tk-flag" title="High priority">${icon('flag', { fill: true })}</span>` : ''}${escapeHtml(t.title)}</b><span class="s">${escapeHtml(sub)}</span></div><div class="rmi-w">${right}</div></div>`;
  };
  const list = groups.map(([client, items]) => `<div class="rmi-sec"><b>${escapeHtml(client)}</b><span>${items.length}</span></div>${items.map(rowHtml).join('')}`).join('');
  const empty = waReady === false
    ? `<div class="empty rmi-empty"><b>WhatsApp isn’t set up yet</b>${lead ? `An admin runs <code>schema-whatsapp-tasks.sql</code> in Supabase → SQL Editor, then starts the connector on the office PC. <a class="x-lnk" href="#" onclick="openSettingsTab('whatsapp');return false;">Open Settings</a>` : 'Once it is, requests from client groups that are yours show up here.'}</div>`
    : waTab === 'open'
      ? `<div class="empty rmi-empty"><b>${who === 'mine' ? 'Nothing from client chats is waiting on you' : 'Nothing open from client chats'}</b>New requests and questions from the client WhatsApp groups show up here after each check.</div>`
      : `<div class="empty rmi-empty"><b>Nothing closed yet</b></div>`;

  const h2 = waTab === 'closed' ? 'Closed'
    : !open.length ? (who === 'mine' ? 'Nothing waiting on you' : 'Nothing open from client chats')
    : who === 'mine' ? `${open.length} waiting on you`
    : `${open.length} open from client chats`;
  const conn = lead ? waConnState() : null;
  const testers = waTesters();
  const sub = lead
    ? `<span class="wa-st"><span class="dot ${conn.dot}"></span>${escapeHtml(conn.text)}</span>${testers.length ? `<span class="wa-tm" title="Only ${testers.length === 1 && testers[0] === currentUser.id ? 'you see' : 'the testers see'} WhatsApp in Radar and get its Slack messages">Test mode · ${testers.length === 1 && testers[0] === currentUser.id ? 'only you' : testers.length + ' testers'}</span>` : ''}`
    : 'Requests and questions from client WhatsApp groups that are yours.';
  const whoOpts = [['all', 'Everyone'], ['mine', 'Mine'], ...WA_OWNERS];
  const curWho = whoOpts.find(o => o[0] === who) || whoOpts[0];
  const filters = `<div class="seg" role="tablist" aria-label="Show">${[['open', 'Open', open.length], ['closed', 'Closed', closed.length]].map(([k, t, c]) => `<button class="${waTab === k ? 'on' : ''}" role="tab" aria-selected="${waTab === k}" onclick="setWa('tab','${k}')">${t}${c ? ` <span class="c">${c}</span>` : ''}</button>`).join('')}</div>
${lead ? `<label class="pop pop-sel"><span class="pl">${escapeHtml(curWho[1])}</span>${icon('caret-down')}<select aria-label="Whose items" onchange="setWa('who',this.value)">${whoOpts.map(([v, n]) => `<option value="${v}"${v === who ? ' selected' : ''}>${escapeHtml(n)}</option>`).join('')}</select></label>
<button class="ib" aria-label="WhatsApp settings" title="WhatsApp settings" onclick="openSettingsTab('whatsapp')">${icon('gear-six')}</button>` : ''}`;
  const prev = root.querySelector('.sp-page')?.scrollTop || 0;
  root.innerHTML = `<div class="spw"><div class="sp-page"><div class="rmi wa">
<div class="rmi-hd"><div><h2>${escapeHtml(h2)}</h2><p>${sub}</p></div><div class="rmi-f">${filters}</div></div>
${list || empty}</div></div>${sel ? waPanelHtml(sel) : ''}</div>`;
  const sp = root.querySelector('.sp-page'); if(sp) sp.scrollTop = prev;
  if(currentViewName === 'whatsapp') setToolbar(null, 'Client chats');
}

// ---- one item, in the panel --------------------------------------------------------------------
function waPanelHtml(t){
  const done = t.status !== 'open', can = waCanEdit(t), lead = waCanManage();
  const kind = WA_KIND[t.kind] || 'Request';
  let eyebrow, title, sub, acts;
  if(!done){
    eyebrow = `<span class="sp-eb">${icon(WA_KIND_IC[t.kind] || 'list-checks', { weight: 'bold' })}${escapeHtml(kind)} from ${escapeHtml(t.client)}</span>`;
    const age = waAge(t.first_seen);
    title = age === 'Today' ? 'New today' : `Waiting ${age}`;
    const g = waGroupName(t);
    sub = `First seen ${waWhen(t.first_seen)}${g ? ` in ${g}` : ''}.`;
    acts = can ? `<button class="btn" onclick="waDismiss('${t.id}')">Not a Task</button><button class="btn btn-p" onclick="waMarkDone('${t.id}')">${icon('check')}Mark Done</button>` : '';
  } else {
    const word = t.status === 'dismissed' ? 'Not a task' : t.status === 'answered' ? 'Answered in the group' : 'Done';
    eyebrow = `<span class="sp-eb${t.status === 'dismissed' ? '' : ' ok'}">${icon(t.status === 'dismissed' ? 'x' : 'check', { weight: 'bold' })}${word}</span>`;
    title = t.status === 'answered' && t.answered_at ? `Answered ${claudeWhen(t.answered_at).toLowerCase()}` : `Closed ${t.updated_at ? claudeWhen(t.updated_at).toLowerCase() : ''}`.trim();
    sub = `${kind} from ${t.client}, first seen ${waWhen(t.first_seen)}.`;
    acts = can ? `<button class="btn" onclick="waReopen('${t.id}')">Reopen</button>` : '';
  }
  const owner = can && !done
    ? `<label class="pop pop-sel"><span class="pl">${escapeHtml(waOwnerName(t))}</span>${icon('caret-down')}<select aria-label="Assigned to" onchange="waReassign('${t.id}', this.value)">${t.owner_key ? '' : '<option value="" selected>Unassigned</option>'}${WA_OWNERS.map(([k, n]) => `<option value="${k}"${t.owner_key === k ? ' selected' : ''}>${n}</option>`).join('')}</select></label>`
    : escapeHtml(waOwnerName(t));
  const prio = can && !done
    ? `<label class="pop pop-sel"><span class="pl">${t.priority === 'high' ? 'High' : t.priority === 'low' ? 'Low' : 'Normal'}</span>${icon('caret-down')}<select aria-label="Priority" onchange="waSetPriority('${t.id}', this.value)">${[['high', 'High'], ['normal', 'Normal'], ['low', 'Low']].map(([v, n]) => `<option value="${v}"${(t.priority || 'normal') === v ? ' selected' : ''}>${n}</option>`).join('')}</select></label>`
    : (t.priority === 'high' ? 'High' : t.priority === 'low' ? 'Low' : 'Normal');
  const g = waGroupName(t);
  const meta = `<div class="tkp-meta">
<span class="tkp-k">Client</span><span class="tkp-v">${escapeHtml(t.client)}</span>
<span class="tkp-k">Assigned to</span><span class="tkp-v">${owner}${lead && t.ai_owner_key && t.owner_key && t.ai_owner_key !== t.owner_key ? `<em>the agent picked ${escapeHtml((WA_OWNERS.find(o => o[0] === t.ai_owner_key) || [, t.ai_owner_key])[1])}</em>` : ''}</span>
<span class="tkp-k">Priority</span><span class="tkp-v">${prio}</span>
${t.due_date ? `<span class="tkp-k">Due</span><span class="tkp-v${!done && t.due_date < toDateStr(rNow()) ? ' tkp-late' : ''}">${escapeHtml(fmtShortDate(new Date(t.due_date + 'T12:00:00')))}</span>` : ''}
${g ? `<span class="tkp-k">Group</span><span class="tkp-v wa-g">${escapeHtml(g)}</span>` : ''}
</div>`;
  return `<aside class="sp wap" aria-label="${escapeHtml(t.title)}">
<div class="sp-bar"><button class="ib" aria-label="Close" title="Close (Esc)" onclick="closeWaPanel()">${icon('x')}</button></div>
<div class="tkp-h"><h3>${t.priority === 'high' && !done ? `<span class="tk-flag" title="High priority">${icon('flag', { fill: true })}</span>` : ''}${escapeHtml(t.title)}</h3></div>
<div class="sp-status">${eyebrow}<b>${escapeHtml(title)}</b><span class="sub">${escapeHtml(sub)}</span>${acts ? `<div class="sp-acts">${acts}</div>` : ''}</div>
${t.source_excerpt ? `<div class="sp-sec"><b>What the client said</b></div><blockquote class="wa-q">${escapeHtml(t.source_excerpt)}</blockquote>` : ''}
${t.detail ? `<div class="sp-sec"><b>Details</b></div><p class="tkp-notes">${escapeHtml(t.detail)}</p>` : ''}
${meta}
${can && !done ? `<p class="wa-learn">${icon('sparkle')}<span>Reassigning it or marking it Not a Task teaches the agent for the next check.</span></p>` : ''}
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

async function openWhatsappView(){
  await loadWaTasks();
  renderWhatsapp();
  if(!waRealtimeStarted && typeof supabaseClient.channel === 'function' && waReady){
    waRealtimeStarted = true;
    supabaseClient.channel('wa-tasks').on('postgres_changes', { event: '*', schema: 'public', table: 'wa_tasks' }, async () => {
      await loadWaTasks();
      if(currentViewName === 'whatsapp') renderWhatsapp();
    }).subscribe();
  }
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
let waGroupQuery = '', waPoll = null;

function waQrHtml(){
  const s = waSettings;
  const fresh = s && s.qr && s.qr_at && Date.now() - new Date(s.qr_at).getTime() < WA_STALE_MS;
  if(!fresh || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s.qr)) return '';
  return `<div class="fr wa-qr"><img src="${s.qr}" alt="WhatsApp link code" width="168" height="168"><ol><li>Open WhatsApp on the phone</li><li>Settings, then Linked Devices</li><li>Link a Device, and scan this code</li></ol></div>`;
}
function waConnHtml(){
  const st = waConnState();
  return `<div class="fr"><span class="ic lg">${icon('message-circle')}</span><div class="l"><b class="wa-st"><span class="dot ${st.dot}"></span>${escapeHtml(st.text)}</b><span>${escapeHtml(st.long)}</span></div>${waSettings ? `<button class="btn" onclick="waRelink()">Re-link…</button>` : ''}</div>${waQrHtml()}`;
}
function setWhatsapp(){
  if(waReady === false || !waSettings) return `<div class="set-h">Connection</div><div class="form-grp" id="waConnBox">${waConnHtml()}</div>
<p class="t-2" style="font-size:13px;margin:10px 4px 0">The WhatsApp tables aren’t in the database yet. Run <code>schema-whatsapp-tasks.sql</code> in Supabase → SQL Editor, then follow <code>whatsapp-connector/README.md</code> on the office PC.</p>`;
  const s = waSettings, times = (s.digest_times && s.digest_times.length ? s.digest_times : ['09:00', '15:00']);
  const on = waGroups.filter(g => g.active).length;
  const q = waGroupQuery.trim().toLowerCase();
  const list = waGroups.slice().sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name)).filter(g => !q || g.name.toLowerCase().includes(q));
  const groups = waGroups.length
    ? `${waGroups.length > 6 ? `<div class="fr"><input class="tf wa-gq" type="search" placeholder="Find a group" aria-label="Find a group" value="${escapeHtml(waGroupQuery)}" oninput="waFindGroup(this.value)"></div>` : ''}<div id="waGroupRows">${waGroupRowsHtml(list)}</div>`
    : `<div class="fr"><div class="l"><b style="font-weight:400">No groups yet</b><span>They show up once the number is linked.</span></div></div>`;
  const tzs = WA_TIMEZONES.includes(s.timezone) ? WA_TIMEZONES : [s.timezone, ...WA_TIMEZONES];
  const timeChips = times.map((t, i) => `<span class="wa-tc"><input class="tf" type="time" value="${escapeHtml(t)}" aria-label="Check time ${i + 1}" onchange="waSetTime(${i}, this.value)">${times.length > 1 ? `<button class="ib" aria-label="Remove this time" title="Remove" onclick="waRemoveTime(${i})">${icon('x')}</button>` : ''}</span>`).join('');
  const roles = WA_OWNERS.map(([k, n]) => fr(n, '', `<textarea class="tf wa-role" rows="2" placeholder="${escapeHtml(WA_ROLE_DEFAULTS[k])}" aria-label="What ${n} handles" onchange="waSaveRole('${k}', this.value)">${escapeHtml((s.role_notes || {})[k] || '')}</textarea>`, { top: true })).join('');
  const sec = html => `<div class="wa-sec">${html}</div>`;
  const testers = waTesters(), onlyMe = testers.length === 1 && testers[0] === currentUser?.id;
  const testNote = testers.length ? `<p class="t-2 wa-p wa-tmn">${icon('lock-simple')}<span><b>Test mode.</b> ${onlyMe ? 'Only you see' : `Only the ${testers.length} testers see`} WhatsApp in Radar and get its Slack messages; nobody else is told. To go live, run the last line of <code>addendum-whatsapp-test-mode.sql</code>.</span></p>` : '';
  return sec(`<div class="set-h">Connection</div><div class="form-grp" id="waConnBox">${waConnHtml()}</div>${testNote}`)
    + sec(`<div class="set-h">Groups it reads<span class="wa-n">${on} of ${waGroups.length} on</span></div>
<p class="t-2 wa-p">Groups with “Marketing” in the name are on to start with. Personal chats are never read.</p>
<div class="form-grp">${groups}</div>`)
    + sec(`<div class="set-h">When it checks</div>
<p class="t-2 wa-p">${testers.length ? `At these times it reads the groups, then sends ${onlyMe ? 'you' : 'the testers'} the full list in Slack.` : 'At these times it reads the groups, then sends each person their list in Slack.'}</p>
<div class="form-grp">${fr('Every day at', '', `<div class="wa-times">${timeChips}${times.length < 6 ? `<button class="btn" onclick="waAddTime()">${icon('plus')}Add</button>` : ''}</div>`)}
${fr('Time zone', '', popSel('Time zone', tzs.map(z => [z, z.replace(/_/g, ' ')]), s.timezone, 'waSetZone(this.value)'))}</div>`)
    + sec(`<div class="set-h">Who handles what</div>
<p class="t-2 wa-p">The agent assigns each item from these. Leave one empty to use the default shown.</p>
<div class="form-grp">${roles}</div>`);
}
function waGroupRowsHtml(list){
  return list.map(g => fr(escapeHtml(g.name), g.manual ? 'Set by you' : g.auto_match ? 'Matches the client rule' : 'Not a client group', swHtml(g.active, g.name, `waToggleGroup('${escapeHtml(g.jid)}', ${!g.active})`), { plain: true })).join('')
    || `<div class="fr"><div class="l"><span>No group matches “${escapeHtml(waGroupQuery)}”.</span></div></div>`;
}
function waFindGroup(v){
  waGroupQuery = v || '';
  const q = waGroupQuery.trim().toLowerCase(), box = document.getElementById('waGroupRows');
  if(box) box.innerHTML = waGroupRowsHtml(waGroups.slice().sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name)).filter(g => !q || g.name.toLowerCase().includes(q)));
}
function waSettingsOpen(){ return typeof currentViewName !== 'undefined' && currentViewName === 'settings' && typeof settingsTab !== 'undefined' && settingsTab === 'whatsapp'; }
// While the pane is open: refresh the connection (and its code) every few seconds, without
// redrawing what you might be typing in.
async function waStartPoll(){
  await loadWaTasks();
  if(waSettingsOpen()) renderSettingsView();
  if(waPoll) return;
  waPoll = setInterval(async () => {
    if(!waSettingsOpen() || document.hidden){ if(!waSettingsOpen()){ clearInterval(waPoll); waPoll = null; } return; }
    const had = waGroups.length;
    await loadWaTasks();
    const box = document.getElementById('waConnBox');
    if(box) box.innerHTML = waConnHtml();
    if(!had && waGroups.length) renderSettingsView();   // the groups arrive once the number is linked
  }, 4000);
}
async function waSaveSettings(patch, okMsg){
  const { error } = await supabaseClient.from('wa_settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 1);
  if(error){ showToast('error', 'Not saved', error.message); return false; }
  Object.assign(waSettings, patch);
  if(okMsg) showToast('success', okMsg, 'The connector picks it up within a minute.');
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
function waTimes(){ return (waSettings.digest_times && waSettings.digest_times.length ? waSettings.digest_times : ['09:00', '15:00']).slice(); }
async function waSetTime(i, v){
  if(!/^([01]?\d|2[0-3]):[0-5]\d$/.test(v)){ showToast('error', 'Check the time'); renderSettingsView(); return; }
  const t = waTimes(); t[i] = v;
  await waSaveSettings({ digest_times: [...new Set(t)].sort() }, 'Schedule saved'); renderSettingsView();
}
async function waAddTime(){
  const t = waTimes(); if(t.length >= 6) return;
  const next = ['12:00', '17:00', '07:00', '19:00', '11:00', '13:00'].find(x => !t.includes(x)) || '12:00';
  await waSaveSettings({ digest_times: [...t, next].sort() }, 'Schedule saved'); renderSettingsView();
}
async function waRemoveTime(i){
  const t = waTimes(); if(t.length <= 1) return;
  t.splice(i, 1); await waSaveSettings({ digest_times: t }, 'Schedule saved'); renderSettingsView();
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
  return ['message-circle', 'WhatsApp', 'Reads client groups and sorts what they ask for', `<span class="st"><span class="dot ${st.dot}"></span>${escapeHtml(st.text)}</span>`, `<button class="btn" onclick="switchSettingsTab('whatsapp')">Settings…</button>`];
}
