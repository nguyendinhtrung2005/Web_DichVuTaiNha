import { useMemo, useState } from "react";
import { ArrowRight, Check, Droplet, Package, Plus, Search, ShoppingBag, SprayCan, Wind, X } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { DataTable, PageHeader, StatusBadge, Surface } from "../../components/common/PageElements";
import { useAuth } from "../../context/AuthContext";
import { serviceCategories, formatPrice } from "../../data/services";

const productIcons = { droplet: Droplet, spray: SprayCan, sparkles: Check, sofa: Package, wind: Wind };
const formatDate = (value) => new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium" }).format(new Date(value));

export default function Products() {
  const { user, products, productOrders, createProductOrder } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState({});
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [form, setForm] = useState({ address: user?.address || "", phone: user?.phone || "" });
  const [message, setMessage] = useState("");
  const isCustomer = user?.role === "user";
  const locationMessage = location.state?.createdProductOrder;

  const filtered = useMemo(() => products.filter((product) => (
    (category === "all" || product.category === category)
    && `${product.name} ${product.description}`.toLowerCase().includes(query.trim().toLowerCase())
    && product.stock > 0
  )), [products, category, query]);
  const cartItems = Object.entries(cart).filter(([, quantity]) => quantity > 0);
  const cartTotal = cartItems.reduce((sum, [id, quantity]) => {
    const product = products.find((item) => item.id === id);
    return sum + (product?.price || 0) * quantity;
  }, 0);
  const myOrders = productOrders.filter((order) => order.customerId === user?.id);

  function changeQuantity(product, amount) {
    setCart((current) => ({
      ...current,
      [product.id]: Math.min(product.stock, Math.max(0, (current[product.id] || 0) + amount)),
    }));
  }

  function checkout(event) {
    event.preventDefault();
    setMessage("");
    const result = createProductOrder({
      items: cartItems.map(([productId, quantity]) => ({ productId, quantity })),
      address: form.address,
      phone: form.phone,
    });
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    setCart({});
    setCheckoutOpen(false);
    navigate("/user/products", { state: { createdProductOrder: result.order.id } });
  }

  return (
    <>
      <PageHeader eyebrow="GIAN HÀNG CLEANHOME" title="Sản phẩm chăm sóc nhà cửa" description="Sản phẩm theo từng nhóm vệ sinh, chăm sóc và bảo dưỡng. Giá và tồn kho trong bản demo." action={<span className="product-catalog-count"><Package size={15} /> {products.length} sản phẩm</span>} />
      <Surface className="catalog-tools">
        <label className="search-field"><Search size={18} /><input aria-label="Tìm sản phẩm" placeholder="Tìm nước vệ sinh, vật tư..." value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <div className="filter-chips" aria-label="Lọc sản phẩm theo nhóm dịch vụ">
          <button className={category === "all" ? "filter-chip active" : "filter-chip"} onClick={() => setCategory("all")}>Tất cả sản phẩm</button>
          {serviceCategories.map((item) => <button key={item.id} className={category === item.id ? "filter-chip active" : "filter-chip"} onClick={() => setCategory(item.id)}>{item.label}</button>)}
        </div>
      </Surface>
      {locationMessage && <div className="inline-success" role="status">Đã nhận đơn {locationMessage}. Đơn đang chờ xác nhận.</div>}
      {!isCustomer && <div className="product-shop-notice"><Package size={17} /><span>Đăng nhập tài khoản khách hàng để thêm sản phẩm vào giỏ và gửi đơn mua.</span><Link to="/login?role=user&next=/user/products">Đăng nhập <ArrowRight size={14} /></Link></div>}
      <div className="catalog-meta"><strong>{filtered.length} sản phẩm</strong><span>Đơn mua sản phẩm tách riêng, không phải đơn đặt dịch vụ.</span></div>
      {filtered.length ? <div className="product-grid">{filtered.map((product) => {
        const Icon = productIcons[product.icon] || Package;
        const quantity = cart[product.id] || 0;
        return (
          <article className="product-card surface" key={product.id}>
            <div className={`product-art tone-${product.tone}`}><span className="product-category">{serviceCategories.find((item) => item.id === product.category)?.label}</span><span className="product-illustration"><Icon size={42} strokeWidth={1.35} /></span><span className="product-stock">Còn {product.stock}</span></div>
            <div className="product-card-body"><h2>{product.name}</h2><p>{product.description}</p><div className="product-price-row"><strong>{formatPrice(product.price)}</strong><small>/ {product.unit}</small></div>
              {isCustomer ? <div className="product-cart-actions">{quantity ? <div className="quantity-control"><button aria-label={`Giảm ${product.name}`} onClick={() => changeQuantity(product, -1)}>−</button><strong>{quantity}</strong><button aria-label={`Tăng ${product.name}`} disabled={quantity >= product.stock} onClick={() => changeQuantity(product, 1)}>+</button></div> : <button className="button button-quiet add-product-button" onClick={() => changeQuantity(product, 1)}><Plus size={14} /> Thêm vào giỏ</button>}</div>
                : <Link className="button button-quiet add-product-button" to="/login?role=user&next=/user/products"><ShoppingBag size={14} /> Đăng nhập để mua</Link>}
            </div>
          </article>
        );
      })}</div> : <Surface className="empty-state"><strong>Không có sản phẩm phù hợp.</strong><p>Thử tìm theo tên hoặc chọn nhóm khác.</p></Surface>}

      {isCustomer && <section className="product-purchase-section">
        <div className="section-heading compact-heading"><div><span className="eyebrow">GIỎ HÀNG</span><h2>Sản phẩm đã chọn</h2></div><span className="cart-count">{cartItems.reduce((sum, [, quantity]) => sum + quantity, 0)} món</span></div>
        <Surface className="product-cart-summary">
          {cartItems.length ? <><div className="cart-lines">{cartItems.map(([id, quantity]) => { const product = products.find((item) => item.id === id); return product && <div className="cart-line" key={id}><span>{product.name}<small>{quantity} × {formatPrice(product.price)}</small></span><strong>{formatPrice(quantity * product.price)}</strong><button aria-label={`Xóa ${product.name} khỏi giỏ`} onClick={() => setCart((current) => ({ ...current, [id]: 0 }))}><X size={15} /></button></div>; })}</div>
            <div className="cart-total"><span>Tạm tính</span><strong>{formatPrice(cartTotal)}</strong></div>
            <button className="button button-primary" onClick={() => { setForm({ address: user?.address || "", phone: user?.phone || "" }); setMessage(""); setCheckoutOpen(true); }}>Tiếp tục đặt mua <ArrowRight size={15} /></button>
          </> : <div className="empty-cart"><ShoppingBag size={21} /><span>Giỏ hàng đang trống. Thêm sản phẩm bạn cần từ danh sách phía trên.</span></div>}
        </Surface>
      </section>}

      {isCustomer && myOrders.length > 0 && <section className="product-purchase-section">
        <div className="section-heading compact-heading"><div><span className="eyebrow">THEO DÕI MUA HÀNG</span><h2>Đơn mua sản phẩm của tôi</h2></div></div>
        <Surface className="list-surface"><DataTable columns={["Mã đơn", "Ngày đặt", "Sản phẩm", "Tổng tiền", "Trạng thái"]} rows={myOrders.map((order) => ({ key: order.id, cells: [order.id, formatDate(order.createdAt), order.items.map((item) => `${item.name} × ${item.quantity}`).join(", "), formatPrice(order.total), <StatusBadge status={order.status} />] }))} /></Surface>
      </section>}

      {checkoutOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCheckoutOpen(false); }}><section className="product-checkout surface" role="dialog" aria-modal="true" aria-labelledby="checkout-title">
        <div className="surface-heading"><div><span className="eyebrow">ĐƠN MUA DEMO</span><h2 id="checkout-title">Thông tin nhận hàng</h2></div><button className="icon-button" aria-label="Đóng" onClick={() => setCheckoutOpen(false)}><X size={17} /></button></div>
        <form className="booking-form" onSubmit={checkout}><label>Số điện thoại<input required minLength="9" maxLength="15" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label><label>Địa chỉ nhận hàng<input required minLength="8" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></label><div className="checkout-total"><span>Tổng tiền tham khảo</span><strong>{formatPrice(cartTotal)}</strong></div>{message && <p className="form-error" role="alert">{message}</p>}<p className="form-footnote">Bản demo chưa xử lý vận chuyển hoặc thanh toán thật. Admin sẽ xác nhận đơn trong màn hình sản phẩm.</p><button className="button button-primary button-full" type="submit">Gửi đơn mua sản phẩm</button></form>
      </section></div>}
    </>
  );
}
