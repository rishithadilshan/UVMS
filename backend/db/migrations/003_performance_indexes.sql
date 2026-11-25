-- 003: performance indexes (additive only: no table, column or constraint is changed or dropped).
-- Every index is IF NOT EXISTS, so re-running is harmless. The migration runner wraps each file in a transaction, which is
-- why plain CREATE INDEX is used here; for a large production table use db/ops/003_performance_indexes_concurrently.sql
-- (identical definitions, built with CREATE INDEX CONCURRENTLY outside a transaction) BEFORE running this migration.

-- Admin booking list / calendar window / reports range / "bookings today": range + ORDER BY on starts_at alone
-- (existing bookings indexes lead with status, venue_id or owner_id, so none can serve a plain starts_at range or sort).
CREATE INDEX IF NOT EXISTS bookings_starts_at_idx ON bookings (starts_at);

-- Category filter on the calendar / booking list and the per-category booking count on GET /api/categories (FK had no index).
CREATE INDEX IF NOT EXISTS bookings_category_idx ON bookings (category_id) WHERE category_id IS NOT NULL;

-- Notification feed: WHERE user_id = $1 ORDER BY created_at DESC LIMIT n (polled by every signed-in user).
-- The existing (user_id, read, created_at DESC) index stays: it serves the unread counter.
CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON notifications (user_id, created_at DESC);

-- Pending change requests: admin dashboard counter (polled) and the scheduler's per-minute "expire past requests" UPDATE.
-- Partial, so it only ever contains the (few) pending rows.
CREATE INDEX IF NOT EXISTS vcr_pending_start_idx ON venue_change_requests (requested_starts_at) WHERE status = 'PENDING';

-- Open (not yet restored) maintenance records: venue effective-status sub-select, availability checks and the
-- "unavailable venues" counter. Partial, so it stays tiny however much maintenance history accumulates.
CREATE INDEX IF NOT EXISTS venue_maintenance_open_idx ON venue_maintenance (venue_id, starts_at) WHERE restored_at IS NULL;

ANALYZE bookings;
ANALYZE notifications;
ANALYZE venue_change_requests;
ANALYZE venue_maintenance;
