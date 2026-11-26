// Claude's notes on a client (Nov 25): what you're missing, tips to improve, and ideas, written by
// Claude by itself from everything Radar has on the client: meeting notes (Granola), WhatsApp, what
// they asked for by email, tasks, follow-ups, logged work, the weekly update, hours and what they pay
// for. Each note says where it comes from and what to do about it.
//  • When: whenever something new comes in for the client (a meeting note read, a client email read,
//    a client's WhatsApp message), checked by the 5-minute tick (api/integrations.js calendar-tick),
//    at most one read per client an hour and READS_PER_DAY in all; Check Now from the client too.
//  • Who sees them: the client's own people (the app shows them only on clients that are yours).
//  • Off: Settings → AI → Claude's notes on clients (settings.claudeNotes === false).
// Kept in app_storage, client-insights:<client id>.

const { claudeKey, ask, readJson, clip, todayIn, settingsOf, S, claudeAccess, countUse, DAILY_CAP } = require('./claude-radar');
const { clientPlans } = require('./client-plan');

const INS_KEY = id => `client-insights:${id}`;
const STATE_KEY = 'client-insights-state';
const READS_PER_DAY = 150;           // across the agency: a cost ceiling
const MIN_GAP_MS = 60 * 60000;       // one read per client an hour, however busy its WhatsApp is
const ASK_MS = 40000;                // inside the tick's 60 s
const DAY = 864e5;

const SYSTEM = 'You are a sharp account strategist at Based Agency, a marketing agency for home-services businesses (Google Ads, Meta ads, SEO, websites). You read everything the agency has on one client and point out what the team is missing, how to do better for the client, and ideas worth proposing. You are specific, grounded in the facts you were given, and never generic. You always answer by using the tool you’re given, once.';
const FORM = { name: 'client_notes', description: 'Your notes on this client.', input_schema: { type: 'object', required: ['notes'], properties: {
  notes: { type: 'array', maxItems: 6, items: { type: 'object', required: ['kind', 'title', 'why', 'refs', 'action'], properties: {
    kind: { type: 'string', enum: ['missing', 'tip', 'idea'] },
    title: S('The note, under 80 characters.'), why: S('Why, from the facts, with dates or numbers, under 220 characters.'),
    refs: { type: 'array', maxItems: 4, items: S('A [ref] it comes from, like M1, W12, E2, T3, R1, L4.') },
    action: { type: 'string', enum: ['task', 'sprint', 'message', 'claude', 'none'] },
    steps: { type: 'array', maxItems: 5, items: S('A step starting with a verb, under 70 characters.') },
    message: S('For action message: the message to send the client, ready to send. Otherwise "".') } } } } } };

