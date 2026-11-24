// Notification bell: inbox, badges, new-notification toasts.

/* ---------- Notification bell — unified inbox for tasks, email-change
   requests, and anything else that needs to reach a specific person. ---------- */

let notifications = [];

// Every distinct notification type this app actually sends, with a plain
// description for the mute settings panel. Keep this in sync with any new
// notification type added elsewhere — it's the single source both the
// settings UI and (indirectly, since sendNotification() checks against it)
// enforcement rely on.
// section groups the Notification Preferences panel into headed groups
// instead of one long flat list — order here also controls display order,
// both of sections (first-seen order) and rows within each section.
// visibleTo restricts which roles even see a toggle for a type — most
// types are omitted here (meaning everyone sees them), but a few only
// ever get sent to a subset of roles (e.g. email_change_requested only
// ever goes to admins — see submitEmailChangeRequest()), so showing a
// mute toggle for those to someone who could never receive them is just
// confusing clutter, not a real preference.
const NOTIFICATION_TYPE_META = {
  update_behind:           { label:'A client update you hold is overdue', section:'Weekly Updates' },
  draft_written:           { label:'A draft is written for you to check', section:'Weekly Updates' },
  monday_summary:          { label:'The Monday summary', section:'Weekly Updates', visibleTo:'approver' },
  task_assigned:           { label:'A task is assigned to you', section:'Tasks' },
  task_completed:          { label:'A task you assigned is completed', section:'Tasks' },
  task_cancelled:          { label:'A task assigned to you is cancelled', section:'Tasks' },
  task_edited:             { label:'A task assigned to you changes', section:'Tasks' },
  task_suggested:          { label:'A task is suggested from a meeting you were in', section:'Tasks' },
  draft_ready:             { label:'A draft is ready for your approval', section:'Client Work', visibleTo:'approver' },
  draft_approved:          { label:'Your update or submitted work is approved', section:'Client Work' },
  win_approved:            { label:'Your WhatsApp update is approved, for you to send', section:'Client Work' },
  draft_sent:              { label:'Your update is sent to the client', section:'Client Work' },
  draft_skipped:           { label:'Your submitted draft is skipped', section:'Client Work' },
  draft_returned:          { label:'A draft goes back to its writer because work in it was deleted', section:'Client Work' },
  work_deleted:            { label:'Someone deletes your logged work and its time', section:'Client Work' },
  email_sent:              { label:'A client email is sent', section:'Client Work', visibleTo:'approver' },
  reminder_follow_up_due:  { label:'A client follow-up you own comes due', section:'Client Work' },
  whatsapp_request:        { label:'A client asks you for something on WhatsApp', section:'Client Work' },
  whatsapp_urgent:         { label:'A client message on WhatsApp looks urgent', section:'Client Work' },
  whatsapp_waiting:        { label:'A client of yours has waited too long for a reply on WhatsApp', section:'Client Work' },
  whatsapp_signal:         { label:'A client mentions pausing, budget, a competitor or growing (WhatsApp)', section:'Client Work', visibleTo:'admin' },
  reminder_added:          { label:'A client promises something in a meeting (a follow-up is added)', section:'Client Work' },
  reminder_escalated:      { label:'A client follow-up has gone unanswered for a week', section:'Client Work', visibleTo:'approver' },
  client_danger_maxed:     { label:'A client\'s danger score hits 5/5', section:'Client Work' },
  client_danger_decreased: { label:'A client\'s danger score goes down', section:'Client Work' },
  harvest_client:          { label:'A client is added from Harvest or archived there', section:'Client Work', visibleTo:'approver' },
  event_rsvp:              { label:'Someone RSVPs or requests a change to your event', section:'Calendar' },
  event_invited:           { label:"You're invited to a calendar event", section:'Calendar' },
  event_updated:           { label:'A calendar event you\'re on changes', section:'Calendar' },
  event_cancelled:         { label:'A calendar event you\'re on is cancelled', section:'Calendar' },
  meeting_soon:            { label:'A meeting is about to start (with the link to join)', section:'Calendar' },
  email_change_requested:  { label:'Someone requests an email change', section:'Account', visibleTo:'admin' },
  profile_changed:         { label:'Your role, title, or access changes', section:'Account' },
};

