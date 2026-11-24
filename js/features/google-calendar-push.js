// Google Calendar connect/sync and browser push notifications.

/* ---------- Google Calendar connect / sync / disconnect (Profile page) ---------- */

// Shared fetch behind both the full status panel on Profile and the
// compact widget on the Calendar tab — same underlying data, rendered two
// different ways for two different contexts. Returns null on any failure
// (network error or non-OK response), letting each caller decide how to
// present that rather than duplicating the try/catch and status check twice.
async function fetchGoogleCalendarStatus(){
  try{
    const { data: { session } } = await supabaseClient.auth.getSession();
    const response = await fetch('/api/integrations?provider=google', {
      headers: { 'Authorization': `Bearer ${session.access_token}` }
    });
    if(!response.ok) return null;
    return await response.json();
  }catch(e){
    return null;
  }
}

const VAPID_PUBLIC_KEY = 'BMKfTiTGaN-T9TYO-m6a1oAbIypXcS_FsPZ0ie1uIopU9wJQfOmrX7JvT_yReo8OkReAqlT-1PA8kL1m6sqII6s';

// PushManager.subscribe() requires the public key as a Uint8Array, not the
// raw base64url string it's normally shared as — this is the standard
// conversion for that, worth getting exactly right since a subtly wrong
// version fails in ways that are hard to diagnose from the error alone.
function urlBase64ToUint8Array(base64String){
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

async function loadPushStatus(){
  const el = document.getElementById('pushStatusBox');
  if(!el) return;

  if(!('serviceWorker' in navigator) || !('PushManager' in window)){
    el.innerHTML = `<p style="font-size:13.5px;color:var(--muted);line-height:1.5;">Push notifications aren't supported in this browser. On iPhone, this only works if the app has been added to the Home Screen first — Safari alone can't receive push notifications.</p>`;
    return;
  }

  if(Notification.permission === 'denied'){
    el.innerHTML = `<p style="font-size:13.5px;color:var(--muted);line-height:1.5;">Notifications are blocked for this site. This can only be undone from your browser's own site settings, not from a button here — look for a lock or site-info icon in the address bar.</p>`;
    return;
  }

  el.innerHTML = `<div class="empty">Checking…</div>`;
  try{
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    // A browser-level subscription existing isn't enough on its own — that's
    // shared by whichever accounts have ever used this device, not specific
    // to whoever's currently logged in. Only treat push as "on" if this
    // account actually has its own saved row for it. RLS already restricts
    // this query to rows this account owns, so a null result here correctly
    // means "not set up for me" even if the browser itself already has
    // permission granted from a different account's earlier setup.
    let myRow = null;
    if(sub){
      const { data } = await supabaseClient.from('push_subscriptions').select('id').eq('endpoint', sub.endpoint).maybeSingle();
      myRow = data;
    }
    if(sub && myRow){
      el.innerHTML = `
        <p style="font-size:13.5px;color:var(--muted);line-height:1.5;margin:0 0 12px;">Push notifications are on for this device.</p>
        <button class="btn btn-outline" onclick="disablePushNotifications()">Turn off on this device</button>`;
    } else {
      el.innerHTML = `
        <p style="font-size:13.5px;color:var(--muted);line-height:1.5;margin:0 0 12px;">Get notified on this device even when the app isn't open — approvals, reminders, and more.</p>
        <button class="btn btn-brand" onclick="enablePushNotifications()">Enable Push Notifications</button>`;
    }
  }catch(e){
    el.innerHTML = `<p style="font-size:13.5px;color:var(--red);line-height:1.5;">Couldn't check push status: ${escapeHtml(String(e.message||e))}</p>`;
  }
}

async function enablePushNotifications(){
  try{
    const permission = await Notification.requestPermission();
    if(permission !== 'granted'){
      showToast('info','Not enabled', 'Notification permission was not granted.');
      loadPushStatus();
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    const subJson = sub.toJSON();
    const { data: { user } } = await supabaseClient.auth.getUser();
    const { error } = await supabaseClient.from('push_subscriptions').upsert({
      user_id: user.id,
      endpoint: subJson.endpoint,
      p256dh: subJson.keys.p256dh,
      auth: subJson.keys.auth,
      user_agent: navigator.userAgent,
    }, { onConflict: 'user_id,endpoint' });
    if(error){ showToast('error','Could not save subscription', error.message); return; }
    showToast('success','Push notifications enabled', 'You\'ll get notified on this device.');
    loadPushStatus();
  }catch(e){
    showToast('error','Could not enable push', String(e.message||e));
    loadPushStatus();
  }
}

async function disablePushNotifications(){
  try{
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if(sub){
      await supabaseClient.from('push_subscriptions').delete().eq('endpoint', sub.endpoint).eq('user_id', currentUser?.id);
      await sub.unsubscribe();
    }
    showToast('success','Push notifications turned off', 'This device will no longer receive them.');
    loadPushStatus();
  }catch(e){
    showToast('error','Could not disable push', String(e.message||e));
    loadPushStatus();
  }
}

async function loadGoogleCalendarStatus(){
  const el = document.getElementById('gcalStatusBox');
  if(!el) return;
  el.innerHTML = `<div class="empty">Checking…</div>`;
  const data = await fetchGoogleCalendarStatus();
  if(!data){ el.innerHTML = `<div class="empty">Could not check status — try again.</div>`; return; }

  if(!data.googleConfigured){
    el.innerHTML = `<p style="font-size:13.5px;color:var(--muted);line-height:1.5;">Google Calendar sync isn't configured for this deployment yet — an admin needs to set up a Google Cloud project and add the credentials. See the README for the exact steps.</p>`;
    return;
  }
  if(data.connected){
    el.innerHTML = `
      <p style="font-size:13.5px;color:var(--muted);line-height:1.5;margin:0 0 12px;">Connected as <b>${escapeHtml(data.email)||'your Google account'}</b>${data.lastSyncedAt ? ` · Last synced ${new Date(data.lastSyncedAt).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}` : ' · Not synced yet'}</p>
      <button class="btn btn-brand" onclick="syncGoogleCalendar()">Sync now</button>
      <button class="btn btn-outline" onclick="disconnectGoogleCalendar()">Disconnect</button>`;
  } else {
    el.innerHTML = `
      <p style="font-size:13.5px;color:var(--muted);line-height:1.5;margin:0 0 12px;">Connect your Google Calendar to pull your meetings into the shared team calendar automatically.</p>
      <button class="btn btn-brand" onclick="connectGoogleCalendar()">Connect Google Calendar</button>`;
  }
}

// Compact "Last synced X · Sync now" widget on the Calendar tab itself —
// stays hidden entirely if the user has nothing connected (a sync button
// with nothing to sync would just be confusing), and hidden while
// Google Calendar isn't configured for this deployment at all.
async function renderCalendarGoogleSyncWidget(){
  const el = document.getElementById('calGoogleSyncStatus');
  if(!el) return;
  const data = await fetchGoogleCalendarStatus();
  if(!data || !data.googleConfigured || !data.connected){
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  el.style.display = 'flex';
  const lastSynced = data.lastSyncedAt
    ? new Date(data.lastSyncedAt).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})
    : 'Not synced yet';
  el.innerHTML = `<span>Google Calendar · Last synced ${lastSynced}</span><button class="btn btn-outline" style="padding:6px 12px;font-size:12.5px;" onclick="syncGoogleCalendarFromTab()">Sync now</button>`;
}

// Same underlying sync as the Profile page button — it already reloads
// events and re-renders the calendar itself, so this only adds the one
// thing it doesn't already handle: refreshing this widget's own timestamp.
async function syncGoogleCalendarFromTab(){
  await syncGoogleCalendar();
  renderCalendarGoogleSyncWidget();
}

async function connectGoogleCalendar(){
  const { data: { session } } = await supabaseClient.auth.getSession();
  window.location.href = `/api/google-oauth-start?access_token=${encodeURIComponent(session.access_token)}`;
}

async function syncGoogleCalendar(){
  showToast('info','Syncing…','Pulling events from Google Calendar.');
  try{
    const { data: { session } } = await supabaseClient.auth.getSession();
    const response = await fetch('/api/integrations', {
      method:'POST', headers:{ 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider:'google', action:'sync' })
    });
    const data = await response.json();
    if(!response.ok){ showToast('error','Sync failed', data.error || 'Could not sync.'); return; }
    await loadCalendarEvents();
    renderCalendar();
    loadGoogleCalendarStatus();
    if(data.total > data.synced && data.firstError){
      showToastWithCopy('error','Some events failed to save', `${data.synced} of ${data.total} synced. First error: ${data.firstError}`, data.firstError);
    } else {
      const detail = data.total > data.synced
        ? `${data.synced} of ${data.total} event${data.total!==1?'s':''} pulled in — some couldn't be saved.`
        : `${data.synced} event${data.synced!==1?'s':''} pulled in.`;
      showToast('success','Synced', detail);
    }
  }catch(e){
    showToast('error','Sync failed','Network error — try again.');
  }
}

