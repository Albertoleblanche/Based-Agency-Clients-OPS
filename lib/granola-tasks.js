// Tasks from Granola meetings (Nov 23).
//
// An admin pastes Granola's workspace API key in Settings → Connections (api/integrations.js,
// provider 'granola'). Radar checks the key, then asks Granola to call it when a meeting's notes
// are ready (a webhook to /hooks/granola, handled in api/send-slack-message.js, which already reads
// raw request bodies for signatures). For each meeting the AI reads the summary and picks out the
// action items for people on the team; each one becomes a suggestion (task_suggestions) for the
// person it's for, who adds it as a task or dismisses it. The daily cron reads anything a webhook
// missed (granolaCatchUp). A meeting is read once: it's claimed with its own app_storage row
// ('granola-note:<id>') before reading, so two deliveries at once can't both make suggestions.
// The key and the webhook's signing secret live in granola_connection, which only the server reads.

const crypto = require('crypto');
const { callOpenAI, OPENAI_MODEL } = require('./ai-client');
const { sendPushToUser, pushUrlFor } = require('./push-notify');

const API = 'https://public-api.granola.ai';
const NOTE_KEY = id => `granola-note:${id}`;
const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com']);
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ---- talking to Granola ---------------------------------------------------------------------------
async function granolaFetch(key, path, init) {
  init = init || {};
  let r;
  try {
    r = await fetch(API + path, { ...init, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  } catch (e) { const err = new Error('Couldn’t reach Granola'); err.status = 0; throw err; }
  const text = await r.text();
  let body = null; try { body = text ? JSON.parse(text) : null; } catch (e) {}
  if (!r.ok) {
    const msg = body && (body.message || body.error || (body.errors && body.errors[0] && body.errors[0].message));
    const err = new Error(typeof msg === 'string' && msg ? msg : `Granola answered ${r.status}`); err.status = r.status; throw err;
  }
  return body;
}

async function getConnection(admin) {
  const { data, error } = await admin.from('granola_connection').select('*').eq('id', 1).maybeSingle();
  if (error) return { error };
  return { conn: data || null };
}

// ---- connecting ----------------------------------------------------------------------------------
// Checks the key, registers the webhook (Business and Enterprise plans have them; without one the
// daily read still works), and saves both. Reading the last few days happens right after.
async function connectGranola(admin, o) {
  const key = String(o.key || '').trim();
  if (!/^grn_\S{8,}$/.test(key)) return { error: 'That doesn’t look like a Granola API key (they start with grn_).' };
  try { await granolaFetch(key, '/v1/notes?page_size=1'); }
  catch (e) { return { error: e.status === 401 || e.status === 403 ? 'Granola didn’t accept that key. Copy it again from Granola → Settings → Connectors → Workspace API keys.' : `Couldn’t check the key: ${e.message}` }; }

  const { conn: old } = await getConnection(admin);
  if (old && old.webhook_id) { try { await granolaFetch(old.api_key, `/v1/webhook-endpoints/${old.webhook_id}`, { method: 'DELETE' }); } catch (e) {} }

  let webhookId = null, secret = null, webhookError = null;
  const appUrl = String(o.appUrl || '').replace(/\/+$/, '');
  if (/^https:\/\//.test(appUrl)) {
    try {
      const w = await granolaFetch(key, '/v1/webhook-endpoints', { method: 'POST', body: JSON.stringify({ url: `${appUrl}/hooks/granola`, scopes: ['workspace'], events: ['note.generated', 'note.access_granted'] }) });
      webhookId = w && w.id || null; secret = w && w.signing_secret || null;
      if (!webhookId || !secret) webhookError = 'Granola didn’t return a webhook';
    } catch (e) { webhookError = e.message; }
  } else webhookError = 'Radar’s address isn’t https, so Granola can’t call it';

  const row = { id: 1, api_key: key, webhook_id: webhookId, webhook_secret: secret, webhook_error: webhookError, connected_at: new Date().toISOString(), connected_by: o.userId || null, last_read_at: null, last_note_at: null, last_error: null };
  const { error } = await admin.from('granola_connection').upsert(row);
  if (error) return { error: /relation|does not exist|schema cache/i.test(error.message) ? 'Run addendum-granola.sql in Supabase first.' : error.message };
  return { ok: true, webhook: !!webhookId, webhookError };
}

async function disconnectGranola(admin) {
  const { conn } = await getConnection(admin);
  if (conn && conn.webhook_id) { try { await granolaFetch(conn.api_key, `/v1/webhook-endpoints/${conn.webhook_id}`, { method: 'DELETE' }); } catch (e) {} }
  await admin.from('granola_connection').delete().eq('id', 1);
  return { ok: true };
}

// What Settings shows: connected or not, the webhook, the last read, and the suggestions made.
async function granolaStatus(admin) {
  const { conn, error } = await getConnection(admin);
  if (error) return { connected: false, needsSql: /relation|does not exist|schema cache/i.test(error.message || '') };
  if (!conn) return { connected: false };
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const { data: rows } = await admin.from('task_suggestions').select('status').eq('source', 'granola').gte('created_at', since);
  const n = (rows || []).length, added = (rows || []).filter(r => r.status === 'added').length;
  return { connected: true, connectedAt: conn.connected_at, webhook: !!conn.webhook_id, webhookError: conn.webhook_error || null,
    lastReadAt: conn.last_read_at, lastNoteAt: conn.last_note_at, lastError: conn.last_error || null, suggested30: n, added30: added };
}

// ---- the webhook ---------------------------------------------------------------------------------
// Granola signs {webhook-id}.{webhook-timestamp}.{body} with HMAC-SHA256; the key is the signing
// secret without "whsec_", base64-decoded. Several "v1,<sig>" entries may come, space-separated.
function verifyGranolaSignature(rawBody, headers, secret, nowSec) {
  const id = headers['webhook-id'], ts = headers['webhook-timestamp'], sig = headers['webhook-signature'];
  if (!id || !ts || !sig || !secret) return false;
  const now = nowSec || Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(ts)) > 5 * 60) return false;
  let keyBytes;
  try { keyBytes = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64'); } catch (e) { return false; }
  const expected = crypto.createHmac('sha256', keyBytes).update(`${id}.${ts}.${rawBody}`, 'utf8').digest();
  return String(sig).split(' ').some(part => {
    const [v, b64] = part.split(',');
    if (v !== 'v1' || !b64) return false;
    let got; try { got = Buffer.from(b64, 'base64'); } catch (e) { return false; }
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  });
}

// Checks the delivery and says what to answer Granola; `work` (when there is some) reads the note.
async function handleGranolaHook(admin, rawBody, headers, opts) {
  const { conn } = await getConnection(admin);
  if (!conn || !conn.webhook_secret) return { status: 200, body: { ignored: 'not connected' } };
  if (!verifyGranolaSignature(rawBody, headers, conn.webhook_secret, opts && opts.nowSec)) return { status: 401, body: { error: 'bad signature' } };
  let ev; try { ev = JSON.parse(rawBody); } catch (e) { return { status: 400, body: { error: 'bad json' } }; }
  if (!ev || !ev.note_id || !['note.generated', 'note.access_granted'].includes(ev.event_type)) return { status: 200, body: { ignored: ev && ev.event_type } };
  return { status: 200, body: { ok: true }, work: readGranolaNote(admin, conn, ev.note_id, opts) };
}

// ---- reading one meeting -------------------------------------------------------------------------
async function claimNote(admin, noteId, title) {
  const { error } = await admin.from('app_storage').insert({ key: NOTE_KEY(noteId), value: JSON.stringify({ at: new Date().toISOString(), title: title || null, state: 'reading' }) });
  return !error;   // another delivery (or an earlier read) has it
}
async function settleNote(admin, noteId, value) {
  await admin.from('app_storage').update({ value: JSON.stringify({ at: new Date().toISOString(), ...value }) }).eq('key', NOTE_KEY(noteId));
}

function emailDomain(e) { const m = String(e || '').toLowerCase().match(/@([^@\s>]+)$/); return m ? m[1] : ''; }
function siteDomain(u) { const m = String(u || '').toLowerCase().match(/^(?:https?:\/\/)?(?:www\.)?([^/\s:]+)/); return m ? m[1] : ''; }

function granolaTaskPrompt(o) {
  return `You read the notes of one meeting at a marketing agency and pick out the action items that people on the agency's team need to do. Reply with JSON only, no other text:
{"items": [{"owner": "exact name from the team list", "title": "...", "notes": "...", "due": "YYYY-MM-DD or empty", "client": "exact client name or empty", "priority": "high or normal", "quote": "..."}]}

The meeting: "${o.title}", ${o.weekday} ${o.date}.
Owner of the notes: ${o.owner || 'unknown'}.
Who was there: ${o.attendees.join(', ') || 'unknown'}.
The agency's team (only these people can get items): ${o.team.join('; ')}.
Clients (pick one only when the item is clearly for it)${o.likelyClient ? `; this meeting looks like it was with ${o.likelyClient}` : ''}: ${o.clients.join('; ') || 'none'}.

Notes:
"""
${o.summary}
"""

Rules:
- Only concrete things a person on the team said they'd do or was asked to do. Leave out what the client or anyone outside the team will do, decisions, ideas, open questions and things already done.
- "owner": the team member who'll do it, exactly as written in the team list. When it's "we" or "the agency" or nobody is named, use ${o.ownerOnTeam ? `"${o.ownerOnTeam}"` : 'the team member it most clearly falls to, or leave the item out'}.
- "title": the work, starting with a verb, under 70 characters, plain words; no people's names and no dates.
- "notes": useful details from the notes in plain text, under 300 characters. Empty when the title says it all.
- "due": only when the notes give a day or date ("by Friday", "next week Tuesday"), worked out from the meeting date. Otherwise empty.
- "priority": "high" only when the notes say it's urgent or needed right away.
- "quote": the short line from the notes the item comes from, under 140 characters.
- At most 12 items. No item twice. When there are none, reply {"items": []}.`;
}
function parseAi(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (e) { return null; }
}

async function readGranolaNote(admin, conn, noteId, opts) {
  opts = opts || {};
  if (!(await claimNote(admin, noteId))) return { skipped: 'already read' };
  let note;
  try { note = await granolaFetch(conn.api_key, `/v1/notes/${encodeURIComponent(noteId)}`); }
  catch (e) {
    // gone or not ready: let the next read try again
    await admin.from('app_storage').delete().eq('key', NOTE_KEY(noteId));
    return { skipped: `couldn’t read it: ${e.message}` };
  }
  const summary = String(note.summary_markdown || note.summary_text || '').trim();
  const title = String(note.title || (note.calendar_event && note.calendar_event.event_title) || 'A meeting').trim();
  if (note.deleted_at || !summary) { await settleNote(admin, noteId, { title, state: 'done', items: 0 }); return { skipped: 'no summary' }; }

  const [{ data: profiles }, { data: clientRows }, { data: settingsRow }] = await Promise.all([
    admin.from('team_profiles').select('id, name, email, access_revoked'),
    admin.from('clients').select('id, name, email, website, status, deleted_at'),
    admin.from('app_storage').select('value').eq('key', 'settings').maybeSingle(),
  ]);
  let settings = {}; try { settings = settingsRow && settingsRow.value ? JSON.parse(settingsRow.value) : {}; } catch (e) {}
  const team = (profiles || []).filter(p => !p.access_revoked && p.name);
  const byEmail = new Map(team.filter(p => p.email).map(p => [p.email.toLowerCase(), p]));
  const teamDomains = new Set(team.map(p => emailDomain(p.email)).filter(Boolean));
  const ev = note.calendar_event || {};
  const people = [...(note.attendees || []), ...((ev.invitees || []).map(x => typeof x === 'string' ? { email: x } : x)), ...(note.owner ? [note.owner] : [])];
  const owner = note.owner && note.owner.email ? byEmail.get(note.owner.email.toLowerCase()) : null;
  const live = (clientRows || []).filter(c => !c.deleted_at);
  // the client: anyone there whose email shares a domain with a client's email or website
  const outside = [...new Set(people.map(p => emailDomain(p.email)).filter(d => d && !teamDomains.has(d) && !FREE_MAIL.has(d)))];
  const likely = live.find(c => outside.some(d => d === emailDomain(c.email) || d === siteDomain(c.website)));
  const when = new Date(ev.scheduled_start_time || note.created_at || Date.now());
  const tz = settings.timezone || process.env.TEAM_TIMEZONE || 'America/New_York';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(when);
  const g = t => (parts.find(x => x.type === t) || {}).value;
  const date = `${g('year')}-${g('month')}-${g('day')}`;
  const weekday = DAY_NAMES[new Date(date + 'T12:00:00Z').getUTCDay()];

  if (!process.env.OPENAI_API_KEY && !opts.ai) { await admin.from('app_storage').delete().eq('key', NOTE_KEY(noteId)); return { skipped: 'no AI key' }; }
  const prompt = granolaTaskPrompt({ title, date, weekday, owner: note.owner && (note.owner.name || note.owner.email),
    attendees: [...new Set(people.map(p => p.name || p.email).filter(Boolean))].slice(0, 30),
    team: team.map(p => `${p.name}${p.email ? ` <${p.email}>` : ''}`), ownerOnTeam: owner && owner.name,
    clients: live.filter(c => c.status !== 'Paused').map(c => c.name).slice(0, 150), likelyClient: likely && likely.name, summary: summary.slice(0, 12000) });
  const r = opts.ai ? await opts.ai(prompt) : await callOpenAI([{ role: 'user', content: prompt }], null, { model: settings.openaiModel || OPENAI_MODEL, webSearch: false });
  const ai = r && r.ok ? parseAi(r.reply) : null;
  if (!ai) { await admin.from('app_storage').delete().eq('key', NOTE_KEY(noteId)); return { skipped: 'AI did not answer' }; }

  const findPerson = n => { const s = String(n || '').trim().toLowerCase(); return s ? team.find(p => p.name.toLowerCase() === s || (p.email || '').toLowerCase() === s) || team.find(p => p.name.toLowerCase().split(' ')[0] === s) : null; };
  const rows = [];
  for (const it of (Array.isArray(ai.items) ? ai.items : []).slice(0, 12)) {
    const t = String(it && it.title || '').trim();
    // "we" or no name → the meeting's owner; a name that isn't on the team (the client's people) → left out
    const ownerTxt = String(it.owner || '').trim().toLowerCase();
    const p = !ownerTxt || /^(we|us|team|the team|the agency|agency|everyone|all|based|based agency)$/.test(ownerTxt) ? owner : findPerson(it.owner);
    if (!t || !p) continue;
    const client = live.find(c => c.name.toLowerCase() === String(it.client || '').trim().toLowerCase()) || likely || null;
    const due = /^\d{4}-\d{2}-\d{2}$/.test(String(it.due || '')) && it.due >= date ? it.due : null;
    if (rows.some(x => x.assignee_id === p.id && x.title.toLowerCase() === t.toLowerCase())) continue;
    rows.push({ assignee_id: p.id, title: t.slice(0, 120), description: String(it.notes || '').trim().slice(0, 600) || null, client_id: client ? client.id : null,
      due_date: due, priority: it.priority === 'high' ? 'high' : 'medium', source: 'granola', source_id: noteId, source_title: title.slice(0, 200),
      source_url: note.web_url || null, source_at: when.toISOString(), quote: String(it.quote || '').trim().slice(0, 200) || null, status: 'pending' });
  }
  let made = [];
  if (rows.length) {
    const { data, error } = await admin.from('task_suggestions').upsert(rows, { onConflict: 'source,source_id,assignee_id,title', ignoreDuplicates: true }).select();
    if (error) { await admin.from('app_storage').delete().eq('key', NOTE_KEY(noteId)); return { skipped: `not saved: ${error.message}` }; }
    made = data || rows;
  }
  // one heads-up per person per meeting
  const per = new Map();
  made.forEach(s => per.set(s.assignee_id, (per.get(s.assignee_id) || 0) + 1));
  for (const [uid, n] of per) {
    const body = `${n === 1 ? 'A task' : `${n} tasks`} from “${title}”. Add or dismiss ${n === 1 ? 'it' : 'them'} in Tasks.`;
    await admin.from('notifications').insert({ user_id: uid, type: 'task_suggested', title: 'Suggested from your meeting', body, target_view: 'tasks', target_id: null }).then(() => {}, () => {});
    try { await sendPushToUser(admin, uid, 'Suggested from your meeting', body, pushUrlFor('tasks', null)); } catch (e) {}
  }
  await settleNote(admin, noteId, { title, state: 'done', items: made.length });
  await admin.from('granola_connection').update({ last_note_at: when.toISOString() }).eq('id', 1).then(() => {}, () => {});
  return { read: title, suggested: made.length, people: [...per.keys()] };
}

// ---- catching up (the daily cron, Read Recent Meetings, and right after connecting) --------------
// Lists meetings since the last read (the last 3 days the first time) and reads any not read yet,
// until the time budget runs out; the rest wait for the next read.
async function granolaCatchUp(admin, opts) {
  opts = opts || {};
  const { conn } = await getConnection(admin);
  if (!conn) return { skipped: 'not connected' };
  const deadline = Date.now() + (opts.budgetMs || 40000);
  // the daily read: since the last one (a day of overlap); Read Now and connecting: the last week,
  // so meetings shared into the team space after the fact are found too
  const back = opts.sinceDays ? Date.now() - opts.sinceDays * 864e5 : conn.last_read_at ? new Date(conn.last_read_at).getTime() - 864e5 : Date.now() - 7 * 864e5;
  const since = new Date(Math.min(Date.now() - 864e5, back)).toISOString();
  let cursor = null, pages = 0, read = 0, suggested = 0, left = 0, error = null;
  try {
    do {
      const q = `/v1/notes?page_size=30&updated_after=${encodeURIComponent(since)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const list = await granolaFetch(conn.api_key, q);
      for (const n of (list && list.notes) || []) {
        if (n.deleted_at) continue;
        const { data: seen } = await admin.from('app_storage').select('key').eq('key', NOTE_KEY(n.id)).maybeSingle();
        if (seen) continue;
        if (Date.now() > deadline) { left++; continue; }
        const r = await readGranolaNote(admin, conn, n.id, opts);
        if (r && r.read) { read++; suggested += r.suggested || 0; }
      }
      cursor = list && list.hasMore ? list.cursor : null;
    } while (cursor && ++pages < 4);
  } catch (e) { error = e.message; }
  await admin.from('granola_connection').update({ last_read_at: new Date().toISOString(), last_error: error }).eq('id', 1);
  // markers older than 45 days aren't needed: Granola won't send those meetings again
  await admin.from('app_storage').delete().like('key', 'granola-note:%').lt('updated_at', new Date(Date.now() - 45 * 864e5).toISOString()).then(() => {}, () => {});
  return { read, suggested, left, error };
}

// Check Granola, from Tasks (anyone on the team): reads the last week now, unless someone read it in
// the last minute (the meetings come in by themselves too; this is a nudge, not a second pipeline).
async function granolaReadNow(admin, opts) {
  opts = opts || {};
  const { conn } = await getConnection(admin);
  if (!conn) return { skipped: 'not connected', read: 0, suggested: 0 };
  const last = conn.last_read_at ? new Date(conn.last_read_at).getTime() : 0;
  if (Date.now() - last < (opts.minGapMs == null ? 60000 : opts.minGapMs)) return { recent: true, read: 0, suggested: 0, lastReadAt: conn.last_read_at };
  return granolaCatchUp(admin, { ...opts, sinceDays: 7 });
}

module.exports = { granolaReadNow, granolaFetch, connectGranola, disconnectGranola, granolaStatus, verifyGranolaSignature, handleGranolaHook, readGranolaNote, granolaCatchUp, granolaTaskPrompt, NOTE_KEY };
