import type { AppState, HouseType, JobStatus, Order, OrderStatus, Payment, PaymentMethod, PaymentStatus, Review, Service, User } from "./types"
import { addDays, startOfDay } from "./format"
import { seedPasswordHashes } from "./auth"

export const SEED_VERSION = 2

export const SERVICES: Service[] = [
  {
    id: "dv-01",
    slug: "don-nha-theo-gio",
    name: "Dọn nhà theo giờ",
    category: "dinh-ky",
    shortDesc: "Dọn dẹp, lau chùi nhà cửa linh hoạt theo số giờ bạn cần.",
    description:
      "Nhân viên đến tận nhà dọn dẹp các khu vực sinh hoạt hằng ngày. Phù hợp cho gia đình bận rộn cần giữ nhà luôn gọn gàng mỗi tuần.",
    scope: ["Phòng khách, phòng ngủ, bếp và nhà vệ sinh", "Làm theo thứ tự ưu tiên khách hàng yêu cầu", "Dụng cụ cơ bản do nhân viên mang theo"],
    included: ["Quét, hút bụi và lau sàn", "Lau bề mặt bàn ghế, kệ tủ", "Rửa chén bát, dọn bếp", "Cọ rửa nhà vệ sinh", "Gom và đổ rác"],
    excluded: ["Giặt ủi quần áo", "Lau kính mặt ngoài nhà cao tầng", "Di chuyển đồ nặng trên 20 kg"],
    unit: "giờ",
    quantityLabel: "Số giờ",
    price: 90000,
    minQuantity: 2,
    defaultQuantity: 3,
    minutesPerUnit: 60,
    baseMinutes: 0,
    image: "/images/don-nha-theo-gio.png",
    status: "active",
  },
  {
    id: "dv-02",
    slug: "tong-ve-sinh",
    name: "Tổng vệ sinh nhà ở",
    category: "chuyen-sau",
    shortDesc: "Làm sạch toàn diện từng ngóc ngách, phù hợp dịp lễ Tết hoặc chuyển nhà.",
    description:
      "Đội ngũ 2–3 nhân viên cùng máy móc chuyên dụng xử lý vết bẩn lâu ngày trên sàn, kính, bếp và nhà vệ sinh, trả lại không gian sạch sẽ như mới.",
    scope: ["Toàn bộ các phòng trong nhà", "Khu vực ban công, cửa sổ phía trong", "Có máy chà sàn, máy hút bụi công nghiệp"],
    included: ["Chà sàn, đánh bóng gạch", "Lau kính, khung cửa", "Tẩy cặn nhà vệ sinh", "Vệ sinh tủ bếp bên ngoài, máy hút mùi", "Hút bụi rèm, trần nhà"],
    excluded: ["Vệ sinh sofa, nệm (dịch vụ riêng)", "Vệ sinh máy lạnh", "Xử lý mối mọt, côn trùng"],
    unit: "m²",
    quantityLabel: "Diện tích (m²)",
    price: 12000,
    minQuantity: 30,
    defaultQuantity: 60,
    minutesPerUnit: 3,
    baseMinutes: 30,
    image: "/images/tong-ve-sinh.png",
    status: "active",
  },
  {
    id: "dv-03",
    slug: "ve-sinh-sofa",
    name: "Vệ sinh sofa",
    category: "noi-that",
    shortDesc: "Giặt hút sofa vải, da bằng máy chuyên dụng, khử mùi và diệt khuẩn.",
    description:
      "Sử dụng máy phun hút và dung dịch an toàn cho từng chất liệu, loại bỏ bụi mịn, vết ố và mùi hôi, sofa khô nhanh sau 3–4 giờ.",
    scope: ["Sofa vải, nỉ, da", "Tính theo số chỗ ngồi", "Thực hiện tại nhà khách hàng"],
    included: ["Hút bụi khe kẽ", "Phun giặt và hút khô", "Xử lý vết ố thông thường", "Khử mùi, diệt khuẩn"],
    excluded: ["Vết mực, sơn lâu năm", "Sửa chữa, bọc lại sofa"],
    unit: "chỗ ngồi",
    quantityLabel: "Số chỗ ngồi",
    price: 120000,
    minQuantity: 2,
    defaultQuantity: 3,
    minutesPerUnit: 25,
    baseMinutes: 20,
    image: "/images/ve-sinh-sofa.png",
    status: "active",
  },
  {
    id: "dv-04",
    slug: "ve-sinh-may-lanh",
    name: "Vệ sinh máy lạnh",
    category: "thiet-bi",
    shortDesc: "Bảo dưỡng máy lạnh treo tường giúp làm lạnh nhanh và tiết kiệm điện.",
    description:
      "Kỹ thuật viên tháo lắp, xịt rửa dàn lạnh, dàn nóng và kiểm tra gas cơ bản. Khuyến nghị vệ sinh định kỳ 3–6 tháng một lần.",
    scope: ["Máy lạnh treo tường 1–2,5 HP", "Dàn lạnh và dàn nóng", "Kiểm tra vận hành sau vệ sinh"],
    included: ["Xịt rửa lưới lọc, dàn lạnh", "Vệ sinh dàn nóng", "Thông ống thoát nước", "Kiểm tra áp suất gas"],
    excluded: ["Nạp gas bổ sung", "Thay linh kiện", "Máy lạnh âm trần, tủ đứng"],
    unit: "máy",
    quantityLabel: "Số máy",
    price: 180000,
    minQuantity: 1,
    defaultQuantity: 2,
    minutesPerUnit: 45,
    baseMinutes: 15,
    image: "/images/ve-sinh-may-lanh.png",
    status: "active",
  },
  {
    id: "dv-05",
    slug: "ve-sinh-sau-xay-dung",
    name: "Vệ sinh sau xây dựng",
    category: "chuyen-sau",
    shortDesc: "Xử lý bụi xi măng, vết sơn, keo dán sau thi công để sẵn sàng vào ở.",
    description:
      "Làm sạch công trình mới hoàn thiện hoặc sau sửa chữa: gạt vữa, tẩy sơn, lau kính và làm sạch toàn bộ bề mặt với máy móc chuyên dụng.",
    scope: ["Nhà mới xây, căn hộ mới nhận", "Nhà sau cải tạo, sửa chữa", "Đội 3–5 nhân viên tùy diện tích"],
    included: ["Gạt vữa, tẩy vết sơn trên sàn và kính", "Hút bụi xi măng", "Lau chùi cửa, tay nắm, công tắc", "Vệ sinh thiết bị vệ sinh mới lắp"],
    excluded: ["Thu gom xà bần khối lượng lớn", "Sơn sửa lại tường"],
    unit: "m²",
    quantityLabel: "Diện tích (m²)",
    price: 20000,
    minQuantity: 40,
    defaultQuantity: 80,
    minutesPerUnit: 3,
    baseMinutes: 60,
    image: "/images/sau-xay-dung.png",
    status: "active",
  },
  {
    id: "dv-06",
    slug: "ve-sinh-nem",
    name: "Vệ sinh nệm",
    category: "noi-that",
    shortDesc: "Hút bụi, diệt mạt bụi và khử khuẩn nệm bằng tia UV.",
    description:
      "Loại bỏ mạt bụi, tế bào da chết và vi khuẩn gây dị ứng trong nệm, giúp giấc ngủ sạch sẽ và an toàn hơn cho cả gia đình.",
    scope: ["Nệm lò xo, cao su, foam", "Tính theo số chiếc nệm", "Thực hiện tại nhà khách hàng"],
    included: ["Hút bụi sâu hai mặt", "Diệt khuẩn bằng tia UV", "Xử lý vết ố nhẹ", "Khử mùi"],
    excluded: ["Giặt vỏ nệm tháo rời", "Vết ố lâu năm, nấm mốc nặng"],
    unit: "chiếc",
    quantityLabel: "Số chiếc nệm",
    price: 250000,
    minQuantity: 1,
    defaultQuantity: 1,
    minutesPerUnit: 40,
    baseMinutes: 10,
    image: "/images/ve-sinh-nem.png",
    status: "active",
  },
]

