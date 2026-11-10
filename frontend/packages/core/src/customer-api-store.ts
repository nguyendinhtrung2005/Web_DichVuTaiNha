"use client"

import { ApiError, apiRequest } from './api-client'
import type { AppState, Order, Payment, Review, Service, User } from './types'

export type CustomerDataStatus = { status: 'loading' | 'ready' | 'unavailable'; revision: number; dirty: boolean; error?: string; sessionError?: string }
export type CustomerSessionScope = Readonly<{ epoch: number; userId: string | null }>
type Page<T> = { items: T[]; total: number; page: number; limit: number }
type ApiReview = Omit<Review, 'serviceRating' | 'staffRating' | 'hidden'> & { rating: number }
type ApiPayment = Omit<Payment, 'createdAt'> & { createdAt: string | null }
type ApiOrder = Omit<Order, 'createdAt'> & { createdAt: string | null }
const normalizeOrder = (order: ApiOrder): Order => ({ ...order, createdAt: order.createdAt ?? '' })
let state: AppState | null = null
let status: CustomerDataStatus = { status: 'loading', revision: 0, dirty: false }
const listeners = new Set<() => void>()
let active: Promise<void> | null = null
let generation = 0
let sessionEpoch = 0
let fullCacheRevision = 0
let observedAuthentication: { from: CustomerSessionScope; to: CustomerSessionScope } | null = null
let polling: ReturnType<typeof setInterval> | undefined
const emit = () => listeners.forEach((listener) => listener())
const emptyState = (services: Service[] = []): AppState => ({ version: 1, services, users: [], orders: [], payments: [], reviews: [], passwordHashes: {}, session: null })

export const customerSnapshot = () => state
export const customerStatus = () => status
export const captureCustomerSession = (): CustomerSessionScope => ({ epoch: sessionEpoch, userId: state?.session?.userId ?? null })
export const isCustomerSessionCurrent = (scope: CustomerSessionScope) => scope.epoch === sessionEpoch && scope.userId === (state?.session?.userId ?? null)

function replaceIdentity(user: User | null) {
  observedAuthentication = null
  sessionEpoch++
  state = { ...emptyState(state?.services), ...(user ? { users: [user], session: { userId: user.id, role: 'customer' as const } } : {}) }
}

/** A successful Auth response confirms identity independently of optional data refreshes. */
export function acceptCustomerAuthentication(user: User, scope = captureCustomerSession()) {
  const normalized = normalizeCustomerUser(user)
  if (!isCustomerSessionCurrent(scope)) {
    // The browser can install Set-Cookie before the POST body is delivered. A
    // focus refresh may therefore observe this very login before its ACK arrives.
    const observed = observedAuthentication
    if (observed && scope.epoch === observed.from.epoch && scope.userId === observed.from.userId
      && isCustomerSessionCurrent(observed.to) && observed.to.userId === normalized.id) {
      observedAuthentication = null
      return captureCustomerSession()
    }
    throw new ApiError('Phiên đã thay đổi. Vui lòng kiểm tra tài khoản hiện tại.', 409, 'SESSION_CHANGED')
  }
  generation++
  replaceIdentity(normalized)
  status = { status: 'ready', revision: status.revision + 1, dirty: false }
  emit()
  return captureCustomerSession()
}
export function normalizeCustomerUser(user: User): User {
  if (!user || typeof user.id !== 'string' || typeof user.name !== 'string' || typeof user.phone !== 'string' || user.role !== 'customer') throw new ApiError('API trả thông tin tài khoản không hợp lệ.', 502, 'INVALID_RESPONSE')
  return { ...user, email: user.email ?? '', address: user.address ?? '' }
}

export async function allCustomerPages<T>(path: string, signal?: AbortSignal): Promise<T[]> {
  const items: T[] = []
  for (let page = 1; page <= 10000; page++) {
    const result = await apiRequest<Page<T>>(`${path}${path.includes('?') ? '&' : '?'}page=${page}&limit=100`, { signal })
    if (!result || !Array.isArray(result.items) || !Number.isInteger(result.total) || result.total < 0 || result.page !== page || !Number.isInteger(result.limit) || result.limit < 1) throw new ApiError('Danh sách API không đúng định dạng.', 502, 'INVALID_RESPONSE')
    items.push(...result.items)
    if (items.length >= result.total) return items
    if (!result.items.length) throw new ApiError('API trả danh sách chưa đầy đủ.', 502, 'INVALID_RESPONSE')
  }
  throw new ApiError('Danh sách vượt giới hạn tải. Vui lòng thử lại.', 502, 'INVALID_RESPONSE')
}

