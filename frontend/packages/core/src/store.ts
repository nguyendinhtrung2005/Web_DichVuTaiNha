"use client"

import { useSyncExternalStore } from "react"
import { createSeedState, estimateDuration, estimatePrice, orderCode, SEED_VERSION } from "./mock-data"
import { canRequestCancel, findConflicts, paymentOf } from "./logic"
import { formatDateTime } from "./format"
import { APP_ROLE, IS_UNIFIED_APP, SITE_HOST_LABEL, SITE_URLS } from "./env"
import { notifyUnifiedData, readUnifiedEnvelope, subscribeUnifiedData, UNIFIED_SESSION_KEY, UNIFIED_STORAGE_KEY, withUnifiedWriteLock } from "./unified-storage"
import type { UnifiedEnvelope } from "./unified-storage"
import { validateMigrationState } from "./data-migration"
import { hashPassword, ROLE_LABEL, verifyPassword } from "./auth"
import type { AppState, HistoryEntry, JobStatus, Order, OrderContact, PaymentMethod, Role, Service, User } from "./types"

const STORAGE_KEY = `cleanhome-demo-state-${APP_ROLE}`

type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string }
const ok = <T,>(data: T): Result<T> => ({ ok: true, data })
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })

let state: AppState | null = null
const listeners = new Set<() => void>()
export type DataStatus = { status: "loading" | "missing" | "ready" | "corrupt" | "unsupported" | "unavailable"; revision: number; dirty: boolean; error?: string; sessionError?: string }
const serverStatus: DataStatus = { status: "loading", revision: 0, dirty: false }
let dataStatus: DataStatus = serverStatus
let baseRaw: string | null = null
let envelope: UnifiedEnvelope | null = null
let commandOpen = false
let memorySession = false
let legacyBaseRaw: string | null = null
let legacyWriteBlocked = false

function updateStatus(next: DataStatus) {
  if (JSON.stringify(dataStatus) !== JSON.stringify(next)) dataStatus = next
}

function validSession(value: unknown, data: AppState): AppState["session"] {
  if (!value || typeof value !== "object") return null
  const session = value as NonNullable<AppState["session"]>
  if (typeof session.userId !== "string" || !["customer", "staff", "admin"].includes(session.role)) return null
  return data.users.some((user) => user.id === session.userId && user.role === session.role && user.status === "active") ? { userId: session.userId, role: session.role } : null
}

function readSession(data: AppState): { session: AppState["session"]; error?: string } {
  if (memorySession) return { session: validSession(state?.session, data), error: dataStatus.sessionError }
  try {
    const raw = window.sessionStorage.getItem(UNIFIED_SESSION_KEY)
    if (!raw) return { session: null }
    const value = JSON.parse(raw) as { schemaVersion?: number; session?: unknown }
    if (value?.schemaVersion !== 1 || (value.session !== null && !validSession(value.session, data))) return { session: null, error: "Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại." }
    return { session: validSession(value.session, data) }
  } catch { return { session: null, error: "Chưa thể đọc phiên đăng nhập. Vui lòng kiểm tra quyền lưu trữ hoặc đăng nhập lại." } }
}

function refreshUnified() {
  const current = readUnifiedEnvelope()
  if (current.status !== "ready" || !current.envelope) {
    // A failed write can retain a snapshot in this tab, but never repair storage.
    if (!dataStatus.dirty) state = null
    updateStatus({ status: current.status, revision: envelope?.revision ?? 0, dirty: dataStatus.dirty, error: current.error })
    return
  }
  if (dataStatus.dirty && current.raw !== baseRaw) {
    if (state) {
      const session = validSession(state.session, current.envelope.data)
      if (JSON.stringify(session) !== JSON.stringify(state.session)) state = { ...state, session }
    }
    updateStatus({ ...dataStatus, status: "ready", error: "Dữ liệu ở tab khác đã thay đổi trong khi bản hiện tại chưa được lưu. Hãy sao lưu bản hiện tại và tải lại trước khi tiếp tục." })
    return
  }
  const session = readSession(dataStatus.dirty && state ? state : current.envelope.data)
  if (!state || (!dataStatus.dirty && current.raw !== baseRaw) || JSON.stringify(state.session) !== JSON.stringify(session.session)) {
    state = { ...(dataStatus.dirty && state ? state : current.envelope.data), session: session.session }
  }
  if (!dataStatus.dirty) { envelope = current.envelope; baseRaw = current.raw }
  updateStatus({ status: "ready", revision: current.envelope.revision, dirty: dataStatus.dirty, sessionError: session.error, ...(dataStatus.dirty ? { error: dataStatus.error } : {}) })
}

