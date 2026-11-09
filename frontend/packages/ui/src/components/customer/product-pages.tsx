"use client"

import { CheckoutPayment } from "./checkout-payment"
import { CustomerImage } from "./customer-image"

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeftIcon, ArrowRightIcon, RefreshCwIcon, ShoppingCartIcon, Trash2Icon } from "lucide-react"
import { addProductToCart, createProductOrder, getProductCartSnapshot, getProduct, getProducts, getProductOrder, getProductOrders, retryProductOrder, getProductPurchaseSnapshot, getServerProductPurchaseSnapshot, subscribeProductPurchase, retryPendingProductOrder, removeProductFromCart, subscribeProductCart, updateProductCartQuantity } from "@/lib/product-commerce"
import { ApiError, apiRequest } from "@/lib/api-client"
import { formatCurrency } from "@/lib/format"
import type { Product, ProductCartItem, ProductOrder, ProductOrderItem, PaymentMethod } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useData } from "../../common"

type ProductCategory = { id: string; name: string }
type Page<T> = { items: T[]; total: number; page: number; limit: number }
const serverCart: ProductCartItem[] = []
const PRODUCT_ORDER_STATUS = {
  processing: "Đang xác minh tồn kho",
  pending: "Đã ghi nhận, chờ xử lý",
  failed: "Chưa tạo được đơn",
} as const
function productOrderFailureMessage(code: string) {
  const messages: Record<string, string> = {
    PRICE_CHANGED: "Đơn giá đã thay đổi. Hãy xem giá mới trong giỏ và xác nhận yêu cầu mua mới nếu bạn đồng ý. Chưa giữ hàng hoặc thanh toán.",
    PRICE_CONFIRMATION_REQUIRED: "Cần xem đơn giá hiện tại và xác nhận yêu cầu mua mới. Chưa giữ hàng hoặc thanh toán.",
    OUT_OF_STOCK: "Sản phẩm không còn đủ số lượng. Hãy kiểm tra tồn kho, giảm số lượng hoặc xóa mặt hàng hết hàng trước khi đặt lại.",
    PRODUCT_UNAVAILABLE: "Một sản phẩm đã ngừng bán hoặc không còn trong danh mục. Hãy cập nhật giỏ hàng trước khi tiếp tục.",
    RESERVATION_RELEASED: "Lần giữ hàng của đơn này đã được giải phóng. Bạn có thể xem lại sản phẩm và chủ động tạo yêu cầu mua mới.",
    RESERVATION_KEY_REUSED: "Mã giữ hàng cần được kiểm tra. Vui lòng liên hệ hỗ trợ với mã đơn này trước khi tạo thêm đơn.",
    ORDER_LIMIT_EXCEEDED: "Số lượng hoặc tổng tiền vượt giới hạn đặt mua. Hãy giảm số lượng trong giỏ và xác nhận yêu cầu mua mới.",
    INVALID_INPUT: "Thông tin đơn chưa phù hợp. Hãy kiểm tra giỏ hàng và thông tin liên hệ; nếu lỗi tiếp tục, liên hệ hỗ trợ.",
    PRODUCT_SCHEMA_NOT_READY: "Tính năng mua sản phẩm chưa được cấu hình đầy đủ. Vui lòng thử lại sau.",
  }
  return messages[code] || "Chưa thể ghi nhận đơn mua sản phẩm. Hãy kiểm tra lại trạng thái đơn hoặc liên hệ hỗ trợ trước khi tạo yêu cầu mới."
}
const priceFailure = (code?: string) => ["PRICE_CHANGED", "PRICE_CONFIRMATION_REQUIRED"].includes(code || "")
const terminalProductFailure = (code?: string) => priceFailure(code) || ["RESERVATION_RELEASED", "RESERVATION_KEY_REUSED", "ORDER_LIMIT_EXCEEDED", "INVALID_INPUT"].includes(code || "")

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "Không thể tải dữ liệu. Vui lòng thử lại."
}

