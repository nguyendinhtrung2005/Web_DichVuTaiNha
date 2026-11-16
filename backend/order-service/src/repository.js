import { createHash } from 'node:crypto';
import { HttpError } from '../../shared/http.js';
import { checkCustomerBookingIdempotencySchema } from '../../shared/database-checks.js';
import { checkProductPaymentSchema } from './product-payment-schema.js';

const statuses = {
  PENDING: 'pending', CONFIRMED: 'confirmed', IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed', CANCELLED: 'cancelled',
};
const statusLabels = {
  PENDING: 'Đơn chờ xác nhận', CONFIRMED: 'Đơn đã xác nhận', IN_PROGRESS: 'Đang thực hiện',
  COMPLETED: 'Hoàn thành dịch vụ', CANCELLED: 'Đơn đã hủy',
};
const assignmentStatuses = {
  ASSIGNED: 'waiting', ACCEPTED: 'accepted', IN_PROGRESS: 'in_progress', COMPLETED: 'done', DONE: 'done',
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

async function loadById(client, bookingId) {
  const [rows] = await client.execute(`${selectBooking} WHERE id = ?`, [bookingId]);
  return (await hydrate(client, rows))[0] ?? null;
}

function pendingCancellation(historyRows) {
  let pending = false;
  for (const row of historyRows) {
    const event = noteEvent(row.note);
    if (event?.type === 'CUSTOMER_CANCEL_REQUESTED') pending = true;
    if (event?.type === 'CUSTOMER_CANCEL_RESOLVED') pending = false;
  }
  return pending;
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
    ...(input.expectedUnitPrice === undefined ? {} : { expectedUnitPrice: input.expectedUnitPrice }),
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
    return { productId: item.productId, quantity: item.quantity, ...(item.expectedUnitPrice === undefined ? {} : { expectedUnitPrice: item.expectedUnitPrice }) };
  });
  const total = row.total_amount === null ? null : Number(row.total_amount);
  const paymentMethod = row.payment_method == null ? null : { CASH: 'cash', TRANSFER: 'transfer' }[row.payment_method];
  if (row.payment_method != null && !paymentMethod) throw new HttpError(503, 'INVALID_ORDER_DATA', 'Phương thức thanh toán của đơn sản phẩm không hợp lệ.');
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
    payment: paymentMethod ? { method: paymentMethod, status: status !== 'pending' ? 'not_started' : paymentMethod === 'cash' ? 'unpaid' : 'pending', simulated: true } : null,
    ...(row.error_code ? { errorCode: row.error_code } : {}),
  };
}

