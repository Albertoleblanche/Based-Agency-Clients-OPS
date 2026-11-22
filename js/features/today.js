// What's yours today, worked out once (todayModel): the one thing to do now, the rest in the app's
// order, what waits on others, and what's done. The Dashboard's "Today's focus" draws it, and the
// week board (This Week) uses it for today's column. The Today tab itself was removed (Nov 19).

const CHEV = () => icon('caret-right', { cls: 'go', weight: 'bold' });
function todayPlural(n, one, many){ return `${n} ${n === 1 ? one : (many || one + 's')}`; }

// Drafts waiting on the person looking at the screen. Approvers: what the team sent for
// review plus their own drafts. Everyone else: their own drafts that are written.
function todayWaitingDrafts(){
  const me = myName(), approver = canApprove(), out = [];
  attentionEligibleClients().forEach(c => (c.drafts || []).forEach(d => {
    if(d.draftStatus !== 'pending' || d.draftSentAt || draftHasNoWork(c, d)) return;   // a draft with nothing behind it isn't waiting on anyone
    const mine = d.author === me;
    if(approver ? (mine || d.readyToNotify === true) : mine){
      const count = (d.draftImprovementIds || []).length || c.improvements.filter(i => i.author === d.author).length;
      out.push({ c, d, count });
    }
  }));
  out.sort((a, b) => new Date(a.d.draftPendingSince || 0) - new Date(b.d.draftPendingSince || 0));
  return out;
}
function myClientsFilter(c){ return canApprove() || clientOwner(c) === myName(); }

async function remindHolder(clientId, quiet){
  const c = clients.find(x => x.id === clientId); if(!c) return;
  const w = clientWeek(c), who = w.holder === 'approvers' ? null : profileByName(w.holder || w.owner);
  if(!who){ if(!quiet) showToast('info', 'Nobody to remind', 'This update is waiting on approvers.'); return null; }
  const next = w.behind != null ? ['log the week’s work', 'send the draft for review', 'approve it', 'send it'][w.behind] : 'get it ready';
  await sendNotification(who.id, 'update_behind', `${c.name}: this week’s update is ${w.late ? 'overdue' : 'due'}`,
    `${w.dueText}. Next: ${next}.`, 'approve', c.id);
  if(!quiet) showToast('success', `Reminded ${firstName(who.name)}`, 'In the app, and on Slack if they use it.');
  return who;
}
async function remindHolders(ids){
  const people = new Set();
  for(const id of ids){ const who = await remindHolder(id, true); if(who) people.add(firstName(who.name)); }
  if(people.size) showToast('success', `Reminded ${joinNames([...people])}`, 'In the app, and on Slack if they use it.');
}
function joinNames(a){ return a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }

// Weeks of on-time history for every client, oldest first: o on time · l late · m missed · '' none.
function todayWeekCodes(c, weeks){
  const now = rNow(), sends = sentTimes(c), first = sends[0], out = [];
  const monday = dayStart(addDays(now, -((now.getDay() + 6) % 7)));
  for(let k = weeks; k >= 1; k--){
    const from = addDays(monday, -7 * k), to = addDays(from, 7);
    const i = sends.findIndex(t => t >= from && t < to);
    if(i >= 0) out.push(i > 0 && daysBetween(sends[i - 1], sends[i]) > UPDATE_EVERY_DAYS ? 'l' : 'o');
    else out.push(!first || first >= to ? '' : 'm');
  }
  return out;
}
// The step a row's button takes, from where the update is and who it's waiting on.
function todayRowAction(w){
  const me = myName(), d = w.draft, c = w.c;
  const holder = w.holder && w.holder !== 'approvers' ? w.holder : null;
  if(w.done >= 3 && typeof winViaWhatsapp === 'function' && winViaWhatsapp(c)){
    // a WhatsApp win: its sender copies it (whoever wrote it, unless someone else already copied it)
    const st = winSendState(d), sender = st.k === 'copied' ? st.by : d.author;
    if(sender === me) return st.k === 'copied' ? [`markWinSent('${c.id}',${jsArg(d.author)})`, 'Mark as Sent'] : [`copyWinForWhatsapp('${c.id}',${jsArg(d.author)})`, 'Copy for WhatsApp'];
    return [`openWeekClient('${c.id}')`, 'Open'];
  }
  if(w.done >= 3) return canApprove() ? [`sendApprovedDraft('${c.id}',${jsArg(d.author)})`, 'Send Now'] : d && d.author === me ? [`openReviewDraft('${c.id}',${jsArg(d.author)})`, 'Open'] : [`openWeekClient('${c.id}')`, 'Open'];
  if(w.done === 2) return canApprove() || (d && d.author === me) ? [`openReviewDraft('${c.id}',${jsArg(d.author)})`, 'Open'] : [`openWeekClient('${c.id}')`, 'Open'];
  if(holder && holder !== me) return [`remindHolder('${c.id}')`, 'Remind ' + firstName(holder)];
  if(d && draftHasNoWork(c, d)) return w.logged.some(i => i.author === me && i.includeInEmail !== false) ? [`generateDraft('${c.id}',${jsArg(me)})`, 'Rewrite Draft'] : [`openQueueLogImprovementModal('${c.id}')`, 'Log Improvement'];
  if(d) return [`sendDraftForReview('${c.id}',${jsArg(d.author)})`, 'Send for Review'];
  if(w.forEmail.length) return [`generateDraft('${c.id}',${jsArg(me)})`, 'Write Draft'];
  return [`openQueueLogImprovementModal('${c.id}')`, 'Log Improvement'];
}
// An approved WhatsApp win is sent by whoever copies it: its writer, unless someone else already did.
function todayWaSender(w){
  if(!(w.done >= 3 && w.draft && typeof winViaWhatsapp === 'function' && winViaWhatsapp(w.c))) return null;
  const st = winSendState(w.draft); return st.k === 'copied' ? st.by : w.draft.author;
}
function todayNames(list){
  const names = list.map(c => shortClientName(c.name));
  return names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
}
// "Write a draft for Brightway" — the update row in plain words, from what it's waiting on.
function todayUpdateTitle(w){
  const n = shortClientName(w.c.name);
  if(w.done >= 3) return `Send ${n}’s approved update`;
  if(w.done === 2) return `Review ${n}’s draft`;
  if(w.draft) return `Send ${n}’s draft for review`;
  if(w.forEmail.length) return `Write ${n}’s update`;
  return `Log this week’s work for ${n}`;
}
function hmText(min){ min = Math.round(min); const h = Math.floor(min / 60), m = min % 60; return h ? `${h} h${m ? ' ' + m + ' m' : ''}` : `${m} m`; }

