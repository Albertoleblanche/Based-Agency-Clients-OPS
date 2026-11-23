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
  let right, act = '<span class="rmi-sp"></span>';
  if(open){
    const [when, late] = remWhen(r);
    right = `<span class="rmi-when${late ? ' is-late' : ''}">${when}</span><span class="rmi-d">${r.askedDate ? 'waiting ' + remWaited(r.askedDate) : ''}</span>`;
    if(due) act = `<button class="btn${primary ? ' btn-p' : ''}" onclick="event.stopPropagation();nudgeReminder('${r.id}')">${icon('sparkle')}Nudge</button>`;
  } else {
    const at = r.resolvedAt ? fmtShortDate(new Date(r.resolvedAt)) : '';
    right = `<span class="rmi-when">${r.status === 'answered' ? 'Answered' : 'Closed'} ${at}</span><span class="rmi-d">${r.askedDate && r.resolvedAt ? 'after ' + remWaited(r.askedDate, r.resolvedAt) : ''}</span>`;
  }
  return `<div class="rmi-r${open ? '' : ' is-done'}${window._remSel === r.id ? ' is-sel' : ''}" role="button" tabindex="0" onclick="selectReminder('${r.id}')" onkeydown="if((event.key==='Enter'||event.key===' ')&&event.target===this){event.preventDefault();selectReminder('${r.id}')}">${remCb(r)}
<div class="tx"><b>${escapeHtml(r.question)}</b><span class="s">${escapeHtml(c ? c.name : '')}${focusMark(c)} · ${escapeHtml(firstName(who))} asked ${escapeHtml(asked)}</span></div>
<div class="rmi-w">${right}</div>${act}</div>`;
}
// The circle: ticks a question answered (with the same little check as everywhere else), or shows
// how it ended.
function remCb(r, cls){
  const k = cls ? ' ' + cls : '';
  if(r.status === 'waiting') return `<button class="cb rem${k}" role="checkbox" aria-checked="false" aria-label="Mark answered" onclick="event.stopPropagation();checkOff(this, () => markReminderStatus('${r.id}','answered'))"></button>`;
  return `<span class="cb rem${r.status === 'answered' ? ' done' : ' closed'}${k}" role="img" aria-label="${r.status === 'answered' ? 'Answered' : 'Closed'}">${r.status === 'answered' ? icon('check', { weight: 'bold' }) : icon('x', { weight: 'bold' })}</span>`;
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
  const byFu = (a, b) => focusIdFirst(a.clientId, b.clientId) || (a.followUpDate || '9999').localeCompare(b.followUpDate || '9999') || (a.askedDate || '').localeCompare(b.askedDate || '');
  const byDone = (a, b) => new Date(b.resolvedAt || 0) - new Date(a.resolvedAt || 0);
  const open = rs.filter(r => r.status === 'waiting'), answered = rs.filter(r => r.status === 'answered').sort(byDone), closed = rs.filter(r => r.status === 'closed').sort(byDone);
  const due = open.filter(r => reminderDisplayStatus(r) === 'due').sort(byFu), waiting = open.filter(r => reminderDisplayStatus(r) !== 'due').sort(byFu);
  const weekAgo = addDays(rNow(), -7), recent = answered.filter(r => r.resolvedAt && new Date(r.resolvedAt) >= weekAgo);
  // each group in its own block, so the new look can draw it as a card; no white button on the rows there
  const uw = typeof uiStyleOn === 'function' && uiStyleOn();
  const sec = (t, list, cls) => list.length ? `<section class="rmi-g"><div class="rmi-sec${cls ? ' ' + cls : ''}"><b>${t}</b><span>${list.length}</span></div>${list.map((r, i) => remRowHtml(r, !uw && cls === 'is-due' && i === 0)).join('')}</section>` : '';
  let main;
  if(remTab === 'open') main = sec('Due', due, 'is-due') + sec('Waiting on the client', waiting) + sec('Answered this week', recent);
  else main = sec(remTab === 'answered' ? 'Answered' : 'Closed', remTab === 'answered' ? answered : closed);
  if(!main) main = remTab === 'open'
    ? emptyState({ icon: 'bell-ring', tone: clientReminders.length ? 'ok' : 'blue', title: clientReminders.length ? 'Nothing is waiting on clients' : 'No follow-ups yet',
        text: 'When you ask a client something, add it here with when to chase it. Radar reminds you, and the team can see you’re waiting on an answer.',
        action: 'New Reminder', actionIcon: 'plus', onAction: 'openNewReminderModal()' })
    : emptyState({ icon: remTab === 'answered' ? 'check-circle' : 'archive', title: `Nothing ${remTab === 'answered' ? 'answered' : 'closed'} yet`,
        text: remTab === 'answered' ? 'Follow-ups the client answered show here.' : 'Follow-ups you closed without an answer show here.' });
  const usedClients = [...new Set(base.map(r => r.clientId))].map(id => clients.find(c => c.id === id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  const askers = [...new Set(clientReminders.map(r => r.askedBy))].map(id => teamProfiles.find(p => p.id === id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  const curC = usedClients.find(c => c.id === remClient), curW = askers.find(p => p.id === remWho);
  const all = base.filter(r => (remClient === 'all' || r.clientId === remClient) && (remWho === 'all' || r.askedBy === remWho));
  const n = k => all.filter(r => r.status === k).length;
  const sel = window._remSel && clientReminders.find(r => r.id === window._remSel);
  if(window._remSel && !sel) window._remSel = null;
  const prev = root.querySelector('.sp-page')?.scrollTop || 0, prevSp = root.querySelector('.sp:not(.sp-leaving)')?.scrollTop || 0;
  root.innerHTML = `<div class="spw"><div class="sp-page"><div class="rmi">
<div class="rmi-hd"><div><h2>${due.length ? `${due.length} follow-up${due.length === 1 ? ' is' : 's are'} due` : 'No follow-ups are due'}</h2><p>${everyone ? 'Questions your team asked clients, and when to chase them.' : 'Questions you asked clients, and when to chase them.'}</p></div>
<div class="rmi-f"><div class="seg" role="tablist" aria-label="Show">${[['open', 'Waiting', n('waiting')], ['answered', 'Answered', n('answered')], ['closed', 'Closed', n('closed')]].map(([k, t, c]) => `<button class="${remTab === k ? 'on' : ''}" role="tab" aria-selected="${remTab === k}" onclick="setRem('tab','${k}')">${t} <span class="c">${c}</span></button>`).join('')}</div>
<label class="pop pop-sel"><span class="pl">Client: ${escapeHtml(curC ? curC.name : 'All')}</span>${icon('caret-down')}<select aria-label="Client" onchange="setRem('client',this.value)"><option value="all">All</option>${usedClients.map(c => `<option value="${c.id}"${c === curC ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select></label>
${everyone ? `<label class="pop pop-sel"><span class="pl">${escapeHtml(curW ? curW.name : 'Everyone')}</span>${icon('caret-down')}<select aria-label="Asked by" onchange="setRem('who',this.value)"><option value="all">Everyone</option>${askers.map(p => `<option value="${p.id}"${p === curW ? ' selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}</select></label>` : ''}</div></div>
${main}</div></div>${sel ? remPanelHtml(sel) : ''}</div>`;
  const sp = root.querySelector('.sp-page'); if(sp) sp.scrollTop = prev;
  const pn = root.querySelector('.sp:not(.sp-leaving)'); if(pn){ pn.scrollTop = prevSp; pn._st = prevSp; }
  if(currentViewName === 'reminders') setToolbar(null, 'Client follow-ups');
}

// ---- the panel: a follow-up on the right, like a task -----------------------------------------
// The question edits in place (it saves when you leave the field), the follow-up day is a pop of
// nearby days, and the one orange button is what to do next: Nudge when it's due, otherwise
// Mark Answered for when the client gets back to you.
function selectReminder(id){ window._remSel = window._remSel === id ? null : id; renderReminders(); }
function closeRemPanel(){ window._remSel = null; renderReminders(); }
const remSessionActivity = {};
function remPanelHtml(r){
  const c = clients.find(x => x.id === r.clientId), owner = teamProfiles.find(p => p.id === r.askedBy);
  const display = reminderDisplayStatus(r), open = r.status === 'waiting', due = display === 'due';
  const ownerName = r.askedBy === currentUser?.id ? 'You' : (owner ? owner.name : 'Someone no longer on the team');
  const asked = r.askedDate ? remDay(r.askedDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';
  const resolvedAt = r.resolvedAt ? fmtShortDate(new Date(r.resolvedAt)) : '';
  const linked = (typeof calendarEvents !== 'undefined' ? calendarEvents : []).find(e => e.relatedReminderId === r.id);
  const late = open && remWhen(r)[1];
  const status = due ? `<span class="rmp-st is-due">Due</span>`
    : open ? `Waiting on the client`
    : `<span class="rmp-st${r.status === 'answered' ? ' is-ok' : ''}">${r.status === 'answered' ? 'Answered' : 'Closed'}${resolvedAt ? ' ' + resolvedAt : ''}</span>`;
  const follow = open ? `<span class="tkp-k">Follow up</span><span class="tkp-v rmp-fu${late ? ' tkp-late' : ''}">${sheetDateField('remFollowUp', r.followUpDate || '', { from: 0, to: 30, min: toDateStr(new Date()), none: r.followUpDate ? '' : 'No date', after: 'remSetFollowUp' })}</span>` : '';
  const waited = r.askedDate ? remWaited(r.askedDate, open ? null : r.resolvedAt) : '';
  const draft = open ? remDrafts[r.id] : null;
  // One row of buttons: under the nudge while there is one (send it, or mark it answered), else here.
  const acts = draft ? ''
    : open ? `<div class="tkp-acts"><button class="btn${due ? ' btn-p' : ''}" onclick="nudgeReminder('${r.id}')">${icon('sparkle')}Draft Nudge</button><button class="btn${due ? '' : ' btn-p'}" onclick="markReminderStatus('${r.id}','answered')">${icon('check')}Mark Answered</button></div>`
    : `<div class="tkp-acts"><button class="btn" onclick="markReminderStatus('${r.id}','waiting')">${icon('rotate-ccw')}Reopen</button></div>`;
  const ev = [];
  if(r.askedDate) ev.push({ at: r.askedDate + 'T12:00:00', html: `<b>${escapeHtml(r.askedBy === currentUser?.id ? 'You' : firstName(owner ? owner.name : 'Someone'))}</b> asked ${escapeHtml(c ? c.name : 'the client')}` });
  (remSessionActivity[r.id] || []).forEach(x => ev.push(x));
  if(!open && r.resolvedAt) ev.push({ at: r.resolvedAt, html: r.status === 'answered' ? `Marked answered${waited ? `, after ${waited}` : ''}` : 'Closed without an answer' });
  ev.sort((a, b) => new Date(b.at) - new Date(a.at));
  const day = at => { const d = new Date(at), k = daysBetween(dayStart(d), dayStart(new Date())); return k === 0 ? 'Today' : k === 1 ? 'Yesterday' : fmtShortDate(d); };
  const more = [];
  if(open && !linked && r.followUpDate) more.push(`<button class="mi" onclick="remAddToCalendar('${r.id}')">${icon('calendar-plus')}Add to Calendar</button>`);
  if(open) more.push(`<button class="mi" onclick="createTaskFromReminder('${r.id}')">${icon('list-checks')}Make a Task…</button>`);
  if(c) more.push(`<button class="mi" onclick="openNoteModal(null, '${r.clientId}', 'idea')">${icon('notepad')}Start a Note…</button>`);
  if(open) more.push(`<button class="mi" onclick="markReminderStatus('${r.id}','closed')">${icon('x-circle')}Close Without an Answer</button>`);
  more.push(`<div class="msep"></div><button class="mi danger" onclick="deleteReminder('${r.id}')">${icon('trash')}Delete…</button>`);
  return `<aside class="sp tkp rmp" aria-label="${escapeHtml(r.question)}">
<div class="sp-bar"><button class="ib" aria-label="Close" onclick="closeRemPanel()">${icon('x')}</button><span class="tkp-bar"><button class="ib" aria-label="More" onclick="remMore(event)">${icon('dots-three')}</button><template id="remMoreItems">${more.join('')}</template></span></div>
<div class="tkp-h">${remCb(r, 'lg')}<textarea class="rmp-q" id="remQ" rows="1" spellcheck="true" aria-label="Question" maxlength="1000" onkeydown="remQKey(event)" onblur="remSaveQuestion('${r.id}')">${escapeHtml(r.question)}</textarea></div>
<div class="tkp-meta">
${c ? `<span class="tkp-k">Client</span><span class="tkp-v"><a href="#" onclick="openClientDetail('${c.id}');return false;">${escapeHtml(c.name)}</a></span>` : ''}
<span class="tkp-k">Asked by</span><span class="tkp-v">${escapeHtml(ownerName)}</span>
<span class="tkp-k">Asked</span><span class="tkp-v">${escapeHtml(asked || '—')}${open && waited ? `<em>waiting ${waited}</em>` : ''}</span>
${follow}
<span class="tkp-k">Status</span><span class="tkp-v">${status}</span>
${linked ? `<span class="tkp-k">Calendar</span><span class="tkp-v">On your calendar</span>` : ''}
</div>
${acts}
${draft ? remDraftHtml(r, c, draft) : ''}
<div class="sp-sec"><b>Activity</b></div>${ev.map(e => `<div class="tkp-a"><span class="tkp-ad">${day(e.at)}</span><span>${e.html}</span></div>`).join('')}
</aside>`;
}
function remMore(e){
  e.stopPropagation();
  const had = document.getElementById('remMenu'); had?.remove(); if(had) return;
  const tpl = document.getElementById('remMoreItems'); if(!tpl) return;
  const m = document.createElement('div');
  m.className = 'menu'; m.id = 'remMenu'; m.style.position = 'fixed';
  const r = e.currentTarget.getBoundingClientRect();
  m.style.top = (r.bottom + 4) + 'px'; m.style.right = (window.innerWidth - r.right) + 'px';
  m.innerHTML = tpl.innerHTML;
  document.body.appendChild(m);
  setTimeout(() => document.addEventListener('click', () => m.remove(), { once: true }), 0);
}
// Esc with a panel's … menu open closes the menu only, not the panel behind it (Tasks too).
document.addEventListener('keydown', e => {
  if(e.key !== 'Escape') return;
  const m = document.getElementById('remMenu') || document.getElementById('tkMenu');
  if(m){ e.stopPropagation(); m.remove(); }
}, true);
// Return saves, Esc puts the question back; both leave the field and keep the panel open.
function remQKey(e){
  const el = e.target;
  if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); el.blur(); }
  else if(e.key === 'Escape'){ e.stopPropagation(); const r = clientReminders.find(x => x.id === window._remSel); if(r) el.value = r.question; el.blur(); }
}
async function remSaveQuestion(id){
  const el = document.getElementById('remQ'), r = clientReminders.find(x => x.id === id);
  if(!el || !r) return;
  const q = el.value.replace(/\s+/g, ' ').trim();
  if(!q){ el.value = r.question; return; }
  if(q === r.question) return;
  const before = r.question; r.question = q; renderReminders();
  const { error } = await supabaseClient.from('client_reminders').update({ question: q }).eq('id', id);
  if(error){ r.question = before; renderReminders(); showToast('error', 'Question not saved', error.message); }
}
async function remSetFollowUp(v){
  const r = clientReminders.find(x => x.id === window._remSel);
  if(!r || !v || v === r.followUpDate) return;
  if(v < toDateStr(new Date())){ showToast('error', 'Pick today or later', 'A follow-up can’t be in the past.'); renderReminders(); return; }
  const before = r.followUpDate; r.followUpDate = v; renderReminders();
  const { error } = await supabaseClient.from('client_reminders').update({ follow_up_date: v }).eq('id', r.id);
  if(error){ r.followUpDate = before; renderReminders(); showToast('error', 'Follow-up not moved', error.message); return; }
  const ev = (typeof calendarEvents !== 'undefined' ? calendarEvents : []).find(e => e.relatedReminderId === r.id);
  if(ev) await supabaseClient.from('calendar_events').update({ start_at: `${v}T00:00:00`, end_at: `${v}T23:59:59` }).eq('id', ev.id);
}
async function remAddToCalendar(id){
  await addReminderToCalendar(id);
  if(typeof loadCalendarEvents === 'function') await loadCalendarEvents();
  renderReminders();
}
// ---- Nudge: the AI writes the follow-up to the client (js/core/followup-prompt.js) --------------
// Draft Nudge writes it in the panel, as an email or a WhatsApp message (how the client hears from
// us), to edit before it goes. Open in Mail or Copy counts as nudged: the next follow-up moves three
// days out (never onto a weekend). Nothing is ever sent to the client by Radar itself.
const remDrafts = {};   // reminder id -> { ch: 'email' | 'whatsapp', state: 'writing' | 'ready', subject, body, plain, n }
// The next weekday from a date: the team doesn't work weekends.
function remWorkday(d){ const k = d.getDay(); return k === 6 ? addDays(d, 2) : k === 0 ? addDays(d, 1) : d; }
function remNudgeCh(c){ return c && typeof winChannel === 'function' && winChannel(c) === 'whatsapp' ? 'whatsapp' : 'email'; }
function remNudgeFacts(r, c, ch){
  const asked = r.askedDate ? remDay(r.askedDate) : null;
  return { client: c ? c.name : 'the client', contact: typeof clientContact === 'function' ? clientContact(c) : '', ask: r.question,
    askedOn: asked ? asked.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : '',
    waitedDays: asked ? Math.max(0, daysBetween(asked, dayStart(new Date()))) : null,
    sender: firstName(myName() || ''), agency: settings.appName || 'Based Agency', whatsapp: ch === 'whatsapp' };
}
// From a row's Nudge, or the panel's Draft Nudge: open the panel on it and write the nudge.
function nudgeReminder(id){
  if(window._remSel !== id){ window._remSel = id; }
  remDraftNudge(id);
}
async function remDraftNudge(id, ch){
  const r = clientReminders.find(x => x.id === id); if(!r) return;
  const c = clients.find(x => x.id === r.clientId), prev = remDrafts[id];
  const d = remDrafts[id] = { ch: ch || (prev && prev.ch) || remNudgeCh(c), state: 'writing', subject: '', body: '', plain: false, n: ((prev && prev.n) || 0) + 1 };
  renderReminders();
  const o = remNudgeFacts(r, c, d.ch);
  let out = null;
  try{
    const res = await fetch('/api/generate-draft', { method: 'POST', headers: await apiAuthHeaders(), body: JSON.stringify({ prompt: followUpPrompt(o), model: settings.openaiModel }) });
    const data = await res.json().catch(() => ({}));
    if(res.ok) out = followUpParse(data.text, o.whatsapp);
  }catch(e){ console.error('Nudge draft failed', e); }
  if(remDrafts[id] !== d) return;   // written again, or discarded, while this one was on its way
  if(!out){ out = followUpPlain(o); d.plain = true; }
  Object.assign(d, { state: 'ready', subject: out.subject || '', body: out.body || '' });
  renderReminders();
  if(d.plain) showToast('info', 'Here’s a simple one', 'The AI didn’t answer, so this is a plain nudge to edit.');
  setTimeout(() => { const el = document.getElementById('remDrBody'); if(el && window._remSel === id){ el.focus(); el.setSelectionRange(0, 0); el.scrollTop = 0; } }, 40);
}
function remDraftEdit(id, k, v){ const d = remDrafts[id]; if(d) d[k] = v; }
function remDiscardNudge(id){ delete remDrafts[id]; renderReminders(); }
function remDraftHtml(r, c, d){
  const email = d.ch === 'email', to = c && c.email ? String(c.email).split(',')[0].trim() : '';
  const who = (typeof clientContact === 'function' && clientContact(c)) || (c ? c.name : 'the client');
  const next = remDay(toDateStr(remWorkday(addDays(new Date(), 3)))).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const seg = `<div class="seg rmp-ch" role="tablist" aria-label="Send by">${[['email', 'Email'], ['whatsapp', 'WhatsApp']].map(([k, t]) => `<button class="${d.ch === k ? 'on' : ''}" role="tab" aria-selected="${d.ch === k}" ${d.state === 'writing' ? 'disabled' : ''} onclick="${d.ch === k ? '' : `remDraftNudge('${r.id}','${k}')`}">${t}</button>`).join('')}</div>`;
  const head = `<div class="sp-sec rmp-dh"><b>Nudge</b>${seg}<span class="rmp-dt"><button class="ib" aria-label="Write again" title="Write again" ${d.state === 'writing' ? 'disabled' : ''} onclick="remDraftNudge('${r.id}')">${icon('arrows-clockwise')}</button><button class="ib" aria-label="Discard the nudge" title="Discard" onclick="remDiscardNudge('${r.id}')">${icon('x')}</button></span></div>`;
  const writing = d.state === 'writing', off = writing ? ' disabled' : '';
  const answered = `<button class="btn rmp-ans" onclick="markReminderStatus('${r.id}','answered')">${icon('check')}Mark Answered</button>`;
  const primary = email && to
    ? `<button class="btn btn-p" onclick="remSendNudge('${r.id}')"${off}>${icon('envelope-simple')}Open in Mail</button><button class="btn" onclick="remCopyNudge('${r.id}')"${off}>${icon('copy')}Copy</button>`
    : `<button class="btn btn-p" onclick="remCopyNudge('${r.id}')"${off}>${icon('copy')}${email ? 'Copy' : 'Copy for WhatsApp'}</button>`;
  if(writing) return `${head}<div class="rmp-dr is-writing" aria-live="polite"><p class="rmp-dw">${icon('sparkle')}Writing ${email ? 'an email' : 'a WhatsApp message'} to ${escapeHtml(who)}…</p><i></i><i></i><i></i>
<div class="rmp-dacts">${primary}${answered}</div></div>`;
  const note = email
    ? (to ? `To ${escapeHtml(to)}. Sending it moves the next follow-up to ${next}.` : `No email on file for ${escapeHtml(c ? c.name : 'this client')}, so copy it into your mail. The next follow-up moves to ${next}.`)
    : `Paste it in their group. The next follow-up moves to ${next}.`;
  return `${head}<div class="rmp-dr">
${email ? `<input class="tf rmp-subj" id="remDrSubj" aria-label="Subject" placeholder="Subject" value="${escapeHtml(d.subject)}" oninput="remDraftEdit('${r.id}','subject',this.value)">` : ''}
<textarea class="tf rmp-body" id="remDrBody" aria-label="${email ? 'Email' : 'Message'}" spellcheck="true" rows="${email ? 8 : 5}" oninput="remDraftEdit('${r.id}','body',this.value)">${escapeHtml(d.body)}</textarea>
<div class="rmp-dacts">${primary}${answered}</div>
<p class="rmp-dn">${note}</p></div>`;
}
async function remSendNudge(id){
  const r = clientReminders.find(x => x.id === id), d = remDrafts[id]; if(!r || !d) return;
  const c = clients.find(x => x.id === r.clientId), to = c && c.email ? String(c.email).split(',')[0].trim() : '';
  if(!to) return remCopyNudge(id);
  const a = document.createElement('a');
  a.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(d.subject || '')}&body=${encodeURIComponent(d.body || '')}`;
  a.click();
  await remNudged(id, 'mail');
}
async function remCopyNudge(id){
  const d = remDrafts[id]; if(!d) return;
  try{ await navigator.clipboard.writeText(d.body || ''); }catch(e){ showToast('error', 'Couldn’t copy', 'Select the text and copy it yourself.'); return; }
  await remNudged(id, d.ch === 'whatsapp' ? 'whatsapp' : 'copy');
}
async function remNudged(id, how){
  const r = clientReminders.find(x => x.id === id); if(!r) return;
  const c = clients.find(x => x.id === r.clientId);
  const next = toDateStr(remWorkday(addDays(new Date(), 3)));
  delete remDrafts[id];
  (remSessionActivity[id] = remSessionActivity[id] || []).push({ at: new Date().toISOString(), html: `<b>You</b> nudged ${escapeHtml(c ? c.name : 'them')}` });
  const { error } = await supabaseClient.from('client_reminders').update({ follow_up_date: next }).eq('id', id);
  if(error){ renderReminders(); showToast('error', 'Follow-up date not moved', error.message); return; }
  await loadClientReminders();
  renderReminders();
  const day = remDay(next).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  showToast('success', how === 'mail' ? 'Nudge ready in your mail app' : how === 'whatsapp' ? 'Nudge copied for WhatsApp' : 'Nudge copied', `Next follow-up ${day}.`);
  if(c) logClientActivity(r.clientId, 'reminder_nudged', `${myName() || 'Someone'} nudged ${c.name} about "${r.question.length > 80 ? r.question.slice(0, 80) + '…' : r.question}".`);
}

// Notes moved to notes-canvas.js (the gallery and the note sheet).
