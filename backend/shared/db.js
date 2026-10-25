const mysql = require("mysql2/promise")

let pool

function getPool() {
  if (pool) return pool
  const required = ["MYSQL_HOST", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"]
  const missing = required.filter((name) => !process.env[name])
  if (missing.length) throw new Error(`Missing database configuration: ${missing.join(", ")}`)
  pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    database: process.env.MYSQL_DATABASE,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: "Z",
    decimalNumbers: true,
    charset: "utf8mb4",
  })
  return pool
}

async function inTransaction(work) {
  const connection = await getPool().getConnection()
  try {
    await connection.beginTransaction()
    const result = await work(connection)
    await connection.commit()
    return result
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

module.exports = { getPool, inTransaction }
