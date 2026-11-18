// WhatsApp client items: open requests/questions the connector found in client
// WhatsApp groups. Everyone sees their own; admins/approvers see everyone's.
// Data is written by whatsapp-connector/ (read-only); this screen only reads
// tasks and lets people mark them done / reassign them.

let waTasks = [];
let waRuns = [];
let waLoaded = false;
let waFilterOwner = 'mine';   // 'mine' | 'all' | a role key
let waShowClosed = false;
let waRealtimeStarted = false;

const WA_OWNERS = [['albert','Albert'],['stan','Stan'],['eric','Eric'],['charlie','Charlie'],['dan','Dan'],['joey','Joey']];
const WA_KIND = { request:'Request', question:'Question', promise:'Promise', issue:'Issue' };

async function loadWaTasks(){
  const q = supabaseClient.from('wa_tasks').select('*').order('first_seen', { ascending:true });
  const { data, error } = await q;
  if(error){
    // Tables not created yet (migration not run) — stay quiet, show the empty state.
    if(!/relation|schema cache|PGRST205|42P01/i.test((error.code||'') + ' ' + (error.message||''))) console.error('loadWaTasks error', error);
    waTasks = []; waLoaded = true; updateWaNavBadge(); return false;
  }
  waTasks = data || [];
  if(canApprove()){
    const r = await supabaseClient.from('wa_runs').select('*').order('started_at', { ascending:false }).limit(20);
    waRuns = r.data || [];
  }
  waLoaded = true;
  updateWaNavBadge();
  return true;
}

function waOpenForMe(){ return waTasks.filter(t => t.status === 'open' && t.owner_user_id === currentUser?.id); }
function updateWaNavBadge(){
  const b = document.getElementById('navWhatsappBadge');
  if(!b) return;
  const n = canApprove() ? waTasks.filter(t => t.status === 'open').length : waOpenForMe().length;
  b.textContent = n; b.style.display = n ? 'flex' : 'none';
}

function waAgeLabel(iso){
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d <= 0 ? 'today' : d === 1 ? '1 day' : d + ' days';
}

function waStatusLine(){
  if(!canApprove()) return '';
  const last = waRuns.find(r => r.kind === 'digest');
  const conn = waRuns.find(r => r.kind === 'status' || r.kind === 'error');
  let dot = '#696F78', txt = 'No connector activity yet';
  if(conn){
    if(conn.connection === 'open'){ dot = '#117F3A'; txt = 'WhatsApp connected'; }
    else if(conn.connection === 'logged_out'){ dot = '#C0392B'; txt = 'WhatsApp logged out — re-scan the QR code on the office PC'; }
    else { dot = '#A65B05'; txt = 'WhatsApp reconnecting'; }
  }
  const lastTxt = last ? ` · last check ${new Date(last.started_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}` : '';
  return `<div class="wa-status"><span class="wa-dot" style="background:${dot}"></span>${escapeHtml(txt + lastTxt)}</div>`;
}

