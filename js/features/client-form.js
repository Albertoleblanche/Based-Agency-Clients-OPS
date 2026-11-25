// Add/edit client form, danger-score weights, duplicate checks, save.

function clientFormHtml(title, submitLabel, customValues){
  return `
    <div class="modal-head"><span class="panel-title">${escapeHtml(title)}</span><span class="toast-close" onclick="closeClientForm()">✕</span></div>
    <div class="modal-body">
      <div class="form-grid">
        <div><label>Client name</label><input id="ncName" placeholder="e.g. Premium Homes" oninput="checkDuplicateClientName()"><div id="ncNameWarning" style="display:none;font-size:12px;color:var(--red);margin-top:5px;"></div></div>
        <div><label>Website <span style="font-weight:400;color:var(--muted-lt);">(optional)</span></label><input id="ncWebsite" placeholder="https://client.com"></div>
        <div><label>Service</label><select id="ncService"></select></div>
        <div><label>Status</label><select id="ncStatus"></select></div>
        <div><label>Importance (1–10)</label><select id="ncImportance"></select></div>
        <div><label>Danger score (1–5)</label><select id="ncDanger"><option selected>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select><div id="ncDangerNudge" style="display:none;font-size:12px;color:var(--amber);margin-top:5px;"></div></div>
        <div><label>Monthly hour budget</label><input type="number" id="ncBudget" min="0" step="0.5" placeholder="e.g. 20 (optional)"></div>
        <div style="position:relative;">
          <label>Start date <span style="font-weight:400;color:var(--muted-lt);">(optional)</span></label>
          ${datePickerFieldHtml('ncStartDate', { maxDate: toDateStr(new Date()) })}
        </div>
        <div style="grid-column:1/-1;">
          <label>Client email</label>
          <input id="ncEmail" style="width:100%;" placeholder="contact@client.com, billing@client.com">
          <p style="font-size:12.5px;color:var(--muted-lt);margin:6px 0 0;line-height:1.5;">Add more than one address by separating them with commas — updates will go to everyone listed here.</p>
        </div>
        <div style="grid-column:1/-1;"><label>SOW / scope notes</label><input id="ncSow" spellcheck="true" placeholder="Brief scope summary"></div>
        ${customFieldsFormHtml(customValues)}
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-brand" id="clientFormSubmitBtn" onclick="saveClientForm()">${submitLabel}</button>
      <button class="btn btn-outline" onclick="closeClientForm()">Cancel</button>
    </div>`;
}

function resetClientFormFields(){
  document.getElementById('ncName').value='';
  document.getElementById('ncEmail').value='';
  document.getElementById('ncWebsite').value='';
  setDatePickerValue('ncStartDate', '');
  renderClientOptionsSelects();
  document.getElementById('ncImportance').value='5';
  document.getElementById('ncDanger').value='1';
  document.getElementById('ncBudget').value='';
  document.getElementById('ncSow').value='';
}

function openAddClientForm(){
  if(!canApprove()){ showToast('error','Not allowed','Only admins and approvers can add clients.'); return; }
  editingClientId = null;
  openAppModal(clientFormHtml('Add client', 'Save client'), 560);
  resetClientFormFields();
}

// Reusable, named list — same pattern as EXTRA_PERMISSIONS_META — so
// adding a future signal later is one entry here, not new HTML.
const DANGER_WEIGHT_META = [
  { key:'overdueReminders', label:'Overdue follow-ups', hint:'Unanswered client questions past due' },
  { key:'daysSinceImprovement', label:'Time since last logged improvement', hint:'How long it\'s been since any work was logged' },
  { key:'draftPending', label:'Draft sitting pending', hint:'How long an unapproved draft has been waiting' },
  { key:'importance', label:'Client importance', hint:'The client\'s own importance rating' },
];
const DEFAULT_DANGER_WEIGHTS = { overdueReminders:4, daysSinceImprovement:3, draftPending:2, importance:1 };

function renderDangerWeights(){
  const el = document.getElementById('dangerWeightsList');
  if(!el) return;
  const weights = settings.dangerWeights || DEFAULT_DANGER_WEIGHTS;
  el.innerHTML = DANGER_WEIGHT_META.map(w=>{
    const val = weights[w.key] ?? DEFAULT_DANGER_WEIGHTS[w.key];
    return `
    <div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px;">
        <label style="font-size:13.5px;font-weight:600;color:var(--ink);">${escapeHtml(w.label)}</label>
        <span id="dangerWeight-${w.key}-val" style="font-size:13px;color:var(--muted);font-weight:600;">${escapeHtml(val)}</span>
      </div>
      <p style="font-size:12px;color:var(--muted-lt);margin:0 0 6px;">${w.hint}</p>
      <input type="range" min="0" max="5" step="1" value="${escapeHtml(val)}" id="dangerWeight-${w.key}" oninput="document.getElementById('dangerWeight-${w.key}-val').textContent=this.value" style="width:100%;accent-color:var(--brand);">
    </div>`;
  }).join('');
}

