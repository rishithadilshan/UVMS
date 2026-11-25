import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div style={{ padding: 40 }}>Loading…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return children;
}

export function RequireRole({ roles, children }) {
  const { user } = useAuth();
  if (!roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}
