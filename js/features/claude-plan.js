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
function planWithClaude(id){
  const c = clients.find(x => x.id === id); if(!c) return;
  const text = claudePlanPrompt(c);
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
  const fresh = p && !p.empty && seen !== p.at;
  return `<button class="btn dp-btn" onclick="openDayPlan()" data-hovertip="Your plan for today, from Claude: each client’s next step, what they owe us and a win to aim for." data-tipdelay="1500">${CLAUDE_SPARK}Today’s Plan${fresh ? '<i class="dp-new" aria-label="New"></i>' : ''}</button>`;
}
// Each line is the real thing in Radar (Nov 25): the server sends what it's about (a task, a request from
// an email or a meeting, a WhatsApp request, a follow-up), so the plan has its buttons, not just words.
// "Today, first" is a checklist for the day (kept in this browser, with the plan it belongs to).
function dpDoneKey(){ return `bda_dayplan_done_${currentUser ? currentUser.id : ''}`; }
function dpDone(p){ try{ const v = JSON.parse(localStorage.getItem(dpDoneKey()) || 'null'); return v && p && v.at === p.at ? new Set(v.done || []) : new Set(); }catch(e){ return new Set(); } }
function dpTick(i){
  const p = dayPlan.plan; if(!p) return;
  const done = dpDone(p); done.has(i) ? done.delete(i) : done.add(i);
  try{ localStorage.setItem(dpDoneKey(), JSON.stringify({ at: p.at, done: [...done] })); }catch(e){}
  dayPlanRedraw();
}
function dpFirst(p){ return (p.first || []).map(f => typeof f === 'string' ? (() => { const m = f.match(/^([^:]+):\s*(.+)$/); const c = m && clients.find(x => x.name === m[1].trim()); return { id: c ? c.id : null, client: c ? c.name : '', text: c ? m[2] : f, ref: null }; })() : f); }
function dpTask(ref){ return ref && ref.kind === 'task' && typeof tasks !== 'undefined' ? (tasks || []).find(t => String(t.id) === String(ref.id)) || null : null; }
// what a line is, in a few words, and its buttons
function dpRefMeta(ref){
  if(!ref) return '';
  if(ref.kind === 'task'){
    const t = dpTask(ref); if(!t) return 'Your task';
    if(t.status === 'done') return 'Your task · done';
    const today = toDateStr(rNow()), due = t.dueDate ? new Date(t.dueDate + 'T12:00:00') : null;
    return `Your task${due ? ` · due ${fmtShortDate(due)}` : ''}${t.dueDate && t.dueDate < today ? ' · late' : ''}`;
  }
  return { suggestion: 'They asked for it · not in your tasks yet', wa: 'Their WhatsApp request', reminder: 'Your follow-up' }[ref.kind] || '';
}
function dpNextActs(c){
  const r = c.nextRef, A = jsArg, sm = (label, js, cls) => `<button type="button" class="btn sm${cls ? ' ' + cls : ''}" onclick="${js}">${label}</button>`;
  if(r && r.kind === 'task'){
    const t = dpTask(r);
    if(t && t.status === 'done') return `<span class="dp-ok">${icon('check', { weight: 'bold' })}Done</span>`;
    return sm('Open', `dpGo(() => notifOpenTask(${A(r.id)}))`) + (t && t.assigneeId === currentUser.id ? sm(`${icon('check')}Mark Done`, `dpGo(() => moveTaskToStatus(${A(r.id)}, 'done'))`) : '');
  }
  if(r && r.kind === 'suggestion') return sm(`${icon('plus')}Add to My Tasks`, `dpAddSuggestion(${A(r.id)}, this)`);
  if(r && r.kind === 'wa') return sm('Open', `dpGo(() => waOpenItem(${A(r.id)}))`);
  return sm(`${icon('plus')}Add as Task`, `dpGo(() => openNewTaskModal(currentUser.id, 'todo', { clientId: ${A(c.id)}, title: ${A(c.next)}, due: toDateStr(rNow()) }))`);
}
function dpOweActs(c){
  const r = c.oweRef, A = jsArg;
  return r && r.kind === 'reminder' ? `<button type="button" class="btn sm" onclick="dpGo(() => openReminderDetailModal(${A(r.id)}))">Follow Up</button>`
    : `<button type="button" class="btn sm" onclick="dpGo(() => openNewReminderModal(${A(c.id)}))">${icon('plus')}Add Follow-Up</button>`;
}
// out of the plan and on to the thing (the plan opens again from the toolbar)
function dpGo(fn){ closeAppModal(); setTimeout(fn, 0); }
async function dpAddSuggestion(id, btn){
  if(btn){ btn.disabled = true; btn.textContent = 'Adding…'; }
  if(typeof taskSuggestions === 'undefined' || !taskSuggestions || !taskSuggestions.some(x => x.id === id)) await loadTaskSuggestions();
  const r = await addSuggestedTask(id);
  if(!btn || !btn.isConnected) return;
  if(r.error){ btn.disabled = false; btn.innerHTML = `${icon('plus')}Add to My Tasks`; showToast('info', 'Not added', r.error.message === 'Already decided.' ? 'It was already added or dismissed in Tasks.' : r.error.message); return; }
  btn.outerHTML = `<span class="dp-ok">${icon('check', { weight: 'bold' })}${r.already ? 'Already yours' : 'In your tasks'}</span>`;
}
function dayPlanBodyHtml(){
  const d = dayPlan;
  if(d.making) return `<div class="dp-wait">${CLAUDE_SPARK}<p>Claude is writing your plan…</p><span>It reads your tasks, sprints, follow-ups, client emails and WhatsApp. About half a minute.</span></div>`;
  if(d.loading && !d.plan) return `<div class="dp-wait"><p>Loading…</p></div>`;
  if(d.error && !d.plan) return emptyState({ icon: 'refresh-cw', title: 'The plan couldn’t be loaded', text: d.error, action: 'Try Again', onAction: 'loadDayPlan(true)' });
  const p = d.plan;
  if(!p) return emptyState({ icon: 'sparkle', title: 'No plan for today yet', text: `Claude writes it each weekday morning. ${d.last ? 'Yours from ' + fmtShortDate(new Date(d.last + 'T12:00:00')) + ' is out of date. ' : ''}You can have it written now.`, action: 'Make Today’s Plan', onAction: 'makeDayPlanNow()' });
  if(p.empty) return emptyState({ icon: 'check-circle', tone: 'ok', title: 'Nothing on your clients today', text: 'No open tasks, sprints, follow-ups or requests for the clients you work on.' });
  const A = id => jsArg(id), done = dpDone(p), first = dpFirst(p);
  const nDone = first.filter((f, i) => done.has(i)).length;
  const firstHtml = first.length ? `<section class="dp-first"><header><h4>Today, first</h4><span class="dp-prog${nDone === first.length ? ' is-all' : ''}">${nDone === first.length ? 'All done' : `${nDone} of ${first.length} done`}</span></header>
<ol>${first.map((f, i) => `<li class="${done.has(i) ? 'is-done' : ''}"><button type="button" class="dp-ck" role="checkbox" aria-checked="${done.has(i)}" aria-label="${escapeHtml(f.text)}" onclick="dpTick(${i})">${done.has(i) ? icon('check', { weight: 'bold' }) : ''}</button><span class="dp-ft">${f.client ? `<em>${escapeHtml(f.client)}</em>` : ''}<span>${escapeHtml(f.text)}</span></span></li>`).join('')}</ol></section>` : '';
  const line = (cls, ic, label, text, meta, acts) => `<div class="dp-ln ${cls}"><span class="dp-ic" aria-hidden="true">${icon(ic)}</span><div class="dp-tx"><span class="dp-k">${label}</span><p>${escapeHtml(text)}</p>${meta ? `<span class="dp-m">${escapeHtml(meta)}</span>` : ''}</div>${acts ? `<div class="dp-acts">${acts}</div>` : ''}</div>`;
  const rows = (p.clients || []).map(c => `<section class="dp-cl"><header><a href="#" onclick="closeAppModal();openClientDetail(${A(c.id)});return false;">${escapeHtml(c.client)}${icon('chevron-right')}</a>${c.addon ? addonTagHtml('') : ''}</header>
${c.next ? line('dp-next', 'arrow-right', 'Next step', c.next, dpRefMeta(c.nextRef), dpNextActs(c)) : ''}
${c.owe ? line('dp-owe', 'clock', 'They owe us', c.owe, '', dpOweActs(c)) : ''}
${c.win ? line('dp-win', 'target', 'Win to aim for', c.win, '', '') : ''}
${c.addon ? line('dp-add', 'circle-plus', 'Add-on to offer', c.addon, '', `<button type="button" class="btn sm" onclick="dpGo(() => planWithClaude(${A(c.id)}))">${CLAUDE_SPARK}Plan with Claude</button>`) : ''}</section>`).join('');
  const when = p.at ? fmtTime(new Date(p.at)) : '';
  return `${firstHtml}<div class="dp-list">${rows}</div><p class="dp-foot">${CLAUDE_SPARK}<span>Written by Claude${when ? ` at ${escapeHtml(when)}` : ''} from your tasks, sprints, follow-ups, client emails and WhatsApp. · <button type="button" class="x-lnk" onclick="makeDayPlanNow()">Write It Again</button></span></p>`;
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
