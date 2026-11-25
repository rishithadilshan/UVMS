import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useNotifications } from "../context/NotificationsContext";
import Pagination from "../components/Pagination";
import { fmtDateTime } from "../lib/format";

export default function Notifications() {
  const { user } = useAuth();
  const ctx = useNotifications();
  const navigate = useNavigate();
  const [tab, setTab] = useState("mine");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, pageSize: 20 });
  const [audit, setAudit] = useState({ items: [], total: 0, pageSize: 25 });
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    if (tab === "mine") api.get("/notifications", { params: { page, pageSize: 20, unread: unreadOnly || undefined } }).then((r) => setData(r.data)).finally(() => setLoading(false));
    else api.get("/admin/audit", { params: { page, pageSize: 25 } }).then((r) => setAudit(r.data)).finally(() => setLoading(false));
  }, [tab, page, unreadOnly]);
  useEffect(() => { load(); }, [load]);

  async function open(n) { if (!n.read) { await ctx.markRead(n.id); } navigate(n.link || "/notifications"); }
  async function markAll() { await ctx.markAll(); load(); }

  return (
    <div>
      <div className="page-header">
        <div><h1>Notifications</h1><p>Booking decisions, requests, reminders and system messages. They stay available after you sign out.</p></div>
        {tab === "mine" && <button className="btn btn-outline btn-sm" onClick={markAll}>Mark all as read</button>}
      </div>
      {user.role === "ADMIN" && <div className="tabs"><button className={`tab ${tab === "mine" ? "active" : ""}`} onClick={() => { setTab("mine"); setPage(1); }}>My notifications</button><button className={`tab ${tab === "audit" ? "active" : ""}`} onClick={() => { setTab("audit"); setPage(1); }}>System activity log</button></div>}
      {tab === "mine" && (<>
        <div className="filter-bar"><button className={`chip ${!unreadOnly ? "active" : ""}`} onClick={() => { setUnreadOnly(false); setPage(1); }}>All</button><button className={`chip ${unreadOnly ? "active" : ""}`} onClick={() => { setUnreadOnly(true); setPage(1); }}>Unread</button></div>
        <div className="card" style={{ padding: 0 }}>
          {loading ? <p className="empty-state">Loading…</p> : data.items.length === 0 ? <p className="empty-state">You're all caught up.</p> : data.items.map((n) => (
            <button key={n.id} className={`notif-item ${n.read ? "" : "unread"}`} onClick={() => open(n)}><div className="t">{n.title}</div><div className="m">{n.message}</div><div className="d">{fmtDateTime(n.createdAt)}{n.read ? "" : " · unread"}</div></button>
          ))}
        </div>
        <Pagination page={page} pageSize={20} total={data.total} onPage={setPage} />
      </>)}
      {tab === "audit" && (
        <div className="card">
          <div className="table-scroll"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead><tbody>
            {audit.items.map((a) => (<tr key={a.id}><td>{fmtDateTime(a.createdAt)}</td><td>{a.actorName || "System"}</td><td>{a.action}</td><td>{a.entityType}</td><td className="hint-text">{Object.entries(a.metadata || {}).filter(([, v]) => v !== "" && v != null && typeof v !== "object").map(([k, v]) => `${k}: ${v}`).join(" · ")}</td></tr>))}
          </tbody></table></div>
          <Pagination page={page} pageSize={25} total={audit.total} onPage={setPage} />
        </div>
      )}
    </div>
  );
}
