"use client"

import { useEffect, useId, useRef, useState } from "react"
import { CalendarDaysIcon, ClockIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { addDays, formatStaffDay, formatStaffWindow, staffDayOf, type StaffAvailability, type StaffAreasWeek, type StaffBranch } from "./staff-areas-remote-model"
import { availabilityLocalInput, availabilityStatus, availabilityTouchesDay, validateAvailabilityDraft, type AvailabilityDraft, type AvailabilityRequestKind } from "./staff-availability-request-model"

type View = { kind: "day"; day: string } | { kind: "slot"; day: string; id: string } | { kind: "request"; day: string; mode: AvailabilityRequestKind; targetId: string | null }
type Props = { accountId: string; items: StaffAvailability[]; week: StaffAreasWeek; branch: StaffBranch; truncated: boolean }
const requestNames = { register: "Chuẩn bị đăng ký ca", change: "Chuẩn bị yêu cầu đổi ca", cancel: "Chuẩn bị yêu cầu hủy ca" }

function WindowInfo({ item }: { item: StaffAvailability }) {
  return <dl className="staff-areas-detail-fields">
    <div><dt>Ngày bắt đầu</dt><dd><time dateTime={item.startsAt}>{formatStaffDay(staffDayOf(item.startsAt))}</time></dd></div>
    <div><dt>Ngày kết thúc</dt><dd><time dateTime={item.endsAt}>{formatStaffDay(staffDayOf(item.endsAt))}</time></dd></div>
    <div><dt>Giờ Việt Nam (UTC+7)</dt><dd>{formatStaffWindow(item.startsAt, item.endsAt)}</dd></div>
    <div><dt>Trạng thái khả dụng</dt><dd>{availabilityStatus(item.status)}</dd></div>
    <div><dt>Mã khung giờ</dt><dd>#{item.id}</dd></div>
  </dl>
}

function RequestDraft({ accountId, items, week, truncated, mode, targetId, day, onBack }: Props & { mode: AvailabilityRequestKind; targetId: string | null; day: string; onBack: () => void }) {
  const target = items.find(item => item.id === targetId)
  const [draft, setDraft] = useState<AvailabilityDraft>(() => ({ accountId, kind: mode, targetId,
    startsLocal: target ? availabilityLocalInput(target.startsAt) : `${day}T08:00`,
    endsLocal: target ? availabilityLocalInput(target.endsAt) : `${day}T12:00`, reason: "" }))
  const [review, setReview] = useState(false), [checked, setChecked] = useState(false), [attempted, setAttempted] = useState(false)
  const heading = useRef<HTMLDivElement>(null), formHeading = useRef<HTMLHeadingElement>(null), reviewHeading = useRef<HTMLHeadingElement>(null), id = useId()
  useEffect(() => { (review ? reviewHeading : formHeading).current?.focus() }, [review])
  const result = validateAvailabilityDraft(draft, { accountId, items, week, truncated, now: Date.now() })
  const update = (field: "startsLocal" | "endsLocal" | "reason", value: string) => { setDraft(current => ({ ...current, [field]: value })); setReview(false); setChecked(false) }
  const errors = Object.entries(result.errors)
  return <div data-staff-availability-request={mode}>
    <p role="note" className="staff-availability-blocked">Chưa thể gửi đăng ký, đổi hoặc hủy ca. Bạn chỉ đang chuẩn bị nội dung, chưa lưu hay tạo yêu cầu chờ duyệt. Hãy trao đổi trực tiếp với người quản lý khi cần thay đổi ca.</p>
    {target && <WindowInfo item={target} />}
    {!review ? <form noValidate onSubmit={event => { event.preventDefault(); setAttempted(true); if (result.valid) { setReview(true); setChecked(false) } else queueMicrotask(() => heading.current?.focus()) }}>
      <h3 ref={formHeading} tabIndex={-1} data-staff-availability-form-heading>Thông tin yêu cầu chưa gửi</h3>
      {attempted && errors.length > 0 && <div ref={heading} tabIndex={-1} role="alert" className="staff-areas-error" data-staff-availability-validation><p>Kiểm tra nội dung:</p><ul>{errors.map(([key, message]) => <li key={key} id={`${id}-error-${key}`}>{message}</li>)}</ul></div>}
      {mode !== "cancel" && <div className="staff-availability-form-row">
        <label htmlFor={`${id}-start`}>Bắt đầu (giờ Việt Nam)<input id={`${id}-start`} name="availability-start" type="datetime-local" step="60" value={draft.startsLocal} aria-invalid={attempted && !!(result.errors.startsLocal || result.errors.overlap)} aria-describedby={attempted ? [result.errors.startsLocal && `${id}-error-startsLocal`, result.errors.overlap && `${id}-error-overlap`].filter(Boolean).join(" ") || undefined : undefined} onChange={event => update("startsLocal", event.target.value)} /></label>
        <label htmlFor={`${id}-end`}>Kết thúc (giờ Việt Nam)<input id={`${id}-end`} name="availability-end" type="datetime-local" step="60" value={draft.endsLocal} aria-invalid={attempted && !!(result.errors.endsLocal || result.errors.overlap)} aria-describedby={attempted ? [result.errors.endsLocal && `${id}-error-endsLocal`, result.errors.overlap && `${id}-error-overlap`].filter(Boolean).join(" ") || undefined : undefined} onChange={event => update("endsLocal", event.target.value)} /></label>
      </div>}
      <label className="staff-availability-reason" htmlFor={`${id}-reason`}>{mode === "register" ? "Ghi chú (không bắt buộc)" : "Lý do đổi/hủy (5–500 ký tự)"}<textarea id={`${id}-reason`} name="availability-reason" rows={3} maxLength={500} value={draft.reason} aria-invalid={attempted && !!result.errors.reason} aria-describedby={attempted && result.errors.reason ? `${id}-error-reason` : undefined} onChange={event => update("reason", event.target.value)} /></label>
      <p className="staff-areas-muted">Kiểm tra sơ bộ với các khung giờ khả dụng và không khả dụng của tuần đang xem. Cần đối chiếu toàn bộ lịch công việc và các yêu cầu liên quan khi chức năng gửi được hỗ trợ.</p>
      <div className="staff-availability-actions"><Button type="button" variant="outline" onClick={onBack}>Quay lại chi tiết</Button><Button type="submit" data-staff-availability-preview>Xem lại nội dung</Button></div>
    </form> : <section data-staff-availability-review>
      <h3 ref={reviewHeading} tabIndex={-1} data-staff-availability-review-heading>Nội dung chưa gửi</h3>
      <p>{requestNames[mode]}</p>
      {mode !== "cancel" && <p>{formatStaffDay(draft.startsLocal.slice(0, 10))} {draft.startsLocal.slice(11)} → {formatStaffDay(draft.endsLocal.slice(0, 10))} {draft.endsLocal.slice(11)} (UTC+7)</p>}
      {draft.reason.trim() && <p className="staff-availability-note">{draft.reason.trim()}</p>}
      <p>Trạng thái phê duyệt: chưa có yêu cầu được tạo. Khi chức năng được phê duyệt, thay đổi chỉ có hiệu lực theo kết quả xử lý của người quản lý.</p>
      <label className="staff-areas-checkbox"><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} />Tôi đã kiểm tra nội dung và hiểu rằng chưa thể gửi yêu cầu.</label>
      {!result.valid && <p role="alert">Nội dung không còn hợp lệ theo thời gian hoặc lịch hiện tại. Quay lại để kiểm tra.</p>}
      <div className="staff-availability-actions"><Button variant="outline" data-staff-availability-edit onClick={() => { setReview(false); setChecked(false) }}>Chỉnh nội dung</Button><Button disabled aria-describedby={`${id}-unavailable`} data-staff-availability-submit>Gửi yêu cầu — chưa khả dụng</Button></div>
      <p id={`${id}-unavailable`} role="status">Chưa gửi: chức năng tiếp nhận và phê duyệt yêu cầu chưa khả dụng. Không có ca chính thức nào bị thay đổi.</p>
    </section>}
  </div>
}

