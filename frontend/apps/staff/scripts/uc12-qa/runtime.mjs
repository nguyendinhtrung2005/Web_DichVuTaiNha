import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readFile, link, unlink } from 'node:fs/promises'
import { randomBytes, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { createFaultRelay } from './relay.mjs'

const PORTS = { order: 4403, staff: 4405, frontend: 3302 }
const OS_NAMES = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'ComSpec', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'PATHEXT', 'WINDIR']
const DB_NAMES = ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE']
const id = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n
const sleep = ms => new Promise(done => setTimeout(done, ms))
const fail = code => { throw new Error(code) }
function plainOsEnvironment() {
  return Object.fromEntries(OS_NAMES.filter(key => typeof process.env[key] === 'string').map(key => [key, process.env[key]]))
}
function origin(value) {
  let url
  try { url = new URL(value) } catch { fail('QA_RUNTIME_PUBLIC_AUTH_CONFIGURATION_INVALID') }
  if (!['http:', 'https:'].includes(url.protocol) || value !== url.origin || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password) fail('QA_RUNTIME_PUBLIC_AUTH_CONFIGURATION_INVALID')
  return value
}
async function checkFree(port, host) {
  const server = createServer()
  await new Promise((done, reject) => {
    server.once('error', error => {
      if (host === '::1' && ['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)) done()
      else reject(new Error('QA_RUNTIME_PORT_NOT_FREE_' + port))
    })
    server.listen({ host, port, exclusive: true }, () => server.close(done))
  })
}
async function privateDirectories(directory) {
  const root = path.parse(directory).root
  let current = root
  for (const piece of directory.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, piece)
    try { if ((await lstat(current)).isSymbolicLink()) fail('QA_RUNTIME_PRIVATE_PATH_INVALID') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const stat = await lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink() || process.platform !== 'win32' && (stat.mode & 0o077) !== 0) fail('QA_RUNTIME_PRIVATE_PATH_INVALID')
}
async function validateKey(file) {
  const stat = await lstat(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== 32 || process.platform !== 'win32' && (stat.mode & 0o077) !== 0) fail('QA_RUNTIME_KEY_INVALID')
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
  try {
    const current = await handle.stat()
    if (!current.isFile() || current.ino !== stat.ino || current.dev !== stat.dev || current.size !== 32) fail('QA_RUNTIME_KEY_INVALID')
    const bytes = await handle.readFile()
    try { if (bytes.length !== 32) fail('QA_RUNTIME_KEY_INVALID') } finally { bytes.fill(0) }
  } finally { await handle.close() }
}
async function prepareKey(directory) {
  await privateDirectories(directory)
  const file = path.join(directory, 'session.key')
  try { await validateKey(file); return file } catch (error) { if (error.code !== 'ENOENT') throw error }
  const temporary = path.join(directory, '.session-' + randomUUID() + '.tmp'), bytes = randomBytes(32)
  let created = false
  try {
    const handle = await open(temporary, 'wx', 0o600); created = true
    try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
    try { await link(temporary, file) } catch (error) { if (error.code !== 'EEXIST') throw error }
    await validateKey(file)
  } finally { bytes.fill(0); if (created) await unlink(temporary) }
  return file
}

/**
 * Starts only QA-owned processes on separate ports. Existing applications and
 * their .env files are untouched. Importing this module does not start anything.
 */
export async function startQaRuntime({ repoRoot, artifactDir, manifest, orderEnv, authEnv, readAssignmentIds } = {}) {
  if (typeof repoRoot !== 'string' || !repoRoot || typeof artifactDir !== 'string' || !artifactDir) fail('QA_RUNTIME_PATH_REQUIRED')
  const repository = path.resolve(repoRoot), artifacts = path.resolve(artifactDir)
  const qaRoot = path.join(repository, 'frontend', 'apps', 'staff', '.auth-data', 'qa')
  if (!artifacts.startsWith(qaRoot + path.sep) || artifacts === qaRoot || manifest?.kind !== 'cleanhome.uc12-e2e-qa'
    || manifest.database !== 'cleanhome_staff_test' || !Array.isArray(manifest.fixtures) || manifest.fixtures.length !== 6
    || manifest.fixtures.some((fixture, index) => fixture.code !== 'Q0' + (index + 1) || !id(fixture.bookingId)
      || !Array.isArray(fixture.assignmentIds) || fixture.assignmentIds.length !== 2 || !fixture.assignmentIds.every(id))
    || !Array.isArray(manifest.allowlist?.bookingIds) || manifest.allowlist.bookingIds.length !== 6
    || !Array.isArray(manifest.allowlist?.assignmentIds) || manifest.allowlist.assignmentIds.length !== 12) fail('QA_RUNTIME_CREATED_MANIFEST_REQUIRED')
  const bookingIds = manifest.fixtures.map(fixture => fixture.bookingId), assignmentIds = manifest.fixtures.flatMap(fixture => fixture.assignmentIds)
  if (new Set(bookingIds).size !== 6 || new Set(assignmentIds).size !== 12
    || bookingIds.some(value => !manifest.allowlist.bookingIds.includes(value)) || assignmentIds.some(value => !manifest.allowlist.assignmentIds.includes(value))) fail('QA_RUNTIME_MANIFEST_ALLOWLIST_INVALID')
  if (!orderEnv || orderEnv.MYSQL_DATABASE !== 'cleanhome_staff_test' || !['127.0.0.1', 'localhost'].includes(orderEnv.MYSQL_HOST || '127.0.0.1')
    || String(orderEnv.MYSQL_PORT || '3306') !== '3306' || typeof orderEnv.MYSQL_USER !== 'string' || !orderEnv.MYSQL_USER.trim()) fail('QA_RUNTIME_TEST_DATABASE_REQUIRED')
  if (typeof authEnv?.JWT_ISSUER !== 'string' || typeof authEnv.JWT_AUDIENCE !== 'string' || !authEnv.JWT_AUDIENCE.trim()) fail('QA_RUNTIME_PUBLIC_AUTH_CONFIGURATION_INVALID')
  origin(authEnv.JWT_ISSUER)
  const authBase = origin(authEnv.AUTH_SERVICE_URL || 'http://127.0.0.1:4001')
  const orderDirectory = path.join(repository, 'backend', 'order-service'), staffDirectory = path.join(repository, 'backend', 'staff-service')
  const frontendDirectory = path.join(repository, 'frontend', 'apps', 'staff')
  const buildId = (await readFile(path.join(frontendDirectory, '.next', 'BUILD_ID'), 'utf8')).trim()
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(buildId)) fail('QA_RUNTIME_EXISTING_PRODUCTION_BUILD_REQUIRED')
  const require = createRequire(path.join(frontendDirectory, 'package.json'))
  const nextEntry = path.join(path.dirname(require.resolve('next/package.json')), 'dist', 'bin', 'next')
  const { loadConfig, readServiceToken } = await import(pathToFileURL(path.join(orderDirectory, 'src', 'config.js')).href)
  const resolvedOrder = { ...orderEnv, ...(orderEnv.ORDER_SERVICE_TOKEN_FILE ? { ORDER_SERVICE_TOKEN_FILE: path.resolve(orderDirectory, orderEnv.ORDER_SERVICE_TOKEN_FILE) } : {}) }
  const serviceToken = await readServiceToken(loadConfig(resolvedOrder).credential)
  // QA bootstrap reuses the unchanged Staff runtime, Auth middleware, service,
  // repository and app. Only its listener is restricted to loopback, and the
  // global reconciliation worker is deliberately never started.
  const staffBootstrap = `
import { runtime } from ${JSON.stringify(pathToFileURL(path.join(staffDirectory, 'src', 'runtime.js')).href)};
import { createApp } from ${JSON.stringify(pathToFileURL(path.join(staffDirectory, 'src', 'app.js')).href)};
let instance;
const log = event => process.stdout.write(JSON.stringify({event,port:4405}) + '\\n');
try {
  instance = runtime();
  if (instance.config.worker.enabled) throw new Error('QA_WORKER_MUST_BE_DISABLED');
  await instance.repository.assertSchema();
  const {config,service,authenticate,repository,pool}=instance;
  const app=createApp({service,authenticate,repository,corsOrigins:config.corsOrigins,statusUpdatesConfigured:Boolean(config.order.baseUrl&&config.order.token)});
  const server=app.listen(config.port,'127.0.0.1',()=>log('staff_service_listening'));
  server.headersTimeout=15000;server.requestTimeout=30000;
  server.on('error',async()=>{log('listen_failed');try{await pool.end()}catch{};process.exitCode=1});
  let stopping=false;
  const stop=async()=>{if(stopping)return;stopping=true;const timer=setTimeout(()=>process.exit(1),15000);timer.unref();try{await new Promise(done=>server.close(done));await pool.end()}finally{clearTimeout(timer)}};
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
}catch{log('startup_failed');if(instance)try{await instance.pool.end()}catch{};process.exitCode=1}
`
  const records = [], owned = []
  let orderRelay, staffRelay, closing = false
  const append = row => records.push({ at: new Date().toISOString(), ...row })
  const runtimeOrigin = 'http://localhost:' + PORTS.frontend
  async function stopOwned(process) {
    if (process.child.exitCode !== null || process.child.signalCode !== null) return
    process.child.kill('SIGTERM')
    const until = Date.now() + 5000
    while (Date.now() < until && process.child.exitCode === null && process.child.signalCode === null) await sleep(50)
    if (process.child.exitCode === null && process.child.signalCode === null) {
      process.child.kill('SIGKILL')
      const forcedUntil = Date.now() + 3000
      while (Date.now() < forcedUntil && process.child.exitCode === null && process.child.signalCode === null) await sleep(50)
    }
    if (process.child.exitCode === null && process.child.signalCode === null) fail('QA_RUNTIME_OWNED_PROCESS_DID_NOT_STOP')
    append({ event: 'stopped', name: process.name, pid: process.child.pid, port: process.port })
  }
  async function close() {
    if (closing) return
    closing = true
    const failures = []
    for (const process of [...owned].reverse()) { try { await stopOwned(process) } catch { failures.push(process.name) } }
    for (const relay of [staffRelay, orderRelay]) { try { await relay?.close() } catch { failures.push('relay') } }
    if (failures.length) fail('QA_RUNTIME_CLEANUP_INCOMPLETE')
  }
  function launch(name, directory, args, environment) {
    const child = spawn(process.execPath, args, { cwd: directory, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const entry = { name, child, port: PORTS[name], listening: false, failed: false, stderrBytes: 0 }
    owned.push(entry)
    append({ event: 'spawned', name, pid: child.pid, port: entry.port })
    child.once('error', () => { entry.failed = true })
    child.stderr.on('data', bytes => { entry.stderrBytes += bytes.length })
    let buffered = ''
    child.stdout.on('data', bytes => {
      // Parse only small known service lifecycle events. Never emit raw output.
      buffered = (buffered + bytes.toString('utf8')).slice(-32768)
      const lines = buffered.split('\n'); buffered = lines.pop()
      for (const line of lines) {
        let row
        try { row = JSON.parse(line) } catch { continue }
        if (row?.event === (name === 'order' ? 'order_service_listening' : 'staff_service_listening')) {
          entry.listening = true; append({ event: 'listening', name, pid: child.pid, port: entry.port })
        }
        if (['order_startup_failed', 'startup_failed', 'listen_failed', 'order_listen_failed'].includes(row?.event)) entry.failed = true
      }
    })
    return entry
  }
  async function healthy(process, base, route, expectedService) {
    const deadline = Date.now() + 20000
    while (Date.now() < deadline) {
      if (process.failed || process.child.exitCode !== null || process.child.signalCode !== null) fail('QA_RUNTIME_START_FAILED_' + process.name.toUpperCase())
      if (process.name === 'frontend' || process.listening) {
        try {
          const response = await fetch(base + route, { redirect: 'error', signal: AbortSignal.timeout(Math.min(2000, Math.max(100, deadline - Date.now()))) })
          const ready = response.status === 200 && (expectedService ? (await response.json()).service === expectedService : true)
          if (!expectedService) await response.body?.cancel()
          if (ready) { append({ event: 'healthy', name: process.name, pid: process.child.pid, port: process.port }); return }
        } catch {}
      }
      await sleep(150)
    }
    fail('QA_RUNTIME_HEALTH_TIMEOUT_' + process.name.toUpperCase())
  }
  try {
    // Check both loopback families before starting any process; never stop an
    // existing listener to make room for this run.
    for (const port of Object.values(PORTS)) { await checkFree(port, '127.0.0.1'); await checkFree(port, '::1') }
    const authHealth = await fetch(authBase + '/health/live', { signal: AbortSignal.timeout(5000), redirect: 'error' })
    if (authHealth.status !== 200 || (await authHealth.json()).service !== 'auth-service') fail('QA_RUNTIME_REAL_AUTH_NOT_READY')
    const privateAuth = path.join(artifacts, 'auth'), sessionDir = path.join(privateAuth, 'sessions'), keyFile = await prepareKey(privateAuth)
    await privateDirectories(sessionDir)
    const dbEnvironment = { ...Object.fromEntries(DB_NAMES.filter(name => orderEnv[name] !== undefined).map(name => [name, String(orderEnv[name])])), MYSQL_CONNECTION_LIMIT: '5' }
    const orderProcess = launch('order', orderDirectory, [path.join(orderDirectory, 'src', 'server.js')], {
      ...plainOsEnvironment(), ...dbEnvironment, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(PORTS.order), ORDER_SERVICE_TOKEN: serviceToken,
    })
    await healthy(orderProcess, 'http://127.0.0.1:' + PORTS.order, '/health/live', 'order-service')
    const ready = await fetch('http://127.0.0.1:' + PORTS.order + '/health/ready', { signal: AbortSignal.timeout(5000), redirect: 'error' })
    if (ready.status !== 200) fail('QA_RUNTIME_ORDER_SCHEMA_NOT_READY')
    await ready.body?.cancel()
    orderRelay = await createFaultRelay({ target: 'http://127.0.0.1:' + PORTS.order, name: 'order', bookingIds, assignmentIds })
    const staffProcess = launch('staff', staffDirectory, ['--input-type=module', '--eval', staffBootstrap], {
      ...plainOsEnvironment(), ...dbEnvironment, NODE_ENV: 'production', PORT: String(PORTS.staff), CORS_ORIGINS: runtimeOrigin,
      JWT_ALGORITHM: 'RS256', JWT_ISSUER: authEnv.JWT_ISSUER, JWT_AUDIENCE: authEnv.JWT_AUDIENCE,
      JWT_JWKS_URL: authBase + '/.well-known/jwks.json', AUTH_INTROSPECTION_URL: authBase + '/api/v1/auth/introspect',
      ORDER_SERVICE_URL: orderRelay.origin, ORDER_SERVICE_TOKEN: serviceToken, ORDER_SERVICE_TIMEOUT_MS: '5000', RECONCILIATION_WORKER_ENABLED: 'false',
    })
    await healthy(staffProcess, 'http://127.0.0.1:' + PORTS.staff, '/health/live', 'staff-service')
    const staffReady = await fetch('http://127.0.0.1:' + PORTS.staff + '/health/ready', { signal: AbortSignal.timeout(5000), redirect: 'error' })
    if (staffReady.status !== 200) fail('QA_RUNTIME_STAFF_SCHEMA_NOT_READY')
    await staffReady.body?.cancel()
    staffRelay = await createFaultRelay({ target: 'http://127.0.0.1:' + PORTS.staff, name: 'staff', bookingIds, assignmentIds,
      readAssignmentIds: readAssignmentIds || assignmentIds })
    // Deliberately construct from scratch: no DB credential, service token,
    // private Auth key, NODE_OPTIONS or inherited integration secret enters Next.
    const frontendProcess = launch('frontend', frontendDirectory, [nextEntry, 'start', '-p', String(PORTS.frontend), '-H', '127.0.0.1'], {
      ...plainOsEnvironment(), NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', AUTH_SERVICE_URL: authBase,
      STAFF_SERVICE_URL: staffRelay.origin, STAFF_APP_ORIGIN: runtimeOrigin, STAFF_AUTH_TIMEOUT_MS: '5000', STAFF_API_TIMEOUT_MS: '8000',
      STAFF_STATUS_TIMEOUT_MS: '20000', STAFF_SESSION_MAX_AGE_SECONDS: '3600', STAFF_SESSION_DIR: sessionDir, STAFF_SESSION_KEY_FILE: keyFile,
    })
    await healthy(frontendProcess, 'http://127.0.0.1:' + PORTS.frontend, '/dang-nhap')
    return Object.freeze({ origin: runtimeOrigin, orderRelay, staffRelay,
      processes() { return owned.map(process => ({ name: process.name, pid: process.child.pid, port: process.port,
        alive: process.child.exitCode === null && process.child.signalCode === null, exitCode: process.child.exitCode, stderrBytes: process.stderrBytes })) },
      events() { return structuredClone(records) }, close,
    })
  } catch (error) {
    try { await close() } catch { fail('QA_RUNTIME_START_AND_CLEANUP_FAILED') }
    if (typeof error?.message === 'string' && /^QA_RUNTIME_[A-Z0-9_]+$/.test(error.message)) throw error
    fail('QA_RUNTIME_START_FAILED_CONFIGURATION_WITHHELD')
  }
}
