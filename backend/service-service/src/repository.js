import { createHash } from 'node:crypto';
import { HttpError } from '../../shared/http.js';
import { groupNames, groups, legacyGroup, legacyCleaningType, legacyGroupSql, legacyCleaningTypeSql } from './service-taxonomy.js';

function badCatalog() {
  return new HttpError(503, 'INVALID_CATALOG_DATA', 'Dữ liệu danh mục chưa hợp lệ.');
}

async function acquireStockLock(connection, operationKey, state) {
  state.uncertain = true;
  const [rows] = await connection.execute("SELECT GET_LOCK(SHA2(CONCAT(DATABASE(), ':catalog-stock:', ?), 256), 3) AS acquired", [operationKey]);
  const acquired = rows[0]?.acquired;
  if (acquired !== 0 && acquired !== '0' && acquired !== 1 && acquired !== '1') throw new HttpError(503, 'RESERVATION_BUSY', 'Chưa thể xác nhận khóa giữ tồn kho.');
  state.uncertain = false;
  state.locked = Number(acquired) === 1;
  if (!state.locked) throw new HttpError(503, 'RESERVATION_BUSY', 'Yêu cầu giữ hàng đang được xử lý. Vui lòng thử lại sau.');
}
async function releaseStockConnection(connection, operationKey, state) {
  if (state.locked) {
    try {
      const [rows] = await connection.execute("SELECT RELEASE_LOCK(SHA2(CONCAT(DATABASE(), ':catalog-stock:', ?), 256)) AS released", [operationKey]);
      if (Number(rows[0]?.released) !== 1) state.uncertain = true;
    } catch { state.uncertain = true; }
  }
  if (state.uncertain) connection.destroy();
  else connection.release();
}

function parseConfig(raw) {
  if (raw === null || raw === undefined) return null;
  let value = raw;
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw); } catch { throw badCatalog(); }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1
    || !groups.has(value.group)) throw badCatalog();
  for (const field of ['cleaningType', 'pricingMode', 'minQuantity', 'defaultQuantity', 'baseMinutes', 'quantityLabel']) {
    if (Object.hasOwn(value, field) && value[field] === null) throw badCatalog();
  }
  return value;
}

function stringList(value, key) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100 || value.some((entry) => typeof entry !== 'string' || entry.length > 4000)) throw badCatalog();
  return value;
}

function serviceDto(row) {
  const price = Number(row.base_price);
  const minutes = Number(row.duration_minutes);
  const config = parseConfig(row.customer_config);
  const group = config?.group ?? legacyGroup(row.category_name, row.name);
  if (!groups.has(group) || !Number.isFinite(price) || price < 0 || price > 9999999999.99
    || Math.abs(price * 100 - Math.round(price * 100)) > 0.001
    || !Number.isInteger(minutes) || minutes < 1 || minutes > 2147483647
    || typeof row.name !== 'string' || !row.name || typeof row.description !== 'string'
    || typeof row.unit !== 'string' || !row.unit || ![0, 1].includes(Number(row.is_active))) throw badCatalog();
  const minQuantity = config?.minQuantity ?? 1;
  const defaultQuantity = config?.defaultQuantity ?? minQuantity;
  const pricingMode = config?.pricingMode ?? 'reference';
  const baseMinutes = config?.baseMinutes ?? 0;
  const quantityLabel = config?.quantityLabel ?? row.unit;
  const cleaningType = config?.cleaningType ?? legacyCleaningType(row.category_name, row.name, group);
  const validQuantity = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0.01 && value <= 100000
    && Math.abs(value * 100 - Math.round(value * 100)) <= 0.000001;
  if (!validQuantity(minQuantity) || !validQuantity(defaultQuantity) || defaultQuantity < minQuantity
    || !Number.isInteger(baseMinutes) || baseMinutes < 0 || baseMinutes > 2147483647
    || !['fixed', 'reference', 'survey'].includes(pricingMode)
    || typeof quantityLabel !== 'string' || quantityLabel.length > 60
    || (cleaningType !== undefined && (group !== 've-sinh' || !['phong-tro', 'nha-gia-dinh', 'khac'].includes(cleaningType)))) throw badCatalog();
  if (config?.image !== undefined && (typeof config.image !== 'string' || !config.image)) throw badCatalog();
  return {
    id: String(row.id), slug: String(row.id), name: row.name,
    category: String(row.category_id), categoryName: row.category_name,
    group, groupName: groupNames[group], ...(cleaningType ? { cleaningType } : {}),
    pricingMode, pricingModeKnown: config?.pricingMode !== undefined,
    minimumQuantityKnown: config?.minQuantity !== undefined,
    shortDesc: row.description.slice(0, 180), description: row.description,
    scope: stringList(config?.scope, 'scope'), included: stringList(config?.included, 'included'),
    excluded: stringList(config?.excluded, 'excluded'), unit: row.unit,
    quantityLabel, price, minQuantity, defaultQuantity, minutesPerUnit: minutes, baseMinutes,
    image: config?.image ?? '/placeholder.svg',
    status: Number(row.is_active) === 1 ? 'active' : 'inactive',
  };
}

