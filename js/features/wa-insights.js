// WhatsApp insights (Nov 24): what the connector's live watch and its checks find, shown where people
// already look. The data: addendum-whatsapp-insights.sql; the finding: whatsapp-connector/src/watch.js.
//   • Urgent items: marked and listed first on the WhatsApp screen (wa_tasks.urgent_at)
//   • Account signals (pausing, budget, a competitor, growing): a card on the WhatsApp screen and the
//     client's panel, for admins and approvers, who mark them Handled or dismiss them
//   • Client details found in the chats: Accept (it's saved on the client) or dismiss
//   • Client mood: Health shows a client who sounds frustrated (Watch) or upset (At risk)
//   • Reply times: how long clients wait for a first answer, in work hours, per person and per client
//   • The weekly update: an item marked done can become a line of that client's update
// Until the SQL is run these tables aren't there: everything here stays out of sight.

let waSignals = null;   // leads: wa_signals of the last 30 days, newest first
let waDetails = null;   // leads: wa_detail_suggestions waiting for a decision
let waMoods = null;     // everyone who sees WhatsApp: wa_moods of the last 3 weeks, newest first
let waTurns = null;     // leads: wa_reply_turns(14), newest first
let waWaits = null;     // leads: wa_alerts 'waiting' not answered yet
let waSigAll = false, waDetAll = false;
const WA_WORK = [9, 18];        // the hours a wait is counted in (as the connector's WORK_HOURS)
const WA_NUDGE_MIN = 120;       // the connector nudges the owner after this much work time

// The queries, run with the rest of waLoadNow (one round trip), and what came back.
function waInsightQueries(){
  const ago = d => new Date(Date.now() - d * 86400000).toISOString();
  return [
    supabaseClient.from('wa_moods').select('client_id,client,group_jid,level,reason,excerpt,at').gte('at', ago(21)).order('at', { ascending: false }).limit(1000),
    supabaseClient.from('wa_signals').select('*').gte('created_at', ago(30)).order('created_at', { ascending: false }).limit(200),
    supabaseClient.from('wa_detail_suggestions').select('*').eq('status', 'pending').order('created_at', { ascending: false }).limit(200),
    supabaseClient.rpc('wa_reply_turns', { p_days: 14 }),
    supabaseClient.from('wa_alerts').select('group_jid,client_id,wa_msg_id,asked_at,excerpt,notified_at').eq('kind', 'waiting').is('resolved_at', null).gte('created_at', ago(5)),
  ];
}
function waInsightsApply([mood, sig, det, turns, waits], lead){
  const rows = r => r && !r.error && Array.isArray(r.data) ? r.data : null;
  const before = waMoodKey();
  waMoods = rows(mood);
  waSignals = lead ? rows(sig) : null;
  waDetails = lead ? rows(det) : null;
  waTurns = lead ? rows(turns) : null;
  waWaits = lead ? rows(waits) : null;
  // Health reads the mood: redraw what shows it once it changes
  if(waMoodKey() !== before && typeof currentViewName !== 'undefined'){
    if(currentViewName === 'health' && typeof renderHealth === 'function') renderHealth();
    if(currentViewName === 'clients' && typeof renderClientsTable === 'function') renderClientsTable();
  }
}
function waMoodKey(){ return Array.isArray(waMoods) ? waMoods.slice(0, 60).map(m => `${m.client_id || m.client}:${m.level}:${m.at}`).join('|') : ''; }

