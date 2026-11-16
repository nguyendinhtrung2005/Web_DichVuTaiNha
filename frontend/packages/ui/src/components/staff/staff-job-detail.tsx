"use client"

import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import { AreaLink as Link } from "@/components/shared/area-routes"
import {
  ArrowLeftIcon,
  CalendarDaysIcon,
  CheckIcon,
  ClipboardCheckIcon,
  Clock3Icon,
  InfoIcon,
  LoaderCircleIcon,
  MapPinIcon,
  PhoneIcon,
  UserRoundIcon,
  XIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { ApiError } from "@/lib/api-client"
import { JOB_STATUS_LABEL, ORDER_STATUS_LABEL } from "@/lib/config"
import { loadStaffJob, transitionStaffJob } from "@/lib/staff-jobs"
import type { JobStatus, StaffJob } from "@/lib/types"
import { date, useData } from "../../common"
import { StaffApiJobBadge, StaffEmpty, StaffError, StaffLoading, StaffPageHeader } from "./staff-shared"

const nextAction: Partial<Record<JobStatus, { next: JobStatus; label: string; confirm: string }>> = {
  waiting: { next: "accepted", label: "Tiếp nhận công việc", confirm: "Bạn xác nhận tiếp nhận công việc này?" },
  accepted: { next: "in_progress", label: "Bắt đầu thực hiện", confirm: "Xác nhận bắt đầu thực hiện? Trạng thái đơn sẽ chuyển sang “Đang thực hiện”." },
  in_progress: { next: "done", label: "Hoàn thành", confirm: "Xác nhận đã hoàn thành công việc? Đơn chỉ hoàn thành khi mọi phân công bắt buộc đã xong." },
}

function JobConfirmation({ action, busy, error, close, submit }: {
  action: { next: JobStatus; label: string; confirm: string }
  busy: boolean
  error: string
  close: () => void
  submit: (event: FormEvent<HTMLFormElement>) => void
}) {
  const element = useRef<HTMLDialogElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useLayoutEffect(() => {
    const dialog = element.current
    if (dialog && !dialog.open) dialog.showModal()
    cancelButton.current?.focus({ preventScroll: true })
    return () => dialog?.close()
  }, [])

  return (
    <dialog ref={element} aria-labelledby={titleId} aria-describedby={descriptionId}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-border bg-background p-5 text-foreground shadow-xl outline-none backdrop:bg-slate-950/35 backdrop:backdrop-blur-sm sm:p-7"
      onCancel={(event) => { event.preventDefault(); if (!busy) close() }}
      onClick={(event) => { if (event.target === event.currentTarget && !busy) close() }}>
      <div className="mb-5 flex min-w-0 items-start justify-between gap-3">
        <h2 id={titleId} className="m-0 pt-2 text-xl leading-7 font-semibold">{action.label}</h2>
        <Button type="button" variant="ghost" className="size-11 shrink-0" aria-label="Đóng hộp thoại" disabled={busy} onClick={close}><XIcon aria-hidden="true" /></Button>
      </div>
      <form noValidate onSubmit={submit} aria-busy={busy} className="flex flex-col gap-5">
        <p id={descriptionId} className="m-0 text-sm leading-7 text-muted-foreground">{action.confirm}</p>
        {error && <p role="alert" className="m-0 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-7 text-red-800">{error}</p>}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button ref={cancelButton} type="button" variant="outline" className="h-11" disabled={busy} onClick={close}>Quay lại</Button>
          <Button type="submit" className="h-11" disabled={busy}>{busy ? <><LoaderCircleIcon aria-hidden="true" className="animate-spin motion-reduce:animate-none" />Đang lưu...</> : "Xác nhận"}</Button>
        </div>
      </form>
    </dialog>
  )
}

function DetailItem({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><dt className="mb-2 text-xs text-muted-foreground">{label}</dt><dd className="m-0 break-words text-sm leading-7">{children}</dd></div>
}

export function StaffJobDetail({ id }: { id: string }) {
  const { user, role } = useData()
  const [job, setJob] = useState<StaffJob | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (!user || role !== "staff" || user.role !== "staff") {
      setLoading(false)
      setJob(null)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setError("")
    void loadStaffJob(id, controller.signal).then(setJob).catch((reason: unknown) => {
      if (controller.signal.aborted) return
      if (reason instanceof ApiError && reason.status === 404) setJob(null)
      else setError(reason instanceof ApiError ? reason.message : "Chưa thể tải chi tiết công việc.")
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [id, reload, role, user])

  if (!user || role !== "staff" || user.role !== "staff") return <StaffEmpty title="Không thể mở công việc" description="Vui lòng đăng nhập bằng tài khoản nhân viên được phân công." />
  if (loading) return <StaffLoading />
  if (error) return <StaffError title="Chưa thể tải chi tiết công việc" description={error} />
  if (!job) return <StaffEmpty title="Không tìm thấy công việc" description="Công việc không còn trong danh sách hoặc không được phân công cho bạn." action={<Button className="h-11" variant="outline" render={<Link href="/cong-viec" />} nativeButton={false}>Trở về công việc</Button>} />
  return <JobDetailContent key={`${job.id}-${job.jobStatus}-${job.orderStatus}`} job={job} reload={() => setReload((value) => value + 1)} />
}

function JobDetailContent({ job, reload }: { job: StaffJob; reload: () => void }) {
  const [action, setAction] = useState<{ next: JobStatus; label: string; confirm: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [feedback, setFeedback] = useState("")
  const submitting = useRef(false)
  const actionButton = useRef<HTMLButtonElement>(null)
  const feedbackElement = useRef<HTMLDivElement>(null)
  const next = job.orderStatus === "cancelled" || job.orderStatus === "completed" ? null : nextAction[job.jobStatus] ?? null
  const startBlocked = next?.next === "in_progress" && job.cancelPending
  const steps: JobStatus[] = ["waiting", "accepted", "in_progress", "done"]
  const currentStep = steps.indexOf(job.jobStatus)

  useEffect(() => {
    if (feedback) feedbackElement.current?.focus({ preventScroll: true })
  }, [feedback])

  const closeConfirmation = () => {
    if (submitting.current) return
    setAction(null)
    setError("")
    actionButton.current?.focus({ preventScroll: true })
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting.current || !action || startBlocked) return
    submitting.current = true
    setBusy(true)
    setError("")
    setFeedback("")
    try {
      const result = await transitionStaffJob(job.id, action.next)
      setAction(null)
      setFeedback(`Đã cập nhật công việc: ${JOB_STATUS_LABEL[result.jobStatus]}. Trạng thái đơn: ${ORDER_STATUS_LABEL[result.orderStatus]}.`)
      reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Chưa thể cập nhật công việc. Vui lòng thử lại.")
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  return (
    <div className="min-w-0">
      <Button variant="ghost" className="mb-5 h-11 text-muted-foreground" render={<Link href="/cong-viec" />} nativeButton={false}><ArrowLeftIcon aria-hidden="true" />Công việc được phân công</Button>
      <StaffPageHeader title={`Công việc ${job.code}`} description={`${job.serviceName} · Đặt ngày ${date(job.createdAt)}`} action={<StaffApiJobBadge job={job} />} />
      {feedback && <div ref={feedbackElement} role="status" tabIndex={-1} className="mb-6 flex min-w-0 items-start gap-3 rounded-xl border border-blue-100 bg-blue-50 px-5 py-4 text-sm leading-7 text-blue-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"><InfoIcon aria-hidden="true" className="mt-1 size-5 shrink-0" /><p className="m-0 min-w-0 break-words">{feedback}</p></div>}

      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0 space-y-6">
          <Card className="min-w-0 rounded-2xl shadow-none ring-border [--card-spacing:--spacing(6)]">
            <CardHeader><h2 className="m-0 text-lg font-semibold">Thông tin công việc</h2></CardHeader>
            <CardContent className="space-y-6">
              <div><h3 className="m-0 break-words text-lg leading-7 font-semibold">{job.serviceName}</h3><p className="m-0 mt-2 text-sm text-muted-foreground">{job.quantity} {job.unit}</p></div>
              <dl className="m-0 grid gap-5 border-t border-border pt-6 sm:grid-cols-2">
                <DetailItem label="Ngày và giờ thực hiện"><span className="flex items-start gap-2"><CalendarDaysIcon aria-hidden="true" className="mt-1.5 size-4 shrink-0 text-primary" /><span>{date(job.scheduledAt)}</span></span></DetailItem>
                <DetailItem label="Thời lượng dự kiến"><span className="flex items-center gap-2"><Clock3Icon aria-hidden="true" className="size-4 shrink-0 text-primary" />{job.durationMinutes} phút</span></DetailItem>
                <DetailItem label="Mã đơn">{job.code}</DetailItem>
                <DetailItem label="Trạng thái đơn">{ORDER_STATUS_LABEL[job.orderStatus]}</DetailItem>
                <DetailItem label="Ghi chú của khách hàng"><span className="whitespace-pre-wrap">{job.specialRequest || "Không có yêu cầu đặc biệt."}</span></DetailItem>
              </dl>
            </CardContent>
          </Card>

          <Card className="min-w-0 rounded-2xl shadow-none ring-border [--card-spacing:--spacing(6)]">
            <CardHeader><h2 className="m-0 text-lg font-semibold">Khách hàng và địa điểm</h2></CardHeader>
            <CardContent><dl className="m-0 grid gap-5 sm:grid-cols-2">
              <DetailItem label="Người liên hệ"><span className="flex items-start gap-2"><UserRoundIcon aria-hidden="true" className="mt-1.5 size-4 shrink-0 text-muted-foreground" />{job.contact.name}</span></DetailItem>
              <DetailItem label="Số điện thoại"><a href={`tel:${job.contact.phone.replace(/[^+\d]/g, "")}`} className="inline-flex min-h-11 items-center gap-2 rounded-md text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"><PhoneIcon aria-hidden="true" className="size-4 shrink-0" />{job.contact.phone}</a></DetailItem>
              <div className="sm:col-span-2"><DetailItem label="Địa chỉ thực hiện"><span className="flex min-w-0 items-start gap-2"><MapPinIcon aria-hidden="true" className="mt-1.5 size-4 shrink-0 text-primary" /><span>{job.contact.address}</span></span></DetailItem></div>
            </dl></CardContent>
          </Card>

          <Card className="min-w-0 rounded-2xl shadow-none ring-border [--card-spacing:--spacing(6)]">
            <CardHeader><h2 className="m-0 text-lg font-semibold">Lịch sử cập nhật</h2></CardHeader>
            <CardContent>{job.history.length ? <ol className="m-0 list-none p-0">{job.history.map((entry, index) => <li key={`${entry.at}-${index}`} className="relative flex min-w-0 gap-4 pb-6 last:pb-0"><div aria-hidden="true" className="relative flex w-5 shrink-0 justify-center"><span className="relative z-10 mt-2 size-2.5 rounded-full bg-primary" />{index < job.history.length - 1 && <span className="absolute top-5 bottom-[-0.5rem] w-px bg-border" />}</div><div className="min-w-0"><h3 className="m-0 break-words text-sm leading-7 font-semibold">{entry.label}</h3><p className="m-0 mt-1 break-words text-xs leading-6 text-muted-foreground">{date(entry.at)} · {entry.by}</p></div></li>)}</ol> : <p className="m-0 text-sm leading-7 text-muted-foreground">Chưa có lịch sử cập nhật.</p>}</CardContent>
          </Card>
        </div>

        <aside aria-label="Trạng thái công việc" className="min-w-0 space-y-6 xl:sticky xl:top-24">
          <Card className="min-w-0 rounded-2xl shadow-sm shadow-slate-900/5 ring-blue-100 [--card-spacing:--spacing(6)]">
            <CardHeader><div className="flex items-center gap-2.5"><ClipboardCheckIcon aria-hidden="true" className="size-5 text-primary" /><h2 className="m-0 text-lg font-semibold">Tiến trình công việc</h2></div></CardHeader>
            <CardContent className="space-y-5">
              <StaffApiJobBadge job={job} />
              <ol className="m-0 grid list-none gap-3 p-0" aria-label="Quy trình thực hiện">{steps.map((step, index) => <li key={step} className="flex items-center gap-3 text-sm"><span aria-hidden="true" className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${job.orderStatus === "cancelled" ? "bg-slate-100 text-slate-500" : index <= currentStep ? "bg-blue-50 text-primary" : "bg-slate-100 text-slate-400"}`}>{index < currentStep && job.orderStatus !== "cancelled" ? <CheckIcon className="size-3.5" /> : index + 1}</span><span className={index === currentStep && job.orderStatus !== "cancelled" ? "font-semibold text-primary" : "text-muted-foreground"}>{JOB_STATUS_LABEL[step]}</span></li>)}</ol>
              {next && <Button ref={actionButton} type="button" className="h-11 w-full" disabled={Boolean(busy) || Boolean(startBlocked)} onClick={() => { setError(""); setFeedback(""); setAction(next) }}>{next.label}</Button>}
              {job.cancelPending && <p className="m-0 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-7 text-amber-900">Yêu cầu hủy đang chờ xét duyệt; chưa thể bắt đầu công việc.</p>}
              {job.orderStatus === "cancelled" && <p className="m-0 text-sm leading-7 text-muted-foreground">Đơn đã hủy và không còn thao tác thực hiện.</p>}
              {(job.orderStatus === "completed" || job.jobStatus === "done") && <p className="m-0 text-sm leading-7 text-muted-foreground">Công việc đã hoàn thành.</p>}
            </CardContent>
          </Card>
        </aside>
      </div>
      {action && <JobConfirmation action={action} busy={busy} error={error} close={closeConfirmation} submit={submit} />}
    </div>
  )
}
