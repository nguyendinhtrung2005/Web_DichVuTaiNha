"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import { ArrowLeftIcon, CalendarDaysIcon, ClipboardCheckIcon, InfoIcon, MapPinIcon, PhoneIcon } from "lucide-react"
import { AreaLink as Link } from "@/components/shared/area-routes"
import { ToneBadge, OrderStatusBadge } from "@/components/shared/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { useStaffAuth } from "./staff-auth-session"
import { StaffEmpty, StaffLoading, StaffPageHeader } from "./staff-shared"
import { REMOTE_STAFF_STATUS_LABEL, formatStaffJobTime } from "./staff-jobs-remote-model"
import { formatStaffSnapshotPrice, isStaffAssignmentId, parseStaffJobDetailPayload, staffContactPhoneHref, staffJobsReturnHref, type RemoteStaffJobDetail } from "./staff-job-detail-remote-model"
import { StaffJobStatus } from "./staff-job-status"
import { StaffJobTeam } from "./staff-job-team"
import { staffTeamMutationBlockedReason } from "./staff-team-model"

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
  return <div className={`staff-detail-item min-w-0 ${wide ? "sm:col-span-2" : ""}`}><dt className="mb-2 text-xs text-muted-foreground">{label}</dt><dd className="m-0 min-w-0 break-words text-sm leading-7">{children}</dd></div>
}
function BackToJobs({ href }: { href: string }) {
  return <Button variant="outline" className="staff-detail-back min-h-11 max-w-full whitespace-normal" render={<Link href={href} />} nativeButton={false}><ArrowLeftIcon aria-hidden="true" />Trở về công việc</Button>
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

  return <div className="staff-detail min-w-0 space-y-6">
    <StaffPageHeader title="Chi tiết công việc" description="Thông tin dịch vụ, địa điểm và lịch thực hiện được phân công cho bạn." action={<BackToJobs href={returnHref} />} />
    {!current || current.loading ? <StaffLoading /> : current.error ? <div ref={alert} tabIndex={-1} role="alert" className="staff-detail-error min-w-0 rounded-2xl border border-border bg-white px-5 py-10 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"><h2 className="m-0 text-lg font-semibold">{current.notFound ? "Không tìm thấy công việc" : "Chưa thể tải thông tin công việc"}</h2><p className="mt-3 mb-6 text-sm leading-7 text-muted-foreground">{current.notFound ? "Công việc không còn trong danh sách hoặc không được phân công cho bạn." : current.error}</p><div className="flex flex-wrap gap-3"><Button variant="outline" className="min-h-11" onClick={() => setRetry(value => value + 1)}>Thử lại</Button><BackToJobs href={returnHref} /></div></div> : job && <JobDetailView job={job} onChanged={() => setRetry(value => value + 1)} />}
  </div>
}

