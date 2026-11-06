"use client"

import { useEffect, useState } from "react"
import { ChevronLeftIcon, ChevronRightIcon, MapPinIcon, RefreshCwIcon } from "lucide-react"
import { AreaLink as Link } from "@/components/shared/area-routes"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { StaffEmpty, StaffLoading, StaffPageHeader } from "./staff-shared"
import { StaffBranchMap } from "./staff-branch-map"
import { StaffAvailabilityInteractions } from "./staff-availability-interactions"
import type { StaffMapsConfig } from "./staff-maps-model"
import {
  addDays, formatStaffDay, parseStaffAvailability, parseStaffBranch, serviceAreaLabels,
  vietnamToday, weekRange,
  type StaffAvailabilityPayload, type StaffAreasWeek, type StaffBranch,
} from "./staff-areas-remote-model"

class AreasRequestError extends Error {
  constructor(readonly status: number, readonly code: string) { super("Staff areas request failed") }
}

function requestMessage(reason: unknown): string {
  if (!(reason instanceof AreasRequestError)) return "Chưa thể tải khu vực và ca làm. Vui lòng kiểm tra kết nối và thử lại."
  if (reason.status === 401) return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại để xem khu vực và ca làm."
  if (reason.code === "STAFF_SESSION_CHANGED") return "Tài khoản đăng nhập đã thay đổi. Vui lòng tải lại trang."
  if (reason.status === 403) return "Tài khoản hiện không có quyền xem khu vực và ca làm. Vui lòng liên hệ người quản lý."
  if (reason.status === 404) return "Hồ sơ nhân viên chưa được gán chi nhánh. Vui lòng liên hệ người quản lý."
  if (reason.status === 429) return "Bạn đã gửi nhiều yêu cầu. Vui lòng chờ một lúc rồi thử lại."
  if (reason.status === 502 || reason.code === "STAFF_INVALID_RESPONSE") return "Dữ liệu khu vực và ca làm chưa đọc được. Vui lòng thử lại hoặc liên hệ người quản lý."
  return "Khu vực và ca làm hiện chưa khả dụng. Vui lòng thử lại sau."
}

async function readJson(response: Response): Promise<unknown> {
  if (response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    throw new AreasRequestError(502, "STAFF_INVALID_RESPONSE")
  }
  const reader = response.body?.getReader()
  if (!reader) throw new AreasRequestError(502, "STAFF_INVALID_RESPONSE")
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > 1_048_576) { await reader.cancel(); throw new AreasRequestError(502, "STAFF_INVALID_RESPONSE") }
      chunks.push(chunk.value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  let body: unknown
  try { body = JSON.parse(new TextDecoder().decode(bytes)) } catch { throw new AreasRequestError(502, "STAFF_INVALID_RESPONSE") }
  if (!response.ok) {
    const error = body && typeof body === "object" && "error" in body ? (body as { error?: unknown }).error : null
    const code = error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code : "REQUEST_FAILED"
    throw new AreasRequestError(response.status, code)
  }
  return body
}

function get(path: string, accountId: string, signal: AbortSignal): Promise<unknown> {
  return fetch(path, {
    method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal,
    headers: { Accept: "application/json", "X-Staff-Account-Id": accountId },
  }).then(readJson)
}

