/** Illustrative review and achievement data for the Staff UI only; this is not an approved Backend DTO. */
export type ReviewRating = 1 | 2 | 3 | 4 | 5
export type DemoReview = { id: string; rating: ReviewRating; comment: string; reviewedAt: string; serviceType: string; referenceCode: string }
export type ReviewFilter = { stars: "ALL" | ReviewRating; from: string; to: string }
export type DemoAchievement = { id: string; title: string; description: string; kind: "BADGE" | "GOAL"; target: number; progress: number; unit: string; rule: string }
export type ReviewSummary = { average: number | null; total: number; distribution: Record<"1" | "2" | "3" | "4" | "5", number> }
export type AchievementsSnapshot = { filter: ReviewFilter; reviews: DemoReview[]; filtered: DemoReview[]; summary: ReviewSummary; filteredSummary: ReviewSummary; achievements: DemoAchievement[] }
/** Frontend presentation boundary; a Review API adapter can replace this without touching the UI. */
export interface AchievementsDemoAdapter {
  readonly kind: "demo" | "unavailable"
  read(filter: ReviewFilter, signal?: AbortSignal): Promise<AchievementsSnapshot | null>
  detail(id: string, signal?: AbortSignal): Promise<DemoReview | null>
  reset(signal?: AbortSignal): Promise<AchievementsSnapshot | null>
}
export class AchievementsDemoError extends Error {
  constructor(message: string) { super(message); this.name = "AchievementsDemoError" }
}
export const ACHIEVEMENT_DISCLAIMER = "Huy hiệu và mục tiêu ở đây là giả định DEMO; không tạo thưởng tiền, tăng lương, KPI chính thức hoặc quyết định nhân sự."
const DAY = 86_400_000, OFFSET = 7 * 3_600_000
const DATE = /^\d{4}-\d{2}-\d{2}$/
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const RATING = [1, 2, 3, 4, 5] as const
export function isReviewDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value) || value < "1971-01-01" || value > "2099-12-31") return false
  const parsed = Date.parse(value + "T00:00:00.000Z")
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
}
function assertDate(value: unknown): asserts value is string {
  if (!isReviewDate(value)) throw new AchievementsDemoError("Ngày minh họa phải hợp lệ trong khoảng 1971–2099.")
}
function canonicalTime(value: unknown): value is string {
  return typeof value === "string" && ISO.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}
