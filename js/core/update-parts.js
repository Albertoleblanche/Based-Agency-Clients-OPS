// A client's update in parts (Nov 22). Everyone who worked on a client writes their own part from
// their own work and sends it for review; an approver reads and approves each part; the approved
// parts go to the client as ONE email: one greeting, each part's win, one sign-off. Shared by the
// desktop app and the iPhone. WhatsApp-only clients keep one message per part (each person pastes
// their own win in the group, and Radar matches each message on its own).

// Where a part stands: writing (not sent for review yet), review, approved, sent.
function partState(d){
  if(!d) return 'none';
  if(d.draftSentAt) return 'sent';
  if(d.draftStatus === 'approved') return 'approved';
  if(d.draftStatus === 'pending') return d.readyToNotify ? 'review' : 'writing';
  return 'none';
}
// The parts of this week's update that haven't gone out, the owner's first, then oldest first. A part
// with nothing behind it any more (its work was deleted) isn't one; nor is one still being written by
// someone no longer on the team.
function clientParts(c){
  if(!c) return [];
  const owner = typeof clientOwner === 'function' ? clientOwner(c) : '';
  const ps = typeof teamProfiles !== 'undefined' ? teamProfiles : [];
  const onTeam = n => !ps.length || ps.some(p => p.name === n && !p.access_revoked);
  return (c.drafts || [])
    .filter(d => d.draft && !d.draftSentAt && (d.draftStatus === 'pending' || d.draftStatus === 'approved') && !draftHasNoWork(c, d))
    .map(d => ({ d, author: d.author, state: partState(d) }))
    .filter(p => p.state !== 'writing' || onTeam(p.author))
    .sort((a, b) => (b.author === owner) - (a.author === owner) || new Date(a.d.draftPendingSince || 0) - new Date(b.d.draftPendingSince || 0));
}
// Parts go out together by email; a WhatsApp-only client gets each part as its own message.
function partsByEmail(c){ return typeof winChannel !== 'function' || winChannel(c) !== 'whatsapp'; }
// More than one person's part this week, going by email: shown and sent as one.
function hasParts(c){ return partsByEmail(c) && clientParts(c).length > 1; }

