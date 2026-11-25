// The live watch (Nov 24). A client message reaches Radar the moment it's sent; 90 seconds after a
// client stops writing in a group (5 minutes at most while they keep going), a quick, cheap read of
// what's new answers four things:
//   • Is it urgent? (site down, leads stopped, money, an angry client, something due today)
//     → an item straight away, marked urgent, and an alert to its owner (alerts.js)
//   • Does it still need an answer from the team? → if nobody answers within the work hours set,
//     the client's owner is nudged
//   • Does it say something about the account? (pausing, cancelling, budget, a competitor, growing,
//     a new service, a referral) → for Radar's admins
//   • Does it give the client's own details? (their contact, email, phone, website) → suggested on
//     the client in Radar, for someone to accept
// The regular checks still do the full read. Nothing is ever sent to WhatsApp.
import { config } from './config.js';
import { db, check } from './db.js';
import { ROLES, ROLE_KEYS } from './roles.js';
import { claude, parseJson } from './extract.js';
import { clientForGroup, clientDetails, cleanGroupName, sameDetail } from './clients.js';
import { sendPending } from './alerts.js';

const QUIET_MS = 90000, MAX_WAIT_MS = 5 * 60000, LIVE_MS = 20 * 60000;
const timers = new Map();      // group jid -> { timer, first }
const lastRead = new Map();    // group jid -> the newest message time the watch has read
const SIGNAL_KINDS = ['pause', 'cancel', 'budget', 'competitor', 'unhappy', 'expansion', 'new_service', 'referral', 'hiring', 'other'];
const FIELDS = ['contact', 'email', 'phone', 'website'];

// Called with each batch of stored messages; only live client messages count (not the history
// WhatsApp sends after linking, and not the team's own).
export function watchMessages(rows, now = Date.now()){
  const jids = new Set(rows.filter(r => !r.from_team && now - new Date(r.ts).getTime() < LIVE_MS).map(r => r.group_jid));
  jids.forEach(j => watchSoon(j, now));
  return jids.size;
}
export function watchSoon(jid, now = Date.now()){
  const cur = timers.get(jid);
  if(cur) clearTimeout(cur.timer);
  const first = cur ? cur.first : now;
  const wait = Math.max(0, Math.min(QUIET_MS, first + MAX_WAIT_MS - now));
  const timer = setTimeout(() => { timers.delete(jid); watchGroup(jid).catch(e => console.error(`Watch failed (${jid}):`, e.message)); }, wait);
  if(timer.unref) timer.unref();
  timers.set(jid, { timer, first });
}

const SYSTEM = () => `You watch WhatsApp group chats between a marketing agency (Based Agency) and one of its clients, right as the client writes. Messages are marked [CLIENT] or [TEAM]; the ones marked NEW just arrived. A client can have the same first name as someone on the team: the [TEAM] or [CLIENT] mark says who wrote it, never the name. Judge only the NEW client messages, using the rest as context.

TEAM AND WHO HANDLES WHAT:
${ROLES.map(r => `- ${r.key}: ${r.does}`).join('\n')}

Answer four questions:
1. URGENT: does a NEW client message need the team today, before the next regular check? Only for: the website is down or broken, forms or calls or leads stopped working, ads stopped or overspending, payments or billing problems, legal or account-access problems, a clearly angry or upset client, or something the client says must happen today. Ordinary requests and questions are NOT urgent. If an OPEN item already covers it, it is not new: return null.
2. NEEDS_REPLY: after the NEW messages, does the client still need an answer or acknowledgement from the team? false for thanks, "ok", emojis, FYIs, or when the team already answered after it.
3. SIGNALS: does a NEW client message say something the agency's owner should know about the account? Only when the client says it plainly:
   risks: pause (wants to pause or stop for a while), cancel (ending, not renewing), budget (cutting or questioning spend), competitor (another agency or doing it themselves), unhappy (unhappy with results, value or service)
   openings: expansion (new location, more crews, growing), new_service (asks about a service they don't have), referral (mentions someone who could use the agency), hiring
   Never guess. Return [] when nothing applies.
4. DETAILS: does a NEW client message give the client business's own details: the main contact person's name, their business email, a phone number for the business or contact, or the business website? Only values written in the messages, exactly as written. Not the agency's details, not other companies'. Return [] when none.

Reply with ONLY JSON:
{"urgent":null or {"title":"short imperative item title, max 100 chars","reason":"1 sentence on why it can't wait","kind":"issue|request|question","owner":"${ROLE_KEYS.join('|')}","msg_ids":[numbers],"excerpt":"the client's words, max 25"},
 "needs_reply":true|false,
 "signals":[{"type":"risk|opportunity","kind":"${SIGNAL_KINDS.join('|')}","summary":"1 sentence for the owner","msg_ids":[numbers],"excerpt":"the client's words, max 25"}],
 "details":[{"field":"contact|email|phone|website","value":"as written","msg_ids":[numbers],"excerpt":"the client's words, max 25"}]}`;