async function loadProductOrder(client, customerId, orderId) {
  const [rows] = await client.execute(
    `SELECT product_orders.*
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

function productRequestHash(contact, items, paymentMethod) {
  const normalized = [...items].sort((a, b) => BigInt(a.productId) < BigInt(b.productId) ? -1 : 1);
  return createHash('sha256').update(JSON.stringify({ contact, items: normalized, ...(paymentMethod === undefined ? {} : { paymentMethod }) })).digest('hex');
}

export function createRepository(pool) {
  let productSchemaReady;
  let paymentSchemaReady;
  const requireProductPaymentSchema = async () => {
    if (!paymentSchemaReady) paymentSchemaReady = await checkProductPaymentSchema(pool);
    if (!paymentSchemaReady) throw new HttpError(503, 'PRODUCT_PAYMENT_SCHEMA_NOT_READY', 'Chưa cấu hình thanh toán mô phỏng cho đơn sản phẩm. Cần migration 004 đã được owner duyệt.');
  };
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
    async listStaffJobs(employeeId, { page, pageSize, status, fromUtc, toUtc, q = '', sort = 'schedule-asc' }) {
      const assignmentQuery = `(
        SELECT id, booking_id, status,
               ROW_NUMBER() OVER (
                 PARTITION BY booking_id
                 ORDER BY CASE WHEN status = 'IN_PROGRESS' THEN 0 WHEN status IN ('COMPLETED', 'DONE') THEN 1 ELSE 2 END,
                          assigned_at DESC, id DESC
               ) AS rn
        FROM assignments
        WHERE employee_id = ? AND status NOT IN ('CANCELLED', 'REJECTED')
      )`;
      const conditions = ['staff_assignment.rn = 1'];
      const values = [employeeId];
      if (fromUtc) { conditions.push('b.scheduled_start >= ?'); values.push(fromUtc); }
      if (toUtc) { conditions.push('b.scheduled_start < ?'); values.push(toUtc); }
      if (q) {
        const escaped = `%${q.replace(/[!%_]/g, (character) => `!${character}`)}%`;
        conditions.push(`(CONCAT('DH', LPAD(CAST(b.id AS CHAR), GREATEST(6, CHAR_LENGTH(CAST(b.id AS CHAR))), '0')) LIKE ? ESCAPE '!'
          OR EXISTS (SELECT 1 FROM booking_items bi WHERE bi.booking_id = b.id AND bi.service_name_snapshot LIKE ? ESCAPE '!'))`);
        values.push(escaped, escaped);
      }
      if (status === 'in_progress') conditions.push("(b.status = 'IN_PROGRESS' OR staff_assignment.status = 'IN_PROGRESS')");
      else if (status === 'waiting') conditions.push("staff_assignment.status = 'ASSIGNED'");
      else if (status === 'accepted') conditions.push("staff_assignment.status = 'ACCEPTED'");
      else if (status === 'done') conditions.push("staff_assignment.status IN ('COMPLETED', 'DONE')");
      else if (status) { conditions.push('b.status = ?'); values.push(status.toUpperCase()); }
      const from = ` FROM bookings b JOIN ${assignmentQuery} AS staff_assignment ON staff_assignment.booking_id = b.id`;
      const where = ` WHERE ${conditions.join(' AND ')}`;
      const sortSql = { 'schedule-asc': 'b.scheduled_start ASC, b.id ASC', 'schedule-desc': 'b.scheduled_start DESC, b.id DESC' }[sort];
      if (!sortSql) throw new HttpError(400, 'INVALID_INPUT', 'Cách sắp xếp công việc không hợp lệ.');
      const [counts] = await pool.execute(`SELECT COUNT(DISTINCT b.id) AS total${from}${where}`, values);
      const [rows] = await pool.execute(
        `SELECT b.id, b.customer_id, b.branch_id, b.address_snapshot, b.scheduled_start,
                b.scheduled_end, b.status, b.total_amount, staff_assignment.status AS assignment_status
         ${from}${where}
         ORDER BY ${sortSql} LIMIT ? OFFSET ?`,
        [...values, pageSize, (page - 1) * pageSize],
      );
      const orders = await hydrate(pool, rows);
      return {
        items: orders.map((order, index) => {
          const jobStatus = assignmentStatuses[rows[index].assignment_status];
          if (!jobStatus) throw new HttpError(503, 'UNSUPPORTED_ASSIGNMENT_STATUS', 'Trạng thái phân công chưa được hỗ trợ.');
          return { ...order, jobStatus };
        }),
        total: Number(counts[0]?.total ?? 0), page, pageSize,
      };
    },
    getById: (bookingId) => loadById(pool, bookingId),
    async applyStaffTransition({ operationId, assignmentId, employeeId, bookingId, nextStatus }) {
      const target = ({ accepted: 'ACCEPTED', in_progress: 'IN_PROGRESS', done: 'COMPLETED' })[nextStatus];
      const from = ({ ACCEPTED: 'ASSIGNED', IN_PROGRESS: 'ACCEPTED', COMPLETED: 'IN_PROGRESS' })[target];
      if (!target || !from) throw new HttpError(400, 'INVALID_INPUT', 'Trạng thái công việc không hợp lệ.');
      const connection = await pool.getConnection();
      let transaction = false;
      try {
        await connection.beginTransaction();
        transaction = true;
        const [operations] = await connection.execute(
          `SELECT assignment_id AS assignmentId, employee_id AS employeeId, booking_id AS bookingId,
                  from_status AS fromStatus, to_status AS toStatus, phase,
                  result_snapshot AS resultSnapshot
           FROM staff_assignment_transition_operations WHERE operation_id = ? FOR UPDATE`,
          [operationId],
        );
        const operation = operations[0];
        if (!operation || String(operation.assignmentId) !== String(assignmentId)
          || String(operation.employeeId) !== String(employeeId) || String(operation.bookingId) !== String(bookingId)
          || operation.fromStatus !== from || operation.toStatus !== target) {
          throw new HttpError(409, 'TRANSITION_OPERATION_NOT_FOUND', 'Không tìm thấy thao tác chuyển trạng thái hợp lệ.');
        }
        if (operation.phase === 'COMPLETED') {
          const snapshot = typeof operation.resultSnapshot === 'string' ? JSON.parse(operation.resultSnapshot) : operation.resultSnapshot;
          await connection.commit();
          transaction = false;
          return snapshot;
        }
        if (operation.phase !== 'PENDING') throw new HttpError(409, 'TRANSITION_NOT_PENDING', 'Thao tác chuyển trạng thái không còn chờ xử lý.');
        const [bookings] = await connection.execute(
          'SELECT id, status FROM bookings WHERE id = ? FOR UPDATE',
          [bookingId],
        );
        const booking = bookings[0];
        if (!booking) throw new HttpError(404, 'ORDER_NOT_FOUND', 'Không tìm thấy đơn dịch vụ.');
        const [employees] = await connection.execute('SELECT user_id FROM employees WHERE id = ?', [employeeId]);
        if (!employees[0]) throw new HttpError(404, 'STAFF_ACCOUNT_NOT_FOUND', 'Không tìm thấy hồ sơ nhân viên.');
        const [assignments] = await connection.execute(
          `SELECT status FROM assignments
           WHERE id = ? AND booking_id = ? AND employee_id = ? FOR UPDATE`,
          [assignmentId, bookingId, employeeId],
        );
        if (!assignments[0] || assignments[0].status !== from) {
          throw new HttpError(409, 'INVALID_JOB_TRANSITION', 'Trạng thái công việc đã thay đổi.');
        }
        const [history] = await connection.execute(
          `SELECT note FROM booking_status_history WHERE booking_id = ? ORDER BY created_at, id`,
          [bookingId],
        );
        let orderStatus = statuses[booking.status];
        if (!orderStatus) throw new HttpError(503, 'UNSUPPORTED_ORDER_STATUS', 'Trạng thái đơn chưa được hỗ trợ.');
        if (booking.status === 'CANCELLED') {
          throw new HttpError(409, 'ORDER_CANCELLED', 'Đơn đã bị hủy; không thể cập nhật công việc.');
        }
        if (target === 'IN_PROGRESS') {
          if (pendingCancellation(history)) {
            throw new HttpError(409, 'CANCELLATION_PENDING', 'Đơn có yêu cầu hủy đang chờ xử lý.');
          }
          if (booking.status !== 'CONFIRMED') {
            throw new HttpError(409, 'ORDER_NOT_READY', 'Chỉ đơn đã xác nhận mới có thể bắt đầu thực hiện.');
          }
          await connection.execute("UPDATE bookings SET status = 'IN_PROGRESS' WHERE id = ?", [bookingId]);
          await connection.execute(
            `INSERT INTO booking_status_history (booking_id, changed_by, status, note)
             VALUES (?, ?, 'IN_PROGRESS', '')`,
            [bookingId, employees[0].user_id],
          );
          orderStatus = 'in_progress';
        } else if (target === 'COMPLETED') {
          if (booking.status !== 'IN_PROGRESS') {
            throw new HttpError(409, 'ORDER_NOT_IN_PROGRESS', 'Đơn không ở trạng thái đang thực hiện.');
          }
          const [remaining] = await connection.execute(
            `SELECT COUNT(*) AS total FROM assignments
             WHERE booking_id = ? AND id <> ? AND status NOT IN ('COMPLETED', 'DONE', 'CANCELLED', 'REJECTED')`,
            [bookingId, assignmentId],
          );
          if (Number(remaining[0]?.total) === 0) {
            await connection.execute("UPDATE bookings SET status = 'COMPLETED' WHERE id = ?", [bookingId]);
            await connection.execute(
              `INSERT INTO booking_status_history (booking_id, changed_by, status, note)
               VALUES (?, ?, 'COMPLETED', '')`,
              [bookingId, employees[0].user_id],
            );
            orderStatus = 'completed';
          }
        }
        const result = { bookingId: String(bookingId), orderStatus };
        await connection.execute(
          `UPDATE staff_assignment_transition_operations
           SET phase = 'COMPLETED', result_snapshot = ?
           WHERE operation_id = ? AND phase = 'PENDING'`,
          [JSON.stringify(result), operationId],
        );
        await connection.commit();
        transaction = false;
        return result;
      } catch (error) {
        if (transaction) await connection.rollback().catch(() => {});
        throw error;
      } finally {
        connection.release();
      }
    },
    async serviceOrderReport({ from, to, status, fromUtc, toUtc }) {
      const conditions = [];
      const values = [];
      if (fromUtc) { conditions.push('created.created_at >= ?'); values.push(fromUtc); }
      if (toUtc) { conditions.push('created.created_at < ?'); values.push(toUtc); }
      if (status) { conditions.push('bookings.status = ?'); values.push(status.toUpperCase()); }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const [rows] = await pool.execute(
        `SELECT bookings.status AS status, COUNT(*) AS total
         FROM bookings
         INNER JOIN (
           SELECT booking_id, MIN(created_at) AS created_at
           FROM booking_status_history
           GROUP BY booking_id
         ) AS created ON created.booking_id = bookings.id
         ${where}
         GROUP BY bookings.status`,
        values,
      );
      const statusCounts = { pending: 0, confirmed: 0, in_progress: 0, completed: 0, cancelled: 0 };
      let total = 0;
      for (const row of rows) {
        const key = statuses[row.status];
        const count = Number(row.total);
        if (!key || !Number.isSafeInteger(count) || count < 0) {
          throw new HttpError(503, 'UNSUPPORTED_ORDER_STATUS', 'Không thể tổng hợp trạng thái đơn dịch vụ.');
        }
        statusCounts[key] = count;
        total += count;
      }
      if (!Number.isSafeInteger(total)) throw new HttpError(503, 'REPORT_LIMIT_EXCEEDED', 'Số lượng đơn vượt giới hạn báo cáo.');
      return { from, to, generatedAt: new Date().toISOString(), total, statusCounts };
    },
    async list(customerId, { page, limit, q = '', serviceId, status, fromUtc, toUtc, sort = 'newest' }) {
      const conditions = ['customer_id = ?'];
      const values = [customerId];
      if (q) {
        const escaped = `%${q.replace(/[!%_]/g, (character) => `!${character}`)}%`;
        conditions.push(`(CONCAT('DH', LPAD(CAST(bookings.id AS CHAR), GREATEST(6, CHAR_LENGTH(CAST(bookings.id AS CHAR))), '0')) LIKE ? ESCAPE '!'
          OR EXISTS (SELECT 1 FROM booking_items bi WHERE bi.booking_id = bookings.id AND bi.service_name_snapshot LIKE ? ESCAPE '!'))`);
        values.push(escaped, escaped);
      }
      if (serviceId) {
        conditions.push('EXISTS (SELECT 1 FROM booking_items bi WHERE bi.booking_id = bookings.id AND bi.service_id = ?)');
        values.push(serviceId);
      }
      if (status) { conditions.push('status = ?'); values.push(status.toUpperCase()); }
      if (fromUtc) { conditions.push('scheduled_start >= ?'); values.push(fromUtc); }
      if (toUtc) { conditions.push('scheduled_start < ?'); values.push(toUtc); }
      const sortSql = { newest: 'id DESC', oldest: 'id ASC', 'schedule-asc': 'scheduled_start ASC, id ASC', 'schedule-desc': 'scheduled_start DESC, id DESC' }[sort];
      if (!sortSql) throw new HttpError(400, 'INVALID_INPUT', 'Cách sắp xếp không hợp lệ.');
      const where = ` WHERE ${conditions.join(' AND ')}`;
      const [count] = await pool.execute(`SELECT COUNT(*) AS total FROM bookings${where}`, values);
      const [rows] = await pool.query(`${selectBooking}${where} ORDER BY ${sortSql} LIMIT ? OFFSET ?`,
        [...values, limit, (page - 1) * limit]);
      return { items: await hydrate(pool, rows), total: Number(count[0].total), page, limit };
    },
    get: (customerId, bookingId) => loadOne(pool, customerId, bookingId),
    async completedServiceBookings(serviceId, { page, limit }) {
      const where = ` WHERE status = 'COMPLETED' AND EXISTS
        (SELECT 1 FROM booking_items bi WHERE bi.booking_id = bookings.id AND bi.service_id = ?)`;
      const [count] = await pool.execute(`SELECT COUNT(*) AS total FROM bookings${where}`, [serviceId]);
      const [rows] = await pool.query(`SELECT id FROM bookings${where} ORDER BY id ASC LIMIT ? OFFSET ?`, [serviceId, limit, (page - 1) * limit]);
      return { items: rows.map((row) => ({ id: String(row.id) })), total: Number(count[0].total), page, limit };
    },
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
      if (input.paymentMethod !== undefined) await requireProductPaymentSchema();
      const requestHash = productRequestHash(input.contact, input.items, input.paymentMethod);
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
        if (input.items.some((item) => item.expectedUnitPrice === undefined)) {
          throw new HttpError(400, 'PRICE_CONFIRMATION_REQUIRED', 'Vui lòng xem đơn giá và xác nhận lại trước khi tạo đơn sản phẩm.');
        }
        if (!['cash', 'transfer'].includes(input.paymentMethod)) throw new HttpError(400, 'PAYMENT_METHOD_REQUIRED', 'Chọn phương thức thanh toán trước khi tạo đơn sản phẩm.');
        const [result] = await connection.execute(
          `INSERT INTO product_orders (customer_id, request_key, request_hash, items_request, contact_snapshot, status, payment_method)
           VALUES (?, ?, ?, ?, ?, 'PROCESSING', ?)`,
          [customerId, input.requestKey, requestHash, JSON.stringify(input.items), JSON.stringify(input.contact), input.paymentMethod.toUpperCase()],
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
        `SELECT product_orders.*
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
          `SELECT product_orders.*
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
            || (expected[index].expectedUnitPrice !== undefined && priceCents !== Math.round(expected[index].expectedUnitPrice * 100))
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
          `SELECT id, status, error_code FROM product_orders WHERE customer_id = ? AND id = ? FOR UPDATE`,
          [customerId, orderId],
        );
        if (!rows[0]) throw new HttpError(404, 'PRODUCT_ORDER_NOT_FOUND', 'Không tìm thấy đơn mua sản phẩm.');
        if (rows[0].status === 'FAILED' && !['PRICE_CHANGED', 'PRICE_CONFIRMATION_REQUIRED'].includes(rows[0].error_code)) {
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
