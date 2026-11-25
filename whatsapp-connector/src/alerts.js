// Alerts from the live watch (Nov 24), sent from wa_alerts and wa_signals rows that haven't gone out:
//   • urgent   → the item's owner (or the client's owner in Radar): Slack, Radar's bell, a push
//   • waiting  → the client's owner, once the client has waited WAIT_NUDGE_MINUTES of work time
//                for a reply (cleared as soon as anyone on the team writes in the group)
//   • signals  → Radar's admins: a client mentions pausing, budget, a competitor, growing…
// Only on weekdays 7:00–21:00 (team time); what's found outside waits for the morning. In test mode
// only the testers hear about any of it. Mutes set in Radar → Settings → Notifications are honored.
import { config } from './config.js';
import { db, loadProfiles } from './db.js';
import { ROLES, matchProfile } from './roles.js';
import { slackDM } from './slack.js';
import { inAlertHours, workMinutes, minutesWords } from './hours.js';
import { loadClients, clientOwnerName } from './clients.js';

const SIGNAL_WORDS = { pause: 'wants to pause', cancel: 'talks about cancelling', budget: 'mentions budget', competitor: 'mentions another agency or competitor',
  unhappy: 'sounds unhappy with the results', expansion: 'is growing', new_service: 'asks about a new service', referral: 'mentions a referral', hiring: 'is hiring', resume: 'is paused and talks about restarting', other: 'said something worth knowing' };
export const signalWords = k => SIGNAL_WORDS[k] || SIGNAL_WORDS.other;

const link = () => config.radarUrl ? `\n<${config.radarUrl}|Open in Radar>` : '';
const quote = q => q ? `\n> ${String(q).replace(/\s+/g, ' ').slice(0, 280)}` : '';

// The people an alert goes to: in test mode the testers, else those given (no one twice).
function recipients(people, profiles){
  if(config.pilotIds === null) return [];
  if(config.pilotIds.length) return profiles.filter(p => config.pilotIds.includes(String(p.id)));
  const seen = new Set();
  return people.filter(p => p && !seen.has(p.id) && seen.add(p.id));
}
// Who owns a client: the owner set in Radar, else the role the agent picked, else Eric (the main contact).
function ownerOf(ownerKey, client, profiles){
  const name = clientOwnerName(client);
  const byName = name ? profiles.find(p => String(p.name || '').trim().toLowerCase() === name.toLowerCase()) : null;
  if(byName) return byName;
  const role = ROLES.find(r => r.key === ownerKey) || ROLES.find(r => r.key === 'eric');
  return role ? matchProfile(role, profiles) : null;
}

// Slack, the bell and a push for each person, by type, as the person's mutes allow.
export async function tell(people, { type, title, body, slack, view, targetId }, deps = {}){
  const DB = deps.db || db, get = deps.fetch || fetch, dm = deps.slackDM || slackDM;
  const pushes = [];
  let told = 0;
  for(const p of people){
    const m = p.muted_notification_types || [];
    if(m.includes(type)) continue;
    told++;
    if(p.slack_user_id) await dm(p.slack_user_id, slack);
    if(!m.includes('app:' + type)){
      const row = { user_id: p.id, type, title, body, target_view: view, read: false };
      if(targetId) row.target_id = String(targetId);
      const { error } = await DB().from('notifications').insert(row);
      if(error) console.error('  notification failed:', error.message);
    }
    if(!m.includes('push:' + type)) pushes.push({ userId: p.id, title, body, view });
  }
  let origin = ''; try { origin = new URL(config.radarUrl).origin; } catch(e) {}
  if(pushes.length && origin && origin !== 'null'){
    const res = await get(`${origin}/api/integrations?route=service-push`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-radar-service-key': config.supabaseKey() }, body: JSON.stringify({ pushes }),
    }).catch(e => ({ ok: false, status: e.message }));
    if(!res.ok) console.error(`  Radar push failed: ${res.status}`);
  }
  return told;
}

