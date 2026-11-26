// Claude inside Radar (Nov 25): the Claude buttons work in Radar itself, on the agency's own Claude key
// (the Assistant's: Settings → AI & Email, else ANTHROPIC_API_KEY), for the people whose team card has
// the Assistant turned on. What someone asks for counts toward the Assistant's 40 a day.
//  • sprintFromMeeting: a meeting's action items as a sprint (title, goal, days, hours, 3 to 6 steps),
//    inside what the client pays for; anything outside it comes back as an add-on to offer. The
//    browser opens Plan's New Sprint filled in with it, to check and save.
//  • the daily plan: each weekday morning (vercel.json crons → dayPlanTick), for each of those people,
//    their clients' next step, what each owes us and one win to aim for, then what to do first. It's
//    kept in app_storage (day-plan:<user id>) and shown from Overview's Today's Plan.

const { callClaude, CLAUDE_MODEL } = require('./ai-client');
const { clientPlans } = require('./client-plan');

const DAILY_CAP = 40;   // the Assistant's (api/claude-chat.js)
const PLAN_KEY = id => `day-plan:${id}`;
const DAY = 864e5;

function settingsOf(row) { try { return row && row.value ? JSON.parse(row.value) : {}; } catch (e) { return {}; } }
function parseJson(text) { const m = String(text || '').match(/\{[\s\S]*\}/); if (!m) return null; try { return JSON.parse(m[0]); } catch (e) { return null; } }
function todayIn(tz, at) { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at || new Date()); }
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t; };

// The key and model Claude runs on here, or why it can't
async function claudeKey(admin) {
  const [{ data: settingsRow }, { data: conn }] = await Promise.all([
    admin.from('app_storage').select('value').eq('key', 'settings').maybeSingle(),
    admin.from('ai_provider_connections').select('api_key').eq('provider', 'claude').maybeSingle(),
  ]);
  const settings = settingsOf(settingsRow), apiKey = (conn && conn.api_key) || process.env.ANTHROPIC_API_KEY || null;
  // Sonnet, not the Assistant's chat model: an answer here has to come back well inside Vercel's 60 s
  return { settings, apiKey, model: settings.claudeRadarModel || CLAUDE_MODEL };
}

