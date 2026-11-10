import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createHttpApp, HttpError, reply } from '../../shared/http.js';
import { object, text, phone, email } from '../../shared/validation.js';
import { hashPassword, verifyPassword, validatePassword } from '../../shared/passwords.js';
import { createSigningKeys, issueToken, verifyToken, readSessionCookie, sessionCookie } from '../../shared/auth-tokens.js';
import { userDto } from '../../shared/user-dto.js';

export function createApp({ repository, config }) {
  const keys = createSigningKeys(config);
  const roleNames = { CUSTOMER: 'customer', EMPLOYEE: 'staff', ADMIN: 'admin' };
  const sessions = new Map(), attempts = new Map();
  const dummy = hashPassword(randomBytes(32).toString('hex'));
  const denied = () => new HttpError(401, 'INVALID_CREDENTIALS', 'Số điện thoại/email hoặc mật khẩu không đúng.');
  function rateLimit(req, identifier = '') {
    const now = Date.now(), windowMs = 15 * 60 * 1000;
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    const keysToCheck = [
      ['ip:' + req.socket.remoteAddress, 100],
      ['account:' + createHash('sha256').update(identifier).digest('hex'), 15],
    ];
    for (const [key, limit] of keysToCheck) {
      const entry = attempts.get(key) || { count: 0, until: now + windowMs };
      if (entry.count >= limit) throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Có quá nhiều lần thử. Vui lòng thử lại sau.');
      entry.count += 1; attempts.set(key, entry);
    }
  }
  function openSession(user, res) {
    const now = Math.floor(Date.now() / 1000);
    for (const [sid, session] of sessions) if (session.expires <= now) sessions.delete(sid);
    if (sessions.size >= 10000) throw new HttpError(503, 'SESSION_CAPACITY', 'Chưa thể tạo phiên mới. Vui lòng thử lại.');
    const sid = randomUUID();
    sessions.set(sid, { userId: String(user.id), role: user.role, expires: now + config.sessionTtl });
    res.setHeader('Set-Cookie', sessionCookie(config, issueToken(keys, config, user.id, sid, now, user.role)));
    return userDto(user);
  }
  async function inspect(token, expectedRole) {
    const claims = verifyToken(token, keys.jwks, config, ['CUSTOMER', 'EMPLOYEE', 'ADMIN']);
    const session = sessions.get(claims.sid);
    if (!session || session.userId !== claims.sub || session.role !== claims.role || session.expires <= Date.now() / 1000) throw new HttpError(401, 'UNAUTHENTICATED', 'Phiên đã hết hạn. Vui lòng đăng nhập lại.');
    const user = await repository.findById(claims.sub);
    if (!user || user.status !== 'ACTIVE' || !roleNames[user.role] || user.role !== claims.role) {
      sessions.delete(claims.sid);
      throw new HttpError(401, 'UNAUTHENTICATED', 'Tài khoản không còn quyền truy cập.');
    }
    const allowed = expectedRole === 'customer' ? user.role === 'CUSTOMER'
      : expectedRole === 'staff' ? user.role === 'EMPLOYEE'
        : expectedRole === 'admin' ? user.role === 'ADMIN'
          : expectedRole === 'portal' ? ['EMPLOYEE', 'ADMIN'].includes(user.role)
            : false;
    if (expectedRole && !allowed) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Tài khoản không có quyền truy cập khu vực này.');
    return { sub: claims.sub, role: user.role, user: userDto(user) };
  }
  return createHttpApp({ name: 'auth', config, authenticate: async (req, expectedRole) => inspect(readSessionCookie(req, config.cookieName), expectedRole), routes: [
    { method: 'GET', path: '/api/v1/auth/jwks', handler: () => keys.jwks },
    { method: 'POST', path: '/internal/v1/introspect', auth: 'internal', callers: ['user', 'catalog', 'order', 'staff', 'payment', 'review', 'gateway'], handler: async ({ body }) => {
      object(body, ['token']); return inspect(text(body.token, 'token', 1, 8192));
    } },
    { method: 'POST', path: '/api/v1/auth/register', origins: ['customer'], handler: async ({ req, res, body }) => {
      object(body, ['name', 'phone', 'password'], ['email']);
      const name = text(body.name, 'name', 2, 100);
      if (!/\p{L}/u.test(name) || /\p{Cc}/u.test(name)) throw new HttpError(400, 'INVALID_INPUT', 'Họ tên không hợp lệ.');
      const normalizedPhone = phone(body.phone), normalizedEmail = email(body.email);
      const password = validatePassword(body.password);
      rateLimit(req, normalizedPhone);
      const user = await repository.create({ name, phone: normalizedPhone, email: normalizedEmail, passwordHash: await hashPassword(password) });
      return reply(openSession(user, res), 201);
    } },
    { method: 'POST', path: '/api/v1/auth/login', origins: ['customer'], handler: async ({ req, res, body }) => {
      object(body, ['identifier', 'password']);
      const raw = text(body.identifier, 'identifier', 1, 254);
      const identifier = raw.includes('@') ? email(raw) : phone(raw);
      const password = validatePassword(body.password, 1);
      rateLimit(req, identifier);
      const user = await repository.findByIdentifier(identifier);
      const matches = await verifyPassword(password, user?.password_hash || await dummy);
      if (!matches || !user || user.status !== 'ACTIVE' || user.role !== 'CUSTOMER') throw denied();
      return openSession(user, res);
    } },
    { method: 'POST', path: '/api/v1/portal-auth/login', origins: ['staff', 'admin'], handler: async ({ req, res, body }) => {
      object(body, ['identifier', 'password', 'role']);
      const expectedRole = body.role === 'staff' ? 'EMPLOYEE' : body.role === 'admin' ? 'ADMIN' : null;
      if (!expectedRole) throw denied();
      const raw = text(body.identifier, 'identifier', 1, 254);
      const identifier = raw.includes('@') ? email(raw) : phone(raw);
      const password = validatePassword(body.password, 1);
      rateLimit(req, identifier);
      const user = await repository.findByIdentifier(identifier);
      const matches = await verifyPassword(password, user?.password_hash || await dummy);
      if (!matches || !user || user.status !== 'ACTIVE' || user.role !== expectedRole) throw denied();
      return openSession(user, res);
    } },
    { method: 'GET', path: '/api/v1/auth/session', auth: 'customer', handler: ({ principal }) => principal.user },
    { method: 'GET', path: '/api/v1/portal-auth/session', auth: 'portal', handler: ({ principal }) => principal.user },
    { method: 'POST', path: '/api/v1/auth/logout', handler: ({ req, res, body }) => {
      object(body, []);
      try { const claims = verifyToken(readSessionCookie(req, config.cookieName), keys.jwks, config); sessions.delete(claims.sid); } catch (error) { if (!(error instanceof HttpError)) throw error; }
      res.setHeader('Set-Cookie', sessionCookie(config, '', 0));
      return { loggedOut: true };
    } },
  ] });
}
