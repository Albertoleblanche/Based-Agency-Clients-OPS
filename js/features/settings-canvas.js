// Settings and My Profile, as on the canvas. Settings has six panes (General, Updates, Client
// Fields, AI & Email, Integrations, Notifications) chosen from the icon strip at the top; every
// change saves as it is made. The save functions are the ones in settings.js, custom-fields.js,
// integrations.js, sheet-sync.js and profile.js; this file draws the panes.

let settingsTab = 'general';
const SETTINGS_TABS = [
  ['general', 'General', 'gear-six', () => true],
  ['updates', 'Updates', 'heartbeat', () => canApprove()],
  ['fields', 'Client Fields', 'buildings', () => canApprove()],
  ['ai', 'AI & Email', 'envelope-simple', () => true],
  ['integrations', 'Integrations', 'plugs-connected', () => true],
  ['whatsapp', 'WhatsApp', 'message-circle', () => typeof waCanManage === 'function' && waCanManage() && !waHidden()],
  ['notifications', 'Notifications', 'bell', () => true],
];
function switchSettingsTab(name){
  if(name === 'clients') name = 'fields';
  settingsTab = name; renderSettingsView();
  if(name === 'ai' && isAdmin()) loadAiProviderConnectionStatus();
  if(name === 'integrations') loadIntegrationStatuses();
  if(name === 'whatsapp' && typeof waStartPoll === 'function') waStartPoll();
}
function openSettingsTab(tab){ settingsTab = tab === 'clients' ? 'fields' : tab; switchView('settings'); setTimeout(() => switchSettingsTab(settingsTab), 0); }

