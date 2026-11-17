import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodeJournal } from '../src/domain.js'

// QA-only tooling. Importing this module never connects to MySQL or writes data.
const DATABASE = 'cleanhome_staff_test'
const TABLES = ['bookings', 'booking_items', 'assignments', 'booking_status_history']
const CODES = ['Q01', 'Q02', 'Q03', 'Q04', 'Q05', 'Q06']
const LABELS = ['sequential', 'concurrent', 'order-offline', 'order-response-loss', 'ack-pending', 'browser-response-loss']
const PEOPLE = { customerId: '9109001', branchId: '9109003', serviceId: '9109006', actorUserIds: ['9109002', '9109101'], employeeIds: ['9109004', '9109102'] }
const QA_ROOT = fileURLToPath(new URL('../../../frontend/apps/staff/.auth-data/qa/', import.meta.url))
const LOCK = 'cleanhome.uc12-e2e.qa'
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const fail = message => { throw new Error(message) }
const sqlTime = value => new Date(value).toISOString().slice(0, 19).replace('T', ' ')
const isoTime = value => value == null ? null : new Date(String(value).includes('T') ? value : String(value).replace(' ', 'T') + 'Z').toISOString()
function identifier(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) fail('Unsafe numeric identifier')
  const result = String(value)
  if (!/^[1-9]\d{0,18}$/.test(result) || BigInt(result) > 9223372036854775807n) fail('Invalid identifier')
  return result
}
export function canonicalQaJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalQaJson).join(',') + ']'
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalQaJson(value[key])).join(',') + '}'
  return JSON.stringify(value)
}
const hash = value => createHash('sha256').update(canonicalQaJson(value)).digest('hex')
const clone = value => JSON.parse(JSON.stringify(value))
const without = (row, names) => Object.fromEntries(Object.entries(row).filter(([key]) => !names.includes(key)))

/** Deterministic UTC slots, avoiding ALL saved A/B intervals, including old QA. */
export function planQaSlots(intervals, now) {
  if (!Number.isSafeInteger(now) || now < 0) fail('Invalid QA clock')
  const day = 86400000, hour = 3600000
  let start = Math.floor((now + 7 * hour) / day) * day - 7 * hour + 8 * hour + 7 * day
  const busy = intervals.map(row => [Date.parse(isoTime(row.scheduled_start)), Date.parse(isoTime(row.scheduled_end))])
  if (busy.some(([a, b]) => !Number.isFinite(a) || !Number.isFinite(b) || b <= a)) fail('Invalid saved schedule; cannot safely plan QA slots')
  const result = []
  for (const code of CODES) {
    let attempts = 0
    while (busy.some(([a, b]) => a < start + 2 * hour && b > start)) {
      start += day
      if (++attempts > 366) fail('No bounded non-overlapping QA slot available')
    }
    if (start + 2 * hour >= Date.UTC(2038, 0, 19, 3, 14, 7)) fail('QA slot exceeds schema TIMESTAMP range')
    result.push({ code, scheduledStart: new Date(start).toISOString(), scheduledEnd: new Date(start + 2 * hour).toISOString() })
    busy.push([start, start + 2 * hour]); start += day
  }
  return result
}

