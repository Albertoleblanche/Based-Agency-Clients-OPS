import { config } from './config.js';
import { db, check } from './db.js';
import { ROLES, ROLE_KEYS } from './roles.js';
import { clientForGroup, clientPlan } from './clients.js';

const MOODS = ['happy', 'neutral', 'frustrated', 'angry'];

export async function claude(system, user, opts = {}){
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': config.anthropicKey(), 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: opts.model || config.model, max_tokens: opts.maxTokens || 3000, system, messages: [{ role: 'user', content: user }] }),
  });
  if(!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  return (j.content || []).map(b => b.text || '').join('');
}

export function parseJson(text){
  const m = text.match(/\{[\s\S]*\}/);
  if(!m) throw new Error('No JSON in model reply');
  return JSON.parse(m[0]);
}

// Reassignments made in Radar become teaching examples for the next run.
async function recentCorrections(){
  const { data } = await db().from('wa_tasks').select('title,ai_owner_key,owner_key,status')
    .not('ai_owner_key', 'is', null).order('updated_at', { ascending: false }).limit(80);
  const rows = data || [];
  return {
    reassigned: rows.filter(t => t.status !== 'dismissed' && t.owner_key && t.owner_key !== t.ai_owner_key).slice(0, 15),
    notTasks: rows.filter(t => t.status === 'dismissed').slice(0, 15),
  };
}

const SYSTEM = ({ reassigned, notTasks }) => `You read WhatsApp group chats between a marketing agency (Based Agency) and one client, and keep the agency's to-do list honest.

TEAM AND WHO HANDLES WHAT:
${ROLES.map(r => `- ${r.key}: ${r.does}`).join('\n')}
If it is unclear, assign "eric" (main point of contact). Never invent other owners.
${reassigned.length ? '\nLEARN FROM PAST CORRECTIONS (the team reassigned these):\n' + reassigned.map(c => `- "${c.title}" → ${c.owner_key} (not ${c.ai_owner_key})`).join('\n') : ''}
${notTasks.length ? '\nTHE TEAM MARKED THESE AS NOT REAL TASKS — do not create similar ones:\n' + notTasks.map(c => `- "${c.title}"`).join('\n') : ''}

Messages are marked [CLIENT] or [TEAM]. A client can have the same first name as someone on the team: the [TEAM] or [CLIENT] mark says who wrote it, never the name. Find what the agency still owes the client:
- request: the client asked for something to be done
- question: the client asked something that has not been answered
- promise: the agency said it would do something and has not confirmed it is done
- issue: the client reported a problem
Do NOT create tasks for thanks, greetings, FYIs, things clearly finished, or questions the team already answered later in the chat. A client message followed by a [TEAM] reply that handles it means it is done.

You are also given the currently OPEN tasks for this group. For each, decide if the chat now shows it was handled (resolve it) — otherwise leave it alone and do not create a duplicate.

You are also given RECENTLY CLOSED tasks (the team marked them done, or the chat showed them answered), each with when it was closed. If the client's messages AFTER that time follow up on one of them — they ask for more on it, say it isn't fixed or isn't right, or send something the agency now has to act on (files, details, an approval it was waiting for) — REOPEN it with a one-sentence reason instead of creating a new task. Do not reopen for thanks, likes, "looks good", or anything that only confirms it is fine. Never both reopen a task and create a new one for the same thing.

Reply with ONLY JSON:
{"new_tasks":[{"title":"short imperative, max 120 chars","detail":"1-2 sentences of context","kind":"request|question|promise|issue","owner":"${ROLE_KEYS.join('|')}","priority":"low|normal|high","due_date":"YYYY-MM-DD or null","msg_ids":[message numbers],"excerpt":"short client quote","in_plan":true}],
 "resolve":[{"task_id":"id of an open task","reason":"why"}],
 "reopen":[{"task_id":"id of a recently closed task","reason":"what the client now needs, 1 sentence","msg_ids":[message numbers],"excerpt":"short client quote"}],
 "mood":{"level":"happy|neutral|frustrated|angry","reason":"1 short sentence on why","excerpt":"the client's own words that show it, max 20 words"}}
Use priority high only for urgent wording, site down, money, or an angry client. Return empty arrays when nothing applies.
MOOD is how the CLIENT comes across across all the [CLIENT] messages shown, most recent weighing most: happy (thanks, praise, good results), neutral (ordinary requests and questions), frustrated (impatience, repeating themselves, "still", "again", disappointment), angry (complaints, threats to leave, harsh words). Judge only the client, never the team. Use null for mood when the client wrote nothing in these messages.
IN THEIR PLAN: you may be told what the client pays the agency for. Set "in_plan": false on a new task only when it clearly is new work outside that (they pay for Google Ads only and ask for a new website page, a logo, or a blog post), and add "plan_note": under 90 characters, what the work is and what they pay for ("A new landing page: they pay for Google Ads only"). Fixes, reports, questions, access, meetings, issues and anything about work they already pay for are in their plan. When you aren't told what they pay for, or you're unsure, true.`;

