"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { BellIcon, BellRingIcon, CheckIcon, EyeIcon, InfoIcon, KeyRoundIcon, LogOutIcon, MonitorIcon, RotateCcwIcon, ShieldCheckIcon, SmartphoneIcon, UserRoundIcon } from "lucide-react"
import { AreaLink as Link } from "@/components/shared/area-routes"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useStaffAuth } from "./staff-auth-session"
import { StaffEmpty, StaffPageHeader } from "./staff-shared"
import { useStaffDisplayPreferences } from "./staff-display-preferences"
import { createSettingsDemoAdapter } from "./staff-settings-demo-adapter"
import { SETTINGS_DISCLAIMER, SettingsDemoError, demoSettingsPreview, type DemoSettings, type SettingsDemoAdapter } from "./staff-settings-demo-model"
import { StaffAccountSettings } from "./staff-account-settings"

type DisplayPreferences = NonNullable<ReturnType<typeof useStaffDisplayPreferences>>

function LocalDisplayCard({ display }: { display: DisplayPreferences }) {
  const { preferences, persistence, ready, update, reset } = display
  return <Card data-staff-settings-local><CardContent>
    <header className="staff-settings-heading"><span><EyeIcon aria-hidden="true" /></span><div><h2>Giao diện và trợ năng</h2><p>Áp dụng ngay cho nội dung Staff trong trình duyệt này.</p></div><span className="staff-settings-local-tag">Lưu trên trình duyệt</span></header>
    <div className="staff-settings-browser-note"><MonitorIcon aria-hidden="true" /><p>Các tùy chọn được lưu trên trình duyệt này và dùng chung khi đổi tài khoản tại đây. Không đồng bộ với tài khoản hoặc thiết bị khác.</p></div>
    <div className="staff-settings-fields">
      <div className="ch-field"><label htmlFor="staff-display-motion">Chuyển động</label><select id="staff-display-motion" value={preferences.motion} disabled={!ready} aria-describedby="staff-display-motion-help" onChange={event => { if (event.target.value === "system" || event.target.value === "reduce") update({ ...preferences, motion: event.target.value }) }}><option value="system">Theo thiết bị</option><option value="reduce">Giảm chuyển động</option></select><p id="staff-display-motion-help">Giảm hiệu ứng chuyển cảnh và hoạt ảnh. Chế độ Theo thiết bị tôn trọng lựa chọn giảm chuyển động của hệ thống.</p></div>
      <div className="ch-field"><label htmlFor="staff-display-focus">Viền chọn bằng bàn phím</label><select id="staff-display-focus" value={preferences.focus} disabled={!ready} aria-describedby="staff-display-focus-help" onChange={event => { if (event.target.value === "standard" || event.target.value === "strong") update({ ...preferences, focus: event.target.value }) }}><option value="standard">Tiêu chuẩn</option><option value="strong">Rõ hơn</option></select><p id="staff-display-focus-help">Làm nổi bật liên kết, nút và ô nhập đang được chọn khi dùng bàn phím.</p></div>
    </div>
    <div className="staff-settings-save-row"><p data-display-persistence={ready ? persistence : "loading"} role={persistence === "temporary" && ready ? "alert" : "status"} aria-live="polite">{!ready ? "Đang đọc tùy chọn giao diện..." : persistence === "saved" ? "Đã lưu trên trình duyệt này." : persistence === "temporary" ? "Trình duyệt chưa cho phép lưu. Tùy chọn chỉ áp dụng cho lần mở hiện tại." : "Đang dùng tùy chọn mặc định."}</p><div>{ready && persistence === "temporary" && <Button variant="outline" onClick={() => update(preferences)}>Thử lưu lại</Button>}<Button variant="outline" disabled={!ready} onClick={reset}><RotateCcwIcon aria-hidden="true" />Khôi phục mặc định</Button></div></div>
  </CardContent></Card>
}

function SettingsDemoNotice() {
  return <div role="note" className="staff-settings-demo-notice"><InfoIcon aria-hidden="true" /><div><strong>DỮ LIỆU MINH HỌA</strong><p>Tùy chọn thông báo, hiển thị mở rộng và quyền riêng tư bên dưới chỉ có hiệu lực trong bản DEMO của phiên đang mở. Không đồng bộ tài khoản, không đổi quyền, mật khẩu, thiết bị hay bảo mật Backend. F5, rời trang hoặc đăng xuất sẽ đặt lại; mỗi tài khoản A/B có trạng thái riêng.</p></div></div>
}

