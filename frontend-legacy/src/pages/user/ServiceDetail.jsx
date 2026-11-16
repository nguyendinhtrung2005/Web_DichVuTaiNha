import { ArrowLeft, Check, Clock3, ShieldCheck } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { PageHeader, Surface } from "../../components/common/PageElements";
import { services, serviceCategories, formatPrice } from "../../data/services";
import { useAuth } from "../../context/AuthContext";

export default function ServiceDetail() {
  const { user } = useAuth();
  const { slug } = useParams();
  const service = services.find((item) => item.slug === slug);
  if (!service) {
    return <Surface className="empty-state"><strong>Không tìm thấy dịch vụ này.</strong><Link className="text-link" to="/services">Quay lại danh sách dịch vụ</Link></Surface>;
  }
  const categoryLabel = serviceCategories.find((item) => item.id === service.category)?.label;

  return (
    <>
      <Link className="back-link inline-back" to="/services"><ArrowLeft size={16} /> Tất cả dịch vụ</Link>
      <PageHeader eyebrow={categoryLabel?.toUpperCase()} title={service.name} description={service.description} />
      <div className="detail-layout">
        <Surface className="service-detail-card">
          <div className={`service-detail-art tone-${service.tone}`}><span className="detail-glyph">{service.icon === "wrench" ? "⌁" : service.icon === "zap" ? "ϟ" : service.icon === "wind" ? "〰" : "⌂"}</span></div>
          <h2>Dịch vụ được thực hiện tại nhà</h2>
          <p>Chia sẻ yêu cầu và thời gian mong muốn để đội ngũ có thể tiếp nhận. Các phần việc và vật tư phát sinh sẽ cần được xác nhận trước khi thực hiện.</p>
          <ul className="check-list"><li><Check size={16} /> Mô tả nhu cầu trước khi đặt lịch</li><li><Check size={16} /> Theo dõi trạng thái đơn trên tài khoản</li><li><Check size={16} /> Giá chỉ mang tính tham khảo trong bản demo</li></ul>
        </Surface>
        <Surface className="booking-aside">
          <span className="eyebrow">GIÁ THAM KHẢO</span>
          <div className="detail-price">{formatPrice(service.price)}<small> / {service.unit}</small></div>
          <p>Tối thiểu {service.minimum} {service.unit}</p>
          <div className="aside-note"><ShieldCheck size={17} /><span>Nhân viên sẽ xác nhận phạm vi công việc trước khi bắt đầu.</span></div>
          <Link className="button button-primary button-full" to={user?.role === "user" ? `/user/bookings?service=${service.id}` : `/login?role=user&next=/user/bookings?service=${service.id}`}>Đặt dịch vụ <span aria-hidden="true">→</span></Link>
          <div className="aside-meta"><Clock3 size={16} /> Có thể chọn ngày và giờ phù hợp</div>
        </Surface>
      </div>
    </>
  );
}
