import { randomBytes } from 'node:crypto';

export const serviceNames = ['auth', 'user', 'catalog', 'order', 'staff', 'payment', 'review', 'gateway'];
export const defaultPorts = { gateway: 4000, auth: 4001, user: 4002, catalog: 4003, order: 4004, staff: 4005, payment: 4006, review: 4007 };
export function createConfig(env = process.env, { generateLocalSecrets = false } = {}) {
  const production = env.NODE_ENV === 'production';
  const tokens = {};
  for (const name of serviceNames) {
    const value = env['INTERNAL_' + name.toUpperCase() + '_TOKEN'];
    if (value && value.length >= 32) tokens[name] = value;
    else if (!production && generateLocalSecrets) tokens[name] = randomBytes(32).toString('hex');
    else throw new Error('Thiếu cấu hình INTERNAL_' + name.toUpperCase() + '_TOKEN (ít nhất 32 ký tự).');
  }
  const origin = env.CUSTOMER_ORIGIN || 'http://localhost:3001';
  const origins = {
    customer: origin,
    staff: env.STAFF_ORIGIN || 'http://localhost:3002',
    admin: env.ADMIN_ORIGIN || 'http://localhost:3003',
  };
  const allowedOrigins = [...new Set(Object.values(origins))];
  if (allowedOrigins.some((value) => new URL(value).origin !== value)) {
    throw new Error('CUSTOMER_ORIGIN, STAFF_ORIGIN và ADMIN_ORIGIN phải là origin đầy đủ, không có đường dẫn.');
  }
  return {
    origin, origins, allowedOrigins, tokens, production,
    urls: Object.fromEntries(serviceNames.map((name) => [name, env[name.toUpperCase() + '_URL'] || 'http://127.0.0.1:' + (env[name.toUpperCase() + '_PORT'] || defaultPorts[name])])),
    issuer: env.JWT_ISSUER || 'cleanhome-auth',
    audience: env.JWT_AUDIENCE || 'cleanhome-customer',
    privateKeyPath: env.JWT_PRIVATE_KEY_PATH || undefined,
    cookieName: 'cleanhome_customer_session',
    secureCookies: production || env.COOKIE_SECURE === 'true',
    sessionTtl: 60 * 60,
    defaultBranchId: env.CUSTOMER_DEFAULT_BRANCH_ID || '',
    host: env.API_HOST || '127.0.0.1',
  };
}
