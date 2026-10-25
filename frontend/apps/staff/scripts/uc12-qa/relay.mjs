import { createServer, request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'

const MAX_BODY = 1048576
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])
const FAULTS = new Set(['offlineBeforeForward', 'dropPutResponseAfterCommit', 'dropAckBeforeForward', 'dropAckResponseAfterCommit', 'dropStaffResponseAfterCommit'])
const TARGETS = new Set(['ACCEPTED', 'IN_PROGRESS', 'DONE'])
const requestHeaders = new Set(['accept', 'authorization', 'content-type', 'idempotency-key', 'x-actor-user-id', 'x-request-id'])
const responseHeaders = new Set(['content-type', 'cache-control', 'retry-after', 'www-authenticate', 'x-request-id', 'x-content-type-options'])
const id = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const safeError = () => new Error('QA_RELAY_CONFIGURATION_INVALID')
const parseJson = bytes => { try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { return null } }
function identities(values) {
  if (!Array.isArray(values) || !values.length || values.some(value => !id(value)) || new Set(values).size !== values.length) throw safeError()
  return new Set(values)
}
function copiedHeaders(headers, allowlist) {
  return Object.fromEntries(Object.entries(headers).filter(([key, value]) => allowlist.has(key.toLowerCase()) && typeof value === 'string'))
}
function refuse(response, status = 403) {
  if (response.destroyed) return
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify({ error: { code: 'QA_RELAY_SCOPE_DENIED', message: 'QA relay refused this request.' } }))
}
async function requestBody(request) {
  const length = request.headers['content-length']
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) throw new Error('QA_RELAY_BODY_LIMIT')
  const chunks = []; let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY) throw new Error('QA_RELAY_BODY_LIMIT')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/**
 * A QA-only loopback relay. It forwards real replies, or deliberately closes a
 * connection at an armed fault point. It never fabricates a successful response,
 * bypasses Backend authentication, exposes controls over HTTP, or logs secrets.
 */
