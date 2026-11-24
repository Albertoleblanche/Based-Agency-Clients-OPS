// Weekly wins, sent where the client is (from the Nov 9–12 sprints; canvas "Weekly wins" boards).
//   * Every client gets a win each week, on its own win day (Monday to Friday).
//   * Each win has a tier: 1 a result, 2 something we changed for them, 3 the work done.
//   * A client hears from us by email, in its WhatsApp group, or both. Radar never posts to
//     WhatsApp: the win is formatted for WhatsApp, someone copies it, pastes it in the group,
//     and it counts as sent.
//   * No double sends: an approved WhatsApp win goes back to whoever wrote it. Copying it claims
//     it (one sender at a time; anyone else gets a warning first), and Radar marks it sent when
//     it shows up in the group (addendum-weekly-wins.sql).
// A client's win day and channel live in its custom field values (winDay, winChannel), like its
// owner; its group is the WhatsApp group linked to it (wa_groups.client_id).

let _winsDb = null;   // addendum-weekly-wins.sql has run: tiers, claims and "seen in the group"
let winGroups = [];   // [{ jid, name, client_id, active }]: every client's WhatsApp group, from wa_client_groups()
function winsDbReady(){ return _winsDb === true; }
// loadAll() fetches the groups alongside everything else, then hands both over here.
function winsGroupsFetch(){
  try{ return supabaseClient.rpc('wa_client_groups').then(r => r, e => ({ error: e })); }catch(e){ return Promise.resolve({ error: e }); }
}
function winsAfterLoad(draftRows, groupsRes){
  if(draftRows && draftRows.length) _winsDb = draftRows.some(r => r && Object.prototype.hasOwnProperty.call(r, 'win_tier'));
  else if(_winsDb === null){
    _winsDb = false;
    supabaseClient.from('client_drafts').select('win_tier').limit(1).then(({ error }) => { if(!error){ _winsDb = true; winsRerender(); } }, () => {});
  }
  if(groupsRes && !groupsRes.error && Array.isArray(groupsRes.data)) winGroups = groupsRes.data;
}

