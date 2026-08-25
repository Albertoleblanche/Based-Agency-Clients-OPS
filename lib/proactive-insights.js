// Shared proactive-insights logic — used by both api/cron-wednesday-notify.js
// (the real weekly run) and api/preview-wednesday-notify.js's new 'proactive'
// action (an admin-only, on-demand dry run). Both need the exact same
// website-check + pattern-detection logic; a preview built from a
// hand-copied second version could silently drift from what the real
// Wednesday run actually does. Kept in lib/ so it doesn't count as a 13th
// Vercel function.
//
// runProactiveInsights's opts.dryRun (used by the preview) skips every
// side effect — no lastProactiveCheckAt write, no activity-log entry, no
// notification sent — so running a preview costs real AI API money (it
// has to actually perform the checks to show what they'd find) but never
// consumes a client's turn in the rotation and never notifies anyone.

const { sendPushToUser } = require('./push-notify');
const { sendSlackDM } = require('./slack-notify');
const { callAI } = require('./ai-client');

// Deliberately a hardcoded constant, not a settings-page value — same
// reasoning as claude-chat.js's DAILY_MESSAGE_CAP. Checking 2 sites/week
// (plus one pattern-analysis call) keeps this cheap and bounded without
// needing to be admin-tunable.
const WEBSITE_CHECK_COUNT = 2;

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

