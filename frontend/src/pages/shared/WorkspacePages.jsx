import { useMemo, useState } from "react";
import { CalendarDays, ClipboardList, Clock3, CreditCard, Users, Wrench } from "lucide-react";
import { Link, useLocation, useParams } from "react-router-dom";
import { DataTable, EmptyState, PageHeader, StatCard, StatusBadge, Surface } from "../../components/common/PageElements";
import { useAuth } from "../../context/AuthContext";
import { services, serviceCategories, formatPrice } from "../../data/services";

const dateTime = (value) => new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
const dateOnly = (value) => new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));

export function OrdersPage({ role = "user" }) {
  const { user, orders } = useAuth();
  const location = useLocation();
  const [filter, setFilter] = useState("all");
  const visibleOrders = orders.filter((order) => (
    role === "user"
      ? order.customerId === user?.id
      : role === "staff"
        ? order.staffId === user?.id || (!order.staffId && order.status === "pending")
        : true
  ) && (filter === "all" || order.status === filter));
  const basePath = role === "staff" ? "/staff/jobs" : "/user/orders";

  return (
    <>
      <PageHeader eyebrow={role === "user" ? "ĐƠN DỊCH VỤ" : "QUẢN LÝ CÔNG VIỆC"} title={role === "user" ? "Đơn dịch vụ của tôi" : role === "staff" ? "Danh sách công việc" : "Đơn dịch vụ"} description={role === "user" ? "Xem trạng thái và lịch hẹn của các yêu cầu bạn đã gửi." : "Theo dõi yêu cầu dịch vụ và lịch thực hiện."} />
      {location.state?.createdOrderId && <div className="inline-success" role="status">Đã tạo yêu cầu {location.state.createdOrderId}. Đơn đang chờ xác nhận.</div>}
      <Surface className="list-surface">
        <div className="list-toolbar"><strong>{visibleOrders.length} đơn dịch vụ</strong><label>Lọc trạng thái<select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">Tất cả trạng thái</option><option value="pending">Chờ xác nhận</option><option value="confirmed">Đã xác nhận</option><option value="in_progress">Đang thực hiện</option><option value="completed">Hoàn thành</option><option value="cancelled">Đã hủy</option></select></label></div>
        <DataTable columns={role === "user" ? ["Mã đơn", "Dịch vụ", "Thời gian", "Địa chỉ", "Tạm tính", "Trạng thái"] : ["Mã đơn", "Khách hàng", "Dịch vụ", "Thời gian", "Nhân viên", "Trạng thái"]} rows={visibleOrders.map((order) => ({
          key: order.id,
          cells: role === "user"
            ? [<strong>{order.id}</strong>, order.service, dateTime(order.scheduledAt), order.address, formatPrice(order.price), <StatusBadge status={order.status} />]
            : [<Link className="text-link" to={`${basePath}/${order.id}`}>{order.id}</Link>, order.customer, order.service, dateTime(order.scheduledAt), order.staff, <StatusBadge status={order.status} />],
        }))} empty="Chưa có đơn dịch vụ nào." />
      </Surface>
    </>
  );
}

export function PaymentsPage({ admin = false }) {
  const { user, orders } = useAuth();
  const payments = orders.filter((order) => admin || order.customerId === user?.id);
  const paidTotal = payments.filter((order) => order.status === "completed").reduce((sum, order) => sum + order.price, 0);
  return (
    <>
      <PageHeader eyebrow="THANH TOÁN" title={admin ? "Theo dõi thanh toán" : "Thanh toán của tôi"} description="Thông tin dưới đây chỉ minh họa trạng thái thanh toán, chưa ghi nhận giao dịch thật." />
      <div className="stat-grid stat-grid-two"><StatCard icon={CreditCard} label="Đã ghi nhận hoàn tất" value={formatPrice(paidTotal)} note="Dữ liệu demo" /><StatCard icon={Clock3} label="Đơn cần thanh toán" value={payments.filter((order) => order.status !== "completed" && order.status !== "cancelled").length} note="Chưa phát sinh giao dịch" tone="yellow" /></div>
      <Surface className="list-surface"><DataTable columns={admin ? ["Mã đơn", "Khách hàng", "Dịch vụ", "Số tiền tham khảo", "Trạng thái"] : ["Mã đơn", "Dịch vụ", "Ngày đặt", "Số tiền tham khảo", "Trạng thái"]} rows={payments.map((order) => ({
        key: order.id,
        cells: admin
          ? [order.id, order.customer, order.service, formatPrice(order.price), <StatusBadge status={order.status === "completed" ? "paid" : "unpaid"} />]
          : [order.id, order.service, dateOnly(order.scheduledAt), formatPrice(order.price), <StatusBadge status={order.status === "completed" ? "paid" : "unpaid"} />],
      }))} empty="Chưa có khoản thanh toán." /></Surface>
    </>
  );
}

