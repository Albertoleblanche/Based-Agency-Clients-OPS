// Claude inside Radar (Nov 25), the parts the desktop and the iPhone share: Claude's mark, whether you
// can use it (the Assistant is on in your team card), the server call (lib/claude-radar.js, on the
// agency's Claude key; what you ask for counts toward the Assistant's 40 a day) and Today's Plan.
const CLAUDE_SPARK = '<svg class="cl-spark" viewBox="0 0 126 125" aria-hidden="true" focusable="false"><path fill="currentColor" d="m54.375 118.75 1.75-7.75 2-10 1.625-8 1.5-9.875.875-3.25-.125-.25-.625.125-7.5 10.25L42.5 105.375l-9 9.5-2.125.875-3.75-1.875.375-3.5 2.125-3L42.5 91.5l7.5-9.875L54.875 76l-.125-.75h-.25l-33 21.5-5.875.75L13 95.125l.375-3.875 1.25-1.25 9.875-6.875 24.625-13.75.375-1.25-.375-.625h-1.25l-4.125-.25-14-.375-12.125-.5L5.75 65.75l-3-.625L0 61.375.25 59.5l2.5-1.625 3.625.25 7.875.625 11.875.75 8.625.5 12.75 1.375h2l.25-.875-.625-.5-.5-.5-12.375-8.25L23 42.5l-7-5.125-3.75-2.625-1.875-2.375-.75-5.25L13 23.375l4.625.375 1.125.25 4.625 3.625 9.875 7.625 13 9.625 1.875 1.5.875-.5V45.5l-.875-1.375-7-12.75-7.5-13L30.25 13l-.875-3.25q-.5-1.687-.5-3.75L32.75.75 34.875 0l5.25.75 2.125 1.875L45.5 10l5.125 11.625 8.125 15.75 2.375 4.75 1.25 4.25.5 1.375h.875V47l.625-9 1.25-10.875 1.25-14 .375-4 2-4.75 3.875-2.5 3 1.375 2.5 3.625-.375 2.25-1.375 9.625-3 15.125L72 44.125h1.125l1.25-1.375L79.5 36l8.625-10.75 3.75-4.25 4.5-4.75L99.25 14h5.375l3.875 5.875L106.75 26l-5.5 7-4.625 5.875L90 47.75l-4 7.125.375.5h.875l14.875-3.25 8.125-1.375 9.5-1.625 4.375 2 .5 2-1.75 4.25-10.25 2.5-12 2.375L82.75 66.5l-.25.125.25.375 8 .75 3.5.25h8.5l15.75 1.125 4.125 2.75 2.375 3.25-.375 2.625-6.375 3.125-8.5-2-20-4.75L83 72.5h-1v.5l5.75 5.625L98.125 88l13.125 12.125.625 3-1.625 2.5-1.75-.25-11.5-8.75-4.5-3.875-10-8.375h-.625v.875l2.25 3.375L96.375 107l.625 5.625-.875 1.75-3.25 1.125-3.375-.625-7.25-10L74.875 93.5l-6-10.125-.625.5-3.625 37.75L63 123.5l-3.75 1.5-3.125-2.375z"/></svg>';
function claudeOn(){ return typeof myProfile !== 'undefined' && !!(myProfile && myProfile.ai_chat_enabled); }
// Settings → AI → Claude in Radar: each on unless an admin turned it off
function claudeDayPlanOn(){ return claudeOn() && !(typeof settings !== 'undefined' && settings && settings.claudeDayPlan === false); }
async function claudeApi(body){
  const r = await fetch(body ? '/api/integrations' : '/api/integrations?provider=claude', {
    method: body ? 'POST' : 'GET', headers: await apiAuthHeaders(), body: body ? JSON.stringify({ provider: 'claude', ...body }) : undefined });
  let data = null; try{ data = await r.json(); }catch(e){}
  // the server's own reason; otherwise what the answer itself says (Vercel stopped it, or it never came)
  if(data && data.error) return { error: data.error };
  if(!r.ok || !data) return { error: r.status === 504 ? 'Claude took too long to answer. Try again in a moment.' : `Radar’s server didn’t answer (${r.status}). Try again in a moment.` };
  return data;
}

