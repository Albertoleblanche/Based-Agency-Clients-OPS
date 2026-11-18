// The three "Help the team keep up" switches in Settings → Updates, run by the daily cron
// (api/cron-wednesday-notify.js). Every client gets one update a week, on no fixed day: it's due
// 7 days after its last one, and an approver checks it and sends it the day it's ready. Nothing
// here ever emails a client.
//
//   autoDraft      Each morning, writes a draft for every client due within a day that has work
//                  logged for the email and no draft yet, for its owner to check and send for review.
//   remindBehind   The morning after a client's update was due, reminds whoever holds it (the
//                  owner, the draft's writer, or the approvers): in the app, by push and on Slack.
//                  One reminder per client per step for each due date.
//   mondaySummary  On Mondays, tells approvers how last week's updates went and which clients'
//                  health needs a look.
//
// "Today" is worked out in the team's time zone (settings.timezone, saved from the browser).

const { callOpenAI, OPENAI_MODEL } = require('./ai-client');
const { sendPushToUser, pushUrlFor } = require('./push-notify');
const { sendSlackDM } = require('./slack-notify');
const inHarvestSetup = c => !!(c && c.custom_field_values && c.custom_field_values.harvestSetup === 'needed');

const UPDATE_EVERY_DAYS = 7;
const DEFAULT_AUTOMATION = { autoDraft: true, remindBehind: true, mondaySummary: true };
const DEFAULT_SIGNALS = { noUpdateDays: [8, 14], lateOfLast4: [2, 3], hoursPacePct: [110, 150], underUsedPct: 50, nothingLoggedDays: [7, 14], overdueTasks: [2, 4], ownerFlag: [3, 4], importantBump: true, quietDays: 7 };
const STEP_SHORT = ['nothing logged', 'draft not sent for review', 'waiting for approval', 'approved, not sent'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY = 86400000;

// ---- time, in the team's wall clock ------------------------------------------------------------
// Everything below works on "wall" dates: Date objects whose UTC fields read as the team's local
// date and time, so days compare the way they do in the app.
function wallOffset(tz) {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    const g = t => +p.find(x => x.type === t).value;
    const now = new Date();
    return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(now.getTime() / 1000) * 1000;
  } catch (e) { return 0; }
}
const toWall = (d, off) => new Date(new Date(d).getTime() + off);
const dayStartW = d => { const x = new Date(d); x.setUTCHours(0, 0, 0, 0); return x; };
const addDaysW = (d, n) => new Date(new Date(d).getTime() + n * DAY);
const daysBetweenW = (a, b) => Math.floor((dayStartW(b) - dayStartW(a)) / DAY);
const fmtDateW = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

// ---- the same reading of a client's week as the app's clientWeek() -------------------------------
function clientOwner(c, imps, drafts, nowW, off) {
  if (c.custom_field_values && c.custom_field_values.owner) return c.custom_field_values.owner;
  const since = addDaysW(nowW, -60), tally = {};
  imps.forEach(i => { if (i.author && toWall(i.date, off) >= since) tally[i.author] = (tally[i.author] || 0) + 1; });
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  if (top) return top[0];
  const d = drafts.slice().sort((a, b) => new Date(b.draft_pending_since || 0) - new Date(a.draft_pending_since || 0))[0];
  return d ? d.author : '';
}
function sentTimes(c, drafts, history, off) {
  const out = (history[c.id] || []).map(x => toWall(x, off));
  drafts.forEach(d => { if (d.draft_sent_at) { const t = toWall(d.draft_sent_at, off); if (!out.some(x => Math.abs(x - t) < 60000)) out.push(t); } });
  return out.sort((a, b) => a - b);
}
function clientWeek(c, imps, drafts, history, nowW, off) {
  const owner = clientOwner(c, imps, drafts, nowW, off);
  const sends = sentTimes(c, drafts, history, off), last = sends[sends.length - 1] || null;
  // Never had one: due a week after the client started (today, if the start date isn't known).
  const start = c.start_date ? new Date(c.start_date + 'T00:00:00Z') : null;
  const due = last ? addDaysW(dayStartW(last), UPDATE_EVERY_DAYS) : (start && start < nowW ? addDaysW(start, UPDATE_EVERY_DAYS) : dayStartW(nowW));
  const daysLeft = daysBetweenW(nowW, due);
  const since = last || addDaysW(nowW, -UPDATE_EVERY_DAYS);
  const logged = imps.filter(i => toWall(i.date, off) > since);
  const approved = drafts.find(d => d.draft_status === 'approved' && !d.draft_sent_at);
  const inReview = drafts.find(d => d.draft_status === 'pending' && d.ready_to_notify);
  const written = drafts.find(d => d.draft_status === 'pending');
  const w = { c, owner, logged, last, due, daysLeft, key: due.toISOString().slice(0, 10), sends, done: 0, behind: null, sent: false, holder: owner, draft: null, openDraft: approved || written || null };
  if (last && daysLeft > 0) return Object.assign(w, { done: 4, sent: true });
  if (approved) Object.assign(w, { done: 3, draft: approved, holder: 'approvers' });
  else if (inReview) Object.assign(w, { done: 2, draft: inReview, holder: 'approvers' });
  else if (written) Object.assign(w, { done: 1, draft: written, holder: written.author });
  else if (logged.length) w.done = 1;
  w.behind = w.done;
  return w;
}

