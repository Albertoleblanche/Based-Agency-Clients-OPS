// (i) tips: a small info icon beside something that isn't obvious, explaining what it is, what it
// does and how to use it. infoTip(text) returns the button; pointing at it or focusing it shows the
// tip after a moment (at once while another was just open), a click or tap pins it, and Escape,
// clicking elsewhere or moving away closes it. One tip shows at a time, under the icon (above it
// when there's no room), kept inside the window. A blank line in the text starts a new paragraph.
function infoTip(text, label){
  return `<button type="button" class="itip" aria-label="${escapeHtml(label || 'What is this?')}" aria-expanded="false" data-tip="${escapeHtml(text)}">${icon('info')}</button>`;
}

const ITIP = { el: null, btn: null, timer: 0, pinned: false, lastHide: 0 };
function itipPop(){
  if(ITIP.el && ITIP.el.isConnected) return ITIP.el;
  const el = document.createElement('div');
  el.id = 'itipPop'; el.setAttribute('role', 'tooltip');
  document.body.appendChild(el);
  return (ITIP.el = el);
}
function itipShow(btn){
  clearTimeout(ITIP.timer);
  if(ITIP.btn && ITIP.btn !== btn) ITIP.btn.setAttribute('aria-expanded', 'false');
  const el = itipPop(), text = btn.getAttribute('data-tip') || '';
  el.innerHTML = text.split(/\n\s*\n/).map(p => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`).join('');
  el.classList.remove('on'); el.style.display = 'block';
  const r = btn.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight, pad = 8;
  const left = Math.max(pad, Math.min(innerWidth - w - pad, r.left + r.width / 2 - w / 2));
  const below = r.bottom + 8 + h <= innerHeight - pad;
  el.style.left = left + 'px';
  el.style.top = (below ? r.bottom + 8 : Math.max(pad, r.top - 8 - h)) + 'px';
  el.dataset.side = below ? 'below' : 'above';
  btn.setAttribute('aria-expanded', 'true'); btn.setAttribute('aria-describedby', 'itipPop');
  ITIP.btn = btn;
  requestAnimationFrame(() => el.classList.add('on'));
}
function itipHide(){
  clearTimeout(ITIP.timer);
  if(ITIP.btn){ ITIP.btn.setAttribute('aria-expanded', 'false'); ITIP.btn.removeAttribute('aria-describedby'); }
  if(ITIP.el && ITIP.btn) ITIP.lastHide = Date.now();
  ITIP.btn = null; ITIP.pinned = false;
  if(ITIP.el){ ITIP.el.classList.remove('on'); ITIP.el.style.display = 'none'; }
}
document.addEventListener('mouseover', e => {
  const b = e.target.closest && e.target.closest('.itip');
  if(!b || b === ITIP.btn || ITIP.pinned) return;
  clearTimeout(ITIP.timer);
  // the first tip waits a moment; the next ones open straight away
  const quick = ITIP.btn || Date.now() - ITIP.lastHide < 700;
  ITIP.timer = setTimeout(() => itipShow(b), quick ? 0 : 280);
});
document.addEventListener('mouseout', e => {
  const b = e.target.closest && e.target.closest('.itip');
  if(!b || ITIP.pinned || (e.relatedTarget && b.contains(e.relatedTarget))) return;
  clearTimeout(ITIP.timer);
  if(ITIP.btn === b) itipHide();
});
document.addEventListener('focusin', e => { const b = e.target.closest && e.target.closest('.itip'); if(b && b.matches(':focus-visible')) itipShow(b); });
document.addEventListener('focusout', e => { const b = e.target.closest && e.target.closest('.itip'); if(b && ITIP.btn === b && !ITIP.pinned) itipHide(); });
// a click or tap pins it open (and never reaches the row or header it sits in)
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('.itip');
  if(b){
    e.preventDefault(); e.stopPropagation();
    if(ITIP.btn === b && ITIP.pinned) itipHide(); else { itipShow(b); ITIP.pinned = true; }
    return;
  }
  if(ITIP.pinned) itipHide();
}, true);
document.addEventListener('keydown', e => { if(e.key === 'Escape' && ITIP.btn){ e.stopPropagation(); itipHide(); } }, true); // only the tip closes
addEventListener('scroll', () => { if(ITIP.btn) itipHide(); }, true);
addEventListener('resize', () => { if(ITIP.btn) itipHide(); });
