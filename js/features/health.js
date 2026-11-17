// Health: clients on Watch or At risk, why, and the next step for each — the early warning.
// Exactly the canvas "Health" board: list + detail.

let healthFilter = 'attention';
function setHealthFilter(f){ healthFilter = f; renderHealth(); }
function selectHealthClient(id){ window._healthSel = id; renderHealth(); }

function renderHealth(){
  const root = document.getElementById('healthRoot');
  if(!root || typeof clients === 'undefined') return;
  const all = attentionEligibleClients().map(c => ({ c, h: clientHealth(c) }));
  const reds = x => x.h.signals.filter(s => s.l === 'r').length;
  const byLevel = l => all.filter(x => x.h.level === l).sort((a, b) => reds(b) - reds(a) || (b.h.since || 0) - (a.h.since || 0) || (b.c.importance || 0) - (a.c.importance || 0));
  const risk = byLevel('r'), watch = byLevel('y'), ok = all.filter(x => x.h.level === 'g').sort((a, b) => a.c.name.localeCompare(b.c.name));
  const flat = healthFilter === 'all' ? [...risk, ...watch, ...ok] : [...risk, ...watch];
  let sel = flat.find(x => x.c.id === window._healthSel) || all.find(x => x.c.id === window._healthSel) || flat[0] || ok[0];
  if(sel) window._healthSel = sel.c.id;
  const item = x => {
    const on = x === sel, color = { r: 'red', y: 'yellow-fill', g: 'label-3' }[x.h.level];
    return `<a class="msg${on ? ' sel' : ''}" href="#health" onclick="selectHealthClient('${x.c.id}');return false;"${on ? ' aria-current="true"' : ''}>${x.h.level !== 'g' ? `<span class="ud" style="background:var(--${color})" aria-label="${healthWord(x.h.level)}"></span>` : ''}
<div class="top">${monoHtml(x.c, 'sm')}<b>${escapeHtml(x.c.name)}</b><time>${x.h.since ? relDay(x.h.since) : ''}</time></div>
<div class="tags">${x.h.level === 'g' ? tagHtml('gray', 'No signals', 'check') : signalChips(x.h, 2) + (x.h.level === 'r' && !nextStepTask(x.c) ? tagHtml('red', 'No next step') : '')}</div>
<span class="pv" style="display:flex;align-items:center;gap:8px">${histDotsHtml(x.h.seq)}${clientOwner(x.c) ? avHtml(clientOwner(x.c)) : ''}</span></a>`;
  };
  const grp = (t, xs) => xs.length ? `<div class="lgh" style="padding-left:28px">${t}<span class="c">${xs.length}</span></div>${xs.map(item).join('')}` : '';
  const healthyTail = healthFilter === 'all' ? grp('Healthy', ok)
    : `<div class="lgh" style="padding-left:28px">Healthy<span class="c">${ok.length}</span></div><a class="msg" href="#health" onclick="setHealthFilter('all');return false;" style="padding-top:6px"><span class="by t-2">${escapeHtml(ok.slice(0, 2).map(x => shortClientName(x.c.name)).join(', '))}${ok.length > 2 ? ` and ${ok.length - 2} more` : ''}</span></a>`;
  const seg = [['attention', 'Needs attention', risk.length + watch.length], ['all', 'All', all.length]]
    .map(([k, t, n]) => `<button class="${healthFilter === k ? 'on' : ''}" role="tab" aria-selected="${healthFilter === k}" onclick="setHealthFilter('${k}')">${t} <span class="c">${n}</span></button>`).join('');
  root.innerHTML = `<section class="list" aria-label="Clients that need attention">
<div class="list-h"><div class="seg" role="tablist" aria-label="Show">${seg}</div><button class="ib" aria-label="Sort" title="Most recent first" style="margin-left:auto">${icon('sort-ascending')}</button></div>
${grp('At risk', risk)}${grp('Watch', watch)}${ok.length ? healthyTail : ''}
${!risk.length && !watch.length && healthFilter !== 'all' ? '<div class="empty"><b>Every client looks healthy</b>Nothing needs attention right now.</div>' : ''}
</section>
<section class="detail" aria-label="Selected client health" style="padding-top:22px">${sel ? healthDetailHtml(sel.c, sel.h) : ''}</section>`;
  if(currentViewName === 'health') setToolbar(null, risk.length + watch.length
    ? `${risk.length + watch.length} client${risk.length + watch.length === 1 ? '' : 's'} need attention · ${risk.length} at risk, ${watch.length} to watch` : 'Every client looks healthy');
}

