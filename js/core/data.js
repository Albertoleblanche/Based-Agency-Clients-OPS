// App-wide state, the Supabase client, row mappers for clients /
// improvements / drafts, and shared vs. personal storage helpers.

let clients = [];
let clientImprovements = []; // flat table now — hydrated onto each client's .improvements in loadAll()
let clientDrafts = []; // one row per (client, author) pair — hydrated onto each client's .drafts in loadAll(). See addendum-25.sql and getDraftFor()/saveDraftFor().
// Distinguishes "genuinely zero clients" from "the initial fetch just
// hasn't come back yet" — without this, renderClientsTable() couldn't
// tell the two apart, since clients starts as an empty array either way,
// and would show the misleading "No clients yet, add your first one"
// empty state during the loading window instead of a loading indicator.
let clientsDataLoaded = false;

// clients[] stays the full list (including soft-deleted) so historical
// lookups by id — old time entries, notes, activity log — still resolve a
// trashed client's name correctly. Anywhere building a list, dropdown, or
// aggregate for active work should use this instead.
//
// A client Radar added from Harvest waits for an approver to finish its info ("Needs setup",
// custom_field_values.harvestSetup = 'needed'). Until then it's left out of activeClients(), so
// This Week, Health, Today, Review and the counts don't count it; liveClients() includes it, for
// All Clients, search and the client pickers (time is still logged for it).
function clientInSetup(c){ return !!(c && c.customFieldValues && c.customFieldValues.harvestSetup === 'needed'); }
function activeClients(){ return clients.filter(c=>!c.deletedAt && !clientInSetup(c)); }
function liveClients(){ return clients.filter(c=>!c.deletedAt); }
// The person at the client that updates and wins greet by name ("Mike", "Mike and Sarah").
function clientContact(c){ return String((c && ((c.customFieldValues && c.customFieldValues.contact) || c.contactName || c.contact_name)) || '').trim(); }
function setupClients(){ return clients.filter(c=>!c.deletedAt && clientInSetup(c)); }
function isClientPaused(clientId){
  const c = clients.find(x=>x.id===clientId);
  return !!(c && c.status==='Paused');
}
function showPausedClientWarning(clientId){
  const c = clients.find(x=>x.id===clientId);
  openAppModal(`
    <div class="modal-body" style="text-align:center;padding:8px 4px 4px;">
      <div style="width:44px;height:44px;border-radius:50%;background:var(--amber-bg);color:var(--amber);display:flex;align-items:center;justify-content:center;margin:0 auto 14px;">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="14" y="3" width="5" height="18" rx="1" /> <rect x="5" y="3" width="5" height="18" rx="1" /></svg>
      </div>
      <div style="font-size:16px;font-weight:600;color:var(--ink);margin-bottom:6px;">${c ? escapeHtml(c.name) : 'This client'} is on pause</div>
      <div style="font-size:14px;color:var(--muted-lt);line-height:1.5;max-width:320px;margin:0 auto;">There's nothing to log here right now — no active work means nothing to track. If that doesn't sound right, an admin can fill you in.</div>
    </div>
    <div class="modal-actions" style="justify-content:center;">
      <button class="btn btn-brand" onclick="closeAppModal()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="14" y="3" width="5" height="18" rx="1" /> <rect x="5" y="3" width="5" height="18" rx="1" /></svg>Sounds good</button>
    </div>`, 380);
}
// Paused clients are still real clients (still listed, still selectable,
// still editable) — they just shouldn't pull attention toward doing new
// work on them. This is deliberately narrower than activeClients() and
// only used at the handful of places that actually signal "you should
// work on this" (Needs Attention, the Risk Breakdown ring, Client Health,
// pending-approval badges) — not at the many other activeClients() call
// sites like client-picker dropdowns or duplicate-name checks, where a
// paused client still needs to be findable.
function attentionEligibleClients(){ return activeClients().filter(c=>c.status!=='Paused'); }
let log = [];
let notes = [];
let notesDataLoaded = false;
let settings = {};
let team = [];
let editingClientId = null;
let queueFilter = 'all';
let teamQueueFilter = 'all';
let teamQueueClientFilter = 'all';
let teamQueueMemberFilter = 'all';
let teamQueueDangerFilter = '0';
let teamQueueImportanceFilter = '0';
let dateFilterMode = 'all';
let dateFilterFrom = getWeekStart(new Date()); // only consulted by non-"all" modes — see improvementInDateRange()
let dateFilterTo = null;   // inclusive, Date object
let teamDateFilterMode = 'all';
let teamDateFilterFrom = getWeekStart(new Date());
let teamDateFilterTo = null;
let slackClientChannels = {}; // client_id -> { channelId, channelName }
let slackChannelsLoaded = false;

