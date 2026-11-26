// Plan with Claude (Nov 25). From Health (and a client's panel and page), open Claude with a message
// ready to get the client's next step done: who they are, what they pay us for (their Harvest projects,
// the areas those cover, their scope of work, their hours), why Radar flags them, the next step, the
// work logged lately, what's still open and what they owe us. Claude is asked to stay inside that scope
// (and say when something isn't, as an add-on to offer), plan the step, start on it with you, and end
// with a win for the client. claude.ai/new?q= only fills Claude's message box: nothing is sent until
// you send it there. With the Radar connection in that chat, Claude can read more and log the work back.

const CLAUDE_PROMPT_MAX = 7000;
function claudeClip(s, n){ s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; }
function claudeEnd(s){ s = String(s || '').trim(); return /[.!?…]$/.test(s) ? s : s + '.'; }
function claudeBare(s){ return String(s || '').trim().replace(/[.\s]+$/, ''); }
function claudeDay(d){ const x = d instanceof Date ? d : new Date(d); return isNaN(x) ? '' : fmtShortDate(x); }

function claudePlanPrompt(c){
  const h = clientHealth(c), next = nextStepTask(c), owner = clientOwner(c);
  const areas = typeof waClientAreas === 'function' ? waClientAreas(c) : null;
  const areaWords = areas && areas.length ? waWords(areas) : '';
  const services = [...new Set((c.service || '').split(/\s*·\s*/).map(s => s.trim()).filter(Boolean))];
  const who = t => ((typeof teamProfiles !== 'undefined' ? teamProfiles : []).find(p => p.id === t.assigneeId) || {}).name || '';
  const work = (h.work && h.work.signals ? h.work.signals : h.signals || []).filter(s => s.key !== 'flag' && s.key !== 'concern');
  const flags = (h.flag ? [`Risk ${h.flag.danger} of 5${h.flag.reason ? `: ${h.flag.reason}` : ''}`] : []).concat((h.concerns || []).map(k => `A teammate’s concern: ${k.reason}`));
  const imps = (c.improvements || []).filter(i => !i.deletedAt).slice().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 8);
  const open = (typeof tasks !== 'undefined' ? tasks : []).filter(t => t.clientId === c.id && t.status !== 'done' && !t.cancelledAt && (!next || t.id !== next.id)).slice(0, 6);
  const owes = (typeof clientReminders !== 'undefined' ? clientReminders : []).filter(r => r.clientId === c.id && r.status === 'waiting').slice(0, 5);
  const sent = typeof lastSentAt === 'function' ? lastSentAt(c) : null;
  const domain = String(c.email || '').split(/[,;\s]+/).map(e => e.split('@')[1]).find(Boolean) || '';
  const site = String(c.website || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const L = [];
  L.push(`I work at Based Agency, a marketing agency for home service and remodeling companies. Help me get this client’s next step done today, so we can show them a win fast.`);
  L.push('');
  L.push(`Client: ${c.name}${site ? ` (${site})` : ''}${owner ? `. Owner on our team: ${owner}` : ''}${clientContact(c) ? `. Their contact: ${clientContact(c)}` : ''}.`);
  L.push(`What they pay us for: ${services.length ? services.join(', ') : 'not set in Radar'}${areaWords ? `. That covers: ${areaWords}` : ''}.`);
  if(c.sow) L.push(`Scope of work: ${claudeClip(c.sow, 900)}`);
  if(c.monthlyHourBudget) L.push(`Hours in their plan: ${c.monthlyHourBudget} a month.`);
  L.push('');
  if(work.length || flags.length) L.push(claudeEnd(`Why Radar flags them: ${work.map(s => s.text ? `${claudeBare(s.title)} (${claudeBare(claudeClip(s.text, 160))})` : claudeBare(s.title)).concat(flags.map(f => claudeBare(claudeClip(f, 200)))).join('; ')}`));
  if(next){
    L.push(`Next step: ${next.title}${next.dueDate ? `, due ${claudeDay(next.dueDate + 'T12:00:00')}` : ''}${who(next) ? `, assigned to ${who(next)}` : ''}.`);
    const notes = String(next.description || '').replace(/next step/ig, '').replace(/^[\s:;,.–—-]+/, '').trim();
    if(notes) L.push(`Task notes: ${claudeEnd(claudeClip(notes, 600))}`);
  } else L.push('Next step: none planned yet. Suggest the best one for what Radar flags, then plan it.');
  if(imps.length){ L.push(''); L.push('Work we logged lately:'); imps.forEach(i => L.push(`- ${claudeDay(i.date)}${i.author ? `, ${firstName(i.author)}` : ''}: ${claudeClip(i.text, 220)}`)); }
  if(open.length) L.push(claudeEnd(`Other open tasks: ${open.map(t => claudeBare(claudeClip(t.title, 90))).join('; ')}`));
  if(owes.length) L.push(claudeEnd(`Waiting on them: ${owes.map(r => claudeClip(r.question, 120)).join('; ')}`));
  L.push(`Last update we sent them: ${sent ? claudeDay(sent) : 'none yet'}.`);
  L.push('');
  L.push('What I need:');
  L.push(`1. Stay inside what they pay us for${areaWords ? ` (${areaWords})` : ''}. If the next step needs work outside that, say so in one line and suggest how to offer it to them as an add-on instead of doing it.`);
  L.push('2. Plan the next step as 3 to 6 concrete steps, each with who on our side does it and roughly how long it takes.');
  L.push('3. Then start on step 1 with me: draft the actual work (copy, ad variations, a page section, a message to the client, whatever fits).');
  L.push('4. End with a one-line win we can send the client once it’s done: specific and positive, with no mention of problems or delays.');
  L.push('');
  L.push(`If the Radar connector is on in this chat, use it for more context (get_client "${c.name}": what they asked for in the emails Radar read, and its meetings), and when we’re done, offer to log the time and the work in Radar and mark the task done; ask me first.${domain ? ` If Gmail is connected, check the latest emails with ${domain} for anything that changes the plan.` : ''}`);
  let out = L.join('\n');
  if(out.length > CLAUDE_PROMPT_MAX) out = out.slice(0, CLAUDE_PROMPT_MAX - 1) + '…';
  return out;
}
function claudeNewChatUrl(prompt){ return 'https://claude.ai/new?q=' + encodeURIComponent(prompt); }
// Plan with Claude (Nov 25, later): a popup with the message, to read and change, then Copy Prompt (to
// paste wherever you use Claude) or Open in Claude (a new chat with it filled in; nothing is sent).
function planWithClaude(id, extra){
  const c = clients.find(x => x.id === id); if(!c) return;
  const text = claudePlanPrompt(c) + (extra ? `\n\nWhat I want to think through with you: ${extra}` : '');
  openAppModal(`<h3 class="cpp-h">${CLAUDE_SPARK}<span>Plan with Claude</span><small>${escapeHtml(c.name)}</small></h3>
<p class="cpp-sub">The message for Claude: this client’s next step, what they pay us for and what’s open. Change anything you like, then copy it or open it in Claude. Nothing is sent until you send it.</p>
<textarea id="cppText" class="tf cpp-text" spellcheck="true" aria-label="The message for Claude">${escapeHtml(text)}</textarea>
<div class="sheet-a"><span class="cpp-n" id="cppN"></span><button class="btn" onclick="closeAppModal()">Cancel</button><button class="btn" id="cppCopy" onclick="planWithClaudeCopy()">${icon('copy')}Copy Prompt</button><button class="btn cl-claude-btn" id="cppOpen" onclick="planWithClaudeOpen()">${CLAUDE_SPARK}Open in Claude</button></div>`, 680);
  const ta = document.getElementById('cppText');
  const count = () => { const n = document.getElementById('cppN'); if(n && ta) n.textContent = `${ta.value.length.toLocaleString('en-US')} characters`; };
  if(ta){ ta.addEventListener('input', count); count(); setTimeout(() => { ta.scrollTop = 0; document.getElementById('cppCopy')?.focus({ preventScroll: true }); }, 30); }
}
function planWithClaudeText(){ return (document.getElementById('cppText')?.value || '').trim(); }
async function planWithClaudeCopy(){
  const t = planWithClaudeText(); if(!t) return;
  const btn = document.getElementById('cppCopy');
  let done = false;
  try{ await navigator.clipboard.writeText(t); done = true; }catch(e){
    const ta = document.getElementById('cppText');
    if(ta){ ta.focus(); ta.select(); try{ done = document.execCommand('copy'); }catch(e2){} }
  }
  if(!done){ showToast('error', 'Couldn’t copy', 'Select the message and copy it yourself.'); return; }
  if(btn){ btn.innerHTML = `${icon('check')}Copied`; setTimeout(() => { if(btn.isConnected) btn.innerHTML = `${icon('copy')}Copy Prompt`; }, 1800); }
  showToast('success', 'Copied', 'Paste it in a Claude chat or project.');
}
function planWithClaudeOpen(){
  const t = planWithClaudeText(); if(!t) return;
  window.open(claudeNewChatUrl(t), '_blank', 'noopener');
  closeAppModal();
  showToast('info', 'Opened in Claude', 'The message is ready there, in a new tab. Read it over, then send it.');
}
// The button (Nov 25): Claude's own orange with its mark, between Mark Handled and the next step's
// button. The button is its own tip: held under the pointer for 1.5 s it says, briefly, what it does.
const CLAUDE_PLAN_TIP = 'A message for Claude with this client’s next step, inside what they pay us for: copy it or open it in Claude.';
function planWithClaudeHtml(id, small){
  const A = jsArg(id), tip = escapeHtml(CLAUDE_PLAN_TIP);
  return small
    ? `<button class="btn sm cl-claude is-ic" onclick="event.stopPropagation();planWithClaude(${A})" aria-label="Plan with Claude" data-hovertip="Plan with Claude. ${tip}">${appLogo('claude', 'xs')}</button>`
    : `<button class="btn cl-claude-btn" onclick="event.stopPropagation();planWithClaude(${A})" data-hovertip="${tip}" data-tipdelay="1500">${CLAUDE_SPARK}Plan with Claude</button>`;
}

