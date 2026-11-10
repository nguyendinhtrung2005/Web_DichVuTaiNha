import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assertFixtureTarget, createCustomerFixtures, cleanupCustomerFixtures } from './customer-fixtures.js';

const artifactDirectory = fileURLToPath(new URL('../.test-artifacts/', import.meta.url));
const tables = ['users', 'service_categories', 'services', 'branches', 'employees', 'assignments', 'bookings', 'booking_items', 'booking_status_history', 'booking_decision_history', 'payments', 'reviews', 'product_categories', 'products', 'product_images', 'product_inventory', 'product_services', 'product_stock_reservations', 'product_orders', 'product_order_items'];
const placeholders = (values) => values.map(() => '?').join(',');
const productParents = new Set(['products', 'product_categories']);

export async function countFixtureTables(pool) {
  const result = {};
  const [automationTable] = await pool.execute(
    `SELECT COUNT(*) AS present FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'booking_decision_history'`,
  );
  const presentTables = automationTable[0]?.present ? tables : tables.filter((table) => table !== 'booking_decision_history');
  for (const table of presentTables) {
    const [rows] = await pool.query('SELECT COUNT(*) AS total FROM ' + table);
    result[table] = Number(rows[0].total);
  }
  return result;
}
export async function assertProductFixtureTarget(pool, env = process.env) {
  await assertFixtureTarget(pool, env);
  const [existing] = await pool.execute(
    'SELECT TABLE_NAME AS name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN (?,?,?,?)',
    ['product_services', 'product_stock_reservations', 'product_orders', 'product_order_items'],
  );
  const [columns] = await pool.execute(
    'SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?',
    ['services', 'customer_config'],
  );
  if (existing.length !== 4 || columns.length !== 1) throw new Error('Approved migration 002 must be installed before product fixture writes.');
}

