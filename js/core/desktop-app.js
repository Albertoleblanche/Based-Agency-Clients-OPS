// ============================================================================
// Desktop-app behaviour — what makes the app feel like an installed Mac/PC
// app rather than a web page: install as an app (own window, taskbar icon,
// title bar drawn by the app), window colour that follows the theme,
// scrollbars that only show while scrolling, right-click menus, and
// keyboard shortcuts. Styling for all of this is in css/desktop-app.css.
// ============================================================================

const IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl+';

// ---- Install as an app -----------------------------------------------------
// Chrome and Edge fire beforeinstallprompt when the app can be installed;
// "Install as desktop app" in the profile menu only shows while that's true.
let deferredInstallPrompt = null;

function isRunningAsInstalledApp(){
  return matchMedia('(display-mode: standalone)').matches
    || matchMedia('(display-mode: window-controls-overlay)').matches
    || navigator.standalone === true;
}

function syncInstallMenuItem(){
  const item = document.getElementById('installAppMenuItem');
  if(item) item.style.display = (deferredInstallPrompt && !isRunningAsInstalledApp()) ? '' : 'none';
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();          // offer it from our own menu instead of a browser bar
  deferredInstallPrompt = e;
  syncInstallMenuItem();
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  syncInstallMenuItem();
  if(typeof showToast === 'function') showToast('success', 'Installed', 'Based Agency is now an app on this computer — open it from the Start menu, taskbar or Dock.');
});

async function installDesktopApp(){
  if(!deferredInstallPrompt) return;
  const prompt = deferredInstallPrompt;
  deferredInstallPrompt = null;
  syncInstallMenuItem();
  try{ await prompt.prompt(); }catch(e){ console.warn('Install prompt failed', e); }
}

// ---- Window colour follows the app's theme ---------------------------------
// The installed window's title bar and the browser's own chrome take their
// colour from <meta name="theme-color">; keep it on the page background so
// the window reads as one surface in light and dark.
function syncThemeColor(){
  const meta = document.querySelector('meta[name="theme-color"]');
  if(!meta || !document.body) return;
  const bg = getComputedStyle(document.body).getPropertyValue('--bg').trim();
  if(bg) meta.setAttribute('content', bg);
}

// ---- Scrollbars that show while scrolling (as on macOS) --------------------
// css/desktop-app.css hides scrollbar thumbs at rest; a scroller gets
// .is-scrolling while it moves and for a moment after.
const _scrollHideTimers = new WeakMap();
document.addEventListener('scroll', (e) => {
  const el = e.target === document ? document.documentElement : e.target;
  if(!el || !el.classList) return;
  el.classList.add('is-scrolling');
  clearTimeout(_scrollHideTimers.get(el));
  _scrollHideTimers.set(el, setTimeout(() => el.classList.remove('is-scrolling'), 900));
}, { capture:true, passive:true });

// ---- Right-click menus -------------------------------------------------------
// Right-clicking a card or row opens that item's own ⋯ menu at the pointer,
// with exactly the same items and permissions. Text fields, links and
// selected text keep the browser's menu (copy/paste), and Shift+right-click
// always does.
const CONTEXT_MENU_TRIGGERS = '.kanban-card-menu-btn, .icon-menu-btn, .claude-sidebar-menu-btn';
const CONTEXT_MENUS = '.kanban-card-menu, #teamActionsMenu, .claude-sidebar-menu';

function isShown(el){
  if(!el) return false;
  const cs = getComputedStyle(el);
  return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0;
}

// Places an already-open menu with its top-left corner at the pointer,
// flipping left/up when it would run off the window.
function placeMenuAtPointer(menu, x, y){
  // measure without the opening animation's scale, then replay it
  menu.style.animation = 'none';
  menu.style.position = 'fixed';
  menu.style.right = 'auto';
  menu.style.bottom = 'auto';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  // A transformed ancestor would shift a fixed element; measure and correct.
  let r = menu.getBoundingClientRect();
  const offX = r.left - x, offY = r.top - y;
  let left = x, top = y;
  if(x + r.width > window.innerWidth - 8) left = Math.max(8, x - r.width);
  if(y + r.height > window.innerHeight - 8) top = Math.max(8, y - r.height);
  menu.style.left = (left - offX) + 'px';
  menu.style.top = (top - offY) + 'px';
  menu.classList.add('ctx-at-pointer');
  menu.style.transformOrigin = `${left < x ? 'right' : 'left'} ${top < y ? 'bottom' : 'top'}`;
  void menu.offsetWidth;
  menu.style.animation = '';
}

