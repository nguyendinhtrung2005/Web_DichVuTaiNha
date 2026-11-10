export type Role = "customer" | "staff" | "admin"

export type ServiceCategory = "dinh-ky" | "chuyen-sau" | "noi-that" | "thiet-bi"
export type ServiceGroup = "ve-sinh" | "cham-soc" | "bao-duong"
export type AdminServiceGroup = "ve-sinh-nha-o" | "ve-sinh-phong-tro" | "cham-soc" | "bao-duong"
export type CleaningType = "phong-tro" | "nha-gia-dinh" | "khac"
export type ServicePricingMode = "fixed" | "reference" | "survey"

export interface Service {
  id: string
  slug: string
  name: string
  category: ServiceCategory
  categoryName?: string
  group?: ServiceGroup
  adminGroup?: AdminServiceGroup
  groupName?: string
  cleaningType?: CleaningType
  pricingMode?: ServicePricingMode
  pricingModeKnown?: boolean
  minimumQuantityKnown?: boolean
  shortDesc: string
  description: string
  scope: string[]
  included: string[]
  excluded: string[]
  unit: string
  quantityLabel: string
  price: number
  minQuantity: number
  defaultQuantity: number
  minutesPerUnit: number
  baseMinutes: number
  image: string
  status: "active" | "inactive"
}

export interface Product {
  id: string
  code: string
  slug: string
  name: string
  description: string
  images: string[]
  image: string
  categoryId: string
  categoryName: string
  relatedServiceIds: string[]
  price: number
  unit: string
  stock: number
  status: "available" | "out_of_stock" | "inactive"
}

export interface ProductCartItem {
  productId: string
  quantity: number
}

export interface ProductOrderItem {
  productId: string
  expectedUnitPrice?: number
  code?: string
  name?: string
  unit?: string
  quantity: number
  unitPrice?: number
}

export interface ProductOrder {
  id: string
  code: string
  customerId: string
  status: "processing" | "pending" | "failed"
  items: ProductOrderItem[]
  contact: { name: string; phone: string; address?: string; note?: string }
  total: number | null
  createdAt: string
  updatedAt: string
  errorCode?: string
  payment?: { method: PaymentMethod; status: "not_started" | "unpaid" | "pending"; simulated: true } | null
}

export interface User {
  id: string
  code: string
  role: Role
  name: string
  phone: string
  email: string
  address: string
  avatar?: string
  status: "active" | "locked"
  createdAt: string
  position?: string
}

export type OrderStatus = "pending" | "confirmed" | "in_progress" | "completed" | "cancelled"
export type JobStatus = "waiting" | "accepted" | "in_progress" | "done"
export type PaymentStatus = "unpaid" | "pending" | "paid"
export type PaymentMethod = "cash" | "transfer"
export type HouseType = "phong-tro" | "can-ho" | "nha-pho" | "biet-thu" | "van-phong"

export interface OrderContact {
  name: string
  phone: string
  address: string
  region?: string
  houseType: HouseType
  area?: number
  rooms?: number
  floors?: number
  hasPets: boolean
}

export interface CancelRequest {
  reason: string
  requestedAt: string
  status: "pending" | "approved" | "rejected"
  adminNote?: string
  resolvedAt?: string
}

export interface HistoryEntry {
  at: string
  label: string
  by: string
  note?: string
}

export interface StaffNote {
  at: string
  text: string
  staffId: string
}

export interface Order {
  pricingMode?: ServicePricingMode
  pricingModeKnown?: boolean
  id: string
  code: string
  customerId: string
  serviceId: string
  serviceName?: string
  unit?: string
  items?: { id: string; serviceId: string; serviceName: string; quantity: number; unit: string; unitPrice: number }[]
  quantity: number
  contact: OrderContact
  scheduledAt: string
  durationMinutes: number | null
  specialRequest: string
  price: number
  status: OrderStatus
  branchId?: string | null
  decisionState?: string
  decisionSource?: string
  decisionReason?: string
  staffId?: string
  jobStatus?: JobStatus
  cancelRequest?: CancelRequest
  history: HistoryEntry[]
  staffNotes: StaffNote[]
  createdAt: string
}

export interface StaffJob {
  id: string
  code: string
  serviceId: string
  serviceName: string
  unit: string
  quantity: number
  contact: Pick<OrderContact, "name" | "phone" | "address">
  scheduledAt: string
  durationMinutes: number
  specialRequest: string
  orderStatus: OrderStatus
  jobStatus: JobStatus
  cancelPending: boolean
  history: HistoryEntry[]
  createdAt: string
}

export interface Payment {
  id: string
  code: string
  orderId: string
  amount: number
  method: PaymentMethod
  status: PaymentStatus
  createdAt: string
  confirmedAt?: string
  refundRequired?: boolean
}

export interface Review {
  id: string
  orderId: string
  customerId: string
  staffId?: string
  serviceId: string
  serviceRating: number
  staffRating: number
  comment: string
  createdAt: string
  hidden: boolean
  hiddenReason?: string
}

export interface Session {
  userId: string
  role: Role
}

/** Dự phòng chương trình khuyến mãi / mã giảm giá khi có backend. */
export interface PromoCode {
  id: string
  code: string
  description: string
  percentOff?: number
  amountOff?: number
  active: boolean
}

export interface AppState {
  version: number
  services: Service[]
  users: User[]
  orders: Order[]
  payments: Payment[]
  reviews: Review[]
  /** Chỉ lưu mã băm demo, không lưu mật khẩu người dùng nhập. */
  passwordHashes: Record<string, string>
  session: Session | null
}
