// Payroll (admin-only): hourly rates, periods, overtime, CSV export.

/* ---------- Payroll — admin-only. Hourly rates never appear anywhere else
   in the app, including to the team member the rate belongs to. ---------- */

let payrollRates = {}; // userId -> hourly rate (number)
let payrollPeriodStart = (()=>{
  const d = new Date();
  d.setDate(d.getDate()-13); // default: the 14-day window ending today
  return getWeekStart(d);   // aligned to a Monday for a clean, predictable default
})();

function getPayrollPeriodEnd(){
  const end = new Date(payrollPeriodStart);
  end.setDate(end.getDate()+13);
  end.setHours(23,59,59,999);
  return end;
}

async function loadPayrollRates(){
  if(!isAdmin()){ payrollRates = {}; return; }
  const { data, error } = await supabaseClient.from('payroll_rates').select('*');
  if(error){ console.error('loadPayrollRates error', error); payrollRates = {}; return; }
  payrollRates = {};
  (data||[]).forEach(r=>{ payrollRates[r.user_id] = parseFloat(r.hourly_rate) || 0; });
}

async function renderPayroll(){
  if(!isAdmin()) return; // defense in depth — nav item and view switch already gate this
  await loadPayrollRates();
  renderPayrollPeriodLabel();
  const threshEl = document.getElementById('overtimeThresholdInput');
  const multEl = document.getElementById('overtimeMultiplierInput');
  if(threshEl) threshEl.value = settings.overtimeThresholdHours;
  if(multEl) multEl.value = settings.overtimeMultiplier;
  renderPayrollRatesList();
  renderPayrollSummary();
  await renderPayrollHistory();
}

async function saveOvertimeRules(){
  const threshold = parseFloat(document.getElementById('overtimeThresholdInput').value);
  const multiplier = parseFloat(document.getElementById('overtimeMultiplierInput').value);
  if(!(threshold >= 0)){ showToast('error','Invalid threshold','Enter a valid number of hours.'); return; }
  if(!(multiplier >= 1)){ showToast('error','Invalid multiplier','Overtime multiplier should be at least 1×.'); return; }
  await loadAll();
  settings.overtimeThresholdHours = threshold;
  settings.overtimeMultiplier = multiplier;
  const ok = await persistSettings();
  renderPayrollSummary();
  ok ? showToast('success','Overtime rules saved', `${threshold} hrs/week at ${multiplier}×.`) : showToast('error','Save failed','Could not save — try again.');
}

function renderPayrollPeriodLabel(){
  const el = document.getElementById('payrollPeriodLabel');
  if(!el) return;
  const end = getPayrollPeriodEnd();
  const fmt = (d)=> d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
  el.textContent = `${fmt(payrollPeriodStart)} – ${fmt(end)}`;
  const startInput = document.getElementById('payrollPeriodStartInput');
  if(startInput) startInput.value = toDateStr(payrollPeriodStart);
}

function shiftPayrollPeriod(dir){
  payrollPeriodStart.setDate(payrollPeriodStart.getDate() + dir*14);
  renderPayrollPeriodLabel();
  renderPayrollSummary();
}

function resetPayrollPeriodToToday(){
  const d = new Date();
  d.setDate(d.getDate()-13);
  payrollPeriodStart = getWeekStart(d);
  renderPayrollPeriodLabel();
  renderPayrollSummary();
}

function setPayrollPeriodStart(val){
  if(!val) return;
  payrollPeriodStart = new Date(val+'T00:00:00');
  renderPayrollPeriodLabel();
  renderPayrollSummary();
}

function renderPayrollRatesList(){
  const el = document.getElementById('payrollRatesList');
  if(!el) return;
  if(!teamProfiles.length){ el.innerHTML = `<div class="empty">Nobody on the team yet — add teammates to see them here.</div>`; return; }
  el.innerHTML = [...teamProfiles].sort((a,b)=>a.name.localeCompare(b.name)).map(p=>{
    const rate = payrollRates[p.id] || 0;
    return `<div class="integ-row">
      <div><div class="integ-name">${escapeHtml(p.name)}</div><div class="integ-desc">${escapeHtml(p.title) || escapeHtml(p.role)}</div></div>
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:14px;color:var(--muted-lt);">$</span>
        <input type="number" min="0" step="0.5" id="payrollRateInput-${p.id}" value="${rate || ''}" placeholder="0.00" style="width:90px;font-family:var(--font);font-size:14px;padding:7px 9px;border-radius:6px;border:1px solid var(--border);">
        <span style="font-size:12px;color:var(--muted-lt);">/hr</span>
        <button class="btn btn-outline" onclick="savePayrollRate('${p.id}')">Save</button>
      </div>
    </div>`;
  }).join('');
}

