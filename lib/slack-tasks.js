// Tasks from Slack (Nov 23), two ways:
//   1. /task @person what to do due:friday   (api/send-slack-message.js, the slash command)
//   2. by itself: Radar reads the channels it's in (Slack's Events API, same endpoint). A message
//      from a teammate that asks someone they @mention to do something becomes a task for that
//      person; a message to Radar itself (an @mention of the bot, or a DM) becomes a task for
//      whoever wrote it. The AI decides whether it is a task and words it; Radar answers in the
//      thread, and reacting with :x: takes it back. Switched off with settings.slackAutoTasks = false.
// Links come through as links: Slack sends them as <https://…|label>, so they're read out of the
// text into the task's Link (the first one) and its notes (all of them).

const { callOpenAI, OPENAI_MODEL } = require('./ai-client');
const { sendPushToUser, pushUrlFor } = require('./push-notify');

const STATE_KEY = 'slack-auto-tasks';
const UNDO = new Set(['x', 'heavy_multiplication_x', 'negative_squared_cross_mark', 'no_entry_sign']);
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ---- reading Slack's text ------------------------------------------------------------------------
const decode = s => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const LINK_RE = /<((?:https?|mailto):[^|>\s]+)(?:\|([^>]*))?>/g;
const BARE_RE = /(^|[\s(])(https?:\/\/[^\s<>)]+)/g;
// Every web link in a message, in order: Slack's <url|label> form and plain URLs too.
function slackLinks(text) {
  const out = [], seen = new Set();
  const add = (url, label) => { url = decode(url).replace(/[.,;:!?]+$/, ''); if (/^https?:/i.test(url) && !seen.has(url)) { seen.add(url); out.push({ url, label: label ? decode(label) : '' }); } };
  String(text || '').replace(LINK_RE, (m, url, label) => { add(url, label); return ''; });
  String(text || '').replace(LINK_RE, ' ').replace(BARE_RE, (m, pre, url) => { add(url, ''); return m; });
  return out;
}
// The message as a person reads it: names for people, #channel, and links as their address.
function slackPlain(text, names) {
  names = names || {};
  return decode(String(text || '')
    .replace(/<@([A-Z0-9]+)(?:\|([^>]*))?>/g, (m, id, l) => '@' + (names[id] || l || 'someone'))
    .replace(/<#([A-Z0-9]+)(?:\|([^>]*))?>/g, (m, id, l) => '#' + (l || 'channel'))
    .replace(/<!(here|channel|everyone)(?:\|[^>]*)?>/g, '@$1')
    .replace(/<!subteam\^[A-Z0-9]+(?:\|([^>]*))?>/g, (m, l) => l || '@team')
    .replace(LINK_RE, (m, url, l) => { const u = decode(url); const lab = l ? decode(l) : ''; return lab && lab !== u && lab !== u.replace(/^https?:\/\//, '') ? `${lab} (${u})` : u; }))
    .replace(/[ \t]+/g, ' ').trim();
}

// ---- the slash command ---------------------------------------------------------------------------
// /task @person the task title https://link client:harbor due:friday
//   The first link becomes the task's Link; the title keeps a link's label when it has one, so
//   "/task @ana fix <https://site.com/form|the form>" reads "fix the form", with the link on the task.
//   client: any part of the client's name ("client:harbor", "client:harbor-kitchen",
//   client:"Harbor Kitchen & Bath"). Without it, the client is found by itself (Nov 25): the
//   client's Slack channel, a link or address on the client's website, or the client's name in the
//   text (api/send-slack-message.js passes the clients and the channel's client).
//   due: today, tomorrow, a day of the week (fri, friday), 12/3 or 2026-12-03.
const cnorm = s => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
function hostOf(u) {
  try { return new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; }
}
// "harbor", "harbor-kitchen", "Harbor Kitchen & Bath" → the clients that name could be
function clientsNamed(q, clients) {
  const n = cnorm(String(q || '').replace(/[-_]/g, ' ')); if (!n) return [];
  const exact = clients.filter(c => cnorm(c.name) === n); if (exact.length) return exact;
  const words = n.split(' ');
  return clients.filter(c => { const cn = cnorm(c.name), cw = cn.split(' '); return cn.startsWith(n) || words.every(w => cw.some(x => x.startsWith(w))); });
}
// The client the text is about, when it says so plainly: the client's website (a link, or an address
// typed out), or the client's name (in full, or its first part: "Harbor Kitchen" for Harbor Kitchen & Bath).
function clientInText(text, links, clients) {
  const plain = slackPlain(text);
  const hosts = new Set([...(links || []).map(l => hostOf(l.url)), ...(plain.match(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/gi) || []).map(hostOf)].filter(Boolean));
  const byHost = clients.filter(c => { const h = hostOf(c.website || ''); return h && h.includes('.') && [...hosts].some(x => x === h || x.endsWith('.' + h)); });
  if (byHost.length === 1) return { client: byHost[0], how: 'website' };
  const t = ' ' + cnorm(plain) + ' ';
  const short = n => { const i = n.indexOf(' and '); return i > 0 && n.slice(0, i).length >= 8 && n.slice(0, i).includes(' ') ? n.slice(0, i) : null; };
  const named = clients.map(c => {
    const n = cnorm(c.name), sh = short(n);
    if (n.length >= 4 && t.includes(' ' + n + ' ')) return { c, len: n.length };
    if (sh && t.includes(' ' + sh + ' ') && clients.filter(o => cnorm(o.name).startsWith(sh + ' ')).length === 1) return { c, len: sh.length };
    return null;
  }).filter(Boolean).sort((a, b) => b.len - a.len);
  if (named.length === 1 || (named.length > 1 && named.slice(1).every(x => cnorm(named[0].c.name).includes(cnorm(x.c.name))))) return { client: named[0].c, how: 'name' };
  return null;
}
function dueFrom(raw, today) {
  raw = String(raw || '').toLowerCase().replace(/[.,;]+$/, '');
  const d = today ? new Date(today + 'T12:00:00Z') : new Date();
  const iso = x => x.toISOString().slice(0, 10);
  if (raw === 'today') return iso(d);
  if (raw === 'tomorrow' || raw === 'tmr') { d.setUTCDate(d.getUTCDate() + 1); return iso(d); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const wd = DAY_NAMES.findIndex(n => n.toLowerCase() === raw || n.toLowerCase().slice(0, 3) === raw || (raw.length >= 3 && n.toLowerCase().startsWith(raw)));
  if (wd >= 0) { d.setUTCDate(d.getUTCDate() + ((wd - d.getUTCDay() + 7) % 7)); return iso(d); }   // today, if it's that day
  const md = raw.match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (md) {
    const y = d.getUTCFullYear(), m = +md[1], dd = +md[2];
    if (m < 1 || m > 12 || dd < 1 || dd > 31) return null;
    const x = new Date(Date.UTC(y, m - 1, dd, 12));
    if (x < new Date(Date.UTC(y, d.getUTCMonth(), d.getUTCDate(), 0))) x.setUTCFullYear(y + 1);   // a day that's gone: next year
    return iso(x);
  }
  return null;
}
// opts: { clients: [{ id, name, website }], channelClient: a client (this is its Slack channel) }
function parseTaskCommandText(text, today, opts) {
  opts = opts || {};
  text = String(text || '');
  const clients = opts.clients || [];
  const mentionMatch = text.match(/<@([A-Z0-9]+)(?:\|[^>]*)?>/);
  const assigneeSlackId = mentionMatch ? mentionMatch[1] : null;
  let dueDate = null, dueAsk = null;
  const dueMatch = text.match(/\bdue:(\S+)/i);
  if (dueMatch) { dueDate = dueFrom(dueMatch[1], today); if (!dueDate) dueAsk = dueMatch[1]; }
  let rest = text.replace(mentionMatch ? mentionMatch[0] : '\u0000', '').replace(/\bdue:\S+/i, ' ');
  // client: as many words as name one client (so "client:harbor fix the form" keeps "fix the form")
  let client = null, clientHow = null, clientAsk = null, clientOptions = [];
  const cm = rest.match(/\bclient:\s*(?:"([^"]+)"|“([^”]+)”|(\S[^\n]*))/i);
  if (cm) {
    const quoted = cm[1] || cm[2];
    let used = cm[0], q = quoted || '';
    if (!quoted) {
      const words = cm[3].split(/\s+/), stop = words.findIndex((w, i) => i > 0 && (/^</.test(w) || /^https?:/i.test(w) || /^[a-z]+:/i.test(w)));
      const ws = stop > 0 ? words.slice(0, stop) : words;
      let k = ws.length;
      while (k > 1 && !clientsNamed(ws.slice(0, k).join(' '), clients).length) k--;
      q = ws.slice(0, k).join(' ');
      used = cm[0].slice(0, cm[0].indexOf(cm[3])) + q;
    }
    rest = rest.replace(used, ' ');
    const found = clientsNamed(q, clients);
    clientAsk = q.replace(/[-_]/g, ' ');
    if (found.length === 1) { client = found[0]; clientHow = 'asked'; clientAsk = null; }
    else clientOptions = found.slice(0, 6).map(c => c.name);
  }
  const links = slackLinks(text);
  // in the title a link is its label, or goes (it's kept on the task); people and channels read as names
  let title = slackPlain(rest.replace(LINK_RE, (m, url, l) => (l ? decode(l) : ' ')).replace(BARE_RE, '$1'));
  title = title.replace(/\s+([.,;:!?])/g, '$1').replace(/\s{2,}/g, ' ').replace(/^[\s:–—-]+|[\s:–—-]+$/g, '').trim();
  if (!title && links[0]) title = links[0].label || 'Look at ' + links[0].url.replace(/^https?:\/\//, '').slice(0, 60);
  const description = links.length > 1 ? 'Links:\n' + links.map(l => `- ${l.label ? l.label + ': ' : ''}${l.url}`).join('\n') : null;
  // no client: asked for: the channel's client, else what the text says
  if (!cm && clients.length) {
    if (opts.channelClient) { client = opts.channelClient; clientHow = 'channel'; }
    else { const f = clientInText(text, links, clients); if (f) { client = f.client; clientHow = f.how; } }
  }
  return { assigneeSlackId, dueDate, dueAsk, title, link: links[0] ? links[0].url : null, links, description, client, clientHow, clientAsk, clientOptions };
}
const TASK_HELP = [
  '*Add a task in Radar*',
  '`/task @person what to do`',
  'Add any of these after it:',
  '• a link: paste it and it goes on the task',
  '• `client:harbor`: part of the client’s name is enough (`client:harbor-kitchen`, or `client:"Harbor Kitchen & Bath"`). Without it, Radar finds the client from the client’s channel, a link to their website, or their name in the task.',
  '• `due:friday`: also `today`, `tomorrow`, `fri`, `12/3` or `2026-12-03`',
  'Example: `/task @Ana fix the contact form client:harbor due:fri https://harborkb.com/contact`',
].join('\n');

// ---- small helpers -------------------------------------------------------------------------------
async function slackApi(method, body) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return { ok: false, error: 'not_configured' };
  try {
    const r = await fetch(`https://slack.com/api/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    return await r.json();
  } catch (e) { return { ok: false, error: String(e) }; }
}
async function getJson(admin, key, dflt) {
  const { data } = await admin.from('app_storage').select('value').eq('key', key).maybeSingle();
  try { return data && data.value ? JSON.parse(data.value) : dflt; } catch (e) { return dflt; }
}
async function putJson(admin, key, value) { await admin.from('app_storage').upsert({ key, value: JSON.stringify(value) }, { onConflict: 'key' }); }
function teamToday(tz, now) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long' }).formatToParts(now || new Date());
  const g = t => (p.find(x => x.type === t) || {}).value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, weekday: g('weekday') };
}
const fmtDue = d => { const x = new Date(d + 'T12:00:00Z'); return `${DAY_NAMES[x.getUTCDay()].slice(0, 3)}, ${x.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`; };
const keep = (state) => { // entries from the last 14 days
  const cut = Date.now() - 14 * 864e5;
  Object.keys(state.done || {}).forEach(k => { if (new Date(state.done[k].at || 0).getTime() < cut) delete state.done[k]; });
};

// ---- the AI reads the message --------------------------------------------------------------------
function slackTaskPrompt(o) {
  return `You read one Slack message from a marketing agency's team chat and decide whether it hands someone a piece of work to do. Reply with JSON only, no other text:
{"task": true or false, "assignees": ["Name"], "title": "...", "notes": "...", "due": "YYYY-MM-DD or empty", "client": "exact client name or empty", "priority": "high or normal"}

Today is ${o.weekday}, ${o.today}.
Who wrote it: ${o.sender}.
${o.toRadar ? `They wrote it to Radar, the agency's task app${o.people.length ? '' : ', so what they need to do is a task for them'}.\n` : ''}People mentioned who can get the task: ${o.people.length ? o.people.join(', ') : 'none'}.
Where: ${o.where}.
Clients (pick one only when the message is clearly about it): ${o.clients.join('; ') || 'none'}.
Message:
"""
${o.text}
"""

Rules:
- "task" is true only when the message asks or tells someone to do a concrete piece of work${o.toRadar ? ', or tells Radar something the writer needs to do' : ''}. It is false for questions to answer in the chat, FYIs, thanks, status updates, jokes, work already done, and scheduling chat.
- "assignees": who is asked to do it, from the people mentioned, written exactly as listed.${o.toRadar && !o.people.length ? ` Use "${o.sender}".` : ''}
- "title": the work, starting with a verb, under 70 characters, plain words; no people's names, no links, no dates.
- "notes": useful details from the message in plain text, under 400 characters, with any links kept as they are. Empty when the title says it all.
- "due": only when the message gives a day or date ("by Friday", "tomorrow", "Dec 3"), worked out from today. Otherwise empty.
- "priority": "high" only when the message says it is urgent, ASAP or needed today.`;
}
function parseAi(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (e) { return null; }
}

// ---- by itself: one event from Slack -------------------------------------------------------------
async function handleSlackEvent(admin, payload, opts) {
  opts = opts || {};
  const ev = payload && payload.event || {};
  const settingsRow = await getJson(admin, 'settings', {});
  const state = await getJson(admin, STATE_KEY, {});
  state.done = state.done || {};
  state.lastEventAt = new Date().toISOString();
  if (settingsRow.slackAutoTasks === false) { await putJson(admin, STATE_KEY, state); return { skipped: 'off' }; }
  if (ev.type === 'reaction_added') { const r = await undoFromReaction(admin, ev, state); await putJson(admin, STATE_KEY, state); return r; }
  if (ev.type !== 'message' && ev.type !== 'app_mention') return { skipped: 'type' };
  if (ev.bot_id || (ev.subtype && ev.subtype !== 'file_share' && ev.subtype !== 'thread_broadcast')) return { skipped: 'not a person’s new message' };
  if (!ev.user || !(ev.text || (ev.files && ev.files.length))) return { skipped: 'empty' };
  const key = `${ev.channel}:${ev.ts}`;
  if (state.done[key]) return { skipped: 'already read' };   // a message and its app_mention, or Slack sending it again
  const botUser = ((payload.authorizations || [])[0] || {}).user_id || opts.botUserId || null;

  const { data: profiles } = await admin.from('team_profiles').select('id, name, slack_user_id, access_revoked');
  const bySlack = {};
  (profiles || []).forEach(p => { if (p.slack_user_id && !p.access_revoked) bySlack[p.slack_user_id] = p; });
  const sender = bySlack[ev.user];
  if (!sender) return { skipped: 'not someone on the team' };
  const mentioned = [...new Set([...String(ev.text || '').matchAll(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g)].map(m => m[1]))];
  const toRadar = (botUser && mentioned.includes(botUser)) || ev.channel_type === 'im';
  const people = mentioned.filter(id => id !== botUser && bySlack[id]).map(id => bySlack[id]);
  if (!people.length && !toRadar) return { skipped: 'nobody asked' };

  // where: a client's channel says which client
  const [{ data: chMap }, { data: clientRows }] = await Promise.all([
    admin.from('slack_client_channels').select('client_id, slack_channel_id, slack_channel_name'),
    admin.from('clients').select('id, name, website, status, deleted_at'),
  ]);
  const live = (clientRows || []).filter(c => !c.deleted_at);
  const chClient = (chMap || []).find(m => m.slack_channel_id === ev.channel);
  const chName = chClient && chClient.slack_channel_name;
  const tz = settingsRow.timezone || process.env.TEAM_TIMEZONE || 'America/New_York';
  const { date: today, weekday } = teamToday(tz, opts.now);
  const names = {}; Object.values(bySlack).forEach(p => { names[p.slack_user_id] = p.name; });
  if (botUser) names[botUser] = 'Radar';
  const plain = slackPlain(ev.text, names);
  const fileLines = (ev.files || []).map(f => `${f.name || f.title || 'a file'}${f.permalink ? ` (${f.permalink})` : ''}`);
  const where = ev.channel_type === 'im' ? 'a direct message to Radar' : chClient ? `#${chName || 'a channel'}, the channel for ${(live.find(c => c.id === chClient.client_id) || {}).name || 'a client'}` : 'a team channel';

  let ai = null;
  if (process.env.OPENAI_API_KEY) {
    const r = await callOpenAI([{ role: 'user', content: slackTaskPrompt({ today, weekday, sender: sender.name, toRadar, people: people.map(p => p.name), where, clients: live.filter(c => c.status !== 'Paused').map(c => c.name).slice(0, 120), text: plain + (fileLines.length ? `\n[Files attached: ${fileLines.join('; ')}]` : '') }) }], null,
      { model: settingsRow.openaiModel || OPENAI_MODEL, webSearch: false });
    if (r.ok) ai = parseAi(r.reply);
  }
  state.done[key] = { at: new Date().toISOString(), tasks: [] };
  if (!ai || ai.task !== true || !String(ai.title || '').trim()) { keep(state); await putJson(admin, STATE_KEY, state); return { skipped: ai ? 'not a task' : 'AI did not answer' }; }

  // who gets it
  let assignees = (Array.isArray(ai.assignees) ? ai.assignees : []).map(n => people.find(p => p.name.toLowerCase() === String(n).trim().toLowerCase())).filter(Boolean);
  if (!assignees.length) assignees = people.length ? [people[0]] : [sender];
  assignees = [...new Map(assignees.map(p => [p.id, p])).values()];
  const links = slackLinks(ev.text);
  const fileLink = (ev.files || []).map(f => f.permalink).find(Boolean) || null;
  // the channel's client, else the one the AI named, else one the message names plainly (its website or name)
  const client = chClient ? live.find(c => c.id === chClient.client_id)
    : live.find(c => c.name.toLowerCase() === String(ai.client || '').trim().toLowerCase())
      || ((clientInText(ev.text || '', links, live) || {}).client) || null;
  const due = /^\d{4}-\d{2}-\d{2}$/.test(String(ai.due || '')) && ai.due >= today ? ai.due : null;
  const perm = await slackApi('chat.getPermalink', { channel: ev.channel, message_ts: ev.ts });
  const notes = [String(ai.notes || '').trim(),
    links.length > 1 ? 'Links:\n' + links.map(l => `- ${l.label ? l.label + ': ' : ''}${l.url}`).join('\n') : '',
    fileLines.length ? 'Files in Slack:\n' + fileLines.map(f => `- ${f}`).join('\n') : '',
    `From Slack, ${sender.name}${perm && perm.ok && perm.permalink ? `: ${perm.permalink}` : ''}`].filter(Boolean).join('\n\n');
  const title = String(ai.title).trim().slice(0, 120);
  const made = [];
  for (const p of assignees) {
    const row = { title, description: notes, priority: ai.priority === 'high' ? 'high' : 'medium', status: 'todo', assigner_id: sender.id, assignee_id: p.id,
      due_date: due, client_id: client ? client.id : null, link: (links[0] && links[0].url) || fileLink };
    let res = await admin.from('tasks').insert(row).select().single();
    if (res.error && /link|client_id/.test(res.error.message || '')) { const { link, client_id, ...rest } = row; res = await admin.from('tasks').insert(rest).select().single(); }
    if (res.error || !res.data) continue;
    made.push({ task: res.data, person: p });
    if (p.id !== sender.id) {
      await admin.from('notifications').insert({ user_id: p.id, type: 'task_assigned', title: 'New task assigned to you', body: `${sender.name} (from Slack): "${title}"`, target_view: 'tasks', target_id: res.data.id });
      try { await sendPushToUser(admin, p.id, 'New task assigned to you', `${sender.name} (from Slack): "${title}"`, pushUrlFor('tasks', res.data.id)); } catch (e) {}
    }
    await admin.from('activity_log').insert({ client_id: client ? client.id : null, user_id: sender.id, action_type: 'task_created', description: `${sender.name} added “${title}” for ${p.name} from Slack.` }).then(() => {}, () => {});
  }
  if (!made.length) { keep(state); await putJson(admin, STATE_KEY, state); return { skipped: 'not saved' }; }

  // the answer in the thread, with how to take it back
  const who = made.map(m => m.person.id === sender.id ? 'you' : `<@${m.person.slack_user_id}>`);
  const whoTxt = who.length > 1 ? who.slice(0, -1).join(', ') + ' and ' + who[who.length - 1] : who[0];
  const appUrl = (opts.appUrl || process.env.APP_URL || '').replace(/\/+$/, '');
  const text = `Added to Radar for ${whoTxt}: *${title}*${due ? ` · due ${fmtDue(due)}` : ''}${client ? ` · ${client.name}` : ''}${appUrl ? ` · <${appUrl}/#tasks|Open in Radar>` : ''}\nNot a task? React to this with :x: and it comes off Radar.`;
  const reply = await slackApi('chat.postMessage', { channel: ev.channel, thread_ts: ev.thread_ts || ev.ts, text, unfurl_links: false });
  state.done[key] = { at: new Date().toISOString(), tasks: made.map(m => m.task.id), reply: reply && reply.ok ? reply.ts : null, channel: ev.channel, by: ev.user, people: made.map(m => m.person.slack_user_id), title };
  if (reply && reply.ok) state.done[`${ev.channel}:${reply.ts}`] = { at: state.done[key].at, of: key };
  state.lastTaskAt = state.done[key].at; state.lastTaskTitle = title;
  keep(state);
  await putJson(admin, STATE_KEY, state);
  return { created: made.length, title, assignees: made.map(m => m.person.name), due, client: client ? client.name : null };
}

// Reacting with :x: on Radar's reply (or the message) takes the task back off Radar, if it hasn't
// been started or finished. Only whoever wrote the message or got the task can.
async function undoFromReaction(admin, ev, state) {
  if (!UNDO.has(ev.reaction) || !ev.item || ev.item.type !== 'message') return { skipped: 'not an undo' };
  let k = `${ev.item.channel}:${ev.item.ts}`, e = state.done[k];
  if (e && e.of) { k = e.of; e = state.done[k]; }
  if (!e || !e.tasks || !e.tasks.length) return { skipped: 'no task from that message' };
  if (ev.user !== e.by && !(e.people || []).includes(ev.user)) return { skipped: 'not theirs' };
  const { data: rows } = await admin.from('tasks').select('id, status').in('id', e.tasks);
  const gone = (rows || []).filter(t => t.status === 'todo').map(t => t.id);
  if (gone.length) await admin.from('tasks').delete().in('id', gone);
  if (e.reply) await slackApi('chat.update', { channel: e.channel, ts: e.reply, text: gone.length ? `Taken off Radar: ~${e.title}~` : `${e.title} has already been started, so it stays on Radar.` });
  e.tasks = e.tasks.filter(id => !gone.includes(id));
  return { removed: gone.length };
}

module.exports = { slackLinks, slackPlain, parseTaskCommandText, clientInText, clientsNamed, dueFrom, teamToday, fmtDue, TASK_HELP, handleSlackEvent, slackTaskPrompt, STATE_KEY };
