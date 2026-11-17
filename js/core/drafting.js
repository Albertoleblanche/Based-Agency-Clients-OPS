// How a client's weekly update is written: the AI prompt (with the writer's own structure
// from their profile, and the rules every update follows) and the plain version used when
// the AI isn't available. Shared by the desktop app and the phone app; the server's copy
// for automatic drafts is in lib/update-automations.js.

function buildUpdatePrompt(c, includedImprovements){
  const bullets = includedImprovements.map(i=>'- '+i.text).join('\n');
  const customStructure = ((myProfile && myProfile.email_instructions) || '').trim();
  const contentRules = `Content rules that apply no matter what — never overridden by anything above:
- Describe every improvement as a specific, measurable deliverable — a concrete action taken, a number, a metric, or a defined output. Never state it as a vague, broad claim (e.g. never say "improved performance," "made things better," "optimized the account" with nothing concrete attached).
- If a logged improvement itself is vague or lacks a concrete detail, do not invent specifics to make it sound more impressive — describe only what was actually logged, worded as precisely as the source allows, and keep it modest rather than embellished.
- Never say anything that could make the agency look bad: no admitting mistakes, no exposing internal problems, no hedging language that implies something isn't working, no comparisons that read as excuses. State what was done factually and confidently without overstating results.
- No subject line, no meta-commentary about the email itself — output only the email body.`;

  return customStructure
    ? `Write a weekly client update email for a home-services/construction client from their marketing agency (${settings.appName || 'Based Agency'}).

The agency has specified an exact structure below. Follow it precisely and completely — every element it describes (greeting, paragraph order, sign-off, length, tone) — and do NOT fall back to any generic or default email structure, even partially:

--- REQUIRED STRUCTURE ---
${customStructure}
--- END REQUIRED STRUCTURE ---

Client: ${c.name}
Service: ${c.service}
Scope notes: ${c.sow || 'n/a'}
Improvements made this week:
${bullets}

${contentRules}`
    : `Write a short, warm, professional weekly update email to a home-services/construction client from their marketing agency (${settings.appName || 'Based Agency'}).
Client: ${c.name}
Service: ${c.service}
Scope notes: ${c.sow || 'n/a'}
Improvements made this week:
${bullets}

Structure: 2-4 short paragraphs max, no fluff or filler compliments, plain language, no subject line, no signature block, sound like a competent account manager not a sales email. End by noting nothing is needed from them unless something explicitly requires their input.

${contentRules}`;
}

function plainUpdateDraft(c, items){
  const name = c.contactName || c.contact_name || '';
  return `Hi${name ? ' ' + firstName(name) : ''},\n\nHere’s what we worked on for ${c.name} this week:\n\n${items.map(i => '- ' + i.text).join('\n')}\n\nNothing is needed from you right now. We’ll keep you posted on what’s next.`;
}
