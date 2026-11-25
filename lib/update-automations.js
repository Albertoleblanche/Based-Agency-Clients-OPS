// The three "Help the team keep up" switches in Settings → Updates, run by the daily cron
// (api/cron-wednesday-notify.js). Every client gets one update a week: on its win day if it has
// one, else 7 days after its last one (never on a weekend), and an approver checks it and sends it
// the day it's ready. Clients that are paused or set to "No weekly update" are skipped. Nothing
// here ever emails a client.
//
//   autoDraft      Each weekday morning, writes a part for every client due within a day (Fridays:
//                  by Monday) that has work logged for the email, for each writer to check and send.
//   remindBehind   The weekday morning after a client's update was due, reminds whoever holds it
//                  (the writers, or the approvers): in the app, by push and on Slack.
//                  One reminder per client per step for each due date.
//   mondaySummary  On Mondays, tells approvers how last week's updates went and which clients'
//                  health needs a look, starting with the Focus clients.
//
// Focus clients (Nov 23, custom_field_values.focus, switched on by approvers) come first in all
// three: their drafts are written first, they lead every reminder, and Health watches them closer
// here as in the app (focusThresholds, the same rule as js/features/week-health.js).
//
// "Today" is worked out in the team's time zone (settings.timezone, saved from the browser).
// Nothing runs on a Saturday or Sunday: the team doesn't work weekends (lib/workdays.js).

