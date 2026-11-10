import http from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status; this.code = code; this.fields = fields;
  }
}
export const reply = (data, status = 200, headers = {}) => ({ __reply: true, data, status, headers });
function equalSecret(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || expected.length < 32) return false;
  const left = Buffer.from(actual), right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function requireInternal(req, config, callers = []) {
  const caller = req.headers['x-internal-caller'];
  if (!callers.includes(caller) || !equalSecret(req.headers['x-internal-token'], config.tokens[caller])) {
    throw new HttpError(403, 'INTERNAL_FORBIDDEN', 'Không có quyền gọi API nội bộ.');
  }
}
async function readBody(req) {
  if (!(req.headers['content-type'] || '').toLowerCase().match(/^application\/json(?:;|$)/)) {
    throw new HttpError(415, 'JSON_REQUIRED', 'Yêu cầu phải dùng application/json.');
  }
  const chunks = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 65536) throw new HttpError(413, 'BODY_TOO_LARGE', 'Nội dung yêu cầu quá lớn.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new HttpError(400, 'INVALID_JSON', 'JSON không hợp lệ.'); }
}
function compile(path) {
  const names = [];
  const expression = path.split('/').map((part) => {
    if (part.startsWith(':')) { names.push(part.slice(1)); return '([^/]+)'; }
    return part.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');
  }).join('/');
  return { expression: new RegExp('^' + expression + '/?$'), names };
}
export function createHttpApp({ name, config, routes, authenticate }) {
  const compiled = routes.map((route) => ({ ...route, ...compile(route.path) }));
  const allowedOrigins = config.allowedOrigins || [config.origin];
  const defaultOriginScopes = { customer: ['customer'], staff: ['staff'], admin: ['admin'], portal: ['staff', 'admin'] };
  const routeOrigins = (route) => {
    if (route.auth === 'internal') return [];
    const scopedOrigins = route.origins
      ? route.origins.map((scope) => config.origins?.[scope]).filter(Boolean)
      : defaultOriginScopes[route.auth]?.map((scope) => config.origins?.[scope]).filter(Boolean) || [];
    return scopedOrigins.length ? scopedOrigins : allowedOrigins;
  };
  return async (req, res) => {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Origin');
    const origin = req.headers.origin;
    const send = (status, payload, headers = {}) => {
      if (res.writableEnded) return;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
      res.end(JSON.stringify(payload));
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') {
        if (allowedOrigins.includes(origin)) {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Access-Control-Allow-Credentials', 'true');
        }
        send(200, { data: { service: name, status: 'up' } }); return;
      }
      if (req.method === 'OPTIONS') {
        const requestedMethod = req.headers['access-control-request-method'];
        const route = compiled.find((candidate) => candidate.method === requestedMethod && candidate.expression.test(url.pathname));
        if (!route || !routeOrigins(route).includes(origin)) throw new HttpError(403, 'ORIGIN_FORBIDDEN', 'Nguồn truy cập không được phép.');
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.writeHead(204, {
          'Access-Control-Allow-Methods': `${requestedMethod},OPTIONS`,
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '600',
        }); res.end(); return;
      }
      const route = compiled.find((candidate) => candidate.method === req.method && candidate.expression.test(url.pathname));
      if (!route) throw new HttpError(404, 'NOT_FOUND', 'Không tìm thấy API.');
      const origins = routeOrigins(route);
      if (origin && !origins.includes(origin)) throw new HttpError(403, 'ORIGIN_FORBIDDEN', 'Nguồn truy cập không được phép.');
      if (origins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
      if (route.auth === 'internal') requireInternal(req, config, route.callers);
      if (route.auth !== 'internal' && !['GET', 'HEAD'].includes(req.method) && !origins.includes(origin)) {
        throw new HttpError(403, 'ORIGIN_REQUIRED', 'Nguồn truy cập không hợp lệ.');
      }
      const principal = route.auth && route.auth !== 'internal' ? await authenticate(req, route.auth) : undefined;
      const match = route.expression.exec(url.pathname);
      const params = Object.fromEntries(route.names.map((key, index) => {
        try { return [key, decodeURIComponent(match[index + 1])]; }
        catch { throw new HttpError(400, 'INVALID_PATH', 'Đường dẫn không hợp lệ.'); }
      }));
      const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? await readBody(req) : undefined;
      const result = await route.handler({ req, res, url, params, body, principal, requestId });
      if (res.writableEnded) return;
      if (result?.__reply) send(result.status, { data: result.data }, result.headers);
      else send(200, { data: result ?? null });
    } catch (error) {
      const known = error instanceof HttpError;
      const status = known ? error.status : 503;
      const code = known ? error.code : 'SERVICE_UNAVAILABLE';
      const message = known ? error.message : 'Dịch vụ chưa sẵn sàng. Vui lòng thử lại sau.';
      send(status, { error: { code, message, ...(known && error.fields ? { fields: error.fields } : {}) }, requestId });
      if (!known) process.stderr.write(JSON.stringify({ service: name, requestId, code }) + '\n');
    }
  };
}
export async function listen(handler, port, host = '127.0.0.1') {
  const server = http.createServer(handler);
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.off('error', reject); resolve(); });
  });
  return server;
}
export async function closeServer(server) {
  await new Promise((resolve) => { server.close(resolve); server.closeIdleConnections(); });
}
