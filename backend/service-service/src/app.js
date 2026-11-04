import { createHttpApp, HttpError, reply } from '../../shared/http.js';
import { enumValue, id, invalid, number, object, pagination, text } from '../../shared/validation.js';

const serviceGroups = ['ve-sinh', 'cham-soc', 'bao-duong'];
const cleaningTypes = ['phong-tro', 'nha-gia-dinh', 'khac'];

function reservationInput(body) {
  object(body, ['operationKey', 'customerId', 'items']);
  const operationKey = text(body.operationKey, 'operationKey', 10, 100);
  if (!/^purchase-[1-9]\d{0,18}$/.test(operationKey)) throw invalid('operationKey', 'operationKey không hợp lệ.');
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
  return { operationKey, customerId: id(body.customerId, 'customerId'), items };
}

function operationKey(value) {
  const result = text(value, 'operationKey', 10, 100);
  if (!/^purchase-[1-9]\d{0,18}$/.test(result)) throw invalid('operationKey', 'operationKey không hợp lệ.');
  return result;
}

export function createApp({ repository, config }) {
  const get = async (value) => {
    const service = await repository.get(id(value));
    if (!service) throw new HttpError(404, 'SERVICE_NOT_FOUND', 'Không tìm thấy dịch vụ đang cung cấp.');
    return reply(service);
  };

  return createHttpApp({
    name: 'catalog', config,
    routes: [
      { method: 'GET', path: '/api/v1/catalog/categories', handler: async () => reply(await repository.categories()) },
      { method: 'GET', path: '/api/v1/catalog/services', handler: async ({ url }) => {
        const query = url.searchParams.get('q');
        const category = url.searchParams.get('category');
        const group = url.searchParams.get('group');
        const cleaningType = url.searchParams.get('cleaningType');
        if (cleaningType && group && group !== 've-sinh') throw invalid('cleaningType', 'Loại vệ sinh chỉ thuộc nhóm Vệ sinh.');
        return reply(await repository.list({
          ...pagination(url),
          q: query === null ? '' : text(query, 'q', 0, 120),
          category: category === null ? undefined : id(category, 'category'),
          group: group === null ? undefined : enumValue(group, 'group', serviceGroups),
          cleaningType: cleaningType === null ? undefined : enumValue(cleaningType, 'cleaningType', cleaningTypes),
        }));
      } },
      { method: 'GET', path: '/api/v1/catalog/services/:id', handler: ({ params }) => get(params.id) },
      { method: 'GET', path: '/api/v1/catalog/product-categories', handler: async () => reply(await repository.productCategories()) },
      { method: 'GET', path: '/api/v1/catalog/products', handler: async ({ url }) => {
        const query = url.searchParams.get('q');
        const category = url.searchParams.get('category');
        const serviceId = url.searchParams.get('serviceId');
        return reply(await repository.listProducts({
          ...pagination(url),
          q: query === null ? '' : text(query, 'q', 0, 120),
          category: category === null ? undefined : id(category, 'category'),
          serviceId: serviceId === null ? undefined : id(serviceId, 'serviceId'),
        }));
      } },
      { method: 'GET', path: '/api/v1/catalog/products/:id', handler: async ({ params }) => {
        const product = await repository.getProduct(id(params.id));
        if (!product) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'Không tìm thấy sản phẩm.');
        return reply(product);
      } },
      { method: 'POST', path: '/internal/v1/product-reservations', auth: 'internal', callers: ['order'], handler: async ({ body }) =>
        reply(await repository.reserveProducts(reservationInput(body)), 201) },
      { method: 'GET', path: '/internal/v1/product-reservations/:operationKey', auth: 'internal', callers: ['order'], handler: async ({ params }) => {
        const result = await repository.getReservation(operationKey(params.operationKey));
        if (!result) throw new HttpError(404, 'RESERVATION_NOT_FOUND', 'Không tìm thấy giao dịch giữ tồn kho.');
        return reply(result);
      } },
      { method: 'POST', path: '/internal/v1/product-reservations/:operationKey/release', auth: 'internal', callers: ['order'], handler: async ({ params, body }) => {
        object(body);
        return reply(await repository.releaseReservation(operationKey(params.operationKey)));
      } },
      { method: 'GET', path: '/internal/v1/services/:id', auth: 'internal', callers: ['order'], handler: ({ params }) => get(params.id) },
    ],
  });
}
