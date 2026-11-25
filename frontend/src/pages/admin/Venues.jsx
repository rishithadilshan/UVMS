import { useCallback, useEffect, useState } from "react";
import api from "../../api/client";
import FacilitySelect from "../../components/FacilitySelect";
import Modal, { ConfirmDialog } from "../../components/Modal";
import StatusBadge from "../../components/StatusBadge";
import { errMsg, fmt12, fmtDate, fmtLocal } from "../../lib/format";
import { useDebounced } from "../../lib/useDebounced";

const EMPTY = { name: "", capacity: "", building: "", buildingOther: "", type: "", typeOther: "", facilities: [], managedBy: [] };

function VenueForm({ venue, meta, labAssistants, onClose, onSaved }) {
  const [f, setF] = useState(venue ? { ...EMPTY, name: venue.name, capacity: venue.capacity, building: venue.building, type: venue.type, facilities: venue.facilities || [], managedBy: venue.managedBy || [] } : EMPTY);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  async function save(e) {
    e.preventDefault(); setError("");
    const building = f.building === "__other" ? f.buildingOther.trim() : f.building;
    const type = f.type === "__other" ? f.typeOther.trim() : f.type;
    if (!building || !type) return setError("Choose or enter a building and a venue type");
    if (!Number.isInteger(Number(f.capacity)) || Number(f.capacity) < 1) return setError("Capacity must be a positive whole number");
    setBusy(true);
    try {
      const body = { name: f.name.trim(), capacity: Number(f.capacity), building, type, facilities: f.facilities, managedBy: f.managedBy };
      if (venue) await api.put(`/venues/${venue.id}`, body); else await api.post("/venues", body);
      onSaved(); onClose();
    } catch (err) { setError(errMsg(err)); setBusy(false); }
  }
  return (
    <Modal
      title={venue ? `Edit ${venue.name}` : "Add venue"}
      onClose={onClose}
      wide
      hideCloseButton
      headerActions={
        <>
          <button
            type="submit"
            form="venue-form"
            className="btn btn-primary"
            disabled={busy}
          >
            {busy ? "Saving…" : "Save venue"}
          </button>

          <button
            type="button"
            className="btn btn-outline"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
        </>
      }
    >
      <form id="venue-form" onSubmit={save}>
        <div className="form-row">
          <div><label htmlFor="admin-venue-name">Venue name</label><input id="admin-venue-name" value={f.name} onChange={(e) => set("name", e.target.value)} required /></div>
          <div><label>Capacity</label><input type="number" min="1" max="10000" value={f.capacity} onChange={(e) => set("capacity", e.target.value)} required /></div>
        </div>
        <div className="form-row">
          <div><label>Building</label><select value={f.building} onChange={(e) => set("building", e.target.value)} required><option value="">Select…</option>{meta.buildings.map((b) => <option key={b}>{b}</option>)}<option value="__other">Other (type a new one)…</option></select>
            {f.building === "__other" && <input style={{ marginTop: 6 }} placeholder="New building" value={f.buildingOther} onChange={(e) => set("buildingOther", e.target.value)} />}</div>
          <div><label>Venue type</label><select value={f.type} onChange={(e) => set("type", e.target.value)} required><option value="">Select…</option>{meta.types.map((t) => <option key={t}>{t}</option>)}<option value="__other">Other (type a new one)…</option></select>
            {f.type === "__other" && <input style={{ marginTop: 6 }} placeholder="New type" value={f.typeOther} onChange={(e) => set("typeOther", e.target.value)} />}</div>
        </div>
        <label>Facilities</label>
        <FacilitySelect options={meta.facilities} value={f.facilities} onChange={(v) => set("facilities", v)} />
        {labAssistants.length > 0 && (<><label>Lab assistants who manage this venue</label>
          <div className="filter-bar">{labAssistants.map((u) => <button type="button" key={u.id} className={`chip ${f.managedBy.includes(u.id) ? "active" : ""}`} onClick={() => set("managedBy", f.managedBy.includes(u.id) ? f.managedBy.filter((x) => x !== u.id) : [...f.managedBy, u.id])}>{u.name}</button>)}</div></>)}
        {error && <p className="error-text" role="alert">{error}</p>}
      </form>
    </Modal>
  );
}