function JobDetailView({ job, onChanged }: { job: RemoteStaffJobDetail; onChanged: () => void }) {
  const phoneHref = staffContactPhoneHref(job.contact.phone)
  const tone = ({ WAITING: "warning", ACCEPTED: "info", IN_PROGRESS: "primary", DONE: "success", CANCELLED: "danger" } as const)[job.status]
  return <div data-assignment-detail-id={job.assignmentId} className="staff-detail-view">
    <section className="staff-detail-summary" aria-label="Tóm tắt phân công"><div><p className="staff-eyebrow">Công việc được phân công</p><h2>Phân công #{job.assignmentId}</h2><p className="staff-detail-order-reference">Đơn dịch vụ #{job.orderId}</p></div><ToneBadge tone={tone}>{REMOTE_STAFF_STATUS_LABEL[job.status]}</ToneBadge></section>
    <StaffJobTeam team={job.team} teamError={job.teamError} personalStatus={job.status} bookingStatus={job.orderStatus} bookingId={job.orderId} services={job.services.map(service => service.name)} onRetry={onChanged} />
    <section className="staff-detail-status-area" aria-label="Trạng thái công việc"><StaffJobStatus assignmentId={job.assignmentId} onChanged={onChanged} teamStartBlockedReason={staffTeamMutationBlockedReason(job.team, "IN_PROGRESS")} teamCompletionBlockedReason={staffTeamMutationBlockedReason(job.team, "DONE")} /></section>
    <div className="staff-detail-main">
      <Card className="staff-detail-card"><CardHeader><div className="staff-detail-section-heading"><CalendarDaysIcon aria-hidden="true" /><h2>Lịch hẹn và dịch vụ</h2></div><p className="staff-detail-section-description">Thời gian hiển thị theo giờ Việt Nam (UTC+7).</p></CardHeader><CardContent>
        <dl className="staff-detail-facts"><DetailItem label="Ngày và giờ thực hiện"><time dateTime={job.scheduledAt || undefined} className="staff-detail-time">{formatStaffJobTime(job.scheduledAt)}</time></DetailItem><DetailItem label="Kết thúc dự kiến">{job.expectedEndAt ? <time dateTime={job.expectedEndAt}>{formatStaffJobTime(job.expectedEndAt)}</time> : "Chưa có thông tin"}</DetailItem><DetailItem label="Thời lượng dự kiến">{job.durationMinutes === null ? "Chưa có thông tin" : job.durationMinutes + " phút"}</DetailItem></dl>
        <section className="staff-detail-services-section"><h3>Dịch vụ đã đặt</h3>{job.services.length ? <ul className="staff-detail-services">{job.services.map((service, index) => <li key={service.serviceId + ":" + index}><h4>{service.name || "Chưa có tên dịch vụ"}</h4><dl className="staff-detail-facts"><DetailItem label="Khối lượng">{service.quantity}{service.unit ? " " + service.unit : ""}</DetailItem><DetailItem label="Đơn giá đã lưu">{formatStaffSnapshotPrice(service.unitPrice)}{service.unit ? " / " + service.unit : ""}</DetailItem></dl></li>)}</ul> : <p className="staff-detail-muted">Chưa có thông tin dịch vụ.</p>}</section>
      </CardContent></Card>
      <Card className="staff-detail-card"><CardHeader><div className="staff-detail-section-heading"><MapPinIcon aria-hidden="true" /><h2>Khách hàng và địa điểm</h2></div></CardHeader><CardContent><dl className="staff-detail-facts"><DetailItem label="Người liên hệ">{job.contact.name || "Chưa có thông tin"}</DetailItem><DetailItem label="Số điện thoại">{phoneHref ? <a href={phoneHref} className="staff-detail-phone"><PhoneIcon aria-hidden="true" /><span>{job.contact.phone}</span></a> : job.contact.phone || "Chưa có thông tin"}</DetailItem><DetailItem label="Địa chỉ thực hiện" wide><span className="staff-detail-address">{job.contact.address || "Chưa có thông tin"}</span></DetailItem></dl></CardContent></Card>
      <Card className="staff-detail-card"><CardHeader><h2>Yêu cầu và ghi chú</h2></CardHeader><CardContent><p className="staff-detail-note">{job.specialRequest ?? "Chưa có thông tin ghi chú để hiển thị."}</p></CardContent></Card>
      <Card className="staff-detail-card"><CardHeader><h2>Lịch sử đơn dịch vụ</h2></CardHeader><CardContent>
        {job.orderHistory === null ? <div className="staff-detail-history-notice"><InfoIcon aria-hidden="true" /><p>{job.historySource === "order-service-unavailable" ? "Chưa tải được lịch sử đơn dịch vụ. Vui lòng thử lại sau." : "Lịch sử đơn dịch vụ hiện chưa có để hiển thị."}</p></div> : job.orderHistory.length === 0 ? <p className="staff-detail-muted">Chưa có cập nhật trong lịch sử đơn dịch vụ.</p> : <ol className="staff-detail-history">{job.orderHistory.map((entry, index) => <li key={entry.at + ":" + index}><span className="staff-detail-history-dot" aria-hidden="true" /><div><h3>{entry.label}</h3><p>{formatStaffJobTime(entry.at)} · {entry.by}</p>{entry.note && <p className="staff-detail-history-note">{entry.note}</p>}</div></li>)}</ol>}
      </CardContent></Card>
    </div>
    <aside className="staff-detail-metadata" aria-label="Thông tin đơn và thời điểm ghi nhận">
      <Card className="staff-detail-card"><CardHeader><div className="staff-detail-section-heading"><ClipboardCheckIcon aria-hidden="true" /><h2>Đơn dịch vụ</h2></div></CardHeader><CardContent><p className="staff-detail-field-label">Trạng thái đơn dịch vụ</p>{job.orderStatus ? <OrderStatusBadge status={job.orderStatus} /> : <p className="staff-detail-muted">Chưa có thông tin</p>}{job.cancellationPending === true && <p className="staff-detail-cancellation">Yêu cầu hủy đang chờ xử lý.</p>}</CardContent></Card>
      <Card className="staff-detail-card"><CardHeader><h2>Thời điểm ghi nhận</h2></CardHeader><CardContent><dl className="staff-detail-facts staff-detail-facts-single"><DetailItem label="Được phân công">{job.assignedAt ? formatStaffJobTime(job.assignedAt) : "Chưa ghi nhận"}</DetailItem><DetailItem label="Bắt đầu thực hiện">{job.checkInAt ? formatStaffJobTime(job.checkInAt) : "Chưa ghi nhận"}</DetailItem><DetailItem label="Kết thúc thực hiện">{job.checkOutAt ? formatStaffJobTime(job.checkOutAt) : "Chưa ghi nhận"}</DetailItem></dl></CardContent></Card>
    </aside>
  </div>
}
