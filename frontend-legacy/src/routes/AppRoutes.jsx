import { Link, Navigate, Route, Routes } from "react-router-dom";
import PublicLayout from "../components/layout/PublicLayout";
import PortalLayout from "../components/layout/PortalLayout";
import AuthPage from "../pages/AuthPage";
import PublicHome from "../pages/PublicHome";
import AdminHome from "../pages/admin/Home";
import AdminOrders from "../pages/admin/Orders";
import AdminPayments from "../pages/admin/Payments";
import AdminReports from "../pages/admin/Reports";
import AdminReviews from "../pages/admin/Reviews";
import AdminServices from "../pages/admin/Services";
import AdminStaff from "../pages/admin/Staff";
import AdminUsers from "../pages/admin/Users";
import StaffHome from "../pages/staff/Home";
import StaffJobDetail from "../pages/staff/JobDetail";
import StaffJobs from "../pages/staff/Jobs";
import StaffProfile from "../pages/staff/Profile";
import StaffSchedule from "../pages/staff/Schedule";
import UserBooking from "../pages/user/Booking";
import UserHome from "../pages/user/Home";
import UserOrders from "../pages/user/Orders";
import UserPayment from "../pages/user/Payment";
import UserProfile from "../pages/user/Profile";
import UserReviews from "../pages/user/Reviews";
import UserServiceDetail from "../pages/user/ServiceDetail";
import UserServices from "../pages/user/Services";
import UserProducts from "../pages/user/Products";
import AdminProducts from "../pages/admin/Products";
import RoleRoute from "./RoleRoute";

function NotFound() {
  return <main className="not-found"><span className="eyebrow">404 · KHÔNG TÌM THẤY TRANG</span><h1>Đường dẫn này chưa có.</h1><p>Hãy quay lại trang chủ hoặc chọn một khu vực làm việc.</p><Link className="button button-primary" to="/">Về trang chủ</Link></main>;
}

export default function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<PublicHome />} />
        <Route path="services" element={<UserServices />} />
        <Route path="services/:slug" element={<UserServiceDetail />} />
        <Route path="products" element={<UserProducts publicPage />} />
        <Route path="login" element={<AuthPage />} />
        <Route path="register" element={<AuthPage register />} />
        <Route path="*" element={<NotFound />} />
      </Route>

      <Route path="user" element={<RoleRoute role="user" />}>
        <Route element={<PortalLayout role="user" />}>
          <Route index element={<UserHome />} />
          <Route path="services" element={<UserServices />} />
          <Route path="services/:slug" element={<UserServiceDetail />} />
          <Route path="products" element={<UserProducts />} />
          <Route path="bookings" element={<UserBooking />} />
          <Route path="orders" element={<UserOrders />} />
          <Route path="payments" element={<UserPayment />} />
          <Route path="reviews" element={<UserReviews />} />
          <Route path="profile" element={<UserProfile />} />
        </Route>
      </Route>

      <Route path="staff" element={<RoleRoute role="staff" />}>
        <Route element={<PortalLayout role="staff" />}>
          <Route index element={<StaffHome />} />
          <Route path="jobs" element={<StaffJobs />} />
          <Route path="jobs/:id" element={<StaffJobDetail />} />
          <Route path="schedule" element={<StaffSchedule />} />
          <Route path="profile" element={<StaffProfile />} />
        </Route>
      </Route>

      <Route path="admin" element={<RoleRoute role="admin" />}>
        <Route element={<PortalLayout role="admin" />}>
          <Route index element={<AdminHome />} />
          <Route path="orders" element={<AdminOrders />} />
          <Route path="services" element={<AdminServices />} />
          <Route path="products" element={<AdminProducts />} />
          <Route path="staff" element={<AdminStaff />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="payments" element={<AdminPayments />} />
          <Route path="reviews" element={<AdminReviews />} />
          <Route path="reports" element={<AdminReports />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
