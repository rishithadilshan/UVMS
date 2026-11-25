const { httpError, auditTx } = require('./core');
const { loadVenue } = require('./availability');
const { colomboNow, isDate, isTime } = require('./time');
const { notify, notifyAdmins } = require('./notify');
const { addHistory, when } = require('./bookings');
const { processWaitlist } = require('./waitlist');

const MAINT_STATUSES = ['UNDER_MAINTENANCE', 'TEMPORARILY_CLOSED', 'UNAVAILABLE'];

/** Accepts 'YYYY-MM-DDTHH:MM' or 'YYYY-MM-DD HH:MM' and returns the stored 'YYYY-MM-DD HH:MM:00' form (or null). */
function parseLocal(v) {
  if (v === undefined || v === null || v === '') return null;
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(String(v));
  if (!m || !isDate(m[1]) || !isTime(m[2])) throw httpError(400, 'Dates must look like 2026-11-25T08:00');
  return `${m[1]} ${m[2]}:00`;
}

/** Reserving bookings that overlap the maintenance period (they are never cancelled automatically). */
async function affectedBookings(c, venueId, startsAt, endsAt) {
  const r = await c.query(
    `SELECT b.id, b.status, b.owner_id, u.name AS owner_name, v.name AS venue_name, to_char(b.starts_at,'YYYY-MM-DD') AS date,
            to_char(b.starts_at,'HH24:MI') AS start_time, to_char(b.ends_at,'HH24:MI') AS end_time, b.purpose
     FROM bookings b JOIN venues v ON v.id=b.venue_id LEFT JOIN users u ON u.id=b.owner_id
     WHERE b.venue_id=$1 AND b.status IN ('PENDING','CONFIRMED') AND b.starts_at < COALESCE($3::timestamp,'infinity'::timestamp) AND b.ends_at > $2 ORDER BY b.starts_at`,
    [venueId, startsAt, endsAt]);
  return r.rows;
}

/**
 * Creates a maintenance / closure record. If bookings are affected the caller must pass force=true (after the admin
 * reviewed the list); affected owners and admins are notified and the bookings stay untouched for re-arrangement.
 */
async function createMaintenance(c, after, { venueId, status, reason, description = '', startsAt, endsAt, actor, force = false }) {
  if (!MAINT_STATUSES.includes(status)) throw httpError(400, 'Status must be UNDER_MAINTENANCE, TEMPORARILY_CLOSED or UNAVAILABLE');
  if (!String(reason || '').trim()) throw httpError(400, 'A reason is required');
  const start = parseLocal(startsAt) || `${colomboNow().date} ${colomboNow().time}:00`;
  const end = parseLocal(endsAt);
  if (end && end <= start) throw httpError(400, 'The expected reopening must be after the start');
  const venue = await loadVenue(c, venueId, { lock: true });
  if (!venue) throw httpError(404, 'Venue not found');
  const affected = await affectedBookings(c, venueId, start, end);
  if (affected.length && !force) throw httpError(409, `${affected.length} existing booking(s) fall inside this period`, { code: 'MAINTENANCE_CONFLICTS', affected });
  const rec = (await c.query('INSERT INTO venue_maintenance(venue_id,status,reason,description,starts_at,ends_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [venueId, status, String(reason).trim(), description, start, end, actor.id])).rows[0];
  for (const b of affected) {
    await c.query('INSERT INTO maintenance_affected_bookings(maintenance_id,booking_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [rec.id, b.id]);
    await addHistory(c, b.id, 'MAINTENANCE_CONFLICT', actor.id, b.status, b.status, { maintenanceId: rec.id, reason });
    await notify(c, b.owner_id, { title: 'Your booking is affected by venue maintenance', message: `${venue.name} will be ${status.replace(/_/g, ' ').toLowerCase()} (${reason}). Your booking on ${when(b)} is not cancelled, but an administrator will arrange an alternative venue or time with you.`, type: 'MAINTENANCE_CONFLICT', link: `/bookings/${b.id}`, entityType: 'BOOKING', entityId: b.id });
  }
  if (affected.length) await notifyAdmins(c, { title: 'Maintenance conflicts need attention', message: `${affected.length} booking(s) at ${venue.name} overlap the new ${status.replace(/_/g, ' ').toLowerCase()} period. Please arrange alternatives.`, type: 'MAINTENANCE_CONFLICT', link: '/admin/maintenance', entityType: 'VENUE', entityId: venueId });
  await auditTx(c, actor.id, 'MAINTENANCE_CREATE', 'VENUE', venueId, { status, reason, start, end, affected: affected.length });
  return { record: rec, affected };
}

/** Restores a venue (all open records, or one record) and tells waitlisted users. */
async function restoreVenue(c, after, { venueId, maintenanceId = null, actor }) {
  const venue = await loadVenue(c, venueId, { lock: true });
  if (!venue) throw httpError(404, 'Venue not found');
  const r = await c.query(`UPDATE venue_maintenance SET restored_at=now(), restored_by=$3 WHERE venue_id=$1 AND restored_at IS NULL ${maintenanceId ? 'AND id=$2' : "AND $2::uuid IS NULL"} RETURNING id`, [venueId, maintenanceId, actor.id]);
  if (!maintenanceId) await c.query("UPDATE venues SET status='AVAILABLE', maintenance_note='', updated_at=now() WHERE id=$1", [venueId]);
  await auditTx(c, actor.id, 'VENUE_RESTORE', 'VENUE', venueId, { records: r.rowCount });
  after(() => processWaitlist(venueId));
  return r.rowCount;
}

module.exports = { MAINT_STATUSES, parseLocal, affectedBookings, createMaintenance, restoreVenue };