const CUSTOMERS: Omit<User, "createdAt">[] = [
  { id: "u-kh01", code: "KH001", role: "customer", name: "Nguyễn Thị Lan", phone: "0901234567", email: "lan.nguyen@example.vn", address: "45 Lê Văn Việt, P. Hiệp Phú, TP. Thủ Đức", status: "active" },
  { id: "u-kh02", code: "KH002", role: "customer", name: "Trần Minh Quân", phone: "0912345678", email: "quan.tran@example.vn", address: "12 Nguyễn Thị Minh Khai, Quận 1", status: "active" },
  { id: "u-kh03", code: "KH003", role: "customer", name: "Lê Thu Hà", phone: "0938765432", email: "ha.le@example.vn", address: "88 Phan Xích Long, Q. Phú Nhuận", status: "active" },
  { id: "u-kh04", code: "KH004", role: "customer", name: "Phạm Đức Anh", phone: "0987654321", email: "anh.pham@example.vn", address: "Căn hộ A2-15, Sunrise City, Quận 7", status: "active" },
  { id: "u-kh05", code: "KH005", role: "customer", name: "Võ Ngọc Mai", phone: "0909111222", email: "mai.vo@example.vn", address: "230 Cộng Hòa, Q. Tân Bình", status: "active" },
  { id: "u-kh06", code: "KH006", role: "customer", name: "Đặng Quốc Bảo", phone: "0977333444", email: "bao.dang@example.vn", address: "17 Đường số 9, P. Linh Trung, TP. Thủ Đức", status: "active" },
  { id: "u-kh07", code: "KH007", role: "customer", name: "Hoàng Thị Yến", phone: "0966555777", email: "yen.hoang@example.vn", address: "56 Nguyễn Oanh, Q. Gò Vấp", status: "active" },
  { id: "u-kh08", code: "KH008", role: "customer", name: "Bùi Thanh Tùng", phone: "0944888999", email: "tung.bui@example.vn", address: "102 Trần Hưng Đạo, Quận 5", status: "locked" },
]

