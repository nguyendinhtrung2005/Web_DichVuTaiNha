import { createHttpApp, HttpError, reply } from '../../shared/http.js';
import { enumValue, id, object, pagination } from '../../shared/validation.js';
import { createAuthenticator, createInternalClient } from '../../shared/service-client.js';

async function ownedOrders(request, customerId) {
  const orders = new Map();
  for (let page = 1; page <= 100; page += 1) {
    const result = await request('order', `/internal/v1/customers/${customerId}/orders?page=${page}&limit=100`);
    if (!result || !Array.isArray(result.items) || !Number.isInteger(result.total) || result.total < 0 || result.total > 10000
      || result.items.some((order) => String(order.customerId) !== customerId)) {
      throw new HttpError(503, 'INVALID_ORDER_RESPONSE', 'Không thể đọc danh sách đơn dịch vụ.');
    }
    for (const order of result.items) orders.set(String(order.id), order);
    if (page * 100 >= result.total) return [...orders.values()];
    if (!result.items.length) break;
  }
  throw new HttpError(503, 'CUSTOMER_HISTORY_TOO_LARGE', 'Lịch sử đơn chưa thể được xử lý trong một yêu cầu.');
}

export function createApp({ repository, config }) {
  const request = createInternalClient(config, 'payment');
  return createHttpApp({
    name: 'payment', config, authenticate: createAuthenticator(config, 'payment'),
    routes: [
      { method: 'GET', path: '/api/v1/payments', auth: 'customer', handler: async ({ principal, url }) =>
        reply(await repository.list(await ownedOrders(request, principal.sub), pagination(url))) },
      { method: 'POST', path: '/api/v1/orders/:id/payment-simulation', auth: 'customer', handler: async ({ principal, params, body }) => {
        object(body, ['method']);
        const method = enumValue(body.method, 'method', ['cash', 'transfer']);
        const bookingId = id(params.id);
        const order = await request('order', `/internal/v1/orders/${bookingId}?customerId=${principal.sub}`);
        if (!order || String(order.id) !== bookingId || String(order.customerId) !== principal.sub || !Number.isFinite(order.price)) {
          throw new HttpError(503, 'INVALID_ORDER_RESPONSE', 'Không thể xác minh đơn dịch vụ.');
        }
        if (order.status === 'cancelled') throw new HttpError(422, 'ORDER_CANCELLED', 'Đơn đã hủy không thể mô phỏng thanh toán.');
        return reply(await repository.simulate(order, method));
      } },
    ],
  });
}
