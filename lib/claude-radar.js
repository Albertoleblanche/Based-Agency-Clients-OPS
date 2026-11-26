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
// Claude fills in a form (a tool it has to use), so its answer always comes back as an object with the
// fields asked for, never as text to pick JSON out of (Nov 25: free-text answers came back unreadable)
async function callClaudeForm(acc, prompt, system, tool, maxTokens) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': acc.apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: acc.model, max_tokens: maxTokens || 2000, system, messages: [{ role: 'user', content: prompt }], tools: [tool], tool_choice: { type: 'tool', name: tool.name } }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, error: (data && data.error && data.error.message) || `Claude answered with an error (${res.status}).` };
  const use = ((data && data.content) || []).find(b => b.type === 'tool_use' && b.name === tool.name);
  if (data && data.stop_reason === 'max_tokens') return { ok: false, error: 'Claude’s answer ran too long and was cut off. Try again.', reply: JSON.stringify(use ? use.input : data.content).slice(0, 400) };
  return use && use.input && typeof use.input === 'object' ? { ok: true, json: use.input } : { ok: false, error: 'Claude didn’t fill in the plan. Try again.', reply: JSON.stringify(data && data.content).slice(0, 400) };
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
const PLAN_FORM = { name: 'write_day_plan', description: 'Today’s plan.', input_schema: { type: 'object', required: ['first', 'clients'], properties: {
  first: { type: 'array', maxItems: 3, items: S('“Client: what to do”, under 90 characters.') },
  clients: { type: 'array', maxItems: 6, items: { type: 'object', required: ['client', 'next', 'owe', 'win', 'addon'], properties: {
    client: S('The client’s exact name.'), next: S('The next step.'), owe: S('What they owe us, or "".'), win: S('A win to aim for.'), addon: S('An add-on to offer, or "".') } } } } } };

