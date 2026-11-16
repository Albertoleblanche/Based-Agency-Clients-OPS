// Custom date and time picker components.

// Generic reusable calendar-dropdown date picker — a plain type="date"
// input's native picker looks and behaves differently across
// browsers/OSes, so every client-facing date field in the app renders a
// consistent one in the app's own style instead. Parameterized by field
// id rather than one bespoke copy per field (originally built just for
// the client Start Date field, then generalized here so every field
// using it is guaranteed identical behavior/style with no drift risk
// between copies). Each instance is a hidden <input id="{id}"> (so every
// existing .value read/min/required check keeps working unchanged) plus
// a button+dropdown pair built by datePickerFieldHtml().
const datePickerViewDates = {}; // id -> Date currently shown in that picker's grid

function formatDatePickerDisplay(val){
  return new Date(val+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
}

// opts: { value, minDate, maxDate, disabled } — minDate/maxDate are
// 'YYYY-MM-DD' strings, same convention as toDateStr(). Renders inside
// whatever label/wrapper markup the call site already has, same shape as
// a plain <input> would.
function datePickerFieldHtml(id, opts={}){
  const { value='', minDate='', maxDate='', disabled=false } = opts;
  const hasValue = !!value;
  return `
    <input type="hidden" id="${id}" value="${escapeHtml(value)}" data-min-date="${minDate}" data-max-date="${maxDate}">
    <button type="button" id="${id}Btn" onclick="toggleDatePickerCalendar('${id}', event)" ${disabled?'disabled':''} style="width:100%;text-align:left;font-family:var(--font);font-size:13px;padding:9px 12px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--ink);cursor:${disabled?'not-allowed':'pointer'};display:flex;align-items:center;justify-content:space-between;${disabled?'opacity:.6;':''}">
      <span id="${id}Display" style="color:${hasValue?'var(--ink)':'var(--muted-lt)'};">${hasValue?formatDatePickerDisplay(value):'Select a date'}</span>
      <svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M208,32H184V24a8,8,0,0,0-16,0v8H88V24a8,8,0,0,0-16,0v8H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM72,48v8a8,8,0,0,0,16,0V48h80v8a8,8,0,0,0,16,0V48h24V80H48V48ZM208,208H48V96H208V208Z"/></svg>
    </button>
    <div class="calendar-dropdown" id="${id}Calendar" style="display:none;"></div>`;
}

// Sets a picker's value programmatically (form reset/prefill contexts) —
// same as clicking a day, just without the click. Fires a real 'change'
// event so any onchange="..." already wired to this field's id keeps
// working unchanged, exactly as if a native input had fired it.
function setDatePickerValue(id, value){
  const input = document.getElementById(id);
  if(!input) return;
  input.value = value || '';
  syncDatePickerDisplay(id);
  input.dispatchEvent(new Event('change', { bubbles:true }));
}

function syncDatePickerDisplay(id){
  const displayEl = document.getElementById(id+'Display');
  if(!displayEl) return;
  const val = document.getElementById(id)?.value;
  if(val){ displayEl.textContent = formatDatePickerDisplay(val); displayEl.style.color = 'var(--ink)'; }
  else { displayEl.textContent = 'Select a date'; displayEl.style.color = 'var(--muted-lt)'; }
}

// Positions the dropdown relative to the button's actual on-screen
// location (like positionClaudePanel() does for the floating Assistant
// panel), clamped so it can't run off any edge — fixed positioning means
// it renders above whatever modal it's in entirely, not clipped by
// .modal-card's overflow-y:auto the way an absolutely-positioned child
// confined to the modal's own bounds would be.
function positionDatePickerCalendar(id){
  const btn = document.getElementById(id+'Btn');
  const el = document.getElementById(id+'Calendar');
  if(!btn || !el) return;
  const btnRect = btn.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const gap = 6, edge = 12;
  const vw = window.innerWidth, vh = window.innerHeight;

  let left = btnRect.left;
  let top = btnRect.bottom + gap;
  if(top + elRect.height > vh - edge) top = btnRect.top - elRect.height - gap; // flip above if no room below

  left = Math.max(edge, Math.min(left, vw - elRect.width - edge));
  top = Math.max(edge, Math.min(top, vh - elRect.height - edge));

  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

function toggleDatePickerCalendar(id, event){
  event?.stopPropagation();
  const el = document.getElementById(id+'Calendar');
  if(!el) return;
  const opening = el.style.display !== 'block';
  el.style.display = opening ? 'block' : 'none';
  if(opening){
    // Moved to document.body, out of the modal's DOM subtree entirely —
    // not just visually escaping it via position:fixed. Some browsers
    // still clip a fixed-position element nested inside a scrolling
    // ancestor despite the spec saying they shouldn't; actually removing
    // it from that ancestor's subtree sidesteps the question rather than
    // depending on every browser getting the edge case right.
    // closeAppModal() removes any of these it finds when the modal
    // closes, since they're no longer descendants that get cleaned up
    // automatically with the rest of it.
    if(el.parentElement !== document.body) document.body.appendChild(el);
    const current = document.getElementById(id).value;
    datePickerViewDates[id] = current ? new Date(current+'T00:00:00') : new Date();
    renderDatePickerCalendar(id);
    positionDatePickerCalendar(id);
  }
}

function shiftDatePickerMonth(id, delta){
  const cur = datePickerViewDates[id] || new Date();
  datePickerViewDates[id] = new Date(cur.getFullYear(), cur.getMonth()+delta, 1);
  renderDatePickerCalendar(id);
  positionDatePickerCalendar(id); // grid row count (5 vs 6 weeks) can shift height between months
}

function renderDatePickerCalendar(id){
  const el = document.getElementById(id+'Calendar');
  const input = document.getElementById(id);
  if(!el || !input) return;
  const selected = input.value;
  const minDate = input.dataset.minDate || '';
  const maxDate = input.dataset.maxDate || '';
  const viewDate = datePickerViewDates[id] || new Date();
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const todayStr = toDateStr(new Date());
  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = firstOfMonth.getDay();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const monthLabel = firstOfMonth.toLocaleDateString('en-US',{month:'long',year:'numeric'});

  let cells = '';
  for(let i=0;i<startWeekday;i++) cells += `<div></div>`;
  for(let d=1; d<=daysInMonth; d++){
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isOutOfRange = (minDate && dateStr < minDate) || (maxDate && dateStr > maxDate);
    const isSelected = dateStr === selected;
    const isToday = dateStr === todayStr;
    cells += `<button type="button" class="dp-calendar-day${isSelected?' selected':''}${isToday?' today':''}" ${isOutOfRange?'disabled':''} onclick="event.stopPropagation();selectDatePickerDate('${id}','${dateStr}')">${d}</button>`;
  }
  const todayOutOfRange = (minDate && todayStr < minDate) || (maxDate && todayStr > maxDate);

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--border);">
      <button type="button" onclick="event.stopPropagation();shiftDatePickerMonth('${id}',-1)" style="border:none;background:none;cursor:pointer;color:var(--muted);padding:4px;font-size:14px;">‹</button>
      <span style="font-size:12.5px;font-weight:600;color:var(--ink);">${monthLabel}</span>
      <button type="button" onclick="event.stopPropagation();shiftDatePickerMonth('${id}',1)" style="border:none;background:none;cursor:pointer;color:var(--muted);padding:4px;font-size:14px;">›</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;padding:10px 12px;justify-items:center;">
      ${['S','M','T','W','T','F','S'].map(d=>`<div style="font-size:10px;color:var(--muted-lt);text-align:center;font-weight:600;width:28px;">${d}</div>`).join('')}
      ${cells}
    </div>
    <div style="padding:8px 12px;border-top:1px solid var(--border);display:flex;justify-content:space-between;">
      <button type="button" onclick="event.stopPropagation();selectDatePickerDate('${id}','')" style="font-size:11.5px;color:var(--muted);background:none;border:none;cursor:pointer;">Clear</button>
      <button type="button" ${todayOutOfRange?'disabled':''} onclick="event.stopPropagation();selectDatePickerDate('${id}','${todayStr}')" style="font-size:11.5px;color:${todayOutOfRange?'var(--muted-lt)':'var(--brand-dark)'};background:none;border:none;cursor:${todayOutOfRange?'not-allowed':'pointer'};font-weight:600;">Today</button>
    </div>
  `;
}

function selectDatePickerDate(id, dateStr){
  const input = document.getElementById(id);
  if(!input) return;
  input.value = dateStr;
  syncDatePickerDisplay(id);
  document.getElementById(id+'Calendar').style.display = 'none';
  input.dispatchEvent(new Event('change', { bubbles:true }));
}

// One outside-click listener covers every open date picker on the page —
// checks every .calendar-dropdown currently visible (there's realistically
// only ever one open at a time, but this doesn't assume that) rather than
// one hardcoded listener per field.
document.addEventListener('click', (e)=>{
  document.querySelectorAll('.calendar-dropdown').forEach(calendarEl=>{
    if(calendarEl.style.display !== 'block') return;
    const btn = document.getElementById(calendarEl.id.replace(/Calendar$/, 'Btn'));
    if(!calendarEl.contains(e.target) && e.target !== btn && !btn?.contains(e.target)){
      calendarEl.style.display = 'none';
    }
  });
});

// Time picker — same button+hidden-input shape and same visual language
// as the date picker above (so "the style we're going for" is genuinely
// one style, not two similar-but-different ones), and deliberately reuses
// its dropdown ID convention ("{id}Calendar") on purpose: the outside-click
// listener above, and closeAppModal()'s .calendar-dropdown cleanup, both
// already work on any element matching that pattern regardless of
// content, so the time picker gets both of those for free without
// duplicating that logic a third time. A plain type="time" input only
// reliably opens its native picker when you click exactly on the small
// clock icon in most browsers — this makes the entire field clickable.
function formatTimeDisplay(val){
  if(!val) return '';
  const [h,m] = val.split(':').map(Number);
  const period = h>=12 ? 'PM' : 'AM';
  const h12 = h%12===0 ? 12 : h%12;
  return `${h12}:${String(m).padStart(2,'0')} ${period}`;
}

function timePickerFieldHtml(id, opts={}){
  const { value='09:00', disabled=false } = opts;
  return `
    <input type="hidden" id="${id}" value="${escapeHtml(value)}">
    <button type="button" id="${id}Btn" onclick="toggleTimePickerDropdown('${id}', event)" ${disabled?'disabled':''} style="width:100%;text-align:left;font-family:var(--font);font-size:13px;padding:9px 12px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--ink);cursor:${disabled?'not-allowed':'pointer'};display:flex;align-items:center;justify-content:space-between;${disabled?'opacity:.6;':''}">
      <span id="${id}Display">${formatTimeDisplay(value)}</span>
      <svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm64-88a8,8,0,0,1-8,8H128a8,8,0,0,1-8-8V72a8,8,0,0,1,16,0v48h48A8,8,0,0,1,192,128Z"/></svg>
    </button>
    <div class="calendar-dropdown" id="${id}Calendar" style="display:none;width:150px;max-height:240px;overflow-y:auto;"></div>`;
}

function renderTimePickerDropdown(id){
  const el = document.getElementById(id+'Calendar');
  const input = document.getElementById(id);
  if(!el || !input) return;
  const selected = input.value;
  let itemsHtml = '';
  for(let h=0; h<24; h++){
    for(let m=0; m<60; m+=15){
      const val = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
      itemsHtml += `<button type="button" class="time-picker-option${val===selected?' selected':''}" onclick="event.stopPropagation();selectTimePickerValue('${id}','${val}')">${formatTimeDisplay(val)}</button>`;
    }
  }
  el.innerHTML = itemsHtml;
}

function toggleTimePickerDropdown(id, event){
  event?.stopPropagation();
  const el = document.getElementById(id+'Calendar');
  if(!el) return;
  const opening = el.style.display !== 'block';
  el.style.display = opening ? 'block' : 'none';
  if(opening){
    if(el.parentElement !== document.body) document.body.appendChild(el);
    renderTimePickerDropdown(id);
    positionDatePickerCalendar(id); // generic — works off {id}Btn/{id}Calendar regardless of content
    const selectedEl = el.querySelector('.time-picker-option.selected');
    if(selectedEl) selectedEl.scrollIntoView({ block:'center' });
  }
}

function selectTimePickerValue(id, val){
  const input = document.getElementById(id);
  if(!input) return;
  input.value = val;
  const displayEl = document.getElementById(id+'Display');
  if(displayEl) displayEl.textContent = formatTimeDisplay(val);
  document.getElementById(id+'Calendar').style.display = 'none';
  input.dispatchEvent(new Event('change', { bubbles:true }));
}

// Shared by both picker types — toggles the trigger button's actual
// disabled state/styling, since disabling a hidden input alone (the old
// native-input approach) has no visible effect once the real control is
// the button in front of it.
function setPickerDisabled(id, disabled){
  const btn = document.getElementById(id+'Btn');
  const input = document.getElementById(id);
  if(btn){ btn.disabled = disabled; btn.style.cursor = disabled?'not-allowed':'pointer'; btn.style.opacity = disabled?'.6':'1'; }
  if(input) input.disabled = disabled;
}