export function StaffAreasRemote({ accountId, mapsConfig = null }: { accountId: string; mapsConfig?: StaffMapsConfig | null }) {
  const [week, setWeek] = useState<StaffAreasWeek>(() => weekRange(vietnamToday()))
  const [branch, setBranch] = useState<StaffBranch | null>(null)
  const [availability, setAvailability] = useState<StaffAvailabilityPayload | null>(null)
  const [branchLoading, setBranchLoading] = useState(true)
  const [availabilityLoading, setAvailabilityLoading] = useState(true)
  const [branchError, setBranchError] = useState("")
  const [availabilityError, setAvailabilityError] = useState("")
  const [retry, setRetry] = useState(0)
  const [availabilityRetry, setAvailabilityRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), 15000)
    setBranchLoading(true); setBranchError(""); setBranch(null)
    void get("/api/staff/branch", accountId, controller.signal).then(value => {
        const parsed = parseStaffBranch(value)
        if (!parsed) throw new AreasRequestError(502, "STAFF_INVALID_RESPONSE")
        if (!controller.signal.aborted) setBranch(parsed.data)
      })
      .catch(reason => { if (!controller.signal.aborted || controller.signal.reason?.name === "TimeoutError") setBranchError(requestMessage(reason)) })
      .finally(() => { window.clearTimeout(timer); if (!controller.signal.aborted || controller.signal.reason?.name === "TimeoutError") setBranchLoading(false) })
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [accountId, retry])

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), 15000)
    setAvailabilityLoading(true); setAvailabilityError(""); setAvailability(null)
    void get(`/api/staff/availability?from=${week.from}&to=${week.to}`, accountId, controller.signal).then(value => {
        const parsed = parseStaffAvailability(value, week)
        if (!parsed) throw new AreasRequestError(502, "STAFF_INVALID_RESPONSE")
        if (!controller.signal.aborted) setAvailability(parsed)
      })
      .catch(reason => { if (!controller.signal.aborted || controller.signal.reason?.name === "TimeoutError") setAvailabilityError(requestMessage(reason)) })
      .finally(() => { window.clearTimeout(timer); if (!controller.signal.aborted || controller.signal.reason?.name === "TimeoutError") setAvailabilityLoading(false) })
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [accountId, week, retry, availabilityRetry])

  const labels = serviceAreaLabels(branch?.serviceArea)
  const windows = availability?.data || []
  const move = (amount: number) => setWeek(current => weekRange(addDays(current.from, amount)))

  const loading = branchLoading || availabilityLoading
  const error = branchError || availabilityError
  const branchStatus = branch?.status === "ACTIVE" ? "Đang hoạt động" : branch?.status === "INACTIVE" ? "Tạm ngưng" : null
  const qaBranch = branch && /\bQA\b|tổng hợp|synthetic/i.test([branch.name, branch.addressText].filter(Boolean).join(" "))
  return <div className="staff-areas min-w-0 space-y-6" data-staff-areas-remote={loading ? "loading" : error ? "error" : "ready"}>
    <StaffPageHeader title="Khu vực & ca làm" description="Chi nhánh phục vụ và lịch khả dụng của bạn." />
    {error && <div role="alert" className="staff-areas-error">
      <p>{error}</p>
      <Button variant="outline" onClick={() => setRetry(value => value + 1)}><RefreshCwIcon aria-hidden="true" />Thử lại</Button>
    </div>}
    {branchLoading && !branch
      ? <StaffLoading />
      : !branch
        ? (!error && <StaffEmpty title="Chưa có dữ liệu khu vực" description="Chưa đọc được chi nhánh được gán cho hồ sơ nhân viên." />)
        : <>
          <Card className="staff-area-card" data-staff-branch-id={branch.id}>
            <CardContent>
              <div className="staff-area-card-top">
                <div className="staff-branch-heading"><span className="staff-area-icon"><MapPinIcon aria-hidden="true" /></span><div><p className="staff-branch-eyebrow">Chi nhánh của bạn</p><h2>{branch.name || "Chi nhánh"}</h2></div></div>
                <div className="staff-branch-badges">{qaBranch && <span className="staff-branch-qa">QA · Dữ liệu tổng hợp</span>}{branchStatus && <span className="staff-area-state" data-state={branch.status}>{branchStatus}</span>}</div>
              </div>
              {branch.addressText && <p className="staff-branch-address">{branch.addressText}</p>}
              <h3>Khu vực phục vụ</h3>
              {labels.length
                ? <ul className="staff-areas-service-area" aria-label="Khu vực phục vụ">{labels.map(label => <li key={label}>{label}</li>)}</ul>
                : <p className="staff-areas-muted" data-staff-service-area="unstructured">Chưa có khu vực phục vụ chi tiết.</p>}
            </CardContent>
          </Card>

          <StaffBranchMap key={branch.id} config={mapsConfig} latitude={branch.latitude} longitude={branch.longitude} serviceArea={branch.serviceArea} branchName={branch.name} branchAddress={branch.addressText} />
          <section className="staff-areas-calendar" aria-labelledby="staff-areas-availability-heading">
            <div className="staff-areas-section-title">
              <div>
                <h2 id="staff-areas-availability-heading">Lịch khả dụng</h2>
                <p>Giờ Việt Nam (UTC+7).</p>
              </div>
              <span data-staff-availability-count={windows.length}>{windows.length} khung giờ trong tuần</span>
            </div>
            <div className="staff-areas-calendar-toolbar">
              <div className="staff-areas-period-controls">
                <Button variant="outline" aria-label="Tuần trước" onClick={() => move(-7)}><ChevronLeftIcon aria-hidden="true" /></Button>
                <span className="staff-areas-range">{formatStaffDay(week.from)} – {formatStaffDay(week.to)}</span>
                <Button variant="outline" aria-label="Tuần sau" onClick={() => move(7)}><ChevronRightIcon aria-hidden="true" /></Button>
                <Button variant="outline" onClick={() => setWeek(weekRange(vietnamToday()))}>Tuần này</Button>
              </div>
            </div>
            {availability?.truncated && <p role="status" className="staff-areas-feedback">Tuần này có hơn 500 khung giờ; chỉ hiển thị 500 khung giờ đầu tiên.</p>}
            {availabilityLoading ? <StaffLoading /> : availabilityError ? <div role="status"><p>Lịch khả dụng chưa đọc được. Bản đồ vẫn hiển thị dữ liệu chi nhánh đã tải.</p><Button variant="outline" onClick={() => setAvailabilityRetry(value => value + 1)}>Tải lại lịch khả dụng</Button></div>
              : availability && <StaffAvailabilityInteractions key={`${accountId}:${week.from}`} accountId={accountId} items={windows} week={week} branch={branch} truncated={availability.truncated} />}
          </section>
          <p className="staff-areas-muted">Cần xem lịch hẹn được phân công thật? <Link href="/lich-lam-viec">Mở Lịch làm việc</Link>.</p>
        </>}
  </div>
}
