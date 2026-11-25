const express = require('express');
const { body } = require('express-validator');
const { q, asyncRoute, httpError, validate, idParam, BOOKING_ROLES } = require('../lib/core');
const { auth, roles } = require('../lib/auth');
const { validateWindow, stamp } = require('../lib/time');
const { cleanFacilities } = require('../lib/availability');
const { processWaitlist } = require('../lib/waitlist');

const router = express.Router();
router.use(auth, roles(...BOOKING_ROLES));

router.get('/', asyncRoute(async (req, res) => {
  const r = await q(`SELECT w.id, w.status, w.expected_participants AS participants, w.required_facilities AS facilities, w.notified_at AS "notifiedAt", w.created_at AS "createdAt", v.name AS "venueName", v.building,
    to_char(w.requested_starts_at,'YYYY-MM-DD') AS date, to_char(w.requested_starts_at,'HH24:MI') AS "startTime", to_char(w.requested_ends_at,'HH24:MI') AS "endTime"
    FROM waitlist_entries w JOIN venues v ON v.id=w.venue_id WHERE w.user_id=$1 ORDER BY w.created_at DESC LIMIT 100`, [req.user.id]);
  res.json(r.rows);
}));
router.post('/', validate(body('venueId').isUUID(), body('participants').isInt({ min: 1, max: 10000 })), asyncRoute(async (req, res) => {
  const { venueId, date, startTime, endTime } = req.body;
  const errs = validateWindow({ date, startTime, endTime });
  if (errs.length) return res.status(400).json({ message: errs[0] });
  const venue = (await q('SELECT id,capacity,facilities FROM venues WHERE id=$1 AND active', [venueId])).rows[0];
  if (!venue) throw httpError(404, 'Venue not found');
  if (Number(req.body.participants) > venue.capacity) throw httpError(400, 'The venue is too small for this number of participants');
  try {
    const r = await q("INSERT INTO waitlist_entries(user_id,venue_id,requested_starts_at,requested_ends_at,required_facilities,expected_participants) VALUES($1,$2,$3,$4,$5,$6) RETURNING id", [req.user.id, venueId, stamp(date, startTime), stamp(date, endTime), cleanFacilities(req.body.facilities), Number(req.body.participants)]);
    processWaitlist(venueId); // in case it is already free
    res.status(201).json({ id: r.rows[0].id, message: 'You will be notified if this venue becomes available. A notification does not reserve the venue.' });
  } catch (e) { if (e.code === '23505') return res.status(409).json({ message: 'You are already on the waitlist for this venue and time' }); throw e; }
}));
router.delete('/:id', idParam, asyncRoute(async (req, res) => {
  const r = await q("UPDATE waitlist_entries SET status='CANCELLED' WHERE id=$1 AND user_id=$2 AND status='WAITING' RETURNING id", [req.params.id, req.user.id]);
  if (!r.rowCount) return res.status(404).json({ message: 'Waitlist entry not found' });
  res.json({ message: 'Removed from the waitlist' });
}));

module.exports = router;
