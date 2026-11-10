import { API_URL } from "@/lib/env"

export type ProductStatus = "AVAILABLE" | "OUT_OF_STOCK" | "INACTIVE"

export interface ProductCategory {
  id: string
  name: string
  description: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface ProductImage {
  id?: string
  imageUrl: string
  isPrimary: boolean
  sortOrder: number
}

export interface AdminProduct {
  id: string
  categoryId: string
  categoryName: string
  name: string
  description: string
  unit: string
  price: number
  status: ProductStatus
  inventory: {
    quantity: number
    reservedQuantity: number
    availableQuantity: number
    minStock: number
    updatedAt: string | null
  }
  images: ProductImage[]
  createdAt: string
  updatedAt: string
}

export interface ProductPage {
  items: AdminProduct[]
  page: number
  pageSize: number
  total: number
}

export interface ProductInput {
  categoryId: string
  name: string
  description: string
  unit: string
  price: number
  status: ProductStatus
  inventory: { quantity: number; minStock: number }
  images: ProductImage[]
}

export interface ProductCategoryInput {
  name: string
  description: string
  isActive: boolean
}

export class AdminProductApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message)
    this.name = "AdminProductApiError"
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
    throw new AdminProductApiError("Không kết nối được API sản phẩm. Kiểm tra API gateway và thử lại.", 0, "NETWORK_ERROR")
  }
  if (response.status === 204) return undefined as T
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error = body && typeof body === "object" && "error" in body ? body.error : null
    const message = error && typeof error === "object" && "message" in error && typeof error.message === "string"
      ? error.message
      : `Yêu cầu thất bại (HTTP ${response.status}).`
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : "REQUEST_FAILED"
    throw new AdminProductApiError(message, response.status, code)
  }
  if (!body || typeof body !== "object" || !("data" in body)) {
    throw new AdminProductApiError("API trả về dữ liệu không đúng định dạng.", response.status, "INVALID_RESPONSE")
  }
  return body.data as T
}

export async function listProductCategories() {
  return request<ProductCategory[]>("v1/admin/product-categories")
}

export async function saveProductCategory(input: ProductCategoryInput, id?: string) {
  return request<ProductCategory>(`v1/admin/product-categories${id ? `/${encodeURIComponent(id)}` : ""}`, {
    method: id ? "PUT" : "POST",
    body: JSON.stringify(input),
  })
}

export async function deleteProductCategory(id: string) {
  return request<void>(`v1/admin/product-categories/${encodeURIComponent(id)}`, { method: "DELETE" })
}

export async function listAdminProducts(filters: { search: string; categoryId: string; status: string; page: number; pageSize: number }) {
  const query = new URLSearchParams({
    page: String(filters.page),
    pageSize: String(filters.pageSize),
    ...(filters.search ? { search: filters.search } : {}),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  })
  return request<ProductPage>(`v1/admin/products?${query}`)
}

export async function saveAdminProduct(input: ProductInput, id?: string) {
  return request<AdminProduct>(`v1/admin/products${id ? `/${encodeURIComponent(id)}` : ""}`, {
    method: id ? "PUT" : "POST",
    body: JSON.stringify(input),
  })
}

export async function updateAdminProductStatus(id: string, status: ProductStatus) {
  return request<AdminProduct>(`v1/admin/products/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  })
}

export async function updateAdminProductInventory(id: string, inventory: { quantity: number; minStock: number }) {
  return request<AdminProduct>(`v1/admin/products/${encodeURIComponent(id)}/inventory`, {
    method: "PATCH",
    body: JSON.stringify(inventory),
  })
}

export async function deleteAdminProduct(id: string) {
  return request<void>(`v1/admin/products/${encodeURIComponent(id)}`, { method: "DELETE" })
}
