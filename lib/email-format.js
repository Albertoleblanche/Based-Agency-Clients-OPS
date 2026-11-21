// Turns a plain-text client update into the HTML email that goes out, with the agency's
// signature from Settings. Shared by api/send-email.js (Approve & Send) and the scheduled
// send in lib/update-automations.js, so both emails look the same.

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

module.exports = { plainTextToHtml, buildSignatureHtml, escapeHtml };
