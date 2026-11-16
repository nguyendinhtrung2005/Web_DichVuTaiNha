import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createMysqlPool } from '../shared/mysql-pool.js';
import { checkCustomerEmailSchema, checkCustomerBookingIdempotencySchema } from '../shared/database-checks.js';
import { hashPassword } from '../shared/passwords.js';
import { bookingRequestHash } from '../order-service/src/repository.js';
import { WEB_MARKER, WEB_PREFIX, webName, webAccounts, webGroups, webServices, webProducts, webBookings, bookingSteps, webPurchases, webDataPlan } from './customer-web-data-definition.js';

export const webAccessPath = fileURLToPath(new URL('../.test-artifacts/customer-web-data/access.json', import.meta.url));
const privateDirectory = fileURLToPath(new URL('../.test-artifacts/customer-web-data/', import.meta.url));
const parentColumns = { users: 'full_name', service_categories: 'name', services: 'name', product_categories: 'name', products: 'name' };
const tables = Object.keys(webDataPlan.counts);
const placeholders = (values) => values.map(() => '?').join(',');
const clone = (value) => JSON.parse(JSON.stringify(value));
export class WebDataError extends Error {}

function assertTarget(env, apply = false) {
  if (!['127.0.0.1', 'localhost'].includes(env.DB_HOST) || Number(env.DB_PORT || 3306) !== 3306 || env.DB_NAME !== 'dich_vu_ve_sinh') {
    throw new WebDataError('Chỉ hỗ trợ target local đã duyệt 127.0.0.1:3306/dich_vu_ve_sinh.');
  }
  if (apply && env.ALLOW_CUSTOMER_WEB_SEED !== '1') throw new WebDataError('Cần phê duyệt bộ dữ liệu lưu lại và ALLOW_CUSTOMER_WEB_SEED=1 trước bước ghi.');
}

export async function inspectWebData(pool, env = process.env) {
  assertTarget(env);
  const [database] = await pool.query('SELECT DATABASE() AS name');
  if (database[0]?.name !== 'dich_vu_ve_sinh') throw new WebDataError('Database thực tế không khớp target.');
  if (!await checkCustomerEmailSchema(pool) || !await checkCustomerBookingIdempotencySchema(pool)) throw new WebDataError('Migration 001/003 chưa sẵn sàng; không tự áp dụng.');
  const [engines] = await pool.execute(`SELECT table_name AS name, engine AS engine FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN (${placeholders(tables)})`, tables);
  if (engines.length !== tables.length || engines.some((row) => row.engine !== 'InnoDB')) throw new WebDataError('Thiếu bảng/migration 002 hoặc bảng không hỗ trợ transaction InnoDB.');
  const [metadata] = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='services' AND column_name='customer_config'");
  if (metadata.length !== 1) throw new WebDataError('Thiếu metadata dịch vụ migration 002.');
  if (!/^[1-9]\d*$/.test(env.CUSTOMER_DEFAULT_BRANCH_ID || '')) throw new WebDataError('Cần chi nhánh mặc định đã được owner cấu hình.');
  const [branches] = await pool.execute('SELECT id,status FROM branches WHERE id=?', [env.CUSTOMER_DEFAULT_BRANCH_ID]);
  if (branches[0]?.status !== 'ACTIVE') throw new WebDataError('Chi nhánh mặc định không hoạt động.');
  const counts = {}, existingMarker = {};
  for (const table of tables) {
    const [rows] = await pool.query('SELECT COUNT(*) AS count FROM ' + table);
    counts[table] = Number(rows[0].count);
  }
  for (const [table, column] of Object.entries(parentColumns)) {
    const [rows] = await pool.execute(`SELECT COUNT(*) AS count FROM ${table} WHERE LEFT(${column},CHAR_LENGTH(?))=?`, [WEB_PREFIX, WEB_PREFIX]);
    existingMarker[table] = Number(rows[0].count);
  }
  const phones = webAccounts.map((a) => a.phone), emails = webAccounts.map((a) => a.email);
  const [collisions] = await pool.execute(`SELECT COUNT(*) AS count FROM users WHERE phone IN (${placeholders(phones)}) OR email IN (${placeholders(emails)})`, [...phones, ...emails]);
  return { target: webDataPlan.target, branchId: String(branches[0].id), counts, existingMarker, accountCollisions: Number(collisions[0].count) };
}

