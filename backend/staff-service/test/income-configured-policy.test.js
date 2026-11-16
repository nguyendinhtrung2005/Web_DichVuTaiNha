import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parseApprovedIncomePolicy, calculateConfiguredIncomeLine, estimateConfiguredIncome } from '../src/income-configured-policy.js'
import { DEMO_INCOME_POLICY } from '../src/income-policy.js'

// Test-only rates. No business owner has approved this fixture as a real policy.
const policy = (overrides = {}) => ({
  schemaVersion: 'STAFF_POLICY_V1', status: 'APPROVED', policyId: 'UNIT_TEST_ONLY', version: 'unit-1', approvalReference: 'UNIT_TEST_NOT_BUSINESS_APPROVAL',
  currency: 'VND', timezone: 'Asia/Ho_Chi_Minh', effectiveFrom: '2026-11-01', effectiveTo: '2026-11-30', dayBasis: 'CHECK_OUT_AT', peakBasis: 'CHECK_IN_AT',
  baseVnd: 41000, distance: { feePerKmVnd: 1750, includedMetres: 2000, rounding: 'NEAREST_VND' },
  peakWindows: [{ startMinute: 1020, endMinute: 1200, bonusVnd: 7000 }], incentiveMode: 'HIGHEST_DAILY_TIER',
  dailyIncentiveTiers: [{ threshold: 2, amountVnd: 11000 }, { threshold: 4, amountVnd: 27000 }], ...overrides,
})
const assignment = (overrides = {}) => ({ id: '1', status: 'DONE', checkInAt: '2026-11-04T10:00:00.000Z', checkOutAt: '2026-11-04T11:00:00.000Z', ...overrides })
const evidence = (overrides = {}) => ({ assignmentId: '1', verified: true, source: 'ROUTE_PROVIDER', reference: 'unit-route-1', verifiedAt: '2026-11-04T09:00:00.000Z', kilometres: '3.001', ...overrides })

test('configured policy has no default and rejects demo or unapproved policy', () => {
  for (const value of [undefined, null, DEMO_INCOME_POLICY, policy({ status: 'DRAFT' }), policy({ approvalReference: '' }), policy({ version: '' })]) {
    assert.equal(parseApprovedIncomePolicy(value), null)
    assert.throws(() => calculateConfiguredIncomeLine(assignment(), value), /INCOME_POLICY_NOT_APPROVED/)
  }
})

test('configured policy requires explicit periods, rounding and unambiguous incentive rules', () => {
  const invalid = [
    policy({ effectiveFrom: '2026-02-30' }), policy({ effectiveTo: '2026-10-31' }), policy({ baseVnd: 0.1 }), policy({ currency: 'USD' }),
    policy({ timezone: 'UTC' }), policy({ dayBasis: 'SCHEDULED_AT' }), policy({ incentiveMode: 'STACK_ALL' }),
    policy({ distance: { feePerKmVnd: 1000, includedMetres: 0 } }),
    policy({ peakWindows: [{ startMinute: 0, endMinute: 0, bonusVnd: 1 }] }),
    policy({ peakWindows: [{ startMinute: 100, endMinute: 200, bonusVnd: 1 }, { startMinute: 150, endMinute: 300, bonusVnd: 2 }] }),
    policy({ dailyIncentiveTiers: [{ threshold: 4, amountVnd: 2 }, { threshold: 2, amountVnd: 4 }] }),
  ]
  for (const value of invalid) assert.equal(parseApprovedIncomePolicy(value), null)
  const parsed = parseApprovedIncomePolicy(policy())
  assert.ok(parsed)
  assert.ok(Object.isFrozen(parsed.distance))
  assert.ok(Object.isFrozen(parsed.dailyIncentiveTiers[0]))
})

test('all configured components use supplied rates and explicit money rounding', () => {
  const line = calculateConfiguredIncomeLine(assignment(), policy(), evidence())
  assert.equal(line.baseVnd, 41000)
  assert.equal(line.peakVnd, 7000)
  assert.equal(line.distanceVnd, 1752)
  assert.equal(line.totalVnd, 49752)
  assert.equal(line.stage, 'ESTIMATED')
  const expected = { FLOOR_VND: 1751, CEIL_VND: 1752, NEAREST_VND: 1752 }
  for (const [rounding, amount] of Object.entries(expected)) {
    assert.equal(calculateConfiguredIncomeLine(assignment(), policy({ distance: { ...policy().distance, rounding } }), evidence()).distanceVnd, amount)
  }
})