function load(): AppState {
  if (IS_UNIFIED_APP) {
    if (dataStatus.status === "loading") refreshUnified()
    if (!state) throw new Error(dataStatus.error || "Chưa có dữ liệu. Vui lòng chọn bản nhập để bắt đầu.")
    return state
  }
  if (state) return state
  legacyWriteBlocked = false
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    legacyBaseRaw = raw
    if (raw !== null) {
      let parsed: unknown
      try { parsed = JSON.parse(raw) } catch { /* Preserve the unreadable original below. */ }
      const validation = validateMigrationState(parsed, { references: false })
      if (validation.ok && validation.state.version === SEED_VERSION) {
        state = validation.state
        updateStatus({ status: "ready", revision: 0, dirty: false })
        return state
      }
      legacyWriteBlocked = true
      state = createSeedState()
      updateStatus({ status: "ready", revision: 0, dirty: true, error: "Dữ liệu đã lưu chưa đọc được. Bản gốc được giữ nguyên; bạn vẫn có thể sử dụng trong phiên hiện tại. Các thay đổi trong phiên sẽ mất khi đóng hoặc tải lại trang." })
      return state
    }
  } catch {
    legacyWriteBlocked = true
    state = createSeedState()
    updateStatus({ status: "ready", revision: 0, dirty: true, error: "Trình duyệt chưa cho phép đọc dữ liệu đã lưu. Bản gốc được giữ nguyên; các thay đổi chỉ được giữ trong phiên hiện tại." })
    return state
  }
  state = createSeedState()
  persist()
  return state
}

function persist() {
  if (IS_UNIFIED_APP) return
  if (!state || legacyWriteBlocked) return
  try {
    if (window.localStorage.getItem(STORAGE_KEY) !== legacyBaseRaw) {
      legacyWriteBlocked = true
      updateStatus({ status: "ready", revision: 0, dirty: true, error: "Dữ liệu đã thay đổi ở tab khác. Bản đã lưu được giữ nguyên; thay đổi trong tab này chỉ được giữ trong phiên và sẽ mất khi tải lại." })
      return
    }
    const raw = JSON.stringify(state)
    window.localStorage.setItem(STORAGE_KEY, raw)
    if (window.localStorage.getItem(STORAGE_KEY) !== raw) throw new Error("storage verification")
    legacyBaseRaw = raw
    updateStatus({ status: "ready", revision: 0, dirty: false })
  } catch {
    updateStatus({ status: "ready", revision: 0, dirty: true, error: "Thay đổi chỉ được giữ trong phiên hiện tại vì chưa lưu được trên trình duyệt và sẽ mất khi đóng hoặc tải lại trang." })
  }
}

function setState(updater: (s: AppState) => AppState) {
  if (IS_UNIFIED_APP && !commandOpen) throw new Error("Vui lòng thực hiện thay đổi qua điểm truy cập dữ liệu chung.")
  state = updater(load())
  if (IS_UNIFIED_APP) return
  persist()
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (IS_UNIFIED_APP && (e.key === UNIFIED_STORAGE_KEY || e.key === UNIFIED_SESSION_KEY || e.key === null)) {
      refreshUnified()
      listener()
    } else if (!IS_UNIFIED_APP && e.key === STORAGE_KEY) {
      if (dataStatus.dirty) {
        legacyWriteBlocked = true
        updateStatus({ status: "ready", revision: 0, dirty: true, error: "Dữ liệu đã thay đổi ở tab khác khi tab này còn thay đổi chưa lưu. Bản đã lưu được giữ nguyên; thay đổi trong phiên sẽ mất khi tải lại." })
      } else {
        state = null
        load()
      }
      listener()
    }
  }
  window.addEventListener("storage", onStorage)
  const unsubscribeUnified = IS_UNIFIED_APP ? subscribeUnifiedData(() => { refreshUnified(); listener() }) : () => {}
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", onStorage)
    unsubscribeUnified()
  }
}

export const subscribeStore = subscribe

export function useAppState(): AppState | null {
  return useSyncExternalStore(subscribe, getStoreSnapshot, () => null)
}

export function getStoreSnapshot(): AppState | null {
  if (!IS_UNIFIED_APP) return load()
  if (!commandOpen) refreshUnified()
  return state
}

export function useDataStatus(): DataStatus {
  return useSyncExternalStore(subscribe, () => {
    if (IS_UNIFIED_APP && dataStatus.status === "loading") refreshUnified()
    if (!IS_UNIFIED_APP) load()
    return dataStatus
  }, () => serverStatus)
}