function renderWhatsappTasks(){
  const root = document.getElementById('whatsappBoard');
  if(!root) return;
  if(!waLoaded){ root.innerHTML = '<div class="empty">Loading…</div>'; return; }

  const lead = canApprove();
  if(!lead && waFilterOwner !== 'mine') waFilterOwner = 'mine';

  let rows = waTasks.filter(t => waShowClosed ? true : t.status === 'open');
  if(waFilterOwner === 'mine') rows = rows.filter(t => t.owner_user_id === currentUser?.id);
  else if(waFilterOwner !== 'all') rows = rows.filter(t => t.owner_key === waFilterOwner);

  const filterOpts = (lead
    ? [['mine','Mine'],['all','Everyone'], ...WA_OWNERS]
    : [['mine','Mine']]
  ).map(([v,l]) => `<option value="${v}" ${waFilterOwner===v?'selected':''}>${escapeHtml(l)}</option>`).join('');

  const bar = `<div class="clients-filter-bar" style="margin-bottom:8px;">
      ${lead ? `<select class="wa-sel" onchange="waSetFilter(this.value)" aria-label="Show items for">${filterOpts}</select>` : ''}
      <label class="wa-chk"><input type="checkbox" ${waShowClosed?'checked':''} onchange="waToggleClosed(this.checked)"> Show finished</label>
      <div style="flex:1;"></div>
      ${lead ? `<button class="btn" onclick="waToggleSetup()">${waSetup.open ? 'Close setup' : 'Setup'}</button>` : ''}
    </div>${waStatusLine()}`;

  if(!rows.length){
    root.innerHTML = bar + `<div class="cd-grp">${emptyStateHtml(
      '<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor"><path d="M173.66,98.34a8,8,0,0,1,0,11.32l-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35A8,8,0,0,1,173.66,98.34ZM232,128A104,104,0,1,1,128,24,104.11,104.11,0,0,1,232,128Zm-16,0a88,88,0,1,0-88,88A88.1,88.1,0,0,0,216,128Z"/></svg>',
      'Nothing open from client chats',
      lead ? 'New requests and questions from the WhatsApp client groups show up here after each morning and afternoon check.' : 'Nothing from client WhatsApp groups is waiting on you.')}</div>`;
    return;
  }

  // Group by client, oldest-waiting client first.
  const byClient = new Map();
  rows.forEach(t => { if(!byClient.has(t.client)) byClient.set(t.client, []); byClient.get(t.client).push(t); });
  const sections = [...byClient.entries()].sort((a,b) => new Date(a[1][0].first_seen) - new Date(b[1][0].first_seen)).map(([client, items]) => {
    const list = items.map(t => {
      const done = t.status !== 'open';
      const owner = (WA_OWNERS.find(o => o[0] === t.owner_key) || [,'Unassigned'])[1];
      const canEdit = lead || t.owner_user_id === currentUser?.id;
      return `<div class="rem-row ${done?'done':''}">
        <button class="rem-cb ${done?'done':''}" ${done||!canEdit?'disabled':''} onclick="waMarkDone('${escapeHtml(t.id)}')" title="Mark done" aria-label="Mark done">${done?'<svg viewBox="0 0 256 256" fill="currentColor"><path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z"/></svg>':''}</button>
        <div class="rem-tx">
          <div class="rem-t" title="${escapeHtml(t.title)}">${t.priority==='high'?'<span class="wa-high">High</span> ':''}${escapeHtml(t.title)}</div>
          <div class="rem-s">${escapeHtml(WA_KIND[t.kind]||'Request')} · waiting ${escapeHtml(waAgeLabel(t.first_seen))}${t.source_excerpt?' · “'+escapeHtml(t.source_excerpt)+'”':''}</div>
        </div>
        <div class="rem-r">
          ${canEdit && !done ? `<select class="wa-sel" onchange="waReassign('${escapeHtml(t.id)}', this.value)" aria-label="Assign to">${WA_OWNERS.map(o=>`<option value="${o[0]}" ${t.owner_key===o[0]?'selected':''}>${o[1]}</option>`).join('')}</select>` : `<span>${escapeHtml(owner)}</span>`}
          ${canEdit && !done ? `<button class="btn" style="padding:3px 9px;font-size:12px;" onclick="waDismiss('${escapeHtml(t.id)}')">Not a task</button>` : ''}
        </div>
      </div>`;
    }).join('');
    return `<div class="cd-h2"><h2>${escapeHtml(client)} <span class="t-c">${items.length}</span></h2></div><div class="cd-grp">${list}</div>`;
  }).join('');
  root.innerHTML = bar + sections;
}

function waSetFilter(v){ waFilterOwner = v; renderWhatsappTasks(); }
function waToggleClosed(v){ waShowClosed = !!v; renderWhatsappTasks(); }

async function waUpdate(id, patch, okMsg){
  const { error } = await supabaseClient.from('wa_tasks').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  if(error){ showToast('error', 'Could not update', error.message); return; }
  await loadWaTasks(); renderWhatsappTasks();
  if(okMsg) showToast('success', okMsg);
}
function waMarkDone(id){ waUpdate(id, { status:'done' }, 'Marked done'); }
function waDismiss(id){ waUpdate(id, { status:'dismissed' }, 'Removed — the agent will learn this wasn’t a task'); }
async function waReassign(id, key){
  // Resolve the person so they see it under "Mine".
  const person = (teamProfiles || []).find(p => {
    const first = String(p.name||'').trim().split(/\s+/)[0].toLowerCase();
    return first === key || (key === 'dan' && first === 'daniel');
  });
  await waUpdate(id, { owner_key: key, owner_user_id: person ? person.id : null }, 'Reassigned');
}