const STAFF: Omit<User, "createdAt">[] = [
  { id: "u-nv01", code: "NV001", role: "staff", name: "Trần Văn Hùng", phone: "0903111001", email: "hung.tran@cleanhome.vn", address: "Quận 7, TP. Hồ Chí Minh", status: "active", position: "Nhân viên vệ sinh chính" },
  { id: "u-nv02", code: "NV002", role: "staff", name: "Nguyễn Thị Hoa", phone: "0903111002", email: "hoa.nguyen@cleanhome.vn", address: "Q. Bình Thạnh, TP. Hồ Chí Minh", status: "active", position: "Trưởng nhóm tổng vệ sinh" },
  { id: "u-nv03", code: "NV003", role: "staff", name: "Lý Minh Tuấn", phone: "0903111003", email: "tuan.ly@cleanhome.vn", address: "Q. Tân Phú, TP. Hồ Chí Minh", status: "active", position: "Kỹ thuật viên giặt nệm, sofa" },
  { id: "u-nv04", code: "NV004", role: "staff", name: "Phan Thị Thu", phone: "0903111004", email: "thu.phan@cleanhome.vn", address: "Q. Gò Vấp, TP. Hồ Chí Minh", status: "active", position: "Nhân viên vệ sinh" },
  { id: "u-nv05", code: "NV005", role: "staff", name: "Đỗ Văn Long", phone: "0903111005", email: "long.do@cleanhome.vn", address: "TP. Thủ Đức, TP. Hồ Chí Minh", status: "active", position: "Nhân viên vệ sinh" },
  { id: "u-nv06", code: "NV006", role: "staff", name: "Mai Thị Ngọc", phone: "0903111006", email: "ngoc.mai@cleanhome.vn", address: "Quận 3, TP. Hồ Chí Minh", status: "active", position: "Kỹ thuật viên máy lạnh" },
]

const ADMIN: Omit<User, "createdAt"> = {
  id: "u-ad01",
  code: "QT001",
  role: "admin",
  name: "Lê Hoàng Nam",
  phone: "0903999000",
  email: "admin@cleanhome.vn",
  address: "Văn phòng CleanHome, Quận 7",
  status: "active",
  position: "Quản trị hệ thống",
}

export const DEMO_ACCOUNTS = {
  customer: "u-kh01",
  staff: "u-nv01",
  admin: "u-ad01",
} as const

