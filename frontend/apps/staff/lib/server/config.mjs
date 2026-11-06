import path from 'node:path';

function invalidConfig() {
  throw new Error('STAFF_AUTH_CONFIGURATION_INVALID');
}

function fixedOrigin(value, production = false) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || url.search || url.hash || url.pathname !== '/' || value !== url.origin) invalidConfig();
    if (production && url.protocol !== 'https:'
      && !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)) invalidConfig();
    return url.origin;
  } catch {
    return invalidConfig();
  }
}

function directoryPath(value, cwd) {
  const resolved = path.resolve(cwd, value);
  if (resolved === path.parse(resolved).root
    || resolved.split(path.sep).some(part => /^(?:public|\.next|node_modules|dist)$/i.test(part))) invalidConfig();
  return resolved;
}

function integer(value, fallback, min, max) {
  if (value === undefined || value === '') return fallback;
  if (!/^[1-9]\d*$/.test(String(value))) invalidConfig();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) invalidConfig();
  return parsed;
}

function enabled(value) {
  if (value === undefined || value === '' || value === 'false') return false;
  if (value === 'true') return true;
  return invalidConfig();
}

function optionalAbsoluteAge(value, production) {
  if (!production && value === '0') return 0;
  return integer(value, production ? 28800 : 604800, 60, production ? 28800 : 31_536_000);
}

/** Server-only configuration. No credential is accepted through NEXT_PUBLIC_* variables. */
export function loadStaffAuthConfig(env = process.env, cwd = process.cwd()) {
  const production = env.NODE_ENV === 'production';
  const authUrl = fixedOrigin(env.AUTH_SERVICE_URL || 'http://127.0.0.1:4001');
  const appOrigin = fixedOrigin(env.STAFF_APP_ORIGIN || (production ? '' : 'http://localhost:3002'), production);
  if (production && new URL(authUrl).protocol !== 'https:'
    && !['127.0.0.1', '[::1]', 'localhost'].includes(new URL(authUrl).hostname)) invalidConfig();
  if (production && (!env.STAFF_SESSION_DIR || !env.STAFF_SESSION_KEY_FILE
    || !path.isAbsolute(env.STAFF_SESSION_DIR) || !path.isAbsolute(env.STAFF_SESSION_KEY_FILE))) invalidConfig();
  const sessionDir = directoryPath(env.STAFF_SESSION_DIR || '.auth-data/sessions', cwd);
  const keyFile = directoryPath(env.STAFF_SESSION_KEY_FILE || '.auth-data/session.key', cwd);
  if (keyFile === sessionDir) invalidConfig();
  const renewalEnabled = enabled(env.STAFF_SESSION_RENEWAL_ENABLED);
  const idleTimeoutSeconds = integer(env.STAFF_SESSION_IDLE_SECONDS, production ? 1800 : 604800, 60, production ? 1800 : 2592000);
  const absoluteAgeSeconds = optionalAbsoluteAge(env.STAFF_SESSION_ABSOLUTE_SECONDS, production);
  if (renewalEnabled && production && (new URL(appOrigin).protocol !== 'https:' || new URL(authUrl).protocol !== 'https:')) invalidConfig();
  const bffToken = env.AUTH_SERVICE_BFF_TOKEN || undefined;
  if (renewalEnabled && (typeof bffToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(bffToken))) invalidConfig();
  return Object.freeze({
    authUrl,
    appOrigin,
    secureCookie: new URL(appOrigin).protocol === 'https:',
    cookieName: 'cleanhome_staff_session',
    sessionDir,
    keyFile,
    timeoutMs: integer(env.STAFF_AUTH_TIMEOUT_MS, 8000, 100, 15000),
    maxAgeSeconds: integer(env.STAFF_SESSION_MAX_AGE_SECONDS, 3600, 1, 3600),
    renewalEnabled,
    idleTimeoutSeconds,
    absoluteAgeSeconds,
    refreshBeforeSeconds: integer(env.STAFF_SESSION_REFRESH_BEFORE_SECONDS, 60, 1, 300),
    bffToken,
    production,
  });
}
