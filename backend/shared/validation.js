import { HttpError } from './http.js';

export const invalid = (name, message) => new HttpError(400, 'INVALID_INPUT', message, { [name]: message });
export function object(value, required = [], optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('body', 'Nội dung phải là đối tượng JSON.');
  const allowed = new Set([...required, ...optional]);
  for (const name of Object.keys(value)) if (!allowed.has(name)) throw invalid(name, 'Trường không được hỗ trợ: ' + name + '.');
  for (const name of required) if (!Object.hasOwn(value, name)) throw invalid(name, 'Thiếu trường ' + name + '.');
  return value;
}
export function text(value, name, min = 1, max = 255) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw invalid(name, name + ' phải có từ ' + min + ' đến ' + max + ' ký tự hợp lệ.');
  }
  return value.trim();
}
export function id(value, name = 'id') {
  const result = String(value ?? '');
  if (!/^[1-9]\d{0,18}$/.test(result) || BigInt(result) > 9223372036854775807n) throw invalid(name, name + ' không hợp lệ.');
  return result;
}
export function phone(value) {
  const input = text(value, 'phone', 9, 20);
  if (!/^\+?[\d ()-]+$/.test(input)) throw invalid('phone', 'Số điện thoại không hợp lệ.');
  let digits = input.replace(/[ ()+-]/g, '');
  if (digits.startsWith('84')) digits = '0' + digits.slice(2);
  if (!/^(?:0[35789]\d{8}|02\d{9})$/.test(digits)) throw invalid('phone', 'Nhập số điện thoại Việt Nam hợp lệ.');
  return digits;
}
export function email(value) {
  if (value === undefined || value === null || value === '') return null;
  const result = text(value, 'email', 3, 254).toLowerCase();
  if (!/^[a-z0-9.!#$%&'*+/=?^_~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(result)) {
    throw invalid('email', 'Email không hợp lệ.');
  }
  return result;
}
export function number(value, name, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw invalid(name, name + ' không hợp lệ.');
  return value;
}
export function enumValue(value, name, values) {
  if (!values.includes(value)) throw invalid(name, name + ' không hợp lệ.');
  return value;
}
export function pagination(url) {
  const parse = (name, fallback, max) => {
    const raw = url.searchParams.get(name);
    if (raw === null) return fallback;
    if (!/^[1-9]\d*$/.test(raw) || Number(raw) > max) throw invalid(name, name + ' không hợp lệ.');
    return Number(raw);
  };
  return { page: parse('page', 1, 100000), limit: parse('limit', 100, 100) };
}
