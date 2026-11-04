import { createMysqlPool } from '../shared/mysql-pool.js';

let pool;
try {
  pool = createMysqlPool();
  const names = ['product_services', 'product_stock_reservations', 'product_orders', 'product_order_items'];
  const [tables] = await pool.execute(
    'SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN (?,?,?,?)', names,
  );
  const [columns] = await pool.execute(
    'SELECT DATA_TYPE AS type, IS_NULLABLE AS nullable FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?',
    ['services', 'customer_config'],
  );
  const missing = names.filter((name) => !tables.some((table) => table.name === name && table.engine === 'InnoDB'));
  if (missing.length || columns[0]?.type !== 'json' || columns[0]?.nullable !== 'YES') {
    process.stderr.write('Products schema: FAIL; migration 002 chưa đầy đủ. Cần owner duyệt/kiểm tra migration; không chạy DDL tự động.\n');
    if (missing.length) process.stderr.write('Thiếu bảng InnoDB: ' + missing.join(', ') + '\n');
    process.exitCode = 1;
  } else {
    process.stdout.write('Products schema: PASS; nullable service metadata and four InnoDB commerce tables.\n');
  }
} catch (error) {
  const code = /^[A-Z0-9_]+$/.test(error?.code || '') ? ' (' + error.code + ')' : '';
  process.stderr.write('Products schema: FAIL' + code + '; kiểm tra cấu hình MySQL và migration được duyệt.\n');
  process.exitCode = 1;
} finally { if (pool) await pool.end(); }
