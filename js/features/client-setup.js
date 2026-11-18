// Clients Radar added from Harvest (step 2 of the Harvest plan). Every active Harvest client is in
// Radar: linked to the client with the same name, or added and marked "Needs setup" for an
// approver to finish (custom_field_values.harvestSetup = 'needed'). They wait at the top of All
// Clients, out of This Week, Health, Today and the reminders, until someone fills in who owns
// them and how they get their weekly win, then presses Finish Setup. What they buy is their
// Harvest projects (harvest-time.js).
//   Not a Radar Client  sends it to Trash for good: Harvest won't add it again.
//   Same as…            it's a client Radar already has under another name: the Harvest link
//                       moves there, with anything logged on the added one (the server does it).

let hvLinks = null; // { byRadar: Map(Radar client id -> Harvest client), projects: [...] }; null = not loaded

async function hvLoadLinks(){
  if(typeof supabaseClient === 'undefined' || !myProfile) return;
  try{
    const [c, p] = await Promise.all([
      supabaseClient.from('harvest_clients').select('harvest_id, name, is_active, radar_client_id'),
      supabaseClient.from('harvest_projects').select('harvest_id, client_harvest_id, name, is_active, budget, budget_by, budget_is_monthly'),
    ]);
    if(c.error) return;
    hvLinks = { byRadar: new Map((c.data || []).filter(x => x.radar_client_id).map(x => [String(x.radar_client_id), x])), projects: p.data || [] };
    if(currentViewName === 'clients' && typeof renderClientsTable === 'function') renderClientsTable();
  }catch(e){}
}
function hvLinkOf(c){ return c && hvLinks ? hvLinks.byRadar.get(String(c.id)) || null : null; }
function hvProjectsOf(c){
  const hc = hvLinkOf(c);
  return hc ? hvLinks.projects.filter(p => p.client_harvest_id === hc.harvest_id && p.is_active).sort((a, b) => a.name.localeCompare(b.name)) : [];
}

// What's left before a client can finish setup. The win needs its WhatsApp group, an email to
// send to, or both, depending on how it gets it.
function clientSetupSteps(c){
  const cfv = c.customFieldValues || {}, ch = winChannel(c);
  const needEmail = ch !== 'whatsapp' && !c.email, needGroup = ch !== 'email' && !winGroupFor(c);
  return [
    { k: 'owner', ok: !!cfv.owner, word: 'owner' },
    // a client in Harvest buys its Harvest projects, so there's no service to pick
    ...(serviceFromHarvest(c) ? [] : [{ k: 'service', ok: !!c.service, word: 'service' }]),
    { k: 'win', ok: !needEmail && !needGroup, word: needEmail && needGroup ? 'WhatsApp group and email' : needEmail ? 'email' : 'WhatsApp group' },
  ];
}
function clientSetupLeftWords(c){
  const left = clientSetupSteps(c).filter(s => !s.ok).map(s => s.word);
  return left.length ? 'Needs ' + (left.length > 1 ? left.slice(0, -1).join(', ') + ' and ' + left[left.length - 1] : left[0]) : 'Ready to finish';
}
function clientAddedWords(c){
  const d = c.customFieldValues && c.customFieldValues.harvestAdded;
  if(!d) return 'Added from Harvest';
  const day = new Date(d + 'T12:00:00'), n = daysBetween(day, rNow());
  return `Added from Harvest ${n <= 0 ? 'today' : n === 1 ? 'yesterday' : 'on ' + fmtShortDate(day)}`;
}

// Radar clients it might be the same as: no Harvest link yet, and a name that starts the same or
// shares most of its words ("Brutsky" and "Brutsky Builds", "Hill Country Roofing" and "Hill
// Country Roofing & Siding").
function clientSameAsGuesses(c){
  const words = s => winNorm(s).split(' ').filter(w => w.length > 2 && !['llc', 'inc', 'the', 'and', 'company', 'corp'].includes(w));
  const mine = words(c.name), key = mine.join(' ');
  if(!key) return [];
  return activeClients().filter(x => !hvLinkOf(x)).map(x => {
    const theirs = words(x.name), k2 = theirs.join(' ');
    if(!k2) return null;
    if(k2 === key || (Math.min(k2.length, key.length) >= 4 && (k2.startsWith(key + ' ') || key.startsWith(k2 + ' ')))) return { c: x, s: 2 };
    const shared = theirs.filter(w => mine.includes(w)).length;
    return shared && shared / Math.min(theirs.length, mine.length) >= 0.6 ? { c: x, s: shared / Math.max(theirs.length, mine.length) } : null;
  }).filter(Boolean).sort((a, b) => b.s - a.s).slice(0, 2).map(x => x.c);
}

