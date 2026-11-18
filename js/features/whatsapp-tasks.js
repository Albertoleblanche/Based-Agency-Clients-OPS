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
  if(!waRealtimeStarted && typeof supabaseClient.channel === 'function'){
    waRealtimeStarted = true;
    supabaseClient.channel('wa-tasks').on('postgres_changes', { event:'*', schema:'public', table:'wa_tasks' }, async () => {
      await loadWaTasks();
      if(document.getElementById('view-whatsapp')?.classList.contains('active')) renderWhatsappTasks();
    }).subscribe();
  }
}
