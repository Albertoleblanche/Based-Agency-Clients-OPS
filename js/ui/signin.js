// Sign in and opening (Nov 20). One screen, one panel: sign in, a reset link, the link sent, and a new
// password after a reset link, each swapping in place. Signing in, the panel fades and a greeting with
// a thin progress line takes its place; each part of the workspace ticks off as it loads; then the
// screen fades out of the way and the app comes in under it. Markup: #loginOverlay in index.html.

const SI_TEXT = {
  boot:    ['Based Radar', ''],
  form:    ['Based Radar', 'Sign in with your work email'],
  forgot:  ['Reset your password', 'Based Radar'],
  sent:    ['Check your email', 'Based Radar'],
  newpw:   ['Set a new password', 'Based Radar'],
  opening: [null, 'Opening your workspace'],
};
const SI_PANES = ['form', 'forgot', 'sent', 'newpw'];
const $si = id => document.getElementById(id);

// A reset or invite link noted by the inline script in <head> (Supabase clears the address as it starts).
function siRecovering(){ try{ return sessionStorage.getItem('bda_recovery') === '1'; }catch(e){ return false; } }
function siSetRecovering(on){ try{ on ? sessionStorage.setItem('bda_recovery', '1') : sessionStorage.removeItem('bda_recovery'); }catch(e){} }
function siTakeLinkError(){ try{ const v = sessionStorage.getItem('bda_link_error') === '1'; sessionStorage.removeItem('bda_link_error'); return v; }catch(e){ return false; } }

function siHello(d){ const h = (d || new Date()).getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }

// Swap a line of text with the soft blur-in, only when it changes.
function siText(el, text){
  if(!el || el.textContent === text) return;
  el.textContent = text;
  el.classList.remove('si-swap'); void el.offsetWidth; el.classList.add('si-swap');
}
// Fill the icon slots once (data-ic="eye" → the Lucide glyph).
function siIcons(root){
  if(typeof icon !== 'function') return;
  (root || document).querySelectorAll('#loginOverlay [data-ic]').forEach(el => { if(!el.firstElementChild) el.innerHTML = icon(el.dataset.ic); });
}

function siSet(st, o){
  o = o || {};
  const root = $si('loginOverlay'); if(!root) return;
  siIcons();
  root.dataset.st = st;
  const [h, sub] = SI_TEXT[st] || SI_TEXT.form;
  siText($si('siHeading'), o.heading || h || $si('siHeading').textContent);
  siText($si('siSub'), o.sub != null ? o.sub : sub);
  const pane = SI_PANES.includes(st) ? st : null;
  root.querySelectorAll('[data-pane]').forEach(p => {
    const on = p.dataset.pane === pane;
    if(on && p.hidden){ p.hidden = false; p.classList.remove('si-swap'); void p.offsetWidth; p.classList.add('si-swap'); }
    else if(!on) p.hidden = true;
  });
  const panel = $si('siPanel');
  panel.classList.toggle('is-out', !pane); panel.inert = !pane;
  $si('siNote').classList.toggle('is-out', st !== 'form');
  $si('siOpen').hidden = st !== 'opening';
  if(st !== 'opening') [1, 2, 3].forEach(n => $si('siStep' + n)?.classList.remove('on'));
}

// Go to a pane, carrying the email across and putting the cursor where the next keystroke goes.
function siShow(st){
  const email = ($si('loginEmail').value || '').trim();
  if(st === 'forgot'){ const r = $si('siResetEmail'); if(!r.value.trim()) r.value = email; siErr('siResetErr', ''); }
  if(st === 'form') siErr('loginError', '');
  siSet(st);
  siFocus(st);
}
function siFocus(st){
  if(matchMedia('(hover: none)').matches) return;   // no keyboard popping up on a touch screen
  const id = st === 'forgot' ? 'siResetEmail' : st === 'newpw' ? 'siNewPw' : st === 'form' ? ($si('loginEmail').value.trim() ? 'loginPassword' : 'loginEmail') : null;
  const el = id && $si(id); if(el) setTimeout(() => el.focus({ preventScroll: true }), 30);
}

function siErr(id, msg, badIds){
  const el = $si(id); if(!el) return;
  document.querySelectorAll('#loginOverlay .si-in.bad').forEach(i => { if(!msg || el.closest('form')?.contains(i)) i.classList.remove('bad'); });
  if(!msg){ el.hidden = true; el.textContent = ''; return; }
  el.textContent = msg; el.hidden = false;
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  (badIds || []).forEach(b => $si(b)?.classList.add('bad'));
}

function siBusy(btn, label, inputs){
  if(!btn) return;
  if(btn.dataset.label === undefined) btn.dataset.label = btn.textContent;
  btn.disabled = true; btn.classList.add('is-busy');
  btn.innerHTML = `<span class="si-spin" aria-hidden="true"></span>${escapeHtml(label)}`;
  (inputs || []).forEach(i => $si(i)?.classList.add('is-busy'));
}
function siIdle(btn){
  if(!btn) return;
  if(btn.dataset.label !== undefined){ btn.textContent = btn.dataset.label; delete btn.dataset.label; }
  btn.disabled = false; btn.classList.remove('is-busy');
  btn.closest('form')?.querySelectorAll('.si-in.is-busy').forEach(i => i.classList.remove('is-busy'));
}