// Everything Today shows, worked out once: the lead, what else is yours, what's waiting on others,
// and what's done. The page draws it; the layout can change without touching this.
function todayModel(){
  const me = myName(), approver = canApprove(), now = rNow(), todayStr = toDateStr(now);
  const list = attentionEligibleClients();
  const ws = list.map(clientWeek);
  const behind = ws.filter(w => myClientsFilter(w.c) && needsUpdate(w)).sort(dueOrder);
  const waiting = todayWaitingDrafts();
  const myTasks = (typeof tasks !== 'undefined' ? tasks : []).filter(t => t.assigneeId === currentUser?.id && !t.cancelledAt);

  // ---- Up next: the one main action ----
  const used = new Set();
  let lead = null;
  if(approver && waiting.length){
    waiting.forEach(x => used.add(x.c.id));
    const dues = [...new Set(waiting.map(x => { const w = clientWeek(x.c); return w.sent ? w.due.getDay() : -1; }))];
    const names = waiting.map(x => shortClientName(x.c.name));
    const sub = `${names.length <= 4 ? joinNames(names) : names.slice(0, 3).join(', ') + ` and ${names.length - 3} more`} · oldest waiting ${fmtWait(waiting[0].d.draftPendingSince || now)}${dues.length === 1 && dues[0] >= 0 ? ' · all due ' + DAY_NAMES[dues[0]] : ''}`;
    lead = { ic: 'tray', tone: 'blue', title: `Review ${todayPlural(waiting.length, 'draft')}`, sub, go: `openReviewDraft('${waiting[0].c.id}',${jsArg(waiting[0].d.author)})`, label: 'Start Review' };
  } else if(!approver && waiting.some(x => !x.d.readyToNotify)){
    const mineW = waiting.filter(x => !x.d.readyToNotify); mineW.forEach(x => used.add(x.c.id));
    lead = { ic: 'send', tone: 'blue', title: `Send ${todayPlural(mineW.length, 'draft')} for review`, sub: joinNames(mineW.map(x => shortClientName(x.c.name))), go: `openWeekClient('${mineW[0].c.id}')`, label: 'Open Draft' };
  } else {
    const w = behind.find(x => todayWaSender(x) ? todayWaSender(x) === me || approver : !x.holder || x.holder === me || x.holder === 'approvers' && approver);
    if(w){ used.add(w.c.id); const [go, label] = todayRowAction(w);
      lead = { c: w.c, title: todayUpdateTitle(w), sub: `${w.late ? overdueShort(w) : 'Due today'} · ${w.note || ''}`, go, label }; }
  }

  // ---- Also today: everything else that waits on you; Waiting on others: what doesn't ----
  const items = [], others = [];
  behind.filter(w => !used.has(w.c.id)).forEach(w => {
    used.add(w.c.id);
    const holder = w.holder && w.holder !== 'approvers' ? w.holder : null;
    const wa = todayWaSender(w);
    if(wa ? wa !== me && !approver : holder && holder !== me){ others.push(w); return; }
    if(!wa && w.holder === 'approvers' && !approver){ others.push(w); return; }
    const [go, step] = todayRowAction(w);
    items.push({ src: 'update', age: w.late ? -w.daysLeft : 0, c: w.c, title: todayUpdateTitle(w), sub: `${escapeHtml(w.c.name)}${w.note ? ' · ' + escapeHtml(w.note) : ''}`, late: !!w.late, when: w.late ? overdueShort(w) : '', step, go });
  });
  list.filter(c => myClientsFilter(c) && !used.has(c.id) && clientHealth(c).level === 'r' && !nextStepTask(c)).forEach(c => {
    used.add(c.id);
    items.push({ src: 'health', c, title: `Plan a next step for ${shortClientName(c.name)}`, sub: `At risk · ${escapeHtml(tableSignal(clientHealth(c), c) || 'no plan yet')}`, late: true, step: 'Plan', go: `planNextStep('${c.id}')` });
  });
  myTasks.filter(t => t.status !== 'done' && t.dueDate && t.dueDate <= todayStr).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || (a.dueTime || '').localeCompare(b.dueTime || '')).forEach(t => {
    const c = clients.find(x => x.id === t.clientId), late = t.dueDate < todayStr;
    const from = t.assignerId && t.assignerId !== currentUser?.id ? (teamProfiles || []).find(p => p.id === t.assignerId) : null;
    const when = late ? todayDueWord(t.dueDate, now) : (t.dueTime ? fmtTime(new Date(t.dueDate + 'T' + t.dueTime)) : '');
    items.push({ src: 'task', age: late ? todayDaysSince(t.dueDate, todayStr) : 0, at: t.dueTime || '', task: t, title: t.title, sub: `${c ? escapeHtml(c.name) : 'Based Agency'}${from ? ' · from ' + escapeHtml(firstName(from.name)) : ''}`, late, when, flag: t.priority === 'high', go: `openTaskDetailModal('${t.id}')`, tick: `moveTaskToStatus('${t.id}','done')` });
  });
  // Everything else that's yours today, from the rest of the app: work you asked for that's back
  // for your review, WhatsApp requests waiting on you, follow-ups with clients, and notes to revisit.
  todayFromElsewhere(todayStr, now).forEach(x => items.push(x));
  // The app picks the order: late first, then high priority, then what has waited longest, then by time.
  items.sort((a, b) => (!!b.late - !!a.late) || (!!b.flag - !!a.flag) || ((b.age || 0) - (a.age || 0)) || (a.at || '~').localeCompare(b.at || '~'));
  // Today stays short: Now, the next three, and the rest as counts that open their tabs.
  if(!lead && items.length){
    const x = items[0];
    lead = { item: x, c: x.c, ic: x.c ? null : 'list-todo', title: x.title, subHtml: `${x.when ? `<span class="t-red">${escapeHtml(x.when)}</span> · ` : ''}${x.sub}`,
      go: x.src === 'task' ? x.tick : x.go, label: x.step || (x.src === 'task' ? 'Mark Done' : 'Open') };
  }
  const queue = lead && lead.item ? items.slice(1) : items.slice();
  const next = queue.slice(0, TODAY_NEXT), rest = queue.slice(TODAY_NEXT);

  // ---- Done today ----
  const done = [];
  list.forEach(c => (c.drafts || []).forEach(d => { if(d.draftSentAt && toDateStr(new Date(d.draftSentAt)) === todayStr && (d.draftSentBy === me || (!d.draftSentBy && d.author === me))) done.push({ t: new Date(d.draftSentAt), title: `Sent ${shortClientName(c.name)}’s update`, sub: c.name }); }));
  const logged = {};
  list.forEach(c => (c.improvements || []).forEach(i => { if(i.author === me && toDateStr(new Date(i.date)) === todayStr){ const k = c.id; logged[k] = logged[k] || { c, n: 0, t: new Date(i.date) }; logged[k].n++; if(new Date(i.date) > logged[k].t) logged[k].t = new Date(i.date); } }));
  Object.values(logged).forEach(x => done.push({ t: x.t, title: `Logged ${todayPlural(x.n, 'improvement')}`, sub: x.c.name }));
  myTasks.filter(t => t.status === 'done' && t.completedAt && toDateStr(new Date(t.completedAt)) === todayStr).forEach(t => {
    const c = clients.find(x => x.id === t.clientId); done.push({ t: new Date(t.completedAt), title: t.title, sub: c ? c.name : 'Based Agency' });
  });
  // WhatsApp requests you answered today (one made into a task shows as the task)
  if(todayWaOn()) waTasks.filter(t => t.status === 'done' && t.owner_user_id === currentUser?.id && t.updated_at && toDateStr(new Date(t.updated_at)) === todayStr && !(waLinkedTask(t) && waLinkedTask(t).status === 'done'))
    .forEach(t => done.push({ t: new Date(t.updated_at), title: t.title, sub: `${waClientLabel(t)} asked on WhatsApp` }));
  // follow-ups the client answered today
  (typeof clientReminders !== 'undefined' ? clientReminders : []).filter(r => r.askedBy === currentUser?.id && r.status !== 'waiting' && r.resolvedAt && toDateStr(new Date(r.resolvedAt)) === todayStr).forEach(r => {
    const c = clients.find(x => x.id === r.clientId); done.push({ t: new Date(r.resolvedAt), title: `${c ? shortClientName(c.name) : 'The client'} answered “${r.question}”`, sub: c ? c.name : 'Answered' });
  });
  done.sort((a, b) => b.t - a.t);

  return { me, approver, now, todayStr, list, ws, behind, waiting, myTasks, lead, items, next, rest, others, done };
}
// ---- The Today tab holds the whole week: › steps to the next day and shows what's due then;
// Whole Week stretches it into the week board (This Week). ----
function todayMonday(now){ now = now || rNow(); return dayStart(addDays(now, -((now.getDay() + 6) % 7))); }
// The days Today can step through: Monday to Friday of this week (and today, on a weekend).
function todayWeekDays(now){
  now = now || rNow(); const mon = todayMonday(now);
  return [0, 1, 2, 3, 4].concat(now.getDay() === 6 ? [5] : now.getDay() === 0 ? [6] : []).map(k => toDateStr(addDays(mon, k)));
}
// ---- Whole Week: this week's days side by side. The open day is wide and the rest are narrow;
// click or hover a day to open it. Each day has its name and date (a blue line on top of today),
// its meetings strip (it widens with the day), and what's due that day with each one's button. ----
function wkStripHtml(ds, isToday){
  const now = rNow(), hour = d => d.getHours() + d.getMinutes() / 60, h0 = 8, h1 = 19, X = h => Math.max(0, Math.min(100, (h - h0) / (h1 - h0) * 100));
  const evs = (typeof calendarEvents !== 'undefined' ? calendarEvents : []).filter(e => !e.allDay && e.startAt && toDateStr(new Date(e.startAt)) === ds).sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
  const blocks = evs.map((e, i) => {
    const s = new Date(e.startAt), en = new Date(e.endAt || s.getTime() + 30 * 60000), past = en <= now;
    const left = X(hour(s)), w = Math.max(1.5, X(hour(en)) - left), end = left + w, nx = evs[i + 1] ? X(hour(new Date(evs[i + 1].startAt))) : 100, room = nx - end;
    return `<span class="ty-m${past ? ' past' : ''}" style="left:${left.toFixed(2)}%;width:${w.toFixed(2)}%" title="${escapeHtml(e.title)} · ${fmtTime(s)}" onclick="event.stopPropagation();openEventDetailModal('${e.id}')"></span>${room > 4 ? `<span class="ty-ml${past ? ' past' : ''}" style="left:calc(${end.toFixed(2)}% + 6px);max-width:calc(${room.toFixed(2)}% - 12px)">${escapeHtml(e.title)}</span>` : ''}`;
  }).join('');
  const nowM = isToday && hour(now) >= h0 && hour(now) <= h1 ? `<span class="ty-now" style="left:${X(hour(now)).toFixed(2)}%"></span>` : '';
  return `<div class="wd-strip"><div class="ty-track">${blocks}${nowM}${evs.length ? '' : '<span class="ty-none">No meetings</span>'}</div></div>`;
}
// One day's rows: today's come from Today (so late ones are here too); other days from what's due then.
function wkDay(ds){
  const todayStr = toDateStr(rNow());
  if(ds !== todayStr){
    const dm = todayDayModel(ds);
    return { items: dm.items, others: dm.others.map(e => ({ c: e.c, who: e.whoFull === 'approvers' ? 'an approver' : e.whoFull ? firstName(e.whoFull) : 'no owner yet' })), done: dm.done };
  }
  const m = todayModel(), mon = todayMonday(), today = dayStart(rNow());
  // Today's lead can bundle drafts ("Review 3 drafts"); the week lists each client on its own row.
  let lead = [];
  if(m.lead && !m.lead.item){
    if(m.lead.c) lead = [{ src: 'update', c: m.lead.c, title: m.lead.title, sub: m.lead.subHtml || escapeHtml(m.lead.sub || ''), go: m.lead.go, step: m.lead.label }];
    else lead = todayWaitingDrafts().filter(x => canApprove() || !x.d.readyToNotify).map(x => {
      const c = x.c, n = shortClientName(c.name), a = jsArg(x.d.author), me = myName(), sub = escapeHtml(c.name);
      if(canApprove()) return { src: 'update', c, title: `Review ${n}’s draft`, sub, go: `openReviewDraft('${c.id}',${a})`, step: 'Open' };
      if(!draftHasNoWork(c, x.d)) return { src: 'update', c, title: `Send ${n}’s draft for review`, sub, go: `sendDraftForReview('${c.id}',${a})`, step: 'Send for Review' };
      const mineLogged = (clientWeek(c).logged || []).some(i => i.author === me && i.includeInEmail !== false);
      return mineLogged ? { src: 'update', c, title: `Rewrite ${n}’s draft`, sub, go: `generateDraft('${c.id}',${jsArg(me)})`, step: 'Rewrite Draft' }
        : { src: 'update', c, title: `Log this week’s work for ${n}`, sub, go: `openQueueLogImprovementModal('${c.id}')`, step: 'Log Improvement' };
    });
  }
  // Who has each of the rest: the same as the board (a copied WhatsApp win is with whoever copied it).
  const who = c => { const f = wbEntry(c, mon, today).whoFull; return f === 'approvers' ? 'an approver' : f ? firstName(f) : 'no owner yet'; };
  return { items: lead.concat(m.items), others: m.others.map(w => ({ c: w.c, who: who(w.c) })), done: m.done };
}
// The icon for what a row asks you to do: review, send, write, log, plan, or open a note.
function wkRowIcon(x){
  if(x.src === 'health') return 'plan';
  if(x.src === 'review') return 'clipboard-check';
  if(x.src === 'note') return 'sticky-note';
  if(x.src === 'wa') return 'messages-square';
  const s = x.step || '';
  if(/^Review /.test(x.title)) return 'scan-eye';
  if(/Write|Rewrite/.test(s)) return 'pen-line';
  if(s === 'Log Improvement') return 'circle-plus';
  if(/^Remind/.test(s)) return 'bell';
  return 'send';
}
function wkRow(x){
  const step = x.step || (x.tick ? '' : 'Open');
  return `<div class="ty-i" onclick="if(wkIsOpen(this)){${x.go}}">${x.tick
      ? `<button class="ty-cb" role="checkbox" aria-checked="false" aria-label="${escapeHtml(x.tickLabel || 'Done')}: ${escapeHtml(x.title)}" onclick="event.stopPropagation();if(wkIsOpen(this)){${x.tick}}"></button>`
      : `<span class="ty-ic" aria-hidden="true">${icon(wkRowIcon(x))}</span>`}<div class="tx"><b>${escapeHtml(x.title)}</b><span>${x.sub || ''}${x.flag ? ' · High priority' : ''}</span></div>${x.when ? `<span class="ty-when${x.late ? ' late' : ''}">${escapeHtml(x.when)}</span>` : ''}${step
      ? `<button class="btn sm ty-step" onclick="event.stopPropagation();${x.go}">${escapeHtml(step)}</button>` : ''}</div>`;
}
// Whole Week from Today opens on today and plays the week growing in around it.
function wkEnterWeek(){ window._weekOpen = toDateStr(rNow()); window._weekPinned = false; window._wkIntro = !wkReducedMotion(); switchView('approve'); renderThisWeek(); }
function wkReducedMotion(){ try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch(e){ return false; } }
function wkIntroPlay(root){
  const wb = root.querySelector('.wb.is-intro'); if(!wb) return;
  if(!wb.querySelector('.wd')){ wb.classList.remove('is-intro'); return; }
  wb.offsetWidth;   // lay out the start (Today full width) before letting it go
  requestAnimationFrame(() => requestAnimationFrame(() => wb.classList.remove('is-intro')));
}
function wkIsOpen(el){ const c = el && el.closest('.wd-c'); return !c || c.classList.contains('on'); }
function weekDaysHtml(){
  const now = rNow(), todayStr = toDateStr(now), days = todayWeekDays(now);
  if(!days.includes(window._weekOpen)) window._weekPinned = false;
  const open = days.includes(window._weekOpen) ? window._weekOpen : days.includes(todayStr) ? todayStr : days[0];
  return `<div class="wd" onmouseleave="wkHover(null)">${days.map(ds => {
    const d = new Date(ds + 'T12:00:00'), isT = ds === todayStr, past = ds < todayStr, name = DAY_NAMES[d.getDay()];
    const m = wkDay(ds), n = m.items.length, off = Math.round((d - new Date(todayStr + 'T12:00:00')) / 864e5);
    const rel = off === 0 ? 'Today' : off === -1 ? 'Yesterday' : off === 1 ? 'Tomorrow' : '';
    // Closed, a day says what's there in counts, like Today's "Also today": "2 updates", "3 tasks (1 late)".
    const sumHtml = n ? `<ul class="wd-sum" aria-label="What’s due">${['update', 'task', 'wa', 'follow', 'review', 'health', 'note'].map(k => {
      const xs = m.items.filter(x => (x.src || 'update') === k); if(!xs.length || !TODAY_SRC[k]) return '';
      const [one, many, , ic] = TODAY_SRC[k], late = k === 'health' ? 0 : xs.filter(x => x.late).length;
      return `<li class="wd-sk">${icon(ic)}<span class="n">${xs.length}</span><span class="w">${xs.length === 1 ? one : many}</span>${late ? `<em>(${late} late)</em>` : ''}</li>`;
    }).join('')}</ul>` : '<p class="wd-sum-none">Nothing due</p>';
    const what = past ? (n ? `${n} still open` : 'Done') : n ? `${n} to do` : 'Nothing to do';
    // Grouped by who has them: "Harbor and Alder (an approver); Brightway (Ana)".
    const byWho = new Map(); m.others.slice(0, 4).forEach(o => byWho.set(o.who, (byWho.get(o.who) || []).concat(shortClientName(o.c.name))));
    const waitTxt = [...byWho].map(([who, names]) => `${joinNames(names)} (${who})`).join('; ') + (m.others.length > 4 ? `; ${m.others.length - 4} more` : '');
    const wait = m.others.length ? `<div class="ty-wait">${icon('clock')}<span><b>With someone else:</b> ${escapeHtml(waitTxt)}</span></div>` : '';
    const sentN = m.done.map(x => (x.title.match(/^Sent (.+)’s update$/) || [])[1]).filter(Boolean), otherD = m.done.filter(x => !/^Sent .+’s update$/.test(x.title)).map(x => x.title);
    const doneTxt = [sentN.length ? `Sent ${joinNames(sentN.slice(0, 5).concat(sentN.length > 5 ? [`${sentN.length - 5} more`] : []))}` : '', otherD.length ? `Done: ${joinNames(otherD.slice(0, 3).concat(otherD.length > 3 ? [`${otherD.length - 3} more`] : []))}` : ''].filter(Boolean).join(' · ');
    const done = m.done.length ? `<p class="wd-done">${icon('check', { weight: 'bold' })}<span>${escapeHtml(doneTxt)}</span></p>` : '';
    return `<section class="wd-c${ds === open ? ' on' : ''}${isT ? ' is-today' : ''}${past ? ' is-past' : ''}" data-day="${ds}" aria-label="${name}" aria-expanded="${ds === open}" tabindex="0" onclick="wkOpen('${ds}')" onkeydown="if(event.key==='Enter')wkOpen('${ds}')" onmouseenter="wkHover('${ds}')">
<header class="wd-h" title="${name}, ${fmtShortDate(d)} · ${what}"><span class="wd-rel">${rel || '&nbsp;'}</span><b class="wd-dow"><span class="wd-l">${name}</span><span class="wd-s">${name.slice(0, 3)}</span></b><span class="wd-dm"><span class="wd-l">${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}</span><span class="wd-s">${fmtShortDate(d)}</span></span></header>${sumHtml}${wkStripHtml(ds, isT)}
<div class="wd-b">${n ? m.items.map(wkRow).join('') : `<p class="wd-none">${past ? 'Everything due that day is done.' : 'Nothing of yours is due.'}</p>`}${wait}${done}</div></section>`;
  }).join('')}</div>`;
}
// Clicking a day opens it and keeps it open, even as the mouse crosses the other days. Until you click,
// hovering a day opens it for a look, and leaving goes back.
function wkSet(ds){ document.querySelectorAll('.wd-c').forEach(c => { const on = c.dataset.day === ds; c.classList.toggle('on', on); c.setAttribute('aria-expanded', on); }); }
function wkOpen(ds){ clearTimeout(window._wkHoverT); window._weekOpen = ds; window._weekPinned = true; wkSet(ds); }
function wkHover(ds){
  clearTimeout(window._wkHoverT);
  if(window._weekPinned) return;   // a day you clicked stays open: hovering the others doesn't move it
  window._wkHoverT = setTimeout(() => {
    const days = todayWeekDays(), todayStr = toDateStr(rNow());
    wkSet(ds || (days.includes(window._weekOpen) ? window._weekOpen : days.includes(todayStr) ? todayStr : days[0]));
  }, ds ? 160 : 260);
}

