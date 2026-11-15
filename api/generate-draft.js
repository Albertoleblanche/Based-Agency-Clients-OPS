// Vercel serverless function — runs on Vercel's servers, never in the browser.
// The OpenAI API key lives only here, as an environment variable, so it's
// never exposed to anyone viewing the site's source or network requests.

const { requireTeamMember } = require('../lib/require-team-member');
const { callOpenAI, OPENAI_MODEL } = require('../lib/ai-client');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Signed-in team members only — otherwise anyone who found this URL could
  // run unlimited AI requests on the agency's OpenAI account.
  const auth = await requireTeamMember(req, res);
  if (!auth) return;

  const { prompt, model } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ error: 'Missing "prompt" in request body' });
    return;
  }
  if (prompt.length > 60000) {
    res.status(400).json({ error: 'Prompt is too long' });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    res.status(500).json({ error: 'Server is not configured with OPENAI_API_KEY' });
    return;
  }

  try {
    // Goes through the shared OpenAI client (Responses API) — the same path
    // the Assistant already uses. The old Chat Completions call sent
    // max_tokens, which newer models (GPT-5 family) reject. Caller passes
    // settings.openaiModel (admin-editable in Settings -> AI & Email);
    // falls back to the shared default if not sent.
    const result = await callOpenAI(
      [{ role: 'user', content: prompt }],
      null, // no system prompt — the prompt carries all instructions, as before
      { model: (typeof model === 'string' && model.trim()) || OPENAI_MODEL, webSearch: false }
    );
    if (!result.ok) {
      res.status(502).json({ error: `OpenAI API error: ${result.error}` });
      return;
    }
    res.status(200).json({ text: result.reply });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