function productDto(row, images = [], relatedServiceIds = []) {
  const id = String(row.id);
  const price = Number(row.price);
  const stock = Math.max(Number(row.quantity ?? 0) - Number(row.reserved_quantity ?? 0), 0);
  if (!Number.isSafeInteger(Number(row.quantity ?? 0)) || Number(row.quantity ?? 0) < 0
    || !Number.isSafeInteger(Number(row.reserved_quantity ?? 0)) || Number(row.reserved_quantity ?? 0) < 0
    || Number(row.reserved_quantity ?? 0) > Number(row.quantity ?? 0)
    || !Number.isFinite(price) || price < 0 || price > 9999999999.99
    || Math.abs(price * 100 - Math.round(price * 100)) > 0.001
    || typeof row.name !== 'string' || !row.name || typeof row.unit !== 'string' || !row.unit
    || (row.description !== null && row.description !== undefined && typeof row.description !== 'string')
    || !['AVAILABLE', 'OUT_OF_STOCK', 'INACTIVE'].includes(row.product_status)) throw badCatalog();
  const categoryActive = row.category_active === 1 || row.category_active === true;
  const status = row.product_status === 'INACTIVE' || !categoryActive
    ? 'inactive' : row.product_status === 'OUT_OF_STOCK' || stock === 0 ? 'out_of_stock' : 'available';
  const orderedImages = images.map((image) => image.image_url).filter((image) => typeof image === 'string' && image);
  return {
    id, code: `SP${id}`, slug: id, name: row.name, description: row.description ?? '',
    images: orderedImages, image: orderedImages[0] ?? '/placeholder.svg',
    categoryId: String(row.category_id), categoryName: row.category_name ?? '',
    relatedServiceIds: relatedServiceIds.map(String), price, unit: row.unit, stock, status,
  };
}

function normalizedItems(items) {
  const sorted = [...items].sort((a, b) => BigInt(a.productId) < BigInt(b.productId) ? -1 : 1);
  return sorted;
}

function requestHash(customerId, items) {
  return createHash('sha256').update(JSON.stringify({ customerId: String(customerId), items: normalizedItems(items) })).digest('hex');
}

function reservationDto(row) {
  let items;
  try { items = typeof row.items_snapshot === 'string' ? JSON.parse(row.items_snapshot) : row.items_snapshot; }
  catch { throw badCatalog(); }
  const total = Number(row.total_amount);
  if (!Array.isArray(items) || !items.length || items.length > 50 || !['RESERVED', 'RELEASED'].includes(row.status)
    || !Number.isFinite(total) || total < 0 || total > 9999999999.99) throw badCatalog();
  let cents = 0;
  const ids = new Set();
  for (const item of items) {
    if (!item || !/^[1-9]\d{0,18}$/.test(String(item.productId)) || ids.has(String(item.productId))
      || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 999
      || !Number.isFinite(item.unitPrice) || item.unitPrice < 0
      || Math.abs(item.unitPrice * 100 - Math.round(item.unitPrice * 100)) > 0.001
      || typeof item.code !== 'string' || typeof item.name !== 'string' || typeof item.unit !== 'string') throw badCatalog();
    ids.add(String(item.productId));
    cents += Math.round(item.unitPrice * 100) * item.quantity;
  }
  if (!Number.isSafeInteger(cents) || cents !== Math.round(total * 100)) throw badCatalog();
  return {
    operationKey: row.operation_key, customerId: String(row.customer_id), items,
    total, status: row.status === 'RELEASED' ? 'released' : 'reserved',
  };
}

const serviceSelect = `SELECT s.id, s.category_id, s.name, s.description, s.unit, s.base_price,
  s.duration_minutes, s.is_active, c.name AS category_name`;
const serviceFrom = ` FROM services s JOIN service_categories c ON c.id = s.category_id`;
const productSelect = `SELECT p.id, p.category_id, p.name, p.description, p.unit, p.price, p.status AS product_status,
  pc.name AS category_name, pc.is_active AS category_active,
  COALESCE(inv.quantity, 0) AS quantity, COALESCE(inv.reserved_quantity, 0) AS reserved_quantity
  FROM products p LEFT JOIN product_categories pc ON pc.id = p.category_id
  LEFT JOIN product_inventory inv ON inv.product_id = p.id`;

