import { createPrivateKey, createPublicKey, randomUUID } from 'node:crypto';
import { exportJWK, importPKCS8, importSPKI, jwtVerify, SignJWT } from 'jose';

const ROLES = new Set(['CUSTOMER', 'EMPLOYEE', 'ADMIN']);
const MAX_ID = 9223372036854775807n;

function isId(value) {
  return typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= MAX_ID;
}

function isIssuerConfig(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024 && value.trim() === value;
}

function isActiveIdentity(user) {
  return user && typeof user === 'object' && isId(user.id)
    && ROLES.has(user.role) && user.status === 'ACTIVE';
}

export async function createTokenIssuer({ issuer, audience, privateKeyPem, kid, ttlSeconds = 900 } = {}) {
  if (!isIssuerConfig(issuer) || !isIssuerConfig(audience)
    || typeof kid !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(kid)
    || !Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 3600) {
    throw new Error('INVALID_JWT_CONFIGURATION');
  }
  let signingKey;
  let verifyingKey;
  let publicKeyPem;
  let publicJwk;
  try {
    if (typeof privateKeyPem !== 'string' || privateKeyPem.length > 65536
      || !/^-----BEGIN (?:RSA )?PRIVATE KEY-----\r?\n/.test(privateKeyPem)) throw new Error();
    const key = createPrivateKey({ key: privateKeyPem, format: 'pem' });
    if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048) throw new Error();
    const privatePkcs8 = key.export({ format: 'pem', type: 'pkcs8' });
    publicKeyPem = createPublicKey(key).export({ format: 'pem', type: 'spki' });
    signingKey = await importPKCS8(privatePkcs8, 'RS256');
    verifyingKey = await importSPKI(publicKeyPem, 'RS256');
    publicJwk = await exportJWK(verifyingKey);
  } catch {
    throw new Error('INVALID_RSA_PRIVATE_KEY');
  }
  const jwks = Object.freeze({
    keys: Object.freeze([Object.freeze({ ...publicJwk, kid, alg: 'RS256', use: 'sig', key_ops: Object.freeze(['verify']) })]),
  });

  async function issue(user, { nowSeconds = Math.floor(Date.now() / 1000) } = {}) {
    if (!isActiveIdentity(user) || !Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
      throw new Error('INVALID_TOKEN_IDENTITY');
    }
    return new SignJWT({ userId: user.id, role: user.role, status: 'ACTIVE', active: true, locked: false })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(user.id)
      .setIssuedAt(nowSeconds)
      .setExpirationTime(nowSeconds + ttlSeconds)
      .setJti(randomUUID())
      .sign(signingKey);
  }

  async function verify(token) {
    try {
      if (typeof token !== 'string' || token.length > 8000) throw new Error();
      const { payload, protectedHeader } = await jwtVerify(token, verifyingKey, {
        algorithms: ['RS256'], issuer, audience, clockTolerance: 0, maxTokenAge: ttlSeconds,
        requiredClaims: ['iss', 'aud', 'sub', 'exp', 'iat', 'jti', 'userId', 'role', 'status', 'active', 'locked'],
      });
      if (protectedHeader.kid !== kid || protectedHeader.typ !== 'JWT'
        || !isId(payload.sub) || payload.userId !== payload.sub || !ROLES.has(payload.role)
        || payload.status !== 'ACTIVE' || payload.active !== true || payload.locked !== false
        || typeof payload.jti !== 'string' || payload.jti.length < 1 || payload.jti.length > 128
        || !Number.isSafeInteger(payload.exp) || !Number.isSafeInteger(payload.iat)
        || payload.exp <= payload.iat || payload.exp - payload.iat > ttlSeconds) throw new Error();
      return payload;
    } catch {
      throw new Error('INVALID_ACCESS_TOKEN');
    }
  }

  return Object.freeze({ issue, verify, jwks, publicKeyPem, ttlSeconds });
}