// ---- All Clients: the "Needs setup" rows ------------------------------------------------------
function clientSetupRowHtml(c){
  const sel = c.id === inspectedClientId, owner = (c.customFieldValues || {}).owner || '';
  const left = clientSetupSteps(c).filter(s => !s.ok).length;
  return `<div class="cl-r client-row cl-su${sel ? ' is-sel' : ''}" data-id="${c.id}" role="row" tabindex="0" aria-selected="${sel}" onclick="clientRowClick(event,'${c.id}')">
<span class="cl-c" role="cell">${monoHtml(c, 'sm')}<span class="cl-tx"><b>${escapeHtml(c.name)}</b><span class="cl-s">${escapeHtml(clientAddedWords(c))}</span></span></span>
<span class="cl-o" role="cell">${owner ? escapeHtml(owner) : '<span class="t-3">—</span>'}</span>
<span class="cl-need" role="cell"><span class="cl-wk${left ? '' : ' is-ready'}">${escapeHtml(clientSetupLeftWords(c))}</span></span>
<span class="cl-hrs" role="cell">${c.monthlyHourBudget ? `<span><b>${c.monthlyHourBudget}</b> h a month</span>` : ''}</span></div>`;
}

// ---- the panel: finish setup ------------------------------------------------------------------
function clientSetupPanelHtml(c){
  const A = `'${c.id}'`, approver = canApprove(), cfv = c.customFieldValues || {};
  const steps = clientSetupSteps(c), left = steps.filter(s => !s.ok), ok = k => steps.find(s => s.k === k).ok;
  const ch = winChannel(c), g = winGroupFor(c), d = winDay(c);
  const ps = hvProjectsOf(c), hc = hvLinkOf(c);
  const mark = on => `<span class="su-m${on ? ' ok' : ''}" aria-label="${on ? 'Done' : 'To do'}">${on ? icon('check', { weight: 'bold' }) : ''}</span>`;
  const row = (k, label, val, done, note) => `<div class="su-r${done == null ? ' is-opt' : ''}">${done == null ? '<span class="su-m none"></span>' : mark(done)}<span class="su-k">${label}</span><div class="su-v">${val}${note ? `<span class="su-n">${note}</span>` : ''}</div></div>`;
  const pick = (id, label, opts, value, fn, ph) => approver
    ? `<label class="cl-own su-pick"><select id="${id}" onchange="${fn}" aria-label="${label}">${value ? '' : `<option value="" selected disabled hidden></option>`}${opts.map(([v, t]) => `<option value="${escapeHtml(v)}"${String(v) === String(value) ? ' selected' : ''}>${escapeHtml(t)}</option>`).join('')}</select><span${value ? '' : ' class="t-3"'}>${escapeHtml(value ? (opts.find(o => String(o[0]) === String(value)) || [, value])[1] : ph)}</span>${icon('caret-down', { weight: 'bold' })}</label>`
    : (value ? escapeHtml(value) : '<span class="t-3">Not set</span>');

  // owner and service
  const people = (typeof teamProfiles !== 'undefined' ? teamProfiles : []).filter(p => p.name && !p.access_revoked).map(p => p.name).sort();
  const services = [...new Set([...(settings.serviceOptions || []), c.service].filter(Boolean))];
  const parts = serviceParts(c);
  let rows = row('owner', 'Owner', pick('suOwner', 'Owner', people.map(n => [n, n]), cfv.owner || '', `setClientOwner(${A}, this.value)`, 'Choose someone'), ok('owner'))
    + (serviceFromHarvest(c)
      ? row('projects', 'Projects', parts.length ? parts.map(escapeHtml).join(' · ') : '<span class="t-3">None in Harvest yet</span>', null, 'From Harvest.')
      : row('service', 'Service', pick('suService', 'Service', services.map(s => [s, s]), c.service || '', `setClientSetupField(${A}, 'service', this.value)`, 'Choose a service'), ok('service'),
        ps.length ? `In Harvest: ${ps.map(p => escapeHtml(p.name)).join(' · ')}` : ''));

  // the weekly win: how it's sent, then the group and/or the email it needs
  const seg = approver ? `<span class="seg wn-seg" role="radiogroup" aria-label="Sends by">${[['whatsapp', 'WhatsApp'], ['email', 'Email'], ['both', 'Both']]
    .map(([k, t]) => `<button class="${ch === k ? 'on' : ''}" role="radio" aria-checked="${ch === k}" onclick="setWinChannel(${A},'${k}')">${t}</button>`).join('')}</span>` : escapeHtml(winChannelWords(c));
  rows += row('win', 'Weekly win', seg, null);
  if(ch !== 'email') rows += row('group', 'Group', approver
    ? `<button class="pop wn-pop" onclick="winGroupMenu(event,${A})">${g ? `<span>${escapeHtml(g.name)}</span>` : '<span class="t-3">Pick the group</span>'}${icon('caret-down', { weight: 'bold' })}</button>`
    : g ? escapeHtml(g.name) : '<span class="t-3">Not linked yet</span>', !!g);
  if(ch !== 'whatsapp') rows += row('email', 'Email', approver
    ? `<input class="tf su-in" id="suEmail" type="email" value="${escapeHtml(c.email || '')}" placeholder="contact@client.com" onchange="setClientSetupField(${A}, 'email', this.value)" aria-label="Email">`
    : c.email ? escapeHtml(c.email) : '<span class="t-3">Not set</span>', !!c.email, approver ? 'Separate addresses with commas.' : '');
  rows += row('day', 'Win day', approver
    ? `<button class="pop wn-pop" onclick="winDayMenu(event,${A})">${d ? WIN_DAY_NAMES[d] : '<span class="t-3">Every 7 days</span>'}${icon('caret-down', { weight: 'bold' })}</button>`
    : d ? WIN_DAY_NAMES[d] : 'Every 7 days', null);
  // hours: from Harvest's monthly budget when it has one
  const hvHours = ps.filter(p => p.budget_by === 'project' && p.budget_is_monthly && Number(p.budget) > 0).reduce((a, p) => a + Number(p.budget), 0);
  rows += row('hours', 'Hours a month', approver && !hvHours
    ? `<span class="su-h"><input class="tf su-in su-num" id="suHours" type="number" min="0" step="0.5" value="${c.monthlyHourBudget || ''}" placeholder="—" onchange="setClientSetupField(${A}, 'monthlyHourBudget', this.value)" aria-label="Hours a month"><span>h</span></span>`
    : hvHours ? `${Math.round(hvHours * 10) / 10} h` : c.monthlyHourBudget ? `${c.monthlyHourBudget} h` : '<span class="t-3">No budget</span>', null,
    hvHours ? 'From Harvest’s monthly budget. Change it there.' : approver ? 'Leave empty if there’s no budget.' : '');

  // it may be a client Radar already has
  const guess = approver ? clientSameAsGuesses(c)[0] : null;
  const same = guess ? `<div class="su-same"><span>Already in Radar as <b>${escapeHtml(guess.name)}</b>?</span><button class="btn" onclick="hvLinkClient(${A}, '${guess.id}')">Link Them</button></div>` : '';

  const title = approver ? `Finish ${c.name}’s setup` : 'Waiting for an approver';
  const sub = approver ? (left.length ? `${clientSetupLeftWords(c)}. Then it joins This Week, Health and the reminders.` : 'All set. It joins This Week, Health and the reminders.')
    : 'An approver finishes its info, then it joins This Week and Health.';
  const acts = approver ? `<div class="sp-acts su-acts"><button class="btn" onclick="clientNotRadar(${A})">Not a Radar Client</button><button class="btn btn-p" onclick="finishClientSetup(${A})"${left.length ? ' disabled' : ''}>Finish Setup</button></div>` : '';
  const meta = [hc && winNorm(hc.name) !== winNorm(c.name) ? `${hc.name} in Harvest` : '', serviceFromHarvest(c) ? '' : c.service].filter(Boolean).map(escapeHtml).join(' · ');
  return `<aside class="sp cl-p has-foot" aria-label="${escapeHtml(c.name)}">
<div class="sp-bar"><button class="ib" aria-label="Close" title="Close (Esc)" onclick="closeClientInspector()">${icon('x')}</button><span class="cl-pbar-r">${approver ? `<button class="ib" aria-label="More" title="More" onclick="clientSetupMore(event, ${A})">${icon('dots-three')}</button>` : ''}</span></div>
<div class="sp-main">
<div class="sp-head">${monoHtml(c, 'lg')}<div class="tx"><b>${escapeHtml(c.name)}</b><span>${meta || escapeHtml(clientAddedWords(c))}</span></div></div>
<div class="sp-status"><span class="sp-eb warn">Needs setup</span><b>${escapeHtml(title)}</b><span class="sub">${escapeHtml(sub)}</span></div>
${same}
<div class="su-list">${rows}</div>
${acts}
</div>
${clientQuickActionsHtml(c)}
</aside>`;
}

