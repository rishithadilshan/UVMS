const express = require('express');
const { body } = require('express-validator');
const { q, tx, asyncRoute, validate, idParam, paging } = require('../lib/core');
const { auth, roles } = require('../lib/auth');
const { createMaintenance, restoreVenue, affectedBookings, parseLocal } = require('../lib/maintenance');

const router = express.Router();
router.use(auth, roles('ADMIN'));

router.get('/', asyncRoute(async (req, res) => {
  const { page, pageSize, limit, offset } = paging(req.query);
  const vals = [], cond = [];
  if (req.query.venueId) { vals.push(req.query.venueId); cond.push(`m.venue_id=$${vals.length}`); }
  const state = req.query.state; // active | upcoming | past | open
  if (state === 'active') cond.push("m.restored_at IS NULL AND m.starts_at <= LOCALTIMESTAMP AND COALESCE(m.ends_at,'infinity'::timestamp) > LOCALTIMESTAMP");
  if (state === 'upcoming') cond.push('m.restored_at IS NULL AND m.starts_at > LOCALTIMESTAMP');
  if (state === 'past') cond.push("(m.restored_at IS NOT NULL OR COALESCE(m.ends_at,'infinity'::timestamp) <= LOCALTIMESTAMP)");
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const total = (await q(`SELECT count(*)::int AS n FROM venue_maintenance m ${where}`, vals)).rows[0].n;
  const r = await q(`SELECT m.id, m.venue_id AS "venueId", v.name AS "venueName", v.building, m.status, m.reason, m.description, m.starts_at AS "startsAt", m.ends_at AS "endsAt", m.restored_at AS "restoredAt", m.created_at AS "createdAt",
      cu.name AS "createdBy", (SELECT count(*)::int FROM maintenance_affected_bookings a JOIN bookings b ON b.id=a.booking_id WHERE a.maintenance_id=m.id AND b.status IN ('PENDING','CONFIRMED') AND b.ends_at > LOCALTIMESTAMP) AS "openConflicts",
      (m.restored_at IS NULL AND m.starts_at <= LOCALTIMESTAMP AND COALESCE(m.ends_at,'infinity'::timestamp) > LOCALTIMESTAMP) AS "isActive"
    FROM venue_maintenance m JOIN venues v ON v.id=m.venue_id LEFT JOIN users cu ON cu.id=m.created_by ${where} ORDER BY m.starts_at DESC LIMIT ${limit} OFFSET ${offset}`, vals);
  res.json({ items: r.rows, total, page, pageSize });
}));

/** Preview which bookings a period would affect (used by the form before saving). */
router.get('/preview', asyncRoute(async (req, res) => {
  const start = parseLocal(req.query.startsAt), end = parseLocal(req.query.endsAt);
  if (!req.query.venueId || !start) return res.status(400).json({ message: 'venueId and startsAt are required' });
  res.json({ affected: await affectedBookings(await require('../db/pool'), req.query.venueId, start, end) });
}));

router.post('/', validate(body('venueId').isUUID(), body('status').isString(), body('reason').trim().isLength({ min: 2, max: 300 }).withMessage('A reason is required')), asyncRoute(async (req, res) => {
  const out = await tx((c, after) => createMaintenance(c, after, { venueId: req.body.venueId, status: req.body.status, reason: req.body.reason, description: req.body.description || '', startsAt: req.body.startsAt, endsAt: req.body.endsAt, actor: req.user, force: req.body.force === true }));
  res.status(201).json(out);
}));

router.post('/:id/restore', idParam, asyncRoute(async (req, res) => {
  const rec = (await q('SELECT venue_id FROM venue_maintenance WHERE id=$1', [req.params.id])).rows[0];
  if (!rec) return res.status(404).json({ message: 'Maintenance record not found' });
  await tx((c, after) => restoreVenue(c, after, { venueId: rec.venue_id, maintenanceId: req.params.id, actor: req.user }));
  res.json({ message: 'Maintenance record closed' });
}));

/** Restore a venue to AVAILABLE: closes every open record. */
router.post('/venue/:id/restore', idParam, asyncRoute(async (req, res) => {
  const n = await tx((c, after) => restoreVenue(c, after, { venueId: req.params.id, actor: req.user }));
  res.json({ message: 'Venue restored to available', closed: n });
}));

module.exports = router;