export function ReviewsPage({ admin = false }) {
  const [rating, setRating] = useState("5");
  const [comment, setComment] = useState("");
  const [reviews, setReviews] = useState([]);
  const { user } = useAuth();
  function submitReview(event) {
    event.preventDefault();
    const text = comment.trim();
    if (!text) return;
    setReviews((current) => [{ rating: Number(rating), comment: text, name: user?.name || "Khách hàng" }, ...current]);
    setComment("");
  }
  return (
    <>
      <PageHeader eyebrow="CHIA SẺ TRẢI NGHIỆM" title={admin ? "Đánh giá dịch vụ" : "Đánh giá của tôi"} description="Phản hồi giúp hoàn thiện trải nghiệm chăm sóc nhà tại nhà." />
      {!admin && <Surface className="review-compose"><form className="review-form" onSubmit={submitReview}><div><span className="eyebrow">SAU MỖI LẦN PHỤC VỤ</span><h2>Chia sẻ trải nghiệm</h2><p>Đánh giá mới chỉ được giữ trong phiên xem hiện tại.</p></div><label>Điểm đánh giá<select value={rating} onChange={(event) => setRating(event.target.value)}>{[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} sao</option>)}</select></label><label className="review-comment">Nhận xét<textarea rows="2" maxLength="300" required placeholder="Điều gì khiến trải nghiệm của bạn tốt hơn?" value={comment} onChange={(event) => setComment(event.target.value)} /></label><button className="button button-primary" type="submit">Gửi đánh giá demo</button></form></Surface>}
      <div className="review-stack">{reviews.map((review, index) => <Surface className="review-card" key={`${review.name}-${index}`}><span className="review-stars" aria-label={`${review.rating} trên 5 sao`}>{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</span><span className="review-quote">“{review.comment}”</span><div className="review-by"><div className="avatar">{review.name.slice(0, 1)}</div><div><strong>{review.name}</strong><small>Đánh giá trong phiên demo</small></div></div></Surface>)}
        <Surface className="review-card"><span className="review-stars" aria-label="5 trên 5 sao">★★★★★</span><span className="review-quote">“Nhân viên trao đổi rõ ràng, làm việc gọn gàng và đúng giờ.”</span><div className="review-by"><div className="avatar">L</div><div><strong>Nguyễn Thị Lan</strong><small>Dọn dẹp nhà theo giờ · Đánh giá mẫu</small></div></div></Surface></div>
      <p className="muted-note">{admin ? "Đánh giá đang hiển thị là dữ liệu mẫu, chưa được gửi từ tài khoản thật." : "Đánh giá vừa gửi không được lưu sau khi tải lại trang hoặc thoát."}</p>
    </>
  );
}

export function ProfilePage() {
  const { user, updateProfile } = useAuth();
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({ name: user?.name || "", email: user?.email || "", phone: user?.phone || "", address: user?.address || "" });

  function submit(event) {
    event.preventDefault();
    updateProfile(form);
    setSaved(true);
  }

  return (
    <>
      <PageHeader eyebrow="TÀI KHOẢN" title="Hồ sơ cá nhân" description="Cập nhật thông tin liên hệ dùng cho các yêu cầu dịch vụ demo." />
      <Surface className="profile-panel">
        <div className="profile-summary"><div className="profile-avatar">{user?.name?.slice(0, 1) || "N"}</div><div><h2>{user?.name}</h2><p>{user?.email}</p><StatusBadge status="active" /></div></div>
        <form className="profile-form" onSubmit={submit}>
          <label>Họ và tên<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>Email<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
          <label>Số điện thoại<input required value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
          <label className="full-field">Địa chỉ thường dùng<input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></label>
          {saved && <p className="inline-success full-field" role="status">Đã lưu thông tin trên trình duyệt này.</p>}
          <button className="button button-primary" type="submit">Lưu thay đổi</button>
        </form>
      </Surface>
    </>
  );
}