function healthDetailHtml(c, h){
  const owner = clientOwner(c), next = nextStepTask(c);
  const start = c.startDate ? new Date(c.startDate + 'T12:00:00') : null;
  const meta = [owner ? `${owner} owns it` : '', `importance ${c.importance || 0} of 10`, start ? `client since ${start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}` : ''].filter(Boolean).join(' · ');
  const stateText = h.level === 'g' ? (h.quiet ? 'Handled — quiet for now' : 'Healthy') : `${healthWord(h.level)} since ${h.since ? relDay(h.since).toLowerCase() === 'today' ? 'today' : relDay(h.since) : 'today'}`;
  let nextBox = '';
  if(h.level !== 'g'){
    nextBox = next
      ? `<div class="next" style="margin-top:18px"><span class="sig">${icon('route')}</span><div class="tx"><b>Next step: ${escapeHtml(next.title)}</b><span>${escapeHtml((teamProfiles.find(p => p.id === next.assigneeId) || {}).name || '')}${next.dueDate ? ' · due ' + fmtShortDate(new Date(next.dueDate + 'T12:00:00')) : ''}</span></div>
<button class="btn" onclick="markHealthHandled('${c.id}')">Mark Handled</button><button class="btn" onclick="openTaskDetailModal('${next.id}')">Open Task</button></div>`
      : `<div class="next" style="margin-top:18px"><span class="sig">${icon('path')}</span><div class="tx"><b>No next step yet</b><span>Plan a call, fix or check-in. It becomes a task.</span></div>
<button class="btn" onclick="markHealthHandled('${c.id}')">Mark Handled…</button><button class="btn btn-p" onclick="planNextStep('${c.id}')">${icon('plus')}Plan Next Step</button></div>`;
  }
  const events = healthEvents(c, h).slice(0, 4);
  const seq = h.seq, ots = onTimeSummary(seq);
  return `<div style="max-width:780px">
<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">${monoHtml(c, 'lg')}
<div style="min-width:0;margin-right:auto"><div style="font-size:17px;font-weight:600;letter-spacing:-.01em">${escapeHtml(c.name)}</div><div class="t-2" style="font-size:12px;margin-top:2px">${escapeHtml(meta)}</div></div>
${hstateHtml(h.level, stateText)}</div>
${nextBox}
<div class="h2"><h2>Why<span class="c">${h.signals.length} signal${h.signals.length === 1 ? '' : 's'}</span></h2><a href="#settings" onclick="openSettingsTab('updates');return false;">Adjust signals</a></div>
<div class="grp">${signalRowsHtml(h) || '<div class="row sm"><span class="s t-2" style="font-size:12px">No signals right now.</span></div>'}</div>
<div class="grid2" style="margin-top:14px">
<section class="panel"><h3>Hours this month<span>${h.hp.budget ? `<b class="${h.hp.used > h.hp.budget ? 't-red' : ''}" style="font-weight:600">${Math.round(h.hp.used)}</b> of ${h.hp.budget}` : 'No budget set'}</span></h3>${h.hp.budget ? paceChartHtml(c, 320, 150) : '<p class="t-2" style="font-size:12px;margin:0">Add a monthly hour budget to this client to see its pace.</p>'}</section>
<section class="panel"><h3>What changed<span>${events.length} event${events.length === 1 ? '' : 's'}</span></h3><div class="agenda">${events.map(e => `<div class="ag"><time>${relDay(e.at)}</time><div class="tx"><span class="t">${escapeHtml(e.t)}</span><span class="s">${escapeHtml(e.s)}</span></div></div>`).join('') || '<p class="t-2" style="font-size:12px;margin:0">Nothing yet.</p>'}</div></section>
</div>
<div class="h2"><h2>Weekly updates</h2><span class="t-2" style="font-size:12px">${ots.total ? `On time ${ots.onTime} of the last ${ots.total}` : ''}</span></div>
${weekStripHtml(c)}
</div>`;
}
// The story so far: signals with the day they started, sends that were late or missed, and handling.
function healthEvents(c, h){
  const ev = [];
  h.signals.forEach(s => ev.push({ at: s.since, t: s.l === 'r' ? `${s.title}` : `${s.title}`, s: s.text }));
  const now = rNow(), monday = dayStart(addDays(now, -((now.getDay() + 6) % 7)));
  h.seq.forEach((x, i) => {
    const wk = addDays(monday, -7 * (7 - i));
    if(x === 'm') ev.push({ at: wk, t: 'Weekly update missed', s: `Nothing was sent the week of ${fmtShortDate(wk)}` });
    if(x === 'l') ev.push({ at: wk, t: 'Weekly update sent late', s: 'More than 7 days after the one before' });
  });
  const hd = healthHandled[c.id];
  if(hd) ev.push({ at: new Date(hd.at), t: `Marked handled by ${firstName(hd.by)}`, s: hd.note || 'Quiet unless it gets worse' });
  return ev.filter(e => e.at <= rNow()).sort((a, b) => b.at - a.at);
}
function openSettingsTab(tab){ switchView('settings'); if(typeof switchSettingsTab === 'function') setTimeout(() => { try{ switchSettingsTab(tab); }catch(e){} }, 0); }
