// Powers the Assistant chat feature — both the floating button and its
// own tab share this one endpoint and one ongoing conversation. Admin/
// approver only, matching the app's existing role system, enforced here
// server-side (not just hidden in the UI, which anyone could bypass by
// calling this endpoint directly).
//
// Branches between Claude and OpenAI based on settings.aiProvider (an
// admin-configurable choice in Settings), rather than being locked to one
// provider — but it's still one file/one function, since this project is
// already at Vercel Hobby's 12-function limit and a second endpoint
// isn't an option. Whichever provider is chosen still needs its own API
// key already set as an environment variable here — this endpoint lets
// an admin pick which one gets used, not enter a new key through the
// app itself, since a secret typed into the browser would defeat the
// entire point of keeping it server-side.
//
// Note on OpenAI + web search specifically: this uses the Responses API
// (POST /v1/responses), not Chat Completions — the older Chat
// Completions "-search-preview" models (which an earlier version of
// this file used) were deprecated by OpenAI shortly after, shutting
// down 2026-07-23. The Responses API's web_search tool works with the
// regular gpt-4o-mini model directly — genuinely the same model draft
// generation uses elsewhere in this app, not just the same account —
// and the model decides case-by-case whether a search is actually
// needed, rather than always searching on every message.
//
// The daily cap exists because, unlike almost everything else in this
// app, every message here costs real money. DAILY_MESSAGE_CAP is
// deliberately just a constant here, not a settings-page value, since a
// cost control like this shouldn't be trivially raised from inside the
// app itself.
//
// POST body: { messages: [{role, content}, ...], appContext: '...' }
// appContext is a plain-text summary (clients, danger scores, recent
// activity) built client-side from data already loaded in the browser —
// no extra database queries needed here just to give the assistant that
// context.

const { createClient } = require('@supabase/supabase-js');

const DAILY_MESSAGE_CAP = 40;
const CLAUDE_MODEL = 'claude-sonnet-5';
const OPENAI_MODEL = 'gpt-4o-mini';

async function callClaude(messages, systemPrompt) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return { ok: false, error: 'Missing ANTHROPIC_API_KEY' };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1500,
      system: systemPrompt,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    }),
  });
  const data = await res.json();
  if (!res.ok) return { ok: false, error: data?.error?.message || 'Claude request failed' };
  const textBlocks = (data.content || []).filter(b => b.type === 'text').map(b => b.text);
  return { ok: true, reply: textBlocks.join('\n\n') };
}

async function callOpenAI(messages, systemPrompt) {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return { ok: false, error: 'Missing OPENAI_API_KEY' };

  // Responses API, not Chat Completions — the older Chat Completions
  // "-search-preview" models are deprecated (shutdown 2026-07-23 per
  // OpenAI's own docs). The current, correct way to get web search with
  // a regular model is the Responses API's web_search tool, where the
  // model decides for itself whether a search is actually needed per
  // message, rather than always searching on every single one.
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      tools: [{ type: 'web_search' }],
      input: [{ role: 'system', content: systemPrompt }, ...messages.map(m => ({ role: m.role, content: m.content }))],
    }),
  });
  const data = await res.json();
  if (!res.ok) return { ok: false, error: data?.error?.message || 'OpenAI request failed' };
  // The output array can contain a web_search_call item alongside the
  // actual message item (mirroring how Claude interleaves tool-use
  // blocks with text) — filter for the message item's own text content
  // rather than assume a single flat field.
  const textParts = (data.output || [])
    .filter(item => item.type === 'message')
    .flatMap(item => (item.content || []).filter(c => c.type === 'output_text').map(c => c.text));
  return { ok: true, reply: textParts.join('\n\n').trim() };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) { res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }); return; }

  const admin = createClient(supabaseUrl, serviceKey);

  const callerToken = (req.headers.authorization || '').replace('Bearer ', '');
  if (!callerToken) { res.status(401).json({ error: 'Not signed in' }); return; }

  try {
    const { data: callerData, error: callerErr } = await admin.auth.getUser(callerToken);
    if (callerErr || !callerData?.user) {
      res.status(401).json({ error: 'Invalid or expired session — please log in again' });
      return;
    }
    const { data: callerProfile, error: profileErr } = await admin
      .from('team_profiles').select('role, name').eq('id', callerData.user.id).maybeSingle();
    if (profileErr || !callerProfile) {
      res.status(403).json({ error: 'Could not verify your account' });
      return;
    }
    if (!['admin', 'approver'].includes(callerProfile.role)) {
      res.status(403).json({ error: 'The assistant is only available to admins and approvers right now.' });
      return;
    }

    const { messages, appContext } = req.body || {};
    if (!Array.isArray(messages) || !messages.length) {
      res.status(400).json({ error: 'Missing messages' });
      return;
    }

    // Enforced here, server-side, with the count read fresh from the
    // database rather than trusted from anything the client sent —
    // otherwise the cap would just be a UI suggestion, not a real limit.
    const today = new Date().toISOString().slice(0, 10);
    const { data: usageRow } = await admin
      .from('claude_chat_usage').select('message_count').eq('user_id', callerData.user.id).eq('usage_date', today).maybeSingle();
    const usedToday = usageRow?.message_count || 0;
    if (usedToday >= DAILY_MESSAGE_CAP) {
      res.status(429).json({ error: `You've hit today's limit (${DAILY_MESSAGE_CAP} messages). Resets tomorrow.` });
      return;
    }

    const { data: settingsRow } = await admin.from('app_storage').select('value').eq('key', 'settings').maybeSingle();
    const settings = settingsRow ? JSON.parse(settingsRow.value) : {};
    const provider = settings.aiProvider === 'openai' ? 'openai' : 'claude';

    const systemPrompt = `You're a helpful assistant built into Based Agency's internal client-work dashboard, talking with ${callerProfile.name || 'a team member'}. You can see a live snapshot of the team's current client data below — use it for anything specific to their clients, and use web search for anything else, including looking up a specific client's actual website when asked to check it or propose improvements.

Current client data:
${appContext || '(no client data provided)'}`;

    const result = provider === 'openai'
      ? await callOpenAI(messages, systemPrompt)
      : await callClaude(messages, systemPrompt);

    if (!result.ok) {
      res.status(502).json({ error: result.error });
      return;
    }

    // Only after a genuinely successful call — a failed request shouldn't
    // count against the person's daily allowance.
    await admin.from('claude_chat_usage').upsert(
      { user_id: callerData.user.id, usage_date: today, message_count: usedToday + 1 },
      { onConflict: 'user_id,usage_date' }
    );

    res.status(200).json({ reply: result.reply, remainingToday: DAILY_MESSAGE_CAP - (usedToday + 1), provider });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
