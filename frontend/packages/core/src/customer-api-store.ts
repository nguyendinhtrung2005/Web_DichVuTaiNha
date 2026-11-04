"use client"

import { ApiError, apiRequest } from './api-client'
import type { AppState, Order, Payment, Review, Service, User } from './types'

export type CustomerDataStatus = { status: 'loading' | 'ready' | 'unavailable'; revision: number; dirty: boolean; error?: string; sessionError?: string }
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
let polling: ReturnType<typeof setInterval> | undefined
const emit = () => listeners.forEach((listener) => listener())
const emptyState = (services: Service[] = []): AppState => ({ version: 1, services, users: [], orders: [], payments: [], reviews: [], passwordHashes: {}, session: null })

export const customerSnapshot = () => state
export const customerStatus = () => status
export function normalizeCustomerUser(user: User): User {
  if (!user || typeof user.id !== 'string' || typeof user.name !== 'string' || typeof user.phone !== 'string' || user.role !== 'customer') throw new ApiError('API trả thông tin tài khoản không hợp lệ.', 502, 'INVALID_RESPONSE')
  return { ...user, email: user.email ?? '', address: user.address ?? '' }
}

export async function allCustomerPages<T>(path: string): Promise<T[]> {
  const items: T[] = []
  for (let page = 1; page <= 10000; page++) {
    const result = await apiRequest<Page<T>>(`${path}${path.includes('?') ? '&' : '?'}page=${page}&limit=100`)
    if (!result || !Array.isArray(result.items) || !Number.isInteger(result.total) || result.total < 0 || result.page !== page || !Number.isInteger(result.limit) || result.limit < 1) throw new ApiError('Danh sách API không đúng định dạng.', 502, 'INVALID_RESPONSE')
    items.push(...result.items)
    if (items.length >= result.total) return items
    if (!result.items.length) throw new ApiError('API trả danh sách chưa đầy đủ.', 502, 'INVALID_RESPONSE')
  }
  throw new ApiError('Danh sách vượt giới hạn tải. Vui lòng thử lại.', 502, 'INVALID_RESPONSE')
}

export function expireCustomerSession() {
  generation++
  state = emptyState(state?.services)
  status = { status: 'ready', revision: status.revision + 1, dirty: false, sessionError: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' }
  emit()
}

export function customerRequestError(error: unknown): string {
  if (error instanceof ApiError && error.status === 401 && state?.session) expireCustomerSession()
  return error instanceof Error ? error.message : 'Chưa thể thực hiện yêu cầu. Vui lòng thử lại.'
}

export function refreshCustomerData(force = false): Promise<void> {
  if (active && !force) return active
  const current = ++generation
  const wasAuthenticated = Boolean(state?.session)
  if (!state) { status = { status: 'loading', revision: status.revision, dirty: false }; emit() }
  const run = async () => {
    try {
      const servicesPromise = allCustomerPages<Service>('/catalog/services')
      const categoriesPromise = apiRequest<{ id: string; name: string }[]>('/catalog/categories')
      const userPromise = apiRequest<User>('/auth/session').then(normalizeCustomerUser).catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) return null
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
        next.users = [user]
        next.session = { userId: user.id, role: 'customer' }
        next.orders = orders.map(normalizeOrder)
        // The schema has no payment creation timestamp; an empty value is never a fabricated date.
        next.payments = payments.map((payment) => ({ ...payment, createdAt: payment.createdAt ?? '' }))
        next.reviews = reviews.map((review) => ({ ...review, serviceRating: review.rating, staffRating: review.rating, hidden: false }))
      }
      if (current !== generation) return
      state = next
      status = { status: 'ready', revision: status.revision + 1, dirty: false, ...(!sessionUser && wasAuthenticated ? { sessionError: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' } : {}) }
      emit()
    } catch (error) {
      if (current !== generation) return
      if (error instanceof ApiError && error.status === 401) { expireCustomerSession(); return }
      status = { status: 'unavailable', revision: status.revision + 1, dirty: false, error: customerRequestError(error) }
      emit()
    }
  }
  const task = run().finally(() => { if (active === task) active = null })
  active = task
  return task
}

export async function refreshCustomerOrder(id: string) {
  const currentGeneration = generation
  const currentUser = state?.session?.userId
  if (!currentUser) return
  try {
    const order = normalizeOrder(await apiRequest<ApiOrder>(`/orders/${encodeURIComponent(id)}`))
    if (state?.session?.userId !== currentUser || generation !== currentGeneration) return
    state = { ...state, orders: [order, ...state.orders.filter((item) => item.id !== order.id)] }
    emit()
  } catch (error) {
    if (state?.session?.userId !== currentUser || generation !== currentGeneration) return
    if (error instanceof ApiError && error.status === 404) {
      state = { ...state, orders: state.orders.filter((item) => item.id !== id) }
      emit()
      return
    }
    if (error instanceof ApiError && error.status === 401) { expireCustomerSession(); return }
    status = { ...status, status: 'unavailable', error: customerRequestError(error) }
    emit()
  }
}

export async function refreshCustomerService(id: string) {
  const current = generation
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
    status = { ...status, status: 'unavailable', error: customerRequestError(error) }
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

export async function finishCustomerMutation() {
  await refreshCustomerData(true)
  if (status.status !== 'ready') throw new ApiError('Thay đổi đã được API tiếp nhận nhưng chưa tải lại được dữ liệu. Hãy tải lại trước khi gửi thêm.', 503, 'REFRESH_FAILED')
  if (!state?.session) throw new ApiError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', 401, 'UNAUTHENTICATED')
}

export async function logoutCustomer() {
  try {
    await apiRequest('/auth/logout', { method: 'POST', body: '{}' })
    generation++
    state = emptyState(state?.services)
    status = { status: 'ready', revision: status.revision + 1, dirty: false }
    emit()
    return { ok: true } as const
  } catch (error) { return { ok: false, error: customerRequestError(error) } as const }
}
