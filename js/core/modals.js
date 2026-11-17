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
  if(el){
    // Out the way it came in: the sheet lifts and fades while the dimming clears.
    el.id = ''; el.style.pointerEvents = 'none';
    const card = el.querySelector('.modal-card');
    if(typeof animateThen === 'function'){
      animateThen(el, [{ opacity: 1 }, { opacity: 0 }], 180, 'ease-out', () => el.remove());
      if(card) card.animate?.([{ transform: 'none', opacity: 1 }, { transform: 'translateY(-10px) scale(.98)', opacity: 0 }], { duration: 160, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
    } else el.remove();
  }
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
            ? '<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z"/></svg>'
            : '<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm16-40a8,8,0,0,1-8,8,16,16,0,0,1-16-16V128a8,8,0,0,1,0-16,16,16,0,0,1,16,16v40A8,8,0,0,1,144,176ZM112,84a12,12,0,1,1,12,12A12,12,0,0,1,112,84Z"/></svg>'}
        </div>
        <div style="text-align:center;font-size:16px;font-weight:700;color:var(--ink);margin-bottom:8px;">${escapeHtml(title)}</div>
        <div style="text-align:center;font-size:13px;color:var(--muted-lt);line-height:1.55;white-space:pre-wrap;margin-bottom:20px;">${escapeHtml(message)}</div>
        <div style="display:flex;gap:10px;justify-content:center;">
          <button class="btn btn-outline" id="confirmDialogCancelBtn"><svg width="14" height="14" viewBox="0 0 256 256" style="margin-right:6px;vertical-align:-2px;" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"/></svg>${escapeHtml(cancelLabel)}</button>
          <button class="btn ${destructive ? 'btn-outline' : 'btn-brand'}" ${destructive ? 'style="color:var(--red);border-color:var(--red-bg);"' : ''} id="confirmDialogOkBtn"><svg width="14" height="14" viewBox="0 0 256 256" style="margin-right:6px;vertical-align:-2px;" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round">${destructive ? '<path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z"/>' : '<path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z"/>'}</svg>${escapeHtml(confirmLabel)}</button>
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