// What's due on another day of this week: wins due that day (yours, or waiting on approvers if you
// are one), tasks due, follow-ups and notes to come back to. Past days also list what got done.
function todayDayModel(ds){
  const me = myName(), approver = canApprove(), now = rNow(), mon = todayMonday(now), wd = new Date(ds + 'T12:00:00').getDay();
  const items = [], others = [], done = [];
  // A later day skips what's already on Today (a draft to review now isn't also Thursday's), so each client shows once.
  const onToday = ds > toDateStr(now) ? (t => new Set(t.items.concat(t.others).map(x => x.c && x.c.id).filter(Boolean)))(wkDay(toDateStr(now))) : new Set();
  weekVisibleClients().forEach(c => {
    const e = wbEntry(c, mon, dayStart(now));
    if(e.col !== wd || (e.step !== 'sent' && onToday.has(c.id))) return;
    if(e.step === 'sent'){ done.push({ t: new Date(e.w.last), title: `Sent ${shortClientName(c.name)}’s update`, sub: c.name }); return; }
    const mine = e.whoFull === me || (approver && e.whoFull === 'approvers') || (!e.whoFull && myClientsFilter(c));
    if(!mine){ others.push(e); return; }
    const [go, step] = todayRowAction(e.w);
    items.push({ src: 'update', c, title: todayUpdateTitle(e.w), sub: escapeHtml(c.name), step, go, at: '' });
  });
  (typeof tasks !== 'undefined' ? tasks : []).filter(t => t.assigneeId === currentUser?.id && !t.cancelledAt && t.dueDate === ds).forEach(t => {
    const c = clients.find(x => x.id === t.clientId);
    if(t.status === 'done'){ done.push({ t: new Date(t.completedAt || ds + 'T12:00:00'), title: t.title, sub: c ? c.name : 'Based Agency' }); return; }
    items.push({ src: 'task', task: t, at: t.dueTime || '', title: t.title, sub: c ? escapeHtml(c.name) : 'Based Agency', when: t.dueTime ? fmtTime(new Date(ds + 'T' + t.dueTime)) : '',
      flag: t.priority === 'high', go: `openTaskDetailModal('${t.id}')`, tick: `moveTaskToStatus('${t.id}','done')` });
  });
  (typeof clientReminders !== 'undefined' ? clientReminders : []).filter(r => r.status === 'waiting' && r.askedBy === currentUser?.id && r.followUpDate === ds).forEach(r => {
    const c = clients.find(x => x.id === r.clientId);
    items.push({ src: 'follow', c, title: `Ask ${c ? shortClientName(c.name) : 'the client'} again: “${r.question}”`, sub: 'If they haven’t answered by then', go: `openReminderDetailModal('${r.id}')`, tick: `todayFollowAnswered('${r.id}')`, tickLabel: 'They answered' });
  });
  (typeof notes !== 'undefined' ? notes : []).filter(n => n.followUpDate === ds && n.status !== 'done').forEach(n => {
    const c = clients.find(x => x.id === n.clientId);
    items.push({ src: 'note', c, title: `Come back to your note: ${n.title || 'Untitled'}`, sub: c ? escapeHtml(c.name) : 'Your note', go: `openNoteSheet('${n.id}')` });
  });
  items.sort((a, b) => (!!b.flag - !!a.flag) || (a.at || '~').localeCompare(b.at || '~'));
  done.sort((a, b) => b.t - a.t);
  return { items, others, done };
}

