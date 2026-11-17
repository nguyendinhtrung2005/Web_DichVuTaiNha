import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createStatusStore } from '../lib/server/status-store.mjs'
import { AuthBffError } from '../lib/server/auth-core.mjs'

// Independent filesystem tests. No HTTP calls, runtime session files, QA rows,
// tokens, or existing application data are read or changed by this suite.
const input = (changes = {}) => ({
  userId: '9109002', assignmentId: '9109133', orderId: '9109131',
  assignedAt: '2026-10-24T00:00:00.000Z', requestedStatus: 'ACCEPTED',
  fromStatus: 'ASSIGNED', idempotencyKey: 'unit-operation-key-01', ...changes,
})
const unavailable = error => error instanceof AuthBffError && error.status === 503 && error.code === 'OPERATION_STORE_UNAVAILABLE'
const stem = value => createHash('sha256').update(JSON.stringify([value.userId, value.assignmentId, value.requestedStatus])).digest('hex')
const receipt = (status = 200, changes = {}) => ({
  assignmentId: '9109133', status: 'ACCEPTED', jobStatus: 'accepted', checkInAt: null, checkOutAt: null,
  transition: { operationId: 'a'.repeat(64), requestedStatus: 'ACCEPTED', synchronization: status === 200 ? 'SYNCHRONIZED' : 'PENDING_ACKNOWLEDGEMENT', replayed: false },
  orderAtTransition: { id: '9109131', status: 'CONFIRMED', asOf: '2026-10-24T00:00:00.000Z' }, ...changes,
})

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cleanhome-staff-status-store-unit-'))
  const config = { sessionDir: path.join(root, 'sessions'), keyFile: path.join(root, 'session.key') }
  await writeFile(config.keyFile, randomBytes(32), { mode: 0o600 })
  const clock = { value: 1792800000000 }
  const create = () => createStatusStore({ config, now: () => clock.value })
  const directory = path.join(config.sessionDir, 'uc12-operations')
  t.after(async () => {
    // The exclusive mkdtemp directory must resolve inside the intended temp
    // directory before removing only this test's own disposable fixture.
    const resolved = path.resolve(root), intended = path.resolve(os.tmpdir()) + path.sep
    assert.equal(resolved.startsWith(intended), true)
    assert.equal(path.basename(resolved).startsWith('cleanhome-staff-status-store-unit-'), true)
    await rm(resolved, { recursive: true, force: true })
  })
  return { root, config, clock, create, directory, store: create(),
    file: (value, kind) => path.join(directory, stem(value) + (kind ? '.' + kind : '') + '.json') }
}

test('a new actor has no operation; read-only listing does not fabricate a receipt', async t => {
  const f = await fixture(t)
  assert.deepEqual(await f.store.list('9109002', '9109133'), [])
  assert.deepEqual(await readdir(f.directory), [])
})

test('an operation is saved before dispatch and survives a fresh store instance', async t => {
  const f = await fixture(t), value = input()
  const first = await f.store.ensure(value)
  assert.equal(first.created, true)
  assert.deepEqual(first.record, { version: 1, ...value, createdAt: f.clock.value })
  f.clock.value += 100000
  assert.deepEqual(await f.create().list(value.userId, value.assignmentId), [{ record: first.record, receipt: null }])
  const retry = await f.create().ensure(value)
  assert.equal(retry.created, false)
  assert.deepEqual(retry.record, first.record)
})

test('a later different key never replaces an existing operation for the same step', async t => {
  const f = await fixture(t), value = input()
  const first = await f.store.ensure(value)
  const fileBefore = await readFile(f.file(value), 'utf8')
  const result = await f.store.ensure(input({ idempotencyKey: 'new-key-must-not-win' }))
  assert.equal(result.created, false)
  assert.deepEqual(result.record, first.record)
  assert.equal(await readFile(f.file(value), 'utf8'), fileBefore)
})

test('generation changes cannot silently replace the original order or assignment timestamp', async t => {
  const f = await fixture(t), value = input()
  const first = await f.store.ensure(value)
  const result = await f.store.ensure(input({ orderId: '9109999', assignedAt: '2027-01-01T00:00:00.000Z' }))
  assert.deepEqual(result.record, first.record)
  assert.equal(result.created, false)
})