type SeedOrder = {
  day: number
  time: string
  customer: string
  service: string
  qty: number
  status: OrderStatus
  staff?: string
  job?: JobStatus
  pay?: { method: PaymentMethod; status: PaymentStatus }
  cancel?: { status: "pending" | "approved" | "rejected"; reason: string; note?: string }
  review?: { s: number; st: number; c: string }
  house?: HouseType
  note?: string
}

const SEED_ORDERS: SeedOrder[] = [
  { day: -125, time: "09:00", customer: "u-kh02", service: "dv-04", qty: 2, status: "completed", staff: "u-nv06", job: "done", pay: { method: "cash", status: "paid" } },
  { day: -95, time: "08:00", customer: "u-kh06", service: "dv-02", qty: 70, status: "completed", staff: "u-nv02", job: "done", pay: { method: "transfer", status: "paid" }, review: { s: 5, st: 5, c: "Đội làm rất kỹ, nhà sạch bong trước Tết. Sẽ tiếp tục ủng hộ." } },
  { day: -65, time: "14:00", customer: "u-kh04", service: "dv-01", qty: 3, status: "completed", staff: "u-nv04", job: "done", pay: { method: "cash", status: "paid" } },
  { day: -40, time: "08:00", customer: "u-kh01", service: "dv-01", qty: 3, status: "completed", staff: "u-nv01", job: "done", pay: { method: "transfer", status: "paid" }, review: { s: 5, st: 5, c: "Anh Hùng làm việc nhanh nhẹn, cẩn thận, dọn bếp rất sạch." } },
  { day: -35, time: "09:00", customer: "u-kh02", service: "dv-02", qty: 80, status: "completed", staff: "u-nv02", job: "done", pay: { method: "cash", status: "paid" }, review: { s: 4, st: 5, c: "Sạch sẽ, đúng giờ. Chỉ tiếc là kéo dài hơn dự kiến một chút." } },
  { day: -30, time: "14:00", customer: "u-kh01", service: "dv-04", qty: 2, status: "completed", staff: "u-nv01", job: "done", pay: { method: "cash", status: "paid" } },
  { day: -25, time: "08:30", customer: "u-kh03", service: "dv-03", qty: 5, status: "completed", staff: "u-nv03", job: "done", pay: { method: "transfer", status: "paid" }, review: { s: 5, st: 4, c: "Sofa sạch hẳn, hết mùi. Nhân viên thân thiện." } },
  { day: -20, time: "13:00", customer: "u-kh04", service: "dv-05", qty: 100, status: "completed", staff: "u-nv02", job: "done", pay: { method: "transfer", status: "paid" }, review: { s: 3, st: 4, c: "Còn sót vài vết sơn ở cửa sổ, nhưng nhìn chung ổn." }, house: "nha-pho" },
  { day: -15, time: "09:00", customer: "u-kh05", service: "dv-01", qty: 2, status: "completed", staff: "u-nv04", job: "done" },
  { day: -12, time: "10:00", customer: "u-kh01", service: "dv-03", qty: 3, status: "cancelled", cancel: { status: "approved", reason: "Gia đình có việc đột xuất phải về quê.", note: "Đã liên hệ và xác nhận với khách hàng." } },
  { day: -10, time: "15:00", customer: "u-kh06", service: "dv-06", qty: 2, status: "cancelled", pay: { method: "transfer", status: "paid" }, cancel: { status: "approved", reason: "Đã mua nệm mới, không cần vệ sinh nữa.", note: "Khách đã chuyển khoản trước, cần hoàn tiền." } },
  { day: -7, time: "08:00", customer: "u-kh07", service: "dv-02", qty: 60, status: "completed", staff: "u-nv05", job: "done", pay: { method: "transfer", status: "pending" } },
  { day: -5, time: "09:00", customer: "u-kh08", service: "dv-04", qty: 3, status: "completed", staff: "u-nv06", job: "done", pay: { method: "cash", status: "paid" }, review: { s: 5, st: 5, c: "Máy lạnh chạy êm và mát hơn hẳn. Rất hài lòng!" } },
  { day: -3, time: "14:00", customer: "u-kh01", service: "dv-01", qty: 4, status: "completed", staff: "u-nv01", job: "done", pay: { method: "transfer", status: "pending" } },
  { day: -1, time: "10:00", customer: "u-kh02", service: "dv-06", qty: 1, status: "completed", staff: "u-nv03", job: "done", pay: { method: "cash", status: "paid" } },
  { day: 0, time: "08:00", customer: "u-kh03", service: "dv-01", qty: 3, status: "in_progress", staff: "u-nv01", job: "in_progress", note: "Nhà có mèo, vui lòng đóng cửa phòng ngủ khi làm." },
  { day: 0, time: "14:00", customer: "u-kh01", service: "dv-04", qty: 1, status: "confirmed", staff: "u-nv01", job: "accepted" },
  { day: 0, time: "09:00", customer: "u-kh04", service: "dv-02", qty: 120, status: "confirmed", staff: "u-nv02", job: "waiting", house: "nha-pho" },
  { day: 1, time: "08:00", customer: "u-kh05", service: "dv-03", qty: 7, status: "confirmed", staff: "u-nv01", job: "waiting" },
  { day: 1, time: "13:30", customer: "u-kh06", service: "dv-01", qty: 2, status: "confirmed" },
  { day: 2, time: "09:00", customer: "u-kh01", service: "dv-02", qty: 70, status: "confirmed", cancel: { status: "pending", reason: "Muốn dời sang tháng sau vì đang sửa nhà." } },
  { day: 2, time: "14:00", customer: "u-kh07", service: "dv-05", qty: 150, status: "pending", house: "biet-thu", note: "Công trình vừa sơn xong, còn nhiều bụi xi măng ở cầu thang." },
  { day: 3, time: "08:00", customer: "u-kh08", service: "dv-04", qty: 2, status: "pending" },
  { day: 4, time: "10:00", customer: "u-kh01", service: "dv-01", qty: 3, status: "pending", note: "Ưu tiên dọn bếp và nhà vệ sinh trước." },
  { day: 5, time: "09:00", customer: "u-kh02", service: "dv-06", qty: 2, status: "confirmed", staff: "u-nv03", job: "accepted" },
  { day: 6, time: "15:00", customer: "u-kh03", service: "dv-03", qty: 4, status: "pending", cancel: { status: "rejected", reason: "Nhầm ngày đặt.", note: "Khách đã liên hệ tổng đài để đổi ngày thay vì hủy." } },
]

