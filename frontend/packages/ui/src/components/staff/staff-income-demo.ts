import { buildIncomeReport, type IncomeAdapter, type IncomeEntry } from "./staff-income-model"

/**
 * Entirely fictional fixed amounts, not wages or a booking-based formula.
 * Shared demonstration records are deliberately unrelated to the signed-in account.
 * No API, credential, session, assignment or browser storage is read or written.
 */
const seed: readonly Readonly<IncomeEntry>[] = Object.freeze([
  { id: "DEMO-INCOME-20251231-A", source: "WORK", reference: "DEMO-CV-20251231-A", description: "Khoản tiền công minh họa cuối năm", amountVnd: "280000", recognizedAt: "2025-12-31T09:00:00.000Z", status: "PAID", paidAt: "2026-01-03T02:00:00.000Z" },
  { id: "DEMO-INCOME-20260101-A", source: "WORK", reference: "DEMO-CV-20260101-A", description: "Khoản ghi nhận minh họa đầu năm", amountVnd: "320000", recognizedAt: "2025-12-31T17:00:00.000Z", status: "PAID", paidAt: "2026-01-05T02:00:00.000Z" },
  { id: "DEMO-INCOME-20260115-A", source: "BONUS", reference: null, description: "Thưởng minh họa, không phải chính sách chính thức", amountVnd: "150000", recognizedAt: "2026-01-15T03:00:00.000Z", status: "PAID", paidAt: "2026-01-20T02:00:00.000Z" },
  { id: "DEMO-INCOME-20260930-A", source: "WORK", reference: "DEMO-CV-20260930-A", description: "Khoản minh họa trước ranh giới tháng Việt Nam", amountVnd: "210000", recognizedAt: "2026-09-30T16:59:59.000Z", status: "PAID", paidAt: "2026-10-02T02:00:00.000Z" },
  { id: "DEMO-INCOME-20261001-A", source: "WORK", reference: "DEMO-CV-20261001-A", description: "Tiền công minh họa cho công việc A", amountVnd: "350000", recognizedAt: "2026-09-30T17:00:00.000Z", status: "PAID", paidAt: "2026-10-05T02:00:00.000Z" },
  { id: "DEMO-INCOME-20261003-A", source: "WORK", reference: "DEMO-CV-20261003-A", description: "Tiền công minh họa cho công việc B", amountVnd: "420000", recognizedAt: "2026-10-03T06:30:00.000Z", status: "PAID", paidAt: "2026-10-06T02:00:00.000Z" },
  { id: "DEMO-INCOME-20261005-A", source: "ALLOWANCE", reference: "DEMO-CV-20261005-A", description: "Phụ cấp di chuyển minh họa", amountVnd: "80000", recognizedAt: "2026-10-05T04:00:00.000Z", status: "PAID", paidAt: "2026-10-06T02:00:00.000Z" },
  { id: "DEMO-INCOME-20261007-A", source: "WORK", reference: "DEMO-CV-20261007-A", description: "Tiền công minh họa cho công việc C", amountVnd: "300000", recognizedAt: "2026-10-07T08:00:00.000Z", status: "PAID", paidAt: "2026-10-10T02:00:00.000Z" },
  { id: "DEMO-INCOME-20261010-A", source: "BONUS", reference: null, description: "Khoản thưởng minh họa theo bộ dữ liệu demo", amountVnd: "200000", recognizedAt: "2026-10-10T03:00:00.000Z", status: "PAID", paidAt: "2026-10-12T02:00:00.000Z" },
  { id: "DEMO-INCOME-20261012-A", source: "ADJUSTMENT", reference: "DEMO-CV-20261003-A", description: "Đối trừ minh họa; không sửa giá booking hoặc tiền thật", amountVnd: "-50000", recognizedAt: "2026-10-12T05:00:00.000Z", status: "PAID", paidAt: "2026-10-15T02:00:00.000Z" },
  { id: "DEMO-INCOME-20261015-A", source: "WORK", reference: "DEMO-CV-20261015-A", description: "Tiền công minh họa cho công việc D", amountVnd: "460000", recognizedAt: "2026-10-15T07:00:00.000Z", status: "PAID", paidAt: "2026-10-18T02:00:00.000Z" },
  { id: "DEMO-INCOME-20261019-A", source: "ALLOWANCE", reference: "DEMO-CV-20261019-A", description: "Phụ cấp vật dụng minh họa", amountVnd: "120000", recognizedAt: "2026-10-19T04:00:00.000Z", status: "PENDING", paidAt: null },
  { id: "DEMO-INCOME-20261021-A", source: "WORK", reference: "DEMO-CV-20261021-A", description: "Tiền công minh họa đang chờ", amountVnd: "390000", recognizedAt: "2026-10-21T08:30:00.000Z", status: "PENDING", paidAt: null },
  { id: "DEMO-INCOME-20261023-A", source: "ADJUSTMENT", reference: "DEMO-CV-20261021-A", description: "Điều chỉnh tăng minh họa, không phải nghiệp vụ đã duyệt", amountVnd: "30000", recognizedAt: "2026-10-23T05:00:00.000Z", status: "PENDING", paidAt: null },
  { id: "DEMO-INCOME-20261024-A", source: "WORK", reference: "DEMO-CV-20261024-A", description: "Tiền công minh họa cho công việc E", amountVnd: "510000", recognizedAt: "2026-10-24T07:30:00.000Z", status: "PENDING", paidAt: null },
  { id: "DEMO-INCOME-20261026-A", source: "BONUS", reference: null, description: "Thưởng bổ sung minh họa chưa thanh toán", amountVnd: "250000", recognizedAt: "2026-10-26T04:00:00.000Z", status: "PENDING", paidAt: null },
  { id: "DEMO-INCOME-20261028-A", source: "WORK", reference: "DEMO-CV-20261028-A", description: "Tiền công minh họa cho công việc F", amountVnd: "380000", recognizedAt: "2026-10-28T08:00:00.000Z", status: "PENDING", paidAt: null },
  { id: "DEMO-INCOME-20261029-A", source: "ADJUSTMENT", reference: "DEMO-CV-20261024-A", description: "Điều chỉnh giảm minh họa chờ đối trừ", amountVnd: "-20000", recognizedAt: "2026-10-29T03:00:00.000Z", status: "PENDING", paidAt: null },
  { id: "DEMO-INCOME-20261101-A", source: "WORK", reference: "DEMO-CV-20261101-A", description: "Khoản minh họa đầu tháng kế tiếp", amountVnd: "440000", recognizedAt: "2026-10-31T17:00:00.000Z", status: "PENDING", paidAt: null },
  { id: "DEMO-INCOME-20270101-A", source: "WORK", reference: "DEMO-CV-20270101-A", description: "Khoản minh họa đầu năm kế tiếp", amountVnd: "480000", recognizedAt: "2026-12-31T17:00:00.000Z", status: "PENDING", paidAt: null },
].map(entry => Object.freeze(entry as IncomeEntry)))

function abortIfNeeded(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Demo read aborted", "AbortError")
}
export function createIncomeDemoAdapter(): IncomeAdapter {
  if (process.env.NODE_ENV === "production") return unavailableAdapter()
  return {
    kind: "demo",
    async read(query, signal) {
      abortIfNeeded(signal)
      const report = buildIncomeReport(seed, query)
      abortIfNeeded(signal)
      return report
    },
    async detail(id, signal) {
      abortIfNeeded(signal)
      const entry = seed.find(value => value.id === id)
      return entry ? { ...entry } : null
    },
    async reset() { /* Read-only immutable seed. UI resets filters, period and selected detail. */ },
  }
}
/** Caller must supply a server-derived enabled flag; never infer permission from URL/storage. */
export function createIncomeAdapter(enabled: boolean): IncomeAdapter {
  if (enabled === true && process.env.NODE_ENV !== "production") return createIncomeDemoAdapter()
  return unavailableAdapter()
}
function unavailableAdapter(): IncomeAdapter {
  return {
    kind: "unavailable",
    async read(_query, signal) { abortIfNeeded(signal); return null },
    async detail(_id, signal) { abortIfNeeded(signal); return null },
    async reset() {},
  }
}
