"use client"

import { useCallback, useEffect, useState } from "react"
import { AreaLink as Link } from "@/components/shared/area-routes"
import { ArrowLeftIcon, CheckIcon, MapPinIcon, PhoneIcon, RotateCcwIcon, UserRoundIcon, XIcon } from "lucide-react"
import { Field, money, useData } from "../../common"
import { Button } from "../ui/button"
import { Card, CardContent } from "../ui/card"
import { Input } from "../ui/input"
import { AdminDialog } from "./admin-dialog"
import { AdminEmpty, AdminLoading, AdminPageHeader, formatAdminTime } from "./admin-shared"
import {
  getProductOrder,
  listProductOrders,
  ProductOrderApiError,
  updateProductOrderStatus,
  type ProductOrder,
  type ProductOrderStatus,
} from "./admin-product-orders-api"

const PAGE_SIZE = 10
const STATUS_LABEL: Record<ProductOrderStatus, string> = {
  PENDING: "Chờ xử lý",
  COMPLETED: "Đã giao",
  CANCELLED: "Đã hủy",
}
const STATUS_STYLE: Record<ProductOrderStatus, string> = {
  PENDING: "bg-amber-50 text-amber-800",
  COMPLETED: "bg-emerald-50 text-emerald-800",
  CANCELLED: "bg-slate-100 text-slate-700",
}

