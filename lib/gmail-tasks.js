// Tasks from Gmail (Nov 24): each person can let Radar read their work Gmail, read only. A few times
// a day (and when they open Tasks), Radar reads the new emails in their inbox from clients — a client's
// email address, or a client's own domain — and the AI picks out what the client is asking them to do.
// Those become suggested tasks, beside the ones from Granola: Add, Edit… or Dismiss in Tasks, with the
// email one click away. Nothing is sent from their mailbox, and nothing else is read: emails from
// anyone who isn't a client are skipped before their text is opened, and only a short quote of a
// client's email is kept with the suggestion.
//
// Setup, once, in the Google Cloud project Radar already uses for Google Calendar:
//   APIs & Services → Library → Gmail API → Enable.
//   OAuth consent screen → User type: Internal (only based-agency.com accounts), and add the scope
//   https://www.googleapis.com/auth/gmail.readonly. As an Internal app it needs no Google review.
//   The redirect URL is the one Google Calendar already uses: https://<radar>/api/google-oauth-callback
// And the table, once: addendum-gmail.sql.

const { clientPlans, planRule, scopeOf, withoutScope, NO_SCOPE_COLS } = require('./client-plan');
const crypto = require('crypto');
const { callOpenAI, OPENAI_MODEL } = require('./ai-client');
const { sameTask, emailDomain, siteDomain, parseAi, FREE_MAIL, notifyMember, makeClientFollowUps } = require('./granola-tasks');

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly openid email';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const configured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const DAY = 864e5;
const MAX_EMAILS = 8;          // read with the AI per person per check
const BACK_FIRST = 3 * DAY;    // the first read looks back this far
const BACK_MAX = 7 * DAY;      // and never further than this
const RECENT_MS = 10 * 60000;  // a check sooner than this after the last one is skipped (unless forced)

