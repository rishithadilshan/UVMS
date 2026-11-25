const express = require('express');
const { q, asyncRoute, isUuid } = require('../lib/core');
const { auth } = require('../lib/auth');
const { isDate, addDays } = require('../lib/time');

const router = express.Router();
router.use(auth);

/**
 * Availability calendar feed. Admins see every booking in detail; owners see their own details; everybody else only sees
 * that a slot is reserved (no purpose, owner or category), so private booking information is never exposed.
 */
router.get('/', asyncRoute(async (req, res) => {
  const { from, to } = req.query;
  if (!isDate(from) || !isDate(to) || to < from) return res.status(400).json({ message: 'Valid from and to dates are required' });
  if (addDays(from, 62) < to) return res.status(400).json({ message: 'The calendar range cannot exceed 62 days' });
  const vals = [from, addDays(to, 1)], cond = [];
  if (req.query.venueId && isUuid(req.query.venueId)) { vals.push(req.query.venueId); cond.push(`b.venue_id=$${vals.length}`); }
  if (req.query.building) { vals.push(req.query.building); cond.push(`v.building=$${vals.length}`); }
  if (req.query.categoryId && isUuid(req.query.categoryId)) { vals.push(req.query.categoryId); cond.push(`b.category_id=$${vals.length}`); }
  if (req.query.status && ['PENDING', 'CONFIRMED'].includes(req.query.status)) { vals.push(req.query.status); cond.push(`b.status=$${vals.length}`); }
  const eventsP = q(`SELECT b.id, b.status, b.owner_id, b.venue_id, v.name AS venue_name, v.building, to_char(b.starts_at,'YYYY-MM-DD"T"HH24:MI') AS start, to_char(b.ends_at,'YYYY-MM-DD"T"HH24:MI') AS "end",
      b.purpose, bc.name AS category, u.name AS owner_name FROM bookings b JOIN venues v ON v.id=b.venue_id LEFT JOIN booking_categories bc ON bc.id=b.category_id LEFT JOIN users u ON u.id=b.owner_id
      WHERE b.status IN ('PENDING','CONFIRMED') AND b.starts_at < $2::date AND b.ends_at > $1::date ${cond.length ? 'AND ' + cond.join(' AND ') : ''} ORDER BY b.starts_at LIMIT 2000`, vals);
  const maintP = (async () => {
    if (req.query.status || req.query.categoryId) return [];
    const mv = [from, addDays(to, 1)], mc = [];
    if (req.query.venueId && isUuid(req.query.venueId)) { mv.push(req.query.venueId); mc.push(`m.venue_id=$${mv.length}`); }
    if (req.query.building) { mv.push(req.query.building); mc.push(`v.building=$${mv.length}`); }
    return (await q(`SELECT m.id, m.status, m.reason, m.venue_id, v.name AS venue_name, v.building, to_char(m.starts_at,'YYYY-MM-DD"T"HH24:MI') AS start, to_char(COALESCE(m.ends_at, $2::date + interval '400 days'),'YYYY-MM-DD"T"HH24:MI') AS "end"
      FROM venue_maintenance m JOIN venues v ON v.id=m.venue_id WHERE m.restored_at IS NULL AND m.starts_at < $2::date AND COALESCE(m.ends_at,'infinity'::timestamp) > $1::date ${mc.length ? 'AND ' + mc.join(' AND ') : ''} LIMIT 500`, mv)).rows;
  })();
  const vp = [], vc = [];
  if (req.query.venueId && isUuid(req.query.venueId)) { vp.push(req.query.venueId); vc.push(`id=$${vp.length}`); }
  if (req.query.building) { vp.push(req.query.building); vc.push(`building=$${vp.length}`); }
  const venuesP = q(`SELECT id, name, building, capacity FROM venues WHERE active ${vc.length ? 'AND ' + vc.join(' AND ') : ''} ORDER BY building, name`, vp);
  const [eventsRes, maintRows, venuesRes] = await Promise.all([eventsP, maintP, venuesP]);
  const rows = eventsRes.rows;
  const admin = req.user.role === 'ADMIN';
  const events = rows.map((b) => {
    const detail = admin || b.owner_id === req.user.id;
    return { kind: 'BOOKING', id: detail ? b.id : null, status: b.status, venueId: b.venue_id, venueName: b.venue_name, building: b.building, start: b.start, end: b.end, isMine: b.owner_id === req.user.id,
      label: detail ? b.purpose : (b.status === 'PENDING' ? 'Reserved (pending request)' : 'Booked'), category: detail ? b.category : undefined, ownerName: admin ? b.owner_name : undefined };
  });
  const maintenance = maintRows.map((m) => ({ kind: 'MAINTENANCE', id: null, status: m.status, venueId: m.venue_id, venueName: m.venue_name, building: m.building, start: m.start, end: m.end, label: m.reason }));
  const venues = venuesRes.rows;
  res.json({ from, to, venues, events: [...events, ...maintenance] });
}));

module.exports = router;
