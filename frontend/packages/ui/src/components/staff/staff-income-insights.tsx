"use client"
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { incomeAxis, incomeBucketBounds, incomeHistoryMonths, incomeHistorySeries, groupIncomeSeries, shiftIncomeHistoryMonth, type IncomeBucket, type IncomeHistorySpan, type IncomePeriod, type IncomeSource } from "./staff-income-insights-model"
import { readIncomeHistory } from "./staff-income-history"
import { formatIncomeMonth, formatIncomeVnd, staffIncomeMessage, StaffIncomeRequestError, validIncomeMonth, type StaffIncomeEstimate } from "./staff-income-remote-model"

const sources = [["amountVnd", "Tất cả khoản đã tính"], ["baseVnd", "Công cơ bản"], ["peakVnd", "Giờ cao điểm"], ["distanceVnd", "Di chuyển đã xác minh"], ["incentiveVnd", "Thưởng ngày"]] as const
const componentSources = sources.slice(1) as readonly (readonly [Exclude<IncomeSource, "amountVnd">, string])[]
type History = { scope: string; status: "loading" | "ready" | "error"; estimates: StaffIncomeEstimate[]; completed: number; error: string }
const shortDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`
const money = (row: IncomeBucket, source: IncomeSource) => row[source] === 0 && row.incomplete ? "Chưa đủ dữ liệu" : formatIncomeVnd(row[source])

export function StaffIncomeInsights({ estimate, accountId, checkSession }: { estimate: StaffIncomeEstimate; accountId?: string; checkSession?: () => unknown }) {
  const id = useId()
  const [view, setView] = useState<"chart" | "table">("chart"), [period, setPeriod] = useState<IncomePeriod>("day"), [source, setSource] = useState<IncomeSource>("amountVnd")
  const [end, setEnd] = useState(estimate.period.month), [span, setSpan] = useState<IncomeHistorySpan>(1), [retry, setRetry] = useState(0)
  const [selected, setSelected] = useState<string | null>(null), [tooltip, setTooltip] = useState<string | null>(null), [focusIndex, setFocusIndex] = useState(0)
  const scope = `${accountId || ""}:${end}:${span}`
  const [history, setHistory] = useState<History>(() => ({ scope, status: "ready", estimates: [estimate], completed: 1, error: "" }))
  const cache = useRef({ accountId, values: new Map([[estimate.period.month, estimate]]) })
  const months = useMemo(() => incomeHistoryMonths(end, span), [end, span])

  useEffect(() => {
    const controller = new AbortController()
    if (cache.current.accountId !== accountId) cache.current = { accountId, values: new Map() }
    const values = cache.current.values
    for (const month of values.keys()) if (!months.includes(month)) values.delete(month)
    if (months.includes(estimate.period.month)) values.set(estimate.period.month, estimate)
    const known = [...values.values()]
    setHistory({ scope, status: "loading", estimates: [], completed: known.length, error: "" })
    if (!accountId && known.length !== months.length) {
      setHistory({ scope, status: "error", estimates: [], completed: known.length, error: "Vui lòng đăng nhập lại để xem nhiều kỳ." })
      return () => controller.abort()
    }
    void readIncomeHistory({ end, span, accountId: accountId || "", signal: controller.signal, known,
      onProgress: completed => { if (!controller.signal.aborted) setHistory({ scope, status: "loading", estimates: [], completed, error: "" }) },
    }).then(result => {
      if (controller.signal.aborted) return
      const sessionError = result.errors.find(item => item.error instanceof StaffIncomeRequestError && ([401, 403].includes(item.error.status) || item.error.code === "STAFF_SESSION_CHANGED"))
      if (sessionError) { values.clear(); try { void Promise.resolve(checkSession?.()).catch(() => {}) } catch {} }
      else for (const value of result.estimates) values.set(value.period.month, value)
      if (!result.complete) throw result.errors[0]?.error || new Error("INCOME_HISTORY_INCOMPLETE")
      incomeHistorySeries(result.estimates)
      setHistory({ scope, status: "ready", estimates: result.estimates, completed: result.estimates.length, error: "" })
    }).catch(error => { if (!controller.signal.aborted) setHistory({ scope, status: "error", estimates: [], completed: values.size, error: staffIncomeMessage(error) }) })
    return () => controller.abort()
  }, [accountId, end, span, months, scope, estimate, retry, checkSession])

  const current = history.scope === scope ? history : { ...history, status: "loading" as const, estimates: [], completed: 0 }
  const rows = useMemo(() => current.status === "ready" ? groupIncomeSeries(incomeHistorySeries(current.estimates), period) : [], [current.status, current.estimates, period])
  const total = rows.reduce((sum, row) => sum + row[source], 0), axis = incomeAxis(Math.max(0, ...rows.map(row => row[source])))
  const from = months[0] + "-01", to = current.estimates.at(-1)?.period.to || estimate.period.to
  const incomplete = current.estimates.reduce((sum, value) => sum + value.counts.incomplete, 0)
  const active = rows.find(row => row.day === selected), tip = rows.find(row => row.day === tooltip)
  const bounds = (row: IncomeBucket) => incomeBucketBounds(row.day, period, from, to)
  const label = (row: IncomeBucket) => {
    const range = bounds(row)
    return period === "month" ? `${row.day.slice(5)}/${row.day.slice(0, 4)}` : range.from === range.to ? shortDay(range.from) : `${shortDay(range.from)}–${shortDay(range.to)}`
  }
  const description = (row: IncomeBucket) => `${label(row)}: ${money(row, source)}. Cơ bản ${formatIncomeVnd(row.baseVnd)}, cao điểm ${formatIncomeVnd(row.peakVnd)}, di chuyển đã tính ${formatIncomeVnd(row.distanceVnd)}, thưởng ngày ${formatIncomeVnd(row.incentiveVnd)}. ${row.eligible} công việc hợp lệ. Nhấn để xem chi tiết.`
  const resetSelection = () => { setSelected(null); setTooltip(null); setFocusIndex(0) }
  const move = (direction: number) => { const month = shiftIncomeHistoryMonth(end, direction * span); if (month) { try { incomeHistoryMonths(month, span); setEnd(month); resetSelection() } catch {} } }
  const canMove = (direction: number) => { const month = shiftIncomeHistoryMonth(end, direction * span); try { return !!month && incomeHistoryMonths(month, span).length === span } catch { return false } }
  const keyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : event.key === "ArrowRight" ? Math.min(rows.length - 1, index + 1) : event.key === "ArrowLeft" ? Math.max(0, index - 1) : null
    if (event.key === "Escape") { setTooltip(null); return }
    if (next !== null) { event.preventDefault(); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus() }
  }
  const totals = estimate.breakdown || { baseVnd: estimate.estimateTotalVnd, peakVnd: 0, distanceVnd: 0, incentiveVnd: 0, unverifiedDistance: estimate.counts.eligible }
  const selectedBounds = active ? bounds(active) : null
  const selectedAssignments = selectedBounds ? current.estimates.flatMap(value => value.assignments.filter(row => {
    const day = row.detail?.day || new Date(Date.parse(row.scheduledStart) + 7 * 3600000).toISOString().slice(0, 10)
    return row.eligible && day >= selectedBounds.from && day <= selectedBounds.to
  })) : []

  return <section className="staff-income-insights" data-income-insights data-income-history-state={current.status} data-income-history-months={months.join(",")}>
    <Card><CardContent>
      <div className="staff-income-section-heading"><div><h2 id={`${id}-heading`}>Lịch sử tiền công dự kiến</h2><p>So sánh các khoản đã tính · Giờ Việt Nam (UTC+7).</p></div>
        <div role="group" aria-label="Cách xem thống kê thu nhập"><Button variant={view === "chart" ? "default" : "outline"} aria-pressed={view === "chart"} data-income-view="chart" onClick={() => setView("chart")}>Biểu đồ</Button><Button variant={view === "table" ? "default" : "outline"} aria-pressed={view === "table"} data-income-view="table" onClick={() => { setView("table"); setTooltip(null) }}>Số liệu</Button></div>
      </div>
      <div className="staff-income-insights-filters">
        <label>Nhóm thời gian<select data-income-period value={period} onChange={event => { const next = event.target.value as IncomePeriod; setPeriod(next); if (next === "day") setSpan(1); resetSelection() }}><option value="day">Ngày</option><option value="week">Tuần</option><option value="month">Tháng</option></select></label>
        <label>Nguồn dự kiến<select data-income-source value={source} onChange={event => { setSource(event.target.value as IncomeSource); resetSelection() }}>{sources.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
        <label>Khoảng so sánh<select data-income-span value={span} onChange={event => { const next = Number(event.target.value) as IncomeHistorySpan; try { incomeHistoryMonths(end, next); setSpan(next); if (next > 1 && period === "day") setPeriod("month"); resetSelection() } catch {} }}>{([1, 3, 6, 12] as const).map(value => <option key={value} value={value} disabled={!shiftIncomeHistoryMonth(end, 1 - value)}>{value} tháng</option>)}</select></label>
        <label>Tháng kết thúc<input data-income-end type="month" min={span === 1 ? "1971-01" : `1971-${String(span).padStart(2, "0")}`} max="2099-12" value={end} onChange={event => { if (validIncomeMonth(event.target.value)) try { incomeHistoryMonths(event.target.value, span); setEnd(event.target.value); resetSelection() } catch {} }} /></label>
      </div>
      <div className="staff-income-history-nav"><Button variant="outline" size="icon" aria-label="Khoảng thu nhập trước" disabled={!canMove(-1)} onClick={() => move(-1)}><ChevronLeftIcon aria-hidden="true" /></Button><p>{formatIncomeMonth(months[0])}{span > 1 ? ` – ${formatIncomeMonth(end)}` : ""}</p><Button variant="outline" size="icon" aria-label="Khoảng thu nhập sau" disabled={!canMove(1)} onClick={() => move(1)}><ChevronRightIcon aria-hidden="true" /></Button></div>
      {current.status === "loading" ? <div className="staff-income-history-state" role="status" aria-busy="true"><div className="staff-income-chart-skeleton" /><p>Đang tải lịch sử · {current.completed}/{months.length} tháng</p></div>
        : current.status === "error" ? <div className="staff-income-history-state" role="alert" data-income-history-error><h3>Chưa thể tải đủ khoảng đã chọn</h3><p>{current.error}</p><p>Chưa hiển thị tổng hoặc coi tháng chưa tải là 0đ.</p><Button variant="outline" data-income-history-retry onClick={() => setRetry(value => value + 1)}>Thử lại</Button></div>
          : <>
            <div className="staff-income-history-total"><p role="status" data-income-filter-total={total} data-income-filter-source={source}>Tổng khoản đã tính: <strong>{formatIncomeVnd(total)}</strong></p><span>Dự kiến · Chính sách minh họa</span></div>
            <p className="staff-income-history-scope">{estimate.policy.version === "DEMO_V2" ? "Theo ngày hoàn thành" : "Theo lịch hẹn"}. {period === "week" && "Tuần từ thứ Hai đến Chủ nhật, chỉ tính ngày thuộc khoảng đã chọn. "}Bảng kê và cơ cấu bên dưới thuộc {formatIncomeMonth(estimate.period.month).toLowerCase()}.</p>
            {incomplete > 0 && <p role="note">{incomplete} phân công chưa đủ dữ liệu thời gian, chưa cộng vào tiền công. Các số tiền là khoản đã tính; ngày chưa đủ dữ liệu không được xác nhận là 0đ.</p>}
            {source === "distanceVnd" && current.estimates.some(value => (value.breakdown?.unverifiedDistance || 0) > 0) && <p role="note">Chưa cộng quãng đường chưa xác minh; khoản đã tính bằng 0 không coi là 0đ đã xác nhận cho toàn bộ di chuyển.</p>}
            {total === 0 && !incomplete && <p role="status">Chưa có tiền công được tính trong khoảng này. Dữ liệu đã tải đủ.</p>}
            {view === "chart" ? <figure className="staff-income-column-figure" aria-labelledby={`${id}-heading`}>
              <p className="staff-income-chart-help" id={`${id}-help`}>Đơn vị: VNĐ · Chọn cột để xem chi tiết. Dùng ← → để chuyển cột, Enter để chọn.</p>
              <div className="staff-income-column-layout">
                <div className="staff-income-y-axis" aria-hidden="true">{axis.ticks.map(tick => <span key={tick} style={{ bottom: `${tick / axis.max * 100}%` }}>{formatIncomeVnd(tick)}</span>)}</div>
                <div className="staff-income-column-scroll" data-income-chart-scroll role="region" tabIndex={0} aria-label="Biểu đồ tiền công dự kiến; cuộn ngang để xem toàn bộ kỳ" aria-describedby={`${id}-help`}>
                  <div className="staff-income-column-plot" data-income-chart-period={period} data-income-axis-max={axis.max} style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))`, minWidth: `${rows.length * (period === "day" ? 28 : period === "week" ? 80 : 64)}px` }}>
                    <div className="staff-income-column-grid" aria-hidden="true">{axis.ticks.map(tick => <span key={tick} style={{ bottom: `${tick / axis.max * 100}%` }} />)}</div>
                    {rows.map((row, index) => <button type="button" className="staff-income-column" key={row.day} data-income-bucket={row.day} data-income-bucket-amount={row[source]} data-income-bucket-count={row.eligible} data-income-bucket-incomplete={row.incomplete || undefined}
                      tabIndex={index === Math.min(focusIndex, rows.length - 1) ? 0 : -1} aria-label={description(row)} aria-pressed={selected === row.day} aria-controls={selected ? `${id}-detail` : undefined} aria-describedby={tooltip === row.day ? `${id}-tooltip` : undefined}
                      onFocus={() => { setFocusIndex(index); setTooltip(row.day) }} onBlur={() => setTooltip(null)} onMouseEnter={() => setTooltip(row.day)} onMouseLeave={event => { if (document.activeElement !== event.currentTarget) setTooltip(null) }} onKeyDown={event => keyboard(event, index)} onClick={() => setSelected(row.day)}>
                      <span className="staff-income-column-bar" data-income-bar style={{ height: `${row[source] / axis.max * 100}%` }} />
                      {row[source] === 0 && <span className="staff-income-column-zero" aria-hidden="true">{row.incomplete ? "?" : "0"}</span>}
                      <span className="staff-income-column-label" aria-hidden="true">{label(row)}</span>
                    </button>)}
                  </div>
                </div>
              </div>
              {tip && <div className="staff-income-chart-tooltip" role="tooltip" id={`${id}-tooltip`}><strong>{label(tip)} · Tổng {money(tip, "amountVnd")}</strong><dl>{componentSources.map(([key, name]) => <div key={key}><dt>{name}</dt><dd>{formatIncomeVnd(tip[key])}</dd></div>)}</dl></div>}
            </figure> : <div className="staff-income-table-wrap" role="region" tabIndex={0} aria-label="Bảng tiền công dự kiến; cuộn ngang để xem đầy đủ"><table className="staff-income-table" data-income-history-table><caption>Tiền công dự kiến theo {period === "day" ? "ngày" : period === "week" ? "tuần" : "tháng"} · VNĐ</caption><thead><tr><th scope="col">Kỳ (UTC+7)</th><th scope="col">Công việc hợp lệ</th>{componentSources.map(([key, name]) => <th key={key} scope="col">{name}</th>)}<th scope="col">Tổng đã tính</th><th scope="col">Chi tiết</th></tr></thead><tbody>{rows.map(row => <tr key={row.day}><th scope="row">{label(row)}</th><td>{row.eligible}</td>{componentSources.map(([key]) => <td key={key}>{money(row, key)}</td>)}<td data-income-table-amount={row.amountVnd}>{money(row, "amountVnd")}</td><td><Button variant="outline" onClick={() => setSelected(row.day)} aria-label={`Xem chi tiết ${label(row)}`}>Xem</Button></td></tr>)}</tbody></table></div>}
            {active && selectedBounds && <section className="staff-income-bucket-detail" id={`${id}-detail`} aria-live="polite" aria-label={`Chi tiết tiền công ${label(active)}`} data-income-selected-total={active.amountVnd}>
              <h3>Chi tiết {label(active)}</h3><p>{selectedBounds.from} – {selectedBounds.to} · {active.eligible} công việc hợp lệ</p>
              <dl className="staff-income-breakdown">{sources.map(([key, name]) => <div key={key}><dt>{key === "amountVnd" ? "Tổng tiền công dự kiến đã tính" : name}</dt><dd>{money(active, key)}</dd></div>)}</dl>
              {selectedAssignments.length > 0 && <><ul className="staff-income-bucket-assignments" aria-label="Phân công trong kỳ đã chọn">{selectedAssignments.slice(0, 10).map(row => <li key={row.id}><span>Phân công #{row.id}</span><strong>{formatIncomeVnd(row.detail?.totalVnd ?? estimate.policy.unitPriceVnd)}</strong></li>)}</ul>{selectedAssignments.length > 10 && <p>Và {selectedAssignments.length - 10} công việc khác. Xem đầy đủ trong bảng kê tháng tương ứng.</p>}<p>Tiền từng công việc chưa gồm thưởng ngày; thưởng ngày được cộng một lần vào tổng kỳ.</p></>}
              {active.incomplete && <p>Chỉ gồm các khoản đã tính; phân công thiếu dữ liệu chưa được cộng.</p>}
            </section>}
          </>}
    </CardContent></Card>
    <Card><CardContent><h2>Cơ cấu {formatIncomeMonth(estimate.period.month).toLowerCase()}</h2><div className="staff-income-source-chart" role="img" aria-label="Cơ cấu các khoản tiền công dự kiến">{componentSources.map(([key, name], index) => <span key={key} title={`${name}: ${formatIncomeVnd(totals[key])}`} style={{ width: (estimate.estimateTotalVnd ? totals[key] / estimate.estimateTotalVnd * 100 : 0) + "%", background: ["#2563eb", "#0891b2", "#7c3aed", "#059669"][index] }} />)}</div><dl className="staff-income-breakdown">{componentSources.map(([key, name]) => <div key={key}><dt>{name}</dt><dd>{key === "distanceVnd" && totals.unverifiedDistance > 0 ? (totals.distanceVnd ? formatIncomeVnd(totals.distanceVnd) + " đã tính; " : "Chưa tính; ") + totals.unverifiedDistance + " phân công chưa xác minh" : formatIncomeVnd(totals[key])}</dd></div>)}</dl>
      {!!estimate.incentives?.length && <ul aria-label="Thưởng ngày đủ điều kiện">{estimate.incentives.map(row => <li key={row.day}>{row.day}: {row.eligibleCount} phân công hợp lệ · {formatIncomeVnd(row.amountVnd)}, một lần trong ngày</li>)}</ul>}
    </CardContent></Card>
  </section>
}
