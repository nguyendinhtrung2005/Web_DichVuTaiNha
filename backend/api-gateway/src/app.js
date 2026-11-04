import { createHttpApp, HttpError } from '../../shared/http.js';
export function createApp({ config }) {
  const declarations = [
    ['POST', '/auth/register', 'auth'], ['POST', '/auth/login', 'auth'], ['POST', '/auth/logout', 'auth'],
    ['GET', '/auth/session', 'auth'], ['GET', '/auth/jwks', 'auth'],
    ['GET', '/users/me', 'user'], ['PATCH', '/users/me', 'user'],
    ['GET', '/catalog/categories', 'catalog'], ['GET', '/catalog/services', 'catalog'], ['GET', '/catalog/services/:id', 'catalog'],
    ['GET', '/catalog/product-categories', 'catalog'], ['GET', '/catalog/products', 'catalog'], ['GET', '/catalog/products/:id', 'catalog'],
    ['GET', '/orders', 'order'], ['POST', '/orders', 'order'], ['GET', '/orders/:id', 'order'],
    ['POST', '/orders/:id/cancellation-requests', 'order'],
    ['GET', '/product-orders', 'order'], ['POST', '/product-orders', 'order'], ['GET', '/product-orders/:id', 'order'],
    ['POST', '/product-orders/:id/retry', 'order'],
    ['GET', '/payments', 'payment'], ['POST', '/orders/:id/payment-simulation', 'payment'],
    ['GET', '/reviews', 'review'], ['POST', '/orders/:id/reviews', 'review'],
  ];
  return createHttpApp({ name: 'gateway', config, routes: declarations.map(([method, path, target]) => ({
    method, path: '/api/v1' + path,
    handler: async ({ req, res, body }) => {
      try {
        const response = await fetch(config.urls[target] + req.url, {
          method, redirect: 'error', signal: AbortSignal.timeout(10000),
          headers: { 'Content-Type': 'application/json', ...(req.headers.origin ? { Origin: req.headers.origin } : {}), ...(req.headers.cookie ? { Cookie: req.headers.cookie } : {}) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const payload = await response.json();
        const cookies = response.headers.getSetCookie();
        res.writeHead(response.status, { 'Content-Type': 'application/json; charset=utf-8', ...(cookies.length ? { 'Set-Cookie': cookies } : {}) });
        res.end(JSON.stringify(payload));
      } catch {
        throw new HttpError(503, 'UPSTREAM_UNAVAILABLE', 'API chưa sẵn sàng. Vui lòng thử lại.');
      }
    },
  })) });
}