async function saveDangerWeights(){
  if(!isAdmin()){ showToast('error','Not allowed','Only admins can change this.'); return; }
  const weights = {};
  DANGER_WEIGHT_META.forEach(w=>{ weights[w.key] = parseInt(document.getElementById(`dangerWeight-${w.key}`).value); });
  settings.dangerWeights = weights;
  const ok = await persistSettings();
  ok ? showToast('success','Saved','The nudge on client forms will use these weights from now on.') : showToast('error','Save failed','Could not save — try again.');
}

// The score itself always stays a human call (per the existing nudge's
// own design) — this only computes what the nudge suggests. Each signal
// is normalized to a 0-1 "severity", combined by its admin-set weight,
// then mapped onto the 1-5 scale. Returns null if every weight is
// zeroed out, since there's nothing meaningful left to suggest.
function computeSuggestedDanger(c){
  const weights = settings.dangerWeights || DEFAULT_DANGER_WEIGHTS;
  const totalWeight = DANGER_WEIGHT_META.reduce((sum,w)=> sum + (weights[w.key] ?? DEFAULT_DANGER_WEIGHTS[w.key]), 0);
  if(totalWeight <= 0) return null;

  const overdueCount = clientReminders.filter(r=>r.clientId===c.id && reminderDisplayStatus(r)==='due').length;
  const overdueSeverity = Math.min(overdueCount/3, 1);

  const lastImp = [...(c.improvements||[])].sort((a,b)=>new Date(b.date)-new Date(a.date))[0];
  const daysSinceImp = lastImp ? (Date.now()-new Date(lastImp.date).getTime())/86400000 : 999;
  const staleSeverity = Math.min(daysSinceImp/30, 1);

  // A client can now have several independent pending drafts (one per
  // author, see addendum-25.sql) — uses whichever has been pending
  // longest, since that's the most severe signal for a risk score. Any
  // one person's draft sitting untouched for a week is worth flagging,
  // regardless of what state everyone else's drafts for this client are in.
  let draftSeverity = 0;
  const pendingDrafts = (c.drafts||[]).filter(d => d.draftStatus==='pending' && d.draftPendingSince);
  if(pendingDrafts.length){
    const daysPending = Math.max(...pendingDrafts.map(d => (Date.now()-new Date(d.draftPendingSince).getTime())/86400000));
    draftSeverity = Math.min(daysPending/7, 1);
  }

  const importanceSeverity = (c.importance||5)/10;

  const w = weights;
  const weightedSum =
    overdueSeverity * (w.overdueReminders ?? DEFAULT_DANGER_WEIGHTS.overdueReminders) +
    staleSeverity * (w.daysSinceImprovement ?? DEFAULT_DANGER_WEIGHTS.daysSinceImprovement) +
    draftSeverity * (w.draftPending ?? DEFAULT_DANGER_WEIGHTS.draftPending) +
    importanceSeverity * (w.importance ?? DEFAULT_DANGER_WEIGHTS.importance);

  const score01 = weightedSum / totalWeight;
  return Math.max(1, Math.min(5, Math.round(1 + score01*4)));
}

