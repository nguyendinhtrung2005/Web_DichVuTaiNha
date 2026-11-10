"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CalendarDaysIcon, MapPinIcon, RotateCcwIcon, UserRoundIcon } from "lucide-react"
import { Field, useData } from "../../common"
import { Button } from "../ui/button"
import { Card, CardContent } from "../ui/card"
import { Input } from "../ui/input"
import { Textarea } from "../ui/textarea"
import { AdminEmpty, AdminLoading, AdminPageHeader, formatAdminTime } from "./admin-shared"
import { BookingApiError, getAdminBooking, getAdminBookingOptions, listAdminBookings, mutateAdminBooking, type AdminBookingOptions, type AdminBookingMutation, type BookingDecisionState, type BookingRecord, type BookingStatus } from "./admin-bookings-api"

const PAGE_SIZE = 10
const STATUS_LABEL: Record<BookingStatus, string> = {
  PENDING: "Chờ xử lý",
  CONFIRMED: "Đã xác nhận",
  IN_PROGRESS: "Đang thực hiện",
  COMPLETED: "Đã hoàn thành",
  CANCELLED: "Đã hủy",
}
const DECISION_LABEL: Record<BookingDecisionState, string> = {
  AUTO_CONFIRMED: "Đã tự xác nhận",
  NEEDS_DISPATCH: "Cần điều phối",
  NEEDS_ADMIN: "Chờ admin xử lý",
  ADMIN_CONFIRMED: "Admin đã xác nhận",
  ADMIN_REJECTED: "Admin đã từ chối",
  ADMIN_CANCELLED: "Admin đã hủy",
  LEGACY: "Đơn cũ",
}

