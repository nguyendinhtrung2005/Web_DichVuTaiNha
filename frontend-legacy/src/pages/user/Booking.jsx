import { useMemo, useState } from "react";
import { ArrowLeft, CalendarDays, CheckCircle2, MapPin } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader, Surface } from "../../components/common/PageElements";
import { useAuth } from "../../context/AuthContext";
import { services, formatPrice } from "../../data/services";

function minDateTime() {
  const date = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  return date.toISOString().slice(0, 16);
}

export default function Booking() {
  const { user, createOrder } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const initialService = services.find((service) => service.id === searchParams.get("service")) || services[0];
  const [form, setForm] = useState({
    serviceId: initialService.id,
    quantity: initialService.minimum,
    address: user?.address || "",
    scheduledAt: "",
    request: "",
  });
  const [message, setMessage] = useState("");
  const service = useMemo(() => services.find((item) => item.id === form.serviceId) || services[0], [form.serviceId]);
  const estimatedPrice = service.price * Number(form.quantity || service.minimum);

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function changeService(id) {
    const next = services.find((item) => item.id === id);
    updateField("serviceId", id);
    updateField("quantity", next.minimum);
  }

  function submit(event) {
    event.preventDefault();
    if (new Date(form.scheduledAt).getTime() <= Date.now()) {
      setMessage("Vui lòng chọn ngày và giờ trong tương lai.");
      return;
    }
    const order = createOrder({
      serviceId: service.id,
      service: service.name,
      quantity: Number(form.quantity),
      address: form.address.trim(),
      scheduledAt: new Date(form.scheduledAt).toISOString(),
      request: form.request.trim(),
      price: estimatedPrice,
    });
    navigate("/user/orders", { state: { createdOrderId: order.id } });
  }

  return (
    <>
      <Link className="back-link inline-back" to="/user/services"><ArrowLeft size={16} /> Quay lại dịch vụ</Link>
      <PageHeader eyebrow="ĐẶT LỊCH" title="Gửi yêu cầu dịch vụ" description="Điền thông tin cần thiết — đội ngũ sẽ xác nhận lại chi tiết đơn." />
      <div className="booking-layout">
        <Surface>
          <form className="booking-form" onSubmit={submit}>
            <div className="form-step"><span>01</span><div><strong>Chọn dịch vụ và quy mô</strong><small>Bạn có thể điều chỉnh trước khi gửi.</small></div></div>
            <label>Dịch vụ<select value={form.serviceId} onChange={(event) => changeService(event.target.value)}>{services.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>Số lượng ({service.unit})<input type="number" min={service.minimum} step="1" required value={form.quantity} onChange={(event) => updateField("quantity", event.target.value)} /></label>
            <div className="form-step"><span>02</span><div><strong>Địa chỉ và thời gian</strong><small>Chọn khung giờ bạn muốn được phục vụ.</small></div></div>
            <label>Địa chỉ thực hiện<div className="input-with-icon"><MapPin size={17} /><input required minLength={8} placeholder="Số nhà, tên đường, phường/xã, quận/huyện" value={form.address} onChange={(event) => updateField("address", event.target.value)} /></div></label>
            <label>Ngày và giờ<div className="input-with-icon"><CalendarDays size={17} /><input type="datetime-local" required min={minDateTime()} value={form.scheduledAt} onChange={(event) => updateField("scheduledAt", event.target.value)} /></div></label>
            <label>Ghi chú cho nhân viên <span className="optional-label">Không bắt buộc</span><textarea rows="3" maxLength="400" placeholder="Mô tả ngắn yêu cầu hoặc tình trạng cần lưu ý..." value={form.request} onChange={(event) => updateField("request", event.target.value)} /></label>
            {message && <p className="form-error" role="alert">{message}</p>}
            <button className="button button-primary button-full" type="submit">Gửi yêu cầu đặt lịch <span aria-hidden="true">→</span></button>
            <small className="form-footnote">Giá cuối cùng cần được xác nhận sau khi khảo sát phạm vi công việc. Chưa phát sinh thanh toán ở bản demo.</small>
          </form>
        </Surface>
        <Surface className="booking-summary">
          <span className="eyebrow">TÓM TẮT DỊCH VỤ</span>
          <div className={`summary-art tone-${service.tone}`}><CheckCircle2 size={31} /></div>
          <h2>{service.name}</h2><p>{service.description}</p>
          <div className="summary-line"><span>{form.quantity} {service.unit} × {formatPrice(service.price)}</span><strong>{formatPrice(estimatedPrice)}</strong></div>
          <div className="summary-total"><span>Giá dự kiến</span><strong>{formatPrice(estimatedPrice)}</strong></div>
          <p className="summary-disclaimer">Đây là giá tham khảo trong bản demo, không phải báo giá hoặc giao dịch thật.</p>
        </Surface>
      </div>
    </>
  );
}