export function StaffHome() {
  const { user, orders } = useAuth();
  const jobs = orders.filter((order) => order.staffId === user?.id);
  const active = jobs.filter((order) => ["confirmed", "in_progress"].includes(order.status));
  return (
    <>
      <PageHeader eyebrow="TỔNG QUAN CÔNG VIỆC" title={`Xin chào, ${user?.name?.split(" ").slice(-1)[0] || "bạn"}`} description="Lịch công việc và yêu cầu được phân công cho bạn." />
      <div className="stat-grid"><StatCard icon={ClipboardList} label="Công việc của tôi" value={jobs.length} note="Trong dữ liệu demo" /><StatCard icon={Clock3} label="Đang thực hiện" value={active.length} note="Đơn đã nhận hoặc đang làm" tone="blue" /><StatCard icon={CalendarDays} label="Lịch sắp tới" value={active.filter((order) => new Date(order.scheduledAt) > new Date()).length} note="Theo lịch hẹn" tone="peach" /></div>
      <Surface className="list-surface"><div className="surface-heading"><div><span className="eyebrow">LỊCH GẦN ĐÂY</span><h2>Công việc được giao</h2></div><Link className="text-link" to="/staff/jobs">Xem tất cả →</Link></div><JobRows orders={jobs.slice(0, 4)} /></Surface>
    </>
  );
}

export function StaffJobsPage() {
  const { user, orders } = useAuth();
  const jobs = orders.filter((order) => order.staffId === user?.id || (!order.staffId && order.status === "pending"));
  return (
    <>
      <PageHeader eyebrow="CÔNG VIỆC" title="Lịch công việc của tôi" description="Xem yêu cầu được phân công và các đơn đang chờ tiếp nhận." />
      <Surface className="list-surface"><JobRows orders={jobs} linked /></Surface>
    </>
  );
}

function JobRows({ orders, linked = false }) {
  if (!orders.length) return <EmptyState title="Chưa có công việc" description="Khi được phân công, đơn dịch vụ sẽ xuất hiện tại đây." />;
  return (
    <div className="job-list">{orders.map((order) => <article className="job-row" key={order.id}>
      <div className="job-date"><strong>{new Intl.DateTimeFormat("vi-VN", { day: "2-digit" }).format(new Date(order.scheduledAt))}</strong><span>{new Intl.DateTimeFormat("vi-VN", { month: "short" }).format(new Date(order.scheduledAt))}</span></div>
      <div className="job-details"><strong>{order.service}</strong><span>{order.customer} · {order.address}</span><small>{dateTime(order.scheduledAt)} · {order.id}</small></div>
      <StatusBadge status={order.status} />
      {linked && <Link className="button button-quiet" to={`/staff/jobs/${order.id}`}>Chi tiết</Link>}
    </article>)}</div>
  );
}

export function JobDetailPage() {
  const { id } = useParams();
  const { orders, updateOrder } = useAuth();
  const order = orders.find((item) => item.id === id);
  if (!order) return <EmptyState title="Không tìm thấy công việc" description="Đơn có thể đã được xóa khỏi dữ liệu demo." />;
  return (
    <>
      <PageHeader eyebrow={`CÔNG VIỆC ${order.id}`} title={order.service} description="Thông tin yêu cầu và lịch hẹn tại nhà." />
      <div className="detail-layout"><Surface className="job-info"><div className="surface-heading"><h2>Thông tin công việc</h2><StatusBadge status={order.status} /></div><dl className="info-list"><div><dt>Khách hàng</dt><dd>{order.customer}</dd></div><div><dt>Địa chỉ</dt><dd>{order.address}</dd></div><div><dt>Thời gian</dt><dd>{dateTime(order.scheduledAt)}</dd></div><div><dt>Quy mô</dt><dd>{order.quantity}</dd></div><div><dt>Ghi chú</dt><dd>{order.request || "Không có ghi chú trong dữ liệu mẫu."}</dd></div></dl>
        <div className="button-row">{order.status === "pending" && <button className="button button-primary" onClick={() => updateOrder(order.id, { status: "confirmed", staffId: "demo-staff", staff: "Trần Minh Hùng" })}>Nhận công việc</button>}{order.status === "confirmed" && <button className="button button-primary" onClick={() => updateOrder(order.id, { status: "in_progress" })}>Bắt đầu thực hiện</button>}{order.status === "in_progress" && <button className="button button-primary" onClick={() => updateOrder(order.id, { status: "completed" })}>Đánh dấu hoàn thành</button>}</div>
      </Surface><Surface className="job-note"><span className="eyebrow">LƯU Ý</span><h3>Trao đổi trước khi thực hiện</h3><p>Vui lòng xác nhận phạm vi công việc với khách hàng. Các nút thao tác chỉ cập nhật dữ liệu demo trên trình duyệt.</p></Surface></div>
    </>
  );
}

