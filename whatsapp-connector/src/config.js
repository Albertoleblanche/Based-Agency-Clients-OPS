import 'dotenv/config';

function need(name){
  const v = process.env[name];
  if(!v) throw new Error(`Missing ${name} in .env (see .env.example)`);
  return v;
}
const list = (v, d='') => (v ?? d).split(',').map(s => s.trim()).filter(Boolean);

export const config = {
  supabaseUrl: () => need('SUPABASE_URL'),
  supabaseKey: () => need('SUPABASE_SERVICE_ROLE_KEY'),
  anthropicKey: () => need('ANTHROPIC_API_KEY'),
  slackToken: () => process.env.SLACK_BOT_TOKEN || '',
  model: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5',
  // The quick read of each new burst of client messages (urgent, needs a reply, signals, details)
  watchModel: process.env.WATCH_MODEL || 'claude-haiku-5-5',
  // Work hours for counting how long a client has waited, and the wait that nudges the owner
  workHours: (process.env.WORK_HOURS || '9-18').split('-').map(Number),
  waitNudgeMinutes: Number(process.env.WAIT_NUDGE_MINUTES || 120),
  tz: process.env.TZ || 'America/New_York',
  digestTimes: list(process.env.DIGEST_TIMES, '09:00,15:00'),
  groupPattern: new RegExp(process.env.GROUP_NAME_PATTERN || 'marketing', 'i'),
  groupAllowlist: list(process.env.GROUP_ALLOWLIST, 'American Mutual Insurance | Based Agency').map(s => s.toLowerCase()),
  teamHints: list(process.env.TEAM_SENDER_HINTS, 'Based Agency,Albert,Stan,Eric,Charlie,Dan,Daniel,Joey').map(s => s.toLowerCase()),
  adminKeys: list(process.env.ADMIN_KEYS, 'eric,dan').map(s => s.toLowerCase()),
  radarUrl: process.env.RADAR_URL || '',
  contextDays: Number(process.env.CONTEXT_DAYS || 7),
  authDir: process.env.AUTH_DIR || 'auth',
  // Test mode, from Radar (wa_settings.pilot_user_ids). null until Radar's settings load:
  // no Slack messages go out before then. [] = live.
  pilotIds: null,
};

export function isClientGroup(name){
  if(!name) return false;
  return config.groupPattern.test(name) || config.groupAllowlist.includes(name.trim().toLowerCase());
}
