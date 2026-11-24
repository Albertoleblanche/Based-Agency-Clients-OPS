// Task nudges (Nov 24): Radar reminds you about your own tasks while you work, so nothing due slips.
// In Radar only (the bell, and a note on screen with Open); a high-priority task also goes to Slack
// and your phone. Weekdays, once a day each, on whichever device is open first:
//   • from 9:00   the morning list: what's due today                      (task_due)
//   • from 10:00  what's past its due date and still open                 (task_overdue)
//   • from 16:00  before you wrap up: what's due today and still not done (task_wrap_up)
// Each can be muted in Settings → Notifications. Nothing here is about what you did yourself.
const NUDGE_FROM = { task_due: 9, task_overdue: 10, task_wrap_up: 16 };
let nudgeBusy = false, nudgeStarted = false;

function nudgeMine(){
  if(typeof tasks === 'undefined' || !Array.isArray(tasks) || !currentUser) return [];
  return tasks.filter(t => t.assigneeId === currentUser.id && !t.cancelledAt && t.status !== 'done' && !t.hiddenByAssignee);
}
function nudgeClient(t){ const c = t.clientId && typeof clients !== 'undefined' ? clients.find(x => x.id === t.clientId) : null; return c ? c.name : ''; }
// "Fix the quote form (Brightway Electric)"; past due ones say when they were due
function nudgeLine(t, withDue){
  const c = nudgeClient(t), due = withDue && t.dueDate ? `, due ${fmtDay(new Date(t.dueDate + 'T12:00:00'))}` : '';
  return `${t.title}${c || due ? ` (${[c, due.replace(/^, /, '')].filter(Boolean).join(', ')})` : ''}`;
}
function nudgeWords(type, list){
  const first = (typeof myName === 'function' && myName() ? myName() : '').split(' ')[0] || 'Hey';
  const n = list.length, one = n === 1 ? list[0] : null;
  const lines = list.slice(0, 4).map(t => nudgeLine(t, type === 'task_overdue')).join(' · ') + (n > 4 ? ` · and ${n - 4} more` : '');
  // one task: the title says which, the body says for whom and what to do (no repeating it)
  const c = one ? nudgeClient(one) : '', wasDue = one && one.dueDate ? fmtDay(new Date(one.dueDate + 'T12:00:00')) : '';
  if(type === 'task_due') return { title: one ? `${first}, due today: ${one.title}` : `${first}, ${n} tasks are due today`, body: one ? (c ? `For ${c}.` : '') : lines };
  if(type === 'task_overdue') return { title: one ? `${first}, “${one.title}” is past due` : `${first}, ${n} tasks are past due`, body: one ? `${[c, wasDue ? 'due ' + wasDue : ''].filter(Boolean).join(', ').replace(/^./, x => x.toUpperCase())}${c || wasDue ? '. ' : ''}Finish it or give it a new date.` : lines };
  return { title: one ? `${first}, still open for today: ${one.title}` : `${first}, ${n} tasks for today aren’t done yet`, body: one ? `Before you wrap up: finish it${c ? ` for ${c}` : ''} or give it a new date.` : `Before you wrap up: ${lines}` };
}
async function sendTaskNudge(type, list){
  const me = (teamProfiles || []).find(p => p.id === currentUser.id), muted = (me && me.muted_notification_types) || [];
  if(muted.includes(type)) return false;
  const { title, body } = nudgeWords(type, list);
  const target = list.length === 1 ? list[0].id : null;
  if(!muted.includes('app:' + type)){
    const row = { user_id: currentUser.id, type, title, body, target_view: 'tasks', read: false };
    if(target) row.target_id = target;
    const { data: made, error } = await supabaseClient.from('notifications').insert(row).select('id, created_at').single();
    if(error) return false;
    // another computer sent the same one at the same moment: keep the first, drop this one
    if(made && made.id){
      const { data: same } = await supabaseClient.from('notifications').select('id, created_at').eq('user_id', currentUser.id).eq('type', type)
        .gte('created_at', dayStart(new Date()).toISOString()).order('created_at', { ascending: true }).order('id', { ascending: true });
      if(same && same.length > 1 && same[0].id !== made.id){ await supabaseClient.from('notifications').delete().eq('id', made.id); return false; }
    }
  }
  // urgent: a high-priority task in it goes to your phone and Slack too
  if(list.some(t => t.priority === 'high')){
    if(!muted.includes('push:' + type) && typeof sendPushNotification === 'function') sendPushNotification(currentUser.id, title, body, typeof notificationUrl === 'function' ? notificationUrl('tasks', target) : '/');
    if(!muted.includes('slack:' + type) && typeof sendSlackNotification === 'function') sendSlackNotification(currentUser.id, type, title, body);
  }
  return true;
}
async function runTaskNudges(){
  if(nudgeBusy || !currentUser || typeof tasksDataLoaded === 'undefined' || !tasksDataLoaded) return;
  const now = new Date(), wd = now.getDay();
  if(wd === 0 || wd === 6) return;
  const h = now.getHours(), today = toDateStr(now), mine = nudgeMine();
  const due = mine.filter(t => t.dueDate === today), late = mine.filter(t => t.dueDate && t.dueDate < today);
  const plan = [];
  if(h >= NUDGE_FROM.task_due && h < NUDGE_FROM.task_wrap_up && due.length) plan.push(['task_due', due]);
  if(h >= NUDGE_FROM.task_overdue && late.length) plan.push(['task_overdue', late]);
  if(h >= NUDGE_FROM.task_wrap_up && h < 21 && due.length) plan.push(['task_wrap_up', due]);
  if(!plan.length) return;
  // one tab at a time in this browser (each open tab checks)
  try{ const k = 'nudge-lock-' + currentUser.id, at = Number(localStorage.getItem(k) || 0); if(Date.now() - at < 60000) return; localStorage.setItem(k, String(Date.now())); }catch(e){}
  nudgeBusy = true;
  try {
    // once a day each, on any device: what you were already told today
    const { data, error } = await supabaseClient.from('notifications').select('type').eq('user_id', currentUser.id)
      .in('type', plan.map(p => p[0])).gte('created_at', dayStart(now).toISOString());
    if(error) return;
    const had = new Set((data || []).map(r => r.type));
    let sent = 0;
    for(const [type, list] of plan) if(!had.has(type) && await sendTaskNudge(type, list)) sent++;
    if(sent){
      if(typeof loadNotifications === 'function') await loadNotifications();
      if(typeof checkForNewNotificationToasts === 'function') await checkForNewNotificationToasts();
    }
  } finally { nudgeBusy = false; }
}
// Every 10 minutes while Radar is open, and when you come back to it
function startTaskNudges(){
  if(nudgeStarted) return;
  nudgeStarted = true;
  setTimeout(runTaskNudges, 15000);
  setInterval(runTaskNudges, 10 * 60000);
  document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible') setTimeout(runTaskNudges, 3000); });
}
startTaskNudges();
