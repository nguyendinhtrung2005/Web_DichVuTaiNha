import { HttpError } from './errors.js'
import { availabilityDto, branchDto } from './mapping.js'

const inactive = () => new HttpError(403, 'STAFF_INACTIVE', 'Tài khoản hoặc hồ sơ nhân viên không còn hoạt động.')
const branchMissing = () => new HttpError(404, 'BRANCH_NOT_FOUND', 'Chưa tìm thấy chi nhánh được gán cho hồ sơ nhân viên.')

/**
 * Read-only areas and availability. Registration/editing stays BLOCKED until
 * the team approves the shift policy and admin permissions, so no write exists.
 */
export class StaffAreaService {
  constructor({ repository }) {
    this.repository = repository
  }

  async employee(actor) {
    const employee = await this.repository.findEmployeeByUserId(actor.userId)
    if (!employee || employee.status !== 'ACTIVE' || employee.userStatus !== 'ACTIVE' || !['EMPLOYEE', 'STAFF'].includes(employee.userRole)) throw inactive()
    return employee
  }

  async branch(actor) {
    const employee = await this.employee(actor)
    const branch = await this.repository.findBranch(employee.branchId)
    if (!branch) throw branchMissing()
    return { data: branchDto(branch), timezone: 'Asia/Ho_Chi_Minh' }
  }

  async availability(actor, query) {
    const employee = await this.employee(actor)
    const rows = await this.repository.findAvailability(employee.id, query)
    const truncated = rows.length > 500
    return {
      data: rows.slice(0, 500).map(availabilityDto),
      range: { from: query.from, to: query.to, timezone: 'Asia/Ho_Chi_Minh' },
      truncated,
      branchId: employee.branchId,
    }
  }
}
