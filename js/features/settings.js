// Settings: app icon & branding, sidebar labels, notification prefs, AI
// provider/model, email signature, Assistant preferences.

/* ---------- App icon: upload, crop, save ---------- */
let cropperInstance = null;

function onIconFileSelected(e){
  const file = e.target.files[0];
  e.target.value = ''; // reset so picking the same file again still fires onchange
  if(!file) return;
  const reader = new FileReader();
  reader.onload = function(evt){
    openAppModal(`
      <div class="modal-head"><span class="panel-title">Crop your icon</span><span class="toast-close" onclick="closeCropModal()">✕</span></div>
      <div class="modal-body">
        <div style="max-height:360px;overflow:hidden;background:#000;"><img id="cropImage" src="${evt.target.result}" style="max-width:100%;display:block;"></div>
        <p style="font-size:11.5px;color:var(--muted-lt);margin:0;">Drag to reposition, scroll or pinch to zoom.</p>
      </div>
      <div class="modal-actions">
        <button class="btn btn-brand" onclick="saveAppIcon()">Save icon</button>
        <button class="btn btn-outline" onclick="closeCropModal()">Cancel</button>
      </div>`, 480);
    setTimeout(()=>{
      const imgEl = document.getElementById('cropImage');
      if(imgEl && window.Cropper){
        cropperInstance = new Cropper(imgEl, { aspectRatio: 1, viewMode: 1, background: false, autoCropArea: 1 });
      }
    }, 50);
  };
  reader.readAsDataURL(file);
}

function closeCropModal(){
  if(cropperInstance){ cropperInstance.destroy(); cropperInstance = null; }
  closeAppModal();
}

async function saveAppIcon(){
  if(!cropperInstance){ showToast('error','Nothing to save','Try uploading the image again.'); return; }
  const canvas = cropperInstance.getCroppedCanvas({ width: 256, height: 256 });
  const dataUrl = canvas.toDataURL('image/png', 0.9);
  cropperInstance.destroy(); cropperInstance = null;
  closeAppModal();
  await loadAll();
  settings.appIcon = dataUrl;
  const ok = await persistSettings();
  applyAppIcon();
  ok ? showToast('success','Icon saved','Your new app icon is live for everyone.') : showToast('error','Save failed','Could not save — try again.');
}

async function removeAppIcon(){
  if(!(await confirmDialog('Remove the custom app icon and go back to the default "BA" mark?', {confirmLabel:'Remove'}))) return;
  await loadAll();
  delete settings.appIcon;
  const ok = await persistSettings();
  applyAppIcon();
  ok ? showToast('success','Icon removed','Back to the default.') : showToast('error','Save failed','Could not save — try again.');
}

