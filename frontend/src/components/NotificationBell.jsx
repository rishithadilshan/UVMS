import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useNotifications } from "../context/NotificationsContext";
import { fmtDateTime } from "../lib/format";

export default function NotificationBell() {
  const { items, unread, markRead, markAll } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  async function openItem(n) {
    if (!n.read) await markRead(n.id);
    setOpen(false);
    if (n.link) navigate(n.link);
  }
  return (
    <div className="rel" ref={ref}>
      <button className="icon-btn" onClick={() => setOpen(!open)} aria-label={`Notifications (${unread} unread)`} aria-expanded={open}>
        🔔{unread > 0 && <span className="bell-badge">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="dropdown">
          <div className="dropdown-head"><span>Notifications</span><button className="link-btn" onClick={markAll} disabled={!unread}>Mark all as read</button></div>
          <div className="dropdown-list">
            {items.length === 0 && <p className="empty-state">You're all caught up.</p>}
            {items.map((n) => (
              <button key={n.id} className={`notif-item ${n.read ? "" : "unread"}`} onClick={() => openItem(n)}>
                <div className="t">{n.title}</div><div className="m">{n.message.length > 140 ? `${n.message.slice(0, 140)}…` : n.message}</div><div className="d">{fmtDateTime(n.createdAt)}</div>
              </button>
            ))}
          </div>
          <div className="dropdown-foot"><button className="link-btn" onClick={() => { setOpen(false); navigate("/notifications"); }}>View all notifications</button></div>
        </div>
      )}
    </div>
  );
}