// ---- delivery ----------------------------------------------------------------------------------
function muted(profile, type, channel) {
  const m = (profile && profile.muted_notification_types) || [];
  return m.includes(type) || m.includes(channel + ':' + type);
}
async function notify(admin, profile, type, title, body, view, targetId) {
  if (!profile || muted(profile, type, 'app') && muted(profile, type, 'push') && muted(profile, type, 'slack')) return;
  if (!muted(profile, type, 'app')) await admin.from('notifications').insert({ user_id: profile.id, type, title, body, target_view: view, target_id: targetId || null });
  if (!muted(profile, type, 'push')) { try { await sendPushToUser(admin, profile.id, title, body, pushUrlFor(view, targetId)); } catch (e) {} }
  try { await sendSlackDM(admin, profile.id, type, `*${title}*\n${body}`); } catch (e) {}
}
async function sendEmail(to, subject, text, html) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'Missing RESEND_API_KEY' };
  const from = process.env.EMAIL_FROM || 'Based Agency <onboarding@resend.dev>';
  const recipients = String(to).split(',').map(s => s.trim()).filter(Boolean);
  if (!recipients.length) return { ok: false, error: 'No address' };
  try {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ from, to: recipients, subject, text, ...(html ? { html } : {}) }) });
    const data = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, id: data.id } : { ok: false, error: data.message || `Resend ${r.status}` };
  } catch (e) { return { ok: false, error: String(e) }; }
}
async function getJson(admin, key, fallback) {
  const { data } = await admin.from('app_storage').select('value').eq('key', key).maybeSingle();
  if (!data || data.value == null) return fallback;
  try { return typeof data.value === 'string' ? JSON.parse(data.value) : data.value; } catch (e) { return fallback; }
}
const putJson = (admin, key, value) => admin.from('app_storage').upsert({ key, value: JSON.stringify(value) }, { onConflict: 'key' });

