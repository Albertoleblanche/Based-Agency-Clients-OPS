// The four "Help the team keep up" switches in Settings → Updates, run by the daily cron
// (api/cron-wednesday-notify.js). Vercel's Hobby plan runs crons once a day, so each part
// works by day, not to the minute:
//
//   autoDraft      On the "ready for review" day (and the day after, to catch up), writes a
//                  draft for every client with work logged for the email and no draft yet,
//                  for the client's owner to check and send for review.
//   remindBehind   The run after a checkpoint is missed, reminds whoever holds the update
//                  (the owner, the draft's writer, or the approvers): in the app, by push and
//                  on Slack. One reminder per client per missed step per week.
//   scheduledSend  On the send day, emails every approved update that hasn't gone out.
//   mondaySummary  On Mondays, tells approvers how last week's updates went and which
//                  clients' health needs a look.
//
// All of it reads the same schedule and thresholds the app shows (settings.updatesSchedule,
// settings.updatesAutomation, settings.healthSignals) in the team's time zone
// (settings.timezone, saved from the browser when the schedule changes).

const { callOpenAI, OPENAI_MODEL } = require('./ai-client');
const { sendPushToUser, pushUrlFor } = require('./push-notify');
const { sendSlackDM } = require('./slack-notify');
const { plainTextToHtml, buildSignatureHtml } = require('./email-format');

const DEFAULT_SCHEDULE = { send: { day: 4, time: '09:00' }, log: { day: 1, time: '18:00' }, review: { day: 2, time: '12:00' }, approve: { day: 3, time: '18:00' } };
const DEFAULT_AUTOMATION = { autoDraft: true, remindBehind: true, scheduledSend: true, mondaySummary: true };
const DEFAULT_SIGNALS = { noUpdateDays: [8, 14], lateOfLast4: [2, 3], hoursPacePct: [110, 150], underUsedPct: 50, nothingLoggedDays: [7, 14], overdueTasks: [2, 4], ownerFlag: [3, 4], importantBump: true, quietDays: 7 };
const STEP_SHORT = ['nothing logged', 'draft not sent for review', 'waiting for approval', 'approved, not sent'];
const STEP_DUE = ['Work was due', 'Sending it for review was due', 'Approval was due', 'It was due to go out'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY = 86400000;

// ---- time, in the team's wall clock ------------------------------------------------------------
// Everything below works on "wall" dates: Date objects whose UTC fields read as the team's local
// date and time, so checkpoints compare the way they do in the app.
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
const fmtTimeW = d => { const h = d.getUTCHours(), m = d.getUTCMinutes(); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const fmtDayW = d => DAY_NAMES[d.getUTCDay()].slice(0, 3);
const fmtDateW = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

function cycleAt(nowW, sch) {
  const monday = dayStartW(addDaysW(nowW, -((nowW.getUTCDay() + 6) % 7)));
  const at = cp => { const d = addDaysW(monday, (cp.day + 6) % 7); const [h, m] = String(cp.time || '00:00').split(':').map(Number); d.setUTCHours(h || 0, m || 0, 0, 0); return d; };
  const send = at(sch.send), log = at(sch.log), review = at(sch.review), approve = at(sch.approve);
  return { now: nowW, monday, send, prevSend: addDaysW(send, -7), cp: { log, review, approve, send }, periodStart: addDaysW(log, -7), periodEnd: log, key: send.toISOString().slice(0, 10) };
}

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
function clientWeek(c, imps, drafts, cyc, off) {
  const owner = clientOwner(c, imps, drafts, cyc.now, off);
  const logged = imps.filter(i => toWall(i.date, off) > cyc.periodStart);
  const sent = drafts.filter(d => d.draft_sent_at && toWall(d.draft_sent_at, off) > cyc.prevSend);
  const approved = drafts.filter(d => d.draft_status === 'approved' && !d.draft_sent_at);
  const inReview = drafts.find(d => d.draft_status === 'pending' && d.ready_to_notify);
  const written = drafts.find(d => d.draft_status === 'pending');
  const w = { c, owner, logged, done: 0, behind: null, sent: false, holder: owner, draft: null, approved };
  if (sent.length) Object.assign(w, { done: 4, sent: true, draft: sent[0] });
  else if (approved.length) Object.assign(w, { done: 3, draft: approved[0], holder: 'approvers' });
  else if (inReview) Object.assign(w, { done: 2, draft: inReview, holder: 'approvers' });
  else if (written) Object.assign(w, { done: 1, draft: written, holder: written.author });
  else if (logged.length) w.done = 1;
  const due = [cyc.cp.log, cyc.cp.review, cyc.cp.approve, cyc.cp.send];
  if (w.done < 4 && cyc.now > due[w.done]) w.behind = w.done;
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
async function sendEmail(to, subject, text, html, scheduledAt) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'Missing RESEND_API_KEY' };
  const from = process.env.EMAIL_FROM || 'Based Agency <onboarding@resend.dev>';
  const recipients = String(to).split(',').map(s => s.trim()).filter(Boolean);
  if (!recipients.length) return { ok: false, error: 'No address' };
  try {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ from, to: recipients, subject, text, ...(html ? { html } : {}), ...(scheduledAt ? { scheduled_at: scheduledAt } : {}) }) });
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
  const rules = `Content rules that apply no matter what — never overridden by anything above:
- Describe every improvement as a specific, measurable deliverable — a concrete action taken, a number, a metric, or a defined output. Never state it as a vague, broad claim (e.g. never say "improved performance," "made things better," "optimized the account" with nothing concrete attached).
- If a logged improvement itself is vague or lacks a concrete detail, do not invent specifics to make it sound more impressive — describe only what was actually logged, worded as precisely as the source allows, and keep it modest rather than embellished.
- Never say anything that could make the agency look bad: no admitting mistakes, no exposing internal problems, no hedging language that implies something isn't working, no comparisons that read as excuses. State what was done factually and confidently without overstating results.
- No subject line, no meta-commentary about the email itself — output only the email body.`;
  return structure
    ? `Write a weekly client update email for a home-services/construction client from their marketing agency (${appName}).

The agency has specified an exact structure below. Follow it precisely and completely — every element it describes (greeting, paragraph order, sign-off, length, tone) — and do NOT fall back to any generic or default email structure, even partially:

--- REQUIRED STRUCTURE ---
${structure}
--- END REQUIRED STRUCTURE ---

Client: ${c.name}
Service: ${c.service}
Scope notes: ${c.sow || 'n/a'}
Improvements made this week:
${bullets}

${rules}`
    : `Write a short, warm, professional weekly update email to a home-services/construction client from their marketing agency (${appName}).
Client: ${c.name}
Service: ${c.service}
Scope notes: ${c.sow || 'n/a'}
Improvements made this week:
${bullets}

Structure: 2-4 short paragraphs max, no fluff or filler compliments, plain language, no subject line, no signature block, sound like a competent account manager not a sales email. End by noting nothing is needed from them unless something explicitly requires their input.

${rules}`;
}
function plainDraft(c, items) {
  return `Hi,\n\nHere’s what we worked on for ${c.name} this week:\n\n${items.map(i => '- ' + i.text).join('\n')}\n\nNothing is needed from you right now. We’ll keep you posted on what’s next.`;
}

