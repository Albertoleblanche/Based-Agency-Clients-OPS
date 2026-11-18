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
  const view = seg.closest('.view, .ipush, #mMain, .modal-card, #mSheet, #tbActions');
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
// The highlight and the label colours move together: a copy of the labels in their selected
// colours, on the selected background, is clipped to a rounded box that travels from the old tab
// to the new one. Underneath, every label keeps its unselected look until the box arrives, so no
// label is ever dark on dark or light on light, and nothing fades in twice.
function slidePill(seg, on, from, segFrom){
  const to = on.getBoundingClientRect(), sr = seg.getBoundingClientRect();
  if(Math.abs(to.left - from.left) < 2 && Math.abs(to.top - from.top) < 2) return;
  seg.querySelectorAll(':scope > .seg-hl').forEach(n => n.remove());
  const cs = getComputedStyle(on), ss = getComputedStyle(seg);
  const hl = document.createElement('span');
  hl.className = 'seg-hl'; hl.setAttribute('aria-hidden', 'true');
  ['display', 'flexDirection', 'flexWrap', 'alignItems', 'justifyContent', 'gap', 'rowGap', 'columnGap',
   'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'gridTemplateColumns'].forEach(k => { hl.style[k] = ss[k]; });
  hl.style.background = cs.backgroundColor;
  [...seg.children].forEach(ch => {
    if(ch.classList.contains('seg-hl') || ch.classList.contains('seg-pill')) return;
    const c = ch.cloneNode(true);
    c.classList.add('on'); c.removeAttribute('id'); c.removeAttribute('onclick'); c.tabIndex = -1;
    c.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
    hl.appendChild(c);
  });
  if(ss.position === 'static') seg.style.position = 'relative';
  const rad = parseFloat(cs.borderTopLeftRadius) || 6;
  const box = (r, ref) => { const t = r.top - ref.top, l = r.left - ref.left; return `inset(${t}px ${ref.width - l - r.width}px ${ref.height - t - r.height}px ${l}px round ${rad}px)`; };
  // the old tab's box, measured against the old control, placed on the new one
  const fromBox = { top: from.top - segFrom.top + sr.top, left: from.left - segFrom.left + sr.left, width: from.width, height: from.height };
  seg.classList.add('seg-moving');
  on.classList.add('pill-under');
  seg.appendChild(hl);
  const a = hl.animate([{ clipPath: box(fromBox, sr) }, { clipPath: box(to, sr) }], { duration: 260, easing: 'cubic-bezier(.32,.72,0,1)', fill: 'forwards' });
  let finished = false;
  const done = () => {
    if(finished) return; finished = true;
    // swap back in one frame with no transitions, so the real tab doesn't fade in afterwards
    seg.classList.add('seg-still');
    on.classList.remove('pill-under'); seg.classList.remove('seg-moving'); hl.remove();
    requestAnimationFrame(() => requestAnimationFrame(() => seg.classList.remove('seg-still')));
  };
  a.onfinish = done; a.oncancel = done; setTimeout(done, 420);
}
// What the tab shows: a quick fade as it swaps.
function fadeSegContent(seg, scopeBefore){
  // Tabs in the window toolbar (Time's Timesheet / Reports / Daily Summary) switch the whole
  // screen below, so the screen that's now showing comes in.
  if(seg.closest('#tbActions')){
    const view = document.querySelector('.view.active');
    if(!view) return;
    [...view.children].filter(ch => !ch.hidden && ch.offsetParent !== null).slice(0, 3)
      .forEach(ch => ch.animate?.([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: EASE_OUT }));
    return;
  }
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

// ---- the panel on the right (This Week, Health, Focus Reports, Tasks) ----------------------------
// These screens redraw everything on every change, panel included. Watching the redraws lets the
// panel slide in only when it first opens, stay perfectly still while the page or its own content
// redraws (comments arriving, a box ticked), cross-fade when you pick another row, and slide back
// out to the right when it closes, however it was closed.
document.addEventListener('scroll', e => { const t = e.target; if(t && t.classList && (t.classList.contains('sp') || t.classList.contains('sp-page'))) t._st = t.scrollTop; }, true);
const SP_SEL = ':scope > .sp:not(.sp-leaving)';
function panelIn(p){
  p.animate?.([{ opacity: 0, transform: 'translateX(32px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: EASE_OUT });
}
function panelSwap(p){
  p.scrollTop = 0; p._st = 0;
  [...p.children].filter(ch => !ch.classList.contains('sp-bar')).slice(0, 8)
    .forEach(ch => ch.animate?.([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: EASE_OUT }));
}
function panelOut(old, wrap){
  const ghost = old.cloneNode(true);
  ghost.classList.add('sp-leaving');
  ghost.removeAttribute('id'); ghost.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
  ghost.setAttribute('aria-hidden', 'true'); ghost.inert = true;
  wrap.appendChild(ghost);
  ghost.scrollTop = old._st || 0;
  animateThen(ghost, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(32px)' }], 180, EASE_IN, () => ghost.remove());
}
new MutationObserver(recs => {
  for(const r of recs){
    let oldW = null, newW = null;
    r.removedNodes.forEach(n => { if(n.nodeType === 1 && n.classList.contains('spw')) oldW = n; });
    r.addedNodes.forEach(n => { if(n.nodeType === 1 && n.classList.contains('spw')) newW = n; });
    if(!newW || !newW.isConnected || newW.offsetParent === null) continue;
    const oldP = oldW && oldW.querySelector(SP_SEL), newP = newW.querySelector(SP_SEL);
    const same = oldP && newP && oldP.getAttribute('aria-label') === newP.getAttribute('aria-label');
    // A redraw keeps both scroll positions (Read in full, "3 more", a box ticked).
    const oldPage = oldW && oldW.querySelector(':scope > .sp-page'), newPage = newW.querySelector(':scope > .sp-page');
    if(oldPage && newPage && !newPage.scrollTop && oldPage._st){ newPage.scrollTop = oldPage._st; newPage._st = oldPage._st; }
    if(same && !newP.scrollTop && oldP._st){ newP.scrollTop = oldP._st; newP._st = oldP._st; }
    if(!motionOK()) continue;
    if(newP && !oldP) panelIn(newP);
    else if(newP && oldP && !same) panelSwap(newP);
    else if(oldP && !newP) panelOut(oldP, newW);
  }
}).observe(document.documentElement, { childList: true, subtree: true });

// ---- Show more / Show less ---------------------------------------------------------------------
// A link or button with data-grow="key" toggles the block marked data-grow-key="key" (its rows are
// its children, or data-grow-rows="selector" for a table). The screens redraw on click, so this
// notes the block's height and rows first, then, before the redraw paints, eases the block from
// the old height to the new one: rows that arrive fade in from just above, rows that leave fade
// out while it closes, and a block that swaps its content cross-fades.
function growRows(block){
  const sel = block.getAttribute('data-grow-rows');
  const list = sel ? [...block.querySelectorAll(sel)] : [...block.children];
  return list.filter(ch => !ch.matches('[data-grow]') && !ch.querySelector('[data-grow]') && !ch.classList.contains('grow-ghost'));
}
document.addEventListener('click', e => {
  const t = e.target.closest && e.target.closest('[data-grow]');
  if(!t || !motionOK()) return;
  const key = t.getAttribute('data-grow');
  const old = document.querySelector(`[data-grow-key="${CSS.escape(key)}"]`);
  if(!old) return;
  old.getAnimations?.().forEach(a => a.finish());
  const h0 = old.getBoundingClientRect().height, oldRows = growRows(old).map(r => r.cloneNode(true));
  requestAnimationFrame(() => {
    const nu = document.querySelector(`[data-grow-key="${CSS.escape(key)}"]`);
    if(!nu) return;
    const rows = growRows(nu), h1 = nu.getBoundingClientRect().height;
    if(Math.abs(h1 - h0) < 2) return;
    const ghosts = [];
    if(h1 > h0 && rows.length > oldRows.length){
      rows.slice(oldRows.length).forEach((r, i) => r.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }],
        { duration: 220, delay: Math.min(i * 16, 160), easing: EASE_OUT, fill: 'backwards' }));
    } else if(h1 < h0 && oldRows.length > rows.length){
      let at = rows[rows.length - 1] || null;
      oldRows.slice(rows.length).forEach(g => {
        g.classList.add('grow-ghost'); g.setAttribute('aria-hidden', 'true'); g.removeAttribute('id'); g.style.pointerEvents = 'none';
        if(at) at.after(g); else nu.prepend(g);
        at = g; ghosts.push(g);
        g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: EASE_OUT, fill: 'forwards' });
      });
    } else {
      rows.forEach(r => r.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: EASE_OUT }));
    }
    const prevOverflow = nu.style.overflow;
    nu.style.overflow = 'hidden';
    const a = nu.animate([{ height: h0 + 'px' }, { height: h1 + 'px' }], { duration: 280, easing: 'cubic-bezier(.32,.72,0,1)' });
    let done = false;
    const end = () => { if(done) return; done = true; nu.style.overflow = prevOverflow; ghosts.forEach(g => g.remove()); };
    a.onfinish = end; a.oncancel = end; setTimeout(end, 420);
  });
}, true);