export async function analyzeGroup(group, since){
  const cutoff = new Date(Date.now() - config.contextDays * 86400000).toISOString();
  // The newest 150 of the last few days (asking for the oldest would miss what's new in a busy group).
  const msgs = check(await db().from('wa_messages').select('id,wa_msg_id,sender,from_team,text,ts,created_at')
    .eq('group_jid', group.jid).gte('ts', cutoff).order('ts', { ascending: false }).limit(150), 'load messages').reverse();
  if(!msgs.length) return { created: 0, resolved: 0, reopened: 0, seen: 0 };
  // New to the agent = stored since the last check, whenever it was sent (history that arrives
  // late, or a phone that was offline, still gets read).
  const fresh = since ? msgs.filter(m => (m.created_at || m.ts) > since).length : msgs.length;
  const openTasks = check(await db().from('wa_tasks').select('id,title,kind,owner_key,status')
    .eq('group_jid', group.jid).eq('status', 'open'), 'load open tasks');
  if(!fresh) return { created: 0, resolved: 0, reopened: 0, seen: 0 }; // nothing new to judge
  // Closed in the last two weeks (marked done in Radar, or answered): a client's follow-up on one
  // reopens it rather than being skipped as an update, or turning into a duplicate.
  const closedTasks = check(await db().from('wa_tasks').select('id,title,kind,owner_key,status,answered_at,updated_at,source_msg_ids,source_excerpt')
    .eq('group_jid', group.jid).in('status', ['done', 'answered']).gte('updated_at', new Date(Date.now() - 14 * 86400000).toISOString())
    .order('updated_at', { ascending: false }).limit(8), 'load closed tasks');

  const corrections = await recentCorrections();
  const lines = msgs.map((m, i) => `#${i + 1} [${m.from_team ? 'TEAM' : 'CLIENT'}] ${m.ts.slice(0, 16).replace('T', ' ')} ${m.sender || '?'}: ${m.text.replace(/\s+/g, ' ').slice(0, 600)}`);
  const closedAt = t => (t.answered_at || t.updated_at || '').slice(0, 16).replace('T', ' ');
  // what the client pays for (Nov 25), so a request outside it is labelled for whoever reviews it
  const plan = await clientForGroup(group).then(c => clientPlan(c)).catch(() => null);
  const user = `Client group: ${group.name}\nToday: ${new Date().toISOString().slice(0, 10)}\n${plan ? `What the client pays the agency for: ${plan}\n` : ''}\nOPEN TASKS:\n${openTasks.length ? openTasks.map(t => `- id=${t.id} [${t.kind}] ${t.title} (owner ${t.owner_key})`).join('\n') : '(none)'}\n\nRECENTLY CLOSED TASKS:\n${closedTasks.length ? closedTasks.map(t => `- id=${t.id} [${t.kind}] ${t.title} (${t.status === 'answered' ? 'answered in the chat' : 'marked done'} ${closedAt(t)})`).join('\n') : '(none)'}\n\nCHAT (oldest first):\n${lines.join('\n')}`;

  let out;
  try { out = parseJson(await claude(SYSTEM(corrections), user)); }
  catch(e){ console.error(`  extraction failed for ${group.name}: ${e.message}`); return { created: 0, resolved: 0, reopened: 0, seen: fresh, failed: true }; }

  const now = new Date().toISOString();
  let created = 0, resolved = 0;
  const openIds = new Set(openTasks.map(t => t.id));
  for(const r of out.resolve || []){
    if(!openIds.has(r.task_id)) continue;
    const { error } = await db().from('wa_tasks').update({ status: 'answered', answered_at: now, updated_at: now }).eq('id', r.task_id);
    if(!error) resolved++;
  }
  // A follow-up on a closed task: back to open, with what the client now needs and their message outlined.
  let reopened = 0;
  const closedById = new Map(closedTasks.map(t => [t.id, t]));
  const reopenedTitles = [];
  const items = [];   // what's new for someone, for their Radar notification (Nov 23)
  const clientName = group.name.replace(/\s*\|.*$/, '').replace(/marketing/i, '').replace(/[-–—:]+\s*$/, '').trim() || group.name;
  for(const r of out.reopen || []){
    const t = closedById.get(r.task_id);
    if(!t) continue;
    const ids = (r.msg_ids || []).map(n => msgs[Number(n) - 1]?.wa_msg_id).filter(Boolean);
    const { error } = await db().from('wa_tasks').update({
      status: 'open', answered_at: null, updated_at: now, last_seen: now,
      detail: r.reason ? `The client followed up: ${String(r.reason).slice(0, 400)}` : 'The client followed up after it was closed.',
      source_msg_ids: [...new Set([...(t.source_msg_ids || []), ...ids])],
      source_excerpt: r.excerpt ? String(r.excerpt).slice(0, 400) : t.source_excerpt,
    }).eq('id', t.id);
    if(error) console.error('  reopen failed:', error.message); else { reopened++; reopenedTitles.push(t.title.toLowerCase()); items.push({ id: t.id, title: t.title, client: clientName, owner_key: t.owner_key, reopened: true }); }
  }
  const existingTitles = new Set([...openTasks.map(t => t.title.toLowerCase()), ...reopenedTitles]);
  for(const t of out.new_tasks || []){
    if(!t?.title || existingTitles.has(String(t.title).toLowerCase())) continue;
    const owner = ROLE_KEYS.includes(t.owner) ? t.owner : 'eric';
    const ids = (t.msg_ids || []).map(n => msgs[Number(n) - 1]?.wa_msg_id).filter(Boolean);
    const due = /^\d{4}-\d{2}-\d{2}$/.test(t.due_date || '') ? t.due_date : null;
    const row = {
      group_jid: group.jid, client: clientName,
      title: String(t.title).slice(0, 300), detail: t.detail || null,
      kind: ['request', 'question', 'promise', 'issue'].includes(t.kind) ? t.kind : 'request',
      owner_key: owner, ai_owner_key: owner,
      priority: ['low', 'normal', 'high'].includes(t.priority) ? t.priority : 'normal',
      due_date: due, source_msg_ids: ids, source_excerpt: t.excerpt ? String(t.excerpt).slice(0, 400) : null,
    };
    // outside what they pay for: labelled, and the person who reviews it decides (Nov 25)
    if(plan && t.in_plan === false){ row.out_of_scope = true; row.scope_note = t.plan_note ? String(t.plan_note).slice(0, 160) : null; }
    let { data: made, error } = await db().from('wa_tasks').insert(row).select('id').single();
    if(error && /out_of_scope|scope_note/i.test(error.message || '')){   // before addendum-out-of-scope.sql
      delete row.out_of_scope; delete row.scope_note;
      ({ data: made, error } = await db().from('wa_tasks').insert(row).select('id').single());
    }
    if(error) console.error('  task insert failed:', error.message); else { created++; items.push({ id: made && made.id, title: String(t.title).slice(0, 300), client: clientName, owner_key: owner, high: t.priority === 'high' }); }
  }
  // Still-open tasks in an active chat stay fresh.
  await db().from('wa_tasks').update({ last_seen: now }).eq('group_jid', group.jid).eq('status', 'open');
  // How the client comes across this week, for Health (Nov 24)
  await saveMood(group, msgs, out.mood, clientName);
  return { created, resolved, reopened, seen: fresh, items };
}

// The client's mood from a check, only when they wrote something in what was read (Nov 24).
export async function saveMood(group, msgs, mood, clientName, deps = {}){
  const DB = deps.db || db;
  if(!mood || !MOODS.includes(mood.level) || !msgs.some(m => !m.from_team)) return false;
  let client = null; try { client = await (deps.clientForGroup || clientForGroup)(group); } catch(e){}
  const { error } = await DB().from('wa_moods').insert({ group_jid: group.jid, client_id: client ? client.id : null, client: client ? client.name : clientName,
    level: mood.level, reason: mood.reason ? String(mood.reason).slice(0, 300) : null, excerpt: mood.excerpt ? String(mood.excerpt).slice(0, 300) : null });
  if(error){ if(!/wa_moods|relation|schema cache/i.test(error.message)) console.error('  mood not saved:', error.message); return false; }
  return true;
}
