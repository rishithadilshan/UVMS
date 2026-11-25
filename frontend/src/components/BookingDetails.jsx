import { useCallback, useEffect, useState } from "react";
import Modal, { ConfirmDialog } from "./Modal";
import StatusBadge from "./StatusBadge";
import FacilitySelect from "./FacilitySelect";
import api from "../api/client";
import { errMsg, fmt12, fmtDate, fmtDateTime, todayStr } from "../lib/format";

const ACTION_LABEL = { CREATED: "Created", APPROVED: "Approved by administrator", REJECTED: "Rejected", CANCELLED: "Cancelled", EXPIRED: "Expired", MODIFIED: "Modified", ADMIN_RESCHEDULED: "Re-scheduled by administrator", RELOCATED: "Moved after a venue change request", MODIFICATION_REQUESTED: "Modification requested", CANCELLATION_REQUESTED: "Cancellation requested", MAINTENANCE_CONFLICT: "Affected by venue maintenance", CHANGE_REQUESTED: "Venue change requested by another user", CHECKED_IN: "Checked in", CREATED_FROM_VENUE_CHANGE: "Created from a venue change request", MODIFY_APPROVED: "Modification approved", MODIFY_REJECTED: "Modification rejected", CANCEL_APPROVED: "Cancellation approved", CANCEL_REJECTED: "Cancellation rejected" };

