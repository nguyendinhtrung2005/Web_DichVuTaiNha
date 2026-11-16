/**
 * Inactive calculation boundary for a future approved policy provider.
 * No rates, approval, policy or payout are inferred from DEMO_V2 or booking prices.
 * This module is intentionally not wired to the estimate route or a database.
 */
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(value)
const money = value => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00.000Z')) && new Date(value + 'T00:00:00.000Z').toISOString().slice(0, 10) === value
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
const vietnamTime = value => new Date(Date.parse(value) + 7 * 3_600_000)
const checkedNumber = value => { if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('INCOME_OVERFLOW'); return Number(value) }

/** A nonempty approval reference is audit metadata, not a substitute for owner authorization. */
export function parseApprovedIncomePolicy(value) {
  if (!record(value) || value.status !== 'APPROVED' || value.schemaVersion !== 'STAFF_POLICY_V1'
    || !identifier(value.policyId) || !identifier(value.version) || !identifier(value.approvalReference)
    || value.currency !== 'VND' || value.timezone !== 'Asia/Ho_Chi_Minh'
    || value.dayBasis !== 'CHECK_OUT_AT' || value.peakBasis !== 'CHECK_IN_AT'
    || !date(value.effectiveFrom) || !date(value.effectiveTo) || value.effectiveFrom > value.effectiveTo
    || !money(value.baseVnd) || !record(value.distance)
    || !money(value.distance.feePerKmVnd) || !Number.isSafeInteger(value.distance.includedMetres)
    || value.distance.includedMetres < 0 || value.distance.includedMetres > 1_000_000
    || !['FLOOR_VND', 'CEIL_VND', 'NEAREST_VND'].includes(value.distance.rounding)
    || !Array.isArray(value.peakWindows) || value.peakWindows.length > 8
    || value.incentiveMode !== 'HIGHEST_DAILY_TIER' || !Array.isArray(value.dailyIncentiveTiers)
    || value.dailyIncentiveTiers.length > 20) return null
  const minutes = new Set(), peakWindows = []
  for (const window of value.peakWindows) {
    if (!record(window) || !Number.isInteger(window.startMinute) || !Number.isInteger(window.endMinute)
      || window.startMinute < 0 || window.startMinute >= 1440 || window.endMinute < 0 || window.endMinute >= 1440
      || window.startMinute === window.endMinute || !money(window.bonusVnd)) return null
    // Explicit overnight windows are allowed; overlapping windows are ambiguous and rejected.
    for (let minute = window.startMinute; minute !== window.endMinute; minute = (minute + 1) % 1440) {
      if (minutes.has(minute)) return null
      minutes.add(minute)
    }
    peakWindows.push(Object.freeze({ startMinute: window.startMinute, endMinute: window.endMinute, bonusVnd: window.bonusVnd }))
  }
  let previousThreshold = 0, previousAmount = 0
  const dailyIncentiveTiers = []
  for (const tier of value.dailyIncentiveTiers) {
    if (!record(tier) || !Number.isSafeInteger(tier.threshold) || tier.threshold <= previousThreshold || tier.threshold > 500
      || !money(tier.amountVnd) || tier.amountVnd < previousAmount) return null
    previousThreshold = tier.threshold; previousAmount = tier.amountVnd
    dailyIncentiveTiers.push(Object.freeze({ threshold: tier.threshold, amountVnd: tier.amountVnd }))
  }
  return Object.freeze({
    schemaVersion: 'STAFF_POLICY_V1', status: 'APPROVED', policyId: value.policyId, version: value.version,
    approvalReference: value.approvalReference, currency: 'VND', timezone: 'Asia/Ho_Chi_Minh',
    effectiveFrom: value.effectiveFrom, effectiveTo: value.effectiveTo, dayBasis: 'CHECK_OUT_AT', peakBasis: 'CHECK_IN_AT',
    baseVnd: value.baseVnd, distance: Object.freeze({ feePerKmVnd: value.distance.feePerKmVnd, includedMetres: value.distance.includedMetres, rounding: value.distance.rounding }),
    peakWindows: Object.freeze(peakWindows), incentiveMode: 'HIGHEST_DAILY_TIER', dailyIncentiveTiers: Object.freeze(dailyIncentiveTiers),
  })
}

