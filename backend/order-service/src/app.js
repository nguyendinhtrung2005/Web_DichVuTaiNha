import { createHttpApp, HttpError, reply } from '../../shared/http.js';
import { enumValue, id, invalid, number, object, pagination, phone, text } from '../../shared/validation.js';
import { createAuthenticator, createInternalClient } from '../../shared/service-client.js';
import { customerOrderQuery } from './customer-order-query.js';

function confirmedPrice(value, field) {
  const price = number(value, field, 0, 9999999999.99);
  if (Math.abs(price * 100 - Math.round(price * 100)) > 0.000001) throw invalid(field, 'Đơn giá có tối đa hai chữ số thập phân.');
  return price;
}

export function validateCustomerStart(scheduledAt) {
  const date = new Date(Date.parse(scheduledAt) + 7 * 3600000);
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  if (Date.parse(scheduledAt) <= Date.now() || !Number.isFinite(minutes) || date.getUTCSeconds() !== 0 || date.getUTCMilliseconds() !== 0
    || minutes % 30 !== 0 || !((minutes >= 420 && minutes <= 630) || (minutes >= 780 && minutes <= 960))) {
    throw invalid('scheduledAt', 'Chọn giờ tương lai trong 07:00–10:30 hoặc 13:00–16:00, mỗi 30 phút (giờ Việt Nam).');
  }
}

function reportDateBoundary(value, field, endExclusive = false) {
  if (value === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1000 || Number(value.slice(0, 4)) > 9998) {
    throw invalid(field, 'Ngày phải theo định dạng YYYY-MM-DD.');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw invalid(field, 'Ngày không hợp lệ.');
  }
  if (endExclusive) date.setUTCDate(date.getUTCDate() + 1);
  const day = date.toISOString().slice(0, 10);
  return new Date(`${day}T00:00:00+07:00`).toISOString();
}

