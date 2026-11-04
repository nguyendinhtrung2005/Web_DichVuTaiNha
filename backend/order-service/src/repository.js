import { createHash } from 'node:crypto';
import { HttpError } from '../../shared/http.js';
import { checkCustomerBookingIdempotencySchema } from '../../shared/database-checks.js';

const statuses = {
  PENDING: 'pending', CONFIRMED: 'confirmed', IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed', CANCELLED: 'cancelled',
};
const statusLabels = {
  PENDING: 'Đơn chờ xác nhận', CONFIRMED: 'Đơn đã xác nhận', IN_PROGRESS: 'Đang thực hiện',
  COMPLETED: 'Hoàn thành dịch vụ', CANCELLED: 'Đơn đã hủy',
};
const selectBooking = `SELECT id, customer_id, branch_id, address_snapshot,
  scheduled_start, scheduled_end, status, total_amount FROM bookings`;

function badData() {
  return new HttpError(503, 'INVALID_ORDER_DATA', 'Dữ liệu đơn dịch vụ chưa hợp lệ.');
}

function iso(value) {
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw badData();
  return date.toISOString();
}

function jsonObject(raw) {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw badData();
    return value;
  } catch {
    throw badData();
  }
}

function noteEvent(raw) {
  if (typeof raw !== 'string') return null;
  try {
    const event = JSON.parse(raw);
    return event && event.version === 1 && typeof event.type === 'string' ? event : null;
  } catch {
    return null;
  }
}

function orderDto(row, itemRows, historyRows) {
  const status = statuses[row.status];
  if (!status) throw new HttpError(503, 'UNSUPPORTED_ORDER_STATUS', 'Trạng thái đơn chưa được hỗ trợ.');
  if (!itemRows.length) throw badData();
  const snapshot = jsonObject(row.address_snapshot);
  if (snapshot.version === 1 && (!snapshot.contact || typeof snapshot.contact !== 'object' || Array.isArray(snapshot.contact))) throw badData();
  const source = snapshot.version === 1 && snapshot.contact ? snapshot.contact : snapshot;
  const contact = {
    name: source.name ?? source.recipient ?? '', phone: source.phone ?? '',
    address: source.address ?? source.address_text ?? '', houseType: source.houseType ?? null,
    hasPets: typeof source.hasPets === 'boolean' ? source.hasPets : null,
    ...(source.area !== undefined ? { area: Number(source.area) } : {}),
    ...(source.rooms !== undefined ? { rooms: Number(source.rooms) } : {}),
    ...(source.floors !== undefined ? { floors: Number(source.floors) } : {}),
  };
  let cancelRequest;
  const history = historyRows.map((entry) => {
    if (!statuses[entry.status]) throw new HttpError(503, 'UNSUPPORTED_ORDER_STATUS', 'Trạng thái lịch sử đơn chưa được hỗ trợ.');
    const at = iso(entry.created_at);
    const event = noteEvent(entry.note);
    let label = statusLabels[entry.status];
    let note = entry.note;
    if (event?.type === 'CUSTOMER_ORDER_CREATED') {
      label = 'Khách hàng đặt dịch vụ';
      note = undefined;
    } else if (event?.type === 'CUSTOMER_CANCEL_REQUESTED') {
      if (typeof event.reason !== 'string') throw badData();
      label = 'Khách hàng gửi yêu cầu hủy';
      note = event.reason;
      cancelRequest = { reason: event.reason, requestedAt: at, status: 'pending' };
    } else if (event?.type === 'CUSTOMER_CANCEL_RESOLVED' && cancelRequest
      && ['approved', 'rejected'].includes(event.status)) {
      label = event.status === 'approved' ? 'Yêu cầu hủy được duyệt' : 'Yêu cầu hủy bị từ chối';
      note = event.adminNote;
      cancelRequest = { ...cancelRequest, status: event.status, adminNote: event.adminNote, resolvedAt: at };
    }
    return {
      at, label, by: String(entry.changed_by) === String(row.customer_id) ? 'Khách hàng' : `Tài khoản ${entry.changed_by}`,
      ...(note ? { note } : {}),
    };
  });
  const items = itemRows.map((item) => ({
    id: String(item.id), serviceId: String(item.service_id), serviceName: item.service_name_snapshot,
    quantity: Number(item.quantity), unit: item.unit_snapshot, unitPrice: Number(item.unit_price),
  }));
  const scheduledAt = iso(row.scheduled_start);
  const end = iso(row.scheduled_end);
  if (!scheduledAt || !end) throw badData();
  const durationMinutes = Math.round((new Date(end).getTime() - new Date(scheduledAt).getTime()) / 60000);
  const price = Number(row.total_amount);
  if (!Number.isSafeInteger(durationMinutes) || durationMinutes < 1 || !Number.isFinite(price) || price < 0
    || items.some((item) => !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.unitPrice) || item.unitPrice < 0)) throw badData();
  return {
    id: String(row.id), code: `DH${String(row.id).padStart(6, '0')}`, customerId: String(row.customer_id),
    serviceId: items[0].serviceId, serviceName: items[0].serviceName, unit: items[0].unit,
    quantity: items[0].quantity, items, contact, scheduledAt, durationMinutes,
    specialRequest: typeof snapshot.specialRequest === 'string' ? snapshot.specialRequest : '',
    price, status, history, staffNotes: [], createdAt: history[0]?.at ?? null,
    ...(['fixed', 'reference', 'survey'].includes(snapshot.pricingMode) ? { pricingMode: snapshot.pricingMode } : {}),
    ...(cancelRequest ? { cancelRequest } : {}),
  };
}

