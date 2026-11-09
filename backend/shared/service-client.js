import { HttpError } from './http.js';
import { readSessionCookie, verifyToken } from './auth-tokens.js';

export function createInternalClient(config, caller) {
  return async (target, path, { method = 'GET', body } = {}) => {
    let response;
    try {
      response = await fetch(config.urls[target] + path, {
        method, signal: AbortSignal.timeout(5000), redirect: 'error',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Caller': caller, 'X-Internal-Token': config.tokens[caller] },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const result = await response.json();
      if (!response.ok) {
        if ([400, 401, 403, 404, 409, 422].includes(response.status) && result.error?.code) {
          throw new HttpError(response.status, result.error.code, result.error.message);
        }
        throw new Error('dependency unavailable');
      }
      if (!Object.hasOwn(result, 'data')) throw new Error('invalid dependency response');
      return result.data;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'Dịch vụ phụ thuộc chưa sẵn sàng. Vui lòng thử lại.');
    }
  };
}
export function createAuthenticator(config, caller) {
  const request = createInternalClient(config, caller);
  return async (req, expectedRole = 'customer') => {
    const token = readSessionCookie(req, config.cookieName);
    const jwks = await request('auth', '/api/v1/auth/jwks');
    const claims = verifyToken(token, jwks, config, ['CUSTOMER', 'EMPLOYEE', 'ADMIN']);
    const principal = await request('auth', '/internal/v1/introspect', { method: 'POST', body: { token } });
    const expectedRoles = {
      customer: ['CUSTOMER'],
      staff: ['EMPLOYEE'],
      admin: ['ADMIN'],
      portal: ['EMPLOYEE', 'ADMIN'],
    }[expectedRole];
    if (!expectedRoles || principal.sub !== claims.sub || principal.role !== claims.role || !expectedRoles.includes(principal.role)) {
      throw new HttpError(403, 'ROLE_FORBIDDEN', 'Tài khoản không có quyền truy cập khu vực này.');
    }
    return principal;
  };
}
