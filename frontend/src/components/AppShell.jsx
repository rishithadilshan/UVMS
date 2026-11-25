import { Suspense, useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ThemeToggle } from "../context/ThemeContext";
import { useNotifications } from "../context/NotificationsContext";
import NotificationBell from "./NotificationBell";
import api from "../api/client";
import { PageSkeleton } from "./Skeleton";
import { ROLE_LABEL } from "../lib/format";

const USER_NAV = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/find-venue", label: "Find a Venue" },
  { to: "/my-bookings", label: "My Bookings" },
  { to: "/calendar", label: "Venue Calendar" },
  { to: "/venue-changes", label: "Venue Change Requests" },
];
const NAV_BY_ROLE = {
  ADMIN: [
    { to: "/admin", label: "Dashboard Overview", end: true },
    { to: "/admin/registrations", label: "Registration Requests", badge: "pendingRegistrations" },
    { to: "/admin/bookings", label: "Booking Management", badge: "pendingModifications" },
    { to: "/admin/student-requests", label: "Student Booking Requests", badge: "pendingStudentRequests" },
    { to: "/admin/venues", label: "Venue Management" },
    { to: "/admin/maintenance", label: "Venue Maintenance", badge: "openMaintenanceConflicts" },
    { to: "/admin/priority", label: "Booking Priority Management" },
    { to: "/admin/venue-changes", label: "Venue Change Requests", badge: "pendingChangeRequests" },
    { to: "/calendar", label: "Venue Calendar" },
    { to: "/admin/users", label: "User Management" },
    { to: "/notifications", label: "Notifications" },
    { to: "/admin/reports", label: "Reports and Analytics" },
    { to: "/admin/settings", label: "Settings" },
  ],
  LECTURER: USER_NAV,
  INSTRUCTOR: USER_NAV,
  STUDENT: USER_NAV,
  LAB_ASSISTANT: [...USER_NAV, { to: "/lab/status", label: "Lab Status" }],
};
const TITLES = { "/check-in": "Check-in", "/notifications": "Notifications", "/lab/status": "Lab Status" };

export default function AppShell() {
  const { user, logout } = useAuth();
  const { onNew } = useNotifications();
  const [open, setOpen] = useState(() => window.matchMedia("(min-width: 901px)").matches);
  const [overview, setOverview] = useState(null); // { counts, recent } — one request feeds the sidebar badges AND the Overview page
  const counts = overview?.counts || {};
  const [flash, setFlash] = useState(() => { const f = sessionStorage.getItem("uvms_flash"); if (f) sessionStorage.removeItem("uvms_flash"); return f; });
  const location = useLocation();
  const links = NAV_BY_ROLE[user.role] || USER_NAV;

  const reloadOverview = useCallback(() => api.get("/admin/overview").then((r) => setOverview(r.data)).catch(() => {}), []);
  useEffect(() => {
    if (user.role !== "ADMIN") return undefined;
    reloadOverview();
    const t = setInterval(() => { if (!document.hidden) reloadOverview(); }, 60000); // no polling while the tab is in the background
    const off = onNew(reloadOverview);
    return () => { clearInterval(t); off(); };
  }, [user.role, onNew, reloadOverview]);

  const current = links.find((l) => (l.end ? location.pathname === l.to : location.pathname.startsWith(l.to)));
  const title = current?.label || TITLES[location.pathname] || (location.pathname.startsWith("/bookings/") ? "Booking details" : "UVMS");
  const initials = user.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="app-shell" data-testid="app-shell">
      <div className={`scrim ${open ? "show" : ""}`} />
      <aside className={`sidebar ${open ? "open" : "closed"}`}>
        <div><span className="brand">UVMS</span><span className="brand-sub">University Venue Management</span></div>
        <nav aria-label="Main">
          {links.map((l) => (
            <NavLink key={l.to + l.label} to={l.to} end={l.end} className={({ isActive }) => (isActive ? "active" : "")}>
              <span>{l.label}</span>{l.badge && counts[l.badge] > 0 && <span className="nav-count">{counts[l.badge]}</span>}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="main-col">
        <header className="topbar">
          <button
            className="icon-btn menu-btn"
            onClick={() => setOpen((prev) => !prev)}
            aria-label="Toggle menu"
            aria-expanded={open}
          >
            ☰
          </button>
          <div className="crumb">{title}</div>
          <NotificationBell />
          <ThemeToggle />
          <div className="profile-chip"><div className="avatar">{initials}</div><div className="who">{user.name}<small>{ROLE_LABEL[user.role]}</small></div></div>
          <button className="btn btn-outline btn-sm" onClick={logout}>Log out</button>
        </header>
        <main className="main">
          {flash && <div className="alert alert-success" role="status">{flash} <button className="link-btn" onClick={() => setFlash(null)}>Dismiss</button></div>}
          <Suspense fallback={<PageSkeleton />}><Outlet context={{ overview, reloadOverview }} /></Suspense>
        </main>
      </div>
    </div>
  );
}
