"use client"

import type { ReactNode } from "react"
import { ClipboardListIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { AppState } from "@/lib/types"

export function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase().trim()
}

export function localDateKey(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value
  if (!Number.isFinite(date.getTime())) return ""
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

export function formatAdminTime(value: string) {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" }) : "Chưa có lịch hợp lệ"
}

const validDate = (value: unknown) => typeof value === "string" && Number.isFinite(new Date(value).getTime())
const optionalText = (value: unknown) => value === undefined || typeof value === "string"
const nonnegative = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0

// Check data without changing or replacing the existing store.
export function getAdminDataError(state: AppState): string | null {
  if (![state.orders, state.services, state.users, state.payments, state.reviews].every(Array.isArray)) return "Chưa thể đọc dữ liệu quản trị"
  if (state.services.some((service) => !service || ![service.id, service.name, service.unit, service.image].every((value) => typeof value === "string") || ![service.scope, service.included, service.excluded].every((items) => Array.isArray(items) && items.every((item) => typeof item === "string")))) return "Chưa thể đọc dữ liệu dịch vụ"
  if (state.users.some((user) => !user || ![user.id, user.name].every((value) => typeof value === "string") || !["customer", "staff", "admin"].includes(user.role) || !["active", "locked"].includes(user.status))) return "Chưa thể đọc dữ liệu tài khoản"
  if (state.orders.some((order) => !order || ![order.id, order.code, order.customerId, order.serviceId, order.specialRequest].every((value) => typeof value === "string")
    || !order.contact || ![order.contact.name, order.contact.phone, order.contact.address, order.contact.houseType].every((value) => typeof value === "string")
    || ![order.contact.area, order.contact.rooms, order.contact.floors].every((value) => value === undefined || nonnegative(value)) || typeof order.contact.hasPets !== "boolean"
    || !validDate(order.scheduledAt) || !validDate(order.createdAt) || !["pending", "confirmed", "in_progress", "completed", "cancelled"].includes(order.status)
    || !optionalText(order.staffId) || (order.jobStatus !== undefined && !["waiting", "accepted", "in_progress", "done"].includes(order.jobStatus))
    || ![order.quantity, order.price, order.durationMinutes].every(nonnegative)
    || !Array.isArray(order.history) || order.history.some((entry) => !entry || !validDate(entry.at) || ![entry.label, entry.by].every((value) => typeof value === "string") || !optionalText(entry.note))
    || !Array.isArray(order.staffNotes) || order.staffNotes.some((note) => !note || !validDate(note.at) || ![note.text, note.staffId].every((value) => typeof value === "string"))
    || (order.cancelRequest !== undefined && (!order.cancelRequest || typeof order.cancelRequest.reason !== "string" || !validDate(order.cancelRequest.requestedAt) || !["pending", "approved", "rejected"].includes(order.cancelRequest.status) || !optionalText(order.cancelRequest.adminNote))))) return "Chưa thể đọc dữ liệu đơn dịch vụ"
  if (state.payments.some((payment) => !payment || ![payment.id, payment.code, payment.orderId].every((value) => typeof value === "string") || !nonnegative(payment.amount) || !["paid", "pending", "unpaid"].includes(payment.status) || !["cash", "transfer"].includes(payment.method) || !validDate(payment.createdAt) || (payment.confirmedAt !== undefined && !validDate(payment.confirmedAt)))) return "Chưa thể đọc dữ liệu thanh toán"
  if (state.reviews.some((review) => !review || ![review.id, review.orderId, review.comment].every((value) => typeof value === "string")
    || !Number.isInteger(review.serviceRating) || review.serviceRating < 1 || review.serviceRating > 5
    || (review.staffRating !== undefined && (!Number.isInteger(review.staffRating) || review.staffRating < 1 || review.staffRating > 5))
    || (review.staffId !== undefined && review.staffRating === undefined))) return "Chưa thể đọc dữ liệu đánh giá"
  return null
}

export function AdminPageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <header className="mb-7 flex min-w-0 flex-col items-start gap-5 sm:mb-8 sm:flex-row sm:justify-between"><div className="min-w-0"><p className="m-0 mb-2 text-xs font-semibold tracking-[0.12em] text-primary uppercase">CleanHome / Quản trị</p><h1 className="m-0 break-words text-2xl leading-tight font-bold tracking-tight sm:text-3xl">{title}</h1>{description && <p className="m-0 mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{description}</p>}</div>{action && <div className="flex w-full shrink-0 flex-wrap gap-3 sm:w-auto">{action}</div>}</header>
}

export function AdminLoading() {
  return <div role="status" aria-label="Đang tải dữ liệu quản trị" aria-busy="true" className="space-y-6"><Skeleton className="h-10 w-56" /><div className="grid grid-cols-2 gap-4 xl:grid-cols-4">{[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-28 rounded-2xl" />)}</div><Skeleton className="h-72 rounded-2xl" /></div>
}

export function AdminEmpty({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <section className="min-w-0 rounded-2xl border border-dashed border-border bg-white px-5 py-10 text-center"><div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-blue-50 text-primary"><ClipboardListIcon aria-hidden="true" className="size-6" /></div><h2 className="m-0 break-words text-lg font-semibold">{title}</h2>{description && <p className="mx-auto mt-3 mb-0 max-w-md text-sm leading-7 text-muted-foreground">{description}</p>}{action && <div className="mt-6 flex flex-wrap justify-center gap-3">{action}</div>}</section>
}

export function AdminError({ title = "Chưa thể tải dữ liệu quản trị" }: { title?: string }) {
  return <section role="alert" className="rounded-2xl border border-red-200 bg-white px-5 py-10"><h1 className="m-0 break-words text-xl font-semibold">{title}</h1><p className="mt-3 mb-6 text-sm leading-7 text-muted-foreground">Dữ liệu chưa đọc được. Hãy tải lại trang; nếu lỗi tiếp diễn, liên hệ người phụ trách để kiểm tra dữ liệu.</p><Button variant="outline" onClick={() => window.location.reload()}>Tải lại trang</Button></section>
}