export function estimateDuration(service: Pick<Service, "minutesPerUnit" | "baseMinutes">, qty: number) {
  const raw = service.baseMinutes + service.minutesPerUnit * qty
  return Math.max(60, Math.ceil(raw / 30) * 30)
}

export function estimatePrice(service: Pick<Service, "price">, qty: number) {
  return service.price * qty
}

function atTime(base: Date, time: string) {
  const [h, m] = time.split(":").map(Number)
  const d = new Date(base)
  d.setHours(h, m, 0, 0)
  return d
}

export function orderCode(date: Date, seq: number) {
  const y = String(date.getFullYear()).slice(2)
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  return `CH${y}${mm}-${String(seq).padStart(3, "0")}`
}

export function createSeedState(now = new Date()): AppState {
  const today = startOfDay(now)
  const createdAt = addDays(today, -200).toISOString()
  const users: User[] = [...CUSTOMERS, ...STAFF, ADMIN].map((u) => ({ ...u, createdAt }))
  const orders: Order[] = []
  const payments: Payment[] = []
  const reviews: Review[] = []

  SEED_ORDERS.forEach((s, i) => {
    const service = SERVICES.find((x) => x.id === s.service)!
    const customer = users.find((u) => u.id === s.customer)!
    const scheduled = atTime(addDays(today, s.day), s.time)
    const created = addDays(scheduled, -3)
    const id = `od-${String(i + 1).padStart(3, "0")}`
    const staff = s.staff ? users.find((u) => u.id === s.staff) : undefined
    const history: Order["history"] = [{ at: created.toISOString(), label: "Khách hàng tạo đơn", by: customer.name }]
    if (s.status !== "pending" && !(s.status === "cancelled" && !s.staff)) {
      history.push({ at: addDays(created, 0.2).toISOString(), label: "Quản trị viên xác nhận đơn", by: ADMIN.name })
    }
    if (staff) history.push({ at: addDays(created, 0.4).toISOString(), label: `Phân công nhân viên ${staff.name}`, by: ADMIN.name })
    if (staff && s.job && s.job !== "waiting") history.push({ at: addDays(created, 0.6).toISOString(), label: "Nhân viên tiếp nhận công việc", by: staff.name })
    if (staff && (s.job === "in_progress" || s.job === "done")) history.push({ at: scheduled.toISOString(), label: "Bắt đầu thực hiện", by: staff.name })
    const duration = estimateDuration(service, s.qty)
    if (staff && s.job === "done") history.push({ at: new Date(scheduled.getTime() + duration * 60000).toISOString(), label: "Hoàn thành công việc", by: staff.name })

    let cancelRequest: Order["cancelRequest"]
    if (s.cancel) {
      const requestedAt = addDays(created, 1).toISOString()
      cancelRequest = {
        reason: s.cancel.reason,
        requestedAt,
        status: s.cancel.status,
        adminNote: s.cancel.note,
        resolvedAt: s.cancel.status === "pending" ? undefined : addDays(created, 1.3).toISOString(),
      }
      history.push({ at: requestedAt, label: "Khách hàng gửi yêu cầu hủy", by: customer.name, note: s.cancel.reason })
      if (s.cancel.status === "approved") history.push({ at: cancelRequest.resolvedAt!, label: "Duyệt yêu cầu hủy – đơn đã hủy", by: ADMIN.name, note: s.cancel.note })
      if (s.cancel.status === "rejected") history.push({ at: cancelRequest.resolvedAt!, label: "Từ chối yêu cầu hủy", by: ADMIN.name, note: s.cancel.note })
    }

    const price = estimatePrice(service, s.qty)
    orders.push({
      id,
      code: orderCode(created, i + 1),
      customerId: customer.id,
      serviceId: service.id,
      quantity: s.qty,
      contact: {
        name: customer.name,
        phone: customer.phone,
        address: customer.address,
        houseType: s.house ?? "can-ho",
        area: service.unit === "m²" ? s.qty : 65,
        rooms: 2,
        floors: s.house === "nha-pho" || s.house === "biet-thu" ? 3 : 1,
        hasPets: Boolean(s.note?.includes("mèo")),
      },
      scheduledAt: scheduled.toISOString(),
      durationMinutes: duration,
      specialRequest: s.note ?? "",
      price,
      status: s.status,
      staffId: s.staff,
      jobStatus: s.staff ? s.job : undefined,
      cancelRequest,
      history: history.sort((a, b) => a.at.localeCompare(b.at)),
      staffNotes:
        s.job === "done" && staff
          ? [{ at: new Date(scheduled.getTime() + duration * 60000).toISOString(), text: "Đã hoàn thành đầy đủ hạng mục, khách hàng kiểm tra và hài lòng.", staffId: staff.id }]
          : [],
      createdAt: created.toISOString(),
    })

    if (s.pay) {
      payments.push({
        id: `pm-${id}`,
        code: `TT${String(i + 1).padStart(4, "0")}`,
        orderId: id,
        amount: price,
        method: s.pay.method,
        status: s.pay.status,
        createdAt: (s.status === "completed" ? scheduled : created).toISOString(),
        confirmedAt: s.pay.status === "paid" ? new Date(scheduled.getTime() + duration * 60000).toISOString() : undefined,
        refundRequired: s.status === "cancelled" && s.pay.status === "paid",
      })
    }

    if (s.review) {
      reviews.push({
        id: `rv-${id}`,
        orderId: id,
        customerId: customer.id,
        staffId: s.staff,
        serviceId: service.id,
        serviceRating: s.review.s,
        staffRating: s.review.st,
        comment: s.review.c,
        createdAt: addDays(scheduled, 1).toISOString(),
        hidden: false,
      })
    }
  })

  return {
    version: SEED_VERSION,
    services: SERVICES,
    users,
    orders,
    payments,
    reviews,
    passwordHashes: seedPasswordHashes(users),
    session: null,
  }
}
