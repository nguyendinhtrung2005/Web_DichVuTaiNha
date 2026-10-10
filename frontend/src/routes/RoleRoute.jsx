import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function RoleRoute({ role }) {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) {
    return <Navigate to={`/login?role=${role}`} state={{ from: location }} replace />;
  }
  if (user.role !== role) {
    return <Navigate to={`/${user.role}`} replace />;
  }
  return <Outlet />;
}
