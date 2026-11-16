import { HttpError } from '../../shared/http.js';

export async function serviceReviewSummary(request, repository, serviceId) {
  const seen = new Set();
  let total, count = 0, ratingSum = 0;
  const invalid = () => new HttpError(503, 'REVIEW_SUMMARY_UNAVAILABLE', 'Chưa thể tải điểm đánh giá. Vui lòng thử lại.');
  for (let page = 1; page <= 100; page += 1) {
    let result;
    try { result = await request('order', `/internal/v1/services/${serviceId}/completed-bookings?page=${page}&limit=100`); }
    catch { throw invalid(); }
    if (!result || !Array.isArray(result.items) || result.page !== page || result.limit !== 100 || !Number.isInteger(result.total)
      || result.total < 0 || result.total > 10000 || result.items.length > 100 || (total !== undefined && total !== result.total)) throw invalid();
    total = result.total;
    const ids = result.items.map((item) => {
      if (!item || typeof item.id !== 'string' || !/^[1-9]\d{0,18}$/.test(item.id) || seen.has(item.id)) throw invalid();
      seen.add(item.id);
      return item.id;
    });
    if (seen.size > total || (seen.size < total && ids.length === 0)) throw invalid();
    const batch = await repository.summarizeBookings(ids);
    if (!batch || !Number.isSafeInteger(batch.count) || batch.count < 0 || !Number.isSafeInteger(batch.ratingSum)
      || batch.ratingSum < batch.count || batch.ratingSum > batch.count * 5) throw invalid();
    count += batch.count;
    ratingSum += batch.ratingSum;
    if (!Number.isSafeInteger(count) || !Number.isSafeInteger(ratingSum)) throw invalid();
    if (seen.size === total) return { serviceId, count, averageRating: count === 0 ? null : Math.round(ratingSum / count * 100) / 100 };
  }
  throw invalid();
}
