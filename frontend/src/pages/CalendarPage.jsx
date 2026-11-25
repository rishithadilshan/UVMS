import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import BookingDetails from "../components/BookingDetails";
import Modal from "../components/Modal";
import { addDays, dow, fmt12, fmtDate, todayStr, errMsg } from "../lib/format";

const H0 = 7, H1 = 22, PX = 48;
const cls = (e) => (e.kind === "MAINTENANCE" ? (e.status === "TEMPORARILY_CLOSED" ? "ev-closed" : "ev-maint") : e.status === "PENDING" ? "ev-pending" : "ev-confirmed");
const mins = (s) => Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16));
const monthStart = (d) => `${d.slice(0, 7)}-01`;

function dayEvents(events, venueId, day) {
  return events.filter((e) => e.venueId === venueId && e.start.slice(0, 10) <= day && e.end.slice(0, 10) >= day).map((e) => ({
    ...e, s: e.start.slice(0, 10) < day ? 0 : mins(e.start), e: e.end.slice(0, 10) > day ? 1440 : mins(e.end),
  }));
}

function Column({ items, onPick }) {
  return (
    <div className="tg-col" style={{ height: (H1 - H0) * PX }}>
      {items.map((e, i) => {
        const top = Math.max(0, ((e.s - H0 * 60) / 60) * PX), h = Math.max(18, ((Math.min(e.e, H1 * 60) - Math.max(e.s, H0 * 60)) / 60) * PX);
        if (e.e <= H0 * 60 || e.s >= H1 * 60) return null;
        return <button key={i} className={`ev ${cls(e)}`} style={{ top, height: h }} onClick={() => onPick(e)} title={`${e.venueName}: ${e.label}`}>{fmt12(e.start.slice(11, 16))} {e.label}</button>;
      })}
    </div>
  );
}

