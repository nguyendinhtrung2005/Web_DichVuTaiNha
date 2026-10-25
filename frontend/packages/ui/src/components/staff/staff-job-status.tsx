"use client"

import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from "react"
import { LoaderCircleIcon, RefreshCwIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { useStaffAuth } from "./staff-auth-session"
import { STAFF_STATUS_ACTION, parseStaffStatusMutationPayload, parseStaffStatusOperation, parseStaffStatusPayload, staffStatusErrorMessage, type StaffNextStatus, type StaffStatusOperation, type StaffStatusState } from "./staff-job-status-model"

const labels = { ASSIGNED: "Chờ tiếp nhận", ACCEPTED: "Đã tiếp nhận", IN_PROGRESS: "Đang thực hiện", DONE: "Đã hoàn thành", CANCELLED: "Đã hủy" }
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
class StatusError extends Error {
  constructor(readonly status: number, readonly payload: unknown) { super("Staff status request failed") }
}
async function requestStatus(id: string, signal: AbortSignal, attempt?: StaffStatusOperation): Promise<{ status: number; payload: unknown }> {
  const response = await fetch(`/api/staff/jobs/${id}/status`, {
    method: attempt ? "PATCH" : "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal,
    headers: { Accept: "application/json", ...(attempt ? { "Content-Type": "application/json", "Idempotency-Key": attempt.idempotencyKey } : {}) },
    ...(attempt ? { body: JSON.stringify({ status: attempt.requestedStatus }) } : {}),
  })
  if (response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") throw new StatusError(502, null)
  const reader = response.body?.getReader()
  if (!reader) throw new StatusError(502, null)
  const chunks: Uint8Array[] = []; let size = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > 65_536) { await reader.cancel(); throw new StatusError(502, null) }
      chunks.push(part.value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  let payload: unknown
  try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) } catch { throw new StatusError(502, null) }
  if (!response.ok) throw new StatusError(response.status, payload)
  return { status: response.status, payload }
}

function StatusConfirmation({ target, retry, busy, isBusy, close, submit }: {
  target: StaffNextStatus; retry: boolean; busy: boolean; isBusy: () => boolean; close: () => void; submit: (event: FormEvent<HTMLFormElement>) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null), cancel = useRef<HTMLButtonElement>(null)
  const titleId = useId(), descriptionId = useId()
  useLayoutEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
    cancel.current?.focus({ preventScroll: true })
    return () => element?.close()
  }, [])
  return <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId}
    className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-border bg-background p-5 text-foreground shadow-xl backdrop:bg-slate-950/35 sm:p-7"
    onCancel={event => { event.preventDefault(); if (!isBusy()) close() }}>
    <h2 id={titleId} className="m-0 break-words text-xl leading-8 font-semibold">{retry ? "Thử lại thao tác đã lưu" : STAFF_STATUS_ACTION[target].label}</h2>
    <p id={descriptionId} className="mt-4 mb-0 break-words text-sm leading-7 text-muted-foreground">{retry ? "Hệ thống sẽ gửi lại đúng bước và mã thao tác trước đó để đối chiếu kết quả, không tạo thao tác mới." : STAFF_STATUS_ACTION[target].confirm}</p>
    <form onSubmit={submit} aria-busy={busy} className="mt-6 flex min-w-0 flex-col-reverse gap-3 sm:flex-row sm:justify-end">
      <Button ref={cancel} type="button" variant="outline" className="min-h-11 whitespace-normal" disabled={busy} onClick={close}>Quay lại</Button>
      <Button type="submit" className="h-auto min-h-11 whitespace-normal px-4 py-2" disabled={busy}>{busy ? <><LoaderCircleIcon aria-hidden="true" className="animate-spin motion-reduce:animate-none" />Đang gửi...</> : retry ? "Thử lại cùng thao tác" : "Xác nhận"}</Button>
    </form>
  </dialog>
}

