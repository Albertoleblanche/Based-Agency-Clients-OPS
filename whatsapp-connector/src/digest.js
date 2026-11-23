import { config } from './config.js';
import { db, check, loadProfiles, logRun, lastDigestTime } from './db.js';
import { ROLES, matchProfile } from './roles.js';
import { analyzeGroup } from './extract.js';
import { slackDM } from './slack.js';

const ICON = { request: '🛠', question: '❓', promise: '🤝', issue: '🚨' };
const ago = (iso) => { const d = Math.floor((Date.now() - new Date(iso)) / 86400000); return d <= 0 ? 'today' : d === 1 ? '1d' : `${d}d`; };
const line = (t) => `${ICON[t.kind] || '•'} ${t.priority === 'high' ? '*[HIGH]* ' : ''}*${t.client}* — ${t.title} _(${ago(t.first_seen)})_`;

// notify: false for Check Now from Radar — it reads the groups and updates the list, but sends no
// Slack messages (those go at the set times).
export async function runDigest({ dry = false, notify = true } = {}){
  const startedAt = new Date().toISOString();
  const since = await lastDigestTime();
  const profiles = await loadProfiles();
  const groups = check(await db().from('wa_groups').select('jid,name').eq('active', true), 'load groups');

  let seen = 0, created = 0, resolved = 0, reopened = 0, failures = 0;
  const fresh = [];
  for(const g of groups){
    const r = await analyzeGroup(g, since);
    seen += r.seen; created += r.created; resolved += r.resolved; reopened += r.reopened || 0; if(r.failed) failures++;
    fresh.push(...(r.items || []));
    if(r.created || r.resolved || r.reopened) console.log(`  ${g.name}: +${r.created} new, ${r.reopened || 0} reopened (the client followed up), ${r.resolved} resolved`);
  }

  // Link owners to Radar users (done here so newly added teammates are picked up).
  for(const role of ROLES){
    const p = matchProfile(role, profiles);
    if(p) await db().from('wa_tasks').update({ owner_user_id: p.id }).eq('owner_key', role.key).is('owner_user_id', null).eq('status', 'open');
  }

  // Each new or reopened item reaches its owner in Radar too, on every check (Check Now included):
  // the bell, and a push on their phone (Nov 23)
  if(!dry) { try { await notifyRadar(fresh, profiles); } catch(e){ console.error('  Radar notifications failed:', e.message); } }

  const open = check(await db().from('wa_tasks').select('*').eq('status', 'open').order('first_seen', { ascending: true }), 'load open');
  const label = new Date().toLocaleTimeString('en-US', { timeZone: config.tz, hour: 'numeric', minute: '2-digit' });
  const link = config.radarUrl ? `\n<${config.radarUrl}|Open in Radar>` : '';
  let sent = 0;

  const byOwner = (key) => open.filter(t => t.owner_key === key);
  const muted = p => (p.muted_notification_types || []).includes('whatsapp_digest');
  // The whole team's list, with the reader's own items first.
  const fullView = (key, heading) => {
    const sections = [...ROLES].sort((a, b) => (b.key === key) - (a.key === key)).map(r => ({ r, items: byOwner(r.key) })).filter(s => s.items.length)
      .map(s => `*${s.r.name}* (${s.items.length})\n${s.items.slice(0, 12).map(line).join('\n')}`);
    return `*${heading}, ${label}*\n${open.length} open · +${created} new · ${resolved} answered since last check\n\n${sections.join('\n\n') || '_Nothing open. 🎉_'}${link}`;
  };
  const testers = config.pilotIds;

  if(!notify){
    console.log('Checked from Radar, so no Slack messages this time.');
  } else if(testers === null){
    console.log('Radar settings not loaded, so no Slack messages this time.');
  } else if(testers.length){
    // Test mode: only the testers hear about it, and they get the full view. Nobody else is messaged.
    for(const id of testers){
      const p = profiles.find(x => String(x.id) === id);
      if(!p?.slack_user_id || muted(p)) continue;
      const role = ROLES.find(r => matchProfile(r, [p]));
      const text = fullView(role ? role.key : '', 'WhatsApp client items (test mode, only you get this)');
      if(dry) console.log(`\n[dry] TEST MODE → ${p.name}\n${text}`); else if(await slackDM(p.slack_user_id, text)) sent++;
    }
  } else for(const role of ROLES){
    const p = matchProfile(role, profiles);
    if(!p?.slack_user_id || config.adminKeys.includes(role.key)) continue; // admins get the full view below
    if(muted(p)) continue;
    const mine = byOwner(role.key);
    if(!mine.length) continue;
    const text = `*WhatsApp client items for you — ${label}* (${mine.length} open)\n${mine.slice(0, 25).map(line).join('\n')}${mine.length > 25 ? `\n…and ${mine.length - 25} more` : ''}${link}`;
    if(dry) console.log(`\n[dry] DM → ${role.name}\n${text}`); else if(await slackDM(p.slack_user_id, text)) sent++;
  }

  // Full view for Eric and Dan (live only).
  if(notify && testers && !testers.length) for(const key of config.adminKeys){
    const role = ROLES.find(r => r.key === key); const p = role && matchProfile(role, profiles);
    if(!p?.slack_user_id || muted(p)) continue;
    const text = fullView(key, 'WhatsApp client items — full team view');
    if(dry) console.log(`\n[dry] FULL VIEW → ${role.name}\n${text}`); else if(await slackDM(p.slack_user_id, text)) sent++;
  }

  if(notify) await db().from('wa_tasks').update({ last_reminded_at: new Date().toISOString() }).eq('status', 'open');
  await logRun({ kind: 'digest', started_at: startedAt, finished_at: new Date().toISOString(), ok: failures === 0 || failures < groups.length,
    connection: 'open', messages_seen: seen, tasks_new: created + reopened, tasks_closed: resolved,
    note: `${groups.length} groups, ${open.length} open${reopened ? `, ${reopened} reopened (the client followed up)` : ''}, ${sent} Slack messages${failures ? `, ${failures} groups failed` : ''}${notify ? '' : ', Check Now from Radar'}${dry ? ' (dry run)' : ''}` });
  console.log(`Digest done: ${groups.length} groups, +${created} new, ${reopened} reopened, ${resolved} answered, ${open.length} open, ${sent} Slack DMs.`);
}

