// ---- The work and the flag (Nov 25) ----------------------------------------------------------------
// Health shows two things side by side: the work (updates, logged work, hours, tasks, meetings,
// WhatsApp: clientHealth().work) and the people's read (the Risk flag, and concerns), so a flagged
// client still shows At risk but you see what the team has been doing. week-health.js has the rules
// (riskFlag, openConcerns, riskFacts, flagReview); here are the card and its actions.
//   - Approvers and admins set the Risk with a reason (Set Risk…), review a flag once the work has
//     been healthy for two weeks (Keep It, or Clear Flag), and close concerns (Clear, Put At Risk…).
//   - Anyone on the team raises a concern (Flag a Concern): the client goes on Watch and the approvers
//     are told. Whoever raised it can withdraw it.
// addendum-risk-flags.sql: reasons and reviews (client_danger_history.reason, kind) and concerns.

function riskLead(){ return typeof canApprove === 'function' && canApprove(); }
function riskDay(d){ return d ? fmtShortDate(new Date(d)) : ''; }
// Where a cleared flag goes back to: what it was before it was raised (below 3), else 1
function riskBefore(c){
  const rows = riskRows(c), f = riskFlag(c);
  const i = f ? rows.findIndex(x => x.kind !== 'kept' && x.danger === f.danger) : -1;
  const prev = i >= 0 ? rows.slice(i + 1).find(x => x.kind !== 'kept' && x.danger < 3) : null;
  return prev ? Math.max(1, prev.danger) : 1;
}
function riskRefresh(){ if(typeof renderAll === 'function') renderAll(); else { if(typeof renderHealth === 'function') renderHealth(); if(typeof renderClientPage === 'function') renderClientPage(); } }
// "Flag a Concern" for anyone; approvers and admins set the Risk itself
function riskFlagBtnHtml(c, cls){
  if(!c || (typeof getsUpdates === 'function' && !getsUpdates(c))) return '';
  return riskLead() ? `<button class="${cls || 'btn'}" onclick="event.stopPropagation();openRiskSheet('${c.id}')">${icon('flag')}Set Risk…</button>`
    : `<button class="${cls || 'btn'}" onclick="event.stopPropagation();openConcernSheet('${c.id}')">${icon('flag')}Flag a Concern</button>`;
}

// The card: the work | the flag, the review (approvers), then concerns. compact: no flag and no
// concerns, a single line with the flag button.
function riskCardHtml(c, h){
  if(!c || !h || h.off) return '';
  const lead = riskLead(), me = currentUser ? currentUser.id : null, f = h.flag, cons = h.concerns || [];
  const wl = h.work ? h.work.level : h.level;
  const lv = (l, extra) => `<span class="rk-lv ${l}"><i></i>${escapeHtml(healthWord(l))}${extra ? ` <em>${escapeHtml(extra)}</em>` : ''}</span>`;
  const facts = riskFacts(c, f && f.from ? f.from : null);
  const workLine = wl === 'g' ? `${facts.words.charAt(0).toUpperCase() + facts.words.slice(1)} ${f && f.from ? 'since ' + riskDay(f.from) : 'in the last 30 days'}.`
    : h.work.signals.map(s => s.title).slice(0, 3).join(' · ') + '.';
  if(!f && !cons.length){
    return `<div class="rk is-none"><div class="rk-c"><span class="rk-k">The work</span>${lv(wl)}<span class="rk-s">${escapeHtml(workLine)}</span></div>
<div class="rk-c rk-nof"><span class="rk-k">The flag</span><span class="rk-s">No one has flagged ${escapeHtml(shortClientName(c.name))}.</span>${riskFlagBtnHtml(c, 'btn sm')}</div></div>`;
  }
  const who = riskWho(f && f.by), rv = f ? flagReview(c, h) : null;
  const flagCol = f ? `<div class="rk-c"><span class="rk-k">The flag</span>${lv(f.l, `Risk ${f.danger}`)}<span class="rk-s">${escapeHtml([who ? (who === 'you' ? 'You' : who) : 'Set before Radar kept who', f.at ? riskDay(f.at) : ''].filter(Boolean).join(', '))}${f.reason ? `: “${escapeHtml(f.reason)}”` : ''}${f.keptAt ? `<small>Reviewed and kept by ${escapeHtml(riskWho(f.keptBy) || 'an approver')}, ${escapeHtml(riskDay(f.keptAt))}</small>` : ''}</span></div>`
    : `<div class="rk-c rk-nof"><span class="rk-k">The flag</span><span class="rk-s">No Risk flag.${cons.length ? ' A concern below.' : ''}</span>${lead ? riskFlagBtnHtml(c, 'btn sm') : ''}</div>`;
  let foot = '';
  if(f && lead && rv) foot = `<div class="rk-rv"><div><b>Ready to review</b><span>The work has been healthy for ${daysBetween(rv.from, rNow()) >= 21 ? Math.floor(daysBetween(rv.from, rNow()) / 7) + ' weeks' : 'two weeks'} since the flag: ${escapeHtml(rv.facts.words)}. Still at risk?</span></div>`
    + `<div class="rk-a"><button class="btn" onclick="riskKeep('${c.id}')">Keep It</button><button class="btn btn-p" onclick="riskClear('${c.id}')">Clear Flag</button></div></div>`;
  else if(f && lead) foot = `<div class="rk-a rk-ft"><span>${wl === 'g' ? `If the work stays healthy, Radar asks you to review it ${f.from ? 'around ' + riskDay(addDays(new Date(f.from), FLAG_REVIEW_DAYS)) : 'in two weeks'}.` : 'Radar asks you to review it once the work has been healthy for two weeks.'}</span><button class="btn sm" onclick="openRiskSheet('${c.id}')">Change…</button><button class="btn sm" onclick="riskClear('${c.id}')">Clear Flag</button></div>`;
  else if(f) foot = `<p class="rk-n">${rv ? 'The work has been healthy for two weeks since the flag; an approver reviews it.' : 'Approvers and admins review and clear flags.'}${cons.some(x => x.raisedById === me) ? '' : ` ${riskFlagBtnHtml(c, 'lnk-b')}`}</p>`;
  const conRows = cons.map(x => {
    const mine = me && x.raisedById === me, by = riskWho(x.raisedBy) || 'Someone';
    const acts = lead ? `<button class="btn sm" onclick="concernClose('${x.id}','cleared')">Clear</button><button class="btn sm btn-p" onclick="concernToRisk('${x.id}')">Put At Risk…</button>`
      : mine ? `<button class="btn sm" onclick="concernClose('${x.id}','withdrawn')">Withdraw</button>` : '';
    return `<div class="rk-cn"><span class="rk-lv y"><i></i>Concern</span><span class="rk-s"><b>${escapeHtml(by === 'you' ? 'You' : by)}</b>, ${escapeHtml(riskDay(x.createdAt))}: “${escapeHtml(x.reason)}”</span>${acts ? `<div class="rk-a">${acts}</div>` : ''}</div>`;
  }).join('');
  return `<div class="rk"><div class="rk-cols"><div class="rk-c"><span class="rk-k">The work</span>${lv(wl)}<span class="rk-s">${escapeHtml(workLine)}</span></div>${flagCol}</div>${foot}${conRows}</div>`;
}