/** Private durable metadata; no SQL restoration or deletion is provided. */
export function createQaData({ pool, artifactDir, approvalRef, runId, now = Date.now }) {
  const directory = path.resolve(artifactDir || '')
  if (!directory.startsWith(path.resolve(QA_ROOT) + path.sep) || !/^[A-Za-z0-9._-]{8,100}$/.test(runId || '')
    || typeof approvalRef !== 'string' || !approvalRef.trim() || approvalRef.length > 300) fail('Explicit bounded QA directory, run ID and approval reference required')
  const manifestPath = path.join(directory, 'manifest.json'), backupPath = path.join(directory, 'mysql-consistent-backup.json')
  let control, baseline, manifest, reference

  async function privateDirectory() {
    let current = path.parse(directory).root
    for (const part of directory.slice(current.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, part)
      try { if ((await lstat(current)).isSymbolicLink()) fail('QA artifact path cannot contain symbolic links') }
      catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    await mkdir(directory, { recursive: true, mode: 0o700 })
  }
  async function writeJson(file, value, exclusive = false) {
    await privateDirectory()
    try { const stat = await lstat(file); if (!stat.isFile() || stat.isSymbolicLink()) fail('QA artifact must be a regular private file') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    const temp = path.join(directory, '.' + path.basename(file) + '.' + randomUUID() + '.tmp')
    const handle = await open(temp, 'wx', 0o600)
    try {
      await handle.writeFile(JSON.stringify(value, null, 2) + '\n', 'utf8'); await handle.sync(); await handle.close()
      if (exclusive) await link(temp, file)
      else await rename(temp, file)
    } finally { try { await handle.close() } catch {} try { await unlink(temp) } catch (error) { if (error.code !== 'ENOENT') throw error } }
  }
  async function readJson(file) {
    const stat = await lstat(file)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 * 1024) fail('Invalid QA artifact file')
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
    try { return JSON.parse(await handle.readFile('utf8')) } finally { await handle.close() }
  }
  async function connection() {
    if (control) return control
    const options = pool?.pool?.config?.connectionConfig
    if (!options || options.host !== '127.0.0.1' || Number(options.port) !== 3306 || options.database !== DATABASE) fail('Refusing connection outside approved MySQL host/database')
    const c = await pool.getConnection()
    try {
      await c.query("SET SESSION time_zone = '+00:00'")
      const [rows] = await c.query('SELECT DATABASE() databaseName, @@port port, VERSION() version')
      if (rows[0]?.databaseName !== DATABASE || Number(rows[0].port) !== 3306) fail('Actual server is outside approved QA scope')
      const [locked] = await c.execute('SELECT GET_LOCK(?, 0) acquired', [LOCK])
      if (Number(locked[0]?.acquired) !== 1) fail('Another UC12 QA coordinator owns the database guard')
      control = c; return c
    } catch (error) { c.release(); throw error }
  }
  async function snapshot(c) {
    const tables = {}
    for (const table of TABLES) tables[table] = (await c.query('SELECT * FROM ' + table + ' ORDER BY id'))[0]
    return tables
  }
  async function references(c) {
    const [users] = await c.execute('SELECT id, role, status FROM users WHERE id IN (?, ?, ?) ORDER BY id', [PEOPLE.customerId, ...PEOPLE.actorUserIds])
    if (users.length !== 3 || !users.some(u => String(u.id) === PEOPLE.customerId && u.role === 'CUSTOMER' && u.status === 'ACTIVE')
      || !PEOPLE.actorUserIds.every(id => users.some(u => String(u.id) === id && u.role === 'EMPLOYEE' && u.status === 'ACTIVE'))) fail('Approved QA user references are not active or correctly typed')
    const [employees] = await c.execute('SELECT id,user_id,branch_id,status FROM employees WHERE id IN (?,?) ORDER BY id', PEOPLE.employeeIds)
    if (employees.length !== 2 || !PEOPLE.employeeIds.every((id, index) => employees.some(e => String(e.id) === id && String(e.user_id) === PEOPLE.actorUserIds[index] && String(e.branch_id) === PEOPLE.branchId && e.status === 'ACTIVE'))) fail('Approved employee/user/branch linkage changed')
    const [branches] = await c.execute('SELECT id,status FROM branches WHERE id=?', [PEOPLE.branchId])
    const [services] = await c.execute('SELECT id,name,unit,base_price,is_active FROM services WHERE id=?', [PEOPLE.serviceId])
    if (branches.length !== 1 || branches[0].status !== 'ACTIVE' || services.length !== 1 || Number(services[0].is_active) !== 1
      || !/^\d+(?:\.\d{1,2})?$/.test(String(services[0].base_price)) || !services[0].name || !services[0].unit) fail('Approved QA branch or service is not valid/active')
    const [source] = await c.execute('SELECT address_snapshot FROM bookings WHERE id=? AND customer_id=? AND branch_id=?', ['9109007', PEOPLE.customerId, PEOPLE.branchId])
    let address = source[0]?.address_snapshot
    if (typeof address === 'string') address = JSON.parse(address)
    if (!object(address) || address._cleanhome_fixture !== 'cleanhome-staff-uc9-uc12-v1') fail('Original approved synthetic address snapshot is unavailable')
    const contact = Object.fromEntries(['recipient', 'phone', 'address_text'].filter(key => typeof address[key] === 'string').map(key => [key, address[key]]))
    return { users, employees, branches, services, contact }
  }
  function validateManifest(value) {
    if (value?.kind !== 'cleanhome.uc12-e2e-qa' || value.version !== 1 || value.runId !== runId || value.approvalRef !== approvalRef
      || value.database !== DATABASE || value.host !== '127.0.0.1' || value.port !== 3306 || !Array.isArray(value.fixtures)
      || value.fixtures.length !== 6 || !CODES.every((code, index) => value.fixtures[index].code === code && /^[a-f0-9-]{36}$/.test(value.fixtures[index].marker))) fail('Existing manifest does not match this approved QA run')
    return value
  }
  async function load() {
    manifest = validateManifest(await readJson(manifestPath))
    baseline = await readJson(backupPath)
    if (baseline.kind !== 'cleanhome.uc12-consistent-backup' || baseline.runId !== runId || baseline.database !== DATABASE
      || manifest.backup.file !== path.basename(backupPath) || manifest.backup.sha256 !== hash(baseline)) fail('QA backup read-back hash verification failed')
    return manifest
  }
  async function fixtureRows(c, fixture) {
    const [bookings] = await c.execute('SELECT * FROM bookings WHERE id=?', [fixture.bookingId])
    const [items] = await c.execute('SELECT * FROM booking_items WHERE booking_id=? ORDER BY id', [fixture.bookingId])
    const [assignments] = await c.execute('SELECT * FROM assignments WHERE booking_id=? ORDER BY id', [fixture.bookingId])
    const [history] = await c.execute('SELECT * FROM booking_status_history WHERE booking_id=? ORDER BY id', [fixture.bookingId])
    const journals = history.map(row => decodeJournal({ id: String(row.id), bookingId: String(row.booking_id), changedBy: String(row.changed_by), status: row.status, note: row.note, createdAt: row.created_at }))
    if (journals.some(j => !j)) fail('Unexpected non-UC12 history in a dedicated QA fixture')
    return { code: fixture.code, booking: bookings[0] || null, items, assignments, history, journals }
  }
  function requireInitial(state, fixture) {
    if (!state.booking || state.booking.status !== 'CONFIRMED' || state.items.length !== 1 || state.assignments.length !== 2 || state.history.length !== 0
      || String(state.booking.customer_id) !== PEOPLE.customerId || String(state.booking.branch_id) !== PEOPLE.branchId
      || String(state.items[0].service_id) !== PEOPLE.serviceId || String(state.items[0].quantity) !== '1.00'
      || state.assignments.some((row, index) => String(row.employee_id) !== PEOPLE.employeeIds[index] || row.status !== 'ASSIGNED' || row.check_in_at !== null || row.check_out_at !== null)
      || isoTime(state.booking.scheduled_start) !== fixture.scheduledStart || isoTime(state.booking.scheduled_end) !== fixture.scheduledEnd) fail('Fixture is not at its approved initial state; never reset or consume it again')
  }
  async function preserve(c) {
    const current = await snapshot(c), allow = new Set(manifest.allowlist?.bookingIds || [])
    for (const table of TABLES) {
      const actual = current[table].filter(row => !allow.has(String(table === 'bookings' ? row.id : row.booking_id)))
      if (hash(actual) !== hash(baseline.tables[table])) fail('OUTSIDE_ALLOWLIST_CHANGED: ' + table)
    }
    if (hash(await references(c)) !== baseline.referenceHash) fail('Approved read-only references changed during QA')
    for (const fixture of manifest.fixtures.filter(f => f.initialRows)) {
      const state = await fixtureRows(c, fixture), initial = fixture.initialRows
      if (hash(without(state.booking || {}, ['status'])) !== hash(without(initial.booking, ['status'])) || hash(state.items) !== hash(initial.items)
        || hash(state.assignments.map(row => without(row, ['status', 'check_in_at', 'check_out_at']))) !== hash(initial.assignments.map(row => without(row, ['status', 'check_in_at', 'check_out_at'])))) fail('FIXTURE_IMMUTABLE_CHANGED: ' + fixture.code)
      if (state.assignments.some((row, index) => String(row.id) !== fixture.assignmentIds[index])) fail('Unexpected assignment roster changed')
      const seen = new Set()
      for (const journal of state.journals) {
        const op = journal.operation
        const actorIndex = PEOPLE.actorUserIds.indexOf(op.actorUserId)
        if (seen.has(op.id) || op.bookingId !== fixture.bookingId || actorIndex < 0 || op.assignmentId !== fixture.assignmentIds[actorIndex]
          || op.employeeId !== PEOPLE.employeeIds[actorIndex]) fail('Duplicate or out-of-allowlist journal operation')
        seen.add(op.id)
      }
    }
    return { database: DATABASE, outsideAllowlistUnchanged: true, protectedBookingIds: ['9109131', '9109141'],
      tableCounts: Object.fromEntries(TABLES.map(table => [table, current[table].length])),
      outsideHashes: Object.fromEntries(TABLES.map(table => [table, hash(current[table].filter(row => !allow.has(String(table === 'bookings' ? row.id : row.booking_id))))])) }
  }

  return Object.freeze({
    async preflightAndBackup() {
      const c = await connection()
      try {
        await lstat(manifestPath); await load(); reference = await references(c)
        const planned = clone(manifest)
        if (!manifest.fixtures.some(f => f.bookingId)) {
          const recovered = []
          for (const fixture of manifest.fixtures) recovered.push((await c.execute("SELECT id FROM bookings WHERE JSON_UNQUOTE(JSON_EXTRACT(address_snapshot,'$._cleanhome_order_qa'))=? ORDER BY id", [fixture.marker]))[0])
          if (recovered.some(rows => rows.length > 1) || (recovered.some(rows => rows.length) && !recovered.every(rows => rows.length === 1))) fail('Partial or duplicate fixture commit requires manual review')
          if (recovered.every(rows => rows.length === 1)) {
            for (const [index, fixture] of manifest.fixtures.entries()) {
              fixture.bookingId = identifier(recovered[index][0].id)
              const state = await fixtureRows(c, fixture); requireInitial(state, fixture)
              fixture.itemId = identifier(state.items[0].id); fixture.assignmentIds = state.assignments.map(row => identifier(row.id))
              fixture.initialRows = { booking: state.booking, items: state.items, assignments: state.assignments }
            }
            manifest.allowlist = { bookingIds: manifest.fixtures.map(f => f.bookingId), assignmentIds: manifest.fixtures.flatMap(f => f.assignmentIds), itemIds: manifest.fixtures.map(f => f.itemId) }
          }
        }
        await preserve(c); manifest = planned; return clone(manifest)
      }
      catch (error) { if (error.code !== 'ENOENT') throw error }
      // A backup without a manifest can be inspected/recovered, never overwritten.
      try { await lstat(backupPath); fail('Backup exists without manifest; manual review required before writing') } catch (error) { if (error.code !== 'ENOENT') throw error }
      await c.query('SET TRANSACTION READ ONLY'); await c.query('START TRANSACTION WITH CONSISTENT SNAPSHOT')
      try {
        const [server] = await c.query('SELECT DATABASE() databaseName, VERSION() version, @@port port')
        const [tables] = await c.execute('SELECT table_name,engine FROM information_schema.tables WHERE table_schema=? AND table_type=? ORDER BY table_name', [DATABASE, 'BASE TABLE'])
        const [triggers] = await c.execute('SELECT trigger_name FROM information_schema.triggers WHERE trigger_schema=?', [DATABASE])
        if (tables.length !== 32 || tables.some(row => row.ENGINE !== undefined ? row.ENGINE !== 'InnoDB' : row.engine !== 'InnoDB') || triggers.length) fail('Expected exactly 32 InnoDB tables without side-effect triggers')
        reference = await references(c)
        const data = await snapshot(c), schema = {}
        for (const table of TABLES) schema[table] = (await c.query('SHOW CREATE TABLE ' + table))[0][0]['Create Table']
        for (const id of ['9109131', '9109141']) if (!data.bookings.some(row => String(row.id) === id && row.status === 'COMPLETED')) fail('Protected historical booking status changed')
        const pending = data.booking_status_history.map(row => decodeJournal({ id: String(row.id), bookingId: String(row.booking_id), changedBy: String(row.changed_by), status: row.status, note: row.note, createdAt: row.created_at })).filter(Boolean)
        if (pending.some(row => !row.staffAcknowledged)) fail('Existing pending journal requires owner review; no global recovery allowed')
        const [intervals] = await c.execute('SELECT DISTINCT b.scheduled_start,b.scheduled_end FROM bookings b JOIN assignments a ON a.booking_id=b.id WHERE a.employee_id IN (?,?) ORDER BY b.scheduled_start', PEOPLE.employeeIds)
        const slots = planQaSlots(intervals, now())
        baseline = { kind: 'cleanhome.uc12-consistent-backup', version: 1, runId, database: DATABASE, host: '127.0.0.1', port: 3306,
          createdAt: new Date(now()).toISOString(), serverVersion: server[0].version, consistentRead: 'InnoDB READ ONLY WITH CONSISTENT SNAPSHOT',
          schema, tables: data, hashes: Object.fromEntries(TABLES.map(t => [t, hash(data[t])])), referenceHash: hash(reference) }
        manifest = { kind: 'cleanhome.uc12-e2e-qa', version: 1, runId, approvalRef, database: DATABASE, host: '127.0.0.1', port: 3306,
          createdAt: baseline.createdAt, approvalScope: 'Create only Q01-Q06: six bookings, six items, twelve A/B assignments; UC12 writes only their status/check-in/out/history. No reset/delete/schema/global-worker changes.',
          backup: { file: path.basename(backupPath), sha256: hash(baseline) }, protectedBookingIds: ['9109131', '9109141'],
          fixtures: slots.map((slot, index) => ({ ...slot, label: '[QA UC12] ' + slot.code + ' ' + LABELS[index], marker: randomUUID(), bookingId: null, itemId: null,
            assignmentIds: [], actorUserIds: [...PEOPLE.actorUserIds], employeeIds: [...PEOPLE.employeeIds], initialBookingStatus: 'CONFIRMED', initialAssignmentStatus: 'ASSIGNED', results: [] })),
          allowlist: { bookingIds: [], assignmentIds: [], itemIds: [] }, results: [] }
        await c.rollback()
        await writeJson(backupPath, baseline, true)
        if (hash(await readJson(backupPath)) !== hash(baseline)) fail('Written backup cannot be read back consistently')
        await writeJson(manifestPath, manifest, true)
        await load()
        return clone(manifest)
      } catch (error) { try { await c.rollback() } catch {} throw error }
    },
    async createFixtures(options = {}) {
      if (options.writeApproved !== true) fail('Fixture writes require explicit writeApproved=true after preflight/backup')
      const c = await connection(); await load()
      if (manifest.fixtures.every(f => f.bookingId && f.initialRows)) { await preserve(c); return clone(manifest) }
      const currentReferences = await references(c)
      if (hash(currentReferences) !== baseline.referenceHash) fail('QA references changed since backup')
      const found = []
      for (const fixture of manifest.fixtures) {
        const [rows] = await c.execute("SELECT id FROM bookings WHERE JSON_UNQUOTE(JSON_EXTRACT(address_snapshot,'$._cleanhome_order_qa'))=? ORDER BY id", [fixture.marker])
        if (rows.length > 1) fail('Duplicate fixture markers detected')
        found.push(rows[0])
      }
      if (found.some(Boolean) && !found.every(Boolean)) fail('Partial fixture set detected; do not create extra rows')
      if (found.every(Boolean)) {
        for (const [index, fixture] of manifest.fixtures.entries()) {
          fixture.bookingId = identifier(found[index].id)
          const state = await fixtureRows(c, fixture); requireInitial(state, fixture)
          fixture.itemId = identifier(state.items[0].id); fixture.assignmentIds = state.assignments.map(row => identifier(row.id))
          fixture.initialRows = { booking: state.booking, items: state.items, assignments: state.assignments }
        }
        manifest.allowlist = { bookingIds: manifest.fixtures.map(f => f.bookingId), assignmentIds: manifest.fixtures.flatMap(f => f.assignmentIds), itemIds: manifest.fixtures.map(f => f.itemId) }
        await preserve(c)
      } else {
        await preserve(c)
        // Recheck every slot against newly saved work before starting the insert transaction.
        const [busy] = await c.execute('SELECT DISTINCT b.scheduled_start,b.scheduled_end FROM bookings b JOIN assignments a ON a.booking_id=b.id WHERE a.employee_id IN (?,?)', PEOPLE.employeeIds)
        for (const fixture of manifest.fixtures) if (busy.some(row => Date.parse(isoTime(row.scheduled_start)) < Date.parse(fixture.scheduledEnd) && Date.parse(isoTime(row.scheduled_end)) > Date.parse(fixture.scheduledStart))) fail('QA schedule now overlaps saved work; reapproval/replanning required')
        await c.beginTransaction()
        try {
          const service = currentReferences.services[0], assignedAt = sqlTime(now())
          for (const fixture of manifest.fixtures) {
            const address = { ...currentReferences.contact, _cleanhome_order_qa: fixture.marker, label: fixture.label, source: 'uc12-frontend-e2e', qaRunId: runId, qaCase: fixture.code }
            const [booking] = await c.execute('INSERT INTO bookings (customer_id,branch_id,address_snapshot,scheduled_start,scheduled_end,status,total_amount) VALUES (?,?,?,?,?,?,?)',
              [PEOPLE.customerId, PEOPLE.branchId, JSON.stringify(address), sqlTime(Date.parse(fixture.scheduledStart)), sqlTime(Date.parse(fixture.scheduledEnd)), 'CONFIRMED', String(service.base_price)])
            fixture.bookingId = identifier(booking.insertId)
            const [item] = await c.execute('INSERT INTO booking_items (booking_id,service_id,service_name_snapshot,quantity,unit_price,unit_snapshot) VALUES (?,?,?,?,?,?)',
              [fixture.bookingId, PEOPLE.serviceId, service.name, '1.00', String(service.base_price), service.unit])
            fixture.itemId = identifier(item.insertId); fixture.assignmentIds = []
            for (const employeeId of PEOPLE.employeeIds) {
              const [assignment] = await c.execute('INSERT INTO assignments (booking_id,employee_id,assigned_at,status,check_in_at,check_out_at) VALUES (?,?,?,?,NULL,NULL)', [fixture.bookingId, employeeId, assignedAt, 'ASSIGNED'])
              fixture.assignmentIds.push(identifier(assignment.insertId))
            }
            const state = await fixtureRows(c, fixture); requireInitial(state, fixture)
            fixture.initialRows = { booking: state.booking, items: state.items, assignments: state.assignments }
          }
          await c.commit()
        } catch (error) { try { await c.rollback() } catch {} throw error }
      }
      manifest.allowlist = { bookingIds: manifest.fixtures.map(f => f.bookingId), assignmentIds: manifest.fixtures.flatMap(f => f.assignmentIds), itemIds: manifest.fixtures.map(f => f.itemId) }
      manifest.fixtureCreatedAt = new Date(now()).toISOString()
      await writeJson(manifestPath, manifest)
      await preserve(c)
      return clone(manifest)
    },
    async inspectFixture(code) {
      if (!CODES.includes(code)) fail('Fixture code is not allowlisted')
      const c = await connection(); await load()
      const fixture = manifest.fixtures.find(f => f.code === code)
      if (!fixture?.bookingId) fail('Fixture has not been created')
      return clone(await fixtureRows(c, fixture))
    },
    async assertPreserved() { const c = await connection(); await load(); return preserve(c) },
    async readManifest() { await load(); return clone(manifest) },
    async recordResult(code, result) {
      if (!CODES.includes(code) || !object(result) || !['PASS', 'FAIL', 'SKIP', 'NOT_RUN'].includes(result.status)) fail('Structured fixture result required')
      const encoded = JSON.stringify(result)
      if (encoded.length > 65536 || /"(?:password|passwordHash|password_hash|accessToken|refreshToken|authorization|cookie|secret|privateKey)"\s*:/i.test(encoded)
        || /[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/.test(encoded)) fail('Result contains forbidden secret-shaped data')
      await load(); manifest.fixtures.find(f => f.code === code).results.push({ ...clone(result), recordedAt: new Date(now()).toISOString() }); await writeJson(manifestPath, manifest)
    },
    async close() {
      if (control) { const c = control; control = undefined; try { await c.execute('SELECT RELEASE_LOCK(?) released', [LOCK]) } finally { c.release() } }
    },
  })
}
