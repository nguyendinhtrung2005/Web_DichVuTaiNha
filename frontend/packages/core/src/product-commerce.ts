"use client"

import { ApiError, apiRequest } from "./api-client"
import { allCustomerPages, captureCustomerSession, isCustomerSessionCurrent, customerRequestError } from "./customer-api-store"
import type { Product, ProductCartItem, ProductOrder, PaymentMethod } from "./types"

export type ProductContact = ProductOrder["contact"]
export type PendingProductPurchase = {
  customerId: string
  requestKey: string
  items: (ProductCartItem & { expectedUnitPrice: number })[]
  contact: ProductContact
  paymentMethod?: PaymentMethod
}
type PrivatePendingPurchase = PendingProductPurchase & { signature: string; lineTokens: Record<string, number>; generation: number; orderId?: string }
export type ProductPurchaseStatus = { pending: PendingProductPurchase | null; busy: boolean }
const emptyCart: ProductCartItem[] = []
const emptyPurchase: ProductPurchaseStatus = { pending: null, busy: false }
let cart: ProductCartItem[] = emptyCart
let pendingRequest: PrivatePendingPurchase | null = null
let purchaseStatus = emptyPurchase
let inFlight: Promise<ProductOrder> | null = null
let owner: string | null = null
let generation = 0
let nextLineToken = 0
const lineTokens = new Map<string, number>()
const listeners = new Set<() => void>()
const purchaseListeners = new Set<() => void>()
const emitCart = () => listeners.forEach((listener) => listener())
function emitPurchase() {
  purchaseStatus = { pending: pendingRequest ? { customerId: pendingRequest.customerId, requestKey: pendingRequest.requestKey, items: pendingRequest.items, contact: pendingRequest.contact, paymentMethod: pendingRequest.paymentMethod } : null, busy: Boolean(inFlight) }
  purchaseListeners.forEach((listener) => listener())
}
export const getProductCartSnapshot = () => cart
export const getProductPurchaseSnapshot = () => purchaseStatus
export const getServerProductPurchaseSnapshot = () => emptyPurchase
export function subscribeProductCart(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export function subscribeProductPurchase(listener: () => void) { purchaseListeners.add(listener); return () => { purchaseListeners.delete(listener) } }

/** Keep a guest cart through sign-in, but never expose a previous customer's contact/request. */
export function setProductCustomer(customerId: string | null) {
  if (owner === customerId) return
  const previous = owner
  owner = customerId
  generation += 1
  pendingRequest = null
  if (previous !== null) clearProductCart()
  emitPurchase()
}

export function addProductToCart(product: Product, quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) return { ok: false as const, error: "Số lượng phải là số nguyên từ 1 đến 999." }
  if (product.status !== "available" || !Number.isInteger(product.stock) || product.stock < 1) return { ok: false as const, error: "Sản phẩm hiện không còn hàng để mua." }
  const current = cart.find((item) => item.productId === product.id)?.quantity ?? 0
  if (current + quantity > product.stock || current + quantity > 999) return { ok: false as const, error: "Số lượng vượt tồn kho hoặc giới hạn 999 " + product.unit + "." }
  if (!current && cart.length >= 50) return { ok: false as const, error: "Giỏ hàng tối đa 50 sản phẩm khác nhau." }
  if (!current) lineTokens.set(product.id, ++nextLineToken)
  cart = [...cart.filter((item) => item.productId !== product.id), { productId: product.id, quantity: current + quantity }]
  emitCart()
  return { ok: true as const }
}
export function updateProductCartQuantity(product: Product, quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) return { ok: false as const, error: "Số lượng phải là số nguyên từ 1 đến 999; dùng nút xóa để bỏ sản phẩm." }
  if (product.status !== "available" || quantity > product.stock) return { ok: false as const, error: "Số lượng vượt tồn kho hiện tại (" + product.stock + ")." }
  if (!cart.some((item) => item.productId === product.id)) return { ok: false as const, error: "Sản phẩm không còn trong giỏ." }
  cart = cart.map((item) => item.productId === product.id ? { ...item, quantity } : item)
  emitCart()
  return { ok: true as const }
}
export function removeProductFromCart(productId: string) {
  const next = cart.filter((item) => item.productId !== productId)
  if (next.length !== cart.length) {
    lineTokens.delete(productId)
    cart = next.length ? next : emptyCart
    emitCart()
  }
}
export function clearProductCart() {
  cart = emptyCart
  lineTokens.clear()
  emitCart()
}
function removeConfirmedItems(request: PrivatePendingPurchase) {
  const submitted = new Map(request.items.map((item) => [item.productId, item.quantity]))
  cart = cart.flatMap((item) => {
    if (lineTokens.get(item.productId) !== request.lineTokens[item.productId]) return [item]
    const quantity = Math.max(0, item.quantity - (submitted.get(item.productId) ?? 0))
    if (!quantity) { lineTokens.delete(item.productId); return [] }
    return [{ ...item, quantity }]
  })
  if (!cart.length) cart = emptyCart
  emitCart()
}
function validateProduct(product: Product): Product {
  if (!product || typeof product.id !== "string" || typeof product.name !== "string" || typeof product.slug !== "string" ||
      !Number.isFinite(product.price) || product.price < 0 || !Number.isInteger(product.stock) || product.stock < 0 ||
      !["available", "out_of_stock", "inactive"].includes(product.status) || !Array.isArray(product.relatedServiceIds)) {
    throw new ApiError("API trả dữ liệu sản phẩm không hợp lệ.", 502, "INVALID_RESPONSE")
  }
  return product
}
function validateOrder(order: ProductOrder): ProductOrder {
  if (!order || typeof order.id !== "string" || typeof order.customerId !== "string" || !["processing", "pending", "failed"].includes(order.status) || !Array.isArray(order.items)) {
    throw new ApiError("API trả kết quả đơn sản phẩm không hợp lệ.", 502, "INVALID_RESPONSE")
  }
  if (order.payment && (!['cash', 'transfer'].includes(order.payment.method) || order.payment.simulated !== true
    || order.payment.status !== (order.status !== 'pending' ? 'not_started' : order.payment.method === 'cash' ? 'unpaid' : 'pending'))) {
    throw new ApiError("API trả trạng thái thanh toán mô phỏng không hợp lệ.", 502, "INVALID_RESPONSE")
  }
  return order
}
export async function getProduct(id: string, signal?: AbortSignal) {
  return validateProduct(await apiRequest<Product>("/catalog/products/" + encodeURIComponent(id), { signal }))
}
export async function getProducts(filters: { q?: string; category?: string; serviceId?: string } = {}) {
  const query = new URLSearchParams()
  if (filters.q) query.set("q", filters.q)
  if (filters.category) query.set("category", filters.category)
  if (filters.serviceId) query.set("serviceId", filters.serviceId)
  const items = await allCustomerPages<Product>("/catalog/products" + (query.size ? "?" + query : ""))
  return items.map(validateProduct)
}
export async function getProductOrders() {
  return productSessionRequest(async () => (await allCustomerPages<ProductOrder>("/product-orders")).map(validateOrder))
}
export async function getProductOrder(id: string) {
  const order = await productSessionRequest(async () => validateOrder(await apiRequest<ProductOrder>("/product-orders/" + encodeURIComponent(id))))
  settleKnownPurchase(order)
  return order
}
export async function retryProductOrder(id: string) {
  const order = await productSessionRequest(async () => validateOrder(await apiRequest<ProductOrder>("/product-orders/" + encodeURIComponent(id) + "/retry", { method: "POST", body: "{}" })))
  settleKnownPurchase(order)
  return order
}
function settleKnownPurchase(order: ProductOrder) {
  const request = pendingRequest
  if (!request || request.orderId !== order.id || owner !== order.customerId || generation !== request.generation) return
  if (order.status === "processing") return
  pendingRequest = null
  if (order.status === "pending") removeConfirmedItems(request)
  emitPurchase()
}
async function productSessionRequest<T>(load: () => Promise<T>): Promise<T> {
  const scope = captureCustomerSession()
  try {
    const result = await load()
    if (!isCustomerSessionCurrent(scope)) throw new ApiError("Phiên đã thay đổi. Vui lòng tải lại đơn trong tài khoản hiện tại.", 409, "SESSION_CHANGED")
    return result
  } catch (error) { if (isCustomerSessionCurrent(scope)) customerRequestError(error, scope); throw error }
}
function submitPurchase(request: PrivatePendingPurchase): Promise<ProductOrder> {
  if (inFlight) return inFlight
  const scope = captureCustomerSession()
  const task = (async () => {
    try {
      const order = validateOrder(await apiRequest<ProductOrder>("/product-orders", {
        method: "POST",
        body: JSON.stringify({ requestKey: request.requestKey, items: request.items, contact: request.contact, paymentMethod: request.paymentMethod }),
      }))
      if (generation !== request.generation || owner !== request.customerId || !isCustomerSessionCurrent(scope)) throw new ApiError("Tài khoản đã thay đổi. Vui lòng kiểm tra đơn trong đúng tài khoản.", 409, "SESSION_CHANGED")
      if (order.customerId !== request.customerId) throw new ApiError("API trả đơn không thuộc tài khoản hiện tại.", 502, "INVALID_RESPONSE")
      // Keep selections and the exact recovery request until inventory/price is known.
      // A later PRICE_CHANGED must not strand the shopper with an empty cart.
      request.orderId = order.id
      settleKnownPurchase(order)
      return order
    } catch (error) {
      if (generation === request.generation && owner === request.customerId) {
        if (error instanceof ApiError && ([400, 401, 403, 422].includes(error.status) || error.code === "PRICE_CHANGED") && pendingRequest === request) pendingRequest = null
        customerRequestError(error, scope)
      }
      throw error
    } finally {
      inFlight = null
      emitPurchase()
    }
  })()
  inFlight = task
  emitPurchase()
  return task
}
export async function createProductOrder(contact: ProductContact, customerId: string, confirmedPrices: Readonly<Record<string, number>>, paymentMethod: PaymentMethod = "cash"): Promise<ProductOrder> {
  if (!customerId || owner !== customerId) throw new ApiError("Vui lòng đăng nhập lại trước khi đặt sản phẩm.", 401, "UNAUTHENTICATED")
  if (!cart.length) throw new ApiError("Giỏ hàng đang trống.", 400, "EMPTY_CART")
  if (!["cash", "transfer"].includes(paymentMethod)) throw new ApiError("Vui lòng chọn phương thức thanh toán.", 400, "PAYMENT_METHOD_REQUIRED")
  const items = cart.map(({ productId, quantity }) => {
    const expectedUnitPrice = confirmedPrices?.[productId]
    if (!Number.isFinite(expectedUnitPrice) || expectedUnitPrice < 0 || expectedUnitPrice > 9999999999.99 || Math.abs(expectedUnitPrice * 100 - Math.round(expectedUnitPrice * 100)) > 0.000001) throw new ApiError("Vui lòng tải đơn giá và xác nhận lại giỏ hàng.", 400, "PRICE_CONFIRMATION_REQUIRED")
    return { productId, quantity, expectedUnitPrice }
  }).sort((left, right) => left.productId.localeCompare(right.productId))
  const signature = JSON.stringify({ items, contact, paymentMethod })
  if (pendingRequest) {
    if (pendingRequest.signature !== signature) throw new ApiError("Yêu cầu trước chưa xác nhận được. Dùng nút kiểm tra yêu cầu đã gửi bên trên trước khi tạo đơn mới.", 409, "ORDER_RECOVERY_REQUIRED")
    return submitPurchase(pendingRequest)
  }
  if (inFlight) throw new ApiError("Yêu cầu trước đang kết thúc. Vui lòng thử lại sau.", 409, "ORDER_BUSY")
  pendingRequest = {
    customerId, requestKey: crypto.randomUUID(), items, contact: { ...contact }, paymentMethod, signature,
    lineTokens: Object.fromEntries(items.map((item) => [item.productId, lineTokens.get(item.productId)!])),
    generation,
  }
  return submitPurchase(pendingRequest)
}
export function retryPendingProductOrder(customerId: string) {
  if (!pendingRequest || pendingRequest.customerId !== customerId || owner !== customerId) throw new ApiError("Không còn yêu cầu cần khôi phục trong tài khoản này.", 409, "NO_PENDING_REQUEST")
  return submitPurchase(pendingRequest)
}
