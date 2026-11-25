import { Link, useOutletContext } from "react-router-dom";
import { fmtDateTime } from "../../lib/format";
import { StatGridSkeleton, TableSkeleton } from "../../components/Skeleton";

const CARDS = [
  ["pendingRegistrations", "Registration requests", "/admin/registrations", true], ["pendingStudentRequests", "Student booking requests", "/admin/student-requests", true],
  ["pendingChangeRequests", "Venue change requests", "/admin/venue-changes", false], ["pendingModifications", "Modification / cancellation requests", "/admin/bookings?tab=requests", true],
  ["openMaintenanceConflicts", "Bookings affected by maintenance", "/admin/maintenance", true], ["bookingsToday", "Confirmed bookings today", "/admin/bookings", false],
  ["upcomingBookings", "Upcoming confirmed bookings", "/admin/bookings", false], ["venues", "Active venues", "/admin/venues", false],
  ["unavailableVenues", "Venues unavailable right now", "/admin/maintenance", false], ["users", "Approved users", "/admin/users", false],
];

export default function Overview() {
  const { overview: data } = useOutletContext(); // loaded once by AppShell (previously fetched twice on this page)
  return (
    <div>
      <div className="page-header"><div><h1>Dashboard overview</h1><p>Live figures from the database.</p></div></div>
      {!data ? (<><StatGridSkeleton count={CARDS.length} /><div className="card"><h3>Recent system activity</h3><TableSkeleton rows={4} cols={4} /></div></>) : (<>
        <div className="stat-grid">{CARDS.map(([k, label, to, warn]) => (<Link key={k} to={to} className={`stat ${warn && data.counts[k] > 0 ? "alert" : ""}`}><div className="num">{data.counts[k]}</div><div className="lbl">{label}</div></Link>))}</div>
        <div className="card"><h3>Recent system activity</h3>
          {data.recent.length === 0 ? <p className="empty-state">No activity yet.</p> : <div className="table-scroll"><table><tbody>{data.recent.map((a) => (<tr key={a.id}><td>{fmtDateTime(a.createdAt)}</td><td>{a.actorName || "System"}</td><td>{a.action}</td><td>{a.entityType}</td></tr>))}</tbody></table></div>}
          <Link to="/notifications">Open full activity log →</Link>
        </div>
      </>)}
    </div>
  );
}