function approvedPolicy(value) {
  const policy = parseApprovedIncomePolicy(value)
  if (!policy) throw Error('INCOME_POLICY_NOT_APPROVED')
  return policy
}

function distanceCharge(assignment, evidence, policy) {
  // A client-supplied verified flag alone is never evidence. Only a trusted server adapter may supply this object.
  if (!record(evidence) || evidence.verified !== true || evidence.assignmentId !== assignment.id
    || !['ROUTE_PROVIDER', 'OPERATIONS'].includes(evidence.source) || !identifier(evidence.reference)
    || !timestamp(evidence.verifiedAt)
    || typeof evidence.kilometres !== 'string' || !/^\d{1,6}(?:\.\d{1,3})?$/.test(evidence.kilometres)) return null
  const [whole, fraction = ''] = evidence.kilometres.split('.')
  const metres = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'))
  const excess = metres > BigInt(policy.distance.includedMetres) ? metres - BigInt(policy.distance.includedMetres) : 0n
  const numerator = excess * BigInt(policy.distance.feePerKmVnd)
  const offset = policy.distance.rounding === 'CEIL_VND' ? 999n : policy.distance.rounding === 'NEAREST_VND' ? 500n : 0n
  return checkedNumber((numerator + offset) / 1000n)
}

export function calculateConfiguredIncomeLine(assignment, policyValue, distanceEvidence = null) {
  const policy = approvedPolicy(policyValue)
  if (!record(assignment) || !identifier(assignment.id) || assignment.status !== 'DONE'
    || !timestamp(assignment.checkInAt) || !timestamp(assignment.checkOutAt) || assignment.checkOutAt < assignment.checkInAt) return null
  const completed = vietnamTime(assignment.checkOutAt), day = completed.toISOString().slice(0, 10)
  if (day < policy.effectiveFrom || day > policy.effectiveTo) return null
  const start = vietnamTime(assignment.checkInAt), minute = start.getUTCHours() * 60 + start.getUTCMinutes()
  const window = policy.peakWindows.find(value => value.startMinute < value.endMinute
    ? minute >= value.startMinute && minute < value.endMinute : minute >= value.startMinute || minute < value.endMinute)
  const peakVnd = window?.bonusVnd ?? 0, distanceVnd = distanceCharge(assignment, distanceEvidence, policy)
  return Object.freeze({ assignmentId: assignment.id, day, policyId: policy.policyId, policyVersion: policy.version,
    baseVnd: policy.baseVnd, peakVnd, distanceVnd, distanceStatus: distanceVnd === null ? 'UNVERIFIED' : 'VERIFIED',
    totalVnd: checkedNumber(BigInt(policy.baseVnd) + BigInt(peakVnd) + BigInt(distanceVnd ?? 0)), stage: 'ESTIMATED' })
}

/** Caller supplies server-owned assignments for one employee. No ledger or payment state is manufactured. */
export function estimateConfiguredIncome(assignments, policyValue, evidenceByAssignment = new Map()) {
  const policy = approvedPolicy(policyValue)
  if (!Array.isArray(assignments) || assignments.length > 500 || !(evidenceByAssignment instanceof Map)) throw Error('INVALID_INCOME_INPUT')
  const ids = new Set(), days = new Map(), lines = []
  let total = 0n
  for (const assignment of assignments) {
    if (!record(assignment) || !identifier(assignment.id) || ids.has(assignment.id)) throw Error('INVALID_INCOME_ASSIGNMENT')
    ids.add(assignment.id)
    const line = calculateConfiguredIncomeLine(assignment, policy, evidenceByAssignment.get(assignment.id))
    if (line) { lines.push(line); total += BigInt(line.totalVnd); days.set(line.day, (days.get(line.day) ?? 0) + 1) }
  }
  const incentives = []
  for (const [day, count] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
    const tier = [...policy.dailyIncentiveTiers].reverse().find(value => count >= value.threshold)
    if (tier) { incentives.push({ day, eligibleCount: count, amountVnd: tier.amountVnd }); total += BigInt(tier.amountVnd) }
  }
  return { policyId: policy.policyId, policyVersion: policy.version, stage: 'ESTIMATED', lines, incentives,
    estimatedVnd: checkedNumber(total), reconciliation: { status: 'NOT_INTEGRATED', amountVnd: null }, payment: { status: 'NOT_INTEGRATED', amountVnd: null } }
}