function useCartProducts() {
  const cart = useSyncExternalStore(subscribeProductCart, getProductCartSnapshot, () => serverCart)
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [missing, setMissing] = useState<Record<string, string>>({})
  const [revision, setRevision] = useState(0)
  const reload = useCallback(() => setRevision((current) => current + 1), [])
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setProducts([])
    setMissing({})
    setError("")
    if (!cart.length) { setLoading(false); return }
    setLoading(true)
    Promise.all(cart.map(async (item) => {
      try { return { product: await getProduct(item.productId, controller.signal), id: item.productId } }
      catch (reason) { return { error: reason, id: item.productId } }
    })).then((results) => {
      if (!active) return
      setProducts(results.flatMap((result) => result.product ? [result.product] : []))
      setMissing(Object.fromEntries(results.filter((result) => result.error instanceof ApiError && result.error.status === 404).map((result) => [result.id, "Sản phẩm đã ngừng bán hoặc không còn trong danh mục. Hãy xóa sản phẩm này để tiếp tục."])))
      const failure = results.find((result) => result.error && !(result.error instanceof ApiError && result.error.status === 404))
      if (failure) setError(messageOf(failure.error))
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false; controller.abort() }
  }, [cart, revision])
  const byId = useMemo(() => new Map(products.map((product) => [product.id, product])), [products])
  const valid = cart.length > 0 && !loading && !error && cart.every((item) => {
    const product = byId.get(item.productId)
    return product?.status === "available" && Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= product.stock
  })
  const total = cart.reduce((sum, item) => {
    const product = byId.get(item.productId)
    return product ? sum + product.price * item.quantity : sum
  }, 0)
  return { cart, byId, loading, error, missing, reload, valid, total }
}

function CartQuantity({ item, product }: { item: ProductCartItem; product?: Product }) {
  const [draft, setDraft] = useState(String(item.quantity))
  const [error, setError] = useState("")
  useEffect(() => { setDraft(String(item.quantity)); setError("") }, [item.quantity])
  const commit = () => {
    if (!product) return
    const quantity = /^[1-9]\d*$/.test(draft) ? Number(draft) : NaN
    const result = updateProductCartQuantity(product, quantity)
    if (!result.ok) { setDraft(String(item.quantity)); setError(result.error) }
    else setError("")
  }
  const controlId = "quantity-" + item.productId
  return <div className="max-w-52"><label className="sr-only" htmlFor={controlId}>{"Số lượng " + (product?.name ?? item.productId)}</label><Input id={controlId} type="number" inputMode="numeric" min={1} max={Math.min(product?.stock ?? 999, 999)} value={draft} disabled={!product} onChange={(event) => { setDraft(event.target.value); setError("") }} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit() } }} aria-invalid={Boolean(error)} aria-describedby={error ? controlId + "-error" : undefined} className="w-24" />{error && <p id={controlId + "-error"} role="alert" className="mt-2 text-xs leading-5 text-rose-700">{error}</p>}</div>
}

function PendingPurchaseNotice({ onResolved }: { onResolved?: (order: ProductOrder) => void }) {
  const { user } = useData()
  const router = useRouter()
  const purchase = useSyncExternalStore(subscribeProductPurchase, getProductPurchaseSnapshot, getServerProductPurchaseSnapshot)
  const [error, setError] = useState("")
  const pending = purchase.pending
  if (!pending || !user || pending.customerId !== user.id) return null
  return <section className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-5" aria-label="Khôi phục yêu cầu sản phẩm"><h2 className="m-0 text-lg font-semibold">Có yêu cầu sản phẩm chưa xác nhận</h2><p className="mt-3 text-sm leading-6">Yêu cầu đã gửi gồm {pending.items.length} sản phẩm, liên hệ {pending.contact.name}. Bạn có thể kiểm tra lại đúng yêu cầu này dù đã thay đổi giỏ hàng hoặc thông tin liên hệ. Hệ thống sẽ dùng lại mã yêu cầu để tránh tạo đơn trùng.</p><Button variant="outline" disabled={purchase.busy} onClick={async () => {
    setError("")
    try {
      const order = await retryPendingProductOrder(user.id)
      if (onResolved) onResolved(order)
      else router.push("/don-san-pham/" + encodeURIComponent(order.id))
    } catch (reason) { setError(messageOf(reason)) }
  }}>{purchase.busy ? "Đang xác nhận yêu cầu…" : "Kiểm tra yêu cầu đã gửi"}</Button>{error && <p role="alert" className="mt-3 text-sm text-rose-800">{error}</p>}</section>
}

function ProductImage({ product, className = "", sizes = "(min-width: 1024px) 384px, (min-width: 640px) 50vw, 100vw" }: { product: Product; className?: string; sizes?: string }) {
  const [failed, setFailed] = useState(false)
  const src = !failed && product.image ? product.image : "/placeholder.svg"
  return <CustomerImage src={src} alt={product.name} width={960} height={640} sizes={sizes} loading="lazy" onError={() => setFailed(true)} className={`h-full w-full object-cover ${className}`} />
}

function addOne(product: Product) {
  const result = addProductToCart(product, 1)
  if (result.ok) toast.success(`${product.name} đã được thêm vào giỏ tùy chọn.`)
  else toast.error(result.error)
}

