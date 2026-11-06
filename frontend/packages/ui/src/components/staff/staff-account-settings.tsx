"use client"

import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { BellIcon, CheckIcon, EyeIcon, KeyRoundIcon, LogOutIcon, PencilIcon, RotateCcwIcon, ShieldCheckIcon, SunIcon, UserRoundIcon } from "lucide-react"
import { AreaLink as Link } from "@/components/shared/area-routes"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { StaffPageHeader } from "./staff-shared"
import { parseStaffBranch, type StaffBranch } from "./staff-areas-remote-model"
import { useStaffDisplayPreferences } from "./staff-display-preferences"
import { useStaffNotificationView } from "./staff-notification-view-preferences"
import type { StaffSession } from "./staff-auth-session"

type Display = NonNullable<ReturnType<typeof useStaffDisplayPreferences>>
function Section({ id, title, description, icon, children, wide = false }: { id: string; title: string; description?: string; icon: ReactNode; children: ReactNode; wide?: boolean }) {
  return <Card id={id} className={wide ? "staff-account-card staff-account-card-wide" : "staff-account-card"}><CardContent><header className="staff-account-card-heading"><span className="staff-account-section-icon">{icon}</span><div><h2>{title}</h2>{description && <p>{description}</p>}</div></header>{children}</CardContent></Card>
}
async function readBranch(accountId: string, signal: AbortSignal): Promise<StaffBranch> {
  const response = await fetch("/api/staff/branch", { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal, headers: { Accept: "application/json", "X-Staff-Account-Id": accountId } })
  if (!response.ok) { await response.body?.cancel(); throw Object.assign(new Error("SETTINGS_READ_FAILED"), { status: response.status }) }
  if (!response.headers.get("Content-Type")?.startsWith("application/json")) throw Error("SETTINGS_INVALID_RESPONSE")
  const reader = response.body?.getReader(); if (!reader) throw Error("SETTINGS_INVALID_RESPONSE")
  const chunks: Uint8Array[] = []; let size = 0
  try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > 1048576) { await reader.cancel(); throw Error("SETTINGS_RESPONSE_TOO_LARGE") } chunks.push(next.value) } } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  const branch = parseStaffBranch(JSON.parse(new TextDecoder().decode(bytes)))
  if (!branch) throw Error("SETTINGS_INVALID_RESPONSE")
  return branch.data
}
function ProfileCard({ accountId, onSessionCheck }: { accountId: string; onSessionCheck: () => Promise<void> }) {
  const [branch, setBranch] = useState<StaffBranch | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(""), [retry, setRetry] = useState(0), [edit, setEdit] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null), id = useId()
  useEffect(() => {
    const controller = new AbortController(); let timedOut = false
    const timer = window.setTimeout(() => { timedOut = true; controller.abort() }, 15000)
    setLoading(true); setError("")
    void readBranch(accountId, controller.signal).then(value => { if (!controller.signal.aborted) setBranch(value) }).catch(reason => {
      if (controller.signal.aborted && !timedOut) return
      const status = reason && typeof reason === "object" ? reason.status : null
      setError(status === 409 ? "Tài khoản đã thay đổi. Tải lại trang để xem đúng thông tin." : status === 404 ? "Chưa có chi nhánh được phân công. Liên hệ người quản lý." : "Chưa tải được thông tin chi nhánh. Vui lòng thử lại.")
      if (status === 401 || status === 403) void onSessionCheck()
    }).finally(() => { window.clearTimeout(timer); if (!controller.signal.aborted || timedOut) setLoading(false) })
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [accountId, retry, onSessionCheck])
  return <Section id="staff-settings-profile" title="Thông tin cá nhân" description="Thông tin tài khoản và nơi làm việc của bạn." icon={<UserRoundIcon aria-hidden="true" />} wide>
    <div className="staff-account-profile-top"><span className="staff-account-avatar" role="img" aria-label="Chưa có ảnh đại diện"><UserRoundIcon aria-hidden="true" /></span><div><strong>Ảnh đại diện</strong><p>Chưa được cung cấp</p></div><Button ref={trigger} variant="outline" data-staff-settings-edit onClick={() => setEdit(true)}><PencilIcon aria-hidden="true" />Chỉnh sửa thông tin</Button></div>
    <dl className="staff-account-profile-fields"><div><dt>Họ và tên</dt><dd data-account-field="name">Chưa được cung cấp</dd></div><div><dt>Số điện thoại</dt><dd data-account-field="phone">Chưa được cung cấp</dd></div><div><dt>Email</dt><dd data-account-field="email">Chưa được cung cấp</dd></div><div><dt>Chi nhánh</dt><dd data-staff-settings-branch={loading ? "loading" : error ? "error" : "ready"} data-staff-settings-branch-id={branch?.id}>{loading && !branch ? <span role="status" aria-busy="true">Đang tải chi nhánh...</span> : branch?.name || "Chưa được cung cấp"}</dd></div></dl>
    {error && <div className="staff-account-error" role="alert"><p>{error}</p><Button variant="outline" disabled={loading} data-staff-settings-retry onClick={() => setRetry(value => value + 1)}>Thử lại</Button></div>}
    <p className="staff-account-note">Chỉnh sửa thông tin chưa khả dụng. Liên hệ người quản lý nếu cần cập nhật hồ sơ.</p>
    <Dialog open={edit} onOpenChange={setEdit}><DialogContent showCloseButton={false} finalFocus={trigger} className="staff-preference-surface staff-account-dialog" data-staff-settings-profile-dialog><DialogHeader><DialogTitle>Chỉnh sửa thông tin</DialogTitle><DialogDescription>Chức năng cập nhật hồ sơ chưa khả dụng. Thông tin hiện tại được giữ nguyên.</DialogDescription></DialogHeader>
      <form onSubmit={event => event.preventDefault()}><fieldset disabled className="staff-account-form"><label htmlFor={`${id}-name`}>Họ và tên<input id={`${id}-name`} name="profile-name" value="" readOnly placeholder="Chưa được cung cấp" autoComplete="off" /></label><label htmlFor={`${id}-phone`}>Số điện thoại<input id={`${id}-phone`} name="profile-phone" value="" readOnly placeholder="Chưa được cung cấp" autoComplete="off" /></label><label htmlFor={`${id}-email`}>Email<input id={`${id}-email`} name="profile-email" type="email" value="" readOnly placeholder="Chưa được cung cấp" autoComplete="off" /></label></fieldset><div className="staff-account-actions"><DialogClose render={<Button variant="outline" />}>Hủy</DialogClose><Button disabled type="submit" data-staff-settings-profile-save>Lưu thay đổi</Button></div></form>
    </DialogContent></Dialog>
  </Section>
}

