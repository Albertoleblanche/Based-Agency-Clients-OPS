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
  tz: process.env.TZ || 'America/New_York',
  digestTimes: list(process.env.DIGEST_TIMES, '09:00,15:00'),
  groupPattern: new RegExp(process.env.GROUP_NAME_PATTERN || 'marketing', 'i'),
  groupAllowlist: list(process.env.GROUP_ALLOWLIST, 'American Mutual Insurance | Based Agency').map(s => s.toLowerCase()),
  teamHints: list(process.env.TEAM_SENDER_HINTS, 'Based Agency,Albert,Stan,Eric,Charlie,Dan,Daniel,Joey').map(s => s.toLowerCase()),
  adminKeys: list(process.env.ADMIN_KEYS, 'eric,dan').map(s => s.toLowerCase()),
  radarUrl: process.env.RADAR_URL || '',
  contextDays: Number(process.env.CONTEXT_DAYS || 7),
  authDir: process.env.AUTH_DIR || 'auth',
};

export function isClientGroup(name){
  if(!name) return false;
  return config.groupPattern.test(name) || config.groupAllowlist.includes(name.trim().toLowerCase());
}