// ---- A meeting → a sprint ------------------------------------------------------------------------
const SPRINT_SYSTEM = 'You plan focused work for Based Agency, a marketing agency for home-services businesses (Google Ads, Meta ads, SEO, websites). You answer by filling in the form you’re given.';
function sprintPrompt(o) {
  return `Turn this meeting's action items for the agency's team into one sprint of focused work for ${o.me}: a few days on one client, in their Plan in Radar.

Client: ${o.client || 'none named'}.
${o.plan ? `What they pay us for: ${o.plan}` : 'What they pay us for: not set in Radar.'}
The meeting: "${o.title}", ${o.date}.

Notes:
"""
${o.summary}
"""

Fill in draft_sprint:
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

// ---- The daily plan --------------------------------------------------------------------------------
const PLAN_SYSTEM = 'You are the planning partner of a person on Based Agency’s team (a marketing agency for home-services businesses: Google Ads, Meta ads, SEO, websites). You write their plan for the day from what Radar knows. You answer by filling in the form you’re given.';

// What Radar knows about this person's clients today, as lines for the prompt (and the clients, ranked)
async function dayContext(admin, me, today, settings) {
  const since = new Date(new Date(today + 'T12:00:00Z').getTime() - 30 * DAY).toISOString().slice(0, 10);
  const safe = p => p.then(r => r, () => ({ data: null }));
  const [{ data: cl }, { data: tk }, { data: rems }, { data: sg }, { data: te }, { data: sp }, { data: groups }, { data: wa }] = await Promise.all([
    admin.from('clients').select('id, name, service, sow, status, custom_field_values, deleted_at, monthly_hour_budget'),
    admin.from('tasks').select('*').eq('assignee_id', me.id).neq('status', 'done'),
    admin.from('client_reminders').select('client_id, question, asked_by, asked_date, follow_up_date, status').eq('status', 'waiting'),
    safe(admin.from('task_suggestions').select('*').eq('assignee_id', me.id).eq('status', 'pending')),
    safe(admin.from('time_entries').select('client_id, entry_date').eq('user_id', me.id).gte('entry_date', since)),
    safe(admin.from('plan_sprints').select('id, title, client_id, goal, start_date, end_date, done_at').eq('user_id', me.id).gte('end_date', today)),
    safe(admin.from('wa_groups').select('jid, client_id')),
    safe(admin.from('wa_tasks').select('group_jid, title, kind, status, out_of_scope, scope_note, first_seen').eq('status', 'open')),
  ]);
  const live = (cl || []).filter(c => !c.deleted_at && c.status !== 'Paused');
  const tasks = (tk || []).filter(t => !t.deleted_at && !t.cancelled_at && !t.archived_at);
  const worked = new Set((te || []).map(e => String(e.client_id)));
  const jidClient = {}; (groups || []).forEach(g => { if (g.client_id) jidClient[g.jid] = String(g.client_id); });
  const sprints = (sp || []).filter(s => !s.done_at && s.start_date <= today);
  const per = live.map(c => {
    const id = String(c.id), cfv = c.custom_field_values || {};
    const ct = tasks.filter(t => String(t.client_id) === id).sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
    const owe = (rems || []).filter(r => String(r.client_id) === id);
    const asks = (sg || []).filter(s => String(s.client_id) === id);
    const chat = (wa || []).filter(w => jidClient[w.group_jid] === id);
    const sps = sprints.filter(s => String(s.client_id) === id);
    const owner = !!me.name && cfv.owner === me.name;
    const mine = owner || ct.length || worked.has(id) || owe.some(r => r.asked_by === me.id) || asks.length || sps.length;
    if (!mine) return null;
    const late = ct.filter(t => t.due_date && t.due_date < today).length, dueNow = ct.filter(t => t.due_date === today).length;
    const score = late * 4 + dueNow * 3 + owe.filter(r => r.follow_up_date && r.follow_up_date <= today).length * 2 + asks.length * 2 + chat.length * 2 + sps.length * 2 + (cfv.focus ? 3 : 0) + (owner ? 1 : 0) + ct.length;
    return { c, ct, owe, asks, chat, sps, owner, score };
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 8);
  const plans = await clientPlans(admin, per.map(p => p.c), settings).catch(() => ({}));
  const day = d => d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';
  const blocks = per.map(p => {
    const L = [`## ${p.c.name}${p.owner ? ' (you own it)' : ''}${(p.c.custom_field_values || {}).focus ? ' · Focus client' : ''}`];
    L.push(`Pays for: ${plans[String(p.c.id)] ? plans[String(p.c.id)].replace(/^[^:]*:\s*/, '') : (p.c.service || 'not set in Radar')}`);
    if (p.sps.length) L.push(`Sprint on now: ${p.sps.map(s => `${s.title}${s.goal ? ` (goal: ${clip(s.goal, 120)})` : ''}, ends ${day(s.end_date)}`).join('; ')}`);
    if (p.ct.length) L.push(`Your open tasks: ${p.ct.slice(0, 6).map(t => `${clip(t.title, 90)}${t.due_date ? ` (due ${day(t.due_date)}${t.due_date < today ? ', late' : ''})` : ''}`).join('; ')}`);
    if (p.asks.length) L.push(`They asked for (from ${p.asks.some(s => s.source === 'gmail') ? 'their emails' : 'meetings'}, not added yet): ${p.asks.slice(0, 4).map(s => `${clip(s.title, 90)}${s.out_of_scope ? ' [NOT IN THEIR PLAN]' : ''}`).join('; ')}`);
    if (p.chat.length) L.push(`Waiting in their WhatsApp group: ${p.chat.slice(0, 4).map(w => `${clip(w.title, 90)}${w.out_of_scope ? ' [NOT IN THEIR PLAN]' : ''}`).join('; ')}`);
    if (p.owe.length) L.push(`They owe us: ${p.owe.slice(0, 4).map(r => `${clip(r.question, 90)}${r.follow_up_date ? ` (follow up ${day(r.follow_up_date)})` : ''}`).join('; ')}`);
    return L.join('\n');
  });
  return { per, text: blocks.join('\n\n') };
}
function dayPlanPrompt(o) {
  return `Write ${o.me}'s plan for ${o.weekday}, ${o.date}: for each client below (most important first), the next step, what the client owes us, and one win to aim for. Then the three things to do first today.

What Radar knows:
${o.context}

Fill in write_day_plan:
- next: the one concrete thing to do next for them, starting with a verb, under 90 characters, from their late or due tasks, sprint, or what they asked for.
- owe: what we're waiting on from them, under 70 characters; "" when nothing.
- win: one result to aim for this week that's inside what they pay for and that the client would see as progress, under 90 characters. Positive wording only: no mention of problems, delays or anything late.
- addon: when something they asked for is marked NOT IN THEIR PLAN, the add-on to offer them, under 80 characters ("Offer a landing page for the new service area"); otherwise "".
- first: the three things to do first today, in order, each "Client: what to do", under 90 characters.
At most 6 clients, each with its exact name from above. Plain words, no markdown.`;
}
async function makeDayPlan(admin, me, opts) {
  opts = opts || {};
  const acc = opts.acc || await claudeAccess(admin, me.id, { free: true }); if (acc.error) return acc;
  const tz = acc.settings.timezone || process.env.TEAM_TIMEZONE || 'America/New_York';
  const now = opts.now ? new Date(opts.now) : new Date(), date = todayIn(tz, now);
  const { per, text } = await dayContext(admin, acc.me || me, date, acc.settings);
  if (!per.length) {
    const plan = { date, at: now.toISOString(), by: opts.by || 'auto', first: [], clients: [], empty: true };
    await admin.from('app_storage').upsert({ key: PLAN_KEY(me.id), value: JSON.stringify(plan) }, { onConflict: 'key' });
    return plan;
  }
  const weekday = new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  const r = await ask(acc, dayPlanPrompt({ me: (acc.me || me).name || 'this person', date, weekday, context: text }), PLAN_SYSTEM, 2500, opts, PLAN_FORM);
  const { out, error } = readJson(r, o => Array.isArray(o.clients));
  if (error) return { error, status: 502 };
  const byName = n => per.find(p => p.c.name.toLowerCase() === String(n || '').trim().toLowerCase());
  const plan = { date, at: now.toISOString(), by: opts.by || 'auto',
    first: (Array.isArray(out.first) ? out.first : []).map(s => clip(s, 140)).filter(Boolean).slice(0, 3),
    clients: out.clients.map(x => { const p = byName(x && x.client); return p ? { id: p.c.id, client: p.c.name, next: clip(x.next, 160), owe: clip(x.owe, 140), win: clip(x.win, 160), addon: clip(x.addon, 140) } : null; })
      .filter(Boolean).slice(0, 6) };
  await admin.from('app_storage').upsert({ key: PLAN_KEY(me.id), value: JSON.stringify(plan) }, { onConflict: 'key' });
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
  const tz = acc.settings.timezone || process.env.TEAM_TIMEZONE || 'America/New_York', date = todayIn(tz);
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

module.exports = { claudeAccess, countUse, sprintFromMeeting, sprintPrompt, makeDayPlan, dayPlanFor, dayPlanTick, dayPlanPrompt, readDayPlan, PLAN_KEY, DAILY_CAP };
