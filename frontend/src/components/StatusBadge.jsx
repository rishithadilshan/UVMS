const CLASS = {
  PENDING: "badge-pending", CONFIRMED: "badge-approved", APPROVED: "badge-approved", ACCEPTED: "badge-approved", AVAILABLE: "badge-approved", SENT: "badge-approved", NOTIFIED: "badge-info",
  REJECTED: "badge-rejected", CANCELLED: "badge-cancelled", EXPIRED: "badge-cancelled", BOOKED: "badge-rejected", UNAVAILABLE: "badge-rejected", UNDER_MAINTENANCE: "badge-pending", TEMPORARILY_CLOSED: "badge-pending",
  WAITING: "badge-pending", SKIPPED: "badge-cancelled",
};
export default function StatusBadge({ status }) {
  if (!status) return null;
  return <span className={`badge ${CLASS[status] || "badge-info"}`}>{String(status).replace(/_/g, " ")}</span>;
}
