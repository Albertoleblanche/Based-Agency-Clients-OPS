// Message as you (Nov 24): one sheet for every nudge to a teammate — Remind Approvers (Queue), a
// WhatsApp request nobody has answered, an overdue task, a client at risk (Health), a draft sent
// back (Review), a WhatsApp hand-off.
//
// Who (ticked, each saying how it reaches them), an editable message, then Send: from your own Slack,
// as you ("Hi Dan, …" and a link that opens the item), and to their bell in Radar (opening the item).
// Radar's own Slack message goes only where yours can't (your Slack not connected, or theirs not
// linked), so nobody gets it twice. When it was last sent is remembered, so the button can say so.
//
// nudgeSheet({
//   title, sub,                     heading and the line under it
//   to: [profile], pick,            who; pick: true shows them as ticked choices (else just named)
//   text,                           the message, editable
//   link: { view, id, label },      the item, for the link in Slack (itemLink) and the bell notice
//   notif: { type, title },         the bell notice (its body is the message)
//   key,                            remembers when it was sent (nudgeWhen(key))
//   sendLabel, onSent(people)       the button's words; after sending
// })

const NUDGE_SENT_KEY = 'nudge-sent';
function nudgeWhen(key){
  if(!key) return null;
  try{ const v = JSON.parse(localStorage.getItem(NUDGE_SENT_KEY) || '{}')[key]; return v ? new Date(v) : null; }catch(e){ return null; }
}
function nudgeMark(key){
  if(!key) return;
  try{
    const m = JSON.parse(localStorage.getItem(NUDGE_SENT_KEY) || '{}'); m[key] = new Date().toISOString();
    const keep = Object.entries(m).sort((a, b) => String(b[1]).localeCompare(String(a[1]))).slice(0, 200);
    localStorage.setItem(NUDGE_SENT_KEY, JSON.stringify(Object.fromEntries(keep)));
  }catch(e){}
}
// "Nudged at 3:40 PM" / "Nudged yesterday", for beside the button
function nudgeWhenWords(key, verb){
  const at = nudgeWhen(key); if(!at) return '';
  const day = typeof relDayLower === 'function' ? relDayLower(at) : '';
  return `${verb || 'Nudged'} ${day === 'today' ? 'at ' + fmtTime(at) : day}`;
}
function nudgeList(names){ return names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]; }

