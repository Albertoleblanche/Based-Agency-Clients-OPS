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

// Today's Plan lives in day-plan.js (the sheet and the corner ring).

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

// ---- Claude's notes on a client (Nov 25) ---------------------------------------------------------
// What you're missing, tips and ideas: Claude reads a client again by itself whenever something new
// comes in (a meeting note, a client email, a WhatsApp message; lib/client-insights.js). On the client's
// panel (Health, All Clients) and its page, for the people the client belongs to. Settings → AI turns
// them off. Each note says where it comes from and has its button; Dismiss for good.
let claudeNotes = { at: 0, by: {} };   // client id → { at, reason, notes, dismissed }
function claudeNotesOn(){ return claudeOn() && !(typeof settings !== 'undefined' && settings && settings.claudeNotes === false); }
// yours: you own it, have open tasks for it, or worked on it lately
function claudeMine(c){
  if(!c || typeof currentUser === 'undefined' || !currentUser) return false;
  const me = typeof myName === 'function' ? myName() : '';
  if(me && (typeof clientOwner === 'function' ? clientOwner(c) : (c.customFieldValues || {}).owner) === me) return true;
  if(typeof tasks !== 'undefined' && (tasks || []).some(t => t.clientId === c.id && t.assigneeId === currentUser.id && t.status !== 'done' && !t.cancelledAt)) return true;
  return typeof waRecentIds === 'function' && waRecentIds().has(c.id);
}
async function loadClaudeNotes(force){
  if(!claudeNotesOn() || claudeNotes.loading || (!force && claudeNotes.at && Date.now() - claudeNotes.at < 3 * 60000)) return;
  claudeNotes.loading = true;
  const { data, error } = await supabaseClient.from('app_storage').select('key, value').like('key', 'client-insights:%');
  const by = {};
  (error ? [] : data || []).forEach(r => { try{ by[r.key.slice('client-insights:'.length)] = typeof r.value === 'string' ? JSON.parse(r.value) : r.value; }catch(e){} });
  claudeNotes = { at: Date.now(), by: error ? claudeNotes.by : by };
  claudeNotesRedraw();
}
// draws each notes section on screen again, in place
function claudeNotesRedraw(){
  if(typeof cnNavDot === 'function') cnNavDot();
  if(typeof currentViewName !== 'undefined' && currentViewName === 'health' && typeof renderHealth === 'function'){ renderHealth(); return; }
  if(typeof currentViewName !== 'undefined' && currentViewName === 'plan' && typeof renderPlan === 'function') renderPlan();   // Claude's ideas in Worth planning
  document.querySelectorAll('[data-cn-client]').forEach(el => {
    const c = clients.find(x => x.id === el.dataset.cnClient); if(!c) return;
    el.outerHTML = claudeNotesHtml(c, el.dataset.cnWhere || 'panel');
  });
}
const CN_KIND = { missing: 'Missing', tip: 'Tip', idea: 'Idea' };
const CN_REASON = { new: 'after something new came in', first: 'first read', asked: 'when you asked' };
function cnAgo(at){ const m = Math.round((Date.now() - new Date(at)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 24 * 60 ? `${Math.round(m / 60)} h ago` : fmtShortDate(new Date(at)); }
function cnPlural(n, one, many){ return `${n} ${n === 1 ? one : many}`; }
function cnCounts(notes){ return ['missing', 'tip', 'idea'].map(k => [k, notes.filter(n => n.kind === k).length]).filter(x => x[1]); }
function cnCountWords(counts){ return counts.map(([k, n]) => k === 'missing' ? `${n} missing` : cnPlural(n, k, k + 's')).join(' · '); }

// Where a note comes from, as a link to it: what it is (its icon), a short name (the whole one on hover),
// and an arrow when it opens something. Nov 26: the icon says "email" or "meeting", so the name doesn't.
const CN_EV_ICON = { meeting: 'calendar', whatsapp: 'message-circle', warequest: 'message-circle', email: 'mail', task: 'square-check', reminder: 'bell', win: 'file-text', update: 'send', hours: 'clock' };
const CN_GO = '<svg class="cn-go" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>';
function cnEvShort(label){ const t = String(label || '').replace(/^(Email|Meeting) (?=\w{3} \d)/, '').replace(/^(Task|Follow-up|WhatsApp request): /, ''); return t.charAt(0).toUpperCase() + t.slice(1); }
function cnEvidenceHtml(c, e){
  const A = jsArg;
  const go = e.kind === 'meeting' && e.id ? `cnOpen(() => loadGranolaMeetings().then(() => openMeetingNotes(${A(e.id)})))`
    : e.kind === 'warequest' && e.id ? `cnOpen(() => waOpenItem(${A(e.id)}))`
    : e.kind === 'whatsapp' ? `cnOpen(() => switchView('whatsapp'))`
    : e.kind === 'task' && e.id ? `cnOpen(() => notifOpenTask(${A(e.id)}))`
    : e.kind === 'reminder' && e.id ? `cnOpen(async () => { if(!(clientReminders || []).some(r => r.id === ${A(e.id)})) await loadClientReminders(); openReminderDetailModal(${A(e.id)}); })`
    : e.kind === 'update' ? `cnOpen(() => openWeekClient(${A(c.id)}))` : '';
  const full = e.label || e.kind, ic = CN_EV_ICON[e.kind] ? icon(CN_EV_ICON[e.kind]) : '';
  const inner = `${ic}<span>${escapeHtml(cnEvShort(full))}</span>`;
  if(e.kind === 'email' && e.url) return `<a class="cn-ev" href="${safeUrl(e.url)}" target="_blank" rel="noopener" title="${escapeHtml(full)}">${inner}${CN_GO}</a>`;
  return go ? `<button type="button" class="cn-ev" onclick="${go}" title="${escapeHtml(full)}">${inner}${CN_GO}</button>` : `<span class="cn-ev is-plain" title="${escapeHtml(full)}">${inner}</span>`;
}
function cnOpen(fn){ if(document.getElementById('appModalOverlay')) closeAppModal(); setTimeout(fn, 0); }
// The note's one action. Add as Tasks adds the steps still checked (cnSkip), and says how many.
function cnTaskCount(c, n){ const sk = cnSkip[`${c.id}:${n.id}`], all = n.steps && n.steps.length ? n.steps.length : 1; return all - (sk ? sk.size : 0); }
function cnActHtml(c, n, primary){
  const A = jsArg, cls = `btn sm${primary ? ' btn-p' : ''} cn-go-btn`, b = (label, js, dis) => `<button type="button" class="${cls}" onclick="${js}"${dis ? ' disabled' : ''}>${label}</button>`;
  if(n.action === 'task'){ const k = cnTaskCount(c, n); return b(k === 1 ? 'Add 1 Task' : `Add ${k} Tasks`, `cnAddTasks(${A(c.id)}, ${A(n.id)}, this)`, !k); }
  return n.action === 'sprint' ? b('Make It a Sprint', `cnOpen(() => openNewSprintModal({ clientId: ${A(c.id)}, preset: { title: ${A(n.title)}, goal: ${A(n.why)}, steps: ${escapeHtml(JSON.stringify(n.steps || []))} } }))`)
    : n.action === 'message' && n.message ? b('Write to Them', `cnMessage(${A(c.id)}, ${A(n.id)})`)
    : n.action === 'claude' ? b(`${CLAUDE_SPARK}Plan with Claude`, `planWithClaude(${A(c.id)}, ${A(`${n.title}. ${n.why}`)})`) : '';
}
function cnFromHtml(c, n){ return (n.evidence || []).length ? `<div class="cn-from"><span class="cn-fl">From</span><div class="cn-evs">${n.evidence.map(e => cnEvidenceHtml(c, e)).join('')}</div></div>` : ''; }
function cnDismissHtml(c, n){ return `<button type="button" class="btn sm cn-dis" onclick="cnDismiss(${jsArg(c.id)}, ${jsArg(n.id)}, this)">Dismiss</button>`; }
function cnCheckHtml(js, busy, tip){ return `<button type="button" class="btn sm cn-check" onclick="${js}"${busy ? ' disabled' : ''} data-hovertip="${escapeHtml(tip)}" data-tipdelay="1200">${icon('refresh-cw')}${busy ? 'Reading…' : 'Check Now'}</button>`; }

// ---- A client's notes (Nov 26, canvas "Health: the client menu open, with Claude's real notes") ----------
// In the client's menu (and its page, and All Clients' fold) each note is a soft tile: its kind, then the
// title. One is open at a time, the first by default: why (three lines, More for the rest), the steps to
// check (unchecked ones aren't added), where it came from, its action and Dismiss. Missing comes first;
// tips and ideas wait behind "Show …" when there's something missing.
const cnPanelOpen = {}, cnPanelAll = {}, cnSkip = {};
function claudeNotesHtml(c, where){
  if(!c || !claudeNotesOn() || !claudeMine(c)) return '';
  if(!claudeNotes.at && !claudeNotes.loading) setTimeout(() => loadClaudeNotes(), 0);
  else if(Date.now() - claudeNotes.at > 3 * 60000) setTimeout(() => loadClaudeNotes(), 0);
  const v = claudeNotes.by[c.id], A = jsArg(c.id), notes = (v && v.notes) || [];
  const counts = cnCounts(notes), busy = !!cnBusy[c.id];
  const count = counts.length ? `<span class="cn-c">${cnCountWords(counts)}</span>` : '';
  const read = busy ? 'Reading now…' : v ? `Read ${cnAgo(v.at)}${CN_REASON[v.reason] ? ', ' + CN_REASON[v.reason] : ''}` : claudeNotes.at ? 'Not read yet' : '';
  const check = cnCheckHtml(`cnCheck(${A})`, busy, 'Claude reads this client again now: meetings, emails, WhatsApp, tasks, follow-ups and logged work. Counts toward your 40 a day.');
  const head = where === 'page' ? `<div class="uw-wh cn-h"><span class="uw-ic cn-ic">${CLAUDE_SPARK}</span><span class="uw-wt">Claude’s notes</span>${count}<span class="uw-sp"></span>${check}</div>`
    : where === 'fold' ? `<div class="cn-h is-fold">${count}<span class="cn-sp"></span>${check}</div>`
    : `<div class="cn-h">${CLAUDE_SPARK}<b>Claude’s notes</b>${count}<span class="cn-sp"></span>${check}</div>`;
  const sorted = cnSorted(cnNotesOf(c)), missing = sorted.filter(x => x.n.kind === 'missing'), rest = sorted.filter(x => x.n.kind !== 'missing');
  const showRest = !missing.length || cnPanelAll[c.id], shown = showRest ? sorted : missing;
  const openKey = cnPanelOpen[c.id] === undefined ? (shown[0] ? `${c.id}:${shown[0].n.id}` : null) : cnPanelOpen[c.id];
  const more = missing.length && rest.length ? `<button type="button" class="cn-rest" onclick="cnPanelAll[${A}] = !cnPanelAll[${A}]; claudeNotesRedraw()">${showRest ? 'Hide Tips and Ideas' : `Show ${cnCountWords(cnCounts(rest.map(x => x.n))).replace(/ · /g, ' and ').replace(/\b(tip|idea)s?\b/g, w => w[0].toUpperCase() + w.slice(1))}`}</button>` : '';
  const body = notes.length ? `<div class="cn-tiles">${shown.map(x => cnTileHtml(c, x.n, openKey === `${c.id}:${x.n.id}`)).join('')}</div>${more}`
    : v && !busy ? '<p class="cn-none">Nothing Claude would flag right now.</p>' : '';
  if(notes.length) cnClampSoon();
  const sec = `${head}${read ? `<p class="cn-read">${escapeHtml(read)}</p>` : ''}${body}`;
  return where === 'page'
    ? `<section class="uw-w cp-cn cn" data-cn-client="${escapeHtml(c.id)}" data-cn-where="page">${sec}</section>`
    : `<section class="cn cn-panel" data-cn-client="${escapeHtml(c.id)}" data-cn-where="${escapeHtml(where || 'panel')}">${sec}</section>`;
}
function cnTileHtml(c, n, open){
  const A = jsArg, key = `${c.id}:${n.id}`, sk = cnSkip[key] || new Set();
  const steps = (n.steps || []).filter(Boolean);
  const stepsHtml = !steps.length ? '' : n.action === 'task'
    ? `<ul class="cn-todo" aria-label="Steps to add as tasks">${steps.map((t, i) => `<li><label><input type="checkbox"${sk.has(i) ? '' : ' checked'} onchange="cnStep(${A(c.id)}, ${A(n.id)}, ${i}, this)"><span class="ck" aria-hidden="true">${icon('check', { weight: 'bold' })}</span><span class="tx">${escapeHtml(t)}</span></label></li>`).join('')}</ul>`
    : `<ol class="cn-steps">${steps.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ol>`;
  return `<div class="cnl cn-n cn-tile is-${escapeHtml(n.kind)}${open ? ' is-open' : ''}" data-cnl="${escapeHtml(key)}" data-cid="${escapeHtml(c.id)}">
<button type="button" class="cnl-h" aria-expanded="${open}" onclick="cnToggle(this, true)"><span class="cnl-top"><span class="cn-k">${CN_KIND[n.kind] || CN_KIND.tip}</span><i class="cnl-chev" aria-hidden="true"></i></span><span class="cnl-t">${escapeHtml(n.title)}</span></button>
<div class="cnl-d"><div class="cnl-di"><p class="cn-why is-clamp">${escapeHtml(n.why)}</p><button type="button" class="cn-more" hidden onclick="this.previousElementSibling.classList.remove('is-clamp'); this.remove()">More</button>
${stepsHtml}${cnFromHtml(c, n)}<div class="cn-foot">${cnActHtml(c, n, true)}<span class="cn-sp"></span>${cnDismissHtml(c, n)}</div></div></div></div>`;
}
// a step checked or not: the button counts the ones that will be added
function cnStep(id, noteId, i, box){
  const key = `${id}:${noteId}`, sk = cnSkip[key] || (cnSkip[key] = new Set());
  if(box.checked) sk.delete(i); else sk.add(i);
  const c = clients.find(x => x.id === id), n = ((claudeNotes.by[id] || {}).notes || []).find(x => x.id === noteId);
  const btn = box.closest('.cnl')?.querySelector('.cn-go-btn'); if(!c || !n || !btn) return;
  const k = cnTaskCount(c, n); btn.textContent = k === 1 ? 'Add 1 Task' : `Add ${k} Tasks`; btn.disabled = !k;
}
// "More" only where the why runs past its three lines
let cnClampT = 0;
function cnClampSoon(){ if(cnClampT) return; cnClampT = requestAnimationFrame(() => { cnClampT = 0;
  document.querySelectorAll('.cn-why.is-clamp').forEach(p => { const b = p.nextElementSibling; if(b && b.classList.contains('cn-more')) b.hidden = p.scrollHeight <= p.clientHeight + 1; }); }); }

// ---- Health's right column: Claude noticed (Nov 26, canvas "Health: 70/30, Claude noticed on the right") --
// The notes on the clients listed, yours: Missing first, then the clients needing care most, Focus, newest.
// Filters by kind; the first five, then Show More. Each note is its kind and its client over the title;
// click for why, where it came from, its action and Dismiss. Pointing at a note lights up its client's
// row (health.js hlBindPairs). Check Now reads again the clients here that need care, oldest read first.
const CN_RANK = { missing: 0, tip: 1, idea: 2 };
function cnSorted(list){
  const L = { r: 0, y: 1, h: 2, g: 3 };
  return list.sort((a, b) => (CN_RANK[a.n.kind] ?? 3) - (CN_RANK[b.n.kind] ?? 3) || (L[a.lv] ?? 3) - (L[b.lv] ?? 3)
    || (typeof focusFirst === 'function' ? focusFirst(a.c, b.c) : 0) || String(b.at || '').localeCompare(String(a.at || '')) || a.i - b.i);
}
function cnNotesOf(c, lv){ const v = claudeNotes.by[c.id]; return ((v && v.notes) || []).map((n, i) => ({ c, n, lv, at: v.at, i })); }
const cnOpenSet = new Set();
function claudeNoticedHtml(entries){
  if(!claudeNotesOn()) return '';
  if(!claudeNotes.at && !claudeNotes.loading) setTimeout(() => loadClaudeNotes(), 0);
  else if(claudeNotes.at && Date.now() - claudeNotes.at > 3 * 60000) setTimeout(() => loadClaudeNotes(), 0);
  const mine = entries.filter(x => claudeMine(x.c));
  const items = cnSorted(mine.flatMap(x => cnNotesOf(x.c, x.lv)));
  // who Check Now reads: yours that need care, the ones read longest ago (or never) first, three at most
  window._cnCands = mine.filter(x => x.lv === 'r' || x.lv === 'y').map(x => ({ id: x.c.id, at: (claudeNotes.by[x.c.id] || {}).at || '' }))
    .sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(0, 3).map(x => x.id);
  const busy = Object.keys(cnBusy).length > 0;
  const check = mine.length ? cnCheckHtml('cnCheckSome()', busy, 'Claude reads again the clients here that need care and were read longest ago, three at most. Each one counts toward your 40 a day.') : '';
  const head = `<div class="hcn-h"><span class="hcn-mark">${CLAUDE_SPARK}</span><b>Claude noticed</b><span class="cn-sp"></span>${check}</div>`;
  if(!items.length) return `<aside class="hcn" data-cn-feed aria-label="Claude noticed">${head}<p class="hcn-s">${claudeNotes.at ? 'Nothing Claude would flag on these clients right now.' : 'Reading Claude’s notes…'}</p></aside>`;
  const counts = cnCounts(items.map(x => x.n)), kinds = counts.map(x => x[0]);
  if(window._cnKind && !kinds.includes(window._cnKind)) window._cnKind = null;
  const kind = window._cnKind || null, list = kind ? items.filter(x => x.n.kind === kind) : items;
  const all = !!window._cnAll, shown = all ? list : list.slice(0, 5);
  const newest = items.reduce((m, x) => String(x.at || '') > m ? String(x.at) : m, '');
  const nClients = new Set(items.map(x => x.c.id)).size;
  const tab = (k, label, n) => `<button type="button" role="tab" class="${kind === k ? 'on' : ''}" aria-selected="${kind === k}" onclick="window._cnKind = ${k ? jsArg(k) : 'null'}; window._cnAll = false; renderHealth()">${label}<b>${n}</b></button>`;
  const filters = counts.length > 1 ? `<div class="hcn-f" role="tablist" aria-label="Show">${tab(null, 'All', items.length)}${counts.map(([k, n]) => tab(k, k === 'missing' ? 'Missing' : k === 'tip' ? 'Tips' : 'Ideas', n)).join('')}</div>` : '';
  return `<aside class="hcn" data-cn-feed aria-label="Claude noticed">${head}
<p class="hcn-s">${cnPlural(items.length, 'note', 'notes')} on ${cnPlural(nClients, 'client', 'clients')}${newest ? ` · ${escapeHtml(cnAgo(newest))}` : ''}</p>${filters}
<div class="hcn-list">${shown.map(x => cnLineHtml(x.c, x.n)).join('')}</div>
${list.length > 5 ? `<button type="button" class="hcn-more" aria-expanded="${all}" onclick="window._cnAll = !window._cnAll; renderHealth()">${all ? 'Show Fewer' : `Show ${list.length - 5} More`}</button>` : ''}</aside>`;
}
// a note in the right column: its kind and client, the title; open for why, where it came from and what to do
function cnLineHtml(c, n){
  const key = `${c.id}:${n.id}`, open = cnOpenSet.has(key);
  return `<div class="cnl cn-n is-${escapeHtml(n.kind)}${open ? ' is-open' : ''}" data-cnl="${escapeHtml(key)}" data-cid="${escapeHtml(c.id)}">
<button type="button" class="cnl-h" aria-expanded="${open}" onclick="cnToggle(this)"><span class="cnl-top"><span class="cn-k">${CN_KIND[n.kind] || CN_KIND.tip}</span><span class="cnl-cl">${escapeHtml(c.name)}</span><i class="cnl-chev" aria-hidden="true"></i></span><span class="cnl-t">${escapeHtml(n.title)}</span></button>
<div class="cnl-d"><div class="cnl-di"><div class="cnl-box"><p class="cn-why">${escapeHtml(n.why)}</p>${cnFromHtml(c, n)}<div class="cn-foot">${cnActHtml(c, n, true)}<span class="cn-sp"></span>${cnDismissHtml(c, n)}</div></div></div></div></div>`;
}
// open or close a note in place (it stays that way while the page redraws); in a client's menu one at a time
function cnToggle(btn, single){
  const el = btn.closest('.cnl'); if(!el) return;
  const on = !el.classList.contains('is-open');
  if(single){
    if(on) el.parentElement.querySelectorAll('.cnl.is-open').forEach(o => { if(o !== el){ o.classList.remove('is-open'); o.querySelector('.cnl-h')?.setAttribute('aria-expanded', 'false'); } });
    cnPanelOpen[el.dataset.cid] = on ? el.dataset.cnl : null;
    if(on) cnClampSoon();
  } else if(on) cnOpenSet.add(el.dataset.cnl); else cnOpenSet.delete(el.dataset.cnl);
  el.classList.toggle('is-open', on); btn.setAttribute('aria-expanded', on);
}
const cnBusy = {};
async function cnCheck(id){
  if(cnBusy[id]) return;
  cnBusy[id] = true; claudeNotesRedraw();
  const r = await claudeApi({ action: 'client-insights-check', clientId: id });
  delete cnBusy[id];
  if(r.error) showToast('error', 'Claude couldn’t read it', r.error);
  else claudeNotes.by[id] = r.insights;
  claudeNotesRedraw();
}
// Health's Check Now: the clients picked in claudeNoticedHtml, one after another
async function cnCheckSome(){
  const ids = (window._cnCands || []).filter(id => !cnBusy[id]);
  if(!ids.length){ await loadClaudeNotes(true); return; }
  ids.forEach(id => { cnBusy[id] = true; }); claudeNotesRedraw();
  let failed = '';
  for(const id of ids){
    const r = failed ? { error: failed } : await claudeApi({ action: 'client-insights-check', clientId: id });
    delete cnBusy[id];
    if(r.error) failed = failed || r.error; else if(r.insights) claudeNotes.by[id] = r.insights;
  }
  if(failed) showToast('error', 'Claude couldn’t read them all', failed);
  claudeNotesRedraw();
}
async function cnDismiss(id, noteId, btn){
  const v = claudeNotes.by[id]; if(!v) return;
  const el = btn && btn.closest('.cn-n'); if(el) el.classList.add('is-going');
  const r = await claudeApi({ action: 'client-note-dismiss', clientId: id, noteId });
  if(r.error){ if(el) el.classList.remove('is-going'); showToast('error', 'Not dismissed', r.error); return; }
  claudeNotes.by[id] = r.insights || { ...v, notes: (v.notes || []).filter(n => n.id !== noteId) };
  claudeNotesRedraw();
}
async function cnAddTasks(id, noteId, btn){
  const n = ((claudeNotes.by[id] || {}).notes || []).find(x => x.id === noteId); if(!n) return;
  const sk = cnSkip[`${id}:${noteId}`] || new Set();
  const titles = n.steps && n.steps.length ? n.steps.filter((t, i) => t && !sk.has(i)) : [n.title];
  if(!titles.length) return;
  if(btn){ btn.disabled = true; btn.textContent = 'Adding…'; }
  let k = 0;
  for(const t of titles){
    const res = await insertTaskRow({ title: t, description: `${n.title}. ${n.why}`, priority: 'medium', status: 'todo', assigner_id: currentUser.id, assignee_id: currentUser.id, client_id: id, due_date: null });
    if(!res.error && res.data){ k++; if(typeof mtKnow === 'function') mtKnow(res.data); }
  }
  if(btn && btn.isConnected) btn.outerHTML = `<span class="dp-ok">${icon('check', { weight: 'bold' })}${k} task${k === 1 ? '' : 's'} added</span>`;
  showToast(k ? 'success' : 'error', k ? `${k} task${k === 1 ? '' : 's'} added` : 'No tasks added', k ? 'In your Tasks, with no date yet.' : 'Try again in a moment.');
  if(k){ delete cnSkip[`${id}:${noteId}`]; cnSettle(id, noteId); }
}
// a note that's been acted on (made tasks or a sprint) leaves every screen at once: it's one note
async function cnSettle(id, noteId){
  const v = claudeNotes.by[id]; if(!v) return;
  const r = await claudeApi({ action: 'client-note-dismiss', clientId: id, noteId });
  if(!r.error){ claudeNotes.by[id] = r.insights || { ...v, notes: (v.notes || []).filter(n => n.id !== noteId) }; claudeNotesRedraw(); if(typeof currentViewName !== 'undefined' && currentViewName === 'tasks' && typeof renderTasks === 'function') renderTasks(); }
}
// a message Claude wrote to the client: read it, change it, copy it or open it in your mail
function cnMessage(id, noteId){
  const c = clients.find(x => x.id === id), n = ((claudeNotes.by[id] || {}).notes || []).find(x => x.id === noteId); if(!c || !n) return;
  const to = c.email ? String(c.email).split(',')[0].trim() : '', wa = typeof winChannel === 'function' && winChannel(c) === 'whatsapp';
  openAppModal(`<h3 class="cpp-h">${CLAUDE_SPARK}<span>Write to ${escapeHtml(c.name)}</span></h3>
<p class="cpp-sub">${escapeHtml(n.title)}. Claude wrote this; change anything, then copy it${to && !wa ? ' or open it in your mail' : ''}. Nothing is sent until you send it.</p>
<textarea id="cppText" class="tf cpp-text" spellcheck="true" aria-label="The message">${escapeHtml(n.message)}</textarea>
<div class="sheet-a"><button class="btn" onclick="closeAppModal()">Cancel</button><button class="btn" id="cppCopy" onclick="planWithClaudeCopy()">${icon('copy')}Copy</button>${to && !wa ? `<button class="btn btn-p" onclick="cnMail(${jsArg(to)}, ${jsArg(n.title)})">${icon('mail')}Open in Mail</button>` : ''}</div>`, 640);
  setTimeout(() => document.getElementById('cppCopy')?.focus({ preventScroll: true }), 30);
}
function cnMail(to, subject){
  const body = (document.getElementById('cppText')?.value || '').trim();
  window.open(`mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, '_blank');
  closeAppModal();
}
// All Clients' panel: a fold like the others
function claudeNotesFold(c){
  const html = claudeNotesHtml(c, 'fold'); if(!html || typeof clientFoldHtml !== 'function') return '';
  const n = ((claudeNotes.by[c.id] || {}).notes || []).length;
  return clientFoldHtml('cn', 'Claude’s notes', n ? `${n} note${n === 1 ? '' : 's'}` : 'Nothing flagged', html);
}
// the sidebar: Claude's mark on Health while a client of yours has a "missing" newer than your last look
function cnSeenKey(){ return `bda_cn_seen_${typeof currentUser !== 'undefined' && currentUser ? currentUser.id : ''}`; }
function cnNavDot(){
  const nav = document.querySelector('.nav-item[data-view="health"]'); if(!nav) return;
  let seen = ''; try{ seen = localStorage.getItem(cnSeenKey()) || ''; }catch(e){}
  const fresh = claudeNotesOn() && (typeof clients !== 'undefined' ? clients : []).some(c => claudeMine(c) && (claudeNotes.by[c.id] || {}).at > seen && ((claudeNotes.by[c.id] || {}).notes || []).some(n => n.kind === 'missing'));
  let dot = nav.querySelector('.nav-cn');
  if(fresh && !dot){ dot = document.createElement('i'); dot.className = 'nav-cn'; dot.setAttribute('aria-label', 'New from Claude'); dot.title = 'Claude noticed something you’re missing'; dot.innerHTML = CLAUDE_SPARK; nav.querySelector('.nav-label').after(dot); }   // Claude's mark, so it isn't read as Health's own dot
  if(!fresh && dot) dot.remove();
}
function cnMarkSeen(){ const at = Object.values(claudeNotes.by).reduce((m, v) => v && v.at > m ? v.at : m, ''); if(at) try{ localStorage.setItem(cnSeenKey(), at); }catch(e){} cnNavDot(); }

// Tasks: Claude's tips are drawn in Tasks' Suggestions panel (tasks-canvas.js tkSgPanelHtml, Nov 26)
// a client's notes in full: Health with the client's panel open
function cnOpenClient(id){ switchView('health'); setTimeout(() => { if(typeof selectHealthClient === 'function') selectHealthClient(id); }, 0); }
// Plan: Claude's ideas on your clients, first in "Worth planning", as small cards (Nov 26, canvas "Plan:
// Claude's ideas first in Worth planning"): the Idea pill and the client, the idea, why in two lines (all of
// it on hover), then Make It a Sprint (New Sprint with the idea and its steps; saving the sprint settles the
// note, plan.js cnNote) and Dismiss. Three at most; not for paused clients.
function claudePlanIdeasHtml(){
  if(!claudeNotesOn()) return '';
  if(!claudeNotes.at && !claudeNotes.loading) setTimeout(() => loadClaudeNotes(), 0);
  else if(claudeNotes.at && Date.now() - claudeNotes.at > 3 * 60000) setTimeout(() => loadClaudeNotes(), 0);
  const A = jsArg;
  return cnSorted((typeof clients !== 'undefined' ? clients : []).filter(c => c.status !== 'Paused' && claudeMine(c)).flatMap(c => cnNotesOf(c))).filter(x => x.n.kind === 'idea').slice(0, 3)
    .map(({ c, n }) => `<div class="pl-ci cn-n is-idea" data-cnl="${escapeHtml(c.id + ':' + n.id)}"><p class="pl-ci-top"><span class="cn-k">Idea</span><span class="c">${escapeHtml(c.name)}</span></p><b>${escapeHtml(n.title)}</b><p class="pl-ci-w" title="${escapeHtml(n.why)}">${escapeHtml(n.why)}</p>`
      + `<div class="pl-ci-a"><button type="button" class="btn sm btn-p" onclick="openNewSprintModal({ clientId: ${A(c.id)}, preset: { title: ${A(n.title)}, goal: ${A(n.why)}, steps: ${escapeHtml(JSON.stringify(n.steps || []))} }, cnNote: { clientId: ${A(c.id)}, noteId: ${A(n.id)} } })">Make It a Sprint</button><button type="button" class="btn sm cn-dis" onclick="cnDismiss(${A(c.id)}, ${A(n.id)}, this)">Dismiss</button></div></div>`).join('');
}