// Save one field from the setup list. Keeps the cursor where it was when the list redraws.
async function setClientSetupField(clientId, field, value){
  const c = clients.find(x => x.id === clientId); if(!c) return;
  if(!canApprove()){ showToast('error', 'Not allowed', 'Only admins and approvers set up clients.'); return; }
  if(field === 'email'){
    value = String(value || '').split(',').map(s => s.trim()).filter(Boolean).join(', ');
    if(value && value.split(', ').some(a => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a))){ showToast('error', 'That email doesn’t look right', 'Use name@company.com, with commas between addresses.'); return; }
  }
  if(field === 'monthlyHourBudget'){ value = Math.max(0, Math.round((Number(value) || 0) * 10) / 10); }
  if(String(c[field] ?? '') === String(value)) return;
  const prev = c[field];
  c[field] = value;
  if(!(await updateClientRow(clientId, { [field]: value }))){ c[field] = prev; showToast('error', 'Couldn’t save', 'Try again in a moment.'); }
  const focused = document.activeElement && document.activeElement.id;
  renderClientsTable();
  if(focused && /^su/.test(focused)) document.getElementById(focused)?.focus();
}

async function finishClientSetup(clientId){
  const c = clients.find(x => x.id === clientId); if(!c || !canApprove()) return;
  if(clientSetupSteps(c).some(s => !s.ok)){ showToast('info', 'Almost there', clientSetupLeftWords(c) + '.'); return; }
  const cfv = Object.assign({}, c.customFieldValues || {});
  delete cfv.harvestSetup; cfv.harvestSetupDone = toDateStr(new Date());
  if(!(await updateClientRow(clientId, { customFieldValues: cfv }))){ showToast('error', 'Couldn’t finish setup', 'Try again in a moment.'); return; }
  c.customFieldValues = cfv;
  if(typeof logClientActivity === 'function') logClientActivity(clientId, 'client_setup', `${myName() || 'Someone'} finished setting up ${c.name}, added from Harvest.`);
  showToast('success', `${c.name} is set up`, 'It shows in This Week, Health and Today now.');
  renderAll();
}