function staffJobQuery(url) {
  const allowed = ['from', 'to', 'status', 'page', 'pageSize', 'q', 'sort'];
  for (const name of url.searchParams.keys()) if (!allowed.includes(name)) throw invalid(name, 'Tham số công việc không được hỗ trợ.');
  for (const name of allowed) if (url.searchParams.getAll(name).length > 1) throw invalid(name, 'Không được lặp tham số công việc.');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (from && to && from > to) throw invalid('to', 'Ngày kết thúc phải từ ngày bắt đầu trở đi.');
  const parsePage = (name, fallback, max) => {
    const raw = url.searchParams.get(name);
    if (raw === null) return fallback;
    if (!/^[1-9]\d*$/.test(raw) || Number(raw) > max) throw invalid(name, name + ' không hợp lệ.');
    return Number(raw);
  };
  const status = url.searchParams.get('status');
  if (status) enumValue(status, 'status', ['pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'waiting', 'accepted', 'done']);
  const fromBoundary = reportDateBoundary(from, 'from');
  const toBoundary = reportDateBoundary(to, 'to', true);
  return {
    fromUtc: fromBoundary?.slice(0, 19).replace('T', ' '),
    toUtc: toBoundary?.slice(0, 19).replace('T', ' '),
    status: status || undefined,
    page: parsePage('page', 1, 100000),
    pageSize: parsePage('pageSize', 20, 100),
    q: url.searchParams.has('q') ? text(url.searchParams.get('q'), 'q', 0, 120) : '',
    sort: url.searchParams.has('sort') ? enumValue(url.searchParams.get('sort'), 'sort', ['schedule-asc', 'schedule-desc']) : 'schedule-asc',
  };
}

const assignmentStatuses = {
  ASSIGNED: 'waiting', ACCEPTED: 'accepted', IN_PROGRESS: 'in_progress', COMPLETED: 'done', DONE: 'done',
};

function staffJobDto(order, jobStatus) {
  return {
    id: order.id, code: order.code, serviceId: order.serviceId, serviceName: order.serviceName,
    unit: order.unit, quantity: order.quantity,
    contact: { name: order.contact.name, phone: order.contact.phone, address: order.contact.address },
    scheduledAt: order.scheduledAt, durationMinutes: order.durationMinutes,
    specialRequest: order.specialRequest, orderStatus: order.status, jobStatus,
    cancelPending: order.cancelRequest?.status === 'pending',
    history: order.history.map((entry) => ({
      at: entry.at, label: entry.label, by: entry.by === 'Khách hàng' ? 'Khách hàng' : 'CleanHome',
    })),
    createdAt: order.createdAt,
  };
}

function createInput(body) {
  object(body, ['serviceId', 'quantity', 'contact', 'scheduledAt', 'specialRequest'], ['requestKey', 'expectedUnitPrice']);
  const requestKey = body.requestKey === undefined ? undefined : text(body.requestKey, 'requestKey', 36, 36).toLowerCase();
  if (requestKey && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestKey)) {
    throw invalid('requestKey', 'Mã yêu cầu không hợp lệ.');
  }
  object(body.contact, ['name', 'phone', 'address', 'houseType', 'hasPets'], ['area', 'rooms', 'floors', 'region']);
  const quantity = number(body.quantity, 'quantity', 0.01, 100000);
  if (Math.abs(quantity * 100 - Math.round(quantity * 100)) > 0.000001) throw invalid('quantity', 'Số lượng có tối đa hai chữ số thập phân.');
  if (typeof body.contact.hasPets !== 'boolean') throw invalid('contact.hasPets', 'Vui lòng xác nhận thông tin vật nuôi.');
  const contact = {
    name: text(body.contact.name, 'contact.name', 2, 100), phone: phone(body.contact.phone),
    address: text(body.contact.address, 'contact.address', 5, 2000),
    houseType: enumValue(body.contact.houseType, 'contact.houseType', ['can-ho', 'nha-pho', 'biet-thu', 'van-phong', 'phong-tro']),
    hasPets: body.contact.hasPets,
    ...(body.contact.region === undefined ? {} : { region: text(body.contact.region, 'contact.region', 2, 180) }),
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
  if (!parts || !Number.isFinite(scheduled)
    || calendar.getUTCFullYear() !== Number(parts[1]) || calendar.getUTCMonth() + 1 !== Number(parts[2])
    || calendar.getUTCDate() !== Number(parts[3]) || calendar.getUTCHours() !== Number(parts[4])
    || calendar.getUTCMinutes() !== Number(parts[5]) || calendar.getUTCSeconds() !== Number(parts[6])) {
    throw invalid('scheduledAt', 'Chọn thời gian thực hiện trong tương lai, có múi giờ.');
  }
  return {
    ...(requestKey ? { requestKey } : {}),
    ...(body.expectedUnitPrice === undefined ? {} : { expectedUnitPrice: confirmedPrice(body.expectedUnitPrice, 'expectedUnitPrice') }),
    serviceId: id(body.serviceId, 'serviceId'), quantity, contact,
    scheduledAt: new Date(scheduled).toISOString(), specialRequest: text(body.specialRequest, 'specialRequest', 0, 2000),
  };
}

function adminBookingQuery(url) {
  const allowed = ['page', 'limit', 'status', 'decisionState', 'branchId', 'from', 'to', 'reason'];
  for (const name of url.searchParams.keys()) {
    if (!allowed.includes(name)) throw invalid(name, 'Tham số đơn dịch vụ không được hỗ trợ.');
  }
  for (const name of allowed) if (url.searchParams.getAll(name).length > 1) throw invalid(name, `Không được lặp tham số ${name}.`);
  const parsedPage = pagination(url);
  const status = url.searchParams.get('status');
  if (status) enumValue(status, 'status', ['pending', 'confirmed', 'in_progress', 'completed', 'cancelled']);
  const decisionState = url.searchParams.get('decisionState');
  if (decisionState) enumValue(decisionState, 'decisionState', [
    'LEGACY', 'AUTO_CONFIRMED', 'NEEDS_DISPATCH', 'NEEDS_ADMIN', 'ADMIN_CONFIRMED', 'ADMIN_REJECTED', 'ADMIN_CANCELLED',
  ]);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (from && to && from > to) throw invalid('to', 'Ngày kết thúc phải từ ngày bắt đầu trở đi.');
  return {
    page: parsedPage.page,
    limit: url.searchParams.has('limit') ? parsedPage.limit : 50,
    status: status?.toUpperCase(),
    decisionState,
    branchId: url.searchParams.has('branchId') ? id(url.searchParams.get('branchId'), 'branchId') : undefined,
    fromUtc: reportDateBoundary(from, 'from'),
    toUtc: reportDateBoundary(to, 'to', true),
    reason: url.searchParams.has('reason') ? text(url.searchParams.get('reason'), 'reason', 1, 120) : undefined,
  };
}

function adminMutationInput(body) {
  object(body, ['action', 'reason'], ['branchId', 'employeeId', 'scheduledAt', 'durationMinutes', 'name', 'address', 'phone', 'region', 'specialRequest', 'approve']);
  const action = enumValue(body.action, 'action', ['assign', 'confirm', 'needs-dispatch', 'needs-admin', 'set-branch', 'update', 'reschedule', 'reject', 'cancel', 'resolve-cancellation']);
  const input = { action, reason: text(body.reason, 'reason', 3, 1000) };
  if (body.branchId !== undefined) input.branchId = id(body.branchId, 'branchId');
  if (body.employeeId !== undefined) input.employeeId = id(body.employeeId, 'employeeId');
  if (body.scheduledAt !== undefined) {
    const scheduledAt = text(body.scheduledAt, 'scheduledAt', 20, 40);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/i.test(scheduledAt)
      || !Number.isFinite(Date.parse(scheduledAt))) throw invalid('scheduledAt', 'Lịch phải hợp lệ và có múi giờ.');
    input.scheduledAt = new Date(scheduledAt).toISOString();
  }
  if (body.durationMinutes !== undefined) {
    const duration = number(body.durationMinutes, 'durationMinutes', 1, 2147483647);
    if (!Number.isInteger(duration)) throw invalid('durationMinutes', 'Thời lượng phải là số nguyên.');
    input.durationMinutes = duration;
  }
  if (['assign', 'confirm'].includes(action) && !input.employeeId) throw invalid('employeeId', 'Cần chọn nhân viên để xác nhận phân công.');
  if (action === 'set-branch' && !input.branchId) throw invalid('branchId', 'Cần chọn chi nhánh.');
  if (action === 'reschedule' && !input.scheduledAt) throw invalid('scheduledAt', 'Cần cung cấp lịch mới.');
  if (body.name !== undefined) input.name = text(body.name, 'name', 1, 120);
  if (body.address !== undefined) input.address = text(body.address, 'address', 5, 2000);
  if (body.phone !== undefined) input.phone = phone(body.phone);
  if (body.region !== undefined) input.region = text(body.region, 'region', 0, 160);
  if (body.specialRequest !== undefined) input.specialRequest = text(body.specialRequest, 'specialRequest', 0, 2000);
  if (action === 'update' && !['name', 'address', 'phone', 'region', 'specialRequest'].some((field) => input[field] !== undefined)) {
    throw invalid('body', 'Cần cung cấp thông tin muốn cập nhật.');
  }
  if (action === 'resolve-cancellation') {
    if (typeof body.approve !== 'boolean') throw invalid('approve', 'Quyết định hủy phải là true hoặc false.');
    input.approve = body.approve;
  }
  return input;
}

export function createProductInput(body) {
  object(body, ['requestKey', 'items', 'contact'], ['paymentMethod']);
  const requestKey = text(body.requestKey, 'requestKey', 36, 36).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestKey)) {
    throw invalid('requestKey', 'Mã yêu cầu không hợp lệ.');
  }
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) throw invalid('items', 'Đơn cần từ 1 đến 50 sản phẩm.');
  const seen = new Set();
  const items = body.items.map((item, index) => {
    object(item, ['productId', 'quantity'], ['expectedUnitPrice']);
    const productId = id(item.productId, `items.${index}.productId`);
    const quantity = number(item.quantity, `items.${index}.quantity`, 1, 999);
    if (!Number.isInteger(quantity)) throw invalid(`items.${index}.quantity`, 'Số lượng phải là số nguyên.');
    if (seen.has(productId)) throw invalid('items', 'Không được lặp sản phẩm trong đơn.');
    seen.add(productId);
    return { productId, quantity, ...(item.expectedUnitPrice === undefined ? {} : { expectedUnitPrice: confirmedPrice(item.expectedUnitPrice, `items.${index}.expectedUnitPrice`) }) };
  });
  object(body.contact, ['name', 'phone'], ['address', 'note']);
  const contact = {
    name: text(body.contact.name, 'contact.name', 2, 100),
    phone: phone(body.contact.phone),
    ...(body.contact.address === undefined ? {} : { address: text(body.contact.address, 'contact.address', 5, 2000) }),
    ...(body.contact.note === undefined ? {} : { note: text(body.contact.note, 'contact.note', 0, 1000) }),
  };
  return { requestKey, items, contact, ...(body.paymentMethod === undefined ? {} : { paymentMethod: enumValue(body.paymentMethod, 'paymentMethod', ['cash', 'transfer']) }) };
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
      if (order.items.some((item) => item.expectedUnitPrice === undefined)) {
        throw new HttpError(400, 'PRICE_CONFIRMATION_REQUIRED', 'Cần xem giá hiện tại và xác nhận yêu cầu mua mới.');
      }
      reservation = await request('catalog', '/internal/v1/product-reservations', {
        method: 'POST',
        body: { operationKey, customerId: order.customerId, items: order.items.map((item) => ({ productId: item.productId, quantity: item.quantity, expectedUnitPrice: item.expectedUnitPrice })) },
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
      { method: 'GET', path: '/api/v1/admin/orders', auth: 'admin', handler: async ({ url }) =>
        reply(await repository.listAdmin(adminBookingQuery(url))) },
      { method: 'GET', path: '/api/v1/admin/orders/:id', auth: 'admin', handler: async ({ params }) => {
        const order = await repository.getAdmin(id(params.id));
        if (!order) throw new HttpError(404, 'ORDER_NOT_FOUND', 'Không tìm thấy đơn dịch vụ.');
        return reply(order);
      } },
      { method: 'GET', path: '/api/v1/admin/orders/:id/options', auth: 'admin', handler: async ({ params, url }) => {
        for (const name of url.searchParams.keys()) {
          if (!['scheduledAt', 'durationMinutes'].includes(name)) throw invalid(name, 'Tham số lựa chọn điều phối không được hỗ trợ.');
        }
        const scheduledAt = url.searchParams.get('scheduledAt');
        const durationText = url.searchParams.get('durationMinutes');
        if (url.searchParams.getAll('scheduledAt').length > 1 || url.searchParams.getAll('durationMinutes').length > 1) {
          throw invalid('options', 'Thông tin lịch điều phối không hợp lệ.');
        }
        let durationMinutes;
        if (durationText !== null) {
          if (!/^[1-9]\d*$/.test(durationText)) throw invalid('durationMinutes', 'Thời lượng phải là số nguyên.');
          durationMinutes = number(Number(durationText), 'durationMinutes', 1, 2147483647);
          if (!Number.isInteger(durationMinutes)) throw invalid('durationMinutes', 'Thời lượng phải là số nguyên.');
        }
        if (scheduledAt !== null && (!scheduledAt.trim() || !Number.isFinite(Date.parse(scheduledAt)))) {
          throw invalid('scheduledAt', 'Thời điểm thực hiện không hợp lệ.');
        }
        const options = await repository.getAdminOptions(id(params.id), { scheduledAt, durationMinutes });
        if (!options) throw new HttpError(404, 'ORDER_NOT_FOUND', 'Không tìm thấy đơn dịch vụ.');
        return reply(options);
      } },
      { method: 'POST', path: '/api/v1/admin/orders/:id/decisions', auth: 'admin', handler: async ({ principal, params, body }) =>
        reply(await repository.mutateAdmin(id(params.id), id(principal.sub, 'userId'), adminMutationInput(body))) },
      { method: 'GET', path: '/api/v1/admin/reports/service-orders', auth: 'admin', handler: async ({ url }) => {
        const from = url.searchParams.get('from');
        const to = url.searchParams.get('to');
        if (url.searchParams.getAll('from').length > 1 || url.searchParams.getAll('to').length > 1
          || url.searchParams.getAll('status').length > 1) throw invalid('query', 'Không được lặp tham số báo cáo.');
        if (from && to && from > to) throw invalid('to', 'Ngày kết thúc phải từ ngày bắt đầu trở đi.');
        const status = url.searchParams.get('status');
        if (status) enumValue(status, 'status', ['pending', 'confirmed', 'in_progress', 'completed', 'cancelled']);
        return reply(await repository.serviceOrderReport({
          from, to, status,
          fromUtc: reportDateBoundary(from, 'from'),
          toUtc: reportDateBoundary(to, 'to', true),
        }));
      } },
      { method: 'GET', path: '/internal/v1/staff/users/:userId/jobs', auth: 'internal', callers: ['staff'], handler: async ({ params, url }) => {
        const userId = id(params.userId, 'userId');
        const employee = await request('staff', `/internal/v1/users/${userId}/employee`);
        const result = await repository.listStaffJobs(employee.employeeId, staffJobQuery(url));
        return reply({ ...result, items: result.items.map((order) => staffJobDto(order, order.jobStatus)) });
      } },
      { method: 'GET', path: '/internal/v1/staff/users/:userId/jobs/:id', auth: 'internal', callers: ['staff'], handler: async ({ params }) => {
        const userId = id(params.userId, 'userId');
        const bookingId = id(params.id);
        const assignment = await request('staff', `/internal/v1/users/${userId}/bookings/${bookingId}/assignment`);
        if (!assignmentStatuses[assignment.status]) throw new HttpError(503, 'UNSUPPORTED_ASSIGNMENT_STATUS', 'Trạng thái phân công chưa được hỗ trợ.');
        const order = await repository.getById(bookingId);
        if (!order) throw new HttpError(404, 'ORDER_NOT_FOUND', 'Không tìm thấy đơn dịch vụ.');
        return reply(staffJobDto(order, assignmentStatuses[assignment.status]));
      } },
      { method: 'POST', path: '/internal/v1/staff/users/:userId/jobs/:id/transitions', auth: 'internal', callers: ['staff'], handler: async ({ params, body }) => {
        object(body, ['operationId', 'assignmentId', 'employeeId', 'nextStatus']);
        const nextStatus = enumValue(body.nextStatus, 'nextStatus', ['accepted', 'in_progress', 'done']);
        const operationId = text(body.operationId, 'operationId', 36, 36).toLowerCase();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) {
          throw invalid('operationId', 'Mã thao tác không hợp lệ.');
        }
        return reply(await repository.applyStaffTransition({
          operationId, assignmentId: id(body.assignmentId, 'assignmentId'),
          employeeId: id(body.employeeId, 'employeeId'), bookingId: id(params.id), nextStatus,
        }));
      } },
      { method: 'GET', path: '/api/v1/orders', auth: 'customer', handler: async ({ principal, url }) => {
        const result = await repository.list(principal.sub, customerOrderQuery(url));
        return reply({ ...result, items: await Promise.all(result.items.map((order) => enrich(order))) });
      } },
      { method: 'GET', path: '/api/v1/orders/:id', auth: 'customer', handler: async ({ principal, params }) => reply(await get(principal.sub, id(params.id))) },
      { method: 'POST', path: '/api/v1/orders', auth: 'customer', handler: async ({ principal, body }) => {
        const input = createInput(body);
        if (input.requestKey && repository.getByRequestKey) {
          const existing = await repository.getByRequestKey(principal.sub, input);
          if (existing) return reply(existing);
        }
        // Replays must return the owned existing booking even after its proposed
        // start time. Only a new booking requires a future schedule.
        validateCustomerStart(input.scheduledAt);
        if (input.expectedUnitPrice === undefined) throw invalid('expectedUnitPrice', 'Vui lòng xem đơn giá và xác nhận lại trước khi đặt lịch.');
        const service = await request('catalog', `/internal/v1/services/${input.serviceId}`);
        if (!service || String(service.id) !== input.serviceId || !['active', 'inactive'].includes(service.status)
          || !Number.isFinite(service.price) || service.price < 0
          || !Number.isFinite(service.minQuantity) || service.minQuantity < 0.01 || service.minQuantity > 100000
          || Math.abs(service.minQuantity * 100 - Math.round(service.minQuantity * 100)) > 0.000001
          || typeof service.name !== 'string' || !service.name || typeof service.unit !== 'string' || !service.unit) {
          throw new HttpError(503, 'INVALID_CATALOG_DATA', 'Dữ liệu dịch vụ chưa sẵn sàng để đặt lịch.');
        }
        if (service.minutesPerUnit !== undefined && (!Number.isFinite(service.minutesPerUnit)
          || !Number.isInteger(service.minutesPerUnit) || service.minutesPerUnit <= 0)) service.minutesPerUnit = undefined;
        if (service.baseMinutes !== undefined && (!Number.isSafeInteger(service.baseMinutes) || service.baseMinutes < 0)) service.baseMinutes = undefined;
        if (input.quantity < service.minQuantity) throw invalid('quantity', 'Số lượng nhỏ hơn mức tối thiểu của dịch vụ.');
        if (Math.round(input.expectedUnitPrice * 100) !== Math.round(service.price * 100)) {
          throw new HttpError(409, 'PRICE_CHANGED', 'Đơn giá dịch vụ đã thay đổi. Vui lòng tải giá mới, xem lại và xác nhận.');
        }
        if (service.group === 've-sinh' && ['phong-tro', 'nha-gia-dinh'].includes(service.cleaningType)) {
          for (const field of ['area', 'rooms', 'floors']) {
            if (input.contact[field] === undefined) throw invalid(`contact.${field}`, 'Vui lòng cung cấp đầy đủ diện tích, số phòng và số tầng.');
          }
        }
        return reply(await repository.create(principal.sub, input, service), 201);
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
      { method: 'GET', path: '/internal/v1/services/:id/completed-bookings', auth: 'internal', callers: ['review'], handler: async ({ params, url }) =>
        reply(await repository.completedServiceBookings(id(params.id, 'serviceId'), pagination(url))) },
      { method: 'GET', path: '/internal/v1/orders/:id', auth: 'internal', callers: ['payment', 'review'], handler: async ({ params, url }) =>
        reply(await get(id(url.searchParams.get('customerId'), 'customerId'), id(params.id))) },
    ],
  });
}