export function reloadUnifiedData() {
  if (!IS_UNIFIED_APP) return
  // Explicit reload discards only this tab's unpersisted view, never storage.
  state = null; envelope = null; baseRaw = null; memorySession = false
  updateStatus(serverStatus); refreshUnified(); listeners.forEach((listener) => listener())
}

export function storedStateRaw(): string | null {
  try { return window.localStorage.getItem(IS_UNIFIED_APP ? UNIFIED_STORAGE_KEY : STORAGE_KEY) } catch { return null }
}

export function storedStateData(raw: string): AppState {
  if (!IS_UNIFIED_APP) return JSON.parse(raw) as AppState
  const saved = JSON.parse(raw) as UnifiedEnvelope
  return { ...saved.data, session: readPersistedSession(saved.data) }
}

export function staleRecordError(expected: AppState, collection: "users" | "services" | "reviews", id: string): string | null {
  if (!IS_UNIFIED_APP) return null
  const current = getStoreSnapshot()
  const previous = expected[collection].find((item) => item.id === id)
  const latest = current?.[collection].find((item) => item.id === id)
  return JSON.stringify(previous) === JSON.stringify(latest) ? null : "Thông tin đã thay đổi ở nơi khác. Nội dung bạn nhập vẫn được giữ; vui lòng mở lại thông tin trước khi lưu."
}

function readPersistedSession(data: AppState): AppState["session"] {
  const raw = window.sessionStorage.getItem(UNIFIED_SESSION_KEY)
  if (!raw) return null
  const value = JSON.parse(raw) as { schemaVersion?: number; session?: unknown }
  return value.schemaVersion === 1 ? validSession(value.session, data) : null
}

export function persistenceOf(matches: (saved: AppState) => boolean): "local" | "session" {
  try {
    const raw = storedStateRaw()
    return raw && !dataStatus.dirty && matches(storedStateData(raw)) ? "local" : "session"
  } catch { return "session" }
}

/** Serialize commands from every role, then re-read actor and revision in lock. */
export async function executeStoreCommand<T>(command: () => T): Promise<T | { ok: false; error: string }> {
  if (!IS_UNIFIED_APP) return command()
  try {
    return await withUnifiedWriteLock(() => {
      refreshUnified()
      if (dataStatus.status !== "ready" || !state || !envelope) return fail(dataStatus.error || "Dữ liệu chưa sẵn sàng để lưu thay đổi.")
      const current = readUnifiedEnvelope()
      if (current.status !== "ready" || current.raw !== baseRaw) return fail("Dữ liệu đã thay đổi. Hãy sao lưu và tải lại trước khi tiếp tục.")
      const before = state
      const originalSession = JSON.stringify(before.session)
      commandOpen = true
      let result: T
      try { result = command() } catch (error) { state = before; throw error } finally { commandOpen = false }
      if (result && typeof result === "object" && "ok" in result && result.ok === false) { state = before; return result }
      const next = state!
      const data = { ...next, session: null }
      const changed = JSON.stringify(data) !== JSON.stringify({ ...before, session: null })
      if (changed) {
        if (!validateMigrationState(data).ok) { state = before; return fail("Thay đổi tạo ra dữ liệu không hợp lệ. Nội dung cũ vẫn được giữ nguyên; vui lòng kiểm tra lại.") }
        const target: UnifiedEnvelope = { ...envelope, revision: envelope.revision + 1, data }
        try {
          const serialized = JSON.stringify(target)
          window.localStorage.setItem(UNIFIED_STORAGE_KEY, serialized)
          if (window.localStorage.getItem(UNIFIED_STORAGE_KEY) !== serialized) throw new Error("storage verification")
          envelope = target; baseRaw = serialized
          updateStatus({ ...dataStatus, revision: target.revision, dirty: false, error: undefined })
        } catch { updateStatus({ ...dataStatus, dirty: true, error: "Thay đổi chỉ được giữ trong tab hiện tại vì chưa lưu được trên trình duyệt. Hãy sao lưu trước khi tải lại." }) }
      }
      let sessionFailure = false
      if (originalSession !== JSON.stringify(next.session) || memorySession) {
        try {
          if (next.session === null) {
            window.sessionStorage.removeItem(UNIFIED_SESSION_KEY)
            if (window.sessionStorage.getItem(UNIFIED_SESSION_KEY) !== null) throw new Error("session verification")
          } else {
            const serialized = JSON.stringify({ schemaVersion: 1, session: next.session })
            window.sessionStorage.setItem(UNIFIED_SESSION_KEY, serialized)
            if (window.sessionStorage.getItem(UNIFIED_SESSION_KEY) !== serialized) throw new Error("session verification")
          }
          memorySession = false
          updateStatus({ ...dataStatus, sessionError: undefined })
        } catch {
          memorySession = true; sessionFailure = true
          updateStatus({ ...dataStatus, sessionError: "Phiên đăng nhập chỉ được giữ trong tab hiện tại. Trình duyệt chưa lưu được thay đổi phiên." })
        }
      }
      listeners.forEach((listener) => listener())
      if (!dataStatus.dirty) notifyUnifiedData()
      if (sessionFailure && next.session === null) return fail("Đã đóng phiên trong tab hiện tại nhưng chưa lưu được việc đăng xuất. Hãy đóng tab và kiểm tra quyền lưu trữ trước khi mở lại.")
      if (result && typeof result === "object" && "ok" in result && result.ok === true && "persistence" in result) return { ...result, persistence: dataStatus.dirty || sessionFailure ? "session" : "local" } as T
      return result
    })
  } catch (error) { return fail(error instanceof Error ? error.message : "Chưa thể lưu thay đổi. Vui lòng thử lại.") }
}

