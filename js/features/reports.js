// Reports: time reports, charts, budget alerts, CSV/PDF exports.

/* --- Reports --- */
let reportTab = 'clients';
let reportsPage = 1;
const REPORTS_PAGE_SIZE = 20;

function switchReportTab(name){
  reportTab = name;
  reportsPage = 1;
  document.querySelectorAll('#ttab-reports .icon-tab').forEach(t=>t.classList.toggle('active', t.dataset.rtab===name));
  renderReports();
}

function onReportRangeChange(){
  const range = document.getElementById('reportRange').value;
  const customEl = document.getElementById('reportCustomRange');
  if(customEl) customEl.style.display = range==='custom' ? 'flex' : 'none';
  if(range==='custom'){
    const fromEl = document.getElementById('reportFromDate');
    const toEl = document.getElementById('reportToDate');
    if(fromEl && !fromEl.value){ const d=getWeekStart(new Date()); fromEl.value = toDateStr(d); }
    if(toEl && !toEl.value){ toEl.value = toDateStr(new Date()); }
  }
  reportsPage = 1;
  renderReports();
}

function getReportDateBounds(){
  const range = document.getElementById('reportRange')?.value || 'week';
  const now = new Date();
  if(range==='week') return { start:getWeekStart(now), end:null };
  if(range==='month') return { start:new Date(now.getFullYear(), now.getMonth(), 1), end:null };
  if(range==='custom'){
    const fromVal = document.getElementById('reportFromDate')?.value;
    const toVal = document.getElementById('reportToDate')?.value;
    return {
      start: fromVal ? new Date(fromVal+'T00:00:00') : new Date(2000,0,1),
      end: toVal ? new Date(toVal+'T23:59:59') : null
    };
  }
  return { start:new Date(2000,0,1), end:null };
}

function getReportRangeEntries(){
  const { start, end } = getReportDateBounds();
  const activeOnly = document.getElementById('reportActiveOnly')?.checked;
  const memberFilter = document.getElementById('reportMemberFilter')?.value || 'all';

  return visibleTimeEntries().filter(e=>{
    const d = new Date(e.date+'T00:00:00');
    if(d < start) return false;
    if(end && d > end) return false;
    if(memberFilter!=='all' && e.userId!==memberFilter) return false;
    if(activeOnly){
      const c = clients.find(x=>x.id===e.clientId);
      if(!c || c.status!=='Active') return false;
    }
    return true;
  });
}

