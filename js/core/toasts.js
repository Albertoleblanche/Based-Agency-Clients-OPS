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
  const dir = 1; // anchored top-right like macOS notifications — older toasts stack downward, away from the top edge

  if(toastStackExpanded){
    // Every toast becomes fully visible, full size, and individually
    // interactive — spaced out by each one's own actual measured height
    // (not a fixed offset per position), since toasts vary in length
    // depending on their content.
    let cumulativeOffset = 0;
    const gap = 10;
    for(let i = toasts.length - 1, depthFromFront = 0; i >= 0; i--, depthFromFront++){
      const el = toasts[i];
      el.classList.remove('behind');
      el.style.height = '';
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
  // Cards behind the front one take its height and hide their content,
  // so only their edges peek out — a long older toast never shows its
  // text below a short new one.
  const front = toasts[toasts.length - 1];
  if(front){ front.classList.remove('behind'); front.style.height = ''; }
  const frontHeight = front ? front.offsetHeight : 0;
  for(let i = toasts.length - 1, depthFromFront = 0; i >= 0; i--, depthFromFront++){
    const el = toasts[i];
    el.classList.toggle('behind', depthFromFront > 0);
    el.style.height = depthFromFront > 0 ? frontHeight + 'px' : '';
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
    error: '<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M208.49,191.51a12,12,0,0,1-17,17L128,145,64.49,208.49a12,12,0,0,1-17-17L111,128,47.51,64.49a12,12,0,0,1,17-17L128,111l63.51-63.52a12,12,0,0,1,17,17L145,128Z"/></svg>',
    info: '<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M108,84a16,16,0,1,1,16,16A16,16,0,0,1,108,84Zm128,44A108,108,0,1,1,128,20,108.12,108.12,0,0,1,236,128Zm-24,0a84,84,0,1,0-84,84A84.09,84.09,0,0,0,212,128Zm-72,36.68V132a20,20,0,0,0-20-20,12,12,0,0,0-4,23.32V168a20,20,0,0,0,20,20,12,12,0,0,0,4-23.32Z"/></svg>',
    warning: '<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M240.26,186.1,152.81,34.23h0a28.74,28.74,0,0,0-49.62,0L15.74,186.1a27.45,27.45,0,0,0,0,27.71A28.31,28.31,0,0,0,40.55,228h174.9a28.31,28.31,0,0,0,24.79-14.19A27.45,27.45,0,0,0,240.26,186.1Zm-20.8,15.7a4.46,4.46,0,0,1-4,2.2H40.55a4.46,4.46,0,0,1-4-2.2,3.56,3.56,0,0,1,0-3.73L124,46.2a4.77,4.77,0,0,1,8,0l87.44,151.87A3.56,3.56,0,0,1,219.46,201.8ZM116,136V104a12,12,0,0,1,24,0v32a12,12,0,0,1-24,0Zm28,40a16,16,0,1,1-16-16A16,16,0,0,1,144,176Z"/></svg>',
    cancel: '<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M128,20A108,108,0,1,0,236,128,108.12,108.12,0,0,0,128,20Zm84,108a83.6,83.6,0,0,1-16.75,50.28L77.72,60.75A84,84,0,0,1,212,128ZM44,128A83.6,83.6,0,0,1,60.75,77.72L178.28,195.25A84,84,0,0,1,44,128Z"/></svg>',
  };
  const icon = icons[type] || '<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M232.49,80.49l-128,128a12,12,0,0,1-17,0l-56-56a12,12,0,1,1,17-17L96,183,215.51,63.51a12,12,0,0,1,17,17Z"/></svg>';
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
    error: '<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M208.49,191.51a12,12,0,0,1-17,17L128,145,64.49,208.49a12,12,0,0,1-17-17L111,128,47.51,64.49a12,12,0,0,1,17-17L128,111l63.51-63.52a12,12,0,0,1,17,17L145,128Z"/></svg>',
    info: '<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M108,84a16,16,0,1,1,16,16A16,16,0,0,1,108,84Zm128,44A108,108,0,1,1,128,20,108.12,108.12,0,0,1,236,128Zm-24,0a84,84,0,1,0-84,84A84.09,84.09,0,0,0,212,128Zm-72,36.68V132a20,20,0,0,0-20-20,12,12,0,0,0-4,23.32V168a20,20,0,0,0,20,20,12,12,0,0,0,4-23.32Z"/></svg>',
    warning: '<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M240.26,186.1,152.81,34.23h0a28.74,28.74,0,0,0-49.62,0L15.74,186.1a27.45,27.45,0,0,0,0,27.71A28.31,28.31,0,0,0,40.55,228h174.9a28.31,28.31,0,0,0,24.79-14.19A27.45,27.45,0,0,0,240.26,186.1Zm-20.8,15.7a4.46,4.46,0,0,1-4,2.2H40.55a4.46,4.46,0,0,1-4-2.2,3.56,3.56,0,0,1,0-3.73L124,46.2a4.77,4.77,0,0,1,8,0l87.44,151.87A3.56,3.56,0,0,1,219.46,201.8ZM116,136V104a12,12,0,0,1,24,0v32a12,12,0,0,1-24,0Zm28,40a16,16,0,1,1-16-16A16,16,0,0,1,144,176Z"/></svg>',
    cancel: '<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M128,20A108,108,0,1,0,236,128,108.12,108.12,0,0,0,128,20Zm84,108a83.6,83.6,0,0,1-16.75,50.28L77.72,60.75A84,84,0,0,1,212,128ZM44,128A83.6,83.6,0,0,1,60.75,77.72L178.28,195.25A84,84,0,0,1,44,128Z"/></svg>',
  };
  const icon = icons[type] || '<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M232.49,80.49l-128,128a12,12,0,0,1-17,0l-56-56a12,12,0,1,1,17-17L96,183,215.51,63.51a12,12,0,0,1,17,17Z"/></svg>';
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