// ---- the flag: set (with why), keep, clear --------------------------------------------------------
function openRiskSheet(clientId, o){
  o = o || {};
  const c = clients.find(x => x.id === clientId); if(!c) return;
  if(!riskLead()){ openConcernSheet(clientId); return; }
  const f = riskFlag(c), cur = o.danger || c.danger || 1, h = clientHealth(c);
  const facts = riskFacts(c, f && f.from ? f.from : null);
  window._rkSheet = { clientId, concernId: o.concernId || null, was: c.danger || 0 };
  openAppModal(`<h3>Risk for ${escapeHtml(c.name)}</h3>
<p class="t-2 rk-sub">Your read on how likely they are to leave. At 3 Health puts the client on Watch; at 4 or 5, At risk, until you or another approver clears it.</p>
<div class="f">
<label for="rkLevel">Risk</label><div>${sheetPop('rkLevel', 'Risk', [['1', '1 · Low'], ['2', '2'], ['3', '3 · Watch'], ['4', '4 · At risk'], ['5', '5 · High']], String(cur), 'rkSheetSync()')}</div>
<label for="rkWhy">Why</label><div><input id="rkWhy" class="tf" maxlength="500" autocomplete="off" placeholder="What makes it risky, in a line" value="${escapeHtml(o.reason || (f && f.reason) || '')}"></div>
<span></span><div class="rk-sw"><b>The work</b>: ${escapeHtml(healthWord(h.work.level))}. ${escapeHtml(facts.words.charAt(0).toUpperCase() + facts.words.slice(1))} in the last ${f && f.from ? 'days since the flag' : '30 days'}.</div>
</div>
<div class="sheet-a"><button class="btn" onclick="closeAppModal()">Cancel</button><button class="btn btn-p" id="rkSave" onclick="saveRiskSheet()">Save</button></div>`, 480);
  rkSheetSync();
  setTimeout(() => document.getElementById(o.reason || !(f && f.reason) ? 'rkWhy' : 'rkLevel')?.focus(), 30);
}
function rkSheetSync(){
  const s = window._rkSheet; if(!s) return;
  const v = Number(document.getElementById('rkLevel')?.value || 1), b = document.getElementById('rkSave');
  if(b) b.textContent = v < 3 && s.was >= 3 ? 'Clear Flag' : v >= 3 ? 'Flag' : 'Save';
}
async function saveRiskSheet(){
  const s = window._rkSheet; if(!s) return;
  const c = clients.find(x => x.id === s.clientId); if(!c) return;
  const v = Number(document.getElementById('rkLevel')?.value || 1), why = (document.getElementById('rkWhy')?.value || '').trim(), was = c.danger || 0;
  if(v < was && !canLowerDangerScore()){ showToast('error', 'Not allowed', 'Only approvers and admins can lower a client’s Risk.'); return; }
  if(v >= 3 && !why){ showToast('error', 'Say why', `Risk ${v} shows on Health with the reason. One line is enough.`); document.getElementById('rkWhy')?.focus(); return; }
  const f = riskFlag(c);
  if(v === was && (!f || why === f.reason) && !s.concernId){ closeAppModal(); return; }
  const btn = document.getElementById('rkSave'); if(btn){ btn.disabled = true; btn.textContent = 'Saving…'; }
  if(v !== was){
    const ok = await updateClientRow(c.id, { danger: v });
    if(!ok){ if(btn){ btn.disabled = false; rkSheetSync(); } showToast('error', 'Not saved', 'Try again in a moment.'); return; }
    c.danger = v;
  }
  // a new reason at the same level is a new flag: its two weeks start again
  await logDangerHistory(c.id, v, was, v >= 3 ? why : (why || (was >= 3 ? 'Cleared' : '')));
  if(s.concernId) await concernClose(s.concernId, 'flagged', true);
  if(typeof logClientActivity === 'function') logClientActivity(c.id, 'client_updated', `${myName() || 'Someone'} set the Risk to ${v} of 5${why ? `: “${why}”` : ''}.`);
  closeAppModal(); window._rkSheet = null;
  riskRefresh();
  showToast('success', v >= 3 ? (v >= 4 ? `${c.name} is flagged At risk` : `${c.name} is on Watch`) : was >= 3 ? 'Flag cleared' : 'Risk saved',
    v >= 3 ? 'Health shows it beside the work, with your reason.' : was >= 3 ? 'Health goes by the work again.' : '');
}
async function riskKeep(clientId){
  const c = clients.find(x => x.id === clientId), f = c && riskFlag(c); if(!f) return;
  if(!riskLead()){ showToast('error', 'Not allowed', 'Approvers and admins review flags.'); return; }
  await logDangerHistory(c.id, f.danger, f.danger, f.reason, 'kept');
  if(typeof logClientActivity === 'function') logClientActivity(c.id, 'client_updated', `${myName() || 'Someone'} reviewed the Risk flag and kept it at ${f.danger} of 5.`);
  riskRefresh();
  showToast('success', 'Flag kept', `Radar asks again in two weeks if the work stays healthy.`);
}
async function riskClear(clientId){
  const c = clients.find(x => x.id === clientId), f = c && riskFlag(c); if(!f) return;
  if(!canLowerDangerScore()){ showToast('error', 'Not allowed', 'Only approvers and admins clear a flag.'); return; }
  const to = riskBefore(c), h = clientHealth(c);
  if(!(await confirmDialog(`Clear the flag on ${c.name}? Its Risk goes back to ${to} of 5, and Health goes by the work (${healthWord(h.work.level).toLowerCase()} now).`, { title: 'Clear Flag?', confirmLabel: 'Clear Flag' }))) return;
  const was = c.danger;
  const ok = await updateClientRow(c.id, { danger: to });
  if(!ok){ showToast('error', 'Not cleared', 'Try again in a moment.'); return; }
  c.danger = to;
  await logDangerHistory(c.id, to, was, 'Cleared');
  if(typeof logClientActivity === 'function') logClientActivity(c.id, 'client_updated', `${myName() || 'Someone'} cleared the Risk flag (${was} to ${to} of 5).`);
  riskRefresh();
  showToast('success', 'Flag cleared', `${c.name}’s Health goes by the work again.`);
}

