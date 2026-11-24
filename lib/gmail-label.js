// Gmail label "Radar" (Nov 24): you label an email "Radar" in Gmail, and a small Google Apps Script in
// your own Google account sends it here, where it becomes a suggested task (the same list as the
// emails Radar reads by itself: Add, Edit… or Dismiss, with a link back to the email). Only the
// emails you label are sent; nothing here reads an inbox.
//
// Each person makes their own key in Settings → Connections → Gmail label, and it goes into their
// script. Only a hash of it is kept (table gmail_label_keys, addendum-gmail-label.sql), so a new
// script means a new key, and the old one stops working.
//
// POST /api/integrations?route=gmail-label   header x-radar-key: <the key>
//   body { messageId, threadId, from, to, cc, subject, date, body, account }  → { ok, suggested, already }

const crypto = require('crypto');
const { callOpenAI, OPENAI_MODEL } = require('./ai-client');
const { sameTask, emailDomain, parseAi, notifyMember } = require('./granola-tasks');
const { clientFor, gmailTaskPrompt, ownWords, addressOf, nameOf } = require('./gmail-tasks');

const DAY = 864e5;
const hashKey = k => crypto.createHash('sha256').update(String(k || '')).digest('hex');
const keyShape = k => /^rgl_[A-Za-z0-9_-]{24,64}$/.test(String(k || ''));
const missing = e => e && /gmail_label_keys|does not exist|relation/i.test(e.message || '');

async function labelStatus(admin, userId){
  const { data, error } = await admin.from('gmail_label_keys').select('created_at, last_used_at, sent_count').eq('user_id', userId).maybeSingle();
  if(missing(error)) return { on: false, needsSetup: true };
  return data ? { on: true, createdAt: data.created_at, lastUsedAt: data.last_used_at, sent: data.sent_count || 0 } : { on: false };
}
// A new key (the last one stops working). It's only ever shown here, once.
async function labelNewKey(admin, userId){
  const key = 'rgl_' + crypto.randomBytes(24).toString('base64url');
  const { error } = await admin.from('gmail_label_keys').upsert({ user_id: userId, key_hash: hashKey(key), created_at: new Date().toISOString(), last_used_at: null, sent_count: 0 }, { onConflict: 'user_id' });
  if(missing(error)) return { error: 'An admin needs to run addendum-gmail-label.sql in Supabase first.', needsSetup: true, status: 503 };
  if(error) return { error: error.message, status: 500 };
  return { key };
}
async function labelOff(admin, userId){
  await admin.from('gmail_label_keys').delete().eq('user_id', userId);
  return { ok: true };
}

const clean = (v, n) => String(v == null ? '' : v).replace(/\u0000/g, '').trim().slice(0, n);
// "Re: Fwd: The quote form" → "The quote form"
const bareSubject = s => clean(s, 300).replace(/^((re|fw|fwd|aw|res|enc)\s*:\s*)+/i, '').trim();