async function clientNotRadar(clientId){
  const c = clients.find(x => x.id === clientId); if(!c || !canApprove()) return;
  if(!(await confirmDialog(`Leave ${c.name} out of Radar? It goes to Trash, and Harvest won’t add it again. You can restore it from Trash.`, { confirmLabel: 'Leave It Out' }))) return;
  const cfv = Object.assign({}, c.customFieldValues || {}, { harvestSetup: 'skipped' });
  const deletedAt = new Date().toISOString();
  if(!(await updateClientRow(clientId, { deletedAt, customFieldValues: cfv }))){ showToast('error', 'Couldn’t save', 'Try again in a moment.'); return; }
  c.deletedAt = deletedAt; c.customFieldValues = cfv;
  if(inspectedClientId === clientId) inspectedClientId = null;
  showToast('success', `${c.name} is left out`, 'Harvest won’t add it again.');
  renderAll();
}

// Same as a client Radar already has: the server moves the Harvest link and anything logged here.
async function hvLinkClient(clientId, targetId){
  const c = clients.find(x => x.id === clientId), t = clients.find(x => x.id === targetId);
  if(!c || !t || !canApprove()) return;
  closeAppModal();
  if(!(await confirmDialog(`Link ${c.name} to ${t.name}? Harvest’s ${c.name} becomes ${t.name} in Radar. Anything logged on ${c.name} moves there, and ${c.name} goes to Trash.`, { confirmLabel: 'Link' }))) return;
  try{
    await harvestApiCall('link-client', { clientId, targetId });
    inspectedClientId = targetId;
    await loadAll();
    showToast('success', `Linked to ${t.name}`, `Harvest’s ${c.name} is ${t.name} in Radar now.`);
    renderAll();
    hvLoadLinks();
  }catch(e){ showToast('error', 'Couldn’t link it', e.message); }
}
function hvSameAsSheet(clientId){
  const c = clients.find(x => x.id === clientId); if(!c) return;
  const guesses = clientSameAsGuesses(c).map(x => x.id);
  const list = activeClients().filter(x => !hvLinkOf(x)).sort((a, b) => (guesses.includes(b.id) - guesses.includes(a.id)) || a.name.localeCompare(b.name));
  if(!list.length){ showToast('info', 'Nothing to link to', 'Every client in Radar is already linked to Harvest.'); return; }
  openAppModal(`<h3>Same as which client?</h3>
<p class="t-2" style="margin:-4px 0 14px;font-size:13px;line-height:1.45">Pick the client Radar already has for Harvest’s ${escapeHtml(c.name)}. Anything logged on ${escapeHtml(c.name)} moves there.</p>
<div class="f"><label for="suSameSel">Client</label><div>${sheetPop('suSameSel', 'Client', list.map(x => [x.id, x.name]), '', "document.getElementById('suSameGo').disabled=!this.value", { placeholder: 'Choose a client' })}</div></div>
<div class="sheet-a"><button class="btn" onclick="closeAppModal()">Cancel</button><button class="btn btn-p" id="suSameGo" disabled onclick="hvLinkClient('${c.id}', document.getElementById('suSameSel').value)">Link</button></div>`, 440);
}
function clientSetupMore(e, clientId){
  e.stopPropagation();
  const had = document.getElementById('clMenu'); had?.remove(); if(had) return;
  const m = document.createElement('div');
  m.className = 'menu'; m.id = 'clMenu'; m.setAttribute('role', 'menu'); Object.assign(m.style, { position: 'fixed', zIndex: '1200' });
  const r = e.currentTarget.getBoundingClientRect();
  m.style.top = (r.bottom + 4) + 'px'; m.style.right = (window.innerWidth - r.right) + 'px';
  m.innerHTML = `<button class="mi" role="menuitem" onclick="hvSameAsSheet('${clientId}')">${icon('link')}Same as Another Client…</button>
<button class="mi" role="menuitem" onclick="openEditClientForm('${clientId}')">${icon('pencil-simple')}Edit Client…</button>`;
  document.body.appendChild(m);
  setTimeout(() => document.addEventListener('click', () => m.remove(), { once: true }), 0);
}

