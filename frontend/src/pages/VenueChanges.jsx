import { useCallback, useEffect, useState } from "react";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import Modal from "../components/Modal";
import StatusBadge from "../components/StatusBadge";
import Pagination from "../components/Pagination";
import { errMsg, fmt12, fmtDate, fmtDateTime, todayStr } from "../lib/format";

function RespondModal({ req, onClose, onDone }) {
  const [mode, setMode] = useState("ACCEPT");
  const [message, setMessage] = useState("");
  const [alts, setAlts] = useState(null);
  const [alt, setAlt] = useState({ venueId: "", date: req.currentDate || todayStr(), startTime: req.currentStart || "09:00", endTime: req.currentEnd || "11:00" });
  const [check, setCheck] = useState(null);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const set = (k, v) => { setAlt((a) => ({ ...a, [k]: v })); setCheck(null); };

  const loadAlts = useCallback((a = alt) => api.get(`/venue-changes/${req.id}/alternatives`, { params: { date: a.date, startTime: a.startTime, endTime: a.endTime } }).then((r) => setAlts(r.data.alternatives)).catch((e) => setError(errMsg(e))), []); // eslint-disable-line
  useEffect(() => { loadAlts(); }, [loadAlts]);

  async function validate() {
    setError(""); setBusy(true);
    try { const r = await api.post(`/venue-changes/${req.id}/validate`, { alternative: alt }); setCheck(r.data); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }
  async function submit() {
    setError(""); setBusy(true);
    try {
      await api.post(`/venue-changes/${req.id}/respond`, mode === "REJECT" ? { decision: "REJECT", message } : { decision: "ACCEPT", message, alternative: alt });
      onDone();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title="Respond to venue change request" onClose={onClose} wide>
      <div className="alert alert-info"><strong>{req.requesterName}</strong> ({req.requesterRole.toLowerCase()}) wants <strong>{req.venueName}</strong> on {fmtDate(req.date)}, {fmt12(req.startTime)} – {fmt12(req.endTime)}.<br />Reason: {req.reason}{req.message ? ` — ${req.message}` : ""}</div>
      <p className="hint-text">Your current booking: {fmtDate(req.currentDate)}, {fmt12(req.currentStart)} – {fmt12(req.currentEnd)} ({req.currentCategory || "no category"}). It is only moved if you confirm a valid alternative below; otherwise it is not changed.</p>
      <div className="filter-bar"><button className={`chip ${mode === "ACCEPT" ? "active" : ""}`} onClick={() => setMode("ACCEPT")}>Agree and move my booking</button><button className={`chip ${mode === "REJECT" ? "active" : ""}`} onClick={() => setMode("REJECT")}>Reject</button></div>
      {mode === "ACCEPT" && (<>
        <h4>Proposed alternative</h4>
        <div className="form-row">
          <div><label>Date</label><input type="date" min={todayStr()} value={alt.date} onChange={(e) => set("date", e.target.value)} /></div>
          <div><label>Start</label><input type="time" step="300" value={alt.startTime} onChange={(e) => set("startTime", e.target.value)} /></div>
          <div><label>End</label><input type="time" step="300" value={alt.endTime} onChange={(e) => set("endTime", e.target.value)} /></div>
          <div><button className="btn btn-outline btn-sm" onClick={() => loadAlts(alt)}>Refresh suggestions</button></div>
        </div>
        <label>Venue</label>
        <select value={alt.venueId} onChange={(e) => set("venueId", e.target.value)}>
          <option value="">Choose a venue…</option>
          {alts?.map((a) => <option key={a.id} value={a.id}>{a.name} — {a.building}, capacity {a.capacity} (suggested)</option>)}
        </select>
        {alts && !alts.length && <p className="hint-text">No other venue is free at that time with your booking's capacity and facilities. Try another date or time.</p>}
        {alt.venueId && alts?.find((a) => a.id === alt.venueId) && <p className="hint-text">{alts.find((a) => a.id === alt.venueId).explanation}</p>}
        <div className="form-actions"><button className="btn btn-outline" onClick={validate} disabled={busy || !alt.venueId}>Check this alternative</button></div>
        {check && (check.ok ? <div className="alert alert-success">This alternative meets your booking's capacity and facilities and is available.</div> : <div className="alert alert-error"><ul style={{ margin: 0, paddingLeft: 18 }}>{check.reasons.map((r, i) => <li key={i}>{r.message}</li>)}</ul></div>)}
      </>)}
      <label>Message to {req.requesterName.split(" ")[0]} (optional)</label>
      <textarea value={message} onChange={(e) => setMessage(e.target.value)} />
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="form-actions">
        {mode === "ACCEPT" ? <button className="btn btn-success" onClick={submit} disabled={busy || !check?.ok}>Confirm relocation</button> : <button className="btn btn-danger" onClick={submit} disabled={busy}>Reject request</button>}
        <button className="btn btn-outline" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

export default function VenueChanges({ admin }) {
  const { user } = useAuth();
  const [box, setBox] = useState(admin ? "all" : "incoming");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, pageSize: 20 });
  const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [msg, setMsg] = useState("");
  const [respond, setRespond] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get("/venue-changes", { params: { box, status: status || undefined, page, pageSize: 20 } }).then((r) => { setData(r.data); setError(""); }).catch((e) => setError(errMsg(e))).finally(() => setLoading(false));
  }, [box, status, page]);
  useEffect(() => { load(); }, [load]);

  async function cancel(id) { try { await api.post(`/venue-changes/${id}/cancel`); setMsg("Request cancelled"); load(); } catch (e) { setError(errMsg(e)); } }
  const cmp = (r) => (r.requestedPriority && r.currentPriority ? (r.requestedPriority < r.currentPriority ? "higher than" : r.requestedPriority > r.currentPriority ? "lower than" : "equal to") : null);

  return (
    <div>
      <div className="page-header"><div><h1>Venue change requests</h1><p>{admin ? "Monitor every request. Requests for student bookings are decided here by an administrator." : "Requests from other users to use a venue you have booked, and requests you have sent."}</p></div></div>
      <div className="tabs">
        {admin ? (<><button className={`tab ${box === "all" ? "active" : ""}`} onClick={() => { setBox("all"); setPage(1); }}>All requests (monitor)</button><button className={`tab ${box === "incoming" ? "active" : ""}`} onClick={() => { setBox("incoming"); setPage(1); }}>Needs administrator decision</button></>) : (<><button className={`tab ${box === "incoming" ? "active" : ""}`} onClick={() => { setBox("incoming"); setPage(1); }}>Requests for my bookings</button><button className={`tab ${box === "outgoing" ? "active" : ""}`} onClick={() => { setBox("outgoing"); setPage(1); }}>My requests</button></>)}
      </div>
      <div className="filter-bar">{["", "PENDING", "APPROVED", "REJECTED", "CANCELLED"].map((s) => <button key={s} className={`chip ${status === s ? "active" : ""}`} onClick={() => { setStatus(s); setPage(1); }}>{s || "All"}</button>)}</div>
      {msg && <div className="alert alert-success">{msg}</div>}{error && <div className="alert alert-error">{error}</div>}
      {loading ? <div className="card empty-state">Loading…</div> : data.items.length === 0 ? <div className="card empty-state">No requests to show.</div> : data.items.map((r) => (
        <div className="card" key={r.id}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <h3 style={{ marginBottom: 4 }}>{r.venueName} — {fmtDate(r.date)}, {fmt12(r.startTime)} – {fmt12(r.endTime)}</h3>
              <div className="hint-text">Requested by {r.requesterName} ({r.requesterRole.toLowerCase()}) {fmtDateTime(r.createdAt)} · {r.participants} participants{r.requestedCategory ? ` · ${r.requestedCategory}` : ""}</div>
            </div>
            <StatusBadge status={r.status} />
          </div>
          <p style={{ marginTop: 8 }}><strong>Reason:</strong> {r.reason}{r.message ? <><br /><strong>Message:</strong> {r.message}</> : null}</p>
          {(admin || r.ownerId === user.id) && r.currentDate && <p className="hint-text">Existing booking{r.ownerName ? ` of ${r.ownerName}` : ""}: {fmtDate(r.currentDate)}, {fmt12(r.currentStart)} – {fmt12(r.currentEnd)} ({r.currentCategory || "no category"}{r.currentPriority ? `, priority ${r.currentPriority}` : ""}).{cmp(r) ? ` Requester's category priority is ${cmp(r)} the current booking's.` : ""}</p>}
          {r.handledByAdmin && <p className="hint-text">The current booking belongs to a student, so an administrator decides.</p>}
          {r.adminRuling && <div className="alert alert-info">Administrator: {r.adminRuling.replace(/_/g, " ").toLowerCase()} — {r.adminNote}</div>}
          {r.decisionMessage && <p><strong>Decision message:</strong> {r.decisionMessage}</p>}
          {r.status === "APPROVED" && r.alternativeVenueName && <p className="hint-text">Original booking moved to {r.alternativeVenueName}, {fmtDate(r.alternativeDate)}, {fmt12(r.alternativeStart)} – {fmt12(r.alternativeEnd)}.</p>}
          <div className="form-actions">
            {r.canRespond && <button className="btn btn-primary btn-sm" onClick={() => setRespond(r)}>Review and respond</button>}
            {r.canCancel && <button className="btn btn-outline btn-sm" onClick={() => cancel(r.id)}>Withdraw request</button>}
          </div>
        </div>
      ))}
      <Pagination page={page} pageSize={data.pageSize || 20} total={data.total} onPage={setPage} />
      {respond && <RespondModal req={respond} onClose={() => setRespond(null)} onDone={() => { setRespond(null); setMsg("Your decision was sent."); load(); }} />}
    </div>
  );
}
