// Status/rating pills, donut charts, risk labels, avatar colours, budget
// helpers and other small display pieces shared across screens.

// Takes the client plus a specific author now — draft state is per
// (client, author) pair (see addendum-25.sql / getDraftFor()), not a single
// slot on the client itself, so this needs to know whose draft it's
// describing. Otherwise unchanged: still distinguishes "approved, ready to
// send" from "approved, and this exact draft was already sent" —
// draftSentAt is cleared whenever a genuinely new draft cycle starts (see
// confirmGenerateDraftSelection() and skipDraft()), so if it's still set
// here, the currently-approved draft IS the one that was sent, not a newer
// one waiting to go out.
//
// Every status returns a real "bg" color (not the old `${status.color}18`
// string-concatenation trick used at one render site with a pill
// background) — that pattern produces something like "var(--green)18",
// which isn't valid CSS at all, so the background silently failed to apply
// everywhere it was used. Vibrant colors like green/orange still read fine
// as plain text without it, which is why this went unnoticed until a muted
// grey text-only "pill" made the missing background actually visible as a
// problem.
function statusMeta(c, author){
  const d = getDraftFor(c, author);
  if(d.draftStatus==='approved'){
    if(d.draftSentAt) return {label:'Sent', color:'var(--muted)', bg:'var(--border)'};
    return {label:'✓ Approved', color:'var(--green)', bg:'var(--green-bg)'};
  }
  if(d.draftStatus==='pending'){
    // Distinguishes "still working on this draft" from "I've flagged it
    // for review" — readyToNotify is the same signal that makes a draft
    // actually visible in Team Queue (see renderTeamQueue()'s
    // readyForReview), so the card should reflect that transition rather
    // than showing the same "Draft ready" label before and after it.
    if(d.readyToNotify===true) return {label:'Sent for approval', color:'#3A63C9', bg:'#3A63C918'};
    return {label:'Draft ready', color:'var(--brand)', bg:'var(--brand-bg)'};
  }
  return {label:'No draft yet', color:'var(--muted-lt)', bg:'var(--border)'};
}

function dotRating(label, n, tone, max){
  max = max || 5;
  const fillColor = tone==='brand' ? 'var(--brand)' : 'var(--ink)';
  let dots = '';
  for(let i=1;i<=max;i++){
    dots += `<span class="rate-dot" style="background:${i<=n?fillColor:'var(--border)'};"></span>`;
  }
  return `<div class="rating-row"><span class="rating-label">${escapeHtml(label)}</span><div class="rate-dots">${dots}</div><span class="rating-num">${n}/${max}</span></div>`;
}

function dotRatingCompact(n, tone, max){
  max = max || 5;
  const fillColor = tone==='brand' ? 'var(--brand)' : 'var(--ink)';
  let dots = '';
  for(let i=1;i<=max;i++){
    dots += `<span class="rate-dot" style="background:${i<=n?fillColor:'var(--border)'};"></span>`;
  }
  return `<div class="rate-dots-compact">${dots}<span class="rating-num">${n}/${max}</span></div>`;
}

// Pill-style rating, no dots — just "n/max". Scoped specifically to the
// Clients table and Reports table (Clients tab), per explicit request.
// dotRatingCompact above is untouched and still used everywhere else (Queue
// cards, Overview, Client Detail) — this is a deliberately narrow variant,
// not a global replacement.
function ratingPillCompact(n, tone, max){
  max = max || 5;
  const cls = tone==='brand' ? 'rating-pill-brand' : 'rating-pill-ink';
  return `<span class="rating-pill ${cls}">${n}/${max}</span>`;
}

// Colors the status pill by meaning rather than always flat gray. Matches
// custom/user-added statuses by keyword so it still makes sense even if the
// team adds new options beyond the defaults.
function statusPillClass(status){
  const s = (status||'').toLowerCase();
  if(s.includes('risk')) return 'pill-bad';
  if(s.includes('pause') || s.includes('inactive') || s.includes('offboard') || s.includes('churn')) return 'pill-status';
  if(s.includes('onboard')) return 'pill-mid';
  if(s.includes('active')) return 'pill-good';
  return 'pill-status';
}

