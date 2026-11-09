import { createHttpApp, HttpError } from '../../shared/http.js';
import { object, text, phone, email } from '../../shared/validation.js';
import { createAuthenticator } from '../../shared/service-client.js';
export function createApp({ repository, config }) {
  return createHttpApp({ name: 'user', config, authenticate: createAuthenticator(config, 'user'), routes: [
    { method: 'GET', path: '/api/v1/users/me', auth: 'customer', handler: async ({ principal }) => {
      const user = await repository.get(principal.sub);
      if (!user) throw new HttpError(404, 'NOT_FOUND', 'Không tìm thấy hồ sơ.');
      return user;
    } },
    { method: 'PATCH', path: '/api/v1/users/me', auth: 'customer', handler: async ({ principal, body }) => {
      object(body, ['name', 'phone'], ['email']);
      const name = text(body.name, 'name', 2, 100);
      if (!/\p{L}/u.test(name) || /\p{Cc}/u.test(name)) throw new HttpError(400, 'INVALID_INPUT', 'Họ tên không hợp lệ.');
      return repository.update(principal.sub, { name, phone: phone(body.phone), ...(Object.hasOwn(body, 'email') ? { email: email(body.email) } : {}) });
    } },
  ] });
}
