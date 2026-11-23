// Sheets, as on the canvas boards (Log Improvement, Group & Send, New Task): a title, the
// label-left field grid (.f), pop buttons over native selects, and one orange button.
// Loaded after the feature files, so these replace their older modal versions.

// ---- shared pieces -------------------------------------------------------------------------
// A pop button over a native select. `lead` goes before the label (an avatar, say).
function sheetPop(id, label, options, value, onchange, opts){
  opts = opts || {};
  const cur = options.find(o => String(o[0]) === String(value));
  const ph = opts.placeholder && !cur ? `<option value="" selected disabled hidden>${escapeHtml(opts.placeholder)}</option>` : '';
  return `<label class="pop pop-sel${opts.disabled ? ' off' : ''}"${opts.style ? ` style="${opts.style}"` : ''}>${opts.lead || ''}<span class="pl">${escapeHtml(cur ? cur[1] : (opts.placeholder || ''))}</span>${icon('caret-up-down', { weight: 'bold' })}<select id="${id}" aria-label="${escapeHtml(label)}" onchange="syncPopSel(this)${onchange ? ';' + onchange : ''}"${opts.disabled ? ' disabled' : ''}>${ph}${sheetPopOptions(options, value, opts.top)}</select></label>`;
}
// opts.top: ids listed first under "Suggested", then everything under its own heading
function sheetPopOptions(options, value, top){
  const one = ([v, t]) => `<option value="${escapeHtml(v)}"${String(v) === String(value) ? ' selected' : ''}>${escapeHtml(t)}</option>`;
  const first = (top || []).map(id => options.find(o => String(o[0]) === String(id))).filter(Boolean);
  if(!first.length) return options.map(one).join('');
  const rest = options.filter(o => !first.includes(o));
  return `<optgroup label="Suggested">${first.map(one).join('')}</optgroup><optgroup label="${escapeHtml(top.label || 'All')}">${rest.map(one).join('')}</optgroup>`;
}
function sheetSw(id, on, label, extra){ return `<button type="button" class="sw${on ? ' on' : ''}" id="${id}" role="switch" aria-checked="${!!on}" aria-label="${escapeHtml(label)}" onclick="sheetToggle(this)${extra ? ';' + extra : ''}"></button>`; }
function sheetToggle(el){ const on = !el.classList.contains('on'); el.classList.toggle('on', on); el.setAttribute('aria-checked', on); return on; }
function sheetIsOn(id){ return !!document.getElementById(id)?.classList.contains('on'); }
function sheetCk(on, label, onclick){ return `<button type="button" class="ck${on ? ' on' : ''}" role="checkbox" aria-checked="${!!on}" aria-label="${escapeHtml(label)}" onclick="${onclick}">${on ? icon('check', { weight: 'bold' }) : ''}</button>`; }
function sheetWho(name){ return `<span style="display:inline-flex;align-items:center;gap:6px">${avHtml(name)}${escapeHtml(name)}</span>`; }
// "Today, Nov 17", "Yesterday, Nov 16", "Fri, Nov 20"
function sheetDayLabel(d){
  const k = daysBetween(dayStart(rNow()), d), md = fmtShortDate(d);
  return k === 0 ? `Today, ${md}` : k === -1 ? `Yesterday, ${md}` : k === 1 ? `Tomorrow, ${md}` : `${fmtDay(d)}, ${md}`;
}
function sheetDayOptions(from, to){
  const t = dayStart(rNow()), out = [];
  for(let k = from; k <= to; k++){ const d = addDays(t, k); out.push([toDateStr(d), sheetDayLabel(d)]); }
  return out;
}
// "0:30", "45m", "1h 30m", "1.5" → minutes
function parseSpent(str){
  const s = String(str || '').trim();
  const hm = s.match(/^(\d{1,2}):(\d{2})$/);
  if(hm) return (+hm[1]) * 60 + (+hm[2]);
  const n = parseDurationInput(s);
  return n && n > 0 ? n : null;
}

// A date as a pop of nearby days, with "Other Date…" opening the system date picker.
// The select never keeps "__other": it holds the last real value until a date is picked.
function sheetDateLabelLong(v){ const d = new Date(v + 'T12:00:00'); return d.getFullYear() === rNow().getFullYear() ? sheetDayLabel(d) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
function sheetDateField(id, value, o){
  o = o || {};
  const opts = (o.none ? [['', o.none]] : []).concat(o.past ? sheetDayOptions(o.from ?? -30, o.to ?? 0).reverse() : sheetDayOptions(o.from ?? 0, o.to ?? 30));
  if(value && !opts.some(x => x[0] === value)) opts.push([value, sheetDateLabelLong(value)]);
  opts.push(['__other', 'Other Date…']);
  const after = o.after ? `,'${o.after}'` : '';
  return sheetPop(id, o.label || 'Date', opts, value || '', `sheetDateChanged(this${after})`, { disabled: o.disabled })
    + `<input type="date" id="${id}Other" class="tf" style="width:150px" hidden${o.min ? ` min="${o.min}"` : ''}${o.max ? ` max="${o.max}"` : ''} onchange="sheetOtherDate('${id}', this.value${after})">`;
}
function sheetDateChanged(sel, after){
  const other = document.getElementById(sel.id + 'Other');
  if(sel.value === '__other'){
    sel.value = sel.dataset.prev ?? [...sel.options].find(x => x.defaultSelected)?.value ?? ''; syncPopSel(sel);
    if(other){ other.hidden = false; other.value = sel.value || ''; try{ other.showPicker(); }catch(e){ other.focus(); } }
    return;
  }
  sel.dataset.prev = sel.value;
  if(other) other.hidden = true;
  if(after && typeof window[after] === 'function') window[after](sel.value);
}
function sheetOtherDate(id, v, after){
  const sel = document.getElementById(id), other = document.getElementById(id + 'Other');
  if(!sel || !v) return;
  if(![...sel.options].some(x => x.value === v)){ const op = document.createElement('option'); op.value = v; op.textContent = sheetDateLabelLong(v); sel.insertBefore(op, sel.querySelector('option[value="__other"]')); }
  sel.value = v; sel.dataset.prev = v; syncPopSel(sel);
  if(other) other.hidden = true;
  if(after && typeof window[after] === 'function') window[after](v);
}
// Times as a pop: every 15 minutes (or `step`), plus the current value if it falls between.
function sheetTimeOpts(value, step, first){
  const out = first ? [first] : [];
  for(let m = 0; m < 24 * 60; m += (step || 15)){ const hh = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); out.push([hh, fmtTime(atTime(new Date(), hh))]); }
  if(value && !out.some(x => x[0] === value)){ out.push([value, fmtTime(atTime(new Date(), value))]); out.sort((a, b) => (a[0] || '').localeCompare(b[0] || '')); }
  return out;
}
// A switch that drives a hidden checkbox, for forms whose save reads `.checked`.
function sheetSwCk(id, on, label, extra){
  return `<button type="button" class="sw${on ? ' on' : ''}" role="switch" aria-checked="${!!on}" aria-label="${escapeHtml(label)}" onclick="sheetToggle(this);document.getElementById('${id}').checked=this.classList.contains('on')${extra ? ';' + extra : ''}"></button><input type="checkbox" id="${id}" hidden${on ? ' checked' : ''}>`;
}
// forWork: logging time or work, so members only get the clients in their areas (work-areas.js)
function sheetClientOptions(extraId, forWork){
  const list = forWork ? waWorkable(liveClients(), extraId) : liveClients().slice();
  if(extraId && !list.some(c => c.id === extraId)){ const c = clients.find(x => x.id === extraId); if(c) list.push(c); }
  return list.sort((a, b) => a.name.localeCompare(b.name)).map(c => [c.id, c.name + (c.deletedAt ? ' (deleted)' : '')]);
}

