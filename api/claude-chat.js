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
// The actual Claude/OpenAI calling logic (model names, tool config,
// response parsing) lives in lib/ai-client.js now, shared with
// api/cron-wednesday-notify.js's weekly proactive-insights job — see
// that file's header comment for why this was pulled out rather than
// hand-copied a second time.
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
const { callAI } = require('../lib/ai-client');

const DAILY_MESSAGE_CAP = 40;

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
    const { mode } = req.body || {};

    // ---- AI Visibility Reporting Engine's "run this prompt live" feature —
    // a fundamentally different use case from the Assistant chat below: no
    // agency system prompt (this needs to see exactly what a real member of
    // the public would get from Claude/ChatGPT directly, not a persona
    // wrapped around it), no daily cap (that control is specifically about
    // Assistant usage), admin-only rather than ai_chat_enabled (a
    // different permission entirely, matching that whole feature's own
    // gating). Kept in this same file/function rather than a new one, same
    // Vercel Hobby 12-function ceiling as everything else here.
    if (mode === 'visibility-test') {
      const { data: callerProfile } = await admin.from('team_profiles').select('role').eq('id', callerData.user.id).maybeSingle();
      if (!callerProfile || callerProfile.role !== 'admin') {
        res.status(403).json({ error: 'AI Visibility Reports are admin-only' });
        return;
      }
      const { prompt, provider: testProvider } = req.body || {};
      if (!prompt || typeof prompt !== 'string') { res.status(400).json({ error: 'Missing prompt' }); return; }
      const useProvider = testProvider === 'openai' ? 'openai' : 'claude';
      const { data: settingsRow } = await admin.from('app_storage').select('value').eq('key', 'settings').maybeSingle();
      const testSettings = settingsRow ? JSON.parse(settingsRow.value) : {};
      const testModel = useProvider === 'openai' ? testSettings.openaiModel : testSettings.claudeModel;
      const { data: connectionRow } = await admin.from('ai_provider_connections').select('api_key, base_url').eq('provider', useProvider).maybeSingle();
      const testResult = await callAI(useProvider, [{ role: 'user', content: prompt }],
        'Answer the following question naturally and directly, exactly as you normally would if a member of the public asked you this.',
        { model: testModel, apiKey: connectionRow?.api_key || null, baseUrl: connectionRow?.base_url || null, webSearch: true }
      );
      if (!testResult.ok) { res.status(502).json({ error: testResult.error }); return; }
      res.status(200).json({ reply: testResult.reply });
      return;
    }

    // ---- AI Visibility Reporting Engine's "Overview" section — reads an
    // uploaded screenshot from the team's external visibility tool
    // directly (vision), instead of requiring the same data to be
    // manually re-entered into the Platform Matrix's checkboxes. Same
    // admin-only gating and reasoning as visibility-test above. Never
    // uses a custom base_url here (unlike visibility-test) — third-party
    // "OpenAI-compatible" endpoints support vision inconsistently, so
    // this always goes through the real provider APIs rather than
    // silently failing or misbehaving on some custom endpoint.
    if (mode === 'vision-analyze') {
      const { data: callerProfile } = await admin.from('team_profiles').select('role').eq('id', callerData.user.id).maybeSingle();
      if (!callerProfile || callerProfile.role !== 'admin') {
        res.status(403).json({ error: 'AI Visibility Reports are admin-only' });
        return;
      }
      const { prompt: visionPrompt, images, provider: visionProvider } = req.body || {};
      if (!visionPrompt || typeof visionPrompt !== 'string') { res.status(400).json({ error: 'Missing prompt' }); return; }
      if (!Array.isArray(images) || !images.length) { res.status(400).json({ error: 'Missing images' }); return; }
      const useVisionProvider = visionProvider === 'openai' ? 'openai' : 'claude';
      const { data: settingsRow } = await admin.from('app_storage').select('value').eq('key', 'settings').maybeSingle();
      const visionSettings = settingsRow ? JSON.parse(settingsRow.value) : {};
      const visionModel = useVisionProvider === 'openai' ? visionSettings.openaiModel : visionSettings.claudeModel;
      const { data: connectionRow } = await admin.from('ai_provider_connections').select('api_key').eq('provider', useVisionProvider).maybeSingle();
      const visionResult = await callAI(useVisionProvider, [{ role: 'user', content: visionPrompt }],
        'You are analyzing a screenshot for a marketing agency\'s internal reporting.',
        { model: visionModel, apiKey: connectionRow?.api_key || null, webSearch: false, images }
      );
      if (!visionResult.ok) { res.status(502).json({ error: visionResult.error }); return; }
      res.status(200).json({ reply: visionResult.reply });
      return;
    }

    // ---- Existing Assistant chat flow below, unchanged ----
    const { data: callerProfile, error: profileErr } = await admin
      .from('team_profiles').select('role, name, ai_chat_enabled').eq('id', callerData.user.id).maybeSingle();
    if (profileErr || !callerProfile) {
      res.status(403).json({ error: 'Could not verify your account' });
      return;
    }
    // A real per-person toggle now, not a blanket role check — an admin
    // can grant this to a specific member or revoke it from a specific
    // admin/approver from that person's team card. Enforced here
    // server-side, not just hidden in the UI, same reasoning as
    // everything else this endpoint already checks.
    if (!callerProfile.ai_chat_enabled) {
      res.status(403).json({ error: 'The assistant isn\'t enabled for your account — ask an admin to turn it on.' });
      return;
    }

    const { messages, appContext, providerOverride, needsTitle } = req.body || {};
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
    const defaultProvider = settings.aiProvider === 'openai' ? 'openai' : 'claude';
    // A per-person, per-conversation override from the model picker next
    // to the chat input — lets someone try the other provider for their
    // own messages without changing the admin's team-wide default in
    // Settings. Only used if it's a recognized value; anything else (or
    // the "Default" option, sent as empty/missing) falls back to the
    // admin's own setting.
    const provider = ['claude', 'openai'].includes(providerOverride) ? providerOverride : defaultProvider;
    // settings.claudeModel/settings.openaiModel are admin-editable in
    // Settings -> AI & Email — callAI falls back to its own hardcoded
    // default if unset, so this is safe even before an admin has ever
    // touched those fields.
    const model = provider === 'openai' ? settings.openaiModel : settings.claudeModel;
    // An admin-connected key from Settings -> AI & Email's Connect flow
    // (ai_provider_connections), if one exists — callAI falls back to the
    // Vercel environment variable when this is null, so a deployment
    // that's never used Connect keeps working exactly as before.
    // base_url, if set, points this provider at a custom OpenAI-compatible
    // endpoint (Azure OpenAI, Mistral, a self-hosted model, etc.) instead
    // of the real provider — only ever meaningful for openai.
    const { data: connectionRow } = await admin.from('ai_provider_connections').select('api_key, base_url').eq('provider', provider).maybeSingle();
    const apiKey = connectionRow?.api_key || null;
    const baseUrl = connectionRow?.base_url || null;

    const assistantName = settings.assistantName || 'Assistant';
    const userFirstName = (callerProfile.name || '').trim().split(/\s+/)[0] || null;
    // Admin-editable in Settings -> AI & Email, appended below rather than
    // replacing anything — the core mechanics above (identity, name
    // handling, client-data awareness) stay protected so an admin can
    // tune tone/behavior/extra rules without needing to touch this file
    // or risk breaking how the Assistant actually works.
    const customInstructions = (settings.assistantCustomInstructions || '').trim();

    const systemPrompt = `Your name is ${assistantName}. You're built into ${settings.appName || 'Based Agency'}'s internal client-work dashboard, talking with ${callerProfile.name || 'a team member'}${userFirstName ? ` (call them ${userFirstName} when it feels natural — not in every message, just the way a real coworker would use someone's name occasionally, not as a formal greeting every time)` : ''}. If asked your name, you're ${assistantName} — don't say you're Claude or ChatGPT or name the underlying model/provider. You can see a live snapshot of the team's current client data below — use it for anything specific to their clients, and use web search for anything else, including looking up a specific client's actual website when asked to check it or propose improvements.

Don't just answer the literal question and stop there — the way a genuinely useful teammate would, follow a good answer with whatever's actually relevant next: a concrete next step, something worth flagging, or a recommendation based on what you can see in the client data (a rising danger score, a stale client, an overdue follow-up). Keep this natural and skip it when there's genuinely nothing useful to add — don't force a "next steps" section onto every single reply regardless of whether one's warranted.
${customInstructions ? `\nAdditional instructions from the team — follow these, and let them override the general guidance above if the two ever conflict:\n${customInstructions}\n` : ''}
Current client data:
${appContext || '(no client data provided)'}`;

    // Kicked off at the same time as the main reply, not after it — a
    // second sequential call just to name the chat would add real latency
    // to every first message of a new conversation. Only fired when the
    // frontend flags this as a brand-new conversation (needsTitle) —
    // every later message in the same conversation skips this entirely.
    // A failure here just means no suggested title comes back; the
    // frontend already has its own truncated-text fallback for that.
    const resultPromise = callAI(provider, messages, systemPrompt, { model, apiKey, baseUrl });

    let titlePromise = Promise.resolve(null);
    if (needsTitle && Array.isArray(messages) && messages.length) {
      const firstUserMessage = messages.find(m => m.role === 'user')?.content || '';
      if (firstUserMessage) {
        titlePromise = callAI(provider, [{ role: 'user', content: firstUserMessage }],
          'Generate a short title (3-6 words, no quotes, no trailing punctuation) summarizing what this chat is about, based on the person\'s message. Respond with ONLY the title text and nothing else.',
          { maxTokens: 20, webSearch: false, model, apiKey, baseUrl }
        ).catch(() => null);
      }
    }

    const [result, titleResult] = await Promise.all([resultPromise, titlePromise]);

    if (!result.ok) {
      // A friendlier message specifically when it's the person's OWN
      // override that's missing its key (not the admin's own default, and
      // not some unrelated failure like a rate limit) — the raw
      // "Missing X_API_KEY" is fine for an admin debugging Settings, but
      // confusing for a teammate who just picked an option from a
      // dropdown. Checked against the exact string lib/ai-client.js
      // returns for a missing key, not just "any failure while overriding",
      // so an unrelated error (rate limit, network issue) still shows its
      // real message instead of a misleading "not configured" one.
      const isMissingKeyFailure = typeof result.error === 'string' && result.error.startsWith('Missing ');
      const friendlyError = (provider !== defaultProvider && isMissingKeyFailure)
        ? `${provider === 'openai' ? 'ChatGPT' : 'Claude'} isn't set up on this server yet — switch back to "Default" in the model picker, or ask an admin to add the API key.`
        : result.error;
      res.status(502).json({ error: friendlyError });
      return;
    }

    // Only after a genuinely successful call — a failed request shouldn't
    // count against the person's daily allowance.
    await admin.from('claude_chat_usage').upsert(
      { user_id: callerData.user.id, usage_date: today, message_count: usedToday + 1 },
      { onConflict: 'user_id,usage_date' }
    );

    res.status(200).json({
      reply: result.reply,
      remainingToday: DAILY_MESSAGE_CAP - (usedToday + 1),
      provider,
      suggestedTitle: (titleResult && titleResult.ok && titleResult.reply) ? titleResult.reply.trim() : null,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
