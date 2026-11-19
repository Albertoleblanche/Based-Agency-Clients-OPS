// Areas of work: each person works on the clients whose Harvest projects are in their areas.
// Five areas. A Harvest project covers some of them (MDF Tier 1 is Paid Ads; Tier 2 and 3 are Paid
// Ads, Web, SEO and Content; Website projects are Web; Legacy Retainer is every area), set in
// Settings → Areas and filled in from the agency's SOPs. A person's areas are set there too.
// Empty means every area: nothing changes for someone until an approver picks their areas.
//   Your clients: a client with a project in one of your areas, or one you own.
//   Members can't log time or improvements on other clients, and a project's Task list only offers
//   tasks in their areas (plus the shared ones: onboarding, strategy, calls, reporting).
//   Admins and approvers work on every client; their areas only set what All Clients shows first.
// Shared by the desktop and the iPhone app.

const WORK_AREAS = [['web', 'Web'], ['paid', 'Paid Ads'], ['seo', 'SEO'], ['content', 'Content'], ['graphics', 'Graphics']];
function waName(k){ return (WORK_AREAS.find(a => a[0] === k) || [, k])[1]; }
function waWords(list){ return (list || []).map(waName).join(', '); }
function waNorm(s){ return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

// What a project covers when nobody has set it: from the package names in the SOPs.
function waDefaultProjectAreas(name){
  const n = waNorm(name);
  if(/\blegacy\b/.test(n)) return [];                                         // every area
  if(/\bmdf\b|marketing domination/.test(n)) return /\btier 1\b/.test(n) ? ['paid'] : ['paid', 'web', 'seo', 'content'];
  if(/\bweb ?site\b|\bweb design\b|\bhosting\b|\bmaintenance\b/.test(n)) return ['web'];
  if(/\bbrand|\blogo|\bgraphic/.test(n)) return ['graphics'];
  if(/\bseo\b|ai domination|\badf\b/.test(n)) return ['seo', 'content'];
  if(/\bgoogle ads\b|\bppc\b|\bmeta\b|\bfacebook\b|\bpaid\b/.test(n)) return ['paid'];
  return [];                                                                   // not known: every area
}
function waSet(){ return (typeof settings !== 'undefined' && settings && settings.workAreas) || {}; }
function waProjectAreas(name){
  const own = (waSet().projects || {})[String(name || '').trim()];
  return Array.isArray(own) ? own : waDefaultProjectAreas(name);
}
// A Harvest task's area, or null for work everyone on a client does (onboarding, strategy, calls, reports).
function waTaskArea(name){
  const n = waNorm(name);
  if(/\bweb\b|\bwebsite\b/.test(n)) return 'web';
  if(/\bgoogle ads\b|\bmeta ads\b|\bfacebook\b|\bppc\b|\bpaid\b/.test(n)) return 'paid';
  if(/\bseo\b/.test(n)) return 'seo';
  if(/\bcontent\b|\bcopywriting\b|\bblog/.test(n)) return 'content';
  if(/\bgraphic|\blogo\b|\bbranding\b/.test(n)) return 'graphics';
  return null;
}

// A person's areas ([] = every area).
function waPersonAreas(profileId){
  const own = (waSet().people || {})[String(profileId || '')];
  return Array.isArray(own) ? own.filter(k => WORK_AREAS.some(a => a[0] === k)) : [];
}
function waMyAreas(){ return typeof currentUser !== 'undefined' && currentUser ? waPersonAreas(currentUser.id) : []; }

// A client's areas: its active Harvest projects' areas. null = every area (not in Harvest, no
// projects, or a project that covers every area).
function waClientAreas(c){
  if(!c || typeof hvTime === 'undefined' || !hvTime || !Array.isArray(hvTime.clients) || !Array.isArray(hvTime.projects)) return null;
  const hids = hvTime.clients.filter(x => String(x.radar_client_id || '') === String(c.id)).map(x => Number(x.harvest_id));
  const ps = hvTime.projects.filter(p => hids.includes(Number(p.client_harvest_id)) && p.is_active !== false);
  if(!ps.length) return null;
  const out = new Set();
  for(const p of ps){ const a = waProjectAreas(p.name); if(!a.length) return null; a.forEach(k => out.add(k)); }
  return WORK_AREAS.map(a => a[0]).filter(k => out.has(k));
}
function waOwnsClient(c){ const o = c && c.customFieldValues && c.customFieldValues.owner; return !!o && typeof myName === 'function' && o === myName(); }
// One of your clients: in your areas, or you own it. Everyone's, for someone with no areas set.
function waMine(c){
  const mine = waMyAreas();
  if(!mine.length || waOwnsClient(c)) return true;
  const ca = waClientAreas(c);
  return !ca || ca.some(k => mine.includes(k));
}
// May log time and improvements on it: admins and approvers always; members on their clients.
function waCanWork(c){ return (typeof canApprove === 'function' && canApprove()) || waMine(c); }
function waTaskAllowed(name){
  if(typeof canApprove === 'function' && canApprove()) return true;
  const mine = waMyAreas(), a = waTaskArea(name);
  return !mine.length || !a || mine.includes(a);
}
// Why it's not yours, in words: "Outside your areas: it's Paid Ads work."
function waOutsideWords(c){
  const ca = waClientAreas(c) || [];
  return `Outside your areas${ca.length ? `: it’s ${waWords(ca)} work` : ''}.`;
}
// The panel's line under Details for a client you can't log on.
function waOutsideNoteHtml(c){ return waCanWork(c) ? '' : `<p class="cl-out">${icon('info')}<span>${escapeHtml(waOutsideWords(c))}</span></p>`; }
// A sheet opened for a client: false (and a note) when it's outside your areas.
function waPresetOk(clientId){
  const c = typeof clientId === 'string' && clientId ? clients.find(x => x.id === clientId) : null;
  if(c && !waCanWork(c)){ showToast('info', `${c.name} isn’t one of your clients`, waOutsideWords(c)); return false; }
  return true;
}
// The pickers: the clients you can work on (and the one already chosen).
function waWorkable(list, keepId){ return list.filter(c => c.id === keepId || waCanWork(c)); }

// The clients someone works on: their areas' clients and the ones they own (every client with no areas).
function waClientsOf(profileId){
  const areas = waPersonAreas(profileId), p = (typeof teamProfiles !== 'undefined' ? teamProfiles : []).find(x => x.id === profileId);
  return activeClients().filter(c => {
    if(!areas.length) return true;
    if(p && c.customFieldValues && c.customFieldValues.owner === p.name) return true;
    const ca = waClientAreas(c);
    return !ca || ca.some(k => areas.includes(k));
  });
}

// Settings → Areas: changes save as they're made.
async function waToggle(kind, key, area){
  if(typeof canApprove !== 'function' || !canApprove()) return;
  await changeSettings(s => {
    const w = s.workAreas = Object.assign({ people: {}, projects: {} }, s.workAreas || {});
    w.people = w.people || {}; w.projects = w.projects || {};
    const cur = kind === 'people' ? waPersonAreas(key) : waProjectAreas(key);
    const next = cur.includes(area) ? cur.filter(k => k !== area) : cur.concat(area);
    w[kind][key] = WORK_AREAS.map(a => a[0]).filter(k => next.includes(k));
  });
}
async function waResetProject(name){
  if(typeof canApprove !== 'function' || !canApprove()) return;
  await changeSettings(s => { if(s.workAreas && s.workAreas.projects) delete s.workAreas.projects[name]; });
}
// A package Harvest spells two ways ("MDF Tier 1" and "MDF - Tier 1") is one row in Settings; a change
// there goes to every spelling.
async function waToggleNames(names, area){
  if(typeof canApprove !== 'function' || !canApprove() || !names.length) return;
  await changeSettings(s => {
    const w = s.workAreas = Object.assign({ people: {}, projects: {} }, s.workAreas || {});
    w.projects = w.projects || {};
    const cur = waProjectAreas(names[0]);
    const next = cur.includes(area) ? cur.filter(k => k !== area) : cur.concat(area);
    names.forEach(n => { w.projects[n] = WORK_AREAS.map(a => a[0]).filter(k => next.includes(k)); });
  });
}
async function waResetNames(names){
  if(typeof canApprove !== 'function' || !canApprove()) return;
  await changeSettings(s => { if(s.workAreas && s.workAreas.projects) names.forEach(n => delete s.workAreas.projects[n]); });
}
