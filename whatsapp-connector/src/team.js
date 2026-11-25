// Who's on our side, by phone number (Nov 25).
//
// A message counts as the team's when it comes from the linked phone (the agency's number) or from
// a number listed in Radar → Settings → WhatsApp → Who's on the team (wa_team_numbers). Names don't
// decide it any more, so a client called Dan is never taken for Dan. Until at least one number is
// listed, first names (TEAM_SENDER_HINTS) still decide, as before, so nothing breaks in between.
//
// WhatsApp now often hides numbers in groups behind a private id (…@lid). The group list usually says
// which id is which number, so the connector keeps that map and still finds the number. When it
// doesn't, the person is known by that id instead ("lid:<digits>"), which works the same way.
//
// It also suggests the team: a number that's in most of the client groups it reads is almost
// certainly ours (a client is in one or two). Those, and only those, are saved for Radar to show
// (wa_team_seen), with how many groups they're in and the name they use on WhatsApp.
import { config } from './config.js';
import { db as realDb } from './db.js';

export const team = {
  numbers: new Set(),     // the team's numbers, from Radar (digits, with the country code)
  own: null,              // the linked phone's number
  lidToPn: new Map(),     // private group id (digits) -> number
  names: new Map(),       // number -> the name they use on WhatsApp (from their messages)
  loaded: false,          // wa_team_numbers was read (the table exists)
  markedKey: null,        // the numbers stored messages were last marked with
};

export const digits = (jid) => String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
// how a person is kept: their number (digits), or "lid:<digits>" when WhatsApp hides it
export const norm = (v) => /^lid:\d+$/.test(String(v || '')) ? String(v) : digits(v);
const isPn = (j) => typeof j === 'string' && /@s\.whatsapp\.net$/.test(j);
const isLid = (j) => typeof j === 'string' && /@lid$/.test(j);

// Who sent a group message: their number, else their private id ("lid:<digits>"), else null.
export function numberOf(m){
  const k = m?.key || {};
  if(k.fromMe) return team.own;
  for(const j of [k.participantPn, k.senderPn, k.participant, m.participant]) if(isPn(j)) return digits(j);
  const lids = [k.participantLid, k.senderLid, k.participant, m.participant].filter(isLid);
  for(const j of lids){ const pn = team.lidToPn.get(digits(j)); if(pn) return pn; }
  return lids.length ? 'lid:' + digits(lids[0]) : null;
}

// The team's message? The linked phone, or a team number. Before any number is listed: first names.
export function isTeam(m, num = numberOf(m)){
  if(m?.key?.fromMe) return true;
  if(num && (team.numbers.has(num) || num === team.own)) return true;
  if(team.numbers.size) return false;
  const n = String(m?.pushName || '').toLowerCase();
  return !!n && config.teamHints.some(h => n === h || n.startsWith(h + ' '));
}

// Remember the name a number uses (for the suggestions).
export function noteName(num, name){
  if(num && name && String(name).trim()) team.names.set(num, String(name).trim().slice(0, 80));
}

export function setOwn(user){
  const n = digits(user?.id);
  team.own = n || null;
  if(user?.lid && n) team.lidToPn.set(digits(user.lid), n);
  return team.own;
}

// From WhatsApp's group list: which private id is which number, and who's in most client groups.
// `all` is groupFetchAllParticipating(); `reading` the jids of the client groups it reads.
export function learnGroups(all, reading){
  const counts = new Map();
  for(const [jid, g] of Object.entries(all || {})){
    for(const p of g?.participants || []){
      const pn = isPn(p.jid) ? digits(p.jid) : isPn(p.id) ? digits(p.id) : '';
      const lid = isLid(p.lid) ? digits(p.lid) : isLid(p.id) ? digits(p.id) : '';
      if(pn && lid) team.lidToPn.set(lid, pn);
      const who = pn || (lid ? 'lid:' + lid : '');
      if(who && reading.has(jid)) counts.set(who, (counts.get(who) || 0) + 1);
    }
  }
  const total = reading.size;
  // a client is in one or two groups; the team is in most of them
  const need = total <= 2 ? total : Math.max(3, Math.ceil(total * 0.3));
  const seen = [];
  if(total) for(const [num, n] of counts) if(n >= need) seen.push({ number: num, groups: n, total });
  return seen.sort((a, b) => b.groups - a.groups);
}

// Saves the suggestions for Radar: the numbers in most client groups, less the linked phone.
// A number marked "not the team" in Radar keeps that (the dismissed flag isn't touched here).
export async function saveSeen(seen, deps = {}){
  const D = deps.db || realDb;
  const now = new Date().toISOString();
  const rows = seen.filter(s => s.number !== team.own).map(s => ({ number: s.number, name: team.names.get(s.number) || null, groups: s.groups, total: s.total, updated_at: now }));
  const { data: had, error } = await D().from('wa_team_seen').select('number,name,dismissed');
  if(error) return false;   // the table isn't there yet (addendum-whatsapp-team-numbers.sql)
  const named = new Map((had || []).map(r => [r.number, r.name]));
  rows.forEach(r => { if(!r.name && named.get(r.number)) r.name = named.get(r.number); });
  if(rows.length){ const { error: e } = await D().from('wa_team_seen').upsert(rows, { onConflict: 'number' }); if(e){ console.error('Saving who’s in the groups failed:', e.message); return false; } }
  // no longer in most groups: drop it, unless it was marked not the team (so it stays that way)
  const keep = new Set(rows.map(r => r.number));
  const gone = (had || []).filter(r => !keep.has(r.number) && !r.dismissed).map(r => r.number);
  if(gone.length) await D().from('wa_team_seen').delete().in('number', gone);
  return true;
}

// The linked phone's number, for Radar to show.
export async function saveOwn(deps = {}){
  const D = deps.db || realDb;
  if(!team.own) return;
  const { error } = await D().from('wa_settings').update({ linked_number: team.own }).eq('id', 1);
  if(error && !/linked_number|column|42703|PGRST204/i.test(error.message || '')) console.error('Saving the linked number failed:', error.message);
}

// Reads the team's numbers from Radar. When they change, the messages already stored are marked
// again: from a team number (or the linked phone) = the team, any other known number = the client.
export async function loadTeamNumbers(deps = {}){
  const D = deps.db || realDb;
  const { data, error } = await D().from('wa_team_numbers').select('number');
  if(error){ team.loaded = false; return false; }
  team.loaded = true;
  if(!team.own){   // not connected yet (or a check from the command line): the number it last linked as
    const { data: st } = await D().from('wa_settings').select('linked_number').eq('id', 1).maybeSingle();
    if(st?.linked_number) team.own = digits(st.linked_number);
  }
  const next = new Set((data || []).map(r => norm(r.number)).filter(Boolean));
  const changed = next.size !== team.numbers.size || [...next].some(n => !team.numbers.has(n));
  team.numbers = next;
  const mark = [...next, ...(team.own ? [team.own] : [])].sort();
  const key = mark.join(',');
  // (only once the linked phone's number is known, or its own messages would be marked the client's)
  if(next.size && team.own && key !== team.markedKey){
    const { error: e } = await D().rpc('wa_mark_team', { p_numbers: mark });
    if(!e){ team.markedKey = key; console.log(`The team is ${next.size} number${next.size === 1 ? '' : 's'} (and this phone); stored messages are marked to match.`); }
    else console.error('Marking stored messages failed:', e.message);
  }
  return changed;
}
