import { pathToFileURL } from 'node:url';
import { createMysqlPool } from '../shared/mysql-pool.js';
import { checkCustomerBookingIdempotencySchema } from '../shared/database-checks.js';

export const DEMO_MARKER = 'CH_CUSTOMER_DEMO_V1';
const name = (label) => '[DEMO] ' + label;
const targets = ['branches', 'service_categories', 'services', 'product_categories', 'products', 'product_images', 'product_inventory', 'product_services'];
const definitions = [
  { name: 'Vệ sinh phòng trọ', group: 've-sinh', cleaningType: 'phong-tro', price: 180000, minutes: 120, image: '/images/don-nha-theo-gio.png', pricingMode: 'reference', scope: ['Sàn và bề mặt trong phòng trọ', 'Khu vực bếp nhỏ và nhà vệ sinh'], included: ['Lau sàn và bề mặt dễ tiếp cận', 'Vệ sinh bếp và thiết bị vệ sinh bên ngoài'], excluded: ['Thu gom phế thải xây dựng', 'Di chuyển đồ nặng hoặc làm việc trên cao'] },
  { name: 'Vệ sinh nhà ở gia đình', group: 've-sinh', cleaningType: 'nha-gia-dinh', price: 350000, minutes: 180, image: '/images/tong-ve-sinh.png', pricingMode: 'survey', scope: ['Phòng khách, phòng ngủ, bếp và nhà vệ sinh', 'Thống nhất diện tích và phạm vi trước khi thực hiện'], included: ['Lau bụi bề mặt và lau sàn', 'Làm sạch khu vực sinh hoạt đã thống nhất'], excluded: ['Vệ sinh sau xây dựng', 'Giặt sofa, nệm hoặc bảo dưỡng thiết bị'] },
  { name: 'Chăm sóc nội thất', group: 'cham-soc', price: 250000, minutes: 120, image: '/images/ve-sinh-sofa.png', pricingMode: 'survey', scope: ['Kiểm tra và làm sạch bề mặt nội thất phù hợp vật liệu'], included: ['Kiểm tra vật liệu trước khi làm', 'Làm sạch bề mặt theo phạm vi được xác nhận'], excluded: ['Sửa chữa hoặc thay thế nội thất', 'Phục hồi hư hỏng nặng'] },
  { name: 'Bảo dưỡng máy lạnh', group: 'bao-duong', price: 200000, minutes: 90, image: '/images/ve-sinh-may-lanh.png', pricingMode: 'fixed', scope: ['Bảo dưỡng cơ bản một máy lạnh gia đình ở vị trí dễ tiếp cận'], included: ['Làm sạch bộ lọc và bề mặt dàn lạnh', 'Kiểm tra vận hành cơ bản'], excluded: ['Nạp gas hoặc thay linh kiện', 'Thi công giàn giáo và xử lý sự cố điện'] },
];

export const demoPlan = {
  marker: DEMO_MARKER, target: '127.0.0.1:3306/dich_vu_ve_sinh',
  tables: targets, counts: { branches: 1, service_categories: 3, services: 4, product_categories: 1, products: 2, product_images: 2, product_inventory: 2, product_services: 2 },
  services: definitions.map((item) => name(item.name)),
  products: [name('Nước lau sàn dùng tại nhà'), name('Khăn lau đa năng')],
};