// ---- the four automations ----------------------------------------------------------------------
async function autoDraft(admin, ctx) {
  const { cyc, sch, weeks, profiles, settings, state, started } = ctx;
  const today = cyc.now.getUTCDay();
  if (today !== sch.review.day && today !== (sch.review.day + 1) % 7) return { skipped: true, reason: `Drafts are written on ${DAY_NAMES[sch.review.day]}.` };
  if (cyc.now < cyc.cp.log || cyc.now > cyc.cp.send) return { skipped: true, reason: 'Outside this week’s drafting window.' };
  state.drafted = state.drafted || {};
  const todo = weeks.filter(w => !w.sent && !w.draft && !w.c.deleted_at && state.drafted[w.c.id] !== cyc.key)
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
    state.drafted[w.c.id] = cyc.key; written++;
    (byWriter[writer] = byWriter[writer] || []).push(w.c);
    await admin.from('activity_log').insert({ client_id: w.c.id, user_id: null, action_type: 'draft_generated', description: `Wrote ${writer}'s draft automatically from ${items.length} logged improvement${items.length === 1 ? '' : 's'}.` }).then(() => {}, () => {});
  };
  // Four at a time, and stop starting new ones near the function's time limit; the next run catches up.
  const queue = todo.slice();
  const worker = async () => { while (queue.length) { if (Date.now() - started > 38000) { left = queue.length; queue.length = 0; return; } await one(queue.shift()); } };
  await Promise.all([worker(), worker(), worker(), worker()]);
  const due = `${fmtDayW(cyc.cp.review)} ${fmtTimeW(cyc.cp.review)}`;
  for (const [writer, cs] of Object.entries(byWriter)) {
    const prof = profiles.find(p => p.name === writer);
    await notify(admin, prof, 'draft_written', cs.length === 1 ? `${cs[0].name}: your draft is written` : `${cs.length} drafts are written for you`,
      cs.length === 1 ? `Check it and send it for review by ${due}.` : `${cs.map(c => c.name).join(', ')}. Check each one and send it for review by ${due}.`, 'approve', cs.length === 1 ? cs[0].id : null);
  }
  return { written, withoutAI: fallback, leftForNextRun: left };
}

