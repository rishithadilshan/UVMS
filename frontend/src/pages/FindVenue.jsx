import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import FacilitySelect from "../components/FacilitySelect";
import BookingModal from "../components/BookingModal";
import ChangeRequestModal from "../components/ChangeRequestModal";
import StatusBadge from "../components/StatusBadge";
import { errMsg, fmt12, fmtDate, todayStr } from "../lib/format";

export default function FindVenue() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [meta, setMeta] = useState({ buildings: [], types: [], facilities: [] });
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState({
    date: params.get("date") || todayStr(), startTime: params.get("startTime") || "09:00", endTime: params.get("endTime") || "11:00",
    participants: params.get("participants") || "", facilities: [], building: "", type: "",
  });
  const [results, setResults] = useState(null);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState("");
  const [booking, setBooking] = useState(null); const [change, setChange] = useState(null);
  const set = (k, v) => setForm((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    api.get("/venues/meta").then((r) => setMeta(r.data));
    api.get("/categories").then((r) => setCategories(r.data));
  }, []);

  async function search(e) {
    e?.preventDefault();
    setError(""); setNotice(""); setBusy(true);
    try {
      const res = await api.get("/venues/search", { params: { ...form, facilities: form.facilities.join(",") } });
      setResults(res.data);
    } catch (err) { setError(errMsg(err, "Could not search")); setResults(null); } finally { setBusy(false); }
  }
  useEffect(() => { if (params.get("date") && params.get("participants")) search(); }, []); // eslint-disable-line

  async function joinWaitlist(v) {
    try {
      const r = await api.post("/waitlist", { venueId: v.id, date: form.date, startTime: form.startTime, endTime: form.endTime, participants: Number(form.participants), facilities: form.facilities });
      setNotice(r.data.message);
    } catch (err) { setNotice(errMsg(err)); }
  }

  const criteria = results?.criteria;
  const defaults = { date: form.date, startTime: form.startTime, endTime: form.endTime, participants: form.participants, facilities: form.facilities };
  const unavailable = results ? [...results.booked, ...results.unavailable] : [];

  return (
    <div>
      <div className="page-header"><div><h1>Find a venue</h1><p>Search by date, time, size and facilities. Available venues are ranked for you.</p></div></div>
      <div className="card">
        <form onSubmit={search}>
          <div className="form-row">
            <div><label htmlFor="find-venue-booking-date">Booking date</label><input id="find-venue-booking-date" type="date" min={todayStr()} value={form.date} onChange={(e) => set("date", e.target.value)} required /></div>
            <div><label>Start time</label><input type="time" step="300" value={form.startTime} onChange={(e) => set("startTime", e.target.value)} required /></div>
            <div><label>End time</label><input type="time" step="300" value={form.endTime} onChange={(e) => set("endTime", e.target.value)} required /></div>
            <div><label>Expected participants</label><input type="number" min="1" value={form.participants} onChange={(e) => set("participants", e.target.value)} required /></div>
          </div>
          <div className="form-row find-venue-filters">
            <div><label>Required facilities</label><FacilitySelect options={meta.facilities} value={form.facilities} onChange={(v) => set("facilities", v)} /></div>
            <div><label>Preferred building (optional)</label><select value={form.building} onChange={(e) => set("building", e.target.value)}><option value="">Any building</option>{meta.buildings.map((b) => <option key={b}>{b}</option>)}</select></div>
            <div><label>Venue type (optional)</label><select value={form.type} onChange={(e) => set("type", e.target.value)}><option value="">Any type</option>{meta.types.map((t) => <option key={t}>{t}</option>)}</select></div>
          </div>
          {error && <p className="error-text" role="alert">{error}</p>}
          <div className="form-actions"><button className="btn btn-primary" disabled={busy}>{busy ? "Searching…" : "Search"}</button></div>
        </form>
      </div>
      {notice && <div className="alert alert-info">{notice}</div>}

      {results && (<>
        <div className="section-title"><h2 style={{ margin: 0 }}>Available venues</h2><span className="count">{results.available.length}</span></div>
        {results.available.length === 0 && <div className="card empty-state">No venue is free for the whole requested time with these requirements. See the booked venues below, or try different times.</div>}
        <div className="venue-grid">
          {results.available.map((v) => (
            <div className="venue-card" key={v.id}>
              <h4><span>{v.name}</span><StatusBadge status="AVAILABLE" /></h4>
              {v.bestMatch && <span className="badge badge-info" style={{ alignSelf: "flex-start" }}>★ Best match</span>}
              <div className="meta">{v.building || "—"} · {v.type} · Capacity {v.capacity}</div>
              <div className="meta">{fmtDate(v.date)} · {fmt12(v.startTime)} – {fmt12(v.endTime)}</div>
              <div className="tag-list" style={{ marginTop: 0 }}>{v.facilities.map((f) => <span className="tag" key={f}>{f}</span>)}</div>
              <div className="why">{v.explanation}</div>
              <div className="actions"><button className="btn btn-primary btn-sm" onClick={() => setBooking(v)}>Book Venue</button></div>
            </div>
          ))}
        </div>

        <div className="section-title"><h2 style={{ margin: 0 }}>Already booked or unavailable</h2><span className="count">{unavailable.length}</span></div>
        <p className="hint-text">These venues meet your capacity and facility needs but cannot be used for the whole time.</p>
        <div className="venue-grid">
          {unavailable.map((v) => (
            <div className={`venue-card ${v.availability === "BOOKED" ? "booked" : "unavailable"}`} key={v.id}>
              <h4><span>{v.name}</span><StatusBadge status={v.availability === "BOOKED" ? "BOOKED" : "UNAVAILABLE"} /></h4>
              <div className="meta">{v.building || "—"} · {v.type} · Capacity {v.capacity}</div>
              <div className="tag-list" style={{ marginTop: 0 }}>{v.facilities.map((f) => <span className="tag" key={f}>{f}</span>)}</div>
              <div className="why"><strong>Why it is unavailable:</strong><ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{v.unavailableReasons.map((r, i) => <li key={i}>{r}</li>)}</ul></div>
              {v.existingBookings.map((b) => (
                <div className="why" key={b.bookingId}>
                  <div><strong>{fmtDate(b.date)}</strong> · {fmt12(b.startTime)} – {fmt12(b.endTime)} · <StatusBadge status={b.status} /></div>
                  <div>Booked by {b.isMine ? "you" : b.ownerName}{b.ownerEmail && !b.isMine ? ` (${b.ownerEmail})` : ""}</div>
                  {b.canRequestChange && <button className="btn btn-amber btn-sm" style={{ marginTop: 6 }} onClick={() => setChange({ venue: v, booking: b })}>Request to Change Venue</button>}
                </div>
              ))}
              {v.partiallyAvailable.length > 0 && <div className="hint-text">Partly free: {v.partiallyAvailable.map((p) => `${fmt12(p.startTime)} – ${fmt12(p.endTime)}`).join(", ")}</div>}
              <div className="actions"><button className="btn btn-outline btn-sm" onClick={() => joinWaitlist(v)}>Notify me if it becomes available</button></div>
            </div>
          ))}
        </div>
      </>)}

      {booking && <BookingModal venue={booking} defaults={defaults} user={user} categories={categories} onClose={() => setBooking(null)} onDone={() => search()} />}
      {change && <ChangeRequestModal venue={change.venue} booking={change.booking} defaults={defaults} categories={categories} onClose={() => setChange(null)} />}
    </div>
  );
}
