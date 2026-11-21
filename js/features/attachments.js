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

function openImageLightbox(url, filename){
  closeLightbox();
  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';
  overlay.id = 'lightboxOverlay';
  overlay.onclick = (e)=>{ if(e.target===overlay) closeLightbox(); };
  overlay.innerHTML = `
    <div class="lightbox-toolbar">
      <a href="${safeUrl(url)}" download="${escapeHtml(filename)}" class="btn btn-outline">Download</a>
      <button class="btn btn-outline" onclick="closeLightbox()">Close ✕</button>
    </div>
    <img src="${safeUrl(url)}" class="lightbox-img" id="lightboxImg" onclick="toggleLightboxZoom()" title="Click to zoom">`;
  document.body.appendChild(overlay);
}

function closeLightbox(){
  const el = document.getElementById('lightboxOverlay');
  if(el) el.remove();
}

function toggleLightboxZoom(){
  const img = document.getElementById('lightboxImg');
  if(img) img.classList.toggle('zoomed');
}
