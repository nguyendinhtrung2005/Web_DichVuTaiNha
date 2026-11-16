import { AchievementsDemoError, defaultReviewFilter, demoAchievements, demoReviews, filterReviews, summarizeReviews, validateFilter, validateReview, type AchievementsDemoAdapter, type AchievementsSnapshot, type DemoReview, type ReviewFilter } from "./staff-achievements-demo-model"
export { AchievementsDemoError } from "./staff-achievements-demo-model"
function abort(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException("Demo operation aborted", "AbortError") }
function unavailable(): AchievementsDemoAdapter {
  const reject = () => { throw new AchievementsDemoError("Đánh giá và thành tích minh họa chưa được bật.") }
  return {
    kind: "unavailable",
    async read(_filter, signal) { abort(signal); return null },
    async detail(_id, signal) { abort(signal); return null },
    async reset(signal) { abort(signal); return null },
  }
}
/** Account IDs scope private component instances; reviews are fictional and never come from Auth, bookings or UC events. */
export function createAchievementsDemoAdapter({ enabled, accountScope }: { enabled: boolean; accountScope: string }): AchievementsDemoAdapter {
  if (enabled !== true || process.env.NODE_ENV !== "development" || typeof accountScope !== "string" || !/^[1-9]\d{0,18}$/.test(accountScope) || BigInt(accountScope) > 9_223_372_036_854_775_807n) return unavailable()
  let filter = defaultReviewFilter()
  function snapshot(): AchievementsSnapshot {
    const reviews = demoReviews(), filtered = filterReviews(reviews, filter)
    return { filter: { ...filter }, reviews, filtered, summary: summarizeReviews(reviews), filteredSummary: summarizeReviews(filtered), achievements: demoAchievements() }
  }
  async function prepare(signal?: AbortSignal) { abort(signal); await Promise.resolve(); abort(signal) }
  return {
    kind: "demo",
    async read(next: ReviewFilter, signal) { await prepare(signal); filter = validateFilter(next); return snapshot() },
    async detail(id: string, signal) { await prepare(signal); const found = demoReviews().find(value => value.id === id); return found ? validateReview(found) : null },
    async reset(signal) { await prepare(signal); filter = defaultReviewFilter(); return snapshot() },
  }
}
