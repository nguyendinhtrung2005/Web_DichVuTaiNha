"use client"

import { ApiError, apiRequest } from '@/lib/api-client'
import { captureCustomerSession, isCustomerSessionCurrent, customerRequestError, finishCustomerMutation } from '@/lib/customer-api-store'
import type { Order, OrderContact, PaymentMethod } from '@/lib/types'

export type BookingRequest = { requestKey: string; serviceId: string; expectedUnitPrice: number; quantity: number; contact: OrderContact; scheduledAt: string; specialRequest: string; paymentMethod?: PaymentMethod }
export type Persistence = 'local' | 'session' | 'server'
export type MutationResult<T = undefined> = { ok: true; data: T; persistence: Persistence; warning?: string } | { ok: false; error: string }
export type BookingResult = { ok: true; order: Order; persistence: Persistence; warning?: string } | { ok: false; error: string; uncertain: boolean; code?: string; paymentPending?: boolean }
export type CustomerReviewInput = { rating: number; comment: string }

export const customerOrderService = {
  async saveBooking(input: BookingRequest): Promise<BookingResult> {
    const scope = captureCustomerSession()
    let savedOrder: Order | undefined
    try {
      const { requestKey, paymentMethod, ...booking } = input
      const order = await apiRequest<Order>('/orders', { method: 'POST', body: JSON.stringify({ ...booking, requestKey }) })
      savedOrder = order
      if (!isCustomerSessionCurrent(scope)) throw new ApiError('Phiên đã thay đổi. Hãy kiểm tra đơn trong đúng tài khoản.', 409, 'SESSION_CHANGED')
      if (paymentMethod) {
        const payment = await apiRequest<{ orderId: string; amount: number; method: PaymentMethod; status: string; simulated: boolean }>(`/orders/${encodeURIComponent(order.id)}/payment-simulation`, { method: 'POST', body: JSON.stringify({ method: paymentMethod }) })
        if (!payment || payment.orderId !== order.id || payment.method !== paymentMethod || payment.simulated !== true
          || payment.status !== (paymentMethod === 'cash' ? 'unpaid' : 'pending') || !Number.isFinite(payment.amount)
          || Math.round(payment.amount * 100) !== Math.round(order.price * 100)) throw new ApiError('API chưa xác nhận đúng lựa chọn thanh toán mô phỏng. Vui lòng kiểm tra lại trên lịch đã tạo.', 502, 'INVALID_PAYMENT_RESPONSE')
        if (!isCustomerSessionCurrent(scope)) throw new ApiError('Phiên đã thay đổi. Hãy kiểm tra đơn trong đúng tài khoản.', 409, 'SESSION_CHANGED')
      }
      try { await finishCustomerMutation(scope) }
      catch { return { ok: true, order, persistence: 'server', warning: 'Yêu cầu đã được lưu nhưng chưa tải lại được dữ liệu. Hãy kiểm tra đơn hoặc đăng nhập lại trước khi đặt thêm.' } }
      return { ok: true, order, persistence: 'server' }
    } catch (error) {
      const paymentPending = Boolean(savedOrder && input.paymentMethod)
      const message = customerRequestError(error, scope)
      return {
        ok: false,
        error: paymentPending ? 'Lịch dịch vụ đã được tạo, nhưng chưa xác nhận được việc lưu lựa chọn thanh toán. Thử lại đúng yêu cầu này để kiểm tra, không đặt lịch mới. ' + message : message,
        code: error instanceof ApiError ? error.code : undefined,
        uncertain: paymentPending || (error instanceof ApiError && (error.status === 0 || error.status >= 500)),
        paymentPending,
      }
    }
  },
  async requestCancellation(orderId: string, reason: string): Promise<MutationResult> {
    return mutate(`/orders/${encodeURIComponent(orderId)}/cancellation-requests`, { reason })
  },
  async savePayment(orderId: string, method: PaymentMethod): Promise<MutationResult> {
    return mutate(`/orders/${encodeURIComponent(orderId)}/payment-simulation`, { method })
  },
  async saveReview(orderId: string, review: CustomerReviewInput): Promise<MutationResult> {
    return mutate(`/orders/${encodeURIComponent(orderId)}/reviews`, review)
  },
}

async function mutate(path: string, body: object): Promise<MutationResult> {
  const scope = captureCustomerSession()
  try {
    await apiRequest(path, { method: 'POST', body: JSON.stringify(body) })
    if (!isCustomerSessionCurrent(scope)) throw new ApiError('Phiên đã thay đổi. Hãy kiểm tra kết quả trong đúng tài khoản trước khi gửi thêm.', 409, 'SESSION_CHANGED')
    try { await finishCustomerMutation(scope) }
    catch (error) {
      if (!isCustomerSessionCurrent(scope)) throw error
      return { ok: true, data: undefined, persistence: 'server', warning: 'Thay đổi đã được API lưu nhưng chưa tải lại được dữ liệu. Hãy tải lại đơn trước khi gửi thêm.' }
    }
    return { ok: true, data: undefined, persistence: 'server' }
  } catch (error) { return { ok: false, error: customerRequestError(error, scope) } }
}

export const saveBookingRequest = (input: BookingRequest) => customerOrderService.saveBooking(input)
export const requestCustomerCancellation = (id: string, reason: string) => customerOrderService.requestCancellation(id, reason)
export const saveCustomerPayment = (id: string, method: PaymentMethod) => customerOrderService.savePayment(id, method)
export const saveCustomerReview = (id: string, review: CustomerReviewInput) => customerOrderService.saveReview(id, review)
