import {API_URL} from './env'
/** Dành cho giai đoạn kết nối backend. Giao diện hiện dùng store demo, chưa gọi API này.
 * Backend phải cấu hình CORS theo tên miền, xác thực phiên và kiểm tra quyền ở mỗi API.
 */
export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`, {
    ...init,
    credentials: 'include',
    headers: {'Content-Type':'application/json', ...init.headers},
  })
  if (!response.ok) throw new Error(`Yêu cầu API thất bại (${response.status}).`)
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}