async function loadSlackClientChannels(){
  const { data, error } = await supabaseClient.from('slack_client_channels').select('client_id, slack_channel_id, slack_channel_name');
  if(error){ slackChannelsLoaded = true; return; }
  slackClientChannels = {};
  (data||[]).forEach(row => { slackClientChannels[row.client_id] = { channelId: row.slack_channel_id, channelName: row.slack_channel_name }; });
  slackChannelsLoaded = true;
}

// ====== SUPABASE CONFIG — fill these in from Project Settings -> API ======
const SUPABASE_URL = 'https://rwhfddzitabeingajvuf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ3aGZkZHppdGFiZWluZ2FqdnVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzMTQ2NDUsImV4cCI6MjEwMDg5MDY0NX0.38FIw8GJRl47FcXxHNCExTLGkKlezEItF7TFdDOwmC8';
// ============================================================================
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: {
    // Without this, some browsers can serve a cached response for a
    // fetch() to the same URL — meaning after logging out and a different
    // person logging in on the same tab, they could briefly see the
    // previous user's data (e.g. an admin's full team view) until a hard
    // refresh forced the cache to clear. no-store stops that at the source.
    fetch: (url, options={}) => fetch(url, { ...options, cache: 'no-store' }),
  },
});

// Supabase sends at most 1000 rows for one request, so a table that can grow past that is read in
// pages. make() builds the query with a stable order; the result is { data, error } like a select.
async function selectAll(make, page){
  page = page || 1000;
  let rows = [];
  for(let from = 0; from < 200000; from += page){
    const { data, error } = await make().range(from, from + page - 1);
    if(error) return { data: from ? rows : null, error };
    rows = rows.concat(data || []);
    if(!data || data.length < page) break;
  }
  return { data: rows, error: null };
}

