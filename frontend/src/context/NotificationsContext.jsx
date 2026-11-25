import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import api from "../api/client";
import { useAuth } from "./AuthContext";

const Ctx = createContext(null);
const BASE = import.meta.env.VITE_API_BASE_URL || "/api";

function retryAfterMs(value) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? 0 : Math.max(0, date - Date.now());
}

function wait(ms, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

/**
 * Notification state for the bell. Notifications are stored in the database; this provider loads them, listens to a
 * live Server-Sent-Events stream for new ones (fetch streaming so the Authorization header is used) and falls back
 * to polling every 45 s if the stream is unavailable.
 */
export function NotificationsProvider({ children }) {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const listeners = useRef(new Set());

  const reload = useCallback(async () => {
    try {
      const res = await api.get("/notifications", { params: { page: 1, pageSize: 10 } });
      setItems(res.data.items); setUnread(res.data.unread);
    } catch { /* ignore transient errors */ }
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    reload();
    let streaming = false;
    let rateLimitedUntil = 0;
    const poll = setInterval(() => {
      if (!streaming && Date.now() >= rateLimitedUntil && !document.hidden) reload();
    }, 45000); // fallback only: the live stream already delivers new items
    const ctrl = new AbortController();
    let stopped = false;
    let reconnectDelay = 2000;
    (async function connect() {
      while (!stopped) {
        let retryAfter = 0;
        let rateLimited = false;
        try {
          const res = await fetch(`${BASE}/notifications/stream`, { headers: { Authorization: `Bearer ${sessionStorage.getItem("uvms_token")}` }, signal: ctrl.signal });
          if (!res.ok || !res.body) {
            if (res.status === 429) {
              rateLimited = true;
              retryAfter = retryAfterMs(res.headers.get("Retry-After"));
            }
            throw new Error("stream unavailable");
          }
          const connectedAt = Date.now();
          streaming = true;
          reload(); // catch up on anything missed while disconnected
          const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let i;
            while ((i = buf.indexOf("\n\n")) >= 0) {
              const block = buf.slice(0, i); buf = buf.slice(i + 2);
              if (block.includes("event: notification")) {
                const line = block.split("\n").find((l) => l.startsWith("data: "));
                if (line) { const n = JSON.parse(line.slice(6)); setItems((cur) => [n, ...cur.filter((x) => x.id !== n.id)].slice(0, 10)); setUnread((u) => u + 1); listeners.current.forEach((fn) => fn(n)); }
              }
            }
          }
          if (Date.now() - connectedAt >= 30000) reconnectDelay = 2000;
        } catch (e) { if (stopped) return; }
        streaming = false;
        const jitteredDelay = Math.round(reconnectDelay * (0.5 + Math.random() * 0.5));
        const delay = Math.max(jitteredDelay, retryAfter);
        if (rateLimited) rateLimitedUntil = Date.now() + delay;
        await wait(delay, ctrl.signal);
        if (stopped) return;
        reconnectDelay = Math.min(reconnectDelay * 2, 60000);
      }
    })();
    return () => { stopped = true; ctrl.abort(); clearInterval(poll); };
  }, [user, reload]);

  async function markRead(id) {
    await api.patch(`/notifications/${id}/read`);
    setItems((cur) => cur.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnread((u) => Math.max(0, u - 1));
  }
  async function markAll() { await api.patch("/notifications/read-all"); setItems((cur) => cur.map((n) => ({ ...n, read: true }))); setUnread(0); }
  const onNew = (fn) => { listeners.current.add(fn); return () => listeners.current.delete(fn); };

  return <Ctx.Provider value={{ items, unread, reload, markRead, markAll, onNew }}>{children}</Ctx.Provider>;
}
export const useNotifications = () => useContext(Ctx);
