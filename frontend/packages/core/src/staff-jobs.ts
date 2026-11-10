import { ApiError, apiRequest } from "./api-client"
import type { JobStatus, OrderStatus, StaffJob } from "./types"

export type StaffJobFilters = {
  page: number
  pageSize: number
  q: string
  status: string
  sort: "schedule-asc" | "schedule-desc"
}

export type StaffJobPage = { items: StaffJob[]; total: number; page: number; pageSize: number }
export type StaffTransitionResult = { bookingId: string; jobStatus: JobStatus; orderStatus: OrderStatus }

const orderStatuses: OrderStatus[] = ["pending", "confirmed", "in_progress", "completed", "cancelled"]
const jobStatuses: JobStatus[] = ["waiting", "accepted", "in_progress", "done"]
const transitionIds = new Map<string, string>()

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function invalidResponse(): never {
  throw new ApiError("API công việc trả dữ liệu không hợp lệ.", 502, "INVALID_RESPONSE")
}

function validateJob(value: unknown): StaffJob {
  if (!record(value) || !record(value.contact) || !Array.isArray(value.history)
    || typeof value.id !== "string" || typeof value.code !== "string"
    || typeof value.serviceId !== "string" || typeof value.serviceName !== "string" || typeof value.unit !== "string"
    || typeof value.quantity !== "number" || !Number.isFinite(value.quantity) || value.quantity <= 0
    || typeof value.contact.name !== "string" || typeof value.contact.phone !== "string" || typeof value.contact.address !== "string"
    || typeof value.scheduledAt !== "string" || !Number.isFinite(Date.parse(value.scheduledAt))
    || typeof value.durationMinutes !== "number" || !Number.isSafeInteger(value.durationMinutes) || value.durationMinutes < 1
    || typeof value.specialRequest !== "string" || !orderStatuses.includes(value.orderStatus as OrderStatus)
    || !jobStatuses.includes(value.jobStatus as JobStatus)
    || typeof value.cancelPending !== "boolean" || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))
    || value.history.some((entry) => !record(entry) || typeof entry.at !== "string" || !Number.isFinite(Date.parse(entry.at))
      || typeof entry.label !== "string" || typeof entry.by !== "string")) {
    invalidResponse()
  }
  const history = value.history.map((entry) => {
    if (!record(entry) || typeof entry.at !== "string" || typeof entry.label !== "string" || typeof entry.by !== "string") invalidResponse()
    return { at: entry.at, label: entry.label, by: entry.by }
  })
  return {
    id: value.id, code: value.code, serviceId: value.serviceId, serviceName: value.serviceName, unit: value.unit,
    quantity: value.quantity,
    contact: { name: value.contact.name, phone: value.contact.phone, address: value.contact.address },
    scheduledAt: value.scheduledAt, durationMinutes: value.durationMinutes, specialRequest: value.specialRequest,
    orderStatus: value.orderStatus as OrderStatus, jobStatus: value.jobStatus as JobStatus,
    cancelPending: value.cancelPending, history, createdAt: value.createdAt,
  }
}

export async function loadStaffJobs(filters: StaffJobFilters, signal?: AbortSignal): Promise<StaffJobPage> {
  const query = new URLSearchParams({
    page: String(filters.page), pageSize: String(filters.pageSize), sort: filters.sort,
  })
  if (filters.q) query.set("q", filters.q)
  if (filters.status) query.set("status", filters.status)
  const result: unknown = await apiRequest(`/staff/jobs?${query}`, { signal })
  if (!record(result) || !Array.isArray(result.items) || !Number.isSafeInteger(result.total) || (result.total as number) < 0
    || result.page !== filters.page || result.pageSize !== filters.pageSize) invalidResponse()
  return { items: result.items.map(validateJob), total: result.total as number, page: result.page as number, pageSize: result.pageSize as number }
}

export async function loadStaffJob(id: string, signal?: AbortSignal): Promise<StaffJob> {
  return validateJob(await apiRequest(`/staff/jobs/${encodeURIComponent(id)}`, { signal }))
}

export async function transitionStaffJob(bookingId: string, nextStatus: JobStatus): Promise<StaffTransitionResult> {
  const key = `${bookingId}:${nextStatus}`
  let operationId = transitionIds.get(key)
  if (!operationId) {
    if (!globalThis.crypto?.randomUUID) throw new ApiError("Trình duyệt chưa hỗ trợ mã thao tác an toàn.", 0, "CRYPTO_UNAVAILABLE")
    operationId = globalThis.crypto.randomUUID()
    transitionIds.set(key, operationId)
  }
  let result: unknown
  try {
    result = await apiRequest(`/staff/jobs/${encodeURIComponent(bookingId)}/transitions`, {
      method: "POST", body: JSON.stringify({ operationId, nextStatus }),
    })
  } catch (error) {
    if (error instanceof ApiError && error.status >= 400 && error.status < 500) transitionIds.delete(key)
    throw error
  }
  if (!record(result) || result.bookingId !== bookingId
    || !jobStatuses.includes(result.jobStatus as JobStatus)
    || !orderStatuses.includes(result.orderStatus as OrderStatus)) invalidResponse()
  transitionIds.delete(key)
  return {
    bookingId: result.bookingId, jobStatus: result.jobStatus as JobStatus, orderStatus: result.orderStatus as OrderStatus,
  }
}
