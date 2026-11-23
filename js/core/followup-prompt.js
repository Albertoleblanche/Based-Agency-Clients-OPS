// The nudge: a short follow-up to a client who hasn't answered a question yet, written by the AI
// from a reminder in Reminders. Friendly, easy to answer, never pushy, and it never makes the
// agency look bad. Email (a subject and a body) or a WhatsApp message, by how the client hears
// from us. One copy for the desktop app (work-canvas.js) and the iPhone app (mobile/app.js).
// Needs winFirstNames (js/core/win-prompt.js).

function followUpPrompt(o){
  // o: { client, contact, ask, askedOn, waitedDays, sender, agency, whatsapp }
  const who = String(o.contact || '').trim(), first = typeof winFirstNames === 'function' ? winFirstNames(who) : who.split(/\s+/)[0];
  const kind = o.whatsapp ? 'WhatsApp message to their group' : 'email';
  return `Write a short follow-up ${kind} to ${o.client}, a home-services/construction client, from ${o.sender ? o.sender + ' at ' : ''}their marketing agency (${o.agency || 'Based Agency'}). We asked them something and are still waiting on the answer.

What we're waiting on (our own internal note, NOT text to copy): ${o.ask}
Asked: ${o.askedOn || 'recently'}${o.waitedDays != null ? ` (${o.waitedDays} day${o.waitedDays === 1 ? '' : 's'} ago, for your context only)` : ''}
Main contact: ${who ? `${who} (greet them as "${first}")` : 'not known'}

How to write it:
- Turn the note into the one thing we need from them, said plainly. Never copy its wording: a note like "Follow up with Sahar on the Austin website launch date" becomes asking Sahar for the launch date of the Austin website.
- If the note names the person to ask, greet that person by first name; otherwise the main contact; otherwise ${o.whatsapp ? '"Hey guys"' : '"Hi there"'}.
- Warm and light, like a quick note from someone they like working with. One clear question, and make it easy to answer when it fits (a rough date is fine, a quick yes or no works).
- Only use facts from the note. Never invent a deadline, a date, a reason, a meeting or a detail.
- Never say or hint that they're slow or late: no "just checking in", "friendly reminder", "as per my last message", "I haven't heard back", "still waiting", "circling back", "bumping this", and no counting days.
- Never make the agency look bad: no apologizing, no admitting delays, mistakes or problems on our side, no excuses.
${o.whatsapp
    ? `- Like a text: two or three short sentences, 15 to 50 words, plain text, at most one emoji, no sign-off.
- Reply with JSON only, no other text: {"subject": "", "body": "the message"}`
    : `- The body: a greeting line, then two or three short sentences (25 to 80 words), then "Thanks," and ${o.sender ? `"${o.sender}"` : 'no name'} on the next line. No signature block.
- The subject: under 8 words, says what it's about (like "Austin website launch date"), never "Following up", "Reminder" or "Checking in".
- Reply with JSON only, no other text: {"subject": "...", "body": "..."}`}`;
}

// When the AI can't write it: a plain, friendly version.
function followUpPlain(o){
  const who = String(o.contact || '').trim(), first = typeof winFirstNames === 'function' ? winFirstNames(who) : who.split(/\s+/)[0];
  const ask = String(o.ask || '').replace(/^\s*follow(?:ing)?[\s-]*up\s+(?:with\s+\S+\s+)?(?:on|about|re:?)\s+/i, '').replace(/\s+$/, '').replace(/[.?!]+$/, '');
  if(o.whatsapp) return { subject: '', body: `Hey ${first || 'guys'}! Quick one: any update on ${ask.charAt(0).toLowerCase() + ask.slice(1)}?` };
  return {
    subject: ask.length > 60 ? ask.slice(0, 57).trim() + '…' : ask.charAt(0).toUpperCase() + ask.slice(1),
    body: `Hi ${first || 'there'},\n\nQuick one when you have a minute: any update on ${ask.charAt(0).toLowerCase() + ask.slice(1)}?\n\nThanks,\n${o.sender || ''}`.trim(),
  };
}

// The AI's answer, as { subject, body }; a plain reply becomes the body.
function followUpParse(text, whatsapp){
  const t = String(text || '').trim();
  if(!t) return null;
  const m = t.match(/\{[\s\S]*\}/);
  if(m){ try{ const j = JSON.parse(m[0]); if(j && typeof j.body === 'string' && j.body.trim()) return { subject: whatsapp ? '' : String(j.subject || '').trim(), body: j.body.trim() }; }catch(e){} }
  return { subject: '', body: t.replace(/^```\w*\n?|```$/g, '').trim() };
}

if(typeof module !== 'undefined' && module.exports) module.exports = { followUpPrompt, followUpPlain, followUpParse };