function siToggleEye(btn){
  const input = btn.parentNode.querySelector('input'); if(!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.setAttribute('aria-pressed', String(show));
  btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  btn.innerHTML = icon(show ? 'eye-off' : 'eye');
}
function siHidePasswords(){
  document.querySelectorAll('#loginOverlay .si-eye[aria-pressed="true"]').forEach(siToggleEye);
}

// What Supabase says, in the app's words.
function siAuthMessage(error, kind){
  const m = String((error && (error.message || error.error_description)) || '').toLowerCase(), code = (error && error.code) || '', status = error && error.status;
  if(/failed to fetch|network|load failed|fetch/.test(m) || status === 0) return 'Can’t reach Based Radar right now. Check your connection and try again.';
  if(code === 'invalid_credentials' || /invalid login|invalid credentials|invalid grant/.test(m)) return 'That email and password don’t match. Try again, or reset your password.';
  if(/not confirmed/.test(m)) return 'This email hasn’t been confirmed yet. Ask an admin to send the invite again.';
  if(status === 429 || /rate limit|too many|security purposes|seconds/.test(m)) return kind === 'reset' ? 'A link went out a moment ago. Wait a minute before asking for another.' : 'Too many tries. Wait a minute, then try again.';
  if(code === 'same_password' || /different from the old|same password/.test(m)) return 'That’s your current password. Choose a new one.';
  if(code === 'weak_password' || /weak|at least|should be/.test(m)) return 'Choose a longer password, at least 8 characters.';
  if(/expired|invalid.*(token|link)|session/.test(m)) return 'This link has expired. Ask for a new one from Forgot password.';
  return (error && error.message) || 'Something went wrong. Try again.';
}

// ---- forgot password ----------------------------------------------------------------------------
async function siSendLink(){
  const email = ($si('siResetEmail').value || '').trim(), btn = $si('siResetBtn');
  const bad = teamEmailProblem(email);
  if(bad){ siErr('siResetErr', bad, ['siResetEmail']); $si('siResetEmail').focus(); return; }
  siErr('siResetErr', '');
  siBusy(btn, 'Sending…', ['siResetEmail']);
  let error = null;
  try{ ({ error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/' })); }catch(e){ error = e; }
  siIdle(btn);
  if(error){ siErr('siResetErr', siAuthMessage(error, 'reset'), ['siResetEmail']); return; }
  $si('siSentTo').textContent = email;
  siSet('sent');
}

// ---- a new password, after a reset link ---------------------------------------------------------
function siShowNewPassword(session){
  siSetRecovering(true);
  $si('siNewFor').textContent = (session && session.user && session.user.email) || 'your account';
  $si('siNewPw').value = ''; $si('siNewPw2').value = ''; siErr('siNewErr', '');
  document.body.classList.add('signed-out');
  $si('loginOverlay').style.display = '';
  $si('appRoot').style.display = 'none';
  siSet('newpw'); siFocus('newpw');
}
async function siSaveNewPassword(){
  const pw = $si('siNewPw').value, pw2 = $si('siNewPw2').value, btn = $si('siNewBtn');
  if(pw.length < 8){ siErr('siNewErr', 'Use at least 8 characters.', ['siNewPw']); $si('siNewPw').focus(); return; }
  if(pw !== pw2){ siErr('siNewErr', 'The two passwords don’t match.', ['siNewPw2']); $si('siNewPw2').focus(); return; }
  siErr('siNewErr', '');
  siBusy(btn, 'Saving…', ['siNewPw', 'siNewPw2']);
  let error = null;
  try{ ({ error } = await supabaseClient.auth.updateUser({ password: pw })); }catch(e){ error = e; }
  if(error){ siIdle(btn); siErr('siNewErr', siAuthMessage(error, 'new'), ['siNewPw']); return; }
  siSetRecovering(false);
  siHidePasswords();
  const { data: { session } } = await supabaseClient.auth.getSession();
  siIdle(btn);
  if(session) await showApp(session, { sub: 'Password saved · Opening your workspace' });
  else siShow('form');
}
async function siLeaveRecovery(){
  siSetRecovering(false);
  try{ await supabaseClient.auth.signOut(); }catch(e){}
  showLoginScreen();
}

// ---- opening ------------------------------------------------------------------------------------
let siOpenedAt = 0;
function siOpening(o){
  o = o || {};
  siOpenedAt = Date.now();
  siErr('loginError', '');
  siHidePasswords();
  $si('loginOverlay').style.display = '';
  $si('loginOverlay').classList.remove('is-app');
  siSet('opening', { heading: o.heading, sub: o.sub });
}
function siGreet(name){
  const first = String(name || '').trim().split(/\s+/)[0];
  siText($si('siHeading'), siHello() + (first ? ', ' + first : ''));
}
function siStep(n){ $si('siStep' + n)?.classList.add('on'); }
// The workspace is ready: let the greeting land, then fade the screen away over the app.
async function siEnterApp(){
  const root = $si('loginOverlay'), app = $si('appRoot');
  [1, 2, 3].forEach(siStep);
  const wait = 520 - (Date.now() - siOpenedAt);   // long enough to read the greeting, never a flash
  if(wait > 0) await new Promise(r => setTimeout(r, wait));
  app.style.display = 'flex';
  app.classList.remove('si-app-in'); void app.offsetWidth; app.classList.add('si-app-in');
  root.classList.add('is-app');
  setTimeout(() => {
    if(!root.classList.contains('is-app')) return;   // signed out again meanwhile
    root.style.display = 'none'; root.classList.remove('is-app'); app.classList.remove('si-app-in');
    siSet('boot');
  }, 620);
}

// Escape steps back from the reset panes to signing in.
document.addEventListener('keydown', e => {
  if(e.key !== 'Escape') return;
  const root = $si('loginOverlay'); if(!root || root.style.display === 'none') return;
  if(root.dataset.st === 'forgot' || root.dataset.st === 'sent'){ e.preventDefault(); siShow('form'); }
});
document.addEventListener('DOMContentLoaded', () => siIcons());