// ---- clients / client_improvements: real per-row tables (migrated off the
// app_storage JSON blob) — see schema-clients-migration.sql. Every other
// table already keyed off a client's id (notes, activity_log,
// client_reminders, etc.) still just stores that same text id, unchanged.
const CLIENT_FIELD_DB_MAP = {
  name:'name', email:'email', website:'website', service:'service', status:'status',
  importance:'importance', danger:'danger', monthlyHourBudget:'monthly_hour_budget',
  sow:'sow',
  lastProactiveCheckAt:'last_proactive_check_at', customFieldValues:'custom_field_values',
  deletedAt:'deleted_at', startDate:'start_date',
  // draft/draftStatus/draftPendingSince/draftImprovementIds/draftSentAt/
  // draftSentBy/readyToNotify used to live here — they've moved to
  // client_drafts (one row per client+author, see addendum-25.sql and
  // saveDraftFor()), since a single slot on the client itself couldn't
  // represent more than one team member's draft for the same client at
  // once. The old columns still exist on `clients` for safety, but nothing
  // in the app writes to them anymore.
};
function clientFieldsToDb(fields){
  const out = {};
  Object.keys(fields).forEach(k=>{ const col = CLIENT_FIELD_DB_MAP[k]; if(col) out[col] = fields[k]; });
  return out;
}
function clientRowFromDb(r){
  return {
    id:r.id, name:r.name, email:r.email||'', website:r.website||'', service:r.service, status:r.status,
    importance:r.importance, danger:r.danger, monthlyHourBudget:r.monthly_hour_budget||0, sow:r.sow||'',
    lastProactiveCheckAt:r.last_proactive_check_at, customFieldValues:r.custom_field_values||{},
    deletedAt:r.deleted_at||undefined, startDate:r.start_date||'', createdAt:r.created_at||null,
    improvements:[], // hydrated separately from clientImprovements
    drafts:[], // hydrated separately from clientDrafts — one entry per author who has ever had a draft for this client (see draftRowFromDb / getDraftFor)
  };
}
// One row per (client, author) pair — see addendum-25.sql. Replaces the old
// single-slot draft/draftStatus/etc. fields that used to live directly on
// the client row, which meant two people contributing to the same client
// would silently overwrite each other's in-progress draft.
function draftRowFromDb(r){
  return {
    id:r.id, clientId:r.client_id, author:r.author,
    draft:r.draft||'', draftStatus:r.draft_status||'none', draftPendingSince:r.draft_pending_since,
    draftImprovementIds: r.draft_improvement_ids || [],
    draftSentAt: r.draft_sent_at || null, draftSentBy: r.draft_sent_by || '',
    readyToNotify: !!r.ready_to_notify,
    // Weekly wins (addendum-weekly-wins.sql): the tier, how it went out, and who copied it for WhatsApp.
    winTier: r.win_tier || null, sentVia: r.sent_via || '', waCopiedBy: r.wa_copied_by || '', waCopiedAt: r.wa_copied_at || null,
    waSeenAt: r.wa_seen_at || null, approvedBy: r.approved_by || '', approvedAt: r.approved_at || null,
  };
}
// Returns the draft object for this (client, author) pair, or a fresh
// in-memory default if none has ever been saved for them yet — callers
// don't need to special-case "no draft row exists yet" everywhere, since
// generating the first draft for someone is exactly as valid as
// regenerating an existing one.
function getDraftFor(c, author){
  const existing = (c.drafts||[]).find(d => d.author === author);
  if(existing) return existing;
  return { id:null, clientId:c.id, author, draft:'', draftStatus:'none', draftPendingSince:null, draftImprovementIds:[], draftSentAt:null, draftSentBy:'', readyToNotify:false,
    winTier:null, sentVia:'', waCopiedBy:'', waCopiedAt:null, waSeenAt:null, approvedBy:'', approvedAt:null };
}
// Upserts a (client, author) draft row and keeps c.drafts / clientDrafts in
// memory consistent with what was actually persisted — mirrors
// updateClientRow()'s role for the old single-slot fields, but scoped to
// one author's draft rather than the whole client.
async function saveDraftFor(clientId, author, fields){
  const c = clients.find(x=>x.id===clientId);
  const dbFields = {};
  const DRAFT_FIELD_DB_MAP = { draft:'draft', draftStatus:'draft_status', draftPendingSince:'draft_pending_since', draftImprovementIds:'draft_improvement_ids', draftSentAt:'draft_sent_at', draftSentBy:'draft_sent_by', readyToNotify:'ready_to_notify' };
  // The weekly-wins columns only exist once addendum-weekly-wins.sql has run; until then they're left out.
  const WIN_FIELD_DB_MAP = { winTier:'win_tier', sentVia:'sent_via', waCopiedBy:'wa_copied_by', waCopiedAt:'wa_copied_at', waSeenAt:'wa_seen_at', approvedBy:'approved_by', approvedAt:'approved_at' };
  if(typeof winsDbReady === 'function' && winsDbReady()){
    Object.assign(DRAFT_FIELD_DB_MAP, WIN_FIELD_DB_MAP);
    // A new week's win starts clean: no tier, nobody sending it, not approved.
    // Back to pending (rewritten after approval): it needs approving, and copying, again.
    const fresh = 'draftSentAt' in fields && fields.draftSentAt === null;
    if(fresh || fields.draftStatus === 'pending' || fields.draftStatus === 'none'){
      fields = Object.assign({ waCopiedBy: '', waCopiedAt: null, waSeenAt: null, approvedBy: '', approvedAt: null }, fresh ? { winTier: null, sentVia: '' } : {}, fields);
    }
  }
  Object.keys(fields).forEach(k=>{ const col = DRAFT_FIELD_DB_MAP[k]; if(col) dbFields[col] = ['sentVia', 'winTier', 'waCopiedBy', 'approvedBy'].includes(k) && !fields[k] ? null : fields[k]; });
  const { data, error } = await supabaseClient.from('client_drafts')
    .upsert({ client_id: clientId, author, ...dbFields, updated_at: new Date().toISOString() }, { onConflict: 'client_id,author' })
    .select();
  if(error || !data || !data.length){
    if(error) console.error('saveDraftFor failed', clientId, author, error);
    else console.error('saveDraftFor: upsert affected 0 rows (likely blocked by RLS)', clientId, author);
    return false;
  }
  const saved = draftRowFromDb(data[0]);
  if(c){
    if(!c.drafts) c.drafts = [];
    const idx = c.drafts.findIndex(d=>d.author===author);
    if(idx===-1) c.drafts.push(saved); else c.drafts[idx] = saved;
  }
  const flatIdx = clientDrafts.findIndex(d=>d.clientId===clientId && d.author===author);
  if(flatIdx===-1) clientDrafts.push(saved); else clientDrafts[flatIdx] = saved;
  return true;
}
function improvementRowFromDb(r){
  return { id:r.id, clientId:r.client_id, author:r.author||'', text:r.text, date:r.date, includeInEmail:r.include_in_email, source:r.source,
    ...(r.deleted_at ? { deletedAt: r.deleted_at, deletedBy: r.deleted_by || null } : {}),
    createdAt: r.created_at || null, editedAt: r.edited_at || null, carryOver: !!r.carry_over };
}

// Real per-row update — replaces the old "mutate the roster array, then
// rewrite the whole app_storage blob" pattern. Only ever touches the one
// client row being changed, so two people editing two different clients at
// once can no longer silently clobber each other.
async function updateClientRow(id, fields){
  const { error } = await supabaseClient.from('clients').update(clientFieldsToDb(fields)).eq('id', id);
  if(error){ console.error('updateClientRow failed', id, error); return false; }
  return true;
}

