// Radar in ChatGPT and Claude (Nov 23), Settings → Connections → Yours.
// Each person connects their own ChatGPT or Claude to Radar's MCP server (/mcp, lib/mcp-server.js).
// They sign in to Radar on the way (oauth-consent.html), and the AI then works as them, with what
// they can see and do here. This sheet gives the address and the steps for each app, lists the apps
// connected to your account, and disconnects one. Supabase's OAuth server must be switched on once
// (Authentication → OAuth Server); until it is, admins see how and others see that it's coming.

let aiAppsState = { ready: null, grants: null };   // ready: the OAuth server answers; grants: connected apps
const mcpAddress = () => `${location.origin}/mcp`;

async function loadAiApps(){
  // the OAuth server is on when listing your connected apps works (or, failing that, when Supabase
  // publishes its sign-in details)
  let grants = [], ok = false;
  if(supabaseClient.auth.oauth && supabaseClient.auth.oauth.listGrants){
    try{ const r = await supabaseClient.auth.oauth.listGrants(); if(!r.error){ ok = true; grants = Array.isArray(r.data) ? r.data : (r.data && r.data.grants) || []; } }catch(e){}
  }
  const base = String(supabaseClient.supabaseUrl || '').replace(/\/+$/, '');
  const ready = ok || await fetch(`${base}/.well-known/oauth-authorization-server/auth/v1`).then(r => r.ok).catch(() => false);
  aiAppsState = { ready, grants };
  const box = document.getElementById('aiAppsBox'); if(box) box.innerHTML = aiAppsInner();
  return aiAppsState;
}
function aiAppsRowStatus(st){
  const s = aiAppsState;
  if(s.ready == null) return st('', 'Checking…');
  if(!s.ready) return st('hollow', 'Not set up yet');
  const n = (s.grants || []).length;
  return n ? st('green', `${n} connected`) : st('hollow', 'Not connected');
}
function aiGrantName(g){ const c = g.client || {}; return c.client_name || c.name || g.client_name || 'An app'; }
// the connected app's own logo when its name says which it is
function aiGrantLogo(name){ return /claude|anthropic/i.test(name) ? appLogo('claude') : /chatgpt|openai/i.test(name) ? appLogo('chatgpt') : appGlyph('plugs-connected'); }
function aiGrantId(g){ const c = g.client || {}; return c.client_id || c.id || g.client_id || ''; }
function aiAppsInner(){
  const s = aiAppsState;
  const intro = `<p class="t-2 ai-about">Ask ChatGPT or Claude about your clients, tasks, follow-ups and hours, and have it add or finish tasks, plan sprints in your Plan, add follow-ups and log time, as you, with what you can see and do in Radar.</p>`;
  if(s.ready == null) return intro + `<p class="t-2 gr-st">Checking…</p>`;
  if(!s.ready) return intro + (isAdmin()
    ? `<div class="ai-setup"><b>${icon('warning')}One-time setup in Supabase</b><ol>
<li>Open the project in Supabase: <b>Authentication → OAuth Server</b>, and turn the OAuth server on.</li>
<li>Turn on <b>dynamic client registration</b> (“Allow Dynamic OAuth Apps”), so ChatGPT and Claude can register themselves.</li>
<li>Set the <b>Authorization Path</b> to <code>/oauth/consent</code>, and check that <b>Authentication → URL Configuration → Site URL</b> is <code>${escapeHtml(location.origin)}</code>.</li>
</ol><button class="btn sm" onclick="loadAiApps()">Check Again</button></div>`
    : `<p class="gr-warn">${icon('warning')}An admin needs to switch this on in Supabase first.</p>`);
  const url = mcpAddress();
  const grants = (s.grants || []).map(g => `<div class="fr">${aiGrantLogo(aiGrantName(g))}<div class="l"><b>${escapeHtml(aiGrantName(g))}</b><span>${g.granted_at || g.created_at ? 'Connected ' + escapeHtml(fmtShortDate(new Date(g.granted_at || g.created_at))) : 'Connected'}</span></div><button class="btn sm" onclick="aiAppDisconnect(${jsArg(aiGrantId(g))}, ${jsArg(aiGrantName(g))})">Disconnect…</button></div>`).join('');
  return intro + `<div class="sl-url ai-url"><code>${escapeHtml(url)}</code><button type="button" class="btn sm" onclick="copyToClipboard(${jsArg(url)}).then(()=>{this.textContent='Copied';setTimeout(()=>{this.textContent='Copy'},1600)})">Copy</button></div>
<div class="ai-steps"><div><b>${appLogo('claude', 'xs')}Claude</b><ol><li>In Claude, open <b>Settings → Connectors</b> and choose <b>Add custom connector</b>.</li><li>Name it Radar, paste the address above, and add it.</li><li>Click <b>Connect</b>, sign in to Radar, and allow it.</li></ol></div>
<div><b>${appLogo('chatgpt', 'xs')}ChatGPT</b><ol><li>In ChatGPT on the web, open <b>Plugins</b> and choose <b>+ → Add custom MCP server</b>. In a company workspace an admin may need to allow it first.</li><li>Paste the address above and choose <b>OAuth</b>.</li><li>Sign in to Radar and allow it. Your ChatGPT plan decides whether it can also make changes or only read.</li></ol></div></div>
<div class="sl-h">Connected to your account</div>${grants ? `<div class="form-grp">${grants}</div>` : `<p class="t-2 gr-st">Nothing yet. Once you connect ChatGPT or Claude it shows here, and you can disconnect it any time.</p>`}`;
}
function openAiAppsSheet(){
  openAppModal(`<h3 class="ap-h">${appLogoPair('chatgpt', 'claude', 'sm')}ChatGPT and Claude</h3><div id="aiAppsBox">${aiAppsInner()}</div><div class="sheet-a"><button class="btn btn-p" onclick="closeAppModal();loadIntegrationStatuses()">Done</button></div>`, 600);
  loadAiApps();
}
async function aiAppDisconnect(clientId, name){
  if(!(await confirmDialog(`Disconnect ${name}? It won’t be able to use Radar until you connect it again.`, { confirmLabel: 'Disconnect', destructive: true }))) return;
  const r = await supabaseClient.auth.oauth.revokeGrant({ clientId });
  if(r && r.error){ showToast('error', 'Not disconnected', r.error.message || ''); return; }
  showToast('success', `${name} disconnected`, '');
  loadAiApps();
}
