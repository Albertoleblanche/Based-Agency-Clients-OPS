// Shared proactive-insights logic — used by both api/cron-wednesday-notify.js
// (the real weekly run) and api/preview-wednesday-notify.js's 'proactive'
// action (an admin-only, on-demand dry run). Both need the exact same
// logic; a preview built from a hand-copied second version could silently
// drift from what the real run actually does. Kept in lib/ so it doesn't
// count as a 13th Vercel function.
//
// This produces ONE consolidated "weekly focus report" — real computed
// metrics (clients needing attention, overdue follow-ups, stale clients,
// pending drafts) plus the AI website-check/cross-client-pattern findings
// — rather than a separate notification per finding. The report is stored
// in weekly_focus_reports and everyone on the team gets one notification
// linking to it, rather than admins/approvers getting a stream of
// individual alerts.
//
// runProactiveInsights's opts.dryRun (used by the preview) skips every
// side effect — no lastProactiveCheckAt write, no stored report row, no
// notification sent — so running a preview costs real AI API money (it
// has to actually perform the checks to show what they'd find) but never
// consumes a client's turn in the rotation and never notifies anyone.

const { sendPushToUser, pushUrlFor } = require('./push-notify');
const { sendSlackDM } = require('./slack-notify');
const { callAI } = require('./ai-client');

// Deliberately a hardcoded constant, not a settings-page value — same
// reasoning as claude-chat.js's DAILY_MESSAGE_CAP. Checking 2 sites/week
// (plus one pattern-analysis call) keeps this cheap and bounded without
// needing to be admin-tunable.
const WEBSITE_CHECK_COUNT = 2;
// A client with no logged improvement in this many days shows up in the
// report's "gone quiet" section — separate from the AI's own cross-client
// pattern detection, which looks for clusters/trends rather than flagging
// individual clients.
const STALE_DAYS_THRESHOLD = 14;
// How many of the highest-danger clients to surface by name in the report.
const ATTENTION_CLIENTS_LIMIT = 5;

const NOTHING_NOTEWORTHY = 'NOTHING_NOTEWORTHY';

function isNothingNoteworthy(reply) {
  return !reply || reply.trim().toUpperCase().startsWith(NOTHING_NOTEWORTHY);
}

// snake_case (Postgres) -> camelCase (this file's working shape) — same
// mapping convention as index.html's clientRowFromDb/improvementRowFromDb,
// duplicated here rather than shared since this is a Node file and those
// live in frontend-only code.
function clientRowFromDb(r) {
  return {
    id: r.id, name: r.name, email: r.email || '', website: r.website || '',
    service: r.service, status: r.status, importance: r.importance, danger: r.danger,
    draft: r.draft || '', draftStatus: r.draft_status || 'none',
    lastProactiveCheckAt: r.last_proactive_check_at, deletedAt: r.deleted_at || undefined,
    improvements: [],
  };
}
function improvementRowFromDb(r) {
  return { id: r.id, clientId: r.client_id, author: r.author, text: r.text, date: r.date };
}

// Notifies a set of people the same three ways the rest of this project's
// cron jobs already do by hand (in-app row + push + Slack DM) — there's no
// logged-in user/browser here to go through the frontend's
// sendNotification() chokepoint. Matches cron-google-calendar-sync.js's
// existing notifyDueReminders/notifyEscalatedReminders pattern, including
// not checking muted_notification_types for the in-app row/push (those
// cron paths never have — only the Slack DM path enforces mutes, since
// that check lives inside lib/slack-notify.js itself).
async function notifyTeamMembers(admin, recipients, type, title, body, targetId, targetView) {
  for (const id of recipients) {
    await admin.from('notifications').insert({
      user_id: id, type, title, body, target_view: targetView || 'client-detail', target_id: targetId || null,
    });
    try { await sendPushToUser(admin, id, title, body, pushUrlFor(targetView || 'client-detail', targetId)); } catch (e) {}
    try { await sendSlackDM(admin, id, type, `*${title}*\n${body}`); } catch (e) {}
  }
}

