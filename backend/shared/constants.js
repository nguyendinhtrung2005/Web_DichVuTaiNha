const ROLE_TO_DB = { customer: "CUSTOMER", staff: "EMPLOYEE", admin: "ADMIN" }
const ORDER_STATUS_TO_DB = {
  pending: "PENDING",
  confirmed: "CONFIRMED",
  in_progress: "IN_PROGRESS",
  completed: "COMPLETED",
  cancelled: "CANCELLED",
}
const JOB_STATUS_TO_DB = {
  ASSIGNED: "waiting",
  WAITING: "waiting",
  ACCEPTED: "accepted",
  IN_PROGRESS: "in_progress",
  DONE: "done",
  COMPLETED: "done",
}
const PAYMENT_METHOD_TO_DB = { cash: "CASH", transfer: "TRANSFER" }
const PAYMENT_STATUS_TO_DB = { unpaid: "UNPAID", pending: "PENDING", paid: "PAID" }
const CATEGORY_SLUGS = new Set(["ve-sinh-nha-o", "ve-sinh-phong-tro", "cham-soc", "bao-duong"])

function toRole(value) {
  if (value === "EMPLOYEE") return "staff"
  return String(value || "").toLowerCase()
}

function fromJson(value, fallback = []) {
  if (Array.isArray(value)) return value
  if (typeof value !== "string") return fallback
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

module.exports = { ROLE_TO_DB, ORDER_STATUS_TO_DB, JOB_STATUS_TO_DB, PAYMENT_METHOD_TO_DB, PAYMENT_STATUS_TO_DB, CATEGORY_SLUGS, toRole, fromJson }
