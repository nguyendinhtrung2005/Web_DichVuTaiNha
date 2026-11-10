import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import test from 'node:test'
const require = createRequire(import.meta.url), ts = require('typescript')
const root = new URL('../../../packages/ui/src/components/staff/', import.meta.url)
function load(environment = 'development', globals = {}) {
  const cache = new Map()
  function source(name) {
    if (cache.has(name)) return cache.get(name)
    const filename = fileURLToPath(new URL(name, root)), module = { exports: {} }
    const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText
    vm.runInNewContext(code, { module, exports: module.exports, AbortController, DOMException, process: { env: { NODE_ENV: environment } }, ...globals, require(id) {
      if (id === './staff-achievements-demo-model') return source('staff-achievements-demo-model.ts')
      throw Error('Unexpected achievements demo dependency')
    } }, { filename, timeout: 2000 })
    cache.set(name, module.exports); return module.exports
  }
  return { ...source('staff-achievements-demo-model.ts'), ...source('staff-achievements-demo-adapter.ts') }
}
const plain = value => JSON.parse(JSON.stringify(value))
const adapter = (m, accountScope = '101') => m.createAchievementsDemoAdapter({ enabled: true, accountScope })
const filter = (m, overrides = {}) => ({ ...m.defaultReviewFilter(), ...overrides })

test('reviews and achievements are fictional deterministic unique data without real identities', () => {
  const m = load(), reviews = m.demoReviews(), achievements = m.demoAchievements()
  assert.equal(reviews.length, 12); assert.equal(new Set(reviews.map(r => r.id)).size, 12)
  assert.equal(new Set(reviews.map(r => r.referenceCode)).size, 12)
  assert.equal(achievements.length, 4)
  for (const review of reviews) {
    assert.match(review.id, /^DEMO-REV-\d{3}$/); assert.match(review.referenceCode, /^DEMO-REF-\d{3}$/)
    assert.ok(review.rating >= 1 && review.rating <= 5); assert.deepEqual(plain(m.validateReview(review)), plain(review))
    for (const key of ['userId', 'employeeId', 'assignmentId', 'bookingId', 'customerName', 'address', 'phone', 'password', 'accessToken', 'staffId']) assert.equal(key in review, false)
  }
  for (const item of achievements) { assert.match(item.id, /^DEMO-(BADGE|GOAL)-/); assert.match(item.rule, /DEMO|giả định/i); assert.ok(item.progress <= item.target) }
  reviews[0].comment = 'Mutated'; achievements[0].title = 'Changed'
  assert.notEqual(m.demoReviews()[0].comment, 'Mutated'); assert.notEqual(m.demoAchievements()[0].title, 'Changed')
})

test('summary computes the illustrative average and 1-5 star distribution', () => {
  const m = load(), summary = m.summarizeReviews(m.demoReviews())
  assert.equal(summary.total, 12); assert.equal(summary.average, 3.8)
  assert.deepEqual(plain(summary.distribution), { 1: 1, 2: 1, 3: 2, 4: 3, 5: 5 })
  assert.equal(m.summarizeReviews([]).average, null); assert.equal(m.summarizeReviews([]).total, 0)
  assert.deepEqual(plain(m.summarizeReviews([]).distribution), { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 })
  assert.deepEqual(plain(m.summarizeReviews([m.demoReviews()[0]])), { average: 5, total: 1, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 } })
})

test('star and date filters are inclusive and never invent matching reviews', () => {
  const m = load(), reviews = m.demoReviews()
  assert.equal(m.filterReviews(reviews, filter(m)).length, 12)
  assert.equal(m.filterReviews(reviews, filter(m, { stars: 5 })).length, 5)
  assert.equal(m.filterReviews(reviews, filter(m, { stars: 1 })).length, 1)
  const october = m.filterReviews(reviews, filter(m, { from: '2026-10-01', to: '2026-10-31' }))
  assert.equal(october.length, 6); assert.ok(october.every(r => m.reviewDay(r.reviewedAt) >= '2026-10-01' && m.reviewDay(r.reviewedAt) <= '2026-10-31'))
  assert.equal(m.filterReviews(reviews, filter(m, { from: '2026-09-05', to: '2026-09-05' })).length, 1)
  assert.equal(m.filterReviews(reviews, filter(m, { stars: 4, from: '2026-10-01', to: '2026-10-31' })).length, 1)
  assert.deepEqual(plain(m.filterReviews(reviews, filter(m, { from: '2026-11-01', to: '2026-11-30' }))), [])
  assert.equal(m.summarizeReviews(m.filterReviews(reviews, filter(m, { stars: 5 }))).average, 5)
})

