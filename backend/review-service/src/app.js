import { createHttpApp, HttpError, reply } from '../../shared/http.js';
import { id, invalid, number, object, pagination, text } from '../../shared/validation.js';
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
  const request = createInternalClient(config, 'review');
  return createHttpApp({
    name: 'review', config, authenticate: createAuthenticator(config, 'review'),
    routes: [
      { method: 'GET', path: '/api/v1/reviews', auth: 'customer', handler: async ({ principal, url }) =>
        reply(await repository.list(await ownedOrders(request, principal.sub), pagination(url))) },
      { method: 'POST', path: '/api/v1/orders/:id/reviews', auth: 'customer', handler: async ({ principal, params, body }) => {
        object(body, ['rating', 'comment']);
        const rating = number(body.rating, 'rating', 1, 5);
        if (!Number.isInteger(rating)) throw invalid('rating', 'Điểm đánh giá phải là số nguyên từ 1 đến 5.');
        const comment = text(body.comment, 'comment', 0, 2000);
        const bookingId = id(params.id);
        const order = await request('order', `/internal/v1/orders/${bookingId}?customerId=${principal.sub}`);
        if (!order || String(order.id) !== bookingId || String(order.customerId) !== principal.sub) {
          throw new HttpError(503, 'INVALID_ORDER_RESPONSE', 'Không thể xác minh đơn dịch vụ.');
        }
        if (order.status !== 'completed') throw new HttpError(422, 'ORDER_NOT_COMPLETED', 'Chỉ đánh giá được đơn đã hoàn thành.');
        if (!order.staffId) throw new HttpError(422, 'ASSIGNMENT_REQUIRED', 'Đơn chưa có nhân viên được phân công để nhận đánh giá.');
        id(order.staffId, 'staffId');
        return reply(await repository.create(order, { rating, comment }), 201);
      } },
    ],
  });
}