// ---- a client's win settings -----------------------------------------------------------------
const WIN_DAY_NAMES = { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday' };
function winDay(c){ const v = Number(c && c.customFieldValues && c.customFieldValues.winDay); return v >= 1 && v <= 5 ? v : null; }
function winNorm(s){ return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim(); }
function winCleanGroupName(n){ return typeof waCleanName === 'function' ? waCleanName(n) : String(n || ''); }
// The client's group: the one linked to it, else one with the same name (as WhatsApp's own matching).
function winGroupFor(c){
  if(!c) return null;
  const linked = winGroups.find(g => String(g.client_id || '') === String(c.id));
  if(linked) return linked;
  const n = winNorm(c.name);
  if(!n) return null;
  return winGroups.find(g => !g.client_id && g.active !== false && winNorm(winCleanGroupName(g.name)) === n) || null;
}
// 'whatsapp' | 'email' | 'both'. Set per client; otherwise WhatsApp when it has a group.
function winChannel(c){
  const v = c && c.customFieldValues && c.customFieldValues.winChannel;
  if(v === 'whatsapp' || v === 'email' || v === 'both') return v;
  return winGroupFor(c) ? 'whatsapp' : 'email';
}
// WhatsApp-only clients go through copy and paste; email and "both" go out by email (WhatsApp extra).
function winViaWhatsapp(c){ return winChannel(c) === 'whatsapp'; }
function winChannelWords(c){ return getsUpdates(c) ? { whatsapp: 'WhatsApp', email: 'Email', both: 'WhatsApp and email' }[winChannel(c)] : 'No weekly update'; }
function chGlyph(c){
  const ch = winChannel(c), wa = ch !== 'email';
  return `<span class="wn-ch" title="${ch === 'both' ? 'WhatsApp and email' : wa ? 'WhatsApp group' : 'Email'}">${icon(wa ? 'message-circle' : 'envelope-simple')}</span>`;
}
async function setWinSetting(clientId, key, value){
  const c = clients.find(x => x.id === clientId); if(!c) return;
  if(!canApprove()){ showToast('error', 'Not allowed', 'Only admins and approvers change how a client gets its win.'); return; }
  const cfv = Object.assign({}, c.customFieldValues || {});
  if(value === '' || value == null) delete cfv[key]; else cfv[key] = value;
  const prev = c.customFieldValues;
  c.customFieldValues = cfv; winsRerender();
  if(!(await updateClientRow(clientId, { customFieldValues: cfv }))){ c.customFieldValues = prev; winsRerender(); showToast('error', 'Couldn’t save', 'Try again in a moment.'); }
}
function setWinChannel(clientId, v){
  const c = clients.find(x => x.id === clientId);
  // picking how it's sent turns a client set to "No weekly update" back on
  if(c && !getsUpdates(c)) return setWeeklyUpdate(clientId, true, { channel: v });
  return setWinSetting(clientId, 'winChannel', v);
}
// "No weekly update" (Nov 22): for the agency itself or an internal client. No update is ever due, so
// it leaves Today, This Week, the Queue, Review and Health (attentionEligibleClients), and the
// morning automations skip it. Its work is still logged and its hours tracked.
async function setWeeklyUpdate(clientId, on, o){
  const c = clients.find(x => x.id === clientId); if(!c) return;
  if(!canApprove()){ showToast('error', 'Not allowed', 'Only admins and approvers change how a client gets its win.'); return; }
  if(getsUpdates(c) === !!on && !(o && o.channel)) return;
  const cfv = Object.assign({}, c.customFieldValues || {}), prev = c.customFieldValues;
  if(on) delete cfv.weeklyUpdate; else cfv.weeklyUpdate = 'off';
  if(on && o && o.channel) cfv.winChannel = o.channel;
  const redraw = () => typeof renderAll === 'function' ? renderAll() : winsRerender();
  c.customFieldValues = cfv; redraw();
  if(!(await updateClientRow(clientId, { customFieldValues: cfv }))){ c.customFieldValues = prev; redraw(); showToast('error', 'Couldn’t save', 'Try again in a moment.'); return; }
  if(typeof logClientActivity === 'function') logClientActivity(clientId, 'client_updated', `${myName() || 'Someone'} ${on ? 'turned the weekly update back on' : 'set the client to no weekly update'}.`);
  if(!(o && o.quiet)) showToast('success', on ? `${c.name} gets a weekly update again` : `${c.name}: no weekly update`,
    on ? 'It’s back on This Week, Today and the Queue.' : 'It’s off This Week, Today, the Queue and Health. Work and hours are still logged.');
}
function setWinDay(clientId, v){ return setWinSetting(clientId, 'winDay', v ? Number(v) : ''); }
// Link a WhatsApp group to the client (and unlink any other group from it).
async function setWinGroup(clientId, jid){
  if(!canApprove()){ showToast('error', 'Not allowed', 'Only admins and approvers link groups.'); return; }
  const before = winGroups.map(g => Object.assign({}, g));
  winGroups.forEach(g => { if(String(g.client_id || '') === String(clientId)) g.client_id = null; if(g.jid === jid) g.client_id = clientId; });
  winsRerender();
  let ok = true;
  const old = before.filter(g => String(g.client_id || '') === String(clientId) && g.jid !== jid).map(g => g.jid);
  if(old.length){ const { error } = await supabaseClient.from('wa_groups').update({ client_id: null, updated_at: new Date().toISOString() }).in('jid', old); if(error) ok = false; }
  if(jid && ok){ const { data, error } = await supabaseClient.from('wa_groups').update({ client_id: clientId, updated_at: new Date().toISOString() }).eq('jid', jid).select(); if(error || !data || !data.length) ok = false; }
  if(!ok){ winGroups = before; winsRerender(); showToast('error', 'Couldn’t link the group', 'Try again in a moment.'); }
}
function winsRerender(){
  if(typeof renderClientsTable === 'function') renderClientsTable();
  if(typeof renderThisWeek === 'function') renderThisWeek();
  if(typeof renderTeamQueue === 'function') renderTeamQueue();
}

// ---- tiers -------------------------------------------------------------------------------------
const TIER_WORDS = { 1: 'a result', 2: 'something we changed', 3: 'the work done' };
function winTier(d){ const t = Number(d && d.winTier); return t >= 1 && t <= 3 ? t : null; }
function tierTag(t, long){ return t ? `<span class="wn-t t${t}">Tier ${t}${long ? ' · ' + TIER_WORDS[t] : ''}</span>` : ''; }
async function setWinTier(clientId, author, t){
  document.getElementById('winMenu')?.remove();
  const c = clients.find(x => x.id === clientId); if(!c) return;
  const d = getDraftFor(c, author), prev = d.winTier;
  d.winTier = t || null; winsRerender();
  if(!(await saveDraftFor(clientId, author, { winTier: t || null }))){ d.winTier = prev; winsRerender(); showToast('error', 'Couldn’t save the tier', 'Try again in a moment.'); }
}

// ---- WhatsApp text -------------------------------------------------------------------------------
// Bullets as •, **bold** as *bold*: WhatsApp's own formatting.
function waText(draft){
  return String(draft || '').replace(/\r/g, '').split('\n')
    .map(l => l.replace(/^\s*[-*•]\s+/, '• ').replace(/\*\*(.+?)\*\*/g, '*$1*').replace(/__(.+?)__/g, '_$1_')).join('\n').trim();
}
// How it will look in the group: WhatsApp's own chat, with the group's name on top, a day chip, and
// your message as an outgoing bubble at WhatsApp's width. The text keeps its real line breaks (a blank
// line is a blank line there too) and WhatsApp's *bold*, _italic_, ~strike~ and ```code```. Sent ones
// get the blue ticks.
function waBubbleHtml(draft, at, opts){
  const o = opts || {}, sent = !!at, when = at || rNow();
  const fmt = t => escapeHtml(t)
    .replace(/```([^`]+)```/g, '<code>$1</code>')
    .replace(/(^|[\s(“"'])\*([^*\n]+)\*(?=$|[\s).,!?:;”"'])/gm, '$1<b>$2</b>')
    .replace(/(^|[\s(“"'])_([^_\n]+)_(?=$|[\s).,!?:;”"'])/gm, '$1<i>$2</i>')
    .replace(/(^|[\s(“"'])~([^~\n]+)~(?=$|[\s).,!?:;”"'])/gm, '$1<s>$2</s>');
  const d0 = dayStart(when), k = daysBetween(d0, dayStart(rNow()));
  const chip = k === 0 ? 'Today' : k === 1 ? 'Yesterday' : when.toLocaleDateString('en-US', { weekday: k < 7 ? 'long' : undefined, month: k < 7 ? undefined : 'short', day: k < 7 ? undefined : 'numeric' });
  const ticks = `<svg class="wn-tk" viewBox="0 0 16 11" aria-hidden="true"><path d="M11.07.65 4.98 7.15 2.53 4.62 1.47 5.65l3.53 3.64L12.1 1.68z"/><path d="M15.07.65 8.98 7.15l-.83-.86-1.05 1.03 1.9 1.97 7.1-7.61z"/></svg>`;
  const head = o.group ? `<div class="wn-hd"><b>${escapeHtml(o.group)}</b><span>WhatsApp group</span></div>` : '';
  return `<div class="wn-chat${sent ? ' is-sent' : ''}">${head}<div class="wn-sc"><span class="wn-day">${escapeHtml(chip)}</span>`
    + `<div class="wn-b"><span class="wn-txt">${fmt(waText(draft))}</span><span class="wn-sp" aria-hidden="true"></span><span class="wn-meta"><time>${escapeHtml(fmtTime(when))}</time>${sent ? ticks : ''}</span></div></div></div>`;
}
function copyToClipboard(text){
  if(navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  return Promise.resolve(fallbackCopy(text));
}
function fallbackCopy(text){
  const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select(); try{ document.execCommand('copy'); }catch(e){} ta.remove();
}

// ---- who sends an approved WhatsApp win ------------------------------------------------------------
// ready: approved, nobody has copied it (its writer sends it) · copied: someone has it · sent
function winSendState(d){
  if(!d) return { k: 'none' };
  if(d.draftSentAt) return { k: 'sent', by: d.draftSentBy, at: d.draftSentAt, seen: d.waSeenAt };
  if(d.draftStatus !== 'approved') return { k: 'none' };
  if(d.waCopiedBy) return { k: 'copied', by: d.waCopiedBy, at: d.waCopiedAt };
  return { k: 'ready', by: d.author };
}
function winSender(d){ const s = winSendState(d); return s.k === 'copied' ? s.by : d ? d.author : ''; }
function mayCopyWin(d){ return !!d && (canApprove() || d.author === myName()); }
function winGroupWords(c){ const g = winGroupFor(c); return g ? winCleanGroupName(g.name) : 'their WhatsApp group'; }

// Copy it for WhatsApp, and claim the send. If someone else already copied it, warn first.
async function copyWinForWhatsapp(clientId, author, force, anchor){
  document.getElementById('winPop')?.remove();
  const c = clients.find(x => x.id === clientId); if(!c) return;
  const d = getDraftFor(c, author), me = myName();
  if(!d.draft){ showToast('error', 'Nothing to copy', 'This win has no text yet.'); return; }
  const st = winSendState(d);
  if(st.k === 'sent'){ showToast('info', 'Already sent', `${st.by === me ? 'You' : st.by || 'Someone'} sent it ${relDayLower(new Date(st.at))}.`); return; }
  if(st.k === 'copied' && st.by !== me && !force){ winGuard(clientId, author, st.by, st.at, anchor); return; }
  // The text goes on the clipboard straight away, while the click still counts as yours.
  const copied = copyToClipboard(waText(d.draft));
  let took = null;
  if(winsDbReady()){
    const { data, error } = await supabaseClient.rpc('win_claim', { p_client: String(clientId), p_author: author, p_force: !!force });
    if(error || !data){ showToast('error', 'Copied, but not shared with the team', 'Others won’t see that you’re sending it. Try again in a moment.'); }
    else if(!data.ok){
      if(data.reason === 'copied'){
        await copied; copyToClipboard('');
        Object.assign(d, { waCopiedBy: data.copied_by, waCopiedAt: data.copied_at }); winsRerender();
        showToast('error', `${firstName(data.copied_by)} just copied it`, 'Don’t paste it. Check the group first.');
        return;
      }
      if(data.reason === 'sent'){ await copied; copyToClipboard(''); Object.assign(d, { draftSentAt: data.sent_at, draftSentBy: data.sent_by, waSeenAt: data.seen_at || null }); winsRerender(); showToast('info', 'Already sent', `${data.sent_by || 'Someone'} sent it.`); return; }
      if(data.reason === 'not_allowed'){ await copied; copyToClipboard(''); showToast('error', 'Not yours to send', `${firstName(author)} sends this one.`); return; }
      if(data.reason === 'not_approved'){ await copied; copyToClipboard(''); showToast('error', 'Not approved yet', 'An approver approves it first.'); return; }
    } else { Object.assign(d, { waCopiedBy: data.copied_by, waCopiedAt: data.copied_at, sentVia: 'whatsapp' }); took = data.took_from; }
  } else Object.assign(d, { waCopiedBy: me, waCopiedAt: new Date().toISOString(), sentVia: 'whatsapp' });
  await copied;
  if(took){
    const p = profileByName(took);
    if(p && typeof sendNotification === 'function') sendNotification(p.id, 'win_taken', `${c.name}: ${me} is sending the win`, `${me} copied it for WhatsApp, so you don’t need to send it.`, 'approve', c.id);
  }
  typeof logClientActivity === 'function' && logClientActivity(clientId, 'win_copied', `${me || 'Someone'} copied ${author}'s win for WhatsApp.`);
  winsRerender();
  const auto = winsDbReady() && winGroupFor(c);
  showToast('success', 'Copied for WhatsApp', auto ? `Paste it in ${winGroupWords(c)}. Radar marks it sent when it sees it there.` : `Paste it in ${winGroupWords(c)}, then mark it sent.`);
}
// Someone else copied it: say so, and only send it yourself on purpose.
function winGuard(clientId, author, by, at, anchor){
  const c = clients.find(x => x.id === clientId); if(!c) return;
  const when = at ? fmtTime(new Date(at)) : '', who = firstName(by) || 'Someone';
  const short = typeof shortClientName === 'function' ? shortClientName(c.name) : c.name;
  const html = `<span class="wn-gi">${icon('copy')}</span>
<b>${escapeHtml(who)} already copied this</b>
<p>${escapeHtml(who)} copied it${when ? ' at ' + escapeHtml(when) : ''} and Radar hasn’t seen it in the group yet. Check the group first, or ${escapeHtml(short)} gets the same win twice.</p>
<p class="wn-gs">If you send it, ${escapeHtml(who)}’s copy button turns off and ${escapeHtml(who)} sees that you sent it.</p>
<div class="wn-ga"><button class="btn" onclick="document.getElementById('winPop')?.remove()">Cancel</button><button class="btn wn-gp" onclick="copyWinForWhatsapp('${clientId}',${jsArg(author)},true)">Send It Myself</button></div>`;
  winPopover(anchor, html, 'wn-guard', `${who} already copied this`);
}
// A small popover over the button that opened it (centered if there's no button).
function winPopover(anchor, html, cls, label){
  document.getElementById('winPop')?.remove();
  const p = document.createElement('div');
  p.id = 'winPop'; p.className = 'wn-pop-card ' + (cls || ''); p.setAttribute('role', 'alertdialog'); if(label) p.setAttribute('aria-label', label);
  p.innerHTML = html;
  document.body.appendChild(p);
  const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null, pw = p.offsetWidth, ph = p.offsetHeight;
  if(r && r.width){
    const left = Math.max(12, Math.min(window.innerWidth - pw - 12, r.right - pw + 16));
    const above = r.top - ph - 12 > 8;
    p.style.left = left + 'px'; p.style.top = (above ? r.top - ph - 12 : r.bottom + 12) + 'px';
    p.classList.add(above ? 'is-up' : 'is-down'); p.style.setProperty('--tip', Math.min(pw - 24, Math.max(18, r.left + r.width / 2 - left)) + 'px');
  } else { p.style.left = (window.innerWidth - pw) / 2 + 'px'; p.style.top = Math.max(40, (window.innerHeight - ph) / 3) + 'px'; }
  p.querySelector('.wn-gp, .btn')?.focus();
  const close = e => { if(!p.isConnected){ cleanup(); return; } if(e.type === 'keydown' ? e.key === 'Escape' : !p.contains(e.target)){ p.remove(); cleanup(); } };
  const cleanup = () => { document.removeEventListener('mousedown', close, true); document.removeEventListener('keydown', close, true); };
  setTimeout(() => { document.addEventListener('mousedown', close, true); document.addEventListener('keydown', close, true); }, 0);
}
async function markWinSent(clientId, author){
  const c = clients.find(x => x.id === clientId); if(!c) return;
  const d = getDraftFor(c, author), me = myName();
  let ok = false, at = new Date().toISOString(), by = me;
  if(winsDbReady()){
    const { data, error } = await supabaseClient.rpc('win_mark_sent', { p_client: String(clientId), p_author: author });
    ok = !error && data && data.ok;
    if(ok && data.sent_at){ at = data.sent_at; by = data.sent_by || me; }
    if(!ok && data && data.reason === 'not_allowed'){ showToast('error', 'Not yours to mark', `${firstName(winSender(d))} sends this one.`); return; }
  } else ok = await saveDraftFor(clientId, author, { draftSentAt: at, draftSentBy: me || 'Someone' });
  if(!ok){ showToast('error', 'Couldn’t mark it sent', 'Try again in a moment.'); return; }
  Object.assign(d, { draftSentAt: at, draftSentBy: by, sentVia: d.sentVia || 'whatsapp' });
  if(typeof recordUpdateSent === 'function') await recordUpdateSent(clientId, at);
  if(typeof tellContributorsSent === 'function') await tellContributorsSent(c, d, 'whatsapp');
  typeof logClientActivity === 'function' && logClientActivity(clientId, 'draft_sent', `${by || 'Someone'} sent ${author}'s win in the WhatsApp group.`);
  winsRerender();
  showToast('success', 'Marked as sent', `${c.name} got this week’s win.`);
}
// An approver approving someone else's WhatsApp win: it goes back to them to send.
async function approveWin(clientId, author){
  const c = clients.find(x => x.id === clientId); if(!c) return;
  if((await approveDraft(clientId, author)) === false) return;
  const p = author !== myName() ? profileByName(author) : null;
  if(p && typeof sendNotification === 'function') await sendNotification(p.id, 'win_approved', `${c.name}: your update is approved`, 'It’s yours to send: copy it from your Queue and paste it in the WhatsApp group.', 'teamqueue', c.id);
}
// Your own WhatsApp win: approve it and copy it in one go.
async function approveAndCopyWin(clientId, author){
  if((await approveDraft(clientId, author)) === false) return;
  await copyWinForWhatsapp(clientId, author);
}

