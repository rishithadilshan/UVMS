import { useCallback, useEffect, useState } from "react";
import api from "../../api/client";
import { errMsg, fmtDate, todayStr } from "../../lib/format";

const Bar = ({ value, max }) => <div style={{ background: "var(--surface-2)", borderRadius: 4, height: 10, minWidth: 90 }}><div style={{ width: `${max ? (value / max) * 100 : 0}%`, background: "var(--accent)", height: 10, borderRadius: 4 }} /></div>;

export default function Reports() {
  const [f, setF] = useState({ period: "monthly", date: todayStr(), from: todayStr(), to: todayStr() });
  const [r, setR] = useState(null); const [error, setError] = useState("");
  const params = { period: f.period, date: f.date, ...(f.period === "custom" ? { from: f.from, to: f.to } : {}) };
  const load = useCallback(() => { setError(""); api.get("/reports/summary", { params }).then((x) => setR(x.data)).catch((e) => setError(errMsg(e))); }, [f]); // eslint-disable-line
  useEffect(() => { load(); }, [load]);

  async function download(format) {
    try {
      const res = await api.get("/reports/export", { params: { ...params, format }, responseType: "blob" });
      const url = URL.createObjectURL(res.data); const a = document.createElement("a");
      a.href = url; a.download = `uvms-report-${r.from}_${r.to}.${format}`; a.click(); URL.revokeObjectURL(url);
    } catch (e) { setError(errMsg(e, "Export failed")); }
  }
  const T = r?.totals;
  return (
    <div>
      <div className="page-header"><div><h1>Reports and analytics</h1><p>Calculated live from the database.</p></div>
        <div className="no-print" style={{ display: "flex", gap: 8 }}><button className="btn btn-outline" onClick={() => download("xlsx")}>Export Excel</button><button className="btn btn-outline" onClick={() => download("csv")}>Export CSV</button><button className="btn btn-outline" onClick={() => window.print()}>Print / Save as PDF</button></div></div>
      <div className="card no-print"><div className="form-row">
        <div><label>Period</label><select value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="custom">Custom range</option></select></div>
        {f.period !== "custom" ? <div><label>Reference date</label><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div> : (<><div><label>From</label><input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></div><div><label>To</label><input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></div></>)}
      </div></div>
      {error && <div className="alert alert-error">{error}</div>}
      {r && (<>
        <p className="hint-text">Period: {fmtDate(r.from)} – {fmtDate(r.to)} · utilization uses operating hours {r.operatingHours.start}–{r.operatingHours.end}</p>
        <div className="stat-grid">{[["Total venues", T.venues], ["Total bookings", T.bookings], ["Confirmed", T.confirmed], ["Pending student requests", T.pending], ["Rejected", T.rejected], ["Cancelled", T.cancelled], ["Expired", T.expired], ["No-shows", T.noShows]].map(([l, v]) => <div className="stat" key={l}><div className="num">{v}</div><div className="lbl">{l}</div></div>)}</div>
        <div className="grid-2">
          <div className="card"><h3>Most frequently booked</h3>{r.mostBooked.map((v) => <div key={v.id} style={{ marginBottom: 8 }}>{v.name} — {v.bookings}<Bar value={v.bookings} max={r.mostBooked[0]?.bookings} /></div>)}</div>
          <div className="card"><h3>Least frequently booked</h3>{r.leastBooked.map((v) => <div key={v.id} style={{ marginBottom: 8 }}>{v.name} — {v.bookings}<Bar value={v.bookings} max={r.mostBooked[0]?.bookings || 1} /></div>)}</div>
          <div className="card"><h3>By building</h3>{r.byBuilding.length === 0 ? <p className="hint-text">No data.</p> : r.byBuilding.map((b) => <div key={b.building} style={{ marginBottom: 8 }}>{b.building} — {b.bookings}<Bar value={b.bookings} max={r.byBuilding[0].bookings} /></div>)}</div>
          <div className="card"><h3>By category</h3>{r.byCategory.length === 0 ? <p className="hint-text">No data.</p> : r.byCategory.map((b) => <div key={b.category} style={{ marginBottom: 8 }}>{b.category} — {b.bookings}<Bar value={b.bookings} max={r.byCategory[0].bookings} /></div>)}</div>
        </div>
        <div className="card"><h3>Venue utilization</h3><div className="table-scroll"><table><thead><tr><th>Venue</th><th>Building</th><th>Confirmed bookings</th><th>Booked hours</th><th>Utilization</th></tr></thead><tbody>{r.utilization.map((v) => <tr key={v.id}><td>{v.name}</td><td>{v.building}</td><td>{v.bookings}</td><td>{(v.booked_minutes / 60).toFixed(1)}</td><td>{v.utilization}% <Bar value={v.utilization} max={100} /></td></tr>)}</tbody></table></div></div>
        <div className="card"><h3>Maintenance periods</h3>{r.maintenance.length === 0 ? <p className="hint-text">None in this period.</p> : <div className="table-scroll"><table><thead><tr><th>Venue</th><th>Status</th><th>Reason</th><th>From</th><th>Until</th></tr></thead><tbody>{r.maintenance.map((m, i) => <tr key={i}><td>{m.venue}</td><td>{m.status.replace(/_/g, " ")}</td><td>{m.reason}</td><td>{m.starts_at}</td><td>{m.ends_at || "Open"}</td></tr>)}</tbody></table></div>}</div>
        <div className="card"><h3>No-show records</h3><p className="hint-text">Confirmed bookings that ended without a check-in.</p>{r.noShows.length === 0 ? <p className="hint-text">None.</p> : <div className="table-scroll"><table><thead><tr><th>Date</th><th>Venue</th><th>Booked by</th><th>Time</th><th>Purpose</th></tr></thead><tbody>{r.noShows.map((n) => <tr key={n.id}><td>{n.date}</td><td>{n.venue}</td><td>{n.booked_by}</td><td>{n.start_time}–{n.end_time}</td><td>{n.purpose}</td></tr>)}</tbody></table></div>}</div>
      </>)}
    </div>
  );
}