/** Every mutation is explicit. Mount, reload and refresh only GET the durable BFF context. */
export function StaffJobStatus({ assignmentId, onChanged }: { assignmentId: string; onChanged: () => void }) {
  const auth = useStaffAuth()
  const [state, setState] = useState<StaffStatusState | null>(null)
  const [attempt, setAttempt] = useState<StaffStatusOperation | null>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState<"check" | "submit" | null>("check")
  const [confirmation, setConfirmation] = useState<{ target: StaffNextStatus; retry: boolean } | null>(null)
  const mutex = useRef(false), mounted = useRef(false), active = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const trigger = useRef<HTMLButtonElement | null>(null), feedback = useRef<HTMLDivElement>(null)
  const checkSession = auth?.checkSession
  useEffect(() => { if ((error || notice) && !busy) feedback.current?.focus({ preventScroll: true }) }, [error, notice, busy])
  useEffect(() => {
    mounted.current = true
    const version = ++generation.current
    const controller = new AbortController(); active.current = controller
    const timer = window.setTimeout(() => controller.abort(), 20_000)
    mutex.current = true
    void (async () => {
      try {
        const response = await requestStatus(assignmentId, controller.signal)
        const parsed = response.status === 200 ? parseStaffStatusPayload(response.payload, assignmentId) : null
        if (!parsed) throw new StatusError(502, null)
        if (mounted.current && version === generation.current) { setState(parsed); setAttempt(parsed.operation?.phase === "confirmed" ? null : parsed.operation); setError("") }
      } catch (caught) {
        if (!mounted.current || version !== generation.current) return
        const code = caught instanceof StatusError && isRecord(caught.payload) && isRecord(caught.payload.error) && typeof caught.payload.error.code === "string" ? caught.payload.error.code : "REQUEST_FAILED"
        setError(staffStatusErrorMessage(caught instanceof StatusError ? caught.status : 503, code))
        if (caught instanceof StatusError && [401, 403].includes(caught.status)) await checkSession?.()
      } finally { window.clearTimeout(timer); if (mounted.current && version === generation.current) { mutex.current = false; setBusy(null) } }
    })()
    return () => { ++generation.current; mounted.current = false; controller.abort(); window.clearTimeout(timer) }
  }, [assignmentId, checkSession])

  const operation = attempt || state?.operation || null
  const unresolved = operation && operation.phase !== "confirmed" ? operation : null
  const canRetry = Boolean(unresolved && state && state.blockedReason !== "ASSIGNMENT_CHANGED" && state.current.status !== "CANCELLED" && state.current.orderStatus !== "cancelled"
    && (state.canRetry || (attempt && state.operation?.idempotencyKey !== attempt.idempotencyKey)))
  const allowed = !unresolved && !error ? state?.allowedStatus : null
  const close = () => { if (mutex.current) return; setConfirmation(null); queueMicrotask(() => trigger.current?.focus({ preventScroll: true })) }

  async function check() {
    if (mutex.current) return
    mutex.current = true; setBusy("check"); setError(""); setNotice("")
    const controller = new AbortController(); active.current = controller
    const timer = window.setTimeout(() => controller.abort(), 20_000)
    try {
      const response = await requestStatus(assignmentId, controller.signal)
      const parsed = response.status === 200 ? parseStaffStatusPayload(response.payload, assignmentId) : null
      if (!parsed) throw new StatusError(502, null)
      if (!mounted.current) return
      setState(parsed)
      const ownsAttempt = !attempt || parsed.operation?.idempotencyKey === attempt.idempotencyKey
      if (ownsAttempt) setAttempt(parsed.operation?.phase === "confirmed" ? null : parsed.operation)
      setNotice(parsed.operation?.phase === "confirmed" ? "Thao tác đã có xác nhận hoàn tất. Thông tin hiện tại đã được đọc lại." : "Đã đọc lại trạng thái hiện tại. Thao tác chưa có xác nhận hoàn tất vẫn cần được đối chiếu.")
      // Do not unmount an uncertain browser attempt until its exact key is durable.
      if (ownsAttempt) onChanged()
    } catch (caught) {
      if (!mounted.current) return
      const code = caught instanceof StatusError && isRecord(caught.payload) && isRecord(caught.payload.error) && typeof caught.payload.error.code === "string" ? caught.payload.error.code : "REQUEST_FAILED"
      setError(staffStatusErrorMessage(caught instanceof StatusError ? caught.status : 503, code))
      if (caught instanceof StatusError && [401, 403].includes(caught.status)) await checkSession?.()
    } finally { window.clearTimeout(timer); if (mounted.current) { mutex.current = false; setBusy(null) } }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (mutex.current || !confirmation) return
    let sending: StaffStatusOperation
    if (confirmation.retry) {
      if (!unresolved || !canRetry) return
      sending = unresolved
    } else {
      if (allowed !== confirmation.target) return
      if (typeof crypto.randomUUID !== "function") { setError("Chưa tạo được mã thao tác an toàn. Vui lòng dùng kết nối HTTPS hoặc localhost."); setConfirmation(null); return }
      sending = { idempotencyKey: crypto.randomUUID(), requestedStatus: confirmation.target, phase: "unknown", createdAt: new Date().toISOString(), observedTarget: false }
    }
    mutex.current = true; setBusy("submit"); setError(""); setNotice(""); setAttempt(sending)
    const controller = new AbortController(); active.current = controller
    const timer = window.setTimeout(() => controller.abort(), 45_000)
    try {
      const response = await requestStatus(assignmentId, controller.signal, sending)
      const parsed = parseStaffStatusMutationPayload(response.payload, assignmentId, sending.requestedStatus, sending.idempotencyKey, response.status)
      if (!parsed) throw new StatusError(502, null)
      if (!mounted.current) return
      setAttempt(parsed)
      setNotice(parsed.phase === "confirmed" ? "Thao tác đã được xác nhận hoàn tất. Đang tải lại thông tin công việc." : "Đã ghi nhận cập nhật công việc; đang chờ xác nhận đồng bộ đơn dịch vụ. Vui lòng kiểm tra lại trước khi tiếp tục.")
      onChanged()
    } catch (caught) {
      if (!mounted.current) return
      const payload = caught instanceof StatusError && isRecord(caught.payload) ? caught.payload : null
      const details = payload && isRecord(payload.error) ? payload.error : null
      const saved = payload ? parseStaffStatusOperation(payload.operation) : null
      if (saved) setAttempt(saved)
      else if (details?.outcome === "not_sent") setAttempt(null)
      // Transport errors keep the same key; they never prove a failed mutation.
      const code = typeof details?.code === "string" ? details.code : "REQUEST_FAILED"
      setError(staffStatusErrorMessage(caught instanceof StatusError ? caught.status : 503, code))
      if (caught instanceof StatusError && [401, 403].includes(caught.status)) await checkSession?.()
    } finally {
      window.clearTimeout(timer)
      if (mounted.current) { mutex.current = false; setBusy(null); setConfirmation(null) }
    }
  }

  useEffect(() => () => active.current?.abort(), [])
  return <Card data-staff-status-panel className="min-w-0 rounded-2xl shadow-none ring-border [--card-spacing:--spacing(6)]">
    <CardHeader><h2 className="m-0 text-lg font-semibold">Cập nhật công việc</h2></CardHeader>
    <CardContent className="min-w-0 space-y-4" aria-busy={busy !== null}>
      {state && <p className="m-0 text-sm leading-7">Trạng thái hiện tại: <strong>{labels[state.current.status]}</strong></p>}
      {busy === "check" && <p className="m-0 flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircleIcon aria-hidden="true" className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />Đang kiểm tra thao tác...</p>}
      {operation && <div data-operation-phase={operation.phase} className={`min-w-0 rounded-xl border px-4 py-3 text-sm leading-7 ${operation.phase === "confirmed" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-950"}`}>
        <p className="m-0 font-medium">{operation.phase === "confirmed" ? "Thao tác đã được xác nhận" : operation.phase === "pending" ? "Đang chờ xác nhận đồng bộ" : "Chưa xác định được kết quả thao tác"}</p>
        <p className="mt-1 mb-0">{STAFF_STATUS_ACTION[operation.requestedStatus].label}. {operation.phase === "confirmed" ? "Thông tin hiển thị là xác nhận của thao tác đã lưu." : "Không tạo thao tác mới. Hãy kiểm tra lại hoặc thử lại cùng thao tác để đối chiếu."}</p>
        {operation.observedTarget && operation.phase !== "confirmed" && <p className="mt-2 mb-0">Trạng thái công việc đã tiến triển, nhưng chưa đủ để xác nhận thao tác này đã đồng bộ hoàn tất.</p>}
      </div>}
      {(error || notice) && <div ref={feedback} tabIndex={-1} role={error ? "alert" : "status"} className={`min-w-0 rounded-xl border px-4 py-3 text-sm leading-7 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${error ? "border-red-200 bg-red-50 text-red-800" : "border-blue-100 bg-blue-50 text-blue-950"}`}>{error || notice}</div>}
      {!busy && state && !allowed && !unresolved && !error && <p className="m-0 text-sm leading-7 text-muted-foreground">{state.blockedReason === "ASSIGNMENT_CHANGED" ? "Phân công đã thay đổi. Vui lòng liên hệ người quản lý để đối chiếu." : state.blockedReason === "CANCELLATION_PENDING" ? "Đơn đang có yêu cầu hủy chờ xử lý." : state.blockedReason === "BOOKING_NOT_ACTIVE" ? "Đơn dịch vụ hiện chưa cho phép cập nhật công việc." : "Hiện không có bước tiếp theo để cập nhật."}</p>}
      {unresolved && state?.blockedReason === "ASSIGNMENT_CHANGED" && <p className="m-0 text-sm leading-7 text-muted-foreground">Phân công đã thay đổi. Cần người quản lý đối chiếu thao tác trước khi tiếp tục.</p>}
      <div className="flex min-w-0 flex-col gap-3">
        {allowed && <Button ref={trigger} type="button" className="h-auto min-h-11 w-full whitespace-normal px-4 py-2" disabled={busy !== null} onClick={() => { if (!mutex.current) setConfirmation({ target: allowed, retry: false }) }}>{STAFF_STATUS_ACTION[allowed].label}</Button>}
        {unresolved && <Button ref={trigger} type="button" className="h-auto min-h-11 w-full whitespace-normal px-4 py-2" disabled={busy !== null || !canRetry} onClick={() => { if (!mutex.current && canRetry) setConfirmation({ target: unresolved.requestedStatus, retry: true }) }}>Thử lại cùng thao tác</Button>}
        <Button type="button" variant="outline" className="h-auto min-h-11 w-full whitespace-normal px-4 py-2" disabled={busy !== null} onClick={() => void check()}><RefreshCwIcon aria-hidden="true" />Kiểm tra lại trạng thái</Button>
      </div>
    </CardContent>
    {confirmation && <StatusConfirmation target={confirmation.target} retry={confirmation.retry} busy={busy === "submit"} isBusy={() => mutex.current} close={close} submit={event => void submit(event)} />}
  </Card>
}
