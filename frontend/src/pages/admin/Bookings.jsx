import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import BookingDetails from "../../components/BookingDetails";
import BookingModal from "../../components/BookingModal";
import { ConfirmDialog } from "../../components/Modal";
import Pagination from "../../components/Pagination";
import StatusBadge from "../../components/StatusBadge";
import { errMsg, fmt12, fmtDate, todayStr, ROLE_LABEL } from "../../lib/format";
import { useDebounced } from "../../lib/useDebounced";

export default function Bookings() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "requests" ? "requests" : "bookings";
  const [filters, setFilters] = useState({ status: "", time: "", q: "", venueId: "", from: "", to: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, pageSize: 20 });
  const [reqs, setReqs] = useState({ items: [], total: 0 });
  const [venues, setVenues] = useState([]); const [cats, setCats] = useState([]);
  const [open, setOpen] = useState(null); const [cancel, setCancel] = useState(null); const [decide, setDecide] = useState(null); const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState(""); const [error, setError] = useState("");
  const [nb, setNb] = useState({ ownerId: "", venueId: "", date: todayStr(), startTime: "09:00", endTime: "11:00", participants: "" }); const [users, setUsers] = useState([]); const [book, setBook] = useState(false);

  useEffect(() => { api.get("/venues").then((r) => setVenues(r.data)); api.get("/categories").then((r) => setCats(r.data)); }, []);
  const dFilters = useDebounced(filters, 300); // typing in the search box no longer sends a request per key
  const loadBookings = useCallback(() => {
    const p = { scope: "all", page, pageSize: 20, ...Object.fromEntries(Object.entries(dFilters).filter(([, v]) => v)) };
    api.get("/bookings", { params: p }).then((r) => { setData(r.data); setError(""); }).catch((e) => setError(errMsg(e)));
  }, [dFilters, page]);
  const loadReqs = useCallback(() => { api.get("/modification-requests", { params: { status: "PENDING" } }).then((r) => setReqs(r.data)); }, []);
  const load = useCallback(() => { loadBookings(); loadReqs(); }, [loadBookings, loadReqs]); // used after changes: refreshes both lists
  useEffect(() => { loadBookings(); }, [loadBookings]);
  useEffect(() => { loadReqs(); }, [loadReqs]);
  useEffect(() => { if (creating && !users.length) api.get("/users").then((r) => setUsers(r.data.filter((u) => u.status === "APPROVED" && u.active && u.role !== "ADMIN"))); }, [creating]); // eslint-disable-line
  const setF = (k, v) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1); };

  const venue = venues.find((v) => v.id === nb.venueId);
  return (
    <div>
      <div className="page-header"><div><h1>Booking management</h1><p>Every booking, including direct lecturer, instructor and lab assistant bookings.</p></div><button className="btn btn-primary" onClick={() => setCreating(!creating)}>+ Booking for a user</button></div>
      {msg && <div className="alert alert-success">{msg}</div>}{error && <div className="alert alert-error">{error}</div>}
      {creating && (
        <div className="card"><h3>Create a booking on behalf of a user</h3>
          <div className="form-row">
            <div><label>User</label><select value={nb.ownerId} onChange={(e) => setNb({ ...nb, ownerId: e.target.value })}><option value="">Select…</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name} ({ROLE_LABEL[u.role]})</option>)}</select></div>
            <div><label>Venue</label><select value={nb.venueId} onChange={(e) => setNb({ ...nb, venueId: e.target.value })}><option value="">Select…</option>{venues.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.capacity})</option>)}</select></div>
            <div><label>Date</label><input type="date" min={todayStr()} value={nb.date} onChange={(e) => setNb({ ...nb, date: e.target.value })} /></div>
            <div><label>Start</label><input type="time" step="300" value={nb.startTime} onChange={(e) => setNb({ ...nb, startTime: e.target.value })} /></div>
            <div><label>End</label><input type="time" step="300" value={nb.endTime} onChange={(e) => setNb({ ...nb, endTime: e.target.value })} /></div>
            <div><label>Participants</label><input type="number" min="1" value={nb.participants} onChange={(e) => setNb({ ...nb, participants: e.target.value })} /></div>
          </div>
          <div className="form-actions"><button className="btn btn-primary" disabled={!nb.ownerId || !nb.venueId} onClick={() => setBook(true)}>Continue</button></div>
          <p className="hint-text">Replaces the old "Allocate lecture" page: pick any user, venue and flexible time range. Availability and capacity are validated on the server.</p>
        </div>)}
      {book && venue && <BookingModal venue={venue} defaults={{ ...nb, facilities: [] }} user={user} categories={cats} ownerId={nb.ownerId} onClose={() => setBook(false)} onDone={() => { setMsg("Booking created."); load(); }} />}

      <div className="tabs"><button className={`tab ${tab === "bookings" ? "active" : ""}`} onClick={() => setParams({})}>All bookings</button><button className={`tab ${tab === "requests" ? "active" : ""}`} onClick={() => setParams({ tab: "requests" })}>Modification &amp; cancellation requests{reqs.total ? ` (${reqs.total})` : ""}</button></div>

      {tab === "bookings" && (<>
        <div className="card"><div className="form-row">
          <div><label>Search</label><input placeholder="Purpose, venue or user" value={filters.q} onChange={(e) => setF("q", e.target.value)} /></div>
          <div><label>Status</label><select value={filters.status} onChange={(e) => setF("status", e.target.value)}><option value="">All</option>{["PENDING", "CONFIRMED", "REJECTED", "CANCELLED", "EXPIRED"].map((s) => <option key={s}>{s}</option>)}</select></div>
          <div><label>When</label><select value={filters.time} onChange={(e) => setF("time", e.target.value)}><option value="">Any</option><option value="upcoming">Upcoming</option><option value="past">Past</option></select></div>
          <div><label>Venue</label><select value={filters.venueId} onChange={(e) => setF("venueId", e.target.value)}><option value="">All venues</option>{venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
          <div><label>From</label><input type="date" value={filters.from} onChange={(e) => setF("from", e.target.value)} /></div>
          <div><label>To</label><input type="date" value={filters.to} onChange={(e) => setF("to", e.target.value)} /></div>
        </div></div>
        <div className="card">
          {data.items.length === 0 ? <p className="empty-state">No bookings match.</p> : (
            <div className="table-scroll"><table><thead><tr><th>Venue</th><th>Date</th><th>Time</th><th>Booked by</th><th>Purpose</th><th>Category</th><th>Status</th><th></th></tr></thead><tbody>
              {data.items.map((b) => (<tr key={b.id}><td>{b.venue.name}<div className="hint-text">{b.venue.building}</div></td><td>{fmtDate(b.date)}</td><td>{fmt12(b.startTime)} – {fmt12(b.endTime)}</td><td>{b.owner?.name || "—"}<div className="hint-text">{b.owner ? ROLE_LABEL[b.owner.role] : ""}</div></td><td>{b.purpose}</td><td>{b.category?.name || "—"}</td><td><StatusBadge status={b.status} /></td>
                <td><div style={{ display: "flex", gap: 6 }}><button className="btn btn-outline btn-sm" onClick={() => setOpen(b.id)}>Details</button>{["PENDING", "CONFIRMED"].includes(b.status) && <button className="btn btn-danger btn-sm" onClick={() => setCancel(b)}>Cancel</button>}</div></td></tr>))}
            </tbody></table></div>)}
          <Pagination page={page} pageSize={data.pageSize || 20} total={data.total} onPage={setPage} />
        </div>
      </>)}

      {tab === "requests" && (
        <div className="card">
          {reqs.items.length === 0 ? <p className="empty-state">No pending requests.</p> : (
            <div className="table-scroll"><table><thead><tr><th>Type</th><th>Student</th><th>Booking</th><th>Requested changes / reason</th><th></th></tr></thead><tbody>
              {reqs.items.map((r) => (<tr key={r.id}><td><span className="badge badge-info">{r.kind}</span></td><td>{r.requesterName}</td><td>{r.venueName}<div className="hint-text">{fmtDate(r.date)}, {fmt12(r.startTime)} – {fmt12(r.endTime)}</div></td>
                <td>{r.kind === "MODIFY" ? Object.entries(r.changes).map(([k, v]) => <div key={k}>{k}: <strong>{Array.isArray(v) ? v.join(", ") : String(v)}</strong></div>) : null}<div className="hint-text">{r.reason}</div></td>
                <td><div style={{ display: "flex", gap: 6 }}><button className="btn btn-success btn-sm" onClick={async () => { try { await api.post(`/modification-requests/${r.id}/decision`, { decision: "APPROVE" }); setMsg("Request approved."); load(); } catch (e) { setError(errMsg(e)); } }}>Approve</button><button className="btn btn-danger btn-sm" onClick={() => setDecide(r)}>Reject</button></div></td></tr>))}
            </tbody></table></div>)}
        </div>)}

      {open && <BookingDetails id={open} user={user} venues={venues} onClose={() => setOpen(null)} onChanged={load} />}
      {cancel && <ConfirmDialog title="Cancel booking" danger askReason confirmLabel="Cancel booking" message={`Cancel ${cancel.venue.name} on ${fmtDate(cancel.date)}? The owner is notified with your reason.`} onClose={() => setCancel(null)} onConfirm={async (reason) => { await api.post(`/bookings/${cancel.id}/cancel`, { reason }); setMsg("Booking cancelled."); load(); }} />}
      {decide && <ConfirmDialog title="Reject request" danger askReason reasonLabel="Reason" confirmLabel="Reject" onClose={() => setDecide(null)} onConfirm={async (note) => { await api.post(`/modification-requests/${decide.id}/decision`, { decision: "REJECT", note }); setMsg("Request rejected."); load(); }} />}
    </div>
  );
}