// ---- improvement details: service and screenshots -------------------------------------------
// Two columns added by addendum-improvement-details.sql. Until that's run the app logs
// improvements as before and leaves the Screenshots row out of the sheet.
let improvementExtrasReady = null; // null: not known yet
function improvementRowFromDb(r){
  if(r && Object.prototype.hasOwnProperty.call(r, 'service')) improvementExtrasReady = true;
  return { id: r.id, clientId: r.client_id, author: r.author || '', text: r.text, date: r.date, includeInEmail: r.include_in_email, source: r.source,
    service: r.service || '', attachments: Array.isArray(r.attachments) ? r.attachments : [],
    ...(r.deleted_at ? { deletedAt: r.deleted_at, deletedBy: r.deleted_by || null } : {}),   // deleted work (data.js)
    createdAt: r.created_at || null, editedAt: r.edited_at || null, carryOver: !!r.carry_over };   // addendum-flow-gaps.sql
}
function isMissingColumnError(e){ return !!e && (e.code === '42703' || e.code === 'PGRST204' || /column/i.test(e.message || '') && /(does not exist|could not find)/i.test(e.message || '')); }
async function insertImprovementFull(clientId, f){
  const base = { client_id: clientId, author: f.author, text: f.text, include_in_email: f.includeInEmail, source: f.source || 'manual' };
  if(f.date) base.date = f.date;
  let res = null;
  if(improvementExtrasReady !== false && f.service){
    res = await supabaseClient.from('client_improvements').insert({ ...base, service: f.service }).select().single();
    if(res.error && isMissingColumnError(res.error)){ improvementExtrasReady = false; res = null; }
  }
  if(!res) res = await supabaseClient.from('client_improvements').insert(base).select().single();
  if(res.error || !res.data){ console.error('insertImprovementFull failed', clientId, res.error); return null; }
  const entry = improvementRowFromDb(res.data);
  if(!entry.service && f.service && improvementExtrasReady !== false) entry.service = f.service;
  clientImprovements.push(entry);
  const c = clients.find(x => x.id === clientId);
  if(c){ c.improvements = c.improvements || []; c.improvements.push(entry); }
  return entry;
}
async function uploadImprovementFiles(imp, files){
  const done = []; let failed = 0;
  for(const f of files){
    if(f.size > 10 * 1024 * 1024){ failed++; continue; }
    const path = `improvements/${imp.id}/${Date.now()}-${f.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    try{
      const { error } = await supabaseClient.storage.from('attachments').upload(path, f);
      if(error){ failed++; continue; }
      done.push({ name: f.name, path, size: f.size, type: f.type, uploadedAt: new Date().toISOString() });
    }catch(e){ failed++; }
  }
  if(done.length){
    const { error } = await supabaseClient.from('client_improvements').update({ attachments: done }).eq('id', imp.id);
    if(error){
      try{ await supabaseClient.storage.from('attachments').remove(done.map(d => d.path)); }catch(e){}
      return { saved: 0, failed: failed + done.length };
    }
    imp.attachments = done;
  }
  return { saved: done.length, failed };
}
// The paperclip on an improvement row, and the sheet it opens.
function impFilesBtn(i){
  const n = (i.attachments || []).length;
  return n ? `<button class="ib" aria-label="${n} screenshot${n === 1 ? '' : 's'}" title="${n} screenshot${n === 1 ? '' : 's'}" onclick="event.stopPropagation();openImprovementFiles('${i.clientId}','${i.id}')">${icon('paperclip')}</button>` : '';
}
async function openImprovementFiles(clientId, impId){
  const c = clients.find(x => x.id === clientId);
  const i = (c?.improvements || []).find(x => x.id === impId) || clientImprovements.find(x => x.id === impId);
  if(!i || !(i.attachments || []).length) return;
  openAppModal(`<h3>Screenshots</h3>
<p class="t-2" style="margin:-8px 0 14px;font-size:14px;line-height:1.45">${escapeHtml(i.text)}</p>
<div class="att-grid" id="impFilesGrid"><div class="t-2" style="font-size:13px">Loading…</div></div>
<div class="sheet-a"><button class="btn btn-p" onclick="closeAppModal()">Done</button></div>`, 560);
  const withUrls = await Promise.all(i.attachments.map(async a => {
    try{ const { data } = await supabaseClient.storage.from('attachments').createSignedUrl(a.path, 3600); return { ...a, url: data?.signedUrl || null }; }
    catch(e){ return { ...a, url: null }; }
  }));
  const grid = document.getElementById('impFilesGrid'); if(!grid) return;
  window._impPics = withUrls.filter(a => isImageAttachment(a) && a.url).map(a => ({ url: a.url, name: a.name }));
  grid.innerHTML = withUrls.map(a => isImageAttachment(a) && a.url
    ? `<button class="att" onclick="openImageLightbox(${jsArg(a.url)}, ${jsArg(a.name)}, window._impPics)"><img src="${safeUrl(a.url)}" alt=""><span>${escapeHtml(a.name)}</span></button>`
    : `<a class="att" href="${a.url ? safeUrl(a.url) : '#'}" download="${escapeHtml(a.name)}"><span class="att-f">${icon('file-text')}</span><span>${escapeHtml(a.name)}</span></a>`).join('');
}

// ---- Log Improvement ------------------------------------------------------------------------
let logSheet = { files: [], useTimer: false, serviceTouched: false };
function logSheetServices(c){
  const opts = (settings.serviceOptions || []).slice();
  if(c && c.service && !opts.includes(c.service)) opts.unshift(c.service);
  return opts;
}
// The Service row, for clients that aren't in Harvest. A client in Harvest buys its projects:
// the improvement takes the one you log time to, or the client's only project.
function liServiceRowHtml(c){
  if(c ? serviceFromHarvest(c) : harvestOwnsServices()) return '';
  const services = logSheetServices(c);
  return `<label for="liService">Service</label><div>${sheetPop('liService', 'Service', services.map(s => [s, s]), (c && c.service) || services[0] || '', 'logSheet.serviceTouched=true')}</div>`;
}
// A suggestion under the Client picker: choose it, as if picked from the list
function liPickSuggested(id){
  const sel = document.getElementById('liClient'); if(!sel) return;
  sel.value = id; syncPopSel(sel); liClientChanged();
  document.getElementById('liText')?.focus();
}
function openQueueLogImprovementModal(presetClientId){
  logSheet = { files: [], useTimer: false, serviceTouched: false };
  const me = myName() || 'Team member';
  const list = waWorkable(liveClients(), '').sort((a, b) => a.name.localeCompare(b.name));
  const fromView = typeof currentViewName !== 'undefined' && currentViewName === 'clientdetail' && typeof currentDetailClientId !== 'undefined' ? currentDetailClientId : '';
  // a client outside your areas: say so instead of opening (members; work-areas.js)
  const pc = typeof presetClientId === 'string' && presetClientId ? clients.find(x => x.id === presetClientId) : null;
  if(pc && !waCanWork(pc)){ showToast('info', `${pc.name} isn’t one of your clients`, waOutsideWords(pc)); return; }
  let cid = (typeof presetClientId === 'string' && presetClientId) || fromView || (timerState.running ? timerState.clientId : '') || '';
  if(cid && !list.some(x => x.id === cid)) cid = '';
  const c = list.find(x => x.id === cid);
  // Worth logging for (logSuggestions, week-health.js): first in the picker, and, when no client is
  // chosen yet, the top three under it with why
  const sug = typeof logSuggestions === 'function' ? logSuggestions(5).filter(x => list.some(l => l.id === x.c.id)) : [];
  const sugTop = Object.assign(sug.map(x => x.c.id), { label: 'All clients' });
  const sugRows = !cid && sug.length ? `<div class="li-sg" role="group" aria-label="Worth logging for"><span class="li-sgh">Worth logging for</span>${sug.slice(0, 3).map(x =>
    `<button type="button" class="li-sgr" data-id="${x.c.id}" onclick="liPickSuggested('${x.c.id}')"><b>${escapeHtml(x.c.name)}</b><span${/overdue/.test(x.why) ? ' class="is-late"' : ''}>${escapeHtml(x.why)}</span></button>`).join('')}</div>` : '';
  const timerLink = timerState.running ? `<button type="button" class="btn btn-q" id="liTimerBtn" style="padding:0 4px" onclick="liUseTimer()">Use the running timer (${hmm((Date.now() - timerState.startedAt) / 60000)})</button>` : '';
  openAppModal(`<h3>Log Improvement</h3>
<div class="f">
<label for="liClient"${sugRows ? ' class="top"' : ''}>Client</label><div>${sheetPop('liClient', 'Client', list.map(x => [x.id, x.name]), cid, 'liClientChanged()', { placeholder: 'Choose a client', top: sugTop })}${sugRows}</div>
<label class="top" for="liText">What did you do?</label><textarea id="liText" class="tf" style="height:84px" spellcheck="true" placeholder="What changed, with the number or result if there is one"></textarea>
<div id="liSvc" class="hvp">${liServiceRowHtml(c)}</div>
<label for="liDate">Date</label><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">${sheetDateField('liDate', toDateStr(new Date()), { past: true, from: -13, to: 0, max: toDateStr(new Date()) })}</div>
<label for="liTime">Time spent</label><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><input id="liTime" class="tf" style="width:80px" placeholder="0:30" autocomplete="off" oninput="logSheet.useTimer=false;liTimeChanged()">${timerLink}</div>
<div id="liPick" class="hvp"></div>
<span></span><div style="display:flex;align-items:flex-start;gap:10px;font-size:14px">${sheetSw('liInclude', !c || getsUpdates(c), 'Include in the client email', 'logSheet.incTouched=true')}<div><div>Include in the client email</div><div class="t-2" id="liIncHint" style="font-size:13px">${liIncHint(c)}</div></div></div>
${improvementExtrasReady === false ? '' : `<label>Screenshots</label><div class="fchips" id="liFiles"></div>`}
<label>Logged by</label><div style="font-size:14px">${sheetWho(me)}</div>
</div>
<input type="file" id="liFileInput" multiple accept="image/*,.pdf" hidden onchange="liAddFiles(this)">
<div class="sheet-a"><button class="btn" style="margin-right:auto" onclick="saveQueueLogImprovement(true)">Log &amp; Add Another</button><button class="btn" onclick="closeAppModal()">Cancel</button><button class="btn btn-p" onclick="saveQueueLogImprovement()">Log Improvement</button></div>`, 520);
  liRenderFiles();
  setTimeout(() => { const el = document.getElementById(cid ? 'liText' : 'liClient'); if(el) el.focus(); }, 30);
}
// Time spent goes to Harvest by project and task: those two rows show once there's time to log.
function liTimeChanged(force){
  const wrap = document.getElementById('liPick'); if(!wrap || typeof hvTimeOn !== 'function' || !hvTimeOn()) return;
  const has = !!(document.getElementById('liTime')?.value || '').trim(), cid = document.getElementById('liClient')?.value || '';
  if(!has){ if(wrap.innerHTML) wrap.innerHTML = ''; return; }
  if(wrap.innerHTML && !force) return;
  const fromTimer = logSheet.useTimer && timerState.running && timerState.clientId === cid && timerState.projectId;
  const d = fromTimer ? { projectId: timerState.projectId, taskId: timerState.taskId } : hvDefaultPick(cid);
  wrap.innerHTML = hvPickRowsHtml('li', cid, d.projectId, d.taskId);
}
// A client with no weekly update (Nov 22): its work starts internal, and the hint says why.
function liIncHint(c){ return c && !getsUpdates(c) ? `${escapeHtml(c.name)} gets no weekly update, so its work stays internal` : 'Turn off for internal work the client doesn’t need to hear about'; }
function liClientChanged(){
  liTimeChanged(true);
  const c = clients.find(x => x.id === document.getElementById('liClient')?.value);
  const sw = document.getElementById('liInclude'), hint = document.getElementById('liIncHint');
  if(sw && !logSheet.incTouched){ const on = !c || getsUpdates(c); sw.classList.toggle('on', on); sw.setAttribute('aria-checked', on); }
  if(hint) hint.innerHTML = liIncHint(c);
  document.querySelectorAll('.li-sgr').forEach(b => b.classList.toggle('on', !!c && b.dataset.id === c.id));
  const wrap = document.getElementById('liSvc');
  if(!c || !wrap || (logSheet.serviceTouched && !serviceFromHarvest(c) && document.getElementById('liService'))) return;
  wrap.innerHTML = liServiceRowHtml(c);
}
function liUseTimer(){
  if(!timerState.running) return;
  const t = document.getElementById('liTime'), sel = document.getElementById('liClient'), txt = document.getElementById('liText');
  if(t) t.value = hmm((Date.now() - timerState.startedAt) / 60000);
  if(sel && timerState.clientId && sel.value !== timerState.clientId){ sel.value = timerState.clientId; syncPopSel(sel); liClientChanged(); }
  if(txt && !txt.value.trim() && timerState.description) txt.value = timerState.description;
  logSheet.useTimer = true;
  liTimeChanged(true);
}
function liAddFiles(input){
  const add = [...(input.files || [])];
  const big = add.filter(f => f.size > 10 * 1024 * 1024);
  logSheet.files = logSheet.files.concat(add.filter(f => f.size <= 10 * 1024 * 1024)).slice(0, 8);
  input.value = '';
  if(big.length) showToast('error', 'Too large', `${big.map(f => f.name).join(', ')} ${big.length === 1 ? 'is' : 'are'} over 10 MB.`);
  liRenderFiles();
}
function liRemoveFile(k){ logSheet.files.splice(k, 1); liRenderFiles(); }
function liRenderFiles(){
  const el = document.getElementById('liFiles'); if(!el) return;
  el.innerHTML = logSheet.files.map((f, k) => `<span class="fchip">${icon(f.type && f.type.startsWith('image/') ? 'image' : 'file-text')}<span>${escapeHtml(f.name)}</span><button type="button" aria-label="Remove ${escapeHtml(f.name)}" onclick="liRemoveFile(${k})">${icon('x')}</button></span>`).join('')
    + `<button type="button" class="btn" onclick="document.getElementById('liFileInput').click()">${icon('paperclip')}${logSheet.files.length ? 'Add More…' : 'Add Files…'}</button>`;
}
async function saveQueueLogImprovement(another){
  const g = id => document.getElementById(id);
  const clientId = g('liClient')?.value || '';
  const text = (g('liText')?.value || '').trim();
  if(!clientId){ showToast('error', 'Pick a client', 'Choose which client this is for.'); return; }
  if(isClientPaused(clientId)){ showPausedClientWarning(clientId); return; }
  if(!text){ showToast('error', 'Nothing to log', 'Write what you did first.'); g('liText')?.focus(); return; }
  const timeRaw = (g('liTime')?.value || '').trim();
  const minutes = timeRaw ? parseSpent(timeRaw) : 0;
  if(timeRaw && !minutes){ showToast('error', 'Check the time', 'Try 0:30, 45m or 1h 30m.'); g('liTime')?.focus(); return; }
  const pick = minutes && g('liPick') && g('liPick').innerHTML && typeof hvPickValue === 'function' ? hvPickValue('li', clientId) : { ok: true, projectId: null, taskId: null };
  if(!pick.ok){ showToast('error', 'Almost there', pick.msg); return; }
  if(minutes > 960 && !(await confirmDialog(`That’s ${hmLong(minutes)} for one improvement. Log it anyway?`, { confirmLabel: 'Log It', cancelLabel: 'Fix It' }))) return;
  if(!(await okToLogDuplicate(clientId, text))) return;   // logged already? (data.js)
  const picked = g('liService')?.value || '';
  const dateStr = g('liDate')?.value || toDateStr(new Date());
  const include = sheetIsOn('liInclude');
  const author = myName() || 'Team member';
  const files = logSheet.files.slice(), useTimer = logSheet.useTimer, fromNote = logSheet.fromNote || null;
  const btn = clickedBtn();
  setBtnLoading(btn, 'Saving…');
  await loadAll();
  const c = clients.find(x => x.id === clientId);
  if(!c){ restoreBtn(btn); showToast('error', 'Client not found', 'This client may have been removed by someone else.'); return; }
  const service = serviceFromHarvest(c) ? (pick.projectId ? pick.service : improvementServiceFor(c)) : picked || c.service || '';
  const when = dateStr === toDateStr(new Date()) ? new Date() : new Date(dateStr + 'T12:00:00');
  const imp = await insertImprovementFull(clientId, { author, text, includeInEmail: include, source: fromNote ? 'note' : 'manual', date: when.toISOString(), service });
  if(!imp){ restoreBtn(btn); showToast('error', 'Save failed', 'Could not save this improvement. Try again.'); return; }
  // Logged from a note (Notes → Log as Improvement): that note is now done.
  if(fromNote){ logSheet.fromNote = null; if(typeof noteMarkLogged === 'function') await noteMarkLogged(fromNote); }
  // Work for the email changes what the writer's draft should say; internal work doesn't.
  if(include){ const inv = invalidateStaleDraft(c, author); if(inv) await saveDraftFor(clientId, author, { draftStatus: 'none', draft: '' }); }
  let timeOk = true;
  if(minutes){
    if(useTimer && timerState.running && timerState.clientId === clientId){
      if(!timerState.service){ timerState.service = service; saveTimerState(); }
      if(pick.projectId){ timerState.projectId = pick.projectId; timerState.taskId = pick.taskId; timerState.service = pick.service; saveTimerState(); }
      const id = await stopAndSaveTimer({ quiet: true, improvementId: imp.id });
      if(id) await supabaseClient.from('time_entries').update({ logged: true }).eq('id', id); else timeOk = false;
    } else {
      const r = await mergeOrInsertTimeEntry({ clientId, service: pick.projectId ? pick.service : service, dateStr, minutes, description: text, projectId: pick.projectId, taskId: pick.taskId, improvementId: imp.id });
      if(r.error) timeOk = false;
      else {
        if(!r.merged && r.entryId) await supabaseClient.from('time_entries').update({ logged: true }).eq('id', r.entryId);
        syncEntryToHarvestBackground(r.entryId);
      }
      await loadTimeEntries();
      if(typeof renderTimesheet === 'function') renderTimesheet();
    }
  }
  const up = files.length ? await uploadImprovementFiles(imp, files) : { saved: 0, failed: 0 };
  logClientActivity(clientId, 'improvement_logged', `${author} logged an improvement: "${text.length > 80 ? text.slice(0, 80) + '…' : text}"`);
  refreshClientDetailActivityIfOpen(clientId);
  restoreBtn(btn);
  renderAll();
  const extras = [minutes && timeOk ? `${hmLong(minutes)} on your timesheet` : '', up.saved ? `${up.saved} screenshot${up.saved === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
  if(up.failed) showToast('info', 'Logged, without some screenshots', `${up.failed} file${up.failed === 1 ? '' : 's'} couldn’t be uploaded. The improvement is saved for ${c.name}.`);
  else if(minutes && !timeOk) showToast('info', 'Logged, without the time', `The improvement is saved for ${c.name}, but the time didn’t save. Add it on the Timesheet.`);
  else showToast('success', 'Improvement logged', `Saved for ${c.name}${extras ? ' · ' + extras : ''}.`);
  if(another){
    logSheet.files = []; logSheet.useTimer = false;
    if(g('liText')) g('liText').value = '';
    if(g('liTime')) g('liTime').value = '';
    if(g('liPick')) g('liPick').innerHTML = '';
    const tb = g('liTimerBtn'); if(tb && !timerState.running) tb.remove();
    liRenderFiles();
    g('liText')?.focus();
  } else closeAppModal();
}

// ---- Group & Send: each person's part of each client's update, written at once --------------------
// Each client's work since its last update, one part per person who logged it (Nov 22): a member
// writes their own parts; an approver writes everyone's. The parts go to Review, and a client's
// approved parts go out as one email. Clients due within 2 days are picked to start with.
let gsList = [], gsPick = new Set();
function gsCandidates(){
  const me = myName(), mineOnly = !canApprove(), out = [];
  const onTeam = n => teamProfiles.some(p => p.name === n && !p.access_revoked);
  const byDate = (a, b) => new Date(a.date) - new Date(b.date), s = n => n === 1 ? '' : 's';
  weekVisibleClients().forEach(c => {
    const drafts = c.drafts || [], w = clientWeek(c);
    const inEmail = w.logged.filter(i => i.includeInEmail !== false && (mineOnly ? i.author === me : onTeam(i.author)));
    if(!inEmail.length) return;
    const byAuthor = {}; inEmail.forEach(i => (byAuthor[i.author] = byAuthor[i.author] || []).push(i));
    const parts = [];
    Object.entries(byAuthor).forEach(([author, items]) => {
      const d = drafts.find(x => x.author === author);
      if(d && !d.draftSentAt && (d.draftStatus === 'approved' || (d.draftStatus === 'pending' && d.readyToNotify))) return;   // in Review or approved
      let redraft = 0;
      if(d && d.draft && !d.draftSentAt && d.draftStatus === 'pending'){ const have = new Set(d.draftImprovementIds || []); redraft = items.filter(i => !have.has(i.id)).length; if(!redraft) return; }
      if(!canGenerateOrRegenerateDraft(c, author)) return;
      parts.push({ writer: author, items: items.sort(byDate), redraft });
    });
    if(!parts.length) return;
    const who = p => p.writer === me ? 'you' : firstName(p.writer), p0 = parts[0];
    const sub = parts.length > 1 ? `${parts.length} parts: ${joinNames(parts.map(who))}`
      : p0.redraft ? `Redraft with the ${p0.redraft} new improvement${s(p0.redraft)} · ${who(p0)}`
      : `${p0.items.length} improvement${s(p0.items.length)} · ${p0.writer === me ? 'your part' : firstName(p0.writer) + '’s part'}`;
    out.push({ c, parts, sub: `${w.dueText} · ${sub}`, daysLeft: w.daysLeft });
  });
  return out.sort((a, b) => a.daysLeft - b.daysLeft || a.c.name.localeCompare(b.c.name));
}
function openGroupAndSendModal(){
  gsList = gsCandidates();
  gsPick = new Set(gsList.filter(x => x.daysLeft <= 2).map(x => x.c.id));
  gsRender();
}
function gsToggle(id){ gsPick.has(id) ? gsPick.delete(id) : gsPick.add(id); gsRender(true); }
function gsRender(keep){
  const rows = gsList.map(x => `<div class="row" style="cursor:default" onclick="gsToggle('${x.c.id}')">${sheetCk(gsPick.has(x.c.id), 'Include ' + x.c.name, `event.stopPropagation();gsToggle('${x.c.id}')`)}${monoHtml(x.c)}<div class="tx"><span class="t">${escapeHtml(x.c.name)}</span><span class="s">${escapeHtml(x.sub)}</span></div></div>`).join('')
    || `<div class="row"><div class="tx"><span class="t">Nothing to group</span><span class="s">Every client with work logged since its last update already has a draft.</span></div></div>`;
  const n = gsList.filter(x => gsPick.has(x.c.id)).reduce((k, x) => k + x.parts.length, 0);   // one draft per part
  const html = `<h3>Group &amp; Send</h3>
<p style="margin:-8px 0 14px;font-size:14px;color:var(--label-2);line-height:1.5">Each person’s improvements become their part of the client’s update. Parts go to Review first, and a client’s parts go out together, as one email, once an approver sends them.</p>
<div class="grp gs-list" style="box-shadow:0 0 0 .5px var(--sep-strong)">${rows}</div>
<div class="form-grp" style="margin-top:14px">
<div class="fr"><div class="l"><b>Write the drafts with AI</b><span>Uses your email structure and signature from Settings</span></div>${sheetSw('gsAI', gsAIOn(), 'Write the drafts with AI', 'gsSaveAI()')}</div>
</div>
<div class="sheet-a"><button class="btn" onclick="closeAppModal()">Cancel</button><button class="btn btn-p" id="gsGo" onclick="createGroupDrafts()"${n ? '' : ' disabled'}>Create ${n ? n + ' ' : ''}Draft${n === 1 ? '' : 's'}</button></div>`;
  const card = document.querySelector('#appModalOverlay .modal-card');
  if(keep && card && card.dataset.sheet === 'gs'){ const st = card.querySelector('.gs-list')?.scrollTop || 0; card.innerHTML = html; const l = card.querySelector('.gs-list'); if(l) l.scrollTop = st; return; }
  openAppModal(html, 560);
  const c2 = document.querySelector('#appModalOverlay .modal-card'); if(c2) c2.dataset.sheet = 'gs';
}
function gsAIOn(){ try{ return localStorage.getItem('bda_gs_ai') !== '0'; }catch(e){ return true; } }
function gsSaveAI(){ try{ localStorage.setItem('bda_gs_ai', sheetIsOn('gsAI') ? '1' : '0'); }catch(e){} }
async function createGroupDrafts(){
  const picks = gsList.filter(x => gsPick.has(x.c.id));
  if(!picks.length) return;
  const useAI = sheetIsOn('gsAI');
  const btn = document.getElementById('gsGo');
  if(btn) btn.disabled = true;
  let ok = 0, fail = 0, aiMissed = 0;
  const jobs = picks.flatMap(x => x.parts.map(p => ({ c: x.c, writer: p.writer, items: p.items })));
  for(const [k, x] of jobs.entries()){
    if(btn) btn.textContent = `Writing ${k + 1} of ${jobs.length}…`;
    let text = '';
    if(useAI){
      try{
        const r = await fetch('/api/generate-draft', { method: 'POST', headers: await apiAuthHeaders(), body: JSON.stringify({ prompt: buildUpdatePrompt(x.c, x.items), model: settings.openaiModel }) });
        const data = await r.json();
        text = (data.text || '').trim();
      }catch(e){ console.error('Group & Send: AI draft failed', x.c.name, e); }
      if(!text) aiMissed++;
    }
    if(!text) text = plainUpdateDraft(x.c, x.items);
    const saved = await saveDraftFor(x.c.id, x.writer, { draft: text, draftStatus: 'pending', draftPendingSince: new Date().toISOString(),
      draftSentAt: null, draftSentBy: '', readyToNotify: true, draftImprovementIds: x.items.map(i => i.id) });
    if(saved){ ok++; logClientActivity(x.c.id, 'draft_generated', `${useAI && text ? 'AI wrote' : 'Started'} ${x.writer}'s part from ${x.items.length} improvement${x.items.length === 1 ? '' : 's'} with Group & Send, and sent it to Review.`); }
    else fail++;
  }
  if(ok){
    const approvers = teamProfiles.filter(p => (p.role === 'admin' || p.role === 'approver') && p.id !== currentUser?.id);
    const one = picks.length === 1 ? picks[0].c : null;
    for(const a of approvers) await sendNotification(a.id, 'draft_ready', one ? `${one.name}: draft ready for review` : `${ok} drafts ready for review`, `Created with Group & Send by ${myName() || 'a teammate'}.`, 'teamqueue', one ? one.id : undefined);
  }
  closeAppModal();
  renderAll();
  if(fail) showToast('error', `${fail} draft${fail === 1 ? '' : 's'} didn’t save`, ok ? `${ok} went to Review. Try the others again in a moment.` : 'Try again in a moment.');
  else showToast('success', `${ok} draft${ok === 1 ? ' is' : 's are'} in Review`, aiMissed ? `${aiMissed} ${aiMissed === 1 ? 'was' : 'were'} started from the logged work because the AI didn’t answer. Edit ${aiMissed === 1 ? 'it' : 'them'} in Review.` : 'An approver reads each one before it goes to the client.');
}

// ---- Colors for tasks, notes and sprints: None and six colors (orange stays the main button's) ----
const ITEM_COLORS = [['red', 'Red'], ['yellow', 'Yellow'], ['green', 'Green'], ['blue', 'Blue'], ['purple', 'Purple'], ['gray', 'Gray']];
function itemColorName(v){ return (ITEM_COLORS.find(c => c[0] === v) || [, 'None'])[1]; }
// A row of swatches. onpick is called with the color (or null) after a pick.
function colorSwatchesHtml(id, value, onpick, opts){
  const o = opts || {}, v = ITEM_COLORS.some(c => c[0] === value) ? value : null;
  const sw = (k, label) => `<button type="button" class="cc${k ? ' c-' + k : ' none'}${(k || null) === v ? ' on' : ''}" role="radio" aria-checked="${(k || null) === v}" aria-label="${label}" title="${label}" data-v="${k || ''}" onclick="pickItemColor(this${onpick ? `,'${onpick}'` : ''})" onkeydown="colorSwatchKey(event,this)"></button>`;
  return `<div class="cc-row${o.small ? ' is-sm' : ''}" id="${id}" role="radiogroup" aria-label="Color">${sw('', 'None')}${ITEM_COLORS.map(([k, l]) => sw(k, l)).join('')}${o.small ? '' : `<span class="cc-name">${itemColorName(v)}</span>`}</div>`;
}
function pickItemColor(b, onpick){
  const row = b.parentElement;
  row.querySelectorAll('.cc').forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', on); });
  const v = b.dataset.v || null, nm = row.querySelector('.cc-name'); if(nm) nm.textContent = itemColorName(v);
  if(onpick && typeof window[onpick] === 'function') window[onpick](v);
}
function colorSwatchKey(e, b){
  if(!['ArrowRight', 'ArrowLeft'].includes(e.key)) return;
  e.preventDefault();
  const all = [...b.parentElement.querySelectorAll('.cc')], i = all.indexOf(b), n = all[(i + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length];
  n.focus(); n.click();
}
function pickedItemColor(id){ const b = document.querySelector(`#${id} .cc.on`); return b ? (b.dataset.v || null) : null; }
// Until addendum-colors-and-plan.sql has run there's no color column: save without it, and say so once.
let _colorColumnWarned = false;
function warnNoColorColumn(title){
  if(_colorColumnWarned && !title) return; _colorColumnWarned = true;
  showToast('info', title || 'Saved without the color', 'Colors need a one-time database update (addendum-colors-and-plan.sql). Ask an admin to run it.');
}

// ---- New Task / Edit Task -------------------------------------------------------------------
// Only the person who assigned a task can change it, its date included (Nov 22). The person it's
// assigned to asks them instead, here and on the iPhone: a comment on the task, so it's on record,
// and a notification. Without the comments table (addendum-task-comments.sql) it's just the notification.
function taskAssignerFor(t){ const p = teamProfiles.find(x => x.id === t.assignerId); return p && !p.access_revoked ? p : null; }
function taskCanAskDate(t){ return !!t && t.assigneeId === currentUser.id && t.assignerId !== currentUser.id && t.status !== 'done' && !t.cancelledAt && !!taskAssignerFor(t); }
function taskDateAskText(t){
  const who = taskAssignerFor(t), d = t.dueDate ? new Date(t.dueDate + 'T12:00:00') : null;
  return `${who ? firstName(who.name) + ', can' : 'Can'} you move the due date? ${d ? `It’s set for ${fmtDay(d)}, ${fmtShortDate(d)}.` : 'It has no date yet.'} New date: `;
}
async function sendTaskDateAsk(t, body){
  body = String(body || '').trim(); const who = taskAssignerFor(t);
  if(!body || !who) return false;
  const { data, error } = await supabaseClient.from('task_comments').insert({ task_id: t.id, user_id: currentUser.id, body }).select().single();
  if(!error && typeof taskComments !== 'undefined') (taskComments[t.id] = taskComments[t.id] || []).push(data || { user_id: currentUser.id, body, created_at: new Date().toISOString() });
  const notify = typeof sendNotification === 'function' ? sendNotification : mNotify;
  await notify(who.id, 'task_comment', `${myName() || 'Someone'} asks to move “${t.title}”`, body.length > 140 ? body.slice(0, 140) + '…' : body, 'tasks', t.id);
  return true;
}
let taskDueTimes = {};
async function loadTaskDueTimes(){
  const raw = await safeGet('task-due-times');
  try{ taskDueTimes = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {}; }catch(e){ taskDueTimes = {}; }
}
async function setTaskDueTime(id, hhmm){
  await loadTaskDueTimes();
  if(hhmm) taskDueTimes[id] = hhmm; else delete taskDueTimes[id];
  return safeSet('task-due-times', JSON.stringify(taskDueTimes));
}
function taskTimeOptions(){
  const out = [['', 'Any time']];
  for(let m = 7 * 60; m <= 21 * 60; m += 30){ const hh = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); out.push([hh, fmtTime(atTime(new Date(), hh))]); }
  return out;
}
function taskFormHtml(editing, presetAssigneeId, presetContext){
  const t = editing || null;
  const people = [...teamProfiles].filter(p => !p.access_revoked || (t && p.id === t.assigneeId)).sort((a, b) => a.name.localeCompare(b.name));
  const assignee = t ? t.assigneeId : (presetAssigneeId || currentUser.id);
  const aName = (people.find(p => p.id === assignee) || {}).name || '';
  const clientId = t ? (t.clientId || '') : (presetContext?.clientId || '');
  const due = t ? (t.dueDate || '') : (presetContext?.due || '');
  const time = t ? (taskDueTimes[t.id] || '') : '';
  const pri = t ? (t.priority || 'none') : (presetContext?.priority || 'medium');
  const notes = t ? (t.description || '') : (presetContext?.description || '');
  const link = t ? (t.link || '') : (presetContext?.link || '');
  // files: the task's own (when editing) and the ones picked here, uploaded when it's saved
  window._ntFiles = []; window._ntRemove = new Set(); window._ntExisting = t ? (t.attachments || []).slice() : [];
  const title = t ? t.title : (presetContext?.title || '');
  const priSeg = [['none', 'None'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']].map(([v, l]) => `<button type="button" class="${pri === v ? 'on' : ''}" role="radio" aria-checked="${pri === v}" data-v="${v}" onclick="ntPri(this)">${l}</button>`).join('');
  const noteMenu = !t ? `<span style="position:relative;margin-right:auto"><button type="button" class="btn" id="ntFillBtn" onclick="ntToggleNoteMenu()">${icon('sparkle')}Fill from a note</button><div class="menu" id="ntNoteMenu" hidden style="bottom:34px;left:0;width:300px;max-height:260px;overflow:auto"></div></span>` : '';
  return `<h3>${t ? 'Edit Task' : 'New Task'}</h3>
<div class="f">
<label for="taskTitleInput">Title</label><input id="taskTitleInput" class="tf" spellcheck="true" placeholder="What needs doing?" value="${escapeHtml(title)}">
<label for="taskClientSelect">Client</label><div>${sheetPop('taskClientSelect', 'Client', [['', 'No client'], ...liveClients().slice().sort((a, b) => a.name.localeCompare(b.name)).map(c => [c.id, c.name])], clientId)}</div>
<label for="taskAssigneeSelect">Assignee</label><div>${sheetPop('taskAssigneeSelect', 'Assignee', people.map(p => [p.id, p.name + (p.id === currentUser.id ? ' (you)' : '')]), assignee, 'ntAssigneeChanged(this)', { lead: aName ? avHtml(aName, 'id="ntAv"') : '' })}</div>
<label for="taskDueInput">Due</label><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap" id="ntDueRow">${sheetDateField('taskDueInput', due, { none: 'No date', from: 0, to: 20, min: toDateStr(new Date()), after: 'ntSyncDue', label: 'Due date' })}${sheetPop('taskTimeInput', 'Due time', taskTimeOptions(), time, '', { disabled: !due })}</div>
<label>Priority</label><div><div class="seg" role="radiogroup" aria-label="Priority" id="ntPriority">${priSeg}</div></div>
<label>Color</label><div>${colorSwatchesHtml('ntColor', t ? t.color : (presetContext?.color || null))}</div>
<label class="top" for="taskDescInput">Notes</label><textarea id="taskDescInput" class="tf" spellcheck="true" placeholder="Add details or a checklist">${escapeHtml(notes)}</textarea>
<label for="taskLinkInput">Link</label><input id="taskLinkInput" class="tf" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://… (a doc, a page, a design)" value="${escapeHtml(link)}">
<label class="top">Files</label><div class="nt-files" id="ntFiles" ondragenter="ntFilesDrag(event,true)" ondragover="ntFilesDrag(event,true)" ondragleave="ntFilesDrag(event,false)" ondrop="ntFilesDrop(event)">${ntFilesInner()}</div>
${t ? '' : `<span></span><div style="display:flex;align-items:center;gap:10px;font-size:14px" id="ntCalRow" class="${due ? '' : 'off'}">${sheetSw('ntCal', true, 'Add to my calendar')}Add to my calendar</div>`}
</div>
<div class="sheet-a">${noteMenu}<button class="btn" onclick="closeAppModal()">Cancel</button><button class="btn btn-p" onclick="${t ? `saveEditTask('${t.id}')` : 'saveNewTask()'}">${t ? 'Save' : 'Create Task'}</button></div>`;
}
// ---- Files on the New Task / Edit Task sheet (Nov 23) ----
// Picked or dropped here, shown as chips (a × takes one off), uploaded when the task is saved.
function ntFilesInner(){
  const kb = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  const chip = (name, size, rm, big) => `<span class="nt-file${big ? ' is-big' : ''}" title="${escapeHtml(name)}${big ? ' is over 10 MB, so it won’t be attached' : ''}">${icon(/\.(png|jpe?g|gif|webp|heic|svg)$/i.test(name) ? 'image' : 'file-text')}<span class="nm">${escapeHtml(name)}</span><span class="sz">${big ? 'over 10 MB' : kb(size || 0)}</span><button type="button" class="ib" aria-label="Remove ${escapeHtml(name)}" onclick="${rm}">${icon('x')}</button></span>`;
  const have = (window._ntExisting || []).filter(a => !(window._ntRemove || new Set()).has(a.path)).map(a => chip(a.name, a.size, `ntFileDrop('old',${jsArg(a.path)})`));
  const add = (window._ntFiles || []).map((f, i) => chip(f.name, f.size, `ntFileDrop('new',${i})`, f.size > TASK_FILE_MAX));
  return `${have.concat(add).join('')}<label class="btn sm nt-add">${icon('paperclip')}Add Files…<input type="file" multiple hidden onchange="ntFilesPicked(this.files);this.value=''"></label>${have.length || add.length ? '' : '<span class="nt-hint">or drop them here</span>'}`;
}
function ntFilesRedraw(){ const el = document.getElementById('ntFiles'); if(el) el.innerHTML = ntFilesInner(); }
function ntFilesPicked(list){ window._ntFiles = (window._ntFiles || []).concat([].slice.call(list || [])); ntFilesRedraw(); }
function ntFileDrop(kind, k){ if(kind === 'old') window._ntRemove.add(k); else window._ntFiles.splice(k, 1); ntFilesRedraw(); }
function ntFilesDrag(e, on){ if(!e.dataTransfer || ![].includes.call(e.dataTransfer.types || [], 'Files')) return; e.preventDefault(); e.currentTarget.classList.toggle('is-over', on); }
function ntFilesDrop(e){ if(!e.dataTransfer || !e.dataTransfer.files.length) return; e.preventDefault(); e.currentTarget.classList.remove('is-over'); ntFilesPicked(e.dataTransfer.files); }
function openNewTaskModal(presetAssigneeId, presetStatus, presetContext){
  if(!teamProfiles.length){ showToast('error', 'No team members', 'Add team members in Team before assigning tasks.'); return; }
  newTaskPresetStatus = presetStatus || 'todo';
  window._ntAfterCreate = presetContext?.afterCreate || null;   // e.g. a WhatsApp item links to the task it became
  openAppModal(taskFormHtml(null, presetAssigneeId, presetContext), 520);
  setTimeout(() => document.getElementById('taskTitleInput')?.focus(), 30);
}
function ntPri(b){ b.parentElement.querySelectorAll('button').forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', on); }); }
function ntPriority(){ return document.querySelector('#ntPriority button.on')?.dataset.v || 'none'; }
function ntAssigneeChanged(sel){
  const p = teamProfiles.find(x => x.id === sel.value), av = document.getElementById('ntAv');
  if(p && av) av.outerHTML = avHtml(p.name, 'id="ntAv"');
}
function ntSyncDue(v){
  const tm = document.getElementById('taskTimeInput');
  if(tm){ tm.disabled = !v; tm.parentElement.classList.toggle('off', !v); if(!v){ tm.value = ''; syncPopSel(tm); } }
  document.getElementById('ntCalRow')?.classList.toggle('off', !v);
}
function ntToggleNoteMenu(){
  const m = document.getElementById('ntNoteMenu'); if(!m) return;
  if(!m.hidden){ m.hidden = true; return; }
  const mine = (typeof notes !== 'undefined' ? notes : []).filter(n => !n.deletedAt && (n.text || n.title)).sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)).slice(0, 10);
  m.innerHTML = '<div class="mh">Pick a note</div>' + (mine.length ? mine.map(n => { const c = clients.find(x => x.id === n.clientId); return `<button type="button" class="mi" style="height:auto;padding:6px 9px;flex-direction:column;align-items:flex-start;gap:1px" onclick="ntFillFromNote('${n.id}')"><span style="font-weight:500">${escapeHtml(n.title || 'Untitled note')}</span><span class="t-2" style="font-size:12.5px">${escapeHtml(c ? c.name : (n.text || '').slice(0, 48))}</span></button>`; }).join('')
    : '<div class="mi" style="color:var(--label-2)">No notes yet</div>');
  m.hidden = false;
}
async function ntFillFromNote(noteId){
  const n = (typeof notes !== 'undefined' ? notes : []).find(x => x.id === noteId);
  const m = document.getElementById('ntNoteMenu'); if(m) m.hidden = true;
  if(!n) return;
  const btn = document.getElementById('ntFillBtn');
  if(btn){ btn.disabled = true; btn.innerHTML = `${icon('sparkle')}Filling…`; }
  let out = null;
  try{
    const prompt = `Turn this note into one task for a marketing agency team. Reply with JSON only, no other text: {"title": "...", "notes": "...", "due": "YYYY-MM-DD or empty"}.
- title: what needs doing, starting with a verb, under 70 characters
- notes: the useful details from the note in plain text, under 400 characters
- due: only if the note states a date; today is ${toDateStr(new Date())}

Note title: ${n.title || ''}
Note:
${String(n.text || '').slice(0, 4000)}`;
    const r = await fetch('/api/generate-draft', { method: 'POST', headers: await apiAuthHeaders(), body: JSON.stringify({ prompt, model: settings.openaiModel }) });
    const data = await r.json();
    const m2 = String(data.text || '').match(/\{[\s\S]*\}/);
    if(m2) out = JSON.parse(m2[0]);
  }catch(e){ console.error('Fill from a note failed', e); }
  const g = id => document.getElementById(id);
  const title = (out && out.title) || n.title || String(n.text || '').split('\n')[0].slice(0, 70);
  if(g('taskTitleInput')) g('taskTitleInput').value = title;
  if(g('taskDescInput') && !g('taskDescInput').value.trim()) g('taskDescInput').value = (out && out.notes) || String(n.text || '').slice(0, 600);
  if(n.clientId && g('taskClientSelect')){ g('taskClientSelect').value = n.clientId; syncPopSel(g('taskClientSelect')); }
  if(out && /^\d{4}-\d{2}-\d{2}$/.test(out.due || '') && out.due >= toDateStr(new Date())) sheetOtherDate('taskDueInput', out.due, 'ntSyncDue');
  if(btn){ btn.disabled = false; btn.innerHTML = `${icon('sparkle')}Fill from a note`; }
  if(!out) showToast('info', 'Filled from the note', 'The AI didn’t answer, so the note’s own title and text were used.');
}
function ntReadForm(){
  const g = id => document.getElementById(id);
  const title = g('taskTitleInput').value.trim();
  let dueDate = g('taskDueInput').value || null;
  const notesTxt = g('taskDescInput').value.trim();
  const linkTxt = (g('taskLinkInput')?.value || '').trim();
  const url = linkTxt || (!g('taskLinkInput') ? (notesTxt.match(/https?:\/\/[^\s<>"]+|www\.[^\s<>"]+/i) || [])[0] : '');
  return { title, assigneeId: g('taskAssigneeSelect').value, priority: ntPriority(), description: notesTxt, dueDate,
    dueTime: dueDate ? (g('taskTimeInput')?.value || '') : '', clientId: g('taskClientSelect').value || null, link: url ? normalizeUrl(url.replace(/[).,;]+$/, '')) : null,
    color: pickedItemColor('ntColor') };
}
// ---- Tasks suggested from meetings (Nov 23) -------------------------------------------------------
// Granola's meeting notes go through the AI on the server (lib/granola-tasks.js); each action item
// for someone on the team waits in task_suggestions until that person adds it (it becomes their own
// task, from them, with the meeting linked) or dismisses it. Shared by the desktop and the iPhone.
let taskSuggestions = null, taskSuggestionsAt = 0;   // my pending ones; null until loaded
function suggestionFromDb(r){
  return { id: r.id, title: r.title, description: r.description || '', clientId: r.client_id || '', dueDate: r.due_date || '', priority: r.priority || 'medium',
    sourceTitle: r.source_title || 'a meeting', sourceUrl: r.source_url || '', sourceAt: r.source_at || r.created_at, quote: r.quote || '', sourceId: r.source_id || '', assigneeId: r.assignee_id || null, status: r.status || 'pending' };
}
async function loadTaskSuggestions(){
  if(typeof currentUser === 'undefined' || !currentUser) return [];
  taskSuggestionsAt = Date.now();
  const { data, error } = await supabaseClient.from('task_suggestions').select('*').eq('assignee_id', currentUser.id).eq('status', 'pending')
    .order('source_at', { ascending: false }).limit(60);
  taskSuggestions = error ? [] : (data || []).map(suggestionFromDb);   // no table yet (addendum-granola.sql): none
  return taskSuggestions;
}
// A suggestion that's already one of that person's tasks (added from the meeting's notes, or given to
// them by an admin or approver): it isn't shown, and it's settled so it doesn't come back.
function suggestionTaken(s){
  if(typeof tasks === 'undefined' || !tasks || !s || !s.sourceUrl) return null;
  return tasks.find(t => t.assigneeId === s.assigneeId && !t.cancelledAt && t.link === s.sourceUrl
    && (mtSame(s.title, t.title) || (s.quote && mtPointOf(t) && mtQuoteIn(s.quote, mtPointOf(t))))) || null;
}
const sgSettling = new Set();
function suggestionsOpen(list){
  return (list || []).filter(s => {
    const t = suggestionTaken(s); if(!t) return true;
    if(!sgSettling.has(s.id)){ sgSettling.add(s.id); decideSuggestion(s.id, 'added', t.id); }
    return false;
  });
}
// "Oakridge weekly · Mon, Nov 23 · Oakridge Flooring · due Fri, Nov 27"
function suggestionSub(s){
  const c = s.clientId ? clients.find(x => x.id === s.clientId) : null, when = s.sourceAt ? new Date(s.sourceAt) : null;
  const due = s.dueDate ? new Date(s.dueDate + 'T12:00:00') : null;
  return [s.sourceTitle, when ? `${fmtDay(when)}, ${fmtShortDate(when)}` : '', c ? c.name : '', due ? `due ${fmtDay(due)}, ${fmtShortDate(due)}` : ''].filter(Boolean);
}
function suggestionNotes(s){
  const when = s.sourceAt ? new Date(s.sourceAt) : null;
  return [s.description, `From the meeting “${s.sourceTitle}”${when ? `, ${fmtShortDate(when)}` : ''}${s.sourceUrl ? `: ${s.sourceUrl}` : ''}`].filter(Boolean).join('\n\n');
}
async function decideSuggestion(id, status, taskId){
  const { error } = await supabaseClient.from('task_suggestions').update({ status, task_id: taskId || null, decided_at: status === 'pending' ? null : new Date().toISOString() }).eq('id', id);
  if(!error && taskSuggestions) taskSuggestions = status === 'pending' ? taskSuggestions : taskSuggestions.filter(x => x.id !== id);
  return !error;
}
// Add as it is: the task is yours, from you, with the meeting's notes as its link.
async function addSuggestedTask(id){
  const s = (taskSuggestions || []).find(x => x.id === id); if(!s) return { error: { message: 'Already decided.' } };
  const res = await insertTaskRow({ title: s.title, description: suggestionNotes(s), priority: s.priority || 'medium', status: 'todo', assigner_id: currentUser.id, assignee_id: currentUser.id,
    due_date: s.dueDate || null, client_id: s.clientId || null, link: s.sourceUrl || null });
  if(res.error || !res.data) return { error: res.error || { message: 'Not saved' } };
  await decideSuggestion(id, 'added', res.data.id);
  return { task: res.data };
}
// The New Task sheet's preset for "Edit…": change anything, and saving adds it.
function suggestionPreset(s){
  return { title: s.title, description: suggestionNotes(s), clientId: s.clientId || '', due: s.dueDate || '', priority: s.priority || 'medium', link: s.sourceUrl || '',
    afterCreate: task => decideSuggestion(s.id, 'added', task && task.id) };
}

// ---- Check Granola (Tasks, desktop and iPhone) ---------------------------------------------------
// Meetings come in by themselves (a webhook, and a daily read); this asks for a read now. Anyone on
// the team can; the server skips it when Granola was read in the last minute.
// Is Granola connected? Remembered on this device so the button is there at once, and asked again at
// most once a minute. Only a clear answer from Radar changes it: a failed ask (offline, still signing
// in, a slow server) keeps what was known and asks again soon, backing off: 15s, 30s, 1m, 2m, 4m.
let granolaOn = (() => { try{ const v = localStorage.getItem('radar-granola-on'); return v === '1' ? true : v === '0' ? false : null; }catch(e){ return null; } })();
let granolaAskedAt = 0, granolaAsking = null, granolaMisses = 0, granolaRetry = null;
function granolaSet(on){ granolaOn = !!on; granolaMisses = 0; granolaAskedAt = Date.now(); try{ localStorage.setItem('radar-granola-on', on ? '1' : '0'); }catch(e){} }
const granolaWait = () => granolaMisses ? Math.min(15000 * 2 ** (granolaMisses - 1), 240000) : 60000;
async function granolaApi(action, body){
  const { data: { session } } = await supabaseClient.auth.getSession();
  if(!session) throw new Error('Not signed in yet.');
  const r = await fetch(action ? '/api/integrations' : '/api/integrations?provider=granola', {
    method: action ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: action ? JSON.stringify({ provider: 'granola', action, ...(body || {}) }) : undefined,
  });
  let data = {}; try{ data = await r.json(); }catch(e){}
  if(!r.ok) throw new Error(data.error || 'Something went wrong talking to Granola.');
  return data;
}
function granolaKnown(){
  if(granolaAsking) return granolaAsking;
  if(Date.now() - granolaAskedAt < granolaWait()) return Promise.resolve(granolaOn);
  granolaAskedAt = Date.now();
  granolaAsking = granolaApi(null)
    .then(s => { if(s && !s.error){ granolaSet(s.connected); return true; } return false; }, () => false)
    .then(heard => { granolaAsking = null; if(!heard) granolaMisses++; return granolaOn; });
  return granolaAsking;
}
// Asks (when due) and draws again only if the answer changes whether the button shows. If Radar
// didn't answer, it asks again by itself a few times, so the button comes back without a reload.
function granolaWatch(redraw){
  const was = !!granolaOn;
  granolaKnown().then(on => {
    if(!!on !== was){ redraw(); return; }
    if(granolaMisses && granolaMisses <= 5 && !granolaRetry) granolaRetry = setTimeout(() => { granolaRetry = null; granolaWatch(redraw); }, granolaWait() + 50);
  });
}
// ---- Granola by itself (Nov 23) -----------------------------------------------------------------
// Nobody has to press anything: a little after Radar opens, and every 15 minutes while it's open and
// in view, it asks for a read (the server reads at most once a minute for the whole team, and only
// meetings it hasn't read). New suggestions and meetings then show where you are. Granola's webhook
// brings each meeting in as soon as its notes are ready; this is the net under it.
let granolaAutoT = null, granolaAutoFirst = null;
async function granolaAutoTick(){
  if(document.visibilityState !== 'visible') return;
  if(!(await granolaKnown())) return;
  granolaCountNew().catch(() => {});   // meetings the webhook brought in count too
  let r = null; try{ r = await granolaApi('check'); }catch(e){ return; }
  if(!r || r.recent || r.skipped) return;
  granolaCountNew().catch(() => {});
  if(typeof tkSgRefresh === 'function') tkSgRefresh(); else { try{ await loadTaskSuggestions(); }catch(e){} }
  if(granolaMeetings !== null){ try{ await loadGranolaMeetings(); }catch(e){} }
  if(typeof currentViewName !== 'undefined' && currentViewName === 'notes' && typeof renderNotes === 'function') renderNotes();
  if(typeof mRenderTab === 'function'){ if(typeof mTab !== 'undefined' && mTab === 'tasks') mRenderTab(); if(typeof mTop === 'function') mTop()?.refresh(); }
}
function granolaAutoStart(){
  if(granolaAutoT) return;
  granolaAutoT = setInterval(granolaAutoTick, 15 * 60000);
  granolaAutoFirst = setTimeout(granolaAutoTick, 20000);
  setTimeout(() => granolaCountNew().catch(() => {}), 3000);   // the count on Notes, from the start
  // back to Radar after a while away: catch up then, not up to 15 minutes later
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'hidden'){ hiddenAt = Date.now(); return; }
    if(hiddenAt && Date.now() - hiddenAt > 10 * 60000) granolaAutoTick();
  });
}
// What a check found, in words for a toast: { type, title, text, mine }.
async function checkGranolaNow(){
  const before = new Set((taskSuggestions || []).map(s => s.id));
  let r;
  try{ r = await granolaApi('check'); }catch(e){ return { type: 'error', title: 'Couldn’t check Granola', text: e.message }; }
  try{ await loadTaskSuggestions(); }catch(e){}
  const mine = (taskSuggestions || []).filter(s => !before.has(s.id)).length;
  if(r.error) return { type: 'error', title: 'Granola didn’t answer', text: r.error, mine };
  if(r.skipped === 'not connected'){ granolaSet(false); return { type: 'info', title: 'Granola isn’t connected', text: 'An admin connects it in Settings → Connections.', mine }; }
  // meetings Granola is still writing, and ones there wasn't time for: they come in by themselves
  const n = (k, one, many) => k === 1 ? one : many;
  const later = [r.waiting ? `${r.waiting} ${n(r.waiting, 'meeting is', 'meetings are')} still being written in Granola; Radar reads ${n(r.waiting, 'it', 'them')} once ${n(r.waiting, 'it’s', 'they’re')} done.` : '',
    r.left ? `${r.left} more to read: check again in a minute.` : ''].filter(Boolean).join(' ');
  const plus = t => later ? `${t} ${later}` : t;
  if(mine) return { type: 'success', title: `${mine} new task${mine === 1 ? '' : 's'} from your meetings`, text: plus('Add the ones that are yours to do.'), mine };
  if(r.recent) return { type: 'info', title: 'Granola was just checked', text: 'Nothing new for you. New meetings also come in by themselves.', mine };
  if(r.read) return { type: 'info', title: `Read ${r.read} meeting${r.read === 1 ? '' : 's'}`, text: plus('Nothing in them for you.'), mine };
  if(later) return { type: 'info', title: 'Nothing new for you yet', text: later, mine };
  return { type: 'info', title: 'No new meetings', text: 'Radar reads meetings shared to Granola’s team space; private notes stay private.', mine };
}

