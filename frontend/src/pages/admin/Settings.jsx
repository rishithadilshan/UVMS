import { useCallback, useEffect, useState } from "react";
import api from "../../api/client";
import Pagination from "../../components/Pagination";
import StatusBadge from "../../components/StatusBadge";
import { errMsg, fmtDateTime } from "../../lib/format";

export default function Settings() {
  const [tab, setTab] = useState("general");
  const [s, setS] = useState(null); const [facs, setFacs] = useState([]); const [newFac, setNewFac] = useState("");
  const [rem, setRem] = useState({ items: [], total: 0 }); const [page, setPage] = useState(1); const [mails, setMails] = useState([]);
  const [msg, setMsg] = useState(""); const [error, setError] = useState("");
  const loadFacs = () => api.get("/venues/meta").then((r) => setFacs(r.data.facilityRecords));
  useEffect(() => { api.get("/admin/settings").then((r) => setS(r.data)); loadFacs(); }, []);
  const loadRem = useCallback(() => api.get("/admin/reminders", { params: { page, pageSize: 20 } }).then((r) => setRem(r.data)), [page]);
  useEffect(() => { if (tab === "reminders") loadRem(); if (tab === "emails") api.get("/admin/emails").then((r) => setMails(r.data)); }, [tab, loadRem]);

  async function save(e) {
    e.preventDefault(); setError(""); setMsg("");
    try { await api.put("/admin/settings", { pending_expiry_hours: Number(s.pending_expiry_hours), reminder_lead_hours: Number(s.reminder_lead_hours), max_booking_hours: Number(s.max_booking_hours), operating_hours: s.operating_hours }); setMsg("Settings saved."); } catch (err) { setError(errMsg(err)); }
  }
  async function addFac(e) { e.preventDefault(); try { await api.post("/venues/facilities", { name: newFac }); setNewFac(""); loadFacs(); } catch (err) { setError(errMsg(err)); } }

  return (
    <div>
      <div className="page-header"><div><h1>Settings</h1><p>Booking rules, facilities catalogue and monitoring.</p></div></div>
      <div className="tabs">{[["general", "Booking rules"], ["facilities", "Facilities"], ["reminders", "Reminder delivery"], ["emails", "Email log"]].map(([k, l]) => <button key={k} className={`tab ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>{l}</button>)}</div>
      {msg && <div className="alert alert-success">{msg}</div>}{error && <div className="alert alert-error">{error}</div>}
      {tab === "general" && s && (
        <form className="card" onSubmit={save}>
          <div className="form-row">
            <div><label>Pending student request expiry (hours)</label><input type="number" min="1" max="720" value={s.pending_expiry_hours} onChange={(e) => setS({ ...s, pending_expiry_hours: e.target.value })} /></div>
            <div><label>Reminder lead time (hours before start)</label><input type="number" min="1" max="168" value={s.reminder_lead_hours} onChange={(e) => setS({ ...s, reminder_lead_hours: e.target.value })} /></div>
            <div><label>Longest single booking (hours)</label><input type="number" min="1" max="24" value={s.max_booking_hours} onChange={(e) => setS({ ...s, max_booking_hours: e.target.value })} /></div>
          </div>
          <div className="form-row">
            <div><label>Operating hours start (utilization reports)</label><input type="time" value={s.operating_hours.start} onChange={(e) => setS({ ...s, operating_hours: { ...s.operating_hours, start: e.target.value } })} /></div>
            <div><label>Operating hours end</label><input type="time" value={s.operating_hours.end} onChange={(e) => setS({ ...s, operating_hours: { ...s.operating_hours, end: e.target.value } })} /></div>
          </div>
          <p className="hint-text">Time zone: Asia/Colombo. The expiry applies to new requests; existing pending requests keep their deadline.</p>
          <div className="form-actions"><button className="btn btn-primary">Save settings</button></div>
        </form>)}
      {tab === "facilities" && (
        <div className="card">
          <form className="form-row" onSubmit={addFac}><div><label>New facility</label><input value={newFac} onChange={(e) => setNewFac(e.target.value)} required /></div><div><button className="btn btn-primary">Add</button></div></form>
          <div className="table-scroll" style={{ marginTop: 12 }}><table><tbody>{facs.map((f) => <tr key={f.id}><td>{f.name}</td><td>{f.active ? "Active" : "Hidden"}</td><td><button className="btn btn-outline btn-sm" onClick={async () => { await api.patch(`/venues/facilities/${f.id}`, { active: !f.active }); loadFacs(); }}>{f.active ? "Hide from lists" : "Show"}</button></td></tr>)}</tbody></table></div>
        </div>)}
      {tab === "reminders" && (
        <div className="card">
          <div className="table-scroll"><table><thead><tr><th>User</th><th>Venue</th><th>Booking starts</th><th>Reminder due</th><th>Status</th><th>Sent</th></tr></thead><tbody>
            {rem.items.map((r) => <tr key={r.id}><td>{r.userName}</td><td>{r.venueName}</td><td>{r.startsAt}</td><td>{fmtDateTime(r.remindAt)}{r.shortNotice ? " (short notice)" : ""}</td><td><StatusBadge status={r.status} />{r.lastError && <div className="hint-text">{r.lastError}</div>}</td><td>{r.sentAt ? fmtDateTime(r.sentAt) : "—"}</td></tr>)}
          </tbody></table></div>
          {rem.items.length === 0 && <p className="empty-state">No reminder records yet.</p>}
          <Pagination page={page} pageSize={20} total={rem.total} onPage={setPage} />
        </div>)}
      {tab === "emails" && (
        <div className="card"><p className="hint-text">Registration decision emails. Status LOGGED means SMTP is not configured (see backend .env).</p>
          <div className="table-scroll"><table><tbody>{mails.map((m) => <tr key={m.id}><td>{fmtDateTime(m.createdAt)}</td><td>{m.to}</td><td>{m.subject}</td><td>{m.status}{m.error ? ` – ${m.error}` : ""}</td></tr>)}</tbody></table></div>{mails.length === 0 && <p className="empty-state">No emails recorded.</p>}</div>)}
    </div>
  );
}
