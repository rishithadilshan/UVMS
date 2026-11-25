import { useCallback, useEffect, useState } from "react";
import api from "../../api/client";
import Pagination from "../../components/Pagination";
import StatusBadge from "../../components/StatusBadge";
import { ConfirmDialog } from "../../components/Modal";
import { errMsg, fmt12, fmtDate, fmtLocal } from "../../lib/format";

const nowLocal = () => { const d = new Date(); const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).reduce((a, x) => ({ ...a, [x.type]: x.value }), {}); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; };

export default function Maintenance() {
  const [venues, setVenues] = useState([]);
  const [f, setF] = useState({ venueId: "", status: "UNDER_MAINTENANCE", reason: "", description: "", startsAt: nowLocal(), endsAt: "" });
  const [affected, setAffected] = useState(null);
  const [state, setState] = useState("active"); const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, pageSize: 20 });
  const [msg, setMsg] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [restore, setRestore] = useState(null);
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setAffected(null); };

  useEffect(() => { api.get("/venues").then((r) => setVenues(r.data)); }, []);
  const load = useCallback(() => api.get("/maintenance", { params: { state: state === "all" ? undefined : state, page, pageSize: 20 } }).then((r) => setData(r.data)).catch((e) => setError(errMsg(e))), [state, page]);
  useEffect(() => { load(); }, [load]);

  async function submit(force = false) {
    setError(""); setMsg(""); setBusy(true);
    try {
      if (f.status === "AVAILABLE") { await api.post(`/maintenance/venue/${f.venueId}/restore`); setMsg("Venue restored to available."); }
      else {
        const r = await api.post("/maintenance", { ...f, force });
        setMsg(r.data.affected.length ? `Saved. ${r.data.affected.length} affected booking(s) were not cancelled; their owners and admins were notified. Use Booking Management to re-arrange them.` : "Maintenance period saved.");
      }
      setAffected(null); setF((x) => ({ ...x, reason: "", description: "", endsAt: "" })); load();
    } catch (e) {
      if (e?.response?.data?.code === "MAINTENANCE_CONFLICTS") setAffected(e.response.data.affected); else setError(errMsg(e));
    } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="page-header"><div><h1>Venue maintenance</h1><p>Block a venue for a date range, close it, or restore it. Existing bookings are never cancelled silently.</p></div></div>
      {msg && <div className="alert alert-success">{msg}</div>}{error && <div className="alert alert-error">{error}</div>}
      <div className="card">
        <h3>Change venue status</h3>
        <div className="form-row">
          <div><label>Venue</label><select value={f.venueId} onChange={(e) => set("venueId", e.target.value)}><option value="">Select…</option>{venues.map((v) => <option key={v.id} value={v.id}>{v.name} — {v.status.replace(/_/g, " ").toLowerCase()}</option>)}</select></div>
          <div><label>New status</label><select value={f.status} onChange={(e) => set("status", e.target.value)}><option value="AVAILABLE">Available (restore)</option><option value="UNDER_MAINTENANCE">Under maintenance</option><option value="TEMPORARILY_CLOSED">Temporarily closed</option><option value="UNAVAILABLE">Unavailable</option></select></div>
        </div>
        {f.status !== "AVAILABLE" && (<>
          <div className="form-row">
            <div><label>Reason</label><input value={f.reason} onChange={(e) => set("reason", e.target.value)} placeholder="e.g. Air-conditioning repair" /></div>
            <div><label>Starts</label><input type="datetime-local" value={f.startsAt} onChange={(e) => set("startsAt", e.target.value)} /></div>
            <div><label>Expected reopening (optional)</label><input type="datetime-local" min={f.startsAt} value={f.endsAt} onChange={(e) => set("endsAt", e.target.value)} /></div>
          </div>
          <label>Description</label><textarea value={f.description} onChange={(e) => set("description", e.target.value)} />
        </>)}
        {affected && (
          <div className="alert alert-warning"><strong>{affected.length} existing booking(s) fall inside this period.</strong> They will not be cancelled. Owners and admins are notified so alternatives can be arranged.
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{affected.map((b) => <li key={b.id}>{fmtDate(b.date)} {fmt12(b.start_time)}–{fmt12(b.end_time)} · {b.owner_name || "unknown"} · {b.purpose} ({b.status.toLowerCase()})</li>)}</ul>
            <div className="form-actions"><button className="btn btn-primary btn-sm" onClick={() => submit(true)} disabled={busy}>Save anyway and notify owners</button><button className="btn btn-outline btn-sm" onClick={() => setAffected(null)}>Review dates</button></div>
          </div>)}
        {!affected && <div className="form-actions"><button className="btn btn-primary" disabled={busy || !f.venueId || (f.status !== "AVAILABLE" && !f.reason.trim())} onClick={() => submit(false)}>{f.status === "AVAILABLE" ? "Restore venue" : "Save maintenance period"}</button></div>}
      </div>

      <div className="filter-bar">{[["active", "Active now"], ["upcoming", "Upcoming"], ["past", "History"], ["all", "All"]].map(([k, l]) => <button key={k} className={`chip ${state === k ? "active" : ""}`} onClick={() => { setState(k); setPage(1); }}>{l}</button>)}</div>
      <div className="card">
        {data.items.length === 0 ? <p className="empty-state">No maintenance records.</p> : (
          <div className="table-scroll"><table><thead><tr><th>Venue</th><th>Status</th><th>Reason</th><th>From</th><th>Expected reopening</th><th>Open conflicts</th><th></th></tr></thead><tbody>
            {data.items.map((m) => (<tr key={m.id}><td>{m.venueName}<div className="hint-text">{m.building}</div></td><td><StatusBadge status={m.status} />{m.restoredAt && <div className="hint-text">restored</div>}</td><td>{m.reason}<div className="hint-text">{m.description}</div></td><td>{fmtLocal(m.startsAt)}</td><td>{m.endsAt ? fmtLocal(m.endsAt) : "Until restored"}</td><td>{m.openConflicts || "—"}</td>
              <td>{!m.restoredAt && <button className="btn btn-outline btn-sm" onClick={() => setRestore(m)}>Close record</button>}</td></tr>))}
          </tbody></table></div>)}
        <Pagination page={page} pageSize={20} total={data.total} onPage={setPage} />
      </div>
      {restore && <ConfirmDialog title="Close maintenance record" message={`Reopen ${restore.venueName} now? Waitlisted users are notified.`} confirmLabel="Close record" onClose={() => setRestore(null)} onConfirm={async () => { await api.post(`/maintenance/${restore.id}/restore`); setMsg("Record closed."); load(); }} />}
    </div>
  );
}
