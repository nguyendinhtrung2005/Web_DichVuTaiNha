"use client"

import { useId } from "react"
import type { PaymentMethod } from "@/lib/types"

export function CheckoutPayment({ value, onChange, disabled = false }: { value: PaymentMethod; onChange: (method: PaymentMethod) => void; disabled?: boolean }) {
  const id = useId()
  return <section className="space-y-3 rounded-xl border border-border bg-slate-50 p-4" aria-label="Thanh toán khi đặt đơn">
    <label htmlFor={id} className="block text-sm font-semibold">Phương thức thanh toán</label>
    <select id={id} className="min-h-12 w-full rounded-xl border border-input bg-white px-3 text-base disabled:opacity-60" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value === "transfer" ? "transfer" : "cash")}>
      <option value="cash">Tiền mặt</option><option value="transfer">Chuyển khoản</option>
    </select>
    <p className="m-0 text-sm leading-6 text-muted-foreground">{value === "cash" ? "Ghi nhận lựa chọn tiền mặt; đơn sẽ hiển thị Chưa thanh toán." : "Ghi nhận lựa chọn chuyển khoản; đơn sẽ hiển thị Chờ xác nhận thanh toán."} Đây là thanh toán mô phỏng, chưa chuyển tiền hoặc xác nhận nhận tiền thật.</p>
  </section>
}
