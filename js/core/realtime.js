// Live updates (Supabase realtime channels), fullRefresh() and renderAll().

/* ---------- Realtime — replaces the old 20-second poll-everything loop.
   Instead of reloading and re-rendering the whole app on a timer regardless
   of whether anything changed, each table gets its own subscription that
   only fires — and only re-renders the section that data actually affects —
   when something real happens to it. Debounced per table so a burst of
   several quick changes (e.g. logging 3 improvements in a row) coalesces
   into one reload instead of three. */
let realtimeChannel = null;
let activityChannel = null; // team_activity_log inserts — separate so a missing table can't affect the main channel
const realtimeDebounceTimers = {};

function debounced(key, fn, delay){
  return (...args)=>{
    clearTimeout(realtimeDebounceTimers[key]);
    realtimeDebounceTimers[key] = setTimeout(()=>fn(...args), delay);
  };
}

// Wraps a reload+render pair with the same silent-refresh suppression the
// old poll used, so a genuine realtime-driven update still doesn't replay
// entrance animations on cards that were already sitting there correctly.
async function silentSection(fn){
  document.body.classList.add('silent-refresh');
  try{ await fn(); }
  finally{ setTimeout(()=> document.body.classList.remove('silent-refresh'), 200); }
}

function setupRealtimeSubscriptions(){
  teardownRealtimeSubscriptions();
  if(!currentUser) return;

  const onAppStorageChange = debounced('appStorage', (payload)=>{
    // app_storage holds several distinct blobs in one table, keyed by
    // `key` — only react to the ones that actually feed rendered state.
    const changedKey = payload?.new?.key ?? payload?.old?.key;
    if(changedKey !== 'app-data' && changedKey !== 'settings') return;
    silentSection(async ()=>{
      await loadAll();
      renderKpis(); renderClientsTable(); renderQueue(); renderTeamQueue(); renderLog();
      renderAttentionList(); renderClientOptionsSelects(); renderOverviewChart();
      renderBudgetAlerts(); renderImprovementsHistory();
    });
  }, 400);

  const onNotesChange = debounced('notes', ()=>{
    silentSection(async ()=>{
      await loadMyNotes();
      populateNotesClientFilter();
      renderNotes();
    });
  }, 400);

  // clients/client_improvements used to be part of app_storage's app-data
  // blob (caught by onAppStorageChange above) before the migration to real
  // tables — this handler is what replaces that coverage. Without it, a
  // browser tab that was already open misses live updates entirely (a
  // teammate's new draft, a Ready to Notify click, an edited client) until
  // something else forces a reload, which is exactly why a stale
  // Team Queue badge could disagree with what the page actually shows.
  const onClientsChange = debounced('clients', ()=>{
    silentSection(async ()=>{
      await loadAll();
      renderKpis(); renderClientsTable(); renderQueue(); renderTeamQueue(); renderLog();
      renderAttentionList(); renderClientOptionsSelects(); renderOverviewChart();
      renderBudgetAlerts(); renderImprovementsHistory();
    });
  }, 400);

  const onTasksChange = debounced('tasks', ()=>{
    silentSection(async ()=>{
      await loadMyTasks();
      renderTasks();
      updateTasksNavBadge();
    });
  }, 400);

  const onTimeEntriesChange = debounced('timeEntries', ()=>{
    silentSection(async ()=>{
      await loadTimeEntries();
      populateTimeClientSelects();
      renderTimesheet();
      renderReports();
    });
  }, 400);

  const onCalendarChange = debounced('calendar', ()=>{
    silentSection(async ()=>{
      await loadCalendarEvents();
      renderCalendar();
    });
  }, 400);

  // Waiting on Client / overdue-follow-up badges live here — client_id,
  // clients table row, Team Queue cards, and the client-detail panel all
  // read from this same array, so a teammate resolving or adding a
  // reminder needs a fairly wide re-render, same reasoning as clients.
  const onRemindersChange = debounced('reminders', ()=>{
    silentSection(async ()=>{
      await loadClientReminders();
      renderReminders();
      renderClientsTable(); renderQueue(); renderTeamQueue();
      if(currentDetailClientId) renderClientDetail();
    });
  }, 400);

  // Roles, extra_permissions, names, avatars, mute preferences — none of
  // this was covered by realtime before, so a role/permission change (or
  // even just someone editing their own name) needed a manual reload to
  // show up anywhere, including for the person it happened to: their own
  // isAdmin()/canApprove()/hasPermission() checks stayed stale until then,
  // since those read myProfile, not teamProfiles.
  const onTeamProfilesChange = debounced('teamProfiles', ()=>{
    silentSection(async ()=>{
      await Promise.all([loadMyProfile(), loadTeamProfiles()]);
      applyRoleVisibility();
      renderTeam(); renderTeamQueue(); renderTasks(); renderNotificationPrefs();
      renderClientOptionsSelects();
    });
  }, 400);

  const onNotificationsChange = debounced('notifications', ()=>{
    loadNotifications().then(()=> checkForNewNotificationToasts());
  }, 300);

  let realtimeErrorToastShown = false;
  realtimeChannel = supabaseClient.channel('app-realtime-'+currentUser.id)
    .on('postgres_changes', { event:'*', schema:'public', table:'app_storage' }, onAppStorageChange)
    .on('postgres_changes', { event:'*', schema:'public', table:'clients' }, onClientsChange)
    .on('postgres_changes', { event:'*', schema:'public', table:'client_improvements' }, onClientsChange)
    // a win marked sent when Radar sees it in the client's WhatsApp group (addendum-weekly-wins.sql)
    .on('postgres_changes', { event:'*', schema:'public', table:'client_drafts' }, onClientsChange)
    .on('postgres_changes', { event:'*', schema:'public', table:'client_reminders' }, onRemindersChange)
    .on('postgres_changes', { event:'*', schema:'public', table:'team_profiles' }, onTeamProfilesChange)
    .on('postgres_changes', { event:'*', schema:'public', table:'notes' }, onNotesChange)
    .on('postgres_changes', { event:'*', schema:'public', table:'tasks' }, onTasksChange)
    .on('postgres_changes', { event:'*', schema:'public', table:'time_entries' }, onTimeEntriesChange)
    .on('postgres_changes', { event:'*', schema:'public', table:'calendar_events' }, onCalendarChange)
    .on('postgres_changes', { event:'*', schema:'public', table:'notifications' }, onNotificationsChange)
    .subscribe((status, err)=>{
      // Previously called bare, with no way to tell a genuine connection
      // failure (network issue, auth problem, channel error) apart from
      // it silently just... never connecting. Now it's visible.
      console.log('Realtime subscription status:', status, err || '');
      if((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && !realtimeErrorToastShown){
        realtimeErrorToastShown = true;
        showToast('info','Live updates are paused','Refresh the page to see new tasks and notifications as they come in.');
      }
    });
  if(activityTableAvailable !== false){
    activityChannel = supabaseClient.channel('activity-realtime-'+currentUser.id)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'team_activity_log' }, (payload)=>{
        const row = payload?.new;
        if(!row || log.some(e => e.id === row.id)) return;
        // Our own insert echoing back before its save call has returned —
        // persistAppData() will attach the id to the local entry.
        if(row.user_id === currentUser?.id && log.some(e => !e.id && e.text === row.text)) return;
        const entry = activityRowFromDb(row);
        const firstSaved = log.findIndex(e => e.id);
        if(firstSaved === -1) log.push(entry); else log.splice(firstSaved, 0, entry);
        if(log.length > ACTIVITY_LOG_LIMIT) log = log.slice(0, ACTIVITY_LOG_LIMIT);
        renderLog();
      })
      .subscribe();
  }
}