function ProductOrderStatusBadge({ status }: { status: ProductOrderStatus }) {
  return <span className={`inline-flex min-h-7 items-center rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>
}

function ErrorState({ error, retry }: { error: ProductOrderApiError; retry: () => void }) {
  const authError = error.status === 401 || error.status === 403 || error.status === 503
  return <section role="alert" className="flex min-w-0 flex-col gap-3 rounded-2xl border border-red-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
    <div className="min-w-0">
      <h2 className="m-0 text-base font-semibold">{authError ? "Chưa xác thực được quyền quản trị API" : "Chưa thể tải đơn mua"}</h2>
      <p className="m-0 mt-2 break-words text-sm leading-6 text-muted-foreground">
        {authError ? `${error.message} Đăng nhập demo trên giao diện chưa tạo phiên backend; cần phiên JWT hợp lệ do dịch vụ xác thực cấp.` : error.message}
      </p>
    </div>
    <Button variant="outline" className="min-h-11 shrink-0" onClick={retry}><RotateCcwIcon aria-hidden="true" />Thử lại</Button>
  </section>
}

export function AdminProductOrders({ id }: { id?: string }) {
  const { s, user, role } = useData()
  if (!s) return <AdminLoading />
  if (!user || role !== "admin" || user.role !== "admin" || user.status !== "active") {
    return <AdminEmpty title="Vui lòng đăng nhập tài khoản quản trị viên" />
  }
  return id ? <ProductOrderDetail key={id} id={id} /> : <ProductOrderList />
}

function ProductOrderList() {
  const [orders, setOrders] = useState<ProductOrder[]>([])
  const [total, setTotal] = useState(0)
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("")
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ProductOrderApiError | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await listProductOrders({ search: query.trim(), status, page, pageSize: PAGE_SIZE })
      setOrders(result.items)
      setTotal(result.total)
    } catch (reason) {
      setError(reason instanceof ProductOrderApiError ? reason : new ProductOrderApiError("Đã xảy ra lỗi khi tải đơn mua.", 500, "REQUEST_FAILED"))
    } finally {
      setLoading(false)
    }
  }, [page, query, status])

  useEffect(() => { void load() }, [load])

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasFilters = Boolean(query || status)
  const clearFilters = () => { setQuery(""); setStatus(""); setPage(1) }

  return <div className="min-w-0 space-y-6">
    <AdminPageHeader title="Điều hành đơn mua sản phẩm" description="Theo dõi đơn tự mua sản phẩm, thông tin giao hàng và trạng thái xử lý riêng với đơn dịch vụ." />

    <section aria-label="Tìm và lọc đơn mua sản phẩm" className="min-w-0 rounded-2xl border border-border bg-white p-5 sm:p-6">
      <div className="grid min-w-0 gap-5 sm:grid-cols-2">
        <Field label="Tìm kiếm đơn"><Input type="search" maxLength={100} value={query} placeholder="Mã đơn, khách hàng, số điện thoại..." onChange={(event) => { setQuery(event.target.value); setPage(1) }} /></Field>
        <Field label="Trạng thái đơn"><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}><option value="">Tất cả trạng thái</option>{Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
      </div>
      <div className="mt-5 flex flex-col gap-4 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p role="status" aria-live="polite" className="m-0 text-sm text-muted-foreground"><span className="font-semibold text-foreground">{total}</span> đơn mua{hasFilters ? " phù hợp" : " hiện có"}</p>
        <Button variant="outline" className="min-h-11 w-full sm:w-auto" disabled={!hasFilters} onClick={clearFilters}><RotateCcwIcon aria-hidden="true" />Xóa bộ lọc</Button>
      </div>
    </section>

    {error ? <ErrorState error={error} retry={() => { void load() }} /> : loading ? <AdminLoading /> : orders.length === 0
      ? <AdminEmpty title={total ? "Không tìm thấy đơn mua phù hợp" : "Chưa có đơn mua sản phẩm"} description={total ? "Thử từ khóa khác hoặc thay đổi bộ lọc trạng thái." : "Đơn mua sản phẩm sẽ xuất hiện tại đây khi khách hàng đặt hàng."} action={hasFilters ? <Button variant="outline" className="min-h-11" onClick={clearFilters}>Xóa bộ lọc</Button> : undefined} />
      : <>
        <div className="grid min-w-0 gap-4 lg:hidden">
          {orders.map((order) => <Card key={order.id} className="min-w-0 rounded-2xl shadow-none ring-border [--card-spacing:--spacing(5)]"><CardContent className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><p className="m-0 font-semibold">Đơn #{order.id}</p><ProductOrderStatusBadge status={order.status} /></div>
            <p className="m-0 break-words text-sm font-medium">{order.customerName} · {money(order.totalAmount)}</p>
            <p className="m-0 text-sm leading-6 text-muted-foreground">{order.itemCount} sản phẩm · Tạo {formatAdminTime(order.createdAt)}</p>
            <p className="m-0 break-words text-sm leading-6">{order.recipientName} · {order.recipientPhone}<br />{order.deliveryAddress}</p>
            <Button render={<Link href={`/don-mua/${encodeURIComponent(order.id)}`} />} nativeButton={false} variant="outline" className="min-h-11 w-full">Xem chi tiết</Button>
          </CardContent></Card>)}
        </div>

        <div className="hidden overflow-hidden rounded-2xl border border-border bg-white lg:block">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs text-muted-foreground"><tr>{["Mã đơn", "Khách hàng", "Người nhận / giao hàng", "Tổng tiền", "Trạng thái", "Ngày tạo", ""].map((label) => <th key={label} scope="col" className="px-4 py-4 font-medium">{label}</th>)}</tr></thead>
              <tbody className="divide-y divide-border">{orders.map((order) => <tr key={order.id} className="align-top">
                <td className="whitespace-nowrap px-4 py-4 font-semibold">#{order.id}</td>
                <td className="px-4 py-4">{order.customerName}</td>
                <td className="max-w-72 px-4 py-4"><p className="m-0 font-medium">{order.recipientName} · {order.recipientPhone}</p><p className="m-0 mt-1 break-words text-xs leading-5 text-muted-foreground">{order.deliveryAddress}</p></td>
                <td className="whitespace-nowrap px-4 py-4 font-semibold">{money(order.totalAmount)}</td>
                <td className="px-4 py-4"><ProductOrderStatusBadge status={order.status} /></td>
                <td className="whitespace-nowrap px-4 py-4 text-muted-foreground">{formatAdminTime(order.createdAt)}</td>
                <td className="px-4 py-4"><Button render={<Link href={`/don-mua/${encodeURIComponent(order.id)}`} />} nativeButton={false} variant="outline" className="min-h-10">Chi tiết</Button></td>
              </tr>)}</tbody>
            </table>
          </div>
        </div>

        {pages > 1 && <nav aria-label="Phân trang đơn mua" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="m-0 text-sm text-muted-foreground">Trang {page} / {pages}</p>
          <div className="flex gap-2"><Button variant="outline" className="min-h-11" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Trước</Button><Button variant="outline" className="min-h-11" disabled={page >= pages} onClick={() => setPage((current) => current + 1)}>Sau</Button></div>
        </nav>}
      </>}
  </div>
}

function ProductOrderDetail({ id }: { id: string }) {
  const [order, setOrder] = useState<ProductOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ProductOrderApiError | null>(null)
  const [nextStatus, setNextStatus] = useState<"COMPLETED" | "CANCELLED" | null>(null)
  const [saving, setSaving] = useState(false)
  const [mutationError, setMutationError] = useState("")
  const [feedback, setFeedback] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setOrder(await getProductOrder(id))
    } catch (reason) {
      setError(reason instanceof ProductOrderApiError ? reason : new ProductOrderApiError("Đã xảy ra lỗi khi tải đơn mua.", 500, "REQUEST_FAILED"))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { void load() }, [load])

  async function submitStatus() {
    if (!nextStatus || saving) return
    setSaving(true)
    setMutationError("")
    setFeedback("")
    try {
      const saved = await updateProductOrderStatus(id, nextStatus)
      setOrder(saved)
      setNextStatus(null)
      setFeedback(nextStatus === "COMPLETED" ? "Đã cập nhật đơn thành đã giao và trừ tồn kho." : "Đã hủy đơn và giải phóng số lượng tồn kho đã giữ.")
    } catch (reason) {
      setMutationError(reason instanceof ProductOrderApiError ? reason.message : "Không thể cập nhật đơn mua. Vui lòng thử lại.")
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <AdminLoading />
  if (error) return <div className="space-y-5"><Button render={<Link href="/don-mua" />} nativeButton={false} variant="outline" className="min-h-11"><ArrowLeftIcon aria-hidden="true" />Danh sách đơn mua</Button><ErrorState error={error} retry={() => { void load() }} /></div>
  if (!order) return <AdminEmpty title="Không tìm thấy đơn mua" description="Đơn có thể đã bị xóa hoặc mã đơn không hợp lệ." action={<Button render={<Link href="/don-mua" />} nativeButton={false} variant="outline" className="min-h-11">Trở về danh sách</Button>} />

  return <div className="min-w-0 space-y-6">
    <Button render={<Link href="/don-mua" />} nativeButton={false} variant="outline" className="min-h-11"><ArrowLeftIcon aria-hidden="true" />Danh sách đơn mua</Button>
    <AdminPageHeader
      title={`Đơn mua #${order.id}`}
      description={`Tạo lúc ${formatAdminTime(order.createdAt)} · Cập nhật ${formatAdminTime(order.updatedAt)}`}
      action={order.status === "PENDING" ? <>
        <Button className="min-h-11 w-full sm:w-auto" onClick={() => { setMutationError(""); setNextStatus("COMPLETED") }}><CheckIcon aria-hidden="true" />Xác nhận đã giao</Button>
        <Button variant="outline" className="min-h-11 w-full text-destructive hover:text-destructive sm:w-auto" onClick={() => { setMutationError(""); setNextStatus("CANCELLED") }}><XIcon aria-hidden="true" />Hủy đơn</Button>
      </> : undefined}
    />

    {feedback && <p role="status" className="m-0 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900">{feedback}</p>}
    {mutationError && <p role="alert" className="m-0 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800">{mutationError}</p>}

    <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)]">
      <Card className="min-w-0 rounded-2xl shadow-none ring-border [--card-spacing:--spacing(5)] sm:[--card-spacing:--spacing(6)]">
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="m-0 text-lg font-semibold">Sản phẩm đã mua</h2><ProductOrderStatusBadge status={order.status} /></div>
          <div className="divide-y divide-border">
            {order.items.map((item) => <div key={item.id} className="flex min-w-0 flex-col gap-2 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0"><p className="m-0 break-words font-medium">{item.name}</p><p className="m-0 mt-1 text-sm text-muted-foreground">{money(item.unitPrice)} / {item.unit} · Số lượng {item.quantity}</p></div>
              <p className="m-0 shrink-0 font-semibold">{money(item.lineTotal)}</p>
            </div>)}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border pt-4"><span className="font-medium">Tổng tiền</span><strong className="text-lg">{money(order.totalAmount)}</strong></div>
        </CardContent>
      </Card>

      <div className="min-w-0 space-y-5">
        <Card className="min-w-0 rounded-2xl shadow-none ring-border [--card-spacing:--spacing(5)]"><CardContent className="space-y-4">
          <h2 className="m-0 text-lg font-semibold">Thông tin giao hàng</h2>
          <p className="m-0 flex min-w-0 items-start gap-3 text-sm leading-6"><UserRoundIcon aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground" /><span className="break-words">{order.recipientName}</span></p>
          <p className="m-0 flex min-w-0 items-start gap-3 text-sm leading-6"><PhoneIcon aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground" /><span className="break-words">{order.recipientPhone}</span></p>
          <p className="m-0 flex min-w-0 items-start gap-3 text-sm leading-6"><MapPinIcon aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground" /><span className="break-words">{order.deliveryAddress}</span></p>
          {order.note && <p className="m-0 border-t border-border pt-4 text-sm leading-6"><span className="font-medium">Ghi chú:</span> {order.note}</p>}
        </CardContent></Card>
        <Card className="min-w-0 rounded-2xl shadow-none ring-border [--card-spacing:--spacing(5)]"><CardContent className="space-y-3">
          <h2 className="m-0 text-lg font-semibold">Thông tin khách hàng</h2>
          <p className="m-0 text-sm leading-6"><span className="text-muted-foreground">Tên:</span> {order.customerName}</p>
          <p className="m-0 text-sm leading-6"><span className="text-muted-foreground">Mã khách hàng:</span> {order.customerId}</p>
        </CardContent></Card>
      </div>
    </div>

    {nextStatus && <AdminDialog
      title={nextStatus === "COMPLETED" ? "Xác nhận đã giao đơn?" : "Hủy đơn mua sản phẩm?"}
      busy={saving}
      error={mutationError}
      isBusy={() => saving}
      close={() => { if (!saving) setNextStatus(null) }}
      submit={(event) => { event.preventDefault(); void submitStatus() }}
      submitLabel={nextStatus === "COMPLETED" ? "Xác nhận đã giao" : "Xác nhận hủy đơn"}
    >
      <p className="m-0 text-sm leading-7 text-muted-foreground">
        {nextStatus === "COMPLETED"
          ? "Chỉ xác nhận sau khi khách đã nhận hàng. Tồn thực tế và số lượng đã giữ sẽ cùng được trừ."
          : "Đơn đang chờ xử lý sẽ được hủy và số lượng tồn kho đã giữ sẽ được giải phóng."}
      </p>
      <p className="m-0 text-sm font-medium">Đơn #{order.id} · {money(order.totalAmount)}</p>
    </AdminDialog>}
  </div>
}
