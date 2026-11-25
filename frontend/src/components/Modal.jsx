import { useEffect, useState } from "react";

export default function Modal({title,onClose,children,wide,headerActions,hideCloseButton = false}) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label={title}>
      <div className={`modal ${wide ? "wide" : ""}`}>
        <div className="modal-head">
          <h3>{title}</h3>

          <div className="modal-head-actions">
            {headerActions}

            {!hideCloseButton && (
              <button
                className="icon-btn"
                onClick={onClose}
                aria-label="Close"
              >
                ✕
              </button>
            )}
          </div>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/** Confirmation dialog used for destructive actions. `askReason` adds a required reason field. */
export function ConfirmDialog({ title, message, confirmLabel = "Confirm", danger, askReason, reasonLabel = "Reason", onConfirm, onClose }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function go() {
    if (askReason && reason.trim().length < 3) { setError(`${reasonLabel} is required`); return; }
    setBusy(true); setError("");
    try { await onConfirm(reason.trim()); onClose(); } catch (e) { setError(e?.response?.data?.message || e.message); setBusy(false); }
  }
  return (
    <Modal title={title} onClose={onClose}>
      {message && <p>{message}</p>}
      {askReason && (<><label htmlFor="cd-reason">{reasonLabel}</label><textarea id="cd-reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></>)}
      {error && <p className="error-text">{error}</p>}
      <div className="form-actions">
        <button className={`btn ${danger ? "btn-danger" : "btn-primary"}`} onClick={go} disabled={busy}>{busy ? "Working…" : confirmLabel}</button>
        <button className="btn btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </Modal>
  );
}
