const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const id = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 120 && !/[\u0000-\u001f\u007f]/.test(value)
const reasons = ['TEAM_POLICY_UNCONFIRMED', 'INSUFFICIENT_STAFF', 'WAITING_ACCEPTANCE', 'REPLACEMENT_REQUIRED', 'DUPLICATE_ASSIGNMENTS']

/** Shared, bounded DTO allowlist. Readiness is accepted only from an explicit Order policy, never inferred from counts. */
export function parseStaffTeam(value, assignmentId, bookingId) {
  if (!object(value) || value.version !== 1 || value.assignmentId !== assignmentId || value.bookingId !== bookingId
    || !id(assignmentId) || !id(bookingId) || !(value.requiredStaffCount === null || Number.isSafeInteger(value.requiredStaffCount) && value.requiredStaffCount >= 1 && value.requiredStaffCount <= 100)
    || !(value.packageName === null || text(value.packageName)) || !object(value.counts) || !object(value.issues) || !object(value.policy)) return null
  const c = value.counts, p = value.policy, issues = value.issues
  if (['assigned', 'accepted', 'started', 'completed', 'cancelled'].some(key => !Number.isSafeInteger(c[key]) || c[key] < 0 || c[key] > 500)
    || c.completed > c.started || c.started > c.accepted || c.accepted > c.assigned
    || typeof issues.duplicateEmployees !== 'boolean' || typeof issues.inactiveMembers !== 'boolean'
    || !['NOT_CONFIGURED', 'order-service'].includes(p.source) || !(p.version === null || text(p.version))
    || typeof p.enforced !== 'boolean' || !(p.canStart === null || typeof p.canStart === 'boolean')
    || !(p.canCompleteBooking === null || typeof p.canCompleteBooking === 'boolean') || !(p.blockingReason === null || reasons.includes(p.blockingReason))) return null
  if (p.source === 'NOT_CONFIGURED' && (value.requiredStaffCount !== null || value.packageName !== null || p.version !== null || p.enforced
    || p.canStart !== null || p.canCompleteBooking !== null || p.blockingReason !== 'TEAM_POLICY_UNCONFIRMED')) return null
  if (!p.enforced && (p.canStart !== null || p.canCompleteBooking !== null)) return null
  if (p.enforced && (p.source !== 'order-service' || !text(p.version) || value.requiredStaffCount === null
    || typeof p.canStart !== 'boolean' || typeof p.canCompleteBooking !== 'boolean')) return null
  if ((p.canStart || p.canCompleteBooking) && (issues.duplicateEmployees || issues.inactiveMembers || c.assigned < value.requiredStaffCount)) return null
  if (p.canStart && (c.accepted < value.requiredStaffCount || p.blockingReason !== null)) return null
  if (p.canCompleteBooking && (c.completed !== c.assigned || p.blockingReason !== null)) return null
  if (!['SELF_ONLY', 'APPROVED_ROSTER'].includes(value.memberVisibility) || !Array.isArray(value.members) || !value.members.length || value.members.length > 500) return null
  const seen = new Set(), members = []
  for (const member of value.members) {
    if (!object(member) || !id(member.assignmentId) || seen.has(member.assignmentId) || typeof member.isSelf !== 'boolean'
      || member.isSelf !== (member.assignmentId === assignmentId) || !(member.displayName === null || text(member.displayName))
      || !['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'DONE', 'CANCELLED'].includes(member.status)) return null
    if (value.memberVisibility === 'SELF_ONLY' && (!member.isSelf || value.members.length !== 1 || member.displayName !== null)) return null
    seen.add(member.assignmentId)
    members.push({ assignmentId: member.assignmentId, displayName: member.displayName, status: member.status, isSelf: member.isSelf })
  }
  const own = members.find(member => member.isSelf)
  if (!own) return null
  if (own.status !== 'CANCELLED' && c.assigned === 0) return null
  const ownRank = ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'DONE'].indexOf(own.status)
  if (!issues.duplicateEmployees && ((ownRank >= 1 && c.accepted === 0) || (ownRank >= 2 && c.started === 0) || (ownRank >= 3 && c.completed === 0))) return null
  return { version: 1, bookingId, assignmentId, requiredStaffCount: value.requiredStaffCount, packageName: value.packageName,
    counts: { assigned: c.assigned, accepted: c.accepted, started: c.started, completed: c.completed, cancelled: c.cancelled },
    issues: { duplicateEmployees: issues.duplicateEmployees, inactiveMembers: issues.inactiveMembers },
    memberVisibility: value.memberVisibility, members,
    policy: { source: p.source, version: p.version, enforced: p.enforced, canStart: p.canStart, canCompleteBooking: p.canCompleteBooking, blockingReason: p.blockingReason } }
}
