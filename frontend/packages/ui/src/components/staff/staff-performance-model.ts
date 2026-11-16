import type { RemoteStaffJob } from "./staff-jobs-remote-model"

/**
 * Operational metrics derived ONLY from the real Staff assignment DTO
 * (GET /api/staff/schedule). They are not salary, not revenue and not an
 * approved KPI/bonus formula. Every rate returns null when its denominator is
 * zero so the UI can never present "0%" as if it were a measured result.
 */
export type StaffPerformance = {
  readonly total: number
  readonly waiting: number
  readonly accepted: number
  readonly inProgress: number
  readonly done: number
  readonly cancelled: number
  /** done / (total - cancelled); null when there is no effective assignment. */
  readonly completionRate: number | null
  readonly completionDenominator: number
  /** Assignments with both scheduledAt and checkInAt. */
  readonly checkInSample: number
  /** checkInAt <= scheduledAt among checkInSample. */
  readonly onTimeCheckIn: number
  /** onTimeCheckIn / checkInSample; null when checkInSample is 0. */
  readonly onTimeRate: number | null
  /** DONE assignments with both checkInAt and checkOutAt. */
  readonly durationSample: number
  /** Mean (checkOutAt - checkInAt) in minutes, rounded to an integer. */
  readonly averageServiceMinutes: number | null
  /** DONE without checkOutAt: a data gap, never counted as zero minutes. */
  readonly doneMissingCheckOut: number
  /** IN_PROGRESS/DONE without checkInAt: a data gap, never counted as on time. */
  readonly activeMissingCheckIn: number
  /** checkOutAt earlier than checkInAt: excluded from the average. */
  readonly invalidDuration: number
}

export type StaffPerformanceMetricKey = "completionRate" | "onTimeRate" | "averageServiceMinutes"

/** Single documented definition per metric; the UI prints these verbatim. */
export const STAFF_PERFORMANCE_DEFINITIONS: readonly {
  readonly key: StaffPerformanceMetricKey
  readonly label: string
  readonly formula: string
}[] = Object.freeze([
  { key: "completionRate", label: "Tỷ lệ hoàn thành", formula: "phân công DONE / (tổng phân công − CANCELLED)" },
  { key: "onTimeRate", label: "Đúng giờ nhận việc", formula: "số phân công có checkInAt ≤ scheduledAt / số phân công có đủ cả hai mốc" },
  { key: "averageServiceMinutes", label: "Thời lượng thực hiện trung bình", formula: "trung bình (checkOutAt − checkInAt) của phân công DONE có đủ hai mốc hợp lệ" },
] as const)

function rate(numerator: number, denominator: number): number | null {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) return null
  return Math.round((numerator / denominator) * 1000) / 10
}

function time(value: string | null): number | null {
  if (value === null) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function summarizeStaffPerformance(jobs: readonly RemoteStaffJob[]): StaffPerformance {
  const counts = { WAITING: 0, ACCEPTED: 0, IN_PROGRESS: 0, DONE: 0, CANCELLED: 0 }
  let checkInSample = 0, onTimeCheckIn = 0
  let durationSample = 0, durationTotal = 0
  let doneMissingCheckOut = 0, activeMissingCheckIn = 0, invalidDuration = 0
  for (const job of jobs) {
    counts[job.status] += 1
    const scheduled = time(job.scheduledAt)
    const checkIn = time(job.checkInAt)
    const checkOut = time(job.checkOutAt)
    const started = job.status === "IN_PROGRESS" || job.status === "DONE"
    if (started && checkIn === null) activeMissingCheckIn += 1
    if (scheduled !== null && checkIn !== null) {
      checkInSample += 1
      if (checkIn <= scheduled) onTimeCheckIn += 1
    }
    if (job.status !== "DONE") continue
    if (checkOut === null) { doneMissingCheckOut += 1; continue }
    if (checkIn === null) continue
    const minutes = (checkOut - checkIn) / 60_000
    if (!(minutes >= 0)) { invalidDuration += 1; continue }
    durationSample += 1
    durationTotal += minutes
  }
  const total = jobs.length
  const completionDenominator = total - counts.CANCELLED
  return Object.freeze({
    total,
    waiting: counts.WAITING,
    accepted: counts.ACCEPTED,
    inProgress: counts.IN_PROGRESS,
    done: counts.DONE,
    cancelled: counts.CANCELLED,
    completionRate: rate(counts.DONE, completionDenominator),
    completionDenominator,
    checkInSample,
    onTimeCheckIn,
    onTimeRate: rate(onTimeCheckIn, checkInSample),
    durationSample,
    averageServiceMinutes: durationSample ? Math.round(durationTotal / durationSample) : null,
    doneMissingCheckOut,
    activeMissingCheckIn,
    invalidDuration,
  })
}

/** One decimal, Vietnamese separator. Never invents a value for a null rate. */
export function formatStaffPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "Chưa đủ dữ liệu"
  return value.toFixed(1).replace(".", ",") + "%"
}

export function formatStaffMinutes(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) return "Chưa đủ dữ liệu"
  const hours = Math.floor(value / 60), minutes = Math.round(value % 60)
  return hours ? `${hours} giờ ${String(minutes).padStart(2, "0")} phút` : `${minutes} phút`
}