test('parallel store instances publish exactly one complete context and preserve its winning key', async t => {
  const f = await fixture(t)
  const results = await Promise.all(Array.from({ length: 24 }, (_, index) => f.create().ensure(input({ idempotencyKey: 'concurrent-operation-' + index }))))
  assert.equal(results.filter(result => result.created).length, 1)
  const winner = results.find(result => result.created).record
  for (const result of results) assert.deepEqual(result.record, winner)
  assert.deepEqual(await f.create().list(winner.userId, winner.assignmentId), [{ record: winner, receipt: null }])
  assert.equal((await readdir(f.directory)).some(name => name.endsWith('.tmp')), false)
})

test('operations are isolated by authenticated user, assignment and requested step', async t => {
  const f = await fixture(t)
  const a = await f.store.ensure(input())
  const b = await f.store.ensure(input({ userId: '9109101', idempotencyKey: 'employee-b-operation' }))
  const other = await f.store.ensure(input({ assignmentId: '9109134', idempotencyKey: 'other-assignment-key' }))
  const next = await f.store.ensure(input({ requestedStatus: 'IN_PROGRESS', fromStatus: 'ACCEPTED', idempotencyKey: 'unit-progress-key' }))
  assert.deepEqual((await f.store.list('9109002', '9109133')).map(entry => entry.record), [a.record, next.record])
  assert.deepEqual(await f.store.list('9109101', '9109133'), [{ record: b.record, receipt: null }])
  assert.deepEqual(await f.store.list('9109002', '9109134'), [{ record: other.record, receipt: null }])
  assert.deepEqual(await f.store.list('9109999', '9109133'), [])
})

test('unknown, pending and confirmed are durable; a late pending response cannot downgrade confirmed', async t => {
  const f = await fixture(t), value = input(), { record } = await f.store.ensure(value)
  assert.equal((await f.store.list(value.userId, value.assignmentId))[0].receipt, null)
  await f.store.saveReceipt(record, 202, receipt(202))
  assert.deepEqual((await f.create().list(value.userId, value.assignmentId))[0].receipt, { httpStatus: 202, data: receipt(202) })
  await f.store.saveReceipt(record, 200, receipt())
  await f.store.saveReceipt(record, 202, receipt(202, { status: 'DONE', jobStatus: 'done' }))
  assert.deepEqual((await f.create().list(value.userId, value.assignmentId))[0].receipt, { httpStatus: 200, data: receipt() })
})

test('concurrent pending and confirmed receipts always retain confirmed proof', async t => {
  const f = await fixture(t), value = input(), { record } = await f.store.ensure(value)
  await Promise.all(Array.from({ length: 12 }, (_, index) => f.create().saveReceipt(record, index % 2 ? 200 : 202, receipt(index % 2 ? 200 : 202))))
  assert.deepEqual((await f.create().list(value.userId, value.assignmentId))[0].receipt, { httpStatus: 200, data: receipt() })
})

test('the first confirmed receipt remains immutable after a replay with a later projection', async t => {
  const f = await fixture(t), value = input(), { record } = await f.store.ensure(value)
  await f.store.saveReceipt(record, 200, receipt())
  const before = await readFile(f.file(value, 'confirmed'), 'utf8')
  await f.store.saveReceipt(record, 200, receipt(200, { status: 'DONE', jobStatus: 'done' }))
  assert.equal(await readFile(f.file(value, 'confirmed'), 'utf8'), before)
  assert.deepEqual((await f.store.list(value.userId, value.assignmentId))[0].receipt.data, receipt())
})

test('ciphertext contains neither operation context nor receipt plaintext', async t => {
  const f = await fixture(t), value = input(), { record } = await f.store.ensure(value)
  await f.store.saveReceipt(record, 200, receipt())
  for (const name of await readdir(f.directory)) {
    const raw = await readFile(path.join(f.directory, name), 'utf8')
    for (const secret of [value.userId, value.assignmentId, value.orderId, value.idempotencyKey, 'requestedStatus', 'SYNCHRONIZED']) assert.equal(raw.includes(secret), false)
    assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ['data', 'iv', 'tag', 'version'])
  }
})

test('nullable assignedAt is preserved without inventing a generation timestamp', async t => {
  const f = await fixture(t), value = input({ assignedAt: null })
  const { record } = await f.store.ensure(value)
  assert.equal(record.assignedAt, null)
  assert.equal((await f.store.list(value.userId, value.assignmentId))[0].record.assignedAt, null)
})

