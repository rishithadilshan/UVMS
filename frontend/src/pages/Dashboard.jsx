import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import StatusBadge from "../components/StatusBadge";
import { TableSkeleton } from "../components/Skeleton";
import { fmt12, fmtDate, ROLE_LABEL, DIRECT_ROLES } from "../lib/format";

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const upcoming = data?.upcoming ?? null, pending = data?.pendingRequests ?? 0, changes = data?.changeRequests ?? 0;

  useEffect(() => {
    let live = true;
    api.get("/dashboard/summary").then((r) => { if (live) setData(r.data); }).catch(() => { if (live) setError(true); }); // one request instead of three
    return () => { live = false; };
  }, []);

  return (
    <div>
      <div className="page-header"><div><h1>Welcome, {user.name.split(" ")[0]}</h1><p>{ROLE_LABEL[user.role]} · {DIRECT_ROLES.includes(user.role) ? "your bookings are confirmed immediately" : "booking requests are approved by an administrator"}</p></div><Link className="btn btn-primary" to="/find-venue">Find a venue</Link></div>
      <div className="stat-grid">
        <Link to="/my-bookings" className="stat"><div className="num">{upcoming?.length ?? "–"}</div><div className="lbl">Upcoming bookings</div></Link>
        {user.role === "STUDENT" && <Link to="/my-bookings" className="stat"><div className="num">{pending}</div><div className="lbl">Requests awaiting approval</div></Link>}
        <Link to="/venue-changes" className={`stat ${changes ? "alert" : ""}`}><div className="num">{changes}</div><div className="lbl">Venue change requests for you</div></Link>
        <Link to="/calendar" className="stat"><div className="num">📅</div><div className="lbl">Venue availability calendar</div></Link>
      </div>
      <div className="card">
        <h3>Upcoming bookings</h3>
        {error ? <p className="empty-state">Could not load your bookings. Please refresh the page.</p> : !upcoming ? <TableSkeleton rows={3} cols={6} /> : upcoming.length === 0 ? <p className="empty-state">Nothing booked yet. <Link to="/find-venue">Find a venue</Link>.</p> : (
          <div className="table-scroll"><table><thead><tr><th>Venue</th><th>Date</th><th>Time</th><th>Purpose</th><th>Status</th><th></th></tr></thead><tbody>
            {upcoming.map((b) => (<tr key={b.id}><td>{b.venue.name}</td><td>{fmtDate(b.date)}</td><td>{fmt12(b.startTime)} – {fmt12(b.endTime)}</td><td>{b.purpose}</td><td><StatusBadge status={b.status} /></td><td><Link to={`/bookings/${b.id}`}>Details</Link></td></tr>))}
          </tbody></table></div>)}
      </div>
    </div>
  );
}
