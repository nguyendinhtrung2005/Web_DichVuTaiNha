/** UC12 state is server-confirmed. A current projection never proves an operation was acknowledged. */
export type StaffNextStatus = "ACCEPTED" | "IN_PROGRESS" | "DONE"
export type StaffStatusOperation = {
  idempotencyKey: string
  requestedStatus: StaffNextStatus
  phase: "unknown" | "pending" | "confirmed"
  createdAt: string
  observedTarget: boolean
  transition?: {
    operationId: string
    requestedStatus: StaffNextStatus
    synchronization: "SYNCHRONIZED" | "PENDING_ACKNOWLEDGEMENT"
    replayed: boolean
  }
}
export type StaffStatusState = {
  current: {
    assignmentId: string
    orderId: string
    status: "ASSIGNED" | "ACCEPTED" | "IN_PROGRESS" | "DONE" | "CANCELLED"
    jobStatus: "waiting" | "accepted" | "in_progress" | "done" | null
    orderStatus: "pending" | "confirmed" | "in_progress" | "completed" | "cancelled" | null
    checkInAt: string | null
    checkOutAt: string | null
    assignedAt: string | null
    cancellationPending: boolean | null
  }
  operation: StaffStatusOperation | null
  allowedStatus: StaffNextStatus | null
  canRetry: boolean
  blockedReason: null | "UNRESOLVED_OPERATION" | "ASSIGNMENT_CHANGED" | "NO_NEXT_STATUS" | "BOOKING_NOT_ACTIVE" | "CANCELLATION_PENDING"
}
export const STAFF_STATUS_ACTION: Record<StaffNextStatus, { label: string; confirm: string }> = {
  ACCEPTED: { label: "Tiếp nhận công việc", confirm: "Bạn xác nhận tiếp nhận công việc được phân công?" },
  IN_PROGRESS: { label: "Bắt đầu thực hiện", confirm: "Bạn xác nhận bắt đầu thực hiện công việc? Hệ thống sẽ ghi nhận thời điểm bắt đầu khi cập nhật được chấp nhận." },
  DONE: { label: "Hoàn thành công việc", confirm: "Bạn xác nhận đã hoàn thành phần công việc được phân công? Việc hoàn thành đơn dịch vụ còn phụ thuộc các nhân viên khác được phân công." },
}
const next = { ASSIGNED: "ACCEPTED", ACCEPTED: "IN_PROGRESS", IN_PROGRESS: "DONE", DONE: null, CANCELLED: null } as const
const jobStatuses = { ASSIGNED: "waiting", ACCEPTED: "accepted", IN_PROGRESS: "in_progress", DONE: "done", CANCELLED: null } as const
const statusSteps = ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "DONE"]
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
const id = (value: unknown): value is string => typeof value === "string" && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9_223_372_036_854_775_807n
const target = (value: unknown): value is StaffNextStatus => typeof value === "string" && Object.hasOwn(STAFF_STATUS_ACTION, value)
function time(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}
function nullableTime(value: unknown): value is string | null { return value === null || time(value) }

export function parseStaffStatusOperation(value: unknown): StaffStatusOperation | null {
  if (!record(value) || typeof value.idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(value.idempotencyKey)
    || !target(value.requestedStatus) || !["unknown", "pending", "confirmed"].includes(value.phase as string)
    || !time(value.createdAt) || typeof value.observedTarget !== "boolean") return null
  let transition: StaffStatusOperation["transition"]
  if (value.transition !== undefined) {
    const supplied = value.transition
    if (!record(supplied) || typeof supplied.operationId !== "string" || !/^[a-f0-9]{64}$/.test(supplied.operationId)
      || supplied.requestedStatus !== value.requestedStatus || typeof supplied.replayed !== "boolean"
      || !["SYNCHRONIZED", "PENDING_ACKNOWLEDGEMENT"].includes(supplied.synchronization as string)) return null
    transition = { operationId: supplied.operationId, requestedStatus: value.requestedStatus, synchronization: supplied.synchronization as NonNullable<StaffStatusOperation["transition"]>["synchronization"], replayed: supplied.replayed }
  }
  if ((value.phase === "confirmed" && transition?.synchronization !== "SYNCHRONIZED")
    || (value.phase === "pending" && transition?.synchronization !== "PENDING_ACKNOWLEDGEMENT")
    || (value.phase === "unknown" && transition !== undefined)) return null
  return { idempotencyKey: value.idempotencyKey, requestedStatus: value.requestedStatus, phase: value.phase as StaffStatusOperation["phase"], createdAt: value.createdAt, observedTarget: value.observedTarget, ...(transition ? { transition } : {}) }
}