// Central place every notification insert should go through, instead of
// calling supabaseClient.from('notifications').insert(...) directly —
// checks the recipient's own mute preference first, so a muted type is
// never even written to the table. Not just hidden after the fact: it
// can't trigger a toast or sit in their bell either, since it was never
// stored in the first place.
async function sendNotification(userId, type, title, body, targetView, targetId, alreadyToasted){
  // Muting a type mutes it everywhere; "app:", "push:" or "slack:" before it mutes one place
  // only (Settings → Notifications).
  const recipient = teamProfiles.find(p=>p.id===userId);
  const muted = (recipient && recipient.muted_notification_types) || [];
  if(muted.includes(type)) return;
  if(!muted.includes('app:'+type)){
    const row = { user_id:userId, type, title, body, target_view:targetView, read:!!alreadyToasted };
    if(targetId) row.target_id = targetId;
    await supabaseClient.from('notifications').insert(row);
  }
  if(!muted.includes('push:'+type)) sendPushNotification(userId, title, body, notificationUrl(targetView, targetId));
  if(!muted.includes('slack:'+type)) sendSlackNotification(userId, type, title, body);
}

// Best-effort Slack DM alongside the in-app notification above — same
// "supplementary, not the source of truth" philosophy as the push
// notification below it. The actual mute check happens server-side
// (lib/slack-notify.js), reusing muted_notification_types — the same
// list that already gates in-app/push — so muting a notification type
// once mutes it everywhere, rather than needing separate Slack-specific
// preferences.
async function sendSlackNotification(userId, type, title, body){
  try{
    const { data: { session } } = await supabaseClient.auth.getSession();
    const res = await fetch('/api/send-slack-message', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'dm', targetUserId: userId, notificationType: type, text: `*${title}*\n${body||''}` }),
    });
    const result = await res.json().catch(()=>({}));
    if(!res.ok || result.sent === false){
      // no_slack_id and muted are both normal, expected states, not
      // failures — only log those quietly. Anything else (Slack API
      // error, bot token missing) is worth a louder signal.
      if(result.reason === 'no_slack_id' || result.reason === 'muted' || result.reason === 'not_configured'){
        console.log(`Slack DM skipped (${result.reason}) for userId: ${userId}`);
      } else {
        console.error('Slack DM failed:', result.reason || result.error || res.status);
      }
    }
  }catch(e){ console.error('Slack DM request failed:', e); }
}

// Best-effort OS push alongside the in-app notification above — runs on
// the sender's browser, trying to reach the recipient's device. Not
// awaited by the caller (the in-app notification above is the primary,
// reliable mechanism), but the response IS read now, unlike before —
// silently discarding it made every failure mode here invisible, including
// a fully misconfigured server. A recipient with no subscribed devices at
// all is normal/expected (not everyone opts into push), so that case is
// only logged, not surfaced as an error toast.
async function sendPushNotification(userId, title, body, url){
  try{
    const { data: { session } } = await supabaseClient.auth.getSession();
    const res = await fetch('/api/integrations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'push', action: 'send', targetUserId: userId, title, body, url: url || '/' }),
    });
    const result = await res.json().catch(()=>({}));
    if(!res.ok){
      console.error('Push notification failed:', result.error || res.status);
      showToast('error','Push notification failed', result.error || 'Check that VAPID keys are configured on the server.');
      return;
    }
    if(result.sent === 0 && result.failed === 0){
      console.log(`Push notification: recipient has no subscribed devices (userId: ${userId}). They likely haven't enabled push notifications on any device yet.`);
    } else if(result.failed > 0){
      console.warn(`Push notification: ${result.failed} device(s) failed to receive it, ${result.sent} succeeded.`);
    }
  }catch(e){ console.error('Push notification request failed:', e); }
}

async function loadNotifications(){
  if(!currentUser){ notifications = []; return; }
  const { data, error } = await supabaseClient.from('notifications').select('*').eq('user_id', currentUser.id).order('created_at', { ascending:false }).limit(50);
  if(error){ console.error('loadNotifications error', error); notifications = []; return; }
  notifications = (data || []).filter(n => n.type !== 'weekly_focus_report');   // the weekly report was removed
  updateNotifBadge();
}