export function SchedulePage() {
  const { user, orders } = useAuth();
  const jobs = orders.filter((order) => order.staffId === user?.id).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  return <><PageHeader eyebrow="LỊCH LÀM VIỆC" title="Lịch của tôi" description="Các công việc theo lịch hẹn trong dữ liệu demo." /><Surface className="list-surface"><JobRows orders={jobs} linked /></Surface></>;
}

export function AdminHome() {
  const { orders } = useAuth();
  const completed = orders.filter((order) => order.status === "completed");
  const active = orders.filter((order) => !["completed", "cancelled"].includes(order.status));
  const totalRevenue = completed.reduce((sum, order) => sum + order.price, 0);
  return (
    <>
      <PageHeader eyebrow="TRUNG TÂM ĐIỀU HÀNH" title="Tổng quan hoạt động" description="Theo dõi các đơn dịch vụ và danh mục trên bản demo." />
      <div className="stat-grid"><StatCard icon={ClipboardList} label="Tổng đơn dịch vụ" value={orders.length} note="Đơn mẫu và demo" /><StatCard icon={Clock3} label="Đang xử lý" value={active.length} note="Chờ xác nhận hoặc thực hiện" tone="yellow" /><StatCard icon={CreditCard} label="Doanh thu hoàn tất" value={formatPrice(totalRevenue)} note="Giá trị demo, không phải giao dịch" tone="blue" /><StatCard icon={Wrench} label="Dịch vụ đang hiển thị" value={services.length} note="Danh mục minh họa" tone="peach" /></div>
      <Surface className="list-surface"><div className="surface-heading"><div><span className="eyebrow">MỚI NHẤT</span><h2>Đơn dịch vụ gần đây</h2></div><Link className="text-link" to="/admin/orders">Quản lý đơn →</Link></div><DataTable columns={["Mã đơn", "Khách hàng", "Dịch vụ", "Thời gian", "Trạng thái"]} rows={orders.slice(0, 5).map((order) => ({ key: order.id, cells: [order.id, order.customer, order.service, dateTime(order.scheduledAt), <StatusBadge status={order.status} />] }))} /></Surface>
    </>
  );
}

const customers = [
  ["KH001", "Nguyễn Thị Lan", "lan.nguyen@example.vn", "Đang hoạt động"],
  ["KH002", "Trần Minh Quân", "quan.tran@example.vn", "Đang hoạt động"],
  ["KH003", "Lê Thu Hà", "ha.le@example.vn", "Đang hoạt động"],
  ["KH004", "Phạm Đức Anh", "anh.pham@example.vn", "Đang hoạt động"],
];
const staffMembers = [
  ["NV001", "Trần Minh Hùng", "Điện nước & sửa chữa", "Đang hoạt động"],
  ["NV002", "Phạm Quốc Bảo", "Vệ sinh & chăm sóc nhà", "Đang hoạt động"],
  ["NV003", "Lê Hoàng Nam", "Điện lạnh & lắp đặt", "Đang hoạt động"],
];

const sectionDetails = {
  orders: { title: "Đơn dịch vụ", eyebrow: "VẬN HÀNH", description: "Tổng hợp yêu cầu đặt dịch vụ của khách hàng." },
  services: { title: "Danh mục dịch vụ", eyebrow: "DANH MỤC", description: "Các dịch vụ tại nhà đang được giới thiệu trong giao diện demo." },
  staff: { title: "Đội ngũ nhân viên", eyebrow: "NHÂN SỰ", description: "Thông tin mẫu về nhóm nhân viên cung cấp dịch vụ." },
  users: { title: "Khách hàng", eyebrow: "TÀI KHOẢN", description: "Danh sách khách hàng minh họa." },
  reports: { title: "Báo cáo hoạt động", eyebrow: "PHÂN TÍCH", description: "Số liệu được tổng hợp từ dữ liệu mẫu đang lưu trên trình duyệt." },
};

