// Empty states: what a screen shows when it has nothing to list yet, and the one thing to do next.
// emptyState({ icon, tone, title, text, action, onAction, link, onLink, compact, cls })
//   icon     Lucide (or canvas) icon name, drawn large and thin above the title
//   tone     'ok' (green, all done) | 'blue' (a first step) | '' (neutral grey)
//   action   label of the one button that starts using the screen; onAction is its onclick JS
//   link     a quieter second way in (onLink is its onclick JS)
//   compact  for a section inside a page rather than a whole screen
function emptyState(o){
  o = o || {};
  const a = o.action ? `<button class="btn${o.primary ? ' btn-p' : ''}" onclick="${o.onAction}">${o.actionIcon ? icon(o.actionIcon) : ''}${escapeHtml(o.action)}</button>` : '';
  const l = o.link ? `<a class="x-lnk" href="#" onclick="${o.onLink};return false;">${escapeHtml(o.link)}</a>` : '';
  return `<div class="es${o.compact ? ' es-sm' : ''}${o.cls ? ' ' + o.cls : ''}">
${o.icon ? `<span class="es-i${o.tone ? ' ' + o.tone : ''}" aria-hidden="true">${icon(o.icon)}</span>` : ''}
<b class="es-t">${escapeHtml(o.title || '')}</b>${o.text ? `<p class="es-p">${o.html ? o.text : escapeHtml(o.text)}</p>` : ''}
${a || l ? `<div class="es-a">${a}${l}</div>` : ''}</div>`;
}
// No clients yet: what the screen will show once there are some, and (for those who can) New Client.
function emptyNoClients(what, o){
  const can = typeof canEditClients === 'function' && canEditClients();
  return emptyState(Object.assign({ icon: 'building-2', tone: 'blue', title: 'No clients yet',
    text: `${what} ${can ? 'Add your first client to start.' : 'An admin or approver adds clients; they show here once they do.'}`,
    action: can ? 'New Client' : '', actionIcon: 'plus', onAction: 'openAddClientForm()' }, o || {}));
}
