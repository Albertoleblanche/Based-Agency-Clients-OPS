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
// A Paused client isn't working with us right now (client-status.js): it shows nowhere but the paused
// clients' table (for the people who edit clients), and no time or work is logged for it. So
// activeClients() leaves it out, and the pickers and search use workClients(); radarClients() is every
// set-up client, paused or not, for matching names and the roster export.
function clientInSetup(c){ return !!(c && c.customFieldValues && c.customFieldValues.harvestSetup === 'needed'); }
function activeClients(){ return clients.filter(c=>!c.deletedAt && !clientInSetup(c) && c.status!=='Paused'); }
function radarClients(){ return clients.filter(c=>!c.deletedAt && !clientInSetup(c)); }
function liveClients(){ return clients.filter(c=>!c.deletedAt); }
// the clients to pick, search or log for: not deleted, not paused (keepId: the one already picked stays)
function workClients(keepId){ return clients.filter(c=>!c.deletedAt && (c.status!=='Paused' || (keepId != null && String(c.id) === String(keepId)))); }
// The person at the client that updates and wins greet by name ("Mike", "Mike and Sarah").
function clientContact(c){ return String((c && ((c.customFieldValues && c.customFieldValues.contact) || c.contactName || c.contact_name)) || '').trim(); }
// ---- Files on a task (Nov 23) ----
// Kept in the private 'attachments' bucket under tasks/<task id>/ and listed in tasks.attachments
// as { name, path, size, type, uploadedAt }, like notes. 10 MB a file at most.
const TASK_FILE_MAX = 10 * 1024 * 1024;
async function uploadTaskFiles(taskId, files){
  const added = [], failed = [];
  for(const f of [].slice.call(files || [])){
    if(f.size > TASK_FILE_MAX){ failed.push({ name: f.name, why: 'over 10 MB' }); continue; }
    const path = `tasks/${taskId}/${Date.now()}-${String(f.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const { error } = await supabaseClient.storage.from('attachments').upload(path, f, { contentType: f.type || undefined });
    if(error){ failed.push({ name: f.name, why: error.message }); continue; }
    added.push({ name: f.name, path, size: f.size, type: f.type || '', uploadedAt: new Date().toISOString() });
  }
  if(added.length){
    const { data: cur } = await supabaseClient.from('tasks').select('attachments').eq('id', taskId).maybeSingle();
    const { error } = await supabaseClient.from('tasks').update({ attachments: [...((cur && cur.attachments) || []), ...added] }).eq('id', taskId);
    if(error){
      try{ await supabaseClient.storage.from('attachments').remove(added.map(a => a.path)); }catch(e){}
      return { added: [], failed: failed.concat(added.map(a => ({ name: a.name, why: error.message }))) };
    }
  }
  return { added, failed };
}
async function removeTaskFiles(taskId, paths){
  if(!paths || !paths.length) return true;
  const { data: cur } = await supabaseClient.from('tasks').select('attachments').eq('id', taskId).maybeSingle();
  const { error } = await supabaseClient.from('tasks').update({ attachments: ((cur && cur.attachments) || []).filter(a => !paths.includes(a.path)) }).eq('id', taskId);
  if(!error){ try{ await supabaseClient.storage.from('attachments').remove(paths); }catch(e){} }
  return !error;
}
// What a failed upload says: a missing storage rule reads as a plain next step.
function taskFilesError(failed){
  const f = failed[0] || {}, rls = /row-level security|policy|not authorized|unauthorized|403/i.test(f.why || '');
  return rls ? 'Files on tasks need one setup step in Supabase: run addendum-task-files.sql.' : `${failed.map(x => x.name).join(', ')}: ${f.why || 'try again'}.`;
}

// ---- Focus (Nov 23) ----
// Clients the owner asked the team to give extra attention, on top of Importance. Approvers switch
// it on a client (its panel, client page, Edit Client, Bulk Edit); then, within every list and
// group, Focus clients come first, Health watches them closer (week-health.js), and the morning
// reminders and the Monday summary put them on top (lib/update-automations.js). Kept in the
// client's custom values: focus (true), focusAt and focusBy.
function isFocus(c){ return !!(c && c.customFieldValues && c.customFieldValues.focus); }
function isFocusId(id){ return !!id && typeof clients !== 'undefined' && isFocus(clients.find(c => c.id === id)); }
function focusFirst(a, b){ return (isFocus(b) ? 1 : 0) - (isFocus(a) ? 1 : 0); }
function focusIdFirst(a, b){ return (isFocusId(b) ? 1 : 0) - (isFocusId(a) ? 1 : 0); }
// a row of a mixed list: an update or note (x.c), a task (x.task) or anything with a clientId
function itemFocus(x){ return !!x && (isFocus(x.c) || !!(x.task && isFocusId(x.task.clientId)) || isFocusId(x.clientId)); }
function itemFocusFirst(a, b){ return (itemFocus(b) ? 1 : 0) - (itemFocus(a) ? 1 : 0); }
// What Focus means, in one place: the mark's tooltip, the client's Details and its toggle.
const FOCUS_WORDS = 'Focus client: the owner asked the team to give it extra attention. It comes first in every list, Health watches it more closely, and it leads the morning reminders and the Monday summary. Admins and approvers choose Focus clients.';
function focusMark(c){ return isFocus(c) && typeof icon === 'function' ? `<span class="fo-mk" role="img" aria-label="Focus client" data-hovertip="${escapeHtml(FOCUS_WORDS)}">${icon('target')}</span>` : ''; }
function focusClients(){ return activeClients().filter(isFocus); }
// Switches Focus on or off for some clients; returns how many saved.
async function saveClientFocus(ids, on){
  const list = [].concat(ids).map(id => clients.find(c => c.id === id)).filter(c => c && isFocus(c) !== !!on);
  const results = await Promise.all(list.map(async c => {
    const cfv = Object.assign({}, c.customFieldValues || {});
    if(on) Object.assign(cfv, { focus: true, focusAt: new Date().toISOString(), focusBy: (typeof myName === 'function' && myName()) || '' });
    else { delete cfv.focus; delete cfv.focusAt; delete cfv.focusBy; }
    const ok = await updateClientRow(c.id, { customFieldValues: cfv });
    if(ok){
      c.customFieldValues = cfv;
      if(typeof logClientActivity === 'function') logClientActivity(c.id, 'client_updated', `${(typeof myName === 'function' && myName()) || 'Someone'} ${on ? 'added' : 'took'} ${c.name} ${on ? 'to' : 'off'} Focus.`);
    }
    return ok;
  }));
  return { done: results.filter(Boolean).length, failed: results.filter(x => !x).length };
}
// waiting for setup; a paused one isn't (it's with the paused clients, client-status.js)
function setupClients(){ return clients.filter(c=>!c.deletedAt && clientInSetup(c) && c.status!=='Paused'); }
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
      <div style="font-size:16px;font-weight:600;color:var(--ink);margin-bottom:6px;">${c ? escapeHtml(c.name) : 'This client'} is paused</div>
      <div style="font-size:14px;color:var(--muted-lt);line-height:1.5;max-width:320px;margin:0 auto;">It isn’t working with us right now, so no time or work is logged for it. If that doesn’t sound right, an admin or approver can make it active again.</div>
    </div>
    <div class="modal-actions" style="justify-content:center;">
      <button class="btn btn-brand" onclick="closeAppModal()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="14" y="3" width="5" height="18" rx="1" /> <rect x="5" y="3" width="5" height="18" rx="1" /></svg>OK</button>
    </div>`, 380);
}
// The clients that signal "you should work on this" (Needs Attention, the Risk Breakdown ring, Client
// Health, pending-approval badges): active ones (paused ones are already out, Nov 25) that get updates.
// Clients set to "No weekly update" (the agency itself, an internal client) are left out too: no
// update is ever due, so they stay off Today, This Week, the Queue, Review and Health (Nov 22).
// Their work is still logged and their hours tracked; they're still in All Clients.
function getsUpdates(c){ return !(c && c.customFieldValues && c.customFieldValues.weeklyUpdate === 'off'); }
function attentionEligibleClients(){ return activeClients().filter(c=>c.status!=='Paused' && getsUpdates(c)); }
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
    createdAt: r.created_at || null, editedAt: r.edited_at || null, carryOver: !!r.carry_over, timeEntryId: r.time_entry_id || null };
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
// The time on your timesheet logged with this work (only your own time is loaded here). Time shared by
// a batch goes only when all of the batch's work does: deleting some of it keeps the time (Nov 25).
function workMinutes(ids){
  const set = new Set(ids);
  return (typeof timeEntries !== 'undefined' ? timeEntries : []).filter(e => e.improvementId && set.has(e.improvementId) && workBatchOf(e.id).every(i => set.has(i.id))).reduce((n, e) => n + (e.minutes || 0), 0);
}
// ---- Several improvements, one time (Nov 25) ----
// Time is a block of work; improvements are the several things it got done. Log Improvement takes one
// per line, with one Time spent for all of them: one entry in Harvest. The entry is linked to the
// first (time_entries.improvement_id, as for one) and each carries the entry
// (client_improvements.time_entry_id, addendum-work-batches.sql).
function workBatchOf(entryId){ return entryId ? clientImprovements.filter(i => i.timeEntryId === entryId) : []; }
// The lines of what was done, as separate improvements: one per line, without the bullet or number
// in front ("- ", "• ", "1. ", "2) ", "[x] "). One line is one improvement, as written.
function workSplitItems(text){
  const lines = String(text || '').split(/\r?\n/).map(l => l.replace(/^\s*(?:[-*•·–—>]|\d{1,2}[.)]|\[[ xX]?\])\s+/, '').trim()).filter(Boolean);
  return lines.length > 1 ? lines : [String(text || '').trim()].filter(Boolean);
}
// The time entry's notes for a batch: a few lines of what was done (as time is usually written), the
// rest counted.
function workTimeNotes(items){
  const cut = s => s.length > 90 ? s.slice(0, 89).trimEnd() + '…' : s, max = items.length > 6 ? 5 : 6;
  return items.slice(0, max).map(cut).join('\n') + (items.length > max ? `\n+${items.length - max} more` : '');
}
// Links each of the batch's work to its time. Before addendum-work-batches.sql there's nowhere to say
// so: the time is then left on its own (not linked to the first), so deleting that work keeps it.
async function workLinkBatch(imps, entryId){
  if(!entryId || imps.length < 2) return true;
  const { error } = await supabaseClient.from('client_improvements').update({ time_entry_id: entryId }).in('id', imps.map(i => i.id));
  if(error){
    if(workColumnMissing(error, 'time_entry_id')) await supabaseClient.from('time_entries').update({ improvement_id: null, logged: true }).eq('id', entryId);
    else console.error('workLinkBatch', error);
    return false;
  }
  imps.forEach(i => { i.timeEntryId = entryId; });
  return true;
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
    ? (n === 1 ? `Delete this time and the work it was logged with, “${workCut(items[0].text)}”?` : `Delete this time and the ${n} improvements it was logged with?`)
    : `Delete ${n === 1 ? `“${workCut(items[0].text)}”` : `${n} work items`}?`;
  // logged in a batch with other work that stays: the time stays with that work
  const set = new Set(items.map(i => i.id)), kept = [...new Set(items.map(i => i.timeEntryId).filter(Boolean))].map(id => workBatchOf(id).filter(i => !set.has(i.id))).filter(l => l.length);
  const notes = [];
  if(opts.fromTime) notes.push(`${n === 1 ? 'Both come' : 'They all come'} off your timesheet${harvest}, and out of the client’s log.`);
  else if(mins) notes.push(`The ${workHm(mins)} logged with ${it} comes off your timesheet${harvest} too.`);
  else if(others.length && !kept.length) notes.push(`Any time logged with ${it} goes too.`);
  if(kept.length && !opts.fromTime){ const k = kept.reduce((a, l) => a + l.length, 0); notes.push(`The time logged with ${it} stays, with the other ${k === 1 ? 'improvement' : `${k} improvements`} it was logged for.`); }
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
      // time shared with work that stays moves over to it instead (a batch, Nov 25)
      const { data: mine } = await t().select('id').in('improvement_id', ids).eq('user_id', uid).is('deleted_at', null);
      const keep = new Set();
      for(const e of mine || []){ const other = workBatchOf(e.id).find(i => !ids.includes(i.id)); if(other){ keep.add(e.id); await t().update({ improvement_id: other.id }).eq('id', e.id); } }
      const go = (mine || []).map(e => e.id).filter(id => !keep.has(id));
      const { data } = go.length ? await t().update({ deleted_at: new Date().toISOString() }).in('id', go).select('id, harvest_entry_id') : { data: [] };
      (data || []).filter(e => e.harvest_entry_id).forEach(e => workHarvest({ action: 'delete-entry', harvestEntryId: e.harvest_entry_id }));
    } else if(mode === 'restore'){
      // a batch's time comes back with any of its work, and is linked to work that's back
      const batch = [...new Set(deletedWork.concat(clientImprovements).filter(i => ids.includes(i.id) && i.timeEntryId).map(i => i.timeEntryId))];
      const { data } = await t().update({ deleted_at: null, harvest_entry_id: null, harvest_sync_status: 'pending', harvest_sync_error: null })
        .or(`improvement_id.in.(${ids.join(',')})${batch.length ? `,id.in.(${batch.join(',')})` : ''}`).eq('user_id', uid).not('deleted_at', 'is', null).select('id, improvement_id');
      for(const e of data || []){ if(!ids.includes(e.improvement_id)){ const w = deletedWork.concat(clientImprovements).find(i => ids.includes(i.id) && i.timeEntryId === e.id); if(w) await t().update({ improvement_id: w.id }).eq('id', e.id); } }
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
  const approvers = (typeof teamProfiles !== 'undefined' ? teamProfiles : []).filter(p => profileHasAccess(p, 'approve_updates') && p.id !== uid);
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
// ---- Sprints in Tasks (Nov 25) ----
// A sprint's open steps (yours, in one of your sprints) show in Tasks as one row: the next step to
// do, with the sprint's name, how far along it is and how many are late, and the other steps one click
// away. Plan still lists every step; Today and the calendar still show the step due that day. A
// teammate's task put in your sprint stays its own row: it's theirs. planSprints is Plan's list on the
// desktop (plan.js) and the phone's own (mobile/app.js).
function sprintFold(open){
  const me = typeof currentUser !== 'undefined' && currentUser ? currentUser.id : null, today = toDateStr(new Date());
  const sps = typeof planSprints !== 'undefined' && Array.isArray(planSprints) ? planSprints : [];
  const byId = new Map(sps.map(x => [x.id, x])), steps = new Map();
  open.forEach(t => { if(t.sprintId && t.assigneeId === me && byId.has(t.sprintId)){ if(!steps.has(t.sprintId)) steps.set(t.sprintId, []); steps.get(t.sprintId).push(t); } });
  const lead = new Map(), folded = new Set();
  steps.forEach((list, sid) => {
    list.sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    const all = (typeof tasks !== 'undefined' ? tasks : []).filter(x => x.sprintId === sid && !x.cancelledAt);
    lead.set(list[0].id, { sprint: byId.get(sid), next: list[0], rest: list.slice(1), total: all.length, done: all.filter(x => x.status === 'done').length,
      late: list.filter(x => x.dueDate && x.dueDate < today).length });
    list.slice(1).forEach(x => folded.add(x.id));
  });
  return { list: open.filter(t => !folded.has(t.id)), lead, sprints: lead.size };
}
// "4 open tasks and 2 sprints", "2 sprints", "5 open tasks"
function sprintFoldHeadline(fold, openN){
  if(!openN) return 'No open tasks';
  const loose = fold.list.length - fold.sprints, n = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;
  if(!fold.sprints) return `${n(openN, 'open task')}`;
  return loose ? `${n(loose, 'open task')} and ${n(fold.sprints, 'sprint')}` : n(fold.sprints, 'sprint');
}

// ---- The same time twice (Nov 25) ----
// Adding time by hand (Add Time, logging work with its time) first looks for that time already
// logged: your own entries for the client that day, in Radar and in Harvest. Harvest's are read fresh
// for that day when Add Time opens (timeFreshDay), since the regular read only runs when someone opens
// Radar and at night. It's the same time when:
//   - it's just as long, unless it's plainly other work: another task, and notes with nothing in common;
//   - it's a few minutes off (a Harvest timer's 1:27 against a typed 1:30) on the same task, or with
//     notes in common;
//   - its notes are one part of an entry the time was added to (adding to a task merges: "A · B").
// Billable against non-billable is never the same work. A timer still running for the client (Radar's
// or Harvest's) counts too: stopping it would log that time as well.
function timeBillable(projectId, taskId){
  if(!projectId || !taskId || typeof hvProjectTasks !== 'function' || typeof hvTimeOn !== 'function' || !hvTimeOn()) return null;
  const t = hvProjectTasks(projectId, taskId, true).find(x => x.id === Number(taskId));
  return t ? !!t.billable : null;
}
const TIME_STOP = new Set('the and for with from into onto this that these those our their your his her its was were are has have had been not but out all any some more also just then than them they over per via about after before again'.split(' '));
function timeWordsOf(s){
  return new Set(String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/)
    .filter(w => w.length >= 3 && !TIME_STOP.has(w)).map(w => w.length > 5 ? w.replace(/(ing|ed|es|s)$/, '') : w));
}
// true: the notes say the same thing; false: both say something, nothing in common; null: can't tell
function timeNotesSame(a, b){
  const A = timeWordsOf(a), B = timeWordsOf(b);
  if(!A.size || !B.size) return null;
  let n = 0; A.forEach(w => { if(B.has(w)) n++; });
  return n > 0 && n / Math.min(A.size, B.size) >= 0.5 ? true : n === 0 ? false : null;
}
// nearly the very same notes (most words shared, either way round)
function timeNotesClose(a, b){
  const A = timeWordsOf(a), B = timeWordsOf(b);
  if(!A.size || !B.size) return false;
  let n = 0; A.forEach(w => { if(B.has(w)) n++; });
  return n / Math.max(A.size, B.size) >= 0.8;
}
// true / false / null (can't tell): the same Harvest project and task, or the same service
function timeSameTask(n, x){
  const xp = x.harvest_project_id, xt = x.harvest_task_id;
  if(n.projectId && xp){
    if(Number(n.projectId) !== Number(xp)) return false;
    return n.taskId && xt ? Number(n.taskId) === Number(xt) : null;
  }
  const ns = n.projectId && typeof hvProjectName === 'function' ? hvProjectName(n.projectId) : n.service, xs = xp && typeof hvProjectName === 'function' ? hvProjectName(xp) : x.service;
  if(!ns || !xs) return null;
  return ns !== xs ? false : null;
}
// Harvest's side of a day, read now (once a minute at most per day). Resolves with the read's answer,
// or null (no Harvest, not linked, offline). Add Time starts it when it opens and when the day changes.
const timeFresh = new Map();
function timeFreshDay(dateStr){
  if(!dateStr || typeof hvTimeOn !== 'function' || !hvTimeOn() || typeof supabaseClient === 'undefined') return Promise.resolve(null);
  const had = timeFresh.get(dateStr);
  if(had && Date.now() - had.at < 60000) return had.p;
  const p = supabaseClient.auth.getSession().then(({ data: { session } }) => !session ? null
    : fetch('/api/integrations', { method: 'POST', headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'harvest', action: 'read-day', date: dateStr }) })
      .then(r => r.ok ? r.json() : null).then(r => r && !r.skipped ? r : null))
    .catch(() => null);
  timeFresh.set(dateStr, { at: Date.now(), p });
  return p;
}
// at most `ms` waiting for it: saving never hangs on Harvest
function timeFreshWait(dateStr, ms){ return Promise.race([timeFreshDay(dateStr), new Promise(r => setTimeout(() => r(null), ms || 2500))]); }

