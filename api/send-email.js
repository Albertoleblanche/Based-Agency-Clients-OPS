// Vercel serverless function — sends a real email via Resend. This only ever
// runs after the person has reviewed the message and clicked "Send Email" in
// the confirmation popup; nothing here fires automatically on its own.

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { to, subject, body } = req.body || {};
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

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to: recipients,
        subject,
        text: body,
      }),
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
