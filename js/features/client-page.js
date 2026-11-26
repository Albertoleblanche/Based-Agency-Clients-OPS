// The client page, as on the canvas: name and tabs on top, the health callout, this week's
// update as steps, why it's at risk, improvements — with hours, weekly updates and details on the side.

let cdTab = 'overview';
function setCdTab(t){ cdTab = t; renderClientPage(); }

window.renderClientDetail = (function(orig){
  return function(){ try{ orig(); }catch(e){ console.error(e); } renderClientPage(); };
})(window.renderClientDetail);
window.openClientDetail = (function(orig){
  return async function(id){ if(id !== currentDetailClientId) cdTab = 'overview'; return orig(id); };
})(window.openClientDetail);

function renderClientPage(){
  if(!document.getElementById('view-clientdetail')?.classList.contains('active')) return;
  const c = clients.find(x => x.id === currentDetailClientId);
  const top = document.getElementById('cdTop');
  if(!top || !c) return;
  setToolbar(c.name, typeof viewTitle === 'function' ? viewTitle('clients') : 'All Clients');
  const h = clientHealth(c), w = weekView(clientWeek(c)), owner = clientOwner(c), next = nextStepTask(c);
  const myNotes = (typeof notes !== 'undefined' ? notes : []).filter(n => n.clientId === c.id);
  const start = c.startDate ? new Date(c.startDate + 'T12:00:00') : null;
  const tabs = [['overview', 'Overview', ''], ['improvements', 'Improvements', (c.improvements || []).length], ['time', 'Time', ''], ['notes', 'Notes', myNotes.length], ['activity', 'Activity', '']]
    .map(([k, t, n]) => `<button class="${cdTab === k ? 'on' : ''}" role="tab" aria-selected="${cdTab === k}" onclick="setCdTab('${k}')">${t}${n !== '' && n ? ` <span class="c">${n}</span>` : ''}</button>`).join('');
  // paused, or Radar asking whether it's still a client (client-status.js), instead of health
  let callout = typeof clientStatusCalloutHtml === 'function' ? clientStatusCalloutHtml(c) : '';
  if(callout) callout = callout.replace('class="next st-next', 'style="margin-top:20px" class="next st-next');
  else if(h.level !== 'g'){
    callout = `<div class="next" style="margin-top:20px"><span class="sig ${h.level}">${icon(h.level === 'r' ? 'activity' : 'eye')}</span>
<div class="tx"><b>${healthWord(h.level)} since ${relDay(h.since || rNow()).toLowerCase() === 'today' ? 'today' : relDay(h.since || rNow())}${next ? '' : ' — no next step yet'}</b><span>${escapeHtml(h.signals.map(s => s.title.charAt(0).toUpperCase() + s.title.slice(1)).join(' · '))}</span></div>
<button class="btn" onclick="openHealthClient('${c.id}')">See Why</button>${typeof planWithClaudeHtml === 'function' ? planWithClaudeHtml(c.id) : ''}${next ? `<button class="btn" onclick="openTaskDetailModal('${next.id}')">Open Next Step</button>` : `<button class="btn btn-p" onclick="planNextStep('${c.id}')">${icon('plus')}Plan Next Step</button>`}</div>`;
  }
  // the new look: the canvas layout, a grid of cards
  const uw = typeof uiStyleOn === 'function' && uiStyleOn();
  document.getElementById('cdRoot')?.classList.toggle('is-uw', !!uw);
  if(uw){
    top.innerHTML = `<header class="cp-hd"><div><h1>${escapeHtml(c.name)}</h1><div class="cp-sub">${typeof focusToggleHtml === 'function' ? focusToggleHtml(c) : ''}${c.status === 'Paused' ? '<span class="uw-delta n"><i></i>Paused</span>' : h.level !== 'g' ? `<span class="uw-delta bad"><i></i>${escapeHtml(healthWord(h.level))} since ${relDay(h.since || rNow()).toLowerCase() === 'today' ? 'today' : escapeHtml(relDay(h.since || rNow()))}</span>` : h.off ? '<span class="uw-delta n"><i></i>No weekly update</span>' : '<span class="uw-delta"><i></i>Healthy</span>'}<span>${escapeHtml([c.service, owner ? firstName(owner) + ' owns it' : '', c.status !== 'Active' && c.status !== 'Paused' ? c.status : '', start ? 'client since ' + start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : ''].filter(Boolean).join(' · '))}</span></div></div>
<div class="seg" role="tablist" aria-label="Client sections">${tabs}</div></header>${callout && callout.includes('st-next') ? callout : ''}`;
  } else
  top.innerHTML = `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:16px">
<span class="mono ${clientColor(c)}" style="width:56px;height:56px;border-radius:14px;font-size:19px" aria-hidden="true">${escapeHtml(clientMono(c))}</span>
<div style="min-width:0"><h1 class="lt">${escapeHtml(c.name)}</h1><p class="lt-sub" style="margin-top:4px">${typeof focusToggleHtml === 'function' ? focusToggleHtml(c) : ''}${escapeHtml([c.service, c.status !== 'Active' ? c.status : '', start ? 'client since ' + start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : ''].filter(Boolean).join(' · '))}</p></div>
<span style="flex:1"></span><div class="seg" role="tablist" aria-label="Client sections">${tabs}</div></div>
${callout}${typeof claudeNotesHtml === 'function' && cdTab === 'overview' ? claudeNotesHtml(c, 'classic') : ''}`;
  document.querySelectorAll('#cdRoot .cd-tab').forEach(t => { t.hidden = t.dataset.tab !== cdTab; });

  // ---- Overview
  const stepTxt = [w.sent ? 'Logged' : `${w.forEmail.length} improvement${w.forEmail.length === 1 ? '' : 's'}`,
    w.sent || w.done > 1 ? 'Sent for review' : w.draft && w.done === 1 ? 'Waiting on ' + firstName(w.draft.author) : 'Draft not written',
    w.sent || w.done > 2 ? 'Approved' : 'By an approver', w.sent ? `Sent ${relDayLower(w.last)}` : w.dueText];
  const stepper = STEP_NAMES.map((n, k) => {
    const cls = w.sent ? 's d' : k < w.done ? 'd' : (w.behind === k ? 'b' + (w.late ? ' r' : '') : '');
    const mark = (w.sent || k < w.done) ? icon('check', { weight: 'bold' }) : (w.behind === k ? icon('exclamation-mark', { weight: 'bold' }) : '');
    return `<div class="stp ${cls}"><span class="m">${mark}</span><b>${n}</b><span>${escapeHtml(stepTxt[k])}</span></div>`;
  }).join('');
  const holder = w.holder && w.holder !== 'approvers' ? w.holder : owner;
  const weekBtns = w.sent ? '' : `<div style="display:flex;gap:8px;margin-top:16px">${w.draft ? `<button class="btn" onclick="openReviewDraft('${c.id}',${jsArg(w.draft.author)})">${icon('envelope-open')}Open Draft</button>` : `<button class="btn" onclick="openWeekClient('${c.id}')">${icon('layers')}Open in This Week</button>`}${holder && holder !== myName() ? `<button class="btn" onclick="remindHolder('${c.id}')">Remind ${escapeHtml(firstName(holder))}</button>` : ''}</div>`;
  const imps = (c.improvements || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  const sentAt = lastSentAt(c);
  const impStatus = i => i.includeInEmail === false ? 'Internal' : w.off ? 'Logged' : (w.draft && (w.draft.draftImprovementIds || []).includes(i.id) ? 'In this week’s draft' : (sentAt && new Date(i.date) <= sentAt ? 'In the ' + fmtShortDate(sentAt) + ' update' : 'Not sent yet'));
  const impRows = (list) => list.map(i => `<div class="row sm"><span style="width:52px;flex:0 0 auto;font-size:13px;color:var(--label-2)">${fmtShortDate(new Date(i.date))}</span>
<div class="tx"><span class="t" style="font-weight:400">${escapeHtml(i.text)}</span><span class="s">${escapeHtml([c.service, i.author].filter(Boolean).join(' · '))}</span></div><div class="r">${impStatus(i)}</div></div>`).join('');
  const seq = h.seq, ots = onTimeSummary(seq);
  const kv = (k, v) => `<div class="kv"><span>${k}</span><b style="font-weight:500">${v}</b></div>`;
  const cf = (settings.customFields || []).filter(f => (c.customFieldValues || {})[f.id]).map(f => kv(escapeHtml(f.label || f.name || 'Field'), escapeHtml(String(c.customFieldValues[f.id])))).join('');
  if(uw){
    document.getElementById('cdOverviewMain').innerHTML = cpUwGridHtml(c, { h, w, owner, next, imps, impStatus, seq, ots, sentAt, holder });
    document.getElementById('cdOverviewSide').innerHTML = '';
  } else {
  document.getElementById('cdOverviewMain').innerHTML = `
<div class="h2"><h2>This week’s update</h2><span class="${w.late ? 't-red' : 't-2'}" style="font-size:13px">${escapeHtml(w.off ? 'Off' : w.sent ? w.note : w.upcoming ? `${w.dueText} · last sent ${fmtShortDate(w.last)}` : w.dueText)}</span></div>
${w.off ? `<div class="panel" style="padding:18px"><b>No weekly update</b><p class="t-2" style="margin:4px 0 0">It stays off This Week, Today, the Queue and Health. Work and hours are still logged here.</p></div>`
  : `<div class="panel" style="padding:18px 18px 16px"><div class="stepper">${stepper}</div>${weekBtns}</div>`}
${(() => { const card = typeof riskCardHtml === 'function' ? riskCardHtml(c, h) : '', ws = card ? h.work.signals : h.signals;   // the work and the flag (Nov 25)
  return (card || ws.length) ? `<div class="h2"><h2>${h.level === 'r' ? 'Why it’s at risk' : h.level === 'y' ? 'Why it’s on Watch' : 'Health'}${ws.length ? `<span class="c">${ws.length}</span>` : ''}</h2>${canChangeRules() ? `<a href="#settings" onclick="openSettingsTab('updates');return false;">Adjust signals</a>` : ''}</div>${card}${ws.length ? `<div class="grp cp-wsig">${signalRowsHtml({ signals: ws })}</div>` : ''}` : ''; })()}
<div class="h2"><h2>Improvements<span class="c">${imps.length}</span></h2>${waCanWork(c) ? `<a href="#" onclick="openQueueLogImprovementModal('${c.id}');return false;">Log Improvement</a>` : ''}</div>
<div class="grp">${impRows(imps.slice(0, 6)) || '<div class="row sm"><span class="s t-2" style="font-size:13px">Nothing logged yet.</span></div>'}</div>
${imps.length > 6 ? `<p style="margin:8px 2px 0"><a class="btn btn-q sm" href="#" onclick="setCdTab('improvements');return false;">All ${imps.length} improvements</a></p>` : ''}`;
  document.getElementById('cdOverviewSide').innerHTML = `
<section class="panel"><h3>Hours this month<span>${h.hp.budget ? `<b class="${h.hp.used > h.hp.budget ? 't-red' : ''}" style="font-weight:600">${Math.round(h.hp.used)}</b> of ${h.hp.budget}` : Math.round(h.hp.used) + ' h'}</span></h3>${h.hp.budget ? paceChartHtml(c, 300, 140) : '<p class="t-2" style="font-size:13px;margin:0">No monthly budget set.</p>'}</section>
${w.off ? `<section class="panel"><h3>Weekly updates<span>Off</span></h3><div class="t-2" style="font-size:13px">No weekly update${sentAt ? ' · last sent ' + fmtShortDate(sentAt) : ''}</div></section>` : `<section class="panel"><h3>Weekly updates<span>${ots.total ? `On time ${ots.onTime} of ${ots.total}` : ''}</span></h3><div style="display:flex;align-items:center;justify-content:space-between;font-size:13px">${histDotsHtml(seq)}<span class="t-2">${sentAt ? 'Last sent ' + fmtShortDate(sentAt) : 'None sent yet'}</span></div></section>`}
<section class="panel"><h3>Details${canEditClients() ? `<span><a href="#" onclick="openEditClientFormFromDetail();return false;" style="color:var(--label);font-weight:500">Edit</a></span>` : ''}</h3>
${kv('Status', escapeHtml(c.status || '—'))}${kv('Importance', `${c.importance || 0} of 10`)}${kv('Risk flag', `${c.danger || 0} of 5`)}
${kv('Monthly budget', c.monthlyHourBudget ? `${c.monthlyHourBudget} hours` : '—')}
<div class="kv"><span>Owner</span><span style="display:inline-flex;align-items:center;gap:6px;color:var(--label)">${owner ? avHtml(owner) + escapeHtml(owner) : '—'}</span></div>
${c.website ? `<div class="kv"><span>Website</span><a href="${safeUrl(c.website.startsWith('http') ? c.website : 'https://' + c.website)}" target="_blank" rel="noopener" style="font-weight:500">${escapeHtml(c.website.replace(/^https?:\/\//, ''))}</a></div>` : ''}
${c.email ? `<div class="kv"><span>Contact</span><a href="mailto:${escapeHtml(c.email)}" style="font-weight:500">${escapeHtml(c.email)}</a></div>` : ''}
${cf}</section>
${c.sow ? `<section class="panel"><h3>Scope</h3><p style="margin:0;font-size:14px;line-height:1.55">${escapeHtml(c.sow)}</p></section>` : ''}`;
  }

  // ---- other tabs
  document.getElementById('cdImpTab').innerHTML = `<div class="h2"><h2>Improvements<span class="c">${imps.length}</span></h2>${waCanWork(c) ? `<a href="#" onclick="openQueueLogImprovementModal('${c.id}');return false;">Log Improvement</a>` : ''}</div>
<div class="grp">${imps.map(i => { const idx = c.improvements.indexOf(i); return impRows([i]).replace('</div></div>', `${workLockedBy(i) ? `<span class="ib act is-lock" role="img" title="${escapeHtml(workLockedWords(workLockedBy(i)))}" aria-label="Locked until it’s sent">${icon('lock')}</span>`
  : canApproveUpdates() || i.author === myName() ? `<button class="ib act" title="Edit" aria-label="Edit" onclick="startEditImprovement('${c.id}',${idx})">${icon('pencil-simple')}</button><button class="ib act" title="Delete" aria-label="Delete" onclick="deleteImprovement('${c.id}',${idx})">${icon('trash')}</button>` : ''}</div></div>`); }).join('') || '<div class="row sm"><span class="s t-2">Nothing logged yet.</span></div>'}</div>`;
  const entries = (typeof timeEntries !== 'undefined' ? timeEntries : []).filter(e => e.clientId === c.id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60);
  const total = entries.reduce((s, e) => s + e.minutes, 0);
  document.getElementById('cdTimeTab').innerHTML = `<div class="h2"><h2>Time<span class="c">${Math.round(total / 6) / 10} h</span></h2>${waCanWork(c) ? `<a href="#" onclick="openTimerModal('${c.id}');return false;">Track Time</a>` : ''}</div>
<div class="grp">${entries.map(e => { const p = teamProfiles.find(x => x.id === e.userId); return `<div class="row sm"><span style="width:52px;flex:0 0 auto;font-size:13px;color:var(--label-2)">${fmtShortDate(new Date(e.date + 'T12:00:00'))}</span><div class="tx"><span class="t" style="font-weight:400">${escapeHtml(e.description || 'Time logged')}</span><span class="s">${escapeHtml([e.service, p?.name].filter(Boolean).join(' · '))}</span></div><div class="r"><span class="dur">${Math.floor(e.minutes / 60)}:${String(e.minutes % 60).padStart(2, '0')}</span></div></div>`; }).join('') || '<div class="row sm"><span class="s t-2">No time logged yet.</span></div>'}</div>`;
  const rems = (typeof clientReminders !== 'undefined' ? clientReminders : []).filter(r => r.clientId === c.id && !r.waitingOn && r.status !== 'answered');
  // the client's meetings first (Nov 23), when Granola is in use
  const mtOn = typeof clientMeetingsOn === 'function' && clientMeetingsOn(c);
  const mtHtml = mtOn ? `<div class="h2"><h2>Meetings<span class="c">${granolaMeetings ? clientMeetings(c).length : ''}</span></h2><span class="t-2" style="font-size:13px">${escapeHtml(lastMetWords(c) || 'No meeting with them yet')}</span></div>${clientMeetingsHtml(c, 20)}` : '';
  document.getElementById('cdNotesTab').innerHTML = mtHtml + `<div class="h2"><h2>Waiting on the client<span class="c">${rems.length}</span></h2><a href="#" onclick="openNewReminderModal('${c.id}');return false;">New Reminder</a></div>
<div class="grp">${rems.map(r => `<a class="row sm" href="#" onclick="openReminderDetailModal('${r.id}');return false;"><div class="tx"><span class="t" style="font-weight:400">${escapeHtml(r.question)}</span><span class="s">Asked ${fmtShortDate(new Date(r.askedDate + 'T12:00:00'))}${r.followUpDate ? ' · follow up ' + fmtShortDate(new Date(r.followUpDate + 'T12:00:00')) : ''}</span></div><div class="r">${reminderDisplayStatus(r) === 'due' ? '<span class="t-red">Follow-up due</span>' : 'Waiting'}</div></a>`).join('') || '<div class="row sm"><span class="s t-2">Nothing waiting on the client.</span></div>'}</div>
<div class="h2"><h2>My notes<span class="c">${myNotes.length}</span></h2><a href="#" onclick="openNoteModalFromDetail();return false;">New Note</a></div>
<div class="grp">${myNotes.map(n => `<a class="row sm" href="#" onclick="openNoteModal('${n.id}');return false;"><div class="tx"><span class="t" style="font-weight:400">${escapeHtml(n.title || (n.text || '').slice(0, 60))}</span><span class="s">${fmtShortDate(new Date(n.updatedAt || n.createdAt))} · only you can see this</span></div><div class="r">${escapeHtml(({ idea: 'Idea', planned: 'Planned', done: 'Done' })[n.status] || '')}</div></a>`).join('') || '<div class="row sm"><span class="s t-2">No notes yet.</span></div>'}</div>`;
}

// ---- the client page in the new look: the canvas board ClientPage ----
function cpUwGridHtml(c, x){
  const { h, w, owner, next, imps, impStatus, seq, ots, sentAt, holder } = x;
  const pill = (label, js) => `<button class="uw-pill" type="button" onclick="${js}">${escapeHtml(label)}${icon('chevron-right')}</button>`;
  const head = (ic, title, right, count) => `<div class="uw-wh"><span class="uw-ic">${icon(ic)}</span><span class="uw-wt">${title}</span>${count ? `<span class="uw-cnt">${count}</span>` : ''}${right ? `<span class="uw-sp"></span>${right}` : ''}</div>`;
  // this week's update: where it stands, the four steps, what to do
  const names = ['LOGGED', 'DRAFT', 'REVIEW', 'SENT'];
  const done = w.sent ? 4 : w.done >= 3 ? 3 : (w.done === 2 || w.draft) ? 2 : (w.forEmail && w.forEmail.length) ? 1 : 0;
  const state = w.sent ? `Sent ${relDayLower(w.last)}` : clientStageWord(w);
  const detail = w.sent ? (w.note || '') : `${w.forEmail.length ? `${w.forEmail.length} improvement${w.forEmail.length === 1 ? '' : 's'} for the email` : w.logged.length ? INTERNAL_ONLY_NOTE : 'Nothing logged yet'} · ${w.dueText.replace(/^Due /, 'due ')}`;
  const act = w.sent ? '' : `<div class="uw-fa cp-fa">${w.draft ? `<button class="uw-wb" onclick="openReviewDraft('${c.id}',${jsArg(w.draft.author)})">Open draft${icon('arrow-right')}</button>` : `<button class="uw-wb" onclick="openWeekClient('${c.id}')">Open in This Week${icon('arrow-right')}</button>`}${holder && holder !== myName() ? `<button class="uw-pill cp-pl" onclick="remindHolder('${c.id}')">Remind ${escapeHtml(firstName(holder))}</button>` : ''}</div>`;
  // set to "No weekly update" (the agency itself, an internal client): nothing is due (Nov 22)
  const update = w.off ? `<section class="uw-w uw-s6 cp-up">${head('activity', 'This week’s update', '<span class="cp-due">Off</span>')}
<div class="uw-fn"><div class="uw-mono">NO WEEKLY UPDATE</div><h3>No weekly update</h3><p>It stays off This Week, Today, the Queue and Health. Work and hours are still logged here.</p></div>
${canEditClients() ? `<div class="uw-fa cp-fa"><button class="uw-wb" onclick="setWeeklyUpdate('${c.id}',true)">Turn the weekly update on${icon('arrow-right')}</button></div>` : ''}</section>`
  : `<section class="uw-w uw-s6 cp-up">${head('activity', 'This week’s update', `<span class="cp-due${w.late ? ' is-late' : ''}">${escapeHtml(w.sent ? 'Sent' : w.dueText)}</span>`)}
<div class="uw-fn"><div class="uw-mono">${done >= 4 ? 'DONE · SENT' : 'NOW · ' + names[done]}</div><h3>${escapeHtml(state)}</h3><p>${escapeHtml(detail)}</p></div>
${uwSteps(w)}${act}
<div class="cp-ot">${histDotsHtml(seq)}<span>${ots.total ? `On time ${ots.onTime} of ${ots.total}` : 'No updates yet'}</span><b>${sentAt ? 'Last sent ' + escapeHtml(fmtShortDate(sentAt)) : 'None sent yet'}</b></div></section>`;
  // health: the word, why in a line, the last 12 weeks, the one thing to do
  const trail = typeof healthTrailHtml === 'function' && typeof healthTrail === 'function' ? healthTrailHtml(healthTrail(c, h, healthWeeks()), 'cp-tl') : '';
  const hBtn = h.level === 'g' ? '' : next ? `<button class="uw-wb cp-wide" onclick="openTaskDetailModal('${next.id}')">Open next step</button>` : `<button class="uw-wb cp-wide" onclick="planNextStep('${c.id}')">${icon('plus')}Plan next step</button>`;
  const hSub = h.off ? 'It gets no weekly update' : h.level === 'g' ? 'Nothing needs care right now' : `${h.signals.length} reason${h.signals.length === 1 ? '' : 's'} · ${next ? 'next: ' + next.title : 'no next step yet'}`;
  const health = `<section class="uw-w uw-s3 cp-h">${head('heart-pulse', 'Health', h.level === 'g' ? '' : pill('See why', `openHealthClient('${c.id}')`))}
<div class="cp-hb"><div class="cp-word ${h.off ? 'n' : h.level}"><i></i>${escapeHtml(h.off ? 'Not watched' : healthWord(h.level))}</div><div class="uw-bigsub">${escapeHtml(hSub)}</div></div>
${h.off ? '' : trail}${hBtn ? `<div class="cp-hact">${hBtn}${typeof planWithClaudeHtml === 'function' && !h.quiet ? `<div class="cp-claude-row">${planWithClaudeHtml(c.id)}</div>` : ''}</div>` : ''}</section>`;
  // hours this month against the budget, and where it's heading
  const hp = h.hp || {}, used = Math.round(hp.used || 0), bud = hp.budget || 0, over = bud && used > bud;
  const end = new Date(rNow().getFullYear(), rNow().getMonth() + 1, 0);
  const hours = `<section class="uw-w uw-s3 cp-hr">${head('clock', 'Hours this month', pill('Time', `setCdTab('time')`))}
<div class="cp-hb"><div class="uw-big md${over ? ' uw-risk' : ''}">${used}<small>${bud ? `/ ${bud} h` : 'h'}</small></div><div class="uw-bigsub">${bud ? `on pace for ${Math.round(hp.projected || 0)} by ${escapeHtml(fmtShortDate(end))}` : 'No monthly budget set'}</div></div>
${bud ? `<div class="cp-pacew"><div class="cp-pace"><i class="${over || (hp.projected > bud) ? 'is-over' : ''}" style="width:${Math.min(used / bud, 1) * 100}%"></i><em style="left:${Math.min((hp.day || 0) / (hp.dim || 30), 1) * 100}%"></em></div><div class="cp-paces"><span>${escapeHtml(fmtShortDate(new Date(end.getFullYear(), end.getMonth(), 1)))}</span><span>today</span><span>${escapeHtml(fmtShortDate(end))}</span></div></div>` : ''}</section>`;
  // why it's at risk (or what's fine)
  const card = typeof riskCardHtml === 'function' ? riskCardHtml(c, h) : '', ws = card ? h.work.signals : h.signals;   // the work and the flag (Nov 25)
  const sigs = ws.map(sg => `<div class="cp-sig"><span class="cp-si ${sg.l}">${icon(sg.icon)}</span><span class="cp-st"><b>${escapeHtml(sg.title)}</b><span>${escapeHtml(sg.text)}</span></span><span class="cp-since">${escapeHtml((relDay(sg.since).toLowerCase() === 'today' ? 'today' : relDay(sg.since)).toUpperCase())}</span></div>`).join('');
  const why = `<section class="uw-w uw-s4 cp-why">${head('flag', h.level === 'r' ? 'Why it’s at risk' : h.level === 'y' ? 'Why it’s on Watch' : 'Signals', canChangeRules() ? pill('Adjust', `openSettingsTab('updates')`) : '', ws.length || '')}
${card}<div class="cp-l">${sigs || `<p class="uw-none">${icon('check-circle')}Nothing is slipping in the work.</p>`}</div></section>`;
  // the latest improvements
  const impRows = imps.slice(0, 5).map(i => `<div class="cp-imp"><span class="uw-mono">${escapeHtml(fmtShortDate(new Date(i.date)).toUpperCase())}</span><span class="cp-it"><b>${escapeHtml(i.text)}</b><span>${escapeHtml([c.service, i.author ? firstName(i.author) : ''].filter(Boolean).join(' · '))}</span></span><em>${escapeHtml(impStatus(i))}</em></div>`).join('');
  const improvements = `<section class="uw-w uw-s5 cp-imps">${head('circle-check', 'Improvements', waCanWork(c) ? pill('Log', `openQueueLogImprovementModal('${c.id}')`) : '', imps.length || '')}
<div class="cp-l">${impRows || '<p class="uw-none">Nothing logged yet.</p>'}</div>
${imps.length > 5 ? `<a class="uw-foot" href="#" onclick="setCdTab('improvements');return false;">All ${imps.length} improvements${icon('chevron-right')}</a>` : ''}</section>`;
  // details
  const kv = (k, v) => v ? `<div><span>${k}</span><b>${v}</b></div>` : '';
  const ch = typeof winChannel === 'function' ? ({ whatsapp: 'WhatsApp', email: 'Email', both: 'Email and WhatsApp' })[winChannel(c)] : '';
  const site = c.website ? `<a href="${safeUrl(c.website.startsWith('http') ? c.website : 'https://' + c.website)}" target="_blank" rel="noopener">${escapeHtml(c.website.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>` : '';
  const details = `<section class="uw-w uw-s3 cp-det">${head('building-2', 'Details', canEditClients() ? pill('Edit', `openEditClientFormFromDetail()`) : '')}
<div class="cp-kv">${kv('Owner', owner ? escapeHtml(owner) : '—')}${kv('Importance', `${c.importance || 0} of 10`)}${kv('Risk flag', `${c.danger || 0} of 5`)}${kv('Monthly budget', c.monthlyHourBudget ? `${c.monthlyHourBudget} h` : '—')}${kv('Website', site)}${kv('Contact', c.email ? `<a href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a>` : '')}${kv('Sends by', ch)}${c.status !== 'Active' ? kv('Status', escapeHtml(c.status || '—')) : ''}</div></section>`;
  const cnotes = typeof claudeNotesHtml === 'function' ? claudeNotesHtml(c, 'page') : '';   // Claude's notes (claude-plan.js)
  return `<div class="cp-pg">${update}${health}${hours}${cnotes}${why}${improvements}${details}</div>`;
}