// Picks the N clients most overdue for a proactive website check — clients
// with no website on file can't be checked at all, and a client that's
// never been checked (lastProactiveCheckAt undefined) always sorts first.
// This is a fair rotation that self-corrects as the roster changes, rather
// than a stateless weekly-index rotation that would skew if clients are
// added/removed/paused.
function pickWebsiteCheckCandidates(clients) {
  return clients
    .filter(c => !c.deletedAt && c.status !== 'Paused' && c.website)
    .sort((a, b) => new Date(a.lastProactiveCheckAt || 0) - new Date(b.lastProactiveCheckAt || 0))
    .slice(0, WEBSITE_CHECK_COUNT);
}

async function checkClientWebsite(provider, model, apiKey, baseUrl, client) {
  // Website checks fundamentally need real web search to do their job —
  // that's not available on a custom OpenAI-compatible endpoint (see
  // lib/ai-client.js's callOpenAI), so this is skipped with a clear
  // reason rather than letting the model answer without actually having
  // looked at the site, which would look like a real check but isn't one.
  if (provider === 'openai' && baseUrl) {
    return { ok: false, error: 'Website checks need real web search, which isn\'t available on a custom OpenAI-compatible endpoint — switch to official OpenAI or Claude for this feature.' };
  }
  const systemPrompt = `You're doing a quick automated weekly health check on a marketing agency client's live website. Use web search to actually load and look at the site. Only flag things that are objectively wrong or clearly stale — a broken link, a 404, an obviously outdated copyright year or expired promotion, wrong/missing contact info, a page that looks broken. Do not comment on subjective design choices, copywriting style, or minor nitpicks. If you find nothing worth flagging, respond with exactly the single word ${NOTHING_NOTEWORTHY} and nothing else. Otherwise respond in 1-3 short plain-text sentences describing what you found — no markdown, no preamble.`;
  const messages = [{ role: 'user', content: `Check ${client.name}'s website: ${client.website}` }];
  return callAI(provider, messages, systemPrompt, { maxTokens: 400, webSearch: true, model, apiKey, baseUrl });
}

function daysSinceLastImprovement(c) {
  const lastImp = [...(c.improvements || [])].sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  return lastImp ? Math.round((Date.now() - new Date(lastImp.date).getTime()) / 86400000) : null;
}

// Summarizes the full active roster for the pattern-detection call. Kept
// to plain facts the model can reason over — no need for it to search for
// any of this, it's already sitting in the database.
function buildPatternDataSummary(clients, reminderCountByClient) {
  const active = clients.filter(c => !c.deletedAt && c.status !== 'Paused');
  return active.map(c => {
    const daysSinceImp = daysSinceLastImprovement(c);
    const overdue = reminderCountByClient[c.id] || 0;
    return `- ${c.name} | service: ${c.service} | status: ${c.status} | danger: ${c.danger}/5 | importance: ${c.importance}/10 | days since last logged improvement: ${daysSinceImp === null ? 'never logged' : daysSinceImp} | draft status: ${c.draftStatus || 'none'} | overdue follow-ups: ${overdue}`;
  }).join('\n');
}

async function detectCrossClientPatterns(provider, model, apiKey, baseUrl, clients, reminderCountByClient) {
  const dataSummary = buildPatternDataSummary(clients, reminderCountByClient);
  if (!dataSummary) return { ok: true, reply: NOTHING_NOTEWORTHY };

  const systemPrompt = `You're reviewing a marketing agency's full active client roster once a week, looking specifically for patterns that only show up when you look ACROSS clients or across time — the kind of thing a single-client threshold rule can't catch. Example of the kind of thing worth flagging: several clients on the same service line all going quiet (no logged work) around the same time, or a cluster of clients trending the same direction together.

The team already has, for every individual client: a 1-5 danger score, an overdue-follow-up count, and a stale-work nudge. Do NOT restate or rediscover any of that on a per-client basis — only surface something that is genuinely a cross-client or cross-time pattern, not visible from looking at one client's numbers alone. If nothing in the data below rises above normal week-to-week noise, respond with exactly the single word ${NOTHING_NOTEWORTHY} and nothing else. Otherwise respond with one short synthesized paragraph (2-4 sentences), plain text, no markdown, no bullet points.`;
  const messages = [{ role: 'user', content: `Current roster:\n${dataSummary}` }];
  return callAI(provider, messages, systemPrompt, { maxTokens: 400, webSearch: false, model, apiKey, baseUrl });
}