export function createRepository(pool) {
  let hasCustomerConfig;
  let productSchemaReady;
  const requireProductSchema = async () => {
    if (!productSchemaReady) {
      productSchemaReady = pool.execute(
        `SELECT COUNT(DISTINCT table_name) AS present FROM information_schema.tables
         WHERE table_schema = DATABASE()
           AND table_name IN ('product_services', 'product_stock_reservations')`,
      ).then(([rows]) => Number(rows[0]?.present) === 2);
    }
    let ready;
    try { ready = await productSchemaReady; }
    catch (error) { productSchemaReady = undefined; throw error; }
    if (!ready) {
      productSchemaReady = undefined;
      throw new HttpError(503, 'PRODUCT_SCHEMA_NOT_READY', 'Tính năng sản phẩm chưa sẵn sàng. Cần áp dụng migration 002 theo quy trình được duyệt.');
    }
  };
  const supportsCustomerConfig = async () => {
    if (!hasCustomerConfig) {
      hasCustomerConfig = pool.execute(
        `SELECT COUNT(*) AS present FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = 'services' AND column_name = 'customer_config'`,
      ).then(([rows]) => Number(rows[0]?.present) > 0);
    }
    try {
      const supported = await hasCustomerConfig;
      if (!supported) hasCustomerConfig = undefined;
      return supported;
    } catch (error) { hasCustomerConfig = undefined; throw error; }
  };
  const getServiceSelect = (hasConfig) => `${serviceSelect}, ${hasConfig ? 's.customer_config' : 'NULL AS customer_config'}`;
  const hydrateProducts = async (client, rows) => {
    if (!rows.length) return [];
    const ids = rows.map((row) => String(row.id));
    const placeholders = ids.map(() => '?').join(',');
    const [[imageRows], [serviceRows]] = await Promise.all([
      client.execute(`SELECT product_id, image_url, is_primary FROM product_images WHERE product_id IN (${placeholders}) ORDER BY is_primary DESC, sort_order, id`, ids),
      client.execute(`SELECT product_id, service_id FROM product_services WHERE product_id IN (${placeholders}) ORDER BY product_id, service_id`, ids),
    ]);
    return rows.map((row) => productDto(
      row,
      imageRows.filter((image) => String(image.product_id) === String(row.id)),
      serviceRows.filter((service) => String(service.product_id) === String(row.id)).map((service) => service.service_id),
    ));
  };

  return {
    async categories() {
      const [rows] = await pool.execute(
        'SELECT id, name, description FROM service_categories WHERE is_active = TRUE ORDER BY id',
      );
      return rows.map((row) => ({ id: String(row.id), name: row.name, description: row.description }));
    },
    async list({ q = '', category, group, cleaningType, page, limit }) {
      const hasConfig = await supportsCustomerConfig();
      const groupExpression = hasConfig
        ? `COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(s.customer_config, '$.group')), 'null'), ${legacyGroupSql})`
        : legacyGroupSql;
      const cleaningExpression = hasConfig
        ? `COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(s.customer_config, '$.cleaningType')), 'null'), ${legacyCleaningTypeSql})`
        : legacyCleaningTypeSql;
      const conditions = ['s.is_active = TRUE', 'c.is_active = TRUE'];
      const values = [];
      if (q) {
        conditions.push('(s.name LIKE ? ESCAPE \'!\' OR s.description LIKE ? ESCAPE \'!\')');
        const escaped = `%${q.replace(/[!%_]/g, (character) => `!${character}`)}%`;
        values.push(escaped, escaped);
      }
      if (category) { conditions.push('s.category_id = ?'); values.push(category); }
      if (group) { conditions.push(`${groupExpression} = ?`); values.push(group); }
      if (cleaningType) { conditions.push(`${groupExpression} = 've-sinh' AND ${cleaningExpression} = ?`); values.push(cleaningType); }
      const where = ` WHERE ${conditions.join(' AND ')}`;
      const [count] = await pool.execute(
        `SELECT COUNT(*) AS total${serviceFrom}${where}`, values,
      );
      const [rows] = await pool.query(
        `${getServiceSelect(hasConfig)}${serviceFrom}${where} ORDER BY s.id LIMIT ? OFFSET ?`,
        [...values, limit, (page - 1) * limit],
      );
      return { items: rows.map(serviceDto), total: Number(count[0].total), page, limit };
    },
    async get(serviceId) {
      const [rows] = await pool.execute(
        `${getServiceSelect(await supportsCustomerConfig())}${serviceFrom} WHERE s.id = ? AND s.is_active = TRUE AND c.is_active = TRUE`,
        [serviceId],
      );
      return rows[0] ? serviceDto(rows[0]) : null;
    },
    async productCategories() {
      await requireProductSchema();
      const [rows] = await pool.execute(
        'SELECT id, name FROM product_categories WHERE is_active = TRUE ORDER BY name, id',
      );
      return rows.map((row) => ({ id: String(row.id), name: row.name }));
    },
    async listProducts({ q = '', category, serviceId, page, limit }) {
      await requireProductSchema();
      const conditions = ['p.status <> \'INACTIVE\'', 'pc.is_active = TRUE'];
      const values = [];
      if (q) {
        conditions.push('(p.name LIKE ? ESCAPE \'!\' OR p.description LIKE ? ESCAPE \'!\')');
        const escaped = `%${q.replace(/[!%_]/g, (character) => `!${character}`)}%`;
        values.push(escaped, escaped);
      }
      if (category) { conditions.push('p.category_id = ?'); values.push(category); }
      if (serviceId) {
        conditions.push('EXISTS (SELECT 1 FROM product_services ps WHERE ps.product_id = p.id AND ps.service_id = ?)');
        values.push(serviceId);
      }
      const where = ` WHERE ${conditions.join(' AND ')}`;
      const [count] = await pool.execute(`SELECT COUNT(*) AS total FROM products p JOIN product_categories pc ON pc.id = p.category_id${where}`, values);
      const [rows] = await pool.query(
        `${productSelect}${where} ORDER BY p.id LIMIT ? OFFSET ?`,
        [...values, limit, (page - 1) * limit],
      );
      return { items: await hydrateProducts(pool, rows), total: Number(count[0].total), page, limit };
    },
    async getProduct(productId) {
      await requireProductSchema();
      const [rows] = await pool.execute(`${productSelect} WHERE p.id = ?`, [productId]);
      return rows[0] ? (await hydrateProducts(pool, rows))[0] : null;
    },
    async reserveProducts({ operationKey, customerId, items }) {
      await requireProductSchema();
      const hash = requestHash(customerId, items);
      const connection = await pool.getConnection();
      const lock = { locked: false, uncertain: false };
      let transaction = false;
      try {
        await acquireStockLock(connection, operationKey, lock);
        await connection.beginTransaction();
        transaction = true;
        const [existing] = await connection.execute(
          'SELECT operation_key, customer_id, request_hash, items_snapshot, total_amount, status FROM product_stock_reservations WHERE operation_key = ?',
          [operationKey],
        );
        if (existing[0]) {
          if (existing[0].request_hash !== hash) throw new HttpError(409, 'RESERVATION_KEY_REUSED', 'Khóa giữ hàng đã được dùng cho yêu cầu khác.');
          await connection.commit();
          transaction = false;
          return reservationDto(existing[0]);
        }
        const sortedItems = normalizedItems(items);
        const products = [];
        for (const item of sortedItems) {
          const [rows] = await connection.execute(`${productSelect} WHERE p.id = ? FOR UPDATE`, [item.productId]);
          if (rows[0]) products.push(rows[0]);
        }
        const [concurrentReservation] = await connection.execute(
          'SELECT operation_key, customer_id, request_hash, items_snapshot, total_amount, status FROM product_stock_reservations WHERE operation_key = ?',
          [operationKey],
        );
        if (concurrentReservation[0]) {
          if (concurrentReservation[0].request_hash !== hash) throw new HttpError(409, 'RESERVATION_KEY_REUSED', 'Khóa giữ hàng đã được dùng cho yêu cầu khác.');
          await connection.commit();
          transaction = false;
          return reservationDto(concurrentReservation[0]);
        }
        if (products.length !== sortedItems.length) throw new HttpError(409, 'PRODUCT_UNAVAILABLE', 'Một hoặc nhiều sản phẩm không còn bán.');
        const productById = new Map(products.map((row) => [String(row.id), row]));
        const snapshots = [];
        let totalCents = 0;
        for (const item of sortedItems) {
          const row = productById.get(item.productId);
          const product = productDto(row);
          const available = product.stock;
          if (row.product_status !== 'AVAILABLE' || row.category_active !== 1 && row.category_active !== true) {
            throw new HttpError(409, 'PRODUCT_UNAVAILABLE', 'Một hoặc nhiều sản phẩm hiện không được bán.');
          }
          if (item.quantity > available) throw new HttpError(409, 'OUT_OF_STOCK', `Sản phẩm ${row.name} không đủ tồn kho.`);
          const cents = Math.round(product.price * 100);
          if (!Number.isSafeInteger(cents) || cents < 0) throw badCatalog();
          if (item.expectedUnitPrice === undefined) throw new HttpError(400, 'PRICE_CONFIRMATION_REQUIRED', 'Cần xác nhận đơn giá trước khi giữ hàng.');
          if (Math.round(item.expectedUnitPrice * 100) !== cents) {
            throw new HttpError(409, 'PRICE_CHANGED', 'Đơn giá sản phẩm đã thay đổi. Vui lòng xem giá mới và xác nhận lại.');
          }
          totalCents += cents * item.quantity;
          snapshots.push({
            productId: String(row.id), code: `SP${row.id}`, name: row.name, unit: row.unit,
            quantity: item.quantity, unitPrice: product.price,
          });
        }
        if (!Number.isSafeInteger(totalCents) || totalCents > 999999999999) {
          throw new HttpError(422, 'ORDER_LIMIT_EXCEEDED', 'Tổng tiền vượt giới hạn đơn hàng.');
        }
        for (const item of sortedItems) {
          const [updated] = await connection.execute(
            'UPDATE product_inventory SET reserved_quantity = reserved_quantity + ? WHERE product_id = ? AND quantity - reserved_quantity >= ?',
            [item.quantity, item.productId, item.quantity],
          );
          if (updated.affectedRows !== 1) throw new HttpError(409, 'OUT_OF_STOCK', 'Tồn kho vừa thay đổi. Vui lòng kiểm tra lại giỏ hàng.');
        }
        await connection.execute(
          `INSERT INTO product_stock_reservations (operation_key, customer_id, request_hash, items_snapshot, total_amount, status)
           VALUES (?, ?, ?, ?, ?, 'RESERVED')`,
          [operationKey, customerId, hash, JSON.stringify(snapshots), (totalCents / 100).toFixed(2)],
        );
        await connection.commit();
        transaction = false;
        return { operationKey, customerId: String(customerId), items: snapshots, total: totalCents / 100, status: 'reserved' };
      } catch (error) {
        if (transaction) await connection.rollback().catch(() => {});
        throw error;
      } finally {
        await releaseStockConnection(connection, operationKey, lock);
      }
    },
    async getReservation(operationKey) {
      await requireProductSchema();
      const [rows] = await pool.execute(
        'SELECT operation_key, customer_id, items_snapshot, total_amount, status FROM product_stock_reservations WHERE operation_key = ?',
        [operationKey],
      );
      return rows[0] ? reservationDto(rows[0]) : null;
    },
    async releaseReservation(operationKey) {
      await requireProductSchema();
      const connection = await pool.getConnection();
      const lock = { locked: false, uncertain: false };
      let transaction = false;
      try {
        await acquireStockLock(connection, operationKey, lock);
        await connection.beginTransaction();
        transaction = true;
        const [rows] = await connection.execute(
          'SELECT operation_key, items_snapshot, status FROM product_stock_reservations WHERE operation_key = ? FOR UPDATE',
          [operationKey],
        );
        if (!rows[0]) throw new HttpError(404, 'RESERVATION_NOT_FOUND', 'Không tìm thấy giao dịch giữ tồn kho.');
        if (rows[0].status === 'RELEASED') {
          await connection.commit();
          transaction = false;
          return { operationKey, status: 'released' };
        }
        let items;
        try { items = typeof rows[0].items_snapshot === 'string' ? JSON.parse(rows[0].items_snapshot) : rows[0].items_snapshot; }
        catch { throw badCatalog(); }
        if (!Array.isArray(items) || items.some((item) => !item || !/^[1-9]\d*$/.test(String(item.productId))
          || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 999)) throw badCatalog();
        for (const item of normalizedItems(items)) {
          const [updated] = await connection.execute(
            'UPDATE product_inventory SET reserved_quantity = reserved_quantity - ? WHERE product_id = ? AND reserved_quantity >= ?',
            [item.quantity, item.productId, item.quantity],
          );
          if (updated.affectedRows !== 1) throw badCatalog();
        }
        await connection.execute(
          "UPDATE product_stock_reservations SET status = 'RELEASED' WHERE operation_key = ?",
          [operationKey],
        );
        await connection.commit();
        transaction = false;
        return { operationKey, status: 'released' };
      } catch (error) {
        if (transaction) await connection.rollback().catch(() => {});
        throw error;
      } finally {
        await releaseStockConnection(connection, operationKey, lock);
      }
    },
  };
}