async function disconnectGoogleCalendar(){
  if(!(await confirmDialog('Disconnect Google Calendar? Previously-synced events will be removed from the calendar.', {confirmLabel:'Disconnect'}))) return;
  try{
    const { data: { session } } = await supabaseClient.auth.getSession();
    const response = await fetch('/api/integrations', {
      method:'POST', headers:{ 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider:'google', action:'disconnect' })
    });
    const data = await response.json();
    if(!response.ok){ showToast('error','Failed', data.error || 'Could not disconnect.'); return; }
    await loadCalendarEvents();
    renderCalendar();
    loadGoogleCalendarStatus();
    showToast('success','Disconnected','Google Calendar is no longer connected.');
  }catch(e){
    showToast('error','Failed','Network error — try again.');
  }
}


// ---- Your Google Calendar, kept current while Radar is open (Nov 23) ----------------------------
// A quiet sync a few seconds after Radar opens, every 10 minutes while it's in front, when you come
// back to it after 10 minutes away, and when the Calendar opens if it's been 3 minutes; new, moved
// and deleted meetings show without pressing Sync. (The server also syncs on its own: see
// lib/meeting-alerts.js.) Only when your Google Calendar is connected.
const gcalAuto = { at: 0, busy: false, connected: null };
async function gcalSyncQuiet(minAgeMs){
  if(gcalAuto.busy || gcalAuto.connected === false || Date.now() - gcalAuto.at < (minAgeMs || 0)) return;
  gcalAuto.busy = true;
  try{
    if(gcalAuto.connected == null){ const st = await fetchGoogleCalendarStatus(); gcalAuto.connected = !!(st && st.googleConfigured && st.connected); if(!gcalAuto.connected) return; }
    const { data: { session } } = await supabaseClient.auth.getSession(); if(!session) return;
    const sig = () => JSON.stringify((typeof calendarEvents !== 'undefined' ? calendarEvents : []).map(e => [e.id, e.startAt, e.endAt, e.title, e.meetingUrl]));
    const r = await fetch('/api/integrations', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'google', action: 'sync' }) });
    gcalAuto.at = Date.now();
    if(r.ok){ const before = sig(); await loadCalendarEvents(); if(sig() !== before && currentViewName === 'calendar' && typeof renderCalendar === 'function') renderCalendar(); }
  }catch(e){} finally{ gcalAuto.busy = false; }
}