async function openWhatsappView(){
  await loadWaTasks();
  renderWhatsappTasks();
  renderWaSetup();
  if(!waRealtimeStarted && typeof supabaseClient.channel === 'function'){
    waRealtimeStarted = true;
    supabaseClient.channel('wa-tasks').on('postgres_changes', { event:'*', schema:'public', table:'wa_tasks' }, async () => {
      await loadWaTasks();
      if(document.getElementById('view-whatsapp')?.classList.contains('active')) renderWhatsappTasks();
    }).subscribe();
  }
}


/* ---------- Setup panel (admin / approver): link WhatsApp, pick groups, schedule, role notes ---------- */

const WA_ROLE_DEFAULTS = {
  albert:'Web development: website builds, fixes, landing pages, forms, plugins, site bugs, design changes on the site.',
  stan:'AI SEO: AI search visibility, ChatGPT/Perplexity/AI Overviews questions, llms.txt, schema for AI.',
  eric:'Main point of contact for clients plus paid ads: Google Ads, Facebook/Meta Ads, budgets, leads quality, ad copy, billing questions about ads, anything not clearly someone else\'s.',
  charlie:'Mainly SEO (rankings, GBP/local SEO, content, backlinks, citations) and hosting (domains, DNS, email setup, SSL, site down).',
  dan:'Owner: contracts, pricing, invoices/payments, complaints, cancellations, strategy, other client-relationship matters.',
  joey:'Video production and client calls: shoots, edits, scheduling/attending calls and meetings.',
};
const WA_TIMEZONES = ['America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Sao_Paulo','UTC'];

let waSetup = { open:false, settings:null, groups:[], times:[], tz:'America/New_York', notes:{}, timer:null };

async function loadWaSetup(){
  const [s, g] = await Promise.all([
    supabaseClient.from('wa_settings').select('*').eq('id', 1).maybeSingle(),
    supabaseClient.from('wa_groups').select('jid,name,active,auto_match,manual').order('name', { ascending:true }),
  ]);
  waSetup.settings = s.data || null;
  waSetup.groups = g.data || [];
  if(waSetup.settings && !waSetup._draftReady){
    waSetup.times = [...(waSetup.settings.digest_times || ['09:00','15:00'])];
    waSetup.tz = waSetup.settings.timezone || 'America/New_York';
    waSetup.notes = { ...(waSetup.settings.role_notes || {}) };
    waSetup._draftReady = true;
  }
}

function waConnState(){
  const s = waSetup.settings;
  if(!s) return { tone:'#696F78', text:'Setup tables not found yet. Run schema-whatsapp-tasks.sql in Supabase first.' };
  const beat = s.heartbeat_at ? Date.now() - new Date(s.heartbeat_at).getTime() : Infinity;
  if(beat > 120000) return { tone:'#C0392B', text: s.heartbeat_at ? 'Connector is not running (last seen ' + new Date(s.heartbeat_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) + '). Start it on the office PC with npm start.' : 'Connector has never started. Follow the setup steps in whatsapp-connector/README.md.' };
  const qrFresh = s.qr && s.qr_at && Date.now() - new Date(s.qr_at).getTime() < 120000;
  if(qrFresh) return { tone:'#A65B05', text:'Waiting for you to scan the code below.' };
  const conn = waRuns.find(r => r.kind === 'status' || r.kind === 'error');
  if(conn && conn.connection === 'logged_out') return { tone:'#C0392B', text:'WhatsApp logged out. Press Re-link to get a new code.' };
  if(conn && conn.connection === 'open') return { tone:'#117F3A', text:'Connector running and WhatsApp linked. Reading the groups switched on below.' };
  return { tone:'#A65B05', text:'Connector running, WhatsApp not linked yet or reconnecting.' };
}

function waConnHtml(){
  const st = waConnState();
  const s = waSetup.settings;
  const qrFresh = s && s.qr && s.qr_at && Date.now() - new Date(s.qr_at).getTime() < 120000;
  const qrOk = qrFresh && /^data:image\/png;base64,[A-Za-z0-9+\/=]+$/.test(s.qr);
  return `<div style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:10px;"><span class="wa-dot" style="background:${st.tone}"></span><span>${escapeHtml(st.text)}</span></div>
    ${qrOk ? `<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;"><img src="${s.qr}" alt="WhatsApp link code" width="200" height="200" style="border-radius:8px;border:1px solid var(--border);background:#fff;">
      <ol style="margin:0;padding-left:18px;font-size:13px;color:var(--muted);line-height:1.7;"><li>Open WhatsApp on the phone</li><li>Settings, then Linked devices</li><li>Link a device, and scan this code</li></ol></div>` : ''}
    <div style="margin-top:12px;"><button class="btn" ${s ? '' : 'disabled'} onclick="waRelink()">Re-link a number</button>
    <span style="font-size:12px;color:var(--muted);margin-left:8px;">Signs out the current number and shows a new code.</span></div>`;
}

