import { spawn, execFileSync } from 'node:child_process'
import { generateKeyPairSync, randomBytes, createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { mkdir, readFile, writeFile, open, readdir, copyFile, lstat, symlink, realpath, access } from 'node:fs/promises'
import { dirname, join, resolve, relative } from 'node:path'
import { assert, configFile, loadConfig, mysql, privateDirectory, qaDirectory, repoRoot, stateFile, verifyDatabase, wait, writeJson, within } from './common.mjs'
import { STAFF_QA_NODE_OPTIONS } from './frontend-config.mjs'

const action = process.argv[2] || 'status'
const osNames = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'ComSpec', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'PATHEXT', 'WINDIR']
const plainEnvironment = () => Object.fromEntries(osNames.filter(name => process.env[name]).map(name => [name, process.env[name]]))
const output = value => console.log(JSON.stringify(value))
const exists = async file => { try { await access(file); return true } catch { return false } }
const portOf = origin => Number(new URL(origin).port)
async function free(port) {
  for (const host of ['127.0.0.1', '::1']) {
    try { const server = createServer(); await new Promise((done, reject) => { server.once('error', reject); server.listen({ port, host, exclusive: true }, () => server.close(done)) }) }
    catch (error) { if (!['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)) return false }
  }
  return true
}
async function choosePort(preferred, used) {
  for (let port = preferred; port < preferred + 50; port++) if (!used.has(port) && await free(port)) { used.add(port); return port }
  throw Error('NO_FREE_ISOLATED_QA_PORT')
}
async function restrictPrivateDirectory() {
  await mkdir(privateDirectory, { recursive: true, mode: 0o700 })
  assert(!(await lstat(privateDirectory)).isSymbolicLink(), 'QA_PRIVATE_DIRECTORY_SYMLINK_DENIED')
  if (process.platform === 'win32') {
    const sid = execFileSync('powershell.exe', ['-NoProfile', '-Command', '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'], { windowsHide: true, encoding: 'utf8' }).trim()
    assert(/^S-1-5-\d+(?:-\d+)+$/.test(sid), 'WINDOWS_USER_IDENTITY_REQUIRED')
    execFileSync('icacls.exe', [privateDirectory, '/inheritance:r', '/grant:r', '*' + sid + ':(OI)(CI)F', '*S-1-5-18:(OI)(CI)F'], { windowsHide: true, stdio: 'pipe' })
  }
}
async function newConfiguration() {
  assert(!await exists(configFile), 'EXISTING_QA_CONFIG_MUST_NOT_BE_OVERWRITTEN')
  const used = new Set(), dbPort = await choosePort(3307, used)
  const ports = { auth: await choosePort(4101, used), order: await choosePort(4103, used), staff: await choosePort(4115, used), frontend: await choosePort(3102, used) }
  const paths = { privateDir: privateDirectory, jwtPrivateKeyFile: join(privateDirectory, 'secrets/auth-private.pem'), jwtPublicKeyFile: join(privateDirectory, 'secrets/auth-public.pem'),
    staffSessionKeyFile: join(privateDirectory, 'secrets/staff-session.key'), staffSessionDir: join(privateDirectory, 'sessions'), orderTokenFile: join(privateDirectory, 'secrets/order.token'), credentialsFile: join(privateDirectory, 'credentials.json') }
  for (const directory of ['secrets', 'sessions', 'logs', 'reports', 'mysql/data']) await mkdir(join(privateDirectory, directory), { recursive: true, mode: 0o700 })
  const keys = generateKeyPairSync('rsa', { modulusLength: 3072, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
  await writeFile(paths.jwtPrivateKeyFile, keys.privateKey, { mode: 0o600, flag: 'wx' }); await writeFile(paths.jwtPublicKeyFile, keys.publicKey, { mode: 0o600, flag: 'wx' })
  await writeFile(paths.staffSessionKeyFile, randomBytes(32), { mode: 0o600, flag: 'wx' }); await writeFile(paths.orderTokenFile, randomBytes(48).toString('base64url'), { mode: 0o600, flag: 'wx' })
  const accounts = Object.fromEntries([['A', '9601002', '9602001'], ['B', '9601003', '9602002'], ['MANUAL', '9601004', '9602003'], ['CUSTOMER', '9601001', null]].map(([label, userId, employeeId]) => [label, {
    label, userId, employeeId, branchId: employeeId ? '9603001' : null, phone: 'TEST-STAFF-QA-' + (label === 'CUSTOMER' ? 'C' : label === 'MANUAL' ? 'M' : label), password: randomBytes(32).toString('base64url'), assignmentIds: [],
  }]))
  const db = { host: '127.0.0.1', port: dbPort, database: 'cleanhome_staff_qa_isolated', user: 'staff_qa_app', password: randomBytes(32).toString('base64url') }
  const config = { schemaVersion: 'CLEANHOME_STAFF_QA_V1', kind: 'cleanhome.staff-qa-isolated', version: 1, isolated: true, runId: 'staffqa-' + randomBytes(8).toString('hex'),
    db, database: { host: db.host, port: db.port, name: db.database, user: db.user, password: db.password },
    mysql: { executable: process.env.STAFF_QA_MYSQLD || 'C:/Program Files/MySQL/MySQL Server 9.6/bin/mysqld.exe', dataDir: join(privateDirectory, 'mysql/data'), serverUuid: null, rootPassword: randomBytes(32).toString('base64url'), bootstrapped: false },
    accounts, paths, mode: 'development', incomeDemoEnabled: true, authOrigin: 'http://127.0.0.1:' + ports.auth, orderOrigin: 'http://127.0.0.1:' + ports.order, staffOrigin: 'http://127.0.0.1:' + ports.staff, frontendOrigin: 'http://localhost:' + ports.frontend,
    seed: { month: '2026-11', range: { from: '2026-11-01', to: '2026-11-30' }, counts: { A: { total: 12, done: 5 }, B: { total: 27, done: 10 }, MANUAL: { total: 0, done: 0 } } },
  }
  await access(config.mysql.executable)
  await writeFile(configFile, JSON.stringify(config, null, 2), { mode: 0o600, flag: 'wx' })
  await writeFile(paths.credentialsFile, JSON.stringify({ warning: 'SYNTHETIC ISOLATED QA ONLY. Do not share or commit.', frontendOrigin: config.frontendOrigin,
    accounts: Object.values(accounts).map(({ label, phone, password }) => ({ label, phone, password })) }, null, 2), { mode: 0o600, flag: 'wx' })
  return config
}
async function processIdentity(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null
  if (process.platform !== 'win32') return null
  const command = 'Get-CimInstance Win32_Process -Filter "ProcessId=' + pid + '" | Select-Object ProcessId,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress'
  const raw = execFileSync('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  if (!raw) return null
  const row = JSON.parse(raw)
  if (!row.ExecutablePath || !row.CommandLine || !row.CreationDate) {
    if (!processExists(pid)) return null
    throw Error('QA_PROCESS_IDENTITY_NOT_READABLE')
  }
  return createHash('sha256').update(JSON.stringify(row)).digest('hex')
}
function processExists(pid) {
  try { process.kill(pid, 0); return true }
  catch (error) { if (error.code === 'ESRCH') return false; throw error }
}
async function state(config) {
  if (!await exists(stateFile)) return { kind: config.kind, runId: config.runId, processes: {} }
  const value = JSON.parse(await readFile(stateFile, 'utf8'))
  assert(value.kind === config.kind && value.runId === config.runId, 'QA_PROCESS_STATE_IDENTITY_MISMATCH')
  return value
}
async function alive(record) { return Boolean(record && await processIdentity(record.pid) === record.identity) }
async function launch(config, owned, name, executable, args, env, port, directory = repoRoot) {
  if (owned.processes[name] && await alive(owned.processes[name])) return
  assert(await free(port), 'QA_PORT_OCCUPIED_' + name.toUpperCase())
  const log = await open(join(privateDirectory, 'logs', name + '.log'), 'a', 0o600)
  assert(directory === repoRoot || within(privateDirectory, resolve(directory)), 'QA_PROCESS_WORKDIR_OUTSIDE_RUNTIME')
  const child = spawn(executable, args, { cwd: directory, detached: true, windowsHide: true, stdio: ['ignore', log.fd, log.fd], env })
  await new Promise((done, reject) => { child.once('spawn', done); child.once('error', () => reject(Error('QA_PROCESS_START_FAILED_' + name.toUpperCase()))) })
  child.unref(); await log.close(); await wait(150)
  const identity = await processIdentity(child.pid)
  assert(identity, 'QA_PROCESS_EXITED_' + name.toUpperCase())
  owned.processes[name] = { pid: child.pid, identity, port, startedAt: new Date().toISOString() }
  await writeJson(stateFile, owned)
  output({ service: name, status: 'STARTED', port, pid: child.pid })
}
async function runChild(name, args, env = plainEnvironment(), timeoutMs = 180000, directory = repoRoot) {
  const log = await open(join(privateDirectory, 'logs', name + '.log'), 'a', 0o600)
  const child = spawn(process.execPath, args, { cwd: directory, windowsHide: true, stdio: ['ignore', log.fd, log.fd], env })
  const timer = setTimeout(() => child.kill(), timeoutMs)
  let code
  try { code = await new Promise((done, reject) => { child.once('error', () => reject(Error('QA_CHILD_FAILED_' + name.toUpperCase()))); child.once('exit', done) }) }
  finally { clearTimeout(timer); await log.close() }
  assert(code === 0, 'QA_CHECK_FAILED_' + name.toUpperCase().replaceAll('-', '_'))
  output({ check: name, status: 'PASS' })
}
async function initializeMysql(config) {
  if (await exists(join(config.mysql.dataDir, 'auto.cnf'))) return
  assert((await readdir(config.mysql.dataDir)).length === 0, 'NONEMPTY_UNINITIALIZED_QA_DATADIR')
  const log = await open(join(privateDirectory, 'logs/mysql-initialize.log'), 'a', 0o600)
  const args = ['--no-defaults', '--initialize-insecure', '--basedir=' + dirname(dirname(config.mysql.executable)), '--datadir=' + config.mysql.dataDir, '--console']
  const child = spawn(config.mysql.executable, args, { windowsHide: true, stdio: ['ignore', log.fd, log.fd] })
  const timer = setTimeout(() => child.kill(), 120000)
  try { const code = await new Promise((done, reject) => { child.once('error', () => reject(Error('QA_MYSQL_INITIALIZE_START_FAILED'))); child.once('exit', done) }); assert(code === 0, 'QA_MYSQL_INITIALIZE_FAILED') }
  finally { clearTimeout(timer); await log.close() }
  output({ service: 'mysql', status: 'INITIALIZED_NEW_DATADIR', port: config.db.port })
}
async function databaseReady(config, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    // The generated password recovers an interrupted first bootstrap after ALTER
    // committed but before the config file was advanced. No external credential.
    const passwords = config.mysql.bootstrapped ? [config.mysql.rootPassword] : ['', config.mysql.rootPassword]
    for (const password of passwords) {
      let connection
      try { connection = await mysql.createConnection({ host: config.db.host, port: config.db.port, user: 'root', password, connectTimeout: 2000 }); await verifyDatabase(connection, config); return connection }
      catch { await connection?.end().catch(() => {}) }
    }
    await wait(300)
  }
  throw Error('QA_MYSQL_READINESS_TIMEOUT')
}
async function bootstrapDatabase(config) {
  const connection = await databaseReady(config)
  try {
    const identity = await verifyDatabase(connection, config)
    if (!config.mysql.bootstrapped) {
      await connection.query("ALTER USER 'root'@'localhost' IDENTIFIED BY ?", [config.mysql.rootPassword])
      config.mysql.bootstrapped = true; config.mysql.serverUuid = identity.serverUuid; await writeJson(configFile, config)
    }
    await connection.query('CREATE DATABASE IF NOT EXISTS `cleanhome_staff_qa_isolated` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci')
    await connection.query("CREATE USER IF NOT EXISTS 'staff_qa_app'@'127.0.0.1' IDENTIFIED BY ?", [config.db.password])
    await connection.query("GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, INDEX, REFERENCES ON `cleanhome_staff_qa_isolated`.* TO 'staff_qa_app'@'127.0.0.1'")
    config.mysql.serverUuid = identity.serverUuid; await writeJson(configFile, config)
  } finally { await connection.end() }
  await runChild('seed', [join(qaDirectory, 'seed.mjs'), '--execute'])
}
async function copyPublicTree(source, target, manifest) {
  await mkdir(target, { recursive: true })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), 'QA_PUBLIC_SOURCE_SYMLINK_DENIED')
    const from = join(source, entry.name), to = join(target, entry.name)
    if (entry.isDirectory()) await copyPublicTree(from, to, manifest)
    else if (entry.isFile()) { await copyFile(from, to); manifest.push({ file: relative(repoRoot, from), sha256: createHash('sha256').update(await readFile(from)).digest('hex') }) }
  }
}
async function prepareFrontend(purpose = 'webpack') {
  assert(['webpack', 'maps-build'].includes(purpose), 'QA_FRONTEND_SNAPSHOT_PURPOSE_INVALID')
  const snapshot = join(privateDirectory, 'runtime', purpose, 'frontend'), source = join(repoRoot, 'frontend'), manifest = []
  for (const directory of ['apps/staff/app', 'apps/staff/lib', 'apps/staff/public', 'packages/ui/src', 'packages/core/src']) await copyPublicTree(join(source, directory), join(snapshot, directory), manifest)
  for (const file of ['package.json', 'apps/staff/package.json', 'apps/staff/next.config.mjs', 'apps/staff/tsconfig.json', 'apps/staff/next-env.d.ts', 'apps/staff/postcss.config.mjs', 'packages/ui/package.json', 'packages/core/package.json']) {
    const target = join(snapshot, file); await mkdir(dirname(target), { recursive: true }); await copyFile(join(source, file), target)
    manifest.push({ file: 'frontend/' + file, sha256: createHash('sha256').update(await readFile(join(source, file))).digest('hex') })
  }
  // Webpack does not need the wide Turbopack junction root from local worktree
  // development. Keep QA tracing/watch inputs inside the private source copy.
  const nextConfig = join(snapshot, 'apps/staff/next.config.mjs')
  await copyFile(nextConfig, join(snapshot, 'apps/staff/next.worktree.config.mjs'))
  await copyFile(join(qaDirectory, 'frontend-config.mjs'), join(snapshot, 'apps/staff/qa.frontend.config.mjs'))
  await writeFile(nextConfig, 'import source from "./next.worktree.config.mjs"\nimport { dirname, resolve } from "node:path"\nimport { fileURLToPath } from "node:url"\nimport { staffQaNextConfig } from "./qa.frontend.config.mjs"\nexport default staffQaNextConfig(source, resolve(dirname(fileURLToPath(import.meta.url)), "../.."))\n')
  const dependency = join(snapshot, 'node_modules'), installed = await realpath(join(source, 'node_modules'))
  if (await exists(dependency)) assert(await realpath(dependency) === installed, 'QA_PRIVATE_DEPENDENCY_LINK_MISMATCH')
  else await symlink(installed, dependency, process.platform === 'win32' ? 'junction' : 'dir')
  // Staff map dependencies are installed inside this worktree's UI package.
  // Never install through the existing frontend dependency junction to another checkout.
  const uiInstalled = join(source, 'packages/ui/node_modules'), uiDependency = join(snapshot, 'packages/ui/node_modules')
  if (await exists(uiInstalled)) {
    const target = await realpath(uiInstalled)
    assert(within(repoRoot, target), 'QA_UI_DEPENDENCIES_MUST_STAY_IN_WORKTREE')
    if (await exists(uiDependency)) assert(await realpath(uiDependency) === target, 'QA_UI_DEPENDENCY_LINK_MISMATCH')
    else await symlink(target, uiDependency, process.platform === 'win32' ? 'junction' : 'dir')
  }
  await writeJson(join(privateDirectory, purpose === 'webpack' ? 'frontend-source-manifest.json' : 'maps-build-source-manifest.json'), { source: repoRoot, files: manifest, secretsCopied: false, qaConfigOverride: 'Private Webpack tracing root; no Turbopack or agent file generation' })
  return join(snapshot, 'apps/staff')
}
function frontendEnvironment(config) {
  const aiEnvironment = Object.fromEntries(['STAFF_SUPPORT_AI_ENABLED', 'STAFF_SUPPORT_AI_PROVIDER', 'STAFF_SUPPORT_AI_POLICY_VERSION', 'STAFF_SUPPORT_AI_ENDPOINT', 'STAFF_SUPPORT_AI_API_KEY', 'STAFF_SUPPORT_AI_MODEL', 'STAFF_SUPPORT_AI_MAX_OUTPUT_TOKENS', 'STAFF_SUPPORT_AI_TIMEOUT_MS', 'STAFF_SUPPORT_AI_FREE_TEXT_ENABLED', 'STAFF_SUPPORT_AI_FREE_TEXT_POLICY_VERSION'].filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]]))
  return { ...plainEnvironment(), NODE_ENV: 'development', STAFF_APP_ORIGIN: config.frontendOrigin, AUTH_SERVICE_URL: config.authOrigin, STAFF_SERVICE_URL: config.staffOrigin,
    STAFF_SESSION_DIR: config.paths.staffSessionDir, STAFF_SESSION_KEY_FILE: config.paths.staffSessionKeyFile, STAFF_SESSION_MAX_AGE_SECONDS: '900', STAFF_SESSION_RENEWAL_ENABLED: 'false',
    STAFF_INCOME_DEMO_ENABLED: 'true', STAFF_AREAS_DEMO_ENABLED: 'false', STAFF_ACHIEVEMENTS_DEMO_ENABLED: 'false', STAFF_SUPPORT_DEMO_ENABLED: 'false', STAFF_NOTIFICATIONS_DEMO_ENABLED: 'false',
    STAFF_MAPS_ENABLED: 'true', STAFF_SUPPORT_AI_ENABLED: 'false', ...aiEnvironment, STAFF_SUPPORT_AI_QA_ISOLATED: 'true', STAFF_SUPPORT_AI_QA_MAX_TURNS: '30', STAFF_REVIEWS_API_ENABLED: 'false', NEXT_TELEMETRY_DISABLED: '1', NODE_OPTIONS: STAFF_QA_NODE_OPTIONS }
}
async function launchFrontend(config, owned) {
  const app = await prepareFrontend(), require = createRequire(join(app, 'package.json')), entry = join(dirname(require.resolve('next/package.json')), 'dist/bin/next')
  await launch(config, owned, 'frontend', process.execPath, [entry, 'dev', app, '--webpack', '--hostname', '127.0.0.1', '--port', String(portOf(config.frontendOrigin))], frontendEnvironment(config), portOf(config.frontendOrigin), app)
  await httpReady(config.frontendOrigin, '/dang-nhap')
}
/** Refresh public source and our own frontend only: no database connection or seed. */
async function refreshFrontend() {
  const config = await loadConfig(), owned = await state(config), record = owned.processes.frontend
  if (record) {
    const identity = await processIdentity(record.pid)
    assert(identity === null || identity === record.identity, 'REFUSED_TO_STOP_NON_QA_FRONTEND_PID')
    if (identity !== null) {
      if (process.platform === 'win32') execFileSync('taskkill.exe', ['/PID', String(record.pid), '/T', '/F'], { windowsHide: true, stdio: 'pipe' })
      else process.kill(record.pid, 'SIGTERM')
    }
    delete owned.processes.frontend; await writeJson(stateFile, owned)
  }
  await launchFrontend(config, owned)
  output({ status: 'READY', frontend: config.frontendOrigin, databaseAccessed: false, sourceRefreshed: true })
}
async function checkFrontend() {
  const config = await loadConfig(), app = await prepareFrontend('maps-build'), require = createRequire(join(app, 'package.json'))
  const environment = { ...frontendEnvironment(config), NODE_ENV: 'production' }
  await runChild('maps-webpack-build', [require.resolve('next/dist/bin/next'), 'build', app, '--webpack'], environment, 300000, app)
  await runChild('maps-typecheck', [require.resolve('typescript/bin/tsc'), '--noEmit', '--incremental', 'false'], environment, 180000, app)
  output({ status: 'PASS', checks: ['Webpack build', 'TypeScript'], databaseAccessed: false, sourceManifest: 'maps-build-source-manifest.json' })
}
/** Reload only our Staff process after a Staff-only code change. No schema/seed/bootstrap path. */
async function refreshStaff() {
  const config = await loadConfig(), owned = await state(config), record = owned.processes.staff
  if (record) {
    const identity = await processIdentity(record.pid)
    assert(identity === null || identity === record.identity, 'REFUSED_TO_STOP_NON_QA_STAFF_PID')
    if (identity !== null) {
      if (process.platform === 'win32') execFileSync('taskkill.exe', ['/PID', String(record.pid), '/T', '/F'], { windowsHide: true, stdio: 'pipe' })
      else process.kill(record.pid, 'SIGTERM')
    }
    delete owned.processes.staff; await writeJson(stateFile, owned)
  }
  await launch(config, owned, 'staff', process.execPath, [join(qaDirectory, 'service.mjs'), 'staff'], plainEnvironment(), portOf(config.staffOrigin))
  await httpReady(config.staffOrigin, '/health/ready', 'staff-service')
  output({ status: 'READY', staff: config.staffOrigin, schemaInitialized: false, seedExecuted: false })
}
function mysqlArguments(config) {
  return ['--no-defaults', '--basedir=' + dirname(dirname(config.mysql.executable)), '--datadir=' + config.mysql.dataDir, '--bind-address=127.0.0.1', '--port=' + config.db.port, '--default-time-zone=+00:00', '--mysqlx=OFF', '--skip-log-bin', '--secure-file-priv=NULL', '--pid-file=' + join(privateDirectory, 'mysql/mysql.pid'), '--console']
}
/** Resume an existing QA dataset without initialization, grants, migration or seed. */
async function resumeServices() {
  const config = await loadConfig(), owned = await state(config)
  assert(config.mysql.bootstrapped === true && typeof config.mysql.serverUuid === 'string' && await exists(join(config.mysql.dataDir, 'auto.cnf')), 'EXISTING_INITIALIZED_QA_DATASET_REQUIRED')
  await launch(config, owned, 'mysql', config.mysql.executable, mysqlArguments(config), plainEnvironment(), config.db.port)
  const connection = await databaseReady(config)
  try { await verifyDatabase(connection, config) } finally { await connection.end() }
  for (const name of ['auth', 'order', 'staff']) {
    await launch(config, owned, name, process.execPath, [join(qaDirectory, 'service.mjs'), name], plainEnvironment(), portOf(config[name + 'Origin']))
    await httpReady(config[name + 'Origin'], '/health/ready', name + '-service')
  }
  if (!await alive(owned.processes.frontend)) await launchFrontend(config, owned)
  await httpReady(config.frontendOrigin, '/dang-nhap')
  output({ status: 'READY', frontend: config.frontendOrigin, database: config.db.database, databasePort: config.db.port, schemaInitialized: false, seedExecuted: false })
}
async function httpReady(origin, route, service) {
  const deadline = Date.now() + 90000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(origin + route, { signal: AbortSignal.timeout(12000), redirect: 'error' })
      let okay = response.status === 200
      if (service && okay) {
        const body = await response.json()
        okay = body.status === 'ready'
        if (body.service !== undefined) okay = okay && body.service === service
        else {
          const live = await fetch(origin + '/health/live', { signal: AbortSignal.timeout(5000), redirect: 'error' })
          okay = okay && live.status === 200 && (await live.json()).service === service
        }
      }
      await response.body?.cancel().catch(() => {})
      if (okay) return
    }
    catch {}
    await wait(300)
  }
  throw Error('QA_SERVICE_READINESS_TIMEOUT_' + (service || 'FRONTEND').toUpperCase().replaceAll('-', '_'))
}
async function start() {
  await restrictPrivateDirectory()
  let config = await exists(configFile) ? await loadConfig() : await newConfiguration()
  const owned = await state(config)
  await initializeMysql(config)
  await launch(config, owned, 'mysql', config.mysql.executable, mysqlArguments(config), plainEnvironment(), config.db.port)
  await bootstrapDatabase(config); config = await loadConfig()
  for (const name of ['auth', 'order', 'staff']) {
    await launch(config, owned, name, process.execPath, [join(qaDirectory, 'service.mjs'), name], plainEnvironment(), portOf(config[name + 'Origin']))
    await httpReady(config[name + 'Origin'], '/health/ready', name + '-service')
  }
  if (!await alive(owned.processes.frontend)) {
    await launchFrontend(config, owned)
  }
  await httpReady(config.frontendOrigin, '/dang-nhap')
  output({ status: 'READY', isolated: true, database: config.db.database, databasePort: config.db.port, frontend: config.frontendOrigin, auth: config.authOrigin, order: config.orderOrigin, staff: config.staffOrigin, credentialsFile: relative(repoRoot, config.paths.credentialsFile), workerEnabled: false })
}
async function status() {
  if (!await exists(configFile)) { output({ status: 'NOT_INITIALIZED', action: 'Run start.ps1 to create a new isolated QA environment' }); return }
  const config = await loadConfig(), owned = await state(config)
  for (const name of ['mysql', 'auth', 'order', 'staff', 'frontend']) {
    const running = await alive(owned.processes[name]); let healthy = false
    if (running) {
      try {
        if (name === 'mysql') { const connection = await databaseReady(config, 2500); await connection.end(); healthy = true }
        else { const response = await fetch(config[name + 'Origin'] + (name === 'frontend' ? '/dang-nhap' : '/health/ready'), { signal: AbortSignal.timeout(10000) }); healthy = response.status === 200; await response.body?.cancel() }
      } catch {}
    }
    output({ service: name, owned: running, ready: healthy, port: name === 'mysql' ? config.db.port : portOf(config[name + 'Origin']) })
  }
  output({ frontend: config.frontendOrigin, database: config.db.database, databasePort: config.db.port, syntheticQaOnly: true })
}
async function stop() {
  if (!await exists(configFile)) { output({ status: 'NOT_INITIALIZED' }); return }
  const config = await loadConfig(), owned = await state(config)
  for (const name of ['frontend', 'staff', 'order', 'auth', 'mysql']) {
    const record = owned.processes[name]
    if (!record) continue
    const identity = await processIdentity(record.pid)
    if (identity === null) { delete owned.processes[name]; await writeJson(stateFile, owned); continue }
    assert(identity === record.identity, 'REFUSED_TO_STOP_NON_QA_PID_' + name.toUpperCase())
    if (name === 'mysql') {
      const connection = await databaseReady(config, 3000)
      try { await verifyDatabase(connection, config); await connection.query('SHUTDOWN') } finally { await connection.end().catch(() => {}) }
      for (let attempt = 0; attempt < 100 && processExists(record.pid); attempt++) await wait(100)
      assert(!processExists(record.pid), 'QA_MYSQL_SHUTDOWN_INCOMPLETE')
    } else if (process.platform === 'win32') execFileSync('taskkill.exe', ['/PID', String(record.pid), '/T', '/F'], { windowsHide: true, stdio: 'pipe' })
    else process.kill(record.pid, 'SIGTERM')
    delete owned.processes[name]; await writeJson(stateFile, owned); output({ service: name, status: 'STOPPED_OWNED_PROCESS', port: record.port })
  }
}
try {
  assert(['start', 'stop', 'status', 'test', 'refresh-frontend', 'refresh-staff', 'check-frontend', 'resume-services'].includes(action), 'UNKNOWN_QA_ACTION')
  if (action === 'start') await start()
  else if (action === 'stop') await stop()
  else if (action === 'status') await status()
  else if (action === 'refresh-frontend') await refreshFrontend()
  else if (action === 'refresh-staff') await refreshStaff()
  else if (action === 'check-frontend') await checkFrontend()
  else if (action === 'resume-services') await resumeServices()
  else {
    await loadConfig()
    await runChild('http-tests', [join(qaDirectory, 'test.mjs')], { ...plainEnvironment(), RUN_STAFF_ISOLATED_HTTP_QA: 'true' })
    if (!process.argv.includes('--skip-browser')) await runChild('chrome-tests', [join(qaDirectory, 'browser.mjs')], { ...plainEnvironment(), RUN_STAFF_ISOLATED_BROWSER_QA: 'true' }, 300000)
    output({ status: 'PASS', reports: relative(repoRoot, join(privateDirectory, 'reports')), mockedResponses: false })
  }
} catch (error) {
  output({ status: 'BLOCKED', code: /^[A-Z_]+$/.test(error.message || '') ? error.message : /^[A-Z_]+$/.test(error.code || '') ? error.code : 'QA_OPERATION_FAILED_DETAILS_WITHHELD', action })
  process.exitCode = 1
}
