import { useEffect, useState } from "react";
import api from "../../api/client";
import StatusBadge from "../../components/StatusBadge";
import { errMsg } from "../../lib/format";

// Lab assistants can still report a managed laboratory as unavailable or bring it back online.
export default function LabStatus() {
  const [labs, setLabs] = useState([]);
  const [error, setError] = useState("");
  const load = () => api.get("/venues", { params: { type: "Laboratory" } }).then((res) => setLabs(res.data));
  useEffect(() => { load(); }, []);

  async function setStatus(lab, status) {
    setError("");
    const note = status === "maintenance" ? prompt("What's wrong with this lab?") || "" : "";
    if (status === "maintenance" && !note) return;
    try { await api.patch(`/venues/${lab.id}/status`, { status, maintenanceNote: note }); load(); } catch (err) { setError(errMsg(err, "Could not update status")); }
  }
  return (
    <div>
      <div className="page-header"><div><h1>Lab status</h1><p>Report a laboratory as unavailable, or bring it back online. You can only change laboratories you manage.</p></div></div>
      {error && <p className="error-text">{error}</p>}
      <div className="card"><div className="table-scroll"><table><thead><tr><th>Lab</th><th>Capacity</th><th>Status</th><th></th></tr></thead><tbody>
        {labs.map((lab) => (<tr key={lab.id}><td>{lab.name}</td><td>{lab.capacity}</td><td><StatusBadge status={lab.status} /></td>
          <td>{lab.status === "AVAILABLE" ? <button className="btn btn-outline btn-sm" onClick={() => setStatus(lab, "maintenance")}>Report problem</button> : <button className="btn btn-primary btn-sm" onClick={() => setStatus(lab, "available")}>Back online</button>}</td></tr>))}
        {labs.length === 0 && <tr><td colSpan="4" className="empty-state">No laboratories found.</td></tr>}
      </tbody></table></div></div>
    </div>
  );
}
