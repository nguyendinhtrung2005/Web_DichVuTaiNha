import { createHash, randomUUID } from 'node:crypto'
import { AuthBffError } from './auth-core.mjs'
import { STAFF_CONVERSATION_LIMITS as limits } from '../../../../packages/ui/src/components/staff/staff-support-conversation.mjs'

const hash = value => createHash('sha256').update(value).digest('hex')
const expired = () => { throw new AuthBffError(410, 'SUPPORT_CONVERSATION_EXPIRED', 'Hội thoại đã kết thúc. Hãy bắt đầu hội thoại mới.') }
/** Volatile, session-bound context. Never persisted, returned to the browser, or keyed by raw SID. */
export function createSupportConversationStore({ now = Date.now, maximum = 500 } = {}) {
  const entries = new Map()
  function drop(id) { const row = entries.get(id); if (row) clearTimeout(row.timer); entries.delete(id) }
  function sweep() { for (const [id, row] of entries) if (row.until <= now()) drop(id) }
  function open(sid, accountId, id, expiresAt, maxTurns = limits.turns) {
    sweep()
    const session = hash(sid), owner = hash(sid + ':' + accountId)
    let row = id && entries.get(id)
    if (id && (!row || row.owner !== owner)) expired()
    if (!row) {
      if (entries.size >= maximum) throw new AuthBffError(429, 'SUPPORT_CONTEXT_CAPACITY', 'Trợ lý đang bận. Vui lòng thử lại sau.')
      const sessionEnd = Date.parse(expiresAt), until = Math.min(now() + limits.ttlMs, Number.isFinite(sessionEnd) ? sessionEnd : Infinity)
      if (until <= now()) expired()
      row = { id: randomUUID(), owner, session, until, turns: 0, messages: [], maxTurns: maxTurns === 30 ? 30 : limits.turns }
      row.timer = setTimeout(() => drop(row.id), until - now()); row.timer.unref?.()
      entries.set(row.id, row)
    }
    row.maxTurns = Math.min(row.maxTurns || limits.turns, maxTurns === 30 ? 30 : limits.turns)
    if (row.turns >= row.maxTurns) throw new AuthBffError(400, 'SUPPORT_CONVERSATION_LIMIT', `Đã đạt giới hạn ${row.maxTurns} lượt. Hãy bắt đầu cuộc trò chuyện mới; hạn mức theo tài khoản vẫn áp dụng.`)
    return row
  }
  return {
    open,
    commit(row, message, answer) {
      if (entries.get(row.id) !== row || row.until <= now()) expired()
      row.turns++
      row.messages.push({ role: 'user', content: message }, { role: 'assistant', content: answer })
      while (row.messages.length > limits.contextPairs * 2 || Buffer.byteLength(JSON.stringify(row.messages)) > limits.contextBytes) row.messages.splice(0, 2)
    },
    clearSession(sid) { if (!sid) return; const session = hash(sid); for (const [id, row] of entries) if (row.session === session) drop(id) },
    clear(sid, accountId, id) { const row = entries.get(id); if (row && row.owner === hash(sid + ':' + accountId)) drop(id) },
    size() { sweep(); return entries.size },
  }
}
// Next route bundles/hot reloads share this process-local store, including logout.
const key = Symbol.for('cleanhome.staff.support-conversation.v1')
export const staffSupportConversations = globalThis[key] ||= createSupportConversationStore()
