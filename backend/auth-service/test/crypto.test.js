import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import test from 'node:test';
import { importPKCS8, jwtVerify, SignJWT } from 'jose';
import { getDummyHash, hashPassword, isSupportedPasswordHash, passwordIsAcceptable, verifyPassword } from '../src/password.js';
import { createTokenIssuer } from '../src/tokens.js';

// These keys are ephemeral unit-test keys. They are never persisted or supplied to a running service.
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKeyPem = pair.privateKey.export({ format: 'pem', type: 'pkcs8' });
const options = Object.freeze({
  issuer: 'https://auth.cleanhome.test', audience: 'cleanhome-staff-api', privateKeyPem, kid: 'unit-ephemeral-rsa',
});
const employee = Object.freeze({ id: '9109002', role: 'EMPLOYEE', status: 'ACTIVE' });
const issuerPromise = createTokenIssuer(options);
const testPassword = 'unit-password-strong-32-characters';
let passwordHashPromise;

function passwordHash() {
  passwordHashPromise ??= hashPassword(testPassword);
  return passwordHashPromise;
}

async function customToken(claims = {}, header = {}, privateKey = privateKeyPem) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: options.issuer, aud: options.audience, sub: employee.id, userId: employee.id,
    role: employee.role, status: 'ACTIVE', active: true, locked: false,
    iat: now, exp: now + 900, jti: 'unit-token-id', ...claims,
  };
  const key = await importPKCS8(privateKey, 'RS256');
  return new SignJWT(payload).setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: options.kid, ...header }).sign(key);
}

test('password provisioning uses 16–128 Unicode characters and at most 512 UTF-8 bytes', () => {
  assert.equal(passwordIsAcceptable('a'.repeat(15)), false);
  assert.equal(passwordIsAcceptable('a'.repeat(16)), true);
  assert.equal(passwordIsAcceptable('a'.repeat(128)), true);
  assert.equal(passwordIsAcceptable('a'.repeat(129)), false);
  assert.equal(passwordIsAcceptable('🧹'.repeat(16)), true);
  assert.equal(passwordIsAcceptable('🧹'.repeat(128)), true);
  assert.equal(passwordIsAcceptable('🧹'.repeat(129)), false);
  assert.equal(passwordIsAcceptable(null), false);
});

test('scrypt stores versioned bounded parameters and a fresh random salt', async () => {
  const first = await passwordHash();
  const second = await hashPassword(testPassword);
  assert.ok(isSupportedPasswordHash(first));
  assert.ok(isSupportedPasswordHash(second));
  assert.ok(first !== second);
  assert.ok(!first.includes(testPassword));
  assert.equal(await verifyPassword(testPassword, first), true);
});

test('password provisioning rejects weak/oversized inputs without including the password in errors', async () => {
  await assert.rejects(hashPassword('short'), { message: 'PASSWORD_POLICY_NOT_MET' });
  await assert.rejects(hashPassword('a'.repeat(129)), { message: 'PASSWORD_POLICY_NOT_MET' });
});

test('verification rejects a wrong password and non-login input', async () => {
  const hash = await passwordHash();
  assert.equal(await verifyPassword('another-password-that-is-wrong', hash), false);
  assert.equal(await verifyPassword('', hash), false);
  assert.equal(await verifyPassword(null, hash), false);
  assert.equal(await verifyPassword('a'.repeat(129), hash), false);
});

test('a seed marker and unsupported scrypt parameters cannot authenticate or force attacker-selected costs', async () => {
  const hash = await passwordHash();
  const malformed = [
    'NOT_A_LOGIN_HASH_SEED_ONLY', '', null, hash.replace('N=131072', 'N=1073741824'),
    hash.replace('r=8', 'r=1'), `${hash}=`, hash.slice(0, -1),
  ];
  for (const value of malformed) assert.equal(isSupportedPasswordHash(value), false);
  assert.equal(await verifyPassword(testPassword, malformed[0]), false);
  assert.equal(await verifyPassword(testPassword, malformed[3]), false);
});

test('dummy password hashes are generated once in-process and use the real scrypt format', async () => {
  const [first, second] = await Promise.all([getDummyHash(), getDummyHash()]);
  assert.ok(first === second);
  assert.equal(isSupportedPasswordHash(first), true);
  assert.equal(await verifyPassword(testPassword, first), false);
});

test('RS256 JWTs contain the canonical account identity and all three supported roles', async () => {
  const issuer = await issuerPromise;
  for (const role of ['CUSTOMER', 'EMPLOYEE', 'ADMIN']) {
    const token = await issuer.issue({ ...employee, role });
    const payload = await issuer.verify(token);
    assert.equal(payload.sub, employee.id);
    assert.equal(payload.userId, employee.id);
    assert.equal(payload.role, role);
    assert.equal(payload.status, 'ACTIVE');
    assert.equal(payload.active, true);
    assert.equal(payload.locked, false);
    assert.equal(payload.exp - payload.iat, 900);
    assert.equal(typeof payload.jti, 'string');
  }
});

