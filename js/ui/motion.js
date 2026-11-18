// Motion: things leave the way they came, a new screen fades in, the selected tab slides to where
// you clicked, a checkbox fills before its row goes. Short, ease-out, and off when the system asks
// for reduced motion. Shared by the desktop and the iPhone app.

const EASE_OUT = 'cubic-bezier(.23,1,.32,1)';
const EASE_IN = 'cubic-bezier(.4,0,1,1)';
function motionOK(){ try{ return !matchMedia('(prefers-reduced-motion: reduce)').matches; }catch(e){ return true; } }

// Play keyframes on an element, then call done (right away when motion is off).
function animateThen(el, frames, ms, easing, done){
  if(!el || !motionOK() || !el.animate){ if(done) done(); return; }
  const a = el.animate(frames, { duration: ms, easing: easing || EASE_OUT, fill: 'forwards' });
  let called = false;
  const fin = () => { if(called) return; called = true; if(done) done(); };
  a.onfinish = fin; a.oncancel = fin;
  setTimeout(fin, ms + 80); // a background tab may never finish it
}
// A screen or panel arriving.
function enterIn(el, from){
  if(!el || !motionOK() || !el.animate) return;
  el.animate([{ opacity: 0, transform: from || 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: EASE_OUT });
}
// A popover hidden with display:none: shrink and fade toward where it came from, then hide.
function hidePop(el){
  if(!el || el.style.display === 'none' || el.dataset.leaving) return;
  el.dataset.leaving = '1';
  animateThen(el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-4px) scale(.98)' }], 140, EASE_IN, () => {
    el.style.display = 'none'; delete el.dataset.leaving;
    el.getAnimations?.().forEach(a => a.cancel());
  });
}

// ---- the selected tab slides to the one you clicked -------------------------------------------
// Segmented controls are redrawn on click, so this remembers where the selection was, waits for
// the redraw, and slides a pill from the old spot to the new one behind the labels.
const SEG_SEL = '.seg, .iseg, .set-tabs';
function segKey(seg){
  const view = seg.closest('.view, .ipush, #mMain, .modal-card, #mSheet');
  const all = view ? [...view.querySelectorAll(SEG_SEL)] : [];
  return { view, label: seg.getAttribute('aria-label') || '', index: all.indexOf(seg) };
}
function findSeg(key){
  if(!key.view || !key.view.isConnected) return null;
  const all = [...key.view.querySelectorAll(SEG_SEL)];
  return (key.label && all.find(s => s.getAttribute('aria-label') === key.label)) || all[key.index] || null;
}
document.addEventListener('click', e => {
  const btn = e.target.closest && e.target.closest('.seg > button, .seg > a, .iseg > button, .set-tabs > button');
  if(!btn || !motionOK()) return;
  const seg = btn.parentElement, old = seg.querySelector('.on');
  if(!old || old === btn) return;
  const key = segKey(seg), from = old.getBoundingClientRect(), segFrom = seg.getBoundingClientRect();
  const scopeBefore = seg.closest('section, .view, .ipush, #mMain');
  let tries = 0;
  const step = () => {
    const s2 = findSeg(key), on = s2 && s2.querySelector('.on');
    if(!on || (s2 === seg && on === old)){ if(++tries < 30) return requestAnimationFrame(step); return; }
    slidePill(s2, on, from, segFrom);
    fadeSegContent(s2, scopeBefore);
  };
  requestAnimationFrame(step);
}, true);
function slidePill(seg, on, from, segFrom){
  const to = on.getBoundingClientRect(), sr = seg.getBoundingClientRect();
  if(Math.abs(to.left - from.left) < 2 && Math.abs(to.top - from.top) < 2) return;
  const cs = getComputedStyle(on);
  const pill = document.createElement('span');
  pill.className = 'seg-pill';
  pill.setAttribute('aria-hidden', 'true');
  Object.assign(pill.style, { left: (to.left - sr.left) + 'px', top: (to.top - sr.top) + 'px', width: to.width + 'px', height: to.height + 'px',
    background: cs.backgroundColor, boxShadow: cs.boxShadow, borderRadius: cs.borderRadius });
  if(getComputedStyle(seg).position === 'static') seg.style.position = 'relative';
  seg.prepend(pill);
  on.classList.add('pill-under');
  const dx = (from.left - segFrom.left) - (to.left - sr.left), dy = (from.top - segFrom.top) - (to.top - sr.top), sx = from.width / to.width;
  const a = pill.animate([{ transform: `translate(${dx}px, ${dy}px) scaleX(${sx})` }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.32,.72,0,1)' });
  const done = () => { pill.remove(); on.classList.remove('pill-under'); };
  a.onfinish = done; a.oncancel = done; setTimeout(done, 400);
}
// What the tab shows: a quick fade as it swaps.
function fadeSegContent(seg, scopeBefore){
  const scope = seg.closest('section, .view, .ipush, #mMain') || scopeBefore;
  if(!scope) return;
  [...scope.children].filter(ch => !ch.contains(seg) && !ch.matches('.seg-pill, .client-insp, [hidden]') && ch.offsetParent !== null).slice(0, 6)
    .forEach(ch => ch.animate?.([{ opacity: .35, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: EASE_OUT }));
}

// ---- checking something off --------------------------------------------------------------------
// The box fills and pops, the row dims, then the real change runs (which usually redraws the list).
function checkOff(btn, then){
  if(!btn || btn.dataset.checking){ return; }
  btn.dataset.checking = '1';
  btn.classList.add('checking');
  btn.setAttribute('aria-checked', 'true');
  btn.innerHTML = typeof icon === 'function' ? icon('check', { weight: 'bold' }) : '✓';
  const row = btn.closest('.row, .ir, .kanban-card, .tk, .rmi-r');
  if(motionOK()){
    btn.animate?.([{ transform: 'scale(.8)' }, { transform: 'scale(1.12)', offset: .6 }, { transform: 'scale(1)' }], { duration: 260, easing: EASE_OUT });
    row?.animate?.([{ opacity: 1 }, { opacity: .45 }], { duration: 260, delay: 60, easing: EASE_OUT, fill: 'forwards' });
    setTimeout(() => { if(then) then(); }, 320);
  } else if(then) then();
}
