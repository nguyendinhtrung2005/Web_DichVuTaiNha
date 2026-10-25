import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadConfig, readServiceToken } from '../src/config.js'
import { localBase } from './test-http.js'
try {
  const config = loadConfig()
  if (config.db.database !== 'cleanhome_staff_test') throw new Error('The integration launcher requires the dedicated test database')
  const token = await readServiceToken(config.credential)
  const orderBase = localBase(process.env.ORDER_LIVE_BASE_URL || 'http://127.0.0.1:4003', 'Order')
  const authBase = localBase(process.env.ORDER_LIVE_AUTH_URL || 'http://127.0.0.1:4001', 'Auth')
  const port = process.env.STAFF_INTEGRATION_PORT || '4005'
  if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) throw new Error('Invalid Staff integration port')
  const env = { ...process.env, PORT: port, CORS_ORIGINS: 'http://localhost:3002', JWT_ALGORITHM: 'RS256',
    JWT_ISSUER: process.env.JWT_ISSUER || 'http://localhost:4001', JWT_AUDIENCE: process.env.JWT_AUDIENCE || 'cleanhome-staff-api',
    JWT_JWKS_URL: authBase + '/.well-known/jwks.json', JWT_PUBLIC_KEY: '', JWT_SECRET: '', AUTH_INTROSPECTION_URL: authBase + '/api/v1/auth/introspect',
    ORDER_SERVICE_URL: orderBase, ORDER_SERVICE_TOKEN: token, RECONCILIATION_WORKER_ENABLED: 'false' }
  delete env.NODE_TEST_CONTEXT
  const child = spawn(process.execPath, ['src/server.js'], { cwd: fileURLToPath(new URL('../../staff-service/', import.meta.url)), env, stdio: 'inherit' })
  const stop = () => child.kill()
  process.once('SIGINT', stop); process.once('SIGTERM', stop)
  const code = await new Promise((resolve, reject) => { child.once('error', () => reject(new Error('Could not start the unchanged Staff server'))); child.once('close', resolve) })
  process.exitCode = code || 0
} catch { console.error('Staff integration startup failed; configuration and credentials withheld. Existing Staff files were not modified.'); process.exitCode = 1 }