// Applies custom app name/description everywhere it's safe to — post-login
// only. The sign-in screen itself can't be included: app_storage (where
// this setting lives) requires an authenticated session to read under RLS,
// and that's deliberate — opening it to unauthenticated reads would also
// expose the full client roster stored in the same table. Falls back to
// the original defaults when nothing custom has been set, so this changes
// nothing until an admin actually sets a value.
function hexToHsl(hex){
  hex = hex.replace('#','');
  const r = parseInt(hex.slice(0,2),16)/255, g = parseInt(hex.slice(2,4),16)/255, b = parseInt(hex.slice(4,6),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  let h, s, l = (max+min)/2;
  if(max===min){ h = s = 0; }
  else{
    const d = max-min;
    s = l > 0.5 ? d/(2-max-min) : d/(max+min);
    switch(max){
      case r: h = (g-b)/d + (g<b?6:0); break;
      case g: h = (b-r)/d + 2; break;
      default: h = (r-g)/d + 4;
    }
    h /= 6;
  }
  return { h: h*360, s: s*100, l: l*100 };
}

function hslToHex(h, s, l){
  h/=360; s/=100; l/=100;
  let r, g, b;
  if(s===0){ r=g=b=l; }
  else{
    const hue2rgb = (p,q,t)=>{
      if(t<0) t+=1; if(t>1) t-=1;
      if(t<1/6) return p+(q-p)*6*t;
      if(t<1/2) return q;
      if(t<2/3) return p+(q-p)*(2/3-t)*6;
      return p;
    };
    const q = l<0.5 ? l*(1+s) : l+s-l*s;
    const p = 2*l-q;
    r = hue2rgb(p,q,h+1/3); g = hue2rgb(p,q,h); b = hue2rgb(p,q,h-1/3);
  }
  const toHex = x=>Math.round(x*255).toString(16).padStart(2,'0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Derives every related shade from one base color, matching the exact
// lightness/saturation relationships the app's own hardcoded orange
// defaults already use — dark-mode hover states get lighter than the
// base (for contrast against a dark background), light-mode ones get
// darker, and both themes get a tinted, low-opacity background variant.
//
// Injects a real stylesheet block with the same theme-scoped selectors
// (:root / body[data-theme="dark"]) the original hardcoded CSS already
// uses, rather than setting inline styles directly — an inline style on
// body would apply unconditionally regardless of which theme is active,
// since inline styles don't respect the data-theme attribute at all.
// This way the cascade logic works exactly like the original CSS did.
function applyBrandColor(hex){
  const { h, s } = hexToHsl(hex);
  let styleEl = document.getElementById('customBrandColorStyle');
  if(!styleEl){
    styleEl = document.createElement('style');
    styleEl.id = 'customBrandColorStyle';
    document.head.appendChild(styleEl);
  }
  const lightBrand = hslToHex(h, s, 55);
  const lightDark = hslToHex(h, s, 42);
  const lightBg = hslToHex(h, Math.min(s,88), 94);
  const darkBrand = hslToHex(h, s, 54);
  const darkDark = hslToHex(h, Math.min(s+5,90), 64);
  const darkBg = hslToHex(h, Math.min(s,36), 13);
  const lightRgb = hexToRgbTriplet(lightBrand);
  const darkRgb = hexToRgbTriplet(darkBrand);
  // The sidebar's hover/selected fills stay neutral (only the selected
  // icon takes the brand colour), as in Apple's own sidebars.
  // Filled buttons carry white text, so the fill is darkened until white
  // reads at 4.5:1 or better; in dark mode, orange *text* is lightened
  // until it reads at 4.5:1 on the dark window. Whatever colour an admin
  // picks, buttons and links stay readable.
  let fillL = 55;
  while(fillL > 18 && brandContrast(hslToHex(h, s, fillL), '#FFFFFF') < 5) fillL--;
  const fill = hslToHex(h, s, fillL);
  let textL = 58;
  while(textL < 92 && brandContrast(hslToHex(h, s, textL), '#1E1E20') < 4.6) textL++;
  const darkText = hslToHex(h, s, textL);
  styleEl.textContent = `
    :root{--brand:${fill} !important;--brand-fill:${fill} !important;--brand-dark:${lightDark} !important;--brand-bg:${lightBg} !important;--ring:rgba(${lightRgb},.38) !important;}
    body[data-theme="dark"]{--brand:${darkText} !important;--brand-fill:${fill} !important;--brand-dark:${darkDark} !important;--brand-bg:${darkBg} !important;--ring:rgba(${darkRgb},.45) !important;}
  `;
}

function brandLuminance(hex){
  const ch = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4));
  return .2126 * ch[0] + .7152 * ch[1] + .0722 * ch[2];
}
function brandContrast(a, b){
  const la = brandLuminance(a), lb = brandLuminance(b);
  return (Math.max(la, lb) + .05) / (Math.min(la, lb) + .05);
}

function hexToRgbTriplet(hex){
  hex = hex.replace('#','');
  return `${parseInt(hex.slice(0,2),16)},${parseInt(hex.slice(2,4),16)},${parseInt(hex.slice(4,6),16)}`;
}

function resetBrandColor(){
  delete settings.brandColor;
  document.getElementById('customBrandColorStyle')?.remove();
  const input = document.getElementById('brandColorInput');
  const label = document.getElementById('brandColorHex');
  if(input) input.value = '#BF4716';
  if(label) label.textContent = '#BF4716';
}

function applyAppBranding(){
  const name = settings.appName || 'Based Agency';
  const description = settings.appDescription || 'Client Update Workflow';

  const nameEl = document.querySelector('.brand-name');
  const subEl = document.querySelector('.brand-sub');
  if(nameEl) nameEl.textContent = name;
  if(subEl) subEl.textContent = description.toUpperCase();
  updateDocumentTitle(currentViewName); // "<screen> — <app name>", or the app name + description on Overview

  const nameInput = document.getElementById('appNameInput');
  const descInput = document.getElementById('appDescriptionInput');
  if(nameInput) nameInput.value = settings.appName || '';
  if(descInput) descInput.value = settings.appDescription || '';

  const colorInput = document.getElementById('brandColorInput');
  const colorLabel = document.getElementById('brandColorHex');
  const brandColor = settings.brandColor || '#BF4716';
  if(colorInput) colorInput.value = brandColor;
  if(colorLabel) colorLabel.textContent = brandColor.toUpperCase();
  if(settings.brandColor) applyBrandColor(settings.brandColor);


}

// Default labels match each tab's original hardcoded text exactly — the
// Assistant tab ('claude') is deliberately excluded here since it already
// has its own dedicated "Assistant name" field in Settings -> AI & Email,
// which also controls what the Assistant calls itself in conversation;
// duplicating that as a second editable field here would just be
// confusing about which one actually takes effect.
const NAV_LABEL_DEFAULTS = {
  overview: 'Today', focusreports: 'Focus Reports', clients: 'All Clients', health: 'Health', approve: 'This Week', teamqueue: 'Review',
  notes: 'Notes', tasks: 'Tasks', reminders: 'Reminders', calendar: 'Calendar',
  time: 'Time', team: 'Team', trash: 'Recently Deleted', settings: 'Settings',
};

// Updates both the visible expanded-sidebar label AND the collapsed-
// sidebar tooltip (data-tooltip) together, so they can never drift out of
// sync with each other. Also applies the Assistant's own name setting to
// ITS nav item's visible label — previously only its tooltip got updated
// when that name changed, leaving the actual on-screen text stuck on
// "Assistant" regardless of what admins renamed it to.
function applyNavLabels(){
  const labels = settings.navLabels || {};
  Object.keys(NAV_LABEL_DEFAULTS).forEach(view=>{
    const navItem = document.querySelector(`.nav-item[data-view="${view}"]`);
    if(!navItem) return;
    const label = (labels[view] || NAV_LABEL_DEFAULTS[view]).trim() || NAV_LABEL_DEFAULTS[view];
    const labelSpan = navItem.querySelector('.nav-label');
    if(labelSpan) labelSpan.textContent = label;
    navItem.setAttribute('data-tooltip', label);
  });
  const claudeNavItem = document.getElementById('claudeNavItem');
  if(claudeNavItem){
    const assistantLabel = settings.assistantName || 'Assistant';
    const claudeLabelSpan = claudeNavItem.querySelector('.nav-label');
    if(claudeLabelSpan) claudeLabelSpan.textContent = assistantLabel;
  }
  renderNavLabelsSettings();
}

function renderNavLabelsSettings(){
  const grid = document.getElementById('navLabelsGrid');
  if(!grid) return;
  const labels = settings.navLabels || {};
  grid.innerHTML = Object.entries(NAV_LABEL_DEFAULTS).map(([view, defaultLabel])=>`
    <div><label>${defaultLabel}</label><input value="${escapeHtml(labels[view]||'')}" placeholder="${defaultLabel}" onchange="saveNavLabel('${view}', this.value)" ${isAdmin()?'':'disabled'}></div>
  `).join('');
}

async function saveNavLabel(view, value){
  if(!isAdmin()){ showToast('error','Not allowed','Only admins can change this.'); return; }
  settings.navLabels = settings.navLabels || {};
  const trimmed = value.trim();
  if(trimmed) settings.navLabels[view] = trimmed;
  else delete settings.navLabels[view];
  const ok = await persistSettings();
  if(ok) applyNavLabels();
  ok ? showToast('success','Saved', `Sidebar tab renamed to "${trimmed || NAV_LABEL_DEFAULTS[view]}".`) : showToast('error','Save failed','Could not save — try again.');
}

async function saveAppBranding(){
  if(!isAdmin()){ showToast('error','Not allowed','Only admins can change this.'); return; }
  const name = document.getElementById('appNameInput').value.trim();
  const description = document.getElementById('appDescriptionInput').value.trim();
  const color = document.getElementById('brandColorInput').value;
  if(name) settings.appName = name; else delete settings.appName;
  if(description) settings.appDescription = description; else delete settings.appDescription;
  settings.brandColor = color;
  applyBrandColor(color);
  const ok = await persistSettings();
  applyAppBranding();
  ok ? showToast('success','Saved','Updated everywhere except the sign-in screen, which stays fixed.') : showToast('error','Save failed','Could not save — try again.');
}

function applyAppIcon(){
  const preview = document.getElementById('iconPreview');
  const removeBtn = document.getElementById('removeIconBtn');
  if(settings.appIcon){
    const imgHtml = `<img src="${settings.appIcon}" alt="App icon" style="width:100%;height:100%;object-fit:cover;display:block;">`;
    if(preview) preview.innerHTML = imgHtml;
    if(removeBtn) removeBtn.style.display = 'inline-block';
    document.querySelectorAll('.brand-mark').forEach(el=>{ el.innerHTML = imgHtml; });
    let favicon = document.querySelector('link[rel="icon"]');
    if(!favicon){ favicon = document.createElement('link'); favicon.rel = 'icon'; document.head.appendChild(favicon); }
    favicon.href = settings.appIcon;
  } else {
    if(preview) preview.textContent = 'BA';
    if(removeBtn) removeBtn.style.display = 'none';
    document.querySelectorAll('.brand-mark').forEach(el=>{ el.textContent = 'BA'; });
  }
}

// Reads from myProfile directly — matches the exact same field
// sendNotification() checks against, so what's shown here and what's
// actually enforced can never drift apart.
function renderNotificationPrefs(){
  const el = document.getElementById('notifPrefsList');
  if(!el || !myProfile) return;
  const muted = myProfile.muted_notification_types || [];

  // Grouped by section (Tasks / Client Work / Calendar / Account) instead
  // of one long flat list of 17 toggles — section order follows first
  // appearance in NOTIFICATION_TYPE_META, rows keep their existing order
  // within each section. Types with a visibleTo restriction (see the
  // registry's comment) are skipped entirely for anyone who could never
  // actually receive them, rather than showing a toggle that does nothing.
  const sections = new Map();
  Object.entries(NOTIFICATION_TYPE_META).forEach(([type, meta])=>{
    if(meta.visibleTo === 'admin' && !isAdmin()) return;
    if(meta.visibleTo === 'approver' && !canApprove()) return;
    const section = meta.section || 'Other';
    if(!sections.has(section)) sections.set(section, []);
    sections.get(section).push([type, meta]);
  });

  el.innerHTML = [...sections.entries()].map(([section, rows])=>`
    <div class="panel" style="margin-bottom:24px;">
      <div class="panel-head"><span class="panel-title">${section}</span></div>
      <div class="panel-body">
      ${rows.map(([type, meta])=>{
        const isOn = !muted.includes(type);
        return `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 0;border-bottom:1px solid var(--border);">
          <span style="font-size:13px;color:var(--ink);">${escapeHtml(meta.label)}</span>
          <button class="theme-toggle-switch ${isOn?'on':''}" onclick="toggleNotificationMute('${type}', ${isOn})"></button>
        </div>`;
      }).join('')}
      </div>
    </div>`).join('');
}

async function toggleNotificationMute(type, muted){
  if(!myProfile) return;
  const current = myProfile.muted_notification_types || [];
  const updated = muted ? [...new Set([...current, type])] : current.filter(t=>t!==type);
  const { error } = await supabaseClient.from('team_profiles').update({ muted_notification_types: updated }).eq('id', currentUser.id);
  if(error){ showToast('error','Could not save', error.message); renderNotificationPrefs(); return; }
  myProfile.muted_notification_types = updated;
  renderNotificationPrefs();
  showToast('success', muted ? 'Notification muted' : 'Notification unmuted', NOTIFICATION_TYPE_META[type]?.label || '');
}

async function saveAiProvider(provider){
  if(!isAdmin()){ showToast('error','Not allowed','Only admins can change this.'); return; }
  settings.aiProvider = provider;
  const ok = await persistSettings();
  ok ? showToast('success','Saved', provider==='openai' ? 'Weekly insights now use ChatGPT.' : 'Weekly insights now use Claude.') : showToast('error','Save failed','Could not save — try again.');
}

function renderAiProviderChoice(){
  // The whole section is admin-only, not just individually disabled
  // inputs — a non-admin shouldn't see connection status, model strings,
  // or the proactive-insights controls at all.
  const adminOnly = document.getElementById('adminOnlyAiSettings');
  if(adminOnly) adminOnly.style.display = isAdmin() ? 'block' : 'none';
  const provider = settings.aiProvider === 'openai' ? 'openai' : 'claude';
  const claudeRadio = document.getElementById('aiProviderClaude');
  const openaiRadio = document.getElementById('aiProviderOpenai');
  if(claudeRadio){ claudeRadio.checked = provider==='claude'; claudeRadio.disabled = !isAdmin(); }
  if(openaiRadio){ openaiRadio.checked = provider==='openai'; openaiRadio.disabled = !isAdmin(); }
  document.getElementById('aiProviderCard-claude')?.classList.toggle('active', provider==='claude');
  document.getElementById('aiProviderCard-openai')?.classList.toggle('active', provider==='openai');
  // loadAiProviderConnectionStatus() was previously only wired to the
  // explicit tab-switch event (switchSettingsTab) — if "AI & Email"
  // happens to already be the active tab when this renders (e.g. it's
  // the default, or a realtime update just re-ran renderAll()), that
  // click event never fires, and the status stayed on its static
  // "Checking…" placeholder forever. Firing it here too, guarded so it
  // only actually calls out once per session (skipped once the real
  // status has come back), covers that gap without spamming the network
  // on every renderAll() pass.
  const claudeStatusEl = document.getElementById('aiConnectionStatus-claude');
  if(isAdmin() && claudeStatusEl && claudeStatusEl.textContent === 'Checking…'){
    loadAiProviderConnectionStatus();
  }
  const nameInput = document.getElementById('setAssistantName');
  if(nameInput && document.activeElement !== nameInput){ nameInput.value = settings.assistantName || ''; nameInput.disabled = !isAdmin(); }
  const instructionsInput = document.getElementById('setAssistantInstructions');
  if(instructionsInput && document.activeElement !== instructionsInput){ instructionsInput.value = settings.assistantCustomInstructions || ''; instructionsInput.disabled = !isAdmin(); }
  const claudeModelInput = document.getElementById('setClaudeModel');
  const openaiModelInput = document.getElementById('setOpenaiModel');
  // Placeholders set here, not in the markup — static HTML can't read
  // these JS constants (it used to show the literal "${...}" text).
  if(claudeModelInput) claudeModelInput.placeholder = DEFAULT_CLAUDE_MODEL;
  if(openaiModelInput) openaiModelInput.placeholder = DEFAULT_OPENAI_MODEL;
  if(claudeModelInput && document.activeElement !== claudeModelInput){ claudeModelInput.value = settings.claudeModel || ''; claudeModelInput.disabled = !isAdmin(); }
  if(openaiModelInput && document.activeElement !== openaiModelInput){ openaiModelInput.value = settings.openaiModel || ''; openaiModelInput.disabled = !isAdmin(); }
  // Client email signature fields — same focus-guard pattern as the
  // fields above, so this doesn't clobber whatever's mid-edit on a
  // realtime update or an unrelated renderAll() pass.
  const sig = settings.emailSignature || {};
  if(sig.logoUrl){
    const logoImg = document.getElementById('emailSignatureLogoImg');
    const logoPlaceholder = document.getElementById('emailSignatureLogoPlaceholder');
    if(logoImg && logoImg.src !== sig.logoUrl){ logoImg.src = sig.logoUrl; logoImg.style.display = 'block'; }
    if(logoPlaceholder) logoPlaceholder.style.display = 'none';
  }
  const sigFieldMap = { setSignatureCompanyName:'companyName', setSignatureTeamLine:'teamLine', setSignaturePhone:'phone', setSignatureEmail:'email', setSignatureWebsite:'website', setSignatureAddress:'address' };
  Object.keys(sigFieldMap).forEach(elId=>{
    const el = document.getElementById(elId);
    if(el && document.activeElement !== el){ el.value = sig[sigFieldMap[elId]] || ''; el.disabled = !isAdmin(); }
  });
  // Undefined means enabled — this feature predates the toggle, so an
  // existing deployment that's never touched this setting keeps working
  // exactly as before rather than silently going quiet.
  const proactiveToggle = document.getElementById('proactiveInsightsToggle');
  if(proactiveToggle){
    const enabled = settings.proactiveInsightsEnabled !== false;
    proactiveToggle.classList.toggle('on', enabled);
    proactiveToggle.disabled = !isAdmin();
  }
  const daySelect = document.getElementById('proactiveInsightsDaySelect');
  if(daySelect){
    // Undefined means Wednesday (3) — matches the cron's own fallback, so
    // an existing deployment that's never touched this shows the day it's
    // actually already running on, not a misleading blank/default.
    daySelect.value = String(settings.proactiveInsightsDayOfWeek ?? 3);
    daySelect.disabled = !isAdmin();
  }
}

async function saveProactiveInsightsDay(value){
  if(!isAdmin()){ showToast('error','Not allowed','Only admins can change this.'); return; }
  settings.proactiveInsightsDayOfWeek = parseInt(value);
  const ok = await persistSettings();
  const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][settings.proactiveInsightsDayOfWeek];
  ok ? showToast('success','Saved', `Weekly focus reports will now go out on ${dayName}s.`) : showToast('error','Save failed','Could not save — try again.');
}

