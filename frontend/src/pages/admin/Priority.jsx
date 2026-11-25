import { useCallback, useEffect, useState } from "react";
import api from "../../api/client";
import Modal from "../../components/Modal";
import { errMsg, fmt12, fmtDate } from "../../lib/format";

const CMP = { REQUESTER_HIGHER: "Requester's category has HIGHER priority", REQUESTER_LOWER: "Requester's category has LOWER priority", EQUAL: "Equal priority", UNKNOWN: "Priority unknown" };

function CategoryForm({ cat, onClose, onSaved }) {
  const [f, setF] = useState(cat || { name: "", description: "", priorityLevel: 4, active: true });
  const [error, setError] = useState("");
  async function save(e) {
    e.preventDefault(); setError("");
    try { const body = { name: f.name, description: f.description, priorityLevel: Number(f.priorityLevel), active: f.active }; if (cat) await api.put(`/categories/${cat.id}`, body); else await api.post("/categories", body); onSaved(); onClose(); } catch (err) { setError(errMsg(err)); }
  }
  return (
    <Modal title={cat ? "Edit category" : "Add category"} onClose={onClose}>
      <form onSubmit={save}>
        <label>Name</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
        <label>Description</label><textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <label>Priority level (1 = highest, 10 = lowest)</label><input type="number" min="1" max="10" value={f.priorityLevel} onChange={(e) => setF({ ...f, priorityLevel: e.target.value })} required />
        <label className="check-inline"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active (selectable when booking)</label>
        {error && <p className="error-text">{error}</p>}
        <div className="form-actions"><button className="btn btn-primary">Save</button><button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button></div>
      </form>
    </Modal>
  );
}

function Ruling({ c, onClose, onSaved }) {
  const [ruling, setRuling] = useState("NEEDS_DISCUSSION"); const [note, setNote] = useState(""); const [error, setError] = useState("");
  async function save() { try { await api.post(`/priority/conflicts/${c.id}/decision`, { ruling, note }); onSaved(); onClose(); } catch (e) { setError(errMsg(e)); } }
  return (
    <Modal title="Record administrative decision" onClose={onClose}>
      <p className="hint-text">This is recorded in the audit log and sent to both users. It never cancels or overwrites the confirmed booking — the normal venue-change process still applies.</p>
      <label>Decision</label>
      <select value={ruling} onChange={(e) => setRuling(e.target.value)}><option value="SUPPORT_REQUEST">Support the request</option><option value="SUPPORT_CURRENT">Keep the current booking</option><option value="NEEDS_DISCUSSION">Ask both parties to coordinate</option></select>
      <label>Reason (visible to both users)</label><textarea value={note} onChange={(e) => setNote(e.target.value)} />
      {error && <p className="error-text">{error}</p>}
      <div className="form-actions"><button className="btn btn-primary" onClick={save}>Record decision</button><button className="btn btn-outline" onClick={onClose}>Cancel</button></div>
    </Modal>
  );
}

export default function Priority() {
  const [cats, setCats] = useState([]); const [conflicts, setConflicts] = useState([]);
  const [edit, setEdit] = useState(null); const [rule, setRule] = useState(null); const [msg, setMsg] = useState("");
  const load = useCallback(() => { api.get("/categories", { params: { all: true } }).then((r) => setCats(r.data)); api.get("/priority/conflicts").then((r) => setConflicts(r.data)); }, []);
  useEffect(() => { load(); }, [load]);
  async function toggle(c) { await api.put(`/categories/${c.id}`, { active: !c.active }); load(); }
  return (
    <div>
      <div className="page-header"><div><h1>Booking priority management</h1><p>Categories and priority levels are stored in the database and used whenever requests compete.</p></div><button className="btn btn-primary" onClick={() => setEdit({})}>+ Add category</button></div>
      {msg && <div className="alert alert-success">{msg}</div>}
      <div className="card"><h3>Booking categories</h3>
        <div className="table-scroll"><table><thead><tr><th>Priority</th><th>Category</th><th>Description</th><th>Bookings</th><th>Active</th><th></th></tr></thead><tbody>
          {cats.map((c) => (<tr key={c.id}><td><strong>{c.priorityLevel}</strong> <span className="hint-text">{c.priorityLabel}</span></td><td>{c.name}</td><td style={{ maxWidth: 320 }}>{c.description}</td><td>{c.bookingCount}</td><td>{c.active ? <span className="badge badge-approved">Active</span> : <span className="badge badge-cancelled">Inactive</span>}</td>
            <td><div style={{ display: "flex", gap: 6 }}><button className="btn btn-outline btn-sm" onClick={() => setEdit(c)}>Edit</button><button className="btn btn-outline btn-sm" onClick={() => toggle(c)}>{c.active ? "Deactivate" : "Activate"}</button></div></td></tr>))}
        </tbody></table></div>
      </div>
      <div className="card"><h3>Competing requests</h3>
        <p className="hint-text">Pending venue-change requests: the requester's category priority compared with the existing booking's. Priority informs your decision; it never overrides a confirmed booking automatically.</p>
        {conflicts.length === 0 ? <p className="empty-state">No competing requests right now.</p> : conflicts.map((c) => (
          <div key={c.id} className="card" style={{ background: "var(--surface-2)" }}>
            <div className="grid-2">
              <div><h4>Requester</h4><p>{c.requesterName} ({c.requesterRole.toLowerCase()})<br />{c.requestedCategory || "—"} · priority <strong>{c.requestedPriority ?? "—"}</strong><br />{c.requestedPurpose} · {c.requestedParticipants} participants</p></div>
              <div><h4>Existing booking</h4><p>{c.ownerName || "—"} ({(c.ownerRole || "").toLowerCase()})<br />{c.currentCategory || "—"} · priority <strong>{c.currentPriority ?? "—"}</strong><br />{c.currentPurpose} · {c.currentParticipants} participants · {fmt12(c.currentStart)} – {fmt12(c.currentEnd)}</p></div>
            </div>
            <p>{c.venueName} on {fmtDate(c.date)}, {fmt12(c.startTime)} – {fmt12(c.endTime)} · <span className="badge badge-info">{CMP[c.comparison]}</span></p>
            {c.adminRuling && <div className="alert alert-info">Decision recorded: {c.adminRuling.replace(/_/g, " ").toLowerCase()} — {c.adminNote}</div>}
            <button className="btn btn-primary btn-sm" onClick={() => setRule(c)}>Record decision</button>
          </div>))}
      </div>
      {edit && <CategoryForm cat={edit.id ? edit : null} onClose={() => setEdit(null)} onSaved={() => { setMsg("Category saved."); load(); }} />}
      {rule && <Ruling c={rule} onClose={() => setRule(null)} onSaved={() => { setMsg("Decision recorded and both users notified."); load(); }} />}
    </div>
  );
}