// ---- A meeting about to start (Nov 23) ------------------------------------------------------------
// While Radar is open: at the meeting's own alert time (else 10 minutes before), a notification with
// Join, unless the server already sent it (the same notification, so never twice).
const meetAsked = new Set();
async function meetingSoonCheck(){
  if(!currentUser || typeof calendarEvents === 'undefined') return;
  const me = currentUser.id, now = Date.now();
  const muted = (myProfile && myProfile.muted_notification_types) || [];
  if(muted.includes('meeting_soon') || muted.includes('app:meeting_soon')) return;
  const mine = calendarEvents.filter(e => !e.allDay && e.startAt && (e.googleEventId ? e.googleOwner === me : (e.createdBy === me || (e.attendeeIds || []).includes(me)) && !(e.rsvps && e.rsvps[me] && e.rsvps[me].status === 'declined')));
  for(const e of mine){
    const lead = Math.min(Math.max(Number(e.reminderMinutes) > 0 ? Number(e.reminderMinutes) : 10, 1), 30);
    const mins = (new Date(e.startAt).getTime() - now) / 60000;
    if(mins > lead || mins < -2 || meetAsked.has(e.id)) continue;
    meetAsked.add(e.id);
    const { data: had } = await supabaseClient.from('notifications').select('id').eq('user_id', me).eq('type', 'meeting_soon').eq('target_id', String(e.id)).limit(1);
    if(had && had.length) continue;
    const left = Math.max(0, Math.round(mins)), m = typeof meetingLink === 'function' ? meetingLink(e) : null;
    await supabaseClient.from('notifications').insert({ user_id: me, type: 'meeting_soon', title: left <= 0 ? `Starting now: ${e.title}` : `In ${left} minute${left === 1 ? '' : 's'}: ${e.title}`,
      body: m ? `Join on ${m.name}` : (e.location || 'On your calendar'), target_view: 'calendar', target_id: String(e.id), read: false });
    if(typeof checkForNewNotificationToasts === 'function') checkForNewNotificationToasts();
    if(typeof loadNotifications === 'function') loadNotifications();
  }
}
function gcalAutoStart(){
  if(gcalAutoStart.on) return; gcalAutoStart.on = true;
  setTimeout(() => gcalSyncQuiet(0), 8000);
  setInterval(() => {
    if(document.visibilityState !== 'visible') return;
    gcalSyncQuiet(9.5 * 60000);
  }, 60000);
  setInterval(meetingSoonCheck, 30000); setTimeout(meetingSoonCheck, 12000);
  document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible'){ gcalSyncQuiet(10 * 60000); meetingSoonCheck(); } });
}