// ---- Claude inside Radar (Nov 25) ---------------------------------------------------------------
// For people whose team card has the Assistant on. The server runs Claude on the agency's key
// (lib/claude-radar.js); what someone asks for counts toward the Assistant's 40 a day.
function dayPlanToolbarHtml(){
  if(!claudeOn()) return '';
  if(!dayPlan.at && !dayPlan.loading) setTimeout(() => loadDayPlan(), 0);
  const p = dayPlan.plan, seen = (() => { try{ return localStorage.getItem(dayPlanSeenKey()); }catch(e){ return null; } })();
  const fresh = p && p.v === 2 && !p.empty && seen !== p.at;
  return `<button class="btn dp-btn" onclick="openDayPlan()" data-hovertip="Your day, planned by Claude: the schedule, what’s ready to send, and what’s coming." data-tipdelay="1500">${CLAUDE_SPARK}Today’s Plan${fresh ? '<i class="dp-new" aria-label="New"></i>' : ''}</button>`;
}
// Today's Plan v2 (Nov 25): what Claude made this morning (lib/claude-radar.js), to work from.
//  • Schedule: today's work around your meetings. Each block is in your Tasks (a request from an email
//    or meeting became your task; new work a new task), due today at its time: Start, Open, Mark Done.
//    Each client meeting has what to bring up.
//  • Ready to send: the follow-ups due, written as Radar's Nudge (Review and Send opens it in
//    Reminders), and your part of the win updates due, written for you (Send to Review).
//  • Looking ahead: what's coming for your clients and what to do, as a sprint, tasks or with Claude.
const DP_KIND = { risk: ['triangle-alert', 'Risk'], improve: ['target', 'Improve'], addon: ['circle-plus', 'Add-on'], prep: ['calendar', 'Get ready'] };
function dpGo(fn){ closeAppModal(); setTimeout(fn, 0); }
function dpTaskOf(id){ return id && typeof tasks !== 'undefined' ? (tasks || []).find(t => String(t.id) === String(id)) || null : null; }
function dpTime(hm){ return fmtTime(new Date(`2000-01-01T${hm}:00`)); }
function dpMins(n){ const h = Math.floor(n / 60), m = n % 60; return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`; }
function dpBlockHtml(b){
  const A = jsArg, sm = (label, js, cls) => `<button type="button" class="btn sm${cls ? ' ' + cls : ''}" onclick="${js}">${label}</button>`;
  if(b.kind === 'meeting') return `<div class="dp-row is-meet"><span class="dp-t">${escapeHtml(dpTime(b.start))}</span><div class="dp-blk"><div class="dp-bh">${icon('calendar')}<b>${escapeHtml(b.title)}</b><span class="dp-m">${b.client ? escapeHtml(b.client) + ' · ' : ''}${escapeHtml(dpMins(b.minutes))}</span>${b.url ? `<a class="btn sm" href="${safeUrl(b.url)}" target="_blank" rel="noopener">Join</a>` : ''}</div>
${b.prep && b.prep.length ? `<ul class="dp-prep">${b.prep.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : ''}</div></div>`;
  const t = dpTaskOf(b.taskId), done = t && t.status === 'done', today = toDateStr(rNow());
  const meta = [b.client, dpMins(b.minutes), b.from === 'suggestion' ? 'their request, now in your tasks' : b.from === 'new' ? 'new task' : b.kind === 'wa' ? 'WhatsApp request' : '', t && t.dueDate && t.dueDate < today ? 'late' : ''].filter(Boolean).join(' · ');
  const acts = done ? `<span class="dp-ok">${icon('check', { weight: 'bold' })}Done</span>`
    : (b.clientId ? sm(`${icon('timer')}Start`, `dpGo(() => openTimerModal(${A(b.clientId)}))`) : '')
      + (b.taskId ? sm('Open', `dpGo(() => notifOpenTask(${A(b.taskId)}))`) + (t && t.assigneeId === currentUser.id ? sm(`${icon('check')}Done`, `dpGo(() => moveTaskToStatus(${A(b.taskId)}, 'done'))`) : '')
        : b.waId ? sm('Open', `dpGo(() => waOpenItem(${A(b.waId)}))`) : '');
  return `<div class="dp-row${done ? ' is-done' : ''}"><span class="dp-t">${escapeHtml(dpTime(b.start))}</span><div class="dp-blk"><div class="dp-bh"><b>${escapeHtml(b.title)}</b><div class="dp-acts">${acts}</div></div><span class="dp-m">${escapeHtml(meta)}</span></div></div>`;
}
// a follow-up Claude wrote: to Reminders, the Nudge open with it, to read and send
async function dpNudge(i){
  const f = ((dayPlan.plan || {}).followUps || [])[i]; if(!f) return;
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
async function dpWinToReview(i, btn){
  const w = ((dayPlan.plan || {}).wins || [])[i]; if(!w) return;
  if(btn){ btn.disabled = true; btn.textContent = 'Sending…'; }
  if(typeof loadAll === 'function') await loadAll();
  await sendDraftForReview(w.clientId, myName());
  const c = clients.find(x => x.id === w.clientId), d = c && typeof getDraftFor === 'function' ? getDraftFor(c, myName()) : null;
  if(d && d.readyToNotify){ w.state = 'review'; dayPlanRedraw(); }
  else if(btn && btn.isConnected){ btn.disabled = false; btn.textContent = 'Send to Review'; }
}
// a proposal's steps as your tasks (no date: you place them)
async function dpAddSteps(i, btn){
  const x = ((dayPlan.plan || {}).ahead || [])[i]; if(!x) return;
  if(btn){ btn.disabled = true; btn.textContent = 'Adding…'; }
  let n = 0;
  for(const step of x.steps){
    const res = await insertTaskRow({ title: step, description: `${x.title}. ${x.why}`, priority: 'medium', status: 'todo', assigner_id: currentUser.id, assignee_id: currentUser.id, client_id: x.clientId || null, due_date: null });
    if(!res.error && res.data){ n++; if(typeof tasks !== 'undefined' && Array.isArray(tasks) && typeof taskFromDb === 'function') tasks.push(taskFromDb(res.data)); }
  }
  if(btn && btn.isConnected) btn.outerHTML = `<span class="dp-ok">${icon('check', { weight: 'bold' })}${n} task${n === 1 ? '' : 's'} added</span>`;
  showToast(n ? 'success' : 'error', n ? `${n} task${n === 1 ? '' : 's'} added` : 'No tasks added', n ? `For ${x.client}, in your Tasks with no date yet.` : 'Try again in a moment.');
}
function dpAheadHtml(x, i){
  const A = jsArg, [ic, word] = DP_KIND[x.kind] || DP_KIND.improve;
  const act = x.action === 'sprint' ? `<button type="button" class="btn sm" onclick="dpGo(() => openNewSprintModal({ clientId: ${A(x.clientId)}, preset: { title: ${A(x.title)}, goal: ${A(x.why)}, steps: ${escapeHtml(JSON.stringify(x.steps))} } }))">${icon('route')}Make It a Sprint</button>`
    : x.action === 'claude' ? `<button type="button" class="btn sm" onclick="dpGo(() => planWithClaude(${A(x.clientId)}, ${A(`${x.title}. ${x.why}\nSteps I have in mind: ${x.steps.join('; ')}.`)}))">${CLAUDE_SPARK}Plan with Claude</button>`
    : `<button type="button" class="btn sm" onclick="dpAddSteps(${i}, this)">${icon('plus')}Add as Tasks</button>`;
  return `<div class="dp-ah is-${escapeHtml(x.kind)}"><div class="dp-bh"><span class="dp-kind">${icon(ic)}${word}</span><b><a href="#" onclick="dpGo(() => openClientDetail(${A(x.clientId)}));return false;">${escapeHtml(x.client)}</a>: ${escapeHtml(x.title)}</b></div>
<p class="dp-why">${escapeHtml(x.why)}</p><ol class="dp-steps">${x.steps.map(st => `<li>${escapeHtml(st)}</li>`).join('')}</ol><div class="dp-acts">${act}</div></div>`;
}
function dayPlanBodyHtml(){
  const d = dayPlan;
  if(d.making) return `<div class="dp-wait">${CLAUDE_SPARK}<p>Claude is planning your day…</p><span>Your calendar, tasks, clients’ requests and follow-ups, logged work and what’s coming. About half a minute.</span></div>`;
  if(d.loading && !d.plan) return `<div class="dp-wait"><p>Loading…</p></div>`;
  if(d.error && !d.plan) return emptyState({ icon: 'refresh-cw', title: 'The plan couldn’t be loaded', text: d.error, action: 'Try Again', onAction: 'loadDayPlan(true)' });
  const p = d.plan && d.plan.v === 2 ? d.plan : null;
  if(!p) return emptyState({ icon: 'sparkle', title: 'No plan for today yet', text: d.plan ? 'Today’s Plan now schedules your day, prepares your follow-ups and updates, and looks ahead. Have Claude write today’s.' : `Claude writes it each weekday morning. ${d.last ? 'Yours from ' + fmtShortDate(new Date(d.last + 'T12:00:00')) + ' is out of date. ' : ''}You can have it written now.`, action: 'Make Today’s Plan', onAction: 'makeDayPlanNow()' });
  if(p.empty) return emptyState({ icon: 'check-circle', tone: 'ok', title: 'Nothing on your clients today', text: 'No meetings, open tasks, sprints, follow-ups or requests for the clients you work on.' });
  const work = p.schedule.filter(b => b.kind !== 'meeting'), meets = p.schedule.filter(b => b.kind === 'meeting');
  const mins = work.reduce((a, b) => a + (b.minutes || 0), 0), made = (p.made || []).length;
  const sum = [`${dpMins(mins)} of work`, meets.length ? `${meets.length} meeting${meets.length === 1 ? '' : 's'}` : '', made ? `${made} new task${made === 1 ? '' : 's'} in your Tasks` : ''].filter(Boolean).join(' · ');
  const ready = [
    ...(p.followUps || []).map((f, i) => `<div class="dp-rd"><span class="dp-ric">${icon(f.ch === 'whatsapp' ? 'message-circle' : 'mail')}</span><div class="dp-rt"><b>${escapeHtml(f.client)}: follow-up</b><span class="dp-m">${escapeHtml(f.ask)}</span></div><div class="dp-acts"><button type="button" class="btn sm" onclick="dpNudge(${i})">Review and Send</button></div></div>`),
    ...(p.wins || []).map((w, i) => `<div class="dp-rd"><span class="dp-ric">${icon('star')}</span><div class="dp-rt"><b>${escapeHtml(w.client)}: your win update</b><span class="dp-m">${w.wins} win${w.wins === 1 ? '' : 's'} · ${w.due < 0 ? 'late' : w.due === 0 ? 'due today' : w.due === 1 ? 'due tomorrow' : `due in ${w.due} days`}</span></div><div class="dp-acts">${
      w.state === 'review' ? '<span class="dp-ok">In Review</span>' : w.state === 'approved' ? '<span class="dp-ok">Approved</span>'
        : `<button type="button" class="btn sm" onclick="dpGo(() => openWeekClient(${jsArg(w.clientId)}))">Read</button><button type="button" class="btn sm" onclick="dpWinToReview(${i}, this)">Send to Review</button>`}</div></div>`)].join('');
  const when = p.at ? fmtTime(new Date(p.at)) : '';
  return `<p class="dp-sum">${escapeHtml(sum)}</p>
<section class="dp-sec"><h4>Schedule</h4><div class="dp-sch">${p.schedule.length ? p.schedule.map(dpBlockHtml).join('') : '<p class="dp-m">Nothing scheduled.</p>'}</div></section>
${ready ? `<section class="dp-sec"><h4>Ready to send</h4><div class="dp-rds">${ready}</div></section>` : ''}
${(p.ahead || []).length ? `<section class="dp-sec"><h4>Looking ahead</h4><div class="dp-ahs">${p.ahead.map(dpAheadHtml).join('')}</div></section>` : p.aheadMissed ? '<p class="dp-m">The look ahead didn’t come back this time. Write It Again to try.</p>' : ''}
<p class="dp-foot">${CLAUDE_SPARK}<span>Planned by Claude${when ? ` at ${escapeHtml(when)}` : ''} from your calendar, tasks, clients’ requests, follow-ups and logged work. · <button type="button" class="x-lnk" onclick="makeDayPlanNow()">Write It Again</button></span></p>`;
}
function dayPlanRedraw(){ const b = document.getElementById('dpBody'); if(b) b.innerHTML = dayPlanBodyHtml(); }
function openDayPlan(){
  const p = dayPlan.plan;
  if(p) try{ localStorage.setItem(dayPlanSeenKey(), p.at); }catch(e){}
  const day = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  openAppModal(`<h3 class="dp-h">${CLAUDE_SPARK}<span>Today’s Plan</span><small>${escapeHtml(day)}</small></h3><div class="dp" id="dpBody">${dayPlanBodyHtml()}</div><div class="sheet-a"><button class="btn btn-p" id="dpDone" onclick="closeAppModal()">Done</button></div>`, 700);
  setTimeout(() => document.getElementById('dpDone')?.focus({ preventScroll: true }), 30);   // not on the first client's name
  if(currentViewName === 'overview') setToolbarActions('overview');
  if(!dayPlan.plan && !dayPlan.loading) loadDayPlan(true);
}
async function makeDayPlanNow(){
  if(dayPlan.making) return;
  dayPlan = { ...dayPlan, making: true, error: null }; dayPlanRedraw();
  try{ localStorage.removeItem(dpDoneKey()); }catch(e){}
  const r = await claudeApi({ action: 'day-plan' });
  dayPlan = r.error ? { ...dayPlan, making: false } : { ...r, at: Date.now() };
  if(r.error) showToast('error', 'The plan wasn’t written', r.error);
  else try{ localStorage.setItem(dayPlanSeenKey(), r.plan && r.plan.at); }catch(e){}
  dayPlanRedraw();
  if(currentViewName === 'overview') setToolbarActions('overview');
}

// A meeting → a sprint: from a meeting's notes in Radar, Claude drafts the sprint and Plan's New Sprint
// opens filled in, to check and save (plan.js psFillFromMeeting).
function meetingSprintBtnHtml(m){
  if(!claudeOn() || !m || !(m.clientId || m.metClientId)) return '';
  return `<button type="button" class="btn sm cl-claude-btn mtn-sprint" onclick="meetingToSprint(${jsArg(m.id)})" data-hovertip="Claude turns this meeting’s action items into a sprint in your Plan, inside what the client pays for. You check it before it’s saved." data-tipdelay="1500">${CLAUDE_SPARK}<span>Plan a Sprint</span></button>`;
}
function meetingToSprint(id){
  const m = (granolaMeetings || []).find(x => x.id === id); if(!m) return;
  closeAppModal();
  openNewSprintModal({ meetingId: id, clientId: m.clientId || m.metClientId || '' });
}
