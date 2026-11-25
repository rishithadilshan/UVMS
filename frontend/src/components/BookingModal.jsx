import { useEffect, useState } from "react";
import Modal from "./Modal";
import FacilitySelect from "./FacilitySelect";
import StatusBadge from "./StatusBadge";
import api from "../api/client";
import { errMsg, fmtDate, fmt12, PURPOSES, DOW_NAMES, todayStr } from "../lib/format";

/** Booking form used for single and recurring bookings. Lecturers/instructors confirm instantly; students send a request. */
export default function BookingModal({ venue, defaults, user, categories, ownerId, onClose, onDone }) {
  const student = user.role === "STUDENT" && !ownerId;
  const [f, setF] = useState({
    date: defaults.date, startTime: defaults.startTime, endTime: defaults.endTime, participants: defaults.participants || "",
    categoryId: categories[0]?.id || "", purposeChoice: PURPOSES[0], purposeOther: "", justification: "", facilities: defaults.facilities || [],
    recurring: false, frequency: "WEEKLY", endDate: "", days: [],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const cat = categories.find((c) => c.id === f.categoryId);

  useEffect(() => { if (f.recurring && !f.days.length && f.date) set("days", [new Date(`${f.date}T00:00:00Z`).getUTCDay()]); }, [f.recurring]); // eslint-disable-line

  async function submit(e) {
    e.preventDefault();
    setError("");
    const purpose = f.purposeChoice === "Other" ? f.purposeOther.trim() : f.purposeChoice;
    if (!purpose) return setError("Please describe the purpose of the booking");
    if (student && f.justification.trim().length < 10) return setError("Please provide the academic purpose and justification (at least 10 characters)");
    if (f.endTime <= f.startTime) return setError("End time must be later than start time");
    if (f.recurring && (!f.endDate || !f.days.length)) return setError("Choose the recurrence end date and at least one weekday");
    setBusy(true);
    try {
      const body = { venueId: venue.id, date: f.date, startTime: f.startTime, endTime: f.endTime, participants: Number(f.participants), categoryId: f.categoryId, purpose, justification: f.justification, facilities: f.facilities, ownerId };
      if (f.recurring) body.recurrence = { frequency: f.frequency, endDate: f.endDate, daysOfWeek: f.days };
      const res = await api.post("/bookings", body);
      setResult(res.data);
      onDone?.(res.data);
    } catch (err) {
      const d = err?.response?.data;
      setError(errMsg(err));
      if (d?.conflicts?.length) setResult({ failed: true, conflicts: d.conflicts, bookings: [] });
    } finally { setBusy(false); }
  }

  if (result && !result.failed) {
    const rec = result.bookings.length > 1 || result.conflicts?.length;
    return (
      <Modal title={student ? "Request submitted" : "Booking confirmed"} onClose={onClose}>
        <div className="alert alert-success">{result.message}</div>
        {rec ? (
          <>
            <h4>Occurrences ({result.bookings.length} of {result.requested} booked)</h4>
            <div className="table-scroll"><table><thead><tr><th>Date</th><th>Time</th><th>Result</th></tr></thead><tbody>
              {result.bookings.map((b) => (<tr key={b.id}><td>{fmtDate(b.date)}</td><td>{fmt12(b.startTime)} – {fmt12(b.endTime)}</td><td><StatusBadge status={b.status} /></td></tr>))}
              {result.conflicts.map((c) => (<tr key={c.date}><td>{fmtDate(c.date)}</td><td>{fmt12(f.startTime)} – {fmt12(f.endTime)}</td><td><span className="badge badge-rejected">CONFLICT</span> <span className="hint-text">{c.reasons[0]}</span></td></tr>))}
            </tbody></table></div>
          </>
        ) : (
          <dl className="kv"><dt>Venue</dt><dd>{venue.name} ({venue.building})</dd><dt>Date</dt><dd>{fmtDate(f.date)}</dd><dt>Time</dt><dd>{fmt12(f.startTime)} – {fmt12(f.endTime)}</dd><dt>Status</dt><dd><StatusBadge status={result.status} /></dd></dl>
        )}
        <div className="form-actions"><button className="btn btn-primary" onClick={onClose}>Done</button></div>
      </Modal>
    );
  }

  return (
    <Modal title={`${student ? "Request" : "Book"} ${venue.name}`} onClose={onClose} wide>
      <form onSubmit={submit}>
        <p className="hint-text">{venue.building} · capacity {venue.capacity} · {student ? "Student bookings are reserved immediately but need administrator approval." : "Your booking is confirmed immediately."}</p>
        <div className="form-row">
          <div><label>Booking date</label><input type="date" min={todayStr()} value={f.date} onChange={(e) => set("date", e.target.value)} required /></div>
          <div><label>Start time</label><input type="time" step="300" value={f.startTime} onChange={(e) => set("startTime", e.target.value)} required /></div>
          <div><label>End time</label><input type="time" step="300" value={f.endTime} onChange={(e) => set("endTime", e.target.value)} required /></div>
          <div><label>Expected participants</label><input type="number" min="1" max={venue.capacity} value={f.participants} onChange={(e) => set("participants", e.target.value)} required /></div>
        </div>
        <div className="form-row">
          <div>
            <label>Booking category</label>
            <select value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)} required>
              {categories.map((c) => (<option key={c.id} value={c.id}>{c.name} — {c.priorityLabel} priority</option>))}
            </select>
            {cat?.description && <span className="hint-text">{cat.description}</span>}
          </div>
          <div>
            <label>Booking purpose</label>
            <select value={f.purposeChoice} onChange={(e) => set("purposeChoice", e.target.value)}>{PURPOSES.map((p) => <option key={p}>{p}</option>)}</select>
            {f.purposeChoice === "Other" && <input style={{ marginTop: 6 }} placeholder="Describe the purpose" value={f.purposeOther} onChange={(e) => set("purposeOther", e.target.value)} maxLength={500} />}
          </div>
        </div>
        <label>Required facilities</label>
        <FacilitySelect options={venue.facilities || []} allowOther={false} value={f.facilities} onChange={(v) => set("facilities", v)} placeholder="Select the facilities you need" />
        {student && (<><label>Academic purpose and justification</label><textarea value={f.justification} onChange={(e) => set("justification", e.target.value)} placeholder="Why do you need this venue? Include the course, supervisor or event details." required /></>)}
        <label className="check-inline"><input type="checkbox" checked={f.recurring} onChange={(e) => set("recurring", e.target.checked)} /> Make this a recurring booking</label>
        {f.recurring && (
          <div className="card" style={{ background: "var(--surface-2)" }}>
            <div className="form-row">
              <div><label>Frequency</label><select value={f.frequency} onChange={(e) => set("frequency", e.target.value)}><option value="WEEKLY">Every week</option><option value="BIWEEKLY">Every two weeks</option></select></div>
              <div><label>Start date</label><input type="date" value={f.date} disabled /></div>
              <div><label>End date</label><input type="date" min={f.date} value={f.endDate} onChange={(e) => set("endDate", e.target.value)} required /></div>
            </div>
            <label>Days of the week</label>
            <div className="filter-bar">{DOW_NAMES.map((n, i) => (<button type="button" key={n} className={`chip ${f.days.includes(i) ? "active" : ""}`} onClick={() => set("days", f.days.includes(i) ? f.days.filter((d) => d !== i) : [...f.days, i])}>{n}</button>))}</div>
            <p className="hint-text">Every occurrence is checked separately; conflicting dates are skipped and listed after you submit.{student && " Student series need administrator approval."}</p>
          </div>
        )}
        {error && <p className="error-text" role="alert">{error}</p>}
        {result?.failed && (<ul className="hint-text">{result.conflicts.map((c) => <li key={c.date}>{fmtDate(c.date)}: {c.reasons[0]}</li>)}</ul>)}
        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Submitting…" : student ? "Submit booking request" : "Book Venue"}</button>
          <button className="btn btn-outline" type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}