document.addEventListener('contextmenu', (e) => {
  if(e.shiftKey) return;
  if(e.target.closest('input, textarea, select, [contenteditable="true"], a[href], iframe')) return;
  if(String(window.getSelection && window.getSelection()).trim()) return;
  // The nearest ancestor holding exactly one ⋯ trigger is the item that was
  // clicked; stop as soon as an ancestor holds several (a list or column).
  let trigger = null;
  for(let el = e.target; el && el !== document.body; el = el.parentElement){
    const found = el.matches(CONTEXT_MENU_TRIGGERS) ? [el] : [...el.querySelectorAll(CONTEXT_MENU_TRIGGERS)].filter(isShown);
    if(found.length === 1){ trigger = found[0]; break; }
    if(found.length > 1) break;
  }
  if(!trigger) return;
  e.preventDefault();
  const openBefore = new Set([...document.querySelectorAll(CONTEXT_MENUS)].filter(isShown));
  // If this item's menu is already open, a click would close it — reopen it.
  if(openBefore.size) trigger.click();
  trigger.click();
  const menu = [...document.querySelectorAll(CONTEXT_MENUS)].find(isShown);
  if(menu) placeMenuAtPointer(menu, e.clientX, e.clientY);
});

// ---- Keyboard shortcuts ------------------------------------------------------
// ⌘/Ctrl+1…9 open the sidebar sections in order, ⌘/Ctrl+, opens Settings,
// ⌘/Ctrl+\ shows or hides the sidebar, ⌘/Ctrl+/ lists the shortcuts.
// ⌘/Ctrl+K (search) lives with the command palette in navigation.js.
function visibleNavItems(){
  return [...document.querySelectorAll('#appSidebar .src .nav-item[data-view]')].filter(isShown);
}

function shortcutLabelForView(view){
  const index = visibleNavItems().findIndex(n => n.dataset.view === view);
  if(index > -1 && index < 9) return MOD_LABEL + (index + 1);
  if(view === 'settings') return MOD_LABEL + ',';
  return '';
}

function isModifierShortcut(e){
  return IS_MAC ? (e.metaKey && !e.ctrlKey) : (e.ctrlKey && !e.metaKey);
}

document.addEventListener('keydown', (e) => {
  if(typeof currentUser === 'undefined' || !currentUser) return;
  if(!isModifierShortcut(e) || e.altKey) return;
  const appModalOpen = document.getElementById('appModalOverlay') || document.querySelector('#cmdkOverlay[style*="flex"]');
  if(/^[1-9]$/.test(e.key) && !e.shiftKey){
    const item = visibleNavItems()[Number(e.key) - 1];
    if(!item || appModalOpen) return;
    e.preventDefault();
    item.click();
  } else if(e.key === ',' && !e.shiftKey){
    const settingsItem = document.querySelector('#appSidebar .nav-item[data-view="settings"]');
    if(!isShown(settingsItem) || appModalOpen) return;
    e.preventDefault();
    settingsItem.click();
  } else if(e.key === '\\'){
    e.preventDefault();
    toggleSidebar();
  } else if(e.key === '/'){
    e.preventDefault();
    openShortcutsSheet();
  }
});

function openShortcutsSheet(){
  // "Ctrl+K" → [Ctrl][K]; "⌘K" → [⌘][K]; "Esc" → [Esc]
  const keys = (combo) => {
    const parts = combo.startsWith('Ctrl+') ? ['Ctrl', combo.slice(5)] : combo.startsWith('⌘') ? ['⌘', combo.slice(1)] : [combo];
    return parts.map(part => `<kbd class="kbd">${escapeHtml(part)}</kbd>`).join('');
  };
  const navRows = visibleNavItems().slice(0, 9).map((n, i) => {
    const label = n.querySelector('.nav-label')?.textContent || n.dataset.tooltip || n.dataset.view;
    return [label, MOD_LABEL + (i + 1)];
  });
  const rows = [
    ['Search clients and pages', MOD_LABEL + 'K'],
    ...navRows,
    ['Settings', MOD_LABEL + ','],
    ['Show or hide the sidebar', MOD_LABEL + '\\'],
    ['Keyboard shortcuts', MOD_LABEL + '/'],
    ['Close a window or menu', 'Esc'],
  ];
  openAppModal(`
    <div class="modal-head"><span class="panel-title">Keyboard shortcuts</span><span class="toast-close" onclick="closeAppModal()">✕</span></div>
    <div class="modal-body shortcut-list">
      ${rows.map(([label, combo]) => `<div class="shortcut-row"><span>${escapeHtml(label)}</span><span class="shortcut-keys">${keys(combo)}</span></div>`).join('')}
    </div>
    <div class="modal-actions"><button class="btn btn-brand" onclick="closeAppModal()">Done</button></div>`, 420);
}

// ---- Start-up ---------------------------------------------------------------
(function initDesktopApp(){
  const start = () => {
    document.body.classList.toggle('is-installed-app', isRunningAsInstalledApp());
    syncThemeColor();
    syncInstallMenuItem();
    new MutationObserver(syncThemeColor).observe(document.body, { attributes:true, attributeFilter:['data-theme'] });
    ['(display-mode: standalone)', '(display-mode: window-controls-overlay)'].forEach(q => {
      const mq = matchMedia(q);
      const onChange = () => { document.body.classList.toggle('is-installed-app', isRunningAsInstalledApp()); syncInstallMenuItem(); };
      if(mq.addEventListener) mq.addEventListener('change', onChange);
    });
  };
  if(document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