function openEditClientForm(id){
  if(!canApprove()){ showToast('error','Not allowed','Only admins and approvers can edit clients.'); return; }
  const c = clients.find(x=>x.id===id);
  if(!c){ showToast('error','Client not found','Someone may have removed this — refreshing.'); fullRefresh(); return; }
  editingClientId = id;
  openAppModal(clientFormHtml('Edit client', 'Save changes', c.customFieldValues), 560);
  document.getElementById('ncName').value = c.name;
  document.getElementById('ncEmail').value = c.email || '';
  document.getElementById('ncWebsite').value = c.website || '';
  setDatePickerValue('ncStartDate', c.startDate || '');
  renderClientOptionsSelects();
  ensureSelectHasValue('ncService', c.service);
  ensureSelectHasValue('ncStatus', c.status);
  document.getElementById('ncImportance').value = c.importance;
  document.getElementById('ncDanger').value = c.danger;
  document.getElementById('ncBudget').value = c.monthlyHourBudget || '';
  document.getElementById('ncSow').value = c.sow || '';

  // A soft nudge, not an automatic change — surfaces the signal so the
  // approver can factor it in, but the actual danger score stays a human
  // judgment call. Only shown when there's a real gap between what the
  // weighted signals suggest and what the score currently reflects, so
  // it doesn't nag someone who's already accounted for it.
  const suggested = computeSuggestedDanger(c);
  const nudgeEl = document.getElementById('ncDangerNudge');
  if(nudgeEl){
    if(suggested!==null && suggested > c.danger){
      nudgeEl.style.display = 'block';
      nudgeEl.innerHTML = `⚠️ Based on overdue follow-ups, time since last logged work, and draft status, this could be a ${suggested} — worth reconsidering.`;
    } else {
      nudgeEl.style.display = 'none';
    }
  }
}

// If a client's current value was since removed from the managed options list,
// add it back temporarily so editing the client doesn't silently change it.
function ensureSelectHasValue(selectId, value){
  const sel = document.getElementById(selectId);
  if(!sel || !value) return;
  const exists = Array.from(sel.options).some(o=>o.value===value);
  if(!exists){
    const opt = document.createElement('option');
    opt.value = value; opt.textContent = value + ' (no longer a listed option)';
    sel.appendChild(opt);
  }
  sel.value = value;
}

function closeClientForm(){
  editingClientId = null;
  closeAppModal();
}

// Allows one or several comma-separated addresses (a client with more than
// one contact) — empty is fine too, since email isn't a required field.
// Simple shape check (name@domain.tld), not full RFC 5322 validation —
// enough to catch someone typing a name or a note into this field by
// mistake, without being pedantic about edge-case address formats.
function isValidEmailList(value){
  const trimmed = (value||'').trim();
  if(!trimmed) return true;
  const parts = trimmed.split(',').map(s=>s.trim()).filter(Boolean);
  if(!parts.length) return true;
  const emailShape = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return parts.every(p => emailShape.test(p));
}

// Quick, local hint as the user types — catches the common case early,
// before they've filled out the rest of the form. Not authoritative on its
// own; saveClientForm() does the real check against freshly reloaded data
// right before saving, since this only has whatever was already in memory.
function checkDuplicateClientName(){
  const input = document.getElementById('ncName');
  const warningEl = document.getElementById('ncNameWarning');
  if(!input || !warningEl) return;
  const name = input.value.trim().toLowerCase();
  if(!name){ warningEl.style.display = 'none'; return; }
  const duplicate = liveClients().find(c => c.id !== editingClientId && c.name.trim().toLowerCase() === name);
  if(duplicate){
    warningEl.textContent = `A client named "${duplicate.name}" already exists.`;
    warningEl.style.display = 'block';
  } else {
    warningEl.style.display = 'none';
  }
}

// Records a danger value with a real timestamp — the raw material the
// Overview chart's trend line is reconstructed from later (via "most
// recent value at or before date X" per client). Fire-and-forget, same as
// logClientActivity() — this is secondary analytical data, not something
// that should block or fail the actual client save if it hiccups.
// previousDanger lets this tell "just crossed into 5/5" apart from
// "already was at 5/5, someone just re-saved the client" — without it,
// every unrelated edit to a client already at max danger would re-fire
// the alert below, which would train people to ignore it.
// Who set it is kept too (Nov 25), so Health can say "Flagged by Dan" and not guess from the owner.
// Before the set_by column (addendum-risk-set-by.sql) it's saved without.
function logDangerHistory(clientId, danger, previousDanger){
  const row = { client_id: clientId, danger, set_by: (typeof myName === 'function' && myName()) || null };
  supabaseClient.from('client_danger_history').insert(row).then(({error})=>{
    if(error && /set_by/.test(error.message || '')) return supabaseClient.from('client_danger_history').insert({ client_id: clientId, danger });
    if(error) console.error('logDangerHistory error', error);
  }).then(r => { if(r && r.error) console.error('logDangerHistory error', r.error); });
  if(typeof dangerHistory !== 'undefined' && Array.isArray(dangerHistory)) dangerHistory.push({ clientId, danger, recordedAt: new Date(), setBy: row.set_by || '' });
  if(danger === 5 && previousDanger !== 5) alertClientDangerMaxed(clientId);
  else if(previousDanger != null && danger < previousDanger) alertClientDangerDecreased(clientId, previousDanger, danger);
}