export function AdminManagementPage({ section }) {
  const { orders, updateOrder } = useAuth();
  const [query, setQuery] = useState("");
  const detail = sectionDetails[section];
  const rows = useMemo(() => {
    if (section === "orders") return orders.map((order) => ({
      key: order.id,
      cells: [
        order.id,
        order.customer,
        order.service,
        dateTime(order.scheduledAt),
        formatPrice(order.price),
        <StatusBadge status={order.status} />,
        order.status === "pending"
          ? <button className="table-action" onClick={() => updateOrder(order.id, { status: "confirmed", staffId: "demo-staff", staff: "Trần Minh Hùng" })}>Xác nhận & phân công</button>
          : "—",
      ],
    }));
    if (section === "services") return services.map((service) => ({ key: service.id, cells: [service.name, serviceCategories.find((item) => item.id === service.category)?.label, `${formatPrice(service.price)} / ${service.unit}`, <StatusBadge status="active" />] }));
    if (section === "staff") return staffMembers.map(([code, name, specialty, status]) => ({ key: code, cells: [code, name, specialty, status] }));
    if (section === "users") return customers.map(([code, name, email, status]) => ({ key: code, cells: [code, name, email, status] }));
    return [];
  }, [orders, section, updateOrder]);
  const filteredRows = rows.filter((row) => row.cells.map((cell) => typeof cell === "string" ? cell : "").join(" ").toLowerCase().includes(query.toLowerCase()));

  if (section === "reports") {
    const countByStatus = ["pending", "confirmed", "in_progress", "completed", "cancelled"].map((status) => ({ status, count: orders.filter((order) => order.status === status).length }));
    return (
      <>
        <PageHeader eyebrow={detail.eyebrow} title={detail.title} description={detail.description} />
        <div className="stat-grid"><StatCard icon={ClipboardList} label="Tổng đơn" value={orders.length} note="Tất cả trạng thái" /><StatCard icon={Users} label="Khách hàng mẫu" value={customers.length} note="Tài khoản minh họa" /><StatCard icon={CreditCard} label="Hoàn tất" value={formatPrice(orders.filter((order) => order.status === "completed").reduce((sum, order) => sum + order.price, 0))} note="Giá trị demo" /></div>
        <Surface className="list-surface"><h2>Phân bố trạng thái đơn</h2><div className="report-bars">{countByStatus.map(({ status, count }) => <div className="report-bar" key={status}><span><StatusBadge status={status} /></span><div><i style={{ width: `${Math.max(4, (count / Math.max(orders.length, 1)) * 100)}%` }} /></div><strong>{count}</strong></div>)}</div></Surface>
        <p className="muted-note">Không dùng các số liệu này để đưa ra quyết định kinh doanh: dữ liệu chỉ phục vụ xem thử giao diện.</p>
      </>
    );
  }
  const columns = section === "orders" ? ["Mã đơn", "Khách hàng", "Dịch vụ", "Thời gian", "Tạm tính", "Trạng thái", "Thao tác"] : section === "services" ? ["Dịch vụ", "Nhóm", "Giá tham khảo", "Trạng thái"] : section === "staff" ? ["Mã", "Nhân viên", "Chuyên môn", "Trạng thái"] : ["Mã", "Khách hàng", "Email", "Trạng thái"];
  return (
    <>
      <PageHeader eyebrow={detail.eyebrow} title={detail.title} description={detail.description} />
      <Surface className="list-surface"><label className="search-field management-search"><span aria-hidden="true">⌕</span><input placeholder="Tìm trong danh sách..." value={query} onChange={(event) => setQuery(event.target.value)} /></label><DataTable columns={columns} rows={filteredRows} empty="Không tìm thấy kết quả." /></Surface>
      {section === "services" && <p className="muted-note">Giá và danh mục đang là dữ liệu tĩnh trong giao diện. Chức năng thêm/sửa dịch vụ sẽ cần API quản trị.</p>}
    </>
  );
}
