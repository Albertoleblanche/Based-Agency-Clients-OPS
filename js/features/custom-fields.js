// Admin-defined service/status options and custom client fields.

const OPTION_KIND_KEYS = { service:'serviceOptions', status:'statusOptions', title:'teamTitleOptions' };

function renderOptionsManager(kind){
  const listEl = document.getElementById(kind+'OptionsList');
  if(!listEl) return;
  const options = settings[OPTION_KIND_KEYS[kind]];
  listEl.innerHTML = (options||[]).map((o,i)=>`
    <span class="option-chip">
      <span class="option-chip-arrows">
        <span class="option-chip-arrow ${i===0?'disabled':''}" onclick="moveFieldOption('${kind}',${jsArg(o)},-1)">▲</span>
        <span class="option-chip-arrow ${i===options.length-1?'disabled':''}" onclick="moveFieldOption('${kind}',${jsArg(o)},1)">▼</span>
      </span>
      ${escapeHtml(o)} <span class="option-chip-x" onclick="removeFieldOption('${kind}',${jsArg(o)})">✕</span>
    </span>
  `).join('') || `<span style="color:var(--muted-lt);font-size:13px;">No options yet.</span>`;
}

async function addFieldOption(kind){
  const inputId = kind+'OptionInput';
  const val = document.getElementById(inputId).value.trim();
  if(!val){ showToast('error','Nothing entered','Type an option name first.'); return; }
  await loadAll();
  const key = OPTION_KIND_KEYS[kind];
  if(settings[key].some(o=>o.toLowerCase()===val.toLowerCase())){ showToast('info','Already exists', `"${val}" is already an option.`); return; }
  settings[key].push(val);
  const ok = await persistSettings();
  document.getElementById(inputId).value = '';
  renderClientOptionsSelects();
  if(kind==='title') populateAddMemberTitleSelect();
  ok ? showToast('success','Option added', `"${val}" added.`) : showToast('error','Save failed','Could not save — try again.');
}

async function removeFieldOption(kind, value){
  if(!(await confirmDialog(`Remove "${value}" as an option? Existing records already set to it will keep the value, but it won't appear in the dropdown anymore.`, {confirmLabel:'Remove'}))) return;
  await loadAll();
  const key = OPTION_KIND_KEYS[kind];
  settings[key] = settings[key].filter(o=>o!==value);
  const ok = await persistSettings();
  renderClientOptionsSelects();
  if(kind==='title') populateAddMemberTitleSelect();
  ok ? showToast('success','Option removed', `"${value}" removed.`) : showToast('error','Save failed','Could not save — try again.');
}

