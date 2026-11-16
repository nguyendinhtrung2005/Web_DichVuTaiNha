import type { AppState } from './types'

export type MigrationCollection = 'users' | 'services' | 'orders' | 'payments' | 'reviews'
export interface MigrationIssue { collection: string; id?: string; fields?: string[]; message: string }
export type MigrationValidation = { ok: true; state: AppState } | { ok: false; issues: MigrationIssue[] }
const collections: MigrationCollection[] = ['users', 'services', 'orders', 'payments', 'reviews']
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown) => typeof value === 'string'
const required = (value: unknown) => text(value) && (value as string).trim().length > 0
const optionalText = (value: unknown) => value === undefined || text(value)
const date = (value: unknown) => required(value) && Number.isFinite(new Date(value as string).getTime())
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0
const strings = (value: unknown) => Array.isArray(value) && value.every(text)
const member = (value: unknown, values: string[]) => typeof value === 'string' && values.includes(value)
const safeId = (value: unknown) => required(value) && !['__proto__', 'constructor', 'prototype'].includes(value as string)

/** Read-only validation. Issues identify fields, never their private values. */
export function validateMigrationState(value: unknown, options: { references?: boolean } = {}): MigrationValidation {
  const issues: MigrationIssue[] = []
  const fail = (collection: string, message: string, id?: string, fields?: string[]) => issues.push({ collection, message, id, fields })
  if (!object(value) || value.version !== 2) return { ok: false, issues: [{ collection: 'snapshot', message: 'Phiên bản dữ liệu chưa được hỗ trợ.' }] }
  if (!collections.every(key => Array.isArray(value[key])) || !object(value.passwordHashes)) return { ok: false, issues: [{ collection: 'snapshot', message: 'Thiếu danh sách dữ liệu hoặc thông tin xác thực cần thiết.' }] }
  for (const key of collections) {
    const ids = new Set<string>()
    const codes = new Set<string>()
    for (const record of value[key] as unknown[]) {
      if (!object(record) || !safeId(record.id)) { fail(key, 'Bản ghi thiếu mã định danh hợp lệ.'); continue }
      const id = record.id as string
      if (ids.has(id)) fail(key, 'Mã định danh bị trùng.', id, ['id'])
      ids.add(id)
      if (['users', 'orders', 'payments'].includes(key)) {
        if (!required(record.code)) fail(key, 'Mã bản ghi không hợp lệ.', id, ['code'])
        else if (codes.has(record.code as string)) fail(key, 'Mã bản ghi bị trùng.', id, ['code'])
        else codes.add(record.code as string)
      }
      let valid = true
      if (key === 'users') valid = ['name', 'phone', 'email', 'address'].every(field => text(record[field])) && required(record.email)
        && member(record.role, ['customer', 'staff', 'admin']) && member(record.status, ['active', 'locked']) && date(record.createdAt)
        && optionalText(record.avatar) && optionalText(record.position)
      if (key === 'services') valid = ['slug', 'name', 'shortDesc', 'description', 'unit', 'quantityLabel', 'image'].every(field => text(record[field])) && required(record.slug)
        && member(record.category, ['dinh-ky', 'chuyen-sau', 'noi-that', 'thiet-bi']) && member(record.status, ['active', 'inactive'])
        && ['scope', 'included', 'excluded'].every(field => strings(record[field]))
        && ['price', 'minQuantity', 'defaultQuantity', 'minutesPerUnit', 'baseMinutes'].every(field => number(record[field]))
      if (key === 'orders') {
        const contact = record.contact
        const cancel = record.cancelRequest
        valid = ['customerId', 'serviceId', 'specialRequest'].every(field => text(record[field])) && required(record.customerId) && required(record.serviceId)
          && ['quantity', 'durationMinutes', 'price'].every(field => number(record[field])) && date(record.scheduledAt) && date(record.createdAt)
          && member(record.status, ['pending', 'confirmed', 'in_progress', 'completed', 'cancelled']) && optionalText(record.staffId)
          && (record.jobStatus === undefined || member(record.jobStatus, ['waiting', 'accepted', 'in_progress', 'done']))
          && object(contact) && ['name', 'phone', 'address'].every(field => text(contact[field])) && member(contact.houseType, ['can-ho', 'nha-pho', 'biet-thu', 'van-phong'])
          && typeof contact.hasPets === 'boolean' && ['area', 'rooms', 'floors'].every(field => contact[field] === undefined || number(contact[field]))
          && Array.isArray(record.history) && record.history.every(entry => object(entry) && date(entry.at) && text(entry.label) && text(entry.by) && optionalText(entry.note))
          && Array.isArray(record.staffNotes) && record.staffNotes.every(entry => object(entry) && date(entry.at) && text(entry.text) && required(entry.staffId))
          && (cancel === undefined || (object(cancel) && text(cancel.reason) && date(cancel.requestedAt) && member(cancel.status, ['pending', 'approved', 'rejected']) && optionalText(cancel.adminNote) && (cancel.resolvedAt === undefined || date(cancel.resolvedAt))))
      }
      if (key === 'payments') valid = required(record.orderId) && number(record.amount) && member(record.method, ['cash', 'transfer'])
        && member(record.status, ['unpaid', 'pending', 'paid']) && date(record.createdAt) && (record.confirmedAt === undefined || date(record.confirmedAt))
        && (record.refundRequired === undefined || typeof record.refundRequired === 'boolean')
      if (key === 'reviews') valid = ['orderId', 'customerId', 'serviceId'].every(field => required(record[field])) && optionalText(record.staffId)
        && ['serviceRating', 'staffRating'].every(field => Number.isInteger(record[field]) && (record[field] as number) >= 1 && (record[field] as number) <= 5)
        && text(record.comment) && date(record.createdAt) && typeof record.hidden === 'boolean' && optionalText(record.hiddenReason)
      if (!valid) fail(key, 'Cấu trúc, ngày, trạng thái hoặc giá trị số của bản ghi không hợp lệ.', id)
    }
  }
  const users = (value.users as unknown[]).filter(object)
  const userIds = new Set(users.map(user => user.id))
  const emails = new Set<string>()
  for (const user of users) {
    if (typeof user.email === 'string') {
      const email = user.email.trim().toLowerCase()
      if (emails.has(email)) fail('users', 'Email được sử dụng bởi nhiều tài khoản.', text(user.id) ? user.id as string : undefined, ['email'])
      emails.add(email)
    }
    if (!required(value.passwordHashes[user.id as string])) fail('users', 'Thiếu thông tin xác thực của tài khoản.', text(user.id) ? user.id as string : undefined, ['authentication'])
  }
  for (const id of Object.keys(value.passwordHashes)) if (!userIds.has(id)) fail('users', 'Thông tin xác thực không có tài khoản tương ứng.', id, ['authentication'])
  const slugs = new Set<string>()
  for (const service of (value.services as unknown[]).filter(object)) {
    if (text(service.slug)) { if (slugs.has(service.slug as string)) fail('services', 'Đường dẫn dịch vụ bị trùng.', service.id as string, ['slug']); slugs.add(service.slug as string) }
  }
  if (issues.length) return { ok: false, issues }
  const state = value as unknown as AppState
  if (options.references !== false) {
    const userRoles = new Map(state.users.map(user => [user.id, user.role]))
    const serviceIds = new Set(state.services.map(service => service.id))
    const orders = new Map(state.orders.map(order => [order.id, order]))
    const hasUser = (id: string, role: string) => userRoles.get(id) === role
    for (const order of state.orders) {
      if (!hasUser(order.customerId, 'customer')) fail('orders', 'Khách hàng liên quan bị thiếu hoặc sai vai trò.', order.id, ['customerId'])
      if (!serviceIds.has(order.serviceId)) fail('orders', 'Dịch vụ liên quan bị thiếu.', order.id, ['serviceId'])
      if (order.staffId && !hasUser(order.staffId, 'staff')) fail('orders', 'Nhân viên liên quan bị thiếu hoặc sai vai trò.', order.id, ['staffId'])
      for (const note of order.staffNotes) if (!hasUser(note.staffId, 'staff')) fail('orders', 'Nhân viên ghi chú bị thiếu hoặc sai vai trò.', order.id, ['staffNotes'])
    }
    const paymentOrders = new Set<string>()
    for (const payment of state.payments) {
      if (!orders.has(payment.orderId)) fail('payments', 'Đơn của khoản thanh toán bị thiếu.', payment.id, ['orderId'])
      if (paymentOrders.has(payment.orderId)) fail('payments', 'Có nhiều bản ghi thanh toán cho cùng một đơn; cần đối chiếu nguồn.', payment.id, ['orderId'])
      paymentOrders.add(payment.orderId)
    }
    const reviewOrders = new Set<string>()
    for (const review of state.reviews) {
      const order = orders.get(review.orderId)
      if (!order || order.customerId !== review.customerId || order.serviceId !== review.serviceId || (review.staffId && order.staffId !== review.staffId)) fail('reviews', 'Quan hệ giữa đánh giá và đơn dịch vụ không khớp.', review.id, ['orderId', 'customerId', 'serviceId', 'staffId'])
      if (!hasUser(review.customerId, 'customer') || !serviceIds.has(review.serviceId) || (review.staffId && !hasUser(review.staffId, 'staff'))) fail('reviews', 'Tài khoản hoặc dịch vụ của đánh giá bị thiếu.', review.id)
      if (reviewOrders.has(review.orderId)) fail('reviews', 'Có nhiều đánh giá cho cùng một đơn; cần đối chiếu nguồn.', review.id, ['orderId'])
      reviewOrders.add(review.orderId)
    }
  }
  return issues.length ? { ok: false, issues } : { ok: true, state }
}

