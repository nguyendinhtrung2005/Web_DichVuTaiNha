import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
try {
  await mkdir('secrets', { recursive: true, mode: 0o700 })
  await writeFile('secrets/staff-service.token', randomBytes(32).toString('base64url') + '\n', { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify({ event: 'internal_service_credential_created', file: 'secrets/staff-service.token', contentsPrinted: false }))
} catch { console.error('Credential generation refused or failed; existing files preserved and secret contents withheld.'); process.exitCode = 1 }
