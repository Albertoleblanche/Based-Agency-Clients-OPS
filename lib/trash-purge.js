// Recently Deleted empties itself (Nov 21): work, notes and time entries deleted more than 30 days
// ago are deleted for good, each night with the daily cron (api/cron-wednesday-notify.js). The time
// logged with deleted work goes with it. Harvest needs nothing: deleting took the time out of there
// already. Clients stay until someone deletes them for good, since that takes all their history.
// Each step skips quietly when its column isn't there yet (addendum-deleted-work.sql).
const KEEP_DAYS = 30;

async function purgeRecentlyDeleted(admin, now = new Date()) {
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 86400000).toISOString();
  const out = { work: 0, time: 0, notes: 0 };
  const idsOf = async (table) => {
    const { data, error } = await admin.from(table).select('id').not('deleted_at', 'is', null).lt('deleted_at', cutoff).limit(1000);
    return error ? [] : (data || []).map(r => r.id);
  };
  const chunks = (a, n = 200) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
  // work first, with its time (the link would be cleared otherwise)
  const work = await idsOf('client_improvements');
  for (const ids of chunks(work)) {
    await admin.from('time_entries').delete().in('improvement_id', ids);
    const { error } = await admin.from('client_improvements').delete().in('id', ids);
    if (!error) out.work += ids.length;
  }
  const time = await idsOf('time_entries');
  for (const ids of chunks(time)) { const { error } = await admin.from('time_entries').delete().in('id', ids); if (!error) out.time += ids.length; }
  const notes = await idsOf('notes');
  for (const ids of chunks(notes)) { const { error } = await admin.from('notes').delete().in('id', ids); if (!error) out.notes += ids.length; }
  return out;
}

module.exports = { purgeRecentlyDeleted, KEEP_DAYS };