// ---- which client ------------------------------------------------------------------------------
function waClientById(id){ return id && typeof liveClients === 'function' ? liveClients().find(c => String(c.id) === String(id)) || null : null; }
function waClientByName(name){
  const n = waNorm(waCleanName(name)); if(!n || typeof liveClients !== 'function') return null;
  return liveClients().find(c => waNorm(c.name) === n) || null;
}
function waRowClient(r){ return waClientById(r.client_id) || (r.group_jid ? waClient({ group_jid: r.group_jid, client: r.client || waCleanName((waGroups.find(g => g.jid === r.group_jid) || {}).name || '') }) : null) || (r.client ? waClientByName(r.client) : null); }
function waIsClient(r, c){ const x = waRowClient(r); return !!x && String(x.id) === String(c.id); }
// The client's WhatsApp group, if Radar reads one for them
function waGroupsOf(c){ return (waGroups || []).filter(g => { if(!g.active) return false; const x = waClient({ group_jid: g.jid, client: waCleanName(g.name) }); return !!x && String(x.id) === String(c.id); }); }

// ---- mood ---------------------------------------------------------------------------------------
const WA_MOOD = { happy: 'Happy', neutral: 'Neutral', frustrated: 'Sounds frustrated', angry: 'Upset' };
// The client's latest mood from the last week, or null.
function waMoodFor(c){
  if(!Array.isArray(waMoods) || !c) return null;
  const m = waMoods.find(x => waIsClient(x, c));
  if(!m || daysBetween(dayStart(new Date(m.at)), dayStart(rNow())) > 7) return null;
  return m;
}
// For clientHealth(): a frustrated client is Watch, an upset one At risk, with their words.
function waMoodSignal(c){
  const m = waMoodFor(c);
  if(!m || (m.level !== 'frustrated' && m.level !== 'angry')) return null;
  return { l: m.level === 'angry' ? 'r' : 'y', key: 'mood', icon: 'message-circle', title: m.level === 'angry' ? 'Upset on WhatsApp' : 'Sounds frustrated on WhatsApp',
    since: new Date(m.at), text: m.excerpt ? `“${m.excerpt}”` : (m.reason || 'From their WhatsApp messages this week.') };
}

// ---- reply times --------------------------------------------------------------------------------
// Minutes of work time (weekdays, 9–18 in the team's time zone) between two moments: a client who
// writes on Friday evening hasn't waited all weekend.
function waWorkMin(from, to){
  let a = new Date(from).getTime(), b = (to ? new Date(to) : rNow()).getTime();
  if(!(b > a)) return 0;
  b = Math.min(b, a + 14 * 86400000);
  const tz = waTz(), p = waTzParts(new Date(a), tz);
  const off = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - Math.floor(a / 60000) * 60000;   // wall clock = UTC + off
  const A = a + off, B = b + off, DAY = 86400000;
  let n = 0;
  for(let d = Math.floor(A / DAY) * DAY; d < B; d += DAY){
    const wd = new Date(d).getUTCDay(); if(wd === 0 || wd === 6) continue;
    const s = Math.max(A, d + WA_WORK[0] * 3600000), e = Math.min(B, d + WA_WORK[1] * 3600000);
    if(e > s) n += (e - s) / 60000;
  }
  return Math.round(n);
}
function waMinWords(n){
  if(n == null) return '—';
  if(n < 60) return `${Math.max(1, Math.round(n))} min`;
  const h = Math.floor(n / 60), m = Math.round(n % 60 / 5) * 5;
  return m === 60 ? `${h + 1}h` : m ? `${h}h ${m}m` : `${h}h`;
}
const waMedian = a => { if(!a.length) return null; const s = a.slice().sort((x, y) => x - y), i = Math.floor(s.length / 2); return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2; };
// Who answered, by the name on their WhatsApp (the team's first names, as the agent knows them)
function waReplier(sender){
  const s = waNorm(sender).split(' ')[0];
  const al = { joe: 'joey', daniel: 'dan', charles: 'charlie' };
  const o = WA_OWNERS.find(([k, n]) => k === s || waNorm(n) === s || k === al[s]);
  return o ? o[1] : 'Others';
}
// Answered turns of the last `days` days (optionally one client's), as work-time waits.
function waReplyStats(days, c){
  if(!Array.isArray(waTurns)) return null;
  const since = rNow().getTime() - days * 86400000;
  const list = waTurns.filter(t => t.replied_at && new Date(t.asked_at).getTime() >= since && (!c || waIsClient({ group_jid: t.group_jid }, c)))
    .map(t => ({ ...t, wait: waWorkMin(t.asked_at, t.replied_at), who: waReplier(t.replier) }));
  const people = {};
  list.forEach(t => { (people[t.who] = people[t.who] || []).push(t.wait); });
  return { n: list.length, median: waMedian(list.map(t => t.wait)),
    people: Object.entries(people).map(([who, w]) => ({ who, n: w.length, median: waMedian(w) })).sort((a, b) => b.n - a.n) };
}
// Clients waiting on an answer right now (the connector judged their message needs one), longest first
function waWaitingNow(c){
  if(!Array.isArray(waWaits)) return [];
  const answered = w => Array.isArray(waTurns) && waTurns.some(t => t.group_jid === w.group_jid && t.replied_at && new Date(t.replied_at) > new Date(w.asked_at));
  const latest = new Map();
  waWaits.filter(w => !answered(w) && (!c || waIsClient(w, c))).forEach(w => { const p = latest.get(w.group_jid); if(!p || new Date(w.asked_at) < new Date(p.asked_at)) latest.set(w.group_jid, w); });
  return [...latest.values()].map(w => ({ ...w, c: waRowClient(w), mins: waWorkMin(w.asked_at) })).filter(w => w.mins >= 15).sort((a, b) => b.mins - a.mins);
}
function waGroupLabel(jid){ const g = (waGroups || []).find(x => x.jid === jid); return g ? waCleanName(g.name) : 'A client'; }

