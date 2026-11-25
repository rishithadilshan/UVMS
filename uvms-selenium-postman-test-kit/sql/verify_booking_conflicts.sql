-- UVMS QA verification queries (TEMPLATE ONLY).
-- First inspect your migrations/schema and replace:
--   booking_allocations, venue_id, booking_date, start_time, end_time, status
-- with the exact identifiers in your database.
-- Confirm the list of statuses that reserve a venue with the business owner.
-- Run against the QA database, never production without an approved change process.

-- 1) Find overlapping pairs of active/reserving bookings.
-- Half-open overlap rule: a.start < b.end AND b.start < a.end.
SELECT
    a.id AS booking_a_id,
    b.id AS booking_b_id,
    a.venue_id,
    a.booking_date,
    a.start_time AS a_start,
    a.end_time AS a_end,
    b.start_time AS b_start,
    b.end_time AS b_end,
    a.status AS a_status,
    b.status AS b_status
FROM booking_allocations a
JOIN booking_allocations b
  ON a.venue_id = b.venue_id
 AND a.booking_date = b.booking_date
 AND a.id < b.id
 AND a.start_time < b.end_time
 AND b.start_time < a.end_time
WHERE a.status IN ('approved', 'confirmed')
  AND b.status IN ('approved', 'confirmed')
ORDER BY a.venue_id, a.booking_date, a.start_time;

-- 2) Count duplicate active allocations for the exact same slot.
SELECT venue_id, booking_date, start_time, end_time, COUNT(*) AS allocation_count
FROM booking_allocations
WHERE status IN ('approved', 'confirmed')
GROUP BY venue_id, booking_date, start_time, end_time
HAVING COUNT(*) > 1;

-- 3) Inspect booking rows for the test slot after a concurrency run.
-- Replace values with the exact QA venue/date used in the run.
SELECT *
FROM booking_allocations
WHERE venue_id = 'REPLACE_QA_VENUE_ID'
  AND booking_date = DATE '2026-12-01'
ORDER BY start_time;

-- 4) Timetable synchronization check (TEMPLATE).
-- Replace timetable_entries and foreign-key/status columns with real schema names.
-- SELECT booking_id, COUNT(*) AS timetable_rows
-- FROM timetable_entries
-- WHERE booking_id = 'REPLACE_BOOKING_ID'
-- GROUP BY booking_id
-- HAVING COUNT(*) <> 1;