// ---- A suggested task, previewed (Nov 23) ------------------------------------------------------
// One line isn't enough to decide: the preview has what it's about, the line it came from, and the
// part of the meeting's notes around it (the points that share the most words with the task).
const SG_SKIP = new Set(['the', 'and', 'for', 'with', 'from', 'about', 'into', 'their', 'this', 'that', 'once', 'will', 'to', 'of', 'on', 'in', 'a', 'an', 'is', 'be']);
function sgWords(t){ return String(t || '').toLowerCase().replace(/\*\*/g, '').replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length > 2 && !SG_SKIP.has(w)); }
function suggestionMeeting(s){ return s && s.sourceId ? (granolaMeetings || []).find(m => m.id === s.sourceId) || null : null; }
// Markdown of the best one or two points (with what's nested under them, under their heading), or ''.
function suggestionExcerpt(s){
  const m = suggestionMeeting(s); if(!m || !m.summary) return '';
  const blocks = []; let head = '', cur = null;
  m.summary.replace(/\r/g, '').split('\n').forEach(l => {
    const h = l.match(/^#{1,4}\s+(.*)$/);
    if(h){ head = h[1].trim(); cur = null; return; }
    if(/^[-*]\s+/.test(l)){ cur = { head, lines: [l] }; blocks.push(cur); return; }
    if(cur && l.trim()) cur.lines.push(l);
  });
  const want = new Set(sgWords(`${s.title} ${s.quote} ${s.description}`));
  const scored = blocks.map((b, i) => { const w = new Set(sgWords(b.lines.join(' '))); let n = 0; want.forEach(x => { if(w.has(x)) n++; }); return { b, i, n }; })
    .filter(x => x.n >= 2).sort((a, b) => b.n - a.n);
  // the best point, and a second only when it's nearly as close (not one that shares a name)
  const keep = scored.filter((x, k) => k === 0 || (k === 1 && x.n >= scored[0].n * 0.6)).sort((a, b) => a.i - b.i);
  let last = null;
  return keep.map(({ b }) => { const out = (b.head && b.head !== last ? `### ${b.head}\n` : '') + b.lines.join('\n'); last = b.head; return out; }).join('\n');
}
// The preview's body (shared by the desktop sheet and the iPhone sheet).
function suggestionPreviewHtml(s){
  const sub = suggestionSub(s), meet = s.sourceUrl ? `<a href="${safeUrl(s.sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(sub[0])}</a>` : escapeHtml(sub[0]);
  const ex = suggestionExcerpt(s);
  const loading = granolaMeetings === null && s.sourceId;
  return `<p class="sgp-meta">${appLogo('granola', 'xs')}<span>${meet}${sub.slice(1).map(x => ' · ' + escapeHtml(x)).join('')}</span></p>
${s.description ? `<div class="sgp-sec"><span class="sgp-k">What it’s about</span><p class="sgp-d">${escapeHtml(s.description)}</p></div>` : ''}
${s.quote ? `<div class="sgp-sec"><span class="sgp-k">What was said</span><blockquote class="sgp-q">${escapeHtml(s.quote)}</blockquote></div>` : ''}
${ex ? `<div class="sgp-sec"><span class="sgp-k">In the meeting notes</span><div class="sgp-ex mtn-body">${meetingNotesHtml(ex)}</div></div>`
  : loading ? `<div class="sgp-sec"><span class="sgp-k">In the meeting notes</span><p class="sgp-d t-3">Loading…</p></div>` : ''}
${s.sourceUrl ? `<p class="sgp-open"><a class="x-lnk" href="${safeUrl(s.sourceUrl)}" target="_blank" rel="noopener">Open the full notes in Granola</a></p>` : ''}`;
}

// ---- Granola meetings in Notes (Nov 23) ----------------------------------------------------------
// The meetings Radar read from Granola's team space, with their notes, read only: kept by the server
// with what it read (app_storage, granola-note:<id>), the way everyone on the team sees them in
// Granola. Another recording of a meeting already there isn't listed twice.
let granolaMeetings = null;   // null until loaded
async function loadGranolaMeetings(){
  const { data, error } = await supabaseClient.from('app_storage').select('key, value, updated_at').like('key', 'granola-note:%').order('updated_at', { ascending: false }).limit(120);
  if(error){ granolaMeetings = granolaMeetings || []; return granolaMeetings; }
  const since = Date.now() - 90 * 864e5;
  granolaMeetings = (data || []).map(r => {
    let m = {}; try{ m = JSON.parse(r.value) || {}; }catch(e){}
    return { id: r.key.slice('granola-note:'.length), title: m.title || 'A meeting', summary: m.summary || '', url: m.url || null, at: m.meetingAt || m.at || r.updated_at,
      clientId: m.clientId || null, people: m.people || [], owner: m.owner || null, items: m.items || 0, state: m.state, pulled: m.pulled || null,
      minutes: m.minutes || null, metClientId: m.metClientId || null, followUps: m.followUps || [] };
  }).filter(m => m.summary && m.state !== 'same' && m.state !== 'removed' && new Date(m.at).getTime() > since && meetingCanSee(m))   // the people who were there; admins and approvers see all
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return granolaMeetings;
}
// Opening Meetings reads Granola too, so it never waits on Tasks' Check Granola: what's there shows at
// once, and new meetings join it when the read is done (the server reads at most once a minute for
// the whole team; this asks at most every two minutes).
let granolaMtCheckedAt = 0, granolaMtChecking = false;
function meetingsRefresh(redraw){
  if(granolaMeetings === null) loadGranolaMeetings().then(redraw);
  if(granolaMtChecking || Date.now() - granolaMtCheckedAt < 120000) return;
  granolaMtCheckedAt = Date.now(); granolaMtChecking = true;
  granolaApi('check').catch(() => null).then(async () => {
    granolaMtChecking = false;
    await loadGranolaMeetings();
    try{ await loadTaskSuggestions(); }catch(e){}
    granolaCountNew().catch(() => {});
    redraw();
  });
}
function meetingWasMine(m){
  const e = String((typeof myProfile !== 'undefined' && myProfile && myProfile.email) || (typeof currentUser !== 'undefined' && currentUser && currentUser.email) || '').toLowerCase();
  return !!e && (m.people || []).includes(e);
}
// Granola's notes are Markdown: headings, bullets (nested by indent), **bold** and links.
// opts.point(i, text): what point i shows on its right (see "From the notes to tasks")
function meetingNotesHtml(md, opts){
  const inline = t => escapeHtml(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const out = [], open = [], side = opts && opts.point;
  let n = 0;
  const close = to => { while(open.length > to){ out.push('</ul>'); open.pop(); } };
  String(md || '').replace(/\r/g, '').split('\n').forEach(line => {
    const li = line.match(/^(\s*)[-*]\s+(.*)$/);
    if(li){ const depth = Math.floor(li[1].replace(/\t/g, '  ').length / 2) + 1; close(depth); while(open.length < depth){ out.push('<ul>'); open.push(1); } const i = n++; out.push(side ? `<li data-pt="${i}"><div class="mtp"><span class="mtp-x">${inline(li[2])}</span><span class="mtp-r">${side(i, mdPlain(li[2]))}</span></div></li>` : `<li>${inline(li[2])}</li>`); return; }
    close(0);
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if(h){ out.push(`<h4>${inline(h[2])}</h4>`); return; }
    if(line.trim()) out.push(`<p>${inline(line.trim())}</p>`);
  });
  close(0);
  return out.join('');
}
// The first few points, as plain lines, for a tile or a row.
function meetingPreview(md, n){
  return String(md || '').split('\n').map(l => l.trim()).filter(l => /^[-*]\s+/.test(l)).slice(0, n || 3)
    .map(l => l.replace(/^[-*]\s+/, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'));
}
function meetingWhenWords(m){ const d = new Date(m.at); return isNaN(d) ? '' : `${relDay(d)} at ${fmtTime(d)}`; }
function meetingSubWords(m){
  const c = m.clientId ? clients.find(x => String(x.id) === String(m.clientId)) : null;
  return [meetingWhenWords(m), c ? c.name : '', m.owner ? `notes by ${String(m.owner).split(' ')[0]}` : ''].filter(Boolean);
}
// ---- A meeting's sheet (Nov 23) -------------------------------------------------------------------
// The notes, with the way back to Granola (desktop: a sheet; iPhone: its sheet). Any point can become a
// task; the AI button pulls the tasks out of the notes, grouped, so nobody has to read the whole thing;
// Remove from Radar takes the meeting out for everyone, for good (Restore brings it back).
let meetingView = {};    // meeting id → 'notes' | 'tasks'
let meetingPulls = {};   // meeting id → { groups, at } | { loading: true } | { error }
function openMeetingNotes(id){
  const m = (granolaMeetings || []).find(x => x.id === id); if(!m) return;
  if(m.pulled && m.pulled.groups && !meetingPulls[m.id]) meetingPulls[m.id] = { groups: m.pulled.groups, at: m.pulled.at };
  const sub = meetingSubWords(m).join(' · ');
  if(typeof mOpenSheet === 'function'){
    mOpenSheet(m.title, `<div class="mtn"><p class="mtn-sub">${escapeHtml(sub)}</p><div id="mtnTop">${meetingTopHtml(m)}</div><div class="mtn-body" id="mtnBody" data-mt="${m.id}">${meetingMainHtml(m)}</div><div class="mtn-acts">${meetingTimeHtml(m, true)}${m.url ? `<a class="ibtn mtn-open" href="${safeUrl(m.url)}" target="_blank" rel="noopener">Open in Granola</a>` : ''}</div><button type="button" class="mtn-rm" onclick="meetingRemove('${m.id}')">Remove from Radar</button></div>`, { cancel: 'Close' });
  } else {
    openAppModal(`<h3 class="ap-h">${appLogo('granola', 'sm')}${escapeHtml(m.title)}</h3><p class="t-2 mtn-sub">${escapeHtml(sub)}</p><div id="mtnTop">${meetingTopHtml(m)}</div>
<div class="mtn-body" id="mtnBody" data-mt="${m.id}">${meetingMainHtml(m)}</div>
<div class="sheet-a"><button type="button" class="btn mtn-rm" onclick="meetingRemove('${m.id}')">Remove from Radar</button><span class="sgp-gap"></span>${meetingTimeHtml(m)}${m.url ? `<a class="btn" href="${safeUrl(m.url)}" target="_blank" rel="noopener">Open in Granola</a>` : ''}<button class="btn btn-p" id="mtnDone" onclick="closeAppModal()">Done</button></div>`, 680);
    // focus starts on Done, not on the first link inside the notes
    setTimeout(() => document.getElementById('mtnDone')?.focus({ preventScroll: true }), 30);   // after the sheet's own first focus
  }
  // who each point is already suggested to
  loadMeetingSuggestions(m).then(() => meetingRedraw(m)).catch(() => {});
}
function meetingTopHtml(m){
  const v = meetingView[m.id] || 'notes', can = meetingCanAssign(), mine = meetingWasMine(m);
  const words = v === 'tasks' ? (can ? 'Everyone’s tasks in this meeting, pulled out by AI and grouped.' : 'Your tasks in this meeting, pulled out by AI and grouped.')
    : v === 'recap' ? 'A recap for the client, drafted by AI from the notes.'
    : can ? 'Any point can be a task for someone on the team.' : mine ? 'Any point can be one of your tasks.' : '';
  const btn = (cls, ic, label, js) => `<button type="button" class="btn sm mtn-ai${cls}" onclick="${js}">${icon(ic)}<span>${label}</span></button>`;
  const acts = v !== 'notes' ? btn('', 'file-pdf', 'Show the Notes', `meetingShowNotes('${m.id}')`)
    : btn(' is-ai', 'sparkle', can ? 'Pull the Tasks' : 'Pull My Tasks', `meetingToggleView('${m.id}')`) + (meetingWithClient(m) ? btn(' is-ai', 'envelope-simple', 'Draft a Recap', `meetingRecap('${m.id}')`) : '');
  return `<div class="mtn-bar"><p class="mtn-tasks">${v !== 'notes' ? icon('sparkle') : appLogo('granola', 'xs')}<span>${words}</span></p><div class="mtn-btns">${acts}</div></div>`;
}
function meetingShowNotes(id){ const m = (granolaMeetings || []).find(x => x.id === id); if(!m) return; meetingView[id] = 'notes'; meetingRedraw(m); }
function meetingMainHtml(m){ const v = meetingView[m.id]; return v === 'tasks' ? meetingTasksHtml(m) : v === 'recap' ? meetingRecapHtml(m) : meetingFollowUpsHtml(m) + meetingBodyHtml(m); }
function meetingBodyHtml(m){
  return meetingNotesHtml(m.summary, { point: (i, text) => text ? mtSideHtml(m, mtSpec(m, 'p' + i)) : '' });
}
// Draws the sheet again, if it's still this meeting's
function meetingRedraw(m){
  const b = document.getElementById('mtnBody'); if(!b || b.dataset.mt !== m.id) return;
  const t = document.getElementById('mtnTop'); if(t) t.innerHTML = meetingTopHtml(m);
  b.innerHTML = meetingMainHtml(m);
}
// The AI button: pulls the tasks (once; the answer is kept until the notes change), and back to the notes
async function meetingToggleView(id, again){
  const m = (granolaMeetings || []).find(x => x.id === id); if(!m) return;
  if(!again && meetingView[id] === 'tasks'){ meetingView[id] = 'notes'; meetingRedraw(m); return; }   // (the bar's Show the Notes)
  meetingView[id] = 'tasks';
  const have = meetingPulls[id];
  if(!again && have && (have.groups || have.loading)){ meetingRedraw(m); return; }
  meetingPulls[id] = { loading: true }; meetingRedraw(m);
  try{
    const r = await granolaApi('meeting-tasks', { note: id, again: !!again });
    meetingPulls[id] = { groups: r.groups || [], at: r.at };
    m.pulled = { groups: r.groups || [], at: r.at };
  }catch(e){ meetingPulls[id] = { error: e.message || 'The AI didn’t answer. Try again in a moment.' }; }
  meetingRedraw(m);
}
// The pulled tasks this person sees (everyone's for admins and approvers; theirs for anyone else)
function meetingItems(m){
  const p = meetingPulls[m.id]; if(!p || !p.groups) return [];
  const can = meetingCanAssign();
  return p.groups.map((g, gi) => ({ label: g.label, clientId: g.clientId || null,
    items: g.items.map((it, ii) => ({ ...it, key: `a${gi}.${ii}` })).filter(it => can || it.whoId === currentUser.id) })).filter(g => g.items.length);
}
function meetingTasksHtml(m){
  const p = meetingPulls[m.id], can = meetingCanAssign();
  if(!p || p.loading) return `<div class="mtk-load" aria-live="polite"><p>${icon('sparkle')}Reading the notes…</p><i></i><i></i><i></i></div>`;
  if(p.error) return `<div class="mtk-empty"><p>${escapeHtml(p.error)}</p><button type="button" class="btn sm" onclick="meetingToggleView('${m.id}', true)">Try Again</button></div>`;
  const groups = meetingItems(m), shown = groups.reduce((n, g) => n + g.items.length, 0);
  const others = (p.groups || []).reduce((n, g) => n + g.items.length, 0) - shown;
  const again = `<button type="button" class="x-lnk" onclick="meetingToggleView('${m.id}', true)">Pull Again</button>`;
  if(!shown) return `<div class="mtk-empty"><p>${can ? 'No tasks for the team in these notes.' : 'Nothing in these notes is for you.'}${others ? ` ${others === 1 ? 'One is' : `${others} are`} for others in the meeting.` : ''}</p>${again}</div>`;
  const open = groups.flatMap(g => g.items).map(it => mtSpec(m, it.key)).filter(sp => sp && !mtSpecTasks(m, sp).length && (can ? sp.whoId : true));
  const all = open.length >= 2 ? `<button type="button" class="btn sm mtk-all" onclick="meetingAll('${m.id}', this)">${can ? `Assign All ${open.length}` : `Add All ${open.length}`}</button>` : '';
  const today = toDateStr(new Date());
  const row = it => {
    const sp = mtSpec(m, it.key);
    const due = it.due && it.due >= today ? `due ${fmtDay(new Date(it.due + 'T12:00:00'))}, ${fmtShortDate(new Date(it.due + 'T12:00:00'))}` : '';
    const meta = [can ? (it.whoId ? `for ${mtName(it.whoId)}` : 'nobody named') : '', due, it.why || ''].filter(Boolean);
    return `<div class="mtk-r" data-k="${it.key}"><div class="mtk-x"><b>${escapeHtml(it.title)}</b>${meta.length ? `<span>${escapeHtml(meta.join(' · '))}</span>` : ''}</div><div class="mtp-r">${mtSideHtml(m, sp)}</div></div>`;
  };
  return `<div class="mtk-h"><span>${shown} task${shown === 1 ? '' : 's'}${can ? '' : ' for you'} · ${groups.length} group${groups.length === 1 ? '' : 's'}</span>${all}</div>`
    + groups.map(g => `<section class="mtk-g"><h4>${escapeHtml(g.label)}<span class="n">${g.items.length}</span></h4>${g.items.map(row).join('')}</section>`).join('')
    + `<p class="mtk-foot">${icon('sparkle')}<span>Pulled from the notes by AI${!can && others ? ` · ${others} more for others in the meeting` : ''} · ${again}</span></p>`;
}

// ---- From the notes to tasks (Nov 23) ------------------------------------------------------------
// A point in the notes, or a task the AI pulled out, can become a task. Someone who was there adds it
// to their own tasks; admins and approvers give it to anyone (to start with, the person it names). One
// that is already a task says who has it and who added it, so nobody adds it twice, and the matching
// suggestion in that person's Tasks goes away.
function meetingCanAssign(){ return typeof canApprove === 'function' && canApprove(); }
function meetingCanSee(m){ return meetingCanAssign() || meetingWasMine(m); }
function mdPlain(t){ return String(t || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim(); }
// The points, in the order the notes show them (the same count as the bullets meetingNotesHtml draws)
function meetingPoints(m){
  const out = [];
  String((m && m.summary) || '').replace(/\r/g, '').split('\n').forEach(l => { const li = l.match(/^\s*[-*]\s+(.*)$/); if(li) out.push(mdPlain(li[1])); });
  return out;
}
const mtFirst = p => String(p.name || '').split(' ')[0];
const mtWord = n => new RegExp(`(^|[^A-Za-z])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z])`);
// Who the point is for: "(Charlie)" at the end, "Charlie to…" at the start, or the one teammate it names
function meetingPointWho(text){
  const team = (teamProfiles || []).filter(p => !p.access_revoked && mtFirst(p).length > 1);
  const paren = text.match(/\(([^)]*)\)\s*$/);
  if(paren){ const p = team.find(p => mtWord(mtFirst(p)).test(paren[1])); if(p) return p; }
  const lead = text.match(/^([A-Z][A-Za-z]+)\s+(?:to|will|should|needs to|can|is going to)\s/);
  if(lead){ const p = team.find(p => mtFirst(p) === lead[1]); if(p) return p; }
  const named = team.filter(p => mtWord(mtFirst(p)).test(text));
  return named.length === 1 ? named[0] : null;
}
// The point as a task's title: no names in brackets at the end, no "Charlie to" in front, no "see the doc"
function meetingPointTitle(text){
  const names = (teamProfiles || []).map(mtFirst).filter(Boolean);
  let t = String(text || '').replace(/\s+[—–-]\s+see\b.*$/i, '');
  const paren = t.match(/\s*\(([^)]*)\)\s*$/);
  if(paren && paren[1].split(/,|&|\band\b/).every(w => !w.trim() || names.includes(w.trim()) || /^(?:all|team|everyone)$/i.test(w.trim()))) t = t.slice(0, paren.index);
  const lead = t.match(/^([A-Z][A-Za-z]+)\s+(?:to|will|should|needs to|is going to)\s+(.*)$/);
  if(lead && names.includes(lead[1])) t = lead[2].charAt(0).toUpperCase() + lead[2].slice(1);
  t = t.replace(/[.;:]\s*$/, '').trim();
  return t.length > 120 ? t.slice(0, 117).trimEnd() + '…' : t;
}
function meetingPointNotes(m, text){
  const d = new Date(m.at);
  return `From the meeting “${m.title}”${isNaN(d) ? '' : `, ${fmtShortDate(d)}`}${m.url ? `: ${m.url}` : ''}\n\nIn the notes: “${text}”`;
}
// The same work in other words: most of the words shared ("Send the report" isn't "Send the invoice")
function mtSame(a, b){
  const A = new Set(sgWords(a)), B = new Set(sgWords(b));
  let n = 0; A.forEach(w => { if(B.has(w)) n++; });
  return n >= 2 && n / (A.size + B.size - n) >= 0.6;
}
// A line someone said, found in a point: nearly all its words are there
function mtQuoteIn(q, text){
  const Q = [...new Set(sgWords(q))], T = new Set(sgWords(text));
  return Q.length >= 2 && Q.filter(w => T.has(w)).length >= Q.length * 0.8;
}
const mtPointOf = t => { const x = String((t && t.description) || '').match(/In the notes: “([^”]*)”/); return x ? x[1] : ''; };
// What can become a task: 'p3' (the 4th point in the notes) or 'a0.1' (the AI's 1st group, 2nd task).
// A pulled task is tied to the point it came from, so a task made from either shows on both.
function mtSpec(m, key){
  if(!m || !key) return null;
  if(key[0] === 'p'){
    const text = meetingPoints(m)[+key.slice(1)]; if(!text) return null;
    const who = meetingPointWho(text);
    return { key, text, title: meetingPointTitle(text), whoId: who ? who.id : null, due: '', why: '', clientId: m.clientId || null };
  }
  const [gi, ii] = key.slice(1).split('.').map(Number);
  const g = ((meetingPulls[m.id] || {}).groups || [])[gi], it = g && g.items[ii]; if(!it) return null;
  return { key, text: mtMatchPoint(m, it) || mdPlain(it.point) || it.title, title: it.title, whoId: it.whoId || null, due: it.due || '', why: it.why || '',
    clientId: g.clientId || m.clientId || null };
}
function mtMatchPoint(m, it){
  const pts = meetingPoints(m), q = mdPlain(it.point || '');
  return (q && pts.find(t => t === q)) || (q && pts.find(t => mtQuoteIn(q, t) && mtQuoteIn(t, q))) || pts.find(t => mtSame(it.title, meetingPointTitle(t))) || null;
}
// The tasks it already became: made from it here, or the same work added from the meeting's
// suggestion (same meeting link, nearly the same title)
function mtSpecTasks(m, sp){
  const quote = `In the notes: “${sp.text}”`;
  return (tasks || []).filter(t => !t.cancelledAt && (
    (t.description || '').includes(quote) && (!m.url || t.link === m.url || (t.description || '').includes(m.url))
    || (m.url && t.link === m.url && mtSame(sp.title, t.title))));
}
// A meeting's suggestions (each person's own; admins and approvers see everyone's)
let meetingSgs = {};
async function loadMeetingSuggestions(m){
  const { data, error } = await supabaseClient.from('task_suggestions').select('*').eq('source_id', m.id).limit(80);
  meetingSgs[m.id] = error ? [] : (data || []).map(suggestionFromDb);
  return meetingSgs[m.id];
}
function mtSpecSuggestions(m, sp){
  return (meetingSgs[m.id] || []).filter(s => s.status === 'pending' && (meetingCanAssign() || s.assigneeId === currentUser.id)
    && (mtSame(sp.title, s.title) || (s.quote && mtQuoteIn(s.quote, sp.text))));
}
const mtName = id => { const p = teamProfiles.find(x => x.id === id); return p ? (id === currentUser.id ? 'you' : mtFirst(p)) : 'someone'; };
function mtList(names){ const u = [...new Set(names)]; return u.length < 3 ? u.join(' and ') : `${u.slice(0, -1).join(', ')} and ${u[u.length - 1]}`; }
// What it shows on its right: who has it, else the way to add it
function mtSideHtml(m, sp){
  if(!sp) return '';
  const done = mtSpecTasks(m, sp);
  if(done.length){
    const t = done[0], by = done.filter(x => x.assignerId && x.assignerId !== x.assigneeId).map(x => mtName(x.assignerId));
    const mine = done.some(x => x.assigneeId === currentUser.id);
    const who = mine && done.length === 1 ? `In your tasks${by.length ? `, from ${mtList(by)}` : ''}` : `Added for ${mtList(done.map(x => mtName(x.assigneeId)))}${by.length ? ` by ${mtList(by)}` : ''}`;
    return `<button type="button" class="mtp-ok" onclick="meetingOpenTask('${t.id}')" title="Open the task">${icon('check', { weight: 'bold' })}<span>${escapeHtml(who)}</span></button>`;
  }
  const sg = mtSpecSuggestions(m, sp);
  const note = sg.length ? `<span class="mtp-sg" title="Suggested from the notes; it’s waiting in their Tasks">Suggested to ${escapeHtml(mtList(sg.map(s => mtName(s.assigneeId))))}</span>` : '';
  // (iPhone shows the + alone, as a round button)
  if(meetingCanAssign()) return `${note}<button type="button" class="btn sm mtp-go" aria-label="Assign “${escapeHtml(sp.title)}”" onclick="meetingAssign('${m.id}', '${sp.key}')">${icon('plus', { weight: 'bold' })}<span>Assign…</span></button>`;
  if(meetingWasMine(m)) return `${note}<button type="button" class="btn sm mtp-go" aria-label="Add “${escapeHtml(sp.title)}” to my tasks" onclick="meetingAdd('${m.id}', '${sp.key}', this)">${icon('plus', { weight: 'bold' })}<span>Add to My Tasks</span></button>`;
  return note;
}
// A task just made, known here before the next load of everyone's tasks
function mtKnow(t){
  if(typeof tasks === 'undefined' || !tasks || !t || tasks.some(x => x.id === t.id)) return;
  tasks.unshift({ id: t.id, title: t.title, description: t.description || '', link: t.link || null, assigneeId: t.assignee_id, assignerId: t.assigner_id,
    clientId: t.client_id || null, status: t.status || 'todo', priority: t.priority, dueDate: t.due_date || null, createdAt: t.created_at, attachments: [] });
}
function meetingOpenTask(id){
  if(typeof mOpenTask === 'function'){ mCloseSheet(true); setTimeout(() => mOpenTask(id), 320); return; }
  closeAppModal(); openTaskDetailModal(id);
}
// The pending suggestions this task stands for: settled, so they leave that person's Tasks
async function meetingSettle(m, sp, task){
  const sgs = mtSpecSuggestions(m, sp).filter(s => s.assigneeId === task.assignee_id);
  for(const s of sgs){
    const { error } = await supabaseClient.from('task_suggestions').update({ status: 'added', task_id: task.id, decided_at: new Date().toISOString() }).eq('id', s.id);
    if(!error){ s.status = 'added'; if(taskSuggestions) taskSuggestions = taskSuggestions.filter(x => x.id !== s.id); }
  }
}
function mtTaskNotes(m, sp){ return (sp.why ? sp.why + '\n\n' : '') + meetingPointNotes(m, sp.text); }
function mtDue(sp){ return sp.due && sp.due >= toDateStr(new Date()) ? sp.due : ''; }
function mtInsert(m, sp, assigneeId){
  return insertTaskRow({ title: sp.title, description: mtTaskNotes(m, sp), priority: 'medium', status: 'todo', assigner_id: currentUser.id, assignee_id: assigneeId,
    client_id: sp.clientId || null, link: m.url || null, due_date: mtDue(sp) || null });
}
function mtNotify(uid, title){
  if(uid === currentUser.id) return;
  const words = `${(typeof myName === 'function' && myName()) || 'Someone'}: "${title}"`;
  if(typeof mNotify === 'function') mNotify(uid, 'task_assigned', 'New task assigned to you', words, 'tasks');
  else if(typeof sendNotification === 'function') sendNotification(uid, 'task_assigned', 'New task assigned to you', words, 'tasks');
}
function mtAfterChange(m){
  meetingRedraw(m);
  if(typeof loadMyTasks === 'function') loadMyTasks().then(() => meetingRedraw(m));
  if(typeof updateTasksNavBadge === 'function') updateTasksNavBadge();
  if(typeof currentViewName !== 'undefined' && currentViewName === 'tasks' && typeof renderTasks === 'function') renderTasks();
  if(typeof mRenderTab === 'function') mRenderTab();
}
// Someone who was there: it's theirs, as it is
async function meetingAdd(id, key, btn){
  const m = (granolaMeetings || []).find(x => x.id === id), sp = mtSpec(m, key); if(!sp) return;
  if(mtSpecTasks(m, sp).length){ meetingRedraw(m); return; }
  const lab = btn && btn.querySelector('span');
  if(btn){ btn.disabled = true; if(lab) lab.textContent = 'Adding…'; }
  const res = await mtInsert(m, sp, currentUser.id);
  if(res.error || !res.data){ if(btn){ btn.disabled = false; if(lab) lab.textContent = 'Add to My Tasks'; } showToast('error', 'Not added', (res.error && res.error.message) || 'Try again in a moment.'); return; }
  mtKnow(res.data);
  await meetingSettle(m, sp, res.data);
  mtAfterChange(m);
  showToast('success', 'Added to your tasks', res.data.title);
}
// Admins and approvers: New Task, filled in, for the person it names; back to the sheet after
function meetingAssign(id, key){
  const m = (granolaMeetings || []).find(x => x.id === id), sp = mtSpec(m, key); if(!sp) return;
  const preset = { title: sp.title, description: mtTaskNotes(m, sp), clientId: sp.clientId || '', link: m.url || '', priority: 'medium', due: mtDue(sp) };
  const after = async task => {
    if(!task) return;
    mtKnow(task);
    await meetingSettle(m, sp, task);
    // iPhone: the task sheet closes after this, so the meeting opens again once it has
    if(typeof mOpenTaskSheet === 'function') setTimeout(() => openMeetingNotes(m.id), 450); else openMeetingNotes(m.id);
  };
  if(typeof mOpenTaskSheet === 'function'){
    mCloseSheet(true);
    setTimeout(() => mOpenTaskSheet({ ...preset, assigneeId: sp.whoId || currentUser.id, afterSave: after }), 320);
    return;
  }
  openNewTaskModal(sp.whoId || currentUser.id, 'todo', { ...preset, afterCreate: after });
}
// Add All (yours) / Assign All (each to the person it names): every pulled task not made yet
async function meetingAll(id, btn){
  const m = (granolaMeetings || []).find(x => x.id === id); if(!m) return;
  const can = meetingCanAssign();
  const open = meetingItems(m).flatMap(g => g.items).map(it => mtSpec(m, it.key)).filter(sp => sp && !mtSpecTasks(m, sp).length && (can ? sp.whoId : true));
  if(!open.length) return;
  if(btn){ btn.disabled = true; btn.textContent = can ? 'Assigning…' : 'Adding…'; }
  const per = {};
  for(const sp of open){
    const who = can ? sp.whoId : currentUser.id;
    const res = await mtInsert(m, sp, who);
    if(res.error || !res.data) continue;
    per[who] = (per[who] || 0) + 1;
    mtKnow(res.data);
    await meetingSettle(m, sp, res.data);
    mtNotify(who, res.data.title);
  }
  const n = Object.values(per).reduce((a, b) => a + b, 0);
  mtAfterChange(m);
  if(!n){ showToast('error', 'Nothing added', 'Try again in a moment.'); return; }
  if(can) showToast('success', `Assigned ${n} task${n === 1 ? '' : 's'}`, Object.entries(per).map(([uid, k]) => `${uid === currentUser.id ? 'You' : mtName(uid)} ${k}`).join(' · '));
  else showToast('success', `Added ${n} task${n === 1 ? '' : 's'} to yours`, m.title);
}

// Remove from Radar: for everyone, and no read of Granola brings it back; tasks made from it stay
async function meetingRemove(id){
  const m = (granolaMeetings || []).find(x => x.id === id); if(!m) return;
  const waiting = (meetingSgs[id] || []).some(s => s.status === 'pending');
  const ok = await confirmDialog(`It goes for everyone on the team and won’t come back when Granola is read. Tasks already made from it stay${waiting ? '; its waiting suggestions are dismissed' : ''}.`,
    { title: `Remove “${m.title}” from Radar?`, confirmLabel: 'Remove', destructive: true, danger: true });
  if(!ok) return;
  try{ await granolaApi('remove-meeting', { note: id }); }
  catch(e){ showToast('error', 'Not removed', e.message || 'Try again in a moment.'); return; }
  if(typeof mCloseSheet === 'function') mCloseSheet(true); else closeAppModal();
  granolaMeetings = (granolaMeetings || []).filter(x => x.id !== id);
  if(taskSuggestions) taskSuggestions = taskSuggestions.filter(s => s.sourceId !== id);
  meetingsChanged();
  showToast('info', 'Removed from Radar', m.title, { action: 'Undo', onAction: () => meetingRestore(id) });
}
async function meetingRestore(id){
  let r;
  try{ r = await granolaApi('restore-meeting', { note: id }); }
  catch(e){ showToast('error', 'Not restored', e.message || 'Try again in a moment.'); return false; }
  await loadGranolaMeetings();
  try{ await loadTaskSuggestions(); }catch(e){}
  meetingsChanged();
  showToast('success', 'Back in Radar', (r && r.title) || '');
  return true;
}
function meetingsChanged(){
  const v = typeof currentViewName !== 'undefined' ? currentViewName : '';
  if(v === 'notes' && typeof renderNotes === 'function') renderNotes();
  if(v === 'tasks' && typeof renderTasks === 'function') renderTasks();
  if(typeof updateTasksNavBadge === 'function') updateTasksNavBadge();
  if(typeof mRenderTab === 'function') mRenderTab();
  if(typeof mTop === 'function'){ const t = mTop(); if(t && t.refresh) t.refresh(); }
}

// ---- A client's meetings (Nov 23) ---------------------------------------------------------------
// The meetings Radar read for a client (the ones you can see), and when the team last met them:
// kept by the server for the whole team (app_storage granola-last-met; only someone from the client's
// side being there counts), so Health says the same for everyone.
let granolaLastMet = {};
async function loadGranolaLastMet(){
  try{
    const { data } = await supabaseClient.from('app_storage').select('value').eq('key', 'granola-last-met').maybeSingle();
    granolaLastMet = data && data.value ? (typeof data.value === 'string' ? JSON.parse(data.value) : data.value) || {} : {};
  }catch(e){ granolaLastMet = {}; }
  return granolaLastMet;
}
function clientMeetings(c){
  return (granolaMeetings || []).filter(m => String(m.metClientId || m.clientId || '') === String(c.id));
}
function clientLastMet(c){
  const t = granolaLastMet && granolaLastMet[c.id]; if(!t) return null;
  const d = new Date(t); return isNaN(d) ? null : d;
}
function lastMetWords(c){
  const d = clientLastMet(c); if(!d) return '';
  const n = daysBetween(d, rNow());
  return n <= 0 ? 'Met today' : n === 1 ? 'Met yesterday' : `Last met ${n} days ago`;
}
// Granola is in use: show the Meetings parts (once meetings were read, or it's connected)
function clientMeetingsOn(c){ return !!(clientLastMet(c) || (typeof granolaOn !== 'undefined' && granolaOn) || clientMeetings(c).length); }
// The client's meetings, as rows that open the notes (desktop and iPhone share the words)
function clientMeetingRows(c, n){
  return clientMeetings(c).slice(0, n || 50).map(m => ({ id: m.id, title: m.title, sub: [meetingWhenWords(m), m.owner ? `notes by ${String(m.owner).split(' ')[0]}` : '', meetingWasMine(m) ? 'you were there' : ''].filter(Boolean).join(' · ') }));
}
function clientMeetingsHtml(c, n){
  if(granolaMeetings === null){ loadGranolaMeetings().then(() => { if(typeof clientMeetingsRedraw === 'function') clientMeetingsRedraw(c); }); return `<p class="cm-none">Loading meetings…</p>`; }
  const rows = clientMeetingRows(c, n), all = clientMeetings(c).length;
  if(!rows.length) return `<p class="cm-none">${clientLastMet(c) ? 'No meetings with them that you were in.' : 'No meetings read for them yet.'}</p>`;
  return `<div class="cm-list">${rows.map(r => `<button type="button" class="cm-r" onclick="openMeetingNotes(${jsArg(r.id)})">${appLogo('granola', 'xs')}<span class="tx"><b>${escapeHtml(r.title)}</b><span>${escapeHtml(r.sub)}</span></span>${icon('caret-right', { weight: 'bold' })}</button>`).join('')}</div>`
    + (all > rows.length ? `<p class="cm-more">${all - rows.length} more in Notes → Meetings</p>` : '');
}
// After the meetings load: the open client panel or page draws them
function clientMeetingsRedraw(c){
  if(typeof renderClientsTable === 'function' && document.querySelector('.cl-p')) try{ renderClientsTable(); }catch(e){}
  if(typeof renderClientPage === 'function') try{ renderClientPage(); }catch(e){}
  if(typeof mTop === 'function'){ const t = mTop(); if(t && t.refresh) t.refresh(); }
}

// ---- A meeting's time, on your timesheet (Nov 23) -----------------------------------------------
// Someone who was there logs it in one go: Add Time opens filled in (its client, its day, how long it
// was booked for, "Meeting: …"); once logged, the sheet says so instead.
function meetingDay(m){ const d = new Date(m.at); return isNaN(d) ? toDateStr(new Date()) : toDateStr(d); }
function meetingTimeWords(m){ return `Meeting: ${m.title}`; }
function meetingTimeLogged(m){
  const day = meetingDay(m), words = meetingTimeWords(m);
  return (typeof timeEntries !== 'undefined' ? timeEntries : []).find(e => e.userId === currentUser.id && e.date === day && String(e.description || '').includes(words)) || null;
}
function meetingTimeHtml(m, ios){
  if(!meetingWasMine(m)) return '';
  const done = meetingTimeLogged(m);
  if(done) return `<span class="mtn-time is-done" title="On your timesheet">${icon('check', { weight: 'bold' })}${Math.floor(done.minutes / 60)}:${String(done.minutes % 60).padStart(2, '0')} logged</span>`;
  return `<button type="button" class="${ios ? 'ibtn s' : 'btn'} mtn-time" onclick="meetingLogTime('${m.id}')">${icon('clock')}${ios ? 'Log the Meeting’s Time' : 'Log Time'}</button>`;
}
function meetingLogTime(id){
  const m = (granolaMeetings || []).find(x => x.id === id); if(!m) return;
  const today = toDateStr(new Date()), day = meetingDay(m) <= today ? meetingDay(m) : today;
  const cid = m.metClientId || m.clientId || '', minutes = m.minutes || 30;
  if(typeof mOpenTimeSheet === 'function'){ mCloseSheet(true); setTimeout(() => mOpenTimeSheet(cid, { date: day, minutes, desc: meetingTimeWords(m) }), 320); return; }
  closeAppModal();
  openManualEntryModal(day, minutes, cid, meetingTimeWords(m));
}

// ---- A recap for the client (Nov 23) -------------------------------------------------------------
// After a meeting with a client: an email and a WhatsApp message drafted by AI from the notes, to read,
// change and send yourself (Copy, or Open in Email). Only for a meeting someone from a client was in.
let meetingRecaps = {};    // meeting id → { subject, email, whatsapp, to, client } | { loading } | { error }
let meetingRecapCh = {};   // meeting id → 'email' | 'whatsapp'
function meetingGuests(m){
  const team = new Set((teamProfiles || []).map(p => String(p.email || '').toLowerCase().split('@')[1]).filter(Boolean));
  return (m.people || []).filter(e => { const d = String(e).toLowerCase().split('@')[1]; return d && !team.has(d); });
}
function meetingWithClient(m){ return !!(m.metClientId || (meetingGuests(m).length && m.clientId)); }
async function meetingRecap(id, again){
  const m = (granolaMeetings || []).find(x => x.id === id); if(!m) return;
  meetingView[id] = 'recap';
  if(!again && meetingRecaps[id] && !meetingRecaps[id].error){ meetingRedraw(m); return; }
  meetingRecaps[id] = { loading: true }; meetingRedraw(m);
  try{ meetingRecaps[id] = await granolaApi('meeting-recap', { note: id, again: !!again }); }
  catch(e){ meetingRecaps[id] = { error: e.message || 'The AI didn’t answer. Try again in a moment.' }; }
  meetingRedraw(m);
}
function meetingRecapHtml(m){
  const r = meetingRecaps[m.id], ios = typeof mOpenSheet === 'function';
  if(!r || r.loading) return `<div class="mtk-load" aria-live="polite"><p>${icon('sparkle')}Writing the recap…</p><i></i><i></i><i></i></div>`;
  if(r.error) return `<div class="mtk-empty"><p>${escapeHtml(r.error)}</p><button type="button" class="btn sm" onclick="meetingRecap('${m.id}', true)">Try Again</button></div>`;
  const ch = meetingRecapCh[m.id] || 'email', A = `'${m.id}'`;
  const seg = `<div class="seg rcp-seg" role="tablist" aria-label="Send by">${[['email', 'Email'], ['whatsapp', 'WhatsApp']].map(([k, t]) => `<button type="button" role="tab" aria-selected="${ch === k}" class="${ch === k ? 'on' : ''}" onclick="meetingRecapCh[${A}]='${k}';meetingRedraw((granolaMeetings||[]).find(x=>x.id===${A}))">${t}</button>`).join('')}</div>`;
  const keep = f => `oninput="meetingRecaps[${A}].${f}=this.value"`;
  const body = ch === 'email'
    ? `<div class="rcp-f"><span class="k">To</span><span class="v">${escapeHtml((r.to || []).join(', ') || 'Add who it’s for in your email app')}</span></div>
<div class="rcp-f"><label class="k" for="rcpSubj">Subject</label><input id="rcpSubj" class="tf rcp-in" value="${escapeHtml(r.subject || '')}" ${keep('subject')}></div>
<textarea id="rcpBody" class="tf rcp-ta" spellcheck="true" aria-label="The email" ${keep('email')}>${escapeHtml(r.email || '')}</textarea>
<div class="rcp-a"><button type="button" class="${ios ? 'ibtn s' : 'btn'}" onclick="meetingRecapCopy(${A})">${icon('copy')}Copy</button><button type="button" class="${ios ? 'ibtn s rcp-go' : 'btn btn-p'}" onclick="meetingRecapMail(${A})">${icon('envelope-simple')}Open in Email</button></div>`
    : `<textarea id="rcpWa" class="tf rcp-ta rcp-wa" spellcheck="true" aria-label="The WhatsApp message" ${keep('whatsapp')}>${escapeHtml(r.whatsapp || '')}</textarea>
<div class="rcp-a"><button type="button" class="${ios ? 'ibtn s rcp-go' : 'btn btn-p'}" onclick="meetingRecapCopy(${A})">${icon('copy')}Copy for WhatsApp</button></div>`;
  return `${seg}<div class="rcp">${body}</div><p class="mtk-foot">${icon('sparkle')}<span>Drafted by AI from the notes for ${escapeHtml(r.client || 'the client')}. Read it over before you send it. · <button type="button" class="x-lnk" onclick="meetingRecap(${A}, true)">Draft Again</button></span></p>`;
}
function meetingRecapText(id){
  const r = meetingRecaps[id] || {}, ch = meetingRecapCh[id] || 'email';
  return ch === 'email' ? `${r.subject ? `Subject: ${r.subject}\n\n` : ''}${r.email || ''}` : (r.whatsapp || '');
}
async function meetingRecapCopy(id){
  const ch = meetingRecapCh[id] || 'email', text = ch === 'email' ? (meetingRecaps[id] || {}).email || '' : meetingRecapText(id);
  try{ await navigator.clipboard.writeText(text); showToast('success', 'Copied', ch === 'email' ? 'Paste it into your email.' : 'Paste it into the client’s WhatsApp.'); }
  catch(e){ showToast('error', 'Couldn’t copy', 'Select the text and copy it.'); }
}
function meetingRecapMailUrl(id){
  const r = meetingRecaps[id] || {};
  return `mailto:${(r.to || []).map(encodeURIComponent).join(',')}?subject=${encodeURIComponent(r.subject || '')}&body=${encodeURIComponent(r.email || '')}`;
}
function meetingRecapMail(id){ window.location.href = meetingRecapMailUrl(id); }

// ---- What the client said they'd do (Nov 23) -----------------------------------------------------
// Each became a follow-up (Reminders) when the meeting was read; the meeting lists them.
function meetingFollowUpsHtml(m){
  const ids = m.followUps || []; if(!ids.length || typeof clientReminders === 'undefined') return '';
  const rs = ids.map(id => clientReminders.find(r => r.id === id)).filter(Boolean); if(!rs.length) return '';
  const c = clients.find(x => String(x.id) === String(m.metClientId || m.clientId));
  const day = d => d ? fmtShortDate(new Date(d + 'T12:00:00')) : '';
  const open = typeof mOpenSheet === 'function' ? id => `mCloseSheet(true);setTimeout(() => mReminderActions('${id}'), 320)` : id => `closeAppModal();openReminderDetailModal('${id}')`;
  return `<div class="mtn-fu"><p class="k">${icon('bell')}Waiting on ${escapeHtml(c ? c.name : 'the client')}</p>${rs.map(r => `<button type="button" class="mtn-fu-r" onclick="${open(r.id)}"><span>${escapeHtml(r.question)}</span><em>${r.status === 'answered' ? 'answered' : r.followUpDate ? `follow up ${escapeHtml(day(r.followUpDate))}` : ''}</em></button>`).join('')}</div>`;
}

// ---- New meetings, counted on Notes (Nov 23) -----------------------------------------------------
// The Granola meetings Radar read since you last opened Notes (the ones you can see): the count on
// Notes in the sidebar (and on iPhone, the Notes row). Opening Notes clears it.
let granolaNewN = 0;
function granolaSeenKey(){ return `radar-mt-seen-${typeof currentUser !== 'undefined' && currentUser ? currentUser.id : ''}`; }
function granolaMarkSeen(){
  try{ localStorage.setItem(granolaSeenKey(), new Date().toISOString()); }catch(e){}
  if(granolaNewN){ granolaNewN = 0; granolaBadgesChanged(); }
}
async function granolaCountNew(){
  if(typeof currentUser === 'undefined' || !currentUser) return 0;
  let seen = null; try{ seen = localStorage.getItem(granolaSeenKey()); }catch(e){}
  if(!seen){ granolaMarkSeen(); return 0; }   // the first time: from now on
  const { data, error } = await supabaseClient.from('app_storage').select('key, value').like('key', 'granola-note:%').gt('updated_at', seen).limit(80);
  if(error) return granolaNewN;
  const n = (data || []).map(r => { let m = {}; try{ m = typeof r.value === 'string' ? JSON.parse(r.value) || {} : r.value || {}; }catch(e){} return m; })
    .filter(m => m.state === 'done' && m.summary && m.at && m.at > seen && meetingCanSee({ people: m.people || [] })).length;
  if(n !== granolaNewN){ granolaNewN = n; granolaBadgesChanged(); }
  return n;
}
function granolaBadgesChanged(){
  if(typeof updateNotesBadge === 'function') updateNotesBadge();
  if(typeof mRenderTab === 'function' && typeof mTab !== 'undefined' && mTab === 'more') mRenderTab();
}

async function insertTaskRow(row){
  let res = await supabaseClient.from('tasks').insert(row).select().single();
  if(res.error && isMissingColumnError(res.error) && ('color' in row || 'sprint_id' in row)){
    const { color, sprint_id, ...rest } = row; if(color) warnNoColorColumn();
    row = rest; res = await supabaseClient.from('tasks').insert(row).select().single();
  }
  // "None" is stored as no priority; if the database insists on one, Low behaves the same (no flag).
  if(res.error && row.priority == null) res = await supabaseClient.from('tasks').insert({ ...row, priority: 'low' }).select().single();
  return res;
}
async function addTaskToMyCalendar(task, hhmm){
  const due = task.due_date;
  const start = hhmm ? new Date(`${due}T${hhmm}:00`) : null;
  const { error } = await supabaseClient.from('calendar_events').insert({
    title: task.title, description: task.description || null,
    start_at: start ? start.toISOString() : `${due}T00:00:00`, end_at: start ? new Date(start.getTime() + 30 * 60000).toISOString() : `${due}T23:59:59`, all_day: !start,
    client_id: task.client_id, created_by: currentUser.id, event_type: 'deadline',
    related_task_id: task.id, attendee_ids: [...new Set([task.assigner_id, task.assignee_id])]
  });
  if(typeof loadCalendarEvents === 'function') await loadCalendarEvents();
  return !error;
}
async function saveNewTask(){
  const f = ntReadForm();
  if(!f.title){ showToast('error', 'Title required', 'Give the task a title first.'); document.getElementById('taskTitleInput')?.focus(); return; }
  if(f.dueDate && f.dueDate < toDateStr(new Date())){ showToast('error', 'Date is in the past', 'Pick today or a later date.'); return; }
  if(f.clientId && isClientPaused(f.clientId)){ showPausedClientWarning(f.clientId); return; }
  const addCal = sheetIsOn('ntCal') && !!f.dueDate;
  const btn = clickedBtn(); setBtnLoading(btn, 'Creating…');
  const row = { title: f.title, description: f.description, priority: f.priority === 'none' ? null : f.priority,
    assigner_id: currentUser.id, assignee_id: f.assigneeId, client_id: f.clientId, due_date: f.dueDate, link: f.link, status: newTaskPresetStatus };
  if(f.color) row.color = f.color;
  const { data, error } = await insertTaskRow(row);
  newTaskPresetStatus = 'todo';
  if(error || !data){ restoreBtn(btn); showToast('error', 'Save failed', error?.message || 'Try again in a moment.'); return; }
  let filesFailed = [];
  if((window._ntFiles || []).length){ setBtnLoading(btn, 'Uploading…'); filesFailed = (await uploadTaskFiles(data.id, window._ntFiles)).failed; }
  restoreBtn(btn);
  closeAppModal();
  const afterCreate = window._ntAfterCreate; window._ntAfterCreate = null;
  if(f.dueTime) await setTaskDueTime(data.id, f.dueTime);
  let calOk = true;
  if(addCal) calOk = await addTaskToMyCalendar(data, f.dueTime);
  await loadMyTasks();
  renderTasks(); updateTasksNavBadge();
  if(typeof renderCalendar === 'function') renderCalendar();
  if(afterCreate) await afterCreate(data);
  const assignee = teamProfiles.find(p => p.id === f.assigneeId);
  if(f.assigneeId !== currentUser.id) sendNotification(f.assigneeId, 'task_assigned', 'New task assigned to you', `${myName() || 'Someone'}: "${f.title}"`, 'tasks');
  if(filesFailed.length) showToast('error', `Task created, ${filesFailed.length === 1 ? 'a file' : filesFailed.length + ' files'} not attached`, taskFilesError(filesFailed));
  else if(!calOk) showToast('info', 'Task created', 'It couldn’t be added to your calendar. Try again from the task.');
  else showToast('success', f.assigneeId === currentUser.id ? 'Task created' : 'Task assigned', f.assigneeId === currentUser.id ? (addCal ? 'Added to your tasks and your calendar.' : 'Added to your tasks.') : `${assignee ? firstName(assignee.name) : 'They'} will be notified.`);
}
async function saveEditTask(taskId){
  const t = tasks.find(x => x.id === taskId);
  if(!t || t.assignerId !== currentUser.id) return;
  const f = ntReadForm();
  if(!f.title){ showToast('error', 'Title required', 'Give the task a title first.'); return; }
  if(f.dueDate && f.dueDate !== t.dueDate && f.dueDate < toDateStr(new Date())){ showToast('error', 'Date is in the past', 'Pick today or a later date.'); return; }
  const reassigned = f.assigneeId !== t.assigneeId;
  const row = { title: f.title, description: f.description, priority: f.priority === 'none' ? null : f.priority, assignee_id: f.assigneeId, client_id: f.clientId,
    due_date: f.dueDate, link: f.link, assignee_notified: reassigned ? false : t.assigneeNotified };
  if((f.color || null) !== (t.color || null)) row.color = f.color;
  let { error } = await supabaseClient.from('tasks').update(row).eq('id', taskId);
  if(error && isMissingColumnError(error) && 'color' in row){ delete row.color; warnNoColorColumn(); ({ error } = await supabaseClient.from('tasks').update(row).eq('id', taskId)); }
  if(error && row.priority == null) ({ error } = await supabaseClient.from('tasks').update({ ...row, priority: 'low' }).eq('id', taskId));
  if(!error && (taskDueTimes[taskId] || '') !== (f.dueTime || '')) await setTaskDueTime(taskId, f.dueTime);
  let filesFailed = [];
  if(!error && window._ntRemove && window._ntRemove.size) await removeTaskFiles(taskId, [...window._ntRemove]);
  if(!error && (window._ntFiles || []).length) filesFailed = (await uploadTaskFiles(taskId, window._ntFiles)).failed;
  closeAppModal();
  await loadMyTasks();
  renderTasks();
  error ? showToast('error', 'Save failed', error.message) : filesFailed.length ? showToast('error', 'Saved, but not every file was attached', taskFilesError(filesFailed)) : showToast('success', 'Task updated', 'Changes saved.');
  if(!error && !reassigned && f.assigneeId !== currentUser.id) sendNotification(f.assigneeId, 'task_edited', 'Task updated', `${myName() || 'Someone'} updated "${f.title}".`, 'tasks');
}
