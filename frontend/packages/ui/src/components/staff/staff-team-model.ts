export type StaffTeam = {
  version: number; bookingId: string; assignmentId: string; requiredStaffCount: number | null; packageName: string | null
  counts: { assigned: number; accepted: number; started: number; completed: number; cancelled: number }
  issues: { duplicateEmployees: boolean; inactiveMembers: boolean }
  memberVisibility: "SELF_ONLY" | "APPROVED_ROSTER"
  members: { assignmentId: string; displayName: string | null; status: "ASSIGNED" | "ACCEPTED" | "IN_PROGRESS" | "DONE" | "CANCELLED"; isSelf: boolean }[]
  policy: { source: string; version: string | null; enforced: boolean; canStart: boolean | null; canCompleteBooking: boolean | null; blockingReason: string | null }
}

/** Missing policy is a blocker, never permission inferred from assignment/quantity counts. */
export function staffTeamMutationBlockedReason(team: StaffTeam | null | undefined, target: "IN_PROGRESS" | "DONE"): string | null {
  if (!team || !team.policy.enforced || team.requiredStaffCount === null) return "Chưa xác nhận quy tắc đủ nhân viên. Liên hệ người quản lý trước khi bắt đầu hoặc hoàn thành công việc."
  if (team.issues.duplicateEmployees || team.issues.inactiveMembers || team.counts.assigned < team.requiredStaffCount
    || team.counts.accepted < team.requiredStaffCount || team.policy.blockingReason === "REPLACEMENT_REQUIRED") return "Đội thực hiện chưa đủ điều kiện. Cần người quản lý kiểm tra hoặc phân công thay thế."
  if (target === "IN_PROGRESS" && team.policy.canStart !== true) return "Đang chờ đủ nhân viên tiếp nhận và xác nhận của hệ thống."
  return null
}

/** Frontend projection of fields already returned by Staff. These are not new upstream fields. */
export function staffTeamProgress(team: StaffTeam | null | undefined, personalStatus = "", bookingStatus: string | null = null) {
  return {
    requiredStaffCount: team?.requiredStaffCount ?? null,
    assignedCount: team?.counts.assigned ?? null,
    acceptedCount: team?.counts.accepted ?? null,
    // Staff's started count includes DONE; subtract only the corresponding observed completed people.
    inProgressCount: team ? team.counts.started - team.counts.completed : null,
    completedCount: team?.counts.completed ?? null,
    // Local presentation key, not a new booking/assignment FSM status.
    teamStatus: staffTeamPresentation(team, personalStatus, bookingStatus).code,
  }
}

/** Presentation only: no count-derived permission, booking mutation or inferred staffing policy. */
export function staffTeamPresentation(team: StaffTeam | null | undefined, personalStatus: string, bookingStatus: string | null) {
  if (!team) return { code: "unconfirmed", title: "Chưa xác nhận yêu cầu nhân sự", message: "Chưa có thông tin số nhân viên yêu cầu. Tiến độ đội chưa được cung cấp.", startBlockedReason: null }
  const { counts, issues, policy } = team
  const waiting = personalStatus === "DONE" && bookingStatus !== "completed" && bookingStatus !== "cancelled" && counts.completed < counts.assigned
  if (issues.duplicateEmployees || issues.inactiveMembers || policy.blockingReason === "REPLACEMENT_REQUIRED" || policy.blockingReason === "DUPLICATE_ASSIGNMENTS") {
    return { code: "admin-required", title: "Cần Admin kiểm tra phân công", message: "Có phân công cần được kiểm tra hoặc thay người. Bạn không thể tự điều chỉnh đội thực hiện.", startBlockedReason: policy.enforced && policy.canStart === false ? "Đội thực hiện cần Admin xử lý trước khi bắt đầu." : null }
  }
  if (bookingStatus === "completed" && policy.enforced && team.requiredStaffCount !== null
    && (counts.assigned < team.requiredStaffCount || counts.completed < team.requiredStaffCount || counts.completed !== counts.assigned)) {
    return { code: "admin-required", title: "Cần Admin đối chiếu trạng thái đội", message: "Trạng thái đơn và tiến độ nhân viên chưa khớp. Vui lòng liên hệ người quản lý.", startBlockedReason: null }
  }
  if (waiting) return { code: "my-work-done", title: "Bạn đã hoàn thành phần việc", message: "Bạn đã hoàn thành phần việc được giao. Đơn dịch vụ vẫn đang chờ các thành viên còn lại.", startBlockedReason: null }
  if (bookingStatus === "completed") return { code: "completed", title: "Đơn đã được xác nhận hoàn thành", message: "Trạng thái này được đọc từ đơn dịch vụ.", startBlockedReason: null }
  if (bookingStatus === "cancelled") return { code: "cancelled", title: "Đơn dịch vụ đã hủy", message: "Không cập nhật công việc của đơn đã hủy. Liên hệ Admin nếu cần đối chiếu phân công.", startBlockedReason: null }
  if (personalStatus === "DONE") return { code: "awaiting-booking", title: "Bạn đã hoàn thành phần việc", message: "Đang chờ hệ thống xác nhận trạng thái chung của đơn dịch vụ.", startBlockedReason: null }
  if ((!policy.enforced || team.requiredStaffCount === null) && bookingStatus === "in_progress") return { code: "in-progress", title: "Đang thực hiện", message: "Tiến độ được ghi nhận từ các phân công hiện có; chưa xác nhận điều kiện đủ đội.", startBlockedReason: null }
  if (!policy.enforced || team.requiredStaffCount === null) return { code: "unconfirmed", title: "Chưa xác nhận yêu cầu nhân sự", message: "Chưa có thông tin số nhân viên yêu cầu. Chưa thể xác nhận điều kiện đủ đội để bắt đầu hoặc hoàn thành đơn.", startBlockedReason: null }
  if (policy.blockingReason === "INSUFFICIENT_STAFF") return { code: "understaffed", title: "Chưa đủ nhân viên", message: "Đang chờ Admin phân công đủ người.", startBlockedReason: "Chưa đủ nhân viên theo yêu cầu của đơn." }
  if (policy.blockingReason === "WAITING_ACCEPTANCE") return { code: "waiting-acceptance", title: "Chờ đồng đội tiếp nhận", message: `${counts.accepted}/${team.requiredStaffCount} nhân viên đã tiếp nhận.`, startBlockedReason: "Đang chờ đủ nhân viên tiếp nhận để bắt đầu công việc chung." }
  if (bookingStatus === "in_progress") return { code: "in-progress", title: "Đang thực hiện", message: "Mỗi nhân viên chỉ cập nhật phần việc được phân công cho mình.", startBlockedReason: policy.canStart === false ? "Hệ thống chưa cho phép bắt đầu phần việc này." : null }
  if (policy.canStart) return { code: "ready", title: "Đủ đội, sẵn sàng thực hiện", message: `${counts.accepted}/${team.requiredStaffCount} nhân viên đã tiếp nhận.`, startBlockedReason: null }
  return { code: "awaiting-confirmation", title: "Chờ xác nhận của hệ thống", message: "Hệ thống chưa cho phép bắt đầu công việc chung.", startBlockedReason: "Hệ thống chưa cho phép bắt đầu công việc chung." }
}
