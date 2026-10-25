import { readFile, mkdir, open, rename, lstat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { jwtVerify, createRemoteJWKSet } from 'jose'
import { decryptCredentials } from '../src/credential-vault.js'

export function testBase(value = process.env.AUTH_TEST_BASE_URL || 'http://127.0.0.1:4001') {
  const base = new URL(value)
  if (!['http:', 'https:'].includes(base.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('A local test base URL is required')
  return base.origin
}
export async function testAccounts() {
  if (process.env.MYSQL_DATABASE !== 'cleanhome_staff_test') throw new Error('The dedicated test database is required')
  let data
  try {
    if (!process.env.JWT_PRIVATE_KEY_FILE) throw new Error()
    const privateKey = await readFile(process.env.JWT_PRIVATE_KEY_FILE, 'utf8')
    data = decryptCredentials(JSON.parse(await readFile(new URL('../secrets/test-accounts.json', import.meta.url), 'utf8')), privateKey)
  } catch { throw new Error('Encrypted local test credentials are unavailable; values withheld') }
  const expected = { A: ['9109002', '9109004'], B: ['9109101', '9109102'], CUSTOMER: ['9109001', null] }
  if (data?.database !== 'cleanhome_staff_test' || data.version !== 1 || data.accounts?.length !== 3) throw new Error('Test credentials do not match the fixture')
  for (const [label, ids] of Object.entries(expected)) {
    const entries = data.accounts.filter(row => row?.label === label), row = entries[0]
    if (entries.length !== 1 || row.userId !== ids[0] || row.employeeId !== ids[1] || typeof row.phone !== 'string' || typeof row.password !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(row.password)) throw new Error('Test credentials do not match the fixture')
  }
  return data.accounts
}
export async function jsonRequest(base, path, { method = 'GET', body, token } = {}) {
  try {
    const response = await fetch(base + path, { method, redirect: 'error', signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error()
    const reader = response.body.getReader(), chunks = []
    let size = 0
    try {
      for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 1048576) { await reader.cancel(); throw new Error() }; chunks.push(value) }
    } finally { reader.releaseLock() }
    return { status: response.status, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  } catch { throw new Error('HTTP request failed; credential and response contents withheld') }
}
export async function loginAccounts(base, accounts) {
  if (!process.env.JWT_ISSUER || !process.env.JWT_AUDIENCE) throw new Error('JWT issuer and audience are required')
  const key = createRemoteJWKSet(new URL(base + '/.well-known/jwks.json'), { timeoutDuration: 5000 })
  const tokens = {}
  for (const account of accounts) {
    const role = account.label === 'CUSTOMER' ? 'CUSTOMER' : 'EMPLOYEE'
    const result = await jsonRequest(base, '/api/v1/auth/login', { method: 'POST', body: { phone: account.phone, password: account.password, role } })
    if (result.status !== 200 || result.body.tokenType !== 'Bearer' || !Number.isInteger(result.body.expiresIn)) throw new Error('Real Auth login failed; credentials and response withheld')
    let payload
    try { ({ payload } = await jwtVerify(result.body.accessToken, key, { algorithms: ['RS256'], issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, requiredClaims: ['sub', 'exp'] })) } catch { throw new Error('Real Auth token did not verify; token withheld') }
    if (payload.sub !== account.userId || payload.userId !== payload.sub || payload.role !== role || result.body.user?.id !== account.userId) throw new Error('Real Auth identity does not match the fixture')
    tokens[account.label] = result.body.accessToken
  }
  return tokens
}
export async function saveTokens(tokens) {
  const directory = new URL('../secrets/tokens/', import.meta.url)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  for (const [label, token] of Object.entries(tokens)) {
    if (!['A', 'B', 'CUSTOMER'].includes(label)) throw new Error('Unknown token identity')
    const file = new URL(label + '.token', directory)
    try { const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink()) throw new Error('Token path is not a regular file') } catch (error) { if (error.code !== 'ENOENT') throw error }
    const temporary = new URL('.' + label + '-' + randomUUID() + '.tmp', directory)
    const handle = await open(temporary, 'wx', 0o600)
    try { await handle.writeFile(token + '\n', 'utf8'); await handle.sync() }
    finally { await handle.close() }
    await rename(temporary, file)
  }
  return resolve('secrets/tokens')
}
