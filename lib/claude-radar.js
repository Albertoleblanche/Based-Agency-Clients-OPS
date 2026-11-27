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
  try { const ca = require('./conn-alerts'); if (res.ok) await ca.connOk(null, 'claude'); else { const why = ca.aiFailure(res.status, data && data.error && data.error.message); if (why) await ca.connLost(null, 'claude', { why }); } } catch (e) {}   // Nov 26
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

// ---- Today's Plan (Nov 25, v3: a plan, not a to-do list) -------------------------------------------
// Each weekday morning, for each person with the Assistant on, Claude decides what the day is for:
//  • a headline and why: the day's purpose, from the weekday, US holidays (clients off), deadlines and
//    what depends on what;
//  • 2 to 4 moves in time order around their meetings, each covering the tasks, requests or WhatsApp
//    items it does (similar work for several clients is one move), with why and a line for when it's
//    done. Each move's work is in their Tasks, so the app can tick the move off by itself;
//  • what it left for later on purpose and why (a message to a teammate when that unblocks it);
//  • what's coming that's worth acting on now (too many sprints at once, a quiet Focus client...);
//  • the prep: follow-ups due, written as Radar's Nudge, and their part of the weekly win updates due,
//    waiting for them to send to Review (only what's theirs to send).
const PLAN_SYSTEM = 'You are the planning partner of a person on Based Agency’s team (a marketing agency for home-services businesses: Google Ads, Meta ads, SEO, websites). You plan from what Radar knows, concretely and realistically. You always answer by using the tool you’re given, once, with every field filled in.';
const PLAN_FORM = { name: 'write_the_plan', description: 'Today’s plan: what the day is for, the few moves that get it done, what to leave for later on purpose, and what’s coming.', input_schema: { type: 'object', required: ['headline', 'why', 'moves', 'left_out', 'coming_up', 'meeting_prep'], properties: {
  headline: S('What today is for, in one plain sentence under 130 characters. A decision, not a list.'),
  why: S('Two or three sentences on why this is the right plan today, from the facts: the weekday or a holiday, deadlines, what depends on what. Under 420 characters.'),
  moves: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'object', required: ['start', 'when', 'minutes', 'refs', 'client', 'title', 'why', 'done_line'], properties: {
    start: S('When it starts, HH:MM, 24-hour.'),
    when: S('When, the way a person says it, under 22 characters: Morning, Before lunch, After lunch, Afternoon, End of day, Before the 2 pm call.'),
    minutes: { type: 'integer', minimum: 15, maximum: 240 },
    refs: { type: 'array', maxItems: 6, items: S('A ref this move covers, like T2, S1 or W1, without brackets.') },
    client: S('The client’s exact name, or "" when the move covers several clients.'),
    title: S('The move, under 80 characters. Several similar items done in one sitting are one move.'),
    why: S('Why now and why in this order, from the facts, with the numbers. Under 200 characters.'),
    done_line: S('What Radar tells the person when it’s done: one short sentence on what it makes possible, under 100 characters, no exclamation marks.') } } },
  left_out: { type: 'array', maxItems: 3, items: { type: 'object', required: ['text', 'refs', 'action', 'to', 'message'], properties: {
    text: S('What you left for later on purpose and why, under 200 characters.'),
    refs: { type: 'array', maxItems: 4, items: S('A ref it’s about, without brackets.') },
    action: { type: 'string', enum: ['none', 'message', 'open'] },
    to: S('For message: the teammate’s name, else "".'),
    message: S('For message: a short, friendly message to them in the person’s voice, else "".') } } },
  coming_up: { type: 'array', maxItems: 3, items: { type: 'object', required: ['client', 'text', 'action', 'title', 'steps'], properties: {
    client: S('The client’s exact name, or "".'),
    text: S('What’s coming and what to do about it now, with the numbers, under 200 characters.'),
    action: { type: 'string', enum: ['none', 'sprint', 'tasks', 'claude'] },
    title: S('For sprint, tasks or claude: a title under 70 characters, else "".'),
    steps: { type: 'array', maxItems: 4, items: S('A step starting with a verb, under 70 characters.') } } } },
  meeting_prep: { type: 'array', maxItems: 4, items: { type: 'object', required: ['meeting', 'notes'], properties: {
    meeting: S('The meeting’s exact title.'), notes: { type: 'array', maxItems: 4, items: S('One thing to bring up, under 100 characters.') } } } } } } };

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
  const [{ data: cl }, { data: tk }, { data: rems }, { data: sg }, { data: myTime }, { data: monthTime }, { data: sp }, { data: groups }, { data: wa }, { data: sig }, { data: evs }, { data: imps }, { data: drafts }, { data: hist }, { data: team }] = await Promise.all([
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
    safe(admin.from('team_profiles').select('id, name')),
  ]);
  const nameOf = id => ((team || []).find(p => p.id === id) || {}).name || '';
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
  const skRow = (await safe(admin.from('app_storage').select('value').eq('key', 'update-skips').maybeSingle())).data, skips = skRow && skRow.value ? settingsOf(skRow) : {};   // weeks skipped (Nov 27)
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
  // a task as Claude sees it: due, late, in review, a sprint step, who gave it, and its notes (they
  // often say what to wait for or do first)
  const taskLine = (c, t) => `${ref('T', 'task', t.id, { c, t })}${clip(t.title, 100)}${t.due_date ? ` (due ${day(t.due_date)}${t.due_date < date ? ', late' : ''})` : ''}${t.status === 'in_review' ? ' (in review' + (t.assigner_id && t.assigner_id !== me.id && nameOf(t.assigner_id) ? ` with ${nameOf(t.assigner_id)}` : '') + ')' : t.status === 'in_progress' ? ' (started)' : ''}${t.sprint_id ? ' (sprint step)' : ''}${t.assigner_id && t.assigner_id !== me.id && t.status !== 'in_review' && nameOf(t.assigner_id) ? ` (from ${nameOf(t.assigner_id)})` : ''}${t.description ? `. Notes: ${clip(t.description, 220)}` : ''}`;
  // the work to fit into today
  const work = per.map(p => {
    const L = [`## ${p.c.name}${p.owner ? ' (you own it)' : ''}${(p.c.custom_field_values || {}).focus ? ' · Focus client' : ''}`];
    if (p.sps.length) L.push(`Sprint on now: ${p.sps.map(s => `${s.title}${s.goal ? ` (goal: ${clip(s.goal, 120)})` : ''}, ends ${day(s.end_date)}`).join('; ')}`);
    if (p.ct.length) L.push(`Your open tasks:\n${p.ct.slice(0, 7).map(t => `- ${taskLine(p.c, t)}`).join('\n')}`);
    if (p.asks.length) L.push(`They asked for (not in your tasks yet): ${p.asks.slice(0, 4).map(s => `${ref('S', 'suggestion', s.id, { c: p.c, s })}${clip(s.title, 90)}${s.out_of_scope ? ' (not in their plan: an add-on)' : ''}`).join('; ')}`);
    if (p.chat.length) L.push(`Waiting in their WhatsApp group: ${p.chat.slice(0, 4).map(w => `${ref('W', 'wa', w.id, { c: p.c, w })}${clip(w.title, 90)}`).join('; ')}`);
    return L.join('\n');
  }).join('\n\n') + (() => {
    const loose = tasks.filter(t => !t.client_id).sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999')).slice(0, 4);
    return loose.length ? `\n\n## Not for a client\nYour open tasks:\n${loose.map(t => `- ${taskLine(null, t)}`).join('\n')}` : '';
  })();
  const meetLines = today.map(x => `- ${HM(x.s)} to ${HM(x.f)}: "${clip(x.e.title, 80)}"${x.c ? ` with ${x.c.name}` : ''}`).join('\n');
  // the look ahead: the facts per client
  const daysIn = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7), 0)).getUTCDate(), dayN = +date.slice(8, 10);
  const facts = per.map(p => {
    const c = p.c, id = String(c.id), cfv = c.custom_field_values || {}, F = [`## ${c.name}: ${plans[id] ? plans[id].replace(/^[^:]*:\s*/, '') : `pays for ${c.service || 'not set in Radar'}`}`];
    const used = (monthTime || []).filter(e => String(e.client_id) === id && !e.deleted_at).reduce((a, e) => a + (Number(e.minutes) || 0), 0) / 60, budget = Number(c.monthly_hour_budget) || 0;
    if (budget) { const pace = used / Math.max(1, dayN) * daysIn; F.push(`Hours this month: ${Math.round(used)} of ${budget}${pace > budget * 1.05 ? `, on pace for ${Math.round(pace)} (over)` : pace < budget * 0.6 && dayN > 10 ? `, on pace for ${Math.round(pace)} (well under)` : ''}`); }
    const w = clientWeek(c, impsBy[c.id] || [], draftsBy[c.id] || [], history, nowW, off, skips);
    F.push(`Weekly update: ${w.sent ? (w.skipped && w.skipped.length && w.last && +w.skipped[w.skipped.length - 1] === +w.last ? 'skipped this week on purpose' : 'sent this week') : w.daysLeft < 0 ? `late by ${-w.daysLeft} days` : w.daysLeft === 0 ? 'due today' : `due in ${w.daysLeft} days`}; ${w.logged.filter(i => i.include_in_email !== false).length} wins logged for it`);
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
  // the week around today: US holidays (clients are off), sprints and their open steps, Focus clients
  // with nothing planned
  const { holidayOn } = require('./us-holidays');
  const ahead = n => new Date(Date.parse(date + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
  const W = [];
  for (let i = 0; i <= 7; i++) { const d = ahead(i), h = holidayOn(d); if (h) W.push(`${i === 0 ? 'Today' : day(d)} is ${h} in the US: clients are off.`); }
  if (/^Day after Thanksgiving$|^Thanksgiving$/.test(holidayOn(date) || holidayOn(ahead(1)) || holidayOn(ahead(-1)))) W.push('Black Friday and Cyber Monday are this weekend and Monday: online stores are at their busiest.');
  const stepsOf = id => tasks.filter(t => t.sprint_id === id).length;
  const spWeek = sprints.filter(s => s.start_date <= ahead(7));
  spWeek.forEach(s => { const c = live.find(x => String(x.id) === String(s.client_id)); W.push(`Sprint "${s.title}"${c ? ` for ${c.name}` : ''}: ${s.start_date > date ? `starts ${day(s.start_date)}` : 'running'}, ends ${day(s.end_date)}, ${stepsOf(s.id)} steps open for you.`); });
  if (spWeek.length >= 3) W.push(`That's ${spWeek.length} sprints at once within a week, with ${spWeek.reduce((a, s) => a + stepsOf(s.id), 0)} open steps.`);
  live.filter(c => (c.custom_field_values || {}).focus && (c.custom_field_values || {}).owner === me.name && !tasks.some(t => String(t.client_id) === String(c.id)) && !sprints.some(s => String(s.client_id) === String(c.id))).slice(0, 3).forEach(c => {
    const h = (monthTime || []).filter(e => String(e.client_id) === String(c.id) && !e.deleted_at).reduce((a, e) => a + (Number(e.minutes) || 0), 0) / 60;
    W.push(`${c.name} is a Focus client you own with nothing planned: no open tasks, no sprint, ${h < 1 ? (h ? `${Math.round(h * 60)} minutes` : 'no time') : `${Math.round(h * 10) / 10} hours`} logged this month.`);
  });
  const week = W.join('\n');
  return { per, refs, work, meetLines, today, facts, week, impsBy, draftsBy, history, skips, nowW, off, live, tasks, rems: rems || [], plans };
}

function planPrompt(o) {
  return `Write ${o.me}'s plan for ${o.weekday}, ${o.date}${o.holiday ? ` (${o.holiday} in the US)` : ''}. Work hours ${o.from} to 18:00, lunch 12:30 to 13:30.${o.late ? ` It's ${o.from} now: plan from now on.` : ''}

This is a plan, not a to-do list. Decide what today is for, choose the few moves that get it done, and say what you're leaving for later on purpose and why. Think like a sharp chief of staff who knows these clients: see what depends on what (save the before numbers before changing a site, back up before updates), do similar work for several clients in one sitting, follow what the task notes say (like waiting until after a busy weekend), use quiet days for groundwork, and point out what's coming before it becomes a problem.

The week:
${o.week || '- nothing unusual'}

Meetings today (fixed):
${o.meetLines || '- none'}

Work Radar knows about, each with a [ref]:
${o.work || '(nothing open)'}

What Radar knows about these clients:
${o.facts || '(nothing more)'}

Use write_the_plan:
- headline: what today is for, as a decision.
- why: why this plan is right today, from the facts.
- moves: 2 to 4 (1 when there's little to do), about 4 to 6 hours of work in all, in time order around the meetings and lunch, with 10 minutes free before each meeting. Late and due-today items, Focus clients and what clients asked for come first unless a note or a dependency says otherwise. List the refs each move covers. A move with no refs is new work worth doing today (at most one).
- done_line: for each move, what finishing it makes possible, said simply (like "Baselines saved: the before numbers for three win updates.").
- left_out: items the person might expect to see today (late, due soon, a sprint's next step) that you left for later, each with the reason. Use message when one short note to a teammate unblocks it, like a task waiting in their review.
- coming_up: up to 3 things in the next two weeks worth acting on now: too many sprints at once, a Focus client with nothing planned, hours running out, an update due with few wins logged, an add-on to offer. With the numbers.
- meeting_prep: for each meeting with a client, 2 to 4 things to bring up.
Only what the facts support; no generic advice. Plain, warm and direct, the way a good colleague talks. Positive about the agency: nothing that makes it look bad.`;
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
    const w = clientWeek(c, ctx.impsBy[c.id] || [], ctx.draftsBy[c.id] || [], ctx.history, ctx.nowW, ctx.off, ctx.skips);
    if (w.sent || w.daysLeft > 2) continue;
    const items = w.logged.filter(i => i.include_in_email !== false && i.author === me.name).sort((a, b) => new Date(a.date) - new Date(b.date));
    const part = (ctx.draftsBy[c.id] || []).find(d => d.author === me.name && d.draft && !d.draft_sent_at && (d.draft_status === 'pending' || d.draft_status === 'approved'));
    // already in Review or approved: nothing for them to do; no wins: nothing to send
    if (part) { const n = (part.draft_improvement_ids || []).length || items.length; if (n && part.draft_status !== 'approved' && !part.ready_to_notify) out.push({ clientId: c.id, client: c.name, wins: n, state: 'written', preview: clip(part.draft, 200), due: w.daysLeft }); }
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

// Each move's work is in their Tasks, so Radar can tell when it's done: a task it names is used as it
// is, a request becomes their task, new work a new task (due today). Moves starting today get their
// time on the task due today (Radar's task times: app_storage task-due-times).
async function movesToTasks(admin, ctx, me, date, moves) {
  const { sameTask } = require('./granola-tasks');
  const made = [], times = {}, open = ctx.tasks.slice(), used = new Set();
  const newTask = async row => {
    const { data, error } = await admin.from('tasks').insert({ ...row, status: 'todo', assigner_id: me.id, assignee_id: me.id, due_date: date }).select().single();
    if (error || !data) return null;
    open.push(data); return data;
  };
  for (const m of moves) {
    m.taskIds = []; m.waIds = [];
    for (const r of m.refs) {
      if (r.kind === 'task') { if (!used.has(r.id)) { used.add(r.id); m.taskIds.push(r.id); } continue; }
      if (r.kind === 'wa') { m.waIds.push(r.id); continue; }
      if (r.kind === 'suggestion') {
        const sg = r.x.s;
        const t = await newTask({ title: clip(sg.title, 120), description: [sg.description, sg.quote ? `“${sg.quote}”` : '', sg.source_title ? `From ${sg.source === 'gmail' ? 'the email' : 'the meeting'} “${sg.source_title}”.` : ''].filter(Boolean).join('\n\n') || null,
          client_id: sg.client_id || null, link: sg.source_url || null, priority: sg.priority || 'medium' });
        if (!t) continue;
        m.taskIds.push(t.id); used.add(t.id); made.push({ id: t.id, title: t.title, from: 'request' });
        await admin.from('task_suggestions').update({ status: 'added', task_id: t.id, decided_at: new Date().toISOString() }).eq('id', r.id).then(() => {}, () => {});
      }
    }
    if (!m.refs.length && m.title) {
      const dup = open.find(t => !used.has(t.id) && (!m.clientId || !t.client_id || String(t.client_id) === String(m.clientId)) && sameTask(t.title, m.title));
      const t = dup || await newTask({ title: clip(m.title, 120), description: `Planned by Claude for today. ${m.why}`.trim(), client_id: m.clientId || null, priority: 'medium' });
      if (t) { m.taskIds.push(t.id); used.add(t.id); if (!dup) made.push({ id: t.id, title: t.title, from: 'new' }); }
    }
    const first = m.taskIds.map(id => open.find(t => t.id === id)).find(t => t && t.due_date === date);
    if (first && m.start) times[first.id] = m.start;
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
    const plan = { v: 3, date, at: now.toISOString(), by: opts.by || 'auto', empty: true, moves: [], meetings: [], leftOut: [], comingUp: [], followUps: [], wins: [], made: [] };
    await admin.from('app_storage').upsert({ key: PLAN_KEY(person.id), value: JSON.stringify(plan) }, { onConflict: 'key' });
    return plan;
  }
  const weekday = new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  const holiday = require('./us-holidays').holidayOn(date);
  const [planR, followUps, wins] = await Promise.all([
    ask(acc, planPrompt({ me: person.name || 'this person', date, weekday, holiday, from, late, week: ctx.week, meetLines: ctx.meetLines, work: ctx.work, facts: ctx.facts }), PLAN_SYSTEM, 8000, opts, PLAN_FORM),
    prepFollowUps(acc, ctx, person, date, opts).catch(() => []),
    prepWins(admin, acc, ctx, person, opts).catch(() => []),
  ]);
  const { out, error } = readJson(planR, o => Array.isArray(o.moves) && !!o.headline);
  if (error) return { error, status: 502 };
  const byName = n => ctx.live.find(c => c.name.toLowerCase() === String(n || '').trim().toLowerCase()) || null;
  const refOf = v => { const k = String(v || '').replace(/[\[\]\s]/g, '').toUpperCase(); return ctx.refs[k] || null; };
  const refsOf = list => (Array.isArray(list) ? list : []).map(refOf).filter(Boolean);
  // a when too long to show whole is said from its time
  const whenOf = n => n < 11 * 60 ? 'Morning' : n < 12 * 60 + 30 ? 'Before lunch' : n < 15 * 60 ? 'After lunch' : n < 17 * 60 ? 'Afternoon' : 'End of day';
  // the moves, in order and inside the day, then into Tasks
  const moves = out.moves.map(m => {
    const refs = refsOf(m.refs), named = byName(m.client), c = named || (refs.length && refs.every(r => r.x.c && refs[0].x.c && String(r.x.c.id) === String(refs[0].x.c.id)) ? refs[0].x.c : null);
    const start = minsOf(m.start), title = clip(m.title || (refs[0] && (refs[0].x.t || refs[0].x.s || refs[0].x.w || {}).title), 110);
    if (!title) return null;
    return { start: start == null ? null : hmOf(start), when: String(m.when || '').trim().length && String(m.when).trim().length <= 24 ? String(m.when).trim() : (start == null ? '' : whenOf(start)), minutes: Math.max(15, Math.min(240, Math.round(Number(m.minutes) || 30))),
      refs, clientId: c ? c.id : null, client: c ? c.name : '', title, why: clip(m.why, 240), doneLine: clip(m.done_line, 130) };
  }).filter(Boolean).sort((a, b) => String(a.start || '99').localeCompare(String(b.start || '99'))).slice(0, 4);
  const made = await movesToTasks(admin, ctx, person, date, moves);
  const prepFor = t => (out.meeting_prep || []).find(m => String(m.meeting || '').trim().toLowerCase() === String(t || '').trim().toLowerCase());
  const meetings = ctx.today.map(x => ({ start: HM(x.s), minutes: Math.max(15, Math.round((x.f - x.s) / 60000)), title: clip(x.e.title, 120), clientId: x.c ? x.c.id : null, client: x.c ? x.c.name : '',
    url: x.e.meeting_url || null, prep: ((prepFor(x.e.title) || {}).notes || []).map(n => clip(n, 140)).filter(Boolean).slice(0, 4) }));
  const taskIdsOf = refs => refs.filter(r => r.kind === 'task').map(r => r.id);
  const plan = { v: 3, date, at: now.toISOString(), by: opts.by || 'auto', holiday: holiday || null,
    headline: clip(out.headline, 160), why: clip(out.why, 480),
    moves: moves.map((m, i) => ({ id: `m${i + 1}`, start: m.start, when: m.when, minutes: m.minutes, title: m.title, why: m.why, doneLine: m.doneLine, clientId: m.clientId, client: m.client, taskIds: m.taskIds, waIds: m.waIds })),
    meetings,
    leftOut: (out.left_out || []).map(x => {
      const refs = refsOf(x.refs), act = ['message', 'open'].includes(x.action) ? x.action : 'none';
      const ok = act === 'message' ? !!(String(x.to || '').trim() && String(x.message || '').trim()) : act === 'open' ? taskIdsOf(refs).length > 0 : true;
      return x.text ? { text: clip(x.text, 220), action: ok ? act : 'none', taskIds: taskIdsOf(refs), to: act === 'message' ? clip(x.to, 60) : '', message: act === 'message' ? clip(x.message, 600) : '' } : null;
    }).filter(Boolean).slice(0, 3),
    comingUp: (out.coming_up || []).map(x => {
      const c = byName(x.client), act = ['sprint', 'tasks', 'claude'].includes(x.action) && c ? x.action : 'none';
      const steps = (Array.isArray(x.steps) ? x.steps : []).map(st => clip(st, 90)).filter(Boolean).slice(0, 4);
      return x.text ? { text: clip(x.text, 220), clientId: c ? c.id : null, client: c ? c.name : '', action: act === 'tasks' && !steps.length ? 'none' : act, title: clip(x.title, 90) || '', steps } : null;
    }).filter(Boolean).slice(0, 3),
    followUps, wins, made };
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
  if (acc.settings.claudeDayPlan === false) return { error: 'Today’s Plan is off in Settings → AI.', status: 403 };
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
  if (k.settings.claudeDayPlan === false) return { skipped: 'off in Settings' };
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

module.exports = { claudeKey, ask, readJson, clip, todayIn, settingsOf, S, claudeAccess, countUse, sprintFromMeeting, sprintPrompt, makeDayPlan, dayPlanFor, dayPlanTick, planPrompt, PLAN_FORM, readDayPlan, PLAN_KEY, DAILY_CAP };
