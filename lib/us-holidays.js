// US holidays, the same days the app skips (js/core/helpers.js usHolidays): used by the Radar
// connector's sprints and by Today's Plan, which tells Claude when clients are off.
const ymd = d => d.toISOString().slice(0, 10);
function nthDow(y, m, dow, n) {
  if (n > 0) { const first = new Date(Date.UTC(y, m, 1)); return new Date(Date.UTC(y, m, 1 + (dow - first.getUTCDay() + 7) % 7 + 7 * (n - 1))); }
  const last = new Date(Date.UTC(y, m + 1, 0)); return new Date(Date.UTC(y, m, last.getUTCDate() - (last.getUTCDay() - dow + 7) % 7));
}
const observed = d => { const w = d.getUTCDay(); return w === 6 ? new Date(d.getTime() - 86400000) : w === 0 ? new Date(d.getTime() + 86400000) : d; };
const _hol = {};
function holidaysOf(y) {
  if (_hol[y]) return _hol[y];
  const thanks = nthDow(y, 10, 4, 4), out = {};
  [[observed(new Date(Date.UTC(y, 0, 1))), 'New Year’s Day'], [nthDow(y, 0, 1, 3), 'Martin Luther King Jr. Day'], [nthDow(y, 1, 1, 3), 'Presidents’ Day'],
   [nthDow(y, 4, 1, -1), 'Memorial Day'], [observed(new Date(Date.UTC(y, 5, 19))), 'Juneteenth'], [observed(new Date(Date.UTC(y, 6, 4))), 'Independence Day'],
   [nthDow(y, 8, 1, 1), 'Labor Day'], [thanks, 'Thanksgiving'], [new Date(thanks.getTime() + 86400000), 'Day after Thanksgiving'],
   [observed(new Date(Date.UTC(y, 11, 24))), 'Christmas Eve'], [observed(new Date(Date.UTC(y, 11, 25))), 'Christmas Day']]
    .forEach(([d, n]) => { out[ymd(d)] = n; });
  return (_hol[y] = out);
}
const holidayOn = ds => holidaysOf(Number(ds.slice(0, 4)))[ds] || holidaysOf(Number(ds.slice(0, 4)) + 1)[ds] || '';
module.exports = { nthDow, observed, holidaysOf, holidayOn };
