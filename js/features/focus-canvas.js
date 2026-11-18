// Focus Reports (called Internal by the team), as on the canvas boards FocusNew and FocusOpen.
// The weekly brief reads like a short memo: one paragraph on what happened, four numbers, then
// the priorities in order, each with an owner and a next step. A week picker steps through past
// reports; clicking a priority opens that client's panel on the right (the same one as Health).
// Reports are made by the weekly job (lib/proactive-insights.js) and stored in weekly_focus_reports.

let focusSelId = null;
function selectFocusReport(id){ focusSelId = id; window._focusSel = null; drawFocusReports(); }
function focusStep(dir){
  const i = focusReportsCache.findIndex(r => r.id === focusSelId), r = focusReportsCache[i + dir];
  if(r) selectFocusReport(r.id);
}
function selectFocusPriority(id){ window._focusSel = window._focusSel === id ? null : id; drawFocusReports(); }
function closeFocusPanel(){ window._focusSel = null; drawFocusReports(); }

async function renderFocusReportsPage(){
  const root = document.getElementById('focusRoot');
  if(!root) return;
  if(!root.dataset.ready) root.innerHTML = '<div class="spw"><div class="sp-page"><div class="fq"><p class="t-2" style="font-size:13px">Loading…</p></div></div></div>';
  const { data, error } = await supabaseClient.from('weekly_focus_reports').select('id, generated_at, data').order('generated_at', { ascending: false }).limit(104);
  if(!document.getElementById('focusRoot')) return;
  if(error){ root.innerHTML = '<div class="spw"><div class="sp-page"><div class="fq"><div class="empty"><b>Couldn’t load the reports</b>Check your connection and try again.</div></div></div></div>'; return; }
  focusReportsCache = (data || []).slice().sort((a, b) => new Date(b.generated_at) - new Date(a.generated_at));
  if(!focusReportsCache.some(r => r.id === focusSelId)) focusSelId = focusReportsCache[0]?.id || null;
  root.dataset.ready = '1';
  drawFocusReports();
}

const FOCUS_NUM = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const focusNum = (n, cap) => { const w = n <= 10 ? FOCUS_NUM[n] : String(n); return cap ? w : w.toLowerCase(); };
const lowerFirst = s => s ? s.charAt(0).toLowerCase() + s.slice(1) : s;