export function StaffAvailabilityInteractions(props: Props) {
  const { accountId, items, week, branch } = props
  const [view, setView] = useState<View | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const detailHeading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { if (view && view.kind !== "request") detailHeading.current?.focus() }, [view])
  const days = Array.from({ length: 7 }, (_, index) => addDays(week.from, index))
  const selected = view?.kind === "slot" ? items.find(item => item.id === view.id) : null
  const open = (next: View, button: HTMLButtonElement) => { trigger.current = button; setView(next) }
  const request = (mode: AvailabilityRequestKind, targetId: string | null, day: string) => setView({ kind: "request", mode, targetId, day })
  const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10)
  const initialDay = today >= week.from && today <= week.to ? today : week.from
  return <div data-staff-availability-interactive data-staff-availability-account={accountId}>
    <div className="staff-availability-intro"><p>Chọn ngày hoặc khung giờ để xem chi tiết. Đăng ký, đổi và hủy ca hiện chỉ có thể chuẩn bị nội dung, chưa gửi được.</p><Button variant="outline" data-staff-availability-register onClick={event => open({ kind: "request", mode: "register", targetId: null, day: initialDay }, event.currentTarget)}>Chuẩn bị đăng ký ca</Button></div>
    {!items.length && <p role="status">Chưa có lịch khả dụng trong tuần này. Có thể mở từng ngày để xem trạng thái không có dữ liệu.</p>}
    <div className="staff-areas-days staff-areas-days-week">
      {days.map(day => {
        const windows = items.filter(item => availabilityTouchesDay(item, day))
        return <section key={day} className="staff-areas-day" data-staff-availability-day={day}>
          <h3><button type="button" className="staff-availability-day-button" aria-haspopup="dialog" data-staff-availability-day-open={day} onClick={event => open({ kind: "day", day }, event.currentTarget)}><CalendarDaysIcon aria-hidden="true" />{formatStaffDay(day)}<span>{windows.length} khung giờ · Xem chi tiết</span></button></h3>
          <div>{windows.length ? windows.map(item => <article key={item.id} className="staff-areas-shift staff-availability-interactive-slot" data-staff-availability-id={item.id} data-staff-availability-status={item.status || "unknown"}>
            <button type="button" className="staff-availability-slot-button" data-staff-availability-open={item.id} aria-haspopup="dialog" aria-label={`Xem khung giờ ${formatStaffWindow(item.startsAt, item.endsAt)}, ${formatStaffDay(day)}, ${availabilityStatus(item.status)}`} onClick={event => open({ kind: "slot", day, id: item.id }, event.currentTarget)}>
              <span className="staff-areas-shift-top"><strong>{availabilityStatus(item.status)}</strong><span>#{item.id}</span></span>
              <span className="staff-areas-shift-time"><ClockIcon aria-hidden="true" />{formatStaffWindow(item.startsAt, item.endsAt)}</span>
              {staffDayOf(item.startsAt) !== staffDayOf(item.endsAt) && <span>Qua ngày · xem ngày bắt đầu/kết thúc</span>}
              <span className="staff-availability-open-label">Xem chi tiết</span>
            </button>
          </article>) : <p className="staff-areas-muted">Không có khung giờ khả dụng.</p>}</div>
        </section>
      })}
    </div>
    <Dialog open={!!view} onOpenChange={value => { if (!value) setView(null) }}><DialogContent showCloseButton={false} className="staff-areas-dialog staff-availability-dialog" finalFocus={trigger} data-staff-availability-detail={view?.kind}>
      <DialogHeader><DialogTitle ref={detailHeading} tabIndex={-1} data-staff-availability-detail-heading>{view?.kind === "request" ? requestNames[view.mode] : view?.kind === "slot" ? "Chi tiết khung giờ khả dụng" : "Chi tiết ngày khả dụng"}</DialogTitle><DialogDescription>Giờ Việt Nam (UTC+7). Khung giờ khả dụng được đọc từ hệ thống, không phải lịch phân công công việc.</DialogDescription></DialogHeader>
      <p className="staff-availability-branch">{branch.name || "Chi nhánh được phân công"} · #{branch.id}</p>
      {view?.kind === "request" ? <RequestDraft key={`${accountId}:${view.mode}:${view.targetId}:${view.day}`} {...props} mode={view.mode} targetId={view.targetId} day={view.day} onBack={() => setView(view.targetId ? { kind: "slot", day: view.day, id: view.targetId } : { kind: "day", day: view.day })} /> : <>
        {view && <h3>{formatStaffDay(view.day)}</h3>}
        {selected ? <><WindowInfo item={selected} /><p>Phê duyệt: hệ thống chưa cung cấp thông tin chờ duyệt/đã duyệt. Trạng thái khả dụng không đồng nghĩa với đã phê duyệt.</p><div className="staff-availability-actions"><Button variant="outline" data-staff-availability-change onClick={() => view && request("change", selected.id, view.day)}>Chuẩn bị yêu cầu đổi ca</Button><Button variant="outline" data-staff-availability-cancel onClick={() => view && request("cancel", selected.id, view.day)}>Chuẩn bị yêu cầu hủy ca</Button></div></> : view && <>
          <p>{items.filter(item => availabilityTouchesDay(item, view.day)).length} khung giờ trong ngày. Không có bản ghi không đồng nghĩa với không khả dụng hay được nghỉ.</p>
          <div className="staff-availability-day-list">{items.filter(item => availabilityTouchesDay(item, view.day)).map(item => <Button key={item.id} variant="outline" data-staff-availability-day-slot={item.id} onClick={() => setView({ kind: "slot", day: view.day, id: item.id })}>#{item.id} · {formatStaffWindow(item.startsAt, item.endsAt)} · {availabilityStatus(item.status)}</Button>)}</div>
          <Button variant="outline" onClick={() => request("register", null, view.day)}>Chuẩn bị đăng ký ca ngày này</Button>
        </>}
      </>}
      <DialogClose render={<Button variant="outline" aria-label="Đóng chi tiết lịch khả dụng" />}>Đóng</DialogClose>
    </DialogContent></Dialog>
  </div>
}
