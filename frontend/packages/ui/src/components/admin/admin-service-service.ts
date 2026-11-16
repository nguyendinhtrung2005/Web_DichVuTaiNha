"use client"

import { actions, executeStoreCommand, getStoreSnapshot, staleRecordError, storedStateRaw, storedStateData } from "@/lib/store"
import { APP_ROLE, IS_UNIFIED_APP } from "@/lib/env"
import type { AppState, Service } from "@/lib/types"

export type AdminServiceInput = Omit<Service, "id" | "slug" | "status">
export type AdminServiceErrors = Partial<Record<keyof AdminServiceInput, string>>
export type AdminServiceResult = { ok: true; serviceId: string; persistence: "local" | "session" } | { ok: false; error: string; field?: keyof AdminServiceInput }
const CATEGORIES = new Set(["dinh-ky", "chuyen-sau", "noi-that", "thiet-bi"])
const BLOCKED_CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/

export function isSafeServiceImage(value: string) {
  if (typeof value !== "string" || !value || value.length > 2048 || /[\p{Cc}]/u.test(value)) return false
  if (/^\/(?!\/)[A-Za-z0-9/_.-]+\.(?:png|jpe?g|webp|gif|avif)$/i.test(value) && !value.split("/").includes("..")) return true
  try { const url = new URL(value); return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password } catch { return false }
}

export function validateAdminService(input: AdminServiceInput): AdminServiceErrors {
  const errors: AdminServiceErrors = {}
  const text = (key: "name" | "shortDesc" | "description" | "unit" | "quantityLabel", min: number, max: number, multiline = false) => {
    const value = input[key]
    if (typeof value !== "string" || value.trim().length < min || value.trim().length > max) errors[key] = `Nhập từ ${min} đến ${max} ký tự.`
    else if ((multiline ? BLOCKED_CONTROLS : /[\p{Cc}]/u).test(value)) errors[key] = "Nội dung không được chứa ký tự điều khiển."
  }
  text("name", 2, 120); text("shortDesc", 10, 300); text("description", 20, 5000, true); text("unit", 1, 40); text("quantityLabel", 1, 80)
  if (!CATEGORIES.has(input.category)) errors.category = "Chọn một nhóm dịch vụ hiện có."
  const number = (key: "price" | "minQuantity" | "defaultQuantity" | "minutesPerUnit" | "baseMinutes", zero = false) => {
    const value = input[key]
    if (typeof value !== "number" || !Number.isFinite(value) || value < (zero ? 0 : 1)) errors[key] = zero ? "Nhập số hữu hạn lớn hơn hoặc bằng 0." : "Nhập số hữu hạn lớn hơn hoặc bằng 1."
  }
  number("price"); number("minQuantity"); number("defaultQuantity"); number("minutesPerUnit"); number("baseMinutes", true)
  if (!errors.minQuantity && !errors.defaultQuantity && input.defaultQuantity < input.minQuantity) errors.defaultQuantity = "Số lượng mặc định phải lớn hơn hoặc bằng số lượng tối thiểu."
  if (!errors.price && !errors.defaultQuantity && !Number.isFinite(input.price * input.defaultQuantity)) errors.price = "Tổng giá theo số lượng mặc định vượt khả năng tính toán. Vui lòng giảm giá hoặc số lượng."
  if (!errors.minutesPerUnit && !errors.baseMinutes && !errors.defaultQuantity && !Number.isFinite(input.baseMinutes + input.minutesPerUnit * input.defaultQuantity)) errors.minutesPerUnit = "Thời lượng theo số lượng mặc định vượt khả năng tính toán. Vui lòng giảm thời gian hoặc số lượng."
  for (const key of ["scope", "included", "excluded"] as const) {
    const items = input[key]
    if (!Array.isArray(items) || (key !== "excluded" && !items.length) || items.length > 50 || items.some((item) => typeof item !== "string" || !item.trim() || item.trim().length > 300 || /[\p{Cc}]/u.test(item))) errors[key] = key === "excluded" ? "Mỗi mục cần từ 1 đến 300 ký tự, tối đa 50 mục; có thể để trống." : "Nhập ít nhất một mục; mỗi mục tối đa 300 ký tự, tối đa 50 mục."
  }
  if (!isSafeServiceImage(input.image)) errors.image = "Chọn ảnh hiện có hoặc đường dẫn ảnh hợp lệ dùng HTTPS."
  return errors
}

function hasActiveAdmin(state: AppState) {
  return (IS_UNIFIED_APP || APP_ROLE === "admin") && Array.isArray(state.users) && Array.isArray(state.services) && Array.isArray(state.orders) && state.session?.role === "admin" && state.users.some((user) => user?.id === state.session?.userId && user.role === "admin" && user.status === "active")
}

