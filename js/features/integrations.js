// Settings → Integrations: Harvest connection and mappings, Slack channels.

async function harvestApiCall(action, body){
  const { data: { session } } = await supabaseClient.auth.getSession();
  const url = action ? '/api/integrations' : '/api/integrations?provider=harvest';
  const response = await fetch(url, {
    method: action ? 'POST' : 'GET',
    headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: action ? JSON.stringify({ provider: 'harvest', action, ...body }) : undefined,
  });
  const data = await response.json();
  if(!response.ok) throw new Error(data.error || 'Something went wrong talking to Harvest.');
  return data;
}

let slackChannelsSearchQuery = '';
let slackChannelsPage = 1;
const SLACK_CHANNELS_PAGE_SIZE = 10;

async function loadSlackChannelsPanel(){
  const el = document.getElementById('slackChannelsPanelBody');
  if(!el) return;
  if(!slackChannelsLoaded) await loadSlackClientChannels();
  renderSlackChannelsList();
}

function filterSlackChannelsPanel(){
  slackChannelsSearchQuery = document.getElementById('slackChannelsSearchInput')?.value || '';
  slackChannelsPage = 1; // a new search on a later page could otherwise show nothing
  renderSlackChannelsList();
}

function setSlackChannelsPage(page){
  slackChannelsPage = page;
  renderSlackChannelsList();
}

