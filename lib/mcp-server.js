// Radar's MCP server (Nov 23): ChatGPT and Claude connect to https://<radar>/mcp and work in Radar as
// the person who connected them.
//
// Signing in: Supabase Auth is the OAuth 2.1 server (Authentication → OAuth Server in Supabase, with
// dynamic client registration on, and its authorization path set to /oauth/consent, Radar's
// oauth-consent.html). An unsigned request gets a 401 pointing at
// /.well-known/oauth-protected-resource/mcp, which names Supabase as the place to sign in. The token
// the AI then sends is a normal Supabase token for that person, so every read and write here goes
// through the same row level security as the app, as them; the rules the app keeps in its own
// code (who can move a task's date, what finishing a client's task logs) are kept here too.
//
// Transport: MCP's Streamable HTTP, stateless — each POST is one JSON-RPC message answered with
// JSON (no sessions, no server-sent stream; GET says 405, as the spec allows).
// Reached through api/integrations.js (?route=mcp, rewritten from /mcp in vercel.json) to stay
// inside the Hobby plan's 12 functions.
//
// Tools: my_day, list_clients, get_client, list_tasks, list_reminders, hours, meetings, search, fetch,
// list_sprints (read), and create_task, update_task, add_reminder, log_time, create_sprint,
// update_sprint (everyday changes).

const { createClient } = require('@supabase/supabase-js');
const { syncTimeEntryToHarvest } = require('./harvest-sync');
const { sendPushToUser, pushUrlFor } = require('./push-notify');

const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'based-radar', title: 'Based Radar', version: '1.0.0' };
const INSTRUCTIONS = 'Radar is Based Agency’s client-ops app: clients, tasks, follow-ups with clients (reminders), hours logged, and the meeting notes Radar read from Granola. '
  + 'You act as the person who connected you, with their permissions. Start with my_day for “what should I do”, list_clients or get_client for a client, '
  + 'and search when you only have a name. For what was said or agreed in a meeting, use meetings (with words or a client), then meetings with its id for the notes. '
  + 'Clients and people can be given by name. Dates are YYYY-MM-DD in the team’s time zone. '
  + 'Plan: create_sprint sets up a sprint in the person’s own Plan (a few days of focused work, usually for one client: dates, hours, a goal, and 3 to 6 steps that become their tasks); '
  + 'list_sprints shows their sprints and update_sprint changes one, adds steps or marks it done. Workdays skip weekends and US holidays, as the app does. '
  + 'Before create_task, update_task, add_reminder, log_time, create_sprint or update_sprint, make sure the details are what the person asked for.';

// ---- addresses -----------------------------------------------------------------------------------
function appUrl(req) { return (process.env.APP_URL || `https://${(req && (req.headers['x-forwarded-host'] || req.headers.host)) || 'localhost'}`).replace(/\/+$/, ''); }
function authServer() { return `${String(process.env.SUPABASE_URL || '').replace(/\/+$/, '')}/auth/v1`; }
function protectedResourceMetadata(req) {
  const base = appUrl(req);
  return { resource: `${base}/mcp`, authorization_servers: [authServer()], bearer_methods_supported: ['header'], resource_name: 'Based Radar', resource_documentation: `${base}/#settings` };
}
const link = (base, view, id) => `${base}${view === 'client' ? '/#client/' + encodeURIComponent(id) : '/#' + view}`;

// ---- dates (the team's time zone) ----------------------------------------------------------------
function dayIn(tz, d) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d || new Date());
  const g = t => (p.find(x => x.type === t) || {}).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
const addDays = (ds, n) => { const d = new Date(ds + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekday = ds => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(ds + 'T12:00:00Z').getUTCDay()];
const mondayOf = ds => { const w = new Date(ds + 'T12:00:00Z').getUTCDay(); return addDays(ds, -((w + 6) % 7)); };
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(new Date(s + 'T12:00:00Z'));
const hrs = m => Math.round((m || 0) / 6) / 10;   // minutes → hours, one decimal

class ToolError extends Error {}
const fail = msg => { throw new ToolError(msg); };

// ---- context: who's asking, and the lists most tools need ----------------------------------------
async function makeContext(token, req) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: u, error } = await admin.auth.getUser(token);
  if (error || !u || !u.user) return { status: 401 };
  const { data: me } = await admin.from('team_profiles').select('id, name, email, role, access_revoked').eq('id', u.user.id).maybeSingle();
  if (!me || me.access_revoked) return { status: 403 };
  // as the person: their token decides what they can read and change (row level security)
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: st } = await db.from('app_storage').select('value').eq('key', 'settings').maybeSingle();
  let settings = {}; try { settings = st && st.value ? JSON.parse(st.value) : {}; } catch (e) {}
  const tz = settings.timezone || process.env.TEAM_TIMEZONE || 'America/New_York';
  const ctx = { admin, db, me, tz, today: dayIn(tz), base: appUrl(req), cache: {} };
  return { ctx };
}
async function team(ctx) {
  if (!ctx.cache.team) { const { data } = await ctx.db.from('team_profiles').select('id, name, email, role, title, access_revoked'); ctx.cache.team = (data || []).filter(p => p.name); }
  return ctx.cache.team;
}
async function clientsOf(ctx) {
  if (!ctx.cache.clients) {
    const { data, error } = await ctx.db.from('clients').select('id, name, status, service, email, website, monthly_hour_budget, custom_field_values, deleted_at');
    if (error) fail(`Couldn’t read clients: ${error.message}`);
    ctx.cache.clients = (data || []).filter(c => !c.deleted_at);
  }
  return ctx.cache.clients;
}
const nameOf = (ctx, id) => ((ctx.cache.team || []).find(p => p.id === id) || {}).name || null;
const clientName = (ctx, id) => ((ctx.cache.clients || []).find(c => String(c.id) === String(id)) || {}).name || null;

// "Oakridge", "oakridge flooring" or an id → one client (or a clear question back)
async function findClient(ctx, q, required) {
  const s = String(q == null ? '' : q).trim();
  if (!s) { if (required) fail('Which client? Give its name.'); return null; }
  const all = await clientsOf(ctx), low = s.toLowerCase();
  const hit = all.find(c => String(c.id) === s) || all.find(c => c.name.toLowerCase() === low);
  if (hit) return hit;
  const some = all.filter(c => c.name.toLowerCase().startsWith(low)).concat(all.filter(c => !c.name.toLowerCase().startsWith(low) && c.name.toLowerCase().includes(low)));
  if (some.length === 1) return some[0];
  if (some.length > 1) fail(`More than one client matches “${s}”: ${some.slice(0, 8).map(c => c.name).join(', ')}. Which one?`);
  fail(`No client called “${s}” in Radar.`);
}
// "me", "Ana", "ana silva", an email or an id → one person on the team
async function findPerson(ctx, q, dflt) {
  const s = String(q == null ? '' : q).trim();
  const ps = (await team(ctx)).filter(p => !p.access_revoked);
  if (!s || /^(me|myself|i)$/i.test(s)) return dflt === undefined ? ctx.me : dflt;
  const low = s.toLowerCase();
  const hit = ps.find(p => p.id === s) || ps.find(p => p.name.toLowerCase() === low) || ps.find(p => (p.email || '').toLowerCase() === low);
  if (hit) return hit;
  const some = ps.filter(p => p.name.toLowerCase().split(/\s+/)[0] === low || p.name.toLowerCase().startsWith(low));
  if (some.length === 1) return some[0];
  if (some.length > 1) fail(`More than one person matches “${s}”: ${some.map(p => p.name).join(', ')}. Which one?`);
  fail(`No one called “${s}” on the team. The team: ${ps.map(p => p.name).join(', ')}.`);
}

