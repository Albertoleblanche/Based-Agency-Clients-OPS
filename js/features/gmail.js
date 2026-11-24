// Tasks from Gmail (Nov 24, lib/gmail-tasks.js): your work Gmail, read only. Radar reads new emails from
// your clients a few times a day (and when you open Tasks), and what they ask you to do is suggested in
// Tasks beside the Granola ones: Add, Edit… or Dismiss, with the email a click away.
let gmailState = null;   // { configured, connected, email, lastReadAt, lastError, stats, needsSetup } once asked
let gmailReadAt = 0;     // when this tab last asked for a read

async function gmailStatusLoad(){
  try{ const res = await fetch('/api/integrations?provider=gmail', { headers: await apiAuthHeaders() }); gmailState = res.ok ? await res.json() : { configured: false, connected: false }; }
  catch(e){ gmailState = { configured: false, connected: false }; }
  return gmailState;
}
async function gmailCall(body){
  try{ const res = await fetch('/api/integrations', { method: 'POST', headers: await apiAuthHeaders(), body: JSON.stringify(Object.assign({ provider: 'gmail' }, body)) }); return await res.json().catch(() => ({})); }
  catch(e){ return { error: 'Couldn’t reach Radar. Try again.' }; }
}
async function gmailConnect(){
  const j = await gmailCall({ action: 'start' });
  if(j.url){ try{ sessionStorage.setItem('gmail-back', location.hash || '#settings'); }catch(e){} location.href = j.url; return; }
  showToast('info', j.notConfigured ? 'Google sign-in isn’t set up yet' : 'Couldn’t start', j.notConfigured ? 'An admin sets up Google once (Google Calendar uses it too).' : (j.error || 'Try again.'));
}
async function gmailDisconnect(){
  if(!(await confirmDialog('Disconnect Gmail? Radar stops reading your clients’ emails, and Google’s access is taken back. Suggestions already in Tasks stay.', { confirmLabel: 'Disconnect' }))) return;
  await gmailCall({ action: 'disconnect' });
  gmailState = Object.assign({}, gmailState, { connected: false, email: null });
  showToast('success', 'Gmail disconnected', 'Connect it again anytime.');
  if(typeof loadIntegrationStatuses === 'function' && currentViewName === 'settings') loadIntegrationStatuses();
}
// Reads now (Settings → Check Now, and Check Gmail in Tasks), and says what it found
async function gmailReadNow(){
  const r = await gmailCall({ action: 'read', force: true });
  gmailReadAt = Date.now();
  if(r.suggested && typeof loadTaskSuggestions === 'function') await loadTaskSuggestions();
  await gmailStatusLoad();
  return r;
}
function gmailReadToast(r){
  if(r.error) showToast('error', 'Gmail wasn’t read', r.error);
  else if(r.skipped === 'recent') showToast('info', 'Just checked', 'Radar read your Gmail less than a minute ago.');
  else if(r.skipped) showToast('info', 'Not read', r.skipped === 'no AI key' ? 'The AI isn’t set up on the server.' : r.skipped);
  else showToast('success', r.suggested ? `${r.suggested} task${r.suggested === 1 ? '' : 's'} suggested` : 'Nothing new to do', `${r.fromClients || 0} new email${r.fromClients === 1 ? '' : 's'} from clients${r.waiting ? `, ${r.waiting} more at the next check` : ''}.`);
}
async function gmailCheckNow(){
  const btn = typeof clickedBtn === 'function' ? clickedBtn() : null; if(btn) setBtnLoading(btn, 'Checking…');
  const r = await gmailReadNow();
  if(btn) restoreBtn(btn);
  gmailReadToast(r);
  if(r.suggested && currentViewName === 'tasks' && typeof renderTasks === 'function') renderTasks();
  if(currentViewName === 'settings' && typeof loadIntegrationStatuses === 'function') loadIntegrationStatuses();
}
// Check Gmail, in Tasks next to Check Granola (Nov 24): shown once your Gmail is connected.
let tkGmailBusy = false, gmailAsked = false;
function gmailOnHere(){
  if(gmailState === null && !gmailAsked){
    gmailAsked = true;
    gmailStatusLoad().then(() => {
      if(!gmailState || !gmailState.connected) return;
      if(typeof currentViewName !== 'undefined' && currentViewName === 'tasks' && typeof renderTasks === 'function') renderTasks();
      if(typeof mTab !== 'undefined' && mTab === 'tasks' && typeof mRenderTab === 'function') mRenderTab();
    });
  }
  return !!(gmailState && gmailState.connected);
}
function tkGmailBtn(){
  if(!gmailOnHere()) return '';
  return `<button class="btn tk-gr" id="tkGmail" onclick="tkGmailCheck()"${tkGmailBusy ? ' disabled' : ''} title="Look for new requests in your clients’ emails">${tkGmailBusy ? '<span class="tk-gr-spin" aria-hidden="true"></span>Checking…' : `${appLogo('gmail', 'xs')}Check Gmail`}</button>`;
}
async function tkGmailCheck(){
  if(tkGmailBusy) return;
  tkGmailBusy = true; renderTasks();
  let r; try{ r = await gmailReadNow(); } finally { tkGmailBusy = false; }
  gmailReadToast(r);
  renderTasks();
}
// Opening Tasks: if you're connected, new client emails are read (the server skips it if it read in
// the last 10 minutes), and anything it suggests shows up in the list.
async function gmailMaybeRead(){
  if(Date.now() - gmailReadAt < 10 * 60000) return;
  gmailReadAt = Date.now();
  if(!gmailState) await gmailStatusLoad();
  if(!gmailState || !gmailState.connected) return;
  const r = await gmailCall({ action: 'read' });
  if(r && r.suggested && typeof loadTaskSuggestions === 'function'){
    await loadTaskSuggestions();
    if(currentViewName === 'tasks' && typeof renderTasks === 'function') renderTasks();
  }
}
// Settings → Connections → Yours
function gmailRowHtml(st){
  const g = gmailState;
  const head = sub => `<div class="fr cn-r">${appLogo('gmail')}<div class="l"><b>Gmail</b><span>${sub}</span></div>`;
  if(!g) return `${head('Tasks from your clients’ emails, suggested in Tasks')}${st('', 'Checking…')}</div>`;
  if(g.needsSetup) return `${head('Tasks from your clients’ emails, suggested in Tasks')}${st('hollow', isAdmin() ? 'Run addendum-gmail.sql' : 'Not set up')}</div>`;
  if(!g.configured) return `${head('Tasks from your clients’ emails, suggested in Tasks')}${st('hollow', 'Not set up')}</div>`;
  if(!g.connected) return `${head('Tasks from your clients’ emails, suggested in Tasks. Read only.')}<button class="btn" onclick="gmailConnect()">Connect…</button></div>`;
  const read = g.lastReadAt && typeof claudeWhen === 'function' ? ' · read ' + claudeWhen(g.lastReadAt).toLowerCase() : '';
  return `${head(g.lastError ? escapeHtml(g.lastError) : `${escapeHtml(g.email || 'Connected')}: tasks from clients’ emails${read}`)}${g.lastError ? st('yellow', 'Needs attention') : st('green', 'Connected')}<button class="btn" onclick="gmailCheckNow()">Check Now</button><button class="btn" onclick="gmailDisconnect()">Disconnect</button></div>`;
}
// Google sends you back to #settings?gmail=connected|denied|wrong-account|scope|setup|error
function gmailReturn(hash, session){
  if(!String(hash || '').includes('gmail=')) return false;
  const outcome = new URLSearchParams(String(hash).split('?')[1] || '').get('gmail');
  let back = '#settings'; try{ back = sessionStorage.getItem('gmail-back') || '#settings'; sessionStorage.removeItem('gmail-back'); }catch(e){}
  history.replaceState(null, '', window.location.pathname + (session ? back : ''));
  if(!session) return true;
  gmailState = null; gmailReadAt = 0;
  openScreenFromAddress(back);
  const say = { connected: ['success', 'Gmail connected', 'Radar reads new emails from your clients and suggests tasks in Tasks. The first read looks back 3 days.'],
    denied: ['info', 'Not connected', 'You can connect Gmail anytime from Settings → Connections.'],
    'wrong-account': ['error', 'That’s a different Google account', 'Connect your work Gmail, the one at the team’s domain.'],
    scope: ['error', 'Gmail wasn’t allowed', 'Tick “Read your email” on Google’s screen, then try again.'],
    setup: ['error', 'Almost there', 'An admin needs to run addendum-gmail.sql in Supabase first.'] }[outcome] || ['error', 'Gmail didn’t connect', 'Something went wrong. Try again.'];
  showToast(...say);
  if(outcome === 'connected') setTimeout(() => gmailCheckNow(), 1200);
  return true;
}