function Toggle({ id, label, description, checked, disabled, onChange }: { id: string; label: string; description: string; checked: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  return <label className="staff-settings-toggle" htmlFor={id}><input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} aria-describedby={id + "-help"} onChange={event => onChange(event.target.checked)} /><span><strong>{label}</strong><span id={id + "-help"}>{description}</span></span></label>
}

function SettingsPreview({ settings }: { settings: DemoSettings }) {
  const preview = demoSettingsPreview(settings)
  return <div className={"staff-settings-preview staff-settings-preview-" + preview.density} data-settings-preview data-settings-preview-masked={preview.masked ? "true" : "false"}>
    <div className="staff-settings-preview-head"><span className="staff-settings-preview-avatar"><UserRoundIcon aria-hidden="true" /></span><div><strong data-settings-preview-name>{preview.name}</strong><p>{preview.referenceCode ? "Mã ca: " + preview.referenceCode : "Mã ca đang ẩn trong bản xem trước"}</p></div></div>
    <ul>{preview.notificationSummary.map(item => <li key={item}><CheckIcon aria-hidden="true" />{item}</li>)}</ul>
    <p className="staff-settings-preview-note">Xem trước DEMO; không phải hồ sơ, công việc hay thông báo thật.</p>
  </div>
}

function SettingsDemoPanel({ adapter }: { adapter: SettingsDemoAdapter }) {
  const [settings, setSettings] = useState<DemoSettings | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false)
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [retry, setRetry] = useState(0)
  const operation = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController(); operation.current = controller; setLoading(true); setSettings(null); setError("")
    void adapter.read(controller.signal).then(value => { if (!controller.signal.aborted) setSettings(value) }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof SettingsDemoError ? reason.message : "Chưa thể tải tùy chọn minh họa. Vui lòng thử lại.") }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort(); operation.current?.abort() }
  }, [adapter, retry])
  async function apply(next: DemoSettings) {
    if (busy || loading) return
    const controller = new AbortController(); operation.current = controller; setBusy(true); setError(""); setNotice("")
    try {
      const value = await adapter.update(next, controller.signal)
      if (controller.signal.aborted) return
      setSettings(value); setNotice("Đã áp dụng trong bản DEMO của phiên này. Không đồng bộ tài khoản.")
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof SettingsDemoError ? reason.message : "Chưa thể lưu tùy chọn minh họa.") }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  async function resetDemo() {
    if (busy || loading) return
    const controller = new AbortController(); operation.current = controller; setBusy(true); setError(""); setNotice("")
    try {
      const value = await adapter.reset(controller.signal)
      if (controller.signal.aborted) return
      setSettings(value); setNotice("Đã đặt lại tùy chọn minh họa của phiên đang mở.")
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof SettingsDemoError ? reason.message : "Chưa thể đặt lại tùy chọn minh họa.") }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  if (loading) return <Card className="staff-settings-demo-card" data-staff-settings-demo-panel><CardContent><header className="staff-settings-heading"><span><BellIcon aria-hidden="true" /></span><div><h2>Tùy chọn minh họa</h2><p>Thông báo, hiển thị mở rộng và quyền riêng tư trong phạm vi DEMO.</p></div><span className="staff-settings-demo-tag">DEMO</span></header><SettingsDemoNotice /><div role="status" aria-busy="true" className="staff-settings-demo-loading"><Skeleton className="h-8 w-56" /><Skeleton className="h-40 rounded-2xl" /><span>Đang tải tùy chọn minh họa...</span></div></CardContent></Card>
  if (!settings) return <Card className="staff-settings-demo-card"><CardContent><div role="alert" className="staff-settings-demo-error"><p>{error || "Chưa thể tải tùy chọn minh họa."}</p><Button variant="outline" onClick={() => setRetry(value => value + 1)}>Thử tải lại</Button></div></CardContent></Card>
  return <Card className="staff-settings-demo-card" data-staff-settings-demo-panel><CardContent>
    <header className="staff-settings-heading"><span><BellIcon aria-hidden="true" /></span><div><h2>Tùy chọn minh họa</h2><p>Thông báo, hiển thị mở rộng và quyền riêng tư trong phạm vi DEMO.</p></div><span className="staff-settings-demo-tag">DEMO</span></header>
    <SettingsDemoNotice />
    {notice && <p role="status" aria-live="polite" className="staff-settings-demo-feedback">{notice}</p>}
    {error && <div role="alert" className="staff-settings-demo-error"><p>{error}</p></div>}
    <div className="staff-settings-demo-grid">
      <fieldset className="staff-settings-fieldset"><legend><BellRingIcon aria-hidden="true" />Thông báo DEMO</legend><p>Chỉ thay đổi bản xem trước bên dưới; không bật push, email hay thông báo thật.</p>
        <Toggle id="staff-demo-notify-shift" label="Nhắc lịch ca làm" description="Hiện dòng nhắc ca trong bản xem trước DEMO." checked={settings.notifications.shiftReminder} disabled={busy} onChange={value => void apply({ ...settings, notifications: { ...settings.notifications, shiftReminder: value } })} />
        <Toggle id="staff-demo-notify-support" label="Cập nhật yêu cầu hỗ trợ" description="Hiện dòng cập nhật ticket DEMO trong bản xem trước." checked={settings.notifications.supportUpdates} disabled={busy} onChange={value => void apply({ ...settings, notifications: { ...settings.notifications, supportUpdates: value } })} />
        <Toggle id="staff-demo-notify-digest" label="Bản tin tuần" description="Hiện dòng bản tin tuần DEMO trong bản xem trước." checked={settings.notifications.weeklyDigest} disabled={busy} onChange={value => void apply({ ...settings, notifications: { ...settings.notifications, weeklyDigest: value } })} />
      </fieldset>
      <fieldset className="staff-settings-fieldset"><legend><EyeIcon aria-hidden="true" />Hiển thị DEMO</legend><p>Chỉ áp dụng cho thẻ xem trước; không đổi giao diện thật đang lưu trên trình duyệt.</p>
        <div className="ch-field"><label htmlFor="staff-demo-density">Mật độ thẻ xem trước</label><select id="staff-demo-density" value={settings.display.listDensity} disabled={busy} onChange={event => void apply({ ...settings, display: { ...settings.display, listDensity: event.target.value === "compact" ? "compact" : "comfortable" } })}><option value="comfortable">Thoải mái</option><option value="compact">Gọn</option></select></div>
        <Toggle id="staff-demo-show-code" label="Hiện mã ca DEMO" description="Hiện mã DEMO-CV-1042 trong thẻ xem trước." checked={settings.display.showReferenceCode} disabled={busy} onChange={value => void apply({ ...settings, display: { ...settings.display, showReferenceCode: value } })} />
      </fieldset>
      <fieldset className="staff-settings-fieldset"><legend><ShieldCheckIcon aria-hidden="true" />Quyền riêng tư DEMO</legend><p>Chỉ che nội dung trong bản xem trước; không ẩn dữ liệu thật hoặc thay đổi quyền tài khoản.</p>
        <Toggle id="staff-demo-mask-name" label="Che tên trong bản xem trước" description="Hiện tên viết tắt thay vì tên minh họa đầy đủ." checked={settings.privacy.maskPreviewName} disabled={busy} onChange={value => void apply({ ...settings, privacy: { ...settings.privacy, maskPreviewName: value } })} />
        <p className="staff-settings-fieldset-note">Không có tùy chọn đổi mật khẩu, thiết bị hay quyền tài khoản trong DEMO.</p>
      </fieldset>
    </div>
    <div className="staff-settings-preview-wrap"><div className="staff-settings-preview-label"><span>Xem trước DEMO</span><span>Không phải dữ liệu thật</span></div><SettingsPreview settings={settings} /></div>
    <div className="staff-settings-save-row"><p role="status" aria-live="polite">Thay đổi có hiệu lực ngay trong bản DEMO của phiên này.</p><div><Button variant="outline" disabled={busy} onClick={() => void resetDemo()}><RotateCcwIcon aria-hidden="true" />Đặt lại tùy chọn DEMO</Button></div></div>
    <p className="staff-settings-demo-footnote" role="note">{SETTINGS_DISCLAIMER}</p>
  </CardContent></Card>
}

