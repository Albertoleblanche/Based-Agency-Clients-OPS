// File attachments on notes and tasks, image lightbox.

/* ---------- Attachments — notes and tasks. Files live in a private
   storage bucket; access mirrors exactly who can already see the note or
   task, enforced by storage RLS, not just hidden in the UI. Viewing and
   downloading go through short-lived signed URLs, generated on demand. ---------- */

const ATTACHMENT_IMAGE_EXT = ['jpg','jpeg','png','gif','webp','svg','bmp'];

function isImageAttachment(att){
  const ext = (att.name.split('.').pop()||'').toLowerCase();
  return ATTACHMENT_IMAGE_EXT.includes(ext);
}

function formatFileSize(bytes){
  if(!bytes) return '';
  if(bytes < 1024) return bytes+' B';
  if(bytes < 1024*1024) return (bytes/1024).toFixed(0)+' KB';
  return (bytes/1024/1024).toFixed(1)+' MB';
}

async function addAttachmentToRecord(recordType, recordId, file){
  if(!file) return;
  if(file.size > 10*1024*1024){ showToast('error','Too large','Files need to be under 10MB.'); return; }
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
  const path = `${recordType}s/${recordId}/${Date.now()}-${safeName}`;
  const { error: uploadErr } = await supabaseClient.storage.from('attachments').upload(path, file);
  if(uploadErr){ showToast('error','Upload failed', uploadErr.message); return; }

  const table = recordType==='note' ? 'notes' : 'tasks';
  const { data: current } = await supabaseClient.from(table).select('attachments').eq('id', recordId).maybeSingle();
  const updated = [...(current?.attachments||[]), { name:file.name, path, size:file.size, type:file.type, uploadedAt:new Date().toISOString() }];
  const { error } = await supabaseClient.from(table).update({ attachments: updated }).eq('id', recordId);
  if(error){ showToast('error','Save failed', error.message); return; }

  if(recordType==='note'){ await loadMyNotes(); renderNotes(); } else { await loadMyTasks(); renderTasks(); }
  renderAttachmentsInModal(recordType, recordId);
  showToast('success','File attached', file.name);
}

async function removeAttachmentFromRecord(recordType, recordId, path){
  if(!(await confirmDialog('Remove this attachment? This can\'t be undone.', {confirmLabel:'Remove', destructive:true}))) return;
  const table = recordType==='note' ? 'notes' : 'tasks';
  await supabaseClient.storage.from('attachments').remove([path]);
  const { data: current } = await supabaseClient.from(table).select('attachments').eq('id', recordId).maybeSingle();
  const updated = (current?.attachments||[]).filter(a=>a.path!==path);
  const { error } = await supabaseClient.from(table).update({ attachments: updated }).eq('id', recordId);
  if(error){ showToast('error','Save failed', error.message); return; }
  if(recordType==='note'){ await loadMyNotes(); renderNotes(); } else { await loadMyTasks(); renderTasks(); }
  renderAttachmentsInModal(recordType, recordId);
  showToast('success','Removed','Attachment deleted.');
}

async function renderAttachmentsInModal(recordType, recordId){
  const el = document.getElementById('attachmentsList');
  if(!el) return;
  el.innerHTML = `${loadingStateHtml('Loading…')}`;
  const record = recordType==='note' ? notes.find(n=>n.id===recordId) : tasks.find(t=>t.id===recordId);
  const attachments = record?.attachments || [];
  if(!attachments.length){ el.innerHTML = `<div class="empty" style="padding:10px 0;">No files attached yet.</div>`; return; }

  const withUrls = await Promise.all(attachments.map(async a=>{
    const { data } = await supabaseClient.storage.from('attachments').createSignedUrl(a.path, 3600);
    return { ...a, url: data?.signedUrl || null };
  }));

  el.innerHTML = `<div class="attachments-grid">${withUrls.map(a=>attachmentItemHtml(a, recordType, recordId)).join('')}</div>`;
}

function attachmentItemHtml(a, recordType, recordId){
  const isImg = isImageAttachment(a);
  const sizeStr = formatFileSize(a.size);
  const body = isImg && a.url
    ? `<img src="${safeUrl(a.url)}" class="attachment-thumb" onclick="openImageLightbox(${jsArg(a.url)}, ${jsArg(a.name)})">`
    : `<div class="attachment-file-icon">📄</div>`;
  return `<div class="attachment-item">
    ${body}
    <div class="attachment-meta">
      <span class="attachment-name" title="${escapeHtml(a.name)}">${escapeHtml(a.name)}</span>
      <span class="attachment-size">${sizeStr}</span>
    </div>
    <div class="attachment-actions">
      ${a.url ? `<a href="${safeUrl(a.url)}" download="${escapeHtml(a.name)}" class="row-link">Download</a>` : `<span></span>`}
      <span class="row-link danger-link" onclick="removeAttachmentFromRecord('${recordType}','${recordId}',${jsArg(a.path)})">Remove</span>
    </div>
  </div>`;
}

