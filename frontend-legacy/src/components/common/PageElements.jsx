import { Link, useLocation } from "react-router-dom";

export function PageHeader({ eyebrow, title, description, action }) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Surface({ children, className = "" }) {
  return <section className={`surface ${className}`.trim()}>{children}</section>;
}

export function StatCard({ icon: Icon, label, value, note, tone = "mint" }) {
  return (
    <article className="stat-card surface">
      <span className={`stat-icon tone-${tone}`}>{Icon && <Icon size={19} aria-hidden="true" />}</span>
      <span className="stat-label">{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </article>
  );
}

const statusLabels = {
  pending: "Chờ xác nhận",
  confirmed: "Đã xác nhận",
  in_progress: "Đang thực hiện",
  completed: "Hoàn thành",
  cancelled: "Đã hủy",
  paid: "Đã thanh toán",
  unpaid: "Chưa thanh toán",
  active: "Đang hoạt động",
  locked: "Đã khóa",
};

export function StatusBadge({ status }) {
  return <span className={`status-badge status-${status}`}>{statusLabels[status] || status}</span>;
}

export function EmptyState({ title = "Chưa có dữ liệu", description }) {
  return (
    <div className="empty-state">
      <span aria-hidden="true">⌂</span>
      <strong>{title}</strong>
      {description && <p>{description}</p>}
    </div>
  );
}

export function ServiceCard({ service }) {
  const location = useLocation();
  const to = location.pathname.startsWith("/user/") ? `/user/services/${service.slug}` : `/services/${service.slug}`;
  return (
    <article className="service-card surface">
      <div className={`service-visual tone-${service.tone}`}>
        <span>{service.categoryLabel}</span>
        <ServiceGlyph name={service.icon} />
      </div>
      <div className="service-card-body">
        <h3>{service.name}</h3>
        <p>{service.description}</p>
        <div className="service-card-footer">
          <strong>{new Intl.NumberFormat("vi-VN").format(service.price)}đ <small>/ {service.unit}</small></strong>
          <Link className="text-link" to={to}>Chi tiết <span aria-hidden="true">→</span></Link>
        </div>
      </div>
    </article>
  );
}

function ServiceGlyph({ name }) {
  const glyphs = {
    sparkles: "✦",
    house: "⌂",
    wrench: "⌁",
    zap: "ϟ",
    wind: "〰",
    plug: "⌁",
    settings: "⚙",
    sofa: "▱",
  };
  return <span className="service-glyph" aria-hidden="true">{glyphs[name] || "⌂"}</span>;
}

export function DataTable({ columns, rows, empty = "Chưa có thông tin phù hợp." }) {
  if (!rows.length) return <EmptyState title={empty} />;
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
        <tbody>{rows.map((row) => <tr key={row.key}>{row.cells.map((cell, index) => <td key={`${row.key}-${index}`}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
