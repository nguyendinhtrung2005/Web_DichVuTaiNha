import { useState } from "react";
import { Plus, X } from "lucide-react";
import { DataTable, PageHeader, StatusBadge, Surface } from "../../components/common/PageElements";
import { useAuth } from "../../context/AuthContext";
import { serviceCategories, formatPrice } from "../../data/services";

export default function Products() {
  const { products, productOrders, saveProduct, deleteProduct, updateProductOrder } = useAuth();
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [deleteError, setDeleteError] = useState("");
  const [tab, setTab] = useState("catalog");

  function submitProduct(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    saveProduct({
      id: editing?.id,
      name: String(formData.get("name")).trim(),
      category: String(formData.get("category")),
      description: String(formData.get("description")).trim(),
      price: Number(formData.get("price")),
      unit: String(formData.get("unit")).trim(),
      stock: Number(formData.get("stock")),
      icon: editing?.icon || "droplet",
      tone: editing?.tone || "mint",
    });
    setEditing(null);
  }

  function confirmDelete() {
    if (!deleting) return;
    const result = deleteProduct(deleting.id);
    if (!result.ok) {
      setDeleteError(result.error);
      return;
    }
    setDeleteError("");
    setDeleting(null);
  }

  const catalogRows = products.map((product) => ({
    key: product.id,
    cells: [
      <div className="table-primary"><strong>{product.name}</strong><small>{product.description}</small></div>,
      serviceCategories.find((category) => category.id === product.category)?.label || "Chưa phân nhóm",
      formatPrice(product.price),
      product.unit,
      <span className={product.stock > 0 ? "stock-value" : "stock-value out-of-stock"}>{product.stock}</span>,
      <div className="product-admin-actions"><button className="table-action" onClick={() => setEditing(product)}>Sửa</button><button className="table-action table-action-danger" onClick={() => { setDeleteError(""); setDeleting(product); }}>Xóa</button></div>,
    ],
  }));

  const orderRows = productOrders.map((order) => ({
    key: order.id,
    cells: [
      order.id,
      order.customer,
      `${order.phone} · ${order.address}`,
      order.items.map((item) => `${item.name} × ${item.quantity}`).join(", "),
      formatPrice(order.total),
      <StatusBadge status={order.status} />,
      order.status === "pending"
        ? <div className="product-admin-actions"><button className="table-action" onClick={() => updateProductOrder(order.id, "confirmed")}>Xác nhận</button><button className="table-action table-action-danger" onClick={() => updateProductOrder(order.id, "cancelled")}>Hủy đơn</button></div>
        : order.status === "confirmed"
          ? <button className="table-action" onClick={() => updateProductOrder(order.id, "completed")}>Hoàn tất</button>
          : "—",
    ],
  }));

  return (
    <>
      <PageHeader eyebrow="QUẢN LÝ SẢN PHẨM" title="Sản phẩm & đơn mua" description="Quản lý sản phẩm vệ sinh, chăm sóc, bảo dưỡng và các đơn mua riêng của khách hàng." action={tab === "catalog" && <button className="button button-primary" onClick={() => setEditing({})}><Plus size={15} /> Thêm sản phẩm</button>} />
      <div className="admin-tabs" role="tablist" aria-label="Quản lý sản phẩm">
        <button role="tab" aria-selected={tab === "catalog"} className={tab === "catalog" ? "admin-tab active" : "admin-tab"} onClick={() => setTab("catalog")}>Danh mục & tồn kho <span>{products.length}</span></button>
        <button role="tab" aria-selected={tab === "orders"} className={tab === "orders" ? "admin-tab active" : "admin-tab"} onClick={() => setTab("orders")}>Đơn mua <span>{productOrders.length}</span></button>
      </div>
      {tab === "catalog"
        ? <Surface className="list-surface"><DataTable columns={["Sản phẩm", "Nhóm liên quan", "Giá bán", "Đơn vị", "Tồn kho", "Thao tác"]} rows={catalogRows} empty="Chưa có sản phẩm." /></Surface>
        : <Surface className="list-surface"><DataTable columns={["Mã đơn", "Khách hàng", "Liên hệ", "Sản phẩm", "Tổng tiền", "Trạng thái", "Thao tác"]} rows={orderRows} empty="Chưa có đơn mua sản phẩm." /></Surface>}
      <p className="muted-note">Tồn kho giảm khi khách tạo đơn demo; đơn bị hủy trước khi xác nhận sẽ hoàn lại số lượng. Chưa kết nối thanh toán hoặc giao hàng thật.</p>

      {editing && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}><section className="product-checkout surface" role="dialog" aria-modal="true" aria-labelledby="product-editor-title">
        <div className="surface-heading"><div><span className="eyebrow">DANH MỤC</span><h2 id="product-editor-title">{editing.id ? "Cập nhật sản phẩm" : "Thêm sản phẩm"}</h2></div><button className="icon-button" aria-label="Đóng" onClick={() => setEditing(null)}><X size={17} /></button></div>
        <form className="booking-form" onSubmit={submitProduct}>
          <label>Tên sản phẩm<input name="name" required minLength="2" defaultValue={editing.name || ""} /></label>
          <label>Nhóm dịch vụ liên quan<select name="category" defaultValue={editing.category || serviceCategories[0].id}>{serviceCategories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label>
          <label>Mô tả<textarea name="description" rows="3" required defaultValue={editing.description || ""} /></label>
          <div className="product-editor-row"><label>Giá bán (VND)<input name="price" type="number" min="1" required defaultValue={editing.price || ""} /></label><label>Đơn vị<input name="unit" required placeholder="chai 1L, bộ..." defaultValue={editing.unit || ""} /></label><label>Tồn kho<input name="stock" type="number" min="0" step="1" required defaultValue={editing.stock ?? 0} /></label></div>
          <button className="button button-primary button-full" type="submit">Lưu sản phẩm</button>
        </form>
      </section></div>}

      {deleting && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleting(null); }}><section className="product-checkout surface" role="dialog" aria-modal="true" aria-labelledby="delete-product-title">
        <div className="surface-heading"><h2 id="delete-product-title">Xóa sản phẩm?</h2><button className="icon-button" aria-label="Đóng" onClick={() => setDeleting(null)}><X size={17} /></button></div>
        <p className="delete-confirm-copy">Bạn có chắc muốn xóa <strong>{deleting.name}</strong> khỏi danh mục?</p>
        {deleteError && <p className="form-error" role="alert">{deleteError}</p>}
        <div className="button-row"><button className="button button-quiet" onClick={() => setDeleting(null)}>Giữ lại</button><button className="button button-danger" onClick={confirmDelete}>Xác nhận xóa</button></div>
      </section></div>}
    </>
  );
}
