import { ORDER_STATUS_LABEL } from "@/lib/config"
import type { Order } from "@/lib/types"
import { orderNextStep } from "./order-guidance"

const steps = ["pending", "confirmed", "in_progress", "completed"] as const

export function OrderProgress({ order }: { order: Order }) {
  const position = steps.findIndex((status) => status === order.status)
  return <section aria-label="Tiến độ lịch dịch vụ" className="mb-8 rounded-2xl border border-border bg-slate-50 p-5 sm:p-6">
    <h2 className="m-0 text-base font-semibold">{order.status === "cancelled" ? "Lịch dịch vụ đã hủy" : "Tiến độ lịch dịch vụ"}</h2>
    {position >= 0 && <ol className="m-0 mt-5 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-4">{steps.map((status, index) => <li key={status} aria-current={index === position ? "step" : undefined} className={`min-w-0 rounded-xl border p-3 text-sm leading-6 ${index === position ? "border-primary bg-white font-semibold text-primary" : index < position ? "border-blue-100 bg-blue-50 text-foreground" : "border-border text-muted-foreground"}`}><span className="mb-1 block text-xs">Bước {index + 1}{index === position ? " · Hiện tại" : index < position ? " · Đã qua" : ""}</span>{ORDER_STATUS_LABEL[status]}</li>)}</ol>}
    <p className="m-0 mt-4 text-sm leading-7 text-muted-foreground">{orderNextStep(order)}</p>
  </section>
}
