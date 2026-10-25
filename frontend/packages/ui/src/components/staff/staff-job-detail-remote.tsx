"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import { ArrowLeftIcon, CalendarDaysIcon, CheckIcon, ClipboardCheckIcon, MapPinIcon, PhoneIcon } from "lucide-react"
import { AreaLink as Link } from "@/components/shared/area-routes"
import { ToneBadge, OrderStatusBadge } from "@/components/shared/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { useStaffAuth } from "./staff-auth-session"
import { StaffEmpty, StaffLoading, StaffPageHeader } from "./staff-shared"
import { REMOTE_STAFF_STATUS_LABEL, formatStaffJobTime } from "./staff-jobs-remote-model"
import { formatStaffSnapshotPrice, isStaffAssignmentId, parseStaffJobDetailPayload, staffContactPhoneHref, staffJobsReturnHref, type RemoteStaffJobDetail } from "./staff-job-detail-remote-model"
import { StaffJobStatus } from "./staff-job-status"

type StaffAuth = NonNullable<ReturnType<typeof useStaffAuth>>
type DetailResult = { key: string; data: RemoteStaffJobDetail | null; error: string; notFound: boolean; loading: boolean }
class DetailRequestError extends Error {
  constructor(readonly status: number, readonly code: string) { super("Staff job detail request failed") }
}
function detailMessage(error: unknown): string {
  if (!(error instanceof DetailRequestError)) return "Chưa thể tải thông tin công việc. Vui lòng kiểm tra kết nối và thử lại."
  if (error.status === 401) return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại."
  if (error.status === 403) return "Tài khoản hiện không có quyền xem công việc. Vui lòng liên hệ người quản lý."
  if (error.code === "AUTH_UNAVAILABLE") return "Chưa thể kiểm tra phiên đăng nhập. Vui lòng thử lại sau."
  if (error.status === 429) return "Bạn đã gửi nhiều yêu cầu. Vui lòng chờ một lúc rồi thử lại."
  if (error.status === 502) return "Thông tin công việc chưa đọc được. Vui lòng thử lại hoặc liên hệ người quản lý."
  return "Thông tin công việc hiện chưa khả dụng. Vui lòng thử lại sau."
}
async function readDetail(id: string, signal: AbortSignal): Promise<RemoteStaffJobDetail> {
  const response = await fetch(`/api/staff/jobs/${id}`, { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal, headers: { Accept: "application/json" } })
  if ([401, 403, 404].includes(response.status)) throw new DetailRequestError(response.status, response.status === 404 ? "JOB_NOT_FOUND" : "ACCESS_DENIED")
  if (response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") throw new DetailRequestError(502, "STAFF_INVALID_RESPONSE")
  const reader = response.body?.getReader()
  if (!reader) throw new DetailRequestError(502, "STAFF_INVALID_RESPONSE")
  const chunks: Uint8Array[] = []; let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > 2_097_152) { await reader.cancel(); throw new DetailRequestError(502, "STAFF_INVALID_RESPONSE") }
      chunks.push(chunk.value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  let body: unknown
  try { body = JSON.parse(new TextDecoder().decode(bytes)) } catch { throw new DetailRequestError(502, "STAFF_INVALID_RESPONSE") }
  if (!response.ok) {
    const code = body && typeof body === "object" && "error" in body && body.error && typeof body.error === "object" && "code" in body.error && typeof body.error.code === "string" ? body.error.code : "REQUEST_FAILED"
    throw new DetailRequestError(response.status, code)
  }
  const value = parseStaffJobDetailPayload(body, id)
  if (!value) throw new DetailRequestError(502, "STAFF_INVALID_RESPONSE")
  return value
}

function DetailItem({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return <div className={`min-w-0 ${wide ? "sm:col-span-2" : ""}`}><dt className="mb-2 text-xs text-muted-foreground">{label}</dt><dd className="m-0 min-w-0 break-words text-sm leading-7">{children}</dd></div>
}
function BackToJobs({ href }: { href: string }) {
  return <Button variant="outline" className="min-h-11 max-w-full whitespace-normal" render={<Link href={href} />} nativeButton={false}><ArrowLeftIcon aria-hidden="true" />Trở về công việc</Button>
}

export function StaffJobDetailRemote({ id }: { id: string }) {
  const auth = useStaffAuth()
  const params = useSearchParams()
  const returnHref = staffJobsReturnHref(params.getAll("from").length === 1 ? params.get("from") : null)
  if (!isStaffAssignmentId(id)) return <><StaffPageHeader title="Chi tiết công việc" /><StaffEmpty title="Đường dẫn công việc chưa hợp lệ" description="Vui lòng chọn công việc từ danh sách được phân công cho bạn." action={<BackToJobs href={returnHref} />} /></>
  if (!auth || auth.status !== "authenticated" || !auth.session || auth.busy === "logout") return <StaffLoading />
  const identity = `${auth.session.user.id}:${auth.session.expiresAt}:${id}`
  return <StaffJobDetailContent key={identity} identity={identity} id={id} auth={auth} returnHref={returnHref} />
}

function StaffJobDetailContent({ identity, id, auth, returnHref }: { identity: string; id: string; auth: StaffAuth; returnHref: string }) {
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<DetailResult>({ key: "", data: null, error: "", notFound: false, loading: true })
  const generation = useRef(0)
  const alert = useRef<HTMLDivElement>(null)
  const requestKey = `${identity}:${retry}`
  const { checkSession } = auth
  useEffect(() => {
    const version = ++generation.current, controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 15_000)
    setResult({ key: requestKey, data: null, error: "", notFound: false, loading: true })
    void (async () => {
      try {
        const data = await readDetail(id, controller.signal)
        if (controller.signal.aborted || version !== generation.current) return
        setResult({ key: requestKey, data, error: "", notFound: false, loading: false })
      } catch (error) {
        if (version !== generation.current) return
        setResult({ key: requestKey, data: null, error: detailMessage(error), notFound: error instanceof DetailRequestError && error.status === 404, loading: false })
        if (error instanceof DetailRequestError && [401, 403].includes(error.status)) await checkSession()
      } finally { window.clearTimeout(timer) }
    })()
    return () => { ++generation.current; controller.abort(); window.clearTimeout(timer) }
  }, [checkSession, id, requestKey])
  const current = result.key === requestKey ? result : null
  useEffect(() => { if (current?.error) alert.current?.focus() }, [current?.error])
  const job = current?.data

  return <div className="min-w-0 space-y-6">
    <StaffPageHeader title="Chi tiết công việc" description="Thông tin dịch vụ, địa điểm và lịch thực hiện được phân công cho bạn." action={<BackToJobs href={returnHref} />} />
    {!current || current.loading ? <StaffLoading /> : current.error ? <div ref={alert} tabIndex={-1} role="alert" className="min-w-0 rounded-2xl border border-border bg-white px-5 py-10 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"><h2 className="m-0 text-lg font-semibold">{current.notFound ? "Không tìm thấy công việc" : "Chưa thể tải thông tin công việc"}</h2><p className="mt-3 mb-6 text-sm leading-7 text-muted-foreground">{current.notFound ? "Công việc không còn trong danh sách hoặc không được phân công cho bạn." : current.error}</p><div className="flex flex-wrap gap-3"><Button variant="outline" className="min-h-11" onClick={() => setRetry(value => value + 1)}>Thử lại</Button><BackToJobs href={returnHref} /></div></div> : job && <JobDetailView job={job} onChanged={() => setRetry(value => value + 1)} />}
  </div>
}

function JobDetailView({ job, onChanged }: { job: RemoteStaffJobDetail; onChanged: () => void }) {
  const phoneHref = staffContactPhoneHref(job.contact.phone)
  const steps = ["WAITING", "ACCEPTED", "IN_PROGRESS", "DONE"] as const
  const currentStep = steps.findIndex(step => step === job.status)
  const tone = ({ WAITING: "warning", ACCEPTED: "info", IN_PROGRESS: "primary", DONE: "success", CANCELLED: "danger" } as const)[job.status]
  return <div data-assignment-detail-id={job.assignmentId} className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(17rem,0.45fr)]">
    <div className="min-w-0 space-y-6">
      <Card className="min-w-0 rounded-2xl shadow-none ring-border [--card-spacing:--spacing(6)]"><CardHeader><h2 className="m-0 break-all text-lg font-semibold">Phân công #{job.assignmentId}</h2><p className="m-0 mt-2 break-all text-sm text-muted-foreground">Đơn dịch vụ #{job.orderId}</p></CardHeader><CardContent className="space-y-6">
        <dl className="m-0 grid gap-5 sm:grid-cols-2"><DetailItem label="Ngày và giờ thực hiện"><span className="flex items-start gap-2"><CalendarDaysIcon aria-hidden="true" className="mt-1.5 size-4 shrink-0 text-primary" /><span className="min-w-0">{formatStaffJobTime(job.scheduledAt)}</span></span></DetailItem><DetailItem label="Kết thúc dự kiến">{job.expectedEndAt ? formatStaffJobTime(job.expectedEndAt) : "Chưa có thông tin"}</DetailItem><DetailItem label="Thời lượng dự kiến">{job.durationMinutes === null ? "Chưa có thông tin" : `${job.durationMinutes} phút`}</DetailItem><DetailItem label="Múi giờ">Giờ Việt Nam (UTC+07)</DetailItem></dl>
        <section className="min-w-0 border-t border-border pt-6"><h3 className="m-0 mb-4 text-sm font-semibold">Dịch vụ đã đặt</h3>{job.services.length ? <ul className="m-0 grid min-w-0 list-none gap-4 p-0">{job.services.map((service, index) => <li key={`${service.serviceId}:${index}`} className="min-w-0 rounded-xl border border-border bg-slate-50/60 px-4 py-4"><h4 className="m-0 break-words text-base leading-7 font-semibold">{service.name || "Chưa có tên dịch vụ"}</h4><dl className="m-0 mt-3 grid min-w-0 gap-4 sm:grid-cols-2"><DetailItem label="Khối lượng">{service.quantity}{service.unit ? ` ${service.unit}` : ""}</DetailItem><DetailItem label="Đơn giá đã lưu">{formatStaffSnapshotPrice(service.unitPrice)}{service.unit ? ` / ${service.unit}` : ""}</DetailItem></dl></li>)}</ul> : <p className="m-0 text-sm leading-7 text-muted-foreground">Chưa có thông tin dịch vụ.</p>}</section>
      </CardContent></Card>
      <Card className="min-w-0 rounded-2xl shadow-none ring-border [--card-spacing:--spacing(6)]"><CardHeader><h2 className="m-0 text-lg font-semibold">Khách hàng và địa điểm</h2></CardHeader><CardContent><dl className="m-0 grid min-w-0 gap-5 sm:grid-cols-2"><DetailItem label="Người liên hệ">{job.contact.name || "Chưa có thông tin"}</DetailItem><DetailItem label="Số điện thoại">{phoneHref ? <a href={phoneHref} className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-md text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"><PhoneIcon aria-hidden="true" className="size-4 shrink-0" /><span className="min-w-0 break-all">{job.contact.phone}</span></a> : job.contact.phone || "Chưa có thông tin"}</DetailItem><DetailItem label="Địa chỉ thực hiện" wide><span className="flex min-w-0 items-start gap-2"><MapPinIcon aria-hidden="true" className="mt-1.5 size-4 shrink-0 text-primary" /><span className="min-w-0 break-words">{job.contact.address || "Chưa có thông tin"}</span></span></DetailItem></dl></CardContent></Card>
      <Card className="min-w-0 rounded-2xl shadow-none ring-border [--card-spacing:--spacing(6)]"><CardHeader><h2 className="m-0 text-lg font-semibold">Lịch sử đơn dịch vụ</h2></CardHeader><CardContent>{job.orderHistory === null ? <p className="m-0 text-sm leading-7 text-muted-foreground">{job.historySource === "order-service-unavailable" ? "Chưa tải được lịch sử đơn dịch vụ. Vui lòng thử lại sau." : "Lịch sử đơn dịch vụ hiện chưa có để hiển thị."}</p> : job.orderHistory.length === 0 ? <p className="m-0 text-sm leading-7 text-muted-foreground">Chưa có cập nhật trong lịch sử đơn dịch vụ.</p> : <ol className="m-0 list-none p-0">{job.orderHistory.map((entry, index) => <li key={`${entry.at}:${index}`} className="relative flex min-w-0 gap-4 pb-6 last:pb-0"><div aria-hidden="true" className="relative flex w-5 shrink-0 justify-center"><span className="relative z-10 mt-2 size-2.5 rounded-full bg-primary" />{index < job.orderHistory!.length - 1 && <span className="absolute top-5 bottom-[-0.5rem] w-px bg-border" />}</div><div className="min-w-0"><h3 className="m-0 break-words text-sm leading-7 font-semibold">{entry.label}</h3><p className="mt-1 mb-0 break-words text-xs leading-6 text-muted-foreground">{formatStaffJobTime(entry.at)} · {entry.by}</p>{entry.note && <p className="mt-2 mb-0 break-words text-sm leading-7 whitespace-pre-wrap text-muted-foreground">{entry.note}</p>}</div></li>)}</ol>}</CardContent></Card>
    </div>
    <aside aria-label="Trạng thái công việc" className="min-w-0 space-y-6 xl:sticky xl:top-24">
      <StaffJobStatus assignmentId={job.assignmentId} onChanged={onChanged} />
      <Card className="min-w-0 rounded-2xl shadow-sm shadow-slate-900/5 ring-blue-100 [--card-spacing:--spacing(6)]"><CardHeader><div className="flex min-w-0 items-center gap-2.5"><ClipboardCheckIcon aria-hidden="true" className="size-5 shrink-0 text-primary" /><h2 className="m-0 text-lg font-semibold">Tiến trình công việc</h2></div></CardHeader><CardContent className="space-y-5"><div><p className="m-0 mb-2 text-xs text-muted-foreground">Trạng thái phân công</p><ToneBadge tone={tone} className="h-auto max-w-full py-1 whitespace-normal break-words">{REMOTE_STAFF_STATUS_LABEL[job.status]}</ToneBadge></div><ol className="m-0 grid list-none gap-3 p-0" aria-label="Quy trình thực hiện">{steps.map((step, index) => <li key={step} className="flex min-w-0 items-center gap-3 text-sm"><span aria-hidden="true" className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${currentStep >= index ? "bg-blue-50 text-primary" : "bg-slate-100 text-slate-400"}`}>{index < currentStep ? <CheckIcon className="size-3.5" /> : index + 1}</span><span className={index === currentStep ? "min-w-0 font-semibold text-primary" : "min-w-0 text-muted-foreground"}>{REMOTE_STAFF_STATUS_LABEL[step]}</span></li>)}</ol><div className="border-t border-border pt-5"><p className="m-0 mb-2 text-xs text-muted-foreground">Trạng thái đơn dịch vụ</p>{job.orderStatus ? <OrderStatusBadge status={job.orderStatus} /> : <span className="text-sm text-muted-foreground">Chưa có thông tin</span>}</div>{job.cancellationPending === true && <p className="m-0 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-7 text-amber-900">Yêu cầu hủy đang chờ xử lý.</p>}</CardContent></Card>
      <Card className="min-w-0 rounded-2xl shadow-none ring-border [--card-spacing:--spacing(6)]"><CardHeader><h2 className="m-0 text-lg font-semibold">Thời điểm ghi nhận</h2></CardHeader><CardContent><dl className="m-0 grid min-w-0 gap-5"><DetailItem label="Được phân công">{job.assignedAt ? formatStaffJobTime(job.assignedAt) : "Chưa ghi nhận"}</DetailItem><DetailItem label="Bắt đầu thực hiện">{job.checkInAt ? formatStaffJobTime(job.checkInAt) : "Chưa ghi nhận"}</DetailItem><DetailItem label="Kết thúc thực hiện">{job.checkOutAt ? formatStaffJobTime(job.checkOutAt) : "Chưa ghi nhận"}</DetailItem></dl></CardContent></Card>
    </aside>
  </div>
}
