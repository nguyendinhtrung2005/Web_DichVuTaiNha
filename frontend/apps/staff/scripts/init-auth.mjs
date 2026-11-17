import { mkdir, open, lstat, readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { loadStaffAuthConfig } from '../lib/server/config.mjs'

try {
  const config = loadStaffAuthConfig()
  await mkdir(dirname(config.keyFile), { recursive: true, mode: 0o700 })
  await mkdir(config.sessionDir, { recursive: true, mode: 0o700 })
  for (const location of [dirname(config.keyFile), config.sessionDir]) {
    const info = await lstat(location)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Private storage must be a real directory')
  }
  try {
    const info = await lstat(config.keyFile)
    if (!info.isFile() || info.isSymbolicLink() || (await readFile(config.keyFile)).length !== 32) throw new Error('Existing session key is invalid; it was not overwritten')
    console.log(JSON.stringify({ event: 'staff_session_storage_ready', keyAlreadyPresent: true, keyContentsPrinted: false }))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    const key = randomBytes(32)
    const file = await open(resolve(config.keyFile), 'wx', 0o600)
    try { await file.writeFile(key); await file.sync() } finally { key.fill(0); await file.close() }
    console.log(JSON.stringify({ event: 'staff_session_storage_initialized', keyAlreadyPresent: false, keyContentsPrinted: false }))
  }
} catch {
  console.error('Staff session initialization failed. Existing keys and sessions were preserved; verify private storage configuration and permissions.')
  process.exitCode = 1
}
