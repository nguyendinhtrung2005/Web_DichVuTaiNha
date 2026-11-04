import { createHttpApp, HttpError, reply } from '../../shared/http.js';
import { enumValue, id, invalid, number, object, pagination, phone, text } from '../../shared/validation.js';
import { createAuthenticator, createInternalClient } from '../../shared/service-client.js';

const assignmentStatuses = {
  ASSIGNED: 'waiting', ACCEPTED: 'accepted', IN_PROGRESS: 'in_progress', COMPLETED: 'done', DONE: 'done',
};

function createInput(body) {
  object(body, ['serviceId', 'quantity', 'contact', 'scheduledAt', 'specialRequest'], ['requestKey']);
  const requestKey = body.requestKey === undefined ? undefined : text(body.requestKey, 'requestKey', 36, 36).toLowerCase();
  if (requestKey && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestKey)) {
    throw invalid('requestKey', 'Mã yêu cầu không hợp lệ.');
  }
  object(body.contact, ['name', 'phone', 'address', 'houseType', 'hasPets'], ['area', 'rooms', 'floors']);
  const quantity = number(body.quantity, 'quantity', 1, 100000);
  if (Math.abs(quantity * 100 - Math.round(quantity * 100)) > 0.000001) throw invalid('quantity', 'Số lượng có tối đa hai chữ số thập phân.');
  if (typeof body.contact.hasPets !== 'boolean') throw invalid('contact.hasPets', 'Vui lòng xác nhận thông tin vật nuôi.');
  const contact = {
    name: text(body.contact.name, 'contact.name', 2, 100), phone: phone(body.contact.phone),
    address: text(body.contact.address, 'contact.address', 5, 2000),
    houseType: enumValue(body.contact.houseType, 'contact.houseType', ['can-ho', 'nha-pho', 'biet-thu', 'van-phong', 'phong-tro']),
    hasPets: body.contact.hasPets,
  };
  for (const field of ['area', 'rooms', 'floors']) {
    if (body.contact[field] !== undefined) {
      contact[field] = number(body.contact[field], `contact.${field}`, field === 'area' ? 0.01 : 1, field === 'area' ? 1000000 : 1000);
      if (field !== 'area' && !Number.isInteger(contact[field])) throw invalid(`contact.${field}`, 'Số phòng/tầng phải là số nguyên.');
    }
  }
  const scheduledAt = text(body.scheduledAt, 'scheduledAt', 20, 40);
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/i.exec(scheduledAt);
  const scheduled = Date.parse(scheduledAt);
  const calendar = parts ? new Date(Date.UTC(...[Number(parts[1]), Number(parts[2]) - 1, ...parts.slice(3, 7).map(Number)])) : null;
  if (!parts || !Number.isFinite(scheduled) || scheduled <= Date.now()
    || calendar.getUTCFullYear() !== Number(parts[1]) || calendar.getUTCMonth() + 1 !== Number(parts[2])
    || calendar.getUTCDate() !== Number(parts[3]) || calendar.getUTCHours() !== Number(parts[4])
    || calendar.getUTCMinutes() !== Number(parts[5]) || calendar.getUTCSeconds() !== Number(parts[6])) {
    throw invalid('scheduledAt', 'Chọn thời gian thực hiện trong tương lai, có múi giờ.');
  }
  return {
    ...(requestKey ? { requestKey } : {}),
    serviceId: id(body.serviceId, 'serviceId'), quantity, contact,
    scheduledAt: new Date(scheduled).toISOString(), specialRequest: text(body.specialRequest, 'specialRequest', 0, 2000),
  };
}

export function createProductInput(body) {
  object(body, ['requestKey', 'items', 'contact']);
  const requestKey = text(body.requestKey, 'requestKey', 36, 36).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestKey)) {
    throw invalid('requestKey', 'Mã yêu cầu không hợp lệ.');
  }
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) throw invalid('items', 'Đơn cần từ 1 đến 50 sản phẩm.');
  const seen = new Set();
  const items = body.items.map((item, index) => {
    object(item, ['productId', 'quantity']);
    const productId = id(item.productId, `items.${index}.productId`);
    const quantity = number(item.quantity, `items.${index}.quantity`, 1, 999);
    if (!Number.isInteger(quantity)) throw invalid(`items.${index}.quantity`, 'Số lượng phải là số nguyên.');
    if (seen.has(productId)) throw invalid('items', 'Không được lặp sản phẩm trong đơn.');
    seen.add(productId);
    return { productId, quantity };
  });
  object(body.contact, ['name', 'phone'], ['address', 'note']);
  const contact = {
    name: text(body.contact.name, 'contact.name', 2, 100),
    phone: phone(body.contact.phone),
    ...(body.contact.address === undefined ? {} : { address: text(body.contact.address, 'contact.address', 5, 2000) }),
    ...(body.contact.note === undefined ? {} : { note: text(body.contact.note, 'contact.note', 0, 1000) }),
  };
  return { requestKey, items, contact };
}