// ---- the client's status in a sentence (client panel) -------------------------------------------------
// "Over budget, and updates keep slipping"
function healthPhrase(h, c){
  const words = h.signals.map(s => ({
    hours: h.hp.used > h.hp.budget ? 'over budget' : 'on pace to go over budget', under: 'hours under-used',
    noupdate: 'updates keep slipping', late: 'updates keep slipping', quiet: 'nothing logged lately',
    tasks: s.title.toLowerCase(), flag: 'flagged by ' + (firstName(clientOwner(c)) || 'the owner') }[s.key] || s.title.toLowerCase()));
  const u = [...new Set(words)];
  if(!u.length) return '';
  const txt = u.length === 1 ? u[0] : `${u.slice(0, -1).join(', ')}, and ${u[u.length - 1]}`;
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

// ---- small menus: the tier, how the client gets it, its group, its win day ------------------------------
function winMenu(e, items, id){
  e.stopPropagation();
  const had = document.getElementById('winMenu'); had?.remove();
  if(had && had.dataset.for === id) return;
  const m = document.createElement('div');
  m.className = 'menu'; m.id = 'winMenu'; m.dataset.for = id || ''; m.setAttribute('role', 'menu');
  Object.assign(m.style, { position: 'fixed', zIndex: '1200' });
  m.innerHTML = items.map(it => it === '-' ? '<div class="msep"></div>'
    : `<button class="mi${it.on ? ' is-on' : ''}" role="menuitemradio" aria-checked="${!!it.on}" onclick="${it.fn}">${it.on ? icon('check') : '<span class="mi-sp"></span>'}${it.html}</button>`).join('');
  document.body.appendChild(m);
  const r = e.currentTarget.getBoundingClientRect(), mh = m.offsetHeight;
  m.style.top = (r.bottom + 4 + mh > window.innerHeight - 8 ? Math.max(8, r.top - mh - 4) : r.bottom + 4) + 'px';
  m.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
  setTimeout(() => document.addEventListener('click', () => m.remove(), { once: true }), 0);
}
function winTierMenu(e, clientId, author){
  const c = clients.find(x => x.id === clientId); if(!c) return;
  const t = winTier(getDraftFor(c, author)), A = `'${clientId}',${jsArg(author)}`;
  winMenu(e, [1, 2, 3].map(k => ({ on: t === k, fn: `setWinTier(${A},${k})`, html: `${tierTag(k)}<span class="wn-mt">${TIER_WORDS[k]}</span>` }))
    .concat(['-', { on: !t, fn: `setWinTier(${A},null)`, html: 'No tier yet' }]), 'tier' + clientId);
}
function winChannelMenu(e, clientId){
  const c = clients.find(x => x.id === clientId); if(!c) return;
  const ch = winChannel(c);
  const off = !getsUpdates(c);
  winMenu(e, [['whatsapp', 'WhatsApp', 'message-circle'], ['email', 'Email', 'envelope-simple'], ['both', 'Both', 'layers']]
    .map(([k, t, ic]) => ({ on: !off && ch === k, fn: `setWinChannel('${clientId}','${k}')`, html: `${icon(ic)}${t}` }))
    .concat(['-', { on: off, fn: `setWeeklyUpdate('${clientId}',false)`, html: `${icon('minus-circle')}No weekly update <span class="wn-mt">the agency, internal</span>` }]), 'ch' + clientId);
}
function winGroupMenu(e, clientId){
  const c = clients.find(x => x.id === clientId); if(!c) return;
  const g = winGroupFor(c), list = winGroups.filter(x => x.active !== false).slice().sort((a, b) => winCleanGroupName(a.name).localeCompare(winCleanGroupName(b.name)));
  if(!list.length){ showToast('info', 'No WhatsApp groups yet', 'Once an admin links WhatsApp in Settings → WhatsApp, pick the group here.'); return; }
  winMenu(e, list.map(x => ({ on: g && g.jid === x.jid, fn: `setWinGroup('${clientId}',${jsArg(x.jid)})`,
    html: `<span>${escapeHtml(x.name)}</span>${x.client_id && String(x.client_id) !== String(clientId) ? `<span class="wn-mt">${escapeHtml((clients.find(k => String(k.id) === String(x.client_id)) || {}).name || 'another client')}</span>` : ''}` }))
    .concat(g && String(g.client_id || '') === String(clientId) ? ['-', { on: false, fn: `setWinGroup('${clientId}',null)`, html: 'Unlink This Group' }] : []), 'grp' + clientId);
}
function winDayMenu(e, clientId){
  const c = clients.find(x => x.id === clientId); if(!c) return;
  const d = winDay(c);
  winMenu(e, [1, 2, 3, 4, 5].map(k => ({ on: d === k, fn: `setWinDay('${clientId}',${k})`, html: WIN_DAY_NAMES[k] }))
    .concat(['-', { on: !d, fn: `setWinDay('${clientId}','')`, html: 'No set day <span class="wn-mt">every 7 days</span>' }]), 'day' + clientId);
}
// Copy the text only (a client on WhatsApp and email, once the email is out).
function copyWinText(clientId, author){
  const c = clients.find(x => x.id === clientId); if(!c) return;
  copyToClipboard(waText(getDraftFor(c, author).draft)).then(() => showToast('success', 'Copied for WhatsApp', `Paste it in ${winGroupWords(c)}.`));
}
// The client's panel on All Clients, where its win settings are.
function openClientInspectorFor(id){ inspectedClientId = id; switchView('clients'); if(typeof renderClientsTable === 'function') renderClientsTable(); }
