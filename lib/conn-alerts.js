// Connection lost (Nov 26). When a connection stops working (Google took back Radar's access to
// someone's Gmail or Calendar, their Slack sign-in ended, Granola or Harvest stopped taking the key,
// Slack refused the bot, Claude's or ChatGPT's key was refused or ran out of credit, Radar WhatsApp
// stopped or was signed out), the people who can fix it hear about it once: the person, for their own
// connections, and everyone with Settings & connections for the team's. In the bell, on the phone and
// in Slack (each muted as usual), saying what stops and where to fix it. When it works again the
// notice is marked read for everyone, and the next time it drops they hear again.
//
// Kept in app_storage as conn-health:<key> (conn-health:<key>:<user id> for a person's own), which the
// app reads too, to show the row as stopped in Settings → Connections.

// (what it needs is required when it's used: the modules that report here load it in their own
// failure and success paths, and some run in places without every package, like the tests)
const { profileHasAccess } = require('./access');

const TYPE = 'connection_lost';
const STORE = k => `conn-health:${k}`;
const CONN = {
  gmail:    { name: 'Gmail', stops: 'Radar can’t read your clients’ emails for tasks and follow-ups', fix: 'Connect Gmail again in Settings → Connections.' },
  gcal:     { name: 'Google Calendar', stops: 'your meetings don’t reach the team calendar', fix: 'Connect Google Calendar again in Settings → Connections.' },
  slackme:  { name: 'Slack, as you', stops: 'nudges to teammates can’t go from your Slack', fix: 'Connect it again in Settings → Connections.' },
  granola:  { name: 'Granola', stops: 'meetings aren’t read for tasks and follow-ups', fix: 'Paste a new workspace API key in Settings → Connections → Granola.' },
  harvest:  { name: 'Harvest', stops: 'time logged in Radar doesn’t reach Harvest', fix: 'Connect Harvest again in Settings → Harvest.' },
  slack:    { name: 'Slack', stops: 'client channel messages, reminders and summaries don’t go out', fix: 'Install the Slack app again and update its token in Settings → Connections → Slack.' },
  claude:   { name: 'Claude', stops: 'drafts, the Assistant and Claude’s notes can’t be written', fix: 'Check the Claude key in Settings → AI.' },
  openai:   { name: 'ChatGPT', stops: 'drafts and tasks from meetings and emails can’t be written', fix: 'Check the ChatGPT key in Settings → AI.' },
  whatsapp: { name: 'Radar WhatsApp', stops: 'client WhatsApp groups aren’t read', fix: 'See what it needs in Settings → WhatsApp.' },
};

function adminFromEnv() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? require('@supabase/supabase-js').createClient(url, key, { auth: { persistSession: false } }) : null;
}
const parse = v => { if (!v) return null; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch (e) { return null; } };
const muted = (p, ch) => { const m = (p && p.muted_notification_types) || []; return m.includes(TYPE) || m.includes(ch + ':' + TYPE); };
function storeKey(key, userId) { return userId ? `${key}:${userId}` : key; }

// o: { userId (a person's own connection), why (what happened, one sentence), deps (tests) }
async function connLost(admin, key, o) {
  o = o || {};
  const c = CONN[key]; if (!c) return { skipped: 'unknown connection' };
  admin = admin || adminFromEnv(); if (!admin) return { skipped: 'no database' };
  const k = storeKey(key, o.userId), now = new Date();
  try {
    const { data: row } = await admin.from('app_storage').select('value').eq('key', STORE(k)).maybeSingle();
    const was = parse(row && row.value);
    if (was && was.lost) return { already: true };
    const { data: profiles } = await admin.from('team_profiles').select('id, name, role, extra_permissions, access_revoked, muted_notification_types, slack_user_id');
    const to = (profiles || []).filter(p => !p.access_revoked && (o.userId ? p.id === o.userId : profileHasAccess(p, 'manage_settings')) && (!o.only || !o.only.length || o.only.includes(p.id)));
    const title = o.userId ? `Your ${c.name} connection stopped` : `${c.name} stopped working`;
    const body = `${o.why ? String(o.why).replace(/\s*$/, ' ') : ''}Until it’s fixed, ${c.stops}. ${c.fix}`;
    await admin.from('app_storage').upsert({ key: STORE(k), value: JSON.stringify({ lost: true, since: now.toISOString(), why: o.why || null, name: c.name, to: to.map(p => p.id) }) }, { onConflict: 'key' });
    const push = (o.deps && o.deps.push) || require('./push-notify').sendPushToUser;
    const slack = (o.deps && o.deps.slack) || (key === 'slack' ? null : require('./slack-notify').sendSlackDM);   // Slack can't tell you Slack is down
    for (const p of to) {
      if (muted(p, 'app') && muted(p, 'push') && muted(p, 'slack')) continue;
      if (!muted(p, 'app')) await admin.from('notifications').insert({ user_id: p.id, type: TYPE, title, body, target_view: 'settings', target_id: k }).then(() => {}, () => {});
      if (!muted(p, 'push')) { try { await push(admin, p.id, title, body, '/#settings'); } catch (e) {} }
      if (slack && !muted(p, 'slack')) { try { await slack(admin, p.id, TYPE, `*${title}*\n${body}`, null, { anyDay: true }); } catch (e) {} }
    }
    return { lost: true, told: to.length };
  } catch (e) { return { error: String(e && e.message || e) }; }
}