// Real-time alert the moment a client's danger score maxes out, rather
// than waiting for it to surface in the weekly focus report's "needs
// attention" section days later. Everyone on the team gets it, matching
// the same "useful to whoever's actually doing the client work, not just
// admins" reasoning as the weekly report itself — except the person who
// just set it, since they obviously already know.
async function alertClientDangerMaxed(clientId){
  const c = clients.find(x=>x.id===clientId);
  if(!c) return;
  const title = `${c.name} just hit max danger (5/5)`;
  const body = `${myName()||'Someone'} flagged ${c.name} at the highest danger level — might be worth a look before it waits for the weekly report.`;
  const recipients = teamProfiles.filter(p=>p.id !== currentUser?.id);
  for(const p of recipients){
    sendNotification(p.id, 'client_danger_maxed', title, body, 'client-detail', clientId);
  }
}

// The other direction — someone (an admin, or a person specifically
// granted the ability) judged the situation resolved enough to lower the
// score. Worth knowing in real time too, same as the score climbing —
// same "everyone except whoever just did it" recipient logic.
async function alertClientDangerDecreased(clientId, previousDanger, newDanger){
  const c = clients.find(x=>x.id===clientId);
  if(!c) return;
  const title = `${c.name}'s danger score went down`;
  const body = `${myName()||'Someone'} lowered ${c.name}'s danger from ${previousDanger}/5 to ${newDanger}/5.`;
  const recipients = teamProfiles.filter(p=>p.id !== currentUser?.id);
  for(const p of recipients){
    sendNotification(p.id, 'client_danger_decreased', title, body, 'client-detail', clientId);
  }
}