export async function prepareCustomerDemo(pool, env = process.env) {
  if (env.ALLOW_CUSTOMER_DEMO_SEED !== '1' || !['localhost', '127.0.0.1'].includes(env.DB_HOST)
    || Number(env.DB_PORT || 3306) !== 3306 || env.DB_NAME !== 'dich_vu_ve_sinh') throw new Error('Seed requires explicit approval for the local target.');
  const [database] = await pool.query('SELECT DATABASE() AS name');
  if (database[0]?.name !== 'dich_vu_ve_sinh' || !await checkCustomerBookingIdempotencySchema(pool)) throw new Error('Approved target/migration 003 is not ready.');
  const connection = await pool.getConnection();
  let locked = false;
  let reusable = true;
  try {
    const [lock] = await connection.execute('SELECT GET_LOCK(?,0) AS acquired', [DEMO_MARKER]);
    if (Number(lock[0]?.acquired) !== 1) throw new Error('Another demo preparation is running.');
    locked = true;
    await connection.beginTransaction();
    const counts = {};
    for (const table of targets) {
      const [rows] = await connection.query('SELECT COUNT(*) AS total FROM ' + table);
      counts[table] = Number(rows[0].total);
    }
    if (Object.values(counts).some((count) => count !== 0)) throw new Error('Catalog/branch data already exists; stopped without overwriting or refilling stock.');
    const [branch] = await connection.execute('INSERT INTO branches (name,address_text,service_area,latitude,longitude,status) VALUES (?,?,?,0,0,?)', [name('Chi nhánh thử nghiệm Customer'), DEMO_MARKER + ' - Địa điểm giả lập, không phải địa chỉ phục vụ thật.', JSON.stringify({ demo: true, marker: DEMO_MARKER }), 'ACTIVE']);
    const groups = {};
    for (const [code, label] of [['ve-sinh', 'Vệ sinh'], ['cham-soc', 'Chăm sóc'], ['bao-duong', 'Bảo dưỡng']]) {
      const [result] = await connection.execute('INSERT INTO service_categories (name,description,is_active) VALUES (?,?,TRUE)', [name(label), DEMO_MARKER + ' - Danh mục minh họa để kiểm tra local.']);
      groups[code] = String(result.insertId);
    }
    const serviceIds = [];
    for (const item of definitions) {
      const metadata = { version: 1, group: item.group, ...(item.cleaningType ? { cleaningType: item.cleaningType } : {}), scope: item.scope, included: item.included, excluded: item.excluded, image: item.image, pricingMode: item.pricingMode, minQuantity: 1, defaultQuantity: 1, quantityLabel: 'Số lượt', baseMinutes: 0 };
      const [result] = await connection.execute('INSERT INTO services (category_id,name,description,unit,base_price,duration_minutes,is_active,customer_config) VALUES (?,?,?,?,?,?,TRUE,?)', [groups[item.group], name(item.name), DEMO_MARKER + ' - Dữ liệu minh họa. Giá và phạm vi để thử nghiệm, không phải cam kết cung cấp dịch vụ thực tế.\n' + item.scope.join('. '), 'lần', item.price, item.minutes, JSON.stringify(metadata)]);
      serviceIds.push(String(result.insertId));
    }
    const [category] = await connection.execute('INSERT INTO product_categories (name,description,is_active) VALUES (?,?,TRUE)', [name('Dùng tại nhà'), DEMO_MARKER + ' - Hàng hóa minh họa, chưa vận chuyển/thanh toán thật.']);
    const productIds = [];
    for (const [label, unit, price] of [['Nước lau sàn dùng tại nhà', 'chai', 45000], ['Khăn lau đa năng', 'bộ', 30000]]) {
      const [result] = await connection.execute('INSERT INTO products (category_id,name,description,unit,price,status) VALUES (?,?,?,?,?,?)', [category.insertId, name(label), DEMO_MARKER + ' - Sản phẩm minh họa mua riêng hoặc mua thêm tự nguyện; không phải vật tư bắt buộc của dịch vụ.', unit, price, 'AVAILABLE']);
      const id = String(result.insertId);
      productIds.push(id);
      await connection.execute('INSERT INTO product_images (product_id,image_url,is_primary,sort_order) VALUES (?,?,TRUE,0)', [id, '/placeholder.svg']);
      await connection.execute('INSERT INTO product_inventory (product_id,quantity,reserved_quantity,min_stock) VALUES (?,20,0,2)', [id]);
      await connection.execute('INSERT INTO product_services (product_id,service_id) VALUES (?,?)', [id, serviceIds[0]]);
    }
    await connection.commit();
    return { marker: DEMO_MARKER, branchId: String(branch.insertId), categoryIds: groups, serviceIds, productCategoryId: String(category.insertId), productIds };
  } catch (error) {
    try { await connection.rollback() } catch { reusable = false }
    throw error;
  } finally {
    if (locked) {
      try { const [rows] = await connection.execute('SELECT RELEASE_LOCK(?) AS released', [DEMO_MARKER]); if (Number(rows[0]?.released) !== 1) reusable = false }
      catch { reusable = false }
    }
    if (reusable) connection.release(); else connection.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv.includes('--apply')) console.log(JSON.stringify(demoPlan, null, 2));
  else {
    const pool = createMysqlPool();
    try { console.log(JSON.stringify(await prepareCustomerDemo(pool), null, 2)) }
    catch { console.error('Demo preparation FAIL. Verify approval, local target, schema and empty catalog/branch tables. No automatic overwrite or retry.'); process.exitCode = 1 }
    finally { await pool.end() }
  }
}