async function hydrate(client, rows) {
  if (!rows.length) return [];
  const ids = rows.map((row) => String(row.id));
  const placeholders = ids.map(() => '?').join(',');
  const [items] = await client.execute(
    `SELECT id, booking_id, service_id, service_name_snapshot, quantity, unit_price, unit_snapshot
     FROM booking_items WHERE booking_id IN (${placeholders}) ORDER BY id`, ids,
  );
  const [history] = await client.execute(
    `SELECT booking_id, changed_by, status, note, created_at FROM booking_status_history
     WHERE booking_id IN (${placeholders}) ORDER BY created_at, id`, ids,
  );
  return rows.map((row) => orderDto(row,
    items.filter((item) => String(item.booking_id) === String(row.id)),
    history.filter((entry) => String(entry.booking_id) === String(row.id))));
}

async function loadOne(client, customerId, bookingId) {
  const [rows] = await client.execute(`${selectBooking} WHERE id = ? AND customer_id = ?`, [bookingId, customerId]);
  return (await hydrate(client, rows))[0] ?? null;
}

function totals(service, quantity) {
  const cents = BigInt(Math.round(service.price * 100));
  const hundredths = BigInt(Math.round(quantity * 100));
  const total = (cents * hundredths + 50n) / 100n;
  const duration = Math.max(60, Math.ceil((service.baseMinutes + service.minutesPerUnit * quantity) / 30) * 30);
  if (total > 999999999999n || total < 0n || !Number.isSafeInteger(duration) || duration < 1) {
    throw new HttpError(422, 'ORDER_LIMIT_EXCEEDED', 'Số lượng hoặc tổng tiền vượt giới hạn đơn dịch vụ.');
  }
  return { amount: (Number(total) / 100).toFixed(2), duration };
}