// It works: if it was down, the notices go read and the next drop is told again. Cheap to call on
// every success: a warm function looks again at most every five minutes.
const okSeen = {};
async function connOk(admin, key, o) {
  o = o || {};
  const k = storeKey(key, o.userId);
  if (!o.force && okSeen[k] && Date.now() - okSeen[k] < 5 * 60000) return { skipped: 'recent' };
  okSeen[k] = Date.now();
  admin = admin || adminFromEnv(); if (!admin) return { skipped: 'no database' };
  try {
    const { data: row } = await admin.from('app_storage').select('value').eq('key', STORE(k)).maybeSingle();
    const was = parse(row && row.value);
    if (!was || !was.lost) return { ok: true };
    await admin.from('app_storage').delete().eq('key', STORE(k));
    await admin.from('notifications').update({ read: true }).eq('type', TYPE).eq('target_id', k).eq('read', false).then(() => {}, () => {});
    return { ok: true, back: true };
  } catch (e) { return { error: String(e && e.message || e) }; }
}
// A failure that never reaches the database code paths above (the AI keys): look at an API's answer
function aiFailure(status, message) {
  const m = String(message || '');
  if (status === 401 || status === 403 || /invalid[ _-]?(x-)?api[ _-]?key|authentication|incorrect api key/i.test(m)) return 'It stopped accepting Radar’s key.';
  if (/credit balance is too low|insufficient_quota|exceeded your current quota|billing/i.test(m)) return 'It ran out of credit.';
  return null;
}

// Radar WhatsApp (the connector, on its own server): stopped (no heartbeat for half an hour) or signed
// out by the phone. Looked at by the ticks (api/integrations.js calendar-tick and gmail-tick).
async function whatsappHealth(admin, o) {
  o = o || {};
  const now = o.now ? new Date(o.now) : new Date();
  const { data: s, error } = await admin.from('wa_settings').select('*').eq('id', 1).maybeSingle();
  if (error || !s || !s.heartbeat_at) return { skipped: 'not set up' };
  // stopped for over a week: put away on purpose, not something that just broke
  if (now - new Date(s.heartbeat_at) > 7 * 864e5) return { skipped: 'not in use' };
  const only = Array.isArray(s.pilot_user_ids) ? s.pilot_user_ids : [];   // test mode: only the testers
  const { data: runs } = await admin.from('wa_runs').select('connection, started_at').eq('kind', 'status').order('started_at', { ascending: false }).limit(1);
  const last = runs && runs[0];
  const beat = new Date(s.heartbeat_at);
  const fmt = d => new Intl.DateTimeFormat('en-US', { timeZone: o.tz || 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(d);
  if (last && last.connection === 'logged_out') return connLost(admin, 'whatsapp', { why: 'WhatsApp signed Radar out (the phone unlinked it).', only, deps: o.deps });
  if (now - beat > 30 * 60000) return connLost(admin, 'whatsapp', { why: `It hasn’t checked in since ${fmt(beat)}.`, only, deps: o.deps });
  return connOk(admin, 'whatsapp', { force: true });
}

module.exports = { connLost, connOk, aiFailure, whatsappHealth, CONN, TYPE };
