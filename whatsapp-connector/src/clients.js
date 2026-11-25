// Radar's clients, as the connector sees them (Nov 24): which client a WhatsApp group is about,
// who owns that client, and the details Radar already has. Read every 10 minutes at most.
import { db, check } from './db.js';

let cache = { at: 0, list: [] };
export async function loadClients(force = false){
  if(!force && Date.now() - cache.at < 600000) return cache.list;
  const data = check(await db().from('clients').select('id,name,email,website,status,custom_field_values,deleted_at'), 'load clients');
  cache = { at: Date.now(), list: (data || []).filter(c => !c.deleted_at) };
  return cache.list;
}
export function forgetClients(){ cache.at = 0; }

export const norm = s => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

// "CaliFirst Remodel - Based Agency Marketing - daniel" → "CaliFirst Remodel" (the same rule as Radar's waCleanName)
export function cleanGroupName(n){
  let s = String(n || '').trim();
  s = s.replace(/(?:\s*[|\-–—:&+×]\s*|\s+x\s+)based\s+agency\b.*$/i, '').trim();
  for(let i = 0; i < 3; i++){
    const t = s.replace(/\s*[|\-–—:]\s*(based\s+agency(\s+marketing)?|marketing)\s*$/i, '').trim();
    if(t === s) break; s = t;
  }
  return s || String(n || '');
}

// The group's link if it has one, else the same (or a longer) name, as Radar matches them.
export function matchClient(group, list){
  if(group.client_id){ const c = list.find(x => String(x.id) === String(group.client_id)); if(c) return c; }
  const n = norm(cleanGroupName(group.name)); if(!n) return null;
  return list.find(c => norm(c.name) === n)
    || list.find(c => { const cn = norm(c.name); return Math.min(cn.length, n.length) > 4 && (cn.startsWith(n + ' ') || n.startsWith(cn + ' ')); })
    || null;
}
export async function clientForGroup(group){ return matchClient(group, await loadClients()); }

// What Radar knows about the client now, for comparing with what a chat says.
export function clientDetails(c){
  const f = (c && c.custom_field_values) || {};
  return { contact: String(f.contact || '').trim(), email: String(c?.email || '').trim(), phone: String(f.phone || '').trim(), website: String(c?.website || '').trim() };
}
// The owner set on the client in Radar (a person's name), if any.
export function clientOwnerName(c){ return String(((c && c.custom_field_values) || {}).owner || '').trim(); }

// Compare values the way a person would: case, spaces, "https://www." and a trailing slash don't count.
export function sameDetail(field, a, b){
  const k = v => {
    let s = String(v || '').trim().toLowerCase();
    if(field === 'website') s = s.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
    if(field === 'phone') s = s.replace(/[^\d]/g, '').replace(/^1(?=\d{10}$)/, '');
    if(field === 'contact') s = s.replace(/\s+/g, ' ');
    return s;
  };
  return !!k(a) && k(a) === k(b);
}
