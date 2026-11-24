// Settings and My Profile, as on the canvas. Settings has five tabs: General, Updates, Clients,
// Connections and Notifications. Harvest, WhatsApp and AI are pages inside Connections, opened from
// its list with a back button. The old tab names (fields, areas, integrations, ai…) still open the
// right place. Every change saves as it is made. The save functions are the ones in settings.js,
// custom-fields.js, integrations.js, sheet-sync.js and profile.js; this file draws the pages.

let settingsTab = 'general';   // the page shown: a tab, or a page inside Connections
const SETTINGS_TABS = [
  ['general', 'General', 'gear-six', () => true],
  ['updates', 'Updates', 'heartbeat', () => true],
  ['clients', 'Clients', 'buildings', () => canApprove()],
  ['connections', 'Connections', 'plugs-connected', () => true],
  ['notifications', 'Notifications', 'bell', () => true],
];
// pages inside Connections
const SETTINGS_SUB = {
  harvest: ['Harvest', () => canApprove() && typeof setHarvest === 'function'],
  whatsapp: ['WhatsApp', () => typeof waCanSetup === 'function' && waCanSetup() && !waHidden()],
  ai: ['AI', () => isAdmin()],
};
const SETTINGS_ALIAS = { fields: 'clients', areas: 'clients', integrations: 'connections' };
let setScrollTo = null;   // a section to bring into view once the page is drawn
function settingsPage(name){
  name = SETTINGS_ALIAS[name] || name;
  if(name === 'ai' && !isAdmin()) return 'updates';   // a member's AI setting is how their drafts are written
  if(SETTINGS_SUB[name]) return SETTINGS_SUB[name][1]() ? name : 'connections';
  const t = SETTINGS_TABS.find(x => x[0] === name);
  return t && t[3]() ? name : 'general';
}
function settingsTabOf(page){ return SETTINGS_SUB[page] ? 'connections' : page; }
function switchSettingsTab(name){
  if(name === 'areas') setScrollTo = 'setAreas';
  const to = settingsPage(name), from = settingsTab;
  setInkSlide = settingsTabOf(from) !== settingsTabOf(to);
  settingsTab = to; renderSettingsView();
  const body = document.querySelector('#settingsRoot .set-body'), pane = document.getElementById('settingsRoot');
  if(from !== to && pane && !setScrollTo) pane.scrollTop = 0;
  if(from !== to && body && typeof motionOK === 'function' && motionOK()){
    // into a page of Connections from the right, back from the left; other tabs fade up
    const dx = SETTINGS_SUB[to] && !SETTINGS_SUB[from] ? 14 : SETTINGS_SUB[from] && to === 'connections' ? -14 : 0;
    body.animate([{ opacity: .35, transform: dx ? `translateX(${dx}px)` : 'translateY(3px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.23,1,.32,1)' });
  }
  setInkSlide = false;
  if(to === 'ai' || to === 'connections'){ if(isAdmin()) loadAiProviderConnectionStatus(); }
  if(to === 'connections') loadIntegrationStatuses();
  if(to === 'harvest' && typeof hvRefreshAll === 'function') hvRefreshAll();
  if(to === 'whatsapp' && typeof waStartPoll === 'function') waStartPoll();
}
function openSettingsTab(tab){ settingsTab = settingsPage(tab); switchView('settings'); setTimeout(() => switchSettingsTab(tab), 0); }

// The open tab is underlined; switching slides the line from the old tab to the new one.
let setInkAt = null, setInkSlide = false;
function placeSetInk(){
  const bar = document.querySelector('#settingsRoot .set-tabs'), on = bar && bar.querySelector('.set-tab.on'), ink = bar && bar.querySelector('.set-ink');
  if(!on || !ink) return;
  const left = on.offsetLeft, width = on.offsetWidth;
  ink.style.width = width + 'px'; ink.style.transform = `translateX(${left}px)`;
  if(setInkSlide && setInkAt && width && (setInkAt.left !== left || setInkAt.width !== width) && typeof motionOK === 'function' && motionOK()){
    ink.animate([{ transform: `translateX(${setInkAt.left}px) scaleX(${setInkAt.width / width})` }, { transform: `translateX(${left}px) scaleX(1)` }], { duration: 300, easing: 'cubic-bezier(.32,.72,0,1)' });
  }
  setInkAt = { left, width };
  if(left < bar.scrollLeft || left + width > bar.scrollLeft + bar.clientWidth) bar.scrollTo({ left: Math.max(0, left - 28), behavior: setInkSlide ? 'smooth' : 'auto' });
}

// ---- small building blocks -----------------------------------------------------------------
const esc = s => escapeHtml(s == null ? '' : String(s));
function fr(title, sub, ctrl, opts){
  opts = opts || {};
  return `<div class="fr"${opts.top ? ' style="align-items:flex-start"' : ''}><div class="l"><b${opts.plain ? ' style="font-weight:400"' : ''}>${title}</b>${sub ? `<span>${sub}</span>` : ''}</div>${ctrl || ''}</div>`;
}
// Your daily summary sent to a Slack ID other than your own goes from your Slack, as you (Nov 24)
function dsSlackSub(){
  const v = String((myProfile && myProfile.daily_summary_slack_id) || '').trim();
  if(!v || v === myProfile.slack_user_id) return 'Leave empty to use your usual Slack';
  const sm = (typeof slackMe !== 'undefined' && slackMe) || {};
  const who = typeof dsRecipient === 'function' && dsRecipient().name ? `To ${esc(dsRecipient().name)}, ` : '';
  const say = t => who ? who + t.charAt(0).toLowerCase() + t.slice(1) : t;
  if(sm.checking || !('connected' in sm)) return say('Goes from your Slack, as you, once it’s connected');
  if(sm.connected) return say('Goes from your Slack, as you');
  if(sm.configured === false) return say('Radar sends it (Slack as you isn’t set up yet)');
  return say('Radar sends it until you <button class="link-row" onclick="slackMeConnect()">connect your Slack</button>, so it goes as you');
}
async function dsSlackSubRefresh(ask){
  const put = () => { const i = document.getElementById('dailySummarySlackIdInput'), el = i && i.closest('.fr') && i.closest('.fr').querySelector('.l > span'); if(el) el.innerHTML = dsSlackSub(); };
  put();
  const v = String((myProfile && myProfile.daily_summary_slack_id) || '').trim();
  if(ask && v && typeof remSlackMeStatus === 'function'){ const sm = typeof slackMe !== 'undefined' && slackMe; if(!sm || sm.checking) await remSlackMeStatus(true); put(); }
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
// One column, centred, with the tabs above it. A page inside Connections has a back button and
// its name instead of a second row of tabs.
function renderSettingsView(){
  const root = document.getElementById('settingsRoot');
  if(!root) return;
  settingsTab = settingsPage(settingsTab);
  const tab = settingsTabOf(settingsTab), sub = SETTINGS_SUB[settingsTab];
  const tabs = SETTINGS_TABS.filter(t => t[3]());
  if(currentViewName === 'settings') setToolbar('Settings', '');   // the tabs say which section
  const keep = document.activeElement && document.activeElement.id;
  const draw = { general: setGeneral, updates: setUpdates, clients: setClients, connections: setConnections, notifications: setNotifications,
    harvest: typeof setHarvest === 'function' ? setHarvest : setConnections, whatsapp: typeof setWhatsapp === 'function' ? setWhatsapp : setConnections, ai: setAi }[settingsTab];
  const head = sub ? `<div class="set-sub"><button class="set-back" onclick="switchSettingsTab('connections')">${icon('caret-left', { weight: 'bold' })}Connections</button><h2>${{ harvest: appLogo('harvest', 'xl'), whatsapp: appLogo('whatsapp', 'xl'), ai: appLogoPair('claude', 'chatgpt', 'xl') }[settingsTab] || ''}${sub[0]}</h2></div>` : '';
  // the new look: the sections as a menu in a card on the left, with icons and My Profile at the end
  const uw = typeof uiStyleOn === 'function' && uiStyleOn();
  const cur = tabs.find(t => t[0] === tab);
  const menuHead = uw ? `<div class="set-mh">${icon('sliders-horizontal')}<b>Settings</b></div>` : '';
  const menuEnd = uw ? `<button class="set-tab" onclick="switchView('profile')">${icon('user')}My Profile</button>` : '';
  const pageHead = uw && cur && !sub ? `<h2 class="set-pt">${cur[1]}</h2>` : '';
  root.innerHTML = `<div class="set-tb">${menuHead}<div class="set-tabs" role="toolbar" aria-label="Settings sections">${tabs.map(([k, t, ic]) => `<button class="set-tab${k === tab ? ' on' : ''}" ${k === tab ? 'aria-current="page"' : ''} onclick="switchSettingsTab('${k}')">${uw ? icon(ic) : ''}${t}</button>`).join('')}${menuEnd}<span class="set-ink" aria-hidden="true"></span></div></div>
<div class="set-body set-${settingsTab}">${pageHead}${head}${draw()}<p class="set-foot">Changes save as you make them.</p></div>`;
  if(typeof icons8Corner === 'function') icons8Corner(root);   // Icons8's icons, credited in the corner (Nov 24)
  placeSetInk();
  if(keep){ const el = document.getElementById(keep); if(el && el.tagName !== 'BUTTON') el.focus(); }
  if(settingsTab === 'ai' || settingsTab === 'connections') applyAiConn();
  if(settingsTab === 'updates' && typeof updateEmailInstructionsStatus === 'function') updateEmailInstructionsStatus();
  if(setScrollTo){ const el = document.getElementById(setScrollTo); setScrollTo = null; if(el) requestAnimationFrame(() => el.scrollIntoView({ block: 'start' })); }
}

// ---- General ----------------------------------------------------------------------------------
function setGeneral(){
  const canWs = canApprove();
  const brand = settings.brandColor || '#C64C19';
  const logo = settings.appIcon ? `<img src="${esc(settings.appIcon)}" alt="" class="logo" style="object-fit:cover">` : `<span class="logo brand-mark">BA</span>`;
  const full = themePrefNow(), night = nightHours(full), pref = night ? 'night' : full;
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
<button class="fr set-go" onclick="switchView('profile')"><div class="l"><b>${esc(myProfile?.name || 'Your profile')}</b><span>Your name, photo, phone and sign-in email</span></div><span class="t-2">My Profile</span>${icon('caret-right', { weight: 'bold' })}</button>
</div>
<div class="set-h">Appearance</div>
<div class="form-grp">
${fr('Theme', themeSubLine(pref), `<div class="appear" role="radiogroup" aria-label="Theme">${ap('auto', 'Auto', '<i style="background:linear-gradient(90deg,#F4F4F7 0 15%,#FFFFFF 15% 50%,#262629 50% 65%,#1E1E20 65%)"></i>')}${ap('light', 'Light', thumb('#FFFFFF', '#F4F4F7'))}${ap('dark', 'Dark', thumb('#1E1E20', '#262629'))}${ap('night', 'Night to Morning', '<i class="ap-night" aria-hidden="true"></i>')}</div>`)}
${night ? fr('Dark from', 'Light the rest of the day', `${sheetPop('nightFrom', 'Dark from', nightTimeOpts(night[0]), night[0], `setNightHours(this.value, null)`)}<span class="t-2" style="font-size:13px">to</span>${sheetPop('nightTo', 'Light from', nightTimeOpts(night[1]), night[1], `setNightHours(null, this.value)`)}`) : ''}
${fr('Show the timer in the sidebar', 'A running timer always shows', swHtml(toolbarTimerPref(), 'Show the timer in the sidebar', 'toggleToolbarTimerPref()'))}
${typeof uiStyleOffered === 'function' && uiStyleOffered() ? fr('New look', 'Rounded cards, big numbers and the Geist font. Off brings back the classic look', swHtml(uiStyleOn(), 'New look', 'toggleUiStyle()')) : ''}
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
async function toggleUiStyle(){ await saveUiStyle(!uiStyleOn()); renderSettingsView(); }
function toolbarTimerPref(){ try{ return localStorage.getItem('bda_tb_timer') !== 'off'; }catch(e){ return true; } }
function toggleToolbarTimerPref(){ try{ localStorage.setItem('bda_tb_timer', toolbarTimerPref() ? 'off' : 'on'); }catch(e){} if(typeof renderSideTimer === 'function') renderSideTimer(); renderSettingsView(); }
// the line under Theme (the hours for Night to Morning are in the row under it)
function themeSubLine(pref){
  const n = nightHours(pref);
  if(n) return 'Dark at night, light through the day';
  return pref === 'light' ? 'Always light' : pref === 'dark' ? 'Always dark' : 'Auto follows your computer';
}
function nightTimeOpts(v){ return sheetTimeOpts(v, 30); }
async function setThemePref(pref){
  // Night keeps the hours you set before, if you had
  if(pref === 'night' && nightHours(themePrefNow())) pref = themePrefNow();
  await saveThemePref(pref);
  renderSettingsView();
}
async function setNightHours(from, to){
  const cur = nightHours(themePrefNow()) || NIGHT_HOURS.slice();
  const f = from || cur[0], t = to || cur[1];
  if(f === t){ showToast('info', 'Pick two different times', 'Dark starts at one time and ends at another.'); renderSettingsView(); return; }
  await saveThemePref(nightPref(f, t));
  renderSettingsView();
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
  const a = updateAutomation(), t = healthThresholds(), can = canApprove(), admin = isAdmin();
  const sig = settings.emailSignature || {};
  const auto = (k, title, sub) => fr(title, sub, swHtml(a[k], title, `saveAutomation('${k}')`, !can));
  const range = (a0, b0, step) => { const o = []; for(let v = a0; v <= b0; v += step) o.push(v); return o; };
  const pair = (key, title, wOpts, rOpts) => `<div class="fr"><div class="l"><b>${title}</b></div><span class="mcol">${popSel(title + ' — watch', wOpts, t[key][0], `saveSignal('${key}',0,this.value)`, { disabled: !can })}</span><span class="mcol">${rOpts ? popSel(title + ' — at risk', rOpts, t[key][1], `saveSignal('${key}',1,this.value)`, { disabled: !can }) : '<span class="t-3">—</span>'}</span></div>`;
  const days = range(3, 30, 1).map(v => [v, `${v} days`]);
  const lateO = [1, 2, 3, 4].map(v => [v, `${v} of the last 4`]);
  const paceO = range(100, 200, 10).map(v => [v, `${v}% of budget`]);
  const taskO = range(1, 10, 1).map(v => [v, String(v)]);
  const flagO = [1, 2, 3, 4, 5].map(v => [v, v === 5 ? '5' : v === 4 ? '4 or 5' : String(v)]);
  const underO = [25, 30, 40, 50, 60, 70].map(v => [v, `Under ${v}%`]);
  const flagOn = settings.ownerRiskFlag !== false;
  // how your drafts are written (everyone), the signature under them (approvers)
  const yours = `<div class="fr fr-stack"><div class="l"><b>How your drafts are written</b><span>The AI follows this for the drafts you write. Each person sets their own.</span></div>
<textarea id="emailInstructions" class="tf" placeholder="Open with “Hi [first name],”. One sentence on the week, then a bulleted list of what we did." onchange="saveEmailInstructions()">${esc(myProfile?.email_instructions || '')}</textarea><div id="emailInstructionsStatus" class="t-2 set-st"></div></div>`;
  const signature = can ? `<div class="fr"><div class="l"><b>Signature</b><span>Added under every update</span></div>
<div class="sig-p">${sig.logoUrl ? `<img src="${safeUrl(sig.logoUrl)}" alt="">` : `<span class="logo">${esc((sig.companyName || settings.appName || 'B').charAt(0).toUpperCase())}</span>`}<div><b>${esc(sig.companyName || 'Your company')}</b><span>${esc(sig.teamLine || sig.website || 'Add a line under the name')}</span></div></div><button class="btn" onclick="openSignatureSheet()" ${admin ? '' : 'disabled'}>Edit…</button></div>` : '';
  if(!can) return `<div class="set-h">Your drafts</div><div class="form-grp">${yours}</div>`;
  return `<div class="set-h">Weekly updates</div>
<div class="form-grp">
${fr('Every client, once a week', 'Due on its win day, else 7 days after its last update; a weekend moves to the Friday before. An approver checks each one and sends it the day it’s ready; nothing goes out by itself. Clients set to No weekly update (the agency itself, an internal client) are skipped.', '<span class="t-2 nowrap">Every week</span>')}
${signature}
${yours}
</div>
<div class="set-h">Help the team keep up</div>
<div class="form-grp">
${auto('autoDraft', 'Write drafts automatically', 'Each weekday morning, for clients due within a day, from the work logged. They still wait for an approver.')}
${auto('remindBehind', 'Remind whoever has an overdue update', 'The next weekday morning after it’s due, in the app and on Slack')}
${auto('mondaySummary', 'Monday summary for approvers', 'Last week’s updates and any client health changes')}
</div>
<div class="set-h mhead"><span>Client health</span><span class="mcol">Watch at</span><span class="mcol">At risk at</span></div>
<div class="form-grp hl-sig">
${pair('noUpdateDays', 'No weekly update sent', days, days)}
${pair('lateOfLast4', 'Updates late or missed', lateO, lateO)}
${pair('hoursPacePct', 'Hours used, on pace for', paceO, paceO)}
<div class="fr"><div class="l"><b>Hours under-used by mid-month</b></div><span class="mcol">${popSel('Hours under-used — watch', underO, t.underUsedPct, 'saveSignalValue(\'underUsedPct\',this.value)', { disabled: !can })}</span><span class="mcol"><span class="t-3">—</span></span></div>
${pair('nothingLoggedDays', 'Nothing logged', days, days)}
${pair('overdueTasks', 'Overdue tasks', taskO, taskO)}
${flagOn ? pair('ownerFlag', 'Owner’s risk flag', flagO, flagO) : ''}
</div>
<div class="form-grp set-gap">
${fr('Owners can flag a client’s risk, 1 to 5', 'From the client’s panel. It counts as a signal above.', swHtml(flagOn, 'Owners can flag a client’s risk', 'changeSettings(s => { s.ownerRiskFlag = s.ownerRiskFlag === false; })'))}
${fr('Flag important clients sooner', 'Importance 8 or more moves up one level', swHtml(t.importantBump, 'Flag important clients sooner', 'saveSignalToggle(\'importantBump\')', !can))}
${fr('Focus clients are watched closer', escapeHtml(focusRuleWords(t)), `<a class="set-lnk" href="#" onclick="setClientsSeg('focus');switchView('clients');return false;">${(typeof focusClients === 'function' ? focusClients().length : 0) || 'No'} Focus client${(typeof focusClients === 'function' ? focusClients().length : 0) === 1 ? '' : 's'}</a>`)}
${fr('Quiet a handled signal for', 'Comes back sooner if it gets worse', popSel('Quiet a handled signal for', [3, 5, 7, 10, 14].map(v => [v, `${v} days`]), t.quietDays, 'saveSignalValue(\'quietDays\',this.value)', { disabled: !can }))}
</div>`;
}
// What the closer watch on Focus clients means, with today's numbers (week-health.js focusThresholds).
function focusRuleWords(t){
  const f = focusThresholds(t);
  return `Nothing logged: watch at ${f.nothingLoggedDays[0]} days, at risk at ${f.nothingLoggedDays[1]}. No update: at risk at ${f.noUpdateDays[1]} days. ${f.lateOfLast4[0]} late update or ${f.overdueTasks[0]} overdue task is Watch. Hours under ${f.underUsedPct}% of the pace are flagged.`;
}
// The daily automations work out "today" in the team's time zone, saved from the browser.
function teamTimeZone(){ try{ return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; }catch(e){ return ''; } }
function saveAutomation(k){ changeSettings(s => { const cur = updateAutomation(); cur[k] = !cur[k]; s.updatesAutomation = cur; if(!s.timezone && teamTimeZone()) s.timezone = teamTimeZone(); }); }
function saveSignal(key, i, v){ changeSettings(s => { const cur = healthThresholds(); const p = cur[key].slice(); p[i] = Number(v); if(i === 0 && p[1] < p[0]) p[1] = p[0]; if(i === 1 && p[0] > p[1]) p[0] = p[1]; cur[key] = p; s.healthSignals = cur; }); }
function saveSignalValue(key, v){ changeSettings(s => { const cur = healthThresholds(); cur[key] = Number(v); s.healthSignals = cur; }); }
function saveSignalToggle(key){ changeSettings(s => { const cur = healthThresholds(); cur[key] = !cur[key]; s.healthSignals = cur; }); }

// ---- Areas: who works on which clients (work-areas.js) ------------------------------------------
function areaChips(kind, key, on){
  return `<span class="ar-chips" role="group" aria-label="Areas">${WORK_AREAS.map(([k, t]) => `<button class="ar-chip${on.includes(k) ? ' on' : ''}" aria-pressed="${on.includes(k)}" onclick="waToggle('${kind}', ${jsArg(key)}, '${k}')">${t}</button>`).join('')}</span>`;
}
// The Harvest tasks someone logged in the last 90 days, most first: a hint for picking their areas.
function areaLoggedTasks(profileId){
  if(typeof timeEntries === 'undefined' || typeof hvTaskName !== 'function') return '';
  const since = toDateStr(addDays(rNow(), -90)), tally = {};
  timeEntries.filter(e => e.userId === profileId && e.harvestTaskId && e.date >= since).forEach(e => { const n = hvTaskName(e.harvestTaskId); if(n && waTaskArea(n)) tally[n] = (tally[n] || 0) + e.minutes; });
  return Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]).join(', ');
}
// ---- Client Fields ----------------------------------------------------------------------------
function optChips(kind){
  const list = settings[OPTION_KIND_KEYS[kind]] || [];
  return list.length ? `<div class="opts">${list.map((o, i) => `<span class="opt">${i > 0 ? `<button class="opt-mv" aria-label="Move ${esc(o)} earlier" title="Move earlier" onclick="moveOpt('${kind}',${jsArg(o)},-1)">${icon('caret-left', { weight: 'bold' })}</button>` : ''}<span>${esc(o)}</span><button class="opt-x" aria-label="Remove ${esc(o)}" title="Remove" onclick="removeOpt('${kind}',${jsArg(o)})">${icon('x', { weight: 'bold' })}</button></span>`).join('')}</div>` : '<span class="t-2">None yet.</span>';
}
function optAddRow(kind, id, ph){
  return `<div class="fr opt-add"><input class="tf" id="${id}" placeholder="${ph}" aria-label="${ph}" onkeydown="if(event.key==='Enter')addOpt('${kind}')"><button class="btn" onclick="addOpt('${kind}')">Add</button></div>`;
}
async function addOpt(kind){ await addFieldOption(kind); renderSettingsView(); }
async function removeOpt(kind, v){ await removeFieldOption(kind, v); renderSettingsView(); }
async function moveOpt(kind, v, d){ await moveFieldOption(kind, v, d); renderSettingsView(); }
// ---- Clients: services, areas of work, statuses and custom fields ----------------------------------
// With Harvest connected a client's services are its active Harvest projects, so the projects are
// listed here with the areas each one covers (that's what decides who works on the client). The
// service list is only for the clients that aren't in Harvest; the line under it opens them.
function setClients(){
  const hv = typeof harvestOwnsServices === 'function' && harvestOwnsServices();
  const outside = hv ? outsideHarvestClients().length : 0;
  const areas = typeof WORK_AREAS !== 'undefined';
  let html = '';
  // services: Harvest's projects by package and tier, and the list for everyone else
  if(hv){
    const groups = setProjectGroups(), own = areas ? (waSet().projects || {}) : {};
    const jrow = g => {
      const on = areas ? waProjectAreas(g.names[0]) : [], k = g.clients.size, others = g.names.filter(n => n !== g.name);
      const sub = [`<a class="set-lnk" href="#" onclick="openProjectClientsSheet(${jsArg(g.key)});return false;">${k} client${k === 1 ? '' : 's'}</a>`,
        areas && !on.length ? 'every area' : '', others.length ? `also “${esc(others.join('”, “'))}” in Harvest` : '',
        g.names.some(n => Array.isArray(own[n])) ? `<a class="ar-reset" href="#" onclick="waResetNames(setProjGroups[${jsArg(g.key)}].names);return false;">Reset</a>` : ''].filter(Boolean).join(' · ');
      return fr(esc(g.name), sub, areas ? `<span class="ar-chips" role="group" aria-label="Areas">${WORK_AREAS.map(([a, t]) => `<button class="ar-chip${on.includes(a) ? ' on' : ''}" aria-pressed="${on.includes(a)}" onclick="waToggleNames(setProjGroups[${jsArg(g.key)}].names, '${a}')">${t}</button>`).join('')}</span>` : '');
    };
    const fams = [...new Set(groups.map(g => g.fam))];
    html += `<div class="set-h">Services from Harvest</div>
${fams.length ? fams.map(f => `<div class="set-h2">${esc(f)}</div><div class="form-grp ar-g">${groups.filter(g => g.fam === f).map(jrow).join('')}</div>`).join('') : `<div class="form-grp">${fr('No projects yet', 'They show here once Harvest is read.', '')}</div>`}
<p class="set-note">Each client’s services are its active projects in Harvest; change them there.${areas ? ' Pick the areas each one covers: a client’s areas are its projects’ areas. Legacy Retainer and projects Radar doesn’t know cover every area until you pick.' : ''}</p>`;
  }
  if(!hv || outside){
    html += `<div class="set-h">${hv ? 'Other services' : 'Services'}</div>
<div class="form-grp"><div class="fr opt-row">${optChips('service')}</div>${optAddRow('service', 'serviceOptionInput', 'Add a service')}</div>
${hv ? `<p class="set-note">For the <a class="set-lnk" href="#" onclick="openOutsideHarvestSheet();return false;">${outside === 1 ? 'client that isn’t' : `${outside} clients that aren’t`} in Harvest</a>. Clients in Harvest show their projects.</p>` : ''}`;
  }
  // areas of work: who works on which clients
  if(areas){
    const role = { admin: 'Admin', approver: 'Approver', member: 'Member' };
    const people = (typeof teamProfiles !== 'undefined' ? teamProfiles : []).filter(p => p.name && !p.access_revoked).sort((a, b) => a.name.localeCompare(b.name));
    const prow = p => {
      const on = waPersonAreas(p.id), logged = areaLoggedTasks(p.id);
      const n = on.length ? waClientsOf(p.id).length : 0;
      const sub = [esc(role[p.role] || ''), on.length ? `${esc(waWords(on))} · <a class="set-lnk" href="#" onclick="openPersonClientsSheet('${p.id}');return false;">${n} client${n === 1 ? '' : 's'}</a>` : 'Every client', logged ? esc(`Logs ${logged}`) : ''].filter(Boolean).join(' · ');
      return fr(esc(p.name), sub, areaChips('people', p.id, on));
    };
    html += `<div class="set-h" id="setAreas">Areas of work</div>
<div class="form-grp ar-g">${people.map(prow).join('')}</div>
<p class="set-note">Each person works on the clients in their areas, and the ones they own. Members can only log time and work on those; admins and approvers can log on any client. No area picked means every client.</p>`;
  }
  const fields = settings.customFields || [];
  const frows = fields.map((f, i) => `<div class="fr"><div class="l"><b>${esc(f.label)}</b><span>${esc(CUSTOM_FIELD_TYPE_LABELS[f.type] || f.type)}${f.type === 'select' ? ` · ${(f.options || []).length} choices` : ''}${f.required ? ' · required' : ''}</span></div>
<button class="ib" aria-label="More options for ${esc(f.label)}" onclick="cfMenu(event,'${f.id}',${i},${fields.length})">${icon('dots-three', { weight: 'bold' })}</button></div>`).join('');
  html += `<div class="set-h">Statuses</div>
<div class="form-grp"><div class="fr opt-row">${optChips('status')}</div>${optAddRow('status', 'statusOptionInput', 'Add a status')}</div>
<div class="set-h">Custom fields</div>
<div class="form-grp">${frows}<div class="fr"><button class="btn btn-q set-add" onclick="openAddCustomFieldModal()">${icon('plus')}Add Field</button></div></div>
<p class="set-note">Extra details kept on each client, shown in its panel and Edit Client.</p>`;
  return html;
}

// Harvest's active projects as packages: one row per package however Harvest spells it, grouped
// by family (MDF, AI SEO, Paid Ads, Website, Branding, Legacy, Other) and ordered by tier.
let setProjGroups = {};
const SET_FAMS = [['MDF', /\bmdf\b|marketing domination/], ['AI SEO', /\bseo\b|ai domination|\badf\b/], ['Paid Ads', /\bgoogle ads\b|\bppc\b|\bmeta\b|\bfacebook\b|\bpaid\b/],
  ['Website', /\bweb ?site\b|\bweb design\b|\bhosting\b|\bmaintenance\b/], ['Branding', /\bbrand|\blogo|\bgraphic/], ['Legacy', /\blegacy\b/]];
function setProjectGroups(){
  const by = {};
  ((typeof hvTime !== 'undefined' && hvTime && hvTime.projects) || []).forEach(p => {
    const hc = (hvTime.clients || []).find(x => Number(x.harvest_id) === Number(p.client_harvest_id));
    if(!hc || !hc.radar_client_id || p.is_active === false) return;
    const name = String(p.name || '').trim(), key = waNorm(name);
    const g = by[key] = by[key] || { key, spell: {}, clients: new Set() };
    g.spell[name] = (g.spell[name] || 0) + 1; g.clients.add(String(hc.radar_client_id));
  });
  const tier = n => { const m = waNorm(n).match(/\btier (\d+)/); return m ? Number(m[1]) : 99; };
  const out = Object.values(by).map(g => {
    const names = Object.keys(g.spell).sort((a, b) => g.spell[b] - g.spell[a] || a.length - b.length);
    const fam = (SET_FAMS.find(([, re]) => re.test(g.key)) || ['Other'])[0];
    return { key: g.key, name: names[0], names, clients: g.clients, fam, tier: tier(g.key) };
  });
  const famAt = f => { const i = SET_FAMS.findIndex(x => x[0] === f); return i < 0 ? 99 : i; };
  out.sort((a, b) => famAt(a.fam) - famAt(b.fam) || a.tier - b.tier || a.name.localeCompare(b.name));
  setProjGroups = Object.fromEntries(out.map(g => [g.key, g]));
  return out;
}
// Who those clients are: a sheet with each one's projects and owner; a row opens it in All Clients.
function openClientListSheet(title, sub, ids){
  const list = ids.map(id => clients.find(c => c.id === id)).filter(c => c && !c.deletedAt).sort((a, b) => a.name.localeCompare(b.name));
  const row = c => `<button class="oh-r oh-go" onclick="ohOpenClient('${c.id}')"><div class="oh-n"><b>${esc(c.name)}</b><span>${esc([c.service || 'No service', clientOwner(c) ? `Owner ${firstName(clientOwner(c))}` : 'No owner'].join(' · '))}</span></div>${icon('caret-right', { weight: 'bold' })}</button>`;
  openAppModal(`<h3>${esc(title)} <span class="t-3">${list.length}</span></h3>${sub ? `<p class="t-2 oh-sub">${esc(sub)}</p>` : ''}
<div class="oh-l">${list.map(row).join('') || '<p class="t-2 oh-empty">No clients right now.</p>'}</div>
<div class="sheet-a"><button class="btn btn-p" onclick="closeAppModal()">Done</button></div>`, 560);
  setTimeout(() => { const a = document.activeElement; if(a && a.closest('.oh-l')) a.blur(); }, 30);   // no ring on the first row until someone tabs
}
function openProjectClientsSheet(key){
  const g = setProjGroups[key]; if(!g) return;
  openClientListSheet(g.name, g.names.length > 1 ? `Harvest calls it ${g.names.join(' and ')}.` : 'Clients with this project active in Harvest.', [...g.clients]);
}
function openPersonClientsSheet(pid){
  const p = (typeof teamProfiles !== 'undefined' ? teamProfiles : []).find(x => x.id === pid); if(!p) return;
  const on = waPersonAreas(pid);
  openClientListSheet(`${firstName(p.name)}’s clients`, `${waWords(on)} clients, and the ones ${firstName(p.name)} owns.`, waClientsOf(pid).map(c => c.id));
}

// ---- Clients that aren't in Harvest: a sheet with each one's service and what to do with it ------
function outsideHarvestClients(){
  return liveClients().filter(c => !(typeof serviceFromHarvest === 'function' && serviceFromHarvest(c))).sort((a, b) => a.name.localeCompare(b.name));
}
function ohRowsHtml(){
  const list = outsideHarvestClients(), opts = settings.serviceOptions || [];
  if(!list.length) return `<p class="t-2 oh-empty">Every client is in Harvest now.</p>`;
  return list.map(c => {
    const svc = c.service || '';
    const options = [['', 'No service'], ...[...new Set([svc, ...opts].filter(Boolean))].map(x => [x, x])];
    const sub = [clientOwner(c) ? `Owner ${firstName(clientOwner(c))}` : 'No owner', c.status || ''].filter(Boolean).join(' · ');
    return `<div class="oh-r"><div class="oh-n"><b>${esc(c.name)}</b><span>${esc(sub)}</span></div>
${popSel(`${c.name}’s service`, options, svc, `saveOutsideService('${c.id}', this.value)`, { placeholder: 'No service' })}
<button class="ib" aria-label="More for ${esc(c.name)}" onclick="ohMenu(event,'${c.id}')">${icon('dots-three', { weight: 'bold' })}</button></div>`;
  }).join('');
}
function openOutsideHarvestSheet(){
  const n = outsideHarvestClients().length;
  openAppModal(`<h3>Clients not in Harvest <span class="t-3" id="ohCount">${n}</span></h3>
<p class="t-2 oh-sub">They keep the service picked here. Add one in Harvest with the same name and Radar links it the next time it reads Harvest, with its projects and time.</p>
<div class="oh-l" id="ohList">${ohRowsHtml()}</div>
<div class="sheet-a"><a class="btn" style="margin-right:auto" href="${esc(ohHarvestUrl())}" target="_blank" rel="noopener">${icon('external-link')}Open Harvest</a><button class="btn btn-p" onclick="closeAppModal()">Done</button></div>`, 600);
  setTimeout(() => { const a = document.activeElement; if(a && a.closest('.oh-l')) a.blur(); }, 30);   // no ring on the first row until someone tabs
  if(!hvCompanyUrl && typeof harvestApiCall === 'function') harvestApiCall(null).then(st => { if(st && st.companyUrl){ hvCompanyUrl = st.companyUrl; } }).catch(() => {});
}
function ohHarvestUrl(){ return typeof hvCompanyUrl !== 'undefined' && hvCompanyUrl ? hvCompanyUrl.replace(/\/$/, '') + '/clients' : 'https://id.getharvest.com/harvest'; }
function ohRefresh(){
  const l = document.getElementById('ohList'), n = document.getElementById('ohCount');
  if(l) l.innerHTML = ohRowsHtml();
  if(n) n.textContent = outsideHarvestClients().length;
  if(currentViewName === 'settings') renderSettingsView();
}
async function saveOutsideService(id, v){
  const c = clients.find(x => x.id === id); if(!c || !canApprove()) return;
  if(!(await updateClientRow(id, { service: v }))){ showToast('error', 'Couldn’t save', 'Try again in a moment.'); ohRefresh(); return; }
  c.service = v;
  showToast('success', 'Saved', v ? `${c.name}: ${v}` : `${c.name} has no service`);
  ohRefresh(); if(typeof renderAll === 'function') renderAll();
}
function ohMenu(e, id){
  e.stopPropagation();
  const had = document.getElementById('ohMenu'); had?.remove(); if(had && had.dataset.id === id) return;
  const c = clients.find(x => x.id === id); if(!c) return;
  const copies = typeof setupClients === 'function' ? setupClients() : [];
  const m = document.createElement('div');
  m.className = 'menu'; m.id = 'ohMenu'; m.dataset.id = id; m.setAttribute('role', 'menu'); Object.assign(m.style, { position: 'fixed', zIndex: '1200' });
  const r = e.currentTarget.getBoundingClientRect();
  m.style.top = (r.bottom + 4) + 'px'; m.style.right = (window.innerWidth - r.right) + 'px';
  m.innerHTML = `<button class="mi" role="menuitem" onclick="ohOpenClient('${id}')">${icon('briefcase')}Open in All Clients</button>
${copies.length ? `<button class="mi" role="menuitem" onclick="ohSameAs('${id}')">${icon('link')}Same as a Harvest Client…</button>` : ''}
<a class="mi" role="menuitem" href="${esc(ohHarvestUrl())}" target="_blank" rel="noopener">${icon('external-link')}Add It in Harvest</a>
<div class="msep"></div><button class="mi danger" role="menuitem" onclick="ohTrash('${id}')">${icon('trash')}Move to Trash…</button>`;
  document.body.appendChild(m);
  setTimeout(() => document.addEventListener('click', () => m.remove(), { once: true }), 0);
}
function ohOpenClient(id){
  closeAppModal();
  if(typeof clientsSeg !== 'undefined') clientsSeg = 'all';
  inspectedClientId = id; switchView('clients');
}
// The Harvest copy this client is: Radar keeps this client, with Harvest's projects and time.
function ohSameAs(id){
  const c = clients.find(x => x.id === id), copies = setupClients().sort((a, b) => a.name.localeCompare(b.name));
  if(!c || !copies.length) return;
  openAppModal(`<h3>Which client is ${esc(c.name)} in Harvest?</h3>
<p class="t-2" style="margin:-4px 0 14px;font-size:13px;line-height:1.45">These came from Harvest and are waiting under Needs setup. Radar keeps ${esc(c.name)}, with the projects and time of the one you pick, and removes the copy.</p>
<div class="f"><label for="ohSameSel">In Harvest</label><div>${sheetPop('ohSameSel', 'In Harvest', copies.map(x => [x.id, x.name]), '', "document.getElementById('ohSameGo').disabled=!this.value", { placeholder: 'Choose a client' })}</div></div>
<div class="sheet-a"><button class="btn" onclick="openOutsideHarvestSheet()">Back</button><button class="btn btn-p" id="ohSameGo" disabled onclick="hvLinkClient(document.getElementById('ohSameSel').value, '${c.id}').then(() => { if(currentViewName === 'settings') renderSettingsView(); })">Link</button></div>`, 460);
}
async function ohTrash(id){
  await deleteClient(id);
  ohRefresh();
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

// ---- Connections → AI: the accounts, which one the Assistant uses, and the weekly insights ------
// Drafts are written with ChatGPT; the Assistant uses the one picked here.
function setAi(){
  const admin = isAdmin(), provider = settings.aiProvider === 'openai' ? 'openai' : 'claude';
  const conn = p => `<div class="fr">${appLogo(p === 'claude' ? 'claude' : 'chatgpt')}<div class="l"><b>${p === 'claude' ? 'Claude' : 'ChatGPT'}</b><span id="aiConnectionStatus-${p}">Checking…</span></div><input id="${p === 'claude' ? 'setClaudeModel' : 'setOpenaiModel'}" class="tf" style="width:170px" value="${esc(p === 'claude' ? settings.claudeModel || '' : settings.openaiModel || '')}" placeholder="${esc(p === 'claude' ? DEFAULT_CLAUDE_MODEL : DEFAULT_OPENAI_MODEL)}" aria-label="${p === 'claude' ? 'Claude' : 'ChatGPT'} model" onchange="saveAiModel('${p}', this.value)" title="Model"><button class="btn" id="aiConnectionBtn-${p}" onclick="openAiProviderConnectModal('${p}')">Connect…</button></div>`;
  return `<div class="set-h">Accounts</div><div class="form-grp">${conn('claude')}${conn('openai')}</div>
<p class="set-note">Each account’s key stays on the server. The box is the model it uses. Drafts are written with ChatGPT.</p>
<div class="set-h">Assistant</div>
<div class="form-grp">
${fr('Use', 'For the Assistant', `<div class="seg" role="radiogroup" aria-label="AI for the Assistant">${[['claude', 'Claude'], ['openai', 'ChatGPT']].map(([k, t]) => `<button role="radio" aria-checked="${provider === k}" class="${provider === k ? 'on' : ''}" ${admin ? `onclick="saveAiProvider('${k}').then(renderSettingsView)"` : 'disabled'}>${t}</button>`).join('')}</div>`)}
</div>`;
}
let aiConnCache = null;
async function loadAiProviderConnectionStatus(){
  try{ aiConnCache = await adminActionCall('get-ai-connections'); }catch(e){ console.error('loadAiProviderConnectionStatus error', e); return; }
  applyAiConn();
}
function aiConnWords(){
  if(!aiConnCache) return null;
  const on = ['claude', 'openai'].filter(p => { const i = aiConnCache[p] || {}; return i.connected || i.envConfigured; });
  return on.length === 2 ? 'Claude and ChatGPT' : on.length ? (on[0] === 'claude' ? 'Claude' : 'ChatGPT') : '';
}
function applyAiConn(){
  if(!aiConnCache) return;
  const row = document.getElementById('cnAiSt');
  if(row){ const w = aiConnWords(); row.innerHTML = w ? `<span class="dot green"></span>${w}` : '<span class="dot hollow"></span>Not connected'; }
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
${f('setSignatureEmail', 'email', 'Email', 'hello@based-agency.com')}
${f('setSignatureWebsite', 'website', 'Website', 'based-agency.com')}
${f('setSignatureAddress', 'address', 'Address', '')}
</div>
<div class="sheet-a"><button class="btn btn-p" onclick="closeAppModal()">Done</button></div>`, 480);
}

// ---- Connections: the apps Radar works with -----------------------------------------------------
// Harvest, WhatsApp and AI open as pages here; Slack and Google Sheet open a sheet; Google Calendar
// is yours alone and connects in place.
let integ = { google: null, harvest: null, slackUnlinked: null };
// Connections shows at once (Nov 23): what was known last time comes back straight away (kept on this
// device), every check runs at the same time, and each row fills in as soon as its own answer is in,
// instead of all of them waiting for the slowest.
const integKey = () => `radar-integ-${currentUser?.id || ''}`;
function integHydrate(){
  if(integ._hydrated) return; integ._hydrated = true;
  try{
    const c = JSON.parse(localStorage.getItem(integKey()) || 'null'); if(!c) return;
    if(integ.google == null && c.google) integ.google = c.google;
    if(integ.slackMe == null && c.slackMe && typeof slackMe !== 'undefined'){ integ.slackMe = c.slackMe; if(!slackMe) slackMe = c.slackMe; }
    if(integ.slackUnlinked == null && c.slackUnlinked != null) integ.slackUnlinked = c.slackUnlinked;
    if(c.ai && typeof aiAppsState !== 'undefined' && aiAppsState.ready == null) aiAppsState = c.ai;
    if(c.granola && typeof granolaState !== 'undefined' && granolaState == null) granolaState = c.granola;
  }catch(e){}
}
function integSave(){
  try{ localStorage.setItem(integKey(), JSON.stringify({ google: integ.google, slackMe: integ.slackMe || null, slackUnlinked: integ.slackUnlinked,
    ai: typeof aiAppsState !== 'undefined' && aiAppsState.ready != null ? aiAppsState : null,
    granola: typeof granolaState !== 'undefined' && granolaState && !granolaState.error ? { connected: granolaState.connected, needsSql: granolaState.needsSql, lastError: granolaState.lastError || null } : null })); }catch(e){}
}
let integRedrawQ = false;
function integRedraw(){
  if(integRedrawQ) return; integRedrawQ = true;
  requestAnimationFrame(() => { integRedrawQ = false; if(currentViewName === 'settings' && settingsTab === 'connections') renderSettingsView(); });
}
async function loadIntegrationStatuses(){
  integHydrate();
  const one = p => Promise.resolve().then(p).catch(() => {}).then(integRedraw);
  await Promise.all([
    one(async () => { if(typeof fetchGoogleCalendarStatus === 'function'){ const g = await fetchGoogleCalendarStatus(); if(g) integ.google = g; } }),
    one(async () => { if(canApprove()) integ.harvest = await harvestApiCall(null).catch(() => null); }),
    one(async () => { if(typeof loadGranolaState === 'function') await loadGranolaState(); }),
    one(async () => { if(typeof loadAiApps === 'function') await loadAiApps(); }),
    one(async () => { if(isAdmin() && !aiConnCache) aiConnCache = await adminActionCall('get-ai-connections'); }),
    one(async () => { if(canApprove() && typeof loadSlackClientChannels === 'function'){ if(!slackChannelsLoaded) await loadSlackClientChannels(); integ.slackUnlinked = activeClients().filter(c => !slackClientChannels[c.id]).length; } }),
    one(async () => { if(typeof loadWaTasks === 'function') await loadWaTasks(); }),
    one(async () => { if(typeof remSlackMeStatus === 'function') integ.slackMe = await remSlackMeStatus(true); }),
    one(async () => { if(typeof gmailStatusLoad === 'function') await gmailStatusLoad(); }),
  ]);
  integSave();
}
// A few seconds after Radar opens, the quick checks run once in the background, so the first visit
// to Connections already knows them.
function integPrefetch(){
  setTimeout(async () => {
    integHydrate();
    await Promise.all([
      typeof fetchGoogleCalendarStatus === 'function' ? fetchGoogleCalendarStatus().then(g => { if(g) integ.google = g; }).catch(() => {}) : null,
      typeof loadAiApps === 'function' ? loadAiApps().catch(() => {}) : null,
      typeof remSlackMeStatus === 'function' ? remSlackMeStatus(true).then(x => { integ.slackMe = x; }).catch(() => {}) : null,
    ]);
    integSave(); integRedraw();
  }, 5000);
}
function setConnections(){
  integHydrate();
  const st = (color, text, id) => `<span class="st"${id ? ` id="${id}"` : ''}><span class="dot ${color}"></span>${text}</span>`;
  const g = integ.google, h = integ.harvest, approver = canApprove();
  const go = (js, logo, name, sub, status) => `<button class="fr cn-r" onclick="${js}">${logo}<div class="l"><b>${name}</b><span>${sub}</span></div>${status}${icon('caret-right', { weight: 'bold' })}</button>`;
  const rows = [];
  if(approver) rows.push(go("switchSettingsTab('harvest')", appLogo('harvest'), 'Harvest',
    h && h.connected ? `Clients, projects, tasks and time${h.setup && h.setup.syncedAt && typeof hvWhen === 'function' ? ' · read ' + hvWhen(h.setup.syncedAt) : ''}` : 'Time logged the way Harvest is set up',
    h == null ? st('', 'Checking…') : h.connected ? st('green', 'Connected') : st('hollow', 'Not connected')));
  const wa = typeof waIntegrationRow === 'function' ? waIntegrationRow() : null;
  if(wa) rows.push(go(wa[5] || "switchSettingsTab('whatsapp')", appLogo('whatsapp'), 'WhatsApp', wa[2], wa[3]));
  if(approver) rows.push(go("openIntegrationSheet('slack')", appLogo('slack'), 'Slack', 'Client channels, reminders and daily summaries',
    integ.slackUnlinked == null ? st('', 'Checking…') : integ.slackUnlinked ? st('yellow', `${integ.slackUnlinked} client${integ.slackUnlinked === 1 ? '' : 's'} not linked`) : st('green', 'Connected')));
  if(typeof granolaRowStatus === 'function') rows.push(go('openGranolaSheet()', appLogo('granola'), 'Granola', 'Action items from meetings, suggested as tasks', granolaRowStatus(st)));
  if(isAdmin()){ const w = aiConnWords(); rows.push(go("switchSettingsTab('ai')", appLogoPair('claude', 'chatgpt'), 'AI', 'Claude and ChatGPT: drafts, the Assistant and weekly insights', w == null ? st('', 'Checking…', 'cnAiSt') : w ? st('green', w, 'cnAiSt') : st('hollow', 'Not connected', 'cnAiSt'))); }
  rows.push(go("openIntegrationSheet('sheet')", appLogo('gsheets'), 'Google Sheet', settings.sheetCsvUrl ? 'Pulls the client list from a published sheet' : 'Keep a copy of the client list in a sheet',
    settings.sheetCsvUrl ? st('green', 'Connected') : st('hollow', 'Not connected')));
  const gRow = g == null ? `<div class="fr cn-r">${appLogo('gcalendar')}<div class="l"><b>Google Calendar</b><span>Your meetings in the team calendar</span></div>${st('', 'Checking…')}</div>` : g && g.googleConfigured ? `<div class="fr cn-r">${appLogo('gcalendar')}<div class="l"><b>Google Calendar</b><span>${g.connected ? `Your meetings in the team calendar${g.lastSyncedAt ? ' · synced ' + claudeWhen(g.lastSyncedAt).toLowerCase() : ''}` : 'Bring your meetings into the team calendar'}</span></div>
${g.connected ? `${st('green', 'Connected')}<button class="btn" onclick="syncGoogleCalendar().then(loadIntegrationStatuses)">Sync Now</button>` : `<button class="btn" onclick="connectGoogleCalendar()">Connect…</button>`}</div>` : '';
  // ChatGPT and Claude: each person connects their own (ai-apps.js)
  const aiRow = typeof aiAppsRowStatus === 'function' ? go('openAiAppsSheet()', appLogoPair('chatgpt', 'claude'), 'ChatGPT and Claude', 'Use Radar from their apps, as you', aiAppsRowStatus(st)) : '';
  // Slack, as you (Nov 23): nudges to teammates go from your own Slack (lib/slack-me.js)
  const sm = integ.slackMe;
  const smRow = !sm || sm.checking ? `<div class="fr cn-r">${appLogo('slack')}<div class="l"><b>Slack, as you</b><span>Send nudges to teammates from your own Slack</span></div>${st('', 'Checking…')}</div>` : `<div class="fr cn-r">${appLogo('slack')}<div class="l"><b>Slack, as you</b><span>${sm.connected ? 'Nudges to teammates go from your Slack, as you' : sm.configured ? 'Send nudges to teammates from your own Slack' : 'Send nudges to teammates from your own Slack (an admin sets it up once)'}</span></div>
${sm.connected ? `${st('green', 'Connected')}<button class="btn" onclick="slackMeDisconnect()">Disconnect</button>` : sm.configured ? `<button class="btn" onclick="slackMeConnect()">Connect…</button>` : isAdmin() ? `${st('hollow', 'Not set up')}<button class="btn" onclick="slackMeSetupSheet()">Set Up…</button>` : st('hollow', 'Not set up')}</div>`;
  // Gmail (Nov 24): tasks from your clients' emails (gmail.js)
  const gmRow = typeof gmailRowHtml === 'function' ? gmailRowHtml(st) : '';
  const yours = gRow || aiRow || smRow || gmRow ? `<div class="set-h">Yours</div><div class="form-grp cn-g">${aiRow}${smRow}${gRow}${gmRow}</div>` : '';
  const live = (supabaseClient.getChannels ? supabaseClient.getChannels() : []).some(c => c.state === 'joined');
  // Set Up Radar (Nov 24): everything that's yours, step by step
  const su = typeof setupOpen === 'function' ? `<div class="su-cta"><span class="app-logo is-glyph" aria-hidden="true">${icon('compass')}</span><div class="l"><b>Set Up Radar</b><span>Connect everything that’s yours, one step at a time.</span></div><button class="btn" onclick="setupOpen('welcome')">Start…</button></div>` : '';
  return `${su}<div class="set-h">Apps</div><div class="form-grp cn-g">${rows.join('')}</div>
${yours}
<p class="set-note cn-live">${st(live ? 'green' : 'yellow', live ? 'Live: changes show for everyone as they’re made' : 'Reconnecting… changes show for everyone once it’s back')}</p>
<p class="t-2 set-note" id="sheetSyncStatus"></p>`;
}
// ---- Tasks from Slack (Nov 23, lib/slack-tasks.js) -------------------------------------------------
// By itself: a message in a channel Radar is in that asks a teammate to do something becomes their
// task. What Radar last heard from Slack shows here, and the one-time setup in Slack's app settings.
let slackTasksState = null;
async function loadSlackTasksState(){
  try{ const { data } = await supabaseClient.from('app_storage').select('value').eq('key', 'slack-auto-tasks').maybeSingle(); slackTasksState = data && data.value ? JSON.parse(data.value) : {}; }catch(e){ slackTasksState = {}; }
  const el = document.getElementById('slackTasksBox'); if(el) el.innerHTML = slackTasksHtml(slackTasksState);
}
function toggleSlackAutoTasks(){
  if(!isAdmin()) return;
  changeSettings(s => { s.slackAutoTasks = s.slackAutoTasks === false; });
  const el = document.getElementById('slackTasksBox'); if(el) el.innerHTML = slackTasksHtml(slackTasksState);
}
function slackTasksHtml(st){
  const on = settings.slackAutoTasks !== false, ago = t => { const d = new Date(t); return isNaN(d) ? '' : `${relDay(d).toLowerCase() === 'today' ? 'today' : relDay(d)} at ${fmtTime(d)}`; };
  const heard = st == null ? 'Checking…' : st.lastEventAt
    ? `Last heard from Slack ${ago(st.lastEventAt)}${st.lastTaskAt ? `. Last task: “${esc(st.lastTaskTitle || '')}”, ${ago(st.lastTaskAt)}` : ''}.`
    : 'Not hearing from Slack yet: set it up there once (below).';
  const url = `${location.origin}/api/send-slack-message`;
  return `<div class="form-grp">${fr('Add tasks from Slack by itself', 'When someone asks a teammate to do something in a channel Radar is in, it becomes their task, links and all. A message to Radar itself is a task for you. Radar answers in the thread; react with :x: to take one back.', swHtml(on, 'Add tasks from Slack by itself', 'toggleSlackAutoTasks()', !isAdmin()))}
<div class="fr"><div class="l"><span class="t-2" id="slackHeard">${heard}</span></div></div></div>
<details class="sl-setup"><summary>Set it up in Slack (once)</summary><ol>
<li>At api.slack.com/apps, open the Radar app. <b>Event Subscriptions</b>: turn it on, and paste this as the Request URL:<span class="sl-url"><code>${esc(url)}</code><button type="button" class="btn sm" onclick="copyToClipboard(${jsArg(url)}).then(()=>{this.textContent='Copied';setTimeout(()=>{this.textContent='Copy'},1600)})">Copy</button></span></li>
<li>Under <b>Subscribe to bot events</b>, add <code>message.channels</code>, <code>message.groups</code>, <code>message.im</code>, <code>app_mention</code> and <code>reaction_added</code>. Save.</li>
<li><b>OAuth &amp; Permissions</b>: make sure the bot has <code>channels:history</code>, <code>groups:history</code>, <code>im:history</code>, <code>app_mentions:read</code>, <code>reactions:read</code> and <code>chat:write</code>, then reinstall the app when Slack asks.</li>
<li>In each channel where work gets asked for, type <code>/invite @Radar</code>.</li>
<li>For <code>/task</code>: under <b>Slash Commands</b>, edit /task and tick <b>Escape channels, users, and links sent to your app</b>, so people and links come through.</li>
</ol></details>
<p class="sl-cmd">By command still works: <code>/task @person what to do due:friday</code>, with any links in it kept on the task.</p>`;
}
// What an admin does once so each person can connect their own Slack (lib/slack-me.js)
function slackMeSetupSheet(){
  const url = `${location.origin}/slack/oauth`;
  openAppModal(`<h3 class="ap-h">${appLogo('slack', 'sm')}Slack, as each person</h3>
<p class="t-2" style="font-size:13.5px;line-height:1.5;margin:0 0 10px">So a nudge to a teammate goes from the sender’s own Slack, not the Radar bot. Once, in the Slack app Radar already uses:</p>
<ol class="sl-steps" style="font-size:13.5px;line-height:1.55;padding-left:20px;margin:0">
<li>At api.slack.com/apps, open the Radar app. <b>OAuth &amp; Permissions → Redirect URLs</b>: add<span class="sl-url"><code>${esc(url)}</code><button type="button" class="btn sm" onclick="copyToClipboard(${jsArg(url)}).then(()=>{this.textContent='Copied';setTimeout(()=>{this.textContent='Copy'},1600)})">Copy</button></span></li>
<li>Same page, <b>User Token Scopes</b>: add <code>chat:write</code> and <code>im:write</code>. Save.</li>
<li><b>Basic Information → App Credentials</b>: copy the Client ID and Client Secret into Vercel as <code>SLACK_CLIENT_ID</code> and <code>SLACK_CLIENT_SECRET</code>, then redeploy.</li>
<li>Run <code>addendum-teammate-reminders.sql</code> in Supabase → SQL Editor.</li>
</ol>
<p class="t-2" style="font-size:13px;margin:12px 0 0">Then each person presses Connect here once, and Slack asks them to allow it.</p>
<div class="sheet-a"><button class="btn btn-p" onclick="closeAppModal()">Done</button></div>`, 560);
}
function openIntegrationSheet(which){
  if(which === 'harvest'){
    switchSettingsTab('harvest'); // everything Harvest lives in its own tab now
  } else if(which === 'slack'){
    openAppModal(`<h3 class="ap-h">${appLogo('slack', 'sm')}Slack</h3>
<div id="slackTasksBox">${slackTasksHtml(null)}</div>
<div class="sl-h">Client channels</div><div id="slackChannelsPanelBody" class="integ-sheet">Loading…</div><div class="sheet-a"><button class="btn btn-p" onclick="closeAppModal();loadIntegrationStatuses()">Done</button></div>`, 620);
    loadSlackChannelsPanel();
    loadSlackTasksState();
  } else {
    openAppModal(`<h3 class="ap-h">${appLogo('gsheets', 'sm')}Google Sheet</h3>
<div class="f" style="grid-template-columns:120px minmax(0,1fr)">
<label for="sheetCsvUrl">Published link</label><input class="tf" id="sheetCsvUrl" value="${esc(settings.sheetCsvUrl || '')}" placeholder="https://docs.google.com/…/pub?output=csv">
<span></span><p class="t-2" style="font-size:13px;margin:0">In Google Sheets: File → Share → Publish to web → CSV. A normal edit link won’t work.</p>
<label for="csvPasteArea" class="top">Or paste</label><textarea class="tf" id="csvPasteArea" style="height:90px" placeholder="Paste copied cells or CSV here"></textarea>
</div>
<div class="sheet-a"><button class="btn" onclick="importPastedCsv()">Import Pasted</button><button class="btn" style="margin-right:auto" onclick="exportRosterCsv()">${icon('export')}Export CSV</button><button class="btn" onclick="closeAppModal()">Cancel</button><button class="btn btn-p" onclick="saveAndSyncSheet().then(()=>{closeAppModal();renderSettingsView();})">Save &amp; Sync</button></div>
${icons8Credit(['gsheets'], 'sh-i8')}`, 560);
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
  // the sound in the app, on this device (Nov 23)
  const snd = radarSoundOn();
  const sound = `<div class="form-grp nt-snd"><div class="fr"><div class="l"><b>Sound</b><span>A soft chime in Radar when a notification comes in, on this device.</span></div><button type="button" class="sw${snd ? ' on' : ''}" role="switch" aria-checked="${snd}" aria-label="Sound" onclick="setRadarSound(!radarSoundOn());renderNotificationPrefs()"></button></div></div>`;
  return sound + `<p class="set-note" style="margin:0 4px 4px">Choose where each kind of notification reaches you. Nothing goes to Slack on Saturdays and Sundays; reminders wait for Monday morning.</p>` + [...sections.entries()].map(([s, rows]) =>
    `<div class="mhead nt-h"><span>${esc(s)}</span><span class="mcol">In app</span><span class="mcol">Slack</span><span class="mcol">Push</span></div>
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
${fr(esc(currentUser.email || ''), admin ? 'You can change it here. A link goes to the new address to confirm.' : 'An admin approves changes to it.', `<input id="${admin ? 'directEmailInput' : 'requestEmailInput'}" class="tf" style="width:200px" placeholder="new@based-agency.com"><button class="btn" onclick="${admin ? 'saveDirectEmailChange()' : 'submitEmailChangeRequest()'}">${admin ? 'Change' : 'Ask to Change'}</button>`)}
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
${fr('Send my summary to a different Slack ID', dsSlackSub(), `<input id="dailySummarySlackIdInput" class="tf" style="width:200px" value="${esc(myProfile.daily_summary_slack_id || '')}" placeholder="Member ID" onchange="saveDailySummarySlackId(this.value.trim())">`)}
</div></div>`;
  if(!admin) renderMyEmailRequests();
  dsSlackSubRefresh(true);
  if(typeof loadPushStatus === 'function') loadPushStatus();
  if(typeof loadGoogleCalendarStatus === 'function') loadGoogleCalendarStatus();
  if(keep){ const el = document.getElementById(keep); if(el) el.focus(); }
}
async function saveProfileField(){ await saveProfileBasicInfo(); }
