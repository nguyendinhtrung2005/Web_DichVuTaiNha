import type { BookingRequest } from "./booking-service"
import type { BookingValues } from "./booking-validation"
import type { PaymentMethod } from "@/lib/types"

export type BookingDraft = {
  values: BookingValues
  step: number
  attempt: BookingRequest | null
  uncertain: boolean
  paymentMethod?: PaymentMethod
  paymentPending?: boolean
}

// Personal form data stays in this tab's memory, never browser storage.
let owner: string | null = null
let generation = 0
const drafts = new Map<string, BookingDraft>()

export function clearBookingDrafts() {
  generation++
  owner = null
  drafts.clear()
}

export function selectBookingDraftCustomer(customerId: string | null) {
  // A temporary expired session can recover after the same customer signs in.
  if (!customerId || customerId === owner) return
  clearBookingDrafts()
  owner = customerId
}

export function openBookingDraft(customerId: string, route: string) {
  selectBookingDraftCustomer(customerId)
  const epoch = generation
  const current = () => owner === customerId && generation === epoch
  return {
    read: () => current() && drafts.has(route) ? structuredClone(drafts.get(route)!) : null,
    save(value: BookingDraft) { if (current()) drafts.set(route, structuredClone(value)) },
    clear() { if (current()) drafts.delete(route) },
    isCurrent: current,
  }
}
