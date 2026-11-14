// Toast notifications (stacked, hover-to-pause) and app-wide defaults.

// Apple-style compact stack: only the front (newest) toast is fully
// visible — older ones progressively shrink, fade, and offset behind it,
// just enough to signal "more are here" without listing every one at
// full size. Recomputed on every add/remove so the shift between
// positions is always animated via the CSS transition on .toast, never a
// hard jump. Anything deeper than TOAST_STACK_MAX_VISIBLE stays in the
// DOM (still running its own dismiss timer) but fully invisible until
// it's shallow enough to actually show.
const TOAST_STACK_MAX_VISIBLE = 3;
let toastStackExpanded = false;

function restackToasts(){
  const stack = document.getElementById('toastStack');
  if(!stack) return;
  const toasts = [...stack.children].filter(el=>el.classList.contains('toast') && !el.classList.contains('leaving'));
  const dir = -1; // both themes now anchor at the bottom — older toasts always stack upward, away from the bottom edge

  if(toastStackExpanded){
    // Every toast becomes fully visible, full size, and individually
    // interactive — spaced out by each one's own actual measured height
    // (not a fixed offset per position), since toasts vary in length
    // depending on their content.
    let cumulativeOffset = 0;
    const gap = 10;
    for(let i = toasts.length - 1, depthFromFront = 0; i >= 0; i--, depthFromFront++){
      const el = toasts[i];
      el.style.zIndex = String(1000 - depthFromFront);
      el.style.pointerEvents = 'auto';
      el.style.opacity = '1';
      el.style.transform = `translateY(${dir * cumulativeOffset}px) scale(1)`;
      cumulativeOffset += el.offsetHeight + gap;
    }
    return;
  }

  // Newest toast is always the most recently appended (last child) —
  // walk from the end backward to assign depth-from-front correctly.
  for(let i = toasts.length - 1, depthFromFront = 0; i >= 0; i--, depthFromFront++){
    const el = toasts[i];
    const depth = Math.min(depthFromFront, TOAST_STACK_MAX_VISIBLE);
    el.style.zIndex = String(1000 - depthFromFront);
    el.style.pointerEvents = depthFromFront === 0 ? 'auto' : 'none';
    const beyondMax = depthFromFront > TOAST_STACK_MAX_VISIBLE;
    el.style.opacity = beyondMax ? '0' : (1 - depth * 0.22).toFixed(2);
    el.style.transform = `translateY(${dir * depth * 10}px) scale(${(1 - depth * 0.055).toFixed(3)})`;
  }
}

// Single, shared exit path — fades out and immediately restacks whatever
// remains (so the rest of the stack visibly shifts forward while this one
// is still fading, rather than waiting for it to fully disappear first),
// then removes the element once the transition has actually finished.
function dismissToastEl(el){
  if(!el || el.classList.contains('leaving')) return;
  el.classList.add('leaving');
  el.style.pointerEvents = 'none';
  el.style.opacity = '0';
  restackToasts();
  setTimeout(()=>{ if(el.parentElement) el.remove(); }, 280);
}

function showToast(type, title, detail){
  const stack = document.getElementById('toastStack');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  const icons = {
    error: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    info: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    warning: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    cancel: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
  };
  const icon = icons[type] || '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
  el.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-text"><b>${escapeHtml(title)}</b>${detail?escapeHtml(detail):''}</span><span class="toast-close" onclick="dismissToastEl(this.parentElement)">✕</span><span class="toast-progress"></span>`;
  // Starting state for the entrance transition — appended off-screen and
  // invisible, then restackToasts() (called one paint frame later) sets
  // the real target position, which the CSS transition animates into.
  // Skipping straight to appendChild + restackToasts() in the same tick
  // would mean the browser never paints this starting state at all, so
  // there'd be nothing for the transition to animate from.
  el.style.opacity = '0';
  el.style.transform = 'scale(.94)';
  stack.appendChild(el);
  requestAnimationFrame(()=> requestAnimationFrame(restackToasts));

  // Hover pauses both the visible progress bar and the actual dismiss
  // timer together — reading a toast shouldn't cost you the chance to
  // finish reading it. remaining/lastStart track how much time was left
  // so resuming continues from there instead of restarting the full 4.2s.
  // Exposed on the element itself (not just private to this closure) so
  // the stack-wide hover-to-expand handler can pause/resume every toast
  // in the stack, not just whichever one the cursor happens to be over.
  const duration = 4200;
  let remaining = duration;
  let lastStart = Date.now();
  let dismissTimer = setTimeout(()=>dismissToastEl(el), duration);

  el._pauseTimer = ()=>{
    clearTimeout(dismissTimer);
    remaining -= (Date.now() - lastStart);
    el.classList.add('paused');
  };
  el._resumeTimer = ()=>{
    lastStart = Date.now();
    dismissTimer = setTimeout(()=>dismissToastEl(el), Math.max(remaining, 0));
    el.classList.remove('paused');
  };
  el.addEventListener('mouseenter', el._pauseTimer);
  el.addEventListener('mouseleave', el._resumeTimer);
}

// Same as showToast, but stays on screen with a "Copy" button — used as a
// fallback wherever a mailto link might silently fail to open (no default
// mail app registered, or a restricted browser environment).
function showToastWithCopy(type, title, detail, copyText){
  const stack = document.getElementById('toastStack');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  const icons = {
    error: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    info: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    warning: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    cancel: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
  };
  const icon = icons[type] || '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
  const copyId = 'copytext-' + Date.now();
  el.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-text"><b>${escapeHtml(title)}</b>${escapeHtml(detail)}<br><textarea class="toast-copy-area" id="${copyId}" readonly>${escapeHtml(copyText)}</textarea><span class="row-link" style="font-size:11.5px;" onclick="copyToastText('${copyId}', this)">Copy details</span></span><span class="toast-close" onclick="dismissToastEl(this.parentElement)">✕</span>`;
  el.style.opacity = '0';
  el.style.transform = 'scale(.94)';
  stack.appendChild(el);
  requestAnimationFrame(()=> requestAnimationFrame(restackToasts));
}

function copyToastText(id, linkEl){
  const ta = document.getElementById(id);
  ta.removeAttribute('readonly');
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, 999999);

  let copiedSync = false;
  try{ copiedSync = document.execCommand('copy'); }catch(e){ copiedSync = false; }
  ta.setAttribute('readonly', 'readonly');

  if(copiedSync){
    linkEl.textContent = 'Copied ✓';
    setTimeout(()=>{ linkEl.textContent = 'Copy details'; }, 2000);
    return;
  }

  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(ta.value).then(()=>{
      linkEl.textContent = 'Copied ✓';
      setTimeout(()=>{ linkEl.textContent = 'Copy details'; }, 2000);
    }).catch(()=>{
      linkEl.textContent = 'Copy blocked — select text above (Ctrl/Cmd+C)';
    });
  } else {
    linkEl.textContent = 'Copy blocked — select text above (Ctrl/Cmd+C)';
  }
}
