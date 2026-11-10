import test from 'node:test';
import assert from 'node:assert/strict';
import { sign, randomBytes } from 'node:crypto';
import { createSigningKeys, issueToken, readSessionCookie, sessionCookie, verifyToken } from '../shared/auth-tokens.js';
import { createHttpApp, listen, closeServer, HttpError, requireInternal } from '../shared/http.js';
import { email, id, object, phone, pagination } from '../shared/validation.js';

const config = { origin: 'http://localhost:3001', issuer: 'customer-security-test', audience: 'customer-security-browser', sessionTtl: 60, cookieName: 'cleanhome_customer_session', secureCookies: false, production: false, tokens: { order: randomBytes(32).toString('hex'), payment: randomBytes(32).toString('hex') } };
const keys = createSigningKeys(config);
const now = Math.floor(Date.now() / 1000);
const claims = { sub: '12', role: 'CUSTOMER', sid: 'test-session-id', iss: config.issuer, aud: config.audience, iat: now, exp: now + config.sessionTtl };
function rawToken(patch = {}, headerPatch = {}, signingKeys = keys) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT', kid: keys.kid, ...headerPatch })}.${encode({ ...claims, ...patch })}`;
  return `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), signingKeys.privateKey).toString('base64url')}`;
}
const unauthorized = (fn) => assert.throws(fn, (error) => error instanceof HttpError && error.status === 401);

test('RS256 accepts correctly signed claims and never emits private keys in JWKS', () => {
  const token = issueToken(keys, config, '12', 'test-session-id');
  const result = verifyToken(token, keys.jwks, config);
  assert.equal(result.sub, '12');
  assert.equal(result.role, 'CUSTOMER');
  assert.ok(!('d' in keys.jwks.keys[0]) && !('p' in keys.jwks.keys[0]), 'JWKS must contain public material only.');
});

test('role tokens require an explicit audience for portal roles', () => {
  const token = issueToken(keys, config, '18', 'staff-session-id', now, 'EMPLOYEE');
  unauthorized(() => verifyToken(token, keys.jwks, config));
  assert.equal(verifyToken(token, keys.jwks, config, ['EMPLOYEE']).role, 'EMPLOYEE');
  unauthorized(() => verifyToken(token, keys.jwks, config, ['ADMIN']));
});

for (const [name, patch] of [
  ['issuer', { iss: 'untrusted-issuer' }],
  ['audience', { aud: 'other-app' }],
  ['role', { role: 'ADMIN' }],
  ['subject', { sub: 'customer-controlled' }],
  ['expired', { iat: now - 120, exp: now - 60 }],
  ['future issue time', { iat: now + 120, exp: now + 180 }],
  ['overlong lifetime', { exp: now + config.sessionTtl + 60 }],
]) test(`RS256 rejects a valid signature with invalid ${name}`, () => unauthorized(() => verifyToken(rawToken(patch), keys.jwks, config)));

test('RS256 rejects algorithm confusion, unknown keys, and tampered signatures', () => {
  unauthorized(() => verifyToken(rawToken({}, { alg: 'HS256' }), keys.jwks, config));
  unauthorized(() => verifyToken(rawToken({}, { alg: 'none' }), keys.jwks, config));
  unauthorized(() => verifyToken(rawToken({}, { kid: 'unknown-key' }), keys.jwks, config));
  const otherKeys = createSigningKeys(config);
  unauthorized(() => verifyToken(rawToken({}, {}, otherKeys), keys.jwks, config));
  unauthorized(() => verifyToken('a.b.c', keys.jwks, config));
  unauthorized(() => verifyToken('a'.repeat(8193), keys.jwks, config));
});

