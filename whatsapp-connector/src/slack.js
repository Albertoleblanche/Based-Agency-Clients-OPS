import { config } from './config.js';

// No emojis in anything sent to Slack (Nov 23): not ours, and not ones copied from a client's message
// (pictographs, flags, keycaps, and :shortcodes: that Slack would turn into one).
export function noEmoji(text){
  return String(text || '')
    .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\u{FE0F}\u{FE0E}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}]/gu, '')
    .replace(/(^|[\s(]):[a-z0-9_+-]{2,40}:(?=[\s).,!?]|$)/gim, '$1')
    .replace(/[ \t]{2,}/g, ' ').replace(/^[ \t]+|[ \t]+$/gm, '');
}

export async function slackDM(userId, text){
  const token = config.slackToken();
  if(!token || !userId) return false;
  text = noEmoji(text);
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ channel: userId, text, unfurl_links: false }),
  });
  const j = await res.json().catch(() => ({}));
  if(!j.ok) console.error('Slack error:', j.error);
  return !!j.ok;
}
