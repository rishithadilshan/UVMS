import { lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { RequireAuth, RequireRole } from "./components/RouteGuards";
import AppShell from "./components/AppShell";

import Login from "./pages/Login";
import Register from "./pages/Register";
const Dashboard = lazy(() => import("./pages/Dashboard"));
const FindVenue = lazy(() => import("./pages/FindVenue"));
const MyBookings = lazy(() => import("./pages/MyBookings"));
const VenueChanges = lazy(() => import("./pages/VenueChanges"));
const CalendarPage = lazy(() => import("./pages/CalendarPage"));
const Notifications = lazy(() => import("./pages/Notifications"));
const CheckIn = lazy(() => import("./pages/CheckIn"));
import NotFound from "./pages/NotFound";
const LabStatus = lazy(() => import("./pages/labassistant/LabStatus"));

const AdminOverview = lazy(() => import("./pages/admin/Overview"));
const AdminRegistrations = lazy(() => import("./pages/admin/Registrations"));
const AdminBookings = lazy(() => import("./pages/admin/Bookings"));
const AdminStudentRequests = lazy(() => import("./pages/admin/StudentRequests"));
const AdminVenues = lazy(() => import("./pages/admin/Venues"));
const AdminMaintenance = lazy(() => import("./pages/admin/Maintenance"));
const AdminPriority = lazy(() => import("./pages/admin/Priority"));
const AdminUsers = lazy(() => import("./pages/admin/Users"));
const AdminReports = lazy(() => import("./pages/admin/Reports"));
const AdminSettings = lazy(() => import("./pages/admin/Settings"));

function HomeRedirect() {
  const { user } = useAuth();
  return <Navigate to={user.role === "ADMIN" ? "/admin" : "/dashboard"} replace />;
}
const Admin = ({ children }) => <RequireRole roles={["ADMIN"]}>{children}</RequireRole>;
const NotAdmin = ({ children }) => <RequireRole roles={["LECTURER", "INSTRUCTOR", "STUDENT", "LAB_ASSISTANT"]}>{children}</RequireRole>;

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/check-in" element={<CheckIn />} />

        <Route path="/dashboard" element={<NotAdmin><Dashboard /></NotAdmin>} />
        <Route path="/find-venue" element={<NotAdmin><FindVenue /></NotAdmin>} />
        <Route path="/my-bookings" element={<NotAdmin><MyBookings /></NotAdmin>} />
        <Route path="/bookings/:id" element={<MyBookings />} />
        <Route path="/venue-changes" element={<NotAdmin><VenueChanges /></NotAdmin>} />
        <Route path="/lab/status" element={<RequireRole roles={["LAB_ASSISTANT"]}><LabStatus /></RequireRole>} />

        <Route path="/admin" element={<Admin><AdminOverview /></Admin>} />
        <Route path="/admin/registrations" element={<Admin><AdminRegistrations /></Admin>} />
        <Route path="/admin/bookings" element={<Admin><AdminBookings /></Admin>} />
        <Route path="/admin/student-requests" element={<Admin><AdminStudentRequests /></Admin>} />
        <Route path="/admin/venues" element={<Admin><AdminVenues /></Admin>} />
        <Route path="/admin/maintenance" element={<Admin><AdminMaintenance /></Admin>} />
        <Route path="/admin/priority" element={<Admin><AdminPriority /></Admin>} />
        <Route path="/admin/venue-changes" element={<Admin><VenueChanges admin /></Admin>} />
        <Route path="/admin/users" element={<Admin><AdminUsers /></Admin>} />
        <Route path="/admin/reports" element={<Admin><AdminReports /></Admin>} />
        <Route path="/admin/settings" element={<Admin><AdminSettings /></Admin>} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