// ---- the WhatsApp screen's side: account signals, reply times, client details --------------------
const WA_SIG_KIND = { pause: 'Wants to pause', cancel: 'Talks about cancelling', budget: 'Budget', competitor: 'Another agency', unhappy: 'Unhappy with results',
  expansion: 'Growing', new_service: 'Asks about a new service', referral: 'A referral', hiring: 'Hiring', other: 'Worth knowing' };
function waSigOpen(){ return Array.isArray(waSignals) ? waSignals.filter(s => s.status === 'new') : []; }
function waSigRow(s, inPanel){
  const c = waRowClient(s), name = c ? c.name : waCleanName(s.client);
  const open = c ? `openClientInspectorFor('${escapeHtml(String(c.id))}')` : '';
  return `<div class="wa-sig${s.type === 'risk' ? ' is-risk' : ' is-open'}" data-sig="${s.id}">
<button class="wa-sig-t"${open ? ` onclick="${open}"` : ' disabled'} title="${open ? `Open ${escapeHtml(name)}` : ''}"><i class="dot" aria-hidden="true"></i><span class="tx">${inPanel ? '' : `<b>${escapeHtml(name)}</b>`}<span class="k">${s.type === 'risk' ? 'Risk' : 'Opening'} · ${escapeHtml(WA_SIG_KIND[s.kind] || WA_SIG_KIND.other)} · ${escapeHtml(relDayLower(new Date(s.created_at)))}</span><span class="s">${escapeHtml(s.summary)}</span>${s.excerpt ? `<span class="q">“${escapeHtml(s.excerpt)}”</span>` : ''}</span></button>
<span class="wa-sig-a"><button class="lnk-b" onclick="waSignalSet(${s.id}, 'handled')">Mark Handled</button><button class="lnk-b is-2" onclick="waSignalSet(${s.id}, 'dismissed')">Dismiss</button></span></div>`;
}
function waSignalsCardHtml(){
  const list = waSigOpen(); if(!list.length) return '';
  const shown = waSigAll ? list : list.slice(0, 3);
  const more = list.length > 3 ? `<button class="lnk-b wa-qc-more" data-grow="wa-sig" aria-expanded="${waSigAll}" data-turn="180" onclick="waSigAll=!waSigAll;renderWhatsapp()">${waSigAll ? 'Show less' : `Show all ${list.length}`}${icon('caret-down', { weight: 'bold' })}</button>` : '';
  const risks = list.filter(s => s.type === 'risk').length;
  return `<div class="rmi-sec"><b>Account signals</b><span class="n">${list.length}</span>${risks ? `<span class="wa-sig-n">${risks} risk${risks === 1 ? '' : 's'}</span>` : ''}</div>
<div class="wa-sigs" data-grow-key="wa-sig">${shown.map(s => waSigRow(s)).join('')}</div>${more}`;
}
function waRepliesCardHtml(){
  const st = waReplyStats(7); if(!st) return '';
  const waiting = waWaitingNow();
  if(!st.n && !waiting.length) return '';
  const waitRows = waiting.slice(0, 3).map(w => `<button class="wa-qc" ${w.c ? `onclick="openClientInspectorFor('${escapeHtml(String(w.c.id))}')"` : 'disabled'} title="${w.excerpt ? `“${escapeHtml(w.excerpt)}”` : ''}"><b>${escapeHtml(w.c ? w.c.name : waGroupLabel(w.group_jid))}</b><span class="${w.mins >= WA_NUDGE_MIN ? 't-red' : ''}">waiting ${escapeHtml(waMinWords(w.mins))}</span></button>`).join('');
  const ppl = st.people.filter(p => p.who !== 'Others' || st.people.length === 1).slice(0, 6)
    .map(p => `<div class="wa-qc wa-rt"><b>${escapeHtml(p.who)}</b><span>${escapeHtml(waMinWords(p.median))}</span><span class="t-3">${p.n} repl${p.n === 1 ? 'y' : 'ies'}</span></div>`).join('');
  return `<div class="rmi-sec"><b>Reply times</b><span class="t-3 wa-rt-k">last 7 days, work hours</span></div>
${st.n ? `<p class="wa-rt-big"><b>${escapeHtml(waMinWords(st.median))}</b><span>typical first reply · ${st.n} time${st.n === 1 ? '' : 's'} a client wrote</span></p>` : ''}
${waiting.length ? `<div class="wa-rt-sub">Waiting now</div>${waitRows}` : ''}
${ppl ? `<div class="wa-rt-sub">By person</div>${ppl}` : ''}`;
}
// Details found in the chats for clients in Radar
const WA_FIELD = { contact: 'Contact', email: 'Email', phone: 'Phone', website: 'Website' };
function waDetailsOpen(c){ return Array.isArray(waDetails) ? waDetails.filter(d => d.status === 'pending' && waClientById(d.client_id) && (!c || String(d.client_id) === String(c.id))) : []; }
function waDetailCurrent(c, f){ return f === 'email' ? c.email : f === 'website' ? c.website : String(((c.customFieldValues || {})[f]) || ''); }
function waDetailRow(d, inPanel){
  const c = waClientById(d.client_id), cur = c ? waDetailCurrent(c, d.field) : '';
  return `<div class="wa-det" data-det="${d.id}"><span class="tx">${inPanel ? '' : `<b>${escapeHtml(c ? c.name : '')}</b>`}<span class="k">${WA_FIELD[d.field]}${cur ? ` · now ${escapeHtml(cur.replace(/^https?:\/\//, ''))}` : ' · not set yet'}</span><span class="v">${escapeHtml(d.value.replace(/^https?:\/\//, ''))}</span>${d.excerpt ? `<span class="q">“${escapeHtml(d.excerpt)}”</span>` : ''}</span>
<span class="wa-sig-a"><button class="lnk-b" onclick="waDetailAccept(${d.id})">${cur ? `Replace the ${WA_FIELD[d.field].toLowerCase()}` : `Add to ${escapeHtml(c ? c.name : 'the client')}`}</button><button class="lnk-b is-2" onclick="waDetailDismiss(${d.id})">Dismiss</button></span></div>`;
}
function waDetailsCardHtml(){
  if(typeof canApprove === 'function' && !canApprove() && !waCanSetup()) return '';
  const list = waDetailsOpen(); if(!list.length) return '';
  const shown = waDetAll ? list : list.slice(0, 3);
  const more = list.length > 3 ? `<button class="lnk-b wa-qc-more" data-grow="wa-det" aria-expanded="${waDetAll}" data-turn="180" onclick="waDetAll=!waDetAll;renderWhatsapp()">${waDetAll ? 'Show less' : `Show all ${list.length}`}${icon('caret-down', { weight: 'bold' })}</button>` : '';
  return `<div class="rmi-sec"><b>Client details from the chats</b><span class="n">${list.length}</span></div>
<div class="wa-dets" data-grow-key="wa-det">${shown.map(d => waDetailRow(d)).join('')}</div>${more}`;
}

// ---- the client's panel: a WhatsApp fold -----------------------------------------------------------
function clientWaOn(c){ return !!waMoodFor(c) || (waCanManage() && (waGroupsOf(c).length || waDetailsOpen(c).length || waSigOpen().some(s => waIsClient(s, c)))); }
function clientWaSummary(c){
  const m = waMoodFor(c), sig = waCanManage() ? waSigOpen().filter(s => waIsClient(s, c)) : [];
  const risk = sig.filter(s => s.type === 'risk').length;
  if(risk) return `<span class="t-red">${risk} account risk${risk === 1 ? '' : 's'}</span>`;
  if(m && (m.level === 'frustrated' || m.level === 'angry')) return `<span class="${m.level === 'angry' ? 't-red' : 't-yellow'}">${escapeHtml(WA_MOOD[m.level])}</span>`;
  const w = waCanManage() ? waWaitingNow(c)[0] : null;
  if(w) return `waiting ${escapeHtml(waMinWords(w.mins))}`;
  const st = waCanManage() ? waReplyStats(14, c) : null;
  if(st && st.n) return `replies in ${escapeHtml(waMinWords(st.median))}`;
  return m ? escapeHtml(WA_MOOD[m.level]) : 'Nothing new';
}
function clientWaHtml(c){
  const lead = waCanManage(), m = waMoodFor(c);
  const kv = (k, v) => `<div class="cl-kv"><span>${k}</span><span>${v}</span></div>`;
  let h = '';
  if(m) h += kv('Mood', `<span class="${m.level === 'angry' ? 't-red' : m.level === 'frustrated' ? 't-yellow' : m.level === 'happy' ? 't-green' : ''}">${escapeHtml(WA_MOOD[m.level])}</span> <span class="t-3">· ${escapeHtml(relDayLower(new Date(m.at)))}</span>`)
    + (m.excerpt || m.reason ? `<p class="cl-wa-q">${m.excerpt ? `“${escapeHtml(m.excerpt)}”` : escapeHtml(m.reason)}</p>` : '');
  if(lead){
    const st = waReplyStats(14, c), w = waWaitingNow(c)[0];
    if(st && st.n) h += kv('First reply', `${escapeHtml(waMinWords(st.median))} <span class="t-3">· typical, ${st.n} time${st.n === 1 ? '' : 's'} in 2 weeks</span>`);
    if(w) h += kv('Waiting now', `<span class="${w.mins >= WA_NUDGE_MIN ? 't-red' : ''}">${escapeHtml(waMinWords(w.mins))}</span>${w.excerpt ? ` <span class="t-3">· “${escapeHtml(w.excerpt.slice(0, 60))}”</span>` : ''}`);
    const sig = waSigOpen().filter(s => waIsClient(s, c));
    if(sig.length) h += `<div class="cl-wa-sub">Account signals</div><div class="wa-sigs">${sig.map(s => waSigRow(s, true)).join('')}</div>`;
    const det = (typeof canApprove === 'function' && canApprove()) || waCanSetup() ? waDetailsOpen(c) : [];
    if(det.length) h += `<div class="cl-wa-sub">Details from the chats</div><div class="wa-dets">${det.map(d => waDetailRow(d, true)).join('')}</div>`;
  }
  return `<div class="cl-kvs cl-wa">${h || '<p class="sp-empty">Nothing from their WhatsApp group yet.</p>'}</div>`;
}

// ---- decisions -----------------------------------------------------------------------------------
function waInsightsRedraw(){
  if(typeof currentViewName === 'undefined') return;
  if(currentViewName === 'whatsapp' && typeof renderWhatsapp === 'function') renderWhatsapp();
  if(currentViewName === 'clients' && typeof renderClientsTable === 'function') renderClientsTable();
}
async function waSignalSet(id, status){
  const s = (waSignals || []).find(x => String(x.id) === String(id)); if(!s) return;
  const before = s.status;
  s.status = status; waInsightsRedraw();
  const { error } = await supabaseClient.from('wa_signals').update({ status, handled_by: currentUser?.id || null, handled_at: new Date().toISOString() }).eq('id', id);
  if(error){ s.status = before; waInsightsRedraw(); showToast('error', 'Not saved', error.message); return; }
  showToast('success', status === 'handled' ? 'Marked handled' : 'Dismissed', '');
}
async function waDetailDismiss(id){
  const d = (waDetails || []).find(x => String(x.id) === String(id)); if(!d) return;
  d.status = 'dismissed'; waInsightsRedraw();
  const { error } = await supabaseClient.from('wa_detail_suggestions').update({ status: 'dismissed', decided_by: currentUser?.id || null, decided_at: new Date().toISOString() }).eq('id', id);
  if(error){ d.status = 'pending'; waInsightsRedraw(); showToast('error', 'Not saved', error.message); }
}
// Accept: saved on the client (asking first when it replaces something), then off the list.
async function waDetailAccept(id){
  const d = (waDetails || []).find(x => String(x.id) === String(id)), c = d && waClientById(d.client_id);
  if(!d || !c) return;
  const cur = waDetailCurrent(c, d.field);
  if(cur && !(await confirmDialog(`${c.name}’s ${WA_FIELD[d.field].toLowerCase()} is ${cur}. Use ${d.value} instead?`, { title: `Replace the ${WA_FIELD[d.field].toLowerCase()}?`, confirmLabel: 'Replace' }))) return;
  const fields = d.field === 'email' ? { email: d.value } : d.field === 'website' ? { website: d.value } : { customFieldValues: { ...(c.customFieldValues || {}), [d.field]: d.value } };
  const ok = await updateClientRow(c.id, fields);
  if(!ok){ showToast('error', 'Not saved', 'Couldn’t update the client. Try again.'); return; }
  Object.assign(c, fields);
  d.status = 'accepted'; waInsightsRedraw();
  await supabaseClient.from('wa_detail_suggestions').update({ status: 'accepted', decided_by: currentUser?.id || null, decided_at: new Date().toISOString() }).eq('id', id);
  if(typeof logClientActivity === 'function') logClientActivity(c.id, 'client_edited', `${WA_FIELD[d.field]} set to ${d.value}, from their WhatsApp group`);
  showToast('success', `${WA_FIELD[d.field]} saved`, `${c.name}: ${d.value.replace(/^https?:\/\//, '')}`);
}

// ---- the weekly update ---------------------------------------------------------------------------
// "Fix the quote form" → "Fixed the quote form": items are written as things to do; the update says
// what was done. A title that doesn't start with a verb it knows keeps its words after "Resolved:".
const WA_PAST = { add: 'Added', adjust: 'Adjusted', answer: 'Answered', build: 'Built', call: 'Called', change: 'Changed', check: 'Checked', clean: 'Cleaned up',
  confirm: 'Confirmed', connect: 'Connected', create: 'Created', delete: 'Deleted', design: 'Designed', edit: 'Edited', explain: 'Explained', find: 'Found',
  fix: 'Fixed', get: 'Got', give: 'Gave', improve: 'Improved', increase: 'Increased', install: 'Installed', investigate: 'Looked into', launch: 'Launched',
  look: 'Looked', lower: 'Lowered', make: 'Made', move: 'Moved', optimize: 'Optimized', pause: 'Paused', post: 'Posted', prepare: 'Prepared', provide: 'Provided',
  publish: 'Published', put: 'Put', redirect: 'Redirected', reduce: 'Reduced', remove: 'Removed', replace: 'Replaced', reply: 'Replied', resolve: 'Resolved',
  restore: 'Restored', resume: 'Resumed', review: 'Reviewed', schedule: 'Scheduled', send: 'Sent', set: 'Set', share: 'Shared', start: 'Started', stop: 'Stopped',
  switch: 'Switched', test: 'Tested', track: 'Tracked', turn: 'Turned', update: 'Updated', upload: 'Uploaded', verify: 'Verified', write: 'Wrote', bring: 'Brought',
  follow: 'Followed', run: 'Ran', setup: 'Set up', clarify: 'Clarified', research: 'Researched', submit: 'Submitted', approve: 'Approved', enable: 'Enabled', disable: 'Disabled' };
function waDoneLine(t){
  const s = String(t.title || '').trim().replace(/[.!]+$/, '');
  const m = s.match(/^([A-Za-z]+)\b(.*)$/), v = m && WA_PAST[m[1].toLowerCase()];
  return v ? v + m[2] : `${t.kind === 'issue' ? 'Resolved' : 'Done'}: ${s}`;
}
function waUpdateClient(t){ const c = waClient(t); return c && typeof getsUpdates === 'function' && getsUpdates(c) ? c : null; }
function waUpdateFits(t){ return !!t && t.kind !== 'question' && t.status !== 'dismissed' && !t.improvement_id && !!waUpdateClient(t); }
function waAddPref(){ try { return localStorage.getItem('wa-add-update') !== 'off'; } catch(e){ return true; } }
function waToggleAddPref(){ try { localStorage.setItem('wa-add-update', waAddPref() ? 'off' : 'on'); } catch(e){} renderWhatsapp(); }
// The switch under an open item's buttons
function waUpdateSwitchHtml(t){
  const c = waUpdateFits(t) ? waUpdateClient(t) : null; if(!c) return '';
  return `<div class="wap-upd">${swHtml(waAddPref(), 'Add it to the weekly update when it’s done', 'waToggleAddPref()')}<span>When it’s done, add “${escapeHtml(waDoneLine(t))}” to ${escapeHtml(c.name)}’s weekly update</span></div>`;
}
// Logs it as work for the client's update. Returns the client, or null.
async function waAddToUpdate(id, quiet){
  const t = waTasks.find(x => x.id === id), c = t && waUpdateFits(t) ? waUpdateClient(t) : null;
  if(!c) return null;
  const line = waDoneLine(t), author = (typeof myName === 'function' && myName()) || 'Team member';
  const imp = await insertImprovementRow(c.id, { author, text: line, includeInEmail: true, source: 'whatsapp' });
  if(!imp){ if(!quiet) showToast('error', 'Not added', 'Couldn’t add it to the update. Try again.'); return null; }
  t.improvement_id = String(imp.id);
  await supabaseClient.from('wa_tasks').update({ improvement_id: String(imp.id) }).eq('id', id);
  if(typeof logClientActivity === 'function') logClientActivity(c.id, 'improvement_logged', `${author} logged an improvement from WhatsApp: "${line.length > 80 ? line.slice(0, 80) + '…' : line}"`);
  if(!quiet){ showToast('success', `Added to ${c.name}’s update`, `“${line}”`); renderWhatsapp(); }
  return c;
}