// ---- one email from several parts ----------------------------------------------------------------
// Each part is written as a whole win ("Hey Mike, big win for you! … Let us know how it goes!"), so
// putting two together keeps the first part's greeting, drops the others' ("Mike, great news!"), and
// moves a generic sign-off ("Let us know how it goes!") to the end, once. Anything that says what's
// next ("we'll share how they're doing Friday") stays in its part.
const PART_GREETING = /^(?:hey|hi|hello|dear|good (?:morning|afternoon|evening))\b|^[A-Z][\w'’.-]*(?:\s(?:and|&)\s[A-Z][\w'’.-]*)?,\s/i;
const PART_WINWORD = /\b(?:win|wins|news|update|week)\b/i;
const PART_CLOSER = /^(?:let us know how it goes|let us know what you think|talk soon|speak soon|have a (?:great|good) (?:week|weekend|day)|enjoy (?:the|your) (?:week|weekend)|any questions,?[^.!?]*|thanks(?: so much)?|thank you|cheers|best(?: regards)?)\s*[.!]*\s*$/i;
function partPieces(text){
  const paras = String(text || '').replace(/\r/g, '').trim().split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  let opener = '', closer = '', inline = false;
  if(paras.length){
    const p0 = paras[0];
    // a greeting on its own line ("Hi Mike," / "Hey Mike, big win for you!")
    if(p0.length <= 70 && PART_GREETING.test(p0) && !/[.!?:]\s+\S/.test(p0)){ opener = p0; paras.shift(); }
    else {
      // or the first sentence of the first paragraph ("Mike, great news! Your page …")
      const m = p0.match(/^(.{2,90}?[!:])\s+(?=\S)/);
      if(m && PART_GREETING.test(m[1]) && (PART_WINWORD.test(m[1]) || m[1].length <= 30)){ opener = m[1]; paras[0] = p0.slice(m[0].length); inline = true; }
    }
  }
  if(paras.length){
    const last = paras[paras.length - 1];
    if(last.length <= 90 && PART_CLOSER.test(last)){ closer = last; paras.pop(); }
    else {
      const m = last.match(/(^|[.!?]\s+)([^.!?]{2,70}[.!]+)\s*$/);
      if(m && PART_CLOSER.test(m[2]) && m.index > 0){ closer = m[2]; paras[paras.length - 1] = last.slice(0, m.index + m[1].length).trim(); }
    }
  }
  return { opener, inline, body: paras.join('\n\n'), closer };
}
const capFirst = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
// The email, section by section: each part's text as it will go out, then the one sign-off.
//   sections: [{ d, text }]   closer: the sign-off at the end ('' if no part had one)
function partSections(drafts){
  const list = (drafts || []).filter(d => d && String(d.draft || '').trim());
  if(list.length <= 1) return { sections: list.map(d => ({ d, text: String(d.draft || '').trim() })), closer: '' };
  const pcs = list.map(d => partPieces(d.draft));
  const closer = (pcs[pcs.length - 1].closer || pcs.find(p => p.closer)?.closer || '');
  const greet = pcs[0].opener || (pcs.find(p => p.opener) || {}).opener || '';
  const sections = list.map((d, i) => {
    const p = pcs[i];
    let text = p.body;
    if(i === 0 && greet) text = p.opener && p.inline ? `${greet} ${p.body}` : `${greet}\n\n${p.body}`;
    else text = capFirst(text);
    return { d, text: text.trim() };
  }).filter(s => s.text);
  return { sections, closer };
}
function combineParts(drafts){
  const { sections, closer } = partSections(drafts);
  return [...sections.map(s => s.text), closer].filter(Boolean).join('\n\n');
}
// The approved parts of a client's update, in order: what Send sends.
function approvedParts(c){ return clientParts(c).filter(p => p.state === 'approved'); }
// "Albert’s and Charlie’s parts" · "Albert’s part"
function partNames(names, me){
  const n = names.map(a => a === me ? 'your' : `${firstName(a)}’s`);
  const s = n.length <= 1 ? (n[0] || '') : n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1];
  return `${s} part${names.length === 1 ? '' : 's'}`;
}