// ---- the draft prompt (same rules as the app's buildUpdatePrompt) ------------------------------
function buildUpdatePrompt(c, items, appName, structure) {
  const bullets = items.map(i => '- ' + i.text).join('\n');
  // A client set to get its weekly win in its WhatsApp group: a short group message, not an email.
  const whatsapp = c.custom_field_values && c.custom_field_values.winChannel === 'whatsapp';
  const rules = `Content rules that apply no matter what — never overridden by anything above:
- Describe every improvement as a specific, measurable deliverable — a concrete action taken, a number, a metric, or a defined output. Never state it as a vague, broad claim (e.g. never say "improved performance," "made things better," "optimized the account" with nothing concrete attached).
- If a logged improvement itself is vague or lacks a concrete detail, do not invent specifics to make it sound more impressive — describe only what was actually logged, worded as precisely as the source allows, and keep it modest rather than embellished.
- Never say anything that could make the agency look bad: no admitting mistakes, no exposing internal problems, no hedging language that implies something isn't working, no comparisons that read as excuses. State what was done factually and confidently without overstating results.
- No subject line, no meta-commentary about the email itself — output only the email body.`;
  if (whatsapp) return `Write this week's "win" message for a home-services/construction client's WhatsApp group, from their marketing agency (${appName}). Someone at the agency pastes it into the group.
Client: ${c.name}
Services: ${c.service ? `${c.service} (our internal names, for context only: describe the work in plain words and never name these to the client)` : 'n/a'}
Scope notes: ${c.sow || 'n/a'}
Improvements made this week:
${bullets}

Structure:
- Open with a one-line greeting to the ${c.name} team.
- Lead with the single best win, in this order of preference: a result for them (a lead, a call, a booked job, a ranking or review gain), then something we changed for them, then the work done. Put it on its own line in WhatsApp bold (*like this*), then one or two plain sentences about it.
- Then "*Also this week*" and at most three short lines starting with "• ".
- 50 to 120 words. Warm and plain, at most one emoji. No sign-off, no signature, no subject line, no markdown other than *bold*.

${rules.replace(/email body/g, 'message').replace(/client emails?/g, 'client messages')}`;
  return structure
    ? `Write a weekly client update email for a home-services/construction client from their marketing agency (${appName}).

The agency has specified an exact structure below. Follow it precisely and completely — every element it describes (greeting, paragraph order, sign-off, length, tone) — and do NOT fall back to any generic or default email structure, even partially:

--- REQUIRED STRUCTURE ---
${structure}
--- END REQUIRED STRUCTURE ---

Client: ${c.name}
Services: ${c.service ? `${c.service} (our internal names, for context only: describe the work in plain words and never name these to the client)` : 'n/a'}
Scope notes: ${c.sow || 'n/a'}
Improvements made this week:
${bullets}

${rules}`
    : `Write a short, warm, professional weekly update email to a home-services/construction client from their marketing agency (${appName}).
Client: ${c.name}
Services: ${c.service ? `${c.service} (our internal names, for context only: describe the work in plain words and never name these to the client)` : 'n/a'}
Scope notes: ${c.sow || 'n/a'}
Improvements made this week:
${bullets}

Structure: 2-4 short paragraphs max, no fluff or filler compliments, plain language, no subject line, no signature block, sound like a competent account manager not a sales email. End by noting nothing is needed from them unless something explicitly requires their input.

${rules}`;
}
function plainDraft(c, items) {
  return `Hi,\n\nHere’s what we worked on for ${c.name} this week:\n\n${items.map(i => '- ' + i.text).join('\n')}\n\nNothing is needed from you right now. We’ll keep you posted on what’s next.`;
}

// ---- the three automations ---------------------------------------------------------------------
const dueWords = w => w.daysLeft < 0 ? `was due ${fmtDateW(w.due)}` : w.daysLeft === 0 ? 'is due today' : 'is due tomorrow';

async function autoDraft(admin, ctx) {
  const { weeks, profiles, settings, state, started } = ctx;
  state.drafted = state.drafted || {};
  const todo = weeks.filter(w => w.daysLeft <= 1 && !w.openDraft && !w.c.deleted_at && state.drafted[w.c.id] !== w.key)
    .map(w => ({ w, items: w.logged.filter(i => i.include_in_email !== false).sort((a, b) => new Date(a.date) - new Date(b.date)) }))
    .filter(x => x.items.length);
  const appName = settings.appName || 'Based Agency';
  const byWriter = {};
  let written = 0, fallback = 0, left = 0;
  const one = async ({ w, items }) => {
    const active = n => profiles.find(p => p.name === n && !p.access_revoked);
    const writer = [w.owner, ...items.map(i => i.author)].find(n => n && active(n)) || w.owner || items[0].author;
    const prof = active(writer);
    let text = '';
    if (process.env.OPENAI_API_KEY) {
      try {
        const r = await callOpenAI([{ role: 'user', content: buildUpdatePrompt(w.c, items, appName, ((prof && prof.email_instructions) || '').trim()) }], null, { model: settings.openaiModel || OPENAI_MODEL, webSearch: false });
        if (r.ok) text = String(r.reply || '').trim();
      } catch (e) {}
    }
    if (!text) { text = plainDraft(w.c, items); fallback++; }
    const { error } = await admin.from('client_drafts').upsert({ client_id: w.c.id, author: writer, draft: text, draft_status: 'pending', draft_pending_since: new Date().toISOString(),
      draft_improvement_ids: items.map(i => i.id), draft_sent_at: null, draft_sent_by: '', ready_to_notify: false, updated_at: new Date().toISOString() }, { onConflict: 'client_id,author' });
    if (error) return;
    state.drafted[w.c.id] = w.key; written++;
    ctx.justDrafted.add(w.c.id);
    (byWriter[writer] = byWriter[writer] || []).push(w);
    await admin.from('activity_log').insert({ client_id: w.c.id, user_id: null, action_type: 'draft_generated', description: `Wrote ${writer}'s draft automatically from ${items.length} logged improvement${items.length === 1 ? '' : 's'}.` }).then(() => {}, () => {});
  };
  // Four at a time, and stop starting new ones near the function's time limit; the next run catches up.
  const queue = todo.slice();
  const worker = async () => { while (queue.length) { if (Date.now() - started > 38000) { left = queue.length; queue.length = 0; return; } await one(queue.shift()); } };
  await Promise.all([worker(), worker(), worker(), worker()]);
  for (const [writer, ws] of Object.entries(byWriter)) {
    const prof = profiles.find(p => p.name === writer);
    await notify(admin, prof, 'draft_written', ws.length === 1 ? `${ws[0].c.name}: your draft is written` : `${ws.length} drafts are written for you`,
      ws.length === 1 ? `The update ${dueWords(ws[0])}. Check the draft and send it for review.` : `${ws.map(w => w.c.name).join(', ')}. Check each one and send it for review.`, 'approve', ws.length === 1 ? ws[0].c.id : null);
  }
  return { written, withoutAI: fallback, leftForNextRun: left };
}