async function remindBehind(admin, ctx) {
  const { cyc, weeks, profiles, automation, state } = ctx;
  state.reminded = state.reminded || {};
  const approvers = profiles.filter(p => (p.role === 'admin' || p.role === 'approver') && !p.access_revoked);
  const due = [cyc.cp.log, cyc.cp.review, cyc.cp.approve, cyc.cp.send];
  const sendToday = automation.scheduledSend && cyc.now.getUTCDay() === cyc.cp.send.getUTCDay() && daysBetweenW(cyc.cp.send, cyc.now) === 0;
  const lists = new Map(); // profile id → [{ c, step }]
  let count = 0;
  for (const w of weeks) {
    if (w.c.deleted_at || w.behind == null) continue;
    const k = w.behind;
    if (k === 3 && sendToday) continue; // goes out with today's scheduled send
    const r = state.reminded[w.c.id];
    if (r && r.cycle === cyc.key && (r.steps || []).includes(k)) continue;
    let to = [];
    if (k >= 2) to = approvers;
    else { const name = k === 1 && w.draft ? w.draft.author : w.owner; const p = profiles.find(x => x.name === name && !x.access_revoked); if (p) to = [p]; }
    if (!to.length) continue;
    state.reminded[w.c.id] = { cycle: cyc.key, steps: [...((r && r.cycle === cyc.key && r.steps) || []), k] };
    to.forEach(p => { if (!lists.has(p.id)) lists.set(p.id, []); lists.get(p.id).push({ c: w.c, k }); });
    count++;
  }
  const sendAt = `${fmtDayW(cyc.cp.send)} ${fmtTimeW(cyc.cp.send)}`;
  for (const [id, items] of lists) {
    const p = profiles.find(x => x.id === id);
    const one = items[0];
    const title = items.length === 1 ? `${one.c.name}: ${STEP_SHORT[one.k]}` : `${items.length} client updates are behind`;
    const body = items.length === 1 ? `${STEP_DUE[one.k]} ${fmtDayW(due[one.k])} ${fmtTimeW(due[one.k])}.${one.k < 3 ? ` Updates go out ${sendAt}.` : ''}` : items.map(x => `${x.c.name} (${STEP_SHORT[x.k]})`).join(', ') + `. Updates go out ${sendAt}.`;
    await notify(admin, p, 'update_behind', title, body, 'approve', items.length === 1 ? items[0].c.id : null);
  }
  return { reminded: count, people: lists.size };
}

async function scheduledSend(admin, ctx) {
  const { cyc, weeks, profiles, settings, history } = ctx;
  if (cyc.now.getUTCDay() !== cyc.cp.send.getUTCDay()) return { skipped: true, reason: `Updates go out on ${DAY_NAMES[cyc.cp.send.getUTCDay()]}.` };
  const subject = `Your weekly update from ${settings.appName || 'Based Agency'}`;
  const sig = buildSignatureHtml(settings.emailSignature);
  // The cron runs early in the day; Resend holds each email until the send time itself.
  const sendReal = new Date(cyc.cp.send.getTime() - ctx.off);
  const later = sendReal.getTime() > Date.now() + 60000;
  const sent = [], noEmail = [], failed = [];
  for (const w of weeks) {
    if (w.c.deleted_at || !w.approved.length) continue;
    if (!w.c.email) { noEmail.push(w.c); continue; }
    const body = w.approved.map(d => d.draft || '').filter(Boolean).join('\n\n---\n\n');
    if (!body.trim()) continue;
    const r = await sendEmail(w.c.email, subject, body, sig ? plainTextToHtml(body) + sig : null, later ? sendReal.toISOString() : null);
    if (!r.ok) { failed.push(`${w.c.name} (${r.error})`); continue; }
    const at = (later ? sendReal : new Date()).toISOString();
    for (const d of w.approved) await admin.from('client_drafts').update({ draft_sent_at: at, draft_sent_by: 'Scheduled send' }).eq('client_id', w.c.id).eq('author', d.author);
    const list = history[w.c.id] || (history[w.c.id] = []);
    if (!list.some(x => Math.abs(new Date(x) - new Date(at)) < 10 * 60000)) { list.push(at); history[w.c.id] = list.slice(-40); ctx.historyChanged = true; }
    await admin.from('activity_log').insert({ client_id: w.c.id, user_id: null, action_type: 'email_sent', description: later ? `Scheduled the approved weekly update to ${w.c.email} for ${fmtDayW(cyc.cp.send)} ${fmtTimeW(cyc.cp.send)}.` : `Sent the approved weekly update to ${w.c.email} on schedule.` }).then(() => {}, () => {});
    sent.push(w.c);
  }
  if (sent.length || noEmail.length || failed.length) {
    const approvers = profiles.filter(p => (p.role === 'admin' || p.role === 'approver') && !p.access_revoked);
    const n = sent.length, s = n === 1 ? '' : 's';
    const title = n ? (later ? `${n} update${s} will go out at ${fmtTimeW(cyc.cp.send)}` : `${n} update${s} went out on schedule`) : 'Scheduled updates didn’t go out';
    const body = [sent.length ? sent.map(c => c.name).join(', ') + '.' : '', noEmail.length ? `No email on file: ${noEmail.map(c => c.name).join(', ')}.` : '', failed.length ? `Couldn’t send: ${failed.join(', ')}.` : ''].filter(Boolean).join(' ');
    for (const p of approvers) await notify(admin, p, 'updates_sent', title, body, 'approve');
  }
  return { sent: sent.length, scheduledFor: later ? sendReal.toISOString() : null, noEmail: noEmail.length, failed };
}

