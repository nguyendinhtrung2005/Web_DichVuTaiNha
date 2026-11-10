"use client"

import { useEffect, useState } from "react"
import { ArrowLeftIcon, CalendarDaysIcon, ChevronLeftIcon, ChevronRightIcon, CircleDollarSignIcon, InfoIcon, RefreshCwIcon, WalletIcon } from "lucide-react"
import { AreaLink as Link } from "@/components/shared/area-routes"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { StaffEmpty, StaffLoading, StaffPageHeader } from "./staff-shared"
import { StaffIncomeInsights } from "./staff-income-insights"
import { incomeStatementReconciliation } from "./staff-income-insights-model"
import {
  INCOME_REASON_LABELS, INCOME_STATUS_LABELS, canShiftIncomeMonth, currentVietnamMonth, formatIncomeMonth,
  formatIncomeMoment, formatIncomeVnd, formatIncomeWindow, readStaffIncome, shiftIncomeMonth,
  staffIncomeMessage, validIncomeMonth, StaffIncomeRequestError, repeatedIncomeBookings,
  type StaffIncomeAssignment, type StaffIncomeEstimate,
} from "./staff-income-remote-model"

function MonthPicker({ month, disabled, onChange, basis }: { month: string; disabled: boolean; onChange: (month: string) => void; basis?: "completion" | "schedule" }) {
  return <section className="staff-income-period" aria-label="Kỳ tiền công dự kiến">
    <div className="staff-income-period-heading">
      <div>
        <p className="staff-income-eyebrow">Kỳ ghi nhận tiền công</p>
        <h2 data-staff-income-month={month}>{formatIncomeMonth(month)}</h2>
        <p>{basis === "completion" ? "Theo ngày hoàn thành · " : basis === "schedule" ? "Theo lịch hẹn · " : ""}Giờ Việt Nam (UTC+7)</p>
      </div>
    </div>
    <div className="staff-income-period-actions">
      <Button variant="outline" size="icon" aria-label="Tháng trước" disabled={disabled || !canShiftIncomeMonth(month, -1)} onClick={() => onChange(shiftIncomeMonth(month, -1))}>
        <ChevronLeftIcon aria-hidden="true" />
      </Button>
      <div className="ch-field staff-income-period-picker">
        <label htmlFor="staff-income-month">Chọn tháng</label>
        <input id="staff-income-month" aria-label="Chọn tháng tiền công dự kiến" type="month" min="1971-01" max="2099-12"
          value={month} disabled={disabled}
          onChange={event => { if (validIncomeMonth(event.target.value)) onChange(event.target.value) }} />
      </div>
      <Button variant="outline" size="icon" aria-label="Tháng sau" disabled={disabled || !canShiftIncomeMonth(month, 1)} onClick={() => onChange(shiftIncomeMonth(month, 1))}>
        <ChevronRightIcon aria-hidden="true" />
      </Button>
      <Button variant="outline" disabled={disabled} onClick={() => onChange(currentVietnamMonth())}>
        <CalendarDaysIcon aria-hidden="true" />Tháng này
      </Button>
    </div>
  </section>
}

function Summary({ estimate }: { estimate: StaffIncomeEstimate }) {
  const metrics = [
    { key: "total", label: "Tổng tiền công dự kiến", value: formatIncomeVnd(estimate.estimateTotalVnd), note: estimate.breakdown?.unverifiedDistance ? "Chưa gồm di chuyển chưa xác minh" : "Chỉ là ước tính minh họa" },
    { key: "eligible", label: "Công việc hoàn thành hợp lệ", value: String(estimate.counts.eligible), note: "Đã ghi nhận đủ thời gian làm việc" },
    { key: "unit", label: "Đơn giá minh họa", value: formatIncomeVnd(estimate.policy.unitPriceVnd), note: "Mỗi công việc hoàn thành hợp lệ" },
    { key: "incomplete", label: "Phân công thiếu dữ liệu", value: String(estimate.counts.incomplete), note: "Không được tính tiền" },
  ] as const
  return <section className="staff-income-summary" aria-label="Tổng hợp tiền công dự kiến">
    {metrics.map((metric, index) => <Card key={metric.key} className={index === 0 ? "staff-income-summary-primary" : ""}
      data-staff-income-metric={metric.key} data-staff-income-value={metric.value}>
      <CardContent>
        <div className="staff-income-summary-heading">
          <span>{metric.label}</span>
          {index === 0 ? <WalletIcon aria-hidden="true" /> : <CircleDollarSignIcon aria-hidden="true" />}
        </div>
        <p className="staff-income-summary-value" data-staff-income-total={metric.key === "total" ? estimate.estimateTotalVnd : undefined}
          data-staff-income-eligible={metric.key === "eligible" ? estimate.counts.eligible : undefined}
          data-staff-income-incomplete={metric.key === "incomplete" ? estimate.counts.incomplete : undefined}>{metric.value}{metric.key === "total" && <span className="ml-2 inline-block align-middle text-xs font-medium tracking-normal" data-staff-income-estimate-label>Dự kiến</span>}</p>
        <p>{metric.note}</p>
      </CardContent>
    </Card>)}
  </section>
}

