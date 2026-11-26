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
  document.querySelectorAll('[data-cn-client]').forEach(el => {
    const c = clients.find(x => x.id === el.dataset.cnClient); if(!c) return;
    el.outerHTML = claudeNotesHtml(c, el.dataset.cnWhere || 'panel');
  });
}
const CN_KIND = { missing: 'Missing', tip: 'Tip', idea: 'Idea' };
const CN_REASON = { new: 'after something new came in', first: 'first read', asked: 'when you asked' };
function cnAgo(at){ const m = Math.round((Date.now() - new Date(at)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 24 * 60 ? `${Math.round(m / 60)} h ago` : fmtShortDate(new Date(at)); }
function cnEvidenceHtml(c, e){
  const A = jsArg;
  const go = e.kind === 'meeting' && e.id ? `cnOpen(() => loadGranolaMeetings().then(() => openMeetingNotes(${A(e.id)})))`
    : e.kind === 'warequest' && e.id ? `cnOpen(() => waOpenItem(${A(e.id)}))`
    : e.kind === 'whatsapp' ? `cnOpen(() => switchView('whatsapp'))`
    : e.kind === 'task' && e.id ? `cnOpen(() => notifOpenTask(${A(e.id)}))`
    : e.kind === 'reminder' && e.id ? `cnOpen(async () => { if(!(clientReminders || []).some(r => r.id === ${A(e.id)})) await loadClientReminders(); openReminderDetailModal(${A(e.id)}); })`
    : e.kind === 'update' ? `cnOpen(() => openWeekClient(${A(c.id)}))` : '';
  const label = escapeHtml(e.label || e.kind);
  if(e.kind === 'email' && e.url) return `<a class="cn-ev" href="${safeUrl(e.url)}" target="_blank" rel="noopener">${label}</a>`;
  return go ? `<button type="button" class="cn-ev" onclick="${go}">${label}</button>` : `<span class="cn-ev is-plain">${label}</span>`;
}
function cnOpen(fn){ if(document.getElementById('appModalOverlay')) closeAppModal(); setTimeout(fn, 0); }
function cnNoteHtml(c, n){
  const A = jsArg, word = CN_KIND[n.kind] || CN_KIND.tip, sm = (label, js) => `<button type="button" class="btn sm" onclick="${js}">${label}</button>`;
  const act = n.action === 'task' ? sm(n.steps && n.steps.length > 1 ? 'Add as Tasks' : 'Add as Task', `cnAddTasks(${A(c.id)}, ${A(n.id)}, this)`)
    : n.action === 'sprint' ? sm('Make It a Sprint', `cnOpen(() => openNewSprintModal({ clientId: ${A(c.id)}, preset: { title: ${A(n.title)}, goal: ${A(n.why)}, steps: ${escapeHtml(JSON.stringify(n.steps || []))} } }))`)
    : n.action === 'message' && n.message ? sm('Write to Them', `cnMessage(${A(c.id)}, ${A(n.id)})`)
    : n.action === 'claude' ? sm(`${CLAUDE_SPARK}Plan with Claude`, `planWithClaude(${A(c.id)}, ${A(`${n.title}. ${n.why}`)})`) : '';
  return `<div class="cn-n is-${escapeHtml(n.kind)}"><div class="cn-top"><span class="cn-kind">${word}</span><b>${escapeHtml(n.title)}</b><button type="button" class="ib cn-x" aria-label="Dismiss “${escapeHtml(n.title)}”" title="Dismiss" onclick="cnDismiss(${A(c.id)}, ${A(n.id)}, this)">${icon('x')}</button></div>
<p class="cn-why">${escapeHtml(n.why)}</p>
${n.steps && n.steps.length ? `<ol class="cn-steps">${n.steps.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol>` : ''}
${(n.evidence || []).length || act ? `<div class="cn-foot"><div class="cn-evs">${(n.evidence || []).map(e => cnEvidenceHtml(c, e)).join('')}</div>${act ? `<div class="cn-act">${act}</div>` : ''}</div>` : ''}</div>`;
}
// the section (panel, or the client page's card); '' when it isn't for you
function claudeNotesHtml(c, where){
  if(!c || !claudeNotesOn() || !claudeMine(c)) return '';
  if(!claudeNotes.at && !claudeNotes.loading) setTimeout(() => loadClaudeNotes(), 0);
  else if(Date.now() - claudeNotes.at > 3 * 60000) setTimeout(() => loadClaudeNotes(), 0);
  const v = claudeNotes.by[c.id], A = jsArg(c.id), notes = (v && v.notes) || [];
  const counts = ['missing', 'tip', 'idea'].map(k => [k, notes.filter(n => n.kind === k).length]).filter(x => x[1]);
  const sub = cnBusy[c.id] ? 'Claude is reading this client…' : v ? `Read ${cnAgo(v.at)}${CN_REASON[v.reason] ? `, ${CN_REASON[v.reason]}` : ''}` : claudeNotes.at ? 'Not read yet: Claude reads it when something new comes in' : 'Loading…';
  const count = counts.length ? `<span class="cn-c">${counts.map(([k, n]) => `${n} ${k === 'missing' ? 'missing' : k + (n === 1 ? '' : 's')}`).join(' · ')}</span>` : '';
  const check = `<button type="button" class="btn sm cn-check" onclick="cnCheck(${A})"${cnBusy[c.id] ? ' disabled' : ''} data-hovertip="Claude reads this client again now: meetings, emails, WhatsApp, tasks, follow-ups and logged work. Counts toward your 40 a day." data-tipdelay="1500">${cnBusy[c.id] ? 'Reading…' : 'Check Now'}</button>`;
  // the page's card heads like its other cards; a fold already says what it is; a panel has its own head
  const head = where === 'page' ? `<div class="uw-wh cn-h"><span class="uw-ic cn-ic">${CLAUDE_SPARK}</span><span class="uw-wt">Claude’s notes</span>${count}<span class="uw-sp"></span>${check}</div><p class="cn-sub">${escapeHtml(sub)}</p>`
    : where === 'fold' ? `<div class="cn-h is-fold"><p class="cn-sub">${escapeHtml(sub)}</p>${check}</div>`
    : `<div class="cn-h">${CLAUDE_SPARK}<b>Claude’s notes</b>${count}${check}</div><p class="cn-sub">${escapeHtml(sub)}</p>`;
  const body = notes.length ? `<div class="cn-list">${notes.map(n => cnNoteHtml(c, n)).join('')}</div>` : v && !cnBusy[c.id] ? '<p class="cn-none">Nothing Claude would flag right now.</p>' : '';
  return where === 'page'
    ? `<section class="uw-w cp-cn cn" data-cn-client="${escapeHtml(c.id)}" data-cn-where="page">${head}${body}</section>`
    : `<section class="cn cn-panel" data-cn-client="${escapeHtml(c.id)}" data-cn-where="${escapeHtml(where || 'panel')}">${head}${body}</section>`;
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
  if(btn){ btn.disabled = true; btn.textContent = 'Adding…'; }
  const titles = n.steps && n.steps.length ? n.steps : [n.title];
  let k = 0;
  for(const t of titles){
    const res = await insertTaskRow({ title: t, description: `${n.title}. ${n.why}`, priority: 'medium', status: 'todo', assigner_id: currentUser.id, assignee_id: currentUser.id, client_id: id, due_date: null });
    if(!res.error && res.data){ k++; if(typeof mtKnow === 'function') mtKnow(res.data); }
  }
  if(btn && btn.isConnected) btn.outerHTML = `<span class="dp-ok">${icon('check', { weight: 'bold' })}${k} task${k === 1 ? '' : 's'} added</span>`;
  showToast(k ? 'success' : 'error', k ? `${k} task${k === 1 ? '' : 's'} added` : 'No tasks added', k ? 'In your Tasks, with no date yet.' : 'Try again in a moment.');
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
