// Reminders, as on its canvas board.

// Tasks moved to tasks-canvas.js (the columns and the task panel).

// ---- Reminders: questions waiting on clients (canvas RemindersNew) ------------------------
// Due, Waiting on the client, Answered this week: no boxes, how long each question has waited,
// and one clear action (Nudge) only where a follow-up is due.
let remTab = 'open', remClient = 'all', remWho = 'all';
function setRem(k, v){ if(k === 'tab') remTab = v; if(k === 'client') remClient = v; if(k === 'who') remWho = v; renderReminders(); }
function remDay(v){ return new Date(v + 'T12:00:00'); }
function remWhen(r){
  const today = toDateStr(new Date());
  if(!r.followUpDate) return ['No follow-up date', false];
  if(r.followUpDate === today) return ['Follow up today', true];
  if(r.followUpDate === toDateStr(addDays(new Date(), -1))) return ['Follow up yesterday', true];
  if(r.followUpDate < today) return [`Follow up ${fmtShortDate(remDay(r.followUpDate))}`, true];
  const k = daysBetween(dayStart(new Date()), remDay(r.followUpDate));
  return [`Follow up ${k === 1 ? 'tomorrow' : k < 7 ? DAY_NAMES[remDay(r.followUpDate).getDay()].slice(0, 3) : fmtShortDate(remDay(r.followUpDate))}`, false];
}
function remWaited(from, to){ const n = Math.max(0, daysBetween(remDay(from), to ? dayStart(new Date(to)) : dayStart(new Date()))); return `${n} day${n === 1 ? '' : 's'}`; }
function remRowHtml(r, primary){
  const c = clients.find(x => x.id === r.clientId), who = (teamProfiles.find(p => p.id === r.askedBy) || {}).name || 'Someone';
  const asked = r.askedDate ? fmtShortDate(remDay(r.askedDate)) : '';
  const open = r.status === 'waiting', due = open && reminderDisplayStatus(r) === 'due';
  let right, cb, act = '<span class="rmi-sp"></span>';
  if(open){
    const [when, late] = remWhen(r);
    right = `<span class="rmi-when${late ? ' is-late' : ''}">${when}</span><span class="rmi-d">${r.askedDate ? 'waiting ' + remWaited(r.askedDate) : ''}</span>`;
    cb = `<button class="cb rem" role="checkbox" aria-checked="false" aria-label="Mark answered" title="Mark answered" onclick="event.stopPropagation();checkOff(this, () => markReminderStatus('${r.id}','answered'))"></button>`;
    if(due) act = `<button class="btn${primary ? ' btn-p' : ''}" onclick="event.stopPropagation();nudgeReminder('${r.id}')">${icon('paper-plane-tilt')}Nudge</button>`;
  } else {
    const at = r.resolvedAt ? fmtShortDate(new Date(r.resolvedAt)) : '';
    right = `<span class="rmi-when">${r.status === 'answered' ? 'Answered' : 'Closed'} ${at}</span><span class="rmi-d">${r.askedDate && r.resolvedAt ? 'in ' + remWaited(r.askedDate, r.resolvedAt) : ''}</span>`;
    cb = `<span class="cb rem${r.status === 'answered' ? ' done' : ' closed'}" role="img" aria-label="${r.status === 'answered' ? 'Answered' : 'Closed'}">${r.status === 'answered' ? icon('check', { weight: 'bold' }) : icon('x', { weight: 'bold' })}</span>`;
  }
  return `<div class="rmi-r${open ? '' : ' is-done'}" role="button" tabindex="0" onclick="openReminderDetailModal('${r.id}')" onkeydown="if(event.key==='Enter'&&event.target===this)openReminderDetailModal('${r.id}')">${cb}${c ? monoHtml(c, 'sm') : ''}
<div class="tx"><b>${escapeHtml(r.question)}</b><span class="s">${escapeHtml(c ? c.name : '')} · ${escapeHtml(firstName(who))} asked ${escapeHtml(asked)}</span></div>
<div class="rmi-w">${right}</div>${act}</div>`;
}
function renderReminders(){
  const root = document.getElementById('remindersRoot');
  if(typeof updateRemindersNavBadge === 'function') updateRemindersNavBadge();
  if(!root || typeof clientReminders === 'undefined') return;
  const everyone = seesEveryone(), base = everyone ? clientReminders : clientReminders.filter(r => r.askedBy === currentUser?.id);
  if(!everyone) remWho = 'all';
  let rs = base.slice();
  if(remClient !== 'all') rs = rs.filter(r => r.clientId === remClient);
  if(remWho !== 'all') rs = rs.filter(r => r.askedBy === remWho);
  const byFu = (a, b) => (a.followUpDate || '9999').localeCompare(b.followUpDate || '9999') || (a.askedDate || '').localeCompare(b.askedDate || '');
  const byDone = (a, b) => new Date(b.resolvedAt || 0) - new Date(a.resolvedAt || 0);
  const open = rs.filter(r => r.status === 'waiting'), answered = rs.filter(r => r.status === 'answered').sort(byDone), closed = rs.filter(r => r.status === 'closed').sort(byDone);
  const due = open.filter(r => reminderDisplayStatus(r) === 'due').sort(byFu), waiting = open.filter(r => reminderDisplayStatus(r) !== 'due').sort(byFu);
  const weekAgo = addDays(rNow(), -7), recent = answered.filter(r => r.resolvedAt && new Date(r.resolvedAt) >= weekAgo);
  const sec = (t, list, cls) => list.length ? `<div class="rmi-sec${cls ? ' ' + cls : ''}"><b>${t}</b><span>${list.length}</span></div>${list.map((r, i) => remRowHtml(r, cls === 'is-due' && i === 0)).join('')}` : '';
  let main;
  if(remTab === 'open') main = sec('Due', due, 'is-due') + sec('Waiting on the client', waiting) + sec('Answered this week', recent);
  else main = sec(remTab === 'answered' ? 'Answered' : 'Closed', remTab === 'answered' ? answered : closed);
  if(!main) main = remTab === 'open'
    ? `<div class="empty rmi-empty"><b>Nothing is waiting on clients</b>When you ask a client something, add it here so the team knows you’re waiting on an answer.</div>`
    : `<div class="empty rmi-empty"><b>Nothing ${remTab === 'answered' ? 'answered' : 'closed'} yet</b></div>`;
  const usedClients = [...new Set(base.map(r => r.clientId))].map(id => clients.find(c => c.id === id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  const askers = [...new Set(clientReminders.map(r => r.askedBy))].map(id => teamProfiles.find(p => p.id === id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  const curC = usedClients.find(c => c.id === remClient), curW = askers.find(p => p.id === remWho);
  const all = base.filter(r => (remClient === 'all' || r.clientId === remClient) && (remWho === 'all' || r.askedBy === remWho));
  const n = k => all.filter(r => r.status === k).length;
  root.innerHTML = `<div class="rmi">
<div class="rmi-hd"><div><h2>${due.length ? `${due.length} follow-up${due.length === 1 ? ' is' : 's are'} due` : 'No follow-ups are due'}</h2><p>${everyone ? 'Questions your team asked clients, and when to chase them.' : 'Questions you asked clients, and when to chase them.'}</p></div>
<div class="rmi-f"><div class="seg" role="tablist" aria-label="Show">${[['open', 'Waiting', n('waiting')], ['answered', 'Answered', n('answered')], ['closed', 'Closed', n('closed')]].map(([k, t, c]) => `<button class="${remTab === k ? 'on' : ''}" role="tab" aria-selected="${remTab === k}" onclick="setRem('tab','${k}')">${t} <span class="c">${c}</span></button>`).join('')}</div>
<label class="pop pop-sel"><span class="pl">Client: ${escapeHtml(curC ? curC.name : 'All')}</span>${icon('caret-down')}<select aria-label="Client" onchange="setRem('client',this.value)"><option value="all">All</option>${usedClients.map(c => `<option value="${c.id}"${c === curC ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select></label>
${everyone ? `<label class="pop pop-sel"><span class="pl">${escapeHtml(curW ? curW.name : 'Everyone')}</span>${icon('caret-down')}<select aria-label="Asked by" onchange="setRem('who',this.value)"><option value="all">Everyone</option>${askers.map(p => `<option value="${p.id}"${p === curW ? ' selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}</select></label>` : ''}</div></div>
${main}</div>`;
  if(currentViewName === 'reminders') setToolbar(null, 'Client follow-ups');
}
// Nudge: open a short follow-up email to the client and move the next follow-up three days out.
async function nudgeReminder(id){
  const r = clientReminders.find(x => x.id === id); if(!r) return;
  const c = clients.find(x => x.id === r.clientId);
  const asked = r.askedDate ? remDay(r.askedDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) : '';
  const body = `Hi,\n\nJust following up on my question${asked ? ` from ${asked}` : ''}:\n\n${r.question}\n\nThanks,\n${firstName(myName() || '')}`;
  if(c && c.email){
    const a = document.createElement('a');
    a.href = `mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent('Following up: ' + r.question)}&body=${encodeURIComponent(body)}`;
    a.click();
  } else {
    try{ await navigator.clipboard.writeText(body); }catch(e){}
  }
  const next = toDateStr(addDays(new Date(), 3));
  const { error } = await supabaseClient.from('client_reminders').update({ follow_up_date: next }).eq('id', id);
  if(error){ showToast('error', 'Follow-up date not moved', error.message); return; }
  await loadClientReminders();
  renderReminders();
  const day = remDay(next).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  showToast('success', c && c.email ? 'Nudge ready in your mail app' : 'Nudge copied', `${c && c.email ? '' : `No email on file for ${c ? c.name : 'this client'}, so the message is on your clipboard. `}Next follow-up ${day}.`);
  if(c) logClientActivity(r.clientId, 'reminder_nudged', `${myName() || 'Someone'} nudged ${c.name} about "${r.question.length > 80 ? r.question.slice(0, 80) + '…' : r.question}".`);
}

// Notes moved to notes-canvas.js (the gallery and the note sheet).
