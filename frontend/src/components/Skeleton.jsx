// Loading placeholders that reuse the existing .stat-grid / .card / table classes, so nothing shifts when data arrives.
export function StatGridSkeleton({ count = 4 }) {
  return (
    <div className="stat-grid" aria-busy="true" aria-label="Loading figures">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="stat"><span className="skeleton skeleton-num" /><span className="skeleton skeleton-lbl" /></div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 4, cols = 5 }) {
  return (
    <div className="table-scroll" aria-busy="true" aria-label="Loading table">
      <table><tbody>
        {Array.from({ length: rows }, (_, r) => (
          <tr key={r} className="skeleton-row">{Array.from({ length: cols }, (_, c) => <td key={c}><span className="skeleton skeleton-line" /></td>)}</tr>
        ))}
      </tbody></table>
    </div>
  );
}

/** Fallback shown while a lazily loaded page chunk downloads (the sidebar and top bar stay visible). */
export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading page">
      <div className="page-header"><div><span className="skeleton" style={{ height: "1.8rem", width: 260, marginBottom: 10 }} /><span className="skeleton skeleton-lbl" style={{ width: 340 }} /></div></div>
      <StatGridSkeleton />
      <div className="card"><TableSkeleton /></div>
    </div>
  );
}