async function toggleProactiveInsightsEnabled(){
  if(!isAdmin()){ showToast('error','Not allowed','Only admins can change this.'); return; }
  const currentlyEnabled = settings.proactiveInsightsEnabled !== false;
  settings.proactiveInsightsEnabled = !currentlyEnabled;
  const ok = await persistSettings();
  if(!ok){ settings.proactiveInsightsEnabled = currentlyEnabled; showToast('error','Save failed','Could not save — try again.'); return; }
  renderAiProviderChoice();
  showToast('success', settings.proactiveInsightsEnabled ? 'Enabled' : 'Disabled', settings.proactiveInsightsEnabled ? 'The weekly focus report is back on.' : 'The weekly focus report is paused until re-enabled.');
}

// Lets a redeployment-free response to a provider deprecating/renaming a
// model (this has already happened once for real — see lib/ai-client.js's
// header comment on OpenAI deprecating gpt-4o-mini-search-preview).
// Falls back to the hardcoded DEFAULT_*_MODEL constant if cleared, rather
// than storing an empty string that every downstream caller would need to
// separately guard against.
async function saveAiModel(which, value){
  if(!isAdmin()){ showToast('error','Not allowed','Only admins can change this.'); return; }
  const trimmed = value.trim();
  if(which === 'claude') settings.claudeModel = trimmed || DEFAULT_CLAUDE_MODEL;
  else settings.openaiModel = trimmed || DEFAULT_OPENAI_MODEL;
  const ok = await persistSettings();
  ok ? showToast('success','Saved', `${which==='claude'?'Claude':'OpenAI'} model updated.`) : showToast('error','Save failed','Could not save — try again.');
}

