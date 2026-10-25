"use client"

import { useEffect, useMemo, useState, type FormEvent } from "react"
import { CheckCircle2Icon, MinusIcon, PackageIcon, PlusIcon, ShoppingBagIcon } from "lucide-react"
import { Button } from "../ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../ui/card"
import { Input } from "../ui/input"
import { formatCurrency } from "@/lib/format"
import { DEMO_PRODUCTS, newDemoId, readDemoCommerce, writeDemoCommerce, type DemoCommerceState } from "../shared/demo-commerce"

const GROUPS = ["tất cả", "nhà ở", "phòng trọ", "dùng chung"] as const

export function ProductStore() {
  const [data, setData] = useState<DemoCommerceState | null>(null)
  const [loadError, setLoadError] = useState("")
  const [saveError, setSaveError] = useState("")
  const [group, setGroup] = useState<(typeof GROUPS)[number]>("tất cả")
  const [cart, setCart] = useState<Record<string, number>>({})
  const [checkout, setCheckout] = useState(false)
  const [completedOrder, setCompletedOrder] = useState("")
  const [contact, setContact] = useState({ name: "", phone: "", address: "" })

  useEffect(() => {
    try { setData(readDemoCommerce()) } catch (error) { setLoadError(error instanceof Error ? error.message : "Không thể tải cửa hàng demo.") }
  }, [])

  const products = useMemo(() => (data?.products ?? DEMO_PRODUCTS).filter(product => product.active && (group === "tất cả" || product.group === group)), [data, group])
  const cartItems = (data?.products ?? []).filter(product => cart[product.id] > 0)
  const total = cartItems.reduce((sum, product) => sum + product.price * cart[product.id], 0)

  function updateCart(productId: string, amount: number) {
    const product = data?.products.find(item => item.id === productId)
    if (!product || amount < 0 || amount > product.stock) return
    setCart(current => ({ ...current, [productId]: amount }))
  }

  function placeOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!data || !cartItems.length) return
    const unavailable = cartItems.find(product => cart[product.id] > product.stock || !product.active)
    if (unavailable) { setSaveError(`${unavailable.name} hiện không đủ tồn kho.`); return }
    const orderId = newDemoId()
    const next: DemoCommerceState = {
      products: data.products.map(product => cart[product.id] ? { ...product, stock: product.stock - cart[product.id] } : product),
      orders: [...data.orders, { id: orderId, createdAt: new Date().toISOString(), customerName: contact.name, phone: contact.phone, address: contact.address, items: cartItems.map(product => ({ productId: product.id, name: product.name, quantity: cart[product.id], unitPrice: product.price })), total }],
    }
    try {
      writeDemoCommerce(next)
      setData(next)
      setCart({})
      setCheckout(false)
      setCompletedOrder(orderId)
      setSaveError("")
    } catch {
      setSaveError("Chưa lưu được đơn mua trong trình duyệt. Đơn hàng chưa được xác nhận.")
    }
  }

  if (loadError) return <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6" role="alert"><h1 className="text-2xl font-bold">Chưa thể mở cửa hàng</h1><p className="mt-3 text-sm text-muted-foreground">{loadError}</p></section>

  return <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 md:py-14">
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="mb-2 text-xs font-semibold tracking-[0.14em] text-primary uppercase">CleanHome / Cửa hàng</p><h1 className="m-0 text-3xl font-bold tracking-tight sm:text-4xl">Sản phẩm tự làm sạch</h1><p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">Vật dụng vệ sinh để bạn tự chăm sóc nhà ở hoặc phòng trọ. Các sản phẩm mua riêng, không cần đặt lịch dịch vụ.</p></div>
      <Button variant="outline" onClick={() => setCheckout(open => !open)}><ShoppingBagIcon aria-hidden="true" />Giỏ hàng ({cartItems.reduce((sum, item) => sum + cart[item.id], 0)}) · {formatCurrency(total)}</Button>
    </div>
    {completedOrder && <div role="status" className="mb-6 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"><CheckCircle2Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" /><p className="m-0">Đã tạo đơn mua demo <strong>{completedOrder}</strong>. Dữ liệu chỉ được lưu trên trình duyệt hiện tại.</p></div>}
    <div className="mb-7 flex flex-wrap gap-2" aria-label="Lọc nhóm sản phẩm">{GROUPS.map(value => <Button key={value} size="sm" variant={group === value ? "default" : "outline"} onClick={() => setGroup(value)}>{value === "tất cả" ? "Tất cả" : value}</Button>)}</div>
    <div className="grid items-stretch gap-5 sm:grid-cols-2 lg:grid-cols-3">{products.map(product => <Card key={product.id} className="rounded-2xl shadow-sm ring-border">
      <CardHeader><div className="mb-2 flex size-12 items-center justify-center rounded-xl bg-blue-50 text-primary"><PackageIcon aria-hidden="true" /></div><CardTitle>{product.name}</CardTitle><CardDescription>{product.description}</CardDescription></CardHeader>
      <CardContent className="mt-auto"><p className="m-0 text-lg font-semibold text-primary">{formatCurrency(product.price)}</p><p className="mt-1 text-xs text-muted-foreground">Dành cho {product.group} · Còn {product.stock}</p></CardContent>
      <CardFooter className="gap-2"><Button className="w-full" disabled={!data || !product.stock || (cart[product.id] ?? 0) >= product.stock} onClick={() => updateCart(product.id, (cart[product.id] ?? 0) + 1)}><PlusIcon aria-hidden="true" />Thêm vào giỏ</Button>{cart[product.id] > 0 && <><Button size="icon" variant="outline" aria-label={`Giảm số lượng ${product.name}`} onClick={() => updateCart(product.id, cart[product.id] - 1)}><MinusIcon aria-hidden="true" /></Button><span className="min-w-6 text-center">{cart[product.id]}</span></>}</CardFooter>
    </Card>)}</div>
    {checkout && <Card className="mt-8 rounded-2xl ring-border"><CardHeader><CardTitle>Thông tin nhận hàng</CardTitle><CardDescription>Đây là đơn mua mô phỏng; chưa có thanh toán hoặc giao hàng thực tế.</CardDescription></CardHeader><CardContent>
      {cartItems.length === 0 ? <p className="m-0 text-sm text-muted-foreground">Giỏ hàng đang trống.</p> : <form className="grid gap-4 sm:grid-cols-2" onSubmit={placeOrder}>
        {([["name", "Họ tên người nhận"], ["phone", "Số điện thoại"], ["address", "Địa chỉ nhận hàng"]] as const).map(([key, label]) => <label key={key} className={`grid gap-2 text-sm font-medium ${key === "address" ? "sm:col-span-2" : ""}`}>{label}<Input required value={contact[key]} onChange={event => setContact(current => ({ ...current, [key]: event.target.value }))} /></label>)}
        <div className="sm:col-span-2"><p className="font-semibold">Tổng cộng: {formatCurrency(total)}</p>{saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}<Button type="submit">Tạo đơn mua demo</Button></div>
      </form>}
    </CardContent></Card>}
  </main>
}