// The team's weekend, in the connector's time zone (Radar's WhatsApp settings).
export function isWeekend(when = new Date()){
  const d = new Intl.DateTimeFormat('en-US', { timeZone: config.tz, weekday: 'short' }).format(when);
  return d === 'Sat' || d === 'Sun';
}
// An alert on a Saturday or Sunday waits for Monday's first check (sendHeldAlerts), so nobody is
// messaged on the weekend. Only the latest of each kind is kept.
const held = new Map();
export async function sendHeldAlerts(){
  if(isWeekend() || !held.size) return;
  const list = [...held.values()]; held.clear();
  for(const text of list) await alertAdmins(text);
}

export async function alertAdmins(text){
  if(isWeekend()){ held.set(text, text); console.log('Weekend, so this alert goes out Monday morning:', text); return; }
  const profiles = await loadProfiles();
  const testers = config.pilotIds;
  if(testers === null){ console.error('Not sent to Slack (Radar settings not loaded):', text); return; }
  if(testers.length){   // test mode: only the testers
    for(const id of testers){ const p = profiles.find(x => String(x.id) === id); if(p?.slack_user_id) await slackDM(p.slack_user_id, text); }
    return;
  }
  for(const key of config.adminKeys){
    const role = ROLES.find(r => r.key === key); const p = role && matchProfile(role, profiles);
    if(p?.slack_user_id) await slackDM(p.slack_user_id, text);
  }
}

// ---- Radar notifications (Nov 23) -----------------------------------------------------------------
// One notification per person per check ("2 new WhatsApp requests"), in the bell, and a push through
// Radar (RADAR_URL; Radar holds the push keys). Muting "A client asks you for something in WhatsApp"
// in Radar's Settings → Notifications (everywhere, or just in the app or on the phone) is honored.
// In test mode only the testers hear about it.
const TYPE = 'whatsapp_request';
export async function notifyRadar(items, profiles, deps){
  const DB = (deps && deps.db) || db, get = (deps && deps.fetch) || fetch;
  if(!items.length || config.pilotIds === null) return;
  const per = new Map();
  for(const it of items){
    const role = ROLES.find(r => r.key === it.owner_key), p = role && matchProfile(role, profiles);
    if(!p) continue;
    if(config.pilotIds.length && !config.pilotIds.includes(String(p.id))) continue;
    if(!per.has(p.id)) per.set(p.id, { p, list: [] });
    per.get(p.id).list.push(it);
  }
  const pushes = [];
  for(const { p, list } of per.values()){
    const m = p.muted_notification_types || [];
    if(m.includes(TYPE)) continue;
    const again = list.filter(x => x.reopened).length, high = list.some(x => x.high);
    const title = list.length === 1 ? `${list[0].client} on WhatsApp${list[0].reopened ? ', again' : ''}` : `${list.length} new WhatsApp requests${again ? ` (${again} again)` : ''}`;
    const body = list.slice(0, 3).map(x => list.length === 1 ? x.title : `${x.client}: ${x.title}`).join(' · ') + (list.length > 3 ? ` · and ${list.length - 3} more` : '') + (high ? ' (high priority)' : '');
    if(!m.includes('app:' + TYPE)){
      const { error } = await DB().from('notifications').insert({ user_id: p.id, type: TYPE, title, body, target_view: 'whatsapp', read: false });
      if(error) console.error('  notification failed:', error.message);
    }
    if(!m.includes('push:' + TYPE)) pushes.push({ userId: p.id, title, body, view: 'whatsapp' });
  }
  // RADAR_URL may carry a screen (…/#whatsapp, as in .env.example): the push goes to the site itself
  let origin = ''; try { origin = new URL(config.radarUrl).origin; } catch(e) {}
  if(!pushes.length || !origin || origin === 'null') return;
  const res = await get(`${origin}/api/integrations?route=service-push`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-radar-service-key': config.supabaseKey() }, body: JSON.stringify({ pushes }),
  });
  if(!res.ok) console.error(`  Radar push failed: ${res.status}`);
  else { const r = await res.json().catch(() => ({})); console.log(`  Radar: ${per.size} notified, ${r.sent || 0} push${r.sent === 1 ? '' : 'es'} sent`); }
}