// Donut chart for the Total Clients card — segments by risk tier, reusing the
// exact same semantic colors used elsewhere in the app.
function renderTotalClientsDonut(){
  const wrap = document.getElementById('totalClientsDonut');
  const legend = document.getElementById('totalClientsLegend');
  if(!wrap) return;
  const ac = attentionEligibleClients();
  const total = ac.length;
  if(!total){
    wrap.innerHTML = `<div class="empty" style="padding:30px 0;">No clients yet.</div>`;
    if(legend) legend.innerHTML = '';
    const statsEl0 = document.getElementById('totalClientsStats');
    if(statsEl0) statsEl0.innerHTML = '';
    return;
  }
  // Grouped by risk tier (danger score), not status — status is almost always
  // "Active" for most clients, which rendered as one solid ring with nothing
  // to actually show. Risk tier is where the real variation lives.
  const counts = { 'No risk':0, 'Medium risk':0, 'At risk':0 };
  ac.forEach(c=>{ counts[riskLabel(c.danger).text]++; });
  const entries = Object.entries(counts).filter(([,count])=>count>0);
  const tierColor = (tier)=> tier==='At risk' ? '#A84942' : tier==='Medium risk' ? '#3A5A78' : '#2F6B44';

  const r = 46, cx = 60, cy = 60, strokeW = 11;
  const C = 2*Math.PI*r;
  const gapLen = strokeW + 8; // fixed arc-length gap, sized to survive round-linecap's own visual overlap (~strokeW/2 per side) and still leave a real visible separation
  let cumulative = 0;
  const segs = entries.map(([tier,count])=>{
    const dash = (count/total)*C;
    const visibleDash = dash > 0 ? Math.max(3, dash - gapLen) : 0;
    const dimmed = attentionTierFilter && attentionTierFilter!==tier;
    const html = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${tierColor(tier)}" stroke-width="${strokeW}" stroke-linecap="round" stroke-dasharray="${visibleDash.toFixed(2)} ${(C-visibleDash).toFixed(2)}" stroke-dashoffset="${(-cumulative).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})" style="cursor:pointer;opacity:${dimmed?0.3:1};transition:opacity var(--duration-fast) var(--ease-out);" onclick="setAttentionTierFilter(attentionTierFilter==='${tier}'?null:'${tier}')"><title>${tier} (${count}) — click to filter Needs Attention</title></circle>`;
    cumulative += dash;
    return html;
  }).join('');

  wrap.innerHTML = `
    <svg viewBox="0 0 120 120" width="150" height="150">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--border)" stroke-width="${strokeW}"></circle>
      ${segs}
    </svg>
    <div class="donut-center">
      <div class="donut-center-value" style="color:${counts['At risk'] ? '#CF2424' : 'var(--ink)'};">${counts['At risk']}</div>
      <div class="donut-center-label">At risk</div>
    </div>`;

  if(legend){
    legend.innerHTML = entries.map(([tier,count])=>{
      const dimmed = attentionTierFilter && attentionTierFilter!==tier;
      return `<span class="donut-legend-item" style="cursor:pointer;opacity:${dimmed?0.4:1};font-weight:${attentionTierFilter===tier?700:400};" onclick="setAttentionTierFilter(attentionTierFilter==='${tier}'?null:'${tier}')"><span class="donut-legend-dot" style="background:${tierColor(tier)};"></span>${tier} (${count})</span>`;
    }).join('');
  }

  const statsEl = document.getElementById('totalClientsStats');
  if(statsEl){
    const avgImportance = (ac.reduce((s,c)=>s+c.importance,0) / total).toFixed(1);
    const avgDanger = (ac.reduce((s,c)=>s+c.danger,0) / total).toFixed(1);
    // "No draft" now means no author has ever started one for this
    // client — checks across all of a client's drafts (one per author,
    // see addendum-25.sql), not a single client-level status.
    const atRiskNoDraft = ac.filter(c=> c.danger>=4 && !(c.drafts||[]).some(d=>d.draftStatus!=='none')).length;
    statsEl.innerHTML = `
      <div class="donut-stat-row"><span class="donut-stat-label">Avg Importance</span><span class="donut-stat-val">${avgImportance}/10</span></div>
      <div class="donut-stat-row"><span class="donut-stat-label">Avg Danger</span><span class="donut-stat-val">${avgDanger}/5</span></div>
      <div class="donut-stat-row"><span class="donut-stat-label">At Risk, No Draft</span><span class="donut-stat-val" style="color:${atRiskNoDraft?'#DC2626':'var(--ink)'};">${atRiskNoDraft}</span></div>`;
  }
}

const SERVICE_DONUT_COLORS = ['#E8622C', '#3A63C9', '#16A34A', '#8B5CF6', '#D97706', '#EC4899'];