// ---- New Client, with Harvest connected (step 5): clients start in Harvest -----------------------
// Each client is set up once: in Harvest, with its project, tasks, budget and people. Radar brings
// it in (when someone opens Radar, at most every 10 minutes, or now with Sync Now) and asks an
// approver to finish what only Radar holds, under Needs setup.
function harvestOwnsClients(){
  return typeof hvTime !== 'undefined' && hvTime && Array.isArray(hvTime.clients) && hvTime.clients.some(c => c.radar_client_id);
}
let hvCompanyUrl = null;
function openAddInHarvestSheet(){
  const href = hvCompanyUrl ? hvCompanyUrl.replace(/\/$/, '') + '/clients' : 'https://id.getharvest.com/harvest';
  openAppModal(`<h3>New Client</h3>
<p class="t-2 hvn-p">Clients start in Harvest, so each one is set up once.</p>
<ol class="hvn">
<li><b>Add the client in Harvest</b><span>With its project, tasks, budget and who’s on it.</span></li>
<li><b>Radar brings it in</b><span>Within 10 minutes, or now with Sync Now. It waits under Needs setup in All Clients.</span></li>
<li><b>Finish its info here</b><span>Owner and how it gets its weekly win.</span></li>
</ol>
<div class="sheet-a"><button class="btn" onclick="closeAppModal()">Cancel</button><button class="btn" id="hvnSync" onclick="hvNewClientSync()">Sync Now</button><a class="btn btn-p" id="hvnOpen" href="${escapeHtml(href)}" target="_blank" rel="noopener" onclick="closeAppModal()">Open Harvest</a></div>`, 480);
  if(!hvCompanyUrl && typeof harvestApiCall === 'function') harvestApiCall(null).then(st => {
    if(st && st.companyUrl){ hvCompanyUrl = st.companyUrl; const a = document.getElementById('hvnOpen'); if(a) a.href = st.companyUrl.replace(/\/$/, '') + '/clients'; }
  }).catch(() => {});
}
async function hvNewClientSync(){
  const b = document.getElementById('hvnSync'); if(b){ b.disabled = true; b.textContent = 'Reading Harvest…'; }
  try{
    const r = await harvestApiCall('sync-setup', { force: true });
    const added = (r && r.clients && (r.clients.added || 0) + (r.clients.back || 0)) || 0;
    closeAppModal();
    await loadAll(); await Promise.all([hvLoadLinks(), typeof hvTimeLoad === 'function' ? hvTimeLoad() : null]);
    if(added){ showToast('success', `${added} new from Harvest`, 'Finish their info under Needs setup.'); clientsSeg = 'all'; switchView('clients'); renderAll(); }
    else showToast('info', 'Nothing new in Harvest yet', 'Add the client there first, then Sync Now.');
  }catch(e){ if(b){ b.disabled = false; b.textContent = 'Sync Now'; } showToast('error', 'Couldn’t read Harvest', e.message); }
}
