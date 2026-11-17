import type { Order, Service } from "@/lib/types"

export function customerBookingHref(serviceId?: string, rebookId?: string) {
  const path = serviceId ? `/dat-dich-vu/${encodeURIComponent(serviceId)}` : "/dat-dich-vu"
  return rebookId === undefined ? path : `${path}?rebook=${encodeURIComponent(rebookId)}`
}

export function bookingLoginHref(serviceId?: string, rebookId?: string) {
  return `/dang-nhap?next=${encodeURIComponent(customerBookingHref(serviceId, rebookId))}`
}

export function bookingDraftRoute(serviceId?: string, rebookId?: string) {
  return JSON.stringify({ serviceId: serviceId ?? null, rebookId: rebookId ?? null })
}

export function resolveBookingRoute({ serviceId, rebookId, services, orders, customerId }: {
  serviceId?: string
  rebookId?: string
  services: Service[]
  orders: Order[]
  customerId: string
}): { initialService?: Service; previous?: Order; invalidRebook: boolean } {
  const previous = rebookId === undefined ? undefined : orders.find((order) => order.id === rebookId && order.customerId === customerId)
  // Path IDs always identify services. A previous order is used only when the
  // caller explicitly asks to rebook that owned order for the same service.
  if (rebookId !== undefined && (!rebookId || !serviceId || !previous || previous.serviceId !== serviceId)) {
    return { invalidRebook: true }
  }
  const initialService = serviceId
    ? services.find((service) => service.id === serviceId && service.status === "active")
    : services.find((service) => service.status === "active")
  return { initialService, previous, invalidRebook: false }
}