function renderSlackChannelsList(){
  const el = document.getElementById('slackChannelsPanelBody');
  if(!el) return;
  const canEdit = isAdmin();
  const query = slackChannelsSearchQuery.trim().toLowerCase();
  const matching = activeClients()
    .filter(c => !query || c.name.toLowerCase().includes(query))
    .sort((a,b)=>a.name.localeCompare(b.name));
  const start = (slackChannelsPage - 1) * SLACK_CHANNELS_PAGE_SIZE;
  const pageClients = matching.slice(start, start + SLACK_CHANNELS_PAGE_SIZE);

  // Preserve whatever's currently in the search box and its cursor
  // position across re-renders — rebuilding innerHTML on every keystroke
  // would otherwise reset focus and make typing impossible.
  const searchInput = document.getElementById('slackChannelsSearchInput');
  const hadFocus = document.activeElement === searchInput;
  const cursorPos = hadFocus ? searchInput.selectionStart : null;

  el.innerHTML = `
    <p style="font-size:13px;color:var(--muted);margin:0 0 14px;line-height:1.6;">
      Map each client to the Slack channel bridged to their WhatsApp group. Paste the <b>channel ID</b> (found in that channel's own details in Slack, not its name) — the bot needs to already be invited to it.
      ${!canEdit ? '<br><br><b>Admins only can add or change mappings</b> — you can see what\'s already set up here.' : ''}
    </p>
    <input type="text" id="slackChannelsSearchInput" placeholder="Search clients…" value="${escapeHtml(slackChannelsSearchQuery)}" oninput="filterSlackChannelsPanel()" style="width:100%;font-size:13.5px;padding:8px 10px;border-radius:6px;border:1px solid var(--border);margin-bottom:12px;">
    ${pageClients.map(c=>{
      const mapping = slackClientChannels[c.id];
      return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);">
        <span style="flex:1;font-size:14px;font-weight:600;">${escapeHtml(c.name)}</span>
        <input type="text" id="slackChanInput-${c.id}" placeholder="C0123456789" value="${mapping ? escapeHtml(mapping.channelId) : ''}" ${canEdit ? '' : 'disabled'} style="flex:1;font-size:13.5px;padding:6px 8px;border-radius:6px;border:1px solid var(--border);font-family:var(--font-mono);${canEdit ? '' : 'background:var(--surface-2);color:var(--muted);'}">
        ${canEdit ? `<button class="btn btn-outline" style="flex:none;padding:6px 10px;min-height:auto;font-size:12.5px;" onclick="saveSlackChannelMapping('${c.id}')">Save</button>` : ''}
      </div>`;
    }).join('') || `<p style="font-size:13px;color:var(--muted-lt);">${query ? 'No clients match your search.' : 'No active clients yet.'}</p>`}
    ${paginationControlsHtml(slackChannelsPage, matching.length, SLACK_CHANNELS_PAGE_SIZE, 'setSlackChannelsPage')}
  `;

  if(hadFocus){
    const newInput = document.getElementById('slackChannelsSearchInput');
    newInput.focus();
    newInput.setSelectionRange(cursorPos, cursorPos);
  }
}

async function saveSlackChannelMapping(clientId){
  const input = document.getElementById(`slackChanInput-${clientId}`);
  const channelId = input.value.trim();
  if(!channelId){
    // Empty input clears the mapping rather than saving a blank channel ID.
    await supabaseClient.from('slack_client_channels').delete().eq('client_id', clientId);
    delete slackClientChannels[clientId];
    showToast('success','Mapping cleared');
    return;
  }
  const { data: { user } } = await supabaseClient.auth.getUser();
  const { error } = await supabaseClient.from('slack_client_channels').upsert({
    client_id: clientId, slack_channel_id: channelId, updated_at: new Date().toISOString(), updated_by: user.id,
  });
  if(error){ showToast('error','Save failed', error.message); return; }
  slackClientChannels[clientId] = { channelId, channelName: null };
  showToast('success','Slack channel mapped');
  renderQueue(); renderTeamQueue();
}

async function loadHarvestPanel(){
  const el = document.getElementById('harvestPanelBody');
  if(!el) return;
  el.innerHTML = 'Loading…';
  let status;
  try{ status = await harvestApiCall(null); }
  catch(e){ el.innerHTML = `<p style="color:var(--red);font-size:13.5px;">${escapeHtml(e.message)}</p>`; return; }
  const canEdit = isAdmin();

  if(!status.connected){
    el.innerHTML = canEdit ? `
      <p style="font-size:13px;color:var(--muted);margin:0 0 14px;line-height:1.6;">
        Connect your team's Harvest account so time logged here also lands in Harvest. Generate a Personal Access Token from Harvest ID's <b>Developers</b> section — you'll get the token and your Account ID together.
      </p>
      <div class="settings-field"><label>Personal Access Token</label><input id="harvestPatInput" type="password" placeholder="Paste your Harvest PAT"></div>
      <div class="settings-field"><label>Account ID</label><input id="harvestAccountIdInput" placeholder="e.g. 1234567"></div>
      <button class="btn btn-brand" onclick="connectHarvest()" id="harvestConnectBtn">Connect Harvest</button>
      <p id="harvestConnectError" style="font-size:12.5px;color:var(--red);margin-top:8px;"></p>
    ` : `<p style="font-size:13px;color:var(--muted-lt);">Harvest isn't connected yet — an admin needs to set this up.</p>`;
    return;
  }

  el.innerHTML = `
    <div class="integ-row">
      <div><div class="integ-name">Harvest account</div><div class="integ-desc">Account ID ${escapeHtml(status.accountId)} · connected ${new Date(status.connectedAt).toLocaleDateString()}</div></div>
      <span class="integ-status on">Connected</span>
    </div>
    <p style="font-size:12.5px;color:var(--muted-lt);margin:8px 0 14px;">
      ${status.lastSyncedAt ? `Last catch-up sync: ${new Date(status.lastSyncedAt).toLocaleString()}` : 'No catch-up sync has run yet — new entries still sync individually as they\'re logged.'}
    </p>
    ${canEdit ? `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;">
      <button class="btn btn-outline" onclick="syncHarvestNow()" id="harvestSyncNowBtn">Sync Now</button>
      <button class="btn btn-outline" style="color:var(--red);" onclick="disconnectHarvest()">Disconnect</button>
    </div>
    <p id="harvestSyncNowStatus" style="font-size:12.5px;color:var(--muted-lt);margin-bottom:16px;"></p>
    ` : ''}

    <div style="padding-top:16px;border-top:1px solid var(--border);">
      <p style="font-size:13px;color:var(--muted);margin:0 0 12px;line-height:1.6;">
        Map each client to its Harvest project, and each service to a Harvest task. Entries for anything unmapped stay queued — connecting the mapping catches them up automatically, no need to re-log anything.
        ${!canEdit ? '<br><br><b>Admins only can add or change mappings</b> — you can see what\'s already set up here.' : ''}
      </p>
      <div id="harvestMappingBody">Loading projects and tasks from Harvest…</div>
    </div>
  `;
  loadHarvestMappingUI();
}

async function connectHarvest(){
  const pat = document.getElementById('harvestPatInput').value.trim();
  const accountId = document.getElementById('harvestAccountIdInput').value.trim();
  const errEl = document.getElementById('harvestConnectError');
  const btn = document.getElementById('harvestConnectBtn');
  if(!pat || !accountId){ errEl.textContent = 'Both fields are required.'; return; }
  btn.disabled = true; btn.textContent = 'Connecting…';
  try{
    await harvestApiCall('connect', { pat, accountId });
    loadHarvestPanel();
  }catch(e){
    errEl.textContent = e.message;
    btn.disabled = false; btn.textContent = 'Connect Harvest';
  }
}

async function disconnectHarvest(){
  if(!(await confirmDialog('Disconnect Harvest? Time logged here will stop syncing until reconnected. Your client/service mappings are kept.', {confirmLabel:'Disconnect'}))) return;
  try{ await harvestApiCall('disconnect'); loadHarvestPanel(); }
  catch(e){ showToast('error','Harvest error',e.message); }
}

