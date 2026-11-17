import { API_URL } from './env'

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string, public readonly fields?: Record<string, string>) {
    super(message)
    this.name = 'ApiError'
  }
}

/** Cookie authentication stays in the browser's HttpOnly cookie jar. */
export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  const abort = () => controller.abort()
  init.signal?.addEventListener('abort', abort, { once: true })
  if (init.signal?.aborted) controller.abort()
  try {
    const headers = new Headers(init.headers)
    headers.set('Accept', 'application/json')
    if (init.body !== undefined) headers.set('Content-Type', 'application/json')
    const response = await fetch(`${API_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`, {
      ...init, headers, credentials: 'include', cache: 'no-store', signal: controller.signal,
    })
    const body: unknown = response.status === 204 ? null : await response.json().catch(() => null)
    if (!response.ok) {
      const error = body && typeof body === 'object' && 'error' in body ? body.error as { code?: unknown; message?: unknown; fields?: Record<string, string> } : undefined
      throw new ApiError(typeof error?.message === 'string' ? error.message : `Yêu cầu API thất bại (${response.status}).`, response.status, typeof error?.code === 'string' ? error.code : 'HTTP_ERROR', error?.fields)
    }
    if (response.status === 204) return undefined as T
    if (!body || typeof body !== 'object' || !('data' in body)) throw new ApiError('API trả dữ liệu không đúng định dạng. Vui lòng thử lại.', 502, 'INVALID_RESPONSE')
    return body.data as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(controller.signal.aborted ? 'API phản hồi quá lâu. Vui lòng thử lại.' : 'Không kết nối được API. Kiểm tra backend và kết nối mạng.', 0, controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR')
  } finally {
    clearTimeout(timer)
    init.signal?.removeEventListener('abort', abort)
  }
}
