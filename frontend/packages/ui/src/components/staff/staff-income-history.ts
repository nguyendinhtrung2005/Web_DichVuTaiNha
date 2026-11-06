import { incomeDailySeries, incomeHistoryMonths } from './staff-income-insights-model'
import { readStaffIncome, StaffIncomeRequestError, type StaffIncomeEstimate } from './staff-income-remote-model'

export const INCOME_HISTORY_CONCURRENCY = 2
export const INCOME_HISTORY_TIMEOUT_MS = 15000
type HistoryOptions = {
  end: string; span: number; accountId: string; signal: AbortSignal
  known?: readonly StaffIncomeEstimate[]
  read?: typeof readStaffIncome
  onProgress?: (completed: number) => void
}
/** Per-account caller-owned memory only. At most twelve months, two requests, no automatic retry. */
export async function readIncomeHistory({ end, span, accountId, signal, known = [], read = readStaffIncome, onProgress }: HistoryOptions) {
  const months = incomeHistoryMonths(end, span), values = new Map<string, StaffIncomeEstimate>()
  for (const estimate of known) if (months.includes(estimate.period.month)) values.set(estimate.period.month, estimate)
  const pending = months.filter(month => !values.has(month)), errors: { month: string; error: unknown }[] = []
  let cursor = 0, stop = false
  const controller = new AbortController(), abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort()
  onProgress?.(values.size)
  try {
    await Promise.all(Array.from({ length: Math.min(INCOME_HISTORY_CONCURRENCY, pending.length) }, async () => {
      while (!stop && !controller.signal.aborted && cursor < pending.length) {
        const month = pending[cursor++], request = new AbortController(), cancel = () => request.abort()
        controller.signal.addEventListener('abort', cancel, { once: true })
        const timer = setTimeout(cancel, INCOME_HISTORY_TIMEOUT_MS)
        try {
          const estimate = await read(month, accountId, request.signal)
          if (controller.signal.aborted) return
          if (estimate.period.month !== month) throw new StaffIncomeRequestError(502, 'STAFF_INVALID_RESPONSE')
          incomeDailySeries(estimate)
          values.set(month, estimate); onProgress?.(values.size)
        } catch (error) {
          if (signal.aborted) return
          errors.push({ month, error })
          if (error instanceof StaffIncomeRequestError && ([401, 403, 429].includes(error.status) || error.code === 'STAFF_SESSION_CHANGED')) { stop = true; controller.abort() }
        } finally { clearTimeout(timer); controller.signal.removeEventListener('abort', cancel) }
      }
    }))
    return { months, estimates: months.flatMap(month => values.has(month) ? [values.get(month)!] : []), errors, complete: values.size === months.length && !signal.aborted }
  } finally { signal.removeEventListener('abort', abort); controller.abort() }
}