// How many rows Today lists under Now; everything after is counted, not listed.
const TODAY_NEXT = 3;
// What the counts line calls each kind of row, and the tab it opens.
const TODAY_SRC = { task: ['task', 'tasks', "switchView('tasks')", 'list-todo', 'Tasks'], wa: ['WhatsApp request', 'WhatsApp requests', "switchView('whatsapp')", 'messages-square', 'WhatsApp'],
  follow: ['follow-up', 'follow-ups', "switchView('reminders')", 'bell-ring', 'Reminders'], review: ['review', 'reviews', "switchView('tasks')", 'tray', 'Tasks'],
  update: ['update', 'updates', "switchView('approve')", 'send', 'This Week'], health: ['client at risk', 'clients at risk', "switchView('health')", 'activity', 'Health'],
  note: ['note', 'notes', "switchView('notes')", 'sticky-note', 'Notes'] };
function todayDaysSince(ds, todayStr){ return ds ? Math.max(0, Math.round((new Date(todayStr + 'T12:00:00') - new Date(ds + 'T12:00:00')) / 864e5)) : 0; }
// "Yesterday", or the date for anything older.
function todayDayWord(ds, now){ return ds === toDateStr(addDays(now || rNow(), -1)) ? 'Yesterday' : fmtShortDate(new Date(ds + 'T12:00:00')); }
// "Due yesterday", "Due Nov 12"
function todayDueWord(ds, now){ const w = todayDayWord(ds, now); return 'Due ' + (w === 'Yesterday' ? 'yesterday' : w); }
// One click from Today: the client answered, or you're done with the note.
async function todayFollowAnswered(id){ await markReminderStatus(id, 'answered'); if(typeof renderDashboard === 'function') renderDashboard(); }
async function todayNoteDone(id){
  const { error } = await supabaseClient.from('notes').update({ status: 'done' }).eq('id', id).eq('user_id', currentUser.id);
  if(error){ showToast('error', 'Note not marked done', error.message); return; }
  if(typeof loadMyNotes === 'function') await loadMyNotes();
  if(typeof renderNotes === 'function') renderNotes();
  if(typeof renderDashboard === 'function') renderDashboard();
  showToast('success', 'Done with the note', '');
}
function todayWaOn(){ return typeof waTasks !== 'undefined' && typeof waLinkedTask === 'function' && !(typeof waHidden === 'function' && waHidden()); }
// What's yours today from the other screens, each opening where it lives.
function todayFromElsewhere(todayStr, now){
  const me = currentUser?.id, out = [], cl = id => clients.find(x => x.id === id) || null;
  const since = ds => ds < todayStr ? todayDueWord(ds, now) : '';
  // tasks you gave someone, back with you to review
  (typeof tasks !== 'undefined' ? tasks : []).filter(t => t.assignerId === me && t.assigneeId !== me && t.status === 'in_review' && !t.cancelledAt).forEach(t => {
    const c = cl(t.clientId), who = (teamProfiles || []).find(p => p.id === t.assigneeId);
    out.push({ src: 'review', c, title: who ? `Review ${firstName(who.name)}’s work: ${t.title}` : `Review: ${t.title}`, sub: `${c ? escapeHtml(c.name) : 'Based Agency'} · ${who ? escapeHtml(firstName(who.name)) + ' says it’s ready' : 'ready for you to check'}`, step: 'Review', go: `openTaskDetailModal('${t.id}')` });
  });
  // WhatsApp requests waiting on you (one made into a task shows as the task)
  if(todayWaOn()) waTasks.filter(t => t.status === 'open' && t.owner_user_id === me && !(waLinkedTask(t) && waLinkedTask(t).status !== 'done')
      && (waLate(t) || waDueToday(t) || (t.due_date && t.due_date <= todayStr)))
    .sort((a, b) => new Date(a.first_seen) - new Date(b.first_seen)).forEach(t => {
      const late = waLate(t) || (t.due_date && t.due_date < todayStr);
      out.push({ src: 'wa', age: typeof waDays === 'function' ? waDays(t) : 0, wa: t, title: t.title, sub: `${escapeHtml(waClientLabel(t))} asked on WhatsApp`, late, when: late ? `Waiting ${waAgeWord(t)}` : '', flag: t.priority === 'high', go: `waOpenItem(${jsArg(t.id)})`, tick: `waMarkDone(${jsArg(t.id)})` });
    });
  // follow-ups you asked clients for
  (typeof clientReminders !== 'undefined' ? clientReminders : []).filter(r => r.status === 'waiting' && r.askedBy === me && r.followUpDate && r.followUpDate <= todayStr)
    .sort((a, b) => a.followUpDate.localeCompare(b.followUpDate)).forEach(r => {
      const c = cl(r.clientId);
      out.push({ src: 'follow', age: todayDaysSince(r.followUpDate, todayStr), c, title: `Ask ${c ? shortClientName(c.name) : 'the client'} again: “${r.question}”`, sub: `No answer yet${r.askedDate ? ' · you asked ' + fmtShortDate(new Date(r.askedDate + 'T12:00:00')) : ''}`, late: r.followUpDate < todayStr, when: since(r.followUpDate), go: `openReminderDetailModal('${r.id}')`, tick: `todayFollowAnswered('${r.id}')`, tickLabel: 'They answered' });
    });
  // notes you set to come back to
  (typeof notes !== 'undefined' ? notes : []).filter(n => n.followUpDate && n.status !== 'done' && n.followUpDate <= todayStr)
    .sort((a, b) => a.followUpDate.localeCompare(b.followUpDate)).forEach(n => {
      const c = cl(n.clientId);
      out.push({ src: 'note', age: todayDaysSince(n.followUpDate, todayStr), c, title: `Come back to your note: ${n.title || 'Untitled'}`, sub: c ? escapeHtml(c.name) : 'Your note', late: n.followUpDate < todayStr, when: since(n.followUpDate), go: `openNoteSheet('${n.id}')`, tick: `todayNoteDone('${n.id}')` });
    });
  return out;
}

// Older helpers other screens still call.
function todayInitials(name){ return clientMono({ name }); }
function todayLastSent(c){ return lastSentAt(c); }
function todayMono(name){ const c = (typeof clients !== 'undefined' ? clients : []).find(x => x.name === name) || { name }; return monoHtml(c); }