// ---- small building blocks -----------------------------------------------------------------
const esc = s => escapeHtml(s == null ? '' : String(s));
function fr(title, sub, ctrl, opts){
  opts = opts || {};
  return `<div class="fr"${opts.top ? ' style="align-items:flex-start"' : ''}><div class="l"><b${opts.plain ? ' style="font-weight:400"' : ''}>${title}</b>${sub ? `<span>${sub}</span>` : ''}</div>${ctrl || ''}</div>`;
}
function swHtml(on, label, js, disabled){ return `<button class="sw${on ? ' on' : ''}" role="switch" aria-checked="${!!on}" aria-label="${esc(label)}" onclick="${js}"${disabled ? ' disabled' : ''}></button>`; }
function popSel(label, options, value, onchange, opts){
  opts = opts || {};
  const cur = options.find(o => String(o[0]) === String(value));
  return `<label class="pop pop-sel"${opts.width ? ` style="min-width:${opts.width}px"` : ''}><span>${esc(cur ? cur[1] : (opts.placeholder || ''))}</span>${icon('caret-up-down', { weight: 'bold' })}<select aria-label="${esc(label)}" onchange="${onchange}"${opts.disabled ? ' disabled' : ''}>${options.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
}
async function changeSettings(fn, okMsg){
  await loadAll();
  fn(settings);
  const ok = await persistSettings();
  if(!ok) showToast('error', 'Could not save', 'Try again.');
  else if(okMsg) showToast('success', 'Saved', okMsg);
  renderSettingsView();
  if(typeof renderAll === 'function') renderAll();
  return ok;
}

// ---- the window -------------------------------------------------------------------------------
function renderSettingsView(){
  const root = document.getElementById('settingsRoot');
  if(!root) return;
  const tabs = SETTINGS_TABS.filter(t => t[3]());
  if(!tabs.some(t => t[0] === settingsTab)) settingsTab = 'general';
  const cur = tabs.find(t => t[0] === settingsTab);
  if(currentViewName === 'settings') setToolbar(cur[1], 'Settings');
  const keep = document.activeElement && document.activeElement.id;
  const body = { general: setGeneral, updates: setUpdates, fields: setFields, ai: setAi, integrations: setIntegrations, notifications: setNotifications, whatsapp: typeof setWhatsapp === 'function' ? setWhatsapp : setGeneral }[settingsTab]();
  root.innerHTML = `<div class="set-tb"><div class="set-tabs" role="toolbar" aria-label="Settings sections">${tabs.map(([k, t, ic]) => `<button class="set-tab${k === settingsTab ? ' on' : ''}" ${k === settingsTab ? 'aria-current="page"' : ''} onclick="switchSettingsTab('${k}')">${icon(ic)}<span>${t}</span></button>`).join('')}</div></div>
<div class="set-body">${body}<p class="t-2" style="font-size:13px;margin:14px 4px 0">Changes save as you make them.</p></div>`;
  if(keep){ const el = document.getElementById(keep); if(el && el.tagName !== 'BUTTON') el.focus(); }
  if(settingsTab === 'ai') applyAiConn();
  if(settingsTab === 'ai' && typeof updateEmailInstructionsStatus === 'function') updateEmailInstructionsStatus();
}

// ---- General ----------------------------------------------------------------------------------
function setGeneral(){
  const canWs = canApprove();
  const brand = settings.brandColor || '#C64C19';
  const logo = settings.appIcon ? `<img src="${esc(settings.appIcon)}" alt="" class="logo" style="object-fit:cover">` : `<span class="logo brand-mark">BA</span>`;
  const pref = myProfile && myProfile.theme != null ? myProfile.theme : (localStorage.getItem('bda_theme') || 'auto');
  const thumb = (bg, side) => `<i style="background:linear-gradient(90deg,${side} 0 30%,${bg} 30% 100%)"></i>`;
  const ap = (k, t, i) => `<div role="radio" tabindex="0" aria-checked="${pref === k}" class="${pref === k ? 'on' : ''}" onclick="setThemePref('${k}')" onkeydown="if(event.key==='Enter'||event.key===' ')setThemePref('${k}')">${i}${t}</div>`;
  return `${canWs ? `<div class="set-h">Workspace</div>
<div class="form-grp">
${fr('Name', 'Shown in the sidebar and on emails', `<input id="appNameInput" class="tf" style="width:240px" value="${esc(settings.appName || '')}" placeholder="Based Agency" onchange="saveWorkspaceName(this.value)">`)}
${fr('Logo', 'Square image, at least 256 px', `${logo}<input type="file" id="iconFileInput" accept="image/*" hidden onchange="onIconFileSelected(event)"><button class="btn" onclick="document.getElementById('iconFileInput').click()">Change…</button>${settings.appIcon ? `<button class="btn btn-q" onclick="removeAppIcon().then(renderSettingsView)">Remove</button>` : ''}`)}
${fr('Accent color', 'Used only for the main button on each screen', `<label class="well" style="background:${esc(brand)};position:relative;cursor:default"><input type="color" id="brandColorInput" value="${esc(brand)}" style="position:absolute;inset:0;opacity:0" onchange="saveAccentColor(this.value)" aria-label="Accent color"></label><span class="t-2" style="font-family:var(--mono);font-size:13px">${esc(brand.toUpperCase())}</span><button class="btn" onclick="document.getElementById('brandColorInput').click()">Change…</button>`)}
${fr('Names in the sidebar', 'Rename screens for everyone, and the line under the app name', `<button class="btn" onclick="openSidebarNamesSheet()">Edit…</button>`)}
</div>` : ''}
<div class="set-h">You</div>
<div class="form-grp">
${fr('Your name', 'Filled in for you whenever you log an improvement', `<input id="setYourName" class="tf" style="width:240px" value="${esc(myProfile?.name || '')}" onchange="saveYourName(this.value)">`)}
</div>
<div class="set-h">Appearance</div>
<div class="form-grp">
${fr('Theme', 'Auto follows your computer', `<div class="appear" role="radiogroup" aria-label="Theme">${ap('auto', 'Auto', '<i style="background:linear-gradient(90deg,#F4F4F7 0 15%,#FFFFFF 15% 50%,#262629 50% 65%,#1E1E20 65%)"></i>')}${ap('light', 'Light', thumb('#FFFFFF', '#F4F4F7'))}${ap('dark', 'Dark', thumb('#1E1E20', '#262629'))}</div>`)}
${fr('Show the timer in the sidebar', 'A running timer always shows', swHtml(toolbarTimerPref(), 'Show the timer in the sidebar', 'toggleToolbarTimerPref()'))}
</div>`;
}
async function saveWorkspaceName(v){ await changeSettings(s => { s.appName = v.trim(); }); if(typeof applyAppBranding === 'function') applyAppBranding(); }
async function saveAccentColor(v){ await changeSettings(s => { s.brandColor = v; }); if(typeof applyBrandColor === 'function') applyBrandColor(v); }
async function saveYourName(v){
  const name = v.trim(); if(!name){ showToast('error', 'Name needed', 'Your name can’t be empty.'); renderSettingsView(); return; }
  const { error } = await supabaseClient.from('team_profiles').update({ name }).eq('id', currentUser.id);
  if(error){ showToast('error', 'Could not save', error.message); return; }
  myProfile.name = name; await loadTeamProfiles(); renderWhoAmI(); showToast('success', 'Saved', 'Your name is updated.');
}
function toolbarTimerPref(){ try{ return localStorage.getItem('bda_tb_timer') !== 'off'; }catch(e){ return true; } }
function toggleToolbarTimerPref(){ try{ localStorage.setItem('bda_tb_timer', toolbarTimerPref() ? 'off' : 'on'); }catch(e){} if(typeof renderSideTimer === 'function') renderSideTimer(); renderSettingsView(); }
async function setThemePref(pref){
  document.body.classList.add('theme-switching'); setTimeout(() => document.body.classList.remove('theme-switching'), 260);
  if(pref === 'auto'){
    try{ localStorage.removeItem('bda_theme'); }catch(e){}
    if(myProfile) myProfile.theme = null;
    document.body.dataset.theme = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } else {
    try{ localStorage.setItem('bda_theme', pref); }catch(e){}
    if(myProfile) myProfile.theme = pref;
    document.body.dataset.theme = pref;
  }
  if(typeof syncDarkModeToggleUI === 'function') syncDarkModeToggleUI();
  renderSettingsView();
  if(currentUser) await supabaseClient.from('team_profiles').update({ theme: pref === 'auto' ? null : pref }).eq('id', currentUser.id);
}
function openSidebarNamesSheet(){
  const labels = settings.navLabels || {};
  const rows = Object.entries(NAV_LABEL_DEFAULTS).map(([k, d]) => `<label for="navl-${k}">${esc(d)}</label><input class="tf" id="navl-${k}" value="${esc(labels[k] || '')}" placeholder="${esc(d)}" onchange="saveNavLabel('${k}', this.value)">`).join('');
  openAppModal(`<h3>Names in the sidebar</h3>
<div class="f" style="grid-template-columns:120px minmax(0,1fr)">
<label for="appDescriptionInput">Tagline</label><input class="tf" id="appDescriptionInput" value="${esc(settings.appDescription || '')}" placeholder="Client Update Workflow" onchange="changeSettings(s => { s.appDescription = this.value.trim(); }).then(() => applyAppBranding && applyAppBranding())">
${rows}
<span></span><p class="t-2" style="font-size:13px;margin:0">Leave a name empty to go back to the usual one.</p></div>
<div class="sheet-a"><button class="btn btn-p" onclick="closeAppModal()">Done</button></div>`, 520);
}

const DAY_OPTS = DAY_NAMES.map((d, i) => [i, d]);
// ---- Updates (the weekly update and client health) ---------------------------------------------
function setUpdates(){
  const a = updateAutomation(), t = healthThresholds(), can = canApprove();
  const auto = (k, title, sub) => fr(title, sub, swHtml(a[k], title, `saveAutomation('${k}')`, !can));
  const range = (a0, b0, step) => { const o = []; for(let v = a0; v <= b0; v += step) o.push(v); return o; };
  const pair = (key, title, wOpts, rOpts) => `<div class="fr"><div class="l"><b>${title}</b></div><span class="mcol" style="width:150px">${popSel(title + ' — watch', wOpts, t[key][0], `saveSignal('${key}',0,this.value)`, { disabled: !can })}</span><span class="mcol" style="width:150px">${rOpts ? popSel(title + ' — at risk', rOpts, t[key][1], `saveSignal('${key}',1,this.value)`, { disabled: !can }) : '<span class="t-2">—</span>'}</span></div>`;
  const days = range(3, 30, 1).map(v => [v, `${v} days`]);
  const lateO = [1, 2, 3, 4].map(v => [v, `${v} of the last 4`]);
  const paceO = range(100, 200, 10).map(v => [v, `${v}% of budget`]);
  const taskO = range(1, 10, 1).map(v => [v, String(v)]);
  const flagO = [1, 2, 3, 4, 5].map(v => [v, v === 5 ? '5' : v === 4 ? '4 or 5' : String(v)]);
  const underO = [25, 30, 40, 50, 60, 70].map(v => [v, `Under ${v}%`]);
  return `<div class="set-h">Weekly client updates</div>
<div class="form-grp">
${fr('Once a week, for every client', 'Due 7 days after its last update. An approver checks each one and sends it the day it’s ready. Nothing is ever sent automatically.', '<span class="t-2" style="white-space:nowrap">Every 7 days</span>')}
</div>
<div class="set-h">Help the team keep up</div>
<div class="form-grp">
${auto('autoDraft', 'Write drafts automatically', 'Each morning, for clients due within a day, from the work logged. They still wait for an approver.')}
${auto('remindBehind', 'Remind whoever has an overdue update', 'The morning after it’s due, in the app and on Slack')}
${auto('mondaySummary', 'Monday summary for approvers', 'Last week’s updates and any client health changes')}
</div>
<div class="mhead" style="margin-top:20px"><span style="font-size:14px;color:var(--label);font-weight:600">Client health signals</span><span class="mcol" style="width:150px">Watch at</span><span class="mcol" style="width:150px">At risk at</span></div>
<div class="form-grp">
${pair('noUpdateDays', 'No weekly update sent', days, days)}
${pair('lateOfLast4', 'Updates late or missed', lateO, lateO)}
${pair('hoursPacePct', 'Hours used, on pace for', paceO, paceO)}
<div class="fr"><div class="l"><b>Hours under-used by mid-month</b></div><span class="mcol" style="width:150px">${popSel('Hours under-used — watch', underO, t.underUsedPct, 'saveSignalValue(\'underUsedPct\',this.value)', { disabled: !can })}</span><span class="mcol" style="width:150px"><span class="t-2">—</span></span></div>
${pair('nothingLoggedDays', 'Nothing logged', days, days)}
${pair('overdueTasks', 'Overdue tasks', taskO, taskO)}
${settings.ownerRiskFlag === false ? '' : pair('ownerFlag', 'Owner’s own risk flag', flagO, flagO)}
</div>
<div class="form-grp" style="margin-top:12px">
${fr('Flag important clients sooner', 'Importance 8 or more moves up one level', swHtml(t.importantBump, 'Flag important clients sooner', 'saveSignalToggle(\'importantBump\')', !can))}
${fr('Quiet a handled signal for', 'Comes back sooner if it gets worse', popSel('Quiet a handled signal for', [3, 5, 7, 10, 14].map(v => [v, `${v} days`]), t.quietDays, 'saveSignalValue(\'quietDays\',this.value)', { disabled: !can }))}
</div>`;
}
// The daily automations work out "today" in the team's time zone, saved from the browser.
function teamTimeZone(){ try{ return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; }catch(e){ return ''; } }
function saveAutomation(k){ changeSettings(s => { const cur = updateAutomation(); cur[k] = !cur[k]; s.updatesAutomation = cur; if(!s.timezone && teamTimeZone()) s.timezone = teamTimeZone(); }); }
function saveSignal(key, i, v){ changeSettings(s => { const cur = healthThresholds(); const p = cur[key].slice(); p[i] = Number(v); if(i === 0 && p[1] < p[0]) p[1] = p[0]; if(i === 1 && p[0] > p[1]) p[0] = p[1]; cur[key] = p; s.healthSignals = cur; }); }
function saveSignalValue(key, v){ changeSettings(s => { const cur = healthThresholds(); cur[key] = Number(v); s.healthSignals = cur; }); }
function saveSignalToggle(key){ changeSettings(s => { const cur = healthThresholds(); cur[key] = !cur[key]; s.healthSignals = cur; }); }

// ---- Client Fields ----------------------------------------------------------------------------
function optChips(kind){
  const list = settings[OPTION_KIND_KEYS[kind]] || [];
  return list.length ? `<div class="opts">${list.map((o, i) => `<span class="opt">${i > 0 ? `<button class="ib opt-mv" aria-label="Move ${esc(o)} earlier" title="Move earlier" onclick="moveOpt('${kind}',${jsArg(o)},-1)">${icon('caret-left', { weight: 'bold' })}</button>` : ''}${esc(o)}<button class="ib" style="width:16px;height:16px" aria-label="Remove ${esc(o)}" onclick="removeOpt('${kind}',${jsArg(o)})">${icon('x', { weight: 'bold' })}</button></span>`).join('')}</div>` : '<span class="t-2" style="font-size:14px">None yet.</span>';
}
async function addOpt(kind){ await addFieldOption(kind); renderSettingsView(); }
async function removeOpt(kind, v){ await removeFieldOption(kind, v); renderSettingsView(); }
async function moveOpt(kind, v, d){ await moveFieldOption(kind, v, d); renderSettingsView(); }
function setFields(){
  const fields = settings.customFields || [];
  const frows = fields.map((f, i) => `<div class="fr"><div class="l"><b>${esc(f.label)}</b>${f.type === 'select' ? `<span>${(f.options || []).length} choices</span>` : ''}</div><span class="t-2" style="font-size:13px">${esc(CUSTOM_FIELD_TYPE_LABELS[f.type] || f.type)}${f.required ? ' · required' : ''}</span>
<div class="pop-wrap" style="background:none;padding:0"><button class="ib" aria-label="More options for ${esc(f.label)}" onclick="cfMenu(event,'${f.id}',${i},${fields.length})">${icon('dots-three', { weight: 'bold' })}</button></div></div>`).join('');
  return `<div class="set-h">Services</div>
<div class="form-grp"><div class="fr" style="flex-wrap:wrap;padding:12px 14px">${optChips('service')}</div>
<div class="fr"><input class="tf" id="serviceOptionInput" style="flex:1" placeholder="Add a service" aria-label="Add a service" onkeydown="if(event.key==='Enter')addOpt('service')"><button class="btn" onclick="addOpt('service')">Add</button></div></div>
<div class="set-h">Client statuses</div>
<div class="form-grp"><div class="fr" style="flex-wrap:wrap;padding:12px 14px">${optChips('status')}</div>
<div class="fr"><input class="tf" id="statusOptionInput" style="flex:1" placeholder="Add a status" aria-label="Add a status" onkeydown="if(event.key==='Enter')addOpt('status')"><button class="btn" onclick="addOpt('status')">Add</button></div></div>
<div class="set-h">Custom fields</div>
<div class="form-grp">${frows}<div class="fr"><button class="btn btn-q" style="padding:0" onclick="openAddCustomFieldModal()">${icon('plus')}Add Field</button></div></div>
<div class="set-h">Risk flag</div>
<div class="form-grp">
${fr('Owners can flag a client’s risk, 1 to 5', 'Counts toward client health. The other signals are in Updates.', swHtml(settings.ownerRiskFlag !== false, 'Owners can flag a client’s risk', 'changeSettings(s => { s.ownerRiskFlag = s.ownerRiskFlag === false; })'))}
</div>`;
}
function cfMenu(e, id, i, n){
  e.stopPropagation();
  document.getElementById('cfMenu')?.remove();
  const m = document.createElement('div');
  m.className = 'menu'; m.id = 'cfMenu'; m.style.position = 'fixed';
  const r = e.currentTarget.getBoundingClientRect();
  m.style.top = (r.bottom + 4) + 'px'; m.style.right = (window.innerWidth - r.right) + 'px';
  m.innerHTML = `<button class="mi" onclick="openAddCustomFieldModal('${id}')">${icon('pencil-simple')}Edit…</button>${i > 0 ? `<button class="mi" onclick="moveCustomField('${id}',-1).then(renderSettingsView)">Move Up</button>` : ''}${i < n - 1 ? `<button class="mi" onclick="moveCustomField('${id}',1).then(renderSettingsView)">Move Down</button>` : ''}<div class="msep"></div><button class="mi danger" onclick="deleteCustomField('${id}').then(renderSettingsView)">${icon('trash')}Delete…</button>`;
  document.body.appendChild(m);
  setTimeout(() => document.addEventListener('click', () => m.remove(), { once: true }), 0);
}

// ---- AI & Email -------------------------------------------------------------------------------
function setAi(){
  const admin = isAdmin(), provider = settings.aiProvider === 'openai' ? 'openai' : 'claude';
  const sig = settings.emailSignature || {};
  const insightsOn = settings.proactiveInsightsEnabled !== false;
  const conn = p => `<div class="fr"><span class="ic lg">${icon('sparkle')}</span><div class="l"><b>${p === 'claude' ? 'Claude' : 'ChatGPT'}</b><span id="aiConnectionStatus-${p}">Checking…</span></div><input id="${p === 'claude' ? 'setClaudeModel' : 'setOpenaiModel'}" class="tf" style="width:180px" value="${esc(p === 'claude' ? settings.claudeModel || '' : settings.openaiModel || '')}" placeholder="${esc(p === 'claude' ? DEFAULT_CLAUDE_MODEL : DEFAULT_OPENAI_MODEL)}" aria-label="${p === 'claude' ? 'Claude' : 'ChatGPT'} model" onchange="saveAiModel('${p}', this.value)" title="Model"><button class="btn" id="aiConnectionBtn-${p}" onclick="openAiProviderConnectModal('${p}')">Connect</button></div>`;
  return `${admin ? `<div class="set-h">Weekly insights</div>
<div class="form-grp">
${fr('AI provider', 'For the weekly insights in Focus Reports', `<div class="seg" role="radiogroup" aria-label="AI provider">${[['claude', 'Claude'], ['openai', 'ChatGPT']].map(([k, t]) => `<button role="radio" aria-checked="${provider === k}" class="${provider === k ? 'on' : ''}" ${admin ? `onclick="saveAiProvider('${k}').then(renderSettingsView)"` : 'disabled'}>${t}</button>`).join('')}</div>`)}
${fr('Weekly insights', 'A short note on patterns across your clients', `${popSel('Day', DAY_OPTS.map(([i, d]) => [i, 'Every ' + d]), settings.proactiveInsightsDayOfWeek ?? 3, 'saveProactiveInsightsDay(this.value).then(renderSettingsView)', { disabled: !admin })}${swHtml(insightsOn, 'Weekly insights', 'toggleProactiveInsightsEnabled().then(renderSettingsView)', !admin)}`)}
</div>` : ''}
${admin ? `<div class="set-h">AI accounts</div><div class="form-grp">${conn('claude')}${conn('openai')}</div>` : ''}
<div class="set-h">Client emails</div>
<div class="form-grp">
${fr('How your drafts are written', 'The AI follows this for the drafts you write. Each person sets their own.', `<div style="width:340px"><textarea id="emailInstructions" class="tf" style="width:100%;height:112px" placeholder="Open with “Hi [first name],”. One sentence on the week, then a bulleted list of what we did." onchange="saveEmailInstructions()">${esc(myProfile?.email_instructions || '')}</textarea><div id="emailInstructionsStatus" class="t-2" style="font-size:12px;margin-top:4px"></div></div>`, { top: true })}
${canApprove() ? fr('Signature', 'Added under every update', `<div style="width:340px;display:flex;gap:12px;align-items:center;padding:12px;border-radius:8px;background:var(--fill)">${sig.logoUrl ? `<img src="${safeUrl(sig.logoUrl)}" alt="" style="width:36px;height:36px;border-radius:9px;object-fit:contain;background:#fff">` : `<span class="logo">${esc((sig.companyName || settings.appName || 'B').charAt(0).toUpperCase())}</span>`}<div style="font-size:13px;line-height:1.45;min-width:0"><b>${esc(sig.companyName || 'Your company')}</b><div class="t-2">${esc(sig.teamLine || sig.website || 'Add a line under the name')}</div></div><button class="btn" style="margin-left:auto" onclick="openSignatureSheet()" ${admin ? '' : 'disabled'}>Edit…</button></div>`, { top: true }) : ''}
</div>
${admin ? `<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px"><button class="btn" onclick="previewProactiveInsights()">${icon('eye')}Preview Weekly Insights</button></div>` : ''}`;
}
let aiConnCache = null;
async function loadAiProviderConnectionStatus(){
  try{ aiConnCache = await adminActionCall('get-ai-connections'); }catch(e){ console.error('loadAiProviderConnectionStatus error', e); return; }
  applyAiConn();
}
function applyAiConn(){
  if(!aiConnCache) return;
  ['claude', 'openai'].forEach(p => {
    const info = aiConnCache[p] || {}, el = document.getElementById('aiConnectionStatus-' + p), btn = document.getElementById('aiConnectionBtn-' + p);
    if(el) el.innerHTML = info.connected ? `<span class="st"><span class="dot green"></span>Connected${info.baseUrl ? ' · custom endpoint' : ''}</span>` : info.envConfigured ? '<span class="st"><span class="dot green"></span>Set on the server</span>' : '<span class="st"><span class="dot hollow"></span>Not connected</span>';
    if(btn) btn.textContent = info.connected ? 'Change Key…' : 'Connect…';
  });
}
function renderAiProviderChoice(){ if(currentViewName === 'settings' && settingsTab === 'ai') applyAiConn(); }
function renderCustomFieldsManager(){ if(currentViewName === 'settings') renderSettingsView(); }
function renderOptionsManager(){ if(currentViewName === 'settings') renderSettingsView(); }
function renderNavLabelsSettings(){}
function openSignatureSheet(){
  const sig = settings.emailSignature || {};
  const f = (id, key, label, ph) => `<label for="${id}">${label}</label><input class="tf" id="${id}" value="${esc(sig[key] || '')}" placeholder="${esc(ph)}" onchange="saveEmailSignatureField('${key}', this.value).then(renderSettingsView)">`;
  openAppModal(`<h3>Email signature</h3>
<div class="f">
<label>Logo</label><div style="display:flex;align-items:center;gap:10px">${sig.logoUrl ? `<img src="${safeUrl(sig.logoUrl)}" alt="" style="width:36px;height:36px;border-radius:8px;object-fit:contain;background:#fff">` : ''}<input type="file" id="sigLogoInput" accept="image/*" hidden onchange="uploadEmailSignatureLogo(this.files[0]).then(renderSettingsView)"><button class="btn" onclick="document.getElementById('sigLogoInput').click()">Choose Image…</button></div>
${f('setSignatureCompanyName', 'companyName', 'Company', 'Based Agency')}
${f('setSignatureTeamLine', 'teamLine', 'Line under it', 'Based Agency Team')}
${f('setSignaturePhone', 'phone', 'Phone', '(555) 123-4567')}
${f('setSignatureEmail', 'email', 'Email', 'hello@basedagency.com')}
${f('setSignatureWebsite', 'website', 'Website', 'based-agency.com')}
${f('setSignatureAddress', 'address', 'Address', '')}
</div>
<div class="sheet-a"><button class="btn btn-p" onclick="closeAppModal()">Done</button></div>`, 480);
}

// ---- Integrations -----------------------------------------------------------------------------
let integ = { google: null, harvest: null, slackUnlinked: null };
async function loadIntegrationStatuses(){
  const [g, h] = await Promise.all([
    typeof fetchGoogleCalendarStatus === 'function' ? fetchGoogleCalendarStatus() : null,
    canApprove() ? harvestApiCall(null).catch(() => null) : null,
  ]);
  integ.google = g; integ.harvest = h;
  if(isAdmin() && !aiConnCache){ try{ aiConnCache = await adminActionCall('get-ai-connections'); }catch(e){} }
  if(canApprove() && typeof loadSlackClientChannels === 'function'){
    try{ if(!slackChannelsLoaded) await loadSlackClientChannels(); integ.slackUnlinked = activeClients().filter(c => !slackClientChannels[c.id]).length; }catch(e){}
  }
  if(typeof loadWaTasks === 'function'){ try{ await loadWaTasks(); }catch(e){} }
  if(currentViewName === 'settings' && settingsTab === 'integrations') renderSettingsView();
}
function setIntegrations(){
  const st = (color, text) => `<span class="st"><span class="dot ${color}"></span>${text}</span>`;
  const g = integ.google, h = integ.harvest, approver = canApprove();
  const rows = [];
  // live data between everyone's windows
  const live = (supabaseClient.getChannels ? supabaseClient.getChannels() : []).some(c => c.state === 'joined');
  rows.push(['arrows-clockwise', 'Team sync', 'Clients, improvements and drafts stay in sync for everyone', live ? st('green', 'Connected') : st('yellow', 'Reconnecting…'), '']);
  if(isAdmin() && aiConnCache){
    const p = settings.aiProvider === 'openai' ? 'openai' : 'claude', info = aiConnCache[p] || {};
    rows.push(['sparkle', 'AI drafting', `Writes each client’s weekly draft with ${p === 'openai' ? 'ChatGPT' : 'Claude'}`, info.connected || info.envConfigured ? st('green', 'Connected') : st('hollow', 'Not connected'), info.connected || info.envConfigured ? '' : `<button class="btn" onclick="switchSettingsTab('ai')">Set Up…</button>`]);
  }
  if(g && g.googleConfigured) rows.push(['google-logo', 'Google Calendar', g.connected ? `Your meetings, deadlines and send days${g.lastSyncedAt ? ' · synced ' + claudeWhen(g.lastSyncedAt).toLowerCase() : ''}` : 'Bring your meetings into the team calendar',
    g.connected ? st('green', 'Connected') : st('hollow', 'Not connected'), g.connected ? `<button class="btn" onclick="syncGoogleCalendar().then(loadIntegrationStatuses)">Sync Now</button>` : `<button class="btn" onclick="connectGoogleCalendar()">Connect…</button>`]);
  if(approver) rows.push(['timer', 'Harvest', h && h.connected ? `Time entries sync${h.lastSyncedAt ? ' · ' + claudeWhen(h.lastSyncedAt).toLowerCase() : ''}` : 'Send time logged here to Harvest',
    h == null ? st('', 'Checking…') : h.connected ? st('green', 'Connected') : st('hollow', 'Not connected'), `<button class="btn" onclick="openIntegrationSheet('harvest')">${h && h.connected ? 'Settings…' : 'Connect…'}</button>`]);
  if(approver) rows.push(['slack-logo', 'Slack', 'Client channels and daily summaries',
    integ.slackUnlinked == null ? st('', 'Checking…') : integ.slackUnlinked ? st('yellow', `${integ.slackUnlinked} client${integ.slackUnlinked === 1 ? '' : 's'} not linked`) : st('green', 'Connected'), `<button class="btn" onclick="openIntegrationSheet('slack')">Link…</button>`]);
  const wa = typeof waIntegrationRow === 'function' ? waIntegrationRow() : null;
  if(wa) rows.push(wa);
  rows.push(['table', 'Google Sheet', settings.sheetCsvUrl ? 'Pulls the client list from a published sheet' : 'Keep the client list in a Google Sheet',
    settings.sheetCsvUrl ? st('green', 'Connected') : st('hollow', 'Not connected'), `${settings.sheetCsvUrl ? `<button class="btn" onclick="syncFromSheetUrl()">Sync Now</button>` : ''}<button class="btn" onclick="openIntegrationSheet('sheet')">${settings.sheetCsvUrl ? 'Edit…' : 'Connect…'}</button>`]);
  const html = rows.map(([ic, n, d, s, b]) => `<div class="fr"><span class="ic lg">${icon(ic)}</span><div class="l"><b>${n}</b><span>${d}</span></div>${s}${b}</div>`).join('');
  return `<div class="set-h">Connected apps</div><div class="form-grp">${html}</div><p class="t-2" style="font-size:13px;margin:8px 4px 0" id="sheetSyncStatus"></p>
<div class="set-h">Client list</div>
<div class="form-grp"><div class="fr"><div class="l"><b>Export the client list</b><span>A CSV you can paste back into the Google Sheet</span></div><button class="btn" onclick="exportRosterCsv()">${icon('export')}Export CSV</button></div></div>`;
}
function openIntegrationSheet(which){
  if(which === 'harvest'){
    openAppModal(`<h3>Harvest</h3><div id="harvestPanelBody" class="integ-sheet">Loading…</div><div class="sheet-a"><button class="btn btn-p" onclick="closeAppModal();loadIntegrationStatuses()">Done</button></div>`, 620);
    loadHarvestPanel();
  } else if(which === 'slack'){
    openAppModal(`<h3>Slack channels</h3><p class="t-2" style="font-size:13px;margin:-8px 0 12px">Link each client to its Slack channel so updates and alerts land there.</p><div id="slackChannelsPanelBody" class="integ-sheet">Loading…</div><div class="sheet-a"><button class="btn btn-p" onclick="closeAppModal();loadIntegrationStatuses()">Done</button></div>`, 620);
    loadSlackChannelsPanel();
  } else {
    openAppModal(`<h3>Google Sheet</h3>
<div class="f" style="grid-template-columns:120px minmax(0,1fr)">
<label for="sheetCsvUrl">Published link</label><input class="tf" id="sheetCsvUrl" value="${esc(settings.sheetCsvUrl || '')}" placeholder="https://docs.google.com/…/pub?output=csv">
<span></span><p class="t-2" style="font-size:13px;margin:0">In Google Sheets: File → Share → Publish to web → CSV. A normal edit link won’t work.</p>
<label for="csvPasteArea" class="top">Or paste</label><textarea class="tf" id="csvPasteArea" style="height:90px" placeholder="Paste copied cells or CSV here"></textarea>
</div>
<div class="sheet-a"><button class="btn" style="margin-right:auto" onclick="importPastedCsv()">Import Pasted</button><button class="btn" onclick="closeAppModal()">Cancel</button><button class="btn btn-p" onclick="saveAndSyncSheet().then(()=>{closeAppModal();renderSettingsView();})">Save &amp; Sync</button></div>`, 560);
  }
}

// ---- Notifications: where each kind reaches you -------------------------------------------------
// muted_notification_types keeps a type to mute it everywhere (as before), or "app:type",
// "slack:type", "push:type" to mute one place only.
function notifOn(type, ch){ const m = myProfile?.muted_notification_types || []; return !m.includes(type) && !m.includes(ch + ':' + type); }
async function toggleNotifChannel(type, ch){
  let m = (myProfile?.muted_notification_types || []).slice();
  if(m.includes(type)){ m = m.filter(x => x !== type); ['app', 'slack', 'push'].forEach(c => m.push(c + ':' + type)); }
  const k = ch + ':' + type;
  m = m.includes(k) ? m.filter(x => x !== k) : m.concat(k);
  if(['app', 'slack', 'push'].every(c => m.includes(c + ':' + type))) m = m.filter(x => !x.endsWith(':' + type)).concat(type);
  const { error } = await supabaseClient.from('team_profiles').update({ muted_notification_types: m }).eq('id', currentUser.id);
  if(error){ showToast('error', 'Could not save', error.message); return; }
  myProfile.muted_notification_types = m;
  const p = teamProfiles.find(x => x.id === currentUser.id); if(p) p.muted_notification_types = m;
  renderSettingsView();
}
function renderNotificationPrefs(){ if(currentViewName === 'settings') renderSettingsView(); }
function setNotifications(){
  const sections = new Map();
  Object.entries(NOTIFICATION_TYPE_META).forEach(([type, meta]) => {
    if(meta.visibleTo === 'admin' && !isAdmin()) return;
    if(meta.visibleTo === 'approver' && !canApprove()) return;
    const s = meta.section || 'Other';
    if(!sections.has(s)) sections.set(s, []);
    sections.get(s).push([type, meta]);
  });
  const ck = (type, ch, label) => { const on = notifOn(type, ch); return `<span class="mcol"><button class="ck${on ? ' on' : ''}" role="checkbox" aria-checked="${on}" aria-label="${esc(label)}" onclick="toggleNotifChannel('${type}','${ch}')">${on ? icon('check', { weight: 'bold' }) : ''}</button></span>`; };
  return `<p class="t-2" style="font-size:13px;margin:0 4px">Choose where each kind of notification reaches you.</p>` + [...sections.entries()].map(([s, rows]) =>
    `<div class="mhead" style="margin-top:20px"><span style="font-size:13px;color:var(--label);font-weight:600">${esc(s)}</span><span class="mcol">In app</span><span class="mcol">Slack</span><span class="mcol">Push</span></div>
<div class="form-grp">${rows.map(([type, meta]) => `<div class="fr"><div class="l"><b style="font-weight:400">${esc(meta.label)}</b></div>${ck(type, 'app', meta.label + ' — in app')}${ck(type, 'slack', meta.label + ' — Slack')}${ck(type, 'push', meta.label + ' — push')}</div>`).join('')}</div>`).join('');
}

// ---- My Profile ---------------------------------------------------------------------------------
function renderProfilePage(){
  const root = document.getElementById('profileRoot');
  if(!root || !myProfile) return;
  const keep = document.activeElement && document.activeElement.id;
  const avatar = myProfile.avatar_url ? `<img src="${safeUrl(myProfile.avatar_url)}" alt="" style="width:64px;height:64px;border-radius:50%;object-fit:cover">` : avHtml(myProfile.name, 'style="width:64px;height:64px;font-size:22px"');
  const admin = isAdmin();
  root.innerHTML = `<div class="set-body" style="padding-top:26px">
<div style="display:flex;align-items:center;gap:16px;margin:0 4px 22px">${avatar}<div style="min-width:0"><h1 class="lt" style="font-size:22px">${esc(myProfile.name)}</h1><p class="lt-sub" style="margin-top:2px">${esc(myProfile.title || roleDisplayLabel(myProfile.role))} · ${esc(currentUser.email || '')}</p></div>
<span style="flex:1"></span><input type="file" id="avatarFileInput" accept="image/*" hidden onchange="uploadAvatar(this.files[0])"><button class="btn" onclick="document.getElementById('avatarFileInput').click()">${myProfile.avatar_url ? 'Change Photo…' : 'Add Photo…'}</button></div>
<div class="set-h">About you</div>
<div class="form-grp">
${fr('Name', 'How the team and your clients see you', `<input id="profileNameInput" class="tf" style="width:240px" value="${esc(myProfile.name || '')}" onchange="saveProfileField()">`)}
${fr('Phone', '', `<input id="profilePhoneInput" class="tf" style="width:240px" value="${esc(myProfile.phone || '')}" placeholder="(555) 123-4567" onchange="saveProfileField()">`)}
</div>
<div class="set-h">Sign-in email</div>
<div class="form-grp">
${fr(esc(currentUser.email || ''), admin ? 'You can change it here. A link goes to the new address to confirm.' : 'An admin approves changes to it.', `<input id="${admin ? 'directEmailInput' : 'requestEmailInput'}" class="tf" style="width:200px" placeholder="New email"><button class="btn" onclick="${admin ? 'saveDirectEmailChange()' : 'submitEmailChangeRequest()'}">${admin ? 'Change' : 'Ask to Change'}</button>`)}
<div id="myEmailRequestsList"></div>
</div>
<div class="set-h">On this device</div>
<div class="form-grp">
<div class="fr" style="align-items:flex-start"><div class="l"><b>Push notifications</b><span>Alerts even when the app isn’t open</span></div><div id="pushStatusBox" class="integ-inline" style="max-width:340px"></div></div>
</div>
<div class="set-h">Your calendar</div>
<div class="form-grp">
<div class="fr" style="align-items:flex-start"><div class="l"><b>Google Calendar</b><span>Your meetings appear in the team calendar</span></div><div id="gcalStatusBox" class="integ-inline" style="max-width:340px"></div></div>
</div>
<div class="set-h">Daily summary</div>
<div class="form-grp">
${fr('Send my summary to a different Slack ID', 'Leave empty to use your usual Slack', `<input id="dailySummarySlackIdInput" class="tf" style="width:200px" value="${esc(myProfile.daily_summary_slack_id || '')}" placeholder="Member ID" onchange="saveDailySummarySlackId(this.value.trim())">`)}
</div></div>`;
  if(!admin) renderMyEmailRequests();
  if(typeof loadPushStatus === 'function') loadPushStatus();
  if(typeof loadGoogleCalendarStatus === 'function') loadGoogleCalendarStatus();
  if(keep){ const el = document.getElementById(keep); if(el) el.focus(); }
}
async function saveProfileField(){ await saveProfileBasicInfo(); }