// Notifies every admin/approver the same three ways the rest of this
// project's cron jobs already do by hand (in-app row + push + Slack DM) —
// there's no logged-in user/browser here to go through the frontend's
// sendNotification() chokepoint. Matches cron-google-calendar-sync.js's
// existing notifyDueReminders/notifyEscalatedReminders pattern, including
// not checking muted_notification_types for the in-app row/push (those
// cron paths never have — only the Slack DM path enforces mutes, since
// that check lives inside lib/slack-notify.js itself).
async function notifyAdminsApprovers(admin, recipients, type, title, body, targetId) {
  for (const id of recipients) {
    await admin.from('notifications').insert({
      user_id: id, type, title, body, target_view: 'client-detail', target_id: targetId || null,
    });
    try { await sendPushToUser(admin, id, title, body); } catch (e) {}
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

async function checkClientWebsite(provider, model, client) {
  const systemPrompt = `You're doing a quick automated weekly health check on a marketing agency client's live website. Use web search to actually load and look at the site. Only flag things that are objectively wrong or clearly stale — a broken link, a 404, an obviously outdated copyright year or expired promotion, wrong/missing contact info, a page that looks broken. Do not comment on subjective design choices, copywriting style, or minor nitpicks. If you find nothing worth flagging, respond with exactly the single word ${NOTHING_NOTEWORTHY} and nothing else. Otherwise respond in 1-3 short plain-text sentences describing what you found — no markdown, no preamble.`;
  const messages = [{ role: 'user', content: `Check ${client.name}'s website: ${client.website}` }];
  return callAI(provider, messages, systemPrompt, { maxTokens: 400, webSearch: true, model });
}

// Summarizes the full active roster for the pattern-detection call. Kept
// to plain facts the model can reason over — no need for it to search for
// any of this, it's already sitting in the database.
function buildPatternDataSummary(clients, reminderCountByClient) {
  const active = clients.filter(c => !c.deletedAt && c.status !== 'Paused');
  return active.map(c => {
    const lastImp = [...(c.improvements || [])].sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    const daysSinceImp = lastImp ? Math.round((Date.now() - new Date(lastImp.date).getTime()) / 86400000) : null;
    const overdue = reminderCountByClient[c.id] || 0;
    return `- ${c.name} | service: ${c.service} | status: ${c.status} | danger: ${c.danger}/5 | importance: ${c.importance}/10 | days since last logged improvement: ${daysSinceImp === null ? 'never logged' : daysSinceImp} | draft status: ${c.draftStatus || 'none'} | overdue follow-ups: ${overdue}`;
  }).join('\n');
}

async function detectCrossClientPatterns(provider, model, clients, reminderCountByClient) {
  const dataSummary = buildPatternDataSummary(clients, reminderCountByClient);
  if (!dataSummary) return { ok: true, reply: NOTHING_NOTEWORTHY };

  const systemPrompt = `You're reviewing a marketing agency's full active client roster once a week, looking specifically for patterns that only show up when you look ACROSS clients or across time — the kind of thing a single-client threshold rule can't catch. Example of the kind of thing worth flagging: several clients on the same service line all going quiet (no logged work) around the same time, or a cluster of clients trending the same direction together.

The team already has, for every individual client: a 1-5 danger score, an overdue-follow-up count, and a stale-work nudge. Do NOT restate or rediscover any of that on a per-client basis — only surface something that is genuinely a cross-client or cross-time pattern, not visible from looking at one client's numbers alone. If nothing in the data below rises above normal week-to-week noise, respond with exactly the single word ${NOTHING_NOTEWORTHY} and nothing else. Otherwise respond with one short synthesized paragraph (2-4 sentences), plain text, no markdown, no bullet points.`;
  const messages = [{ role: 'user', content: `Current roster:\n${dataSummary}` }];
  return callAI(provider, messages, systemPrompt, { maxTokens: 400, webSearch: false, model });
}

// opts.dryRun: see this file's header comment. clients/log are mutated in
// place either way (matching the caller's existing convention), just
// without the DB write / notification side effects when dryRun is set.
async function runProactiveInsights(admin, clients, log, settings, opts = {}) {
  const dryRun = !!opts.dryRun;
  const provider = settings.aiProvider === 'openai' ? 'openai' : 'claude';
  const model = provider === 'openai' ? settings.openaiModel : settings.claudeModel;
  const findings = []; // [{title, body, targetId}]
  const errors = [];

  // ---- Website spot-checks on a rotating subset ----
  const candidates = pickWebsiteCheckCandidates(clients);
  for (const client of candidates) {
    try {
      const result = await checkClientWebsite(provider, model, client);
      if (result.ok) {
        // Only advance the rotation on a genuinely successful call — a
        // transient API error shouldn't cost this client its turn. Real
        // per-row update the moment it happens, not batched into an
        // end-of-run blob rewrite. Skipped entirely in dry-run — a preview
        // click shouldn't burn this client's spot in next week's real run.
        if (!dryRun) {
          const nowIso = new Date().toISOString();
          const { error: updErr } = await admin.from('clients').update({ last_proactive_check_at: nowIso }).eq('id', client.id);
          if (!updErr) client.lastProactiveCheckAt = nowIso;
        }
        if (!isNothingNoteworthy(result.reply)) {
          findings.push({ title: `Possible issue on ${client.name}'s website`, body: result.reply, targetId: client.id });
          if (!dryRun) {
            log.unshift({
              t: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) + ' UTC',
              tag: 'auto', text: `Assistant flagged a possible website issue for ${client.name} (Wednesday automation).`,
            });
          }
        }
      } else {
        errors.push(`${client.name} website check: ${result.error}`);
      }
    } catch (e) {
      errors.push(`${client.name} website check: ${String(e)}`);
    }
  }

  // ---- Cross-client pattern detection ----
  const { data: reminders } = await admin.from('client_reminders').select('client_id').eq('status', 'waiting');
  const reminderCountByClient = {};
  (reminders || []).forEach(r => { reminderCountByClient[r.client_id] = (reminderCountByClient[r.client_id] || 0) + 1; });

  try {
    const patternResult = await detectCrossClientPatterns(provider, model, clients, reminderCountByClient);
    if (patternResult.ok && !isNothingNoteworthy(patternResult.reply)) {
      findings.push({ title: 'Pattern worth a look', body: patternResult.reply, targetId: null });
      if (!dryRun) {
        log.unshift({
          t: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) + ' UTC',
          tag: 'auto', text: `Assistant surfaced a cross-client pattern (Wednesday automation).`,
        });
      }
    } else if (!patternResult.ok) {
      errors.push(`Pattern detection: ${patternResult.error}`);
    }
  } catch (e) {
    errors.push(`Pattern detection: ${String(e)}`);
  }

  // ---- Notify, only if there's something to say (never in dry-run) ----
  if (!dryRun && findings.length) {
    const { data: profiles } = await admin.from('team_profiles').select('id, role');
    const recipients = (profiles || []).filter(p => p.role === 'admin' || p.role === 'approver').map(p => p.id);
    for (const f of findings) {
      await notifyAdminsApprovers(admin, recipients, 'proactive_insight', f.title, f.body, f.targetId);
    }
  }

  return {
    websiteChecksAttempted: candidates.length,
    websiteChecksCandidates: candidates.map(c => ({ id: c.id, name: c.name })),
    patternCheckRan: true,
    findingsCount: findings.length,
    findings,
    errors: errors.length ? errors : undefined,
  };
}

module.exports = {
  WEBSITE_CHECK_COUNT, NOTHING_NOTEWORTHY, isNothingNoteworthy,
  clientRowFromDb, improvementRowFromDb, notifyAdminsApprovers,
  pickWebsiteCheckCandidates, checkClientWebsite,
  buildPatternDataSummary, detectCrossClientPatterns,
  runProactiveInsights,
};