export function useCurrentUser(): User | null {
  const s = useAppState()
  if (!s?.session) return null
  const user = s.users.find((u) => u.id === s.session!.userId)
  return user && user.status === "active" && user.role === s.session.role ? user : null
}

function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

function nowIso() {
  return new Date().toISOString()
}

function nextPaymentCode(s: AppState) {
  let sequence = s.payments.length + 1
  while (IS_UNIFIED_APP && s.payments.some((payment) => payment.code === `TT${String(sequence).padStart(4, "0")}`)) sequence++
  return `TT${String(sequence).padStart(4, "0")}`
}

function actorName(s: AppState) {
  return s.users.find((u) => u.id === s.session?.userId)?.name ?? "Hệ thống"
}

function patchOrder(s: AppState, orderId: string, patch: (o: Order) => Partial<Order>, entry?: Omit<HistoryEntry, "at" | "by">): AppState {
  return {
    ...s,
    orders: s.orders.map((o) =>
      o.id === orderId
        ? { ...o, ...patch(o), history: entry ? [...o.history, { at: nowIso(), by: actorName(s), ...entry }] : o.history }
        : o,
    ),
  }
}

function getOrder(orderId: string) {
  return load().orders.find((o) => o.id === orderId)
}

/* ---------- Tài khoản ---------- */

function login(email: string, password: string): Result<User> {
  const st=load(); const user=st.users.find(u=>u.email.toLowerCase()===email.trim().toLowerCase());
  if(!user || !verifyPassword(password,st.passwordHashes[user.id] ?? "")) return fail("Email hoặc mật khẩu không đúng.");
  if(user.status!=="active") return fail("Tài khoản đã bị khóa.");
  if(!IS_UNIFIED_APP && user.role!==APP_ROLE) return fail(`Tài khoản này dành cho website ${ROLE_LABEL[user.role]}. Vui lòng mở website phù hợp.`);
  setState(s=>({...s,session:{userId:user.id,role:user.role}})); return ok(user);
}

function logout() {
  setState((s) => ({ ...s, session: null }))
}

function register(input: { name: string; phone: string; email: string; password: string }): Result<User> {
  const s = load()
  if (s.users.some((u) => u.email.toLowerCase() === input.email.toLowerCase())) return fail("Email đã được sử dụng.")
  if (s.users.some((u) => u.phone === input.phone)) return fail("Số điện thoại đã được sử dụng.")
  if(!IS_UNIFIED_APP && APP_ROLE!=="customer") return fail("Chỉ đăng ký tại website khách hàng.");
  if(input.password.length<8) return fail("Mật khẩu tối thiểu 8 ký tự.");
  const count = s.users.filter((u) => u.role === "customer").length + 1
  const user: User = {
    id: uid("u"),
    code: `KH${String(count).padStart(3, "0")}`,
    role: "customer",
    name: input.name.trim(),
    phone: input.phone.trim(),
    email: input.email.trim(),
    address: "",
    status: "active",
    createdAt: nowIso(),
  }
  setState((st) => ({ ...st, users: [...st.users, user], passwordHashes: {...st.passwordHashes,[user.id]:hashPassword(input.password)}, session: { userId: user.id, role: "customer" } }))
  return ok(user)
}

