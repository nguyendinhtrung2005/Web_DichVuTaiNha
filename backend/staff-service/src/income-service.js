import { HttpError } from './errors.js'
import { incomeAssignmentDto } from './mapping.js'
import { DEMO_INCOME_POLICY, calculateIncomeLine, summarizeIncomeLines, incomeDemoEnabled } from './income-policy.js'

/** Illustrative policy for the graduation demo only. Not salary, payable or paid. */
export const INCOME_POLICY = DEMO_INCOME_POLICY
export const INCOME_MAX_ASSIGNMENTS = 500

const inactive = () => new HttpError(403, 'STAFF_INACTIVE', 'Tài khoản hoặc hồ sơ nhân viên không còn hoạt động.')
const tooLarge = () => new HttpError(409, 'INCOME_RANGE_TOO_LARGE', 'Kỳ này có quá nhiều phân công để tính tiền công dự kiến; vui lòng chọn kỳ khác.')

/**
 * Read-only estimate: eligible DONE assignments, verified check-in/out and the configured DEMO policy.
 * No payout, ledger, booking price, bonus, commission, tax or deduction is read
 * or written. Only the signed-in employee's assignments are queried.
 */
export class StaffIncomeService {
  constructor({ repository, env = process.env }) {
    this.repository = repository
    this.demoEnabled = incomeDemoEnabled(env)
  }

  async employee(actor) {
    const employee = await this.repository.findEmployeeByUserId(actor.userId)
    if (!employee || employee.status !== 'ACTIVE' || employee.userStatus !== 'ACTIVE' || !['EMPLOYEE', 'STAFF'].includes(employee.userRole)) throw inactive()
    return employee
  }

  classify(row) {
    const assignment = incomeAssignmentDto(row)
    if (assignment.status !== 'DONE') return { ...assignment, eligible: false, reason: 'STATUS_NOT_DONE' }
    if (!assignment.checkInAt || !assignment.checkOutAt) return { ...assignment, eligible: false, reason: 'MISSING_CHECK_TIMES' }
    if (Date.parse(assignment.checkOutAt) < Date.parse(assignment.checkInAt)) return { ...assignment, eligible: false, reason: 'INVALID_CHECK_TIMES' }
    return { ...assignment, eligible: true, reason: null }
  }

  async estimate(actor, query) {
    const employee = await this.employee(actor)
    if (!this.demoEnabled) throw new HttpError(503, "INCOME_POLICY_NOT_AVAILABLE", "Chính sách minh họa chưa được bật trong môi trường development.")
    const rows = await this.repository.findIncomeAssignments(employee.id, query)
    // A capped query must fail instead of returning a partial (wrong) amount.
    if (rows.length > INCOME_MAX_ASSIGNMENTS) throw tooLarge()
    const seen = new Set()
    const assignments = []
    let eligible = 0, incomplete = 0
    for (const row of rows) {
      const id = String(row.id)
      if (seen.has(id)) continue
      seen.add(id)
      const assignment = this.classify(row)
      let detail = assignment.eligible ? calculateIncomeLine(assignment) : null
      if (detail && (detail.day < query.from || detail.day > query.to)) { assignment.eligible = false; assignment.reason = "OUTSIDE_COMPLETION_PERIOD"; detail = null }
      assignment.detail = detail
      if (assignment.eligible) eligible += 1
      else if (assignment.reason === 'MISSING_CHECK_TIMES' || assignment.reason === 'INVALID_CHECK_TIMES') incomplete += 1
      assignments.push(assignment)
    }
    return {
      period: { month: query.month, from: query.from, to: query.to, timezone: 'Asia/Ho_Chi_Minh' },
      policy: { ...INCOME_POLICY },
      counts: { assignments: assignments.length, eligible, incomplete, excluded: assignments.length - eligible - incomplete },
      ...summarizeIncomeLines(assignments),
      assignments,
      payout: { status: 'NOT_INTEGRATED' },
      timezone: 'Asia/Ho_Chi_Minh',
    }
  }
}
