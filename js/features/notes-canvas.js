// Notes, as on the canvas boards NotesOptA, NotesOpen and NotesCreate.
// Every note is a page in a gallery. Open one and it comes up as a sheet in the middle of the
// screen, where you read it and edit it in place (checklists included). New Note (the toolbar,
// the jot bar, or N) opens the same sheet, empty. Notes are private: RLS only returns your own.
// Loaded after work-canvas.js and sheets2-canvas.js, so these replace their Notes versions.

let notesClient = 'all', notesScope = 'all';
const NOTE_ST = { idea: ['Idea', 'idea'], planned: ['Planned', 'plan'], 'in-progress': ['In progress', 'prog'], done: ['Done', 'done'] };
const NOTE_NEW_PH = 'Start writing. What did the client say, what do you want to try?';
function noteStHtml(s){ const m = NOTE_ST[s] || NOTE_ST.idea; return `<span class="nt-st ${m[1]}"><i></i>${m[0]}</span>`; }
function noteFuLabel(v){ return fmtShortDate(new Date(v + 'T12:00:00')); }
function noteAgo(iso){
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if(m < 1) return 'just now';
  if(m < 60) return m === 1 ? 'a minute ago' : `${m} minutes ago`;
  const h = Math.round(m / 60);
  if(h < 24) return h === 1 ? 'an hour ago' : `${h} hours ago`;
  return timeAgo(iso);
}

// ---- the text as blocks: paragraphs, and checklist items ("- [ ] …" / "- [x] …") ----------
const NOTE_CK = /^\s*(?:[-*]\s*)?\[( |x|X)\]\s?(.*)$/;
const NOTE_CK_TYPED = /^\s*(?:[-*]\s*)?\[( |x|X)\]\s/;
function noteBlocks(text){
  const out = []; let para = null;
  String(text || '').replace(/\r/g, '').split('\n').forEach(l => {
    const m = l.match(NOTE_CK);
    if(m){ para = null; out.push({ k: 'c', on: !!m[1].trim(), t: m[2] }); return; }
    if(!l.trim()){ para = null; return; }              // a blank line ends a paragraph
    if(para) para.t += '\n' + l; else { para = { k: 'p', t: l }; out.push(para); }
  });
  return out;
}
function noteText(blocks){
  return blocks.map((b, i) => (i ? (blocks[i - 1].k === 'p' && b.k === 'p' ? '\n\n' : '\n') : '')
    + (b.k === 'c' ? `- [${b.on ? 'x' : ' '}] ${b.t}` : b.t)).join('');
}
function noteChecklist(text){ const cs = noteBlocks(text).filter(b => b.k === 'c'); return cs.length ? [cs.filter(b => b.on).length, cs.length] : null; }
function noteCkHtml(b){ return `<div class="nt-ck${b.on ? ' on' : ''}"><span class="nt-cb">${b.on ? icon('check', { weight: 'bold' }) : ''}</span><span>${escapeHtml(b.t)}</span></div>`; }
function notePreviewHtml(text){ return noteBlocks(text).slice(0, 4).map(b => b.k === 'c' ? noteCkHtml(b) : `<p>${escapeHtml(b.t)}</p>`).join(''); }
// What "Log as Improvement" starts from: the note's words, checklist items as plain lines.
function noteAsImprovement(n){
  const bl = noteBlocks(n.text);
  return (bl.length ? bl.map(b => b.k === 'c' ? '• ' + b.t : b.t).join('\n') : (n.title || '')).trim();
}
// A note counts as logged once it became an improvement (from this sheet, or the older one-click way).
function noteLoggedMap(){ try{ return JSON.parse(localStorage.getItem('bda_notes_logged') || '{}') || {}; }catch(e){ return {}; } }
function noteIsLogged(n){
  if(n.status !== 'done') return false;
  if(noteLoggedMap()[n.id]) return true;
  const c = clients.find(x => x.id === n.clientId);
  const want = [n.text, noteAsImprovement(n)].map(s => String(s || '').trim()).filter(Boolean);
  return !!(c && want.length && (c.improvements || []).some(i => i.source === 'note' && want.includes(String(i.text || '').trim())));
}

