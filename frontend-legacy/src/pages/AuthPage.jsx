import { useState } from "react";
import { ArrowLeft, House, ShieldCheck } from "lucide-react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { demoAccounts } from "../data/demoOrders";

const roleLabels = { user: "Khách hàng", staff: "Nhân viên", admin: "Quản trị viên" };

export default function AuthPage({ register = false }) {
  const { login, register: createDemoAccount } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const requestedRole = searchParams.get("role");
  const [role, setRole] = useState(["user", "staff", "admin"].includes(requestedRole) ? requestedRole : "user");
  const [form, setForm] = useState({ name: "", phone: "", email: "", password: "" });
  const [error, setError] = useState("");

  function fillDemo(account) {
    setRole(account.role);
    setForm((current) => ({ ...current, email: account.email, password: account.password }));
    setError("");
  }

  function submit(event) {
    event.preventDefault();
    setError("");
    if (register) {
      if (form.password.length < 8) {
        setError("Mật khẩu cần tối thiểu 8 ký tự.");
        return;
      }
      createDemoAccount({ name: form.name, email: form.email, phone: form.phone });
      navigate("/user", { replace: true });
      return;
    }
    const result = login(form.email, form.password);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const returnLocation = location.state?.from;
    const requestedPath = searchParams.get("next")
      || (returnLocation ? `${returnLocation.pathname}${returnLocation.search || ""}` : null);
    const path = requestedPath?.startsWith(`/${result.user.role}/`) || requestedPath === `/${result.user.role}`
      ? requestedPath
      : `/${result.user.role}`;
    navigate(path, { replace: true });
  }

  return (
    <main className="auth-page">
      <section className="auth-art">
        <Link className="brand" to="/"><span className="brand-mark"><House size={21} /></span><span>CleanHome<span className="brand-dot">.</span><small>DỊCH VỤ TẠI NHÀ</small></span></Link>
        <div className="auth-art-copy"><span className="eyebrow">CHĂM SÓC TỔ ẤM</span><h1>Ngôi nhà của bạn,<br />được chăm chút<br /><em>theo cách nhẹ nhàng.</em></h1><p>Đăng nhập để quản lý dịch vụ và lịch hẹn của bạn.</p></div>
        <div className="auth-art-bottom"><ShieldCheck size={18} /> Giao diện minh họa · Chưa kết nối hệ thống thật</div>
      </section>
      <section className="auth-panel">
        <Link className="back-link" to="/"><ArrowLeft size={16} /> Về trang chủ</Link>
        <div className="auth-card">
          <span className="eyebrow">{register ? "THAM GIA NHÀ TỐT" : "CHÀO MỪNG BẠN TRỞ LẠI"}</span>
          <h2>{register ? "Tạo tài khoản khách hàng" : "Đăng nhập"}</h2>
          <p className="auth-intro">{register ? "Tạo tài khoản demo để trải nghiệm luồng đặt dịch vụ." : "Chọn vai trò để vào đúng không gian làm việc."}</p>
          {!register && <div className="role-switch" role="group" aria-label="Chọn vai trò">{Object.entries(roleLabels).map(([key, label]) => <button key={key} type="button" className={role === key ? "selected" : ""} onClick={() => { setRole(key); setError(""); }}>{label}</button>)}</div>}
          <form className="auth-form" onSubmit={submit}>
            {register && <label>Họ và tên<input required autoComplete="name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>}
            {register && <label>Số điện thoại<input required autoComplete="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>}
            <label>Email<input required type="email" autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
            <label>Mật khẩu<input required minLength={register ? 8 : 1} type="password" autoComplete={register ? "new-password" : "current-password"} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="button button-primary button-full" type="submit">{register ? "Tạo tài khoản demo" : "Đăng nhập"} <span aria-hidden="true">→</span></button>
          </form>
          <div className="demo-account-box">
            <strong>Tài khoản trải nghiệm</strong>
            <p>{roleLabels[role]} · Mật khẩu demo: <code>{demoAccounts.find((account) => account.role === role)?.password}</code></p>
            <button type="button" className="text-link" onClick={() => fillDemo(demoAccounts.find((account) => account.role === role))}>Điền thông tin demo</button>
          </div>
          <p className="auth-disclaimer">Đây là bản demo giao diện. Không dùng mật khẩu thật; tài khoản và dữ liệu được lưu trên trình duyệt này.</p>
          <p className="auth-toggle">{register ? "Đã có tài khoản?" : "Bạn là khách hàng mới?"} <Link to={register ? "/login" : "/register"}>{register ? "Đăng nhập" : "Tạo tài khoản"}</Link></p>
        </div>
      </section>
    </main>
  );
}
