"use client"

import { ApiError, apiRequest } from '@/lib/api-client'
import { customerRequestError, finishCustomerMutation } from '@/lib/customer-api-store'
import type { Order, OrderContact, PaymentMethod } from '@/lib/types'

export type BookingRequest = { requestKey: string; serviceId: string; quantity: number; contact: OrderContact; scheduledAt: string; specialRequest: string }
export type Persistence = 'local' | 'session' | 'server'
export type MutationResult<T = undefined> = { ok: true; data: T; persistence: Persistence } | { ok: false; error: string }
export type BookingResult = { ok: true; order: Order; persistence: Persistence } | { ok: false; error: string; uncertain: boolean }
export type CustomerReviewInput = { rating: number; comment: string }

export const customerOrderService = {
  async saveBooking(input: BookingRequest): Promise<BookingResult> {
    try {
      const { requestKey, ...booking } = input
      const order = await apiRequest<Order>('/orders', { method: 'POST', body: JSON.stringify({ ...booking, requestKey }) })
      await finishCustomerMutation()
      return { ok: true, order, persistence: 'server' }
    } catch (error) {
      return {
        ok: false,
        error: customerRequestError(error),
        uncertain: error instanceof ApiError && (error.status === 0 || error.status >= 500),
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
  try {
    await apiRequest(path, { method: 'POST', body: JSON.stringify(body) })
    await finishCustomerMutation()
    return { ok: true, data: undefined, persistence: 'server' }
  } catch (error) { return { ok: false, error: customerRequestError(error) } }
}

export const saveBookingRequest = (input: BookingRequest) => customerOrderService.saveBooking(input)
export const requestCustomerCancellation = (id: string, reason: string) => customerOrderService.requestCancellation(id, reason)
export const saveCustomerPayment = (id: string, method: PaymentMethod) => customerOrderService.savePayment(id, method)
export const saveCustomerReview = (id: string, review: CustomerReviewInput) => customerOrderService.saveReview(id, review)