export async function reconcileProductPurchase({ order, repository, request, operationConnection }) {
  if (order.status !== 'processing') return reply(order);
  if (!operationConnection && repository.withProductOrderOperation) {
    try {
      return await repository.withProductOrderOperation(order.customerId, order.id, (connection) =>
        reconcileProductPurchase({ order, repository, request, operationConnection: connection }));
    } catch (error) {
      // The operation helper has already released/destroyed its connection.
      // Read the current durable outcome without retrying any mutation.
      const current = await repository.getProductOrder(order.customerId, order.id);
      if (current?.status === 'pending' || current?.status === 'failed') return reply(current);
      if (current?.status === 'processing') return reply(current, 202);
      throw error;
    }
  }
  if (operationConnection) {
    const current = await repository.getProductOrder(order.customerId, order.id, operationConnection);
    if (!current) throw new HttpError(404, 'PRODUCT_ORDER_NOT_FOUND', 'Không tìm thấy đơn mua sản phẩm.');
    if (current.status !== 'processing') return reply(current);
    order = current;
  }
  const operationKey = 'purchase-' + order.id;
  const unavailable = (error) => error instanceof HttpError ? error
    : new HttpError(503, 'PRODUCT_ORDER_UNCONFIRMED', 'Chưa thể xác minh kết quả đơn sản phẩm. Vui lòng kiểm tra lại cùng mã đơn.');
  const recover = async (error) => {
    let current;
    try { current = await repository.getProductOrder(order.customerId, order.id, operationConnection); }
    catch { throw unavailable(error); }
    if (current?.status === 'pending' || current?.status === 'failed') return reply(current);
    if (current?.status === 'processing') return reply(current, 202);
    throw unavailable(error);
  };
  const finish = async (reservation) => {
    if (!reservation || reservation.operationKey !== operationKey || String(reservation.customerId) !== order.customerId
      || !['reserved', 'released'].includes(reservation.status)) {
      throw new HttpError(503, 'INVALID_RESERVATION_RESPONSE', 'Dịch vụ tồn kho trả kết quả không hợp lệ.');
    }
    if (reservation.status === 'released') {
      return reply(await repository.failProductOrder(order.customerId, order.id, 'RESERVATION_RELEASED', operationConnection));
    }
    return reply(await repository.completeProductOrder(order.customerId, order.id, reservation, operationConnection));
  };
  let reservationKnown = false;
  try {
    let reservation;
    try { reservation = await request('catalog', '/internal/v1/product-reservations/' + operationKey); }
    catch (error) {
      if (!(error instanceof HttpError) || error.status !== 404) throw error;
      reservation = await request('catalog', '/internal/v1/product-reservations', {
        method: 'POST',
        body: { operationKey, customerId: order.customerId, items: order.items.map((item) => ({ productId: item.productId, quantity: item.quantity })) },
      });
    }
    reservationKnown = true;
    return await finish(reservation);
  } catch (error) {
    if (!reservationKnown && error instanceof HttpError && [400, 409, 422].includes(error.status)) {
      // Another request may have committed the same operation meanwhile. Verify
      // current facts before marking a durable journal FAILED.
      let current;
      try { current = await repository.getProductOrder(order.customerId, order.id, operationConnection); }
      catch { return recover(error); }
      if (current?.status !== 'processing') return current ? reply(current) : recover(error);
      try {
        const reservation = await request('catalog', '/internal/v1/product-reservations/' + operationKey);
        return await finish(reservation);
      } catch (knownError) {
        if (knownError instanceof HttpError && knownError.status === 404) {
          try { return reply(await repository.failProductOrder(order.customerId, order.id, error.code, operationConnection)); }
          catch (writeError) { return recover(writeError); }
        }
        return recover(knownError);
      }
    }
    // No reservation release on an HTTP/commit timeout: a successful transaction
    // could already exist. Explicit retry reads the same operation key.
    return recover(error);
  }
}