function History({ venue, onClose }) {
  const [h, setH] = useState(null); const [page, setPage] = useState(1);
  useEffect(() => { api.get(`/venues/${venue.id}/history`, { params: { page, pageSize: 10 } }).then((r) => setH(r.data)); }, [venue.id, page]);
  return (
    <Modal title={`${venue.name} — history`} onClose={onClose} wide>
      {!h ? <p className="empty-state">Loading…</p> : (<>
        <h4>Maintenance history</h4>
        {h.maintenance.length === 0 ? <p className="hint-text">No maintenance records.</p> : <div className="table-scroll"><table><thead><tr><th>Status</th><th>Reason</th><th>From</th><th>Expected reopening</th><th>Restored</th></tr></thead><tbody>{h.maintenance.map((m) => <tr key={m.id}><td><StatusBadge status={m.status} /></td><td>{m.reason}</td><td>{fmtLocal(m.starts_at)}</td><td>{m.ends_at ? fmtLocal(m.ends_at) : "—"}</td><td>{m.restored_at ? "Yes" : "—"}</td></tr>)}</tbody></table></div>}
        <h4 style={{ marginTop: 16 }}>Booking history ({h.bookings.total})</h4>
        <div className="table-scroll"><table><thead><tr><th>Date</th><th>Time</th><th>Booked by</th><th>Purpose</th><th>Status</th></tr></thead><tbody>{h.bookings.items.map((b) => <tr key={b.id}><td>{fmtDate(b.date)}</td><td>{fmt12(b.startTime)} – {fmt12(b.endTime)}</td><td>{b.ownerName || "—"}</td><td>{b.purpose}</td><td><StatusBadge status={b.status} /></td></tr>)}</tbody></table></div>
        <div className="pager"><button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Newer</button><button className="btn btn-outline btn-sm" disabled={page * 10 >= h.bookings.total} onClick={() => setPage(page + 1)}>Older →</button></div>
      </>)}
    </Modal>
  );
}

export default function Venues() {
  const [venues, setVenues] = useState([]); const [meta, setMeta] = useState({ buildings: [], types: [], facilities: [] }); const [las, setLas] = useState([]);
  const [q, setQ] = useState(""); const [showInactive, setShowInactive] = useState(false);
  const [edit, setEdit] = useState(null); const [hist, setHist] = useState(null); const [del, setDel] = useState(null);
  const [msg, setMsg] = useState(""); const [error, setError] = useState("");
  const dq = useDebounced(q, 300);
  const loadVenues = useCallback(() => { api.get("/venues", { params: { includeInactive: showInactive, q: dq || undefined } }).then((r) => setVenues(r.data)).catch((e) => setError(errMsg(e))); }, [showInactive, dq]);
  const loadMeta = useCallback(() => { api.get("/venues/meta").then((r) => setMeta(r.data)); }, []);
  const load = useCallback(() => { loadVenues(); loadMeta(); }, [loadVenues, loadMeta]); // used after a save: venues and lookups may both have changed
  useEffect(() => { loadVenues(); }, [loadVenues]);
  useEffect(() => { loadMeta(); }, [loadMeta]);
  useEffect(() => { api.get("/users", { params: { role: "LAB_ASSISTANT" } }).then((r) => setLas(r.data)).catch(() => {}); }, []);
  return (
    <div>
      <div className="page-header"><div><h1>Venue management</h1><p>Add, edit and retire venues. Venues with booking history are deactivated, never deleted. Use Venue Maintenance to change availability.</p></div><button className="btn btn-primary" onClick={() => setEdit({})}>+ Add venue</button></div>
      {msg && <div className="alert alert-success">{msg}</div>}{error && <div className="alert alert-error">{error}</div>}
      <div className="filter-bar"><input style={{ maxWidth: 280 }} placeholder="Search venues…" value={q} onChange={(e) => setQ(e.target.value)} /><label className="check-inline" style={{ margin: 0 }}><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive</label></div>
      <div className="card">
        {venues.length === 0 ? <p className="empty-state">No venues found.</p> : (
          <div className="table-scroll"><table className="responsive"><thead><tr><th>Name</th><th>Building</th><th>Type</th><th>Capacity</th><th>Facilities</th><th>Status</th><th></th></tr></thead><tbody>
            {venues.map((v) => (<tr key={v.id} style={v.active ? undefined : { opacity: 0.6 }}><td data-label="Name">{v.name}</td><td data-label="Building">{v.building || "—"}</td><td data-label="Type">{v.type}</td><td data-label="Capacity">{v.capacity}</td>
              <td data-label="Facilities" style={{ maxWidth: 260 }}>{(v.facilities || []).join(", ") || "—"}</td><td data-label="Status">{v.active ? <StatusBadge status={v.status} /> : <span className="badge badge-cancelled">INACTIVE</span>}</td>
              <td><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><button className="btn btn-outline btn-sm" onClick={() => setEdit(v)}>Edit</button><button className="btn btn-outline btn-sm" onClick={() => setHist(v)}>History</button>
                {v.active ? <button className="btn btn-danger btn-sm" onClick={() => setDel(v)}>Delete</button> : <button className="btn btn-primary btn-sm" onClick={async () => { await api.patch(`/venues/${v.id}/reactivate`); load(); }}>Reactivate</button>}</div></td></tr>))}
          </tbody></table></div>)}
      </div>
      {edit && <VenueForm venue={edit.id ? edit : null} meta={meta} labAssistants={las} onClose={() => setEdit(null)} onSaved={() => { setMsg("Venue saved."); load(); }} />}
      {hist && <History venue={hist} onClose={() => setHist(null)} />}
      {del && <ConfirmDialog title={`Delete ${del.name}`} danger confirmLabel="Delete" message="If this venue has booking history it is deactivated instead of deleted. Venues with upcoming bookings cannot be removed." onClose={() => setDel(null)} onConfirm={async () => { const r = await api.delete(`/venues/${del.id}`); setMsg(r.data.message); load(); }} />}
    </div>
  );
}