test('distance needs trusted evidence bound to this assignment and never converts missing evidence to zero', () => {
  for (const value of [null, { verified: true, kilometres: '9' }, evidence({ assignmentId: '2' }), evidence({ source: 'BROWSER' }),
    evidence({ reference: '' }), evidence({ verifiedAt: 'invalid' }), evidence({ kilometres: '-1' }), evidence({ kilometres: 3 })]) {
    const line = calculateConfiguredIncomeLine(assignment(), policy(), value)
    assert.equal(line.distanceVnd, null)
    assert.equal(line.distanceStatus, 'UNVERIFIED')
    assert.equal(line.totalVnd, 48000)
  }
  assert.equal(calculateConfiguredIncomeLine(assignment(), policy(), evidence({ kilometres: '2.000' })).distanceVnd, 0)
})

test('peak boundaries and overnight windows follow actual Vietnam check-in', () => {
  for (const [time, expected] of [['09:59:59.999', 0], ['10:00:00.000', 7000], ['12:59:59.999', 7000], ['13:00:00.000', 0]]) {
    assert.equal(calculateConfiguredIncomeLine(assignment({ checkInAt: '2026-11-04T' + time + 'Z', checkOutAt: '2026-11-04T16:00:00.000Z' }), policy()).peakVnd, expected)
  }
  const overnight = policy({ peakWindows: [{ startMinute: 1320, endMinute: 120, bonusVnd: 1200 }] })
  assert.equal(calculateConfiguredIncomeLine(assignment({ checkInAt: '2026-11-04T16:00:00.000Z', checkOutAt: '2026-11-04T18:00:00.000Z' }), overnight).peakVnd, 1200)
})

test('only valid DONE completion days inside policy effective range are estimated', () => {
  for (const value of [assignment({ status: 'CANCELLED' }), assignment({ checkInAt: null }), assignment({ checkOutAt: '2026-11-04T09:00:00.000Z' }),
    assignment({ checkOutAt: '2026-12-01T00:00:00.000Z' }), assignment({ checkInAt: '2026-10-31T10:00:00.000Z', checkOutAt: '2026-10-31T16:59:59.999Z' })]) {
    assert.equal(calculateConfiguredIncomeLine(value, policy()), null)
  }
  assert.equal(calculateConfiguredIncomeLine(assignment({ checkInAt: '2026-10-31T16:00:00.000Z', checkOutAt: '2026-10-31T17:00:00.000Z' }), policy()).day, '2026-11-01')
})

test('highest qualifying configured tier is awarded once per completion day in an estimate only', () => {
  for (const [count, incentive] of [[1, 0], [2, 11000], [4, 27000], [8, 27000]]) {
    const result = estimateConfiguredIncome(Array.from({ length: count }, (_, i) => assignment({ id: String(i + 1) })), policy())
    assert.equal(result.estimatedVnd, count * 48000 + incentive)
    assert.equal(result.incentives.reduce((total, value) => total + value.amountVnd, 0), incentive)
    assert.deepEqual(result.reconciliation, { status: 'NOT_INTEGRATED', amountVnd: null })
    assert.deepEqual(result.payment, { status: 'NOT_INTEGRATED', amountVnd: null })
  }
  assert.throws(() => estimateConfiguredIncome([assignment(), assignment()], policy()), /INVALID_INCOME_ASSIGNMENT/)
})

test('excessive aggregate money fails instead of rounding an unsafe number', () => {
  const high = policy({ distance: { feePerKmVnd: 1_000_000_000, includedMetres: 0, rounding: 'FLOOR_VND' } })
  const assignments = Array.from({ length: 10 }, (_, i) => assignment({ id: String(i + 1) }))
  const distances = new Map(assignments.map(value => [value.id, evidence({ assignmentId: value.id, kilometres: '999999.999' })]))
  assert.throws(() => estimateConfiguredIncome(assignments, high, distances), /INCOME_OVERFLOW/)
})

test('configured policy is isolated from the existing demo route and has no environment defaults', async () => {
  const [service, module] = await Promise.all([
    readFile(new URL('../src/income-service.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/income-configured-policy.js', import.meta.url), 'utf8'),
  ])
  assert.doesNotMatch(service, /income-configured-policy/)
  assert.doesNotMatch(module, /process\.env|DEMO_INCOME_POLICY|fetch\(|\b(?:INSERT|UPDATE|DELETE)\b/)
})