/** Full booking details with history and the actions the viewer is allowed to take. Works for owners and admins. */
export default function BookingDetails({ id, user, venues = [], facilityOptions = [], onClose, onChanged }) {
  const [b, setB] = useState(null);
  const [error, setError] = useState(""); const [msg, setMsg] = useState("");
  const [mode, setMode] = useState(null); // cancel | modify | reschedule
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const admin = user.role === "ADMIN";

  const load = useCallback(() => api.get(`/bookings/${id}`).then((r) => { setB(r.data); setError(""); }).catch((e) => setError(errMsg(e))), [id]);
  useEffect(() => { load(); }, [load]);

  async function run(fn, success) {
    setBusy(true); setError(""); setMsg("");
    try { const r = await fn(); setMsg(r?.data?.message || success); setMode(null); await load(); onChanged?.(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }
  const startModify = () => { setForm({ date: b.date, startTime: b.startTime, endTime: b.endTime, participants: b.participants, facilities: b.requiredFacilities, purpose: b.purpose, reason: "" }); setMode("modify"); };
  const startResched = () => { setForm({ venueId: b.venue.id, date: b.date, startTime: b.startTime, endTime: b.endTime, reason: "" }); setMode("reschedule"); };
  const set = (k, v) => setForm((x) => ({ ...x, [k]: v }));

  if (!b) return <Modal title="Booking details" onClose={onClose}>{error ? <p className="error-text">{error}</p> : <p className="empty-state">Loading…</p>}</Modal>;
  const isOwner = b.owner?.id === user.id;
  const student = user.role === "STUDENT";
  const pendingMod = b.modificationRequests?.find((m) => m.status === "PENDING");
  const checkinUrl = b.checkinToken ? `${window.location.origin}/check-in?token=${b.checkinToken}` : null;

  return (
    <Modal title="Booking details" onClose={onClose} wide>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}
      {b.status === "PENDING" && <div className="alert alert-warning">Waiting for administrator approval. The venue is reserved{b.expiresAt ? ` until ${fmtDateTime(b.expiresAt)}` : ""}.</div>}
      {pendingMod && <div className="alert alert-info">A {pendingMod.kind === "CANCEL" ? "cancellation" : "modification"} request is waiting for administrator approval; the booking stays as is until then.</div>}
      <dl className="kv">
        <dt>Status</dt><dd><StatusBadge status={b.status} /></dd>
        <dt>Venue</dt><dd>{b.venue.name} — {b.venue.building} ({b.venue.type}, capacity {b.venue.capacity})</dd>
        <dt>Date</dt><dd>{fmtDate(b.date)}</dd>
        <dt>Time</dt><dd>{fmt12(b.startTime)} – {fmt12(b.endTime)}</dd>
        <dt>Purpose</dt><dd>{b.purpose}</dd>
        <dt>Category</dt><dd>{b.category ? `${b.category.name} (priority ${b.category.priorityLevel})` : "—"}</dd>
        <dt>Participants</dt><dd>{b.participants}</dd>
        <dt>Facilities</dt><dd>{b.requiredFacilities?.length ? b.requiredFacilities.join(", ") : "—"}</dd>
        {admin && <><dt>Booked by</dt><dd>{b.owner?.name} ({b.owner?.email})</dd></>}
        {b.justification && <><dt>Justification</dt><dd>{b.justification}</dd></>}
        {b.rejectionReason && <><dt>Rejection reason</dt><dd>{b.rejectionReason}</dd></>}
        {b.cancelReason && <><dt>Cancellation reason</dt><dd>{b.cancelReason}</dd></>}
        <dt>Created</dt><dd>{fmtDateTime(b.createdAt)}</dd>
        {b.reminder && <><dt>Reminder</dt><dd>{b.reminder.status}{b.reminder.sentAt ? ` — sent ${fmtDateTime(b.reminder.sentAt)}` : ` — due ${fmtDateTime(b.reminder.remindAt)}`}</dd></>}
        {b.checkedIn && <><dt>Check-in</dt><dd>Checked in</dd></>}
      </dl>

      {checkinUrl && (isOwner || admin) && !b.ended && (
        <div className="card" style={{ marginTop: 14, background: "var(--surface-2)" }}>
          <h4>Venue check-in</h4>
          <p className="hint-text">Check-in opens 15 minutes before the start. Share this link or encode it as a QR code at the venue:</p>
          <code style={{ wordBreak: "break-all", fontSize: ".78rem" }}>{checkinUrl}</code>
          {b.permissions.canCheckIn && <div className="form-actions"><button className="btn btn-success btn-sm" disabled={busy} onClick={() => run(() => api.post(`/bookings/${id}/check-in`), "Checked in")}>Check in now</button></div>}
        </div>
      )}

      {!mode && (
        <div className="form-actions no-print">
          {b.permissions.canModify && isOwner && <button className="btn btn-outline" onClick={startModify}>Modify booking</button>}
          {b.permissions.canModify && admin && <button className="btn btn-outline" onClick={startResched}>Re-schedule / move</button>}
          {b.permissions.canCancel && (isOwner || admin) && <button className="btn btn-danger" onClick={() => setMode("cancel")}>{student && b.status === "CONFIRMED" ? "Request cancellation" : "Cancel booking"}</button>}
        </div>
      )}

      {mode === "cancel" && (
        <ConfirmDialog title={student && b.status === "CONFIRMED" ? "Request cancellation" : "Cancel booking"} danger askReason reasonLabel="Reason for cancelling" confirmLabel={student && b.status === "CONFIRMED" ? "Send request" : "Cancel booking"}
          message={b.seriesId ? "This booking belongs to a recurring series. Only this occurrence is cancelled." : undefined}
          onConfirm={(reason) => run(() => api.post(`/bookings/${id}/cancel`, { reason }), "Done")} onClose={() => setMode(null)} />
      )}

      {mode === "modify" && (
        <div className="card" style={{ marginTop: 14 }}>
          <h4>Modify booking</h4>
          {student && b.status === "CONFIRMED" && <p className="hint-text">Changes to date, time, participants or facilities need administrator approval. Your current booking stays unchanged until then.</p>}
          <div className="form-row">
            <div><label>Date</label><input type="date" min={todayStr()} value={form.date} onChange={(e) => set("date", e.target.value)} /></div>
            <div><label>Start</label><input type="time" step="300" value={form.startTime} onChange={(e) => set("startTime", e.target.value)} /></div>
            <div><label>End</label><input type="time" step="300" value={form.endTime} onChange={(e) => set("endTime", e.target.value)} /></div>
            <div><label>Participants</label><input type="number" min="1" max={b.venue.capacity} value={form.participants} onChange={(e) => set("participants", e.target.value)} /></div>
          </div>
          <label>Required facilities</label><FacilitySelect options={facilityOptions.length ? facilityOptions : form.facilities} value={form.facilities} onChange={(v) => set("facilities", v)} allowOther={false} />
          <label>Purpose</label><input value={form.purpose} onChange={(e) => set("purpose", e.target.value)} />
          <label>Reason for the change</label><input value={form.reason} onChange={(e) => set("reason", e.target.value)} />
          <div className="form-actions"><button className="btn btn-primary" disabled={busy} onClick={() => run(() => api.post(`/bookings/${id}/modify`, { ...form, participants: Number(form.participants) }), "Saved")}>Save changes</button><button className="btn btn-outline" onClick={() => setMode(null)}>Cancel</button></div>
        </div>
      )}

      {mode === "reschedule" && (
        <div className="card" style={{ marginTop: 14 }}>
          <h4>Re-schedule or move (administrator)</h4>
          <div className="form-row">
            <div><label>Venue</label><select value={form.venueId} onChange={(e) => set("venueId", e.target.value)}>{venues.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.capacity})</option>)}</select></div>
            <div><label>Date</label><input type="date" min={todayStr()} value={form.date} onChange={(e) => set("date", e.target.value)} /></div>
            <div><label>Start</label><input type="time" step="300" value={form.startTime} onChange={(e) => set("startTime", e.target.value)} /></div>
            <div><label>End</label><input type="time" step="300" value={form.endTime} onChange={(e) => set("endTime", e.target.value)} /></div>
          </div>
          <label>Reason (sent to the booking owner)</label><input value={form.reason} onChange={(e) => set("reason", e.target.value)} />
          <div className="form-actions"><button className="btn btn-primary" disabled={busy || !form.reason?.trim()} onClick={() => run(() => api.patch(`/bookings/${id}/admin-update`, form), "Updated")}>Apply</button><button className="btn btn-outline" onClick={() => setMode(null)}>Cancel</button></div>
        </div>
      )}

      <h4 style={{ marginTop: 18 }}>History</h4>
      <ul className="timeline">
        {b.history.map((h) => (<li key={h.id}><strong>{ACTION_LABEL[h.action] || h.action}</strong>{h.actorName ? ` — ${h.actorName}` : ""}<br /><small>{fmtDateTime(h.createdAt)}{h.details?.reason ? ` · ${h.details.reason}` : ""}</small></li>))}
      </ul>
    </Modal>
  );
}