function renderReports(){
  const summaryEl = document.getElementById('reportSummary');
  const tableBody = document.getElementById('reportTableBody');
  if(!summaryEl) return;

  const relevant = getReportRangeEntries();
  renderServiceBreakdownDonut(relevant);
  const totalMinutes = relevant.reduce((s,e)=>s+e.minutes,0);
  const uniqueClients = new Set(relevant.map(e=>e.clientId)).size;
  const uniquePeople = new Set(relevant.map(e=>e.userId)).size;
  const uniqueDays = new Set(relevant.map(e=>e.date)).size;
  const avgMinutesPerDay = uniqueDays ? Math.round(totalMinutes/uniqueDays) : 0;

  // "Team Members" and "By the whole team" only make sense for admins, who
  // are the only ones actually seeing the whole team's entries here — a
  // non-admin only ever sees their own, so those would just read "1" and
  // "by the whole team" on data that's entirely their own. Swap in metrics
  // that are actually useful for a single person reviewing their own time.
  const adminView = isAdmin();
  const memberFilterValue = document.getElementById('reportMemberFilter')?.value || 'all';
  const selectedMember = memberFilterValue!=='all' ? teamProfiles.find(p=>p.id===memberFilterValue) : null;
  const entriesCaption = !adminView ? 'By you' : selectedMember ? `By ${selectedMember.name}` : 'By the whole team';
  const thirdCard = (adminView && !selectedMember)
    ? `<div class="metric-card">
        <div class="metric-head"><span class="metric-icon metric-icon-amber"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 21a8 8 0 0 0-16 0" /> <circle cx="10" cy="8" r="5" /> <path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3" /></svg></span><span class="metric-label">Team Members</span></div>
        <div class="metric-value">${uniquePeople}</div>
        <div class="metric-caption">Logged time this range</div>
      </div>`
    : `<div class="metric-card">
        <div class="metric-head"><span class="metric-icon metric-icon-amber"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 7h6v6" /> <path d="m22 7-8.5 8.5-5-5L2 17" /></svg></span><span class="metric-label">Avg Hours/Day</span></div>
        <div class="metric-value">${uniqueDays ? formatMinutes(avgMinutesPerDay) : '—'}</div>
        <div class="metric-caption">${uniqueDays ? `On ${uniqueDays} day${uniqueDays!==1?'s':''} ${selectedMember ? `${selectedMember.name} logged` : 'you logged'} time` : 'No time logged yet'}</div>
      </div>`;

  summaryEl.innerHTML = `
    <div class="metric-card">
      <div class="metric-head"><span class="metric-icon metric-icon-blue"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /> <path d="M12 6v6l4 2" /></svg></span><span class="metric-label">Total Time</span></div>
      <div class="metric-value">${formatMinutes(totalMinutes)}</div>
      <div class="metric-caption">${getReportRangeLabel()} · Across ${uniqueClients} client${uniqueClients!==1?'s':''}</div>
    </div>
    <div class="metric-card">
      <div class="metric-head"><span class="metric-icon metric-icon-green"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h.01" /> <path d="M3 12h.01" /> <path d="M3 19h.01" /> <path d="M8 5h13" /> <path d="M8 12h13" /> <path d="M8 19h13" /></svg></span><span class="metric-label">Entries Logged</span></div>
      <div class="metric-value">${relevant.length}</div>
      <div class="metric-caption">${entriesCaption}</div>
    </div>
    ${thirdCard}
    <div class="metric-card">
      <div class="metric-head"><span class="metric-icon metric-icon-blue"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 21a8 8 0 0 0-16 0" /> <circle cx="10" cy="8" r="5" /> <path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3" /></svg></span><span class="metric-label">Clients Worked</span></div>
      <div class="metric-value">${uniqueClients}</div>
      <div class="metric-caption">Had time logged</div>
    </div>`;

  if(!tableBody) return;

  const headEl = document.getElementById('reportTableHead');
  if(headEl){
    headEl.innerHTML = reportTab==='clients'
      ? `<th style="width:30px;"><input type="checkbox" id="reportSelectAllClients" onchange="toggleAllReportClientSelection(this.checked)"></th><th>Name</th><th class="report-th-hours">Hours</th><th class="report-th-hours">Importance</th><th class="report-th-hours">Danger</th>`
      : `<th>Name</th><th class="report-th-hours">Hours</th>`;
  }

  let grouped = {}, getLabel;
  if(reportTab==='clients'){
    relevant.forEach(e=>{ grouped[e.clientId] = (grouped[e.clientId]||0) + e.minutes; });
    getLabel = (key)=>{ const c = clients.find(x=>x.id===key); return c ? c.name : 'Unknown client'; };
  } else if(reportTab==='services'){
    relevant.forEach(e=>{
      const c = clients.find(x=>x.id===e.clientId);
      const svc = e.service || (c ? c.service : '') || 'No service set';
      grouped[svc] = (grouped[svc]||0) + e.minutes;
    });
    getLabel = (key)=> key;
  } else {
    relevant.forEach(e=>{ grouped[e.userId] = (grouped[e.userId]||0) + e.minutes; });
    getLabel = (key)=>{ const p = teamProfiles.find(x=>x.id===key); return p ? p.name : 'Unknown'; };
  }

  const rows = Object.entries(grouped).sort((a,b)=>b[1]-a[1]);
  const colspan = reportTab==='clients' ? 5 : 2;

  renderReportChart();
  updateBulkDownloadBar();

  const paginationEl = document.getElementById('reportPagination');

  if(!rows.length){
    tableBody.innerHTML = `<tr><td colspan="${colspan}"><div class="empty">No time logged in this range.</div></td></tr>`;
    if(paginationEl) paginationEl.innerHTML = '';
    return;
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / REPORTS_PAGE_SIZE));
  if(reportsPage > totalPages) reportsPage = totalPages;
  const pageRows = rows.slice((reportsPage-1)*REPORTS_PAGE_SIZE, reportsPage*REPORTS_PAGE_SIZE);
  if(paginationEl) paginationEl.innerHTML = paginationControlsHtml(reportsPage, rows.length, REPORTS_PAGE_SIZE, 'changeReportsPage');

  if(reportTab==='clients'){
    // Selections that no longer appear in the current filtered rows
    // shouldn't linger as phantom "selected" state — checked against every
    // row across all pages, not just the current page, since a selection
    // made on an earlier page needs to survive navigating to a different one.
    const visibleIds = new Set(rows.map(([key])=>key));
    selectedReportClientIds.forEach(id=>{ if(!visibleIds.has(id)) selectedReportClientIds.delete(id); });

    tableBody.innerHTML = pageRows.map(([key,mins])=>{
      const c = clients.find(x=>x.id===key);
      const label = getLabel(key);
      const initial = label.trim().charAt(0).toUpperCase();
      const nameEl = `<div class="client-cell" style="cursor:pointer;" onclick="openClientReportDetail('${key}')">
        <div class="avatar-circle" style="width:28px;height:28px;font-size:12.5px;">${escapeHtml(initial)}</div>
        <div>
          <span class="report-name-link">${escapeHtml(label)}</span>
          ${c ? `<div class="q-service-caption" style="margin-top:2px;">${escapeHtml(c.service)} · ${riskCaptionHtml(c.danger)}</div>` : ''}
        </div>
      </div>`;
      return `<tr>
        <td><input type="checkbox" ${selectedReportClientIds.has(key)?'checked':''} onchange="toggleReportClientSelection('${key}', this.checked)"></td>
        <td>${nameEl}</td>
        <td class="report-hours-val">${formatMinutes(mins)}</td>
        <td>${c ? ratingPillCompact(c.importance,'ink',10) : '—'}</td>
        <td>${c ? dangerPillCompact(c.danger) : '—'}</td>
      </tr>`;
    }).join('');
    updateBulkDownloadBar();
    return;
  }

  tableBody.innerHTML = pageRows.map(([key,mins])=>{
    const label = getLabel(key);
    const nameEl = `<span style="font-weight:600;font-size:14px;">${escapeHtml(label)}</span>`;
    return `<tr>
      <td>${nameEl}</td>
      <td class="report-hours-val">${formatMinutes(mins)}</td>
    </tr>`;
  }).join('');
}

