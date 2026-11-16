"use client"

import { actions, executeStoreCommand, storedStateRaw, storedStateData } from "@/lib/store"
import type { AppState, Order, PaymentMethod } from "@/lib/types"

export type BookingRequest = Parameters<typeof actions.createOrder>[0]
export type Persistence = "local" | "session"
export type MutationResult<T = undefined> = { ok: true; data: T; persistence: Persistence } | { ok: false; error: string }
export type BookingResult = { ok: true; order: Order; persistence: Persistence } | { ok: false; error: string }
export type CustomerReviewInput = Parameters<typeof actions.submitReview>[1]

// Keep the current Order schema and store rules. A backend adapter can implement
// this same interface later; these methods currently only update browser data.
export interface CustomerOrderService {
  saveBooking(input: BookingRequest): Promise<BookingResult>
  requestCancellation(orderId: string, reason: string): Promise<MutationResult>
  savePayment(orderId: string, method: PaymentMethod): Promise<MutationResult>
  saveReview(orderId: string, review: CustomerReviewInput): Promise<MutationResult>
}

function persistenceOf(matches: (state: AppState) => boolean): Persistence {
  try {
    const raw = storedStateRaw()
    return raw && matches(storedStateData(raw)) ? "local" : "session"
  } catch { return "session" }
}

export const customerOrderService: CustomerOrderService = {
  async saveBooking(input) {
    return executeStoreCommand(() => {
      try {
        const result = actions.createOrder(input)
        if (!result.ok) return result
        return { ok: true, order: result.data, persistence: persistenceOf((state) => state.orders.some((order) => order.id === result.data.id)) }
      } catch { return { ok: false, error: "Chưa thể lưu yêu cầu. Vui lòng thử lại." } }
    })
  },
  async requestCancellation(orderId, reason) {
    return executeStoreCommand(() => {
      try {
        const startedAt = Date.now()
        const result = actions.requestCancel(orderId, reason)
        if (!result.ok) return result
        return { ok: true, data: undefined, persistence: persistenceOf((state) => { const request = state.orders.find((order) => order.id === orderId)?.cancelRequest; return request?.status === "pending" && request.reason === reason && new Date(request.requestedAt).getTime() >= startedAt }) }
      } catch { return { ok: false, error: "Chưa thể lưu yêu cầu hủy. Vui lòng thử lại." } }
    })
  },
  async savePayment(orderId, method) {
    return executeStoreCommand(() => {
      try {
        const startedAt = Date.now()
        const result = actions.submitPayment(orderId, method)
        if (!result.ok) return result
        return { ok: true, data: undefined, persistence: persistenceOf((state) => state.payments.some((payment) => payment.orderId === orderId && payment.method === method && payment.status === (method === "transfer" ? "pending" : "unpaid") && new Date(payment.createdAt).getTime() >= startedAt)) }
      } catch { return { ok: false, error: "Chưa thể lưu lựa chọn thanh toán. Vui lòng thử lại." } }
    })
  },
  async saveReview(orderId, review) {
    return executeStoreCommand(() => {
      try {
        const result = actions.submitReview(orderId, review)
        if (!result.ok) return result
        return { ok: true, data: undefined, persistence: persistenceOf((state) => state.reviews.some((item) => item.orderId === orderId && item.serviceRating === review.serviceRating && item.staffRating === review.staffRating && item.comment === review.comment)) }
      } catch { return { ok: false, error: "Chưa thể lưu đánh giá. Vui lòng thử lại." } }
    })
  },
}

export const saveBookingRequest = (input: BookingRequest) => customerOrderService.saveBooking(input)
export const requestCustomerCancellation = (orderId: string, reason: string) => customerOrderService.requestCancellation(orderId, reason)
export const saveCustomerPayment = (orderId: string, method: PaymentMethod) => customerOrderService.savePayment(orderId, method)
export const saveCustomerReview = (orderId: string, review: CustomerReviewInput) => customerOrderService.saveReview(orderId, review)
