// Database rows -> the shape the server jobs work with (api/cron-wednesday-notify.js and
// api/preview-wednesday-notify.js).

// snake_case (Postgres) -> camelCase (the cron jobs' working shape) — same
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

module.exports = { clientRowFromDb, improvementRowFromDb };
