import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { PageHeader, ServiceCard, Surface } from "../../components/common/PageElements";
import { serviceCategories, services } from "../../data/services";

export default function Services() {
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => services.filter((service) =>
      (category === "all" || service.category === category)
      && `${service.name} ${service.description}`.toLowerCase().includes(query.trim().toLowerCase()),
    ),
    [category, query],
  );

  return (
    <>
      <PageHeader eyebrow="DANH MỤC NHÀ TỐT" title="Dịch vụ chăm sóc nhà cửa" description="Chọn nhóm dịch vụ phù hợp: vệ sinh phòng trọ, vệ sinh nhà ở, chăm sóc hoặc bảo dưỡng." />
      <Surface className="catalog-tools">
        <label className="search-field"><Search size={18} /><input aria-label="Tìm dịch vụ" placeholder="Tìm dịch vụ chăm sóc nhà cửa..." value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <div className="filter-chips" aria-label="Lọc theo nhóm dịch vụ"><button className={category === "all" ? "filter-chip active" : "filter-chip"} onClick={() => setCategory("all")}>Tất cả</button>{serviceCategories.map((item) => <button key={item.id} className={category === item.id ? "filter-chip active" : "filter-chip"} onClick={() => setCategory(item.id)}>{item.label}</button>)}</div>
      </Surface>
      <div className="catalog-meta"><strong>{filtered.length} dịch vụ</strong><span>Giá tham khảo · Vật tư phát sinh cần được xác nhận trước.</span></div>
      {serviceCategories.filter((group) => category === "all" || category === group.id).map((group) => {
        const groupServices = filtered.filter((service) => service.category === group.id);
        if (!groupServices.length) return null;
        return <section className="service-category-section" key={group.id}><div className="service-category-heading"><span>{group.label}</span><small>{groupServices.length} dịch vụ</small></div><div className="service-grid">{groupServices.map((service) => <ServiceCard key={service.id} service={service} />)}</div></section>;
      })}
      {!filtered.length && <Surface className="empty-state"><strong>Không tìm thấy dịch vụ phù hợp.</strong><p>Thử đổi từ khóa hoặc chọn nhóm dịch vụ khác.</p></Surface>}
    </>
  );
}