// One labelled email in. opts: { now, ai } (ai for tests)
async function fromLabel(admin, key, body, opts){
  opts = opts || {};
  const now = opts.now ? new Date(opts.now) : new Date();
  if(!keyShape(key)) return { status: 401, body: { error: 'Not allowed' } };
  const { data: k, error: kErr } = await admin.from('gmail_label_keys').select('user_id, sent_count').eq('key_hash', hashKey(key)).maybeSingle();
  if(missing(kErr)) return { status: 503, body: { error: 'Radar isn’t set up for this yet.' } };
  if(!k) return { status: 401, body: { error: 'This key was replaced or turned off. Make a new script in Radar (Settings → Connections → Gmail label).' } };
  const b = body || {};
  const e = { id: clean(b.messageId, 200), thread: clean(b.threadId, 200), from: clean(b.from, 300), to: clean(b.to, 1000), cc: clean(b.cc, 1000),
    subject: clean(b.subject, 300) || '(no subject)', account: clean(b.account, 200).toLowerCase(), text: ownWords(clean(b.body, 20000)).slice(0, 6000) };
  const sent = Date.parse(b.date); e.at = isNaN(sent) ? now : new Date(sent);
  if(!e.id) return { status: 400, body: { error: 'Missing messageId' } };
  const userId = k.user_id;

  // sent before (the script tries again if it didn't hear back): nothing new
  const { data: before } = await admin.from('task_suggestions').select('id').eq('assignee_id', userId).eq('source', 'gmail').eq('source_id', e.id).limit(1);
  if(before && before.length) return { status: 200, body: { ok: true, suggested: 0, already: true } };

  const [{ data: profiles }, { data: clientRows }, { data: settingsRow }] = await Promise.all([
    admin.from('team_profiles').select('id, name, email, access_revoked, muted_notification_types'),
    admin.from('clients').select('id, name, email, website, status, deleted_at'),
    admin.from('app_storage').select('value').eq('key', 'settings').maybeSingle(),
  ]);
  let settings = {}; try { settings = settingsRow && settingsRow.value ? JSON.parse(settingsRow.value) : {}; } catch(err){}
  const team = (profiles || []).filter(p => !p.access_revoked && p.name), me = team.find(p => p.id === userId);
  if(!me) return { status: 403, body: { error: 'Only team members can send emails to Radar.' } };
  const teamDomains = new Set(team.map(p => emailDomain(p.email)).filter(Boolean));
  if(e.account) teamDomains.add(emailDomain(e.account));
  const live = (clientRows || []).filter(c => !c.deleted_at && c.status !== 'Paused');
  // the client: who it's from, or (an email you sent them) who it went to
  const addrs = [e.from].concat((e.to + ',' + e.cc).split(',')).map(addressOf).filter(Boolean);
  let client = null; for(const a of addrs){ client = clientFor(a, live, teamDomains); if(client) break; }

  const tz = settings.timezone || process.env.TEAM_TIMEZONE || 'America/New_York';
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const weekday = new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  let items = [];
  if(e.text && (process.env.OPENAI_API_KEY || opts.ai)){
    const prompt = gmailTaskPrompt({ me: me.name, client: client ? client.name : `${nameOf(e.from)} (not matched to a client)`, from: e.from, subject: e.subject, sent: e.at.toISOString().slice(0, 10), date, weekday, text: e.text });
    const r = opts.ai ? await opts.ai(prompt) : await callOpenAI([{ role: 'user', content: prompt }], null, { model: settings.openaiModel || OPENAI_MODEL, webSearch: false });
    const ai = r && r.ok ? parseAi(r.reply) : null;
    items = (ai && Array.isArray(ai.items) ? ai.items : []).slice(0, 4);
  }
  // You chose this email, so it always becomes something: its subject, when the AI found nothing (or isn't set up)
  if(!items.filter(it => String(it && it.title || '').trim()).length){
    const firstLine = (e.text.split(/\n+/).find(l => l.trim().length > 8) || '').trim();
    items = [{ title: `Follow up: ${bareSubject(e.subject) || 'the email'}`, notes: `From ${nameOf(e.from)}’s email.`, quote: firstLine.slice(0, 160), priority: 'medium' }];
  }

  const { data: lately } = await admin.from('task_suggestions').select('title').eq('assignee_id', userId).gte('created_at', new Date(now - 21 * DAY).toISOString()).limit(500);
  const { data: haveRows } = await admin.from('tasks').select('title, client_id, status, completed_at, cancelled_at').eq('assignee_id', userId).gte('created_at', new Date(now - 90 * DAY).toISOString()).limit(1000);
  const have = (haveRows || []).filter(t => !t.cancelled_at && (t.status !== 'done' || (t.completed_at && now - new Date(t.completed_at) < 21 * DAY)));
  const link = `https://mail.google.com/mail/?authuser=${encodeURIComponent(e.account || me.email || '')}#all/${e.thread || e.id}`;
  const rows = []; let already = 0;
  for(const it of items){
    const t = clean(it && it.title, 120);
    if(!t) continue;
    const dupe = x => sameTask(x.title, t);
    if((lately || []).some(dupe) || have.some(x => (!x.client_id || !client || x.client_id === client.id) && dupe(x)) || rows.some(dupe)){ already++; continue; }
    const due = /^\d{4}-\d{2}-\d{2}$/.test(String(it.due || '')) && it.due >= date ? it.due : null;
    rows.push({ assignee_id: userId, title: t, description: clean(it.notes, 600) || null, client_id: client ? client.id : null, due_date: due,
      priority: it.priority === 'high' ? 'high' : 'medium', source: 'gmail', source_id: e.id, source_title: e.subject.slice(0, 200), source_url: link,
      source_at: e.at.toISOString(), quote: clean(it.quote, 200) || null, status: 'pending' });
  }
  let made = [];
  if(rows.length){
    const { data, error } = await admin.from('task_suggestions').upsert(rows, { onConflict: 'source,source_id,assignee_id,title', ignoreDuplicates: true }).select();
    if(error) return { status: 500, body: { error: error.message } };
    made = data || rows;
  }
  await admin.from('gmail_label_keys').update({ last_used_at: now.toISOString(), sent_count: (k.sent_count || 0) + 1 }).eq('user_id', userId);
  if(made.length){
    const body1 = `${made.length === 1 ? `“${made[0].title}”` : `${made.length} tasks`} from “${e.subject.slice(0, 80)}”. Add or dismiss ${made.length === 1 ? 'it' : 'them'} in Tasks.`;
    await notifyMember(admin, me, 'task_from_email', 'From your Radar label in Gmail', body1, 'tasks', e.id);
  }
  return { status: 200, body: { ok: true, suggested: made.length, already: !made.length && already > 0 } };
}

module.exports = { labelStatus, labelNewKey, labelOff, fromLabel, hashKey, bareSubject };
