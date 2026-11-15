// Shared modal (open/close, focus trap), confirm dialog, mail modal helpers.

// Generic modal shell — used for the send-email modal and the queue card detail modal.
let modalPreviousFocus = null;

function getModalFocusableElements(overlay){
  return [...overlay.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter(el => el.offsetParent !== null);
}

function handleModalKeydown(e){
  const overlay = document.getElementById('appModalOverlay');
  if(!overlay) return;
  if(e.key==='Escape'){ closeAppModal(); return; }
  if(e.key!=='Tab') return;
  const focusable = getModalFocusableElements(overlay);
  if(!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length-1];
  if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
  else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
}

function openAppModal(innerHtml, maxWidth){
  closeAppModal();
  modalPreviousFocus = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'appModalOverlay';
  overlay.onclick = (e)=>{ if(e.target===overlay) closeAppModal(); };
  overlay.addEventListener('keydown', handleModalKeydown);
  overlay.innerHTML = `<div class="modal-card" style="max-width:${maxWidth||520}px;">${innerHtml}</div>`;
  document.body.appendChild(overlay);
  setTimeout(()=>{
    const focusable = getModalFocusableElements(overlay);
    if(focusable.length) focusable[0].focus();
  }, 10);
}

function closeAppModal(){
  const el = document.getElementById('appModalOverlay');
  if(el) el.remove();
  // Any open date-picker calendar dropdown gets moved to document.body
  // when opened (see toggleDatePickerCalendar) so position:fixed can
  // escape .modal-card's overflow-y:auto cleanly in every browser — some
  // browsers still clip a fixed-position element that's nested inside a
  // scrolling ancestor, even though the spec says they shouldn't. Once
  // moved, it's no longer inside appModalOverlay and wouldn't get cleaned
  // up by the .remove() above, so every one of these needs its own
  // explicit removal here.
  document.querySelectorAll('body > .calendar-dropdown').forEach(el=>el.remove());
  if(modalPreviousFocus && typeof modalPreviousFocus.focus==='function'){
    modalPreviousFocus.focus();
    modalPreviousFocus = null;
  }
}

// Async, in-app replacement for the browser's native confirm() — same
// call shape (returns a boolean, "did they confirm"), but styled to match
// the rest of the app instead of an unstyled native browser popup.
//
// Deliberately its own, completely independent overlay — NOT built on
// openAppModal()/closeAppModal(). Those always tear down whatever modal
// is currently open before showing anything new, which silently destroyed
// the parent modal for any confirmation triggered from within one (e.g.
// deleting a row from an already-open client detail view) — the delete
// itself was actually succeeding, but the parent modal never came back
// afterward, which looked exactly like "nothing happened." This overlay
// stacks visually on top (higher z-index) instead, leaving whatever was
// already open completely untouched underneath, then simply removes
// itself when done — the parent modal was never modified at all.
function confirmDialog(message, options){
  options = options || {};
  const destructive = !!options.destructive;
  const confirmLabel = options.confirmLabel || 'OK';
  const cancelLabel = options.cancelLabel || 'Cancel';
  const title = /\?\s*$/.test(confirmLabel) ? confirmLabel : `${confirmLabel}?`;

  return new Promise(resolve=>{
    const previousFocus = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.zIndex = '1100'; // above the regular .modal-overlay (1000) — stacks on top rather than replacing it
    overlay.innerHTML = `
      <div class="modal-card" style="max-width:380px;padding:26px 24px 22px;">
        <div style="width:44px;height:44px;border-radius:50%;background:${destructive ? 'var(--red-bg)' : 'var(--brand-bg)'};color:${destructive ? 'var(--red)' : 'var(--brand-dark)'};display:flex;align-items:center;justify-content:center;margin:0 auto 14px;">
          ${destructive
            ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'
            : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'}
        </div>
        <div style="text-align:center;font-size:16px;font-weight:700;color:var(--ink);margin-bottom:8px;">${escapeHtml(title)}</div>
        <div style="text-align:center;font-size:13px;color:var(--muted-lt);line-height:1.55;white-space:pre-wrap;margin-bottom:20px;">${escapeHtml(message)}</div>
        <div style="display:flex;gap:10px;justify-content:center;">
          <button class="btn btn-outline" id="confirmDialogCancelBtn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px;vertical-align:-2px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>${escapeHtml(cancelLabel)}</button>
          <button class="btn ${destructive ? 'btn-outline' : 'btn-brand'}" ${destructive ? 'style="color:var(--red);border-color:var(--red-bg);"' : ''} id="confirmDialogOkBtn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px;vertical-align:-2px;">${destructive ? '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>' : '<polyline points="20 6 9 17 4 12"/>'}</svg>${escapeHtml(confirmLabel)}</button>
        </div>
      </div>`;

    function finish(result){
      overlay.remove();
      document.removeEventListener('keydown', onKeydown);
      if(previousFocus && typeof previousFocus.focus==='function') previousFocus.focus();
      resolve(result);
    }
    overlay.onclick = (e)=>{ if(e.target===overlay) finish(false); };
    function onKeydown(e){ if(e.key==='Escape') finish(false); }
    document.addEventListener('keydown', onKeydown);

    document.body.appendChild(overlay);
    document.getElementById('confirmDialogOkBtn').onclick = ()=> finish(true);
    document.getElementById('confirmDialogCancelBtn').onclick = ()=> finish(false);
    setTimeout(()=> document.getElementById('confirmDialogOkBtn')?.focus(), 10);
  });
}

function copyMailModalBody(){
  const ta = document.getElementById('mailModalBody');
  const subj = document.getElementById('mailModalSubject').value;
  const full = `Subject: ${subj}\n\n${ta.value}`;
  const btn = document.getElementById('mailModalCopyBtn');
  ta.focus(); ta.select(); ta.setSelectionRange(0, 999999);
  let copied = false;
  try{ copied = document.execCommand('copy'); }catch(e){ copied = false; }
  if(copied){ btn.textContent = 'Copied ✓'; setTimeout(()=>btn.textContent='Copy details', 2000); return; }
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(full).then(()=>{
      btn.textContent = 'Copied ✓'; setTimeout(()=>btn.textContent='Copy details', 2000);
    }).catch(()=>{ btn.textContent = 'Select the text above (Ctrl/Cmd+C)'; });
  } else { btn.textContent = 'Select the text above (Ctrl/Cmd+C)'; }
}
