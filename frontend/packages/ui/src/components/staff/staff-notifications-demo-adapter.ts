import { cloneNotification, defaultNotifications, isNotificationTime, notificationReport, type DemoNotification, type NotificationDemoAdapter } from "./staff-notifications-demo-model"
export class NotificationDemoUnavailableError extends Error { constructor() { super("Notifications demo unavailable"); this.name = "NotificationDemoUnavailableError" } }
export class NotificationDemoNotFoundError extends Error { constructor() { super("Demo notification not found"); this.name = "NotificationDemoNotFoundError" } }
function abort(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException("Demo operation aborted", "AbortError") }
function unavailable(): NotificationDemoAdapter {
  return { kind: "unavailable", async list(_filter, signal) { abort(signal); return null }, async detail(_id, signal) { abort(signal); return null },
    async markRead(_id, signal) { abort(signal); throw new NotificationDemoUnavailableError() }, async readAll(signal) { abort(signal); throw new NotificationDemoUnavailableError() },
    async reset(signal) { abort(signal); return null } }
}
/** Account ID creates a private instance only; fictional content never comes from Auth or UC events. */
export function createNotificationDemoAdapter({ enabled, accountScope, now = () => new Date() }: { enabled: boolean; accountScope: string; now?: () => Date }): NotificationDemoAdapter {
  if (enabled !== true || process.env.NODE_ENV !== "development" || typeof accountScope !== "string"
    || !/^[1-9]\d{0,18}$/.test(accountScope) || BigInt(accountScope) > 9_223_372_036_854_775_807n) return unavailable()
  let state: DemoNotification[] = defaultNotifications()
  function readTime(minimum: string) {
    const value = now().toISOString()
    if (!isNotificationTime(value) || value < minimum) throw new RangeError("Invalid demo clock")
    return value
  }
  return {
    kind: "demo",
    async list(filter, signal) { abort(signal); await Promise.resolve(); abort(signal); return notificationReport(state, filter) },
    async detail(id, signal) { abort(signal); await Promise.resolve(); abort(signal); const found = state.find(item => item.id === id); return found ? cloneNotification(found) : null },
    async markRead(id, signal) {
      abort(signal); await Promise.resolve(); abort(signal)
      const found = state.find(item => item.id === id)
      if (!found) throw new NotificationDemoNotFoundError()
      if (found.readAt !== null) return notificationReport(state, "all")
      const readAt = readTime(found.createdAt); abort(signal)
      state = state.map(item => item.id === id ? { ...item, readAt } : item)
      return notificationReport(state, "all")
    },
    async readAll(signal) {
      abort(signal); await Promise.resolve(); abort(signal)
      const unread = state.filter(item => item.readAt === null)
      if (!unread.length) return notificationReport(state, "all")
      const minimum = unread.reduce((latest, item) => item.createdAt > latest ? item.createdAt : latest, unread[0].createdAt)
      const readAt = readTime(minimum); abort(signal)
      state = state.map(item => item.readAt === null ? { ...item, readAt } : item)
      return notificationReport(state, "all")
    },
    async reset(signal) { abort(signal); await Promise.resolve(); abort(signal); state = defaultNotifications(); return notificationReport(state, "all") },
  }
}
