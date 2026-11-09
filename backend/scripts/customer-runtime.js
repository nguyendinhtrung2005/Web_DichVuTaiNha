import { createConfig, defaultPorts, serviceNames } from '../shared/config.js';
import { createMysqlPool } from '../shared/mysql-pool.js';
import { listen, closeServer } from '../shared/http.js';
import { checkCustomerEmailSchema } from '../shared/database-checks.js';

const folders = { auth: 'auth-service', user: 'user-service', catalog: 'service-service', order: 'order-service', staff: 'staff-service', payment: 'payment-service', review: 'review-service', gateway: 'api-gateway' };
export async function startCustomerStack({ env = process.env, repositories = {}, ports = {}, configOverrides = {} } = {}) {
  const base = createConfig(env, { generateLocalSecrets: true });
  const config = { ...base, ...configOverrides, urls: { ...base.urls, ...configOverrides.urls } };
  const pools = [], servers = {};
  let closed = false;
  const close = async () => {
    if (closed) return; closed = true;
    await Promise.allSettled(Object.values(servers).map(closeServer));
    await Promise.allSettled(pools.map((pool) => pool.end()));
  };
  try {
    for (const name of serviceNames) {
      let repository = repositories[name];
      if (name !== 'gateway' && !repository) {
        const pool = createMysqlPool(env); pools.push(pool);
        await pool.query('SELECT 1');
        if (name === 'auth') {
          if (!await checkCustomerEmailSchema(pool)) throw new Error('Cần migration 001_users_email được duyệt trước khi chạy Customer.');
        }
        const { createRepository } = await import('../' + folders[name] + '/src/repository.js');
        repository = createRepository(pool);
      }
      const { createApp } = await import('../' + folders[name] + '/src/app.js');
      const port = ports[name] ?? Number(env[name.toUpperCase() + '_PORT'] || defaultPorts[name]);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Cổng không hợp lệ cho ' + name);
      servers[name] = await listen(createApp({ repository, config }), port, config.host);
      config.urls[name] = 'http://' + config.host + ':' + servers[name].address().port;
    }
    return { config, urls: config.urls, servers, close };
  } catch (error) { await close(); throw error; }
}
