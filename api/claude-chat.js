// Powers the Claude chat feature — both the floating button and its own
// tab share this one endpoint and one ongoing conversation. Admin/
// approver only, matching the app's existing role system, enforced here
// server-side (not just hidden in the UI, which anyone could bypass by
// calling this endpoint directly).
//
// The daily cap exists because, unlike almost everything else in this
// app, every message here costs real money — checking a client's website
// costs more than a plain reply, since it means Claude actually fetching
// and reading a real page. DAILY_MESSAGE_CAP is deliberately just a
// constant here, not a settings-page value, since a cost control like
// this shouldn't be trivially raised from inside the app itself.
//
// POST body: { messages: [{role, content}, ...], appContext: '...' }
// appContext is a plain-text summary (clients, danger scores, recent
// activity) built client-side from data already loaded in the browser —
// no extra database queries needed here just to give Claude that context.

const { createClient } = require('@supabase/supabase-js');

const DAILY_MESSAGE_CAP = 40;
const CLAUDE_MODEL = 'claude-sonnet-5';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!anthropicKey) { res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY' }); return; }
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

    const systemPrompt = `You're a helpful assistant built into Based Agency's internal client-work dashboard, talking with ${callerProfile.name || 'a team member'}. You can see a live snapshot of the team's current client data below — use it for anything specific to their clients, and use web search for anything else, including looking up a specific client's actual website when asked to check it or propose improvements.

Current client data:
${appContext || '(no client data provided)'}`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
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
    const claudeData = await claudeRes.json();
    if (!claudeRes.ok) {
      res.status(502).json({ error: claudeData?.error?.message || 'Claude request failed' });
      return;
    }

    // Only after a genuinely successful call — a failed request shouldn't
    // count against the person's daily allowance.
    await admin.from('claude_chat_usage').upsert(
      { user_id: callerData.user.id, usage_date: today, message_count: usedToday + 1 },
      { onConflict: 'user_id,usage_date' }
    );

    const textBlocks = (claudeData.content || []).filter(b => b.type === 'text').map(b => b.text);
    res.status(200).json({ reply: textBlocks.join('\n\n'), remainingToday: DAILY_MESSAGE_CAP - (usedToday + 1) });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
