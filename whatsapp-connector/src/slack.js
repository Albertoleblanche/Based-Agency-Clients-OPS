import { config } from './config.js';

export async function slackDM(userId, text){
  const token = config.slackToken();
  if(!token || !userId) return false;
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ channel: userId, text, unfurl_links: false }),
  });
  const j = await res.json().catch(() => ({}));
  if(!j.ok) console.error('Slack error:', j.error);
  return !!j.ok;
}
