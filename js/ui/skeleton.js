// Loading inside a screen (canvas "Loading", Nov 20): instead of a spinner and "Loading tasks…",
// each screen shows its own shape in soft placeholders that shine together, so nothing jumps when
// the content arrives. They fade in only after a moment, so a quick load never flashes them.
// skeletonHtml(kind, label): kind is dashboard, tasks, notes, calendar, time, whatsapp, chat or rows.

function skBar(w, cls, style){ return `<span class="sk ${cls || 't'}" style="width:${typeof w === 'number' ? w + 'px' : w}${style ? ';' + style : ''}"></span>`; }
// What a screen reader hears while the placeholders show.
function skLabel(label){ return `<span class="sk-sr">${escapeHtml(label || 'Loading…')}</span>`; }
function skWrap(cls, inner, label){ return `<div class="skw ${cls}" role="status" aria-busy="true">${skLabel(label)}${inner}</div>`; }
// Two lines a row: what it is, and the line under it.
function skRow(w1, w2){ return `<div class="sk-row">${skBar(w1 + '%')}${skBar(w2 + '%', 's')}</div>`; }
// The page's own title and the line under it, as on Tasks and WhatsApp.
function skPageHead(right){ return `<div class="sk-ph"><div class="sk-ph-t">${skBar(190, 't', 'height:22px;border-radius:7px')}${skBar(240, 's')}</div>${right ? `<div class="sk-ph-r">${right}</div>` : ''}</div>`; }

const SK_KINDS = {
  rows: () => [[62, 38], [74, 46], [56, 34]].map(([a, b]) => skRow(a, b)).join(''),
  dashboard: () => {
    const card = (rows, lo) => `<div class="sk-dc${lo ? ' lo' : ''}"><div class="sk-dc-h">${skBar(16, 't', 'height:16px;border-radius:5px')}${skBar(70)}<span class="sk-fl"></span>${skBar(84, 's')}</div>${rows.map(([a, b]) => skRow(a, b)).join('')}</div>`;
    return `<div class="sk-dg">${card([[62, 38], [70, 44], [54, 40], [66, 36]])}${card([[78, 46], [66, 52], [72, 40], [58, 44]])}${card([[64, 30], [74, 34], [60, 28], [70, 36]])}${card([[86, 52], [80, 48], [74, 50]], 1)}${card([[58, 70], [62, 66], [54, 72]], 1)}${card([[60, 46], [68, 80], [52, 74]], 1)}</div>`;
  },
  tasks: () => {
    const cols = [[52, 4], [78, 2], [56, 1], [44, 2]].map(([hw, n]) => `<div class="sk-col"><div class="sk-col-h">${skBar(hw)}${skBar(14, 's')}</div>${
      [[82, 54], [68, 46], [74, 58], [64, 50]].slice(0, n).map(([a, b]) => `<div class="sk-card">${skBar(a + '%')}${skBar(b + '%', 's')}<div class="sk-card-f">${skBar(58, 's')}<span class="sk-fl"></span>${skBar(32, 's')}</div></div>`).join('')}</div>`).join('');
    return skPageHead(`${skBar(120, 'b')}${skBar(84, 'b')}${skBar(110, 'b')}`) + `<div class="sk-cols">${cols}</div>`;
  },
  notes: () => `<div class="sk-jot">${skBar('100%', 'b', 'height:36px;border-radius:10px;flex:1 1 auto')}${skBar(96, 'b')}${skBar(150, 'b')}</div><div class="sk-tiles">${
    [[70, 60], [56, 72], [78, 48], [62, 66], [74, 52], [50, 70]].map(([a, b]) => `<div class="sk-tile">${skBar(46, 's')}${skBar(a + '%', 't', 'height:15px')}${skBar('94%', 's')}${skBar('88%', 's')}${skBar(b + '%', 's')}<span class="sk-fl"></span>${skBar(90, 's')}</div>`).join('')}</div>`,
  calendar: () => {
    const days = '<span></span>' + Array.from({ length: 7 }, () => `<span>${skBar(52, 's')}</span>`).join('');
    const hrs = Array.from({ length: 9 }, (_, i) => `<span class="sk-hr" style="top:${(i + 1) * 64}px"></span><span class="sk-ht" style="top:${(i + 1) * 64 - 5}px">${skBar(30, 's')}</span>`).join('');
    const evs = [[[40, 46], [300, 60]], [[130, 92]], [[60, 40], [330, 62]], [[190, 60], [430, 46]], [[96, 46], [380, 70]], [], []];
    const cols = '<span></span>' + evs.map(es => `<div class="sk-cc">${es.map(([t, h]) => `<span class="sk sk-ev" style="top:${t}px;height:${h}px"></span>`).join('')}</div>`).join('');
    return `<div class="sk-cal"><div class="sk-days">${days}</div><div class="sk-grid">${hrs}${cols}</div></div>`;
  },
  time: () => {
    const rows = [[46, 30], [58, 26], [40, 34], [52, 28]].map(([a, b]) => `<div class="sk-tr">${skBar(70, 's')}<div class="sk-tr-m">${skBar(a + '%')}${skBar(b + '%', 's')}</div>${skBar(40)}</div>`).join('');
    const side = `${skBar(110)}<div style="height:14px"></div>${[[70], [62], [66]].map(([a]) => `<div class="sk-li">${skBar(a + '%', 's')}<span class="sk-fl"></span>${skBar(30, 's')}</div>`).join('')}<div style="height:26px"></div>${skBar(130)}<div style="height:14px"></div>${[0, 1, 2, 3].map(() => `<div class="sk-li col">${skBar('60%', 's')}${skBar('100%', 's', 'height:4px')}</div>`).join('')}`;
    return `<div class="tmi"><div class="sk-tmh">${skBar(26, 'b')}${skBar(240, 't', 'height:18px;border-radius:7px')}<span class="sk-fl"></span>${skBar(150, 'b')}</div><div class="tmi-cols"><section>${rows}</section><aside>${side}</aside></div></div>`;
  },
  whatsapp: () => {
    const group = (n, rows) => `<div class="sk-wg">${skBar(n, 't', 'margin:22px 0 8px')}${rows.map(([a, b]) => `<div class="sk-wr">${skBar(18, 'c', 'height:18px')}<div class="sk-tr-m">${skBar(a + '%')}${skBar(b + '%', 's')}</div>${skBar(44, 's')}</div>`).join('')}</div>`;
    const side = `${skBar(110, 't', 'margin-top:22px')}<div style="height:12px"></div>${[0, 1, 2, 3, 4].map(() => `<div class="sk-li">${skBar(60, 's')}<span class="sk-fl"></span>${skBar(20, 's')}</div>`).join('')}`;
    return skPageHead(`${skBar(150, 'b')}${skBar(90, 'b')}`) + `<div class="sk-wcols"><div>${group(150, [[52, 62], [60, 70]])}${group(120, [[58, 66], [48, 72]])}${group(130, [[56, 60]])}</div><aside>${side}</aside></div>`;
  },
  chat: () => [[90, 60], [70], [84, 40], [80, 74, 30]].map((ws, i) => `<div class="sk-bub${i === 2 ? ' me' : ''}">${ws.map(w => skBar(w + '%', 's')).join('')}</div>`).join(''),
};
function skeletonHtml(kind, label){
  const fn = SK_KINDS[kind] || SK_KINDS.rows;
  return skWrap(`sk-${kind}`, fn(), label);
}
