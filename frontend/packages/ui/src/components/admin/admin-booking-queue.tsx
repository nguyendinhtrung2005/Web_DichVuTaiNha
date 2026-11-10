"use client"

import { useEffect, useState } from "react"
import { AreaLink as Link } from "@/components/shared/area-routes"
import { CalendarDaysIcon, MapPinIcon } from "lucide-react"
import { listAdminServiceOrders, type AdminServiceOrder } from "@/lib/admin-service-orders"
import { Field } from "../../common"
import { OrderStatusBadge } from "../shared/status-badge"
import { Button } from "../ui/button"
import { Card, CardContent } from "../ui/card"
import { Input } from "../ui/input"
import { AdminEmpty, formatAdminTime } from "./admin-shared"

const decisionLabels: Record<string, string> = {
  AUTO_CONFIRMED: "Đã tự xác nhận",
  NEEDS_DISPATCH: "Cần điều phối",
  NEEDS_ADMIN: "Chờ admin xử lý",
  ADMIN_CONFIRMED: "Admin đã xác nhận",
  ADMIN_REJECTED: "Admin đã từ chối",
  ADMIN_CANCELLED: "Admin đã hủy",
  LEGACY: "Đơn cũ",
}

function DecisionBadge({ state }: { state: string }) {
  const alert = state === "NEEDS_ADMIN" || state === "NEEDS_DISPATCH"
  return <span className={`inline-flex min-h-7 items-center rounded-full border px-3 py-1 text-xs font-semibold ${alert ? "border-amber-300 bg-amber-50 text-amber-900" : "border-border bg-muted text-foreground"}`}>
    {decisionLabels[state] ?? state}
  </span>
}

export function AdminBookingQueue() {
  const [orders, setOrders] = useState<AdminServiceOrder[]>([])
  const [status, setStatus] = useState("")
  const [decisionState, setDecisionState] = useState("")
  const [branchId, setBranchId] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [reason, setReason] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [reload, setReload] = useState(0)
  const rangeError = Boolean(from && to && from > to)

  useEffect(() => {
    if (rangeError) {
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setError("")
    void listAdminServiceOrders({
      status, decisionState, branchId, from, to, reason, signal: controller.signal,
    }).then((result) => {
      if (!controller.signal.aborted) setOrders(result)
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Chưa thể tải danh sách đơn dịch vụ.")
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [status, decisionState, branchId, from, to, reason, rangeError, reload])

  return <section aria-label="Đơn dịch vụ từ hệ thống" className="min-w-0 space-y-5 rounded-2xl border border-border bg-white p-5 sm:p-6">
    <div>
      <h2 className="m-0 text-lg font-semibold">Đơn dịch vụ từ hệ thống</h2>
      <p className="m-0 mt-1 text-sm leading-6 text-muted-foreground">Queue và quyết định được tải từ API quản trị; đơn sản phẩm không nằm trong danh sách này.</p>
    </div>
    <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Field label="Trạng thái booking">
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">Tất cả trạng thái</option>
          <option value="pending">Chờ xác nhận</option>
          <option value="confirmed">Đã xác nhận</option>
          <option value="in_progress">Đang thực hiện</option>
          <option value="completed">Hoàn thành</option>
          <option value="cancelled">Đã hủy</option>
        </select>
      </Field>
      <Field label="Kết quả tự động">
        <select value={decisionState} onChange={(event) => setDecisionState(event.target.value)}>
          <option value="">Tất cả quyết định</option>
          <option value="AUTO_CONFIRMED">Đã tự xác nhận</option>
          <option value="NEEDS_DISPATCH">Cần điều phối</option>
          <option value="NEEDS_ADMIN">Chờ admin xử lý</option>
          <option value="ADMIN_CONFIRMED">Admin đã xác nhận</option>
          <option value="ADMIN_REJECTED">Admin đã từ chối</option>
          <option value="ADMIN_CANCELLED">Admin đã hủy</option>
          <option value="LEGACY">Đơn cũ</option>
        </select>
      </Field>
      <Field label="Mã chi nhánh"><Input inputMode="numeric" value={branchId} placeholder="Tất cả chi nhánh" onChange={(event) => setBranchId(event.target.value.replace(/\D/g, ""))} /></Field>
      <Field label="Lý do cần xử lý"><Input value={reason} placeholder="Tìm trong lý do quyết định" onChange={(event) => setReason(event.target.value)} /></Field>
      <Field label="Lịch từ ngày"><Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></Field>
      <Field label="Đến ngày" error={rangeError ? "Ngày kết thúc phải từ ngày bắt đầu trở đi." : undefined}><Input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} /></Field>
    </div>
    {loading ? <p role="status" aria-live="polite" className="m-0 py-5 text-sm text-muted-foreground">Đang tải đơn dịch vụ...</p>
      : error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-800">
        <p className="m-0">{error}</p>
        <Button className="mt-3" variant="outline" onClick={() => setReload((value) => value + 1)}>Thử tải lại</Button>
      </div>
        : rangeError ? <AdminEmpty title="Khoảng ngày chưa hợp lệ" description="Điều chỉnh ngày bắt đầu hoặc ngày kết thúc." />
          : orders.length === 0 ? <AdminEmpty title="Không có đơn dịch vụ phù hợp" description="Đơn hàng chờ điều phối hoặc cần admin xử lý sẽ xuất hiện tại đây." />
            : <div className="grid min-w-0 gap-3">
              <p role="status" aria-live="polite" className="m-0 text-sm text-muted-foreground">{orders.length} đơn dịch vụ</p>
              {orders.map((order) => <Card key={order.id} className="min-w-0 rounded-xl shadow-none ring-border">
                <CardContent className="flex min-w-0 flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{order.code}</span><OrderStatusBadge status={order.status} /><DecisionBadge state={order.decisionState} /></div>
                    <p className="m-0 break-words text-sm font-medium">{order.serviceName || "Dịch vụ đã lưu"} · {order.contact.name}</p>
                    <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-2"><CalendarDaysIcon aria-hidden="true" className="size-4" />{formatAdminTime(order.scheduledAt)}</span>
                      <span className="inline-flex items-center gap-2"><MapPinIcon aria-hidden="true" className="size-4" />Chi nhánh {order.branchId ?? "chưa xác định"}</span>
                    </div>
                    {order.decisionReason && <p className="m-0 max-w-3xl break-words text-sm leading-6 text-amber-900">{order.decisionReason}</p>}
                    {order.assignment && <p className="m-0 text-sm text-muted-foreground">Nhân viên: {order.assignment.employeeName}</p>}
                  </div>
                  <Button variant="outline" className="min-h-11 w-full shrink-0 sm:w-auto" render={<Link href={`/don/${order.id}`} />} nativeButton={false}>Xem và xử lý</Button>
                </CardContent>
              </Card>)}
            </div>}
  </section>
}
