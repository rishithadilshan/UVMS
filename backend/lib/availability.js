const { httpError } = require('./core');
const { toMinutes, freeIntervals, fromMinutes } = require('./time');

/** Booking statuses that reserve a venue. PENDING student requests reserve the venue temporarily. */
const RESERVING = ['PENDING', 'CONFIRMED'];

const EFFECTIVE_STATUS_SQL = `CASE WHEN v.status <> 'AVAILABLE' THEN v.status ELSE COALESCE((
  SELECT m.status FROM venue_maintenance m WHERE m.venue_id=v.id AND m.restored_at IS NULL
  AND m.starts_at <= LOCALTIMESTAMP AND COALESCE(m.ends_at,'infinity'::timestamp) > LOCALTIMESTAMP ORDER BY m.starts_at DESC LIMIT 1),'AVAILABLE') END`;

const norm = (s) => String(s || '').trim().toLowerCase();
const cleanFacilities = (arr) => [...new Set((Array.isArray(arr) ? arr : []).map((x) => String(x).trim()).filter(Boolean))].slice(0, 30);
/** True when `have` contains every facility in `need` (case-insensitive). */
const facilitiesCover = (have, need) => { const h = new Set((have || []).map(norm)); return (need || []).every((n) => h.has(norm(n))); };
const missingFacilities = (have, need) => { const h = new Set((have || []).map(norm)); return (need || []).filter((n) => !h.has(norm(n))); };

async function loadVenue(c, id, { lock = false } = {}) {
  const r = await c.query(`SELECT v.*, (${EFFECTIVE_STATUS_SQL}) AS effective_status FROM venues v WHERE v.id=$1 ${lock ? 'FOR UPDATE OF v' : ''}`, [id]);
  return r.rows[0] || null;
}

/** Reserving bookings that overlap [startsAt, endsAt) at the venue (newStart < existingEnd AND newEnd > existingStart). */
async function conflictsFor(c, venueId, startsAt, endsAt, excludeIds = []) {
  const r = await c.query(
    `SELECT b.id, b.status, b.starts_at, b.ends_at, b.owner_id, b.category_id, bc.priority_level, bc.name AS category_name, u.name AS owner_name, u.email AS owner_email, u.role AS owner_role,
            to_char(b.starts_at,'YYYY-MM-DD') AS date, to_char(b.starts_at,'HH24:MI') AS start_time, to_char(b.ends_at,'HH24:MI') AS end_time
     FROM bookings b LEFT JOIN users u ON u.id=b.owner_id LEFT JOIN booking_categories bc ON bc.id=b.category_id
     WHERE b.venue_id=$1 AND b.status = ANY($2) AND b.starts_at < $4 AND b.ends_at > $3 AND NOT (b.id = ANY($5::uuid[])) ORDER BY b.starts_at`,
    [venueId, RESERVING, startsAt, endsAt, excludeIds]);
  return r.rows;
}

/** Maintenance / closure records (not restored) that overlap the window. */
async function maintenanceFor(c, venueId, startsAt, endsAt) {
  const r = await c.query(
    `SELECT m.id, m.status, m.reason, m.description, m.starts_at, m.ends_at FROM venue_maintenance m
     WHERE m.venue_id=$1 AND m.restored_at IS NULL AND m.starts_at < $3 AND COALESCE(m.ends_at,'infinity'::timestamp) > $2 ORDER BY m.starts_at`,
    [venueId, startsAt, endsAt]);
  return r.rows;
}

/**
 * Full availability check of one venue for one window.
 * Returns { ok, reasons:[{code,message}], conflicts, blocks }. Never throws for business reasons.
 */
async function checkVenue(c, venue, { startsAt, endsAt, participants, facilities = [], excludeIds = [], skipFit = false }) {
  const reasons = [];
  if (!venue || !venue.active) reasons.push({ code: 'VENUE_INACTIVE', message: 'This venue is not in service' });
  else if (venue.status !== 'AVAILABLE') reasons.push({ code: 'VENUE_STATUS', message: `Venue is ${venue.status.replace(/_/g, ' ').toLowerCase()}${venue.maintenance_note ? `: ${venue.maintenance_note}` : ''}` });
  if (venue && !skipFit) {
    if (participants && participants > venue.capacity) reasons.push({ code: 'CAPACITY', message: `Capacity is ${venue.capacity} but ${participants} participants were requested` });
    const miss = missingFacilities(venue.facilities, facilities);
    if (miss.length) reasons.push({ code: 'FACILITIES', message: `Missing facilities: ${miss.join(', ')}` });
  }
  let conflicts = [], blocks = [];
  if (venue) {
    blocks = await maintenanceFor(c, venue.id, startsAt, endsAt);
    for (const b of blocks) reasons.push({ code: 'MAINTENANCE', message: `${b.status.replace(/_/g, ' ').toLowerCase()} (${b.reason})${b.ends_at ? `, expected reopening ${String(b.ends_at).slice(0, 16)}` : ''}` });
    conflicts = await conflictsFor(c, venue.id, startsAt, endsAt, excludeIds);
    if (conflicts.length) reasons.push({ code: 'BOOKED', message: 'The venue is already booked or reserved during this time' });
  }
  return { ok: reasons.length === 0, reasons, conflicts, blocks };
}

/** Free sub-ranges (HH:MM) of a single day window after removing bookings and maintenance. */
function partialAvailability(date, startTime, endTime, conflicts, blocks) {
  const toRange = (s, e) => {
    const sd = String(s).slice(0, 10), ed = String(e).slice(0, 10);
    const sm = sd < date ? 0 : toMinutes(String(s).slice(11, 16));
    const em = ed > date ? 24 * 60 : (e ? toMinutes(String(e).slice(11, 16)) : 24 * 60);
    return [sm, em];
  };
  const busy = [...conflicts.map((c) => toRange(c.starts_at, c.ends_at)), ...blocks.map((m) => toRange(m.starts_at, m.ends_at || `${date} 23:59:59`))];
  return freeIntervals(toMinutes(startTime), toMinutes(endTime), busy).filter(([s, e]) => e - s >= 15).map(([s, e]) => ({ startTime: fromMinutes(s), endTime: fromMinutes(e) }));
}

/** Throws a 409 with machine readable reasons. */
function assertOk(result, message = 'The venue is not available for the requested time') {
  if (!result.ok) throw httpError(409, result.reasons.map((r) => r.message)[0] || message, { reasons: result.reasons });
}

module.exports = { RESERVING, EFFECTIVE_STATUS_SQL, loadVenue, conflictsFor, maintenanceFor, checkVenue, partialAvailability, assertOk, cleanFacilities, facilitiesCover, missingFacilities, norm };
