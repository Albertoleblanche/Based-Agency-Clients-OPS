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