// A client's health the day the report went out, so an old report still reads as it did then.
function focusHealthAt(c, when){ return withAsOf(when, () => clientHealth(c)); }
// What's wrong, in a few words: "Over budget, and no update in 12 days".
function focusWhat(c, h, x){
  const bits = (h && h.signals.length ? tableSignal(h, c) : '').split(' · ').filter(Boolean);
  if(!bits.length) return [x && x.daysSinceImprovement != null ? `No update in ${x.daysSinceImprovement} days` : 'Nothing logged yet', x && x.danger ? `risk ${x.danger} of 5` : ''].filter(Boolean).join(' · ');
  if(bits.length === 1) return bits[0];
  return /^importance/.test(bits[1]) ? `${bits[0]} · ${bits[1]}` : `${bits[0]}, and ${lowerFirst(bits[1])}`;
}
// The same, as a clause about the client for the opening paragraph.
function focusClause(c, h){
  const sig = h ? h.signals : [];
  const n = s => (s.text.match(/(\d+) days/) || [])[1];
  const lead = { hours: s => h.hp.used > h.hp.budget ? 'is over its hours' : 'is on pace to go over its hours', noupdate: s => `has had no update in ${n(s)} days`,
    late: () => 'keeps sending its updates late', quiet: s => `has nothing logged in ${n(s)} days`, under: () => 'is under-using its hours',
    tasks: s => `has ${s.title.toLowerCase()}`, flag: s => `was ${lowerFirst(s.title)}` };
  const withs = { noupdate: s => `with no update in ${n(s)} days`, quiet: s => `with nothing logged in ${n(s)} days`, tasks: s => `with ${s.title.toLowerCase()}`, late: () => 'with its updates slipping' };
  if(!sig.length) return `${c.name} needs a look`;
  const a = sig[0], b = sig.find(s => s !== a && s.key !== a.key && withs[s.key]);
  if(a.key === 'late' || (a.key === 'noupdate' && /late or missed/.test(a.text))) return `${c.name}’s updates keep slipping`;
  return `${c.name} ${(lead[a.key] || (() => 'needs a look'))(a)}${b ? ' ' + withs[b.key](b) : ''}`;
}
// The obvious next step when nobody has planned one yet.
function focusNextStep(c, h, latest){
  const t = nextStepTask(c);
  if(t && latest) return t.title;
  const sig = h ? h.signals : [], keys = sig.map(s => s.key);
  const due = DAY_NAMES[clientWeek(c).due.getDay()];
  const say = { hours: 'Plan a fix', noupdate: 'get this week’s update out', late: `send ${due}’s update on time`, quiet: 'log this week’s work', under: 'use the hours or agree a smaller plan', tasks: 'clear the overdue tasks' };
  const picks = [...new Set(keys.filter(k => say[k] && k !== 'flag'))].slice(0, 2).map(k => say[k]);
  if(keys[0] === 'noupdate' && /late or missed/.test(sig[0].text)) picks[0] = `send ${due}’s update on time`;
  if(!picks.length) return 'Check in with the client';
  const s = picks.join(' and ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function focusPriorities(r){
  const d = r.data || {}, g = new Date(r.generated_at), latest = r.id === focusReportsCache[0]?.id;
  const fc = id => clients.find(x => x.id === id);
  const out = [];
  (d.attentionClients || []).slice().sort((a, b) => (b.danger || 0) - (a.danger || 0) || (b.daysSinceImprovement || 0) - (a.daysSinceImprovement || 0)).forEach(x => {
    const c = fc(x.id), h = c ? focusHealthAt(c, g) : null;
    out.push({ id: x.id, c: c || { id: x.id, name: x.name }, tag: tagHtml('red', 'At risk'), what: c ? focusWhat(c, h, x) : focusWhat(null, null, x),
      owner: c ? clientOwner(c) : '', next: c ? focusNextStep(c, h, latest) : '', h });
  });
  (d.overdueFollowUps || []).forEach(f => {
    const c = fc(f.clientId);
    const rem = (typeof clientReminders !== 'undefined' ? clientReminders : []).find(x => x.clientId === f.clientId && x.question === f.question);
    const asked = rem && rem.askedDate ? daysBetween(new Date(rem.askedDate + 'T12:00:00'), g) : null;
    const q = String(f.question || 'the follow-up').replace(/\?$/, '');
    out.push({ id: f.clientId, c: c || { id: f.clientId, name: f.clientName }, tag: tagHtml('yellow', 'Follow up'),
      what: `No answer on “${q}”${asked > 0 ? ` in ${asked} day${asked === 1 ? '' : 's'}` : ''}`,
      owner: rem ? ((teamProfiles.find(p => p.id === rem.askedBy) || {}).name || '') : (c ? clientOwner(c) : ''), next: latest ? 'Nudge them today' : 'Nudge them' });
  });
  (d.staleClients || []).forEach(x => {
    const c = fc(x.id);
    out.push({ id: x.id, c: c || { id: x.id, name: x.name }, tag: tagHtml('gray', 'Gone quiet'),
      what: x.daysSinceImprovement == null ? 'Nothing logged yet' : `Nothing logged in ${x.daysSinceImprovement} days`, owner: c ? clientOwner(c) : '', next: 'Check in, then log what’s been done' });
  });
  return out;
}

function focusLead(r, pri){
  const d = r.data || {}, g = new Date(r.generated_at);
  const attn = (d.attentionClients || []).map(x => clients.find(c => c.id === x.id)).filter(Boolean);
  const od = (d.overdueFollowUps || []).length, st = (d.staleClients || []).length;
  const others = [od ? `${focusNum(od)} follow-up${od === 1 ? ' is' : 's are'} overdue` : '', st ? `${focusNum(st)} client${st === 1 ? ' has' : 's have'} gone quiet` : ''].filter(Boolean);
  if(!attn.length) return others.length ? `No client is at risk this week. ${others.join(' and ').replace(/^./, m => m.toUpperCase())}.` : 'No client is at risk this week, and nothing is overdue. Everything is on track.';
  const clauses = attn.slice(0, 2).map(c => focusClause(c, focusHealthAt(c, g)));
  const more = attn.length > 2 ? `, and ${focusNum(attn.length - 2)} more` : '';
  const list = clauses.length === 2 && !more ? `${clauses[0]}, and ${clauses[1]}` : clauses.join(', ') + more;
  const head = `${focusNum(attn.length, true)} client${attn.length === 1 ? ' needs' : 's need'} attention: ${list}.`;
  return head + (others.length ? ` Also, ${others.join(' and ')}.` : ' Everything else is on track.');
}

// Good news from the week before the report: clients off last week's list, early updates, work logged.
function focusGoodNews(r){
  const g = new Date(r.generated_at), from = addDays(g, -7), i = focusReportsCache.findIndex(x => x.id === r.id), prev = focusReportsCache[i + 1];
  const d = r.data || {}, now = new Set([...(d.attentionClients || []), ...(d.staleClients || [])].map(x => x.id));
  const out = [];
  if(prev) (prev.data?.attentionClients || []).filter(x => !now.has(x.id)).map(x => clients.find(c => c.id === x.id)).filter(Boolean).slice(0, 2)
    .forEach(c => out.push(`${escapeHtml(c.name)} is healthy again`));
  let early = 0, logged = 0, who = new Set();
  activeClients().forEach(c => {
    const s = sentTimes(c);
    s.forEach((t, k) => { if(t > from && t <= g && k > 0 && daysBetween(dayStart(t), dayStart(addDays(s[k - 1], UPDATE_EVERY_DAYS))) >= 1) early++; });
    (c.improvements || []).forEach(m => { const t = new Date(m.date); if(t > from && t <= g){ logged++; who.add(c.id); } });
  });
  if(early) out.push(`${early} update${early === 1 ? '' : 's'} went out early`);
  if(logged) out.push(`${logged} improvement${logged === 1 ? '' : 's'} logged across ${who.size} client${who.size === 1 ? '' : 's'}`);
  return out.slice(0, 3);
}

function drawFocusReports(){
  const root = document.getElementById('focusRoot');
  if(!root || !root.dataset.ready) return;
  if(currentViewName === 'focusreports') setToolbar(null, 'A weekly brief on what needs the team');
  const r = focusReportsCache.find(x => x.id === focusSelId);
  if(!r){
    const day = DAY_NAMES[settings.proactiveInsightsDayOfWeek ?? 3];
    const es = !activeClients().length
      ? emptyNoClients('Each week a short report says which clients need the team, and why.', { title: 'No focus report yet' })
      : emptyState({ icon: 'clipboard-text', tone: 'blue', title: 'No focus report yet',
          text: `Each ${day} morning a short report goes to the team: which clients need attention this week, and why. The first one comes this ${day}.`,
          action: isAdmin() ? 'Change the Day' : '', onAction: "openSettingsTab('ai')" });
    root.innerHTML = `<div class="spw"><div class="sp-page"><div class="fq">${es}</div></div></div>`;
    return;
  }
  const idx = focusReportsCache.indexOf(r), latest = idx === 0, g = new Date(r.generated_at), d = r.data || {};
  const wk = x => new Date(x.generated_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  const pick = `<div class="fq-pick"><button class="ib" aria-label="Previous week" title="Previous week" onclick="focusStep(1)"${idx >= focusReportsCache.length - 1 ? ' disabled' : ''}>${icon('caret-left')}</button>
<label class="pop pop-sel"><span class="pl">Week of ${wk(r)}</span>${icon('caret-down')}<select aria-label="Week" onchange="selectFocusReport(this.value)">${focusReportsCache.map((x, i) => `<option value="${x.id}"${x === r ? ' selected' : ''}>Week of ${wk(x)}${i === 0 ? ' (latest)' : ''}</option>`).join('')}</select></label>
<button class="ib" aria-label="Next week" title="Next week" onclick="focusStep(-1)"${latest ? ' disabled' : ''}>${icon('caret-right')}</button></div>`;
  const attn = d.attentionClients || [], overdue = d.overdueFollowUps || [], drafts = d.pendingDrafts || [], ai = d.aiFindings || [];
  const ot = onTimeBefore(g);
  const stat = (v, sfx, l, red) => `<div class="fq-st"><b class="${red ? 'red' : ''}">${v}${sfx ? `<small>${sfx}</small>` : ''}</b><span>${l}</span></div>`;
  const stats = stat(attn.length, '', 'Need attention', attn.length > 0) + stat(overdue.length, '', `Overdue follow-up${overdue.length === 1 ? '' : 's'}`)
    + stat(ot.ok, ` of ${ot.of}`, 'Updates on time') + stat(drafts.length, '', `Draft${drafts.length === 1 ? '' : 's'} waiting`);
  const pri = focusPriorities(r);
  const priHtml = pri.length ? pri.map((p, i) => `<a class="fq-p${window._focusSel === p.id ? ' is-sel' : ''}" href="#" onclick="selectFocusPriority('${p.id}');return false;" aria-expanded="${window._focusSel === p.id}"><span class="fq-n">${i + 1}</span>
<div class="fq-pm"><div class="fq-ph">${monoHtml(p.c, 'sm')}<b>${escapeHtml(p.c.name)}</b>${p.tag}</div>
<p class="fq-pw">${escapeHtml(p.what)}</p>${p.owner || p.next ? `<p class="fq-pn">${p.owner ? `<span>${escapeHtml(p.owner)}</span>` : ''}${escapeHtml(p.next)}</p>` : ''}</div>${icon('caret-right')}</a>`).join('')
    : '<p class="fq-none">Nothing needed the team this week.</p>';
  const aiHtml = ai.length ? `<div class="fq-sec"><b>Worth a look</b><span>Patterns the Assistant noticed</span></div>${ai.map(f => `<div class="fq-ai">${icon('sparkle')}<p>${f.title ? `<b>${escapeHtml(f.title)}.</b> ` : ''}${escapeHtml(f.body || '')}</p></div>`).join('')}` : '';
  const draftRows = drafts.map(x => {
    const c = clients.find(y => y.id === x.id) || { id: x.id, name: x.name }, cur = (c.drafts || []).find(dd => dd.draftStatus === 'pending');
    return `<a class="fq-d" href="#" onclick="focusOpenDraft('${x.id}');return false;">${monoHtml(c, 'sm')}<span class="fq-dn">${escapeHtml(c.name)}</span><em>${cur ? escapeHtml(firstName(cur.author || '')) : latest ? 'Sent' : ''}</em></a>`;
  }).join('');
  const good = focusGoodNews(r);
  let next = latest ? addDays(g, 7) : null;
  while(next && next < rNow()) next = addDays(next, 7);
  const errs = (d.errors || []).length;
  const page = `<div class="fq">
<div class="fq-top">${pick}<div class="fq-acts"><button class="btn" onclick="downloadFocusReport('${r.id}')">${icon('download-simple')}Download</button><button class="btn" onclick="emailFocusReportToTeam('${r.id}')">${icon('envelope-simple')}Email Team</button></div></div>
<div class="fq-cols">
<article class="fq-doc" aria-label="Focus report">
<span class="fq-k">Sent to the team ${g.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} at ${fmtTime(g)}</span>
<h1>${latest ? 'This week’s focus' : `Focus for the week of ${g.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`}</h1>
<p class="fq-lead">${escapeHtml(focusLead(r, pri))}</p>
<div class="fq-stats">${stats}</div>
<div class="fq-sec"><b>Priorities</b><span>${pri.length ? 'In order. Each one has an owner and a next step.' : ''}</span></div>
${priHtml}
${aiHtml}
${errs ? `<p class="fq-err">${errs} check${errs === 1 ? '' : 's'} could not run when this report was made.</p>` : ''}
</article>
<aside class="fq-rail" aria-label="Also this week">
<div class="fq-sec"><b>Drafts waiting for review</b>${drafts.length ? `<a class="x-lnk" href="#" onclick="switchView('teamqueue');return false;">Review</a>` : ''}</div>${draftRows || '<p class="fq-none">None were waiting.</p>'}
${good.length ? `<div class="fq-sec fq-s2"><b>Good news</b></div>${good.map(t => `<div class="fq-g">${icon('check-circle')}<span>${t}</span></div>`).join('')}` : ''}
${next ? `<p class="fq-next">${icon('clock')}Next report ${next.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} at ${fmtTime(next)}</p>` : ''}
</aside>
</div></div>`;
  const sel = window._focusSel && clients.find(c => c.id === window._focusSel);
  const panel = sel ? healthPanelHtml(sel, clientHealth(sel), 'closeFocusPanel()') : '';
  const prevScroll = root.querySelector('.sp-page')?.scrollTop || 0;
  root.innerHTML = `<div class="spw"><div class="sp-page">${page}</div>${panel}</div>`;
  const sp = root.querySelector('.sp-page'); if(sp) sp.scrollTop = prevScroll;
}

// How many clients had an update in the 7 days before a report's date.
function onTimeBefore(when){
  const due = new Date(when), from = addDays(due, -UPDATE_EVERY_DAYS);
  const act = activeClients();
  const ok = act.filter(c => sentTimes(c).some(t => t > from && t <= due)).length;
  return { ok, of: act.length };
}
function focusOpenDraft(id){
  const c = clients.find(x => x.id === id), d = (c?.drafts || []).find(x => x.draftStatus === 'pending');
  d ? openReviewDraft(id, d.author) : switchView('teamqueue');
}

// Notifications and the Today banner open the report here rather than in a pop-up.
function openWeeklyFocusReportModal(reportId){
  if(reportId) focusSelId = reportId;
  window._focusSel = null;
  switchView('focusreports');
}

// Today has no Focus Report banner on the canvas: reports live in Focus Reports.
function refreshWeeklyFocusReportBanner(){}
