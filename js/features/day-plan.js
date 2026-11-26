// Today's Plan (Nov 25, v3): a plan, not a to-do list. Each weekday morning Claude decides what the day
// is for (lib/claude-radar.js makeDayPlan) and the app keeps it with you all day:
//  • the sheet (the Dashboard's toolbar, or the ring): the headline and why, the few moves in time order
//    around your meetings, what's ready for you to send (only when there's something), what Claude left
//    for later on purpose, and what's coming. A new plan reveals itself line by line, once.
//  • the ring in the bottom-right corner: how much of today's plan is done, worked out from what Radar
//    already knows (claude-radar.js dayPlanItems), so nothing needs ticking. Hover it for what's done and
//    what's left; finishing something gets one quiet line about what it makes possible; finishing the
//    plan, one small moment. At most one gentle check-in in the afternoon, only when something is still
//    open and still doable, never in a meeting or while you're busy. Hide it for the day from its card.
// Settings → AI → Today's Plan off hides all of it (claudeDayPlanOn).

function dpGo(fn){ if(document.getElementById('appModalOverlay')) closeAppModal(); setTimeout(fn, 0); }
function dpMins(n){ n = Math.round(n || 0); const h = Math.floor(n / 60), m = n % 60; return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`; }
function dpTeamNow(){
  const tz = (typeof settings !== 'undefined' && settings && settings.timezone) || 'America/New_York';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date());
  const g = k => (parts.find(x => x.type === k) || {}).value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, mins: Number(g('hour')) % 24 * 60 + Number(g('minute')) };
}
function dpSeenKey(){ return typeof dayPlanSeenKey === 'function' ? dayPlanSeenKey() : 'bda_dayplan_seen'; }
function dpSeen(){ try{ return localStorage.getItem(dpSeenKey()); }catch(e){ return null; } }

// The Dashboard's toolbar button; a dot when there's a plan you haven't opened
function dayPlanToolbarHtml(){
  if(!claudeDayPlanOn()) return '';
  if(!dayPlan.at && !dayPlan.loading) setTimeout(() => loadDayPlan(), 0);
  const p = dayPlanV3(), fresh = p && dpSeen() !== p.at;
  return `<button class="btn dp-btn" onclick="openDayPlan()" data-hovertip="What today is for, planned by Claude: the few things that matter, what to leave, and what’s coming." data-tipdelay="1500">${CLAUDE_SPARK}Today’s Plan${fresh ? '<i class="dp-new" aria-label="New"></i>' : ''}</button>`;
}

// ---- the sheet -------------------------------------------------------------------------------------
function dpWhenOf(x){
  if(x.kind === 'meeting'){ const t = dpTeamTime(x.start, (dayPlan.plan || {}).date); return t ? fmtTime(t) : x.start; }
  return x.when || '';
}
function dpRowsOfDay(p){
  const rows = (p.moves || []).map(m => ({ kind: 'move', start: m.start || '99:99', m }))
    .concat((p.meetings || []).map(x => ({ kind: 'meeting', start: x.start || '99:99', x })));
  return rows.sort((a, b) => a.start.localeCompare(b.start));
}
function dayPlanBodyHtml(){
  const d = dayPlan;
  if(d.making) return `<div class="dp-wait"><div class="dp-wait-l"><i></i><i></i><i></i></div><p>Claude is planning your day…</p><span>Reading your calendar, tasks, clients’ requests, follow-ups, sprints and logged work. About half a minute.</span></div>`;
  if(d.loading && !d.plan) return `<div class="dp-wait"><p>Loading…</p></div>`;
  if(d.error && !d.plan) return emptyState({ icon: 'refresh-cw', title: 'The plan couldn’t be loaded', text: d.error, action: 'Try Again', onAction: 'loadDayPlan(true)' });
  const p = d.plan && d.plan.v === 3 ? d.plan : null;
  if(!p) return emptyState({ icon: 'sparkle', title: 'No plan for today yet', text: `Claude writes it each weekday morning: what today is for, the few things that get it done, and what to leave for later.${d.last ? ' Yours from ' + fmtShortDate(new Date(d.last + 'T12:00:00')) + ' is out of date.' : ''}`, action: 'Make Today’s Plan', onAction: 'makeDayPlanNow()' });
  if(p.empty) return emptyState({ icon: 'check-circle', tone: 'ok', title: 'Nothing on your clients today', text: 'No meetings, open tasks, sprints, follow-ups or requests for the clients you work on.' });
  const A = jsArg, items = dayPlanItems(), by = Object.fromEntries(items.map(x => [x.id, x]));
  const rv = () => '';   // each line's place in the reveal is set in reading order (dayPlanRedraw)
  const sm = (label, js, primary) => `<button type="button" class="btn sm${primary ? ' btn-p' : ''}" onclick="${js}">${label}</button>`;
  const day = dpRowsOfDay(p).map(r => {
    if(r.kind === 'meeting'){
      const x = r.x;
      return `<div class="dp3-row is-meet rv" ${rv()}><div class="dp3-when"><span>${escapeHtml(dpWhenOf({ kind: 'meeting', start: x.start }))}</span><small>${escapeHtml(dpMins(x.minutes))}</small></div>
<div class="dp3-body"><p class="dp3-t">${escapeHtml(x.title)}</p><p class="dp3-why">${x.client ? `Meeting with ${escapeHtml(x.client)}` : 'Meeting'}</p>${x.prep && x.prep.length ? `<ul class="dp3-prep">${x.prep.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul>` : ''}</div>
<div class="dp3-act">${x.url ? `<a class="btn sm" href="${safeUrl(x.url)}" target="_blank" rel="noopener">Join</a>` : ''}</div></div>`;
    }
    const m = r.m, it = by[m.id] || { done: false, parts: 0, partsDone: 0 };
    const acts = it.done ? (it.canMark ? sm('Undo', `dpMarkDone(${A(m.id)}, false)`) : '')
      : (it.tasks && it.tasks.some(t => t.status !== 'done')) || (it.wa && it.wa.length) ? sm(it.parts > 1 ? 'Open Next' : 'Open', `dpOpenMove(${A(m.id)})`)
      : it.canMark ? sm('Mark Done', `dpMarkDone(${A(m.id)}, true)`) : '';
    const meta = it.parts > 1 ? `<p class="dp3-meta">${it.partsDone} of ${it.parts} done</p>` : '';
    return `<div class="dp3-row rv${it.done ? ' is-done' : ''}" ${rv()} data-dp="${escapeHtml(m.id)}"><div class="dp3-when"><span>${it.done ? 'Done' : escapeHtml(m.when || '')}</span><small>${it.done ? '' : escapeHtml(dpMins(m.minutes))}</small></div>
<div class="dp3-body"><p class="dp3-t">${escapeHtml(m.title)}</p>${m.why ? `<p class="dp3-why">${escapeHtml(m.why)}</p>` : ''}${meta}</div><div class="dp3-act">${acts}</div></div>`;
  }).join('');
  // ready for you to send: only what's still yours to do
  const ready = items.filter(x => (x.kind === 'follow' || x.kind === 'win') && !x.done).map(x => x.kind === 'follow'
    ? `<div class="dp3-ln rv" ${rv()}><div class="dp3-body"><p class="dp3-t">${escapeHtml(x.title)}</p><p class="dp3-why">${escapeHtml(x.f.ask)}. Claude wrote the message for you to read and send.</p></div><div class="dp3-act">${sm('Review and Send', `dpNudge(${A(x.f.reminderId)})`)}</div></div>`
    : `<div class="dp3-ln rv" ${rv()}><div class="dp3-body"><p class="dp3-t">${escapeHtml(x.title)}</p><p class="dp3-why">${escapeHtml(x.sub)} · ${x.w.due < 0 ? 'late' : x.w.due === 0 ? 'due today' : x.w.due === 1 ? 'due tomorrow' : `due in ${x.w.due} days`}. Your part is written.</p></div><div class="dp3-act">${sm('Read', `dpGo(() => openWeekClient(${A(x.w.clientId)}))`)}${sm('Send to Review', `dpWinToReview(${A(x.w.clientId)}, this)`)}</div></div>`).join('');
  const left = (p.leftOut || []).map((x, i) => `<div class="dp3-ln rv" ${rv()}><div class="dp3-body"><p class="dp3-why is-plain">${escapeHtml(x.text)}</p></div><div class="dp3-act">${
    x.action === 'message' ? sm(`Write to ${escapeHtml(firstName(x.to))}`, `dpLeftMessage(${i})`) : x.action === 'open' ? sm('Open', `dpLeftOpen(${i})`) : ''}</div></div>`).join('');
  const coming = (p.comingUp || []).map((x, i) => `<div class="dp3-ln rv" ${rv()}><div class="dp3-body"><p class="dp3-why is-plain">${escapeHtml(x.text)}</p></div><div class="dp3-act">${
    x.action === 'sprint' ? sm('Make It a Sprint', `dpComing(${i}, this)`) : x.action === 'tasks' ? sm('Add as Tasks', `dpComing(${i}, this)`) : x.action === 'claude' ? sm(`${CLAUDE_SPARK}Plan with Claude`, `dpComing(${i}, this)`) : ''}</div></div>`).join('');
  const when = p.at ? fmtTime(new Date(p.at)) : '', hidden = dpRingHidden();
  return `<p class="dp3-hl rv" ${rv()}>${escapeHtml(p.headline)}</p>
${p.why ? `<p class="dp3-wy rv" ${rv()}>${escapeHtml(p.why)}</p>` : ''}
<section class="dp3-sec"><h4 class="rv" ${rv()}>How I’d run the day</h4>${day || '<p class="dp3-why">Nothing to schedule.</p>'}</section>
${ready ? `<section class="dp3-sec"><h4 class="rv" ${rv()}>Ready for you to send</h4>${ready}</section>` : ''}
${left ? `<section class="dp3-sec"><h4 class="rv" ${rv()}>Left out on purpose</h4>${left}</section>` : ''}
${coming ? `<section class="dp3-sec"><h4 class="rv" ${rv()}>Coming up</h4>${coming}</section>` : ''}
<p class="dp-foot rv" ${rv()}><span>Planned by Claude${when ? ` at ${escapeHtml(when)}` : ''} from your calendar, tasks, sprints, clients and logged work. · <button type="button" class="x-lnk" onclick="makeDayPlanNow()">Write It Again</button>${hidden ? ' · <button type="button" class="x-lnk" onclick="dpRingShow()">Show Progress in the Corner</button>' : ''}</span></p>`;
}
function dpProgressText(){ const it = dayPlanItems(); if(!it.length) return ''; const k = it.filter(x => x.done).length; return k === it.length ? 'All done' : `${k} of ${it.length} done`; }
// Draws the sheet again only when something changed; a move that just got done gets a quiet flash
let dpSheetDone = null;
function dayPlanRedraw(){
  const b = document.getElementById('dpBody'); if(!b) return;
  const html = dayPlanBodyHtml(); if(b._html === html) return;
  b._html = html; b.innerHTML = html;
  b.querySelectorAll('.rv').forEach((el, i) => el.style.setProperty('--i', Math.min(i, 16)));
  const prog = document.getElementById('dpProg'); if(prog) prog.textContent = dpProgressText();
  const now = new Set(dayPlanItems().filter(x => x.done).map(x => x.id));
  if(dpSheetDone) now.forEach(id => { if(!dpSheetDone.has(id)){ const row = b.querySelector(`[data-dp="${CSS.escape(id)}"]`); if(row) row.classList.add('just-done'); } });
  dpSheetDone = now;
}
function openDayPlan(opts){
  const p = dayPlan.plan;
  const reveal = !!(p && p.v === 3 && !p.empty && (dpSeen() !== p.at || (opts && opts.reveal)));
  if(p) try{ localStorage.setItem(dpSeenKey(), p.at); }catch(e){}
  const day = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  dpSheetDone = null;
  openAppModal(`<h3 class="dp-h">${CLAUDE_SPARK}<span>Today’s Plan</span><small>${escapeHtml(day)}</small><em class="dp3-prog" id="dpProg">${escapeHtml(dpProgressText())}</em></h3><div class="dp dp3" id="dpBody"></div><div class="sheet-a"><button class="btn btn-p" id="dpDone" onclick="closeAppModal()">Done</button></div>`, 680);
  const b = document.getElementById('dpBody');
  if(reveal && typeof motionOK === 'function') b.classList.add('is-reveal');
  dayPlanRedraw();
  if(reveal) setTimeout(() => b.classList.remove('is-reveal'), 1900);
  setTimeout(() => document.getElementById('dpDone')?.focus({ preventScroll: true }), 30);
  if(currentViewName === 'overview') setToolbarActions('overview');
  if(!dayPlan.plan && !dayPlan.loading) loadDayPlan(true);
}
async function makeDayPlanNow(){
  if(dayPlan.making) return;
  dayPlan = { ...dayPlan, making: true, error: null }; dayPlanRedraw();
  const r = await claudeApi({ action: 'day-plan' });
  dayPlan = r.error ? { ...dayPlan, making: false } : { ...r, at: Date.now() };
  if(r.error){ showToast('error', 'The plan wasn’t written', r.error); dayPlanRedraw(); return; }
  try{ localStorage.setItem(dpSeenKey(), r.plan && r.plan.at); }catch(e){}
  dpRing.prev = null;   // a new plan: nothing to celebrate from the old one
  const b = document.getElementById('dpBody');
  if(b){ b._html = null; dpSheetDone = null; if(typeof motionOK !== 'function' || motionOK()) b.classList.add('is-reveal'); dayPlanRedraw(); setTimeout(() => b.classList.remove('is-reveal'), 1900); }
  const prog = document.getElementById('dpProg'); if(prog) prog.textContent = dpProgressText();
  if(currentViewName === 'overview') setToolbarActions('overview');
  dpRingTick();
}

// the moves' buttons
function dpItem(id){ return dayPlanItems().find(x => x.id === id) || null; }
function dpOpenMove(id){
  const it = dpItem(id); if(!it) return;
  const t = (it.tasks || []).find(x => x.status !== 'done'), w = (it.wa || []).find(x => x.status === 'open');
  if(t) dpGo(() => notifOpenTask(t.id)); else if(w) dpGo(() => waOpenItem(w.id));
}
function dpMarkDone(id, on){ dpSetMarked(id, on !== false); dayPlanRedraw(); dpRingTick(); }
// a follow-up Claude wrote: to Reminders, the Nudge open with it, to read and send
async function dpNudge(reminderId){
  const f = ((dayPlan.plan || {}).followUps || []).find(x => x.reminderId === reminderId); if(!f) return;
  closeAppModal();
  if(typeof clientReminders === 'undefined' || !(clientReminders || []).some(r => r.id === f.reminderId)) await loadClientReminders();
  switchView('reminders');
  setTimeout(() => {
    window._remSel = f.reminderId;
    remDrafts[f.reminderId] = { ch: f.ch === 'whatsapp' ? 'whatsapp' : 'email', state: 'ready', subject: f.subject || '', body: f.body || '', plain: !!f.plain, n: 1 };
    renderReminders();
  }, 0);
}
// your part of a win update Claude wrote: to Review (the latest data first, so Radar sees the draft)
async function dpWinToReview(clientId, btn){
  if(btn){ btn.disabled = true; btn.textContent = 'Sending…'; }
  if(typeof loadAll === 'function') await loadAll();
  await sendDraftForReview(clientId, myName());
  const c = clients.find(x => x.id === clientId), d = c && typeof getDraftFor === 'function' ? getDraftFor(c, myName()) : null;
  if(d && d.readyToNotify){ dayPlanRedraw(); dpRingTick(); }
  else if(btn && btn.isConnected){ btn.disabled = false; btn.textContent = 'Send to Review'; }
}
// left out on purpose: a note to a teammate Claude wrote (to copy), or the task it's about
function dpLeftMessage(i){
  const x = ((dayPlan.plan || {}).leftOut || [])[i]; if(!x) return;
  openAppModal(`<h3 class="cpp-h">${CLAUDE_SPARK}<span>Write to ${escapeHtml(x.to)}</span></h3>
<p class="cpp-sub">${escapeHtml(x.text)} Change anything, then copy it into Slack or wherever you talk.</p>
<textarea id="cppText" class="tf cpp-text is-short" spellcheck="true" aria-label="The message">${escapeHtml(x.message)}</textarea>
<div class="sheet-a"><button class="btn" onclick="openDayPlan()">Back</button><button class="btn btn-p" id="cppCopy" onclick="dpCopyMessage()">${icon('copy')}Copy</button></div>`, 560);
  setTimeout(() => document.getElementById('cppCopy')?.focus({ preventScroll: true }), 30);
}
async function dpCopyMessage(){
  const text = (document.getElementById('cppText')?.value || '').trim(), btn = document.getElementById('cppCopy');
  try{ await navigator.clipboard.writeText(text); }catch(e){ const t = document.getElementById('cppText'); if(t){ t.select(); document.execCommand('copy'); } }
  if(btn){ btn.innerHTML = `${icon('check')}Copied`; setTimeout(() => { if(btn.isConnected) btn.innerHTML = `${icon('copy')}Copy`; }, 1800); }
}
function dpLeftOpen(i){ const x = ((dayPlan.plan || {}).leftOut || [])[i]; if(x && x.taskIds && x.taskIds[0]) dpGo(() => notifOpenTask(x.taskIds[0])); }
// coming up: a sprint, tasks, or Plan with Claude
async function dpComing(i, btn){
  const x = ((dayPlan.plan || {}).comingUp || [])[i]; if(!x) return;
  if(x.action === 'sprint') return dpGo(() => openNewSprintModal({ clientId: x.clientId, preset: { title: x.title || x.text, goal: x.text, steps: x.steps || [] } }));
  if(x.action === 'claude') return dpGo(() => planWithClaude(x.clientId, `${x.title ? x.title + '. ' : ''}${x.text}${x.steps && x.steps.length ? `\nSteps I have in mind: ${x.steps.join('; ')}.` : ''}`));
  if(x.action !== 'tasks') return;
  if(btn){ btn.disabled = true; btn.textContent = 'Adding…'; }
  let k = 0;
  for(const step of x.steps || []){
    const res = await insertTaskRow({ title: step, description: `${x.title ? x.title + '. ' : ''}${x.text}`, priority: 'medium', status: 'todo', assigner_id: currentUser.id, assignee_id: currentUser.id, client_id: x.clientId || null, due_date: null });
    if(!res.error && res.data){ k++; if(typeof mtKnow === 'function') mtKnow(res.data); }
  }
  if(btn && btn.isConnected) btn.outerHTML = `<span class="dp-ok">${k} task${k === 1 ? '' : 's'} added</span>`;
  showToast(k ? 'success' : 'error', k ? `${k} task${k === 1 ? '' : 's'} added` : 'No tasks added', k ? `For ${x.client}, in your Tasks with no date yet.` : 'Try again in a moment.');
}

// ---- the ring in the corner --------------------------------------------------------------------------
const dpRing = { prev: null, sayT: 0, openT: 0, closeT: 0, lastActive: 0, lastLoad: 0, sig: '' };
function dpRingKey(k){ return `bda_dp_${k}_${currentUser ? currentUser.id : ''}_${(dayPlan.plan || {}).date || ''}`; }
function dpRingHidden(){ try{ return localStorage.getItem(dpRingKey('hide')) === '1'; }catch(e){ return false; } }
function dpRingHide(){
  try{ localStorage.setItem(dpRingKey('hide'), '1'); }catch(e){}
  const el = document.getElementById('dpRing'); if(el){ el.classList.remove('is-in', 'is-pop'); el.classList.add('is-out'); setTimeout(() => el.remove(), 260); }
  showToast('info', 'Hidden for today', 'It’s back tomorrow. You can bring it back from Today’s Plan.');
  dayPlanRedraw();
}
function dpRingShow(){ try{ localStorage.removeItem(dpRingKey('hide')); }catch(e){} dayPlanRedraw(); dpRingTick(); }
function dpRingMount(){
  let el = document.getElementById('dpRing'); if(el) return el;
  el = document.createElement('div');
  el.id = 'dpRing'; el.className = 'dpr';
  el.innerHTML = `<div class="dpr-say" role="status" aria-live="polite"></div>
<div class="dpr-pop" id="dprPop"></div>
<button type="button" class="dpr-b" onclick="dpRingOpen()" aria-describedby="dprPop"><svg class="dpr-r" viewBox="0 0 22 22" aria-hidden="true"><circle class="dpr-tr" cx="11" cy="11" r="8.5"/><circle class="dpr-pr" cx="11" cy="11" r="8.5" pathLength="100"/><path class="dpr-ck" d="M7.4 11.3l2.4 2.4 4.8-5" pathLength="1"/></svg><span class="dpr-n"></span></button>`;
  document.body.appendChild(el);
  el.addEventListener('mouseenter', () => { clearTimeout(dpRing.closeT); dpRing.openT = setTimeout(() => dpRingPop(true), 90); });
  el.addEventListener('mouseleave', () => { clearTimeout(dpRing.openT); dpRing.closeT = setTimeout(() => dpRingPop(false), 180); });
  el.addEventListener('focusin', () => dpRingPop(true));
  el.addEventListener('focusout', e => { if(!el.contains(e.relatedTarget)) dpRingPop(false); });
  el.addEventListener('keydown', e => { if(e.key === 'Escape'){ dpRingPop(false); el.querySelector('.dpr-b').blur(); } });
  const say = el.querySelector('.dpr-say');
  say.addEventListener('mouseenter', () => clearTimeout(dpRing.sayT));
  say.addEventListener('mouseleave', () => { dpRing.sayT = setTimeout(dpRingSayOff, 2200); });
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-in')));
  return el;
}
function dpRingUnmount(){ const el = document.getElementById('dpRing'); if(el) el.remove(); }
function dpRingOpen(){ dpRingPop(false); dpRingSayOff(); openDayPlan(); }
function dpRingPop(on){
  const el = document.getElementById('dpRing'); if(!el) return;
  if(on){ dpRingSayOff(); el.querySelector('.dpr-pop').innerHTML = dpRingPopHtml(dayPlanItems()); }
  el.classList.toggle('is-pop', !!on);
}
function dpRingPopHtml(items){
  const p = dayPlanV3() || {}, k = items.filter(x => x.done).length, next = items.find(x => !x.done);
  const line = x => {
    const sub = x === next && x.why ? `<em>${escapeHtml(x.why)}</em>` : !x.done && (x.when || x.sub) ? `<small>${escapeHtml(x.kind === 'move' ? [x.when, x.minutes ? dpMins(x.minutes) : ''].filter(Boolean).join(' · ') : x.kind === 'follow' ? 'Ready for you to send' : 'Written, ready for Review')}</small>` : '';
    return `<li class="${x.done ? 'is-done' : ''}${x === next ? ' is-next' : ''}"><span class="dpr-c">${x.done ? icon('check', { weight: 'bold' }) : ''}<span class="dpr-sr">${x.done ? 'Done' : 'Open'}</span></span><span class="dpr-tx"><b>${escapeHtml(x.title)}</b>${sub}</span></li>`;
  };
  return `<div class="dpr-ph"><b>Today’s Plan</b><span>${k === items.length ? 'All done' : `${k} of ${items.length} done`}</span></div>
${p.headline ? `<p class="dpr-hl">${escapeHtml(p.headline)}</p>` : ''}
<ul class="dpr-l">${items.map(line).join('')}</ul>
<div class="dpr-pf"><button type="button" class="btn sm" onclick="dpRingOpen()">Open Today’s Plan</button><button type="button" class="dpr-hide" onclick="dpRingHide()">Hide for Today</button></div>`;
}
// one quiet line by the ring; it stays while you read it
function dpRingSay(html, ms){
  const el = document.getElementById('dpRing'); if(!el || el.classList.contains('is-pop')) return false;
  const say = el.querySelector('.dpr-say');
  clearTimeout(dpRing.sayT);
  say.innerHTML = html;
  el.classList.remove('is-say'); void say.offsetWidth; el.classList.add('is-say');
  dpRing.sayT = setTimeout(dpRingSayOff, ms || 5600);
  return true;
}
function dpRingSayOff(){ clearTimeout(dpRing.sayT); const el = document.getElementById('dpRing'); if(el) el.classList.remove('is-say'); }
function dpHoursToday(){
  if(typeof timeEntries === 'undefined' || !currentUser) return 0;
  const today = toDateStr(new Date());
  return (timeEntries || []).filter(e => e.userId === currentUser.id && e.date === today).reduce((a, e) => a + (Number(e.minutes) || 0), 0);
}
function dpRingUpdate(items){
  const el = dpRingMount(), k = items.filter(x => x.done).length, all = k === items.length;
  el.querySelector('.dpr-pr').style.strokeDashoffset = String(100 - Math.round(100 * k / items.length));
  el.classList.toggle('is-all', all);
  const n = el.querySelector('.dpr-n'), text = all ? 'All done' : `${k} of ${items.length}`;
  if(n.textContent !== text){
    if(n.textContent){ n.classList.remove('is-tick'); void n.offsetWidth; n.classList.add('is-tick'); }
    n.textContent = text;
  }
  el.querySelector('.dpr-b').setAttribute('aria-label', `Today’s Plan: ${all ? 'all done' : `${k} of ${items.length} done`}`);
  const sig = items.map(x => x.id + (x.done ? '+' : '-')).join();
  if(sig !== dpRing.sig){ dpRing.sig = sig; if(el.classList.contains('is-pop')) el.querySelector('.dpr-pop').innerHTML = dpRingPopHtml(items); }
  // just done (this session, not before): what it makes possible, and what's next
  const done = new Set(items.filter(x => x.done).map(x => x.id));
  let seen = []; try{ seen = JSON.parse(localStorage.getItem(dpRingKey('said')) || '[]'); }catch(e){}
  if(dpRing.prev){
    const fresh = items.filter(x => x.done && !dpRing.prev.has(x.id) && !seen.includes(x.id));
    if(fresh.length){
      const x = fresh[fresh.length - 1], next = items.find(y => !y.done);
      const said = all
        ? dpRingSay(`<b>Day planned, day done.</b>${dpHoursToday() ? `<span>${escapeHtml(dpMins(dpHoursToday()))} on clients today.</span>` : '<span>Everything Claude planned for today is done.</span>'}`, 7000)
        : dpRingSay(`<b>${escapeHtml(x.doneLine || `${x.title}: done.`)}</b>${next ? `<span>Next: ${escapeHtml(next.title)}</span>` : ''}`);
      if(said) try{ localStorage.setItem(dpRingKey('said'), JSON.stringify(seen.concat(fresh.map(y => y.id)))); }catch(e){}
    }
  }
  dpRing.prev = done;
}
// At most one gentle check-in a day, in the afternoon (the team's time), when a move is still open and
// still fits before 6 pm. Not in a meeting, not while a timer runs, not in the minute after you typed
// or clicked: it waits for a quiet moment, or says nothing.
function dpRingCheckIn(items){
  if(document.visibilityState !== 'visible' || Date.now() - dpRing.lastActive < 60000) return;
  try{ if(localStorage.getItem(dpRingKey('checkin'))) return; }catch(e){ return; }
  const now = dpTeamNow(); if(now.mins < 14 * 60 + 30 || now.mins > 16 * 60 + 45) return;
  if(typeof timerState !== 'undefined' && timerState && timerState.running) return;
  const t = Date.now();
  if(typeof calendarEvents !== 'undefined' && (calendarEvents || []).some(e => !e.allDay && e.eventType !== 'deadline' && new Date(e.startAt) <= t && new Date(e.endAt || e.startAt) > t
    && (e.createdBy === currentUser.id || e.googleOwner === currentUser.id || (e.attendeeIds || []).includes(currentUser.id)))) return;
  const left = 18 * 60 - now.mins, m = items.find(x => x.kind === 'move' && !x.done && (x.minutes || 30) <= left);
  if(!m) return;
  const said = dpRingSay(`<b>About ${escapeHtml(dpMins(Math.floor(left / 15) * 15))} left today, and ${escapeHtml(m.title)} is still open.</b><span>Still doable.</span>`, 9000);
  if(said) try{ localStorage.setItem(dpRingKey('checkin'), '1'); }catch(e){}
}
function dpRingTick(){
  if(typeof currentUser === 'undefined' || !currentUser || typeof claudeDayPlanOn !== 'function' || !claudeDayPlanOn()){ dpRingUnmount(); return; }
  const today = dpTeamNow().date;
  // keep today's plan: on first use, every few minutes, and when the day changes under an open tab
  if(!dayPlan.loading && (!dayPlan.at || (dayPlan.date && dayPlan.date !== today && Date.now() - dpRing.lastLoad > 5 * 60000))){ dpRing.lastLoad = Date.now(); loadDayPlan(!!dayPlan.at); }
  else if(!dayPlan.loading && Date.now() - dayPlan.at > 5 * 60000) loadDayPlan();
  const p = dayPlanV3(), items = p && p.date === today ? dayPlanItems() : [];
  if(!items.length || dpRingHidden() || window.innerWidth < 760){ dpRingUnmount(); return; }
  dpRingUpdate(items);
  dpRingCheckIn(items);
  if(document.getElementById('dpBody')) dayPlanRedraw();
}
if(typeof window !== 'undefined' && !window._dpRingTimer){
  window._dpRingTimer = setInterval(dpRingTick, 2000);
  // a click or key often finishes something (a task to Done, a nudge sent): look again soon after
  document.addEventListener('pointerdown', () => { dpRing.lastActive = Date.now(); setTimeout(dpRingTick, 700); }, true);
  document.addEventListener('keydown', () => { dpRing.lastActive = Date.now(); }, true);
  document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible') dpRingTick(); });
}