test('filter validation refuses unknown fields, bad stars and unsafe ranges', () => {
  const m = load(), valid = m.defaultReviewFilter()
  for (const value of [null, [], {}, { ...valid, stars: 0 }, { ...valid, stars: 6 }, { ...valid, stars: '5' }, { ...valid, stars: 'ALL', extra: true }, { ...valid, from: '2026-02-29' }, { ...valid, to: '2100-01-01' }, { ...valid, from: '2026-10-24', to: '2026-10-01' }, { ...valid, from: '2026-01-01', to: '2027-01-03' }, { stars: 'ALL', from: '2026-01-01' }]) assert.throws(() => m.validateFilter(value), { name: 'AchievementsDemoError' })
  assert.deepEqual(plain(m.validateFilter({ stars: 'ALL', from: '2026-01-01', to: '2027-01-02' })), { stars: 'ALL', from: '2026-01-01', to: '2027-01-02' })
  assert.deepEqual(plain(m.defaultReviewFilter()), { stars: 'ALL', from: '2026-09-05', to: '2026-10-24' })
})

test('review validation refuses malformed ratings, references and unapproved fields', () => {
  const m = load(), review = m.demoReviews()[0]
  for (const value of [null, {}, { ...review, id: 'REV-1' }, { ...review, referenceCode: 'REF-1' }, { ...review, rating: 0 }, { ...review, rating: 6 }, { ...review, rating: '5' }, { ...review, comment: '' }, { ...review, comment: 'x'.repeat(501) }, { ...review, serviceType: '' }, { ...review, reviewedAt: '2026-10-24T03:00:00+07:00' }, { ...review, employeeId: '101' }, { ...review, customerName: 'QA' }]) assert.throws(() => m.validateReview(value), { name: 'AchievementsDemoError' })
})

test('achievements expose demo assumptions, capped progress and no monetary claim', () => {
  const m = load(), achievements = m.demoAchievements(), byId = Object.fromEntries(achievements.map(a => [a.id, a]))
  assert.equal(byId['DEMO-BADGE-FIVE-STAR'].progress, 5); assert.equal(byId['DEMO-BADGE-FIVE-STAR'].progress, byId['DEMO-BADGE-FIVE-STAR'].target)
  assert.equal(byId['DEMO-BADGE-POSITIVE'].progress, 8); assert.ok(byId['DEMO-BADGE-POSITIVE'].progress < byId['DEMO-BADGE-POSITIVE'].target)
  assert.equal(byId['DEMO-GOAL-REVIEWS'].progress, 10); assert.equal(byId['DEMO-GOAL-FIVE-STAR'].progress, 5)
  assert.equal(achievements.filter(a => a.progress >= a.target).length, 2)
  assert.match(m.ACHIEVEMENT_DISCLAIMER, /không tạo thưởng tiền/); assert.match(m.ACHIEVEMENT_DISCLAIMER, /KPI/)
  for (const item of achievements) assert.doesNotMatch(item.rule, /(thưởng tiền|tăng lương) (cho|sẽ)/i)
  for (const value of [{ ...achievements[0], target: 0 }, { ...achievements[0], progress: 6 }, { ...achievements[0], progress: 1.5 }, { ...achievements[0], kind: 'REWARD' }, { ...achievements[0], money: 100 }]) assert.throws(() => m.validateAchievement(value), { name: 'AchievementsDemoError' })
})

