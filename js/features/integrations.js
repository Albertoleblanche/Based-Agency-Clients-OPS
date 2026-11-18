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
  const matching = liveClients()
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

async function disconnectHarvest(){
  if(!(await confirmDialog('Disconnect Harvest? Time logged here stops going to Harvest, and Radar stops reading it, until it’s connected again.', {confirmLabel:'Disconnect'}))) return;
  try{ await harvestApiCall('disconnect'); }
  catch(e){ showToast('error','Harvest error',e.message); }
}
