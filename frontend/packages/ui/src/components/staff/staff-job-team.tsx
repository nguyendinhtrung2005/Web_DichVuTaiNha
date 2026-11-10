"use client"

import { useId } from "react"
import { InfoIcon, UsersRoundIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AreaLink } from "@/components/shared/area-routes"
import { staffTeamPresentation, staffTeamProgress, type StaffTeam } from "./staff-team-model"

const labels = { ASSIGNED: "Chờ tiếp nhận", ACCEPTED: "Đã tiếp nhận", IN_PROGRESS: "Đang thực hiện", DONE: "Đã hoàn thành phần việc", CANCELLED: "Đã hủy phân công" }
const bookingLabels: Record<string, string> = { pending: "Chờ xác nhận", confirmed: "Đã xác nhận", in_progress: "Đang thực hiện", completed: "Đã hoàn thành", cancelled: "Đã hủy" }

export function StaffJobTeam({ team, teamError, personalStatus, bookingStatus, bookingId, services = [], onRetry }: {
  team?: StaffTeam | null; teamError?: string; personalStatus: string; bookingStatus: string | null; bookingId?: string; services?: readonly string[]; onRetry: () => void
}) {
  const id = useId(), view = staffTeamPresentation(team, personalStatus, bookingStatus), progress = staffTeamProgress(team, personalStatus, bookingStatus)
  const ownStatus = personalStatus === "WAITING" ? "ASSIGNED" : personalStatus
  return <section className="staff-team" aria-labelledby={id} data-staff-team data-team-state={teamError ? "error" : view.code}>
    <header className="staff-team-heading"><div><UsersRoundIcon aria-hidden="true" /><h2 id={id}>Đội thực hiện</h2></div>{team?.packageName && <span>{team.packageName}</span>}<Button variant="outline" onClick={onRetry}>Cập nhật đội</Button></header>
    {(bookingId || team?.bookingId) && <p className="staff-team-reference">Đơn dịch vụ <strong>#{bookingId || team?.bookingId}</strong>{services.length > 0 && <span> · {services.filter(name => name.trim()).join(" · ")}</span>}</p>}
    <div className="staff-team-statuses"><p>Phần việc của bạn: <strong>{labels[ownStatus as keyof typeof labels] || "Chưa có thông tin"}</strong></p><p>Đơn dịch vụ: <strong>{bookingStatus ? bookingLabels[bookingStatus] || "Chưa có thông tin" : "Chưa có thông tin"}</strong></p></div>
    {teamError ? <div role="alert" className="staff-team-notice"><p>Chưa tải được đội thực hiện. Thông tin công việc vẫn có thể xem.</p><Button variant="outline" onClick={onRetry}>Thử tải đội lại</Button></div> : <>
      <div className="staff-team-state" role="status"><strong>{view.title}</strong><p>{view.message}</p></div>
      {team ? <>
        <dl className="staff-team-counts">
          <div><dt>Nhân viên bắt buộc</dt><dd>{team.requiredStaffCount ?? "Chưa xác nhận"}</dd></div>
          <div><dt>Đã phân công</dt><dd>{team.counts.assigned}</dd></div>
          <div><dt>Đã tiếp nhận</dt><dd>{team.counts.accepted}{team.requiredStaffCount !== null && <span>/{team.requiredStaffCount}</span>}</dd></div>
          <div><dt>Đang thực hiện</dt><dd data-team-in-progress={progress.inProgressCount ?? undefined}>{progress.inProgressCount}</dd></div>
          <div><dt>Đã hoàn thành</dt><dd>{team.counts.completed}</dd></div>
        </dl>
        <p className="staff-team-muted">Đã tiếp nhận gồm cả người đang làm và đã hoàn thành. Đang thực hiện không gồm người đã hoàn thành.</p>
        {team.counts.assigned > 0 && <div className="staff-team-progress"><label htmlFor={`${id}-progress`}>Tiến độ nhân viên đã phân công <strong>{team.counts.completed}/{team.counts.assigned}</strong></label><progress id={`${id}-progress`} max={team.counts.assigned} value={team.counts.completed} /><p>Tiến độ này không thay thế xác nhận hoàn thành đơn.</p></div>}
        {team.requiredStaffCount === null && view.code !== "unconfirmed" && <p className="staff-team-policy-note"><InfoIcon aria-hidden="true" />Chưa có thông tin số nhân viên yêu cầu.</p>}
        {team.counts.cancelled > 0 && <p className="staff-team-muted">Có {team.counts.cancelled} nhân viên có phân công đã hủy; không tính là hoàn thành.</p>}
        <details className="staff-team-members"><summary>Thành viên và trạng thái được phép xem</summary><ul>{team.members.map(member => <li key={member.assignmentId}><span>{member.isSelf ? "Bạn" : member.displayName || "Thành viên"}</span><strong>{labels[member.status]}</strong></li>)}</ul>{team.memberVisibility === "SELF_ONLY" && <p>Danh sách đồng đội chưa được cấp quyền hiển thị.</p>}</details>
      </> : <p className="staff-team-muted">Số nhân viên và danh sách đội chưa được cung cấp. Không suy ra từ khối lượng dịch vụ.</p>}
    </>}
    {(view.code === "admin-required" || (team?.counts.cancelled ?? 0) > 0) && <p className="staff-team-help">Cần kiểm tra phân công hoặc thay người? <AreaLink href="/ho-tro">Mở Hỗ trợ để xem cách liên hệ Admin</AreaLink>.</p>}
  </section>
}
