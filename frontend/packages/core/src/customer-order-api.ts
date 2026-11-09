import { ApiError, apiRequest } from './api-client'
import { captureCustomerSession, customerRequestError, isCustomerSessionCurrent } from './customer-api-store'
import type { Order } from './types'

export type CustomerOrderFilters = { query: string; serviceId: string; status: string; from: string; to: string; sort: string; page: number; limit: number }
type OrderPage = { items: Order[]; total: number; page: number; limit: number }

export async function getCustomerOrders(filters: CustomerOrderFilters, signal?: AbortSignal): Promise<OrderPage> {
  const scope = captureCustomerSession()
  try {
    if (!scope.userId) throw new ApiError('Vui lòng đăng nhập để xem đơn dịch vụ.', 401, 'UNAUTHENTICATED')
    const params = new URLSearchParams({ page: String(filters.page), limit: String(filters.limit), sort: filters.sort })
    for (const [key, value] of Object.entries({ q: filters.query.trim(), serviceId: filters.serviceId, status: filters.status, from: filters.from, to: filters.to })) {
      if (value) params.set(key, value)
    }
    const result = await apiRequest<OrderPage>(`/orders?${params}`, { signal })
    if (!isCustomerSessionCurrent(scope)) throw new ApiError('Phiên đã thay đổi. Vui lòng xem đơn trong đúng tài khoản.', 409, 'SESSION_CHANGED')
    if (!result || !Array.isArray(result.items) || !Number.isInteger(result.total) || result.total < 0 || result.page !== filters.page || result.limit !== filters.limit
      || result.items.length > filters.limit || result.items.length > result.total
      || result.items.some((order) => !order || typeof order.id !== 'string' || order.customerId !== scope.userId || !order.contact || !Array.isArray(order.items))) {
      throw new ApiError('API trả danh sách đơn không hợp lệ.', 502, 'INVALID_RESPONSE')
    }
    return { ...result, items: result.items.map((order) => ({ ...order, createdAt: order.createdAt ?? '' })) }
  } catch (error) {
    customerRequestError(error, scope)
    throw error
  }
}