function changeReportsPage(page){
  reportsPage = page;
  renderReports();
}

// Same grouping logic as renderReports() above, factored out so CSV/PDF
// export always matches exactly what's currently on screen — same range,
// same member filter, same active-only filter, same tab (Clients/Services/
// Teammates).
function getReportExportRows(){
  const relevant = getReportRangeEntries();
  let grouped = {}, getLabel;
  if(reportTab==='clients'){
    relevant.forEach(e=>{ grouped[e.clientId] = (grouped[e.clientId]||0) + e.minutes; });
    getLabel = (key)=>{ const c = clients.find(x=>x.id===key); return c ? c.name : 'Unknown client'; };
  } else if(reportTab==='services'){
    relevant.forEach(e=>{
      const c = clients.find(x=>x.id===e.clientId);
      const svc = e.service || (c ? c.service : '') || 'No service set';
      grouped[svc] = (grouped[svc]||0) + e.minutes;
    });
    getLabel = (key)=> key;
  } else {
    relevant.forEach(e=>{ grouped[e.userId] = (grouped[e.userId]||0) + e.minutes; });
    getLabel = (key)=>{ const p = teamProfiles.find(x=>x.id===key); return p ? p.name : 'Unknown'; };
  }
  return Object.entries(grouped).sort((a,b)=>b[1]-a[1]).map(([key,mins])=>({ label:getLabel(key), minutes:mins }));
}

function getReportExportMeta(){
  const rangeSel = document.getElementById('reportRange');
  const rangeLabel = rangeSel?.value==='custom'
    ? `${document.getElementById('reportFromDate')?.value || '…'} to ${document.getElementById('reportToDate')?.value || '…'}`
    : (rangeSel?.options[rangeSel.selectedIndex]?.text || 'This week');
  const tabLabel = reportTab==='clients' ? 'Clients' : reportTab==='services' ? 'Services' : 'Teammates';
  return { rangeLabel, tabLabel };
}