function teardownRealtimeSubscriptions(){
  if(realtimeChannel){ supabaseClient.removeChannel(realtimeChannel); realtimeChannel = null; }
  if(activityChannel){ supabaseClient.removeChannel(activityChannel); activityChannel = null; }
  Object.values(realtimeDebounceTimers).forEach(clearTimeout);
}

async function fullRefresh(showFeedback){
  const btn = document.getElementById('refreshBtn');
  const refreshIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /> <path d="M21 3v5h-5" /> <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /> <path d="M8 16H3v5" /></svg>';
  if(showFeedback && btn){ btn.disabled = true; btn.innerHTML = refreshIcon + ' Refreshing…'; }
  await loadAll();
  // Independent of each other (each only fills its own list), so they load
  // at the same time instead of one after another — this runs on every
  // screen switch, so it was six back-to-back round trips each time.
  await Promise.all([
    loadMyNotes(), loadTimeEntries(), loadMyTasks(),
    loadNotifications(), loadCalendarEvents(), loadClientReminders(),
    loadUpdateHistory(), loadHealthHandled(),
    typeof loadTaskDueTimes === 'function' ? loadTaskDueTimes() : null,
    typeof loadPlan === 'function' ? loadPlan() : null,
    typeof loadWaTasks === 'function' ? loadWaTasks() : null,
  ]);
  renderAll();
  updateTasksNavBadge();
  await checkForNewNotificationToasts();
  const syncEl = document.getElementById('sidebarSyncTime');
  if(syncEl) syncEl.textContent = new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
  if(showFeedback && btn){ btn.disabled = false; btn.innerHTML = refreshIcon + ' Refresh'; showToast('success','Synced','Loaded the latest data from the team.'); }
}
function renderAll(){ renderKpis(); renderClientsTable(); renderClientDetail(); renderQueue(); renderTeamQueue(); renderLog(); renderTeam(); renderAttentionList(); renderWhoAmI(); renderClientOptionsSelects(); applyRoleVisibility(); syncDarkModeToggleUI(); populateNotesClientFilter(); renderNotes(); populateTimeClientSelects(); renderOverviewChart(); renderBudgetAlerts(); renderImprovementsHistory(); renderTasks(); renderCalendar(); renderTimesheet(); renderTrash(); renderReminders(); if(typeof renderHealth === 'function') renderHealth(); if(typeof updateShellBadges === 'function') updateShellBadges(); if(typeof renderPlan === 'function') renderPlan(); }

function switchTrashTab(name){
  document.querySelectorAll('#trashTabsBar .icon-tab').forEach(t=>t.classList.toggle('active', t.dataset.ttab===name));
  document.querySelectorAll('#view-trash .settings-subview').forEach(v=>v.classList.remove('active'));
  document.getElementById('trashtab-'+name).classList.add('active');
}