export default function CalendarPage() {
  const { user } = useAuth();
  const [view, setView] = useState("day");
  const [date, setDate] = useState(todayStr());
  const [f, setF] = useState({ building: "", venueId: "", status: "", categoryId: "" });
  const [data, setData] = useState({ venues: [], events: [] });
  const [cats, setCats] = useState([]); const [buildings, setBuildings] = useState([]); const [allVenues, setAllVenues] = useState([]);
  const [error, setError] = useState(""); const [open, setOpen] = useState(null); const [info, setInfo] = useState(null);

  const range = useMemo(() => {
    if (view === "day") return [date, date];
    if (view === "week") { const mon = addDays(date, -((dow(date) + 6) % 7)); return [mon, addDays(mon, 6)]; }
    const first = monthStart(date); const start = addDays(first, -((dow(first) + 6) % 7)); return [start, addDays(start, 41)];
  }, [view, date]);

  useEffect(() => { api.get("/categories").then((r) => setCats(r.data)); api.get("/venues/meta").then((r) => setBuildings(r.data.buildings)); api.get("/venues").then((r) => setAllVenues(r.data)); }, []);
  const load = useCallback(() => {
    const params = { from: range[0], to: range[1], ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) };
    api.get("/calendar", { params }).then((r) => { setData(r.data); setError(""); }).catch((e) => setError(errMsg(e)));
  }, [range, f]);
  useEffect(() => { load(); }, [load]);

  const step = (n) => setDate(view === "month" ? addDays(monthStart(date), n * 31).slice(0, 7) + "-01" : addDays(date, n * (view === "week" ? 7 : 1)));
  const pick = (e) => (e.id ? setOpen(e.id) : setInfo(e));
  const venueOptions = allVenues.filter((v) => !f.building || v.building === f.building);
  const weekVenue = f.venueId || venueOptions[0]?.id;
  const days = view === "week" ? Array.from({ length: 7 }, (_, i) => addDays(range[0], i)) : [];
  const hours = Array.from({ length: H1 - H0 }, (_, i) => H0 + i);
  const hourCol = <div>{hours.map((h) => <div className="tg-hour" key={h}>{fmt12(`${String(h).padStart(2, "0")}:00`)}</div>)}</div>;

  return (
    <div>
      <div className="page-header"><div><h1>Venue availability calendar</h1><p>{user.role === "ADMIN" ? "All bookings across the university." : "Booked times are shown without private details. Open your own bookings for more."}</p></div></div>
      <div className="card">
        <div className="cal-toolbar">
          <div className="filter-bar" style={{ margin: 0 }}>{["day", "week", "month"].map((v) => <button key={v} className={`chip ${view === v ? "active" : ""}`} onClick={() => setView(v)}>{v[0].toUpperCase() + v.slice(1)}</button>)}</div>
          <button className="btn btn-outline btn-sm" onClick={() => step(-1)}>←</button>
          <input type="date" style={{ width: "auto" }} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          <button className="btn btn-outline btn-sm" onClick={() => step(1)}>→</button>
          <button className="btn btn-outline btn-sm" onClick={() => setDate(todayStr())}>Today</button>
        </div>
        <div className="form-row">
          <div><label>Building</label><select value={f.building} onChange={(e) => setF({ ...f, building: e.target.value, venueId: "" })}><option value="">All buildings</option>{buildings.map((b) => <option key={b}>{b}</option>)}</select></div>
          <div><label>Venue</label><select value={f.venueId} onChange={(e) => setF({ ...f, venueId: e.target.value })}><option value="">{view === "week" ? "First venue" : "All venues"}</option>{venueOptions.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
          <div><label>Booking status</label><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">Confirmed + pending</option><option value="CONFIRMED">Confirmed</option><option value="PENDING">Pending student request</option></select></div>
          <div><label>Category</label><select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}><option value="">All categories</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        </div>
      </div>
      <div className="legend"><span><i className="ev-confirmed" />Confirmed booking</span><span><i className="ev-pending" />Pending student request</span><span><i className="ev-maint" />Under maintenance</span><span><i className="ev-closed" />Temporarily closed</span><span><i className="ev-free" />Available (empty)</span></div>
      {error && <p className="error-text">{error}</p>}

      {view === "day" && (data.venues.length === 0 ? <div className="card empty-state">No venues match the filters.</div> : (
        <div className="time-grid" style={{ gridTemplateColumns: `64px repeat(${data.venues.length}, minmax(130px, 1fr))`, maxHeight: "72vh" }}>
          <div className="tg-head">{fmtDate(date).split(",")[0]}</div>
          {data.venues.map((v) => <div className="tg-head" key={v.id}>{v.name}<br /><small style={{ fontWeight: 400 }}>{v.building}</small></div>)}
          {hourCol}
          {data.venues.map((v) => <Column key={v.id} items={dayEvents(data.events, v.id, date)} onPick={pick} />)}
        </div>))}

      {view === "week" && (!weekVenue ? <div className="card empty-state">No venues.</div> : (
        <div className="time-grid" style={{ gridTemplateColumns: "64px repeat(7, minmax(110px, 1fr))", maxHeight: "72vh" }}>
          <div className="tg-head">{allVenues.find((v) => v.id === weekVenue)?.name}</div>
          {days.map((d) => <div className="tg-head" key={d}>{fmtDate(d).split(",")[0]} {d.slice(8)}</div>)}
          {hourCol}
          {days.map((d) => <Column key={d} items={dayEvents(data.events.filter((e) => e.venueId === weekVenue), weekVenue, d)} onPick={pick} />)}
        </div>))}

      {view === "month" && (
        <div className="month-grid">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div className="mg-dow" key={d}>{d}</div>)}
          {Array.from({ length: 42 }, (_, i) => addDays(range[0], i)).map((d) => {
            const ev = data.events.filter((e) => (!f.venueId || e.venueId === f.venueId) && e.start.slice(0, 10) <= d && e.end.slice(0, 10) >= d);
            return (
              <button key={d} className={`mg-cell ${d.slice(0, 7) !== date.slice(0, 7) ? "dim" : ""} ${d === todayStr() ? "today" : ""}`} onClick={() => { setDate(d); setView("day"); }}>
                <span className="dn">{Number(d.slice(8))}</span>
                {ev.slice(0, 3).map((e, i) => <span key={i} className={`mg-pill ${cls(e)}`}>{e.kind === "BOOKING" ? fmt12(e.start.slice(11, 16)) : "⚠"} {e.venueName}</span>)}
                {ev.length > 3 && <span className="hint-text">+{ev.length - 3} more</span>}
              </button>
            );
          })}
        </div>)}

      {open && <BookingDetails id={open} user={user} onClose={() => setOpen(null)} onChanged={load} />}
      {info && (
        <Modal title={info.kind === "MAINTENANCE" ? "Venue unavailable" : "Venue reserved"} onClose={() => setInfo(null)}>
          <dl className="kv"><dt>Venue</dt><dd>{info.venueName} ({info.building})</dd><dt>From</dt><dd>{fmtDate(info.start.slice(0, 10))}, {fmt12(info.start.slice(11, 16))}</dd><dt>Until</dt><dd>{info.end.slice(0, 4) > "2100" ? "Further notice" : `${fmtDate(info.end.slice(0, 10))}, ${fmt12(info.end.slice(11, 16))}`}</dd><dt>Status</dt><dd>{info.kind === "MAINTENANCE" ? info.status.replace(/_/g, " ") : info.status === "PENDING" ? "Reserved (pending request)" : "Booked"}</dd>{info.kind === "MAINTENANCE" && <><dt>Reason</dt><dd>{info.label}</dd></>}</dl>
          <p className="hint-text">Details of other users' bookings are private.</p>
        </Modal>)}
    </div>
  );
}