async function remindBehind(admin, ctx) {
  const { weeks, profiles, state } = ctx;
  state.reminded = state.reminded || {};
  const approvers = profiles.filter(p => (p.role === 'admin' || p.role === 'approver') && !p.access_revoked);
  const lists = new Map(); // profile id → [week]
  let count = 0;
  for (const w of weeks) {
    if (w.c.deleted_at || w.sent || w.daysLeft >= 0) continue; // only overdue updates
    // Its "your draft is written" note went out this morning: remind from tomorrow.
    if (ctx.justDrafted.has(w.c.id) || (state.drafted && state.drafted[w.c.id] === w.key && w.draft && Date.now() - new Date(w.draft.draft_pending_since || 0) < 20 * 3600e3)) continue;
    const k = w.behind;
    const r = state.reminded[w.c.id];
    if (r && r.cycle === w.key && (r.steps || []).includes(k)) continue;
    let to = [];
    if (k >= 2) to = approvers;
    else { const name = k === 1 && w.draft ? w.draft.author : w.owner; const p = profiles.find(x => x.name === name && !x.access_revoked); if (p) to = [p]; }
    if (!to.length) continue;
    state.reminded[w.c.id] = { cycle: w.key, steps: [...((r && r.cycle === w.key && r.steps) || []), k] };
    to.forEach(p => { if (!lists.has(p.id)) lists.set(p.id, []); lists.get(p.id).push(w); });
    count++;
  }
  for (const [id, ws] of lists) {
    const p = profiles.find(x => x.id === id);
    const one = ws[0];
    const title = ws.length === 1 ? `${one.c.name}: ${STEP_SHORT[one.behind]}` : `${ws.length} client updates are overdue`;
    const body = ws.length === 1 ? `The update was due ${fmtDateW(one.due)}.` : ws.map(w => `${w.c.name} (${STEP_SHORT[w.behind]})`).join(', ') + '.';
    await notify(admin, p, 'update_behind', title, body, 'approve', ws.length === 1 ? one.c.id : null);
  }
  return { reminded: count, people: lists.size };
}