async function timeDuplicateOf({ clientId, dateStr, minutes, projectId, taskId, service, description }){
  if(!clientId || !dateStr || !minutes) return null;
  const fresh = await timeFreshWait(dateStr, 2500);
  const { data, error } = await supabaseClient.from('time_entries').select('*')
    .eq('user_id', currentUser.id).eq('client_id', clientId).eq('entry_date', dateStr).is('deleted_at', null).limit(50);
  const n = { projectId, taskId, service }, b = timeBillable(projectId, taskId), desc = (description || '').trim();
  let best = null;
  (error ? [] : data || []).forEach(x => {
    const xb = timeBillable(x.harvest_project_id, x.harvest_task_id);
    if(b !== null && xb !== null && b !== xb) return;                                     // billable vs not: other work
    const d = Math.abs(minutes - x.minutes), task = timeSameTask(n, x), notes = timeNotesSame(desc, x.description);
    const parts = String(x.description || '').split(' · ');
    const part = !!desc && parts.length > 1 && minutes < x.minutes && parts.some(p => timeNotesClose(desc, p));
    const near = d > 0 && d <= Math.max(5, Math.round(Math.max(minutes, x.minutes) * 0.1));
    let score = 0;
    if(part) score = 9;
    else if(d === 0){ if(task === false && notes === false) return; score = 4; }
    else if(near && (task === true || notes === true)) score = 2;
    else return;
    score += (task === true ? 2 : 0) + (notes === true ? 2 : 0);
    if(!best || score > best.score) best = { score, x, exact: d === 0, part };
  });
  if(best){
    const x = best.x, xb = timeBillable(x.harvest_project_id, x.harvest_task_id);
    return { id: x.id, minutes: x.minutes, date: x.entry_date, description: x.description || '', fromHarvest: x.source === 'harvest', locked: !!x.harvest_locked,
      exact: best.exact, part: best.part, logged: !!(x.logged || x.improvement_id),
      kind: typeof hvEntryWords === 'function' ? hvEntryWords({ harvestProjectId: x.harvest_project_id, harvestTaskId: x.harvest_task_id, service: x.service }) : (x.service || ''),
      billable: xb === null ? '' : xb ? 'Billable' : 'Non-billable' };
  }
  // a timer running for this client that day, long enough to hold this time
  const today = toDateStr(new Date());
  if(dateStr === today && typeof timerState !== 'undefined' && timerState && timerState.running && timerState.clientId === clientId && timerState.startedAt){
    const ran = Math.floor((Date.now() - timerState.startedAt) / 60000);
    if(toDateStr(new Date(timerState.startedAt)) === dateStr && ran >= 10 && minutes <= ran + 10) return { timer: 'radar', minutes: ran, description: timerState.description || '' };
  }
  const run = fresh && (fresh.running || []).find(r => String(r.client_id) === String(clientId) && r.minutes >= 10 && minutes <= r.minutes + 10);
  if(run) return { timer: 'harvest', minutes: run.minutes, description: run.notes || '' };
  return null;
}
// "1:27 for Harbor Kitchen & Bath today · Website · Design · Billable · in Harvest"
function timeDupWords(dup, clientId){
  const c = clients.find(x => x.id === clientId), hm = m => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
  if(dup.timer) return `${hm(dup.minutes)} so far for ${c ? c.name : 'this client'}${dup.timer === 'harvest' ? ', in Harvest' : ''}`;
  const day = dup.date === toDateStr(new Date()) ? 'today' : 'on ' + fmtShortDate(new Date(dup.date + 'T12:00:00'));
  return [`${hm(dup.minutes)} for ${c ? c.name : 'this client'} ${day}`, dup.kind, dup.billable, dup.fromHarvest ? 'in Harvest' : ''].filter(Boolean).join(' · ');
}
function timeDupTitle(dup){
  return dup.timer ? (dup.timer === 'harvest' ? 'Your Harvest timer is running for this client' : 'Your timer is running for this client')
    : dup.exact || dup.part ? 'You already logged this time' : 'This looks like time you already logged';
}
// One line on why, for what the words don't show
function timeDupWhy(dup){
  if(dup.timer) return 'Stopping it will log that time too.';
  if(dup.part) return 'It’s part of an entry that time was added to.';
  return '';
}
// Logging work with its time (Log, Queue, the phone): the same time already logged? Use it as this
// work's time (nothing new in Harvest), add the time too, or, when that time is already other work's,
// log the work without time. Resolves { pick: 'use' | 'add' | 'none', id, minutes }, or null to stop.
// A timer running for the client isn't asked about here: Log has its own Use Timer.
async function workTimeCheck({ clientId, dateStr, minutes, projectId, taskId, service, text }){
  if(!minutes) return { pick: 'add' };
  const dup = await timeDuplicateOf({ clientId, dateStr, minutes, projectId, taskId, service, description: text });
  if(!dup || dup.timer) return { pick: 'add' };
  const choices = dup.logged
    ? [{ label: 'Log Without Time', value: 'none' }, { label: 'Add the Time Too', value: 'add', primary: true }]
    : [{ label: 'Add the Time Too', value: 'add' }, { label: 'Use That Time', value: 'use', primary: true }];
  const q = dup.description ? `“${dup.description.length > 100 ? dup.description.slice(0, 100) + '…' : dup.description}”` : '';
  const say = dup.logged ? 'That time is already logged as other work.' : 'Use it as this work’s time, so it isn’t in Harvest twice.';
  const v = typeof choiceDialog === 'function' ? await choiceDialog({ title: timeDupTitle(dup), body: `${timeDupWords(dup, clientId)}${q ? '\n' + q : ''}\n\n${say}`, row: true, choices })
    : typeof mActions === 'function' ? await new Promise(res => mActions(`${timeDupTitle(dup)}: ${timeDupWords(dup, clientId)}${q ? ', ' + q : ''}. ${say}`, choices.slice().reverse().map(c => ({ label: c.label, fn: () => res(c.value) })), () => res(null)))
    : 'add';
  return v === null ? null : { pick: v, id: dup.id, minutes: dup.minutes };
}
// That entry becomes this work's time: linked, so deleting either deletes both (as Log as Work does)
async function workTimeLink(entryId, impId){
  let r = await supabaseClient.from('time_entries').update({ logged: true, improvement_id: impId }).eq('id', entryId);
  if(r.error && workColumnMissing(r.error, 'improvement_id')) r = await supabaseClient.from('time_entries').update({ logged: true }).eq('id', entryId);
  return !r.error;
}
async function okToLogDuplicate(clientId, text){
  const dup = workDuplicateOf(clientId, text); if(!dup) return true;
  const c = clients.find(x => x.id === clientId), me = typeof myName === 'function' ? myName() : '';
  const who = dup.author === me ? 'You' : firstName(dup.author);
  return await confirmDialog(`${who} already logged this for ${c ? c.name : 'this client'} on ${fmtShortDate(new Date(dup.date))}: “${workCut(dup.text, 90)}”.`, { title: 'Log it again?', confirmLabel: 'Log It Again', cancelLabel: 'Don’t Log' });
}

