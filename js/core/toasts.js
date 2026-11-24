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
  // Anchored at the bottom of the window (Nov 24): older cards sit above the newest and fan out upward,
  // so on hover they open into view instead of running off the bottom edge.
  const dir = -1;
  const front = toasts[toasts.length - 1];
  if(!front){ stack.style.height = ''; stack.classList.remove('is-open'); return; }

  if(toastStackExpanded){
    // Every card full size and readable, each spaced by its own height (cards vary with their text).
    // The stack itself takes the whole height, so moving between cards doesn't close it.
    let offset = 0;
    const gap = 10, room = Math.max(160, window.innerHeight - 120);
    for(let i = toasts.length - 1, depth = 0; i >= 0; i--, depth++){
      const el = toasts[i];
      el.classList.remove('toast-behind');
      el.style.height = '';
      el.style.zIndex = String(1000 - depth);
      const h = el.offsetHeight, fits = offset + h <= room || depth === 0;
      el.style.pointerEvents = fits ? 'auto' : 'none';
      el.style.opacity = fits ? '1' : '0';
      el.style.transform = `translateY(${dir * offset}px) scale(1)`;
      if(fits) offset += h + gap;
    }
    stack.style.height = Math.max(0, offset - gap) + 'px';
    stack.classList.add('is-open');
    return;
  }

  // Newest in front; the ones behind take its height and hide their text, so only their edges show.
  front.classList.remove('toast-behind'); front.style.height = '';
  const frontHeight = front.offsetHeight;
  stack.style.height = frontHeight + 'px';
  stack.classList.remove('is-open');
  for(let i = toasts.length - 1, depthFromFront = 0; i >= 0; i--, depthFromFront++){
    const el = toasts[i];
    el.classList.toggle('toast-behind', depthFromFront > 0);
    el.style.height = depthFromFront > 0 ? frontHeight + 'px' : '';
    const depth = Math.min(depthFromFront, TOAST_STACK_MAX_VISIBLE);
    el.style.zIndex = String(1000 - depthFromFront);
    // the cards behind take the pointer too, so hovering their edge opens the stack
    el.style.pointerEvents = depthFromFront > TOAST_STACK_MAX_VISIBLE ? 'none' : 'auto';
    const beyondMax = depthFromFront > TOAST_STACK_MAX_VISIBLE;
    el.style.opacity = beyondMax ? '0' : (1 - depth * 0.12).toFixed(2);
    el.style.transform = `translateY(${dir * depth * 9}px) scale(${(1 - depth * 0.05).toFixed(3)})`;
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

// Lucide, like the rest of the window: a check for done, a triangle for a problem, an i for news.
function toastIconHtml(type){
  const name = { error: 'triangle-alert', warning: 'triangle-alert', info: 'info', cancel: 'circle' }[type] || 'circle-check';
  return typeof icon === 'function' ? icon(name) : '';
}

// opts.action / opts.onAction: one button beside the close (Undo after a delete); it stays a little longer.
function showToast(type, title, detail, opts){
  const stack = document.getElementById('toastStack');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  const icons = {
    error: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18" /> <path d="m6 6 12 12" /></svg>',
    info: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /> <path d="M12 16v-4" /> <path d="M12 8h.01" /></svg>',
    warning: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /> <path d="M12 16v-4" /> <path d="M12 8h.01" /></svg>',
    cancel: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /> <path d="M4.929 4.929 19.07 19.071" /></svg>',
  };
  const ic = toastIconHtml(type);
  el.innerHTML = `<span class="toast-icon">${ic}</span><span class="toast-text"><b class="toast-t">${escapeHtml(title)}</b>${detail?escapeHtml(detail):''}</span>${opts && opts.action ? `<button type="button" class="toast-act">${escapeHtml(opts.action)}</button>` : ''}<span class="toast-close" onclick="dismissToastEl(this.parentElement)">✕</span><span class="toast-progress"></span>`;
  // Starting state for the entrance transition — appended off-screen and
  // invisible, then restackToasts() (called one paint frame later) sets
  // the real target position, which the CSS transition animates into.
  // Skipping straight to appendChild + restackToasts() in the same tick
  // would mean the browser never paints this starting state at all, so
  // there'd be nothing for the transition to animate from.
  el.style.opacity = '0';
  el.style.transform = 'translateY(14px) scale(.97)';
  stack.appendChild(el);
  requestAnimationFrame(()=> requestAnimationFrame(restackToasts));
  const act = el.querySelector('.toast-act');
  if(act) act.addEventListener('click', e => { e.stopPropagation(); act.disabled = true; dismissToastEl(el); try{ opts.onAction(); }catch(err){ console.error('toast action', err); } });

  // Hover pauses both the visible progress bar and the actual dismiss
  // timer together — reading a toast shouldn't cost you the chance to
  // finish reading it. remaining/lastStart track how much time was left
  // so resuming continues from there instead of restarting the full 4.2s.
  // Exposed on the element itself (not just private to this closure) so
  // the stack-wide hover-to-expand handler can pause/resume every toast
  // in the stack, not just whichever one the cursor happens to be over.
  const duration = opts && opts.duration ? opts.duration : opts && opts.action ? 9000 : 6000;   // Nov 24: long enough to read (was 4.2 s)
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
    error: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18" /> <path d="m6 6 12 12" /></svg>',
    info: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /> <path d="M12 16v-4" /> <path d="M12 8h.01" /></svg>',
    warning: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /> <path d="M12 16v-4" /> <path d="M12 8h.01" /></svg>',
    cancel: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /> <path d="M4.929 4.929 19.07 19.071" /></svg>',
  };
  const ic = toastIconHtml(type);
  const copyId = 'copytext-' + Date.now();
  el.innerHTML = `<span class="toast-icon">${ic}</span><span class="toast-text"><b class="toast-t">${escapeHtml(title)}</b>${escapeHtml(detail)}<br><textarea class="toast-copy-area" id="${copyId}" readonly>${escapeHtml(copyText)}</textarea><span class="row-link" style="font-size:12.5px;" onclick="copyToastText('${copyId}', this)">Copy details</span></span><span class="toast-close" onclick="dismissToastEl(this.parentElement)">✕</span>`;
  el.style.opacity = '0';
  el.style.transform = 'translateY(14px) scale(.97)';
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
