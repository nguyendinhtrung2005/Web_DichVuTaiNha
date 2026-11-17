import { createRequire } from 'node:module'
import { readFile, writeFile, rename, lstat, realpath } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

export const qaDirectory = dirname(fileURLToPath(import.meta.url))
export const repoRoot = resolve(qaDirectory, '../..')
export const privateDirectory = join(qaDirectory, '.private')
export const configFile = join(privateDirectory, 'runtime-config.json')
export const stateFile = join(privateDirectory, 'owned-processes.json')
export const requireStaff = createRequire(join(repoRoot, 'backend/staff-service/package.json'))
export const mysql = requireStaff('mysql2/promise')
export const assert = (condition, code) => { if (!condition) throw Error(code) }
export const wait = ms => new Promise(done => setTimeout(done, ms))
export const within = (parent, child) => { const part = relative(parent, child); return part !== '' && !part.startsWith('..' + sep) && part !== '..' && !part.includes(':' ) }
export async function writeJson(file, value) {
  assert(within(privateDirectory, resolve(file)), 'QA_PRIVATE_WRITE_OUTSIDE_DIRECTORY')
  const temporary = file + '.' + randomUUID() + '.tmp'
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  await rename(temporary, file)
}
export async function assertPrivatePath(candidate) {
  const target = resolve(candidate)
  assert(target === privateDirectory || within(privateDirectory, target), 'QA_PRIVATE_PATH_OUTSIDE_DIRECTORY')
  const rootStat = await lstat(privateDirectory)
  assert(rootStat.isDirectory() && !rootStat.isSymbolicLink(), 'QA_PRIVATE_DIRECTORY_SYMLINK_DENIED')
  const samePath = (left, right) => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
  assert(samePath(await realpath(privateDirectory), privateDirectory), 'QA_PRIVATE_DIRECTORY_REALPATH_MISMATCH')
  let current = privateDirectory
  for (const segment of relative(privateDirectory, target).split(sep).filter(Boolean)) {
    current = join(current, segment)
    let info
    try { info = await lstat(current) } catch (error) { if (error.code === 'ENOENT') return; throw error }
    assert(!info.isSymbolicLink(), 'QA_PRIVATE_CHILD_SYMLINK_DENIED')
    assert(samePath(await realpath(current), current), 'QA_PRIVATE_CHILD_REALPATH_MISMATCH')
  }
}
export async function loadConfig() {
  await assertPrivatePath(configFile)
  const config = JSON.parse(await readFile(configFile, 'utf8'))
  assert(config.kind === 'cleanhome.staff-qa-isolated' && config.version === 1 && config.isolated === true, 'ISOLATED_QA_CONFIG_REQUIRED')
  assert(config.db.database === 'cleanhome_staff_qa_isolated' && config.db.host === '127.0.0.1' && config.db.port !== 3306
    && config.db.port >= 1024 && config.db.port <= 65535, 'ISOLATED_QA_DATABASE_REQUIRED')
  assert(resolve(config.mysql.dataDir) === join(privateDirectory, 'mysql/data'), 'ISOLATED_QA_DATADIR_REQUIRED')
  for (const value of Object.values(config.paths)) await assertPrivatePath(value)
  await assertPrivatePath(config.mysql.dataDir)
  for (const key of ['frontendOrigin', 'authOrigin', 'orderOrigin', 'staffOrigin']) {
    const url = new URL(config[key])
    assert(['localhost', '127.0.0.1'].includes(url.hostname) && url.protocol === 'http:' && url.origin === config[key]
      && !['3002', '3306', '4001', '4003', '4005', '4015'].includes(url.port), 'ISOLATED_QA_SERVICE_ORIGIN_REQUIRED')
  }
  for (let directory = privateDirectory; directory !== qaDirectory; directory = dirname(directory)) {
    const stat = await lstat(directory)
    assert(!stat.isSymbolicLink() && stat.isDirectory(), 'QA_PRIVATE_DIRECTORY_SYMLINK_DENIED')
  }
  assert(await realpath(privateDirectory) === privateDirectory, 'QA_PRIVATE_DIRECTORY_REALPATH_MISMATCH')
  return config
}
export async function verifyDatabase(connection, config) {
  await assertPrivatePath(config.mysql.dataDir)
  const [[identity]] = await connection.query('SELECT @@port AS port, @@datadir AS dataDir, @@server_uuid AS serverUuid')
  const actual = await realpath(identity.dataDir), expected = await realpath(config.mysql.dataDir)
  assert(actual.toLowerCase() === expected.toLowerCase() && Number(identity.port) === config.db.port, 'ISOLATED_MYSQL_IDENTITY_MISMATCH')
  if (config.mysql.serverUuid) assert(identity.serverUuid === config.mysql.serverUuid, 'ISOLATED_MYSQL_UUID_MISMATCH')
  return identity
}