function exportReportCsv(){
  const rows = getReportExportRows();
  if(!rows.length){ showToast('info','Nothing to export','No time logged in this range.'); return; }
  const { rangeLabel, tabLabel } = getReportExportMeta();
  const headers = [tabLabel==='Clients'?'Client':tabLabel==='Services'?'Service':'Team Member', 'Hours'];
  const lines = [headers.join(',')];
  rows.forEach(r=> lines.push([r.label, (r.minutes/60).toFixed(2)].map(csvEscape).join(',')));
  const totalMinutes = rows.reduce((s,r)=>s+r.minutes,0);
  lines.push(['Total', (totalMinutes/60).toFixed(2)].map(csvEscape).join(','));
  const blob = new Blob([lines.join('\n')], { type:'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `report_${tabLabel.toLowerCase()}_${toDateStr(new Date())}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportReportPdf(){
  const rows = getReportExportRows();
  if(!rows.length){ showToast('info','Nothing to export','No time logged in this range.'); return; }
  if(!window.jspdf){ showToast('error','PDF library not loaded','Check your connection and try again.'); return; }
  const { rangeLabel, tabLabel } = getReportExportMeta();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const totalMinutes = rows.reduce((s,r)=>s+r.minutes,0);

  doc.setFont('helvetica','bold'); doc.setFontSize(16);
  doc.text(`${settings.appName || 'Based Agency'} — Time Report`, 14, 18);
  doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(100);
  doc.text(`${tabLabel} · ${rangeLabel} · Generated ${new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`, 14, 25);
  doc.text(`Total: ${formatMinutes(totalMinutes)} across ${rows.length} ${tabLabel.toLowerCase()}`, 14, 31);

  let y = 44;
  doc.setFontSize(9); doc.setTextColor(120);
  doc.text(tabLabel==='Clients'?'CLIENT':tabLabel==='Services'?'SERVICE':'TEAM MEMBER', 14, y);
  doc.text('HOURS', 180, y, { align:'right' });
  y += 3;
  doc.setDrawColor(220); doc.line(14, y, 196, y);
  y += 7;

  doc.setFontSize(10); doc.setTextColor(30);
  rows.forEach(r=>{
    if(y > 280){ doc.addPage(); y = 20; }
    doc.text(String(r.label).slice(0,60), 14, y);
    doc.text((r.minutes/60).toFixed(2)+'h', 180, y, { align:'right' });
    y += 7;
  });

  y += 3;
  doc.setDrawColor(220); doc.line(14, y, 196, y);
  y += 7;
  doc.setFont('helvetica','bold');
  doc.text('Total', 14, y);
  doc.text((totalMinutes/60).toFixed(2)+'h', 180, y, { align:'right' });

  doc.save(`report_${tabLabel.toLowerCase()}_${toDateStr(new Date())}.pdf`);
}

/* ---------- Reusable X/Y line chart (gradient area + hover tooltip), no library ---------- */

function bucketKeyFor(date, granularity){
  if(granularity==='day') return toDateStr(date);
  if(granularity==='week') return toDateStr(getWeekStart(date));
  return `${date.getFullYear()}-${date.getMonth()}`;
}
function bucketLabelFor(date, granularity){
  if(granularity==='month') return date.toLocaleDateString('en-US',{month:'short'});
  return date.toLocaleDateString('en-US',{month:'short',day:'numeric'});
}
function bucketStartFor(date, granularity){
  if(granularity==='day'){ const d=new Date(date); d.setHours(0,0,0,0); return d; }
  if(granularity==='week') return getWeekStart(date);
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
function stepBucket(date, granularity){
  const d = new Date(date);
  if(granularity==='day') d.setDate(d.getDate()+1);
  else if(granularity==='week') d.setDate(d.getDate()+7);
  else d.setMonth(d.getMonth()+1);
  return d;
}
function buildBucketsInRange(startDate, endDate, granularity, maxBuckets){
  let cursor = bucketStartFor(startDate, granularity);
  const end = bucketStartFor(endDate, granularity);
  const buckets = [];
  let guard = 0;
  while(cursor <= end && guard < 500){
    buckets.push({ key: bucketKeyFor(cursor, granularity), label: bucketLabelFor(cursor, granularity), minutes:0, sortDate:new Date(cursor) });
    cursor = stepBucket(cursor, granularity);
    guard++;
  }
  return buckets.length > (maxBuckets||60) ? buckets.slice(-(maxBuckets||60)) : buckets;
}
function fillBucketsWithEntries(buckets, entries, granularity){
  const map = {};
  buckets.forEach(b=> map[b.key]=b);
  entries.forEach(e=>{
    const key = bucketKeyFor(new Date(e.date+'T00:00:00'), granularity);
    if(map[key]) map[key].minutes += e.minutes;
  });
  return buckets;
}

// Entries for the chart specifically — respects the member/active-only
// filters, but deliberately NOT the date-range selector above (This
// week/month/etc). That selector often narrows to a window so small it
// collapses to a single bucket under Week/Month granularity, which is what
// was causing the chart to render nothing. The KPI cards and table below
// still respect the range selector via getReportRangeEntries(); this chart
// always shows a recent trend instead, the same proven approach the
// Overview chart already uses successfully.
function getReportChartEntries(){
  const activeOnly = document.getElementById('reportActiveOnly')?.checked;
  const memberFilter = document.getElementById('reportMemberFilter')?.value || 'all';
  return visibleTimeEntries().filter(e=>{
    if(memberFilter!=='all' && e.userId!==memberFilter) return false;
    if(activeOnly){
      const c = clients.find(x=>x.id===e.clientId);
      if(!c || c.status!=='Active') return false;
    }
    return true;
  });
}

let reportChartGranularity = 'day';
function setReportChartGranularity(g){
  reportChartGranularity = g;
  document.querySelectorAll('#reportChartGranularityToggle .view-toggle-option').forEach(el=>el.classList.toggle('active', el.dataset.g===g));
  renderReportChart();
}

function renderReportChart(){
  const granularity = reportChartGranularity;
  const count = granularity==='day' ? 14 : granularity==='week' ? 8 : 6;
  const end = new Date();
  const start = new Date(end);
  if(granularity==='day') start.setDate(start.getDate()-(count-1));
  else if(granularity==='week') start.setDate(start.getDate()-(count-1)*7);
  else start.setMonth(start.getMonth()-(count-1));
  const buckets = fillBucketsWithEntries(buildBucketsInRange(start, end, granularity, count+1), getReportChartEntries(), granularity);
  renderXYChart('reportChart', buckets);
  const updatedEl = document.getElementById('reportChartUpdated');
  if(updatedEl) updatedEl.textContent = `Updated ${new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}`;
}

let overviewChartGranularity = 'week';
function setOverviewChartGranularity(g){
  overviewChartGranularity = g;
  document.querySelectorAll('#overviewChartGranularityToggle .view-toggle-option').forEach(el=>el.classList.toggle('active', el.dataset.g===g));
  renderOverviewChart();
}

function renderOverviewChart(){
  const titleEl = document.getElementById('overviewChartTitle');
  if(titleEl) titleEl.textContent = isAdmin() ? 'Hours Logged (Team)' : 'Your Hours Logged';
  const granularity = overviewChartGranularity;
  const count = granularity==='day' ? 14 : granularity==='week' ? 8 : 6;
  const end = new Date();
  const start = new Date(end);
  if(granularity==='day') start.setDate(start.getDate()-(count-1));
  else if(granularity==='week') start.setDate(start.getDate()-(count-1)*7);
  else start.setMonth(start.getMonth()-(count-1));
  const buckets = fillBucketsWithEntries(buildBucketsInRange(start, end, granularity, count+1), visibleTimeEntries(), granularity);
  const dangerSeries = buildDangerSeries(buckets);
  renderXYChart('overviewChart', buckets, 'latest', dangerSeries);
  const updatedEl = document.getElementById('overviewChartUpdated');
  if(updatedEl) updatedEl.textContent = `Updated ${new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}`;
}

// For each bucket's date, each currently-active client's most recent known
// danger value at or before that date — carried forward from whenever it
// was last recorded, not just "today's snapshot" repeated flat across the
// whole chart. A client with zero history yet before a given bucket's date
// (created after it, or never seeded) is excluded from that bucket's
// average rather than counted as a false zero, which would otherwise drag
// early buckets down for reasons that have nothing to do with actual risk.
function buildDangerSeries(buckets){
  const ac = activeClients();
  if(!ac.length || !dangerHistory.length) return null;
  return buckets.map(b=>{
    const asOf = b.sortDate;
    const values = [];
    ac.forEach(c=>{
      const pointsForClient = dangerHistory.filter(h => h.clientId===c.id && h.recordedAt <= asOf);
      if(!pointsForClient.length) return; // didn't exist / no recorded value yet as of this date
      const mostRecent = pointsForClient.reduce((latest,h)=> h.recordedAt > latest.recordedAt ? h : latest);
      values.push(mostRecent.danger);
    });
    return values.length ? values.reduce((s,v)=>s+v,0)/values.length : null;
  });
}

let xyChartUid = 0;
function renderXYChart(containerId, buckets, headlineMode, dangerSeries){
  const el = document.getElementById(containerId);
  if(!el) return;
  if(!buckets.length){ el.innerHTML = `<div class="empty">No data for this period.</div>`; return; }

  const isDark = document.body.dataset.theme === 'dark';
  const lineColor = isDark ? '#e8622c82' : 'var(--brand)';

  const uid = 'xy'+(xyChartUid++);
  const w = 600, h = 180, padX = 6, padY = 14;
  const values = buckets.map(b=>b.minutes/60);
  const maxVal = Math.max(...values, 1);
  const stepX = buckets.length>1 ? (w-2*padX)/(buckets.length-1) : 0;
  const points = values.map((v,i)=>({
    x: padX + i*stepX,
    y: h - padY - (v/maxVal)*(h-2*padY),
    v, label: buckets[i].label
  }));
  const linePath = points.map((p,idx)=> (idx===0?'M':'L')+p.x.toFixed(1)+','+p.y.toFixed(1)).join(' ');
  const areaPath = linePath + ` L${points[points.length-1].x.toFixed(1)},${h-padY} L${points[0].x.toFixed(1)},${h-padY} Z`;
  // A single point has no line segment to stroke and a zero-width area to
  // fill — both render as literally nothing. Show it as a plain visible dot
  // instead, which is the one case this happens: a range (like "This week")
  // that collapses to a single bucket under a coarser granularity (Week or
  // Month) — common right after selecting one of those from the dropdown.
  const singlePointDot = points.length===1
    ? `<circle cx="${points[0].x.toFixed(1)}" cy="${points[0].y.toFixed(1)}" r="4.5" fill="${lineColor}"></circle>`
    : '';

  // Danger score (1-5) has its own, completely independent scale from
  // hours — plotting it on the hours axis would be meaningless, so this
  // maps each point onto the chart's height using danger's own fixed
  // 5-point max, same y-formula as the hours points but a different
  // denominator. Buckets with no danger data at all (null — happens for
  // dates before any client existed) break the path rather than being
  // plotted as a false zero.
  let dangerLineHtml = '', dangerLabelHtml = '';
  if(dangerSeries && dangerSeries.some(v=>v!=null)){
    const dangerPoints = dangerSeries.map((v,i)=> v==null ? null : {
      x: padX + i*stepX,
      y: h - padY - (v/5)*(h-2*padY),
      v
    });
    let dangerPath = '';
    let penDown = false;
    dangerPoints.forEach(p=>{
      if(!p){ penDown = false; return; }
      dangerPath += (penDown ? 'L' : 'M') + p.x.toFixed(1) + ',' + p.y.toFixed(1) + ' ';
      penDown = true;
    });
    dangerLineHtml = `<path d="${dangerPath.trim()}" fill="none" stroke="#CF2424" stroke-width="1.75" stroke-dasharray="5 4" stroke-linejoin="round" stroke-linecap="round" opacity="0.85"></path>`;
    const lastPoint = [...dangerPoints].reverse().find(p=>p);
    if(lastPoint){
      const topPct = (lastPoint.y / h) * 100;
      dangerLabelHtml = `<div class="xy-chart-danger-label" style="top:${topPct.toFixed(1)}%;">Avg danger ${lastPoint.v.toFixed(1)}/5</div>`;
    }
  }

  const totalHours = values.reduce((s,v)=>s+v,0);
  const lastVal = values[values.length-1] || 0;
  const prevVal = values.length>1 ? values[values.length-2] : 0;
  let trendPct = prevVal>0 ? Math.round(((lastVal-prevVal)/prevVal)*100) : (lastVal>0 ? 100 : 0);
  const trendUp = lastVal >= prevVal;
  const headlineValue = headlineMode==='latest' ? lastVal : totalHours;
  let headlineCaption = '';
  if(headlineMode==='latest'){
    const lastBucket = buckets[buckets.length-1];
    const today = new Date();
    const spansMultipleDays = (today - lastBucket.sortDate) > 24*60*60*1000;
    const captionText = spansMultipleDays
      ? `${lastBucket.sortDate.toLocaleDateString('en-US',{month:'short',day:'numeric'})}–${today.toLocaleDateString('en-US',{month:'short',day:'numeric'})} so far`
      : `${lastBucket.label} (so far)`;
    headlineCaption = `<div class="xy-chart-caption">${captionText}</div>`;
  }

  const showEvery = buckets.length<=8 ? 1 : Math.ceil(buckets.length/6);

  el.innerHTML = `
    <div class="xy-chart-stats">
      <div><div class="xy-chart-value">${headlineValue.toFixed(1)}h</div>${headlineCaption}</div>
      <div class="xy-chart-trend ${trendUp?'up':'down'}">${trendUp?'↗':'↘'} ${Math.abs(trendPct)}%</div>
    </div>
    <div class="xy-chart-svg-wrap" id="${uid}-wrap">
      <svg viewBox="0 0 ${w} ${h}" id="${uid}-svg" preserveAspectRatio="none">
        <defs>
          <linearGradient id="${uid}-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style="stop-color:${lineColor};stop-opacity:0.32;"></stop>
            <stop offset="100%" style="stop-color:${lineColor};stop-opacity:0;"></stop>
          </linearGradient>
        </defs>
        <path d="${areaPath}" fill="url(#${uid}-grad)" stroke="none"></path>
        ${dangerLineHtml}
        <path d="${linePath}" fill="none" stroke="${lineColor}" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"></path>
        ${singlePointDot}
        <line id="${uid}-guide" class="xy-chart-guide" x1="0" y1="${padY}" x2="0" y2="${h-padY}" style="display:none;"></line>
        <circle id="${uid}-dot" class="xy-chart-dot" r="4" style="display:none;"></circle>
        <rect x="0" y="0" width="${w}" height="${h}" fill="transparent" id="${uid}-overlay" style="cursor:crosshair;"></rect>
      </svg>
      ${dangerLabelHtml}
      <div class="xy-chart-tooltip" id="${uid}-tooltip"></div>
    </div>
    <div class="xy-chart-labels">${buckets.map((b,i)=> (i%showEvery===0 || i===buckets.length-1) ? `<span>${escapeHtml(b.label)}</span>` : '<span></span>').join('')}</div>`;

  const overlay = document.getElementById(`${uid}-overlay`);
  const svgEl = document.getElementById(`${uid}-svg`);
  const guide = document.getElementById(`${uid}-guide`);
  const dot = document.getElementById(`${uid}-dot`);
  const tooltip = document.getElementById(`${uid}-tooltip`);

  function showAt(index){
    const p = points[index];
    guide.setAttribute('x1', p.x); guide.setAttribute('x2', p.x);
    guide.style.display = 'block';
    dot.setAttribute('cx', p.x); dot.setAttribute('cy', p.y);
    dot.style.display = 'block';
    tooltip.innerHTML = `${p.v.toFixed(1)}h<div class="xy-tt-label">${escapeHtml(p.label)}</div>`;
    tooltip.style.left = ((p.x/w)*100)+'%';
    tooltip.style.top = ((p.y/h)*100)+'%';
    tooltip.style.display = 'block';
  }
  function hide(){ guide.style.display='none'; dot.style.display='none'; tooltip.style.display='none'; }
  function nearestIndex(clientX){
    const rect = svgEl.getBoundingClientRect();
    const localX = ((clientX-rect.left)/rect.width)*w;
    let nearest=0, nearestDist=Infinity;
    points.forEach((p,i)=>{ const d=Math.abs(p.x-localX); if(d<nearestDist){ nearestDist=d; nearest=i; } });
    return nearest;
  }

  overlay.addEventListener('mousemove', (e)=> showAt(nearestIndex(e.clientX)));
  overlay.addEventListener('mouseleave', hide);
  overlay.addEventListener('touchstart', (e)=>{ if(e.touches[0]) showAt(nearestIndex(e.touches[0].clientX)); }, {passive:true});
  overlay.addEventListener('touchmove', (e)=>{ if(e.touches[0]) showAt(nearestIndex(e.touches[0].clientX)); }, {passive:true});
}

// Surfaces clients approaching or over their monthly hour budget, so the team
// notices before over-servicing a retainer rather than after the fact.
function renderBudgetAlerts(){
  const panel = document.getElementById('budgetAlertsPanel');
  const list = document.getElementById('budgetAlertsList');
  if(!panel || !list) return;

  const flagged = clients
    .map(c=>({ c, budget: monthBudgetInfo(c) }))
    .filter(x=> x.budget && x.budget.tier!=='ok')
    .sort((a,b)=> b.budget.pct - a.budget.pct);

  if(!flagged.length){ panel.style.display = 'none'; return; }
  panel.style.display = 'block';

  list.innerHTML = flagged.map(({c,budget})=>{
    const meta = budgetTierMeta(budget.tier);
    const pct = Math.min(100, budget.pct);
    return `<div class="graphic-bar-row" style="cursor:pointer;" onclick="openClientDetail('${c.id}')">
      <div class="graphic-bar-top">
        <span class="graphic-bar-name">${escapeHtml(c.name)} <span class="pill ${meta.pill}" style="margin-left:6px;">${escapeHtml(meta.label)}</span></span>
        <span class="graphic-bar-val">${(budget.usedMinutes/60).toFixed(1)}h of ${(budget.budgetMinutes/60).toFixed(1)}h (${budget.pct}%)</span>
      </div>
      <div class="graphic-bar-track"><div class="graphic-bar-fill" style="width:${pct}%;background:${meta.color};"></div></div>
    </div>`;
  }).join('');
}

// Clicking a client in the Clients report opens everything logged for that
// client within the currently selected report period — not just "click to
// jump to the client," but a real breakdown scoped to the date range.
// Shared by the detail modal and both single-client export functions, so
// what you see in the modal and what downloads are always exactly the same
// data — same date range, same visibility rules.
function getSingleClientReportEntries(clientId){
  const { start, end } = getReportDateBounds();
  return visibleTimeEntries()
    .filter(e=> e.clientId===clientId && new Date(e.date+'T00:00:00') >= start && (!end || new Date(e.date+'T00:00:00') <= end))
    .sort((a,b)=> new Date(b.date) - new Date(a.date) || new Date(b.createdAt) - new Date(a.createdAt));
}

function getReportRangeLabel(){
  return document.getElementById('reportRange')?.value === 'custom'
    ? `${document.getElementById('reportFromDate').value || '…'} to ${document.getElementById('reportToDate').value || '…'}`
    : (document.getElementById('reportRange')?.options[document.getElementById('reportRange').selectedIndex]?.text || '');
}

function openClientReportDetail(clientId){
  const c = clients.find(x=>x.id===clientId);
  const entries = getSingleClientReportEntries(clientId);
  const totalMinutes = entries.reduce((s,e)=>s+e.minutes,0);
  const rangeLabel = getReportRangeLabel();

  const rows = entries.length ? entries.map(e=>{
    const person = teamProfiles.find(p=>p.id===e.userId);
    return `<div class="ts-entry-card" style="margin-bottom:8px;">
      <div class="ts-entry-info">
        <div class="ts-entry-title">${new Date(e.date+'T00:00:00').toLocaleDateString('en-US',{weekday:'short', month:'short', day:'numeric'})} ${e.service ? `<span class="ts-entry-service">(${escapeHtml(e.service)})</span>` : ''}</div>
        ${e.description ? `<div class="ts-entry-desc">${escapeHtml(e.description)}</div>` : ''}
        <div class="ts-entry-desc" style="margin-top:2px;">Logged by ${person ? escapeHtml(person.name) : 'someone no longer on the team'}</div>
      </div>
      <div class="ts-entry-right"><div class="ts-entry-duration">${formatMinutes(e.minutes)}</div></div>
    </div>`;
  }).join('') : `<div class="empty">No time logged for this client in this period.</div>`;

  openAppModal(`
    <div class="modal-head">
      <div>
        <div class="q-name">${c ? escapeHtml(c.name) : 'Unknown client'}</div>
        <div class="q-service-caption">${rangeLabel} · ${formatMinutes(totalMinutes)} total</div>
      </div>
      <span class="toast-close" onclick="closeAppModal()">✕</span>
    </div>
    <div class="modal-body" style="max-height:50vh;overflow-y:auto;">${rows}</div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="exportSingleClientCsv('${clientId}')">Download CSV</button>
      <button class="btn btn-outline" onclick="exportSingleClientPdf('${clientId}')">Download PDF</button>
      <button class="btn btn-outline" onclick="closeAppModal()">Close</button>
    </div>`, 480);
}

function safeFilenamePart(str){
  return String(str||'client').replace(/[^a-z0-9]+/gi,'_').replace(/^_+|_+$/g,'').slice(0,50) || 'client';
}

function exportSingleClientCsv(clientId){
  const c = clients.find(x=>x.id===clientId);
  const entries = getSingleClientReportEntries(clientId);
  if(!entries.length){ showToast('info','Nothing to export', `No time logged for ${c?c.name:'this client'} in this period.`); return; }
  const headers = ['Date','Service','Team Member','Description','Hours'];
  const lines = [headers.join(',')];
  entries.forEach(e=>{
    const person = teamProfiles.find(p=>p.id===e.userId);
    lines.push([e.date, e.service||'', person?person.name:'Unknown', e.description||'', (e.minutes/60).toFixed(2)].map(csvEscape).join(','));
  });
  const totalMinutes = entries.reduce((s,e)=>s+e.minutes,0);
  lines.push(['Total','','','',(totalMinutes/60).toFixed(2)].map(csvEscape).join(','));
  const blob = new Blob([lines.join('\n')], { type:'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `report_${safeFilenamePart(c?c.name:'client')}_${toDateStr(new Date())}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportSingleClientPdf(clientId){
  const c = clients.find(x=>x.id===clientId);
  const entries = getSingleClientReportEntries(clientId);
  if(!entries.length){ showToast('info','Nothing to export', `No time logged for ${c?c.name:'this client'} in this period.`); return; }
  if(!window.jspdf){ showToast('error','PDF library not loaded','Check your connection and try again.'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const totalMinutes = entries.reduce((s,e)=>s+e.minutes,0);
  const rangeLabel = getReportRangeLabel();

  doc.setFont('helvetica','bold'); doc.setFontSize(16);
  doc.text(`${settings.appName || 'Based Agency'} — Time Report`, 14, 18);
  doc.setFont('helvetica','normal'); doc.setFontSize(12); doc.setTextColor(40);
  doc.text(c ? c.name : 'Unknown client', 14, 26);
  doc.setFontSize(10); doc.setTextColor(100);
  doc.text(`${rangeLabel} · Generated ${new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`, 14, 32);
  doc.text(`Total: ${formatMinutes(totalMinutes)}`, 14, 38);

  let y = 50;
  doc.setFontSize(9); doc.setTextColor(120);
  doc.text('DATE', 14, y); doc.text('SERVICE', 48, y); doc.text('TEAM MEMBER', 90, y);
  doc.text('HOURS', 180, y, { align:'right' });
  y += 3;
  doc.setDrawColor(220); doc.line(14, y, 196, y);
  y += 7;

  doc.setFontSize(9);
  entries.forEach(e=>{
    if(y > 270){ doc.addPage(); y = 20; }
    const person = teamProfiles.find(p=>p.id===e.userId);
    doc.setTextColor(30);
    doc.text(new Date(e.date+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}), 14, y);
    doc.text((e.service||'—').slice(0,20), 48, y);
    doc.text((person?person.name:'Unknown').slice(0,20), 90, y);
    doc.text((e.minutes/60).toFixed(2)+'h', 180, y, { align:'right' });
    if(e.description){
      y += 5;
      doc.setTextColor(140); doc.setFontSize(8);
      doc.text(e.description.slice(0,95), 14, y);
      doc.setFontSize(9);
    }
    y += 7;
  });

  y += 3;
  doc.setDrawColor(220); doc.line(14, y, 196, y);
  y += 7;
  doc.setFont('helvetica','bold'); doc.setTextColor(30);
  doc.text('Total', 14, y);
  doc.text((totalMinutes/60).toFixed(2)+'h', 180, y, { align:'right' });

  doc.save(`report_${safeFilenamePart(c?c.name:'client')}_${toDateStr(new Date())}.pdf`);
}

/* ---------- Bulk client selection + individual downloads ---------- */

let selectedReportClientIds = new Set();

function toggleReportClientSelection(clientId, checked){
  if(checked) selectedReportClientIds.add(clientId);
  else selectedReportClientIds.delete(clientId);
  const selectAll = document.getElementById('reportSelectAllClients');
  if(selectAll && !checked) selectAll.checked = false;
  updateBulkDownloadBar();
}

function toggleAllReportClientSelection(checked){
  document.querySelectorAll('#reportTableBody input[type="checkbox"]').forEach(cb=>{
    cb.checked = checked;
    cb.dispatchEvent(new Event('change'));
  });
}

function clearReportClientSelection(){
  selectedReportClientIds.clear();
  renderReports();
}

function updateBulkDownloadBar(){
  const bar = document.getElementById('bulkDownloadBar');
  const countEl = document.getElementById('bulkDownloadCount');
  if(!bar) return;
  const n = selectedReportClientIds.size;
  const show = reportTab==='clients' && n>0;
  bar.style.display = show ? 'flex' : 'none';
  if(countEl) countEl.textContent = `${n} client${n!==1?'s':''} selected`;
}

// Individually — one file per selected client, not one merged file. A tiny
// stagger between each avoids browsers silently blocking a burst of
// simultaneous auto-triggered downloads.
async function bulkDownloadSelectedClients(format){
  const ids = [...selectedReportClientIds];
  if(!ids.length) return;
  showToast('info','Starting downloads', `Your browser may ask to allow multiple downloads — ${ids.length} file${ids.length!==1?'s':''} incoming.`);
  for(let i=0; i<ids.length; i++){
    if(format==='csv') exportSingleClientCsv(ids[i]);
    else exportSingleClientPdf(ids[i]);
    if(i < ids.length-1) await new Promise(r=>setTimeout(r, 350));
  }
}