const { selectAll } = require('./select-all');
const { winDraftPrompt, winPlainDraft } = require('../js/core/win-prompt.js');
const { callOpenAI, OPENAI_MODEL } = require('./ai-client');
const { sendPushToUser, pushUrlFor } = require('./push-notify');
const { sendSlackDM } = require('./slack-notify');
const inHarvestSetup = c => !!(c && c.custom_field_values && c.custom_field_values.harvestSetup === 'needed');
// a paused client, or one set to "No weekly update", never has an update due (the app's attentionEligibleClients)
const getsUpdates = c => !!c && c.status !== 'Paused' && !(c.custom_field_values && c.custom_field_values.weeklyUpdate === 'off');
const isFocus = c => !!(c && c.custom_field_values && c.custom_field_values.focus);
const focusName = c => isFocus(c) ? `${c.name} (Focus)` : c.name;
// Health watches Focus clients closer: the same rule as the app's focusThresholds (week-health.js).
function focusThresholds(T) {
  const days = ([w, r]) => { const a = Math.max(1, Math.round(w * .75)); return [a, Math.max(a + 1, Math.round(r * .75))]; };
  const less = ([w, r]) => { const a = Math.max(1, w - 1); return [a, Math.max(a + 1, r - 1)]; };
  return Object.assign({}, T, {
    nothingLoggedDays: days(T.nothingLoggedDays),
    noUpdateDays: [T.noUpdateDays[0], Math.max(T.noUpdateDays[0] + 1, Math.round(T.noUpdateDays[0] + (T.noUpdateDays[1] - T.noUpdateDays[0]) / 2))],
    lateOfLast4: less(T.lateOfLast4), overdueTasks: less(T.overdueTasks),
    underUsedPct: Math.min(90, (T.underUsedPct || 50) + 20),
  });
}

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
// When the update is due, as the app's clientDue(): its win day each calendar week (sent any day
// that week counts), else 7 days after the last one. One that never had one is due a week after the
// client started (start date, else when it was added) and never before Radar's first Friday, so
// it's due once, then late. A weekend moves to the Friday before.
const FIRST_UPDATES_DUE = '2026-11-27';
const weekdayDueW = d => { const k = d.getUTCDay(); return k === 6 ? addDaysW(d, -1) : k === 0 ? addDaysW(d, -2) : d; };
function clientDue(c, last, nowW, off) {
  const cfv = c.custom_field_values || {}, wd = Number(cfv.winDay);
  if (wd >= 1 && wd <= 5) {
    const monday = dayStartW(addDaysW(nowW, -((nowW.getUTCDay() + 6) % 7))), thisDue = addDaysW(monday, wd - 1);
    const done = !!last && last >= monday, due = done ? addDaysW(thisDue, 7) : thisDue;
    return { due, daysLeft: daysBetweenW(nowW, due), done };
  }
  let due;
  if (last) due = addDaysW(dayStartW(last), UPDATE_EVERY_DAYS);
  else {
    const from = c.start_date ? new Date(String(c.start_date).slice(0, 10) + 'T00:00:00Z') : c.created_at ? dayStartW(toWall(c.created_at, off)) : null;
    const first = new Date(FIRST_UPDATES_DUE + 'T00:00:00Z');
    due = from && !isNaN(from) ? addDaysW(from, UPDATE_EVERY_DAYS) : first;
    if (due < first) due = first;
  }
  due = weekdayDueW(due);
  const daysLeft = daysBetweenW(nowW, due);
  return { due, daysLeft, done: !!last && daysLeft > 0 };
}
function clientWeek(c, imps, drafts, history, nowW, off) {
  const owner = clientOwner(c, imps, drafts, nowW, off);
  const sends = sentTimes(c, drafts, history, off), last = sends[sends.length - 1] || null;
  const { due, daysLeft, done: sentThisWeek } = clientDue(c, last, nowW, off);
  const since = last || addDaysW(nowW, -UPDATE_EVERY_DAYS);
  // as the app's clientWeek: also work logged since then with an earlier date, and work added to the next update
  const logged = imps.filter(i => toWall(i.date, off) > since || (i.created_at && toWall(i.created_at, off) > since) || (i.carry_over && i.include_in_email !== false));
  const approved = drafts.find(d => d.draft_status === 'approved' && !d.draft_sent_at);
  const inReview = drafts.find(d => d.draft_status === 'pending' && d.ready_to_notify);
  const written = drafts.find(d => d.draft_status === 'pending');
  const w = { c, owner, logged, last, due, daysLeft, key: due.toISOString().slice(0, 10), sends, done: 0, behind: null, sent: false, holder: owner, draft: null, openDraft: approved || written || null, drafts };
  if (sentThisWeek) return Object.assign(w, { done: 4, sent: true });
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

// ---- the draft prompt: the app's own (js/core/win-prompt.js), framed as wins ---------------------
function buildUpdatePrompt(c, items, appName, structure) {
  return winDraftPrompt({
    name: c.name, contact: (c.custom_field_values && c.custom_field_values.contact) || '', service: c.service, sow: c.sow, appName,
    bullets: items.map(i => '- ' + i.text).join('\n'),
    structure,
    // a client set to get its weekly win in its WhatsApp group: a short group message, not an email
    whatsapp: !!(c.custom_field_values && c.custom_field_values.winChannel === 'whatsapp'),
  });
}
function plainDraft(c, items) {
  const cfv = c.custom_field_values || {};
  return winPlainDraft({ contact: cfv.contact || '', items: items.map(i => i.text), whatsapp: cfv.winChannel === 'whatsapp' });
}

// ---- the three automations ---------------------------------------------------------------------
const dueWords = w => w.daysLeft < 0 ? `was due ${fmtDateW(w.due)}` : w.daysLeft === 0 ? 'is due today' : 'is due tomorrow';

async function autoDraft(admin, ctx) {
  const { weeks, profiles, settings, state, started, nowW } = ctx;
  // Weekdays only (Nov 22): nothing is due on a weekend, so Friday also writes Monday's.
  const dow = nowW.getUTCDay();
  if (dow === 0 || dow === 6) return { skipped: true, reason: 'Not on weekends.' };
  const ahead = dow === 5 ? 3 : 1;
  state.drafted = state.drafted || {};
  // One part per person (Nov 22): each person who logged work for the email gets their own part,
  // written from their own work, unless they already have one going. The parts go out as one email.
  const active = n => profiles.find(p => p.name === n && !p.access_revoked);
  const todo = [];
  weeks.filter(w => w.daysLeft <= ahead && !w.c.deleted_at).forEach(w => {
    const items = w.logged.filter(i => i.include_in_email !== false).sort((a, b) => new Date(a.date) - new Date(b.date));
    // work by someone no longer on the team goes in the owner's part
    const by = {};
    items.forEach(i => { const a = active(i.author) ? i.author : active(w.owner) ? w.owner : ''; if (a) (by[a] = by[a] || []).push(i); });
    Object.entries(by).forEach(([writer, its]) => {
      const open = (w.drafts || []).some(d => d.author === writer && d.draft && !d.draft_sent_at && (d.draft_status === 'pending' || d.draft_status === 'approved'));
      if (open || state.drafted[`${w.c.id}|${writer}`] === w.key) return;
      todo.push({ w, writer, items: its });
    });
  });
  const appName = settings.appName || 'Based Agency';
  const byWriter = {};
  let written = 0, fallback = 0, left = 0;
  const one = async ({ w, writer, items }) => {
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
    state.drafted[w.c.id] = w.key; state.drafted[`${w.c.id}|${writer}`] = w.key; written++;
    ctx.justDrafted.add(w.c.id);
    (byWriter[writer] = byWriter[writer] || []).push(w);
    await admin.from('activity_log').insert({ client_id: w.c.id, user_id: null, action_type: 'draft_generated', description: `Wrote ${writer}'s part automatically from ${items.length} logged improvement${items.length === 1 ? '' : 's'}.` }).then(() => {}, () => {});
  };
  // Four at a time, and stop starting new ones near the function's time limit; the next run catches up.
  const queue = todo.slice();
  const worker = async () => { while (queue.length) { if (Date.now() - started > 38000) { left = queue.length; queue.length = 0; return; } await one(queue.shift()); } };
  await Promise.all([worker(), worker(), worker(), worker()]);
  for (const [writer, ws] of Object.entries(byWriter)) {
    const prof = profiles.find(p => p.name === writer);
    await notify(admin, prof, 'draft_written', ws.length === 1 ? `${focusName(ws[0].c)}: your draft is written` : `${ws.length} drafts are written for you`,
      ws.length === 1 ? `The update ${dueWords(ws[0])}. Check the draft and send it for review.` : `${ws.map(w => focusName(w.c)).join(', ')}. Check each one and send it for review.`, 'approve', ws.length === 1 ? ws[0].c.id : null);
  }
  return { written, withoutAI: fallback, leftForNextRun: left };
}

async function remindBehind(admin, ctx) {
  const { weeks, profiles, state, nowW } = ctx;
  // Weekdays only (Nov 22): an update due Friday is chased on Monday morning, not over the weekend.
  if (nowW.getUTCDay() === 0 || nowW.getUTCDay() === 6) return { skipped: true, reason: 'Not on weekends.' };
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
    else {
      // a part written but not sent for review: everyone whose part it is (Nov 22: one part per person)
      const names = k === 1 && w.draft ? [...new Set((w.drafts || []).filter(d => d.draft && d.draft_status === 'pending' && !d.ready_to_notify && !d.draft_sent_at).map(d => d.author))] : [w.owner];
      to = (names.length ? names : [w.draft ? w.draft.author : w.owner]).map(n => profiles.find(x => x.name === n && !x.access_revoked)).filter(Boolean);
    }
    if (!to.length) continue;
    state.reminded[w.c.id] = { cycle: w.key, steps: [...((r && r.cycle === w.key && r.steps) || []), k] };
    to.forEach(p => { if (!lists.has(p.id)) lists.set(p.id, []); lists.get(p.id).push(w); });
    count++;
  }
  for (const [id, ws] of lists) {
    const p = profiles.find(x => x.id === id);
    const one = ws[0];
    const title = ws.length === 1 ? `${focusName(one.c)}: ${STEP_SHORT[one.behind]}` : `${ws.length} client updates are overdue`;
    const body = ws.length === 1 ? `The update was due ${fmtDateW(one.due)}.` : ws.map(w => `${w.c.name} (${isFocus(w.c) ? 'Focus, ' : ''}${STEP_SHORT[w.behind]})`).join(', ') + '.';
    await notify(admin, p, 'update_behind', title, body, 'approve', ws.length === 1 ? one.c.id : null);
  }
  return { reminded: count, people: lists.size };
}

