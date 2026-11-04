import { checkCustomerBookingIdempotencySchema, checkCustomerEmailSchema } from '../shared/database-checks.js';

const serviceModules = [
  ['auth-service', '../auth-service/src/db.js'],
  ['user-service', '../user-service/src/db.js'],
  ['service-service', '../service-service/src/db.js'],
  ['order-service', '../order-service/src/db.js'],
  ['staff-service', '../staff-service/src/db.js'],
  ['payment-service', '../payment-service/src/db.js'],
  ['review-service', '../review-service/src/db.js'],
];

const expectedTables = [
  'users', 'addresses', 'branches', 'employees', 'employee_availability',
  'service_categories', 'services', 'skills', 'employee_skills', 'certificates',
  'service_packages', 'package_items', 'subscriptions', 'entitlements', 'bookings',
  'booking_items', 'assignments', 'booking_status_history', 'payments', 'revenue_shares',
  'reviews', 'conversations', 'conversation_members', 'messages', 'notifications',
  'vouchers', 'voucher_services', 'voucher_redemptions', 'product_categories', 'products',
  'product_images', 'product_inventory',
];

let failed = false;
const requiredEnvironment = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
const missingEnvironment = requiredEnvironment.filter((name) => !process.env[name]?.trim());
const pools = [];

try {
  if (missingEnvironment.length) {
    failed = true;
    process.stderr.write(`Database check: FAIL; thiếu cấu hình: ${missingEnvironment.join(', ')} trong backend/.env.\n`);
  } else {
    const loaded = await Promise.all(serviceModules.map(async ([name, path]) => {
      const module = await import(path);
      pools.push(module.pool);
      return { name, pool: module.pool };
    }));
    const checks = await Promise.allSettled(loaded.map(async ({ name, pool }) => {
      const [rows] = await pool.query('SELECT DATABASE() AS databaseName');
      return { name, databaseName: rows[0]?.databaseName };
    }));

    for (let index = 0; index < checks.length; index += 1) {
      const result = checks[index];
      const serviceName = loaded[index].name;
      if (result.status === 'fulfilled' && result.value.databaseName) {
        process.stdout.write(`${serviceName}: PASS (connected)\n`);
      } else {
        failed = true;
        const code = result.status === 'rejected' && /^[A-Z0-9_]+$/.test(result.reason?.code || '')
          ? ` (${result.reason.code})`
          : '';
        process.stderr.write(`${serviceName}: FAIL${code}; kiểm tra MySQL và backend/.env.\n`);
      }
    }

    if (!failed) {
      if (await checkCustomerEmailSchema(loaded[0].pool)) {
        process.stdout.write('Customer email migration: PASS\n');
      } else {
        failed = true;
        process.stderr.write('Customer email migration: FAIL; cần migration 001 được owner duyệt. Không chạy DDL tự động.\n');
      }
      if (await checkCustomerBookingIdempotencySchema(loaded[0].pool)) {
        process.stdout.write('Customer booking idempotency migration: PASS\n');
      } else {
        failed = true;
        process.stderr.write('Customer booking idempotency migration: FAIL; cần migration 003 được owner duyệt. Không chạy DDL tự động.\n');
      }
      const [rows] = await loaded[0].pool.query(
        `SELECT TABLE_NAME AS tableName
         FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`,
      );
      const actual = new Set(rows.map((row) => row.tableName));
      const missing = expectedTables.filter((table) => !actual.has(table));
      if (missing.length) {
        failed = true;
        process.stderr.write(`Schema: FAIL; thiếu bảng: ${missing.join(', ')}. Chưa chạy DDL tự động.\n`);
      } else {
        process.stdout.write(`Schema: PASS (${expectedTables.length} bảng yêu cầu hiện diện).\n`);
      }
    }
  }
} catch (error) {
  failed = true;
  const code = /^[A-Z0-9_]+$/.test(error?.code || '') ? ` (${error.code})` : '';
  process.stderr.write(`Database check: FAIL${code}; kiểm tra cấu hình MySQL và schema.\n`);
} finally {
  await Promise.allSettled(pools.map((pool) => pool.end()));
}

if (failed) process.exitCode = 1;
