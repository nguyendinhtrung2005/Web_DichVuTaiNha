import mysql from 'mysql2/promise'

export function createPool(config) {
  return mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionLimit: config.connectionLimit,
    waitForConnections: true,
    queueLimit: 100,
    connectTimeout: 10000,
    timezone: 'Z',
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    multipleStatements: false,
    charset: 'utf8mb4',
  })
}

import { createMysqlPool } from "../../shared/mysql-pool.js";
import { createLazyPool } from "../../shared/lazy-pool.js";
// Preserve the main pool export without initializing DB_* configuration in Staff imports.
export const pool = createLazyPool(createMysqlPool);