function renderWaSetup(){
  const root = document.getElementById('whatsappSetup');
  if(!root) return;
  if(!canApprove() || !waSetup.open){ root.innerHTML = ''; return; }
  const card = (title, sub, body) => `<div class="cd-h2"><h2>${title}</h2></div><div class="cd-grp" style="padding:14px 16px;">${sub ? `<div style="font-size:12.5px;color:var(--muted);margin-bottom:10px;">${sub}</div>` : ''}${body}</div>`;

  const groups = waSetup.groups.length ? `<input type="search" placeholder="Filter groups" oninput="waFilterGroups(this.value)" style="font-family:var(--font);font-size:12.5px;padding:6px 9px;border-radius:7px;border:1px solid var(--border);background:var(--card);color:var(--ink);width:240px;margin-bottom:8px;">
    <div id="waGroupList" style="max-height:300px;overflow:auto;">${waSetup.groups.map(g => `<label class="wa-grp" data-name="${escapeHtml(g.name.toLowerCase())}" style="display:flex;align-items:center;gap:10px;padding:6px 2px;font-size:13px;cursor:pointer;">
      <input type="checkbox" ${g.active ? 'checked' : ''} onchange="waToggleGroup('${escapeHtml(g.jid)}', this.checked)"> <span style="flex:1;min-width:0;">${escapeHtml(g.name)}</span>
      <span style="font-size:11.5px;color:var(--muted);">${g.manual ? 'set by you' : (g.auto_match ? 'matches client rule' : 'not a client group')}</span></label>`).join('')}</div>`
    : '<div style="font-size:13px;color:var(--muted);">No groups yet. They appear once the connector is linked.</div>';

  const times = waSetup.times.map((t, i) => `<span style="display:inline-flex;align-items:center;gap:4px;margin:0 8px 6px 0;"><input type="time" value="${escapeHtml(t)}" oninput="waSetup.times[${i}]=this.value" class="wa-sel">${waSetup.times.length > 1 ? `<button class="btn" style="padding:3px 8px;font-size:12px;" aria-label="Remove time" onclick="waRemoveTime(${i})">Remove</button>` : ''}</span>`).join('');
  const tzOpts = (WA_TIMEZONES.includes(waSetup.tz) ? WA_TIMEZONES : [waSetup.tz, ...WA_TIMEZONES]).map(z => `<option value="${escapeHtml(z)}" ${z === waSetup.tz ? 'selected' : ''}>${escapeHtml(z.replace('_',' '))}</option>`).join('');
  const schedule = `<div>${times}</div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:4px;">
    <button class="btn" ${waSetup.times.length >= 6 ? 'disabled' : ''} onclick="waAddTime()">Add a time</button>
    <select class="wa-sel" onchange="waSetup.tz=this.value" aria-label="Time zone">${tzOpts}</select>
    <button class="btn btn-brand" onclick="waSaveSchedule()">Save schedule</button></div>`;

  const roles = [['albert','Albert'],['stan','Stan'],['eric','Eric'],['charlie','Charlie'],['dan','Dan'],['joey','Joey']].map(([k, n]) => `<div style="margin-bottom:10px;"><label style="font-size:12.5px;font-weight:600;display:block;margin-bottom:3px;">${n}</label>
    <textarea rows="2" placeholder="${escapeHtml(WA_ROLE_DEFAULTS[k])}" oninput="waSetup.notes['${k}']=this.value" style="font-family:var(--font);font-size:12.5px;width:100%;box-sizing:border-box;padding:7px 9px;border-radius:7px;border:1px solid var(--border);background:var(--card);color:var(--ink);">${escapeHtml(waSetup.notes[k] || '')}</textarea></div>`).join('')
    + '<button class="btn btn-brand" onclick="waSaveRoles()">Save roles</button>';

  root.innerHTML = card('Connection', '', '<div id="waConnBox">' + waConnHtml() + '</div>')
    + card('Groups being read', 'Switch a group on to have the agent read it. Groups with Marketing in the name are on by default; personal chats stay off.', groups)
    + card('When it runs', 'The agent checks the groups and sends Slack messages at these times, every day.', schedule)
    + card('Who handles what', 'Leave a box empty to use the default. Changes apply on the next check, within a minute.', roles);
}

