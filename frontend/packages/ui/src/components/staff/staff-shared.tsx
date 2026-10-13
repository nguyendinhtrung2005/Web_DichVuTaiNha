"use client"

import type { ReactNode } from "react"
import { AreaLink as Link } from "@/components/shared/area-routes"
import { ArrowRightIcon, CalendarDaysIcon, ClipboardListIcon, MapPinIcon, UserRoundIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { JobStatusBadge, OrderStatusBadge } from "@/components/shared/status-badge"
import type { AppState, Order, Service } from "@/lib/types"

export const JOB_FILTER_OPTIONS = [
  { value: "waiting", label: "Chờ tiếp nhận" },
  { value: "accepted", label: "Đã tiếp nhận" },
  { value: "in_progress", label: "Đang thực hiện" },
  { value: "done", label: "Đã hoàn thành" },
  { value: "cancelled", label: "Đã hủy" },
  { value: "pending", label: "Chờ xác nhận đơn" },
  { value: "confirmed", label: "Đã xác nhận đơn" },
]

export function jobFilterValue(order: Order) {
  if (order.status === "cancelled") return "cancelled" as const
  if (order.status === "completed") return "done" as const
  if (order.status === "in_progress") return "in_progress" as const
  return order.jobStatus || order.status
}

export function localDateKey(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value
  if (!Number.isFinite(date.getTime())) return ""
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

export function formatJobTime(value: string) {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" }) : "Chưa có lịch hợp lệ"
}

export function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase().trim()
}

// Read-only validation: never reset or repair stored business data in the UI.
export function getAssignedJobs(state: AppState, userId: string): Order[] | null {
  if (!Array.isArray(state.orders) || !Array.isArray(state.services)) return null
  if (state.services.some((service) => !service || typeof service.id !== "string" || typeof service.name !== "string" || typeof service.unit !== "string" || !Array.isArray(service.scope) || service.scope.some((item) => typeof item !== "string"))) return null
  const jobs = state.orders.filter((order) => order?.staffId === userId)
  const statuses = new Set(["pending", "confirmed", "in_progress", "completed", "cancelled"])
  const jobStatuses = new Set(["waiting", "accepted", "in_progress", "done"])
  if (jobs.some((order) => ![order.id, order.code, order.serviceId, order.specialRequest, order.createdAt].every((value) => typeof value === "string")
    || !order.contact || ![order.contact.name, order.contact.phone, order.contact.address].every((value) => typeof value === "string")
    || typeof order.scheduledAt !== "string" || !Number.isFinite(new Date(order.scheduledAt).getTime()) || !statuses.has(order.status) || (order.jobStatus !== undefined && !jobStatuses.has(order.jobStatus))
    || !Number.isFinite(order.quantity) || !Number.isFinite(order.price) || !Number.isFinite(order.durationMinutes)
    || !Array.isArray(order.history) || order.history.some((entry) => !entry || ![entry.label, entry.at, entry.by].every((value) => typeof value === "string"))
    || !Array.isArray(order.staffNotes) || order.staffNotes.some((note) => !note || ![note.text, note.at, note.staffId].every((value) => typeof value === "string")))) return null
  return jobs
}

export function StaffPageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <header className="mb-7 flex min-w-0 flex-col items-start gap-5 sm:mb-8 sm:flex-row sm:justify-between"><div className="min-w-0"><p className="m-0 mb-2 text-xs font-semibold tracking-[0.12em] text-primary uppercase">CleanHome / Nhân viên</p><h1 className="m-0 break-words text-2xl leading-tight font-bold tracking-tight sm:text-3xl">{title}</h1>{description && <p className="m-0 mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{description}</p>}</div>{action && <div className="flex w-full shrink-0 flex-wrap gap-3 sm:w-auto">{action}</div>}</header>
}

export function StaffLoading() {
  return <div aria-busy="true" aria-label="Đang tải công việc" className="space-y-6"><Skeleton className="h-10 w-56" /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-28 rounded-2xl" />)}</div><Skeleton className="h-72 rounded-2xl" /></div>
}

export function StaffEmpty({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <section className="rounded-2xl border border-dashed border-border bg-white px-5 py-12 text-center"><div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-blue-50 text-primary"><ClipboardListIcon aria-hidden="true" className="size-6" /></div><h2 className="m-0 text-lg font-semibold">{title}</h2>{description && <p className="mx-auto mt-3 mb-0 max-w-md text-sm leading-7 text-muted-foreground">{description}</p>}{action && <div className="mt-6 flex flex-wrap justify-center gap-3">{action}</div>}</section>
}

export function StaffError({ title = "Chưa thể tải công việc" }: { title?: string }) {
  return <section role="alert" className="rounded-2xl border border-red-200 bg-white px-5 py-10"><h1 className="m-0 text-xl font-semibold">{title}</h1><p className="mt-3 mb-6 text-sm leading-7 text-muted-foreground">Dữ liệu chưa đọc được. Vui lòng tải lại trang hoặc liên hệ người quản lý nếu lỗi vẫn tiếp diễn.</p><Button variant="outline" onClick={() => window.location.reload()}>Tải lại trang</Button></section>
}

export function StaffJobBadge({ order }: { order: Order }) {
  return order.status === "cancelled" || order.status === "completed" || !order.jobStatus ? <OrderStatusBadge status={order.status} /> : <JobStatusBadge status={order.jobStatus} />
}

export function StaffJobCard({ order, service }: { order: Order; service?: Service }) {
  return <Card className="min-w-0 rounded-2xl shadow-none ring-border [--card-spacing:--spacing(5)]"><CardContent className="flex min-w-0 flex-col gap-4"><div className="flex flex-wrap items-center justify-between gap-3"><p className="m-0 text-xs font-semibold text-muted-foreground">{order.code}</p><StaffJobBadge order={order} /></div><h3 className="m-0 break-words text-base leading-7 font-semibold">{service?.name || "Dịch vụ đã lưu"}</h3><dl className="m-0 space-y-3 text-sm"><div className="flex min-w-0 items-start gap-2.5"><CalendarDaysIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" /><dt className="sr-only">Lịch thực hiện</dt><dd className="m-0 min-w-0 break-words">{formatJobTime(order.scheduledAt)}</dd></div><div className="flex min-w-0 items-start gap-2.5"><UserRoundIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><dt className="sr-only">Khách hàng</dt><dd className="m-0 min-w-0 break-words">{order.contact.name}</dd></div><div className="flex min-w-0 items-start gap-2.5"><MapPinIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><dt className="sr-only">Địa chỉ</dt><dd className="m-0 min-w-0 break-words leading-6">{order.contact.address}</dd></div></dl>{order.cancelRequest?.status === "pending" && <p className="m-0 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-6 text-amber-800">Có yêu cầu hủy đang chờ xử lý.</p>}<Button variant="outline" className="mt-auto w-full justify-between" aria-label={`Xem công việc ${order.code}`} render={<Link href={`/don/${order.id}`} />} nativeButton={false}>Xem chi tiết<ArrowRightIcon aria-hidden="true" /></Button></CardContent></Card>
}
