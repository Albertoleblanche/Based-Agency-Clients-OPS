// What a client pays the agency for (Nov 25), for the AI that reads their emails and meetings: so a
// request outside it comes in labelled "Not in their plan: offer as add-on" instead of as normal work.
// From Radar (the services and scope of work on the client) and Harvest (their active projects, and the
// areas those cover, by the same rules as the app's work-areas.js). Nothing known → no plan, no label.

const AREAS = [['web', 'website'], ['paid', 'paid ads (Google, Meta)'], ['seo', 'SEO'], ['content', 'content'], ['graphics', 'graphics and branding']];
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// The same as waDefaultProjectAreas in js/features/work-areas.js; [] means every area (not known)
function projectAreas(name, own) {
  const set = own && own[String(name || '').trim()];
  if (Array.isArray(set)) return set;
  const n = norm(name);
  if (/\blegacy\b/.test(n)) return [];
  if (/\bmdf\b|marketing domination/.test(n)) return /\btier 1\b/.test(n) ? ['paid'] : ['paid', 'web', 'seo', 'content'];
  if (/\bweb ?site\b|\bweb design\b|\bhosting\b|\bmaintenance\b/.test(n)) return ['web'];
  if (/\bbrand|\blogo|\bgraphic/.test(n)) return ['graphics'];
  if (/\bseo\b|ai domination|\badf\b/.test(n)) return ['seo', 'content'];
  if (/\bgoogle ads\b|\bppc\b|\bmeta\b|\bfacebook\b|\bpaid\b/.test(n)) return ['paid'];
  return [];
}

// One line per client, or null when nothing about what they pay for is known.
function planLine(c, projects, settings) {
  const services = [...new Set(String(c.service || '').split(/\s*·\s*/).map(s => s.trim()).filter(Boolean))];
  const names = (projects || []).map(p => p.name).filter(Boolean);
  const own = settings && settings.workAreas && settings.workAreas.projects;
  // the areas, from Radar's services and Harvest's projects together (one that could be anything: none stated)
  let areas = null;
  const all = [...services, ...names];
  if (all.length) {
    const lists = all.map(n => projectAreas(n, own));
    if (lists.every(l => l.length)) { const s = new Set(lists.flat()); areas = AREAS.filter(a => s.has(a[0])).map(a => a[1]); }
  }
  const sow = String(c.sow || '').replace(/\s+/g, ' ').trim();
  if (!services.length && !names.length && !sow) return null;
  const parts = [];
  if (services.length || names.length) parts.push(`pays for ${[...new Set([...services, ...names])].join(', ')}`);
  if (areas && areas.length) parts.push(`that covers ${areas.join(', ')} work only`);
  if (sow) parts.push(`scope of work: ${sow.length > 400 ? sow.slice(0, 399).replace(/\s+\S*$/, '') + '…' : sow}`);
  return `${c.name}: ${parts.join('; ')}.`;
}

// { [client id]: line } for these clients (rows with id, name, service, sow).
async function clientPlans(admin, list, settings) {
  const out = {};
  if (!list || !list.length) return out;
  const ids = list.map(c => String(c.id));
  let byClient = {};
  try {
    const { data: hc } = await admin.from('harvest_clients').select('harvest_id, radar_client_id').in('radar_client_id', ids);
    const map = {}; (hc || []).forEach(h => { if (h.radar_client_id) map[Number(h.harvest_id)] = String(h.radar_client_id); });
    const hids = Object.keys(map).map(Number);
    if (hids.length) {
      const { data: ps } = await admin.from('harvest_projects').select('client_harvest_id, name, is_active').in('client_harvest_id', hids);
      (ps || []).filter(p => p.is_active !== false).forEach(p => { const cid = map[Number(p.client_harvest_id)]; if (cid) (byClient[cid] = byClient[cid] || []).push(p); });
    }
  } catch (e) { byClient = {}; }   // no Harvest tables: Radar's own details only
  for (const c of list) { const l = planLine(c, byClient[String(c.id)], settings); if (l) out[String(c.id)] = l; }
  return out;
}

// The rule the AI follows, with the plans it has; '' when none is known (then nothing is labelled).
function planRule(lines, field) {
  const known = (lines || []).filter(Boolean);
  if (!known.length) return '';
  return `\n\nWhat the client pays the agency for:\n${known.map(l => `- ${l}`).join('\n')}\nFor each ${field}, add "in_plan": false only when this clearly is new work outside what they pay for (they pay for Google Ads only and ask for a new website page, a logo, or a blog post); otherwise true. Fixes, reports, questions, access, meetings, and anything about work they already pay for are in their plan. When the client isn't listed above or you're unsure, true. When false, add "plan_note": under 90 characters, what the work is and what they pay for ("A new landing page: they pay for Google Ads only").`;
}

// The label on a saved row, from the AI's answer
function scopeOf(it, hasPlan) {
  if (!hasPlan || !it || it.in_plan !== false) return { out_of_scope: false, scope_note: null };
  return { out_of_scope: true, scope_note: String(it.plan_note || '').trim().slice(0, 160) || null };
}

// Saving with the label, or without it until addendum-out-of-scope.sql is run
const NO_SCOPE_COLS = /out_of_scope|scope_note/i;
function withoutScope(rows) { return rows.map(r => { const o = { ...r }; delete o.out_of_scope; delete o.scope_note; return o; }); }

module.exports = { clientPlans, planLine, planRule, scopeOf, withoutScope, NO_SCOPE_COLS, projectAreas };