function updateUser(userId: string, patch: Partial<Pick<User, "name" | "phone" | "email" | "address" | "avatar" | "position">>): Result<undefined> {
  const s = load()
  if (IS_UNIFIED_APP) {
    if (!s.users.some((user) => user.id === userId)) return fail("Không tìm thấy tài khoản cần cập nhật.")
    patch = Object.fromEntries(Object.entries(patch).filter(([key]) => ["name", "phone", "email", "address", "avatar", "position"].includes(key)))
  }
  if (patch.email && s.users.some((u) => u.id !== userId && u.email.toLowerCase() === patch.email!.toLowerCase())) return fail("Email đã được tài khoản khác sử dụng.")
  if (patch.phone && s.users.some((u) => u.id !== userId && u.phone === patch.phone)) return fail("Số điện thoại đã được tài khoản khác sử dụng.")
  setState((st) => ({ ...st, users: st.users.map((u) => (u.id === userId ? { ...u, ...patch } : u)) }))
  return ok(undefined)
}

function addUser(input: { role: "customer" | "staff"; name: string; phone: string; email: string; address: string; position?: string }): Result<User> {
  if (input.role !== "customer" && input.role !== "staff") return fail("Chỉ có thể thêm tài khoản khách hàng hoặc nhân viên.")
  if (IS_UNIFIED_APP) input = { role: input.role, name: input.name, phone: input.phone, email: input.email, address: input.address, ...(input.role === "staff" && input.position !== undefined ? { position: input.position } : {}) }
  const s = load()
  if (s.users.some((u) => u.email.toLowerCase() === input.email.toLowerCase())) return fail("Email đã được sử dụng.")
  const prefix = input.role === "customer" ? "KH" : "NV"
  const count = s.users.filter((u) => u.role === input.role).length + 1
  const user: User = { id: uid("u"), code: `${prefix}${String(count).padStart(3, "0")}`, status: "active", createdAt: nowIso(), ...input }
  setState((st) => ({ ...st, users: [...st.users, user], passwordHashes:{...st.passwordHashes,[user.id]:hashPassword("CleanHome123")} }))
  return ok(user)
}

function setUserLocked(userId: string, locked: boolean): Result<undefined> {
  if (load().session?.userId === userId) return fail("Không thể khóa tài khoản đang đăng nhập.")
  setState((s) => ({ ...s, users: s.users.map((u) => (u.id === userId ? { ...u, status: locked ? "locked" : "active" } : u)) }))
  return ok(undefined)
}

/* ---------- Dịch vụ ---------- */

function saveService(service: Omit<Service, "id" | "slug"> & { id?: string }): Result<Service> {
  const s = load()
  const slugBase = service.name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
  if (service.id) {
    const existing = s.services.find((x) => x.id === service.id)!
    const updated = { ...existing, ...service, id: existing.id, slug: existing.slug }
    setState((st) => ({ ...st, services: st.services.map((x) => (x.id === existing.id ? updated : x)) }))
    return ok(updated)
  }
  const slug = s.services.some((x) => x.slug === slugBase) ? `${slugBase}-${Date.now().toString(36)}` : slugBase
  const created: Service = { ...service, id: uid("dv"), slug }
  setState((st) => ({ ...st, services: [...st.services, created] }))
  return ok(created)
}

function deleteService(serviceId: string): Result<undefined> {
  if (load().orders.some((o) => o.serviceId === serviceId)) return fail("Dịch vụ đã có đơn sử dụng, chỉ có thể chuyển sang ngừng cung cấp.")
  setState((s) => ({ ...s, services: s.services.filter((x) => x.id !== serviceId) }))
  return ok(undefined)
}

function setServiceStatus(serviceId: string, status: Service["status"]) {
  setState((s) => ({ ...s, services: s.services.map((x) => (x.id === serviceId ? { ...x, status } : x)) }))
}

/* ---------- Đơn dịch vụ ---------- */

export interface CreateOrderInput {
  serviceId: string
  quantity: number
  contact: OrderContact
  scheduledAt: string
  specialRequest: string
}

function createOrder(input: CreateOrderInput): Result<Order> {
  const s = load()
  const user = s.users.find((u) => u.id === s.session?.userId)
  if (!user || user.role !== "customer" || (IS_UNIFIED_APP && !actor())) return fail("Vui lòng đăng nhập bằng tài khoản khách hàng để đặt dịch vụ.")
  const service = s.services.find((x) => x.id === input.serviceId)
  if (!service || service.status !== "active") return fail("Dịch vụ hiện không còn cung cấp.")
  if (input.quantity < service.minQuantity) return fail(`Số lượng tối thiểu là ${service.minQuantity} ${service.unit}.`)
  if (!Number.isFinite(input.quantity) || !Number.isFinite(new Date(input.scheduledAt).getTime()) || new Date(input.scheduledAt).getTime() < Date.now()) return fail("Thời gian thực hiện phải ở tương lai.")
  const created = new Date()
  const order: Order = {
    id: uid("od"),
    code: orderCode(created, s.orders.length + 1),
    customerId: user.id,
    serviceId: service.id,
    quantity: input.quantity,
    contact: input.contact,
    scheduledAt: input.scheduledAt,
    durationMinutes: estimateDuration(service, input.quantity),
    specialRequest: input.specialRequest,
    price: estimatePrice(service, input.quantity),
    status: "pending",
    history: [{ at: created.toISOString(), label: "Khách hàng tạo đơn", by: user.name }],
    staffNotes: [],
    createdAt: created.toISOString(),
  }
  setState((st) => ({ ...st, orders: [order, ...st.orders] }))
  return ok(order)
}

