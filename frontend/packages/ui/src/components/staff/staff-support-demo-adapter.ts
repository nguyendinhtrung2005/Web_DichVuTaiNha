import {
  SupportDemoError, countTickets, defaultSupportFilter, demoTickets, emptySupportDraft, filterTickets, sampleReplyFor, supportSeedTime,
  validateSupportFilter, validateTicket, validateTicketInput, type DemoTicket, type SupportDemoAdapter, type SupportSnapshot, type SupportTicketInput,
} from "./staff-support-demo-model"
export { SupportDemoError } from "./staff-support-demo-model"
function abort(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException("Demo operation aborted", "AbortError") }
function unavailable(): SupportDemoAdapter {
  return {
    kind: "unavailable",
    async list(_filter, signal) { abort(signal); return null },
    async detail(_id, signal) { abort(signal); return null },
    async create(_input, signal) { abort(signal); return null },
    async sampleReply(_id, signal) { abort(signal); return null },
    async reset(signal) { abort(signal); return null },
  }
}
/** Account IDs scope private component instances; tickets are fictional and never come from Auth, bookings or Admin. */
export function createSupportDemoAdapter({ enabled, accountScope }: { enabled: boolean; accountScope: string }): SupportDemoAdapter {
  if (enabled !== true || process.env.NODE_ENV !== "development" || typeof accountScope !== "string" || !/^[1-9]\d{0,18}$/.test(accountScope) || BigInt(accountScope) > 9_223_372_036_854_775_807n) return unavailable()
  let tickets = demoTickets()
  let filter = defaultSupportFilter()
  let nextIndex = tickets.length + 1
  function sorted(values: readonly DemoTicket[]) {
    return values.map(value => validateTicket(value)).sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
  }
  function snapshot(): SupportSnapshot {
    const all = sorted(tickets), filtered = filterTickets(all, filter)
    return { filter: { ...filter }, tickets: all, filtered, counts: countTickets(all), total: all.length }
  }
  async function prepare(signal?: AbortSignal) { abort(signal); await Promise.resolve(); abort(signal) }
  return {
    kind: "demo",
    async list(next, signal) { await prepare(signal); filter = validateSupportFilter(next); return snapshot() },
    async detail(id, signal) {
      await prepare(signal)
      const found = tickets.find(value => value.id === id)
      return found ? validateTicket(found) : null
    },
    async create(input, signal) {
      await prepare(signal)
      const safe = validateTicketInput(input)
      if (nextIndex > 999) throw new SupportDemoError("Bản DEMO đã đạt giới hạn 999 yêu cầu trong phiên này.")
      const at = supportSeedTime(nextIndex - 5)
      const ticket = validateTicket({
        id: "DEMO-SUP-" + String(nextIndex).padStart(3, "0"),
        subject: safe.subject, content: safe.content, topic: safe.topic, priority: safe.priority, relatedJob: safe.relatedJob,
        status: "NEW", createdAt: at, updatedAt: at, responses: [],
        history: [{ status: "NEW", at, note: "Ticket minh họa được tạo trong DEMO; chưa gửi đến Admin." }],
      })
      nextIndex += 1
      tickets = [ticket, ...tickets]
      return { ticket: validateTicket(ticket), snapshot: snapshot() }
    },
    async sampleReply(id, signal) {
      await prepare(signal)
      const found = tickets.find(value => value.id === id)
      return found ? sampleReplyFor(found.topic, found.updatedAt) : null
    },
    async reset(signal) {
      await prepare(signal)
      tickets = demoTickets()
      filter = defaultSupportFilter()
      nextIndex = tickets.length + 1
      return snapshot()
    },
  }
}
export { emptySupportDraft }
export type { SupportTicketInput }
