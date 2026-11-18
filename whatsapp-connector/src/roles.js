// Who handles what. Edit this list to teach the agent; the agent also learns
// from reassignments made in Radar (see extract.js → recentCorrections).
export const ROLES = [
  { key: 'albert',  name: 'Albert',  aliases: ['albert'],           does: 'Web development: website builds, fixes, landing pages, forms, plugins, site bugs, design changes on the site.' },
  { key: 'stan',    name: 'Stan',    aliases: ['stan'],             does: 'AI SEO: AI search visibility, ChatGPT/Perplexity/AI Overviews questions, llms.txt, schema for AI.' },
  { key: 'eric',    name: 'Eric',    aliases: ['eric'],             does: 'Main point of contact for clients plus paid ads: Google Ads, Facebook/Meta Ads, budgets, leads quality, ad copy, billing questions about ads, anything not clearly someone else\'s.' },
  { key: 'charlie', name: 'Charlie', aliases: ['charlie','charles'], does: 'Mainly SEO (rankings, GBP/local SEO, content, backlinks, citations) and hosting (domains, DNS, email setup, SSL, site down).' },
  { key: 'dan',     name: 'Dan',     aliases: ['dan','daniel'],     does: 'Owner: contracts, pricing, invoices/payments, complaints, cancellations, strategy, other client-relationship matters.' },
  { key: 'joey',    name: 'Joey',    aliases: ['joey','joe'],       does: 'Video production and client calls: shoots, edits, scheduling/attending calls and meetings.' },
];

const DEFAULT_DOES = Object.fromEntries(ROLES.map(r => [r.key, r.does]));
// Notes edited in Radar replace the built-in description; blank = back to the default.
export function applyRoleNotes(notes){
  for(const r of ROLES){
    const n = typeof notes?.[r.key] === 'string' ? notes[r.key].trim() : '';
    r.does = n || DEFAULT_DOES[r.key];
  }
}

export const ROLE_KEYS = ROLES.map(r => r.key);

export function matchProfile(role, profiles){
  const wanted = role.aliases;
  return profiles.find(p => {
    const first = String(p.name || '').trim().split(/\s+/)[0]?.toLowerCase();
    return wanted.includes(first) || wanted.includes(String(p.name||'').trim().toLowerCase());
  }) || null;
}
