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
function activeClients(){ return clients.filter(c=>!c.deletedAt); }
function isClientPaused(clientId){
  const c = clients.find(x=>x.id===clientId);
  return !!(c && c.status==='Paused');
}
function showPausedClientWarning(clientId){
  const c = clients.find(x=>x.id===clientId);
  openAppModal(`
    <div class="modal-body" style="text-align:center;padding:8px 4px 4px;">
      <div style="width:44px;height:44px;border-radius:50%;background:var(--amber-bg);color:var(--amber);display:flex;align-items:center;justify-content:center;margin:0 auto 14px;">
        <svg width="22" height="22" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M200,32H160a16,16,0,0,0-16,16V208a16,16,0,0,0,16,16h40a16,16,0,0,0,16-16V48A16,16,0,0,0,200,32Zm0,176H160V48h40ZM96,32H56A16,16,0,0,0,40,48V208a16,16,0,0,0,16,16H96a16,16,0,0,0,16-16V48A16,16,0,0,0,96,32Zm0,176H56V48H96Z"/></svg>
      </div>
      <div style="font-size:16px;font-weight:600;color:var(--ink);margin-bottom:6px;">${c ? escapeHtml(c.name) : 'This client'} is on pause</div>
      <div style="font-size:14px;color:var(--muted-lt);line-height:1.5;max-width:320px;margin:0 auto;">There's nothing to log here right now — no active work means nothing to track. If that doesn't sound right, an admin can fill you in.</div>
    </div>
    <div class="modal-actions" style="justify-content:center;">
      <button class="btn btn-brand" onclick="closeAppModal()"><svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M200,32H160a16,16,0,0,0-16,16V208a16,16,0,0,0,16,16h40a16,16,0,0,0,16-16V48A16,16,0,0,0,200,32Zm0,176H160V48h40ZM96,32H56A16,16,0,0,0,40,48V208a16,16,0,0,0,16,16H96a16,16,0,0,0,16-16V48A16,16,0,0,0,96,32Zm0,176H56V48H96Z"/></svg>Sounds good</button>
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
    deletedAt:r.deleted_at||undefined, startDate:r.start_date||'',
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
  return { id:null, clientId:c.id, author, draft:'', draftStatus:'none', draftPendingSince:null, draftImprovementIds:[], draftSentAt:null, draftSentBy:'', readyToNotify:false };
}
// Upserts a (client, author) draft row and keeps c.drafts / clientDrafts in
// memory consistent with what was actually persisted — mirrors
// updateClientRow()'s role for the old single-slot fields, but scoped to
// one author's draft rather than the whole client.
async function saveDraftFor(clientId, author, fields){
  const c = clients.find(x=>x.id===clientId);
  const dbFields = {};
  const DRAFT_FIELD_DB_MAP = { draft:'draft', draftStatus:'draft_status', draftPendingSince:'draft_pending_since', draftImprovementIds:'draft_improvement_ids', draftSentAt:'draft_sent_at', draftSentBy:'draft_sent_by', readyToNotify:'ready_to_notify' };
  Object.keys(fields).forEach(k=>{ const col = DRAFT_FIELD_DB_MAP[k]; if(col) dbFields[col] = fields[k]; });
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
  return { id:r.id, clientId:r.client_id, author:r.author||'', text:r.text, date:r.date, includeInEmail:r.include_in_email, source:r.source };
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
async function insertImprovementRow(clientId, {author, text, includeInEmail=true, source}){
  const { data, error } = await supabaseClient.from('client_improvements')
    .insert({ client_id:clientId, author, text, include_in_email:includeInEmail, source })
    .select().single();
  if(error){ console.error('logImprovement failed', clientId, error); return null; }
  const entry = improvementRowFromDb(data);
  clientImprovements.push(entry);
  const c = clients.find(x=>x.id===clientId);
  if(c){ c.improvements = c.improvements || []; c.improvements.push(entry); }
  return entry;
}

// Real per-id delete — replaces splice-by-array-index (which needed a
// descending sort to avoid shifting indices mid-batch-delete, since the old
// JSON array entries had no stable id of their own).
async function deleteImprovementRow(id){
  // .select() after .delete() specifically to get back the row(s) that
  // were actually deleted — checking only `error` isn't enough here.
  // When an RLS policy silently blocks a delete, PostgREST doesn't return
  // an error at all: the request succeeds having affected zero rows. That
  // combination (no error, but nothing deleted) was going undetected here,
  // reporting success and removing the item locally while the row stayed
  // in the database — invisible until whatever fetched it fresh again
  // (a reload, the Team Queue) brought it right back.
  const { data, error } = await supabaseClient.from('client_improvements').delete().eq('id', id).select();
  if(error){ console.error('deleteImprovementRow failed', id, error); return false; }
  if(!data || !data.length){ console.error('deleteImprovementRow: delete affected 0 rows (likely blocked by RLS)', id); return false; }
  clientImprovements = clientImprovements.filter(i=>i.id!==id);
  clients.forEach(c=>{ if(c.improvements) c.improvements = c.improvements.filter(i=>i.id!==id); });
  return true;
}

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