// Same visual pattern as the Risk Breakdown donut (Overview), applied to
// service/hours instead of client/risk. entries respects whatever the
// report's range, member, and active-only filters currently are, since it's
// passed in from renderReports() using the same relevant[] everything else
// on the page uses — this donut always matches what the table below shows.
function renderServiceBreakdownDonut(entries){
  const wrap = document.getElementById('serviceBreakdownDonut');
  const legend = document.getElementById('serviceBreakdownLegend');
  if(!wrap) return;

  const grouped = {};
  entries.forEach(e=>{
    const c = clients.find(x=>x.id===e.clientId);
    const svc = e.service || (c ? c.service : '') || 'No service set';
    grouped[svc] = (grouped[svc]||0) + e.minutes;
  });
  const totalMinutes = Object.values(grouped).reduce((s,m)=>s+m,0);

  const statsEl = document.getElementById('serviceBreakdownStats');
  if(!totalMinutes){
    wrap.innerHTML = `<div class="empty" style="padding:30px 0;">No time logged in this range.</div>`;
    if(legend) legend.innerHTML = '';
    if(statsEl) statsEl.innerHTML = '';
    return;
  }

  // Cap at the top 5 services and bundle the rest into "Other" — keeps the
  // list readable instead of a dozen tiny slivers if there are many services.
  let sorted = Object.entries(grouped).sort((a,b)=>b[1]-a[1]);
  if(sorted.length > 6){
    const top = sorted.slice(0,5);
    const otherMinutes = sorted.slice(5).reduce((s,[,m])=>s+m,0);
    sorted = [...top, ['Other', otherMinutes]];
  }
  const svcColor = (i)=> SERVICE_DONUT_COLORS[i % SERVICE_DONUT_COLORS.length];

  wrap.innerHTML = `
    <div style="font-size:11.5px;color:var(--muted-lt);margin-bottom:14px;">${formatMinutes(totalMinutes)} total</div>
    ${sorted.map(([svc,mins],i)=>{
      const pct = Math.round((mins/totalMinutes)*100);
      return `<div class="report-bar-row">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:12.5px;">
          <span style="font-weight:600;color:var(--ink);">${escapeHtml(svc)}</span>
          <span style="color:var(--muted-lt);">${formatMinutes(mins)} · ${pct}%</span>
        </div>
        <div class="report-bar-track"><div class="report-bar-fill" style="width:${pct}%;background:${svcColor(i)};"></div></div>
      </div>`;
    }).join('')}`;

  if(legend) legend.innerHTML = '';

  if(statsEl){
    const servicesTracked = Object.keys(grouped).length;
    const avgPerService = Math.round(totalMinutes / servicesTracked);
    statsEl.innerHTML = `
      <div class="donut-stat-row"><span class="donut-stat-label">Services Tracked</span><span class="donut-stat-val">${servicesTracked}</span></div>
      <div class="donut-stat-row"><span class="donut-stat-label">Avg Hours/Service</span><span class="donut-stat-val">${formatMinutes(avgPerService)}</span></div>`;
  }
}

// Three-tier risk system based on danger score — always shown, not just when
// something's wrong, so "No risk" and "Medium risk" are just as visible as
// "At risk" instead of only flagging the bad case.
// Readable recency, not a raw date — "3 weeks ago" tells an approver
// something actionable (this client's gone quiet); a bare count doesn't.
function timeAgo(dateStr){
  const then = new Date(dateStr);
  const diffDays = Math.floor((new Date() - then) / 86400000);
  if(diffDays <= 0) return 'today';
  if(diffDays === 1) return 'yesterday';
  if(diffDays < 7) return `${diffDays} days ago`;
  const weeks = Math.floor(diffDays/7);
  if(weeks < 5) return weeks===1 ? '1 week ago' : `${weeks} weeks ago`;
  const months = Math.floor(diffDays/30);
  if(months < 12) return months===1 ? '1 month ago' : `${months} months ago`;
  const years = Math.floor(diffDays/365);
  return years===1 ? '1 year ago' : `${years} years ago`;
}

function riskLabel(danger){
  if(danger>=4) return { text:'At risk', color:'#CF2424' };
  if(danger===3) return { text:'Medium risk', color:'#43719C' };
  return { text:'No risk', color:'#117F3A' };
}

function riskCaptionHtml(danger){
  const r = riskLabel(danger);
  return `<span class="q-risk-flag" style="color:${r.color};">${escapeHtml(r.text)}</span>`;
}

// Fixes a real bug: the old danger badge always used the same flat brand
// color regardless of the actual value, so a 1/5 (low risk) looked just as
// alarming as a 5/5. This reuses the same progressive color scale riskLabel()
// already uses everywhere else in the app, instead of a fixed tone.
function dangerPillCompact(danger){
  const r = riskLabel(danger);
  return `<span class="rating-pill" style="background:${r.color}18;color:${r.color};">${escapeHtml(r.text)}</span>`;
}

