// Extra access (Nov 25), on the server: the same list as js/core/session.js. What each role does by
// default, and what an admin can give someone on top of their role (team_profiles.extra_permissions).
const ACCESS_LEVEL = {
  view_team_queue: 'approver',
  approve_updates: 'approver',
  edit_clients: 'approver',
  lower_danger_score: 'approver',
  delete_tasks: 'approver',
  delete_clients: 'approver',
  manage_settings: 'admin',
};
function profileHasAccess(p, key) {
  if (!p || p.access_revoked) return false;
  if (p.role === 'admin') return true;
  if (p.role === 'approver' && ACCESS_LEVEL[key] === 'approver') return true;
  const x = Array.isArray(p.extra_permissions) ? p.extra_permissions : [];
  return x.includes(key) || (key === 'view_team_queue' && x.includes('approve_updates'));
}
module.exports = { ACCESS_LEVEL, profileHasAccess };
