import { constants } from 'node:fs'
import { link, lstat, mkdir, open, unlink } from 'node:fs/promises'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import path from 'node:path'
import { AuthBffError } from './auth-core.mjs'

const MAX_BYTES = 32768
const nextStatus = new Map([['ACCEPTED', 'ASSIGNED'], ['IN_PROGRESS', 'ACCEPTED'], ['DONE', 'IN_PROGRESS']])
const inputFields = ['userId', 'assignmentId', 'orderId', 'assignedAt', 'requestedStatus', 'fromStatus', 'idempotencyKey']
const recordFields = ['version', ...inputFields, 'createdAt']
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const id = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n
const unavailable = () => new AuthBffError(503, 'OPERATION_STORE_UNAVAILABLE', 'Chưa thể lưu hoặc đọc thông tin đối chiếu thao tác. Vui lòng thử lại.', 5)
function exactFields(value, fields) { return object(value) && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key)) }
function instant(value) {
  return value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value)
}
function validInput(value) {
  return inputFields.slice(0, 3).every(key => id(value[key])) && instant(value.assignedAt)
    && nextStatus.get(value.requestedStatus) === value.fromStatus && nextStatus.has(value.requestedStatus)
    && typeof value.idempotencyKey === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(value.idempotencyKey)
}
function canonicalRecord(value) {
  if (!exactFields(value, recordFields) || value.version !== 1 || !validInput(value)
    || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0) throw unavailable()
  return { version: 1, ...Object.fromEntries(inputFields.map(key => [key, value[key]])), createdAt: value.createdAt }
}
function stem(userId, assignmentId, requestedStatus) {
  return createHash('sha256').update(JSON.stringify([userId, assignmentId, requestedStatus])).digest('hex')
}
function recordStem(record) { return stem(record.userId, record.assignmentId, record.requestedStatus) }
function binding(record) { return createHash('sha256').update(JSON.stringify(canonicalRecord(record))).digest('hex') }
function decode(value, length) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw unavailable()
  const data = Buffer.from(value, 'base64url')
  if (data.toString('base64url') !== value || (length !== undefined && data.length !== length)) throw unavailable()
  return data
}
function privateMode(stat) {
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) throw unavailable()
}
async function noSymlinks(target) {
  const absolute = path.resolve(target), root = path.parse(absolute).root
  let current = root
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    try { if ((await lstat(current)).isSymbolicLink()) throw unavailable() }
    catch (error) { if (error.code === 'ENOENT') return; throw error }
  }
}
async function privateFile(target, maxBytes, exactBytes) {
  await noSymlinks(target)
  const before = await lstat(target)
  if (!before.isFile() || before.size > maxBytes || (exactBytes !== undefined && before.size !== exactBytes)) throw unavailable()
  privateMode(before)
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
  try {
    const after = await handle.stat()
    if (!after.isFile() || after.ino !== before.ino || after.dev !== before.dev || after.size > maxBytes) throw unavailable()
    const data = await handle.readFile()
    if (data.length > maxBytes || (exactBytes !== undefined && data.length !== exactBytes)) throw unavailable()
    return data
  } finally { await handle.close() }
}