// Whether this person can use Claude here now: { me, settings, apiKey, model, used } or { error, status }
async function claudeAccess(admin, userId, opts) {
  opts = opts || {};
  const { data: me } = await admin.from('team_profiles').select('id, name, email, role, ai_chat_enabled, access_revoked').eq('id', userId).maybeSingle();
  if (!me || me.access_revoked) return { error: 'Only team members can use Claude in Radar.', status: 403 };
  if (!me.ai_chat_enabled) return { error: 'Claude in Radar is for people with the Assistant turned on. An admin can turn it on in your team card.', status: 403 };
  const k = await claudeKey(admin);
  if (!k.apiKey) return { error: 'Claude isn’t connected yet. An admin connects it in Settings → AI & Email.', status: 503 };
  let used = 0;
  if (!opts.free) {
    const { data: u } = await admin.from('claude_chat_usage').select('message_count').eq('user_id', userId).eq('usage_date', new Date().toISOString().slice(0, 10)).maybeSingle();
    used = (u && u.message_count) || 0;
    if (used >= DAILY_CAP) return { error: `You’ve used today’s ${DAILY_CAP} Assistant messages. They reset tomorrow.`, status: 429 };
  }
  return { me, ...k, used };
}
async function countUse(admin, userId, used) {
  await admin.from('claude_chat_usage').upsert({ user_id: userId, usage_date: new Date().toISOString().slice(0, 10), message_count: (used || 0) + 1 }, { onConflict: 'user_id,usage_date' }).then(() => {}, () => {});
}
// Claude fills in a form (a tool it's given, with the fields as a schema), so its answer comes back as an
// object, not text to pick JSON out of. Nov 25: newer models don't take a forced tool_choice ("type tool
// and any are not supported"), so it's offered (auto) and the prompt asks for it; room for the model's
// own thinking first (a free-text answer earlier came back cut off). Text instead of the form is still read.
async function callClaudeForm(acc, prompt, system, tool, maxTokens) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': acc.apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: acc.model, max_tokens: Math.max(maxTokens || 0, 8000), system, messages: [{ role: 'user', content: prompt }], tools: [tool], tool_choice: { type: 'auto' } }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, error: (data && data.error && data.error.message) || `Claude answered with an error (${res.status}).` };
  const blocks = (data && data.content) || [];
  const use = blocks.find(b => b.type === 'tool_use' && b.name === tool.name);
  const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n\n').trim();
  if (use && use.input && typeof use.input === 'object' && Object.keys(use.input).length) return { ok: true, json: use.input };
  if (data && data.stop_reason === 'max_tokens') return { ok: false, error: 'Claude’s answer ran too long and was cut off. Try again.', reply: (text || JSON.stringify(blocks)).slice(0, 400) };
  if (text) return { ok: true, reply: text };   // answered in words: read it there
  return { ok: false, error: 'Claude didn’t fill in the plan. Try again.', reply: JSON.stringify(blocks).slice(0, 400) };
}
// One question to Claude, with a time limit inside the function's 60 s; a clear reason when it fails,
// and what went wrong in Vercel's logs
const ASK_MS = 45000;
async function ask(acc, prompt, system, maxTokens, opts, tool) {
  opts = opts || {};
  const call = opts.ai ? Promise.resolve().then(() => opts.ai(prompt, system, tool))
    : tool ? callClaudeForm(acc, prompt, system, tool, maxTokens)
    : callClaude([{ role: 'user', content: prompt }], system, { model: acc.model, apiKey: acc.apiKey, webSearch: false, maxTokens: maxTokens || 1500 });
  let timer;
  const late = new Promise(res => { timer = setTimeout(() => res({ ok: false, late: true, error: 'Claude took too long to answer. Try again in a moment.' }), opts.askMs || ASK_MS); });
  const t0 = Date.now();
  const r = await Promise.race([call.catch(e => ({ ok: false, error: `Couldn’t reach Claude: ${String(e && e.message || e).slice(0, 160)}` })), late]);
  clearTimeout(timer);
  if (!r || !r.ok) console.error('[claude-radar] Claude failed', { model: acc.model, ms: Date.now() - t0, error: r && r.error, reply: r && r.reply });
  return r || { ok: false, error: 'Claude didn’t answer. Try again in a moment.' };
}
// Claude's JSON, or why it couldn't be read
function readJson(r, need) {
  if (!r || !r.ok) return { error: (r && r.error) || 'Claude didn’t answer. Try again in a moment.' };
  const out = r.json && typeof r.json === 'object' ? r.json : parseJson(String(r.reply || '').replace(/```(?:json)?/g, ''));
  if (!out || !need(out)) { console.error('[claude-radar] unreadable answer', String(r.reply || '').slice(0, 400)); return { error: 'Claude’s answer came back in a form Radar couldn’t read. Try again.' }; }
  return { out };
}

const S = d => ({ type: 'string', description: d });
const SPRINT_FORM = { name: 'draft_sprint', description: 'The sprint drafted from the meeting.', input_schema: { type: 'object', required: ['title', 'goal', 'workdays', 'hours', 'steps', 'add_ons'], properties: {
  title: S('The sprint’s name, under 50 characters, naming the outcome.'), goal: S('What’s done when the sprint is done, one sentence under 160 characters.'),
  workdays: { type: 'integer', minimum: 2, maximum: 10 }, hours: { type: 'integer', minimum: 2, maximum: 40 },
  steps: { type: 'array', minItems: 1, maxItems: 6, items: S('A step starting with a verb, under 70 characters.') },
  add_ons: { type: 'array', maxItems: 4, items: S('An add-on to offer, under 90 characters.') } } } };
// ---- A meeting → a sprint ------------------------------------------------------------------------
const SPRINT_SYSTEM = 'You plan focused work for Based Agency, a marketing agency for home-services businesses (Google Ads, Meta ads, SEO, websites). You always answer by using the tool you’re given, once, with every field filled in.';
function sprintPrompt(o) {
  return `Turn this meeting's action items for the agency's team into one sprint of focused work for ${o.me}: a few days on one client, in their Plan in Radar.

Client: ${o.client || 'none named'}.
${o.plan ? `What they pay us for: ${o.plan}` : 'What they pay us for: not set in Radar.'}
The meeting: "${o.title}", ${o.date}.

Notes:
"""
${o.summary}
"""

Use draft_sprint to give the sprint, with these fields:
- title: the sprint's name, under 50 characters, naming the outcome (not the meeting).
- goal: what's done when the sprint is done, one sentence under 160 characters, about progress for the client.
- workdays: how many workdays it needs, 2 to 10. hours: the hours of work it needs, 2 to 40.
- steps: 3 to 6 steps in the order to do them, each starting with a verb, under 70 characters, only work the agency's team does that's inside what the client pays for.
- add_ons: action items from the meeting that are new work outside what they pay for, each as the add-on to offer them, under 90 characters ("Offer a new landing page for the Tacoma area"). [] when there are none or what they pay for isn't set.`;
}
async function sprintFromMeeting(admin, userId, email, noteRef, opts) {
  opts = opts || {};
  const acc = await claudeAccess(admin, userId); if (acc.error) return acc;
  const { meetingFor, metClientOf, emailDomain } = require('./granola-tasks');
  const f = await meetingFor(admin, noteRef, { id: userId, role: acc.me.role, name: acc.me.name, email }); if (f.error) return f;
  const { id, m } = f;
  if (!m.summary || m.state === 'removed') return { error: 'This meeting’s notes aren’t in Radar.', status: 404 };
  const [{ data: cl }, { data: team }] = await Promise.all([admin.from('clients').select('*'), admin.from('team_profiles').select('email')]);
  const live = (cl || []).filter(c => !c.deleted_at && c.status !== 'Paused'), teamDomains = new Set((team || []).map(p => emailDomain(p.email)).filter(Boolean));
  const cid = m.clientId || metClientOf(m, live, teamDomains), client = cid ? live.find(c => String(c.id) === String(cid)) || null : null;
  const plan = client ? (await clientPlans(admin, [client], acc.settings).catch(() => ({})))[String(client.id)] || null : null;
  const tz = acc.settings.timezone || process.env.TEAM_TIMEZONE || 'America/New_York';
  const r = await ask(acc, sprintPrompt({ me: acc.me.name || 'me', client: client && client.name, plan, title: m.title || 'the meeting',
    date: todayIn(tz, new Date(m.meetingAt || m.at || Date.now())), summary: String(m.summary).slice(0, 12000) }), SPRINT_SYSTEM, 1500, opts, SPRINT_FORM);
  const { out, error } = readJson(r, o => Array.isArray(o.steps));
  if (error) return { error, status: 502 };
  await countUse(admin, userId, acc.used);
  const num = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
  return {
    meeting: id, clientId: client ? client.id : null, client: client ? client.name : null,
    title: clip(out.title || m.title, 60), goal: clip(out.goal, 200), workdays: num(out.workdays, 2, 10, 5), hours: num(out.hours, 2, 40, 10),
    steps: out.steps.map(s => clip(s, 90)).filter(Boolean).slice(0, 6),
    addOns: plan && Array.isArray(out.add_ons) ? out.add_ons.map(s => clip(s, 120)).filter(Boolean).slice(0, 4) : [],
    left: DAILY_CAP - acc.used - 1,
  };
}

// ---- The daily plan (Nov 25, v2) -----------------------------------------------------------------------
// Each weekday morning, for each person with the Assistant on, Claude:
//  • plans the day: a schedule around their meetings (Google Calendar) from their tasks, clients'
//    requests and WhatsApp, with what to bring up in each client meeting. What's scheduled is in their
//    Tasks: a request becomes their task, new work becomes a task, each due today at its time;
//  • does the prep: the follow-ups due (what clients owe us, written as Radar's Nudge, for them to read
//    and send from Reminders) and the weekly win updates due (their part, written from their logged
//    work as Radar's own drafts are, waiting for them to send to Review);
//  • looks ahead two weeks: risks (hours running out, a sprint ending, a quiet client, an update due
//    with nothing logged), ways to get a client better results, add-ons to offer, what to prepare,
//    each with a few steps to make into a sprint or tasks.
const PLAN_SYSTEM = 'You are the planning partner of a person on Based Agency’s team (a marketing agency for home-services businesses: Google Ads, Meta ads, SEO, websites). You plan from what Radar knows, concretely and realistically. You always answer by using the tool you’re given, once, with every field filled in.';
const DAY_FORM = { name: 'plan_my_day', description: 'Today’s schedule and meeting prep.', input_schema: { type: 'object', required: ['blocks', 'meeting_prep'], properties: {
  blocks: { type: 'array', maxItems: 10, items: { type: 'object', required: ['start', 'minutes', 'ref', 'client', 'title'], properties: {
    start: S('Start time, HH:MM, 24-hour.'), minutes: { type: 'integer', minimum: 15, maximum: 180 },
    ref: S('The [ref] of the item (like T2, S1 or W1), or "" for new work.'), client: S('The client’s exact name, or "".'), title: S('What to do, starting with a verb, under 70 characters.') } } },
  meeting_prep: { type: 'array', maxItems: 4, items: { type: 'object', required: ['meeting', 'notes'], properties: {
    meeting: S('The meeting’s exact title.'), notes: { type: 'array', maxItems: 4, items: S('One thing to bring up, under 100 characters.') } } } } } } };
const AHEAD_FORM = { name: 'look_ahead', description: 'What’s coming for these clients, and what to do about it.', input_schema: { type: 'object', required: ['proposals'], properties: {
  proposals: { type: 'array', maxItems: 4, items: { type: 'object', required: ['client', 'kind', 'title', 'why', 'steps', 'action'], properties: {
    client: S('The client’s exact name.'), kind: { type: 'string', enum: ['risk', 'improve', 'addon', 'prep'] }, title: S('The proposal, under 70 characters.'),
    why: S('Why now, from the facts given, with the numbers, under 160 characters.'),
    steps: { type: 'array', minItems: 2, maxItems: 4, items: S('A step starting with a verb, under 70 characters.') },
    action: { type: 'string', enum: ['sprint', 'tasks', 'claude'] } } } } } } };

const HM = d => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
const minsOf = hm => { const m = String(hm || '').match(/^(\d{1,2}):(\d{2})$/); return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null; };
const hmOf = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const firstName = n => String(n || '').trim().split(/\s+/)[0] || '';

// What Radar knows about this person's day and clients: lines for the prompts, the [refs] they name,
// and what the prep and the look-ahead need.
async function dayContext(admin, me, date, settings, now) {
  const { wallOffset, toWall, clientWeek } = require('./update-automations');
  const tz = settings.timezone || process.env.TEAM_TIMEZONE || 'America/New_York', off = wallOffset(tz);
  const dayUtc = Date.parse(date + 'T00:00:00Z') - off, nowW = toWall(now, off);
  const since30 = new Date(Date.parse(date + 'T12:00:00Z') - 30 * DAY).toISOString().slice(0, 10), monthStart = date.slice(0, 8) + '01';
  const safe = p => p.then(r => r, () => ({ data: null }));
  const [{ data: cl }, { data: tk }, { data: rems }, { data: sg }, { data: myTime }, { data: monthTime }, { data: sp }, { data: groups }, { data: wa }, { data: sig }, { data: evs }, { data: imps }, { data: drafts }, { data: hist }] = await Promise.all([
    admin.from('clients').select('*'),
    admin.from('tasks').select('*').eq('assignee_id', me.id).neq('status', 'done'),
    admin.from('client_reminders').select('*').eq('status', 'waiting'),
    safe(admin.from('task_suggestions').select('*').eq('assignee_id', me.id).eq('status', 'pending')),
    safe(admin.from('time_entries').select('client_id, entry_date').eq('user_id', me.id).gte('entry_date', since30)),
    safe(admin.from('time_entries').select('client_id, minutes, deleted_at').gte('entry_date', monthStart)),
    safe(admin.from('plan_sprints').select('*').eq('user_id', me.id).gte('end_date', date)),
    safe(admin.from('wa_groups').select('jid, client_id')),
    safe(admin.from('wa_tasks').select('*').eq('status', 'open')),
    safe(admin.from('wa_signals').select('*').gte('created_at', new Date(Date.parse(date + 'T12:00:00Z') - 14 * DAY).toISOString())),
    safe(admin.from('calendar_events').select('*').eq('all_day', false).gte('start_at', new Date(dayUtc).toISOString()).lte('start_at', new Date(dayUtc + 8 * DAY).toISOString())),
    safe(admin.from('client_improvements').select('*').gte('date', since30)),
    safe(admin.from('client_drafts').select('*')),
    safe(admin.from('app_storage').select('value').eq('key', 'update-history').maybeSingle()),
  ]);
  const live = (cl || []).filter(c => !c.deleted_at && c.status !== 'Paused');
  const tasks = (tk || []).filter(t => !t.deleted_at && !t.cancelled_at && !t.archived_at);
  const worked = new Set((myTime || []).map(e => String(e.client_id)));
  const jidClient = {}; (groups || []).forEach(g => { if (g.client_id) jidClient[g.jid] = String(g.client_id); });
  const sprints = (sp || []).filter(s => !s.done_at);
  const mineEv = e => e.created_by === me.id || e.google_calendar_owner === me.id || (Array.isArray(e.attendee_ids) && e.attendee_ids.includes(me.id));
  // a meeting's client: set on it, its whole name in the title, or the name's first word when that's
  // long enough and no other client starts with it ("Oakridge weekly" → Oakridge Flooring)
  const first = c => String(c.name || '').toLowerCase().split(/\s+/)[0] || '';
  const words = t => String(t || '').toLowerCase().split(/[^a-z0-9&']+/);
  const evClient = e => (e.client_id && live.find(c => String(c.id) === String(e.client_id)))
    || live.find(c => c.name && c.name.length > 3 && String(e.title || '').toLowerCase().includes(c.name.toLowerCase()))
    || live.find(c => first(c).length >= 5 && words(e.title).includes(first(c)) && live.filter(x => first(x) === first(c)).length === 1) || null;
  const events = (evs || []).filter(e => e.event_type !== 'deadline' && mineEv(e)).map(e => ({ e, c: evClient(e), s: toWall(e.start_at, off), f: toWall(e.end_at || e.start_at, off) }));
  const today = events.filter(x => x.s.toISOString().slice(0, 10) === date).sort((a, b) => a.s - b.s);
  const impsLive = (imps || []).filter(i => !i.deleted_at), history = hist && hist.value ? settingsOf(hist) : {};
  const impsBy = {}, draftsBy = {};
  impsLive.forEach(i => (impsBy[i.client_id] = impsBy[i.client_id] || []).push(i));
  (drafts || []).forEach(d => (draftsBy[d.client_id] = draftsBy[d.client_id] || []).push(d));
  const per = live.map(c => {
    const id = String(c.id), cfv = c.custom_field_values || {};
    const ct = tasks.filter(t => String(t.client_id) === id).sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
    const owe = (rems || []).filter(r => String(r.client_id) === id && !r.waiting_on);
    const asks = (sg || []).filter(s => String(s.client_id) === id);
    const chat = (wa || []).filter(w => jidClient[w.group_jid] === id);
    const sps = sprints.filter(s => String(s.client_id) === id);
    const meet = events.filter(x => x.c && String(x.c.id) === id);
    const owner = !!me.name && cfv.owner === me.name;
    const mine = owner || ct.length || worked.has(id) || owe.some(r => r.asked_by === me.id) || asks.length || sps.length || meet.length;
    if (!mine) return null;
    const late = ct.filter(t => t.due_date && t.due_date < date).length, dueNow = ct.filter(t => t.due_date === date).length;
    const score = late * 4 + dueNow * 3 + owe.filter(r => r.follow_up_date && r.follow_up_date <= date).length * 2 + asks.length * 2 + chat.length * 2 + sps.length * 2 + meet.length * 2 + (cfv.focus ? 3 : 0) + (owner ? 1 : 0) + ct.length;
    return { c, ct, owe, asks, chat, sps, meet, owner, score };
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 8);
  const plans = await clientPlans(admin, per.map(p => p.c), settings).catch(() => ({}));
  const day = d => d ? new Date(String(d).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';
  const refs = {}, n = { T: 0, S: 0, W: 0 };
  const ref = (k, kind, id, x) => { const r = `${k}${++n[k]}`; refs[r] = { kind, id, x }; return `[${r}] `; };
  // the work to fit into today
  const work = per.map(p => {
    const L = [`## ${p.c.name}${p.owner ? ' (you own it)' : ''}${(p.c.custom_field_values || {}).focus ? ' · Focus client' : ''}`];
    if (p.sps.length) L.push(`Sprint on now: ${p.sps.map(s => `${s.title}${s.goal ? ` (goal: ${clip(s.goal, 120)})` : ''}, ends ${day(s.end_date)}`).join('; ')}`);
    if (p.ct.length) L.push(`Your open tasks: ${p.ct.slice(0, 6).map(t => `${ref('T', 'task', t.id, { c: p.c, t })}${clip(t.title, 90)}${t.due_date ? ` (due ${day(t.due_date)}${t.due_date < date ? ', late' : ''})` : ''}${t.sprint_id ? ' (sprint step)' : ''}`).join('; ')}`);
    if (p.asks.length) L.push(`They asked for (not in your tasks yet): ${p.asks.slice(0, 4).map(s => `${ref('S', 'suggestion', s.id, { c: p.c, s })}${clip(s.title, 90)}${s.out_of_scope ? ' (not in their plan: an add-on)' : ''}`).join('; ')}`);
    if (p.chat.length) L.push(`Waiting in their WhatsApp group: ${p.chat.slice(0, 4).map(w => `${ref('W', 'wa', w.id, { c: p.c, w })}${clip(w.title, 90)}`).join('; ')}`);
    return L.join('\n');
  }).join('\n\n');
  const meetLines = today.map(x => `- ${HM(x.s)} to ${HM(x.f)}: "${clip(x.e.title, 80)}"${x.c ? ` with ${x.c.name}` : ''}`).join('\n');
  // the look ahead: the facts per client
  const daysIn = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7), 0)).getUTCDate(), dayN = +date.slice(8, 10);
  const facts = per.map(p => {
    const c = p.c, id = String(c.id), cfv = c.custom_field_values || {}, F = [`## ${c.name}: ${plans[id] ? plans[id].replace(/^[^:]*:\s*/, '') : `pays for ${c.service || 'not set in Radar'}`}`];
    const used = (monthTime || []).filter(e => String(e.client_id) === id && !e.deleted_at).reduce((a, e) => a + (Number(e.minutes) || 0), 0) / 60, budget = Number(c.monthly_hour_budget) || 0;
    if (budget) { const pace = used / Math.max(1, dayN) * daysIn; F.push(`Hours this month: ${Math.round(used)} of ${budget}${pace > budget * 1.05 ? `, on pace for ${Math.round(pace)} (over)` : pace < budget * 0.6 && dayN > 10 ? `, on pace for ${Math.round(pace)} (well under)` : ''}`); }
    const w = clientWeek(c, impsBy[c.id] || [], draftsBy[c.id] || [], history, nowW, off);
    F.push(`Weekly update: ${w.sent ? 'sent this week' : w.daysLeft < 0 ? `late by ${-w.daysLeft} days` : w.daysLeft === 0 ? 'due today' : `due in ${w.daysLeft} days`}; ${w.logged.filter(i => i.include_in_email !== false).length} wins logged for it`);
    const lastWork = (impsBy[c.id] || []).map(i => String(i.date).slice(0, 10)).sort().pop();
    F.push(`Last work logged: ${lastWork ? day(lastWork) : 'nothing in 30 days'}`);
    const soon = p.ct.filter(t => t.due_date && t.due_date >= date && t.due_date <= new Date(Date.parse(date + 'T12:00:00Z') + 14 * DAY).toISOString().slice(0, 10));
    if (soon.length || p.ct.some(t => t.due_date && t.due_date < date)) F.push(`Your tasks: ${p.ct.filter(t => t.due_date && t.due_date < date).length} late, ${soon.length} due in the next 2 weeks`);
    p.sps.forEach(s => F.push(`Sprint "${s.title}" ends ${day(s.end_date)}`));
    const overdue = p.owe.filter(r => r.follow_up_date && r.follow_up_date <= date);
    if (p.owe.length) F.push(`They owe us: ${p.owe.slice(0, 3).map(r => clip(r.question, 70)).join('; ')}${overdue.length ? ` (${overdue.length} past follow-up day)` : ''}`);
    const ss = (sig || []).filter(x => String(x.client_id) === id).slice(0, 3);
    if (ss.length) F.push(`From their WhatsApp: ${ss.map(x => `${x.type}: ${clip(x.summary, 100)}`).join('; ')}`);
    const off2 = p.asks.filter(s => s.out_of_scope).concat(p.chat.filter(x => x.out_of_scope));
    if (off2.length) F.push(`Asked for outside their plan: ${off2.slice(0, 2).map(x => clip(x.title, 70)).join('; ')}`);
    const nextMeet = p.meet.filter(x => x.s.toISOString().slice(0, 10) > date)[0];
    if (nextMeet) F.push(`Next meeting: "${clip(nextMeet.e.title, 60)}" ${day(nextMeet.s.toISOString())}`);
    return F.join('\n');
  }).join('\n\n');
  return { per, refs, work, meetLines, today, facts, impsBy, draftsBy, history, nowW, off, live, tasks, rems: rems || [], plans };
}

function dayPrompt(o) {
  return `Plan ${o.me}'s ${o.weekday}, ${o.date}. Work hours ${o.from} to 18:00, lunch 12:30 to 13:30.${o.late ? ` It's ${o.from} now: plan from now on.` : ''}

Meetings today (fixed):
${o.meetLines || '- none'}

Work Radar knows about, each with a [ref]:
${o.work || '(nothing open)'}

Use plan_my_day:
- blocks: the work for today in time order, around the meetings and lunch, with 10 minutes free before each meeting. Most important first: late and due-today tasks, Focus clients, what clients asked for, sprint steps. Each block 30 to 120 minutes, a realistic estimate. At most 6 hours of work in all.
- ref: the [ref] of the item a block is, without brackets. "" only for new work worth doing today that isn't listed (at most 2, like preparing for a meeting or the next step of a sprint), with its client.
- title: the work, starting with a verb, under 70 characters.
- meeting_prep: for each meeting with a client, 2 to 4 things to bring up, from what Radar knows: wins to share, what they owe us, decisions needed. Positive wording: nothing that makes the agency look bad.`;
}
function aheadPrompt(o) {
  return `Look ahead over the next two weeks for ${o.me}'s clients and propose what to do. Today is ${o.weekday}, ${o.date}.

What Radar knows:
${o.facts}

Use look_ahead with up to 4 proposals, the most valuable first:
- risk: hours running out or well under, a sprint ending, an update due with few wins logged, a quiet client, an unhappy client, overdue follow-ups.
- improve: a concrete way to get them better results inside what they pay for (an ad test, a page to improve, a report that shows value).
- addon: something they asked for or would benefit from that's outside their plan, worth offering.
- prep: an upcoming meeting or deadline to get ready for.
For each: why (from the facts above, with the numbers), 2 to 4 steps, and the action: sprint (a few days of focused work), tasks (a few separate to-dos), or claude (needs thinking through first). Only proposals the facts support; no generic advice.`;
}

// Today's due follow-ups (what clients owe us), written as Radar's Nudge
async function prepFollowUps(acc, ctx, me, date, opts) {
  const { followUpPrompt, followUpParse, followUpPlain } = require('../js/core/followup-prompt.js');
  const due = ctx.rems.filter(r => r.asked_by === me.id && !r.waiting_on && r.follow_up_date && r.follow_up_date <= date)
    .map(r => ({ r, c: ctx.live.find(c => String(c.id) === String(r.client_id)) })).filter(x => x.c)
    .sort((a, b) => String(a.r.follow_up_date).localeCompare(String(b.r.follow_up_date))).slice(0, 3);
  return Promise.all(due.map(async ({ r, c }) => {
    const cfv = c.custom_field_values || {}, whatsapp = cfv.winChannel === 'whatsapp';
    const asked = r.asked_date ? new Date(String(r.asked_date).slice(0, 10) + 'T12:00:00Z') : null;
    const o = { client: c.name, contact: cfv.contact || '', ask: r.question, askedOn: asked ? asked.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }) : '',
      waitedDays: asked ? Math.max(0, Math.round((Date.parse(date + 'T12:00:00Z') - asked) / DAY)) : null, sender: firstName(me.name), agency: acc.settings.appName || 'Based Agency', whatsapp };
    const res = await ask(acc, followUpPrompt(o), undefined, 4000, opts);
    const out = (res && res.ok && followUpParse(res.reply, whatsapp)) || followUpPlain(o);
    return { reminderId: r.id, clientId: c.id, client: c.name, ask: clip(r.question, 140), ch: whatsapp ? 'whatsapp' : 'email', subject: out.subject || '', body: out.body || '', plain: !(res && res.ok) };
  }));
}
// This person's part of the weekly win updates due in the next two days, written from their own logged
// work the way Radar's automatic drafts are (lib/update-automations.js), waiting for them to send to Review
async function prepWins(admin, acc, ctx, me, opts) {
  const { winDraftPrompt, winPlainDraft } = require('../js/core/win-prompt.js');
  const { clientWeek, getsUpdates } = require('./update-automations');
  const appName = acc.settings.appName || 'Based Agency', out = [], write = [];
  for (const p of ctx.per) {
    const c = p.c, cfv = c.custom_field_values || {};
    if (!getsUpdates(c)) continue;   // paused, or set to no weekly update
    const w = clientWeek(c, ctx.impsBy[c.id] || [], ctx.draftsBy[c.id] || [], ctx.history, ctx.nowW, ctx.off);
    if (w.sent || w.daysLeft > 2) continue;
    const items = w.logged.filter(i => i.include_in_email !== false && i.author === me.name).sort((a, b) => new Date(a.date) - new Date(b.date));
    const part = (ctx.draftsBy[c.id] || []).find(d => d.author === me.name && d.draft && !d.draft_sent_at && (d.draft_status === 'pending' || d.draft_status === 'approved'));
    if (part) out.push({ clientId: c.id, client: c.name, wins: (part.draft_improvement_ids || []).length || items.length, state: part.draft_status === 'approved' ? 'approved' : part.ready_to_notify ? 'review' : 'written', preview: clip(part.draft, 200), due: w.daysLeft });
    else if (items.length && write.length < 3) write.push({ c, items, w });
  }
  await Promise.all(write.map(async ({ c, items, w }) => {
    const cfv = c.custom_field_values || {};
    const prompt = winDraftPrompt({ name: c.name, contact: cfv.contact || '', service: c.service, sow: c.sow, appName, bullets: items.map(i => '- ' + i.text).join('\n'),
      structure: String(me.email_instructions || '').trim(), whatsapp: cfv.winChannel === 'whatsapp' });
    const res = await ask(acc, prompt, undefined, 4000, opts);
    const text = (res && res.ok && String(res.reply || '').trim()) || winPlainDraft({ contact: cfv.contact || '', items: items.map(i => i.text), whatsapp: cfv.winChannel === 'whatsapp' });
    const { error } = await admin.from('client_drafts').upsert({ client_id: c.id, author: me.name, draft: text, draft_status: 'pending', draft_pending_since: new Date().toISOString(),
      draft_improvement_ids: items.map(i => i.id), draft_sent_at: null, draft_sent_by: '', ready_to_notify: false, updated_at: new Date().toISOString() }, { onConflict: 'client_id,author' });
    if (error) return;
    await admin.from('activity_log').insert({ client_id: c.id, user_id: null, action_type: 'draft_generated', description: `Claude wrote ${me.name}'s part from ${items.length} logged improvement${items.length === 1 ? '' : 's'} for Today’s Plan` }).then(() => {}, () => {});
    out.push({ clientId: c.id, client: c.name, wins: items.length, state: 'written', preview: clip(text, 200), due: w.daysLeft, new: true });
  }));
  return out;
}