// ---- signing in --------------------------------------------------------------------------------
function sign(payload){
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', process.env.GOOGLE_CLIENT_SECRET || '').update(body).digest('base64url');
  return `${body}.${mac}`;
}
function unsign(state){
  const [body, mac] = String(state || '').split('.');
  if(!body || !mac) return null;
  const want = crypto.createHmac('sha256', process.env.GOOGLE_CLIENT_SECRET || '').update(body).digest('base64url');
  if(mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
  let p; try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch(e){ return null; }
  if(!p || p.kind !== 'gmail' || !p.u || Date.now() - Number(p.t || 0) > 15 * 60000) return null;
  return p;
}
function gmailAuthUrl(userId, appUrl){
  if(!configured()) return { notConfigured: true };
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: `${appUrl}/api/google-oauth-callback`, response_type: 'code',
    scope: SCOPE, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false',
    state: sign({ kind: 'gmail', u: userId, t: Date.now() }),
  });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` };
}
// Google comes back here (through /api/google-oauth-callback) with a signed state naming who started it.
// The Gmail account must be a team account: the one on their Radar profile, or another at the team's domain.
async function gmailCallback(admin, query, appUrl, deps){
  const get = (deps && deps.fetch) || fetch;
  const back = r => `${appUrl}/#settings?gmail=${r}`;
  if(query.error) return back('denied');
  const st = unsign(query.state);
  if(!st || !query.code) return back('error');
  const tr = await get('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: query.code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: `${appUrl}/api/google-oauth-callback`, grant_type: 'authorization_code' }) });
  const tok = await tr.json().catch(() => ({}));
  if(!tr.ok || !tok.refresh_token || !String(tok.scope || '').includes('gmail.readonly')) return back(tok.refresh_token ? 'scope' : 'error');
  const ui = await get('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${tok.access_token}` } });
  const info = await ui.json().catch(() => ({}));
  const email = String(info.email || '').toLowerCase();
  const { data: me } = await admin.from('team_profiles').select('email').eq('id', st.u).maybeSingle();
  const mine = String((me && me.email) || '').toLowerCase();
  if(!email || (mine && email !== mine && emailDomain(email) !== emailDomain(mine))) return back('wrong-account');
  const { error } = await admin.from('gmail_connections').upsert({ user_id: st.u, refresh_token: tok.refresh_token, google_email: email,
    connected_at: new Date().toISOString(), last_read_at: null, last_error: null }, { onConflict: 'user_id' });
  return back(error ? (/gmail_connections/.test(error.message || '') ? 'setup' : 'error') : 'connected');
}
async function gmailStatus(admin, userId){
  const out = { configured: configured() };
  const { data, error } = await admin.from('gmail_connections').select('google_email, connected_at, last_read_at, last_error, last_stats').eq('user_id', userId).maybeSingle();
  if(error) return { ...out, needsSetup: /gmail_connections/.test(error.message || ''), connected: false };
  return { ...out, connected: !!data, email: data && data.google_email, connectedAt: data && data.connected_at, lastReadAt: data && data.last_read_at, lastError: data && data.last_error, stats: data && data.last_stats };
}
async function gmailDisconnect(admin, userId, deps){
  const get = (deps && deps.fetch) || fetch;
  const { data } = await admin.from('gmail_connections').select('refresh_token').eq('user_id', userId).maybeSingle();
  if(data && data.refresh_token){ try { await get(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(data.refresh_token)}`, { method: 'POST' }); } catch(e){} }
  await admin.from('gmail_connections').delete().eq('user_id', userId);
  return { ok: true };
}

// ---- reading ---------------------------------------------------------------------------------------
async function accessToken(conn, get){
  const r = await get('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: conn.refresh_token, grant_type: 'refresh_token' }) });
  const j = await r.json().catch(() => ({}));
  if(!r.ok || !j.access_token) return { error: j.error === 'invalid_grant' ? 'Google access ended. Connect Gmail again in Settings.' : `Google said: ${j.error_description || j.error || r.status}`, ended: j.error === 'invalid_grant' };
  return { token: j.access_token };
}
const header = (msg, name) => { const h = ((msg.payload || {}).headers || []).find(x => String(x.name).toLowerCase() === name.toLowerCase()); return h ? String(h.value || '') : ''; };
function addressOf(from){ const m = String(from || '').match(/<([^>]+)>/); return (m ? m[1] : String(from || '')).trim().toLowerCase(); }
function nameOf(from){ const m = String(from || '').match(/^\s*"?([^"<]+?)"?\s*</); return m ? m[1].trim() : addressOf(from); }
function b64(s){ try { return Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch(e){ return ''; } }
// The email's own words: its plain text (or its HTML made plain), without what it quotes from earlier
function bodyText(payload){
  const parts = [], walk = p => { if(!p) return; if(p.parts) p.parts.forEach(walk); else if(p.body && p.body.data) parts.push({ type: p.mimeType || '', text: b64(p.body.data) }); };
  walk(payload);
  const plain = parts.find(p => p.type === 'text/plain'), html = parts.find(p => p.type === 'text/html');
  const t = plain ? plain.text : html ? html.text.replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"') : '';
  return ownWords(t);
}
// Without what it quotes from earlier emails
function ownWords(text){
  let t = String(text || '');
  const cut = t.search(/\n\s*(On .{4,120}wrote:|-{2,}\s*Original Message|From: .+\n\s*Sent: )/i);
  if(cut > 0) t = t.slice(0, cut);
  return t.split('\n').filter(l => !/^\s*>/.test(l)).join('\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
// The client an email is from: their address, or their own domain (not a free mail one, not the team's)
function clientFor(address, clients, teamDomains){
  const a = String(address || '').toLowerCase(), d = emailDomain(a);
  if(!a || !d || teamDomains.has(d)) return null;
  const listed = c => String(c.email || '').toLowerCase().split(/[\s,;]+/).filter(Boolean);
  const exact = clients.find(c => listed(c).includes(a));
  if(exact) return exact;
  if(FREE_MAIL.has(d)) return null;
  return clients.find(c => listed(c).some(e => emailDomain(e) === d) || (c.website && siteDomain(c.website) === d)) || null;
}
// What an email asks of the agency (tasks), and what the agency is now waiting on from the client
// (follow-ups, Nov 25: they go to Reminders, not Tasks). o.fromMe: an email the person sent the client
// (a labelled one), where what they asked for is what's waiting.
function gmailTaskPrompt(o){
  const what = o.fromMe ? `an email ${o.me} at Based Agency, a marketing agency (Google Ads, Meta ads, SEO, websites), sent to the client ${o.client}`
    : `an email a client sent to ${o.me} at Based Agency, a marketing agency (Google Ads, Meta ads, SEO, websites)`;
  return `You read ${what}. Sort out two things:
- "items": what ${o.me} or the agency has to do: a request, a change, something to send or fix, a question that needs work to answer, or a deadline.${o.fromMe ? ` Only what ${o.me} said they'd do.` : ''} Not: thanks, FYI, scheduling chatter already settled, newsletters, receipts or automated mail.
- "waiting": what the agency is now waiting on from the client: something the client says they'll send, do, decide or answer later ("I'll get you the photos Friday", "let me check with my partner and get back to you")${o.fromMe ? `, or what ${o.me} asks them for in this email (access, files, an approval, an answer)` : ''}. Not what they already sent or did in this email, and never work the agency does itself (that's an item). Never the same thing in both lists.

Today is ${o.weekday}, ${o.date}. The client: ${o.client}. From: ${o.from}. Subject: ${o.subject}. Sent: ${o.sent}.

Answer with JSON only, like {"items":[{"title":"Add the new photos to the gallery page","notes":"What they need and any detail that matters, 1-2 sentences","due":"YYYY-MM-DD or empty","priority":"high|medium","quote":"the words it comes from, under 25 words"${o.plan ? ',"in_plan":true' : ''}}],"waiting":[{"what":"Send the new logo files","due":"YYYY-MM-DD or empty","quote":"the words it comes from, under 25 words"}]}. Titles start with a verb, under 70 characters, name the deliverable. "what" starts with a verb, under 100 characters: the thing to get from them. A due date only when the email gives or clearly implies one. High priority only for urgent or upset. At most 4 items and 3 waiting; [] for either when there's nothing.${planRule(o.plan ? [o.plan] : [], 'item')}

The email:
"""
${o.text}
"""`;
}

// Reads one person's new client emails. opts: { force, now, fetch, ai } (fetch and ai for tests)
async function readGmailFor(admin, userId, opts){
  opts = opts || {};
  const get = opts.fetch || fetch, now = opts.now ? new Date(opts.now) : new Date();
  const { data: conn, error: cErr } = await admin.from('gmail_connections').select('*').eq('user_id', userId).maybeSingle();
  if(cErr) return { skipped: /gmail_connections/.test(cErr.message || '') ? 'run addendum-gmail.sql' : cErr.message };
  if(!conn) return { skipped: 'not connected' };
  if(!opts.force && conn.last_read_at && now - new Date(conn.last_read_at) < RECENT_MS) return { skipped: 'recent', lastReadAt: conn.last_read_at };
  if(!configured()) return { skipped: 'Google sign-in isn’t set up' };
  if(!process.env.OPENAI_API_KEY && !opts.ai) return { skipped: 'no AI key' };
  // claimed now, so two checks at once don't read the same emails
  await admin.from('gmail_connections').update({ last_read_at: now.toISOString() }).eq('user_id', userId);
  const tk = await accessToken(conn, get);
  if(tk.error){ await admin.from('gmail_connections').update({ last_error: tk.error }).eq('user_id', userId); return { error: tk.error }; }
  const auth = { headers: { Authorization: `Bearer ${tk.token}` } };
  const g = async path => { const r = await get(`${API}${path}`, auth); return r.ok ? r.json().catch(() => null) : null; };

  const [{ data: profiles }, { data: clientRows }, { data: settingsRow }] = await Promise.all([
    admin.from('team_profiles').select('id, name, email, access_revoked, muted_notification_types'),
    admin.from('clients').select('id, name, email, website, status, deleted_at, service, sow'),
    admin.from('app_storage').select('value').eq('key', 'settings').maybeSingle(),
  ]);
  let settings = {}; try { settings = settingsRow && settingsRow.value ? JSON.parse(settingsRow.value) : {}; } catch(e){}
  const team = (profiles || []).filter(p => !p.access_revoked && p.name), me = team.find(p => p.id === userId);
  if(!me) return { skipped: 'not on the team' };
  const teamDomains = new Set(team.map(p => emailDomain(p.email)).filter(Boolean));
  if(conn.google_email) teamDomains.add(emailDomain(conn.google_email));
  const live = (clientRows || []).filter(c => !c.deleted_at && c.status !== 'Paused');

  // new in the inbox since where the last read got to (the first read: the last few days)
  const from0 = conn.cursor_at || conn.last_read_at;
  const since = new Date(Math.max(now - BACK_MAX, from0 ? new Date(from0) - 60000 : now - BACK_FIRST));
  const deadline = opts.deadline || (Date.now() + 40000);
  const q = `in:inbox -from:me -category:promotions -category:social after:${Math.floor(since / 1000)}`;
  const list = await g(`/messages?maxResults=50&q=${encodeURIComponent(q)}`);
  if(!list){ await admin.from('gmail_connections').update({ last_error: 'Gmail didn’t answer. Radar tries again at the next check.' }).eq('user_id', userId); return { error: 'list failed' }; }
  const ids = (list.messages || []).map(m => m.id);
  const seen = new Set(Array.isArray(conn.seen_ids) ? conn.seen_ids : []);
  // who each one is from, before anything else is read: only clients' emails are opened
  const fromClients = [];
  for(const id of ids){
    if(seen.has(id)) continue;
    const m = await g(`/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
    if(!m) continue;
    const from = header(m, 'From'), c = clientFor(addressOf(from), live, teamDomains);
    if(!c){ seen.add(id); continue; }   // not a client's: never opened
    fromClients.push({ id, threadId: m.threadId, from, subject: header(m, 'Subject') || '(no subject)', at: new Date(Number(m.internalDate) || Date.parse(header(m, 'Date')) || now), client: c });
  }
  const tz = settings.timezone || process.env.TEAM_TIMEZONE || 'America/New_York';
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const weekday = new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  const { data: lately } = await admin.from('task_suggestions').select('assignee_id, title').eq('assignee_id', userId).gte('created_at', new Date(now - 21 * DAY).toISOString()).limit(500);
  const { data: haveRows } = await admin.from('tasks').select('assignee_id, title, client_id, status, completed_at, cancelled_at').eq('assignee_id', userId).gte('created_at', new Date(now - 90 * DAY).toISOString()).limit(1000);
  const have = (haveRows || []).filter(t => !t.cancelled_at && (t.status !== 'done' || (t.completed_at && now - new Date(t.completed_at) < 21 * DAY)));
  // what each of these clients pays for, so a request outside it is labelled (Nov 25)
  const plans = await clientPlans(admin, [...new Map(fromClients.map(e => [String(e.client.id), e.client])).values()], settings).catch(() => ({}));
  const rows = [];
  let already = 0, readN = 0, reminders = 0;
  // oldest first, as many as there's time for; the rest wait for the next check (the cursor stays at them)
  const queue = fromClients.sort((a, b) => a.at - b.at), left = [];
  for(const e of queue){
    if(readN >= MAX_EMAILS || Date.now() > deadline){ left.push(e); continue; }
    const full = await g(`/messages/${encodeURIComponent(e.id)}?format=full`);
    seen.add(e.id);
    const text = full ? bodyText(full.payload).slice(0, 6000) : '';
    if(!text) continue;
    readN++;
    const plan = plans[String(e.client.id)] || null;
    const prompt = gmailTaskPrompt({ me: me.name, client: e.client.name, from: e.from, subject: e.subject, sent: e.at.toISOString().slice(0, 10), date, weekday, text, plan });
    const r = opts.ai ? await opts.ai(prompt) : await callOpenAI([{ role: 'user', content: prompt }], null, { model: settings.openaiModel || OPENAI_MODEL, webSearch: false });
    const ai = r && r.ok ? parseAi(r.reply) : null;
    // what the client owes us: a follow-up in Reminders, from this email (Nov 25)
    if(ai && Array.isArray(ai.waiting) && ai.waiting.length){
      try{
        const ids = await makeClientFollowUps(admin, { waiting: ai.waiting.slice(0, 3).map(w => ({ what: w && w.what, due: w && w.due })), client: e.client, clients: live, owner: me, findPerson: () => null,
          team, title: e.subject, date, today: date, how: 'email', source: { source: 'gmail', id: e.id, title: e.subject, url: `https://mail.google.com/mail/?authuser=${encodeURIComponent(conn.google_email || '')}#all/${e.threadId || e.id}` } });
        reminders += ids.length;
      }catch(err){}
    }
    for(const it of (ai && Array.isArray(ai.items) ? ai.items : []).slice(0, 4)){
      const t = String(it && it.title || '').trim().slice(0, 120);
      if(!t) continue;
      const dupe = x => sameTask(x.title, t);
      if((lately || []).some(dupe) || have.some(x => (!x.client_id || x.client_id === e.client.id) && dupe(x)) || rows.some(dupe)){ already++; continue; }
      const due = /^\d{4}-\d{2}-\d{2}$/.test(String(it.due || '')) && it.due >= date ? it.due : null;
      rows.push({ assignee_id: userId, title: t, description: String(it.notes || '').trim().slice(0, 600) || null, client_id: e.client.id, due_date: due,
        priority: it.priority === 'high' ? 'high' : 'medium', source: 'gmail', source_id: e.id, source_title: `${e.subject}`.slice(0, 200),
        source_url: `https://mail.google.com/mail/?authuser=${encodeURIComponent(conn.google_email || '')}#all/${e.threadId || e.id}`,
        source_at: e.at.toISOString(), quote: String(it.quote || '').trim().slice(0, 200) || null, status: 'pending', ...scopeOf(it, !!plan) });
    }
  }
  let made = [];
  if(rows.length){
    const save = list => admin.from('task_suggestions').upsert(list, { onConflict: 'source,source_id,assignee_id,title', ignoreDuplicates: true }).select();
    let { data, error } = await save(rows);
    if(error && NO_SCOPE_COLS.test(error.message || '')) ({ data, error } = await save(withoutScope(rows)));   // before addendum-out-of-scope.sql
    if(!error) made = data || rows;
  }
  // one heads-up for what this check found
  if(made.length){
    const emails = [...new Set(made.map(s => s.source_id))], who = [...new Set(made.map(s => (live.find(c => c.id === s.client_id) || {}).name).filter(Boolean))];
    const body = `${made.length === 1 ? `“${made[0].title}”` : `${made.length} tasks`} from ${who.length === 1 ? `${who[0]}’s email` : `emails from ${who.slice(0, 3).join(', ')}${who.length > 3 ? ' and others' : ''}`}. Add or dismiss ${made.length === 1 ? 'it' : 'them'} in Tasks.`;
    await notifyMember(admin, me, 'task_from_email', made.length === 1 ? 'A task from a client’s email' : 'Tasks from clients’ emails', body, 'tasks', emails.length === 1 ? emails[0] : null);
  }
  const stats = { at: now.toISOString(), inbox: ids.length, fromClients: fromClients.length, read: readN, suggested: made.length, reminders, already, waiting: left.length };
  const cursor = left.length ? left[0].at : now;
  await admin.from('gmail_connections').update({ last_read_at: now.toISOString(), cursor_at: new Date(Math.min(cursor, now)).toISOString(), last_error: null, last_stats: stats, seen_ids: [...seen].slice(-400) }).eq('user_id', userId);
  return stats;
}

// Everyone connected, as long as there's time (the scheduled checks)
async function gmailTick(admin, opts){
  opts = opts || {};
  const { data, error } = await admin.from('gmail_connections').select('user_id, last_read_at');
  if(error) return { skipped: /gmail_connections/.test(error.message || '') ? 'run addendum-gmail.sql' : error.message };
  const start = Date.now(), budget = opts.budgetMs || 30000, out = [];
  for(const c of (data || []).sort((a, b) => String(a.last_read_at || '').localeCompare(String(b.last_read_at || '')))){
    if(Date.now() - start > budget) break;
    try { out.push({ user: c.user_id, ...(await readGmailFor(admin, c.user_id, { ...opts, deadline: start + budget })) }); } catch(e){ out.push({ user: c.user_id, error: String(e) }); }
  }
  return { people: out.length, results: out };
}

module.exports = { gmailAuthUrl, gmailCallback, gmailStatus, gmailDisconnect, readGmailFor, gmailTick, gmailTaskPrompt, clientFor, bodyText, ownWords, addressOf, nameOf, sign, unsign, SCOPE };
