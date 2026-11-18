import { config } from './config.js';
import { db, check } from './db.js';
import { ROLES, ROLE_KEYS } from './roles.js';

async function claude(system, user){
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': config.anthropicKey(), 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: config.model, max_tokens: 3000, system, messages: [{ role: 'user', content: user }] }),
  });
  if(!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  return (j.content || []).map(b => b.text || '').join('');
}

function parseJson(text){
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

Messages are marked [CLIENT] or [TEAM]. Find what the agency still owes the client:
- request: the client asked for something to be done
- question: the client asked something that has not been answered
- promise: the agency said it would do something and has not confirmed it is done
- issue: the client reported a problem
Do NOT create tasks for thanks, greetings, FYIs, things clearly finished, or questions the team already answered later in the chat. A client message followed by a [TEAM] reply that handles it means it is done.

You are also given the currently OPEN tasks for this group. For each, decide if the chat now shows it was handled (resolve it) — otherwise leave it alone and do not create a duplicate.

Reply with ONLY JSON:
{"new_tasks":[{"title":"short imperative, max 120 chars","detail":"1-2 sentences of context","kind":"request|question|promise|issue","owner":"${ROLE_KEYS.join('|')}","priority":"low|normal|high","due_date":"YYYY-MM-DD or null","msg_ids":[message numbers],"excerpt":"short client quote"}],
 "resolve":[{"task_id":"id of an open task","reason":"why"}]}
Use priority high only for urgent wording, site down, money, or an angry client. Return empty arrays when nothing applies.`;

export async function analyzeGroup(group, since){
  const cutoff = new Date(Date.now() - config.contextDays * 86400000).toISOString();
  // The newest 150 of the last few days (asking for the oldest would miss what's new in a busy group).
  const msgs = check(await db().from('wa_messages').select('id,wa_msg_id,sender,from_team,text,ts,created_at')
    .eq('group_jid', group.jid).gte('ts', cutoff).order('ts', { ascending: false }).limit(150), 'load messages').reverse();
  if(!msgs.length) return { created: 0, resolved: 0, seen: 0 };
  // New to the agent = stored since the last check, whenever it was sent (history that arrives
  // late, or a phone that was offline, still gets read).
  const fresh = since ? msgs.filter(m => (m.created_at || m.ts) > since).length : msgs.length;
  const openTasks = check(await db().from('wa_tasks').select('id,title,kind,owner_key,status')
    .eq('group_jid', group.jid).eq('status', 'open'), 'load open tasks');
  if(!fresh && !openTasks.length) return { created: 0, resolved: 0, seen: 0 };
  if(!fresh) return { created: 0, resolved: 0, seen: 0 }; // nothing new to judge

  const corrections = await recentCorrections();
  const lines = msgs.map((m, i) => `#${i + 1} [${m.from_team ? 'TEAM' : 'CLIENT'}] ${m.ts.slice(0, 16).replace('T', ' ')} ${m.sender || '?'}: ${m.text.replace(/\s+/g, ' ').slice(0, 600)}`);
  const user = `Client group: ${group.name}\nToday: ${new Date().toISOString().slice(0, 10)}\n\nOPEN TASKS:\n${openTasks.length ? openTasks.map(t => `- id=${t.id} [${t.kind}] ${t.title} (owner ${t.owner_key})`).join('\n') : '(none)'}\n\nCHAT (oldest first):\n${lines.join('\n')}`;

  let out;
  try { out = parseJson(await claude(SYSTEM(corrections), user)); }
  catch(e){ console.error(`  extraction failed for ${group.name}: ${e.message}`); return { created: 0, resolved: 0, seen: fresh, failed: true }; }

  const now = new Date().toISOString();
  let created = 0, resolved = 0;
  const openIds = new Set(openTasks.map(t => t.id));
  for(const r of out.resolve || []){
    if(!openIds.has(r.task_id)) continue;
    const { error } = await db().from('wa_tasks').update({ status: 'answered', answered_at: now, updated_at: now }).eq('id', r.task_id);
    if(!error) resolved++;
  }
  const existingTitles = new Set(openTasks.map(t => t.title.toLowerCase()));
  for(const t of out.new_tasks || []){
    if(!t?.title || existingTitles.has(String(t.title).toLowerCase())) continue;
    const owner = ROLE_KEYS.includes(t.owner) ? t.owner : 'eric';
    const ids = (t.msg_ids || []).map(n => msgs[Number(n) - 1]?.wa_msg_id).filter(Boolean);
    const due = /^\d{4}-\d{2}-\d{2}$/.test(t.due_date || '') ? t.due_date : null;
    const { error } = await db().from('wa_tasks').insert({
      group_jid: group.jid, client: group.name.replace(/\s*\|.*$/, '').replace(/marketing/i, '').replace(/[-–—:]+\s*$/, '').trim() || group.name,
      title: String(t.title).slice(0, 300), detail: t.detail || null,
      kind: ['request', 'question', 'promise', 'issue'].includes(t.kind) ? t.kind : 'request',
      owner_key: owner, ai_owner_key: owner,
      priority: ['low', 'normal', 'high'].includes(t.priority) ? t.priority : 'normal',
      due_date: due, source_msg_ids: ids, source_excerpt: t.excerpt ? String(t.excerpt).slice(0, 400) : null,
    });
    if(error) console.error('  task insert failed:', error.message); else created++;
  }
  // Still-open tasks in an active chat stay fresh.
  await db().from('wa_tasks').update({ last_seen: now }).eq('group_jid', group.jid).eq('status', 'open');
  return { created, resolved, seen: fresh };
}