// Several lines at once (Nov 25): the ones already logged lately are named once, to skip or log too.
// Returns the lines to log, or null when they backed out.
async function workDupsAsk(clientId, items){
  if(items.length < 2) return (await okToLogDuplicate(clientId, items[0])) ? items : null;
  const dups = items.filter(t => workDuplicateOf(clientId, t)); if(!dups.length) return items;
  const c = clients.find(x => x.id === clientId), allDup = dups.length === items.length;
  const title = dups.length === 1 ? 'One of these is already logged' : `${dups.length} of these are already logged`;
  const body = `${dups.map(t => `“${workCut(t, 90)}”`).join('\n')}\n\nLogged for ${c ? c.name : 'this client'} in the last 30 days.`;
  const choices = [{ label: dups.length === 1 ? 'Log It Too' : 'Log Them Too', value: 'all' }, ...(allDup ? [] : [{ label: dups.length === 1 ? 'Skip That One' : 'Skip Those', value: 'skip', primary: true }])];
  const v = typeof choiceDialog === 'function' ? await choiceDialog({ title, body, row: true, choices })
    : typeof mActions === 'function' ? await new Promise(res => mActions(`${title}: ${dups.map(t => `“${workCut(t, 60)}”`).join(', ')}.`, choices.slice().reverse().map(x => ({ label: x.label, fn: () => res(x.value) })), () => res(null)))
    : 'all';
  if(v === null) return null;
  return v === 'skip' ? items.filter(t => !dups.includes(t)) : items;
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