const day = d => d ? new Date(String(d).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';
const hashOf = s => { let h = 0; for (const ch of String(s).toLowerCase().replace(/[^a-z0-9]/g, '')) h = (h * 31 + ch.charCodeAt(0)) | 0; return 'n' + (h >>> 0).toString(36); };
const parse = row => settingsOf(row);

// Everything Radar has on the client, as lines with [refs] for the prompt, and what each ref is
async function clientContext(admin, c, settings, now) {
  const { wallOffset, toWall, clientWeek } = require('./update-automations');
  const tz = settings.timezone || process.env.TEAM_TIMEZONE || 'America/New_York', off = wallOffset(tz), date = todayIn(tz, now);
  const since30 = new Date(now.getTime() - 30 * DAY).toISOString(), since14 = new Date(now.getTime() - 14 * DAY).toISOString(), monthStart = date.slice(0, 8) + '01';
  const safe = p => p.then(r => r, () => ({ data: null }));
  const id = String(c.id);
  const [{ data: notes }, { data: groups }, { data: sg }, { data: tk }, { data: rems }, { data: imps }, { data: drafts }, { data: hist }, { data: time }, { data: profiles }, { data: sigs }, { data: moods }] = await Promise.all([
    safe(admin.from('app_storage').select('key, value, updated_at').like('key', 'granola-note:%').gte('updated_at', new Date(now.getTime() - 45 * DAY).toISOString())),
    safe(admin.from('wa_groups').select('jid, name, client_id').eq('client_id', id)),
    safe(admin.from('task_suggestions').select('*').eq('client_id', id).gte('created_at', since30)),
    safe(admin.from('tasks').select('*').eq('client_id', id)),
    safe(admin.from('client_reminders').select('*').eq('client_id', id)),
    safe(admin.from('client_improvements').select('*').eq('client_id', id).gte('date', since30)),
    safe(admin.from('client_drafts').select('*').eq('client_id', id)),
    safe(admin.from('app_storage').select('value').eq('key', 'update-history').maybeSingle()),
    safe(admin.from('time_entries').select('minutes, user_id, deleted_at').eq('client_id', id).gte('entry_date', monthStart)),
    safe(admin.from('team_profiles').select('id, name')),
    safe(admin.from('wa_signals').select('*').eq('client_id', id).gte('created_at', since30)),
    safe(admin.from('wa_moods').select('*').eq('client_id', id).order('created_at', { ascending: false }).limit(1)),
  ]);
  const nameOf = uid => ((profiles || []).find(p => p.id === uid) || {}).name || 'someone';
  const refs = {}, n = {};
  const ref = (k, ev) => { n[k] = (n[k] || 0) + 1; const r = `${k}${n[k]}`; refs[r] = ev; return `[${r}]`; };
  const L = [];
  const cfv = c.custom_field_values || {};
  const plans = await clientPlans(admin, [c], settings).catch(() => ({}));
  L.push(`# ${c.name}`);
  L.push(`What they pay us for: ${plans[id] ? plans[id].replace(/^[^:]*:\s*/, '') : c.service || 'not set in Radar'}`);
  L.push(`Owner on our team: ${cfv.owner || 'not set'}${cfv.focus ? ' · a Focus client' : ''}${c.start_date ? ` · client since ${day(c.start_date)}` : ''}${c.website ? ` · ${c.website}` : ''}`);
  const used = (time || []).filter(e => !e.deleted_at).reduce((a, e) => a + (Number(e.minutes) || 0), 0) / 60, budget = Number(c.monthly_hour_budget) || 0;
  if (budget) { const dIn = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7), 0)).getUTCDate(), pace = used / Math.max(1, +date.slice(8, 10)) * dIn; L.push(`${ref('H', { kind: 'hours', label: 'Hours this month' })} Hours this month: ${Math.round(used)} of ${budget}, on pace for ${Math.round(pace)}`); }
  // meetings
  const meets = (notes || []).map(r => ({ id: r.key.slice('granola-note:'.length), m: parse(r) })).filter(x => x.m && x.m.summary && x.m.state !== 'removed' && x.m.state !== 'same' && (String(x.m.clientId) === id || String(x.m.metClientId) === id))
    .sort((a, b) => String(b.m.meetingAt || b.m.at || '').localeCompare(String(a.m.meetingAt || a.m.at || ''))).slice(0, 3);
  if (meets.length) {
    L.push('\n## Meetings (Granola notes, newest first)');
    meets.forEach(x => L.push(`${ref('M', { kind: 'meeting', id: x.id, label: `Meeting ${day(x.m.meetingAt || x.m.at)}: ${clip(x.m.title, 60)}` })} "${clip(x.m.title, 80)}", ${day(x.m.meetingAt || x.m.at)}:\n${clip(x.m.summary, 2500)}`));
  }
  // WhatsApp
  const jids = (groups || []).map(g => g.jid);
  if (jids.length) {
    const [{ data: msgs }, { data: wt }] = await Promise.all([
      safe(admin.from('wa_messages').select('wa_msg_id, sender, from_team, text, ts, group_jid').in('group_jid', jids).gte('ts', since14).order('ts', { ascending: false }).limit(60)),
      safe(admin.from('wa_tasks').select('*').in('group_jid', jids).eq('status', 'open')),
    ]);
    const list = (msgs || []).slice().reverse();
    if (list.length) {
      L.push('\n## Their WhatsApp group, last two weeks (oldest first)');
      list.forEach(m => L.push(`${ref('W', { kind: 'whatsapp', id: (groups || []).find(g => g.jid === m.group_jid) ? m.group_jid : null, label: `WhatsApp ${day(m.ts)}` })} ${String(m.ts).slice(5, 16).replace('T', ' ')} ${m.from_team ? 'US' : 'CLIENT'} ${clip(m.sender, 20)}: ${clip(m.text, 300)}`));
    }
    if ((wt || []).length) L.push(`Open WhatsApp requests: ${(wt || []).map(w => `${ref('Q', { kind: 'warequest', id: w.id, label: `WhatsApp request: ${clip(w.title, 50)}` })} ${clip(w.title, 90)} (since ${day(w.first_seen)})`).join('; ')}`);
  }
  if ((moods || []).length) L.push(`How they come across lately: ${moods[0].level}${moods[0].reason ? `, ${clip(moods[0].reason, 120)}` : ''}`);
  if ((sigs || []).length) L.push(`Signals from their WhatsApp: ${(sigs || []).slice(0, 4).map(x => `${x.type}: ${clip(x.summary, 110)}`).join('; ')}`);
  // email requests
  if ((sg || []).length) {
    L.push('\n## What they asked for (read from emails and meetings)');
    (sg || []).slice(0, 10).forEach(s => L.push(`${ref('E', { kind: s.source === 'gmail' ? 'email' : 'meeting', url: s.source_url || null, id: s.source === 'gmail' ? null : s.source_id, label: `${s.source === 'gmail' ? 'Email' : 'Meeting'} ${day(s.source_at || s.created_at)}: ${clip(s.source_title || s.title, 50)}` })} ${clip(s.title, 100)} (${s.status === 'pending' ? 'not acted on yet' : s.status === 'added' ? 'made a task' : 'dismissed'}${s.out_of_scope ? ', outside their plan' : ''})${s.quote ? `: “${clip(s.quote, 120)}”` : ''}`));
  }
  // tasks
  const open = (tk || []).filter(t => !t.deleted_at && !t.cancelled_at && t.status !== 'done');
  const done = (tk || []).filter(t => !t.deleted_at && t.status === 'done' && t.completed_at && t.completed_at >= since30);
  if (open.length || done.length) {
    L.push('\n## Tasks');
    open.slice(0, 12).forEach(t => L.push(`${ref('T', { kind: 'task', id: t.id, label: `Task: ${clip(t.title, 50)}` })} open: ${clip(t.title, 100)} (${nameOf(t.assignee_id)}${t.due_date ? `, due ${day(t.due_date)}${t.due_date < date ? ', late' : ''}` : ''})`));
    if (done.length) L.push(`Done in the last 30 days: ${done.slice(0, 10).map(t => clip(t.title, 60)).join('; ')}`);
  }
  // follow-ups
  const waiting = (rems || []).filter(r => r.status === 'waiting');
  if (waiting.length) { L.push('\n## What they owe us'); waiting.slice(0, 6).forEach(r => L.push(`${ref('R', { kind: 'reminder', id: r.id, label: `Follow-up: ${clip(r.question, 50)}` })} ${clip(r.question, 100)} (asked ${day(r.asked_date)}${r.follow_up_date ? `, follow up ${day(r.follow_up_date)}` : ''})`)); }
  // work and the update
  const live = (imps || []).filter(i => !i.deleted_at).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  L.push('\n## Work logged, last 30 days');
  if (live.length) live.slice(0, 12).forEach(i => L.push(`${ref('L', { kind: 'win', label: `Logged ${day(i.date)}` })} ${day(i.date)}, ${i.author}: ${clip(i.text, 140)}`));
  else L.push('Nothing logged.');
  const w = clientWeek(c, imps || [], drafts || [], hist && hist.value ? parse(hist) : {}, toWall(now, off), off);
  L.push(`${ref('U', { kind: 'update', label: 'Weekly update' })} Weekly update: ${w.sent ? 'sent this week' : w.daysLeft < 0 ? `late by ${-w.daysLeft} days` : w.daysLeft === 0 ? 'due today' : `due in ${w.daysLeft} days`}${w.last ? `, last sent ${day(w.last.toISOString())}` : ', none sent yet'}`);
  return { text: L.join('\n'), refs, date };
}