/** Vietnam calendar day (UTC+7) of a canonical timestamp. */
export function reviewDay(value: string): string {
  if (!canonicalTime(value)) throw new AchievementsDemoError("Thời điểm đánh giá minh họa không hợp lệ.")
  const day = new Date(Date.parse(value) + OFFSET).toISOString().slice(0, 10)
  assertDate(day); return day
}
export function formatReviewDate(value: string): string {
  if (!canonicalTime(value)) return "Ngày không hợp lệ"
  const day = reviewDay(value); return day.slice(8, 10) + "/" + day.slice(5, 7) + "/" + day.slice(0, 4)
}
const REVIEWS: readonly Readonly<DemoReview>[] = Object.freeze([
  { id: "DEMO-REV-001", rating: 5, comment: "Rất gọn gàng, đúng giờ và thân thiện. Không gian sạch hơn mong đợi.", reviewedAt: "2026-10-24T03:00:00.000Z", serviceType: "Dọn dẹp nhà", referenceCode: "DEMO-REF-101" },
  { id: "DEMO-REV-002", rating: 5, comment: "Làm việc kỹ, dọn khu vực bếp và cửa kính rất sạch.", reviewedAt: "2026-10-20T02:30:00.000Z", serviceType: "Vệ sinh văn phòng", referenceCode: "DEMO-REF-102" },
  { id: "DEMO-REV-003", rating: 4, comment: "Ghế sofa sạch và khô đúng hẹn; cần thêm thời gian ở góc khuất.", reviewedAt: "2026-10-17T07:00:00.000Z", serviceType: "Giặt ghế sofa", referenceCode: "DEMO-REF-103" },
  { id: "DEMO-REV-004", rating: 3, comment: "Cây được tưới đủ nhưng chưa trao đổi kỹ về lịch chăm sóc.", reviewedAt: "2026-10-12T01:00:00.000Z", serviceType: "Chăm sóc cây", referenceCode: "DEMO-REF-104" },
  { id: "DEMO-REV-005", rating: 5, comment: "Chu đáo và giữ thái độ tích cực trong suốt buổi làm.", reviewedAt: "2026-10-08T05:00:00.000Z", serviceType: "Dọn dẹp nhà", referenceCode: "DEMO-REF-105" },
  { id: "DEMO-REV-006", rating: 2, comment: "Đến muộn hơn giờ minh họa và thiếu một dụng cụ đã ghi trong bản mô tả.", reviewedAt: "2026-10-03T02:00:00.000Z", serviceType: "Vệ sinh văn phòng", referenceCode: "DEMO-REF-106" },
  { id: "DEMO-REV-007", rating: 4, comment: "Hoàn thành đúng khối lượng minh họa, giao tiếp rõ ràng.", reviewedAt: "2026-09-29T03:30:00.000Z", serviceType: "Dọn dẹp nhà", referenceCode: "DEMO-REF-107" },
  { id: "DEMO-REV-008", rating: 5, comment: "Xử lý vết bẩn tốt, giữ khu vực gọn trong lúc làm.", reviewedAt: "2026-09-24T08:00:00.000Z", serviceType: "Giặt ghế sofa", referenceCode: "DEMO-REF-108" },
  { id: "DEMO-REV-009", rating: 1, comment: "Chưa đúng phạm vi minh họa đã mô tả; cần xem lại hướng dẫn trước khi nhận.", reviewedAt: "2026-09-18T06:00:00.000Z", serviceType: "Chăm sóc cây", referenceCode: "DEMO-REF-109" },
  { id: "DEMO-REV-010", rating: 4, comment: "Đúng hẹn, thao tác an toàn và dọn dẹp dụng cụ sau khi xong.", reviewedAt: "2026-09-13T02:00:00.000Z", serviceType: "Vệ sinh văn phòng", referenceCode: "DEMO-REF-110" },
  { id: "DEMO-REV-011", rating: 5, comment: "Trao đổi trước khi làm và hỏi lại yêu cầu rất rõ ràng.", reviewedAt: "2026-09-08T04:00:00.000Z", serviceType: "Dọn dẹp nhà", referenceCode: "DEMO-REF-111" },
  { id: "DEMO-REV-012", rating: 3, comment: "Kết quả minh họa ở mức ổn; phần ghế cần làm lại lần hai.", reviewedAt: "2026-09-05T03:00:00.000Z", serviceType: "Giặt ghế sofa", referenceCode: "DEMO-REF-112" },
].map(value => Object.freeze(value as DemoReview)))
export function demoReviews(): DemoReview[] { return REVIEWS.map(value => ({ ...value })) }
export function defaultReviewFilter(): ReviewFilter {
  const days = REVIEWS.map(value => reviewDay(value.reviewedAt)).sort()
  return { stars: "ALL", from: days[0], to: days[days.length - 1] }
}
export function validateFilter(input: unknown): ReviewFilter {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AchievementsDemoError("Bộ lọc đánh giá minh họa không hợp lệ.")
  const value = input as Record<string, unknown>
  if (Object.keys(value).length !== 3 || !Object.prototype.hasOwnProperty.call(value, "stars") || !Object.prototype.hasOwnProperty.call(value, "from") || !Object.prototype.hasOwnProperty.call(value, "to")) throw new AchievementsDemoError("Bộ lọc minh họa chỉ nhận số sao và khoảng ngày.")
  const stars = value.stars
  if (stars !== "ALL" && !(typeof stars === "number" && RATING.includes(stars as ReviewRating))) throw new AchievementsDemoError("Số sao lọc phải là Tất cả hoặc từ 1 đến 5.")
  assertDate(value.from); assertDate(value.to)
  if (value.from > value.to) throw new AchievementsDemoError("Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.")
  if ((Date.parse(value.to + "T00:00:00.000Z") - Date.parse(value.from + "T00:00:00.000Z")) / DAY > 366) throw new AchievementsDemoError("Khoảng ngày minh họa tối đa 366 ngày.")
  return { stars: stars as "ALL" | ReviewRating, from: value.from, to: value.to }
}
export function summarizeReviews(reviews: readonly DemoReview[]): ReviewSummary {
  const distribution: Record<"1" | "2" | "3" | "4" | "5", number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 }
  let sum = 0
  for (const review of reviews) { const item = validateReview(review); distribution[String(item.rating) as "1" | "2" | "3" | "4" | "5"] += 1; sum += item.rating }
  const total = reviews.length
  return { average: total ? Math.round((sum / total) * 10) / 10 : null, total, distribution }
}
export function filterReviews(reviews: readonly DemoReview[], filter: ReviewFilter): DemoReview[] {
  const value = validateFilter(filter)
  return reviews.map(review => validateReview(review)).filter(review => {
    const day = reviewDay(review.reviewedAt)
    return day >= value.from && day <= value.to && (value.stars === "ALL" || review.rating === value.stars)
  })
}
export function validateReview(input: unknown): DemoReview {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AchievementsDemoError("Đánh giá minh họa không hợp lệ.")
  const value = input as Record<string, unknown>
  const keys = Object.keys(value)
  if (keys.length !== 6 || !["id", "rating", "comment", "reviewedAt", "serviceType", "referenceCode"].every(key => Object.prototype.hasOwnProperty.call(value, key))) throw new AchievementsDemoError("Đánh giá minh họa chỉ nhận các trường hiển thị đã duyệt.")
  if (typeof value.id !== "string" || !/^DEMO-REV-\d{3}$/.test(value.id) || typeof value.referenceCode !== "string" || !/^DEMO-REF-\d{3}$/.test(value.referenceCode)
    || !RATING.includes(value.rating as ReviewRating) || typeof value.comment !== "string" || !value.comment.trim() || value.comment.length > 500
    || typeof value.serviceType !== "string" || !value.serviceType.trim() || value.serviceType.length > 80 || !canonicalTime(value.reviewedAt)) throw new AchievementsDemoError("Nội dung đánh giá minh họa không hợp lệ.")
  return { id: value.id, rating: value.rating as ReviewRating, comment: value.comment, reviewedAt: value.reviewedAt, serviceType: value.serviceType, referenceCode: value.referenceCode }
}
export function validateAchievement(input: unknown): DemoAchievement {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AchievementsDemoError("Thành tích minh họa không hợp lệ.")
  const value = input as Record<string, unknown>
  const keys = Object.keys(value)
  if (keys.length !== 8 || !["id", "title", "description", "kind", "target", "progress", "unit", "rule"].every(key => Object.prototype.hasOwnProperty.call(value, key))) throw new AchievementsDemoError("Thành tích minh họa chỉ nhận các trường hiển thị đã duyệt.")
  if (typeof value.id !== "string" || !/^DEMO-(BADGE|GOAL)-[A-Z0-9-]{1,60}$/.test(value.id) || !["BADGE", "GOAL"].includes(value.kind as string)
    || typeof value.title !== "string" || !value.title.trim() || value.title.length > 80 || typeof value.description !== "string" || !value.description.trim() || value.description.length > 240
    || typeof value.unit !== "string" || !value.unit.trim() || value.unit.length > 40 || typeof value.rule !== "string" || !value.rule.trim() || value.rule.length > 240
    || !Number.isInteger(value.target) || (value.target as number) < 1 || (value.target as number) > 1000
    || !Number.isInteger(value.progress) || (value.progress as number) < 0 || (value.progress as number) > (value.target as number)) throw new AchievementsDemoError("Mục tiêu hoặc tiến độ minh họa không hợp lệ.")
  return { id: value.id, title: value.title, description: value.description, kind: value.kind as "BADGE" | "GOAL", target: value.target as number, progress: value.progress as number, unit: value.unit, rule: value.rule }
}
export function demoAchievements(): DemoAchievement[] {
  const fiveStar = REVIEWS.filter(value => value.rating === 5).length, positive = REVIEWS.filter(value => value.rating >= 4).length
  return [
    { id: "DEMO-BADGE-FIVE-STAR", title: "Ngôi sao năm sao", description: "Nhận đủ lượt đánh giá 5 sao trong bộ dữ liệu minh họa.", kind: "BADGE", target: 5, progress: Math.min(fiveStar, 5), unit: "lượt 5 sao", rule: "Giả định DEMO: đạt 5 lượt 5 sao trong bộ dữ liệu minh họa; không phải quy chế CleanHome." },
    { id: "DEMO-BADGE-POSITIVE", title: "Phản hồi tích cực", description: "Duy trì các đánh giá từ 4 sao trở lên trong bộ dữ liệu minh họa.", kind: "BADGE", target: 10, progress: Math.min(positive, 10), unit: "lượt từ 4 sao", rule: "Giả định DEMO: đạt 10 lượt từ 4 sao; không phải điều kiện thưởng hay KPI chính thức." },
    { id: "DEMO-GOAL-REVIEWS", title: "Hoàn tất 10 lượt đánh giá", description: "Mục tiêu số lượt đánh giá minh họa đã nhận trong bộ dữ liệu.", kind: "GOAL", target: 10, progress: Math.min(REVIEWS.length, 10), unit: "lượt đánh giá", rule: "Giả định DEMO: mục tiêu 10 lượt đánh giá minh họa; không suy ra thưởng tiền hoặc tăng lương." },
    { id: "DEMO-GOAL-FIVE-STAR", title: "Nhận thêm đánh giá 5 sao", description: "Mục tiêu minh họa cho số lượt 5 sao còn thiếu.", kind: "GOAL", target: 8, progress: Math.min(fiveStar, 8), unit: "lượt 5 sao", rule: "Giả định DEMO: mục tiêu 8 lượt 5 sao; không phải KPI chính thức hoặc cam kết của CleanHome." },
  ].map(value => validateAchievement(value))
}