// ---- shaping rows --------------------------------------------------------------------------------
function taskOut(ctx, t) {
  const late = t.due_date && t.status !== 'done' && t.due_date < ctx.today;
  return { id: t.id, title: t.title, status: t.status, priority: t.priority || null, due_date: t.due_date || null, overdue: !!late,
    assignee: nameOf(ctx, t.assignee_id), assigned_by: nameOf(ctx, t.assigner_id), client: t.client_id ? clientName(ctx, t.client_id) : null,
    link: t.link || null, notes: t.description ? String(t.description).slice(0, 500) : null, completed_at: t.completed_at || null };
}
function reminderOut(ctx, r) {
  return { id: r.id, client: r.client_id ? clientName(ctx, r.client_id) : null, ...(r.waiting_on ? { waiting_on_teammate: nameOf(ctx, r.waiting_on) || r.waiting_on } : {}), question: r.question, asked_by: nameOf(ctx, r.asked_by) || r.asked_by || null,
    asked_date: r.asked_date || null, follow_up_date: r.follow_up_date || null, status: r.status,
    due: r.status === 'waiting' && !!r.follow_up_date && r.follow_up_date <= ctx.today };
}
async function openTasks(ctx) {
  if (!ctx.cache.tasks) {
    const { data, error } = await ctx.db.from('tasks').select('*').neq('status', 'done').order('due_date', { ascending: true, nullsFirst: false });
    if (error) fail(`Couldn’t read tasks: ${error.message}`);
    ctx.cache.tasks = (data || []).filter(t => !t.deleted_at && !t.archived_at && !t.cancelled_at);
  }
  return ctx.cache.tasks;
}
async function waitingReminders(ctx) {
  if (!ctx.cache.rems) {
    const { data, error } = await ctx.db.from('client_reminders').select('*').eq('status', 'waiting').order('follow_up_date', { ascending: true });
    if (error) fail(`Couldn’t read follow-ups: ${error.message}`);
    ctx.cache.rems = data || [];
  }
  return ctx.cache.rems;
}
async function timeBetween(ctx, from, to, filters) {
  let q = ctx.db.from('time_entries').select('user_id, client_id, entry_date, minutes, description').gte('entry_date', from).lte('entry_date', to).is('deleted_at', null);
  if (filters && filters.userId) q = q.eq('user_id', filters.userId);
  if (filters && filters.clientId) q = q.eq('client_id', filters.clientId);
  const out = [];
  for (let from_ = 0; from_ < 20000; from_ += 1000) {
    const { data, error } = await q.range(from_, from_ + 999);
    if (error) fail(`Couldn’t read time: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

// Work logged on clients, leaving out deleted work (once addendum-deleted-work.sql has added deleted_at).
async function liveWork(ctx, query) {
  let r = await query(true);
  if (r.error && /deleted_at/.test(r.error.message || '')) r = await query(false);
  return (r && r.data) || [];
}

// ---- the tools -----------------------------------------------------------------------------------
// The meetings Radar read from Granola (Nov 23) that this person can see: the ones they were in;
// admins and approvers, all (the database enforces it too, addendum-granola-meetings.sql)
async function meetingsOf(ctx) {
  if (ctx.cache.meetings) return ctx.cache.meetings;
  const { data } = await ctx.db.from('app_storage').select('key, value, updated_at').like('key', 'granola-note:%').order('updated_at', { ascending: false }).limit(300);
  const all = ctx.me.role === 'admin' || ctx.me.role === 'approver', email = String(ctx.me.email || '').toLowerCase();
  ctx.cache.meetings = (data || []).map(r => { let m = {}; try { m = typeof r.value === 'string' ? JSON.parse(r.value) || {} : r.value || {}; } catch (e) {} return { ...m, id: r.key.slice('granola-note:'.length), at: m.meetingAt || m.at || r.updated_at }; })
    .filter(m => m.summary && m.state === 'done' && (all || (!!email && (m.people || []).includes(email))))
    .sort((x, y) => String(y.at).localeCompare(String(x.at)));
  return ctx.cache.meetings;
}
function meetingOut(ctx, m, withNotes) {
  const cid = m.metClientId || m.clientId || null, email = String(ctx.me.email || '').toLowerCase();
  return { id: m.id, title: m.title || 'A meeting', date: dayIn(ctx.tz, new Date(m.at)), client: cid ? clientName(ctx, cid) || null : null, notes_by: m.owner || null,
    you_were_there: (m.people || []).includes(email), tasks_suggested: m.items || 0, granola_url: m.url || null, ...(withNotes ? { notes: m.summary } : {}) };
}
const STR = (description, extra) => ({ type: 'string', description, ...(extra || {}) });
const DATE = description => ({ type: 'string', description: description + ' (YYYY-MM-DD)', pattern: '^\\d{4}-\\d{2}-\\d{2}$' });
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

// ---- Plan: sprints (Nov 25) ------------------------------------------------------------------------
// A sprint is private to the person (plan_sprints, row level security), and its steps are ordinary
// tasks for them linked by tasks.sprint_id, so they show in Tasks, Today and the calendar. Everything
// here does what the app's New Sprint does (js/features/plan.js): workdays skip weekends and US
// holidays, a new sprint starts today (tomorrow after 3 pm) and runs two weeks, steps are dated across
// it, and three reminders go with it (when it starts, halfway, the day before it ends).
const PLAN_OFF = 'Plan isn’t switched on in Radar yet: an admin runs addendum-colors-and-plan.sql in Supabase once.';
const ymd = d => d.toISOString().slice(0, 10);
function nthDow(y, m, dow, n) {
  if (n > 0) { const first = new Date(Date.UTC(y, m, 1)); return new Date(Date.UTC(y, m, 1 + (dow - first.getUTCDay() + 7) % 7 + 7 * (n - 1))); }
  const last = new Date(Date.UTC(y, m + 1, 0)); return new Date(Date.UTC(y, m, last.getUTCDate() - (last.getUTCDay() - dow + 7) % 7));
}
const observed = d => { const w = d.getUTCDay(); return w === 6 ? new Date(d.getTime() - 86400000) : w === 0 ? new Date(d.getTime() + 86400000) : d; };
const _hol = {};
function holidaysOf(y) {
  if (_hol[y]) return _hol[y];
  const thanks = nthDow(y, 10, 4, 4), out = {};
  [[observed(new Date(Date.UTC(y, 0, 1))), 'New Year’s Day'], [nthDow(y, 0, 1, 3), 'Martin Luther King Jr. Day'], [nthDow(y, 1, 1, 3), 'Presidents’ Day'],
   [nthDow(y, 4, 1, -1), 'Memorial Day'], [observed(new Date(Date.UTC(y, 5, 19))), 'Juneteenth'], [observed(new Date(Date.UTC(y, 6, 4))), 'Independence Day'],
   [nthDow(y, 8, 1, 1), 'Labor Day'], [thanks, 'Thanksgiving'], [new Date(thanks.getTime() + 86400000), 'Day after Thanksgiving'],
   [observed(new Date(Date.UTC(y, 11, 24))), 'Christmas Eve'], [observed(new Date(Date.UTC(y, 11, 25))), 'Christmas Day']]
    .forEach(([d, n]) => { out[ymd(d)] = n; });
  return (_hol[y] = out);
}
const holidayOn = ds => holidaysOf(Number(ds.slice(0, 4)))[ds] || holidaysOf(Number(ds.slice(0, 4)) + 1)[ds] || '';
const isWorkday = ds => { const w = new Date(ds + 'T12:00:00Z').getUTCDay(); return w !== 0 && w !== 6 && !holidayOn(ds); };
function workdays(start, end) { const out = []; for (let d = start, i = 0; d <= end && i < 400; d = addDays(d, 1), i++) if (isWorkday(d)) out.push(d); return out; }
function addWorkdays(ds, n) { let d = ds, k = 0; while (k < n) { d = addDays(d, 1); if (isWorkday(d)) k++; } return d; }
// A clock time on a day in the team's time zone, as an instant
function atTz(ds, hhmm, tz) {
  const [y, m, d] = ds.split('-').map(Number), [h, mi] = hhmm.split(':').map(Number), want = Date.UTC(y, m - 1, d, h, mi);
  let t = want;
  for (let i = 0; i < 2; i++) {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(t));
    const g = k => Number((p.find(x => x.type === k) || {}).value);
    t += want - Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'));
  }
  return new Date(t).toISOString();
}
function sprintStart(ctx) {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: ctx.tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  let d = hour >= 15 ? addDays(ctx.today, 1) : ctx.today;
  while (!isWorkday(d)) d = addDays(d, 1);
  return d;
}
const PRESETS = [['start', 'When it starts'], ['half', 'Halfway check-in'], ['end', 'The day before it ends']];
function presetReminders(start, end, tz) {
  const days = workdays(start, end), half = days[Math.floor((days.length - 1) / 2)] || start, beforeEnd = days.length > 1 ? days[days.length - 2] : start;
  const at = { start: [start, '09:00'], half: [half, '09:00'], end: [beforeEnd, '16:00'] };
  return PRESETS.map(([kind, label]) => ({ kind, label, at: atTz(at[kind][0], at[kind][1], tz) }));
}
const planOff = e => !!e && (e.code === 'PGRST205' || e.code === '42P01' || /plan_sprints|sprint_id/.test(e.message || '') && /schema cache|does not exist|Could not find/i.test(e.message || ''));
async function mySprints(ctx) {
  if (!ctx.cache.sprints) {
    const { data, error } = await ctx.db.from('plan_sprints').select('*').eq('user_id', ctx.me.id).order('start_date', { ascending: true });
    if (error) fail(planOff(error) ? PLAN_OFF : `Couldn’t read your Plan: ${error.message}`);
    ctx.cache.sprints = data || [];
  }
  return ctx.cache.sprints;
}
async function sprintSteps(ctx, ids) {
  if (!ids.length) return [];
  const { data, error } = await ctx.db.from('tasks').select('*').in('sprint_id', ids);
  if (error) fail(`Couldn’t read the sprint’s steps: ${error.message}`);
  return (data || []).filter(t => !t.deleted_at && !t.cancelled_at && !t.archived_at);
}
// "the Nico sprint", words from its title, or its id → one of your sprints
async function findSprint(ctx, q) {
  const str = String(q || '').trim(); if (!str) fail('Which sprint? Give its title or id.');
  const all = await mySprints(ctx);
  const byId = all.find(x => String(x.id) === str); if (byId) return byId;
  const words = str.toLowerCase().replace(/\bsprint\b/g, ' ').split(/\s+/).filter(Boolean);
  const hit = all.filter(x => words.every(w => `${x.title} ${clientName(ctx, x.client_id) || ''}`.toLowerCase().includes(w)));
  const open = hit.filter(x => !x.done_at), pool = open.length ? open : hit;
  if (pool.length === 1) return pool[0];
  if (pool.length > 1) fail(`More than one of your sprints matches: ${pool.slice(0, 8).map(x => `“${x.title}” (${x.start_date} to ${x.end_date}, id ${x.id})`).join('; ')}. Which one?`);
  fail(`No sprint of yours matches “${str}”.${all.length ? ` Yours: ${all.filter(x => !x.done_at).slice(-8).map(x => `“${x.title}”`).join(', ') || 'all done'}.` : ' Your Plan has no sprints yet.'}`);
}
// steps as the person gave them: ["Pull analytics", …] or [{ title, due_date }, …]
function stepsIn(list, start, end) {
  if (list == null) return [];
  if (!Array.isArray(list)) fail('steps should be a list.');
  const out = list.map(x => typeof x === 'string' ? { title: x } : (x || {})).map(x => ({ title: String(x.title || '').trim().slice(0, 200), due_date: x.due_date || null })).filter(x => x.title);
  if (out.length > 10) fail('Up to 10 steps at a time. A sprint reads best with 3 to 6: fold the small ones together.');
  out.forEach(x => { if (x.due_date && (!isDate(x.due_date) || x.due_date < start || x.due_date > end)) fail(`“${x.title}”: its due date should be a day in the sprint (${start} to ${end}).`); });
  return out;
}
// the next workday in the sprint with no step due yet, so added steps fill it in order (as the app does)
function nextStepDate(ctx, s, steps) {
  const days = workdays(s.start_date, s.end_date), taken = new Set(steps.map(t => t.due_date));
  return days.find(d => d >= ctx.today && !taken.has(d)) || days.filter(d => d >= ctx.today).pop() || s.end_date;
}
const stepRow = (ctx, s, title, due) => ({ title, description: '', priority: null, assigner_id: ctx.me.id, assignee_id: ctx.me.id, client_id: s.client_id || null, due_date: due, status: 'todo', sprint_id: s.id, ...(s.color ? { color: s.color } : {}) });
function sprintOut(ctx, s, steps) {
  const days = workdays(s.start_date, s.end_date), today = ctx.today;
  const state = s.done_at ? 'done' : today < s.start_date ? 'upcoming' : today > s.end_date ? 'ended' : 'running';
  const mine = steps.filter(t => t.sprint_id === s.id).sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')));
  const done = mine.filter(t => t.status === 'done').length;
  return { id: s.id, title: s.title, client: s.client_id ? clientName(ctx, s.client_id) : null, start_date: s.start_date, end_date: s.end_date, workdays: days.length,
    ...(state === 'running' ? { day: `${days.filter(d => d <= today).length} of ${days.length}` } : {}), state, hours: Number(s.hours) || 0, goal: s.goal || null,
    steps_done: `${done} of ${mine.length}`, steps: mine.map(t => ({ id: t.id, title: t.title, due_date: t.due_date || null, done: t.status === 'done' })),
    reminders: (Array.isArray(s.reminders) ? s.reminders : []).map(r => ({ what: r.label || r.text || 'Reminder', on: r.at ? dayIn(ctx.tz, new Date(r.at)) : null, ...(r.sent ? { sent: true } : {}) })) };
}
// what the app warns when a sprint's hours would push its client over its monthly hours
async function budgetWarning(ctx, s) {
  const c = s.client_id ? (await clientsOf(ctx)).find(x => String(x.id) === String(s.client_id)) : null;
  if (!c || !c.monthly_hour_budget || s.done_at) return null;
  const monthStart = ctx.today.slice(0, 8) + '01', monthEnd = addDays(addDays(monthStart, 32).slice(0, 8) + '01', -1);
  const all = workdays(s.start_date, s.end_date), ahead = all.filter(d => d >= ctx.today), left = ahead.filter(d => d <= monthEnd);
  if (!left.length) return null;
  const used = (await timeBetween(ctx, monthStart, ctx.today, { clientId: c.id })).reduce((a, e) => a + e.minutes, 0) / 60;
  const remaining = (Number(s.hours) || 0) * left.length / ahead.length, budget = Number(c.monthly_hour_budget);
  if (used + remaining <= budget + 0.5) return null;
  const month = new Date(monthStart + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' }), r = Math.round(remaining);
  return used > budget ? `${c.name} is already over its ${budget} h for ${month} (${Math.round(used)} h). The ${r} h of this sprint in ${month} go over too.`
    : `${c.name} has ${Math.round(budget - used)} h left for ${month}. The ${r} h of this sprint in ${month} would go over.`;
}

const TOOLS = [
  {
    name: 'my_day', title: 'My day in Radar', annotations: READ,
    description: 'What the signed-in person has on: their overdue tasks, tasks due today and in the next 7 days, follow-ups with clients that are due, tasks suggested from their meetings, and the hours they’ve logged today and this week. Use it for “what should I work on?”.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run(ctx) {
      await Promise.all([team(ctx), clientsOf(ctx)]);
      const mine = (await openTasks(ctx)).filter(t => t.assignee_id === ctx.me.id);
      const week = addDays(ctx.today, 7);
      const rems = (await waitingReminders(ctx)).filter(r => r.asked_by === ctx.me.id && r.follow_up_date && r.follow_up_date <= ctx.today);
      const time = await timeBetween(ctx, mondayOf(ctx.today), ctx.today, { userId: ctx.me.id });
      let suggested = 0;
      try { const { count } = await ctx.db.from('task_suggestions').select('id', { count: 'exact', head: true }).eq('assignee_id', ctx.me.id).eq('status', 'pending'); suggested = count || 0; } catch (e) {}
      return {
        person: ctx.me.name, today: `${weekday(ctx.today)} ${ctx.today}`,
        overdue: mine.filter(t => t.due_date && t.due_date < ctx.today).map(t => taskOut(ctx, t)),
        due_today: mine.filter(t => t.due_date === ctx.today).map(t => taskOut(ctx, t)),
        due_next_7_days: mine.filter(t => t.due_date > ctx.today && t.due_date <= week).map(t => taskOut(ctx, t)),
        no_date: mine.filter(t => !t.due_date).length,
        follow_ups_due: rems.map(r => reminderOut(ctx, r)),
        suggested_from_meetings: suggested,
        sprints: await (async () => { try {
          const on = (await mySprints(ctx)).filter(s => !s.done_at && s.start_date <= addDays(ctx.today, 7) && s.end_date >= ctx.today);
          const st = await sprintSteps(ctx, on.map(s => s.id));
          return on.map(s => { const o = sprintOut(ctx, s, st), next = o.steps.find(x => !x.done); return { title: o.title, client: o.client, state: o.state, ...(o.day ? { day: o.day } : { starts: o.start_date }), ends: o.end_date, steps_done: o.steps_done, next_step: next ? next.title : null }; });
        } catch (e) { return []; } })(),
        hours: { today: hrs(time.filter(e => e.entry_date === ctx.today).reduce((a, e) => a + e.minutes, 0)), this_week: hrs(time.reduce((a, e) => a + e.minutes, 0)) },
        open_in_radar: link(ctx.base, 'tasks'),
      };
    },
  },
  {
    name: 'list_clients', title: 'List clients', annotations: READ,
    description: 'Clients in Radar with their owner, service, Focus flag, hours this month against their monthly budget, open and overdue tasks, follow-ups waiting, and when work was last logged. Filter to Focus clients, ones needing attention, one owner, or a name.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      filter: STR('all (default), focus (the clients the owner wants extra attention on), or attention (overdue tasks, due follow-ups, nothing logged in 8+ days, or 90%+ of their hours used)', { enum: ['all', 'focus', 'attention'] }),
      owner: STR('Only clients this person owns: a name, or "me"'),
      search: STR('Part of a client’s name'),
    } },
    async run(ctx, a) {
      const [ps, cs] = await Promise.all([team(ctx), clientsOf(ctx)]);
      const monthStart = ctx.today.slice(0, 8) + '01';
      const [tasks, rems, time, work] = await Promise.all([openTasks(ctx), waitingReminders(ctx), timeBetween(ctx, monthStart, ctx.today),
        liveWork(ctx, live => { let q = ctx.db.from('client_improvements').select('client_id, author, date').gte('date', addDays(ctx.today, -60)); return live ? q.is('deleted_at', null) : q; })]);
      const owner = a.owner ? await findPerson(ctx, a.owner) : null;
      let rows = cs.filter(c => c.status !== 'Archived').map(c => {
        const cid = String(c.id), cfv = c.custom_field_values || {};
        const mineWork = (work || []).filter(w => String(w.client_id) === cid);
        const tally = {}; mineWork.forEach(w => { tally[w.author] = (tally[w.author] || 0) + 1; });
        const own = cfv.owner && ps.some(p => p.name === cfv.owner && !p.access_revoked) ? cfv.owner : (Object.entries(tally).sort((x, y) => y[1] - x[1])[0] || [null])[0];
        const last = mineWork.map(w => String(w.date).slice(0, 10)).sort().pop() || null;
        const used = time.filter(e => String(e.client_id) === cid).reduce((s, e) => s + e.minutes, 0);
        const ct = tasks.filter(t => String(t.client_id) === cid), cr = rems.filter(r => String(r.client_id) === cid);
        const budget = Number(c.monthly_hour_budget) || 0;
        const row = { id: c.id, name: c.name, owner: own || null, service: c.service || null, status: c.status || null, focus: !!cfv.focus,
          hours_this_month: hrs(used), monthly_hour_budget: budget || null, open_tasks: ct.length, overdue_tasks: ct.filter(t => t.due_date && t.due_date < ctx.today).length,
          follow_ups_waiting: cr.length, follow_ups_due: cr.filter(r => r.follow_up_date && r.follow_up_date <= ctx.today).length, last_work_logged: last };
        const quiet = !last || last < addDays(ctx.today, -8);
        row.needs_attention = c.status !== 'Paused' && (row.overdue_tasks > 0 || row.follow_ups_due > 0 || quiet || (budget > 0 && used / 60 >= budget * 0.9));
        return row;
      });
      if (a.filter === 'focus') rows = rows.filter(r => r.focus);
      if (a.filter === 'attention') rows = rows.filter(r => r.needs_attention);
      if (owner) rows = rows.filter(r => r.owner === owner.name);
      if (a.search) rows = rows.filter(r => r.name.toLowerCase().includes(String(a.search).toLowerCase()));
      rows.sort((x, y) => (y.focus - x.focus) || x.name.localeCompare(y.name));
      return { count: rows.length, clients: rows };
    },
  },
  {
    name: 'get_client', title: 'Get a client', annotations: READ,
    description: 'Everything about one client: details, Focus, hours this month by person against the budget, open tasks, follow-ups waiting, the last 15 pieces of work logged, and when the last weekly update went out.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['client'], properties: { client: STR('The client’s name (or id)') } },
    async run(ctx, a) {
      await team(ctx);
      const c = await findClient(ctx, a.client, true), cid = String(c.id), cfv = c.custom_field_values || {};
      const monthStart = ctx.today.slice(0, 8) + '01';
      const [tasks, rems, time, work, { data: drafts }] = await Promise.all([openTasks(ctx), waitingReminders(ctx), timeBetween(ctx, monthStart, ctx.today, { clientId: c.id }),
        liveWork(ctx, live => { let q = ctx.db.from('client_improvements').select('author, text, date, include_in_email').eq('client_id', c.id); if (live) q = q.is('deleted_at', null); return q.order('date', { ascending: false }).limit(15); }),
        ctx.db.from('client_drafts').select('author, draft_sent_at').eq('client_id', c.id)]);
      const byPerson = {}; time.forEach(e => { const n = nameOf(ctx, e.user_id) || 'Someone'; byPerson[n] = (byPerson[n] || 0) + e.minutes; });
      const lastSent = (drafts || []).map(d => d.draft_sent_at).filter(Boolean).sort().pop() || null;
      return {
        id: c.id, name: c.name, status: c.status || null, service: c.service || null, email: c.email || null, website: c.website || null,
        owner: cfv.owner || null, focus: !!cfv.focus,
        hours_this_month: { total: hrs(time.reduce((s, e) => s + e.minutes, 0)), budget: Number(c.monthly_hour_budget) || null, by_person: Object.fromEntries(Object.entries(byPerson).map(([k, v]) => [k, hrs(v)])) },
        open_tasks: tasks.filter(t => String(t.client_id) === cid).map(t => taskOut(ctx, t)),
        follow_ups_waiting: rems.filter(r => String(r.client_id) === cid).map(r => reminderOut(ctx, r)),
        recent_work: (work || []).map(w => ({ date: String(w.date).slice(0, 10), by: w.author, text: w.text, in_weekly_update: w.include_in_email !== false })),
        last_weekly_update_sent: lastSent,
        open_in_radar: link(ctx.base, 'client', c.id),
      };
    },
  },
  {
    name: 'list_tasks', title: 'List tasks', annotations: READ,
    description: 'Tasks in Radar. By default the signed-in person’s open tasks, soonest due first. Filter by who has them, status, client and when they’re due.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      assignee: STR('Whose tasks: "me" (default), "anyone", or a person’s name'),
      status: STR('open (default: to do, in progress, in review), done, or all', { enum: ['open', 'done', 'all'] }),
      client: STR('Only this client’s tasks (name)'),
      due: STR('overdue, today, this_week (the next 7 days), or any (default)', { enum: ['overdue', 'today', 'this_week', 'any'] }),
      limit: { type: 'integer', minimum: 1, maximum: 200, description: 'At most this many (default 50)' },
    } },
    async run(ctx, a) {
      await Promise.all([team(ctx), clientsOf(ctx)]);
      const who = /^(anyone|everyone|all)$/i.test(String(a.assignee || '')) ? null : await findPerson(ctx, a.assignee);
      const c = a.client ? await findClient(ctx, a.client) : null;
      let rows;
      if ((a.status || 'open') === 'open') rows = await openTasks(ctx);
      else {
        let q = ctx.db.from('tasks').select('*').order('completed_at', { ascending: false, nullsFirst: false }).limit(500);
        if (a.status === 'done') q = q.eq('status', 'done');
        if (who) q = q.eq('assignee_id', who.id);
        const { data, error } = await q; if (error) fail(error.message);
        rows = (data || []).filter(t => !t.deleted_at && !t.cancelled_at);
      }
      if (who) rows = rows.filter(t => t.assignee_id === who.id);
      if (c) rows = rows.filter(t => String(t.client_id) === String(c.id));
      if (a.due === 'overdue') rows = rows.filter(t => t.due_date && t.due_date < ctx.today && t.status !== 'done');
      if (a.due === 'today') rows = rows.filter(t => t.due_date === ctx.today);
      if (a.due === 'this_week') rows = rows.filter(t => t.due_date && t.due_date >= ctx.today && t.due_date <= addDays(ctx.today, 7));
      const n = rows.length;
      return { count: n, for: who ? who.name : 'everyone', tasks: rows.slice(0, a.limit || 50).map(t => taskOut(ctx, t)), open_in_radar: link(ctx.base, 'tasks') };
    },
  },
  {
    name: 'list_reminders', title: 'List follow-ups', annotations: READ,
    description: 'Follow-ups with clients (Radar’s Reminders): questions the team asked a client and when to chase them. By default the ones still waiting, soonest first.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      status: STR('waiting (default), due (waiting and the follow-up day has come), answered, closed, or all', { enum: ['waiting', 'due', 'answered', 'closed', 'all'] }),
      client: STR('Only this client’s (name)'),
      asked_by: STR('Only the ones this person asked: a name, or "me"'),
    } },
    async run(ctx, a) {
      await Promise.all([team(ctx), clientsOf(ctx)]);
      const c = a.client ? await findClient(ctx, a.client) : null, by = a.asked_by ? await findPerson(ctx, a.asked_by) : null;
      let rows;
      if (!a.status || a.status === 'waiting' || a.status === 'due') rows = await waitingReminders(ctx);
      else { let q = ctx.db.from('client_reminders').select('*').order('follow_up_date', { ascending: false }).limit(300); if (a.status !== 'all') q = q.eq('status', a.status); const { data, error } = await q; if (error) fail(error.message); rows = data || []; }
      if (a.status === 'due') rows = rows.filter(r => r.follow_up_date && r.follow_up_date <= ctx.today);
      if (c) rows = rows.filter(r => String(r.client_id) === String(c.id));
      if (by) rows = rows.filter(r => r.asked_by === by.id);
      return { count: rows.length, follow_ups: rows.slice(0, 200).map(r => reminderOut(ctx, r)), open_in_radar: link(ctx.base, 'reminders') };
    },
  },
  {
    name: 'hours', title: 'Hours logged', annotations: READ,
    description: 'Hours logged in Radar (and Harvest) for a period: the total, by client, by person and by day. By default the signed-in person’s hours this week.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      period: STR('today, this_week (default), last_week, this_month or last_month; ignored when from and to are given', { enum: ['today', 'this_week', 'last_week', 'this_month', 'last_month'] }),
      from: DATE('First day'), to: DATE('Last day'),
      person: STR('"me" (default), "everyone", or a person’s name'),
      client: STR('Only this client (name)'),
    } },
    async run(ctx, a) {
      await Promise.all([team(ctx), clientsOf(ctx)]);
      let from, to;
      if (isDate(a.from) && isDate(a.to)) { from = a.from; to = a.to; if (from > to) [from, to] = [to, from]; }
      else {
        const p = a.period || 'this_week', mon = mondayOf(ctx.today), m1 = ctx.today.slice(0, 8) + '01';
        if (p === 'today') from = to = ctx.today;
        else if (p === 'last_week') { from = addDays(mon, -7); to = addDays(mon, -1); }
        else if (p === 'this_month') { from = m1; to = ctx.today; }
        else if (p === 'last_month') { to = addDays(m1, -1); from = to.slice(0, 8) + '01'; }
        else { from = mon; to = ctx.today; }
      }
      if ((new Date(to) - new Date(from)) / 864e5 > 400) fail('Pick a period of a year or less.');
      const who = /^(everyone|anyone|all|team)$/i.test(String(a.person || '')) ? null : await findPerson(ctx, a.person);
      const c = a.client ? await findClient(ctx, a.client) : null;
      const rows = await timeBetween(ctx, from, to, { userId: who && who.id, clientId: c && c.id });
      const sum = (key) => { const m = {}; rows.forEach(e => { const k = key(e) || 'No client'; m[k] = (m[k] || 0) + e.minutes; }); return Object.fromEntries(Object.entries(m).sort((x, y) => y[1] - x[1]).map(([k, v]) => [k, hrs(v)])); };
      const out = { from, to, person: who ? who.name : 'everyone', client: c ? c.name : null, total_hours: hrs(rows.reduce((s, e) => s + e.minutes, 0)), entries: rows.length,
        by_client: sum(e => clientName(ctx, e.client_id)), by_person: sum(e => nameOf(ctx, e.user_id)) };
      if ((new Date(to) - new Date(from)) / 864e5 <= 31) out.by_day = sum(e => e.entry_date);
      return out;
    },
  },
  {
    name: 'meetings', title: 'Meeting notes', annotations: READ,
    description: 'The meeting notes Radar read from Granola, newest first: the meetings the signed-in person was in (admins and approvers: all). Filter by client, by words in the title or notes, or by days back; give an id for one meeting’s full notes.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      id: STR('A meeting id (from this list) for its full notes'),
      client: STR('Only meetings with or about this client (name)'),
      query: STR('Words that must be in the title or the notes'),
      days: { type: 'integer', minimum: 1, maximum: 90, description: 'Only the last N days (default 30)' },
      limit: { type: 'integer', minimum: 1, maximum: 25, description: 'How many (default 10)' },
    } },
    async run(ctx, a) {
      await Promise.all([team(ctx), clientsOf(ctx)]);
      const list = await meetingsOf(ctx);
      if (a.id) {
        const m = list.find(x => x.id === String(a.id).replace(/^meeting:/, ''));
        if (!m) fail('No meeting with that id that you can see (only the meetings you were in; admins and approvers see all).');
        return { meeting: meetingOut(ctx, m, true), open_in_radar: link(ctx.base, 'notes') };
      }
      const since = addDays(ctx.today, -(a.days || 30));
      const c = a.client ? await findClient(ctx, a.client, false) : null;
      const words = String(a.query || '').toLowerCase().split(/\s+/).filter(Boolean);
      const hits = list.filter(m => dayIn(ctx.tz, new Date(m.at)) >= since
        && (!c || String(m.metClientId || m.clientId || '') === String(c.id) || String(m.title || '').toLowerCase().includes(String(c.name).toLowerCase()))
        && words.every(w => `${m.title} ${m.summary}`.toLowerCase().includes(w)));
      const n = a.limit || 10;
      return { count: hits.length, meetings: hits.slice(0, n).map(m => ({ ...meetingOut(ctx, m, false), preview: String(m.summary || '').split('\n').filter(l => /^\s*[-*]\s+/.test(l)).slice(0, 4).map(l => l.replace(/^\s*[-*]\s+/, '').replace(/\*\*/g, '')) })),
        note: hits.length ? 'Give an id to read a meeting’s full notes.' : 'No meetings match. Only meetings Radar read from Granola, that you were in, show here.' };
    },
  },
  {
    name: 'search', title: 'Search Radar', annotations: READ,
    description: 'Finds clients, open tasks, follow-ups and meeting notes by words in their name, title, question or notes. Returns ids to use with fetch.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: STR('Words to look for') } },
    async run(ctx, a) {
      await team(ctx);
      const words = String(a.query || '').toLowerCase().split(/\s+/).filter(Boolean);
      if (!words.length) fail('What should I look for?');
      const has = s => { const t = String(s || '').toLowerCase(); return words.every(w => t.includes(w)); };
      const cs = await clientsOf(ctx), ts = await openTasks(ctx), rs = await waitingReminders(ctx), ms = await meetingsOf(ctx);
      const results = [
        ...cs.filter(c => has(c.name) || has(c.service)).map(c => ({ id: `client:${c.id}`, title: c.name, url: link(ctx.base, 'client', c.id) })),
        ...ts.filter(t => has(t.title) || has(t.description) || has(clientName(ctx, t.client_id))).map(t => ({ id: `task:${t.id}`, title: `Task: ${t.title}${t.client_id ? ` (${clientName(ctx, t.client_id)})` : ''}`, url: link(ctx.base, 'tasks') })),
        ...rs.filter(r => has(r.question) || has(clientName(ctx, r.client_id))).map(r => ({ id: `reminder:${r.id}`, title: `Follow-up: ${r.question}${r.client_id ? ` (${clientName(ctx, r.client_id)})` : ''}`, url: link(ctx.base, 'reminders') })),
        ...ms.filter(m => has(`${m.title} ${m.summary} ${clientName(ctx, m.metClientId || m.clientId) || ''}`)).slice(0, 10).map(m => ({ id: `meeting:${m.id}`, title: `Meeting: ${m.title} (${dayIn(ctx.tz, new Date(m.at))})`, url: link(ctx.base, 'notes') })),
      ].slice(0, 40);
      return { results };
    },
  },
  {
    name: 'fetch', title: 'Fetch from Radar', annotations: READ,
    description: 'The full record for an id from search: client:<id>, task:<id>, reminder:<id> or meeting:<id> (its notes).',
    inputSchema: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: STR('An id from search, like client:abc or task:123') } },
    async run(ctx, a) {
      const [kind, ...rest] = String(a.id || '').split(':'), id = rest.join(':');
      await Promise.all([team(ctx), clientsOf(ctx)]);
      if (kind === 'client') { const r = await byName('get_client').run(ctx, { client: id }); return { id: a.id, title: r.name, text: JSON.stringify(r, null, 1), url: r.open_in_radar, metadata: { kind } }; }
      if (kind === 'task') { const { data } = await ctx.db.from('tasks').select('*').eq('id', id).maybeSingle(); if (!data) fail('No task with that id (or you can’t see it).'); const t = taskOut(ctx, data); return { id: a.id, title: t.title, text: JSON.stringify(t, null, 1), url: link(ctx.base, 'tasks'), metadata: { kind } }; }
      if (kind === 'reminder') { const { data } = await ctx.db.from('client_reminders').select('*').eq('id', id).maybeSingle(); if (!data) fail('No follow-up with that id.'); const r = reminderOut(ctx, data); return { id: a.id, title: r.question, text: JSON.stringify(r, null, 1), url: link(ctx.base, 'reminders'), metadata: { kind } }; }
      if (kind === 'meeting') { const r = await byName('meetings').run(ctx, { id }); return { id: a.id, title: r.meeting.title, text: `${r.meeting.title} (${r.meeting.date}${r.meeting.client ? `, ${r.meeting.client}` : ''})\n\n${r.meeting.notes}`, url: r.open_in_radar, metadata: { kind } }; }
      fail('Ids look like client:<id>, task:<id>, reminder:<id> or meeting:<id>.');
    },
  },
  {
    name: 'create_task', title: 'Create a task', annotations: WRITE,
    description: 'Adds a task in Radar, given by the signed-in person, for them or a teammate (who gets notified). Give a short title that starts with a verb.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['title'], properties: {
      title: STR('What to do, starting with a verb, under 120 characters'),
      assignee: STR('Who does it: "me" (default) or a teammate’s name'),
      client: STR('The client it’s for (name), if any'),
      due_date: DATE('When it’s due'),
      priority: STR('low, medium (default) or high', { enum: ['low', 'medium', 'high'] }),
      link: STR('A link to the work (a doc, a page)'),
      notes: STR('Details, in plain text'),
      sprint: STR('One of your sprints in Plan to add it to as a step (its title or id). Without a due date, it gets the next free workday in the sprint.'),
    } },
    async run(ctx, a) {
      const title = String(a.title || '').trim(); if (!title) fail('A task needs a title.');
      await Promise.all([team(ctx), clientsOf(ctx)]);
      const who = await findPerson(ctx, a.assignee);
      const sp = a.sprint ? await findSprint(ctx, a.sprint) : null;
      const c = a.client ? await findClient(ctx, a.client) : null;
      if (a.due_date && !isDate(a.due_date)) fail('due_date should look like 2026-12-04.');
      let url = String(a.link || '').trim(); if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
      const due = a.due_date || (sp ? nextStepDate(ctx, sp, await sprintSteps(ctx, [sp.id])) : null);
      const row = { title: title.slice(0, 200), description: String(a.notes || '').trim() || null, priority: a.priority || 'medium', status: 'todo',
        assigner_id: ctx.me.id, assignee_id: who.id, due_date: due, client_id: c ? c.id : sp ? sp.client_id || null : null, link: url || null,
        ...(sp ? { sprint_id: sp.id, ...(sp.color ? { color: sp.color } : {}) } : {}) };
      const { data, error } = await ctx.db.from('tasks').insert(row).select().single();
      if (error) fail(`Not saved: ${error.message}`);
      if (who.id !== ctx.me.id) {
        const body = `${ctx.me.name}: "${row.title}"`;
        await ctx.admin.from('notifications').insert({ user_id: who.id, type: 'task_assigned', title: 'New task assigned to you', body, target_view: 'tasks', target_id: data.id }).then(() => {}, () => {});
        try { await sendPushToUser(ctx.admin, who.id, 'New task assigned to you', body, pushUrlFor('tasks', data.id)); } catch (e) {}
      }
      await ctx.admin.from('activity_log').insert({ client_id: c ? c.id : null, user_id: ctx.me.id, action_type: 'task_created', description: `${ctx.me.name} added “${row.title}” for ${who.name} (with an AI assistant).` }).then(() => {}, () => {});
      return { created: taskOut(ctx, data), ...(sp ? { in_sprint: sp.title } : {}), open_in_radar: link(ctx.base, sp ? 'plan' : 'tasks') };
    },
  },
  {
    name: 'update_task', title: 'Update a task', annotations: { ...WRITE, idempotentHint: true },
    description: 'Changes a task: its status (done finishes it, and a client’s task goes into that client’s history), due date, priority or title. Only whoever assigned a task can move its date; the person doing it can ask them instead.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['task'], properties: {
      task: STR('The task’s id, or words from its title'),
      status: STR('todo, in_progress, in_review or done', { enum: ['todo', 'in_progress', 'in_review', 'done'] }),
      due_date: DATE('New due date (empty string clears it)'),
      priority: STR('low, medium or high', { enum: ['low', 'medium', 'high'] }),
      title: STR('New title'),
      completion_note: STR('When finishing: a note on what was done'),
    } },
    async run(ctx, a) {
      await Promise.all([team(ctx), clientsOf(ctx)]);
      const t = await findTask(ctx, a.task);
      const mine = t.assignee_id === ctx.me.id, gave = t.assigner_id === ctx.me.id, boss = ['admin', 'approver'].includes(ctx.me.role);
      if (!mine && !gave && !boss) fail('Only the person doing this task, whoever assigned it, or an approver can change it.');
      const patch = {};
      if (a.title != null && String(a.title).trim()) patch.title = String(a.title).trim().slice(0, 200);
      if (a.priority) patch.priority = a.priority;
      if (a.due_date !== undefined) {
        if (a.due_date !== '' && !isDate(a.due_date)) fail('due_date should look like 2026-12-04.');
        if (!gave && !boss) fail(`Only ${nameOf(ctx, t.assigner_id) || 'the person who assigned it'} can move this task’s date. Ask them in Radar (the task has “Ask to Move the Date”).`);
        patch.due_date = a.due_date || null;
      }
      const finishing = a.status === 'done' && t.status !== 'done';
      if (a.status) patch.status = a.status;
      if (finishing) { patch.completed_at = new Date().toISOString(); patch.completion_notes = String(a.completion_note || '').trim() || null; patch.assigner_notified = false; }
      if (a.status && a.status !== 'done' && t.status === 'done') patch.completed_at = null;
      if (!Object.keys(patch).length) fail('Nothing to change: give a status, due_date, priority or title.');
      let { data, error } = await ctx.db.from('tasks').update(patch).eq('id', t.id).select().single();
      if (error && /assigner_notified|completion_notes/.test(error.message || '')) { const { assigner_notified, completion_notes, ...p2 } = patch; ({ data, error } = await ctx.db.from('tasks').update(p2).eq('id', t.id).select().single()); }
      if (error) fail(`Not saved: ${error.message}`);
      if (finishing) {
        // what the app does: a client's task goes into its history (not the email), its WhatsApp
        // item is done too, and whoever assigned it hears about it
        if (t.client_id) await ctx.db.from('client_improvements').insert({ client_id: t.client_id, author: ctx.me.name, text: t.description ? `${t.title} — ${t.description}` : t.title, include_in_email: false, source: 'task' }).then(() => {}, () => {});
        await ctx.db.from('wa_tasks').update({ status: 'done', updated_at: new Date().toISOString() }).eq('task_id', t.id).eq('status', 'open').then(() => {}, () => {});
        if (t.assigner_id && t.assigner_id !== ctx.me.id) {
          const body = `${ctx.me.name} marked "${t.title}" as done.${patch.completion_notes ? ` Note: "${patch.completion_notes.slice(0, 100)}"` : ''}`;
          await ctx.admin.from('notifications').insert({ user_id: t.assigner_id, type: 'task_completed', title: 'Task completed', body, target_view: 'tasks', target_id: t.id }).then(() => {}, () => {});
          try { await sendPushToUser(ctx.admin, t.assigner_id, 'Task completed', body, pushUrlFor('tasks', t.id)); } catch (e) {}
        }
      }
      return { updated: taskOut(ctx, data), changed: Object.keys(patch).filter(k => !['assigner_notified', 'completed_at'].includes(k)) };
    },
  },
  {
    name: 'list_sprints', title: 'Your sprints in Plan', annotations: READ,
    description: 'The signed-in person’s sprints in Radar’s Plan (private to them): dates, client, hours, goal, how far along, and each step (a task) with its date. Done sprints only when asked.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      client: STR('Only this client’s sprints (name)'),
      include_done: { type: 'boolean', description: 'Also sprints marked done' },
    } },
    async run(ctx, a) {
      await Promise.all([team(ctx), clientsOf(ctx)]);
      const c = a.client ? await findClient(ctx, a.client) : null;
      const list = (await mySprints(ctx)).filter(s => (a.include_done || !s.done_at) && (!c || String(s.client_id) === String(c.id)));
      const steps = await sprintSteps(ctx, list.map(s => s.id));
      return { today: ctx.today, sprints: list.map(s => sprintOut(ctx, s, steps)), open_in_radar: link(ctx.base, 'plan') };
    },
  },
  {
    name: 'create_sprint', title: 'Plan a sprint', annotations: WRITE,
    description: 'Sets up a sprint in the signed-in person’s Plan in Radar: a few days of focused work, usually for one client, with dates, the hours they’ll spend, a goal and steps. '
      + 'Each step becomes a task for them, dated across the sprint unless given a date, so it shows in Tasks, Today and the calendar. '
      + 'Defaults, as in the app: starts today (tomorrow after 3 pm), runs two weeks (10 workdays; weekends and US holidays skipped), 10 hours, reminders when it starts, halfway and the day before it ends, and a calendar entry. '
      + 'Given one of their tasks, the sprint is planned around it: the task is the last step and the sprint ends when it’s due.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['title'], properties: {
      title: STR('The sprint’s name, like “Nico Pro Meta relaunch”'),
      client: STR('The client it’s for (name), if any'),
      start_date: DATE('First day (default today, or the next workday)'),
      end_date: DATE('Last day (default two weeks of workdays)'),
      hours: { type: 'number', minimum: 0, maximum: 200, description: 'Hours they’ll put in over the sprint (default 10)' },
      goal: STR('What’s done when the sprint is done, one sentence'),
      steps: { type: 'array', maxItems: 10, description: 'The steps in order, each starting with a verb: 3 to 6 is right for most sprints (each one a real piece of work, not a checklist item; fold small ones together). They show in Tasks as one row for the sprint. A step can have its own due_date inside the sprint.',
        items: { type: 'object', additionalProperties: false, required: ['title'], properties: { title: STR('The step'), due_date: DATE('When it’s due (optional)') } } },
      task: STR('One of their own tasks to plan the sprint around (id or words from its title): it becomes the last step'),
      reminders: { type: 'boolean', description: 'Remind them when it starts, halfway and the day before it ends (default true)' },
      add_to_calendar: { type: 'boolean', description: 'Put the sprint on their Radar calendar (default true)' },
    } },
    async run(ctx, a) {
      const title = String(a.title || '').trim(); if (!title) fail('A sprint needs a title.');
      await Promise.all([team(ctx), clientsOf(ctx)]);
      await mySprints(ctx);   // says so if Plan isn't on yet
      const c = a.client ? await findClient(ctx, a.client) : null;
      let task = null;
      if (a.task) { task = await findTask(ctx, a.task); if (task.assignee_id !== ctx.me.id) fail(`“${task.title}” is ${nameOf(ctx, task.assignee_id) || 'someone else'}’s: a sprint is planned around one of your own tasks.`); }
      const start = a.start_date || sprintStart(ctx);
      if (!isDate(start)) fail('start_date should look like 2026-12-01.');
      if (start < ctx.today) fail(`A sprint can’t start in the past (today is ${ctx.today}).`);
      let end = a.end_date;
      if (!end) {
        end = addWorkdays(start, 9);
        if (task) { let due = task.due_date && task.due_date > start ? (task.due_date < end ? task.due_date : end) : addWorkdays(start, 4); while (due > start && !isWorkday(due)) due = addDays(due, -1); end = due; }
      }
      if (!isDate(end)) fail('end_date should look like 2026-12-12.');
      if (end < start) fail('The sprint has to end on or after the day it starts.');
      if (end > addDays(ctx.today, 183)) fail('That ends more than six months out. Plan a shorter sprint.');
      const days = workdays(start, end);
      if (!days.length) fail('Those dates are all weekend or holidays.');
      const hours = a.hours == null ? 10 : Number(a.hours);
      if (!(hours >= 0 && hours <= 200)) fail('hours should be between 0 and 200.');
      const steps = stepsIn(a.steps, start, end);
      const reminders = a.reminders === false ? [] : presetReminders(start, end, ctx.tz).map(r => ({ ...r, sent: new Date(r.at) <= new Date() }));
      const row = { user_id: ctx.me.id, title: title.slice(0, 200), client_id: c ? c.id : (task && task.client_id) || null, start_date: start, end_date: end, hours, goal: String(a.goal || '').trim().slice(0, 2000) || null, reminders, updated_at: new Date().toISOString() };
      const { data: sp, error } = await ctx.db.from('plan_sprints').insert(row).select().single();
      if (error || !sp) fail(planOff(error) ? PLAN_OFF : `Sprint not created: ${error ? error.message : 'try again in a moment'}`);
      ctx.cache.sprints = null; ctx.cache.tasks = null;   // read fresh after this
      const problems = [];
      // around a task: it joins as the last step, and the new steps finish the day before
      if (task) { const { error: e } = await ctx.db.from('tasks').update({ sprint_id: sp.id }).eq('id', task.id); if (e) problems.push(`“${task.title}” wasn’t added to the sprint: ${e.message}`); }
      const span = task && days.length > 1 ? days.slice(0, -1) : days;
      const rows = steps.map((x, i) => stepRow(ctx, sp, x.title, x.due_date || span[Math.max(0, Math.round((i + 1) * span.length / steps.length) - 1)] || end));
      if (rows.length) { const { error: e } = await ctx.db.from('tasks').insert(rows); if (e) problems.push(`The steps weren’t added: ${e.message}`); }
      let calendar = false;
      if (a.add_to_calendar !== false) {
        const { error: e } = await ctx.db.from('calendar_events').insert({ title: `Sprint: ${row.title}`, description: row.goal, start_at: `${start}T00:00:00`, end_at: `${end}T23:59:59`, all_day: true,
          client_id: row.client_id, created_by: ctx.me.id, event_type: 'reminder', attendee_ids: [ctx.me.id] });
        if (e) problems.push(`It isn’t on the calendar: ${e.message}`); else calendar = true;
      }
      const all = await sprintSteps(ctx, [sp.id]), warn = await budgetWarning(ctx, sp);
      return { created: sprintOut(ctx, sp, all), on_calendar: calendar, ...(warn ? { budget_warning: warn } : {}), ...(problems.length ? { problems } : {}), open_in_radar: link(ctx.base, 'plan') };
    },
  },
  {
    name: 'update_sprint', title: 'Change a sprint', annotations: WRITE,
    description: 'Changes one of the signed-in person’s sprints in Plan: its title, dates, hours or goal, adds steps (dated to the next free workdays unless given a date), or marks it done (or not done). '
      + 'New dates move its reminders with them; its steps keep their dates (move those with update_task). Deleting a sprint is done in the app.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['sprint'], properties: {
      sprint: STR('The sprint: words from its title, or its id'),
      title: STR('New title'),
      start_date: DATE('New first day'),
      end_date: DATE('New last day'),
      hours: { type: 'number', minimum: 0, maximum: 200, description: 'New hours' },
      goal: STR('New goal (empty string clears it)'),
      add_steps: { type: 'array', maxItems: 10, description: 'Steps to add, in order (a sprint reads best with 3 to 6 in all)',
        items: { type: 'object', additionalProperties: false, required: ['title'], properties: { title: STR('The step'), due_date: DATE('When it’s due (optional)') } } },
      done: { type: 'boolean', description: 'true marks the sprint done; false opens it again' },
    } },
    async run(ctx, a) {
      await Promise.all([team(ctx), clientsOf(ctx)]);
      const s = await findSprint(ctx, a.sprint);
      const patch = {};
      if (a.title != null && String(a.title).trim()) patch.title = String(a.title).trim().slice(0, 200);
      if (a.hours != null) { const h = Number(a.hours); if (!(h >= 0 && h <= 200)) fail('hours should be between 0 and 200.'); patch.hours = h; }
      if (a.goal !== undefined) patch.goal = String(a.goal || '').trim().slice(0, 2000) || null;
      const start = a.start_date || s.start_date, end = a.end_date || s.end_date;
      if (a.start_date || a.end_date) {
        if (!isDate(start) || !isDate(end)) fail('Dates should look like 2026-12-01.');
        if (end < start) fail('The sprint has to end on or after the day it starts.');
        if (!workdays(start, end).length) fail('Those dates are all weekend or holidays.');
        patch.start_date = start; patch.end_date = end;
        // the preset reminders it has move with the dates; one already sent for the same moment stays sent
        const was = Array.isArray(s.reminders) ? s.reminders : [], kinds = new Set(was.filter(r => r.kind && r.kind !== 'custom').map(r => r.kind));
        const presets = presetReminders(start, end, ctx.tz).filter(r => kinds.has(r.kind)).map(r => { const o = was.find(x => x.kind === r.kind); return o && o.sent && o.at === r.at ? o : { ...r, sent: new Date(r.at) <= new Date() }; });
        patch.reminders = [...presets, ...was.filter(r => !r.kind || r.kind === 'custom')];
      }
      if (a.done === true && !s.done_at) patch.done_at = new Date().toISOString();
      if (a.done === false && s.done_at) patch.done_at = null;
      const add = stepsIn(a.add_steps, start, end);
      if (!Object.keys(patch).length && !add.length) fail('Nothing to change: give a title, dates, hours, goal, steps to add, or done.');
      let sp = s;
      if (Object.keys(patch).length) {
        const { data, error } = await ctx.db.from('plan_sprints').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', s.id).eq('user_id', ctx.me.id).select().single();
        if (error || !data) fail(`Not saved: ${error ? error.message : 'try again in a moment'}`);
        sp = data; ctx.cache.sprints = null;
      }
      let steps = await sprintSteps(ctx, [sp.id]);
      if (add.length) {
        const rows = [];
        add.forEach(x => { const due = x.due_date || nextStepDate(ctx, sp, steps.concat(rows)); rows.push(stepRow(ctx, sp, x.title, due)); });
        const { error } = await ctx.db.from('tasks').insert(rows);
        if (error) fail(`The steps weren’t added: ${error.message}`);
        ctx.cache.tasks = null;
        steps = await sprintSteps(ctx, [sp.id]);
      }
      const outside = steps.filter(t => t.status !== 'done' && t.due_date && (t.due_date < sp.start_date || t.due_date > sp.end_date));
      const warn = await budgetWarning(ctx, sp);
      return { updated: sprintOut(ctx, sp, steps), changed: [...Object.keys(patch).filter(k => k !== 'reminders'), ...(add.length ? [`${add.length} step${add.length === 1 ? '' : 's'} added`] : [])],
        ...(outside.length ? { steps_outside_the_dates: outside.map(t => `${t.title} (${t.due_date})`) } : {}), ...(warn ? { budget_warning: warn } : {}), open_in_radar: link(ctx.base, 'plan') };
    },
  },
  {
    name: 'add_reminder', title: 'Add a follow-up', annotations: WRITE,
    description: 'Adds a follow-up in Radar’s Reminders: something the signed-in person asked a client (or a teammate) for, and the day to chase it if there’s no answer (3 working days from today for a client, the next working day for a teammate, unless given). Give a client, a teammate, or both (a teammate, and the client it’s for).',
    inputSchema: { type: 'object', additionalProperties: false, required: ['question'], properties: {
      client: STR('The client (name); optional when it’s a teammate'), teammate: STR('A teammate it’s waiting on instead (name), when it isn’t a client'), question: STR('What was asked, as a question'), follow_up_date: DATE('When to chase it'),
    } },
    async run(ctx, a) {
      const mate = a.teammate ? await findPerson(ctx, a.teammate, null) : null;
      if (a.teammate && !mate) fail(`No one on the team called “${a.teammate}”.`);
      if (mate && mate.id === ctx.me.id) fail('That’s you: pick the teammate you’re waiting on.');
      if (!mate && !a.client) fail('Which client is it, or which teammate?');
      const c = a.client ? await findClient(ctx, a.client, true) : null, q = String(a.question || '').trim();
      if (!q) fail('What was the question?');
      let d = a.follow_up_date;
      if (d && !isDate(d)) fail('follow_up_date should look like 2026-12-04.');
      if (!d) { d = ctx.today; let n = 0; while (n < (mate ? 1 : 3)) { d = addDays(d, 1); const w = new Date(d + 'T12:00:00Z').getUTCDay(); if (w !== 0 && w !== 6) n++; } }
      const row = { client_id: c ? c.id : null, question: q.slice(0, 500), asked_by: ctx.me.id, follow_up_date: d, status: 'waiting' };
      if (mate) row.waiting_on = mate.id;
      const { data, error } = await ctx.db.from('client_reminders').insert(row).select().single();
      if (error) fail(`Not saved: ${error.message}`);
      await team(ctx);
      return { created: reminderOut(ctx, data), open_in_radar: link(ctx.base, 'reminders') };
    },
  },
  {
    name: 'log_time', title: 'Log time', annotations: WRITE,
    description: 'Logs the signed-in person’s time on a client, for today unless a date is given. For a client in Harvest it goes to Harvest too, on the client’s project and task: give project and task by name when the client has more than one (the answer lists them if needed). With log_as_work, the description is also logged as work for the client (an improvement), so it shows in Queue for the client update.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['client', 'description'], properties: {
      client: STR('The client (name)'),
      hours: { type: 'number', minimum: 0.05, maximum: 16, description: 'Hours, like 1.5' },
      minutes: { type: 'integer', minimum: 1, maximum: 960, description: 'Or minutes, like 45' },
      date: DATE('The day it was done (default today; not in the future)'),
      description: STR('What was done'),
      project: STR('Harvest project name, when the client has more than one'),
      task: STR('Harvest task name, when the project has more than one'),
      log_as_work: { type: 'boolean', description: 'Also log it as work (an improvement) for the client, so it shows in Queue for the client update. Only when the person asks for it.' },
    } },
    async run(ctx, a) {
      const c = await findClient(ctx, a.client, true);
      const minutes = a.minutes ? Math.round(a.minutes) : a.hours ? Math.round(Number(a.hours) * 60) : 0;
      if (!(minutes > 0 && minutes <= 960)) fail('How long? Give hours (like 1.5) or minutes (like 45), up to 16 hours.');
      const date = a.date || ctx.today;
      if (!isDate(date)) fail('date should look like 2026-12-04.');
      if (date > ctx.today) fail('Time can’t be logged for a day that hasn’t happened yet.');
      const desc = String(a.description || '').trim(); if (!desc) fail('What was done?');
      const pick = await harvestPick(ctx, c, a);
      const row = { user_id: ctx.me.id, client_id: c.id, entry_date: date, minutes, description: desc.slice(0, 1000), service: pick.service || (String(c.service || '').split(' · ')[0] || null),
        ...(pick.projectId ? { harvest_project_id: pick.projectId, harvest_task_id: pick.taskId || null } : {}) };
      // as work (Nov 23): the improvement first, then the time as its own entry, linked to it (as the app does)
      let work = null;
      if (a.log_as_work) {
        const when = date === ctx.today ? new Date().toISOString() : `${date}T12:00:00.000Z`;
        const imp = { client_id: c.id, author: ctx.me.name || 'Team member', text: desc.slice(0, 2000), include_in_email: true, source: 'time', date: when };
        let r = row.service ? await ctx.db.from('client_improvements').insert({ ...imp, service: row.service }).select().single() : null;
        if (!r || (r.error && /column|schema cache/i.test(r.error.message || ''))) r = await ctx.db.from('client_improvements').insert(imp).select().single();
        if (r.error || !r.data) fail(`Not saved: ${r.error ? r.error.message : 'the work wasn’t logged'}`);
        work = r.data;
        row.logged = true; row.improvement_id = work.id;
      }
      let { data, error } = await ctx.db.from('time_entries').insert(row).select().single();
      if (error && work && /improvement_id/.test(error.message || '')) { delete row.improvement_id; ({ data, error } = await ctx.db.from('time_entries').insert(row).select().single()); }
      if (error) fail(`Not saved: ${error.message}`);
      let harvest = 'not connected';
      try {
        const { data: conn } = await ctx.admin.from('harvest_connection').select('*').eq('id', 1).maybeSingle();
        if (conn) {
          const r = await syncTimeEntryToHarvest(ctx.admin, conn, data);
          await ctx.admin.from('time_entries').update({ harvest_sync_status: r.status, harvest_entry_id: r.harvestEntryId || null, harvest_sync_error: r.error || null }).eq('id', data.id);
          harvest = r.status === 'synced' ? 'sent to Harvest' : r.error || r.status;
        }
      } catch (e) { harvest = 'Radar will send it to Harvest tonight'; }
      return { logged: { client: c.name, date, hours: hrs(minutes), description: row.description, project: pick.projectName || null, task: pick.taskName || null }, harvest,
        ...(work ? { work: 'Also logged as work: it’s in Queue for the client update.' } : {}), open_in_radar: link(ctx.base, work ? 'queue' : 'time') };
    },
  },
];
function byName(n) { return TOOLS.find(t => t.name === n); }

async function findTask(ctx, q) {
  const s = String(q || '').trim(); if (!s) fail('Which task?');
  const open = await openTasks(ctx);
  const byId = open.find(t => String(t.id) === s);
  if (byId) return byId;
  if (!/\s/.test(s)) { const { data: one } = await ctx.db.from('tasks').select('*').eq('id', s).maybeSingle(); if (one && !one.deleted_at) return one; }
  const words = s.toLowerCase().split(/\s+/);
  const hits = open.filter(t => words.every(w => String(t.title).toLowerCase().includes(w)));
  const pref = hits.filter(t => t.assignee_id === ctx.me.id || t.assigner_id === ctx.me.id);
  const pool = pref.length ? pref : hits;
  if (pool.length === 1) return pool[0];
  if (pool.length > 1) fail(`More than one open task matches: ${pool.slice(0, 8).map(t => `“${t.title}” (${nameOf(ctx, t.assignee_id) || '?'}, id ${t.id})`).join('; ')}. Which one?`);
  fail(`No open task matches “${s}”.`);
}

// Harvest's Client → Project → Task, the way the app picks it: the client's active projects the
// person is assigned to; one project (and one task, or the one they used last) goes without asking.
async function harvestPick(ctx, c, a) {
  const q = (t, cols) => ctx.db.from(t).select(cols);
  const [hc, me] = await Promise.all([q('harvest_clients', 'harvest_id, radar_client_id').eq('radar_client_id', String(c.id)), q('harvest_users', 'harvest_id, team_profile_id').eq('team_profile_id', ctx.me.id)]);
  if (hc.error || !hc.data || !hc.data.length) return {};   // not in Harvest (or no Harvest tables)
  const ids = hc.data.map(x => Number(x.harvest_id));
  const { data: projects } = await q('harvest_projects', 'harvest_id, client_harvest_id, name, is_active').in('client_harvest_id', ids);
  let ps = (projects || []).filter(p => p.is_active).sort((x, y) => x.name.localeCompare(y.name));
  const meH = me.data && me.data[0] ? Number(me.data[0].harvest_id) : null;
  if (meH != null && ps.length) {
    const { data: ua } = await q('harvest_user_assignments', 'project_harvest_id, user_harvest_id, is_active').eq('user_harvest_id', meH).in('project_harvest_id', ps.map(p => p.harvest_id));
    const mine = ps.filter(p => (ua || []).some(x => x.is_active && Number(x.project_harvest_id) === Number(p.harvest_id)));
    if (mine.length) ps = mine;
  }
  if (!ps.length) fail(`${c.name} has no active Harvest project ${meH != null ? 'you’re on' : ''}. Ask an admin to add you to it in Harvest.`);
  let p = ps.length === 1 ? ps[0] : null;
  if (a.project) { const low = String(a.project).toLowerCase(); p = ps.find(x => x.name.toLowerCase() === low) || ps.find(x => x.name.toLowerCase().includes(low)) || null; if (!p) fail(`No project “${a.project}” for ${c.name}. Its projects: ${ps.map(x => x.name).join('; ')}.`); }
  if (!p) fail(`${c.name} has more than one Harvest project. Which one: ${ps.map(x => x.name).join('; ')}?`);
  const { data: ta } = await q('harvest_task_assignments', 'project_harvest_id, task_harvest_id, is_active').eq('project_harvest_id', p.harvest_id);
  const taskIds = (ta || []).filter(x => x.is_active).map(x => Number(x.task_harvest_id));
  const { data: tasks } = taskIds.length ? await q('harvest_tasks', 'harvest_id, name, is_active').in('harvest_id', taskIds) : { data: [] };
  const ts = (tasks || []).filter(t => t.is_active).sort((x, y) => x.name.localeCompare(y.name));
  let t = ts.length === 1 ? ts[0] : null;
  if (a.task) { const low = String(a.task).toLowerCase(); t = ts.find(x => x.name.toLowerCase() === low) || ts.find(x => x.name.toLowerCase().includes(low)) || null; if (!t) fail(`No task “${a.task}” on ${p.name}. Its tasks: ${ts.map(x => x.name).join('; ')}.`); }
  if (!t && ts.length > 1) {
    const { data: last } = await ctx.db.from('time_entries').select('harvest_task_id').eq('user_id', ctx.me.id).eq('harvest_project_id', p.harvest_id).not('harvest_task_id', 'is', null).order('entry_date', { ascending: false }).limit(1);
    t = last && last[0] ? ts.find(x => Number(x.harvest_id) === Number(last[0].harvest_task_id)) || null : null;
    if (!t) fail(`Which task on ${p.name}: ${ts.map(x => x.name).join('; ')}?`);
  }
  return { projectId: Number(p.harvest_id), projectName: p.name, taskId: t ? Number(t.harvest_id) : null, taskName: t ? t.name : null, service: p.name };
}

// ---- JSON-RPC over HTTP --------------------------------------------------------------------------
const toolList = () => TOOLS.map(t => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: { title: t.title, ...t.annotations } }));

async function rpc(ctx, msg) {
  const { id, method, params } = msg || {};
  const ok = result => ({ jsonrpc: '2.0', id, result });
  const err = (code, message) => ({ jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } });
  if (!msg || msg.jsonrpc !== '2.0' || typeof method !== 'string') return err(-32600, 'Invalid request');
  if (id === undefined) return null;   // a notification: nothing to answer
  if (method === 'initialize') {
    const want = params && params.protocolVersion;
    return ok({ protocolVersion: PROTOCOLS.includes(want) ? want : '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
  }
  if (method === 'ping') return ok({});
  if (method === 'tools/list') return ok({ tools: toolList() });
  if (method === 'resources/list') return ok({ resources: [] });
  if (method === 'resources/templates/list') return ok({ resourceTemplates: [] });
  if (method === 'prompts/list') return ok({ prompts: [] });
  if (method === 'tools/call') {
    const tool = byName(params && params.name);
    if (!tool) return err(-32602, `Unknown tool: ${params && params.name}`);
    const args = (params && params.arguments) || {};
    try {
      const out = await tool.run(ctx, args);
      return ok({ content: [{ type: 'text', text: JSON.stringify(out, null, 1) }], structuredContent: out, isError: false });
    } catch (e) {
      const text = e instanceof ToolError ? e.message : `Something went wrong: ${e && e.message || e}`;
      return ok({ content: [{ type: 'text', text }], isError: true });
    }
  }
  return err(-32601, `Method not found: ${method}`);
}

async function handleMcp(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  const base = appUrl(req);
  const challenge = (extra) => res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"${extra ? ', ' + extra : ''}`);
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) { challenge(); res.status(401).json({ error: 'Sign in to Radar to use this.' }); return; }
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST, OPTIONS'); res.status(405).json({ error: 'Send MCP messages with POST.' }); return; }
  let ctx;
  try {
    const r = await makeContext(token, req);
    if (r.status === 401) { challenge('error="invalid_token"'); res.status(401).json({ error: 'That sign-in has expired. Connect Radar again.' }); return; }
    if (r.status === 403) { res.status(403).json({ error: 'This Radar account doesn’t have access any more.' }); return; }
    ctx = r.ctx;
  } catch (e) { res.status(500).json({ error: String(e && e.message || e) }); return; }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; } }
  const batch = Array.isArray(body), msgs = batch ? body : [body];
  const out = [];
  for (const m of msgs) { const r = await rpc(ctx, m); if (r) out.push(r); }
  if (!out.length) { res.status(202).end(); return; }
  res.setHeader('Content-Type', 'application/json');
  res.status(200).send(JSON.stringify(batch ? out : out[0]));
}

module.exports = { handleMcp, protectedResourceMetadata, rpc, TOOLS, toolList, ToolError, dayIn, addDays, mondayOf, workdays, atTz, presetReminders };
