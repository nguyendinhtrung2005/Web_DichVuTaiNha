import { OrderError } from './domain.js'
const fail = () => { throw new OrderError(400, 'INVALID_REQUEST', 'Thông tin yêu cầu nội bộ không hợp lệ.') }
const entity = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n
const record = value => value && typeof value === 'object' && !Array.isArray(value)
const fields = ['assignmentId', 'employeeId', 'actorUserId', 'fromStatus', 'toStatus']
const next = new Map([['ASSIGNED', 'ACCEPTED'], ['ACCEPTED', 'IN_PROGRESS'], ['IN_PROGRESS', 'DONE']])
export function operationInput(params, payload, actorHeader, key, write = false) {
  if (!record(params) || !entity(params.bookingId) || typeof params.operationId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(params.operationId)
    || !record(payload) || Object.keys(payload).length !== fields.length || !fields.every(field => Object.hasOwn(payload, field))
    || !['assignmentId', 'employeeId', 'actorUserId'].every(field => entity(payload[field]))
    || !next.has(payload.fromStatus) || next.get(payload.fromStatus) !== payload.toStatus || actorHeader !== payload.actorUserId
    || (write && key !== params.operationId)) fail()
  return { id: params.operationId, bookingId: params.bookingId, ...Object.fromEntries(fields.map(field => [field, payload[field]])) }
}
export function pendingLimit(query) {
  if (!record(query) || Object.keys(query).some(key => key !== 'limit') || (query.limit !== undefined && (typeof query.limit !== 'string' || !/^[1-9]\d{0,2}$/.test(query.limit) || Number(query.limit) > 100))) fail()
  return query.limit === undefined ? 20 : Number(query.limit)
}