// ---- Picture viewer (Nov 23) ------------------------------------------------------------------
// Opens a picture over the app, Quick Look style. Esc, × or a click beside the picture closes it;
// ← → (or the side buttons) step through the other pictures in `set` ([{ url, name }]); a picture
// bigger than the window opens at full size on click, scrolled to where you clicked. Download
// saves it under its own name (a Supabase signed link gets ?download= so it saves, not opens).
let qv = null;
function qvDownloadUrl(url, name){
  return /\/storage\/v1\/object\/sign\//.test(url) ? url + (url.includes('?') ? '&' : '?') + 'download=' + encodeURIComponent(name || '') : url;
}
function openImageLightbox(url, filename, set){
  closeLightbox(true);
  const list = (set && set.length ? set : [{ url, name: filename }]).filter(x => x && x.url);
  let at = list.findIndex(x => x.url === url);
  if(at < 0){ list.unshift({ url, name: filename }); at = 0; }
  const many = list.length > 1;
  const el = document.createElement('div');
  el.className = 'qv'; el.id = 'lightboxOverlay';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Picture'); el.tabIndex = -1;
  el.innerHTML = `<div class="qv-bar"><span class="qv-n"></span>${many ? '<span class="qv-c"></span>' : ''}<a class="qv-b qv-dl" target="_blank" rel="noopener">${icon('download-simple')}Download</a><button type="button" class="qv-b qv-x" aria-label="Close" onclick="closeLightbox()">${icon('x')}</button></div>
<div class="qv-stage"><img class="qv-img" id="lightboxImg" alt=""><p class="qv-err" hidden>This picture didn’t load. <a target="_blank" rel="noopener">Open it in a new tab</a></p></div>
${many ? `<button type="button" class="qv-nav prev" aria-label="Previous picture" onclick="qvStep(-1)">${icon('caret-left')}</button><button type="button" class="qv-nav next" aria-label="Next picture" onclick="qvStep(1)">${icon('caret-right')}</button>` : ''}`;
  el.addEventListener('click', e => { if(e.target === el || e.target.classList.contains('qv-stage') || e.target.classList.contains('qv-bar')) closeLightbox(); });
  const img = el.querySelector('.qv-img');
  img.addEventListener('load', () => {
    el.querySelector('.qv-stage').classList.remove('is-loading');
    img.classList.add('is-loaded');
    requestAnimationFrame(() => img.classList.toggle('can-zoom', img.naturalWidth > img.clientWidth + 2 || img.naturalHeight > img.clientHeight + 2));
  });
  img.addEventListener('error', () => { el.querySelector('.qv-stage').classList.remove('is-loading'); el.querySelector('.qv-err').hidden = false; img.hidden = true; });
  img.addEventListener('click', qvZoom);
  document.body.appendChild(el);
  qv = { el, list, at, back: document.activeElement };
  document.addEventListener('keydown', qvKey, true);
  qvShow();
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-in')));
  el.focus({ preventScroll: true });
}
function qvShow(){
  if(!qv) return;
  const { el, list, at } = qv, it = list[at], img = el.querySelector('.qv-img'), stage = el.querySelector('.qv-stage');
  el.classList.remove('is-full');
  el.querySelector('.qv-n').textContent = it.name || '';
  const c = el.querySelector('.qv-c'); if(c) c.textContent = `${at + 1} of ${list.length}`;
  const dl = el.querySelector('.qv-dl'); dl.href = qvDownloadUrl(it.url, it.name); dl.setAttribute('download', it.name || '');
  el.querySelector('.qv-err a').href = it.url; el.querySelector('.qv-err').hidden = true;
  img.hidden = false; img.classList.remove('is-loaded', 'can-zoom'); stage.classList.add('is-loading');
  img.alt = it.name || ''; img.src = it.url;
}
function qvStep(d){
  if(!qv || qv.list.length < 2) return;
  qv.at = (qv.at + d + qv.list.length) % qv.list.length;
  qvShow();
}
function qvZoom(e){
  if(!qv) return;
  const { el } = qv, img = el.querySelector('.qv-img'), stage = el.querySelector('.qv-stage');
  if(!img.classList.contains('can-zoom') && !el.classList.contains('is-full')) return;
  const r = img.getBoundingClientRect(), rx = (e.clientX - r.left) / r.width, ry = (e.clientY - r.top) / r.height;
  el.classList.toggle('is-full');
  if(el.classList.contains('is-full')){
    stage.scrollLeft = rx * img.offsetWidth - stage.clientWidth / 2;
    stage.scrollTop = ry * img.offsetHeight - stage.clientHeight / 2;
  }
}
function qvKey(e){
  if(!qv) return;
  if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); closeLightbox(); }
  else if(e.key === 'ArrowLeft' || e.key === 'ArrowRight'){ e.preventDefault(); e.stopPropagation(); qvStep(e.key === 'ArrowLeft' ? -1 : 1); }
  else if(e.key === 'Tab'){ // keep focus on the viewer's own buttons
    const f = [...qv.el.querySelectorAll('a[href], button')].filter(x => !x.closest('[hidden]'));
    const i = f.indexOf(document.activeElement);
    if(i < 0 || (e.shiftKey ? i === 0 : i === f.length - 1)){ e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0]?.focus(); }
  }
}
function closeLightbox(now){
  document.removeEventListener('keydown', qvKey, true);
  const cur = qv; qv = null;
  document.querySelectorAll('#lightboxOverlay').forEach(el => {
    if(now === true || matchMedia('(prefers-reduced-motion: reduce)').matches){ el.remove(); return; }
    el.id = ''; el.classList.remove('is-in'); el.classList.add('is-out');
    setTimeout(() => el.remove(), 160);
  });
  if(cur && cur.back && cur.back.isConnected && now !== true) cur.back.focus({ preventScroll: true });
}
function toggleLightboxZoom(){ const img = document.querySelector('#lightboxOverlay .qv-img'); if(img) img.click(); }