function ProductCard({ product }: { product: Product }) {
  return (
    <Card className="h-full overflow-hidden rounded-2xl pt-0 shadow-sm ring-border">
      <Link href={`/san-pham/${product.slug}`} className="block aspect-[3/2] overflow-hidden bg-muted" aria-label={`Xem ${product.name}`}>
        <ProductImage product={product} />
      </Link>
      <CardHeader className="gap-2">
        <p className="m-0 text-xs font-medium text-muted-foreground">{product.categoryName || "Sản phẩm"}</p>
        <h2 className="m-0 text-lg leading-6 font-semibold"><Link href={`/san-pham/${product.slug}`} className="hover:text-primary">{product.name}</Link></h2>
        <p className="m-0 line-clamp-2 min-h-12 text-sm leading-6 text-muted-foreground">{product.description}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="m-0 text-lg font-semibold text-primary">{formatCurrency(product.price)} <span className="text-sm font-normal text-muted-foreground">/ {product.unit}</span></p>
        <p className="m-0 text-sm text-muted-foreground">{product.status === "available" ? `Còn ${product.stock} ${product.unit}` : product.status === "inactive" ? "Sản phẩm ngừng bán" : "Tạm hết hàng"}</p>
        <Button className="w-full" disabled={product.status !== "available"} onClick={() => addOne(product)}>
          <ShoppingCartIcon aria-hidden="true" />Thêm vào giỏ
        </Button>
      </CardContent>
    </Card>
  )
}

export function Products({ slug }: { slug?: string }) {
  return slug ? <ProductDetail slug={slug} /> : <ProductCatalog />
}

