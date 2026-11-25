import { useState } from "react";
import Modal from "./Modal";
import api from "../api/client";
import { errMsg, fmtDate, fmt12, PURPOSES, todayStr } from "../lib/format";

/** "Request to Change Venue": asks the owner of an existing booking to move so the requester can use the venue. */
export default function ChangeRequestModal({ venue, booking, defaults, categories, onClose, onDone }) {
  const [f, setF] = useState({ date: defaults.date, startTime: defaults.startTime, endTime: defaults.endTime, participants: defaults.participants || "", categoryId: categories[0]?.id || "", purposeChoice: PURPOSES[0], purposeOther: "", reason: "", message: "" });
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [done, setDone] = useState("");
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  async function submit(e) {
    e.preventDefault(); setError("");
    const purpose = f.purposeChoice === "Other" ? f.purposeOther.trim() : f.purposeChoice;
    if (!purpose) return setError("Please describe the purpose");
    setBusy(true);
    try {
      const res = await api.post("/venue-changes", { targetBookingId: booking.bookingId, date: f.date, startTime: f.startTime, endTime: f.endTime, participants: Number(f.participants), categoryId: f.categoryId, purpose, facilities: defaults.facilities || [], reason: f.reason, message: f.message });
      setDone(res.data.message); onDone?.();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  if (done) return (<Modal title="Request sent" onClose={onClose}><div className="alert alert-success">{done}. The current booking owner has been notified and you will be told their decision.</div><div className="form-actions"><button className="btn btn-primary" onClick={onClose}>Done</button></div></Modal>);

  return (
    <Modal title="Request to Change Venue" onClose={onClose} wide>
      <form onSubmit={submit}>
        <div className="alert alert-info">{venue.name} is booked {fmt12(booking.startTime)} – {fmt12(booking.endTime)} on {fmtDate(booking.date)} by {booking.ownerName}. If the owner agrees, their booking is moved to an alternative and the venue becomes yours. Nothing changes unless they confirm a valid alternative.</div>
        <div className="form-row">
          <div><label>Requested venue</label><input value={`${venue.name} (${venue.building})`} readOnly /></div>
          <div><label>Booking date</label><input type="date" min={todayStr()} value={f.date} onChange={(e) => set("date", e.target.value)} required /></div>
          <div><label>Requested start time</label><input type="time" step="300" value={f.startTime} onChange={(e) => set("startTime", e.target.value)} required /></div>
          <div><label>Requested end time</label><input type="time" step="300" value={f.endTime} onChange={(e) => set("endTime", e.target.value)} required /></div>
        </div>
        <div className="form-row">
          <div><label>Expected participants</label><input type="number" min="1" max={venue.capacity} value={f.participants} onChange={(e) => set("participants", e.target.value)} required /></div>
          <div><label>Booking category</label><select value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)}>{categories.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.priorityLabel}</option>)}</select></div>
          <div><label>Purpose</label><select value={f.purposeChoice} onChange={(e) => set("purposeChoice", e.target.value)}>{PURPOSES.map((p) => <option key={p}>{p}</option>)}</select>
            {f.purposeChoice === "Other" && <input style={{ marginTop: 6 }} value={f.purposeOther} onChange={(e) => set("purposeOther", e.target.value)} placeholder="Describe the purpose" />}</div>
        </div>
        <label>Reason for the request</label>
        <textarea value={f.reason} onChange={(e) => set("reason", e.target.value)} required minLength={3} placeholder="Why do you need this specific venue at this time?" />
        <label>Additional message (optional)</label>
        <textarea value={f.message} onChange={(e) => set("message", e.target.value)} />
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="form-actions"><button className="btn btn-primary" disabled={busy}>{busy ? "Sending…" : "Send request"}</button><button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button></div>
      </form>
    </Modal>
  );
}