test('the public JWKS verifies signatures and never exports private RSA parameters', async () => {
  const issuer = await issuerPromise;
  const [key] = issuer.jwks.keys;
  assert.equal(key.kty, 'RSA');
  assert.equal(key.alg, 'RS256');
  assert.equal(key.use, 'sig');
  assert.equal(key.kid, options.kid);
  assert.equal(Object.keys(key).some((name) => ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'].includes(name)), false);
  assert.ok(issuer.publicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----'));
  assert.ok(!issuer.publicKeyPem.includes('PRIVATE'));
  const token = await issuer.issue(employee);
  const { payload } = await jwtVerify(token, pair.publicKey, {
    algorithms: ['RS256'], issuer: options.issuer, audience: options.audience,
  });
  assert.equal(payload.sub, employee.id);
});

test('issuance refuses locked users, unsupported roles and non-canonical BIGINT subjects', async () => {
  const issuer = await issuerPromise;
  for (const value of [
    { ...employee, status: 'LOCKED' }, { ...employee, role: 'STAFF' },
    { ...employee, id: 9109002 }, { ...employee, id: '09109002' }, { ...employee, id: '0' },
    { ...employee, id: '9223372036854775808' }, { ...employee, id: '9109002x' },
  ]) await assert.rejects(issuer.issue(value), { message: 'INVALID_TOKEN_IDENTITY' });
  const largest = await issuer.verify(await issuer.issue({ ...employee, id: '9223372036854775807' }));
  assert.equal(largest.sub, '9223372036854775807');
});

test('expired JWTs are rejected by actual signature/expiry verification', async () => {
  const issuer = await issuerPromise;
  const expired = await issuer.issue(employee, { nowSeconds: Math.floor(Date.now() / 1000) - 1000 });
  await assert.rejects(issuer.verify(expired), { message: 'INVALID_ACCESS_TOKEN' });
});

test('wrong issuer, audience, key id and signature are rejected', async () => {
  const issuer = await issuerPromise;
  const wrongTokens = [
    await customToken({ iss: 'https://different.cleanhome.test' }),
    await customToken({ aud: 'different-api' }),
    await customToken({}, { kid: 'different-key' }),
    await customToken({}, {}, otherPair.privateKey.export({ type: 'pkcs8', format: 'pem' })),
  ];
  for (const token of wrongTokens) await assert.rejects(issuer.verify(token), { message: 'INVALID_ACCESS_TOKEN' });
});

test('HS256 algorithm confusion and unsigned input are rejected', async () => {
  const issuer = await issuerPromise;
  const token = await new SignJWT({ sub: employee.id }).setProtectedHeader({ alg: 'HS256' }).sign(randomBytes(32));
  await assert.rejects(issuer.verify(token), { message: 'INVALID_ACCESS_TOKEN' });
  await assert.rejects(issuer.verify('header.payload.'), { message: 'INVALID_ACCESS_TOKEN' });
  await assert.rejects(issuer.verify(null), { message: 'INVALID_ACCESS_TOKEN' });
});

test('signed tokens with missing, conflicting or invalid identity/status/time claims are rejected', async () => {
  const issuer = await issuerPromise;
  const now = Math.floor(Date.now() / 1000);
  for (const claims of [
    { sub: '00' }, { userId: '9109101' }, { role: 'UNKNOWN' }, { status: 'LOCKED' },
    { active: 'true' }, { locked: true }, { exp: undefined }, { jti: undefined },
    { iat: now + 100 }, { exp: now + 3600 }, { iat: now + 1, exp: now },
  ]) await assert.rejects(issuer.verify(await customToken(claims)), { message: 'INVALID_ACCESS_TOKEN' });
});

test('invalid config and weak/non-RSA keys fail safely before token issuance', async () => {
  for (const override of [{ issuer: '' }, { audience: '' }, { kid: '../key' }, { ttlSeconds: 0 }]) {
    await assert.rejects(createTokenIssuer({ ...options, ...override }), { message: 'INVALID_JWT_CONFIGURATION' });
  }
  const weak = generateKeyPairSync('rsa', { modulusLength: 1024 });
  const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  for (const value of ['', 'invalid-private-key', weak, ec]) {
    const pem = typeof value === 'string' ? value : value.privateKey.export({ type: 'pkcs8', format: 'pem' });
    await assert.rejects(createTokenIssuer({ ...options, privateKeyPem: pem }), { message: 'INVALID_RSA_PRIVATE_KEY' });
  }
});