// ---- Real, deterministic data — no AI involved, always available, never "nothing to show" the way an AI call can go quiet ----

function computeAttentionClients(clients) {
  return clients
    .filter(c => !c.deletedAt && c.status !== 'Paused' && c.danger >= 4)
    .sort((a, b) => b.danger - a.danger || b.importance - a.importance)
    .slice(0, ATTENTION_CLIENTS_LIMIT)
    .map(c => ({ id: c.id, name: c.name, danger: c.danger, importance: c.importance, daysSinceImprovement: daysSinceLastImprovement(c) }));
}

function computeStaleClients(clients) {
  return clients
    .filter(c => !c.deletedAt && c.status !== 'Paused')
    .map(c => ({ id: c.id, name: c.name, daysSinceImprovement: daysSinceLastImprovement(c) }))
    .filter(c => c.daysSinceImprovement === null || c.daysSinceImprovement >= STALE_DAYS_THRESHOLD)
    .sort((a, b) => (b.daysSinceImprovement ?? 9999) - (a.daysSinceImprovement ?? 9999));
}

function computeOverdueFollowUps(clients, reminderRows) {
  const todayStr = new Date().toISOString().slice(0, 10);
  return (reminderRows || [])
    .filter(r => r.status === 'waiting' && r.follow_up_date && r.follow_up_date < todayStr)
    .map(r => ({ ...r, client: clients.find(x => x.id === r.client_id) }))
    // Same "still an active, real client" check computeAttentionClients()/
    // computeStaleClients() above already apply — this was the one
    // function in the file missing it, which is why a reminder for a
    // client that's since been deleted or paused kept surfacing here as
    // something needing attention, long after it stopped being relevant.
    .filter(r => r.client && !r.client.deletedAt && r.client.status !== 'Paused')
    .map(r => ({ clientId: r.client_id, clientName: r.client.name, question: r.question, followUpDate: r.follow_up_date }));
}

function computePendingDrafts(clients) {
  return clients.filter(c => !c.deletedAt && c.draftStatus === 'pending').map(c => ({ id: c.id, name: c.name }));
}