test('request fields, identifiers, timestamps, keys and transition pairing are validated', async t => {
  const f = await fixture(t)
  const invalid = [
    { userId: '0' }, { assignmentId: '01' }, { orderId: 123 }, { assignmentId: '9223372036854775808' },
    { userId: '../escape' }, { idempotencyKey: 'short' }, { idempotencyKey: ' contains-spaces ' },
    { idempotencyKey: 'a'.repeat(129) }, { fromStatus: 'IN_PROGRESS' }, { requestedStatus: 'accepted' },
    { requestedStatus: 'CANCELLED' }, { assignedAt: '2026-02-30T00:00:00.000Z' }, { assignedAt: '2026-10-24' },
    { assignedAt: undefined }, { unknown: true },
  ]
  for (const changes of invalid) await assert.rejects(f.store.ensure(input(changes)), unavailable)
  const missing = input(); delete missing.orderId
  await assert.rejects(f.store.ensure(missing), unavailable)
  await assert.rejects(f.store.ensure(null), unavailable)
  await assert.rejects(f.store.list('0', '9109133'), unavailable)
  await assert.rejects(f.store.list('9109002', '../escape'), unavailable)
})

test('maximum signed BIGINT identifiers are accepted without lossy numeric conversion', async t => {
  const f = await fixture(t), value = input({ userId: '9223372036854775807', assignmentId: '9223372036854775807', orderId: '9223372036854775807' })
  const { record } = await f.store.ensure(value)
  assert.equal(record.assignmentId, value.assignmentId)
  assert.deepEqual(await f.store.list(value.userId, value.assignmentId), [{ record, receipt: null }])
})

test('bad clocks fail before creating a context', async t => {
  const f = await fixture(t)
  for (const time of [-1, NaN, Infinity, 1.1, Number.MAX_SAFE_INTEGER + 1]) {
    const store = createStatusStore({ config: f.config, now: () => time })
    await assert.rejects(store.ensure(input()), unavailable)
  }
  assert.deepEqual(await f.store.list('9109002', '9109133'), [])
})

test('an absent encryption key fails closed and is not generated by the journal', async t => {
  const f = await fixture(t)
  await unlink(f.config.keyFile)
  await assert.rejects(f.store.ensure(input()), unavailable)
  await assert.rejects(readFile(f.config.keyFile), error => error.code === 'ENOENT')
})

test('an invalid key length fails closed without replacing it', async t => {
  const f = await fixture(t), badKey = Buffer.alloc(31)
  await writeFile(f.config.keyFile, badKey)
  await assert.rejects(f.store.ensure(input()), unavailable)
  assert.deepEqual(await readFile(f.config.keyFile), badKey)
})

test('a key change makes existing records unreadable and never overwrites them', async t => {
  const f = await fixture(t), value = input()
  await f.store.ensure(value)
  const before = await readFile(f.file(value))
  await writeFile(f.config.keyFile, randomBytes(32))
  await assert.rejects(f.create().list(value.userId, value.assignmentId), unavailable)
  await assert.rejects(f.create().ensure(value), unavailable)
  assert.deepEqual(await readFile(f.file(value)), before)
})

test('partial or malformed context files block reads and writes rather than resetting', async t => {
  const f = await fixture(t), value = input()
  await f.store.ensure(value)
  const broken = '{"version":1,"iv":'
  await writeFile(f.file(value), broken)
  await assert.rejects(f.store.list(value.userId, value.assignmentId), unavailable)
  await assert.rejects(f.store.ensure(input({ idempotencyKey: 'must-not-replace-key' })), unavailable)
  assert.equal(await readFile(f.file(value), 'utf8'), broken)
})

test('ciphertext authentication rejects a changed tag', async t => {
  const f = await fixture(t), value = input()
  await f.store.ensure(value)
  const envelope = JSON.parse(await readFile(f.file(value), 'utf8'))
  const tag = Buffer.from(envelope.tag, 'base64url'); tag[0] ^= 1
  envelope.tag = tag.toString('base64url')
  await writeFile(f.file(value), JSON.stringify(envelope))
  await assert.rejects(f.store.list(value.userId, value.assignmentId), unavailable)
})

test('encrypted contexts cannot be moved to another actor filename', async t => {
  const f = await fixture(t), value = input(), other = input({ userId: '9109101' })
  await f.store.ensure(value)
  await writeFile(f.file(other), await readFile(f.file(value)), { mode: 0o600 })
  await assert.rejects(f.store.list(other.userId, other.assignmentId), unavailable)
  assert.equal((await f.store.list(value.userId, value.assignmentId)).length, 1)
})