test('session cookies reject missing, duplicate, empty and oversized values', () => {
  assert.equal(readSessionCookie({ headers: { cookie: 'unrelated=value; cleanhome_customer_session=expected' } }, config.cookieName), 'expected');
  for (const cookie of ['', 'cleanhome_customer_session=', 'cleanhome_customer_session=a; cleanhome_customer_session=b', `cleanhome_customer_session=${'a'.repeat(8193)}`]) {
    unauthorized(() => readSessionCookie({ headers: { cookie } }, config.cookieName));
  }
  const productionCookie = sessionCookie({ ...config, secureCookies: true }, 'opaque-token');
  assert.ok(productionCookie.includes('HttpOnly') && productionCookie.includes('SameSite=Lax') && productionCookie.includes('Secure') && productionCookie.includes('Path=/'));
  assert.ok(sessionCookie(config, '', 0).includes('Max-Age=0'));
  assert.throws(() => createSigningKeys({ ...config, production: true }), /JWT_PRIVATE_KEY_PATH/);
});

test('internal credentials are bound to an allowed caller', () => {
  requireInternal({ headers: { 'x-internal-caller': 'order', 'x-internal-token': config.tokens.order } }, config, ['order']);
  for (const headers of [
    {},
    { 'x-internal-caller': 'payment', 'x-internal-token': config.tokens.order },
    { 'x-internal-caller': 'order', 'x-internal-token': 'short' },
    { 'x-internal-caller': 'payment', 'x-internal-token': config.tokens.payment },
  ]) assert.throws(() => requireInternal({ headers }, config, ['order']), (error) => error.status === 403);
});

test('validation normalizes identifiers and rejects privilege fields and SQL-shaped identifiers', () => {
  assert.equal(phone('+84 391 234 567'), '0391234567');
  assert.equal(email('  Person@EXAMPLE.INVALID '), 'person@example.invalid');
  assert.equal(email(''), null);
  for (const value of ['not-email', 'a@', 'a@localhost']) assert.throws(() => email(value), (error) => error.status === 400);
  for (const value of ['1 OR 1=1', '-1', '0', '9223372036854775808', '1.1']) assert.throws(() => id(value), (error) => error.status === 400);
  assert.throws(() => object({ name: 'Customer', role: 'ADMIN' }, ['name']), (error) => error.status === 400);
  assert.throws(() => object([], []), (error) => error.status === 400);
  for (const query of ['?page=0', '?limit=101', '?page=1.5', '?limit=-1']) assert.throws(() => pagination(new URL(`http://localhost/${query}`)), (error) => error.status === 400);
});

test('HTTP enforces Origin/JSON/body limits and redacts unexpected exceptions', async () => {
  const app = createHttpApp({ name: 'security-test', config, routes: [
    { method: 'POST', path: '/api/v1/echo', handler: ({ body }) => body },
    { method: 'GET', path: '/api/v1/failure', handler: () => { throw new Error('DB_PASSWORD=never-log-this-test-marker SELECT password_hash'); } },
  ] });
  const server = await listen(app, 0);
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    let response = await fetch(`${url}/api/v1/echo`, { method: 'POST', headers: { origin: config.origin, 'Content-Type': 'application/json' }, body: '{' });
    assert.equal(response.status, 400);
    response = await fetch(`${url}/api/v1/echo`, { method: 'POST', headers: { origin: config.origin, 'Content-Type': 'text/plain' }, body: '{}' });
    assert.equal(response.status, 415);
    response = await fetch(`${url}/api/v1/echo`, { method: 'POST', headers: { origin: 'https://evil.invalid', 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
    response = await fetch(`${url}/api/v1/echo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 403);
    response = await fetch(`${url}/api/v1/echo`, { method: 'POST', headers: { origin: config.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'x'.repeat(65536) }) });
    assert.equal(response.status, 413);
    response = await fetch(`${url}/api/v1/echo`, { method: 'OPTIONS', headers: { origin: config.origin, 'access-control-request-method': 'POST' } });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), config.origin);
    response = await fetch(`${url}/api/v1/failure`);
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, 'SERVICE_UNAVAILABLE');
    assert.ok(!/never-log|password_hash|SELECT|stack/.test(JSON.stringify(body)), 'Unknown errors must be redacted.');
    assert.ok(typeof body.requestId === 'string' && body.requestId.length > 0);
  } finally { await closeServer(server); }
});
