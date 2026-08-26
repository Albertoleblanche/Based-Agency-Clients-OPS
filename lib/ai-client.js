// Shared Claude/OpenAI calling logic — used by api/claude-chat.js (the
// interactive Assistant tab/floating button) and api/cron-wednesday-notify.js
// (the weekly proactive-insights job). Both need "ask an LLM something,
// optionally with web search, get plain text back" — factored out here so
// there's exactly one place that knows the model names, the tool config,
// and how to parse each provider's response shape. Before this, that logic
// lived only in claude-chat.js; a second hand-copied version in the cron
// job would be exactly the kind of quiet drift this project has repeatedly
// caught elsewhere (two copies of the same logic, one of them stops
// getting updated).
//
// Kept in lib/ (not api/) so it doesn't count as a 13th Vercel function —
// same convention as google-calendar-sync.js, harvest-sync.js, etc.

const CLAUDE_MODEL = 'claude-sonnet-5';
const OPENAI_MODEL = 'gpt-4o-mini';

// opts: { maxTokens, webSearch, model, apiKey } — webSearch defaults to
// true for both, since every current caller wants it; pass
// webSearch:false for calls that only need the model to reason over text
// already given to it (cheaper, and removes any chance of it wandering
// off to search instead of synthesizing the data it was handed). model
// overrides the hardcoded default — callers pass
// settings.claudeModel/settings.openaiModel here so a provider
// deprecating/renaming a model is a Settings change, not a redeploy (see
// this file's header comment). apiKey overrides the Vercel environment
// variable when a caller has looked up an admin-connected key from
// ai_provider_connections — env var stays as the fallback either way, so
// nothing breaks for a deployment that's never used the Connect flow.
async function callClaude(messages, systemPrompt, opts = {}) {
  const anthropicKey = opts.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return { ok: false, error: 'Missing ANTHROPIC_API_KEY' };

  const body = {
    model: opts.model || CLAUDE_MODEL,
    max_tokens: opts.maxTokens || 1500,
    system: systemPrompt,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
  };
  if (opts.webSearch !== false) {
    body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) return { ok: false, error: data?.error?.message || 'Claude request failed' };
  const textBlocks = (data.content || []).filter(b => b.type === 'text').map(b => b.text);
  return { ok: true, reply: textBlocks.join('\n\n').trim() };
}

async function callOpenAI(messages, systemPrompt, opts = {}) {
  const openaiKey = opts.apiKey || process.env.OPENAI_API_KEY;
  if (!openaiKey) return { ok: false, error: 'Missing OPENAI_API_KEY' };

  // Responses API, not Chat Completions — see claude-chat.js's comment
  // history for why (the old Chat Completions "-search-preview" models
  // were deprecated 2026-07-23). The model decides for itself whether a
  // search is actually needed per call.
  const body = {
    model: opts.model || OPENAI_MODEL,
    input: [{ role: 'system', content: systemPrompt }, ...messages.map(m => ({ role: m.role, content: m.content }))],
  };
  if (opts.webSearch !== false) {
    body.tools = [{ type: 'web_search' }];
  }

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openaiKey}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) return { ok: false, error: data?.error?.message || 'OpenAI request failed' };
  const textParts = (data.output || [])
    .filter(item => item.type === 'message')
    .flatMap(item => (item.content || []).filter(c => c.type === 'output_text').map(c => c.text));
  return { ok: true, reply: textParts.join('\n\n').trim() };
}

// Single entry point both callers use — 'openai' or anything else
// (including undefined/unrecognized) resolves to Claude, matching the
// existing settings.aiProvider convention in claude-chat.js.
async function callAI(provider, messages, systemPrompt, opts = {}) {
  return provider === 'openai'
    ? callOpenAI(messages, systemPrompt, opts)
    : callClaude(messages, systemPrompt, opts);
}

module.exports = { callClaude, callOpenAI, callAI, CLAUDE_MODEL, OPENAI_MODEL };