export function createApp({ repository, config }) {
  const request = createInternalClient(config, 'order');
  const authenticate = createAuthenticator(config, 'order');
  const enrich = async (order, { forceAssignment = false } = {}) => {
    if (!order || (order.status === 'pending' && !forceAssignment) || order.status === 'cancelled') return order;
    const assignment = await request('staff', `/internal/v1/bookings/${order.id}/assignment`);
    if (!assignment) return order;
    if (!assignmentStatuses[assignment.status]) throw new HttpError(503, 'UNSUPPORTED_ASSIGNMENT_STATUS', 'Trạng thái phân công chưa được hỗ trợ.');
    return { ...order, staffId: id(assignment.employeeId, 'employeeId'), jobStatus: assignmentStatuses[assignment.status] };
  };
  const get = async (customerId, bookingId, options) => {
    const order = await repository.get(customerId, bookingId);
    if (!order) throw new HttpError(404, 'ORDER_NOT_FOUND', 'Không tìm thấy đơn dịch vụ.');
    return enrich(order, options);
  };
  const reconcileProductOrder = (order) => reconcileProductPurchase({ order, repository, request });
  return createHttpApp({
    name: 'order', config, authenticate,
    routes: [
      { method: 'GET', path: '/api/v1/orders', auth: 'customer', handler: async ({ principal, url }) => {
        const result = await repository.list(principal.sub, pagination(url));
        return reply({ ...result, items: await Promise.all(result.items.map((order) => enrich(order))) });
      } },
      { method: 'GET', path: '/api/v1/orders/:id', auth: 'customer', handler: async ({ principal, params }) => reply(await get(principal.sub, id(params.id))) },
      { method: 'POST', path: '/api/v1/orders', auth: 'customer', handler: async ({ principal, body }) => {
        const input = createInput(body);
        if (input.requestKey && repository.getByRequestKey) {
          const existing = await repository.getByRequestKey(principal.sub, input);
          if (existing) return reply(existing);
        }
        if (!/^[1-9]\d*$/.test(config.defaultBranchId || '')) {
          throw new HttpError(503, 'DEFAULT_BRANCH_NOT_CONFIGURED', 'Chưa cấu hình chi nhánh tiếp nhận đơn Customer.');
        }
        const service = await request('catalog', `/internal/v1/services/${input.serviceId}`);
        if (!service || String(service.id) !== input.serviceId || service.status !== 'active'
          || !Number.isFinite(service.price) || service.price < 0 || !Number.isFinite(service.minutesPerUnit)
          || !Number.isInteger(service.minutesPerUnit) || service.minutesPerUnit <= 0
          || !Number.isSafeInteger(service.baseMinutes) || service.baseMinutes < 0
          || !Number.isFinite(service.minQuantity) || service.minQuantity < 1 || service.minQuantity > 100000
          || typeof service.name !== 'string' || !service.name || typeof service.unit !== 'string' || !service.unit) {
          throw new HttpError(503, 'INVALID_CATALOG_DATA', 'Dữ liệu dịch vụ chưa sẵn sàng để đặt lịch.');
        }
        if (input.quantity < service.minQuantity) throw invalid('quantity', 'Số lượng nhỏ hơn mức tối thiểu của dịch vụ.');
        const branch = await request('staff', `/internal/v1/branches/${config.defaultBranchId}`);
        if (!branch || branch.status !== 'ACTIVE') throw new HttpError(422, 'BRANCH_UNAVAILABLE', 'Chi nhánh hiện chưa tiếp nhận đơn dịch vụ.');
        return reply(await repository.create(principal.sub, input, service, config.defaultBranchId), 201);
      } },
      { method: 'POST', path: '/api/v1/orders/:id/cancellation-requests', auth: 'customer', handler: async ({ principal, params, body }) => {
        object(body, ['reason']);
        const bookingId = id(params.id);
        const reason = text(body.reason, 'reason', 3, 1000);
        const current = await get(principal.sub, bookingId, { forceAssignment: true });
        if (['in_progress', 'done'].includes(current.jobStatus)) {
          throw new HttpError(422, 'CANCELLATION_NOT_ALLOWED', 'Công việc đã bắt đầu, không thể gửi yêu cầu hủy.');
        }
        const saved = await repository.requestCancellation(principal.sub, bookingId, reason);
        return reply({ ...saved, ...(current.staffId ? { staffId: current.staffId, jobStatus: current.jobStatus } : {}) }, 201);
      } },
      { method: 'GET', path: '/api/v1/product-orders', auth: 'customer', handler: async ({ principal, url }) =>
        reply(await repository.listProductOrders(principal.sub, pagination(url))) },
      { method: 'POST', path: '/api/v1/product-orders', auth: 'customer', handler: async ({ principal, body }) => {
        const input = createProductInput(body);
        const order = await repository.createProductOrder(principal.sub, input);
        if (order.status !== 'processing') return reply(order);
        return reconcileProductOrder(order);
      } },
      { method: 'GET', path: '/api/v1/product-orders/:id', auth: 'customer', handler: async ({ principal, params }) => {
        const order = await repository.getProductOrder(principal.sub, id(params.id));
        if (!order) throw new HttpError(404, 'PRODUCT_ORDER_NOT_FOUND', 'Không tìm thấy đơn mua sản phẩm.');
        return reply(order);
      } },
      { method: 'POST', path: '/api/v1/product-orders/:id/retry', auth: 'customer', handler: async ({ principal, params, body }) => {
        object(body);
        const order = await repository.retryProductOrder(principal.sub, id(params.id));
        return order.status === 'processing' ? reconcileProductOrder(order) : reply(order);
      } },
      { method: 'GET', path: '/internal/v1/customers/:id/orders', auth: 'internal', callers: ['payment', 'review'], handler: async ({ params, url }) =>
        reply(await repository.list(id(params.id, 'customerId'), pagination(url))) },
      { method: 'GET', path: '/internal/v1/orders/:id', auth: 'internal', callers: ['payment', 'review'], handler: async ({ params, url }) =>
        reply(await get(id(url.searchParams.get('customerId'), 'customerId'), id(params.id))) },
    ],
  });
}
