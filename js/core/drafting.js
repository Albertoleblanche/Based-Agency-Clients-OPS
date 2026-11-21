// How a client's weekly update is written: the AI prompt (with the writer's own structure
// from their profile, and the rules every update follows) and the plain version used when
// the AI isn't available. Shared by the desktop app and the phone app; the server's copy
// for automatic drafts is in lib/update-automations.js.

function buildUpdatePrompt(c, includedImprovements){
  // win-prompt.js: the same prompt the server's automatic drafts use
  return winDraftPrompt({
    name: c.name, contact: clientContact(c), service: c.service, sow: c.sow, appName: settings.appName || 'Based Agency',
    bullets: includedImprovements.map(i => '- ' + i.text).join('\n'),
    structure: ((myProfile && myProfile.email_instructions) || '').trim(),
    // a client who gets its win in its WhatsApp group: a short group message, not an email
    whatsapp: typeof winViaWhatsapp === 'function' && winViaWhatsapp(c),
  });
}
function plainUpdateDraft(c, items){
  return winPlainDraft({ contact: clientContact(c), items: items.map(i => i.text), whatsapp: typeof winViaWhatsapp === 'function' && winViaWhatsapp(c) });
}
