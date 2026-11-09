import { ApiError, apiRequest } from './api-client'

export type ServiceReviewSummary = { serviceId: string; count: number; averageRating: number | null }

export async function getServiceReviewSummary(serviceId: string, signal?: AbortSignal): Promise<ServiceReviewSummary> {
  const result = await apiRequest<ServiceReviewSummary>(`/reviews/service-summary?serviceId=${encodeURIComponent(serviceId)}`, { signal })
  if (!result || result.serviceId !== serviceId || !Number.isSafeInteger(result.count) || result.count < 0
    || (result.count === 0 ? result.averageRating !== null : typeof result.averageRating !== 'number' || !Number.isFinite(result.averageRating) || result.averageRating < 1 || result.averageRating > 5)) {
    throw new ApiError('API trả điểm đánh giá không hợp lệ.', 502, 'INVALID_RESPONSE')
  }
  return result
}