function confirmOrder(orderId: string): Result<undefined> {
  const o = getOrder(orderId)
  if (!o || o.status !== "pending") return fail("Chỉ xác nhận được đơn đang chờ xác nhận.")
  setState((s) => patchOrder(s, orderId, () => ({ status: "confirmed" }), { label: "Quản trị viên xác nhận đơn" }))
  return ok(undefined)
}

function updateOrderSchedule(orderId: string, patch: { scheduledAt: string; specialRequest: string; address: string; phone: string }): Result<undefined> {
  const s = load()
  const o = s.orders.find((x) => x.id === orderId)
  if (!o) return fail("Không tìm thấy đơn.")
  if (!Number.isFinite(new Date(patch.scheduledAt).getTime()) || new Date(patch.scheduledAt).getTime()<Date.now()) return fail("Lịch mới phải ở tương lai.")
  if (o.status === "cancelled" || o.status === "completed" || o.status === "in_progress") return fail("Không thể sửa đơn đã bắt đầu, hoàn thành hoặc đã hủy.")
  if (o.staffId) {
    const conflicts = findConflicts(s, o.staffId, new Date(patch.scheduledAt), o.durationMinutes, o.id)
    if (conflicts.length) return fail(`Trùng lịch với đơn ${conflicts.map((c) => c.code).join(", ")} của nhân viên được phân công.`)
  }
  const changedTime = patch.scheduledAt !== o.scheduledAt
  setState((st) =>
    patchOrder(
      st,
      orderId,
      (x) => ({ scheduledAt: patch.scheduledAt, specialRequest: patch.specialRequest, contact: { ...x.contact, address: patch.address, phone: patch.phone } }),
      { label: changedTime ? `Cập nhật lịch thực hiện: ${formatDateTime(patch.scheduledAt)}` : "Cập nhật thông tin đơn" },
    ),
  )
  return ok(undefined)
}

function assignStaff(orderId: string, staffId: string, scheduledAt?: string): Result<undefined> {
  const s = load()
  const o = s.orders.find((x) => x.id === orderId)
  const staff = s.users.find((u) => u.id === staffId)
  if (!o || !staff || staff.role !== "staff") return fail("Dữ liệu không hợp lệ.")
  if (o.status !== "confirmed") return fail("Chỉ phân công được đơn đã xác nhận và chưa bắt đầu.")
  if (o.jobStatus === "in_progress" || o.jobStatus === "done") return fail("Công việc đã bắt đầu, không thể đổi nhân viên.")
  if (staff.status !== "active") return fail("Nhân viên đang bị khóa tài khoản.")
  const start = scheduledAt ?? o.scheduledAt
  if(!Number.isFinite(new Date(start).getTime()) || new Date(start).getTime()<Date.now()) return fail("Thời gian phân công phải ở tương lai.")
  const conflicts = findConflicts(s, staffId, new Date(start), o.durationMinutes, o.id)
  if (conflicts.length) return fail(`${staff.name} đã có công việc trùng giờ (${conflicts.map((c) => c.code).join(", ")}).`)
  const reassign = o.staffId && o.staffId !== staffId
  setState((st) =>
    patchOrder(st, orderId, () => ({ staffId, jobStatus: o.staffId === staffId ? o.jobStatus : "waiting", scheduledAt: start }), {
      label: reassign ? `Đổi phân công sang ${staff.name}` : o.staffId === staffId ? `Điều chỉnh lịch: ${formatDateTime(start)}` : `Phân công nhân viên ${staff.name}`,
    }),
  )
  return ok(undefined)
}

function requestCancel(orderId: string, reason: string): Result<undefined> {
  const o = getOrder(orderId)
  if (IS_UNIFIED_APP && (actor()?.role !== "customer" || o?.customerId !== actor()?.id || typeof reason !== "string" || !reason.trim())) return fail("Không có quyền hoặc chưa nhập lý do hủy.")
  if (!o || !canRequestCancel(o)) return fail("Đơn không đủ điều kiện gửi yêu cầu hủy.")
  setState((s) =>
    patchOrder(s, orderId, () => ({ cancelRequest: { reason, requestedAt: nowIso(), status: "pending" } }), { label: "Khách hàng gửi yêu cầu hủy", note: reason }),
  )
  return ok(undefined)
}