// A dot on the bell, no number: red when something's urgent, yellow when something waits on you,
// blue for news (notifSeverity in helpers.js). The count is in the button's label.
function updateNotifBadge(){
  const badge = document.getElementById('notifBadge');
  if(!badge) return;
  const unread = notifications.filter(n=>!n.read).length, sev = notifTopSeverity(notifications);
  badge.textContent = '';
  badge.className = 'notif-badge' + (sev ? ' is-' + sev : '');
  badge.style.display = unread ? 'block' : 'none';
  const btn = badge.closest('button');
  if(btn){
    const label = unread ? `Notifications: ${unread} unread${sev === 'red' ? ', something urgent' : sev === 'yellow' ? ', something waiting on you' : ''}` : 'Notifications';
    btn.setAttribute('aria-label', label); btn.title = label;
  }
}

// The bell sits at the foot of the sidebar, beside your name, so its panel opens upward from it
// (floating over the page, like your menu) and goes back down into it when it closes.
function toggleNotifPanel(){
  const panel = document.getElementById('notifPanel');
  if(!panel) return;
  const opening = panel.style.display !== 'block' || panel.dataset.leaving;
  if(!opening){ hidePop(panel); return; }
  if(typeof closeSidebarProfileMenu === 'function') closeSidebarProfileMenu();
  const btn = document.querySelector('.notif-bell-btn');
  if(panel.parentElement !== document.body) document.body.appendChild(panel);
  panel.getAnimations?.().forEach(a => a.cancel()); delete panel.dataset.leaving;
  panel.dataset.from = 'below';
  panel.style.display = 'block';
  renderNotifPanel();
  if(btn){
    const r = btn.getBoundingClientRect(), w = panel.offsetWidth;
    panel.style.left = Math.round(Math.max(8, Math.min(r.left - 6, window.innerWidth - w - 8))) + 'px';
    panel.style.bottom = Math.round(window.innerHeight - r.top + 6) + 'px';
    panel.style.transformOrigin = `${Math.round(r.left + r.width / 2 - parseFloat(panel.style.left))}px 100%`;
  }
  if(typeof motionOK === 'function' && motionOK()) panel.animate?.([{ opacity: 0, transform: 'translateY(4px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: EASE_OUT });
}

document.addEventListener('click', (e)=>{
  const btn = document.querySelector('.notif-bell-btn');
  const panel = document.getElementById('notifPanel');
  if(panel && panel.style.display==='block' && !panel.dataset.leaving && !(btn && btn.contains(e.target)) && !panel.contains(e.target)) hidePop(panel);
});
document.addEventListener('keydown', (e)=>{
  const panel = document.getElementById('notifPanel');
  if(e.key === 'Escape' && panel && panel.style.display === 'block' && !panel.dataset.leaving){ e.stopPropagation(); hidePop(panel); document.querySelector('.notif-bell-btn')?.focus(); }
}, true);
window.addEventListener('resize', () => { const p = document.getElementById('notifPanel'); if(p && p.style.display === 'block') hidePop(p); });

function renderNotifPanel(){
  const el = document.getElementById('notifPanelList');
  if(!el) return;
  if(!notifications.length){ el.innerHTML = `<div class="empty" style="padding:24px;">No notifications yet.</div>`; return; }
  el.innerHTML = notifications.map(n=>`
    <div class="notif-row ${n.read?'':'unread'}">
      <div class="notif-row-dot"></div>
      <div style="flex:1;cursor:pointer;" onclick="handleNotifClick('${n.id}')">
        <div class="notif-row-title">${sanitizeInlineHtml(n.title)}</div>
        ${n.body ? `<div class="notif-row-body">${sanitizeInlineHtml(n.body)}</div>` : ''}
        <div class="notif-row-time">${new Date(n.created_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</div>
      </div>
      <button class="notif-row-delete" onclick="event.stopPropagation();deleteNotification('${n.id}')" title="Delete">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 11v6" /> <path d="M14 11v6" /> <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /> <path d="M3 6h18" /> <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
      </button>
    </div>`).join('');
}

async function deleteNotification(id){
  const { error } = await supabaseClient.from('notifications').delete().eq('id', id);
  if(error){ showToast('error','Could not delete', error.message); return; }
  notifications = notifications.filter(n=>n.id!==id);
  updateNotifBadge();
  renderNotifPanel();
}

async function clearAllNotifications(){
  if(!notifications.length) return;
  if(!(await confirmDialog('Clear all notifications? This can\'t be undone.', {confirmLabel:'Clear all', destructive:true}))) return;
  const { error } = await supabaseClient.from('notifications').delete().eq('user_id', currentUser.id);
  if(error){ showToast('error','Could not clear notifications', error.message); return; }
  notifications = [];
  updateNotifBadge();
  renderNotifPanel();
}

async function handleNotifClick(id){
  const n = notifications.find(x=>x.id===id);
  if(!n) return;
  if(!n.read){
    await supabaseClient.from('notifications').update({ read:true }).eq('id', id);
    n.read = true;
    updateNotifBadge();
    renderNotifPanel();
  }
  if(n.target_view==='client-detail' && n.target_id){
    hidePop(document.getElementById('notifPanel'));
    openClientDetail(n.target_id);
    return;
  }
  if(n.target_view==='clients' && n.target_id){
    hidePop(document.getElementById('notifPanel'));
    if(clients.some(c=>c.id===n.target_id && !c.deletedAt)) openClientInspectorFor(n.target_id);
    else switchView('clients');
    return;
  }
  // an update in Review: open it there (yours first if you wrote one for that client)
  if(n.target_view==='teamqueue' && n.target_id && typeof reviewItems === 'function' && typeof openReviewDraft === 'function'){
    const me = myName(), all = Object.values(reviewItems()).flat().filter(x => x.c.id === n.target_id);
    const x = (!canApprove() && all.find(y => y.d.author === me)) || all[0];
    if(x){ hidePop(document.getElementById('notifPanel')); openReviewDraft(x.c.id, x.d.author); return; }
  }
  if(n.target_view==='whatsapp' && n.target_id && typeof waOpenItem === 'function'){
    hidePop(document.getElementById('notifPanel'));
    waOpenItem(n.target_id); return;
  }
  if(n.target_view){
    hidePop(document.getElementById('notifPanel'));
    if(n.target_view==='plan' && n.target_id) window._planSel = n.target_id;
    switchView(n.target_view);
    if(n.target_view==='approve' && n.target_id && clients.find(c=>c.id===n.target_id)){
      openQueueCardModal(n.target_id);
    }
  }
}

async function markAllNotificationsRead(){
  const unreadIds = notifications.filter(n=>!n.read).map(n=>n.id);
  if(!unreadIds.length) return;
  await supabaseClient.from('notifications').update({ read:true }).in('id', unreadIds);
  notifications.forEach(n=>n.read=true);
  updateNotifBadge();
  renderNotifPanel();
}

// Toasts for anything new since we last checked — tracked per-user in
// localStorage rather than by read-status, so marking something read from
// the panel doesn't accidentally suppress its toast, and vice versa. On a
// person's very first-ever session there's nothing to compare against, so
// this just starts the clock instead of flooding them with toasts for
// their entire notification history.
async function checkForNewNotificationToasts(){
  if(!currentUser) return;
  const storageKey = `notif_last_checked_${currentUser.id}`;
  const lastChecked = localStorage.getItem(storageKey);
  const now = new Date().toISOString();
  if(!lastChecked){ localStorage.setItem(storageKey, now); return; }
  // Claimed immediately, before the async query below — this function can
  // genuinely get called twice in close succession (e.g. a push/Slack ping
  // arrives and the person switches to the tab right as it happens, firing
  // both the visibilitychange refresh and the live realtime handler for
  // the same event). Advancing the checkpoint synchronously here, rather
  // than only after the query resolves, means a second overlapping call
  // reads the already-updated value and correctly finds nothing new,
  // instead of both calls racing against the same stale timestamp and
  // both showing a toast for the same notification.
  localStorage.setItem(storageKey, now);
  const { data, error } = await supabaseClient.from('notifications').select('*')
    .eq('user_id', currentUser.id).eq('read', false).gt('created_at', lastChecked).order('created_at', { ascending:true });
  if(!error && data && data.length){
    if(typeof radarChime === 'function') radarChime();   // one chime for what just came in (Nov 23)
    data.forEach(n=>{
      const type = n.type.includes('denied') ? 'error' : n.type.includes('approved') ? 'success' : 'info';
      // a meeting about to start: the toast has Join (Nov 23)
      const ev = n.type === 'meeting_soon' && typeof calendarEvents !== 'undefined' ? calendarEvents.find(e => String(e.id) === String(n.target_id)) : null;
      const m = ev && typeof meetingLink === 'function' ? meetingLink(ev) : null;
      showToast(type, n.title, n.body || '', m ? { action: 'Join', onAction: () => window.open(m.url, '_blank', 'noopener'), duration: 20000 } : undefined);
    });
  }
}
