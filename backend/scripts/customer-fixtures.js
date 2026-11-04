import { randomBytes, randomInt } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const artifactDirectory = fileURLToPath(new URL('../.test-artifacts/', import.meta.url));
const targetDatabase = 'dich_vu_ve_sinh';
const allowedTables = new Set(['users', 'service_categories', 'services', 'branches', 'bookings', 'booking_items', 'booking_status_history', 'payments', 'reviews', 'employees', 'assignments']);
const placeholders = (ids) => ids.map(() => '?').join(',');

export async function assertFixtureTarget(pool, env = process.env) {
  if (env.ALLOW_CUSTOMER_DB_TEST !== '1') throw new Error('Fixture writes require ALLOW_CUSTOMER_DB_TEST=1 and the task owner approval.');
  if (!['127.0.0.1', 'localhost'].includes(env.DB_HOST) || Number(env.DB_PORT || 3306) !== 3306 || env.DB_NAME !== targetDatabase) {
    throw new Error('Fixture target must be the approved local dich_vu_ve_sinh database on port 3306.');
  }
  const [rows] = await pool.query('SELECT DATABASE() AS databaseName');
  if (rows[0]?.databaseName !== targetDatabase) throw new Error('Actual database does not match the approved fixture target.');
  const [columns] = await pool.query("SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='email'");
  if (columns.length !== 1) throw new Error('users.email migration is not installed; no fixture writes were performed.');
}

export async function createCustomerFixtures(pool, { env = process.env } = {}) {
  await assertFixtureTarget(pool, env);
  const marker = `CUSTOMER_E2E_${Date.now()}_${randomBytes(4).toString('hex')}`;
  const registry = { version: 1, marker, database: targetDatabase, host: env.DB_HOST, port: 3306, ids: {}, createdAt: new Date().toISOString() };
  await mkdir(artifactDirectory, { recursive: true });
  const registryPath = path.join(artifactDirectory, `${marker}.json`);
  const save = () => writeFile(registryPath, JSON.stringify(registry, null, 2), { mode: 0o600 });
  await save();
  const record = async (table, id) => {
    if (!allowedTables.has(table) || !/^\d+$/.test(String(id))) throw new Error('Invalid fixture record.');
    const values = registry.ids[table] ||= [];
    if (!values.includes(String(id))) values.push(String(id));
    await save();
    return String(id);
  };
  const insert = async (table, sql, values) => {
    const [result] = await pool.execute(sql, values);
    return record(table, result.insertId);
  };
  const account = (label) => ({
    name: `${marker} ${label}`,
    phone: `03${String(randomInt(0, 100000000)).padStart(8, '0')}`,
    email: `${marker.toLowerCase()}.${label.toLowerCase()}@example.invalid`,
    password: `Test-${randomBytes(20).toString('hex')}!`,
  });
  const context = {
    marker, registry, registryPath, record, account,
    async cleanup() { await cleanupCustomerFixtures(pool, registryPath, { env }); },
    async recordOrder(id) {
      await record('bookings', id);
      for (const table of ['booking_items', 'booking_status_history', 'payments', 'reviews', 'assignments']) {
        const [rows] = await pool.execute(`SELECT id FROM ${table} WHERE booking_id=?`, [String(id)]);
        for (const row of rows) await record(table, row.id);
      }
      return String(id);
    },
    async completeOrder(orderId, customerId) {
      if (!(registry.ids.bookings || []).includes(String(orderId)) || !(registry.ids.users || []).includes(String(customerId))) throw new Error('Only recorded fixture orders may be completed.');
      const connection = await pool.getConnection();
      let assignmentId;
      let historyId;
      try {
        await connection.beginTransaction();
        const [result] = await connection.execute("UPDATE bookings SET status='COMPLETED' WHERE id=? AND customer_id=?", [String(orderId), String(customerId)]);
        if (result.affectedRows !== 1) throw new Error('Fixture order ownership check failed.');
        const [assignment] = await connection.execute("INSERT INTO assignments (booking_id,employee_id,status,check_in_at,check_out_at) VALUES (?,?,'COMPLETED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)", [String(orderId), context.employeeId]);
        assignmentId = String(assignment.insertId);
        const [history] = await connection.execute("INSERT INTO booking_status_history (booking_id,changed_by,status,note) VALUES (?,?,'COMPLETED',?)", [String(orderId), String(customerId), `${marker} synthetic completed fixture`]);
        historyId = String(history.insertId);
        await connection.commit();
      } catch (error) { await connection.rollback(); throw error; }
      finally { connection.release(); }
      await record('assignments', assignmentId);
      await record('booking_status_history', historyId);
    },
  };
  try {
    context.branchId = await insert('branches', "INSERT INTO branches (name,address_text,service_area,latitude,longitude,status) VALUES (?,?,?,10.75,106.65,'ACTIVE')", [`${marker} Branch`, `${marker} synthetic address`, JSON.stringify({ fixture: marker })]);
    context.categoryId = await insert('service_categories', 'INSERT INTO service_categories (name,description,is_active) VALUES (?,?,TRUE)', [`${marker} Category`, `${marker} synthetic category`]);
    context.serviceId = await insert('services', 'INSERT INTO services (category_id,name,description,unit,base_price,duration_minutes,is_active) VALUES (?,?,?,?,125000,60,TRUE)', [context.categoryId, `${marker} Service`, `${marker} synthetic service description`, 'giờ']);
    const employee = account('Employee');
    context.employeeUserId = await insert('users', "INSERT INTO users (full_name,phone,email,password_hash,role,status) VALUES (?,?,?,?,'EMPLOYEE','ACTIVE')", [employee.name, employee.phone, employee.email, `fixture-disabled-${randomBytes(32).toString('hex')}`]);
    context.employeeId = await insert('employees', "INSERT INTO employees (user_id,branch_id,verification_status,status) VALUES (?,?,'VERIFIED','ACTIVE')", [context.employeeUserId, context.branchId]);
    return context;
  } catch (error) {
    await context.cleanup().catch(() => {});
    throw error;
  }
}