let nudgeOpts = null;
async function nudgeSheet(o){
  const people = (o.to || []).filter(p => p && !p.access_revoked && p.id !== currentUser.id);
  if(!people.length){ showToast('info', 'Nobody to send it to', o.nobody || 'They’re not on the team anymore.'); return; }
  const sm = typeof remSlackMeStatus === 'function' ? (typeof slackMe !== 'undefined' && slackMe && !slackMe.checking ? slackMe : await remSlackMeStatus(true)) : {};
  nudgeOpts = Object.assign({}, o, { to: people });
  const via = p => sm.connected && p.slack_user_id ? 'Slack, as you' : p.slack_user_id ? 'Slack, from Radar' : 'Radar only';
  const who = o.pick
    ? `<div class="pick-people" id="ndTo">${people.map(p => `<label class="pick nd-p"><input type="checkbox" class="ck-native" value="${p.id}" checked onchange="nudgeNote()"><span>${escapeHtml(p.name)}</span><span class="nd-via">${via(p)}</span></label>`).join('')}</div>`
    : `<div class="nd-one" id="ndTo" data-ids="${people.map(p => p.id).join(',')}">${people.map(p => `<span class="nd-who"><b>${escapeHtml(p.name)}</b><span class="nd-via">${via(p)}</span></span>`).join('')}</div>`;
  openAppModal(`<h3>${escapeHtml(o.title || 'Send a Message')}</h3>
${o.sub ? `<p class="t-2" style="margin:-8px 0 14px;font-size:14px">${escapeHtml(o.sub)}</p>` : ''}
<div class="f">
<label class="top">To</label>${who}
<label class="top" for="ndText">Message</label><div><textarea id="ndText" class="tf" rows="4" spellcheck="true" oninput="nudgeNote()">${escapeHtml(o.text || '')}</textarea>
<p class="nd-note" id="ndNote"></p></div>
</div>
<div class="sheet-a">${!sm.connected && sm.configured ? `<button class="btn" style="margin-right:auto" onclick="slackMeConnect()">Connect Your Slack…</button>` : ''}<button class="btn" onclick="closeAppModal()">Cancel</button><button class="btn btn-p" id="ndSend" onclick="nudgeSend()">${icon('paper-plane-tilt')}${escapeHtml(o.sendLabel || 'Send')}</button></div>`, 560);
  nudgeNote();
  setTimeout(() => { const t = document.getElementById('ndText'); if(t){ t.focus({ preventScroll: true }); t.setSelectionRange(t.value.length, t.value.length); } }, 30);
}
function nudgePicked(){
  const o = nudgeOpts || {}, el = document.getElementById('ndTo'); if(!el) return [];
  const ids = o.pick ? [...el.querySelectorAll('input:checked')].map(i => i.value) : String(el.dataset.ids || '').split(',');
  return (o.to || []).filter(p => ids.includes(p.id));
}
// Says exactly where it goes, for who's picked
function nudgeNote(){
  const n = document.getElementById('ndNote'), btn = document.getElementById('ndSend'); if(!n) return;
  const to = nudgePicked(), sm = (typeof slackMe !== 'undefined' && slackMe) || {}, first = p => firstName(p.name);
  if(btn) btn.disabled = !to.length || !(document.getElementById('ndText')?.value || '').trim();
  if(!to.length){ n.textContent = 'Pick who it’s for.'; return; }
  const asMe = to.filter(p => sm.connected && p.slack_user_id), bot = to.filter(p => !(sm.connected && p.slack_user_id) && p.slack_user_id), none = to.filter(p => !p.slack_user_id);
  const L = a => nudgeList(a.map(first)), bits = [];
  if(asMe.length) bits.push(`from your Slack, as you, to ${L(asMe)} (starting “Hi ${first(asMe[0])},”)`);
  if(bot.length) bits.push(`on Slack from Radar to ${L(bot)}${sm.configured && !sm.connected ? ' (connect your Slack to send it as you)' : ''}`);
  if(none.length) bits.push(`${L(none)} ${none.length === 1 ? 'has' : 'have'} no Slack linked, so in Radar only`);
  n.textContent = `It goes to their bell in Radar${(nudgeOpts || {}).link ? ', with a link to it' : ''}, and ${bits.join('; ')}.`;
}
async function nudgeSend(){
  const o = nudgeOpts || {}, text = (document.getElementById('ndText')?.value || '').trim(), to = nudgePicked();
  if(!text || !to.length) return;
  const btn = document.getElementById('ndSend'); setBtnLoading(btn, 'Sending…');
  const sm = (typeof slackMe !== 'undefined' && slackMe) || {}, me = firstName(myName() || 'A teammate');
  const url = o.link ? itemLink(o.link.view, o.link.id) : '';
  let asMe = 0, lost = false;
  for(const p of to){
    let sentAsMe = false;
    if(sm.connected && p.slack_user_id && !lost){
      try{
        const res = await fetch('/api/integrations', { method: 'POST', headers: await apiAuthHeaders(),
          body: JSON.stringify({ provider: 'slack-me', action: 'send', toProfileId: p.id, text: `Hi ${firstName(p.name)}, ${text}${url ? `\n<${url}|${o.link.label || 'Open it in Radar'}>` : ''}` }) });
        const out = await res.json().catch(() => ({}));
        if(out.ok){ sentAsMe = true; asMe++; }
        else if(out.notConnected){ lost = true; if(typeof slackMe !== 'undefined') slackMe = Object.assign({}, slackMe, { connected: false }); }
      }catch(e){}
    }
    // the bell (and their phone); Radar's own Slack message only where yours didn't go
    const n = o.notif || {};
    await sendNotification(p.id, n.type || 'nudge', typeof n.title === 'function' ? n.title(p) : (n.title || `${me} sent you a message`), text.replace(/^./, x => x.toUpperCase()),
      o.link ? o.link.view : null, o.link ? o.link.id : null, false, { noSlack: sentAsMe });
  }
  nudgeMark(o.key);
  restoreBtn(btn); closeAppModal();
  const names = to.map(p => firstName(p.name));
  showToast('success', `${o.sentWord || 'Sent'} to ${nudgeList(names)}`, asMe === to.length ? 'On Slack as you, and in Radar.' : asMe ? `On Slack as you to ${asMe}, the rest from Radar; and in Radar.` : lost ? 'Your Slack connection ended, so it went from Radar. Connect it again in Settings.' : to.some(p => p.slack_user_id) ? 'In Radar, and on Slack from Radar.' : 'In Radar.');
  if(typeof o.onSent === 'function') try{ o.onSent(to); }catch(e){}
}