// ---- concerns: anyone raises one; approvers close it -------------------------------------------
const RISK_SQL = 'Concerns need a one-time database update: an admin runs addendum-risk-flags.sql in Supabase → SQL Editor.';
function openConcernSheet(clientId){
  const c = clients.find(x => x.id === clientId); if(!c) return;
  if(typeof clientConcernsReady !== 'undefined' && clientConcernsReady === false){ showToast('info', 'Not on yet', RISK_SQL); return; }
  window._ccSheet = { clientId };
  openAppModal(`<h3>Flag a Concern</h3>
<p class="t-2 rk-sub">About ${escapeHtml(c.name)}. It puts the client on Watch and tells the approvers; they decide whether it’s At risk.</p>
<div class="f"><label class="top" for="ccWhy">What’s the concern?</label><textarea id="ccWhy" class="tf" style="height:84px" maxlength="500" spellcheck="true" placeholder="What you saw or heard, in a line or two"></textarea></div>
<div class="sheet-a"><button class="btn" onclick="closeAppModal()">Cancel</button><button class="btn btn-p" id="ccSave" onclick="saveConcern()">Flag Concern</button></div>`, 460);
  setTimeout(() => document.getElementById('ccWhy')?.focus(), 30);
}
async function saveConcern(){
  const s = window._ccSheet; if(!s) return;
  const c = clients.find(x => x.id === s.clientId); if(!c) return;
  const why = (document.getElementById('ccWhy')?.value || '').trim();
  if(!why){ showToast('error', 'Say what it is', 'One line is enough.'); document.getElementById('ccWhy')?.focus(); return; }
  const btn = document.getElementById('ccSave'); if(btn){ btn.disabled = true; btn.textContent = 'Flagging…'; }
  const me = myName() || 'Someone';
  const { data, error } = await supabaseClient.from('client_concerns').insert({ client_id: c.id, reason: why.slice(0, 500), raised_by: me, raised_by_id: currentUser.id }).select().single();
  if(error || !data){
    if(btn){ btn.disabled = false; btn.textContent = 'Flag Concern'; }
    showToast('error', 'Not flagged', /client_concerns|PGRST205|42P01|schema cache/i.test(`${error && error.code} ${error && error.message}`) ? RISK_SQL : ((error && error.message) || 'Try again in a moment.'));
    return;
  }
  // the server's clock can run a little ahead of this one: never in the future here, or Health would skip it until then
  clientConcerns.push({ id: data.id, clientId: c.id, reason: data.reason, raisedBy: me, raisedById: currentUser.id, createdAt: new Date(Math.min(Date.parse(data.created_at) || Date.now(), Date.now())), resolvedAt: null, resolvedBy: '', outcome: null });
  if(typeof logClientActivity === 'function') logClientActivity(c.id, 'client_updated', `${me} flagged a concern: “${why.slice(0, 120)}”`);
  // the approvers and admins hear about it (not whoever raised it)
  const leads = (typeof teamProfiles !== 'undefined' ? teamProfiles : []).filter(p => (p.role === 'admin' || p.role === 'approver') && !p.access_revoked && p.id !== currentUser.id);
  if(typeof sendNotification === 'function') leads.forEach(p => sendNotification(p.id, 'client_concern', `${shortClientName(c.name)}: a concern from ${firstName(me)}`, `“${why.slice(0, 200)}” It’s on Watch until you put it At risk or clear it.`, 'health', c.id));
  closeAppModal(); window._ccSheet = null;
  riskRefresh();
  showToast('success', 'Concern flagged', `${c.name} is on Watch, and the approvers were told.`);
}
async function concernClose(id, outcome, quiet){
  const x = clientConcerns.find(k => k.id === id); if(!x) return;
  if(outcome !== 'withdrawn' && !riskLead()){ showToast('error', 'Not allowed', 'Approvers and admins close concerns.'); return; }
  const me = myName() || 'Someone', at = new Date();
  const { data, error } = await supabaseClient.from('client_concerns').update({ resolved_at: at.toISOString(), resolved_by: me, outcome }).eq('id', id).select('id');
  if(error || !data || !data.length){ if(!quiet) showToast('error', 'Not changed', (error && error.message) || 'Try again in a moment.'); return; }
  Object.assign(x, { resolvedAt: at, resolvedBy: me, outcome });
  const c = clients.find(k => k.id === x.clientId);
  if(c && typeof logClientActivity === 'function') logClientActivity(c.id, 'client_updated', `${me} ${outcome === 'withdrawn' ? 'withdrew' : outcome === 'flagged' ? 'turned into a Risk flag' : 'cleared'} the concern “${x.reason.slice(0, 80)}”.`);
  if(outcome !== 'withdrawn' && x.raisedById && x.raisedById !== currentUser.id && typeof sendNotification === 'function' && c)
    sendNotification(x.raisedById, 'client_concern_closed', `${shortClientName(c.name)}: your concern was ${outcome === 'flagged' ? 'flagged At risk' : 'cleared'}`, `${firstName(me)} ${outcome === 'flagged' ? 'flagged the client At risk' : 'cleared it'}: “${x.reason.slice(0, 160)}”`, 'health', c.id);
  if(quiet) return;
  riskRefresh();
  showToast('success', outcome === 'withdrawn' ? 'Concern withdrawn' : 'Concern cleared', c ? `${c.name}’s Health goes by the work${riskFlag(c) ? ' and its flag' : ''}.` : '');
}
function concernToRisk(id){
  const x = clientConcerns.find(k => k.id === id); if(!x) return;
  const c = clients.find(k => k.id === x.clientId); if(!c) return;
  openRiskSheet(c.id, { concernId: id, danger: Math.max(4, c.danger || 0), reason: x.reason });
}
