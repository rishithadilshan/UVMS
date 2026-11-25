import { useEffect, useRef, useState } from "react";

/** Multi-select dropdown with checkboxes. `allowOther` lets the user add a custom facility. */
export default function FacilitySelect({ options, value, onChange, allowOther = true, placeholder = "Select facilities" }) {
  const [open, setOpen] = useState(false);
  const [other, setOther] = useState("");
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const has = (f) => value.some((x) => x.toLowerCase() === f.toLowerCase());
  const toggle = (f) => onChange(has(f) ? value.filter((x) => x.toLowerCase() !== f.toLowerCase()) : [...value, f]);
  const addOther = () => { const f = other.trim(); if (f && !has(f)) onChange([...value, f]); setOther(""); };
  const extras = value.filter((v) => !options.some((o) => o.toLowerCase() === v.toLowerCase()));
  return (
    <div className="ms" ref={ref}>
      <button type="button" className="ms-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>{value.length ? `${value.length} selected: ${value.join(", ")}` : placeholder}</span><span aria-hidden>▾</span>
      </button>
      {open && (
        <div className="ms-panel">
          {[...options, ...extras].map((f) => (
            <label key={f} className="ms-opt"><input type="checkbox" checked={has(f)} onChange={() => toggle(f)} />{f}</label>
          ))}
          {allowOther && (
            <div className="ms-other">
              <input placeholder="Other facility…" value={other} onChange={(e) => setOther(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addOther(); } }} />
              <button type="button" className="btn btn-outline btn-sm" onClick={addOther}>Add</button>
            </div>
          )}
        </div>
      )}
      {value.length > 0 && (
        <div className="tag-list">{value.map((f) => (<span className="tag" key={f}>{f}<button type="button" onClick={() => toggle(f)} aria-label={`Remove ${f}`}>×</button></span>))}</div>
      )}
    </div>
  );
}