function resolveCancel(orderId: string, approve: boolean, note: string): Result<undefined> {
  const s = load()
  const o = s.orders.find((x) => x.id === orderId)
  if (!o?.cancelRequest || o.cancelRequest.status !== "pending") return fail("Không có yêu cầu hủy đang chờ.")
  if (approve && (o.status === "in_progress" || o.status === "completed")) return fail("Đơn đã bắt đầu thực hiện, không thể duyệt hủy.")
  setState((st) => {
    const next = patchOrder(
      st,
      orderId,
      (x) => ({
        status: approve ? "cancelled" : x.status,
        cancelRequest: { ...x.cancelRequest!, status: approve ? "approved" : "rejected", adminNote: note, resolvedAt: nowIso() },
      }),
      { label: approve ? "Duyệt yêu cầu hủy – đơn đã hủy" : "Từ chối yêu cầu hủy", note },
    )
    if (!approve) return next
    return { ...next, payments: next.payments.map((p) => (p.orderId === orderId && p.status === "paid" ? { ...p, refundRequired: true } : p)) }
  })
  return ok(undefined)
}

function advanceJob(orderId: string, next: JobStatus): Result<undefined> {
  if (IS_UNIFIED_APP && actor()?.role !== "staff") return fail("Vui lòng đăng nhập bằng tài khoản nhân viên.")
  const s = load()
  const o = s.orders.find((x) => x.id === orderId)
  if (!o || o.staffId !== s.session?.userId) return fail("Công việc không được giao cho bạn.")
  if (o.status === "cancelled") return fail("Đơn đã hủy, không thể cập nhật.")
  const flow: JobStatus[] = ["waiting", "accepted", "in_progress", "done"]
  if (flow.indexOf(next) !== flow.indexOf(o.jobStatus ?? "waiting") + 1) return fail("Không thể bỏ qua bước trong quy trình.")
  if (next === "in_progress" && o.cancelRequest?.status === "pending") return fail("Đơn đang có yêu cầu hủy chờ duyệt, vui lòng liên hệ quản trị viên.")
  const labels: Record<JobStatus, string> = {
    waiting: "",
    accepted: "Nhân viên tiếp nhận công việc",
    in_progress: "Bắt đầu thực hiện",
    done: "Hoàn thành công việc",
  }
  setState((st) =>
    patchOrder(
      st,
      orderId,
      (x) => ({ jobStatus: next, status: next === "in_progress" ? "in_progress" : next === "done" ? "completed" : x.status }),
      { label: labels[next] },
    ),
  )
  return ok(undefined)
}

function addStaffNote(orderId: string, text: string): Result<undefined> {
  if (IS_UNIFIED_APP && (actor()?.role !== "staff" || !text.trim())) return fail("Không có quyền hoặc chưa nhập ghi chú.")
  const s = load()
  const o = s.orders.find((x) => x.id === orderId)
  if (!o || o.staffId !== s.session?.userId) return fail("Công việc không được giao cho bạn.")
  setState((st) => ({
    ...st,
    orders: st.orders.map((x) => (x.id === orderId ? { ...x, staffNotes: [...x.staffNotes, { at: nowIso(), text, staffId: o.staffId! }] } : x)),
  }))
  return ok(undefined)
}

/* ---------- Thanh toán ---------- */

function submitPayment(orderId: string, method: PaymentMethod): Result<undefined> {
  if (IS_UNIFIED_APP && (actor()?.role !== "customer" || (method !== "cash" && method !== "transfer"))) return fail("Tài khoản hoặc phương thức thanh toán chưa hợp lệ.")
  const s = load()
  const o = s.orders.find((x) => x.id === orderId)
  if (!o || o.customerId !== s.session?.userId) return fail("Không tìm thấy đơn.")
  if (o.status === "cancelled") return fail("Đơn đã hủy.")
  const existing = paymentOf(s, orderId)
  if (existing?.status === "paid") return fail("Đơn đã được thanh toán.")
  const status: "pending" | "unpaid" = method === "transfer" ? "pending" : "unpaid"
  setState((st) => {
    const payments = existing
      ? st.payments.map((p) => (p.id === existing.id ? { ...p, method, status, createdAt: nowIso() } : p))
      : [...st.payments, { id: uid("pm"), code: nextPaymentCode(st), orderId, amount: o.price, method, status, createdAt: nowIso() } as const]
    return patchOrder({ ...st, payments: [...payments] }, orderId, () => ({}), {
      label: method === "transfer" ? "Khách báo đã chuyển khoản – chờ xác nhận" : "Khách chọn thanh toán tiền mặt",
    })
  })
  return ok(undefined)
}