async function saveClientForm(){
  // Defense in depth — openAddClientForm()/openEditClientForm() already
  // block reaching this form at all for a member, but this covers the
  // edge case of the modal already being open when a role changes
  // mid-session, or the function being called directly some other way.
  if(!canApprove()){ showToast('error','Not allowed','Only admins and approvers can add or edit clients.'); return; }
  const name = document.getElementById('ncName').value.trim();
  if(!name){ showToast('error','Client name required','Enter a name before saving.'); return; }
  const emailValue = document.getElementById('ncEmail').value.trim();
  if(emailValue && !isValidEmailList(emailValue)){
    showToast('error','Check the email field','Make sure each address looks like a real email (name@domain.com), separated by commas.');
    return;
  }
  const btn = clickedBtn();
  setBtnLoading(btn, 'Saving…');
  await loadAll();
  const normalizedName = name.toLowerCase();
  const duplicate = liveClients().find(c => c.id !== editingClientId && c.name.trim().toLowerCase() === normalizedName);
  if(duplicate){
    restoreBtn(btn);
    showToast('error','Client already exists', `${duplicate.name} is already in the system — pick a different name, or open that client instead.`);
    return;
  }
  const fields = {
    name,
    email: emailValue,
    website:document.getElementById('ncWebsite').value.trim(),
    service:document.getElementById('ncService').value,
    status:document.getElementById('ncStatus').value,
    importance:parseInt(document.getElementById('ncImportance').value),
    danger:parseInt(document.getElementById('ncDanger').value),
    monthlyHourBudget: parseFloat(document.getElementById('ncBudget').value) || 0,
    sow:document.getElementById('ncSow').value.trim(),
    startDate: document.getElementById('ncStartDate').value || null,
  };
  // What's set outside this form stays: how the weekly win is sent (client panel) and a client's
  // Harvest setup. Only the fields below change here.
  const customFieldValues = editingClientId ? Object.assign({}, (clients.find(x=>x.id===editingClientId) || {}).customFieldValues || {}) : {};
  (settings.customFields||[]).forEach(f=>{
    const el = document.getElementById('ncCustom_'+f.id);
    if(el) customFieldValues[f.id] = el.value.trim();
  });
  // owner (empty: automatic) and the weekly update (Nov 22: "No weekly update" for internal clients)
  const ownerEl = document.getElementById('ncOwner');
  if(ownerEl){ if(ownerEl.value) customFieldValues.owner = ownerEl.value; else delete customFieldValues.owner; }
  const weeklyEl = document.getElementById('ncWeekly');
  if(weeklyEl){ if(weeklyEl.value === 'off') customFieldValues.weeklyUpdate = 'off'; else delete customFieldValues.weeklyUpdate; }
  // Focus (Nov 23): when it's switched on, and by whom, is kept until it's switched off
  const focusEl = document.getElementById('ncFocus');
  if(focusEl){
    if(focusEl.value === 'on'){ if(!customFieldValues.focus) Object.assign(customFieldValues, { focus: true, focusAt: new Date().toISOString(), focusBy: myName() || '' }); }
    else { delete customFieldValues.focus; delete customFieldValues.focusAt; delete customFieldValues.focusBy; }
  }
  // the main contact: who wins and updates greet by name
  const contactEl = document.getElementById('ncContact');
  if(contactEl){ const v = contactEl.value.trim().replace(/\s+/g, ' ').slice(0, 80); if(v) customFieldValues.contact = v; else delete customFieldValues.contact; }
  const missingRequired = (settings.customFields||[]).find(f => f.required && !customFieldValues[f.id]);
  if(missingRequired){
    restoreBtn(btn);
    showToast('error','Missing required field', `"${missingRequired.label}" is required — fill it in before saving.`);
    return;
  }
  fields.customFieldValues = customFieldValues;
  let ok, msg, loggedClientId;
  if(editingClientId){
    const c = clients.find(x=>x.id===editingClientId);
    if(!c){ showToast('error','Client not found','This client may have been removed — refreshing.'); closeClientForm(); restoreBtn(btn); await fullRefresh(); return; }
    const before = { ...c };
    // Anyone can raise a client's danger score — flagging a client as
    // riskier than before should never be gate-kept. Lowering it back
    // down is different: that's a judgment call about whether a concern
    // has actually been resolved, so it's admin-only by default, with a
    // specific per-person override on the team card for anyone who
    // needs it without making them a full admin.
    if(Number(fields.danger) < Number(before.danger) && !canLowerDangerScore()){
      showToast('error','Not allowed','Only admins can lower a client\'s danger score — ask one to adjust it, or to grant you that permission.');
      restoreBtn(btn);
      return;
    }
    ok = await updateClientRow(editingClientId, fields);
    if(ok) Object.assign(c, fields);
    msg = `${name} updated.`;
    loggedClientId = editingClientId;
    if(ok){
      const fieldLabels = { name:'Name', email:'Email', website:'Website', service:'Service', status:'Status', importance:'Importance', danger:'Danger', monthlyHourBudget:'Monthly budget', sow:'SOW', startDate:'Start date' };
      const changes = Object.keys(fields)
        .filter(key => key!=='customFieldValues' && String(before[key]||'') !== String(fields[key]||''))
        .map(key => `${fieldLabels[key]||key}: "${before[key]||'—'}" → "${fields[key]||'—'}"`);
      const beforeCustom = before.customFieldValues || {};
      if((beforeCustom.contact || '') !== (customFieldValues.contact || '')) changes.push(`Main contact: "${beforeCustom.contact || '—'}" → "${customFieldValues.contact || '—'}"`);
      (settings.customFields||[]).forEach(f=>{
        const oldVal = beforeCustom[f.id] || '';
        const newVal = customFieldValues[f.id] || '';
        if(oldVal !== newVal) changes.push(`${f.label}: "${oldVal||'—'}" → "${newVal||'—'}"`);
      });
      const desc = changes.length
        ? `${myName()||'Someone'} changed — ${changes.join('; ')}`
        : `${myName()||'Someone'} saved this client (no actual field changes).`;
      logClientActivity(loggedClientId, 'client_edited', desc);
      refreshClientDetailActivityIfOpen(loggedClientId);
      if(before.danger !== fields.danger) logDangerHistory(loggedClientId, fields.danger, before.danger);
    }
  } else {
    const newId = 'c'+Date.now();
    const { error: insertErr } = await supabaseClient.from('clients').insert({ id:newId, ...clientFieldsToDb(fields), draft:'', draft_status:'none' });
    ok = !insertErr;
    if(ok) clients.push({ id:newId, ...fields, improvements:[], draft:'', draftStatus:'none' });
    msg = `${name} is now on the roster.`;
    loggedClientId = newId;
    if(ok){
      logClientActivity(loggedClientId, 'client_created', `${myName()||'Someone'} added this client to the roster.`);
      logDangerHistory(loggedClientId, fields.danger, null);
    }
  }
  const wasEditing = !!editingClientId;
  closeClientForm();
  restoreBtn(btn);
  renderAll();
  ok ? showToast('success', wasEditing ? 'Client updated' : 'Client added', msg) : showToast('error','Save failed','Could not save — check your connection and try again.');
}