async function savePayrollRate(userId){
  const input = document.getElementById(`payrollRateInput-${userId}`);
  if(!input) return;
  const rate = parseFloat(input.value) || 0;
  if(rate < 0){ showToast('error','Invalid rate','Hourly rate can\'t be negative.'); return; }
  const { error } = await supabaseClient.from('payroll_rates').upsert(
    { user_id: userId, hourly_rate: rate, updated_at: new Date().toISOString(), updated_by: currentUser.id },
    { onConflict: 'user_id' }
  );
  if(error){ showToast('error','Save failed', error.message); return; }
  payrollRates[userId] = rate;
  renderPayrollSummary();
  showToast('success','Rate saved', `$${rate.toFixed(2)}/hr saved.`);
}

function getPayrollSummary(){
  const week1Start = new Date(payrollPeriodStart); week1Start.setHours(0,0,0,0);
  const week1End = new Date(week1Start); week1End.setDate(week1End.getDate()+6); week1End.setHours(23,59,59,999);
  const week2End = getPayrollPeriodEnd(); // period start + 13, end of day

  const thresholdMinutes = (parseFloat(settings.overtimeThresholdHours) || 0) * 60;
  const otMultiplier = parseFloat(settings.overtimeMultiplier) || 1;

  const entries = timeEntries.filter(e=>{
    const d = new Date(e.date+'T00:00:00');
    return d>=week1Start && d<=week2End;
  });

  // byUserWeek[userId] = [week1Minutes, week2Minutes] — overtime is a
  // per-calendar-week thing, so each week gets checked against the
  // threshold on its own, not the two-week total.
  const byUserWeek = {};
  entries.forEach(e=>{
    const d = new Date(e.date+'T00:00:00');
    const wk = d <= week1End ? 0 : 1;
    if(!byUserWeek[e.userId]) byUserWeek[e.userId] = [0,0];
    byUserWeek[e.userId][wk] += e.minutes;
  });

  return [...teamProfiles].sort((a,b)=>a.name.localeCompare(b.name)).map(p=>{
    const weeks = byUserWeek[p.id] || [0,0];
    let regularMinutes = 0, otMinutes = 0;
    weeks.forEach(weekMinutes=>{
      if(weekMinutes > thresholdMinutes){
        regularMinutes += thresholdMinutes;
        otMinutes += (weekMinutes - thresholdMinutes);
      } else {
        regularMinutes += weekMinutes;
      }
    });
    const rate = payrollRates[p.id] || 0;
    const regularHours = regularMinutes/60;
    const otHours = otMinutes/60;
    const regularPay = regularHours * rate;
    const otPay = otHours * rate * otMultiplier;
    return {
      userId:p.id, name:p.name,
      minutes: regularMinutes+otMinutes, hours:(regularMinutes+otMinutes)/60,
      regularMinutes, regularHours, otMinutes, otHours,
      rate, regularPay, otPay, pay: regularPay+otPay
    };
  });
}

function renderPayrollSummary(){
  const body = document.getElementById('payrollSummaryBody');
  const foot = document.getElementById('payrollSummaryFoot');
  if(!body) return;
  const rows = getPayrollSummary();
  if(!rows.length){ body.innerHTML = `<tr><td colspan="5"><div class="empty">Nobody on the team yet — add teammates to see them here.</div></td></tr>`; if(foot) foot.innerHTML = ''; return; }

  body.innerHTML = rows.map(r=>`
    <tr>
      <td>${escapeHtml(r.name)}</td>
      <td class="report-hours-val">${formatMinutes(r.regularMinutes)}</td>
      <td class="report-hours-val" style="${r.otMinutes ? 'color:var(--amber);font-weight:700;' : 'color:var(--muted-lt);'}">${r.otMinutes ? formatMinutes(r.otMinutes) : '—'}</td>
      <td class="report-hours-val">${r.rate ? '$'+r.rate.toFixed(2) : `<span style="color:var(--muted-lt);">Not set</span>`}</td>
      <td class="report-hours-val" style="font-weight:700;">${r.rate ? '$'+r.pay.toFixed(2) : '—'}</td>
    </tr>`).join('');

  const totalPay = rows.reduce((s,r)=>s+r.pay,0);
  const totalRegular = rows.reduce((s,r)=>s+r.regularMinutes,0);
  const totalOt = rows.reduce((s,r)=>s+r.otMinutes,0);
  if(foot){
    foot.innerHTML = `<tr style="font-weight:700;border-top:2px solid var(--border);">
      <td>Total</td>
      <td class="report-hours-val">${formatMinutes(totalRegular)}</td>
      <td class="report-hours-val" style="${totalOt ? 'color:var(--amber);' : ''}">${totalOt ? formatMinutes(totalOt) : '—'}</td>
      <td></td>
      <td class="report-hours-val">$${totalPay.toFixed(2)}</td>
    </tr>`;
  }
}