// ---- the gallery -----------------------------------------------------------------------------
function setNotesFilter(k, v){ if(k === 'client') notesClient = v; else notesScope = v; renderNotes(); }
function noteTileHtml(n){
  const c = clients.find(x => x.id === n.clientId), ck = noteChecklist(n.text), title = n.title || 'Untitled note';
  let foot = noteStHtml(n.status);
  if(n.followUpDate && n.status !== 'done'){
    const late = n.followUpDate < toDateStr(new Date());
    foot += `<span class="nt-fu${late ? ' is-late' : ''}">${icon('calendar-blank')}Follow up ${noteFuLabel(n.followUpDate)}</span>`;
  } else if(ck) foot += `<span class="nt-fu">${icon('check-square')}${ck[0]} of ${ck[1]}</span>`;
  if(noteIsLogged(n)) foot += `<span class="nt-fu">${icon('check-circle')}Logged</span>`;
  return `<article class="n1-t${n.color ? ' has-c c-' + n.color : ''}${n.status === 'done' ? ' is-done' : ''}" data-note="${n.id}" role="button" tabindex="0" aria-label="${escapeHtml(title)}" onclick="openNoteSheet('${n.id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openNoteSheet('${n.id}')}">
<div class="n1-tc">${c ? monoHtml(c, 'sm') : ''}<span class="n1-cl">${escapeHtml(c ? c.name : 'No client')}</span><time>${fmtShortDate(new Date(n.createdAt))}</time></div>
<h3>${escapeHtml(title)}</h3><div class="n1-b">${notePreviewHtml(n.text)}</div>
<div class="n1-tf">${foot}</div></article>`;
}
// Notes → Meetings (Nov 23): the meetings from Granola, read only (sheets-canvas.js)
function meetingTileHtml(m){
  const c = m.clientId ? clients.find(x => String(x.id) === String(m.clientId)) : null, pts = meetingPreview(m.summary, 4);
  return `<article class="n1-t mt-t" data-meeting="${m.id}" role="button" tabindex="0" aria-label="${escapeHtml(m.title)}" onclick="openMeetingNotes(${jsArg(m.id)})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openMeetingNotes(${jsArg(m.id)})}">
<div class="n1-tc">${c ? monoHtml(c, 'sm') : ''}<span class="n1-cl">${escapeHtml(c ? c.name : 'Team meeting')}</span><time>${escapeHtml(meetingWhenWords(m))}</time></div>
<h3>${escapeHtml(m.title)}</h3><div class="n1-b">${pts.map(t => `<p>${escapeHtml(t)}</p>`).join('')}</div>
<div class="n1-tf"><span class="nt-fu mt-src">${appLogo('granola', 'xs')}Granola</span>${meetingWasMine(m) ? '<span class="nt-fu">You were there</span>' : ''}${m.items ? `<span class="nt-fu">${icon('check-square')}${m.items} task${m.items === 1 ? '' : 's'}</span>` : ''}</div></article>`;
}
function renderNotes(){
  const root = document.getElementById('notesRoot');
  if(typeof updateNotesBadge === 'function') updateNotesBadge();
  if(!root || typeof notes === 'undefined') return;
  // The open sheet lives beside the gallery and is never re-rendered from here, so a refresh
  // (realtime, a save) can't wipe what you're typing.
  if(!root.querySelector(':scope > .n1-wrap')) root.innerHTML = '<div class="n1-wrap"><div class="n1-page" id="notesGallery"></div><div id="noteSheetHost"></div></div>';
  const gal = document.getElementById('notesGallery');
  if(currentViewName === 'notes') setToolbar(null, `Private to you · ${notes.length} note${notes.length === 1 ? '' : 's'}`);
  if(typeof notesDataLoaded !== 'undefined' && !notesDataLoaded){ gal.innerHTML = skeletonHtml('notes', 'Loading notes…'); return; }
  // Meetings shows once Granola is connected (or meetings were read); they load when it's opened
  const showMt = typeof granolaWatch === 'function' && (granolaOn || (granolaMeetings && granolaMeetings.length));
  if(typeof granolaWatch === 'function') granolaWatch(() => { if(currentViewName === 'notes') renderNotes(); });
  if(notesScope === 'meetings' && !showMt) notesScope = 'all';
  const mts = notesScope === 'meetings' ? granolaMeetings : null;
  if(notesScope === 'meetings') meetingsRefresh(() => { if(currentViewName === 'notes') renderNotes(); });
  // All has the meetings too, beside your notes, newest first (Nov 23); Open and Done are notes only
  if(showMt && granolaMeetings === null && notesScope !== 'meetings') loadGranolaMeetings().then(() => { if(currentViewName === 'notes') renderNotes(); });
  const mtAll = showMt && granolaMeetings ? granolaMeetings : [];
  const used = [...new Set((notesScope === 'meetings' ? (mts || []) : notesScope === 'all' ? notes.concat(mtAll) : notes).map(n => n.clientId))].map(id => clients.find(c => c.id === id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  if(notesClient !== 'all' && !used.some(c => c.id === notesClient)) notesClient = 'all';
  const cur = used.find(c => c.id === notesClient);
  const mine = cur ? notes.filter(n => n.clientId === cur.id) : notes;
  const mtMine = cur ? mtAll.filter(m => String(m.clientId) === String(cur.id)) : mtAll;
  const open = mine.filter(n => n.status !== 'done'), done = mine.filter(n => n.status === 'done');
  const shown = (notesScope === 'open' ? open : notesScope === 'done' ? done : mine).slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const allItems = notesScope === 'all' ? mine.map(n => ({ at: n.createdAt, html: () => noteTileHtml(n) })).concat(mtMine.map(m => ({ at: m.at, html: () => meetingTileHtml(m) })))
    .sort((a, b) => new Date(b.at) - new Date(a.at)) : null;
  if(currentViewName === 'notes' && notesScope !== 'meetings' && mtAll.length) setToolbar(null, `${notes.length} note${notes.length === 1 ? '' : 's'}, private to you · ${mtAll.length} meeting${mtAll.length === 1 ? '' : 's'} from Granola`);
  const seg = [['all', 'All', mine.length + mtMine.length], ['open', 'Open', open.length], ['done', 'Done', done.length]].concat(showMt ? [['meetings', 'Meetings', granolaMeetings ? granolaMeetings.length : '']] : [])
    .map(([k, t, n]) => `<button class="${notesScope === k ? 'on' : ''}" role="tab" aria-selected="${notesScope === k}" onclick="setNotesFilter('scope','${k}')">${t}${n !== '' ? ` <span class="c">${n}</span>` : ''}</button>`).join('');
  if(notesScope === 'meetings'){
    if(currentViewName === 'notes') setToolbar(null, `From Granola’s team space${mts ? ` · ${mts.length} meeting${mts.length === 1 ? '' : 's'}` : ''}${granolaMtChecking ? ' · checking for new ones…' : ''}`);
    const list = (mts || []).filter(m => !cur || String(m.clientId) === String(cur.id));
    gal.innerHTML = `<div class="n1">
<div class="n1-top">
<button type="button" class="n1-cap" onclick="openNoteSheet('new')">${icon('sticky-note')}<span>Jot something down for a client…</span><span class="kbd">N</span></button>
<label class="pop pop-sel n1-pop"><span class="pl">${escapeHtml(cur ? cur.name : 'All clients')}</span>${icon('caret-down')}<select aria-label="Client" onchange="setNotesFilter('client',this.value)"><option value="all">All clients</option>${used.map(c => `<option value="${c.id}"${c === cur ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select></label>
<div class="seg" role="tablist" aria-label="Show">${seg}</div>
</div>
${mts === null ? skeletonHtml('notes', 'Loading meetings…') : list.length ? `<div class="n1-grid">${list.map(meetingTileHtml).join('')}</div>`
  : granolaMtChecking && !cur ? skeletonHtml('notes', 'Checking Granola…')
  : emptyState({ icon: 'sticky-note', tone: 'blue', title: cur ? `No meetings for ${escapeHtml(cur.name)}` : 'No meetings yet', text: 'Meetings shared to Granola’s team space show here once Radar has read them.', html: true })}
<p class="n1-foot nt-lock">${appLogo('granola', 'xs')}Shared to Granola’s team space: everyone on the team sees these</p>
</div>`;
    return;
  }
  const empty = !notes.length ? ['No notes yet', 'Ideas and plans for a client, just for you. When you do one, mark it done or log it as an improvement.']
    : notesScope === 'open' ? ['Nothing open', cur ? `Every note for ${escapeHtml(cur.name)} is done.` : 'Every note is done.']
    : ['Nothing done yet', 'Notes you finish, or log as an improvement, show up here.'];
  gal.innerHTML = `<div class="n1">
<div class="n1-top">
<button type="button" class="n1-cap" onclick="openNoteSheet('new')">${icon('sticky-note')}<span>Jot something down for a client…</span><span class="kbd">N</span></button>
<label class="pop pop-sel n1-pop"><span class="pl">${escapeHtml(cur ? cur.name : 'All clients')}</span>${icon('caret-down')}<select aria-label="Client" onchange="setNotesFilter('client',this.value)"><option value="all">All clients</option>${used.map(c => `<option value="${c.id}"${c === cur ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select></label>
<div class="seg" role="tablist" aria-label="Show">${seg}</div>
</div>
${allItems && allItems.length ? `<div class="n1-grid">${allItems.map(x => x.html()).join('')}</div>` : shown.length ? `<div class="n1-grid">${shown.map(noteTileHtml).join('')}</div>` : emptyState({ icon: !notes.length ? 'sticky-note' : notesScope === 'open' ? 'check-circle' : 'sticky-note', tone: !notes.length ? 'blue' : notesScope === 'open' ? 'ok' : '', title: empty[0], text: empty[1], html: true,
    action: !notes.length || notesScope === 'open' ? 'New Note' : '', actionIcon: 'plus', onAction: "openNoteSheet('new')" })}
<p class="n1-foot nt-lock">${icon('lock-simple')}Only you can see your notes${allItems && mtMine.length ? '. Meetings from Granola are shared with the team.' : ''}</p>
</div>`;
}

// ---- the sheet: a note open, or a new one -----------------------------------------------------
let noteSheet = null;   // { id, clientId, status, followUp, link, cal, modal, edited, pending, prevFocus }
let _noteSaveT = null;
function openNoteModal(noteId, presetClientId, presetStatus){ openNoteSheet(noteId || 'new', presetClientId, presetStatus); }
function openNotePreview(id){ openNoteSheet(id); }
function selectNote(id){ openNoteSheet(id); }

function openNoteSheet(id, presetClientId, presetStatus){
  const n = id && id !== 'new' ? notes.find(x => x.id === id) : null;
  if(id && id !== 'new' && !n){ showToast('error', 'Note not found', 'It may have been moved to Trash.'); return; }
  if(!n && !activeClients().length){ showToast('error', 'Add a client first', 'Notes belong to a client. Add one in All Clients.'); return; }
  if(noteSheet){ const old = noteSheet; noteCapture(); noteSheet = null; noteSheetDomClose(old, true); noteSaveNow(old); }
  const host = document.getElementById('noteSheetHost');
  const inView = typeof currentViewName !== 'undefined' && currentViewName === 'notes' && !!host;
  const cid = n ? n.clientId : (presetClientId && clients.some(c => c.id === presetClientId) ? presetClientId : '');
  noteSheet = { id: n ? n.id : null, clientId: cid, status: n ? n.status : (presetStatus || 'idea'), followUp: n ? (n.followUpDate || '') : '',
    link: n ? (n.link || '') : '', color: n ? (n.color || null) : null, cal: false, modal: !inView, edited: false, pending: null, prevFocus: document.activeElement };
  const html = noteSheetHtml(n);
  if(inView) host.innerHTML = `<div class="n1-scrim" onclick="closeNoteSheet()"></div>${html}`;
  else {
    openAppModal(html, 760);
    const ov = document.getElementById('appModalOverlay');
    ov?.querySelector('.modal-card')?.classList.add('n1-card');
    if(ov) ov.onclick = e => { if(e.target === ov) closeNoteSheet(); };
  }
  document.querySelectorAll('.n1-sheet textarea').forEach(noteFit);
  noteProgress();
  setTimeout(() => { const sh = document.querySelector('.n1-sheet'); if(!sh) return; if(n) sh.focus(); else document.getElementById('nsTitle')?.focus(); }, 30);
}

function noteClientPopHtml(cid){
  const c = clients.find(x => x.id === cid);
  const list = liveClients().slice();
  if(c && !list.includes(c)) list.push(c);
  list.sort((a, b) => a.name.localeCompare(b.name));
  return `<label class="pop pop-sel${c ? '' : ' n1-need'}">${c ? monoHtml(c, 'sm') : icon('buildings')}<span class="pl">${escapeHtml(c ? c.name : 'Choose a client')}</span>${icon('caret-down')}<select id="nsClient" aria-label="Client" onchange="noteSetClient(this)">${c ? '' : '<option value="" selected disabled hidden>Choose a client</option>'}${list.map(x => `<option value="${x.id}"${x === c ? ' selected' : ''}>${escapeHtml(x.name)}${x.deletedAt ? ' (in Trash)' : ''}</option>`).join('')}</select></label>`;
}
function noteStatusPopHtml(st){
  return `<label class="pop pop-sel">${noteStHtml(st)}${icon('caret-down')}<select id="nsStatus" aria-label="Status" onchange="noteSetStatus(this)">${Object.entries(NOTE_ST).map(([k, m]) => `<option value="${k}"${k === st ? ' selected' : ''}>${m[0]}</option>`).join('')}</select></label>`;
}
function noteFuPopHtml(v){
  const opts = [['', 'No follow-up date'], ...sheetDayOptions(0, 30)];
  if(v && !opts.some(o => o[0] === v)) opts.push([v, sheetDateLabelLong(v)]);
  opts.push(['__other', 'Other Date…']);
  return `<span class="n1-fu" id="nsFuWrap"><label class="pop pop-sel${v ? '' : ' n1-opt'}">${icon('calendar-blank')}<span class="pl">${v ? 'Follow up ' + noteFuLabel(v) : 'Add a follow-up date'}</span>${icon('caret-down')}<select id="nsFu" aria-label="Follow-up date" onchange="noteSetFu(this)">${opts.map(([k, t]) => `<option value="${k}"${k === v ? ' selected' : ''}>${escapeHtml(t)}</option>`).join('')}</select></label><input type="date" class="tf" id="nsFuOther" aria-label="Pick a date" hidden min="${toDateStr(new Date())}" onchange="noteSetFuDate(this.value)"></span>`;
}
function noteLinkHtml(){
  const l = noteSheet && noteSheet.link;
  return l ? `<a class="n1-link" href="${safeUrl(normalizeUrl(l))}" target="_blank" rel="noopener">${icon('paperclip')}<span>${escapeHtml(truncateLinkDisplay(l, 60))}</span></a><button type="button" class="ib n1-unlink" aria-label="Remove link" title="Remove link" onclick="noteSetLink('')">${icon('x')}</button>` : '';
}
function noteEditorHtml(blocks){
  const bl = blocks.map(b => ({ ...b }));
  if(!bl.length || bl[bl.length - 1].k !== 'p') bl.push({ k: 'p', t: '' });
  const ph = bl.length === 1 ? (noteSheet && noteSheet.id ? 'Write here. Start a line with [ ] for a checklist.' : NOTE_NEW_PH) : '';
  return bl.map((b, i) => noteBlockHtml(b, ph) + (b.k === 'c' && (bl[i + 1] || {}).k !== 'c' ? noteAddRowHtml() : '')).join('');
}
function noteBlockHtml(b, ph){
  const ta = `<textarea class="n1-in" rows="1" spellcheck="true"${ph ? ` placeholder="${escapeHtml(ph)}"` : ''} aria-label="${b.k === 'c' ? 'Checklist item' : 'Note text'}" oninput="noteInput(this)" onkeydown="noteKey(event,this)" onpaste="notePaste(event)">${escapeHtml(b.t)}</textarea>`;
  return b.k === 'c'
    ? `<div class="nt-ck n1-ci${b.on ? ' on' : ''}" data-k="c"><button type="button" class="nt-cb" role="checkbox" aria-checked="${!!b.on}" aria-label="Done" onclick="noteToggle(this)">${b.on ? icon('check', { weight: 'bold' }) : ''}</button>${ta}</div>`
    : `<div class="n1-p" data-k="p">${ta}</div>`;
}
function noteAddRowHtml(){ return `<button type="button" class="nt-ck n1-add" onclick="noteAddItem(this)"><span class="nt-cb"></span><span>Add an item</span></button>`; }

function noteSheetHtml(n){
  const s = noteSheet;
  const head = `<header class="n1-sh">
${noteClientPopHtml(s.clientId)}
${noteStatusPopHtml(s.status)}
${noteFuPopHtml(s.followUp)}
<span class="n1-cc">${colorSwatchesHtml('nsColor', s.color, 'noteSetColor', { small: true })}</span>
<span class="n1-sp"></span>
${n ? `<button type="button" class="ib" aria-label="More" title="More" onclick="noteMore(event)">${icon('dots-three')}</button>` : ''}<button type="button" class="ib" aria-label="Close" title="Close" onclick="closeNoteSheet()">${icon('x')}</button>
</header>`;
  const meta = n ? `Written ${fmtShortDate(new Date(n.createdAt))}${n.updatedAt && Math.abs(new Date(n.updatedAt) - new Date(n.createdAt)) > 60000 ? ' · edited ' + noteAgo(n.updatedAt) : ''}` : 'New note · only you will see it';
  const tips = n ? '' : `<div class="n1-tips">
<span><kbd>[ ]</kbd>starts a checklist</span>
<span>${icon('paperclip')}Paste a link to attach it</span>
<span>${icon('calendar-blank')}A follow-up date can go on your calendar</span>
</div>`;
  return `<section class="n1-sheet${n ? '' : ' is-new'}${s.color ? ' has-c c-' + s.color : ''}" role="dialog" aria-modal="true" aria-label="${escapeHtml(n ? (n.title || 'Note') : 'New note')}" tabindex="-1" onkeydown="noteSheetKey(event)">
${head}
<div class="n1-doc">
<textarea class="n1-h2" id="nsTitle" rows="1" spellcheck="true" placeholder="Title" aria-label="Title" oninput="noteFit(this);noteDirty()" onkeydown="if(event.key==='Enter'&&!event.isComposing){event.preventDefault();noteFocusBlock(0,'start')}">${escapeHtml(n ? (n.title || '') : '')}</textarea>
<p class="n1-meta">${meta}</p>
<div class="n1-lk" id="nsLink">${noteLinkHtml()}</div>
<div class="n1-body" id="nsBody">${noteEditorHtml(noteBlocks(n ? n.text : ''))}</div>
${tips}
</div>
<footer class="n1-sf" id="nsFoot">${noteFootHtml()}</footer>
</section>`;
}
function noteFootHtml(){
  const s = noteSheet, n = s && s.id ? notes.find(x => x.id === s.id) : null;
  const lock = `<span class="nt-lock">${icon('lock-simple')}Only you can see this note</span>`;
  if(!n){
    const cal = s && s.followUp ? `<span class="n1-cal">${sheetSw('nsCal', s.cal, 'Add to my calendar', 'noteSheet.cal=this.classList.contains(&quot;on&quot;)')}Add to my calendar</span>` : '';
    return `${lock}${cal}<span class="n1-sp"></span><button type="button" class="btn" onclick="closeNoteSheet()">Cancel</button><button type="button" class="btn btn-p n1-create" onclick="noteCreate(this)">Add Note</button>`;
  }
  return `${lock}<span class="n1-pg" id="nsProg"></span><span class="n1-sp"></span>${n.status !== 'done' ? `<button type="button" class="btn" onclick="noteLogImprovement()">${icon('check-circle')}Log as Improvement</button>` : ''}<button type="button" class="btn n1-done" onclick="closeNoteSheet()">Done</button>`;
}
function noteProgress(){
  const el = document.getElementById('nsProg'); if(!el) return;
  const items = [...document.querySelectorAll('#nsBody .n1-ci')].filter(r => r.querySelector('textarea').value.trim());
  if(!items.length){ el.innerHTML = ''; return; }
  const d = items.filter(r => r.classList.contains('on')).length;
  el.innerHTML = `<span class="n1-prog" aria-hidden="true"><i style="width:${Math.round(d / items.length * 100)}%"></i></span><span class="n1-pt">${d} of ${items.length} done</span>`;
}

// ---- editing ---------------------------------------------------------------------------------
function noteFit(el){ el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
function noteDomBlocks(){ return [...document.querySelectorAll('#nsBody [data-k]')].map(el => ({ el, k: el.dataset.k, on: el.classList.contains('on'), t: el.querySelector('textarea').value })); }
function noteBodyText(){
  return noteText(noteDomBlocks().map(b => ({ k: b.k, on: b.on, t: b.k === 'c' ? b.t.replace(/\s*\n\s*/g, ' ').trim() : b.t.replace(/^\s*\n|\n\s*$/g, '') }))
    .filter(b => b.t.trim()));
}
function noteRerender(blocks, focusIdx, caret){
  const body = document.getElementById('nsBody'); if(!body) return;
  body.innerHTML = noteEditorHtml(blocks.map(({ k, on, t }) => ({ k, on, t })));
  body.querySelectorAll('textarea').forEach(noteFit);
  if(focusIdx != null) noteFocusBlock(focusIdx, caret);
  noteDirty();
}
function noteFocusBlock(i, caret){
  const tas = document.querySelectorAll('#nsBody [data-k] textarea'), ta = tas[Math.max(0, Math.min(i, tas.length - 1))];
  if(!ta) return;
  ta.focus();
  const p = caret === 'start' ? 0 : ta.value.length;
  ta.setSelectionRange(p, p);
}
function noteInput(el){
  noteFit(el);
  const blk = el.closest('[data-k]');
  // Typing "[ ] " at the start of a line turns it into a checklist item.
  if(blk.dataset.k === 'p' && el.value.split('\n').some(l => NOTE_CK_TYPED.test(l))){
    const all = noteDomBlocks(), i = all.findIndex(b => b.el === blk), parsed = noteBlocks(el.value);
    const last = parsed.map(b => b.k).lastIndexOf('c');
    noteRerender([...all.slice(0, i), ...parsed, ...all.slice(i + 1)], i + Math.max(0, last));
    return;
  }
  noteDirty();
}
function noteKey(e, el){
  const blk = el.closest('[data-k]'), k = blk.dataset.k;
  const at0 = el.selectionStart === 0 && el.selectionEnd === 0;
  const all = () => noteDomBlocks(), idx = list => list.findIndex(b => b.el === blk);
  if(e.key === 'Enter' && !e.shiftKey && !e.isComposing && k === 'c'){
    e.preventDefault();
    const list = all(), i = idx(list);
    if(!el.value.trim()){ list[i] = { k: 'p', t: '' }; noteRerender(list, i); return; }    // an empty item ends the list
    const before = el.value.slice(0, el.selectionStart), after = el.value.slice(el.selectionEnd);
    list[i] = { k: 'c', on: list[i].on, t: before };
    list.splice(i + 1, 0, { k: 'c', on: false, t: after });
    noteRerender(list, i + 1, 'start');
    return;
  }
  if(e.key === 'Backspace' && at0){
    const list = all(), i = idx(list);
    if(k === 'c'){ e.preventDefault(); list[i] = { k: 'p', t: el.value }; noteRerender(list, i, 'start'); return; }   // drop the checkbox, keep the words
    if(i > 0 && !el.value){ e.preventDefault(); list.splice(i, 1); noteRerender(list, i - 1); return; }
  }
  if(e.key === 'ArrowUp' && at0){
    const i = idx(all());
    if(i > 0){ e.preventDefault(); noteFocusBlock(i - 1); } else { e.preventDefault(); document.getElementById('nsTitle')?.focus(); }
  }
  if(e.key === 'ArrowDown' && el.selectionStart === el.value.length && el.selectionEnd === el.value.length){
    const list = all(), i = idx(list);
    if(i < list.length - 1){ e.preventDefault(); noteFocusBlock(i + 1, 'start'); }
  }
}
function noteToggle(b){
  const row = b.closest('.n1-ci'), on = !row.classList.contains('on');
  row.classList.toggle('on', on); b.setAttribute('aria-checked', on); b.innerHTML = on ? icon('check', { weight: 'bold' }) : '';
  noteDirty();
}
function noteAddItem(btn){
  const list = noteDomBlocks(), prev = btn.previousElementSibling, i = list.findIndex(b => b.el === prev);
  list.splice(i + 1, 0, { k: 'c', on: false, t: '' });
  noteRerender(list, i + 1);
}
function notePaste(e){
  const t = (e.clipboardData?.getData('text') || '').trim();
  if(!noteSheet || noteSheet.link || !/^https?:\/\/\S+$/i.test(t)) return;
  e.preventDefault();
  noteSetLink(t);
  showToast('success', 'Link attached', 'It’s on this note. Paste another to put it in the text.');
}
function noteSetLink(v){
  if(!noteSheet) return;
  noteSheet.link = v || '';
  const el = document.getElementById('nsLink'); if(el) el.innerHTML = noteLinkHtml();
  if(noteSheet.id){ noteSheet.edited = true; noteDirty(); }
}

// Existing notes save as you type (and when the sheet closes); a new note saves on Add Note.
function noteCapture(){
  const t = document.getElementById('nsTitle');
  if(!noteSheet || !t || !document.getElementById('nsBody')) return null;
  noteSheet.pending = { title: t.value.trim(), text: noteBodyText() };
  return noteSheet.pending;
}
function noteDirty(){
  if(!noteSheet) return;
  noteProgress();
  if(!noteSheet.id) return;
  noteSheet.edited = true;
  noteCapture();
  const s = noteSheet;
  clearTimeout(_noteSaveT);
  _noteSaveT = setTimeout(() => noteSaveNow(s), 700);
}
async function noteSaveNow(s){
  clearTimeout(_noteSaveT);
  if(!s || !s.id || !s.edited) return true;
  const p = s.pending, n = notes.find(x => x.id === s.id);
  s.edited = false;
  if(!p || !n) return false;
  const link = s.link || null;
  if(p.title === (n.title || '') && p.text === (n.text || '') && link === (n.link || null)) return true;
  const now = new Date().toISOString();
  const { error } = await supabaseClient.from('notes').update({ title: p.title, text: p.text, link, updated_at: now }).eq('id', s.id).eq('user_id', currentUser.id);
  if(error){ showToast('error', 'Note not saved', error.message); return false; }
  Object.assign(n, { title: p.title, text: p.text, link, updatedAt: now });
  renderNotes();
  return true;
}

async function noteSetClient(sel){
  if(!noteSheet) return;
  const v = sel.value;
  sel.closest('label').outerHTML = noteClientPopHtml(v);
  noteSheet.clientId = v;
  if(!noteSheet.id) return;
  const { error } = await supabaseClient.from('notes').update({ client_id: v }).eq('id', noteSheet.id).eq('user_id', currentUser.id);
  if(error){ showToast('error', 'Not moved', error.message); return; }
  const n = notes.find(x => x.id === noteSheet?.id); if(n) n.clientId = v;
  renderNotes();
}
// The color shows straight away on the open note (its edge) and its tile.
async function noteSetColor(v){
  if(!noteSheet) return;
  noteSheet.color = v;
  const sh = document.querySelector('.n1-sheet');
  if(sh){ sh.classList.forEach(k => { if(/^c-/.test(k)) sh.classList.remove(k); }); sh.classList.toggle('has-c', !!v); if(v) sh.classList.add('c-' + v); }
  if(!noteSheet.id) return;
  const n = notes.find(x => x.id === noteSheet.id), before = n ? n.color : null;
  if(n){ n.color = v; renderNotes(); }
  const { error } = await supabaseClient.from('notes').update({ color: v }).eq('id', noteSheet.id).eq('user_id', currentUser.id);
  if(error){ if(n){ n.color = before; renderNotes(); } isMissingColumnError(error) ? warnNoColorColumn('Color not saved') : showToast('error', 'Color not saved', error.message); }
}
async function noteSetStatus(sel){
  if(!noteSheet) return;
  const v = sel.value;
  sel.closest('label').outerHTML = noteStatusPopHtml(v);
  noteSheet.status = v;
  if(!noteSheet.id) return;
  const { error } = await supabaseClient.from('notes').update({ status: v }).eq('id', noteSheet.id).eq('user_id', currentUser.id);
  if(error){ showToast('error', 'Not saved', error.message); return; }
  const n = notes.find(x => x.id === noteSheet?.id); if(n) n.status = v;
  const f = document.getElementById('nsFoot'); if(f){ f.innerHTML = noteFootHtml(); noteProgress(); }
  renderNotes();
}
function noteSetFu(sel){
  if(!noteSheet) return;
  if(sel.value === '__other'){
    sel.value = noteSheet.followUp; syncPopSel(sel);
    const o = document.getElementById('nsFuOther');
    if(o){ o.hidden = false; o.value = noteSheet.followUp || ''; try{ o.showPicker(); }catch(e){ o.focus(); } }
    return;
  }
  noteSetFuDate(sel.value);
}
async function noteSetFuDate(v){
  if(!noteSheet) return;
  noteSheet.followUp = v || '';
  const w = document.getElementById('nsFuWrap'); if(w) w.outerHTML = noteFuPopHtml(noteSheet.followUp);
  if(!noteSheet.id){ const f = document.getElementById('nsFoot'); if(f) f.innerHTML = noteFootHtml(); return; }
  const { error } = await supabaseClient.from('notes').update({ follow_up_date: v || null }).eq('id', noteSheet.id).eq('user_id', currentUser.id);
  if(error){ showToast('error', 'Not saved', error.message); return; }
  const n = notes.find(x => x.id === noteSheet?.id); if(n) n.followUpDate = v || null;
  renderNotes();
}

function noteMore(e){
  e.stopPropagation();
  const had = document.getElementById('nsMenu'); had?.remove();
  if(had) return;
  const n = noteSheet && notes.find(x => x.id === noteSheet.id); if(!n) return;
  const onCal = (typeof calendarEvents !== 'undefined' ? calendarEvents : []).some(ev => ev.relatedNoteId === n.id);
  const m = document.createElement('div');
  m.className = 'menu'; m.id = 'nsMenu'; m.style.position = 'fixed'; m.style.zIndex = '1200';
  const r = e.currentTarget.getBoundingClientRect();
  m.style.top = (r.bottom + 4) + 'px'; m.style.right = (window.innerWidth - r.right) + 'px';
  m.innerHTML = `${n.followUpDate && !onCal ? `<button class="mi" onclick="noteToCalendar()">${icon('calendar-plus')}Put the Follow-up on My Calendar</button>` : ''}
<button class="mi" onclick="noteCopy()">${icon('clipboard-text')}Copy Text</button><div class="msep"></div>
<button class="mi danger" onclick="noteTrash()">${icon('trash')}Move to Trash…</button>`;
  document.body.appendChild(m);
  setTimeout(() => document.addEventListener('click', () => m.remove(), { once: true }), 0);
}
async function noteToCalendar(){ const s = noteSheet; if(!s) return; noteCapture(); await noteSaveNow(s); await addNoteToCalendar(s.id); }
async function noteCopy(){
  const p = noteCapture(); if(!p) return;
  try{ await navigator.clipboard.writeText([p.title, p.text].filter(Boolean).join('\n\n')); showToast('success', 'Copied', 'The note is on your clipboard.'); }
  catch(e){ showToast('error', 'Couldn’t copy', 'Your browser blocked the clipboard.'); }
}
async function noteTrash(){
  const s = noteSheet; if(!s) return;
  noteCapture(); await noteSaveNow(s);
  noteSheet = null; noteSheetDomClose(s);
  await deleteNote(s.id);
}

async function noteCreate(btn){
  const s = noteSheet; if(!s || s.id) return;
  const t = (document.getElementById('nsTitle')?.value || '').trim(), text = noteBodyText();
  if(!s.clientId){ showToast('error', 'Choose a client', 'Pick who this note is about.'); document.getElementById('nsClient')?.focus(); return; }
  if(!t && !text){ showToast('error', 'Nothing written yet', 'Add a title or a few words first.'); document.getElementById('nsTitle')?.focus(); return; }
  const first = (noteBlocks(text)[0] || { t: '' }).t.split('\n')[0];
  const title = t || (first.length > 70 ? first.slice(0, 69).trimEnd() + '…' : first) || 'Untitled note';
  setBtnLoading(btn, 'Adding…');
  const row = { user_id: currentUser.id, title, client_id: s.clientId, status: s.status, text, link: s.link || null, follow_up_date: s.followUp || null };
  if(s.color) row.color = s.color;
  let { data, error } = await supabaseClient.from('notes').insert(row).select().single();
  if(error && s.color && isMissingColumnError(error)){ delete row.color; warnNoColorColumn(); ({ data, error } = await supabaseClient.from('notes').insert(row).select().single()); }
  restoreBtn(btn);
  if(error){ showToast('error', 'Note not added', error.message); return; }
  noteSheet = null; noteSheetDomClose(s);
  await loadMyNotes();
  if(typeof populateNotesClientFilter === 'function') populateNotesClientFilter();
  renderNotes();
  logClientActivity(s.clientId, 'note_added', `${myName() || 'Someone'} added a private note (content not shared here).`);
  if(typeof refreshClientDetailActivityIfOpen === 'function') refreshClientDetailActivityIfOpen(s.clientId);
  showToast('success', 'Note added', 'Only you can see it.');
  if(s.cal && s.followUp && data?.id) await addNoteToCalendar(data.id);
}

// "Log as Improvement" opens the Log Improvement sheet with this note's client and words, to
// edit before logging. Once logged, the note is marked done (see saveQueueLogImprovement).
async function noteLogImprovement(){
  const s = noteSheet; if(!s || !s.id) return;
  noteCapture(); await noteSaveNow(s);
  const n = notes.find(x => x.id === s.id); if(!n) return;
  noteSheet = null; noteSheetDomClose(s, true);
  openQueueLogImprovementModal(n.clientId);
  logSheet.fromNote = n.id;
  const t = document.getElementById('liText');
  if(t){ t.value = noteAsImprovement(n); setTimeout(() => { t.focus(); t.setSelectionRange(t.value.length, t.value.length); }, 40); }
}
async function noteMarkLogged(id){
  const m = noteLoggedMap(); m[id] = new Date().toISOString();
  try{ localStorage.setItem('bda_notes_logged', JSON.stringify(m)); }catch(e){}
  const { error } = await supabaseClient.from('notes').update({ status: 'done' }).eq('id', id).eq('user_id', currentUser.id);
  if(error) showToast('error', 'Note not marked done', error.message);
  await loadMyNotes();
  renderNotes();
}

// ---- closing ---------------------------------------------------------------------------------
async function closeNoteSheet(){
  const s = noteSheet; if(!s) return;
  if(!s.id){
    const t = (document.getElementById('nsTitle')?.value || '').trim();
    if((t || noteBodyText()) && !(await confirmDialog('Discard this note?', { confirmLabel: 'Discard', destructive: true }))) return;
  } else noteCapture();
  if(noteSheet !== s) return;
  noteSheet = null;
  noteSheetDomClose(s);
  if(s.id) await noteSaveNow(s);
}
function noteSheetDomClose(s, instant){
  document.getElementById('nsMenu')?.remove();
  if(s.modal){ if(document.querySelector('#appModalOverlay .n1-sheet')) closeAppModal(); return; }
  const host = document.getElementById('noteSheetHost'); if(!host) return;
  const sh = host.querySelector('.n1-sheet'), sc = host.querySelector('.n1-scrim');
  const back = () => { const f = s.prevFocus; if(f && document.contains(f) && typeof f.focus === 'function') f.focus(); else host.closest('.n1-wrap')?.querySelector(`[data-note="${s.id}"]`)?.focus(); };
  if(!sh || instant || !sh.animate || matchMedia('(prefers-reduced-motion: reduce)').matches){ host.innerHTML = ''; if(!instant) back(); return; }
  // Out the way it came in, a little quicker: the page drops away while the dimming clears.
  host.style.pointerEvents = 'none';
  sc?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-out', fill: 'forwards' });
  sh.animate([{ opacity: 1, transform: 'translateX(-50%)' }, { opacity: 0, transform: 'translateX(-50%) translateY(8px) scale(.98)' }], { duration: 150, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' })
    .onfinish = () => { if(host.contains(sh)) host.innerHTML = ''; host.style.pointerEvents = ''; };
  back();
}
function noteSheetKey(e){
  if(e.key === 'Escape'){
    e.stopPropagation(); e.preventDefault();
    const m = document.getElementById('nsMenu'); if(m){ m.remove(); return; }
    closeNoteSheet(); return;
  }
  if(e.key !== 'Tab' || !noteSheet || noteSheet.modal) return;
  const f = getModalFocusableElements(e.currentTarget); if(!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if(e.shiftKey && (document.activeElement === first || document.activeElement === e.currentTarget)){ e.preventDefault(); last.focus(); }
  else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
}

// N starts a new note while you're on Notes (not while typing somewhere).
document.addEventListener('keydown', e => {
  if((e.key !== 'n' && e.key !== 'N') || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
  if(typeof currentViewName === 'undefined' || currentViewName !== 'notes' || noteSheet) return;
  const t = e.target;
  if(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  if(document.querySelector('.modal-overlay, .sheet-overlay')) return;
  e.preventDefault();
  openNoteSheet('new');
});
// Text wraps differently at a new width, so the editor's fields re-measure.
window.addEventListener('resize', () => { if(noteSheet) document.querySelectorAll('.n1-sheet textarea').forEach(noteFit); });
