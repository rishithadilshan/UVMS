const express = require('express');
const { q, asyncRoute } = require('../lib/core');
const { auth, roles } = require('../lib/auth');
const { BOOKING_SELECT, mapBooking } = require('../lib/bookings');

const router = express.Router();
// Same audience as the existing non-admin dashboard page (admins have /api/admin/overview).
router.use(auth, roles('LECTURER', 'INSTRUCTOR', 'STUDENT', 'LAB_ASSISTANT'));

/**
 * One request for the whole Lecturer / Instructor / Student (/ Lab assistant) dashboard. It replaces three separate calls
 * (each of which re-authenticated and ran its own COUNT) with the same data:
 *   upcoming         = GET /bookings?time=upcoming&pageSize=6   (own bookings, soonest first)
 *   pendingRequests  = GET /bookings?status=PENDING             -> total (own pending requests)
 *   changeRequests   = GET /venue-changes?box=incoming&status=PENDING -> total (requests waiting for this user)
 * Everything is scoped to the authenticated user on the server.
 */
router.get('/summary', asyncRoute(async (req, res) => {
  const uid = req.user.id;
  const [upcoming, counts] = await Promise.all([
    q(`${BOOKING_SELECT} WHERE b.owner_id=$1 AND b.ends_at >= LOCALTIMESTAMP ORDER BY b.starts_at ASC LIMIT 6`, [uid]),
    q(`SELECT (SELECT count(*)::int FROM bookings WHERE owner_id=$1 AND status='PENDING') AS "pendingRequests",
              (SELECT count(*)::int FROM venue_change_requests WHERE owner_id=$1 AND NOT handled_by_admin AND status='PENDING') AS "changeRequests"`, [uid]),
  ]);
  res.json({ upcoming: upcoming.rows.map(mapBooking), ...counts.rows[0] });
}));

module.exports = router;
