import { ArrowRight, CalendarDays, ClipboardList, Package, Plus, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader, ServiceCard, StatusBadge, Surface } from "../../components/common/PageElements";
import { useAuth } from "../../context/AuthContext";
import { services } from "../../data/services";

function formatDate(value) {
  return new Intl.DateTimeFormat("vi-VN", { weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export default function Home() {
  const { user, orders } = useAuth();
  const myOrders = orders.filter((order) => order.customerId === user?.id);
  const nextOrder = myOrders.filter((order) => !["completed", "cancelled"].includes(order.status)).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0];

  return (
    <>
      <section className="welcome-banner">
        <div><span className="eyebrow">KHÔNG GIAN CỦA BẠN</span><h1>Chào {user?.name?.split(" ").slice(-1)[0] || "bạn"},<br />hôm nay nhà mình cần gì?</h1><p>Tìm dịch vụ chăm sóc nhà cửa phù hợp với nhịp sống của bạn.</p><Link className="button button-dark" to="/user/services">Khám phá dịch vụ <ArrowRight size={16} /></Link></div>
        <div className="welcome-illustration"><img src="/images/clearhome-hero.png" alt="Không gian nhà ở sáng sủa" /><span><Sparkles size={16} /> Chăm sóc tổ ấm</span></div>
      </section>

      <div className="section-heading compact-heading"><div><span className="eyebrow">BẮT ĐẦU NHANH</span><h2>Việc nhà, có người hỗ trợ</h2></div><Link className="text-link" to="/user/services">Tất cả dịch vụ <ArrowRight size={16} /></Link></div>
      <div className="service-grid">{services.slice(0, 3).map((service) => <ServiceCard key={service.id} service={service} />)}</div>

      <Surface className="home-product-promo"><span className="home-product-icon"><Package size={19} /></span><div><strong>Cần thêm sản phẩm chăm sóc nhà cửa?</strong><p>Nước vệ sinh và vật tư được phân theo nhóm dịch vụ.</p></div><Link className="text-link" to="/user/products">Mở gian hàng <ArrowRight size={15} /></Link></Surface>

      <div className="section-heading compact-heading"><div><span className="eyebrow">THEO DÕI LỊCH HẸN</span><h2>Đơn dịch vụ gần nhất</h2></div><Link className="text-link" to="/user/orders">Xem đơn của tôi <ArrowRight size={16} /></Link></div>
      {nextOrder ? (
        <Surface className="upcoming-card">
          <div className="upcoming-icon"><CalendarDays size={21} /></div>
          <div className="upcoming-copy"><span className="eyebrow">LỊCH HẸN TIẾP THEO</span><h3>{nextOrder.service}</h3><p>{formatDate(nextOrder.scheduledAt)} · {nextOrder.address}</p></div>
          <StatusBadge status={nextOrder.status} />
        </Surface>
      ) : (
        <Surface className="empty-orders"><span className="empty-orders-icon"><ClipboardList size={22} /></span><div><strong>Bạn chưa có lịch hẹn sắp tới</strong><p>Chọn một dịch vụ và gửi yêu cầu đặt lịch ngay.</p></div><Link className="button button-primary" to="/user/bookings"><Plus size={16} /> Đặt dịch vụ</Link></Surface>
      )}
    </>
  );
}