test('pending receipt ciphertext cannot impersonate confirmed proof', async t => {
  const f = await fixture(t), value = input(), { record } = await f.store.ensure(value)
  await f.store.saveReceipt(record, 202, receipt(202))
  await writeFile(f.file(value, 'confirmed'), await readFile(f.file(value, 'pending')), { mode: 0o600 })
  await assert.rejects(f.store.list(value.userId, value.assignmentId), unavailable)
})

test('an orphan receipt is an error and never fabricates its missing context', async t => {
  const f = await fixture(t), value = input(), { record } = await f.store.ensure(value)
  await f.store.saveReceipt(record, 200, receipt())
  await unlink(f.file(value))
  await assert.rejects(f.store.list(value.userId, value.assignmentId), unavailable)
  await assert.rejects(readFile(f.file(value)), error => error.code === 'ENOENT')
})

test('receipt recording requires the exact original context', async t => {
  const f = await fixture(t), value = input(), { record } = await f.store.ensure(value)
  for (const changes of [{ idempotencyKey: 'different-operation-key' }, { createdAt: record.createdAt + 1 }, { orderId: '9109999' }, { assignedAt: null }, { version: 2 }]) {
    await assert.rejects(f.store.saveReceipt({ ...record, ...changes }, 200, receipt()), unavailable)
  }
  await assert.rejects(f.store.saveReceipt(record, 204, receipt()), unavailable)
  await assert.rejects(f.store.saveReceipt(record, 200, null), unavailable)
  await assert.rejects(f.store.saveReceipt(record, 200, []), unavailable)
  assert.equal((await f.store.list(value.userId, value.assignmentId))[0].receipt, null)
})

test('a receipt cannot be saved before its context', async t => {
  const f = await fixture(t), record = { version: 1, ...input(), createdAt: f.clock.value }
  await assert.rejects(f.store.saveReceipt(record, 200, receipt()), unavailable)
  assert.deepEqual(await f.store.list(record.userId, record.assignmentId), [])
})

test('oversized receipt files fail closed and preserve the operation for safe retry', async t => {
  const f = await fixture(t), value = input(), { record } = await f.store.ensure(value)
  await assert.rejects(f.store.saveReceipt(record, 200, { excessive: 'x'.repeat(40000) }), unavailable)
  assert.deepEqual(await f.store.list(value.userId, value.assignmentId), [{ record, receipt: null }])
})

test('oversized existing ciphertext is refused without truncation', async t => {
  const f = await fixture(t), value = input()
  await f.store.ensure(value)
  const excessive = 'x'.repeat(32769)
  await writeFile(f.file(value), excessive)
  await assert.rejects(f.store.list(value.userId, value.assignmentId), unavailable)
  assert.equal((await readFile(f.file(value), 'utf8')).length, excessive.length)
})

test('an interrupted unpublished temporary file cannot become an operation or a receipt', async t => {
  const f = await fixture(t), value = input()
  await f.store.list(value.userId, value.assignmentId)
  const temporary = path.join(f.directory, '.unpublished-context.tmp')
  await writeFile(temporary, '{unfinished', { mode: 0o600 })
  assert.deepEqual(await f.store.list(value.userId, value.assignmentId), [])
  assert.equal(await readFile(temporary, 'utf8'), '{unfinished')
  assert.equal((await f.store.ensure(value)).created, true)
})

test('a file at the operation-directory path fails closed without deleting it', async t => {
  const f = await fixture(t)
  await mkdir(f.config.sessionDir, { mode: 0o700 })
  await writeFile(f.directory, 'leave-this-file-intact', { mode: 0o600 })
  await assert.rejects(f.store.ensure(input()), unavailable)
  assert.equal(await readFile(f.directory, 'utf8'), 'leave-this-file-intact')
})

test('an operation-directory symlink or junction cannot redirect journal writes', async t => {
  const f = await fixture(t), target = path.join(f.root, 'redirect-target')
  await mkdir(f.config.sessionDir, { mode: 0o700 })
  await mkdir(target, { mode: 0o700 })
  await symlink(target, f.directory, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(f.store.ensure(input()), unavailable)
  assert.deepEqual(await readdir(target), [])
})

test('configuration refuses missing paths and directories inside public/build/dependency trees', () => {
  for (const config of [{}, { sessionDir: '', keyFile: 'private.key' }, { sessionDir: path.parse(process.cwd()).root, keyFile: 'private.key' },
    ...['public', '.next', 'dist', 'node_modules'].map(name => ({ sessionDir: path.join(process.cwd(), name, 'sessions'), keyFile: 'private.key' }))]) {
    assert.throws(() => createStatusStore({ config }), unavailable)
  }
})
