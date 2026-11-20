// Motion: things leave the way they came, a new screen fades in, the selected tab slides to where
// you clicked, a checkbox fills before its row goes. Short, ease-out, and off when the system asks
// for reduced motion. Shared by the desktop and the iPhone app.

const EASE_OUT = 'cubic-bezier(.23,1,.32,1)';
const EASE_IN = 'cubic-bezier(.4,0,1,1)';
// How you got somewhere: the keyboard gets no animation (switchView reads this).
document.addEventListener('keydown', e => { if(!e.repeat && (e.metaKey || e.ctrlKey || e.altKey || !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || ''))) window._lastInput = 'key'; }, true);
document.addEventListener('pointerdown', () => { window._lastInput = 'pointer'; }, true);
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
  // a popover that opened upward (data-from="below") goes back down into what opened it
  const back = el.dataset.from === 'below' ? 'translateY(4px) scale(.98)' : 'translateY(-4px) scale(.98)';
  animateThen(el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: back }], 140, EASE_OUT, () => {
    el.style.display = 'none'; delete el.dataset.leaving;
    el.getAnimations?.().forEach(a => a.cancel());
  });
}

// ---- the selected tab slides to the one you clicked -------------------------------------------
// Segmented controls are redrawn on click, so this remembers where the selection was, waits for
// the redraw, and slides a pill from the old spot to the new one behind the labels.
const SEG_SEL = '.seg, .iseg';
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
  const btn = e.target.closest && e.target.closest('.seg > button, .seg > a, .iseg > button');
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
  // (a screen that already animates its own change, like the timesheet, is left to it)
  [...scope.children].filter(ch => !ch.contains(seg) && !ch.matches('.seg-pill, .client-insp, [hidden]') && ch.offsetParent !== null && !ch.getAnimations?.().length).slice(0, 6)
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
  animateThen(ghost, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(32px)' }], 180, EASE_OUT, () => ghost.remove());
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
    // from the keyboard (arrows through a list, Esc) the panel opens, swaps and closes at once
    if(window._lastInput === 'key'){ if(newP && oldP && !same){ newP.scrollTop = 0; newP._st = 0; } continue; }
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
    // a disclosure row's chevron turns with it (the redraw would otherwise snap it)
    const t1 = t.hasAttribute('aria-expanded') && document.querySelector(`[data-grow="${CSS.escape(key)}"][aria-expanded]`);
    const chev = t1 && t1.querySelector(':scope > svg');
    if(chev && t1.getAttribute('aria-expanded') !== t.getAttribute('aria-expanded')){
      const turn = +(t1.getAttribute('data-turn') || 90), a0 = t.getAttribute('aria-expanded') === 'true' ? turn : 0;
      chev.animate([{ transform: `rotate(${a0}deg)` }, { transform: `rotate(${turn - a0}deg)` }], { duration: 240, easing: EASE_OUT });
    }
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

// ---- every press ---------------------------------------------------------------------------------
// Anything you can click gives on the way down, the moment the pointer goes down, and comes back a
// touch softer when you let go (or drag off it). Small controls go in a little more, wide rows only a
// hair, so every press reads about the same. Text links dim instead. Things that already press in CSS
// (buttons, icon buttons, the sidebar, task and note cards) keep their own. Only the innermost thing
// under the pointer presses. Uses the `scale` property, so it never fights an element's own transform.
const PRESS_SEL = 'button, a[href], [role=button], [role=tab], [role=radio], [onclick], summary, label.pop, label.pop-wrap, label.cl-own, .pop';
const PRESS_CSS = '.btn, .ib, .set-tab, .ty-step-d, .n1-t, .tk-c, .cc, .ar-chip, .set-back, .src-i, .nav-item, .ikpi, .rem-cb, .timer-quick-start-btn, .brand-mark, .db-cb, #harvestTimerWrap, .kpi-click, .dsummary-card, .team-card, .kanban-card, .q-card, .row-link, .si-go';
const PRESS_DIM = '.x-lnk, .lnk, .lnk-b, .db-more, .fix-lnk, .tk-arch, .tmi-add, .bn-open, .cl-link, .link-row, a:not([class])';
const PRESS_SKIP = '.menu .mi, [role=menuitem], .seg-hl, .grow-ghost, [inert], [aria-hidden="true"], :disabled, [aria-disabled="true"], input, textarea';
function pressScale(r){
  const w = r.width;
  const s = w <= 40 ? .9 : w <= 260 ? .97 : w <= 500 ? .98 : w <= 900 ? .99 : .995;
  return r.height > 120 ? Math.max(s, .98) : s;   // a tall card moves less
}
let _press = null;
function pressTarget(t){
  const el = t && t.closest && t.closest(PRESS_SEL);
  if(!el || el.closest(PRESS_SKIP) || el.matches(PRESS_CSS)) return null;
  const oc = el.getAttribute('onclick');
  if(oc && /^\s*event\.stopPropagation\(\);?\s*$/.test(oc)) return null;   // a card that only keeps clicks inside
  const r = el.getBoundingClientRect();
  if(r.width < 4 || r.height < 4 || r.height > 360 || r.width * r.height > 500000) return null;   // overlays, whole panels
  return { el, dim: el.matches(PRESS_DIM), s: pressScale(r) };
}
function pressGo(p, down){
  // with reduced motion nothing moves: a press dims a little instead
  const el = p.el, still = !p.dim && !motionOK(), prop = p.dim || still ? 'opacity' : 'scale';
  const cs = getComputedStyle(el), cur = prop === 'opacity' ? +cs.opacity : (cs.scale === 'none' ? 1 : parseFloat(cs.scale) || 1);
  p.anim?.cancel();
  const to = down ? (p.dim ? .5 : still ? .7 : p.s) : 1;
  if(!el.animate) return;
  p.anim = el.animate([{ [prop]: cur }, { [prop]: to }], down
    ? { duration: 100, easing: 'ease-out', fill: 'forwards' }
    : { duration: 160, easing: EASE_OUT, fill: 'forwards' });
  if(!down){ const a = p.anim; a.onfinish = () => a.cancel(); }
}
function pressUp(){ if(_press && _press.on){ pressGo(_press, false); _press.on = false; } }
function pressEnd(){ pressUp(); _press = null; }   // the button is up (or a drag took over): nothing can press again
document.addEventListener('pointerdown', e => {
  if(e.button !== 0) return;
  pressEnd();
  const p = pressTarget(e.target);
  if(!p) { _press = null; return; }
  _press = p; p.on = true; pressGo(p, true);
  // a native pop-up menu takes the pointer away, so a select just taps
  if(e.target.tagName === 'SELECT') setTimeout(() => { if(_press === p) pressEnd(); }, 120);
}, true);
['pointerup', 'pointercancel', 'dragstart'].forEach(t => document.addEventListener(t, pressEnd, true));
window.addEventListener('blur', pressEnd);
// drag off and it lets go; drag back on and it presses again
document.addEventListener('pointerout', e => { if(_press && _press.on && _press.el.contains(e.target) && !_press.el.contains(e.relatedTarget)) pressUp(); }, true);
document.addEventListener('pointerover', e => { if(_press && !_press.on && (e.buttons & 1) && _press.el.contains(e.target) && _press.el.isConnected){ _press.on = true; pressGo(_press, true); } }, true);