function waFilterGroups(q){
  const needle = String(q || '').trim().toLowerCase();
  document.querySelectorAll('#waGroupList .wa-grp').forEach(el => { el.style.display = !needle || el.dataset.name.includes(needle) ? 'flex' : 'none'; });
}

async function waToggleSetup(){
  waSetup.open = !waSetup.open;
  if(waSetup.open){
    waSetup._draftReady = false;
    await loadWaSetup();
    waSetup.timer = setInterval(waPollSetup, 4000);
  } else if(waSetup.timer){ clearInterval(waSetup.timer); waSetup.timer = null; }
  renderWaSetup(); renderWhatsappTasks();
}

// While Setup is open: refresh only the Connection box, so typing elsewhere is never wiped.
async function waPollSetup(){
  if(!waSetup.open || !document.getElementById('view-whatsapp')?.classList.contains('active')){
    if(waSetup.timer){ clearInterval(waSetup.timer); waSetup.timer = null; }
    waSetup.open = false; renderWaSetup(); return;
  }
  const [s, r, g] = await Promise.all([
    supabaseClient.from('wa_settings').select('*').eq('id', 1).maybeSingle(),
    supabaseClient.from('wa_runs').select('*').order('started_at', { ascending:false }).limit(20),
    supabaseClient.from('wa_groups').select('jid,name,active,auto_match,manual').order('name', { ascending:true }),
  ]);
  waSetup.settings = s.data || waSetup.settings; waRuns = r.data || waRuns;
  const prev = waSetup.groups.length;
  waSetup.groups = g.data || waSetup.groups;
  const box = document.getElementById('waConnBox');
  if(box) box.innerHTML = waConnHtml();
  if(prev === 0 && waSetup.groups.length) renderWaSetup();   // groups just appeared after linking
}

async function waToggleGroup(jid, on){
  const { error } = await supabaseClient.from('wa_groups').update({ active: !!on, manual: true, updated_at: new Date().toISOString() }).eq('jid', jid);
  if(error){ showToast('error', 'Could not update', error.message); await loadWaSetup(); renderWaSetup(); return; }
  const g = waSetup.groups.find(x => x.jid === jid); if(g){ g.active = !!on; g.manual = true; }
  showToast('success', on ? 'Group will be read' : 'Group switched off');
}

function waAddTime(){ if(waSetup.times.length < 6){ waSetup.times.push('12:00'); renderWaSetup(); } }
function waRemoveTime(i){ if(waSetup.times.length > 1){ waSetup.times.splice(i, 1); renderWaSetup(); } }

async function waSaveSchedule(){
  const times = waSetup.times.filter(t => /^([01]?\d|2[0-3]):[0-5]\d$/.test(t));
  if(!times.length){ showToast('error', 'Add at least one valid time'); return; }
  const { error } = await supabaseClient.from('wa_settings').update({ digest_times: times, timezone: waSetup.tz, updated_at: new Date().toISOString() }).eq('id', 1);
  if(error){ showToast('error', 'Could not save', error.message); return; }
  waSetup.times = times; renderWaSetup();
  showToast('success', 'Schedule saved', 'The connector picks it up within a minute.');
}

async function waSaveRoles(){
  const notes = {};
  Object.keys(WA_ROLE_DEFAULTS).forEach(k => { const v = String(waSetup.notes[k] || '').trim(); if(v) notes[k] = v.slice(0, 600); });
  const { error } = await supabaseClient.from('wa_settings').update({ role_notes: notes, updated_at: new Date().toISOString() }).eq('id', 1);
  if(error){ showToast('error', 'Could not save', error.message); return; }
  showToast('success', 'Roles saved', 'Used from the next check.');
}

async function waRelink(){
  if(!confirm('Sign out the current WhatsApp number and show a new code to scan? Reading stops until the new number is linked.')) return;
  const { error } = await supabaseClient.from('wa_settings').update({ relink_requested: true, updated_at: new Date().toISOString() }).eq('id', 1);
  if(error){ showToast('error', 'Could not request re-link', error.message); return; }
  showToast('success', 'Re-link requested', 'A new code appears here within a minute.');
}
