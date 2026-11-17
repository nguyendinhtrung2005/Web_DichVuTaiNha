import { ApiError } from './api-client'
import { allCustomerPages } from './customer-api-store'
import type { Service } from './types'

/** Use the existing Catalog filters; never substitute cached results after an API error. */
export async function searchCustomerServices(filters: { query: string; group: string; cleaningType: string }, signal?: AbortSignal): Promise<Service[]> {
  const params = new URLSearchParams()
  if (filters.query.trim()) params.set('q', filters.query.trim())
  if (filters.group) params.set('group', filters.group)
  if (filters.cleaningType) params.set('cleaningType', filters.cleaningType)
  const services = await allCustomerPages<Service>(`/catalog/services?${params}`, signal)
  if (services.some((service) => !service || typeof service.id !== 'string' || typeof service.name !== 'string' || service.status !== 'active')) {
    throw new ApiError('API trả danh sách dịch vụ không hợp lệ.', 502, 'INVALID_RESPONSE')
  }
  return services
}
