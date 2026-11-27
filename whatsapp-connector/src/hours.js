// The team's clock (Nov 24), in Radar's WhatsApp time zone: when alerts may go out, and how long a
// client has waited counted in work hours only.
import { config } from './config.js';

const DAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
export function teamClock(when = new Date()){
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: config.tz, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
    .formatToParts(when).map(x => [x.type, x.value]));
  return { day: DAYS[p.weekday], h: Number(p.hour) % 24, m: Number(p.minute) };
}
const weekday = d => d >= 1 && d <= 5;

// Alerts go out on weekdays from 7:00 to 21:00; anything found outside that waits for the morning.
export function inAlertHours(when = new Date()){
  const c = teamClock(when);
  return weekday(c.day) && c.h >= 7 && c.h < 21;
}

// Minutes of work time (weekdays, config.workHours, e.g. 9–18) between two moments, in 5-minute
// steps and at most ten days apart: a client who writes on Friday evening hasn't waited all weekend.
export function workMinutes(from, to = new Date()){
  const a = new Date(from).getTime(), b = new Date(to).getTime();
  if(!(b > a)) return 0;
  const [h0, h1] = config.workHours, step = 5 * 60000, end = Math.min(b, a + 10 * 86400000);
  let n = 0;
  for(let t = a; t < end; t += step){
    const c = teamClock(new Date(t));
    if(weekday(c.day) && c.h >= h0 && c.h < h1) n += 5;
  }
  return n;
}
export function minutesWords(n){
  if(n < 60) return `${Math.max(1, Math.round(n))} min`;
  const h = Math.floor(n / 60), m = Math.round(n % 60 / 5) * 5;
  return m ? `${h}h ${m}m` : `${h}h`;
}