export function StaffAccountSettings({ session, display, checkSession, onLogout, logoutError, children }: { session: StaffSession; display: Display; checkSession: () => Promise<void>; onLogout: () => Promise<void>; logoutError: string; children?: ReactNode }) {
  const notifications = useStaffNotificationView(session.user.id)
  const [confirm, setConfirm] = useState<"logout" | "display" | "notifications" | null>(null)
  const confirmTrigger = useRef<HTMLButtonElement>(null), id = useId()
  const openConfirm = (kind: "logout" | "display" | "notifications", trigger: HTMLButtonElement) => { confirmTrigger.current = trigger; setConfirm(kind) }
  const persistenceText = (ready: boolean, value: string) => !ready ? "Đang đọc tùy chọn..." : value === "temporary" ? "Chưa thể lưu trên thiết bị. Lựa chọn chỉ áp dụng tạm thời; bạn có thể thử lưu lại." : value === "saved" ? "Đã lưu trên thiết bị này." : "Đang dùng mặc định."
  return <div className="staff-settings staff-account-settings" data-staff-settings-account-page>
    <StaffPageHeader title="Cài đặt tài khoản" description="Quản lý hồ sơ, bảo mật và trải nghiệm của bạn." />
    {logoutError && <div className="staff-account-error" role="alert">{logoutError}</div>}
    <nav className="staff-account-section-nav" aria-label="Các nhóm cài đặt"><a href="#staff-settings-profile">Cá nhân</a><a href="#staff-settings-security">Bảo mật</a><a href="#staff-settings-notifications">Thông báo</a><a href="#staff-settings-display">Giao diện</a><a href="#staff-settings-privacy">Quyền riêng tư</a></nav>
    <div className="staff-account-grid">
      <ProfileCard accountId={session.user.id} onSessionCheck={checkSession} />
      <Section id="staff-settings-security" title="Bảo mật tài khoản" icon={<ShieldCheckIcon aria-hidden="true" />}>
        <details className="staff-account-password"><summary><KeyRoundIcon aria-hidden="true" />Đổi mật khẩu<span>Chưa khả dụng</span></summary><p>Liên hệ người quản lý khi cần hỗ trợ mật khẩu.</p><fieldset disabled className="staff-account-form" data-staff-settings-password>
          <label htmlFor={`${id}-current`}>Mật khẩu hiện tại<input id={`${id}-current`} name="current-password" type="password" autoComplete="current-password" value="" readOnly /></label><label htmlFor={`${id}-new`}>Mật khẩu mới<input id={`${id}-new`} name="new-password" type="password" autoComplete="new-password" value="" readOnly /></label><label htmlFor={`${id}-repeat`}>Xác nhận mật khẩu mới<input id={`${id}-repeat`} name="confirm-password" type="password" autoComplete="new-password" value="" readOnly /></label><Button disabled>Đổi mật khẩu</Button>
        </fieldset></details>
        <p className="staff-account-note">Quản lý thiết bị đăng nhập chưa được hỗ trợ.</p>
        <div className="staff-account-security-session"><span><strong>Phiên hiện tại</strong><small>Đăng xuất khỏi phiên đang dùng.</small></span><Button variant="outline" data-staff-settings-logout onClick={event => openConfirm("logout", event.currentTarget)}><LogOutIcon aria-hidden="true" />Đăng xuất</Button></div>
      </Section>
      <Section id="staff-settings-notifications" title="Tùy chọn thông báo" icon={<BellIcon aria-hidden="true" />}>
        <span className="staff-account-local-tag">Chỉ lưu trên thiết bị này</span>
        <label className="staff-account-switch" htmlFor={`${id}-unread`}><span><strong>Ưu tiên thông báo chưa đọc</strong><small>Mở trang Thông báo với bộ lọc Chưa đọc.</small></span><input id={`${id}-unread`} name="notification-unread-default" type="checkbox" role="switch" disabled={!notifications.ready} checked={notifications.unreadOnly} onChange={event => notifications.update(event.target.checked)} /></label>
        <p className="staff-account-note">Riêng cho tài khoản này trên thiết bị này. Không thay đổi việc gửi thông báo, email hoặc thông báo đẩy.</p>
        <p role={notifications.persistence === "temporary" ? "alert" : "status"} data-staff-notification-persistence={notifications.persistence}>{persistenceText(notifications.ready, notifications.persistence)}</p>
        <div className="staff-account-actions">{notifications.persistence === "temporary" && <Button variant="outline" onClick={() => notifications.update(notifications.unreadOnly)}>Thử lưu lại</Button>}<Button variant="outline" disabled={!notifications.ready} onClick={event => openConfirm("notifications", event.currentTarget)}>Đặt lại bộ lọc</Button><Button variant="outline" render={<Link href="/thong-bao" />} nativeButton={false}>Mở Thông báo</Button></div>
      </Section>
      <Section id="staff-settings-display" title="Giao diện & trợ năng" icon={<EyeIcon aria-hidden="true" />} wide>
        <span className="staff-account-local-tag">Chỉ lưu trên thiết bị này</span>
        <div className="staff-account-light"><SunIcon aria-hidden="true" /><div><strong>Giao diện sáng</strong><p>Chế độ tối chưa khả dụng.</p></div><span><CheckIcon aria-hidden="true" />Đang sử dụng</span></div>
        <div className="staff-account-display-fields"><label htmlFor="staff-display-motion">Hiệu ứng chuyển động<select id="staff-display-motion" disabled={!display.ready} value={display.preferences.motion} onChange={event => display.update({ ...display.preferences, motion: event.target.value as "system" | "reduce" })}><option value="system">Theo cài đặt thiết bị</option><option value="reduce">Giảm chuyển động</option></select></label><label htmlFor="staff-display-focus">Viền focus bàn phím<select id="staff-display-focus" disabled={!display.ready} value={display.preferences.focus} onChange={event => display.update({ ...display.preferences, focus: event.target.value as "standard" | "strong" })}><option value="standard">Tiêu chuẩn</option><option value="strong">Nổi bật</option></select></label></div>
        <p className="staff-account-note">Áp dụng ngay và dùng chung cho các tài khoản trên trình duyệt này.</p>
        <div className="staff-account-display-footer"><p role={display.persistence === "temporary" ? "alert" : "status"} data-display-persistence={display.persistence}>{persistenceText(display.ready, display.persistence)}</p><div className="staff-account-actions">{display.persistence === "temporary" && <Button variant="outline" onClick={() => display.update(display.preferences)}>Thử lưu lại</Button>}<Button disabled={!display.ready} variant="outline" onClick={event => openConfirm("display", event.currentTarget)}><RotateCcwIcon aria-hidden="true" />Khôi phục mặc định</Button></div></div>
      </Section>
      <Section id="staff-settings-privacy" title="Quyền riêng tư & hỗ trợ" icon={<ShieldCheckIcon aria-hidden="true" />} wide>
        <dl className="staff-account-permissions"><div><dt>Quyền tài khoản</dt><dd>Nhân viên</dd></div><div><dt>Trạng thái</dt><dd>Đang hoạt động</dd></div><div><dt>Mã tài khoản</dt><dd>{session.user.id}</dd></div></dl>
        <p className="staff-account-note">Quyền truy cập do người quản lý cấp. Chỉ tài khoản đang đăng nhập được xem dữ liệu của mình.</p><Button variant="outline" render={<Link href="/ho-tro" />} nativeButton={false}>Đến trang Hỗ trợ</Button>
      </Section>
    </div>
    {children}
    <Dialog open={!!confirm} onOpenChange={value => { if (!value) setConfirm(null) }}><DialogContent showCloseButton={false} finalFocus={confirmTrigger} className="staff-preference-surface staff-account-dialog" data-staff-settings-confirm={confirm || undefined}><DialogHeader><DialogTitle>{confirm === "logout" ? "Đăng xuất tài khoản?" : "Khôi phục lựa chọn mặc định?"}</DialogTitle><DialogDescription>{confirm === "logout" ? "Phiên hiện tại sẽ được đóng. Bạn cần đăng nhập lại để tiếp tục." : confirm === "notifications" ? "Chỉ đặt lại bộ lọc Thông báo của tài khoản này trên thiết bị này." : "Đặt lại hiệu ứng và viền focus. Các thông tin tài khoản được giữ nguyên."}</DialogDescription></DialogHeader><div className="staff-account-actions"><DialogClose render={<Button variant="outline" />}>Hủy</DialogClose><Button data-staff-settings-confirm-action onClick={() => { const action = confirm; setConfirm(null); if (action === "logout") void onLogout(); else if (action === "display") display.reset(); else notifications.reset() }}>{confirm === "logout" ? "Đăng xuất" : "Khôi phục mặc định"}</Button></div></DialogContent></Dialog>
  </div>
}
