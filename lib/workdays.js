// The team doesn't work weekends, so Radar stays quiet on Saturdays and Sundays: the daily jobs
// leave their reminders for Monday morning, and lib/slack-notify.js sends no Slack messages then.
// "Saturday" is the team's Saturday, in the time zone saved in Settings (settings.timezone), else
// TEAM_TIMEZONE, else New York.

const DEFAULT_TZ = 'America/New_York';
let cached = { at: 0, tz: null };

function validTz(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (e) { return false; }
}

// The team's time zone, read at most every 10 minutes per server instance.
async function teamTimezone(admin) {
  if (cached.tz && Date.now() - cached.at < 10 * 60000) return cached.tz;
  let tz = null;
  try {
    const { data } = await admin.from('app_storage').select('value').eq('key', 'settings').maybeSingle();
    const s = data && data.value ? JSON.parse(data.value) : {};
    if (validTz(s.timezone)) tz = s.timezone;
  } catch (e) {}
  if (!tz) tz = validTz(process.env.TEAM_TIMEZONE) ? process.env.TEAM_TIMEZONE : DEFAULT_TZ;
  cached = { at: Date.now(), tz };
  return tz;
}

function isWeekend(tz, when) {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: validTz(tz) ? tz : DEFAULT_TZ, weekday: 'short' }).format(when || new Date());
  return day === 'Sat' || day === 'Sun';
}

async function isTeamWeekend(admin, when) {
  return isWeekend(await teamTimezone(admin), when);
}

// for tests
function resetWorkdaysCache() { cached = { at: 0, tz: null }; }

module.exports = { teamTimezone, isWeekend, isTeamWeekend, resetWorkdaysCache };