test('read detail and returned objects cannot mutate private demo data', async () => {
  const m = load(), a = adapter(m), value = await a.read(m.defaultReviewFilter())
  assert.deepEqual(plain(value.filter), plain(m.defaultReviewFilter())); assert.equal(value.reviews.length, 12); assert.equal(value.filtered.length, 12)
  value.reviews[0].comment = 'Changed'; value.filtered.length = 0; value.achievements[0].progress = 0
  const next = await a.read(m.defaultReviewFilter())
  assert.notEqual(next.reviews[0].comment, 'Changed'); assert.equal(next.filtered.length, 12); assert.equal(next.achievements[0].progress, 5)
  const detail = await a.detail('DEMO-REV-001'); detail.comment = 'Changed'
  assert.notEqual((await a.detail('DEMO-REV-001')).comment, 'Changed'); assert.equal(await a.detail('DEMO-REV-999'), null)
})

test('reset restores the default filter and seed while A and B stay isolated', async () => {
  const m = load(), a = adapter(m, '9007199254740993'), b = adapter(m, '9007199254740994')
  await a.read(filter(m, { stars: 5, from: '2026-10-01', to: '2026-10-31' }))
  assert.deepEqual(plain((await b.read(filter(m, { stars: 1 }))).filtered.length), 1)
  assert.deepEqual(plain((await a.read(m.defaultReviewFilter())).filtered.length), 12)
  const reset = await a.reset()
  assert.deepEqual(plain(reset.filter), plain(m.defaultReviewFilter())); assert.equal(reset.filtered.length, 12)
  assert.equal((await b.read(m.defaultReviewFilter())).filtered.length, 12)
  const fresh = await adapter(m, '9007199254740994').read(m.defaultReviewFilter())
  assert.ok(!JSON.stringify(fresh).includes('9007199254740994')); assert.ok(!JSON.stringify(fresh).includes('9007199254740993'))
})

test('aborted reads details and resets cannot commit or leak demo state', async () => {
  const m = load(), a = adapter(m), initial = await a.read(m.defaultReviewFilter())
  for (const operation of [s => a.read(filter(m, { stars: 5 }), s), s => a.detail('DEMO-REV-001', s), s => a.reset(s)]) {
    const controller = new AbortController(), promise = operation(controller.signal); controller.abort()
    await assert.rejects(promise, { name: 'AbortError' }); assert.deepEqual(plain(await a.read(m.defaultReviewFilter())), plain(initial))
  }
})

test('development flag and canonical account scopes fail closed for every other mode', async () => {
  for (const environment of ['production', 'test', '']) {
    const m = load(environment), a = adapter(m)
    assert.equal(a.kind, 'unavailable'); assert.equal(await a.read(m.defaultReviewFilter()), null); assert.equal(await a.detail('DEMO-REV-001'), null); assert.equal(await a.reset(), null)
  }
  const m = load()
  for (const enabled of [false, 'true', 1, undefined]) assert.equal(m.createAchievementsDemoAdapter({ enabled, accountScope: '101' }).kind, 'unavailable')
  for (const accountScope of ['', '0', '01', '-1', '101,102', '9223372036854775808', 101, null]) assert.equal(m.createAchievementsDemoAdapter({ enabled: true, accountScope }).kind, 'unavailable')
  for (const promise of [adapter(load('production')).read(m.defaultReviewFilter())]) assert.equal(await promise, null)
})

test('demo reads never need network browser storage Auth or UC capabilities', async () => {
  const forbidden = () => { throw Error('Forbidden external capability') }
  const m = load('development', { fetch: forbidden, XMLHttpRequest: forbidden, localStorage: { getItem: forbidden, setItem: forbidden }, sessionStorage: { getItem: forbidden, setItem: forbidden }, navigator: new Proxy({}, { get: forbidden }), window: new Proxy({}, { get: forbidden }), document: new Proxy({}, { get: forbidden }) })
  const a = adapter(m)
  const value = await a.read(filter(m, { stars: 4 })); await a.detail(value.filtered[0].id); await a.reset()
  assert.equal(value.filtered.length, 3); assert.equal((await a.read(m.defaultReviewFilter())).filtered.length, 12)
})