function Payout() {
  return <Card className="staff-income-payout" data-staff-income-payout="NOT_INTEGRATED">
    <CardContent>
      <div className="staff-income-section-heading">
        <div>
          <h2>Đối soát và chi trả</h2>
          <p>Chưa có thông tin đối soát hoặc xác nhận thanh toán.</p>
        </div>
        <InfoIcon aria-hidden="true" />
      </div>
      <dl className="staff-income-breakdown">
        <div><dt>Tiền công dự kiến</dt><dd>Ước tính minh họa theo bảng kê bên dưới</dd></div>
        <div><dt>Đối soát</dt><dd>Chưa có kết quả được xác nhận</dd></div>
        <div><dt>Tiền đã thanh toán</dt><dd>Chưa có giao dịch được xác nhận</dd></div>
      </dl>
    </CardContent>
  </Card>
}

function AssignmentRows({ assignments, unitPrice }: { assignments: StaffIncomeAssignment[]; unitPrice: number }) {
  return <div className="staff-income-table-wrap" role="region" tabIndex={0} aria-label="Bảng kê phân công; cuộn ngang để xem đầy đủ trên màn hình nhỏ">
    <table className="staff-income-table">
      <caption className="sr-only">Các công việc hoàn thành hợp lệ được dùng để tính tiền công dự kiến</caption>
      <thead><tr>{["Mã phân công", "Lịch hẹn", "Bắt đầu", "Kết thúc", "Trạng thái", "Số tiền dự kiến"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
      <tbody>{assignments.map(item => <tr key={item.id} data-staff-income-assignment-id={item.id} data-staff-income-assignment-eligible={item.eligible ? "true" : "false"}>
        <td><strong><Link href={"/don/" + item.id}>#{item.id}</Link></strong><span className="staff-income-reference">Đơn #{item.bookingId}</span></td>
        <td><time dateTime={item.scheduledStart}>{formatIncomeWindow(item.scheduledStart, item.scheduledEnd)}</time></td>
        <td><time dateTime={item.checkInAt || undefined}>{formatIncomeMoment(item.checkInAt)}</time></td>
        <td><time dateTime={item.checkOutAt || undefined}>{formatIncomeMoment(item.checkOutAt)}</time></td>
        <td>{INCOME_STATUS_LABELS[item.status]}</td>
        <td className="staff-income-money">{formatIncomeVnd(item.detail?.totalVnd ?? unitPrice)}{item.detail && <small className="staff-income-reference">Cơ bản {formatIncomeVnd(item.detail.baseVnd)} · Cao điểm {formatIncomeVnd(item.detail.peakVnd)} · Di chuyển {item.detail.distanceVnd === null ? "chưa tính" : formatIncomeVnd(item.detail.distanceVnd)}</small>}</td>
      </tr>)}</tbody>
    </table>
  </div>
}

function IncomeStatement({ assignments, unitPrice }: { assignments: StaffIncomeAssignment[]; unitPrice: number }) {
  const [query, setQuery] = useState("")
  const [distance, setDistance] = useState("all")
  const [page, setPage] = useState(1)
  const matching = assignments.filter(item => (!query.trim() || item.id.includes(query.trim()) || item.bookingId.includes(query.trim()))
    && (distance === "all" || (item.detail?.distanceStatus === "VERIFIED" ? "verified" : "unverified") === distance))
  const pages = Math.max(1, Math.ceil(matching.length / 20)), current = Math.min(page, pages)
  const matchingTotal = matching.reduce((sum, item) => sum + (item.detail?.totalVnd ?? unitPrice), 0)
  return <>
    <div className="staff-income-insights-filters staff-income-statement-filters">
      <label htmlFor="staff-income-entry-search">Tìm mã phân công hoặc đơn<input id="staff-income-entry-search" type="search" placeholder="Nhập mã phân công hoặc đơn" maxLength={19} value={query}
        onChange={event => { setQuery(event.target.value); setPage(1) }} /></label>
      <label htmlFor="staff-income-distance-filter">Bằng chứng di chuyển<select id="staff-income-distance-filter" value={distance}
        onChange={event => { setDistance(event.target.value); setPage(1) }}>
        <option value="all">Tất cả</option><option value="verified">Đã xác minh</option><option value="unverified">Chưa xác minh hoặc chưa hợp lệ</option>
      </select></label>
      <p role="status">{matching.length} / {assignments.length} công việc khớp bộ lọc · Tổng kỳ không đổi.</p>
      <p data-income-statement-subtotal={matchingTotal} data-income-statement-count={matching.length}>Tổng kết quả lọc: {formatIncomeVnd(matchingTotal)} · Gồm tất cả công việc khớp, chưa cộng thưởng ngày.</p>
    </div>
    {matching.length ? <>
      <AssignmentRows assignments={matching.slice((current - 1) * 20, current * 20)} unitPrice={unitPrice} />
      {pages > 1 && <nav className="staff-income-period-actions" aria-label="Phân trang bảng kê tiền công">
        <Button variant="outline" disabled={current === 1} onClick={() => setPage(current - 1)}>Trang trước</Button>
        <span role="status">Trang {current} / {pages}</span>
        <Button variant="outline" disabled={current === pages} onClick={() => setPage(current + 1)}>Trang sau</Button>
      </nav>}
    </> : <StaffEmpty title="Không có phân công phù hợp" description="Thử đổi mã tìm kiếm hoặc bộ lọc bằng chứng di chuyển." />}
  </>
}

function IncompleteList({ assignments }: { assignments: StaffIncomeAssignment[] }) {
  if (!assignments.length) return null
  return <Card className="staff-income-incomplete" data-staff-income-incomplete-list>
    <CardContent>
      <div className="staff-income-section-heading">
        <div>
          <h2>Phân công cần kiểm tra</h2>
          <p>Công việc thiếu hoặc sai thời gian bắt đầu/kết thúc, chưa đủ điều kiện tính tiền dự kiến.</p>
        </div>
      </div>
      <ul>{assignments.map(item => <li key={item.id} data-staff-income-incomplete-id={item.id}>
        <strong>#{item.id}</strong>
        <span>{INCOME_STATUS_LABELS[item.status]}</span>
        <span>{formatIncomeWindow(item.scheduledStart, item.scheduledEnd)}</span>
        <span>{item.reason ? INCOME_REASON_LABELS[item.reason] : "Dữ liệu chưa hợp lệ"}</span>
      </li>)}</ul>
    </CardContent>
  </Card>
}

export function StaffIncomePanel({ month, estimate, loading, error, onMonth, onRetry, accountId, checkSession }: {
  month: string
  estimate: StaffIncomeEstimate | null
  loading: boolean
  error: string
  onMonth: (month: string) => void
  onRetry: () => void
  accountId?: string
  checkSession?: () => unknown
}) {
  const eligible = estimate?.assignments.filter(item => item.eligible) || []
  const incomplete = estimate?.assignments.filter(item => item.reason === "MISSING_CHECK_TIMES" || item.reason === "INVALID_CHECK_TIMES") || []
  const statement = estimate ? incomeStatementReconciliation(estimate) : null
  const repeated = repeatedIncomeBookings(estimate?.assignments || [])
  return <div className="staff-income min-w-0 space-y-6" data-staff-income-remote={loading ? "loading" : error ? "error" : estimate ? "ready" : "empty"}>
    <StaffPageHeader title="Thu nhập" description="Xem tiền công dự kiến theo từng kỳ."
      action={<Button variant="outline" render={<Link href="/ho-so" />} nativeButton={false}><ArrowLeftIcon aria-hidden="true" />Cá nhân</Button>} />
    <Card><CardContent><MonthPicker month={month} disabled={loading} onChange={onMonth} basis={estimate ? estimate.policy.version === "DEMO_V2" ? "completion" : "schedule" : undefined} /></CardContent></Card>
    {error
      ? <section className="staff-income-error" role="alert" data-staff-income-error>
        <h2>Chưa thể tải tiền công dự kiến</h2>
        <p>{error}</p>
        <p>Không hiển thị tổng tiền khi dữ liệu chưa đọc được.</p>
        <Button variant="outline" onClick={onRetry}><RefreshCwIcon aria-hidden="true" />Thử lại</Button>
      </section>
      : loading || !estimate
        ? <StaffLoading />
        : !estimate.counts.assignments
          ? <><StaffEmpty title="Chưa có phân công trong tháng" description="Không có phân công nào thuộc tài khoản của bạn trong tháng đã chọn." /><StaffIncomeInsights key={`${accountId}:${month}`} estimate={estimate} accountId={accountId} checkSession={checkSession} /></>
          : <>
            {repeated.length > 0 && <section className="staff-income-repeat-notice" role="status" data-income-repeated-bookings>
              <h2>Đơn có nhiều phân công trong kỳ</h2><p>Chưa đủ thông tin để xác định các phân công có trùng nghiệp vụ hay không. Bảng kê và tổng tiền dự kiến được giữ nguyên theo dữ liệu đã nhận. Liên hệ Admin để kiểm tra trước khi đối soát.</p>
              <details><summary>Xem {repeated.length} đơn cần kiểm tra</summary><ul>{repeated.map(group => <li key={group.bookingId}>Đơn #{group.bookingId} · Phân công {group.assignmentIds.map(id => "#" + id).join(", ")}</li>)}</ul></details>
            </section>}
            <Summary estimate={estimate} />
            <Payout />
            <StaffIncomeInsights key={`${accountId}:${month}`} estimate={estimate} accountId={accountId} checkSession={checkSession} />
            <Card className="staff-income-formula">
              <CardContent><details className="staff-income-calculation">
                <summary>Chi tiết cách tính</summary>
                <div className="staff-income-calculation-body">
                    {estimate.policy.version === "DEMO_V2" && <p>Chính sách minh họa · DEMO_V2</p>}
                    <p>Công cơ bản minh họa: {formatIncomeVnd(estimate.policy.unitPriceVnd)}/công việc hoàn thành hợp lệ.</p>
                    {estimate.policy.version === "DEMO_V2" && <ul><li>Cao điểm: thêm 10.000đ khi bắt đầu từ 17:00 đến trước 20:00.</li><li>Thưởng ngày: 30.000đ khi đủ 5 công việc hợp lệ, tính một lần theo ngày hoàn thành.</li><li>Di chuyển: 3.000đ/km vượt 3km, chỉ cộng khi có quãng đường được xác minh. Chưa có bằng chứng thì chưa tính phụ phí.</li></ul>}
                    <p data-staff-income-formula>{estimate.policy.version === "DEMO_V2" && estimate.breakdown ? <>Cơ bản {formatIncomeVnd(estimate.breakdown.baseVnd)} + cao điểm {formatIncomeVnd(estimate.breakdown.peakVnd)} + di chuyển đã xác minh {formatIncomeVnd(estimate.breakdown.distanceVnd)} + thưởng ngày {formatIncomeVnd(estimate.breakdown.incentiveVnd)} = {formatIncomeVnd(estimate.estimateTotalVnd)}</> : <>{formatIncomeVnd(estimate.policy.unitPriceVnd)} × {estimate.counts.eligible} công việc DONE hợp lệ = {formatIncomeVnd(estimate.estimateTotalVnd)}</>}</p>
                    <p>{estimate.policy.version === "DEMO_V2" ? "Ghi nhận theo ngày hoàn thành; cao điểm theo giờ bắt đầu. " : "Ghi nhận theo lịch hẹn. "}Chỉ tính công việc hoàn thành có đủ thời gian bắt đầu và kết thúc hợp lệ. {estimate.counts.excluded} phân công chưa hoàn thành, đã hủy hoặc ngoài kỳ không phát sinh tiền công trong kỳ này.</p>
                    <p>Chính sách chỉ dùng để minh họa, không phải lương chính thức. Không dùng giá đơn dịch vụ để tính tiền công.</p>
                </div>
              </details></CardContent>
            </Card>
            <section className="staff-income-entries" aria-labelledby="staff-income-entries-heading">
              <div className="staff-income-section-heading">
                <div>
                  <h2 id="staff-income-entries-heading">Phân công được dùng để tính</h2>
                  <p>{eligible.length} công việc hoàn thành hợp lệ trong {formatIncomeMonth(month)}.</p>
                </div>
              </div>
              {eligible.length ? <IncomeStatement key={month} assignments={eligible} unitPrice={estimate.policy.unitPriceVnd} /> : <StaffEmpty title="Chưa có công việc DONE hợp lệ" description="Chưa có phân công nào đủ điều kiện để tính tiền công dự kiến trong tháng này." />}
              {statement && <Card><CardContent><h3>Đối chiếu bảng kê toàn kỳ</h3><p>Tổng gồm tiền từng công việc và thưởng ngày, chưa phải xác nhận đối soát.</p><dl className="staff-income-breakdown" data-income-statement-reconciled={statement.totalVnd}>
                <div><dt>{statement.eligible} công việc hoàn thành hợp lệ</dt><dd data-income-assignment-total={statement.assignmentVnd}>{formatIncomeVnd(statement.assignmentVnd)}</dd></div>
                <div><dt>Thưởng ngày trong kỳ</dt><dd data-income-incentive-total={statement.incentiveVnd}>{formatIncomeVnd(statement.incentiveVnd)}</dd></div>
                <div><dt>Tổng tiền công dự kiến toàn kỳ</dt><dd>{formatIncomeVnd(statement.totalVnd)}</dd></div>
              </dl></CardContent></Card>}
            </section>
            <IncompleteList assignments={incomplete} />
            {estimate.assignments.some(item => !item.eligible && !["MISSING_CHECK_TIMES", "INVALID_CHECK_TIMES"].includes(item.reason || "")) && <Card><CardContent><h2>Phân công ngoài điều kiện ghi nhận trong kỳ</h2><ul>{estimate.assignments.filter(item => !item.eligible && !["MISSING_CHECK_TIMES", "INVALID_CHECK_TIMES"].includes(item.reason || "")).map(item => <li key={item.id}>#{item.id} · {item.reason ? INCOME_REASON_LABELS[item.reason] : "Chưa đủ điều kiện"} · Check-out: {formatIncomeMoment(item.checkOutAt)}</li>)}</ul></CardContent></Card>}
          </>}
  </div>
}

export function StaffIncomeRemote({ accountId, checkSession }: { accountId: string; checkSession?: () => unknown }) {
  const [month, setMonth] = useState(() => currentVietnamMonth())
  const [estimate, setEstimate] = useState<StaffIncomeEstimate | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => { if (!controller.signal.aborted) { setError("Hết thời gian đọc tiền công dự kiến. Vui lòng thử lại."); setEstimate(null); setLoading(false); controller.abort() } }, 20_000)
    setLoading(true); setError(""); setEstimate(null)
    void readStaffIncome(month, accountId, controller.signal)
      .then(value => { if (!controller.signal.aborted) setEstimate(value) })
      .catch(reason => { if (!controller.signal.aborted) { setError(staffIncomeMessage(reason)); if (reason instanceof StaffIncomeRequestError && ([401, 403].includes(reason.status) || reason.code === "STAFF_SESSION_CHANGED")) { try { void Promise.resolve(checkSession?.()).catch(() => {}) } catch {} } } })
      .finally(() => { window.clearTimeout(timer); if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [accountId, month, retry, checkSession])

  const currentEstimate = estimate?.period.month === month ? estimate : null
  return <StaffIncomePanel month={month} estimate={currentEstimate} loading={loading || !error && !currentEstimate} error={error}
    accountId={accountId} checkSession={checkSession} onMonth={value => { if (!loading && value !== month) setMonth(value) }} onRetry={() => setRetry(value => value + 1)} />
}
