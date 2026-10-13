import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  CalendarDays,
  ChartNoAxesCombined,
  ClipboardList,
  CreditCard,
  House,
  LogOut,
  Menu,
  MessageSquareText,
  Package,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";

const roleDetails = {
  user: { title: "Khách hàng", workspace: "Tài khoản của tôi" },
  staff: { title: "Nhân viên", workspace: "Khu vực nhân viên" },
  admin: { title: "Quản trị", workspace: "Trung tâm điều hành" },
};

const navItems = {
  user: [
    { to: "/user", label: "Tổng quan", icon: House, end: true },
    { to: "/user/services", label: "Khám phá dịch vụ", icon: Sparkles },
    { to: "/user/products", label: "Sản phẩm", icon: Package },
    { to: "/user/orders", label: "Đơn của tôi", icon: ClipboardList },
    { to: "/user/payments", label: "Thanh toán", icon: CreditCard },
    { to: "/user/reviews", label: "Đánh giá", icon: MessageSquareText },
    { to: "/user/profile", label: "Hồ sơ cá nhân", icon: Settings },
  ],
  staff: [
    { to: "/staff", label: "Tổng quan", icon: House, end: true },
    { to: "/staff/jobs", label: "Công việc", icon: ClipboardList },
    { to: "/staff/schedule", label: "Lịch làm việc", icon: CalendarDays },
    { to: "/staff/profile", label: "Hồ sơ cá nhân", icon: Settings },
  ],
  admin: [
    { to: "/admin", label: "Tổng quan", icon: House, end: true },
    { to: "/admin/orders", label: "Đơn dịch vụ", icon: ClipboardList },
    { to: "/admin/services", label: "Danh mục dịch vụ", icon: Wrench },
    { to: "/admin/products", label: "Sản phẩm & đơn mua", icon: Package },
    { to: "/admin/staff", label: "Đội ngũ nhân viên", icon: Users },
    { to: "/admin/users", label: "Khách hàng", icon: Users },
    { to: "/admin/payments", label: "Thanh toán", icon: CreditCard },
    { to: "/admin/reviews", label: "Đánh giá", icon: MessageSquareText },
    { to: "/admin/reports", label: "Báo cáo", icon: ChartNoAxesCombined },
  ],
};

export default function PortalLayout({ role }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const details = roleDetails[role];

  function signOut() {
    logout();
    navigate("/");
  }

  return (
    <div className={`portal portal-${role}`}>
      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <NavLink className="brand" to={role === "user" ? "/user" : `/${role}`}>
          <span className="brand-mark"><House size={21} strokeWidth={2.4} /></span>
          <span>CleanHome<span className="brand-dot">.</span><small>DỊCH VỤ TẠI NHÀ</small></span>
        </NavLink>
        <div className="workspace-label">{details.workspace}</div>
        <nav className="side-nav" aria-label="Điều hướng chính">
          {navItems[role].map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} end={end} to={to} onClick={() => setMenuOpen(false)}>
              <Icon size={18} aria-hidden="true" /><span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-tip"><ShieldCheck size={18} /><strong>Chăm sóc an tâm</strong><span>Đặt dịch vụ tại nhà, theo dõi rõ ràng từng bước.</span></div>
          <button className="nav-logout" type="button" onClick={signOut}><LogOut size={17} /> Đăng xuất</button>
        </div>
      </aside>
      {menuOpen && <button className="sidebar-scrim" aria-label="Đóng menu" onClick={() => setMenuOpen(false)} />}
      <div className="portal-content">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label={menuOpen ? "Đóng menu" : "Mở menu"} onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <span className="topbar-context">{details.title}<span className="demo-pill">Bản demo</span></span>
          <div className="topbar-user">
            <div className="avatar">{user?.name?.slice(0, 1) || "N"}</div>
            <div><strong>{user?.name || "Khách"}</strong><small>{details.title}</small></div>
          </div>
        </header>
        <main className="main-content"><Outlet /></main>
        <footer className="portal-footer"><span>© 2026 CleanHome</span><span>Giao diện minh họa · Chưa kết nối API</span></footer>
      </div>
    </div>
  );
}
