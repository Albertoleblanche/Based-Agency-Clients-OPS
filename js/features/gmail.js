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
function gmailRowHtml(st){ return gmailMainRowHtml(st) + gmailLabelRowHtml(st); }
function gmailMainRowHtml(st){
  const g = gmailState;
  const head = sub => `<div class="fr cn-r">${appLogo('gmail')}<div class="l"><b>Gmail</b><span>${sub}</span></div>`;
  if(!g) return `${head('Tasks from your clients’ emails, suggested in Tasks')}${st('', 'Checking…')}</div>`;
  if(g.needsSetup) return `${head('Tasks from your clients’ emails, suggested in Tasks')}${st('hollow', isAdmin() ? 'Run addendum-gmail.sql' : 'Not set up')}</div>`;
  if(!g.configured) return `${head('Tasks from your clients’ emails, suggested in Tasks')}${st('hollow', 'Not set up')}</div>`;
  if(!g.connected) return `${head('Tasks from your clients’ emails, suggested in Tasks. Read only.')}<button class="btn" onclick="gmailConnect()">Connect…</button></div>`;
  const read = g.lastReadAt && typeof claudeWhen === 'function' ? ' · read ' + claudeWhen(g.lastReadAt).toLowerCase() : '';
  return `${head(g.lastError ? escapeHtml(g.lastError) : `${escapeHtml(g.email || 'Connected')}: tasks from clients’ emails${read}`)}${g.lastError ? st('yellow', 'Needs attention') : st('green', 'Connected')}<button class="btn" onclick="gmailCheckNow()">Check Now</button><button class="btn" onclick="gmailDisconnect()">Disconnect</button></div>`;
}
// ---- The Gmail label "Radar" (Nov 24, lib/gmail-label.js) ------------------------------------------
// Label an email "Radar" in Gmail, and a small Apps Script in your own Google account sends it to Radar
// as a suggested task. You choose exactly which emails go in; nothing reads your inbox. Each person
// sets it up once: Radar makes their key and their script, they paste it into script.new and run it.
function gmailLabelRowHtml(st){
  const g = gmailState; if(!g) return '';
  const l = g.label || {};
  const head = sub => `<div class="fr cn-r" role="button" tabindex="0" onclick="if(!event.target.closest('button'))gmailLabelSheet()">${appLogo('gmail')}<div class="l"><b>Gmail label “Radar”</b><span>${sub}</span></div>`;
  if(l.needsSetup) return `${head('Label an email “Radar” and it comes to Radar as a task')}${st('hollow', isAdmin() ? 'Run addendum-gmail-label.sql' : 'Not set up')}</div>`;
  if(!l.on) return `${head('Label an email “Radar” and it comes to Radar as a task')}<button class="btn" onclick="gmailLabelSheet()">Set Up…</button></div>`;
  const last = l.lastUsedAt && typeof claudeWhen === 'function' ? ` · last ${claudeWhen(l.lastUsedAt).toLowerCase()}` : '';
  return `${head(`${l.sent ? `${l.sent} email${l.sent === 1 ? '' : 's'} sent to Radar${last}` : 'Set up. Label an email “Radar” to try it'}`)}${st('green', 'On')}<button class="btn" onclick="gmailLabelSheet()">Manage…</button></div>`;
}
let gmailLabelKeyNow = null;   // the key just made, shown once in its script
function gmailLabelScript(key){
  const url = `${location.origin}/api/integrations?route=gmail-label`;
  return `// Radar: label an email "Radar" in Gmail and it becomes a suggested task in Radar.
// Only the emails you label are sent. To set up: pick "setup" next to Run, press Run once.
const RADAR = '${url}';
const KEY = '${key}';   // yours alone: keep this script private
const LABEL = 'Radar', SENT = 'Radar/Sent';

function setup() {
  label_(LABEL); label_(SENT);
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sendToRadar').timeBased().everyMinutes(5).create();
  sendToRadar();
}

function sendToRadar() {
  const label = GmailApp.getUserLabelByName(LABEL);
  if (!label) return;
  const sent = label_(SENT), me = Session.getActiveUser().getEmail().toLowerCase();
  label.getThreads(0, 20).forEach(thread => {
    const all = thread.getMessages();
    const theirs = all.filter(m => m.getFrom().toLowerCase().indexOf(me) < 0);
    const m = (theirs.length ? theirs : all).pop();
    const res = UrlFetchApp.fetch(RADAR, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-radar-key': KEY },
      payload: JSON.stringify({ messageId: m.getId(), threadId: thread.getId(), from: m.getFrom(), to: m.getTo(), cc: m.getCc(),
        subject: m.getSubject(), date: m.getDate().toISOString(), body: m.getPlainBody().slice(0, 12000), account: me })
    });
    if (res.getResponseCode() === 200) { thread.removeLabel(label); thread.addLabel(sent); }
    else console.log('Radar said ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
  });
}

function label_(name) { return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name); }
`;
}
function gmailLabelSheet(){
  const l = (gmailState && gmailState.label) || {};
  const key = gmailLabelKeyNow;
  const intro = `<p class="gl-p">Label any email “Radar” in Gmail, and within 5 minutes it’s a suggested task in Tasks, with a link back to the email. Only the emails you label are sent. A small script in your own Google account does it; you set it up once.</p>`;
  let body, actions;
  if(key){
    body = `${intro}<ol class="gl-steps">
<li><b>Open a new Apps Script project</b><span>Go to <a href="https://script.new" target="_blank" rel="noopener">script.new</a>, signed in to your work Google account. Name it “Radar label”.</span></li>
<li><b>Replace its code with yours</b><span>Select everything there, paste this in, and save (⌘S or Ctrl+S).</span>
<div class="gl-code"><div class="gl-code-h"><span>Your script</span><button class="btn sm gl-copy" id="glCopy" onclick="gmailLabelCopy()">${icon('copy')}Copy</button></div><pre id="glScript">${escapeHtml(gmailLabelScript(key))}</pre></div></li>
<li><b>Run setup, once</b><span>Pick “setup” next to Run and press Run. Google asks you to allow it: it needs your Gmail to find the “Radar” label (it looks at nothing else), and to reach Radar. If Google says it isn’t verified, it’s your own script: click Advanced, then go to Radar label.</span></li>
<li><b>Label an email “Radar”</b><span>It’s in Tasks within 5 minutes, and the email’s label becomes “Radar/Sent”.</span></li>
</ol>
<p class="gl-note">This script holds your key, and Radar shows it only now. Keep it private: anyone with it could send emails to your Tasks.</p>`;
    actions = `<button class="btn btn-p" id="glMain" onclick="closeAppModal()">Done</button>`;
  } else if(l.on){
    const since = l.createdAt ? new Date(l.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    body = `${intro}<p class="gl-on">${st2('green', 'On')}<span>Set up${since ? ' ' + since : ''} · ${l.sent || 0} email${l.sent === 1 ? '' : 's'} sent${l.lastUsedAt && typeof claudeWhen === 'function' ? ' · last ' + claudeWhen(l.lastUsedAt).toLowerCase() : ''}</span></p>
<p class="gl-note">Setting it up again, on another account or after deleting the script? Make a new script. The one you have now stops working.</p>`;
    actions = `<button class="btn" style="margin-right:auto" onclick="gmailLabelOff()">Turn Off</button><button class="btn" onclick="gmailLabelKey(true)">New Script…</button><button class="btn btn-p" id="glMain" onclick="closeAppModal()">Done</button>`;
  } else {
    body = `${intro}<ol class="gl-steps gl-pre"><li><b>Get your script</b><span>Radar makes one just for you.</span></li><li><b>Paste it into a new Apps Script project</b><span>At script.new, then run setup once.</span></li><li><b>Label an email “Radar”</b><span>It’s in Tasks within 5 minutes.</span></li></ol>`;
    actions = `<button class="btn" onclick="closeAppModal()">Cancel</button><button class="btn btn-p" id="glGet" onclick="gmailLabelKey(false)">Get My Script</button>`;
  }
  openAppModal(`<h3 class="ap-h">${appLogo('gmail', 'sm')}Gmail label “Radar”</h3>
<div class="gl">${body}</div>
<div class="sheet-a">${actions}</div>
${icons8Credit(['gmail'], 'sh-i8')}`, 640);
  // the main button, after the sheet's own first focus (not the credit link or a step's link)
  setTimeout(() => (document.getElementById('glGet') || document.getElementById('glMain'))?.focus({ preventScroll: true }), 30);
}
// a small status dot outside Settings' own helper
function st2(tone, text){ return `<span class="st"><span class="dot ${tone}"></span>${escapeHtml(text)}</span>`; }
async function gmailLabelKey(again){
  if(again && !(await confirmDialog('Make a new script? The one you have now stops working until you paste the new one into Apps Script.', { confirmLabel: 'New Script' }))) return;
  const btn = document.getElementById('glGet'); if(btn) setBtnLoading(btn, 'Making it…');
  const r = await gmailCall({ action: 'label-key' });
  if(!r.key){ if(btn) restoreBtn(btn); showToast('error', 'Couldn’t make your script', r.error || 'Try again.'); return; }
  gmailLabelKeyNow = r.key;
  gmailState = Object.assign({}, gmailState, { label: { on: true, createdAt: new Date().toISOString(), sent: 0 } });
  gmailLabelSheet();
  if(currentViewName === 'settings' && typeof loadIntegrationStatuses === 'function') loadIntegrationStatuses();
}
function gmailLabelCopy(){
  const t = document.getElementById('glScript')?.textContent || '', b = document.getElementById('glCopy');
  const done = () => { if(b){ b.innerHTML = `${icon('check')}Copied`; setTimeout(() => { if(b.isConnected) b.innerHTML = `${icon('copy')}Copy`; }, 1800); } };
  if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, () => { selectScript(); });
  else selectScript();
  function selectScript(){ const pre = document.getElementById('glScript'); if(!pre) return; const r = document.createRange(); r.selectNodeContents(pre); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); showToast('info', 'Selected', 'Press ⌘C or Ctrl+C to copy it.'); }
}
async function gmailLabelOff(){
  if(!(await confirmDialog('Turn off the Gmail label? Emails you label “Radar” stop coming to Radar. You can delete the script in Apps Script too.', { confirmLabel: 'Turn Off' }))) return;
  await gmailCall({ action: 'label-off' });
  gmailLabelKeyNow = null;
  gmailState = Object.assign({}, gmailState, { label: { on: false } });
  closeAppModal();
  showToast('success', 'Gmail label turned off', 'Set it up again anytime.');
  if(currentViewName === 'settings' && typeof loadIntegrationStatuses === 'function') loadIntegrationStatuses();
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
