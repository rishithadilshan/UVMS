import { useCallback, useEffect, useState } from "react";
import api from "../../api/client";
import { ConfirmDialog } from "../../components/Modal";
import Pagination from "../../components/Pagination";
import StatusBadge from "../../components/StatusBadge";
import { errMsg, fmtDateTime, ROLE_LABEL } from "../../lib/format";

export default function Registrations() {
  const [status, setStatus] = useState("PENDING");
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, pageSize: 20 });
  const [reject, setReject] = useState(null); const [msg, setMsg] = useState(""); const [error, setError] = useState("");
  const load = useCallback(() => api.get("/users/registrations", { params: { status, page } }).then((r) => setData(r.data)).catch((e) => setError(errMsg(e))), [status, page]);
  useEffect(() => { load(); }, [load]);
  async function approve(u) { setError(""); try { await api.post(`/users/registrations/${u.id}/approve`); setMsg(`${u.name} was approved and notified.`); load(); } catch (e) { setError(errMsg(e)); } }
  return (
    <div>
      <div className="page-header"><div><h1>Registration requests</h1><p>Review new accounts. Only approved accounts can sign in.</p></div></div>
      <div className="filter-bar">{["PENDING", "APPROVED", "REJECTED"].map((s) => <button key={s} className={`chip ${status === s ? "active" : ""}`} onClick={() => { setStatus(s); setPage(1); }}>{s[0] + s.slice(1).toLowerCase()}</button>)}</div>
      {msg && <div className="alert alert-success">{msg}</div>}{error && <div className="alert alert-error">{error}</div>}
      <div className="card">
        {data.items.length === 0 ? <p className="empty-state">No {status.toLowerCase()} registrations.</p> : (
          <div className="table-scroll"><table className="responsive"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Registration no.</th><th>Registered</th><th>Status</th><th></th></tr></thead><tbody>
            {data.items.map((u) => (<tr key={u.id}><td data-label="Name">{u.name}</td><td data-label="Email">{u.email}</td><td data-label="Role">{ROLE_LABEL[u.role]}</td><td data-label="Reg. no.">{u.registration_number || "—"}</td><td data-label="Registered">{fmtDateTime(u.created_at)}</td>
              <td data-label="Status"><StatusBadge status={u.status} />{u.rejection_reason && <div className="hint-text">{u.rejection_reason}</div>}</td>
              <td>{u.status === "PENDING" && <span style={{ display: "flex", gap: 6 }}><button className="btn btn-success btn-sm" onClick={() => approve(u)}>Approve</button><button className="btn btn-danger btn-sm" onClick={() => setReject(u)}>Reject</button></span>}</td></tr>))}
          </tbody></table></div>)}
        <Pagination page={page} pageSize={data.pageSize || 20} total={data.total} onPage={setPage} />
      </div>
      {reject && <ConfirmDialog title={`Reject ${reject.name}`} danger askReason reasonLabel="Rejection reason (shown to the user)" confirmLabel="Reject registration" onClose={() => setReject(null)} onConfirm={async (reason) => { await api.post(`/users/registrations/${reject.id}/reject`, { reason }); setMsg(`${reject.name} was rejected and notified.`); load(); }} />}
    </div>
  );
}
