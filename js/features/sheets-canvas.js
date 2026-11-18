// Sheets, as on the canvas boards (Log Improvement, Group & Send, New Task): a title, the
// label-left field grid (.f), pop buttons over native selects, and one orange button.
// Loaded after the feature files, so these replace their older modal versions.

// ---- shared pieces -------------------------------------------------------------------------
// A pop button over a native select. `lead` goes before the label (an avatar, say).
function sheetPop(id, label, options, value, onchange, opts){
  opts = opts || {};
  const cur = options.find(o => String(o[0]) === String(value));
  const ph = opts.placeholder && !cur ? `<option value="" selected disabled hidden>${escapeHtml(opts.placeholder)}</option>` : '';
  return `<label class="pop pop-sel${opts.disabled ? ' off' : ''}"${opts.style ? ` style="${opts.style}"` : ''}>${opts.lead || ''}<span class="pl">${escapeHtml(cur ? cur[1] : (opts.placeholder || ''))}</span>${icon('caret-up-down', { weight: 'bold' })}<select id="${id}" aria-label="${escapeHtml(label)}" onchange="syncPopSel(this)${onchange ? ';' + onchange : ''}"${opts.disabled ? ' disabled' : ''}>${ph}${options.map(([v, t]) => `<option value="${escapeHtml(v)}"${String(v) === String(value) ? ' selected' : ''}>${escapeHtml(t)}</option>`).join('')}</select></label>`;
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
function sheetClientOptions(extraId){
  const list = liveClients().slice();
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
    service: r.service || '', attachments: Array.isArray(r.attachments) ? r.attachments : [] };
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
  grid.innerHTML = withUrls.map(a => isImageAttachment(a) && a.url
    ? `<button class="att" onclick="openImageLightbox(${jsArg(a.url)}, ${jsArg(a.name)})"><img src="${safeUrl(a.url)}" alt=""><span>${escapeHtml(a.name)}</span></button>`
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
function openQueueLogImprovementModal(presetClientId){
  logSheet = { files: [], useTimer: false, serviceTouched: false };
  const me = myName() || 'Team member';
  const list = liveClients().slice().sort((a, b) => a.name.localeCompare(b.name));
  const fromView = typeof currentViewName !== 'undefined' && currentViewName === 'clientdetail' && typeof currentDetailClientId !== 'undefined' ? currentDetailClientId : '';
  const cid = (typeof presetClientId === 'string' && presetClientId) || fromView || (timerState.running ? timerState.clientId : '') || '';
  const c = list.find(x => x.id === cid);
  const timerLink = timerState.running ? `<button type="button" class="btn btn-q" id="liTimerBtn" style="padding:0 4px" onclick="liUseTimer()">Use the running timer (${hmm((Date.now() - timerState.startedAt) / 60000)})</button>` : '';
  openAppModal(`<h3>Log Improvement</h3>
<div class="f">
<label for="liClient">Client</label><div>${sheetPop('liClient', 'Client', list.map(x => [x.id, x.name]), cid, 'liClientChanged()', { placeholder: 'Choose a client' })}</div>
<label class="top" for="liText">What did you do?</label><textarea id="liText" class="tf" style="height:84px" spellcheck="true" placeholder="What changed, with the number or result if there is one"></textarea>
<div id="liSvc" class="hvp">${liServiceRowHtml(c)}</div>
<label for="liDate">Date</label><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">${sheetDateField('liDate', toDateStr(new Date()), { past: true, from: -13, to: 0, max: toDateStr(new Date()) })}</div>
<label for="liTime">Time spent</label><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><input id="liTime" class="tf" style="width:80px" placeholder="0:30" autocomplete="off" oninput="logSheet.useTimer=false;liTimeChanged()">${timerLink}</div>
<div id="liPick" class="hvp"></div>
<span></span><div style="display:flex;align-items:flex-start;gap:10px;font-size:14px">${sheetSw('liInclude', true, 'Include in the client email')}<div><div>Include in the client email</div><div class="t-2" style="font-size:13px">Turn off for internal work the client doesn’t need to hear about</div></div></div>
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
function liClientChanged(){
  liTimeChanged(true);
  const c = clients.find(x => x.id === document.getElementById('liClient')?.value);
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
      const id = await stopAndSaveTimer({ quiet: true });
      if(id) await supabaseClient.from('time_entries').update({ logged: true }).eq('id', id); else timeOk = false;
    } else {
      const r = await mergeOrInsertTimeEntry({ clientId, service: pick.projectId ? pick.service : service, dateStr, minutes, description: text, projectId: pick.projectId, taskId: pick.taskId });
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

// ---- Group & Send: each client's logged work becomes one draft --------------------------------
// Each client's work since its last update. Clients due within 2 days are picked to start with.
let gsList = [], gsPick = new Set();
function gsCandidates(){
  const me = myName(), mineOnly = !canApprove();
  const out = [];
  weekVisibleClients().forEach(c => {
    const drafts = c.drafts || [], w = clientWeek(c);
    if(drafts.some(d => (d.draftStatus === 'approved' && !d.draftSentAt) || (d.draftStatus === 'pending' && d.readyToNotify))) return; // in Review or approved
    let imps = w.logged.slice();
    if(mineOnly) imps = imps.filter(i => i.author === me);
    const inEmail = imps.filter(i => i.includeInEmail !== false);
    if(!inEmail.length) return;
    const written = drafts.find(d => d.draftStatus === 'pending' && (!mineOnly || d.author === me));
    const writer = mineOnly ? me : (written ? written.author : (clientOwner(c) || inEmail[0].author || me));
    let redraft = 0;
    if(written){ const have = new Set(written.draftImprovementIds || []); redraft = inEmail.filter(i => !have.has(i.id)).length; if(!redraft) return; }
    if(!canGenerateOrRegenerateDraft(c, writer)) return;
    const s = n => n === 1 ? '' : 's';
    const by = writer === me ? 'you write it' : `${writer} writes it`;
    const sub = redraft ? `Redraft with the ${redraft} new improvement${s(redraft)} · ${writer === me ? 'you' : writer}`
      : `${imps.length} improvement${s(imps.length)}${inEmail.length !== imps.length ? ` · ${inEmail.length} in the email` : ''} · ${by}`;
    out.push({ c, writer, items: inEmail.slice().sort((a, b) => new Date(a.date) - new Date(b.date)), sub: `${w.dueText} · ${sub}`, daysLeft: w.daysLeft });
  });
  return out.sort((a, b) => a.daysLeft - b.daysLeft || a.c.name.localeCompare(b.c.name));
}
// Clients with approved drafts from more than one person: offered as "Combine Them…".
function gsCombinable(){ return activeClients().filter(c => (c.drafts || []).filter(d => d.draftStatus === 'approved' && !d.draftSentAt).length >= 2); }
function openGroupAndSendModal(){
  gsList = gsCandidates();
  gsPick = new Set(gsList.filter(x => x.daysLeft <= 2).map(x => x.c.id));
  gsRender();
}
function gsToggle(id){ gsPick.has(id) ? gsPick.delete(id) : gsPick.add(id); gsRender(true); }
function gsRender(keep){
  const rows = gsList.map(x => `<div class="row" style="cursor:default" onclick="gsToggle('${x.c.id}')">${sheetCk(gsPick.has(x.c.id), 'Include ' + x.c.name, `event.stopPropagation();gsToggle('${x.c.id}')`)}${monoHtml(x.c)}<div class="tx"><span class="t">${escapeHtml(x.c.name)}</span><span class="s">${escapeHtml(x.sub)}</span></div></div>`).join('')
    || `<div class="row"><div class="tx"><span class="t">Nothing to group</span><span class="s">Every client with work logged since its last update already has a draft.</span></div></div>`;
  const comb = gsCombinable();
  const combLine = comb.length && canApprove() ? `<p class="t-2" style="margin:12px 0 0;font-size:13px;line-height:1.45">${escapeHtml(comb[0].name)}${comb.length > 1 ? ` and ${comb.length - 1} more have` : ' has'} approved drafts from more than one person. <button class="link-btn" onclick="openCombineDraftsModal()">Combine Them…</button></p>` : '';
  const n = gsPick.size;
  const html = `<h3>Group &amp; Send</h3>
<p style="margin:-8px 0 14px;font-size:14px;color:var(--label-2);line-height:1.5">Each client’s improvements become one email draft. Drafts go to Review first, so nothing reaches a client until an approver sends it.</p>
<div class="grp gs-list" style="box-shadow:0 0 0 .5px var(--sep-strong)">${rows}</div>
<div class="form-grp" style="margin-top:14px">
<div class="fr"><div class="l"><b>Write the drafts with AI</b><span>Uses your email structure and signature from Settings</span></div>${sheetSw('gsAI', gsAIOn(), 'Write the drafts with AI', 'gsSaveAI()')}</div>
</div>${combLine}
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
  for(const [k, x] of picks.entries()){
    if(btn) btn.textContent = `Writing ${k + 1} of ${picks.length}…`;
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
    if(saved){ ok++; logClientActivity(x.c.id, 'draft_generated', `${useAI && text ? 'AI wrote' : 'Started'} ${x.writer}'s draft from ${x.items.length} improvement${x.items.length === 1 ? '' : 's'} with Group & Send, and sent it to Review.`); }
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
  let notes = t ? (t.description || '') : (presetContext?.description || '');
  if(t && t.link && !notes.includes(t.link)) notes = (notes ? notes + '\n\n' : '') + t.link;
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
<label class="top" for="taskDescInput">Notes</label><textarea id="taskDescInput" class="tf" spellcheck="true" placeholder="Add details, links or a checklist">${escapeHtml(notes)}</textarea>
${t ? '' : `<span></span><div style="display:flex;align-items:center;gap:10px;font-size:14px" id="ntCalRow" class="${due ? '' : 'off'}">${sheetSw('ntCal', true, 'Add to my calendar')}Add to my calendar</div>`}
</div>
<div class="sheet-a">${noteMenu}<button class="btn" onclick="closeAppModal()">Cancel</button><button class="btn btn-p" onclick="${t ? `saveEditTask('${t.id}')` : 'saveNewTask()'}">${t ? 'Save' : 'Create Task'}</button></div>`;
}
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
  const url = (notesTxt.match(/https?:\/\/[^\s<>"]+|www\.[^\s<>"]+/i) || [])[0];
  return { title, assigneeId: g('taskAssigneeSelect').value, priority: ntPriority(), description: notesTxt, dueDate,
    dueTime: dueDate ? (g('taskTimeInput')?.value || '') : '', clientId: g('taskClientSelect').value || null, link: url ? normalizeUrl(url.replace(/[).,;]+$/, '')) : null,
    color: pickedItemColor('ntColor') };
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
  restoreBtn(btn);
  if(error || !data){ showToast('error', 'Save failed', error?.message || 'Try again in a moment.'); return; }
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
  if(!calOk) showToast('info', 'Task created', 'It couldn’t be added to your calendar. Try again from the task.');
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
  closeAppModal();
  await loadMyTasks();
  renderTasks();
  error ? showToast('error', 'Save failed', error.message) : showToast('success', 'Task updated', 'Changes saved.');
  if(!error && !reassigned && f.assigneeId !== currentUser.id) sendNotification(f.assigneeId, 'task_edited', 'Task updated', `${myName() || 'Someone'} updated "${f.title}".`, 'tasks');
}