export async function createFaultRelay({ target, bookingIds, assignmentIds, readAssignmentIds = assignmentIds, name,
  port = 0, timeoutMs = 20000 } = {}) {
  let upstream
  try { upstream = new URL(target) } catch { throw safeError() }
  if (!['http:', 'https:'].includes(upstream.protocol) || target !== upstream.origin || !LOOPBACK.has(upstream.hostname)
    || upstream.username || upstream.password || !['order', 'staff'].includes(name)
    || !Number.isInteger(port) || port < 0 || port > 65535 || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw safeError()
  const bookings = identities(bookingIds), assignments = identities(assignmentIds), readAssignments = identities(readAssignmentIds)
  if ([...assignments].some(value => !readAssignments.has(value))) throw safeError()
  const records = [], sockets = new Set(), upstreamRequests = new Set()
  let armed = null, origin = null, nextRequest = 0, closed = false
  const append = event => {
    records.push({ at: new Date().toISOString(), relay: name, ...event })
    if (records.length > 10000) records.shift()
  }
  function route(request, body) {
    if (typeof request.url !== 'string' || !request.url.startsWith('/') || request.url.startsWith('//')) return null
    let url
    try { url = new URL(request.url, origin) } catch { return null }
    if (url.origin !== origin || url.hash) return null
    const method = request.method, path = url.pathname
    if (method === 'GET' && ['/health/live', '/health/ready'].includes(path) && !url.search) return { method, path, search: '', type: 'health' }
    if (name === 'order') {
      const found = /^\/internal\/v1\/bookings\/([1-9]\d{0,18})\/assignment-transitions\/([A-Za-z0-9_-]{1,128})(\/acknowledgement)?$/.exec(path)
      if (found) {
        const [, bookingId, operationId, ack] = found
        if (!id(bookingId) || !bookings.has(bookingId) || !(ack ? method === 'POST' : ['GET', 'PUT'].includes(method))) return null
        const payload = method === 'GET' ? Object.fromEntries(url.searchParams) : parseJson(body)
        // Every transition forwarded by this QA relay must stay in its manifest.
        if (!object(payload) || !assignments.has(payload.assignmentId) || (method !== 'GET' && url.search)) return null
        return { method, path, search: url.search, type: ack ? 'ack' : method === 'PUT' ? 'apply' : 'lookup', bookingId, assignmentId: payload.assignmentId, operationId, targetStatus: payload.toStatus }
      }
      const context = /^\/internal\/v1\/bookings\/([1-9]\d{0,18})\/staff-context$/.exec(path)
      if (method === 'GET' && context && bookings.has(context[1]) && !url.search) return { method, path, search: '', type: 'context', bookingId: context[1] }
      // In particular, no global pending queue/worker request is proxied.
      return null
    }
    if (method === 'GET' && ['/api/v1/staff/me/jobs', '/api/v1/staff/me/schedule'].includes(path)) return { method, path, search: url.search, type: 'list' }
    const found = /^\/api\/v1\/staff\/me\/jobs\/([1-9]\d{0,18})(\/status)?$/.exec(path)
    if (!found || !id(found[1]) || url.search) return null
    const [, assignmentId, status] = found
    if (!status && method === 'GET' && readAssignments.has(assignmentId)) return { method, path, search: '', type: 'detail', assignmentId }
    if (status && method === 'PATCH' && assignments.has(assignmentId)) {
      const payload = parseJson(body)
      return { method, path, search: '', type: 'status', assignmentId, targetStatus: payload?.status }
    }
    return null
  }
  function matches(fault, request) {
    if (!fault || ['health', 'list', 'detail', 'context'].includes(request.type)) return false
    return ['bookingId', 'assignmentId', 'operationId', 'targetStatus'].every(field => fault[field] === undefined || fault[field] === request[field])
  }
  function consume(fault, request) {
    if (armed !== fault || !matches(fault, request)) return false
    if (typeof fault.remaining === 'number' && --fault.remaining === 0) armed = null
    return true
  }
  function committedReply(request, response) {
    const value = parseJson(response.body)
    if (request.type === 'apply') return response.status === 200 && object(value) && value.operationId === request.operationId
      && value.bookingId === request.bookingId && value.assignmentId === request.assignmentId && value.assignmentStatus === request.targetStatus && typeof value.occurredAt === 'string'
    if (request.type === 'ack') return response.status === 200 && object(value) && value.operationId === request.operationId
      && value.bookingId === request.bookingId && value.assignmentId === request.assignmentId && value.acknowledged === true
    return request.type === 'status' && [200, 202].includes(response.status) && object(value?.data)
      && value.data.assignmentId === request.assignmentId && value.data.transition?.requestedStatus === request.targetStatus
      && ['SYNCHRONIZED', 'PENDING_ACKNOWLEDGEMENT'].includes(value.data.transition?.synchronization)
  }
  function forward(request, body, routeInfo) {
    return new Promise((resolve, reject) => {
      const call = (upstream.protocol === 'https:' ? httpsRequest : httpRequest)(new URL(routeInfo.path + routeInfo.search, upstream), {
        method: request.method, headers: { ...copiedHeaders(request.headers, requestHeaders), ...(body.length ? { 'content-length': String(body.length) } : {}) },
        timeout: timeoutMs,
      }, response => {
        const chunks = []; let size = 0
        response.on('data', chunk => { size += chunk.length; if (size > MAX_BODY) { response.destroy(); call.destroy(new Error('QA_RELAY_REPLY_LIMIT')) } else chunks.push(chunk) })
        response.once('error', () => reject(new Error('QA_RELAY_UPSTREAM_FAILURE')))
        response.once('end', () => resolve({ status: response.statusCode, headers: copiedHeaders(response.headers, responseHeaders), body: Buffer.concat(chunks) }))
      })
      const deadline = setTimeout(() => call.destroy(new Error('QA_RELAY_TIMEOUT')), timeoutMs)
      upstreamRequests.add(call)
      call.once('close', () => { clearTimeout(deadline); upstreamRequests.delete(call) })
      call.once('timeout', () => call.destroy(new Error('QA_RELAY_TIMEOUT')))
      call.once('error', () => reject(new Error('QA_RELAY_UPSTREAM_FAILURE')))
      call.end(body)
    })
  }
  const server = createServer(async (request, response) => {
    const requestId = ++nextRequest
    let info
    try {
      const bytes = await requestBody(request)
      info = route(request, bytes)
      if (!info) { append({ requestId, event: 'scope-denied', method: request.method }); refuse(response); return }
      const safeInfo = { requestId, method: info.method, path: info.path, ...(info.bookingId ? { bookingId: info.bookingId } : {}),
        ...(info.assignmentId ? { assignmentId: info.assignmentId } : {}), ...(info.operationId ? { operationId: info.operationId } : {}), ...(TARGETS.has(info.targetStatus) ? { targetStatus: info.targetStatus } : {}) }
      const fault = armed
      if (matches(fault, info) && (fault.kind === 'offlineBeforeForward' || fault.kind === 'dropAckBeforeForward' && info.type === 'ack') && consume(fault, info)) {
        append({ ...safeInfo, event: 'fault-before-forward', kind: fault.kind }); response.destroy(); return
      }
      append({ ...safeInfo, event: 'forwarded' })
      const reply = await forward(request, bytes, info)
      append({ ...safeInfo, event: 'upstream-response', status: reply.status })
      const kindFits = fault?.kind === 'dropPutResponseAfterCommit' && info.type === 'apply'
        || fault?.kind === 'dropAckResponseAfterCommit' && info.type === 'ack'
        || fault?.kind === 'dropStaffResponseAfterCommit' && info.type === 'status'
      if (kindFits && matches(fault, info) && committedReply(info, reply) && consume(fault, info)) {
        append({ ...safeInfo, event: 'fault-after-committed-response', kind: fault.kind, status: reply.status }); response.destroy(); return
      }
      if (!response.destroyed) { response.writeHead(reply.status, reply.headers); response.end(reply.body) }
    } catch {
      append({ requestId, event: 'connection-failed', ...(info ? { method: info.method, path: info.path } : {}) })
      response.destroy()
    }
  })
  server.requestTimeout = 5000; server.headersTimeout = 5000
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve() }) })
  origin = 'http://127.0.0.1:' + server.address().port
  if (new URL(origin).port === upstream.port) { await new Promise(resolve => server.close(resolve)); throw safeError() }
  return Object.freeze({
    origin,
    arm(options) {
      if (closed || !object(options) || !FAULTS.has(options.kind) || Object.keys(options).some(key => !['kind', 'bookingId', 'assignmentId', 'operationId', 'targetStatus', 'count'].includes(key))
        || (!options.bookingId && !options.assignmentId && !options.operationId)
        || (options.bookingId !== undefined && !bookings.has(options.bookingId)) || (options.assignmentId !== undefined && !assignments.has(options.assignmentId))
        || (options.operationId !== undefined && (typeof options.operationId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(options.operationId)))
        || (options.targetStatus !== undefined && !TARGETS.has(options.targetStatus))
        || (options.count !== undefined && options.count !== 'untilClear' && (!Number.isInteger(options.count) || options.count < 1 || options.count > 100))
        || (name === 'order' ? options.kind === 'dropStaffResponseAfterCommit' : options.kind !== 'dropStaffResponseAfterCommit' && options.kind !== 'offlineBeforeForward')) throw safeError()
      armed = { ...options, remaining: options.count === 'untilClear' ? null : options.count || 1 }
      append({ event: 'armed', kind: options.kind, ...(options.bookingId ? { bookingId: options.bookingId } : {}), ...(options.assignmentId ? { assignmentId: options.assignmentId } : {}) })
    },
    clear() { armed = null; append({ event: 'cleared' }) },
    events() { return structuredClone(records) },
    async close() {
      if (closed) return
      closed = true; armed = null
      for (const call of upstreamRequests) call.destroy()
      for (const socket of sockets) socket.destroy()
      await new Promise(resolve => server.close(resolve))
    },
  })
}