export function bookingRequestHash(input) {
  const normalized = {
    serviceId: String(input.serviceId),
    quantity: Number(input.quantity),
    contact: input.contact,
    scheduledAt: new Date(input.scheduledAt).toISOString(),
    specialRequest: input.specialRequest,
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

async function findBookingByRequestKey(client, customerId, input) {
  const [rows] = await client.execute(
    'SELECT id, customer_request_hash FROM bookings WHERE customer_id = ? AND customer_request_key = ?',
    [customerId, input.requestKey],
  );
  if (!rows[0]) return null;
  if (rows[0].customer_request_hash !== bookingRequestHash(input)) {
    throw new HttpError(409, 'REQUEST_KEY_REUSED', 'Mã yêu cầu đã được dùng cho thông tin đặt dịch vụ khác.');
  }
  return loadOne(client, customerId, String(rows[0].id));
}

const productOrderStatuses = { PROCESSING: 'processing', PENDING: 'pending', FAILED: 'failed' };

async function acquirePurchaseLock(connection, customerId, requestKey, state, scope = 'product-order', timeout = 3) {
  state.uncertain = true;
  const [rows] = await connection.execute("SELECT GET_LOCK(SHA2(CONCAT(DATABASE(), ':', ?, ':', ?, ':', ?), 256), ?) AS acquired", [scope, customerId, requestKey, timeout]);
  const acquired = rows[0]?.acquired;
  if (acquired !== 0 && acquired !== '0' && acquired !== 1 && acquired !== '1') throw new HttpError(503, 'PRODUCT_ORDER_BUSY', 'Chưa thể xác nhận khóa yêu cầu đơn sản phẩm.');
  state.uncertain = false;
  state.locked = Number(acquired) === 1;
  if (!state.locked) throw new HttpError(503, 'PRODUCT_ORDER_BUSY', 'Đơn sản phẩm đang được xử lý. Vui lòng thử lại cùng mã yêu cầu.');
}
async function releasePurchaseConnection(connection, customerId, requestKey, state, scope = 'product-order') {
  if (state.locked) {
    try {
      const [rows] = await connection.execute("SELECT RELEASE_LOCK(SHA2(CONCAT(DATABASE(), ':', ?, ':', ?, ':', ?), 256)) AS released", [scope, customerId, requestKey]);
      if (Number(rows[0]?.released) !== 1) state.uncertain = true;
    } catch { state.uncertain = true; }
  }
  if (state.uncertain) connection.destroy();
  else connection.release();
}

function parseJson(raw, fallback) {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return value ?? fallback;
  } catch {
    throw new HttpError(503, 'INVALID_ORDER_DATA', 'Dữ liệu đơn mua sản phẩm chưa hợp lệ.');
  }
}

function productOrderDto(row, itemRows = []) {
  const status = productOrderStatuses[row.status];
  if (!status) throw new HttpError(503, 'UNSUPPORTED_PRODUCT_ORDER_STATUS', 'Trạng thái đơn mua sản phẩm chưa được hỗ trợ.');
  const requestItems = parseJson(row.items_request, []);
  const contact = parseJson(row.contact_snapshot, {});
  if (!Array.isArray(requestItems) || !contact || typeof contact !== 'object' || Array.isArray(contact)
    || typeof contact.name !== 'string' || typeof contact.phone !== 'string'
    || (status === 'pending' && itemRows.length === 0)) {
    throw new HttpError(503, 'INVALID_ORDER_DATA', 'Dữ liệu đơn mua sản phẩm chưa hợp lệ.');
  }
  const items = itemRows.length ? itemRows.map((item) => {
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unit_price);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || !Number.isFinite(unitPrice) || unitPrice < 0
      || typeof item.product_name_snapshot !== 'string' || typeof item.unit_snapshot !== 'string') {
      throw new HttpError(503, 'INVALID_ORDER_DATA', 'Chi tiết đơn mua sản phẩm chưa hợp lệ.');
    }
    return {
      productId: String(item.product_id), code: item.product_code_snapshot,
      name: item.product_name_snapshot, unit: item.unit_snapshot, quantity, unitPrice,
    };
  }) : requestItems.map((item) => {
    if (!item || typeof item.productId !== 'string' || !Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new HttpError(503, 'INVALID_ORDER_DATA', 'Yêu cầu đơn mua sản phẩm chưa hợp lệ.');
    }
    return { productId: item.productId, quantity: item.quantity };
  });
  const total = row.total_amount === null ? null : Number(row.total_amount);
  const createdAt = iso(row.created_at), updatedAt = iso(row.updated_at);
  if (!createdAt || !updatedAt || (total !== null && (!Number.isFinite(total) || total < 0 || total > 9999999999.99))
    || (status === 'pending' && (total === null || Math.round(total * 100) !== items.reduce((sum, item) => sum + Math.round(item.unitPrice * 100) * item.quantity, 0)))) {
    throw new HttpError(503, 'INVALID_ORDER_DATA', 'Tổng tiền hoặc thời điểm đơn mua sản phẩm chưa hợp lệ.');
  }
  return {
    id: String(row.id), code: `SPDH${String(row.id).padStart(6, '0')}`,
    customerId: String(row.customer_id), status,
    items, contact,
    total, createdAt, updatedAt,
    ...(row.error_code ? { errorCode: row.error_code } : {}),
  };
}

