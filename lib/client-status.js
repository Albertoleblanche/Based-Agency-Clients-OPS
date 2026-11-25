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

// "<client> is paused", to the team (Nov 25): the table of paused clients is for the people who edit
// clients; everyone else just hears about it. In the app, by push and on Slack, unless muted
// (Settings → Notifications: client_paused). `to` picks who from the team profiles; the person who
// paused it is left out by the caller.
const PAUSED_NOTE = 'client_paused';
async function tellTeamPaused(admin, profiles, title, body, targetId, to) {
  const { sendPushToUser, pushUrlFor } = require('./push-notify');
  const { sendSlackDM } = require('./slack-notify');
  if (!profiles) { const { data } = await admin.from('team_profiles').select('id, role, access_revoked, muted_notification_types, extra_permissions'); profiles = data || []; }
  const muted = (p, ch) => { const m = p.muted_notification_types || []; return m.includes(PAUSED_NOTE) || m.includes(ch + ':' + PAUSED_NOTE); };
  const list = profiles.filter(p => !p.access_revoked && (!to || to(p)));
  for (const p of list) {
    if (!muted(p, 'app')) await admin.from('notifications').insert({ user_id: p.id, type: PAUSED_NOTE, title, body, target_view: 'clients', target_id: targetId || null }).then(() => {}, () => {});
    if (!muted(p, 'push')) { try { await sendPushToUser(admin, p.id, title, body, pushUrlFor('clients', targetId)); } catch (e) {} }
    if (!muted(p, 'slack')) { try { await sendSlackDM(admin, p.id, PAUSED_NOTE, `*${title}*\n${body}`); } catch (e) {} }
  }
  return list.length;
}

// For "Still a client?" in the app (js/features/client-status.js): each client's last work and what's
// still open, from everyone's time and work. In the app a person sees only their own time entries and
// sprints, so a client someone else works on would look quiet there. { last: { id: 'YYYY-MM-DD' }, open: [id] }
async function clientWork(admin, today) {
  const { selectAll } = require('./select-all');
  const addDaysIso = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const since = addDaysIso(today, -60), last = {}, open = new Set();
  const bump = (id, d) => { if (!id || !d) return; const day = String(d).slice(0, 10); if (day > today) return; if (!last[id] || last[id] < day) last[id] = day; };
  const [cs, te, im, tk, sp, rm, dr] = await Promise.all([
    admin.from('clients').select('id, status, deleted_at, custom_field_values'),
    selectAll(() => admin.from('time_entries').select('id, client_id, entry_date').gte('entry_date', since).is('deleted_at', null).order('id')),
    selectAll(() => admin.from('client_improvements').select('id, client_id, date').gte('date', since).is('deleted_at', null).order('id')),
    admin.from('tasks').select('client_id, status, cancelled_at, created_at, completed_at').not('client_id', 'is', null),
    admin.from('plan_sprints').select('client_id, done_at, end_date').not('client_id', 'is', null),
    admin.from('client_reminders').select('client_id, status').eq('status', 'waiting'),
    admin.from('client_drafts').select('client_id, draft, draft_status, draft_sent_at'),
  ]);
  const err = [cs, te, im, tk].find(r => r.error);
  if (err) throw new Error(err.error.message);
  (te.data || []).forEach(e => bump(String(e.client_id), e.entry_date));
  (im.data || []).forEach(i => bump(String(i.client_id), i.date));
  (tk.data || []).forEach(t => { const id = String(t.client_id); bump(id, t.completed_at || t.created_at); if (t.status !== 'done' && !t.cancelled_at) open.add(id); });
  (sp.data || []).forEach(s => { if (!s.done_at && s.end_date >= today) open.add(String(s.client_id)); });
  (rm.data || []).forEach(r => { if (r.client_id) open.add(String(r.client_id)); });
  (dr.data || []).forEach(d => { const id = String(d.client_id); bump(id, d.draft_sent_at); if ((d.draft_status === 'pending' || d.draft_status === 'approved') && String(d.draft || '').trim()) open.add(id); });
  // the ones with nothing in the last 60 days: when they last had any time or work, for the wording
  const quiet = (cs.data || []).filter(c => !c.deleted_at && c.status !== 'Paused' && !(c.custom_field_values || {}).harvestSetup && !(last[String(c.id)] >= since) && !open.has(String(c.id)));
  await Promise.all(quiet.map(async c => {
    const id = String(c.id);
    const [t, i] = await Promise.all([
      admin.from('time_entries').select('entry_date').eq('client_id', id).is('deleted_at', null).lte('entry_date', today).order('entry_date', { ascending: false }).limit(1),
      admin.from('client_improvements').select('date').eq('client_id', id).is('deleted_at', null).lte('date', today + 'T23:59:59Z').order('date', { ascending: false }).limit(1),
    ]);
    ((t.data || [])[0]) && bump(id, t.data[0].entry_date);
    ((i.data || [])[0]) && bump(id, i.data[0].date);
  }));
  return { last, open: [...open] };
}

module.exports = { statusCfv, workInProgress, tellTeamPaused, PAUSED_NOTE, clientWork };
