import { useCallback, useEffect, useState } from "react";
import api from "../../api/client";
import BookingDetails from "../../components/BookingDetails";
import { ConfirmDialog } from "../../components/Modal";
import Pagination from "../../components/Pagination";
import { useAuth } from "../../context/AuthContext";
import { errMsg, fmt12, fmtDate, fmtDateTime } from "../../lib/format";

export default function StudentRequests() {
  const { user } = useAuth();
  const [sort, setSort] = useState("priority");
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, pageSize: 15 });
  const [reject, setReject] = useState(null); const [open, setOpen] = useState(null);
  const [msg, setMsg] = useState(""); const [error, setError] = useState("");
  const load = useCallback(() => api.get("/bookings", { params: { scope: "all", status: "PENDING", ownerRole: "STUDENT", sort, page, pageSize: 15 } }).then((r) => setData(r.data)).catch((e) => setError(errMsg(e))), [sort, page]);
  useEffect(() => { load(); }, [load]);
  async function approve(b, scope) { setError(""); try { const r = await api.post(`/bookings/${b.id}/decision`, { decision: "APPROVE", scope }); setMsg(r.data.series ? `Series processed: ${r.data.results.filter((x) => !x.error).length} approved, ${r.data.results.filter((x) => x.error).length} could not be approved.` : "Request approved. The student was notified."); load(); } catch (e) { setError(errMsg(e)); } }
  return (
    <div>
      <div className="page-header"><div><h1>Student booking requests</h1><p>Pending requests reserve the venue until you decide or they expire. Category priority is shown to help you decide.</p></div></div>
      <div className="filter-bar"><button className={`chip ${sort === "priority" ? "active" : ""}`} onClick={() => setSort("priority")}>Sort by priority</button><button className={`chip ${sort === "date" ? "active" : ""}`} onClick={() => setSort("date")}>Sort by date</button></div>
      {msg && <div className="alert alert-success">{msg}</div>}{error && <div className="alert alert-error">{error}</div>}
      <div className="card">
        {data.items.length === 0 ? <p className="empty-state">No pending student requests.</p> : (
          <div className="table-scroll"><table><thead><tr><th>Student</th><th>Venue</th><th>When</th><th>Participants</th><th>Category / priority</th><th>Purpose &amp; justification</th><th>Expires</th><th></th></tr></thead><tbody>
            {data.items.map((b) => (<tr key={b.id}>
              <td>{b.owner?.name}<div className="hint-text">{b.owner?.email}</div></td><td>{b.venue.name}<div className="hint-text">{b.venue.building}</div></td>
              <td>{fmtDate(b.date)}<div className="hint-text">{fmt12(b.startTime)} – {fmt12(b.endTime)}</div></td><td>{b.participants}</td>
              <td>{b.category?.name || "—"}{b.category && <div className="hint-text">Priority {b.category.priorityLevel}</div>}</td>
              <td style={{ maxWidth: 280 }}>{b.purpose}<div className="hint-text">{b.justification}</div>{b.seriesId && <span className="badge badge-info">Recurring series</span>}</td>
              <td>{fmtDateTime(b.expiresAt)}</td>
              <td><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><button className="btn btn-success btn-sm" onClick={() => approve(b)}>Approve</button>{b.seriesId && <button className="btn btn-outline btn-sm" onClick={() => approve(b, "series")}>Approve series</button>}<button className="btn btn-danger btn-sm" onClick={() => setReject(b)}>Reject</button><button className="btn btn-outline btn-sm" onClick={() => setOpen(b.id)}>Details</button></div></td></tr>))}
          </tbody></table></div>)}
        <Pagination page={page} pageSize={data.pageSize || 15} total={data.total} onPage={setPage} />
      </div>
      {reject && <ConfirmDialog title="Reject booking request" danger askReason reasonLabel="Rejection reason (sent to the student)" confirmLabel="Reject" onClose={() => setReject(null)} onConfirm={async (reason) => { await api.post(`/bookings/${reject.id}/decision`, { decision: "REJECT", reason, scope: reject.seriesId ? "series" : undefined }); setMsg("Request rejected and the reservation released."); load(); }} />}
      {open && <BookingDetails id={open} user={user} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  );
}