// What's scheduled goes into their Tasks: a request becomes their task, new work a new task, each due
// today at its time (Radar's task times: app_storage task-due-times).
async function blocksToTasks(admin, ctx, me, date, blocks) {
  const { sameTask } = require('./granola-tasks');
  const made = [], times = {};
  const open = ctx.tasks.slice();
  for (const b of blocks) {
    if (b.ref && b.ref.kind === 'task') { b.taskId = b.ref.id; const t = open.find(x => x.id === b.ref.id); if (t && t.due_date === date) times[t.id] = b.start; continue; }
    if (b.ref && b.ref.kind === 'wa') { b.waId = b.ref.id; continue; }
    let row = null;
    if (b.ref && b.ref.kind === 'suggestion') {
      const s = b.ref.x.s;
      row = { title: clip(s.title, 120), description: [s.description, s.quote ? `“${s.quote}”` : '', s.source_title ? `From ${s.source === 'gmail' ? 'the email' : 'the meeting'} “${s.source_title}”.` : ''].filter(Boolean).join('\n\n') || null,
        client_id: s.client_id || null, link: s.source_url || null, priority: s.priority || 'medium' };
    } else if (b.title) {
      const dup = open.find(t => (!b.clientId || !t.client_id || String(t.client_id) === String(b.clientId)) && sameTask(t.title, b.title));
      if (dup) { b.taskId = dup.id; continue; }
      row = { title: clip(b.title, 120), description: 'Planned by Claude for today.', client_id: b.clientId || null, priority: 'medium' };
    }
    if (!row) continue;
    const { data, error } = await admin.from('tasks').insert({ ...row, status: 'todo', assigner_id: me.id, assignee_id: me.id, due_date: date }).select().single();
    if (error || !data) continue;
    b.taskId = data.id; times[data.id] = b.start; open.push(data); made.push({ id: data.id, title: data.title, from: b.ref ? 'request' : 'new' });
    if (b.ref && b.ref.kind === 'suggestion') await admin.from('task_suggestions').update({ status: 'added', task_id: data.id, decided_at: new Date().toISOString() }).eq('id', b.ref.id).then(() => {}, () => {});
  }
  if (Object.keys(times).length) {
    const { data: tt } = await admin.from('app_storage').select('value').eq('key', 'task-due-times').maybeSingle();
    let cur = {}; try { cur = tt && tt.value ? (typeof tt.value === 'string' ? JSON.parse(tt.value) : tt.value) : {}; } catch (e) { cur = {}; }
    await admin.from('app_storage').upsert({ key: 'task-due-times', value: JSON.stringify(Object.assign(cur, times)) }, { onConflict: 'key' }).then(() => {}, () => {});
  }
  return made;
}

