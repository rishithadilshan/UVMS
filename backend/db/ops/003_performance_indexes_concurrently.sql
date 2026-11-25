-- Optional: build the 003 indexes WITHOUT blocking writes on a large, busy production database.
-- Run each statement on its own (CREATE INDEX CONCURRENTLY cannot run inside a transaction block), e.g.
--   psql "$DATABASE_URL" -f backend/db/ops/003_performance_indexes_concurrently.sql      (psql autocommits each statement)
-- Then run the normal migration; its IF NOT EXISTS clauses see the finished indexes and do nothing.
-- If a concurrent build is interrupted it leaves an INVALID index: DROP INDEX CONCURRENTLY <name>; and run it again.
CREATE INDEX CONCURRENTLY IF NOT EXISTS bookings_starts_at_idx ON bookings (starts_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS bookings_category_idx ON bookings (category_id) WHERE category_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS notifications_user_created_idx ON notifications (user_id, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS vcr_pending_start_idx ON venue_change_requests (requested_starts_at) WHERE status = 'PENDING';
CREATE INDEX CONCURRENTLY IF NOT EXISTS venue_maintenance_open_idx ON venue_maintenance (venue_id, starts_at) WHERE restored_at IS NULL;
