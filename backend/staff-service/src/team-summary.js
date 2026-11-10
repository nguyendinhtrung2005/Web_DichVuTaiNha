import { HttpError } from './errors.js'

const states = ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'DONE', 'CANCELLED']
const id = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n
const invalid = () => { throw new HttpError(503, 'TEAM_DATA_UNAVAILABLE', 'Chưa thể đọc đội thực hiện. Vui lòng thử lại.') }

/** Observed assignment counts only. Order has not supplied a staffing requirement or readiness policy. */
export function staffTeamSummary(rows, { bookingId, assignmentId, employeeId }) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 500) invalid()
  const seen = new Set(), employees = new Map(), cancelled = new Set()
  let own, inactiveMembers = false, duplicateEmployees = false
  for (const row of rows) {
    if (!id(row.id) || !id(row.employeeId) || row.bookingId !== bookingId || !states.includes(row.status) || seen.has(row.id)) invalid()
    seen.add(row.id)
    if (row.id === assignmentId && row.employeeId === employeeId) own = row
    if (row.status === 'CANCELLED') { cancelled.add(row.employeeId); continue }
    const rank = states.indexOf(row.status)
    if (employees.has(row.employeeId)) duplicateEmployees = true
    // Conflicting duplicate assignments never inflate the displayed number of completed people.
    employees.set(row.employeeId, Math.min(employees.get(row.employeeId) ?? rank, rank))
    if (row.employeeStatus !== 'ACTIVE' || row.userStatus !== 'ACTIVE' || !['EMPLOYEE', 'STAFF'].includes(row.userRole)) inactiveMembers = true
  }
  if (!own) invalid()
  const ranks = [...employees.values()]
  return {
    version: 1, bookingId, assignmentId, requiredStaffCount: null, packageName: null,
    counts: { assigned: ranks.length, accepted: ranks.filter(rank => rank >= 1).length,
      started: ranks.filter(rank => rank >= 2).length, completed: ranks.filter(rank => rank >= 3).length, cancelled: cancelled.size },
    issues: { duplicateEmployees, inactiveMembers },
    memberVisibility: 'SELF_ONLY', members: [{ assignmentId: own.id, displayName: null, status: own.status, isSelf: true }],
    policy: { source: 'NOT_CONFIGURED', version: null, enforced: false, canStart: null, canCompleteBooking: null, blockingReason: 'TEAM_POLICY_UNCONFIRMED' },
  }
}
