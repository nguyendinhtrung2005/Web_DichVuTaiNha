"use client"

import { ArrowRightIcon, BellOffIcon, CalendarDaysIcon, ClipboardListIcon } from "lucide-react"
import { AreaLink as Link } from "@/components/shared/area-routes"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { StaffPageHeader } from "./staff-shared"

/** No Staff notifications contract is available; this view does not request or invent read state. */
export function StaffNotificationsUnavailable() {
  return <div data-staff-notifications className="staff-notifications min-w-0 space-y-6">
    <StaffPageHeader title="Thông báo" description="Thông tin dành cho công việc của bạn." />
    <Card className="staff-notifications-panel" aria-labelledby="staff-notifications-title">
      <CardContent>
        <span className="staff-notifications-symbol"><BellOffIcon aria-hidden="true" /></span>
        <h2 id="staff-notifications-title">Thông báo chưa khả dụng</h2>
        <p>Thông báo chưa được cung cấp trong không gian nhân viên. Bạn có thể tiếp tục theo dõi công việc và lịch làm việc của mình.</p>
        <nav aria-label="Tiếp tục công việc" className="staff-notifications-actions">
          <Button render={<Link href="/cong-viec" />} nativeButton={false}><ClipboardListIcon aria-hidden="true" />Xem công việc<ArrowRightIcon aria-hidden="true" /></Button>
          <Button variant="outline" render={<Link href="/lich-lam-viec" />} nativeButton={false}><CalendarDaysIcon aria-hidden="true" />Xem lịch làm việc<ArrowRightIcon aria-hidden="true" /></Button>
        </nav>
      </CardContent>
    </Card>
  </div>
}
