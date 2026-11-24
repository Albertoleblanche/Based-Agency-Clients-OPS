// Slack as you (Nov 23): a nudge to a teammate goes from your own Slack, as you, not from the Radar
// bot. Each person connects their Slack once (Settings → Connections → Slack): Slack asks them to let
// Radar send messages as them, and their user token is kept in slack_user_tokens, which only the server
// can read (addendum-teammate-reminders.sql). Radar only ever sends what the person pressed Send on.
//
// Setup, once, in the Slack app Radar already uses (api.slack.com → Your Apps):
//   OAuth & Permissions → Redirect URLs: https://<radar>/slack/oauth
//   OAuth & Permissions → User Token Scopes: chat:write, im:write
//   Vercel: SLACK_CLIENT_ID and SLACK_CLIENT_SECRET, from Basic Information → App Credentials.
//
// The sign-in link carries a signed, 15-minute state naming who started it, so a callback can't be
// replayed for someone else; and the Slack account that signs in must be the one on their Radar
// profile (Team → Slack), when one is set.

const crypto = require('crypto');

const SCOPES = 'chat:write,im:write';
const configured = () => !!(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET);
const redirectUri = appUrl => `${appUrl}/slack/oauth`;

function sign(payload){
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', process.env.SLACK_CLIENT_SECRET || '').update(body).digest('base64url');
  return `${body}.${mac}`;
}
function unsign(state){
  const [body, mac] = String(state || '').split('.');
  if(!body || !mac) return null;
  const want = crypto.createHmac('sha256', process.env.SLACK_CLIENT_SECRET || '').update(body).digest('base64url');
  if(mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); return p && Date.now() - p.t < 15 * 60 * 1000 ? p : null; } catch(e){ return null; }
}

function slackMeAuthUrl(userId, appUrl){
  if(!configured()) return { error: 'Slack sign-in isn’t set up yet: an admin adds SLACK_CLIENT_ID and SLACK_CLIENT_SECRET in Vercel (see lib/slack-me.js).', notConfigured: true, status: 400 };
  const q = new URLSearchParams({ client_id: process.env.SLACK_CLIENT_ID, user_scope: SCOPES, redirect_uri: redirectUri(appUrl),
    state: sign({ u: userId, t: Date.now(), n: crypto.randomBytes(8).toString('hex') }) });
  return { url: `https://slack.com/oauth/v2/authorize?${q}` };
}

// Slack sends the person back here. Returns where to send them in Radar.
async function slackMeCallback(admin, query, appUrl, deps){
  const get = (deps && deps.fetch) || fetch;
  const back = r => `${appUrl}/#settings?slackme=${r}`;
  if(query.error) return back('denied');
  const st = unsign(query.state);
  if(!st || !query.code || !configured()) return back('error');
  const res = await get('https://slack.com/api/oauth.v2.access', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: query.code, client_id: process.env.SLACK_CLIENT_ID, client_secret: process.env.SLACK_CLIENT_SECRET, redirect_uri: redirectUri(appUrl) }) });
  const j = await res.json().catch(() => ({}));
  const au = j && j.authed_user;
  if(!j.ok || !au || !au.access_token || !au.id) return back('error');
  const { data: me } = await admin.from('team_profiles').select('slack_user_id, access_revoked').eq('id', st.u).maybeSingle();
  if(!me || me.access_revoked) return back('error');
  if(me.slack_user_id && me.slack_user_id !== au.id) return back('wrong-account');
  const { error } = await admin.from('slack_user_tokens').upsert({ user_id: st.u, slack_user_id: au.id, slack_team_id: (j.team && j.team.id) || null,
    access_token: au.access_token, scope: au.scope || '', connected_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if(error) return back(/does not exist|relation/i.test(error.message || '') ? 'setup' : 'error');
  if(!me.slack_user_id) await admin.from('team_profiles').update({ slack_user_id: au.id }).eq('id', st.u);
  return back('connected');
}

async function slackMeStatus(admin, userId){
  const { data, error } = await admin.from('slack_user_tokens').select('slack_user_id, connected_at').eq('user_id', userId).maybeSingle();
  if(error && /does not exist|relation/i.test(error.message || '')) return { connected: false, configured: configured(), needsSetup: true };
  return { connected: !!data, configured: configured(), slackUserId: data ? data.slack_user_id : null, connectedAt: data ? data.connected_at : null };
}

async function slackMeDisconnect(admin, userId, deps){
  const get = (deps && deps.fetch) || fetch;
  const { data } = await admin.from('slack_user_tokens').select('access_token').eq('user_id', userId).maybeSingle();
  if(data && data.access_token){ try { await get('https://slack.com/api/auth.revoke', { method: 'POST', headers: { Authorization: `Bearer ${data.access_token}` } }); } catch(e){} }
  await admin.from('slack_user_tokens').delete().eq('user_id', userId);
  return { ok: true };
}

// Sends text to a teammate's Slack DM, from the person's own Slack.
async function slackMeSend(admin, userId, o, deps){
  const get = (deps && deps.fetch) || fetch;
  const text = String((o && o.text) || '').trim().slice(0, 3000), to = String((o && o.toProfileId) || '');
  if(!text) return { error: 'Write the message first.', status: 400 };
  if(!to || to === userId) return { error: 'Pick who it’s for.', status: 400 };
  const { data: tok } = await admin.from('slack_user_tokens').select('access_token').eq('user_id', userId).maybeSingle();
  if(!tok) return { error: 'Connect your Slack first, so it goes as you.', notConnected: true, status: 400 };
  const { data: them } = await admin.from('team_profiles').select('name, slack_user_id, access_revoked').eq('id', to).maybeSingle();
  if(!them || them.access_revoked) return { error: 'They’re not on the team anymore.', status: 400 };
  if(!them.slack_user_id) return { error: `${(them.name || 'They').split(' ')[0]} has no Slack account linked in Radar (Team → Slack).`, noSlackId: true, status: 400 };
  const call = async (method, body) => {
    const r = await get(`https://slack.com/api/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${tok.access_token}` }, body: JSON.stringify(body) });
    return r.json().catch(() => ({}));
  };
  const open = await call('conversations.open', { users: them.slack_user_id });
  if(!open.ok){
    if(['invalid_auth', 'token_revoked', 'account_inactive', 'not_authed'].includes(open.error)){ await admin.from('slack_user_tokens').delete().eq('user_id', userId); return { error: 'Your Slack connection ended. Connect it again in Settings.', notConnected: true, status: 400 }; }
    return { error: `Slack said: ${open.error || 'it couldn’t open the conversation'}.`, status: 502 };
  }
  const sent = await call('chat.postMessage', { channel: open.channel.id, text, unfurl_links: false });
  if(!sent.ok) return { error: `Slack said: ${sent.error || 'it wasn’t sent'}.`, status: 502 };
  return { ok: true, channel: open.channel.id, ts: sent.ts };
}

module.exports = { slackMeAuthUrl, slackMeCallback, slackMeStatus, slackMeDisconnect, slackMeSend, sign, unsign };