function exportPayrollCsv(){
  const rows = getPayrollSummary();
  if(!rows.length){ showToast('info','Nothing to export','No team members yet.'); return; }
  const end = getPayrollPeriodEnd();
  const headers = ['Member','Regular Hours','OT Hours','Rate','Regular Pay','OT Pay','Total'];
  const lines = [headers.join(',')];
  rows.forEach(r=>{
    lines.push([r.name, r.regularHours.toFixed(2), r.otHours.toFixed(2), r.rate.toFixed(2), r.regularPay.toFixed(2), r.otPay.toFixed(2), r.pay.toFixed(2)].map(csvEscape).join(','));
  });
  const totalPay = rows.reduce((s,r)=>s+r.pay,0);
  const totalRegular = rows.reduce((s,r)=>s+r.regularHours,0);
  const totalOt = rows.reduce((s,r)=>s+r.otHours,0);
  const totalRegularPay = rows.reduce((s,r)=>s+r.regularPay,0);
  const totalOtPay = rows.reduce((s,r)=>s+r.otPay,0);
  lines.push(['Total', totalRegular.toFixed(2), totalOt.toFixed(2), '', totalRegularPay.toFixed(2), totalOtPay.toFixed(2), totalPay.toFixed(2)].map(csvEscape).join(','));
  const blob = new Blob([lines.join('\n')], { type:'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `payroll_${toDateStr(payrollPeriodStart)}_to_${toDateStr(end)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function markPayrollPeriodPaid(){
  const rows = getPayrollSummary();
  const totalPay = rows.reduce((s,r)=>s+r.pay,0);
  const end = getPayrollPeriodEnd();
  const unratedWithHours = rows.filter(r=>r.minutes>0 && !r.rate);
  let confirmMsg = `Mark ${toDateStr(payrollPeriodStart)} to ${toDateStr(end)} as paid? Total: $${totalPay.toFixed(2)}. This is just a record for your own tracking — it doesn't actually send any money.`;
  if(unratedWithHours.length){
    confirmMsg = `Heads up: ${unratedWithHours.map(r=>r.name).join(', ')} logged hours this period but ${unratedWithHours.length===1?'has':'have'} no rate set, so ${unratedWithHours.length===1?'their':'their'} pay isn't included in this total. ` + confirmMsg;
  }
  if(!confirm(confirmMsg)) return;
  const { error } = await supabaseClient.from('payroll_periods').insert({
    period_start: toDateStr(payrollPeriodStart),
    period_end: toDateStr(end),
    total_amount: totalPay,
    marked_paid_by: currentUser.id
  });
  if(error){ showToast('error','Save failed', error.message); return; }
  await renderPayrollHistory();
  showToast('success','Marked as paid', `${toDateStr(payrollPeriodStart)} to ${toDateStr(end)} recorded.`);
}

async function renderPayrollHistory(){
  const el = document.getElementById('payrollHistoryList');
  if(!el) return;
  el.innerHTML = `${loadingStateHtml('Loading…')}`;
  const { data, error } = await supabaseClient.from('payroll_periods').select('*').order('period_start', { ascending:false }).limit(26);
  if(error){ el.innerHTML = `<div class="empty">Could not load payroll history.</div>`; return; }
  if(!data || !data.length){ el.innerHTML = `<div class="empty">No periods marked as paid yet.</div>`; return; }
  el.innerHTML = data.map(row=>{
    const by = teamProfiles.find(p=>p.id===row.marked_paid_by);
    return `<div class="integ-row">
      <div><div class="integ-name">${new Date(row.period_start+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${new Date(row.period_end+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</div><div class="integ-desc">Marked paid by ${by?escapeHtml(by.name):'someone no longer on the team'} · $${parseFloat(row.total_amount).toFixed(2)} total</div></div>
    </div>`;
  }).join('');
}
