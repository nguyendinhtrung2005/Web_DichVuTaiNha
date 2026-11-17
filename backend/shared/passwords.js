import { scrypt as derive, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError } from './http.js';
const scrypt = promisify(derive);
let active = 0;
async function deriveKey(password, salt) {
  if (active >= 4) throw new HttpError(429, 'AUTH_BUSY', 'Có nhiều yêu cầu xác thực. Vui lòng thử lại.');
  active += 1;
  try { return await scrypt(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }); }
  finally { active -= 1; }
}
export function validatePassword(value, minimum = 8) {
  if (typeof value !== 'string' || value.length < minimum || value.length > 128 || Buffer.byteLength(value) > 256 || value.includes('\0')) {
    throw new HttpError(400, 'INVALID_INPUT', 'Mật khẩu phải từ ' + minimum + ' đến 128 ký tự.', { password: 'Mật khẩu không hợp lệ.' });
  }
  return value;
}
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt);
  return 'scrypt$32768$8$1$' + salt.toString('base64url') + '$' + key.toString('base64url');
}
export async function verifyPassword(password, encoded) {
  const parts = String(encoded).split('$');
  if (parts.length !== 6 || parts.slice(0, 4).join('$') !== 'scrypt$32768$8$1') return false;
  const salt = Buffer.from(parts[4], 'base64url'), expected = Buffer.from(parts[5], 'base64url');
  if (salt.length !== 16 || expected.length !== 32) return false;
  const actual = await deriveKey(password, salt);
  return timingSafeEqual(actual, expected);
}