// The watch needs addendum-whatsapp-insights.sql: until it's run, nothing is read (no AI spent).
// Checked again every ten minutes.
let ready = { at: 0, ok: false, said: false };
async function watchReady(DB){
  if(Date.now() - ready.at < 600000) return ready.ok;
  const { error } = await DB().from('wa_alerts').select('id').limit(1);
  ready = { at: Date.now(), ok: !error, said: ready.said };
  if(error && !ready.said){ ready.said = true; console.log('Live watch is off until addendum-whatsapp-insights.sql is run in Supabase.'); }
  if(!error) ready.said = false;
  return ready.ok;
}

export async function watchGroup(jid, deps = {}){
  const DB = deps.db || db, ai = deps.claude || claude, send = deps.sendPending || sendPending;
  if(!deps.db && !(await watchReady(DB))) return null;
  const { data: group } = await DB().from('wa_groups').select('jid,name,client_id,active').eq('jid', jid).maybeSingle();
  if(!group || !group.active) return null;
  const msgs = check(await DB().from('wa_messages').select('wa_msg_id,sender,from_team,text,ts').eq('group_jid', jid)
    .gte('ts', new Date(Date.now() - 3 * 86400000).toISOString()).order('ts', { ascending: false }).limit(30), 'watch messages').reverse();
  const after = lastRead.get(jid) || new Date(Date.now() - LIVE_MS).toISOString();
  const fresh = msgs.filter(m => !m.from_team && m.ts > after);
  if(!fresh.length) return null;
  lastRead.set(jid, msgs[msgs.length - 1].ts);

  const client = await (deps.clientForGroup || clientForGroup)(group).catch(() => null);
  const cname = client ? client.name : cleanGroupName(group.name);
  const have = clientDetails(client);
  const open = check(await DB().from('wa_tasks').select('id,title,urgent_at').eq('group_jid', jid).eq('status', 'open'), 'watch open items');
  const freshIds = new Set(fresh.map(m => m.wa_msg_id));
  const lines = msgs.map((m, i) => `#${i + 1}${freshIds.has(m.wa_msg_id) ? ' NEW' : ''} [${m.from_team ? 'TEAM' : 'CLIENT'}] ${m.ts.slice(0, 16).replace('T', ' ')} ${m.sender || '?'}: ${String(m.text).replace(/\s+/g, ' ').slice(0, 500)}`);
  const user = `Client: ${cname}\nNow: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC\n`
    + `What Radar already has for them: contact ${have.contact || '(none)'}, email ${have.email || '(none)'}, phone ${have.phone || '(none)'}, website ${have.website || '(none)'}\n\n`
    + `OPEN ITEMS:\n${open.length ? open.map(t => `- ${t.title}`).join('\n') : '(none)'}\n\nMESSAGES:\n${lines.join('\n')}`;

  let out;
  try { out = parseJson(await ai(SYSTEM(), user, { model: config.watchModel, maxTokens: 1200 })); }
  catch(e){ console.error(`  watch: couldn't read ${cname}: ${e.message}`); return null; }
  const byNum = n => msgs[Number(n) - 1];
  const newest = fresh[fresh.length - 1];
  const result = { urgent: null, waiting: false, signals: 0, details: 0 };
  const clip = (s, n) => s ? String(s).slice(0, n) : null;

  // 1. Urgent: an item now (unless one was made for this group in the last six hours), and its alert
  const u = out.urgent;
  if(u && u.title && !open.some(t => t.urgent_at && Date.now() - new Date(t.urgent_at).getTime() < 6 * 3600000)){
    const owner = ROLE_KEYS.includes(u.owner) ? u.owner : 'eric';
    const src = (u.msg_ids || []).map(byNum).filter(Boolean);
    const at = new Date().toISOString();
    const { data: task, error } = await DB().from('wa_tasks').insert({
      group_jid: jid, client: cname, title: String(u.title).slice(0, 300), detail: clip(u.reason, 600), status: 'open',
      kind: ['issue', 'request', 'question'].includes(u.kind) ? u.kind : 'issue', owner_key: owner, ai_owner_key: owner, priority: 'high',
      source_msg_ids: src.map(m => m.wa_msg_id), source_excerpt: clip(u.excerpt, 400), urgent_at: at,
    }).select('id').single();
    if(error) console.error('  watch: urgent item not saved:', error.message);
    else {
      const msg = src[src.length - 1] || newest;
      await DB().from('wa_alerts').upsert({ kind: 'urgent', group_jid: jid, client_id: client ? client.id : null, wa_msg_id: msg.wa_msg_id, asked_at: msg.ts,
        task_id: task.id, owner_key: owner, reason: clip(u.reason, 400), excerpt: clip(u.excerpt, 300) }, { onConflict: 'kind,group_jid,wa_msg_id', ignoreDuplicates: true });
      result.urgent = { id: task.id, title: u.title };
      console.log(`  watch: URGENT in ${cname}: ${u.title}`);
    }
  }
  // 2. Needs a reply: watched until someone on the team writes in the group
  if(out.needs_reply === true){
    await DB().from('wa_alerts').upsert({ kind: 'waiting', group_jid: jid, client_id: client ? client.id : null, wa_msg_id: newest.wa_msg_id, asked_at: newest.ts,
      excerpt: clip(newest.text, 300) }, { onConflict: 'kind,group_jid,wa_msg_id', ignoreDuplicates: true });
    result.waiting = true;
  }
  // 3. Account signals: one of a kind per client every two weeks
  for(const s of Array.isArray(out.signals) ? out.signals : []){
    if(!s || !s.summary || !['risk', 'opportunity'].includes(s.type)) continue;
    const kind = SIGNAL_KINDS.includes(s.kind) ? s.kind : 'other';
    const { data: seen } = await DB().from('wa_signals').select('id').eq('group_jid', jid).eq('kind', kind)
      .gte('created_at', new Date(Date.now() - 14 * 86400000).toISOString()).limit(1);
    if(seen && seen.length) continue;
    const { error } = await DB().from('wa_signals').insert({ group_jid: jid, client_id: client ? client.id : null, client: cname, type: s.type, kind,
      summary: String(s.summary).slice(0, 400), excerpt: clip(s.excerpt, 300), wa_msg_ids: (s.msg_ids || []).map(byNum).filter(Boolean).map(m => m.wa_msg_id) });
    if(error) console.error('  watch: signal not saved:', error.message); else result.signals++;
  }
  // 4. The client's own details, for someone to accept in Radar (never what Radar already has)
  if(client) for(const d of Array.isArray(out.details) ? out.details : []){
    if(!d || !FIELDS.includes(d.field)) continue;
    let v = String(d.value || '').trim().replace(/[.,;]+$/, '');
    if(!v || v.length > 200) continue;
    if(d.field === 'email' && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v)) continue;
    if(d.field === 'website' && !/^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(v)) continue;
    if(d.field === 'phone' && String(v).replace(/[^\d]/g, '').length < 7) continue;
    if(d.field === 'website' && !/^https?:\/\//i.test(v)) v = 'https://' + v;
    if(sameDetail(d.field, v, have[d.field])) continue;
    const { error } = await DB().from('wa_detail_suggestions').insert({ client_id: client.id, group_jid: jid, field: d.field, value: v, excerpt: clip(d.excerpt, 300) });
    if(!error) result.details++;
    else if(!/duplicate|unique/i.test(error.message)) console.error('  watch: detail not saved:', error.message);
  }
  if(result.signals || result.details) console.log(`  watch: ${cname}: ${result.signals} account signal${result.signals === 1 ? '' : 's'}, ${result.details} detail${result.details === 1 ? '' : 's'} to check`);
  if(result.urgent || result.signals) await send();
  return result;
}
