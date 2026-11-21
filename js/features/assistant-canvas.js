// Assistant, as on the canvas: chats on the left (Pinned, Projects, Recent), the conversation on
// the right with the message box docked at the bottom. The chat engine is assistant.js; this
// file only draws the list, the messages and the suggestions.

function claudeWhen(iso){
  if(!iso) return '';
  const d = new Date(iso), n = daysBetween(d, rNow());
  if(n <= 0) return 'Today';
  if(n === 1) return 'Yesterday';
  if(n < 7) return d.toLocaleDateString('en-US', { weekday: 'long' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function renderClaudeSidebarProjects(){ renderClaudeConversationsSidebar(); }

function renderClaudeConversationsSidebar(){
  const el = document.getElementById('claudeSidebarList');
  if(!el) return;
  if(typeof renderClaudeBulkBar === 'function') renderClaudeBulkBar();
  document.querySelectorAll('body > .claude-sidebar-menu').forEach(m => m.remove());
  const projName = id => (claudeProjectsList.find(p => p.id === id) || {}).name || '';
  const item = c => {
    const on = c.id === claudeConversationId && !claudeBulkMode;
    const sub = [claudeWhen(c.updated_at), projName(c.project_id)].filter(Boolean).map(escapeHtml).join(' · ');
    const check = claudeBulkMode ? `<span class="ck${claudeBulkSelected.has(c.id) ? ' on' : ''}" aria-hidden="true">${claudeBulkSelected.has(c.id) ? icon('check', { weight: 'bold' }) : ''}</span>` : '';
    const click = claudeBulkMode ? `toggleClaudeBulkSelect('${c.id}')` : `openClaudeConversation('${c.id}')`;
    const menu = claudeBulkMode ? '' : `<button type="button" class="ib chat-more" id="claudeSidebarMenuBtn-${c.id}" aria-label="More" title="More" onclick="event.preventDefault();toggleClaudeSidebarMenu(event,'${c.id}')">${icon('dots-three')}</button>
<div class="claude-sidebar-menu menu" id="claudeSidebarMenu-${c.id}" style="display:none;">
<button type="button" class="mi" onclick="renameClaudeConversation('${c.id}')">${icon('pencil-simple')}Rename</button>
<button type="button" class="mi" onclick="togglePinClaudeConversation('${c.id}', ${!c.pinned})">${icon('pin')}${c.pinned ? 'Unpin' : 'Pin'}</button>
${claudeProjectsList.length ? `<div style="position:relative"><button type="button" class="mi" onclick="toggleClaudeSidebarProjectSubmenu(event,'${c.id}')">${icon('folder-simple')}${c.project_id ? 'Change Project' : 'Add to Project'}<span style="margin-left:auto">›</span></button><div class="claude-provider-menu" id="claudeSidebarProjectSubmenu-${c.id}" style="display:none;left:calc(100% + 6px);top:-6px;bottom:auto;width:180px;"></div></div>` : ''}
${c.project_id ? `<button type="button" class="mi" onclick="removeClaudeConversationFromProjectMenu('${c.id}')">${icon('folder-simple')}Remove from Project</button>` : ''}
<div class="msep"></div><button type="button" class="mi danger" onclick="deleteClaudeConversationFromMenu('${c.id}')">${icon('trash')}Delete…</button></div>`;
    return `<div class="chat-row${on ? ' on' : ''}"><a class="chat-i${on ? ' sel' : ''}" href="#claude" onclick="${click};return false;"${on ? ' aria-current="true"' : ''}>${check}<span class="chat-t">${escapeHtml(c.title || 'New chat')}</span><span>${sub}</span></a>${menu}</div>`;
  };
  const pinned = claudeConversationsList.filter(c => c.pinned), rest = claudeConversationsList.filter(c => !c.pinned);
  const projects = claudeProjectsList.map(p => {
    const n = claudeConversationsList.filter(c => c.project_id === p.id).length, on = p.id === claudeCurrentProjectId;
    return `<a class="chat-i${on ? ' sel' : ''}" href="#claude" onclick="openClaudeProjectDetail('${p.id}');return false;"><span class="chat-t" style="display:flex;align-items:center;gap:6px"><span class="ic sm">${icon('folder-simple')}</span>${escapeHtml(p.name)}</span><span>${n} chat${n === 1 ? '' : 's'}</span></a>`;
  }).join('');
  el.innerHTML = (pinned.length ? `<div class="lst-h">Pinned</div>${pinned.map(item).join('')}` : '')
    + `<div class="lst-h" style="display:flex;align-items:center">Projects<button class="ib" style="margin-left:auto;width:20px;height:20px" aria-label="All projects" title="All projects" onclick="openClaudeProjectsView()">${icon('caret-right', { weight: 'bold' })}</button></div>${projects || '<p class="t-2" style="font-size:13px;margin:2px 18px 4px">No projects yet.</p>'}`
    + `<div class="lst-h">Recent</div>${rest.map(item).join('') || '<p class="t-2" style="font-size:13px;margin:2px 18px">No chats yet. Ask anything below.</p>'}`;
}

// Messages: your messages as bubbles on the right, the Assistant's as text under its name.
function renderClaudeMessages(animateLatest){
  const who = `<div class="who"><span class="ic">${icon('sparkle')}</span>Assistant</div>`;
  const html = `<div class="chat-col">${claudeConversation.map((m, i) => m.role === 'user'
      ? `<div class="bub-me claude-msg claude-msg-user" data-msg-idx="${i}">${renderClaudeMessageContent(m.role, m.content)}</div>`
      : `<div class="bub-ai claude-msg claude-msg-assistant" data-msg-idx="${i}">${who}${renderClaudeMessageContent(m.role, m.content)}</div>`).join('')
    + (claudeSending ? `<div class="bub-ai">${who}<div class="claude-msg-typing" aria-label="Thinking"><span></span><span></span><span></span></div></div>` : '')}</div>`;
  const lastIdx = claudeConversation.length - 1;
  const shouldAnimate = animateLatest && lastIdx >= 0 && claudeConversation[lastIdx].role === 'assistant';
  ['claudeTabMessages', 'claudeFloatMessages'].forEach(id => {
    const el = document.getElementById(id);
    if(!el) return;
    el.innerHTML = html;
    el.scrollTop = el.scrollHeight;
    if(shouldAnimate){ const last = el.querySelector(`.claude-msg[data-msg-idx="${lastIdx}"]`); if(last) revealClaudeMessage(last); }
  });
  layoutClaudeSurface('claudeTab');
  layoutClaudeSurface('claudeFloat');
  // a few follow-up questions above the box once a chat is under way, as on the canvas
  const ds = document.getElementById('claudeDockSugg');
  if(ds){
    if(claudeConversation.length && !claudeSending){
      if(!claudeQuickActionsPicked.length) pickClaudeQuickActions();
      const asked = new Set(claudeConversation.filter(m => m.role === 'user').map(m => m.content.trim()));
      ds.innerHTML = claudeQuickActionsPicked.filter(q => !asked.has(q.text)).slice(0, 3).map(qa => `<button class="btn sm" data-prompt="${escapeHtml(qa.text)}" onclick="sendClaudeQuickAction(this)">${escapeHtml(qa.text)}</button>`).join('');
    } else ds.innerHTML = '';
  }
  const g = document.getElementById('claudeTabGreeting');
  if(g && !claudeConversation.length){ const f = firstName(myProfile?.name || ''); g.textContent = f ? `What can I help with, ${f}?` : 'What can I help with?'; }
}

function renderClaudeQuickActions(){
  const el = document.getElementById('claudeQuickActionsList');
  if(!el) return;
  el.innerHTML = claudeQuickActionsPicked.map(qa => `<button class="btn sm" data-prompt="${escapeHtml(qa.text)}" onclick="sendClaudeQuickAction(this)">${escapeHtml(qa.text)}</button>`).join('');
}
