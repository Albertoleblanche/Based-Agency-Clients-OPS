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
  setToolbar(c.name, 'All Clients');
  const h = clientHealth(c), w = clientWeek(c), owner = clientOwner(c), cyc = updateCycle(), next = nextStepTask(c);
  const myNotes = (typeof notes !== 'undefined' ? notes : []).filter(n => n.clientId === c.id);
  const start = c.startDate ? new Date(c.startDate + 'T12:00:00') : null;
  const tabs = [['overview', 'Overview', ''], ['improvements', 'Improvements', (c.improvements || []).length], ['time', 'Time', ''], ['notes', 'Notes', myNotes.length], ['activity', 'Activity', '']]
    .map(([k, t, n]) => `<button class="${cdTab === k ? 'on' : ''}" role="tab" aria-selected="${cdTab === k}" onclick="setCdTab('${k}')">${t}${n !== '' && n ? ` <span class="c">${n}</span>` : ''}</button>`).join('');
  let callout = '';
  if(h.level !== 'g'){
    callout = `<div class="next" style="margin-top:20px"><span class="sig ${h.level}">${icon(h.level === 'r' ? 'warning' : 'eye')}</span>
<div class="tx"><b>${healthWord(h.level)} since ${relDay(h.since || rNow()).toLowerCase() === 'today' ? 'today' : relDay(h.since || rNow())}${next ? '' : ' — no next step yet'}</b><span>${escapeHtml(h.signals.map(s => s.title.charAt(0).toUpperCase() + s.title.slice(1)).join(' · '))}</span></div>
<button class="btn" onclick="openHealthClient('${c.id}')">See Why</button>${next ? `<button class="btn" onclick="openTaskDetailModal('${next.id}')">Open Next Step</button>` : `<button class="btn btn-p" onclick="planNextStep('${c.id}')">${icon('plus')}Plan Next Step</button>`}</div>`;
  }
  top.innerHTML = `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:16px">
<span class="mono" style="width:56px;height:56px;border-radius:14px;font-size:18px" aria-hidden="true">${escapeHtml(clientMono(c))}</span>
<div style="min-width:0"><h1 class="lt">${escapeHtml(c.name)}</h1><p class="lt-sub" style="margin-top:4px">${escapeHtml([c.service, c.status !== 'Active' ? c.status : '', start ? 'client since ' + start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : ''].filter(Boolean).join(' · '))}</p></div>
<span style="flex:1"></span><div class="seg" role="tablist" aria-label="Client sections">${tabs}</div></div>
${callout}`;
  document.querySelectorAll('#cdRoot .cd-tab').forEach(t => { t.hidden = t.dataset.tab !== cdTab; });

  // ---- Overview
  const pts = [cyc.checkpoints.log, cyc.checkpoints.review, cyc.checkpoints.approve, cyc.checkpoints.send];
  const hr = t => t.getMinutes() ? fmtTime(t) : t.toLocaleTimeString('en-US', { hour: 'numeric' });
  const stepTxt = [`${w.logged.length} improvement${w.logged.length === 1 ? '' : 's'}`,
    w.done > 1 ? 'Sent for review' : `Due ${fmtDay(pts[1])} ${hr(pts[1])}${w.draft && w.done === 1 ? ' · waiting on ' + firstName(w.draft.author) : ''}`,
    w.done > 2 ? 'Approved' : `By ${fmtDay(pts[2])} ${hr(pts[2])}`, w.sent ? `Sent ${relDay(w.draft.draftSentAt).toLowerCase()}` : `${fmtDay(pts[3])} ${fmtTime(pts[3])}`];
  const stepper = STEP_NAMES.map((n, k) => {
    const cls = w.sent ? 's d' : k < w.done ? 'd' : (w.behind === k ? 'b' : '');
    const mark = (w.sent || k < w.done) ? icon('check', { weight: 'bold' }) : (w.behind === k ? icon('exclamation-mark', { weight: 'bold' }) : '');
    return `<div class="stp ${cls}"><span class="m">${mark}</span><b>${n}</b><span>${escapeHtml(stepTxt[k])}</span></div>`;
  }).join('');
  const holder = w.holder && w.holder !== 'approvers' ? w.holder : owner;
  const weekBtns = w.sent ? '' : `<div style="display:flex;gap:8px;margin-top:16px">${w.draft ? `<button class="btn" onclick="openReviewDraft('${c.id}',${jsArg(w.draft.author)})">${icon('envelope-open')}Open Draft</button>` : `<button class="btn" onclick="openWeekClient('${c.id}')">${icon('layers')}Open in This Week</button>`}${holder && holder !== myName() ? `<button class="btn" onclick="remindHolder('${c.id}')">Remind ${escapeHtml(firstName(holder))}</button>` : ''}</div>`;
  const imps = (c.improvements || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  const sentAt = lastSentAt(c);
  const impStatus = i => i.includeInEmail === false ? 'Internal' : (w.draft && (w.draft.draftImprovementIds || []).includes(i.id) ? 'In this week’s draft' : (sentAt && new Date(i.date) <= sentAt ? 'In the ' + fmtShortDate(sentAt) + ' update' : 'Not sent yet'));
  const impRows = (list) => list.map(i => `<div class="row sm"><span style="width:52px;flex:0 0 auto;font-size:12px;color:var(--label-2)">${fmtShortDate(new Date(i.date))}</span>
<div class="tx"><span class="t" style="font-weight:400">${escapeHtml(i.text)}</span><span class="s">${escapeHtml([c.service, i.author].filter(Boolean).join(' · '))}</span></div><div class="r">${impStatus(i)}</div></div>`).join('');
  const seq = h.seq, ots = onTimeSummary(seq);
  const kv = (k, v) => `<div class="kv"><span>${k}</span><b style="font-weight:500">${v}</b></div>`;
  const cf = (settings.customFields || []).filter(f => (c.customFieldValues || {})[f.id]).map(f => kv(escapeHtml(f.label || f.name || 'Field'), escapeHtml(String(c.customFieldValues[f.id])))).join('');
  document.getElementById('cdOverviewMain').innerHTML = `
<div class="h2"><h2>This week’s update</h2><span class="t-2" style="font-size:12px">Sends ${fmtDay(cyc.send)} ${fmtTime(cyc.send)}</span></div>
<div class="panel" style="padding:18px 18px 16px"><div class="stepper">${stepper}</div>${weekBtns}</div>
${h.signals.length ? `<div class="h2"><h2>${h.level === 'r' ? 'Why it’s at risk' : 'Why it’s on Watch'}<span class="c">${h.signals.length}</span></h2><a href="#settings" onclick="openSettingsTab('updates');return false;">Adjust signals</a></div><div class="grp">${signalRowsHtml(h)}</div>` : ''}
<div class="h2"><h2>Improvements<span class="c">${imps.length}</span></h2><a href="#" onclick="openQueueLogImprovementModal('${c.id}');return false;">Log Improvement</a></div>
<div class="grp">${impRows(imps.slice(0, 6)) || '<div class="row sm"><span class="s t-2" style="font-size:12px">Nothing logged yet.</span></div>'}</div>
${imps.length > 6 ? `<p style="margin:8px 2px 0"><a class="btn btn-q sm" href="#" onclick="setCdTab('improvements');return false;">All ${imps.length} improvements</a></p>` : ''}`;
  document.getElementById('cdOverviewSide').innerHTML = `
<section class="panel"><h3>Hours this month<span>${h.hp.budget ? `<b class="${h.hp.used > h.hp.budget ? 't-red' : ''}" style="font-weight:600">${Math.round(h.hp.used)}</b> of ${h.hp.budget}` : Math.round(h.hp.used) + ' h'}</span></h3>${h.hp.budget ? paceChartHtml(c, 300, 140) : '<p class="t-2" style="font-size:12px;margin:0">No monthly budget set.</p>'}</section>
<section class="panel"><h3>Weekly updates<span>${ots.total ? `On time ${ots.onTime} of ${ots.total}` : ''}</span></h3><div style="display:flex;align-items:center;justify-content:space-between;font-size:12px">${histDotsHtml(seq)}<span class="t-2">${sentAt ? 'Last sent ' + fmtShortDate(sentAt) : 'None sent yet'}</span></div></section>
<section class="panel"><h3>Details${canApprove() ? `<span><a href="#" onclick="openEditClientFormFromDetail();return false;" style="color:var(--label);font-weight:500">Edit</a></span>` : ''}</h3>
${kv('Status', escapeHtml(c.status || '—'))}${kv('Importance', `${c.importance || 0} of 10`)}${kv('Risk flag', `${c.danger || 0} of 5`)}
${kv('Monthly budget', c.monthlyHourBudget ? `${c.monthlyHourBudget} hours` : '—')}
<div class="kv"><span>Owner</span><span style="display:inline-flex;align-items:center;gap:6px;color:var(--label)">${owner ? avHtml(owner) + escapeHtml(owner) : '—'}</span></div>
${c.website ? `<div class="kv"><span>Website</span><a href="${safeUrl(c.website.startsWith('http') ? c.website : 'https://' + c.website)}" target="_blank" rel="noopener" style="font-weight:500">${escapeHtml(c.website.replace(/^https?:\/\//, ''))}</a></div>` : ''}
${c.email ? `<div class="kv"><span>Contact</span><a href="mailto:${escapeHtml(c.email)}" style="font-weight:500">${escapeHtml(c.email)}</a></div>` : ''}
${cf}</section>
${c.sow ? `<section class="panel"><h3>Scope</h3><p style="margin:0;font-size:13px;line-height:1.55">${escapeHtml(c.sow)}</p></section>` : ''}`;

  // ---- other tabs
  document.getElementById('cdImpTab').innerHTML = `<div class="h2"><h2>Improvements<span class="c">${imps.length}</span></h2><a href="#" onclick="openQueueLogImprovementModal('${c.id}');return false;">Log Improvement</a></div>
<div class="grp">${imps.map(i => { const idx = c.improvements.indexOf(i); return impRows([i]).replace('</div></div>', `${canApprove() || i.author === myName() ? `<button class="ib act" title="Edit" aria-label="Edit" onclick="startEditImprovement('${c.id}',${idx})">${icon('pencil-simple')}</button><button class="ib act" title="Delete" aria-label="Delete" onclick="deleteImprovement('${c.id}',${idx})">${icon('trash')}</button>` : ''}</div></div>`); }).join('') || '<div class="row sm"><span class="s t-2">Nothing logged yet.</span></div>'}</div>`;
  const entries = (typeof timeEntries !== 'undefined' ? timeEntries : []).filter(e => e.clientId === c.id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60);
  const total = entries.reduce((s, e) => s + e.minutes, 0);
  document.getElementById('cdTimeTab').innerHTML = `<div class="h2"><h2>Time<span class="c">${Math.round(total / 6) / 10} h</span></h2><a href="#" onclick="openTimerModal('${c.id}');return false;">Track Time</a></div>
<div class="grp">${entries.map(e => { const p = teamProfiles.find(x => x.id === e.userId); return `<div class="row sm"><span style="width:52px;flex:0 0 auto;font-size:12px;color:var(--label-2)">${fmtShortDate(new Date(e.date + 'T12:00:00'))}</span><div class="tx"><span class="t" style="font-weight:400">${escapeHtml(e.description || 'Time logged')}</span><span class="s">${escapeHtml([e.service, p?.name].filter(Boolean).join(' · '))}</span></div><div class="r"><span class="dur">${Math.floor(e.minutes / 60)}:${String(e.minutes % 60).padStart(2, '0')}</span></div></div>`; }).join('') || '<div class="row sm"><span class="s t-2">No time logged yet.</span></div>'}</div>`;
  const rems = (typeof clientReminders !== 'undefined' ? clientReminders : []).filter(r => r.clientId === c.id && r.status !== 'answered');
  document.getElementById('cdNotesTab').innerHTML = `<div class="h2"><h2>Waiting on the client<span class="c">${rems.length}</span></h2><a href="#" onclick="openNewReminderModal('${c.id}');return false;">New Reminder</a></div>
<div class="grp">${rems.map(r => `<a class="row sm" href="#" onclick="openReminderDetailModal('${r.id}');return false;"><div class="tx"><span class="t" style="font-weight:400">${escapeHtml(r.question)}</span><span class="s">Asked ${fmtShortDate(new Date(r.askedDate + 'T12:00:00'))}${r.followUpDate ? ' · follow up ' + fmtShortDate(new Date(r.followUpDate + 'T12:00:00')) : ''}</span></div><div class="r">${reminderDisplayStatus(r) === 'due' ? '<span class="t-red">Follow-up due</span>' : 'Waiting'}</div></a>`).join('') || '<div class="row sm"><span class="s t-2">Nothing waiting on the client.</span></div>'}</div>
<div class="h2"><h2>My notes<span class="c">${myNotes.length}</span></h2><a href="#" onclick="openNoteModalFromDetail();return false;">New Note</a></div>
<div class="grp">${myNotes.map(n => `<a class="row sm" href="#" onclick="openNoteModal('${n.id}');return false;"><div class="tx"><span class="t" style="font-weight:400">${escapeHtml(n.title || (n.text || '').slice(0, 60))}</span><span class="s">${fmtShortDate(new Date(n.updatedAt || n.createdAt))} · only you can see this</span></div><div class="r">${escapeHtml(({ idea: 'Idea', planned: 'Planned', done: 'Done' })[n.status] || '')}</div></a>`).join('') || '<div class="row sm"><span class="s t-2">No notes yet.</span></div>'}</div>`;
}