function ProductCatalog() {
  const { s } = useData()
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<ProductCategory[]>([])
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState("")
  const [submittedQuery, setSubmittedQuery] = useState("")
  const [serviceId, setServiceId] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError("")
    Promise.all([
      getProducts({ q: submittedQuery, category, serviceId }),
      apiRequest<ProductCategory[]>("/catalog/product-categories"),
    ]).then(([result, groups]) => {
      if (!Array.isArray(groups) || groups.some((item) => typeof item.id !== "string" || typeof item.name !== "string")) {
        throw new ApiError("Danh mục sản phẩm từ API không đúng định dạng.", 502, "INVALID_RESPONSE")
      }
      if (active) { setProducts(result); setCategories(groups) }
    }).catch((reason: unknown) => { if (active) setError(messageOf(reason)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [submittedQuery, category, serviceId, revision])

  return (
    <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 md:py-14">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-5">
        <div className="max-w-3xl">
          <p className="m-0 mb-3 text-xs font-semibold tracking-[0.14em] text-primary uppercase">Sản phẩm CleanHome</p>
          <h1 className="m-0 text-3xl leading-tight font-bold tracking-tight sm:text-4xl">Sản phẩm dùng tại nhà</h1>
          <p className="m-0 mt-4 text-base leading-7 text-muted-foreground">Chọn mua riêng các vật dụng và sản phẩm chăm sóc nhà cửa. Mua sản phẩm không yêu cầu đặt lịch dịch vụ.</p>
        </div>
        <Button variant="outline" render={<Link href="/don-san-pham" />} nativeButton={false}>Đơn mua sản phẩm</Button>
      </header>
      <form className="mb-7 grid gap-4 rounded-2xl border border-border bg-slate-50 p-5 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_1fr_1fr_auto]" role="search" onSubmit={(event) => { event.preventDefault(); setSubmittedQuery(query.trim()) }}>
        <label className="grid gap-2 text-sm font-medium">Tìm sản phẩm
          <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tên hoặc mô tả sản phẩm" />
        </label>
        <label className="grid gap-2 text-sm font-medium">Nhóm sản phẩm
          <select className="min-h-11 rounded-xl border border-input bg-white px-3" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">Tất cả nhóm</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-medium">Dịch vụ liên quan<select className="min-h-11 rounded-xl border border-input bg-white px-3" value={serviceId} onChange={(event) => setServiceId(event.target.value)}><option value="">Mọi dịch vụ / mua riêng</option>{s.services.filter((service) => service.status === "active").map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
        <Button type="submit" className="self-end"><RefreshCwIcon aria-hidden="true" />Tìm sản phẩm</Button>
      </form>
      {error ? <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-900"><p>{error}</p><Button variant="outline" onClick={() => setRevision((value) => value + 1)}>Thử tải lại</Button></div>
        : loading ? <p role="status" className="py-10 text-center text-muted-foreground">Đang tải danh sách sản phẩm…</p>
          : products.length ? <div className="grid items-stretch gap-6 sm:grid-cols-2 lg:grid-cols-3">{products.map((product) => <ProductCard key={product.id} product={product} />)}</div>
            : <div className="rounded-2xl border border-dashed border-border bg-slate-50 p-10 text-center"><h2 className="m-0 text-xl font-semibold">Không có sản phẩm phù hợp</h2><p className="mt-3 text-sm text-muted-foreground">Danh sách hiện không có mặt hàng khớp với bộ lọc này.</p></div>}
    </section>
  )
}

function ProductDetail({ slug }: { slug: string }) {
  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true)
    setError("")
    getProduct(slug)
      .then((result) => { if (active) setProduct(result) })
      .catch((reason: unknown) => { if (active) setError(messageOf(reason)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [slug, revision])
  if (loading) return <p role="status" className="mx-auto max-w-6xl px-4 py-16 text-center">Đang tải sản phẩm…</p>
  if (error || !product) return <section className="mx-auto max-w-3xl px-4 py-16 text-center" role="alert"><h1 className="text-2xl font-semibold">Chưa thể tải sản phẩm</h1><p className="my-5 text-muted-foreground">{error || "Sản phẩm không tồn tại."}</p><div className="flex justify-center gap-3"><Button variant="outline" onClick={() => setRevision((value) => value + 1)}>Thử lại</Button><Button render={<Link href="/san-pham" />} nativeButton={false}>Xem sản phẩm</Button></div></section>
  return (
    <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6 md:py-12">
      <Button variant="ghost" render={<Link href="/san-pham" />} nativeButton={false}><ArrowLeftIcon aria-hidden="true" />Danh sách sản phẩm</Button>
      <div className="mt-5 grid items-start gap-8 md:grid-cols-2">
        <div className="aspect-[4/3] overflow-hidden rounded-2xl bg-muted"><ProductImage product={product} sizes="(min-width: 1024px) 576px, (min-width: 640px) 50vw, 100vw" /></div>
        <div className="space-y-5">
          <p className="m-0 text-sm text-muted-foreground">{product.categoryName} · Mã {product.code}</p>
          <h1 className="m-0 text-3xl font-bold">{product.name}</h1>
          <p className="m-0 whitespace-pre-line leading-7 text-muted-foreground">{product.description || "Chưa có mô tả chi tiết cho sản phẩm này."}</p>
          <p className="m-0 text-2xl font-semibold text-primary">{formatCurrency(product.price)} <span className="text-base font-normal text-muted-foreground">/ {product.unit}</span></p>
          <p className="m-0 text-sm text-muted-foreground">{product.status === "available" ? `Còn ${product.stock} ${product.unit}` : product.status === "inactive" ? "Sản phẩm đã ngừng kinh doanh." : "Sản phẩm hiện hết hàng."}</p>
          <Button size="lg" disabled={product.status !== "available"} onClick={() => addOne(product)}><ShoppingCartIcon aria-hidden="true" />Thêm vào giỏ</Button>
          {product.relatedServiceIds.length > 0 && <div className="rounded-xl border border-border bg-slate-50 p-4"><p className="m-0 text-sm font-semibold">Dịch vụ liên quan</p><p className="m-0 mt-1 text-sm text-muted-foreground">Sản phẩm này có thể mua riêng, không cần đặt dịch vụ.</p><div className="mt-2 flex flex-wrap gap-3">{product.relatedServiceIds.map((id) => <Link key={id} href={`/dich-vu/${id}`} className="text-sm font-medium text-primary underline">Xem dịch vụ {id}</Link>)}</div></div>}
        </div>
      </div>
    </section>
  )
}

export function ProductSuggestions({ serviceId }: { serviceId: string }) {
  const [products, setProducts] = useState<Product[]>([])
  const [error, setError] = useState("")
  useEffect(() => {
    let active = true
    getProducts({ serviceId }).then((items) => { if (active) setProducts(items.filter((item) => item.status === "available").slice(0, 3)) })
      .catch((reason: unknown) => { if (active) setError(messageOf(reason)) })
    return () => { active = false }
  }, [serviceId])
  if (error) return <section className="mt-12 rounded-2xl border border-amber-200 bg-amber-50 p-5" role="alert"><h2 className="m-0 text-lg font-semibold">Chưa thể tải sản phẩm gợi ý</h2><p className="m-0 mt-2 text-sm">{error}</p></section>
  if (!products.length) return null
  return <section className="mt-14 border-t border-border pt-10" aria-labelledby="optional-products-heading">
    <p className="m-0 text-xs font-semibold tracking-wide text-primary uppercase">Mua thêm tùy chọn</p>
    <h2 id="optional-products-heading" className="m-0 mt-2 text-2xl font-semibold">Sản phẩm liên quan</h2>
    <p className="m-0 mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">Các sản phẩm dưới đây chỉ là gợi ý mua thêm. Không bắt buộc và không được thêm vào đơn đặt lịch nếu bạn chưa chủ động chọn.</p>
    <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{products.map((product) => <ProductCard key={product.id} product={product} />)}</div>
  </section>
}

export function ProductCartPage() {
  const { cart, byId, loading, error, missing, reload, valid, total } = useCartProducts()
  if (!cart.length) return <><PendingPurchaseNotice /><section className="mx-auto max-w-3xl px-4 py-16 text-center"><ShoppingCartIcon className="mx-auto size-10 text-muted-foreground" aria-hidden="true" /><h1 className="mt-4 text-2xl font-semibold">Giỏ sản phẩm đang trống</h1><p className="my-4 text-muted-foreground">Bạn có thể mua sản phẩm riêng, không cần đặt lịch dịch vụ.</p><Button render={<Link href="/san-pham" />} nativeButton={false}>Khám phá sản phẩm<ArrowRightIcon aria-hidden="true" /></Button></section></>
  return (
    <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <PendingPurchaseNotice />
      <header className="mb-7"><h1 className="m-0 text-3xl font-bold">Giỏ sản phẩm</h1><p className="m-0 mt-3 text-sm text-muted-foreground">Giỏ hàng này tách biệt với đơn đặt lịch dịch vụ; sản phẩm chỉ được đặt khi bạn xác nhận checkout.</p></header>
      {error && <div role="alert" className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4"><p>{error}</p><Button variant="outline" onClick={() => reload()}>Tải lại tồn kho</Button></div>}
      {loading && <p role="status">Đang kiểm tra giá và tồn kho hiện tại…</p>}
      <div className="space-y-4">{cart.map((item) => {
        const product = byId.get(item.productId)
        const unavailable = !product || product.status !== "available" || item.quantity > product.stock
        return <Card key={item.productId} className="rounded-2xl"><CardContent className="grid gap-4 p-5 sm:grid-cols-[6rem_minmax(0,1fr)_auto] sm:items-center">
          {product && <div className="aspect-square overflow-hidden rounded-xl bg-muted"><ProductImage product={product} /></div>}
          <div className="min-w-0"><h2 className="m-0 text-lg font-semibold">{product?.name || `Sản phẩm mã ${item.productId}`}</h2><p className="m-0 mt-1 text-sm text-muted-foreground">{product ? `${formatCurrency(product.price)} / ${product.unit} · Còn ${product.stock}` : "Chưa tải được thông tin sản phẩm."}</p>{unavailable && <p className="m-0 mt-2 text-sm font-medium text-rose-700">{missing[item.productId] || (product?.status === "inactive" ? "Sản phẩm đã ngừng bán. Hãy xóa sản phẩm này để tiếp tục." : "Sản phẩm hết hàng hoặc số lượng vượt tồn kho; vui lòng cập nhật giỏ.")}</p>}</div>
          <div className="flex items-center gap-2"><CartQuantity item={item} product={product} /><Button variant="outline" size="icon" aria-label={`Xóa ${product?.name ?? item.productId} khỏi giỏ`} onClick={() => removeProductFromCart(item.productId)}><Trash2Icon aria-hidden="true" /></Button></div>
        </CardContent></Card>
      })}</div>
      <div className="mt-7 flex flex-col gap-5 rounded-2xl bg-slate-50 p-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="m-0 text-sm text-muted-foreground">Tạm tính theo dữ liệu hiện tải</p><p className="m-0 mt-1 text-2xl font-bold text-primary">{formatCurrency(total)}</p><p className="m-0 mt-2 text-xs text-muted-foreground">Giá và tồn kho sẽ được máy chủ kiểm tra lại khi tạo đơn.</p></div><div className="flex flex-col gap-3 sm:flex-row"><Button variant="outline" render={<Link href="/san-pham" />} nativeButton={false}>Mua thêm</Button><Button size="lg" disabled={!valid} render={<Link href="/thanh-toan-san-pham" />} nativeButton={false}>Tiếp tục đặt mua<ArrowRightIcon aria-hidden="true" /></Button></div></div>
    </section>
  )
}

export function ProductCheckoutPage() {
  const { user } = useData()
  const router = useRouter()
  const { cart, byId, loading, error, missing, reload, valid, total } = useCartProducts()
  const [contact, setContact] = useState({ name: user?.name ?? "", phone: user?.phone ?? "", address: user?.address ?? "", note: "" })
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState("")
  const [created, setCreated] = useState<ProductOrder | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash")
  const purchase = useSyncExternalStore(subscribeProductPurchase, getProductPurchaseSnapshot, getServerProductPurchaseSnapshot)
  useEffect(() => {
    setContact((value) => ({ ...value, name: value.name || user?.name || "", phone: value.phone || user?.phone || "", address: value.address || user?.address || "" }))
  }, [user])
  const resolved = (order: ProductOrder) => {
    if (order.payment) setPaymentMethod(order.payment.method)
    if (order.status === "failed" && priceFailure(order.errorCode)) {
      setCreated(null)
      setSubmitError(productOrderFailureMessage(order.errorCode!))
      reload()
      return
    }
    setCreated(order)
  }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting || !valid || !user) return
    setSubmitting(true)
    setSubmitError("")
    try {
      const order = await createProductOrder({
        name: contact.name.trim(), phone: contact.phone.trim(),
        ...(contact.address.trim() ? { address: contact.address.trim() } : {}),
        ...(contact.note.trim() ? { note: contact.note.trim() } : {}),
      }, user.id, Object.fromEntries([...byId].map(([id, product]) => [id, product.price])), paymentMethod)
      resolved(order)
      if (order.status === "pending") toast.success("Đơn mua sản phẩm đã được ghi nhận.")
      if (order.status === "failed") toast.error("Chưa tạo được đơn. Bạn có thể kiểm tra và thử lại.")
    } catch (reason) { setSubmitError(messageOf(reason)); if (reason instanceof ApiError && priceFailure(reason.code)) reload() }
    finally { setSubmitting(false) }
  }
  if (!cart.length && !created && !purchase.pending) return <section className="mx-auto max-w-3xl px-4 py-16 text-center"><h1 className="text-2xl font-semibold">Không có sản phẩm để đặt mua</h1><Button render={<Link href="/san-pham" />} nativeButton={false}>Quay lại sản phẩm</Button></section>
  if (created) return <section className="mx-auto max-w-3xl px-4 py-16">
    <Card className="rounded-2xl"><CardContent className="p-6 sm:p-8">
      <p className="m-0 text-xs font-semibold tracking-wide text-primary uppercase">Đơn mua sản phẩm riêng</p>
      <h1 className="m-0 mt-2 text-2xl font-bold">{created.status === "pending" ? "Đã ghi nhận đơn sản phẩm" : created.status === "processing" ? "Đang xác minh đơn sản phẩm" : "Chưa tạo được đơn sản phẩm"}</h1>
      <p className="m-0 mt-3 text-sm leading-6 text-muted-foreground">Mã đơn {created.code}. {created.status === "pending" ? "Đơn đang chờ xử lý; trạng thái này không xác nhận đã thanh toán hoặc vận chuyển." : created.status === "processing" ? "Hệ thống đang đối chiếu tồn kho. Không gửi lại yêu cầu mới; hãy kiểm tra trạng thái đơn." : "Đơn chưa được tạo thành công. Hãy xem thông tin lỗi hoặc thử lại cùng mã đơn."}</p>
      {created.errorCode && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{productOrderFailureMessage(created.errorCode)} <span className="block pt-2 text-xs">Mã lỗi: {created.errorCode}</span></p>}
      <ProductPayment order={created} />
      <div className="mt-6 flex flex-wrap gap-3"><Button render={<Link href={`/don-san-pham/${created.id}`} />} nativeButton={false}>Xem đơn hàng</Button>{created.status === "failed" && !terminalProductFailure(created.errorCode) && <Button variant="outline" onClick={async () => {
        setSubmitting(true)
        try { const order = await retryProductOrder(created.id); setCreated(order) }
        catch (reason) { setSubmitError(messageOf(reason)) }
        finally { setSubmitting(false) }
      }} disabled={submitting}>Thử lại đơn này</Button>}{created.status === "failed" && <Button variant="outline" render={<Link href="/gio-hang" />} nativeButton={false}>Kiểm tra giỏ hàng</Button>}<Button variant="ghost" render={<Link href="/san-pham" />} nativeButton={false}>Tiếp tục xem sản phẩm</Button></div>
      {submitError && <p role="alert" className="mt-4 text-sm text-rose-700">{submitError}</p>}
    </CardContent></Card>
  </section>
  return (
    <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <PendingPurchaseNotice onResolved={resolved} />
      <header className="mb-7"><h1 className="m-0 text-3xl font-bold">Xác nhận mua sản phẩm</h1><p className="m-0 mt-3 text-sm leading-6 text-muted-foreground">Không cần chọn ngày giờ dịch vụ. Thông tin liên hệ dùng để CleanHome trao đổi về đơn; hiện chưa tích hợp thanh toán hoặc vận chuyển thật.</p></header>
      {error && <div role="alert" className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4"><p>{error}</p><Button variant="outline" onClick={() => reload()}>Tải lại tồn kho</Button></div>}
      {loading && <p role="status">Đang kiểm tra sản phẩm…</p>}
      <div className="grid items-start gap-7 md:grid-cols-[minmax(0,1fr)_20rem]">
        <form className="space-y-5" onSubmit={submit}>
          <Card className="rounded-2xl"><CardHeader><h2 className="m-0 text-xl font-semibold">Thông tin liên hệ</h2></CardHeader><CardContent className="grid gap-4">
            <label className="grid gap-2 text-sm font-medium">Họ tên<Input required minLength={2} maxLength={100} value={contact.name} onChange={(event) => setContact({ ...contact, name: event.target.value })} /></label>
            <label className="grid gap-2 text-sm font-medium">Số điện thoại<Input required type="tel" value={contact.phone} onChange={(event) => setContact({ ...contact, phone: event.target.value })} /></label>
            <label className="grid gap-2 text-sm font-medium">Địa chỉ (không bắt buộc)<Input value={contact.address} maxLength={2000} onChange={(event) => setContact({ ...contact, address: event.target.value })} /></label>
            <label className="grid gap-2 text-sm font-medium">Ghi chú (không bắt buộc)<textarea className="min-h-24 rounded-xl border border-input bg-white p-3" maxLength={1000} value={contact.note} onChange={(event) => setContact({ ...contact, note: event.target.value })} /></label>
          </CardContent></Card>
          <CheckoutPayment value={purchase.pending?.paymentMethod ?? paymentMethod} onChange={setPaymentMethod} disabled={submitting || Boolean(purchase.pending)} />
          {submitError && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-800">{submitError}</p>}
          <Button size="lg" type="submit" disabled={!valid || submitting} className="w-full">{submitting ? "Đang gửi yêu cầu…" : "Xác nhận tạo đơn sản phẩm"}</Button>
        </form>
        <Card className="rounded-2xl"><CardHeader><h2 className="m-0 text-lg font-semibold">Sản phẩm trong giỏ</h2></CardHeader><CardContent className="space-y-4">
          {cart.map((item) => { const product = byId.get(item.productId); return <div key={item.productId} className="flex justify-between gap-3 text-sm"><span>{product?.name ?? `Sản phẩm ${item.productId}`} × {item.quantity}</span><span className="shrink-0">{product ? formatCurrency(product.price * item.quantity) : "—"}</span></div> })}
          <div className="border-t border-border pt-4"><p className="m-0 flex justify-between gap-3 font-semibold"><span>Tạm tính</span><span>{formatCurrency(total)}</span></p><p className="m-0 mt-2 text-xs leading-5 text-muted-foreground">Máy chủ xác thực lại giá và tồn kho; chưa có thanh toán thật.</p></div>
        </CardContent></Card>
      </div>
    </section>
  )
}

function ProductPayment({ order }: { order: ProductOrder }) {
  return <p className="m-0 rounded-xl bg-slate-50 p-4 text-sm leading-6" role="status">{!order.payment ? "Đơn cũ chưa có lựa chọn thanh toán." : `${order.payment.method === "cash" ? "Tiền mặt" : "Chuyển khoản"} · ${order.payment.status === "not_started" ? "Chưa ghi nhận thanh toán vì đơn chưa được xác nhận" : order.payment.status === "unpaid" ? "Chưa thanh toán" : "Chờ xác nhận thanh toán"}. Thanh toán mô phỏng, chưa nhận tiền thật.`}</p>
}

function OrderItems({ items }: { items: ProductOrderItem[] }) {
  return <ul className="m-0 list-none space-y-2 p-0">{items.map((item) => <li key={item.productId} className="flex justify-between gap-3 text-sm"><span>{item.name || `Sản phẩm mã ${item.productId}`} × {item.quantity}{item.unit ? ` ${item.unit}` : ""}</span><span className="shrink-0">{item.unitPrice === undefined ? "Đang xác minh" : formatCurrency(item.unitPrice * item.quantity)}</span></li>)}</ul>
}

export function ProductOrdersPage({ id }: { id?: string }) {
  const [orders, setOrders] = useState<ProductOrder[]>([])
  const [selected, setSelected] = useState<ProductOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [notFound, setNotFound] = useState(false)
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState("")
  useEffect(() => {
    let active = true
    setLoading(true)
    setError("")
    setNotFound(false)
    setOrders([])
    setSelected(null)
    const load = id
      ? getProductOrder(id).then((order) => ({ items: [order] }))
      : getProductOrders().then((items) => ({ items }))
    load.then((result) => {
      if (active) {
        setOrders(result.items)
        setSelected(id ? result.items[0] : null)
      }
    }).catch((reason: unknown) => {
      if (!active) return
      if (id && reason instanceof ApiError && reason.status === 404) setNotFound(true)
      else setError(messageOf(reason))
    })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id, revision])
  const retry = async (order: ProductOrder) => {
    setBusy(order.id)
    try {
      const result = await retryProductOrder(order.id)
      if (id) setSelected(result)
      setOrders((current) => current.map((item) => item.id === result.id ? result : item))
    } catch (reason) { setError(messageOf(reason)) }
    finally { setBusy("") }
  }
  const shown = id ? (selected ? [selected] : []) : orders
  return (
    <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      {id && <Button variant="ghost" className="mb-6" render={<Link href="/don-san-pham" />} nativeButton={false}><ArrowLeftIcon aria-hidden="true" />Đơn sản phẩm</Button>}
      <header className="mb-7"><p className="m-0 text-xs font-semibold tracking-wide text-primary uppercase">CleanHome / Đơn sản phẩm</p><h1 className="m-0 mt-2 text-3xl font-bold">{id ? "Chi tiết đơn sản phẩm" : "Đơn sản phẩm của tôi"}</h1><p className="m-0 mt-3 text-sm leading-6 text-muted-foreground">Theo dõi sản phẩm đã đặt, số lượng, tổng tiền và lựa chọn thanh toán. Đơn đang chờ xử lý chưa xác nhận đã nhận tiền hoặc vận chuyển.</p></header>
      {error && <div role="alert" className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4"><p>{error}</p><Button variant="outline" onClick={() => setRevision((value) => value + 1)}>Thử lại</Button></div>}
      {loading ? <p role="status">Đang tải đơn sản phẩm…</p> : notFound ? <div role="status" className="rounded-2xl border border-dashed border-border p-8 text-center"><h2 className="m-0 text-xl font-semibold">Không tìm thấy đơn sản phẩm</h2><p className="my-4 text-sm leading-6 text-muted-foreground">Đơn không tồn tại hoặc bạn không có quyền xem.</p><Button variant="outline" render={<Link href="/don-san-pham" />} nativeButton={false}>Về danh sách đơn sản phẩm</Button></div> : error ? null : shown.length ? <div className="space-y-4">{shown.map((order) => <Card key={order.id} className="rounded-2xl"><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="m-0 text-xs text-muted-foreground">{order.code}</p><h2 className="m-0 mt-1 text-lg font-semibold">{PRODUCT_ORDER_STATUS[order.status]}</h2></div><span className="text-sm text-muted-foreground">{new Date(order.createdAt).toLocaleString("vi-VN")}</span></div></CardHeader><CardContent className="space-y-4"><OrderItems items={order.items} /><ProductPayment order={order} />{order.total !== null && <p className="m-0 flex justify-between border-t border-border pt-4 font-semibold"><span>Tổng hàng</span><span>{formatCurrency(order.total)}</span></p>}{order.errorCode && <p role="alert" className="m-0 text-sm text-rose-700">{productOrderFailureMessage(order.errorCode)} <span className="block pt-2 text-xs">Mã lỗi: {order.errorCode}</span></p>}<div className="flex flex-wrap gap-3">{!id && <Button variant="outline" render={<Link href={`/don-san-pham/${order.id}`} />} nativeButton={false}>Xem chi tiết</Button>}{order.status !== "pending" && !terminalProductFailure(order.errorCode) && <Button variant="outline" onClick={() => retry(order)} disabled={busy === order.id}>{busy === order.id ? "Đang kiểm tra…" : order.status === "failed" ? "Thử lại đơn này" : "Kiểm tra lại trạng thái"}</Button>}</div></CardContent></Card>)}</div> : <div className="rounded-2xl border border-dashed border-border p-10 text-center"><h2 className="m-0 text-xl font-semibold">Chưa có đơn mua sản phẩm</h2><p className="my-3 text-sm text-muted-foreground">Bạn có thể xem và đặt mua sản phẩm riêng, không cần lịch dịch vụ.</p><Button render={<Link href="/san-pham" />} nativeButton={false}>Xem sản phẩm</Button></div>}
      <div className="mt-7"><Button variant="ghost" render={<Link href="/san-pham" />} nativeButton={false}><ArrowLeftIcon aria-hidden="true" />Tiếp tục xem sản phẩm</Button></div>
    </section>
  )
}