// ---- skipping a week, taking an approval back (Nov 27) -------------------------------------------
// From Review (Waiting or Approved; desktop and iPhone), an admin or approver can skip a client's update
// for the week: nothing goes to the client, and every part still open (being written, waiting, approved)
// is cleared. The work in them either waits for next week's update (include in email, carry over) or is
// left out for good (out of the email). The skip is kept in app_storage 'update-skips' so the week
// counts as skipped, not missed, and nobody is chased for it (week-health.js coveredTimes, and the
// server's lib/update-automations.js). Undo puts everything back as it was.
function weekOpenParts(c){ return ((c && c.drafts) || []).filter(d => d.draft && !d.draftSentAt && (d.draftStatus === 'pending' || d.draftStatus === 'approved')); }
// the work's flags, on the server and here; carry_over needs addendum-flow-gaps.sql, and without it the
// work still goes in (two weeks' carry-over in clientWeek covers a skipped week)
async function setWorkFlags(c, ids, flags){
  if(!ids.length) return true;
  const row = {}; if('includeInEmail' in flags) row.include_in_email = flags.includeInEmail; if('carryOver' in flags) row.carry_over = flags.carryOver;
  let { error } = await supabaseClient.from('client_improvements').update(row).in('id', ids);
  if(error && 'carry_over' in row && typeof workColumnMissing === 'function' && workColumnMissing(error, 'carry_over')){ delete row.carry_over; ({ error } = await supabaseClient.from('client_improvements').update(row).in('id', ids)); }
  if(error) return false;
  (c.improvements || []).forEach(i => { if(ids.includes(i.id)){ if('include_in_email' in row) i.includeInEmail = row.include_in_email; if('carry_over' in row) i.carryOver = row.carry_over; } });
  return true;
}
async function saveUpdateSkips(mutate){
  await loadUpdateSkips();   // someone else's skips since this page loaded stay
  mutate(updateSkips);
  return safeSet('update-skips', JSON.stringify(updateSkips));
}
// o: { keep: true|false, reason }. Returns { ok, undo } or { error }.
async function skipUpdateWeek(c, o){
  const parts = weekOpenParts(c), ids = [...new Set(parts.flatMap(d => d.draftImprovementIds || []))];
  const keep = o.keep !== false, at = new Date().toISOString(), by = myName() || '';
  const snap = parts.map(d => ({ author: d.author, fields: { draft: d.draft, draftStatus: d.draftStatus, draftImprovementIds: d.draftImprovementIds || [], draftPendingSince: d.draftPendingSince || null,
    readyToNotify: !!d.readyToNotify, approvedBy: d.approvedBy || '', approvedAt: d.approvedAt || null, winTier: d.winTier || null } }));
  const work = (c.improvements || []).filter(i => ids.includes(i.id)).map(i => ({ id: i.id, includeInEmail: i.includeInEmail, carryOver: !!i.carryOver }));
  const done = [];
  for(const d of parts){
    if(!(await saveDraftFor(c.id, d.author, { draftStatus: 'none', draft: '', draftImprovementIds: [], draftSentAt: null, draftSentBy: '', readyToNotify: false }))){
      for(const s of snap.filter(x => done.includes(x.author))) await saveDraftFor(c.id, s.author, s.fields);   // all or nothing
      return { error: 'The update couldn’t be cleared. Try again in a moment.' };
    }
    done.push(d.author);
  }
  await setWorkFlags(c, ids, keep ? { includeInEmail: true, carryOver: true } : { includeInEmail: false, carryOver: false });
  const entry = { at, by, keep, reason: String(o.reason || '').trim().slice(0, 300), authors: parts.map(d => d.author) };
  await saveUpdateSkips(all => { all[c.id] = [...(all[c.id] || []), entry].slice(-40); });
  return { ok: true, entry, parts, ids, undo: async () => {
    for(const s of snap) if(!(await saveDraftFor(c.id, s.author, s.fields))) return false;
    const on = work.filter(x => x.includeInEmail !== false).map(x => x.id), off = work.filter(x => x.includeInEmail === false).map(x => x.id);
    await setWorkFlags(c, on, { includeInEmail: true }); await setWorkFlags(c, off, { includeInEmail: false });
    await setWorkFlags(c, work.filter(x => !x.carryOver).map(x => x.id), { carryOver: false });
    return saveUpdateSkips(all => { all[c.id] = (all[c.id] || []).filter(x => x.at !== at); });
  } };
}
// Back to Waiting: an approved part goes back for a yes, as it was when it was sent for review. Its work
// was marked as sent when it was approved; it's for the email again.
async function unapproveWeek(c, authors){
  const parts = weekOpenParts(c).filter(d => d.draftStatus === 'approved' && (!authors || authors.includes(d.author)));
  for(const d of parts){
    if(!(await saveDraftFor(c.id, d.author, { draftStatus: 'pending', readyToNotify: true, approvedBy: '', approvedAt: null, waCopiedBy: '', waCopiedAt: null }))) return { error: 'It couldn’t be moved back. Try again in a moment.' };
    await setWorkFlags(c, d.draftImprovementIds || [], { includeInEmail: true });
  }
  return { ok: true, parts };
}
// Who hears about a skip: whoever wrote a part, whoever's work was in one, and whoever approved one.
function skipWeekPeople(c, parts, ids){
  const names = new Set(parts.map(d => d.author));
  (c.improvements || []).forEach(i => { if(ids.includes(i.id) && i.author) names.add(i.author); });
  parts.forEach(d => { if(d.approvedBy) names.add(d.approvedBy); });
  names.delete(myName());
  return [...names].map(n => (typeof teamProfiles !== 'undefined' ? teamProfiles : []).find(p => p.name === n && !p.access_revoked)).filter(Boolean);
}
function skipWeekWords(c, r){
  const me = myName() || 'An approver', why = r.entry.reason ? `: “${r.entry.reason}”` : '.';
  return { title: `${c.name}: this week’s update was skipped`,
    body: `${me} skipped it${why} Nothing was sent. ${r.entry.keep ? 'The work in it goes in next week’s update.' : 'The work in it won’t go in an update.'}` };
}
