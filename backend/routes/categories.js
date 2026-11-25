const express = require('express');
const { body } = require('express-validator');
const { q, tx, asyncRoute, httpError, validate, idParam, audit, auditTx } = require('../lib/core');
const { auth, roles } = require('../lib/auth');
const { notify } = require('../lib/notify');

const router = express.Router();       // /api/categories
const priority = express.Router();     // /api/priority
router.use(auth);
priority.use(auth, roles('ADMIN'));

const LABELS = { 1: 'Highest', 2: 'High', 3: 'Medium', 4: 'Normal' };
const map = (c) => ({ id: c.id, _id: c.id, name: c.name, description: c.description, priorityLevel: c.priority_level, priorityLabel: LABELS[c.priority_level] || `Level ${c.priority_level}`, active: c.active, createdAt: c.created_at, bookingCount: c.booking_count });

router.get('/', asyncRoute(async (req, res) => {
  const all = req.user.role === 'ADMIN' && req.query.all === 'true';
  const r = await q(`SELECT c.*, (SELECT count(*)::int FROM bookings b WHERE b.category_id=c.id) AS booking_count FROM booking_categories c ${all ? '' : 'WHERE c.active'} ORDER BY c.priority_level, c.name`);
  res.json(r.rows.map(map));
}));

const rules = [body('name').trim().isLength({ min: 2, max: 80 }).withMessage('Category name is required'), body('priorityLevel').isInt({ min: 1, max: 10 }).withMessage('Priority level must be between 1 (highest) and 10')];
router.post('/', roles('ADMIN'), validate(...rules), asyncRoute(async (req, res) => {
  try {
    const r = await q('INSERT INTO booking_categories(name,description,priority_level) VALUES($1,$2,$3) RETURNING *', [req.body.name, req.body.description || '', req.body.priorityLevel]);
    await audit(req, 'CREATE', 'BOOKING_CATEGORY', r.rows[0].id, { name: req.body.name, priority: req.body.priorityLevel });
    res.status(201).json(map(r.rows[0]));
  } catch (e) { if (e.code === '23505') return res.status(409).json({ message: 'A category with this name already exists' }); throw e; }
}));
router.put('/:id', roles('ADMIN'), idParam, asyncRoute(async (req, res) => {
  const { name, description, priorityLevel, active } = req.body;
  if (priorityLevel !== undefined && (!Number.isInteger(Number(priorityLevel)) || priorityLevel < 1 || priorityLevel > 10)) return res.status(400).json({ message: 'Priority level must be between 1 (highest) and 10' });
  if (name !== undefined && String(name).trim().length < 2) return res.status(400).json({ message: 'Category name is required' });
  try {
    const r = await q('UPDATE booking_categories SET name=COALESCE($2,name), description=COALESCE($3,description), priority_level=COALESCE($4,priority_level), active=COALESCE($5,active), updated_at=now() WHERE id=$1 RETURNING *',
      [req.params.id, name ? String(name).trim() : null, description ?? null, priorityLevel ?? null, typeof active === 'boolean' ? active : null]);
    if (!r.rowCount) return res.status(404).json({ message: 'Category not found' });
    await audit(req, 'UPDATE', 'BOOKING_CATEGORY', req.params.id, { name, priorityLevel, active });
    res.json(map(r.rows[0]));
  } catch (e) { if (e.code === '23505') return res.status(409).json({ message: 'A category with this name already exists' }); throw e; }
}));

// ---------- competing requests: pending venue-change requests compared by configured priority ----------
priority.get('/conflicts', asyncRoute(async (req, res) => {
  const r = await q(`SELECT r.id, r.status, r.reason, r.message, r.created_at AS "createdAt", r.admin_ruling AS "adminRuling", r.admin_note AS "adminNote", r.handled_by_admin AS "handledByAdmin",
      v.name AS "venueName", v.building, to_char(r.requested_starts_at,'YYYY-MM-DD') AS date, to_char(r.requested_starts_at,'HH24:MI') AS "startTime", to_char(r.requested_ends_at,'HH24:MI') AS "endTime",
      ru.name AS "requesterName", ru.role AS "requesterRole", rc.name AS "requestedCategory", rc.priority_level AS "requestedPriority", r.purpose AS "requestedPurpose", r.participants AS "requestedParticipants",
      ou.name AS "ownerName", ou.role AS "ownerRole", tc.name AS "currentCategory", tc.priority_level AS "currentPriority", tb.purpose AS "currentPurpose", tb.status AS "currentStatus", tb.expected_students AS "currentParticipants",
      to_char(tb.starts_at,'HH24:MI') AS "currentStart", to_char(tb.ends_at,'HH24:MI') AS "currentEnd"
    FROM venue_change_requests r JOIN venues v ON v.id=r.venue_id JOIN users ru ON ru.id=r.requester_id JOIN bookings tb ON tb.id=r.target_booking_id LEFT JOIN users ou ON ou.id=tb.owner_id
    LEFT JOIN booking_categories rc ON rc.id=r.category_id LEFT JOIN booking_categories tc ON tc.id=tb.category_id
    WHERE r.status='PENDING' ORDER BY r.created_at`);
  res.json(r.rows.map((x) => ({ ...x, comparison: x.requestedPriority == null || x.currentPriority == null ? 'UNKNOWN'
    : x.requestedPriority < x.currentPriority ? 'REQUESTER_HIGHER' : x.requestedPriority > x.currentPriority ? 'REQUESTER_LOWER' : 'EQUAL' })));
}));

/**
 * Administrative ruling on a competing request. It is recorded in the audit trail and sent to both parties, but it never
 * cancels or overwrites the confirmed booking: the owner (or the administrator, for student-owned bookings) still completes
 * the normal venue-change process.
 */
priority.post('/conflicts/:id/decision', idParam, validate(body('ruling').isIn(['SUPPORT_REQUEST', 'SUPPORT_CURRENT', 'NEEDS_DISCUSSION']), body('note').trim().isLength({ min: 3, max: 1000 }).withMessage('Please record the reason for your decision')), asyncRoute(async (req, res) => {
  const out = await tx(async (c) => {
    const r = (await c.query("SELECT * FROM venue_change_requests WHERE id=$1 AND status='PENDING' FOR UPDATE", [req.params.id])).rows[0];
    if (!r) throw httpError(404, 'Pending request not found');
    await c.query('UPDATE venue_change_requests SET admin_ruling=$2, admin_note=$3, admin_ruled_by=$4, admin_ruled_at=now(), updated_at=now() WHERE id=$1', [r.id, req.body.ruling, req.body.note, req.user.id]);
    await auditTx(c, req.user.id, 'PRIORITY_DECISION', 'VENUE_CHANGE', r.id, { ruling: req.body.ruling, note: req.body.note });
    const text = { SUPPORT_REQUEST: 'The administrator supports the request', SUPPORT_CURRENT: 'The administrator supports keeping the current booking', NEEDS_DISCUSSION: 'The administrator asks both parties to coordinate' }[req.body.ruling];
    for (const uid of [...new Set([r.requester_id, r.owner_id].filter(Boolean))]) {
      await notify(c, uid, { title: 'Administrator decision on a venue conflict', message: `${text}. ${req.body.note}`, type: 'PRIORITY_DECISION', link: uid === r.requester_id ? '/venue-changes?box=outgoing' : '/venue-changes', entityType: 'VENUE_CHANGE', entityId: r.id });
    }
    return true;
  });
  res.json({ message: 'Decision recorded and both parties were notified', ok: out });
}));

module.exports = router;
module.exports.priority = priority;
