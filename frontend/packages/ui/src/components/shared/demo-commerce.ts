export type ProductGroup = "nhà ở" | "phòng trọ" | "dùng chung"
export type DemoProduct = {
  id: string
  name: string
  description: string
  group: ProductGroup
  price: number
  stock: number
  active: boolean
}
export type DemoProductOrder = {
  id: string
  createdAt: string
  customerName: string
  phone: string
  address: string
  items: { productId: string; name: string; quantity: number; unitPrice: number }[]
  total: number
}
export type DemoCommerceState = { products: DemoProduct[]; orders: DemoProductOrder[] }

const STORAGE_KEY = "cleanhome-demo-commerce-v1"

export const DEMO_PRODUCTS: DemoProduct[] = [
  { id: "sp-nuoc-rua-chen", name: "Nước rửa chén dịu nhẹ", description: "Dung dịch rửa chén dùng hằng ngày, hương chanh nhẹ.", group: "nhà ở", price: 45000, stock: 24, active: true },
  { id: "sp-khan-lau", name: "Khăn lau đa năng", description: "Khăn mềm, thấm hút tốt, dùng cho bếp và bề mặt nội thất.", group: "dùng chung", price: 30000, stock: 36, active: true },
  { id: "sp-nuoc-san", name: "Nước lau sàn", description: "Làm sạch sàn nhà, phù hợp sử dụng tại nhà hoặc phòng trọ.", group: "phòng trọ", price: 55000, stock: 18, active: true },
]

export function readDemoCommerce(): DemoCommerceState {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (raw === null) return { products: DEMO_PRODUCTS.map(product => ({ ...product })), orders: [] }
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { throw new Error("Dữ liệu cửa hàng demo bị lỗi định dạng. Dữ liệu gốc vẫn được giữ nguyên.") }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as DemoCommerceState).products) || !Array.isArray((parsed as DemoCommerceState).orders)) {
    throw new Error("Dữ liệu cửa hàng demo không đúng cấu trúc. Dữ liệu gốc vẫn được giữ nguyên.")
  }
  const value = parsed as DemoCommerceState
  if (value.products.some(product => !product || typeof product.id !== "string" || typeof product.name !== "string" || typeof product.description !== "string" || !["nhà ở", "phòng trọ", "dùng chung"].includes(product.group) || !Number.isFinite(product.price) || !Number.isFinite(product.stock) || typeof product.active !== "boolean")) {
    throw new Error("Danh mục sản phẩm demo có dữ liệu không hợp lệ. Dữ liệu gốc vẫn được giữ nguyên.")
  }
  if (value.orders.some(order => !order || typeof order.id !== "string" || typeof order.createdAt !== "string" || !Number.isFinite(new Date(order.createdAt).getTime()) || typeof order.customerName !== "string" || typeof order.phone !== "string" || typeof order.address !== "string" || !Number.isFinite(order.total) || !Array.isArray(order.items) || order.items.some(item => !item || typeof item.productId !== "string" || typeof item.name !== "string" || !Number.isInteger(item.quantity) || item.quantity < 1 || !Number.isFinite(item.unitPrice)))) {
    throw new Error("Danh sách đơn mua demo có dữ liệu không hợp lệ. Dữ liệu gốc vẫn được giữ nguyên.")
  }
  return value
}

export function writeDemoCommerce(value: DemoCommerceState) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
}

export function newDemoId() {
  return globalThis.crypto?.randomUUID?.() ?? `demo-${Date.now()}`
}
