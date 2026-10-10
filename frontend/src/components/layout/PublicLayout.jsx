import { Link, Outlet } from "react-router-dom";
import { House, Package, ShieldCheck } from "lucide-react";

export default function PublicLayout() {
  return (
    <div className="public-shell">
      <header className="public-header">
        <Link className="brand" to="/"><span className="brand-mark"><House size={21} strokeWidth={2.4} /></span><span>CleanHome<span className="brand-dot">.</span><small>DỊCH VỤ TẠI NHÀ</small></span></Link>
        <nav><Link to="/services">Dịch vụ</Link><Link to="/products"><Package size={14} /> Sản phẩm</Link><a href="/#how-it-works">Cách hoạt động</a></nav>
        <div className="public-actions"><Link className="button button-quiet" to="/login">Đăng nhập</Link><Link className="button button-primary" to="/login?role=user">Đặt dịch vụ <span aria-hidden="true">↗</span></Link></div>
      </header>
      <div className="demo-ribbon"><ShieldCheck size={14} /> Giao diện đang ở chế độ demo — thông tin đơn và thanh toán chưa kết nối backend.</div>
      <Outlet />
      <footer className="public-footer"><Link className="brand" to="/"><span className="brand-mark"><House size={18} /></span><span>CleanHome<span className="brand-dot">.</span></span></Link><span>Chăm sóc tổ ấm, nhẹ nhàng mỗi ngày.</span><span>© 2026 CleanHome</span></footer>
    </div>
  );
}
