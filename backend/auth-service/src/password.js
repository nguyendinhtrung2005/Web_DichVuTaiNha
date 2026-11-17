import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const OPTIONS = Object.freeze({ N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 });
const PREFIX = '$scrypt$v=1$N=131072,r=8,p=1$';
const FORMAT = /^\$scrypt\$v=1\$N=131072,r=8,p=1\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/;
let dummyHashPromise;

function hasPasswordLength(password, minimum) {
  if (typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 512) return false;
  const count = Array.from(password).length;
  return count >= minimum && count <= 128;
}

export function passwordIsAcceptable(password) {
  return hasPasswordLength(password, 16);
}

function parseHash(storedHash) {
  if (typeof storedHash !== 'string') return null;
  const match = FORMAT.exec(storedHash);
  if (!match) return null;
  const salt = Buffer.from(match[1], 'base64url');
  const expected = Buffer.from(match[2], 'base64url');
  if (salt.length !== 16 || expected.length !== 32
    || salt.toString('base64url') !== match[1] || expected.toString('base64url') !== match[2]) return null;
  return { salt, expected };
}

export function isSupportedPasswordHash(storedHash) {
  return parseHash(storedHash) !== null;
}

export async function hashPassword(password) {
  if (!passwordIsAcceptable(password)) throw new Error('PASSWORD_POLICY_NOT_MET');
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 32, OPTIONS);
  try {
    return `${PREFIX}${salt.toString('base64url')}$${derived.toString('base64url')}`;
  } finally {
    derived.fill(0);
  }
}

export async function getDummyHash() {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword(randomBytes(32).toString('base64url')).catch(() => {
      dummyHashPromise = undefined;
      throw new Error('PASSWORD_HASH_UNAVAILABLE');
    });
  }
  return dummyHashPromise;
}

export async function verifyPassword(password, storedHash) {
  if (!hasPasswordLength(password, 1)) return false;
  const parsed = parseHash(storedHash);
  // Unsupported/seed hashes take the same expensive path as an unknown account.
  const { salt, expected } = parsed ?? parseHash(await getDummyHash());
  const actual = await scrypt(password, salt, expected.length, OPTIONS);
  try {
    return timingSafeEqual(actual, expected) && parsed !== null;
  } finally {
    actual.fill(0);
  }
}
