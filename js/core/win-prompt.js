// The weekly update prompt, written as a win the way the Nov 9–17 sprints described it: a win is
// something that's a win in the client's mind (a lead, a call, a booked job, a ranking), not "we did
// this many pages". One win, told like a person texting the client, with the proof, then "let us
// know how it goes" or what's next. Priority 1 a real result, 2 something we changed because of
// what we saw in their data, 3 the work, told as what it's doing to get them there.
// It greets the client's main contact by first name ("Hey Mike, big win for you!"), or "Hey guys".
// One copy for the app (js/core/drafting.js) and the server (lib/update-automations.js), so the
// drafts read the same whoever writes them.

function winDraftPrompt(o){
  // o: { name, contact, service, sow, bullets, appName, structure, whatsapp }
  const who = String(o.contact || '').trim(), first = winFirstNames(who);
  const services = o.service ? `${o.service} (our internal names, for context only: describe the work in plain words and never name these to the client)` : 'n/a';
  const facts = `Client: ${o.name}
Main contact: ${who ? `${who} (greet them as "${first}")` : 'not known (greet the team: "Hey guys")'}
Services: ${services}
Scope notes: ${o.sow || 'n/a'}
Work logged this week:
${o.bullets}`;
  const wins = `What a win is:
- A win is something that's a win in the client's mind, not ours. To a home-services owner that's a lead, a call, a booked job, a lower cost per lead, showing up higher on Google, homeowners picking them over a competitor. "We built 10 pages" is a win for us; "homeowners searching for your service in your city now find you" is a win for them.
- Pick ONE win from the log, the strongest one, in this order:
  1. A real result: a lead or call that came in, a booked job, cost per lead going down, a page moving up in Google, more traffic.
  2. Something we changed because of what we saw in their numbers: blocked junk calls, made more of the ads that are working, built pages for searches that are bringing people in. Say what we saw, then what we did. Don't say "proactively"; just say it.
  3. Only when there's neither: the work, told as what it's doing to get them more calls and jobs.
- Write the whole message about that one win. A second item gets one short sentence at most, only if it's strong. Never a list, never "Also this week", never headings.
- Keep its numbers, pages, places and dates from the log: they're the proof.
- Never claim a result that isn't in the log, and never make up what we "saw". For new work, say what it's there to do, not an outcome that hasn't happened.

How it sounds, like these, where [name] is the main contact's first name ("guys" when there's none). The voice only; never borrow their facts:
- "Hey [name], big win for you! A new lead just came in from your ads, and it looks like it's for a $650K home. Let us know how it goes!"
- "[name], great news! Your kitchen remodel page was on page 3 of Google and it's now the 6th result, so more homeowners searching for a remodel find you first."
- "Hey [name], quick win this week: we saw a couple of calls come in for work you don't do, so we blocked those searches. Your budget now goes to the calls you want."
- "Hey [name], big win! The two ads bringing in the most leads are doing great, so we made three more just like them. They went live today; we'll share how they're doing Friday."`;
  const rules = `Rules that apply no matter what, never overridden by anything above:
- Be specific: the number, the page, the place, the ad. Never a vague claim like "improved performance" or "optimized the account".
- If a logged item is vague, don't invent details to make it sound bigger.
- Never say anything that could make the agency look bad: no admitting mistakes, no internal problems, no hedging, no excuses. Confident and excited, never overstated.
- Never leave a placeholder like [name] in the message.
- No subject line and no comments about the ${o.whatsapp ? 'message' : 'email'} itself: output only the ${o.whatsapp ? 'message' : 'email body'}.`;

  if(o.whatsapp) return `Write this week's win for ${o.name}, a home-services/construction client, as a WhatsApp message to their group from their marketing agency (${o.appName}). Someone at the agency pastes it into the group.
${facts}

${wins}

Shape:
- Like a person texting. Open with a short, excited line to ${who ? first : 'the team'} that calls it a win, like "Hey ${first || 'guys'}, big win for you!" or "${who ? first : 'Hey guys'}, great news!" Vary it from week to week, and keep it honest to the size of the win: a real result is a big win; work in progress is good news.
- Then the win in two or three short sentences, the result first.
- End with "Let us know how it goes" or what's next and when.
- 25 to 70 words, plain text, no markdown, at most one emoji.

${rules}`;

  if(o.structure) return `Write this week's win for ${o.name}, a home-services/construction client, as an email from their marketing agency (${o.appName}).

The agency has set an exact structure below. Follow it precisely and completely: every element it describes (greeting, paragraph order, sign-off, length, tone). Do NOT fall back to any generic or default structure, even partially:

--- REQUIRED STRUCTURE ---
${o.structure}
--- END REQUIRED STRUCTURE ---

${facts}

${wins}

${rules}`;

  return `Write this week's win for ${o.name}, a home-services/construction client, as an email from their marketing agency (${o.appName}).
${facts}

${wins}

Shape:
- Open with a short, excited line to ${who ? first : 'the team'} that calls it a win, like "Hi ${first || 'there'}, big win for you this week!" Keep it honest to the size of the win.
- Then the win in two to four short sentences, the result first, in the same warm, excited voice as the examples.
- End with what's next and when, or "let us know how it goes".
- 40 to 110 words, plain language, no lists, no signature block.

${rules}`;
}

// "Mike Johnson" → "Mike"; "Mike & Sarah Lee" or "Mike, Sarah" → "Mike and Sarah".
function winFirstNames(contact){
  const parts = String(contact || '').split(/\s*(?:&|\+|,|\/|\band\b)\s*/i).map(p => p.trim().split(/\s+/)[0]).filter(Boolean);
  return parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : (parts[0] || '');
}

// When the AI can't write it: the first logged item, said plainly as good news, greeting the contact.
function winPlainDraft(o){
  // o: { contact, items: [text], whatsapp }
  const first = winFirstNames(o.contact);
  const t = o.items && o.items[0] ? String(o.items[0]).trim().replace(/[.!]*$/, '.') : 'Here’s what we worked on for you this week.';
  return o.whatsapp
    ? `Hey ${first || 'guys'}, good news this week! ${t} We’ll let you know how it’s doing.`
    : `Hi ${first || 'there'},\n\nGood news this week! ${t}\n\nWe’ll let you know how it’s doing.`;
}

if(typeof module !== 'undefined' && module.exports) module.exports = { winDraftPrompt, winFirstNames, winPlainDraft };