export async function cleanupCustomerFixtures(pool, registryPath, { env = process.env } = {}) {
  await assertFixtureTarget(pool, env);
  const resolved = path.resolve(registryPath);
  if (path.dirname(resolved) !== path.resolve(artifactDirectory)) throw new Error('Fixture registry must stay in backend/.test-artifacts.');
  const registry = JSON.parse(await readFile(resolved, 'utf8'));
  if (registry.version !== 1 || registry.database !== targetDatabase || !/^CUSTOMER_E2E_\d+_[a-f0-9]{8}$/.test(registry.marker)) throw new Error('Invalid fixture registry.');
  const ids = registry.ids;
  if (!ids || Object.entries(ids).some(([table, values]) => !allowedTables.has(table) || !Array.isArray(values) || values.some((id) => !/^\d+$/.test(id)))) throw new Error('Invalid fixture IDs.');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const owned = {};
    const prefix = `${registry.marker} `;
    for (const [table, markerColumn] of [['users', 'full_name'], ['branches', 'name'], ['service_categories', 'name'], ['services', 'name']]) {
      // Discover an insert whose response/ID could not be journaled before an interruption.
      // The generated marker plus a space is an exact prefix, not a SQL LIKE pattern.
      const [discovered] = await connection.execute(`SELECT id FROM ${table} WHERE LEFT(${markerColumn},CHAR_LENGTH(?))=? FOR UPDATE`, [prefix, prefix]);
      const values = [...new Set([...(ids[table] || []), ...discovered.map((row) => String(row.id))])];
      if (!values.length) { owned[table] = []; continue; }
      const [rows] = await connection.execute(`SELECT id,${markerColumn} AS markerValue FROM ${table} WHERE id IN (${placeholders(values)}) FOR UPDATE`, values);
      if (rows.some((row) => !row.markerValue.startsWith(prefix))) throw new Error(`Fixture marker check failed for ${table}; cleanup rolled back.`);
      owned[table] = rows.map((row) => String(row.id));
    }
    const [discoveredBookings] = owned.users.length
      ? await connection.execute(`SELECT id FROM bookings WHERE customer_id IN (${placeholders(owned.users)}) FOR UPDATE`, owned.users)
      : [[]];
    const bookings = [...new Set([...(ids.bookings || []), ...discoveredBookings.map((row) => String(row.id))])];
    if (bookings.length) {
      if (!owned.users.length) throw new Error('Fixture bookings have no recorded owner.');
      const [rows] = await connection.execute(`SELECT id FROM bookings WHERE id IN (${placeholders(bookings)}) AND customer_id IN (${placeholders(owned.users)}) FOR UPDATE`, [...bookings, ...owned.users]);
      const [existing] = await connection.execute(`SELECT id FROM bookings WHERE id IN (${placeholders(bookings)}) FOR UPDATE`, bookings);
      if (rows.length !== existing.length) throw new Error('Fixture booking ownership check failed; cleanup rolled back.');
      for (const table of ['reviews', 'payments', 'assignments', 'booking_status_history', 'booking_items']) {
        await connection.execute(`DELETE FROM ${table} WHERE booking_id IN (${placeholders(bookings)})`, bookings);
      }
      await connection.execute(`DELETE FROM bookings WHERE id IN (${placeholders(bookings)})`, bookings);
    }
    const [discoveredEmployees] = owned.users.length
      ? await connection.execute(`SELECT id FROM employees WHERE user_id IN (${placeholders(owned.users)}) FOR UPDATE`, owned.users)
      : [[]];
    const employees = [...new Set([...(ids.employees || []), ...discoveredEmployees.map((row) => String(row.id))])];
    if (employees.length) {
      if (!owned.users.length) throw new Error('Fixture employees have no recorded owner.');
      const [rows] = await connection.execute(`SELECT id FROM employees WHERE id IN (${placeholders(employees)}) AND user_id IN (${placeholders(owned.users)}) FOR UPDATE`, [...employees, ...owned.users]);
      const [existing] = await connection.execute(`SELECT id FROM employees WHERE id IN (${placeholders(employees)}) FOR UPDATE`, employees);
      if (rows.length !== existing.length) throw new Error('Fixture employee ownership check failed; cleanup rolled back.');
      await connection.execute(`DELETE FROM employees WHERE id IN (${placeholders(employees)})`, employees);
    }
    for (const table of ['services', 'service_categories', 'branches', 'users']) {
      if (owned[table].length) await connection.execute(`DELETE FROM ${table} WHERE id IN (${placeholders(owned[table])})`, owned[table]);
    }
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
  await unlink(resolved);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== 'cleanup' || !process.argv[3]) {
    process.stderr.write('Usage: node --env-file-if-exists=.env scripts/customer-fixtures.js cleanup <registry-path>\n');
    process.exitCode = 1;
  } else {
    const { createMysqlPool } = await import('../shared/mysql-pool.js');
    const pool = createMysqlPool();
    try {
      await cleanupCustomerFixtures(pool, process.argv[3]);
      process.stdout.write('Customer fixture cleanup PASS; only verified synthetic records were removed.\n');
    } catch {
      process.stderr.write('Customer fixture cleanup FAIL; the registry is preserved for review. Verify target approval, database availability, and the exact marker/IDs.\n');
      process.exitCode = 1;
    } finally { await pool.end(); }
  }
}
