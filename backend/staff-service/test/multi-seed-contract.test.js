import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// Static contracts only: do not connect to MySQL or evaluate any SQL.
const seed = await readFile(new URL('../../../databases/seed_staff_test_multi.sql', import.meta.url), 'utf8')
const ddl = await readFile(new URL('../../../databases/schema.sql', import.meta.url), 'utf8')
const code = seed.replace(/^\s*--.*$/gm, '')
const inserts = [...code.matchAll(/^INSERT INTO ([\w.]+)\s*\(([^)]+)\)([\s\S]*?)(?=^(?:INSERT INTO|COMMIT;))/gm)]
const fixtureIds = ['9109101', '9109102', '9109103', '9109104', '9109105', '9109111', '9109112', '9109113', '9109121', '9109122', '9109123', '9109131', '9109132', '9109133', '9109134']

test('multi seed has fifteen fixed new rows in the dedicated schema, with no destructive/overwrite statements', () => {
  assert.match(code, /^USE cleanhome_staff_test;/m)
  assert.equal(inserts.length, 15)
  assert.deepEqual(inserts.map(match => /^\s*SELECT (\d+),/.exec(match[3])?.[1]).sort(), fixtureIds.sort())
  assert.deepEqual(inserts.map(match => match[1].split('.')[1]).sort(), ['users', 'employees', ...Array(4).fill('bookings'), ...Array(4).fill('booking_items'), ...Array(5).fill('assignments')].sort())
  for (const [, target] of inserts) assert.match(target, /^cleanhome_staff_test\.[a-z_]+$/)
  assert.doesNotMatch(code, /^\s*(?:DROP|TRUNCATE|DELETE|UPDATE|ALTER|CREATE|REPLACE)\b/im)
  assert.doesNotMatch(code, /ON DUPLICATE KEY UPDATE|INSERT IGNORE|FOREIGN_KEY_CHECKS/i)
})

test('each multi INSERT is fail-closed and guards existence through a materialized target subquery', () => {
  assert.ok(code.indexOf('SET @cleanhome_staff_multi_allowed = 0;') < code.indexOf('SELECT CASE'))
  assert.match(code, /THEN 1 ELSE 0 END INTO @cleanhome_staff_multi_allowed;/)
  for (const [, target, , body] of inserts) {
    assert.match(body, /WHERE DATABASE\(\) = 'cleanhome_staff_test' AND @cleanhome_staff_multi_allowed = 1/)
    const suffix = /AND NOT EXISTS \(SELECT 1 FROM \(\s*SELECT id FROM ([\w.]+)[\s\S]*?LIMIT 1\s*\) AS existing_multi_\w+\);\s*$/.exec(body)
    assert.ok(suffix, 'Missing materialized existence check for ' + target)
    assert.equal(suffix[1], target)
  }
})

test('all original fixtures must exist before multi preflight permits insertion', () => {
  const preflight = code.slice(code.indexOf('SELECT CASE'), code.indexOf('START TRANSACTION;'))
  for (const id of ['9109001', '9109002', '9109003', '9109004', '9109005', '9109006', '9109007', '9109008', '9109009']) assert.ok(preflight.includes('id = ' + id))
  assert.match(preflight, /scheduled_end > scheduled_start/)
  assert.match(preflight, /phone = 'TEST-EMPLOYEE-UC9-B'/)
  for (const id of ['9109131', '9109133', '9109134']) assert.match(preflight, new RegExp('\\bid IN \\([^)]*\\b' + id + '\\b'))
  assert.match(preflight, /cleanhome-staff-uc9-uc12-multi-v1/)
  for (const [, , , body] of inserts) assert.doesNotMatch(body, /^\s*SELECT 910900[1-9],/m)
})