// Everything waiting to go out. Runs after each watch, and every two minutes from index.js.
let sending = false;
export async function sendPending({ now = new Date(), deps = {} } = {}){
  if(sending || config.pilotIds === null) return { urgent: 0, waiting: 0, signals: 0 };
  sending = true;
  const DB = deps.db || db;
  const out = { urgent: 0, waiting: 0, signals: 0 };
  try {
    const since = d => new Date(now.getTime() - d * 86400000).toISOString();
    const [alerts, signals] = await Promise.all([
      DB().from('wa_alerts').select('*').is('notified_at', null).is('resolved_at', null).gte('created_at', since(5)).order('created_at', { ascending: true }),
      DB().from('wa_signals').select('*').is('notified_at', null).eq('status', 'new').gte('created_at', since(7)).order('created_at', { ascending: true }),
    ]);
    if(alerts.error || signals.error){ const e = alerts.error || signals.error; if(!/relation|schema cache/i.test(e.message)) console.error('Alerts not read:', e.message); return out; }
    if(!(alerts.data || []).length && !(signals.data || []).length) return out;
    const profiles = deps.profiles || await loadProfiles();
    const clients = deps.clients || await loadClients();
    const clientOf = id => id ? clients.find(c => String(c.id) === String(id)) || null : null;
    const groupName = async jid => { const { data } = await DB().from('wa_groups').select('name').eq('jid', jid).maybeSingle(); return data ? data.name : ''; };
    const open = inAlertHours(now);

    for(const a of alerts.data || []){
      const c = clientOf(a.client_id), cname = c ? c.name : await groupName(a.group_jid);
      if(a.kind === 'waiting'){
        // answered since? then there's nothing to nudge about
        const { data: reply } = await DB().from('wa_messages').select('id').eq('group_jid', a.group_jid).eq('from_team', true).gt('ts', a.asked_at).limit(1);
        if(reply && reply.length){ await DB().from('wa_alerts').update({ resolved_at: now.toISOString() }).eq('id', a.id); continue; }
        const waited = workMinutes(a.asked_at, now);
        if(waited < config.waitNudgeMinutes || !open) continue;
        const who = recipients([ownerOf(a.owner_key, c, profiles)], profiles);
        const words = minutesWords(waited);
        await tell(who, { type: 'whatsapp_waiting', title: `${cname} has waited ${words} for a reply`, body: a.excerpt ? `“${a.excerpt}”` : 'On WhatsApp, in work hours.',
          slack: `*${cname} has waited ${words} for a reply on WhatsApp* (work hours).${quote(a.excerpt)}${link()}`, view: c ? 'clients' : 'whatsapp', targetId: c ? c.id : null }, deps);
        await DB().from('wa_alerts').update({ notified_at: now.toISOString() }).eq('id', a.id);
        out.waiting++;
      } else if(a.kind === 'urgent'){
        if(!open) continue;
        const who = recipients([ownerOf(a.owner_key, c, profiles)], profiles);
        await tell(who, { type: 'whatsapp_urgent', title: `Urgent: ${cname} on WhatsApp`, body: a.reason || a.excerpt || 'Open it in Radar.',
          slack: `*Urgent: ${cname} on WhatsApp*\n${a.reason || ''}${quote(a.excerpt)}${link()}`, view: 'whatsapp', targetId: a.task_id }, deps);
        await DB().from('wa_alerts').update({ notified_at: now.toISOString() }).eq('id', a.id);
        out.urgent++;
      }
    }
    if(open && (signals.data || []).length){
      const admins = profiles.filter(p => p.role === 'admin');
      const who = recipients(admins, profiles);
      for(const s of signals.data){
        const c = clientOf(s.client_id), cname = c ? c.name : s.client;
        const head = `${cname} ${signalWords(s.kind)}`;
        await tell(who, { type: 'whatsapp_signal', title: s.type === 'risk' ? `Risk: ${head}` : `Opening: ${head}`, body: s.summary,
          slack: `*${s.type === 'risk' ? 'Account risk' : 'Account opening'}: ${head}*\n${s.summary}${quote(s.excerpt)}${link()}`, view: c ? 'clients' : 'whatsapp', targetId: c ? c.id : null }, deps);
        await DB().from('wa_signals').update({ notified_at: now.toISOString() }).eq('id', s.id);
        out.signals++;
      }
    }
    if(out.urgent || out.waiting || out.signals) console.log(`Alerts sent: ${out.urgent} urgent, ${out.waiting} waiting, ${out.signals} account signals.`);
  } catch(e){ console.error('Alerts failed:', e.message); }
  finally { sending = false; }
  return out;
}