function localDateTime(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ""
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function badgeStyle(state: BookingDecisionState) {
  if (state === "AUTO_CONFIRMED" || state === "ADMIN_CONFIRMED") return "bg-emerald-50 text-emerald-800"
  if (state === "NEEDS_DISPATCH") return "bg-amber-50 text-amber-800"
  if (state === "NEEDS_ADMIN") return "bg-orange-50 text-orange-800"
  return "bg-slate-100 text-slate-700"
}

export function AdminBookings() {
  const { user, role } = useData()
  const [bookings, setBookings] = useState<BookingRecord[]>([])
  const [total, setTotal] = useState(0)
  const [options, setOptions] = useState<AdminBookingOptions>({ branches: [], employees: [] })
  const [optionsLoading, setOptionsLoading] = useState(false)
  const [selectedId, setSelectedId] = useState("")
  const [selected, setSelected] = useState<BookingRecord | null>(null)
  const [status, setStatus] = useState<BookingStatus | "">("")
  const [decisionState, setDecisionState] = useState<BookingDecisionState | "">("")
  const [branchFilter, setBranchFilter] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [reasonFilter, setReasonFilter] = useState("")
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<BookingApiError | null>(null)
  const [detailError, setDetailError] = useState("")
  const [feedback, setFeedback] = useState("")
  const [draft, setDraft] = useState({ scheduledAt: "", branchId: "", employeeId: "", durationMinutes: "", name: "", phone: "", address: "", region: "", reason: "" })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await listAdminBookings({
        page,
        pageSize: PAGE_SIZE,
        status,
        decisionState,
        branchId: branchFilter,
        from,
        to,
        reason: reasonFilter.trim(),
      })
      setBookings(result.items)
      setTotal(result.total)
      setOptions((current) => ({
        ...current,
        branches: Array.from(new Map([
          ...current.branches.map((branch) => [branch.id, branch] as const),
          ...result.items.filter((booking) => booking.branchId)
            .map((booking) => [booking.branchId!, { id: booking.branchId!, name: booking.branchName || `Chi nhánh #${booking.branchId}` }] as const),
        ]).values()),
      }))
    } catch (reason) {
      setError(reason instanceof BookingApiError ? reason : new BookingApiError("Không thể tải đơn dịch vụ.", 500, "REQUEST_FAILED"))
    } finally {
      setLoading(false)
    }
  }, [page, status, decisionState, branchFilter, from, to, reasonFilter])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!selectedId || !draft.scheduledAt || !draft.durationMinutes) return
    let active = true
    const timer = window.setTimeout(() => {
      const scheduledAt = new Date(draft.scheduledAt)
      const durationMinutes = Number(draft.durationMinutes)
      if (!Number.isFinite(scheduledAt.getTime()) || !Number.isInteger(durationMinutes) || durationMinutes < 1) return
      setOptionsLoading(true)
      getAdminBookingOptions(selectedId, {
        scheduledAt: scheduledAt.toISOString(),
        durationMinutes,
      }).then((result) => {
        if (!active) return
        setOptions((current) => ({
          branches: Array.from(new Map([...current.branches, ...result.branches].map((branch) => [branch.id, branch])).values()),
          employees: result.employees,
        }))
        setDraft((current) => current.employeeId && !result.employees.some((employee) =>
          employee.id === current.employeeId && employee.branchId === current.branchId && employee.available)
          ? { ...current, employeeId: "" }
          : current)
      }).catch((reason: unknown) => {
        if (!active) return
        setDetailError(reason instanceof BookingApiError ? reason.message : "Không thể tải nhân viên khả dụng.")
      }).finally(() => { if (active) setOptionsLoading(false) })
    }, 300)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [selectedId, draft.scheduledAt, draft.durationMinutes])

  const activeEmployees = useMemo(() => options.employees.filter((employee) =>
    employee.branchId === draft.branchId && employee.available), [options.employees, draft.branchId])
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const openBooking = async (id: string) => {
    setSelectedId(id)
    setSelected(null)
    setDetailLoading(true)
    setDetailError("")
    setFeedback("")
    try {
      const booking = await getAdminBooking(id)
      setSelected(booking)
      setDraft({
        scheduledAt: localDateTime(booking.scheduledStart),
        branchId: booking.branchId || "",
        employeeId: booking.employeeId || "",
        durationMinutes: booking.durationMinutes ? String(booking.durationMinutes) : "",
        name: booking.address.name || booking.customerName,
        phone: booking.address.phone || "",
        address: booking.address.address || "",
        region: booking.address.region || "",
        reason: "",
      })
      if (booking.durationMinutes) {
        const availableOptions = await getAdminBookingOptions(id, {
          scheduledAt: booking.scheduledStart,
          durationMinutes: booking.durationMinutes,
        })
        const branchName = availableOptions.branches.find((branch) => branch.id === booking.branchId)?.name
        if (branchName) setSelected({ ...booking, branchName })
        setOptions((current) => ({
          branches: Array.from(new Map([...current.branches, ...availableOptions.branches].map((branch) => [branch.id, branch])).values()),
          employees: availableOptions.employees,
        }))
      }
    } catch (reason) {
      setDetailError(reason instanceof BookingApiError ? reason.message : "Không thể tải chi tiết đơn.")
    } finally {
      setDetailLoading(false)
    }
  }

  const clearFilters = () => {
    setStatus("")
    setDecisionState("")
    setBranchFilter("")
    setFrom("")
    setTo("")
    setReasonFilter("")
    setPage(1)
  }

  const mutate = async (action: AdminBookingMutation["action"]) => {
    if (!selected || busy) return
    const reason = draft.reason.trim()
    if (!reason) { setDetailError("Vui lòng nhập lý do để lưu audit."); return }
    if ((action === "REJECT" || action === "CANCEL") && !window.confirm(action === "REJECT"
      ? "Từ chối đơn dịch vụ? Thao tác sẽ được ghi lịch sử."
      : "Hủy đơn dịch vụ? Thao tác sẽ được ghi lịch sử.")) return
    const mutation: AdminBookingMutation = { action, reason }
    if (action === "UPDATE") {
      mutation.contact = { name: draft.name.trim(), phone: draft.phone.trim(), address: draft.address.trim(), region: draft.region.trim() }
    }
    if (action === "RESCHEDULE" || action === "CONFIRM" || action === "ASSIGN") {
      const scheduled = new Date(draft.scheduledAt)
      if (!Number.isFinite(scheduled.getTime())) { setDetailError("Vui lòng chọn thời gian hợp lệ."); return }
      const duration = Number(draft.durationMinutes)
      if (!Number.isInteger(duration) || duration < 1) { setDetailError("Vui lòng nhập thời lượng hợp lệ."); return }
      mutation.scheduledAt = scheduled.toISOString()
      mutation.durationMinutes = duration
    }
    if (action === "SET_BRANCH" || action === "CONFIRM" || action === "ASSIGN") {
      mutation.branchId = draft.branchId || null
    }
    if (action === "CONFIRM" || action === "ASSIGN") {
      mutation.employeeId = draft.employeeId || null
    }
    setBusy(true)
    setDetailError("")
    try {
      const updated = await mutateAdminBooking(selected.id, mutation)
      setSelected(updated)
      setFeedback("Đã lưu thay đổi và ghi lịch sử xử lý.")
      setDraft((current) => ({ ...current, reason: "", employeeId: updated.employeeId || "" }))
      await load()
    } catch (reason) {
      setDetailError(reason instanceof BookingApiError ? reason.message : "Không thể lưu thay đổi đơn.")
    } finally {
      setBusy(false)
    }
  }

  if (!user || role !== "admin" || user.role !== "admin" || user.status !== "active") return <AdminEmpty title="Vui lòng đăng nhập tài khoản quản trị viên" />
  const authError = error?.status === 401 || error?.status === 403 || error?.status === 503

  return <div className="min-w-0 space-y-6">
    <AdminPageHeader title="Điều hành đơn dịch vụ" description="Booking dịch vụ được lưu trên máy chủ. Đơn mua sản phẩm tiếp tục xử lý riêng tại màn hình Đơn mua sản phẩm." />
    <section aria-label="Lọc đơn dịch vụ" className="min-w-0 rounded-2xl border border-border bg-white p-5 sm:p-6">
      <div className="grid min-w-0 gap-5 sm:grid-cols-2 xl:grid-cols-3">
        <Field label="Trạng thái booking"><select value={status} onChange={(event) => { setStatus(event.target.value as BookingStatus | ""); setPage(1) }}><option value="">Tất cả trạng thái</option>{Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label="Hàng chờ"><select value={decisionState} onChange={(event) => { setDecisionState(event.target.value as BookingDecisionState | ""); setPage(1) }}><option value="">Tất cả</option>{Object.entries(DECISION_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label="Chi nhánh"><select value={branchFilter} onChange={(event) => { setBranchFilter(event.target.value); setPage(1) }}><option value="">Tất cả chi nhánh</option>{options.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></Field>
        <Field label="Lịch từ ngày"><Input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1) }} /></Field>
        <Field label="Đến ngày"><Input type="date" min={from || undefined} value={to} onChange={(event) => { setTo(event.target.value); setPage(1) }} /></Field>
        <Field label="Lý do cần xử lý"><Input value={reasonFilter} maxLength={100} placeholder="Lọc theo nội dung lý do..." onChange={(event) => { setReasonFilter(event.target.value); setPage(1) }} /></Field>
      </div>
      <div className="mt-5 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p role="status" aria-live="polite" className="m-0 text-sm text-muted-foreground"><strong className="text-foreground">{total}</strong> đơn dịch vụ</p>
        <Button type="button" variant="outline" className="w-full sm:w-auto" disabled={!status && !decisionState && !branchFilter && !from && !to && !reasonFilter} onClick={clearFilters}><RotateCcwIcon aria-hidden="true" />Xóa bộ lọc</Button>
      </div>
    </section>

    {error ? <section role="alert" className="rounded-2xl border border-red-200 bg-white p-5"><h2 className="m-0 text-base font-semibold">{authError ? "Chưa xác thực được quyền quản trị API" : "Chưa thể tải đơn dịch vụ"}</h2><p className="my-3 text-sm leading-6 text-muted-foreground">{authError ? `${error.message} Đăng nhập demo trên giao diện chưa tạo JWT backend.` : error.message}</p><Button variant="outline" onClick={() => void load()}>Thử lại</Button></section> : loading ? <AdminLoading /> : bookings.length === 0 ? <AdminEmpty title="Không có đơn dịch vụ phù hợp" description="Đơn ngoại lệ sẽ hiển thị tại đây khi hệ thống cần điều phối hoặc admin xác minh." /> : <>
      <div className="grid min-w-0 gap-4 lg:hidden">{bookings.map((booking) => <BookingSummary key={booking.id} booking={booking} onOpen={() => void openBooking(booking.id)} />)}</div>
      <div className="hidden overflow-hidden rounded-2xl border border-border bg-white lg:block"><div className="overflow-x-auto"><table className="w-full min-w-[980px] border-collapse text-left text-sm">
        <thead className="bg-slate-50 text-xs text-muted-foreground"><tr>{["Mã đơn", "Khách hàng / dịch vụ", "Lịch", "Chi nhánh / nhân viên", "Trạng thái", "Lý do", ""].map((label) => <th key={label} scope="col" className="px-4 py-4 font-medium">{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-border">{bookings.map((booking) => <tr key={booking.id} className="align-top">
          <td className="whitespace-nowrap px-4 py-4 font-semibold">#{booking.id}</td>
          <td className="max-w-56 px-4 py-4"><p className="m-0 font-medium">{booking.customerName}</p><p className="m-0 mt-1 text-xs text-muted-foreground">{booking.serviceName || "Dịch vụ"}</p></td>
          <td className="whitespace-nowrap px-4 py-4">{formatAdminTime(booking.scheduledStart)}</td>
          <td className="px-4 py-4"><p className="m-0">{booking.branchName || "Chưa chọn chi nhánh"}</p><p className="m-0 mt-1 text-xs text-muted-foreground">{booking.employeeName || "Chưa phân công"}</p></td>
          <td className="px-4 py-4"><DecisionBadge booking={booking} /></td>
          <td className="max-w-64 px-4 py-4 text-xs leading-5 text-muted-foreground">{booking.decisionReason || "—"}</td>
          <td className="px-4 py-4"><Button variant="outline" className="min-h-10" onClick={() => void openBooking(booking.id)}>Xem / xử lý</Button></td>
        </tr>)}</tbody>
      </table></div></div>
      <nav aria-label="Phân trang đơn dịch vụ" className="flex flex-wrap items-center justify-between gap-3"><p className="m-0 text-sm text-muted-foreground">Trang {page} / {pages}</p><div className="flex gap-2"><Button variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Trước</Button><Button variant="outline" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>Sau</Button></div></nav>
    </>}

    {selectedId && <section aria-labelledby="booking-detail-heading" className="min-w-0 rounded-2xl border border-border bg-white p-5 sm:p-7">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4"><div><p className="m-0 text-xs font-semibold tracking-[0.12em] text-primary uppercase">Chi tiết booking</p><h2 id="booking-detail-heading" className="m-0 mt-2 text-xl font-semibold">Đơn #{selectedId}</h2></div><Button variant="outline" onClick={() => { setSelectedId(""); setSelected(null); setDetailError("") }}>Đóng chi tiết</Button></div>
      {detailLoading ? <AdminLoading /> : detailError && !selected ? <p role="alert" className="text-sm text-destructive">{detailError}</p> : selected && <div className="grid min-w-0 gap-7 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]">
        <div className="min-w-0 space-y-5">
          <div className="flex flex-wrap items-center gap-3"><DecisionBadge booking={selected} /><span className="text-sm text-muted-foreground">{STATUS_LABEL[selected.status]}</span></div>
          <p className="m-0 break-words text-sm leading-6"><strong>{selected.serviceName || selected.items?.[0]?.serviceName}</strong> · {selected.quantity ?? selected.items?.[0]?.quantity} {selected.items?.[0]?.unit || ""} · {selected.totalAmount.toLocaleString("vi-VN")} ₫</p>
          <p className="m-0 flex items-start gap-2 break-words text-sm leading-6"><MapPinIcon aria-hidden="true" className="mt-1 size-4 shrink-0" />{selected.address.address || "Chưa có địa chỉ"} · {selected.address.region || "Chưa rõ khu vực"}</p>
          {selected.decisionReason && <p className="m-0 rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">{selected.decisionReason}</p>}
          <section aria-label="Lịch sử audit"><h3 className="m-0 mb-3 text-sm font-semibold">Lịch sử quyết định</h3>{selected.history?.length ? <ol className="m-0 space-y-3 pl-5">{selected.history.map((entry, index) => <li key={`${entry.createdAt}-${index}`} className="text-sm leading-6">
            <p className="m-0 font-medium">{entry.action} · {entry.actorType === "SYSTEM" ? "Hệ thống" : `Admin #${entry.actorId}`}</p>
            <p className="m-0 text-muted-foreground">{entry.previousStatus || "—"} → {entry.nextStatus} · {entry.previousDecision || "—"} → {entry.nextDecision}</p>
            <p className="m-0 text-muted-foreground">{formatAdminTime(entry.createdAt)} · {entry.reason}</p>
          </li>)}</ol> : <p className="m-0 text-sm text-muted-foreground">Chưa có lịch sử.</p>}</section>
        </div>
        <div className="min-w-0 space-y-5">
          <h3 className="m-0 text-sm font-semibold">Thông tin cập nhật / phân công</h3>
          <Field label="Thời gian thực hiện"><Input type="datetime-local" value={draft.scheduledAt} onChange={(event) => setDraft((value) => ({ ...value, scheduledAt: event.target.value }))} /></Field>
            <Field label="Chi nhánh"><select value={draft.branchId} onChange={(event) => setDraft((value) => ({ ...value, branchId: event.target.value, employeeId: "" }))}><option value="">Chưa chọn</option>{options.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></Field>
            <Field label="Nhân viên" hint={optionsLoading ? "Đang kiểm tra lịch khả dụng..." : "Danh sách được kiểm tra theo chi nhánh và khung giờ."}><select value={draft.employeeId} onChange={(event) => setDraft((value) => ({ ...value, employeeId: event.target.value }))}><option value="">Chưa phân công</option>{activeEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></Field>
          <Field label="Thời lượng đã xác minh (phút)"><Input type="number" min={1} max={1440} step={1} value={draft.durationMinutes} onChange={(event) => setDraft((value) => ({ ...value, durationMinutes: event.target.value }))} /></Field>
          <div className="grid gap-4 sm:grid-cols-2"><Field label="Người liên hệ"><Input maxLength={120} value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} /></Field><Field label="Điện thoại"><Input maxLength={20} value={draft.phone} onChange={(event) => setDraft((value) => ({ ...value, phone: event.target.value }))} /></Field></div>
          <Field label="Địa chỉ"><Textarea maxLength={500} value={draft.address} onChange={(event) => setDraft((value) => ({ ...value, address: event.target.value }))} /></Field>
          <Field label="Phường/xã hoặc khu vực"><Input maxLength={160} value={draft.region} onChange={(event) => setDraft((value) => ({ ...value, region: event.target.value }))} /></Field>
          <Field label="Lý do thao tác" hint="Bắt buộc; được lưu trong audit history."><Textarea maxLength={1000} value={draft.reason} onChange={(event) => setDraft((value) => ({ ...value, reason: event.target.value }))} /></Field>
          {detailError && <p role="alert" className="m-0 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800">{detailError}</p>}
          {feedback && <p role="status" aria-live="polite" className="m-0 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900">{feedback}</p>}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void mutate("UPDATE")}>Lưu thông tin</Button>
            <Button disabled={busy} variant="outline" onClick={() => void mutate("RESCHEDULE")}>Lưu lịch</Button>
            <Button disabled={busy || !draft.branchId} variant="outline" onClick={() => void mutate("SET_BRANCH")}>Đổi chi nhánh</Button>
            <Button disabled={busy || !draft.employeeId || !draft.branchId} variant="outline" onClick={() => void mutate("CONFIRM")}>Xác nhận và phân công</Button>
            <Button disabled={busy || !draft.employeeId} variant="outline" onClick={() => void mutate("ASSIGN")}><UserRoundIcon aria-hidden="true" />Phân công</Button>
            <Button disabled={busy || selected.status === "CANCELLED" || selected.status === "COMPLETED"} variant="outline" onClick={() => void mutate("REJECT")}>Từ chối</Button>
            <Button disabled={busy || selected.status === "CANCELLED" || selected.status === "COMPLETED"} variant="outline" onClick={() => void mutate("CANCEL")}>Hủy đơn</Button>
          </div>
        </div>
      </div>}
    </section>}
  </div>
}

function DecisionBadge({ booking }: { booking: BookingRecord }) {
  const label = booking.decisionState === "AUTO_CONFIRMED"
    ? DECISION_LABEL.AUTO_CONFIRMED
    : booking.decisionState === "NEEDS_DISPATCH"
      ? DECISION_LABEL.NEEDS_DISPATCH
      : booking.decisionState === "NEEDS_ADMIN"
        ? DECISION_LABEL.NEEDS_ADMIN
        : booking.employeeId
          ? "Đã phân công"
          : DECISION_LABEL[booking.decisionState]
  return <span className={`inline-flex min-h-7 items-center rounded-full px-3 py-1 text-xs font-semibold ${badgeStyle(booking.decisionState)}`}>{label}</span>
}

function BookingSummary({ booking, onOpen }: { booking: BookingRecord; onOpen: () => void }) {
  return <Card className="min-w-0 rounded-2xl shadow-none ring-border [--card-spacing:--spacing(5)]"><CardContent className="flex min-w-0 flex-col gap-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="m-0 font-semibold">Đơn #{booking.id}</p><DecisionBadge booking={booking} /></div>
    <p className="m-0 break-words text-sm font-medium">{booking.customerName} · {booking.serviceName || "Dịch vụ"}</p>
    <p className="m-0 flex items-start gap-2 text-sm leading-6 text-muted-foreground"><CalendarDaysIcon aria-hidden="true" className="mt-1 size-4 shrink-0" />{formatAdminTime(booking.scheduledStart)}</p>
    <p className="m-0 flex items-start gap-2 text-sm leading-6 text-muted-foreground"><MapPinIcon aria-hidden="true" className="mt-1 size-4 shrink-0" />{booking.branchName || "Chưa chọn chi nhánh"} · {booking.employeeName || "Chưa phân công"}</p>
    {booking.decisionReason && <p className="m-0 rounded-xl bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">{booking.decisionReason}</p>}
    <Button variant="outline" className="min-h-11 w-full" onClick={onOpen}>Xem và xử lý</Button>
  </CardContent></Card>
}