// Deterministic per-name color so the same client always gets the same
// avatar color across sessions, without storing anything — same pattern
// Slack/Gmail use for initials avatars.
const AVATAR_COLORS = ['#C35225','#4779A7','#64768E','#916F3D','#A0655B','#4C7F66','#776DAB','#AF5883'];
function avatarColorForName(name){
  let hash = 0;
  for(let i=0;i<name.length;i++) hash = name.charCodeAt(i) + ((hash<<5)-hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// Whole completed months since a client's start date — auto-calculated so
// it can't go stale the way a manually-typed number would (this replaces
// hand-entering "months active" as a plain field). Returns null when no
// start date is set, so callers can show "set a start date" rather than a
// misleading 0.
function monthsActiveFor(c){
  if(!c.startDate) return null;
  const start = new Date(c.startDate+'T00:00:00');
  if(isNaN(start.getTime())) return null;
  const now = new Date();
  let months = (now.getFullYear()-start.getFullYear())*12 + (now.getMonth()-start.getMonth());
  if(now.getDate() < start.getDate()) months--;
  return Math.max(0, months);
}

// Compares actual logged time this calendar month against a client's set
// monthly hour budget/retainer. Returns null if no budget is set — budget
// tracking is opt-in per client, not assumed for everyone.
function monthBudgetInfo(c){
  const budgetHours = parseFloat(c.monthlyHourBudget) || 0;
  if(!budgetHours) return null;
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
  const usedMinutes = timeEntries
    .filter(e=> e.clientId===c.id && new Date(e.date+'T00:00:00') >= monthStart)
    .reduce((s,e)=>s+e.minutes, 0);
  const budgetMinutes = Math.round(budgetHours*60);
  const pct = budgetMinutes ? Math.round((usedMinutes/budgetMinutes)*100) : 0;
  const tier = pct>=100 ? 'over' : pct>=80 ? 'warn' : 'ok';
  return { usedMinutes, budgetMinutes, pct, tier };
}

function budgetTierMeta(tier){
  if(tier==='over') return { color:'#9C5C48', pill:'pill-bad', label:'Over budget' };
  if(tier==='warn') return { color:'var(--amber)', pill:'pill-mid', label:'Near budget' };
  return { color:'var(--green)', pill:'pill-good', label:'On track' };
}

// A real calendar week (Monday-Sunday), not a rolling 7-day lookback. The
// old version used "improvements.date >= 7 days ago", which meant a log
// from last Friday would still count as "this week" on the following
// Monday — the label promised a week that resets, but the logic never
// actually reset at any fixed point.
// author is optional — when provided, scopes "logged this week" to just
// that person's own improvements (needed now that "stale" is a
// per-author question, not a per-client one — see renderTeamQueue()).
// Omitting it checks across all authors, unchanged from before.
function hasLoggedThisWeek(c, author){
  const weekStart = getWeekStart(new Date());
  return c.improvements.some(i=>i.date && i.includeInEmail!==false && new Date(i.date) >= weekStart && (!author || i.author===author));
}

// Preserves each improvement's original index in c.improvements before
// sorting/grouping for display — Edit and Delete target entries by that
// index, so losing track of it here would silently edit or delete the
// wrong improvement.
function miniImprovementsHtml(c){
  const pairs = c.improvements.map((imp, idx) => ({ imp, idx }));
  const weekStart = getWeekStart(new Date());
  const byNewest = (a,b) => new Date(b.imp.date||0) - new Date(a.imp.date||0);
  const thisWeek = pairs.filter(p => p.imp.date && new Date(p.imp.date) >= weekStart).sort(byNewest);
  const earlier = pairs.filter(p => !(p.imp.date && new Date(p.imp.date) >= weekStart)).sort(byNewest);

  const rowHtml = (p)=>{
    const imp = p.imp;
    const initial = (imp.author||'?').trim().charAt(0).toUpperCase();
    return `<div class="mini-imp-row" id="imp-row-${c.id}-${p.idx}">
      <div class="mini-imp-avatar" style="background:${avatarColorForName(imp.author||'?')};">${escapeHtml(initial)}</div>
      <div class="mini-imp-body">
        <div class="mini-imp-meta"><b>${escapeHtml(imp.author)}</b> · ${imp.date ? timeAgo(imp.date) : 'no date'}</div>
        <div class="mini-imp-desc">${escapeHtml(imp.text)}</div>
      </div>
      <div class="mini-imp-actions">
        <span class="mini-imp-action-link" onclick="startEditImprovement('${c.id}', ${p.idx})">Edit</span>
        <span class="mini-imp-action-link danger" onclick="deleteImprovement('${c.id}', ${p.idx})">Delete</span>
      </div>
    </div>`;
  };

  let html = '<div class="mini-improvements">';
  html += `<div class="mini-imp-header"><span class="mini-imp-count">${c.improvements.length} logged</span><span class="mini-imp-action-link danger" onclick="deleteAllImprovements('${c.id}')">Delete all</span></div>`;
  if(thisWeek.length) html += `<div class="mini-imp-section-label">This week</div>` + thisWeek.map(rowHtml).join('');
  if(earlier.length) html += `<div class="mini-imp-section-label">Earlier</div>` + earlier.map(rowHtml).join('');
  html += '</div>';
  return html;
}