function SettingsUnavailable() {
  return <Card data-staff-settings-unavailable><CardContent>
    <header className="staff-settings-heading"><span><BellIcon aria-hidden="true" /></span><div><h2>Tùy chọn thông báo, hiển thị mở rộng và quyền riêng tư</h2><p>Các tùy chọn cấp tài khoản cần API được duyệt.</p></div></header>
    <StaffEmpty title="Tùy chọn tài khoản chưa khả dụng" description="Thông báo, mật độ hiển thị mở rộng và quyền riêng tư cấp tài khoản chưa được cung cấp. Trang này không hiển thị tùy chọn minh họa khi DEMO đang tắt hoặc ngoài môi trường development." />
    <p className="staff-settings-demo-footnote" role="note">Thông báo, hiển thị và quyền riêng tư cấp tài khoản sẽ đồng bộ khi API tài khoản được cung cấp.</p>
  </CardContent></Card>
}

function AccountSecurityCard() {
  return <Card className="staff-settings-account" data-staff-settings-account><CardContent>
    <header className="staff-settings-heading"><span><ShieldCheckIcon aria-hidden="true" /></span><div><h2>Tài khoản và bảo mật</h2><p>Đăng xuất bằng menu tài khoản ở đầu trang. Không có thao tác bảo mật giả lập.</p></div></header>
    <ul className="staff-settings-unsupported">
      <li><KeyRoundIcon aria-hidden="true" /><div><strong>Đổi mật khẩu</strong><span>Chưa hỗ trợ. Không giả lập thay đổi mật khẩu hoặc ghi mật khẩu vào storage.</span></div></li>
      <li><SmartphoneIcon aria-hidden="true" /><div><strong>Thiết bị đăng nhập</strong><span>Chưa hỗ trợ. Không giả lập đăng xuất thiết bị khác hoặc thu hồi phiên.</span></div></li>
      <li><UserRoundIcon aria-hidden="true" /><div><strong>Quyền tài khoản</strong><span>Do người quản lý cấp. Không có API đổi quyền và không giả lập thay đổi quyền.</span></div></li>
      <li><LogOutIcon aria-hidden="true" /><div><strong>Đăng xuất</strong><span>Dùng menu tài khoản hiện có ở đầu trang; không triển khai lại Auth/Refresh.</span></div></li>
    </ul>
    <div className="staff-settings-account-actions"><Button variant="outline" render={<Link href="/ho-tro" />} nativeButton={false}>Mở Hỗ trợ</Button></div>
  </CardContent></Card>
}