/** Single-host persistent journal. No record is overwritten, expired, or removed by this store. */
export function createStatusStore({ config, now = Date.now }) {
  if (!config || typeof config.sessionDir !== 'string' || !config.sessionDir || typeof config.keyFile !== 'string' || !config.keyFile || typeof now !== 'function') throw unavailable()
  const sessionDir = path.resolve(config.sessionDir), directory = path.join(sessionDir, 'uc12-operations'), keyFile = path.resolve(config.keyFile)
  if (sessionDir === path.parse(sessionDir).root || directory.split(path.sep).some(part => /^(?:public|\.next|node_modules|dist)$/i.test(part))) throw unavailable()

  async function access(callback) {
    let key
    try {
      await noSymlinks(directory)
      await mkdir(directory, { recursive: true, mode: 0o700 })
      for (const target of [sessionDir, directory]) {
        const stat = await lstat(target)
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw unavailable()
        privateMode(stat)
      }
      key = await privateFile(keyFile, 32, 32)
      return await callback(key)
    } catch { throw unavailable() }
    finally { key?.fill(0) }
  }

  const filename = (name, kind) => path.join(directory, name + (kind === 'context' ? '' : '.' + kind) + '.json')
  const aad = (name, kind) => Buffer.from('cleanhome-staff-uc12:v1:' + name + ':' + kind)
  async function read(name, kind, key) {
    let bytes
    try { bytes = await privateFile(filename(name, kind), MAX_BYTES) }
    catch (error) { if (error.code === 'ENOENT') return null; throw error }
    const envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!exactFields(envelope, ['version', 'iv', 'tag', 'data']) || envelope.version !== 1) throw unavailable()
    const decipher = createDecipheriv('aes-256-gcm', key, decode(envelope.iv, 12))
    decipher.setAAD(aad(name, kind)); decipher.setAuthTag(decode(envelope.tag, 16))
    const plain = Buffer.concat([decipher.update(decode(envelope.data)), decipher.final()])
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain))
  }
  async function syncDirectory() {
    // Windows does not expose a portable Node directory-fsync API. File publication
    // stays atomic; power-loss durability additionally depends on the filesystem.
    if (process.platform === 'win32') return
    const handle = await open(directory, constants.O_RDONLY)
    try { await handle.sync() } finally { await handle.close() }
  }
  async function publish(name, kind, value, key) {
    const existing = await read(name, kind, key)
    if (existing !== null) return { value: existing, created: false }
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(aad(name, kind))
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
    const encoded = JSON.stringify({ version: 1, iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data: encrypted.toString('base64url') })
    if (Buffer.byteLength(encoded) > MAX_BYTES) throw unavailable()
    const temporary = path.join(directory, '.' + name + '.' + kind + '.' + randomBytes(16).toString('hex') + '.tmp')
    let handle, created = false
    try {
      handle = await open(temporary, 'wx', 0o600); created = true
      await handle.writeFile(encoded, 'utf8'); await handle.sync(); await handle.close(); handle = undefined
      try { await link(temporary, filename(name, kind)); await syncDirectory(); return { value, created: true } }
      catch (error) {
        if (error.code !== 'EEXIST') throw error
        const winner = await read(name, kind, key)
        if (winner === null) throw unavailable()
        return { value: winner, created: false }
      }
    } finally {
      await handle?.close()
      if (created) await unlink(temporary)
    }
  }
  function context(value, name) {
    const record = canonicalRecord(value)
    if (recordStem(record) !== name) throw unavailable()
    return record
  }
  function receipt(value, record, expectedStatus) {
    if (value === null) return null
    if (!exactFields(value, ['version', 'recordBinding', 'httpStatus', 'data']) || value.version !== 1
      || value.recordBinding !== binding(record) || value.httpStatus !== expectedStatus || !object(value.data)) throw unavailable()
    return { httpStatus: value.httpStatus, data: value.data }
  }

  return Object.freeze({
    async list(userId, assignmentId) {
      if (!id(userId) || !id(assignmentId)) throw unavailable()
      return access(async key => {
        const result = []
        for (const requestedStatus of nextStatus.keys()) {
          const name = stem(userId, assignmentId, requestedStatus), value = await read(name, 'context', key)
          const confirmed = await read(name, 'confirmed', key), pending = await read(name, 'pending', key)
          if (value === null) { if (confirmed !== null || pending !== null) throw unavailable(); continue }
          const record = context(value, name)
          const success = receipt(confirmed, record, 200), waiting = receipt(pending, record, 202)
          result.push({ record, receipt: success || waiting })
        }
        return result
      })
    },
    async ensure(input) {
      if (!exactFields(input, inputFields) || !validInput(input)) throw unavailable()
      const time = now()
      if (!Number.isSafeInteger(time) || time < 0) throw unavailable()
      const record = canonicalRecord({ version: 1, ...input, createdAt: time }), name = recordStem(record)
      return access(async key => {
        const published = await publish(name, 'context', record, key)
        return { record: context(published.value, name), created: published.created }
      })
    },
    async saveReceipt(value, httpStatus, data) {
      const record = canonicalRecord(value), name = recordStem(record)
      if (![200, 202].includes(httpStatus) || !object(data)) throw unavailable()
      return access(async key => {
        const current = await read(name, 'context', key)
        if (current === null || binding(context(current, name)) !== binding(record)) throw unavailable()
        const kind = httpStatus === 200 ? 'confirmed' : 'pending'
        const published = await publish(name, kind, { version: 1, recordBinding: binding(record), httpStatus, data }, key)
        receipt(published.value, record, httpStatus)
      })
    },
  })
}