async function mondaySummary(admin, ctx) {
  const { nowW, weeks, profiles, settings, impsBy, tasks, entries, off, state } = ctx;
  if (nowW.getUTCDay() !== 1) return { skipped: true, reason: 'Runs on Mondays.' };
  const monday = dayStartW(nowW), key = monday.toISOString().slice(0, 10);
  if (state.monday === key) return { skipped: true, reason: 'Already sent this week.' };
  const T = Object.assign({}, DEFAULT_SIGNALS, settings.healthSignals || {}), T0 = T;
  const lvl = (v, [w, r]) => (v >= r ? 'r' : v >= w ? 'y' : null);
  const from = addDaysW(monday, -7), onTime = [], late = [], missed = [], health = [];
  const monthStart = new Date(Date.UTC(nowW.getUTCFullYear(), nowW.getUTCMonth(), 1));
  const dim = new Date(Date.UTC(nowW.getUTCFullYear(), nowW.getUTCMonth() + 1, 0)).getUTCDate();
  const TF = focusThresholds(T);
  for (const w of weeks) {
    const c = w.c, T = isFocus(c) ? TF : T0;
    if (c.deleted_at) continue;
    // Last week (Monday to Sunday): sent on time, sent late (more than 7 days after the one before), or nothing.
    const i = w.sends.findIndex(t => t >= from && t < monday);
    if (i >= 0) (i > 0 && daysBetweenW(w.sends[i - 1], w.sends[i]) > UPDATE_EVERY_DAYS ? late : onTime).push(c);
    else if (w.sends.length || (impsBy[c.id] || []).some(x => toWall(x.date, off) > addDaysW(monday, -14))) missed.push(c);
    // Client health, the same signals the Health screen uses.
    const sig = [];
    if (w.last) { const n = daysBetweenW(w.last, nowW), l = lvl(n, T.noUpdateDays); if (l) sig.push([l, `no update in ${n} days`]); }
    const lastLog = (impsBy[c.id] || []).map(x => toWall(x.date, off)).sort((a, b) => b - a)[0];
    // a client with nothing ever logged counts from when it started (start date, else when it was added)
    const started = c.start_date ? toWall(String(c.start_date).slice(0, 10) + 'T12:00:00Z', off) : c.created_at ? toWall(c.created_at, off) : null;
    const quietFrom = lastLog || (started && !isNaN(started) ? started : null);
    if (quietFrom && quietFrom <= nowW) { const n = daysBetweenW(quietFrom, nowW), l = lvl(n, T.nothingLoggedDays); if (l) sig.push([l, lastLog ? `nothing logged in ${n} days` : `nothing logged since it started ${n} days ago`, lastLog ? 'quiet' : 'never']); }
    const od = tasks.filter(t => t.client_id === c.id && t.status !== 'done' && !t.cancelled_at && t.due_date && t.due_date < nowW.toISOString().slice(0, 10)).length;
    const lo = lvl(od, T.overdueTasks); if (lo) sig.push([lo, `${od} tasks overdue`]);
    if (settings.ownerRiskFlag !== false) { const lf = lvl(c.danger || 0, T.ownerFlag); if (lf) sig.push([lf, `risk set to ${c.danger} of 5`]); }
    if (c.monthly_hour_budget) {
      const used = entries.filter(e => e.client_id === c.id && new Date(e.entry_date + 'T12:00:00Z') >= monthStart).reduce((s, e) => s + (e.minutes || 0), 0) / 60;
      const day = nowW.getUTCDate(), projected = used / Math.max(1, day) * dim, pct = projected / c.monthly_hour_budget * 100;
      const l = pct >= T.hoursPacePct[1] ? 'r' : pct >= T.hoursPacePct[0] ? 'y' : null;
      if (l && day >= 5) sig.push([l, `on pace for ${Math.round(projected)} of ${c.monthly_hour_budget} hours`]);
    }
    if (!sig.length) continue;
    let level = sig.some(s => s[0] === 'r') ? 'r' : 'y';
    if (level === 'y' && T.importantBump && (c.importance || 0) >= 8) level = 'r';
    // flagged only because nothing has ever been logged: counted in one line, not listed one by one
    health.push({ c, level, never: sig.length === 1 && sig[0][2] === 'never', why: sig.sort((a, b) => (a[0] === 'r' ? 0 : 1) - (b[0] === 'r' ? 0 : 1)).map(s => s[1]).slice(0, 2).join(', ') });
  }
  // Focus clients: how they did, first
  const fw = weeks.filter(w => !w.c.deleted_at && isFocus(w.c));
  const fSent = fw.filter(w => onTime.includes(w.c) || late.includes(w.c)), fNeed = health.filter(h => isFocus(h.c));
  const focusLine = fw.length ? `Focus clients: ${fSent.length} of ${fw.length} got their update${fNeed.length ? `; ${fNeed.map(h => `${h.c.name} ${h.level === 'r' ? 'is at risk' : 'needs watching'} (${h.why})`).join('; ')}` : ', and all are healthy'}.` : '';
  const total = onTime.length + late.length + missed.length;
  // Most important first (Focus, then importance), and each list capped: the whole list is on Health.
  const weight = (a, b) => ((isFocus(b.c) ? 1 : 0) - (isFocus(a.c) ? 1 : 0)) || ((b.c.importance || 0) - (a.c.importance || 0)) || String(a.c.name).localeCompare(String(b.c.name));
  const listed = health.filter(h => !h.never), neverLogged = health.filter(h => h.never).sort(weight);
  const risk = listed.filter(h => h.level === 'r').sort(weight), watch = listed.filter(h => h.level === 'y').sort(weight);
  const some = (arr, n, fmt, sep) => arr.slice(0, n).map(fmt).join(sep) + (arr.length > n ? `${sep === '; ' ? ';' : ''} and ${arr.length - n} more` : '');
  const names = (cs, n) => some(cs, n, c => c.name, ', ');
  const overdue = weeks.filter(w => !w.c.deleted_at && !w.sent && w.daysLeft < 0), dueWeek = weeks.filter(w => !w.c.deleted_at && w.daysLeft >= 0 && w.daysLeft < 7);
  const title = total ? `Last week: ${onTime.length + late.length} of ${total} clients got their update` : 'Your Monday summary';
  const dueLine = `${dueWeek.length} client update${dueWeek.length === 1 ? ' is' : 's are'} due this week.`;
  const neverLine = neverLogged.length ? `${neverLogged.length === 1 ? '1 client has' : `${neverLogged.length} clients have`} had no work logged in Radar since ${neverLogged.length === 1 ? 'it was' : 'they were'} added` : '';
  // the email: the details, each list capped
  const lines = [
    focusLine,
    late.length ? `Sent late: ${names(late, 10)}.` : '',
    missed.length ? `Nothing sent: ${names(missed, 10)}.` : '',
    overdue.length ? `Overdue now: ${names(overdue.map(w => w.c), 10)}.` : '',
    risk.length ? `At risk (${risk.length}): ${some(risk, 8, h => `${focusName(h.c)} (${h.why})`, '; ')}.` : '',
    watch.length ? `Worth watching (${watch.length}): ${some(watch, 8, h => `${focusName(h.c)} (${h.why})`, '; ')}.` : '',
    neverLine ? `${neverLine}: ${names(neverLogged.map(h => h.c), 6)}. If any aren’t active any more, pause them in All Clients.` : '',
    dueLine,
  ].filter(Boolean);
  // the notification: a few lines, with the numbers; the names are on Health and in the email
  const brief = [
    focusLine,
    risk.length || watch.length ? `${risk.length} client${risk.length === 1 ? '' : 's'} at risk and ${watch.length} worth watching on Health.` : '',
    neverLine ? `${neverLine}.` : '',
    dueLine,
  ].filter(Boolean).join(' ');
  const approvers = profiles.filter(p => (p.role === 'admin' || p.role === 'approver') && !p.access_revoked);
  for (const p of approvers) {
    await notify(admin, p, 'monday_summary', title, brief, risk.length || neverLogged.length ? 'health' : 'approve');
    if (p.email && !muted(p, 'monday_summary', 'email')) {
      const appUrl = process.env.APP_URL || '';
      const links = appUrl ? [risk.length || watch.length || neverLogged.length ? `See Health: ${appUrl}/#health` : '', `Open This Week: ${appUrl}/#approve`].filter(Boolean).join('\n') : '';
      await sendEmail(p.email, title, `${lines.join('\n\n')}\n\n${links}`.trim());
    }
  }
  state.monday = key;
  return { approvers: approvers.length, onTime: onTime.length, late: late.length, missed: missed.length, overdue: overdue.length, atRisk: risk.length, watch: watch.length, neverLogged: neverLogged.length, focus: fw.length, focusSent: fSent.length };
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
    selectAll(() => admin.from('client_improvements').select('*').order('id')),   // deleted work is left out below
    admin.from('client_drafts').select('*'),
    admin.from('team_profiles').select('*'),
    admin.from('tasks').select('client_id, status, due_date, cancelled_at'),
    selectAll(() => admin.from('time_entries').select('client_id, minutes, entry_date').gte('entry_date', monthStart).is('deleted_at', null).order('id')),
  ]);
  const history = await getJson(admin, 'update-history', {});
  const state = await getJson(admin, 'automation-state', {});
  const impsBy = {}, draftsBy = {};
  (imps || []).filter(i => !i.deleted_at).forEach(i => (impsBy[i.client_id] = impsBy[i.client_id] || []).push(i));
  (drafts || []).forEach(d => (draftsBy[d.client_id] = draftsBy[d.client_id] || []).push(d));
  // a client added from Harvest joins once an approver finishes its setup. As the app's This Week:
  // paused clients and clients set to "No weekly update" (the agency itself, say) are left out.
  const weeks = (clients || []).filter(c => !c.deleted_at && !inHarvestSetup(c) && getsUpdates(c)).map(c => clientWeek(c, impsBy[c.id] || [], draftsBy[c.id] || [], history, nowW, off))
    .sort((a, b) => (isFocus(b.c) ? 1 : 0) - (isFocus(a.c) ? 1 : 0));   // Focus clients first: drafted first, and first in every list
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

module.exports = { runUpdateAutomations, clientWeek, clientDue, getsUpdates, isFocus, focusThresholds, wallOffset, toWall };
