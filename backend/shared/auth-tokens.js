import { createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { HttpError } from './http.js';

const unauthorized = () => new HttpError(401, 'UNAUTHENTICATED', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
export function readSessionCookie(req, name) {
  const values = String(req.headers.cookie || '').split(';').map((part) => part.trim()).filter((part) => part.startsWith(name + '='));
  if (values.length !== 1) throw unauthorized();
  const token = values[0].slice(name.length + 1);
  if (!token || token.length > 8192) throw unauthorized();
  return token;
}
export function sessionCookie(config, token, maxAge = config.sessionTtl) {
  return config.cookieName + '=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge + (config.secureCookies ? '; Secure' : '');
}
export function createSigningKeys(config) {
  let privateKey;
  if (config.privateKeyPath) privateKey = createPrivateKey(readFileSync(config.privateKeyPath));
  else {
    if (config.production) throw new Error('Production yêu cầu JWT_PRIVATE_KEY_PATH.');
    privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  }
  if (privateKey.asymmetricKeyType !== 'rsa' || privateKey.asymmetricKeyDetails.modulusLength < 2048) throw new Error('Khóa JWT phải là RSA ít nhất 2048 bit.');
  const publicKey = createPublicKey(privateKey);
  const kid = randomUUID();
  return { privateKey, kid, jwks: { keys: [{ ...publicKey.export({ format: 'jwk' }), use: 'sig', alg: 'RS256', kid }] } };
}
export function issueToken(keys, config, userId, sid, now = Math.floor(Date.now() / 1000)) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = encode({ alg: 'RS256', typ: 'JWT', kid: keys.kid }) + '.' + encode({ sub: String(userId), role: 'CUSTOMER', sid, iss: config.issuer, aud: config.audience, iat: now, exp: now + config.sessionTtl });
  return unsigned + '.' + sign('RSA-SHA256', Buffer.from(unsigned), keys.privateKey).toString('base64url');
}
export function verifyToken(token, jwks, config) {
  try {
    if (typeof token !== 'string' || token.length > 8192) throw unauthorized();
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) throw unauthorized();
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (header.alg !== 'RS256' || header.typ !== 'JWT' || typeof header.kid !== 'string') throw unauthorized();
    const key = jwks.keys.find((candidate) => candidate.kid === header.kid && candidate.kty === 'RSA' && candidate.alg === 'RS256' && candidate.use === 'sig');
    if (!key || !verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), createPublicKey({ key, format: 'jwk' }), Buffer.from(parts[2], 'base64url'))) throw unauthorized();
    const now = Math.floor(Date.now() / 1000);
    if (claims.iss !== config.issuer || claims.aud !== config.audience || claims.role !== 'CUSTOMER' ||
        !/^[1-9]\d{0,18}$/.test(claims.sub) || typeof claims.sid !== 'string' ||
        !Number.isInteger(claims.exp) || claims.exp <= now || !Number.isInteger(claims.iat) ||
        claims.iat > now + 30 || claims.exp <= claims.iat || claims.exp - claims.iat > config.sessionTtl) throw unauthorized();
    return claims;
  } catch { throw unauthorized(); }
}