function notesPrompt(o) {
  return `Today is ${o.date}. Here is everything Radar has on this client, with a [ref] on each item:

${o.text}
${o.before.length ? `\nYou already noted these (don't repeat them unless something changed): ${o.before.map(t => `“${t}”`).join('; ')}` : ''}${o.dismissed.length ? `\nThe team dismissed these (never suggest them again): ${o.dismissed.map(t => `“${t}”`).join('; ')}` : ''}

Use client_notes to give up to 6 notes, the most important first. Only what the facts support; nothing generic.
- missing: something slipping through: a promise or next step from a meeting with no task, a client question in WhatsApp nobody answered, something they asked for not acted on, a follow-up past its day, an update at risk, hours running out, a client going quiet, a task late.
- tip: a concrete way to do better for this client: their results inside what they pay for, or how we work with them.
- idea: something worth proposing to them: a campaign, content, a page, an add-on, based on what they said or what's happening.
For each: why (from the facts, with dates or numbers), the refs it comes from, and the action: task (steps become tasks), sprint (a few days of focused work, with steps), message (write the message to the client in "message", positive and professional, never admitting a mistake or a delay on our side), claude (needs thinking through first), or none. Steps only for task and sprint.`;
}

// One read of a client: Claude's notes, saved
async function readClient(admin, k, c, opts) {
  opts = opts || {};
  const now = opts.now ? new Date(opts.now) : new Date();
  const { data: row } = await admin.from('app_storage').select('value').eq('key', INS_KEY(c.id)).maybeSingle();
  const prev = row ? parse(row) : {};
  const ctx = await clientContext(admin, c, k.settings, now);
  const r = await ask(k, notesPrompt({ date: ctx.date, text: ctx.text, before: (prev.notes || []).map(x => x.title).slice(0, 8), dismissed: (prev.dismissed || []).map(x => x.title).slice(0, 20) }), SYSTEM, 3500, { ...opts, askMs: opts.askMs || ASK_MS }, FORM);
  const { out, error } = readJson(r, o => Array.isArray(o.notes));
  if (error) return { error };
  const gone = new Set((prev.dismissed || []).map(x => x.id));
  const notes = out.notes.map(x => {
    const title = clip(x.title, 120); if (!title) return null;
    const id = hashOf(`${x.kind}|${title}`); if (gone.has(id)) return null;
    const ev = (Array.isArray(x.refs) ? x.refs : []).map(v => ctx.refs[String(v || '').replace(/[\[\]\s]/g, '').toUpperCase()]).filter(Boolean);
    const seen = new Set(); const evidence = ev.filter(e => { const key = e.kind + '|' + (e.id || e.url || e.label); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 4);
    // a message with nothing written is no message
    const action = ['task', 'sprint', 'message', 'claude', 'none'].includes(x.action) && !(x.action === 'message' && !String(x.message || '').trim()) ? x.action : 'none';
    return { id, kind: ['missing', 'tip', 'idea'].includes(x.kind) ? x.kind : 'tip', title, why: clip(x.why, 300), evidence, action,
      steps: action === 'task' || action === 'sprint' ? (Array.isArray(x.steps) ? x.steps : []).map(s => clip(s, 90)).filter(Boolean).slice(0, 5) : [],
      message: action === 'message' ? String(x.message || '').trim().slice(0, 2000) : '' };
  }).filter(Boolean).slice(0, 6);
  const saved = { at: now.toISOString(), reason: opts.reason || 'new', by: opts.by || null, notes, dismissed: (prev.dismissed || []).slice(-40) };
  await admin.from('app_storage').upsert({ key: INS_KEY(c.id), value: JSON.stringify(saved) }, { onConflict: 'key' });
  return saved;
}

// The 5-minute tick: clients with something new since their last read (and none in the last hour),
// newest first, as many as fit in the time left; a client never read yet, one at a time when nothing's new.
async function insightsTick(admin, opts) {
  opts = opts || {};
  const now = opts.now ? new Date(opts.now) : new Date(), deadline = opts.deadline || (Date.now() + 45000);
  const k = await claudeKey(admin);
  if (k.settings.claudeNotes === false) return { skipped: 'off in Settings' };
  if (!k.apiKey) return { skipped: 'Claude isn’t connected' };
  const today = todayIn(k.settings.timezone || process.env.TEAM_TIMEZONE || 'America/New_York', now);
  const { data: st } = await admin.from('app_storage').select('value').eq('key', STATE_KEY).maybeSingle();
  const state = st ? parse(st) : {};
  if (state.date !== today) { state.date = today; state.reads = 0; }
  if (state.reads >= READS_PER_DAY) return { skipped: 'the day’s reads are used' };
  const since = new Date(now.getTime() - 7 * DAY).toISOString(), safe = p => p.then(r => r, () => ({ data: null }));
  const [{ data: cl }, { data: ins }, { data: sg }, { data: gn }, { data: groups }, { data: msgs }, { data: people }, { data: tk }, { data: te }] = await Promise.all([
    admin.from('clients').select('*'),
    safe(admin.from('app_storage').select('key, value').like('key', 'client-insights:%')),
    safe(admin.from('task_suggestions').select('client_id, created_at').gte('created_at', since)),
    safe(admin.from('app_storage').select('key, value, updated_at').like('key', 'granola-note:%').gte('updated_at', since)),
    safe(admin.from('wa_groups').select('jid, client_id')),
    safe(admin.from('wa_messages').select('group_jid, ts, from_team').eq('from_team', false).gte('ts', since).order('ts', { ascending: false }).limit(3000)),
    safe(admin.from('team_profiles').select('id, name, ai_chat_enabled, access_revoked')),
    safe(admin.from('tasks').select('client_id, assignee_id, status')),
    safe(admin.from('time_entries').select('client_id, user_id').gte('entry_date', new Date(now.getTime() - 30 * DAY).toISOString().slice(0, 10))),
  ]);
  // only clients someone with the Assistant on works on: nobody else would see the notes
  const on = (people || []).filter(p => p.ai_chat_enabled && !p.access_revoked), onIds = new Set(on.map(p => p.id)), onNames = new Set(on.map(p => p.name));
  const theirs = new Set([...(tk || []).filter(t => t.status !== 'done' && onIds.has(t.assignee_id)).map(t => String(t.client_id)), ...(te || []).filter(e => onIds.has(e.user_id)).map(e => String(e.client_id))]);
  const live = (cl || []).filter(c => !c.deleted_at && c.status !== 'Paused' && (onNames.has((c.custom_field_values || {}).owner) || theirs.has(String(c.id))));
  const last = {}; (ins || []).forEach(r => { const v = parse(r); last[r.key.slice('client-insights:'.length)] = v.at || null; });
  const newest = {}; const bump = (cid, at) => { const t = at ? new Date(at).getTime() : NaN; if (!cid || !(t > 0)) return; cid = String(cid); if (!newest[cid] || t > newest[cid]) newest[cid] = t; };   // in ms: Postgres and JS write times differently
  (sg || []).forEach(s => bump(s.client_id, s.created_at));
  (gn || []).forEach(r => { const v = parse(r); bump(v.clientId || v.metClientId, r.updated_at); });
  const jc = {}; (groups || []).forEach(g => { if (g.client_id) jc[g.jid] = g.client_id; });
  (msgs || []).forEach(m => bump(jc[m.group_jid], m.ts));
  const due = live.filter(c => { const id = String(c.id), at = last[id] ? new Date(last[id]).getTime() : 0; return newest[id] && (!at || newest[id] > at) && (!at || now - at >= MIN_GAP_MS); })
    .sort((a, b) => (newest[String(b.id)] || 0) - (newest[String(a.id)] || 0));
  if (!due.length) { const never = live.find(c => !last[String(c.id)]); if (never) due.push(never); }
  const done = [], failed = [];
  for (let i = 0; i < due.length && state.reads < READS_PER_DAY; i += 2) {
    if (deadline - Date.now() < ASK_MS + 4000) break;
    await Promise.all(due.slice(i, i + 2).map(async c => {
      state.reads++;
      try { const r = await readClient(admin, k, c, { ...opts, reason: last[String(c.id)] ? 'new' : 'first', askMs: Math.min(ASK_MS, deadline - Date.now() - 3000) }); (r.error ? failed : done).push(c.id); } catch (e) { failed.push(c.id); }
    }));
  }
  await admin.from('app_storage').upsert({ key: STATE_KEY, value: JSON.stringify(state) }, { onConflict: 'key' });
  return { read: done.length, failed: failed.length, waiting: Math.max(0, due.length - done.length - failed.length), readsToday: state.reads };
}

// From the client: Check Now (counts toward the Assistant's 40), and Dismiss
async function checkClientNow(admin, userId, clientId, opts) {
  const acc = await claudeAccess(admin, userId); if (acc.error) return acc;
  if (acc.settings.claudeNotes === false) return { error: 'Claude’s notes on clients are off in Settings → AI.', status: 403 };
  const { data: c } = await admin.from('clients').select('*').eq('id', clientId).maybeSingle();
  if (!c || c.deleted_at) return { error: 'That client isn’t in Radar.', status: 404 };
  const r = await readClient(admin, acc, c, { ...(opts || {}), reason: 'asked', by: userId });
  if (r.error) return { error: r.error, status: 502 };
  await countUse(admin, userId, acc.used);
  return { insights: r, left: DAILY_CAP - acc.used - 1 };
}
async function dismissNote(admin, userId, clientId, noteId) {
  const acc = await claudeAccess(admin, userId, { free: true }); if (acc.error) return acc;
  const { data: row } = await admin.from('app_storage').select('value').eq('key', INS_KEY(clientId)).maybeSingle();
  if (!row) return { error: 'Nothing to dismiss.', status: 404 };
  const v = parse(row), n = (v.notes || []).find(x => x.id === noteId);
  if (!n) return { ok: true, insights: v };
  v.notes = v.notes.filter(x => x.id !== noteId);
  v.dismissed = [...(v.dismissed || []), { id: n.id, title: n.title, by: userId, at: new Date().toISOString() }].slice(-40);
  await admin.from('app_storage').upsert({ key: INS_KEY(clientId), value: JSON.stringify(v) }, { onConflict: 'key' });
  return { ok: true, insights: v };
}

module.exports = { insightsTick, readClient, checkClientNow, dismissNote, notesPrompt, clientContext, INS_KEY, READS_PER_DAY, MIN_GAP_MS };