test('multi INSERT columns and required non-default fields match the original schema', () => {
  const tables = new Map([...ddl.matchAll(/CREATE TABLE (\w+) \(([\s\S]*?)\) ENGINE=/g)].map(match => [match[1], match[2]]))
  for (const [, target, header] of inserts) {
    const table = target.split('.')[1], columns = new Set(header.split(',').map(value => value.trim()))
    const definitions = [...tables.get(table).matchAll(/^\s*(\w+)\s+(?:BIGINT|INT|VARCHAR|TEXT|JSON|DECIMAL|TIMESTAMP|BOOLEAN)\b(.*)$/gm)]
    const available = new Set(definitions.map(match => match[1]))
    for (const column of columns) assert.ok(available.has(column), target + '.' + column)
    for (const [, column, attributes] of definitions) if (/NOT NULL/.test(attributes) && !/\bDEFAULT\b|AUTO_INCREMENT/.test(attributes)) assert.ok(columns.has(column), 'Missing required column: ' + target + '.' + column)
  }
})

test('new schedules derive from the saved original booking and seed preserves every existing row', () => {
  const bookings = inserts.filter(match => match[1].endsWith('.bookings'))
  for (const [, , , body] of bookings) {
    assert.match(body, /b\.id = 9109007/)
    assert.match(body, /DATE_(?:ADD|SUB)\(b\.scheduled_start, INTERVAL [123] DAY\)/)
    assert.match(body, /DATE_(?:ADD|SUB)\(b\.scheduled_end, INTERVAL [123] DAY\)/)
    assert.doesNotMatch(body, /UTC_DATE\(|CURRENT_DATE\(/)
  }
  const jobs = inserts.filter(match => match[1].endsWith('.assignments'))
  assert.equal(jobs.length, 5)
  for (const [, , , body] of jobs) assert.match(body, /NULL, NULL, '(?:ASSIGNED|ACCEPTED)'/)
  assert.equal(jobs.filter(match => /NULL, NULL, 'ACCEPTED'/.test(match[3])).length, 1)
})

test('shared booking has separate A/B assignments without adding staff to the original booking', () => {
  const jobs = inserts.filter(match => match[1].endsWith('.assignments'))
  const a = jobs.find(match => /^\s*SELECT 9109133,/.test(match[3]))?.[3]
  const b = jobs.find(match => /^\s*SELECT 9109134,/.test(match[3]))?.[3]
  for (const body of [a, b]) { assert.ok(body); assert.match(body, /b\.id = 9109131/); assert.match(body, /NULL, NULL, 'ASSIGNED'/) }
  assert.match(a, /e\.id = 9109004/); assert.match(b, /e\.id = 9109102/)
  for (const [, , , body] of jobs) assert.doesNotMatch(body, /b\.id = 9109007/)
})

test('only non-login fixture credential markers exist and final output contains metadata alone', () => {
  const user = inserts.find(match => match[1].endsWith('.users'))
  assert.match(user[3], /'!CLEANHOME_TEST_ONLY_NO_LOGIN!'/)
  assert.match(user[3], /'EMPLOYEE', 'ACTIVE'/)
  assert.doesNotMatch(user[3], /'ADMIN'|\$2[aby]\$|\$argon2|eyJ[A-Za-z0-9_-]+\./)
  const output = code.slice(code.lastIndexOf('COMMIT;'))
  assert.doesNotMatch(output, /password_hash|NO_LOGIN|JWT|SECRET|TOKEN/)
  const sources = [...code.matchAll(/\b(?:FROM|JOIN|INTO)\s+([a-z_][\w.]*)/gi)].map(match => match[1])
  assert.ok(sources.every(name => name === 'DUAL' || name.startsWith('cleanhome_staff_test.')))
})

test('real-MySQL multi suite is explicitly gated and cannot run seed, mutate DB or manufacture authentication', async () => {
  const source = await readFile(new URL('./mysql.multi.integration.test.js', import.meta.url), 'utf8')
  assert.match(source, /process\.env\.RUN_MYSQL_MULTI_TESTS === 'true'/)
  assert.match(source, /skip: enabled \? false/)
  assert.match(source, /assert\.equal\(process\.env\.MYSQL_DATABASE, 'cleanhome_staff_test'/)
  assert.doesNotMatch(source, /(?:\.execute|\.query)\(\s*[`'"]\s*(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)/i)
  assert.doesNotMatch(source, /\.withLockedAssignment\(|\.updateStatus\(|SignJWT|jwt\.sign|execFile\(|readFile\(/)
})
