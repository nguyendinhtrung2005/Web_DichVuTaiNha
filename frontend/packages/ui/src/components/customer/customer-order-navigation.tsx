import Link from "next/link"
import { CalendarDaysIcon, ShoppingBagIcon } from "lucide-react"

export function CustomerOrderNavigation({ active }: { active: "services" | "products" }) {
  return <nav aria-label="Loại đơn hàng" className="mb-8 grid grid-cols-2 gap-2 rounded-2xl border border-border bg-slate-50 p-2">
    {([
      { key: "services", href: "/don-cua-toi", label: "Lịch dịch vụ", icon: CalendarDaysIcon },
      { key: "products", href: "/don-san-pham", label: "Đơn sản phẩm", icon: ShoppingBagIcon },
    ] as const).map(({ key, href, label, icon: Icon }) => <Link key={key} href={href} aria-current={active === key ? "page" : undefined} className={`flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-xl px-2 py-3 text-center text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${active === key ? "bg-white text-primary shadow-sm" : "text-muted-foreground hover:bg-white"}`}><Icon aria-hidden="true" className="size-4 shrink-0" /><span>{label}</span></Link>)}
  </nav>
}
