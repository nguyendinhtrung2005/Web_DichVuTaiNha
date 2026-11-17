import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// Static safety checks only. This file never connects to MySQL or executes SQL.
const seed = await readFile(new URL('../../../databases/seed_staff_test.sql', import.meta.url), 'utf8')
const ddl = await readFile(new URL('../../../databases/schema.sql', import.meta.url), 'utf8')
const code = seed.replace(/^\s*--.*$/gm, '')
const inserts = [...code.matchAll(/^INSERT INTO ([\w.]+)\s*\(([^)]+)\)([\s\S]*?)(?=^(?:INSERT INTO|COMMIT;))/gm)]

test('seed SQL writes only to the dedicated database and never deletes, overwrites or modifies schema', () => {
  assert.match(code, /^USE cleanhome_staff_test;/m)
  assert.doesNotMatch(code, /^\s*(?:DROP|TRUNCATE|DELETE|UPDATE|ALTER|CREATE|REPLACE)\b/im)
  assert.doesNotMatch(code, /ON DUPLICATE KEY UPDATE|INSERT IGNORE|FOREIGN_KEY_CHECKS/i)
  assert.equal(inserts.length, 9)
  assert.deepEqual(inserts.map(match => match[1].split('.')[1]).sort(), ['users', 'users', 'branches', 'employees', 'service_categories', 'services', 'bookings', 'booking_items', 'assignments'].sort())
  for (const [, target] of inserts) assert.match(target, /^cleanhome_staff_test\.[a-z_]+$/)
})

test('every seed INSERT has a database guard, fail-closed preflight and non-overwriting existence check', () => {
  const initialization = code.indexOf('SET @cleanhome_staff_seed_allowed = 0;')
  assert.ok(initialization >= 0 && initialization < code.indexOf('SELECT CASE'))
  assert.match(code, /THEN 1 ELSE 0 END INTO @cleanhome_staff_seed_allowed;/)
  for (const [, , , body] of inserts) {
    assert.match(body, /WHERE DATABASE\(\) = 'cleanhome_staff_test' AND @cleanhome_staff_seed_allowed = 1/)
    assert.match(body, /AND NOT EXISTS \(SELECT 1 FROM \(/)
    assert.match(body, /LIMIT 1/)
  }
})

test('seed INSERT columns exist in the original schema and include every mandatory field without a default', () => {
  const tables = new Map([...ddl.matchAll(/CREATE TABLE (\w+) \(([\s\S]*?)\) ENGINE=/g)].map(match => [match[1], match[2]]))
  for (const [, target, header] of inserts) {
    const table = target.split('.')[1]
    const columns = new Set(header.split(',').map(value => value.trim()))
    const definitions = [...tables.get(table).matchAll(/^\s*(\w+)\s+(?:BIGINT|INT|VARCHAR|TEXT|JSON|DECIMAL|TIMESTAMP|BOOLEAN)\b(.*)$/gm)]
    const available = new Set(definitions.map(match => match[1]))
    for (const column of columns) assert.ok(available.has(column), target + '.' + column)
    for (const [, column, rest] of definitions) {
      if (/NOT NULL/.test(rest) && !/\bDEFAULT\b|AUTO_INCREMENT/.test(rest)) assert.ok(columns.has(column), 'Missing required column: ' + target + '.' + column)
    }
  }
})

test('production entry points and npm commands cannot execute the optional fixture automatically', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  for (const command of Object.values(packageJson.scripts)) assert.doesNotMatch(command, /seed_staff_test\.sql|seed[-_:]staff/i)
  for (const file of ['runtime.js', 'server.js', 'worker.js', 'db.js', 'repository.js']) {
    const source = await readFile(new URL('../src/' + file, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /seed_staff_test|!CLEANHOME_TEST_ONLY_NO_LOGIN!/)
  }
})
