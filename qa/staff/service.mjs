import './dependencies.mjs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assert, loadConfig, repoRoot } from './common.mjs'

const name = process.argv[2]
assert(['auth', 'order', 'staff'].includes(name), 'UNKNOWN_QA_SERVICE')
let instance
try {
  const config = await loadConfig()
  const env = {
    NODE_ENV: 'development', HOST: '127.0.0.1', MYSQL_HOST: config.db.host, MYSQL_PORT: String(config.db.port),
    MYSQL_USER: config.db.user, MYSQL_PASSWORD: config.db.password, MYSQL_DATABASE: config.db.database, MYSQL_CONNECTION_LIMIT: '4',
    CORS_ORIGINS: config.frontendOrigin, JWT_ISSUER: config.authOrigin, JWT_AUDIENCE: 'cleanhome-staff-qa-isolated', JWT_KEY_ID: config.runId,
    JWT_PRIVATE_KEY_FILE: config.paths.jwtPrivateKeyFile, JWT_ACCESS_TTL_SECONDS: '900', AUTH_REFRESH_ENABLED: 'false',
    JWT_ALGORITHM: 'RS256', JWT_JWKS_URL: config.authOrigin + '/.well-known/jwks.json', AUTH_INTROSPECTION_URL: config.authOrigin + '/api/v1/auth/introspect',
    ORDER_SERVICE_URL: config.orderOrigin, ORDER_SERVICE_TOKEN_FILE: config.paths.orderTokenFile,
    RECONCILIATION_WORKER_ENABLED: 'false', STAFF_INCOME_DEMO_ENABLED: 'true',
    PORT: new URL(config[name + 'Origin']).port,
  }
  if (name === 'staff') { delete env.ORDER_SERVICE_TOKEN_FILE; env.ORDER_SERVICE_TOKEN = (await readFile(config.paths.orderTokenFile, 'utf8')).trim() }
  const directory = join(repoRoot, 'backend', name + '-service', 'src')
  const { runtime } = await import(pathToFileURL(join(directory, 'runtime.js')).href)
  const { createApp } = await import(pathToFileURL(join(directory, 'app.js')).href)
  instance = await runtime(env)
  if (name === 'staff') { assert(!instance.config.worker.enabled, 'QA_WORKER_MUST_REMAIN_DISABLED'); await instance.repository.assertSchema() }
  const app = createApp({ ...instance, corsOrigins: instance.config.corsOrigins, statusUpdatesConfigured: name === 'staff', logger: () => {} })
  const server = app.listen(Number(env.PORT), '127.0.0.1', () => console.log(JSON.stringify({ event: 'qa_service_ready', service: name, port: Number(env.PORT) })))
  server.headersTimeout = 15000; server.requestTimeout = 30000
  server.on('error', async () => { console.error(JSON.stringify({ event: 'qa_listen_failed', service: name })); await instance.pool.end(); process.exitCode = 1 })
  let stopping = false
  const stop = async () => { if (stopping) return; stopping = true; const timer = setTimeout(() => process.exit(1), 15000); timer.unref(); await new Promise(done => server.close(done)); await instance.pool.end(); clearTimeout(timer) }
  process.once('SIGTERM', stop); process.once('SIGINT', stop)
} catch (error) {
  console.error(JSON.stringify({ event: 'qa_service_start_failed', service: name, code: /^[A-Z_]+$/.test(error.code || '') ? error.code : 'CONFIGURATION_OR_SCHEMA_REQUIRED' }))
  if (instance) await instance.pool.end().catch(() => {})
  process.exitCode = 1
}