export function expireCustomerSession() {
  generation++
  replaceIdentity(null)
  status = { status: 'ready', revision: status.revision + 1, dirty: false, sessionError: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' }
  emit()
}

export function customerRequestError(error: unknown, scope?: CustomerSessionScope): string {
  if (error instanceof ApiError && error.status === 401 && state?.session && (!scope || isCustomerSessionCurrent(scope))) expireCustomerSession()
  return error instanceof Error ? error.message : 'Chưa thể thực hiện yêu cầu. Vui lòng thử lại.'
}

export function refreshCustomerData(force = false): Promise<void> {
  if (active && !force) return active
  const current = ++generation
  let scope = captureCustomerSession()
  const wasAuthenticated = Boolean(state?.session)
  if (!state) { status = { status: 'loading', revision: status.revision, dirty: false }; emit() }
  const run = async () => {
    try {
      const servicesPromise = allCustomerPages<Service>('/catalog/services')
      const categoriesPromise = apiRequest<{ id: string; name: string }[]>('/catalog/categories')
      const userPromise = apiRequest<User>('/auth/session').then(normalizeCustomerUser).then((user) => {
        if (current === generation && isCustomerSessionCurrent(scope) && user.id !== scope.userId) {
          const previousScope = scope
          replaceIdentity(user)
          scope = captureCustomerSession()
          if (previousScope.userId === null) observedAuthentication = { from: previousScope, to: scope }
          emit()
        }
        return user
      }).catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          // This promise may settle after Catalog has already rejected Promise.all.
          // Clear private data immediately, without invalidating this same refresh.
          if (current === generation && isCustomerSessionCurrent(scope) && state?.session) {
            replaceIdentity(null)
            scope = captureCustomerSession()
            status = { ...status, revision: status.revision + 1, sessionError: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' }
            emit()
          }
          return null
        }
        throw error
      })
      const [services, categories, sessionUser] = await Promise.all([servicesPromise, categoriesPromise, userPromise])
      if (!Array.isArray(categories) || categories.some((category) => typeof category.id !== 'string' || typeof category.name !== 'string')) throw new ApiError('Danh mục API không đúng định dạng.', 502, 'INVALID_RESPONSE')
      const categoryNames = new Map(categories.map((category) => [category.id, category.name]))
      const next = emptyState(services.map((service) => ({ ...service, categoryName: categoryNames.get(service.category) ?? service.categoryName })))
      if (sessionUser) {
        const [profile, orders, payments, reviews] = await Promise.all([
          apiRequest<User>('/users/me'), allCustomerPages<ApiOrder>('/orders'), allCustomerPages<ApiPayment>('/payments'), allCustomerPages<ApiReview>('/reviews'),
        ])
        const user = normalizeCustomerUser(profile)
        const ownedOrderIds = new Set(orders.map((order) => order.id))
        if (user.id !== sessionUser.id || orders.some((order) => order.customerId !== user.id)
          || reviews.some((review) => review.customerId !== user.id) || payments.some((payment) => !ownedOrderIds.has(payment.orderId))) {
          throw new ApiError('Phiên đã thay đổi trong khi tải dữ liệu. Vui lòng đăng nhập lại.', 401, 'SESSION_CHANGED')
        }
        next.users = [user]
        next.session = { userId: user.id, role: 'customer' }
        next.orders = orders.map(normalizeOrder)
        // The schema has no payment creation timestamp; an empty value is never a fabricated date.
        next.payments = payments.map((payment) => ({ ...payment, createdAt: payment.createdAt ?? '' }))
        next.reviews = reviews.map((review) => ({ ...review, serviceRating: review.rating, staffRating: review.rating, hidden: false }))
      }
      if (current !== generation || !isCustomerSessionCurrent(scope)) return
      state = next
      fullCacheRevision++
      status = { status: 'ready', revision: status.revision + 1, dirty: false, ...(!sessionUser && wasAuthenticated ? { sessionError: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' } : {}) }
      emit()
    } catch (error) {
      if (current !== generation || !isCustomerSessionCurrent(scope)) return
      if (error instanceof ApiError && error.status === 401) { expireCustomerSession(); return }
      status = { status: 'unavailable', revision: status.revision + 1, dirty: false, error: customerRequestError(error, scope), ...(status.sessionError ? { sessionError: status.sessionError } : {}) }
      emit()
    }
  }
  const task = run().finally(() => { if (active === task) active = null })
  active = task
  return task
}

export async function refreshCustomerOrder(id: string) {
  const scope = captureCustomerSession()
  const cacheRevision = fullCacheRevision
  const currentUser = state?.session?.userId
  if (!currentUser) return
  try {
    const order = normalizeOrder(await apiRequest<ApiOrder>(`/orders/${encodeURIComponent(id)}`))
    if (!state || !isCustomerSessionCurrent(scope) || cacheRevision !== fullCacheRevision) return
    if (order.customerId !== currentUser) throw new ApiError('Dữ liệu đơn không thuộc phiên hiện tại.', 401, 'SESSION_CHANGED')
    state = { ...state, orders: [order, ...state.orders.filter((item) => item.id !== order.id)] }
    emit()
  } catch (error) {
    if (!state || !isCustomerSessionCurrent(scope) || cacheRevision !== fullCacheRevision) return
    if (error instanceof ApiError && error.status === 404) {
      state = { ...state, orders: state.orders.filter((item) => item.id !== id) }
      emit()
      return
    }
    if (error instanceof ApiError && error.status === 401) { expireCustomerSession(); return }
    status = { ...status, status: 'unavailable', error: customerRequestError(error, scope) }
    emit()
  }
}

export async function refreshCustomerService(id: string) {
  const current = generation
  const scope = captureCustomerSession()
  try {
    const service = await apiRequest<Service>(`/catalog/services/${encodeURIComponent(id)}`)
    if (!state || generation !== current) return
    const exists = state.services.some((item) => item.id === service.id)
    state = { ...state, services: exists ? state.services.map((item) => item.id === service.id ? service : item) : [...state.services, service] }
    emit()
  } catch (error) {
    if (!state || generation !== current) return
    if (error instanceof ApiError && error.status === 404) {
      state = { ...state, services: state.services.filter((item) => item.slug !== id) }
      emit()
      return
    }
    status = { ...status, status: 'unavailable', error: customerRequestError(error, scope) }
    emit()
  }
}

const focusRefresh = () => { if (document.visibilityState === 'visible') void refreshCustomerData() }
export function subscribeCustomerData(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) {
    void refreshCustomerData()
    window.addEventListener('focus', focusRefresh)
    document.addEventListener('visibilitychange', focusRefresh)
    polling = setInterval(focusRefresh, 30000)
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      window.removeEventListener('focus', focusRefresh)
      document.removeEventListener('visibilitychange', focusRefresh)
      clearInterval(polling)
    }
  }
}

