import { ArrowDown, ArrowRight, BadgeCheck, CalendarCheck2, Clock3, Package, ShieldCheck, Sparkles, Wrench } from "lucide-react";
import { Link } from "react-router-dom";
import { ServiceCard } from "../components/common/PageElements";
import { services } from "../data/services";

const steps = [
  { icon: Sparkles, title: "Chọn dịch vụ", text: "Tìm đúng dịch vụ cho công việc trong nhà bạn." },
  { icon: CalendarCheck2, title: "Đặt thời gian", text: "Chọn khung giờ thuận tiện và để lại địa chỉ." },
  { icon: BadgeCheck, title: "Nhận hỗ trợ tại nhà", text: "Theo dõi đơn và trao đổi yêu cầu trong một nơi." },
];

export default function PublicHome() {
  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow"><Sparkles size={14} /> MỘT NƠI CHO MỌI VIỆC TRONG NHÀ</span>
          <h1>Nhà gọn gàng.<br /><span>Ngày thảnh thơi.</span></h1>
          <p>Từ vệ sinh phòng trọ, nhà ở đến chăm sóc và bảo dưỡng, tìm dịch vụ phù hợp ngay tại nơi bạn sống.</p>
          <div className="hero-actions">
            <Link className="button button-primary button-large" to="/login?role=user">Tìm dịch vụ phù hợp <ArrowRight size={17} /></Link>
            <a className="button button-quiet button-large" href="#services">Khám phá dịch vụ <ArrowDown size={16} /></a>
          </div>
          <div className="hero-promises">
            <span><ShieldCheck size={17} /> Giá tham khảo rõ ràng</span>
            <span><Clock3 size={17} /> Đặt lịch linh hoạt</span>
            <span><Wrench size={17} /> Nhiều nhu cầu tại nhà</span>
          </div>
        </div>
        <div className="hero-art" role="img" aria-label="Không gian nhà ở sáng sủa, được chăm sóc gọn gàng">
          <img src="/images/clearhome-hero.png" alt="" />
          <div className="hero-note"><span className="hero-note-icon"><HouseGlyph /></span><span><strong>Chăm sóc cả ngôi nhà</strong><small>Vệ sinh · Chăm sóc · Bảo dưỡng</small></span></div>
          <div className="hero-index">01 <span>— 03</span></div>
        </div>
      </section>

      <section className="section-wrap" id="services">
        <div className="section-heading">
          <div><span className="eyebrow">DỊCH VỤ TẠI NHÀ</span><h2>Chăm sóc nhà cửa theo nhu cầu</h2><p>Vệ sinh phòng trọ, vệ sinh nhà ở, chăm sóc và bảo dưỡng.</p></div>
          <Link className="text-link" to="/services">Xem tất cả dịch vụ <ArrowRight size={16} /></Link>
        </div>
        <div className="service-grid">{services.filter((service) => ["room-cleaning", "home-cleaning", "home-care", "maintenance"].includes(service.category)).slice(0, 4).map((service) => <ServiceCard key={service.id} service={service} />)}</div>
        <div className="category-pills">
          {["Vệ sinh phòng trọ", "Vệ sinh nhà ở", "Chăm sóc", "Bảo dưỡng"].map((item) => <span key={item}>{item}</span>)}
        </div>
      </section>

      <section className="product-promo">
        <div className="product-promo-icon"><Package size={26} /></div>
        <div><span className="eyebrow">SẢN PHẨM CHĂM SÓC NHÀ CỬA</span><h2>Sản phẩm phù hợp, dùng tại nhà</h2><p>Nước vệ sinh, dung dịch chăm sóc và vật tư được phân theo nhóm dịch vụ.</p></div>
        <Link className="button button-dark" to="/products">Khám phá sản phẩm <ArrowRight size={16} /></Link>
      </section>

      <section className="how-section" id="how-it-works">
        <div className="section-wrap">
          <div className="section-heading centered"><div><span className="eyebrow">ĐƠN GIẢN TRONG 3 BƯỚC</span><h2>Việc nhà gọn nhẹ hơn</h2><p>Đặt lịch thuận tiện, thông tin đơn được tập trung rõ ràng.</p></div></div>
          <ol className="steps-grid">{steps.map(({ icon: Icon, title, text }, index) => (
            <li className="step-card" key={title}><span className="step-number">0{index + 1}</span><span className="step-icon"><Icon size={21} /></span><h3>{title}</h3><p>{text}</p></li>
          ))}</ol>
        </div>
      </section>

      <section className="section-wrap final-cta">
        <div><span className="eyebrow">BẮT ĐẦU TỪ VIỆC NHỎ</span><h2>Một ngôi nhà dễ chịu<br />bắt đầu từ hôm nay.</h2></div>
        <Link className="button button-dark button-large" to="/login?role=user">Đặt dịch vụ <ArrowRight size={17} /></Link>
      </section>
    </main>
  );
}

function HouseGlyph() {
  return <span aria-hidden="true">⌂</span>;
}
