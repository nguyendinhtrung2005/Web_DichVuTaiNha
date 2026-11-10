"use client"

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import { ImageIcon, PackageIcon, PencilIcon, PlusIcon, RotateCcwIcon, Trash2Icon } from "lucide-react"
import { Field, money, useData } from "../../common"
import { Button } from "../ui/button"
import { Card, CardContent } from "../ui/card"
import { Input } from "../ui/input"
import { Textarea } from "../ui/textarea"
import { AdminDialog } from "./admin-dialog"
import { AdminEmpty, AdminLoading, AdminPageHeader } from "./admin-shared"
import {
  AdminProductApiError,
  deleteAdminProduct,
  deleteProductCategory,
  listAdminProducts,
  listProductCategories,
  saveAdminProduct,
  saveProductCategory,
  updateAdminProductStatus,
  type AdminProduct,
  type ProductCategory,
  type ProductInput,
  type ProductStatus,
} from "./admin-products-api"

const PAGE_SIZE = 12
const STATUS_LABEL: Record<ProductStatus, string> = {
  AVAILABLE: "Còn hàng",
  OUT_OF_STOCK: "Hết hàng",
  INACTIVE: "Ngừng bán",
}

type DialogState =
  | { kind: "product"; product?: AdminProduct }
  | { kind: "category"; category?: ProductCategory }
  | { kind: "delete-product"; product: AdminProduct }
  | { kind: "delete-category"; category: ProductCategory }

type ProductDraft = {
  categoryId: string
  name: string
  description: string
  unit: string
  price: string
  status: ProductStatus
  quantity: string
  minStock: string
  images: string
}

type CategoryDraft = { name: string; description: string; isActive: boolean }

const EMPTY_PRODUCT: ProductDraft = {
  categoryId: "",
  name: "",
  description: "",
  unit: "chai",
  price: "",
  status: "AVAILABLE",
  quantity: "0",
  minStock: "0",
  images: "",
}

function productDraft(product?: AdminProduct): ProductDraft {
  if (!product) return { ...EMPTY_PRODUCT }
  return {
    categoryId: product.categoryId,
    name: product.name,
    description: product.description,
    unit: product.unit,
    price: String(product.price),
    status: product.status,
    quantity: String(product.inventory.quantity),
    minStock: String(product.inventory.minStock),
    images: [...product.images].sort((a, b) => a.sortOrder - b.sortOrder).map((image) => image.imageUrl).join("\n"),
  }
}

function productInput(draft: ProductDraft): ProductInput {
  const images = draft.images.split(/\r?\n/).map((imageUrl) => imageUrl.trim()).filter(Boolean)
  return {
    categoryId: draft.categoryId,
    name: draft.name,
    description: draft.description,
    unit: draft.unit,
    price: Number(draft.price),
    status: draft.status,
    inventory: { quantity: Number(draft.quantity), minStock: Number(draft.minStock) },
    images: images.map((imageUrl, index) => ({ imageUrl, isPrimary: index === 0, sortOrder: index })),
  }
}

function stockLabel(product: AdminProduct) {
  const { availableQuantity, minStock } = product.inventory
  if (availableQuantity <= minStock) return { text: availableQuantity === 0 ? "Hết hàng" : "Sắp hết hàng", className: "bg-amber-50 text-amber-800" }
  return { text: `Còn ${availableQuantity} ${product.unit}`, className: "bg-emerald-50 text-emerald-800" }
}

function ErrorNotice({ error, retry }: { error: AdminProductApiError; retry: () => void }) {
  const authError = error.status === 401 || error.status === 403 || error.status === 503
  return <section role="alert" className="flex min-w-0 flex-col gap-3 rounded-2xl border border-red-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
    <div className="min-w-0">
      <h2 className="m-0 text-base font-semibold">{authError ? "Chưa xác thực được quyền quản trị API" : "Chưa thể tải dữ liệu sản phẩm"}</h2>
      <p className="m-0 mt-2 break-words text-sm leading-6 text-muted-foreground">
        {authError ? `${error.message} Đăng nhập demo trên giao diện chưa tạo phiên backend; cần phiên JWT hợp lệ do dịch vụ xác thực cấp.` : error.message}
      </p>
    </div>
    <Button variant="outline" className="min-h-11 shrink-0" onClick={retry}><RotateCcwIcon aria-hidden="true" />Thử lại</Button>
  </section>
}

