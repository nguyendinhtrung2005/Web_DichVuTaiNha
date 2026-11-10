import { createConfig, defaultPorts } from '../shared/config.js';
import { createMysqlPool } from '../shared/mysql-pool.js';
import { listen, closeServer } from '../shared/http.js';
import { checkCustomerEmailSchema } from '../shared/database-checks.js';

const folders = { auth: 'auth-service', user: 'user-service', catalog: 'service-service', order: 'order-service', staff: 'staff-service', payment: 'payment-service', review: 'review-service', gateway: 'api-gateway' };
const name = process.argv[2];
let server, pool;
try {
  if (!folders[name]) throw new Error('Unknown service');
  // Separate processes need matching configured caller credentials.
  const config = createConfig(process.env);
  let repository;
  if (name !== 'gateway') {
    pool = createMysqlPool();
    await pool.query('SELECT 1');
    if (['auth', 'user'].includes(name) && !await checkCustomerEmailSchema(pool)) throw new Error('Email migration required');
    const { createRepository } = await import('../' + folders[name] + '/src/repository.js');
    repository = createRepository(pool);
  }
  const { createApp } = await import('../' + folders[name] + '/src/app.js');
  const port = Number(process.env[name.toUpperCase() + '_PORT'] || defaultPorts[name]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
  server = await listen(createApp({ repository, config, pool }), port, config.host);
  process.stdout.write(name + ': http://' + config.host + ':' + server.address().port + '\n');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
    await closeServer(server);
    if (pool) await pool.end();
    process.exit(0);
  });
} catch {
  if (server) await closeServer(server);
  if (pool) await pool.end();
  process.stderr.write('Service startup FAIL; kiểm tra DB, cổng và cấu hình nội bộ.\n');
  process.exitCode = 1;
}
