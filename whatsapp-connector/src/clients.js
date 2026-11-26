// Radar's clients, as the connector sees them (Nov 24): which client a WhatsApp group is about,
// who owns that client, and the details Radar already has. Read every 10 minutes at most.
import { db, check } from './db.js';

let cache = { at: 0, list: [] };
export async function loadClients(force = false){
  if(!force && Date.now() - cache.at < 600000) return cache.list;
  const data = check(await db().from('clients').select('id,name,email,website,status,service,sow,custom_field_values,deleted_at'), 'load clients');
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

// What the client pays the agency for (Nov 25), so a request outside it comes in labelled "Not in their
// plan: offer as add-on". The same rules as Radar's lib/client-plan.js: Radar's services and scope of
// work, and their active Harvest projects (and the areas those cover). Null when nothing is known.
const AREAS = [['web', 'website'], ['paid', 'paid ads (Google, Meta)'], ['seo', 'SEO'], ['content', 'content'], ['graphics', 'graphics and branding']];
export function projectAreas(name){
  const n = norm(name);
  if(/\blegacy\b/.test(n)) return [];
  if(/\bmdf\b|marketing domination/.test(n)) return /\btier 1\b/.test(n) ? ['paid'] : ['paid', 'web', 'seo', 'content'];
  if(/\bweb ?site\b|\bweb design\b|\bhosting\b|\bmaintenance\b/.test(n)) return ['web'];
  if(/\bbrand|\blogo|\bgraphic/.test(n)) return ['graphics'];
  if(/\bseo\b|ai domination|\badf\b/.test(n)) return ['seo', 'content'];
  if(/\bgoogle ads\b|\bppc\b|\bmeta\b|\bfacebook\b|\bpaid\b/.test(n)) return ['paid'];
  return [];
}
export function planLine(c, projectNames){
  if(!c) return null;
  const services = [...new Set(String(c.service || '').split(/\s*·\s*/).map(s => s.trim()).filter(Boolean))];
  const names = (projectNames || []).filter(Boolean);
  let areas = null;
  const all = [...services, ...names];   // Radar's services and Harvest's projects together
  if(all.length){ const lists = all.map(projectAreas); if(lists.every(l => l.length)){ const s = new Set(lists.flat()); areas = AREAS.filter(a => s.has(a[0])).map(a => a[1]); } }
  const sow = String(c.sow || '').replace(/\s+/g, ' ').trim();
  if(!services.length && !names.length && !sow) return null;
  const parts = [];
  if(services.length || names.length) parts.push(`pays for ${[...new Set([...services, ...names])].join(', ')}`);
  if(areas && areas.length) parts.push(`that covers ${areas.join(', ')} work only`);
  if(sow) parts.push(`scope of work: ${sow.length > 400 ? sow.slice(0, 399).replace(/\s+\S*$/, '') + '…' : sow}`);
  return `${c.name}: ${parts.join('; ')}.`;
}
export async function clientPlan(c, deps = {}){
  if(!c) return null;
  const DB = deps.db || db;
  let names = [];
  try {
    const { data: hc } = await DB().from('harvest_clients').select('harvest_id').eq('radar_client_id', String(c.id));
    const ids = (hc || []).map(h => Number(h.harvest_id));
    if(ids.length){ const { data: ps } = await DB().from('harvest_projects').select('name,is_active').in('client_harvest_id', ids); names = (ps || []).filter(p => p.is_active !== false).map(p => p.name); }
  } catch { names = []; }
  return planLine(c, names);
}