// Inserts a real improvement row and keeps in-memory state (both the flat
// clientImprovements array and the hydrated c.improvements convenience
// array) in sync with what was actually persisted, rather than optimistically
// pushing a locally-built object that might not match what the DB assigned
// (e.g. its real id, its server-side default date). Named insertImprovementRow,
// not logImprovement — that name is already taken by the existing per-client
// "Log improvement" UI handler below.
async function insertImprovementRow(clientId, {author, text, includeInEmail=true, source, date}){
  const { data, error } = await supabaseClient.from('client_improvements')
    .insert({ client_id:clientId, author, text, include_in_email:includeInEmail, source, ...(date ? { date } : {}) })
    .select().single();
  if(error){ console.error('logImprovement failed', clientId, error); return null; }
  const entry = improvementRowFromDb(data);
  clientImprovements.push(entry);
  const c = clients.find(x=>x.id===clientId);
  if(c){ c.improvements = c.improvements || []; c.improvements.push(entry); }
  return entry;
}

// ---- Deleted work (Nov 21) ----------------------------------------------------------------------
// Deleting work moves it to Recently Deleted (client_improvements.deleted_at), and the time logged
// with it goes too (time_entries.improvement_id): off the timesheet, and out of Harvest at once.
// Deleting that time does the same in reverse. Restore brings both back and makes the time again in
// Harvest; Delete for Good removes both (nothing left to do in Harvest). Deleted work is gone from
// everything else. The people involved hear about it: a draft in review or approved that used the
// work goes back to its writer (they and the approvers are told), and someone else's work tells its
// owner. Work already in a sent update stays as sent. See addendum-deleted-work.sql; until it's run,
// deleting work removes it for good, as before.
let deletedWork = [];   // deleted work, kept for Recently Deleted
function setLoadedWork(rows){
  const all = (rows || []).map(improvementRowFromDb);
  clientImprovements = all.filter(i => !i.deletedAt);
  deletedWork = all.filter(i => i.deletedAt).sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
}
// What this person sees in Recently Deleted: their own work, and work they deleted.
function myDeletedWork(){
  const me = typeof myName === 'function' ? myName() : '', uid = typeof currentUser !== 'undefined' && currentUser ? currentUser.id : null;
  return deletedWork.filter(i => i.author === me || (uid && i.deletedBy === uid));
}
function workColumnMissing(error, col){
  const m = String((error && (error.message || error.details)) || '');
  return !!error && (error.code === 'PGRST204' || error.code === '42703') && (!col || m.includes(col));
}
function workCut(s, n){ s = String(s || ''); n = n || 80; return s.length > n ? s.slice(0, n) + '…' : s; }
function workHm(min){ min = Math.max(0, Math.round(min || 0)); return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`; }
function workProfile(name){ return (typeof teamProfiles !== 'undefined' ? teamProfiles : []).find(p => p.name === name && !p.access_revoked) || null; }
// The time on your timesheet logged with this work (only your own time is loaded here)
function workMinutes(ids){
  const set = new Set(ids);
  return (typeof timeEntries !== 'undefined' ? timeEntries : []).filter(e => e.improvementId && set.has(e.improvementId)).reduce((n, e) => n + (e.minutes || 0), 0);
}
// Drafts that used this work, as they are now: kind is written, review, approved or sent
function workDraftEffects(items){
  const out = [];
  (typeof clients !== 'undefined' ? clients : []).forEach(c => {
    const mine = items.filter(i => i.clientId === c.id);
    if(!mine.length) return;
    (c.drafts || []).forEach(d => {
      if(!d.draft) return;
      const ids = d.draftImprovementIds || [];
      const hit = ids.length ? mine.some(i => ids.includes(i.id))
        : !d.draftSentAt && mine.some(i => i.author === d.author && i.includeInEmail !== false);
      if(!hit) return;
      const kind = d.draftSentAt ? 'sent' : d.draftStatus === 'approved' ? 'approved'
        : d.draftStatus === 'pending' ? (d.readyToNotify ? 'review' : 'written') : null;
      if(kind) out.push({ c, d, kind });
    });
  });
  return out;
}
// The question before deleting: what goes, and what happens because of it. From the Timesheet
// (opts.fromTime), it starts from the time.
function workDeleteQuestion(items, opts){
  opts = opts || {};
  const me = typeof myName === 'function' ? myName() : '', n = items.length, it = n === 1 ? 'it' : 'them';
  const mins = workMinutes(items.map(i => i.id)), others = [...new Set(items.filter(i => i.author !== me).map(i => i.author))];
  const harvest = typeof hvTimeOn === 'function' && hvTimeOn() ? ' and out of Harvest' : '';
  const head = opts.fromTime
    ? `Delete this time and the work it was logged with, “${workCut(items[0].text)}”?`
    : `Delete ${n === 1 ? `“${workCut(items[0].text)}”` : `${n} work items`}?`;
  const notes = [];
  if(opts.fromTime) notes.push(`Both come off your timesheet${harvest}, and out of the client’s log.`);
  else if(mins) notes.push(`The ${workHm(mins)} logged with ${it} comes off your timesheet${harvest} too.`);
  else if(others.length) notes.push(`Any time logged with ${it} goes too.`);
  const fx = workDraftEffects(items), back = fx.filter(e => e.kind === 'review' || e.kind === 'approved'), sent = fx.filter(e => e.kind === 'sent');
  if(back.length > 2) notes.push(`${back.length} drafts in review or approved used ${it}, so they go back to their writers to rewrite, and they’re told.`);
  else back.forEach(({ d, kind }) => {
    const yours = d.author === me;
    notes.push(`${n === 1 ? 'It’s' : 'Some of it is'} in ${yours ? 'your' : `${firstName(d.author)}’s`} draft ${kind === 'review' ? 'in review' : 'that’s approved'}, so the draft goes back to ${yours ? 'you' : firstName(d.author)} to rewrite${yours ? '' : ', and they’re told'}.`);
  });
  if(fx.some(e => e.kind === 'written' && e.d.author === me) && !back.some(e => e.d.author === me)) notes.push(`${n === 1 ? 'It’s' : 'Some of it is'} in your draft, so the draft will need a rewrite.`);
  if(sent.length === 1) notes.push(`${n === 1 ? 'It was' : 'Some of it was'} in ${sent[0].d.author === me ? 'your' : `${firstName(sent[0].d.author)}’s`} update sent ${fmtShortDate(new Date(sent[0].d.draftSentAt))}; that email stays as sent.`);
  else if(sent.length) notes.push('Some of it was in updates already sent; those emails stay as sent.');
  if(others.length) notes.push(others.length > 3 ? 'Whoever logged it will be told.' : `${others.map(firstName).join(' and ')} will be told.`);
  notes.push(`You can restore ${opts.fromTime ? 'both' : it} from Recently Deleted.`);
  return `${head} ${notes.join(' ')}`;
}
// The time logged with the work moves with it. The server moves it (it may be someone else's) and
// keeps Harvest in step; if it can't be reached, your own time is moved from here.
async function workTimeMove(mode, ids){
  if(!ids.length) return;
  let done = false;
  try{
    const { data: { session } } = await supabaseClient.auth.getSession();
    if(session){
      const res = await fetch('/api/integrations', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'harvest', action: 'work-time', mode, improvementIds: ids }) });
      const j = await res.json().catch(() => ({}));
      done = res.ok && typeof j.moved === 'number';
    }
  }catch(e){ console.error('workTimeMove', mode, e); }
  if(!done && typeof currentUser !== 'undefined' && currentUser){
    const t = () => supabaseClient.from('time_entries'), uid = currentUser.id;
    if(mode === 'trash'){
      const { data } = await t().update({ deleted_at: new Date().toISOString() }).in('improvement_id', ids).eq('user_id', uid).is('deleted_at', null).select('id, harvest_entry_id');
      (data || []).filter(e => e.harvest_entry_id).forEach(e => workHarvest({ action: 'delete-entry', harvestEntryId: e.harvest_entry_id }));
    } else if(mode === 'restore'){
      const { data } = await t().update({ deleted_at: null, harvest_entry_id: null, harvest_sync_status: 'pending', harvest_sync_error: null })
        .in('improvement_id', ids).eq('user_id', uid).not('deleted_at', 'is', null).select('id');
      (data || []).forEach(e => workHarvest({ action: 'sync-entry', timeEntryId: e.id }));
    } else await t().delete().in('improvement_id', ids).eq('user_id', uid).not('deleted_at', 'is', null);
  }
  if(typeof loadTimeEntries === 'function') await loadTimeEntries();
}
function workHarvest(body){
  supabaseClient.auth.getSession().then(({ data: { session } }) => session && fetch('/api/integrations', { method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'harvest', ...body }) }).catch(() => {}));
}
// Moves the work to Recently Deleted. Returns { ok, moved, soft }.
async function trashWork(ids){
  const items = [...new Set(ids)].map(id => clientImprovements.find(i => i.id === id)).filter(Boolean);
  if(!items.length) return { ok: false, moved: [] };
  const effects = workDraftEffects(items);   // before: the drafts as they are now
  const now = new Date().toISOString(), uid = currentUser ? currentUser.id : null, idList = items.map(i => i.id);
  let soft = true;
  // .select() so a change blocked by a policy (no error, nothing changed) isn't taken for success
  let { data, error } = await supabaseClient.from('client_improvements').update({ deleted_at: now, deleted_by: uid }).in('id', idList).select('id');
  if(error && workColumnMissing(error)){
    soft = false;   // before addendum-deleted-work.sql: deleted for good, as before
    ({ data, error } = await supabaseClient.from('client_improvements').delete().in('id', idList).select('id'));
  }
  if(error){ console.error('trashWork failed', idList, error); return { ok: false, moved: [] }; }
  const gone = new Set((data || []).map(r => r.id));
  if(!gone.size){ console.error('trashWork: nothing changed (likely blocked by RLS)', idList); return { ok: false, moved: [] }; }
  const moved = items.filter(i => gone.has(i.id));
  clientImprovements = clientImprovements.filter(i => !gone.has(i.id));
  clients.forEach(c => { if(c.improvements) c.improvements = c.improvements.filter(i => !gone.has(i.id)); });
  if(soft){
    moved.forEach(i => { i.deletedAt = now; i.deletedBy = uid; });
    deletedWork = [...moved, ...deletedWork];
    await workTimeMove('trash', [...gone]);
  }
  await workAfterDelete(effects, moved, soft);
  return { ok: true, moved, soft };
}
// A draft in review or approved that used the work goes back to its writer; they and the approvers
// are told. Someone else's work tells its owner (once, with the draft news if they wrote it).
async function workAfterDelete(effects, moved, soft){
  const me = typeof myName === 'function' ? myName() : '', who = me || 'Someone', uid = currentUser ? currentUser.id : null;
  const tell = typeof sendNotification === 'function' ? sendNotification : null;
  const approvers = (typeof teamProfiles !== 'undefined' ? teamProfiles : []).filter(p => (p.role === 'admin' || p.role === 'approver') && p.id !== uid && !p.access_revoked);
  const told = new Set();
  const where = soft ? 'It’s in your Recently Deleted if you need it back.' : '';
  for(const { c, d, kind } of effects){
    if(kind !== 'review' && kind !== 'approved') continue;
    if(!(await saveDraftFor(c.id, d.author, kind === 'approved' ? { draftStatus: 'pending', readyToNotify: false } : { readyToNotify: false }))) continue;
    const theirs = moved.some(i => i.clientId === c.id && i.author === d.author);
    if(d.author === me){ if(typeof showToast === 'function') showToast('info', 'Your draft came back from Review', `You deleted work it was written from. Rewrite your ${c.name} draft from what’s logged now.`); }
    else {
      const p = workProfile(d.author);
      if(p && tell){ told.add(c.id + '|' + d.author);
        tell(p.id, 'draft_returned', `${c.name}: your draft came back to you`, `${who} deleted ${theirs ? 'your work' : 'work'} it was written from. ${theirs && where ? where + ' ' : ''}Rewrite it from what’s logged now.`, 'queue', c.id); }
    }
    if(tell) approvers.filter(p => p.name !== d.author).forEach(p => tell(p.id, 'draft_returned', `${c.name}: ${firstName(d.author)}’s draft went back to them`,
      `${who} deleted work it was written from, so it’s out of Review until it’s rewritten.`, 'approve', c.id));
  }
  if(!tell) return;
  const groups = new Map();
  moved.filter(i => i.author && i.author !== me).forEach(i => { const k = i.clientId + '|' + i.author; if(!told.has(k)) groups.set(k, [...(groups.get(k) || []), i]); });
  groups.forEach(list => {
    const p = workProfile(list[0].author), c = clients.find(x => x.id === list[0].clientId);
    if(!p) return;
    tell(p.id, 'work_deleted', `${who} deleted ${list.length === 1 ? 'your work' : `${list.length} of your work items`} for ${c ? c.name : 'a client'}`,
      `${list.length === 1 ? `“${workCut(list[0].text)}”, with the time logged with it. ` : 'With the time logged with them. '}${where}`, soft ? 'trash' : 'queue', null);
  });
}
// Work in an update that's sent for review or approved, and not sent yet, is locked until it's sent
// (Nov 21): what went for approval is what goes out. Edit, delete and the email switch say why
// instead, everywhere (Queue, client page, Past Improvements, the Timesheet).
function workLockedBy(imp){
  if(!imp) return null;
  const c = (typeof clients !== 'undefined' ? clients : []).find(x => x.id === imp.clientId);
  return ((c && c.drafts) || []).find(d => d.draft && !d.draftSentAt && (d.draftStatus === 'approved' || (d.draftStatus === 'pending' && d.readyToNotify))
    && (d.draftImprovementIds || []).includes(imp.id)) || null;
}
function workLockedWords(d){
  const me = typeof myName === 'function' ? myName() : '';
  return `It’s in ${d.author === me ? 'your' : `${firstName(d.author)}’s`} update ${d.draftStatus === 'approved' ? 'that’s approved' : 'in review'}, so it can’t change until that’s sent.`;
}
function workLockedToast(imp){ const d = workLockedBy(imp); if(d) showToast('info', 'Locked until it’s sent', workLockedWords(d)); return !!d; }

// One update per client (Nov 21): when it goes out, everyone whose work was in it hears, not just its
// writer. Desktop: in the app, by push and on Slack; the iPhone: in the app.
async function tellContributorsSent(c, d, via){
  if(!c || !d) return;
  const ids = new Set(d.draftImprovementIds || []), me = typeof myName === 'function' ? myName() : '';
  const names = [...new Set((c.improvements || []).filter(i => ids.has(i.id)).map(i => i.author))]
    .filter(n => n && n !== d.author && n !== me);
  for(const n of names){
    const p = workProfile(n); if(!p) continue;
    const title = `${c.name}: your work went out`, body = `It was in ${firstName(d.author)}’s update${via === 'whatsapp' ? ', in the WhatsApp group' : ''}.`;
    if(typeof sendNotification === 'function') await sendNotification(p.id, 'draft_sent', title, body, 'queue', c.id);
    else await supabaseClient.from('notifications').insert({ user_id: p.id, type: 'draft_sent', title, body, target_view: 'queue', target_id: c.id, read: false });
  }
}

// The same work logged twice (Nov 21): before logging, a near match for the client from the last 30
// days (same words, or nearly: 85% of the words shared, four or more of them) is shown, to log it
// anyway or not. Returns true to go ahead.
function workWords(t){ return String(t || '').toLowerCase().replace(/[^a-z0-9\u00c0-\u024f#%$ ]+/g, ' ').split(/\s+/).filter(Boolean); }
function workDuplicateOf(clientId, text){
  const a = workWords(text); if(!a.length) return null;
  const A = new Set(a), since = addDays(new Date(), -30);
  return (typeof clientImprovements !== 'undefined' ? clientImprovements : []).filter(i => i.clientId === clientId && new Date(i.date) >= since).find(i => {
    const b = workWords(i.text); if(b.join(' ') === a.join(' ')) return true;
    const B = new Set(b); if(A.size < 4 || B.size < 4) return false;
    let n = 0; A.forEach(x => { if(B.has(x)) n++; });
    return n / (A.size + B.size - n) >= 0.85;
  }) || null;
}
async function okToLogDuplicate(clientId, text){
  const dup = workDuplicateOf(clientId, text); if(!dup) return true;
  const c = clients.find(x => x.id === clientId), me = typeof myName === 'function' ? myName() : '';
  const who = dup.author === me ? 'You' : firstName(dup.author);
  return await confirmDialog(`${who} already logged this for ${c ? c.name : 'this client'} on ${fmtShortDate(new Date(dup.date))}: “${workCut(dup.text, 90)}”.`, { title: 'Log it again?', confirmLabel: 'Log It Again', cancelLabel: 'Don’t Log' });
}

// Saving changed words for a piece of work, with when (edited_at, addendum-flow-gaps.sql), so a draft
// written before the change can say so. Before that SQL, just the words. Returns { data, error }.
async function saveWorkText(impId, fields){
  const at = new Date().toISOString();
  let r = await supabaseClient.from('client_improvements').update({ ...fields, edited_at: at }).eq('id', impId).select();
  if(r.error && workColumnMissing(r.error, 'edited_at')) r = await supabaseClient.from('client_improvements').update(fields).eq('id', impId).select();
  else if(!r.error){ const i = clientImprovements.find(x => x.id === impId); if(i) i.editedAt = at; }
  return r;
}

// Asks, deletes, says what happened. Returns trashWork's result, or null when they said no.
async function deleteWorkAsk(ids, opts){
  opts = opts || {};
  const all = [...new Set(ids)].map(id => clientImprovements.find(i => i.id === id)).filter(Boolean);
  if(!all.length){ showToast('info', 'Already gone', 'That work was already deleted.'); return null; }
  // work in an update that's in review or approved stays put
  const items = all.filter(i => !workLockedBy(i)), kept = all.length - items.length;
  if(!items.length){ workLockedToast(all[0]); return null; }
  const q = workDeleteQuestion(items, opts) + (kept ? ` ${kept === 1 ? '1 item stays' : `${kept} items stay`}: ${kept === 1 ? 'it’s' : 'they’re'} in an update in review or approved, and can’t change until it’s sent.` : '');
  if(!(await confirmDialog(q, { confirmLabel: 'Delete', destructive: true }))) return null;
  const mins = workMinutes(items.map(i => i.id));
  const r = await trashWork(items.map(i => i.id));
  if(!r.ok){ showToast('error', 'Couldn’t delete it', 'Try again in a moment.'); return r; }
  const n = r.moved.length;
  if(typeof logClientActivity === 'function') r.moved.forEach(i => logClientActivity(i.clientId, 'improvement_deleted', `${myName() || 'Someone'} deleted an improvement — "${workCut(i.text)}"`));
  const back = r.moved.map(i => i.id);
  showToast('success', r.soft ? 'Moved to Recently Deleted' : 'Deleted', r.soft
    ? `${n === 1 ? `“${workCut(r.moved[0].text, 48)}”` : `${n} work items`}${mins ? `, with ${n === 1 ? 'its' : 'their'} ${workHm(mins)} of time` : ''}.` : 'Removed from the log.',
    r.soft ? { action: 'Undo', onAction: () => undoTrashWork(back) } : null);
  return r;
}
// Undo, from the toast after a delete: the work and its time come back (the time made again in Harvest).
async function undoTrashWork(ids){
  const r = await restoreWork(ids);
  if(typeof renderAll === 'function') renderAll();
  r.ok ? showToast('success', 'Restored', r.restored.length === 1 ? 'The work is back, with its time.' : `${r.restored.length} work items are back, with their time.`)
    : showToast('error', 'Couldn’t undo it', 'Restore it from Recently Deleted.');
}
// Brings deleted work back, with its time (made again in Harvest).
async function restoreWork(ids){
  const items = [...new Set(ids)].map(id => deletedWork.find(i => i.id === id)).filter(Boolean);
  if(!items.length) return { ok: false, restored: [] };
  const { data, error } = await supabaseClient.from('client_improvements').update({ deleted_at: null, deleted_by: null }).in('id', items.map(i => i.id)).select('id');
  if(error || !data || !data.length){ console.error('restoreWork failed', error); return { ok: false, restored: [] }; }
  const back = new Set(data.map(r => r.id)), restored = items.filter(i => back.has(i.id));
  deletedWork = deletedWork.filter(i => !back.has(i.id));
  const byDate = (a, b) => new Date(a.date) - new Date(b.date) || String(a.id).localeCompare(String(b.id));
  restored.forEach(i => {
    i.deletedAt = null; i.deletedBy = null; clientImprovements.push(i);
    const c = clients.find(x => x.id === i.clientId); if(c){ c.improvements = [...(c.improvements || []), i].sort(byDate); }
  });
  clientImprovements.sort(byDate);
  await workTimeMove('restore', [...back]);
  return { ok: true, restored };
}
// Delete for Good: the work and its time, both gone (the time already left Harvest).
async function deleteWorkForGood(ids){
  ids = [...new Set(ids)].filter(id => deletedWork.some(i => i.id === id));
  if(!ids.length) return false;
  await workTimeMove('forever', ids);
  const { data, error } = await supabaseClient.from('client_improvements').delete().in('id', ids).select('id');
  if(error){ console.error('deleteWorkForGood failed', error); return false; }
  const gone = new Set((data || []).map(r => r.id));
  deletedWork = deletedWork.filter(i => !gone.has(i.id));
  return gone.size > 0;
}
// One improvement, by id. Kept for older callers: deleting is moving to Recently Deleted now.
async function deleteImprovementRow(id){ return (await trashWork([id])).ok; }

// Shared (team-wide) storage — backed by Supabase, replaces window.storage.
async function safeGet(key){
  try{
    const { data, error } = await supabaseClient.from('app_storage').select('value').eq('key', key).maybeSingle();
    if(error) throw error;
    return data ? data.value : null;
  }catch(e){ console.error('storage get failed', key, e); return null; }
}
async function safeSet(key, value){
  try{
    const { error } = await supabaseClient.from('app_storage').upsert({ key, value }, { onConflict: 'key' });
    if(error) throw error;
    return true;
  }catch(e){ console.error('storage set failed', key, e); return false; }
}

// Personal (per-browser) storage — used for theme preference and "who am I."
// Outside of Claude's artifact sandbox there's no restriction on localStorage,
// so it's used here directly. Note this is per-BROWSER, not per-person like a
// real login would be — if that distinction matters, add real auth later.
async function safeGetPersonal(key){ try{ return localStorage.getItem('bda_'+key); }catch(e){ return null; } }
async function safeSetPersonal(key, value){ try{ localStorage.setItem('bda_'+key, value); return true; }catch(e){ return false; } }

// A WhatsApp item and the task made from it are one piece of work. When the task is finished,
// reopened, cancelled or deleted (here or on the iPhone), the item follows: 'done' closes it,
// 'open' reopens it, 'unlink' lets it be made into a task again. Quiet when WhatsApp isn't set up.
async function syncWaItemsForTask(taskId, change){
  if(!taskId) return 0;
  const patch = change === 'unlink' ? { task_id: null } : { status: change }, at = new Date().toISOString();
  let q = supabaseClient.from('wa_tasks').update({ ...patch, updated_at: at }).eq('task_id', taskId);
  if(change === 'done') q = q.eq('status', 'open'); else if(change === 'open') q = q.eq('status', 'done');
  let res;
  try { res = await q.select('id'); } catch(e){ return 0; }
  if(res.error || !res.data) return 0;
  const ids = new Set(res.data.map(r => String(r.id)));
  if(typeof waTasks !== 'undefined') waTasks.forEach(x => { if(ids.has(String(x.id))) Object.assign(x, patch, { updated_at: at }); });
  if(ids.size){
    if(typeof updateWaNavBadge === 'function') updateWaNavBadge();
    if(typeof currentViewName !== 'undefined' && currentViewName === 'whatsapp' && typeof renderWhatsapp === 'function') renderWhatsapp();
  }
  return ids.size;
}