async function mondaySummary(admin, ctx) {
  const { nowW, weeks, profiles, settings, impsBy, tasks, entries, off, state } = ctx;
  if (nowW.getUTCDay() !== 1) return { skipped: true, reason: 'Runs on Mondays.' };
  const monday = dayStartW(nowW), key = monday.toISOString().slice(0, 10);
  if (state.monday === key) return { skipped: true, reason: 'Already sent this week.' };
  const T = Object.assign({}, DEFAULT_SIGNALS, settings.healthSignals || {});
  const lvl = (v, [w, r]) => (v >= r ? 'r' : v >= w ? 'y' : null);
  const from = addDaysW(monday, -7), onTime = [], late = [], missed = [], health = [];
  const monthStart = new Date(Date.UTC(nowW.getUTCFullYear(), nowW.getUTCMonth(), 1));
  const dim = new Date(Date.UTC(nowW.getUTCFullYear(), nowW.getUTCMonth() + 1, 0)).getUTCDate();
  for (const w of weeks) {
    const c = w.c;
    if (c.deleted_at) continue;
    // Last week (Monday to Sunday): sent on time, sent late (more than 7 days after the one before), or nothing.
    const i = w.sends.findIndex(t => t >= from && t < monday);
    if (i >= 0) (i > 0 && daysBetweenW(w.sends[i - 1], w.sends[i]) > UPDATE_EVERY_DAYS ? late : onTime).push(c);
    else if (w.sends.length || (impsBy[c.id] || []).some(x => toWall(x.date, off) > addDaysW(monday, -14))) missed.push(c);
    // Client health, the same signals the Health screen uses.
    const sig = [];
    if (w.last) { const n = daysBetweenW(w.last, nowW), l = lvl(n, T.noUpdateDays); if (l) sig.push([l, `no update in ${n} days`]); }
    const lastLog = (impsBy[c.id] || []).map(x => toWall(x.date, off)).sort((a, b) => b - a)[0];
    if (lastLog) { const n = daysBetweenW(lastLog, nowW), l = lvl(n, T.nothingLoggedDays); if (l) sig.push([l, `nothing logged in ${n} days`]); }
    const od = tasks.filter(t => t.client_id === c.id && t.status !== 'done' && !t.cancelled_at && t.due_date && t.due_date < nowW.toISOString().slice(0, 10)).length;
    const lo = lvl(od, T.overdueTasks); if (lo) sig.push([lo, `${od} tasks overdue`]);
    if (settings.ownerRiskFlag !== false) { const lf = lvl(c.danger || 0, T.ownerFlag); if (lf) sig.push([lf, `risk flagged ${c.danger} of 5`]); }
    if (c.monthly_hour_budget) {
      const used = entries.filter(e => e.client_id === c.id && new Date(e.entry_date + 'T12:00:00Z') >= monthStart).reduce((s, e) => s + (e.minutes || 0), 0) / 60;
      const day = nowW.getUTCDate(), projected = used / Math.max(1, day) * dim, pct = projected / c.monthly_hour_budget * 100;
      const l = pct >= T.hoursPacePct[1] ? 'r' : pct >= T.hoursPacePct[0] ? 'y' : null;
      if (l && day >= 5) sig.push([l, `on pace for ${Math.round(projected)} of ${c.monthly_hour_budget} hours`]);
    }
    if (!sig.length) continue;
    let level = sig.some(s => s[0] === 'r') ? 'r' : 'y';
    if (level === 'y' && T.importantBump && (c.importance || 0) >= 8) level = 'r';
    health.push({ c, level, why: sig.sort((a, b) => (a[0] === 'r' ? 0 : 1) - (b[0] === 'r' ? 0 : 1)).map(s => s[1]).slice(0, 2).join(', ') });
  }
  const total = onTime.length + late.length + missed.length;
  const risk = health.filter(h => h.level === 'r'), watch = health.filter(h => h.level === 'y');
  const overdue = weeks.filter(w => !w.c.deleted_at && !w.sent && w.daysLeft < 0), dueWeek = weeks.filter(w => !w.c.deleted_at && w.daysLeft >= 0 && w.daysLeft < 7);
  const title = total ? `Last week: ${onTime.length + late.length} of ${total} clients got their update` : 'Your Monday summary';
  const lines = [
    late.length ? `Sent late: ${late.map(c => c.name).join(', ')}.` : '',
    missed.length ? `Nothing sent: ${missed.map(c => c.name).join(', ')}.` : '',
    overdue.length ? `Overdue now: ${overdue.map(w => w.c.name).join(', ')}.` : '',
    risk.length ? `At risk: ${risk.map(h => `${h.c.name} (${h.why})`).join('; ')}.` : '',
    watch.length ? `Worth watching: ${watch.map(h => `${h.c.name} (${h.why})`).join('; ')}.` : '',
    `${dueWeek.length} client update${dueWeek.length === 1 ? ' is' : 's are'} due this week.`,
  ].filter(Boolean);
  const approvers = profiles.filter(p => (p.role === 'admin' || p.role === 'approver') && !p.access_revoked);
  for (const p of approvers) {
    await notify(admin, p, 'monday_summary', title, lines.slice(0, 3).join(' ') || lines[lines.length - 1], risk.length ? 'health' : 'approve');
    if (p.email && !muted(p, 'monday_summary', 'email')) {
      const appUrl = process.env.APP_URL || '';
      await sendEmail(p.email, title, `${lines.join('\n\n')}\n\n${appUrl ? `Open This Week: ${appUrl}/#approve` : ''}`.trim());
    }
  }
  state.monday = key;
  return { approvers: approvers.length, onTime: onTime.length, late: late.length, missed: missed.length, overdue: overdue.length, atRisk: risk.length, watch: watch.length };
}

// ---- run them -------------------------------------------------------------------------------
async function runUpdateAutomations(admin, settings, opts) {
  const started = (opts && opts.started) || Date.now();
  const automation = Object.assign({}, DEFAULT_AUTOMATION, settings.updatesAutomation || {});
  delete automation.scheduledSend; // retired: approvers send every update themselves
  if (!['autoDraft', 'remindBehind', 'mondaySummary'].some(k => automation[k])) return { skipped: true, reason: 'All three are off in Settings → Updates.' };
  const off = wallOffset(settings.timezone || process.env.TEAM_TIMEZONE || 'America/New_York');
  const nowW = toWall(new Date(), off);
  const monthStart = new Date(Date.UTC(nowW.getUTCFullYear(), nowW.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const [{ data: clients }, { data: imps }, { data: drafts }, { data: profiles }, { data: tasks }, { data: entries }] = await Promise.all([
    admin.from('clients').select('*'),
    admin.from('client_improvements').select('id, client_id, author, text, date, include_in_email'),
    admin.from('client_drafts').select('*'),
    admin.from('team_profiles').select('*'),
    admin.from('tasks').select('client_id, status, due_date, cancelled_at'),
    admin.from('time_entries').select('client_id, minutes, entry_date').gte('entry_date', monthStart).is('deleted_at', null),
  ]);
  const history = await getJson(admin, 'update-history', {});
  const state = await getJson(admin, 'automation-state', {});
  const impsBy = {}, draftsBy = {};
  (imps || []).forEach(i => (impsBy[i.client_id] = impsBy[i.client_id] || []).push(i));
  (drafts || []).forEach(d => (draftsBy[d.client_id] = draftsBy[d.client_id] || []).push(d));
  // a client added from Harvest joins once an approver finishes its setup
  const weeks = (clients || []).filter(c => !c.deleted_at && !inHarvestSetup(c)).map(c => clientWeek(c, impsBy[c.id] || [], draftsBy[c.id] || [], history, nowW, off));
  const ctx = { nowW, automation, weeks, profiles: profiles || [], settings, state, impsBy, tasks: tasks || [], entries: entries || [], off, started, justDrafted: new Set() };
  const result = { day: DAY_NAMES[nowW.getUTCDay()], date: nowW.toISOString().slice(0, 10) };
  const run = async (name, fn) => { if (!automation[name]) { result[name] = { skipped: true, reason: 'Off in Settings.' }; return; } try { result[name] = await fn(admin, ctx); } catch (e) { result[name] = { error: String(e) }; } };
  // Drafts first, so nobody hears about the same client twice in one morning.
  await run('autoDraft', autoDraft);
  await run('remindBehind', remindBehind);
  await run('mondaySummary', mondaySummary);
  // Keep the state small: entries for due dates more than three weeks old are dropped.
  const cutoff = addDaysW(nowW, -21).toISOString().slice(0, 10);
  if (state.drafted) Object.keys(state.drafted).forEach(id => { if (state.drafted[id] < cutoff) delete state.drafted[id]; });
  if (state.reminded) Object.keys(state.reminded).forEach(id => { if (!state.reminded[id].cycle || state.reminded[id].cycle < cutoff) delete state.reminded[id]; });
  await putJson(admin, 'automation-state', state);
  return result;
}

module.exports = { runUpdateAutomations, clientWeek, wallOffset, toWall };
