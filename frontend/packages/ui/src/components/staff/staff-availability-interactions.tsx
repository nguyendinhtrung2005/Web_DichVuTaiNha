"use client"

import { useEffect, useRef, useState } from "react"
import { CalendarDaysIcon, ClockIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { addDays, formatStaffDay, formatStaffWindow, staffDayOf, type StaffAvailability, type StaffAreasWeek, type StaffBranch } from "./staff-areas-remote-model"
import { availabilityStatus, availabilityTouchesDay } from "./staff-availability-request-model"

type View = { kind: "day"; day: string } | { kind: "slot"; day: string; id: string }
type Props = { accountId: string; items: StaffAvailability[]; week: StaffAreasWeek; branch: StaffBranch; truncated: boolean }
function WindowInfo({ item }: { item: StaffAvailability }) {
  return <dl className="staff-areas-detail-fields">
    <div><dt>Ngày bắt đầu</dt><dd><time dateTime={item.startsAt}>{formatStaffDay(staffDayOf(item.startsAt))}</time></dd></div>
    <div><dt>Ngày kết thúc</dt><dd><time dateTime={item.endsAt}>{formatStaffDay(staffDayOf(item.endsAt))}</time></dd></div>
    <div><dt>Giờ Việt Nam (UTC+7)</dt><dd>{formatStaffWindow(item.startsAt, item.endsAt)}</dd></div>
    <div><dt>Trạng thái khả dụng</dt><dd>{availabilityStatus(item.status)}</dd></div>
    <div><dt>Mã khung giờ</dt><dd>#{item.id}</dd></div>
  </dl>
}

export function StaffAvailabilityInteractions(props: Props) {
  const { accountId, items, week, branch } = props
  const [view, setView] = useState<View | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const detailHeading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { if (view) detailHeading.current?.focus() }, [view])
  const days = Array.from({ length: 7 }, (_, index) => addDays(week.from, index))
  const selected = view?.kind === "slot" ? items.find(item => item.id === view.id) : null
  const open = (next: View, button: HTMLButtonElement) => { trigger.current = button; setView(next) }
  return <div data-staff-availability-interactive data-staff-availability-account={accountId}>
    <p className="staff-availability-intro">Chọn ngày hoặc khung giờ để xem thời gian bạn có thể làm việc.</p>
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
      <DialogHeader><DialogTitle ref={detailHeading} tabIndex={-1} data-staff-availability-detail-heading>{view?.kind === "slot" ? "Chi tiết khung giờ khả dụng" : "Chi tiết ngày khả dụng"}</DialogTitle><DialogDescription>Giờ Việt Nam (UTC+7). Tiếp nhận công việc tại trang Công việc; lịch này chỉ hiển thị thời gian khả dụng.</DialogDescription></DialogHeader>
      <p className="staff-availability-branch">{branch.name || "Chi nhánh được phân công"} · #{branch.id}</p>
        {view && <h3>{formatStaffDay(view.day)}</h3>}
        {selected ? <WindowInfo item={selected} /> : view && <>
          <p>{items.filter(item => availabilityTouchesDay(item, view.day)).length} khung giờ trong ngày. Không có bản ghi không đồng nghĩa với không khả dụng hay được nghỉ.</p>
          <div className="staff-availability-day-list">{items.filter(item => availabilityTouchesDay(item, view.day)).map(item => <Button key={item.id} variant="outline" data-staff-availability-day-slot={item.id} onClick={() => setView({ kind: "slot", day: view.day, id: item.id })}>#{item.id} · {formatStaffWindow(item.startsAt, item.endsAt)} · {availabilityStatus(item.status)}</Button>)}</div>
        </>}
      <DialogClose render={<Button variant="outline" aria-label="Đóng chi tiết lịch khả dụng" />}>Đóng</DialogClose>
    </DialogContent></Dialog>
  </div>
}
