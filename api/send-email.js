// Vercel serverless function — sends a real email via Resend. This only ever
// runs after the person has reviewed the message and clicked "Send Email" in
// the confirmation popup; nothing here fires automatically on its own.

const { requireTeamMember } = require('../lib/require-team-member');

// Escapes plain text for safe inclusion in HTML, then converts line breaks
// to <br> and blank lines to paragraph spacing — the body itself was
// written as plain text (that's still what shows in the "text" version and
// the modal the person reviewed), so this is just making it presentable as
// HTML too, not reformatting the actual content.
function plainTextToHtml(text) {
  const escaped = String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped.split('\n\n').map(para =>
    `<p style="margin:0 0 14px;">${para.replace(/\n/g, '<br>')}</p>`
  ).join('');
}

// Table-based layout with inline styles throughout — standard practice for
// HTML email specifically because flexbox/grid and <style> blocks aren't
// reliably supported across mail clients, unlike in this app's own UI.
function escapeHtml(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// Only web links in the signature — never javascript: or other schemes.
function safeHttpUrl(u) {
  const s = String(u || '').trim();
  return /^https?:\/\//i.test(s) ? s : '';
}

function buildSignatureHtml(rawSig) {
  if (!rawSig || !(rawSig.companyName || rawSig.phone || rawSig.email || rawSig.website || rawSig.address || rawSig.logoUrl)) return '';
  // Escape every admin-entered value once, up front, since all of it ends
  // up inside HTML sent to clients.
  const sig = {
    companyName: escapeHtml(rawSig.companyName), phone: escapeHtml(rawSig.phone), email: escapeHtml(rawSig.email),
    website: escapeHtml(rawSig.website), address: escapeHtml(rawSig.address), teamLine: rawSig.teamLine,
    logoUrl: escapeHtml(safeHttpUrl(rawSig.logoUrl)),
  };
  const brand = '#E8622C';
  const teamLines = String(sig.teamLine || '').split('\n').map(l => escapeHtml(l.trim())).filter(Boolean);
  const contactRow = (icon, text, href) => {
    if (!text) return '';
    const inner = href ? `<a href="${href}" style="color:#333333;text-decoration:underline;">${text}</a>` : text;
    return `<tr><td style="padding:0 0 6px;font-size:13px;color:#333333;font-family:Arial,Helvetica,sans-serif;"><span style="color:${brand};margin-right:6px;">${icon}</span>${inner}</td></tr>`;
  };
  const websiteHref = rawSig.website ? escapeHtml(/^https?:\/\//i.test(rawSig.website) ? rawSig.website : `https://${rawSig.website}`) : null;
  const phoneHref = rawSig.phone ? `tel:${String(rawSig.phone).replace(/[^0-9+]/g, '')}` : null;
  return `
    <table cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;font-family:Arial,Helvetica,sans-serif;">
      <tr><td style="font-weight:bold;font-size:14px;color:#1a1a1a;padding-bottom:12px;">Thank you,</td></tr>
      <tr><td>
        <table cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="vertical-align:top;padding-right:20px;">
            ${sig.companyName ? `<div style="font-weight:bold;font-size:16px;color:#1a1a1a;margin-bottom:4px;">${sig.companyName}</div>` : ''}
            ${teamLines.map(l => `<div style="font-size:12px;color:#666666;line-height:1.5;">${l}</div>`).join('')}
          </td>
          <td style="border-left:2px solid ${brand};padding-left:20px;vertical-align:top;">
            <table cellpadding="0" cellspacing="0" border="0">
              ${contactRow('&#9742;', sig.phone, phoneHref)}
              ${contactRow('&#9993;', sig.email, sig.email ? `mailto:${sig.email}` : null)}
              ${contactRow('&#127760;', sig.website, websiteHref)}
              ${contactRow('&#128205;', sig.address, null)}
            </table>
          </td>
        </tr></table>
      </td></tr>
      ${sig.logoUrl ? `<tr><td style="border-top:2px solid ${brand};padding-top:16px;"><img src="${sig.logoUrl}" alt="${sig.companyName || 'Logo'}" style="height:40px;width:auto;display:block;"></td></tr>` : ''}
    </table>`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Signed-in team members only. Without this, anyone who found the URL
  // could send any message to anyone from the agency's sending address.
  const auth = await requireTeamMember(req, res);
  if (!auth) return;

  const { to, subject, body, includeSignature } = req.body || {};
  if (!to || !subject || !body) {
    res.status(400).json({ error: 'Missing to, subject, or body' });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Server is not configured with RESEND_API_KEY' });
    return;
  }

  // Defaults to Resend's shared sandbox sender, which only delivers to the
  // email address on your own Resend account — fine for testing, but you'll
  // want to verify your own domain in Resend and set EMAIL_FROM (e.g.
  // "Based Agency <updates@youragency.com>") before sending to real clients.
  const from = process.env.EMAIL_FROM || 'Based Agency <onboarding@resend.dev>';

  // "to" may be a single address or a comma-separated list (the Notify
  // Approvers flow sends to both Daniel and Eric at once).
  const recipients = String(to).split(',').map(s => s.trim()).filter(Boolean);
  if (!recipients.length) {
    res.status(400).json({ error: 'No valid recipient email address' });
    return;
  }

  const emailPayload = { from, to: recipients, subject, text: body };

  // Only client update/improvement emails ask for this — internal
  // notifications (Notify Approvers, daily summaries, etc.) never pass
  // includeSignature, so they stay plain text exactly as before. Signature
  // content itself lives in admin Settings, not here, so it can be updated
  // without touching this file.
  if (includeSignature) {
    try {
      const { data: settingsRow } = await auth.admin.from('app_storage').select('value').eq('key', 'settings').maybeSingle();
      const settings = settingsRow ? JSON.parse(settingsRow.value) : {};
      const signatureHtml = buildSignatureHtml(settings.emailSignature);
      if (signatureHtml) {
        emailPayload.html = plainTextToHtml(body) + signatureHtml;
      }
    } catch (e) {
      // A signature failing to load is not worth blocking the send over —
      // falls through to a plain-text send below instead of erroring out
      // on something the person already reviewed and approved.
      console.error('Could not build email signature, sending without it', e);
    }
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(emailPayload),
    });

    const data = await response.json();
    if (!response.ok) {
      res.status(response.status).json({ error: data.message || 'Resend rejected the request' });
      return;
    }

    res.status(200).json({ success: true, id: data.id });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