async function moveFieldOption(kind, value, dir){
  await loadAll();
  const key = OPTION_KIND_KEYS[kind];
  const arr = settings[key];
  const i = arr.indexOf(value);
  const j = i + dir;
  if(i<0 || j<0 || j>=arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  const ok = await persistSettings();
  renderClientOptionsSelects();
  if(kind==='title') populateAddMemberTitleSelect();
  if(!ok) showToast('error','Save failed','Could not save the new order — try again.');
}

/* ---------- Custom client fields — user-defined, no code changes needed ---------- */

const CUSTOM_FIELD_TYPE_LABELS = { text:'Text', url:'URL', email:'Email', phone:'Phone', number:'Number', textarea:'Long text', select:'Dropdown' };
let customFieldDraftOptions = [];
let editingCustomFieldId = null;

function renderCustomFieldsManager(){
  const el = document.getElementById('customFieldsList');
  if(!el) return;
  const fields = settings.customFields || [];
  if(!fields.length){ el.innerHTML = `<div class="empty" style="padding:10px 0;">No custom fields yet — add one to track something specific to your clients.</div>`; return; }
  el.innerHTML = fields.map((f,i)=>`
    <div class="custom-field-row">
      <div class="custom-field-arrows">
        <span class="custom-field-arrow ${i===0?'disabled':''}" onclick="moveCustomField('${f.id}',-1)">▲</span>
        <span class="custom-field-arrow ${i===fields.length-1?'disabled':''}" onclick="moveCustomField('${f.id}',1)">▼</span>
      </div>
      <div class="custom-field-info">
        <div class="integ-name">${escapeHtml(f.label)} <span class="pill pill-status">${CUSTOM_FIELD_TYPE_LABELS[f.type]||f.type}</span>${f.required?' <span class="pill pill-bad">Required</span>':''}</div>
        ${f.type==='select' ? `<div class="integ-desc">${(f.options||[]).length} option${(f.options||[]).length!==1?'s':''}</div>` : ''}
      </div>
      <div class="custom-field-actions">
        <span class="row-link" onclick="openAddCustomFieldModal('${f.id}')">Edit</span>
        <span class="row-link danger-link" onclick="deleteCustomField('${f.id}')">Delete</span>
      </div>
    </div>
  `).join('');
}

async function moveCustomField(fieldId, dir){
  await loadAll();
  const arr = settings.customFields;
  const i = arr.findIndex(f=>f.id===fieldId);
  const j = i + dir;
  if(i<0 || j<0 || j>=arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  const ok = await persistSettings();
  renderCustomFieldsManager();
  if(!ok) showToast('error','Save failed','Could not save the new order — try again.');
}

function customFieldModalHtml(editing){
  return `
    <div class="modal-head"><span class="panel-title">${editing ? 'Edit field' : 'Add field'}</span><span class="toast-close" onclick="closeAppModal()">✕</span></div>
    <div class="modal-body">
      <div class="settings-field"><label>Field label</label><input id="cfLabel" placeholder="e.g. Website" value="${editing?escapeHtml(editing.label):''}"></div>
      <div class="settings-field"><label>Field type</label>
        <select id="cfType" onchange="onCustomFieldTypeChange()">
          ${Object.entries(CUSTOM_FIELD_TYPE_LABELS).map(([val,lbl])=>`<option value="${escapeHtml(val)}" ${editing&&editing.type===val?'selected':''}>${lbl}</option>`).join('')}
        </select>
      </div>
      <div id="cfSelectOptionsWrap" style="display:none;">
        <label style="font-family:var(--font);font-size:10.5px;color:var(--muted);display:block;margin:14px 0 8px;">Dropdown options</label>
        <div id="cfSelectOptionsList" class="options-list"></div>
        <div style="display:flex;gap:8px;margin-top:10px;">
          <input id="cfSelectOptionInput" placeholder="New option" style="flex:1;font-family:var(--font);font-size:13.5px;padding:8px 10px;border-radius:6px;border:1px solid var(--border);">
          <button class="btn btn-outline" onclick="addCustomFieldOptionDraft()">Add</button>
        </div>
      </div>
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:14px;color:var(--ink);margin-top:16px;">
        <input type="checkbox" id="cfRequired" ${editing&&editing.required?'checked':''}>
        Required — can't save a client without this filled in
      </label>
    </div>
    <div class="modal-actions">
      <button class="btn btn-brand" onclick="saveCustomField()">Save field</button>
      <button class="btn btn-outline" onclick="closeAppModal()">Cancel</button>
    </div>`;
}

function openAddCustomFieldModal(fieldId){
  const editing = fieldId ? (settings.customFields||[]).find(f=>f.id===fieldId) : null;
  editingCustomFieldId = fieldId || null;
  customFieldDraftOptions = editing && editing.options ? [...editing.options] : [];
  openAppModal(customFieldModalHtml(editing), 460);
  onCustomFieldTypeChange();
}

function onCustomFieldTypeChange(){
  const type = document.getElementById('cfType').value;
  const wrap = document.getElementById('cfSelectOptionsWrap');
  if(wrap) wrap.style.display = type==='select' ? 'block' : 'none';
  renderCustomFieldOptionsDraft();
}

function renderCustomFieldOptionsDraft(){
  const el = document.getElementById('cfSelectOptionsList');
  if(!el) return;
  el.innerHTML = customFieldDraftOptions.map(o=>`
    <span class="option-chip">${escapeHtml(o)} <span class="option-chip-x" onclick="removeCustomFieldOptionDraft(${jsArg(o)})">✕</span></span>
  `).join('') || `<span style="color:var(--muted-lt);font-size:13px;">No options yet.</span>`;
}

function addCustomFieldOptionDraft(){
  const input = document.getElementById('cfSelectOptionInput');
  const val = input.value.trim();
  if(!val) return;
  if(customFieldDraftOptions.some(o=>o.toLowerCase()===val.toLowerCase())){ showToast('info','Already added', `"${val}" is already in the list.`); return; }
  customFieldDraftOptions.push(val);
  input.value = '';
  renderCustomFieldOptionsDraft();
}

function removeCustomFieldOptionDraft(val){
  customFieldDraftOptions = customFieldDraftOptions.filter(o=>o!==val);
  renderCustomFieldOptionsDraft();
}

async function saveCustomField(){
  const label = document.getElementById('cfLabel').value.trim();
  const type = document.getElementById('cfType').value;
  const required = document.getElementById('cfRequired').checked;
  if(!label){ showToast('error','Name required','Give the field a label first.'); return; }
  if(type==='select' && !customFieldDraftOptions.length){ showToast('error','Add options','A dropdown field needs at least one option.'); return; }
  const btn = clickedBtn();
  setBtnLoading(btn, 'Saving…');
  await loadAll();
  if(editingCustomFieldId){
    const f = settings.customFields.find(x=>x.id===editingCustomFieldId);
    if(f){ f.label = label; f.type = type; f.required = required; f.options = type==='select' ? [...customFieldDraftOptions] : undefined; }
  } else {
    settings.customFields.push({ id:'cf'+Date.now(), label, type, required, options: type==='select' ? [...customFieldDraftOptions] : undefined });
  }
  const ok = await persistSettings();
  restoreBtn(btn);
  closeAppModal();
  renderCustomFieldsManager();
  ok ? showToast('success', editingCustomFieldId?'Field updated':'Field added', `"${label}" is ready to use.`) : showToast('error','Save failed','Could not save — try again.');
}

async function deleteCustomField(fieldId){
  const f = (settings.customFields||[]).find(x=>x.id===fieldId);
  if(!f) return;
  if(!(await confirmDialog(`Remove the "${f.label}" field? It'll disappear from the client form, but any values already saved on clients stay in the data — just hidden.`, {confirmLabel:'Remove'}))) return;
  await loadAll();
  settings.customFields = settings.customFields.filter(x=>x.id!==fieldId);
  const ok = await persistSettings();
  renderCustomFieldsManager();
  ok ? showToast('success','Field removed', `"${f.label}" removed.`) : showToast('error','Save failed','Could not save — try again.');
}

function customFieldInputHtml(field, value){
  const val = value!=null ? String(value) : '';
  const escVal = val.replace(/"/g,'&quot;');
  const id = 'ncCustom_'+field.id;
  const labelHtml = field.required ? `${escapeHtml(field.label)} <span style="color:var(--red);">*</span>` : field.label;
  if(field.type==='select'){
    const opts = `<option value="">—</option>` + (field.options||[]).map(o=>`<option value="${escapeHtml(o)}" ${val===o?'selected':''}>${escapeHtml(o)}</option>`).join('');
    return `<div><label>${labelHtml}</label><select id="${id}">${opts}</select></div>`;
  }
  if(field.type==='textarea'){
    return `<div style="grid-column:1/-1;"><label>${labelHtml}</label><textarea spellcheck="true" id="${id}" style="width:100%;min-height:70px;font-family:var(--font);font-size:14px;padding:9px 11px;border-radius:6px;border:1px solid var(--border);box-sizing:border-box;">${escapeHtml(val)}</textarea></div>`;
  }
  const htmlType = { text:'text', url:'url', email:'email', phone:'tel', number:'number' }[field.type] || 'text';
  return `<div><label>${labelHtml}</label><input type="${htmlType}" id="${id}" value="${escVal}" placeholder="${escapeHtml(field.label)}"></div>`;
}

function customFieldsFormHtml(existingValues){
  const fields = settings.customFields || [];
  if(!fields.length) return '';
  const values = existingValues || {};
  return fields.map(f=>customFieldInputHtml(f, values[f.id])).join('');
}