function BoundSettings({ enabled, accountScope }: { enabled: boolean; accountScope: string }) {
  const adapter = useMemo(() => createSettingsDemoAdapter({ enabled, accountScope }), [enabled, accountScope])
  return adapter.kind === "unavailable" ? <SettingsUnavailable /> : <SettingsDemoPanel adapter={adapter} />
}

export function StaffSettings({ demoEnabled = false }: { demoEnabled?: boolean }) {
  const auth = useStaffAuth()
  const display = useStaffDisplayPreferences()
  const [logoutError, setLogoutError] = useState("")
  if (!auth || auth.status !== "authenticated" || !auth.session || auth.busy === "logout") return null
  if (!display) return null
  const accountScope = auth.session.user.id
  const canDemo = demoEnabled === true && process.env.NODE_ENV === "development" && /^[1-9]\d{0,18}$/.test(accountScope)
  if (!/^[1-9]\d{0,18}$/.test(accountScope) || BigInt(accountScope) > 9_223_372_036_854_775_807n) return <SettingsUnavailable />
  const logoutAccount = async () => { setLogoutError(""); const result = await auth.logout(); if (!result.ok) setLogoutError(result.message) }
  return <div data-staff-settings data-staff-settings-demo={canDemo ? "demo" : "unavailable"} className="staff-settings min-w-0 space-y-6">
    <StaffAccountSettings key={accountScope} session={auth.session} display={display} checkSession={auth.checkSession} onLogout={logoutAccount} logoutError={logoutError}>
      {canDemo && <details className="staff-account-legacy-demo"><summary>Tùy chọn minh họa (DEMO)</summary><BoundSettings key={accountScope} enabled={demoEnabled} accountScope={accountScope} /></details>}
    </StaffAccountSettings>
  </div>
}
