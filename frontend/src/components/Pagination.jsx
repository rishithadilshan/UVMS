export default function Pagination({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return total ? <div className="pager"><span>{total} record{total === 1 ? "" : "s"}</span></div> : null;
  return (
    <div className="pager">
      <span>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</span>
      <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>← Prev</button>
        <span>Page {page} / {pages}</span>
        <button className="btn btn-outline btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next →</button>
      </span>
    </div>
  );
}