export async function finishCustomerMutation(scope = captureCustomerSession()) {
  if (!isCustomerSessionCurrent(scope)) throw new ApiError('Phiên đã thay đổi. Vui lòng kiểm tra tài khoản hiện tại.', 409, 'SESSION_CHANGED')
  await refreshCustomerData(true)
  if (!isCustomerSessionCurrent(scope)) throw new ApiError('Phiên đã thay đổi. Vui lòng đăng nhập lại khi cần.', 401, 'SESSION_CHANGED')
  if (status.status !== 'ready') throw new ApiError('Thay đổi đã được API tiếp nhận nhưng chưa tải lại được dữ liệu. Hãy tải lại trước khi gửi thêm.', 503, 'REFRESH_FAILED')
  if (!state?.session) throw new ApiError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', 401, 'UNAUTHENTICATED')
}

export async function logoutCustomer() {
  const scope = captureCustomerSession()
  try {
    await apiRequest('/auth/logout', { method: 'POST', body: '{}' })
    if (!isCustomerSessionCurrent(scope)) return { ok: false, error: 'Phiên đã thay đổi. Vui lòng kiểm tra tài khoản hiện tại.' } as const
    generation++
    replaceIdentity(null)
    status = { status: 'ready', revision: status.revision + 1, dirty: false }
    emit()
    return { ok: true } as const
  } catch (error) { return { ok: false, error: customerRequestError(error, scope) } as const }
}
