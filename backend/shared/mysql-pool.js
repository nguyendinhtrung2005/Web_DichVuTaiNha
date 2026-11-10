import mysql from 'mysql2/promise';

function required(name, env, trim = true) {
  const raw = env[name];
  const value = trim ? raw?.trim() : raw;
  if (!value) throw new Error(`Thiếu cấu hình bắt buộc ${name} trong backend/.env.`);
  return value;
}

function positiveInteger(name, fallback, maximum, env) {
  const raw = env[name] ?? String(fallback);
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} phải là số nguyên từ 1 đến ${maximum}.`);
  }
  return parsed;
}

export function createMysqlPool(env = process.env) {
  const host = required('DB_HOST', env);
  const user = required('DB_USER', env);
  const password = required('DB_PASSWORD', env, false);
  const database = required('DB_NAME', env);
  const port = positiveInteger('DB_PORT', 3306, 65535, env);
  const connectionLimit = positiveInteger('DB_CONNECTION_LIMIT', 5, 50, env);

  const pool = mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    charset: 'utf8mb4',
    timezone: 'Z',
    supportBigNumbers: true,
    bigNumberStrings: true,
    decimalNumbers: false,
    waitForConnections: true,
    connectionLimit,
    queueLimit: 0,
    connectTimeout: 5000,
    multipleStatements: false,
  });
  // Keep TIMESTAMP values and CURRENT_TIMESTAMP consistent with JS ISO UTC.
  pool.on('connection', (connection) => {
    connection.query("SET time_zone = '+00:00'", (error) => { if (error) connection.destroy(); });
  });
  return pool;
}
