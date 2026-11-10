import { API_URL } from "@/lib/env"

export type ProductOrderStatus = "PENDING" | "COMPLETED" | "CANCELLED"

export interface ProductOrderItem {
  id: string
  productId: string
  name: string
  unit: string
  unitPrice: number
  quantity: number
  lineTotal: number
}

export interface ProductOrder {
  id: string
  customerId: string
  customerName: string
  status: ProductOrderStatus
  recipientName: string
  recipientPhone: string
  deliveryAddress: string
  note: string
  totalAmount: number
  createdAt: string
  updatedAt: string
  completedAt: string | null
  cancelledAt: string | null
  itemCount: number
  items: ProductOrderItem[]
}

export interface ProductOrderPage {
  items: ProductOrder[]
  page: number
  pageSize: number
  total: number
}

export class ProductOrderApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message)
    this.name = "ProductOrderApiError"
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_URL.replace(/\/$/, "")}/${path.replace(/^\//, "")}`, {
      ...init,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...init?.headers },
    })
  } catch {
    throw new ProductOrderApiError("Không kết nối được API đơn mua. Kiểm tra API gateway và thử lại.", 0, "NETWORK_ERROR")
  }
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error = body && typeof body === "object" && "error" in body ? body.error : null
    const message = error && typeof error === "object" && "message" in error && typeof error.message === "string"
      ? error.message
      : `Yêu cầu thất bại (HTTP ${response.status}).`
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : "REQUEST_FAILED"
    throw new ProductOrderApiError(message, response.status, code)
  }
  if (!body || typeof body !== "object" || !("data" in body)) {
    throw new ProductOrderApiError("API trả về dữ liệu đơn mua không đúng định dạng.", response.status, "INVALID_RESPONSE")
  }
  return body.data as T
}

export async function listProductOrders(filters: { search: string; status: string; page: number; pageSize: number }) {
  const query = new URLSearchParams({
    page: String(filters.page),
    pageSize: String(filters.pageSize),
    ...(filters.search ? { search: filters.search } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  })
  return request<ProductOrderPage>(`v1/admin/product-orders?${query}`)
}

export async function getProductOrder(id: string) {
  return request<ProductOrder>(`v1/admin/product-orders/${encodeURIComponent(id)}`)
}

export async function updateProductOrderStatus(id: string, status: ProductOrderStatus) {
  return request<ProductOrder>(`v1/admin/product-orders/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  })
}