export function parseStaffStatusPayload(payload: unknown, assignmentId: string): StaffStatusState | null {
  if (!id(assignmentId) || !record(payload) || !record(payload.current)) return null
  const value = payload.current
  if (value.assignmentId !== assignmentId || !id(value.orderId) || typeof value.status !== "string" || !Object.hasOwn(next, value.status)
    || !["pending", "confirmed", "in_progress", "completed", "cancelled", null].includes(value.orderStatus as string | null)
    || !nullableTime(value.checkInAt) || !nullableTime(value.checkOutAt) || !nullableTime(value.assignedAt)
    || !(value.cancellationPending === null || typeof value.cancellationPending === "boolean") || typeof payload.canRetry !== "boolean"
    || ![null, "UNRESOLVED_OPERATION", "ASSIGNMENT_CHANGED", "NO_NEXT_STATUS", "BOOKING_NOT_ACTIVE", "CANCELLATION_PENDING"].includes(payload.blockedReason as string | null)) return null
  const status = value.status as StaffStatusState["current"]["status"]
  if (value.jobStatus !== jobStatuses[status]) return null
  const operation = payload.operation === null ? null : parseStaffStatusOperation(payload.operation)
  if (payload.operation !== null && !operation) return null
  if (operation && operation.observedTarget !== (statusSteps.indexOf(status) >= statusSteps.indexOf(operation.requestedStatus))) return null
  if (!(payload.allowedStatus === null || target(payload.allowedStatus))) return null
  if (payload.allowedStatus !== null && (payload.allowedStatus !== next[status] || payload.blockedReason !== null
    || !["confirmed", "in_progress"].includes(value.orderStatus as string) || value.cancellationPending === true
    || (operation && (operation.phase !== "confirmed" || !operation.observedTarget)))) return null
  if (payload.canRetry && (!operation || operation.phase === "confirmed" || status === "CANCELLED" || value.orderStatus === "cancelled" || payload.blockedReason === "ASSIGNMENT_CHANGED")) return null
  return {
    current: { assignmentId, orderId: value.orderId, status, jobStatus: jobStatuses[status], orderStatus: value.orderStatus as StaffStatusState["current"]["orderStatus"], checkInAt: value.checkInAt, checkOutAt: value.checkOutAt, assignedAt: value.assignedAt, cancellationPending: value.cancellationPending },
    operation, allowedStatus: payload.allowedStatus as StaffNextStatus | null, canRetry: payload.canRetry, blockedReason: payload.blockedReason as StaffStatusState["blockedReason"],
  }
}

/** A saved response describes that transition, not the current booking or the next action. */
export function parseStaffStatusMutationPayload(payload: unknown, assignmentId: string, requestedStatus: StaffNextStatus, idempotencyKey: string, httpStatus: number): StaffStatusOperation | null {
  if (!record(payload) || !record(payload.data) || ![200, 202].includes(httpStatus)) return null
  const data = payload.data, operation = parseStaffStatusOperation(payload.operation)
  if (!operation || operation.idempotencyKey !== idempotencyKey || operation.requestedStatus !== requestedStatus
    || operation.phase !== (httpStatus === 200 ? "confirmed" : "pending") || data.assignmentId !== assignmentId
    || !["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "DONE"].includes(data.status as string) || !nullableTime(data.checkInAt) || !nullableTime(data.checkOutAt)
    || !record(data.transition) || !record(data.orderAtTransition) || !id(data.orderAtTransition.id)
    || !["PENDING", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED"].includes(data.orderAtTransition.status as string) || !time(data.orderAtTransition.asOf)) return null
  const status = data.status as Exclude<StaffStatusState["current"]["status"], "CANCELLED">
  const transition = operation.transition
  if (!transition || statusSteps.indexOf(status) < statusSteps.indexOf(requestedStatus) || data.jobStatus !== jobStatuses[status] || data.transition.operationId !== transition.operationId
    || data.transition.requestedStatus !== requestedStatus || data.transition.synchronization !== transition.synchronization
    || data.transition.replayed !== transition.replayed) return null
  return operation
}

export function staffStatusErrorMessage(status: number, code: string): string {
  if (status === 401) return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại trước khi kiểm tra thao tác."
  if (status === 403) return "Tài khoản hiện không được phép cập nhật công việc. Vui lòng liên hệ người quản lý."
  if (status === 404) return "Công việc không còn trong danh sách được phân công cho bạn."
  if (code === "AUTH_UNAVAILABLE") return "Chưa thể kiểm tra phiên đăng nhập. Vui lòng thử lại sau."
  if (code === "OPERATION_STORE_UNAVAILABLE") return "Chưa thể đọc hoặc lưu thông tin thao tác an toàn. Vui lòng thử kiểm tra lại hoặc liên hệ người quản lý."
  if (["OPERATION_EXISTS", "UNRESOLVED_OPERATION"].includes(code)) return "Còn một thao tác cần đối chiếu. Vui lòng kiểm tra lại trước khi tiếp tục."
  if (code === "ASSIGNMENT_CHANGED") return "Phân công đã thay đổi. Vui lòng kiểm tra lại hoặc liên hệ người quản lý."
  if (code === "RECONCILIATION_REQUIRED") return "Thao tác cần được đối chiếu giữa các hệ thống. Vui lòng kiểm tra lại; chưa có xác nhận hoàn tất."
  if (status === 409 || status === 422) return "Trạng thái công việc hoặc đơn dịch vụ đã thay đổi. Vui lòng kiểm tra lại trước khi tiếp tục."
  if (status === 429) return "Bạn đã gửi nhiều yêu cầu. Vui lòng chờ một lúc rồi thử lại."
  if (status === 400 || status === 415 || status === 413) return "Yêu cầu cập nhật chưa hợp lệ. Vui lòng kiểm tra lại hoặc liên hệ người quản lý."
  if (code === "ORDER_UNAVAILABLE") return "Hệ thống đơn dịch vụ đang gián đoạn. Chưa thể xác nhận hoàn tất thao tác."
  if (status === 502) return "Phản hồi cập nhật chưa đọc được. Vui lòng kiểm tra lại trạng thái thao tác."
  return "Kết nối đang gián đoạn. Vui lòng kiểm tra lại trước khi thực hiện thao tác tiếp theo."
}