async function mondaySummary(admin, ctx) {
  const { cyc, weeks, profiles, settings, history, impsBy, tasks, entries, off, state } = ctx;
  if (cyc.now.getUTCDay() !== 1) return { skipped: true, reason: 'Runs on Mondays.' };
  if (state.monday === cyc.key) return { skipped: true, reason: 'Already sent this week.' };
  const T = Object.assign({}, DEFAULT_SIGNALS, settings.healthSignals || {});
  const lvl = (v, [w, r]) => (v >= r ? 'r' : v >= w ? 'y' : null);
  const lastDue = cyc.prevSend, onTime = [], late = [], missed = [], health = [];
  const monthStart = new Date(Date.UTC(cyc.now.getUTCFullYear(), cyc.now.getUTCMonth(), 1));
  const dim = new Date(Date.UTC(cyc.now.getUTCFullYear(), cyc.now.getUTCMonth() + 1, 0)).getUTCDate();
  for (const w of weeks) {
    const c = w.c;
    if (c.deleted_at) continue;
    const sends = [...(history[c.id] || []), ...ctx.draftsBy(c.id).filter(d => d.draft_sent_at).map(d => d.draft_sent_at)].map(x => toWall(x, off));
    const inWeek = sends.some(t => t > addDaysW(lastDue, -7) && t <= lastDue);
    const lateSend = !inWeek && sends.some(t => t > lastDue && t <= addDaysW(lastDue, 4));
    const hadWork = (impsBy[c.id] || []).some(i => toWall(i.date, off) > addDaysW(lastDue, -14));
    if (inWeek) onTime.push(c); else if (lateSend) late.push(c); else if (hadWork || sends.length) missed.push(c);
    // Client health, the same signals the Health screen uses.
    const sig = [];
    const last = sends.sort((a, b) => b - a)[0];
    if (last) { const n = daysBetweenW(last, cyc.now), l = lvl(n, T.noUpdateDays); if (l) sig.push([l, `no update in ${n} days`]); }
    const lastLog = (impsBy[c.id] || []).map(i => toWall(i.date, off)).sort((a, b) => b - a)[0];
    if (lastLog) { const n = daysBetweenW(lastLog, cyc.now), l = lvl(n, T.nothingLoggedDays); if (l) sig.push([l, `nothing logged in ${n} days`]); }
    const od = tasks.filter(t => t.client_id === c.id && t.status !== 'done' && !t.cancelled_at && t.due_date && t.due_date < cyc.now.toISOString().slice(0, 10)).length;
    const lo = lvl(od, T.overdueTasks); if (lo) sig.push([lo, `${od} tasks overdue`]);
    if (settings.ownerRiskFlag !== false) { const lf = lvl(c.danger || 0, T.ownerFlag); if (lf) sig.push([lf, `risk flagged ${c.danger} of 5`]); }
    if (c.monthly_hour_budget) {
      const used = entries.filter(e => e.client_id === c.id && new Date(e.entry_date + 'T12:00:00Z') >= monthStart).reduce((s, e) => s + (e.minutes || 0), 0) / 60;
      const day = cyc.now.getUTCDate(), projected = used / Math.max(1, day) * dim, pct = projected / c.monthly_hour_budget * 100;
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
  const title = total ? `Last week: ${onTime.length} of ${total} updates went out on time` : 'Your Monday summary';
  const lines = [
    late.length ? `Late: ${late.map(c => c.name).join(', ')}.` : '',
    missed.length ? `Missed: ${missed.map(c => c.name).join(', ')}.` : '',
    risk.length ? `At risk: ${risk.map(h => `${h.c.name} (${h.why})`).join('; ')}.` : '',
    watch.length ? `Worth watching: ${watch.map(h => `${h.c.name} (${h.why})`).join('; ')}.` : '',
    `This week’s updates go out ${DAY_NAMES[cyc.cp.send.getUTCDay()]} at ${fmtTimeW(cyc.cp.send)}; work logged by ${fmtDayW(cyc.cp.log)} ${fmtTimeW(cyc.cp.log)} goes in.`,
  ].filter(Boolean);
  const approvers = profiles.filter(p => (p.role === 'admin' || p.role === 'approver') && !p.access_revoked);
  for (const p of approvers) {
    await notify(admin, p, 'monday_summary', title, lines.slice(0, 3).join(' ') || lines[lines.length - 1], risk.length ? 'health' : 'approve');
    if (p.email && !muted(p, 'monday_summary', 'email')) {
      const appUrl = process.env.APP_URL || '';
      await sendEmail(p.email, title, `${lines.join('\n\n')}\n\n${appUrl ? `Open This Week: ${appUrl}/#approve` : ''}`.trim());
    }
  }
  state.monday = cyc.key;
  return { approvers: approvers.length, onTime: onTime.length, late: late.length, missed: missed.length, atRisk: risk.length, watch: watch.length };
}

// ---- run them -------------------------------------------------------------------------------
async function runUpdateAutomations(admin, settings, opts) {
  const started = (opts && opts.started) || Date.now();
  const sch = Object.assign({}, DEFAULT_SCHEDULE, settings.updatesSchedule || {});
  const automation = Object.assign({}, DEFAULT_AUTOMATION, settings.updatesAutomation || {});
  if (!Object.values(automation).some(Boolean)) return { skipped: true, reason: 'All four are off in Settings → Updates.' };
  const off = wallOffset(settings.timezone || process.env.TEAM_TIMEZONE || 'America/New_York');
  const nowW = toWall(new Date(), off);
  const cyc = cycleAt(nowW, sch);
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
  const weeks = (clients || []).filter(c => !c.deleted_at).map(c => clientWeek(c, impsBy[c.id] || [], draftsBy[c.id] || [], cyc, off));
  const ctx = { cyc, sch, automation, weeks, profiles: profiles || [], settings, state, history, impsBy, draftsBy: id => draftsBy[id] || [], tasks: tasks || [], entries: entries || [], off, started };
  const result = { day: DAY_NAMES[nowW.getUTCDay()], week: cyc.key };
  const run = async (name, fn) => { if (!automation[name]) { result[name] = { skipped: true, reason: 'Off in Settings.' }; return; } try { result[name] = await fn(admin, ctx); } catch (e) { result[name] = { error: String(e) }; } };
  // Send first (it's time-bound), then reminders (which skip what was just sent), then drafts.
  await run('scheduledSend', scheduledSend);
  if (result.scheduledSend && result.scheduledSend.sent) {
    const fresh = (await admin.from('client_drafts').select('*')).data || [];
    const by = {}; fresh.forEach(d => (by[d.client_id] = by[d.client_id] || []).push(d));
    ctx.weeks = (clients || []).filter(c => !c.deleted_at).map(c => clientWeek(c, impsBy[c.id] || [], by[c.id] || [], cyc, off));
    ctx.draftsBy = id => by[id] || [];
  }
  await run('remindBehind', remindBehind);
  await run('mondaySummary', mondaySummary);
  await run('autoDraft', autoDraft);
  // Keep the state small: only this week's and last week's entries matter.
  const keep = new Set([cyc.key, cycleAt(addDaysW(nowW, -7), sch).key]);
  ['drafted'].forEach(k => { if (state[k]) Object.keys(state[k]).forEach(id => { if (!keep.has(state[k][id])) delete state[k][id]; }); });
  if (state.reminded) Object.keys(state.reminded).forEach(id => { if (!keep.has(state.reminded[id].cycle)) delete state.reminded[id]; });
  await putJson(admin, 'automation-state', state);
  if (ctx.historyChanged) await putJson(admin, 'update-history', history);
  return result;
}

module.exports = { runUpdateAutomations, cycleAt, clientWeek, wallOffset, toWall };