async function syncHarvestNow(){
  const btn = document.getElementById('harvestSyncNowBtn');
  const statusEl = document.getElementById('harvestSyncNowStatus');
  btn.disabled = true; btn.textContent = 'Syncing…';
  try{
    const result = await harvestApiCall('sync-now');
    statusEl.textContent = `Synced ${result.synced}, failed ${result.failed}, unmapped ${result.unmapped} (of ${result.attempted} pending).`;
    loadHarvestPanel();
  }catch(e){
    statusEl.textContent = e.message;
  }finally{
    btn.disabled = false; btn.textContent = 'Sync Now';
  }
}

async function loadHarvestMappingUI(){
  const el = document.getElementById('harvestMappingBody');
  let data;
  try{ data = await harvestApiCall('get-projects'); }
  catch(e){ el.innerHTML = `<p style="color:var(--red);font-size:13.5px;">${escapeHtml(e.message)}</p>`; return; }

  const { data: clientMappingRows } = await supabaseClient.from('harvest_client_mappings').select('client_id, harvest_project_id');
  const { data: serviceMappingRows } = await supabaseClient.from('harvest_service_mappings').select('service, harvest_task_id');
  const clientMap = Object.fromEntries((clientMappingRows||[]).map(r=>[r.client_id, r.harvest_project_id]));
  const serviceMap = Object.fromEntries((serviceMappingRows||[]).map(r=>[r.service, r.harvest_task_id]));

  if(!timeEntriesDataLoaded) await loadTimeEntries();
  const activeClients = clients.filter(c=>!c.deletedAt).sort((a,b)=>a.name.localeCompare(b.name));
  const usedServices = [...new Set(timeEntries.map(e=>e.service).filter(Boolean))].sort();

  const projectOptions = (selectedId)=> `<option value="">— Not mapped —</option>` + data.projects.map(p=>
    `<option value="${p.id}" ${String(p.id)===String(selectedId)?'selected':''}>${escapeHtml(p.name)}${p.clientName?` (${escapeHtml(p.clientName)})`:''}</option>`
  ).join('');
  const taskOptions = (selectedId)=> `<option value="">— Not mapped —</option>` + data.tasks.map(t=>
    `<option value="${t.id}" ${String(t.id)===String(selectedId)?'selected':''}>${escapeHtml(t.name)}</option>`
  ).join('');

  const canEdit = isAdmin();

  el.innerHTML = `
    <div style="font-size:12.5px;font-weight:700;color:var(--muted-lt);text-transform:uppercase;letter-spacing:.03em;margin-bottom:8px;">Clients → Harvest Projects</div>
    ${activeClients.map(c=>`
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);">
        <span style="flex:1;font-size:14px;font-weight:600;">${escapeHtml(c.name)}</span>
        <select ${canEdit ? '' : 'disabled'} style="flex:1;font-size:13.5px;padding:6px 8px;border-radius:6px;border:1px solid var(--border);${canEdit ? '' : 'background:var(--surface-2);color:var(--muted);'}" onchange="saveHarvestClientMapping('${c.id}', this.value, this.options[this.selectedIndex].text)">
          ${projectOptions(clientMap[c.id])}
        </select>
      </div>`).join('') || '<p style="font-size:13px;color:var(--muted-lt);">No active clients yet.</p>'}

    <div style="font-size:12.5px;font-weight:700;color:var(--muted-lt);text-transform:uppercase;letter-spacing:.03em;margin:18px 0 8px;">Services → Harvest Tasks</div>
    ${usedServices.map(svc=>`
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);">
        <span style="flex:1;font-size:14px;font-weight:600;">${escapeHtml(svc)}</span>
        <select ${canEdit ? '' : 'disabled'} style="flex:1;font-size:13.5px;padding:6px 8px;border-radius:6px;border:1px solid var(--border);${canEdit ? '' : 'background:var(--surface-2);color:var(--muted);'}" onchange="saveHarvestServiceMapping(${jsArg(svc)}, this.value, this.options[this.selectedIndex].text)">
          ${taskOptions(serviceMap[svc])}
        </select>
      </div>`).join('') || '<p style="font-size:13px;color:var(--muted-lt);">No time entries with a service set yet — services appear here once someone logs time with one.</p>'}
  `;
}

async function saveHarvestClientMapping(clientId, harvestProjectId, harvestProjectName){
  if(!harvestProjectId) return; // "— Not mapped —" selected; nothing to save
  try{ await harvestApiCall('save-client-mapping', { clientId, harvestProjectId, harvestProjectName }); }
  catch(e){ showToast('error','Harvest error',e.message); }
}

async function saveHarvestServiceMapping(service, harvestTaskId, harvestTaskName){
  if(!harvestTaskId) return;
  try{ await harvestApiCall('save-service-mapping', { service, harvestTaskId, harvestTaskName }); }
  catch(e){ showToast('error','Harvest error',e.message); }
}
