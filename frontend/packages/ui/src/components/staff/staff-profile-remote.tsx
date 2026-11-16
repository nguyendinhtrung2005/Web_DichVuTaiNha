"use client"

import { ArrowRightIcon, ChartNoAxesColumnIcon, CalendarDaysIcon, ClipboardListIcon, CircleHelpIcon, HistoryIcon, SettingsIcon, ShieldCheckIcon, UserRoundIcon, WalletCardsIcon, MapPinIcon, AwardIcon } from "lucide-react"
import { AreaLink as Link } from "@/components/shared/area-routes"
import { ToneBadge } from "@/components/shared/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useStaffAuth } from "./staff-auth-session"
import { StaffEmpty, StaffPageHeader } from "./staff-shared"
import { StaffProfileDemo } from "./staff-profile-demo"

/** Public account identity only; employee profile fields need a separate approved contract. */
export function StaffProfileRemote({ demoEnabled = false }: { demoEnabled?: boolean } = {}) {
  const auth = useStaffAuth()
  if (!auth || auth.status !== "authenticated" || !auth.session || auth.busy === "logout") return null
  const { user } = auth.session

  return <div className="staff-profile min-w-0 space-y-6" data-staff-profile data-profile-account-id={user.id}>
    <StaffPageHeader title="Hồ sơ cá nhân" description="Thông tin tài khoản và công việc của bạn tại CleanHome." />
    <Card className="staff-profile-summary">
      <CardContent><span className="staff-profile-symbol"><UserRoundIcon aria-hidden="true" /></span><div className="staff-profile-summary-copy"><p className="staff-eyebrow">Không gian cá nhân</p><h2>Nhân viên CleanHome</h2><p>Theo dõi thông tin của bạn, sẵn sàng cho mỗi ngày làm việc.</p></div><ToneBadge tone="success">Tài khoản đang hoạt động</ToneBadge></CardContent>
    </Card>
    <div className="staff-profile-grid">
      <div className="staff-profile-information">
        <Card className="staff-profile-account">
          <CardContent><header className="staff-profile-section-heading"><span><ShieldCheckIcon aria-hidden="true" /></span><div><h2>Thông tin tài khoản</h2><p>Thông tin từ tài khoản bạn đang đăng nhập.</p></div></header>
            <dl className="staff-profile-fields"><div><dt>Mã tài khoản</dt><dd data-profile-field="account-id">{user.id}</dd></div><div><dt>Vai trò</dt><dd data-profile-field="role">Nhân viên</dd></div><div><dt>Trạng thái tài khoản</dt><dd data-profile-field="status">Đang hoạt động</dd></div></dl>
          </CardContent>
        </Card>
        {demoEnabled && process.env.NODE_ENV === "development" ? <StaffProfileDemo key={user.id} enabled={demoEnabled} accountScope={user.id} /> : <section className="staff-profile-missing" aria-label="Thông tin hồ sơ nhân viên">
          <StaffEmpty title="Chưa có thông tin hồ sơ" description="Thông tin cá nhân, chi nhánh, kỹ năng và chứng chỉ hiện chưa được cung cấp. Vui lòng liên hệ người quản lý khi cần hỗ trợ." />
        </section>}
      </div>
      <aside className="staff-profile-aside" aria-label="Lối tắt cá nhân">
        <Card><CardContent><header className="staff-profile-section-heading"><div><h2>Lối tắt cá nhân</h2><p>Công việc, lịch sử và các mục dành cho bạn.</p></div></header>
          <nav aria-label="Đi đến công việc và lịch" className="staff-profile-shortcuts">
            <Button variant="outline" render={<Link href="/cong-viec" />} nativeButton={false}><ClipboardListIcon aria-hidden="true" /><span><strong>Công việc</strong><span>Xem danh sách được phân công</span></span><ArrowRightIcon aria-hidden="true" /></Button>
            <Button variant="outline" render={<Link href="/lich-lam-viec" />} nativeButton={false}><CalendarDaysIcon aria-hidden="true" /><span><strong>Lịch làm việc</strong><span>Theo dõi lịch hẹn của bạn</span></span><ArrowRightIcon aria-hidden="true" /></Button>
            <Button variant="outline" render={<Link href="/lich-su" />} nativeButton={false}><HistoryIcon aria-hidden="true" /><span><strong>Lịch sử công việc</strong><span>Xem các phân công đã hoàn thành</span></span><ArrowRightIcon aria-hidden="true" /></Button>
            <Button variant="outline" render={<Link href="/thong-ke-cong-viec" />} nativeButton={false}><ChartNoAxesColumnIcon aria-hidden="true" /><span><strong>Thống kê công việc</strong><span>Phân công theo khoảng lịch hẹn</span></span><ArrowRightIcon aria-hidden="true" /></Button>
            <Button variant="outline" render={<Link href="/thu-nhap" />} nativeButton={false}><WalletCardsIcon aria-hidden="true" /><span><strong>Thu nhập</strong><span>Xem thống kê và bảng kê thu nhập</span></span><ArrowRightIcon aria-hidden="true" /></Button>
            <Button variant="outline" render={<Link href="/khu-vuc" />} nativeButton={false}><MapPinIcon aria-hidden="true" /><span><strong>Khu vực & ca làm</strong><span>Xem khu vực và trải nghiệm lịch ca</span></span><ArrowRightIcon aria-hidden="true" /></Button>
            <Button variant="outline" render={<Link href="/thanh-tich" />} nativeButton={false}><AwardIcon aria-hidden="true" /><span><strong>Thành tích & đánh giá</strong><span>Xem đánh giá và thành tích minh họa</span></span><ArrowRightIcon aria-hidden="true" /></Button>
            <Button variant="outline" render={<Link href="/ho-tro" />} nativeButton={false}><CircleHelpIcon aria-hidden="true" /><span><strong>Hỗ trợ</strong><span>Thông tin trợ giúp và liên hệ</span></span><ArrowRightIcon aria-hidden="true" /></Button>
            <Button variant="outline" render={<Link href="/cai-dat" />} nativeButton={false}><SettingsIcon aria-hidden="true" /><span><strong>Cài đặt</strong><span>Tùy chọn giao diện trình duyệt</span></span><ArrowRightIcon aria-hidden="true" /></Button>
          </nav>
        </CardContent></Card>
        <div className="staff-profile-help"><ShieldCheckIcon aria-hidden="true" /><div><h2>Quản lý tài khoản</h2><p>Cần cập nhật thông tin? Vui lòng liên hệ người quản lý.</p><p>Bạn có thể đăng xuất từ menu tài khoản ở đầu trang.</p></div></div>
      </aside>
    </div>
  </div>
}
