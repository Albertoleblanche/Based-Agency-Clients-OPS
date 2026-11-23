// Signing ChatGPT or Claude in to Radar (Nov 23).
// Supabase's OAuth server sends the person here (Authentication → OAuth Server → Authorization Path
// /oauth/consent, rewritten to oauth-consent.html in vercel.json) with ?authorization_id=…. Someone
// already signed in to Radar in this browser sees which app is asking and what it can do, and
// allows it or not; someone who isn't signs in first, right here (work email, like the app). After
// the decision Supabase gives the address to go back to the app with. Allowed before: straight back.
(function(){
  const view = document.getElementById('view'), card = document.getElementById('card');
  const id = new URLSearchParams(location.search).get('authorization_id');
  const esc = s => escapeHtml(String(s == null ? '' : s));
  const show = html => { view.innerHTML = html; requestAnimationFrame(() => card.classList.add('in')); };
  const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  const WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>';

  function problem(title, text){
    show(`<div class="center">${WARN}<h1>${esc(title)}</h1><p class="sub">${esc(text)}</p></div>`);
  }
  function authMessage(error){
    const m = String(error && (error.message || error) || '');
    if(/invalid login|invalid credentials/i.test(m)) return 'That email and password don’t match.';
    if(/rate|too many/i.test(m)) return 'Too many tries. Wait a minute and try again.';
    if(/fetch|network/i.test(m)) return 'Couldn’t reach Radar. Check the connection and try again.';
    return m || 'Couldn’t sign in.';
  }

  async function start(){
    if(!id) return problem('Nothing to connect', 'Open this from ChatGPT or Claude when you connect Radar.');
    if(!supabaseClient.auth.oauth || !supabaseClient.auth.oauth.getAuthorizationDetails) return problem('Can’t connect from here', 'This page needs a newer Radar. Reload it and try again.');
    const { data: { session } } = await supabaseClient.auth.getSession();
    if(!session) return signIn();
    let r;
    try{ r = await supabaseClient.auth.oauth.getAuthorizationDetails(id); }catch(e){ r = { error: e }; }
    const d = r && r.data;
    if(r.error || !d) return problem('This link has expired', 'Start connecting again from ChatGPT or Claude.');
    if(!('authorization_id' in d) && d.redirect_url){ location.replace(d.redirect_url); return; }   // allowed before
    const app = (d.client && (d.client.name || d.client.client_name)) || 'An app';
    const email = (d.user && d.user.email) || session.user.email || '';
    document.title = `Allow ${app} to use Radar?`;
    show(`<h1>Allow ${esc(app)} to use Radar?</h1>
<p class="sub">Signed in as ${esc(email)}. <a href="#" id="other">Not you?</a></p>
<ul class="can"><li>${CHECK}<span>See the clients, tasks, follow-ups and hours you can see in Radar</span></li>
<li>${CHECK}<span>Add and finish tasks, add follow-ups and log time, as you</span></li>
<li>${CHECK}<span>It never sends anything to a client</span></li></ul>
<div class="row"><button class="sec" id="deny">Don’t Allow</button><button class="pri" id="allow">Allow</button></div>
<p class="foot">You can disconnect it any time in Radar: Settings → Connections → ChatGPT and Claude.</p>`);
    document.getElementById('allow').onclick = () => decide(true);
    document.getElementById('deny').onclick = () => decide(false);
    document.getElementById('other').onclick = async e => { e.preventDefault(); await supabaseClient.auth.signOut({ scope: 'local' }); signIn(); };
    document.getElementById('allow').focus({ preventScroll: true });
  }

  async function decide(yes){
    const a = document.getElementById('allow'), n = document.getElementById('deny');
    a.disabled = n.disabled = true; (yes ? a : n).textContent = yes ? 'Allowing…' : 'Declining…';
    let r;
    try{ r = yes ? await supabaseClient.auth.oauth.approveAuthorization(id, { skipBrowserRedirect: true }) : await supabaseClient.auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true }); }
    catch(e){ r = { error: e }; }
    const url = r && r.data && r.data.redirect_url;
    if(r.error || !url){ a.disabled = n.disabled = false; a.textContent = 'Allow'; n.textContent = 'Don’t Allow'; return problem('That didn’t go through', 'The request may have expired. Start connecting again from ChatGPT or Claude.'); }
    show(`<div class="center"><div class="spin" role="status"></div><h1>${yes ? 'Connected' : 'Not connected'}</h1><p class="sub">Taking you back…</p></div>`);
    location.assign(url);
  }

  function signIn(){
    show(`<h1>Sign in to connect</h1><p class="sub">ChatGPT or Claude will use Radar as you.</p>
<form id="si" novalidate><label for="em">Work email</label><input id="em" type="email" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="you@${esc(typeof TEAM_EMAIL_DOMAIN !== 'undefined' ? TEAM_EMAIL_DOMAIN : 'based-agency.com')}">
<label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password"><p class="err" id="err"></p>
<div class="row"><button class="pri" id="go" type="submit">Sign In</button></div></form>
<p class="foot">Forgot it? <a href="/" target="_blank" rel="noopener">Reset it in Radar</a>, then come back.</p>`);
    const f = document.getElementById('si'), em = document.getElementById('em'), pw = document.getElementById('pw'), err = document.getElementById('err'), go = document.getElementById('go');
    setTimeout(() => em.focus({ preventScroll: true }), 50);
    f.onsubmit = async e => {
      e.preventDefault();
      const email = em.value.trim(), bad = typeof teamEmailProblem === 'function' ? teamEmailProblem(email) : (email ? '' : 'Enter your work email.');
      if(bad){ err.textContent = bad; em.focus(); return; }
      if(!pw.value){ err.textContent = 'Enter your password.'; pw.focus(); return; }
      err.textContent = ''; go.disabled = true; go.textContent = 'Signing In…';
      let r; try{ r = await supabaseClient.auth.signInWithPassword({ email, password: pw.value }); }catch(x){ r = { error: x }; }
      if(r.error){ go.disabled = false; go.textContent = 'Sign In'; err.textContent = authMessage(r.error); pw.select(); return; }
      start();
    };
  }

  start().catch(e => problem('Something went wrong', String(e && e.message || e)));
})();
