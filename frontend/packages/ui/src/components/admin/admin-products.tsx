"use client"

import { useEffect, useState, type FormEvent } from "react"
import { PackageIcon, PlusIcon } from "lucide-react"
import { Button } from "../ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card"
import { Input } from "../ui/input"
import { formatCurrency } from "@/lib/format"
import { newDemoId, readDemoCommerce, writeDemoCommerce, type DemoCommerceState, type DemoProduct, type ProductGroup } from "../shared/demo-commerce"

const EMPTY = { name: "", description: "", group: "dùng chung" as ProductGroup, price: "30000", stock: "0" }

export function AdminProducts() {
  const [data, setData] = useState<DemoCommerceState | null>(null)
  const [error, setError] = useState("")
  const [draft, setDraft] = useState(EMPTY)
  const [stockDraft, setStockDraft] = useState<Record<string, string>>({})

  useEffect(() => {
    try { setData(readDemoCommerce()) } catch (reason) { setError(reason instanceof Error ? reason.message : "Không thể tải danh mục sản phẩm demo.") }
  }, [])

  function updateProduct(product: DemoProduct, changes: Partial<DemoProduct>) {
    if (!data) return
    const next = { ...data, products: data.products.map(item => item.id === product.id ? { ...item, ...changes } : item) }
    try { writeDemoCommerce(next); setData(next); setError("") } catch { setError("Không lưu được thay đổi. Dữ liệu cũ vẫn được giữ nguyên.") }
  }

  function addProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!data) return
    if (!Number.isFinite(Number(draft.price)) || Number(draft.price) < 0 || !Number.isInteger(Number(draft.stock)) || Number(draft.stock) < 0) {
      setError("Giá bán và tồn kho phải là số hợp lệ, không âm; tồn kho phải là số nguyên.")
      return
    }
    const product: DemoProduct = { id: newDemoId(), ...draft, price: Number(draft.price), stock: Number(draft.stock), active: true }
    const next = { ...data, products: [...data.products, product] }
    try { writeDemoCommerce(next); setData(next); setDraft(EMPTY); setError("") } catch { setError("Không lưu được sản phẩm mới. Dữ liệu cũ vẫn được giữ nguyên.") }
  }

  if (error && !data) return <section role="alert"><h1>Chưa thể tải kho sản phẩm</h1><p>{error}</p></section>
  if (!data) return <p role="status">Đang tải kho sản phẩm demo…</p>

  return <div className="space-y-6">
    <header><p className="mb-2 text-xs font-semibold tracking-[0.12em] text-primary uppercase">CleanHome / Quản lý</p><h1 className="m-0 text-2xl font-bold sm:text-3xl">Sản phẩm & tồn kho</h1><p className="mt-3 text-sm leading-7 text-muted-foreground">Quản lý danh mục vật dụng khách hàng mua để tự vệ sinh nhà ở hoặc phòng trọ.</p></header>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</p>}
    <Card className="rounded-2xl"><CardHeader><CardTitle>Thêm sản phẩm</CardTitle><CardDescription>Sản phẩm không thuộc danh mục dịch vụ đặt lịch.</CardDescription></CardHeader><CardContent><form onSubmit={addProduct} className="grid gap-4 sm:grid-cols-2">
      <label className="grid gap-2 text-sm font-medium">Tên sản phẩm<Input required value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} /></label>
      <label className="grid gap-2 text-sm font-medium">Nhóm sử dụng<select className="h-11 rounded-xl border border-input bg-white px-3" value={draft.group} onChange={event => setDraft(current => ({ ...current, group: event.target.value as ProductGroup }))}><option value="nhà ở">Nhà ở</option><option value="phòng trọ">Phòng trọ</option><option value="dùng chung">Dùng chung</option></select></label>
      <label className="grid gap-2 text-sm font-medium sm:col-span-2">Mô tả<Input required value={draft.description} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))} /></label>
      <label className="grid gap-2 text-sm font-medium">Giá bán (₫)<Input required type="number" min="0" value={draft.price} onChange={event => setDraft(current => ({ ...current, price: event.target.value }))} /></label>
      <label className="grid gap-2 text-sm font-medium">Tồn kho ban đầu<Input required type="number" min="0" value={draft.stock} onChange={event => setDraft(current => ({ ...current, stock: event.target.value }))} /></label>
      <Button type="submit" className="sm:col-span-2"><PlusIcon aria-hidden="true" />Thêm sản phẩm</Button>
    </form></CardContent></Card>
    <div className="grid gap-4">{data.products.map(product => <Card key={product.id} className="rounded-2xl"><CardContent className="grid gap-4 p-5 sm:grid-cols-[1fr_auto_auto] sm:items-center">
      <div className="flex min-w-0 items-start gap-3"><span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-primary"><PackageIcon aria-hidden="true" /></span><div className="min-w-0"><h2 className="m-0 break-words text-base font-semibold">{product.name}</h2><p className="mt-1 text-sm text-muted-foreground">{product.description}</p><p className="mt-1 text-xs text-muted-foreground">Nhóm: {product.group} · {formatCurrency(product.price)}</p></div></div>
      <label className="grid gap-1 text-sm font-medium">Tồn kho<Input aria-label={`Tồn kho ${product.name}`} type="number" min="0" step="1" value={stockDraft[product.id] ?? String(product.stock)} onChange={event => setStockDraft(current => ({ ...current, [product.id]: event.target.value }))} onBlur={() => {
        const value = stockDraft[product.id]
        if (value === undefined) return
        if (!/^\d+$/.test(value)) { setError("Tồn kho phải là số nguyên không âm."); setStockDraft(current => ({ ...current, [product.id]: String(product.stock) })); return }
        updateProduct(product, { stock: Number(value) })
        setStockDraft(current => { const next = { ...current }; delete next[product.id]; return next })
      }} /></label>
      <Button variant={product.active ? "outline" : "default"} onClick={() => updateProduct(product, { active: !product.active })}>{product.active ? "Ngừng bán" : "Mở bán"}</Button>
    </CardContent></Card>)}</div>
    <section aria-labelledby="product-orders-heading" className="space-y-4">
      <div><h2 id="product-orders-heading" className="m-0 text-xl font-semibold">Đơn mua demo</h2><p className="mt-2 text-sm text-muted-foreground">Đơn được lưu trong trình duyệt hiện tại; các website Customer/Admin riêng không đồng bộ khi chưa có backend.</p></div>
      {data.orders.length ? data.orders.slice().reverse().map(order => <Card key={order.id} className="rounded-2xl"><CardContent className="p-5"><div className="flex flex-wrap justify-between gap-2"><strong>{order.id}</strong><span className="text-sm text-muted-foreground">{new Date(order.createdAt).toLocaleString("vi-VN")}</span></div><p className="mt-3 mb-1 font-medium">{order.customerName} · {order.phone}</p><p className="m-0 text-sm text-muted-foreground">{order.address}</p><ul className="mt-3 space-y-1 text-sm">{order.items.map(item => <li key={`${order.id}-${item.productId}`}>{item.name} × {item.quantity} — {formatCurrency(item.unitPrice * item.quantity)}</li>)}</ul><p className="mb-0 font-semibold">Tổng: {formatCurrency(order.total)}</p></CardContent></Card>) : <p className="m-0 rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Chưa có đơn mua trên website/trình duyệt hiện tại.</p>}
    </section>
  </div>
}
