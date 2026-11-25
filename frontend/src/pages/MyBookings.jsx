import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import BookingDetails from "../components/BookingDetails";
import StatusBadge from "../components/StatusBadge";
import Pagination from "../components/Pagination";
import { errMsg, fmt12, fmtDate, fmtDateTime } from "../lib/format";

const FILTERS = [["all", "All Bookings"], ["PENDING", "Pending"], ["CONFIRMED", "Confirmed"], ["REJECTED", "Rejected"], ["CANCELLED", "Cancelled"], ["EXPIRED", "Expired"], ["upcoming", "Upcoming"], ["past", "Past"]];

export default function MyBookings() {
  const { user } = useAuth();
  const { id } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState("bookings");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, pageSize: 15 });
  const [waitlist, setWaitlist] = useState([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [open, setOpen] = useState(id || null);

  const load = useCallback(() => {
    setLoading(true);
    const params = { page, pageSize: 15 };
    if (["upcoming", "past"].includes(filter)) params.time = filter; else if (filter !== "all") params.status = filter;
    api.get("/bookings", { params }).then((r) => { setData(r.data); setError(""); }).catch((e) => setError(errMsg(e))).finally(() => setLoading(false));
  }, [filter, page]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (tab === "waitlist") api.get("/waitlist").then((r) => setWaitlist(r.data)).catch(() => {}); }, [tab]);
  useEffect(() => { setOpen(id || null); }, [id]);

  const close = () => { setOpen(null); if (id) navigate("/my-bookings", { replace: true }); };
  async function leave(wid) { await api.delete(`/waitlist/${wid}`); setWaitlist((w) => w.map((x) => (x.id === wid ? { ...x, status: "CANCELLED" } : x))); }

  return (
    <div>
      <div className="page-header"><div><h1>My bookings</h1><p>Your bookings, requests and history.</p></div></div>
      {user.role !== "ADMIN" && <div className="tabs"><button className={`tab ${tab === "bookings" ? "active" : ""}`} onClick={() => setTab("bookings")}>Bookings</button><button className={`tab ${tab === "waitlist" ? "active" : ""}`} onClick={() => setTab("waitlist")}>Waitlist</button></div>}
      {tab === "bookings" && (<>
        <div className="filter-bar">{FILTERS.map(([k, label]) => <button key={k} className={`chip ${filter === k ? "active" : ""}`} onClick={() => { setFilter(k); setPage(1); }}>{label}</button>)}</div>
        {error && <p className="error-text">{error}</p>}
        <div className="card">
          {loading ? <p className="empty-state">Loading…</p> : data.items.length === 0 ? <p className="empty-state">No bookings match this filter.</p> : (
            <div className="table-scroll"><table className="responsive"><thead><tr><th>Venue</th><th>Building</th><th>Date</th><th>Start</th><th>End</th><th>Purpose</th><th>Category</th><th>Participants</th><th>Status</th><th>Created</th><th></th></tr></thead>
              <tbody>{data.items.map((b) => (
                <tr key={b.id}>
                  <td data-label="Venue">{b.venue.name}</td><td data-label="Building">{b.venue.building || "—"}</td><td data-label="Date">{fmtDate(b.date)}</td>
                  <td data-label="Start">{fmt12(b.startTime)}</td><td data-label="End">{fmt12(b.endTime)}</td><td data-label="Purpose">{b.purpose}</td>
                  <td data-label="Category">{b.category?.name || "—"}</td><td data-label="Participants">{b.participants}</td><td data-label="Status"><StatusBadge status={b.status} /></td>
                  <td data-label="Created">{fmtDateTime(b.createdAt)}</td><td><button className="btn btn-outline btn-sm" onClick={() => setOpen(b.id)}>Details</button></td>
                </tr>))}</tbody></table></div>
          )}
          <Pagination page={page} pageSize={data.pageSize || 15} total={data.total} onPage={setPage} />
        </div>
      </>)}
      {tab === "waitlist" && (
        <div className="card">
          <p className="hint-text">A waitlist notification does not reserve the venue: you still need to submit a normal booking.</p>
          {waitlist.length === 0 ? <p className="empty-state">You are not on any waitlist. Use “Notify me if it becomes available” in Find a Venue.</p> : (
            <div className="table-scroll"><table><thead><tr><th>Venue</th><th>Date</th><th>Time</th><th>Participants</th><th>Status</th><th></th></tr></thead><tbody>
              {waitlist.map((w) => (<tr key={w.id}><td>{w.venueName}</td><td>{fmtDate(w.date)}</td><td>{fmt12(w.startTime)} – {fmt12(w.endTime)}</td><td>{w.participants}</td><td><StatusBadge status={w.status} /></td>
                <td>{w.status === "WAITING" && <button className="btn btn-outline btn-sm" onClick={() => leave(w.id)}>Remove</button>}{w.status === "NOTIFIED" && <a className="btn btn-primary btn-sm" href={`/find-venue?date=${w.date}&startTime=${w.startTime}&endTime=${w.endTime}&participants=${w.participants}`}>Book now</a>}</td></tr>))}
            </tbody></table></div>)}
        </div>
      )}
      {open && <BookingDetails id={open} user={user} onClose={close} onChanged={load} />}
    </div>
  );
}
