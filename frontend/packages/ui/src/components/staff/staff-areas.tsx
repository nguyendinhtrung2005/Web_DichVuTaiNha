"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { CalendarDaysIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, ClockIcon, InfoIcon, MapPinIcon, RotateCcwIcon } from "lucide-react"
import { AreaLink as Link } from "@/components/shared/area-routes"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useStaffAuth } from "./staff-auth-session"
import { useStaffDisplayPreferences } from "./staff-display-preferences"
import { StaffEmpty, StaffPageHeader } from "./staff-shared"
import { StaffAreasRemote } from "./staff-areas-remote"
import { StaffBranchMap } from "./staff-branch-map"
import type { StaffMapsConfig } from "./staff-maps-model"
import { createAreasDemoAdapter } from "./staff-areas-demo-adapter"
import { AreasDemoError, addDays, formatDay, formatShiftTime, vietnamDate, weekStart, type AreaPreferences, type AreasDemoAdapter, type AreasSnapshot, type DemoShift } from "./staff-areas-demo-model"

function DemoNotice({ compact = false }: { compact?: boolean }) {
  return <div role="note" className="staff-areas-notice"><InfoIcon aria-hidden="true" /><div><strong>DỮ LIỆU MINH HỌA</strong><p>{compact ? "Ca và thao tác chỉ thuộc bản minh họa, không cập nhật phân công hay lịch hẹn thật." : "Khu vực, ca làm và trạng thái sẵn sàng hoàn toàn giả lập, tách riêng từng tài khoản. Không ảnh hưởng việc nhận công việc thật. Chỉ giữ tạm khi mở trang; F5, rời trang hoặc đăng xuất sẽ đặt lại DEMO."}</p></div></div>
}
export function StaffAreasUnavailable() {
  return <div className="min-w-0 space-y-6" data-staff-areas-unavailable><StaffPageHeader title="Khu vực & ca làm" description="Khu vực phục vụ và ca làm việc của bạn." /><StaffEmpty title="Khu vực & ca làm chưa khả dụng" description="Chưa có API khu vực phục vụ và lịch sẵn sàng. Vui lòng liên hệ người quản lý khi cần hỗ trợ." action={<Button variant="outline" render={<Link href="/ho-so" />} nativeButton={false}>Về Cá nhân</Button>} /></div>
}
export function StaffAreas({ demoEnabled = false, mapsConfig = null }: { demoEnabled?: boolean; mapsConfig?: StaffMapsConfig | null }) {
  const auth = useStaffAuth()
  if (!auth || auth.status !== "authenticated" || !auth.session || auth.busy === "logout") return null
  const accountId = auth.session.user.id
  if (!/^[1-9]\d{0,18}$/.test(accountId) || BigInt(accountId) > 9_223_372_036_854_775_807n) return <StaffAreasUnavailable />
  if (demoEnabled && process.env.NODE_ENV === "development") return <div className="space-y-6"><BoundAreas key={accountId} enabled={demoEnabled} accountScope={accountId} /><StaffBranchMap config={mapsConfig} latitude={null} longitude={null} serviceArea={null} branchName={null} /></div>
  return <StaffAreasRemote key={accountId} accountId={accountId} mapsConfig={mapsConfig} />
}
function BoundAreas({ enabled, accountScope }: { enabled: boolean; accountScope: string }) {
  const adapter = useMemo(() => createAreasDemoAdapter({ enabled, accountScope }), [enabled, accountScope])
  return adapter.kind === "unavailable" ? <StaffAreasUnavailable /> : <AreasPanel adapter={adapter} />
}
function checkedViewDate(value: string): string {
  const from = weekStart(value); addDays(from, 6)
  if (value < "1971-01-04" || value > "2099-12-27") throw new AreasDemoError("Chọn ngày minh họa từ 04/01/1971 đến 27/12/2099 để hiển thị trọn tuần.")
  return value
}
const clonePreferences = (value: AreaPreferences): AreaPreferences => ({ selectedAreaIds: [...value.selectedAreaIds], available: value.available })
const statusLabels = { OPEN: "Đang mở", FULL: "Đã đủ chỗ minh họa", CANCELLED: "Đã hủy minh họa" }
function failure(error: unknown): string { return error instanceof AreasDemoError ? error.message : "Chưa thể xử lý bản minh họa. Vui lòng thử lại." }
function ShiftDetail({ adapter, id, weekFrom, snapshot, version, busy, dirty, actionError, actionNotice, onClose, onChange }: { adapter: AreasDemoAdapter; id: string | null; weekFrom: string; snapshot: AreasSnapshot | null; version: number; busy: boolean; dirty: boolean; actionError: string; actionNotice: string; onClose: () => void; onChange: (action: "register" | "cancel", id: string) => void }) {
  const [item, setItem] = useState<DemoShift | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(""), [retry, setRetry] = useState(0)
  const display = useStaffDisplayPreferences()
  useEffect(() => {
    if (!id) return
    const controller = new AbortController(); setLoading(true); setItem(null); setError("")
    void adapter.detail(id, weekFrom, controller.signal).then(value => { if (!controller.signal.aborted) setItem(value) }).catch(error => { if (!controller.signal.aborted) setError(failure(error)) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [adapter, id, weekFrom, version, retry])
  const registered = !!id && !!snapshot?.registeredShiftIds.includes(id)
  const selected = !!item && !!snapshot?.preferences.selectedAreaIds.includes(item.areaId)
  const future = !!item && Date.parse(item.startAt) > Date.now()
  return <Dialog open={!!id} onOpenChange={open => { if (!open) onClose() }}><DialogContent showCloseButton={false} className="staff-preference-surface staff-areas-dialog" data-staff-motion={display?.preferences.motion || "system"} data-staff-focus={display?.preferences.focus || "standard"} data-area-shift-detail data-area-shift-detail-id={id || undefined}><DialogHeader><DialogTitle>Chi tiết ca minh họa</DialogTitle><DialogDescription>Thông tin ca và đăng ký chỉ có hiệu lực trong bản DEMO đang mở.</DialogDescription></DialogHeader><DemoNotice compact />{actionError && <p role="alert" className="staff-areas-error">{actionError}</p>}{actionNotice && <p role="status" className="staff-areas-feedback">{actionNotice}</p>}
    {loading ? <p role="status" aria-busy="true">Đang mở ca minh họa...</p> : error ? <div role="alert"><p>{error}</p><Button variant="outline" onClick={() => setRetry(value => value + 1)}>Thử lại</Button></div> : !item ? <p role="status">Không tìm thấy ca minh họa này.</p> : <><h3>{item.label} · {formatDay(item.date)}</h3><dl className="staff-areas-detail-fields"><div><dt>Khu vực minh họa</dt><dd>{snapshot?.areas.find(area => area.id === item.areaId)?.name || "Chưa có thông tin"}</dd></div><div><dt>Khung giờ Việt Nam</dt><dd><time dateTime={item.startAt}>{formatShiftTime(item.startAt)}</time>–<time dateTime={item.endAt}>{formatShiftTime(item.endAt)}</time> (UTC+7)</dd></div><div><dt>Trạng thái ca</dt><dd>{statusLabels[item.status]}</dd></div><div><dt>Đăng ký của bạn</dt><dd>{registered ? "Đã đăng ký minh họa" : "Chưa đăng ký"}</dd></div></dl><p className="staff-areas-muted">Giả định DEMO: chỉ đăng ký ca mở chưa bắt đầu trong khu vực đã lưu; không trùng giờ giữa các khu vực. Trạng thái sẵn sàng không phải điều kiện nhận việc thật.</p><Button disabled={busy || dirty || !future || !registered && (!selected || item.status !== "OPEN")} aria-label={(registered ? "Hủy đăng ký ca " : "Đăng ký ca ") + item.id} onClick={() => onChange(registered ? "cancel" : "register", item.id)}>{registered ? "Hủy đăng ký minh họa" : "Đăng ký minh họa"}</Button></>}
    <DialogClose render={<Button variant="outline" aria-label="Đóng chi tiết ca" />} onClick={onClose}>Đóng chi tiết</DialogClose>
  </DialogContent></Dialog>
}
function AreasPanel({ adapter }: { adapter: AreasDemoAdapter }) {
  const [date, setDate] = useState(() => vietnamDate(new Date())), [mode, setMode] = useState<"day" | "week">("day"), [filter, setFilter] = useState("all")
  const [snapshot, setSnapshot] = useState<AreasSnapshot | null>(null), [draft, setDraft] = useState<AreaPreferences | null>(null), [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [retry, setRetry] = useState(0), [version, setVersion] = useState(0)
  const operation = useRef<AbortController | null>(null), mutation = useRef(false), alert = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement | null>(null), heading = useRef<HTMLHeadingElement>(null)
  const weekFrom = weekStart(date), isDemo = adapter.kind === "demo"
  const dirty = !!draft && !!snapshot && (draft.available !== snapshot.preferences.available || draft.selectedAreaIds.length !== snapshot.preferences.selectedAreaIds.length || draft.selectedAreaIds.some(id => !snapshot.preferences.selectedAreaIds.includes(id)))
  useEffect(() => {
    const controller = new AbortController(); operation.current = controller; setLoading(true); setSnapshot(null); setDraft(null); setError("")
    void adapter.read(weekFrom, controller.signal).then(value => { if (!controller.signal.aborted) { setSnapshot(value); setDraft(value ? clonePreferences(value.preferences) : null) } }).catch(error => { if (!controller.signal.aborted) setError(failure(error)) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort(); operation.current?.abort(); mutation.current = false }
  }, [adapter, weekFrom, retry])
  useEffect(() => { if (error && !selected) alert.current?.focus() }, [error])
  async function change(action: "save" | "register" | "cancel" | "reset", id?: string) {
    if (mutation.current || loading) return
    mutation.current = true; const controller = new AbortController(); operation.current = controller; setBusy(true); setError(""); setNotice("")
    try {
      const next = action === "save" ? await adapter.savePreferences(draft!, weekFrom, controller.signal) : action === "register" ? await adapter.register(id!, weekFrom, controller.signal) : action === "cancel" ? await adapter.cancel(id!, weekFrom, controller.signal) : await adapter.reset(weekFrom, controller.signal)
      if (controller.signal.aborted) return
      setSnapshot(next); setDraft(next ? clonePreferences(next.preferences) : null); setVersion(value => value + 1)
      if (action === "reset") { setSelected(null); setFilter("all") }
      if (next && filter !== "all" && !next.preferences.selectedAreaIds.includes(filter)) setFilter("all")
      setNotice(action === "save" ? "Đã lưu lựa chọn minh họa trong trang này." : action === "register" ? "Đã đăng ký ca trong bản minh họa. Không cập nhật lịch hẹn thật." : action === "cancel" ? "Đã hủy đăng ký trong bản minh họa." : "Đã đặt lại khu vực, ca và trạng thái sẵn sàng minh họa.")
    } catch (error) { if (!controller.signal.aborted) setError(failure(error)) }
    finally { if (!controller.signal.aborted) { mutation.current = false; setBusy(false) } }
  }
  function close() { setSelected(null); window.setTimeout(() => { if (trigger.current?.isConnected) trigger.current.focus(); else heading.current?.focus() }, 0) }
  function canMove(amount: number) { try { checkedViewDate(addDays(date, amount)); return true } catch { return false } }
  function move(amount: number) { try { setDate(checkedViewDate(addDays(date, amount))); setNotice("") } catch (error) { setError(failure(error)) } }
  const days = mode === "day" ? [date] : Array.from({ length: 7 }, (_, index) => addDays(weekFrom, index))
  const visible = snapshot?.shifts.filter(shift => snapshot.preferences.selectedAreaIds.includes(shift.areaId) && (filter === "all" || shift.areaId === filter)) || []
  return <div className="staff-areas min-w-0 space-y-6" data-staff-areas-demo={loading ? "loading" : error && !snapshot ? "error" : "ready"}>
    <StaffPageHeader title="Khu vực & ca làm" description="Chọn khu vực, trải nghiệm lịch ca và trạng thái sẵn sàng của bạn." action={isDemo && <Button variant="outline" disabled={busy || loading} aria-label="Đặt lại khu vực minh họa" onClick={() => void change("reset")}><RotateCcwIcon aria-hidden="true" />Đặt lại minh họa</Button>} />
    {isDemo && <DemoNotice />}
    {notice && <p role="status" aria-live="polite" className="staff-areas-feedback">{notice}</p>}
    {error && <div ref={alert} role="alert" tabIndex={-1} className="staff-areas-error"><p>{error}</p>{!snapshot && <Button variant="outline" onClick={() => setRetry(value => value + 1)}>Thử tải lại</Button>}</div>}
    {loading ? <section className="staff-areas-empty" role="status" aria-busy="true">Đang tải khu vực và ca minh họa...</section> : !snapshot || !draft ? !error && <StaffEmpty title="Chưa có dữ liệu khu vực" description="Nguồn dữ liệu hiện chưa cung cấp khu vực hoặc ca làm." /> : <>
      <form className="staff-areas-preferences" onSubmit={event => { event.preventDefault(); void change("save") }}>
        <section aria-labelledby="staff-areas-heading"><div className="staff-areas-section-title"><div><h2 id="staff-areas-heading">Khu vực được phân công minh họa</h2><p>Chọn khu vực muốn xem ca. Lựa chọn chỉ được áp dụng sau khi lưu.</p></div><span>{snapshot.areas.length} khu vực minh họa</span></div>
          <div className="staff-areas-grid">{snapshot.areas.map(area => <Card key={area.id} className={"staff-area-card" + (draft.selectedAreaIds.includes(area.id) ? " staff-area-card-selected" : "")} data-area-id={area.id}><CardContent><div className="staff-area-card-top"><span className="staff-area-icon"><MapPinIcon aria-hidden="true" /></span><span className="staff-area-state">{area.status === "ACTIVE" ? "Được phân công DEMO" : "Tạm ngưng DEMO"}</span></div><h3>{area.name}</h3><p>{area.description}</p><p className="staff-area-branch">{area.branch}</p><label className="staff-areas-checkbox"><input type="checkbox" data-area-select={area.id} checked={draft.selectedAreaIds.includes(area.id)} disabled={busy || area.status !== "ACTIVE"} onChange={event => { const checked = event.target.checked; setDraft(value => value && ({ ...value, selectedAreaIds: checked ? [...value.selectedAreaIds, area.id] : value.selectedAreaIds.filter(id => id !== area.id) })); setNotice("") }} /><span>{area.status !== "ACTIVE" ? "Chưa thể chọn" : draft.selectedAreaIds.includes(area.id) ? "Đã chọn khu vực" : "Chọn khu vực này"}</span></label></CardContent></Card>)}</div>
        </section>
        <Card className="staff-areas-readiness"><CardContent><div><p className="staff-areas-eyebrow">Trạng thái sẵn sàng DEMO</p><h2 data-areas-saved-available={snapshot.preferences.available ? "true" : "false"}>{snapshot.preferences.available ? "Sẵn sàng minh họa" : "Không sẵn sàng minh họa"}</h2><p>Không thay đổi tài khoản ACTIVE, phân công hoặc việc nhận công việc thật. Đăng ký ca minh họa không yêu cầu bật sẵn sàng.</p></div><label className="staff-areas-checkbox"><input type="checkbox" data-areas-available checked={draft.available} disabled={busy} onChange={event => { const available = event.target.checked; setDraft(value => value && ({ ...value, available })); setNotice("") }} /><span>Sẵn sàng trong DEMO</span></label></CardContent></Card>
        <div className="staff-areas-preference-actions"><p role="status">{dirty ? "Có thay đổi chưa lưu. Hãy lưu hoặc hủy trước khi chuyển kỳ và đăng ký ca." : "Lựa chọn hiện tại chỉ lưu tạm trong bản minh họa."}</p><div><Button type="button" variant="outline" disabled={busy || !dirty} aria-label="Hủy thay đổi lựa chọn" onClick={() => { setDraft(clonePreferences(snapshot.preferences)); setError(""); setNotice("Đã hủy thay đổi chưa lưu trong bản minh họa.") }}>Hủy thay đổi</Button><Button type="submit" disabled={busy || !dirty} aria-label="Lưu lựa chọn minh họa"><CheckIcon aria-hidden="true" />{busy ? "Đang xử lý..." : "Lưu lựa chọn"}</Button></div></div>
      </form>
      <section className="staff-areas-calendar" aria-labelledby="staff-areas-calendar-heading"><div className="staff-areas-section-title"><div><h2 ref={heading} tabIndex={-1} id="staff-areas-calendar-heading">Lịch ca minh họa</h2><p>Ca sáng 08:00–12:00 · chiều 13:00–17:00 · tối 18:00–21:00, giờ Việt Nam.</p></div><span data-areas-registered-count={snapshot.registeredShiftIds.length}>{snapshot.registeredShiftIds.length} ca đã đăng ký DEMO · mọi tuần trong phiên này</span></div>
        <div className="staff-areas-calendar-toolbar"><div role="group" aria-label="Chế độ lịch ca"><Button variant={mode === "day" ? "default" : "outline"} aria-pressed={mode === "day"} aria-label="Xem ca theo ngày" disabled={busy || dirty} onClick={() => setMode("day")}>Ngày</Button><Button variant={mode === "week" ? "default" : "outline"} aria-pressed={mode === "week"} aria-label="Xem ca theo tuần" disabled={busy || dirty} onClick={() => setMode("week")}>Tuần</Button></div><div className="staff-areas-period-controls"><Button variant="outline" aria-label="Kỳ ca trước" disabled={busy || dirty || !canMove(mode === "day" ? -1 : -7)} onClick={() => move(mode === "day" ? -1 : -7)}><ChevronLeftIcon aria-hidden="true" /></Button><label className="staff-areas-field"><span>Ngày đang xem</span><input type="date" data-areas-date value={date} min="1971-01-04" max="2099-12-27" disabled={busy || dirty} onChange={event => { const next = event.target.value; if (next) { try { setDate(checkedViewDate(next)); setError("") } catch (error) { setError(failure(error)) } } }} /></label><Button variant="outline" aria-label="Kỳ ca sau" disabled={busy || dirty || !canMove(mode === "day" ? 1 : 7)} onClick={() => move(mode === "day" ? 1 : 7)}><ChevronRightIcon aria-hidden="true" /></Button><Button variant="outline" aria-label="Ca hôm nay" disabled={busy || dirty} onClick={() => setDate(vietnamDate(new Date()))}>Hôm nay</Button></div><label className="staff-areas-field"><span>Lọc khu vực đã lưu</span><select data-areas-filter value={filter} disabled={busy || dirty} onChange={event => setFilter(event.target.value)}><option value="all">Tất cả khu vực đã chọn</option>{snapshot.areas.filter(area => snapshot.preferences.selectedAreaIds.includes(area.id)).map(area => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label></div>
        <p className="staff-areas-range">{mode === "day" ? formatDay(date) : formatDay(snapshot.weekFrom) + " – " + formatDay(snapshot.weekTo)} · UTC+7 · Lịch ca DEMO, tách khỏi lịch hẹn thật</p>
        {!visible.length ? <div className="staff-areas-empty"><MapPinIcon aria-hidden="true" /><h3>Chưa chọn khu vực có ca minh họa</h3><p>Chọn và lưu một khu vực đang hoạt động để xem lịch ca.</p></div> : <div className={"staff-areas-days staff-areas-days-" + mode}>{days.map(day => <section key={day} className="staff-areas-day" data-areas-day={day}><h3><CalendarDaysIcon aria-hidden="true" />{formatDay(day)}</h3><div>{visible.filter(shift => shift.date === day).map(shift => {
          const registered = snapshot.registeredShiftIds.includes(shift.id), future = Date.parse(shift.startAt) > Date.now()
          return <article key={shift.id} className={"staff-areas-shift" + (registered ? " staff-areas-shift-registered" : "")} data-demo-shift-id={shift.id} data-shift-area={shift.areaId} data-shift-date={shift.date} data-shift-status={shift.status} data-shift-registered={registered ? "true" : "false"} data-shift-start={shift.startAt} data-shift-end={shift.endAt}><div className="staff-areas-shift-top"><strong>{shift.label}</strong><span>{registered ? "Đã đăng ký DEMO" : statusLabels[shift.status]}</span></div><p className="staff-areas-shift-time"><ClockIcon aria-hidden="true" /><time dateTime={shift.startAt}>{formatShiftTime(shift.startAt)}</time>–<time dateTime={shift.endAt}>{formatShiftTime(shift.endAt)}</time></p><p>{snapshot.areas.find(area => area.id === shift.areaId)?.name}</p>{!future && <p className="staff-areas-muted">Ca đã bắt đầu; không đăng ký/hủy trong DEMO.</p>}<div className="staff-areas-shift-actions"><Button variant="outline" aria-label={"Xem ca " + shift.id} onClick={event => { trigger.current = event.currentTarget; setSelected(shift.id) }}>Chi tiết</Button><Button variant={registered ? "outline" : "default"} disabled={busy || dirty || !future || !registered && shift.status !== "OPEN"} aria-label={(registered ? "Hủy đăng ký ca " : "Đăng ký ca ") + shift.id} onClick={() => void change(registered ? "cancel" : "register", shift.id)}>{registered ? "Hủy đăng ký" : "Đăng ký DEMO"}</Button></div></article>
        })}</div></section>)}</div>}
      </section>
      <details className="staff-areas-rules"><summary>Giả định của bản minh họa</summary><ul><li>Chỉ chọn khu vực được phân công DEMO đang hoạt động. Sẵn sàng yêu cầu chọn ít nhất một khu vực.</li><li>Ca cùng ngày có ba khung cố định; bắt đầu phải trước kết thúc. Chỉ đăng ký ca mở chưa bắt đầu và không trùng giờ giữa các khu vực.</li><li>Không bỏ khu vực còn ca đã đăng ký chưa bắt đầu; hãy hủy ca minh họa trước. Không tự thêm thời gian di chuyển hoặc chính sách nhân sự.</li><li>Đây không phải chính sách chính thức của CleanHome. Không tạo assignment, cập nhật UC12 hoặc đồng bộ Backend.</li></ul></details>
      <p className="staff-areas-muted">Cần xem lịch hẹn được phân công thật? <Link href="/lich-lam-viec">Mở Lịch làm việc</Link>.</p>
    </>}
    <ShiftDetail key={selected || "closed"} adapter={adapter} id={selected} weekFrom={weekFrom} snapshot={snapshot} version={version} busy={busy} dirty={dirty} actionError={error} actionNotice={notice} onClose={close} onChange={(action, id) => void change(action, id)} />
  </div>
}