function cleanInput(input: AdminServiceInput): AdminServiceInput {
  return { name: input.name.trim(), category: input.category, shortDesc: input.shortDesc.trim(), description: input.description.trim(), unit: input.unit.trim(), quantityLabel: input.quantityLabel.trim(), price: input.price, minQuantity: input.minQuantity, defaultQuantity: input.defaultQuantity, minutesPerUnit: input.minutesPerUnit, baseMinutes: input.baseMinutes, image: input.image.trim(), scope: input.scope.map((line) => line.trim()), included: input.included.map((line) => line.trim()), excluded: input.excluded.map((line) => line.trim()) }
}

function storedState() {
  try { return storedStateRaw() } catch { return null }
}

function persistenceOf(before: string | null, matches: (state: AppState) => boolean): "local" | "session" {
  try {
    const after = storedState()
    if (!after || !matches(storedStateData(after))) return "session"
    return after !== before || (before && matches(storedStateData(before))) ? "local" : "session"
  } catch { return "session" }
}

// The original actions retain ID/slug generation, authorization and deletion
// rules. These adapters whitelist service fields and never recalculate orders.
export const adminServiceService = {
  async save(state: AppState, input: AdminServiceInput, id?: string): Promise<AdminServiceResult> {
    return executeStoreCommand(() => {
        if (IS_UNIFIED_APP && id !== undefined) { const stale = staleRecordError(state, "services", id); if (stale) return { ok: false, error: stale } }
        if (IS_UNIFIED_APP) state = getStoreSnapshot() ?? state
      try {
        if (!hasActiveAdmin(state)) return { ok: false, error: "Bạn không có quyền quản lý dịch vụ." }
        const existing = id === undefined ? undefined : state.services.find((service) => service?.id === id)
        if (id !== undefined && !existing) return { ok: false, error: "Dịch vụ không còn trong danh sách. Vui lòng mở lại thông tin." }
        const errors = validateAdminService(input)
        const field = (Object.keys(errors) as (keyof AdminServiceInput)[]).find((key) => errors[key])
        if (field) return { ok: false, error: errors[field]!, field }
        const cleaned = cleanInput(input)
        const status = existing?.status || "active"
        if (status !== "active" && status !== "inactive") return { ok: false, error: "Trạng thái dịch vụ chưa hợp lệ." }
        const before = storedState()
        const result = actions.saveService({ ...cleaned, ...(existing ? { id: existing.id } : {}), status })
        if (!result.ok) return result
        const serviceId = result.data.id
        return { ok: true, serviceId, persistence: persistenceOf(before, (saved) => saved.services.some((service) => service.id === serviceId && service.status === status && (!existing || service.slug === existing.slug) && Object.entries(cleaned).every(([key, value]) => JSON.stringify(service[key as keyof AdminServiceInput]) === JSON.stringify(value)))) }
      } catch { return { ok: false, error: "Chưa thể lưu dịch vụ. Nội dung đã nhập vẫn được giữ để thử lại." } }
    })
  },

  async setStatus(state: AppState, id: string, status: Service["status"]): Promise<AdminServiceResult> {
    return executeStoreCommand(() => {
        if (IS_UNIFIED_APP && id !== undefined) { const stale = staleRecordError(state, "services", id); if (stale) return { ok: false, error: stale } }
        if (IS_UNIFIED_APP) state = getStoreSnapshot() ?? state
      try {
        if (!hasActiveAdmin(state)) return { ok: false, error: "Bạn không có quyền thay đổi trạng thái dịch vụ." }
        if (status !== "active" && status !== "inactive") return { ok: false, error: "Trạng thái dịch vụ chưa hợp lệ." }
        if (!state.services.some((service) => service?.id === id)) return { ok: false, error: "Dịch vụ không còn trong danh sách." }
        const before = storedState()
        const result = actions.setServiceStatus(id, status)
        if (result && !result.ok) return result
        return { ok: true, serviceId: id, persistence: persistenceOf(before, (saved) => saved.services.some((service) => service.id === id && service.status === status)) }
      } catch { return { ok: false, error: "Chưa thể cập nhật trạng thái dịch vụ. Vui lòng thử lại." } }
    })
  },

  async remove(state: AppState, id: string): Promise<AdminServiceResult> {
    return executeStoreCommand(() => {
        if (IS_UNIFIED_APP && id !== undefined) { const stale = staleRecordError(state, "services", id); if (stale) return { ok: false, error: stale } }
        if (IS_UNIFIED_APP) state = getStoreSnapshot() ?? state
      try {
        if (!hasActiveAdmin(state)) return { ok: false, error: "Bạn không có quyền xóa dịch vụ." }
        if (!state.services.some((service) => service?.id === id)) return { ok: false, error: "Dịch vụ không còn trong danh sách." }
        if (state.orders.some((order) => order?.serviceId === id)) return { ok: false, error: "Dịch vụ đã có đơn sử dụng, chỉ có thể chuyển sang ngừng cung cấp." }
        const before = storedState()
        const result = actions.deleteService(id)
        if (!result.ok) return result
        return { ok: true, serviceId: id, persistence: persistenceOf(before, (saved) => !saved.services.some((service) => service.id === id)) }
      } catch { return { ok: false, error: "Chưa thể xóa dịch vụ. Vui lòng thử lại." } }
    })
  },
}
