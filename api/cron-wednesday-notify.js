// Runs automatically every Wednesday via Vercel Cron (see vercel.json). Two
// genuinely separate responsibilities live here, same "bundle it into an
// existing file" discipline as cron-google-calendar-sync.js — there's no
// spare function slot for a second cron job:
//
//   1. The original pending-drafts email digest — the fully hands-off
//      version of clicking "Notify Daniel & Eric."
//   2. NEW: proactive insights from the Assistant. Two things nothing else
//      in the app can currently do: (a) actually check a rotating couple
//      of client websites for real per week (broken links, stale info),
//      and (b) look for cross-client/cross-time patterns a single-client
//      threshold rule can't catch (e.g. several clients on the same
//      service going quiet together). Deliberately does NOT re-surface
//      anything the danger score / overdue-reminder badges / stale-work
//      nudge already cover — see the system prompts below.
//
// Both run every invocation, independently, in their own try/catch — one
// failing (say, the email send) shouldn't block the other.
//
// clients/client_improvements are real tables now (see
// schema-clients-migration.sql), not part of the app_storage JSON blob —
// only the activity log (`log`) still lives there. Client mutations
// (lastProactiveCheckAt) are written with a targeted per-row UPDATE the
// moment they happen inside runProactiveInsights, not batched into one
// end-of-run blob rewrite the way the old app-data.clients array was.

const { createClient } = require('@supabase/supabase-js');
const { sendPushToUser } = require('../lib/push-notify');
const { sendSlackDM } = require('../lib/slack-notify');
const { callAI } = require('../lib/ai-client');

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

async function runEmailDigest(admin, clients, log, settings, resendKey) {
  if (!resendKey) return { skipped: true, reason: 'Missing RESEND_API_KEY' };

  const pending = clients.filter(c => c.draftStatus === 'pending' && !c.deletedAt);
  if (!pending.length) return { skipped: true, reason: 'No pending drafts this week — nothing sent.' };

  const to = [settings.danielEmail, settings.ericEmail].filter(Boolean).join(',');
  if (!to) return { skipped: true, reason: 'No approver emails configured in Settings — nothing sent.' };

  const appUrl = process.env.APP_URL || '';
  const subject = `${pending.length} client update${pending.length !== 1 ? 's' : ''} ready for approval`;
  const bodyLines = pending
    .sort((a, b) => b.danger - a.danger)
    .map(c => `- ${c.name} (danger ${c.danger}/5, importance ${c.importance}/10)`)
    .join('\n');
  const body = `This week's client update drafts are ready for review, sorted by danger score:\n\n${bodyLines}\n\n${appUrl ? `Review and approve here: ${appUrl}` : 'Log in to review and approve.'}`;

  const from = process.env.EMAIL_FROM || 'Based Agency <onboarding@resend.dev>';
  const recipients = to.split(',').map(s => s.trim()).filter(Boolean);

  const emailResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendKey}` },
    body: JSON.stringify({ from, to: recipients, subject, text: body }),
  });
  const emailData = await emailResponse.json();
  if (!emailResponse.ok) return { error: emailData.message || 'Resend rejected the request' };

  log.unshift({
    t: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) + ' UTC',
    tag: 'auto',
    text: `Auto-notified Daniel &amp; Eric — ${pending.length} draft${pending.length !== 1 ? 's' : ''} pending (Wednesday automation).`,
  });

  const { data: profiles } = await admin.from('team_profiles').select('id, role');
  const notifyIds = (profiles || []).filter(p => p.role === 'admin' || p.role === 'approver').map(p => p.id);
  if (notifyIds.length) {
    await admin.from('notifications').insert(notifyIds.map(id => ({
      user_id: id, type: 'email_sent', title: 'Client email sent',
      body: `Wednesday automation sent "${subject}" to ${recipients.join(', ')}.`, target_view: 'approve',
    })));
    for (const id of notifyIds) {
      try { await sendPushToUser(admin, id, 'Client email sent', `Wednesday automation sent "${subject}" to ${recipients.join(', ')}.`); } catch (e) {}
    }
  }

  return { success: true, notified: pending.length, emailId: emailData.id };
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

async function checkClientWebsite(provider, client) {
  const systemPrompt = `You're doing a quick automated weekly health check on a marketing agency client's live website. Use web search to actually load and look at the site. Only flag things that are objectively wrong or clearly stale — a broken link, a 404, an obviously outdated copyright year or expired promotion, wrong/missing contact info, a page that looks broken. Do not comment on subjective design choices, copywriting style, or minor nitpicks. If you find nothing worth flagging, respond with exactly the single word ${NOTHING_NOTEWORTHY} and nothing else. Otherwise respond in 1-3 short plain-text sentences describing what you found — no markdown, no preamble.`;
  const messages = [{ role: 'user', content: `Check ${client.name}'s website: ${client.website}` }];
  return callAI(provider, messages, systemPrompt, { maxTokens: 400, webSearch: true });
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

async function detectCrossClientPatterns(provider, clients, reminderCountByClient) {
  const dataSummary = buildPatternDataSummary(clients, reminderCountByClient);
  if (!dataSummary) return { ok: true, reply: NOTHING_NOTEWORTHY };

  const systemPrompt = `You're reviewing a marketing agency's full active client roster once a week, looking specifically for patterns that only show up when you look ACROSS clients or across time — the kind of thing a single-client threshold rule can't catch. Example of the kind of thing worth flagging: several clients on the same service line all going quiet (no logged work) around the same time, or a cluster of clients trending the same direction together.

The team already has, for every individual client: a 1-5 danger score, an overdue-follow-up count, and a stale-work nudge. Do NOT restate or rediscover any of that on a per-client basis — only surface something that is genuinely a cross-client or cross-time pattern, not visible from looking at one client's numbers alone. If nothing in the data below rises above normal week-to-week noise, respond with exactly the single word ${NOTHING_NOTEWORTHY} and nothing else. Otherwise respond with one short synthesized paragraph (2-4 sentences), plain text, no markdown, no bullet points.`;
  const messages = [{ role: 'user', content: `Current roster:\n${dataSummary}` }];
  return callAI(provider, messages, systemPrompt, { maxTokens: 400, webSearch: false });
}