export async function createProductFixtures(pool, { env = process.env } = {}) {
  await assertProductFixtureTarget(pool, env);
  const baseline = await countFixtureTables(pool);
  const parent = await createCustomerFixtures(pool, { env });
  const registryPath = path.join(artifactDirectory, 'PRODUCT_' + parent.marker + '.json');
  const registry = { version: 1, marker: parent.marker, database: 'dich_vu_ve_sinh', parentRegistry: path.basename(parent.registryPath), ids: { products: [], product_categories: [], product_orders: [] }, baseline };
  await mkdir(artifactDirectory, { recursive: true });
  const save = () => writeFile(registryPath, JSON.stringify(registry, null, 2), { mode: 0o600 });
  await save();
  const recordProduct = async (table, id) => {
    if (!Object.hasOwn(registry.ids, table) || !/^[1-9]\d*$/.test(String(id))) throw new Error('Unexpected product fixture record.');
    if (!registry.ids[table].includes(String(id))) registry.ids[table].push(String(id));
    await save();
    return String(id);
  };
  const context = {
    ...parent, baseline, productRegistryPath: registryPath,
    async setProductPrice(productId, price) {
      if (!registry.ids.products.includes(String(productId)) || !Number.isFinite(price) || price < 0) throw new Error('Only recorded fixture prices may be changed.');
      const [result] = await pool.execute('UPDATE products SET price=? WHERE id=? AND LEFT(name,CHAR_LENGTH(?))=?', [price, productId, parent.marker + ' ', parent.marker + ' ']);
      if (result.affectedRows !== 1) throw new Error('Fixture product marker mismatch.');
    },
    async setServicePrice(serviceId, price) {
      if (![context.serviceId, context.roomServiceId, context.houseServiceId].includes(String(serviceId)) || !Number.isFinite(price) || price < 0) throw new Error('Only recorded fixture service prices may be changed.');
      const [result] = await pool.execute('UPDATE services SET base_price=? WHERE id=? AND LEFT(name,CHAR_LENGTH(?))=?', [price, serviceId, parent.marker + ' ', parent.marker + ' ']);
      if (result.affectedRows !== 1) throw new Error('Fixture service marker mismatch.');
    },
    async recordProductOrder(id) { return recordProduct('product_orders', id); },
    async setAvailableStock(productId, available) {
      if (!registry.ids.products.includes(String(productId)) || !Number.isInteger(available) || available < 0) throw new Error('Only recorded fixture inventory may be changed.');
      const [result] = await pool.execute('UPDATE product_inventory SET quantity=reserved_quantity+? WHERE product_id=?', [available, String(productId)]);
      if (result.affectedRows !== 1) throw new Error('Fixture inventory was not found.');
    },
    async cleanup() {
      await cleanupProductFixtures(pool, registryPath, { env });
      const after = await countFixtureTables(pool);
      if (JSON.stringify(after) !== JSON.stringify(baseline)) throw new Error('Counts differ after fixture cleanup; concurrent/pre-existing data was preserved for review.');
    },
  };
  const config = (group, cleaningType, pricingMode = 'reference') => ({
    version: 1, group, ...(cleaningType ? { cleaningType } : {}), pricingMode,
    scope: ['Phạm vi fixture đã xác nhận'], included: ['Làm sạch bề mặt'], excluded: ['Hạng mục ngoài phạm vi'],
    image: '/placeholder.svg', minQuantity: 1, defaultQuantity: 1, quantityLabel: 'Số lượng', baseMinutes: 0,
  });
  try {
    await pool.execute('UPDATE services SET customer_config=? WHERE id=? AND name=?', [JSON.stringify(config('ve-sinh', 'phong-tro', 'survey')), parent.serviceId, parent.marker + ' Service']);
    context.roomServiceId = parent.serviceId;
    const addService = async (label, group, cleaningType, metadata = true, categoryId = parent.categoryId) => {
      const [result] = await pool.execute('INSERT INTO services (category_id,name,description,unit,base_price,duration_minutes,is_active,customer_config) VALUES (?,?,?,?,125000,60,TRUE,?)',
        [categoryId, parent.marker + ' ' + label, parent.marker + ' synthetic service description', 'lần', metadata ? JSON.stringify(config(group, cleaningType)) : null]);
      return parent.record('services', result.insertId);
    };
    context.houseServiceId = await addService('Vệ sinh nhà ở gia đình', 've-sinh', 'nha-gia-dinh');
    context.careServiceId = await addService('Chăm sóc không gian sống', 'cham-soc');
    context.maintenanceServiceId = await addService('Bảo dưỡng thiết bị', 'bao-duong');
    context.legacyMaintenanceServiceId = await addService('Bảo dưỡng cửa nhà', 'bao-duong', undefined, false);
    const [roomCategory] = await pool.execute('INSERT INTO service_categories (name,description,is_active) VALUES (?,?,TRUE)', [parent.marker + ' Vệ sinh phòng trọ', parent.marker + ' legacy category']);
    const roomCategoryId = await parent.record('service_categories', roomCategory.insertId);
    context.legacyRoomServiceId = await addService('Dọn dẹp chung', 've-sinh', 'phong-tro', false, roomCategoryId);
    const [category] = await pool.execute('INSERT INTO product_categories (name,description,is_active) VALUES (?,?,TRUE)', [parent.marker + ' Products', parent.marker + ' synthetic product category']);
    context.productCategoryId = await recordProduct('product_categories', category.insertId);
    const addProduct = async (label, quantity, status = 'AVAILABLE', price = 42000) => {
      const [product] = await pool.execute('INSERT INTO products (category_id,name,description,unit,price,status) VALUES (?,?,?,?,?,?)',
        [context.productCategoryId, parent.marker + ' ' + label, parent.marker + ' optional home product', 'chai', price.toFixed(2), status]);
      const id = await recordProduct('products', product.insertId);
      await pool.execute('INSERT INTO product_inventory (product_id,quantity,reserved_quantity,min_stock) VALUES (?,?,0,0)', [id, quantity]);
      await pool.execute('INSERT INTO product_images (product_id,image_url,is_primary,sort_order) VALUES (?, ?,TRUE,0)', [id, '/placeholder.svg']);
      return id;
    };
    context.productId = await addProduct('Nước lau nhà', 8);
    context.lastStockProductId = await addProduct('Mặt hàng cuối cùng', 1, 'AVAILABLE', 7000);
    context.outOfStockProductId = await addProduct('Mặt hàng hết hàng', 0, 'OUT_OF_STOCK');
    context.inactiveProductId = await addProduct('Mặt hàng ngừng bán', 3, 'INACTIVE');
    await pool.execute('INSERT INTO product_services (product_id,service_id) VALUES (?,?)', [context.productId, context.roomServiceId]);
    return context;
  } catch (error) {
    await context.cleanup().catch(() => {});
    throw error;
  }
}