async function makeDayPlan(admin, me, opts) {
  opts = opts || {};
  const acc = opts.acc || await claudeAccess(admin, me.id, { free: true }); if (acc.error) return acc;
  const person = { ...me, ...(acc.me || {}) };
  if (!person.email_instructions) { const { data: pr } = await admin.from('team_profiles').select('email_instructions').eq('id', person.id).maybeSingle(); person.email_instructions = (pr && pr.email_instructions) || ''; }
  const tz = acc.settings.timezone || process.env.TEAM_TIMEZONE || 'America/New_York';
  const now = opts.now ? new Date(opts.now) : new Date(), date = todayIn(tz, now);
  const ctx = await dayContext(admin, person, date, acc.settings, now);
  const nowHM = HM(new Date(now.getTime() + ctx.off)), late = minsOf(nowHM) > 9 * 60 + 15;
  const from = late ? hmOf(Math.min(17 * 60, Math.ceil(minsOf(nowHM) / 15) * 15)) : '09:00';
  if (!ctx.per.length && !ctx.today.length) {
    const plan = { v: 2, date, at: now.toISOString(), by: opts.by || 'auto', empty: true, schedule: [], followUps: [], wins: [], ahead: [], made: [] };
    await admin.from('app_storage').upsert({ key: PLAN_KEY(person.id), value: JSON.stringify(plan) }, { onConflict: 'key' });
    return plan;
  }
  const weekday = new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  const [dayR, aheadR, followUps, wins] = await Promise.all([
    ask(acc, dayPrompt({ me: person.name || 'this person', date, weekday, from, late, meetLines: ctx.meetLines, work: ctx.work }), PLAN_SYSTEM, 3000, opts, DAY_FORM),
    ctx.per.length ? ask(acc, aheadPrompt({ me: person.name || 'this person', date, weekday, facts: ctx.facts }), PLAN_SYSTEM, 3000, opts, AHEAD_FORM) : Promise.resolve({ ok: true, json: { proposals: [] } }),
    prepFollowUps(acc, ctx, person, date, opts).catch(() => []),
    prepWins(admin, acc, ctx, person, opts).catch(() => []),
  ]);
  const { out: dayOut, error } = readJson(dayR, o => Array.isArray(o.blocks));
  if (error) return { error, status: 502 };
  const ahead = (readJson(aheadR, o => Array.isArray(o.proposals)).out || { proposals: [] }).proposals;
  const byName = n => ctx.per.find(p => p.c.name.toLowerCase() === String(n || '').trim().toLowerCase()) || null;
  const refOf = v => { const k = String(v || '').replace(/[\[\]\s]/g, '').toUpperCase(); return ctx.refs[k] || null; };
  // the blocks, in order and inside the day, then into Tasks
  const blocks = dayOut.blocks.map(b => {
    const r = refOf(b.ref), p = r ? null : byName(b.client), c = r ? r.x.c : p ? p.c : null, start = minsOf(b.start);
    if (start == null || !(b.title || r)) return null;
    return { start: hmOf(start), minutes: Math.max(15, Math.min(180, Math.round(Number(b.minutes) || 30))), ref: r, clientId: c ? c.id : null, client: c ? c.name : '', title: clip(b.title || (r && (r.x.t || r.x.s || r.x.w || {}).title), 120) };
  }).filter(Boolean).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 10);
  const made = await blocksToTasks(admin, ctx, person, date, blocks);
  const prepFor = t => (dayOut.meeting_prep || []).find(m => String(m.meeting || '').trim().toLowerCase() === String(t || '').trim().toLowerCase());
  const meetings = ctx.today.map(x => ({ kind: 'meeting', start: HM(x.s), minutes: Math.max(15, Math.round((x.f - x.s) / 60000)), title: clip(x.e.title, 120), clientId: x.c ? x.c.id : null, client: x.c ? x.c.name : '',
    url: x.e.meeting_url || null, prep: ((prepFor(x.e.title) || {}).notes || []).map(n => clip(n, 140)).filter(Boolean).slice(0, 4) }));
  const schedule = [...blocks.map(b => ({ kind: b.taskId ? 'task' : b.waId ? 'wa' : 'work', start: b.start, minutes: b.minutes, title: b.title, clientId: b.clientId, client: b.client, taskId: b.taskId || null, waId: b.waId || null,
    from: b.ref ? b.ref.kind : 'new' })), ...meetings].sort((a, b) => a.start.localeCompare(b.start));
  const plan = { v: 2, date, at: now.toISOString(), by: opts.by || 'auto', schedule, followUps, wins,
    ahead: ahead.map(x => { const p = byName(x.client); return p ? { clientId: p.c.id, client: p.c.name, kind: ['risk', 'improve', 'addon', 'prep'].includes(x.kind) ? x.kind : 'improve', title: clip(x.title, 100), why: clip(x.why, 200),
      steps: (Array.isArray(x.steps) ? x.steps : []).map(s => clip(s, 90)).filter(Boolean).slice(0, 4), action: ['sprint', 'tasks', 'claude'].includes(x.action) ? x.action : 'tasks' } : null; }).filter(Boolean).slice(0, 4),
    made, aheadMissed: !!readJson(aheadR, o => Array.isArray(o.proposals)).error };
  await admin.from('app_storage').upsert({ key: PLAN_KEY(person.id), value: JSON.stringify(plan) }, { onConflict: 'key' });
  return plan;
}
async function readDayPlan(admin, userId) {
  const { data } = await admin.from('app_storage').select('value').eq('key', PLAN_KEY(userId)).maybeSingle();
  return data ? settingsOf(data) : null;
}
// The browser: today's plan (GET), or a new one now (POST: counts toward the 40)
async function dayPlanFor(admin, userId, opts) {
  opts = opts || {};
  const acc = await claudeAccess(admin, userId, { free: !opts.make }); if (acc.error) return acc;
  const tz = acc.settings.timezone || process.env.TEAM_TIMEZONE || 'America/New_York', date = todayIn(tz, opts.now ? new Date(opts.now) : undefined);
  if (!opts.make) { const p = await readDayPlan(admin, userId); return { plan: p && p.date === date ? p : null, date, last: p && p.date !== date ? p.date : null }; }
  const plan = await makeDayPlan(admin, acc.me, { ...opts, acc, by: 'me' });
  if (plan.error) return plan;
  await countUse(admin, userId, acc.used);
  return { plan, date, left: DAILY_CAP - acc.used - 1 };
}
// The weekday mornings: everyone with the Assistant on who has no plan for today yet, a few at a time,
// while there's time; the next run picks up the rest.
async function dayPlanTick(admin, opts) {
  opts = opts || {};
  const k = await claudeKey(admin);
  if (!k.apiKey) return { skipped: 'Claude isn’t connected' };
  const tz = k.settings.timezone || process.env.TEAM_TIMEZONE || 'America/New_York';
  const now = opts.now ? new Date(opts.now) : new Date(), date = todayIn(tz, now), dow = new Date(date + 'T12:00:00Z').getUTCDay();
  if (!opts.any && (dow === 0 || dow === 6)) return { skipped: 'weekend' };
  const { data: people } = await admin.from('team_profiles').select('id, name, email, role, ai_chat_enabled, access_revoked').eq('ai_chat_enabled', true);
  const start = Date.now(), budget = opts.budgetMs || 45000, made = [], failed = [];
  const due = [];
  for (const p of (people || []).filter(p => !p.access_revoked)) { const have = await readDayPlan(admin, p.id); if (!have || have.date !== date) due.push(p); }
  for (let i = 0; i < due.length; i += 3) {
    if (Date.now() - start > budget) break;
    await Promise.all(due.slice(i, i + 3).map(async p => {
      try { const r = await makeDayPlan(admin, p, { ...opts, acc: { ...k, me: p } }); if (r.error) failed.push(p.id); else made.push(p.id); } catch (e) { failed.push(p.id); }
    }));
  }
  return { date, made: made.length, failed: failed.length, left: due.length - made.length - failed.length };
}

module.exports = { claudeAccess, countUse, sprintFromMeeting, sprintPrompt, makeDayPlan, dayPlanFor, dayPlanTick, dayPrompt, aheadPrompt, readDayPlan, PLAN_KEY, DAILY_CAP };
