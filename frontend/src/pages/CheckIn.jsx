import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import api from "../api/client";
import { errMsg } from "../lib/format";

/** Landing page for the QR / link check-in: /check-in?token=… */
export default function CheckIn() {
  const [params] = useSearchParams();
  const [state, setState] = useState({ busy: true });
  useEffect(() => {
    const token = params.get("token");
    if (!token) { setState({ error: "No check-in code in this link." }); return; }
    api.post("/bookings/check-in/token", { token }).then((r) => setState({ ok: r.data.message, id: r.data.bookingId })).catch((e) => setState({ error: errMsg(e) }));
  }, [params]);
  return (
    <div className="card" style={{ maxWidth: 520 }}>
      <h2>Venue check-in</h2>
      {state.busy && <p>Checking in…</p>}
      {state.ok && <div className="alert alert-success">{state.ok}</div>}
      {state.error && <div className="alert alert-error">{state.error}</div>}
      {state.id && <Link to={`/bookings/${state.id}`}>View booking</Link>}
    </div>
  );
}
