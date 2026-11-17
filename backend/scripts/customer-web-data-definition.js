export const WEB_MARKER = 'CH_CUSTOMER_WEB_TEST_V1';
export const WEB_PREFIX = '[TEST WEB V1] ';
export const webName = (value) => WEB_PREFIX + value;

export const webAccounts = [
  { key: 'a', label: 'Khách có lịch sử', phone: '0900000901', email: 'web-a@cleanhome.test', role: 'CUSTOMER', status: 'ACTIVE' },
  { key: 'b', label: 'Khách kiểm tra phân quyền', phone: '0900000902', email: 'web-b@cleanhome.test', role: 'CUSTOMER', status: 'ACTIVE' },
  { key: 'empty', label: 'Khách chưa có đơn', phone: '0900000903', email: 'web-empty@cleanhome.test', role: 'CUSTOMER', status: 'ACTIVE' },
  { key: 'locked', label: 'Khách bị khóa', phone: '0900000904', email: 'web-locked@cleanhome.test', role: 'CUSTOMER', status: 'INACTIVE' },
  { key: 'worker', label: 'Nhân viên dữ liệu mẫu', phone: '0900000905', email: 'web-worker@cleanhome.test', role: 'EMPLOYEE', status: 'ACTIVE' },
];
export const webGroups = [
  ['ve-sinh', 'Vệ sinh'], ['cham-soc', 'Chăm sóc'], ['bao-duong', 'Bảo dưỡng'],
];
export const webServices = [
  { key: 'room', name: 'Vệ sinh phòng trọ', group: 've-sinh', cleaningType: 'phong-tro', price: 180000, minutes: 120, mode: 'reference', image: 'don-nha-theo-gio.png' },
  { key: 'house', name: 'Vệ sinh nhà ở gia đình', group: 've-sinh', cleaningType: 'nha-gia-dinh', price: 350000, minutes: 180, mode: 'survey', image: 'tong-ve-sinh.png' },
  { key: 'sofa', name: 'Vệ sinh sofa', group: 've-sinh', price: 250000, minutes: 90, mode: 'fixed', image: 've-sinh-sofa.png' },
  { key: 'mattress', name: 'Vệ sinh nệm', group: 've-sinh', price: 200000, minutes: 90, mode: 'fixed', image: 've-sinh-nem.png' },
  { key: 'garden', name: 'Chăm sóc sân vườn', group: 'cham-soc', price: 150000, minutes: 60, mode: 'reference', unit: 'giờ', min: 0.5, image: 'hero.png' },
  { key: 'plants', name: 'Chăm sóc cây trong nhà', group: 'cham-soc', price: 80000, minutes: 60, mode: 'fixed', unit: 'chậu', image: 'hero.png' },
  { key: 'aircon', name: 'Bảo dưỡng máy lạnh', group: 'bao-duong', price: 220000, minutes: 90, mode: 'fixed', unit: 'máy', image: 've-sinh-may-lanh.png' },
  { key: 'washer', name: 'Bảo dưỡng máy giặt', group: 'bao-duong', price: 250000, minutes: 90, mode: 'survey', image: 've-sinh-may-lanh.png' },
  { key: 'inactive', name: 'Dịch vụ đã ngừng cung cấp', group: 've-sinh', price: 160000, minutes: 60, mode: 'reference', inactive: true, image: 'don-nha-theo-gio.png' },
];
export const webProducts = [
  { key: 'floor', name: 'Nước lau sàn 1 lít', group: 've-sinh', price: 45000, unit: 'chai', stock: 40, services: ['room', 'house'] },
  { key: 'cloth', name: 'Khăn microfiber', group: 've-sinh', price: 30000, unit: 'bộ', stock: 40, services: ['room', 'sofa'] },
  { key: 'wood', name: 'Dung dịch chăm sóc đồ gỗ', group: 'cham-soc', price: 65000, unit: 'chai', stock: 25, services: ['plants'] },
  { key: 'spray', name: 'Bình xịt chăm sóc cây', group: 'cham-soc', price: 35000, unit: 'bình', stock: 20, services: ['garden', 'plants'] },
  { key: 'filter', name: 'Bộ lọc dùng tại nhà', group: 'bao-duong', price: 80000, unit: 'bộ', stock: 15, services: ['aircon'] },
  { key: 'brush', name: 'Bàn chải vệ sinh thiết bị', group: 'bao-duong', price: 25000, unit: 'chiếc', stock: 30, services: ['washer'] },
  { key: 'last', name: 'Mặt hàng chỉ còn một', group: 've-sinh', price: 15000, unit: 'chiếc', stock: 1, services: [] },
  { key: 'out', name: 'Mặt hàng đã hết', group: 've-sinh', price: 50000, unit: 'chai', stock: 0, status: 'OUT_OF_STOCK', services: [] },
  { key: 'inactive', name: 'Mặt hàng ngừng kinh doanh', group: 'bao-duong', price: 70000, unit: 'bộ', stock: 5, status: 'INACTIVE', services: [] },
];
export const webBookings = [
  { key: 'pending', account: 'a', service: 'room', status: 'PENDING', day: 1 },
  { key: 'confirmed', account: 'a', service: 'house', status: 'CONFIRMED', day: 2 },
  { key: 'working', account: 'a', service: 'aircon', status: 'IN_PROGRESS', day: 0 },
  { key: 'review-ready', account: 'a', service: 'house', status: 'COMPLETED', day: -1 },
  { key: 'reviewed', account: 'a', service: 'room', status: 'COMPLETED', day: -5, rating: 4 },
  { key: 'cancelled', account: 'a', service: 'sofa', status: 'CANCELLED', day: -2 },
  { key: 'cancel-requested', account: 'a', service: 'room', status: 'PENDING', day: 3, cancellation: true },
  { key: 'transfer', account: 'a', service: 'aircon', status: 'CONFIRMED', day: 4, payment: 'TRANSFER' },
  { key: 'cash', account: 'a', service: 'mattress', status: 'PENDING', day: 5, payment: 'CASH' },
  { key: 'history-care', account: 'a', service: 'garden', status: 'COMPLETED', day: -12, quantity: 1.5 },
  { key: 'history-older', account: 'a', service: 'room', status: 'COMPLETED', day: -35, rating: 5 },
  { key: 'inactive-snapshot', account: 'a', service: 'inactive', status: 'PENDING', day: 6 },
  { key: 'other-pending', account: 'b', service: 'room', status: 'PENDING', day: 7 },
  { key: 'other-completed', account: 'b', service: 'sofa', status: 'COMPLETED', day: -3 },
];
export const bookingSteps = (status) => ({
  PENDING: ['PENDING'], CONFIRMED: ['PENDING', 'CONFIRMED'], IN_PROGRESS: ['PENDING', 'CONFIRMED', 'IN_PROGRESS'],
  COMPLETED: ['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'], CANCELLED: ['PENDING', 'CANCELLED'],
})[status];
export const webPurchases = [
  { key: 'purchase-pending', account: 'a', status: 'PENDING', items: [{ product: 'floor', quantity: 1 }, { product: 'cloth', quantity: 1 }] },
  { key: 'purchase-processing', account: 'a', status: 'PROCESSING', items: [{ product: 'wood', quantity: 1 }] },
  { key: 'purchase-failed', account: 'a', status: 'FAILED', error: 'OUT_OF_STOCK', items: [{ product: 'out', quantity: 1 }] },
  { key: 'other-purchase', account: 'b', status: 'PENDING', items: [{ product: 'floor', quantity: 1 }] },
];
export const webDataPlan = {
  marker: WEB_MARKER, prefix: WEB_PREFIX, target: '127.0.0.1:3306/dich_vu_ve_sinh',
  branch: 'Reuse the configured active branch read-only; do not edit .env or existing branch rows.',
  counts: {
    users: webAccounts.length, employees: 1, service_categories: 3, services: webServices.length,
    product_categories: 3, products: webProducts.length, product_images: webProducts.length,
    product_inventory: webProducts.length, product_services: webProducts.reduce((n, p) => n + p.services.length, 0),
    bookings: webBookings.length, booking_items: webBookings.length,
    booking_status_history: webBookings.reduce((n, b) => n + bookingSteps(b.status).length + (b.cancellation ? 1 : 0), 0),
    assignments: webBookings.filter((b) => ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(b.status)).length,
    payments: webBookings.filter((b) => b.payment).length, reviews: webBookings.filter((b) => b.rating).length,
    product_orders: webPurchases.length,
    product_order_items: webPurchases.filter((p) => p.status === 'PENDING').reduce((n, p) => n + p.items.length, 0),
    product_stock_reservations: webPurchases.filter((p) => p.status === 'PENDING').length,
  },
  accounts: webAccounts.filter((a) => a.role === 'CUSTOMER').map(({ key, label, phone, email, status }) => ({ key, label, phone, email, status })),
  services: webServices.map((s) => ({ key: s.key, name: webName(s.name), active: !s.inactive })),
  products: webProducts.map((p) => ({ key: p.key, name: webName(p.name), stock: p.stock, status: p.status || 'AVAILABLE' })),
  scenarios: webBookings.map(({ key, account, status, day, payment, rating, cancellation }) => ({ key, account, status, day, payment, rating, cancellation })),
  productScenarios: webPurchases.map(({ key, account, status }) => ({ key, account, status })),
};
