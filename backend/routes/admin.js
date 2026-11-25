const express = require('express');
const { q, asyncRoute, httpError, getSetting, audit, paging } = require('../lib/core');
const { auth, roles } = require('../lib/auth');
const { isTime, toMinutes } = require('../lib/time');

const router = express.Router();
router.use(auth, roles('ADMIN'));

// One round trip for all dashboard counters (previously nine sequential COUNT queries) + the activity feed in parallel.
// "bookingsToday" uses a start-of-day range instead of starts_at::date so the starts_at index can be used (same result).
const OVERVIEW_SQL = `SELECT
  (SELECT count(*)::int FROM venues WHERE active) AS "venues",
  (SELECT count(*)::int FROM venues v WHERE v.active AND (v.status<>'AVAILABLE' OR EXISTS (SELECT 1 FROM venue_maintenance m WHERE m.venue_id=v.id AND m.restored_at IS NULL AND m.starts_at<=LOCALTIMESTAMP AND COALESCE(m.ends_at,'infinity'::timestamp)>LOCALTIMESTAMP))) AS "unavailableVenues",
  (SELECT count(*)::int FROM users WHERE status='PENDING') AS "pendingRegistrations",
  (SELECT count(*)::int FROM bookings WHERE status='PENDING') AS "pendingStudentRequests",
  (SELECT count(*)::int FROM venue_change_requests WHERE status='PENDING') AS "pendingChangeRequests",
  (SELECT count(*)::int FROM booking_modification_requests WHERE status='PENDING') AS "pendingModifications",
  (SELECT count(*)::int FROM bookings WHERE status='CONFIRMED' AND starts_at >= date_trunc('day', LOCALTIMESTAMP) AND starts_at < date_trunc('day', LOCALTIMESTAMP) + interval '1 day') AS "bookingsToday",
  (SELECT count(*)::int FROM bookings WHERE status='CONFIRMED' AND starts_at > LOCALTIMESTAMP) AS "upcomingBookings",
  (SELECT count(*)::int FROM users WHERE status='APPROVED' AND active) AS "users",
  (SELECT count(DISTINCT a.booking_id)::int FROM maintenance_affected_bookings a JOIN bookings b ON b.id=a.booking_id WHERE b.status IN ('PENDING','CONFIRMED') AND b.ends_at > LOCALTIMESTAMP) AS "openMaintenanceConflicts"`;

router.get('/overview', asyncRoute(async (req, res) => {
  const [counts, recent] = await Promise.all([
    q(OVERVIEW_SQL).then((r) => r.rows[0]),
    q('SELECT a.id, a.action, a.entity_type AS "entityType", a.created_at AS "createdAt", u.name AS "actorName" FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 8').then((r) => r.rows),
  ]);
  res.json({ counts, recent });
}));

router.get('/audit', asyncRoute(async (req, res) => {
  const { page, pageSize, limit, offset } = paging(req.query, 25);
  const vals = [], cond = [];
  if (req.query.entityType) { vals.push(req.query.entityType); cond.push(`a.entity_type=$${vals.length}`); }
  if (req.query.action) { vals.push(`%${String(req.query.action).toUpperCase()}%`); cond.push(`a.action LIKE $${vals.length}`); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const total = (await q(`SELECT count(*)::int AS n FROM audit_logs a ${where}`, vals)).rows[0].n;
  const r = await q(`SELECT a.id, a.action, a.entity_type AS "entityType", a.entity_id AS "entityId", a.metadata, a.created_at AS "createdAt", u.name AS "actorName" FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ${where} ORDER BY a.created_at DESC LIMIT ${limit} OFFSET ${offset}`, vals);
  res.json({ items: r.rows, total, page, pageSize });
}));

router.get('/reminders', asyncRoute(async (req, res) => {
  const { page, pageSize, limit, offset } = paging(req.query, 25);
  const vals = [], cond = [];
  if (req.query.status) { vals.push(String(req.query.status).toUpperCase()); cond.push(`r.status=$${vals.length}`); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const total = (await q(`SELECT count(*)::int AS n FROM booking_reminders r ${where}`, vals)).rows[0].n;
  const r = await q(`SELECT r.id, r.status, r.short_notice AS "shortNotice", r.remind_at AS "remindAt", r.sent_at AS "sentAt", r.last_error AS "lastError", u.name AS "userName", v.name AS "venueName", b.purpose,
      to_char(b.starts_at,'YYYY-MM-DD HH24:MI') AS "startsAt", b.id AS "bookingId"
    FROM booking_reminders r JOIN bookings b ON b.id=r.booking_id JOIN venues v ON v.id=b.venue_id LEFT JOIN users u ON u.id=r.user_id ${where} ORDER BY r.remind_at DESC LIMIT ${limit} OFFSET ${offset}`, vals);
  res.json({ items: r.rows, total, page, pageSize });
}));

router.get('/emails', asyncRoute(async (req, res) => {
  const r = await q('SELECT id, to_address AS "to", subject, status, error, created_at AS "createdAt" FROM email_log ORDER BY created_at DESC LIMIT 50');
  res.json(r.rows);
}));

const SETTINGS = {
  pending_expiry_hours: (v) => Number.isInteger(v) && v >= 1 && v <= 720,
  reminder_lead_hours: (v) => Number.isInteger(v) && v >= 1 && v <= 168,
  max_booking_hours: (v) => Number.isInteger(v) && v >= 1 && v <= 24,
  operating_hours: (v) => v && isTime(v.start) && isTime(v.end) && toMinutes(v.end) > toMinutes(v.start),
};
router.get('/settings', asyncRoute(async (req, res) => {
  const r = await q('SELECT key,value FROM app_settings');
  res.json(Object.fromEntries(r.rows.map((x) => [x.key, x.value])));
}));
router.put('/settings', asyncRoute(async (req, res) => {
  const changes = {};
  for (const [k, v] of Object.entries(req.body || {})) {
    if (!SETTINGS[k]) throw httpError(400, `Unknown setting ${k}`);
    if (!SETTINGS[k](v)) throw httpError(400, `Invalid value for ${k}`);
    changes[k] = v;
  }
  for (const [k, v] of Object.entries(changes)) await q('INSERT INTO app_settings(key,value,updated_by) VALUES($1,$2,$3) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now(), updated_by=EXCLUDED.updated_by', [k, JSON.stringify(v), req.user.id]);
  await audit(req, 'UPDATE', 'SETTINGS', null, changes);
  res.json({ message: 'Settings saved' });
}));

module.exports = router;
module.exports.OVERVIEW_SQL = OVERVIEW_SQL; // used by scripts/perf-explain.js