export function AdminProducts() {
  const { s, user, role } = useData()
  const [categories, setCategories] = useState<ProductCategory[]>([])
  const [products, setProducts] = useState<AdminProduct[]>([])
  const [total, setTotal] = useState(0)
  const [query, setQuery] = useState("")
  const [categoryId, setCategoryId] = useState("")
  const [status, setStatus] = useState("")
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<AdminProductApiError | null>(null)
  const [categoryLoadError, setCategoryLoadError] = useState<AdminProductApiError | null>(null)
  const [mutationError, setMutationError] = useState("")
  const [feedback, setFeedback] = useState("")
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [productForm, setProductForm] = useState<ProductDraft>(EMPTY_PRODUCT)
  const [categoryForm, setCategoryForm] = useState<CategoryDraft>({ name: "", description: "", isActive: true })
  const [saving, setSaving] = useState(false)

  const loadCategories = useCallback(async () => {
    const result = await listProductCategories()
    setCategories(result)
  }, [])

  const loadProducts = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const result = await listAdminProducts({ search: query.trim(), categoryId, status, page, pageSize: PAGE_SIZE })
      setProducts(result.items)
      setTotal(result.total)
    } catch (error) {
      setLoadError(error instanceof AdminProductApiError ? error : new AdminProductApiError("Đã xảy ra lỗi khi tải sản phẩm.", 500, "REQUEST_FAILED"))
    } finally {
      setLoading(false)
    }
  }, [categoryId, page, query, status])

  useEffect(() => {
    if (!user || role !== "admin" || user.role !== "admin" || user.status !== "active") return
    loadCategories().catch((error: unknown) => {
      setCategoryLoadError(error instanceof AdminProductApiError ? error : new AdminProductApiError("Đã xảy ra lỗi khi tải danh mục.", 500, "REQUEST_FAILED"))
    })
  }, [loadCategories, role, user])

  useEffect(() => {
    if (!user || role !== "admin" || user.role !== "admin" || user.status !== "active") return
    void loadProducts()
  }, [loadProducts, role, user])

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const clearFilters = () => { setQuery(""); setCategoryId(""); setStatus(""); setPage(1) }

  if (!s) return <AdminLoading />
  if (!user || role !== "admin" || user.role !== "admin" || user.status !== "active") {
    return <AdminEmpty title="Vui lòng đăng nhập tài khoản quản trị viên" />
  }

  async function mutate(action: () => Promise<unknown>, message: string, refreshCategories = false) {
    if (saving) return
    setSaving(true)
    setMutationError("")
    setFeedback("")
    try {
      await action()
      if (refreshCategories) await loadCategories()
      await loadProducts()
      setDialog(null)
      setFeedback(message)
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Không thể lưu thay đổi.")
    } finally {
      setSaving(false)
    }
  }

  function openProduct(product?: AdminProduct) {
    setProductForm(productDraft(product))
    setMutationError("")
    setDialog({ kind: "product", product })
  }

  function openCategory(category?: ProductCategory) {
    setCategoryForm(category ? { name: category.name, description: category.description, isActive: category.isActive } : { name: "", description: "", isActive: true })
    setMutationError("")
    setDialog({ kind: "category", category })
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!dialog) return
    if (dialog.kind === "product") {
      const input = productInput(productForm)
      await mutate(() => saveAdminProduct(input, dialog.product?.id), dialog.product ? "Đã cập nhật sản phẩm." : "Đã tạo sản phẩm.")
    } else if (dialog.kind === "category") {
      await mutate(
        () => saveProductCategory(categoryForm, dialog.category?.id),
        dialog.category ? "Đã cập nhật danh mục." : "Đã tạo danh mục.",
        true,
      )
    } else if (dialog.kind === "delete-product") {
      await mutate(() => deleteAdminProduct(dialog.product.id), "Đã xóa sản phẩm.")
    } else {
      await mutate(() => deleteProductCategory(dialog.category.id), "Đã xóa danh mục.", true)
    }
  }

  const dialogTitle = dialog?.kind === "product"
    ? dialog.product ? "Chỉnh sửa sản phẩm" : "Thêm sản phẩm"
    : dialog?.kind === "category"
      ? dialog.category ? "Chỉnh sửa danh mục" : "Thêm danh mục"
      : dialog?.kind === "delete-product" ? "Xác nhận xóa sản phẩm" : "Xác nhận xóa danh mục"
  const dialogSubmit = dialog?.kind === "product"
    ? dialog.product ? "Lưu sản phẩm" : "Tạo sản phẩm"
    : dialog?.kind === "category"
      ? dialog.category ? "Lưu danh mục" : "Tạo danh mục"
      : "Xác nhận xóa"

  return <div className="min-w-0 space-y-6">
    <AdminPageHeader
      title="Quản lý sản phẩm"
      description="Danh mục, giá bán, hình ảnh và tồn kho sản phẩm khách tự mua để sử dụng tại nhà."
      action={<Button className="min-h-11 w-full sm:w-auto" onClick={() => openProduct()}><PlusIcon aria-hidden="true" />Thêm sản phẩm</Button>}
    />

    <p className="m-0 rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3 text-sm leading-6 text-blue-950">
      Sản phẩm được quản lý riêng, không thuộc 4 nhóm dịch vụ. Ảnh được khai báo bằng URL; chức năng tải ảnh lên chưa được cấu hình.
    </p>
    {feedback && <p role="status" aria-live="polite" className="m-0 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900">{feedback}</p>}
    {mutationError && !dialog && <p role="alert" className="m-0 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-900">{mutationError}</p>}

    <section aria-labelledby="product-categories-heading" className="min-w-0 space-y-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div><h2 id="product-categories-heading" className="m-0 text-lg font-semibold">Danh mục sản phẩm</h2><p className="m-0 mt-1 text-sm text-muted-foreground">Quản lý danh mục độc lập với nhóm dịch vụ.</p></div>
        <Button variant="outline" className="min-h-11" onClick={() => openCategory()}><PlusIcon aria-hidden="true" />Thêm danh mục</Button>
      </div>
      {categories.length ? <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {categories.map((category) => <Card key={category.id} className="min-w-0 rounded-2xl shadow-none ring-border"><CardContent className="flex min-w-0 items-start justify-between gap-3 p-4">
          <div className="min-w-0"><h3 className="m-0 break-words text-sm font-semibold">{category.name}</h3><p className="m-0 mt-2 break-words text-xs leading-5 text-muted-foreground">{category.description || "Chưa có mô tả"}</p><span className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${category.isActive ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>{category.isActive ? "Đang hoạt động" : "Ngừng hoạt động"}</span></div>
          <div className="flex shrink-0 gap-1"><Button variant="ghost" size="icon" aria-label={`Sửa danh mục ${category.name}`} onClick={() => openCategory(category)}><PencilIcon aria-hidden="true" /></Button><Button variant="ghost" size="icon" aria-label={`Xóa danh mục ${category.name}`} onClick={() => { setMutationError(""); setDialog({ kind: "delete-category", category }) }}><Trash2Icon aria-hidden="true" /></Button></div>
        </CardContent></Card>)}
      </div> : <p className="m-0 rounded-xl border border-dashed border-border bg-white p-5 text-sm text-muted-foreground">Chưa có danh mục sản phẩm. Hãy tạo danh mục trước khi thêm sản phẩm.</p>}
    </section>

    <section aria-label="Tìm và lọc sản phẩm" className="min-w-0 rounded-2xl border border-border bg-white p-5 sm:p-6">
      <div className="grid min-w-0 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Tìm kiếm sản phẩm"><Input type="search" value={query} placeholder="Tên hoặc mô tả sản phẩm..." onChange={(event) => { setQuery(event.target.value); setPage(1) }} /></Field>
        <Field label="Danh mục"><select value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setPage(1) }}><option value="">Tất cả danh mục</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.isActive ? "" : " (đã ngừng)"}</option>)}</select></Field>
        <Field label="Trạng thái"><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}><option value="">Tất cả trạng thái</option>{Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <div className="flex items-end"><Button variant="outline" className="min-h-11 w-full" disabled={!query && !categoryId && !status} onClick={clearFilters}><RotateCcwIcon aria-hidden="true" />Xóa bộ lọc</Button></div>
      </div>
      {!loadError && <p role="status" aria-live="polite" className="m-0 mt-5 border-t border-border pt-4 text-sm text-muted-foreground"><strong className="text-foreground">{total}</strong> sản phẩm</p>}
    </section>

    {loadError || categoryLoadError ? <ErrorNotice error={loadError || categoryLoadError!} retry={() => { setCategoryLoadError(null); void loadProducts(); void loadCategories().catch((error: unknown) => setCategoryLoadError(error instanceof AdminProductApiError ? error : new AdminProductApiError("Không thể tải danh mục.", 500, "REQUEST_FAILED"))) }} /> : loading
      ? <AdminLoading />
      : products.length === 0
        ? <AdminEmpty title={total ? "Không tìm thấy sản phẩm phù hợp" : "Chưa có sản phẩm"} description={total ? "Thử từ khóa hoặc bộ lọc khác." : "Tạo sản phẩm đầu tiên để bắt đầu quản lý giá, ảnh và tồn kho."} action={total ? <Button variant="outline" className="min-h-11" onClick={clearFilters}>Xóa bộ lọc</Button> : undefined} />
        : <div className="grid min-w-0 gap-4 sm:grid-cols-2 2xl:grid-cols-3">{products.map((product) => {
          const stock = stockLabel(product)
          const image = product.images.find((item) => item.isPrimary) || product.images[0]
          return <Card key={product.id} className="min-w-0 overflow-hidden rounded-2xl shadow-none ring-border">
            <div className="relative flex aspect-[16/9] items-center justify-center bg-slate-100 text-muted-foreground">
              {image ? <img src={image.imageUrl} alt={product.name} loading="lazy" className="absolute inset-0 size-full object-cover" /> : <div className="flex flex-col items-center gap-2 text-sm"><ImageIcon aria-hidden="true" className="size-7" />Chưa có ảnh</div>}
            </div>
            <CardContent className="flex min-w-0 flex-col gap-4 p-5">
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="m-0 text-xs font-medium text-primary">{product.categoryName}</p><h3 className="m-0 mt-1 break-words text-base font-semibold">{product.name}</h3></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium">{STATUS_LABEL[product.status]}</span></div>
              <p className="m-0 line-clamp-3 min-h-12 break-words text-sm leading-6 text-muted-foreground">{product.description || "Chưa có mô tả."}</p>
              <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 text-sm">
                <div><p className="m-0 text-xs text-muted-foreground">Giá bán</p><p className="m-0 mt-1 break-words font-semibold text-primary">{money(product.price)} / {product.unit}</p></div>
                <div><p className="m-0 text-xs text-muted-foreground">Tồn khả dụng</p><p className={`m-0 mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${stock.className}`}>{stock.text}</p></div>
                <div><p className="m-0 text-xs text-muted-foreground">Đang giữ</p><p className="m-0 mt-1 font-medium">{product.inventory.reservedQuantity}</p></div>
                <div><p className="m-0 text-xs text-muted-foreground">Ngưỡng cảnh báo</p><p className="m-0 mt-1 font-medium">{product.inventory.minStock}</p></div>
              </div>
              <div className="grid grid-cols-2 gap-2 border-t border-border pt-4">
                <Button variant="outline" className="min-h-11" onClick={() => openProduct(product)}><PencilIcon aria-hidden="true" />Chỉnh sửa</Button>
                <Button variant="outline" className="min-h-11" onClick={() => void mutate(
                  () => updateAdminProductStatus(product.id, product.status === "INACTIVE" ? (product.inventory.availableQuantity > 0 ? "AVAILABLE" : "OUT_OF_STOCK") : "INACTIVE"),
                  product.status === "INACTIVE" ? "Đã mở bán sản phẩm." : "Đã ngừng bán sản phẩm.",
                )}>{product.status === "INACTIVE" ? "Mở bán" : "Ngừng bán"}</Button>
                <Button variant="ghost" className="col-span-2 min-h-11 text-destructive hover:text-destructive" onClick={() => { setMutationError(""); setDialog({ kind: "delete-product", product }) }}><Trash2Icon aria-hidden="true" />Xóa sản phẩm</Button>
              </div>
            </CardContent>
          </Card>
        })}</div>}

    {!loadError && pageCount > 1 && <nav aria-label="Phân trang sản phẩm" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="m-0 text-sm text-muted-foreground">Trang {page} / {pageCount}</p>
      <div className="flex gap-2"><Button variant="outline" className="min-h-11" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Trước</Button><Button variant="outline" className="min-h-11" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)}>Sau</Button></div>
    </nav>}

    {dialog && <AdminDialog
      key={`${dialog.kind}-${dialog.kind === "category" ? dialog.category?.id || "new" : dialog.kind === "product" ? dialog.product?.id || "new" : dialog.kind === "delete-category" ? dialog.category.id : dialog.product.id}`}
      title={dialogTitle}
      busy={saving}
      error={mutationError}
      isBusy={() => saving}
      close={() => { if (!saving) { setDialog(null); setMutationError("") } }}
      submit={submit}
      submitLabel={dialogSubmit}
    >
      {dialog.kind === "product" ? <div className="grid min-w-0 gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Danh mục sản phẩm"><select required value={productForm.categoryId} onChange={(event) => setProductForm((current) => ({ ...current, categoryId: event.target.value }))}><option value="">Chọn danh mục</option>{categories.filter((category) => category.isActive || category.id === productForm.categoryId).map((category) => <option key={category.id} value={category.id}>{category.name}{category.isActive ? "" : " (đã ngừng)"}</option>)}</select></Field></div>
        <div className="sm:col-span-2"><Field label="Tên sản phẩm"><Input required maxLength={200} value={productForm.name} onChange={(event) => setProductForm((current) => ({ ...current, name: event.target.value }))} /></Field></div>
        <div className="sm:col-span-2"><Field label="Mô tả"><Textarea rows={3} maxLength={10000} value={productForm.description} onChange={(event) => setProductForm((current) => ({ ...current, description: event.target.value }))} /></Field></div>
        <Field label="Đơn vị tính"><Input required maxLength={50} value={productForm.unit} onChange={(event) => setProductForm((current) => ({ ...current, unit: event.target.value }))} /></Field>
        <Field label="Giá bán (₫)"><Input required type="number" min="0" step="0.01" value={productForm.price} onChange={(event) => setProductForm((current) => ({ ...current, price: event.target.value }))} /></Field>
        <Field label="Tồn kho"><Input required type="number" min="0" step="1" value={productForm.quantity} onChange={(event) => setProductForm((current) => ({ ...current, quantity: event.target.value }))} /></Field>
        <Field label="Mức tồn tối thiểu"><Input required type="number" min="0" step="1" value={productForm.minStock} onChange={(event) => setProductForm((current) => ({ ...current, minStock: event.target.value }))} /></Field>
        <div className="sm:col-span-2"><Field label="Trạng thái bán"><select value={productForm.status} onChange={(event) => setProductForm((current) => ({ ...current, status: event.target.value as ProductStatus }))}>{Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field></div>
        <div className="sm:col-span-2"><Field label="URL hình ảnh" hint="Mỗi dòng một URL; ảnh đầu tiên được chọn làm ảnh đại diện. Chỉ hỗ trợ URL HTTPS hoặc đường dẫn nội bộ."><Textarea rows={3} value={productForm.images} onChange={(event) => setProductForm((current) => ({ ...current, images: event.target.value }))} /></Field></div>
        {productForm.images.split(/\r?\n/).map((url) => url.trim()).filter(Boolean).slice(0, 4).map((url) => <div key={url} className="relative aspect-video overflow-hidden rounded-xl bg-slate-100 sm:col-span-1"><img src={url} alt="Xem trước sản phẩm" className="size-full object-cover" onError={(event) => { event.currentTarget.style.visibility = "hidden" }} /></div>)}
        <p className="m-0 flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-muted-foreground sm:col-span-2"><PackageIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />Số lượng đang giữ do đơn hàng quyết định và không thể sửa tại đây. Tồn kho mới không được thấp hơn số lượng đang giữ.</p>
      </div> : dialog.kind === "category" ? <div className="grid min-w-0 gap-5">
        <Field label="Tên danh mục"><Input required maxLength={100} value={categoryForm.name} onChange={(event) => setCategoryForm((current) => ({ ...current, name: event.target.value }))} /></Field>
        <Field label="Mô tả"><Textarea rows={3} maxLength={2000} value={categoryForm.description} onChange={(event) => setCategoryForm((current) => ({ ...current, description: event.target.value }))} /></Field>
        <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={categoryForm.isActive} onChange={(event) => setCategoryForm((current) => ({ ...current, isActive: event.target.checked }))} />Danh mục đang hoạt động</label>
      </div> : <div className="space-y-3">
        <p className="m-0 break-words text-sm leading-7">{dialog.kind === "delete-product"
          ? <>Bạn muốn xóa sản phẩm <strong>{dialog.product.name}</strong>? Sản phẩm có số lượng đang giữ sẽ được backend từ chối xóa.</>
          : <>Bạn muốn xóa danh mục <strong>{dialog.category.name}</strong>? Không thể xóa khi còn sản phẩm sử dụng danh mục này.</>}</p>
        <p className="m-0 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">Thao tác chỉ được báo thành công sau khi API xác nhận đã lưu.</p>
      </div>}
    </AdminDialog>}
  </div>
}