// Today's Plan: each weekday morning Claude writes it (lib/claude-radar.js); the Dashboard's toolbar,
// the corner ring (day-plan.js) and the iPhone's Today read it from here.
let dayPlan = { at: 0 };   // { plan, date, last } from the server, or { loading } / { error }
async function loadDayPlan(force){
  if(!claudeDayPlanOn() || dayPlan.loading || (!force && dayPlan.at && Date.now() - dayPlan.at < 5 * 60000)) return dayPlan;
  dayPlan = { ...dayPlan, loading: true };
  const r = await claudeApi();
  dayPlan = r.error ? { error: r.error, at: Date.now() } : { ...r, at: Date.now() };
  if(typeof currentViewName !== 'undefined' && currentViewName === 'overview' && typeof setToolbarActions === 'function') setToolbarActions('overview');
  if(typeof dayPlanRedraw === 'function') dayPlanRedraw();
  if(typeof mDayPlanLoaded === 'function') mDayPlanLoaded();
  return dayPlan;
}
function dayPlanSeenKey(){ return `bda_dayplan_seen_${currentUser ? currentUser.id : ''}`; }

// ---- Today's Plan: what's done (Nov 25, v3) ------------------------------------------------------
// Worked out from what Radar already knows, so nothing needs ticking: a move is done when all its tasks
// are done (or its WhatsApp requests), or when you marked it (only moves with nothing to check); a
// follow-up when it's sent (its follow-up day moved on) or answered; your part of a win update when it's
// in Review. Shared by the corner ring and the sheet (desktop) and the iPhone's card.
function dayPlanV3(){ const p = dayPlan.plan; return p && p.v === 3 && !p.empty ? p : null; }
function dpMarkKey(){ const p = dayPlan.plan; return `bda_dp_marked_${currentUser ? currentUser.id : ''}_${p ? p.date : ''}`; }
function dpMarked(){ try{ return JSON.parse(localStorage.getItem(dpMarkKey()) || '[]'); }catch(e){ return []; } }
function dpSetMarked(id, on){ const s = new Set(dpMarked()); if(on) s.add(id); else s.delete(id); try{ localStorage.setItem(dpMarkKey(), JSON.stringify([...s])); }catch(e){} }
function dayPlanItems(){
  const p = dayPlanV3(); if(!p) return [];
  const marked = new Set(dpMarked());
  const T = typeof tasks !== 'undefined' ? tasks || [] : [], WA = typeof waTasks !== 'undefined' ? waTasks || [] : [];
  const R = typeof clientReminders !== 'undefined' ? clientReminders || [] : [], C = typeof clients !== 'undefined' ? clients || [] : [];
  const items = (p.moves || []).map(m => {
    const ts = (m.taskIds || []).map(id => T.find(t => String(t.id) === String(id))).filter(Boolean);
    const ws = (m.waIds || []).map(id => WA.find(w => String(w.id) === String(id))).filter(Boolean);
    const parts = ts.length + ws.length, partsDone = ts.filter(t => t.status === 'done').length + ws.filter(w => w.status && w.status !== 'open').length;
    // nothing Radar can check right now (no tasks, or ones it can't see): you mark it yourself
    return { id: m.id, kind: 'move', title: m.title, when: m.when, minutes: m.minutes, why: m.why, doneLine: m.doneLine, clientId: m.clientId, m, tasks: ts, wa: ws,
      parts, partsDone, canMark: !parts, done: (parts > 0 && partsDone === parts) || marked.has(m.id) };
  });
  (p.followUps || []).forEach(f => {
    const r = R.find(x => x.id === f.reminderId);
    items.push({ id: 'f:' + f.reminderId, kind: 'follow', title: `Follow up with ${f.client}`, sub: f.ask, clientId: f.clientId, f,
      done: marked.has('f:' + f.reminderId) || !!(r && (r.status !== 'waiting' || (r.followUpDate && r.followUpDate > p.date))), doneLine: `Follow-up on its way to ${f.client}.` });
  });
  (p.wins || []).forEach(w => {
    const c = C.find(x => x.id === w.clientId), d = c && typeof getDraftFor === 'function' && typeof myName === 'function' ? getDraftFor(c, myName()) : null;
    items.push({ id: 'w:' + w.clientId, kind: 'win', title: `${w.client}’s win update`, sub: `${w.wins} win${w.wins === 1 ? '' : 's'}`, clientId: w.clientId, w,
      done: marked.has('w:' + w.clientId) || !!(d && (d.readyToNotify || d.draftStatus === 'approved' || d.draftSentAt)), doneLine: `${w.client}’s update is in Review.` });
  });
  return items;
}
// A clock time in the team's time zone on the plan's day, as a Date (to show it in your own time)
function dpTeamTime(hm, date){
  const tz = (typeof settings !== 'undefined' && settings && settings.timezone) || 'America/New_York';
  const [y, mo, d] = String(date || '').split('-').map(Number), [h, mi] = String(hm || '').split(':').map(Number);
  if(!y || isNaN(h)) return null;
  const want = Date.UTC(y, mo - 1, d, h, mi || 0); let t = want;
  for(let i = 0; i < 2; i++){
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(t));
    const g = k => Number((parts.find(x => x.type === k) || {}).value);
    t += want - Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'));
  }
  return new Date(t);
}