// opts.dryRun: see this file's header comment. clients is mutated in place
// (lastProactiveCheckAt) either way, matching the caller's existing
// convention, just without the DB write when dryRun is set.
async function runProactiveInsights(admin, clients, log, settings, opts = {}) {
  const dryRun = !!opts.dryRun;
  const provider = settings.aiProvider === 'openai' ? 'openai' : 'claude';
  const model = provider === 'openai' ? settings.openaiModel : settings.claudeModel;
  // An admin-connected key from Settings -> AI & Email's Connect flow
  // (ai_provider_connections), if one exists — callAI falls back to the
  // Vercel environment variable when this is null. base_url, if set,
  // points openai at a custom OpenAI-compatible endpoint instead of the
  // real thing.
  const { data: connectionRow } = await admin.from('ai_provider_connections').select('api_key, base_url').eq('provider', provider).maybeSingle();
  const apiKey = connectionRow?.api_key || null;
  const baseUrl = connectionRow?.base_url || null;
  const aiFindings = []; // [{title, body, targetId}]
  const errors = [];

  // ---- Website spot-checks on a rotating subset ----
  const candidates = pickWebsiteCheckCandidates(clients);
  for (const client of candidates) {
    try {
      const result = await checkClientWebsite(provider, model, apiKey, baseUrl, client);
      if (result.ok) {
        // Only advance the rotation on a genuinely successful call — a
        // transient API error shouldn't cost this client its turn. Real
        // per-row update the moment it happens. Skipped entirely in
        // dry-run — a preview click shouldn't burn this client's spot in
        // next week's real run.
        if (!dryRun) {
          const nowIso = new Date().toISOString();
          const { error: updErr } = await admin.from('clients').update({ last_proactive_check_at: nowIso }).eq('id', client.id);
          if (!updErr) client.lastProactiveCheckAt = nowIso;
        }
        if (!isNothingNoteworthy(result.reply)) {
          aiFindings.push({ title: `Possible issue on ${client.name}'s website`, body: result.reply, targetId: client.id });
        }
      } else {
        errors.push(`${client.name} website check: ${result.error}`);
      }
    } catch (e) {
      errors.push(`${client.name} website check: ${String(e)}`);
    }
  }

  // ---- Real data: full reminder rows (not just counts), reused for both
  // the pattern-detection prompt's overdue count AND the report's own
  // real "overdue follow-ups" section. ----
  const { data: reminderRows } = await admin.from('client_reminders').select('client_id, status, follow_up_date, question');
  const reminderCountByClient = {};
  (reminderRows || []).filter(r => r.status === 'waiting').forEach(r => {
    reminderCountByClient[r.client_id] = (reminderCountByClient[r.client_id] || 0) + 1;
  });

  // ---- Cross-client pattern detection ----
  try {
    const patternResult = await detectCrossClientPatterns(provider, model, apiKey, baseUrl, clients, reminderCountByClient);
    if (patternResult.ok && !isNothingNoteworthy(patternResult.reply)) {
      aiFindings.push({ title: 'Pattern worth a look', body: patternResult.reply, targetId: null });
    } else if (!patternResult.ok) {
      errors.push(`Pattern detection: ${patternResult.error}`);
    }
  } catch (e) {
    errors.push(`Pattern detection: ${String(e)}`);
  }

  // ---- Real, deterministic sections — always computed, AI or no AI ----
  const report = {
    generatedAt: new Date().toISOString(),
    attentionClients: computeAttentionClients(clients),
    staleClients: computeStaleClients(clients),
    overdueFollowUps: computeOverdueFollowUps(clients, reminderRows),
    pendingDrafts: computePendingDrafts(clients),
    websiteChecksAttempted: candidates.length,
    websiteChecksCandidates: candidates.map(c => ({ id: c.id, name: c.name })),
    aiFindings,
    errors: errors.length ? errors : undefined,
  };

  let reportId = null;
  if (!dryRun) {
    const { data: inserted, error: insertErr } = await admin.from('weekly_focus_reports').insert({ data: report }).select('id').single();
    if (!insertErr) reportId = inserted.id;

    log.unshift({
      t: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) + ' UTC',
      tag: 'auto', text: `Assistant published this week's focus report.`,
    });

    // Everyone on the team gets this now, not just admins/approvers — a
    // "what to focus on this week" report is useful to whoever's actually
    // doing the client work, not only the people who approve it.
    const { data: profiles } = await admin.from('team_profiles').select('id');
    const recipients = (profiles || []).map(p => p.id);
    const teaserParts = [];
    if (report.attentionClients.length) teaserParts.push(`${report.attentionClients.length} client${report.attentionClients.length !== 1 ? 's' : ''} need attention`);
    if (report.overdueFollowUps.length) teaserParts.push(`${report.overdueFollowUps.length} follow-up${report.overdueFollowUps.length !== 1 ? 's' : ''} overdue`);
    if (aiFindings.length) teaserParts.push(`${aiFindings.length} thing${aiFindings.length !== 1 ? 's' : ''} the Assistant flagged`);
    const teaser = teaserParts.length ? teaserParts.join(', ') + '.' : 'A quiet week — nothing urgent, worth a quick look anyway.';
    if (recipients.length) {
      await notifyTeamMembers(admin, recipients, 'weekly_focus_report', 'This is what you should focus on this week', teaser, reportId, 'weekly-focus-report');
    }
  }

  return { ...report, reportId };
}

module.exports = {
  WEBSITE_CHECK_COUNT, NOTHING_NOTEWORTHY, isNothingNoteworthy,
  clientRowFromDb, improvementRowFromDb, notifyTeamMembers,
  pickWebsiteCheckCandidates, checkClientWebsite,
  buildPatternDataSummary, detectCrossClientPatterns,
  computeAttentionClients, computeStaleClients, computeOverdueFollowUps, computePendingDrafts,
  runProactiveInsights,
};
