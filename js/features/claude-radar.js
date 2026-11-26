// Claude inside Radar (Nov 25), the parts the desktop and the iPhone share: Claude's mark, whether you
// can use it (the Assistant is on in your team card), the server call (lib/claude-radar.js, on the
// agency's Claude key; what you ask for counts toward the Assistant's 40 a day) and Today's Plan.
const CLAUDE_SPARK = '<svg class="cl-spark" viewBox="0 0 126 125" aria-hidden="true" focusable="false"><path fill="currentColor" d="m54.375 118.75 1.75-7.75 2-10 1.625-8 1.5-9.875.875-3.25-.125-.25-.625.125-7.5 10.25L42.5 105.375l-9 9.5-2.125.875-3.75-1.875.375-3.5 2.125-3L42.5 91.5l7.5-9.875L54.875 76l-.125-.75h-.25l-33 21.5-5.875.75L13 95.125l.375-3.875 1.25-1.25 9.875-6.875 24.625-13.75.375-1.25-.375-.625h-1.25l-4.125-.25-14-.375-12.125-.5L5.75 65.75l-3-.625L0 61.375.25 59.5l2.5-1.625 3.625.25 7.875.625 11.875.75 8.625.5 12.75 1.375h2l.25-.875-.625-.5-.5-.5-12.375-8.25L23 42.5l-7-5.125-3.75-2.625-1.875-2.375-.75-5.25L13 23.375l4.625.375 1.125.25 4.625 3.625 9.875 7.625 13 9.625 1.875 1.5.875-.5V45.5l-.875-1.375-7-12.75-7.5-13L30.25 13l-.875-3.25q-.5-1.687-.5-3.75L32.75.75 34.875 0l5.25.75 2.125 1.875L45.5 10l5.125 11.625 8.125 15.75 2.375 4.75 1.25 4.25.5 1.375h.875V47l.625-9 1.25-10.875 1.25-14 .375-4 2-4.75 3.875-2.5 3 1.375 2.5 3.625-.375 2.25-1.375 9.625-3 15.125L72 44.125h1.125l1.25-1.375L79.5 36l8.625-10.75 3.75-4.25 4.5-4.75L99.25 14h5.375l3.875 5.875L106.75 26l-5.5 7-4.625 5.875L90 47.75l-4 7.125.375.5h.875l14.875-3.25 8.125-1.375 9.5-1.625 4.375 2 .5 2-1.75 4.25-10.25 2.5-12 2.375L82.75 66.5l-.25.125.25.375 8 .75 3.5.25h8.5l15.75 1.125 4.125 2.75 2.375 3.25-.375 2.625-6.375 3.125-8.5-2-20-4.75L83 72.5h-1v.5l5.75 5.625L98.125 88l13.125 12.125.625 3-1.625 2.5-1.75-.25-11.5-8.75-4.5-3.875-10-8.375h-.625v.875l2.25 3.375L96.375 107l.625 5.625-.875 1.75-3.25 1.125-3.375-.625-7.25-10L74.875 93.5l-6-10.125-.625.5-3.625 37.75L63 123.5l-3.75 1.5-3.125-2.375z"/></svg>';
function claudeOn(){ return typeof myProfile !== 'undefined' && !!(myProfile && myProfile.ai_chat_enabled); }
async function claudeApi(body){
  const r = await fetch(body ? '/api/integrations' : '/api/integrations?provider=claude', {
    method: body ? 'POST' : 'GET', headers: await apiAuthHeaders(), body: body ? JSON.stringify({ provider: 'claude', ...body }) : undefined });
  let data = {}; try{ data = await r.json(); }catch(e){}
  if(!r.ok || data.error) return { error: data.error || 'Claude didn’t answer. Try again in a moment.' };
  return data;
}

// Today's Plan (Overview's toolbar): each weekday morning Claude writes it from your tasks, sprints,
// follow-ups, client emails and WhatsApp. Per client: the next step, what they owe us, a win to aim for.
let dayPlan = { at: 0 };   // { plan, date, last } from the server, or { loading } / { error }
async function loadDayPlan(force){
  if(!claudeOn() || dayPlan.loading || (!force && dayPlan.at && Date.now() - dayPlan.at < 5 * 60000)) return dayPlan;
  dayPlan = { ...dayPlan, loading: true };
  const r = await claudeApi();
  dayPlan = r.error ? { error: r.error, at: Date.now() } : { ...r, at: Date.now() };
  if(typeof currentViewName !== 'undefined' && currentViewName === 'overview' && typeof setToolbarActions === 'function') setToolbarActions('overview');
  if(typeof dayPlanRedraw === 'function') dayPlanRedraw();
  if(typeof mDayPlanLoaded === 'function') mDayPlanLoaded();
  return dayPlan;
}
function dayPlanSeenKey(){ return `bda_dayplan_seen_${currentUser ? currentUser.id : ''}`; }
