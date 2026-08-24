// Vercel serverless function — runs on Vercel's servers, never in the browser.
// The OpenAI API key lives only here, as an environment variable, so it's
// never exposed to anyone viewing the site's source or network requests.

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { prompt, model } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ error: 'Missing "prompt" in request body' });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Server is not configured with OPENAI_API_KEY' });
    return;
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        // Caller passes settings.openaiModel (admin-editable in Settings ->
        // AI & Email, shared with the Assistant's OpenAI path — see that
        // panel's copy) — falls back to gpt-4o-mini if not sent, so this
        // stays backward-compatible with any caller that doesn't pass one.
        model: (typeof model === 'string' && model.trim()) || 'gpt-4o-mini',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      res.status(response.status).json({ error: `OpenAI API error: ${errText}` });
      return;
    }

    const data = await response.json();
    const text = (data.choices?.[0]?.message?.content || '').trim();

    res.status(200).json({ text });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
