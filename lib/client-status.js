// A client's status on the server, as js/features/client-status.js has it in the app (Nov 25).
// custom_field_values keeps pausedAt and pausedBy (a name, 'harvest' or 'sheet') while a client is
// Paused, statusAsk { why: 'harvest', at, work } while Radar asks "Still a client?", and statusKeptAt /
// statusKeptBy for 60 days after someone keeps it (or makes it active again).

// The custom values to save with a new status.
function statusCfv(cfv, was, status, by, nowIso) {
  const v = Object.assign({}, cfv || {}), at = nowIso || new Date().toISOString();
  if (status === 'Paused') {
    if (was !== 'Paused' || !v.pausedAt) { v.pausedAt = at; v.pausedBy = by || ''; }
  } else { delete v.pausedAt; delete v.pausedBy; }
  if (status !== was || status === 'Paused') delete v.statusAsk;
  if (was === 'Paused' && status && status !== 'Paused') { v.statusKeptAt = at; v.statusKeptBy = by || ''; }
  return v;
}

const plural = (n, one, many) => n === 1 ? one : `${n} ${many}`;
// What's still going on for each client, in words: time this month, open tasks, a sprint planned,
// an update draft not sent, follow-ups waiting. A list Radar couldn't read counts as something going
// on (sure: false), so a client is never paused on a guess.
async function workInProgress(admin, ids, today) {
  const out = new Map(ids.map(id => [String(id), []]));
  if (!ids.length) return { work: out, sure: true };
  const month0 = today.slice(0, 8) + '01';
  const [te, tk, sp, dr, rm] = await Promise.all([
    admin.from('time_entries').select('client_id').in('client_id', ids).gte('entry_date', month0).is('deleted_at', null),
    admin.from('tasks').select('client_id').in('client_id', ids).neq('status', 'done').is('cancelled_at', null),
    admin.from('plan_sprints').select('client_id').in('client_id', ids).is('done_at', null).gte('end_date', today),
    admin.from('client_drafts').select('client_id, draft').in('client_id', ids).in('draft_status', ['pending', 'approved']),
    admin.from('client_reminders').select('client_id').in('client_id', ids).eq('status', 'waiting'),
  ]);
  const sure = ![te, tk, sp, dr, rm].some(r => r.error);
  const count = (res, keep) => { const n = new Map(); (res.data || []).filter(keep || (() => true)).forEach(r => n.set(String(r.client_id), (n.get(String(r.client_id)) || 0) + 1)); return n; };
  const t = count(te), k = count(tk), s = count(sp), d = count(dr, r => String(r.draft || '').trim()), w = count(rm);
  for (const id of out.keys()) {
    const list = out.get(id);
    if (t.get(id)) list.push('time logged this month');
    if (k.get(id)) list.push(plural(k.get(id), 'an open task', 'open tasks'));
    if (s.get(id)) list.push('a sprint planned');
    if (d.get(id)) list.push('an update draft not sent');
    if (w.get(id)) list.push(plural(w.get(id), 'a follow-up waiting', 'follow-ups waiting'));
  }
  return { work: out, sure };
}

module.exports = { statusCfv, workInProgress };