function assertFresh(inspection) {
  if (Object.values(inspection.existingMarker).some((count) => count !== 0) || inspection.accountCollisions !== 0) {
    throw new WebDataError('Marker/tài khoản đã tồn tại; dừng để giữ dữ liệu và không reset mật khẩu/tồn kho. Dùng --verify nếu đã nạp.');
  }
}

const sqlDate = (milliseconds) => new Date(milliseconds).toISOString().slice(0, 19).replace('T', ' ');
function schedule(day, now) {
  if (day === 0) return Math.floor((now - 30 * 60000) / 1000) * 1000;
  const vietnamDay = new Date(now + day * 86400000 + 7 * 3600000).toISOString().slice(0, 10);
  return Date.parse(vietnamDay + 'T09:00:00+07:00');
}
function contact(account) {
  return { name: webName(account.label), phone: account.phone, address: WEB_MARKER + ' - Địa chỉ giả lập để kiểm tra web, không phải nơi phục vụ thật.', houseType: 'can-ho', hasPets: false, area: 60, rooms: 2, floors: 1 };
}
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sortItems = (items) => [...items].sort((a, b) => BigInt(a.productId) < BigInt(b.productId) ? -1 : 1);

export async function applyWebData(pool, env = process.env, { artifactStore = { readFile, mkdir, writeFile }, encodePassword = hashPassword } = {}) {
  assertTarget(env, true);
  assertFresh(await inspectWebData(pool, env));
  const ignore = await artifactStore.readFile(new URL('../../.gitignore', import.meta.url), 'utf8');
  if (!ignore.split(/\r?\n/).includes('backend/.test-artifacts/')) throw new WebDataError('Private access file phải được Git ignore trước khi tạo.');
  const accounts = [];
  for (const account of webAccounts) {
    const password = 'WebTest-' + randomBytes(15).toString('base64url') + '!7a';
    accounts.push({ ...account, passwordHash: await encodePassword(password), ...(account.role === 'CUSTOMER' ? { password } : {}) });
  }
  const registry = { version: 1, marker: WEB_MARKER, target: webDataPlan.target, phase: 'preparing', createdAt: new Date().toISOString(), branchId: null,
    ids: Object.fromEntries(tables.map((table) => [table, []])), accounts: [], services: [], products: [], bookings: [], purchases: [] };
  const connection = await pool.getConnection();
  let locked = false, transaction = false, commitStarted = false, committed = false, privateCreated = false, reusable = true;
  const save = () => artifactStore.writeFile(webAccessPath, JSON.stringify(registry, null, 2), { mode: 0o600 });
  const insert = async (table, sql, parameters, key) => {
    const [result] = await connection.execute(sql, parameters);
    const id = key ?? String(result.insertId);
    registry.ids[table].push(id);
    await save();
    return id;
  };
  try {
    const [locks] = await connection.execute("SELECT GET_LOCK(SHA2(CONCAT(DATABASE(), ':', ?),256),0) AS acquired", [WEB_MARKER]);
    if (Number(locks[0]?.acquired) !== 1) throw new WebDataError('Một tiến trình khác đang chuẩn bị bộ dữ liệu.');
    locked = true;
    const inspection = await inspectWebData(connection, env);
    assertFresh(inspection);
    registry.branchId = inspection.branchId;
    registry.baseline = inspection.counts;
    await artifactStore.mkdir(privateDirectory, { recursive: true, mode: 0o700 });
    try { await artifactStore.writeFile(webAccessPath, JSON.stringify(registry, null, 2), { flag: 'wx', mode: 0o600 }); }
    catch { throw new WebDataError('Private access file đã tồn tại/không ghi được; không ghi đè hoặc tạo dữ liệu.'); }
    privateCreated = true;
    await connection.beginTransaction(); transaction = true;
    const users = {};
    for (const account of accounts) {
      account.id = await insert('users', 'INSERT INTO users(full_name,phone,email,password_hash,role,status) VALUES(?,?,?,?,?,?)', [webName(account.label), account.phone, account.email, account.passwordHash, account.role, account.status]);
      users[account.key] = account;
      if (account.role === 'CUSTOMER') registry.accounts.push({ key: account.key, name: webName(account.label), id: account.id, phone: account.phone, email: account.email, password: account.password, status: account.status });
    }
    await save();
    const employeeId = await insert('employees', "INSERT INTO employees(user_id,branch_id,verification_status,status) VALUES(?,?,'VERIFIED','ACTIVE')", [users.worker.id, inspection.branchId]);
    const categories = {}, productCategories = {};
    for (const [group, label] of webGroups) {
      categories[group] = await insert('service_categories', 'INSERT INTO service_categories(name,description,is_active) VALUES(?,?,TRUE)', [webName(label), WEB_MARKER + ' - Nhóm dữ liệu tổng hợp để kiểm tra Customer.']);
      productCategories[group] = await insert('product_categories', 'INSERT INTO product_categories(name,description,is_active) VALUES(?,?,TRUE)', [webName('Sản phẩm ' + label.toLowerCase()), WEB_MARKER + ' - Mua thêm hoàn toàn tự nguyện, không có vận chuyển/thanh toán thật.']);
    }
    const services = {}, products = {};
    for (const service of webServices) {
      const config = { version: 1, group: service.group, ...(service.cleaningType ? { cleaningType: service.cleaningType } : {}),
        pricingMode: service.mode, image: '/images/' + service.image, minQuantity: service.min || 1, defaultQuantity: 1, quantityLabel: 'Số lượng', baseMinutes: 0,
        scope: ['Kiểm tra phạm vi và làm sạch khu vực đã thống nhất', 'Ưu tiên khu vực khách ghi chú; không cam kết dịch vụ ngoài mô tả'],
        included: ['Dụng cụ cơ bản trong phạm vi minh họa', 'Thông tin nhà ở và yêu cầu được xác nhận trước khi làm'],
        excluded: ['Thay linh kiện, sửa chữa và làm việc trên cao', 'Sản phẩm mua thêm; vận chuyển và thanh toán thật'] };
      const id = await insert('services', 'INSERT INTO services(category_id,name,description,unit,base_price,duration_minutes,is_active,customer_config) VALUES(?,?,?,?,?,?,?,?)',
        [categories[service.group], webName(service.name), WEB_MARKER + ' - Giá và nội dung chỉ là dữ liệu kiểm thử, không phải cam kết kinh doanh. Có phạm vi bao gồm/không bao gồm để thử trang chi tiết.', service.unit || 'lần', service.price, service.minutes, !service.inactive, JSON.stringify(config)]);
      services[service.key] = { ...service, id, name: webName(service.name), unit: service.unit || 'lần' };
      registry.services.push({ key: service.key, id, name: webName(service.name), active: !service.inactive, url: '/dich-vu/' + id });
    }
    for (const product of webProducts) {
      const id = await insert('products', 'INSERT INTO products(category_id,name,description,unit,price,status) VALUES(?,?,?,?,?,?)',
        [productCategories[product.group], webName(product.name), WEB_MARKER + ' - Hàng hóa và ảnh placeholder chỉ để thử web; mua riêng hoặc mua thêm tự nguyện, không phải vật tư bắt buộc của dịch vụ.', product.unit, product.price, product.status || 'AVAILABLE']);
      products[product.key] = { ...product, id, name: webName(product.name) };
      registry.products.push({ key: product.key, id, name: webName(product.name), stock: product.stock, status: product.status || 'AVAILABLE', url: '/san-pham/' + id });
      await insert('product_images', 'INSERT INTO product_images(product_id,image_url,is_primary,sort_order) VALUES(?,?,TRUE,0)', [id, '/placeholder.svg']);
      await insert('product_inventory', 'INSERT INTO product_inventory(product_id,quantity,reserved_quantity,min_stock) VALUES(?,?,0,2)', [id, product.stock], id);
      for (const serviceKey of product.services) await insert('product_services', 'INSERT INTO product_services(product_id,service_id) VALUES(?,?)', [id, services[serviceKey].id], id + ':' + services[serviceKey].id);
    }
    const now = Date.now();
    for (const sample of webBookings) {
      const account = users[sample.account], service = services[sample.service], quantity = sample.quantity || 1;
      const start = schedule(sample.day, now), duration = Math.max(60, Math.ceil(service.minutes * quantity / 30) * 30), end = start + duration * 60000;
      if (end > Date.parse('2038-01-19T03:14:07Z')) throw new WebDataError('Lịch mẫu vượt giới hạn TIMESTAMP; dừng transaction.');
      const input = { requestKey: randomUUID(), serviceId: service.id, quantity, contact: contact(account), scheduledAt: new Date(start).toISOString(), specialRequest: webName(sample.key) + ' - Trạng thái tổng hợp để thử Customer, không phải thao tác Admin/Staff thật.' };
      if (service.cleaningType === 'phong-tro') input.contact.houseType = 'phong-tro';
      const price = Math.round(service.price * quantity * 100) / 100;
      const snapshot = JSON.stringify({ version: 1, contact: input.contact, specialRequest: input.specialRequest, pricingMode: service.mode });
      const id = await insert('bookings', 'INSERT INTO bookings(customer_id,branch_id,address_snapshot,scheduled_start,scheduled_end,status,total_amount,customer_request_key,customer_request_hash) VALUES(?,?,?,?,?,?,?,?,?)',
        [account.id, inspection.branchId, snapshot, sqlDate(start), sqlDate(end), sample.status, price, input.requestKey, bookingRequestHash(input)]);
      await insert('booking_items', 'INSERT INTO booking_items(booking_id,service_id,service_name_snapshot,quantity,unit_price,unit_snapshot) VALUES(?,?,?,?,?,?)', [id, service.id, service.name, quantity, service.price, service.unit]);
      const confirmedAt = Math.min(now - 2 * 3600000, start - 2 * 3600000);
      const times = { PENDING: confirmedAt - 86400000, CONFIRMED: confirmedAt, IN_PROGRESS: start, COMPLETED: end, CANCELLED: Math.min(now - 3600000, start - 3600000) };
      for (const status of bookingSteps(sample.status)) {
        const note = status === 'PENDING' ? JSON.stringify({ version: 1, type: 'CUSTOMER_ORDER_CREATED', marker: WEB_MARKER }) : WEB_MARKER + ' - Lịch sử trạng thái mô phỏng, không chạy UC Admin/Staff.';
        await insert('booking_status_history', 'INSERT INTO booking_status_history(booking_id,changed_by,status,note,created_at) VALUES(?,?,?,?,?)', [id, status === 'PENDING' ? account.id : users.worker.id, status, note, sqlDate(times[status])]);
      }
      if (sample.cancellation) await insert('booking_status_history', 'INSERT INTO booking_status_history(booking_id,changed_by,status,note,created_at) VALUES(?,?,?,?,?)', [id, account.id, sample.status, JSON.stringify({ version: 1, type: 'CUSTOMER_CANCEL_REQUESTED', reason: WEB_MARKER + ' - Muốn đổi lịch thử nghiệm.' }), sqlDate(now - 30 * 60000)]);
      if (['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(sample.status)) {
        await insert('assignments', 'INSERT INTO assignments(booking_id,employee_id,status,assigned_at,check_in_at,check_out_at) VALUES(?,?,?,?,?,?)',
          [id, employeeId, sample.status === 'CONFIRMED' ? 'ASSIGNED' : sample.status, sqlDate(confirmedAt), sample.status === 'CONFIRMED' ? null : sqlDate(start), sample.status === 'COMPLETED' ? sqlDate(end) : null]);
      }
      if (sample.payment) await insert('payments', "INSERT INTO payments(booking_id,amount,method,provider_ref,status,paid_at) VALUES(?,?,?,?,'PENDING',NULL)", [id, price, sample.payment, 'CUSTOMER_SIM_V1:' + id]);
      if (sample.rating) await insert('reviews', 'INSERT INTO reviews(booking_id,employee_id,rating,comment,created_at) VALUES(?,?,?,?,?)', [id, employeeId, sample.rating, WEB_MARKER + ' - Đánh giá giả lập để kiểm tra điểm chung; không phải ý kiến khách thật.', sqlDate(end + 3600000)]);
      registry.bookings.push({ key: sample.key, account: sample.account, id, status: sample.status, scheduledAt: input.scheduledAt, serviceId: service.id, url: '/don/' + id });
      await save();
    }
    for (const sample of webPurchases) {
      const account = users[sample.account], requestKey = randomUUID();
      const items = sortItems(sample.items.map((item) => ({ productId: products[item.product].id, quantity: item.quantity })));
      const purchaseContact = { name: webName(account.label), phone: account.phone, note: WEB_MARKER + ' - Đơn mua độc lập, không lịch hẹn, chưa thanh toán/vận chuyển thật.' };
      const snapshots = sample.items.map((item) => { const p = products[item.product]; return { productId: p.id, code: 'SP' + p.id, name: p.name, unit: p.unit, quantity: item.quantity, unitPrice: p.price }; });
      const total = snapshots.reduce((amount, item) => amount + item.quantity * item.unitPrice, 0);
      const id = await insert('product_orders', 'INSERT INTO product_orders(customer_id,request_key,request_hash,items_request,contact_snapshot,status,total_amount,error_code) VALUES(?,?,?,?,?,?,?,?)',
        [account.id, requestKey, digest({ contact: purchaseContact, items }), JSON.stringify(items), JSON.stringify(purchaseContact), sample.status, sample.status === 'PENDING' ? total : null, sample.error || null]);
      if (sample.status === 'PENDING') {
        for (const item of snapshots) {
          await insert('product_order_items', 'INSERT INTO product_order_items(product_order_id,product_id,product_code_snapshot,product_name_snapshot,unit_snapshot,quantity,unit_price,line_total) VALUES(?,?,?,?,?,?,?,?)',
            [id, item.productId, item.code, item.name, item.unit, item.quantity, item.unitPrice, item.quantity * item.unitPrice]);
          const [updated] = await connection.execute('UPDATE product_inventory SET reserved_quantity=reserved_quantity+? WHERE product_id=? AND quantity-reserved_quantity>=?', [item.quantity, item.productId, item.quantity]);
          if (updated.affectedRows !== 1) throw new WebDataError('Tồn kho dữ liệu mẫu không nhất quán.');
        }
        await insert('product_stock_reservations', "INSERT INTO product_stock_reservations(operation_key,customer_id,request_hash,items_snapshot,total_amount,status) VALUES(?,?,?,?,?,'RESERVED')",
          ['purchase-' + id, account.id, digest({ customerId: String(account.id), items }), JSON.stringify(snapshots), total]);
      }
      registry.purchases.push({ key: sample.key, account: sample.account, id, status: sample.status, url: '/don-san-pham/' + id });
      await save();
    }
    for (const [table, count] of Object.entries(webDataPlan.counts)) if (registry.ids[table].length !== count) throw new WebDataError('Số bản ghi tạo không đúng kế hoạch: ' + table);
    registry.phase = 'committing'; await save();
    commitStarted = true;
    await connection.commit(); committed = true; transaction = false;
    registry.phase = 'applied'; await save();
    return { marker: WEB_MARKER, target: webDataPlan.target, branchId: inspection.branchId, counts: clone(webDataPlan.counts), privateAccessFile: 'backend/.test-artifacts/customer-web-data/access.json' };
  } catch (error) {
    if (transaction && !committed) { try { await connection.rollback(); } catch { reusable = false; } }
    if (privateCreated) {
      registry.phase = committed ? 'committed-check-file' : commitStarted ? 'uncertain' : 'rolledback';
      await save().catch(() => {});
    }
    if (commitStarted) throw new WebDataError('Có thể đã commit. Không nạp lại hoặc xóa. Chạy --verify và kiểm tra private access file trước khi xử lý tiếp.');
    throw error;
  } finally {
    if (locked) {
      try { const [released] = await connection.execute("SELECT RELEASE_LOCK(SHA2(CONCAT(DATABASE(), ':', ?),256)) AS released", [WEB_MARKER]); if (Number(released[0]?.released) !== 1) reusable = false; }
      catch { reusable = false; }
    }
    if (reusable) connection.release(); else connection.destroy();
  }
}

export async function verifyWebData(pool, env = process.env) {
  const inspection = await inspectWebData(pool, env);
  let registry;
  try { registry = JSON.parse(await readFile(webAccessPath, 'utf8')); } catch { throw new WebDataError('Chưa có private access file để đối chiếu.'); }
  if (registry.version !== 1 || registry.marker !== WEB_MARKER || registry.target !== webDataPlan.target || !registry.ids) throw new WebDataError('Private registry không đúng bộ dữ liệu.');
  const counts = {};
  for (const [table, expected] of Object.entries(webDataPlan.counts)) {
    const ids = registry.ids[table];
    if (!Array.isArray(ids) || ids.length !== expected || ids.some((id) => typeof id !== 'string' || !(table === 'product_services' ? /^[1-9]\d*:[1-9]\d*$/ : /^[1-9]\d*$/).test(id))) throw new WebDataError('Registry ID không hợp lệ: ' + table);
    if (table === 'product_services') {
      const parameters = ids.flatMap((id) => id.split(':'));
      const [rows] = await pool.execute(`SELECT COUNT(*) AS count FROM product_services WHERE ${ids.map(() => '(product_id=? AND service_id=?)').join(' OR ')}`, parameters);
      counts[table] = Number(rows[0].count);
    } else {
      const key = table === 'product_inventory' ? 'product_id' : 'id';
      const [rows] = await pool.execute(`SELECT COUNT(*) AS count FROM ${table} WHERE ${key} IN (${placeholders(ids)})`, ids);
      counts[table] = Number(rows[0].count);
    }
    if (counts[table] !== expected) throw new WebDataError('Dữ liệu thiếu hoặc chưa commit: ' + table + '. Không tự nạp lại.');
  }
  return { marker: WEB_MARKER, phase: registry.phase, target: inspection.target, counts, scenarios: registry.bookings.length, productScenarios: registry.purchases.length, privateAccessFile: 'backend/.test-artifacts/customer-web-data/access.json' };
}

export async function verifyWebDataHttp(pool, env = process.env) {
  await verifyWebData(pool, env);
  const registry = JSON.parse(await readFile(webAccessPath, 'utf8'));
  const { startCustomerStack } = await import('./customer-runtime.js');
  const stack = await startCustomerStack({ env: { ...env, NODE_ENV: 'test' },
    ports: { auth: 0, user: 0, catalog: 0, order: 0, staff: 0, payment: 0, review: 0, gateway: 0 },
    configOverrides: { origin: 'http://localhost:3001', defaultBranchId: registry.branchId } });
  const assert = (condition, message) => { if (!condition) throw new WebDataError('HTTP verify: ' + message); };
  const read = async (path, cookie, method = 'GET', body) => {
    const response = await fetch(stack.urls.gateway + '/api/v1' + path, { method,
      headers: { Origin: 'http://localhost:3001', ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  try {
    const cookies = {};
    for (const account of registry.accounts) {
      const login = await read('/auth/login', null, 'POST', { identifier: account.key === 'b' ? account.phone : account.email, password: account.password });
      assert(login.status === (account.status === 'ACTIVE' ? 200 : 401), 'Trạng thái đăng nhập tài khoản mẫu không đúng: ' + account.key);
      if (account.status === 'ACTIVE') { assert(login.body.data.id === account.id, 'Sai identity tài khoản.'); cookies[account.key] = login.cookie; }
    }
    assert((await read('/users/me')).status === 401 && (await read('/orders')).status === 401, 'Route riêng tư chưa được chặn.');
    const a = await read('/orders', cookies.a), b = await read('/orders', cookies.b), empty = await read('/orders', cookies.empty);
    assert(a.status === 200 && a.body.data.total === 12, 'Danh sách A không đủ 12 kịch bản ban đầu.');
    assert(b.status === 200 && b.body.data.total === 2 && empty.status === 200 && empty.body.data.total === 0, 'Dữ liệu B/empty bị lẫn.');
    const userA = registry.accounts.find((account) => account.key === 'a').id;
    assert(a.body.data.items.every((order) => order.customerId === userA), 'Ownership đơn A sai.');
    const foreign = registry.bookings.find((order) => order.account === 'b');
    assert((await read('/orders/' + foreign.id, cookies.a)).status === 404, 'Khách A thấy đơn B.');
    assert(new Set(a.body.data.items.map((order) => order.status)).size === 5, 'Thiếu trạng thái dịch vụ.');
    const room = registry.services.find((service) => service.key === 'room');
    const summary = await read('/reviews/service-summary?serviceId=' + room.id);
    assert(summary.status === 200 && summary.body.data.count === 2 && summary.body.data.averageRating === 4.5, 'Điểm trung bình mẫu không đúng.');
    const inactiveService = registry.services.find((service) => !service.active);
    assert((await read('/catalog/services/' + inactiveService.id)).status === 404, 'Dịch vụ inactive vẫn khả dụng.');
    for (const [key, expected] of [['last', 'available'], ['out', 'out_of_stock'], ['inactive', 'inactive']]) {
      const product = registry.products.find((item) => item.key === key);
      const response = await read('/catalog/products/' + product.id);
      assert(response.status === 200 && response.body.data.status === expected, 'Trạng thái sản phẩm sai: ' + key);
    }
    const purchases = await read('/product-orders', cookies.a);
    assert(purchases.status === 200 && purchases.body.data.total === 3 && new Set(purchases.body.data.items.map((order) => order.status)).size === 3, 'Thiếu ba trạng thái đơn mua sản phẩm.');
    const foreignPurchase = registry.purchases.find((order) => order.account === 'b');
    assert((await read('/product-orders/' + foreignPurchase.id, cookies.a)).status === 404, 'Khách A thấy đơn sản phẩm B.');
    const page = await read('/orders?limit=8&page=1', cookies.a);
    assert(page.status === 200 && page.body.data.items.length === 8 && page.body.data.total === 12, 'Phân trang không đúng.');
    const reviews = await read('/reviews', cookies.a), payments = await read('/payments', cookies.a);
    assert(reviews.status === 200 && reviews.body.data.total === 2 && payments.status === 200 && payments.body.data.total === 2, 'Thiếu đánh giá/thanh toán mô phỏng.');
    return { status: 'PASS', checks: ['four-customer-login-states', 'ownership', 'empty-state', 'five-booking-states', 'pagination', 'reviews-and-summary', 'simulated-payments', 'three-product-order-states', 'product-stock-states'], mutations: 'Auth sessions in memory only; business data was read, not changed.' };
  } finally { await stack.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2] || '--plan';
  if (mode === '--plan') process.stdout.write(JSON.stringify(webDataPlan, null, 2) + '\n');
  else if (!['--check', '--apply', '--verify', '--verify-http'].includes(mode)) { process.stderr.write('Use --plan, --check, --apply, --verify, or --verify-http.\n'); process.exitCode = 1; }
  else {
    let pool;
    try {
      assertTarget(process.env, mode === '--apply');
      pool = createMysqlPool();
      const result = mode === '--apply' ? await applyWebData(pool) : mode === '--verify' ? await verifyWebData(pool) : mode === '--verify-http' ? await verifyWebDataHttp(pool) : await inspectWebData(pool);
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } catch (error) { process.stderr.write('Web test data FAIL: ' + (error instanceof WebDataError ? error.message : 'Kiểm tra kết nối/schema/file riêng. Không tự reset hoặc retry; dùng --verify nếu kết quả commit chưa rõ.') + '\n'); process.exitCode = 1; }
    finally { if (pool) await pool.end(); }
  }
}