async function runProactiveInsights(admin, clients, log, settings) {
  const provider = settings.aiProvider === 'openai' ? 'openai' : 'claude';
  const findings = []; // [{title, body, targetId}]
  const errors = [];

  // ---- Website spot-checks on a rotating subset ----
  const candidates = pickWebsiteCheckCandidates(clients);
  for (const client of candidates) {
    try {
      const result = await checkClientWebsite(provider, client);
      if (result.ok) {
        // Only advance the rotation on a genuinely successful call — a
        // transient API error shouldn't cost this client its turn. Real
        // per-row update the moment it happens, not batched into an
        // end-of-run blob rewrite.
        const nowIso = new Date().toISOString();
        const { error: updErr } = await admin.from('clients').update({ last_proactive_check_at: nowIso }).eq('id', client.id);
        if (!updErr) client.lastProactiveCheckAt = nowIso;
        if (!isNothingNoteworthy(result.reply)) {
          findings.push({ title: `Possible issue on ${client.name}'s website`, body: result.reply, targetId: client.id });
          log.unshift({
            t: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) + ' UTC',
            tag: 'auto', text: `Assistant flagged a possible website issue for ${client.name} (Wednesday automation).`,
          });
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
    const patternResult = await detectCrossClientPatterns(provider, clients, reminderCountByClient);
    if (patternResult.ok && !isNothingNoteworthy(patternResult.reply)) {
      findings.push({ title: 'Pattern worth a look', body: patternResult.reply, targetId: null });
      log.unshift({
        t: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) + ' UTC',
        tag: 'auto', text: `Assistant surfaced a cross-client pattern (Wednesday automation).`,
      });
    } else if (!patternResult.ok) {
      errors.push(`Pattern detection: ${patternResult.error}`);
    }
  } catch (e) {
    errors.push(`Pattern detection: ${String(e)}`);
  }

  // ---- Notify, only if there's something to say ----
  if (findings.length) {
    const { data: profiles } = await admin.from('team_profiles').select('id, role');
    const recipients = (profiles || []).filter(p => p.role === 'admin' || p.role === 'approver').map(p => p.id);
    for (const f of findings) {
      await notifyAdminsApprovers(admin, recipients, 'proactive_insight', f.title, f.body, f.targetId);
    }
  }

  return {
    websiteChecksAttempted: candidates.length,
    patternCheckRan: true,
    findingsCount: findings.length,
    findings: findings.map(f => f.title),
    errors: errors.length ? errors : undefined,
  };
}

module.exports = async function handler(req, res) {
  // Vercel automatically sends this header on real cron invocations — this
  // check is what stops anyone else from hitting this URL and triggering it
  // on demand. CRON_SECRET is auto-provisioned by Vercel, nothing to set up.
  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' });
    return;
  }

  const admin = createClient(supabaseUrl, serviceKey);

  try {
    const [
      { data: appDataRow, error: appDataErr },
      { data: settingsRow, error: settingsErr },
      { data: clientsData, error: clientsErr },
      { data: impData, error: impErr },
    ] = await Promise.all([
      admin.from('app_storage').select('value').eq('key', 'app-data').maybeSingle(),
      admin.from('app_storage').select('value').eq('key', 'settings').maybeSingle(),
      admin.from('clients').select('*'),
      admin.from('client_improvements').select('id, client_id, author, text, date'),
    ]);
    if (appDataErr || settingsErr || clientsErr || impErr) {
      res.status(500).json({ error: (appDataErr || settingsErr || clientsErr || impErr).message });
      return;
    }

    // `log` is still the only thing left in the app_storage blob — clients
    // moved to a real table (see schema-clients-migration.sql).
    const appData = appDataRow ? JSON.parse(appDataRow.value) : { log: [] };
    const settings = settingsRow ? JSON.parse(settingsRow.value) : {};
    const log = appData.log || [];

    const clients = (clientsData || []).map(clientRowFromDb);
    const improvementsByClient = {};
    (impData || []).forEach(r => {
      (improvementsByClient[r.client_id] = improvementsByClient[r.client_id] || []).push(improvementRowFromDb(r));
    });
    clients.forEach(c => { c.improvements = improvementsByClient[c.id] || []; });

    const result = { emailDigest: null, proactiveInsights: null };

    try {
      result.emailDigest = await runEmailDigest(admin, clients, log, settings, process.env.RESEND_API_KEY);
    } catch (e) {
      result.emailDigest = { error: String(e) };
    }

    try {
      result.proactiveInsights = await runProactiveInsights(admin, clients, log, settings);
    } catch (e) {
      result.proactiveInsights = { error: String(e) };
    }

    // Only `log` needs writing back here — client changes
    // (lastProactiveCheckAt) already wrote themselves via targeted
    // per-row updates inside runProactiveInsights.
    if (log.length > 60) log.length = 60;
    await admin.from('app_storage').upsert(
      { key: 'app-data', value: JSON.stringify({ ...appData, log }) },
      { onConflict: 'key' }
    );

    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