function confirmPayment(paymentId: string): Result<undefined> {
  const p = load().payments.find((x) => x.id === paymentId)
  if (!p || load().orders.find(o=>o.id===p.orderId)?.status==="cancelled" || p.status === "paid") return fail("Thanh toán không hợp lệ hoặc đã xác nhận.")
  setState((s) => {
    const next = { ...s, payments: s.payments.map((x) => (x.id === paymentId ? { ...x, status: "paid" as const, confirmedAt: nowIso() } : x)) }
    return patchOrder(next, p.orderId, () => ({}), { label: `Xác nhận đã nhận thanh toán (${p.method === "cash" ? "tiền mặt" : "chuyển khoản"})` })
  })
  return ok(undefined)
}

/* ---------- Đánh giá ---------- */

function submitReview(orderId: string, input: { serviceRating: number; staffRating: number; comment: string }): Result<undefined> {
  if (IS_UNIFIED_APP && (actor()?.role !== "customer" || !Number.isInteger(input.serviceRating) || input.serviceRating < 1 || input.serviceRating > 5 || !Number.isInteger(input.staffRating) || input.staffRating < 1 || input.staffRating > 5 || typeof input.comment !== "string")) return fail("Tài khoản hoặc nội dung đánh giá chưa hợp lệ.")
  if (IS_UNIFIED_APP) input = { serviceRating: input.serviceRating, staffRating: input.staffRating, comment: input.comment }
  const s = load()
  const o = s.orders.find((x) => x.id === orderId)
  if (!o || o.customerId !== s.session?.userId) return fail("Không tìm thấy đơn.")
  if (o.status !== "completed") return fail("Chỉ đánh giá được đơn đã hoàn thành.")
  if (s.reviews.some((r) => r.orderId === orderId)) return fail("Đơn này đã được đánh giá.")
  setState((st) => ({
    ...st,
    reviews: [
      ...st.reviews,
      { id: uid("rv"), orderId, customerId: o.customerId, staffId: o.staffId, serviceId: o.serviceId, createdAt: nowIso(), hidden: false, ...input },
    ],
  }))
  return ok(undefined)
}

function setReviewHidden(reviewId: string, hidden: boolean, reason?: string) {
  setState((s) => ({ ...s, reviews: s.reviews.map((r) => (r.id === reviewId ? { ...r, hidden, hiddenReason: hidden ? reason : undefined } : r)) }))
}

function resetDemo() {
  if (IS_UNIFIED_APP) return fail("Dữ liệu chung không được đặt lại tự động. Vui lòng dùng bản sao lưu để khôi phục.")
  state = { ...createSeedState(), session:null }
  persist()
  listeners.forEach((l) => l())
}

function actor() {const st=load();return st.users.find(u=>u.id===st.session?.userId && u.status==="active" && u.role===st.session?.role && (IS_UNIFIED_APP || u.role===APP_ROLE))}
function adminOnly<T extends unknown[], R>(fn:(...args:T)=>R){return (...args:T):R|Result<never>=>actor()?.role==="admin"?fn(...args):fail("Bạn không có quyền thực hiện thao tác này.")}
function ownOrder(orderId:string){const u=actor();return u?.role==="customer" && getOrder(orderId)?.customerId===u.id}
export const actions={
 login,logout,register,resetDemo,
 updateUser:(id:string,patch:Parameters<typeof updateUser>[1])=>actor() && (actor()!.role==="admin" || actor()!.id===id)?updateUser(id,patch):fail("Không có quyền sửa hồ sơ."),
 addUser:adminOnly(addUser),setUserLocked:adminOnly(setUserLocked),saveService:adminOnly(saveService),deleteService:adminOnly(deleteService),setServiceStatus:adminOnly(setServiceStatus),
 createOrder,confirmOrder:adminOnly(confirmOrder),updateOrderSchedule:adminOnly(updateOrderSchedule),assignStaff:adminOnly(assignStaff),
 requestCancel:(id:string,reason:string)=>ownOrder(id)&&reason.trim()?requestCancel(id,reason):fail("Không có quyền hoặc chưa nhập lý do."),
 resolveCancel:adminOnly(resolveCancel),advanceJob,addStaffNote,submitPayment,confirmPayment:adminOnly(confirmPayment),submitReview,setReviewHidden:adminOnly(setReviewHidden)
}
