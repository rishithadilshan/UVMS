import { useCallback, useEffect, useState } from "react";
import api from "../../api/client";
import Modal from "../../components/Modal";
import Pagination from "../../components/Pagination";
import StatusBadge from "../../components/StatusBadge";
import { useAuth } from "../../context/AuthContext";
import { errMsg, ROLE_LABEL } from "../../lib/format";
import { useDebounced } from "../../lib/useDebounced";

const ROLES = ["ADMIN", "LECTURER", "INSTRUCTOR", "STUDENT", "LAB_ASSISTANT"];

export default function Users() {
  const { user: me } = useAuth();
  const [f, setF] = useState({ q: "", role: "", status: "" }); const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, pageSize: 20 });
  const [form, setForm] = useState(null); const [error, setError] = useState(""); const [msg, setMsg] = useState("");
  const df = useDebounced(f, 300);
  const load = useCallback(() => api.get("/users", { params: { ...Object.fromEntries(Object.entries(df).filter(([, v]) => v)), page, pageSize: 20 } }).then((r) => setData(r.data)).catch((e) => setError(errMsg(e))), [df, page]);
  useEffect(() => { load(); }, [load]);
  const setFilter = (k, v) => { setF((x) => ({ ...x, [k]: v })); setPage(1); };

  async function create(e) {
    e.preventDefault(); setError("");
    try { await api.post("/users", form); setForm(null); setMsg("Account created and approved."); load(); } catch (err) { setError(errMsg(err)); }
  }
  async function update(u, body) { setError(""); try { await api.put(`/users/${u.id}`, body); load(); } catch (e) { setError(errMsg(e)); } }
  return (
    <div>
      <div className="page-header"><div><h1>User management</h1><p>All accounts. Public registration can never create an administrator; create one here.</p></div><button className="btn btn-primary" onClick={() => setForm({ name: "", email: "", password: "", role: "LECTURER", registrationNumber: "" })}>+ Create user</button></div>
      {msg && <div className="alert alert-success">{msg}</div>}{error && <div className="alert alert-error">{error}</div>}
      <div className="card"><div className="form-row">
        <div><label>Search</label><input placeholder="Name, email or registration no." value={f.q} onChange={(e) => setFilter("q", e.target.value)} /></div>
        <div><label>Role</label><select value={f.role} onChange={(e) => setFilter("role", e.target.value)}><option value="">All</option>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></div>
        <div><label>Status</label><select value={f.status} onChange={(e) => setFilter("status", e.target.value)}><option value="">All</option><option>PENDING</option><option>APPROVED</option><option>REJECTED</option></select></div>
      </div></div>
      <div className="card">
        <div className="table-scroll"><table className="responsive"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Reg. no.</th><th>Approval</th><th>Active</th><th></th></tr></thead><tbody>
          {data.items.map((u) => (<tr key={u.id}><td data-label="Name">{u.name}</td><td data-label="Email">{u.email}</td>
            <td data-label="Role"><select style={{ width: "auto" }} value={u.role} disabled={u.id === me.id} onChange={(e) => update(u, { role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></td>
            <td data-label="Reg. no.">{u.registration_number || "—"}</td><td data-label="Approval"><StatusBadge status={u.status} /></td><td data-label="Active">{u.active ? "Yes" : "No"}</td>
            <td>{u.id !== me.id && <button className="btn btn-outline btn-sm" onClick={() => update(u, { active: !u.active })}>{u.active ? "Deactivate" : "Reactivate"}</button>}</td></tr>))}
        </tbody></table></div>
        <Pagination page={page} pageSize={20} total={data.total} onPage={setPage} />
      </div>
      {form && (
        <Modal title="Create user" onClose={() => setForm(null)}>
          <form onSubmit={create}>
            <label>Full name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <label>Email</label><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            <label>Role</label><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
            {form.role === "STUDENT" && <><label>Registration number</label><input value={form.registrationNumber} onChange={(e) => setForm({ ...form, registrationNumber: e.target.value })} required /></>}
            <label>Temporary password (min 12 characters)</label><input type="password" minLength={12} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required autoComplete="new-password" />
            {error && <p className="error-text">{error}</p>}
            <div className="form-actions"><button className="btn btn-primary">Create</button><button type="button" className="btn btn-outline" onClick={() => setForm(null)}>Cancel</button></div>
          </form>
        </Modal>)}
    </div>
  );
}
