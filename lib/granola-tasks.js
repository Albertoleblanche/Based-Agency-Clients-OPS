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
// A meeting removed from Radar (Nov 23): kept for good, so no read (the webhook, Check Granola, the
// daily read, another recording) brings it back. Only Restore does.
const GONE_KEY = id => `granola-removed:${id}`;
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

  const { webhookId, secret, webhookError } = await registerGranolaWebhook(key, o.appUrl);

  const row = { id: 1, api_key: key, webhook_id: webhookId, webhook_secret: secret, webhook_error: webhookError, connected_at: new Date().toISOString(), connected_by: o.userId || null, last_read_at: null, last_note_at: null, last_error: null };
  const { error } = await admin.from('granola_connection').upsert(row);
  if (error) return { error: /relation|does not exist|schema cache/i.test(error.message) ? 'Run addendum-granola.sql in Supabase first.' : error.message };
  return { ok: true, webhook: !!webhookId, webhookError };
}

// The webhook that brings each meeting in as soon as its notes are ready. Granola wants the scope to
// match the key: a workspace key takes exactly ["workspace"]; a member's API key takes "public" (the
// notes shared to the workspace) — "Invalid scopes" from the first means it's the second kind. Radar
// never asks for "personal": someone's private notes stay out of it.
const HOOK_SCOPES = [['workspace'], ['public']];
async function registerGranolaWebhook(key, appUrl) {
  appUrl = String(appUrl || '').replace(/\/+$/, '');
  if (!/^https:\/\//.test(appUrl)) return { webhookId: null, secret: null, webhookError: 'Radar’s address isn’t https, so Granola can’t call it' };
  let last = null;
  for (const scopes of HOOK_SCOPES) {
    try {
      const w = await granolaFetch(key, '/v1/webhook-endpoints', { method: 'POST', body: JSON.stringify({ url: `${appUrl}/hooks/granola`, scopes, events: ['note.generated', 'note.access_granted'] }) });
      if (w && w.id && w.signing_secret) return { webhookId: w.id, secret: w.signing_secret, webhookError: null, scopes };
      last = 'Granola didn’t return a webhook';
    } catch (e) { last = e.message; if (!/scope/i.test(e.message || '')) break; }
  }
  return { webhookId: null, secret: null, webhookError: last || 'Granola didn’t set up the webhook' };
}
// No webhook yet (it failed when connecting): try again on a read, at most every six hours (an admin's
// Read Recent Meetings Now tries at once). No need to connect the key again.
async function ensureGranolaWebhook(admin, conn, appUrl, force) {
  if (!conn || conn.webhook_id || !appUrl) return null;
  if (!force) {
    const { data } = await admin.from('app_storage').select('value').eq('key', 'granola-webhook-try').maybeSingle();
    const at = data ? new Date(parseMark(data.value).at || 0).getTime() : 0;
    if (Date.now() - at < 6 * 3600e3) return null;
  }
  await admin.from('app_storage').upsert({ key: 'granola-webhook-try', value: JSON.stringify({ at: new Date().toISOString() }) }, { onConflict: 'key' });
  const r = await registerGranolaWebhook(conn.api_key, appUrl);
  await admin.from('granola_connection').update({ webhook_id: r.webhookId, webhook_secret: r.secret, webhook_error: r.webhookError }).eq('id', 1);
  Object.assign(conn, { webhook_id: r.webhookId, webhook_secret: r.secret, webhook_error: r.webhookError });
  return r;
}

async function disconnectGranola(admin) {
  const { conn } = await getConnection(admin);
  if (conn && conn.webhook_id) { try { await granolaFetch(conn.api_key, `/v1/webhook-endpoints/${conn.webhook_id}`, { method: 'DELETE' }); } catch (e) {} }
  await admin.from('granola_connection').delete().eq('id', 1);
  return { ok: true };
}

// What Settings shows: connected or not, the webhook, the last read, and the suggestions made.
async function granolaStatus(admin, opts) {
  const { conn, error } = await getConnection(admin);
  // no webhook yet: set it up now (at most every six hours), so meetings come in by themselves
  // without anyone pressing anything (Nov 23)
  if (conn && !conn.webhook_id && opts && opts.appUrl) { try { await ensureGranolaWebhook(admin, conn, opts.appUrl); } catch (e) {} }
  // the table missing is "not set up yet"; any other failure is a hiccup, not "not connected"
  if (error) return /relation|does not exist|schema cache/i.test(error.message || '') ? { connected: false, needsSql: true } : { error: 'Couldn’t read the Granola connection. Try again in a moment.' };
  if (!conn) return { connected: false };
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const { data: rows } = await admin.from('task_suggestions').select('status').eq('source', 'granola').gte('created_at', since);
  const n = (rows || []).length, added = (rows || []).filter(r => r.status === 'added').length;
  return { connected: true, connectedAt: conn.connected_at, webhook: !!conn.webhook_id, webhookError: conn.webhook_error || null,
    lastReadAt: conn.last_read_at, lastNoteAt: conn.last_note_at, lastError: conn.last_error || null, suggested30: n, added30: added,
    meetings: await recentMeetings(admin, opts && opts.viewer) };
}
// The meetings Radar read lately, newest first, and what came of each: for the Granola sheet. A
// viewer who isn't an admin or approver sees only the meetings they were in (Nov 23).
async function recentMeetings(admin, viewer) {
  const { data } = await admin.from('app_storage').select('key, value, updated_at').like('key', 'granola-note:%')
    .gte('updated_at', new Date(Date.now() - 14 * 864e5).toISOString()).order('updated_at', { ascending: false }).limit(40);
  const all = !viewer || viewer.role === 'admin' || viewer.role === 'approver', email = String((viewer && viewer.email) || '').toLowerCase();
  return (data || []).map(r => ({ r, m: parseMark(r.value) })).filter(({ m }) => all || (!!email && (m.people || []).includes(email))).map(({ r, m }) => {
    return { id: r.key.slice('granola-note:'.length), title: m.title || 'A meeting', state: m.state || 'done', items: m.items || 0, away: m.away || [], removedBy: m.removedBy || null,
      why: m.why || (!m.v && m.state === 'done' && !m.items ? 'it’ll be read again on the next check' : null), url: m.url || null, meetingAt: m.meetingAt || null, at: m.at || r.updated_at };
  }).sort((a, b) => String(b.meetingAt || b.at).localeCompare(String(a.meetingAt || a.at))).slice(0, 15);
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
// What Radar knows about a meeting is kept in app_storage under granola-note:<id> (v 2, Nov 23):
// { at, v, state: 'reading' | 'waiting' | 'done' | 'same', title, items, why, url, meetingAt,
// noteUpdatedAt }. "waiting" is a meeting whose notes Granola hadn't written yet: it's read again
// when they are (the webhook, or the next read once the note has changed). Before v 2 such a meeting
// was marked done with nothing found and never looked at again.
function parseMark(v) { try { return JSON.parse(v) || {}; } catch (e) { return {}; } }
const STUCK_MS = 10 * 60000;
function mayReadAgain(m, opts) {
  if (m.state === 'removed') return false;                               // removed from Radar: only Restore brings it back
  if (opts && opts.again) return true;                                   // Read Again, by hand
  if (m.state === 'waiting') return true;                                // its notes weren't written yet
  if (!m.v && m.state === 'done' && !m.items) return true;               // read before v 2 with nothing found: once more
  if (m.state === 'reading' && Date.now() - new Date(m.at || 0).getTime() > STUCK_MS) return true;   // a read that never finished
  return false;
}
async function claimNote(admin, noteId, opts) {
  const key = NOTE_KEY(noteId), fresh = JSON.stringify({ at: new Date().toISOString(), v: 2, state: 'reading' });
  const { error } = await admin.from('app_storage').insert({ key, value: fresh });
  if (!error) return true;
  const { data } = await admin.from('app_storage').select('value').eq('key', key).maybeSingle();
  if (!data || !mayReadAgain(parseMark(data.value), opts)) return false;   // another delivery (or an earlier read) has it
  // take it over, only if nobody else did in the meantime (the value is still the one read)
  const { data: took } = await admin.from('app_storage').update({ value: fresh }).eq('key', key).eq('value', data.value).select('key');
  return !!(took && took.length);
}
// One calendar meeting: its event id and day (a recurring meeting's instances share an id).
function meetingKey(ev) {
  if (!ev) return null;
  const id = ev.calendar_event_id || ev.event_id || ev.id;
  const day = String(ev.scheduled_start_time || ev.start_time || '').slice(0, 10);
  return id && day ? `granola-event:${id}:${day}` : null;
}
// The first note read for a meeting speaks for it; reading that same note again keeps it.
async function claimMeeting(admin, key, noteId, title) {
  const { error } = await admin.from('app_storage').insert({ key, value: JSON.stringify({ at: new Date().toISOString(), note: noteId, title }) });
  if (!error) return true;
  const { data } = await admin.from('app_storage').select('value').eq('key', key).maybeSingle();
  return !!data && parseMark(data.value).note === noteId;
}
async function settleNote(admin, noteId, value) {
  await admin.from('app_storage').update({ value: JSON.stringify({ at: new Date().toISOString(), v: 2, ...value }) }).eq('key', NOTE_KEY(noteId));
}
// Nearly the same task ("Send Vee's Facebook email to Charlie" / "Send Charlie Vee's Facebook email"):
// most of the words in common, or one inside the other. Reading a meeting again doesn't suggest it twice.
const TITLE_SKIP = new Set(['the', 'and', 'for', 'with', 'from', 'about', 'into', 'their', 'this', 'that', 'once']);
function titleWords(t) { return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length > 2 && !TITLE_SKIP.has(w)); }
function sameTask(a, b) {
  const x = String(a || '').toLowerCase().trim(), y = String(b || '').toLowerCase().trim();
  if (!x || !y) return false;
  if (x === y || (Math.min(x.length, y.length) >= 12 && (x.includes(y) || y.includes(x)))) return true;
  const p = new Set(titleWords(x)), q = new Set(titleWords(y));
  if (!p.size || !q.size) return false;
  let both = 0; p.forEach(w => { if (q.has(w)) both++; });
  return both / (p.size + q.size - both) >= 0.6;
}

function emailDomain(e) { const m = String(e || '').toLowerCase().match(/@([^@\s>]+)$/); return m ? m[1] : ''; }
function siteDomain(u) { const m = String(u || '').toLowerCase().match(/^(?:https?:\/\/)?(?:www\.)?([^/\s:]+)/); return m ? m[1] : ''; }
// How long the meeting was booked for (minutes), from its calendar event
function meetingMinutes(ev) {
  if (!ev || !ev.scheduled_start_time || !ev.scheduled_end_time) return null;
  const n = Math.round((new Date(ev.scheduled_end_time) - new Date(ev.scheduled_start_time)) / 60000);
  return n > 0 && n <= 600 ? n : null;
}
// When the team last met each client (Nov 23): the newest meeting with someone from that client's
// side (their email's domain is the client's email or website), for Health and the client's page.
// Only dates, so everyone on the team can read it (app_storage granola-last-met).
const LAST_MET_KEY = 'granola-last-met';
async function noteLastMet(admin, pairs, opts) {
  const fresh = (pairs || []).filter(([c, t]) => c && t && !isNaN(new Date(t)));
  if (!fresh.length && !(opts && opts.only)) return;
  const { data } = await admin.from('app_storage').select('value').eq('key', LAST_MET_KEY).maybeSingle();
  const map = data ? parseMark(data.value) : {};
  let changed = false;
  if (opts && opts.only) { const best = fresh.filter(([c]) => String(c) === String(opts.only)).map(([, t]) => t).sort().pop(); if (best) map[opts.only] = new Date(best).toISOString(); else delete map[opts.only]; changed = true; }
  else for (const [c, t] of fresh) { const iso = new Date(t).toISOString(); if (!map[c] || iso > map[c]) { map[c] = iso; changed = true; } }
  if (changed || !data) await admin.from('app_storage').upsert({ key: LAST_MET_KEY, value: JSON.stringify(map) }, { onConflict: 'key' });
}
// The client a meeting was with, from who was there (for meetings read before this was kept)
function metClientOf(m, liveClients, teamDomains) {
  if (m.metClientId !== undefined) return m.metClientId;
  const outside = [...new Set((m.people || []).map(emailDomain).filter(d => d && !teamDomains.has(d) && !FREE_MAIL.has(d)))];
  const c = liveClients.find(x => outside.some(d => d === emailDomain(x.email) || d === siteDomain(x.website)));
  return c ? c.id : null;
}
// Every meeting Radar has, again: the newest per client (all of them, or one when a meeting is removed)
async function refreshLastMet(admin, onlyClient) {
  const [{ data: rows }, { data: cl }, { data: team }] = await Promise.all([
    admin.from('app_storage').select('key, value').like('key', 'granola-note:%').limit(1000),
    admin.from('clients').select('id, email, website, deleted_at'),
    admin.from('team_profiles').select('email'),
  ]);
  const live = (cl || []).filter(c => !c.deleted_at), teamDomains = new Set((team || []).map(p => emailDomain(p.email)).filter(Boolean));
  const pairs = (rows || []).map(r => parseMark(r.value)).filter(m => m.state === 'done' && m.meetingAt)
    .map(m => [metClientOf(m, live, teamDomains), m.meetingAt]).filter(([c]) => c);
  await noteLastMet(admin, pairs, onlyClient ? { only: onlyClient } : null);
}

function granolaTaskPrompt(o) {
  return `You read the notes of one meeting at a marketing agency and pick out the action items that people on the agency's team need to do. Reply with JSON only, no other text:
{"items": [{"owner": "exact name from the team list", "title": "...", "notes": "...", "due": "YYYY-MM-DD or empty", "client": "exact client name or empty", "priority": "high or normal", "quote": "..."}]${o.likelyClient ? ', "waiting": [{"what": "...", "due": "YYYY-MM-DD or empty", "asker": "exact name from the team list, or empty"}]' : ''}}

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
- Look through all of the notes, not only a "Next steps" list: a commitment in the middle ("Albert to handle the redesign once access is granted") counts. When it waits on something, keep it and say what it waits on in "notes".
- "owner": the team member who'll do it, exactly as written in the team list. When it's "we" or "the agency" or nobody is named, use ${o.ownerOnTeam ? `"${o.ownerOnTeam}"` : 'the team member it most clearly falls to, or leave the item out'}.
- "title": the work, starting with a verb, under 70 characters, plain words; no people's names and no dates.
- "notes": useful details from the notes in plain text, under 300 characters. Empty when the title says it all.
- "due": only when the notes give a day or date ("by Friday", "next week Tuesday"), worked out from the meeting date. Otherwise empty.
- "priority": "high" only when the notes say it's urgent or needed right away.
- "quote": the short line from the notes the item comes from, under 140 characters.
- At most 12 items. No item twice. When there are none, reply {"items": []}.${o.likelyClient ? `
- "waiting": what ${o.likelyClient} (the client's side, not the agency's team) said they'd send or do for the agency ("they'll send 5 project photos by Friday"), so the agency can follow up. "what": the thing to get from them, starting with a verb, under 100 characters ("Send 5 recent project photos"). "due": the day they gave, worked out from the meeting date, else empty. "asker": the team member waiting on it, exactly as in the team list, else empty. At most 6; empty when they promised nothing.` : ''}`;
}
function parseAi(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (e) { return null; }
}

async function readGranolaNote(admin, conn, noteId, opts) {
  opts = opts || {};
  const { data: gone } = await admin.from('app_storage').select('key').eq('key', GONE_KEY(noteId)).maybeSingle();
  if (gone) return { skipped: 'removed from Radar' };
  if (!(await claimNote(admin, noteId, opts))) return { skipped: 'already read' };
  let note;
  try { note = await granolaFetch(conn.api_key, `/v1/notes/${encodeURIComponent(noteId)}`); }
  catch (e) {
    // gone or not ready: let the next read try again
    await admin.from('app_storage').delete().eq('key', NOTE_KEY(noteId));
    return { skipped: `couldn’t read it: ${e.message}` };
  }
  const summary = String(note.summary_markdown || note.summary_text || '').trim();
  const title = String(note.title || (note.calendar_event && note.calendar_event.event_title) || 'A meeting').trim();
  const known = { title, url: note.web_url || null, meetingAt: (note.calendar_event && note.calendar_event.scheduled_start_time) || note.created_at || null, minutes: meetingMinutes(note.calendar_event) };
  if (note.deleted_at) { await settleNote(admin, noteId, { ...known, state: 'done', items: 0, why: 'deleted in Granola' }); return { skipped: 'deleted' }; }
  // Granola is still writing the notes (the meeting is on, or just ended): read it when they're done
  if (!summary) { await settleNote(admin, noteId, { ...known, state: 'waiting', items: 0, why: 'notes not written yet', noteUpdatedAt: note.updated_at || null }); return { skipped: 'no summary yet', waiting: true }; }
  // Two people recording the same calendar meeting make two notes: the first one read speaks for it.
  const evKey = opts.again ? null : meetingKey(note.calendar_event);
  if (evKey && !(await claimMeeting(admin, evKey, noteId, title))) { await settleNote(admin, noteId, { ...known, state: 'same', items: 0, why: 'another recording of the same meeting was read' }); return { skipped: 'same meeting, another recording' }; }

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
  const emails = [...new Set(people.map(p => String(p.email || '').toLowerCase()).filter(Boolean))].slice(0, 60);
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

  if (!process.env.OPENAI_API_KEY && !opts.ai) { await admin.from('app_storage').delete().eq('key', NOTE_KEY(noteId)); if (evKey) await admin.from('app_storage').delete().eq('key', evKey); return { skipped: 'no AI key' }; }
  const prompt = granolaTaskPrompt({ title, date, weekday, owner: note.owner && (note.owner.name || note.owner.email),
    attendees: [...new Set(people.map(p => p.name || p.email).filter(Boolean))].slice(0, 30),
    team: team.map(p => `${p.name}${p.email ? ` <${p.email}>` : ''}`), ownerOnTeam: owner && owner.name,
    clients: live.filter(c => c.status !== 'Paused').map(c => c.name).slice(0, 150), likelyClient: likely && likely.name, summary: summary.slice(0, 12000) });
  const r = opts.ai ? await opts.ai(prompt) : await callOpenAI([{ role: 'user', content: prompt }], null, { model: settings.openaiModel || OPENAI_MODEL, webSearch: false });
  const ai = r && r.ok ? parseAi(r.reply) : null;
  const release = async () => { await admin.from('app_storage').delete().eq('key', NOTE_KEY(noteId)); if (evKey) await admin.from('app_storage').delete().eq('key', evKey); };
  if (!ai) { await release(); return { skipped: 'AI did not answer' }; }

  const findPerson = n => { const s = String(n || '').trim().toLowerCase(); return s ? team.find(p => p.name.toLowerCase() === s || (p.email || '').toLowerCase() === s) || team.find(p => p.name.toLowerCase().split(' ')[0] === s) : null; };
  // what was suggested lately, so a meeting read again (or a second recording) doesn't suggest the same thing twice
  const { data: lately } = await admin.from('task_suggestions').select('assignee_id, title').gte('created_at', new Date(Date.now() - 21 * 864e5).toISOString()).limit(1000);
  const found = Array.isArray(ai.items) ? ai.items : [], notOnTeam = new Set();
  let already = 0;
  const rows = [];
  for (const it of found.slice(0, 12)) {
    const t = String(it && it.title || '').trim();
    // "we" or no name → the meeting's owner; a name that isn't on the team (the client's people) → left out
    const ownerTxt = String(it.owner || '').trim().toLowerCase();
    const p = !ownerTxt || /^(we|us|team|the team|the agency|agency|everyone|all|based|based agency)$/.test(ownerTxt) ? owner : findPerson(it.owner);
    if (t && !p && ownerTxt) notOnTeam.add(String(it.owner).trim());
    if (!t || !p) continue;
    if ((lately || []).some(x => x.assignee_id === p.id && sameTask(x.title, t))) { already++; continue; }
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
    if (error) { await release(); return { skipped: `not saved: ${error.message}` }; }
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
  // why nothing came of it (and who it was for when that's someone Radar doesn't have)
  const away = [...notOnTeam].slice(0, 4), names = away.join(', ');
  const why = made.length ? null : !found.length ? 'no action items for the team in the notes'
    : already && away.length ? `${already === 1 ? 'one was' : `${already} were`} already suggested, the rest for people not in Radar (${names})`
    : already ? 'its action items were already suggested'
    : away.length ? `its action items were for people not in Radar (${names})` : 'no action items for the team in the notes';
  // what the client said they'd do: follow-ups for the person waiting on it (Nov 23)
  let followUps = [];
  if (likely && Array.isArray(ai.waiting) && ai.waiting.length) {
    try { followUps = await makeClientFollowUps(admin, { waiting: ai.waiting, client: likely, owner, findPerson, title, date, today: new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) }); } catch (e) {}
  }
  // the meeting's client for Notes: the one most of its tasks are for, else the one its guests came from
  const tally = {}; rows.forEach(r => { if (r.client_id) tally[r.client_id] = (tally[r.client_id] || 0) + 1; });
  const mainClient = Object.keys(tally).sort((x, y) => tally[y] - tally[x])[0] || (likely ? likely.id : null);
  await settleNote(admin, noteId, { ...known, state: 'done', items: made.length, found: found.length, away, why,
    summary: summary.slice(0, 12000), people: emails, clientId: mainClient, metClientId: likely ? likely.id : null, owner: (note.owner && (note.owner.name || note.owner.email)) || null, followUps });
  if (likely && known.meetingAt) await noteLastMet(admin, [[likely.id, known.meetingAt]]).catch(() => {});
  await admin.from('granola_connection').update({ last_note_at: when.toISOString() }).eq('id', 1).then(() => {}, () => {});
  return { read: title, suggested: made.length, people: [...per.keys()] };
}

// ---- catching up (the daily cron, Read Recent Meetings, and right after connecting) --------------
// Lists meetings since the last read (the last 3 days the first time) and reads any not read yet,
// until the time budget runs out; the rest wait for the next read.
async function granolaCatchUp(admin, opts) {
  opts = opts || {};
  const { conn, error: connError } = await getConnection(admin);
  if (connError) return { error: 'Couldn’t read the Granola connection. Try again in a moment.', read: 0, suggested: 0 };
  if (!conn) return { skipped: 'not connected' };
  if (opts.appUrl) { try { await ensureGranolaWebhook(admin, conn, opts.appUrl, opts.forceHook); } catch (e) {} }
  const deadline = Date.now() + (opts.budgetMs || 40000);
  // the daily read: since the last one (a day of overlap); Read Now and connecting: the last week,
  // so meetings shared into the team space after the fact are found too
  const back = opts.sinceDays ? Date.now() - opts.sinceDays * 864e5 : conn.last_read_at ? new Date(conn.last_read_at).getTime() - 864e5 : Date.now() - 7 * 864e5;
  const since = new Date(Math.min(Date.now() - 864e5, back)).toISOString();
  let cursor = null, pages = 0, read = 0, suggested = 0, left = 0, waiting = 0, error = null;
  try {
    do {
      const q = `/v1/notes?page_size=30&updated_after=${encodeURIComponent(since)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const list = await granolaFetch(conn.api_key, q);
      const notes = ((list && list.notes) || []).filter(n => n && n.id && !n.deleted_at);
      const { data: marks } = notes.length ? await admin.from('app_storage').select('key, value').in('key', notes.map(n => NOTE_KEY(n.id))) : { data: [] };
      const markOf = new Map((marks || []).map(m => [m.key, parseMark(m.value)]));
      for (const n of notes) {
        const m = markOf.get(NOTE_KEY(n.id));
        if (m && m.state === 'done' && !m.summary && !dueAgain(m, n) && Date.now() < deadline) { await fillNoteFacts(admin, conn, n.id, m); continue; }
        if (m && !dueAgain(m, n)) { if (m.state === 'waiting') waiting++; continue; }
        if (Date.now() > deadline) { left++; continue; }
        const r = await readGranolaNote(admin, conn, n.id, opts);
        if (r && r.read) { read++; suggested += r.suggested || 0; }
        if (r && r.waiting) waiting++;
      }
      cursor = list && list.hasMore ? list.cursor : null;
    } while (cursor && ++pages < 4);
  } catch (e) { error = e.message; }
  await admin.from('granola_connection').update({ last_read_at: new Date().toISOString(), last_error: error }).eq('id', 1);
  // the first time (Nov 23): when the team last met each client, from every meeting already read
  try { const { data: lm } = await admin.from('app_storage').select('key').eq('key', LAST_MET_KEY).maybeSingle(); if (!lm) await refreshLastMet(admin); } catch (e) {}
  // markers older than 45 days aren't needed: Granola won't send those meetings again
  await admin.from('app_storage').delete().like('key', 'granola-note:%').lt('updated_at', new Date(Date.now() - 45 * 864e5).toISOString()).then(() => {}, () => {});
  await admin.from('app_storage').delete().like('key', 'granola-event:%').lt('updated_at', new Date(Date.now() - 45 * 864e5).toISOString()).then(() => {}, () => {});
  await admin.from('app_storage').delete().like('key', 'granola-removed:%').lt('updated_at', new Date(Date.now() - 400 * 864e5).toISOString()).then(() => {}, () => {});
  return { read, suggested, left, waiting, error };
}
// A meeting read before its notes were kept (Nov 23): its notes, who was there and its client, from
// Granola, without reading it again for tasks.
let factsClients = null;
async function fillNoteFacts(admin, conn, noteId, m) {
  let note;
  try { note = await granolaFetch(conn.api_key, `/v1/notes/${encodeURIComponent(noteId)}`); } catch (e) { return; }
  const summary = String(note.summary_markdown || note.summary_text || '').trim();
  if (!summary) return;
  if (!factsClients) { const { data } = await admin.from('clients').select('id, email, website, deleted_at'); factsClients = (data || []).filter(c => !c.deleted_at); }
  const { data: team } = await admin.from('team_profiles').select('email');
  const teamDomains = new Set((team || []).map(p => emailDomain(p.email)).filter(Boolean));
  const ev = note.calendar_event || {};
  const people = [...(note.attendees || []), ...((ev.invitees || []).map(x => typeof x === 'string' ? { email: x } : x)), ...(note.owner ? [note.owner] : [])];
  const outside = [...new Set(people.map(p => emailDomain(p.email)).filter(d => d && !teamDomains.has(d) && !FREE_MAIL.has(d)))];
  const likely = factsClients.find(c => outside.some(d => d === emailDomain(c.email) || d === siteDomain(c.website)));
  const { data: sg } = await admin.from('task_suggestions').select('client_id').eq('source', 'granola').eq('source_id', noteId);
  const tally = {}; (sg || []).forEach(r => { if (r.client_id) tally[r.client_id] = (tally[r.client_id] || 0) + 1; });
  const facts = { summary: summary.slice(0, 12000), people: [...new Set(people.map(p => String(p.email || '').toLowerCase()).filter(Boolean))].slice(0, 60),
    clientId: Object.keys(tally).sort((x, y) => tally[y] - tally[x])[0] || (likely ? likely.id : null), owner: (note.owner && (note.owner.name || note.owner.email)) || null,
    title: m.title || note.title || null, url: m.url || note.web_url || null, meetingAt: m.meetingAt || ev.scheduled_start_time || note.created_at || null,
    minutes: meetingMinutes(ev), metClientId: likely ? likely.id : null };
  await admin.from('app_storage').update({ value: JSON.stringify({ ...m, ...facts }) }).eq('key', NOTE_KEY(noteId));
  if (likely && facts.meetingAt) await noteLastMet(admin, [[likely.id, facts.meetingAt]]).catch(() => {});
}

// A meeting read before: worth reading again now? One still being written, once the note has changed
// since (or after a while, when the list doesn't say); one read before v 2 that found nothing; a read
// that never finished.
function dueAgain(m, n) {
  if (m.state === 'waiting') {
    const changed = n.updated_at && m.noteUpdatedAt ? new Date(n.updated_at) > new Date(m.noteUpdatedAt) : false;
    return changed || Date.now() - new Date(m.at || 0).getTime() > STUCK_MS;
  }
  return mayReadAgain(m, null);
}

// Check Granola, from Tasks (anyone on the team): reads the last week now, unless someone read it in
// the last minute (the meetings come in by themselves too; this is a nudge, not a second pipeline).
async function granolaReadNow(admin, opts) {
  opts = opts || {};
  const { conn, error } = await getConnection(admin);
  if (error) return { error: 'Couldn’t read the Granola connection. Try again in a moment.', read: 0, suggested: 0 };
  if (!conn) return { skipped: 'not connected', read: 0, suggested: 0 };
  const last = conn.last_read_at ? new Date(conn.last_read_at).getTime() : 0;
  if (Date.now() - last < (opts.minGapMs == null ? 60000 : opts.minGapMs)) return { recent: true, read: 0, suggested: 0, lastReadAt: conn.last_read_at };
  return granolaCatchUp(admin, { ...opts, sinceDays: 7 });
}

// Read Again (Settings → Granola, admins): one meeting read now, whatever happened before. What it
// already suggested isn't suggested again.
async function granolaReadAgain(admin, noteRef) {
  const { conn, error } = await getConnection(admin);
  if (error) return { error: 'Couldn’t read the Granola connection. Try again in a moment.' };
  if (!conn) return { error: 'Granola isn’t connected.' };
  const id = String(noteRef || '').trim().match(/(not_[A-Za-z0-9]+)/);
  if (!id) return { error: 'That isn’t a meeting Radar has read.' };
  const r = await readGranolaNote(admin, conn, id[1], { again: true });
  const { data } = await admin.from('app_storage').select('value').eq('key', NOTE_KEY(id[1])).maybeSingle();
  const m = data ? parseMark(data.value) : {};
  return { read: !!(r && r.read), suggested: (r && r.suggested) || 0, waiting: !!(r && r.waiting), skipped: r && !r.read ? r.skipped : null, why: m.why || null, title: m.title || null };
}

// ---- one meeting, for the people who can see it (Nov 23) -----------------------------------------
// Who can see a meeting: the people who were in it (their email in "people"), admins and approvers.
function canSeeMeeting(m, viewer) {
  if (!viewer) return false;
  if (viewer.role === 'admin' || viewer.role === 'approver') return true;
  const e = String(viewer.email || '').toLowerCase();
  return !!e && (m.people || []).includes(e);
}
async function meetingFor(admin, noteRef, viewer) {
  const id = String(noteRef || '').match(/(not_[A-Za-z0-9]+)/);
  if (!id) return { error: 'That isn’t a meeting Radar has read.', status: 400 };
  const { data } = await admin.from('app_storage').select('value').eq('key', NOTE_KEY(id[1])).maybeSingle();
  if (!data) return { error: 'That meeting isn’t in Radar.', status: 404 };
  const m = parseMark(data.value);
  if (!canSeeMeeting(m, viewer)) return { error: 'Only the people who were in this meeting, admins and approvers can do that.', status: 403 };
  return { id: id[1], m };
}

// Remove from Radar: gone for everyone, and no read brings it back. Its suggestions still waiting go
// with it (dismissed); tasks already made from it stay. Restore undoes both.
async function removeGranolaMeeting(admin, noteRef, viewer) {
  const f = await meetingFor(admin, noteRef, viewer); if (f.error) return f;
  const { id, m } = f, now = new Date().toISOString();
  if (m.state === 'removed') return { removed: true, already: true, title: m.title || null };
  const { data: sg } = await admin.from('task_suggestions').update({ status: 'dismissed', decided_at: now })
    .eq('source', 'granola').eq('source_id', id).eq('status', 'pending').select('id');
  const dismissed = (sg || []).map(r => r.id);
  await admin.from('app_storage').update({ value: JSON.stringify({ ...m, state: 'removed', was: m.state || 'done', removedAt: now,
    removedBy: viewer.name || viewer.email || null, removedById: viewer.id || null, dismissed }) }).eq('key', NOTE_KEY(id));
  await admin.from('app_storage').upsert({ key: GONE_KEY(id), value: JSON.stringify({ at: now, by: viewer.id || null, title: m.title || null }) }, { onConflict: 'key' });
  if (m.metClientId) await refreshLastMet(admin, m.metClientId).catch(() => {});
  return { removed: true, dismissed: dismissed.length, title: m.title || null };
}
async function restoreGranolaMeeting(admin, noteRef, viewer) {
  const f = await meetingFor(admin, noteRef, viewer); if (f.error) return f;
  const { id, m } = f;
  await admin.from('app_storage').delete().eq('key', GONE_KEY(id));
  if (m.state !== 'removed') return { restored: true, already: true, title: m.title || null };
  const { was, removedAt, removedBy, removedById, dismissed, ...rest } = m;
  await admin.from('app_storage').update({ value: JSON.stringify({ ...rest, state: was || 'done' }) }).eq('key', NOTE_KEY(id));
  let back = 0;
  if ((dismissed || []).length) {
    const { data } = await admin.from('task_suggestions').update({ status: 'pending', decided_at: null }).in('id', dismissed).eq('status', 'dismissed').select('id');
    back = (data || []).length;
  }
  if (m.metClientId) await refreshLastMet(admin, m.metClientId).catch(() => {});
  return { restored: true, suggestions: back, title: m.title || null };
}

// Pull the tasks (the AI button in a meeting's notes): the team's tasks in the notes, grouped by
// client or topic, so nobody has to read the whole thing. Kept with the meeting until its notes change.
function pullPrompt(o) {
  return `You read the notes of one meeting at a marketing agency and pull out the tasks people on the agency's team need to do, grouped so they can be taken in at a glance. Reply with JSON only, no other text:
{"groups": [{"label": "...", "items": [{"title": "...", "who": "exact name from the team list, or empty", "due": "YYYY-MM-DD or empty", "why": "...", "point": "..."}]}]}

The meeting: "${o.title}", ${o.weekday} ${o.date}.
Owner of the notes: ${o.owner || 'unknown'}.
The agency's team: ${o.team.join('; ')}.
Clients: ${o.clients.join('; ') || 'none'}.

Notes:
"""
${o.summary}
"""

Rules:
- Only concrete things someone on the team will do or was asked to do. Leave out what the client or anyone outside the team will do, decisions, ideas, open questions and things already done.
- Look through all of the notes, not only a "Next steps" list.
- "who": the team member who'll do it, exactly as written in the team list. When it's "we" or nobody is named, use ${o.ownerOnTeam ? `"${o.ownerOnTeam}"` : 'the team member it most clearly falls to, or leave it empty'}.
- "title": the work, starting with a verb, under 70 characters, plain words; no people's names and no dates.
- "why": one short line of context from the notes (what it's for, or what it waits on), under 120 characters. Empty when the title says it all.
- "due": only when the notes give a day or date ("by Friday"), worked out from the meeting date. Otherwise empty.
- "point": the line in the notes the task comes from, copied word for word without the leading dash or ** marks, under 200 characters.
- "label": the client's name exactly as in the client list when the tasks are for a client; otherwise a short topic of one to three words ("Internal", "Website", "Hiring"). At most 6 groups, the most important first. Each task once.
- At most 20 tasks. When there are none, reply {"groups": []}.`;
}
async function pullMeetingTasks(admin, noteRef, viewer, opts) {
  opts = opts || {};
  const f = await meetingFor(admin, noteRef, viewer); if (f.error) return f;
  const { id, m } = f;
  if (!m.summary || m.state === 'removed') return { error: 'This meeting’s notes aren’t in Radar.', status: 404 };
  const sum = crypto.createHash('sha1').update(m.summary).digest('hex').slice(0, 12);
  const cached = m.pulled && m.pulled.sum === sum ? m.pulled : null;
  // the same notes: the same answer (Pull Again at most every 30 seconds)
  if (cached && (!opts.again || Date.now() - new Date(cached.at).getTime() < 30000)) return { groups: cached.groups, at: cached.at, cached: true };
  if (!process.env.OPENAI_API_KEY && !opts.ai) return { error: 'The AI isn’t set up on the server.', status: 503 };
  const [{ data: profiles }, { data: clientRows }, { data: settingsRow }] = await Promise.all([
    admin.from('team_profiles').select('id, name, email, access_revoked'),
    admin.from('clients').select('id, name, status, deleted_at'),
    admin.from('app_storage').select('value').eq('key', 'settings').maybeSingle(),
  ]);
  let settings = {}; try { settings = settingsRow && settingsRow.value ? JSON.parse(settingsRow.value) : {}; } catch (e) {}
  const team = (profiles || []).filter(p => !p.access_revoked && p.name);
  const live = (clientRows || []).filter(c => !c.deleted_at);
  const when = new Date(m.meetingAt || m.at || Date.now());
  const tz = settings.timezone || process.env.TEAM_TIMEZONE || 'America/New_York';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(when);
  const g = t => (parts.find(x => x.type === t) || {}).value;
  const date = `${g('year')}-${g('month')}-${g('day')}`;
  const ownerTxt = String(m.owner || '').trim().toLowerCase();
  const owner = ownerTxt ? team.find(p => p.name.toLowerCase() === ownerTxt || (p.email || '').toLowerCase() === ownerTxt)
    || team.find(p => p.name.toLowerCase().split(' ')[0] === ownerTxt.split(' ')[0]) : null;
  const prompt = pullPrompt({ title: m.title || 'A meeting', date, weekday: DAY_NAMES[new Date(date + 'T12:00:00Z').getUTCDay()], owner: m.owner,
    team: team.map(p => p.name), ownerOnTeam: owner && owner.name, clients: live.filter(c => c.status !== 'Paused').map(c => c.name).slice(0, 150), summary: m.summary.slice(0, 12000) });
  const r = opts.ai ? await opts.ai(prompt) : await callOpenAI([{ role: 'user', content: prompt }], null, { model: settings.openaiModel || OPENAI_MODEL, webSearch: false });
  const ai = r && r.ok ? parseAi(r.reply) : null;
  if (!ai || !Array.isArray(ai.groups)) return { error: 'The AI didn’t answer. Try again in a moment.', status: 502 };
  const findPerson = n => { const s = String(n || '').trim().toLowerCase(); return s ? team.find(p => p.name.toLowerCase() === s) || team.find(p => p.name.toLowerCase().split(' ')[0] === s.split(' ')[0]) : null; };
  let left = 20;
  const groups = ai.groups.slice(0, 6).map(gr => {
    const items = (Array.isArray(gr && gr.items) ? gr.items : []).map(it => {
      const title = String((it && it.title) || '').trim(); if (!title || left <= 0) return null;
      left--;
      const p = findPerson(it.who);
      const due = /^\d{4}-\d{2}-\d{2}$/.test(String(it.due || '')) && it.due >= date ? it.due : null;
      return { title: title.slice(0, 120), whoId: p ? p.id : null, who: p ? p.name : null, due, why: String(it.why || '').trim().slice(0, 160) || null,
        point: String(it.point || '').replace(/\*\*/g, '').trim().slice(0, 240) || null };
    }).filter(Boolean);
    const label = String((gr && gr.label) || '').trim().slice(0, 40) || 'Other';
    const client = live.find(c => c.name.toLowerCase() === label.toLowerCase());
    return { label: client ? client.name : label, clientId: client ? client.id : null, items };
  }).filter(gr => gr.items.length);
  const pulled = { at: new Date().toISOString(), sum, groups };
  // kept with the meeting (read again just now, so nothing written in between is lost)
  const { data: fresh } = await admin.from('app_storage').select('value').eq('key', NOTE_KEY(id)).maybeSingle();
  if (fresh) await admin.from('app_storage').update({ value: JSON.stringify({ ...parseMark(fresh.value), pulled }) }).eq('key', NOTE_KEY(id));
  return { groups, at: pulled.at };
}

// ---- A recap for the client (Nov 23) -------------------------------------------------------------
// After a meeting with a client: an email and a WhatsApp message from the agency, drafted from the
// notes, for the person to read, change and send themselves. Only what concerns that client, worded
// professionally and positively. Kept with the meeting until its notes change.
function recapPrompt(o) {
  return `You write the follow-up a marketing agency sends a client after a meeting with them, from the agency's notes of that meeting. Reply with JSON only, no other text:
{"subject": "...", "email": "...", "whatsapp": "..."}

The agency: Based Agency. It's sent by ${o.sender}.
The client: ${o.client}${o.contact ? `; the person to address: ${o.contact}` : ''}.
The meeting: "${o.title}", ${o.weekday} ${o.date}.

Notes:
"""
${o.summary}
"""

Rules:
- Only what concerns ${o.client}: leave out other clients, internal team matters, who on the team is doing well or not, internal costs or margins, and anything said about the client rather than to them.
- Warm, confident and professional. Thank them for their time. Never mention mistakes, delays, gaps, problems or anything that makes the agency look bad; put everything positively and as progress.
- "email": plain text with short paragraphs and, where it helps, a few lines starting with "- ": what was covered or agreed; what the agency will do next (with dates when the notes give them); what's needed from the client, if anything. A friendly close signed by ${o.senderFirst}. Under 180 words. No emojis, no markdown.
- "subject": short, like "Recap: ${o.title}".
- "whatsapp": the same in a short message for a chat, under 80 words, plain text, no emojis, no markdown, no greeting line with a subject.
- Write in English.`;
}
async function draftMeetingRecap(admin, noteRef, viewer, opts) {
  opts = opts || {};
  const f = await meetingFor(admin, noteRef, viewer); if (f.error) return f;
  const { id, m } = f;
  if (!m.summary || m.state === 'removed') return { error: 'This meeting’s notes aren’t in Radar.', status: 404 };
  const [{ data: cl }, { data: team }, { data: settingsRow }] = await Promise.all([
    admin.from('clients').select('*'),
    admin.from('team_profiles').select('email'),
    admin.from('app_storage').select('value').eq('key', 'settings').maybeSingle(),
  ]);
  const live = (cl || []).filter(c => !c.deleted_at), teamDomains = new Set((team || []).map(p => emailDomain(p.email)).filter(Boolean));
  const cid = metClientOf(m, live, teamDomains), client = cid ? live.find(c => String(c.id) === String(cid)) : null;
  if (!client) return { error: 'A recap is for a meeting with a client: nobody from a client’s side was in this one.', status: 400 };
  // to: the client's people who were there, else the client's email
  const guests = (m.people || []).filter(e => { const d = emailDomain(e); return d && !teamDomains.has(d); });
  const to = guests.length ? guests : client.email ? [client.email] : [];
  const sum = crypto.createHash('sha1').update(m.summary + '|' + client.id).digest('hex').slice(0, 12);
  const cached = m.recap && m.recap.sum === sum ? m.recap : null;
  if (cached && (!opts.again || Date.now() - new Date(cached.at).getTime() < 30000)) return { ...cached, to, client: client.name, cached: true };
  if (!process.env.OPENAI_API_KEY && !opts.ai) return { error: 'The AI isn’t set up on the server.', status: 503 };
  let settings = {}; try { settings = settingsRow && settingsRow.value ? JSON.parse(settingsRow.value) : {}; } catch (e) {}
  const tz = settings.timezone || process.env.TEAM_TIMEZONE || 'America/New_York';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(m.meetingAt || m.at || Date.now()));
  const g = t => (parts.find(x => x.type === t) || {}).value;
  const date = `${g('year')}-${g('month')}-${g('day')}`;
  const cfv = client.custom_field_values || {};
  const contact = String(cfv.contact || client.contact_name || '').trim();
  const sender = viewer.name || 'the team';
  const prompt = recapPrompt({ client: client.name, contact: contact || null, sender, senderFirst: String(sender).split(' ')[0], title: m.title || 'our meeting',
    date, weekday: DAY_NAMES[new Date(date + 'T12:00:00Z').getUTCDay()], summary: m.summary.slice(0, 12000) });
  const r = opts.ai ? await opts.ai(prompt) : await callOpenAI([{ role: 'user', content: prompt }], null, { model: settings.openaiModel || OPENAI_MODEL, webSearch: false });
  const ai = r && r.ok ? parseAi(r.reply) : null;
  if (!ai || !ai.email) return { error: 'The AI didn’t answer. Try again in a moment.', status: 502 };
  const clean = t => String(t || '').replace(/\*\*/g, '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
  const recap = { sum, at: new Date().toISOString(), by: viewer.id || null, subject: clean(ai.subject).slice(0, 160) || `Recap: ${m.title || 'our meeting'}`,
    email: clean(ai.email).slice(0, 4000), whatsapp: clean(ai.whatsapp).slice(0, 1500) };
  const { data: fresh } = await admin.from('app_storage').select('value').eq('key', NOTE_KEY(id)).maybeSingle();
  if (fresh) await admin.from('app_storage').update({ value: JSON.stringify({ ...parseMark(fresh.value), recap }) }).eq('key', NOTE_KEY(id));
  return { ...recap, to, client: client.name };
}

// ---- What the client said they'd do: follow-ups (Nov 23) --------------------------------------
// From a meeting with a client, each thing they said they'd send or do becomes a follow-up
// (client_reminders, waiting) for the person waiting on it, unless one like it is already open.
function addWorkdays(ds, n) {
  let d = ds, k = 0;
  while (k < n) { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); d = x.toISOString().slice(0, 10); const w = new Date(d + 'T12:00:00Z').getUTCDay(); if (w !== 0 && w !== 6) k++; }
  return d;
}
async function makeClientFollowUps(admin, o) {
  const items = (Array.isArray(o.waiting) ? o.waiting : []).slice(0, 6);
  if (!items.length || !o.client) return [];
  const { data: open } = await admin.from('client_reminders').select('id, question, status').eq('client_id', o.client.id).eq('status', 'waiting');
  const made = [], today = o.today;
  for (const it of items) {
    const what = String((it && it.what) || '').trim().replace(/\.$/, '');
    if (!what) continue;
    if ((open || []).concat(made).some(r => sameTask(r.question, what))) continue;
    const asker = o.findPerson(it.asker) || o.owner;
    if (!asker) continue;
    let due = /^\d{4}-\d{2}-\d{2}$/.test(String(it.due || '')) && it.due >= o.date ? it.due : addWorkdays(o.date, 3);
    if (due < today) due = addWorkdays(today, 1);
    const { data, error } = await admin.from('client_reminders').insert({ client_id: o.client.id, question: what.slice(0, 300), asked_by: asker.id, follow_up_date: due, status: 'waiting' }).select().single();
    if (!error && data) made.push({ ...data, askerName: asker.name });
  }
  // one heads-up per person waiting
  const per = new Map();
  made.forEach(r => per.set(r.asked_by, (per.get(r.asked_by) || 0) + 1));
  for (const [uid, n] of per) {
    const body = `${n === 1 ? 'Something' : `${n} things`} ${o.client.name} said they’d do in “${o.title}”. Radar will remind you to follow up.`;
    await admin.from('notifications').insert({ user_id: uid, type: 'reminder_added', title: `Waiting on ${o.client.name}`, body, target_view: 'reminders', target_id: null }).then(() => {}, () => {});
  }
  return made.map(r => r.id);
}

module.exports = { draftMeetingRecap, recapPrompt, makeClientFollowUps, refreshLastMet, noteLastMet, meetingMinutes, LAST_MET_KEY, removeGranolaMeeting, restoreGranolaMeeting, pullMeetingTasks, pullPrompt, canSeeMeeting, GONE_KEY, ensureGranolaWebhook, registerGranolaWebhook, granolaReadAgain, granolaReadNow, granolaFetch, connectGranola, disconnectGranola, granolaStatus, verifyGranolaSignature, handleGranolaHook, readGranolaNote, granolaCatchUp, granolaTaskPrompt, NOTE_KEY };
