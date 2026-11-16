export type Role = "customer" | "staff" | "admin"

export type ServiceCategory = "dinh-ky" | "chuyen-sau" | "noi-that" | "thiet-bi"

export interface Service {
  id: string
  slug: string
  name: string
  category: ServiceCategory
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
export type HouseType = "can-ho" | "nha-pho" | "biet-thu" | "van-phong"

export interface OrderContact {
  name: string
  phone: string
  address: string
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
  id: string
  code: string
  customerId: string
  serviceId: string
  quantity: number
  contact: OrderContact
  scheduledAt: string
  durationMinutes: number
  specialRequest: string
  price: number
  status: OrderStatus
  staffId?: string
  jobStatus?: JobStatus
  cancelRequest?: CancelRequest
  history: HistoryEntry[]
  staffNotes: StaffNote[]
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
