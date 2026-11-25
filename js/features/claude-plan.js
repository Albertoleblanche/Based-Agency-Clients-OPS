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
  L.push(`If the Radar connector is on in this chat, use it for more context (get_client "${c.name}", and its meetings), and when we’re done, offer to log the time and the work in Radar and mark the task done; ask me first.${domain ? ` If Gmail is connected, check the latest emails with ${domain} for anything that changes the plan.` : ''}`);
  let out = L.join('\n');
  if(out.length > CLAUDE_PROMPT_MAX) out = out.slice(0, CLAUDE_PROMPT_MAX - 1) + '…';
  return out;
}
function claudeNewChatUrl(prompt){ return 'https://claude.ai/new?q=' + encodeURIComponent(prompt); }
function planWithClaude(id){
  const c = clients.find(x => x.id === id); if(!c) return;
  window.open(claudeNewChatUrl(claudePlanPrompt(c)), '_blank', 'noopener');
  if(typeof showToast === 'function') showToast('info', 'Opened in Claude', 'The message is ready there, in a new tab. Read it over, then send it.');
}
// The button: Claude's own orange, between Mark Handled and the next step's button, with an (i) that
// says what it does; small (the logo) beside Open Task in Health's list.
const CLAUDE_PLAN_TIP = 'Opens Claude in a new tab with this client’s next step ready to start: what they pay us for, why Radar flags them, the work logged lately and what’s still open.\n\nClaude stays inside their scope (anything outside it comes back as an add-on to offer), plans the step, starts on it with you and ends with a win for the client. Nothing is sent until you send it.';
function planWithClaudeHtml(id, small){
  const A = jsArg(id);
  return small
    ? `<button class="btn sm cl-claude is-ic" onclick="event.stopPropagation();planWithClaude(${A})" aria-label="Plan with Claude" data-hovertip="Plan with Claude: opens Claude with this client’s next step ready to start, inside what they pay us for.">${appLogo('claude', 'xs')}</button>`
    : `<span class="cl-claude-w"><button class="btn cl-claude-btn" onclick="event.stopPropagation();planWithClaude(${A})">Plan with Claude</button>${typeof infoTip === 'function' ? infoTip(CLAUDE_PLAN_TIP, 'What does Plan with Claude do?') : ''}</span>`;
}