async function adminActionCall(action, body){
  const { data: { session } } = await supabaseClient.auth.getSession();
  const response = await fetch('/api/admin-user-actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
    body: JSON.stringify({ action, ...body }),
  });
  const data = await response.json();
  if(!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

// Never receives the actual key back — get-ai-connections only ever
// returns whether something's connected and when, by design (see
// schema-clients-migration-addendum-9.sql).
async function loadAiProviderConnectionStatus(){
  try{
    const data = await adminActionCall('get-ai-connections');
    ['claude','openai'].forEach(provider=>{
      const info = data[provider];
      const statusEl = document.getElementById('aiConnectionStatus-'+provider);
      const btnEl = document.getElementById('aiConnectionBtn-'+provider);
      if(statusEl){
        statusEl.classList.remove('connected','none');
        if(info.connected){
          statusEl.textContent = info.baseUrl ? `Connected · custom endpoint · ${new Date(info.connectedAt).toLocaleDateString()}` : `Connected · ${new Date(info.connectedAt).toLocaleDateString()}`;
          statusEl.title = info.baseUrl ? info.baseUrl : '';
          statusEl.classList.add('connected');
        } else if(info.envConfigured){
          statusEl.textContent = 'Via Vercel env var';
        } else {
          statusEl.textContent = 'Not connected';
          statusEl.classList.add('none');
        }
      }
      if(btnEl) btnEl.textContent = info.connected ? 'Reconnect' : 'Connect';
    });
  }catch(e){
    console.error('loadAiProviderConnectionStatus error', e);
  }
}

function openAiProviderConnectModal(provider){
  if(!isAdmin()){ showToast('error','Not allowed','Only admins can connect a provider.'); return; }
  const label = provider==='claude' ? 'Claude (Anthropic)' : 'ChatGPT (OpenAI)';
  const keyHint = provider==='claude' ? 'sk-ant-…' : 'sk-…';
  // Only the openai slot supports a custom endpoint — Claude's API shape
  // is Anthropic-specific, there's no equivalent "Claude-compatible"
  // convention other providers implement the way there is for OpenAI's
  // format (see lib/ai-client.js's callOpenAI for why).
  const baseUrlField = provider==='openai' ? `
      <div class="settings-field"><label>Base URL <span style="font-weight:400;color:var(--muted-lt);">(optional)</span></label><input type="text" id="aiProviderBaseUrlInput" placeholder="https://api.openai.com/v1" style="width:100%;" autocomplete="off"></div>
      <p style="font-size:11px;color:var(--muted-lt);margin:-4px 0 12px;line-height:1.5;">Leave blank for OpenAI itself. Set this to point at any other OpenAI-compatible endpoint instead — Azure OpenAI, Mistral, Groq, OpenRouter, a self-hosted model, etc. Note: web search (used for website checks) only works against OpenAI itself, not a custom endpoint.</p>` : '';
  openAppModal(`
    <div class="modal-head"><span class="panel-title">Connect ${escapeHtml(label)}</span><span class="toast-close" onclick="closeAppModal()">✕</span></div>
    <div class="modal-body">
      <p style="font-size:12.5px;color:var(--muted);margin:0 0 12px;line-height:1.6;">Paste an API key from your ${escapeHtml(label)} account. It's tested against the real provider before saving, and won't be shown again after this — not even to you.</p>
      <div class="settings-field"><label>API key</label><input type="password" id="aiProviderKeyInput" placeholder="${keyHint}" style="width:100%;" autocomplete="off"></div>
      ${baseUrlField}
      <p style="margin:10px 0 0;"><span class="row-link" onclick="closeAppModal();disconnectAiProvider('${provider}')">Disconnect instead</span></p>
    </div>
    <div class="modal-actions"><button class="btn btn-outline" onclick="closeAppModal()">Cancel</button><button class="btn btn-brand" onclick="submitAiProviderConnect('${provider}')">Connect</button></div>`, 460);
}

async function submitAiProviderConnect(provider){
  const input = document.getElementById('aiProviderKeyInput');
  const key = input ? input.value.trim() : '';
  if(!key){ showToast('error','Missing key','Paste an API key first.'); return; }
  const baseUrlInput = document.getElementById('aiProviderBaseUrlInput');
  const baseUrl = baseUrlInput ? baseUrlInput.value.trim() : '';
  const btn = clickedBtn();
  setBtnLoading(btn, 'Connecting…');
  try{
    await adminActionCall('connect-ai-provider', { provider, apiKey: key, baseUrl });
    closeAppModal();
    showToast('success','Connected', `${provider==='claude'?'Claude':'ChatGPT'} is now connected${baseUrl?' to your custom endpoint':''}.`);
    loadAiProviderConnectionStatus();
  }catch(e){
    restoreBtn(btn);
    showToast('error','Could not connect', e.message || 'The key was rejected.');
  }
}

async function disconnectAiProvider(provider){
  if(!isAdmin()){ showToast('error','Not allowed','Only admins can disconnect a provider.'); return; }
  const label = provider==='claude' ? 'Claude' : 'ChatGPT';
  if(!(await confirmDialog(`Disconnect ${label}? Weekly insights won't be able to use it until reconnected (or until a Vercel environment variable is set instead).`, {confirmLabel:'Disconnect', destructive:true}))) return;
  try{
    await adminActionCall('disconnect-ai-provider', { provider });
    showToast('success','Disconnected', `${label} disconnected.`);
    loadAiProviderConnectionStatus();
  }catch(e){
    showToast('error','Could not disconnect', e.message || 'Try again.');
  }
}

async function saveAssistantName(value){
  if(!isAdmin()){ showToast('error','Not allowed','Only admins can change this.'); return; }
  settings.assistantName = value.trim() || 'Assistant';
  const ok = await persistSettings();
  if(ok){ applyAssistantName(); applyNavLabels(); }
  ok ? showToast('success','Saved', `The Assistant is now called "${settings.assistantName}".`) : showToast('error','Save failed','Could not save — try again.');
}

async function saveAssistantInstructions(value){
  if(!isAdmin()){ showToast('error','Not allowed','Only admins can change this.'); return; }
  settings.assistantCustomInstructions = value.trim();
  const ok = await persistSettings();
  ok ? showToast('success','Saved','Custom instructions updated — they apply to the Assistant\'s next reply onward.') : showToast('error','Save failed','Could not save — try again.');
}

// The client email signature's logo needs a real, publicly-hosted URL —
// email clients don't reliably render embedded/data-URL images the way
// this app's own UI does. Reuses the same public 'avatars' Storage
// bucket (and getPublicUrl pattern) already used for profile photos,
// rather than a data URL that would silently fail to display for
// clients reading the email in most mail apps.
async function uploadEmailSignatureLogo(file){
  if(!file) return;
  if(!isAdmin()){ showToast('error','Not allowed','Only admins can change this.'); return; }
  if(!file.type.startsWith('image/')){ showToast('error','Not an image','Please choose an image file.'); return; }
  if(file.size > 2*1024*1024){ showToast('error','Too large','Logo needs to be under 2MB.'); return; }
  const ext = file.name.split('.').pop();
  // Path scoped under the uploader's own user id, matching uploadAvatar()'s
  // existing, working pattern for this same bucket — the 'avatars' bucket's
  // RLS policy most likely checks that the first path segment matches
  // auth.uid(), so a shared path like 'email-signature/logo.png' (no user
  // id at all) would fail that check even though the upload itself is
  // otherwise perfectly valid. This is a real, agency-wide setting despite
  // living under one admin's folder — any admin can still overwrite it,
  // since the setting itself (not the file owner) is what the app reads.
  const path = `${currentUser.id}/email-signature-logo.${ext}`;
  const { error: uploadErr } = await supabaseClient.storage.from('avatars').upload(path, file, { upsert:true });
  if(uploadErr){ showToast('error','Upload failed', uploadErr.message); return; }
  const { data: urlData } = supabaseClient.storage.from('avatars').getPublicUrl(path);
  // Cache-bust so a replaced logo shows immediately in this settings
  // panel instead of a stale cached version — doesn't affect emails
  // already sent, only future ones and this preview.
  if(!settings.emailSignature) settings.emailSignature = {};
  settings.emailSignature.logoUrl = `${urlData.publicUrl}?t=${Date.now()}`;
  const ok = await persistSettings();
  if(ok){
    const img = document.getElementById('emailSignatureLogoImg');
    const placeholder = document.getElementById('emailSignatureLogoPlaceholder');
    if(img){ img.src = settings.emailSignature.logoUrl; img.style.display = 'block'; }
    if(placeholder) placeholder.style.display = 'none';
    showToast('success','Logo saved','Will appear on client update emails going forward.');
  } else {
    showToast('error','Save failed','The image uploaded, but saving the setting failed — try again.');
  }
}

async function saveEmailSignatureField(key, value){
  if(!isAdmin()){ showToast('error','Not allowed','Only admins can change this.'); return; }
  if(!settings.emailSignature) settings.emailSignature = {};
  settings.emailSignature[key] = value.trim();
  const ok = await persistSettings();
  ok ? showToast('success','Saved','Signature updated.') : showToast('error','Save failed','Could not save — try again.');
}

// A personal, per-device preference (like the AI provider override and
// the floating button's own dragged position elsewhere in this file) —
// not an admin-wide setting. Everyone with Assistant access controls
// this for themselves; it's about whether THEY find the floating button
// useful or intrusive, not a team-wide policy. Defaults to shown.
function loadClaudeFloatButtonPref(){
  try { return localStorage.getItem('claude_float_button_enabled') !== 'false'; } catch(e) { return true; }
}
function saveClaudeFloatButtonPref(enabled){
  try { localStorage.setItem('claude_float_button_enabled', enabled ? 'true' : 'false'); } catch(e) {}
}
function syncClaudeFloatButtonToggle(){
  const toggle = document.getElementById('claudeFloatButtonToggle');
  if(toggle) toggle.classList.toggle('on', loadClaudeFloatButtonPref());
}
function toggleClaudeFloatButtonPref(){
  const newValue = !loadClaudeFloatButtonPref();
  saveClaudeFloatButtonPref(newValue);
  syncClaudeFloatButtonToggle();
  applyRoleVisibility();
  showToast('success', newValue ? 'Enabled' : 'Disabled', newValue ? 'The floating button will show for you.' : 'The floating button is now hidden — just for you, on this device.');
}

// Updates every place the Assistant's name shows in the live UI — the tab
// header, the floating panel header, and the sidebar nav tooltip. The
// system prompt itself (so the AI introduces itself with this name, not
// just the UI chrome) is handled server-side in claude-chat.js, which
// reads the same settings.assistantName value.
function applyAssistantName(){
  const name = settings.assistantName || 'Assistant';
  document.querySelectorAll('.claude-assistant-name-label').forEach(el => el.textContent = name);
  const navItem = document.getElementById('claudeNavItem');
  if(navItem) navItem.setAttribute('data-tooltip', name);
  const tabInput = document.getElementById('claudeTabInput');
  if(tabInput) tabInput.placeholder = `Ask about your clients, drafts or time…`;
  const floatInput = document.getElementById('claudeFloatInput');
  if(floatInput) floatInput.placeholder = `Ask ${name} anything…`;
}

async function saveEmailInstructions(){
  const text = document.getElementById('emailInstructions').value.trim();
  const btn = clickedBtn();
  setBtnLoading(btn, 'Saving…');
  const { error } = await supabaseClient.from('team_profiles').update({ email_instructions: text }).eq('id', currentUser.id);
  if(!error && myProfile) myProfile.email_instructions = text;
  document.getElementById('emailInstructions').value = text;
  updateEmailInstructionsStatus();
  restoreBtn(btn);
  !error ? showToast('success','Instructions saved','Your new drafts will follow this structure.') : showToast('error','Save failed','Could not save — try again.');
}