export async function cleanupProductFixtures(pool, registryPath, { env = process.env } = {}) {
  await assertProductFixtureTarget(pool, env);
  const resolved = path.resolve(registryPath);
  if (path.dirname(resolved) !== path.resolve(artifactDirectory)) throw new Error('Product registry must stay in .test-artifacts.');
  const registry = JSON.parse(await readFile(resolved, 'utf8'));
  if (registry.version !== 1 || registry.database !== 'dich_vu_ve_sinh' || !/^CUSTOMER_E2E_\d+_[a-f0-9]{8}$/.test(registry.marker) ||
      registry.parentRegistry !== registry.marker + '.json') throw new Error('Invalid product fixture registry.');
  const parentPath = path.resolve(artifactDirectory, registry.parentRegistry);
  if (path.dirname(parentPath) !== path.resolve(artifactDirectory)) throw new Error('Parent registry escaped the artifact directory.');
  const parent = JSON.parse(await readFile(parentPath, 'utf8'));
  if (parent.marker !== registry.marker) throw new Error('Product fixture parent marker mismatch.');
  const ids = registry.ids;
  if (!ids || Object.entries(ids).some(([table, values]) => ![...productParents, 'product_orders'].includes(table) || !Array.isArray(values) || values.some((id) => !/^[1-9]\d*$/.test(id)))) throw new Error('Invalid product fixture IDs.');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const prefix = registry.marker + ' ';
    const [users] = await connection.execute('SELECT id FROM users WHERE LEFT(full_name,CHAR_LENGTH(?))=? FOR UPDATE', [prefix, prefix]);
    const ownedUsers = users.map((row) => String(row.id));
    const owned = {};
    for (const table of productParents) {
      const [discovered] = await connection.execute('SELECT id,name FROM ' + table + ' WHERE LEFT(name,CHAR_LENGTH(?))=? FOR UPDATE', [prefix, prefix]);
      const expected = [...new Set([...(ids[table] || []), ...discovered.map((row) => String(row.id))])];
      if (!expected.length) { owned[table] = []; continue; }
      const [rows] = await connection.execute('SELECT id,name FROM ' + table + ' WHERE id IN (' + placeholders(expected) + ') FOR UPDATE', expected);
      if (rows.some((row) => !row.name.startsWith(prefix))) throw new Error('Refusing cleanup of a non-fixture product/category.');
      owned[table] = rows.map((row) => String(row.id));
    }
    let orderIds = [...ids.product_orders];
    if (ownedUsers.length) {
      const [orders] = await connection.execute('SELECT id FROM product_orders WHERE customer_id IN (' + placeholders(ownedUsers) + ') FOR UPDATE', ownedUsers);
      orderIds = [...new Set([...orderIds, ...orders.map((row) => String(row.id))])];
    }
    if (orderIds.length) {
      if (!ownedUsers.length) throw new Error('Product orders have no fixture owner.');
      const [orders] = await connection.execute('SELECT id,customer_id FROM product_orders WHERE id IN (' + placeholders(orderIds) + ') FOR UPDATE', orderIds);
      if (orders.some((row) => !ownedUsers.includes(String(row.customer_id)))) throw new Error('Product order fixture ownership mismatch.');
      await connection.execute('DELETE FROM product_order_items WHERE product_order_id IN (' + placeholders(orderIds) + ')', orderIds);
      await connection.execute('DELETE FROM product_orders WHERE id IN (' + placeholders(orderIds) + ')', orderIds);
    }
    if (ownedUsers.length) {
      const [reservations] = await connection.execute('SELECT items_snapshot FROM product_stock_reservations WHERE customer_id IN (' + placeholders(ownedUsers) + ') FOR UPDATE', ownedUsers);
      for (const row of reservations) {
        const items = typeof row.items_snapshot === 'string' ? JSON.parse(row.items_snapshot) : row.items_snapshot;
        if (!Array.isArray(items) || items.some((item) => !owned.products.includes(String(item.productId)))) throw new Error('Fixture reservation refers to non-fixture inventory; preserve it for owner reconciliation.');
      }
      await connection.execute('DELETE FROM product_stock_reservations WHERE customer_id IN (' + placeholders(ownedUsers) + ')', ownedUsers);
    }
    if (owned.products.length) {
      for (const table of ['product_services', 'product_images', 'product_inventory']) {
        await connection.execute('DELETE FROM ' + table + ' WHERE product_id IN (' + placeholders(owned.products) + ')', owned.products);
      }
      await connection.execute('DELETE FROM products WHERE id IN (' + placeholders(owned.products) + ')', owned.products);
    }
    if (owned.product_categories.length) await connection.execute('DELETE FROM product_categories WHERE id IN (' + placeholders(owned.product_categories) + ')', owned.product_categories);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
  await cleanupCustomerFixtures(pool, parentPath, { env });
  await unlink(resolved);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== 'cleanup' || !process.argv[3]) { process.stderr.write('Usage: node --env-file-if-exists=.env scripts/product-fixtures.js cleanup <registry-path>\n'); process.exitCode = 1; }
  else {
    const { createMysqlPool } = await import('../shared/mysql-pool.js');
    const pool = createMysqlPool();
    try { await cleanupProductFixtures(pool, process.argv[3]); process.stdout.write('Product fixture cleanup PASS.\n'); }
    catch { process.stderr.write('Product fixture cleanup FAIL; registry preserved for owner review.\n'); process.exitCode = 1; }
    finally { await pool.end(); }
  }
}