export function canonicalSnapshot(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalSnapshot).join(',')}]`
  if (object(value)) return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonicalSnapshot(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

export interface MigrationSource { id: string; name: string; state: AppState; checksum: string; origin: string; key: string }
export interface MigrationConflict { key: string; collection: MigrationCollection; id: string; fields: string[]; sources: { id: string; name: string }[] }
export interface MigrationPreview { state: AppState; conflicts: MigrationConflict[]; issues: MigrationIssue[]; unresolved: number; duplicateCount: number; counts: Record<MigrationCollection, number> }

/** Select whole records only; user records always travel with their own authentication entry. */
export function previewMigration(sources: MigrationSource[], choices: Record<string, string> = {}): MigrationPreview {
  const state: AppState = { version: 2, users: [], services: [], orders: [], payments: [], reviews: [], passwordHashes: {}, session: null }
  const conflicts: MigrationConflict[] = []
  let duplicateCount = 0
  let unresolved = 0
  for (const collection of collections) {
    const groups = new Map<string, { source: MigrationSource; record: Record<string, unknown>; fingerprint: string }[]>()
    for (const source of sources) for (const record of source.state[collection]) {
      const copy = record as unknown as Record<string, unknown>
      const fingerprint = canonicalSnapshot(collection === 'users' ? { record, authentication: source.state.passwordHashes[record.id] } : record)
      const group = groups.get(record.id) ?? []
      group.push({ source, record: copy, fingerprint }); groups.set(record.id, group)
    }
    for (const [id, group] of groups) {
      const variants = group.filter((item, index) => group.findIndex(other => other.fingerprint === item.fingerprint) === index)
      duplicateCount += group.length - variants.length
      const key = `${collection}:${id}`
      let selected = variants[0]
      if (variants.length > 1) {
        const fields = [...new Set(variants.flatMap(item => Object.keys(item.record)))].filter(field => variants.some(item => canonicalSnapshot(item.record[field]) !== canonicalSnapshot(variants[0].record[field])))
        if (collection === 'users' && variants.some(item => item.source.state.passwordHashes[id] !== variants[0].source.state.passwordHashes[id])) fields.push('authentication')
        conflicts.push({ key, collection, id, fields, sources: variants.map(item => ({ id: item.source.id, name: item.source.name })) })
        const choice = group.find(item => item.source.id === choices[key])
        if (!choice) { unresolved++; continue }
        selected = choice
      }
      ;(state[collection] as unknown as Record<string, unknown>[]).push(JSON.parse(JSON.stringify(selected.record)) as Record<string, unknown>)
      if (collection === 'users') state.passwordHashes[id] = selected.source.state.passwordHashes[id]
    }
  }
  const validation = validateMigrationState(state)
  const counts = Object.fromEntries(collections.map(key => [key, state[key].length])) as Record<MigrationCollection, number>
  return { state, conflicts, issues: validation.ok ? [] : validation.issues, unresolved, duplicateCount, counts }
}

export interface PrivateBackup { kind: 'cleanhome-private-backup'; backupVersion: 1; source: { role: string; origin: string; key: string }; createdAt: string; checksum: string; raw: string }
export async function snapshotChecksum(raw: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Trình duyệt chưa hỗ trợ kiểm tra tính toàn vẹn của bản sao lưu.')
  const result = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join('')
}
export async function createPrivateBackup(raw: string, source: PrivateBackup['source']): Promise<PrivateBackup> {
  return { kind: 'cleanhome-private-backup', backupVersion: 1, source, createdAt: new Date().toISOString(), checksum: await snapshotChecksum(raw), raw }
}
export async function parsePrivateBackup(content: string, id: string, name: string): Promise<MigrationSource> {
  let backup: unknown
  try { backup = JSON.parse(content) } catch { throw new Error('File sao lưu không phải JSON hợp lệ.') }
  if (!object(backup) || backup.kind !== 'cleanhome-private-backup' || backup.backupVersion !== 1 || !text(backup.raw) || !text(backup.checksum) || !object(backup.source) || !text(backup.source.origin) || !text(backup.source.key)) throw new Error('File không đúng định dạng sao lưu CleanHome.')
  if (await snapshotChecksum(backup.raw as string) !== backup.checksum) throw new Error('Nội dung file không khớp kiểm tra tính toàn vẹn.')
  let parsed: unknown
  try { parsed = JSON.parse(backup.raw as string) } catch { throw new Error('Bản sao lưu giữ nguyên dữ liệu nguồn, nhưng nguồn chưa đọc được để nhập.') }
  if (object(parsed) && parsed.schemaVersion === 1 && object(parsed.data)) parsed = parsed.data
  const validation = validateMigrationState(parsed, { references: false })
  if (!validation.ok) throw new Error(`Dữ liệu chưa hợp lệ: ${validation.issues[0].message}`)
  return { id, name, state: { ...validation.state, session: null }, checksum: backup.checksum as string, origin: backup.source.origin as string, key: backup.source.key as string }
}