async function loadProductOrder(client, customerId, orderId) {
  const [rows] = await client.execute(
    `SELECT id, customer_id, request_key, items_request, contact_snapshot, status, total_amount, error_code, created_at, updated_at
     FROM product_orders WHERE customer_id = ? AND id = ?`,
    [customerId, orderId],
  );
  if (!rows[0]) return null;
  const [items] = await client.execute(
    `SELECT product_id, product_code_snapshot, product_name_snapshot, unit_snapshot, quantity, unit_price
     FROM product_order_items WHERE product_order_id = ? ORDER BY id`,
    [orderId],
  );
  return productOrderDto(rows[0], items);
}

function productRequestHash(contact, items) {
  const normalized = [...items].sort((a, b) => BigInt(a.productId) < BigInt(b.productId) ? -1 : 1);
  return createHash('sha256').update(JSON.stringify({ contact, items: normalized })).digest('hex');
}

export function createRepository(pool) {
  let productSchemaReady;
  let bookingRequestSchemaReady;
  const requireBookingRequestSchema = async () => {
    if (!bookingRequestSchemaReady) {
      bookingRequestSchemaReady = checkCustomerBookingIdempotencySchema(pool);
    }
    let ready;
    try { ready = await bookingRequestSchemaReady; }
    catch (error) { bookingRequestSchemaReady = undefined; throw error; }
    if (!ready) {
      bookingRequestSchemaReady = undefined;
      throw new HttpError(503, 'BOOKING_IDEMPOTENCY_SCHEMA_NOT_READY', 'Đặt dịch vụ an toàn khi thử lại chưa sẵn sàng. Cần áp dụng migration 003 theo quy trình được duyệt.');
    }
  };
  const requireProductOrderSchema = async () => {
    if (!productSchemaReady) {
      productSchemaReady = pool.execute(
        `SELECT COUNT(DISTINCT table_name) AS present FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name IN ('product_orders', 'product_order_items')`,
      ).then(([rows]) => Number(rows[0]?.present) === 2);
    }
    let ready;
    try { ready = await productSchemaReady; }
    catch (error) { productSchemaReady = undefined; throw error; }
    if (!ready) {
      productSchemaReady = undefined;
      throw new HttpError(503, 'PRODUCT_SCHEMA_NOT_READY', 'Đơn sản phẩm chưa sẵn sàng. Cần áp dụng migration 002 theo quy trình được duyệt.');
    }
  };
  return {
    async list(customerId, { page, limit }) {
      const [count] = await pool.execute('SELECT COUNT(*) AS total FROM bookings WHERE customer_id = ?', [customerId]);
      const [rows] = await pool.query(`${selectBooking} WHERE customer_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`,
        [customerId, limit, (page - 1) * limit]);
      return { items: await hydrate(pool, rows), total: Number(count[0].total), page, limit };
    },
    get: (customerId, bookingId) => loadOne(pool, customerId, bookingId),
    async getByRequestKey(customerId, input) {
      if (!input.requestKey) return null;
      await requireBookingRequestSchema();
      return findBookingByRequestKey(pool, customerId, input);
    },
    async create(customerId, input, service, branchId) {
      if (input.requestKey) await requireBookingRequestSchema();
      const { amount, duration } = totals(service, input.quantity);
      const start = new Date(input.scheduledAt);
      const end = new Date(start.getTime() + duration * 60000);
      if (!Number.isFinite(end.getTime()) || end.getTime() > Date.parse('2038-01-19T03:14:07Z')) {
        throw new HttpError(422, 'SCHEDULE_OUT_OF_RANGE', 'Thời gian thực hiện vượt giới hạn lưu trữ.');
      }
      const connection = await pool.getConnection();
      let transaction = false;
      try {
        await connection.beginTransaction();
        transaction = true;
        if (input.requestKey) {
          const existing = await findBookingByRequestKey(connection, customerId, input);
          if (existing) {
            await connection.commit();
            transaction = false;
            return existing;
          }
        }
        const snapshot = JSON.stringify({
          version: 1, contact: input.contact, specialRequest: input.specialRequest,
          pricingMode: service.pricingMode ?? 'reference',
        });
        const requestValues = input.requestKey
          ? [customerId, branchId, snapshot, start, end, amount, input.requestKey, bookingRequestHash(input)]
          : [customerId, branchId, snapshot, start, end, amount];
        const [result] = await connection.execute(input.requestKey
          ? `INSERT INTO bookings (customer_id, branch_id, address_snapshot, scheduled_start, scheduled_end, status, total_amount, customer_request_key, customer_request_hash)
             VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)`
          : `INSERT INTO bookings (customer_id, branch_id, address_snapshot, scheduled_start, scheduled_end, status, total_amount)
             VALUES (?, ?, ?, ?, ?, 'PENDING', ?)`, requestValues);
        const bookingId = String(result.insertId);
        await connection.execute(
          `INSERT INTO booking_items (booking_id, service_id, entitlement_id, service_name_snapshot, quantity, unit_price, unit_snapshot)
           VALUES (?, ?, NULL, ?, ?, ?, ?)`,
          [bookingId, service.id, service.name, input.quantity, service.price.toFixed(2), service.unit],
        );
        await connection.execute(
          `INSERT INTO booking_status_history (booking_id, changed_by, status, note) VALUES (?, ?, 'PENDING', ?)`,
          [bookingId, customerId, JSON.stringify({ version: 1, type: 'CUSTOMER_ORDER_CREATED' })],
        );
        const saved = await loadOne(connection, customerId, bookingId);
        if (!saved) throw badData();
        await connection.commit();
        transaction = false;
        return saved;
      } catch (error) {
        if (transaction) await connection.rollback().catch(() => {});
        if (input.requestKey && error?.code === 'ER_DUP_ENTRY') {
          const existing = await findBookingByRequestKey(connection, customerId, input);
          if (existing) return existing;
        }
        throw error;
      } finally {
        connection.release();
      }
    },
    async requestCancellation(customerId, bookingId, reason) {
      const connection = await pool.getConnection();
      let transaction = false;
      try {
        await connection.beginTransaction();
        transaction = true;
        const [rows] = await connection.execute(
          `${selectBooking} WHERE id = ? AND customer_id = ? FOR UPDATE`, [bookingId, customerId],
        );
        if (!rows[0]) throw new HttpError(404, 'ORDER_NOT_FOUND', 'Không tìm thấy đơn dịch vụ.');
        const current = (await hydrate(connection, rows))[0];
        if (!['pending', 'confirmed'].includes(current.status)) {
          throw new HttpError(422, 'CANCELLATION_NOT_ALLOWED', 'Đơn không còn đủ điều kiện gửi yêu cầu hủy.');
        }
        if (current.cancelRequest?.status === 'pending') {
          throw new HttpError(409, 'CANCELLATION_ALREADY_REQUESTED', 'Đơn đang có yêu cầu hủy chờ xử lý.');
        }
        await connection.execute(
          'INSERT INTO booking_status_history (booking_id, changed_by, status, note) VALUES (?, ?, ?, ?)',
          [bookingId, customerId, rows[0].status, JSON.stringify({ version: 1, type: 'CUSTOMER_CANCEL_REQUESTED', reason })],
        );
        const saved = await loadOne(connection, customerId, bookingId);
        await connection.commit();
        transaction = false;
        return saved;
      } catch (error) {
        if (transaction) await connection.rollback().catch(() => {});
        throw error;
      } finally {
        connection.release();
      }
    },
    async createProductOrder(customerId, input) {
      await requireProductOrderSchema();
      const requestHash = productRequestHash(input.contact, input.items);
      const connection = await pool.getConnection();
      const lock = { locked: false, uncertain: false };
      let transaction = false;
      try {
        await acquirePurchaseLock(connection, customerId, input.requestKey, lock);
        await connection.beginTransaction();
        transaction = true;
        const [existing] = await connection.execute(
          // The per-key advisory lock serializes this lookup. A missing-row
          // FOR UPDATE would also gap-lock unrelated request keys and deadlock
          // independent customers inserting their first order concurrently.
          `SELECT id, request_hash FROM product_orders WHERE customer_id = ? AND request_key = ?`,
          [customerId, input.requestKey],
        );
        if (existing[0]) {
          if (existing[0].request_hash !== requestHash) throw new HttpError(409, 'REQUEST_KEY_REUSED', 'Mã yêu cầu đã được dùng cho nội dung đơn khác.');
          const order = await loadProductOrder(connection, customerId, existing[0].id);
          await connection.commit();
          transaction = false;
          return order;
        }
        const [result] = await connection.execute(
          `INSERT INTO product_orders (customer_id, request_key, request_hash, items_request, contact_snapshot, status)
           VALUES (?, ?, ?, ?, ?, 'PROCESSING')`,
          [customerId, input.requestKey, requestHash, JSON.stringify(input.items), JSON.stringify(input.contact)],
        );
        const order = await loadProductOrder(connection, customerId, result.insertId);
        if (!order) throw new HttpError(503, 'INVALID_ORDER_DATA', 'Không thể xác nhận đơn mua sản phẩm vừa tạo.');
        await connection.commit();
        transaction = false;
        return order;
      } catch (error) {
        if (transaction) await connection.rollback().catch(() => {});
        if (error?.code === 'ER_DUP_ENTRY') {
          // Reuse this connection after rollback. Acquiring another pool slot
          // while holding the advisory lock could wait forever with pool size 1.
          const [rows] = await connection.execute(
            `SELECT id, request_hash FROM product_orders WHERE customer_id = ? AND request_key = ?`,
            [customerId, input.requestKey],
          );
          if (rows[0]) {
            if (rows[0].request_hash !== requestHash) throw new HttpError(409, 'REQUEST_KEY_REUSED', 'Mã yêu cầu đã được dùng cho nội dung đơn khác.');
            return loadProductOrder(connection, customerId, rows[0].id);
          }
        }
        throw error;
      } finally {
        await releasePurchaseConnection(connection, customerId, input.requestKey, lock);
      }
    },
    async listProductOrders(customerId, { page, limit }) {
      await requireProductOrderSchema();
      const [count] = await pool.execute('SELECT COUNT(*) AS total FROM product_orders WHERE customer_id = ?', [customerId]);
      const [rows] = await pool.query(
        `SELECT id, customer_id, request_key, items_request, contact_snapshot, status, total_amount, error_code, created_at, updated_at
         FROM product_orders WHERE customer_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`,
        [customerId, limit, (page - 1) * limit],
      );
      if (!rows.length) return { items: [], total: Number(count[0].total), page, limit };
      const placeholders = rows.map(() => '?').join(',');
      const ids = rows.map((row) => row.id);
      const [itemRows] = await pool.execute(
        `SELECT product_order_id, product_id, product_code_snapshot, product_name_snapshot, unit_snapshot, quantity, unit_price
         FROM product_order_items WHERE product_order_id IN (${placeholders}) ORDER BY product_order_id, id`,
        ids,
      );
      return {
        items: rows.map((row) => productOrderDto(
          row, itemRows.filter((item) => String(item.product_order_id) === String(row.id)),
        )),
        total: Number(count[0].total), page, limit,
      };
    },
    async getProductOrder(customerId, orderId, operationConnection) {
      await requireProductOrderSchema();
      return loadProductOrder(operationConnection ?? pool, customerId, orderId);
    },
    async withProductOrderOperation(customerId, orderId, operation) {
      await requireProductOrderSchema();
      const connection = await pool.getConnection();
      const lock = { locked: false, uncertain: false };
      try {
        // One owned order's reconciliation is serialized across all Order
        // instances. No outer transaction spans the Catalog HTTP call.
        await acquirePurchaseLock(connection, customerId, String(orderId), lock, 'product-reconcile', 0);
        return await operation(connection);
      } finally {
        await releasePurchaseConnection(connection, customerId, String(orderId), lock, 'product-reconcile');
      }
    },
    async completeProductOrder(customerId, orderId, reservation, operationConnection) {
      await requireProductOrderSchema();
      const connection = operationConnection ?? await pool.getConnection();
      let transaction = false;
      try {
        await connection.beginTransaction();
        transaction = true;
        const [rows] = await connection.execute(
          `SELECT id, customer_id, request_key, items_request, contact_snapshot, status, total_amount, error_code, created_at, updated_at
           FROM product_orders WHERE customer_id = ? AND id = ? FOR UPDATE`,
          [customerId, orderId],
        );
        if (!rows[0]) throw new HttpError(404, 'PRODUCT_ORDER_NOT_FOUND', 'Không tìm thấy đơn mua sản phẩm.');
        if (rows[0].status === 'PENDING') {
          const current = await loadProductOrder(connection, customerId, orderId);
          await connection.commit();
          transaction = false;
          return current;
        }
        if (rows[0].status !== 'PROCESSING' || reservation.status !== 'reserved'
          || reservation.operationKey !== 'purchase-' + orderId || String(reservation.customerId) !== String(customerId)
          || !Array.isArray(reservation.items) || !Number.isFinite(reservation.total) || reservation.total < 0) {
          throw new HttpError(409, 'PRODUCT_ORDER_NOT_PROCESSING', 'Đơn mua sản phẩm không thể hoàn tất ở trạng thái hiện tại.');
        }
        const requested = parseJson(rows[0].items_request, []);
        const snapshots = [...reservation.items].sort((a, b) => BigInt(a.productId) < BigInt(b.productId) ? -1 : 1);
        const expected = [...requested].sort((a, b) => BigInt(a.productId) < BigInt(b.productId) ? -1 : 1);
        let totalCents = 0;
        if (snapshots.length !== expected.length || !expected.length) {
          throw new HttpError(503, 'INVALID_RESERVATION_RESPONSE', 'Dịch vụ tồn kho trả danh sách sản phẩm không hợp lệ.');
        }
        for (let index = 0; index < snapshots.length; index += 1) {
          const item = snapshots[index];
          const priceCents = Math.round(Number(item.unitPrice) * 100);
          if (String(item.productId) !== String(expected[index].productId) || item.quantity !== expected[index].quantity
            || typeof item.code !== 'string' || typeof item.name !== 'string' || typeof item.unit !== 'string'
            || !Number.isSafeInteger(priceCents) || priceCents < 0
            || Math.abs(Number(item.unitPrice) * 100 - priceCents) > 0.001) {
            throw new HttpError(503, 'INVALID_RESERVATION_RESPONSE', 'Dịch vụ tồn kho trả dữ liệu sản phẩm không hợp lệ.');
          }
          totalCents += priceCents * item.quantity;
        }
        const reportedCents = Math.round(reservation.total * 100);
        if (!Number.isSafeInteger(totalCents) || totalCents > 999999999999 || reportedCents !== totalCents) {
          throw new HttpError(503, 'INVALID_RESERVATION_RESPONSE', 'Tổng tiền từ dịch vụ tồn kho không khớp chi tiết đơn.');
        }
        for (const item of snapshots) {
          await connection.execute(
            `INSERT INTO product_order_items
             (product_order_id, product_id, product_code_snapshot, product_name_snapshot, unit_snapshot, quantity, unit_price, line_total)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [orderId, item.productId, item.code, item.name, item.unit, item.quantity, (Math.round(Number(item.unitPrice) * 100) / 100).toFixed(2), (Math.round(Number(item.unitPrice) * 100) * item.quantity / 100).toFixed(2)],
          );
        }
        await connection.execute(
          `UPDATE product_orders SET status = 'PENDING', total_amount = ?, error_code = NULL WHERE id = ? AND customer_id = ? AND status = 'PROCESSING'`,
          [reservation.total.toFixed(2), orderId, customerId],
        );
        const saved = await loadProductOrder(connection, customerId, orderId);
        await connection.commit();
        transaction = false;
        return saved;
      } catch (error) {
        if (transaction) await connection.rollback().catch(() => {});
        throw error;
      } finally {
        if (!operationConnection) connection.release();
      }
    },
    async failProductOrder(customerId, orderId, errorCode, operationConnection) {
      await requireProductOrderSchema();
      const connection = operationConnection ?? await pool.getConnection();
      let transaction = false;
      try {
        await connection.beginTransaction();
        transaction = true;
        await connection.execute(
          `UPDATE product_orders SET status = 'FAILED', error_code = ?
           WHERE id = ? AND customer_id = ? AND status = 'PROCESSING'`,
          [errorCode, orderId, customerId],
        );
        const saved = await loadProductOrder(connection, customerId, orderId);
        if (!saved) throw new HttpError(404, 'PRODUCT_ORDER_NOT_FOUND', 'Không tìm thấy đơn mua sản phẩm.');
        await connection.commit();
        transaction = false;
        return saved;
      } catch (error) {
        if (transaction) await connection.rollback().catch(() => {});
        throw error;
      } finally {
        if (!operationConnection) connection.release();
      }
    },
    async retryProductOrder(customerId, orderId) {
      await requireProductOrderSchema();
      const connection = await pool.getConnection();
      let transaction = false;
      try {
        await connection.beginTransaction();
        transaction = true;
        const [rows] = await connection.execute(
          `SELECT id, status FROM product_orders WHERE customer_id = ? AND id = ? FOR UPDATE`,
          [customerId, orderId],
        );
        if (!rows[0]) throw new HttpError(404, 'PRODUCT_ORDER_NOT_FOUND', 'Không tìm thấy đơn mua sản phẩm.');
        if (rows[0].status === 'FAILED') {
          await connection.execute(
            `UPDATE product_orders SET status = 'PROCESSING', error_code = NULL WHERE id = ? AND customer_id = ?`,
            [orderId, customerId],
          );
        }
        const saved = await loadProductOrder(connection, customerId, orderId);
        await connection.commit();
        transaction = false;
        return saved;
      } catch (error) {
        if (transaction) await connection.rollback().catch(() => {});
        throw error;
      } finally {
        connection.release();
      }
    },
  };
}
